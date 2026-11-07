import { isPaypalCertHost, paypalErrorMessage, pickApprovalUrl, type PaypalProvider } from "./provider";

export interface SandboxConfig {
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  apiBase: string;
  publicBaseUrl: string;
  fetchImpl?: typeof fetch;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

export function createSandboxProvider(config: SandboxConfig): PaypalProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiBase = config.apiBase.replace(/\/$/, "");
  let token: TokenCache | null = null;

  async function getToken(force: boolean): Promise<string> {
    if (!force && token && token.expiresAt > Date.now() + 30_000) return token.value;
    const response = await fetchImpl(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(paypalErrorMessage(response.status, body, "could not sign in to the Sandbox."));
    }
    const access = typeof body.access_token === "string" ? body.access_token : "";
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 300;
    if (!access) throw new Error("PayPal did not return an access token.");
    token = { value: access, expiresAt: Date.now() + expiresIn * 1000 };
    return access;
  }

  async function paypal(path: string, requestId: string, init: { method: string; body?: string }): Promise<unknown> {
    const send = async (forceToken: boolean) => {
      const access = await getToken(forceToken);
      try {
        return await fetchImpl(`${apiBase}${path}`, {
          method: init.method,
          headers: {
            Authorization: `Bearer ${access}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "PayPal-Request-Id": requestId,
            Prefer: "return=representation",
          },
          body: init.body,
          signal: AbortSignal.timeout(25_000),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new Error("PayPal did not respond in time. Try again.");
        }
        throw error;
      }
    };

    let response = await send(false);
    if (response.status === 401) response = await send(true);
    if (response.status === 204) return {};
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(paypalErrorMessage(response.status, body, "rejected the request."));
    }
    return body;
  }

  return {
    mode: "sandbox",
    async createOrder(input, requestId) {
      // AUTHORIZE reserves funds. Capture or void happens later, which is the hold.
      // Orders v2 allows only one purchase unit when intent is AUTHORIZE.
      const body = await paypal("/v2/checkout/orders", requestId, {
        method: "POST",
        body: JSON.stringify({
          intent: "AUTHORIZE",
          purchase_units: [
            {
              reference_id: input.dealId.slice(0, 256),
              custom_id: input.customId.slice(0, 127),
              description: input.description.slice(0, 127),
              soft_descriptor: "PAYGUARD",
              amount: {
                currency_code: input.currency,
                value: input.amount,
              },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: "PayGuard",
                locale: "en-US",
                landing_page: "LOGIN",
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                return_url: `${config.publicBaseUrl}/api/paypal/return`,
                cancel_url: `${config.publicBaseUrl}/api/paypal/cancel`,
              },
            },
          },
        }),
      });
      const record = asRecord(body);
      const orderId = typeof record.id === "string" ? record.id : "";
      const approveUrl = pickApprovalUrl(readLinks(record.links));
      if (!orderId || !approveUrl) {
        throw new Error("PayPal created an order but did not return an approval link.");
      }
      return {
        orderId,
        orderStatus: typeof record.status === "string" ? record.status : "PAYER_ACTION_REQUIRED",
        approveUrl,
      };
    },
    async authorizeOrder(orderId, requestId) {
      const body = await paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, requestId, {
        method: "POST",
        body: "{}",
      });
      return readAuthorization(body);
    },
    async captureAuthorization(authorizationId, requestId) {
      const body = await paypal(
        `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
        requestId,
        { method: "POST", body: JSON.stringify({ final_capture: true }) },
      );
      const record = asRecord(body);
      const captureId = typeof record.id === "string" ? record.id : "";
      if (!captureId) throw new Error("PayPal captured the hold but did not return a capture id.");
      return {
        captureId,
        status: typeof record.status === "string" ? record.status : "COMPLETED",
      };
    },
    async voidAuthorization(authorizationId, requestId) {
      const body = await paypal(
        `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
        requestId,
        { method: "POST" },
      );
      const record = asRecord(body);
      return { status: typeof record.status === "string" ? record.status : "VOIDED" };
    },
    async verifyWebhook(headers, event) {
      // Missing configuration is not a successful check. Callers must fail closed.
      if (!config.webhookId) return false;
      const certUrl = headers["paypal-cert-url"];
      const transmissionId = headers["paypal-transmission-id"];
      const transmissionSig = headers["paypal-transmission-sig"];
      const transmissionTime = headers["paypal-transmission-time"];
      const authAlgo = headers["paypal-auth-algo"];
      if (!certUrl || !transmissionId || !transmissionSig || !transmissionTime || !authAlgo) return false;
      let hostname = "";
      try {
        const parsed = new URL(certUrl);
        if (parsed.protocol !== "https:") return false;
        hostname = parsed.hostname;
      } catch {
        return false;
      }
      if (!isPaypalCertHost(hostname)) return false;
      const body = await paypal("/v1/notifications/verify-webhook-signature", `wh-${transmissionId}`, {
        method: "POST",
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: config.webhookId,
          webhook_event: event,
        }),
      });
      return asRecord(body).verification_status === "SUCCESS";
    },
  };
}

function readAuthorization(body: unknown): {
  orderStatus: string;
  authorizationId: string;
  authorizationStatus: string;
} {
  const record = asRecord(body);
  const units = Array.isArray(record.purchase_units) ? record.purchase_units : [];
  for (const unit of units) {
    const payments = asRecord(asRecord(unit).payments);
    const authorizations = Array.isArray(payments.authorizations) ? payments.authorizations : [];
    const first = asRecord(authorizations[0]);
    if (typeof first.id === "string") {
      return {
        orderStatus: typeof record.status === "string" ? record.status : "COMPLETED",
        authorizationId: first.id,
        authorizationStatus: typeof first.status === "string" ? first.status : "CREATED",
      };
    }
  }
  throw new Error("PayPal authorized the order but did not return an authorization id.");
}

function readLinks(value: unknown): Array<{ href?: string; rel?: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      href: typeof record.href === "string" ? record.href : undefined,
      rel: typeof record.rel === "string" ? record.rel : undefined,
    };
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return { message: text.slice(0, 180) };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
