import assert from 'node:assert/strict';
import { MockSwapProvider, SwapPreviewModel, SWAP_ASSETS, SWAP_DEMO_STEPS, SWAP_QUOTE_TTL_MS,
  SWAP_GROUP_STATUS_MS, SWAP_STATUS_MAX_MS, SWAP_STATUS_MS, SWAP_TYPING_MS, swapAtomic,
  swapDecimal, swapRate,
  swapSolAddress, swapTime, swapUsd } from '../swap-preview-model.js';
import { readFileSync } from 'node:fs';
import { NearIntentsSwapProvider, NearQuoteError } from '../near-intents-swap-provider.js';
import { loadRig, sleep, storage } from './sol-rig.mjs';

const [zec, sol, usdcSol] = SWAP_ASSETS;
assert.deepEqual(SWAP_ASSETS.map((a) => a.symbol), ['ZEC', 'SOL', 'USDC']);
assert.deepEqual(SWAP_ASSETS.map((a) => a.icon), ['/assets/zcash.svg', '/assets/solana.svg', '/assets/usdc.svg']);
// The ids are the asset ids of NEAR Intents, never a symbol. The keys are the ones of the Worker.
assert.deepEqual(SWAP_ASSETS.map((a) => a.id), ['nep141:zec.omft.near', 'nep141:sol.omft.near',
  'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near']);
assert.deepEqual(SWAP_ASSETS.map((a) => a.key), ['zec', 'sol', 'usdc']);
assert.deepEqual(SWAP_ASSETS.map((a) => a.decimals), [8, 9, 6]);
assert.equal(SWAP_ASSETS.some((a) => 'basis' in a), false, 'no asset holds a fake price');
assert.equal(usdcSol.network, 'Solana');
assert.equal(swapAtomic('1.000000001', zec), null);
assert.equal(swapAtomic('1e3', zec), null);
assert.equal(swapAtomic('-1', zec), null);
assert.equal(swapAtomic(' 1 ', zec), null);
assert.equal(swapAtomic('0.00000001', zec), 1n);
assert.equal(swapDecimal(swapAtomic('123.123456789', sol), sol), '123.123456789');

// ── The numbers of a live quote: the rate from the amounts, the USD value and the time ──
const live = Object.freeze({ amountIn: '100000000', amountOut: '12562715651',
  minAmountOut: '12437088494', amountInUsd: 1267.36, amountOutUsd: 1266.447364777,
  timeEstimate: 452, quotedAt: '2026-10-28T16:56:50.074Z' });
assert.equal(swapRate(live, zec, sol), '12.562715651', '1 ZEC buys 12.562715651 SOL');
assert.equal(swapRate({ amountIn: '100000000', amountOut: '7805728' }, usdcSol, zec), '0.0007805728');
assert.equal(swapRate({ amountIn: '0', amountOut: '5' }, zec, sol), '', 'no rate for an amount of 0');
assert.equal(swapUsd(1267.36), '$1,267.36');
assert.equal(swapUsd(0), '$0.00');
assert.equal(swapUsd(undefined), '—');
assert.deepEqual([swapTime(17), swapTime(135), swapTime(452), swapTime(undefined)],
  ['about 17 seconds', 'about 2 minutes', 'about 8 minutes', '—']);

// ── The model with the demo provider ──
const phases = [], model = new SwapPreviewModel(undefined, (s) => phases.push(s.phase));
assert.equal(model.value.phase, 'IDLE');
assert.equal(model.review(), false);
await model.update({ amount: '1.25' });
assert.equal(model.value.phase, 'QUOTE_READY');
assert(phases.includes('INPUT_VALID') && phases.includes('QUOTING'));
assert.equal(swapDecimal(model.value.quote.amountOut, sol), '0.625');
assert.equal(swapDecimal(model.value.quote.minAmountOut, sol), '0.621875');
assert.equal(model.review(), true);
model.cancelReview(); assert.equal(model.value.phase, 'REVIEW_CANCELLED');
model.resume(); model.review(); model.simulate();
assert.equal(model.value.step, 0); // No timer advances signing or network stages.
model.exitSimulation(); assert.equal(model.value.phase, 'QUOTE_READY');
model.review(); model.simulate();
for (const _ of SWAP_DEMO_STEPS) model.advance();
assert.equal(model.value.phase, 'DEMO_COMPLETE');
await model.reverse(); assert.equal(model.value.from, sol.id); assert.equal(model.value.to, zec.id);
model.review(); await model.update({ amount: '2' });
assert.equal(model.value.phase, 'QUOTE_READY');
await model.update({ to: sol.id }); assert.equal(model.value.quote, null);
assert.match(model.value.error, /different/);
await model.update({ to: zec.id, amount: '0' }); assert.match(model.value.error, /greater than zero/);
await model.update({ amount: '2' });
model.chooseDestination('');
assert.deepEqual([model.value.phase, model.value.error], ['QUOTE_READY', ''],
  'a destination asks for no new quote');
assert.equal(model.review(), true, 'no destination does not block a quote or its review');
assert.equal(model.review(), false, 'an open review does not open again');
model.cancelReview(); model.resume(); model.chooseDestination('example'); model.stale();
assert.equal(model.value.phase, 'QUOTE_STALE'); assert.equal(model.review(), false);
for (const [fixture, expected] of [[{ fail: true }, /unavailable/], [{ unsupported: true }, /no route/],
  [{ balanceAtomic: '1' }, /Insufficient fixture balance/], [{ staleBalance: true }, /out of date/]]) {
  const fixtureModel = new SwapPreviewModel(new MockSwapProvider(fixture));
  await fixtureModel.update({ amount: '1' });
  assert.equal(fixtureModel.value.quote, null); assert.match(fixtureModel.value.error, expected);
}
const tiny = new SwapPreviewModel();
await tiny.update({ from: sol.id, to: zec.id, amount: '0.000000001' });
assert.match(tiny.value.error, /too small/);
// A slower old quote may never overwrite a changed input or reopen review.
const waits = [], provider = new MockSwapProvider();
const delayed = new SwapPreviewModel({ previewQuote: (input) => new Promise((resolve) =>
  waits.push(async () => resolve(await provider.previewQuote(input)))) });
const first = delayed.update({ amount: '1' });
const second = delayed.update({ amount: '2' });
await waits[1](); await second; await waits[0](); await first;
assert.equal(delayed.value.quote.amountIn, '200000000');

// ── Fake time: a clock that moves only when the test says so ──
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fakeClock() {
  let now = 0, last = 0;
  const timers = new Map();
  return { now: () => now, get pending() { return timers.size; },
    set: (fn, ms) => { timers.set(++last, { at: now + ms, fn }); return last; },
    clear: (id) => timers.delete(id),
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((x, y) => x[1].at - y[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn(); await settle();
      }
      now = end;
    } };
}
// A provider that gives the quote of `live` and records what it was asked.
const asked = [];
const livePro = (extra = {}) => ({ async supportedAssets() { return SWAP_ASSETS; },
  async previewQuote(input) {
    asked.push(input);
    if (extra.fail) throw extra.fail;
    return live;
  } });

// ── Typing waits for the last key before it asks for a quote ──
{
  assert.equal(SWAP_TYPING_MS, 400, 'the wait after the last key is 400 ms');
  assert.equal(SWAP_QUOTE_TTL_MS, 60_000, 'a quote lives 60 s');
  const clock = fakeClock(), seen = [];
  const typed = new SwapPreviewModel(livePro(), (s) => seen.push(s.phase), clock);
  asked.length = 0;
  typed.type('1');
  assert.equal(typed.value.amount, '1', 'the input shows at once');
  assert.equal(typed.value.phase, 'INPUT_VALID', 'the input waits for the last key');
  await clock.tick(SWAP_TYPING_MS - 1);
  assert.equal(asked.length, 0, 'no request before the wait ends');
  typed.type('1.5');
  await clock.tick(SWAP_TYPING_MS - 1);
  assert.equal(asked.length, 0, 'another key starts the wait again');
  await clock.tick(1);
  assert.equal(asked.length, 1, 'one request after the last key');
  assert.deepEqual(asked[0], { originAssetId: zec.id, destinationAssetId: sol.id,
    amountAtomic: '150000000', slippageBps: 50 }, 'the input of the request holds no address');
  assert.equal(typed.value.phase, 'QUOTE_READY');
  assert.equal(typed.value.quote, live);
  // A key clears the quote at once, so the old quote cannot be reviewed during the wait.
  typed.type('2');
  assert.deepEqual([typed.value.quote, typed.review()], [null, false]);
  typed.type('');
  await clock.tick(SWAP_TYPING_MS);
  assert.deepEqual([asked.length, typed.value.phase], [1, 'IDLE'], 'an empty amount asks nothing');
  typed.type('1.2.3');
  assert.match(typed.value.error, /decimal amount/);
  await clock.tick(SWAP_TYPING_MS);
  assert.equal(asked.length, 1, 'an invalid amount asks nothing');
  // A change of the pair asks at once, with no wait.
  await typed.update({ amount: '1', to: usdcSol.id });
  assert.equal(asked.length, 2);
  assert.equal(asked[1].destinationAssetId, usdcSol.id);
  // The destination is a demo field: it changes no price, so it keeps the quote and asks nothing.
  typed.chooseDestination('');
  assert.deepEqual([asked.length, typed.value.phase, typed.value.destination],
    [2, 'QUOTE_READY', ''], 'a destination asks for no new quote');
  assert.equal(typed.review(), true);
  // A request that was open when a key came cannot show its answer.
  const slow = [];
  const raced = new SwapPreviewModel({ previewQuote: () => new Promise((r) => slow.push(r)) },
    () => {}, clock);
  const open = raced.update({ amount: '1' });
  raced.type('7');
  slow[0](live); await open;
  assert.deepEqual([raced.value.quote, raced.value.phase], [null, 'INPUT_VALID']);
  await clock.tick(SWAP_TYPING_MS + 1); slow[1]?.(live); await settle();
  assert.equal(raced.value.phase, 'QUOTE_READY');
  console.log('ok  typing waits for the last key; late answers are dropped');
}

// ── A quote older than 60 s is cleared ──
{
  const clock = fakeClock();
  const aging = new SwapPreviewModel(livePro(), () => {}, clock);
  await aging.update({ amount: '1' });
  assert.equal(aging.value.phase, 'QUOTE_READY');
  await clock.tick(SWAP_QUOTE_TTL_MS - 1);
  assert.equal(aging.value.phase, 'QUOTE_READY', 'a quote of 59.999 s stays');
  await clock.tick(1);
  assert.equal(aging.value.phase, 'QUOTE_STALE', 'a quote of 60 s is cleared');
  assert.equal(aging.value.quote, null);
  assert.match(aging.value.error, /older than 60 seconds\. Refresh the quote/);
  assert.equal(aging.review(), false);
  await aging.update();
  assert.equal(aging.value.phase, 'QUOTE_READY', 'a new request gives a new quote');
  assert.equal(clock.pending, 1, 'one expiry timer');
  // The review closes with the quote.
  aging.review();
  await clock.tick(SWAP_QUOTE_TTL_MS);
  assert.equal(aging.value.phase, 'QUOTE_STALE', 'an open review is cleared too');
  // A simulation keeps its quote while it runs and checks the age when the person leaves it.
  await aging.update(); aging.review(); aging.simulate();
  await clock.tick(SWAP_QUOTE_TTL_MS + 5);
  assert.equal(aging.value.phase, 'DEMO_PROGRESS', 'the simulation goes on');
  aging.exitSimulation();
  assert.equal(aging.value.phase, 'QUOTE_STALE', 'an old quote is cleared on exit');
  await aging.update(); aging.review(); aging.simulate();
  await clock.tick(SWAP_QUOTE_TTL_MS - 1);
  aging.exitSimulation();
  assert.equal(aging.value.phase, 'QUOTE_READY', 'a quote of 59.999 s is kept on exit');
  // New input ends the timer of the old quote.
  await aging.update({ amount: '3' });
  aging.type('4');
  assert.equal(clock.pending, 1, 'the typing timer only; the expiry timer is gone');
  await clock.tick(SWAP_TYPING_MS); await clock.tick(SWAP_QUOTE_TTL_MS - 1);
  assert.equal(aging.value.phase, 'QUOTE_READY');
  // A quote of the demo provider is no price, so it does not age.
  const still = fakeClock();
  const demo = new SwapPreviewModel(new MockSwapProvider(), () => {}, still);
  await demo.update({ amount: '1' });
  assert.equal(still.pending, 0, 'a demo quote sets no timer');
  await still.tick(10 * SWAP_QUOTE_TTL_MS);
  assert.equal(demo.value.phase, 'QUOTE_READY', 'a demo quote stays');
  demo.review(); demo.simulate(); await still.tick(SWAP_QUOTE_TTL_MS); demo.exitSimulation();
  assert.equal(demo.value.phase, 'QUOTE_READY', 'and it stays after a simulation');
  console.log('ok  a quote of 60 s is cleared; a simulation keeps it until the exit');
}

