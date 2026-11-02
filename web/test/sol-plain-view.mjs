// The Solana tab and the Overview rows of a served plain wallet (web/sol/plain/view.js,
// app-sol.js, app-wallet.js, overview-model.js) against the real page modules and the real wasm
// (sol-rig.mjs). Worker and the policy answer are fakes: the balances come from a table. It shows:
// a mainnet wallet that the server does not serve, and a testnet wallet, look as before; a served
// wallet gets the Solana section, the start card (device 1 only), the setup states, the address of
// the agreed group key with Copy and the explorer link, the SOL and USDC balances, the fee and
// backup rows; the rows of Overview are real, Receive works and Send says "not available yet";
// Change devices warns that the funds stay, also in the dialog that moves the Zcash funds; a plain
// seat gets the backup dialog, its file state and the saved-file check; the probe keeps no key.
// Run: node web/test/sol-plain-view.mjs   (Node 26)
import assert from "node:assert/strict";
import { agreement } from "../sol/ceremony.js";
import { COLLECTIONS, base58, keyOfBase58 } from "../sol/docs.js";
import { publishedFee } from "../sol/fee.js";
import { PLAIN_WORKER_POLICY } from "../sol/plain/guard.js";
import { usdcAddress } from "../sol/plain/reads.js";
import { plainView, readTexts } from "../sol/plain/view.js";
import { config, loadRig, mainnetConfig, sleep } from "./sol-rig.mjs";

// The words of the tab, as people read them. A change of a word is a change of this file.
const FACTS = "Real money, public on chain. Not audited. Sending comes later.";
const START_NOTE = "Helius sees your IP and wallet address. "
  + "Funding fee addresses links each device to this wallet.";
const RECEIVE_ONLY = "Only SOL and USDC. Other tokens can be lost.";
const FEE_NOTE = "Fee addresses are needed when sending starts.";
const EXPLORER_NOTE = "Helius and the explorer see your IP.";
const EXPOSURE = "Solana mainnet shows every balance and payment of this wallet to everyone. "
  + "Helius sees your IP address and the address of this wallet.";
const FUNDS_STAY = "Funds sent to this address stay there.";
const STAYS = "SOL and USDC stay at this wallet’s Solana address. A device left out keeps "
  + "its key share.";
// The words that the body text of a card may hold: the owner found the tab too text heavy.
const BUDGET = { start: 30, ready: 26, stopped: 20, running: 20, differs: 15, early: 10,
  stoppedAndDiffer: 10, forgedFee: 70, noFee: 158, away: 13 };
// The words that Set up sending adds to the ready card, for each state of a step. The words of the
// checker and of the network are not counted: they are not copy.
const STEP_BUDGET = { reading: 3, review: 5, sending: 8, refusal: 3, poor: 18, error: 3,
  done: 5, unknown: 8, failed: 0 };

const rig = await loadRig();
const { t, data, waitFor, W } = rig;
const step = (name) => console.log("ok  " + name);
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew; // the gap of 30 s between two reads passes at once
const path = (gid, rel) => `groups/${gid}/${rel}`;

// ── The fakes: the policy answer, the Worker and the chain ──
const chain = { lamports: new Map(), accounts: new Map() };
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => ({
  "/sol/plain/worker.js": () => new Response("//",
    { headers: { "content-security-policy": PLAIN_WORKER_POLICY } }),
  "/near/quote": () => Response.json({ amountIn: "100000000", amountOut: "1232971711",
    minAmountOut: "1" }),
})[String(url)]?.() ?? rigFetch(url, init);
globalThis.Worker = class {
  postMessage({ id, cmd, args }) {
    const result = {
      init: () => ({ cluster: args.cluster }),
      balance: () => ({ lamports: chain.lamports.get(args.address) ?? "0" }),
      accounts: () => ({ accounts: args.addresses.map((a) => chain.accounts.get(a) ?? null) }),
    }[cmd]();
    queueMicrotask(() => this.onmessage({ data: { id, ok: true, result } }));
  }
  terminate() {}
};

// ── The page text, with a recorder in place of the document ──
class Rec extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, kids: [], attrs: {}, on: {}, style: {} });
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(k, v) { this.on[k] = v; }
  append(...kids) { this.kids.push(...kids); }
}
const text = (n) => n.text ?? n.kids.map(text).join("");
const texts = (n) => (n.text === undefined ? n.kids.flatMap(texts) : [n.text]);
const all = (n, test) => [...(test(n) ? [n] : []), ...(n.kids ?? []).flatMap((k) => all(k, test))];
const one = (n, test) => all(n, test)[0];
const mark = (n, name) => one(n, (x) => x.attrs?.["data-sol"] === name);
const asset = (n, id) => one(n, (x) => x.attrs?.["aria-labelledby"] === "asset-" + id);
const choice = (n, action, id) => one(n, (x) => x.tag === "button"
  && x.attrs?.["aria-describedby"] === "choose-" + action.toLowerCase() + "-" + id);
