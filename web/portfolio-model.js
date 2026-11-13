// @ts-check
// Portfolio VALUE, not investment return. Every sample contains its actual balance and price
// observations. No price backfill, carry-forward balance, or invented point at a period boundary.
/** @typedef {import('./portfolio-types').PortfolioObservation} Observation */
/** @typedef {import('./portfolio-types').PortfolioPoint} Point */
/** @typedef {import('./portfolio-types').PortfolioRange} Range */
/** @typedef {import('./portfolio-types').PortfolioHolding} Holding */
/** @typedef {import('./portfolio-types').PortfolioAsset} Asset */
/** @typedef {import('./portfolio-types').PortfolioPrice} Price */
export const PORTFOLIO_RANGES = /** @type {const} */ (["1D", "1W", "1M", "3M", "1Y", "ALL"]);
export const OBSERVATION_FRESH_MS = 2 * 60_000;
export const PRICE_FRESH_MS = 5 * 60_000;
export const HISTORY_GAP_MS = 3 * 60_000;
export const MAX_OBSERVATIONS = 10_000;
const DAY = 86_400_000;
const durations = { "1D": DAY, "1W": 7 * DAY, "1M": 30 * DAY,
  "3M": 90 * DAY, "1Y": 365 * DAY, ALL: Infinity };
export const rangeWords = { "1D": "past day", "1W": "past week", "1M": "past month",
  "3M": "past 3 months", "1Y": "past year", ALL: "recorded history" };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** @param {number|null} value */
export const portfolioMoney = (value) => value === null ? "—" : money.format(value);
/** @param {unknown} value @returns {value is number} */
const nonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** @param {number|null|undefined} at @param {number} now @param {number} max */
const fresh = (at, now, max) => typeof at === "number" && Number.isFinite(at)
  && at <= now + 10_000 && now - at <= max;

/** @param {Holding} h @param {Price|undefined} p @param {number} now */
function canValue(h, p, now) {
  if (!nonnegative(h.amount) || !fresh(h.at, now, OBSERVATION_FRESH_MS)) return false;
  if (h.amount === 0) return true;
  return !!p && nonnegative(p.usd) && p.usd > 0 && fresh(p.at, now, PRICE_FRESH_MS);
}
/** @param {Holding} h @param {Price|undefined} p @param {number} now
 * @returns {Observation['holdings'][number]|null} */
function observedHolding(h, p, now) {
  if (!canValue(h, p, now)) return null;
  const market = h.amount === 0 ? { usd: 0, at: now } : p ?? { usd: 0, at: now };
  return { asset: h.asset, amount: /** @type {number} */ (h.amount), usd: market.usd,
    priceAt: market.at, balanceAt: /** @type {number} */ (h.at) };
}

/** Unknown and stale assets stay out of the subtotal. Only complete valuations become history.
 * @param {Holding[]} holdings @param {Partial<Record<Asset, Price>>} prices @param {number} now
 * @returns {import('./portfolio-types').PortfolioValuation} */
export function valuePortfolio(holdings, prices, now) {
  /** @type {Asset[]} */
  const missing = [];
  /** @type {Observation['holdings']} */
  const valued = [];
  let value = 0;
  for (const h of holdings) {
    // A confirmed zero needs no market price. It still needs a fresh balance observation.
    const record = observedHolding(h, prices[h.asset], now);
    if (!record) { missing.push(h.asset); continue; }
    const part = record.amount * record.usd;
    if (!Number.isFinite(value + part)) { missing.push(h.asset); continue; }
    value += part;
    valued.push(record);
  }
  const scope = holdings.map((h) => h.asset).sort().join(",");
  return { value: valued.length ? value : null, missing,
    observation: !missing.length && valued.length ? { at: now, value, scope,
      holdings: valued } : null };
}

/** @param {Observation} row @param {number} now */
function validRecordShape(row, now) {
  if (!row || !nonnegative(row.at) || row.at > now || now - row.at > 400 * DAY) return false;
  return Array.isArray(row.holdings) && row.holdings.length > 0 && row.holdings.length <= 3;
}
/** @param {Observation['holdings'][number]} h @param {number} at */
function validRecordedHolding(h, at) {
  if (!h || typeof h !== "object" || !nonnegative(h.amount) || !nonnegative(h.usd)) return false;
  return (h.amount === 0 || h.usd > 0) && fresh(h.balanceAt, at, OBSERVATION_FRESH_MS)
    && fresh(h.priceAt, at, PRICE_FRESH_MS);
}
/** @param {Observation['holdings']} held */
function validRecordedAssets(held) {
  if (held.some((h) => !h || typeof h !== "object")) return false;
  const ids = held.map((h) => h.asset);
  return new Set(ids).size === ids.length && ids.every((id) => ["zec", "sol", "usdc"].includes(id));
}

