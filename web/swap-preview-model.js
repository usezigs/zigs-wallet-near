// The state of the swap page. It keeps data in memory only: no wallet, storage or signer. A
// provider gives the quotes: NEAR Intents for the swap page, MockSwapProvider for the demos.
/**
 * @typedef {'IDLE'|'INPUT_VALID'|'QUOTING'|'QUOTE_READY'|'QUOTE_ERROR'|'QUOTE_STALE'|'REVIEW_OPEN'
 *   |'REVIEW_CANCELLED'|'DEMO_PROGRESS'|'DEMO_COMPLETE'} SwapUiState
 * @typedef {{originAssetId:string, destinationAssetId:string, amountAtomic:string,
 *   slippageBps:number}} SwapQuoteInput
 * @typedef {{amountIn:string, amountOut:string, minAmountOut:string, amountInUsd?:number,
 *   amountOutUsd?:number, timeEstimate?:number, quotedAt?:string}} SwapQuote
 * @typedef {{supportedAssets:()=>Promise<readonly object[]>,
 *   previewQuote:(input:SwapQuoteInput)=>Promise<SwapQuote>}} SwapProvider
 */

// The ids are the asset ids of NEAR Intents. Never key on a symbol: ZEC has five ids there.
export const SWAP_ASSETS = Object.freeze([
  { id: 'nep141:zec.omft.near', key: 'zec', symbol: 'ZEC', name: 'Zcash', network: 'Zcash',
    decimals: 8, icon: '/assets/zcash.svg', tone: 'zec' },
  { id: 'nep141:sol.omft.near', key: 'sol', symbol: 'SOL', name: 'Solana', network: 'Solana',
    decimals: 9, icon: '/assets/solana.svg', tone: 'sol' },
  { id: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', key: 'usdc',
    symbol: 'USDC', name: 'USD Coin', network: 'Solana', decimals: 6, icon: '/assets/usdc.svg',
    tone: 'usdc' },
].map(Object.freeze));
export const swapAsset = (id) => SWAP_ASSETS.find((a) => a.id === id);
const scale = (asset) => 10n ** BigInt(asset.decimals);
export const SWAP_SLIPPAGES = Object.freeze([50, 100, 200]);
export const SWAP_QUOTE_TTL_MS = 60_000; // a quote older than this is cleared
export const SWAP_TYPING_MS = 400; // the wait after the last key before a quote request
const OLD_QUOTE = 'The quote is older than 60 seconds. Refresh the quote to continue.';
const CLEARED_QUOTE = 'The quote was cleared. Refresh the quote to continue.';
const DEMO_PHASES = ['DEMO_PROGRESS', 'DEMO_COMPLETE'];

