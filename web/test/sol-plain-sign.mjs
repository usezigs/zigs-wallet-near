// The signing steps of a plain send (web/sol/plain/sign.js, sessions.js, control.js) against the
// real page modules, the real wasm and the rig (sol-rig.mjs): three set-up devices, two of three.
// The Worker is a fake that runs checkCommand of guard.js on every call. Its simulate decodes the
// transaction (the message, then the signatures) and verifies the fee signature and the group
// signature over the message with node:crypto, so one check pins the layout, the id, the
// aggregate and the exact message. It shows: the package comes at two commits and binds them; a
// share is made once (the nonces are gone from the secret before the share document exists, a
// failed publish publishes the same share again); the aggregate verifies; the transaction is the
// message, the fee signature and the group signature; the order is status, simulate, send,
// confirm; a late device finds a landed transaction and sends nothing; a refusal at share time,
// a commitment that the package does not name and three refusals end the session; every other error
// (transport, a hang, a 429, a bad answer, a failed read or write) is no failed try, and a session
// whose transaction landed is never ended; a hung call ends its step; a wallet that closes or a
// session that ends stops a step before the send; the nonces of an ended session are dropped; a
// hostile document stops no device; the pool controller and the plain controller never touch each
// other's sessions; no secret leaves. The fake Worker answers errors as the real one does
// (`Error: <method>: <text>`, worker.js), because the page reads those texts.
// Run: node web/test/sol-plain-sign.mjs   (Node 26)
import assert from "node:assert/strict";
import {
  createHash, createPrivateKey, createPublicKey, sign as signWith, verify as ed25519,
} from "node:crypto";
import fs from "node:fs";
import { agreement } from "../sol/ceremony.js";
import { COLLECTIONS, base58, keyOfBase58 } from "../sol/docs.js";
import { feeOf, publishedFee } from "../sol/fee.js";
import { attach as attachPool } from "../sol/main.js";
import { dropNonces, saveNonces } from "../sol/nonces.js";
import { readSolSession } from "../sol/sessions.js";
import { approvePlain as approveStep } from "../sol/plain/approve.js";
import { attach } from "../sol/plain/control.js";
import { block, settledBlock } from "../sol/plain/direct.js";
import { GENESIS, base58Bytes, checkCommand } from "../sol/plain/guard.js";
import {
  bytesOfHex, createNonceIntent, hexOfBytes, plainPins, sendSolIntent,
} from "../sol/plain/intent.js";
import { proposeSend as proposeStep } from "../sol/plain/propose.js";
import { usdcAddress } from "../sol/plain/reads.js";
import { LIMITS } from "../sol/plain/sign.js";
import { filterSessions, writePart, writeProposal } from "../sol/plain/sessions.js";
import * as W from "../sol/wasm/sol_wasm.js";
import { loadRig, mainnetConfig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, data, waitFor } = rig;
LIMITS.backoff = 60; // the wait after an error with no known result, in ms
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;
const hex = (bytes) => Buffer.from(bytes).toString("hex");

// Every text that a step throws: a person sees it as a banner or the page logs it.
const errors = [];
const noted = (run) => async (...args) => {
  try {
    return await run(...args);
  } catch (e) {
    errors.push(String(e?.message ?? e));
    throw e;
  }
};
const approvePlain = noted(approveStep);
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
const SOL = (n) => String(BigInt(Math.round(n * 1e9)));
const account = (lamports, owner = SYSTEM, bytes = Buffer.alloc(0)) =>
  ({ owner, lamports: String(lamports), executable: false,
    data: Buffer.from(bytes).toString("base64") });
// A public key (32 bytes, hex) as a node key, to verify a signature.
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const nodeKey = (keyHex) =>
  createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(keyHex, "hex")]), format: "der",
    type: "spki" });
const world = {
  accounts: new Map(), failing: null, hold: null,
  landed: new Map(), // base58 signature -> { status, slot }
  passed: new Set(), // the texts of the transactions that passed a simulation
  sims: [], sends: [], sendTimes: [], simError: null, sendError: null, sendLands: true,
  confirmAnswer: null,
  shortAccounts: false,
};
const calls = [];
const FEE_KEYS = {}; // filled when the devices are set up
const GROUP = {};
// What the node does with a transaction: the message, then the signatures (v1). The number of
// signatures is byte 1 of the message. Each signature must verify over the message.
const parts = (tx) => {
  const bytes = Buffer.from(tx, "base64");
  const n = bytes[1];
  const message = bytes.subarray(0, bytes.length - 64 * n);
  const sigs = Array.from({ length: n }, (_, i) => message.length + 64 * i)
    .map((at) => bytes.subarray(at, at + 64));
  return { n, message, sigs };
};
// Which fee key signed first, and whether the group signed second.
function signers({ n, message, sigs }) {
  const fee = Object.entries(FEE_KEYS)
    .find(([, key]) => ed25519(null, message, nodeKey(key), sigs[0]))?.[0];
  const group = n === 2 && ed25519(null, message, nodeKey(GROUP.key), sigs[1]);
  return { feeSigner: fee, groupOk: group, ok: message[0] === 0x81 && fee !== undefined && group };
}
function simulate({ tx }) {
  const found = parts(tx);
  const { ok, ...who } = signers(found);
  world.sims.push({ tx, n: found.n, ...who, message: hex(found.message) });
  const err = ok ? world.simError : '"SignatureFailure"';
  if (!err) world.passed.add(tx);
  return { err: err ?? null, unitsConsumed: null, loadedAccountsDataSize: null, logs: [] };
}
function send({ tx }) {
  if (world.sendError) throw new Error(world.sendError);
  if (!world.passed.has(tx)) throw new Error("send: these bytes did not pass a simulation in 30 s");
  world.sends.push(tx);
  world.sendTimes.push(Date.now());
  const id = base58(hex(parts(tx).sigs[0]));
  if (world.sendLands) world.landed.set(id, { status: "confirmed", slot: "4242", err: null });
  return { signature: id };
}
const unseen = { status: "none", slot: "", err: null };
const answers = {
  init: ({ cluster }) => ({ cluster }),
  genesis: () => ({ genesis: GENESIS.mainnet }),
  rent: ({ space }) => ({ lamports: RENTS[RENT_SPACES.indexOf(space)] }),
  accounts: ({ addresses }) => {
    const list = addresses.map((a) => world.accounts.get(a) ?? null);
    return { accounts: world.shortAccounts ? list.slice(1) : list };
  },
  simulate,
  send,
  status: ({ signatures }) => ({ statuses: signatures.map((s) => world.landed.get(s) ?? unseen) }),
  confirm: ({ signature }) => world.landed.get(signature) ?? world.confirmAnswer
    ?? { status: "unknown", slot: "", err: null },
};
// A call to the Worker. A command that the table does not know fails.
const call = async (cmd, args = {}) => {
  checkCommand(cmd, args);
  calls.push({ cmd, args: structuredClone(args), at: Date.now() });
  if (world.failing === cmd) throw new Error(`${cmd}: Helius is not answering.`);
  if (!answers[cmd]) throw new Error(`the Worker is asked for ${cmd}`);
  await world.hold?.(cmd, args);
  return structuredClone(answers[cmd](args));
};
const ensure = async () => ({ call });
const names = () => calls.map((x) => x.cmd);

// The Worker of the page: a fake class on the same table.
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === "/sol/plain/worker.js") {
    const { PLAIN_WORKER_POLICY } = await import("../sol/plain/guard.js");
    return new Response("//", { headers: { "content-security-policy": PLAIN_WORKER_POLICY } });
  }
  return rigFetch(url, init);
};
globalThis.Worker = class {
  postMessage({ id, cmd, args }) {
    const reply = (message) => queueMicrotask(() => this.onmessage({ data: { id, ...message } }));
    call(cmd, args).then((result) => reply({ ok: true, result }),
      (e) => reply({ ok: false, error: `${e.name}: ${e.message}` }));
  }
  terminate() {}
};

// ── A mainnet wallet that the server serves, with its three devices set up ──
mainnetConfig.status = 200;
const gid = await rig.wallet({ name: "Signing", network: "mainnet" });
const plain = await attach(t.solHost());
const c = plain.ctl;
const base = "groups/" + gid;
const pump = async (what, ok, ms = 20000) => {
  for (const t0 = Date.now(); !ok();) {
    if (Date.now() - t0 > ms) throw new Error("timeout: " + what);
    plain.react();
    await sleep(40);
  }
};
plain.open(gid, base);
await waitFor("the documents", () => [...COLLECTIONS, "solsessions"].every((n) => c.loaded[n]),
  15000);
await plain.add();
await pump("agreement", () => agreement(c).state === "agree"
  && [1, 2, 3].every((i) => publishedFee(c, i)));
// The controller of the page follows the same store. This test drives its own, step by step.
t.plainSol?.close();
const group = agreement(c).done.groupKey;
GROUP.key = group;
for (const i of [1, 2, 3]) FEE_KEYS[i] = publishedFee(c, i);
const fee = (i) => publishedFee(c, i);
const pinsOf = (i) => plainPins(c.wallet, group, fee(i));
const recipient = keyOfBase58(RECIPIENT);

