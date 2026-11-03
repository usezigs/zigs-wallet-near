// The approval of a plain send (ZOLANA.md 3.8, 5). Every approving device runs the checker on its
// own fresh read of the chain, with the pins of the agreed `soldone` document and the payer that
// the proposing seat published (fee.js), and shows what the checker accepted. The payer never
// comes from a field of the proposal, and the values never come from the intent bytes or from the
// proposer. Only then does the device make its FROST nonces, save them with the digest and publish
// its commitment. The signing rounds and the send come later (a share needs the nonces of here).
// The nonces and the key share never leave the device: only the commitments are published.
import { agreement } from "../ceremony.js";
import { base58 } from "../docs.js";
import { payerOf } from "../fee.js";
import { approvalOnce } from "../nonces.js";
import { holdsShare, solOf } from "../secrets.js";
import { readChain } from "./chain.js";
import { settledBlock, stillOpen } from "./direct.js";
import { bytesOfHex, plainPins } from "./intent.js";
import { canApprove, reviewText, screenRows, stopText } from "./review.js";
import {
  SESSIONS, otherSwap, sameProposal, showable, swapLate, swapOf, titleOf,
} from "./sessions.js";

const NOT_SHOWN = "This proposal is not one that this app can show.";
const NOT_COLLECTING = "This proposal is not collecting approvals any more.";
const CHANGED = "The proposal changed while Zigs checked it. Nothing was published.";
const OTHER_BYTES = "The saved approval is for other bytes.";
const NO_COMMITMENT = "This device could not make its signing commitment.";
const NEW_LINES = "The lines of the checker changed since you looked. Review the proposal again.";
const NOT_DEPOSIT = "The swap mark names another address than the recipient of this send.";
const TWICE = "Another send of this wallet pays the same deposit address.";
const SWAP_LATE = "The deposit address of this swap closes in less than 30 minutes. A late deposit "
  + "can be lost.";
const NO_CHECK = "This browser could not check the swap of this deposit address.";

// Why the copy `ss` that the caller holds may not be approved, or null: the page no longer holds
// this proposal (the proposer wrote other bytes), or the session ended. The status of the page
// counts and never the one on the copy: another proposal on the same nonce may have ended it.
function sessionStop(c, ss) {
  if (!sameProposal(c.sessions, ss)) return CHANGED;
  const now = c.sessions.find((s) => s.id === ss.id);
  return now.status === "collecting" ? null : (now.error ?? NOT_COLLECTING);
}

/** The checks of a step that no read can change: the seat, the session and an earlier approval. */
function approveBlock(c, ss, seat) {
  const { host } = c;
  if (!host.localSeats().includes(seat) || !host.canWriteAs(seat)) {
    return `This browser cannot sign for device ${seat}.`;
  }
  const stop = sessionStop(c, ss);
  if (stop) return stop;
  return c.commits[ss.id]?.[seat] ? `Device ${seat} approved this already.` : null;
}

// Why the proposal cannot be reviewed by this device before any read, or null.
function reviewBlock(c, ss, seat) {
  if (!showable(ss)) return NOT_SHOWN;
  if (!holdsShare(solOf(c.host, c.gid, seat))) return `Device ${seat} holds no Solana key share.`;
  if (!payerOf(c, ss)) {
    return `Device ${ss.by} has not published its fee address, so the payer is unknown.`;
  }
  return null;
}

// The answer of host.swapCheck as { lines } or { why }. Any other shape, an empty reason and no
// lines are no check.
function swapAnswer(out) {
  if (typeof out?.why === "string") return { why: out.why || NO_CHECK };
  const lines = Array.isArray(out?.lines) ? out.lines : [];
  const sound = lines.length > 0 && lines.every((line) => typeof line === "string");
  return sound ? { lines } : { why: NO_CHECK };
}

// The check of a swap deposit (swapOf): the recipient of the checker is the deposit address of the
// mark, no other send pays it, 30 minutes are left, and the page finds the swap at NEAR Intents
// (host.swapCheck, web/app-swap-sol.js) with the base units of the checker and the address of
// this wallet as the refund. Gives { lines } to show or { why }, and {} for a send with no mark.
async function swapLook(c, ss, review) {
  const swap = swapOf(ss);
  if (!swap) return {};
  const value = (name) => review.lines.find((line) => line.name === name)?.value;
  if (value("recipient") !== swap.deposit) return { why: NOT_DEPOSIT };
  if (otherSwap(c.sessions, ss)) return { why: TWICE };
  if (swapLate(ss)) return { why: SWAP_LATE };
  const ask = { deposit: swap.deposit, lamports: value("units"), deadline: swap.iso,
    refundTo: base58(agreement(c).done.groupKey) };
  try {
    return swapAnswer(await c.host.swapCheck(ask));
  } catch (e) {
    return { why: NO_CHECK + " " + String(e?.message ?? e) };
  }
}

