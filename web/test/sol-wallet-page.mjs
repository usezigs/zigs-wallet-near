// The wallet page of a private Solana wallet on mainnet (slice 8g) against the real page modules
// and the rig (sol-rig.mjs). The Solana tab shows for a wallet that waits for the accept of this
// browser and for a wallet that this server does not serve: the tab says why, and the Open Solana
// button of the SOL row of Overview opens it, as a person does. A testnet wallet
// and a served plain wallet keep their tabs, and a plain wallet on a server that does not serve
// it has none. The parts of the page that name the Solana network (the tab header, the SOL and
// USDC rows, the Send and Receive pickers and the Add SOL row of Activity) say Mainnet for a
// private wallet and Devnet for a testnet wallet. They name no test network for a private wallet
// that does not open here, and its SOL row says why. The page loads the plain controller once and
// never unloads it, so the plain wallet comes last and only its sections are read. The fake chain
// of the tests (sol-chain.mjs) holds the deployed approvals program of Devnet, so the program
// guard of Add SOL passes there.
// Run: node web/test/sol-wallet-page.mjs   (Node 26)
import assert from "node:assert/strict";
import { SOL_EXPOSURE } from "../privacy-language.js";
import { agreement } from "../sol/ceremony.js";
import { keyOfBase58 } from "../sol/docs.js";
import { CLUSTERS } from "../sol/guard.js";
import { answersOf, makeChain } from "./sol-chain.mjs";
import { loadRig, mainnetConfig } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, data, waitFor } = rig;
// No names of page.mjs: the import gives the same module instance as the page.
const { privateDisclosure, privateServed, solMode, solSetup, solTabOn }
  = await import("../app-sol.js");
const { MAINNET_DISCLOSURE } = await import("../sol/net.js");
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;
const PRIVATE = "mainnet-private";
const ACCEPT_INTRO = "Device 1 started a private Solana wallet on mainnet.";
const UNSERVED = "This server does not serve the private Solana wallet, so it does not open here.";
const ACCEPT_ROW = "This browser takes part only after you accept it in the Solana tab.";
const UNSERVED_ROW = "This server does not serve it, so it does not open here.";
assert.doesNotMatch(MAINNET_DISCLOSURE.join(" "), /audited|staging|0\.5 SOL/);

// The private Worker (D14): HEAD /sol/worker-mainnet.js answers `probe.status`.
const probe = { status: 200 };
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "/sol/worker-mainnet.js") return rigFetch(url, init);
  return new Response(null, { status: probe.status });
};
// The server serves the plain wallet, as staging does: a new mainnet wallet starts as plain.
mainnetConfig.status = 200;
// The page asks once and keeps the answer: a test that asks again clears it first.
async function probeWith(status) {
  probe.status = status;
  delete t.ui.privateServed;
  privateServed();
  await waitFor("the probe", () => typeof t.ui.privateServed === "boolean");
}
// A start document that seat 1 signed, as the store holds it.
async function signStart(gid, cluster) {
  const doc = await t.signedDoc(gid, "solstart/1", 1, { cluster, at: Date.now() });
  data.set(path(gid, "solstart/1"), doc);
  rig.notify();
}
const dones = (gid) => [1, 2, 3].map((i) => data.get(path(gid, "soldone/" + i)));
// The pool controller follows wallet `gid`, and its Solana part is ready.
async function readyHere(gid) {
  await waitFor("every soldone", () => dones(gid).every(Boolean), 30000);
  const c = t.sol.ctl;
  await waitFor("the agreement", () => c.gid === gid && agreement(c).state === "agree");
  await waitFor("the ready part", () => solSetup()?.status === "ready" && c.loaded.solsessions);
  return c;
}

// The page, drawn with a recorder in place of the document. The page is hidden, so a draw of
// Overview asks for no price and starts no Solana sync.
class Rec extends globalThis.Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, kids: [], attrs: {}, style: {}, on: {}, dataset: {} });
    this.classList = { add() {} };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { this.on[type] = fn; }
  append(...nodes) { this.kids.push(...nodes); }
}
function drawn(build) {
  const real = globalThis.document;
  globalThis.document = { createElement: (tag) => new Rec(tag),
    createElementNS: (_namespace, tag) => new Rec(tag), createTextNode: (text) => ({ text }),
    documentElement: { dataset: {} }, visibilityState: "hidden" };
  try {
    return build();
  } finally {
    globalThis.document = real;
  }
}
const findAll = (node, ok) => (typeof node !== "object" || node === null ? []
  : [...(ok(node) ? [node] : []), ...(node.kids ?? []).flatMap((k) => findAll(k, ok))]);
