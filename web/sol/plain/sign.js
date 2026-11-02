// The signing steps after the approvals of a plain send (ZOLANA.md 3.8, 5). This is the plain twin
// of web/sol/signing.js, which the plain controller does not import. The reactor runs the steps
// for the seats of this browser without a click:
//  - package: at `t` commits with one digest, one device publishes the package. It names the
//    commitments that it uses;
//  - share: a signer checks the package against the commits that it can verify, makes its share
//    (the wasm runs the checker again), deletes its nonces in one save and publishes the share;
//  - aggregate: any device combines the shares (the wasm checks with verify_strict);
//  - send: one device lands the transaction (the fee signature, then the group signature, after
//    the message) and writes the sent mark. It reads the status first.
// A session that cannot go on ends with a text, and the nonces of an ended session are dropped. The
// nonce rules are in nonces.js. Nothing here reads or shows a nonce or a key share.
import { agreement } from "../ceremony.js";
import { base58 } from "../docs.js";
import { payerOf } from "../fee.js";
import { clearPending, dropNonces, pendingShare, savedNonces, shareOnce } from "../nonces.js";
import { holdsShare, solOf, stopOf } from "../secrets.js";
import { labelOf } from "../wallet.js";
import { readChain } from "./chain.js";
import { BAD_ANSWER, blockNow, stillOpen } from "./direct.js";
import { toBase64 } from "./guard.js";
import { bytesOfHex, join, plainPins } from "./intent.js";
import { canApprove, reviewText, stopText } from "./review.js";
import { ENDED, SESSIONS, sameProposal, showable, titleOf, writePart } from "./sessions.js";

const J = JSON.parse,
  S = JSON.stringify;
const HEX = /^([0-9a-f]{2})+$/;
const SEND_TRIES = 3;
const RETRY_MS = 3000;
/**
 * The page side time limit of a Worker call (`confirm` waits 45 s inside the Worker), and the wait
 * of a device that does not hold the proposing seat before it sends. Tests lower them.
 */
export const LIMITS = { call: 20_000, confirm: 60_000, fallback: 30_000 };
// What the Worker says when the node refused a send, or when it refused to send: nothing went out.
const REFUSED = /send: (RPC error|these bytes did not pass)/;
const STILL_THERE = /already.*processed|has already been/i;
const SIGNATURE = /^[0-9a-f]{128}$/;
const COLLECTING = new Set(["collecting"]);
const SIGNING = new Set(["signing"]);
const SIGNED = new Set(["signed"]);
const AFTER_SEND = new Set(["signed", "failed"]);

/** A step that stops because the wallet closed or stopped. It is no failed try. */
class Halt extends Error {}
/** A send whose result is not known. It is no failed try: the next pass reads the status. */
class Unconfirmed extends Error {}

const launch = (c, key, run) => c.host.once("sol:" + key, run);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const say = (c, words) => c.host.announce(words);
const errorText = (e) => String(e?.message ?? e).slice(0, 300);
// One holder for this tab: the server lets the same holder take its lease again.
const HOLDER = crypto.randomUUID();
const leased = async (ref, ttlMs) => (await ref.acquire({ holder: HOLDER, ttlMs })).acquired;
const sessionRef = (c, ss) => c.host.sdb.doc(c.base + "/" + SESSIONS + "/" + ss.id);

/** The seats of this browser that hold a Solana key share and may sign a document. */
export const writerSeats = (c) =>
  c.host.localSeats().filter((i) => c.host.canWriteAs(i) && holdsShare(solOf(c.host, c.gid, i)));

// The wallet is still the one that the step started with, and no stop came. A short wait for a
// document that is being checked does not stop a step (stillOpen).
function opened(c, was) {
  try {
    stillOpen(c, was);
  } catch (e) {
    throw new Halt(e.message);
  }
}

// True when the step must end quietly: the session of the page is not the same proposal any more,
// or it is not in one of the statuses `wanted`. A wallet that closed or stopped throws (Halt).
function moved(c, was, ss, wanted) {
  opened(c, was);
  const now = c.sessions.find((s) => s.id === ss.id);
  return !now || !sameProposal(c.sessions, ss) || !wanted.has(now.status);
}

/**
 * The Worker with a time limit on each call: a hung answer ends the step and frees its key. The
 * controller gives every step this form of the Worker (control.js).
 */
