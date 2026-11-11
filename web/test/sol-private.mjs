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
const { docFields } = await import("../signed.js");
const { fakePasskey } = await import("./passkey-fixture.mjs");
const rig = await loadRig();
const { t, data, waitFor } = rig;
const { acceptPrivate, privateDisclosure, privateServed, solMode, solTab }
  = await import("../app-sol.js");
const { createDialog } = await import("../app-shell.js");
const keystore = await import("../app-keystore.js");
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;
const PRIVATE = "mainnet-private";
const PLAIN = "mainnet-plain";
const KEY = (gid) => "solmode:" + gid;
const stored = () => JSON.parse(storage.get("zf-signpins") ?? "{}");
assert.ok(loaded.some((url) => url.endsWith("/web/app-sol.js")), "control: the hook sees loads");
// Every solstart/1 that the page writes: [wallet id, cluster]. The test writes its own with
// data.set, which this hook does not see.
const starts = [];
const recordStarts = (p, value) => {
  if (p.endsWith("/solstart/1")) starts.push([p.split("/")[1], value.cluster]);
  return value;
};
rig.hook.before = recordStarts;

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
// The browser needs protection before the create dialog goes on (as mainnet-on.mjs).
async function protectBrowser() {
  assert.equal(await keystore.persist(), true);
  const { userAgent, onLine } = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { configurable: true,
    value: { userAgent, onLine, ...fakePasskey() } });
  await keystore.lockWithPasskey();
  assert.equal(keystore.passkeyProtected(), true, "the browser is protected");
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

// ── Seat 1 with solAuto, the pin and no probe signs nothing ──
{
  const off = await rig.wallet({ name: "No probe", network: "mainnet" });
  await probeWith(404);
  acceptPrivate(off);
  await rig.db.doc("groups/" + off).update({ solana: true, solMode: PRIVATE });
  await t.putSec(off, 1, { solAuto: true });
  assert.equal(solMode(off), "unserved");
  for (let k = 0; k < 10; k++) {
    t.refilter();
    await sleep(100);
  }
  assert.equal(data.get(path(off, "solstart/1")), undefined, "no start without the probe");
  assert.deepEqual(starts, [], "the page wrote no start");
  assert.notEqual(t.sol?.ctl.gid, off, "and no controller follows the wallet");
  // Once the server serves it, seat 1 starts the private wallet.
  await probeWith(200);
  await waitFor("the private start", () => starts.length === 1);
  assert.deepEqual(starts, [[off, PRIVATE]]);
}
step("seat 1 with solAuto and the pin signs nothing on a server without the private Worker");

// ── The create dialog: the private choice of a new mainnet wallet ──
await protectBrowser();
const dialog = () => drawn(() => createDialog());
const byId = (node, id) => findAll(node, (x) => x.attrs?.id === id)[0] ?? null;
const withFields = (fields, fn) => {
  const real = globalThis.document;
  globalThis.document = new Proxy(real, { get: (o, k) => (k === "getElementById"
    ? (id) => (Object.hasOwn(fields, id) ? fields[id] : real.getElementById(id)) : real[k]) });
  try {
    return fn();
  } finally {
    globalThis.document = real;
  }
};
const DEVICE = { "g-n": { value: "3" }, "g-t": { value: "2" }, "my-name": { value: "Ana" } };
// The dialog from the device step to the review, for a new mainnet wallet with the tick.
async function review(name) {
  Object.assign(t.ui, { create: true, createStep: 2, net: "mainnet", ack: true,
    createDraft: { n: 3, t: 2 } });
  await withFields({ ...DEVICE, "g-name": { value: name } }, () => dialog().on.submit(EV));
  assert.equal(t.ui.createStep, 3, "the review");
}
const reviewText = () => textOf(findAll(dialog(),
  (n) => n.attrs?.["aria-labelledby"] === "create-step-3")[0]);
const choice = () => byId(dialog(), "g-private");
const tick = () => choice().on.change({ target: { checked: true } });
// The submit of the review: the new wallet, or null when none was made.
async function submit() {
  const before = t.state.gid;
  await withFields({}, () => dialog().on.submit(EV));
  return t.state.gid !== before ? t.state.gid : null;
}
const planned = (gid) => {
  const g = data.get("groups/" + gid);
  return { pin: stored()[KEY(gid)] ?? null, hint: [g.solana ?? null, g.solMode ?? null],
    auto: t.sec(gid, 1)?.solAuto ?? null };
};
const NONE = { pin: null, hint: [null, null], auto: null };
{
  const CHOICE = "Private Solana on mainnet (staging test, at most 0.5 SOL).";
  await probeWith(404);
  await review("Not served");
  assert.equal(choice(), null, "no choice without the probe");
  assert.match(reviewText(), /Zcash mainnetZcash only/);
  await probeWith(200);
  assert.ok(choice(), "the choice with the probe");
  assert.equal("checked" in choice().attrs, false, "and it is off by default");
  says(reviewText(), [CHOICE, ...MAINNET_DISCLOSURE], "the choice");
  assert.match(reviewText(), /Zcash mainnetZcash only/, "the summary while it is off");
  t.ui.net = "testnet";
  assert.equal(choice(), null, "a testnet wallet has no private choice");
  t.ui.net = "mainnet";
  // Off: the plain path, as before. No pin, no hint, no solAuto.
  const plainPath = await submit();
  assert.ok(plainPath, "the wallet is made");
  assert.deepEqual(planned(plainPath), NONE, "the choice off plans nothing");
  assert.equal(t.signPins[KEY(plainPath)], undefined);
  // A probe that answers 404 before the submit: no wallet, and the dialog stays.
  await review("Gone");
  tick();
  assert.match(reviewText(), /\+ private Solana on mainnet/, "the summary names the choice");
  await probeWith(404);
  assert.equal(await submit(), null, "no wallet without the probe at the submit");
  assert.match(t.banner.text, /does not serve the private Solana wallet now/);
  assert.equal(t.ui.createStep, 3, "the dialog stays at the review");
  await probeWith(200);
  // A failed write of the pin: the wallet is made, and nothing of Solana starts.
  const failed = await pinsFail(submit);
  assert.ok(failed, "the Zcash wallet is made");
  assert.match(t.banner.text, /could not save that it accepts the private Solana wallet/);
  assert.deepEqual(planned(failed), NONE, "a failed pin starts nothing");
  assert.equal(t.signPins[KEY(failed)], undefined, "and the tab keeps no pin");
}
step("the create dialog offers the private choice only with the probe, off by default");

