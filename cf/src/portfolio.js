// A fixed market-data request; no wallet identifier, address, amount, or user header goes to
// CoinGecko. Keys stay server-side. Configure COINGECKO_DEMO_API_KEY for the Demo API, or
// COINGECKO_PRO_API_KEY for a paid plan. With neither, fail explicitly; keyless is not a
// production polling service. See docs/portfolio-tracker.md for setup and history coverage.
const IDS = { zec: "zcash", sol: "solana", usdc: "usd-coin" };
const CACHE_MS = 60_000;
const validPrice = (p, at, now) => typeof p?.usd === "number" && Number.isFinite(p.usd)
  && p.usd > 0 && Number.isFinite(at) && at <= now + 10_000 && now - at <= 300_000;
function marketPrices(data, now) {
  const prices = {};
  for (const [asset, id] of Object.entries(IDS)) {
    const p = data[id], at = p?.last_updated_at * 1000;
    if (validPrice(p, at, now)) prices[asset] = { usd: p.usd, at };
  }
  return prices;
}

/** Per-isolate cache and in-flight deduplication; failures back off rather than hitting upstream
 * on every wallet redraw. The factory also permits deterministic upstream tests. */
export function createPortfolioPriceRoute({ fetcher = fetch, now = () => Date.now() } = {}) {
  let cached = null, expires = 0, pending = null;
  async function load(env) {
    const pro = !!env.COINGECKO_PRO_API_KEY;
    const key = env.COINGECKO_PRO_API_KEY || env.COINGECKO_DEMO_API_KEY;
    if (!key) return { status: 503, body: { error: "prices_not_configured" } };
    const base = pro ? "https://pro-api.coingecko.com" : "https://api.coingecko.com";
    const url = new URL("/api/v3/simple/price", base);
    url.search = new URLSearchParams({ ids: Object.values(IDS).join(","),
      vs_currencies: "usd", include_last_updated_at: "true", precision: "full" }).toString();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher(url, { signal: controller.signal,
        headers: { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } });
      if (!response.ok) throw new Error("Upstream prices unavailable");
      const prices = marketPrices(await response.json(), now());
      if (!Object.keys(prices).length) throw new Error("Stale prices");
      return { status: 200, body: { source: "coingecko", prices } };
    } catch { return { status: 502, body: { error: "prices_unavailable" } }; }
    finally { clearTimeout(timer); }
  }
  return async (req, env) => {
    if (req.method !== "GET") return new Response("Use GET.\n", { status: 405,
      headers: { Allow: "GET" } });
    if (!cached || now() >= expires) {
      pending ??= load(env);
      cached = await pending;
      expires = now() + CACHE_MS; pending = null;
    }
    return Response.json(cached.body, { status: cached.status,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  };
}
export const portfolioPrices = createPortfolioPriceRoute();