const one = (node, ok) => findAll(node, ok)[0] ?? null;
const textOf = (node) => node?.text ?? (node?.kids ?? []).map(textOf).join("");
const sections = () => t.walletSections().map(([id]) => id);
// The panel of section `id` as the page draws it: walletView falls back to Overview when the
// wallet has no such section.
function panel(id) {
  t.ui.tab = id;
  const tree = drawn(() => t.walletView(null, null));
  return one(tree, (n) => n.attrs?.id === "panel-" + id);
}
// The Solana panel as a person reaches it: the Open Solana button of the SOL row of Overview,
// then the page as it draws after the click. No write to ui.tab after Overview.
function viaSolRow() {
  t.ui.tab = "overview";
  const row = one(drawn(() => t.walletView(null, null)),
    (n) => n.attrs?.["aria-labelledby"] === "asset-sol");
  const open = one(row, (n) => n.tag === "button" && textOf(n) === "Open Solana");
  assert.ok(open && !("disabled" in open.attrs), "the SOL row has an Open Solana button");
  open.on.click();
  assert.equal(t.ui.tab, "solana", "the button opens the Solana tab");
  const tab = one(drawn(() => t.walletView(null, null)), (n) => n.attrs?.id === "panel-solana");
  assert.ok(tab, "the page draws the Solana panel");
  return tab;
}
// The texts of the parts of the open wallet that name the Solana network: the lead above the
// title and the identity line of the Solana tab, the SOL and USDC rows and the two pickers of
// Overview, and the Add SOL row of Activity (null without a Solana part).
function networkParts() {
  const tab = panel("solana");
  const heading = one(tab, (n) => n.className === "page-heading");
  const overview = drawn(() => {
    t.ui.tab = "overview";
    return t.walletView(null, null);
  });
  const asset = (id) => one(overview, (n) => n.attrs?.["aria-labelledby"] === "asset-" + id);
  const pickers = findAll(overview, (n) => n.className === "overview-action-picker");
  assert.equal(pickers.length, 2, "Send and Receive");
  const activity = panel("activity");
  return {
    lead: textOf(one(heading, (n) => n.className === "label")),
    identity: textOf(one(tab, (n) => n.className === "wallet-sol-identity")),
    sol: textOf(asset("sol")),
    usdc: textOf(asset("usdc")),
    pickers: pickers.map(textOf).join(" | "),
    activity: textOf(one(activity, (n) => n.attrs?.["data-key"] === "sol-act-added")) || null,
  };
}
// The last Add SOL of this tab, as addSol of web/sol/main.js keeps it.
const added = (c) => Object.assign(c, { added: { seat: 1, amount: 20_000_000n, txId: "tx",
  status: "confirmed", slot: "4500123", at: Date.now() } });
// The parts of a mainnet wallet name no test network: neither Devnet nor testnet.
const noTestnet = (parts, what) => {
  for (const [name, text] of Object.entries(parts)) {
    if (text === null) continue;
    assert.doesNotMatch(text, /devnet|testnet/i, what + ": the " + name + " part");
  }
};

// ── The fake chain holds the approvals program of Devnet, as a deployed program ──
{
  const LOADER = keyOfBase58("BPFLoaderUpgradeab1e11111111111111111111111");
  const got = answersOf(makeChain()).recipientAccount({ account: CLUSTERS.devnet.program });
  assert.deepEqual([got.exists, got.executable, got.owner], [true, true, LOADER],
    "the account that requireProgram of addsol.js reads");
}
step("the fake chain holds the deployed approvals program of Devnet");

// ── A testnet wallet keeps its Solana tab and the Devnet texts ──
const testnet = await rig.wallet({ name: "Testnet" });
{
  assert.equal(solMode(testnet), null, "a testnet wallet has no mode");
  assert.equal(solTabOn(testnet), true);
  assert.ok(sections().includes("solana"), "the testnet wallet lists the Solana tab");
  await t.solLoad();
  await t.sol.add();
  added(await readyHere(testnet));
  const parts = networkParts();
  assert.equal(parts.lead, "Solana Devnet");
  assert.equal(parts.identity, "Shared wallet · Solana Devnet");
  assert.match(parts.sol, /^SOLSolana Devnet/);
  assert.ok(parts.sol.includes(SOL_EXPOSURE), "the SOL row says what Devnet shows");
  assert.equal(parts.usdc, "", "unsupported USDC is omitted");
  assert.ok(parts.pickers.includes("Solana Devnet · opens this wallet’s Solana tools"));
  assert.match(parts.activity, /^Received SOLSolana Devnet · slot/);
}
step("a testnet wallet keeps its Solana tab and says Solana Devnet");

// ── A private wallet names Solana Mainnet, and nowhere Devnet ──
const priv = await rig.wallet({ name: "Private", network: "mainnet" });
{
  t.signPins["solmode:" + priv] = PRIVATE;
  await probeWith(200);
  await rig.db.doc("groups/" + priv).update({ solana: true });
  await t.putSec(priv, 1, { solAuto: true });
  t.refilter();
  added(await readyHere(priv));
  assert.equal(solMode(priv), "private");
  assert.ok(sections().includes("solana"));
  const parts = networkParts();
  noTestnet(parts, "a private wallet");
  assert.equal(parts.lead, "Solana Mainnet");
  assert.equal(parts.identity, "Shared wallet · Solana Mainnet");
  assert.match(parts.sol, /^SOLSolana Mainnet/);
  assert.ok(!parts.sol.includes(SOL_EXPOSURE), "not the Devnet exposure");
  for (const line of ["Solana Mainnet hides the amount of a private payment on chain",
    "Add SOL and withdrawals show amounts and addresses."]) {
    assert.ok(parts.sol.includes(line), "the SOL row says: " + line);
  }
  assert.equal(parts.usdc, "", "the private wallet omits unsupported USDC");
  assert.ok(parts.pickers.includes("Solana Mainnet · opens this wallet’s Solana tools"));
  assert.ok(!parts.pickers.includes("Demo row"));
  assert.match(parts.activity, /^Received SOLSolana Mainnet · slot/);
}
step("a private wallet says Solana Mainnet in its tab, rows, pickers and activity");

