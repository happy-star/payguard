import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/createApp";
import { api, listen } from "./helpers";

const NOT_CONFIGURED =
  "PayPal webhook verification is not configured. Set PAYPAL_WEBHOOK_ID. The event was not applied.";
const NOT_VERIFIED = "PayPal webhook signature was not verified. The event was not applied.";

test("sandbox without PAYPAL_WEBHOOK_ID rejects webhook state changes", async () => {
  const ctx = await startSandbox({});
  try {
    const health = await api(ctx.base, "/api/health");
    assert.equal(health.status, 200);
    assert.equal((health.body as Health).webhookVerification, false);
    assert.equal((health.body as Health).paypal, "sandbox");

    const created = await makeDeal(ctx.base);
    const beforeCalls = ctx.calls.length;
    const approved = await postWebhook(ctx.base, {
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: created.paypal.orderId, purchase_units: [{ custom_id: created.id }] },
    });
    assert.equal(approved.status, 503);
    assert.deepEqual(approved.body, { error: NOT_CONFIGURED });
    const forgedAuth = await postWebhook(ctx.base, {
      event_type: "PAYMENT.AUTHORIZATION.CREATED",
      resource: { id: "AUTH-FORGED", custom_id: created.id },
    });
    assert.equal(forgedAuth.status, 503);
    const stillCreated = await readDeal(ctx.base, created.id);
    assert.equal(stillCreated.status, "created");
    assert.equal(stillCreated.paypal.authorizationId, null);
    assert.equal(ctx.calls.length, beforeCalls);
    assert.equal(ctx.calls.some((call) => call.includes("/authorize")), false);
    assert.equal(ctx.calls.some((call) => call.includes("verify-webhook-signature")), false);

    const held = await holdDeal(ctx.base, created.id);
    const heldCalls = ctx.calls.length;
    const capture = await postWebhook(ctx.base, captureEvent(held));
    const voided = await postWebhook(ctx.base, voidEvent(held));
    assert.equal(capture.status, 503);
    assert.equal(voided.status, 503);
    const after = await readDeal(ctx.base, held.id);
    assert.equal(after.status, "authorized");
    assert.equal(after.paypal.authorizationId, held.paypal.authorizationId);
    assert.equal(after.paypal.captureId, null);
    assert.equal(ctx.calls.length, heldCalls);
    assert.equal(ctx.calls.some((call) => call.includes("/capture")), false);
    assert.equal(ctx.calls.some((call) => call.includes("/void")), false);
  } finally {
    await ctx.stop();
  }
});

test("sandbox rejects a missing or invalid webhook signature without changing the hold", async () => {
  const ctx = await startSandbox({ webhookId: "WH-TEST", verifyStatus: "FAILURE" });
  try {
    const health = await api(ctx.base, "/api/health");
    assert.equal((health.body as Health).webhookVerification, true);

    const created = await makeDeal(ctx.base);
    const held = await holdDeal(ctx.base, created.id);
    const baseline = ctx.calls.filter((call) => call.includes("verify-webhook-signature")).length;

    const missing = await postWebhook(ctx.base, captureEvent(held), { "paypal-transmission-id": "tx-only" });
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.body, { error: NOT_VERIFIED });

    const badHost = await postWebhook(ctx.base, captureEvent(held), {
      ...goodHeaders,
      "paypal-cert-url": "https://evil.example/cert.pem",
    });
    assert.equal(badHost.status, 401);

    const cleartext = await postWebhook(ctx.base, voidEvent(held), {
      ...goodHeaders,
      "paypal-cert-url": "http://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST",
    });
    assert.equal(cleartext.status, 401);

    const unverifiedCalls = ctx.calls.filter((call) => call.includes("verify-webhook-signature")).length;
    assert.equal(unverifiedCalls, baseline);

    const failed = await postWebhook(ctx.base, captureEvent(held), goodHeaders);
    assert.equal(failed.status, 401);
    assert.deepEqual(failed.body, { error: NOT_VERIFIED });
    assert.equal(
      ctx.calls.filter((call) => call.includes("verify-webhook-signature")).length,
      baseline + 1,
    );

    const after = await readDeal(ctx.base, held.id);
    assert.equal(after.status, "authorized");
    assert.equal(after.paypal.authorizationId, held.paypal.authorizationId);
    assert.equal(after.paypal.captureId, null);
    assert.equal(JSON.stringify(failed.body).includes(held.id), false);
    assert.equal(ctx.calls.some((call) => call.includes("/payments/authorizations/")), false);
  } finally {
    await ctx.stop();
  }
});

