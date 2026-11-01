// Mainnet is on (M1 of docs/hackathon-release.md), and the testnet faucet is the Valar faucet
// (M2). The network picker of a new wallet and of the personal account offers Testnet and Mainnet,
// Testnet is chosen, and Mainnet shows a tick that must be checked: in the create dialog before
// the device step ends, and on the join card before a seat is taken. A mainnet wallet shows a
// badge with its risk, a chat reads testnet and mainnet requests, and the address of a network
// with a cap stays hidden until the balance is known. Run: node web/test/mainnet-on.mjs (Node 26)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRig } from "./sol-rig.mjs";
import { fakePasskey } from "./passkey-fixture.mjs";

const rig = await loadRig();
const { t, waitFor } = rig;
const { MAINNET_ON, NETWORKS, capUnknown } = await import("../app-chain.js");
const { mainnetRisk, networkPick } = await import("../app-dom.js");
const { inviteMessage } = await import("../app-setup.js");
const { createDialog, browserSettings } = await import("../app-shell.js");
const { receiveDialog } = await import("../app-send.js");
const { walletHeader } = await import("../app-wallet.js");
const keystore = await import("../app-keystore.js");
assert.equal(MAINNET_ON, true, "mainnet is on in this release");

// The page, drawn with a recorder in place of the document.
class Rec extends globalThis.Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, kids: [], attrs: {}, style: {}, on: {}, dataset: {} });
    this.classList = { add: (...names) => {
      this.className = [...new Set([...(this.className || "").split(" "), ...names])]
        .filter(Boolean).join(" ");
    } };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { this.on[type] = fn; }
  append(...nodes) { this.kids.push(...nodes); }
  querySelector(selector) {
    return findNode(this, (node) => selector.startsWith(".")
      ? node.className?.split(" ").includes(selector.slice(1)) : node.tag === selector);
  }
  insertBefore(node, before) {
    const at = this.kids.indexOf(before);
    this.kids.splice(at < 0 ? this.kids.length : at, 0, node);
  }
  replaceChildren(...nodes) { this.kids = nodes; }
}
const drawn = (build) => {
  const real = globalThis.document;
  globalThis.document = { createElement: (tag) => new Rec(tag),
    createElementNS: (_namespace, tag) => new Rec(tag), createTextNode: (text) => ({ text }),
    documentElement: { dataset: {} } };
  try { return build(); } finally { globalThis.document = real; }
};
const findAll = (node, ok) => typeof node !== "object" || node === null ? []
  : [...(ok(node) ? [node] : []), ...(node.kids ?? []).flatMap((k) => findAll(k, ok))];
const findNode = (node, ok) => findAll(node, ok)[0] ?? null;
const textOf = (node) => node?.text ?? (node?.kids ?? []).map(textOf).join("");
const byId = (node, id) => findNode(node, (x) => x.attrs?.id === id);
const button = (node, text) => findNode(node, (x) => x.tag === "button" && textOf(x) === text);
const inputs = (node) => findAll(node, (x) => x.tag === "input");
const radios = (node) => inputs(node).filter((x) => x.attrs.type === "radio");
const ticks = (node) => inputs(node).filter((x) => x.attrs.type === "checkbox");
const EV = { preventDefault() {}, currentTarget: null, target: {} };

// The browser needs protection before a dialog goes on or a device joins (as unified-setup.mjs).
async function protectBrowser() {
  assert.equal(await keystore.persist(), true);
  const { userAgent, onLine } = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { configurable: true,
    value: { userAgent, onLine, ...fakePasskey() } });
  await keystore.lockWithPasskey();
  assert.equal(keystore.passkeyProtected(), true, "the browser is protected");
}