const recording = (document) => new Proxy(document, { get: (o, k) => ({
  createElement: (tag) => new Rec(tag), createElementNS: (_ns, tag) => new Rec(tag),
  createTextNode: (value) => ({ text: value }),
})[k] ?? o[k] });
function built(build) {
  const before = globalThis.document;
  globalThis.document = recording(before);
  try {
    return build();
  } finally {
    globalThis.document = before;
  }
}
const draw = (tab) => built(() => {
  t.ui.tab = tab;
  return t.walletView(null, null);
});
const click = (node) => node.on.click({ preventDefault() {}, currentTarget: {} });
// Every text and attribute value of a tree, for the checks of what it must not hold.
const everything = (n) => n.text ?? JSON.stringify(n.attrs) + n.kids.map(everything).join("");
const KEY = /api-key|helius-rpc|not-a-real-key/;
// No card of the tab promises safety, privacy or recovery: the funds are public and unaudited. The
// check reads what a person reads: the text of the card, the names of its controls and its titles.
const PROMISE = new RegExp("\\b(safe|safely|secure|securely|recover\\w*|protect\\w*|guarantee\\w*"
  + "|private|privacy|anonymous)\\b", "i");
const spoken = (n) => n.text ?? [n.attrs?.["aria-label"], n.attrs?.title,
  ...n.kids.map(spoken)].filter(Boolean).join(" | ");
const promise = (what, tree) => assert.doesNotMatch(spoken(tree), PROMISE,
  "no word of a promise in " + what);
// The words of the body text of a card: its paragraphs, callouts and notes. It skips what is not
// body text: hidden nodes, closed details, headings, labels, badges, amounts, the address, buttons,
// links, and the lines and rules of the checker. The "Device N: saved" status of a backup row is
// the label of its buttons and each local device adds one, so it is skipped too.
const NOT_BODY = /\b(label|badge|sr-only|sol-amount|addr-full|hex)\b/;
const wordsIn = (s) => s.split(/\s+/).filter(Boolean).length;
const skipped = (n) => n.attrs.hidden !== undefined || /^(button|a|h3|h4|input|dl)$/.test(n.tag)
  || (n.tag === "details" && n.attrs.open === undefined) || NOT_BODY.test(n.className ?? "")
  || /^(backup-state-|direct-rules)/.test(n.attrs["data-sol"] ?? "");
const bodyText = (n) => (n.text !== undefined ? [n.text]
  : skipped(n) ? [] : n.kids.flatMap(bodyText));
const bodyWords = (card) => wordsIn(bodyText(card).join(" "));
const card = (tree) => one(tree, (n) => n.className === "card card-pad sol-view");
// A name that a person says must start with the visible text of its control (WCAG 2.5.3).
const nameStartsWithText = (tree) => all(tree, (n) => n.attrs?.["aria-label"]
  && /^(button|a)$/.test(n.tag)).every((n) => n.attrs["aria-label"].startsWith(text(n)));
const ids = () => t.walletSections().map(([id]) => id);

// ── The states of a read: one row for each asset, and no error hides another balance ──
{
  const record = (change) => readTexts({ balances: { at: 5, sol: 1_500_000_000n, usdc: 12_345_678n,
    usdcError: "", fees: { 2: 5_000_000n }, error: "", ...change } });
  const rows = (change) => record(change).rows;
  assert.deepEqual(rows({ at: null, sol: null, usdc: null }).sol,
    { state: "reading", text: "Reading…" });
  assert.deepEqual(rows({ at: null, error: "x" }).usdc, { state: "failed", text: "Not read" });
  assert.deepEqual(rows({}).sol,
    { state: "ready", amount: "1.5", unit: "SOL", text: "1.5 SOL" });
  assert.deepEqual(rows({}).usdc,
    { state: "ready", amount: "12.345678", unit: "USDC", text: "12.345678 USDC" });
  assert.equal(rows({ sol: 0n }).sol.text, "0 SOL", "a SOL balance of zero is a balance");
  assert.deepEqual(rows({ usdc: null }).usdc, { state: "off", text: "No USDC yet" });
  const big = 2n ** 64n - 1n;
  assert.equal(rows({ sol: big }).sol.text, "18446744073.709551615 SOL", "an amount above 2^53");
  assert.equal(rows({ usdc: big }).usdc.text, "18446744073709.551615 USDC");
  assert.equal(rows({ usdc: 9007199254740993n }).usdc.text, "9007199254.740993 USDC",
    "an amount that a Number rounds");
  assert.equal(rows({ error: "late" }).sol.state, "stale", "a failed update marks the old value");
  const bad = rows({ usdc: null, usdcError: "The account is bad." });
  assert.deepEqual(bad.usdc, { state: "bad", text: "The account is bad." },
    "a bad USDC account is an error of the USDC row");
  assert.equal(bad.sol.text, "1.5 SOL", "a bad USDC account leaves the SOL row alone");
  assert.deepEqual(record({}).fees, { 2: "0.005" }, "a fee balance is a text of SOL");
}
step("each asset has its own row state, and a USDC error stays on the USDC row");

