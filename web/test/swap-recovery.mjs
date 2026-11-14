// Recovery is encrypted tracking data, never an instruction to sign or pay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Z from '../pkg/zigs_engine.js';
import { newRoom } from '../chat.js';
import { createSwapRecovery, readSwapRecovery, swapRecoveryRecord, swapRecoveryText } from '../swap-recovery.js';
import { SwapPreviewModel } from '../swap-preview-model.js';

Z.initSync({ module: readFileSync(new URL('../pkg/zigs_engine_bg.wasm', import.meta.url)) });
const swap = { amountIn: '17500000', amountOut: '133000', minAmountOut: '131670',
  depositAddress: 'synthetic-deposit', recipient: 'synthetic-recipient', refundTo: 'synthetic-refund',
  deadline: '2030-01-01T00:00:00.000Z', correlationId: 'synthetic-quote', signature: 'synthetic-signature' };
const live = { swap, from: 'sol', group: true, wallet: 'Synthetic wallet', proposal: { id: 'proposal-1' } };
const record = swapRecoveryRecord(live), { key, id } = newRoom();
const values = new Map();
const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
const cache = createSwapRecovery(Z, key, id, storage);
assert.equal(cache.load(), null);
cache.save(record);
const [name, ciphertext] = [...values][0];
for (const privateText of [swap.depositAddress, swap.recipient, swap.refundTo, swap.signature, live.wallet]) {
  assert.ok(!ciphertext.includes(privateText), 'no plaintext payment details in storage');
}
assert.deepEqual(cache.load(), record);
const wrongKey = createSwapRecovery(Z, newRoom().key, id, storage);
assert.throws(() => wrongKey.load(), /encrypted copy has been kept/);
const wrongWallet = createSwapRecovery(Z, key, 'another-wallet', { ...storage, getItem: () => ciphertext });
assert.throws(() => wrongWallet.load(), /encrypted copy has been kept/);
values.set(name, ciphertext.slice(0, -5));
assert.throws(() => cache.load(), /encrypted copy has been kept/);
assert.equal(values.get(name), ciphertext.slice(0, -5), 'damaged data is preserved');
values.set(name, ciphertext);
const failed = createSwapRecovery(Z, key, id, { ...storage, setItem() { throw Error('quota'); } });
assert.throws(() => failed.save(record), /quota/);
assert.equal(values.get(name), ciphertext, 'a failed save keeps the last stored record');
assert.throws(() => createSwapRecovery(Z, key, id, { ...storage, setItem() {} }).save({ ...record, wallet: 'Changed' }), /could not be saved/);
for (const bad of [null, { ...record, version: 2 }, { ...record, keyPackage: 'secret' },
  { ...record, from: 'usdc' }, { ...record, from: 'zec' }, { ...record, proposalId: '<bad>' }, { ...record, proposalId: ['coerced'] },
  { ...record, swap: { ...swap, amountIn: '-1' } }, { ...record, swap: { ...swap, minAmountOut: '133001' } },
  { ...record, swap: { ...swap, deadline: 'bad' } }, { ...record, swap: { ...swap, secret: 'bad' } }]) {
  assert.throws(() => readSwapRecovery(bad), /cannot be read/);
}
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked'); } });
assert.doesNotThrow(() => createSwapRecovery(Z, key, id));
assert.throws(() => createSwapRecovery(Z, key, id).load(), /blocked/);
if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete globalThis.localStorage;

const settle = () => new Promise(resolve => setImmediate(resolve));
const timers = new Map(); let seq = 0, now = 0, opens = 0, reads = 0, response;
const clock = { now: () => now, set: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; }, clear: id => timers.delete(id) };
const provider = { openSwap: () => { opens++; throw Error('recovery must never open a swap'); },
  swapStatus: async address => { assert.equal(address, swap.depositAddress); reads++; return response; } };
const match = { from: 'sol', to: 'zec', amountIn: swap.amountIn, amountOut: swap.amountOut,
  recipient: swap.recipient, refundTo: swap.refundTo, deadline: swap.deadline, plain: true };