// ── The picker ──
// Testnet is chosen and Mainnet is offered. The tick shows when Mainnet is chosen, and it is
// checked only when the person checked it.
{
  const pick = drawn(() => networkPick({ net: "testnet", ack: false }));
  assert.deepEqual(radios(pick).map((r) => r.attrs.value), ["testnet", "mainnet"]);
  assert.deepEqual(radios(pick).map((r) => "checked" in r.attrs), [true, false],
    "Testnet is chosen");
  assert.equal(ticks(pick).length, 0, "no tick for Testnet");
  assert.match(textOf(pick), /Real ZEC\. At 0\.5 ZEC the app warns and hides the address/);
}
for (const ack of [false, true]) {
  const sel = { net: "mainnet", ack };
  const pick = drawn(() => networkPick(sel, "account", "p"));
  assert.deepEqual(radios(pick).map((r) => "checked" in r.attrs), [false, true],
    "Mainnet is chosen");
  assert.equal(ticks(pick).length, 1, "one tick for Mainnet");
  assert.equal("checked" in ticks(pick)[0].attrs, ack, "the tick shows the choice");
  assert.equal(ticks(pick)[0].attrs.id, "p-ack");
  assert.match(textOf(pick), /I understand that Zigs is not audited and that I can lose the funds in this account\./);
  ticks(pick)[0].on.change({ target: { checked: !ack } });
  assert.equal(sel.ack, !ack, "the tick writes the choice");
}
{
  const sel = { net: "testnet", ack: false };
  radios(drawn(() => networkPick(sel)))[1].on.change();
  assert.equal(sel.net, "mainnet", "the Mainnet radio chooses Mainnet");
}
// The create dialog, the join card and the personal account start on testnet, with no tick.
assert.deepEqual([t.ui.net, t.ui.ack, t.ui.personal.net, t.ui.personal.ack, t.ui.join.ack],
  ["testnet", false, "testnet", false, false]);
console.log("ok  the picker offers Testnet and Mainnet, and Mainnet shows the tick");

// ── The create dialog ──
await protectBrowser();
const dialog = () => drawn(() => createDialog());
const reviewOf = () => textOf(findNode(dialog(),
  (n) => n.attrs?.["aria-labelledby"] === "create-step-3"));
const at = (step) => { t.ui.create = true; t.ui.createStep = step; };
const field = (id, value) => ({ id, value, type: "text", dataset: {}, dispatchEvent() {},
  getAttribute: () => null });
const withFields = (fields, fn) => {
  const real = globalThis.document;
  globalThis.document = new Proxy(real, { get: (o, k) => (k === "getElementById"
    ? (id) => (Object.hasOwn(fields, id) ? fields[id] : real.getElementById(id)) : real[k]) });
  try { return fn(); } finally { globalThis.document = real; }
};
const RULE = { "g-n": { value: "3" }, "g-t": { value: "2" } };
const DEVICE = { ...RULE, "g-name": { value: "Team" }, "my-name": { value: "Ana" } };
const next = (fields = DEVICE) => withFields(fields, () => dialog().on.submit(EV));
{
  // A page redraw restores the typed fields by id. The Mainnet radio redraws the dialog, so the
  // name, the label and the description typed before stay.
  at(2);
  const typed = { "g-name": "Team treasury", "my-name": "Ana's phone", "g-description": "A note" };
  const page = (nodes) => ({ querySelector: () => null,
    querySelectorAll: (selector) => (selector === "input[id], select[id], textarea[id]"
      ? nodes : []) });
  const before = dialog();
  for (const id of [...Object.keys(typed), "g-net-mainnet"]) assert.ok(byId(before, id), id);
  const old = Object.entries(typed).map(([id, value]) => field(id, value));
  const saved = t.saveFormState(page(old));
  byId(before, "g-net-mainnet").on.change();
  assert.equal(t.ui.net, "mainnet", "the radio chose Mainnet");
  const after = dialog();
  assert.ok(byId(after, "g-ack"), "the redraw shows the tick");
  assert.deepEqual(radios(after).map((r) => "checked" in r.attrs), [false, true]);
  const fresh = Object.keys(typed).map((id) => field(id, ""));
  const globalDoc = globalThis.document;
  globalThis.document = new Proxy(globalDoc, { get: (o, k) => (k === "getElementById"
    ? (id) => fresh.find((f) => f.id === id) : globalDoc[k]) });
  try { t.restoreFormState(page(fresh), saved); } finally { globalThis.document = globalDoc; }
  assert.deepEqual(Object.fromEntries(fresh.map((f) => [f.id, f.value])), typed,
    "a redraw after the Mainnet radio keeps the typed fields");
  console.log("ok  the Mainnet radio redraw keeps the typed name, label and description");
}
{
  // The device step does not end without the tick. The error shows next to the tick.
  at(2); t.ui.net = "mainnet"; t.ui.ack = false;
  await next();
  assert.equal(t.ui.createStep, 2, "no tick: the dialog stays on the device step");
  assert.equal(t.ui.createError, null, "the dialog shows no second error");
  const tree = dialog(), error = byId(tree, "g-ack-error");
  assert.match(textOf(error), /Confirm that you understand Zigs is not audited before you create a mainnet wallet\./);
  assert.equal(error.attrs.role, "alert");
  const tick = byId(tree, "g-ack");
  assert.equal(tick.attrs["aria-invalid"], "true");
  assert.equal(tick.attrs["aria-describedby"], "g-ack-error");
  assert.equal(byId(tree, "create-error"), null, "only one alert");
  tick.on.change({ target: { checked: true } });
  assert.equal(byId(dialog(), "g-ack-error"), null, "the tick clears the error");
  await next();
  assert.equal(t.ui.createStep, 3, "with the tick, the dialog goes to the review");
  const review = reviewOf();
  assert.match(review, /Real ZEC\. Beta, not audited: you can lose the funds\. At 0\.5 ZEC the app warns and hides the address\. It cannot block deposits\./);
  assert.match(review, /Zcash mainnet/);
  assert.equal(review.includes(mainnetRisk()), true);
  assert.match(review, /Zcash mainnetZcash only/, "Solana Devnet is for testnet wallets only");
  assert.equal(byId(dialog(), "g-sol"), null, "and a mainnet wallet gets no Solana choice");
  // The dialog forgets the choice and the tick when it closes.
  findAll(dialog(), (n) => n.attrs?.["aria-label"] === "Close")[0].on.click();
  assert.deepEqual([t.ui.net, t.ui.ack, t.ui.ackBad, t.ui.create, t.ui.createStep],
    ["testnet", false, "", false, 0], "a closed dialog keeps no mainnet choice");
  // Testnet needs no tick and shows no risk line.
  at(2); t.ui.net = "testnet";
  await next();
  assert.equal(t.ui.createStep, 3, "testnet goes on without a tick");
  assert.doesNotMatch(reviewOf(), /Real ZEC/, "and shows no mainnet risk");
  t.ui.create = false; t.ui.createStep = 0;
  console.log("ok  the create dialog needs the tick before the device step ends");
}

