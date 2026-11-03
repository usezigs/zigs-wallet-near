// The sends of the plain wallet as the page lists them (ZOLANA.md 3.8, 3.9): the checks of the send
// form, the rows with their status chips, the proposals that this browser can approve (the count of
// Approvals), the review of one proposal before its approval, and the words for the live region
// when another device changed a status. A row shows its title and its writer; the recipient and
// the amount come from the checker in the review and from nothing else.
import { agreement } from "../ceremony.js";
import { base58 } from "../docs.js";
import { payerOf } from "../fee.js";
import { holdsShare, solOf } from "../secrets.js";
import { approvePlain, reviewSession } from "./approve.js";
import { blockNow, payerSeat } from "./direct.js";
import { checkTyped } from "./propose.js";
import { DECIMALS, amountText } from "./reads.js";
import {
  ENDED, SESSIONS, SHARED, SUPERSEDED, heldIndexes, sameProposal, showable, swapOf, titleOf,
} from "./sessions.js";

const UNITS = { sol: "SOL", usdc: "USDC" };
const NO_USDC = "Enable USDC first.";
const NOT_READ = "Zigs has not read the balance yet.";
const OWN_ADDRESS = "That is the address of this wallet. Enter another address.";
const NO_NONCE = "No free nonce account. Create one first.";
const NOT_LOOKED = "Review the proposal first.";
// The rent minimum of an account with no data: RENT_ZERO of the checker (wasm-sol/src/consts.rs).
const RENT_ZERO = 650_240n;
const NO_SETUP = "The Solana key setup of this wallet has not ended.";
const NONCES_UNREAD = "Zigs has not read the nonce accounts of this device yet.";
const PAID = "A send of this wallet already pays this deposit address. Get a new deposit address.";
const GONE = "This proposal is not in the list any more.";
const LOG_MAX = 300;
export const NOTHING_PROPOSED = "Nothing was proposed.";
/** The keys that give the focus back (data-key): the heading of a review, the list of sends. */
export const LOOK_TITLE = "sol-look-title";
export const PROPOSALS_KEY = "sol-proposals";
export const reviewKey = (id, seat) => `sol-review-${id}-${seat}`;

/** The words and the tone (a class of the badge) of each state of a row. */
export const CHIPS = {
  collecting: ["Waiting for approvals", "plain"],
  mine: ["Your approval", "warn"],
  signing: ["Signing", "info"],
  signed: ["Signed", "info"],
  unconfirmed: ["May have been sent", "warn"],
  sent: ["Sent", "ok"],
  chain: ["Failed on chain", "bad"],
  failed: ["Failed", "bad"],
  superseded: ["Superseded", "plain"],
};
const SUPERSEDED_TEXTS = new Set([SUPERSEDED, SHARED]);

// ── The send form ──

/** The assets the form offers: USDC only while the last read shows the token account. */
export function offered(c) {
  const r = c.balances;
  return r.usdc === null ? ["sol"] : ["sol", "usdc"];
}

// The error of a typed amount that the last read refutes, or null.
function balanceError(c, asset, units) {
  const r = c.balances;
  if (asset === "usdc" && r.usdc === null) return { field: "asset", text: NO_USDC };
  if (r.at === null) return { field: "amount", text: NOT_READ };
  const text = `The balance is ${amountText(r[asset], DECIMALS[asset])} ${UNITS[asset]}.`;
  return units > r[asset] ? { field: "amount", text } : null;
}

/**
 * The first error of the typed send as { field, text }, or null. An asset, an address, the address
 * of this wallet, zero, too many decimals, more than the balance read, USDC without its account,
 * and no free nonce account (when the last read knows) are refused. The checker still judges the
 * send: these are the cases that Zigs can name before it reads the chain.
 */
export function formError(c, typed) {
  let checked;
  try {
    checked = checkTyped(typed);
  } catch (e) {
    return { field: e.field ?? "asset", text: e.message };
  }
  if (checked.to === agreement(c).done?.groupKey) return { field: "recipient", text: OWN_ADDRESS };
  const bad = balanceError(c, typed.asset, checked.units);
  if (bad) return bad;
  return freeNonces(c) === 0 ? { field: "asset", text: NO_NONCE } : null;
}