const nonceValue = (seat, k, gen = 0) =>
  createHash("sha256").update(`nonce ${seat} ${k} ${gen}`).digest("hex");
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
const setNonce = (seat, k, gen = 0) => world.accounts.set(nonceAddress(seat, k),
  account(RENTS[1], SYSTEM, nonceBytes(nonceValue(seat, k, gen))));
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
world.accounts.set(usdcAddress(c, group),
  account(RENTS[2], TOKEN_PROGRAM, tokenBytes(100_000_000n)));

// ── What a person could find of a secret ──
const logs = [];
const announced = [];
c.host.log = (message) => logs.push(String(message));
c.host.announce = (words) => announced.push(words);
const solOf = (seat) => t.sec(gid, seat).sol ?? {};
const WINDOW = 24;
const windows = (text) => {
  const out = [text.slice(-WINDOW)];
  for (let at = 0; at + WINDOW <= text.length; at += 8) out.push(text.slice(at, at + WINDOW));
  return out;
};
// Every nonce set that was ever saved: a set that was dropped must not appear anywhere either.
const everSaved = [];
const secrets = (seat) => {
  const share = solOf(seat).keyPackage.signing_share;
  assert.match(share, /^[0-9a-f]{64}$/, "control: the scan has a key share to find");
  const saved = [...Object.values(solOf(seat).nonces ?? {}),
    ...everSaved.filter((e) => e.seat === seat)];
  // The end of a saved entry holds the commitments, which are public: their windows are not secret.
  const hidden = (e) => windows(e.nonces.slice(64)).filter((w) => !e.commitments.includes(w));
  assert.ok(saved.every((e) => hidden(e).length >= 10), "control: the scan has nonces to find");
  return [share, feeOf(c, seat).secret, ...saved.map((e) => e.nonces),
    ...[share, feeOf(c, seat).secret].flatMap(windows), ...saved.flatMap(hidden)];
};
const leaks = () => {
  const where = { calls: JSON.stringify(calls), logs: logs.join("\n"),
    banner: JSON.stringify(t.banner ?? null), documents: JSON.stringify([...data.entries()]),
    state: JSON.stringify([c.sessions, c.commits, c.shares]), errors: errors.join("\n"),
    announced: announced.join("\n") };
  return [1, 2, 3].flatMap((seat) => Object.entries(where)
    .filter(([, text]) => secrets(seat).some((s) => text.includes(s)))
    .map(([name]) => name + " holds a secret of seat " + seat));
};

// The wasm calls that matter, with their arguments.
const events = [];
const spy = (name) => (...args) => {
  events.push({ name, args });
  return W[name](...args);
};
const count = (name) => events.filter((e) => e.name === name).length;
c.W = { ...W, sol_nonces: spy("sol_nonces"), sol_plain_sign_share: spy("sol_plain_sign_share"),
  sol_aggregate: spy("sol_aggregate") };

// Writes the test watches: a handler sees the path and value of a write and may throw.
const writes = [];
const hooks = [];
// What a write is, for the list of writes: its kind, and for a share the secret at that moment.
function writeOf(p, value) {
  const seat = Number(p.at(-1));
  const id = p.split("/").at(-3);
  if (/\/shares\/\d$/.test(p)) {
    const own = solOf(seat);
    return { kind: "share", seat, id, saved: own.nonces?.[id], pending: own.pending?.[id],
      used: own.used ?? {} };
  }
  if (/\/commits\/\d$/.test(p)) return { kind: "commit", seat, id };
  if (!/\/solsessions\/[\w-]+$/.test(p)) return null;
  const added = Object.keys(value).filter((k) => !(k in (data.get(p) ?? {})));
  return { kind: "session", id: p.split("/").at(-1),
    part: ["intent", "package", "signature", "txId", "error"].find((k) => added.includes(k)) };
}
rig.hook.before = async (p, value) => {
  const write = writeOf(p, value);
  if (write) writes.push(write);
  let out = value;
  for (const hook of hooks) out = (await hook(p, out)) ?? out;
  return out;
};
const sessions = async () => {
  await waitFor("the signature checks", () => {
    c.refresh();
    return c.sessWait === 0 && c.wait === 0;
  }, 10000);
  return c.sessions;
};
const session = async (id) => (await sessions()).find((s) => s.id === id);
const typed = (amount = "0.005", asset = "sol", to = RECIPIENT) =>
  ({ asset, recipient: to, amount });
const asSeat = async (ctl, seat, fn) => {
  const all = ctl.host.localSeats;
  ctl.host.localSeats = () => [seat];
  try {
    return await fn();
  } finally {
    ctl.host.localSeats = all;
  }
};
const reset = () => {
  calls.length = 0;
  events.length = 0;
  writes.length = 0;
  announced.length = 0;
  world.sims.length = 0;
  world.sends.length = 0;
  world.sendTimes.length = 0;
  world.simError = world.sendError = world.confirmAnswer = world.hold = null;
  world.sendLands = true;
  world.shortAccounts = false;
  hooks.length = 0;
};
const keep = (seat, id) => {
  const entry = solOf(seat).nonces?.[id];
  if (entry) everSaved.push({ seat, ...entry });
};
// A new send of seat 1, proposed and approved by the seats `approvers`. Each send has a nonce
// account of its own: the one before is gone, so the proposer takes the new one.
let nextK = 0;
async function newSend(approvers, { amount = "0.005", asset = "sol", gen = 0 } = {}) {
  const k = nextK++;
  if (k > 0) world.accounts.delete(nonceAddress(1, k - 1));
  setNonce(1, k, gen);
  const id = await asSeat(c, 1, () => proposeSend(c, ensure, typed(amount, asset)));
  const ss = await session(id);
  for (const seat of approvers) {
    await approvePlain(c, ensure, await session(id), seat);
    keep(seat, id);
  }
  return { id, k, ss };
}
const status = async (id) => (await session(id))?.status;
const becomes = (id, status) => () => c.sessions.find((s) => s.id === id)?.status === status;
const doc = (id, rel = "") => data.get(path(gid, "solsessions/" + id + rel));

// ── S2 end to end: the package, the shares, the aggregate, the send ──
const done = {};
{
  reset();
  const { id, ss } = await newSend([]);
  const message = bytesOfHex(ss.message);
  const digest = W.sol_plain_digest(pinsOf(1), message);
  await approvePlain(c, ensure, await session(id), 2);
  keep(2, id);
  for (let i = 0; i < 6; i++) {
    plain.react();
    await sleep(60);
  }
  assert.equal(doc(id).package, undefined, "one commit is no package");
  assert.equal((await session(id)).status, "collecting");
  reset();
  await approvePlain(c, ensure, await session(id), 3);
  keep(3, id);
  await pump("the session is sent", becomes(id, "sent"));
  const fin = await session(id);
  assert.equal(fin.status, "sent");
  // The package.
  assert.deepEqual(fin.signers, [2, 3], "the two seats that committed");
  assert.equal(fin.digest, digest, "the package names the plain digest of the message");
  assert.deepEqual(JSON.parse(fin.package),
    { 2: c.commits[id][2].commitments, 3: c.commits[id][3].commitments },
    "and the commitments that it uses");
  const order = writes.filter((w) => w.id === id).map((w) => w.kind + (w.part ?? ""));
  assert.deepEqual(order, ["commit", "sessionpackage", "share", "share", "sessionsignature",
    "sessiontxId"], "commit, package, two shares, signed, sent");
  // The shares: the nonces were gone from the secret, and the share waited in it, at the write.
  const shares = writes.filter((w) => w.kind === "share");
  assert.deepEqual(shares.map((w) => w.seat).sort(), [2, 3]);
  for (const w of shares) {
    assert.equal(w.saved, undefined, "the nonces were gone before the share document existed");
    assert.equal(typeof w.pending?.share, "string", "the made share waited in the secret");
    assert.equal(w.used[digest], id, "and the digest was marked used");
    assert.equal(solOf(w.seat).pending?.[id], undefined, "the pending share is forgotten after");
  }
  assert.equal(count("sol_plain_sign_share"), 2, "one share for each signer");
  assert.equal(count("sol_nonces"), 1, "only the approval of seat 3 made nonces, the signing none");
  // The aggregate verifies under the group key, over the exact message.
  assert.match(fin.signature, /^[0-9a-f]{128}$/);
  assert.ok(ed25519(null, message, nodeKey(group), Buffer.from(fin.signature, "hex")),
    "the group signature verifies over the proposal message");
  // The transaction: the message, the fee signature, the group signature.
  const expected = Buffer.concat([message, Buffer.from(fin.feeSig, "hex"),
    Buffer.from(fin.signature, "hex")]).toString("base64");
  assert.deepEqual(world.sends, [expected], "the bytes that were sent");
  assert.equal(world.sims.length, 1);
  const [sim] = world.sims;
  assert.deepEqual([sim.n, sim.feeSigner, sim.groupOk], [2, "1", true]);
  assert.equal(world.sims[0].tx, expected, "the simulation was of the same bytes");
  // The id is the first signature.
  const txId = fin.txId;
  assert.equal(txId, base58(fin.feeSig));
  assert.deepEqual([...base58Bytes(txId)], [...Buffer.from(fin.feeSig, "hex")]);
  assert.deepEqual([fin.outcome, fin.slot], ["confirmed", "4242"]);
  // The order of the Worker commands for the send.
  const sending = names().slice(names().indexOf("status"));
  assert.deepEqual(sending.filter((n) => ["status", "simulate", "send", "confirm"].includes(n)),
    ["status", "simulate", "send", "confirm"],
    "the order of the Worker commands is status, simulate, send, confirm");
  assert.deepEqual(calls.find((x) => x.cmd === "status").args, { signatures: [txId] });
  assert.deepEqual(calls.find((x) => x.cmd === "confirm").args, { signature: txId });
  // The nonces are gone from the secrets, and the words went to the live region.
  for (const seat of [2, 3]) assert.equal(solOf(seat).nonces?.[id], undefined);
  assert.deepEqual(announced, ["Signing started.", "Signature share sent.", "Signature share sent.",
    "Signed by the group.", "Sending the signed transaction…", "Sent and confirmed."],
  "the words for the live region");
  assert.equal(c.signedSeen.has(id), false, "the device of the proposer sends at once");
  assert.deepEqual(leaks(), [], "no nonce, key share or fee secret left the device");
  Object.assign(done, { id, txId, digest });
}
step("S2 end to end: package at two commits, two shares, aggregate, send, sent mark");

