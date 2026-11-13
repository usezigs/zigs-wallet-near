// The send form, the list of sends, the review before an approval, the Approvals count, the
// Overview choices and the words for the live region of a served plain wallet (web/sol/plain/
// sendview.js, sends.js, view.js, held.js; app-sol.js, app-wallet.js) against the real page
// modules, the real wasm and the rig (sol-rig.mjs): three set-up devices, two of three. The Worker
// is a fake that runs checkCommand of guard.js and answers from a table; it knows no simulate, send
// or confirm, so a call to one of them fails the test. It shows: the form refuses a bad address,
// the address of the wallet, zero, too many decimals, more than the balance, USDC before its
// account and a send with no free nonce account, with a text next to the field, and proposes
// exact base units; a double click of Propose makes one proposal; USDC is offered only when the
// read shows the token account; a row has a chip for each state and shows no amount and no
// recipient; Review shows the lines of the checker for the proposal that the page holds now, and
// Approve needs that review of the same proposal; a refusal has one line and its rules in a
// details element, and no Approve; the count of Approvals; the Overview choices; the live region
// says a change of another device once.
// Run: node web/test/sol-plain-ui.mjs   (Node 26)
import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign as ed25519 } from "node:crypto";
import fs from "node:fs";
import { agreement } from "../sol/ceremony.js";
import { COLLECTIONS, base58, keyOfBase58 } from "../sol/docs.js";
import { feeOf, publishedFee } from "../sol/fee.js";
import { GENESIS, PLAIN_WORKER_POLICY, checkCommand } from "../sol/plain/guard.js";
import {
  createNonceIntent, hexOfBytes, plainPins, sendSolIntent, sendTokenIntent,
} from "../sol/plain/intent.js";
import { checkTyped } from "../sol/plain/propose.js";
import { usdcAddress } from "../sol/plain/reads.js";
import { SESSIONS, SUPERSEDED, writeProposal } from "../sol/plain/sessions.js";
import {
  announceChanges, approveLooked, formError, freeNonces, pendingList, reviewKey,
} from "../sol/plain/sends.js";
import { plainView } from "../sol/plain/view.js";
import * as W from "../sol/wasm/sol_wasm.js";
import { loadRig, mainnetConfig } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, data, waitFor } = rig;
const step = (name) => console.log("ok  " + name);
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew; // the gap of 30 s between two reads passes at once
const path = (gid, rel) => `groups/${gid}/${rel}`;
const hex = (bytes) => Buffer.from(bytes).toString("hex");

// ── The chain of the fake Worker ──
const SYSTEM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const vectors = new URL("../../wasm-sol/vectors/plain/", import.meta.url);
const vector = (name, ext) => fs.readFileSync(new URL(`mainnet-${name}.${ext}`, vectors));
const vectorChain = vector("s1-create-nonce", "chain");
const RENTS = [32, 40, 48].map((at) => String(vectorChain.readBigUInt64LE(at)));
const RENT_SPACES = [0, 80, 165];
const answerLine = (shape, name) =>
  new RegExp(`^${name} (\\S+)$`, "m").exec(vector(shape, "answer").toString())[1];
const RECIPIENT = answerLine("s2-send-sol", "recipient");
const USDC_MINT = answerLine("s3-send-usdc", "mint");
const SOL = (n) => String(BigInt(Math.round(n * 1e9)));
const OTHER_RECIPIENT = "66".repeat(32);
const account = (lamports, owner = SYSTEM, bytes = Buffer.alloc(0)) =>
  ({ owner, lamports: String(lamports), executable: false,
    data: Buffer.from(bytes).toString("base64") });
const world = { accounts: new Map() };
const calls = [];
const answers = {
  init: ({ cluster }) => ({ cluster }),
  genesis: () => ({ genesis: GENESIS.mainnet }),
  rent: ({ space }) => ({ lamports: RENTS[RENT_SPACES.indexOf(space)] }),
  balance: ({ address }) => ({ lamports: world.accounts.get(address)?.lamports ?? "0" }),
  accounts: ({ addresses }) => ({ accounts: addresses.map((a) => world.accounts.get(a) ?? null) }),
};
// A command that the table does not know fails: no test run, no send.
const call = async (cmd, args = {}) => {
  checkCommand(cmd, args);
  calls.push({ cmd, args: structuredClone(args) });
  if (!answers[cmd]) throw new Error(`the Worker is asked for ${cmd}`);
  return structuredClone(answers[cmd](args));
};
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => (String(url) === "/sol/plain/worker.js"
  ? new Response("//", { headers: { "content-security-policy": PLAIN_WORKER_POLICY } })
  : rigFetch(url, init));
globalThis.Worker = class {
  postMessage({ id, cmd, args }) {
    const reply = (message) => queueMicrotask(() => this.onmessage({ data: { id, ...message } }));
    call(cmd, args).then((result) => reply({ ok: true, result }),
      (e) => reply({ ok: false, error: String(e.message) }));
  }
  terminate() {}
};

// ── The page text, with a recorder in place of the document ──
class Rec extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, kids: [], attrs: {}, on: {}, style: {} });
  }
  get id() { return this.attrs.id; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(k, v) { this.on[k] = v; }
  dispatchEvent(ev) { this.on[ev.type]?.(ev); return true; }
  append(...kids) { this.kids.push(...kids); }
}
const text = (n) => n.text ?? n.kids.map(text).join("");
const all = (n, test) => [...(test(n) ? [n] : []), ...(n.kids ?? []).flatMap((k) => all(k, test))];
const one = (n, test) => all(n, test)[0];
const mark = (n, name) => one(n, (x) => x.attrs?.["data-sol"] === name);
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
// document.getElementById finds the nodes of `tree`, as it finds those of the page just drawn.
// The result puts the document back.
const showing = (tree) => {
  const real = globalThis.document;
  globalThis.document = new Proxy(real, { get: (o, k) => (k === "getElementById"
    ? (id) => one(tree, (n) => n.attrs?.id === id) ?? o.getElementById(id) : o[k]) });
  return () => { globalThis.document = real; };
};
// What draw() of the page does to the fields (app-loop.js): the typed values are saved, the page
// is built again, and the values are restored by id with an input event for each field.
const redraw = (old) => {
  const fields = (tree) => ({ querySelector: () => null, querySelectorAll: (selector) =>
    (selector === "input[id], select[id], textarea[id]"
      ? all(tree, (n) => n.tag === "input" && n.attrs.id) : []) });
  const saved = t.saveFormState(fields(old));
  const fresh = draw("solana");
  const stop = showing(fresh);
  try {
    t.restoreFormState(fields(fresh), saved);
  } finally {
    stop();
  }
  return fresh;
};
const wordsIn = (s) => s.split(/\s+/).filter(Boolean).length;
// The words of a node that are not in a button or a link.
const words = (n) => (n.text !== undefined ? [n.text]
  : /^(button|a)$/.test(n.tag) ? [] : n.kids.flatMap(words));
