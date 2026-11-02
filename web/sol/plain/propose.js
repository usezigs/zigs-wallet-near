// The proposal of a send (S2 SOL, S3 USDC) of the plain wallet (ZOLANA.md 3.8, 5). One device
// proposes and pays: its fee key signs the payer part, and the group signs later (the approving
// devices). The order is fixed. Validate what the person typed, pick the nonce account, build
// the intent, compile the message, read the chain at the addresses of the wasm and run the checker.
// Only an accepted answer is signed by the fee key, on the exact message that was checked. A
// refusal or an error signs nothing, writes nothing and throws the text of the checker.
import { agreement } from "../ceremony.js";
import { keyOfBase58 } from "../docs.js";
import { readyFee } from "../fee.js";
import { readChain } from "./chain.js";
import {
  BAD_ANSWER, NONCE_WINDOW, nonceAddress, payerSeat, settledBlock, sign, stillOpen,
} from "./direct.js";
import { base64Bytes } from "./guard.js";
import { hexOfBytes, plainPins, sendSolIntent, sendTokenIntent } from "./intent.js";
import { DECIMALS, USDC } from "./reads.js";
import { canApprove, reviewText, stopText } from "./review.js";
import { heldIndexes, writeProposal } from "./sessions.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const NONCE_LEN = 80;
const NONCE_VERSION = 1;
const NONCE_INITIALISED = 1;
const AUTHORITY_AT = 8;
const VALUE_AT = 40;
const VALUE_END = 72;
const U64 = 1n << 64n;
const NO_NONCE = "Create a nonce account first.";
const NO_ASSET = "Choose SOL or USDC.";
const NO_RECIPIENT = "Enter the Solana address of the recipient.";
const TAKEN = "Another proposal took this nonce account. Propose it again.";
const ASSETS = {
  sol: {
    symbol: "SOL", example: "0.005",
    build: (k, nonce, to, units) => sendSolIntent(k, nonce, to, units),
  },
  usdc: {
    symbol: "USDC", example: "12.5",
    build: (k, nonce, to, units) => sendTokenIntent(k, nonce, USDC, to, units),
  },
};

const newId = () => hexOfBytes(crypto.getRandomValues(new Uint8Array(16)));

/**
 * The whole base units (a BigInt) of a decimal text with at most `decimals` decimals, or null for
 * any other text, zero, and a number that does not fit 64 bits. The checker still judges the sum.
 */
export function unitsOf(text, decimals) {
  const m = /^(\d{1,20})(?:\.(\d{1,20}))?$/.exec(String(text).trim());
  if (!m || (m[2] ?? "").length > decimals) return null;
  const fraction = (m[2] ?? "").padEnd(decimals, "0") || "0";
  const units = BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(fraction);
  return units > 0n && units < U64 ? units : null;
}

// The error of a typed value, with the field that holds it (a form shows the text next to it).
const fieldError = (field, text) => Object.assign(new Error(text), { field });

/**
 * What the person typed, checked: { units, to, build }, where `units` are the whole base units (a
 * BigInt), `to` the recipient (hex) and build(k, nonce) makes the intent. A text that is no asset,
 * no address, or no amount in whole base units throws an error with `field` ("asset",
 * "recipient" or "amount"). Nothing is read or signed.
 */
export function checkTyped({ asset, recipient, amount }) {
  if (!Object.hasOwn(ASSETS, asset)) throw fieldError("asset", NO_ASSET);
  const { symbol, example, build } = ASSETS[asset];
  const to = keyOfBase58(String(recipient ?? "").trim());
  if (to === null) throw fieldError("recipient", NO_RECIPIENT);
  const units = unitsOf(amount, DECIMALS[asset]);
  if (units === null) {
    const how = `with at most ${DECIMALS[asset]} decimals, for example ${example}`;
    throw fieldError("amount", `Enter an amount of ${symbol} ${how}.`);
  }
  return { units, to, build: (k, nonce) => build(k, nonce, to, units) };
}

// The stored nonce value (hex) of a nonce account that the group controls, or null: the System
// program owns it, it has 80 bytes, version 1, state initialised, and the group key is its
// authority (plain_chain.rs parse_nonce). It only picks an account: the checker judges it again.
export function nonceValue(account, groupKey) {
  if (!account || account.owner !== SYSTEM_PROGRAM) return null;
  const data = base64Bytes(account.data);
  if (data?.length !== NONCE_LEN) return null;
  const word = new DataView(data.buffer, data.byteOffset, data.length);
  const state = [word.getUint32(0, true), word.getUint32(4, true)];
  const authority = hexOfBytes(data.subarray(AUTHORITY_AT, VALUE_AT));
  const ready = state[0] === NONCE_VERSION && state[1] === NONCE_INITIALISED;
  return ready && authority === groupKey ? hexOfBytes(data.subarray(VALUE_AT, VALUE_END)) : null;
}

// The lowest index k of a nonce account of this device that the group controls and that no open
// session holds, from one read of the first NONCE_WINDOW addresses.
async function freeNonce(c, worker, { pins, groupKey, seat }) {
  const addresses = Array.from({ length: NONCE_WINDOW }, (_, k) => nonceAddress(c.W, k, pins));
  const { accounts } = await worker.call("accounts", { addresses });
  if (!Array.isArray(accounts) || accounts.length !== addresses.length) {
    throw new Error(BAD_ANSWER);
  }
  c.refresh();
  const held = heldIndexes(c.sessions, seat);
  for (const [k, account] of accounts.entries()) {
    const value = held.has(k) ? null : nonceValue(account, groupKey);
    if (value) return { k, value };
  }
  throw new Error(NO_NONCE);
}

/**
 * The first ready device of this browser proposes a send: `asset` is "sol" or "usdc", `recipient`
 * a Solana address and `amount` a decimal text. Its fee key pays. Resolves with the session id.
 * ponytail: two proposals that read the chain at once can pick the same index; the later one ends
 * with a reason when both are in the store (sessions.js), so no nonce is spent twice.
 */
export async function proposeSend(c, ensure, typed) {
  const { build } = checkTyped(typed);
  const why = await settledBlock(c);
  if (why) throw new Error(why);
  const opened = c.opened;
  const seat = payerSeat(c);
  const { key: payer } = readyFee(c, seat);
  const groupKey = agreement(c).done.groupKey;
  const pins = plainPins(c.wallet, groupKey, payer);
  const worker = await ensure();
  stillOpen(c, opened);
  const { k, value } = await freeNonce(c, worker, { pins, groupKey, seat });
  stillOpen(c, opened);
  const intent = build(k, value);
  const message = c.W.plain_compile_message(intent, pins);
  const chain = await readChain(c, worker, intent, pins);
  stillOpen(c, opened);
  const review = reviewText(c, message, intent, pins, chain);
  if (!canApprove(review)) throw Object.assign(new Error(stopText(review)), { review });
  // A proposal that arrived meanwhile counts once its signature is checked. The key signs after.
  const stop = await settledBlock(c);
  if (stop) throw new Error(stop);
  stillOpen(c, opened);
  if (heldIndexes(c.sessions, seat).has(k)) throw new Error(TAKEN);
  const feeSig = sign(c, seat, { message, intent, pins, chain });
  const id = newId();
  const fields = {
    intent: hexOfBytes(intent), message: hexOfBytes(message), feeSig, createdAt: Date.now(),
  };
  await writeProposal(c, id, fields, seat, () => stillOpen(c, opened));
  c.host.log("device " + seat + ": proposed a send");
  return id;
}
