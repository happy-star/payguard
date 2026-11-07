import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { extractTerms, createChat, rewriteExplanation } from "./ai/openai";
import { resolveConfig, type AppOptions } from "./config";
import { createDealService } from "./deals";
import { errorMessage, HttpError } from "./http";
import { CURRENCIES, isValidDate, normalizeCurrency, parseAmount, toPaypalValue } from "./money";
import { createMockProvider } from "./paypal/mock";
import { createSandboxProvider } from "./paypal/sandbox";
import { samplePrompts } from "./samples";
import { DealStore, defaultDbPath } from "./store";

const milestoneSchema = z.object({
  title: z.string().trim().min(1, "Each milestone needs a title.").max(80),
  condition: z.string().trim().min(1, "Each milestone needs a condition the buyer can check.").max(300),
});

const createSchema = z.object({
  prompt: z.string().max(4000).optional().default(""),
  title: z.string().trim().min(1, "Add a title.").max(80),
  summary: z.string().trim().min(1, "Add a short summary.").max(500),
  amount: z.string().trim().min(1, "Add an amount."),
  currency: z.string().trim().min(3, "Choose a currency.").max(3),
  buyerName: z.string().trim().min(1, "Name the buyer.").max(80),
  freelancerName: z.string().trim().min(1, "Name the freelancer.").max(80),
  dueDate: z.union([z.string(), z.null()]).optional(),
  milestones: z.array(milestoneSchema).min(1, "Add at least one milestone.").max(4, "Use at most four milestones."),
  riskNotes: z.array(z.string().trim().min(1).max(300)).max(8).optional().default([]),
  missing: z.array(z.string().trim().max(140)).max(8).optional().default([]),
  confidence: z.enum(["high", "medium", "low"]).optional().default("medium"),
  aiSource: z.enum(["mock", "model", "mock-fallback"]).optional().default("mock"),
});

export function createApp(options: AppOptions = {}) {
  const config = resolveConfig(options);
  const store = new DealStore(config.dbPath || defaultDbPath());
  const mock = createMockProvider(config.clientOrigin);
  const sandbox =
    config.paypalClientId && config.paypalClientSecret
      ? createSandboxProvider({
          clientId: config.paypalClientId,
          clientSecret: config.paypalClientSecret,
          webhookId: config.paypalWebhookId || undefined,
          apiBase: config.paypalApiBase,
          publicBaseUrl: config.publicBaseUrl,
          fetchImpl: config.fetchImpl,
        })
      : unavailableSandbox();
  const chat =
    config.aiMode === "live"
      ? createChat({
          baseUrl: config.openaiBaseUrl,
          apiKey: config.openaiApiKey,
          model: config.openaiModel,
          fetchImpl: config.fetchImpl,
        })
      : undefined;
  const service = createDealService({
    store,
    paypalMode: config.paypalMode,
    clientOrigin: config.clientOrigin,
    providers: { mock, sandbox },
    rewrite: (deal) => rewriteExplanation(deal, config.aiMode, chat),
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === config.clientOrigin || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
    }),
  );
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "payguard",
      paypal: config.paypalMode,
      ai: config.aiMode,
      model: config.aiMode === "live" ? config.openaiModel : null,
      webhookVerification: config.webhookVerification,
      intent: "AUTHORIZE",
      currencies: CURRENCIES,
    });
  });

  app.get("/api/samples", (_req, res) => {
    res.json({ samples: samplePrompts });
  });

  app.post(
    "/api/extract",
    wrap(async (req, res) => {
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
      if (prompt.length < 8) throw new HttpError(400, "Describe the gig in at least a short sentence.");
      if (prompt.length > 4000) throw new HttpError(400, "Keep the description under 4000 characters.");
      const extraction = await extractTerms(prompt, config.aiMode, chat);
      res.json(extraction);
    }),
  );

  app.get("/api/deals", (_req, res) => {
    res.json({ deals: service.list() });
  });

  app.post(
    "/api/deals",
    wrap(async (req, res) => {
      const input = parseCreate(req.body);
      const deal = await service.create(input);
      res.status(201).json(deal);
    }),
  );

  app.post(
    "/api/demo/seed",
    wrap(async (_req, res) => {
      const deals = await service.seed();
      res.json({ deals });
    }),
  );

  app.get(
    "/api/deals/:id",
    wrap(async (req, res) => {
      res.json(service.get(paramId(req)));
    }),
  );

  app.post(
    "/api/deals/:id/order",
    wrap(async (req, res) => {
      res.json(await service.retryOrder(paramId(req)));
    }),
  );

  app.post(
    "/api/deals/:id/approve",
    wrap(async (req, res) => {
      res.json(await service.approveMock(paramId(req)));
    }),
  );

  app.post(
    "/api/deals/:id/authorize",
    wrap(async (req, res) => {
      res.json(await service.authorize(paramId(req), null));
    }),
  );

  app.post(
    "/api/deals/:id/capture",
    wrap(async (req, res) => {
      res.json(await service.capture(paramId(req)));
    }),
  );

  app.post(
    "/api/deals/:id/void",
    wrap(async (req, res) => {
      res.json(await service.voidHold(paramId(req)));
    }),
  );

  app.post(
    "/api/deals/:id/cancel",
    wrap(async (req, res) => {
      res.json(await service.cancel(paramId(req)));
    }),
  );

  app.post(
    "/api/deals/:id/explain",
    wrap(async (req, res) => {
      res.json(await service.explain(paramId(req)));
    }),
  );

  app.post(
    "/api/deals/:id/milestones/:milestoneId",
    wrap(async (req, res) => {
      const parsed = z.object({ done: z.boolean() }).safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Say whether the milestone is done.");
      const milestoneId = req.params.milestoneId;
      if (!milestoneId) throw new HttpError(404, "That milestone is not on this deal.");
      res.json(await service.setMilestone(paramId(req), milestoneId, parsed.data.done));
    }),
  );

  app.get(
    "/api/paypal/return",
    wrap(async (req, res) => {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const payerId = typeof req.query.PayerID === "string" ? req.query.PayerID : null;
      const deal = token ? store.findByOrderId(token) : undefined;
      if (!deal) {
        redirect(res, config.clientOrigin, "/deals?error=PayPal%20returned%20an%20order%20PayGuard%20does%20not%20know.");
        return;
      }
      try {
        await service.authorize(deal.id, payerId);
        redirect(res, config.clientOrigin, `/deals/${deal.id}?returned=1`);
      } catch (error) {
        redirect(res, config.clientOrigin, `/deals/${deal.id}?error=${encodeURIComponent(errorMessage(error))}`);
      }
    }),
  );

  app.get(
    "/api/paypal/cancel",
    wrap(async (req, res) => {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const deal = token ? store.findByOrderId(token) : undefined;
      if (!deal) {
        redirect(
          res,
          config.clientOrigin,
          `/deals?error=${encodeURIComponent("The PayPal approval was cancelled before it could be matched to a deal.")}`,
        );
        return;
      }
      try {
        if (deal.status === "created" || deal.status === "approved") await service.cancel(deal.id);
        redirect(res, config.clientOrigin, `/deals/${deal.id}?cancelled=1`);
      } catch (error) {
        redirect(res, config.clientOrigin, `/deals/${deal.id}?error=${encodeURIComponent(errorMessage(error))}`);
      }
    }),
  );

  app.post(
    "/api/paypal/webhook",
    wrap(async (req, res) => {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        throw new HttpError(400, "Webhook body must be a JSON object.");
      }
      // Sandbox events can authorize a real order or mark a hold captured or voided.
      // Apply them only after PayPal has verified the signature. Mock mode has no signature.
      if (config.paypalMode === "sandbox") {
        if (!config.webhookVerification) {
          res.status(503).json({
            error:
              "PayPal webhook verification is not configured. Set PAYPAL_WEBHOOK_ID. The event was not applied.",
          });
          return;
        }
        const ok = await sandbox.verifyWebhook(paypalHeaders(req), req.body);
        if (!ok) {
          res.status(401).json({
            error: "PayPal webhook signature was not verified. The event was not applied.",
          });
          return;
        }
        const result = await service.applyWebhook(req.body);
        res.json({ received: true, verified: "verified", ...result });
        return;
      }
      const result = await service.applyWebhook(req.body);
      res.json({ received: true, verified: "skipped", ...result });
    }),
  );

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "That API route does not exist." });
  });

  if (config.serveStatic) {
    const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.use((req, res, next) => {
        if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
          next();
          return;
        }
        res.sendFile(path.join(clientDist, "index.html"));
      });
    } else if (!config.quiet) {
      console.warn(`SERVE_STATIC is set, but ${clientDist} does not exist. Run npm run build first.`);
    }
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "Request body must be JSON." });
      return;
    }
    if (!config.quiet) console.error(error);
    res.status(500).json({ error: "Something went wrong in PayGuard." });
  });

  return app;
}