// ── A mainnet wallet that the server does not serve, and a testnet wallet, as before ──
mainnetConfig.status = 404;
await rig.wallet({ name: "Off", network: "mainnet" });
await waitFor("the answer of the probe", () => t.ui.plainServed === false);
const SECTIONS = ["overview", "approvals", "activity", "messages", "members", "recovery",
  "settings"];
assert.deepEqual(ids(), SECTIONS, "an unserved mainnet wallet has no Solana section");
{
  const tree = draw("overview");
  assert.match(text(asset(tree, "sol")), /Unavailable.*Do not send SOL to the Zcash address/);
  assert.match(text(asset(tree, "usdc")), /^USDCSolana DevnetDemo/);
  assert.equal(choice(tree, "Receive", "sol").attrs.disabled, "");
  assert.equal(one(tree, (n) => n.attrs?.["data-sol"]), undefined, "no plain element");
  assert.equal(t.solStays(), "", "and Change devices names no Solana part");
}
await rig.wallet({ name: "Test" });
assert.deepEqual(ids(), [...SECTIONS, "solana"], "a testnet wallet keeps its Solana section");
{
  const tree = draw("overview");
  assert.doesNotMatch(text(asset(tree, "sol")), /Mainnet|Public/, "the SOL row is the Devnet row");
  assert.match(text(asset(tree, "usdc")), /^USDCSolana DevnetDemo/);
  assert.equal(choice(tree, "Receive", "sol").attrs.disabled, undefined);
  assert.equal(mainnetConfig.calls, 1, "only the mainnet wallet asked the server");
}
step("an unserved mainnet wallet and a testnet wallet look as before");

// ── A served wallet that has no Solana part yet ──
Object.assign(mainnetConfig, { status: 200, calls: 0 });
delete t.ui.plainServed;
const gid = await rig.wallet({ name: "Plain", network: "mainnet" });
await waitFor("the answer of the probe", () => t.ui.plainServed === true);
assert.equal(await t.plainAnswer, undefined, "the promise of the probe keeps no body");
await waitFor("the start documents", () => t.plainNotAdded());
assert.deepEqual(ids(), [...SECTIONS, "solana"], "a served wallet gets a Solana section, last");
assert.equal(t.solStays(), "", "a wallet without a start document names no Solana part");
{
  const tree = draw("overview");
  for (const id of ["sol", "usdc"]) {
    assert.match(text(asset(tree, id)), /Not added/, id + " row of a wallet with no Solana part");
  }
  assert.equal(t.plainSol, null, "Overview loads no module");
  assert.equal(t.sol, null);
}
{
  assert.match(text(draw("solana")), /Loading Solana…/, "the tab loads the plain controller");
  await waitFor("the plain controller", () => t.plainSol?.ctl.gid === gid
    && COLLECTIONS.every((name) => t.plainSol.ctl.loaded[name]));
  const c = t.plainSol.ctl;
  const waits = (what, early) => {
    assert.match(text(early), /Loading Solana…/, "the tab waits " + what);
    assert.equal(mark(early, "add"), undefined, "and has no Add Solana button " + what);
  };
  const { loaded, raw, host } = c;
  c.loaded = {};
  const before = draw("solana");
  c.loaded = loaded;
  waits("before the documents arrived", before);
  // The page holds the reactor while the checks of signatures wait: the controller kept the
  // documents of its last pass, which had no start document. The start document is stored, and
  // its check waits.
  c.raw = { ...raw, solstart: { 1: { by: 1, sig: "x", cluster: "mainnet-plain" } } };
  c.host = { ...host, checkIn: () => () => "wait" };
  const held = draw("solana");
  Object.assign(c, { raw, host });
  waits("while a start document waits for its signature check", held);
  const tab = draw("solana");
  assert.equal(text(mark(tab, "status")), "not started");
  promise("the start card", tab);
  assert.equal(text(mark(tab, "facts")), FACTS, "the start card shows the facts");
  assert.equal(text(mark(tab, "start-note")), START_NOTE, "and the note that people accept");
  assert.ok(mark(tab, "add"), "device 1 sees the Add Solana button");
  const others = { ...c, host: { ...c.host, localSeats: () => [2, 3] } };
  const sees = built(() => plainView(others, (fn) => fn, { add() {} }));
  assert.equal(mark(sees, "add"), undefined, "the other devices have no start button");
  assert.match(text(sees), /Device 1 adds Solana\./);
  promise("the start card of another device", sees);
  assert.equal(text(mark(sees, "start-note")), START_NOTE, "and they see the note too");
  const words = bodyWords(card(tab));
  assert.ok(words <= BUDGET.start,
    `the start card stays within ${BUDGET.start} words, not ${words}`);
  assert.ok(bodyWords(sees) <= BUDGET.start, "so does the start card of the other devices");
  assert.equal(t.sol, null, "the plain tab loads no pool code");
  assert.equal(config.calls, 0);
}
step("a served wallet gets the Solana section, and only device 1 gets the start button");

