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
  let fetchedAt = -Infinity, retryAt = -Infinity, failed = false;
  /** @type {Promise<void>|null} */
  let pending = null;
  async function load() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetcher("/portfolio/prices", {
        signal: controller.signal, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Prices unavailable");
      const body = await response.json();
      if (body.source !== "coingecko" || !body.prices) throw new Error("Invalid prices");
      const next = cleanPrices(body.prices, now());
      if (!Object.keys(next).length) throw new Error("No fresh prices");
      prices = next; fetchedAt = now(); failed = false;
    } catch { failed = true; retryAt = now() + 60_000; }
    finally { clearTimeout(timer); pending = null; settled(); }
  }
  return {
    ask() {
      if (pending) return pending;
      if (now() < retryAt || now() - fetchedAt < 60_000) return Promise.resolve();
      pending = load();
      return pending;
    },
    read() { return { prices, failed, loading: !!pending,
      retryAfterMs: failed ? Math.max(0, retryAt - now()) : 0 }; },
  };
}