/**
 * What seat `seat` sees of the proposal `ss`: { ok: true, review, rows, title, digest, payer, by,
 * swap } when the checker accepts the exact message on a fresh read of the chain, else { ok:
 * false, why }. `payer` is the fee key (hex) that seat `ss.by` published. `rows` are the lines of
 * the checker and `title` comes from the tag. `swap` holds the sentences of the swap check of a
 * swap deposit, apart from the rows. A failed read throws.
 */
export async function reviewSession(c, ensure, ss, seat) {
  const opened = c.opened;
  const why = (await settledBlock(c)) ?? reviewBlock(c, ss, seat);
  if (why) return { ok: false, why };
  const payer = payerOf(c, ss);
  const [message, intent] = [bytesOfHex(ss.message), bytesOfHex(ss.intent)];
  if (!c.W.sol_fee_verify(payer, message, ss.feeSig)) {
    return { ok: false, why: `The fee signature of device ${ss.by} does not fit it.` };
  }
  const pins = plainPins(c.wallet, agreement(c).done.groupKey, payer);
  const chain = await readChain(c, await ensure(), intent, pins);
  stillOpen(c, opened);
  const review = reviewText(c, message, intent, pins, chain);
  if (!canApprove(review)) return { ok: false, why: stopText(review), review };
  const swap = await swapLook(c, ss, review);
  stillOpen(c, opened);
  if (swap.why) return { ok: false, why: swap.why };
  const digest = c.W.sol_plain_digest(pins, message);
  const rows = screenRows(review);
  return { ok: true, review, rows, title: titleOf(ss), digest, payer, by: ss.by,
    swap: swap.lines };
}

// Fresh nonces for this digest. The wasm text could echo the key package, so none is passed on.
function makeEntry(c, seat, digest) {
  try {
    const { keyPackage } = solOf(c.host, c.gid, seat);
    const made = JSON.parse(c.W.sol_nonces(JSON.stringify(keyPackage), digest));
    return { digest, nonces: made.nonces, commitments: made.commitments };
  } catch {
    throw new Error(NO_COMMITMENT);
  }
}

// The guard after an await: the same wallet, the same stop state, the same proposal, still open.
function unchanged(c, opened, ss) {
  stillOpen(c, opened);
  const stop = sessionStop(c, ss);
  if (stop) throw new Error(stop);
}

// The signed commit of an approval. It carries the swap mark that this device checked, so that a
// proposal written again with another mark loses the approval (bindMark of sessions.js).
function commitFields(entry, ss) {
  const fields = { commitments: entry.commitments, digest: entry.digest, at: Date.now() };
  return ss.swap === undefined ? fields : { ...fields, swap: ss.swap };
}

/**
 * Seat `seat` approves the proposal `ss`. A retry after a crash between the save and the publish
 * publishes the saved commitment again: the nonces are never made twice for one session, and a
 * saved approval of other bytes is refused (approvalOnce, nonces.js). `shown` are the rows that
 * the person looked at: when the fresh read gives other rows, nothing is approved.
 */
export async function approvePlain(c, ensure, ss, seat, shown = null) {
  const opened = c.opened;
  const why = (await settledBlock(c)) ?? approveBlock(c, ss, seat);
  if (why) throw new Error(why);
  const review = await reviewSession(c, ensure, ss, seat);
  if (!review.ok) throw new Error(review.why);
  if (shown && JSON.stringify(shown) !== JSON.stringify(review.rows)) throw new Error(NEW_LINES);
  unchanged(c, opened, ss);
  const make = () => makeEntry(c, seat, review.digest);
  const entry = await approvalOnce(c, seat, ss.id, review.digest, make);
  if (entry.digest !== review.digest) throw new Error(OTHER_BYTES);
  unchanged(c, opened, ss);
  const rel = `${SESSIONS}/${ss.id}/commits/${seat}`;
  const fields = commitFields(entry, ss);
  const { base } = c;
  const doc = await c.host.signedDoc(c.gid, rel, seat, fields);
  unchanged(c, opened, ss);
  await c.host.sdb.doc(base + "/" + rel).set(doc);
  c.host.log(`device ${seat}: approved a Solana proposal, commitment published`);
}
