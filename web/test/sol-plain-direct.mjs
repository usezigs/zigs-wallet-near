// Create nonce (S1) and Enable USDC (S4) of the plain wallet (web/sol/plain/direct.js, view.js,
// control.js) against the real page modules, the real wasm and the rig (sol-rig.mjs). One device
// acts alone with its fee key. The Worker is a fake that runs checkCommand of guard.js on every
// call, refuses a send of bytes that did not pass a simulation (as the real Worker does) and
// answers from a table. It shows: the order (read, check, show the lines, confirm, sign, simulate,
// send, confirm by the signature) and that a refusal, an error, a failed test run, a double click
// and an answer "unknown" sign or send nothing more; the first free nonce index; a fresh blockhash
// for each action; the fee signature (verified with sol_fee_verify) is on the bytes that were
// simulated and sent; the secret of the fee key is in no Worker call, log, banner, document or
// tree; the focus keys; that Enable USDC follows the balance read; that a stop between the review
// and Confirm, or between the test run and the send, sends nothing; that a refused send is not
// repeated; the result words of each answer of the network; the device that pays; Escape, the
// disabled buttons and the USDC rows; and the words that go to the live region of the page.
// Run: node web/test/sol-plain-direct.mjs   (Node 26)
import assert from "node:assert/strict";
import fs from "node:fs";
import { agreement } from "../sol/ceremony.js";
import { COLLECTIONS, base58 } from "../sol/docs.js";
import { feeOf, publishedFee } from "../sol/fee.js";
import { wireBase64 } from "../sol/intent.js";
import { closeDirect } from "../sol/plain/direct.js";
import { GENESIS, PLAIN_WORKER_POLICY, checkCommand } from "../sol/plain/guard.js";
import { createNonceIntent, plainPins } from "../sol/plain/intent.js";
import { usdcAddress } from "../sol/plain/reads.js";
import { plainView } from "../sol/plain/view.js";
import * as W from "../sol/wasm/sol_wasm.js";
import { loadRig, mainnetConfig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
const { announce } = await import("../app-dom.js"); // it needs the stub page of the rig
const { t, data, waitFor } = rig;
const step = (name) => console.log("ok  " + name);
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;

// ── The chain of the fake Worker ──
const SYSTEM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const vectors = new URL("../../wasm-sol/vectors/plain/", import.meta.url);
const vectorChain = fs.readFileSync(new URL("mainnet-s1-create-nonce.chain", vectors));
const RENTS = [32, 40, 48].map((at) => String(vectorChain.readBigUInt64LE(at)));
const RENT_SPACES = [0, 80, 165];
const SOL = (n) => String(BigInt(Math.round(n * 1e9)));
const account = (lamports, owner = SYSTEM, data = "") =>
  ({ owner, lamports, executable: false, data });
const world = {
  accounts: new Map(),
  lamports: new Map(),
  sim: { err: null, logs: [] },
  confirm: { status: "confirmed", slot: "301", err: null },
  hashes: 0,
  simulated: new Set(),
  sent: [],
  failing: null, // a command that answers with an error
  afterWindow: null, // runs after the list of 100 nonce addresses was answered
};
const calls = [];
const signatureOf = (tx) => Buffer.from(tx, "base64").subarray(-64).toString("hex");
const answers = {
  init: ({ cluster }) => ({ cluster }),
  genesis: () => ({ genesis: world.genesis ?? GENESIS.mainnet }),
  rent: ({ space }) => ({ lamports: RENTS[RENT_SPACES.indexOf(space)] }),
  blockhash: () => ({
    blockhash: base58((++world.hashes & 255).toString(16).padStart(2, "0").repeat(32)),
    lastValidBlockHeight: "1",
  }),
  balance: ({ address }) => ({ lamports: world.lamports.get(address) ?? "0" }),
  accounts: ({ addresses }) => {
    const found = addresses.map((a) => world.accounts.get(a) ?? null);
    if (addresses.length === 100) world.afterWindow?.(addresses);
    return { accounts: found };
  },
  simulate: ({ tx }) => {
    if (world.sim.err === null) world.simulated.add(tx);
    return { err: world.sim.err, unitsConsumed: null, loadedAccountsDataSize: null,
      logs: world.sim.logs };
  },
  send: ({ tx }) => {
    if (!world.simulated.has(tx)) throw new Error("send: these bytes did not pass a simulation");
    world.sent.push(tx);
    return { signature: base58(signatureOf(tx)) };
  },
  confirm: ({ signature }) => {
    if (!world.sent.some((tx) => base58(signatureOf(tx)) === signature)) {
      throw new Error("confirm: no such signature was sent");
    }
    return world.confirm;
  },
};
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => ({
  "/sol/plain/worker.js": () => new Response("//",
    { headers: { "content-security-policy": PLAIN_WORKER_POLICY } }),
  "/near/quote": () => Response.json({ amountIn: "100000000", amountOut: "1232971711",
    minAmountOut: "1" }),
})[String(url)]?.() ?? rigFetch(url, init);
globalThis.Worker = class {
  postMessage({ id, cmd, args }) {
    const reply = (message) => queueMicrotask(() => this.onmessage({ data: { id, ...message } }));
    try {
      checkCommand(cmd, args);
      calls.push({ cmd, args: structuredClone(args) });
      if (world.failing === cmd) throw new Error(`${cmd}: Helius is not answering.`);
      const result = answers[cmd](args);
      if (world.hold?.cmd !== cmd) reply({ ok: true, result });
      else world.hold.wait.then(() => reply({ ok: true, result }));
    } catch (e) {
      reply({ ok: false, error: String(e.message) });
    }
  }
  terminate() {}
};
// The calls of the step, without the reads of the balances (one account list of one address).
const steps = () => calls.filter((x) => x.cmd !== "balance"
  && !(x.cmd === "accounts" && x.args.addresses.length === 1));
const names = () => steps().map((x) => x.cmd);

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
const all = (n, test) => [...(test(n) ? [n] : []), ...(n.kids ?? []).flatMap((k) => all(k, test))];
const one = (n, test) => all(n, test)[0];
const mark = (n, name) => one(n, (x) => x.attrs?.["data-sol"] === name);
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
const draw = (tab = "solana") => built(() => {
  t.ui.tab = tab;
  return t.walletView(null, null);
});
const click = (node) => node.on.click({ preventDefault() {}, currentTarget: {} });
const everything = (n) => n.text ?? JSON.stringify(n.attrs) + n.kids.map(everything).join("");
const keyed = (tree, key) => one(tree, (n) => n.attrs?.["data-key"] === key);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
// Every control is a button or a link, so Tab reaches it; no tab stop is positive; a focus key
// names one element, so that a redraw gives the focus back to the right one.
function sound(tree) {
  const withClick = all(tree, (n) => n.on?.click);
  assert.ok(withClick.every((n) => n.tag === "button"), "a click handler is on a button");
  const stops = all(tree, (n) => n.attrs?.tabindex !== undefined);
  assert.ok(stops.every((n) => n.attrs.tabindex === "-1"), "no positive tab stop");
  const keys = all(tree, (n) => n.attrs?.["data-key"]).map((n) => n.attrs["data-key"]);
  assert.equal(new Set(keys).size, keys.length, "each focus key names one element");
  const names = all(tree, (n) => n.attrs?.["aria-label"] && /^(button|a)$/.test(n.tag));
  assert.ok(names.every((n) => n.attrs["aria-label"].startsWith(text(n))), "names start with text");
}
// The label of each name of the checker (web/sol/plain/review.js).
const LABEL_OF = { intent: "Action", cluster: "Network", recipient: "To", amount: "Amount",
  units: "Base units", symbol: "Asset", mint: "Mint", fee: "Fee lamports", rent: "Rent lamports",
  payer: "Fee payer", group: "Wallet" };

// ── A mainnet wallet that the server serves, with its three devices set up ──
mainnetConfig.status = 200;
const gid = await rig.wallet({ name: "Direct", network: "mainnet" });
await waitFor("the answer of the probe", () => t.ui.plainServed === true);
await waitFor("the start documents", () => t.plainNotAdded());
draw("solana");
await waitFor("the plain controller", () => t.plainSol?.ctl.gid === gid
  && COLLECTIONS.every((name) => t.plainSol.ctl.loaded[name]));
const c = t.plainSol.ctl;
const add = mark(draw("solana"), "add");
t.ui.tab = "members";
await click(add);
await waitFor("agreement", () => agreement(c).state === "agree"
  && [1, 2, 3].every((i) => publishedFee(c, i)));
const group = agreement(c).done.groupKey;
const fee = (i) => publishedFee(c, i);
const secret = feeOf(c, 1).secret;
const ata = usdcAddress(c, group);
const pinsOf = (i) => plainPins(c.wallet, group, fee(i));
const nonceOf = (k, i = 1) => W.plain_reads(createNonceIntent(k, "00".repeat(32)), pinsOf(i))
  .split("\n").map((row) => row.split("\t")).find(([role]) => role === "nonce")[2];
const nonceAccount = () => account("1447680", SYSTEM, Buffer.alloc(80).toString("base64"));
world.accounts.set(base58(fee(1)), account(SOL(5)));
world.lamports.set(base58(fee(1)), SOL(5));
world.lamports.set(base58(group), SOL(1));

// What a person could find of the secret: the Worker calls, the log, the banner and the tree.
const logs = [];
c.host.log = (message) => logs.push(String(message));
const leaks = (tree) => {
  const where = { calls: JSON.stringify(calls), logs: logs.join("\n"), tree: everything(tree),
    state: JSON.stringify(c.direct), banner: JSON.stringify(t.banner ?? null),
    documents: JSON.stringify([...data.entries()]) };
  return Object.entries(where).filter(([, v]) => v.includes(secret)).map(([k]) => k);
};
// A read of the balances, so that the tab shows the USDC row as the chain has it.
const read = async () => {
  const before = c.balances.at;
  skew += 31_000;
  draw("solana");
  await waitFor("a read", () => c.balances.at !== before && !t.busy.has("sol:read"));
};
const settle = async () => {
  await waitFor("no read job", () => !t.busy.has("sol:read") && !t.busy.has("sol:direct"));
  await sleep(30);
};
const spy = { signs: [] };
// The words that the step sends to the live region of the page (host.announce).
const said = [];
assert.equal(c.host.announce, announce, "the host of the page gives the one live region");
c.host.announce = (words) => said.push(words);
c.W = { ...W, sol_plain_fee_sign: (...args) => {
  spy.signs.push(args);
  return (spy.override ?? W.sol_plain_fee_sign)(...args);
} };
const start = async (button) => {
  calls.length = 0;
  spy.signs.length = 0;
  said.length = 0;
  await click(mark(draw(), button));
  return draw();
};
const rowsOf = (tree) => {
  const list = mark(tree, "direct-rows");
  const cells = list.kids.map(text);
  return Array.from({ length: cells.length / 2 }, (_, i) => [cells[2 * i], cells[2 * i + 1]]);
};
// The checker writes fee and rent in lamports; the tab adds the SOL form after them.
const checkerRows = (run) => W.plain_check_message(run.message, run.intent, run.pins, run.chain)
  .split("\n").slice(1).map((line) => {
    const at = line.indexOf(" ");
    const [name, value] = [line.slice(0, at), line.slice(at + 1)];
    return [LABEL_OF[name], /^(fee|rent)$/.test(name) ? `${value} (${Number(value) / 1e9} SOL)`
      : value];
  });
// A node of the step that is a live region. The page says the step through host.announce.
const silent = (tree) => all(mark(tree, "send-setup") ?? tree,
  (n) => /^(status|alert)$/.test(n.attrs?.role ?? "")).length;
await read();

// ── The tab: Create nonce, and Enable USDC while the read shows no USDC account ──
{
  const tab = draw();
  const create = mark(tab, "create-nonce");
  const enable = mark(tab, "enable-usdc");
  assert.ok(create && enable, "the ready tab has both buttons");
  assert.equal(c.balances.usdc, null, "control: the read shows no USDC account");
  assert.deepEqual([create.attrs["data-key"], enable.attrs["data-key"]],
    ["sol-direct-createNonce", "sol-direct-enableUsdc"], "each button has its own focus key");
  assert.equal(create.attrs.disabled, undefined);
  for (const button of [create, enable]) assert.equal(button.tag, "button");
  const others = built(() => t.plainSol.view((fn) => fn, {}));
  assert.ok(mark(others, "create-nonce"), "a view with no actions still draws");
  assert.deepEqual(calls.filter((x) => x.cmd === "simulate" || x.cmd === "send"), []);
}
step("the tab has Create nonce and Enable USDC, each with its own focus key");

// ── Create nonce: read, check, show, and only then sign, simulate, send, confirm ──
let first;
{
  world.accounts.set(nonceOf(0), nonceAccount());
  world.accounts.set(nonceOf(2), nonceAccount());
  const tab = draw();
  const button = mark(tab, "create-nonce");
  calls.length = 0;
  said.length = 0;
  const twice = [click(button), click(button)];
  await Promise.all(twice);
  assert.equal(calls.filter((x) => x.cmd === "blockhash").length, 1, "a double click is one step");
  assert.deepEqual(names(), ["accounts", "blockhash", "genesis", "rent", "rent", "rent",
    "accounts"], "the reads: the window, the blockhash, the chain");
  const window = calls.find((x) => x.cmd === "accounts").args.addresses;
  assert.equal(window.length, 100, "one list of the first 100 nonce accounts");
  assert.deepEqual(window.slice(0, 3), [0, 1, 2].map((k) => nonceOf(k)), "from the wasm");
  assert.equal(c.direct.step, "review", "the checker accepted: the person can confirm");
  assert.deepEqual(c.direct.run.intent.slice(1, 5), Uint8Array.of(1, 0, 0, 0),
    "the first index whose account is missing, not the first one or the last one");
  assert.deepEqual(spy.signs, [], "nothing is signed before the person confirms");
  assert.deepEqual(names().filter((n) => /simulate|send|confirm/.test(n)), [], "nor sent");
  assert.deepEqual(t.wantFocus, { key: "sol-direct-title", force: true },
    "the focus goes to the heading of the screen");
  const tab2 = draw();
  const screen = mark(tab2, "direct-review");
  assert.ok(screen, "the review screen shows");
  sound(tab2);
  const title = mark(tab2, "direct-title");
  assert.equal(text(title), "Create nonce");
  assert.deepEqual([title.tag, title.attrs.tabindex, title.attrs["data-key"]],
    ["h4", "-1", "sol-direct-title"], "the heading can take the focus");
  assert.deepEqual(rowsOf(tab2), checkerRows(c.direct.run), "the rows are the checker's lines");
  assert.equal(rowsOf(tab2).find(([label]) => label === "Fee lamports")[1], "5000 (0.000005 SOL)",
    "the fee shows in SOL after the lamports, so that the cost can be read before Confirm");
  assert.deepEqual(said, ["Reading the chain…"], "the review says nothing: the focus goes to it");
  assert.equal(silent(tab2), 0, "no node of the step is a live region: the redraw would repeat it");
  assert.deepEqual(rowsOf(tab2).map(([label]) => label),
    ["Action", "Network", "Fee lamports", "Rent lamports", "Fee payer", "Wallet"]);
  assert.equal(rowsOf(tab2).find(([label]) => label === "Fee payer")[1], base58(fee(1)),
    "the fee payer is the fee address of device 1");
  assert.match(text(mark(tab2, "direct-signs")), /^Device 1 signs and pays\.$/);
  const order = all(screen, (n) => ["h4", "dl", "button"].includes(n.tag)).map((n) => n.tag);
  assert.deepEqual(order, ["h4", "dl", "button", "button"], "the rows come before the buttons");
  assert.deepEqual(all(screen, (n) => n.tag === "button").map(text), ["Confirm", "Cancel"]);
  assert.equal(mark(tab2, "create-nonce"), undefined, "the start buttons wait");
  assert.deepEqual(leaks(tab2), [], "the review holds no secret");
  first = c.direct.run;

  // Confirm twice: one action.
  calls.length = 0;
  said.length = 0;
  const confirm = mark(tab2, "confirm");
  await Promise.all([click(confirm), click(confirm)]);
  assert.deepEqual(names(), ["simulate", "send", "confirm"],
    "simulate, then send, then confirm; each once");
  assert.equal(spy.signs.length, 1, "one signature");
  const [simulate, send, confirmed] = steps();
  assert.equal(send.args.tx, simulate.args.tx, "the bytes that were sent are the bytes simulated");
  const raw = Buffer.from(simulate.args.tx, "base64");
  const signature = raw.subarray(-64).toString("hex");
  assert.deepEqual([...raw.subarray(0, raw.length - 64)], [...first.message],
    "the message of the transaction is the message that the checker accepted");
  assert.equal(simulate.args.tx, wireBase64(first.message, Buffer.from(signature, "hex")),
    "the wire form is that of the pool");
  assert.ok(W.sol_fee_verify(fee(1), first.message, signature), "the fee key signed that message");
  assert.equal(confirmed.args.signature, base58(signature), "confirm asks for the signature");
  const [message, intent, pins, chain, round] = spy.signs[0];
  assert.deepEqual([hex(message), hex(intent), hex(pins), hex(chain)],
    [hex(first.message), hex(first.intent), hex(first.pins), hex(first.chain)],
    "the wasm signs the message, the intent and the chain that were shown");
  assert.deepEqual(JSON.parse(round), { secret }, "the round holds the secret and nothing else");
  assert.equal(c.direct.step, "done");
  assert.deepEqual(said, ["Signing and sending…", "Create nonce: Confirmed, device 1."],
    "the live region says that the step sends, then how it ended");
  assert.deepEqual(t.wantFocus, { key: "sol-direct-createNonce", force: true },
    "the focus goes back to the button");
  const done = draw();
  sound(done);
  assert.equal(silent(done), 0);
  const line = text(mark(done, "direct-result"));
  assert.ok(line.startsWith("Create nonce: Confirmed, device 1. "), line);
  const id = base58(signature);
  assert.equal(text(mark(done, "direct-signature")), id.slice(0, 8) + "…" + id.slice(-6),
    "the short form of the signature");
  const link = mark(done, "direct-explorer");
  assert.equal(link.attrs.href, "https://explorer.solana.com/tx/" + id, "the link opens the id");
  assert.doesNotMatch(link.attrs.href, /cluster=/, "the link has no cluster parameter");
  assert.equal(link.attrs.target, "_blank", "the link opens in a new tab");
  assert.match(link.attrs.rel, /noopener/);
  assert.equal(link.attrs["aria-label"], undefined, "the name of the link is its text");
  assert.match(text(link), /^Open in explorer \(the transaction, opens in a new tab\)$/);
  assert.ok(mark(done, "create-nonce"), "the buttons are back");
  assert.deepEqual(leaks(done), [], "no secret in a Worker call, the log, the banner or the tree");
  await waitFor("the read after the step", () => calls.some((x) => x.cmd === "balance"), 5000);
  await settle();
  world.accounts.set(nonceOf(1), nonceAccount());
}
step("Create nonce reads, checks and shows first; then it signs, simulates, sends and confirms");

// ── Cancel gives the focus back; a new blockhash for each action; the next free index ──
{
  const hashes = [];
  for (const wanted of [3, 3]) {
    await start("create-nonce");
    assert.equal(c.direct.step, "review");
    assert.deepEqual(c.direct.run.intent.slice(1, 5), Uint8Array.of(wanted, 0, 0, 0));
    hashes.push(hex(c.direct.run.intent.slice(5)));
    assert.deepEqual(calls.filter((x) => x.cmd === "blockhash").length, 1,
      "one blockhash for each action");
    await click(mark(draw(), "cancel"));
    assert.equal(c.direct, null, "Cancel closes the screen");
    assert.deepEqual(t.wantFocus, { key: "sol-direct-createNonce", force: true },
      "Cancel gives the focus back to the button");
    assert.ok(keyed(draw(), "sol-direct-createNonce"), "and the button is there to take it");
    assert.deepEqual(names().filter((n) => /simulate|send|confirm/.test(n)), []);
  }
  assert.notEqual(hashes[0], hashes[1], "a second action reads another blockhash");
  assert.notEqual(hashes[0], hex(first.intent.slice(5)));
  assert.equal(world.sent.length, 1, "only the confirmed action sent");
  world.accounts.clear();
  world.accounts.set(base58(fee(1)), account(SOL(5)));
  await start("create-nonce");
  assert.deepEqual(c.direct.run.intent.slice(1, 5), Uint8Array.of(0, 0, 0, 0), "the first is free");
  await click(mark(draw(), "cancel"));
  const full = (addresses) => { for (const a of addresses) world.accounts.set(a, nonceAccount()); };
  world.afterWindow = null;
  full(Array.from({ length: 100 }, (_, k) => nonceOf(k)));
  await start("create-nonce");
  assert.equal(c.direct.step, "failed", "a device with 100 nonce accounts cannot make a 101st");
  assert.match(c.direct.text, /no free nonce account among its first 100/);
  assert.deepEqual(names().filter((n) => /blockhash|simulate|send/.test(n)), []);
  world.accounts.clear();
  world.accounts.set(base58(fee(1)), account(SOL(5)));
}
step("Cancel gives the focus back, a blockhash is read for each action, and the index is free");

// ── A nonce account that appears after the list was read: the checker refuses ──
{
  world.afterWindow = (addresses) => world.accounts.set(addresses[0], nonceAccount());
  const tab = await start("create-nonce");
  world.afterWindow = null;
  assert.equal(c.direct.step, "stopped", "a refusal stops the step");
  assert.equal(c.direct.review.kind, "refused");
  assert.ok(c.direct.review.rules.some((r) => r.id === "plain-nonce-account"));
  assert.deepEqual([spy.signs.length, names().filter((n) => /simulate|send|confirm/.test(n))],
    [0, []], "a refusal signs nothing and sends nothing");
  const screen = mark(tab, "direct-stopped");
  assert.ok(screen, "the screen shows the refusal");
  sound(tab);
  const rule = mark(tab, "rule-plain-nonce-account");
  assert.ok(rule, "one row for the rule");
  assert.equal(text(rule.kids[0]), W.plain_rule_list().split("\n")
    .find((l) => l.startsWith("plain-nonce-account\t")).split("\t")[1], "its statement");
  assert.ok(text(rule).length > text(rule.kids[0]).length, "and the detail of the checker");
  assert.equal(mark(tab, "confirm"), undefined, "there is no Confirm");
  assert.match(text(mark(tab, "direct-nothing")), /^Nothing was signed\.$/);
  assert.deepEqual(said, ["Reading the chain…", "Nothing was signed."]);
  assert.equal(silent(tab), 0);
  assert.deepEqual(t.wantFocus, { key: "sol-direct-title", force: true });
  assert.equal(text(mark(tab, "cancel")), "Close");
  await click(mark(tab, "cancel"));
  assert.equal(c.direct, null);
  assert.equal(world.sent.length, 1);
  world.accounts.clear();
  world.accounts.set(base58(fee(1)), account(SOL(5)));
}
step("a refusal shows the rules and signs and sends nothing");

// ── A fee address with too little SOL: the checker refuses, the text names no faucet ──
{
  world.accounts.delete(base58(fee(1)));
  const tab = await start("create-nonce");
  assert.equal(c.direct.step, "stopped");
  assert.ok(c.direct.review.rules.some((r) => r.id === "plain-rent-payer"));
  assert.ok(mark(tab, "direct-poor"), "the fee sentence shows");
  const poor = text(mark(tab, "direct-poor"));
  assert.equal(poor, "Device 1 has too little SOL at its fee address, and mainnet has no faucet.");
  assert.equal(poor.split(/[.!?]\s/).length, 1, "one sentence");
  assert.equal(said.at(-1), poor + " Nothing was signed.", "the live region says it");
  assert.equal(silent(tab), 0);
  assert.equal(all(mark(tab, "direct-stopped"), (n) => n.tag === "a").length, 0, "with no link");
  assert.ok(mark(tab, "rule-plain-rent-payer"), "the rule rows show too");
  assert.deepEqual([spy.signs.length, names().filter((n) => /simulate|send/.test(n))], [0, []]);
  await click(mark(tab, "cancel"));
  world.accounts.set(base58(fee(1)), account(SOL(5)));
}
step("a fee address with no SOL gets the mainnet sentence and no signature");

// ── A read that fails, a stop, another cluster: nothing is signed ──
{
  world.failing = "blockhash";
  const tab = await start("create-nonce");
  world.failing = null;
  assert.equal(c.direct.step, "failed");
  sound(tab);
  assert.equal(text(mark(tab, "direct-failed")), "blockhash: Helius is not answering.");
  assert.equal(silent(tab), 0, "the live region says the failure once; the node is no alert");
  assert.deepEqual(said, ["Reading the chain…", "blockhash: Helius is not answering."]);
  assert.deepEqual(t.wantFocus, { key: "sol-direct-createNonce", force: true });
  assert.deepEqual([spy.signs.length, names().includes("simulate")], [0, false]);
  world.genesis = GENESIS.devnet;
  await start("create-nonce");
  world.genesis = null;
  assert.equal(c.direct.step, "stopped", "another cluster is a refusal of the checker");
  assert.ok(c.direct.review.rules.some((r) => r.id === "plain-genesis"));
  assert.equal(spy.signs.length, 0);
  await click(mark(draw(), "cancel"));
  const host = c.host;
  const button = mark(draw(), "create-nonce"); // a stopped wallet draws no button
  c.host = { ...host, sec: () => ({ sol: { aborted: "Solana setup stopped: a seat left." } }) };
  calls.length = 0;
  await click(button);
  c.host = host;
  assert.equal(c.direct.step, "failed", "a stopped wallet reads nothing");
  assert.equal(c.direct.text, "Solana setup stopped: a seat left.", "the stop text");
  assert.deepEqual(calls, []);
  c.direct = null;
}
step("an error of the Worker, another cluster and a stopped wallet sign nothing");

// ── A failed test run shows the text of the network and sends nothing ──
{
  await start("create-nonce");
  world.sim = { err: '{"InstructionError":[0,{"Custom":1}]}', logs: ["Program log: no good"] };
  calls.length = 0;
  await click(mark(draw(), "confirm"));
  world.sim = { err: null, logs: [] };
  assert.deepEqual(names(), ["simulate"], "the test run is the last call");
  assert.equal(c.direct.step, "failed");
  assert.equal(c.direct.text, 'The network refused this in a test run: '
    + '{"InstructionError":[0,{"Custom":1}]} Program log: no good');
  assert.equal(text(mark(draw(), "direct-failed")), c.direct.text, "the screen shows that text");
  assert.equal(world.sent.length, 1, "nothing was sent");
  assert.equal(spy.signs.length, 1, "the key signed once, and the test run stopped the send");
  assert.ok(mark(draw(), "create-nonce"), "the buttons are back");
  // A short fee address says it in the words of the mainnet.
  await start("create-nonce");
  world.sim = { err: '"InsufficientFundsForRent"', logs: [] };
  await click(mark(draw(), "confirm"));
  world.sim = { err: null, logs: [] };
  assert.match(c.direct.text, /^Device 1 has too little SOL at its fee address, and mainnet has/);
  assert.match(c.direct.text, /The network refused this in a test run: "InsufficientFundsForRent"/);
  assert.equal(world.sent.length, 1);
}
step("a failed test run shows the text of the network and sends nothing");

// ── An answer "unknown" says so and sends nothing again ──
{
  await start("create-nonce");
  world.confirm = { status: "unknown", slot: "", err: null };
  calls.length = 0;
  const confirm = mark(draw(), "confirm");
  await click(confirm);
  world.confirm = { status: "confirmed", slot: "301", err: null };
  assert.deepEqual(names(), ["simulate", "send", "confirm"]);
  assert.equal(c.direct.result.status, "unknown");
  const done = draw();
  assert.match(text(mark(done, "direct-result")), /Sent, not confirmed yet, device 1\./);
  assert.ok(mark(done, "direct-explorer"), "the link is there to look");
  await click(confirm);
  await sleep(150);
  assert.deepEqual(names(), ["simulate", "send", "confirm"], "a late click sends nothing again");
  assert.equal(world.sent.length, 2);
  // A wait that fails after the send is not a failed send.
  await start("create-nonce");
  world.failing = "confirm";
  await click(mark(draw(), "confirm"));
  world.failing = null;
  assert.equal(c.direct.step, "done");
  assert.equal(c.direct.result.status, "unknown", "the id is all that is known");
  assert.equal(world.sent.length, 3);
}
step("an unknown answer says not confirmed yet and sends nothing again");

// ── The secret stays on the device ──
{
  await start("create-nonce");
  spy.override = (...args) => { throw new Error("the wasm said no: " + args[4]); };
  await click(mark(draw(), "confirm"));
  delete spy.override;
  assert.equal(c.direct.step, "failed");
  assert.ok(c.direct.text.startsWith("the wasm said no: "), c.direct.text);
  assert.ok(!c.direct.text.includes(secret), "an error text holds no secret");
  assert.deepEqual(leaks(draw()), [], "nor the Worker calls, the log, the banner or the tree");
  assert.equal(world.sent.length, 3, "a refused signature sends nothing");
  assert.ok(!JSON.stringify(c.direct).includes(secret), "and the state holds none");
}
step("the secret of the fee key is in no call, log, banner, state or tree");

// ── Enable USDC: the state of the tab comes from the next read ──
{
  const tree = await start("enable-usdc");
  assert.equal(c.direct.step, "review");
  assert.equal(text(mark(tree, "direct-title")), "Enable USDC");
  assert.deepEqual(rowsOf(tree), checkerRows(c.direct.run));
  assert.deepEqual(rowsOf(tree).map(([label]) => label),
    ["Action", "Network", "Mint", "Fee lamports", "Rent lamports", "Fee payer", "Wallet"]);
  assert.equal(rowsOf(tree).find(([label]) => label === "Rent lamports")[1],
    `${RENTS[2]} (${Number(RENTS[2]) / 1e9} SOL)`, "the rent of a token account is shown, in SOL");
  assert.ok(rowsOf(tree).find(([label]) => label === "Mint")[1].startsWith("EPjFWdd5"));
  assert.deepEqual(Array.from(c.direct.run.intent.slice(0, 2)), [16, 0], "enable token 0, USDC");
  assert.equal(world.accounts.has(ata), false);
  calls.length = 0;
  await click(mark(tree, "confirm"));
  assert.deepEqual(names(), ["simulate", "send", "confirm"]);
  const [simulate, send] = steps();
  assert.equal(send.args.tx, simulate.args.tx);
  const signature = signatureOf(simulate.args.tx);
  assert.ok(W.sol_fee_verify(fee(1), c.direct.run.message, signature));
  assert.equal(c.direct.step, "done");
  assert.ok(text(mark(draw(), "direct-result")).startsWith("Enable USDC: Confirmed, device 1. "));
  await settle();
  assert.ok(mark(draw(), "enable-usdc"), "the send result does not turn Enable USDC off");
  world.accounts.set(ata, account("2039280", TOKEN_PROGRAM, tokenData()));
  await read();
  assert.equal(c.balances.usdc, 0n);
  assert.equal(mark(draw(), "enable-usdc"), undefined, "the next read of the balance does");
  assert.ok(mark(draw(), "create-nonce"), "Create nonce stays");
  c.direct = null;
}
function tokenData() {
  const token = Buffer.alloc(165);
  token[108] = 1;
  return token.toString("base64");
}
step("Enable USDC shows the lines, sends once, and turns off with the next read");

// ── Enable USDC at an address that the System program owns: the checker refuses (3.9) ──
{
  world.accounts.set(ata, account("890880"));
  await read();
  assert.equal(c.balances.usdc, null, "control: a System account is no USDC account");
  const tab = await start("enable-usdc");
  assert.equal(c.direct.step, "stopped");
  assert.deepEqual(c.direct.review.rules.map((r) => r.id), ["plain-source-account"]);
  assert.ok(mark(tab, "rule-plain-source-account"), "the screen shows the rule");
  assert.deepEqual([spy.signs.length, names().filter((n) => /simulate|send/.test(n))], [0, []]);
  await click(mark(tab, "cancel"));
  assert.deepEqual(t.wantFocus, { key: "sol-direct-enableUsdc", force: true });
  world.accounts.delete(ata);
}
step("Enable USDC at an address with System-owned lamports is refused with the rule row");

// ── The words of each answer of the network ──
{
  const wanted = { failed: "Failed on chain", finalized: "Confirmed",
    pending: "Sent, not confirmed yet", none: "Sent, not confirmed yet" };
  for (const [status, words] of Object.entries(wanted)) {
    await start("create-nonce");
    world.confirm = { status, slot: "1", err: status === "failed" ? '"x"' : null };
    await click(mark(draw(), "confirm"));
    world.confirm = { status: "confirmed", slot: "301", err: null };
    const done = draw();
    const line = `Create nonce: ${words}, device 1.`;
    assert.ok(text(mark(done, "direct-result")).startsWith(line + " "), status + ": " + line);
    assert.equal(said.at(-1), line, status + ": the live region says it once");
    assert.equal(silent(done), 0, status + ": no node of the step is a live region");
    assert.ok(mark(done, "direct-explorer"), status + ": the link is there to look");
    assert.equal(c.direct.result.txId, base58(signatureOf(world.sent.at(-1))));
  }
}
step("failed, finalized, pending and none each show their own words and the link");

// ── A stop that comes between two guards sends nothing ──
// A host whose first block(c) of direct.js finds the stop, and no other call does. A stub for the
// whole call would also reach reactAborts, which publishes a real abort document.
const STOP = "Solana setup stopped: a seat left.";
const stopOnce = (host) => {
  let armed = true;
  return { ...host, sec: (...args) => {
    if (armed && new Error().stack.includes("at block ")) {
      armed = false;
      return { sol: { aborted: STOP } };
    }
    return host.sec(...args);
  } };
};
{
  // Between the review and Confirm.
  await start("create-nonce");
  const confirm = mark(draw(), "confirm");
  const host = c.host;
  c.host = stopOnce(host);
  const before = world.sent.length;
  calls.length = 0;
  spy.signs.length = 0;
  await click(confirm);
  c.host = host;
  assert.equal(c.direct.step, "failed", "a stop before Confirm ends the step");
  assert.equal(c.direct.text, STOP, "the step shows the stop");
  assert.deepEqual([spy.signs.length, names()], [0, []], "nothing is signed, nothing is read");
  assert.equal(world.sent.length, before);
  c.direct = null;
  // Between the test run and the send.
  await start("create-nonce");
  const second = mark(draw(), "confirm");
  let release;
  world.hold = { cmd: "simulate", wait: new Promise((done) => { release = done; }) };
  calls.length = 0;
  spy.signs.length = 0;
  const running = click(second);
  await waitFor("the test run", () => calls.some((x) => x.cmd === "simulate"));
  c.host = stopOnce(host);
  release();
  await running;
  c.host = host;
  world.hold = null;
  assert.deepEqual(names(), ["simulate"], "a stop after the test run sends nothing");
  assert.equal(c.direct.step, "failed");
  assert.equal(c.direct.text, STOP);
  assert.equal(spy.signs.length, 1, "the key signed once, before the stop");
  assert.equal(world.sent.length, before, "and nothing was sent");
  c.direct = null;
}
step("a stop before Confirm or between the test run and the send sends nothing");

// ── A send that the node refuses after a good test run is not repeated ──
{
  await start("create-nonce");
  const confirm = mark(draw(), "confirm");
  const hashes = world.hashes;
  const before = world.sent.length;
  world.failing = "send";
  calls.length = 0;
  spy.signs.length = 0;
  await click(confirm);
  world.failing = null;
  assert.deepEqual(names(), ["simulate", "send"], "no confirm and no second send");
  assert.equal(spy.signs.length, 1, "one signature");
  assert.equal(world.hashes, hashes, "no new blockhash");
  assert.equal(c.direct.step, "failed");
  assert.equal(c.direct.text, "send: Helius is not answering.");
  await click(confirm);
  await sleep(100);
  assert.deepEqual(names(), ["simulate", "send"], "a late click does nothing");
  assert.equal(world.sent.length, before);
  c.direct = null;
}
step("a refused send is shown once and never repeated");

// ── A review that stayed open until its blockhash was gone ──
{
  await start("create-nonce");
  world.sim = { err: '"BlockhashNotFound"', logs: [] };
  const before = world.sent.length;
  calls.length = 0;
  await click(mark(draw(), "confirm"));
  world.sim = { err: null, logs: [] };
  const tooOld = "This review is too old. Nothing was sent. Start again.";
  assert.equal(c.direct.text, tooOld, "the review is too old");
  assert.equal(said.at(-1), tooOld);
  assert.deepEqual(names(), ["simulate"]);
  assert.equal(world.sent.length, before);
  assert.ok(mark(draw(), "create-nonce"), "the person can start again");
  await start("create-nonce");
  assert.equal(c.direct.step, "review", "and the new review has a new blockhash");
  c.direct = null;
}
step("a blockhash that is gone says the review is too old");

// ── Another device pays when device 1 has no usable fee key ──
{
  // Device 1 shows another key than its share gives: its fee key cannot sign (fee.js).
  const sharePackage = JSON.stringify(c.host.sec(c.gid, 1).sol.keyPackage);
  const wasteful = c.W;
  c.W = { ...wasteful, sol_fee_key: (pkg) => {
    const made = JSON.parse(W.sol_fee_key(pkg));
    return JSON.stringify(pkg === sharePackage ? { ...made, public: fee(2) } : made);
  } };
  world.accounts.set(base58(fee(2)), account(SOL(5)));
  const tab = await start("create-nonce");
  assert.equal(c.direct.step, "review", "device 2 reviews");
  assert.equal(c.direct.seat, 2, "device 2 pays");
  assert.match(text(mark(tab, "direct-signs")), /^Device 2 signs and pays\.$/);
  assert.equal(rowsOf(tab).find(([label]) => label === "Fee payer")[1], base58(fee(2)));
  await click(mark(tab, "confirm"));
  assert.equal(c.direct.step, "done");
  assert.ok(text(mark(draw(), "direct-result")).startsWith("Create nonce: Confirmed, device 2. "),
    "the result names device 2");
  const signature = signatureOf(steps().find((x) => x.cmd === "simulate").args.tx);
  assert.ok(W.sol_fee_verify(fee(2), c.direct.run.message, signature), "fee key 2 signed");
  assert.ok(!W.sol_fee_verify(fee(1), c.direct.run.message, signature), "not fee key 1");
  assert.ok(!JSON.stringify(calls).includes(feeOf(c, 2).secret), "no secret of device 2 in a call");
  // A short fee address names its own device, before and after the test run.
  world.accounts.delete(base58(fee(2)));
  const poor = await start("create-nonce");
  assert.equal(c.direct.step, "stopped");
  assert.equal(text(mark(poor, "direct-poor")),
    "Device 2 has too little SOL at its fee address, and mainnet has no faucet.");
  await click(mark(poor, "cancel"));
  world.accounts.set(base58(fee(2)), account(SOL(5)));
  await start("create-nonce");
  world.sim = { err: '"InsufficientFundsForRent"', logs: [] };
  await click(mark(draw(), "confirm"));
  world.sim = { err: null, logs: [] };
  assert.match(c.direct.text, /^Device 2 has too little SOL at its fee address, and mainnet has/);
  c.W = wasteful;
  world.accounts.delete(base58(fee(2)));
  c.direct = null;
}
step("device 2 signs, pays and is named when device 1 has no usable fee key");

// ── A checker that fails, or accepts with no line to show, leaves no way to confirm ──
{
  const wasteful = c.W;
  for (const [answer, shown] of [
    [() => { throw new Error("the checker broke"); }, "the checker broke"],
    [() => "accepted\n", "The checker answered with lines that Zigs cannot show."],
  ]) {
    c.W = { ...wasteful, plain_check_message: answer };
    const tab = await start("create-nonce");
    c.W = wasteful;
    assert.equal(c.direct.step, "stopped", shown);
    assert.equal(text(mark(tab, "direct-error")), shown, "the screen shows: " + shown);
    assert.equal(mark(tab, "confirm"), undefined, "there is no Confirm");
    assert.equal(said.at(-1), shown + " Nothing was signed.", "the live region says it");
    assert.deepEqual([spy.signs.length, names().filter((n) => /simulate|send/.test(n))], [0, []]);
    await click(mark(tab, "cancel"));
  }
}
step("a checker that fails or shows no line gives no Confirm");

// ── Escape, the disabled buttons and the USDC rows ──
{
  const escape = (tree, name) => mark(tree, name).on.keydown({ key: "Escape" });
  let tab = await start("create-nonce");
  mark(tab, "direct-review").on.keydown({ key: "Enter" });
  assert.equal(c.direct.step, "review", "another key does nothing");
  escape(tab, "direct-review");
  assert.equal(c.direct, null, "Escape cancels the review");
  assert.deepEqual(t.wantFocus, { key: "sol-direct-createNonce", force: true });
  world.afterWindow = (addresses) => world.accounts.set(addresses[0], nonceAccount());
  tab = await start("create-nonce");
  world.afterWindow = null;
  assert.equal(c.direct.step, "stopped");
  escape(tab, "direct-stopped");
  assert.equal(c.direct, null, "and the refusal");
  world.accounts.clear();
  world.accounts.set(base58(fee(1)), account(SOL(5)));

  // A step that reads: the start buttons wait.
  let release;
  world.hold = { cmd: "blockhash", wait: new Promise((done) => { release = done; }) };
  calls.length = 0;
  const reading = click(mark(draw(), "create-nonce"));
  await waitFor("the read", () => calls.some((x) => x.cmd === "blockhash"));
  tab = draw();
  const waiting = [mark(tab, "create-nonce"), mark(tab, "enable-usdc")];
  assert.ok(waiting.every((b) => b && b.attrs.disabled !== undefined), "both start buttons wait");
  assert.equal(text(mark(tab, "direct-busy")), "Reading the chain…");
  assert.equal(silent(tab), 0);
  const state = c.direct;
  closeDirect(c);
  assert.equal(c.direct, state, "a step that reads is not closed");
  release();
  await reading;
  world.hold = null;
  assert.equal(c.direct.step, "review");

  // A step that sends: Confirm and Cancel wait, and neither Cancel nor Escape drops the result.
  world.hold = { cmd: "simulate", wait: new Promise((done) => { release = done; }) };
  const sending = click(mark(draw(), "confirm"));
  await waitFor("the test run", () => calls.some((x) => x.cmd === "simulate"));
  tab = draw();
  assert.equal(c.direct.step, "sending");
  for (const name of ["confirm", "cancel"]) {
    assert.notEqual(mark(tab, name).attrs.disabled, undefined, name + " waits while it sends");
  }
  assert.equal(text(mark(tab, "direct-busy")), "Signing and sending…");
  assert.equal(silent(tab), 0);
  closeDirect(c);
  await click(mark(tab, "cancel"));
  escape(tab, "direct-sending");
  assert.equal(c.direct, state, "a step that sends is not closed");
  release();
  await sending;
  world.hold = null;
  assert.equal(c.direct.step, "done", "so its result is not lost");
  assert.equal(c.direct.result.status, "confirmed");

  // The USDC row: Enable USDC shows only for a read that found no account.
  await settle();
  const saved = { ...c.balances };
  c.balances.next = Number.MAX_SAFE_INTEGER; // the draw starts no read
  const rows = {
    off: { at: 1, error: "", usdc: null, usdcError: "" },
    reading: { at: null, error: "", usdc: null, usdcError: "" },
    failed: { at: null, error: "Helius is not answering.", usdc: null, usdcError: "" },
    bad: { at: 1, error: "", usdc: null, usdcError: "The USDC account is not a token account." },
    stale: { at: 1, error: "Helius is not answering.", usdc: 5n, usdcError: "" },
  };
  for (const [name, row] of Object.entries(rows)) {
    Object.assign(c.balances, row);
    const shown = draw();
    assert.equal(!!mark(shown, "enable-usdc"), name === "off", "Enable USDC for the row " + name);
    assert.ok(mark(shown, "create-nonce"), "Create nonce stays for the row " + name);
  }
  Object.assign(c.balances, saved);
  c.direct = null;

  // A viewer with no device in this browser has neither button.
  const viewer = built(() => plainView({ ...c, host: { ...c.host, localSeats: () => [] } },
    (fn) => fn, {}));
  assert.equal(mark(viewer, "send-setup"), undefined);
  assert.equal(mark(viewer, "create-nonce"), undefined);
}
step("Escape cancels, the buttons wait while a step reads or sends, USDC follows its row");

// ── The live region of the page stays; only its text changes ──
{
  const before = globalThis.document;
  const mounted = [];
  globalThis.document = new Proxy(recording(before), { get: (o, k) => k === "getElementById"
    ? (id) => ({ id, after: (node) => { node.isConnected = true; mounted.push(node); } }) : o[k] });
  try {
    announce("one");
    announce("two");
    assert.equal(mounted.length, 1, "one region");
    const region = mounted[0];
    assert.equal(region.textContent, "", "the text is cleared first, so a repeat is a change");
    await sleep(250);
    assert.equal(region.textContent, "two", "then the last words are set");
    assert.equal(region.className, "sr-only");
    assert.deepEqual([region.attrs.role, region.attrs["aria-live"], region.attrs["aria-atomic"]],
      ["status", "polite", "true"]);
    announce("two");
    assert.equal(region.textContent, "", "the same words again are cleared first too");
    await sleep(250);
    assert.equal(region.textContent, "two");
    region.isConnected = false; // the page lost it
    announce("three");
    assert.equal(mounted.length, 2, "a new region replaces a region that left the page");
    await sleep(250);
    assert.equal(mounted[1].textContent, "three");
  } finally {
    globalThis.document = before;
  }
}
step("the live region stays and only its text changes");

// ── The wallet closes while a step reads: nothing is left behind ──
{
  calls.length = 0;
  let release;
  world.hold = { cmd: "blockhash", wait: new Promise((done) => { release = done; }) };
  const running = click(mark(draw(), "create-nonce"));
  await waitFor("the read", () => calls.some((x) => x.cmd === "blockhash"));
  t.plainSol.close();
  assert.equal(c.direct, null, "a closed wallet drops its step");
  release();
  await running;
  world.hold = null;
  assert.equal(c.direct, null, "and the step that was reading does not bring it back");
  assert.deepEqual(names().filter((n) => /simulate|send|confirm/.test(n)), []);
}
step("a closed wallet drops its step");

console.log("sol-plain-direct: ok");
process.exit(0);