/**
 * Why the plain wallet cannot pay `units` lamports (a BigInt) to the deposit of a swap now, or
 * null.
 * The key setup must have ended and the balance must be read. The balance must hold the amount,
 * and 0 or the rent minimum must stay. A free nonce account and a seat of this browser that pays
 * the fee, with SOL at its fee address, must be there. The checker still judges the send.
 */
export function swapPayError(c, units) {
  if (!agreement(c).done) return NO_SETUP;
  const bad = balanceError(c, "sol", units);
  if (bad) return bad.text;
  const rest = c.balances.sol - units;
  if (rest !== 0n && rest < RENT_ZERO) {
    return `After this payment the Solana address of this wallet would hold ${rest} lamports. `
      + `Solana needs 0 or at least ${RENT_ZERO} lamports there. Change the amount.`;
  }
  const free = freeNonces(c);
  if (free === null) return NONCES_UNREAD;
  return free === 0 ? NO_NONCE : payerError(c);
}

// Why no seat of this browser can pay the fee of a send, or null.
function payerError(c) {
  let seat;
  try {
    seat = payerSeat(c);
  } catch (e) {
    return String(e?.message ?? e);
  }
  return c.balances.fees?.[seat] === 0n ? `Device ${seat} has no SOL at its fee address.` : null;
}

/** The reason not to propose a second send to the deposit address `deposit`, or null. */
export const depositPaid = (c, deposit) =>
  (c.sessions.some((o) => showable(o) && swapOf(o)?.deposit === deposit) ? PAID : null);

/** The nonce accounts of this device that no open proposal holds, or null while unknown. */
export function freeNonces(c) {
  const held = c.balances.nonces;
  if (!held) return null;
  const used = heldIndexes(c.sessions, held.seat);
  return held.ks.filter((k) => !used.has(k)).length;
}

// ── The rows ──

const unsure = (c, ss) => ss.status === "signed" && (c.fails.get("send:" + ss.id) ?? 0) > 0;

/** The seats of this browser that may review and approve the proposal `ss` now. */
export function approveSeats(c, ss) {
  if (ss.status !== "collecting" || !showable(ss) || !payerOf(c, ss)) return [];
  const { localSeats, canWriteAs } = c.host;
  return localSeats().filter((seat) => canWriteAs(seat) && !c.commits[ss.id]?.[seat]
    && holdsShare(solOf(c.host, c.gid, seat)));
}

function stateOf(c, ss, seats) {
  if (ss.status === "collecting") return seats.length ? "mine" : "collecting";
  if (ss.status === "failed") return SUPERSEDED_TEXTS.has(ss.error) ? "superseded" : "failed";
  if (ss.status === "sent") return ss.outcome === "failed" ? "chain" : "sent";
  return unsure(c, ss) ? "unconfirmed" : ss.status;
}

/**
 * The rows of the sends, newest first: { id, title, by, state, word, tone, seats, ended, error,
 * txId }. `state` is a key of CHIPS. `txId` (base58 of the fee signature) is there once the
 * session is signed. The row holds no recipient and no amount.
 */
export function rowsOf(c) {
  return c.sessions.filter((ss) => showable(ss)).map((ss) => {
    const seats = approveSeats(c, ss);
    const state = stateOf(c, ss, seats);
    const [word, tone] = CHIPS[state];
    const txId = ["signed", "sent"].includes(ss.status) ? base58(ss.feeSig) : null;
    const error = ss.status === "failed" ? String(ss.error ?? "").slice(0, LOG_MAX) : "";
    return { id: ss.id, title: titleOf(ss), by: ss.by, state, word, tone, seats, error, txId,
      ended: ENDED.has(ss.status) };
  });
}

/** The proposals that a seat of this browser can approve: the count of Approvals. */
export const pendingList = (c) =>
  (blockNow(c) ? [] : c.sessions.filter((ss) => approveSeats(c, ss).length > 0));

/** The same as rows of the inbox: id, title and the proposing seat. */
export const pendingRows = (c) =>
  pendingList(c).map((ss) => ({ id: ss.id, title: titleOf(ss), by: ss.by }));

// ── The review before an approval ──

/**
 * Reviews the proposal `id` for `seat`. The proposal is the one in c.sessions now, never a copy
 * from an earlier draw. The result is in c.look: step "reading", then "shown" (the checker
 * accepted: result has the rows), "stopped" (the checker refused or the proposal cannot be
 * reviewed: text, and the review of a refusal) or "failed" (the read failed: text).
 */
