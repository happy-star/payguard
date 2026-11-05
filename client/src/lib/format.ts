import type { AiSource, DealStatus } from "@/types";

export const FALLBACK_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "JPY",
  "SGD",
  "MXN",
];

export function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
    }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function statusLabel(status: DealStatus): string {
  switch (status) {
    case "created":
      return "Awaiting approval";
    case "approved":
      return "Approval received";
    case "authorized":
      return "On hold";
    case "captured":
      return "Released";
    case "voided":
      return "Voided";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
  }
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return formatWhen(iso);
}

export function readerLabel(source: AiSource): string {
  switch (source) {
    case "model":
      return "Read by the configured model";
    case "mock-fallback":
      return "The model did not answer, so the built-in reader filled this in";
    case "mock":
      return "Read by the built-in parser";
  }
}

export function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