const live = (tree) => all(tree, (n) => /^(status|alert)$/.test(n.attrs?.role ?? ""));

// ── A mainnet wallet that the server serves, with its three devices set up ──
mainnetConfig.status = 200;
const gid = await rig.wallet({ name: "Sends", network: "mainnet" });
await waitFor("the answer of the probe", () => t.ui.plainServed === true);
await waitFor("the start documents", () => t.plainNotAdded());
draw("solana");
await waitFor("the plain controller", () => t.plainSol?.ctl.gid === gid
  && COLLECTIONS.every((name) => t.plainSol.ctl.loaded[name]));
const plain = t.plainSol;
const c = plain.ctl;
t.ui.tab = "members";
await click(mark(draw("solana"), "add"));
await waitFor("agreement", () => agreement(c).state === "agree"
  && [1, 2, 3].every((i) => publishedFee(c, i)));
const group = agreement(c).done.groupKey;
const fee = (i) => publishedFee(c, i);
const pinsOf = (i) => plainPins(c.wallet, group, fee(i));
const recipient = keyOfBase58(RECIPIENT);
const ata = usdcAddress(c, group);
const nonceValue = (seat, k) =>
  createHash("sha256").update(`nonce ${seat} ${k} 0`).digest("hex");
const nonceAddress = (seat, k) => W.plain_reads(createNonceIntent(k, "00".repeat(32)), pinsOf(seat))
  .split("\n").map((row) => row.split("\t")).find(([role]) => role === "nonce")[2];
const nonceBytes = (value) => {
  const bytes = Buffer.alloc(80);
  bytes.writeUInt32LE(1, 0);
  bytes.writeUInt32LE(1, 4);
  Buffer.from(group, "hex").copy(bytes, 8);
  Buffer.from(value, "hex").copy(bytes, 40);
  bytes.writeBigUInt64LE(5000n, 72);
  return bytes;
};
const setNonce = (seat, k, value = nonceValue(seat, k)) =>
  world.accounts.set(nonceAddress(seat, k), account(RENTS[1], SYSTEM, nonceBytes(value)));
const tokenBytes = (units) => {
  const bytes = Buffer.alloc(165);
  Buffer.from(keyOfBase58(USDC_MINT), "hex").copy(bytes, 0);
  Buffer.from(group, "hex").copy(bytes, 32);
  bytes.writeBigUInt64LE(units, 64);
  bytes[108] = 1;
  return bytes;
};
for (const seat of [1, 2, 3]) world.accounts.set(base58(fee(seat)), account(SOL(5)));
world.accounts.set(base58(group), account(SOL(1)));
// A screen shows the wallet and a read follows, when its gap has passed.
const readFrom = async (tab) => {
  const before = c.balances.at;
  skew += 31_000;
  draw(tab);
  await waitFor("the read from " + tab, () => c.balances.at !== before, 20000);
  await waitFor("no read job", () => !t.busy.has("sol:read"));
  return draw("solana");
};
// The fee signature of a forged proposal: the test plays a proposer that signs what it likes.
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const forge = (seat, message) => {
  const seed = Buffer.from(feeOf(c, seat).secret, "hex");
  const key = createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" });
  return ed25519(null, Buffer.from(message), key).toString("hex");
};
const newId = () => hexOfBytes(crypto.getRandomValues(new Uint8Array(16)));
// A proposal in the store as seat `seat` signs it: the nonce index k, and the message if given.
const plant = async (seat, { k, message, amount = 5_000_000n }) => {
  const intent = sendSolIntent(k, nonceValue(seat, k), recipient, amount);
  const bytes = message ?? W.plain_compile_message(intent, pinsOf(seat));
  const id = newId();
  await writeProposal(c, id, { intent: hex(intent), message: hex(bytes), feeSig: forge(seat, bytes),
    createdAt: Date.now() }, seat);
  return id;
};
const sessions = async () => {
  await waitFor("the signature checks", () => {
    c.refresh();
    return c.sessWait === 0 && c.wait === 0;
  }, 10000);
  return c.sessions;
};
const stored = () => [...data.keys()].filter((k) => k.includes("/solsessions/")).sort();
const READ = "Zigs has not read the balance yet.";

// ── The form before the first read, and USDC only with its account ──
{
  const ok = { asset: "sol", recipient: RECIPIENT, amount: "0.01" };
  const read = c.balances.at;
  c.balances.at = null;
  assert.deepEqual(formError(c, ok), { field: "amount", text: READ },
    "no balance is known before a read");
  c.balances.at = read;
  await readFrom("solana");
  assert.equal(c.balances.sol, 1_000_000_000n, "control: the read has the SOL");
  assert.deepEqual(c.balances.nonces, { seat: 1, have: 0, ks: [] }, "no nonce account yet");
  const tab = draw("solana");
  const form = mark(tab, "send-form");
  assert.ok(form, "a ready tab has the send form");
  assert.equal(mark(tab, "asset-usdc"), undefined, "USDC is not offered without its account");
  assert.equal(mark(tab, "asset-sol"), undefined, "and one asset needs no choice");
  assert.match(text(form), /Amount \(SOL\)/);
  assert.equal(text(mark(tab, "nonces")), "Nonce accounts: 0, free: 0.");
  plain.pick("usdc");
  const kept = draw("solana");
  assert.match(text(mark(kept, "send-form")), /Amount \(USDC\)/,
    "a USDC choice stays when the read shows no account: the asset is not changed silently");
  assert.equal(mark(kept, "asset-usdc")?.attrs["aria-pressed"], "true");
  assert.equal(mark(kept, "asset-sol")?.attrs["aria-pressed"], "false",
    "and SOL stays one click away");
  plain.pick("sol");
  world.accounts.set(ata, account(RENTS[2], TOKEN_PROGRAM, tokenBytes(100_000_000n)));
  const both = await readFrom("solana");
  assert.ok(mark(both, "asset-usdc") && mark(both, "asset-sol"), "the account is there: both");
  assert.equal(mark(both, "asset-sol").attrs["aria-pressed"], "true");
  assert.equal(mark(both, "asset-usdc").attrs["aria-pressed"], "false");
  plain.pick("usdc");
  const usdc = draw("solana");
  assert.match(text(mark(usdc, "send-form")), /Amount \(USDC\)/);
  assert.equal(mark(usdc, "asset-usdc").attrs["aria-pressed"], "true");
  plain.pick("sol");
  assert.deepEqual(live(mark(draw("solana"), "send-form")).map((n) => n.attrs.id),
    ["sol-plain-saved-hint"], "the only live node of the form is the picker of the Address book");
}
step("USDC is offered only when the read shows the token account");

