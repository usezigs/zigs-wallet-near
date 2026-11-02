// Propose and approve a send (S2 SOL, S3 USDC) of the plain wallet (web/sol/plain/propose.js,
// approve.js, sessions.js, control.js) against the real page modules, the real wasm and the rig
// (sol-rig.mjs): three set-up devices, two of three. The Worker is a fake that runs checkCommand
// of guard.js on every call and answers from a table; it knows no simulate, send or confirm, so
// a call to one of them fails the test. It shows: the proposal part holds exactly the keys intent,
// message, feeSig and createdAt, and the fee signature is on the message that the checker
// accepted; the lowest free nonce index; a refusal or an error signs and writes nothing; the
// payer is the published fee key of the proposing seat and never a field of the proposal; the
// nonces are saved before the commit exists, the digest is the plain digest, and a second
// approval never makes new nonces for other bytes; the nonce and the key share are in no document,
// log, call or error text; two seats propose at once on their own nonce accounts; two proposals
// of one seat on one nonce account end the later one with a reason; the plain session is no
// session of the pool; ensureWorker starts one Worker.
// Run: node web/test/sol-plain-sessions.mjs   (Node 26)
import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign as ed25519 } from "node:crypto";
import fs from "node:fs";
import { showable as poolShowable } from "../sol/approve.js";
import { agreement } from "../sol/ceremony.js";
import { COLLECTIONS, base58, keyOfBase58 } from "../sol/docs.js";
import { feeOf, publishedFee } from "../sol/fee.js";
import { decodeIntent } from "../sol/intent.js";
import { beforeFee, isPayment } from "../sol/sessions.js";
import { approvePlain as approveStep, reviewSession as reviewStep } from "../sol/plain/approve.js";
import { attach } from "../sol/plain/control.js";
import { GENESIS, PLAIN_WORKER_POLICY, checkCommand } from "../sol/plain/guard.js";
import {
  bytesOfHex, createNonceIntent, hexOfBytes, indexOfSend, plainPins, sendSolIntent,
  sendTokenIntent,
} from "../sol/plain/intent.js";
import { proposeSend as proposeStep, unitsOf } from "../sol/plain/propose.js";
import { usdcAddress } from "../sol/plain/reads.js";
import { screenRows } from "../sol/plain/review.js";
import {
  ENDED, filterSessions, showable, titleOf, writeProposal,
} from "../sol/plain/sessions.js";
import * as W from "../sol/wasm/sol_wasm.js";
import { loadRig, mainnetConfig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, data, waitFor } = rig;
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;
const hex = (bytes) => Buffer.from(bytes).toString("hex");

// Every text that a step throws or refuses with: a person sees it as a banner or the page logs it.
const errors = [];
const noted = (run) => async (...args) => {
  try {
    const out = await run(...args);
    if (out?.why) errors.push(out.why);
    return out;
  } catch (e) {
    errors.push(String(e?.message ?? e));
    throw e;
  }
};
const approvePlain = noted(approveStep);
const reviewSession = noted(reviewStep);
const proposeSend = noted(proposeStep);

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
const OTHER_RECIPIENT = "66".repeat(32);
const SOL = (n) => String(BigInt(Math.round(n * 1e9)));
const account = (lamports, owner = SYSTEM, bytes = Buffer.alloc(0)) =>
  ({ owner, lamports: String(lamports), executable: false,
    data: Buffer.from(bytes).toString("base64") });
const world = { accounts: new Map(), failing: null, hold: null, initCluster: null };
const calls = [];
const answers = {
  init: ({ cluster }) => ({ cluster: world.initCluster ?? cluster }),
  genesis: () => ({ genesis: GENESIS.mainnet }),
  rent: ({ space }) => ({ lamports: RENTS[RENT_SPACES.indexOf(space)] }),
  accounts: ({ addresses }) => ({ accounts: addresses.map((a) => world.accounts.get(a) ?? null) }),
};
// A call to the Worker. A command that the table does not know fails: no test run, no send.
const call = async (cmd, args = {}) => {
  checkCommand(cmd, args);
  calls.push({ cmd, args: structuredClone(args) });
  if (world.failing === cmd) throw new Error(`${cmd}: Helius is not answering.`);
  if (!answers[cmd]) throw new Error(`the Worker is asked for ${cmd}`);
  await world.hold?.(cmd, args);
  return structuredClone(answers[cmd](args));
};
const ensure = async () => ({ call });
const names = () => calls.map((x) => x.cmd);

// The Worker of the page: a fake class on the same table, for the single flight test.
const made = { policy: 0, config: 0, workers: new Set(), constructed: 0, bad: false };
const gates = { policy: null };
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === "/sol/plain/worker.js") {
    made.policy++;
    await gates.policy;
    const policy = made.bad ? "default-src *" : PLAIN_WORKER_POLICY;
    return new Response("//", { headers: { "content-security-policy": policy } });
  }
  if (String(url) === "/sol/config-mainnet.json") made.config++;
  return rigFetch(url, init);
};
globalThis.Worker = class {
  constructor() {
    made.constructed++;
    made.workers.add(this);
  }
  postMessage({ id, cmd, args }) {
    const reply = (message) => queueMicrotask(() => this.onmessage({ data: { id, ...message } }));
    call(cmd, args).then((result) => reply({ ok: true, result }),
      (e) => reply({ ok: false, error: String(e.message) }));
  }
  terminate() {
    made.workers.delete(this);
  }
};

// ── A mainnet wallet that the server serves, with its three devices set up ──
mainnetConfig.status = 200;
const gid = await rig.wallet({ name: "Sessions", network: "mainnet" });
const plain = await attach(t.solHost());
const c = plain.ctl;
const base = "groups/" + gid;
const pump = async (what, ok) => {
  for (const t0 = Date.now(); !ok();) {
    if (Date.now() - t0 > 60000) throw new Error("timeout: " + what);
    plain.react();
    await sleep(50);
  }
};
plain.open(gid, base);
await waitFor("the documents", () => [...COLLECTIONS, "solsessions"].every((n) => c.loaded[n]),
  15000);
await plain.add();
await pump("agreement", () => agreement(c).state === "agree"
  && [1, 2, 3].every((i) => publishedFee(c, i)));
// The controller of the page follows the same store and now also signs. This test drives its own.
t.plainSol?.close();
const group = agreement(c).done.groupKey;
const fee = (i) => publishedFee(c, i);
const pinsOf = (i) => plainPins(c.wallet, group, fee(i));
const recipient = keyOfBase58(RECIPIENT);
const ata = usdcAddress(c, group);

// The accounts of the nonce, the fee addresses, the group and its USDC.
const nonceValue = (seat, k, gen = 0) =>
  createHash("sha256").update(`nonce ${seat} ${k} ${gen}`).digest("hex");
const nonceAddress = (seat, k) => W.plain_reads(createNonceIntent(k, "00".repeat(32)), pinsOf(seat))
  .split("\n").map((row) => row.split("\t")).find(([role]) => role === "nonce")[2];
const nonceBytes = (value, authority = group) => {
  const bytes = Buffer.alloc(80);
  bytes.writeUInt32LE(1, 0);
  bytes.writeUInt32LE(1, 4);
  Buffer.from(authority, "hex").copy(bytes, 8);
  Buffer.from(value, "hex").copy(bytes, 40);
  bytes.writeBigUInt64LE(5000n, 72);
  return bytes;
};
const setNonce = (seat, k, gen = 0, change = {}) => {
  const bytes = change.bytes ?? nonceBytes(nonceValue(seat, k, gen), change.authority);
  world.accounts.set(nonceAddress(seat, k), account(RENTS[1], change.owner ?? SYSTEM, bytes));
};
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
world.accounts.set(ata, account(RENTS[2], TOKEN_PROGRAM, tokenBytes(100_000_000n)));

// The fee key signs for a forged proposal: the test plays a proposer that signs what it likes.
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const forge = (seat, message) => {
  const seed = Buffer.from(feeOf(c, seat).secret, "hex");
  const key = createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" });
  return ed25519(null, Buffer.from(message), key).toString("hex");
};
{
  const probe = Buffer.from("probe");
  assert.ok(W.sol_fee_verify(fee(1), probe, forge(1, probe)), "control: this is the fee key");
  assert.ok(!W.sol_fee_verify(fee(1), probe, forge(2, probe)), "control: not the key of seat 2");
}