// ── A pass after the end makes no second share, no second send and no new package ──
{
  const before = { shares: count("sol_plain_sign_share"), sends: world.sends.length,
    writes: writes.length, calls: calls.length };
  let leases = 0;
  rig.hook.lease = () => {
    leases++;
    return true;
  };
  for (let i = 0; i < 8; i++) {
    plain.react();
    await sleep(40);
  }
  rig.hook.lease = () => true;
  assert.equal(leases, 0, "an ended session takes no lease");
  assert.equal(count("sol_plain_sign_share"), before.shares);
  assert.equal(world.sends.length, before.sends);
  assert.equal(writes.length, before.writes, "nothing was written");
  assert.equal(calls.length, before.calls, "the Worker was not asked");
}
step("a session that is sent is left alone");

// ── A late device: the transaction landed already ──
{
  reset();
  const { id, ss } = await newSend([]);
  world.landed.set(base58(ss.feeSig), { status: "confirmed", slot: "777", err: null });
  await approvePlain(c, ensure, await session(id), 2);
  await approvePlain(c, ensure, await session(id), 3);
  await pump("the session is sent", becomes(id, "sent"));
  assert.equal(names().includes("simulate"), false, "a landed transaction is not simulated");
  assert.equal(names().includes("send"), false, "and not sent");
  assert.equal(names().includes("confirm"), false);
  const fin = await session(id);
  assert.deepEqual([fin.txId, fin.outcome, fin.slot], [base58(fin.feeSig), "confirmed", "777"]);
  // A failed transaction on chain is a landed one: the mark says failed.
  reset();
  const second = await newSend([2, 3]);
  world.landed.set(base58(second.ss.feeSig), { status: "failed", slot: "8", err: '"x"' });
  await pump("sent", becomes(second.id, "sent"));
  assert.equal((await session(second.id)).outcome, "failed");
  assert.equal(names().includes("simulate"), false);
  assert.ok(announced.includes("Sent. It failed on the chain."));
  // A transaction that is seen but not final is waited for, not sent again.
  reset();
  const third = await newSend([2, 3]);
  let polls = 0;
  const final = { status: "confirmed", slot: "9", err: null };
  answers.status = ({ signatures }) => ({
    statuses: signatures.map(() => (polls++ < 1 ? { status: "pending", slot: "9", err: null }
      : unseen)),
  });
  world.landed.set(base58(third.ss.feeSig), final);
  answers.confirm = ({ signature }) => world.landed.get(signature);
  await pump("sent", becomes(third.id, "sent"));
  assert.equal(names().includes("send"), false, "a pending transaction is not sent again");
  assert.ok(names().includes("confirm"));
  answers.status = ({ signatures }) => ({
    statuses: signatures.map((s) => world.landed.get(s) ?? unseen),
  });
  answers.confirm = ({ signature }) => world.landed.get(signature) ?? world.confirmAnswer
    ?? { status: "unknown", slot: "", err: null };
}
step("a late device reads the status first and sends nothing that landed");

// ── S3 for USDC end to end ──
{
  reset();
  const { id, ss } = await newSend([2, 3], { amount: "2.5", asset: "usdc" });
  assert.equal(ss.intent.slice(0, 2), "0f", "the intent of a token send");
  await pump("sent", becomes(id, "sent"));
  const fin = await session(id);
  assert.deepEqual([fin.txId, fin.outcome], [base58(fin.feeSig), "confirmed"]);
  assert.equal(world.sims.length, 1);
  assert.deepEqual([world.sims[0].feeSigner, world.sims[0].groupOk], ["1", true]);
  assert.ok(ed25519(null, bytesOfHex(fin.message), nodeKey(group),
    Buffer.from(fin.signature, "hex")));
  const calledAccounts = calls.filter((x) => x.cmd === "accounts").flatMap((x) => x.args.addresses);
  assert.ok(calledAccounts.includes(usdcAddress(c, group)), "the ata of the group was read");
  assert.deepEqual(leaks(), []);
}
step("S3 for USDC signs, aggregates and sends the same way");

// ── A failed publish publishes the same share again ──
{
  reset();
  const { id } = await newSend([2, 3]);
  let failed = 0;
  let pendingAtFail;
  hooks.push((p) => {
    if (p.endsWith(`${id}/shares/2`) && failed++ === 0) {
      pendingAtFail = solOf(2).pending[id];
      throw new Error("the store is down");
    }
  });
  await pump("the failed publish", () => failed > 0);
  assert.ok(pendingAtFail?.share, "the made share waited in the secret of seat 2");
  assert.equal(solOf(2).nonces?.[id], undefined, "the nonces were gone");
  assert.equal(count("sol_plain_sign_share") >= 1, true);
  await pump("sent", becomes(id, "sent"));
  assert.equal(doc(id, "/shares/2").share, pendingAtFail.share, "the same share was published");
  assert.equal(count("sol_plain_sign_share"), 2, "one share for each signer, none again");
  assert.equal(solOf(2).pending?.[id], undefined);
  assert.deepEqual(leaks(), []);
}
step("a share is made once; a failed publish publishes the same share again");

// ── The shares are combined when all of them are here ──
{
  reset();
  const { id } = await newSend([2, 3]);
  let release;
  const held = new Promise((r) => { release = r; });
  hooks.push((p) => (p.endsWith(`${id}/shares/3`) ? held : undefined));
  await pump("the share of seat 2", () => doc(id, "/shares/2") !== undefined);
  for (let i = 0; i < 8; i++) {
    plain.react();
    await sleep(40);
  }
  assert.equal(count("sol_aggregate"), 0, "no aggregate with a share missing");
  assert.doesNotMatch(JSON.stringify(t.banner ?? ""), /Cannot read|undefined/,
    "no step ran with a share missing");
  assert.equal(await status(id), "signing", "and the session waits");
  release();
  await pump("sent", becomes(id, "sent"));
  assert.equal(count("sol_aggregate") >= 1, true);
  hooks.length = 0;
}
step("the shares are combined only when every signer has published one");

// ── A refusal at share time ends the session with the text of the checker ──
{
  reset();
  const { id, k } = await newSend([2, 3]);
  setNonce(1, k, 9); // another message of this device landed: the nonce moved on
  await pump("the session ends after a refusal at share time", becomes(id, "failed"));
  const fin = await session(id);
  assert.match(fin.error, /^A device did not sign: The checker refused this: /);
  assert.match(fin.error, /nonce/i, "the text names the rule of the nonce account");
  assert.equal(writes.filter((w) => w.kind === "share").length, 0, "no share was published");
  assert.equal(names().includes("simulate"), false, "and nothing was sent");
  for (const seat of [2, 3]) assert.equal(solOf(seat).nonces?.[id], undefined, "nonces dropped");
  assert.equal(count("sol_nonces"), 2, "only the two approvals made nonces");
  assert.ok(announced.some((w) => w.startsWith("Send SOL: A device did not sign")));
  assert.deepEqual(leaks(), []);
}
step("a refusal at share time ends the session with the checker text and drops the nonces");

// ── A commit that the package does not name; a seat never makes new nonces here ──
{
  reset();
  const { id } = await newSend([2]);
  // Another browser that restored seat 2 approves too: its commit overwrites the first one.
  const entry = solOf(2).nonces[id];
  const other = JSON.parse(W.sol_nonces(JSON.stringify(solOf(2).keyPackage), entry.digest));
  assert.notEqual(other.commitments, entry.commitments);
  const rel = `solsessions/${id}/commits/2`;
  const replaced = await c.host.signedDoc(gid, rel, 2,
    { commitments: other.commitments, digest: entry.digest, at: Date.now() });
  await c.host.sdb.doc(base + "/" + rel).set(replaced);
  await approvePlain(c, ensure, await session(id), 3);
  keep(3, id);
  await pump("the session ends after another commitment", becomes(id, "failed"));
  const fin = await session(id);
  assert.match(fin.error, /^A device did not sign: The package has another commitment\.$/);
  assert.equal(solOf(2).nonces?.[id], undefined, "the nonces of seat 2 are dropped");
  assert.equal(doc(id, "/shares/2"), undefined, "seat 2 made no share");
  assert.equal(count("sol_nonces"), 2, "only the two approvals made nonces, the signing none");
  assert.equal(count("sol_plain_sign_share") <= 1, true);
  assert.deepEqual(leaks(), []);
}
step("a commitment that is not the one of the saved nonces ends the session, never new nonces");