export async function startLook(c, ensure, id, seat) {
  const ss = c.sessions.find((s) => s.id === id);
  const state = { id, seat, step: "reading", ss, note: "" };
  c.look = state;
  c.host.render();
  let change;
  try {
    if (!ss) throw new Error(GONE);
    const found = await reviewSession(c, ensure, ss, seat);
    change = found.ok ? { step: "shown", result: found }
      : { step: "stopped", text: found.why, review: found.review };
  } catch (e) {
    change = { step: "failed", text: String(e?.message ?? e) };
  }
  if (c.look !== state) return;
  Object.assign(state, change);
  c.host.focusAfter(LOOK_TITLE, true);
  c.host.render();
}

/** Closes the review. */
export function closeLook(c) {
  const look = c.look;
  c.look = null;
  if (look) c.host.focusAfter(reviewKey(look.id, look.seat), true);
  c.host.render();
}

// The review that an approval needs: shown, of this proposal and this seat, and the page still
// holds the same proposal. Null otherwise.
function lookedAt(c, id, seat) {
  const { look } = c;
  const ss = c.sessions.find((s) => s.id === id);
  if (look?.step !== "shown" || look.id !== id || look.seat !== seat) return null;
  return ss && sameProposal(c.sessions, look.ss) ? { look, ss } : null;
}

/**
 * Approves the proposal that the person reviewed (lookedAt). The fresh read must give the same
 * rows. A failure stays on the screen as its note. Returns true when the approval was sent.
 */
export async function approveLooked(c, ensure, id, seat) {
  const found = lookedAt(c, id, seat);
  if (!found) throw new Error(NOT_LOOKED);
  const { look, ss } = found;
  try {
    await approvePlain(c, ensure, ss, seat, look.result.rows);
  } catch (e) {
    look.note = String(e?.message ?? e);
    c.host.announce(look.note);
    c.host.render();
    return false;
  }
  if (c.look === look) c.look = null;
  c.host.focusAfter(PROPOSALS_KEY, true);
  return true;
}

// ── The live region ──

// The seat that moved the session into its status: the proposer, or the writer of the part (the
// raw document names it). A status that a seat of this browser wrote was said by the step that
// wrote it.
const WRITER = { signing: "packageBy", signed: "signedBy", sent: "sentBy", failed: "errorBy" };
const writtenHere = (c, ss) => c.host.localSeats().includes(ss.status === "collecting" ? ss.by
  : c.raw[SESSIONS]?.[ss.id]?.[WRITER[ss.status]]);

const SAID = {
  collecting: (ss) => `New proposal: ${titleOf(ss)} from device ${ss.by}. It waits for approvals.`,
  signing: (ss) => `${titleOf(ss)}: signing started.`,
  signed: (ss) => `${titleOf(ss)}: signed by the group.`,
  sent: (ss) => `${titleOf(ss)}: ${ss.outcome === "failed" ? "sent, and it failed on the chain."
    : "sent and confirmed."}`,
  failed: (ss) => `${titleOf(ss)}: ${String(ss.error ?? "failed").slice(0, LOG_MAX)}`,
};

// The sessions and the documents behind them are read and checked.
const sessionsRead = (c) => c.loaded[SESSIONS] && c.sessWait === 0 && c.wait === 0;

// A change that needs no words: the first pass, a status that a seat of this browser wrote, and
// a session that appeared in a status after the proposal (nobody watched its start).
const quiet = (c, ss, { before, first }) =>
  first || writtenHere(c, ss) || (before === undefined && ss.status !== "collecting");

/**
 * Says each status change that another device wrote, once, through host.announce (one region for
 * the page: no node of the view carries a live role). The first pass after the documents are read
 * only records the statuses. A session that appears later is said when it is a new proposal.
 */
export function announceChanges(c) {
  if (!sessionsRead(c)) return;
  const first = c.said === null;
  c.said ??= new Map();
  const words = [];
  for (const ss of c.sessions.filter((one) => showable(one))) {
    const before = c.said.get(ss.id);
    if (before === ss.status) continue;
    c.said.set(ss.id, ss.status);
    if (!quiet(c, ss, { before, first })) words.push(SAID[ss.status](ss));
  }
  if (words.length) c.host.announce(words.join(" "));
}