// ── What a person could find of a secret ──
// A secret leaks whole or in part. Any run of 31 hex of it holds one of the windows of 24 hex that
// start at every 8th place. A saved entry has the digest (64 hex, public), the secret nonces and,
// at its end, the commitments, which are public: the windows that lie in them are not secret.
const logs = [];
const announced = [];
c.host.log = (message) => logs.push(String(message));
c.host.announce = (words) => announced.push(words);
const WINDOW = 24;
const windows = (text) => {
  const out = [text.slice(-WINDOW)];
  for (let at = 0; at + WINDOW <= text.length; at += 8) out.push(text.slice(at, at + WINDOW));
  return out;
};
const secrets = (seat) => {
  const share = solOf(seat).keyPackage.signing_share;
  assert.match(share, /^[0-9a-f]{64}$/, "control: the scan has a key share to find");
  const saved = Object.values(solOf(seat).nonces ?? {});
  const hidden = (e) => windows(e.nonces.slice(64)).filter((w) => !e.commitments.includes(w));
  assert.ok(saved.every((e) => typeof e.nonces === "string" && hidden(e).length >= 10),
    "control: the scan has secret nonces to find");
  return [share, feeOf(c, seat).secret, ...saved.map((e) => e.nonces),
    ...[share, feeOf(c, seat).secret].flatMap(windows), ...saved.flatMap(hidden)];
};
const solOf = (seat) => t.sec(gid, seat).sol ?? {};
const leaks = (extra = []) => {
  const where = { calls: JSON.stringify(calls), logs: logs.join("\n"),
    banner: JSON.stringify(t.banner ?? null), documents: JSON.stringify([...data.entries()]),
    state: JSON.stringify([c.sessions, c.commits, c.shares]), extra: extra.join("\n"),
    errors: errors.join("\n"), announced: announced.join("\n") };
  return [1, 2, 3].flatMap((seat) => Object.entries(where)
    .filter(([, text]) => secrets(seat).some((s) => text.includes(s)))
    .map(([name]) => name + " holds a secret of seat " + seat));
};

// The wasm calls that matter, in order, with their arguments.
const events = [];
const spy = (name) => (...args) => {
  events.push({ name, args });
  return W[name](...args);
};
// The fee signature is verified: how many Worker calls and checker runs came before it.
const verifies = [];
const verify = (...args) => {
  verifies.push({ worker: calls.length, checked: count("plain_check_message") });
  return W.sol_fee_verify(...args);
};
c.W = { ...W, plain_check_message: spy("plain_check_message"),
  sol_plain_fee_sign: spy("sol_plain_fee_sign"), sol_nonces: spy("sol_nonces"),
  sol_fee_verify: verify };
const count = (name) => events.filter((e) => e.name === name).length;
rig.hook.before = (p, value) => {
  if (/\/solsessions\/[0-9a-f]{32}$/.test(p)) events.push({ name: "proposal write", path: p });
  if (/\/commits\/\d$/.test(p)) {
    const id = p.split("/").at(-3);
    events.push({ name: "commit write", path: p, saved: solOf(Number(p.at(-1))).nonces?.[id] });
  }
  return value;
};
// The sessions after the signature checks ended (the page checks a new document a moment later).
const sessions = async () => {
  await waitFor("the signature checks", () => {
    c.refresh();
    return c.sessWait === 0 && c.wait === 0;
  }, 10000);
  return c.sessions;
};
// Waits until the page reads the commit of `seat` below the session `id`. A session is watched by
// a pass of the reactor.
const seen = (id, seat) => waitFor(`the commit of seat ${seat}`, () => {
  plain.react();
  return c.commits[id]?.[seat];
}, 10000);
const session = async (id) => (await sessions()).find((s) => s.id === id);
const loaded = (ctl) => [...COLLECTIONS, "solsessions"].every((n) => ctl.loaded[n]);
const stored = () => [...data.keys()].filter((k) => k.includes("/solsessions/")).sort();
// Runs `fn` as the device `seat`: the first ready device of this browser is the proposer.
const asSeat = async (ctl, seat, fn) => {
  const all = ctl.host.localSeats;
  ctl.host.localSeats = () => [seat];
  try {
    return await fn();
  } finally {
    ctl.host.localSeats = all;
  }
};
// A failing deepEqual on a saved entry would print its nonces.
const sameEntry = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const typed = (amount = "0.005", asset = "sol", to = RECIPIENT) =>
  ({ asset, recipient: to, amount });
const reset = () => {
  calls.length = 0;
  events.length = 0;
  verifies.length = 0;
};
const nothingWritten = (before) => {
  assert.deepEqual(stored(), before, "no document was written");
  assert.equal(count("sol_plain_fee_sign"), 0, "nothing was signed");
};

// ── The typed amount, in base units ──
{
  const good = [["1", 9, 1_000_000_000n], ["0.005", 9, 5_000_000n], ["12.5", 6, 12_500_000n],
    ["0.000001", 6, 1n], [" 3 ", 6, 3_000_000n], ["0.000000001", 9, 1n],
    ["18446744073.709551615", 9, 18446744073709551615n], ["007", 6, 7_000_000n]];
  for (const [text, decimals, units] of good) {
    assert.equal(unitsOf(text, decimals), units, `${text} with ${decimals} decimals`);
  }
  const bad = [["0", 9], ["0.0", 9], ["", 6], ["-1", 6], ["1e3", 6], ["1.", 6], [".5", 6],
    ["1,5", 6], ["0.0000001", 6], ["0.0000000001", 9], ["18446744073.709551616", 9],
    ["1.5.2", 9], ["١", 9],
    ["1 000", 9], [null, 9], [undefined, 6], [{}, 6], ["9".repeat(21), 6]];
  for (const [text, decimals] of bad) {
    assert.equal(unitsOf(text, decimals), null, `${JSON.stringify(text)} is no amount`);
  }
}
step("the amount is a whole number of base units: SOL has 9 decimals and USDC 6");

// ── Nothing typed wrongly reaches the Worker, the key or the store ──
{
  const before = stored();
  reset();
  const cases = [
    [typed("1", "btc"), /Choose SOL or USDC/], [typed("1", "constructor"), /Choose SOL or USDC/],
    [typed("1", "__proto__"), /Choose SOL or USDC/],
    [typed("1", "sol", "not an address"), /Solana address of the recipient/],
    [typed("1", "sol", "1".repeat(31)), /Solana address of the recipient/],
    [{ asset: "sol", amount: "1" }, /Solana address of the recipient/],
    [typed("0"), /amount of SOL with at most 9 decimals, for example 0\.005/],
    [typed("0.0000000001"), /at most 9 decimals/],
    [typed("0.0000001", "usdc"), /amount of USDC with at most 6 decimals, for example 12\.5/],
  ];
  for (const [input, pattern] of cases) {
    await assert.rejects(() => proposeSend(c, ensure, input), pattern);
  }
  assert.deepEqual(calls, [], "the Worker was not asked");
  nothingWritten(before);
}
step("a wrong asset, recipient or amount stops before any read");

// ── No nonce account: nothing to propose on ──
{
  const before = stored();
  reset();
  await assert.rejects(() => proposeSend(c, ensure, typed()),
    /^Error: Create a nonce account first\.$/);
  assert.deepEqual(names(), ["accounts"], "one read of the first 100 nonce accounts");
  assert.equal(calls[0].args.addresses.length, 100);
  assert.deepEqual(calls[0].args.addresses.slice(0, 3), [0, 1, 2].map((k) => nonceAddress(1, k)),
    "the addresses are the ones of the wasm, for the fee key of the proposer");
  nothingWritten(before);
}
step("with no nonce account the text says to create one");

// ── Seat 1 proposes S2: the proposal, its signature, the order ──
const ids = {};
{
  for (const k of [0, 1, 2, 3]) setNonce(1, k);
  reset();
  const before = stored();
  const id = await proposeSend(c, ensure, typed());
  ids.s2 = id;
  assert.match(id, /^[0-9a-f]{32}$/);
  const doc = data.get(path(gid, "solsessions/" + id));
  const { by, sig, ...part } = doc;
  assert.deepEqual(Object.keys(part).sort(), ["createdAt", "feeSig", "intent", "message"],
    "the proposal part holds the keys intent, message, feeSig and createdAt and nothing else");
  assert.equal(by, 1, "the proposer signed it");
  assert.equal(typeof sig, "string");
  const intent = sendSolIntent(0, nonceValue(1, 0), recipient, 5_000_000n);
  assert.equal(part.intent, hex(intent), "k 0, the nonce value of the account, the typed amount");
  const message = W.plain_compile_message(intent, pinsOf(1));
  assert.equal(part.message, hex(message), "the compiled message of the same inputs");
  assert.ok(W.sol_fee_verify(fee(1), message, part.feeSig), "the fee signature verifies");
  assert.ok(!W.sol_fee_verify(fee(2), message, part.feeSig), "and is not the signature of seat 2");
  assert.equal(typeof part.createdAt, "number");
  assert.deepEqual(stored(), [...before, "groups/" + gid + "/solsessions/" + id].sort());
  assert.deepEqual(events.map((e) => e.name), ["plain_check_message", "sol_plain_fee_sign",
    "proposal write"], "the checker first, then the key, then the store");
  assert.deepEqual(events[1].args[0], message, "the key signed the message that was checked");
  assert.deepEqual(events[0].args[0], message);
  assert.deepEqual(names(), ["accounts", "genesis", "rent", "rent", "rent", "accounts"],
    "the window of nonce accounts, then the chain of the proposal");
  const rows = W.plain_reads(intent, pinsOf(1)).split("\n").map((r) => r.split("\t")[2]);
  assert.deepEqual(calls.at(-1).args.addresses, rows, "the chain is read at the wasm addresses");
  const [session] = await sessions();
  assert.deepEqual([session.id, session.by, session.status], [id, 1, "collecting"]);
  assert.ok(showable(session) && titleOf(session) === "Send SOL");
  assert.equal(count("sol_nonces"), 0, "a proposal makes no nonces");
  assert.deepEqual(leaks(), []);
}
step("seat 1 proposes S2: exactly four keys, the compiled message, the fee signature");