// ── The button writes the start; the seats set up; the tab shows each state ──
{
  t.ui.tab = "members";
  const add = mark(draw("solana"), "add");
  t.ui.tab = "members";
  await click(add);
  assert.ok(data.get(path(gid, "solstart/1")), "the Add Solana button wrote the start document");
  await waitFor("agreement", () => agreement(t.plainSol.ctl).state === "agree"
    && [1, 2, 3].every((i) => publishedFee(t.plainSol.ctl, i)));
  const c = t.plainSol.ctl;
  const same = (change) => built(() => plainView({ ...c, ...change }, (fn) => fn, {}));
  const running = same({ docs: { ...c.docs, soldone: { 1: c.docs.soldone[1] } } });
  assert.equal(text(mark(running, "status")), "running");
  assert.match(text(mark(running, "seat-1")), /Device 1: key ready/);
  assert.match(text(running), /Keep this page open/);
  assert.equal(mark(running, "address"), undefined, "no address before the seats agree");
  const forged = { ...c.docs.soldone[2], groupKey: "00".repeat(32) };
  const differs = same({ docs: { ...c.docs, soldone: { ...c.docs.soldone, 2: forged } } });
  assert.equal(text(mark(differs, "status")), "differs");
  assert.match(text(differs), /different Solana keys.*Do not use the Solana part/);
  assert.equal(mark(differs, "address"), undefined, "no address when the keys differ");
  const stop = "Solana setup stopped: a seat left. Do not use the Solana part of this wallet.";
  const host = { ...c.host, sec: () => ({ sol: { aborted: stop } }) };
  const read = { ...c.balances, at: 1, sol: 1_500_000_000n, usdc: 12_345_678n };
  const stopped = same({ host, balances: read });
  assert.equal(text(mark(stopped, "status")), "stopped");
  assert.match(text(mark(stopped, "stopped")), /left.*create a new wallet/);
  assert.equal(mark(stopped, "stopped").attrs.role, "alert", "the stop text is an alert");
  assert.ok(mark(stopped, "new-wallet"));
  assert.ok(mark(stopped, "address"),
    "a part that stopped after the seats agreed still shows the address of the funds");
  assert.equal(text(mark(stopped, "address")), base58(agreement(c).done.groupKey));
  assert.equal(text(mark(stopped, "balance-sol")), "1.5 SOL", "and the balances that were read");
  assert.equal(text(mark(stopped, "balance-usdc")), "12.345678 USDC");
  assert.equal(text(mark(stopped, "funds-stay")), FUNDS_STAY);
  const own = bodyWords(stopped) - wordsIn(stop);
  assert.ok(own <= BUDGET.stopped,
    `the stopped card has at most ${BUDGET.stopped} own words, not ${own}`);
  assert.equal(mark(stopped, "copy-address"), undefined, "with no Copy");
  assert.equal(mark(stopped, "explorer"), undefined, "and no link");
  assert.equal(mark(stopped, "backup-1"), undefined, "and no backup");
  const early = same({ host, docs: { ...c.docs, soldone: { 1: c.docs.soldone[1] } } });
  assert.equal(text(mark(early, "status")), "stopped", "a stop before the seats agreed");
  assert.match(text(mark(early, "stopped")), /left.*create a new wallet/);
  for (const name of ["address", "funds-stay", "balance-sol"]) {
    assert.equal(mark(early, name), undefined, "has no " + name);
  }
  assert.ok(mark(early, "new-wallet"), "and keeps the button of the new wallet");
  const keysDiffer = { ...c.docs, soldone: { ...c.docs.soldone, 2: forged } };
  const stoppedAndDiffer = same({ host, docs: keysDiffer });
  assert.equal(text(mark(stoppedAndDiffer, "status")), "stopped");
  assert.equal(mark(stoppedAndDiffer, "address"), undefined, "no address when the keys differ");
  assert.equal(mark(stoppedAndDiffer, "funds-stay"), undefined);
  const lie = { ...c.docs.solfee[2], key: "11".repeat(32) };
  const forgedFee = same({ docs: { ...c.docs, solfee: { ...c.docs.solfee, 2: lie } } });
  assert.match(text(forgedFee), /fee document of device 2 does not show the key/);
  assert.equal(mark(forgedFee, "fee-address-2"), undefined, "a wrong fee key is no address");
  assert.ok(mark(forgedFee, "fee-address-1"), "the other fee addresses show");
  const alerts = (tree) => all(tree, (n) => n.attrs?.role === "alert");
  assert.equal(alerts(forgedFee).length, 1, "the wrong fee key has an alert");
  assert.equal(all(forgedFee, (n) => n.tag === "details").flatMap(alerts).length, 0,
    "and it is not inside the closed fee details");
  const liar = (i) => [i, { ...c.docs.solfee[i], key: "11".repeat(32) }];
  const noFee = same({ docs: { ...c.docs, solfee: Object.fromEntries([1, 2, 3].map(liar)) } });
  assert.equal(alerts(noFee).length, 3, "every wrong fee key has its alert");
  assert.equal(one(noFee, (n) => n.tag === "details"), undefined, "when all are wrong, no details");
  const away = same({ host: { ...c.host, netConfirmed: () => "testnet" } });
  assert.equal(text(mark(away, "status")), "unavailable");
  const states = { running, differs, stopped, early, stoppedAndDiffer, forgedFee, noFee, away };
  // The stop text of the rig is no word of the card. The stopped card has its check above.
  const stopWords = { early: wordsIn(stop), stoppedAndDiffer: wordsIn(stop) };
  for (const [name, tree] of Object.entries(states)) {
    promise("the " + name + " card", tree);
    if (name === "stopped") continue;
    const own = bodyWords(tree) - (stopWords[name] ?? 0);
    assert.ok(own <= BUDGET[name],
      `the ${name} card has at most ${BUDGET[name]} own words, not ${own}`);
  }
}
step("the tab shows the setup, the start and each stop");