// ── The NEAR Intents provider: the page asks the Zigs server, never NEAR Intents ──
{
  const calls = [];
  let answer = () => Response.json({ ...live, depositAddress: 'must-not-pass' });
  const provider = new NearIntentsSwapProvider(async (url, init) => {
    calls.push({ url, init });
    return answer();
  });
  assert.deepEqual(await provider.supportedAssets(), SWAP_ASSETS);
  assert.equal(calls.length, 0, 'no call before a quote');
  const input = { originAssetId: zec.id, destinationAssetId: usdcSol.id, amountAtomic: '100000000',
    slippageBps: 100 };
  const quote = await provider.previewQuote(input);
  assert.equal(calls[0].url, '/near/quote', 'the Zigs server only');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.deepEqual(JSON.parse(calls[0].init.body),
    { from: 'zec', to: 'usdc', amount: '100000000', slippageBps: 100 }, 'the pair, amount, slippage');
  assert.deepEqual({ ...quote }, { ...live }, 'the quote holds the fields of the Worker');
  assert.equal(Object.isFrozen(quote), true);
  assert.equal('depositAddress' in quote, false, 'a field that is not allowed stays behind');
  const errors = {
    'a bad amount': () => Response.json({ ...live, amountOut: '1.5' }),
    'a missing amount': () => Response.json({ amountIn: '1' }),
    'a text body': () => new Response('<html>'),
    'a 502': () => Response.json({ error: 'unavailable' }, { status: 502 }),
    'a 500': () => new Response('x', { status: 500 }),
    'an error code that is not known': () => Response.json({ error: 'new' }, { status: 400 }),
    'a throw': () => { throw new TypeError('offline'); },
  };
  for (const [what, make] of Object.entries(errors)) {
    answer = make;
    await assert.rejects(provider.previewQuote(input), (e) =>
      e instanceof NearQuoteError && e.code === 'unavailable' && /did not give a quote/.test(e.message),
    what);
  }
  answer = () => Response.json({ error: 'no-route' }, { status: 400 });
  await assert.rejects(provider.previewQuote(input), (e) => e.code === 'no-route'
    && /no route/.test(e.message));
  answer = () => new Response('slow down', { status: 429 });
  await assert.rejects(provider.previewQuote(input), (e) => e.code === 'busy'
    && /Wait a minute/.test(e.message));
  answer = () => Response.json({ error: 'too-low', minAmount: '132000' }, { status: 400 });
  await assert.rejects(provider.previewQuote(input), (e) => e.code === 'too-low'
    && e.minAmount === '132000');
  answer = () => Response.json({ error: 'too-low', minAmount: '1.5' }, { status: 400 });
  await assert.rejects(provider.previewQuote(input), (e) => e.code === 'unavailable');
  // The model turns the minimum into a message with the amount and the symbol of the pay side.
  const tooLow = new SwapPreviewModel(livePro({ fail: new NearQuoteError('too-low', '132000') }),
    () => {}, fakeClock());
  await tooLow.update({ amount: '0.00001' });
  assert.equal(tooLow.value.error, 'NEAR Intents needs at least 0.00132 ZEC for this route.');
  assert.equal(tooLow.value.phase, 'QUOTE_ERROR');
  const gone = new SwapPreviewModel(livePro({ fail: new NearQuoteError('no-route') }),
    () => {}, fakeClock());
  await gone.update({ amount: '1' });
  assert.match(gone.value.error, /no route for this pair/);
  console.log('ok  the provider asks /near/quote and maps its answers and errors');
}

// ── The live swap from SOL to ZEC: the data of a swap that the tests below share ──
const UA = 'u1ddnjsdcpm36r6aq79n3s68shjweksnmwtdltrh046s8m6xcws9ygyawalxx8n6hg6vegk0wh8zjnafxgh6'
  + 'mspp' + 'jsljvyt0ynece3lvm0';
const REFUND = 'CZ8YUVdk7znjrUmnb5n7kgySk9yRAsQDYmyCxzfSky9t'; // 32 bytes
const SHORT_REFUND = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofL'; // 31 bytes
const DEPOSIT = '7DYCAhqwQSKqqL1h8V1XmY1BTcMWxrASQYKNMy87jeg3';
const DEADLINE_MS = 1_800_000; // the fake clocks start at 0
const solQuote = Object.freeze({ amountIn: '17500000', amountOut: '133000',
  minAmountOut: '131670', quotedAt: '1970-01-01T00:00:00.000Z' });
const opened = Object.freeze({ ...solQuote, depositAddress: DEPOSIT,
  deadline: new Date(DEADLINE_MS).toISOString(), recipient: UA, refundTo: REFUND,
  correlationId: 'c-1', signature: 'ed25519:5wQ' });
const where = { recipient: UA, refundTo: REFUND, room: '50000000', wallet: 'Savings' };
const stateOf = (status, more = {}) => ({ status, originTxs: [], destinationTxs: [], ...more });
// A provider of live swaps. `over.open(input)` and `over.status(n)` change its answers; n counts
// the reads of the state from 1.
function swapPro(over = {}) {
  const log = { open: [], reads: [] };
  return { log, async supportedAssets() { return SWAP_ASSETS; },
    async previewQuote() { return solQuote; },
    async openSwap(input) { log.open.push(input); return over.open ? over.open(input) : opened; },
    async swapStatus(address) {
      log.reads.push(address);
      return over.status ? over.status(log.reads.length) : stateOf('PENDING_DEPOSIT');
    } };
}
// A model with an open review of 0.0175 SOL to ZEC.
async function reviewed(pro, clock = fakeClock()) {
  const m = new SwapPreviewModel(pro, () => {}, clock);
  await m.update({ from: sol.id, to: zec.id, amount: '0.0175' });
  m.review();
  return m;
}

// ── The provider: /near/swap and /near/status of the Zigs server ──
{
  assert.equal(swapSolAddress(REFUND), true);
  assert.equal(swapSolAddress(SHORT_REFUND), false, 'base58 of 31 bytes is no Solana address');
  assert.equal(swapSolAddress('0' + REFUND.slice(1)), false);
  const calls = [];
  let answer = () => Response.json({ ...opened, extra: 'must-not-pass' });
  const provider = new NearIntentsSwapProvider(async (url, init) => {
    calls.push({ url, init });
    return answer();
  });
  const input = { amountAtomic: '17500000', slippageBps: 100, recipient: UA, refundTo: REFUND };
  const swap = await provider.openSwap(input);
  assert.deepEqual([calls[0].url, calls[0].init.method, calls[0].init.cache],
    ['/near/swap', 'POST', 'no-store']);
  assert.deepEqual(JSON.parse(calls[0].init.body),
    { amount: '17500000', recipient: UA, refundTo: REFUND, slippageBps: 100 });
  assert.equal(Object.isFrozen(swap), true);
  assert.deepEqual({ ...swap }, { ...opened, amountInUsd: undefined, amountOutUsd: undefined,
    timeEstimate: undefined, timeWhenInactive: undefined }, 'the fields of the live swap');
  for (const [what, edit] of [['another recipient', { recipient: UA.slice(0, -1) + 'q' }],
    ['another refund', { refundTo: DEPOSIT }], ['another amount', { amountIn: '17500001' }],
    ['no deposit address', { depositAddress: undefined }],
    ['an EVM deposit address', { depositAddress: '0x76b4c56085ED136a8744D52bE956396624a730E8' }],
    ['no deadline', { deadline: 'soon' }]]) {
    answer = () => Response.json({ ...opened, ...edit });
    await assert.rejects(provider.openSwap(input), (e) => e.code === 'unavailable', what);
  }
  for (const [what, make, check] of [
    ['404', () => new Response('Not found', { status: 404 }),
      (e) => e.code === 'off' && /off on this server/.test(e.message)],
    ['no-route', () => Response.json({ error: 'no-route' }, { status: 400 }),
      (e) => e.code === 'no-route' && /refused this swap\. Check the amount and the refund/
        .test(e.message)],
    ['too-low', () => Response.json({ error: 'too-low', minAmount: '17392641' }, { status: 400 }),
      (e) => e.code === 'too-low' && e.minAmount === '17392641'],
    ['429', () => new Response('x', { status: 429 }), (e) => e.code === 'busy'],
    ['502', () => Response.json({ error: 'unavailable' }, { status: 502 }),
      (e) => e.code === 'unavailable'],
    ['a throw', () => { throw new TypeError('offline'); }, (e) => e.code === 'unavailable'],
  ]) {
    answer = make;
    await assert.rejects(provider.openSwap(input), check, what);
  }
  // A swap from ZEC asks /near/swap-zec and takes a transparent deposit address only.
  const T1 = 't1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs', T3 = 't3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd';
  const fromZec = { from: 'zec', amountAtomic: '200000', slippageBps: 100, recipient: REFUND,
    refundTo: T3 };
  const zecOpened = { ...opened, amountIn: '200000', depositAddress: T1, recipient: REFUND,
    refundTo: T3 };
  calls.length = 0;
  answer = () => Response.json(zecOpened);
  assert.equal((await provider.openSwap(fromZec)).depositAddress, T1);
  assert.deepEqual([calls[0].url, JSON.parse(calls[0].init.body)], ['/near/swap-zec',
    { amount: '200000', recipient: REFUND, refundTo: T3, slippageBps: 100 }]);
  answer = () => Response.json({ ...zecOpened, depositAddress: DEPOSIT });
  await assert.rejects(provider.openSwap(fromZec), (e) => e.code === 'unavailable',
    'a Solana deposit address for a swap from ZEC');
  answer = () => Response.json(opened);
  await assert.rejects(provider.openSwap({ ...input, from: 'usdc' }), (e) => e.code === 'no-route');
  calls.length = 0;
  answer = () => Response.json({ status: 'SUCCESS', originTxs: ['s1', 5], destinationTxs: ['z1'],
    amountOut: '133100', refundedAmount: 'x', extra: 1 });
  assert.deepEqual({ ...(await provider.swapStatus(DEPOSIT)) }, { status: 'SUCCESS',
    originTxs: ['s1'], destinationTxs: ['z1'], refundReason: undefined, amountOut: '133100',
    swap: { plain: false } });
  const swapFields = { from: 'zec', to: 'sol', recipient: 'R', refundTo: 'T', amountIn: '5',
    amountOut: '133000', deadline: '2026-10-28T18:00:00.000Z' };
  answer = () => Response.json({ status: 'PENDING_DEPOSIT',
    swap: { ...swapFields, amountIn: 5, extra: 'x' } });
  const { amountIn: _skip, ...textOnly } = swapFields;
  assert.deepEqual({ ...(await provider.swapStatus(DEPOSIT)).swap }, { ...textOnly, plain: false },
    'the text fields of the swap of the deposit address');
  for (const [plain, kept] of [[true, true], ['true', false], [1, false]]) {
    answer = () => Response.json({ status: 'PENDING_DEPOSIT', swap: { ...swapFields, plain } });
    assert.equal((await provider.swapStatus(DEPOSIT)).swap.plain, kept, 'plain: ' + plain);
  }
  assert.deepEqual([calls[0].url, calls[0].init.method, calls[0].init.cache],
    ['/near/status?depositAddress=' + DEPOSIT, undefined, 'no-store'], 'a GET of the state');
  answer = () => Response.json({ error: 'unknown' }, { status: 404 });
  assert.equal((await provider.swapStatus(DEPOSIT)).status, 'unknown', 'a swap not listed yet');
  answer = () => Response.json(stateOf('other'));
  assert.equal((await provider.swapStatus(DEPOSIT)).status, 'other', 'a state the server marks other');
  for (const [what, make, code] of [['a 404 of a server with no live swap',
    () => new Response('Not found', { status: 404 }), 'unavailable'],
  ['a state that is not known', () => Response.json({ status: 'NEW' }), 'unavailable'],
  ['429', () => new Response('x', { status: 429 }), 'busy']]) {
    answer = make;
    await assert.rejects(provider.swapStatus(DEPOSIT), (e) => e.code === code, what);
  }
  console.log('ok  the provider asks /near/swap and /near/status and checks their answers');
}