// ── The checks of the form: each refusal names its field ──
{
  const ok = { asset: "sol", recipient: RECIPIENT, amount: "0.01" };
  for (const k of [0, 1, 2, 3]) setNonce(1, k);
  await readFrom("solana");
  assert.deepEqual(c.balances.nonces, { seat: 1, have: 4, ks: [0, 1, 2, 3] });
  assert.equal(formError(c, ok), null, "a good send has no error");
  const bad = (change, field, pattern, why = JSON.stringify(change)) => {
    const error = formError(c, { ...ok, ...change });
    assert.equal(error?.field, field, why);
    assert.match(error.text, pattern, why);
  };
  bad({ recipient: "not an address" }, "recipient", /Solana address of the recipient/);
  bad({ recipient: "" }, "recipient", /Solana address of the recipient/);
  bad({ recipient: base58(group) }, "recipient", /address of this wallet/,
    "the address of this wallet is refused");
  bad({ recipient: " " + base58(group) + " " }, "recipient", /address of this wallet/);
  bad({ amount: "0" }, "amount", /at most 9 decimals/);
  bad({ amount: "0.0000000001" }, "amount", /at most 9 decimals/);
  bad({ amount: "1e3" }, "amount", /Enter an amount of SOL/);
  bad({ amount: "-1" }, "amount", /Enter an amount of SOL/);
  bad({ amount: "1.000000001" }, "amount", /^The balance is 1 SOL\.$/,
    "more than the balance of SOL is refused");
  bad({ asset: "usdc", amount: "100.000001" }, "amount", /^The balance is 100 USDC\.$/,
    "more than the balance of USDC is refused");
  bad({ asset: "btc" }, "asset", /Choose SOL or USDC/);
  assert.equal(formError(c, { ...ok, amount: "1" }), null, "the whole balance is not more");
  assert.equal(formError(c, { ...ok, asset: "usdc", amount: "100" }), null);
  const kept = c.balances.usdc;
  c.balances.usdc = null;
  bad({ asset: "usdc", amount: "1" }, "asset", /^Enable USDC first\.$/,
    "a USDC send is refused before its account");
  c.balances.usdc = kept;
  // Exact base units, with no float: the amounts that a Number rounds.
  assert.equal(checkTyped({ ...ok, amount: "0.000000001" }).units, 1n);
  assert.equal(checkTyped({ ...ok, amount: "18446744073.709551615" }).units, 2n ** 64n - 1n);
  assert.equal(checkTyped({ ...ok, asset: "usdc", amount: "9007199254.740993" }).units,
    9007199254740993n);
  assert.equal(checkTyped(ok).to, recipient, "the recipient is the key of the address");
  // Nothing free: the four accounts are held by open proposals.
  const held = [];
  for (const k of [0, 1, 2, 3]) held.push(await plant(1, { k }));
  await sessions();
  assert.equal(freeNonces(c), 0, "four accounts, four open sends");
  bad({}, "asset", /^No free nonce account\. Create one first\.$/,
    "a send with no free nonce account is refused");
  const unread = c.balances.nonces;
  c.balances.nonces = null;
  assert.equal(freeNonces(c), null, "unknown while no read shows them");
  assert.equal(formError(c, ok), null, "and then the checker decides");
  c.balances.nonces = unread;
  for (const id of held) data.delete(path(gid, "solsessions/" + id));
  rig.notify();
  await sessions();
  assert.equal(freeNonces(c), 4);
}
step("the form refuses a bad address, this wallet, an amount, the balance, USDC and no nonce");

// ── A read of the nonce accounts that fails leaves the balances and the last count ──
{
  const real = answers.accounts;
  answers.accounts = (args) => {
    if (args.addresses.length === 100) throw new Error("accounts: Helius is not answering.");
    return real(args);
  };
  world.accounts.set(base58(group), account(SOL(2)));
  const kept = c.balances.nonces;
  skew += 31_000;
  draw("solana");
  await waitFor("the balances of a read whose nonce read failed",
    () => c.balances.sol === 2_000_000_000n);
  await waitFor("no read job", () => !t.busy.has("sol:read"));
  answers.accounts = real;
  assert.equal(c.balances.error, "", "a failed read of the nonce accounts is no failed read");
  assert.deepEqual(c.balances.nonces, kept, "the last count stays");
  world.accounts.set(base58(group), account(SOL(1)));
  await readFrom("solana");
  assert.equal(c.balances.sol, 1_000_000_000n);
}
step("a failed read of the nonce accounts leaves the balances and the last count");

