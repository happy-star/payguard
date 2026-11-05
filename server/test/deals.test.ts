import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../src/createApp";
import { samplePrompts } from "../src/samples";
import { api, listen } from "./helpers";

const dbPath = path.join(os.tmpdir(), `payguard-${process.pid}-flow.json`);
let base = "";
let closeServer: () => Promise<void> = async () => {};

before(async () => {
  fs.rmSync(dbPath, { force: true });
  const app = createApp({
    dbPath,
    paypalMode: "mock",
    aiMode: "mock",
    paypalClientId: "",
    paypalClientSecret: "",
    openaiApiKey: "",
    clientOrigin: "http://127.0.0.1:4318",
    publicBaseUrl: "http://127.0.0.1:4317",
    quiet: true,
  });
  const server = await listen(app);
  base = server.base;
  closeServer = server.close;
});

after(async () => {
  await closeServer();
  fs.rmSync(dbPath, { force: true });
});

test("health reports mock mode and does not leak secrets", async () => {
  const health = await api(base, "/api/health");
  assert.equal(health.status, 200);
  const body = health.body as { paypal: string; ai: string; intent: string; model: string | null };
  assert.equal(body.paypal, "mock");
  assert.equal(body.ai, "mock");
  assert.equal(body.intent, "AUTHORIZE");
  assert.equal(body.model, null);
  assert.equal(JSON.stringify(health.body).includes("secret"), false);
});

test("extract, create, approve, release, and explain a hold", async () => {
  const prompt = samplePrompts[0]?.prompt ?? "";
  const extracted = await api(base, "/api/extract", { method: "POST", body: JSON.stringify({ prompt }) });
  assert.equal(extracted.status, 200);
  const terms = extracted.body as {
    title: string;
    summary: string;
    amount: string;
    currency: string;
    buyerName: string;
    freelancerName: string;
    dueDate: string;
    milestones: Array<{ title: string; condition: string }>;
    riskNotes: string[];
    missing: string[];
    confidence: string;
    aiSource: string;
  };
  assert.equal(terms.amount, "1800.00");
  assert.equal(terms.aiSource, "mock");

  const created = await api(base, "/api/deals", {
    method: "POST",
    body: JSON.stringify({ ...terms, prompt }),
  });
  assert.equal(created.status, 201);
  const deal = created.body as DealBody;
  assert.equal(deal.status, "created");
  assert.equal(deal.paypal.mode, "mock");
  assert.match(deal.paypal.approveUrl ?? "", /\/checkout\/pg_/);
  assert.match(deal.explanation, /Nothing is reserved yet/);

  const tooSoon = await api(base, `/api/deals/${deal.id}/capture`, { method: "POST", body: "{}" });
  assert.equal(tooSoon.status, 409);

  const approved = await api(base, `/api/deals/${deal.id}/approve`, { method: "POST", body: "{}" });
  assert.equal(approved.status, 200);
  const held = approved.body as DealBody;
  assert.equal(held.status, "authorized");
  assert.ok(held.paypal.authorizationId);
  assert.match(held.explanation, /on hold/i);
  assert.match(held.explanation, /29 days/);

  const milestone = held.milestones[0];
  assert.ok(milestone);
  const checked = await api(base, `/api/deals/${deal.id}/milestones/${milestone.id}`, {
    method: "POST",
    body: JSON.stringify({ done: true }),
  });
  assert.equal(checked.status, 200);
  assert.equal((checked.body as DealBody).milestones[0]?.done, true);

  const released = await api(base, `/api/deals/${deal.id}/capture`, { method: "POST", body: "{}" });
  assert.equal(released.status, 200);
  assert.equal((released.body as DealBody).status, "captured");
  assert.ok((released.body as DealBody).paypal.captureId);

  const again = await api(base, `/api/deals/${deal.id}/capture`, { method: "POST", body: "{}" });
  assert.equal(again.status, 409);

  const explained = await api(base, `/api/deals/${deal.id}/explain`, { method: "POST", body: "{}" });
  assert.match((explained.body as DealBody).explanation, /Next step:/);
});

test("void and cancel are separate endings", async () => {
  const made = await makeDeal("Poster design for $90. Freelancer is Bea Costa. Release when the PDF is delivered.");
  const held = await api(base, `/api/deals/${made.id}/approve`, { method: "POST", body: "{}" });
  const voided = await api(base, `/api/deals/${made.id}/void`, { method: "POST", body: "{}" });
  assert.equal(voided.status, 200);
  assert.equal((voided.body as DealBody).status, "voided");

  const second = await makeDeal("A logo for $60. Freelancer is Bea Costa. Release when two concepts are posted.");
  const returned = await fetch(
    `${base}/api/paypal/return?token=${second.paypal.orderId}&PayerID=PAYERTEST`,
    { redirect: "manual" },
  );
  assert.equal(returned.status, 302);
  assert.match(returned.headers.get("location") ?? "", new RegExp(`/deals/${second.id}\\?returned=1`));
  const afterReturn = await api(base, `/api/deals/${second.id}`);
  assert.equal((afterReturn.body as DealBody).status, "authorized");
  assert.equal((afterReturn.body as DealBody).paypal.payerId, "PAYERTEST");

  const third = await makeDeal("A banner for $30. Freelancer is Bea Costa. Release when it is exported.");
  const cancelled = await fetch(`${base}/api/paypal/cancel?token=${third.paypal.orderId}`, { redirect: "manual" });
  assert.equal(cancelled.status, 302);
  const afterCancel = await api(base, `/api/deals/${third.id}`);
  assert.equal((afterCancel.body as DealBody).status, "cancelled");
});