// ── The address, Copy, the explorer link, the balances, the fee and backup rows ──
const c = t.plainSol.ctl;
const done = agreement(c).done;
const address = base58(done.groupKey);
const fee = (i) => base58(publishedFee(c, i));
const ata = usdcAddress(c, done.groupKey);
chain.lamports.set(address, "1500000000");
chain.lamports.set(fee(1), "5000000");
const token = Buffer.alloc(165);
token.writeBigUInt64LE(12_345_678n, 64);
token[108] = 1;
chain.accounts.set(ata, { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", lamports: "2039280",
  executable: false, data: token.toString("base64") });
// A screen shows the wallet and a read follows, when its gap has passed.
const readFrom = async (tab) => {
  const before = c.balances.at;
  skew += 31_000;
  draw(tab);
  await waitFor("the read from " + tab, () => c.balances.at !== before, 20000);
  return draw("solana");
};
{
  // Only Overview shows: the tab drew the wallet before, so the wallet is not watched now and no
  // read job runs. A read can come only from the Overview draw.
  c.watched = false;
  await waitFor("no read job", () => !t.busy.has("sol:read"));
  await readFrom("overview");
  assert.equal(c.balances.sol, 1_500_000_000n, "Overview alone starts the read");
  const tab = await readFrom("solana");
  assert.equal(text(mark(tab, "status")), "ready");
  const marks = all(tab, (n) => n.attrs?.["data-sol"]).map((n) => n.attrs["data-sol"]);
  assert.ok(marks.indexOf("facts") < marks.indexOf("balance-sol")
    && marks.indexOf("facts") < marks.indexOf("address"), "the warning comes before the address");
  assert.equal(text(mark(tab, "facts")), FACTS, "the ready card shows the facts");
  assert.ok(text(tab).includes(RECEIVE_ONLY), "the address says what it takes");
  assert.ok(one(tab, (n) => n.className === "label" && text(n) === "Solana mainnet address"),
    "and its label names the network");
  const words = bodyWords(card(tab));
  assert.ok(words <= BUDGET.ready,
    `the ready card stays within ${BUDGET.ready} words, not ${words}`);
  assert.ok(nameStartsWithText(tab), "the name of a control starts with its visible text");
  assert.equal(text(mark(tab, "address")), address, "the full address of the group key");
  assert.equal(keyOfBase58(text(mark(tab, "address"))), done.groupKey, "and it is that key");
  assert.equal(text(mark(tab, "balance-sol")), "1.5 SOL");
  assert.match(text(mark(tab, "balance-usdc")), /^12\.345678 USDC$/);
  assert.equal(text(mark(tab, "fee-balance-1")), "0.005 SOL");
  assert.equal(text(mark(tab, "fee-balance-2")), "0 SOL");
  for (const i of [1, 2, 3]) assert.equal(text(mark(tab, "fee-address-" + i)), fee(i));
  assert.ok(text(tab).includes(FEE_NOTE), "the fee addresses say when they are needed");
  assert.ok(one(tab, (n) => n.className === "privacy-badge privacy-public"),
    "the tab says Public");
  assert.ok(one(tab, (n) => n.className === "label" && text(n) === "Solana Mainnet"),
    "the lead line names the network");
  assert.ok(one(tab, (n) => text(n) === "Shared wallet · Solana Mainnet"), "and so does the name");
  assert.doesNotMatch(text(tab), /Devnet/, "a mainnet tab names no Devnet");
  assert.doesNotMatch(texts(tab).join(" | "),
    /\b(cap|capped|private|privacy|anonymous|shielded?)\b/i, "and no word of a cap or of privacy");
  assert.doesNotMatch(everything(tab), KEY, "and holds no key");
  promise("the ready card", tab);
  const link = mark(tab, "explorer");
  assert.equal(link.attrs.href, "https://explorer.solana.com/address/" + address,
    "the explorer link is the address page");
  assert.doesNotMatch(link.attrs.href, /cluster=/, "the link has no cluster parameter");
  assert.match(link.attrs.rel, /noopener/);
  assert.equal(link.attrs.target, "_blank", "and opens in a new tab, as its hidden text says");
  assert.ok(text(tab).includes(EXPLORER_NOTE), "the link says who sees what");
  assert.ok(one(tab, (n) => n.attrs?.["data-key"] === "sol-receive"), "Receive can take the focus");
  const labelled = all(tab, (n) => n.tag === "button" || n.tag === "a");
  assert.ok(labelled.every((n) => text(n).trim() !== "" || n.attrs["aria-label"]),
    "every button and link has a name");
  assert.equal(mark(tab, "copy-address").attrs["aria-label"], "Copy the Solana address");
  assert.equal(mark(tab, "address").attrs?.contenteditable, undefined);
}
{
  let copied = null;
  Object.defineProperty(globalThis, "navigator", { configurable: true,
    value: { clipboard: { writeText: async (value) => { copied = value; } } } });
  const button = { textContent: "Copy", setAttribute(k, v) { this[k] = v; } };
  const copying = draw("solana");
  const status = mark(copying, "copy-address-status");
  assert.equal(status.attrs.role, "status", "Copy has a status for screen readers");
  assert.match(status.className, /sr-only/, "and it is hidden");
  await mark(copying, "copy-address").on.click({ currentTarget: button });
  assert.equal(copied, address, "Copy copies the whole address");
  assert.equal(button.textContent, "Copied", "a copy says Copied");
  assert.equal(button["aria-label"], "Copied", "and so does its name");
  assert.equal(status.textContent, "Copied", "and the hidden status says Copied");
  await sleep(1700);
  assert.equal(button.textContent, "Copy", "and goes back to Copy");
  assert.equal(status.textContent, "", "and the status clears");
  await mark(draw("solana"), "copy-fee-2").on.click({ currentTarget: button });
  assert.equal(copied, fee(2), "the Copy of a fee address copies that fee address");
  const lone = built(() => plainView({ ...c, host: { ...c.host, localSeats: () => [2] } },
    (fn) => fn, {}));
  assert.ok(mark(lone, "fee-address-2"), "a device lists its own fee address");
  assert.equal(mark(lone, "fee-address-1"), undefined, "and no fee address of another device");
  Object.defineProperty(globalThis, "navigator", { configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error("denied"); } } } });
  const refused = draw("solana");
  await mark(refused, "copy-address").on.click({ currentTarget: button });
  assert.equal(button.textContent, "Select and copy", "a refused copy says what to do");
  assert.ok(button["aria-label"].startsWith("Select and copy"), "and its name starts with that");
  assert.equal(mark(refused, "copy-address-status").textContent,
    "Copy failed. Select the text and copy it.", "and the status says what failed");
}
{
  const was = c.gid;
  c.gid = "x".repeat(20);
  const other = draw("solana");
  c.gid = was;
  assert.match(text(other), /Loading Solana…/, "the tab shows only the wallet that it follows");
  assert.equal(mark(other, "address"), undefined);
}
step("the tab shows the address of the group key, Copy, the explorer link, the balances and fees");

