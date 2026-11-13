// The live swap from ZEC to SOL (docs/zec-to-sol-swap.md). A group payment of the wallet pays the
// deposit address of NEAR Intents. The swap pays the plain Solana address of the wallet, and a
// refund goes to the transparent address of the group (app-taddress.js). The note of the payment
// marks it as a swap. Each device that approves it reads the swap of the deposit address from NEAR
// Intents and approves only a swap that pays this wallet. This check trusts the Worker and NEAR
// Intents: it does not check the signature of the quote. No device sends the payment in the last
// 30 minutes before the deadline, because a late deposit can be lost.
import { NearIntentsSwapProvider } from "./near-intents-swap-provider.js";
import { netName } from "./app-chain.js";
import { render } from "./app-loop.js";
import { openSend } from "./app-send.js";
import { plainLoad, plainSol } from "./app-sol.js";
import { fmtZec, said } from "./app-kit.js";
import { log, state, ui } from "./app-state.js";
import { groupTaddress } from "./app-taddress.js";
import { payeeRows } from "./requests.js";
import { expiryAt } from "./app-payments.js";
import { openSession } from "./app-groups.js";
import { SWAP_ASSETS, swapDecimal } from "./swap-preview-model.js";

/** No device approves or sends a swap payment in this time before the deadline of its deposit. */
export const SWAP_MARGIN_MS = 30 * 60_000;
const NOTE_HEAD = "ZEC to SOL swap through NEAR Intents. Pay before ";
const LATE = "The deposit address of this swap closes in less than 30 minutes. A late deposit "
  + "can be lost.";
const LATE_SEND = LATE + " This browser does not send the payment. The wallet can send again when "
  + "the payment expires.";

/** The note of the payment of a swap with the deadline `iso`: 74 characters (the field takes
 * 80). */
export const swapNote = (iso) => NOTE_HEAD + new Date(iso).toISOString() + ".";

/** The deadline (ms) of a payment whose note marks a swap, else null. */
export function swapDeadline(note) {
  if (typeof note !== "string" || !note.startsWith(NOTE_HEAD) || !note.endsWith(".")) return null;
  const iso = note.slice(NOTE_HEAD.length, -1), at = Date.parse(iso);
  return Number.isFinite(at) && new Date(at).toISOString() === iso ? at : null;
}

// A page module imports web/sol only with import() (web/test/graph.mjs). The plain controller has
// loaded both modules already, so they come from the module cache.
let solTools = null, solToolsLoading = null;
function loadSolTools() {
  return solToolsLoading ??= Promise.all([import("./sol/ceremony.js"), import("./sol/docs.js")])
    .then(([ceremony, docs]) => {
      solTools = { agreement: ceremony.agreement, base58: docs.base58 };
      render();
    }, (e) => {
      solToolsLoading = null;
      log("swap from ZEC: the Solana helpers did not load: " + said(e));
    });
}

/** The plain Solana address of the open wallet, or null before its key setup agreed. */
export function plainSolAddress() {
  const c = plainSol?.ctl;
  if (!c || c.gid !== state.gid) return null;
  if (!solTools) { loadSolTools(); return null; }
  try {
    const ag = solTools.agreement(c);
    return ag.state === "agree" ? solTools.base58(ag.done.groupKey) : null;
  } catch { return null; }   // a key setup that the helpers cannot read has no address yet
}

const REASONS = [
  [(g) => !g, "Choose a mainnet wallet to pay the ZEC."],
  [(g) => netName(g) !== "mainnet",
    "This wallet uses Zcash testnet. NEAR Intents takes mainnet ZEC only."],
  [(g) => !!g.movedTo, "This wallet was replaced. Open the new wallet to swap."],
];
const NO_SOL = "The Solana address of this wallet shows after its Solana key setup ends. Open the "
  + "Solana tab of the wallet.";
