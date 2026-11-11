// The private mainnet wallet next to the Devnet one, with the real page modules, the real wasm
// and a stubbed Worker:
//  - the network of a payee address: a mainnet wallet shows and copies its shielded address
//    with solana-mainnet:, and a payment refuses a payee of another network before any proof;
//  - on mainnet the public program address has no Copy and a warning, no other address that no
//    deployed program can move SOL from has a Copy, and the move of the beta funds is hidden;
//  - the texts of the tab on each network: the names, the faucet, the explorer links, the
//    saved recipients, the cap line and the keys outside the group;
//  - the texts of a fee address with too little SOL (Add SOL, the line of an execute that no
//    seat of this browser can pay) on each network.
// Run: node web/test/sol-pool-mainnet.mjs   (Node 26)
import assert from "node:assert/strict";
import { addSol } from "../sol/addsol.js";
import { agreement } from "../sol/ceremony.js";
import { base58, keyOfBase58 } from "../sol/docs.js";
import { forgetBalances, maybeExecute } from "../sol/execute.js";
import { feeOf } from "../sol/fee.js";
import { CLUSTERS } from "../sol/guard.js";
import { propose } from "../sol/propose.js";
import { ensureWorker } from "../sol/session.js";
import { solView } from "../sol/view.js";
import { answersOf } from "./sol-chain.mjs";
import { W, c, chain, data, path, rig, t, waitFor } from "./sol-setup.mjs";

const step = (name) => console.log("ok  " + name);
const J = JSON.parse;

// ── The stubbed Worker ──
// prepare records the payee and stops the proposal there. The approvals program is deployed,
// the syncs show nothing, every fee address is empty, and the network refuses a test run for
// lack of SOL. `world.proposal` is the account of a payment that waits for its execute.
const STOP = "the test stops at prepare";
const prepared = [];
const calls = [];
const LOADER = keyOfBase58("BPFLoaderUpgradeab1e11111111111111111111111");
const BLOCK = "ab".repeat(32);
const world = { proposal: null };
const fallback = answersOf(chain);
const ANSWERS = {
  prepare: (args) => {
    prepared.push(args.recipient);
    throw new Error(STOP);
  },
  recipientAccount: () => ({ exists: true, owner: LOADER, lamports: "1", executable: true }),
  sync: () => ({ slot: "9", balance: "0", utxos: [] }),
  syncOld: () => ({ slot: "9", balance: "0", movable: "0", utxos: [] }),
  blockhash: () => ({ blockhash: base58(BLOCK), blockhashHex: BLOCK, lastValidBlockHeight: "1" }),
  simulate: () => ({ err: "InsufficientFundsForFee", logs: [] }),
  balance: () => ({ lamports: "0" }),
  account: (args) =>
    args.account === world.proposal?.address ? world.proposal.account : fallback.account(args),
};
const stub = {
  close() {},
  async call(cmd, args) {
    calls.push(cmd);
    return (ANSWERS[cmd] ?? fallback[cmd])(args);
  },
};
/** The Worker of the tab is the stub from now on (start() keeps a Worker of the same URL). */
function useStub() {
  if (c.worker !== stub) c.worker?.close();
  c.worker = stub;
  c.inited = c.rpcUrl;
}

// ── The tab as a tree of plain nodes ──
const node = (tag, attrs = {}, ...kids) => ({
  tag,
  attrs,
  kids: kids.flat(Infinity).filter(Boolean),
});
const textOf = (n) => (typeof n === "object" ? n.kids.map(textOf).join("") : String(n));
const findAll = (n, pick) =>
  typeof n !== "object"
    ? []
    : [...(pick(n) ? [n] : []), ...n.kids.flatMap((kid) => findAll(kid, pick))];
const view = (host = {}) =>
  solView({ ...c, host: { ...c.host, el: node, ...host } }, (fn) => fn, {});
const marked = (name, tab = view()) => findAll(tab, (n) => n.attrs["data-sol"] === name);
const shown = (name, tab = view()) => textOf(marked(name, tab)[0]);

const copied = [];
const clipboard = { writeText: async (text) => void copied.push(text) };
Object.defineProperty(globalThis.navigator, "clipboard", { value: clipboard, configurable: true });
/** What the Copy button `mark` puts on the clipboard. */
async function copy(mark) {
  const [button] = marked(mark);
  await button.attrs.onclick({ currentTarget: { textContent: "Copy" } });
  return copied.pop();
}

/** The marks of the Copy buttons of the tab, sorted. */
const copyMarks = () =>
  findAll(view(), (n) => String(n.attrs["data-sol"]).startsWith("copy-"))
    .map((n) => n.attrs["data-sol"])
    .sort();