function parseCreate(body: unknown) {
  if (body && typeof body === "object" && "dueDate" in body) {
    const record = body as { dueDate?: unknown };
    if (record.dueDate === "") record.dueDate = null;
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).slice(0, 3).join(" "));
  }
  let currency = "";
  let amount = "";
  try {
    currency = normalizeCurrency(parsed.data.currency);
    amount = toPaypalValue(parseAmount(parsed.data.amount), currency);
  } catch (error) {
    throw new HttpError(400, errorMessage(error));
  }
  const dueDate = parsed.data.dueDate ?? null;
  if (dueDate && !isValidDate(dueDate)) {
    throw new HttpError(400, "Due date must be a real calendar day, written YYYY-MM-DD.");
  }
  return { ...parsed.data, amount, currency, dueDate };
}

function paramId(req: Request): string {
  const id = req.params.id;
  if (!id || !/^pg_[a-z0-9_]+$/i.test(id)) throw new HttpError(404, "No deal with that id.");
  return id;
}

function paypalHeaders(req: Request): Record<string, string | undefined> {
  return {
    "paypal-auth-algo": req.get("paypal-auth-algo") ?? undefined,
    "paypal-cert-url": req.get("paypal-cert-url") ?? undefined,
    "paypal-transmission-id": req.get("paypal-transmission-id") ?? undefined,
    "paypal-transmission-sig": req.get("paypal-transmission-sig") ?? undefined,
    "paypal-transmission-time": req.get("paypal-transmission-time") ?? undefined,
  };
}

function redirect(res: Response, origin: string, pathAndQuery: string) {
  res.redirect(302, `${origin}${pathAndQuery}`);
}

function wrap(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function unavailableSandbox() {
  const fail = async () => {
    throw new Error("PayPal Sandbox credentials are not configured.");
  };
  return {
    mode: "sandbox" as const,
    createOrder: fail,
    authorizeOrder: fail,
    captureAuthorization: fail,
    voidAuthorization: fail,
    verifyWebhook: async () => false,
  };
}
