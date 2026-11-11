// The private Solana wallet on mainnet at setup (slice 8d, design 2.4) against the real page
// modules and the rig (sol-rig.mjs): the accept of this browser (the first-seen pin
// "solmode:<wallet id>" in zf-signpins), and the Solana tab of a wallet that waits for the accept
// or that this server does not serve. A module hook records every module that loads: a browser
// with the pin never imports sol/plain/control.js. The page loads the plain controller once and
// never unloads it, so the plain wallet comes last, and it shows that the hook sees that import.
// Run: node web/test/sol-private.mjs   (Node 26)
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Every module that loads from here on. The rig and the page modules load after the hook.
const loaded = [];
registerHooks({
  load(url, context, nextLoad) {
    loaded.push(url);
    return nextLoad(url, context);
  },
});
const plainImported = () => loaded.some((url) => url.endsWith("/web/sol/plain/control.js"));

const { loadRig, mainnetConfig, sleep, storage } = await import("./sol-rig.mjs");
const { MAINNET_DISCLOSURE } = await import("../sol/net.js");
const rig = await loadRig();
const { t, data, waitFor } = rig;
const { acceptPrivate, privateDisclosure, privateServed, solMode, solTab }
  = await import("../app-sol.js");
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;
const PRIVATE = "mainnet-private";
const PLAIN = "mainnet-plain";
const KEY = (gid) => "solmode:" + gid;
const stored = () => JSON.parse(storage.get("zf-signpins") ?? "{}");
assert.ok(loaded.some((url) => url.endsWith("/web/app-sol.js")), "control: the hook sees loads");

// The private Worker (D14): HEAD /sol/worker-mainnet.js answers `probe.status`. The plain wallet
// and the private Worker URL need /sol/config-mainnet.json (sol-rig.mjs).
const probe = { status: 200 };
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "/sol/worker-mainnet.js") return rigFetch(url, init);
  return new Response(null, { status: probe.status });
};
mainnetConfig.status = 200;
// The page asks once and keeps the answer: a test that asks again clears it first.
async function probeWith(status) {
  probe.status = status;
  delete t.ui.privateServed;
  privateServed();
  await waitFor("the probe", () => typeof t.ui.privateServed === "boolean");
}
// localStorage refuses every write of zf-signpins while `fn` runs.
async function pinsFail(fn) {
  const real = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (k, v) => {
    if (k === "zf-signpins") throw new Error("QuotaExceededError");
    real(k, v);
  };
  try {
    return await fn();
  } finally {
    globalThis.localStorage.setItem = real;
  }
}
// A start document that seat 1 signed, as the store holds it.
async function signStart(gid, cluster) {
  const doc = await t.signedDoc(gid, "solstart/1", 1, { cluster, at: Date.now() });
  data.set(path(gid, "solstart/1"), doc);
  rig.notify();
}

const setPart = (gid, i, sol) => t.putSec(gid, i, { sol });
const dropPart = async (gid, i) => {
  delete t.sec(gid, i).sol;
  await t.putSec(gid, i, {});
};

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
const drawn = (build) => {
  const real = globalThis.document;
  globalThis.document = { createElement: (tag) => new Rec(tag),
    createElementNS: (_namespace, tag) => new Rec(tag), createTextNode: (text) => ({ text }),
    documentElement: { dataset: {} } };
  try {
    return build();
  } finally {
    globalThis.document = real;
  }
};
const findAll = (node, ok) => (typeof node !== "object" || node === null ? []
  : [...(ok(node) ? [node] : []), ...(node.kids ?? []).flatMap((k) => findAll(k, ok))]);
const textOf = (node) => node?.text ?? (node?.kids ?? []).map(textOf).join("");
const button = (node, text) => findAll(node, (x) => x.tag === "button" && textOf(x) === text)[0];
const EV = { preventDefault() {}, currentTarget: null, target: {} };
const says = (text, lines, what) => {
  for (const line of lines) assert.ok(text.includes(line), what + " says: " + line);
};