export function limited(worker) {
  const call = (cmd, args) =>
    new Promise((ok, bad) => {
      const text = `The Solana worker did not answer ${cmd} in time.`;
      const timer = setTimeout(() => bad(new Error(text)), LIMITS[cmd] ?? LIMITS.call);
      worker.call(cmd, args).then(ok, bad).finally(() => clearTimeout(timer));
    });
  return { call };
}

// What the session needs of the wallet: the pins (with the payer that the proposing seat
// published) and the digest of its message, or null while the payer or the key is not known.
function contextOf(c, ss, group) {
  const payer = payerOf(c, ss);
  if (!payer) return null;
  const pins = plainPins(c.wallet, group, payer);
  const message = bytesOfHex(ss.message);
  const digest = c.W.sol_plain_digest(pins, message);
  return { payer, pins, message, intent: bytesOfHex(ss.intent), digest };
}

async function failSession(c, ss, text, was) {
  const seat = writerSeats(c)[0];
  if (seat === undefined) return;
  opened(c, was);
  await writePart(c, ss.id, "failure", { error: text }, { seat, guard: () => opened(c, was) });
  say(c, `${titleOf(ss)}: ${text}`);
}

// Package

/** The seats whose published commit has this digest and a well formed commitment, lowest first. */
function committed(c, ss, digest) {
  return Object.entries(c.commits[ss.id] ?? {})
    .filter(([, d]) => d.digest === digest && HEX.test(String(d.commitments)))
    .map(([seat]) => Number(seat))
    .sort((a, b) => a - b);
}

function maybePackage(c, ss, ctx) {
  const t = c.host.state.g.t,
    ids = committed(c, ss, ctx.digest).slice(0, t);
  const seat = writerSeats(c)[0];
  if (ids.length < t || seat === undefined) return;
  launch(c, "pkg:" + ss.id, () => publishPackage(c, ss, { seat, ids, digest: ctx.digest }));
}

// A package that is stored but not valid (an unsigned one) must not block the real one.
async function packageStands(c, ss, doc) {
  if (doc.package === undefined || doc.packageSig === undefined) return false;
  const fields = { package: doc.package, signers: doc.signers, digest: doc.digest };
  const rel = SESSIONS + "/" + ss.id;
  return c.host.checkIn(c.gid)(rel, doc.packageBy, doc.packageSig, fields, null) !== "no";
}

// The package names the commitments that it uses. The commits are read again after the lease: a
// commit that changed while the device waited makes the next pass build a new package.
async function publishPackage(c, ss, { seat, ids, digest }) {
  const was = c.opened;
  const ref = sessionRef(c, ss);
  if (!(await leased(ref, 10000))) return sleep(1000);
  const cur = await ref.get();
  if (cur.exists && (await packageStands(c, ss, cur.data()))) return sleep(500);
  const same = S(committed(c, ss, digest).slice(0, ids.length)) === S(ids);
  if (moved(c, was, ss, COLLECTING) || !same) return;
  const commits = c.commits[ss.id];
  const map = Object.fromEntries(ids.map((i) => [i, commits[i].commitments]));
  const fields = { package: S(map), signers: ids, digest };
  await writePart(c, ss.id, "package", fields, { seat, guard: () => opened(c, was) });
  say(c, "Signing started.");
  c.host.log("Solana signing package sent to devices " + ids.join(", "));
}

// Share

const signersOf = (ss) => (Array.isArray(ss.signers) ? ss.signers : []);

/**
 * The commitments of the signers as this device can verify them, or null while a commit of a
 * signer is not here yet (it comes with the next snapshot). A commit for another digest is an
 * error: the package does not match the approvals.
 */
function verifiedCommits(c, ss, digest) {
  const verified = {};
  for (const j of signersOf(ss)) {
    const commit = c.commits[ss.id]?.[j];
    if (!commit) return null;
    if (commit.digest !== digest) throw new Error("Device " + j + " approved other bytes.");
    verified[j] = commit.commitments;
  }
  return verified;
}

