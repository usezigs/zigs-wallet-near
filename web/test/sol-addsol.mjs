// The guards of Add SOL (web/sol/addsol.js) with the real page modules and the real wasm, and a
// stubbed Worker that answers the program account, the syncs and the send:
//  - on both clusters the approvals program must exist, run, and belong to the upgradeable loader;
//  - a private mainnet wallet counts a fresh sync of the PDA identity, the group-key identity and
//    the Add SOL of this tab that the sync does not show yet, without a trial balance limit;
//  - the last Add SOL with no answer blocks a new one; Devnet has no cap;
//  - the proof of a payment of this tab shows the Add SOL whose note it spends;
//  - after a refusal, nothing is compiled, signed, simulated or sent;
//  - the tables of guard.js (Worker only) name the programs and genesis hashes of the wasm rows.
// Run: node web/test/sol-addsol.mjs   (Node 26)
import assert from "node:assert/strict";
import { addSol } from "../sol/addsol.js";
import { agreement } from "../sol/ceremony.js";
import { base58, keyOfBase58 } from "../sol/docs.js";
import { feeOf } from "../sol/fee.js";
import { CLUSTERS } from "../sol/guard.js";
import { bytesOf, decodeIntent, hexOf, intentHex, pinsHex } from "../sol/intent.js";
import { ensureWorker } from "../sol/session.js";
import * as kit from "../sol/zolana.bundle.js";
import { answersOf } from "./sol-chain.mjs";
import { W, c, chain, data, done as devnetDone, path, rig, t, waitFor } from "./sol-setup.mjs";

const step = (name) => console.log("ok  " + name);
const J = JSON.parse;
const SOL = 1_000_000_000n;
const hexOfAddress = (address) => hexOf(kit.getAddressEncoder().encode(address));
const LOADER = hexOfAddress("BPFLoaderUpgradeab1e11111111111111111111111");
const NOT_DEPLOYED =
  "The Zigs program of this network is not deployed yet, so Add SOL is refused. Nothing was sent.";
const BUSY = "An Add SOL of this tab is still running. Nothing was sent.";
const UNCONFIRMED =
  "The last Add SOL of this tab is not confirmed yet. Try again in 3 minutes. Nothing was sent.";
// Past the 150 s in which an Add SOL with no answer can still land.
const LATER = 200_000;
// ── The stubbed Worker: what the chain shows, set by each case ──
const DEPLOYED = { exists: true, owner: LOADER, lamports: "1141440", executable: true };
const BLOCK = "ab".repeat(32);
const world = { program: "", account: DEPLOYED, pda: 0n, old: 0n, notes: [] };
Object.assign(world, { confirm: "", status: "", inputs: [] });
const calls = [];
const note = (hash, amount) => ({ hash: hash.repeat(32), mint: "SOL", amount: String(amount) });
const ANSWERS = {
  recipientAccount: ({ account }) =>
    account === world.program ? world.account : { exists: false },
  sync: () => ({ slot: "9", balance: String(world.pda), utxos: world.notes }),
  syncOld: () => ({ slot: "9", balance: String(world.old), movable: "0", utxos: [] }),
  blockhash: () => ({ blockhash: base58(BLOCK), blockhashHex: BLOCK, lastValidBlockHeight: "1" }),
  simulate: () => ({ err: null, logs: [] }),
  send: () => ({ signature: "sent" }),
  confirm: () => ({ status: world.confirm, slot: "9" }),
  status: () => ({ status: world.status, slot: "9" }),
  // The inputs of a proof, and no more: the proposal ends there.
  prepare: () => ({ inputs: world.inputs }),
};
// The jobs of the tab that run on their own (balances, rent) get the answers of the fake chain.
const fallback = answersOf(chain);
const stub = {
  close() {},
  async call(cmd, args) {
    calls.push({ cmd, args });
    return (ANSWERS[cmd] ?? fallback[cmd])(args);
  },
};
const SENDING = new Set(["blockhash", "simulate", "send", "confirm"]);

// The wasm of the tab: count each compile and each signature of a fee key.
const real = c.W;
const seen = { compiles: 0, signs: 0, intents: [] };
c.W = new Proxy(real, {
  get(w, k) {
    if (k === "compile_message") {
      return (intent, ...rest) => {
        seen.compiles += 1;
        seen.intents.push(hexOf(intent));
        return w.compile_message(intent, ...rest);
      };
    }
    if (k !== "sol_fee_sign") return w[k];
    return (...a) => {
      seen.signs += 1;
      return w.sol_fee_sign(...a);
    };
  },
});