// ── Propose from the form: texts next to the fields, one proposal for a double click ──
let first;
{
  const fill = (tab, to, amount) => {
    one(tab, (n) => n.attrs?.id === "sol-plain-to").value = to;
    one(tab, (n) => n.attrs?.id === "sol-plain-amount").value = amount;
  };
  let tab = draw("solana");
  const to = one(tab, (n) => n.attrs?.id === "sol-plain-to");
  assert.ok(to && one(tab, (n) => n.attrs?.id === "sol-plain-amount"),
    "the two fields have ids, so that a redraw keeps what was typed");
  assert.equal(to.attrs["data-key"], "sol-plain-to");
  const before = stored();
  fill(tab, "nope", "0.01");
  await click(mark(tab, "propose"));
  assert.equal(c.form.error?.field, "recipient");
  tab = draw("solana");
  assert.match(text(mark(tab, "error-recipient")), /Solana address of the recipient/);
  assert.equal(mark(tab, "error-recipient").attrs.role, undefined, "the text is no live node");
  assert.equal(one(tab, (n) => n.attrs?.id === "sol-plain-to").attrs["aria-describedby"],
    "sol-plain-to-error", "the field names its note");
  assert.deepEqual(stored(), before, "a bad address proposes nothing");
  fill(tab, RECIPIENT, "9");
  await click(mark(tab, "propose"));
  assert.equal(c.form.error?.field, "amount");
  tab = draw("solana");
  assert.match(text(mark(tab, "error-amount")), /^The balance is 1 SOL\.$/);
  assert.deepEqual(stored(), before, "more than the balance proposes nothing");
  const fieldsOf = (tree) => ["sol-plain-to", "sol-plain-amount"]
    .map((id) => one(tree, (n) => n.attrs?.id === id).value);
  // A redraw of the page sends an input event of its own to each field: the error stays.
  fill(tab, RECIPIENT, "9");
  tab = redraw(tab);
  assert.deepEqual(fieldsOf(tab), [RECIPIENT, "9"], "a redraw keeps what was typed");
  assert.equal(c.form.error?.field, "amount", "and keeps the error of the form");
  assert.match(text(mark(tab, "error-amount")), /^The balance is 1 SOL\.$/);
  one(tab, (n) => n.attrs?.id === "sol-plain-amount").on.input({ isTrusted: true });
  assert.equal(c.form.error, null, "a key in a field clears the note");
  // The read loses the USDC account while USDC is chosen: the asset stays and Propose says why.
  const usdcKept = c.balances.usdc;
  plain.pick("usdc");
  c.balances.usdc = null;
  tab = draw("solana");
  fill(tab, RECIPIENT, "1");
  await click(mark(tab, "propose"));
  assert.equal(c.form.error?.field, "asset");
  tab = draw("solana");
  assert.match(text(mark(tab, "error-asset")), /^Enable USDC first\.$/);
  assert.equal(one(tab, (n) => n.attrs?.id === "sol-plain-amount").attrs["aria-describedby"],
    "sol-plain-asset-error", "the amount, where the focus goes, names the note of the asset");
  assert.deepEqual(stored(), before, "a USDC send with no account proposes nothing");
  c.balances.usdc = usdcKept;
  plain.pick("sol");
  tab = draw("solana");
  fill(tab, RECIPIENT, "0.012");
  const button = mark(tab, "propose");
  const clicks = Promise.all([click(button), click(button)]);
  // The page is drawn again while Zigs writes the proposal: the fields are new nodes.
  const redrawn = redraw(tab);
  assert.deepEqual(fieldsOf(redrawn), [RECIPIENT, "0.012"], "control: the new nodes hold the text");
  const stop = showing(redrawn);
  try {
    await clicks;
  } finally {
    stop();
  }
  await sessions();
  assert.equal(stored().length, before.length + 1, "two clicks, one proposal");
  assert.equal(c.form.error, null);
  assert.deepEqual(fieldsOf(redrawn), ["", ""], "a proposal clears the fields that the page shows");
  [first] = c.sessions;
  assert.deepEqual([first.by, first.status], [1, "collecting"]);
  const intent = hex(sendSolIntent(0, nonceValue(1, 0), recipient, 12_000_000n));
  assert.equal(first.intent, intent, "the typed 0.012 SOL, in base units, at the first nonce");
  // USDC: the form sends the typed amount of the token, 6 decimals.
  plain.pick("usdc");
  const usdc = draw("solana");
  fill(usdc, RECIPIENT, "2.5");
  await click(mark(usdc, "propose"));
  await sessions();
  const token = c.sessions.find((x) => x.id !== first.id);
  assert.equal(token?.intent, hex(sendTokenIntent(1, nonceValue(1, 1), 0, recipient, 2_500_000n)),
    "the typed 2.5 USDC, in base units, at the next nonce");
  assert.equal(text(mark(draw("solana"), "state-" + token.id)), "Your approval",
    "the chip of a USDC send that a device here can approve");
  assert.equal(text(one(mark(draw("solana"), "proposal-" + token.id), (n) => n.tag === "strong")),
    "Send token");
  plain.pick("sol");
  data.delete(path(gid, "solsessions/" + token.id));
  rig.notify();
  await sessions();
}
step("Propose checks the fields, and a double click makes one proposal");

// ── A refusal of the checker through the form: one line, the rules, nothing written ──
{
  const rules = W.plain_rule_list().split("\n").slice(0, 2).map((line) => line.split("\t")[0]);
  const real = c.W;
  c.W = { ...W, plain_check_message: () =>
    "refused\n" + rules.map((id) => `${id}\ta detail of ${id}`).join("\n") };
  const before = stored();
  const tab = draw("solana");
  one(tab, (n) => n.attrs?.id === "sol-plain-to").value = RECIPIENT;
  one(tab, (n) => n.attrs?.id === "sol-plain-amount").value = "0.01";
  const said = [];
  const { host } = c;
  c.host = { ...host, announce: (words) => said.push(words) };
  try {
    await click(mark(tab, "propose"));
  } finally {
    c.host = host;
    c.W = real;
  }
  const refusal = "The checker refused this. Nothing was proposed.";
  assert.deepEqual(said, ["Checking the send…", refusal], "the live region says the refusal");
  assert.deepEqual(stored(), before, "a refusal of the checker writes nothing");
  assert.equal(c.form.error?.review?.kind, "refused", "the form keeps the review of the refusal");
  const shown = redraw(draw("solana"));
  assert.equal(c.form.error?.review?.kind, "refused", "a redraw keeps the refusal");
  assert.equal(text(mark(shown, "send-refused")), "The checker refused this.");
  assert.equal(text(mark(shown, "send-refused")), "The checker refused this.",
    "the form shows the refusal of the checker in one line");
  const why = mark(shown, "send-why");
  assert.deepEqual([why.tag, why.attrs.open], ["details", undefined], "the rules are closed");
  assert.deepEqual(all(why, (n) => n.tag === "li").map((n) => n.attrs["data-sol"]),
    rules.map((id) => "rule-" + id), "and the details element holds each rule");
  assert.match(text(mark(shown, "send-failed")), /Nothing was proposed\.$/);
  assert.equal(live(mark(shown, "send-form")).filter((n) => n.attrs.id !== "sol-plain-saved-hint")
    .length, 0, "the refusal has no live node");
  c.form.error = null;
  // An error of the transport: the live region says its text.
  const real2 = answers.accounts;
  answers.accounts = () => {
    throw new Error("accounts: Helius is not answering.");
  };
  said.length = 0;
  c.host = { ...host, announce: (words) => said.push(words) };
  const again = draw("solana");
  one(again, (n) => n.attrs?.id === "sol-plain-to").value = RECIPIENT;
  one(again, (n) => n.attrs?.id === "sol-plain-amount").value = "0.01";
  try {
    await click(mark(again, "propose"));
  } finally {
    c.host = host;
    answers.accounts = real2;
  }
  assert.ok(c.form.error?.text, "a failed read leaves its text in the form");
  assert.deepEqual(said, ["Checking the send…", c.form.error.text + " Nothing was proposed."]);
  c.form.error = null;
}
step("a refusal of the checker shows one line and its rules in the form, and writes nothing");

