import assert from 'node:assert/strict';
import { MockSwapProvider, SwapPreviewModel, SWAP_ASSETS, SWAP_DEMO_STEPS, SWAP_QUOTE_TTL_MS,
  SWAP_TYPING_MS, swapAtomic, swapDecimal, swapRate, swapTime, swapUsd } from '../swap-preview-model.js';
import { readFileSync } from 'node:fs';
import { NearIntentsSwapProvider, NearQuoteError } from '../near-intents-swap-provider.js';
import { loadRig, storage } from './sol-rig.mjs';

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

// ── The demos say what they are: the Tor demo, the funding checkout and the swap pages ──
// A small fake page: enough of the DOM to draw the real modules and to press their buttons.
await loadRig();
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
  const page = { querySelector: (sel) => (sel === '#app' ? app : null) };
  assert.equal(popup.hasPrivacyPopup(), false,
    'no popup is installed before the entry installs it');
  popup.installPrivacyPopup();
  popup.presentPrivacyStatus(page);
  const pill = walk(head, (n) => n.className === 'pp-status')[0];
  assert.ok(pill, 'the Tor pill is drawn in the page header');
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
  assert.equal(LIVE_TAG, 'Live quotes · no funds move', 'the live tag says Live quotes');
  assert.ok(view().includes(LIVE_TAG), 'the swap page carries the live tag');
  assert.match(view(), /Live prices from NEAR Intents on mainnet\. Zigs cannot run a swap, so no funds move\./,
    'the subtitle says mainnet prices, no swap and no funds');
  assert.doesNotMatch(view(), /Private Swaps?|Powered by/,
    'the swap page does not claim a private swap or a provider');
  assert.match(view(), /SwapQuotes: NEAR Intents \(mainnet\)Live quotes/, 'the first tab says Live quotes');
  assert.match(view(), /Post-quantum swap demoPlanned provider: NEAR IntentsDemo/,
    'the second tab is a demo with a planned provider');
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
  assert.ok(view().includes(NO_RUN), 'the page says that Zigs cannot run the swap');
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
  assert.match(text(flow), /DEMO · NO FUNDS MOVE/, 'the post-quantum flow is labelled as a demo');
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
