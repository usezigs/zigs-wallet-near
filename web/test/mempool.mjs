// Payments in the mempool (PRIVACY.md). While a wallet is open in a visible tab, the page asks the
// engine for the notes of the wallet that sit in the mempool of the light-wallet server and that no
// block holds: after each finished sync and every 30 s, one call at a time. It shows them as a line
// in the balance ("Not in a block yet") and as a row in the activity ("Receiving · not in a block
// yet"). They never count as Available or Incoming, and never touch the balance or the cap. A
// call that fails or takes 20 s shows nothing, and the last good list stays for 2 minutes. The page
// redraws when what it shows changes. The engine is a fake. The last parts check the transparent
// address of the group on Receive and the move of its funds to the shielded address.
// Run: node web/test/mempool.mjs   (Node 26)
import assert from "node:assert/strict";
import { loadRig, sleep } from "./sol-rig.mjs";

// The page registers its call every 30 s when it loads: keep the function to run it here.
const every30 = [];
const realInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...rest) => {
  if (ms !== 30000) return realInterval(fn, ms, ...rest);
  every30.push(fn);
  return 0;
};
const rig = await loadRig();
globalThis.setInterval = realInterval;
assert.equal(every30.length, 1, "the page asks every 30 s, from one place");
const { t, Z } = rig;
const chainMod = await import("../app-chain.js");
const { atCap, addrHidden, balanceNow, capUnknown, mempoolNow, NETWORKS, openTotal, runMempool,
  runSync } = chainMod;
const { receiveDialog } = await import("../app-send.js");
const view = await import("../app-account-view.js");
const { release } = await import("../app-kit.js");
const tick = () => every30[0]();   // the call every 30 s

// ── The page: a recorder for the document, and a tab that can hide ──
class Rec extends globalThis.Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, kids: [], attrs: {}, style: {}, on: {}, dataset: {} });
    this.classList = { add: () => {} };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { this.on[type] = fn; }
  append(...nodes) { this.kids.push(...nodes); }
  blur() {}
}
const bare = globalThis.document;
let visibility = "visible";
const tab = () => new Proxy(bare, { get: (o, k) => (k === "visibilityState" ? visibility : o[k]) });
globalThis.document = tab();
const drawn = (build) => {
  globalThis.document = new Proxy(bare, { get: (o, k) => ({ visibilityState: visibility,
    createElement: (tag) => new Rec(tag), createElementNS: (_ns, tag) => new Rec(tag),
    createTextNode: (text) => ({ text }) })[k] ?? o[k] });
  try { return build(); } finally { globalThis.document = tab(); }
};
const findAll = (node, ok) => (typeof node !== "object" || node === null ? []
  : [...(ok(node) ? [node] : []), ...(node.kids ?? []).flatMap((k) => findAll(k, ok))]);
const textOf = (node) => node?.text ?? (node?.kids ?? []).map(textOf).join("");
const page = (tabName) => drawn(() => { t.ui.tab = tabName; return t.walletView(null, null); });
const zecCard = () =>
  findAll(page("overview"), (n) => n.attrs?.["aria-labelledby"] === "asset-zec")[0];
const balanceText = () =>
  textOf(findAll(zecCard(), (n) => n.className === "asset-balance-block")[0]);
const rows = () => findAll(page("activity"), (n) => n.tag === "a" && n.className === "row-item")
  .map((n) => ({ text: textOf(n), href: n.attrs.href }));
const WAITING = /Receiving · not in a block yet/;

// ── The engine: a wallet object that lists what the test says ──
class FakeWallet {
  constructor() { Object.assign(this, { calls: 0, reply: [], hold: null, fail: null }); }
  mempool() {
    this.calls++;
    if (this.fail) return Promise.reject(new Error(this.fail));
    return this.hold ?? Promise.resolve(JSON.stringify(this.reply));
  }
  async sync() { return JSON.stringify({ height: 100, tip: 100, spendable: 5e7, pending: 0 }); }
  received() { return "[]"; }
  sent() { return "[]"; }
  memoNeeds() { return "[]"; }
  snapshot() { return "{}"; }
  free() { this.freed = true; }
}
const note = (txid, value, index = 0) => ({ txid, value, index });
const T1 = "a1".repeat(32), T2 = "b2".repeat(32);