// ── The row: a title, a proposer and a chip, and no amount and no recipient ──
{
  const tab = draw("solana");
  const row = mark(tab, "proposal-" + first.id);
  assert.ok(row, "the send has a row");
  assert.equal(text(one(row, (n) => n.tag === "strong")), "Send SOL", "the title of the row");
  const chip = mark(tab, "state-" + first.id);
  assert.deepEqual([text(chip), chip.className], ["Your approval", "badge warn"],
    "the chip of a send that a device here can approve");
  const shown = text(row);
  assert.ok(!shown.includes(RECIPIENT) && !/0\.012|12000000/.test(shown),
    "no recipient and no amount before the review");
  const buttons = all(row, (n) => n.tag === "button");
  assert.deepEqual(buttons.map(text), ["Review as device 1", "Review as device 2",
    "Review as device 3"], "a button for each device that can approve");
  assert.ok(buttons.every((n) => n.attrs["aria-label"].startsWith(text(n))),
    "the name of a button starts with its text");
  assert.equal(live(row).length, 0, "a row has no live node");
  assert.equal(mark(tab, "approve"), undefined, "no Approve before a review");
  assert.equal(text(mark(tab, "nonces")), "Nonce accounts: 4, free: 3.", "one account is in use");
  assert.ok(wordsIn(words(row).join(" ")) <= 6, "a row stays short: " + words(row).join(" "));
}
step("a row shows its title, its proposer and a chip, and no amount and no recipient");

// ── Review shows the lines of the checker for the proposal that the page holds now ──
{
  let tab = draw("solana");
  const review = (tree, seat) =>
    one(tree, (n) => n.attrs?.["data-key"] === reviewKey(first.id, seat));
  await click(review(tab, 2));
  await waitFor("the review", () => c.look?.step === "shown");
  assert.deepEqual([c.look.id, c.look.seat, c.look.ss.id], [first.id, 2, first.id]);
  assert.deepEqual(t.wantFocus, { key: "sol-look-title", force: true });
  tab = draw("solana");
  const cells = mark(tab, "look-rows").kids.map(text);
  const line = (label) => cells[cells.indexOf(label) + 1];
  assert.equal(line("Action"), "Send SOL");
  assert.equal(line("To"), RECIPIENT, "the recipient is the line of the checker");
  assert.match(line("Amount"), /0\.012/, "so is the amount");
  assert.equal(line("Fee payer"), base58(fee(1)));
  assert.match(line("Cost (fee + rent)"), / SOL$/, "the cost in SOL");
  assert.equal(mark(tab, "approve").attrs["aria-label"], "Approve as device 2");
  assert.equal(text(mark(tab, "look-signs")), "Device 2 approves.");
  assert.equal(live(mark(tab, "look-shown")).length, 0, "the review has no live node");
  assert.equal(review(tab, 2), undefined, "the Review buttons of the row wait while it is open");
  assert.equal(review(tab, 3), undefined);
  const approve = mark(tab, "approve");
  const commits = () => [...data.keys()].filter((k) => k.includes("/commits/"));
  const before = commits();
  // The checker gives other lines at the approval than at the review: nothing is approved.
  const real = c.W;
  c.W = { ...W, plain_check_message: (...args) =>
    W.plain_check_message(...args).replace("fee 10000", "fee 10001") };
  await click(approve);
  c.W = real;
  assert.deepEqual(commits(), before, "other lines at the approval: no commit");
  assert.match(c.look.note, /^The lines of the checker changed since you looked\./);
  assert.match(text(mark(draw("solana"), "look-note")), /Review the proposal again\.$/,
    "the screen says why");
  const rewrite = async (fields) => {
    await writeProposal(c, first.id, { ...fields, createdAt: fields.createdAt ?? Date.now() }, 1);
    await waitFor("the new proposal", () => {
      c.refresh();
      const now = c.sessions.find((x) => x.id === first.id);
      return now && now.createdAt === (fields.createdAt ?? now.createdAt)
        && now.message === fields.message;
    });
  };
  const same = { intent: first.intent, message: first.message, feeSig: first.feeSig };
  await rewrite({ ...same, createdAt: first.createdAt + 1 });
  assert.equal(mark(draw("solana"), "approve"), undefined,
    "the same bytes at another time are another proposal: its review is not shown");
  await click(approve);
  assert.deepEqual(commits(), before, "Approve of the old review writes no commit (same bytes)");
  assert.equal(t.banner.text, "Review the proposal first.");
  // The page holds another proposal under this id now: the review is of the old one.
  const other = W.plain_compile_message(
    sendSolIntent(0, nonceValue(1, 0), recipient, 5_000_001n), pinsOf(1));
  const intent = hex(sendSolIntent(0, nonceValue(1, 0), recipient, 5_000_001n));
  await rewrite({ intent, message: hex(other), feeSig: forge(1, other) });
  const again = draw("solana");
  assert.equal(mark(again, "approve"), undefined, "a review of another proposal is not shown");
  assert.ok(review(again, 2), "Review is there again");
  await click(approve);
  assert.deepEqual(commits(), before, "Approve of the old review writes no commit (other bytes)");
  c.look = null;
}
step("Review shows the checker lines of the current proposal, and Approve needs that review");

// ── Approve: the commit, the count of Approvals, and a refusal that has no Approve ──
{
  const seat = 2;
  const only = (seats, run) => {
    const all3 = c.host.localSeats;
    c.host.localSeats = () => seats;
    return run().finally(() => { c.host.localSeats = all3; });
  };
  await sessions();
  const ids = c.sessions.map((s) => s.id);
  assert.equal(t.solPending(), 1, "one proposal waits for a device of this browser");
  assert.deepEqual(t.solPendingRows(), [{ id: first.id, title: "Send SOL", by: 1 }],
    "the rows of the inbox");
  const labelled = built(() => t.walletSections()).find(([id]) => id === "solana");
  assert.equal(labelled[2]?.attrs["aria-label"], "1 to approve", "the badge of the section");
  assert.equal(built(() => t.walletSections()).find(([id]) => id === "approvals")[2]
    ?.attrs["aria-label"], "1 to approve", "and the badge of Approvals");
  await only([seat], async () => {
    const tab = draw("solana");
    await click(one(tab, (n) => n.attrs?.["data-key"] === reviewKey(first.id, seat)));
    await waitFor("the review", () => c.look?.step === "shown");
    await click(mark(draw("solana"), "approve"));
    await waitFor("the commit", () => data.has(path(gid, `solsessions/${first.id}/commits/2`)));
    await waitFor("the screen closes", () => c.look === null);
    await sessions();
    assert.ok(c.commits[first.id][seat], "the page reads the commit of the device");
    assert.equal(t.solPending(), 0, "the device approved: nothing waits for it");
    assert.deepEqual(t.solPendingRows(), []);
    assert.equal(mark(draw("solana"), "approve"), undefined);
  });
  assert.equal(t.solPending(), 1, "the other devices of this browser still can");
  // A non-send session and an ended session are not counted.
  assert.equal(c.sessions.length, ids.length);
  const noSend = { ...c.sessions[0], id: "f".repeat(32), intent: hex(createNonceIntent(0,
    "00".repeat(32))), status: "collecting" };
  const ended = { ...c.sessions[0], id: "e".repeat(32), status: "sent" };
  const counted = (list) => pendingList({ ...c, sessions: list }).length;
  assert.equal(counted([noSend]), 0, "a session that is no send is no approval");
  assert.equal(counted([ended]), 0, "a sent session is no approval");
  assert.equal(counted([{ ...ended, status: "failed" }]), 0, "nor is a failed one");
  assert.equal(counted([{ ...ended, status: "signing" }]), 0, "nor one that signs");
  assert.equal(counted([{ ...ended, status: "collecting", by: 9 }]), 0,
    "nor one whose proposer published no fee address");
  assert.equal(counted([{ ...ended, status: "collecting" }]), 1, "control: a collecting send is");
  assert.equal(pendingList({ ...c, loaded: {} }).length, 0, "nothing counts before the documents");
}
step("Approve writes the commit; the count follows and leaves out what no device can approve");

