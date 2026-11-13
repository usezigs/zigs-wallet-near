// No network, keys or funds. Preview must stay separate from both real execution choices.
import assert from 'node:assert/strict';
import { MockSwapProvider, SWAP_ASSETS, SWAP_DEMO_STEPS,
  SwapPreviewModel, swapPrivacyProblem } from '../swap-preview-model.js';
import { readSwapRecord } from '../swap-records.js';

const calls = { quotes: [], opens: [], status: [], saves: [] };
const provider = new MockSwapProvider();
const quote = provider.previewQuote.bind(provider);
provider.previewQuote = async (ask) => { calls.quotes.push(ask); return quote(ask); };
let forcedMode = null;
provider.openSwap = async (ask) => {
  calls.opens.push(ask);
  if (ask.confidentiality === 'basic') throw Error('Confidential provider access unavailable');
  return { amountIn: ask.amountAtomic, amountOut: '200000', minAmountOut: '198000',
    recipient: ask.recipient, refundTo: ask.refundTo, depositAddress: '7'.repeat(43),
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    confidentiality: forcedMode || ask.confidentiality };
};
provider.swapStatus = async (deposit) => {
  calls.status.push(deposit);
  return { status: 'PENDING_DEPOSIT', swap: { confidentiality: 'public' } };
};
const clock = { now: () => Date.now(), set: () => 1, clear: () => {} };
const model = new SwapPreviewModel(provider, () => {}, clock);
model.journal = { save: async (record) => calls.saves.push(record) };
const where = { walletId: 'example-wallet', wallet: 'Example', funding: 'private', group: true,
  recipient: 'u1' + 'q'.repeat(105), refundTo: '8'.repeat(43) };
assert.equal(model.value.execution, 'preview');
await model.update({ from: SWAP_ASSETS[1].id, to: SWAP_ASSETS[0].id, amount: '0.1' });
assert.equal(model.review(), true);
assert.equal(await model.openSwap(where), false, 'preview cannot request a live deposit');
model.simulate();
for (let i = 0; i < SWAP_DEMO_STEPS.length; i++) model.advance();
assert.equal(model.value.phase, 'DEMO_COMPLETE');
assert.equal(SWAP_DEMO_STEPS.at(-1), 'Receipt and recovery');
assert.deepEqual([calls.opens.length, calls.status.length, calls.saves.length], [0, 0, 0],
  'simulated approvals, delivery and recovery cause no execution or receipt writes');
model.exitSimulation();
await model.chooseExecution('public');
model.review();
assert.equal(await model.openSwap(where), true);
assert.equal(calls.opens[0].confidentiality, 'public');
assert.equal(calls.saves[0].routeChoice, 'public');
assert.equal(calls.saves[0].swap.confidentiality, 'public');
assert.equal(await model.chooseExecution('basic'), false, 'an active receipt keeps its route');
const stored = readSwapRecord(calls.saves[0]);
assert.equal(swapPrivacyProblem(stored), '');
assert.match(swapPrivacyProblem({ ...stored, routeChoice: 'basic' }), /Tracking is available/,
  'a recovered receipt cannot change the selected route');
const legacy = readSwapRecord({ ...calls.saves[0], routeChoice: undefined });
assert.match(swapPrivacyProblem(legacy), /Tracking is available/);
model.clearLive();
forcedMode = 'basic';
await model.chooseExecution('public'); model.review();
assert.equal(await model.openSwap(where), false, 'a response cannot change the chosen route');
assert.match(model.value.swapError, /different routing mode/);
const before = calls.opens.length;
await model.chooseExecution('basic'); model.review();
assert.equal(await model.openSwap(where), false);
assert.equal(calls.opens.length, before + 1,
  'confidential failure makes no standard retry');
assert.equal(calls.opens.at(-1).confidentiality, 'basic');
assert.equal(await model.chooseExecution('advanced'), false);
console.log('ok  preview simulation, explicit standard route, pinned recovery and no fallback');
