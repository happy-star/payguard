export interface OrderInput {
  dealId: string;
  amount: string;
  currency: string;
  description: string;
  customId: string;
}

export interface CreatedOrder {
  orderId: string;
  orderStatus: string;
  approveUrl: string;
}

export interface AuthorizedOrder {
  orderStatus: string;
  authorizationId: string;
  authorizationStatus: string;
}

export interface CapturedPayment {
  captureId: string;
  status: string;
}

export interface PaypalProvider {
  mode: "mock" | "sandbox";
  createOrder(input: OrderInput, requestId: string): Promise<CreatedOrder>;
  authorizeOrder(orderId: string, requestId: string): Promise<AuthorizedOrder>;
  captureAuthorization(authorizationId: string, requestId: string): Promise<CapturedPayment>;
  voidAuthorization(authorizationId: string, requestId: string): Promise<{ status: string }>;
  verifyWebhook(headers: Record<string, string | undefined>, event: unknown): Promise<boolean>;
}

export interface PaypalLink {
  href?: string;
  rel?: string;
}

const APPROVAL_RELS = ["payer-action", "approve", "approval_url"];

export function pickApprovalUrl(links: PaypalLink[] | undefined): string | null {
  if (!links) return null;
  for (const rel of APPROVAL_RELS) {
    const hit = links.find((link) => link.rel === rel && link.href);
    if (hit?.href) return hit.href;
  }
  return null;
}

export function paypalErrorMessage(status: number, body: unknown, fallback: string): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const details = Array.isArray(record.details) ? record.details : [];
  const first = details[0];
  if (first && typeof first === "object") {
    const detail = first as Record<string, unknown>;
    const issue = typeof detail.issue === "string" ? detail.issue : "";
    const description = typeof detail.description === "string" ? detail.description : "";
    const combined = [issue, description].filter(Boolean).join(": ");
    if (combined) return `PayPal ${status} ${combined}`;
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return `PayPal ${status} ${record.message.trim()}`;
  }
  if (typeof record.error_description === "string") {
    return `PayPal ${status} ${record.error_description}`;
  }
  return `PayPal ${status} ${fallback}`;
}

export function isPaypalCertHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "paypal.com" || normalized.endsWith(".paypal.com");
}
