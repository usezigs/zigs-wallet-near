// Public controller surface for swaps. No share, fee secret or proof material leaves here.
import { base58 } from "./docs.js";
import { readyFee } from "./fee.js";
import { payerSeat, signingBlock } from "./gate.js";
import { provesLocally } from "./localprove.js";
import { propose } from "./propose.js";
import { heldLamports, spentLamports } from "./sessions.js";
import { poolSwapMark, poolSwapOf } from "./swap.js";
import { nearExecutionMode } from "../near-swap-policy.js";

export function privateSwapInfo(c) {
  if (c.wallet?.cluster !== "mainnet" || c.gid !== c.host.state.gid) {
    return { mode: "private", reason: "Private SOL swaps require this wallet on Solana mainnet." };
  }
  const why = signingBlock(c);
  if (why) return { mode: "private", reason: why };
  try {
    const seat = payerSeat(c), fee = readyFee(c, seat);
    return { mode: "private", refundTo: base58(fee.key), refundDevice: seat,
      balanceAtomic: availablePoolBalance(c),
      balanceLabel: "Private SOL balance",
      refundLabel: "Public fee address of device " + seat };
  } catch (e) { return { mode: "private", reason: e.message }; }
}

function availablePoolBalance(c) {
  if (!/^\d+$/.test(String(c.sync.lamports))) return null;
  const notes = c.sync.notes || [];
  const available = BigInt(c.sync.lamports) - heldLamports(c.sessions, notes)
    - spentLamports(c.sessions, notes);
  return String(available > 0n ? available : 0n);
}

export function privateSwapReady(c, amount) {
  const info = privateSwapInfo(c);
  if (info.reason) return info.reason;
  if (!provesLocally(c)) {
    return "Open Solana and enable local proving before funding a swap from private SOL.";
  }
  if (c.sync.busy || info.balanceAtomic === null) {
    return "Sync your private SOL balance in Solana before swapping.";
  }
  if (!/^\d+$/.test(String(amount))
    || BigInt(amount) <= 0n) return "Enter an amount of SOL greater than zero.";
  if (BigInt(amount) > BigInt(info.balanceAtomic)) {
    return "The amount exceeds your available private SOL balance.";
  }
  return null;
}

export async function proposePoolSwap(c, swap) {
  if (!nearExecutionMode(swap.confidentiality)) {
    throw new Error("Choose a supported routing mode. Review a new swap before paying.");
  }
  const info = privateSwapInfo(c), why = privateSwapReady(c, swap.amountIn);
  if (why) throw new Error(why);
  if (swap.refundTo !== info.refundTo) {
    throw new Error("The refund device changed. Review a new swap before paying.");
  }
  return c.host.exclusive("pool-swap:" + c.gid + ":" + swap.depositAddress, () => propose(c,
     "withdraw", {
    recipient: swap.depositAddress,
    amount: decimalSol(swap.amountIn),
    swap: poolSwapMark(swap.depositAddress, swap.deadline, swap.confidentiality),
  }));
}

function decimalSol(value) {
  const n = BigInt(value);
  return String(n / 1_000_000_000n) + "." + String(n % 1_000_000_000n).padStart(9, "0");
}

export function poolSwapRow(c, id) {
  const ss = c.sessions.find((s) => s.id === id);
  if (!ss || !poolSwapOf(ss)) return null;
  const count = Object.keys(c.commits[ss.id] ?? {}).length, required = c.host.state.g?.t;
  const words = { collecting: `${count} of ${required} device approvals`,
     signing: "Signing withdrawal",
    signed: "Approved; executing public withdrawal", sent: "Withdrawal confirmed on Solana",
       failed: "Withdrawal stopped" };
  return { id: ss.id, word: words[ss.status] || "Checking withdrawal", error: ss.error,
    status: ss.status, txId: ss.txId, approvals: count };
}
