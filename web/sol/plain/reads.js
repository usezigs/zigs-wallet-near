// What the page reads of the chain for a plain wallet, through the plain Worker of control.js: the
// SOL of the group address, the USDC of its associated token account and the SOL of each published
// fee address. The token account address comes from the wasm and from nothing else.
import { base58 } from "../docs.js";
import { publishedFee } from "../fee.js";
import { base64Bytes } from "./guard.js";
import { enableTokenIntent, plainPins } from "./intent.js";

export const DECIMALS = { sol: 9, usdc: 6 };
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
// A legacy token account: mint (32), owner (32), amount (8) at 64, the rest, and the state at 108.
const TOKEN_LEN = 165;
const AMOUNT_AT = 64;
const STATE_AT = 108;
const INITIALIZED = 1;
export const USDC = 0; // the place of USDC in the pinned mint table of the wasm
const NO_ACCOUNT = "The wasm named no USDC account for this wallet.";
const BAD_ACCOUNT = "The USDC account of the group is not an initialised token account.";

/**
 * The associated token account of the group for USDC, as base58. The wasm derives it for the
 * intent "enable token" and names it in the row of the role `source`. The payer takes no part in
 * the address, so the group key stands in for it.
 */
export function usdcAddress({ W, wallet }, groupKey) {
  const pins = plainPins(wallet, groupKey, groupKey);
  const rows = W.plain_reads(enableTokenIntent(USDC, "00".repeat(32)), pins).split("\n");
  const source = rows.map((row) => row.split("\t")).find(([role]) => role === "source");
  if (!source?.[2]) throw new Error(NO_ACCOUNT);
  return source[2];
}

/**
 * The units (a BigInt) of the token account that the Worker read, or null when there is no
 * account or the System program owns it (USDC is not enabled yet). Any other account that is not
 * an initialised token account throws.
 * ponytail: this decode is for display only. The checker parses the account again before any
 * signature, so a wrong number here moves no funds.
 */
export function tokenAmount(account) {
  if (!account || account.owner === SYSTEM_PROGRAM) return null;
  const data = base64Bytes(account.data);
  const token = account.owner === TOKEN_PROGRAM && data?.length === TOKEN_LEN;
  if (!token || data[STATE_AT] !== INITIALIZED) throw new Error(BAD_ACCOUNT);
  return new DataView(data.buffer, data.byteOffset, data.length).getBigUint64(AMOUNT_AT, true);
}

/** Base units (a BigInt or a decimal text) as a decimal text: 1500000000 with 9 decimals is 1.5. */
export function amountText(units, decimals) {
  const scale = 10n ** BigInt(decimals),
    n = BigInt(units);
  const frac = String(n % scale)
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return String(n / scale) + (frac ? "." + frac : "");
}

// A bad or frozen USDC account must not hide the SOL balances: its error shows on its row only.
function usdcRead(account) {
  try {
    return { usdc: tokenAmount(account), usdcError: "" };
  } catch (e) {
    return { usdc: null, usdcError: e.message };
  }
}

/**
 * The balances of the group `groupKey` (hex) in base units, as BigInts: { sol, usdc, usdcError,
 * fees }. `fees` maps each seat that published a fee key to its lamports. `usdc` is null until USDC
 * is enabled, and also when `usdcError` names a bad account.
 */
export async function readBalances(c, worker, groupKey) {
  const balance = (hex) => worker.call("balance", { address: base58(hex) });
  const seats = c.host.seatIds().filter((i) => publishedFee(c, i) !== undefined);
  const addresses = [usdcAddress(c, groupKey)];
  const [sol, held, ...fees] = await Promise.all([
    balance(groupKey),
    worker.call("accounts", { addresses }),
    ...seats.map((i) => balance(publishedFee(c, i))),
  ]);
  return {
    sol: BigInt(sol.lamports),
    ...usdcRead(held.accounts[0]),
    fees: Object.fromEntries(seats.map((seat, n) => [seat, BigInt(fees[n].lamports)])),
  };
}