// ── The lowest free index ──
{
  const k = async (seat, amount = "0.005") => {
    const id = await asSeat(c, seat, () => proposeSend(c, ensure, typed(amount)));
    const ss = (await sessions()).find((s) => s.id === id);
    return [id, indexOfSend(ss.intent), ss.by];
  };
  const second = await k(1, "0.006");
  assert.deepEqual(second.slice(1), [1, 1], "index 0 is held by an open session: the next one");
  ids.second = second[0];
  // Seat 3 has accounts that the group does not control, one of another program, one that is not
  // initialised and one of the wrong size: all are skipped, and k 4 is the first good one.
  setNonce(3, 0, 0, { authority: "77".repeat(32) });
  setNonce(3, 1, 0, { owner: TOKEN_PROGRAM });
  const idle = nonceBytes(nonceValue(3, 2));
  idle.writeUInt32LE(0, 4);
  setNonce(3, 2, 0, { bytes: idle });
  setNonce(3, 3, 0, { bytes: nonceBytes(nonceValue(3, 3)).subarray(0, 79) });
  setNonce(3, 4);
  const third = await k(3).catch((e) => [null, "failed: " + e.message]);
  assert.deepEqual(third.slice(1), [4, 3], "only an initialised account of the group counts");
  ids.third = third[0];
  const before = stored();
  await assert.rejects(() => asSeat(c, 3, () => proposeSend(c, ensure, typed())),
    /Create a nonce account first\./, "the only good account is held: none is free");
  assert.deepEqual(stored(), before);
  // A session that ended gives its index back; a session of another seat holds nothing of seat 1.
  setNonce(2, 0);
  const other = await k(2).catch((e) => [null, "failed: " + e.message]);
  assert.deepEqual(other.slice(1), [0, 2], "the nonce accounts are the ones of the proposing seat");
  ids.seat2 = other[0];
}
step("the lowest index of an initialised account of the group with no open session");

// ── A refusal and an error sign nothing, write nothing and throw the checker text ──
{
  const before = stored();
  reset();
  await assert.rejects(() => proposeSend(c, ensure, typed("5")), (e) => {
    assert.match(e.message, /^The checker refused this: /);
    assert.match(e.message, /the amount is above 0 and at most the balance of the source/);
    return true;
  });
  assert.equal(count("plain_check_message"), 1, "the checker ran");
  nothingWritten(before);
  reset();
  world.failing = "genesis";
  await assert.rejects(() => proposeSend(c, ensure, typed()), /genesis: Helius is not answering\./);
  world.failing = null;
  nothingWritten(before);
  reset();
  world.accounts.set(base58(fee(1)), account(SOL(0.0001)));
  await assert.rejects(() => proposeSend(c, ensure, typed()),
    /the payer holds 0 or at least the rent/);
  world.accounts.set(base58(fee(1)), account(SOL(5)));
  nothingWritten(before);
  reset();
  setNonce(1, 2, 0, { owner: TOKEN_PROGRAM });
  setNonce(1, 3, 0, { owner: TOKEN_PROGRAM });
  await assert.rejects(() => proposeSend(c, ensure, typed()), /Create a nonce account first\./);
  setNonce(1, 2);
  setNonce(1, 3);
  nothingWritten(before);
  assert.deepEqual(leaks(), []);
}
step("a refusal and an error sign nothing and write nothing");

// ── S3: the units are the typed amount at 6 decimals, the recipient the checker line ──
{
  const id = await proposeSend(c, ensure, typed("2.5", "usdc"));
  ids.s3 = id;
  const ss = (await sessions()).find((s) => s.id === id);
  const intent = bytesOfHex(ss.intent);
  assert.equal(indexOfSend(ss.intent), 2, "the next free index");
  assert.equal(ss.intent, hex(sendTokenIntent(2, nonceValue(1, 2), 0, recipient, 2_500_000n)),
    "the intent of the typed USDC amount");
  assert.equal(Buffer.from(intent).readBigUInt64LE(intent.length - 8), 2_500_000n,
    "the units equal the typed amount at 6 decimals");
  assert.equal(titleOf(ss), "Send token");
  const review = await reviewSession(c, ensure, ss, 2);
  assert.ok(review.ok, review.why);
  const lines = Object.fromEntries(review.review.lines.map((l) => [l.name, l.value]));
  assert.equal(lines.recipient, RECIPIENT, "the recipient row is the line of the checker");
  assert.equal(lines.units, "2500000");
  assert.equal(lines.amount, "2.500000");
  assert.equal(lines.symbol, "USDC");
  assert.equal(lines.mint, USDC_MINT);
  assert.deepEqual(review.rows.map((r) => [r.name, r.value]),
    review.review.lines.map((l) => [l.name, l.value]), "the rows are the lines of the checker");
  assert.deepEqual(review.rows, screenRows(review.review));
}
step("S3 for USDC: the units and the rows are the typed amount and the lines of the checker");

// ── Approval: nonces first, then the commitment, at the path and fields of the pool ──
const approvedBy = {};
{
  reset();
  const ss = (await sessions()).find((s) => s.id === ids.s2);
  await approvePlain(c, ensure, ss, 2);
  assert.deepEqual(events.map((e) => e.name), ["plain_check_message", "sol_nonces", "commit write"],
    "the checker, then the nonces, then the commit");
  assert.equal(events[0].args[3].length > 0, true);
  const write = events.at(-1);
  assert.ok(write.saved, "the nonces were in the secret of seat 2 when the commit was written");
  const message = bytesOfHex(ss.message);
  const digest = W.sol_plain_digest(pinsOf(1), message);
  assert.equal(write.saved.digest, digest, "the saved entry is for the plain digest");
  assert.notEqual(digest, W.sol_digest("devnet", message), "which is not the pool digest");
  assert.equal(events[1].args[1], digest, "the nonces are made for that digest");
  const [own, other] = [2, 3].map((i) => JSON.stringify(solOf(i).keyPackage));
  assert.ok(events[1].args[0] === own && own !== other,
    "the nonces come from the key package of the approving seat");
  const doc = data.get(path(gid, `solsessions/${ids.s2}/commits/2`));
  const { by, sig, ...fields } = doc;
  assert.deepEqual(Object.keys(fields).sort(), ["at", "commitments", "digest"], "the pool fields");
  assert.equal(by, 2);
  assert.equal(typeof sig, "string");
  assert.equal(fields.digest, digest);
  assert.deepEqual(fields.commitments, write.saved.commitments, "the saved commitment");
  assert.deepEqual(events[0].args[2], pinsOf(1), "the pins name the fee key of the proposing seat");
  await seen(ids.s2, 2);
  assert.equal(c.commits[ids.s2][2].digest, digest, "the page reads the commit back");
  assert.ok(solOf(2).nonces[ids.s2], "the nonces stay in the secret of seat 2");
  assert.deepEqual(Object.keys(solOf(2).nonces[ids.s2]).sort(),
    ["commitments", "digest", "nonces"]);
  assert.deepEqual(leaks(), [], "the nonces and the key share are in no document, log or call");
  approvedBy.digest = digest;
  approvedBy.entry = write.saved;
  // The same seat again: nothing is made, and the text says why.
  reset();
  await assert.rejects(async () => approvePlain(c, ensure, await session(ids.s2), 2),
    /Device 2 approved this already\./);
  assert.equal(count("sol_nonces"), 0);
  // This browser cannot sign for a seat it does not hold.
  await assert.rejects(() => approvePlain(c, ensure, ss, 4),
    /This browser cannot sign for device 4\./);
  // A second device approves: two commitments of two devices.
  await approvePlain(c, ensure, ss, 3);
  await seen(ids.s2, 3);
  assert.deepEqual(Object.keys(c.commits[ids.s2]).sort(), ["2", "3"]);
  assert.notDeepEqual(c.commits[ids.s2][2].commitments, c.commits[ids.s2][3].commitments);
}
step("approval saves the nonces for the plain digest before the commit is published");