// ── The personal account ──
{
  t.ui.personal.net = "mainnet";
  const picked = drawn(() => t.personalCard(() => {}));
  assert.equal(ticks(picked).length, 1, "the account card shows the tick for Mainnet");
  const create = button(picked, "Create account");
  await create.on.click({ preventDefault() {}, currentTarget: null });
  assert.equal(t.personal, null, "no account without the tick");
  assert.match(t.ui.personal.ackBad, /before you make a mainnet account\./);
  assert.equal(t.banner?.text === t.ui.personal.ackBad, false, "the banner does not repeat it");
  assert.match(textOf(byId(drawn(() => t.personalCard(() => {})), "p-ack-error")),
    /Confirm that you understand/);
  // The card forgets the choice and the tick when its disclosure closes.
  t.ui.personal.ack = true;
  const settings = { kids: drawn(() => browserSettings()) };
  const folded = findAll(settings, (n) => n.tag === "details"
    && textOf(n).startsWith("On-chain messaging account"))[0];
  folded.open = false;
  folded.on.toggle();
  assert.deepEqual([t.ui.personal.net, t.ui.personal.ack, t.ui.personal.ackBad],
    ["testnet", false, ""], "a closed account card keeps no mainnet choice");
  console.log("ok  the account card needs the tick and forgets it when it closes");
}

// ── A chat reads testnet and mainnet requests ──
const testAddr = "utest1m6h0x5p0ryej3e4raszk99rz3k3gxzj35j7ypw3mm98uxmxt3x7mnmu22cprpl7rls4cc5k"
  + "xzvhqxju6pp4rxsw6ajnkm0d4egf4yrjx";
const mainAddr = "u1ljgj2vz0uzz5ku88wq07pqwepyyaw6azem5rnl56xu0wfjkxpkd84e40y36wy6da7f"
  + "vcd845jwl09pg9uwc5zlx0cead3xsz7vuqm5z2";