// Integer arithmetic keeps precision validation and tiny outputs honest.
export function swapAtomic(text, asset) {
  if (typeof text !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || text.length > 60) {
    return null;
  }
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > asset.decimals) return null;
  return BigInt(whole || '0') * scale(asset) + BigInt(fraction.padEnd(asset.decimals, '0'));
}
export function swapDecimal(atomic, asset) {
  const value = BigInt(atomic), base = scale(asset);
  const fraction = (value % base).toString().padStart(asset.decimals, '0').replace(/0+$/, '');
  return (value / base).toString() + (fraction ? '.' + fraction : '');
}
// The rate of a quote, from the amounts in and out: how much `to` one `from` buys.
export function swapRate(quote, from, to) {
  const paid = BigInt(quote.amountIn);
  if (paid === 0n) return '';
  const places = 12;
  const fixed = BigInt(quote.amountOut) * scale(from) * 10n ** BigInt(places) / (paid * scale(to));
  return swapDecimal(fixed, { decimals: places });
}
export const swapUsd = (value) => (typeof value === 'number'
  ? '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '—');
export function swapTime(seconds) {
  if (typeof seconds !== 'number') return '—';
  return seconds < 90 ? 'about ' + Math.round(seconds) + ' seconds'
    : 'about ' + Math.round(seconds / 60) + ' minutes';
}

export function swapInputError(s, fixture) {
  const from = swapAsset(s.from), to = swapAsset(s.to);
  if (!from || !to) return 'Choose an asset on each side.';
  if (s.from === s.to) return 'Choose different assets or networks.';
  if (!s.amount) return '';
  return amountError(s.amount, from) || fixtureBalanceError(s.amount, from, fixture)
    || (!s.destination ? 'Choose a destination.' : '');
}
function amountError(text, from) {
  const amount = swapAtomic(text, from);
  if (amount === null) {
    return 'Enter a decimal amount with up to ' + from.decimals + ' decimal places.';
  }
  if (amount <= 0n) return 'Enter an amount greater than zero.';
  if (amount > 1000000000n * scale(from)) return 'This amount is above the limit of this page.';
  return '';
}
function fixtureBalanceError(text, from, fixture = {}) {
  if (fixture.staleBalance) return 'The fixture balance is out of date. Refresh the fixture first.';
  if (fixture.balanceAtomic != null && swapAtomic(text, from) > BigInt(fixture.balanceAtomic)) {
    return 'Insufficient fixture balance. No real wallet balance is used.';
  }
  return '';
}

// The fake prices of the demos. They give no price of the real market.
const MOCK_BASIS = Object.freeze({ zec: 80, sol: 160, usdc: 1 });
function validMockInput(input) {
  const from = swapAsset(input.originAssetId), to = swapAsset(input.destinationAssetId);
  return !!from && !!to && from.id !== to.id && SWAP_SLIPPAGES.includes(input.slippageBps)
    && /^\d+$/.test(input.amountAtomic) && BigInt(input.amountAtomic) > 0n;
}

/** Deterministic fixtures only. Scenario injection is for the isolated test harness. */
export class MockSwapProvider {
  constructor(fixture = {}) { this.fixture = fixture; }
  async supportedAssets() { return SWAP_ASSETS; }
  async previewQuote(input) {
    if (this.fixture.fail) throw Error('The demo quote is unavailable. Try again.');
    if (this.fixture.unsupported) throw Error('This demo pair has no route. Choose another pair.');
    if (!validMockInput(input)) throw Error('Invalid demo input. No quote was requested.');
    const from = swapAsset(input.originAssetId), to = swapAsset(input.destinationAssetId);
    const worth = BigInt(input.amountAtomic) * BigInt(MOCK_BASIS[from.key]) * scale(to);
    const output = worth / (BigInt(MOCK_BASIS[to.key]) * scale(from));
    const minimum = output * BigInt(10000 - input.slippageBps) / 10000n;
    if (minimum <= 0n) throw Error('This amount is too small for the demo destination precision.');
    return Object.freeze({ source: 'demo', amountIn: input.amountAtomic,
      amountOut: String(output), minAmountOut: String(minimum) });
  }
}

export const SWAP_DEMO_STEPS = Object.freeze([
  'Quote review', 'Source authorisation', 'Deposit observed', 'Route processing',
  'Destination delivery',
]);

const realClock = () => ({ now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id) });

