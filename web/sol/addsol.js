// Add SOL (ZOLANA.md 2 and 5): a pool deposit from the fee address of a seat of this browser into
// the shielded balance of the group. It is the SOL of one member, so the seat signs alone with its
// fee key: no approval round and no group signature. The message has a recent blockhash and no
// nonce, so it never touches the nonce account of the group. The amount and the sender are
// public. The wasm runs the checker on the exact bytes before the fee key signs, so the deposit
// goes to the shielded address of the group and to nobody else. Before that, the approvals
// program must exist on the network, and a wallet with a cap (mainnet) must stay under it.
import { feeSignature } from "./approve.js";
import { agreement } from "./ceremony.js";
import { base58, keyOfBase58 } from "./docs.js";
import { poorText } from "./execute.js";
import { readyFee } from "./fee.js";
import { payerSeat, settledBlock } from "./gate.js";
import { CLUSTERS } from "./guard.js";
import { bytesOf, hexOf, intentHex, lamportsOf, pinsHex, wireBase64 } from "./intent.js";
import { ensureWorker, solText } from "./session.js";
import { programOf } from "./wallet.js";

const LOADER = keyOfBase58("BPFLoaderUpgradeab1e11111111111111111111111");
const CONFIRMED = new Set(["confirmed", "finalized"]);
const NOT_DEPLOYED =
  "The Zigs program of this network is not deployed yet, so Add SOL is refused. Nothing was sent.";
const BUSY = "An Add SOL of this tab is still running. Nothing was sent.";
const NO_CAP =
  "The cap of this private wallet is not known, so Add SOL is refused. Nothing was sent.";
const UNCONFIRMED =
  "The last Add SOL of this tab is not confirmed yet, so the cap cannot count it. Try again " +
  "when it is confirmed, or reload the page if it never arrives. Nothing was sent.";

/** The refusal of the cap, with the most SOL that can still be added (lamports). */
const capText = (cap, room) =>
  `The private balance of this test wallet is capped at ${solText(cap)}. ` +
  `You can add up to ${solText(room)} now. Nothing was sent.`;

/** What the network said to a test run of the deposit, as a text for the page. */
function refusalOf(c, run, seat) {
  const logs = run.logs.join(" | ").slice(0, 300);
  return (
    poorText(c, run, seat) ?? "The network refused this in a test run: " + run.err + " " + logs
  );
}

/**
 * The approvals program of the wallet: on mainnet the last field of the program label that every
 * seat signed. The Devnet label keeps its old bytes and names no program, so Devnet takes the
 * program that its Worker scans.
 */
function programId(c) {
  if (c.wallet?.cluster !== "mainnet") return CLUSTERS.devnet.program;
  const id = programOf(c).split(":").at(-1);
  if (!keyOfBase58(id)) throw new Error(NOT_DEPLOYED);
  return id;
}

/** Refuses unless the approvals program exists, runs, and belongs to the upgradeable loader. */
async function requireProgram(c, worker) {
  const got = await worker.call("recipientAccount", { account: programId(c) });
  if (!got.exists || got.executable !== true || got.owner !== LOADER) {
    throw new Error(NOT_DEPLOYED);
  }
}

// ponytail: the cap counts what this tab knows. Its ceiling: two devices that add at the same
// time, deposits by other people and incoming private payments. The upgrade path: count the
// unconfirmed deposits from a signed log of the group.
// Per group PDA, in the memory of this tab only: an Add SOL that runs, and each Add SOL that the
// chain confirmed (or did not answer) and that a sync did not show yet.
const tabs = new Map();

/**
 * The Add SOL state of this tab for the wallet, or null on Devnet (no cap). Any other wallet
 * without a cap is refused.
 */
function tabOf(c) {
  const { done } = agreement(c);
  if (c.wallet?.cap == null) {
    if (c.wallet?.cluster === "mainnet" || done.cluster !== "devnet") throw new Error(NO_CAP);
    return null;
  }
  if (!tabs.has(done.pda)) tabs.set(done.pda, { busy: false, sent: [] });
  return tabs.get(done.pda);
}