const testReq = t.requestOf(`zcash:${testAddr}?amount=1`, true);
assert.ok(testReq && testReq.payees.length === 1, "a testnet request reads in a chat");
assert.equal(testReq.net, "test", "as a testnet request");
const mainReq = t.requestOf(`zcash:${mainAddr}?amount=1`, true);
assert.ok(mainReq && mainReq.payees.length === 1, "a mainnet request reads in a chat");
assert.equal(mainReq.net, "main", "as a mainnet request");
// A wallet and an account read the requests of their own network only.
const account = (network) => t.requestOf(`zcash:${mainAddr}?amount=1`, false, network);
assert.equal(account("mainnet")?.net, "main", "a mainnet account reads its own requests");
assert.notEqual(account("testnet")?.net, "main", "a testnet account reads no mainnet request");
console.log("ok  a chat reads testnet and mainnet requests");

// ── A device that joins a mainnet wallet ──
{
  const pageTree = () => drawn(() => t.groupView());
  // A testnet wallet shows no badge, no risk line and no tick on its join card.
  await t.createGroup("Plain", 3, 2, null, "testnet");
  const plain = t.state.gid;
  await waitFor("seat 1", () => t.state.seats[1]);
  const held = t.secrets[plain + ":1"];
  delete t.secrets[plain + ":1"];
  try {
    const page = pageTree();
    assert.match(textOf(page), /Join as device 2/);
    assert.equal(ticks(page).length, 0, "a testnet wallet needs no tick to join");
    assert.doesNotMatch(textOf(page), /Real ZEC/);
  } finally {
    t.secrets[plain + ":1"] = held;
  }
  await t.createGroup("Joined", 3, 2, null, "mainnet");
  const joined = t.state.gid;
  await waitFor("seat 1", () => t.state.seats[1]);
  const kept = t.secrets[joined + ":1"];
  delete t.secrets[joined + ":1"];
  try {
    const page = pageTree(), text = textOf(page);
    assert.match(text, /Join as device 2/);
    assert.match(text, /Mainnet · Beta · Not audited/, "the join card shows the badge");
    assert.ok(text.includes(mainnetRisk()), "and the risk line");
    assert.equal(ticks(page).length, 1, "and the tick");
    await button(page, "Join as device 2").on.click({ preventDefault() {}, currentTarget: null });
    assert.equal(t.state.seats[2], undefined, "no tick: no seat is taken");
    assert.match(t.ui.join.ackBad, /before you join a mainnet wallet\./);
    const bad = byId(pageTree(), "j-ack-error");
    assert.match(textOf(bad), /Confirm that you understand/);
    assert.equal(bad.attrs.role, "alert");
    assert.equal(t.banner?.text === t.ui.join.ackBad, false, "the banner does not repeat it");
    byId(pageTree(), "j-ack").on.change({ target: { checked: true } });
    assert.equal(t.ui.join.ack, true);
    await button(pageTree(), "Join as device 2").on.click({ preventDefault() {},
      currentTarget: null });
    await waitFor("the seat", () => t.state.seats[2]);
    // The invite text of a mainnet wallet says that devices use the web app for now.
    const link = "https://zigs.test/#" + joined + ".key";
    assert.match(inviteMessage(link),
      /This is a mainnet wallet, so every device must use the web app for now\./);
    // The tick belongs to one wallet.
    t.openGroup(plain);
    await waitFor("the other wallet", () => t.state.gid === plain && t.state.g);
    assert.equal(t.ui.join.ack, false, "another wallet needs its own tick");
    assert.doesNotMatch(inviteMessage(link), /mainnet/, "a testnet wallet has no such line");
  } finally {
    t.secrets[joined + ":1"] = kept;
  }
  console.log("ok  a device that joins a mainnet wallet sees the risk and ticks first");
}

// ── Change devices of a mainnet wallet ──
{
  // The new wallet stays on mainnet and needs no tick: the person ticked for the old wallet.
  const old = await rig.wallet({ name: "Old", network: "mainnet" });
  const real = globalThis.FormData;
  globalThis.FormData = class {
    get(k) { return { name: "New", n: "3", t: "2" }[k] ?? null; }
  };
  t.ui.move = true;
  t.ui.ack = false;
  try {
    await drawn(() => createDialog(t.state.g)).on.submit(EV);
  } finally {
    globalThis.FormData = real;
  }
  assert.notEqual(t.state.gid, old, "Change devices makes the new wallet");
  assert.equal(t.state.g.network, "mainnet", "on the network of the old wallet");
  console.log("ok  Change devices of a mainnet wallet needs no tick");
}