// ── A commit that changes after the package: the package differs from the commits ──
{
  reset();
  const { id } = await newSend([2, 3]);
  // Hold the share step of seat 2 and 3 at the chain read, replace the commit of seat 3.
  let release;
  const held = new Promise((r) => { release = r; });
  world.hold = async (cmd) => { if (cmd === "genesis") await held; };
  const reads = () => names().filter((n) => n === "genesis").length;
  const seen = reads(); // the approvals read the chain too: wait for a read after the hold
  await pump("the package", () => doc(id).package !== undefined);
  await pump("a share step reads", () => reads() > seen, 5000);
  const entry = solOf(3).nonces[id];
  const other = JSON.parse(W.sol_nonces(JSON.stringify(solOf(3).keyPackage), entry.digest));
  const rel = `solsessions/${id}/commits/3`;
  await c.host.sdb.doc(base + "/" + rel).set(await c.host.signedDoc(gid, rel, 3,
    { commitments: other.commitments, digest: entry.digest, at: Date.now() }));
  await waitFor("the new commit is here", () => (c.refresh(),
    c.commits[id]?.[3]?.commitments === other.commitments), 5000);
  release();
  await pump("the session ends after a commit changed", becomes(id, "failed"));
  assert.match((await session(id)).error, /The package differs from the commits\./);
  for (const seat of [2, 3]) assert.equal(solOf(seat).nonces?.[id], undefined);
  assert.equal(writes.filter((w) => w.kind === "share").length, 0, "no share was published");
  world.hold = null;
}
step("a share is made only for the commitments that the package names");

// ── A share is not made while a commit of the package cannot be verified here ──
{
  reset();
  const { id } = await newSend([2, 3]);
  let release;
  const held = new Promise((r) => { release = r; });
  world.hold = async (cmd) => { if (cmd === "genesis") await held; };
  const reads = () => names().filter((n) => n === "genesis").length;
  const seen = reads();
  await pump("the package", () => doc(id).package !== undefined);
  await pump("a share step is held at the chain read", () => reads() > seen, 5000);
  const rel = path(gid, `solsessions/${id}/commits/3`);
  const commit = data.get(rel);
  data.delete(rel); // this device cannot verify the commit of seat 3 now
  rig.notify();
  await waitFor("the commit is gone", () => (c.refresh(), !c.commits[id]?.[3]), 5000);
  release();
  for (let i = 0; i < 12; i++) {
    plain.react();
    await sleep(40);
  }
  assert.equal(count("sol_plain_sign_share"), 0, "no share while a commit of the package is gone");
  assert.equal(writes.filter((w) => w.kind === "share").length, 0);
  world.hold = null;
  data.set(rel, commit); // the commit comes back with the next snapshot
  rig.notify();
  await pump("sent", becomes(id, "sent"));
}
step("a share waits until every commit of the package is verified here");

// ── Three seats commit before the package: it names two ──
{
  reset();
  const { id } = await newSend([1, 2, 3]);
  await pump("sent with three commits", becomes(id, "sent"));
  const fin = await session(id);
  assert.deepEqual(fin.signers, [1, 2], "the package names t seats, the lowest ones");
  assert.equal(count("sol_plain_sign_share"), 2);
}
step("the package names t commits when more are here");

// ── A refused share whose failure write fails is written again ──
{
  reset();
  const { id, k } = await newSend([2, 3]);
  let denied = 0;
  hooks.push((p, value) => {
    if (p.endsWith("solsessions/" + id) && "error" in value && denied++ < 2) {
      throw new Error("the store is down");
    }
  });
  setNonce(1, k, 9);
  await pump("the session ends although two writes failed", becomes(id, "failed"));
  assert.ok(denied >= 3, "the end was written again after the failures");
  assert.match((await session(id)).error, /^A device did not sign: /);
  assert.equal(c.refused.has(id), false, "and forgotten once it is read back");
  for (const seat of [2, 3]) assert.equal(solOf(seat).nonces?.[id], undefined);
}
step("a failure that could not be written is written again");

// ── A session that another device ended while this device lands the transaction ──
{
  reset();
  const { id } = await newSend([2, 3]);
  let release;
  const held = new Promise((r) => { release = r; });
  world.hold = async (cmd) => { if (cmd === "confirm") await held; };
  await pump("the wait for the result", () => names().includes("confirm"));
  await writePart(c, id, "failure", { error: "Not sent: ended elsewhere." }, { seat: 3 });
  await pump("the session is failed", becomes(id, "failed"));
  release();
  await pump("a landed send stays landed", becomes(id, "sent"));
  assert.equal(doc(id).txId, base58(doc(id).feeSig), "the sent mark is written");
  assert.equal(world.sends.length, 1);
  world.hold = null;
}
step("a send that landed gets its sent mark although another device ended the session");

// ── Three refusals end the session, unless the transaction is on the chain ──
const sendCalls = () => calls.filter((x) => x.cmd === "send").length;
const statusCalls = () => calls.filter((x) => x.cmd === "status").length;
const REFUSAL = "sendTransaction: RPC error -32002: Transaction simulation failed";
{
  reset();
  const { id } = await newSend([2, 3]);
  world.simError = '"AccountNotFound"';
  await pump("the session ends after three tries", becomes(id, "failed"));
  const fin = await session(id);
  assert.match(fin.error, /^Not sent: The network refused the signed transaction: /);
  assert.equal(calls.filter((x) => x.cmd === "simulate").length, 3, "three tries");
  assert.equal(world.sends.length, 0);
  for (let i = 0; i < 6; i++) {
    plain.react();
    await sleep(40);
  }
  assert.equal(calls.filter((x) => x.cmd === "simulate").length, 3, "and no fourth");
  reset();
  // A refusal of the node at the send counts as well. The page reads the text of the Worker:
  // "Error: sendTransaction: RPC error ..." (worker.js names the RPC method).
  const second = await newSend([2, 3]);
  world.sendError = REFUSAL;
  await pump("the session ends after a refusal of the node", becomes(second.id, "failed"));
  assert.equal(sendCalls(), 3);
  assert.match((await session(second.id)).error, /^Not sent: .*RPC error -32002/);
  // The refusal of the Worker itself (the bytes were not simulated) counts too.
  reset();
  const guarded = await newSend([2, 3]);
  world.passed.clear();
  const realSim = answers.simulate;
  answers.simulate = () => ({ err: null, unitsConsumed: null, loadedAccountsDataSize: null,
    logs: [] });
  await pump("the session ends after the Worker refused", becomes(guarded.id, "failed"));
  assert.match((await session(guarded.id)).error, /^Not sent: .*these bytes did not pass/);
  answers.simulate = realSim;
}
step("three refusals end the session with a text");

// ── The third refusal reads the status first; a landed transaction ends nothing ──
{
  reset();
  const { id, ss } = await newSend([2, 3]);
  const txId = base58(ss.feeSig);
  const real = answers.send;
  answers.send = () => {
    // The third refusal comes while another device lands the same bytes.
    if (sendCalls() === 3) world.landed.set(txId, { status: "confirmed", slot: "31", err: null });
    throw new Error(REFUSAL);
  };
  await pump("sent although the third refusal came late", becomes(id, "sent"));
  assert.equal(sendCalls(), 3, "three refusals");
  assert.equal(doc(id).error, undefined, "no failure part: the transaction is on the chain");
  assert.deepEqual([(await session(id)).slot, (await session(id)).outcome], ["31", "confirmed"]);
  // A status that cannot be read at the third refusal writes no failure either.
  reset();
  const next = await newSend([2, 3]);
  answers.send = () => {
    throw new Error(REFUSAL);
  };
  let looks = 0;
  answers.status = ({ signatures }) => {
    if (sendCalls() >= 3 && looks++ < 3) throw new Error("status: Too many Helius calls.");
    return { statuses: signatures.map((s) => world.landed.get(s) ?? unseen) };
  };
  await pump("three looks fail", () => looks >= 3);
  assert.equal(await status(next.id), "signed", "an unreadable status ends nothing");
  assert.equal(doc(next.id).error, undefined);
  await pump("the session ends once the status shows none", becomes(next.id, "failed"));
  assert.match((await session(next.id)).error, /^Not sent: .*RPC error -32002/);
  answers.send = real;
  answers.status = ({ signatures }) => ({
    statuses: signatures.map((s) => world.landed.get(s) ?? unseen),
  });
}
step("the third refusal ends nothing while the transaction may be on the chain");

// ── The node says that the bytes were processed: the transaction is on the chain ──
{
  reset();
  const { id } = await newSend([2, 3]);
  const real = answers.send;
  answers.send = (args) => {
    real(args);
    throw new Error("sendTransaction: RPC error -32002: This transaction has already been"
      + " processed");
  };
  await pump("sent after already processed", becomes(id, "sent"));
  answers.send = real;
  assert.equal(c.tries.get(id), undefined, "that is no refusal");
  assert.deepEqual([(await session(id)).outcome, (await session(id)).slot], ["confirmed", "4242"]);
  assert.equal(world.sends.length, 1);
}
step("a send that the node already has goes on to the confirm and writes the sent mark");

