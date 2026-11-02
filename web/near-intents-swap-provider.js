// NEAR Intents through the Zigs Worker (cf/src/near.js). /near/quote gives dry quotes of mainnet
// prices: no funds move. /near/swap opens a live swap from SOL to ZEC with a deposit address,
// /near/swap-zec one from ZEC to SOL, and /near/status gives the state. The page never calls NEAR
// Intents itself.
import { SWAP_ASSETS } from './swap-preview-model.js';

const INTEGER = /^\d{1,40}$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// A transparent mainnet address of Zcash: the deposit address of a swap from ZEC. The engine checks
// its checksum before a payment.
const T_ADDRESS = /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/;
// The live route of each origin asset, and the form of its deposit address.
const LIVE_ROUTES = Object.freeze({
  sol: { path: '/near/swap', deposit: SOL_ADDRESS },
  zec: { path: '/near/swap-zec', deposit: T_ADDRESS },
});
const MESSAGES = Object.freeze({
  'no-route': 'NEAR Intents has no route for this pair and amount. Try another pair or amount.',
  'busy': 'Too many quote requests from this network. Wait a minute, then refresh the quote.',
  'unavailable': 'NEAR Intents did not give a quote. Refresh the quote to try again.',
  'off': 'Live swaps are off on this server.',
});
// A live quote holds the two addresses, so a refusal can come from one of them.
const SWAP_REFUSED = 'NEAR Intents refused this swap. Check the amount and the refund address.';
const STATES = new Set(['KNOWN_DEPOSIT_TX', 'PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT',
  'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED', 'unknown', 'other']);

/**
 * An error with a `code`: 'too-low' (with `minAmount`), 'no-route', 'busy', 'unavailable' or
 * 'off'.
 */
export class NearQuoteError extends Error {
  constructor(code, minAmount = '', message = MESSAGES[code] ?? code) {
    super(message);
    this.code = code; this.minAmount = minAmount;
  }
}

const optionalNumber = (value) => (typeof value === 'number' && Number.isFinite(value)
  ? value : undefined);
const optionalText = (value) => (typeof value === 'string' ? value : undefined);

// The quote of an answer of the Worker, or null when the answer is not a quote.
function quoteOf(body) {
  const amounts = ['amountIn', 'amountOut', 'minAmountOut'].map((k) => body?.[k]);
  if (!amounts.every((v) => typeof v === 'string' && INTEGER.test(v))) return null;
  const [amountIn, amountOut, minAmountOut] = amounts;
  return Object.freeze({ amountIn, amountOut, minAmountOut,
    amountInUsd: optionalNumber(body.amountInUsd), amountOutUsd: optionalNumber(body.amountOutUsd),
    timeEstimate: optionalNumber(body.timeEstimate),
    quotedAt: typeof body.quotedAt === 'string' ? body.quotedAt : undefined });
}

// The live swap of an answer of the Worker, or null when it is not the swap that was asked for.
function swapOf(body, ask, route) {
  const quote = quoteOf(body);
  const sound = [quote?.amountIn === ask.amount, route.deposit.test(body?.depositAddress),
    !Number.isNaN(Date.parse(body?.deadline)), body?.recipient === ask.recipient,
    body?.refundTo === ask.refundTo];
  if (!sound.every(Boolean)) return null;
  return Object.freeze({ ...quote, depositAddress: body.depositAddress, deadline: body.deadline,
    timeWhenInactive: optionalText(body.timeWhenInactive), recipient: body.recipient,
    refundTo: body.refundTo, correlationId: optionalText(body.correlationId),
    signature: optionalText(body.signature) });
}

const hashes = (list) => (Array.isArray(list) ? list.filter((h) => typeof h === 'string') : []);
// The swap that the deposit address belongs to (nearStatusSwap of cf/src/near.js): its text
// fields only.
const SWAP_FIELDS = ['from', 'to', 'recipient', 'refundTo', 'amountIn', 'deadline'];
const swapFieldsOf = (swap) => Object.freeze(Object.fromEntries(SWAP_FIELDS
  .filter((k) => typeof swap?.[k] === 'string').map((k) => [k, swap[k]])));