const gid = await rig.wallet({ name: "Mempool" });
const server = NETWORKS.testnet.servers[0];
const openChain = (cw, extra = {}) => {
  const c = { gid, cw, url: server, net: NETWORKS.testnet, birthday: 1, ms: 0, error: null,
    bal: { height: 100, tip: 100, spendable: 5e7, pending: 2e6 }, received: [],
    sent: new Set(), syncing: false, ...extra };
  t.setChain(c);
  return c;
};
const realNow = Date.now;
const later = (ms) => { const at = realNow(); Date.now = () => realNow() - at + at + ms; };
const realTimeout = globalThis.setTimeout;
const real = (ms) => new Promise((resolve) => realTimeout(resolve, ms));
// Timers of a second or more run 100 times faster.
const fast = () => {
  globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...a);
};
const slow = () => { globalThis.setTimeout = realTimeout; Date.now = realNow; };
// render() asks for one frame for all changes of the next 120 ms: count those frames. A step waits
// for the draw of the step before it, so a second render of a step does not hide in that window.
let frames = 0;
globalThis.requestAnimationFrame = () => { frames += 1; return 0; };
const redraws = async (act) => { await real(200); frames = 0; await act(); return frames; };

// ── A listed note shows as a line in the balance and as a row, and changes no number ──
const cw = new FakeWallet();
const c = openChain(cw);
const before = { balance: balanceText(), now: JSON.stringify(balanceNow(c.bal)),
  bal: structuredClone(c.bal), total: openTotal() };
assert.match(before.balance, /Available0\.50ZEC.*Incoming 0\.02ZEC/, "the balance of the fixture");
assert.doesNotMatch(before.balance, /Not in a block/);
cw.reply = [note(T1, 1000000), note(T2, 250000, 3)];
await runMempool(c);
assert.deepEqual(mempoolNow(c), [{ txid: T1, value: 1000000 }, { txid: T2, value: 250000 }]);
assert.match(balanceText(), /Incoming 0\.02ZEC.*Not in a block yet: 0\.0125ZEC$/,
  "the line sits under Incoming, with the sum");
assert.equal(balanceText().replace(/Not in a block yet: [\d.]+ZEC/, ""), before.balance,
  "the rest of the balance text is as it was");
const waiting = rows().filter((r) => WAITING.test(r.text));
assert.equal(waiting.length, 2, "one row for each transaction");
assert.match(waiting[0].text, /^Receiving · not in a block yetZcash Testnet.*\+0\.01ZEC$/,
  "the row says what is true: no block, no confirmation count");
assert.deepEqual(waiting.map((r) => r.href), [NETWORKS.testnet.explorer + T1,
  NETWORKS.testnet.explorer + T2], "each row opens the explorer");
assert.deepEqual([JSON.stringify(balanceNow(c.bal)), c.bal, openTotal()],
  [before.now, before.bal, before.total], "Available, Incoming, the total: unchanged");
assert.equal(c.error, null);
console.log("ok  a listed note shows as a line in the balance and as a row, and changes no number");

// ── One transaction is one row; a note of no value shows nothing ──
cw.reply = [note(T1, 600000), note(T1, 400000, 5), note(T2, 0)];
await runMempool(c);
assert.deepEqual(mempoolNow(c), [{ txid: T1, value: 1000000 }], "the notes of one id add up");
assert.equal(rows().filter((r) => WAITING.test(r.text)).length, 1);
cw.reply = [note(T2, 0)];
await runMempool(c);
assert.deepEqual([mempoolNow(c), balanceText()], [[], before.balance], "a message part: nothing");
console.log("ok  the notes of one transaction make one row; a note of no value makes none");

// ── The row goes away when a block holds the payment, and when it leaves the mempool ──
cw.reply = [note(T1, 1000000)];
await runMempool(c);
assert.equal(rows().filter((r) => WAITING.test(r.text)).length, 1);
// The sync reads the block. The engine may still list the transaction for a moment.
c.received = [{ txid: T1, height: 101, value: 1000000, confirmed: false, memos: [],
  memo_pending: false, indexes: [0] }];
assert.deepEqual(mempoolNow(c), [], "the list drops a transaction that a block holds");
assert.doesNotMatch(balanceText(), /Not in a block/, "the line goes away at once");
const mined = rows();
assert.equal(mined.filter((r) => WAITING.test(r.text)).length, 0, "the waiting row goes away");
assert.equal(mined.filter((r) => /Received ZEC/.test(r.text)).length, 1, "the normal row shows");
c.received = [];
cw.reply = [];
await runMempool(c);
assert.deepEqual([mempoolNow(c), rows().filter((r) => WAITING.test(r.text))], [[], []],
  "a payment that left the mempool goes away");
cw.reply = [note(T1, 1000000)];
await runMempool(c);
cw.reply = [];
await runMempool(c);
assert.equal(balanceText(), before.balance, "an empty answer clears the line");
console.log("ok  the row goes away when a block holds the payment or the mempool drops it");

