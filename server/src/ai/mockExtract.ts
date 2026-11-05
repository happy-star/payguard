import {
  currencyFromSymbol,
  currencyFromWord,
  formatMoney,
  isValidDate,
  toPaypalValue,
} from "../money";
import type { Confidence, Extraction, MilestoneDraft } from "../types";

interface AmountHit {
  value: number;
  currency: string;
  start: number;
  end: number;
  score: number;
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function mockExtract(prompt: string, now = new Date()): Extraction {
  const text = prompt.replace(/\s+/g, " ").trim();
  const hits = findAmounts(text);
  const primary = choosePrimary(text, hits);
  const currency = primary?.currency ?? "USD";
  const amount = primary ? toPaypalValue(primary.value, currency) : null;
  const parties = extractParties(text);
  const buyerName = parties.buyer ?? "Buyer";
  const freelancerName = parties.freelancer ?? "Freelancer";
  const dueDate = extractDue(text, now);
  const title = extractTitle(text);
  const milestones = extractMilestones(text);
  const missing: string[] = [];
  if (!amount) missing.push("amount");
  if (!parties.buyer) missing.push("buyer name");
  if (!parties.freelancer) missing.push("freelancer name");
  if (!dueDate) missing.push("due date");

  const riskNotes = buildRisks({
    text,
    hits,
    amount,
    currency,
    buyer: parties.buyer,
    freelancer: parties.freelancer,
    dueDate,
    milestones,
  });

  let confidence: Confidence = "high";
  if (!amount) confidence = "low";
  else if (!parties.buyer || !parties.freelancer || /\bvague\b/i.test(text) || hits.length > 1) {
    confidence = "medium";
  }

  const summary = buildSummary({
    title,
    amount,
    currency,
    buyerName,
    freelancerName,
    milestones,
  });

  return {
    title,
    summary,
    amount,
    currency,
    buyerName,
    freelancerName,
    dueDate,
    milestones,
    riskNotes: riskNotes.slice(0, 8),
    missing: missing.slice(0, 8),
    confidence,
    aiSource: "mock",
  };
}

function findAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = [];
  const symbolRe = /([$€£])\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  for (const match of text.matchAll(symbolRe)) {
    const raw = match[0];
    const symbol = match[1] ?? "$";
    const number = match[2];
    if (!number) continue;
    const nearby = text.slice(match.index, match.index + raw.length + 12);
    const word = nearby.match(/\b(USD|EUR|GBP|CAD|AUD|NZD|JPY)\b/i)?.[1];
    hits.push({
      value: numeric(number, match[3]),
      currency: word ? (currencyFromWord(word) ?? currencyFromSymbol(symbol)) : currencyFromSymbol(symbol),
      start: match.index,
      end: match.index + raw.length,
      score: raw.length,
    });
  }

  const wordAfterRe =
    /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|SEK|NOK|DKK|dollars?|euros?|pounds?|yen)\b/gi;
  for (const match of text.matchAll(wordAfterRe)) {
    const raw = match[0];
    const number = match[1];
    const word = match[3];
    if (!number || !word) continue;
    consider(hits, {
      value: numeric(number, match[2]),
      currency: currencyFromWord(word) ?? "USD",
      start: match.index,
      end: match.index + raw.length,
      score: raw.length + 20,
    });
  }

  const wordBeforeRe =
    /\b(USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|SEK|NOK|DKK)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi;
  for (const match of text.matchAll(wordBeforeRe)) {
    const raw = match[0];
    const word = match[1];
    const number = match[2];
    if (!word || !number) continue;
    consider(hits, {
      value: numeric(number, match[3]),
      currency: currencyFromWord(word) ?? "USD",
      start: match.index,
      end: match.index + raw.length,
      score: raw.length + 20,
    });
  }

  return hits.filter((hit) => hit.value > 0);
}

function consider(hits: AmountHit[], hit: AmountHit) {
  const index = hits.findIndex((existing) => hit.start < existing.end && existing.start < hit.end);
  if (index === -1) {
    hits.push(hit);
    return;
  }
  const existing = hits[index];
  if (existing && hit.score > existing.score) hits[index] = hit;
}

function choosePrimary(text: string, hits: AmountHit[]): AmountHit | null {
  const first = hits[0];
  if (!first) return null;
  const hinted = hits.find((hit) =>
    /budget|total|hold|pay|quote/i.test(text.slice(Math.max(0, hit.start - 32), hit.start)),
  );
  if (hinted) return hinted;
  return hits.reduce((best, hit) => (hit.value > best.value ? hit : best), first);
}

function numeric(whole: string, fraction?: string): number {
  return Number(`${whole.replace(/,/g, "")}${fraction ? `.${fraction}` : ""}`);
}