// ── The review: the rows are the lines of the checker, the title is the tag ──
{
  const ss = (await sessions()).find((s) => s.id === ids.second);
  const review = await reviewSession(c, ensure, ss, 3);
  assert.ok(review.ok);
  assert.equal(review.title, "Send SOL");
  assert.equal(review.by, 1);
  assert.equal(review.payer, fee(1), "the payer is the published fee key of the proposing seat");
  assert.deepEqual(review.rows.map((r) => r.value), review.review.lines.map((l) => l.value));
  assert.ok(!JSON.stringify(review.title).includes(RECIPIENT), "the title holds no recipient");
  assert.ok(review.rows.some((r) => r.label === "To" && r.value === RECIPIENT));
  assert.equal(JSON.stringify(review).includes(secrets(3)[0]), false);
}
step("the review shows the lines of the checker and a title from the tag");

// ── A refusal at approval publishes nothing and saves no nonce ──
// A proposer plants a proposal. The fee key signs what the test says (forge); the checker judges.
const forged = (seat, { k, gen = 0, to = recipient, units = 5_000_000n, createdAt, message }) => {
  const intent = sendSolIntent(k, nonceValue(seat, k, gen), to, units);
  const bytes = message ?? W.plain_compile_message(intent, pinsOf(seat));
  return { intent: hex(intent), message: hex(bytes), feeSig: forge(seat, bytes),
    createdAt: createdAt ?? Date.now() };
};
const newId = () => hexOfBytes(crypto.getRandomValues(new Uint8Array(16)));
const plant = async (seat, options, id = newId()) => {
  const fields = forged(seat, options);
  await writeProposal(c, id, fields, seat);
  return { id, fields };
};
const refused = async (seat, id, pattern, why) => {
  const before = { nonces: Object.keys(solOf(seat).nonces ?? {}), commits: stored().length };
  reset();
  await assert.rejects(async () => approvePlain(c, ensure, await session(id), seat), pattern, why);
  assert.equal(count("sol_nonces"), 0, why + ": no nonces were made");
  assert.deepEqual(Object.keys(solOf(seat).nonces ?? {}), before.nonces, why + ": none were saved");
  assert.equal(stored().length, before.commits, why + ": no commit was published");
  assert.equal(data.get(path(gid, `solsessions/${id}/commits/${seat}`)), undefined);
};
{
  setNonce(1, 5);
  const pins = pinsOf(1);
  const other = W.plain_compile_message(
    sendSolIntent(5, nonceValue(1, 5), OTHER_RECIPIENT, 5_000_000n), pins);
  const swapped = await plant(1, { k: 5, message: other });
  await refused(2, swapped.id, /The checker refused this: .*(account table|accounts)/,
    "a message with another recipient");
  reset();
  const review = await reviewSession(c, ensure, await session(swapped.id), 2);
  assert.equal(review.ok, false);
  assert.equal(review.review.kind, "refused");
  assert.deepEqual(review.review.rules.map((r) => r.id), ["plain-key-table", "plain-accounts"],
    "the refusal names the rules of the checker");
  assert.equal(review.rows, undefined, "a refusal shows no rows to approve");
  const text = review.why;
  assert.ok(review.review.rules.every((r) => text.includes(r.statement)), "the text has each rule");
  setNonce(1, 14);
  const amount = W.plain_compile_message(
    sendSolIntent(14, nonceValue(1, 14), recipient, 5_000_001n), pins);
  const richer = await plant(1, { k: 14, message: amount });
  await refused(2, richer.id, /The checker refused this: /, "a message with another amount");
  assert.deepEqual(leaks(), []);
}
step("a refused message publishes nothing and saves no nonce");

// ── The fee signature is checked against the published key of the proposing seat ──
{
  setNonce(1, 6);
  setNonce(3, 5);
  const mine = await plant(1, { k: 6 });
  await writeProposal(c, mine.id, { ...mine.fields, feeSig: "ab".repeat(64) }, 1);
  await refused(2, mine.id, /The fee signature of device 1 does not fit it\./,
    "a random signature");
  assert.deepEqual(calls, [], "a bad fee signature stops the step before the chain is read");
  assert.deepEqual(verifies, [{ worker: 0, checked: 0 }], "the signature is verified first");
  const bytes = bytesOfHex(mine.fields.message);
  await writeProposal(c, mine.id, { ...mine.fields, feeSig: forge(3, bytes) }, 1);
  await refused(2, mine.id, /The fee signature of device 1 does not fit it\./,
    "the signature of the fee key of seat 3 on a proposal of seat 1");
  // Seat 3 writes a proposal whose message names the payer of seat 1, with the signature of seat 1:
  // the payer is the published key of the writer, so the signature does not fit.
  const asThree = { ...mine.fields, feeSig: forge(1, bytes) };
  const id = hexOfBytes(crypto.getRandomValues(new Uint8Array(16)));
  await writeProposal(c, id, asThree, 3);
  await refused(2, id, /The fee signature of device 3 does not fit it\./,
    "a proposal of seat 3 that carries the payer of seat 1");
  // The proposal is valid again: a correct signature passes.
  await writeProposal(c, mine.id, mine.fields, 1);
  const ok = await reviewSession(c, ensure, (await sessions()).find((s) => s.id === mine.id), 2);
  assert.ok(ok.ok, ok.why);
  ids.signed = mine.id;
}
step("the fee signature must be that of the published fee key of the writer");

// ── The payer is never a field of the proposal ──
{
  setNonce(1, 7);
  const p = await plant(1, { k: 7 });
  const doc = data.get(path(gid, "solsessions/" + p.id));
  data.set(path(gid, "solsessions/" + p.id), { ...doc, payer: fee(3), pins: hex(pinsOf(3)) });
  rig.notify();
  const ss = (await sessions()).find((s) => s.id === p.id);
  assert.equal(ss.payer, undefined, "an unsigned field never reaches the session");
  assert.equal(ss.pins, undefined);
  reset();
  const review = await reviewSession(c, ensure, { ...ss, payer: fee(3), pins: hex(pinsOf(3)) }, 2);
  assert.ok(review.ok, review.why);
  assert.equal(review.payer, fee(1), "the payer is the fee key that seat 1 published");
  assert.deepEqual(events[0].args[2], pinsOf(1), "and the checker ran with the pins of that payer");
  assert.notDeepEqual(events[0].args[2], pinsOf(3));
}
step("a proposal that names another payer in a field is ignored");

// ── A second approval of one session never makes new nonces for other bytes ──
{
  setNonce(1, 8);
  const p = await plant(1, { k: 8 });
  const ss = async () => (await sessions()).find((s) => s.id === p.id);
  reset();
  await approvePlain(c, ensure, await ss(), 3);
  const entry = solOf(3).nonces[p.id];
  const rel = path(gid, `solsessions/${p.id}/commits/3`);
  const first = data.get(rel);
  // The publish was lost: the retry publishes the saved commitment and makes nothing.
  data.delete(rel);
  rig.notify();
  await approvePlain(c, ensure, await ss(), 3);
  assert.equal(count("sol_nonces"), 1, "a retry makes no nonces");
  assert.deepEqual(data.get(rel).commitments, first.commitments, "it publishes the saved one");
  assert.ok(sameEntry(solOf(3).nonces[p.id], entry), "the saved entry stays");
  // The proposer writes other bytes into the same session after the lost publish.
  data.delete(rel);
  rig.notify();
  await writeProposal(c, p.id, forged(1, { k: 8, units: 6_000_000n }), 1);
  assert.notEqual((await ss()).message, p.fields.message);
  reset();
  await assert.rejects(async () => approvePlain(c, ensure, await ss(), 3),
    /The saved approval is for other bytes\./);
  assert.equal(count("sol_nonces"), 0, "no new nonces for other bytes");
  assert.ok(sameEntry(solOf(3).nonces[p.id], entry), "the saved nonces are the same");
  assert.equal(data.get(rel), undefined, "and nothing was published");
  assert.deepEqual(leaks(), []);
}
step("a second approval never makes new nonces for a different message");

// ── Two tabs of one seat approve at once: one set of nonces, one commitment ──
{
  const tab = await attach(t.solHost());
  tab.open(gid, base);
  await waitFor("the second tab", () => loaded(tab.ctl));
  tab.ctl.W = c.W;
  const ss = await session(ids.s3);
  reset();
  await Promise.all([approvePlain(c, ensure, ss, 2), approvePlain(tab.ctl, ensure, ss, 2)]);
  assert.equal(count("sol_nonces"), 1, "two tabs make one set of nonces");
  const doc = data.get(path(gid, `solsessions/${ids.s3}/commits/2`));
  assert.deepEqual(doc.commitments, solOf(2).nonces[ids.s3].commitments, "and publish it");
  tab.close();
}
step("two tabs of one seat make one set of nonces");

