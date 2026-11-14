// SOL-to-ZEC funding from the wallet's plain account or its private pool. A private withdrawal
// refunds to the proposing device's recoverable public fee address, with explicit consent.
// Each approving device binds the authenticated provider quote to its checked deposit, amount,
// wallet recipient and refund destination. Execution status still depends on the provider.
import { NearIntentsSwapProvider } from "./near-intents-swap-provider.js";
import { addrHidden, chain, netName } from "./app-chain.js";
import { plainSol, sol, solLoad, solMode } from "./app-sol.js";
import { state } from "./app-state.js";
import { plainSolAddress } from "./app-swap-zec.js";
import { SWAP_ASSETS, swapDecimal } from "./swap-preview-model.js";
import { nearExecutionMode, nearRouteLabel } from "./near-swap-policy.js";

const NO_SOL = "The Solana address of this wallet shows after its Solana key setup ends. Open the "
  + "Solana tab of the wallet.";
const OTHER_WALLET = "This swap refunds to another wallet. Open the wallet that pays it.";
const NOT_OPEN = "This browser shows another wallet now. Open the wallet of this send and try "
  + "again.";
const [ZEC, SOL] = ["zec", "sol"].map((key) => SWAP_ASSETS.find((a) => a.key === key));

/**
 * The ZEC address that a live swap pays to: the one of the open mainnet wallet, under the rules of
 * its Receive card. Else the reason why there is none.
 */
export function swapPayout() {
  const g = state.g;
  if (!g) return { reason: "Choose a mainnet wallet to receive the ZEC." };
  if (netName(g) !== "mainnet") {
    return { reason: "This wallet uses Zcash testnet. NEAR Intents pays mainnet ZEC only." };
  }
  if (g.movedTo) return { reason: "This wallet was replaced. Open the new wallet to receive." };
  if (addrHidden() || !state.wallet?.address) {
    return { reason: "This wallet shows its address after this device checks the address." };
  }
  return { address: state.wallet.address };
}

// The plain controller of the open wallet, or null.
const plainHere = () => (plainSol?.ctl.gid === state.gid ? plainSol : null);

// Why the plain wallet cannot pay `lamports` (a decimal text) now, or null. The question shows the
// wallet to the controller, which then reads the balances (at most once in 30 s).
function payReady(lamports) {
  const p = plainHere();
  if (!p) return NO_SOL;
  p.observe(state.gid);
  return p.swapReady(lamports);
}

// The plain proposal of the deposit of `swap` (a live swap of the Swap page). Resolves with the id
// of the session, or throws the reason.
async function proposeDeposit(swap) {
  const p = plainHere();
  if (!p) throw new Error(NO_SOL);
  if (swap.refundTo !== plainSolAddress()) throw new Error(OTHER_WALLET);
  return p.proposeSwap({ deposit: swap.depositAddress, lamports: swap.amountIn,
    deadline: swap.deadline, confidentiality: swap.confidentiality });
}

/**
 * The parts of a live swap from SOL that the plain wallet pays: { refundTo, ready, pay, proposal },
 * where ready(lamports) says why the wallet cannot pay now (or null), pay(swap) proposes the
 * deposit and resolves with the id of the send, and proposal(id) gives the row of that send.
 * Else { reason }.
 */
export function solSwapSource() {
  const mode = solMode();
  if (["private", "accept", "unserved"].includes(mode)) {
    if (mode === "accept") return { mode: "private", reason: "Open Solana and accept this wallet's private mode on this device." };
    if (mode === "unserved") return { mode: "private", reason: "This server does not offer private Solana funding." };
    if (!sol || sol.ctl.gid !== state.gid) {
      solLoad();
      return { mode: "private", reason: "Loading your private Solana wallet. If it is not set up, open Solana to finish setup." };
    }
    sol.observe(state.gid);
    const info = sol.swapInfo();
    if (info.reason) return info;
    return { ...info, ready: (amount) => sol.swapReady(amount),
      pay: (swap) => sol.proposeSwap(swap), proposal: (id) => sol.swapRow(id),
      proposalForDeposit: (address) => sol.swapForDeposit(address) };
  }
  const refundTo = plainSolAddress();
  if (!refundTo) return { reason: NO_SOL };
  plainHere()?.observe(state.gid);
  const balance = plainHere()?.ctl.balances;
  const balanceAtomic = typeof balance?.sol === "bigint" && balance.at && !balance.error
    && Date.now() - balance.at <= 30_000 ? String(balance.sol) : null;
  return { mode: "plain", balanceLabel: "Public SOL balance", balanceAtomic,
    refundTo, ready: payReady, pay: proposeDeposit,
    proposal: (id) => plainHere()?.sendRow(id) ?? null };
}