// ── A refusal: one line, the rules in a closed details element, and no Approve ──
{
  setNonce(1, 1);
  const swapped = W.plain_compile_message(
    sendSolIntent(1, nonceValue(1, 1), OTHER_RECIPIENT, 5_000_000n), pinsOf(1));
  const id = await plant(1, { k: 1, message: swapped });
  await sessions();
  const commits = [...data.keys()].filter((k) => k.includes("/commits/")).length;
  await click(one(draw("solana"), (n) => n.attrs?.["data-key"] === reviewKey(id, 3)));
  await waitFor("the refusal", () => c.look?.step === "stopped");
  assert.equal(c.look.review.kind, "refused");
  const never = async () => { throw new Error("no Worker call"); };
  await assert.rejects(() => approveLooked(c, never, id, 3), /^Error: Review the proposal first\.$/,
    "a refusal cannot be approved by a call");
  await assert.rejects(() => approveLooked(c, never, id, 2), /^Error: Review the proposal first\.$/,
    "nor by another device");
  const tab = draw("solana");
  assert.equal(mark(tab, "approve"), undefined, "a refusal has no Approve");
  assert.equal(mark(tab, "look-rows"), undefined, "and no lines to approve");
  assert.equal(text(mark(tab, "look-refused")), "The checker refused this.", "one line first");
  const why = mark(tab, "look-why");
  assert.equal(why.tag, "details");
  assert.equal(why.attrs.open, undefined, "the rules are closed");
  assert.match(text(why.kids[0]), /^Reasons \(\d+\)$/);
  assert.ok(mark(why, "look-rules") && all(why, (n) => n.tag === "li").length > 0);
  assert.equal(text(mark(tab, "look-close")), "Close");
  assert.equal([...data.keys()].filter((k) => k.includes("/commits/")).length, commits,
    "a refusal writes no commit");
  assert.equal(live(mark(tab, "look-stopped")).length, 0, "the refusal has no live node");
  // Escape closes the screen and gives the focus back to the Review button.
  mark(tab, "look-stopped").on.keydown({ key: "Escape" });
  assert.equal(c.look, null);
  assert.deepEqual(t.wantFocus, { key: reviewKey(id, 3), force: true });
  // A read that fails shows its text, no rules.
  answers.rent = () => { throw new Error("rent: Helius is not answering."); };
  await click(one(draw("solana"), (n) => n.attrs?.["data-key"] === reviewKey(first.id, 3)));
  await waitFor("the failure", () => c.look?.step === "failed");
  answers.rent = ({ space }) => ({ lamports: RENTS[RENT_SPACES.indexOf(space)] });
  const failed = draw("solana");
  assert.match(text(mark(failed, "look-error")), /Helius is not answering/);
  assert.equal(mark(failed, "approve"), undefined);
  c.look = null;
  data.delete(path(gid, "solsessions/" + id));
  rig.notify();
}
step("a refusal has one line, its rules in a details element and no Approve");

// ── Create nonce and Enable USDC wait with a reason when they cannot run ──
{
  const ready = draw("solana");
  assert.equal(mark(ready, "create-nonce").attrs.disabled, undefined, "control: a funded device");
  assert.equal(mark(ready, "step-why"), undefined, "and no reason");
  world.accounts.set(base58(fee(1)), account(0));
  const poor = await readFrom("solana");
  assert.ok(mark(poor, "step-why"), "a fee address with no SOL gives a reason");
  assert.equal(text(mark(poor, "step-why")), "Device 1 has no SOL at its fee address.");
  assert.equal(mark(poor, "create-nonce").attrs.disabled, "", "Create nonce is disabled");
  assert.equal(mark(poor, "create-nonce").attrs["aria-describedby"], "sol-step-why",
    "and names its reason");
  world.accounts.set(base58(fee(1)), account(SOL(5)));
  await readFrom("solana");
  const kept = c.balances.usdc;
  c.balances.usdc = null;
  const { canWriteAs } = c.host;
  c.host.canWriteAs = () => false;
  let keyless;
  try {
    keyless = draw("solana");
  } finally {
    c.host.canWriteAs = canWriteAs;
    c.balances.usdc = kept;
  }
  assert.equal(text(mark(keyless, "step-why")), "This browser holds no Solana key to pay a fee.");
  for (const name of ["create-nonce", "enable-usdc"]) {
    assert.equal(mark(keyless, name).attrs.disabled, "", name + " waits without a key");
  }
  assert.equal(mark(draw("solana"), "step-why"), undefined, "the reason goes with its cause");
}
step("Create nonce and Enable USDC are disabled with a one-line reason");