// ── A nonce that changed on chain is refused at review ──
{
  const ss = (await sessions()).find((s) => s.id === ids.seat2);
  setNonce(2, 0, 1);
  reset();
  const review = await reviewSession(c, ensure, ss, 3);
  assert.equal(review.ok, false);
  assert.ok(review.review.rules.some((r) => r.id === "plain-nonce-account"), "the nonce rule");
  await refused(3, ss.id, /The checker refused this: .*nonce account/, "the nonce value changed");
  setNonce(2, 0, 0);
}
step("a session whose nonce value changed on chain is refused at review");

// ── A proposal that is no send, an unknown payer, a seat without a share, no age limit ──
{
  const ss = (await sessions()).find((s) => s.id === ids.signed);
  // A signed proposal of a tag that is no send is a session of the page, and no one approves it.
  const oddId = newId();
  const odd = { ...forged(1, { k: 31 }), intent: hex(createNonceIntent(0, "00".repeat(32))) };
  await writeProposal(c, oddId, odd, 1);
  await assert.rejects(async () => approvePlain(c, ensure, await session(oddId), 3),
    /not one that this app can show/);
  // A copy that is not the proposal of the page stops the step before any read.
  reset();
  await assert.rejects(() => approvePlain(c, ensure, { ...ss, by: 2 }, 3), /The proposal changed/);
  assert.deepEqual(calls, []);
  const review = await reviewSession(c, ensure, { ...ss, by: 9 }, 3);
  assert.match(review.why, /Device 9 has not published its fee address/);
  const holds = solOf(3);
  await t.putSec(gid, 3, { sol: { ...holds, keyPackage: undefined } });
  await assert.rejects(() => approvePlain(c, ensure, ss, 3),
    /Device 3 holds no Solana key share\./);
  await t.putSec(gid, 3, { sol: holds });
  const old = Date.now;
  Date.now = () => old() + 90 * 24 * 3600 * 1000;
  const aged = await reviewSession(c, ensure, ss, 3);
  Date.now = old;
  assert.ok(aged.ok, "a proposal has no age limit");
}
step("a proposal that is no send, an unknown payer and a seat without a share are refused");

// ── What the page shows of a session: showable and the titles ──
{
  const ss = (await sessions()).find((s) => s.id === ids.signed);
  assert.ok(showable(ss));
  const good = { id: ss.id, intent: ss.intent, message: ss.message, feeSig: ss.feeSig,
    createdAt: ss.createdAt };
  const kinds = {
    "create-nonce": hex(createNonceIntent(0, "00".repeat(32))),
    "enable-token": "10" + "00" + "11".repeat(32),
    cancel: "11" + "00000000" + "22".repeat(32),
    unknown: "ff" + "00".repeat(40),
    "send-sol cut": ss.intent.slice(0, -2),
    "send-sol with a byte more": ss.intent + "00",
    "pool tag": "0a" + "00".repeat(50),
  };
  for (const [what, intent] of Object.entries(kinds)) {
    assert.equal(showable({ ...good, intent }), false, what + " is not shown");
  }
  const bad = {
    "an upper case message": ss.message.toUpperCase(), "an odd message": ss.message + "0",
    "no message": undefined, "a message too long": "00".repeat(1233),
    "a message that is no hex": "zz", "an empty message": "",
    "a list for a message": [ss.message], "a number": 12,
  };
  for (const [what, message] of Object.entries(bad)) {
    assert.equal(showable({ ...good, message }), false, what + " is not shown");
  }
  const fees = [undefined, "ab".repeat(63), "ab".repeat(65), "AB".repeat(64), 5, null, [ss.feeSig]];
  for (const feeSig of fees) {
    assert.equal(showable({ ...good, feeSig }), false, JSON.stringify(feeSig) + " is no signature");
  }
  assert.ok(showable({ ...good, message: "00".repeat(1232) }), "a full packet is shown");
  // The time of a proposal is a whole number of milliseconds, above 0 and not far ahead.
  const now = Date.now();
  for (const createdAt of [1, now, now + 3_600_000]) assert.ok(showable({ ...good, createdAt }));
  const times = [undefined, null, 0, -5, 1.5, "1700000000000", NaN, Infinity, now + 2 * 86_400_000,
    10 ** 13, 2 ** 53, [now]];
  for (const createdAt of times) {
    assert.equal(showable({ ...good, createdAt }), false, String(createdAt) + " is no time");
  }
  // The commits and shares of a session are watched by its id: 1 to 64 word characters or -.
  for (const id of ["a-b_9", "x".repeat(64), "0"]) assert.ok(showable({ ...good, id }), id);
  const badIds = ["", "x".repeat(65), "a.b", "a b", "a/b", "a\n", "é", undefined, null, 7, ["a"],
    "constructor", "__proto__", "toString", "hasOwnProperty"];
  for (const id of badIds) {
    assert.equal(showable({ ...good, id }), false, JSON.stringify(id) + " is no session id");
  }
  assert.equal(showable(undefined), false);
  assert.equal(showable(null), false);
  assert.equal(titleOf({ ...good, intent: kinds["create-nonce"] }), null);
  assert.equal(titleOf(ss), "Send SOL");
}
step("showable needs a send and well formed hex; the title comes from the tag");

// ── The pool never lists a plain session ──
{
  const ss = (await sessions()).find((s) => s.id === ids.signed);
  const s3 = (await sessions()).find((s) => s.id === ids.s3);
  for (const x of [ss, s3]) {
    assert.equal(decodeIntent(x.intent), null, "the pool decoder reads no plain intent");
    assert.equal(poolShowable(x), false, "so the pool shows no plain session");
    assert.equal(isPayment(x), false);
    assert.equal(beforeFee(x), false, "and it is no proposal from before the fee keys");
  }
}
step("the pool controller never lists a plain session");

// ── The reader of the sessions: unsigned fields, bad writers, commits and shares ──
{
  const ss = (await sessions()).find((s) => s.id === ids.signed);
  const id = ss.id;
  const doc = data.get(path(gid, "solsessions/" + id));
  const raw = { solsessions: { [id]: doc, junk: null, odd: 5 }, solcommits: {}, solshares: {} };
  const check = c.host.checkIn(gid);
  // The page checks a signature a moment after it first sees it: a first read says "wait".
  const read = async (document) => {
    let out;
    const bad = [];
    await waitFor("the checks", () => {
      bad.length = 0;
      out = filterSessions(document, check, (what) => bad.push(what));
      return out.wait === 0;
    }, 10000);
    return { ...out, heard: bad };
  };
  const { heard: bad, ...out } = await read(raw);
  assert.deepEqual(out.sessions.map((s) => s.id), [id], "a document with no data is no session");
  assert.equal(bad.length, 2, "and two documents are heard as bad");
  assert.ok(bad.every((what) => what.endsWith(" proposal")));
  const noisy = { ...doc, package: "x", status: "sent", signature: "y", error: "z", id: "other" };
  const extra = (await read({ solsessions: { [id]: noisy } })).sessions[0];
  assert.deepEqual(Object.keys(extra).sort(), ["by", "createdAt", "feeSig", "id", "intent",
    "message", "status"], "only the signed fields, the writer, the id and the status");
  assert.equal(extra.status, "collecting");
  assert.equal(extra.id, id);
  // The page asks one signature check for each (path, writer, signature): a probe that keeps the
  // signature and changes the fields would be asked against the page's own reader of the same key.
  const other = data.get(path(gid, "solsessions/" + ids.s2));
  const changed = await read({ solsessions: { [id]: { ...doc, sig: other.sig } } });
  assert.deepEqual(changed.sessions, [], "a proposal with another signature is no session");
  assert.equal(changed.bad, 1);
  // A commit of a seat that did not write it, and a share, are read by the signature as well.
  const commit = data.get(path(gid, `solsessions/${ids.s2}/commits/2`));
  const stolen = { ...commit, by: 3 };
  const proposal = data.get(path(gid, "solsessions/" + ids.s2));
  const mixed = await read({ solsessions: { [ids.s2]: proposal },
    solcommits: { [ids.s2]: { 2: commit, 3: stolen } }, solshares: { [ids.s2]: { 2: commit } } });
  assert.deepEqual(Object.keys(mixed.commits[ids.s2]), ["2"], "a commit of another writer is out");
  assert.deepEqual(mixed.shares[ids.s2], {}, "so is a share that is not a share of its seat");
  assert.equal(mixed.bad, 2);
}
step("a session is its signed fields, the writer and the id; commits and shares need their writer");