function extractParties(text: string): { buyer: string | null; freelancer: string | null } {
  let buyer: string | null = null;
  let freelancer: string | null = null;
  const name = "([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2})";

  const freelancerIs = text.match(new RegExp(`\\bfreelancer(?:'s name)?\\s+is\\s+${name}`, "i"));
  if (freelancerIs?.[1]) freelancer = freelancerIs[1];

  const illPay = text.match(new RegExp(`\\bI['’]ll pay\\s+${name}`));
  if (illPay?.[1]) freelancer = freelancer ?? illPay[1];

  const im = text.match(new RegExp(`\\bI['’]m\\s+${name}`));
  if (im?.[1]) {
    const sentenceEnd = text.indexOf(".");
    const sentence = sentenceEnd === -1 ? text.slice(0, 160) : text.slice(0, sentenceEnd);
    const creative =
      /designer|developer|editor|writer|freelancer|illustrator|engineer|consultant|photographer|animator/i.test(
        sentence,
      );
    if (creative) freelancer = freelancer ?? im[1];
    else buyer = buyer ?? im[1];
  }

  const atName = text.match(new RegExp(`\\b${name}\\s+at\\s+[A-Z][A-Za-z0-9&]+`));
  if (atName?.[1] && atName[1] !== freelancer) buyer = buyer ?? atName[1];

  const clientIs = text.match(new RegExp(`\\b(?:client|buyer|customer)\\s+is\\s+${name}`, "i"));
  if (clientIs?.[1]) buyer = clientIs[1];

  return { buyer, freelancer };
}

function extractTitle(text: string): string {
  const wants = text.match(
    /\bwants?\s+(?:me\s+to\s+)?(?:build|design|write|make|edit|create)?\s*(?:a|an|the)?\s*([^.]+)/i,
  );
  if (wants?.[1]) return clampTitle(wants[1]);
  const lead = text.match(/\b(?:need|build|design|write|create)\s+(?:a|an|the)\s+([^.]+)/i);
  if (lead?.[1]) return clampTitle(lead[1]);
  return clampTitle(text.split(/[.!\n]/)[0] ?? text);
}

