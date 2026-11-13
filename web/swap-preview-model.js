// The state of the swap page. It keeps data in memory only: no wallet, storage or signer. A
// provider gives the quotes: NEAR Intents for the swap page, MockSwapProvider for the demos. The
// live swap from SOL to ZEC (openSwap) is paid from a wallet outside Zigs, so Zigs signs nothing.
// A live swap from ZEC to SOL is paid by a group payment that the page proposes after openSwap.
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
export const SWAP_STATUS_MS = 10_000; // the wait between two reads of the state of a live swap
export const SWAP_STATUS_MAX_MS = 60_000; // the longest wait: after errors and after the deadline
// A swap that the group pays waits hours for its approvals, so its state is read once a minute.
export const SWAP_GROUP_STATUS_MS = SWAP_STATUS_MAX_MS;
export const SWAP_FINAL = Object.freeze(['SUCCESS', 'REFUNDED', 'FAILED']);
const SWAP_WAITING = ['unknown', 'PENDING_DEPOSIT'];
const STATUS_DOWN = 'The state of the swap is not available now. Zigs asks again.';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// The ask of a live swap. Only a swap from SOL that the plain Solana wallet pays carries `group`,
// so the asks of the other routes stay as they were.
function swapAsk(s, from, where) {
  const ask = { from, amountAtomic: s.quote.amountIn, slippageBps: s.slippageBps,
    recipient: where.recipient, refundTo: where.refundTo };
  return from === 'sol' && where.group === true ? { ...ask, group: true } : ask;
}
// The state of an open live swap. A swap that the group pays is read less often.
function liveOf(swap, from, group, wallet) {
  const base = group ? SWAP_GROUP_STATUS_MS : SWAP_STATUS_MS;
  return { swap, from, group, wallet, status: null, statusError: '', base, wait: base,
    timer: null };
}

/** True when `text` is base58 of exactly 32 bytes: the form of a Solana address. */
export function swapSolAddress(text) {
  if (typeof text !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return false;
  let value = 0n;
  for (const c of text) value = value * 58n + BigInt(BASE58.indexOf(c));
  const zeros = /^1*/.exec(text)[0].length;
  return zeros + (value ? Math.ceil(value.toString(16).length / 2) : 0) === 32;
}

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
  return amountError(s.amount, from) || fixtureBalanceError(s.amount, from, fixture);
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
      phase: 'IDLE', live: null, swapError: '' };
  }
  emit() { this.changed(this.value); }
  applyInput(patch = {}) {
    for (const key of ['from', 'to', 'amount', 'slippageBps'])
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
  // The destination is a demo field. It cannot change a price, so it keeps the quote.
  chooseDestination(destination) { this.value.destination = destination; this.emit(); }
  stale(message = CLEARED_QUOTE) {
    this.drop();
    Object.assign(this.value, { quote: null, phase: 'QUOTE_STALE', error: message });
    this.emit();
  }
  review() {
    if (!this.value.quote || this.value.phase !== 'QUOTE_READY') return false;
    this.value.phase = 'REVIEW_OPEN'; this.value.swapError = ''; this.emit(); return true;
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
  // The live swap: one at a time, in memory only. It lives apart from the quote: the expiry of
  // the quote, typing and stale() keep it. Only closeSwap() ends it. `where` holds the payout
  // address (recipient), the name of the wallet and the refund address. `group` says
  // that the plain Solana wallet pays a swap from SOL (docs/sol-to-zec-group.md).
  async openSwap(where) {
    const s = this.value;
    if (s.live || s.phase !== 'REVIEW_OPEN') return false;
    const from = swapAsset(s.from).key;
    const asking = { asking: true };
    s.live = asking; s.swapError = ''; this.emit();
    const ask = swapAsk(s, from, where);
    const swap = await this.provider.openSwap(ask).catch((error) => error);
    if (s.live !== asking) return false;
    if (swap instanceof Error) return this.swapFailed(this.failure(swap));
    s.live = liveOf(swap, from, ask.group === true, where.wallet);
    // The page must hide the address at the deadline, also when no read falls on it.
    const left = Math.max(0, Date.parse(swap.deadline) - this.clock.now());
    s.live.end = this.clock.set(() => this.emit(), left);
    if (s.phase === 'REVIEW_OPEN') s.phase = 'QUOTE_READY';
    this.emit();
    void this.readSwap(s.live);
    return true;
  }
  swapFailed(message) {
    Object.assign(this.value, { live: null, swapError: message });
    this.emit();
    return false;
  }
  // Reads the state until it is final. An error doubles the wait, up to SWAP_STATUS_MAX_MS.
  async readSwap(live) {
    try {
      const status = await this.provider.swapStatus(live.swap.depositAddress);
      if (this.value.live !== live) return;
      Object.assign(live, { status, statusError: '', wait: live.base });
    } catch {
      if (this.value.live !== live) return;
      Object.assign(live, { statusError: STATUS_DOWN,
        wait: Math.min(live.wait * 2, SWAP_STATUS_MAX_MS) });
    }
    if (SWAP_FINAL.includes(live.status?.status)) {
      this.clock.clear(live.end);
    } else {
      const late = this.clock.now() >= Date.parse(live.swap.deadline);
      live.timer = this.clock.set(() => { void this.readSwap(live); },
        late ? SWAP_STATUS_MAX_MS : live.wait);
    }
    this.emit();
  }
  /** True when the deadline of the open swap has passed and NEAR Intents saw no deposit. */
  swapExpired() {
    const live = this.value.live;
    if (!live?.swap || this.clock.now() < Date.parse(live.swap.deadline)) return false;
    return SWAP_WAITING.includes(live.status?.status ?? 'unknown');
  }
  closeSwap() {
    this.clock.clear(this.value.live?.timer);
    this.clock.clear(this.value.live?.end);
    Object.assign(this.value, { live: null, swapError: '' });
    this.emit();
  }
}
