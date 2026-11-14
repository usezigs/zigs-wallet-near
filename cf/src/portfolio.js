// Fixed server-side market requests. No wallet data or caller headers go upstream.
// Kraken public USD quotes need no key. A configured CoinGecko key selects that feed.
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

// Current bid/ask midpoint, observed at retrieval time; not a last-trade timestamp.
function krakenPrices(data, at) {
  if (!Array.isArray(data?.error) || data.error.length || !data.result) return {};
  const prices = {};
  for (const [asset, pair] of Object.entries({ zec: "XZECZUSD", sol: "SOLUSD", usdc: "USDCUSD" })) {
    const ticker = data.result[pair], ask = Number(ticker?.a?.[0]), bid = Number(ticker?.b?.[0]);
    if (Number.isFinite(ask) && Number.isFinite(bid) && bid > 0 && ask >= bid)
      prices[asset] = { usd: (ask + bid) / 2, at };
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
    const base = pro ? "https://pro-api.coingecko.com" : "https://api.coingecko.com";
    const url = key ? new URL("/api/v3/simple/price", base)
      : new URL("https://api.kraken.com/0/public/Ticker?pair=ZECUSD,SOLUSD,USDCUSD");
    if (key) url.search = new URLSearchParams({ ids: Object.values(IDS).join(","),
      vs_currencies: "usd", include_last_updated_at: "true", precision: "full" }).toString();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher(url, { signal: controller.signal,
        headers: key ? { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {} });
      if (!response.ok) throw new Error("Upstream prices unavailable");
      const data = await response.json();
      const prices = key ? marketPrices(data, now()) : krakenPrices(data, now());
      if (!Object.keys(prices).length) throw new Error("Stale prices");
      return { status: 200, body: { source: key ? "coingecko" : "kraken", prices } };
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
