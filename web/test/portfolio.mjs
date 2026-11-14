// Financial and privacy invariants, not snapshots of implementation details.
import assert from "node:assert/strict";
import { appendObservation, portfolioPoints, samplePortfolio, valuePortfolio, valueChange,
  validObservations, HISTORY_GAP_MS } from "../portfolio-model.js";
import { portfolioGeometry, portfolioY } from "../portfolio-geometry.js";
import { createPortfolioStore } from "../portfolio-store.js";
import { createPortfolioPrices } from "../portfolio-prices.js";
import { createPortfolioPriceRoute } from "../../cf/src/portfolio.js";

const now = 1_795_000_000_000;
const holding = (asset, amount, at = now) => ({ asset, amount, at });
const price = (usd, at = now) => ({ usd, at });
const sample = (at, amount = 2, usd = 100, asset = "zec") => valuePortfolio(
  [holding(asset, amount, at)], { [asset]: price(usd, at) }, at).observation;

const current = valuePortfolio([holding("zec", 2), holding("sol", 3), holding("usdc", 100)],
  { zec: price(100), sol: price(150), usdc: price(.98) }, now);
assert.equal(current.value, 748, "sum each balance × its real price, including USDC depegs");
assert.ok(current.observation);
assert.equal(valuePortfolio([holding("zec", 0)], {}, now).value, 0, "known zero is zero");
assert.equal(valuePortfolio([holding("zec", null)], {}, now).value, null, "unknown is not zero");
assert.equal(valuePortfolio([holding("zec", 2, now - 180_000)], { zec: price(100) }, now)
  .observation, null, "a stale balance cannot masquerade as a new observation");
assert.equal(valuePortfolio([holding("zec", 2)], { zec: price(100, now - 360_000) }, now)
  .observation, null, "stale prices do not enter history");
const partial = valuePortfolio([holding("zec", 2), holding("sol", 3)], { zec: price(100) }, now);
assert.equal(partial.value, 200); assert.deepEqual(partial.missing, ["sol"]);
assert.equal(partial.observation, null, "partial scope never creates a misleading total history");

const first = sample(now - 120_000), deposit = sample(now - 60_000, 102), latest = sample(now, 102);
const points = portfolioPoints([first, deposit, latest], "1D", now);
assert.ok(points[1].breakBefore, "a deposit does not draw an invented price trajectory");
assert.equal(points[2].breakBefore, false);
assert.equal(valueChange(200, 10_200).amount, 10_000, "change is VALUE change, never P&L");
assert.equal(valueChange(0, 100).percent, null, "no infinite percentage from a zero baseline");
assert.equal(valueChange(1e-300, 1e300).percent, null, "overflow does not display infinity");
assert.equal(portfolioPoints([sample(now - HISTORY_GAP_MS - 1), latest], "1D", now)[1]
  .breakBefore, true, "offline gaps remain gaps");
assert.equal(portfolioPoints([sample(now - 86_400_001)], "1D", now).length, 0);
const recorded = [first];
assert.equal(appendObservation(recorded, sample(first.at + 1000)), recorded,
  "redraws do not write new observations");
assert.equal(appendObservation(recorded, sample(first.at + 1000, 3)).length, 2,
  "a transfer can be recorded between scheduled samples");
const dirty = [{ ...first, value: 99999 }, null, { ...first, at: now + 1 }];
assert.deepEqual(validObservations(dirty, now),
  [first], "stored totals are recomputed and future records rejected");

const dense = Array.from({ length: 10_000 }, (_, i) => ({ ...sample(now - (9999 - i) * 1000,
  2, i === 5000 ? 1000 : 100), breakBefore: i === 0 || i === 5500 }));
const sampled = samplePortfolio(dense);
assert.ok(sampled.length <= 244, "render workload remains bounded");
assert.ok(sampled.some((p) => p.value === 2000), "a real spike survives sampling");
assert.ok(sampled.find((p) => p.at >= dense[5500].at).breakBefore,
  "sampling cannot bridge a gap whose exact boundary was omitted");
const geometry = portfolioGeometry(points, 600, 192);
assert.equal(geometry.curves.length, 1);
assert.equal(portfolioY(geometry, (geometry.vertices[0].x + geometry.vertices[1].x) / 2), null);
for (const vertex of geometry.vertices) assert.equal(portfolioY(geometry, vertex.x), vertex.y);
const flat = portfolioGeometry(portfolioPoints([sample(now - 60_000, 0), sample(now, 0)],
  "1D", now), 300, 192);
assert.equal(flat.vertices[0].y, flat.vertices[1].y);
assert.ok(!flat.line.includes("NaN"));

const storage = new Map();
const adapter = { getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value) };
// A reversible stand-in verifies that the storage adapter only ever receives the sealed value.
const seal = (text) => "sealed:" + Buffer.from(text).toString("base64");
const open = (box) => {
  if (!box.startsWith("sealed:")) throw Error("unreadable");
  return Buffer.from(box.slice(7), "base64").toString();
};
const opts = { storage: adapter, key: "wallet-A", seal, open, now: () => now };
const store = createPortfolioStore(opts); store.record(first);
assert.ok(storage.get("wallet-A").startsWith("sealed:"));
const other = createPortfolioStore(opts); other.record(deposit); store.record(latest);
assert.equal(createPortfolioStore(opts).read().observations.length, 3,
  "merge another tab's history");