// ── The page redraws when the list changes, and only then ──
{
  const answer = (reply) => redraws(async () => { cw.reply = reply; await runMempool(c); });
  c.mempool = null;
  assert.equal(await answer([note(T1, 1000000)]), 1, "a good answer that changes the list");
  assert.equal(await answer([note(T1, 1000000)]), 0, "the same list: no redraw");
  assert.equal(await answer([note(T1, 1000000), note(T2, 5)]), 1, "a longer list");
  assert.equal(await answer([]), 1, "an empty answer that clears the list");
  assert.equal(await answer([]), 0, "an empty list again: no redraw");
  assert.equal(await answer([note(T2, 0)]), 0, "a note of no value shows nothing: no redraw");
  console.log("ok  the page redraws when a good answer changes the list, and only then");
}

// ── No call for a hidden tab or a closed wallet; the 30 s call asks the open wallets ──
cw.calls = 0;
visibility = "hidden";
await runMempool(c);
tick();
assert.equal(cw.calls, 0, "a hidden tab asks nothing");
visibility = "visible";
tick();
await sleep(10);
assert.equal(cw.calls, 1, "the call every 30 s asks the open wallet");
const gone = c;
t.setChain(null);
await runMempool(gone);
tick();
await sleep(10);
assert.equal(cw.calls, 1, "a closed wallet is not asked");
t.setChain(c);
const account = new FakeWallet();
const acct = { account: true, gid: "personal", cw: account, url: server, net: NETWORKS.testnet,
  bal: { height: 100, tip: 100, spendable: 1e6, pending: 0 }, received: [], sent: new Set(),
  syncing: false, error: null };
t.setAcct(acct);
tick();
await sleep(10);
assert.deepEqual([cw.calls, account.calls], [2, 1], "the personal account is asked too");
// A wallet that syncs, or has no working server yet, is not asked.
const whole = { syncing: false, url: server, bal: c.bal, cw };
for (const stop of [{ syncing: true }, { url: null }, { bal: null }, { cw: null }]) {
  const calls = cw.calls;
  Object.assign(c, stop);
  await runMempool(c);
  Object.assign(c, whole);
  assert.equal(cw.calls, calls, JSON.stringify(Object.keys(stop)));
}
t.setAcct(null);
console.log("ok  no call for a hidden tab or a closed wallet; the 30 s call asks the open ones");

// ── One call at a time; an answer of an object that was replaced is dropped ──
{
  cw.calls = 0;
  let answer;
  cw.hold = new Promise((resolve) => { answer = resolve; });
  const first = runMempool(c);
  const second = runMempool(c);
  tick();
  assert.equal(cw.calls, 1, "a second call waits for the first");
  answer(JSON.stringify([note(T1, 1000000)]));
  await Promise.all([first, second]);
  assert.equal(mempoolNow(c).length, 1);
  cw.hold = null;
  await runMempool(c);
  assert.equal(cw.calls, 2, "the next call runs when the first ended");
  // The server changed during the call: the new object has the chain, the old answer is dropped.
  cw.hold = new Promise((resolve) => { answer = resolve; });
  cw.reply = [];
  c.mempool = null;
  const old = runMempool(c);
  c.cw = new FakeWallet();
  answer(JSON.stringify([note(T2, 5)]));
  await old;
  assert.deepEqual(mempoolNow(c), [], "the answer of the old object shows nothing");
  Object.assign(c, { cw });
  cw.hold = null;
  console.log("ok  one call at a time, and the answer of a replaced object is dropped");
}

// ── A failure is silent and keeps the last good list for 2 minutes ──
{
  cw.reply = [note(T1, 1000000)];
  fast();
  await runMempool(c);
  const lines = () => t.state.log.filter((line) => /mempool/.test(line)).length;
  const banner = t.banner;
  cw.fail = "lightwalletd: mempool server down";
  for (let i = 0; i < 3; i++) await runMempool(c);
  assert.equal(c.error, null, "no error on the chain");
  assert.equal(t.banner, banner, "no banner");
  assert.doesNotMatch(textOf(page("overview")), /server down|could not read the mempool/);
  assert.equal(lines(), 1, "the log keeps one line for a run of failures");
  assert.equal(mempoolNow(c).length, 1, "the last good list stays");
  assert.match(balanceText(), /Not in a block yet: 0\.01ZEC/);
  await real(1300);   // 2 minutes, scaled
  assert.deepEqual(mempoolNow(c), [], "after 2 minutes the list is dropped");
  assert.doesNotMatch(balanceText(), /Not in a block/);
  assert.equal(rows().filter((r) => WAITING.test(r.text)).length, 0);
  slow();
  // The age counts too, when no timer ran (a tab that was away).
  cw.fail = null;
  await runMempool(c);
  assert.equal(mempoolNow(c).length, 1);
  later(119000);
  assert.equal(mempoolNow(c).length, 1, "119 s: shown");
  later(121000);
  assert.equal(mempoolNow(c).length, 0, "121 s: dropped");
  slow();
  c.mempool = null;
  // An answer that is not JSON is a failure too.
  cw.fail = null;
  cw.hold = Promise.resolve("not json");
  await runMempool(c);
  assert.deepEqual([mempoolNow(c), c.error], [[], null]);
  cw.hold = null;
  console.log("ok  a failed call shows no error and the last good list stays for 2 minutes");
}

