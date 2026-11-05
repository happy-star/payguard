import { mockExtract } from "./mockExtract";
import { explainDeal, mockRewrite } from "./explain";
import { isValidDate, normalizeCurrency, parseAmount, toPaypalValue } from "../money";
import type { AiMode, Deal, Extraction, MilestoneDraft } from "../types";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface OpenAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export function createChat(config: OpenAiConfig) {
  return async function chat(messages: ChatMessage[], jsonMode: boolean): Promise<string> {
    const run = async (asJson: boolean) => {
      const body: Record<string, unknown> = {
        model: config.model,
        temperature: 0.1,
        messages,
      };
      if (asJson) body.response_format = { type: "json_object" };
      const response = await (config.fetchImpl ?? fetch)(
        `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        },
      );
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Model request failed (${response.status}). ${text.slice(0, 180)}`);
      }
      const parsed = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("The model returned an empty response.");
      }
      return content;
    };

    try {
      return await run(jsonMode);
    } catch (error) {
      if (jsonMode && error instanceof Error && /\(400\)/.test(error.message)) {
        return run(false);
      }
      throw error;
    }
  };
}

export function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* try fenced or sliced JSON */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return JSON.parse(fenced[1]);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("The model did not return JSON.");
}

export async function extractTerms(
  prompt: string,
  mode: AiMode,
  chat?: (messages: ChatMessage[], jsonMode: boolean) => Promise<string>,
  now = new Date(),
): Promise<Extraction> {
  const fallback = mockExtract(prompt, now);
  if (mode !== "live" || !chat) return fallback;
  try {
    const content = await chat(
      [
        {
          role: "system",
          content: extractionSystemPrompt(now),
        },
        { role: "user", content: prompt },
      ],
      true,
    );
    const parsed = extractionFromModel(parseJsonContent(content));
    return { ...parsed, aiSource: "model" };
  } catch {
    const note =
      "The model did not return usable terms, so PayGuard used its built-in reader. Check every field before creating a hold.";
    return {
      ...fallback,
      aiSource: "mock-fallback",
      riskNotes: [note, ...fallback.riskNotes].slice(0, 8),
    };
  }
}

export async function rewriteExplanation(
  deal: Deal,
  mode: AiMode,
  chat?: (messages: ChatMessage[], jsonMode: boolean) => Promise<string>,
): Promise<string> {
  const fallback = mockRewrite(deal);
  if (mode !== "live" || !chat) return fallback;
  try {
    const content = await chat(
      [
        {
          role: "system",
          content:
            "You explain a PayPal authorization hold to a freelancer and a buyer. Write 2 or 3 plain sentences. No markdown, no bullet list. Do not invent amounts, names, or PayPal ids. Use only the JSON facts. State what the status means and the single next action. AUTHORIZE reserves funds. Capture pays them out. Void releases the hold. PayPal honors an authorization for 3 days and allows capture for up to 29 days.",
        },
        {
          role: "user",
          content: JSON.stringify({
            status: deal.status,
            amount: deal.amount,
            currency: deal.currency,
            title: deal.title,
            buyer: deal.buyerName,
            freelancer: deal.freelancerName,
            milestones: deal.milestones,
            paypal: deal.paypal,
            groundedFacts: explainDeal(deal),
          }),
        },
      ],
      false,
    );
    const text = content.trim().replace(/^["']|["']$/g, "");
    if (text.length < 40 || text.length > 900 || text.startsWith("{")) return fallback;
    return text;
  } catch {
    return fallback;
  }
}

function extractionSystemPrompt(now: Date): string {
  const today = now.toISOString().slice(0, 10);
  return [
    "You extract a freelance milestone hold from a natural-language gig description.",
    "Return one JSON object and nothing else.",
    "Shape:",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "amount": string or null,',
    '  "currency": string,',
    '  "buyerName": string,',
    '  "freelancerName": string,',
    '  "dueDate": "YYYY-MM-DD" or null,',
    '  "milestones": [{"title": string, "condition": string}],',
    '  "riskNotes": string[],',
    '  "missing": string[],',
    '  "confidence": "high" | "medium" | "low"',
    "}",
    `Today is ${today}.`,
    "Amount is a decimal string like 1800.00 with no currency symbol, or null when the text does not state a price.",
    "Do not invent amounts, names, or dates.",
    "Use Buyer or Freelancer when a name is absent, and list that fact in missing.",
    "One PayPal authorization covers the whole amount and captures once. If the text splits payment, keep a single total and list each condition as its own milestone. Add a risk note that capture is all-or-nothing.",
    "Conditions must be observable. One to four milestones.",
    "Risk notes are specific to this description, not generic freelance advice.",
    "Currency is ISO 4217. Default USD.",
  ].join("\n");
}

function extractionFromModel(value: unknown): Omit<Extraction, "aiSource"> {
  if (!value || typeof value !== "object") throw new Error("Model JSON was not an object.");
  const record = value as Record<string, unknown>;
  const title = clip(asString(record.title), 80);
  const summary = clip(asString(record.summary), 400);
  if (!title || !summary) throw new Error("Model JSON missed a title or summary.");

  const currency = normalizeCurrency(asString(record.currency) || "USD");
  const amountRaw = record.amount;
  let amount: string | null = null;
  if (typeof amountRaw === "number" || (typeof amountRaw === "string" && amountRaw.trim())) {
    amount = toPaypalValue(parseAmount(String(amountRaw)), currency);
  }

  const dueRaw = asString(record.dueDate);
  const dueDate = dueRaw && isValidDate(dueRaw) ? dueRaw : null;
  const milestones = readMilestones(record.milestones);
  const riskNotes = readStrings(record.riskNotes, 280).slice(0, 8);
  const missing = readStrings(record.missing, 120).slice(0, 8);
  const confidence = record.confidence === "high" || record.confidence === "low" ? record.confidence : "medium";
  const buyerName = clip(asString(record.buyerName) || "Buyer", 80);
  const freelancerName = clip(asString(record.freelancerName) || "Freelancer", 80);

  return {
    title,
    summary,
    amount,
    currency,
    buyerName,
    freelancerName,
    dueDate,
    milestones,
    riskNotes,
    missing,
    confidence,
  };
}

function readMilestones(value: unknown): MilestoneDraft[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Model JSON did not include milestones.");
  }
  const milestones = value.slice(0, 4).map((item) => {
    if (typeof item === "string") {
      const condition = clip(item, 280);
      if (!condition) throw new Error("Empty milestone.");
      return { title: clip(condition, 60), condition };
    }
    if (!item || typeof item !== "object") throw new Error("Bad milestone.");
    const record = item as Record<string, unknown>;
    const condition = clip(asString(record.condition) || asString(record.title), 280);
    const title = clip(asString(record.title) || condition, 80);
    if (!title || !condition) throw new Error("Empty milestone.");
    return { title, condition };
  });
  if (milestones.length === 0) throw new Error("Model JSON did not include milestones.");
  return milestones;
}

function readStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => clip(item, max))
    .filter(Boolean);
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}