/** The Worker of the tab is the stub from now on (start() keeps a Worker of the same URL). */
function useStub() {
  if (c.worker !== stub) c.worker?.close();
  c.worker = stub;
  c.inited = c.rpcUrl;
}

/** Add SOL is refused with `text`, and nothing is compiled, signed or sent. */
async function refused(amount, text, label) {
  const at = { calls: calls.length, compiles: seen.compiles, signs: seen.signs };
  await assert.rejects(() => addSol(c, { amount }), { message: text }, label);
  const sending = calls.slice(at.calls).filter((x) => SENDING.has(x.cmd));
  assert.deepEqual(sending, [], label + ": nothing sent");
  assert.equal(seen.compiles, at.compiles, label + ": nothing compiled");
  assert.equal(seen.signs, at.signs, label + ": nothing signed");
}

/** Add SOL passes: the fee key signs once and one send goes out. Returns the answer and `held`. */
async function added(amount, label) {
  const at = { calls: calls.length, signs: seen.signs };
  const got = await addSol(c, { amount });
  assert.equal(seen.signs, at.signs + 1, label + ": the fee key signed once");
  const sends = calls.slice(at.calls).filter((x) => x.cmd === "send");
  assert.equal(sends.length, 1, label + ": one send");
  return { got, held: decodeIntent(seen.intents.at(-1)).held };
}

/** Runs `fn` with the clock `ms` ahead. */
async function later(ms, fn) {
  const now = Date.now;
  Date.now = () => now() + ms;
  try {
    return await fn();
  } finally {
    Date.now = now;
  }
}

/** The program account that the last Add SOL asked for. */
const asked = () => calls.findLast((x) => x.cmd === "recipientAccount").args.account;

// ── Devnet: the program guard, and no cap ──
await ensureWorker(c); // the fake chain answers the init: the Devnet genesis
useStub();
Object.assign(world, { program: CLUSTERS.devnet.program, pda: 2n * SOL, confirm: "unknown" });
{
  const { got, held } = await added("1", "Devnet, 1 SOL");
  assert.equal(asked(), CLUSTERS.devnet.program, "Devnet reads its approvals program");
  assert.equal(got.status, "unknown");
  assert.equal(held, 0n, "Devnet has no cap: held 0, also with 2 SOL in the sync");
  world.confirm = "confirmed";
  await added("1", "Devnet keeps no Add SOL of this tab: no cap, no block");
  const bad = [
    ["no program account", { exists: false }],
    ["not executable", { ...DEPLOYED, executable: false }],
    ["another owner", { ...DEPLOYED, owner: "00".repeat(32) }],
  ];
  for (const [label, account] of bad) {
    world.account = account;
    await refused("0.01", NOT_DEPLOYED, "Devnet, " + label);
  }
  world.account = DEPLOYED;
}
step("Devnet: Add SOL needs the deployed approvals program and has no cap");

// ── A private mainnet wallet: the ceremony under mainnet-private, and the stub ──
const gidP = await rig.wallet({ name: "Private" });
await t.solLoad();
await waitFor("the private wallet", () => c.gid === gidP);
const pool = J(W.sol_pool_wallet("mainnet"));
c.wallet = { cluster: "mainnet", mode: "pool", ...pool };
await t.sol.add();
const dones = () => [1, 2, 3].every((i) => data.has(path(gidP, "soldone/" + i)));
await waitFor("every private soldone", dones, 30000);
await waitFor("the private agreement", () => agreement(c).state === "agree");
const published = () =>
  [1, 2, 3].every((i) => feeOf(c, i) && c.docs.solfee[i]?.key === feeOf(c, i).key);