// ── A send with no known result is no failed try, however many come ──
{
  reset();
  const { id, ss } = await newSend([2, 3]);
  // The send breaks in transport. The node had the bytes and the transaction landed.
  world.sendError = "sendTransaction: the request failed (fetch failed)";
  await pump("the first send", () => names().includes("send"));
  await pump("the announcement", () => announced.some((w) => w.startsWith("Not confirmed yet")),
    5000);
  const txId = base58(ss.feeSig);
  assert.ok(announced.includes(
    `Not confirmed yet: transaction ${txId} may have been sent. Zigs looks again.`),
  "the id and the words 'not confirmed yet' are shown");
  assert.equal(await status(id), "signed", "the session goes on");
  world.landed.set(txId, { status: "confirmed", slot: "55", err: null });
  const sends = sendCalls();
  await pump("sent", becomes(id, "sent"));
  assert.ok(sendCalls() <= sends + 1, "the next pass read the status and sent nothing more");
  world.sendError = null;
  assert.equal((await session(id)).slot, "55");
  // Four transport errors in a row end nothing.
  reset();
  const next = await newSend([2, 3]);
  world.sendError = "sendTransaction: Helius is not answering.";
  await pump("four sends", () => sendCalls() >= 4);
  assert.equal(await status(next.id), "signed", "transport errors are no failed tries");
  assert.equal(c.tries.get(next.id), undefined);
  world.sendError = null;
  await pump("sent", becomes(next.id, "sent"));
  // The wait ends with no answer: unknown is no failure either.
  reset();
  const waits = await newSend([2, 3]);
  world.confirmAnswer = { status: "unknown", slot: "", err: null };
  world.sendLands = false;
  await pump("four waits", () => calls.filter((x) => x.cmd === "confirm").length >= 4);
  assert.equal(await status(waits.id), "signed", "an unknown result is no failed try");
  world.confirmAnswer = null;
  world.sendLands = true;
  await pump("sent", becomes(waits.id, "sent"));
  assert.deepEqual(leaks(), []);
}
step("a transport error after the send and an unknown result are no failed tries");

// ── A send that landed, then the status cannot be read: the session is not ended ──
{
  const saved = { ...LIMITS };
  LIMITS.call = 150;
  for (const fault of ["fails", "hangs"]) {
    reset();
    const { id, ss } = await newSend([2, 3]);
    const real = answers.send;
    answers.send = (args) => {
      real(args); // the node took the bytes, and the answer was lost
      throw new Error("sendTransaction: the request failed (fetch failed)");
    };
    await pump("the first send", () => sendCalls() >= 1);
    answers.send = real;
    if (fault === "fails") world.failing = "status";
    else world.hold = (cmd) => (cmd === "status" ? new Promise(() => {}) : undefined);
    const asked = statusCalls();
    await pump("four looks", () => statusCalls() >= asked + 4);
    assert.equal(await status(id), "signed", "a status that " + fault + " ends nothing");
    assert.equal(doc(id).error, undefined, "and no failure part was written");
    assert.equal(c.tries.get(id), undefined, "and no try was counted");
    assert.ok(world.landed.has(base58(ss.feeSig)), "control: the transaction is on the chain");
    world.failing = world.hold = null;
    await pump("sent", becomes(id, "sent"));
    assert.equal(world.sends.length, 1, "the bytes went out once");
    assert.equal((await session(id)).slot, "4242");
  }
  Object.assign(LIMITS, saved);
}
step("a send that landed is never ended by a status that fails or hangs");

// ── A 429 on the read-only calls is no failed try ──
{
  reset();
  const { id } = await newSend([2, 3]);
  const real = answers.simulate;
  const times = [];
  answers.simulate = () => {
    times.push(Date.now());
    throw new Error("simulate: Too many Helius calls. Wait a minute.");
  };
  await pump("four simulations", () => times.length >= 4);
  const gaps = times.slice(1).map((at, i) => at - times[i]);
  const first = LIMITS.backoff - 5; // a timer may fire a little early
  assert.ok(gaps.every((gap, i) => gap >= first * 2 ** i), "each wait doubles: " + gaps);
  assert.equal(await status(id), "signed", "a 429 on simulate ends nothing");
  assert.equal(doc(id).error, undefined);
  assert.equal(world.sends.length, 0);
  answers.simulate = real;
  await pump("sent", becomes(id, "sent"));
  assert.equal(c.fails.has("send:" + id), false, "a success resets the count");
}
step("a 429 on simulate is no failed try and the step waits longer each time");

// ── An answer of the Worker that is not the status of one transaction ──
{
  const real = answers.status;
  const odd = [[unseen, unseen], [{}], [], [{ status: "weird", slot: "5", err: null }],
    [{ status: "unknown", slot: "", err: null }], [{ status: "confirmed", slot: "", err: null }],
    [{ status: "confirmed", slot: 5, err: null }]];
  for (const list of odd) {
    reset();
    const { id } = await newSend([2, 3]);
    answers.status = () => ({ statuses: list });
    await pump("two looks", () => statusCalls() >= 2);
    assert.equal(await status(id), "signed", "ends nothing: " + JSON.stringify(list));
    assert.equal(doc(id).error, undefined);
    assert.equal(doc(id).txId, undefined, "and writes no sent mark");
    assert.equal(world.sends.length, 0, "nothing was sent");
    assert.equal(c.tries.get(id), undefined, "and no try was counted");
    answers.status = real;
    await pump("sent", becomes(id, "sent"));
  }
  // A confirm that answers a word of its own is refused too: no sent mark with that word.
  reset();
  const { id } = await newSend([2, 3]);
  world.sendLands = false;
  let asked = 0;
  answers.confirm = () => (asked++ < 2 ? { status: "weird", slot: "5", err: null }
    : { status: "pending", slot: "5", err: null });
  await pump("three waits", () => asked >= 3);
  assert.equal(await status(id), "signed");
  assert.equal(doc(id).txId, undefined, "no sent mark for a word that is no result");
  answers.confirm = ({ signature }) => world.landed.get(signature) ?? world.confirmAnswer
    ?? { status: "unknown", slot: "", err: null };
  world.sendLands = true;
  await pump("sent", becomes(id, "sent"));
}
step("a status or confirm answer with another word or no slot is refused and writes no mark");

// ── A hung call ends its step ──
{
  reset();
  const saved = { ...LIMITS };
  LIMITS.call = 150;
  LIMITS.confirm = 150;
  const { id } = await newSend([2, 3]);
  let hung = 0;
  world.hold = (cmd) => (cmd === "status" && hung++ === 0 ? new Promise(() => {}) : undefined);
  await pump("the status call", () => names().includes("status"));
  await pump("the banner", () => JSON.stringify(t.banner ?? "").includes("did not answer status"),
    5000);
  await pump("sent", becomes(id, "sent"));
  assert.ok(calls.filter((x) => x.cmd === "status").length >= 2, "the next pass asked again");
  assert.equal(c.tries.get(id), undefined, "a hang is no failed try");
  // A confirm that hangs after the send: the id is shown, nothing is sent again.
  reset();
  const next = await newSend([2, 3]);
  world.hold = (cmd) => (cmd === "confirm" ? new Promise(() => {}) : undefined);
  await pump("a hung confirm", () => announced.some((w) => w.startsWith("Not confirmed yet")),
    8000);
  assert.equal(await status(next.id), "signed");
  world.hold = null;
  await pump("sent", becomes(next.id, "sent"));
  assert.equal(world.sends.length, 1, "one send");
  Object.assign(LIMITS, saved);
}
step("a Worker call that hangs ends its step and frees its key");

// ── Every step of the controller has the limit, not only the signing ──
{
  reset();
  const saved = { ...LIMITS };
  LIMITS.call = 150;
  setNonce(1, 99);
  world.hold = (cmd) => (cmd === "accounts" ? new Promise(() => {}) : undefined);
  await asSeat(c, 1, () => plain.propose(typed()));
  assert.ok(JSON.stringify(t.banner ?? "").includes("did not answer accounts in time"),
    "a proposal that waits for a hung Worker ends with a text");
  world.hold = null;
  world.accounts.delete(nonceAddress(1, 99));
  Object.assign(LIMITS, saved);
}
step("a proposal through the controller ends when the Worker hangs");

// ── After each await the wallet and the session are the same ──
{
  reset();
  const { id } = await newSend([2, 3]);
  let release;
  const held = new Promise((r) => { release = r; });
  world.hold = async (cmd) => { if (cmd === "simulate") await held; };
  await pump("the simulation", () => names().includes("simulate"));
  // Another device ended the session while the simulation ran.
  await writePart(c, id, "failure", { error: "Ended elsewhere." }, { seat: 3 });
  await pump("the session is failed", becomes(id, "failed"));
  release();
  await sleep(300);
  for (let i = 0; i < 4; i++) {
    plain.react();
    await sleep(40);
  }
  assert.equal(world.sends.length, 0, "a session that ended is not sent");
  assert.equal(doc(id).txId, undefined, "and no sent mark was written");
  reset();
  // The wallet closes while the simulation runs: nothing is sent and nothing is written.
  const next = await newSend([2, 3]);
  let release2;
  const held2 = new Promise((r) => { release2 = r; });
  world.hold = async (cmd) => { if (cmd === "simulate") await held2; };
  await pump("the simulation", () => names().includes("simulate"));
  plain.close();
  release2();
  await sleep(300);
  assert.equal(world.sends.length, 0, "a wallet that closed sends nothing");
  assert.equal(doc(next.id).txId, undefined);
  plain.open(gid, base);
  await waitFor("the documents", () => [...COLLECTIONS, "solsessions"].every((n) => c.loaded[n]),
    15000);
  world.hold = null;
  await pump("sent", becomes(next.id, "sent"));
  assert.equal(world.sends.length, 1);
}
step("a session that ended or a wallet that closed stops the step before the send");

