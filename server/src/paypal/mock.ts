import { createHash } from "node:crypto";
import type { PaypalProvider } from "./provider";

export function mockIds(dealId: string): {
  orderId: string;
  authorizationId: string;
  captureId: string;
  payerId: string;
} {
  const digest = (label: string) =>
    createHash("sha256").update(`${label}:${dealId}`).digest("hex").toUpperCase().slice(0, 12);
  return {
    orderId: `MOCK${digest("order")}`,
    authorizationId: `AUTH${digest("auth")}`,
    captureId: `CAP${digest("cap")}`,
    payerId: `PAYER${digest("payer").slice(0, 8)}`,
  };
}

export function createMockProvider(clientOrigin: string): PaypalProvider {
  return {
    mode: "mock",
    async createOrder(input) {
      const ids = mockIds(input.dealId);
      return {
        orderId: ids.orderId,
        orderStatus: "PAYER_ACTION_REQUIRED",
        approveUrl: `${clientOrigin}/checkout/${input.dealId}`,
      };
    },
    async authorizeOrder() {
      return {
        orderStatus: "COMPLETED",
        authorizationId: "",
        authorizationStatus: "CREATED",
      };
    },
    async captureAuthorization() {
      return { captureId: "", status: "COMPLETED" };
    },
    async voidAuthorization() {
      return { status: "VOIDED" };
    },
    async verifyWebhook() {
      // Mock mode has no PayPal signature. Never report one of these events as verified.
      return false;
    },
  };
}

export function mockAuthorize(dealId: string) {
  const ids = mockIds(dealId);
  return {
    orderStatus: "COMPLETED",
    authorizationId: ids.authorizationId,
    authorizationStatus: "CREATED",
    payerId: ids.payerId,
  };
}

export function mockCapture(dealId: string) {
  return { captureId: mockIds(dealId).captureId, status: "COMPLETED" };
}