// The refund address waits for the key of each device: the iPhone and Mac apps publish none yet.
function refundReason(t) {
  if (t.of) {
    return "The refund address of this wallet needs the key of each device: " + t.published
      + " of " + t.of + " devices published one. Each device must open this wallet once in the "
      + "web app: the iPhone and Mac apps cannot publish a key yet.";
  }
  return "The refund address of this wallet is not ready. " + (t.error || "Open the wallet again.");
}

/**
 * The addresses of a live swap from ZEC for the open wallet: {recipient, refundTo, pay}, where
 * pay(swap) opens Send with the payment of the deposit. Else {reason}.
 */
export function zecSwapSource() {
  const g = state.g, hit = REASONS.find(([bad]) => bad(g));
  if (hit) return { reason: hit[1] };
  const recipient = plainSolAddress();
  if (!recipient) return { reason: NO_SOL };
  const t = groupTaddress();
  if (!t.address) return { reason: refundReason(t) };
  return { recipient, refundTo: t.address, pay: proposeDeposit, proposal: depositProposal };
}

// Locate an existing proposal by its checked swap marker and exact deposit terms. Display
// only: an entry here does not establish submission or receipt and never makes a new payment.
function depositProposal(swap) {
  const ss = state.sessions.find((s) => swapDeadline(s.note) === Date.parse(swap.deadline)
    && s.payees?.length === 1 && s.payees[0].to === swap.depositAddress
    && String(s.payees[0].amount) === swap.amountIn);
  return ss ? { id: ss.id, expiryHeight: expiryAt(ss), open() {
    ui.tab = "approvals"; openSession(ss.id); render();
  } } : null;
}

// Send opens with the deposit address, the exact amount in zatoshi and the note of the swap. The
// person reviews the payment and proposes it as any other.
function proposeDeposit(swap) {
  const rows = payeeRows([{ to: swap.depositAddress, amount: Number(swap.amountIn) }],
    () => ++ui.payKey);
  openSend({ pay: rows, listError: "", note: swapNote(swap.deadline), priority: false,
    sendFor: null, after: null });
  render();
}

// A note that names a swap or NEAR Intents, on a payment with a transparent payee.
const SWAPPY = /\b(swap|near\s*intents|1click)\b/i;
const lookalike = (ss) => typeof ss.note === "string" && SWAPPY.test(ss.note)
  && Array.isArray(ss.payees) && ss.payees.some((p) => /^t/.test(p?.to ?? ""));
const LOOKALIKE = "The note names a swap, but it is not the note of the Swap page, so this "
  + "browser cannot check the swap. It did not approve. Propose the swap again from the Swap page.";

// The one payee of a swap payment: one transparent output with no memo.
function payeeOf(ss) {
  const payees = Array.isArray(ss.payees) ? ss.payees : [];
  const [p] = payees;
  return payees.length === 1 && typeof p?.to === "string" && !p.memo ? p : null;
}

// The first difference between the swap that NEAR Intents lists and this payment, or null.
function mismatch(status, own, p, payBy) {
  const s = status.swap ?? {};
  const wrong = [
    [status.status !== "PENDING_DEPOSIT",
      "NEAR Intents does not wait for a deposit at this address."],
    [s.from !== "zec" || s.to !== "sol", "This address is not for a swap from ZEC to SOL."],
    [s.plain !== true, "The swap has another form than the one that Zigs asks for: an app fee, "
      + "another slippage or another type of address."],
    [s.recipient !== own.recipient,
      "The swap pays another Solana address than the one of this wallet."],
    [s.refundTo !== own.refundTo,
      "The swap refunds to another address than the transparent address of this wallet."],
    [!Number.isSafeInteger(p.amount) || s.amountIn !== String(p.amount),
      "The swap takes another amount than this payment."],
    [Date.parse(s.deadline) !== payBy, "The deadline of the swap is not the one in the note."],
  ].find(([bad]) => bad);
  return wrong ? wrong[1] : null;
}

