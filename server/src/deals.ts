import { randomBytes } from "node:crypto";
import { explainDeal } from "./ai/explain";
import { HttpError, errorMessage } from "./http";
import { mockAuthorize, mockCapture } from "./paypal/mock";
import type { PaypalProvider } from "./paypal/provider";
import { buildSeedDeals } from "./seed";
import type { DealStore } from "./store";
import type { CreateDealInput, Deal, DealStatus, PaypalMode, PaypalState } from "./types";

export interface DealServiceDeps {
  store: DealStore;
  paypalMode: PaypalMode;
  clientOrigin: string;
  providers: { mock: PaypalProvider; sandbox: PaypalProvider };
  rewrite: (deal: Deal) => Promise<string>;
}

export interface WebhookResult {
  matched: boolean;
  action: string;
}

export function createDealService(deps: DealServiceDeps) {
  const providerFor = (deal: Deal) => (deal.paypal.mode === "sandbox" ? deps.providers.sandbox : deps.providers.mock);

  return {
    list(): Deal[] {
      return deps.store
        .read()
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    get(id: string): Deal {
      return must(deps.store, id);
    },
    async create(input: CreateDealInput): Promise<Deal> {
      const deal = blankDeal(input, deps.paypalMode);
      await placeOrder(deal, providerFor(deal));
      await deps.store.update((deals) => {
        deals.push(deal);
        return deal;
      });
      return deal;
    },
    async retryOrder(id: string): Promise<Deal> {
      const existing = must(deps.store, id);
      if (existing.paypal.orderId && existing.status !== "failed") return existing;
      if (existing.status !== "failed") {
        throw new HttpError(409, "Only a failed hold can be retried.");
      }
      const provider = providerFor(existing);
      try {
        const order = await provider.createOrder(orderInput(existing), requestId(existing.id, "create"));
        return deps.store.update((deals) => {
          const deal = requireDeal(deals, id);
          transition(deal, "created", createdNote(deal), {
            orderId: order.orderId,
            orderStatus: order.orderStatus,
            approveUrl: order.approveUrl,
            lastError: null,
          });
          return deal;
        });
      } catch (error) {
        const message = errorMessage(error);
        await rememberError(deps.store, id, message);
        throw new HttpError(502, message);
      }
    },
    async approveMock(id: string): Promise<Deal> {
      const existing = must(deps.store, id);
      if (existing.paypal.mode !== "mock") {
        throw new HttpError(400, "Sandbox deals are approved on PayPal, then returned here.");
      }
      return this.authorize(id, mockAuthorize(existing.id).payerId);
    },
    async authorize(id: string, payerId?: string | null): Promise<Deal> {
      const existing = must(deps.store, id);
      if (existing.status === "authorized" || existing.status === "captured" || existing.status === "voided") {
        return existing;
      }
      if (existing.status !== "created" && existing.status !== "approved") {
        throw new HttpError(409, `A ${existing.status} deal cannot be authorized.`);
      }
      if (!existing.paypal.orderId) throw new HttpError(409, "This deal has no PayPal order yet.");

      let authorizationId = "";
      let orderStatus = "COMPLETED";
      if (existing.paypal.mode === "mock") {
        const mock = mockAuthorize(existing.id);
        authorizationId = mock.authorizationId;
        orderStatus = mock.orderStatus;
      } else {
        try {
          const result = await providerFor(existing).authorizeOrder(
            existing.paypal.orderId,
            requestId(existing.id, "authorize"),
          );
          authorizationId = result.authorizationId;
          orderStatus = result.orderStatus;
        } catch (error) {
          const message = errorMessage(error);
          await rememberError(deps.store, id, message, `Authorization did not complete. ${message}`);
          throw new HttpError(502, message);
        }
      }

      return deps.store.update((deals) => {
        const deal = requireDeal(deals, id);
        if (deal.status === "authorized" || deal.status === "captured" || deal.status === "voided") return deal;
        transition(deal, "authorized", `${deal.buyerName} approved the hold. The funds are reserved, not captured.`, {
          authorizationId,
          orderStatus,
          payerId: payerId ?? deal.paypal.payerId,
          lastError: null,
        });
        return deal;
      });
    },
    async capture(id: string): Promise<Deal> {
      const existing = must(deps.store, id);
      if (existing.status !== "authorized") {
        throw new HttpError(409, "Funds can be released only while they are on hold.");
      }
      if (!existing.paypal.authorizationId) throw new HttpError(409, "This hold has no authorization id.");
      let captureId = "";
      if (existing.paypal.mode === "mock") {
        captureId = mockCapture(existing.id).captureId;
      } else {
        try {
          const result = await providerFor(existing).captureAuthorization(
            existing.paypal.authorizationId,
            requestId(existing.id, "capture"),
          );
          captureId = result.captureId;
        } catch (error) {
          const message = errorMessage(error);
          await rememberError(deps.store, id, message, `Capture failed. ${message}`);
          throw new HttpError(502, message);
        }
      }
      return deps.store.update((deals) => {
        const deal = requireDeal(deals, id);
        if (deal.status === "captured") return deal;
        if (deal.status !== "authorized") {
          throw new HttpError(409, "Funds can be released only while they are on hold.");
        }
        transition(deal, "captured", "The hold was captured. The milestone is settled.", {
          captureId,
          orderStatus: "COMPLETED",
          lastError: null,
        });
        return deal;
      });
    },
    async voidHold(id: string): Promise<Deal> {
      const existing = must(deps.store, id);
      if (existing.status !== "authorized") {
        throw new HttpError(409, "Only an active hold can be voided.");
      }
      if (!existing.paypal.authorizationId) throw new HttpError(409, "This hold has no authorization id.");
      if (existing.paypal.mode === "sandbox") {
        try {
          await providerFor(existing).voidAuthorization(
            existing.paypal.authorizationId,
            requestId(existing.id, "void"),
          );
        } catch (error) {
          const message = errorMessage(error);
          await rememberError(deps.store, id, message, `Void failed. ${message}`);
          throw new HttpError(502, message);
        }
      }
      return deps.store.update((deals) => {
        const deal = requireDeal(deals, id);
        if (deal.status === "voided") return deal;
        if (deal.status !== "authorized") throw new HttpError(409, "Only an active hold can be voided.");
        transition(deal, "voided", "The authorization was voided. The buyer is not charged.", {
          orderStatus: "VOIDED",
          lastError: null,
        });
        return deal;
      });
    },
    async cancel(id: string): Promise<Deal> {
      const existing = must(deps.store, id);
      if (existing.status === "cancelled") return existing;
      if (existing.status !== "created" && existing.status !== "approved") {
        throw new HttpError(409, "This deal can no longer be cancelled. Void an active hold instead.");
      }
      return deps.store.update((deals) => {
        const deal = requireDeal(deals, id);
        if (deal.status === "cancelled") return deal;
        transition(deal, "cancelled", "The buyer left before approving the hold.", { lastError: null });
        return deal;
      });
    },
    async setMilestone(id: string, milestoneId: string, done: boolean): Promise<Deal> {
      return deps.store.update((deals) => {
        const deal = requireDeal(deals, id);
        if (deal.status === "captured" || deal.status === "voided" || deal.status === "cancelled") {
          throw new HttpError(409, "Milestones are locked once the hold is closed.");
        }
        const milestone = deal.milestones.find((item) => item.id === milestoneId);
        if (!milestone) throw new HttpError(404, "That milestone is not on this deal.");
        milestone.done = done;
        deal.updatedAt = new Date().toISOString();
        deal.explanation = explainDeal(deal);
        return deal;
      });
    },
    async explain(id: string): Promise<Deal> {
      const existing = must(deps.store, id);
      const text = await deps.rewrite(existing);
      return deps.store.update((deals) => {
        const deal = requireDeal(deals, id);
        deal.explanation = text;
        deal.updatedAt = new Date().toISOString();
        return deal;
      });
    },
    async seed(): Promise<Deal[]> {
      const seeded = buildSeedDeals(new Date(), deps.clientOrigin);
      await deps.store.update((deals) => {
        for (const sample of seeded) {
          const index = deals.findIndex((deal) => deal.id === sample.id);
          if (index >= 0) deals[index] = sample;
          else deals.push(sample);
        }
        return seeded;
      });
      return seeded;
    },
    async applyWebhook(event: unknown): Promise<WebhookResult> {
      const record = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
      const type = typeof record.event_type === "string" ? record.event_type : "";
      const dealId = matchDeal(deps.store.read(), record);
      if (!dealId) return { matched: false, action: "ignored" };

      if (type === "CHECKOUT.ORDER.APPROVED") {
        const deal = must(deps.store, dealId);
        if (deal.status === "created" || deal.status === "approved") {
          await this.authorize(dealId, null);
          return { matched: true, action: "authorized" };
        }
        return { matched: true, action: "noop" };
      }

      if (type === "PAYMENT.AUTHORIZATION.CREATED") {
        const authId = resourceId(record);
        await deps.store.update((deals) => {
          const deal = requireDeal(deals, dealId);
          if (deal.status === "created" || deal.status === "approved") {
            transition(deal, "authorized", "PayPal reported the authorization.", {
              authorizationId: authId ?? deal.paypal.authorizationId,
              orderStatus: "COMPLETED",
              lastError: null,
            });
          }
          return deal;
        });
        return { matched: true, action: "authorized" };
      }

      if (type === "PAYMENT.CAPTURE.COMPLETED") {
        const captureId = resourceId(record);
        await deps.store.update((deals) => {
          const deal = requireDeal(deals, dealId);
          if (deal.status === "authorized") {
            transition(deal, "captured", "PayPal reported the capture.", {
              captureId: captureId ?? deal.paypal.captureId,
              orderStatus: "COMPLETED",
              lastError: null,
            });
          }
          return deal;
        });
        return { matched: true, action: "captured" };
      }

      if (type === "PAYMENT.AUTHORIZATION.VOIDED") {
        await deps.store.update((deals) => {
          const deal = requireDeal(deals, dealId);
          if (deal.status === "authorized") {
            transition(deal, "voided", "PayPal reported the void.", {
              orderStatus: "VOIDED",
              lastError: null,
            });
          }
          return deal;
        });
        return { matched: true, action: "voided" };
      }

      return { matched: true, action: "ignored" };
    },
  };
}

export type DealService = ReturnType<typeof createDealService>;

function blankDeal(input: CreateDealInput, mode: PaypalMode): Deal {
  const now = new Date().toISOString();
  return {
    id: `pg_${randomBytes(5).toString("hex")}`,
    createdAt: now,
    updatedAt: now,
    prompt: input.prompt,
    title: input.title,
    summary: input.summary,
    amount: input.amount,
    currency: input.currency,
    buyerName: input.buyerName,
    freelancerName: input.freelancerName,
    dueDate: input.dueDate,
    milestones: input.milestones.map((milestone, index) => ({
      id: `ms_${index + 1}`,
      title: milestone.title,
      condition: milestone.condition,
      done: false,
    })),
    riskNotes: input.riskNotes,
    missing: input.missing,
    confidence: input.confidence,
    aiSource: input.aiSource,
    status: "created",
    paypal: emptyPaypal(mode),
    explanation: "",
    events: [],
  };
}

function emptyPaypal(mode: PaypalMode): PaypalState {
  return {
    mode,
    orderId: null,
    orderStatus: null,
    authorizationId: null,
    captureId: null,
    approveUrl: null,
    payerId: null,
    lastError: null,
  };
}

async function placeOrder(deal: Deal, provider: PaypalProvider) {
  try {
    const order = await provider.createOrder(orderInput(deal), requestId(deal.id, "create"));
    transition(deal, "created", createdNote({ ...deal, paypal: { ...deal.paypal, mode: deal.paypal.mode } }), {
      orderId: order.orderId,
      orderStatus: order.orderStatus,
      approveUrl: order.approveUrl,
      lastError: null,
    });
  } catch (error) {
    const message = errorMessage(error);
    transition(deal, "failed", message, { lastError: message });
  }
}

function orderInput(deal: Deal) {
  return {
    dealId: deal.id,
    amount: deal.amount,
    currency: deal.currency,
    description: deal.title,
    customId: deal.id,
  };
}

function createdNote(deal: Deal): string {
  return deal.paypal.mode === "mock"
    ? "Mock PayPal order created. The buyer still has to approve the hold."
    : "PayPal Sandbox order created. The buyer still has to approve the hold.";
}

export function transition(
  deal: Deal,
  status: DealStatus,
  note: string,
  patch?: Partial<PaypalState>,
): void {
  deal.status = status;
  if (patch) deal.paypal = { ...deal.paypal, ...patch };
  deal.updatedAt = new Date().toISOString();
  deal.events.push({ at: deal.updatedAt, status, note });
  deal.explanation = explainDeal(deal);
}

function requestId(dealId: string, action: string): string {
  return `payguard-${dealId}-${action}-${Date.now()}`;
}

function must(store: DealStore, id: string): Deal {
  const deal = store.get(id);
  if (!deal) throw new HttpError(404, "No deal with that id.");
  return structuredClone(deal);
}

function requireDeal(deals: Deal[], id: string): Deal {
  const deal = deals.find((item) => item.id === id);
  if (!deal) throw new HttpError(404, "No deal with that id.");
  return deal;
}

async function rememberError(store: DealStore, id: string, message: string, note?: string) {
  await store.update((deals) => {
    const deal = requireDeal(deals, id);
    deal.paypal.lastError = message;
    deal.updatedAt = new Date().toISOString();
    deal.events.push({
      at: deal.updatedAt,
      status: deal.status,
      note: note ?? message,
    });
    deal.explanation = explainDeal(deal);
    return deal;
  });
}

function matchDeal(deals: Deal[], event: Record<string, unknown>): string | null {
  const candidates = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value) candidates.add(value);
  };
  const resource = event.resource && typeof event.resource === "object" ? (event.resource as Record<string, unknown>) : {};
  add(resource.id);
  add(resource.custom_id);
  if (Array.isArray(resource.purchase_units)) {
    for (const unit of resource.purchase_units) {
      if (!unit || typeof unit !== "object") continue;
      const record = unit as Record<string, unknown>;
      add(record.custom_id);
      add(record.reference_id);
    }
  }
  const supplementary = resource.supplementary_data;
  if (supplementary && typeof supplementary === "object") {
    const related = (supplementary as Record<string, unknown>).related_ids;
    if (related && typeof related === "object") {
      const ids = related as Record<string, unknown>;
      add(ids.order_id);
      add(ids.authorization_id);
    }
  }
  for (const deal of deals) {
    if (candidates.has(deal.id)) return deal.id;
    if (deal.paypal.orderId && candidates.has(deal.paypal.orderId)) return deal.id;
    if (deal.paypal.authorizationId && candidates.has(deal.paypal.authorizationId)) return deal.id;
    if (deal.paypal.captureId && candidates.has(deal.paypal.captureId)) return deal.id;
  }
  return null;
}

function resourceId(event: Record<string, unknown>): string | null {
  const resource = event.resource;
  if (!resource || typeof resource !== "object") return null;
  const id = (resource as Record<string, unknown>).id;
  return typeof id === "string" ? id : null;
}