// ── The choice on: the pin, the hint, solAuto; the ceremony signs mainnet-private ──
const made = await (async () => {
  await review("Private");
  tick();
  const order = [];
  rig.hook.before = (p, value) => {
    recordStarts(p, value);
    const hint = /^groups\/\w+$/.test(p) && value.solMode && !order.length;
    if (hint) order.push(planned(p.split("/")[1]));
    return value;
  };
  const gid = await submit();
  rig.hook.before = recordStarts;
  assert.ok(gid, "the private wallet is made");
  assert.deepEqual(order, [{ pin: PRIVATE, hint: [null, null], auto: null }],
    "the pin is saved before the hint, and solAuto comes after it");
  assert.deepEqual(planned(gid), { pin: PRIVATE, hint: [true, PRIVATE], auto: true });
  return gid;
})();
{
  await waitFor("seat 1", () => t.state.seats[1]);
  for (const i of [2, 3]) await t.takeSeat(i, 3);
  await waitFor("every seat", () => Object.keys(t.state.seats).length === 3);
  await waitFor("wallet checked", () => Object.keys(t.state.verify).length === 3 && t.state.wallet);
  const dones = () => [1, 2, 3].map((i) => data.get(path(made, "soldone/" + i)));
  await waitFor("every private soldone", () => dones().every(Boolean), 30000);
  for (const d of dones().map(docFields)) assert.equal(d.cluster, PRIVATE, "each soldone");
  assert.equal(docFields(data.get(path(made, "solstart/1"))).cluster, PRIVATE);
  assert.deepEqual(starts.filter(([gid]) => gid === made), [[made, PRIVATE]],
    "seat 1 signed one start");
  assert.ok(starts.every(([, cluster]) => cluster === PRIVATE),
    "no start of the page names another label");
  assert.equal(t.plainLoading, null, "the plain controller never loaded");
}
step("the choice on pins, writes the hint, then solAuto, and seat 1 never signs mainnet-plain");

// ── The join card of a wallet with the private hint: the text and the accept tick ──
{
  await t.createGroup("Join", 3, 2, null, "mainnet");
  const gid = t.state.gid;
  await waitFor("seat 1", () => t.state.seats[1]);
  await rig.db.doc("groups/" + gid).update({ solana: true, solMode: PRIVATE });
  await waitFor("the hint", () => t.state.g?.solMode === PRIVATE);
  // A browser with no seat of the wallet gets the join card.
  const kept = t.secrets[gid + ":1"];
  delete t.secrets[gid + ":1"];
  try {
    const page = () => drawn(() => t.groupView());
    const join = () => button(page(), "Join as device 2");
    assert.ok(join(), "the join card");
    says(textOf(page()), ["Private Solana on mainnet", ...MAINNET_DISCLOSURE], "the join card");
    assert.equal("checked" in byId(page(), "j-private").attrs, false, "the tick is off");
    t.ui.join.ack = true;   // the mainnet tick of the join card (mainnet-on.mjs)
    await join().on.click(EV);
    assert.match(t.banner.text, /accepts the private Solana wallet before you join/);
    assert.deepEqual([t.localSeats(), t.signPins[KEY(gid)]], [[], undefined], "no seat, no pin");
    byId(page(), "j-private").on.change({ target: { checked: true } });
    await pinsFail(() => join().on.click(EV));
    assert.match(t.banner.text, /could not save that it accepts the private Solana wallet/);
    assert.deepEqual([t.localSeats(), t.signPins[KEY(gid)]], [[], undefined],
      "a failed pin takes no seat");
    await join().on.click(EV);
    await waitFor("seat 2", () => t.localSeats().includes(2));
    assert.equal(stored()[KEY(gid)], PRIVATE, "the join pinned the private mode first");
  } finally {
    t.secrets[gid + ":1"] = kept;
    await t.putSec(gid, 1, {});
  }
  // Without the hint the card has no private text and no tick.
  await t.createGroup("Join plain", 3, 2, null, "mainnet");
  const other = t.state.gid;
  await waitFor("seat 1", () => t.state.seats[1]);
  const held = t.secrets[other + ":1"];
  delete t.secrets[other + ":1"];
  try {
    const page = drawn(() => t.groupView());
    assert.ok(button(page, "Join as device 2"), "the join card");
    assert.equal(byId(page, "j-private"), null, "no private tick without the hint");
    assert.doesNotMatch(textOf(page), /Private Solana on mainnet/);
  } finally {
    t.secrets[other + ":1"] = held;
    await t.putSec(other, 1, {});
  }
}
step("the join card of a private wallet shows the disclosure, and its tick writes the pin");

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