// ── The 2-minute timer redraws on time, and an older timer drops no newer list ──
{
  fast();
  cw.reply = [note(T1, 1000000)];
  await runMempool(c);
  later(121000);   // the clock moves with the timer, as it does in a browser
  assert.deepEqual(mempoolNow(c), [], "121 s: the age check hides the list");
  assert.equal(await redraws(() => real(1300)), 1, "the timer that fires on time redraws");
  assert.equal(c.mempool, null);
  slow();
  fast();
  cw.reply = [note(T1, 1000000)];
  await runMempool(c);                // answer A: its timer would fire at 1.2 s
  await real(600);
  cw.reply = [note(T2, 250000)];
  await runMempool(c);                // answer B: its timer fires at 1.8 s
  await real(800);                    // 1.4 s after A
  assert.deepEqual(mempoolNow(c), [{ txid: T2, value: 250000 }], "the timer of A dropped nothing");
  await real(600);                    // 2.0 s after A
  assert.deepEqual(mempoolNow(c), [], "the timer of B drops its list");
  slow();
  console.log("ok  the 2-minute timer redraws on time, and an older timer drops no newer list");
}

// ── A call that never ends times out like any failure, and the next call runs ──
{
  fast();
  cw.calls = 0;
  cw.hold = new Promise(() => {});
  c.mempool = null;
  c.mempoolFailed = false;
  const hung = await Promise.race([runMempool(c).then(() => false), real(1500).then(() => true)]);
  assert.equal(hung, false, "the call ends after 20 s (scaled)");
  assert.deepEqual([c.error, c.mempoolBusy, mempoolNow(c)], [null, null, []], "a silent failure");
  release(cw);   // the engine call goes on, so the object stays until it ends (ZEC-16)
  assert.notEqual(cw.freed, true, "a timeout does not free an object that the engine holds");
  const line = /could not read the mempool: localhost did not answer in 20 s/;
  assert.equal(t.state.log.filter((text) => line.test(text)).length, 1, "one log line");
  cw.hold = null;
  cw.reply = [note(T1, 5)];
  await runMempool(c);
  assert.deepEqual([cw.calls, mempoolNow(c).length], [2, 1], "the next call asks again");
  slow();
  c.mempool = null;
  console.log("ok  a call that never ends times out like a failure and the next call runs");
}

// ── The explorer note shows below a list that has only a waiting row ──
{
  const explorerNote = () => textOf(page("activity")).match(/opens [\w.]+ in a new tab/)?.[0];
  c.mempool = null;
  assert.equal(explorerNote(), undefined, "no row, no note");
  cw.reply = [note(T1, 1000000)];
  await runMempool(c);
  const list = rows();
  assert.deepEqual(list.map((r) => WAITING.test(r.text)), [true], "the only row is a waiting row");
  const host = new URL(NETWORKS.testnet.explorer).host;
  assert.equal(explorerNote(), "opens " + host + " in a new tab");
  c.mempool = null;
  console.log("ok  the explorer note shows below a list with only a waiting row");
}

// ── An empty wallet does not say "no coins" while its first payment waits for a block ──
{
  const none = { height: 100, tip: 100, spendable: 0, pending: 0 };
  const empty = openChain(new FakeWallet(), { bal: { ...none } });
  const fundCard = () => findAll(page("overview"),
    (n) => n.attrs?.["aria-labelledby"] === "fund-title")[0];
  const WAY = /A payment to this wallet is on its way: no block holds it yet\. Copy its address/;
  assert.match(textOf(fundCard()), /^Fund this wallet.*This wallet has no coins\. Copy its/);
  empty.cw.reply = [note(T1, 1000000)];
  await runMempool(empty);
  assert.match(textOf(fundCard()), WAY, "the Fund card says that the payment is on its way");
  assert.doesNotMatch(textOf(fundCard()), /no coins/);
  assert.match(balanceText(), /Not in a block yet: 0\.01ZEC/);
  assert.deepEqual(empty.bal, none, "no balance");
  empty.cw.reply = [];
  await runMempool(empty);
  assert.match(textOf(fundCard()), /This wallet has no coins\./, "an empty answer: the old text");
  t.setChain(c);
  console.log("ok  the Fund card says that a waiting payment is on its way");
}