/** @param {Observation} a @param {Observation} b */
export const sameHoldings = (a, b) => a.scope === b.scope && a.holdings.length === b.holdings.length
  && a.holdings.every((h) => b.holdings.some((v) => v.asset === h.asset && v.amount === h.amount));

/** Validate encrypted storage too: malformed, future, duplicate and inconsistent records are
 * never plotted. Recompute totals rather than trusting a stored USD value.
 * @param {unknown} records @param {number} now @returns {Observation[]} */
export function validObservations(records, now) {
  if (!Array.isArray(records)) return [];
  /** @type {Map<number, Observation>} */
  const result = new Map();
  for (const row of records.slice(-MAX_OBSERVATIONS)) {
    if (!validRecordShape(row, now)) continue;
    /** @type {Observation['holdings']} */
    const held = row.holdings;
    if (!validRecordedAssets(held)) continue;
    const ids = held.map((h) => h.asset);
    const valid = held.every((h) => validRecordedHolding(h, row.at));
    if (!valid) continue;
    const value = held.reduce((sum, h) => sum + h.amount * h.usd, 0);
    if (!Number.isFinite(value) || row.scope !== ids.sort().join(",")) continue;
    result.set(row.at, { at: row.at, value, scope: row.scope, holdings: row.holdings });
  }
  return [...result.values()].sort((a, b) => a.at - b.at);
}

/** Record at most once a minute, except when holdings change. Never rewrite an earlier point.
 * @param {Observation[]} records @param {Observation|null} next @returns {Observation[]} */
export function appendObservation(records, next) {
  const last = records.at(-1);
  if (!next || (last && (next.at <= last.at
    || (next.at - last.at < 60_000 && sameHoldings(last, next))))) return records;
  return [...records, next].slice(-MAX_OBSERVATIONS);
}

/** Only join contemporaneous observations with unchanged holdings and scope. Transfers, offline
 * gaps and a changed set of assets break the line. Range filtering never invents a starting value.
 * @param {Observation[]} records @param {Range} range @param {number} now @returns {Point[]} */
export function portfolioPoints(records, range, now) {
  const points = records.filter((p) => p.at >= now - durations[range] && p.at <= now);
  return points.map((p, i) => ({ ...p, breakBefore: i === 0
    || p.at - points[i - 1].at > HISTORY_GAP_MS || !sameHoldings(points[i - 1], p) }));
}

/** @param {number} start @param {number} end */
export function valueChange(start, end) {
  const amount = end - start;
  const ratio = start === 0 ? null : amount / start * 100;
  const percent = ratio !== null && Number.isFinite(ratio) ? ratio : null;
  return { amount, percent, sign: amount > 0 ? "+" : amount < 0 ? "−" : "",
    direction: amount > 0 ? "positive" : amount < 0 ? "negative" : "neutral" };
}

/** Envelope sampling retains real extrema and endpoints, and never bridges a gap. No averaging of
 * amounts or interpolation through missing observations.
 * @param {Point[]} points @param {number} cap */
export function samplePortfolio(points, cap = 240) {
  if (points.length <= cap) return points;
  const kept = new Set([0, points.length - 1]);
  const bucket = Math.max(1, Math.ceil(points.length / (cap / 4)));
  for (let i = 0; i < points.length; i += bucket) {
    let min = i, max = i;
    const end = Math.min(points.length, i + bucket);
    kept.add(i); kept.add(end - 1);
    for (let j = i; j < end; j++) {
      if (points[j].value < points[min].value) min = j;
      if (points[j].value > points[max].value) max = j;
    }
    kept.add(min); kept.add(max);
  }
  let previous = -1;
  return [...kept].sort((a, b) => a - b).map((i) => {
    const breakBefore = points.slice(previous + 1, i + 1).some((p) => p.breakBefore);
    previous = i;
    return { ...points[i], breakBefore };
  });
}
