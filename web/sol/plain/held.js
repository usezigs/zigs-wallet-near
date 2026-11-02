// The nonce accounts that a device of this browser holds (ZOLANA.md 3.8): the setup area shows how
// many, and the send form knows when none is free. One read of the first NONCE_WINDOW addresses of
// the first device that can pay, the same read that a proposal makes. It counts only accounts that
// the group controls (nonceValue); the checker judges each account again before any signature.
import { publishedFee } from "../fee.js";
import { BAD_ANSWER, NONCE_WINDOW, nonceAddress, payerSeat } from "./direct.js";
import { plainPins } from "./intent.js";
import { nonceValue } from "./propose.js";

/**
 * { seat, have, ks }: the device that pays, how many nonce accounts it holds and their indexes.
 * It throws when no device of this browser can pay or the Worker answers with other data.
 */
export async function readHeld(c, worker, groupKey) {
  const seat = payerSeat(c);
  const pins = plainPins(c.wallet, groupKey, publishedFee(c, seat));
  const addresses = Array.from({ length: NONCE_WINDOW }, (_, k) => nonceAddress(c.W, k, pins));
  const { accounts } = await worker.call("accounts", { addresses });
  if (!Array.isArray(accounts) || accounts.length !== addresses.length) {
    throw new Error(BAD_ANSWER);
  }
  const ks = accounts.flatMap((account, k) => (nonceValue(account, groupKey) ? [k] : []));
  return { seat, have: ks.length, ks };
}