// ── The cap and the address hiding of a mainnet wallet do not change ──
{
  const main = await rig.wallet({ name: "Main", network: "mainnet" });
  const mainCw = new FakeWallet();
  const mc = { gid: main, cw: mainCw, url: NETWORKS.mainnet.servers[0], net: NETWORKS.mainnet,
    birthday: 1, ms: 0, error: null, received: [], sent: new Set(), syncing: false };
  const states = () => [atCap(), capUnknown(), addrHidden(), openTotal(),
    textOf(drawn(() => receiveDialog())).includes(t.state.wallet.address.slice(0, 12))];
  for (const [spendable, atTheCap] of [[4e7, false], [5e7, true]]) {
    mc.bal = { height: 100, tip: 100, spendable, pending: 0 };
    t.setChain(mc);
    mc.mempool = null;
    const none = states();
    assert.equal(none[0], atTheCap, "the fixture");
    mainCw.reply = [note(T1, 4e7)];   // 0.4 ZEC more would pass the cap if it counted
    await runMempool(mc);
    assert.equal(mempoolNow(mc).length, 1);
    assert.deepEqual(states(), none, "cap, hidden address and total do not change");
  }
  // An empty mainnet wallet has no faucet: its empty note changes the same way.
  mc.bal = { height: 100, tip: 100, spendable: 0, pending: 0 };
  mc.mempool = null;
  t.setChain(mc);
  const details = () => textOf(findAll(page("overview"),
    (n) => n.attrs?.id === "zec-asset-details")[0]);
  assert.match(details(), /This wallet is empty\. Share its address to receive ZEC\. Keep/);
  mainCw.reply = [note(T1, 4e6)];
  await runMempool(mc);
  assert.match(details(), /A payment to this wallet is on its way: no block holds it yet\. Share/);
  assert.doesNotMatch(details(), /is empty/);
  console.log("ok  the empty note of a mainnet wallet says that a waiting payment is on its way");
  console.log("ok  the 0.5 ZEC cap and the hidden address do not change");
}

// ── The personal account shows the line in its balance ──
{
  const keys = JSON.parse(Z.accountNew("testnet"));
  t.personal = { ...keys, network: "testnet", backedUp: true, contacts: [], sent: [] };
  const live = { ...acct, ufvk: keys.ufvk, address: keys.address, addrs: new Map(), progress: "",
    live: "", bal: { height: 100, tip: 100, spendable: 2e6, pending: 1e6 }, cw: new FakeWallet() };
  t.setAcct(live);
  const text = () => textOf(drawn(() => view.accountCard()));
  const was = text();
  assert.match(was, /Available0\.02ZEC.*Incoming0\.01ZEC/);
  assert.doesNotMatch(was, /Not in a block/);
  live.cw.reply = [note(T1, 300000)];
  await runMempool(live);
  assert.match(text(), /Incoming0\.01ZEC.*Not in a block yet: 0\.003ZEC/);
  assert.equal(text().replace(/Not in a block yet: [\d.]+ZEC/, ""), was, "the rest is as it was");
  t.setAcct(null);
  console.log("ok  the personal account shows the line and counts nothing");
}