function clampTitle(raw: string): string {
  let title = raw.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  title = title.replace(/\s+for\s+\$\d.*$/i, "");
  title = title.replace(/\b(budget|due|hold the money|release when)\b.*$/i, "").trim();
  if (title.length > 72) {
    title = title.slice(0, 72).replace(/\s+\S*$/, "");
  }
  if (!title) return "Freelance milestone";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function extractDue(text: string, now: Date): string | null {
  const iso = text.match(/\b(?:due|by|before|deadline(?:\s+is)?)\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (iso?.[1] && isValidDate(iso[1])) return iso[1];

  const monthRe = /\b(?:due|by|before|on)\s+([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?\b/gi;
  for (const monthDay of text.matchAll(monthRe)) {
    const monthName = monthDay[1];
    const dayText = monthDay[2];
    if (!monthName || !dayText) continue;
    const month = MONTHS[monthName.toLowerCase()];
    if (!month) continue;
    const day = Number(dayText);
    const year = monthDay[3] ? Number(monthDay[3]) : inferYear(now, month, day);
    const isoDate = ymd(year, month, day);
    if (isValidDate(isoDate)) return isoDate;
  }

  const weeks = text.match(/\bin\s+(\d+)\s+weeks?\b/i);
  if (weeks?.[1]) {
    const date = utcDate(now);
    date.setUTCDate(date.getUTCDate() + Number(weeks[1]) * 7);
    return date.toISOString().slice(0, 10);
  }

  const weekday = text.match(
    /\b(?:due|by|before)\s+(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );
  if (weekday?.[1]) return nextWeekday(now, weekday[1]);
  return null;
}

function inferYear(now: Date, month: number, day: number): number {
  const year = now.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return candidate < today ? year + 1 : year;
}

function nextWeekday(now: Date, name: string): string {
  const target = WEEKDAYS.indexOf(name.toLowerCase());
  const date = utcDate(now);
  const delta = (target - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function utcDate(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractMilestones(text: string): MilestoneDraft[] {
  const splitPay = text.match(/pay half when (.+?) and the rest when (.+?)(?:\.|$)/i);
  if (splitPay?.[1] && splitPay[2]) return [splitPay[1], splitPay[2]].map(toMilestone);

  const until = text.match(/\buntil\s+(.+?)(?:\.|$)/i);
  if (until?.[1]) return clauses(until[1]).map(toMilestone);

  const release = text.match(/\brelease(?:\s+the\s+(?:money|funds|hold))?\s+when\s+(.+?)(?:\.|$)/i);
  if (release?.[1]) return clauses(release[1]).map(toMilestone);

  const when = text.match(/\bwhen\s+(.+?)(?:\.|$)/i);
  if (when?.[1]) return clauses(when[1]).map(toMilestone);

  return [toMilestone("the buyer accepts the delivered work")];
}

function clauses(text: string): string[] {
  const parts = text
    .split(/\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 2 && parts[1] && /^(i|we|she|he|they)\b/i.test(parts[1])) return parts;
  return [text.trim()];
}

function toMilestone(clause: string): MilestoneDraft {
  const condition = polishCondition(clause);
  return { title: milestoneTitle(condition), condition };
}

function polishCondition(clause: string): string {
  let sentence = clause.trim().replace(/[.]+$/, "").replace(/\s+/g, " ");
  sentence = sentence.replace(/^(she|he)\s+/i, "The buyer ");
  sentence = sentence.replace(/^I\s+/i, "The freelancer ");
  sentence = sentence.replace(/^they\s+/i, "They ");
  sentence = sentence.replace(/^The freelancer\s+([a-z]+)\b/, (_match, verb: string) => {
    if (/s$/i.test(verb) || ["is", "are", "has", "can"].includes(verb.toLowerCase())) {
      return `The freelancer ${verb}`;
    }
    return `The freelancer ${verb}s`;
  });
  if (!sentence) return "The buyer accepts the delivered work";
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function milestoneTitle(condition: string): string {
  let stripped = condition.replace(/^(the buyer|the freelancer|they)\s+/i, "");
  stripped = stripped.replace(/^the\s+/i, "");
  const cut = stripped.split(/\s+(?:with|and|when)\s+/i)[0] ?? stripped;
  const words = cut.split(/\s+/).slice(0, 6);
  while (words.length > 2 && /^(a|an|the|of|on|in|to|for|my)$/i.test(words.at(-1) ?? "")) {
    words.pop();
  }
  const phrase = words.join(" ");
  if (!phrase) return "Milestone";
  const title = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title;
}

function buildRisks(input: {
  text: string;
  hits: AmountHit[];
  amount: string | null;
  currency: string;
  buyer: string | null;
  freelancer: string | null;
  dueDate: string | null;
  milestones: MilestoneDraft[];
}): string[] {
  const risks: string[] = [];
  if (input.hits.length > 1 && input.amount) {
    risks.push(
      `More than one amount was mentioned. The hold uses ${formatMoney(input.amount, input.currency)}. Edit it if that is not the full fee.`,
    );
  }
  if (/pay half|split the payment|50%|deposit/i.test(input.text)) {
    risks.push(
      "The description splits payment, but a PayPal authorization is one hold and one capture. Every condition has to be met before the full amount is released.",
    );
  }
  if (/\bvague\b|\btbd\b|\basap\b|\bwhatever\b|\bstuff\b/i.test(input.text)) {
    risks.push("The scope is still fuzzy. Tighten the acceptance conditions before the buyer approves the hold.");
  }
  if (/friends and family|gift card|crypto|bitcoin|wire transfer/i.test(input.text)) {
    risks.push("PayGuard only creates a PayPal goods authorization. Off-platform payment requests stay outside this hold.");
  }
  if (/revision/i.test(input.text) && /extra|additional|not included|out of scope/i.test(input.text)) {
    risks.push("Work beyond the included revision should stay outside this hold, or the amount will not match the job.");
  }
  if (!input.dueDate) {
    risks.push(
      "No due date was stated. PayPal honors an authorization for 3 days and allows capture for up to 29 days, so agree on a date inside that window.",
    );
  }
  if (input.amount && Number(input.amount) >= 5000) {
    risks.push("This is a large hold. Confirm both people agree on the amount before opening PayPal.");
  }
  if (!input.buyer) risks.push("The buyer was not named. Add their name so the approval step is unambiguous.");
  if (!input.freelancer) risks.push("The freelancer was not named. Add their name before creating the hold.");
  if (
    input.milestones.length === 1 &&
    /when it(?:'s| is) done|when complete|when finished|accepts the delivered work/i.test(
      input.milestones[0]?.condition ?? "",
    )
  ) {
    risks.push("Acceptance is generic. Name the file, the review, or the result that releases the money.");
  }
  return risks;
}

function buildSummary(input: {
  title: string;
  amount: string | null;
  currency: string;
  buyerName: string;
  freelancerName: string;
  milestones: MilestoneDraft[];
}): string {
  if (!input.amount) {
    return `The description does not name a price for “${input.title}”. Add one before creating a hold.`;
  }
  const bits = input.milestones.map(
    (milestone) => milestone.condition.charAt(0).toLowerCase() + milestone.condition.slice(1),
  );
  const joined =
    bits.length <= 1 ? (bits[0] ?? "the work is accepted") : `${bits.slice(0, -1).join(", ")}, and ${bits.at(-1)}`;
  const summary = `Hold ${formatMoney(input.amount, input.currency)} for “${input.title}”. ${input.buyerName} pays ${input.freelancerName} when ${joined}.`;
  return summary.length > 400 ? `${summary.slice(0, 397).trimEnd()}…` : summary;
}
