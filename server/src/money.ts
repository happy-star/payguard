const ZERO_DECIMAL = new Set(["JPY", "HUF", "TWD"]);

export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "JPY",
  "SGD",
  "HKD",
  "MXN",
  "BRL",
  "PLN",
  "CZK",
  "INR",
  "PHP",
  "THB",
  "TWD",
  "HUF",
  "ILS",
] as const;

const CURRENCY_SET = new Set<string>(CURRENCIES);

const WORD_TO_CODE: Record<string, string> = {
  usd: "USD",
  dollar: "USD",
  dollars: "USD",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  cad: "CAD",
  aud: "AUD",
  nzd: "NZD",
  chf: "CHF",
  sek: "SEK",
  nok: "NOK",
  dkk: "DKK",
  jpy: "JPY",
  yen: "JPY",
};

export function currencyFromWord(word: string): string | null {
  return WORD_TO_CODE[word.toLowerCase()] ?? null;
}

export function currencyFromSymbol(symbol: string): string {
  if (symbol === "€") return "EUR";
  if (symbol === "£") return "GBP";
  return "USD";
}

export function normalizeCurrency(input: string): string {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error("Currency must be a 3-letter code such as USD.");
  }
  if (!CURRENCY_SET.has(code)) {
    throw new Error(
      `PayGuard does not open holds in ${code}. Pick USD, EUR, GBP, or another supported currency.`,
    );
  }
  return code;
}

export function decimalPlaces(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

export function parseAmount(input: string): number {
  const cleaned = input.replace(/[,\s]/g, "").replace(/^[£$€]/, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error("Enter an amount like 1800 or 1800.00.");
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  if (value > 99999.99) {
    throw new Error("Demo holds are capped at 99999.99.");
  }
  return value;
}

export function toPaypalValue(value: number, currency: string): string {
  const digits = decimalPlaces(currency);
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  if (rounded <= 0) throw new Error("Amount must be greater than zero.");
  return rounded.toFixed(digits);
}

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

export function isValidDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
