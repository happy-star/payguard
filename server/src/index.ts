import { createApp } from "./createApp";
import { resolveConfig } from "./config";
import { loadEnv } from "./loadEnv";

loadEnv();

const config = resolveConfig();
const app = createApp();

app.listen(config.port, "0.0.0.0", () => {
  const paypal =
    config.paypalMode === "sandbox"
      ? "PayPal Sandbox (new holds call Orders v2 with intent AUTHORIZE)"
      : "PayPal mock (set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to use Sandbox)";
  const ai =
    config.aiMode === "live"
      ? `AI live (${config.openaiModel})`
      : "AI mock (set OPENAI_API_KEY to use an OpenAI-compatible model)";
  console.log(`PayGuard API listening on http://127.0.0.1:${config.port}`);
  console.log(paypal);
  console.log(ai);
  if (config.paypalMode === "sandbox" && !config.webhookVerification) {
    console.log("Sandbox webhooks are rejected until PAYPAL_WEBHOOK_ID is set.");
  }
  if (!config.serveStatic) {
    console.log(`UI dev server expected at ${config.clientOrigin}`);
  }
});