response = { status: 'PENDING_DEPOSIT', swap: { ...match, recipient: 'wrong-recipient' } };
const model = new SwapPreviewModel(provider, () => {}, clock);
assert.equal(model.restoreSwap(record), true);
assert.equal(model.value.live.verified, false, 'no cached address is trusted before a fresh status response');
await settle();
assert.equal(model.value.live.verified, false, 'a mismatching provider route remains blocked');
response = { status: 'PENDING_DEPOSIT', swap: match };
await model.readSwap(model.value.live);
assert.equal(model.value.live.verified, true);
assert.equal(model.value.live.proposal.id, 'proposal-1', 'existing proposal remains attached');
assert.equal(model.restoreSwap(record), false, 'a restore cannot replace an active swap');
assert.equal(opens, 0, 'restoring never opens or pays a swap');
model.closeSwap();
assert.equal(timers.size, 0, 'closing tracking cancels timers');
const pending = { ...record, proposalPending: true }; delete pending.proposalId;
assert.equal(model.restoreSwap(pending), true);
await settle();
assert.equal(model.value.live.proposal.busy, true, 'an interrupted proposal blocks duplicate proposals');
now = Date.parse(swap.deadline);
assert.equal(model.swapExpired(), true, 'a restored expired deposit remains expired');
model.closeSwap();
assert.equal(model.restoreSwap({ ...record, swap: { ...swap, amountIn: 'bad' } }), false);
assert.ok(reads >= 3);
cache.remove(); assert.equal(cache.load(), null);
assert.deepEqual(cache.history(), [record], 'Done archives the active record');
const withProgress = swapRecoveryRecord({ ...live, checkedAt: 123,
  status: { status: 'FAILED', originTxs: ['source-tx'], destinationTxs: ['reported-destination-tx'] } });
cache.save(withProgress); cache.remove();
assert.deepEqual(cache.history(), [withProgress], 'rechecking the same swap updates rather than duplicates its archive');
assert.ok(![...values.values()].some((value) => value.includes('source-tx')), 'history is encrypted too');
const support = swapRecoveryText({ ...live, savedProgress: withProgress.progress });
for (const part of ['Historical record, not a payment instruction', swap.deadline, swap.refundTo,
  'source-tx', 'reported-destination-tx', 'FAILED', 'proposal-1']) assert.ok(support.includes(part));
cache.save(withProgress);
const historyName = [...values.keys()].find((k) => k.includes(':history:'));
const historyCiphertext = values.get(historyName);
const noArchive = createSwapRecovery(Z, key, id, { ...storage,
  setItem(k, v) { if (k !== historyName) storage.setItem(k, v); } });
assert.throws(() => noArchive.remove(), /Tracking was kept/);
assert.deepEqual(cache.load(), withProgress, 'unconfirmed archive writes keep active tracking');
const noRemove = createSwapRecovery(Z, key, id, { ...storage, removeItem() {} });
assert.throws(() => noRemove.remove(), /could not be closed/);
assert.deepEqual(cache.load(), withProgress);
cache.remove();
assert.equal(cache.history().length, 1, 'retry after interrupted close remains idempotent');
cache.save(record);
values.set(historyName, historyCiphertext.slice(0, -5));
assert.throws(() => cache.remove(), /history cannot be read/);
assert.deepEqual(cache.load(), record, 'corrupt history never deletes the active record');
values.set(historyName, historyCiphertext);
for (let i = 0; i < 99; i++) {
  cache.save({ ...record, swap: { ...swap, depositAddress: 'synthetic-deposit-' + i } });
  cache.remove();
}
cache.save({ ...record, swap: { ...swap, depositAddress: 'one-too-many' } });
assert.throws(() => cache.remove(), /history is full/);
assert.equal(cache.load().swap.depositAddress, 'one-too-many', 'full history preserves the new active record');
assert.equal(cache.history().length, 100);
for (const bad of [{ status: 'SUCCESS', originTxs: [], destinationTxs: [], checkedAt: -1 },
  { status: 'invented', originTxs: [], destinationTxs: [] },
  { status: 'SUCCESS', originTxs: Array(21).fill('tx'), destinationTxs: [] }])
  assert.throws(() => readSwapRecovery({ ...record, progress: bad }), /cannot be read/);
console.log('swap-recovery: encrypted roundtrip, scope, corruption, failed storage, tracking-only restore, route verification and duplicate guard ok');