// ── Set up sending: the words of each state of a step ──
{
  const idle = built(() => plainView(c, (fn) => fn, {}));
  const base = bodyWords(card(idle));
  assert.equal(base, BUDGET.ready, "control: the idle ready card holds the ready budget");
  assert.ok(mark(idle, "create-nonce") && !mark(idle, "direct-title"), "the idle card: a button");
  const line = (full) => ({ line: full, name: full.split(" ")[0], value: full.split(" ")[1] });
  const review = { kind: "accepted", lines: ["intent create-nonce", "cluster mainnet", "fee 5000",
    "rent 1056640", `payer ${fee(1)}`, `group ${address}`].map(line) };
  const rules = W.plain_rule_list().split("\n");
  const refused = { kind: "refused", rules: rules.slice(0, 2).map((rule) => {
    const [id, statement] = rule.split("\t");
    return { id, statement, detail: "the checker's detail of this rule" };
  }) };
  const checker = "chain: the read of the payer is missing";
  const network = "The network refused this in a test run: InstructionError Program log: x";
  const txId = "5".repeat(87);
  const step2 = { kind: "createNonce", seat: 1 };
  const states = {
    reading: [{ kind: "createNonce", step: "reading" }, 0],
    review: [{ ...step2, step: "review", review }, 0],
    sending: [{ ...step2, step: "sending", review }, 0],
    refusal: [{ ...step2, step: "stopped", review: refused, note: "" }, 0],
    poor: [{ ...step2, step: "stopped", review: refused,
      note: "Device 1 has too little SOL at its fee address, and mainnet has no faucet." }, 0],
    error: [{ ...step2, step: "stopped", review: { kind: "error", text: checker }, note: "" },
      wordsIn(checker)],
    done: [{ ...step2, step: "done", result: { status: "confirmed", slot: "1", txId } }, 0],
    unknown: [{ ...step2, step: "done", result: { status: "unknown", slot: "", txId } }, 0],
    failed: [{ ...step2, step: "failed", text: network }, wordsIn(network)],
  };
  for (const [name, [direct, outside]] of Object.entries(states)) {
    const tree = built(() => plainView({ ...c, direct }, (fn) => fn, {}));
    promise("the step state " + name, tree);
    const own = bodyWords(card(tree)) - base - outside;
    assert.ok(own <= STEP_BUDGET[name],
      `the ${name} state adds at most ${STEP_BUDGET[name]} words, not ${own}`);
    assert.ok(nameStartsWithText(tree), "the names of the controls start with their text: " + name);
    const controls = all(tree, (n) => n.tag === "button" || n.tag === "a");
    assert.ok(controls.every((n) => text(n).trim() !== ""), "every control has its text: " + name);
    assert.doesNotMatch(texts(tree).join(" | "), /\b(cap|capped|faucet link)\b/i, "no cap text");
  }
  const poor = built(() => plainView({ ...c, direct: states.poor[0] }, (fn) => fn, {}));
  assert.equal(all(mark(poor, "direct-stopped"), (n) => n.tag === "a").length, 0,
    "the fee sentence has no faucet link");
  const done = built(() => plainView({ ...c, direct: states.done[0] }, (fn) => fn, {}));
  assert.equal(text(mark(done, "direct-signature")), txId.slice(0, 8) + "…" + txId.slice(-6));
  assert.equal(mark(done, "direct-explorer").attrs.href, "https://explorer.solana.com/tx/" + txId);
  assert.doesNotMatch(mark(done, "direct-explorer").attrs.href, /cluster=/);
  const failed = built(() => plainView({ ...c, direct: states.failed[0] }, (fn) => fn, {}));
  assert.equal(mark(failed, "direct-failed").attrs.role, "alert", "a failure is an alert");
  assert.equal(mark(done, "direct-result").kids[0].attrs.role, "status", "a result is a status");
}
step("each state of Set up sending stays within its words and names no promise");