// ── Two seats propose at once: each on its own nonce account, both stand ──
const another = async () => {
  const tab = await attach(t.solHost());
  tab.open(gid, base);
  await waitFor("another browser", () => loaded(tab.ctl));
  tab.ctl.W = c.W;
  return tab;
};
// Holds the first write of a proposal until the second one is about to land: both tabs have read
// the store before either session is in it.
const writesTogether = () => {
  const writes = [];
  let release;
  const both = new Promise((done) => (release = done));
  const old = rig.hook.before;
  rig.hook.before = async (p, value) => {
    if (/\/solsessions\/[0-9a-f]{32}$/.test(p)) {
      writes.push(p);
      if (writes.length === 1) await both;
      else release();
    }
    return old(p, value);
  };
  return () => {
    rig.hook.before = old;
    return writes;
  };
};
{
  const second = await another();
  for (const k of [0, 1, 2, 3]) setNonce(2, k);
  for (const k of [9, 10]) {
    setNonce(1, k);
    setNonce(2, k);
  }
  const done = writesTogether();
  const [a, b] = await Promise.all([
    asSeat(c, 1, () => proposeSend(c, ensure, typed("0.007"))),
    asSeat(second.ctl, 2, () => proposeSend(second.ctl, ensure, typed("0.007"))),
  ]);
  assert.equal(done().length, 2, "both proposals were written");
  const mine = await sessions();
  const [sa, sb] = [a, b].map((id) => mine.find((s) => s.id === id));
  assert.deepEqual([sa.by, sb.by], [1, 2]);
  assert.deepEqual([sa.status, sb.status], ["collecting", "collecting"], "both stand");
  assert.notEqual(sa.intent.slice(10, 74), sb.intent.slice(10, 74), "on two nonce accounts");
  const ra = await reviewSession(c, ensure, sa, 3);
  const rb = await reviewSession(c, ensure, sb, 3);
  assert.ok(ra.ok && rb.ok, "and each one is approvable");
  assert.notEqual(ra.payer, rb.payer, "each with the payer of its writer");
  second.close();
}
step("two seats that propose at once use their own nonce accounts and both stand");

// ── Two tabs of one seat read at once and choose the same index ──
{
  const second = await another();
  for (const k of [20, 21, 22]) setNonce(1, k);
  // Both tabs read the window of nonce accounts before either has written.
  const window = (cmd, args) => cmd === "accounts" && args.addresses.length === 100;
  const together = (hold) => {
    let seenWindows = 0;
    let open;
    const reached = new Promise((done) => (open = done));
    world.hold = async (cmd, args) => {
      if (window(cmd, args)) {
        if (++seenWindows === 2) open();
        await reached;
      }
      await hold?.(cmd);
    };
    return () => seenWindows;
  };
  // The second tab is slow after that: the first proposal is in the store when it comes to write.
  let aWritten;
  const first = new Promise((done) => (aWritten = done));
  let genesis = 0;
  const windows = together(async (cmd) => {
    if (cmd === "genesis" && ++genesis === 2) await first;
  });
  reset();
  const [a, b] = await Promise.all([
    asSeat(c, 1, () => proposeSend(c, ensure, typed("0.008"))).then((id) => (aWritten(), id)),
    asSeat(second.ctl, 1, () => proposeSend(second.ctl, ensure, typed("0.009"))).catch((e) => e),
  ]);
  world.hold = null;
  assert.equal(windows(), 2, "both tabs read the window before either wrote");
  assert.equal(typeof a, "string", "the first tab wrote its proposal");
  assert.ok(b instanceof Error && /Propose it again\./.test(b.message),
    "the other tab saw it before it wrote: " + b);
  assert.equal((await sessions()).filter((s) => s.id === a).length, 1);
  assert.equal(count("sol_plain_fee_sign"), 1, "the tab told to propose again signed nothing");
  // Both writes land: the later one of the two ends with a reason, the earlier one stands.
  together(null);
  const done = writesTogether();
  const [x, y] = await Promise.all([
    asSeat(c, 1, () => proposeSend(c, ensure, typed("0.01"))),
    asSeat(second.ctl, 1, () => proposeSend(second.ctl, ensure, typed("0.011"))),
  ]);
  world.hold = null;
  assert.equal(done().length, 2, "both proposals were written");
  const both = await sessions();
  const pair = [x, y].map((id) => both.find((s) => s.id === id));
  assert.equal(pair[0].intent.slice(2, 74) === pair[1].intent.slice(2, 74), true, "on one nonce");
  const standing = pair.filter((s) => s.status === "collecting");
  const ended = pair.filter((s) => s.status === "failed");
  assert.equal(standing.length, 1, "one stands");
  assert.equal(ended.length, 1, "and the other ends");
  assert.match(ended[0].error, /Propose it again\.$/);
  const order = [...pair].sort((p, q) => p.createdAt - q.createdAt || (p.id < q.id ? -1 : 1));
  assert.equal(standing[0].id, order[0].id, "the earlier one by time, then by id, stands");
  second.close();
}
step("two tabs of one seat on one nonce account: the later proposal ends with a reason");

// ── An approval of the proposal that ends is not lost: it stays with the reason ──
{
  const k = 30;
  setNonce(1, k);
  const late = await plant(1, { k, createdAt: 2000, units: 5_100_000n });
  await sessions();
  plain.react();
  const lateSession = () => c.sessions.find((s) => s.id === late.id);
  await approvePlain(c, ensure, lateSession(), 3);
  await seen(late.id, 3);
  const early = await plant(1, { k, createdAt: 1000, units: 5_200_000n });
  const all = await sessions();
  const [winner, loser] = [early.id, late.id].map((id) => all.find((s) => s.id === id));
  assert.equal(winner.status, "collecting", "the earlier one stands");
  assert.equal(loser.status, "failed", "the later one ends");
  assert.match(loser.error, /Propose it again\.$/);
  assert.ok(c.commits[late.id][3], "the approval of the ended proposal is still there");
  reset();
  await assert.rejects(() => approvePlain(c, ensure, loser, 2), /Propose it again\./);
  assert.equal(count("sol_nonces"), 0, "an ended proposal gets no new nonces");
  // A copy from before the other proposal came still says "collecting": the page counts.
  const stale = { ...loser, status: "collecting", error: undefined };
  await assert.rejects(() => approvePlain(c, ensure, stale, 2), /Propose it again\./,
    "a stale copy of a session that ended");
  assert.equal(count("sol_nonces"), 0, "a stale copy gets no nonces either");
  assert.equal(data.get(path(gid, `solsessions/${late.id}/commits/2`)), undefined);
  assert.equal(data.get(path(gid, `solsessions/${late.id}/commits/2`)), undefined);
  // Ties go by the id, so that every device reaches the same verdict.
  // Two proposals of one time: the smaller id stands, whichever was written first.
  setNonce(1, 40);
  const [small, large] = ["a".repeat(32), "b".repeat(32)];
  await plant(1, { k: 40, createdAt: 1000, units: 5_300_000n }, large);
  await plant(1, { k: 40, createdAt: 1000, units: 5_400_000n }, small);
  const verdicts = Object.fromEntries((await sessions()).map((s) => [s.id, s.status]));
  assert.equal(verdicts[small], "collecting", "of two of one time the smaller id stands");
  assert.equal(verdicts[large], "failed");
  const standing = await reviewSession(c, ensure, await session(small), 2);
  assert.ok(standing.ok, standing.why);
}
step("of two proposals on one nonce account the earlier stands; an approval stays with the reason");

// ── A guard after each await: the same wallet and session when the step goes on ──
{
  setNonce(1, 31);
  const p = await plant(1, { k: 31 });
  const ss = (await sessions()).find((s) => s.id === p.id);
  // The proposer writes other bytes while the device reads the chain.
  let held = false;
  world.hold = async (cmd) => {
    if (cmd !== "genesis" || held) return;
    held = true;
    await writeProposal(c, p.id, forged(1, { k: 31, units: 5_500_000n }), 1);
    await sessions();
  };
  reset();
  await assert.rejects(() => approvePlain(c, ensure, ss, 2),
    /The proposal changed while Zigs checked it\. Nothing was published\./);
  world.hold = null;
  assert.equal(count("sol_nonces"), 0, "no nonces for a proposal that changed");
  assert.equal(solOf(2).nonces?.[p.id], undefined);
  assert.equal(data.get(path(gid, `solsessions/${p.id}/commits/2`)), undefined);
  // The wallet closes while the device reads the chain.
  const tab = await another();
  setNonce(1, 32);
  const q = await plant(1, { k: 32 });
  const sq = (await sessions()).find((s) => s.id === q.id);
  await waitFor("the proposal in the tab", () => {
    tab.ctl.refresh();
    return tab.ctl.sessions.some((x) => x.id === q.id);
  });
  world.hold = async (cmd) => {
    if (cmd === "genesis") tab.close();
  };
  await assert.rejects(() => approvePlain(tab.ctl, ensure, sq, 2),
    /The wallet closed during this step\. Nothing was published\./);
  world.hold = null;
  assert.equal(solOf(2).nonces?.[q.id], undefined, "a closed wallet saves no nonces");
  assert.equal(data.get(path(gid, `solsessions/${q.id}/commits/2`)), undefined);
  // The same for a proposal: nothing is signed or written after the close.
  const again = await another();
  const before = stored();
  reset();
  world.hold = async (cmd) => {
    if (cmd === "genesis") again.close();
  };
  await assert.rejects(() => asSeat(again.ctl, 1, () => proposeSend(again.ctl, ensure, typed())),
    /The wallet closed during this step\./);
  world.hold = null;
  nothingWritten(before);
}
step("a wallet that closes or a proposal that changes during a step stops it before it saves");