// ── The accept: the tab shows the accept card with the disclosure ──
const wait = await rig.wallet({ name: "Waits", network: "mainnet" });
{
  await waitFor("the start watch", () => rig.live(path(wait, "solstart")) >= 1);
  await signStart(wait, PRIVATE);
  await waitFor("the accept", () => solMode(wait) === "accept");
  assert.deepEqual([t.solOn(wait), t.plainOn(wait), solTabOn(wait)], [false, false, true]);
  assert.ok(sections().includes("solana"), "the accept wallet lists the Solana tab");
  privateDisclosure();
  await waitFor("the disclosure", () => privateDisclosure() !== null);
  const tab = viaSolRow();
  const text = textOf(tab);
  for (const line of [ACCEPT_INTRO, ...MAINNET_DISCLOSURE]) {
    assert.ok(text.includes(line), "the accept card says: " + line);
  }
  const accept = findAll(tab, (n) => n.attrs?.["data-sol"] === "accept-private");
  assert.equal(accept.length, 1, "with its Accept button");
  const parts = networkParts();
  noTestnet(parts, "a wallet that waits for the accept");
  assert.ok(parts.sol.includes(ACCEPT_ROW), "the SOL row says how the wallet opens here");
  assert.deepEqual([parts.lead, parts.activity], ["Solana Mainnet", null]);
}
step("the SOL row of a wallet that waits for the accept opens the tab with the accept card");

// ── Unserved: the tab says that this server does not serve the private wallet ──
const off = await rig.wallet({ name: "Off", network: "mainnet" });
{
  t.signPins["solmode:" + off] = PRIVATE;
  await probeWith(404);
  assert.equal(solMode(off), "unserved");
  assert.deepEqual([t.solOn(off), t.plainOn(off), solTabOn(off)], [false, false, true]);
  assert.ok(sections().includes("solana"), "the unserved wallet lists the Solana tab");
  const tab = viaSolRow();
  assert.ok(textOf(tab).includes(UNSERVED), "the tab says why it does not open");
  assert.notEqual(t.sol.ctl.gid, off, "and the pool controller does not follow it");
  const parts = networkParts();
  noTestnet(parts, "an unserved wallet");
  assert.ok(parts.sol.includes(UNSERVED_ROW), "the SOL row says why the wallet does not open");
  assert.deepEqual([parts.lead, parts.activity], ["Solana Mainnet", null]);
  await probeWith(200);
}
step("the SOL row of an unserved private wallet opens the tab with the unserved text");

// ── Plain: a served plain wallet keeps its tab, and one that is not served has none ──
{
  mainnetConfig.status = 404;
  delete t.ui.plainServed;
  const bare = await rig.wallet({ name: "Not served", network: "mainnet" });
  await waitFor("the plain probe", () => t.ui.plainServed === false);
  assert.equal(solMode(bare), "plain");
  assert.equal(solTabOn(bare), false);
  assert.ok(!sections().includes("solana"), "no Solana tab without the plain server");
  const unavailableText = () => textOf(one(panel("overview"),
    (n) => n.attrs?.id === "sol-unavailable"));
  assert.match(unavailableText(), /Solana mainnet is unavailable on this server/);
  assert.doesNotMatch(unavailableText(), /testnet wallets/,
    "a disabled mainnet service never claims that Solana is testnet only");
  const confirmedKey = "confirmednet:" + bare;
  const confirmed = t.signPins[confirmedKey];
  delete t.signPins[confirmedKey];
  assert.match(unavailableText(), /Complete this wallet’s safety-number checks/,
    "an unconfirmed wallet explains its own blocker");
  t.signPins[confirmedKey] = confirmed;
  const version = t.state.g.version;
  t.state.g.version = 2;
  assert.match(unavailableText(), /Solana needs a version 3 wallet/);
  t.state.g.version = version;
  mainnetConfig.status = 200;
  delete t.ui.plainServed;
  const plain = await rig.wallet({ name: "Plain", network: "mainnet" });
  await waitFor("the plain probe", () => t.ui.plainServed === true);
  assert.equal(solMode(plain), "plain");
  assert.equal(solTabOn(plain), false, "a plain wallet has no pool tab");
  assert.ok(sections().includes("solana"), "the served plain wallet lists the Solana tab");
}
step("a served plain wallet keeps its Solana tab, and one not served has none");

console.log("sol-wallet-page: ok");
process.exit(0);