await waitFor("every private fee key", published);
assert.equal(agreement(c).done.cluster, "mainnet-private");
useStub();
c.genesis = CLUSTERS.mainnet.genesis;
Object.assign(world, { program: CLUSTERS.mainnet.program, pda: 6n * SOL / 10n, old: 0n });
world.notes = [];
{
  for (const [label, account] of [
    ["no program account", { exists: false }],
    ["not executable", { ...DEPLOYED, executable: false }],
    ["another owner", { ...DEPLOYED, owner: "00".repeat(32) }],
  ]) {
    world.account = account;
    await refused("0.01", NOT_DEPLOYED, "mainnet, " + label + ", before the cap");
    assert.equal(asked(), pool.program.split(":").at(-1), "the last field of the program label");
  }
  world.account = DEPLOYED;
}
step("mainnet: deposits still require the deployed program of the signed label");

assert.equal(pool.cap, null, "the released mainnet wallet has no trial balance cap");
Object.assign(world, { pda: 2n * SOL, old: SOL, notes: [], confirm: "confirmed" });
{
  const first = await added("1.25", "a deposit above the old limit");
  assert.equal(first.held, 3n * SOL);
  assert.equal(first.got.amount, 1_250_000_000n);
  const second = await added("2", "a second large deposit");
  assert.equal(second.held, 4_250_000_000n, "pending confirmed deposits still count in the snapshot");
  const running = addSol(c, { amount: "0.01" });
  await assert.rejects(() => addSol(c, { amount: "0.01" }), { message: BUSY });
  assert.equal((await running).status, "confirmed");
}
step("mainnet deposits above 0.5 SOL sign and send once; concurrent clicks stay blocked");
{
  world.confirm = "unknown";
  const uncertain = await added("0.02", "an uncertain send");
  for (const status of ["pending", "none"]) {
    world.status = status;
    await refused("1", UNCONFIRMED, "uncertain deposit: " + status);
    assert.equal(calls.findLast(x => x.cmd === "status").args.signature, uncertain.got.txId);
  }
  world.status = "failed"; world.confirm = "confirmed";
  await added("1", "a failed prior send releases the next deposit");
  world.confirm = "unknown"; world.status = "none";
  await added("0.04", "an indexed deposit");
  await refused("1", UNCONFIRMED, "before the indexer sees it");
  world.notes.push(note("06", 40_000_000n)); world.pda += 40_000_000n;
  world.confirm = "confirmed";
  await added("1", "the indexer resolves the uncertain deposit");
  const send = ANSWERS.send;
  ANSWERS.send = () => { throw new Error("Blockhash not found"); };
  await assert.rejects(() => addSol(c, { amount: "0.06" }), /Blockhash not found/);
  ANSWERS.send = send;
  await refused("1", UNCONFIRMED, "a thrown send could still land");
  await later(LATER, () => added("1", "the expired blockhash releases the next deposit"));
}
step("uncertain sends remain protected until chain resolution or blockhash expiry");

// ── guard.js against the wasm rows (the program and the genesis of each cluster) ──
{
  assert.equal(pool.program.split(":").at(-1), CLUSTERS.mainnet.program, "the mainnet label");
  assert.equal(J(W.sol_pool_wallet("devnet")).program, W.sol_program_label());
  assert.equal(J(W.sol_pool_wallet("devnet")).cap, null, "Devnet has no cap");
  assert.equal(pool.cap, null, "mainnet has no balance cap");
  const last = W.sol_program_label().split(":").at(-1);
  assert.equal(keyOfBase58(last), null, "the Devnet label names no program");
  const fields = { commitment: "01".repeat(32), expiry: 1n, blockhash: "00".repeat(32) };
  const cancel = bytesOf(intentHex("cancelProposal", fields));
  const payer = feeOf(c, 1).key;
  const rows = [
    ["devnet", "mainnet", devnetDone],
    ["mainnet", "devnet", agreement(c).done],
  ];
  for (const [cluster, other, done] of rows) {
    const compile = (row) =>
      real.compile_message(cancel, bytesOf(pinsHex(done, payer, row.genesis)), new Uint8Array(0));
    const message = compile(CLUSTERS[cluster]);
    const accounts = kit.getCompiledTransactionMessageDecoder().decode(message).staticAccounts;
    assert.ok(accounts.includes(CLUSTERS[cluster].program), cluster + ": the program of the row");
    assert.ok(!accounts.includes(CLUSTERS[other].program), cluster + ": not the other program");
    assert.throws(() => compile(CLUSTERS[other]), /pins: /, cluster + ": the other genesis");
  }
}
step("guard.js names the program and the genesis of each wasm row");

console.log("sol-addsol: ok");
process.exit(0);