// The signers are `t` distinct seats and include this one; the digest is the one of the message.
function checkSigners(c, ss, i, { entry, digest }) {
  const t = c.host.state.g.t,
    signers = signersOf(ss);
  const whole = signers.every(Number.isInteger) && new Set(signers).size === t;
  if (!whole || signers.length !== t || !signers.includes(i)) {
    throw new Error("The devices of the package are wrong.");
  }
  if (ss.digest !== digest || entry.digest !== digest) throw new Error("The digest differs.");
}

/**
 * The round of seat `i`: the package as this device can verify it, or null while it cannot yet.
 * The signers are `t` distinct seats, each with a verified commit for this digest, and the
 * commitment of this seat is the one that it saved. A package that differs gets no share, and a
 * seat never makes new nonces here: a commitment that another browser of the seat overwrote ends
 * the session.
 */
function roundOf(c, ss, i, { entry, digest }) {
  checkSigners(c, ss, i, { entry, digest });
  const verified = verifiedCommits(c, ss, digest);
  if (verified === null) return null;
  if (S(J(ss.package)) !== S(verified)) throw new Error("The package differs from the commits.");
  if (verified[i] !== entry.commitments) throw new Error("The package has another commitment.");
  const keyPackage = solOf(c.host, c.gid, i).keyPackage;
  const now = Math.floor(Date.now() / 1000);
  return { now, cluster: labelOf(c), keyPackage, commitments: verified };
}

// The text of a refused share. A refusal of the checker shows its rules; no secret stays in a text.
function refusalText(c, e, { run, secrets }) {
  const whole = String(e?.message ?? e);
  const text = secrets.reduce((t, secret) => t.split(secret).join("[hidden]"), whole).slice(0, 300);
  if (!text.startsWith("refused")) return text;
  const review = reviewText(c, run.message, run.intent, run.pins, run.chain);
  return canApprove(review) ? text : stopText(review);
}

async function publishShare(c, ss, i, made) {
  const was = c.opened,
    { gid, base } = c;
  const rel = SESSIONS + "/" + ss.id + "/shares/" + i;
  const doc = await c.host.signedDoc(gid, rel, i, { ...made, at: Date.now() });
  opened(c, was);
  await c.host.sdb.doc(base + "/" + rel).set(doc);
  await clearPending(c, i, ss.id);
  say(c, "Signature share sent.");
  c.host.log("device " + i + ": Solana signature share sent");
}

// The nonces go in the lock of shareOnce, in one save, before the share document exists. The wasm
// runs the checker on the chain that was read before the lock (the lock holds no network call).
function shareMaker(c, ss, i, { ctx, chain }) {
  const keyPackage = solOf(c.host, c.gid, i).keyPackage;
  return (entry) => {
    const secrets = [entry.nonces, entry.nonces.slice(64), keyPackage.signing_share, S(keyPackage)];
    try {
      const round = roundOf(c, ss, i, { entry, digest: ctx.digest });
      if (round === null) return null;
      const text = S({ ...round, nonces: entry.nonces });
      return J(c.W.sol_plain_sign_share(ctx.message, ctx.intent, ctx.pins, chain, text));
    } catch (e) {
      const run = { message: ctx.message, intent: ctx.intent, pins: ctx.pins, chain };
      throw new Error(refusalText(c, e, { run, secrets }));
    }
  };
}

async function makeShare(c, ss, i, { ctx, ensure }) {
  const was = c.opened;
  if (!c.W.sol_fee_verify(ctx.payer, ctx.message, ss.feeSig)) {
    await failSession(c, ss, `The fee signature of device ${ss.by} does not fit it.`, was);
    return;
  }
  const chain = await readChain(c, await ensure(), ctx.intent, ctx.pins);
  if (moved(c, was, ss, SIGNING)) return;
  const made = await shareOnce(c, i, ss.id, shareMaker(c, ss, i, { ctx, chain }));
  if (made && "refused" in made) {
    await failSession(c, ss, "A device did not sign: " + errorText(made.refused), was);
    throw made.refused;
  }
  if (made) await publishShare(c, ss, i, { share: made.share, digest: made.digest });
}

async function shareOf(c, ss, i, step) {
  const pending = pendingShare(c, i, ss.id);
  if (pending) return publishShare(c, ss, i, pending);
  return makeShare(c, ss, i, step);
}

// A signer waits until the commits of the package are here. An inconsistent package is not waited
// for: the share step refuses it and ends the session.
function commitsHere(c, ss, digest) {
  try {
    return verifiedCommits(c, ss, digest) !== null;
  } catch {
    return true;
  }
}