const FEES = ["copy-fee-1", "copy-fee-2", "copy-fee-3"];
/** The cards of the tab while the group key holds 0.005 SOL of beta funds. */
function withOldFunds(read) {
  const kept = c.sync;
  c.sync = { ...kept, oldBalance: "5000000" };
  try {
    return read();
  } finally {
    c.sync = kept;
  }
}

/** Draws the tab with `fields` in `c` for a moment (the sync, the last Add SOL, the sessions). */
function viewWith(fields, host = {}) {
  const kept = Object.fromEntries(Object.keys(fields).map((k) => [k, c[k]]));
  Object.assign(c, fields);
  try {
    return view(host);
  } finally {
    Object.assign(c, kept);
  }
}
const TX = "5".repeat(64);
// A proposal that landed: its card shows the network and the explorer link of its transaction.
const LANDED = { id: "landed", by: 1, status: "sent", outcome: "confirmed", txId: TX, slot: 7 };
const ADDED = { status: "confirmed", amount: 10_000_000n, seat: 1, txId: TX, at: 1 };

/**
 * The texts of the tab that depend on the network, read from one drawing with the last Add SOL,
 * a landed proposal and a sync of `sync` (or none).
 */
function networkTexts(sync) {
  const networks = [];
  const recipientSelect = (args) => void networks.push(args.network);
  const fields = { added: ADDED, sessions: [LANDED], sync: { ...c.sync, ...sync } };
  const tab = viewWith(fields, { recipientSelect });
  const link = (mark) => findAll(marked(mark, tab)[0], (n) => n.tag === "a")[0]?.attrs.href;
  const [card] = findAll(tab, (n) => n.attrs["data-session"] === LANDED.id);
  return {
    all: textOf(tab),
    head: textOf(findAll(tab, (n) => n.attrs.class === "card-head")[0]),
    labels: findAll(tab, (n) => n.tag === "dt").map(textOf),
    fee: shown("fee-text", tab),
    faucet: marked("faucet", tab).length + marked("faucet-text", tab).length,
    cap: marked("cap", tab).map(textOf),
    links: [link("added"), link("result")],
    card: textOf(card),
    networks,
    custody: ["pool-upgrade", "zigs-program", "zigs-upgrade"].map((m) => marked(m, tab)[0])
      .map((n) => n && textOf(n)),
    custodyText: shown("custody-text", tab),
    status: shown("status", tab),
  };
}
const EXPLORER = "https://explorer.solana.com/tx/" + TX;
const POOL_TEXT =
  "The upgrade key of the pool sits outside the group: no device holds it, no device can stop " +
  "it, and Zigs does not know who controls it. It can replace the pool program. The pool also " +
  "has a protocol authority outside the group. By the Zolana spec it can pause the trees, and " +
  "then no payment can move the funds. Zigs did not read who holds that authority.";

/** Add SOL from an empty fee address: the refusal. Nothing is sent. */
async function poorAdd() {
  const at = calls.length;
  const error = await addSol(c, { amount: "0.01" }).then(() => null, (e) => e.message);
  assert.ok(calls.slice(at).includes("simulate"), "the test run said it");
  assert.ok(!calls.slice(at).includes("send"), "nothing sent");
  return error;
}

/** The line of a signed payment that no seat of this browser can pay (execute.js). */
async function noFundedLine() {
  forgetBalances();
  const id = "unfunded-" + c.gid;
  const body = "cd".repeat(40);
  const account = { exists: true, owner: "00".repeat(32), lamports: "1", data: "01ff" + body };
  world.proposal = { address: base58(BLOCK), account };
  const expiry = String(Math.floor(Date.now() / 1000) + 3600);
  const ss = { id, by: 1, status: "signed", account: BLOCK, body, expiry };
  // The run waits 15 s after the line: the test reads the line and does not wait for it.
  const launch = (_c, _key, run) => void run();
  maybeExecute(c, ss, { launch, failSession: () => assert.fail("the payment did not end") });
  await waitFor("the line of the wait", () => c.execWait[id] !== undefined);
  const line = c.execWait[id];
  delete c.execWait[id];
  return line;
}
const FUND = 'to a fee address in "Fund the fee address".';

/** Proposes a payment to `recipient`: the refusal (or STOP) and the payees that reached prepare. */
async function payTo(recipient) {
  const at = prepared.length;
  const error = await propose(c, "pay", { recipient, amount: "0.01" }).then(
    () => null,
    (e) => e.message,
  );
  return { error, payees: prepared.slice(at) };
}
const ENTER = "Enter the full shielded address of the payee.";
const NO_NETWORK =
  "This payee names no network, so it can be the address of a Solana Devnet wallet. Copy the " +
  "payee from the Solana tab of a mainnet wallet: it starts with solana-mainnet:. Nothing was " +
  "sent.";
