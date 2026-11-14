// @ts-check
/** @typedef {import('./portfolio-types').PortfolioAsset} Asset */
/** @typedef {import('./portfolio-types').PortfolioPrice} Price */
/** @param {Price|undefined} p @param {number} now */
const validPrice = (p, now) => p && typeof p.usd === "number" && Number.isFinite(p.usd)
  && p.usd > 0 && Number.isFinite(p.at) && p.at <= now + 10_000 && now - p.at <= 300_000;

/** @param {Partial<Record<Asset, Price>>} prices @param {number} now */
function cleanPrices(prices, now) {
  /** @type {Partial<Record<Asset, Price>>} */
  const next = {};
  for (const asset of /** @type {Asset[]} */ (["zec", "sol", "usdc"])) {
    const p = prices[asset];
    if (p && validPrice(p, now)) next[asset] = { usd: p.usd, at: p.at };
  }
  return next;
}
/** A page-session price cache, independent of wallet identity or holdings. */
export function createPortfolioPrices({ fetcher = globalThis.fetch,
  now = () => Date.now(), settled = () => {} } = {}) {
  /** @type {Partial<Record<Asset, Price>>} */
  let prices = {};
  /** @type {""|"coingecko"|"kraken"} */
  let source = "";
  let fetchedAt = -Infinity, retryAt = -Infinity, failed = false;
  /** @type {""|"not_configured"|"unavailable"} */
  let error = "";
  /** @type {Promise<void>|null} */
  let pending = null;
  async function load() {
    /** @type {"not_configured"|"unavailable"} */
    let nextError = "unavailable";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetcher("/portfolio/prices", {
        signal: controller.signal, credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        nextError = body.error === "prices_not_configured" ? "not_configured" : "unavailable";
        throw new Error("Prices unavailable");
      }
      if (!["coingecko", "kraken"].includes(body.source) || !body.prices) throw new Error("Invalid prices");
      const next = cleanPrices(body.prices, now());
      if (!Object.keys(next).length) throw new Error("No fresh prices");
      source = body.source; prices = next; fetchedAt = now(); failed = false; error = "";
    } catch { failed = true; error = nextError; retryAt = now() + 60_000; }
    finally { clearTimeout(timer); pending = null; settled(); }
  }
  return {
    ask() {
      if (pending) return pending;
      if (now() < retryAt || now() - fetchedAt < 60_000) return Promise.resolve();
      pending = load();
      return pending;
    },
    read() { return { prices, source, failed, error, loading: !!pending,
      retryAfterMs: failed ? Math.max(0, retryAt - now()) : 0 }; },
  };
}