// ── Refusals of a session: the id, one more instruction, no cache, the wallet itself ──
// The v1 message (wasm-sol/src/v1.rs): a copy of the last instruction is appended.
const withCopyOfLast = (message) => {
  const buf = Buffer.from(message);
  const [mask, count, keys32] = [buf.readUInt32LE(4), buf[40], buf[41]];
  const configs = (mask & 3 ? 8 : 0) + [4, 8, 16].filter((bit) => mask & bit).length * 4;
  const heads = 42 + 32 * keys32 + configs;
  const payloads = heads + 4 * count;
  const size = (i) => buf[heads + 4 * i + 1] + buf.readUInt16LE(heads + 4 * i + 2);
  const last = payloads + Array.from({ length: count - 1 }, (_, i) => size(i))
    .reduce((a, b) => a + b, 0);
  const out = Buffer.concat([buf.subarray(0, payloads), buf.subarray(heads + 4 * (count - 1),
    payloads), buf.subarray(payloads), buf.subarray(last)]);
  out[40] = count + 1;
  return out;
};
{
  // A session whose id the page cannot watch is shown to no one: its commit could not be read.
  setNonce(1, 42);
  await plant(1, { k: 42 }, "bad.id");
  await refused(2, "bad.id", /not one that this app can show/, "an id outside the pool rule");
  // One more instruction in the message of a proposal: the checker refuses it at approval.
  setNonce(1, 36);
  const intent = sendSolIntent(36, nonceValue(1, 36), recipient, 5_000_000n);
  const longer = withCopyOfLast(W.plain_compile_message(intent, pinsOf(1)));
  const extra = await plant(1, { k: 36, message: longer });
  await refused(2, extra.id, /The checker refused this: /, "one more instruction");
  const counted = await reviewSession(c, ensure, await session(extra.id), 2);
  assert.ok(counted.review.rules.some((r) => r.id === "plain-instruction-count"), "the count rule");
  // Each review reads the chain again: a nonce that changed after a good review is refused.
  setNonce(1, 35);
  const fresh = await plant(1, { k: 35 });
  assert.ok((await reviewSession(c, ensure, await session(fresh.id), 2)).ok, "control: it reviews");
  setNonce(1, 35, 1);
  reset();
  const changed = await reviewSession(c, ensure, await session(fresh.id), 2);
  assert.ok(!changed.ok && changed.review.rules.some((r) => r.id === "plain-nonce-account"),
    "a nonce that changed after a good review is refused");
  assert.ok(names().includes("genesis"), "and the chain was read for that review");
  await refused(2, fresh.id, /The checker refused this: .*nonce account/, "the nonce changed");
  setNonce(1, 35);
  assert.ok((await reviewSession(c, ensure, await session(fresh.id), 2)).ok, "it reviews again");
  // A recipient that is the wallet itself: the checker refuses after the reads, nothing is written.
  setNonce(1, 37);
  const before = stored();
  reset();
  await assert.rejects(() => proposeSend(c, ensure, typed("0.005", "sol", base58(group))),
    /^Error: The checker refused this: the recipient is not the group key/);
  assert.equal(count("plain_check_message"), 1, "the checker ran");
  nothingWritten(before);
  assert.deepEqual(leaks(), []);
}
step("an id outside the rule, one more instruction and a recipient that is the wallet are refused");

// ── A wallet that closes while a document is signed or nonces are saved writes nothing ──
// A tab whose wallet closes when its host has signed a document (`on` is "sign") or when it has
// saved nonces ("save"). It counts the documents that its host signs, and keeps the words it says.
const closing = async (on) => {
  const tab = await another();
  const out = { tab, said: [], signed: 0 };
  tab.ctl.host.announce = (words) => (out.said.push(words), announced.push(words));
  const { signedDoc, putSec } = tab.ctl.host;
  tab.ctl.host.signedDoc = async (...args) => {
    out.signed++;
    const doc = await signedDoc(...args);
    if (on === "sign") tab.close();
    return doc;
  };
  tab.ctl.host.putSec = async (g, seat, patch) => {
    const ok = await putSec(g, seat, patch);
    if (on === "save" && patch.sol?.nonces) tab.close();
    return ok;
  };
  return out;
};
const inTab = async (tab, id) => {
  await waitFor("the proposal in the tab", () => {
    tab.ctl.refresh();
    return tab.ctl.sessions.some((x) => x.id === id);
  });
  return tab.ctl.sessions.find((x) => x.id === id);
};
const keys = () => [...data.keys()].sort();
{
  setNonce(1, 38);
  const p = await plant(1, { k: 38 });
  // The wallet closes while the commit is signed: no document, not even under a null base.
  const { tab, said } = await closing("sign");
  const sp = await inTab(tab, p.id);
  const before = keys();
  await tab.approve(sp, 2);
  assert.deepEqual(keys(), before, "a commit signed for a wallet that closed is not written");
  assert.deepEqual(said, ["Checking the proposal…"], "and 'Approval sent.' is not said");
  assert.equal(t.banner.text, "The wallet closed during this step. Nothing was published.");
  assert.ok(solOf(2).nonces?.[p.id], "the nonces were saved first, so a retry publishes them");
  // The same for a proposal.
  setNonce(1, 39);
  const send = await closing("sign");
  await send.tab.propose(typed("0.013"));
  assert.equal(send.signed, 1, "control: the document was signed");
  assert.deepEqual(keys(), before, "a proposal signed for a wallet that closed is not written");
  assert.deepEqual(send.said, ["Checking the send…",
    "The wallet closed during this step. Nothing was published. Nothing was proposed."],
  "and 'Send proposed.' is not said: the failure is");
  assert.equal(t.banner.text, "The wallet closed during this step. Nothing was published.");
  // The wallet closes between the save of the nonces and the publish: no commit is even signed.
  setNonce(1, 43);
  const q = await plant(1, { k: 43 });
  const save = await closing("save");
  const sq = await inTab(save.tab, q.id);
  await assert.rejects(() => approvePlain(save.tab.ctl, ensure, sq, 2),
    /The wallet closed during this step\. Nothing was published\./);
  assert.equal(save.signed, 0, "no commit is signed after the close");
  assert.ok(solOf(2).nonces?.[q.id], "the nonces were saved");
  assert.equal(data.get(path(gid, `solsessions/${q.id}/commits/2`)), undefined);
  assert.deepEqual(leaks(), []);
}
step("a wallet that closes while a document is signed or the nonces are saved writes nothing");

// ── The wasm text of a failed commitment is not passed on ──
{
  setNonce(1, 33);
  const p = await plant(1, { k: 33 });
  const ss = (await sessions()).find((s) => s.id === p.id);
  const real = c.W;
  const share = JSON.stringify(solOf(3).keyPackage);
  c.W = { ...real, sol_nonces: (keyPackage) => { throw new Error("cannot use " + keyPackage); } };
  await assert.rejects(() => approvePlain(c, ensure, ss, 3), (e) => {
    assert.equal(e.message, "This device could not make its signing commitment.");
    assert.ok(!e.message.includes(share));
    return true;
  });
  c.W = real;
  assert.equal(solOf(3).nonces?.[p.id], undefined, "and nothing is saved");
  assert.deepEqual(leaks(), []);
}
step("an error of the wasm in the commitment shows a fixed text with no key");

