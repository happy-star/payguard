import assert from "node:assert/strict";
import test from "node:test";
import { createSandboxProvider } from "../src/paypal/sandbox";

test("Sandbox create order uses AUTHORIZE, no shipping, and a return url", async () => {
  const calls: Array<{ url: string; method: string; body: unknown; authorization: string }> = [];
  let orderAttempts = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = headersOf(init);
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    calls.push({ url, method: init?.method ?? "GET", body, authorization: headers.Authorization ?? "" });
    if (url.endsWith("/v1/oauth2/token")) {
      return Response.json({ access_token: "tok_test", expires_in: 3600 });
    }
    if (url.endsWith("/v2/checkout/orders")) {
      orderAttempts += 1;
      if (orderAttempts === 1) return Response.json({ message: "expired" }, { status: 401 });
      return Response.json({
        id: "5O190127TN364715T",
        status: "PAYER_ACTION_REQUIRED",
        links: [{ href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", rel: "payer-action" }],
      });
    }
    return Response.json({ message: "unexpected" }, { status: 500 });
  };

  const paypal = createSandboxProvider({
    clientId: "client-id",
    clientSecret: "client-secret",
    apiBase: "https://api-m.sandbox.paypal.com",
    publicBaseUrl: "http://127.0.0.1:4317",
    fetchImpl,
  });
  const order = await paypal.createOrder(
    { dealId: "pg_abc", amount: "1800.00", currency: "USD", description: "Homepage", customId: "pg_abc" },
    "req-1",
  );

  assert.equal(order.orderId, "5O190127TN364715T");
  assert.match(order.approveUrl, /sandbox\.paypal\.com/);
  const tokenCalls = calls.filter((call) => call.url.endsWith("/oauth2/token"));
  assert.equal(tokenCalls.length, 2);
  const basic = Buffer.from(tokenCalls[0]?.authorization.replace("Basic ", "") ?? "", "base64").toString();
  assert.equal(basic, "client-id:client-secret");
  const created = calls.filter((call) => call.url.endsWith("/v2/checkout/orders")).at(-1);
  const payload = created?.body as {
    intent: string;
    purchase_units: Array<{ custom_id: string; amount: { value: string } }>;
    payment_source: { paypal: { experience_context: { shipping_preference: string; return_url: string } } };
  };
  assert.equal(payload.intent, "AUTHORIZE");
  assert.equal(payload.purchase_units[0]?.custom_id, "pg_abc");
  assert.equal(payload.purchase_units[0]?.amount.value, "1800.00");
  assert.equal(payload.payment_source.paypal.experience_context.shipping_preference, "NO_SHIPPING");
  assert.equal(
    payload.payment_source.paypal.experience_context.return_url,
    "http://127.0.0.1:4317/api/paypal/return",
  );
  assert.equal(calls.filter((call) => call.url.endsWith("/v2/checkout/orders")).length, 2);
});

test("webhook verification rejects certificates that are not from PayPal", async () => {
  let verifyCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 60 });
    verifyCalls += 1;
    return Response.json({ verification_status: "SUCCESS" });
  };
  const paypal = createSandboxProvider({
    clientId: "id",
    clientSecret: "secret",
    webhookId: "WH-123",
    apiBase: "https://api-m.sandbox.paypal.com",
    publicBaseUrl: "http://127.0.0.1:4317",
    fetchImpl,
  });
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://evil.example/cert.pem",
    "paypal-transmission-id": "tx",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-11-05T00:00:00Z",
  };
  assert.equal(await paypal.verifyWebhook(headers, { event_type: "CHECKOUT.ORDER.APPROVED" }), false);
  assert.equal(verifyCalls, 0);
  assert.equal(
    await paypal.verifyWebhook(
      { ...headers, "paypal-cert-url": "http://api.sandbox.paypal.com/v1/notifications/certs/CERT" },
      { event_type: "CHECKOUT.ORDER.APPROVED" },
    ),
    false,
  );
  assert.equal(verifyCalls, 0);
  assert.equal(
    await paypal.verifyWebhook(
      { ...headers, "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT" },
      { event_type: "CHECKOUT.ORDER.APPROVED" },
    ),
    true,
  );
  assert.equal(verifyCalls, 1);
});

test("webhook verification fails closed without a webhook id and does not call PayPal", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return Response.json({ verification_status: "SUCCESS" });
  };
  const paypal = createSandboxProvider({
    clientId: "id",
    clientSecret: "secret",
    apiBase: "https://api-m.sandbox.paypal.com",
    publicBaseUrl: "http://127.0.0.1:4317",
    fetchImpl,
  });
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
    "paypal-transmission-id": "tx",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-11-05T00:00:00Z",
  };
  assert.equal(await paypal.verifyWebhook(headers, { event_type: "PAYMENT.CAPTURE.COMPLETED" }), false);
  assert.equal(calls, 0);
});

test("webhook verification rejects a PayPal FAILURE status", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 60 });
    return Response.json({ verification_status: "FAILURE" });
  };
  const paypal = createSandboxProvider({
    clientId: "id",
    clientSecret: "secret",
    webhookId: "WH-123",
    apiBase: "https://api-m.sandbox.paypal.com",
    publicBaseUrl: "http://127.0.0.1:4317",
    fetchImpl,
  });
  assert.equal(
    await paypal.verifyWebhook(
      {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
        "paypal-transmission-id": "tx",
        "paypal-transmission-sig": "sig",
        "paypal-transmission-time": "2026-11-05T00:00:00Z",
      },
      { event_type: "PAYMENT.AUTHORIZATION.VOIDED" },
    ),
    false,
  );
});

function headersOf(init?: RequestInit): Record<string, string> {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return {};
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}