storage.set("broken", "preserve-me");
const broken = createPortfolioStore({ ...opts, key: "broken" }); broken.record(first);
assert.equal(storage.get("broken"), "preserve-me", "do not overwrite an unreadable record");
assert.match(broken.read().note, /could not be read/);
const full = createPortfolioStore({ ...opts, key: "full", storage: { ...adapter,
  setItem() { throw Error("quota"); } } });
full.record(first); assert.equal(full.read().observations.length, 1);
assert.match(full.read().note, /could not save/);
store.clearMemory(); assert.equal(store.read().observations.length, 0);

let requests = 0, tick = now, release;
const cache = createPortfolioPrices({ now: () => tick, fetcher: () => {
  requests++; return new Promise((resolve) => { release = resolve; });
} });
const a = cache.ask(), b = cache.ask(); assert.equal(requests, 1);
release(Response.json({ source: "coingecko", prices: { zec: price(100) } }));
await Promise.all([a, b]); await cache.ask(); assert.equal(requests, 1);
assert.equal(cache.read().prices.zec.usd, 100);
tick += 60_001;
const c = cache.ask(); release(new Response("no", { status: 503 })); await c;
await cache.ask(); assert.equal(requests, 2, "failed requests back off");
assert.ok(cache.read().failed);
assert.equal(cache.read().retryAfterMs, 60_000, "the UI can explain the failure backoff");
tick += 60_001;
const retried = cache.ask();
assert.equal(requests, 3, "retry really requests fresh data after backoff");
release(Response.json({ source: "coingecko", prices: { zec: price(101, tick) } }));
await retried;
assert.equal(cache.read().failed, false);
assert.equal(cache.read().retryAfterMs, 0);

const unconfigured = createPortfolioPrices({ fetcher: async () =>
  Response.json({ error: "prices_not_configured" }, { status: 503 }) });
await unconfigured.ask();
assert.equal(unconfigured.read().error, "not_configured",
  "missing server configuration is distinct from a temporary market outage");
assert.equal(cache.read().error, "", "a successful refresh clears the service error");

let calls = 0, request;
const route = createPortfolioPriceRoute({ now: () => now, fetcher: async (url, options) => {
  calls++; request = { url, options };
  return Response.json({ zcash: { usd: 100, last_updated_at: now / 1000 },
    solana: { usd: 150, last_updated_at: now / 1000 },
    "usd-coin": { usd: .98, last_updated_at: now / 1000 } });
} });
const req = new Request("https://wallet.example/portfolio/prices?address=ignored",
  { headers: { Cookie: "private-cookie", Authorization: "private-auth" } });
const responses = await Promise.all([route(req, { COINGECKO_DEMO_API_KEY: "test-key" }),
  route(req, { COINGECKO_DEMO_API_KEY: "test-key" })]);
assert.equal(calls, 1, "server deduplicates concurrent requests");
assert.equal(request.options.headers.Cookie, undefined);
assert.equal(request.options.headers.Authorization, undefined);
assert.equal(request.url.searchParams.get("address"), null);
assert.equal(request.options.headers["x-cg-demo-api-key"], "test-key");
assert.equal((await responses[0].json()).prices.usdc.usd, .98);
assert.equal((await route(new Request(req.url, { method: "POST" }), {})).status, 405);
let publicCalls = 0;
const keyless = createPortfolioPriceRoute({ now: () => now, fetcher: async (url, options) => {
  publicCalls++;
  assert.equal(url.origin, "https://api.kraken.com");
  assert.equal(url.searchParams.get("pair"), "ZECUSD,SOLUSD,USDCUSD");
  assert.deepEqual(options.headers, {}, "no credential or wallet header reaches the public feed");
  return Response.json({ error: [], result: {
    XZECZUSD: { a: ["102"], b: ["100"] }, SOLUSD: { a: ["152"], b: ["150"] },
    USDCUSD: { a: ["1.0002"], b: ["0.9998"] } } });
} });
const publicResponse = await (await keyless(req, {})).json();
assert.equal(publicResponse.source, "kraken");
assert.deepEqual(publicResponse.prices.zec, { usd: 101, at: now });
assert.equal(publicResponse.prices.usdc.usd, 1);
await keyless(req, {});
assert.equal(publicCalls, 1, "keyless quotes use the same one-minute server cache");
const publicCache = createPortfolioPrices({ now: () => now,
  fetcher: async () => Response.json(publicResponse) });
await publicCache.ask();
assert.equal(publicCache.read().source, "kraken");
assert.equal(publicCache.read().failed, false);
for (const payload of [{ error: ["rate limited"], result: {} }, { error: [], result: {
  SOLUSD: { a: ["-1"], b: ["2"] }, XZECZUSD: { a: ["NaN"], b: ["1"] } } }]) {
  const invalid = createPortfolioPriceRoute({ fetcher: async () => Response.json(payload) });
  assert.equal((await invalid(req, {})).status, 502, "invalid public quotes never fabricate prices");
}
const staleRoute = createPortfolioPriceRoute({ now: () => now, fetcher: async () =>
  Response.json({ zcash: { usd: 100, last_updated_at: (now - 600_000) / 1000 } }) });
assert.equal((await staleRoute(req, { COINGECKO_DEMO_API_KEY: "test" })).status, 502);
console.log("portfolio: valuation, gaps, geometry, sampling, encrypted storage and prices pass");
