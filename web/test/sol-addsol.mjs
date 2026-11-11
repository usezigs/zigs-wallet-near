// The guards of Add SOL (web/sol/addsol.js) with the real page modules and the real wasm, and a
// stubbed Worker that answers the program account, the syncs and the send:
//  - on both clusters the approvals program must exist, run, and belong to the upgradeable loader;
//  - a private mainnet wallet counts a fresh sync of the PDA identity, the group-key identity and
//    the Add SOL of this tab that the sync does not show yet, against the cap of the wasm row;
//  - the last Add SOL with no answer blocks a new one; Devnet has no cap;
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
const CAP = 500_000_000n;
const hexOfAddress = (address) => hexOf(kit.getAddressEncoder().encode(address));
const LOADER = hexOfAddress("BPFLoaderUpgradeab1e11111111111111111111111");
const NOT_DEPLOYED =
  "The Zigs program of this network is not deployed yet, so Add SOL is refused. Nothing was sent.";
const BUSY = "An Add SOL of this tab is still running. Nothing was sent.";
const NO_CAP =
  "The cap of this private wallet is not known, so Add SOL is refused. Nothing was sent.";
const UNCONFIRMED =
  "The last Add SOL of this tab is not confirmed yet. Try again in 3 minutes. Nothing was sent.";
// Past the 150 s in which an Add SOL with no answer can still land.
const LATER = 200_000;
const capText = (room) =>
  "The private balance of this test wallet is capped at 0.5 SOL. " +
  `You can add up to ${room} SOL now. Nothing was sent.`;

// ── The stubbed Worker: what the chain shows, set by each case ──
const DEPLOYED = { exists: true, owner: LOADER, lamports: "1141440", executable: true };
const BLOCK = "ab".repeat(32);
const world = { program: "", account: DEPLOYED, pda: 0n, old: 0n, notes: [] };
Object.assign(world, { confirm: "", status: "" });
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
step("mainnet: the program of the signed label must be deployed, before the cap is checked");

{
  // A mainnet wallet with no cap fails closed: no Add SOL with held 0.
  const kept = c.wallet;
  c.wallet = { ...kept, cap: null };
  try {
    await refused("0.01", NO_CAP, "mainnet with no cap");
  } finally {
    c.wallet = kept;
  }
}
step("mainnet: a wallet with no cap is refused, never sent with held 0");

{
  // The saved snapshot shows nothing; the fresh sync shows 0.45 SOL.
  c.sync = { ...c.sync, lamports: "0", balance: "0 SOL" };
  world.pda = 45n * SOL / 100n;
  await refused("0.1", capText("0.05"), "the fresh sync, not c.sync");
  // The group-key identity counts too.
  Object.assign(world, { pda: 3n * SOL / 10n, old: 15n * SOL / 100n });
  await refused("0.1", capText("0.05"), "the old identity counts");
  Object.assign(world, { pda: 6n * SOL / 10n, old: 0n });
  await refused("0.000000001", capText("0"), "above the cap: X is 0, never below");
}
step("mainnet: the cap counts a fresh sync of both identities and says how much SOL fits");

const n1 = note("01", 2n * SOL / 10n);
{
  Object.assign(world, { pda: 2n * SOL / 10n, old: SOL / 10n, notes: [n1] });
  await refused("0.200000001", capText("0.2"), "one lamport above 0.5 SOL");
  const { got, held } = await added("0.2", "exactly 0.5 SOL");
  assert.equal(held, 3n * SOL / 10n, "held is the fresh sync of both identities");
  assert.equal(held + got.amount, CAP);
  // The indexer does not show the deposit yet. n1 has the same amount, but it was there before.
  await refused("0.000000001", capText("0"), "the confirmed Add SOL that the sync does not show");
  // The sync shows it (n2), and a private send spent n1: the deposit counts once, not twice.
  const shown = [note("02", 2n * SOL / 10n), note("03", 5n * SOL / 100n)];
  Object.assign(world, { pda: 25n * SOL / 100n, notes: shown });
  await refused("0.2", capText("0.15"), "the sync shows the deposit");
}
step("mainnet: exactly 0.5 SOL passes, and a confirmed Add SOL counts until a sync shows it");

