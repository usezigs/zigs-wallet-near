// The live swap from SOL to ZEC that the plain Solana wallet of the group pays
// (docs/sol-to-zec-group.md). The Swap page asks /near/swap-sol-group for a deposit address, with
// the plain Solana address of the wallet as the refund address. Propose the payment makes one
// plain send of the exact lamports to the deposit address, marked as this swap. Each device that
// reviews or approves that send runs checkSolSwap (the key swapCheck of solHost): NEAR Intents must
// wait for exactly this deposit, for a swap that pays the ZEC address of this wallet and refunds
// to its Solana address. This check trusts the Worker and NEAR Intents: it does not check the
// signature of the quote.
import { NearIntentsSwapProvider } from "./near-intents-swap-provider.js";
import { addrHidden, atCap, knownTotal, netName, netOf } from "./app-chain.js";
import { plainSol } from "./app-sol.js";
import { state } from "./app-state.js";
import { plainSolAddress } from "./app-swap-zec.js";
import { SWAP_ASSETS, swapDecimal } from "./swap-preview-model.js";

const NO_SOL = "The Solana address of this wallet shows after its Solana key setup ends. Open the "
  + "Solana tab of the wallet.";
const OTHER_WALLET = "This swap refunds to another wallet. Open the wallet that pays it.";
const OVER_CAP = "The payout would take the wallet over the warning level for unaudited mainnet "
  + "wallets (0.5 ZEC).";
const [ZEC, SOL] = ["zec", "sol"].map((key) => SWAP_ASSETS.find((a) => a.key === key));

/**
 * The ZEC address that a live swap pays to: the one of the open mainnet wallet, under the rules of
 * its Receive card, with the room under the cap in zatoshi. Else the reason why there is none.
 */
export function swapPayout() {
  const g = state.g;
  if (!g) return { reason: "Choose a mainnet wallet to receive the ZEC." };
  if (netName(g) !== "mainnet") {
    return { reason: "This wallet uses Zcash testnet. NEAR Intents pays mainnet ZEC only." };
  }
  if (g.movedTo) return { reason: "This wallet was replaced. Open the new wallet to receive." };
  if (atCap()) {
    return { reason: "This wallet is at the warning level for unaudited mainnet wallets." };
  }
  if (addrHidden() || !state.wallet?.address) {
    return { reason: "This wallet shows its address after its first sync and after this device "
      + "checks the address." };
  }
  return { address: state.wallet.address, room: String(netOf(g).cap - knownTotal()) };
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
    deadline: swap.deadline });
}

/**
 * The parts of a live swap from SOL that the plain wallet pays: { refundTo, ready, pay, proposal },
 * where ready(lamports) says why the wallet cannot pay now (or null), pay(swap) proposes the
 * deposit and resolves with the id of the send, and proposal(id) gives the row of that send.
 * Else { reason }.
 */
export function solSwapSource() {
  const refundTo = plainSolAddress();
  if (!refundTo) return { reason: NO_SOL };
  return { refundTo, ready: payReady, pay: proposeDeposit,
    proposal: (id) => plainHere()?.sendRow(id) ?? null };
}

const utc = (iso) => iso.slice(0, 10) + " " + iso.slice(11, 19) + " UTC";

// The first difference between the swap that NEAR Intents lists and the send `ask`, or null.
function mismatch(status, ask, own) {
  const s = status.swap ?? {};
  const out = /^\d{1,40}$/.test(s.amountOut ?? "") ? BigInt(s.amountOut) : null;
  const wrong = [
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
    [out === null || out > BigInt(own.room), OVER_CAP],
  ].find(([bad]) => bad);
  return wrong ? wrong[1] : null;
}

/**
 * The check of a swap deposit of the plain wallet (approve.js of web/sol/plain): `ask` holds the
 * deposit address, the lamports of the checker, the deadline of the proposal and the plain Solana
 * address of this wallet (refundTo). Gives { lines } for the review when NEAR Intents waits for
 * exactly this deposit of a swap from SOL to ZEC that pays the ZEC address of this wallet under
 * the cap, refunds to `refundTo` and ends at the deadline. Else { why }. `own` is swapPayout();
 * the tests give it.
 */
export async function checkSolSwap(ask, provider = new NearIntentsSwapProvider(),
  own = swapPayout()) {
  if (!own.address) return { why: own.reason + " This browser did not approve." };
  const status = await provider.swapStatus(ask.deposit).catch(() => null);
  if (!status) return { why: "NEAR Intents did not give the state of the swap. Try again." };
  const why = mismatch(status, ask, own);
  if (why) return { why: why + " This browser did not approve." };
  return { lines: [
    "This send pays the deposit address " + ask.deposit + " of a swap from SOL to ZEC through "
      + "NEAR Intents.",
    "NEAR Intents waits for " + swapDecimal(ask.lamports, SOL) + " SOL and pays about "
      + swapDecimal(status.swap.amountOut, ZEC) + " ZEC to the ZEC address of this wallet. A "
      + "refund goes to the Solana address of this wallet.",
    "Pay before " + utc(new Date(Date.parse(ask.deadline)).toISOString()) + ". No device "
      + "approves or sends it in the last 30 minutes.",
  ] };
}