// ── The proposer sends first; a device that does not hold it waits ──
{
  reset();
  const saved = { ...LIMITS };
  LIMITS.fallback = 700;
  const { id } = await newSend([2, 3]);
  const seats = c.host.localSeats;
  c.host.localSeats = () => [2, 3];
  await pump("signed", becomes(id, "signed"));
  for (let i = 0; i < 5; i++) {
    plain.react();
    await sleep(50);
  }
  assert.equal(world.sends.length, 0, "a device that is not the proposer waits");
  await pump("sent", becomes(id, "sent"));
  const first = c.signedSeen.get(id).at;
  assert.ok(world.sendTimes[0] - first >= 650, "and sends after the wait");
  assert.equal(doc(id).sentBy, 2, "the first device of this browser wrote the sent mark");
  c.host.localSeats = seats;
  Object.assign(LIMITS, saved);
  assert.deepEqual(leaks(), []);
}
step("the proposer sends first and another device sends after a wait");

// ── The pool controller and the plain controller keep apart ──
{
  reset();
  const pool = await attachPool(t.solHost());
  pool.open(gid, base);
  assert.equal(pool.ctl.gid, null, "the pool controller opens no mainnet wallet");
  const before = { writes: data.size, calls: calls.length };
  pool.react();
  await sleep(100);
  assert.deepEqual([data.size, calls.length], [before.writes, before.calls]);
  // A session in the shape of the pool, with a failure part and nonces under its id.
  const id = hexOfBytes(crypto.getRandomValues(new Uint8Array(16)));
  const poolIntent = "0a" + "00".repeat(50);
  const fields = { intent: poolIntent, message: "00".repeat(120), feeSig: "ab".repeat(64),
    createdAt: Date.now() };
  await writeProposal(c, id, fields, 1);
  await writePart(c, id, "failure", { error: "Ended." }, { seat: 1 });
  await saveNonces(c, 2, id, { digest: "00".repeat(32), nonces: "00".repeat(32) + "11".repeat(80),
    commitments: "22".repeat(40) });
  assert.ok(solOf(2).nonces[id], "control: the nonces are saved");
  const writesBefore = data.size;
  for (let i = 0; i < 6; i++) {
    plain.react();
    await sleep(40);
  }
  assert.ok(solOf(2).nonces[id], "the plain reactor keeps the nonces of a session it cannot show");
  assert.equal(data.size, writesBefore, "and writes nothing for it");
  assert.equal(calls.length, before.calls, "and asks the Worker nothing");
  await dropNonces(c, 2, id);
  pool.close();
}
step("the pool controller opens no plain wallet and the plain reactor leaves other sessions alone");

// ── The nonces of an ended session are dropped; one that a sent session used ends ──
{
  reset();
  const { id } = await newSend([2]);
  assert.ok(solOf(2).nonces[id]);
  await writePart(c, id, "failure", { error: "Ended elsewhere." }, { seat: 3 });
  await pump("the nonces of an ended session are dropped",
    () => solOf(2).nonces?.[id] === undefined);
  // A proposal on the account of a send that landed ends at once (no RPC): it is read from the
  // signed documents only.
  const sentSession = (await sessions()).find((s) => s.id === done.id);
  const k = Number(Buffer.from(bytesOfHex(sentSession.intent).subarray(1, 5)).readUInt32LE(0));
  const plant = hexOfBytes(crypto.getRandomValues(new Uint8Array(16)));
  const intent = sendSolIntent(k, nonceValue(1, k), recipient, 5_000_001n);
  const message = W.plain_compile_message(intent, pinsOf(1));
  const key = createPrivateKey({ key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(feeOf(c, 1).secret, "hex")]), format: "der", type: "pkcs8" });
  await writeProposal(c, plant, { intent: hex(intent), message: hex(message),
    feeSig: signWith(null, Buffer.from(message), key).toString("hex"), createdAt: Date.now() }, 1);
  const late = await session(plant);
  assert.equal(late.status, "failed", "a proposal on the account of a send that landed ends");
  assert.match(late.error, /^Another send on the same nonce account landed first/);
  // After the send the nonce moved on: a proposal on the same index with the new value stands.
  const next = hexOfBytes(crypto.getRandomValues(new Uint8Array(16)));
  const again = sendSolIntent(k, nonceValue(1, k, 1), recipient, 5_000_002n);
  const moreMessage = W.plain_compile_message(again, pinsOf(1));
  await writeProposal(c, next, { intent: hex(again), message: hex(moreMessage),
    feeSig: signWith(null, Buffer.from(moreMessage), key).toString("hex"),
    createdAt: Date.now() }, 1);
  assert.equal((await session(next)).status, "collecting", "a new nonce value is a new state");
}
step("the nonces of an ended session are dropped and a nonce that a sent session used ends");

// ── The fee key of another seat: a cloned proposal cannot stand ──
{
  reset();
  const { id, ss } = await newSend([]);
  const own = data.get(path(gid, "solfee/3"));
  const clone = hexOfBytes(crypto.getRandomValues(new Uint8Array(16)));
  await writeProposal(c, clone, { intent: ss.intent, message: ss.message, feeSig: ss.feeSig,
    createdAt: ss.createdAt + 1 }, 3);
  assert.equal(await status(clone), "collecting", "control: the clone stands while keys differ");
  const label = c.wallet.label;
  const copied = await c.host.signedDoc(gid, "solfee/3", 3,
    { key: fee(1), cluster: label, at: Date.now() });
  data.set(path(gid, "solfee/3"), copied);
  rig.notify();
  await waitFor("the documents", () => (c.refresh(), c.wait === 0), 10000);
  assert.equal(await status(id), "failed", "both ends: neither stands");
  assert.equal(await status(clone), "failed");
  assert.match((await session(clone)).error, /Two devices show one fee address/);
  await assert.rejects(() => asSeat(c, 1, () => proposeSend(c, ensure, typed())),
    /Another device shows the fee address of device 1, so device 1 cannot pay\./);
  await assert.rejects(() => approvePlain(c, ensure, ss, 2), /not collecting|Two devices/);
  data.set(path(gid, "solfee/3"), own);
  rig.notify();
  await waitFor("the documents", () => (c.refresh(), c.wait === 0), 10000);
  assert.equal(c.docs.solfee[3].key, fee(3));
}
step("a device that shows the fee key of another ends the proposals of both");

// ── Session ids that name an object property cannot break the maps ──
{
  const sample = (await sessions())[0];
  const proposal = data.get(path(gid, "solsessions/" + sample.id));
  const commit = { by: 2, sig: "x", commitments: "aa", digest: "bb", at: 1 };
  const raw = {
    solsessions: Object.fromEntries(["__proto__", "constructor", "toString", "hasOwnProperty",
      sample.id].map((id) => [id, proposal])),
    solcommits: Object.fromEntries([["__proto__", { 2: commit }], ["constructor", { 2: commit }]]),
    solshares: {},
  };
  const heard = [];
  const out = filterSessions(raw, () => "yes", (what) => heard.push(what));
  assert.deepEqual(out.sessions.map((s) => s.id), [sample.id], "only the safe id is a session");
  assert.equal(Object.getPrototypeOf(out.commits), Object.prototype);
  assert.equal(out.commits.nothing, undefined, "no id answers with the commits of another");
  assert.equal(out.bad, 4);
  assert.deepEqual(heard.sort(), ["solsessions/__proto__ id", "solsessions/constructor id",
    "solsessions/hasOwnProperty id", "solsessions/toString id"]);
}
step("session ids such as constructor or __proto__ are left out");

// ── Lows of C3: the length guard, a device that cannot write, the wait for the sessions ──
{
  reset();
  await sessions();
  world.shortAccounts = true;
  await assert.rejects(() => asSeat(c, 1, () => proposeSend(c, ensure, typed())),
    /The Worker answered with data that Zigs cannot use\./);
  world.shortAccounts = false;
  const { id } = await newSend([]);
  const ss = await session(id);
  const can = c.host.canWriteAs;
  c.host.canWriteAs = (seat) => seat !== 2 && can(seat);
  await assert.rejects(() => approvePlain(c, ensure, ss, 2),
    /This browser cannot sign for device 2\./);
  c.host.canWriteAs = can;
  assert.equal(count("sol_nonces"), 0);
  // block() waits for the sessions of the wallet.
  assert.equal(block(c), null);
  c.loaded.solsessions = false;
  assert.match(block(c), /has not loaded the Solana data/);
  const t0 = Date.now();
  assert.match(await settledBlock(c, 300), /has not loaded the Solana data/);
  assert.ok(Date.now() - t0 >= 250, "it waited");
  c.loaded.solsessions = true;
  assert.equal(block(c), null);
}
step("the length guard of freeNonce, canWriteAs at approval and the wait for the sessions");