// ── The chip of each state, the link of a sent send, and the unconfirmed state ──
{
  const FEE_SIG = "cd".repeat(64);
  const txId = base58(FEE_SIG);
  let age = 0;
  const fake = (id, status, extra = {}) => ({ id, by: 1, status, createdAt: Date.now() - ++age,
    intent: hex(sendSolIntent(9, nonceValue(1, 9), recipient, 1n)), message: "ab".repeat(100),
    feeSig: FEE_SIG, ...extra });
  const list = [fake("c0", "collecting"), fake("g0", "signing"), fake("s0", "signed"),
    fake("u0", "signed"), fake("t0", "sent", { outcome: "confirmed", txId }),
    fake("x0", "sent", { outcome: "failed", txId }),
    fake("f0", "failed", { error: "Not sent: no" }),
    fake("p0", "failed", { error: SUPERSEDED })];
  const fails = new Map([["send:u0", 2], ["send:s0", 0]]);
  const none = { ...c.host, localSeats: () => [] };
  const view = (change = {}) => built(() => plainView({ ...c, sessions: list, fails, ...change },
    (fn) => fn, {}));
  const tab = view({ host: none });
  const chip = (id) => [text(mark(tab, "state-" + id)), mark(tab, "state-" + id).className];
  const chipIs = (id, word, tone, why) => assert.deepEqual(chip(id), [word, "badge " + tone], why);
  chipIs("c0", "Waiting for approvals", "plain", "the chip of a collecting send");
  chipIs("g0", "Signing", "info", "the chip of a signing send");
  chipIs("s0", "Signed", "info", "the chip of a signed send with no error");
  chipIs("u0", "May have been sent", "warn", "the chip of a signed send whose step met an error");
  chipIs("t0", "Sent", "ok", "the chip of a sent send");
  chipIs("x0", "Failed on chain", "bad", "the chip of a send that failed on the chain");
  chipIs("f0", "Failed", "bad", "the chip of a failed send");
  chipIs("p0", "Superseded", "plain", "the chip of a superseded send");
  assert.equal(text(mark(view(), "state-c0")), "Your approval",
    "the chip of a send that a device here can approve");
  const link = (id) => mark(tab, "tx-" + id);
  assert.equal(link("t0").attrs.href, "https://explorer.solana.com/tx/" + txId,
    "the link of a sent send is the page of its transaction");
  assert.equal(link("x0").attrs.href, "https://explorer.solana.com/tx/" + txId,
    "so is the link of a send that failed on the chain");
  assert.ok(link("u0"), "an unconfirmed send shows its transaction id");
  assert.equal(link("u0").attrs.href, "https://explorer.solana.com/tx/" + txId,
    "an unconfirmed send shows its transaction id");
  assert.doesNotMatch(link("t0").attrs.href, /cluster=/, "no cluster parameter");
  assert.deepEqual([link("t0").attrs.target, link("t0").attrs.rel],
    ["_blank", "noopener noreferrer"]);
  for (const id of ["c0", "g0", "s0", "f0", "p0"]) {
    assert.equal(link(id), undefined, id + " has no link");
  }
  assert.match(text(mark(tab, "unsure-u0")), /^Not confirmed yet\./);
  assert.equal(mark(tab, "unsure-s0"), undefined, "a signed send with no error says nothing more");
  assert.equal(text(mark(tab, "error-f0")), "Not sent: no", "a failed send shows its text");
  assert.equal(text(mark(tab, "error-p0")), SUPERSEDED);
  assert.equal(mark(tab, "error-t0"), undefined);
  const open = all(tab, (n) => n.tag === "li").length;
  assert.equal(open, list.length, "every send has its row");
  const finished = one(tab, (n) => n.tag === "details");
  assert.match(text(finished.kids[0]), /^Finished \(4\)$/,
    "the ended sends are in a details element");
  assert.equal(finished.attrs.open, undefined);
  assert.equal(all(tab, (n) => n.tag === "li" && n.attrs["data-sol"].startsWith("proposal-"))[0]
    .attrs["data-sol"], "proposal-c0", "the order of the list stays");
  assert.equal(live(mark(tab, "proposals")).length, 0, "no row has a live node");
  assert.ok(!text(mark(tab, "proposals")).includes(RECIPIENT), "no recipient in any row");
  const odd = view({ host: none, sessions: [{ ...fake("n0", "collecting"),
    intent: hex(createNonceIntent(0, "00".repeat(32))) }] });
  assert.equal(mark(odd, "proposals"), undefined, "a session that is no send has no row");
}
step("a row has a chip for each state, a link for a sent send and the unconfirmed state");

// ── The Approvals tab and Overview list the sends of a plain wallet ──
{
  await sessions();
  const tab = draw("approvals");
  assert.match(text(tab), /Solana proposal/);
  assert.match(text(tab), /Send SOL/);
  assert.match(text(tab), /Solana Mainnet · Proposed by/, "the network is Solana Mainnet");
  assert.doesNotMatch(text(tab), /Devnet/, "a plain wallet names no Devnet in Approvals");
  assert.ok(!text(tab).includes(RECIPIENT) && !/0\.012|0\.005/.test(text(tab)),
    "no amount and no recipient before the review");
  assert.match(text(tab), /1 Solana proposal waits for your approval|Awaiting your approval/);
  t.ui.overviewActivity = "pending";
  const overview = draw("overview");
  assert.match(text(overview), /Solana Mainnet · Proposed by/, "Overview lists it too");
  assert.doesNotMatch(text(one(overview, (n) => n.attrs?.id === "overview-approvals")), /Devnet/);
  const shortcut = text(one(overview, (n) => /pending-shortcut/.test(n.className ?? "")));
  assert.match(shortcut, /1 Solana proposal waits for your approval\./);
}
step("Approvals and Overview list the sends that a device of this browser can approve");

// ── Overview: Send and Receive, by the state of the Solana part ──
{
  const tree = draw("overview");
  for (const action of ["Send", "Receive"]) {
    for (const id of ["sol", "usdc"]) {
      assert.equal(choice(tree, action, id).attrs.disabled, undefined, `${action} ${id} works`);
    }
  }
  assert.match(text(choice(tree, "Send", "sol")), /Solana Mainnet · public/);
  assert.match(text(choice(tree, "Receive", "sol")), /Solana Mainnet · shows the address/);
  choice(tree, "Send", "usdc").on.click();
  assert.deepEqual([t.ui.tab, c.form.asset, t.wantFocus?.key], ["solana", "usdc", "sol-send"],
    "Send USDC opens the form with USDC chosen");
  plain.pick("sol");
  const kept = c.balances.usdc;
  c.balances.usdc = null;
  const noUsdc = draw("overview");
  assert.equal(choice(noUsdc, "Send", "usdc").attrs.disabled, "", "no USDC account: no USDC send");
  assert.match(text(choice(noUsdc, "Send", "usdc")), /Enable USDC first/);
  assert.equal(choice(noUsdc, "Receive", "usdc").attrs.disabled, undefined, "but it can receive");
  assert.equal(choice(noUsdc, "Send", "sol").attrs.disabled, undefined);
  c.balances.usdc = kept;
  // A part that is not ready neither sends nor receives, with a short reason.
  const { raw, host } = c;
  const forged = { ...raw.soldone[2], groupKey: "00".repeat(32) };
  c.raw = { ...raw, soldone: { ...raw.soldone, 2: forged } };
  c.host = { ...host, checkIn: () => () => "yes" };
  let differs;
  try {
    differs = draw("overview");
  } finally {
    Object.assign(c, { raw, host });
  }
  for (const action of ["Send", "Receive"]) {
    for (const id of ["sol", "usdc"]) {
      assert.equal(choice(differs, action, id).attrs.disabled, "", `${action} ${id} waits`);
      assert.match(text(choice(differs, action, id)), /Solana keys differ/);
    }
  }
}
step("the Overview choices send and receive when the part is ready, else give a reason");