// ── A bad USDC account and a failed update stay on their own rows ──
{
  const record = c.balances;
  Object.assign(record, { usdc: null, usdcError: "The USDC account is not usable." });
  const tab = draw("solana");
  assert.equal(text(mark(tab, "balance-sol")), "1.5 SOL", "the SOL balance shows");
  assert.equal(text(mark(tab, "fee-balance-1")), "0.005 SOL", "so does a fee balance");
  assert.equal(text(mark(tab, "balance-usdc")), "The USDC account is not usable.");
  const rows = draw("overview");
  assert.match(text(asset(rows, "sol")), /1\.5SOL/);
  assert.doesNotMatch(text(asset(rows, "sol")), /not usable/);
  assert.match(text(asset(rows, "usdc")), /Unavailable.*not usable/);
  Object.assign(record, { usdcError: "" });
  const none = draw("solana");
  assert.equal(text(mark(none, "balance-usdc")), "No USDC yet", "no USDC account yet");
  assert.doesNotMatch(text(none), /receive USDC now/, "and no note on top of it");
  assert.match(text(asset(draw("overview"), "usdc")), /No USDC yet/);
  Object.assign(record, { usdc: 9_007_199_254_740_993n, sol: 18_446_744_073_709_551_615n });
  const exact = draw("solana");
  assert.equal(text(mark(exact, "balance-sol")), "18446744073.709551615 SOL",
    "an amount above 2^53 shows exactly");
  assert.equal(text(mark(exact, "balance-usdc")), "9007199254.740993 USDC");
  const big = draw("overview");
  assert.match(text(asset(big, "sol")), /18446744073\.709551615SOL/, "so does the Overview row");
  assert.match(text(asset(big, "usdc")), /9007199254\.740993USDC/);
  Object.assign(record, { sol: 1_500_000_000n, error: "Helius is not answering." });
  assert.equal(text(mark(draw("solana"), "read-error")), "Helius is not answering.");
  assert.match(text(asset(draw("overview"), "sol")), /1\.5SOL.*Update failed/);
  Object.assign(record, { error: "", usdc: 12_345_678n });
}
step("a bad USDC account and a failed update stay on their own rows");