// What seat `i` does next for this session: forget a share that is published, publish a made share,
// or make its share. null: nothing to do now.
function shareStep(c, ss, i, step) {
  const { ctx } = step;
  const published = !!c.shares[ss.id]?.[i],
    pending = pendingShare(c, i, ss.id);
  if (published) return pending ? ["clear", () => clearPending(c, i, ss.id)] : null;
  const ready = pending || (savedNonces(c, i, ss.id) && commitsHere(c, ss, ctx.digest));
  return ready ? ["share", () => shareOf(c, ss, i, step)] : null;
}

function signMine(c, ss, step) {
  for (const i of c.host.localSeats()) {
    if (!signersOf(ss).includes(i) || !c.host.canWriteAs(i)) continue;
    const next = shareStep(c, ss, i, step);
    if (next) launch(c, `${next[0]}:${ss.id}:${i}`, next[1]);
  }
}

// Aggregate

function maybeAggregate(c, ss) {
  const shares = c.shares[ss.id] ?? {};
  const whole = signersOf(ss).every(
    (i) => shares[i]?.digest === ss.digest && HEX.test(String(shares[i].share)),
  );
  const seat = writerSeats(c)[0];
  if (!whole || seat === undefined) return;
  launch(c, "agg:" + ss.id, () => aggregate(c, ss, seat));
}

async function aggregate(c, ss, seat) {
  const was = c.opened;
  const shares = Object.fromEntries(signersOf(ss).map((i) => [i, c.shares[ss.id][i].share]));
  let signature;
  try {
    const key = agreement(c).done.publicKeyPackage;
    signature = c.W.sol_aggregate(bytesOfHex(ss.message), key, ss.package, S(shares));
  } catch (e) {
    await failSession(c, ss, "The signature shares did not combine: " + errorText(e), was);
    throw e;
  }
  if (moved(c, was, ss, SIGNING)) return;
  await writePart(c, ss.id, "signed", { signature }, { seat, guard: () => opened(c, was) });
  say(c, "Signed by the group.");
  c.host.log("Solana signature combined and checked with verify_strict");
}

// Send

const unconfirmed = (txId) =>
  new Unconfirmed(`Not confirmed yet: transaction ${txId} may have been sent. Zigs looks again.`);

// The seat that sends: the proposer, when this browser holds it; else the first seat of this
// browser, LIMITS.fallback after this tab saw the session signed. The lease allows one sender.
function sendSeat(c, ss) {
  const seats = writerSeats(c);
  if (seats.includes(ss.by)) return ss.by;
  if (seats[0] === undefined) return undefined;
  const first = c.signedSeen.get(ss.id) ?? { at: Date.now(), woke: false };
  c.signedSeen.set(ss.id, first);
  const wait = first.at + LIMITS.fallback - Date.now();
  if (wait <= 0) return seats[0];
  if (!first.woke) setTimeout(() => c.host.refilter(), wait + 100);
  first.woke = true;
  return undefined;
}

function maybeSend(c, ss, ensure) {
  const seat = sendSeat(c, ss);
  if (seat === undefined) return;
  launch(c, "send:" + ss.id, async () => {
    const worker = await ensure();
    await sendSigned(c, ss, { seat, worker });
  });
}

// The transaction of a v1 message: the message, then the signatures in the order of the signers,
// the fee key first and the group key second.
function txOf(ss) {
  if (!SIGNATURE.test(String(ss.signature))) throw new Error("The group signature is not valid.");
  return toBase64(join(bytesOfHex(ss.message), bytesOfHex(ss.feeSig + ss.signature)));
}

/** The status of the transaction, or a throw. A list of any other size is an answer to refuse. */
async function statusOf(worker, txId) {
  const { statuses } = await worker.call("status", { signatures: [txId] });
  if (!Array.isArray(statuses) || statuses.length !== 1) throw new Error(BAD_ANSWER);
  if (typeof statuses[0]?.status !== "string") throw new Error(BAD_ANSWER);
  return statuses[0];
}

// The wait for the result. A wait that fails or ends with no answer is not a failed send.
async function waitFor(worker, txId) {
  const seen = await worker.call("confirm", { signature: txId }).catch(() => null);
  if (!seen || seen.status === "unknown") throw unconfirmed(txId);
  return seen;
}