// ── The controller: one Worker for any number of callers, and none left after a close ──
{
  const tab = await attach(t.solHost());
  tab.open(gid, base);
  await waitFor("the tab", () => [...COLLECTIONS, "solsessions"].every((n) => tab.ctl.loaded[n]));
  const ss = (await sessions()).find((s) => s.id === ids.signed);
  const [policy, configs, workers] = [made.policy, made.config, made.constructed];
  reset();
  let release;
  gates.policy = new Promise((done) => (release = done));
  const reviews = [tab.review(ss, 2), tab.review(ss, 3), tab.review(ss, 2)];
  await sleep(100);
  assert.equal(made.policy - policy, 1, "three callers during the start ask for the policy once");
  release();
  gates.policy = null;
  const results = await Promise.all(reviews);
  assert.ok(results.every((r) => r.ok), results.map((r) => r.why).join());
  assert.equal(made.constructed - workers, 1, "and start one Worker");
  assert.equal(made.config - configs, 1, "with one request for the config");
  assert.equal(names().filter((n) => n === "init").length, 1, "and one init");
  await tab.review(ss, 2);
  assert.equal(made.constructed - workers, 1, "a later caller gets the same Worker");
  const live = made.workers.size;
  tab.close();
  assert.equal(made.workers.size, live - 1, "a close ends the Worker");
  // A close while the start waits for the policy: the start ends and no Worker is made.
  tab.open(gid, base);
  await waitFor("the reopened tab", () => loaded(tab.ctl));
  gates.policy = new Promise((done) => (release = done));
  const pending = tab.review(ss, 2).catch((e) => e);
  await sleep(100);
  const started = made.constructed;
  tab.close();
  release();
  gates.policy = null;
  const ended = await pending;
  assert.ok(ended instanceof Error, "the step ends with an error: " + JSON.stringify(ended));
  assert.equal(made.constructed, started, "no Worker was made for a wallet that closed");
  assert.equal(made.workers.size, live - 1, "and none is left open");
  // A start that failed is tried again by the next caller.
  tab.open(gid, base);
  await waitFor("the third tab", () => loaded(tab.ctl));
  made.bad = true;
  const failed = await tab.review(ss, 2).catch((e) => e);
  assert.match(failed.message, /did not send the policy of the Solana worker/);
  made.bad = false;
  const retried = await tab.review(ss, 2).catch((e) => e);
  assert.ok(retried.ok, "the next caller starts again: " + (retried.why ?? retried.message));
  assert.equal(made.workers.size, live, "with one Worker");
  tab.close();
  // A Worker whose init names another cluster is closed and not kept. The next caller starts anew.
  tab.open(gid, base);
  await waitFor("the fourth tab", () => loaded(tab.ctl));
  const idle = made.workers.size;
  world.initCluster = "devnet";
  const wrong = await tab.review(ss, 2).catch((e) => e);
  world.initCluster = null;
  assert.match(wrong.message, /answered for another cluster/);
  assert.equal(tab.ctl.worker, null, "a Worker that failed init is not kept");
  assert.equal(made.workers.size, idle, "and it is closed");
  const again = await tab.review(ss, 2);
  assert.ok(again.ok && made.workers.size === idle + 1, "the next caller starts a new Worker");
  tab.close();
}
step("ensureWorker starts one Worker, and a close during the start leaves none");

// ── The actions: one at a time, words for the live region, a banner for a refusal ──
{
  const said = [];
  c.host.announce = (words) => (said.push(words), announced.push(words));
  const before = stored();
  await plain.propose(typed("0"));
  assert.match(t.banner.text, /Enter an amount of SOL with at most 9 decimals/);
  assert.deepEqual(said, ["Checking the send…", t.banner.text + " Nothing was proposed."],
    "a failure says its words as a banner, and once to the live region");
  said.length = 0;
  reset();
  await Promise.all([plain.propose(typed("5")), plain.propose(typed("5"))]);
  assert.equal(count("plain_check_message"), 1, "a double click is one proposal");
  assert.match(t.banner.text, /^The checker refused this: /);
  const refusal = "The checker refused this. Nothing was proposed.";
  assert.deepEqual(said, ["Checking the send…", refusal], "a refusal is said short");
  assert.deepEqual(stored(), before, "a refusal writes nothing");
  said.length = 0;
  await plain.propose(typed("0.012"));
  assert.deepEqual(said, ["Checking the send…", "Send proposed."]);
  assert.equal(stored().length, before.length + 1, "the proposal is in the store");
  said.length = 0;
  const open = (await sessions()).find((x) => x.status === "collecting" && !c.commits[x.id]?.[3]
    && x.by === 1 && x.id !== ids.s2);
  reset();
  await Promise.all([plain.approve(open, 3), plain.approve(open, 3)]);
  assert.deepEqual(said, ["Checking the proposal…", "Approval sent."],
    "a double click is one approval");
  assert.equal(count("sol_nonces"), 1);
  assert.equal(typeof plain.review, "function");
}
step("the controller offers propose, review and approve; the words go to the live region");

// ── The watches of the sessions start with the wallet, end with it and with a session ──
// The host of the tab reports each watch that the tab opens and closes. (The store counts the
// watches of the page controller too, and that one follows every change of the store.)
{
  const prefix = base + "/solsessions";
  const tab = await attach(t.solHost());
  const open = new Set();
  const { sdb } = tab.ctl.host;
  tab.ctl.host.sdb = { ...sdb, collection: (path) => {
    const col = sdb.collection(path);
    const onSnapshot = (...args) => {
      const [entry, stop] = [{ path }, col.onSnapshot(...args)];
      open.add(entry);
      return () => (open.delete(entry), stop());
    };
    return { ...col, onSnapshot };
  } };
  const live = () => [...open].filter((x) => x.path.startsWith(prefix)).length;
  tab.open(gid, base);
  tab.ctl.W = c.W;
  await waitFor("the tab", () => loaded(tab.ctl));
  const watched = async () => {
    await waitFor("the signature checks", () => {
      tab.ctl.refresh();
      return tab.ctl.sessWait === 0 && tab.ctl.wait === 0;
    }, 20000);
    tab.react();
    return live();
  };
  // The sessions that the tab watches: open ones that this app shows (a session with an id that
  // the pool refuses, bad.id, is listed and takes no watch), at most 8 of each proposer.
  const shown = () => tab.ctl.sessions.filter((x) => !ENDED.has(x.status) && showable(x));
  const openOf = (seat) => shown().filter((x) => x.by === seat).length;
  const openSessions = () => [1, 2, 3].reduce((n, seat) => n + Math.min(8, openOf(seat)), 0);
  const byOf = (id) => tab.ctl.sessions.find((x) => x.id === id)?.by;
  const first = await watched();
  assert.ok(tab.ctl.sessions.some((x) => ENDED.has(x.status)), "control: a session has ended");
  assert.ok(tab.ctl.sessions.some((x) => x.id === "bad.id"), "control: a session with a bad id");
  assert.ok(openOf(1) > 8 && openOf(3) < 8, "control: seat 1 has more open sessions than the cap");
  assert.equal(first, 1 + 2 * openSessions(),
    "the collection, and the commits and shares of each open one, at most 8 of a seat");
  // An open session takes two watches. When another proposal ends it, it gives them back.
  await plant(3, { k: 60, createdAt: 2000 });
  assert.equal(await watched(), first + 2, "one more open session: two more watches");
  await plant(3, { k: 60, createdAt: 1000, units: 5_100_000n });
  assert.equal(await watched(), first + 2, "the session that ended gave its two watches back");
  // A proposal that this app cannot show (a date far ahead) is listed and takes no watch.
  const tooNew = await plant(3, { k: 61, createdAt: Date.now() + 3 * 24 * 60 * 60 * 1000 });
  const now = await watched();
  assert.ok(tab.ctl.sessions.some((x) => x.id === tooNew.id), "control: the session is listed");
  assert.equal(now, first + 2, "a proposal that cannot be shown takes no watch");
  // 51 newer sessions of seat 2: the tab watches the newest 8 of them. The older sessions of the
  // other seats keep their watches: one seat cannot take them all.
  const before = [...tab.ctl.watching.keys()].filter((id) => byOf(id) !== 2);
  const newest = [];
  for (let i = 0; i < 51; i++) {
    const options = { k: 100 + i, createdAt: Date.now() + 1000 + i, units: 5_000_000n + BigInt(i) };
    newest.push((await plant(2, options)).id);
  }
  assert.equal(await watched(), 1 + 2 * openSessions(), "at most 8 sessions of one seat");
  const ofSeat = [...tab.ctl.watching.keys()].filter((id) => byOf(id) === 2);
  assert.equal(ofSeat.length, 8, "the tab watches 8 sessions of seat 2, not 53");
  assert.ok(tab.ctl.watching.has(newest[50]) && !tab.ctl.watching.has(newest[0]), "the newest");
  assert.ok(before.length > 8 && before.every((id) => tab.ctl.watching.has(id)),
    "no session of another seat lost its watches");
  tab.close();
  assert.equal(open.size, 0, "a close gives every watch back");
}
step("the watches of the sessions stop with the wallet and with an ended session; 8 a seat");

// ── Nothing leaked at the end ──
assert.deepEqual(leaks(), [], "the nonces and the key shares are nowhere in the open");
for (const name of ["simulate", "send", "confirm", "blockhash"]) {
  assert.ok(!calls.some((x) => x.cmd === name) && !names().includes(name));
}
console.log("sol-plain-sessions: ok");
process.exit(0);
