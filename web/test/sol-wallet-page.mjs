// The wallet page of a private Solana wallet on mainnet (slice 8g) against the real page modules
// and the rig (sol-rig.mjs). The Solana tab shows for a wallet that waits for the accept of this
// browser and for a wallet that this server does not serve: the tab says why. A testnet wallet
// and a served plain wallet keep their tabs, and a plain wallet on a server that does not serve
// it has none. The page loads the plain controller once and never unloads it, so the plain wallet
// comes last and only its sections are read.
// Run: node web/test/sol-wallet-page.mjs   (Node 26)
import assert from "node:assert/strict";
import { loadRig, mainnetConfig } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, data, waitFor } = rig;
// No names of page.mjs: the import gives the same module instance as the page.
const { privateDisclosure, privateServed, solMode, solTabOn } = await import("../app-sol.js");
const { MAINNET_DISCLOSURE } = await import("../sol/net.js");
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;
const PRIVATE = "mainnet-private";
const ACCEPT_INTRO = "Device 1 started a private Solana wallet on mainnet.";
const UNSERVED = "This server does not serve the private Solana wallet, so it does not open here.";

// The private Worker (D14): HEAD /sol/worker-mainnet.js answers `probe.status`.
const probe = { status: 200 };
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "/sol/worker-mainnet.js") return rigFetch(url, init);
  return new Response(null, { status: probe.status });
};
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

// The page, drawn with a recorder in place of the document.
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
    documentElement: { dataset: {} } };
  try {
    return build();
  } finally {
    globalThis.document = real;
  }
}
const findAll = (node, ok) => (typeof node !== "object" || node === null ? []
  : [...(ok(node) ? [node] : []), ...(node.kids ?? []).flatMap((k) => findAll(k, ok))]);
const textOf = (node) => node?.text ?? (node?.kids ?? []).map(textOf).join("");
const sections = () => t.walletSections().map(([id]) => id);
// The panel of section `id` as the page draws it: walletView falls back to Overview when the
// wallet has no such section.
function panel(id) {
  t.ui.tab = id;
  const tree = drawn(() => t.walletView(null, null));
  return findAll(tree, (n) => n.attrs?.id === "panel-" + id)[0] ?? null;
}

// ── A testnet wallet keeps its Solana tab ──
const testnet = await rig.wallet({ name: "Testnet" });
assert.equal(solMode(testnet), null, "a testnet wallet has no mode");
assert.equal(solTabOn(testnet), true);
assert.ok(sections().includes("solana"), "the testnet wallet lists the Solana tab");
step("a testnet wallet keeps its Solana tab");

// ── The accept: the tab shows the accept card with the disclosure ──
mainnetConfig.status = 200;
const wait = await rig.wallet({ name: "Waits", network: "mainnet" });
{
  await waitFor("the start watch", () => rig.live(path(wait, "solstart")) >= 1);
  await signStart(wait, PRIVATE);
  await waitFor("the accept", () => solMode(wait) === "accept");
  assert.deepEqual([t.solOn(wait), t.plainOn(wait), solTabOn(wait)], [false, false, true]);
  assert.ok(sections().includes("solana"), "the accept wallet lists the Solana tab");
  privateDisclosure();
  await waitFor("the disclosure", () => privateDisclosure() !== null);
  const tab = panel("solana");
  assert.ok(tab, "the page draws the Solana panel");
  const text = textOf(tab);
  for (const line of [ACCEPT_INTRO, ...MAINNET_DISCLOSURE]) {
    assert.ok(text.includes(line), "the accept card says: " + line);
  }
  const accept = findAll(tab, (n) => n.attrs?.["data-sol"] === "accept-private");
  assert.equal(accept.length, 1, "with its Accept button");
}
step("a wallet that waits for the accept shows the Solana tab with the accept card");

// ── Unserved: the tab says that this server does not serve the private wallet ──
const off = await rig.wallet({ name: "Off", network: "mainnet" });
{
  t.signPins["solmode:" + off] = PRIVATE;
  await probeWith(404);
  assert.equal(solMode(off), "unserved");
  assert.deepEqual([t.solOn(off), t.plainOn(off), solTabOn(off)], [false, false, true]);
  assert.ok(sections().includes("solana"), "the unserved wallet lists the Solana tab");
  const tab = panel("solana");
  assert.ok(tab, "the page draws the Solana panel");
  assert.ok(textOf(tab).includes(UNSERVED), "the tab says why it does not open");
  assert.equal(t.sol, null, "and no pool module loads");
  await probeWith(200);
}
step("an unserved private wallet shows the Solana tab with the unserved text");

// ── Plain: a served plain wallet keeps its tab, and one that is not served has none ──
{
  mainnetConfig.status = 404;
  delete t.ui.plainServed;
  const bare = await rig.wallet({ name: "Not served", network: "mainnet" });
  await waitFor("the plain probe", () => t.ui.plainServed === false);
  assert.equal(solMode(bare), "plain");
  assert.equal(solTabOn(bare), false);
  assert.ok(!sections().includes("solana"), "no Solana tab without the plain server");
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
