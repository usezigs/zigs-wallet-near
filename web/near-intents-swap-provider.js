// Live NEAR Intents quotes through /near/quote of the Zigs Worker (cf/src/near.js). Every quote
// is a dry quote of mainnet prices: no funds move and there is no execution. The page never calls
// NEAR Intents itself, and it sends no address.
import { SWAP_ASSETS } from './swap-preview-model.js';

const INTEGER = /^\d{1,40}$/;
const MESSAGES = Object.freeze({
  'no-route': 'NEAR Intents has no route for this pair and amount. Try another pair or amount.',
  'busy': 'Too many quote requests from this network. Wait a minute, then refresh the quote.',
  'unavailable': 'NEAR Intents did not give a quote. Refresh the quote to try again.',
});

/** An error with a `code`: 'too-low' (with `minAmount`), 'no-route', 'busy' or 'unavailable'. */
export class NearQuoteError extends Error {
  constructor(code, minAmount = '') {
    super(MESSAGES[code] ?? code);
    this.code = code; this.minAmount = minAmount;
  }
}

const optionalNumber = (value) => (typeof value === 'number' && Number.isFinite(value)
  ? value : undefined);

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

// The error of a refusal. The Worker answers 400 with a JSON code, 429 and 502 for the rest.
function refusal(res, body) {
  const code = res.status === 400 ? body?.error : null;
  if (code === 'too-low' && INTEGER.test(body.minAmount)) {
    return new NearQuoteError(code, body.minAmount);
  }
  if (code === 'no-route') return new NearQuoteError(code);
  return new NearQuoteError(res.status === 429 ? 'busy' : 'unavailable');
}

export class NearIntentsSwapProvider {
  /** `fetchFn` is for tests; the default is the fetch of the page. */
  constructor(fetchFn = (...args) => globalThis.fetch(...args)) { this.fetchFn = fetchFn; }
  async supportedAssets() { return SWAP_ASSETS; }
  async previewQuote(input) {
    const key = (id) => SWAP_ASSETS.find((a) => a.id === id)?.key;
    const ask = { from: key(input.originAssetId), to: key(input.destinationAssetId),
      amount: input.amountAtomic, slippageBps: input.slippageBps };
    let res, body = null;
    try {
      res = await this.fetchFn('/near/quote', { method: 'POST', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(ask) });
      body = await res.json().catch(() => null);
    } catch {
      throw new NearQuoteError('unavailable');
    }
    const quote = res.status === 200 ? quoteOf(body) : null;
    if (quote) return quote;
    throw res.status === 200 ? new NearQuoteError('unavailable') : refusal(res, body);
  }
}