// ── A finished sync asks at once, in a visible tab, and a failed sync does not ──
{
  const synced = new FakeWallet();
  const net = NETWORKS.testnet;
  t.setZ({ ...rig.Z, latestHeight: async () => 1000, isDeepReorg: () => false,
    ChainWallet: FakeWallet });
  const fresh = (cwx) => ({ gid: "syncaaaaaaaaaaaaaaaa", net, cw: cwx, url: net.servers[0],
    account: true, syncing: false, bal: null, sent: new Set(), prog: null, error: null,
    received: [] });
  const s = fresh(synced);
  t.setChain(s);
  await runSync(s);
  await sleep(10);
  assert.deepEqual([s.error, synced.calls], [null, 1], "the sync ended, and the call follows");
  visibility = "hidden";
  await runSync(s);
  await sleep(10);
  assert.equal(synced.calls, 1, "a hidden tab asks nothing after a sync either");
  visibility = "visible";
  synced.sync = async () => { throw new Error("the sync broke"); };
  await runSync(s);
  await sleep(10);
  assert.equal(synced.calls, 1, "a failed sync asks nothing");
  assert.match(s.error, /the sync broke/);
  t.setChain(null);
  console.log("ok  a finished sync asks the engine once; a hidden tab or a failed sync does not");
}
// ── The transparent address of the group on Receive (PRIVACY.md) ──
// Each seat publishes its ZIP 48 key as the signed document p2sh/<seat>. The address shows only
// when all n keys check, and a seat writes its key at most once each time the wallet opens.
{
  const engine = await import("../app-engine.js");
  const { groupTaddress, readTaddressBalance, taddressSection } =
    await import("../app-taddress.js");
  const keyDocs = (id) => [1, 2, 3].map((seat) => rig.data.get(`groups/${id}/p2sh/${seat}`));
  const shown = () => textOf(drawn(() => taddressSection()));
  const tg = await rig.wallet({ name: "Transparent" });
  await rig.waitFor("the group address", () => groupTaddress().address);
  const { address } = groupTaddress();
  assert.match(address, /^t2/, "a testnet P2SH address");
  const docs = keyDocs(tg);
  assert.ok(docs.every((d) => d?.v === 1 && typeof d.key === "string" && d.sig), "signed keys");
  const kp = JSON.stringify(t.sec(tg, 3).keyPackage);
  const keys = docs.map((d) => d.key).reverse();
  assert.equal(JSON.parse(Z.p2shAddress(2, keys, kp, "testnet")).address, address,
    "seat 3 makes the same address from the keys in another order");
  console.log("ok  three seats publish signed keys and make one 2-of-3 address");

  // The real store calls a watch again only for a write under its path, and the keys arrive
  // before the seats load. So the reactor publishes them, not the first snapshot.
  for (const seat of [1, 2, 3]) rig.data.delete(`groups/${tg}/p2sh/${seat}`);
  t.openGroup(null);
  t.openGroup(tg);
  await rig.waitFor("the keys after a reopen", () => keyDocs(tg).every(Boolean));
  await rig.waitFor("the address after a reopen", () => groupTaddress().address === address);
  console.log("ok  the reactor publishes the keys after the seats load");

  // Seat 3 signs another key later: the address does not move to it.
  const { signedDoc } = await import("../app-filter.js");
  const first = rig.data.get(`groups/${tg}/p2sh/3`);
  const other = await signedDoc(tg, "p2sh/3", 3, { v: 1, key: docs[0].key });
  await rig.db.doc(`groups/${tg}/p2sh/3`).set(other);
  await rig.waitFor("the changed key", () => (groupTaddress().error ?? "").startsWith(
    "Device 3 published another"));
  rig.data.set(`groups/${tg}/p2sh/3`, first);
  rig.notify();
  await rig.waitFor("the first key again", () => groupTaddress().address === address);
  console.log("ok  a seat that signs another key later hides the address");

  // An engine that fails a balance read at once, then a stub that answers with two payments.
  const before = engine.Z;
  const offline = { ...before, transparentUtxos: async () => { throw new Error("offline"); } };
  t.setZ(offline);
  await readTaddressBalance(address);
  assert.match(shown(), /The balance could not be read\./);
  const utxo = (value) => ({ txid: "ab".repeat(32), index: 0, value, height: 5 });
  t.setZ({ ...offline, transparentUtxos: async (_url, a) =>
    JSON.stringify({ total: 15e7, utxos: a === address ? [utxo(1e8), utxo(5e7)] : [] }) });
  await readTaddressBalance(address);
  assert.match(shown(), /Balance: 1\.5 ZEC in 2 payments/);
  assert.match(shown(), /The chain shows its balance and every payment to it to everyone/);
  t.setZ(offline);
  console.log("ok  a failed balance read says so, and a good one shows 1.5 ZEC in 2 payments");

  // A server that swaps the key of seat 3 for the key of seat 1 blocks the address.
  let writes = 0;
  rig.hook.before = (path, v) => {
    if (!path.endsWith("/p2sh/3")) return v;
    writes += 1;
    return { ...v, key: docs[0].key };
  };
  const swapped = await rig.wallet({ name: "Swapped key" });
  await rig.waitFor("three key documents", () => keyDocs(swapped).every(Boolean));
  await real(300);
  await rig.waitFor("the checks of the keys", () => groupTaddress().published === 2);
  assert.deepEqual(groupTaddress(), { published: 2, of: 3 }, "the swapped key does not check");
  assert.equal(writes, 1, "seat 3 wrote its key once, not again on each snapshot");
  assert.match(shown(), /2 of 3 devices published their key/);
  rig.hook.before = (_path, v) => v;
  t.setZ(before);
  console.log("ok  a swapped key blocks the address, and the seat does not write it again");
}
// ── The move from the transparent address to the shielded address (app-sweep.js) ──
// The rig has no light-wallet server, so the chain wallet and the engine calls of the move are
// stubs. The real engine takes the arguments of each call, and cargo tests the move itself.
{
  const engine = await import("../app-engine.js");
  const { groupTaddress, readTaddressBalance, taddressSection } =
    await import("../app-taddress.js");
  const sweep = await import("../app-sweep.js");
  const { checkIn, signedDoc } = await import("../app-filter.js");
  const { docFields } = await import("../signed.js");
  const sg = await rig.wallet({ name: "Sweep" });
  await rig.waitFor("the group address of the move", () => groupTaddress().address);
  const { address, keys } = groupTaddress();
  const fvk = t.state.wallet.orchard_fvk;
  const kp = JSON.stringify(t.sec(sg, 1).keyPackage);
  const group = JSON.stringify({ t: 2, keys, key_package: kp });
  for (const call of [() => Z.sweepCheck("AAAA", group, fvk, "testnet"),
    () => Z.sweepSign("AAAA", group, fvk, "testnet", 100),
    () => Z.sweepFinish("AAAA", "[]", 2)]) {
    assert.throws(call, /pczt parse/, "the engine reads the arguments and refuses the PCZT");
  }
  console.log("ok  the engine takes the arguments of the move and refuses a bad PCZT");

  const before = engine.Z, calls = [], PCZT = "bW92ZQ==", PCZT2 = "bW92ZTI=";
  const ck = { inputs: 2, total: 15e7, value: 14997e4, fee: 30000, txid: "c3".repeat(32),
    digest: "dg1", expiry_height: 5000 };
  const checks = { [PCZT]: ck, [PCZT2]: { ...ck, txid: "e5".repeat(32), digest: "dg2" } };
  const utxo = (value, index) => ({ txid: "ab".repeat(32), index, value, height: 5 });
  let listed = [utxo(1e8, 0), utxo(5e7, 1)];
  const shown = () => textOf(drawn(() => taddressSection()));
  const buttons = () => findAll(drawn(() => taddressSection()), (n) => n.tag === "button")
    .map(textOf).filter((b) => !b.startsWith("Copy"));
  const ofGroup = (g) => [JSON.parse(g).t, JSON.parse(g).keys.length];
  t.setZ({ ...before, latestHeight: async () => 100,
    transparentUtxos: async () => JSON.stringify({ total: 15e7, utxos: listed, more: false }),
    sweepCheck: (p, g, f) => {
      if (!checks[p] || f !== fvk || ofGroup(g).join() !== "2,3") throw new Error("not ours");
      return JSON.stringify(checks[p]);
    },
    sweepSign: (p, g, _f, _net, tip) => {
      calls.push(["sign", tip]);
      return JSON.stringify({ digest: checks[p].digest, key: "key-" + calls.length,
        signatures: ["30"] });
    },
    sweepFinish: (p, sets, tt) => {
      calls.push(["finish", p, JSON.parse(sets).map((s) => s.key), tt, buttons()]);
      return JSON.stringify({ tx_hex: "beef", txid: ck.txid });
    },
    ChainWallet: class {
      async broadcast(hex) { calls.push(["broadcast", hex]); return JSON.stringify({}); }
      free() {}
    } });
  const cw = new FakeWallet();
  cw.createSweep = async (utxos, g) => {
    calls.push(["create", JSON.parse(utxos).length, ...ofGroup(g)]);
    return JSON.stringify({ pczt: PCZT, value: ck.value, fee: ck.fee, inputs: 2 });
  };
  const c = { gid: sg, cw, url: server, net: NETWORKS.testnet, birthday: 1, ms: 0, error: null,
    bal: { height: 100, tip: 100, spendable: 0, pending: 0 }, received: [], sent: new Set(),
    syncing: false };
  t.setChain(c);
  const reread = () => readTaddressBalance(address);
  await reread();
  assert.deepEqual(buttons(), ["Move to the shielded address"]);
  assert.match(shown(), /moves the funds to the shielded address of this wallet when 2 devices/);
  listed = [];
  await assert.rejects(sweep.proposeSweep(keys, reread), /holds no payment now/,
    "the proposal reads the payments again");
  listed = [utxo(1e8, 0), utxo(5e7, 1)];
  // An approval of another move does not count.
  const old = await signedDoc(sg, "sweep/2", 2, { v: 1, digest: "old", key: "old",
    signatures: ["30"] });
  await rig.db.doc(`groups/${sg}/sweep/2`).set(old);
  await sweep.proposeSweep(keys, reread);
  assert.deepEqual(calls.splice(0), [["create", 2, 2, 3]], "two payments, 2 of 3 keys");
  assert.equal(rig.data.get(`groups/${sg}/sweep/proposal`).pczt, PCZT);
  await rig.waitFor("the proposed move", () => /0 of 2 devices approved it/.test(shown()));
  const verdict = () => checkIn(sg)("sweep/2", old.by, old.sig, docFields(old), 2);
  await rig.waitFor("the check of the old approval", () => verdict() === "yes");
  assert.match(shown(), /0 of 2 devices approved it/);
  assert.ok(shown().includes("A move of 1.4997 ZEC to the shielded address of this wallet spends 2 "
    + "payments of the transparent address. The network fee is 0.0003 ZEC."), shown());
  assert.deepEqual(buttons(), [1, 2, 3].map((i) => "Approve as device " + i));
  console.log("ok  a device proposes the move, and each device shows the amounts of its check");

  await sweep.approveSweep(1, keys, "dg1");
  const key1 = rig.data.get(`groups/${sg}/sweep/1`).key;
  // Seat 2 copies the key of seat 1: one key counts once.
  const copy = await signedDoc(sg, "sweep/2", 2, { v: 1, digest: "dg1", key: key1,
    signatures: ["30"] });
  await rig.db.doc(`groups/${sg}/sweep/2`).set(copy);
  await rig.waitFor("the copied key", () => !buttons().includes("Approve as device 2"));
  assert.match(shown(), /1 of 2 devices approved it/);
  assert.deepEqual(buttons(), ["Approve as device 3"]);
  await assert.rejects(sweep.sendSweep(keys, "dg1"), /needs 2 approvals/);
  await assert.rejects(sweep.approveSweep(3, keys, "dg2"), /changed or expired/,
    "a button acts only on the move that it shows");
  await sweep.approveSweep(3, keys, "dg1");
  assert.deepEqual(calls.splice(0), [["sign", 100], ["sign", 100]], "signed at the fresh tip");
  await rig.waitFor("two approvals", () => /2 of 2 devices approved it/.test(shown()));
  assert.deepEqual(buttons(), ["Send the move"]);
  await assert.rejects(sweep.sendSweep(keys, "dg2"), /changed or expired/);
  const key3 = rig.data.get(`groups/${sg}/sweep/3`).key;
  await sweep.sendSweep(keys, "dg1");
  assert.deepEqual(calls.splice(0), [["finish", PCZT, [key1, key1, key3], 2, []],
    ["broadcast", "beef"]], "every approval goes to the finish, and Send hides during the proof");
  assert.equal(rig.data.get(`groups/${sg}/sweep/sent`).txid, ck.txid);
  await rig.waitFor("the sent move", () => /It was sent to the network/.test(shown()));
  assert.deepEqual(buttons(), [], "no new move for the payments that the sent move spends");
  console.log("ok  two keys send the move once, and a copied key counts once");

  const bad = await signedDoc(sg, "sweep/proposal", 2, { v: 1, pczt: "b3RoZXI=" });
  await rig.db.doc(`groups/${sg}/sweep/proposal`).set(bad);
  await rig.waitFor("the refused move", () => /does not check/.test(shown()));
  assert.match(shown(), /not ours/);
  assert.deepEqual(buttons(), ["Move to the shielded address"]);
  await assert.rejects(sweep.approveSweep(1, keys, "dg1"), /changed or expired/);
  const again = await signedDoc(sg, "sweep/proposal", 1, { v: 1, pczt: PCZT });
  await rig.db.doc(`groups/${sg}/sweep/proposal`).set(again);
  c.bal.tip = 5000;
  await rig.waitFor("the sent move that expired", () => /It was sent/.test(shown()));
  assert.deepEqual(buttons(), ["Move to the shielded address"], "a block did not hold the move");
  const other = await signedDoc(sg, "sweep/proposal", 1, { v: 1, pczt: PCZT2 });
  await rig.db.doc(`groups/${sg}/sweep/proposal`).set(other);
  await rig.waitFor("the expired move", () => /The proposed move expired/.test(shown()));
  await assert.rejects(sweep.sendSweep(keys, "dg2"), /changed or expired/);
  assert.deepEqual(buttons(), ["Move to the shielded address"]);
  t.setChain(null);
  t.setZ(before);
  console.log("ok  a move that does not check or that expired gets no approval");
}
console.log("mempool: ok");
process.exit(0);