// ── The Overview rows are real, Receive works, Send waits ──
{
  const tree = draw("overview");
  assert.match(text(asset(tree, "sol")), /^SOLSolana Mainnet.*Public.*1\.5SOL/, "the SOL row");
  assert.match(text(asset(tree, "usdc")), /^USDCSolana Mainnet.*Public.*12\.345678USDC/,
    "the USDC row is real");
  assert.doesNotMatch(text(asset(tree, "sol")), /Unavailable|Demo/);
  for (const id of ["sol", "usdc"]) {
    assert.ok(text(asset(tree, id)).includes(EXPOSURE), id + " row says what Solana mainnet shows");
  }
  assert.doesNotMatch(everything(tree), KEY, "and holds no key");
  for (const id of ["sol", "usdc"]) {
    const shield = all(asset(tree, id), (n) => n.tag === "button" && /shield/i.test(text(n)));
    assert.equal(shield.length, 0, id + " row has no Shield and no Unshield");
  }
  for (const id of ["sol", "usdc"]) {
    assert.equal(choice(tree, "Send", id).attrs.disabled, "", id + " Send waits");
    assert.match(text(choice(tree, "Send", id)), /Send is not available yet/);
    assert.equal(choice(tree, "Receive", id).attrs.disabled, undefined, id + " Receive works");
  }
  choice(tree, "Receive", "usdc").on.click();
  assert.deepEqual([t.ui.tab, t.wantFocus?.key], ["solana", "sol-receive"]);
  assert.match(text(tree), /SOL and USDC are not in this total\./, "the total says what it lacks");
  t.setChain({ gid, bal: { spendable: 100_000_000, pending: 0, height: 1 }, received: [],
    sent: new Set(), cw: null });
  const note = () => text(one(draw("overview"), (n) => n.attrs?.id === "usd-note"));
  await waitFor("the price", () => /spread/.test(note()));
  assert.ok(note().endsWith("a swap can give another amount. SOL and USDC are not in this total."),
    "the note with a price has one full stop between its sentences");
  t.setChain(null);
  assert.equal(t.solFile(1)?.saved, false, "solFile reads a plain seat");
  assert.ok(t.solStays().includes(STAYS), "Change devices warns");
  {
    // The reactor is held: the controller kept documents of an older pass, with no Solana part.
    const kept = c.docs;
    c.docs = Object.fromEntries(COLLECTIONS.map((name) => [name, {}]));
    try {
      assert.equal(t.plainSol.made(1), true, "made reads the stored documents");
      assert.ok(t.solStays().includes(STAYS), "also when the documents of the pass are old");
      assert.equal(text(mark(draw("solana"), "status")), "ready", "and so does the tab");
    } finally {
      c.docs = kept;
    }
  }
  const move = () => text(built(() => t.sendDialog()));
  const { g } = t.state;
  const movedTo = g.movedTo;
  g.movedTo = "M".repeat(20);
  Object.assign(t.ui, { send: true, sendMove: { gid, after: null } });
  try {
    assert.ok(move().includes(STAYS), "so does the dialog that moves the Zcash funds");
  } finally {
    Object.assign(t.ui, { send: false, sendMove: null });
    g.movedTo = movedTo;
  }
  assert.match(text(asset(tree, "usdc")), /Wallet balance.*12\.345678.*USDC/);
}
step("the rows of Overview are real, Receive works and Send says it is not available yet");

// ── The backup of a plain seat: dialog, file state, saved-file check ──
{
  assert.deepEqual(t.solUnsaved(), [1, 2, 3], "no seat saved a Solana file yet");
  const tab = draw("solana");
  assert.match(text(mark(tab, "backup-state-1")), /^Device 1: not backed up/);
  assert.equal(mark(tab, "check-1"), undefined, "no saved file to check yet");
  await click(mark(tab, "backup-1"));
  assert.match(t.ui.backup?.words.title ?? "", /Back up the Solana part of device 1/,
    "the backup dialog of a plain seat");
  assert.equal(t.sol, null, "the backup dialog loaded no pool code");
  assert.equal(config.calls, 0);
  t.ui.backup = null;
  await t.putSec(gid, 1, { sol: { ...t.sec(gid, 1).sol, backupSaved: true } });
  assert.deepEqual(t.solUnsaved(), [2, 3], "a saved file leaves the list");
  assert.deepEqual(t.solFile(1), { saved: true, restored: false });
  const saved = draw("solana");
  promise("the backup rows of a saved file", saved);
  promise("the backup rows of a seat with no file", tab);
  assert.match(text(mark(saved, "backup-state-1")), /^Device 1: saved/);
  assert.ok(nameStartsWithText(saved), "the names of the backup buttons start with their text");
  assert.equal(mark(saved, "restore").attrs["aria-label"], "Restore a backup of the Solana part");
  await click(mark(saved, "check-1"));
  assert.deepEqual([t.ui.backup?.check, t.ui.backup?.chain, t.ui.backup?.seat],
    [true, "sol", 1], "the check of the saved file opens for a plain seat");
  t.ui.backup = null;
  const part = t.sec(gid, 3).sol;
  delete t.sec(gid, 3).sol;
  assert.deepEqual(t.solFile(3), { saved: false, missing: true }, "a seat with no key share");
  assert.match(text(mark(draw("solana"), "backup-state-3")), /no key share in this browser/);
  t.sec(gid, 3).sol = part;
}
step("a plain seat gets the backup dialog and its file state");

console.log("sol-plain-view: ok");
process.exit(0);