const OTHER = (named, pays) =>
  `This payee is an address of a Solana ${named} wallet, and this wallet pays on Solana ` +
  `${pays}. Nothing was sent.`;

// ── Devnet: a bare or a Devnet payee passes, a mainnet payee is refused ──
await ensureWorker(c); // the fake chain answers the init: the Devnet genesis
useStub();
const devnet = agreement(c).done.pdaAddress;
{
  assert.equal(shown("shielded"), devnet, "Devnet shows the bare hex");
  assert.equal(await copy("copy-shielded"), devnet, "and copies it");
  const cases = [
    [devnet, STOP, [devnet]],
    ["solana-devnet:" + devnet, STOP, [devnet]],
    [" SOLANA-DEVNET:" + devnet.toUpperCase() + " ", STOP, [devnet]],
    ["solana-mainnet:" + devnet, OTHER("Mainnet", "Devnet"), []],
    ["solana-testnet:" + devnet, ENTER, []],
    ["solana-devnet:solana-devnet:" + devnet, ENTER, []],
    ["solana-devnet:" + devnet.slice(2), ENTER, []],
  ];
  for (const [recipient, error, payees] of cases) {
    assert.deepEqual(await payTo(recipient), { error, payees }, recipient.slice(0, 20));
  }
}
step("Devnet: a bare or solana-devnet: payee reaches the proof as bare hex; mainnet is refused");

{
  const pda = base58(agreement(c).done.pda);
  assert.equal(shown("owner"), pda, "Devnet shows the program address");
  assert.equal(await copy("copy-program"), pda, "and copies it");
  assert.equal(marked("owner-warning").length, 0, "with no warning");
  assert.deepEqual(copyMarks(), ["copy-program", "copy-shielded", ...FEES].sort());
  assert.equal(withOldFunds(() => marked("move").length), 1, "the move of the beta funds");
}
step("Devnet: the program address has Copy, and the move of the beta funds shows");

{
  const got = networkTexts({ lamports: "300000000", oldBalance: "0" });
  assert.equal(got.status, "ready");
  assert.equal(got.head, "Solana Devnet");
  const labels = ["Program address of the group (Devnet)", "Shielded SOL address · Devnet",
    "Privacy on Solana Devnet", "Upgrade key of the pool (Devnet)"];
  for (const label of labels) assert.ok(got.labels.includes(label), label);
  assert.match(got.all, /Solana Devnet hides a private payment’s amount on chain/);
  assert.match(got.fee, /Send Devnet SOL to it\./);
  assert.equal(got.faucet, 2, "the faucet link and its note");
  assert.deepEqual(got.cap, [], "Devnet has no cap");
  assert.deepEqual(got.links, [EXPLORER + "?cluster=devnet", EXPLORER + "?cluster=devnet"]);
  assert.match(got.card, /Solana Devnet/, "the card of a proposal names the network");
  assert.deepEqual(got.networks, ["devnet", "devnet"], "the saved recipients of Devnet");
  for (const label of ["Public fee funds", "Public deposit", "Public withdrawal"]) {
    assert.ok(got.all.includes(label + " · Solana Devnet"), label);
  }
  const ring1G = "AftkmqRyF25wtqEFq7eqxFGCqdL2jSo8DPGZE845Xyw9";
  assert.deepEqual(got.custody, [ring1G, undefined, undefined], "the pool key of ring1G");
  assert.equal(got.custodyText, POOL_TEXT + " The pool key was read from Devnet on 10 November " +
    "2026.");
  assert.doesNotMatch(got.all, /2kgbLow|263Kgjft|Mainnet|mainnet/, "no retired key, no mainnet");
}
step("Devnet: the tab names Devnet, the faucet, ?cluster=devnet and the pool key of ring1G");

{
  const poor = "The fee address of device 1 has too little Devnet SOL. Fund it with the link in " +
    "the fund card, then try again.";
  assert.equal(await poorAdd(), poor, "the text of fee.js");
  assert.ok((await noFundedLine()).endsWith("send Devnet SOL " + FUND));
}
step("Devnet: an empty fee address asks for Devnet SOL and points to the faucet link");

// ── A private mainnet wallet: the ceremony under mainnet-private, and the stub ──
const gidP = await rig.wallet({ name: "Private" });
await t.solLoad();
await waitFor("the private wallet", () => c.gid === gidP);
c.wallet = { cluster: "mainnet", mode: "pool", ...J(W.sol_pool_wallet("mainnet")) };
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
const mainnet = agreement(c).done.pdaAddress;