export class SwapPreviewModel {
  /** `clock` is { now, set, clear }; the tests give it fake time. */
  constructor(provider = new MockSwapProvider(), changed = () => {}, clock = realClock()) {
    this.provider = provider; this.changed = changed; this.clock = clock; this.revision = 0;
    this.timers = { typing: null, expiry: null }; this.quotedAt = 0;
    this.value = { from: SWAP_ASSETS[0].id, to: SWAP_ASSETS[1].id, amount: '',
      slippageBps: 50, destination: 'example', quote: null, error: '', step: 0,
      phase: 'IDLE' };
  }
  emit() { this.changed(this.value); }
  applyInput(patch = {}) {
    for (const key of ['from', 'to', 'amount', 'slippageBps', 'destination'])
      if (Object.hasOwn(patch, key)) this.value[key] = patch[key];
    const s = this.value;
    s.quote = null; s.step = 0; s.error = swapInputError(s, this.provider.fixture);
    s.phase = s.error ? 'QUOTE_ERROR' : s.amount ? 'INPUT_VALID' : 'IDLE';
    this.emit();
  }
  // Ends the open work: the wait, the expiry and any answer in flight. Returns the new revision.
  drop() {
    for (const name of ['typing', 'expiry']) {
      this.clock.clear(this.timers[name]); this.timers[name] = null;
    }
    return ++this.revision;
  }
  begin(patch) {
    const revision = this.drop();
    this.applyInput(patch);
    return revision;
  }
  async update(patch) { await this.request(this.begin(patch)); }
  // Typing: the input shows at once and the quote request waits for the last key.
  type(amount) {
    const revision = this.begin({ amount });
    if (this.value.error || !this.value.amount) return;
    this.timers.typing = this.clock.set(() => { void this.request(revision); }, SWAP_TYPING_MS);
  }
  async request(revision) {
    const s = this.value;
    if (revision !== this.revision || s.error || !s.amount) return;
    s.phase = 'QUOTING'; this.emit();
    try {
      const quote = await this.provider.previewQuote({ originAssetId: s.from,
        destinationAssetId: s.to, amountAtomic: String(swapAtomic(s.amount, swapAsset(s.from))),
        slippageBps: s.slippageBps });
      if (revision !== this.revision) return;
      s.quote = quote; s.phase = 'QUOTE_READY'; this.quotedAt = this.clock.now();
      // A demo quote is no price, so it does not age.
      if (quote.source !== 'demo') {
        this.timers.expiry = this.clock.set(() => this.expire(revision), SWAP_QUOTE_TTL_MS);
      }
    } catch (error) {
      if (revision !== this.revision) return;
      s.error = this.failure(error); s.phase = 'QUOTE_ERROR';
    }
    this.emit();
  }
  failure(error) {
    if (error.code !== 'too-low') return error.message;
    const from = swapAsset(this.value.from);
    return 'NEAR Intents needs at least ' + swapDecimal(error.minAmount, from) + ' ' + from.symbol
      + ' for this route.';
  }
  // A simulation keeps its quote until the person leaves it: exitSimulation checks the age.
  expire(revision) {
    this.timers.expiry = null;
    const demo = DEMO_PHASES.includes(this.value.phase);
    if (revision === this.revision && !demo) this.stale(OLD_QUOTE);
  }
  reverse() { return this.update({ from: this.value.to, to: this.value.from }); }
  stale(message = CLEARED_QUOTE) {
    this.drop();
    Object.assign(this.value, { quote: null, phase: 'QUOTE_STALE', error: message });
    this.emit();
  }
  review() {
    if (!this.value.quote || this.value.phase !== 'QUOTE_READY') return false;
    this.value.phase = 'REVIEW_OPEN'; this.emit(); return true;
  }
  cancelReview() {
    if (this.value.phase === 'REVIEW_OPEN') { this.value.phase = 'REVIEW_CANCELLED'; this.emit(); }
  }
  resume() {
    if (this.value.phase === 'REVIEW_CANCELLED') { this.value.phase = 'QUOTE_READY'; this.emit(); }
  }
  simulate() {
    if (this.value.phase !== 'REVIEW_OPEN') return;
    this.value.phase = 'DEMO_PROGRESS'; this.value.step = 0; this.emit();
  }
  advance() {
    if (this.value.phase !== 'DEMO_PROGRESS') return;
    this.value.step++;
    if (this.value.step === SWAP_DEMO_STEPS.length) this.value.phase = 'DEMO_COMPLETE';
    this.emit();
  }
  exitSimulation() {
    if (!DEMO_PHASES.includes(this.value.phase)) return;
    this.value.step = 0;
    const old = this.clock.now() - this.quotedAt >= SWAP_QUOTE_TTL_MS;
    if (old && this.value.quote.source !== 'demo') { this.stale(OLD_QUOTE); return; }
    this.value.phase = 'QUOTE_READY'; this.emit();
  }
}