// ── The reader: the parts of a session, in order, and what counts ──
{
  const sample = await session(done.id);
  const signed = Buffer.alloc(64, 0xab).toString("hex");
  const full = {
    intent: sample.intent, message: sample.message, feeSig: sample.feeSig,
    createdAt: sample.createdAt, by: 1, sig: "s",
    package: "{}", signers: [2, 3], digest: "dd", packageBy: 1, packageSig: "s",
    signature: signed, signedBy: 1, signedSig: "s",
    txId: base58(sample.feeSig), slot: "9", outcome: "confirmed", sentBy: 1, sentSig: "s",
  };
  const read = (doc, check = () => "yes") =>
    filterSessions({ solsessions: { [done.id]: doc } }, check, () => {});
  const only = (doc, check) => read(doc, check).sessions[0];
  const without = (...keys) => Object.fromEntries(Object.entries(full)
    .filter(([k]) => !keys.includes(k)));
  assert.equal(only(full).status, "sent");
  assert.equal(only(full).txId, base58(sample.feeSig));
  assert.equal(only(without("sentBy", "sentSig", "txId", "slot", "outcome")).status, "signed");
  assert.equal(only(without("signedBy", "signedSig", "signature", "txId", "slot", "outcome",
    "sentBy", "sentSig")).status, "signing");
  assert.equal(only(without("package", "signers", "digest", "packageBy", "packageSig", "signature",
    "signedBy", "signedSig", "txId", "slot", "outcome", "sentBy", "sentSig")).status, "collecting");
  // A sent mark names the transaction that its signatures give.
  const wrongId = only({ ...full, txId: base58(signed) });
  assert.equal(wrongId.status, "signed", "a sent mark with another id does not count");
  assert.equal(wrongId.txId, undefined, "and its fields do not reach the session");
  for (const signature of ["zz", signed.slice(2), signed.toUpperCase(), 5]) {
    assert.equal(only({ ...full, signature }).status, "signed",
      "a sent mark needs a signature of 64 bytes in hex");
  }
  assert.equal(only({ ...full, feeSig: "ab".repeat(64) }).status, "signed",
    "and names the first signature of the transaction");
  // A part counts only when the one before it counts.
  assert.equal(only(full, (_rel, _by, _sig, fields) => ("package" in fields ? "no" : "yes")).status,
    "collecting", "no package, no signed part and no sent mark");
  // A part with a bad signature is out, and the parts after it with it.
  const heard = [];
  const bad = filterSessions({ solsessions: { [done.id]: full } },
    (_rel, _by, _sig, fields) => ("signature" in fields ? "no" : "yes"), (w) => heard.push(w));
  assert.equal(bad.sessions[0].status, "signing");
  assert.equal(bad.sessions[0].signature, undefined, "the fields of a part that failed stay out");
  assert.deepEqual(heard.sort(), ["solsessions/" + done.id + " sent",
    "solsessions/" + done.id + " signed"]);
  // A failure ends a session that did not land; a landed one stays landed.
  const failed = only({ ...without("sentBy", "sentSig", "txId", "slot", "outcome"),
    error: "No.", errorBy: 2, errorSig: "s" });
  assert.deepEqual([failed.status, failed.error], ["failed", "No."]);
  assert.equal(only({ ...full, error: "No.", errorBy: 2, errorSig: "s" }).status, "sent",
    "a landed send stays landed");
  // A session is built from the signed fields: nothing else of the document reaches it.
  const noisy = only({ ...full, status: "x", extra: "y", payer: "z", id: "other" });
  assert.deepEqual(Object.keys(noisy).sort(), ["by", "createdAt", "digest", "feeSig", "id",
    "intent", "message", "outcome", "package", "signature", "signers", "slot", "status", "txId"]);
  assert.equal(noisy.id, done.id);
  // The twin reads the parts as the pool does (web/sol/sessions.js): the same documents give the
  // same status, among them the sent marks that name another transaction.
  const failure = { error: "No.", errorBy: 2, errorSig: "s" };
  const documents = [full, { ...full, txId: base58(signed) }, { ...full, signature: "zz" },
    { ...full, signature: signed.slice(2) }, { ...full, signature: signed.toUpperCase() },
    { ...full, feeSig: "ab".repeat(64) }, { ...full, ...failure },
    without("sentBy", "sentSig", "txId", "slot", "outcome"),
    { ...without("sentBy", "sentSig", "txId", "slot", "outcome"), ...failure },
    without("signedBy", "signedSig", "signature", "txId", "slot", "outcome", "sentBy", "sentSig")];
  for (const document of documents) {
    const pool = readSolSession(done.id, document, () => "yes").ss;
    assert.equal(only(document).status, pool.status, "a part counts as it does in the pool");
  }
  // A signed proposal can hold any value in a field. The reader must not throw on it, and a
  // sent part with a signature that is no text does not count.
  const T = { toString: 1 };
  for (const intent of [7, null, undefined, {}, T, ["0f"]]) {
    const hostile = filterSessions({ solsessions: { evil: { ...full, intent }, [done.id]: full } },
      () => "yes", () => {});
    assert.deepEqual(hostile.sessions.map((x) => x.id).sort(), [done.id, "evil"].sort());
  }
  assert.equal(only({ ...full, signature: T }).status, "signed", "an object is no signature");
  assert.equal(only({ ...full, feeSig: T }).status, "signed", "and no fee signature");
  // A document that makes the check throw is a bad document, and the others are still read.
  const heard2 = [];
  const throwing = filterSessions({ solsessions: { evil: { ...full, by: 9 }, [done.id]: full } },
    (_rel, by) => {
      if (by === 9) throw new Error("boom");
      return "yes";
    }, (what) => heard2.push(what));
  assert.deepEqual(throwing.sessions.map((x) => x.id), [done.id]);
  assert.deepEqual([throwing.bad, heard2], [1, ["solsessions/evil unreadable"]]);
}
step("a session is its signed parts in order; a sent mark names the transaction");

// ── A hostile document stops no device ──
{
  reset();
  const T = { toString: 1 };
  const touch = async (n = 6) => {
    for (let i = 0; i < n; i++) {
      plain.react(); // it throws when a document breaks the reader or the reactor
      await sleep(40);
    }
  };
  const sig = "ab".repeat(64);
  const good = { intent: "0f" + "00".repeat(80), message: "81" + "00".repeat(100), feeSig: sig,
    createdAt: Date.now() };
  const { id } = await newSend([2]);
  // Unsigned documents: a writer that is no seat number must be refused, not throw.
  const raws = [
    ["solsessions/rawa", { ...good, by: T, sig: "x" }],
    ["solsessions/rawb", { ...good, by: "2", sig: "x" }],
    ["solsessions/rawc", { ...good, by: 2, sig: T }],
    ["solsessions/rawd", { intent: T, message: T, feeSig: T, createdAt: T, by: 2, sig: "x" }],
    [`solsessions/${id}/commits/3`, { commitments: "ab", digest: "x", by: T, sig: "x", at: 1 }],
    [`solsessions/${id}/shares/3`, { share: "ab", digest: "x", by: T, sig: "x", at: 1 }],
    ["solfee/4", { key: "ab", by: T, sig: "x" }],
    ["soldkg1/4", { by: T, sig: "x" }],
    ["solabort/4", { reason: "x", by: T, sig: "x" }],
  ];
  for (const [rel, value] of raws) {
    await c.host.sdb.doc(base + "/" + rel).set(value);
    rig.notify();
    await touch(3);
    data.delete(path(gid, rel));
  }
  const start = data.get(path(gid, "solstart/1"));
  data.set(path(gid, "solstart/1"), { ...start, by: T });
  rig.notify();
  await touch(3);
  data.set(path(gid, "solstart/1"), start);
  rig.notify();
  await touch(3);
  // Signed documents with fields that are no text: a commit, a share, a package.
  const entry = solOf(2).nonces[id];
  const rel = `solsessions/${id}/commits/3`;
  await c.host.sdb.doc(base + "/" + rel).set(await c.host.signedDoc(gid, rel, 3,
    { commitments: T, digest: entry.digest, at: Date.now() }));
  rig.notify();
  await touch();
  assert.equal(doc(id).package, undefined, "a commit without commitments is no commit");
  await approvePlain(c, ensure, await session(id), 1); // two honest commits are enough
  keep(1, id);
  await pump("the package despite the hostile commit", () => doc(id).package !== undefined);
  assert.deepEqual(doc(id).signers, [1, 2]);
  hooks.push((p) => (p.endsWith(`${id}/shares/2`) ? new Promise(() => {}) : undefined));
  await pump("the share of seat 1", () => doc(id, "/shares/1") !== undefined);
  const shareRel = `solsessions/${id}/shares/2`;
  data.set(path(gid, shareRel), await c.host.signedDoc(gid, shareRel, 2,
    { share: T, digest: doc(id).digest, at: Date.now() }));
  rig.notify();
  await touch();
  assert.equal(count("sol_aggregate"), 0, "a share that is no text is no share");
  data.delete(path(gid, shareRel));
  data.delete(path(gid, rel));
  hooks.length = 0;
  // A package whose signers are no seat numbers: the session ends, nobody throws.
  reset();
  const bent = await newSend([2]);
  const digest = W.sol_plain_digest(pinsOf(1), bytesOfHex(bent.ss.message));
  await writePart(c, bent.id, "package", { package: "{}", signers: [T, 3], digest }, { seat: 3 });
  rig.notify();
  await touch();
  await pump("the session ends", becomes(bent.id, "failed"));
  assert.match((await session(bent.id)).error, /^The signature shares did not combine: /);
  // A sent session whose proposal holds no text for an intent: it stops nobody.
  const evil = hexOfBytes(crypto.getRandomValues(new Uint8Array(16)));
  await writeProposal(c, evil, { intent: 7, message: good.message, feeSig: sig,
    createdAt: Date.now() }, 3);
  await writePart(c, evil, "package", { package: "{}", signers: [2, 3], digest: "dd" },
    { seat: 3 });
  await writePart(c, evil, "signed", { signature: "cd".repeat(64) }, { seat: 3 });
  await writePart(c, evil, "sent", { txId: base58(sig), slot: "1", outcome: "confirmed" },
    { seat: 3 });
  rig.notify();
  await waitFor("the hostile session is read", () => (c.refresh(),
    c.sessions.some((x) => x.id === evil && x.status === "sent")), 10000);
  await touch();
  const honest = await newSend([2, 3]);
  await pump("an honest send still goes through", becomes(honest.id, "sent"));
  data.delete(path(gid, "solsessions/" + evil));
  rig.notify();
}
step("a document with hostile fields stops no device");