// ── A wallet of mainnet ──
const gid = await rig.wallet({ name: "Main", network: "mainnet" });
const wallet = t.state.g;
assert.equal(wallet.network, "mainnet");
{
  const room = t.requestOf(`zcash:${mainAddr}?amount=2`, false);
  assert.equal(room?.net, "main", "the room of a mainnet wallet reads its own requests");

  // The header of a mainnet wallet says Mainnet, Beta and Not audited in its text.
  const head = textOf(drawn(() => walletHeader(wallet)));
  assert.match(head, /Mainnet · Beta · Not audited/, "the header badge is text");
  assert.doesNotMatch(textOf(drawn(() => walletHeader({ ...wallet, network: "testnet" }))),
    /Beta|Not audited/, "a testnet header has no such badge");
  console.log("ok  the header of a mainnet wallet says Mainnet, Beta and Not audited");

  // The address stays hidden until the balance is known (fail closed), and the notes say that an
  // address that was shared stays valid.
  const address = wallet && t.state.wallet.address;
  assert.ok(address, "the wallet has an address");
  const shows = () => textOf(drawn(() => receiveDialog())).includes(address.slice(0, 12));
  t.setChain(null);
  delete t.balCache[gid];
  assert.equal(capUnknown(), true, "no balance known: unknown");
  assert.equal(shows(), false, "before the first sync the receive dialog hides the address");
  assert.match(textOf(drawn(() => receiveDialog())),
    /Wait for the first sync to finish\..*stays valid after it is shared/);
  t.balCache[gid] = null;
  assert.equal(capUnknown(), true, "an unreadable balance is unknown");
  t.balCache[gid] = { total: 49999999, at: 0 };
  assert.equal(capUnknown(), false, "a saved balance under the cap is known");
  assert.equal(shows(), true, "the saved balance under the cap shows the address");
  assert.match(textOf(drawn(() => receiveDialog())), /The address stays valid after you share it\./);
  t.balCache[gid] = { total: 50000000, at: 0 };
  assert.equal(shows(), false, "a saved balance at the cap hides it");
  assert.match(textOf(drawn(() => receiveDialog())), /stays valid after it is shared/);
  // The live balance wins over the saved one.
  t.setChain({ gid, bal: { spendable: 1, pending: 0, height: 1 }, received: [], sent: new Set(),
    cw: null });
  assert.equal(shows(), true, "a live balance under the cap shows the address");
  t.setChain(null);
  // A testnet wallet has no cap.
  const keep = t.state.g;
  t.state.g = { ...keep, network: "testnet" };
  delete t.balCache[gid];
  assert.equal(capUnknown(), false, "a testnet wallet has no cap");
  assert.equal(shows(), true, "and shows its address before the first sync");
  t.state.g = keep;
  console.log("ok  the address of a mainnet wallet stays hidden until the balance is known");
}

// ── Numbers and texts ──
// The faucet is the Valar testnet faucet. Mainnet has a server and a warning level.
assert.equal(NETWORKS.testnet.faucet, "https://faucet.testnet.valargroup.dev/");
assert.deepEqual(NETWORKS.mainnet.servers, ["https://zcash-mainnet.chainsafe.dev"]);
assert.equal(NETWORKS.mainnet.cap, 50000000, "the warning level is 0.5 ZEC");
assert.equal(NETWORKS.mainnet.prefix, "u1");
console.log("ok  the faucet is the Valar testnet faucet; mainnet has one server and a cap");

// Metadata names the actual networks; visible navigation omits repeated release boilerplate.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\s+/g, " ");
assert.equal(html.match(/Zcash \(testnet or mainnet\) and Solana Devnet/g)?.length, 1,
  "the description keeps the actual networks without repeated navigation boilerplate");
assert.doesNotMatch(html, /Beta:|>Beta<|Not audited\./,
  "visible navigation omits repeated release warnings");
assert.match(html, /A private Solana payment hides its amount, but its payee is public\./,
  "the description says that a private Solana payment hides its amount");
assert.equal(html.match(/hides its amount/g)?.length, 1, "and no other line makes the claim");
assert.doesNotMatch(html, /A Solana payment hides/, "a Solana deposit shows its amount");
console.log("ok  the page texts name Zcash and Solana Devnet");
console.log("mainnet-on: ok");
process.exit(0);