{
  // Two clicks: the second Add SOL waits for nothing and is refused.
  const first = addSol(c, { amount: "0.01" });
  await assert.rejects(() => addSol(c, { amount: "0.01" }), { message: BUSY });
  assert.equal((await first).status, "confirmed");
  // B (0.01) counts now. C gets no answer from the chain.
  world.confirm = "unknown";
  const { got } = await added("0.01", "an Add SOL with no answer");
  assert.equal(got.status, "unknown");
  for (const status of ["pending", "none"]) {
    world.status = status;
    await refused("0.01", UNCONFIRMED, "the last Add SOL is " + status);
    const ask = calls.findLast((x) => x.cmd === "status");
    assert.equal(ask.args.signature, got.txId, "the page asks for the Add SOL with no answer");
  }
  // It failed after all: it counts for nothing. B counts: 0.25 + 0.1 + 0.01.
  world.status = "failed";
  await refused("0.15", capText("0.14"), "a failed Add SOL counts for nothing");
  // D gets no answer, then the chain confirms it: it counts.
  const d = await added("0.01", "D");
  assert.equal(d.got.status, "unknown");
  world.status = "confirmed";
  await refused("0.14", capText("0.13"), "an Add SOL that the chain confirmed later counts");
  // E fails on chain at once: it counts for nothing.
  world.confirm = "failed";
  assert.equal((await added("0.01", "E")).got.status, "failed");
  await refused("0.14", capText("0.13"), "an Add SOL that failed counts for nothing");
  // One new note of 0.01 shows one of B and D, not both.
  world.notes = [...world.notes, note("04", SOL / 100n)];
  world.pda += SOL / 100n;
  await refused("0.14", capText("0.13"), "one note shows one Add SOL");
  await refused("0.14", capText("0.13"), "and the next sync with that note shows no other one");
}
step("mainnet: an Add SOL with no answer blocks the next one until the chain answers");

{
  // D shows. Nothing of this tab counts beyond the sync: 0.27 + 0.1.
  world.notes = [...world.notes, note("05", SOL / 100n)];
  world.pda += SOL / 100n;
  await refused("0.14", capText("0.13"), "the sync shows D");
  // F gets no answer, and the RPC forgets its status ("none"). Then the sync shows its note.
  Object.assign(world, { confirm: "unknown", status: "none" });
  assert.equal((await added("0.02", "F")).got.status, "unknown");
  await refused("0.01", UNCONFIRMED, "F: no answer and no note");
  world.notes = [...world.notes, note("06", 2n * SOL / 100n)];
  world.pda += 2n * SOL / 100n;
  await refused("0.12", capText("0.11"), "the sync shows F: it no longer refuses");
  // G gets no answer, and no note shows. After its window it no longer refuses, and it counts.
  await added("0.03", "G");
  await refused("0.01", UNCONFIRMED, "G can still land");
  await later(LATER, () => refused("0.09", capText("0.08"), "G after its window counts"));
  await refused("0.09", capText("0.08"), "G still counts, with no refusal");
  // H: the send throws, but H may still land. It refuses in its window, then it counts.
  const send = ANSWERS.send;
  ANSWERS.send = () => {
    throw new Error("Blockhash not found");
  };
  await assert.rejects(() => addSol(c, { amount: "0.01" }), { message: "Blockhash not found" });
  ANSWERS.send = send;
  await refused("0.01", UNCONFIRMED, "H can still land");
  await later(LATER, () => refused("0.08", capText("0.07"), "H after its window counts"));
}
step("mainnet: an Add SOL with no answer refuses until a sync shows it or its window ends");

// ── guard.js against the wasm rows (the program and the genesis of each cluster) ──
{
  assert.equal(pool.program.split(":").at(-1), CLUSTERS.mainnet.program, "the mainnet label");
  assert.equal(J(W.sol_pool_wallet("devnet")).program, W.sol_program_label());
  assert.equal(J(W.sol_pool_wallet("devnet")).cap, null, "Devnet has no cap");
  assert.equal(BigInt(pool.cap), CAP, "the cap of the mainnet row");
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
