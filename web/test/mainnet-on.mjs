// Mainnet selection, joining, receiving and prices in the released web experience.
// Address verification remains required; trial balance limits and audit checkboxes are absent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRig } from "./sol-rig.mjs";
import { fakePasskey } from "./passkey-fixture.mjs";

const rig = await loadRig();
const { t, waitFor } = rig;
const { MAINNET_ON, NETWORKS } = await import("../app-chain.js");
const { networkPick } = await import("../app-dom.js");
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

// Network selection is explicit, without a release-warning acknowledgement.
for (const net of ["testnet", "mainnet"]) {
  const pick = drawn(() => networkPick({ net }));
  assert.deepEqual(radios(pick).map(r => r.attrs.value), ["testnet", "mainnet"]);
  assert.equal(ticks(pick).length, 0);
  assert.doesNotMatch(textOf(pick), /unaudited|not audited|beta|0\.5|warning/i);
  assert.equal(radios(pick).find(r => "checked" in r.attrs).attrs.value, net);
}
{
  const sel = { net: "testnet" };
  radios(drawn(() => networkPick(sel)))[1].on.change();
  assert.equal(sel.net, "mainnet");
}
await protectBrowser();
const dialog = () => drawn(() => createDialog());
t.ui.create = true; t.ui.createStep = 2; t.ui.net = "mainnet";
{
  const fields = { "g-n": { value: "3" }, "g-t": { value: "2" },
    "g-name": { value: "Team" }, "my-name": { value: "Ana" } };
  const real = globalThis.document;
  globalThis.document = new Proxy(real, { get: (o, k) => k === "getElementById"
    ? id => fields[id] ?? real.getElementById(id) : real[k] });
  try { await dialog().on.submit(EV); } finally { globalThis.document = real; }
  assert.equal(t.ui.createStep, 3, "mainnet proceeds to review without an audit checkbox");
  const review = textOf(dialog());
  assert.match(review, /Zcash mainnet/);
  assert.doesNotMatch(review, /unaudited|not audited|0\.5|staging test/i);
  assert.equal(byId(dialog(), "g-ack"), null);
  findAll(dialog(), n => n.attrs?.["aria-label"] === "Close")[0].on.click();
  assert.equal(t.ui.create, false);
}
{
  t.ui.personal.net = "mainnet";
  const picked = drawn(() => t.personalCard(() => {}));
  assert.equal(ticks(picked).length, 0, "the account needs no release-warning checkbox");
  assert.doesNotMatch(textOf(picked), /unaudited|not audited|beta/i);
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
    assert.match(text, /Mainnet/, "the joining device sees the network");
    assert.doesNotMatch(text, /unaudited|not audited|beta|0\.5/i);
    assert.equal(ticks(page).length, 0);
    await button(pageTree(), "Join as device 2").on.click(EV);
    await waitFor("the seat", () => t.state.seats[2]);
    // The invite text of a mainnet wallet says that devices use the web app for now.
    const link = "https://zigs.test/#" + joined + ".key";
    assert.match(inviteMessage(link),
      /This is a mainnet wallet, so every device must use the web app for now\./);
    // The tick belongs to one wallet.
    t.openGroup(plain);
    await waitFor("the other wallet", () => t.state.gid === plain && t.state.g);
    assert.equal(t.ui.join.private, undefined, "private-mode consent belongs to one wallet");
    assert.doesNotMatch(inviteMessage(link), /mainnet/, "a testnet wallet has no such line");
  } finally {
    t.secrets[joined + ":1"] = kept;
  }
  console.log("ok  a device joins a mainnet wallet without a release-warning gate");
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
  assert.match(head, /Mainnet/);
  assert.doesNotMatch(head, /beta|not audited/i);
  assert.doesNotMatch(textOf(drawn(() => walletHeader({ ...wallet, network: "testnet" }))),
    /Beta|Not audited/, "a testnet header has no such badge");
  console.log("ok  the header of a mainnet wallet shows its network");

  // Verified addresses remain available before sync and at balances above the former trial limit.
  const address = t.state.wallet.address;
  const shows = () => textOf(drawn(() => receiveDialog())).includes(address.slice(0, 12));
  t.setChain(null);
  delete t.balCache[gid];
  assert.equal(shows(), true, "a verified address is available before its first balance sync");
  for (const total of [49_999_999, 50_000_000, 50_000_001, 1_000_000_000]) {
    t.balCache[gid] = { total, at: 0 };
    assert.equal(shows(), true, String(total));
    assert.doesNotMatch(textOf(drawn(() => receiveDialog())), /warning level|0\.5 ZEC/);
  }
  t.setChain(null);
}