/** Receipt evidence comes from the open wallet's scanner, never from provider SUCCESS alone. */
export function shieldedSwapReceipt(swap, hashes) {
  if (chain?.gid !== state.gid || swap.recipient !== state.wallet?.address || !hashes?.length) return null;
  const rows = (chain.received || []).filter((r) => hashes.includes(r.txid));
  if (!rows.length || rows.some((r) => !Number.isSafeInteger(r.value) || r.value <= 0)) return null;
  const amount = rows.reduce((sum, r) => sum + BigInt(r.value), 0n);
  return { amount: String(amount), confirmed: rows.every((r) => r.confirmed === true),
    meetsMinimum: amount >= BigInt(swap.minAmountOut) };
}

const utc = (iso) => iso.slice(0, 10) + " " + iso.slice(11, 19) + " UTC";

// The first difference between the swap that NEAR Intents lists and the send `ask`, or null.
function mismatch(status, ask, own) {
  const s = status.swap ?? {};
  const out = /^\d{1,40}$/.test(s.amountOut ?? "") ? BigInt(s.amountOut) : null;
  const wrong = [
    [!nearExecutionMode(s.confidentiality)
      || s.confidentiality !== (ask.confidentiality ?? 'basic'),
      "The requested routing mode could not be confirmed."],
    [status.status !== "PENDING_DEPOSIT",
      "NEAR Intents does not wait for a deposit at this address."],
    [s.from !== "sol" || s.to !== "zec", "This address is not for a swap from SOL to ZEC."],
    [s.plain !== true, "The swap has another form than the one that Zigs asks for: an app fee, "
      + "another slippage or another type of address."],
    [s.recipient !== own.address, "The swap pays another ZEC address than the one of this wallet."],
    [s.refundTo !== ask.refundTo,
      "The swap refunds to another Solana address than the one of this wallet."],
    [s.amountIn !== ask.lamports, "The swap takes another amount than this send."],
    [Date.parse(s.deadline) !== Date.parse(ask.deadline),
      "The deadline of the swap is not the one of the proposal."],
    [out === null || out <= 0n, "The swap has no valid ZEC payout amount."],
  ].find(([bad]) => bad);
  return wrong ? wrong[1] : null;
}

/**
 * The check of a swap deposit of the plain wallet (approve.js of web/sol/plain): `ask` holds the
 * deposit address, the lamports of the checker, the deadline of the proposal and the plain Solana
 * address of this wallet (refundTo). Gives { lines } for the review when NEAR Intents waits for
 * exactly this deposit of a swap from SOL to ZEC that pays this wallet’s ZEC address,
 * refunds to `refundTo` and ends at the deadline. Else { why }. `own` is swapPayout() with
 * the plain Solana address of the open wallet (refundTo), which must be the one of `ask`: the ZEC
 * address comes from the open wallet. The tests give `own`.
 */
export async function checkSolSwap(ask, provider = new NearIntentsSwapProvider(),
  own = { ...swapPayout(), refundTo: plainSolAddress() }) {
  if (!own.address) return { why: own.reason + " This browser did not approve." };
  if (ask.refundTo !== own.refundTo) return { why: NOT_OPEN };
  const status = await provider.swapStatus(ask.deposit).catch(() => null);
  if (!status) return { why: "NEAR Intents did not give the state of the swap. Try again." };
  const why = mismatch(status, ask, own);
  if (why) return { why: why + " This browser did not approve." };
  return { lines: [
    (ask.mode === "private" ? "This public withdrawal from private SOL pays " : "This send pays ") + "the deposit address " + ask.deposit + " of a swap from SOL to ZEC through "
      + "NEAR Intents.",
    "NEAR Intents waits for " + swapDecimal(ask.lamports, SOL) + " SOL and pays about "
      + swapDecimal(status.swap.amountOut, ZEC) + " ZEC to the ZEC address of this wallet. A "
      + (ask.mode === "private" ? "refund goes to the proposing device's public fee address; that device controls the refund until it is added back to private SOL."
        : "refund goes to the Solana address of this wallet."),
    "Pay before " + utc(new Date(Date.parse(ask.deadline)).toISOString()) + ". No device "
      + "approves or sends it in the last 30 minutes.",
    "Routing: " + nearRouteLabel(status.swap.confidentiality) + ". NEAR Intents sees the route.",
  ] };
}
