// No network or funds. Real Ed25519/WebCrypto, amount/deadline guards, recovery serialization,
// and real wallet-key encryption through the existing page rig.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { nearBase58, nearSignedPayload, signedSwapMatches,
   verifyNearQuote } from '../near-quote-signature.js';
import { NearIntentsSwapProvider } from '../near-intents-swap-provider.js';
import { MockSwapProvider, SWAP_ASSETS, SwapPreviewModel } from '../swap-preview-model.js';
import { readSwapRecord, swapRecordOf } from '../swap-records.js';
import { base58 } from '../sol/docs.js';
import { intentHex } from '../sol/intent.js';
import { checkPoolSwap, poolSwapMark, poolSwapProblem } from '../sol/swap.js';

const sol = SWAP_ASSETS[1], zec = SWAP_ASSETS[0];
const recipient = 'u1' + 'q'.repeat(105), deposit = base58('5c'.repeat(32));
const refundTo = base58('6d'.repeat(32)), now = Date.now();
const deadline = new Date(now + 6 * 3600_000).toISOString();
const envelope = { timestamp: new Date(now).toISOString(), quoteRequest: {
  dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 50, originAsset: sol.id,
  destinationAsset: zec.id, amount: '17500000', depositType: 'ORIGIN_CHAIN',
  refundType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', recipient, refundTo, deadline,
  confidentiality: 'basic',
}, quote: { amountIn: '17500000', amountInUsd: '1.65', amountOut: '133000',
  minAmountOut: '132335', depositAddress: deposit, deadline } };
