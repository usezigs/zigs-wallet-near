// Offline integration: real threshold shares/checker and fake chain. The existing Devnet proof
// fixture supplies the cryptographic bytes; synthetic mainnet controller metadata exercises the
// live-swap guard. This is not proof of mainnet settlement or a funded provider payout.
import assert from 'node:assert/strict';
import { approve } from '../sol/approve.js';
import { base58 } from '../sol/docs.js';
import { decodeIntent } from '../sol/intent.js';
import { propose } from '../sol/propose.js';
import { ensureWorker } from '../sol/session.js';
import { poolSwapMark, poolSwapProblem } from '../sol/swap.js';
import { G, preparedOf, transactOf, utxoOf } from './sol-fixture.mjs';
import { installTestGroup } from './sol-pay-rig.mjs';
import { c, chain, feeAddress, ssOf, waitFor, waitStatus } from './sol-setup.mjs';

await installTestGroup();
await ensureWorker(c);
c.wallet = { cluster: 'mainnet', mode: 'pool', label: 'devnet' };
const deadline = new Date(Date.now() + 6 * 3600_000).toISOString();
const mode = process.argv.includes('--public') ? 'public' : 'basic';
const cutoff = Math.floor((Date.parse(deadline) - 30 * 60_000) / 1000);
const deposit = base58(G.withdraw.withdraw.recipient), reads = [];
c.host.swapCheck = async (ask) => { reads.push(ask); return {
   lines: ['Synthetic checked swap'] }; };
chain.utxos = [utxoOf(G.withdraw)];
chain.prepared = (args) => {
  assert.equal(args.recipient, G.withdraw.withdraw.recipient);
  assert.equal(Number(args.expiry), cutoff, 'proof expires before provider deposit closes');
  return preparedOf(G.withdraw, args);
};
let id;
chain.reproved = () => ({ data: transactOf(G.withdraw, decodeIntent(ssOf(id).intent).expiry,
  { proof: '05', root: 300 }) });
const args = { recipient: deposit, amount: '0.002',
  swap: poolSwapMark(deposit, deadline, mode) };
id = await propose(c, 'withdraw', args);
await waitFor('swap proposal', () => ssOf(id));
assert.equal(ssOf(id).swap, args.swap, 'author-signed proposal carries the swap mark');
assert.equal(poolSwapProblem(ssOf(id)), null);
assert.equal(reads.length, 2, 'proposer checks before proving and before creating its account');
assert.equal(reads[0].refundTo, feeAddress(1));
await assert.rejects(propose(c, 'withdraw', args), /already has a withdrawal/);
await waitFor('independent withdrawal review', () => c.snaps[id] && c.seen[id]);
await approve(c, ssOf(id), 1);
await approve(c, ssOf(id), 2);
await waitStatus(id, 'sent', 60000);
assert.ok(reads.length >= 5, 'both approving devices and executor verify the swap');
assert.ok(reads.every((ask) => ask.confidentiality === mode),
  'every check pins the selected route');
assert.equal(ssOf(id).outcome, 'confirmed');
console.log("ok  private swap proposal, signed mark, bounded proof expiry, two " +
  "approvals and execute");
process.exit(0);
