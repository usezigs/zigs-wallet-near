// The private mainnet wallet next to the Devnet one, with the real page modules, the real wasm
// and a stubbed Worker:
//  - the network of a payee address: a mainnet wallet shows and copies its shielded address
//    with solana-mainnet:, and a payment refuses a payee of another network before any proof;
//  - on mainnet the public program address has no Copy and a warning, no other address that no
//    deployed program can move SOL from has a Copy, and the move of the beta funds is hidden.
// Run: node web/test/sol-pool-mainnet.mjs   (Node 26)
import assert from "node:assert/strict";
import { agreement } from "../sol/ceremony.js";
import { base58 } from "../sol/docs.js";
import { feeOf } from "../sol/fee.js";
import { propose } from "../sol/propose.js";
import { ensureWorker } from "../sol/session.js";
import { solView } from "../sol/view.js";
import { answersOf } from "./sol-chain.mjs";
import { W, c, chain, data, path, rig, t, waitFor } from "./sol-setup.mjs";

const step = (name) => console.log("ok  " + name);
const J = JSON.parse;

// ── The stubbed Worker: prepare records the payee and stops the proposal there ──
const STOP = "the test stops at prepare";
const prepared = [];
const ANSWERS = {
  prepare: (args) => {
    prepared.push(args.recipient);
    throw new Error(STOP);
  },
};
const fallback = answersOf(chain);
const stub = {
  close() {},
  async call(cmd, args) {
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
const view = () => solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
const marked = (name) => findAll(view(), (n) => n.attrs["data-sol"] === name);
const shown = (name) => textOf(marked(name)[0]);

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

console.log("sol-pool-mainnet: ok");
process.exit(0);