// ── The observed portfolio value of the Overview ──
// The real chart hydrates its retained slot in app-loop. Browser tests cover its DOM and actual
// encrypted history; portfolio.mjs covers freshness, valuation and price-request caching.
{
  const realFetch = globalThis.fetch, realDocument = globalThis.document;
  const requests = [];
  let visibility = "hidden";
  globalThis.fetch = async (url, init) => {
    if (String(url) !== "/portfolio/prices") return realFetch(url, init);
    requests.push({ url, body: init.body, method: init.method });
    return Response.json({ source: "coingecko", prices: {
      zec: { usd: 123.45, at: Date.now() } } });
  };
  const draw = (tab) => {
    globalThis.document = new Proxy(realDocument, { get: (o, k) => ({
      createElement: (tag) => new Rec(tag), createElementNS: (_ns, tag) => new Rec(tag),
      createTextNode: (text) => ({ text }), visibilityState: visibility })[k] ?? o[k] });
    try { t.ui.tab = tab; return t.walletView(null, null); }
    finally { globalThis.document = realDocument; }
  };
  const keep = t.state.g;
  try {
    t.state.g = { ...keep, network: "testnet" };
    t.setChain({ gid, bal: { spendable: 900_000, pending: 100_000, height: 1 },
      received: [], sent: new Set(), cw: null });
    const testnet = draw("overview");
    assert.match(textOf(testnet), /Wallet balanceZEC0\.01 ZEC/);
    assert.equal(findNode(testnet, (n) => n.className === "portfolio-slot"), null);
    assert.deepEqual(requests, [], "testnet funds have no USD price request");
    t.state.g = keep;
    draw("overview");
    assert.deepEqual(requests, [], "a hidden mainnet tab makes no market request");
    visibility = "visible";
    for (const tab of ["activity", "settings"]) draw(tab);
    assert.deepEqual(requests, [], "other sections make no chart request");
    const mainnet = draw("overview"); draw("overview");
    assert.ok(findNode(mainnet, (n) => n.className === "portfolio-slot"),
      "mainnet mounts its live portfolio component");
    assert.doesNotMatch(textOf(mainnet), /Price of a NEAR Intents quote|ZEC valueUSD/);
    assert.equal(requests.length, 1, "one fixed market request for repeated draws");
    assert.equal(requests[0].url, "/portfolio/prices");
    assert.equal(requests[0].body, undefined, "no wallet balances or addresses in the request");
    console.log("ok  the mainnet portfolio uses a fixed market endpoint; testnet stays native");
  } finally {
    globalThis.fetch = realFetch; globalThis.document = realDocument;
    t.state.g = keep; t.setChain(null);
  }
}

// ── Numbers and texts ──
// The faucet is the Valar testnet faucet. Mainnet has a server and a warning level.
assert.equal(NETWORKS.testnet.faucet, "https://faucet.testnet.valargroup.dev/");
assert.deepEqual(NETWORKS.mainnet.servers, ["https://zcash-mainnet.chainsafe.dev"]);
assert.equal(NETWORKS.mainnet.cap, undefined, "mainnet has no trial balance limit");
assert.equal(NETWORKS.mainnet.prefix, "u1");
console.log("ok  the faucet is the Valar testnet faucet; mainnet has no trial cap");

// Metadata names the actual networks; visible navigation omits repeated release boilerplate.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\s+/g, " ");
assert.match(html, /Shared wallets for Zcash and Solana/);
assert.doesNotMatch(html, /Beta:|>Beta<|Not audited\./,
  "visible navigation omits repeated release warnings");
assert.doesNotMatch(html, /plain Solana account[^.]*(private|hides|shielded)/);
console.log("mainnet-on: ok");
process.exit(0);