const pair = generateKeyPairSync('ed25519');
const key = nearBase58(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
const digest = createHash('sha256').update(nearSignedPayload(envelope)).digest();
envelope.signature = 'ed25519:' + nearBase58(sign(null, Buffer.from(nearBase58(digest)),
   pair.privateKey));
assert.equal(await verifyNearQuote(envelope, key), true);
assert.equal(await verifyNearQuote(envelope), false,
   'a foreign signing key cannot impersonate the pinned provider');
for (const [part, field] of [['quote', 'depositAddress'], ['quote', 'amountOut'],
  ['quoteRequest', 'recipient'], ['quoteRequest', 'refundTo'], ['quote', 'deadline']]) {
  const changed = structuredClone(envelope); changed[part][field] += '1';
  assert.equal(await verifyNearQuote(changed, key), false, 'signed ' + field + ' cannot change');
}
assert.equal(await verifyNearQuote({ ...envelope, signature: 'ed25519:123' }, key), false);
const unsignedChange = { ...envelope, correlationId: 'another-reference' };
assert.equal(await verifyNearQuote(unsignedChange, key), true,
   'trace identifiers are not signed financial terms');
const expected = { ...envelope.quote, confidentiality: 'basic', recipient, refundTo,
  originAsset: sol.id,
  destinationAsset: zec.id, slippageBps: 50 };
assert.equal(signedSwapMatches(envelope, expected), true);
assert.equal(signedSwapMatches(envelope, { ...expected, amountOut: '999999' }), false);
const publicMode = structuredClone(envelope);
publicMode.quoteRequest.confidentiality = 'public';
assert.equal(await verifyNearQuote(publicMode, key), true,
  'the published provider signature does not cover the confidentiality setting');
assert.equal(signedSwapMatches(publicMode, expected), false,
  'mode consistency must be checked separately from signature verification');
const response = { ...envelope.quote, confidentiality: 'basic', recipient, refundTo,
  signedQuote: envelope };
const fetchFixture = async () => Response.json(response);
const ask = { from: 'sol', group: true, amountAtomic: '17500000', slippageBps: 50, recipient,
   refundTo };
await assert.rejects(new NearIntentsSwapProvider(fetchFixture).openSwap(ask), /authenticated/);
const authenticatedFixture = async (body, fields) => await verifyNearQuote(body.signedQuote, key)
  && signedSwapMatches(body.signedQuote, fields);
const provider = new NearIntentsSwapProvider(fetchFixture, authenticatedFixture);
assert.equal((await provider.openSwap(ask)).depositAddress, deposit);
const altered = new NearIntentsSwapProvider(async () => Response.json({ ...response,
   amountOut: '999999' }), authenticatedFixture);
await assert.rejects(altered.openSwap(ask), /authenticated/,
   'valid signatures cannot authenticate modified simplified fields');
console.log('ok  pinned quote authentication, tampered terms and proxy field binding');

const expiry = Math.floor((Date.parse(deadline) - 30 * 60_000) / 1000);
const intent = intentHex('withdraw', { recipient: '5c'.repeat(32), amount: 17500000n, expiry,
   inputs: 1, outputs: 1 });
const session = { swap: poolSwapMark(deposit, deadline, 'basic'), intent,
  expiry: String(expiry), by: 1 };
assert.equal(poolSwapProblem(session, now), null);
assert.match(poolSwapProblem({ ...session, swap: 'bad' }, now), /does not match/);
assert.match(poolSwapProblem({ ...session, swap: poolSwapMark(refundTo, deadline, 'basic') }, now),
   /does not match/);
const lateIntent = intentHex('withdraw', { recipient: '5c'.repeat(32), amount: 17500000n,
   expiry: expiry + 1, inputs: 1, outputs: 1 });
assert.match(poolSwapProblem({ ...session, intent: lateIntent, expiry: String(expiry + 1) },
   now), /does not match/);
assert.match(poolSwapProblem(session, Date.parse(deadline) - 30 * 60_000), /window closed/);
const checked = [];
const controller = { wallet: { cluster: 'mainnet', label: 'mainnet-private' },
  docs: { solfee: { 1: { key: '6d'.repeat(32), cluster: 'mainnet-private' } } },
  host: { swapCheck: async (fields) => { checked.push(fields); return {
     lines: ['Verified swap'] }; } } };
await checkPoolSwap(controller, session);
assert.deepEqual(checked[0], { mode: 'private', deposit, lamports: '17500000', deadline,
   refundTo, confidentiality: 'basic' });
await assert.rejects(checkPoolSwap({ ...controller, wallet: { cluster: 'devnet' } },
   session), /mainnet/);
await assert.rejects(checkPoolSwap({ ...controller, host: { swapCheck: async () => ({
   why: 'Wrong payout wallet' }) } }, session), /Wrong payout/);
const realNow = Date.now;
try {
  const crossing = { ...controller, host: { swapCheck: async () => {
    Date.now = () => Date.parse(deadline); return { lines: ['Previously valid'] };
  } } };
  await assert.rejects(checkPoolSwap(crossing, session), /window closed/);
} finally { Date.now = realNow; }
console.log('ok  private withdrawal deposit, refund, expiry, network and deadline-crossing guards');

const fakeClock = { now: () => now, set: () => 1, clear() {} };
const mock = new MockSwapProvider();
mock.openSwap = async () => response;
mock.swapStatus = async () => ({ status: 'PENDING_DEPOSIT', originTxs: [], destinationTxs: [] });
let saved;
const model = new SwapPreviewModel(mock, () => {}, fakeClock);
await model.chooseExecution('basic');
model.journal = { save: async (r) => { saved = structuredClone(r); } };
await model.update({ from: sol.id, to: zec.id, amount: '0.0175' }); model.review();
await model.openSwap({ recipient, refundTo, group: true, funding: 'private',
   wallet: 'Test wallet', walletId: 'wallet-a' });
await new Promise(setImmediate);
assert.equal(saved.funding, 'private'); assert.equal(saved.walletId, 'wallet-a');
assert.equal(saved.swap.signedQuote.signature, envelope.signature);
model.value.live.proposal = { busy: true, attempted: true };
await model.keepSwap(model.value.live);
assert.deepEqual(saved.proposal, { attempted: true },
   'an interrupted proposal remains reserved after reload');
const resumed = new SwapPreviewModel(mock, () => {}, fakeClock);
assert.equal(resumed.restoreSwap(saved), true);
assert.equal(resumed.value.live.swap.depositAddress, deposit);
assert.equal(resumed.value.live.proposal.attempted, true);
assert.equal(readSwapRecord({ ...saved, walletId: '' }), null);
assert.equal(readSwapRecord({ ...saved, swap: { ...saved.swap,
   minAmountOut: '999999999' } }), null);
assert.equal('confirmed' in swapRecordOf(resumed.value.live), false,
   'saved metadata cannot establish wallet receipt');
const blocked = new SwapPreviewModel(mock, () => {}, fakeClock);
await blocked.chooseExecution('basic');
blocked.journal = { save: async () => { throw new Error('Quota exceeded'); } };
await blocked.update({ from: sol.id, to: zec.id, amount: '0.0175' }); blocked.review();
await blocked.openSwap({ recipient, refundTo, walletId: 'wallet-a', funding: 'private' });
assert.match(blocked.value.live.storageError, /Funding is paused/);
console.log('ok  reload recovery, interrupted proposal reservation and storage failure state');

const { loadRig } = await import('./sol-rig.mjs');
const rig = await loadRig();
const { swapJournal } = await import('../app-swap-store.js');
const { shieldedSwapReceipt } = await import('../app-swap-sol.js');
const storage = await import('../app-keystore.js');
const store = new Map();
storage.setGkeys({ 'wallet-a': Buffer.alloc(32, 7).toString('base64url'),
   'wallet-b': Buffer.alloc(32, 8).toString('base64url') });
storage.setIdb(async (_mode, run) => run({ get: (id) => store.get(id), put: (value, id) =>
   store.set(id, value) }));
await swapJournal.save(saved);
const sealed = store.get('swaps:wallet-a');
assert.ok(typeof sealed === 'string' && !sealed.includes(deposit),
   'real encryption hides financial identifiers');
assert.equal((await swapJournal.load('wallet-a'))[0].swap.depositAddress, deposit);
assert.deepEqual(await swapJournal.load('wallet-b'), []);
store.set('swaps:wallet-a', 'damaged-receipt');
await assert.rejects(swapJournal.save(saved));
assert.equal(store.get('swaps:wallet-a'), 'damaged-receipt', 'unreadable history is preserved');
rig.t.state.gid = 'wallet-a';
rig.t.state.wallet = { address: recipient };
const mined = { txid: 'cd'.repeat(32), value: 20000000, confirmed: false };
rig.t.setChain({ gid: 'wallet-a', received: [mined] });
assert.equal(shieldedSwapReceipt(response, [mined.txid]).confirmed, false);
mined.confirmed = true;
assert.equal(shieldedSwapReceipt(response, [mined.txid]).confirmed, true);
assert.equal(shieldedSwapReceipt(response, ['ab'.repeat(32)]), null);
assert.equal(shieldedSwapReceipt({ ...response, recipient: 'another-wallet' }, [mined.txid]), null);
console.log('ok  receipt confirmation requires matching wallet-scanned transaction evidence');
rig.t.setLocked({ damaged: true });
await assert.rejects(swapJournal.load('wallet-b'), /Unlock/);
console.log("ok  real wallet-key encryption, wallet isolation, damaged data and " +
  "locked-vault guards");
process.exit(0);