// The Solana address of the wallet once the plain controller has read the documents of its key
// setup. ponytail: asks every 200 ms for at most 10 s; the upgrade is an event of the controller.
async function solAddressSoon() {
  for (const end = Date.now() + 10_000; Date.now() < end;) {
    const address = plainSolAddress();
    if (address) return address;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}
// A device that approves may not have shown the Swap tab or loaded the plain controller: both
// load first. A testnet wallet has no plain Solana address.
async function ownAddresses() {
  if (netName(state.g) !== "mainnet") return {};
  if (!plainSol) await plainLoad();
  await loadSolTools();
  return { recipient: await solAddressSoon(), refundTo: groupTaddress().address };
}

async function swapRefusal(ss, payBy, provider, given) {
  const p = payeeOf(ss);
  if (!p) return "A swap payment has one recipient and no memo.";
  if (payBy - Date.now() < SWAP_MARGIN_MS) return LATE;
  const own = given ?? await ownAddresses();
  if (!own.recipient || !own.refundTo) {
    return "This browser cannot read the Solana address or the refund address of this wallet.";
  }
  const status = await provider.swapStatus(p.to).catch(() => null);
  if (!status) return "NEAR Intents did not give the state of the swap. Try again.";
  return mismatch(status, own, p, payBy);
}

/**
 * Refuses the approval of a swap payment (its note marks it) unless NEAR Intents waits at the
 * deposit address for the exact amount of a swap from ZEC to SOL that pays the Solana address of
 * this wallet, refunds to its transparent address and ends at the deadline of the note, with 30
 * minutes left. A note that names a swap in another form is refused for a transparent payee,
 * because a proposer could write it to look like the swap note. Another payment passes with no
 * request. `own` holds the Solana and the refund address of the wallet; the tests give them.
 */
export async function checkSwap(ss, provider = new NearIntentsSwapProvider(), own = null) {
  const payBy = swapDeadline(ss.note);
  if (payBy === null) {
    if (lookalike(ss)) throw new Error(LOOKALIKE);
    return;
  }
  const why = await swapRefusal(ss, payBy, provider, own);
  if (why) throw new Error(why + " This browser did not approve.");
}

// The swap of the deposit address of each swap payment, read once for its review: null while the
// read runs. The approval reads it again.
const reviews = new Map();
const SOL = SWAP_ASSETS.find((a) => a.key === "sol");

function quoteLine(s, own) {
  if (s === null) return "Reading the quote of NEAR Intents…";
  if (s.to !== "sol" || !s.recipient || !/^\d+$/.test(s.amountOut ?? "")) {
    return "NEAR Intents did not give a quote to SOL for this deposit address.";
  }
  const whose = own == null ? "" : s.recipient === own ? ", the Solana address of this wallet"
    : ". That is not the Solana address of this wallet";
  return "The quote of NEAR Intents pays about " + swapDecimal(s.amountOut, SOL)
    + " SOL to the Solana address " + s.recipient + whose + ".";
}

/**
 * The sentences of the review of the swap payment `ss`: what it pays to the deposit address, and
 * what the quote of NEAR Intents for that address pays to which Solana address. Null for another
 * payment. The first call starts the read, and the page draws again when it ends. `own` is the
 * Solana address of this wallet; the tests give it.
 */
export function swapReview(ss, provider = new NearIntentsSwapProvider(), own = plainSolAddress()) {
  const p = swapDeadline(ss.note) === null ? null : payeeOf(ss);
  if (!p) return null;
  if (!reviews.has(p.to)) {
    reviews.set(p.to, null);
    provider.swapStatus(p.to).then((st) => reviews.set(p.to, st?.swap ?? {}),
      () => reviews.set(p.to, {})).finally(() => render());
  }
  return ["This payment pays " + fmtZec(p.amount) + " to the deposit address " + p.to
    + " of NEAR Intents.", quoteLine(reviews.get(p.to), own)];
}

/** The reason not to send a swap payment: its deposit closes in less than 30 minutes. */
export function swapSendRefusal(ss, now = Date.now()) {
  const payBy = swapDeadline(ss.note);
  return payBy !== null && payBy - now < SWAP_MARGIN_MS ? LATE_SEND : null;
}