// ── The accept: the first-seen pin, read back from storage ──
const first = await rig.wallet({ name: "First", network: "mainnet" });
const second = await rig.wallet({ name: "Second", network: "mainnet" });
{
  assert.equal(t.signPins[KEY(first)], undefined, "control: no pin yet");
  await pinsFail(() => assert.throws(() => acceptPrivate(first),
    /could not save that it accepts the private Solana wallet\. Nothing was started\./));
  assert.equal(t.signPins[KEY(first)], undefined, "a failed write: the tab forgets its copy");
  assert.equal(stored()[KEY(first)], undefined, "and the storage has none");
  acceptPrivate(second);
  assert.equal(stored()[KEY(second)], PRIVATE, "the pin of another wallet is saved");
  assert.equal(stored()[KEY(first)], undefined, "and that save does not bring back the failed one");
  acceptPrivate(first);
  assert.deepEqual([t.signPins[KEY(first)], stored()[KEY(first)]], [PRIVATE, PRIVATE]);
  acceptPrivate(first);
  assert.equal(stored()[KEY(first)], PRIVATE, "a second accept keeps the pin");
  // The pin is never overwritten: another value refuses, and stays.
  const tampered = await rig.wallet({ name: "Tampered", network: "mainnet" });
  t.signPins[KEY(tampered)] = PLAIN;
  assert.throws(() => acceptPrivate(tampered), /could not save/);
  assert.equal(t.signPins[KEY(tampered)], PLAIN, "the value seen first stays");
  // A seat of this browser that holds a part of another label refuses: a plain part, a Devnet
  // part (no label), and a seat that published round 1 under the plain label and then stopped.
  const parts = [{ cluster: PLAIN, keyPackage: { k: 1 } }, { r1secret: { s: 1 } },
    { cluster: PLAIN, aborted: "Solana setup stopped: a test." }];
  for (const part of parts) {
    await setPart(tampered, 2, part);
    delete t.signPins[KEY(tampered)];
    assert.throws(() => acceptPrivate(tampered), /holds a Solana part of another network/);
    assert.equal(t.signPins[KEY(tampered)], undefined, JSON.stringify(part) + ": no pin");
  }
  await setPart(tampered, 2, { cluster: PRIVATE, keyPackage: { k: 1 } });
  acceptPrivate(tampered);
  assert.equal(stored()[KEY(tampered)], PRIVATE, "a part of the private label accepts");
  await dropPart(tampered, 2);
}
step("the accept writes the pin once, reads it back, and refuses a failed write");

// ── The Solana tab: the accept card with the disclosure, and the unserved text ──
const wait = await rig.wallet({ name: "Waits", network: "mainnet" });
{
  await waitFor("the start watch", () => rig.live(path(wait, "solstart")) >= 1);
  await signStart(wait, PRIVATE);
  await waitFor("the accept", () => solMode(wait) === "accept");
  privateDisclosure();
  await waitFor("the disclosure", () => privateDisclosure() !== null);
  assert.deepEqual(privateDisclosure(), MAINNET_DISCLOSURE, "the text of net.js");
  const card = drawn(() => solTab());
  says(textOf(card), ["Device 1 started a private Solana wallet on mainnet.",
    ...MAINNET_DISCLOSURE], "the accept card");
  // A seat that published its round 1 under the plain label refuses the accept.
  await setPart(wait, 2, { cluster: PLAIN, aborted: "Solana setup stopped: a test." });
  assert.equal(solMode(wait), "accept", "a stopped seat holds no part");
  await button(card, "Accept the private wallet").on.click(EV);
  assert.match(t.banner.text, /holds a Solana part of another network or mode/);
  assert.equal(t.signPins[KEY(wait)], undefined, "the refused accept writes no pin");
  await dropPart(wait, 2);
  await button(card, "Accept the private wallet").on.click(EV);
  assert.equal(stored()[KEY(wait)], PRIVATE, "the accept writes the pin");
  await waitFor("the pool controller", () => t.sol?.ctl.gid === wait);
  assert.equal(solMode(wait), "private");
  assert.deepEqual([t.plainOn(wait), t.solOn(wait)], [false, true]);
  // Without the probe the tab says that this server does not serve it, and nothing opens.
  await probeWith(404);
  assert.equal(solMode(wait), "unserved");
  assert.equal(textOf(drawn(() => solTab())),
    "This server does not serve the private Solana wallet, so it does not open here.");
  await probeWith(200);
}
step("the Solana tab shows the accept card with the disclosure, and the unserved text");

// ── A browser with the pin never imported the plain controller ──
assert.equal(t.plainLoading, null, "the plain controller never loaded");
assert.equal(plainImported(), false, "and sol/plain/control.js never loaded");
step("a browser with the pin never imports sol/plain/control.js");

// ── Last: a signed plain start beats the pin, and the plain controller loads ──
{
  const plain = await rig.wallet({ name: "Plain", network: "mainnet" });
  await waitFor("the start watch", () => rig.live(path(plain, "solstart")) >= 1);
  await signStart(plain, PLAIN);
  await waitFor("the plain controller", () => t.plainSol?.ctl.gid === plain);
  t.signPins[KEY(plain)] = PRIVATE;
  assert.equal(solMode(plain), "plain", "a pin does not beat a signed plain start");
  delete t.signPins[KEY(plain)];
  await waitFor("a plain part", () => t.sec(plain, 1).sol?.cluster === PLAIN);
  assert.throws(() => acceptPrivate(plain), /holds a Solana part of another network/,
    "and a browser with a plain part does not accept the private mode");
  assert.equal(plainImported(), true, "control: the hook sees the import of the plain controller");
  await sleep(100);
}
step("a signed plain start beats the pin, and the hook sees the plain controller load");

console.log("sol-private: ok");
process.exit(0);