test("a verified capture is applied once and does not call PayPal capture", async () => {
  const ctx = await startSandbox({ webhookId: "WH-TEST", verifyStatus: "SUCCESS" });
  try {
    const created = await makeDeal(ctx.base);
    const held = await holdDeal(ctx.base, created.id);
    const event = captureEvent(held, "CAP-VERIFIED");

    const first = await postWebhook(ctx.base, event, goodHeaders);
    assert.equal(first.status, 200);
    const applied = first.body as { received: boolean; verified: string; matched: boolean; action: string };
    assert.equal(applied.received, true);
    assert.equal(applied.verified, "verified");
    assert.equal(applied.matched, true);
    assert.equal(applied.action, "captured");

    const captured = await readDeal(ctx.base, held.id);
    assert.equal(captured.status, "captured");
    assert.equal(captured.paypal.captureId, "CAP-VERIFIED");

    const replay = await postWebhook(ctx.base, event, {
      ...goodHeaders,
      "paypal-transmission-id": "tx-local-replay",
    });
    assert.equal(replay.status, 200);
    const again = await readDeal(ctx.base, held.id);
    assert.equal(again.status, "captured");
    assert.equal(again.paypal.captureId, "CAP-VERIFIED");
    assert.equal(again.events.length, captured.events.length);
    assert.equal(ctx.calls.some((call) => call.includes("/capture")), false);
  } finally {
    await ctx.stop();
  }
});

test("a verified approval authorizes once, and a verify outage applies nothing", async () => {
  const ok = await startSandbox({ webhookId: "WH-TEST", verifyStatus: "SUCCESS" });
  try {
    const created = await makeDeal(ok.base);
    const event = {
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: created.paypal.orderId, purchase_units: [{ custom_id: created.id }] },
    };
    const first = await postWebhook(ok.base, event, goodHeaders);
    assert.equal(first.status, 200);
    assert.equal((first.body as { action: string }).action, "authorized");
    const authorized = await readDeal(ok.base, created.id);
    assert.equal(authorized.status, "authorized");
    assert.ok(authorized.paypal.authorizationId);
    const authorizeCalls = ok.calls.filter((call) => call.endsWith("/authorize")).length;
    assert.equal(authorizeCalls, 1);

    const replay = await postWebhook(ok.base, event, {
      ...goodHeaders,
      "paypal-transmission-id": "tx-local-replay",
    });
    assert.equal(replay.status, 200);
    assert.equal(ok.calls.filter((call) => call.endsWith("/authorize")).length, authorizeCalls);
    const afterReplay = await readDeal(ok.base, created.id);
    assert.equal(afterReplay.status, "authorized");
    assert.equal(afterReplay.paypal.authorizationId, authorized.paypal.authorizationId);
  } finally {
    await ok.stop();
  }

  const down = await startSandbox({ webhookId: "WH-TEST", verifyStatus: "ERROR" });
  try {
    const created = await makeDeal(down.base);
    const callsBefore = down.calls.length;
    const response = await postWebhook(
      down.base,
      {
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: created.paypal.orderId, purchase_units: [{ custom_id: created.id }] },
      },
      goodHeaders,
    );
    assert.equal(response.status, 500);
    const after = await readDeal(down.base, created.id);
    assert.equal(after.status, "created");
    assert.equal(after.paypal.authorizationId, null);
    assert.equal(down.calls.filter((call) => call.endsWith("/authorize")).length, 0);
    assert.ok(down.calls.length > callsBefore);
  } finally {
    await down.stop();
  }
});

const goodHeaders = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST",
  "paypal-transmission-id": "tx-local-1",
  "paypal-transmission-sig": "sig-local",
  "paypal-transmission-time": "2026-11-07T00:00:00Z",
};

function captureEvent(deal: DealBody, captureId = "CAP-FORGED"): unknown {
  return {
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: captureId,
      supplementary_data: {
        related_ids: { order_id: deal.paypal.orderId, authorization_id: deal.paypal.authorizationId },
      },
    },
  };
}