// ── Mainnet: the address names its network, and a payee must name mainnet ──
{
  const text = "solana-mainnet:" + mainnet;
  assert.equal(shown("shielded"), text, "mainnet shows the address with its network");
  const got = await copy("copy-shielded");
  assert.equal(got, text, "and copies it so");
  const cases = [
    [got, STOP, [mainnet]],
    [" SOLANA-MAINNET:" + mainnet.toUpperCase(), STOP, [mainnet]],
    [mainnet, NO_NETWORK, []],
    [devnet, NO_NETWORK, []],
    ["solana-devnet:" + devnet, OTHER("Devnet", "Mainnet"), []],
    ["solana-devnet:" + mainnet, OTHER("Devnet", "Mainnet"), []],
    ["solana-mainnet:" + mainnet.slice(2), ENTER, []],
  ];
  for (const [recipient, error, payees] of cases) {
    assert.deepEqual(await payTo(recipient), { error, payees }, recipient.slice(0, 20));
  }
}
step("mainnet: the copied solana-mainnet: address pays; bare hex and Devnet are refused");

{
  const pda = base58(agreement(c).done.pda);
  assert.equal(shown("owner"), pda, "mainnet shows the program address");
  const NEVER = "Never send public SOL to this address. No code can move it.";
  assert.equal(shown("owner-warning"), NEVER, "with the warning");
  assert.deepEqual(copyMarks(), ["copy-shielded", ...FEES].sort(), "and no Copy");
  assert.equal(withOldFunds(() => marked("move").length), 0, "no move of the beta funds");
}
step("mainnet: the program address has no Copy and a warning, and no move card shows");

{
  const got = networkTexts({ lamports: "300000000", oldBalance: "50000000" });
  assert.equal(got.status, "ready", "the start under mainnet-private counts");
  assert.equal(marked("add").length, 0, "no start card");
  assert.equal(got.head, "Solana Mainnet");
  const labels = ["Program address of the group (Mainnet)", "Shielded SOL address · Mainnet",
    "Privacy on Solana Mainnet", "Upgrade key of the pool (Mainnet)", "Zigs program (Mainnet)",
    "Upgrade key of the Zigs program (Mainnet)"];
  for (const label of labels) assert.ok(got.labels.includes(label), label);
  assert.match(got.all, /Solana Mainnet hides a private payment’s amount on chain/);
  assert.match(got.fee, /Send SOL to it\./);
  assert.equal(got.faucet, 0, "no faucet");
  const cap = "Private balance cap: 0.5 SOL. You can add up to 0.15 SOL now.";
  assert.deepEqual(got.cap, [cap], "the cap line counts both identities of the last sync");
  assert.deepEqual(got.links, [EXPLORER, EXPLORER], "no ?cluster");
  assert.match(got.card, /Solana Mainnet/, "the card of a proposal names the network");
  assert.deepEqual(got.networks, ["mainnet", "mainnet"], "the saved recipients of mainnet");
  for (const label of ["Public fee funds", "Public deposit", "Public withdrawal"]) {
    assert.ok(got.all.includes(label + " · Solana Mainnet"), label);
  }
  const program = J(W.sol_pool_wallet("mainnet")).program.split(":").at(-1);
  const pool = "CuZ42BsoBcLaNTUboJpGhekGmrYMZ7sRhwVki4frz1FB";
  const owner = "iFSbwFzpLpaGMKtn5S6gznvzXqAVunoB6rcSpGi956o";
  assert.deepEqual(got.custody, [pool, program, owner], "the keys outside the group");
  assert.equal(got.custodyText, POOL_TEXT + " One key that the Zigs owner holds can replace the " +
    "Zigs program, and then move the funds of every private wallet. The pool key was read from " +
    "mainnet on 10 November 2026.");
  assert.doesNotMatch(got.all, /Devnet|devnet|faucet\.solana|2kgbLow|263Kgjft/, "no Devnet text");
  const over = networkTexts({ lamports: "450000000", oldBalance: "100000000" }).cap;
  assert.deepEqual(over, ["Private balance cap: 0.5 SOL. You can add up to 0 SOL now."]);
  const unsynced = networkTexts({ lamports: undefined }).cap;
  assert.deepEqual(unsynced, ["Private balance cap: 0.5 SOL."], "no amount before a sync");
}
step("mainnet: the tab names mainnet, has no faucet and no ?cluster, and shows the cap line");

{
  const poor = 'The fee address of device 1 has too little SOL. Send SOL to it (see "Fund the ' +
    'fee address"), then try again.';
  assert.equal(await poorAdd(), poor, "no Devnet SOL and no faucet link");
  const line = await noFundedLine();
  assert.ok(line.endsWith("send SOL " + FUND), line);
  assert.doesNotMatch(line, /Devnet/);
}
step("mainnet: an empty fee address asks for SOL, with no faucet link");

console.log("sol-pool-mainnet: ok");
process.exit(0);
