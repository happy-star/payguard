import { explainDeal } from "./ai/explain";
import { mockExtract } from "./ai/mockExtract";
import { mockIds } from "./paypal/mock";
import { samplePrompts } from "./samples";
import type { Deal, DealEvent } from "./types";

const HOUR = 60 * 60 * 1000;

export function buildSeedDeals(now: Date, clientOrigin: string): Deal[] {
  const brand = samplePrompts.find((sample) => sample.id === "brand");
  const edit = samplePrompts.find((sample) => sample.id === "edit");
  const csv = samplePrompts.find((sample) => sample.id === "csv");
  if (!brand || !edit || !csv) throw new Error("Sample prompts are missing.");

  const maya = fromPrompt("pg_seed_brand", brand.prompt, now, clientOrigin);
  maya.createdAt = iso(now, -48 * HOUR);
  maya.milestones = maya.milestones.map((milestone, index) => ({ ...milestone, done: index === 0 }));
  const mayaIds = mockIds(maya.id);
  maya.paypal = {
    ...maya.paypal,
    orderId: mayaIds.orderId,
    orderStatus: "COMPLETED",
    authorizationId: mayaIds.authorizationId,
    approveUrl: `${clientOrigin}/checkout/${maya.id}`,
    payerId: mayaIds.payerId,
  };
  maya.status = "authorized";
  maya.events = [
    event(iso(now, -48 * HOUR), "created", "PayPal order created. Waiting for the buyer to approve the hold."),
    event(iso(now, -47 * HOUR), "authorized", "Priya Shah approved the hold. The funds are reserved, not captured."),
  ];
  maya.updatedAt = iso(now, -47 * HOUR);
  maya.explanation = explainDeal(maya);

  const jordan = fromPrompt("pg_seed_edit", edit.prompt, now, clientOrigin);
  jordan.createdAt = iso(now, -120 * HOUR);
  jordan.milestones = jordan.milestones.map((milestone) => ({ ...milestone, done: true }));
  const jordanIds = mockIds(jordan.id);
  jordan.paypal = {
    ...jordan.paypal,
    orderId: jordanIds.orderId,
    orderStatus: "COMPLETED",
    authorizationId: jordanIds.authorizationId,
    captureId: jordanIds.captureId,
    approveUrl: `${clientOrigin}/checkout/${jordan.id}`,
    payerId: jordanIds.payerId,
  };
  jordan.status = "captured";
  jordan.events = [
    event(iso(now, -120 * HOUR), "created", "PayPal order created. Waiting for the buyer to approve the hold."),
    event(iso(now, -118 * HOUR), "authorized", "The buyer approved the hold. The funds are reserved, not captured."),
    event(iso(now, -26 * HOUR), "captured", "The hold was captured. The milestone is settled."),
  ];
  jordan.updatedAt = iso(now, -26 * HOUR);
  jordan.explanation = explainDeal(jordan);

  const sam = fromPrompt("pg_seed_csv", csv.prompt, now, clientOrigin);
  sam.createdAt = iso(now, -1 * HOUR);
  const samIds = mockIds(sam.id);
  sam.paypal = {
    ...sam.paypal,
    orderId: samIds.orderId,
    orderStatus: "PAYER_ACTION_REQUIRED",
    approveUrl: `${clientOrigin}/checkout/${sam.id}`,
  };
  sam.status = "created";
  sam.events = [
    event(iso(now, -1 * HOUR), "created", "Mock PayPal order created. The buyer still has to approve the hold."),
  ];
  sam.updatedAt = iso(now, -1 * HOUR);
  sam.explanation = explainDeal(sam);

  return [maya, jordan, sam];
}

function fromPrompt(id: string, prompt: string, now: Date, clientOrigin: string): Deal {
  const extracted = mockExtract(prompt, now);
  if (!extracted.amount) throw new Error(`Sample ${id} did not produce an amount.`);
  const stamp = now.toISOString();
  return {
    id,
    createdAt: stamp,
    updatedAt: stamp,
    prompt,
    title: extracted.title,
    summary: extracted.summary,
    amount: extracted.amount,
    currency: extracted.currency,
    buyerName: extracted.buyerName,
    freelancerName: extracted.freelancerName,
    dueDate: extracted.dueDate,
    milestones: extracted.milestones.map((milestone, index) => ({
      id: `ms_${index + 1}`,
      title: milestone.title,
      condition: milestone.condition,
      done: false,
    })),
    riskNotes: extracted.riskNotes,
    missing: extracted.missing,
    confidence: extracted.confidence,
    aiSource: "mock",
    status: "created",
    paypal: {
      mode: "mock",
      orderId: null,
      orderStatus: null,
      authorizationId: null,
      captureId: null,
      approveUrl: `${clientOrigin}/checkout/${id}`,
      payerId: null,
      lastError: null,
    },
    explanation: "",
    events: [],
  };
}

function event(at: string, status: DealEvent["status"], note: string): DealEvent {
  return { at, status, note };
}

function iso(now: Date, deltaMs: number): string {
  return new Date(now.getTime() + deltaMs).toISOString();
}