// ── The model: one live swap, apart from the quote, read until its state is final ──
{
  const clock = fakeClock(), pro = swapPro();
  const m = new SwapPreviewModel(pro, () => {}, clock);
  await m.update({ from: sol.id, to: zec.id, amount: '0.0175' });
  assert.equal(await m.openSwap(where), false, 'no live swap without an open review');
  m.review();
  assert.equal(await m.openSwap({ ...where, room: '132999' }), false);
  assert.match(m.value.swapError, /over the warning level for unaudited mainnet wallets/,
    'a payout over the room is refused before the ask');
  assert.equal(pro.log.open.length, 0, 'and NEAR Intents is not asked');
  assert.equal(await m.openSwap(where), true);
  assert.deepEqual(pro.log.open, [{ from: 'sol', amountAtomic: '17500000', slippageBps: 50,
    recipient: UA, refundTo: REFUND }], 'the amount, the slippage and the two addresses');
  assert.deepEqual([m.value.live.swap, m.value.live.wallet, m.value.phase, m.value.swapError],
    [opened, 'Savings', 'QUOTE_READY', '']);
  await settle();
  assert.deepEqual(pro.log.reads, [DEPOSIT], 'the state is read at once');
  assert.equal(m.value.live.status.status, 'PENDING_DEPOSIT');
  await clock.tick(SWAP_STATUS_MS - 1);
  assert.equal(pro.log.reads.length, 1);
  await clock.tick(1);
  assert.equal(pro.log.reads.length, 2, 'then every 10 s');
  await clock.tick(SWAP_QUOTE_TTL_MS);
  assert.equal(m.value.phase, 'QUOTE_STALE', 'the quote ages');
  assert.equal(m.value.live.swap, opened, 'an old quote keeps the swap');
  m.stale(); await m.update({ amount: '1' }); m.type('2');
  assert.equal(m.value.live.swap, opened, 'stale(), new input and typing keep the swap');
  await clock.tick(SWAP_TYPING_MS);
  m.review();
  assert.equal(await m.openSwap(where), false, 'one live swap at a time');
  assert.equal(pro.log.open.length, 1);
  assert.equal(m.swapExpired(), false, 'not expired before the deadline');
  await clock.tick(DEADLINE_MS - clock.now());
  assert.equal(m.swapExpired(), true, 'expired at the deadline with no deposit');
  const reads = pro.log.reads.length;
  await clock.tick(SWAP_STATUS_MAX_MS);
  assert.ok(pro.log.reads.length - reads <= 2, 'after the deadline it reads every 60 s');
  m.closeSwap();
  assert.equal(m.value.live, null);
  const closed = pro.log.reads.length;
  await clock.tick(10 * SWAP_STATUS_MAX_MS);
  assert.equal(pro.log.reads.length, closed, 'a closed swap reads nothing');
  // A deposit after the deadline is no expiry: the swap goes on.
  const late = await reviewed(swapPro({ status: () => stateOf('KNOWN_DEPOSIT_TX') }));
  await late.openSwap(where); await settle();
  await late.clock.tick(DEADLINE_MS);
  assert.equal(late.swapExpired(), false, 'a seen deposit never expires');
  console.log('ok  the live swap opens once, keeps its life apart from the quote, and closes');
}
{
  // The deadline redraws the page also when no read of the state falls on it.
  const clock = fakeClock(), drawn = [];
  const m = new SwapPreviewModel(swapPro(), () => drawn.push(clock.now()), clock);
  await m.update({ from: sol.id, to: zec.id, amount: '0.0175' });
  m.review();
  await clock.tick(3_000);
  await m.openSwap(where); await settle();
  await clock.tick(DEADLINE_MS - clock.now());
  assert.ok(drawn.includes(DEADLINE_MS), 'the deadline redraws the page');
  assert.equal(m.swapExpired(), true);
  m.closeSwap();
  assert.equal(clock.pending, 0, 'a closed swap leaves no timer');
  console.log('ok  the deadline redraws the page');
}
{
  // An error doubles the wait up to 60 s; a final state ends the reads.
  const clock = fakeClock(), down = swapPro({ status: () => { throw new Error('down'); } });
  const m = await reviewed(down, clock);
  await m.openSwap(where); await settle();
  assert.equal(down.log.reads.length, 1);
  assert.match(m.value.live.statusError, /not available now\. Zigs asks again/);
  for (const [wait, total] of [[20_000, 2], [40_000, 3], [60_000, 4], [60_000, 5]]) {
    await clock.tick(wait - 1);
    assert.equal(down.log.reads.length, total - 1, 'no read before ' + wait + ' ms');
    await clock.tick(1);
    assert.equal(down.log.reads.length, total, 'a read after ' + wait + ' ms');
  }
  const steps = ['PENDING_DEPOSIT', 'PROCESSING', 'SUCCESS'];
  const done = swapPro({ status: (n) => stateOf(steps[Math.min(n, 3) - 1]) });
  const doneClock = fakeClock(), d = await reviewed(done, doneClock);
  await d.openSwap(where); await settle();
  await doneClock.tick(2 * SWAP_STATUS_MS);
  assert.equal(d.value.live.status.status, 'SUCCESS');
  await doneClock.tick(100 * SWAP_STATUS_MAX_MS);
  assert.equal(done.log.reads.length, 3, 'no read after a final state');
  assert.equal(doneClock.pending, 0, 'no timer is left');
  // The errors of the ask: the message of the provider, and the minimum in SOL.
  for (const [what, fail, message] of [
    ['too low', new NearQuoteError('too-low', '17392641'),
      'NEAR Intents needs at least 0.017392641 SOL for this route.'],
    ['off', new NearQuoteError('off'), 'Live swaps are off on this server.']]) {
    const m2 = await reviewed(swapPro({ open: () => { throw fail; } }));
    assert.equal(await m2.openSwap(where), false, what);
    assert.deepEqual([m2.value.live, m2.value.swapError, m2.value.phase],
      [null, message, 'REVIEW_OPEN'], what + ': the review stays open with the message');
  }
  const big = await reviewed(swapPro({ open: () => ({ ...opened, amountOut: '50000001' }) }));
  assert.equal(await big.openSwap(where), false,
    'a live payout over the room shows no deposit address');
  assert.deepEqual([big.value.live, /warning level/.test(big.value.swapError)], [null, true],
    'a live payout over the room shows no deposit address');
  // A swap closed while it is asked for, or while its state is read, ends there.
  let release;
  const slow = await reviewed(swapPro({ open: () => new Promise((r) => { release = r; }) }));
  const asked = slow.openSwap(where);
  slow.closeSwap(); release(opened);
  assert.deepEqual([await asked, slow.value.live], [false, null], 'a closed ask stays closed');
  let answer;
  // A swap from ZEC pays SOL: no ZEC room applies, and the ask names the origin.
  const zecPro = swapPro(), zm = new SwapPreviewModel(zecPro, () => {}, fakeClock());
  await zm.update({ from: zec.id, to: sol.id, amount: '0.002' });
  zm.review();
  assert.equal(await zm.openSwap({ ...where, room: '0' }), true, 'no room check from ZEC');
  assert.equal(zecPro.log.open[0].from, 'zec');
  assert.equal(zm.value.live.from, 'zec');
  const reading = swapPro({ status: () => new Promise((r) => { answer = r; }) });
  const readClock = fakeClock(), r = await reviewed(reading, readClock);
  await r.openSwap(where);
  r.closeSwap(); answer(stateOf('SUCCESS')); await settle();
  assert.deepEqual([r.value.live, readClock.pending], [null, 1], 'a late state is dropped');
  console.log('ok  errors slow the reads, a final state ends them, and late answers are dropped');
}

// ── The demos say what they are: the Tor demo, the funding checkout and the swap pages ──
// A small fake page: enough of the DOM to draw the real modules and to press their buttons.
await loadRig();
// The rig schedules one draw of the page (app-loop.js waits up to 120 ms). It runs here, on the
// document of the rig: the fake page below has no shell to draw.
await sleep(150);
const realDocument = globalThis.document;
const text = (n) => (n === null || n === undefined ? '' : n.text ?? n.kids.map(text).join(''));
const walk = (n, ok) => (n.kids
  ? [...(ok(n) ? [n] : []), ...n.kids.flatMap((k) => walk(k, ok))] : []);