// Simulates the signed transaction, sends the bytes that passed and waits for the result. The
// node's refusal of a send is a failed try. A send that ends in any other way may have gone out.
async function land(c, ss, ctx) {
  const { worker, tx, txId, was } = ctx;
  const sim = await worker.call("simulate", { tx });
  if (sim.err !== null) throw new Error("The network refused the signed transaction: " + sim.err);
  if (moved(c, was, ss, SIGNED)) return null;
  say(c, "Sending the signed transaction…");
  try {
    await worker.call("send", { tx });
  } catch (e) {
    if (!REFUSED.test(String(e.message))) throw unconfirmed(txId);
    if (!STILL_THERE.test(String(e.message))) throw e;
  }
  return waitFor(worker, txId);
}

// The result of the transaction. A transaction that landed is never sent again: the status comes
// first, for a device that is late.
async function resultOf(c, ss, ctx) {
  let result = await statusOf(ctx.worker, ctx.txId);
  if (moved(c, ctx.was, ss, SIGNED)) return null;
  if (result.status === "pending") result = await waitFor(ctx.worker, ctx.txId);
  return result.status === "none" ? land(c, ss, ctx) : result;
}

async function attemptSend(c, ss, { seat, worker }) {
  const was = c.opened;
  const txId = base58(ss.feeSig);
  const ctx = { worker, tx: txOf(ss), txId, was };
  if (!(await leased(sessionRef(c, ss), 60000))) return sleep(RETRY_MS);
  if (moved(c, was, ss, SIGNED)) return;
  const result = await resultOf(c, ss, ctx);
  if (!result || moved(c, was, ss, AFTER_SEND)) return;
  const fields = { txId, slot: String(result.slot), outcome: result.status };
  await writePart(c, ss.id, "sent", fields, { seat, guard: () => opened(c, was) });
  say(c, result.status === "failed" ? "Sent. It failed on the chain." : "Sent and confirmed.");
}

async function countTry(c, ss, { e, was }) {
  const tries = (c.tries.get(ss.id) ?? 0) + 1;
  c.tries.set(ss.id, tries);
  if (tries >= SEND_TRIES) await failSession(c, ss, "Not sent: " + errorText(e), was);
}

// Three failed tries end the session with a text. A step that halts, and a send with no known
// result, are no tries.
async function sendSigned(c, ss, { seat, worker }) {
  const was = c.opened;
  try {
    await attemptSend(c, ss, { seat, worker });
  } catch (e) {
    if (e instanceof Halt || c.opened !== was) throw e;
    if (e instanceof Unconfirmed) say(c, e.message);
    else await countTry(c, ss, { e, was });
    throw e;
  }
}

// The reactor

/** Nonces that no signature can use any more: the session ended, or the wallet stopped. */
function dropDead(c, ended) {
  for (const i of c.host.localSeats()) {
    const saved = solOf(c.host, c.gid, i).nonces ?? {};
    for (const sid of Object.keys(saved)) {
      if (ended(sid)) launch(c, "drop:" + sid + ":" + i, () => dropNonces(c, i, sid));
    }
  }
}

function stepSession(c, ss, { ensure, group }) {
  const ctx = contextOf(c, ss, group);
  if (!ctx) return;
  if (!ss.package) return maybePackage(c, ss, ctx);
  signMine(c, ss, { ctx, ensure });
  if (!ss.signature) return maybeAggregate(c, ss);
  maybeSend(c, ss, ensure);
}

/**
 * Advances every plain send session for the seats of this browser. `ensure` gives the plain
 * Worker. A session that is no send of this app (showable) is not touched.
 */
export function reactSessions(c, ensure) {
  if (stopOf(c)) return dropDead(c, () => true);
  const ours = c.sessions.filter((ss) => showable(ss));
  const over = new Set(ours.filter((ss) => ENDED.has(ss.status)).map((ss) => ss.id));
  dropDead(c, (sid) => over.has(sid));
  if (blockNow(c)) return;
  const group = agreement(c).done.groupKey;
  for (const ss of ours) {
    if (!ENDED.has(ss.status)) stepSession(c, ss, { ensure, group });
  }
}