// ── A session whose step throws starves no other session ──
{
  reset();
  const honest = await newSend([2, 3]);
  // The newer send comes first in the reactor. It has a nonce account of its own, and the
  // account of the first one stays.
  setNonce(1, nextK++);
  const id2 = await asSeat(c, 1, () => proposeSend(c, ensure, typed("0.006")));
  for (const seat of [2, 3]) {
    await approvePlain(c, ensure, await session(id2), seat);
    keep(seat, id2);
  }
  const broken = { id: id2, ss: await session(id2) };
  assert.ok(broken.ss.createdAt >= honest.ss.createdAt);
  const real = c.W.sol_plain_digest;
  c.W = { ...c.W, sol_plain_digest: (pins, message) => {
    if (hex(message) === broken.ss.message) throw new Error("this session breaks the step");
    return real(pins, message);
  } };
  await pump("the other session is sent", becomes(honest.id, "sent"));
  assert.equal(await status(broken.id), "collecting", "the broken session waits");
  assert.ok(logs.some((l) => l.includes(`session ${broken.id} skipped: this session breaks`)),
    "and its text is logged");
  assert.equal(logs.filter((l) => l.includes(`session ${broken.id} skipped`)).length, 1,
    "once");
  c.W = { ...c.W, sol_plain_digest: real };
  await pump("it goes on once it is whole", becomes(broken.id, "sent"));
  for (const k of [honest.k, nextK - 1]) world.accounts.delete(nonceAddress(1, k));
}
step("a session that throws in its step is skipped and the others go on");

// ── A package for other bytes ends the session ──
{
  reset();
  const { id } = await newSend([2, 3]);
  const map = Object.fromEntries([2, 3].map((i) =>
    [i, doc(id, "/commits/" + i).commitments]));
  await writePart(c, id, "package", { package: JSON.stringify(map), signers: [2, 3],
    digest: "ab".repeat(32) }, { seat: 1 });
  await pump("the session ends after a package for other bytes", becomes(id, "failed"));
  assert.match((await session(id)).error, /^A device did not sign: The digest differs\.$/);
  assert.equal(writes.filter((w) => w.kind === "share").length, 0);
  for (const seat of [2, 3]) assert.equal(solOf(seat).nonces?.[id], undefined);
}
step("a package that names another digest gets no share");

// ── The fee signature is checked again before a share ──
{
  reset();
  const { id, ss } = await newSend([2, 3]);
  const fields = { intent: ss.intent, message: ss.message, feeSig: "ab".repeat(64),
    createdAt: ss.createdAt };
  await writeProposal(c, id, fields, 1); // the proposer rewrites its fee signature
  await pump("the session ends after a bad fee signature", becomes(id, "failed"));
  assert.equal((await session(id)).error, "The fee signature of device 1 does not fit it.",
    "the fee signature is checked before a share");
  assert.equal(count("sol_plain_sign_share"), 0, "no share was made");
  assert.equal(names().includes("simulate"), false);
  for (const seat of [2, 3]) assert.equal(solOf(seat).nonces?.[id], undefined);
}
step("a fee signature that does not fit ends the session before a share");

// ── Shares that do not combine end the session ──
{
  reset();
  const { id } = await newSend([2, 3]);
  hooks.push(async (p, value) => {
    if (!p.endsWith(`${id}/shares/3`)) return undefined;
    const share = value.share.slice(0, -2) + (value.share.endsWith("00") ? "01" : "00");
    const { digest, at } = value;
    return c.host.signedDoc(gid, `solsessions/${id}/shares/3`, 3, { share, digest, at });
  });
  await pump("the session ends after shares that do not combine", becomes(id, "failed"));
  assert.match((await session(id)).error, /^The signature shares did not combine: /);
  assert.equal(names().includes("simulate"), false, "nothing was sent");
  hooks.length = 0;
}
step("shares that do not combine end the session");

// ── No secret in the text of a refused share: each secret alone, and the whole round ──
{
  const echoes = [["the whole round", (round) => JSON.stringify(round)],
    ["the nonces", (round) => round.nonces],
    ["the end of the nonces", (round) => round.nonces.slice(64)],
    ["the key share", (round) => round.keyPackage.signing_share]];
  for (const [name, pick] of echoes) {
    reset();
    const real = c.W.sol_plain_sign_share;
    c.W = { ...c.W, sol_plain_sign_share: (...args) => {
      throw new Error("the wasm echoes " + pick(JSON.parse(args[4])));
    } };
    const { id } = await newSend([2, 3]);
    await pump("the session ends after an echo of " + name, becomes(id, "failed"));
    const text = (await session(id)).error;
    assert.match(text, /^A device did not sign: the wasm echoes /);
    assert.match(text, /\[hidden\]/, name + " is hidden");
    assert.deepEqual(leaks(), [], "the text holds no part of " + name);
    c.W = { ...c.W, sol_plain_sign_share: real };
  }
}
step("the text of a refused share holds no nonce and no key share");

// ── A chain read that fails: the share step waits longer each time ──
{
  reset();
  const { id } = await newSend([2, 3]);
  const seats = c.host.localSeats;
  c.host.localSeats = () => [2]; // one signer asks, so every genesis call is one try
  world.failing = "genesis";
  const reads = () => calls.filter((x) => x.cmd === "genesis" && x.at > t0);
  const t0 = Date.now();
  await pump("four chain reads", () => reads().length >= 4);
  const gaps = reads().slice(1).map((x, i) => x.at - reads()[i].at);
  const first = LIMITS.backoff - 5;
  assert.ok(gaps.every((gap, i) => gap >= first * 2 ** i),
    "each wait of the chain read doubles: " + gaps);
  assert.equal(await status(id), "signing", "and a failed read ends nothing");
  world.failing = null;
  c.host.localSeats = seats;
  await pump("sent", becomes(id, "sent"));
}
step("a failed chain read of the share step waits longer each time");

// ── A hung chain read and a slow wait ──
{
  reset();
  const saved = { ...LIMITS };
  LIMITS.call = 150;
  LIMITS.confirm = 3000;
  const { id } = await newSend([2, 3]);
  let hung = 0;
  world.hold = (cmd) => {
    if (cmd === "genesis" && hung++ === 0) return new Promise(() => {});
    return cmd === "confirm" ? sleep(500) : undefined;
  };
  await pump("the banner of the chain read",
    () => JSON.stringify(t.banner ?? "").includes("did not answer genesis"), 5000);
  await pump("sent", becomes(id, "sent"));
  assert.equal(announced.some((w) => w.startsWith("Not confirmed yet")), false,
    "a wait that is slower than a call but inside its own limit ends well");
  Object.assign(LIMITS, saved);
}
step("a hung chain read frees its step and confirm has a limit of its own");

// ── A lease that another device holds ──
{
  reset();
  const { id } = await newSend([2, 3]);
  let denied = true;
  rig.hook.lease = () => !denied;
  for (let i = 0; i < 8; i++) {
    plain.react();
    await sleep(40);
  }
  assert.equal(doc(id).package, undefined, "no package while another device holds the lease");
  denied = false;
  await pump("the signed session", becomes(id, "signed"), 20000).catch(() => {});
  rig.hook.lease = () => true;
  await pump("sent", becomes(id, "sent"));
  reset();
  const next = await newSend([2, 3]);
  await pump("the package", () => doc(next.id).package !== undefined);
  denied = true;
  rig.hook.lease = (p) => !(denied && p.endsWith(next.id));
  await pump("the signed session of the second send", becomes(next.id, "signed"));
  for (let i = 0; i < 8; i++) {
    plain.react();
    await sleep(40);
  }
  assert.equal(world.sends.length, 0, "no send while another device holds the lease");
  assert.equal(names().includes("status"), false, "and not even a look at the status");
  denied = false;
  await pump("the sent session of the second send", becomes(next.id, "sent"));
  rig.hook.lease = () => true;
}
step("a package and a send wait while another device holds the lease");

// ── A stopped wallet drops every nonce ──
{
  reset();
  const { id } = await newSend([2]);
  assert.ok(solOf(2).nonces[id]);
  const abort = await c.host.signedDoc(gid, "solabort/1", 1, { reason: "stop for the test" });
  await c.host.sdb.doc(base + "/solabort/1").set(abort);
  await pump("the nonces of a stopped wallet are dropped",
    () => Object.keys(solOf(2).nonces ?? {}).length === 0);
}
step("a stopped wallet drops the nonces of every session");

// ── Nothing leaked over the whole run ──
assert.deepEqual(leaks(), [], "no nonce, key share or fee secret in the run");
step("no secret is in a Worker call, a log, a banner, a document or a text");

console.log("sol-plain-sign: ok");
process.exit(0);