// ── A status that another device wrote reaches the live region once ──
{
  const said = [];
  const sess = (id, status, extra = {}) => ({ id, by: 3, status, createdAt: Date.now(),
    intent: hex(sendSolIntent(9, nonceValue(1, 9), recipient, 1n)), message: "ab".repeat(100),
    feeSig: "cd".repeat(64), ...extra });
  const here = (list, raw = {}, change = {}) => ({ loaded: { [SESSIONS]: true }, sessWait: 0,
    wait: 0, said: null, sessions: list, raw: { [SESSIONS]: raw },
    host: { localSeats: () => [1, 2], announce: (w) => said.push(w) }, ...change });
  const state = here([sess("a", "collecting")]);
  announceChanges(state);
  assert.deepEqual(said, [], "the first pass only records");
  state.sessions = [sess("a", "signing")];
  state.raw[SESSIONS] = { a: { packageBy: 3 } };
  announceChanges(state);
  assert.deepEqual(said, ["Send SOL: signing started."], "a package of another device");
  announceChanges(state);
  assert.equal(said.length, 1, "and once");
  state.sessions = [sess("a", "signed")];
  state.raw[SESSIONS] = { a: { signedBy: 2 } };
  announceChanges(state);
  assert.equal(said.length, 1, "a status that a device here wrote was said by its step");
  state.sessions = [sess("a", "sent", { outcome: "confirmed" })];
  state.raw[SESSIONS] = { a: { sentBy: 3 } };
  announceChanges(state);
  assert.equal(said.at(-1), "Send SOL: sent and confirmed.");
  state.sessions = [sess("a", "sent", { outcome: "confirmed" }), sess("k", "collecting"),
    sess("m", "collecting", { by: 1 }), sess("q", "signing")];
  announceChanges(state);
  assert.equal(said.at(-1), "New proposal: Send SOL from device 3. It waits for approvals.",
    "a proposal of a device here and a session that was never seen before it signed are not said");
  state.sessions[1] = sess("k", "sent", { outcome: "failed" });
  state.sessions.push(sess("b", "collecting"));
  state.raw[SESSIONS] = { k: { sentBy: 3 } };
  announceChanges(state);
  assert.equal(said.at(-1), "Send SOL: sent, and it failed on the chain. New proposal: Send SOL "
    + "from device 3. It waits for approvals.", "two changes are one text");
  state.sessions[state.sessions.length - 1] = sess("b", "failed", { error: SUPERSEDED });
  state.raw[SESSIONS] = {};
  announceChanges(state);
  assert.equal(said.at(-1), "Send SOL: " + SUPERSEDED, "a failure that no device wrote is said");
  const count = said.length;
  const nonceIntent = hex(createNonceIntent(0, "00".repeat(32)));
  state.sessions = [{ ...sess("z", "collecting"), intent: nonceIntent }];
  announceChanges(state);
  assert.equal(said.length, count, "a session that is no send is not said");
  // While the documents wait for their checks nothing is said and nothing is lost.
  const waiting = here([sess("w", "collecting")], {}, { sessWait: 1 });
  announceChanges(waiting);
  assert.equal(waiting.said, null, "the first pass waits for the checks");
  waiting.sessWait = 0;
  announceChanges(waiting);
  assert.equal(waiting.said.get("w"), "collecting");
  waiting.sessions = [sess("w", "signing")];
  waiting.sessWait = 2;
  announceChanges(waiting);
  waiting.sessWait = 0;
  announceChanges(waiting);
  assert.equal(said.at(-1), "Send SOL: signing started.", "a change that waited is said later");
  assert.deepEqual(here([], {}, { loaded: {} }).said, null);
  const tab = draw("solana");
  assert.equal(live(mark(tab, "proposals")).length, 0, "the list of sends has no live node");
}
step("a status that another device wrote is said once, through the live region");

// ── The reactor of the controller says a proposal of another device ──
{
  const said = [];
  const { host } = c;
  c.host = { ...host, announce: (words) => said.push(words), localSeats: () => [] };
  c.said = null;
  try {
    plain.react();
    assert.deepEqual(said, [], "the first pass of the reactor only records the sends");
    setNonce(1, 5);
    const id = await plant(1, { k: 5 });
    await sessions();
    plain.react();
    assert.deepEqual(said, ["New proposal: Send SOL from device 1. It waits for approvals."],
      "the reactor says a new proposal of another device");
    plain.react();
    assert.equal(said.length, 1, "and says it once");
    data.delete(path(gid, "solsessions/" + id));
    rig.notify();
  } finally {
    c.host = host;
    c.said = null;
  }
}
step("the reactor of the controller says a proposal of another device once");

// ── A wallet without a Solana part, and the book of addresses ──
{
  const src = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
  const book = src("app-recipients.js");
  for (const kind of ["SOL:mainnet:public", "USDC:mainnet:public"]) {
    assert.ok(book.includes(`"${kind}"`), "the Address book offers " + kind);
  }
  const html = src("index.html").replace(/\s+/g, " ");
  assert.match(html, /Shared wallets for Zcash and Solana/);
  const other = await rig.wallet({ name: "No Solana", network: "mainnet" });
  await waitFor("the part is not added", () => t.plainSol.ctl.gid === other
    && t.plainSol.setup()?.status === "not started");
  const tree = draw("overview");
  for (const action of ["Send", "Receive"]) {
    for (const id of ["sol", "usdc"]) {
      assert.equal(choice(tree, action, id).attrs.disabled, "", `${action} ${id} waits`);
      assert.match(text(choice(tree, action, id)), /Add Solana first/);
    }
  }
  assert.equal(t.solPending(), 0, "a wallet without a Solana part has nothing to approve");
  await rig.wallet({ name: "Test" });
  assert.equal(t.solPending(), 0, "a testnet wallet counts as before");
  assert.deepEqual(t.solPendingRows(), []);
}
step("a wallet with no Solana part waits, a testnet wallet counts as before");

console.log("sol-plain-ui: ok");
process.exit(0);
