// Add SOL (ZOLANA.md 2 and 5): a pool deposit from the fee address of a seat of this browser into
// the shielded balance of the group. It is the SOL of one member, so the seat signs alone with its
// fee key: no approval round and no group signature. The message has a recent blockhash and no
// nonce, so it never touches the nonce account of the group. The amount and the sender are
// public. The wasm runs the checker on the exact bytes before the fee key signs, so the deposit
// goes to the shielded address of the group and to nobody else. Before that, the approvals
// program must exist on the network. Pending deposits are tracked to avoid duplicate sends.
import { feeSignature } from "./approve.js";
import { agreement } from "./ceremony.js";
import { base58, keyOfBase58 } from "./docs.js";
import { poorText } from "./execute.js";
import { readyFee } from "./fee.js";
import { payerSeat, settledBlock } from "./gate.js";
import { CLUSTERS } from "./guard.js";
import { bytesOf, hexOf, intentHex, lamportsOf, pinsHex, wireBase64 } from "./intent.js";
import { ensureWorker } from "./session.js";
import { programOf } from "./wallet.js";

const LOADER = keyOfBase58("BPFLoaderUpgradeab1e11111111111111111111111");
const CONFIRMED = new Set(["confirmed", "finalized"]);
const NOT_DEPLOYED =
  "The Zigs program of this network is not deployed yet, so Add SOL is refused. Nothing was sent.";
const BUSY = "An Add SOL of this tab is still running. Nothing was sent.";
const UNCONFIRMED =
  "The last Add SOL of this tab is not confirmed yet. Try again in 3 minutes. Nothing was sent.";
// A blockhash lives 150 blocks: an Add SOL with no answer after this time can no longer land.
const LAND_WINDOW_MS = 150_000;

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

// Per group PDA, remember deposits not yet visible to the indexer. An uncertain send blocks
// another deposit while its blockhash can still land, even when there is no balance limit.
const tabs = new Map();

/**
 * Track mainnet deposits even without a balance limit, including uncertain network results.
 */
function tabOf(c) {
  const { done } = agreement(c);
  if (done.cluster === "devnet") return null;
  if (c.wallet?.cluster !== "mainnet") {
    throw new Error("The wallet network is unavailable. Reload before adding SOL.");
  }
  if (!tabs.has(done.pda)) tabs.set(done.pda, { busy: false, sent: [], shown: new Set() });
  return tabs.get(done.pda);
}

/**
 * Asks the chain again for the last Add SOL with no answer. Refuses while it can still land. After
 * that it no longer refuses, and it counts until a sync shows it: the status of the RPC forgets an
 * old transaction, so "none" can be an Add SOL that landed.
 */
async function settleLast(worker, tab) {
  const last = tab.sent.at(-1);
  if (last?.status !== "unknown") return;
  const { status } = await worker.call("status", { signature: last.txId });
  if (status === "failed") tab.sent.pop();
  else if (CONFIRMED.has(status)) last.status = status;
  else if (Date.now() - last.sentAt > LAND_WINDOW_MS) last.status = "lapsed";
  else throw new Error(UNCONFIRMED);
}

/**
 * Drops each Add SOL that the sync shows: a note of its amount that was not there before it.
 * One note shows one Add SOL, once: a later sync that still holds it shows no other one.
 */
function drop(tab, utxos) {
  const notes = utxos.filter((u) => !tab.shown.has(u.hash));
  tab.sent = tab.sent.filter((d) => {
    const at = notes.findIndex((u) => u.amount === String(d.amount) && !d.before.has(u.hash));
    if (at < 0) return true;
    tab.shown.add(notes.splice(at, 1)[0].hash);
    return false;
  });
}

/**
 * Drops each Add SOL of this tab that `notes` ({ hash, amount }) show: notes of the PDA identity
 * that the Worker read fresh, such as the inputs of a proof. A spend can take the note of an Add
 * SOL before a sync of this tab shows it.
 */
export function pruneAdded(c, notes) {
  const tab = tabs.get(agreement(c).done.pda);
  if (tab) drop(tab, notes);
}

/** Fresh balances and notes, with pending deposits counted until the indexer shows them. */
async function syncDeposits(worker, tab) {
  const synced = await worker.call("sync");
  const old = await worker.call("syncOld");
  drop(tab, synced.utxos);
  await settleLast(worker, tab);
  const unseen = tab.sent.reduce((sum, d) => sum + d.amount, 0n);
  const held = BigInt(synced.balance) + BigInt(old.balance) + unseen;
  return { held, before: new Set(synced.utxos.map((u) => u.hash)) };
}

/** The deposit itself: the checks of the network, then compile, sign, test run, send, confirm. */
async function deposit(c, { seat, amount, fee, tab }) {
  const worker = await ensureWorker(c);
  await requireProgram(c, worker);
  const { held, before } = tab ? await syncDeposits(worker, tab) : { held: 0n };
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
  const sent = { txId, amount, before, status: "unknown", sentAt: Date.now() };
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
