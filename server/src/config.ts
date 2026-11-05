import type { AiMode, PaypalMode } from "./types";

export interface AppOptions {
  dbPath?: string;
  paypalMode?: "mock" | "sandbox" | "auto";
  aiMode?: "mock" | "live" | "auto";
  clientOrigin?: string;
  publicBaseUrl?: string;
  port?: number;
  paypalClientId?: string;
  paypalClientSecret?: string;
  paypalWebhookId?: string;
  paypalApiBase?: string;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  fetchImpl?: typeof fetch;
  serveStatic?: boolean;
  quiet?: boolean;
}

export interface AppConfig {
  dbPath: string;
  port: number;
  paypalMode: PaypalMode;
  aiMode: AiMode;
  clientOrigin: string;
  publicBaseUrl: string;
  paypalClientId: string;
  paypalClientSecret: string;
  paypalWebhookId: string;
  paypalApiBase: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  fetchImpl?: typeof fetch;
  serveStatic: boolean;
  quiet: boolean;
  webhookVerification: boolean;
}

export function resolveConfig(options: AppOptions = {}): AppConfig {
  const port = Number(options.port ?? process.env.PORT ?? 4317);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be a whole number between 1 and 65535.");
  }

  const paypalClientId = value(options.paypalClientId, "PAYPAL_CLIENT_ID");
  const paypalClientSecret = value(options.paypalClientSecret, "PAYPAL_CLIENT_SECRET");
  const hasPaypal = Boolean(paypalClientId && paypalClientSecret);
  const paypalMode = resolvePaypalMode(options.paypalMode ?? envOr("PAYGUARD_PAYPAL", "auto"), hasPaypal);

  const openaiApiKey = value(options.openaiApiKey, "OPENAI_API_KEY");
  const aiMode = resolveAiMode(options.aiMode ?? envOr("PAYGUARD_AI", "auto"), Boolean(openaiApiKey));

  const serveStatic = options.serveStatic ?? process.env.SERVE_STATIC === "1";
  const publicBaseUrl = stripSlash(
    options.publicBaseUrl ?? envOr("PUBLIC_BASE_URL", `http://127.0.0.1:${port}`),
  );
  const clientOrigin = stripSlash(
    options.clientOrigin ?? envOr("CLIENT_ORIGIN", serveStatic ? publicBaseUrl : "http://127.0.0.1:4318"),
  );
  const paypalWebhookId = value(options.paypalWebhookId, "PAYPAL_WEBHOOK_ID");

  return {
    dbPath: options.dbPath ?? envOr("PAYGUARD_DB", ""),
    port,
    paypalMode,
    aiMode,
    clientOrigin,
    publicBaseUrl,
    paypalClientId,
    paypalClientSecret,
    paypalWebhookId,
    paypalApiBase: stripSlash(
      options.paypalApiBase ?? envOr("PAYPAL_API_BASE", "https://api-m.sandbox.paypal.com"),
    ),
    openaiBaseUrl: stripSlash(options.openaiBaseUrl ?? envOr("OPENAI_BASE_URL", "https://api.openai.com/v1")),
    openaiApiKey,
    openaiModel: options.openaiModel ?? envOr("OPENAI_MODEL", "gpt-4o-mini"),
    fetchImpl: options.fetchImpl,
    serveStatic,
    quiet: options.quiet ?? false,
    webhookVerification: paypalMode === "sandbox" && Boolean(paypalWebhookId),
  };
}

function resolvePaypalMode(requested: string, hasCreds: boolean): PaypalMode {
  const mode = requested.toLowerCase();
  if (mode === "mock") return "mock";
  if (mode === "sandbox") {
    if (!hasCreds) {
      throw new Error("PAYGUARD_PAYPAL=sandbox requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
    }
    return "sandbox";
  }
  if (mode !== "auto") throw new Error("PAYGUARD_PAYPAL must be auto, mock, or sandbox.");
  return hasCreds ? "sandbox" : "mock";
}

function resolveAiMode(requested: string, hasKey: boolean): AiMode {
  const mode = requested.toLowerCase();
  if (mode === "mock") return "mock";
  if (mode === "live") {
    if (!hasKey) throw new Error("PAYGUARD_AI=live requires OPENAI_API_KEY.");
    return "live";
  }
  if (mode !== "auto") throw new Error("PAYGUARD_AI must be auto, mock, or live.");
  return hasKey ? "live" : "mock";
}

function value(override: string | undefined, envName: string): string {
  if (override !== undefined) return override.trim();
  return process.env[envName]?.trim() ?? "";
}

function envOr(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
}

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}
