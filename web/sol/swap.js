// A swap funded by a withdrawal from the private pool. The proposal author signs the mark;
// the checked withdrawal binds the deposit, exact amount and an on-chain expiry before the
// provider deadline. Every approving device also checks the provider's destination and refund.
import { base58 } from "./docs.js";
import { payerOf } from "./fee.js";
import { decodeIntent } from "./intent.js";
import { nearExecutionMode } from "../near-swap-policy.js";

export const POOL_SWAP_MARGIN_MS = 30 * 60_000;
const MARK = new RegExp('^near-private-sol-zec ([1-9A-HJ-NP-Za-km-z]{32,44}) '
  + '(\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z)(?: (public|basic|advanced))?$');
export const poolSwapMark = (deposit, deadline, confidentiality) =>
  `near-private-sol-zec ${deposit} ${deadline} ${confidentiality}`;
const withdrawalFits = (ss, swap, intent) => intent?.kind === "withdraw"
  && base58(intent.recipient) === swap.deposit
  && Number(intent.expiry) * 1000 <= swap.cutoff
  && Number(ss.expiry) === Number(intent.expiry);
const supportsSwap = (swap) => swap.explicit && nearExecutionMode(swap.confidentiality);

export function poolSwapOf(ss) {
  const match = typeof ss?.swap === "string" && MARK.exec(ss.swap);
  if (!match || !Number.isFinite(Date.parse(match[2]))) return null;
  if (new Date(Date.parse(match[2])).toISOString() !== match[2]) return null;
  return { deposit: match[1], deadline: match[2],
    confidentiality: match[3] || 'public',
    explicit: !!match[3],
     cutoff: Date.parse(match[2]) - POOL_SWAP_MARGIN_MS };
}

/** Undefined means an ordinary payment. Any supplied, malformed mark fails closed. */
export function poolSwapProblem(ss, now = Date.now()) {
  if (ss?.swap === undefined) return null;
  const swap = poolSwapOf(ss), intent = decodeIntent(ss.intent);
  if (!swap || !withdrawalFits(ss, swap, intent)) {
    return "The swap mark, deposit or withdrawal expiry does not match. Propose the swap again.";
  }
  if (!supportsSwap(swap)) {
    return "This proposal does not pin a supported routing mode. Review a new swap.";
  }
  if (now >= swap.cutoff) {
    return "The swap approval window closed. Do not send to this deposit address.";
  }
  return null;
}

/** Must run before any nonce is made and again before an execute is signed. */
export async function checkPoolSwap(c, ss) {
  if (ss.swap === undefined) return;
  const why = poolSwapProblem(ss);
  if (why) throw new Error(why);
  const result = await c.host.swapCheck(poolSwapAsk(c, ss));
  checkSwapResult(result);
  // The network read can cross the deadline. Recheck immediately before returning to signing.
  const late = poolSwapProblem(ss);
  if (late) throw new Error(late);
  return result;
}

function poolSwapAsk(c, ss) {
  if (c.wallet?.cluster !== "mainnet") {
    throw new Error("Live swaps require Solana mainnet. No test SOL was sent.");
  }
  const swap = poolSwapOf(ss), intent = decodeIntent(ss.intent), payer = payerOf(c, ss);
  if (!payer || !c.host.swapCheck) {
    throw new Error("This device cannot verify the swap. Nothing was approved.");
  }
  return { mode: "private", deposit: swap.deposit, lamports: String(intent.amount),
    deadline: swap.deadline, refundTo: base58(payer), confidentiality: swap.confidentiality };
}

function checkSwapResult(result) {
  if (!result || result.why || !Array.isArray(result.lines) || !result.lines.length) {
    throw new Error(result?.why || "The swap could not be verified.");
  }
}