/** Asks the chain again for the last Add SOL with no answer. Refuses while it has none. */
async function settleLast(worker, tab) {
  const last = tab.sent.at(-1);
  if (last?.status !== "unknown") return;
  const { status } = await worker.call("status", { signature: last.txId });
  if (status === "failed") tab.sent.pop();
  else if (CONFIRMED.has(status)) last.status = status;
  else throw new Error(UNCONFIRMED);
}

/**
 * Drops each Add SOL that the sync shows: a note of its amount that was not there before it.
 * One note counts for one Add SOL. Returns the lamports of the ones that the sync does not show.
 */
function unseen(tab, utxos) {
  const notes = [...utxos];
  tab.sent = tab.sent.filter((d) => {
    const at = notes.findIndex((u) => u.amount === String(d.amount) && !d.before.has(u.hash));
    if (at >= 0) notes.splice(at, 1);
    return at < 0;
  });
  return tab.sent.reduce((sum, d) => sum + d.amount, 0n);
}

/**
 * The cap check before any signature: `held` is a fresh sync of the PDA identity, plus the
 * group-key identity, plus the Add SOL of this tab that the sync does not show yet.
 */
async function underCap(c, worker, tab, amount) {
  await settleLast(worker, tab);
  const synced = await worker.call("sync");
  const old = await worker.call("syncOld");
  const held = BigInt(synced.balance) + BigInt(old.balance) + unseen(tab, synced.utxos);
  const cap = BigInt(c.wallet.cap);
  if (held + amount > cap) throw new Error(capText(cap, held < cap ? cap - held : 0n));
  return { held, before: new Set(synced.utxos.map((u) => u.hash)) };
}

/** The deposit itself: the checks of the network, then compile, sign, test run, send, confirm. */
async function deposit(c, { seat, amount, fee, tab }) {
  const worker = await ensureWorker(c);
  await requireProgram(c, worker);
  const { held, before } = tab ? await underCap(c, worker, tab, amount) : { held: 0n };
  const { blockhashHex } = await worker.call("blockhash");
  const intent = intentHex("shield", { blockhash: blockhashHex, amount, held });
  const pins = bytesOf(pinsHex(agreement(c).done, fee.key, c.genesis));
  const message = c.W.compile_message(bytesOf(intent), pins, new Uint8Array(0));
  const proposal = { id: "add-sol", by: seat, intent, message: hexOf(message) };
  const signature = feeSignature(c, proposal, seat);
  const tx = wireBase64(message, bytesOf(signature));
  const run = await worker.call("simulate", { tx });
  if (run.err !== null) throw new Error(refusalOf(c, run, seat));
  const txId = base58(signature);
  // Counted from the send on: a send that throws may still land.
  const sent = { txId, amount, before, status: "unknown" };
  tab?.sent.push(sent);
  await worker.call("send", { tx });
  const { status, slot } = await worker.call("confirm", { signature: txId });
  sent.status = status;
  if (tab && status === "failed") tab.sent = tab.sent.filter((d) => d !== sent);
  c.host.log("device " + seat + ": added SOL, " + status);
  return { seat, amount, txId, status, slot, at: Date.now() };
}

/**
 * The first ready seat of this browser adds `args.amount` (SOL, as text) to the shielded balance
 * of the group. Resolves with { seat, amount, txId, status, slot, at } once the transaction is
 * confirmed or the wait ended (status "unknown"). `at` is the time of the answer (ms).
 */
export async function addSol(c, args) {
  const block = await settledBlock(c);
  if (block) throw new Error(block);
  const seat = payerSeat(c);
  const amount = lamportsOf(args.amount);
  if (amount === null) throw new Error("Enter an amount of SOL, for example 0.02.");
  const fee = readyFee(c, seat);
  const tab = tabOf(c);
  if (tab?.busy) throw new Error(BUSY);
  if (tab) tab.busy = true;
  try {
    return await deposit(c, { seat, amount, fee, tab });
  } finally {
    if (tab) tab.busy = false;
  }
}