function voidEvent(deal: DealBody): unknown {
  return {
    event_type: "PAYMENT.AUTHORIZATION.VOIDED",
    resource: {
      id: deal.paypal.authorizationId,
      supplementary_data: { related_ids: { order_id: deal.paypal.orderId } },
    },
  };
}

async function makeDeal(base: string): Promise<DealBody> {
  const created = await api(base, "/api/deals", { method: "POST", body: JSON.stringify(dealPayload()) });
  assert.equal(created.status, 201);
  const deal = created.body as DealBody;
  assert.equal(deal.status, "created");
  assert.equal(deal.paypal.mode, "sandbox");
  return deal;
}

async function holdDeal(base: string, id: string): Promise<DealBody> {
  const current = await readDeal(base, id);
  const returned = await fetch(
    `${base}/api/paypal/return?token=${current.paypal.orderId}&PayerID=PAYERTEST`,
    { redirect: "manual" },
  );
  assert.equal(returned.status, 302);
  const held = await readDeal(base, id);
  assert.equal(held.status, "authorized");
  assert.ok(held.paypal.authorizationId);
  return held;
}

async function readDeal(base: string, id: string): Promise<DealBody> {
  const response = await api(base, `/api/deals/${id}`);
  assert.equal(response.status, 200);
  return response.body as DealBody;
}

function postWebhook(base: string, event: unknown, headers?: Record<string, string>) {
  return api(base, "/api/paypal/webhook", {
    method: "POST",
    body: JSON.stringify(event),
    headers,
  });
}

function dealPayload() {
  return {
    prompt: "Consulting for $120. Freelancer is Bea Costa. Release when the notes are sent.",
    title: "Consulting notes",
    summary: "Hold the fee until the notes are sent.",
    amount: "120.00",
    currency: "USD",
    buyerName: "Buyer",
    freelancerName: "Bea Costa",
    dueDate: null,
    milestones: [{ title: "Notes sent", condition: "The notes are sent" }],
    riskNotes: [],
    missing: [],
    confidence: "medium",
    aiSource: "mock",
  };
}

async function startSandbox(options: { webhookId?: string; verifyStatus?: "SUCCESS" | "FAILURE" | "ERROR" }) {
  const dbPath = path.join(os.tmpdir(), `payguard-wh-${process.pid}-${randomBytes(4).toString("hex")}.json`);
  fs.rmSync(dbPath, { force: true });
  const calls: string[] = [];
  let sequence = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "tok_test", expires_in: 3600 });
    if (url.endsWith("/v2/checkout/orders")) {
      sequence += 1;
      const id = `ORDER${sequence}TEST`;
      return Response.json({
        id,
        status: "PAYER_ACTION_REQUIRED",
        links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }],
      });
    }
    if (url.includes("/v2/checkout/orders/") && url.endsWith("/authorize")) {
      const id = decodeURIComponent(url.split("/v2/checkout/orders/")[1]?.replace(/\/authorize$/, "") ?? "");
      return Response.json({
        id,
        status: "COMPLETED",
        purchase_units: [{ payments: { authorizations: [{ id: `AUTH${id}`, status: "CREATED" }] } }],
      });
    }
    if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
      if (options.verifyStatus === "ERROR") return Response.json({ message: "unavailable" }, { status: 500 });
      return Response.json({ verification_status: options.verifyStatus ?? "FAILURE" });
    }
    return Response.json({ id: "UNEXPECTED", status: "COMPLETED" }, { status: 500 });
  };
  const app = createApp({
    dbPath,
    paypalMode: "sandbox",
    aiMode: "mock",
    paypalClientId: "client-id",
    paypalClientSecret: "client-secret",
    paypalWebhookId: options.webhookId ?? "",
    openaiApiKey: "",
    fetchImpl,
    quiet: true,
    clientOrigin: "http://127.0.0.1:4318",
    publicBaseUrl: "http://127.0.0.1:4317",
  });
  const server = await listen(app);
  return {
    base: server.base,
    calls,
    async stop() {
      await server.close();
      fs.rmSync(dbPath, { force: true });
    },
  };
}

interface Health {
  paypal: string;
  webhookVerification: boolean;
}

interface DealBody {
  id: string;
  status: string;
  events: Array<{ status: string; note: string }>;
  paypal: {
    mode: string;
    orderId: string | null;
    authorizationId: string | null;
    captureId: string | null;
  };
}
