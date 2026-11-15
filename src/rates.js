// Indicative ECB mid-market rate via Frankfurter. This is not a Revolut rate.
// Observed on 2026-11-15 from https://api.frankfurter.app/latest?from=EUR&to=CZK
// (ECB reference date 2026-11-13, 24.424). Used only when the network and the
// saved cache are both unavailable.

export const RATE_CACHE_KEY = "zigo-finance-rate";
export const FRANKFURTER_URL = "https://api.frankfurter.app/latest?from=EUR&to=CZK";
export const FALLBACK_QUOTE = {
  rate: 24.424,
  rateDate: "2026-11-13",
  rateSource: "fallback",
};

export function rateLabel(source, date) {
  const formatted = date ? formatCzechDate(date) : null;
  if (source === "manual") return "Ručně upraveno";
  if (source === "ecb" && formatted) return `Orientační kurz ECB (Frankfurter), ${formatted}`;
  if (source === "cache" && formatted) return `Poslední uložený kurz ECB (Frankfurter), ${formatted}`;
  if (source === "fallback") {
    return formatted
      ? `Záložní kurz (offline), ${formatted}. Není to kurz Revolutu.`
      : "Záložní kurz (offline). Není to kurz Revolutu.";
  }
  if (source === "legacy") return "Původní výdaj v Kč, kurz 1";
  if (source === "czk") return "Výdaj v Kč, kurz 1";
  if (source === "base") return "Účtenka je v měně skupiny, kurz 1";
  return "Kurz";
}

function formatCzechDate(iso) {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

export function readCachedQuote(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(RATE_CACHE_KEY) || "null");
    if (!parsed || typeof parsed.rate !== "number" || parsed.rate <= 0 || !parsed.rateDate) return null;
    return { rate: parsed.rate, rateDate: parsed.rateDate, rateSource: "cache" };
  } catch {
    return null;
  }
}

export function writeCachedQuote(storage, quote) {
  storage.setItem(RATE_CACHE_KEY, JSON.stringify({
    rate: quote.rate,
    rateDate: quote.rateDate,
    fetchedAt: new Date().toISOString(),
  }));
}

export async function fetchEurCzkQuote(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(FRANKFURTER_URL);
  if (!response.ok) throw new Error(`Frankfurter odpověděl ${response.status}.`);
  const data = await response.json();
  const rate = data?.rates?.CZK;
  if (typeof rate !== "number" || !(rate > 0) || typeof data.date !== "string") {
    throw new Error("Frankfurter nevrátil kurz EUR/CZK.");
  }
  return { rate, rateDate: data.date, rateSource: "ecb" };
}

export async function resolveEurCzkQuote({ fetchImpl = globalThis.fetch, storage } = {}) {
  try {
    const quote = await fetchEurCzkQuote(fetchImpl);
    if (storage) writeCachedQuote(storage, quote);
    return quote;
  } catch {
    const cached = storage ? readCachedQuote(storage) : null;
    return cached || { ...FALLBACK_QUOTE };
  }
}