test("an approved webhook authorizes a mock order", async () => {
  const made = await makeDeal("Icons for $75. Freelancer is Bea Costa. Release when the set is in the folder.");
  const webhook = await api(base, "/api/paypal/webhook", {
    method: "POST",
    body: JSON.stringify({
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: {
        id: made.paypal.orderId,
        purchase_units: [{ custom_id: made.id }],
      },
    }),
  });
  assert.equal(webhook.status, 200);
  const body = webhook.body as { matched: boolean; action: string; verified: string };
  assert.equal(body.matched, true);
  assert.equal(body.action, "authorized");
  assert.equal(body.verified, "skipped");
  const deal = await api(base, `/api/deals/${made.id}`);
  assert.equal((deal.body as DealBody).status, "authorized");
});

test("seed is idempotent and invalid deals are rejected", async () => {
  const first = await api(base, "/api/demo/seed", { method: "POST", body: "{}" });
  const second = await api(base, "/api/demo/seed", { method: "POST", body: "{}" });
  const list = await api(base, "/api/deals");
  const deals = (list.body as { deals: DealBody[] }).deals;
  const seeds = deals.filter((deal) => deal.id.startsWith("pg_seed_"));
  assert.equal(seeds.length, 3);
  assert.equal((first.body as { deals: DealBody[] }).deals.length, 3);
  assert.equal((second.body as { deals: DealBody[] }).deals.length, 3);
  assert.ok(seeds.some((deal) => deal.status === "authorized"));
  assert.ok(seeds.some((deal) => deal.status === "captured"));
  assert.ok(seeds.some((deal) => deal.status === "created"));

  const bad = await api(base, "/api/deals", {
    method: "POST",
    body: JSON.stringify({ title: "Missing money", currency: "USD", milestones: [] }),
  });
  assert.equal(bad.status, 400);
  const unknown = await api(base, "/api/deals/pg_missing");
  assert.equal(unknown.status, 404);
});

test("Sandbox failures are saved on the deal and a retry can succeed", async () => {
  const sandboxDb = path.join(os.tmpdir(), `payguard-${process.pid}-sandbox.json`);
  fs.rmSync(sandboxDb, { force: true });
  let creates = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 300 });
    if (url.endsWith("/v2/checkout/orders")) {
      creates += 1;
      if (creates === 1) {
        return Response.json(
          { details: [{ issue: "CURRENCY_NOT_SUPPORTED", description: "The currency is not allowed." }] },
          { status: 422 },
        );
      }
      return Response.json({
        id: "5O190127TN364715T",
        status: "PAYER_ACTION_REQUIRED",
        links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" }],
      });
    }
    return Response.json({ message: `unexpected ${url} ${init?.method}` }, { status: 500 });
  };
  const app = createApp({
    dbPath: sandboxDb,
    paypalMode: "sandbox",
    aiMode: "mock",
    paypalClientId: "client-id",
    paypalClientSecret: "client-secret",
    openaiApiKey: "",
    fetchImpl,
    quiet: true,
    clientOrigin: "http://127.0.0.1:4318",
    publicBaseUrl: "http://127.0.0.1:4999",
  });
  const server = await listen(app);
  try {
    const created = await api(server.base, "/api/deals", {
      method: "POST",
      body: JSON.stringify(dealPayload("Consulting for $120. Freelancer is Bea Costa. Release when the notes are sent.")),
    });
    assert.equal(created.status, 201);
    const failed = created.body as DealBody;
    assert.equal(failed.status, "failed");
    assert.match(failed.paypal.lastError ?? "", /CURRENCY_NOT_SUPPORTED/);
    const retried = await api(server.base, `/api/deals/${failed.id}/order`, { method: "POST", body: "{}" });
    assert.equal(retried.status, 200);
    const recovered = retried.body as DealBody;
    assert.equal(recovered.status, "created");
    assert.equal(recovered.paypal.orderId, "5O190127TN364715T");
    assert.equal(recovered.paypal.mode, "sandbox");
  } finally {
    await server.close();
    fs.rmSync(sandboxDb, { force: true });
  }
});

async function makeDeal(prompt: string): Promise<DealBody> {
  const extracted = await api(base, "/api/extract", { method: "POST", body: JSON.stringify({ prompt }) });
  assert.equal(extracted.status, 200);
  const created = await api(base, "/api/deals", {
    method: "POST",
    body: JSON.stringify({ ...(extracted.body as object), prompt }),
  });
  assert.equal(created.status, 201);
  return created.body as DealBody;
}

function dealPayload(prompt: string) {
  return {
    prompt,
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

interface DealBody {
  id: string;
  status: string;
  explanation: string;
  paypal: {
    mode: string;
    orderId: string | null;
    authorizationId: string | null;
    captureId: string | null;
    approveUrl: string | null;
    payerId: string | null;
    lastError: string | null;
  };
  milestones: Array<{ id: string; done: boolean }>;
}