const matcher = (sel) => {
  const shape = /^([a-z0-9]*)(?:#([\w-]+))?(?:\.([\w-]+))?$/;
  const [, tag = '', hash = '', cls = ''] = shape.exec(sel) ?? [];
  if (!tag && !hash && !cls) return () => false;
  return (n) => (!tag || n.tag === tag) && (!hash || n.id === hash)
    && (!cls || n.className.split(' ').includes(cls));
};
class FakeNode extends globalThis.Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, attrs: {}, kids: [], on: {}, className: '', id: '', value: '',
      style: { setProperty() {}, cssText: '' }, dataset: {}, hidden: false, disabled: false,
      open: false });
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'id') this.id = String(v);
    if (k === 'class') this.className = String(v);
  }
  getAttribute(k) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
  append(...nodes) { this.kids.push(...nodes.map((n) => (typeof n === 'string' ? { text: n } : n))); }
  replaceChildren(...nodes) { this.kids = nodes; }
  remove() {}
  focus() {}
  contains(n) { return n === this || walk(this, (k) => k === n).length > 0; }
  getBoundingClientRect() { return { left: 0, right: 10, top: 0, bottom: 10 }; }
  cloneNode() {
    const copy = new FakeNode(this.tag);
    return Object.assign(copy, { attrs: { ...this.attrs }, className: this.className,
      id: this.id, value: this.value, kids: [...this.kids] });
  }
  get lastChild() { return this.kids.at(-1); }
  get children() { return this.kids; }
  get textContent() { return text(this); }
  set textContent(v) { this.kids = [{ text: String(v) }]; }
  showModal() { this.open = true; }
  close() { this.open = false; (this.on.close ?? []).forEach((fn) => fn({})); }
  querySelectorAll(sel) {
    const tests = sel.split(',').map((one) => matcher(one.trim()));
    return walk(this, (n) => n !== this && tests.some((test) => test(n)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
const body = new FakeNode('body');
const fakeDocument = { body, activeElement: null, createElement: (tag) => new FakeNode(tag),
  createElementNS: (_, tag) => new FakeNode(tag), createTextNode: (t) => ({ text: String(t) }),
  querySelector: (sel) => body.querySelector(sel), getElementById: () => null };
const fire = (node, type, event = {}) => (node.on[type] ?? [])
  .forEach((fn) => fn({ currentTarget: node, target: node, preventDefault() {},
    stopPropagation() {}, ...event }));
const named = (root, label) => walk(root,
  (n) => n.tag === 'button' && text(n).startsWith(label))[0];
const press = (root, label) => {
  const b = named(root, label);
  assert.ok(b, 'a button "' + label + '" is on the page');
  fire(b, 'click');
};
const delay = () => new Promise((resolve) => setImmediate(resolve));
const realTimers = [globalThis.setTimeout, globalThis.clearTimeout];
Object.assign(globalThis, { document: fakeDocument, HTMLElement: FakeNode,
  MutationObserver: class { observe() {} },
  matchMedia: () => ({ matches: false }) });
try {
  // The Tor demo: a pill and a popup. Nothing here says that traffic is protected.
  globalThis.setTimeout = () => 1;
  globalThis.clearTimeout = () => {};
  const popup = await import('../network-privacy-popup.js');
  assert.match(popup.DEMO_NOTE, /No Tor connection is created; traffic stays direct/,
    'the preview disclosure keeps direct traffic explicit');
  const app = new FakeNode('div');
  app.id = 'app';
  const head = new FakeNode('header');
  app.append(head);
  const slot = new FakeNode('div');
  slot.id = 'privacy-slot';
  const page = { querySelector: (sel) => ({ '#app': app, '#privacy-slot': slot })[sel] ?? null };
  assert.equal(popup.hasPrivacyPopup(), false,
    'no popup is installed before the entry installs it');
  popup.installPrivacyPopup();
  popup.presentPrivacyStatus(page);
  const pill = walk(slot, (n) => n.className === 'pp-status')[0];
  assert.ok(pill, 'the Tor pill has one place: the slot of the side panel');
  assert.equal(walk(head, (n) => n.className === 'pp-status').length, 0,
    'a page header gets no Tor pill');
  // Wallet setup hides the side panel, so its header takes the pill.
  const setup = new FakeNode('div');
  setup.className = 'page guided-setup';
  const setupHead = new FakeNode('header');
  setupHead.className = 'guided-header';
  setup.append(setupHead);
  app.append(setup);
  popup.presentPrivacyStatus(page);
  assert.equal(walk(setupHead, (n) => n === pill).length, 1,
    'during wallet setup the pill is in the setup header');
  app.kids = [head];
  assert.equal(popup.TITLES.offer, 'See how a private route works.',
    'the offer says what the preview shows, not that it makes anything private');
  const dialog = body.querySelector('dialog');
  assert.equal(text(pill), popup.PILL_TEXT, 'the Tor pill says the demo');
  assert.doesNotMatch(text(pill) + pill.getAttribute('aria-label'), /protect|private route/i,
    'the Tor pill never says protected');
  assert.ok(pill.getAttribute('aria-label').includes(popup.DEMO_NOTE),
    'the Tor pill says that the connection is unchanged');
  assert.equal(dialog.open, false, 'the Tor demo does not open by itself');
  const screens = [];
  const look = () => { screens.push(text(dialog)); return text(dialog); };
  const open = () => fire(pill, 'click');
  open();
  assert.equal(dialog.open, true, 'the pill opens the Tor demo');
  assert.ok(look().includes(popup.TITLES.offer), 'the popup opens on the preview offer');
  press(dialog, 'Preview private connection'); look();
  press(dialog, 'Continue'); look();
  press(dialog, 'Skip animation');
  assert.ok(look().includes(popup.TITLES.success), 'the preview ends with its final screen');
  for (const screen of screens) {
    assert.doesNotMatch(screen, /protected|route is ready|private route is|Standard connection/i,
      'no popup screen says protected or ready: ' + screen.slice(0, 60));
    assert.ok(screen.includes(popup.DEMO_NOTE),
      'every popup screen says the connection is unchanged');
  }
  const closers = { 'the X button': () => fire(walk(dialog,
    node => node.attrs?.['aria-label'] === 'Close privacy preview')[0], 'click'),
    'the Not now button': () => press(dialog, 'Not now'),
    Escape: () => fire(dialog, 'keydown', { key: 'Escape' }),
    'the backdrop': () => fire(dialog, 'click', { clientX: -5, clientY: -5 }) };
  for (const stage of ['offer', 'connecting', 'camouflage', 'success']) {
    for (const [name, close] of Object.entries(closers)) {
      if (name === 'the Not now button' && stage !== 'offer') continue;
      open();
      if (stage !== 'offer') press(dialog, 'Preview private connection');
      if (stage === 'camouflage' || stage === 'success') press(dialog, 'Continue');
      if (stage === 'success') press(dialog, 'Skip animation');
      close();
      assert.equal(dialog.open, false, name + ' closes the popup in one step at ' + stage);
    }
  }
  open();
  assert.ok(text(dialog).includes(popup.TITLES.offer),
    'the popup opens on the offer again after a close');
  fire(dialog, 'close');
  dialog.open = false;
  assert.equal(popup.hasPrivacyPopup(), true, 'the entry can see that the popup is installed');
  assert.deepEqual([...storage.keys()].filter((key) => /privacy/i.test(key)), [],
    'the Tor demo stores no choice');
} finally {
  [globalThis.setTimeout, globalThis.clearTimeout] = realTimers;
}
try {
  // The funding checkout: a demo with no payment, never a step of the wallet setup.
  const funding = await import('../funding-preview.js');
  const exits = [];
  const preview = funding.createFundingPreview({
    el: (tag, attrs = {}, ...kids) => {
      const n = new FakeNode(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (k === 'class') n.className = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
      for (const k of kids.flat()) {
        if (k != null && k !== false) n.append(k instanceof Node ? k : { text: String(k) });
      }
      return n;
    },
    icon: () => null, walletName: 'Savings', onExit: () => exits.push('exit'),
    onComplete: () => exits.push('done') });
  const view = preview.element;
  const stages = [text(view)];
  assert.match(text(view), /Demo, no payment/, 'the funding stage says Demo, no payment');
  assert.match(text(view), /Funding checkout demo/, 'the funding stage is titled as a demo');
  assert.match(text(view), /Zigs asks for no setup payment/,
    'the funding stage says no payment is asked');
  assert.doesNotMatch(text(view), /Fund your wallet|Connect browser wallet|One setup payment/,
    'the funding stage does not read as a payment request');
  assert.equal(view.querySelector('.guided-progress'), null,
    'the funding demo is not drawn as a setup step');
  assert.equal(view.attrs['data-funding-preview'], '', 'the funding demo keeps its marker');
  press(view, 'Try wallet approval'); stages.push(text(view));
  press(view, 'Cancel');
  press(view, 'Show demo QR code'); stages.push(text(view));
  press(view, 'Back');
  press(view, 'Try wallet approval'); press(view, 'Simulate approval'); stages.push(text(view));
  for (const stage of stages) {
    assert.match(stage, /Demo, no payment/, 'every funding stage says Demo, no payment');
  }
  assert.match(funding.fundingDemoQrPayload(), /^ZIGS FUNDING DEMO - NOT A PAYMENT\n/,
    'the funding QR says that it is not a payment');
  assert.match(funding.FUNDING_DEMO_QR_PAYLOAD, /No recipient address\. Do not send funds\./,
    'the funding QR holds no recipient');
  press(view, 'Pause');
  assert.deepEqual(exits, ['exit'],
    'a paused funding demo leaves at once and asks nothing of the wallet');
} finally {
  globalThis.document = realDocument;
}
// The Overview banner of the funding demo, and the Settings entries of the Tor demo, are drawn by
// the page itself, so they run in the fake page too.
globalThis.document = fakeDocument;
try {
  const gid = 'a'.repeat(20);
  const { state } = await import('../app-state.js');
  const fundingPage = await import('../app-funding-preview.js');
  state.gid = gid;
  assert.equal(fundingPage.fundingOverviewCard(gid, 'Savings'), null, 'no banner before the demo');
  fundingPage.openFundingPreview(gid);
  fundingPage.fundingSetupView(gid, 'Savings');
  const banner = text(fundingPage.fundingOverviewCard(gid, 'Savings'));
  assert.match(banner, /Demo, no payment/, 'the Overview banner says Demo, no payment');
  assert.doesNotMatch(banner, /Finish funding|Continue funding/,
    'the Overview banner does not ask for a funding step');
  const settings = await import('../app-network-privacy.js');
  const group = settings.networkPrivacySettings();
  assert.match(text(group), /Tor is not available in this version/,
    'Settings says that Tor is not available');
  assert.match(text(group), /Demo only: your connection is unchanged/,
    'Settings labels the Tor demo');
  assert.equal(settings.hasNetworkPrivacy(), false, 'no panel is open before the button');
  press(group, 'Privacy & Network');
  assert.equal(settings.hasNetworkPrivacy(), true, 'Settings opens the Privacy & Network panel');
  const panel = text(settings.networkPrivacyPanel());
  assert.match(panel, /Integrated Tor is not available in this version/,
    'the panel says that Tor is not available');
  assert.doesNotMatch(panel, /\/\?demo=privacy|design preview/i,
    'the panel has no dead preview link');
  press(settings.networkPrivacyPanel(), 'Open the Tor demo');
  assert.equal(settings.hasNetworkPrivacy(), false, 'the Tor demo button closes the panel');
  assert.equal(body.querySelector('dialog').open, true, 'the Tor demo button opens the demo');
  press(group, 'Open the Tor demo');
  assert.equal(body.querySelector('dialog').open, true, 'Settings opens the Tor demo');
} finally {
  globalThis.document = realDocument;
}
globalThis.document = fakeDocument;
const realFetch = globalThis.fetch, fetched = [];
globalThis.fetch = async (...args) => { fetched.push(args); throw new Error('no network in this test'); };
try {
  // The swap pages: live quotes on the first page, demos on the second.
  const { createSwapPreview, LIVE_TAG, NO_RUN, QUOTE_PRIVACY, ZEC_PRIVACY } = await import(
    '../app-swap-preview.js');
  const context = { name: 'Savings', threshold: 'Any 2 of 3 devices' };
  assert.ok(createSwapPreview(context).model.provider instanceof NearIntentsSwapProvider,
    'the product page asks NEAR Intents');
  assert.deepEqual(fetched, [], 'building the page asks for nothing');
  const clock = fakeClock();
  asked.length = 0;
  const pro = livePro();
  const swap = createSwapPreview(context, pro, clock);
  const root = swap.element;
  const view = () => text(root);
  // The page root is a region that its h1 names, as the other pages (app-shell.js).
  assert.equal(root.getAttribute('role'), 'region', 'the swap page root is a region');
  const swapTitle = walk(root, (n) => n.tag === 'h1');
  assert.deepEqual(swapTitle.map((n) => [n.id, text(n)]),
    [[root.getAttribute('aria-labelledby'), 'Swap']], 'the h1 Swap names the swap page root');
  assert.equal(LIVE_TAG, 'Quotes only', 'the live tag says Quotes only');
  assert.ok(view().includes(LIVE_TAG), 'the swap page carries the live tag');
  assert.match(view(), /Live prices from NEAR Intents on mainnet\. Zigs cannot run a swap, so no funds move\./,
    'the subtitle says mainnet prices, no swap and no funds');
  assert.doesNotMatch(view(), /Private Swaps?|Powered by/,
    'the swap page does not claim a private swap or a provider');
  assert.match(view(), /SwapLive quotes/, 'the first tab says Live quotes');
  assert.match(view(), /Post-quantum swapDemo/, 'the second tab is a demo');
  assert.match(view(), /ZEC leaves the shielded poolNEAR Intents takes ZEC only at a public deposit address\./,
    'the privacy box of a swap from ZEC names the public deposit address in one line');
  // The privacy box follows the pair: a payout in ZEC, and a route with no ZEC.
  const paired = createSwapPreview(context, livePro(), fakeClock());
  const box = () => text(paired.element.querySelector('.swap-privacy'));
  await paired.model.update({ from: sol.id, to: zec.id });
  assert.match(box(), /The shielded payout is untestedNEAR Intents accepts a shielded address, but no real swap has tested this\./,
    'a swap to ZEC calls the shielded payout untested');
  await paired.model.update({ from: sol.id, to: usdcSol.id });
  assert.match(box(), /Route visibilityTransfers on the route can be public\./,
    'a route with no ZEC says that its transfers can be public');
  assert.match(box(), /What NEAR Intents sees/, 'the full privacy text is behind a toggle');
  assert.deepEqual(walk(root, (n) => /privacy options/i.test(n.attrs['aria-label'] ?? '')), [],
    'the swap tabs are not named as privacy options');
  assert.match(ZEC_PRIVACY, /leaves the shielded pool, because NEAR Intents takes ZEC only at a transparent deposit address, which is public\. NEAR Intents accepts a shielded address as the recipient of a swap to ZEC, but no real swap has tested this\.$/,
    'the ZEC line names the transparent deposit address and calls the shielded payout untested');
  assert.doesNotMatch(ZEC_PRIVACY + QUOTE_PRIVACY, /1Click|only at transparent addresses/);
  assert.ok(view().includes(ZEC_PRIVACY), 'a swap with ZEC shows the deposit address limit');
  assert.match(QUOTE_PRIVACY, /^Zigs sends the pair, the amount and the slippage to NEAR Intents through the Zigs server, with sample addresses and no address of yours\. NEAR Intents sees the Zigs server, not your IP address\.$/,
    'the quote line names the pair, the sample addresses and the server');
  assert.ok(view().includes(QUOTE_PRIVACY), 'the page says what the quote request sends');
  assert.equal(NO_RUN, 'Zigs cannot run this swap: the page shows quotes only, and no funds '
    + 'move.', 'the words of the no-run message');
  assert.ok(!view().includes(NO_RUN), 'the subtitle, not a second note, says that no funds move');
  assert.ok(view().includes('Receive to · Demo'), 'the destination is labelled Demo');
  assert.match(view(), /Choose a pair and enter an amount to get a live quote\./);
  // A key press asks nothing at once; the quote comes after the wait.
  const pay = root.querySelector('#swap-amount');
  fire(pay, 'input', { target: { value: '1' } });
  assert.match(view(), /Asking NEAR Intents for a quote…/, 'the page says that it asks');
  assert.deepEqual(asked, [], 'no request while the person types');
  await clock.tick(400);
  assert.equal(asked.length, 1, 'one request after the wait');
  assert.match(view(), /Live NEAR Intents quote, mainnet price/, 'the quote is a live quote');
  assert.doesNotMatch(view(), /Demo quote|not a real price|llustrative/);
  for (const row of [/Rate1 ZEC ≈ 12\.562715651 SOL/, /Minimum received12\.437088494 SOL/,
    /Value you pay \(NEAR Intents estimate\)\$1,267\.36/,
    /Value you receive \(NEAR Intents estimate\)\$1,266\.45/, /Estimated timeabout 8 minutes/]) {
    assert.match(view(), row, 'the quote shows ' + row);
  }
  assert.equal(root.querySelector('.swap-output').value, '12.562715651');
  const where = root.querySelector('#swap-destination');
  fire(where, 'change', { target: { value: '' } });
  assert.equal(asked.length, 1, 'a destination asks for no new quote');
  assert.equal(root.querySelector('.swap-primary').disabled, false, 'and it keeps the quote');
  press(root, 'Review quote');
  const modal = walk(body, (n) => n.tag === 'dialog').at(-1);
  assert.ok(text(modal).includes(LIVE_TAG), 'the review dialog carries the live tag');
  assert.ok(text(modal).includes(NO_RUN), 'the review dialog says that Zigs cannot run the swap');
  assert.match(text(modal), /Estimated receive12\.562715651 SOL/, 'the review shows the real amount');
  assert.match(text(modal), /Minimum received12\.437088494 SOL/);
  assert.match(text(modal), /Quote.*mainnet price · 16:56:50 UTC/);
  assert.match(text(modal), /Recipient.*Demo.*Refund destination.*Demo/,
    'the example addresses stay labelled Demo');
  assert.match(text(modal), /RecipientNone chosen · Demo/, 'the review follows the destination');
  assert.match(text(modal), /Demo: the steps below are simulated\. No funds move and nothing is signed\./);
  press(modal, 'Simulate swap flow');
  for (let i = 0; i < 5; i++) press(modal, 'Next demo step');
  assert.match(text(modal), /Demo complete\. The steps were simulated\. No funds moved\./,
    'the swap result says demo and no funds');
  press(modal, 'Back to swap');
  await settle(); // leaving the simulation asks for a new quote
  // The quote of 60 s is cleared, with a short message and a button for a new one.
  const before = asked.length;
  await clock.tick(60_000);
  assert.match(view(), /older than 60 seconds/, 'the page says that the quote is old');
  assert.equal(root.querySelector('.swap-primary').disabled, true, 'review is off');
  press(root, 'Refresh quote');
  await settle();
  assert.equal(asked.length, before + 1, 'Refresh quote asks again');
  assert.match(view(), /Live NEAR Intents quote/);
  // The details dialog follows the quote: the new rows show, and the rows go with an old quote.
  let release;
  pro.previewQuote = () => new Promise((resolve) => { release = () => resolve(live); });
  fire(pay, 'input', { target: { value: '2' } });
  await clock.tick(400);
  press(root, 'Swap details');
  const early = walk(body, (n) => n.tag === 'dialog').at(-1);
  assert.match(text(early), /Asking NEAR Intents for a quote….*Rate—/,
    'the details wait for the quote');
  release(); await settle();
  assert.match(text(early),
    /Live NEAR Intents quote, mainnet price.*Rate1 ZEC ≈ 12\.562715651 SOL/,
    'the details show the quote when it arrives');
  fire(early.querySelector('#swap-modal-destination'), 'change', { target: { value: 'example' } });
  assert.equal(early.open, true, 'a destination keeps the details open');
  await clock.tick(60_000);
  assert.match(text(early), /Rate—.*Minimum received—/, 'the details clear with the quote');
  assert.doesNotMatch(text(early), /12\.562715651/, 'no old rate in the details');
  press(early, 'Back to swap');
  // An error of the provider shows with the same button.
  pro.previewQuote = async () => { throw new NearQuoteError('too-low', '132000'); };
  fire(pay, 'input', { target: { value: '0.00001' } });
  await clock.tick(400);
  assert.match(view(), /NEAR Intents needs at least 0\.00132 ZEC for this route\./);
  assert.ok(named(root, 'Refresh quote'), 'an error offers Refresh quote');
  assert.doesNotMatch(view(), /Choose a pair and enter an amount/,
    'no idle prompt beside an error');
  // A page with the demo provider (the development harness) never calls a quote a price.
  const demoClock = fakeClock();
  const demoRoot = createSwapPreview(context, new MockSwapProvider(), demoClock).element;
  fire(demoRoot.querySelector('#swap-amount'), 'input', { target: { value: '1' } });
  await demoClock.tick(400);
  assert.match(text(demoRoot), /Demo quote, not a price/, 'a demo quote says Demo');
  assert.doesNotMatch(text(demoRoot), /mainnet price/);
  press(demoRoot, 'Review quote');
  assert.match(text(walk(body, (n) => n.tag === 'dialog').at(-1)), /QuoteDemo quote, not a price/,
    'the review of a demo quote says Demo');
  press(walk(body, (n) => n.tag === 'dialog').at(-1), 'Back to swap');
  const flow = root.querySelector('.pq-flow');
  press(root, 'Continue');
  assert.match(text(flow), /Demo · no funds move/, 'the post-quantum flow is labelled as a demo');
  await delay();
  for (const label of ['Review demo swap', 'Continue to demo approvals',
    'Simulate this device approval', 'Simulate second device approval',
    'Continue to simulated execution', 'Simulate deposit confirmation',
    'Simulate route execution', 'Simulate delivery']) press(flow, label);
  assert.match(text(flow), /Demo result\. No funds moved and no real quote was used\./,
    'the post-quantum result says demo, no funds and no real quote');
  assert.deepEqual(fetched, [], 'the demos ask nothing of the network');
  press(flow, 'Details');
  const pqDetails = walk(body, (n) => n.tag === 'dialog').at(-1);
  assert.match(text(pqDetails), /A live swap from ZEC would leave the shielded pool, because NEAR Intents takes ZEC only at a transparent deposit address, which is public\./,
    'the post-quantum details name the deposit address limit');
  assert.match(text(pqDetails), /NEAR Intents accepts a shielded address as the recipient of a swap to ZEC, but no real swap has tested this\./,
    'the post-quantum details call the shielded payout untested');
  const quantum = text(root.querySelector('#swap-panel-quantum'));
  assert.match(quantum, /leaves the shielded pool, because NEAR Intents takes ZEC only at a transparent deposit address/,
    'the post-quantum page names the deposit address limit');
  assert.doesNotMatch(quantum, /1Click handles ZEC only at transparent addresses/);
} finally {
  globalThis.fetch = realFetch;
  globalThis.document = realDocument;
}
// The live swap page: a server with NEAR_LIVE and a mainnet wallet that shows its address.
globalThis.document = fakeDocument;
try {
  const { createSwapPreview, LIVE_SUBTITLE, LIVE_TAG, NO_RUN, SWAP_AGREE, SWAP_EXPIRED,
    SWAP_PRIVACY, SWAP_TAG, UNTESTED } = await import('../app-swap-preview.js');
  assert.match(UNTESTED,
    /^The payout to a shielded address is untested: no real swap has paid one yet/,
    'the shielded payout is called untested');
  const payout = { address: UA, room: '50000000' };
  const context = { id: 'g1', name: 'Savings', threshold: 'Any 2 of 3 devices',
    networks: 'Zcash Mainnet', live: true, payout };
  let state = stateOf('PENDING_DEPOSIT');
  const pro = swapPro({ status: () => state });
  const clock = fakeClock();
  const swap = createSwapPreview(context, pro, clock);
  const root = swap.element, view = () => text(root);
  const tag = () => text(root.querySelector('.swap-tag-text'));
  assert.ok(view().includes(LIVE_SUBTITLE), 'the subtitle names the live swap from SOL to ZEC');
  assert.equal(tag(), 'Live swap · real funds', 'ZEC to SOL is a live route too');
  await swap.model.update({ to: usdcSol.id });
  assert.equal(tag(), 'Quotes only', 'a pair with no live swap says Quotes only');
  await swap.model.update({ from: sol.id, to: zec.id, amount: '0.0175' });
  assert.equal(tag(), 'Live swap · real funds', 'SOL to ZEC says Live swap · real funds');
  assert.match(text(root.querySelector('.swap-payout')), /Receive toSavings · u1ddnjsdcp…ece3lvm0/,
    'the payout is the address of the wallet');
  assert.equal(root.querySelector('.swap-payout').hidden, false);
  assert.ok(view().includes(SWAP_PRIVACY), 'the page says what the live swap sends');
  press(root, 'Swap details');
  const details = walk(body, (n) => n.tag === 'dialog').at(-1);
  assert.ok(text(details).includes('Receive toSavings · u1ddnjsdcp…ece3lvm0')
    && !text(details).includes('Receive to · Demo') && text(details).includes(SWAP_PRIVACY),
  'the details of the live route show the payout of the wallet');
  press(details, 'Back to swap');
  press(root, 'Review quote');
  const modal = walk(body, (n) => n.tag === 'dialog').at(-1);
  const review = text(modal);
  for (const part of [SWAP_TAG, UNTESTED, SWAP_PRIVACY, SWAP_AGREE,
    'Receive toSavings · u1ddnjsdcp…ece3lvm0', 'Pay fromA Solana wallet outside Zigs',
    'Refund address: the Solana address that you pay from']) {
    assert.ok(review.includes(part), 'the live review shows ' + part.slice(0, 40));
  }
  assert.doesNotMatch(review, /Simulate swap flow|Demo/, 'the live review is no demo');
  assert.ok(!review.includes(NO_RUN));
  const go = named(modal, 'Get deposit address');
  const refund = modal.querySelector('#swap-refund'), agree = modal.querySelector('#swap-agree');
  assert.equal(go.disabled, true, 'no deposit address before the refund address and the tick');
  fire(refund, 'input', { target: { value: SHORT_REFUND } });
  fire(agree, 'change', { target: { checked: true } });
  assert.equal(go.disabled, true, 'a refund address of 31 bytes keeps the button off');
  fire(refund, 'input', { target: { value: ' ' + REFUND + ' ' } });
  assert.equal(go.disabled, false, 'a Solana address and the tick turn it on');
  fire(agree, 'change', { target: { checked: false } });
  assert.equal(go.disabled, true, 'the tick is needed');
  fire(agree, 'change', { target: { checked: true } });
  fire(go, 'click'); await settle(); await settle();
  assert.deepEqual(pro.log.open, [{ from: 'sol', amountAtomic: '17500000', slippageBps: 50,
    recipient: UA, refundTo: REFUND }],
  'the review asks with the payout and the trimmed refund address');
  assert.equal(modal.open, false, 'the review closes');
  const deposit = root.querySelector('#swap-deposit');
  assert.equal(deposit.hidden, false, 'the deposit screen shows');
  for (const row of [UNTESTED, 'Send exactly0.0175 SOL (17,500,000 lamports)',
    'To this address' + DEPOSIT, 'Pay before1970-01-01 00:30:00 UTC. A deposit after this time can '
      + 'be lost.', 'Refund address' + REFUND, 'PayoutAbout 0.00133 ZEC, at least 0.0013167 ZEC',
    'Paid toSavings · ' + UA, 'Quote IDc-1', 'Quote signatureed25519:5wQ',
    'Status: Waiting for your deposit.', SWAP_TAG]) {
    assert.ok(text(deposit).includes(row), 'the deposit screen shows ' + row.slice(0, 40));
  }
  const copy = named(deposit, 'Copy address');
  assert.equal(copy.hidden, false, 'the address can be copied while NEAR Intents waits');
  // A wallet switch closes the dialogs, but the deposit screen stays with its address.
  swap.setContext({ ...context, id: 'g2', payout: { reason: 'This wallet uses Zcash testnet.' } });
  assert.equal(deposit.hidden, false, 'a wallet switch keeps the swap');
  assert.ok(text(deposit).includes(DEPOSIT));
  state = stateOf('PROCESSING', { originTxs: ['5wQkS9AAAA'] });
  await clock.tick(SWAP_STATUS_MS);
  assert.match(text(deposit), /Status: Swapping\..*Solana transaction5wQkS9AAAA/);
  assert.equal(copy.hidden, true, 'no copy once the deposit is seen');
  state = stateOf('other');
  await clock.tick(SWAP_STATUS_MS);
  assert.match(text(deposit), /Status: NEAR Intents gives a state that Zigs does not know\. Do not/);
  assert.equal(copy.hidden, true, 'no copy for a state that Zigs does not know');
  state = stateOf('SUCCESS', { destinationTxs: ['ab'.repeat(32)] });
  await clock.tick(SWAP_STATUS_MS);
  assert.match(text(deposit), /Status: Done\. NEAR Intents sent the ZEC to the wallet\./);
  assert.ok(text(deposit).includes('Zcash transaction' + 'ab'.repeat(32)));
  press(deposit, 'Close');
  assert.equal(deposit.hidden, true, 'Close ends the deposit screen');
  assert.equal(swap.model.value.live, null);
  // The deadline: with no deposit, the address goes and the page says not to pay.
  state = stateOf('PENDING_DEPOSIT');
  swap.setContext(context);
  await swap.model.update({ amount: '0.0175' });
  press(root, 'Review quote');
  const again = walk(body, (n) => n.tag === 'dialog').at(-1);
  fire(again.querySelector('#swap-refund'), 'input', { target: { value: REFUND } });
  fire(again.querySelector('#swap-agree'), 'change', { target: { checked: true } });
  fire(named(again, 'Get deposit address'), 'click'); await settle(); await settle();
  await clock.tick(DEADLINE_MS - clock.now());
  assert.ok(text(deposit).includes(SWAP_EXPIRED), 'after the deadline: do not send');
  assert.equal(named(deposit, 'Copy address').hidden, true, 'and no copy button');
  press(deposit, 'Close');
  // An error of NEAR Intents stays in the review, which stays open.
  const failing = createSwapPreview(context, swapPro({ open: () => {
    throw new NearQuoteError('too-low', '17392641'); } }), fakeClock());
  await failing.model.update({ from: sol.id, to: zec.id, amount: '0.0175' });
  press(failing.element, 'Review quote');
  const refused = walk(body, (n) => n.tag === 'dialog').at(-1);
  fire(refused.querySelector('#swap-refund'), 'input', { target: { value: REFUND } });
  fire(refused.querySelector('#swap-agree'), 'change', { target: { checked: true } });
  fire(named(refused, 'Get deposit address'), 'click'); await settle(); await settle();
  assert.equal(refused.open, true, 'the review stays open');
  assert.match(text(refused), /NEAR Intents needs at least 0\.017392641 SOL for this route\./);
  assert.equal(failing.element.querySelector('#swap-deposit').hidden, true);
  press(refused, 'Back to swap');
  // A wallet with no payout address: the reason, and no deposit address.
  const testnet = createSwapPreview({ ...context, payout: { reason: 'This wallet uses Zcash '
    + 'testnet. NEAR Intents pays mainnet ZEC only.' } }, swapPro(), fakeClock());
  await testnet.model.update({ from: sol.id, to: zec.id, amount: '0.0175' });
  assert.match(text(testnet.element.querySelector('.swap-payout')), /pays mainnet ZEC only/);
  press(testnet.element, 'Review quote');
  const none = walk(body, (n) => n.tag === 'dialog').at(-1);
  assert.match(text(none), /Receive toThis wallet uses Zcash testnet/);
  fire(none.querySelector('#swap-refund'), 'input', { target: { value: REFUND } });
  fire(none.querySelector('#swap-agree'), 'change', { target: { checked: true } });
  assert.equal(named(none, 'Get deposit address').disabled, true, 'no payout, no deposit address');
  press(none, 'Back to swap');
  // A server with no live swap: SOL to ZEC is the demo review, with the quotes-only text.
  const off = createSwapPreview({ ...context, live: false }, swapPro(), fakeClock());
  await off.model.update({ from: sol.id, to: zec.id, amount: '0.0175' });
  assert.equal(text(off.element.querySelector('.swap-tag-text')), LIVE_TAG,
    'a server with no live swap says Quotes only');
  assert.match(text(off.element), /Zigs cannot run a swap, so no funds move\./);
  assert.ok(!text(off.element).includes(SWAP_PRIVACY));
  assert.equal(off.element.querySelector('.swap-payout').hidden, true, 'no payout line');
  press(off.element, 'Review quote');
  const demo = walk(body, (n) => n.tag === 'dialog').at(-1);
  assert.ok(text(demo).includes(NO_RUN), 'the review says that Zigs cannot run the swap');
  assert.equal(named(demo, 'Get deposit address'), undefined, 'and has no deposit address');
  press(demo, 'Back to swap');
  console.log('ok  the live swap page: review, deposit screen, states, deadline, off server');
} finally {
  globalThis.document = realDocument;
}
// The live swap from ZEC to SOL: the wallet pays, its plain Solana address receives, and a refund
// goes to its transparent address. Nobody types an address, and the deposit opens Send.
globalThis.document = fakeDocument;
try {
  const { createSwapPreview, ZEC_AGREE, ZEC_REFUND, ZEC_SWAP_PRIVACY } =
    await import('../app-swap-preview.js');
  const T1 = 't1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs', T3 = 't3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd';
  const paid = [];
  const zecSource = { recipient: REFUND, refundTo: T3, pay: (w) => paid.push(w) };
  const context = { id: 'g1', name: 'Savings', threshold: 'Any 2 of 3 devices',
    networks: 'Zcash Mainnet', live: true, payout: { address: UA, room: '50000000' },
    zec: zecSource };
  const zecSwap = { ...opened, depositAddress: T1, recipient: REFUND, refundTo: T3 };
  let state = stateOf('PENDING_DEPOSIT');
  const pro = swapPro({ open: () => zecSwap, status: () => state });
  const swap = createSwapPreview(context, pro, fakeClock());
  const root = swap.element;
  await swap.model.update({ from: zec.id, to: sol.id, amount: '0.175' });
  assert.match(text(root.querySelector('.swap-payout')), /Receive toSavings · CZ8YUVdk7z…xzfSky9t/,
    'the payout is the Solana address of the wallet');
  assert.ok(text(root).includes(ZEC_SWAP_PRIVACY), 'the page says what the swap from ZEC sends');
  press(root, 'Review quote');
  const modal = walk(body, (n) => n.tag === 'dialog').at(-1);
  const review = text(modal);
  for (const part of [ZEC_SWAP_PRIVACY, ZEC_REFUND, ZEC_AGREE, 'Pay fromThis wallet · Any 2 of 3',
    'Refund addressThe transparent address of this wallet · t3Vz22vK5z…L1zg9ojd']) {
    assert.ok(review.includes(part), 'the review from ZEC shows ' + part.slice(0, 40));
  }
  assert.equal(modal.querySelector('#swap-refund'), null, 'nobody types a refund address');
  const go = named(modal, 'Get deposit address');
  assert.equal(go.disabled, true, 'the tick is needed');
  fire(modal.querySelector('#swap-agree'), 'change', { target: { checked: true } });
  assert.equal(go.disabled, false);
  fire(go, 'click'); await settle(); await settle();
  assert.deepEqual(pro.log.open.at(-1), { from: 'zec', amountAtomic: '17500000', slippageBps: 50,
    recipient: REFUND, refundTo: T3 }, 'the swap asks with the two addresses of the wallet');
  const deposit = root.querySelector('#swap-deposit');
  for (const row of ['Live swap: ZEC to SOL', 'Pay exactly0.175 ZEC (17,500,000 zatoshi)',
    'To this address' + T1, 'Refund address' + T3, 'PayoutAbout 0.000133 SOL, at least',
    'Each device asks NEAR Intents for this swap before it approves']) {
    assert.ok(text(deposit).includes(row), 'the deposit screen from ZEC shows ' + row.slice(0, 40));
  }
  assert.equal(named(deposit, 'Copy address'), undefined, 'the wallet pays: no copy button');
  press(deposit, 'Propose the payment');
  assert.deepEqual(paid, [zecSwap], 'the button opens Send with the deposit of the swap');
  // Another wallet opens while the deposit shows: its addresses are not the ones of the swap.
  swap.setContext({ ...context, id: 'g2', zec: { ...zecSource, recipient: DEPOSIT } });
  assert.equal(named(deposit, 'Propose the payment').disabled, true,
    'no payment from another wallet');
  press(deposit, 'Propose the payment');
  assert.equal(paid.length, 1, 'a click pays nothing');
  swap.setContext(context);
  state = stateOf('REFUNDED');
  await swap.model.readSwap(swap.model.value.live);
  assert.match(text(deposit), /Refunded\. NEAR Intents sent the ZEC back to the transparent/);
  state = stateOf('SUCCESS');
  await swap.model.readSwap(swap.model.value.live);
  assert.match(text(deposit), /Done\. NEAR Intents sent the SOL to the Solana address/);
  press(deposit, 'Close');
  // A wallet that is not ready: the reason, and no deposit address.
  const waiting = createSwapPreview({ ...context, zec: { reason: 'The refund address of this '
    + 'wallet needs the key of each device: 2 of 3 devices published one.' } }, swapPro(),
  fakeClock());
  await waiting.model.update({ from: zec.id, to: sol.id, amount: '0.175' });
  assert.match(text(waiting.element.querySelector('.swap-payout')), /2 of 3 devices published/);
  press(waiting.element, 'Review quote');
  const none = walk(body, (n) => n.tag === 'dialog').at(-1);
  fire(none.querySelector('#swap-agree'), 'change', { target: { checked: true } });
  assert.equal(named(none, 'Get deposit address').disabled, true, 'not ready: no deposit address');
  press(none, 'Back to swap');
  console.log('ok  the live swap from ZEC: fixed addresses, public payment, Send has the deposit');
} finally {
  globalThis.document = realDocument;
}
// The live swap from SOL that the plain Solana wallet of the group pays (docs/sol-to-zec-group.md).
// The provider asks /near/swap-sol-group, and the model reads the state once a minute.
{
  const calls = [];
  const provider = new NearIntentsSwapProvider(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json(opened);
  });
  const input = { amountAtomic: '17500000', slippageBps: 100, recipient: UA, refundTo: REFUND };
  assert.equal((await provider.openSwap({ ...input, group: true })).depositAddress, DEPOSIT);
  assert.deepEqual(calls, [{ url: '/near/swap-sol-group',
    body: { amount: '17500000', recipient: UA, refundTo: REFUND, slippageBps: 100 } }]);
  await assert.rejects(provider.openSwap({ ...input, from: 'zec', group: true }),
    (e) => e.code === 'no-route', 'the group route takes SOL only');
  assert.equal(calls.length, 1, 'and asks nothing');
  const clock = fakeClock(), pro = swapPro();
  const m = await reviewed(pro, clock);
  assert.equal(await m.openSwap({ ...where, group: true }), true);
  assert.equal(pro.log.open[0].group, true, 'the model asks for the group route');
  await settle();
  assert.equal(pro.log.reads.length, 1, 'the state is read at once');
  await clock.tick(SWAP_STATUS_MS);
  assert.equal(pro.log.reads.length, 1, 'not after 10 s');
  await clock.tick(SWAP_GROUP_STATUS_MS - SWAP_STATUS_MS);
  assert.equal(pro.log.reads.length, 2, 'then once a minute');
  m.closeSwap();
  const outside = await reviewed(swapPro());
  await outside.openSwap(where);
  assert.equal(outside.value.live.group, false, 'a swap paid from outside stays on /near/swap');
  outside.closeSwap();
  console.log('ok  the group route asks /near/swap-sol-group and reads the state once a minute');
}
// The page: the wallet pays, its Solana address gets a refund, nobody types an address, and the
// deposit screen proposes one send of this wallet.
globalThis.document = fakeDocument;
try {
  const { createSwapPreview, GROUP_MARGIN_MS, SOL_GROUP_AGREE, SOL_GROUP_PRIVACY, SOL_GROUP_REFUND,
    UNTESTED } = await import('../app-swap-preview.js');
  const margins = [GROUP_MARGIN_MS, (await import('../sol/plain/sessions.js')).SWAP_MARGIN_MS,
    (await import('../app-swap-zec.js')).SWAP_MARGIN_MS];
  assert.deepEqual(margins, [1_800_000, 1_800_000, 1_800_000], 'one margin of 30 minutes');
  const PAY_BY = 6 * 3600_000;
  const groupSwap = { ...opened, deadline: new Date(PAY_BY).toISOString() };
  const asks = [], paid = [];
  let reason = 'The balance is 0.01 SOL.', row = { word: 'Waiting for approvals', error: '' };
  let pay = async (w) => { paid.push(w); return 'ss1'; };
  const solGroup = { refundTo: REFUND, ready: (lamports) => { asks.push(lamports); return reason; },
    pay: (w) => pay(w), proposal: (id) => (id === 'ss1' ? row : null) };
  const context = { id: 'g1', name: 'Savings', threshold: 'Any 2 of 3 devices',
    networks: 'Zcash Mainnet', live: true, payout: { address: UA, room: '50000000' }, solGroup };
  const clock = fakeClock(), pro = swapPro({ open: () => groupSwap });
  const swap = createSwapPreview(context, pro, clock);
  const root = swap.element;
  const payers = (modal) => walk(modal, (n) => n.tag === 'input' && n.attrs.name === 'swap-payer');
  await swap.model.update({ from: sol.id, to: zec.id, amount: '0.0175' });
  assert.ok(text(root).includes(SOL_GROUP_PRIVACY),
    'the page says what a send of the wallet shows');
  press(root, 'Review quote');
  const modal = walk(body, (n) => n.tag === 'dialog').at(-1);
  for (const part of [UNTESTED, SOL_GROUP_PRIVACY, SOL_GROUP_REFUND, SOL_GROUP_AGREE,
    'Who pays the SOL', 'Pay fromThis wallet · Any 2 of 3 devices',
    'Refund addressThe Solana address of this wallet · CZ8YUVdk7z…xzfSky9t']) {
    assert.ok(text(modal).includes(part), 'the review of the group shows ' + part.slice(0, 40));
  }
  assert.deepEqual(payers(modal).map((n) => [n.attrs.value, 'checked' in n.attrs]),
    [['group', true], ['outside', false]], 'the wallet pays by default');
  assert.equal(modal.querySelector('#swap-refund'), null, 'nobody types a refund address');
  const go = named(modal, 'Get deposit address');
  fire(modal.querySelector('#swap-agree'), 'change', { target: { checked: true } });
  assert.equal(go.disabled, true, 'a wallet that cannot pay gets no deposit address');
  assert.ok(text(modal).includes(reason), 'and the review says why');
  assert.equal(asks.at(-1), '17500000', 'the wallet is asked for the lamports of the quote');
  reason = null;
  swap.setContext(context);
  assert.equal(go.disabled, false, 'a wallet that can pay turns the button on');
  fire(go, 'click'); await settle(); await settle();
  assert.deepEqual(pro.log.open, [{ from: 'sol', group: true, amountAtomic: '17500000',
    slippageBps: 50, recipient: UA, refundTo: REFUND }], 'the swap asks for the group route');
  const deposit = root.querySelector('#swap-deposit');
  for (const part of ['Live swap: SOL to ZEC', 'Send of this wallet',
    'Each device asks NEAR Intents for this swap before it approves',
    'Pay exactly0.0175 SOL (17,500,000 lamports)', 'To this address' + DEPOSIT,
    'Refund address' + REFUND, 'Paid toSavings · ' + UA]) {
    assert.ok(text(deposit).includes(part), 'the deposit of the group shows ' + part.slice(0, 40));
  }
  assert.equal(named(deposit, 'Copy address'), undefined, 'the wallet pays: no copy button');
  press(deposit, 'Propose the payment'); await settle();
  assert.deepEqual(paid, [groupSwap], 'the button proposes the send of the swap');
  assert.match(text(deposit), /Send of this wallet: Waiting for approvals/);
  assert.equal(named(deposit, 'Propose the payment').disabled, true, 'one send from this screen');
  row = { word: 'Failed', error: 'Not sent: the deposit address of this swap closes' };
  swap.setContext(context);
  assert.match(text(deposit), /Send of this wallet: Failed\. Not sent: the deposit address/);
  row = null;
  swap.setContext(context);
  assert.match(text(deposit), /Open the wallet that pays this swap to see its send\./);
  press(deposit, 'Close');
  // A refused proposal says why and can be tried again. Another wallet, and the last 30 minutes,
  // propose nothing.
  let tries = 0;
  pay = async () => {
    tries += 1;
    throw new Error('A send of this wallet already pays this deposit address.');
  };
  await swap.model.update({ amount: '0.0175' });
  press(root, 'Review quote');
  const again = walk(body, (n) => n.tag === 'dialog').at(-1);
  fire(again.querySelector('#swap-agree'), 'change', { target: { checked: true } });
  fire(named(again, 'Get deposit address'), 'click'); await settle(); await settle();
  swap.setContext({ ...context, id: 'g2', solGroup: { ...solGroup, refundTo: DEPOSIT } });
  assert.equal(named(deposit, 'Propose the payment').disabled, true, 'no send of another wallet');
  swap.setContext(context);
  press(deposit, 'Propose the payment'); await settle();
  assert.match(text(deposit), /Not proposed: A send of this wallet already pays this deposit/);
  assert.equal(named(deposit, 'Propose the payment').disabled, false, 'a refusal can be retried');
  await clock.tick(PAY_BY - 30 * 60_000 + 1 - clock.now());
  press(deposit, 'Propose the payment'); await settle();
  assert.equal(tries, 1, 'a click in the last 30 minutes proposes nothing');
  assert.equal(named(deposit, 'Propose the payment').disabled, true, 'and turns the button off');
  press(deposit, 'Close');
  // The payer can change: a wallet from outside types its refund address on /near/swap.
  await swap.model.update({ amount: '0.0175' });
  press(root, 'Review quote');
  const choose = walk(body, (n) => n.tag === 'dialog').at(-1);
  fire(payers(choose)[1], 'change');
  assert.ok(text(choose).includes('Pay fromA Solana wallet outside Zigs'));
  fire(choose.querySelector('#swap-refund'), 'input', { target: { value: REFUND } });
  fire(choose.querySelector('#swap-agree'), 'change', { target: { checked: true } });
  fire(named(choose, 'Get deposit address'), 'click'); await settle(); await settle();
  assert.equal('group' in pro.log.open.at(-1), false, 'a payer from outside asks /near/swap');
  assert.equal(named(deposit, 'Copy address').hidden, false, 'and copies the deposit address');
  press(deposit, 'Close');
  // A wallet with no Solana address: the choice is off and says why.
  const noKey = 'The Solana address of this wallet shows after its Solana key setup ends.';
  const waiting = createSwapPreview({ ...context, solGroup: { reason: noKey } }, swapPro(),
    fakeClock());
  await waiting.model.update({ from: sol.id, to: zec.id, amount: '0.0175' });
  assert.ok(!text(waiting.element).includes(SOL_GROUP_PRIVACY),
    'a wallet that cannot pay gets no text of a send of the wallet');
  press(waiting.element, 'Review quote');
  const off = walk(body, (n) => n.tag === 'dialog').at(-1);
  assert.deepEqual(payers(off).map((n) => [n.attrs.value, 'checked' in n.attrs,
    'disabled' in n.attrs]), [['group', false, true], ['outside', true, false]]);
  assert.ok(text(off).includes(noKey), 'the review says why the wallet cannot pay');
  assert.ok(off.querySelector('#swap-refund'), 'a payer from outside types the refund address');
  press(off, 'Back to swap');
  console.log('ok  the live swap from SOL paid by the wallet: review, proposal, refusals, payer');
} finally {
  globalThis.document = realDocument;
}
// ── The check of each approving device for a deposit of the plain wallet (app-swap-sol.js) ──
globalThis.document = fakeDocument;
try {
  const { checkSolSwap, solSwapSource } = await import('../app-swap-sol.js');
  const iso = new Date(Date.now() + 5 * 3600_000).toISOString();
  const ask = { deposit: DEPOSIT, lamports: '17500000', deadline: iso, refundTo: REFUND };
  const own = { address: UA, room: '50000000', refundTo: REFUND };
  const swapOk = { from: 'sol', to: 'zec', recipient: UA, refundTo: REFUND, amountIn: '17500000',
    amountOut: '133000', deadline: iso, plain: true };
  const asked = [];
  const near = (swap, status = 'PENDING_DEPOSIT') => ({ async swapStatus(address) {
    asked.push(address);
    return { status, swap };
  } });
  assert.deepEqual(await checkSolSwap(ask, near(swapOk), own), { lines: [
    'This send pays the deposit address ' + DEPOSIT + ' of a swap from SOL to ZEC through NEAR '
      + 'Intents.',
    'NEAR Intents waits for 0.0175 SOL and pays about 0.00133 ZEC to the ZEC address of this '
      + 'wallet. A refund goes to the Solana address of this wallet.',
    'Pay before ' + iso.slice(0, 10) + ' ' + iso.slice(11, 19) + ' UTC. No device approves or '
      + 'sends it in the last 30 minutes.'] });
  assert.deepEqual(asked, [DEPOSIT], 'the device asks for the swap of the deposit address');
  const refused = async (what, provider, pattern, mine = own) => {
    const out = await checkSolSwap(ask, provider, mine);
    assert.deepEqual(Object.keys(out), ['why'], what);
    assert.match(out.why, pattern, what);
  };
  const NOT = / This browser did not approve\.$/;
  for (const [what, edit] of [
    ['another ZEC address', { recipient: UA.slice(0, -1) + 'q' }],
    ['another refund', { refundTo: DEPOSIT }], ['another amount', { amountIn: '17500001' }],
    ['another origin', { from: 'zec' }], ['another asset out', { to: 'usdc' }],
    ['another deadline', { deadline: '2030-01-01T00:00:00.000Z' }],
    ['an app fee or another slippage', { plain: false }],
    ['a payout over the room', { amountOut: '50000001' }],
    ['no payout amount', { amountOut: undefined }]]) {
    await refused(what, near({ ...swapOk, ...edit }), NOT);
  }
  await refused('no swap fields', near(undefined), NOT);
  await refused('a deposit already seen', near(swapOk, 'KNOWN_DEPOSIT_TX'),
    /does not wait for a deposit at this address\. This browser did not approve\.$/);
  await refused('NEAR is down', { swapStatus: async () => { throw new Error('down'); } },
    /^NEAR Intents did not give the state of the swap\. Try again\.$/);
  asked.length = 0;
  await refused('a wallet with no payout address', near(swapOk),
    /^This wallet uses Zcash testnet\. This browser did not approve\.$/,
  { reason: 'This wallet uses Zcash testnet.' });
  assert.deepEqual(await checkSolSwap(ask, near(swapOk)), { why: 'Choose a mainnet wallet to '
    + 'receive the ZEC. This browser did not approve.' }, 'no mainnet wallet open');
  await refused('another wallet open', near(swapOk), /^This browser shows another wallet now\./,
    { ...own, refundTo: DEPOSIT });
  assert.deepEqual(asked, [], 'a device with no payout address or another wallet asks nothing');
  assert.match(solSwapSource().reason, /shows after its Solana key setup ends/,
    'no plain wallet: no payer');
  console.log('ok  each approving device checks the swap of a deposit of the plain wallet');
} finally {
  globalThis.document = realDocument;
}
// ── The check of each approving device for a swap payment from ZEC (web/app-swap-zec.js) ──
{
  const { checkSwap, SWAP_MARGIN_MS, swapDeadline, swapNote, swapReview, swapSendRefusal } =
    await import('../app-swap-zec.js');
  const T1 = 't1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs', T3 = 't3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd';
  const payBy = Date.now() + 5 * 3600_000, iso = new Date(payBy).toISOString();
  const note = swapNote(iso);
  assert.ok(note.length <= 80, 'the note fits the field of 80 characters');
  assert.equal(swapDeadline(note), payBy);
  for (const other of [null, 'Rent', note + ' ', note.replace(/\.\d{3}Z/, 'Z'),
    note.replace(iso, 'tomorrow')]) {
    assert.equal(swapDeadline(other), null, 'no swap: ' + other);
  }
  const own = { recipient: REFUND, refundTo: T3 };
  const swapOk = { from: 'zec', to: 'sol', recipient: REFUND, refundTo: T3, amountIn: '200000',
    deadline: iso, plain: true };
  const asked = [];
  const near = (swap, status = 'PENDING_DEPOSIT') => ({ async swapStatus(address) {
    asked.push(address);
    return { status, swap };
  } });
  const ss = { note, payees: [{ to: T1, amount: 200000 }] };
  // The review shows the deposit, the ZEC amount, and the SOL and the Solana address of the quote.
  const quoted = { ...swapOk, amountOut: '133000000' };
  const PAYS = 'This payment pays 0.002 ZEC to the deposit address ' + T1 + ' of NEAR Intents.';
  assert.deepEqual(swapReview(ss, near(quoted), REFUND), [PAYS,
    'Reading the quote of NEAR Intents…']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(swapReview(ss, near(quoted), REFUND), [PAYS, 'The quote of NEAR Intents pays '
    + 'about 0.133 SOL to the Solana address ' + REFUND + ', the Solana address of this wallet.']);
  assert.match(swapReview(ss, near(quoted), DEPOSIT)[1], /That is not the Solana address of this/);
  assert.equal(asked.length, 1, 'the review reads the quote once for each deposit address');
  const other = { note, payees: [{ to: T3, amount: 5 }] };
  swapReview(other, { swapStatus: async () => { throw new Error('down'); } }, REFUND);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(swapReview(other, near(quoted), REFUND)[1],
    'NEAR Intents did not give a quote to SOL for this deposit address.');
  assert.equal(swapReview({ note: 'Rent', payees: ss.payees }, near(quoted), REFUND), null);
  asked.length = 0;
  await checkSwap(ss, near(swapOk), own);
  assert.deepEqual(asked, [T1], 'the device asks for the swap of the payee address');
  await checkSwap({ note: 'Rent', payees: ss.payees }, near(swapOk), own);
  await checkSwap({ note: 'Swap the shifts', payees: [{ to: UA, amount: 5 }] }, near(swapOk), own);
  assert.equal(asked.length, 1, 'a payment that is no swap asks nothing');
  for (const look of [note.replace('Intents', 'lntents'), 'NEAR Intents swap, pay soon',
    'swap via 1Click']) {
    await assert.rejects(checkSwap({ note: look, payees: ss.payees }, near(swapOk), own),
      /names a swap, but it is not the note of the Swap page/, 'a lookalike note: ' + look);
  }
  const refused = async (what, ss2, provider, mine = own) => {
    await assert.rejects(checkSwap(ss2, provider, mine), (e) => e.message.endsWith(
      'This browser did not approve.'), what);
  };
  for (const [what, edit] of [
    ['another Solana address', { recipient: DEPOSIT }], ['another refund', { refundTo: T1 }],
    ['another amount', { amountIn: '200001' }], ['another origin', { from: 'sol' }],
    ['another asset out', { to: 'usdc' }],
    ['another deadline', { deadline: '2030-01-01T00:00:00.000Z' }],
    ['an app fee or another slippage', { plain: false }],
    ['no swap fields', null]]) {
    await refused(what, ss, near(edit ? { ...swapOk, ...edit } : {}));
  }
  await refused('a deposit already seen', ss, near(swapOk, 'KNOWN_DEPOSIT_TX'));
  await refused('a swap that NEAR does not list', ss, near(swapOk, 'unknown'));
  await refused('NEAR is down', ss, { swapStatus: async () => { throw new Error('down'); } });
  await refused('two payees', { ...ss, payees: [...ss.payees, ss.payees[0]] }, near(swapOk));
  await refused('a memo', { ...ss, payees: [{ ...ss.payees[0], memo: 'x' }] }, near(swapOk));
  await refused('an amount as text', { ...ss, payees: [{ to: T1, amount: '200000' }] },
    near(swapOk));
  await refused('no own refund address', ss, near(swapOk), { recipient: REFUND });
  const { state: page } = await import('../app-state.js');
  assert.notEqual(page.g?.network, 'mainnet', 'the fixture: no mainnet wallet is open');
  await refused('no mainnet wallet, so no own addresses', ss, near(swapOk), null);
  const soon = new Date(Date.now() + SWAP_MARGIN_MS - 60_000).toISOString();
  await refused('29 minutes left', { ...ss, note: swapNote(soon) },
    near({ ...swapOk, deadline: soon }));
  assert.equal(swapSendRefusal(ss), null, 'a swap with 5 hours left can go out');
  assert.match(swapSendRefusal(ss, payBy - SWAP_MARGIN_MS + 1), /does not send the payment/);
  assert.equal(swapSendRefusal({ note: 'Rent' }, payBy + 1), null, 'no swap: no refusal');
  const { sendRefusal } = await import('../app-payments.js');
  assert.match(sendRefusal({ final: { txid: 'ab' }, note: swapNote(soon) }),
    /does not send the payment/, 'the Send button of a payment refuses it near the deadline');
  console.log('ok  each approving device checks the swap of the deposit address with NEAR Intents');
}
// The page shell: the saved theme applies before the first paint, and the demo entry cannot stop
// the wallet from loading.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const theme = html.indexOf('<script src="/theme.js"></script>');
assert.ok(theme > 0 && theme < html.indexOf('<link rel="stylesheet"'),
  'the theme script is a classic script in the head, before the styles');
assert.equal(html.split('theme.js').length, 2, 'index.html loads the theme script once');
const entry = readFileSync(new URL('../network-privacy-demo-entry.js', import.meta.url), 'utf8');
assert.match(entry, /try \{\s*installPrivacyPopup\(\);\s*\} catch/,
  'a Tor demo that fails to start is caught');
assert.ok(entry.indexOf('catch') < entry.indexOf('import("./app.js")'),
  'the wallet loads after the Tor demo is installed or has failed');
assert.doesNotMatch(entry, /theme\.js/, 'the entry does not load the theme after the first paint');
// The README names the brand marks as identifiers owned by others, and claims no licence for them.
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
assert.doesNotMatch(readme, /used under their brand terms/,
  'the README claims no licence for the brand marks');
assert.match(readme, /marks identify the assets\. The trademarks belong to their owners/,
  'the README says that the marks identify the assets and belong to their owners');
console.log('swap-preview: amounts, races, live quotes, expiry, demo labels and lock pass');
process.exit(0);