// The state of a swap of an answer of the Worker, or null when the answer is not a state.
function statusOf(body) {
  if (!STATES.has(body?.status)) return null;
  const amounts = Object.fromEntries(['amountOut', 'refundedAmount']
    .filter((k) => INTEGER.test(body[k] ?? '')).map((k) => [k, body[k]]));
  return Object.freeze({ status: body.status, originTxs: hashes(body.originTxs),
    destinationTxs: hashes(body.destinationTxs), refundReason: optionalText(body.refundReason),
    swap: swapFieldsOf(body.swap), ...amounts });
}

// The error of a refusal. The Worker answers 400 with a JSON code, 429 and 502 for the rest.
function refusal(res, body) {
  const code = res.status === 400 ? body?.error : null;
  if (code === 'too-low' && INTEGER.test(body.minAmount)) {
    return new NearQuoteError(code, body.minAmount);
  }
  if (code === 'no-route') return new NearQuoteError(code);
  return new NearQuoteError(res.status === 429 ? 'busy' : 'unavailable');
}

// The error of a refused live swap: 404 says that the server runs no live swaps.
function swapRefusal(res, body) {
  if (res.status === 404) return new NearQuoteError('off');
  const error = refusal(res, body);
  return error.code === 'no-route' ? new NearQuoteError('no-route', '', SWAP_REFUSED) : error;
}

export class NearIntentsSwapProvider {
  /** `fetchFn` is for tests; the default is the fetch of the page. */
  constructor(fetchFn = (...args) => globalThis.fetch(...args)) { this.fetchFn = fetchFn; }
  async supportedAssets() { return SWAP_ASSETS; }
  // { res, body } of a call to the Worker (body is null when it is no JSON).
  async call(url, ask) {
    const init = ask ? { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(ask) }
      : { cache: 'no-store' };
    try {
      const res = await this.fetchFn(url, init);
      return { res, body: await res.json().catch(() => null) };
    } catch {
      throw new NearQuoteError('unavailable');
    }
  }
  async previewQuote(input) {
    const key = (id) => SWAP_ASSETS.find((a) => a.id === id)?.key;
    const ask = { from: key(input.originAssetId), to: key(input.destinationAssetId),
      amount: input.amountAtomic, slippageBps: input.slippageBps };
    const { res, body } = await this.call('/near/quote', ask);
    const quote = res.status === 200 ? quoteOf(body) : null;
    if (quote) return quote;
    throw res.status === 200 ? new NearQuoteError('unavailable') : refusal(res, body);
  }
  /**
   * A live swap from `from` ('sol' to ZEC, or 'zec' to SOL): the quote with its deposit address,
   * deadline and addresses.
   */
  async openSwap({ from = 'sol', amountAtomic, slippageBps, recipient, refundTo }) {
    const route = LIVE_ROUTES[from];
    if (!route) throw new NearQuoteError('no-route');
    const ask = { amount: amountAtomic, recipient, refundTo, slippageBps };
    const { res, body } = await this.call(route.path, ask);
    const swap = res.status === 200 ? swapOf(body, ask, route) : null;
    if (swap) return swap;
    throw res.status === 200 ? new NearQuoteError('unavailable') : swapRefusal(res, body);
  }
  /** The state of a live swap. A swap that NEAR Intents does not list yet is 'unknown'. */
  async swapStatus(depositAddress) {
    const { res, body } = await this.call('/near/status?depositAddress='
      + encodeURIComponent(depositAddress));
    if (res.status === 404 && body?.error === 'unknown') return statusOf({ status: 'unknown' });
    const status = res.status === 200 ? statusOf(body) : null;
    if (status) return status;
    throw new NearQuoteError(res.status === 429 ? 'busy' : 'unavailable');
  }
}
