// The wire forms that the plain wasm entries read (wasm-sol/src/plain.rs): the 66 bytes of the pins
// and the five intents, tags 13 to 17. The page builds them to ask the wasm which account to read
// and to check a message, so that no address comes from a document or from the network.
const CLUSTER_BYTE = { devnet: 1, mainnet: 2 };
const MODE_PLAIN = 1;
const TAG_CREATE_NONCE = 13;
const TAG_SEND_SOL = 14;
const TAG_SEND_TOKEN = 15;
const TAG_ENABLE_TOKEN = 16;
const TAG_CANCEL = 17;
// The name that the checker gives each tag (plain_display.rs) and the byte length of its intent.
const KINDS = {
  [TAG_CREATE_NONCE]: ["create-nonce", 37],
  [TAG_SEND_SOL]: ["send-sol", 77],
  [TAG_SEND_TOKEN]: ["send-token", 78],
  [TAG_ENABLE_TOKEN]: ["enable-token", 34],
  [TAG_CANCEL]: ["cancel", 37],
};
const KEY_HEX = /^[0-9a-f]{64}$/;
const INT_TEXT = /^-?[0-9]+$/;

export const bytesOfHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** One byte string from byte strings (a Uint8Array or an array of numbers). */
export function join(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const byteCount = (size) => `${size} ${size === 1 ? "byte" : "bytes"}`;

// A whole number from a BigInt, a safe integer or a decimal text. Any other value throws.
function wholeNumber(value, what) {
  if (typeof value === "bigint") return value;
  if (Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && INT_TEXT.test(value)) return BigInt(value);
  throw new RangeError(`${what} is not a whole number`);
}

// An unsigned integer of `size` bytes, little endian. A value outside 0 .. 2^(8 size) - 1 throws,
// so no field wraps.
function uintLe(value, size, what) {
  const n = wholeNumber(value, what);
  const max = (1n << BigInt(8 * size)) - 1n;
  if (n < 0n) throw new RangeError(`${what} is below 0`);
  if (n > max) {
    throw new RangeError(`${what} is above ${max}, the largest number in ${byteCount(size)}`);
  }
  return Uint8Array.from({ length: size }, (_, i) => Number((n >> BigInt(8 * i)) & 255n));
}

export const u32le = (value, what = "the number") => uintLe(value, 4, what);
export const u64le = (value, what = "the number") => uintLe(value, 8, what);

/** The 32 bytes of a key given as 64 lowercase hex characters. Any other text throws. */
export function keyBytes(hex, what = "the key") {
  if (typeof hex !== "string" || !KEY_HEX.test(hex)) {
    throw new Error(`${what} is not 32 bytes of hex`);
  }
  return bytesOfHex(hex);
}

/** The 66 bytes of the pins of a plain wallet: cluster, mode, group key and payer (both hex). */
export function plainPins(wallet, groupKey, payer) {
  const head = [CLUSTER_BYTE[wallet.cluster], MODE_PLAIN];
  return Uint8Array.from([...head, ...bytesOfHex(groupKey), ...bytesOfHex(payer)]);
}

const nonceKey = (hex) => keyBytes(hex, "the nonce value");
const blockhashKey = (hex) => keyBytes(hex, "the blockhash");
const recipientKey = (hex) => keyBytes(hex, "the recipient");

/** S1: the fee key creates nonce account `k` of its seat, with a recent blockhash (hex). */
export const createNonceIntent = (k, blockhash) =>
  join([TAG_CREATE_NONCE], u32le(k, "k"), blockhashKey(blockhash));

/** S2: the group sends `lamports` to `recipient` (hex). `nonce` is the stored nonce value (hex). */
export const sendSolIntent = (k, nonce, recipient, lamports) =>
  join(
    [TAG_SEND_SOL],
    u32le(k, "k"),
    nonceKey(nonce),
    recipientKey(recipient),
    u64le(lamports, "the amount"),
  );

/** S3: the group sends `amount` units of the token at place `token` of the pinned table. */
export const sendTokenIntent = (k, nonce, token, recipient, amount) =>
  join(
    [TAG_SEND_TOKEN],
    u32le(k, "k"),
    nonceKey(nonce),
    uintLe(token, 1, "the token"),
    recipientKey(recipient),
    u64le(amount, "the amount"),
  );

/** S4: the fee key creates the token account of the group, with a recent blockhash (hex). */
export const enableTokenIntent = (token, blockhash) =>
  join([TAG_ENABLE_TOKEN], uintLe(token, 1, "the token"), blockhashKey(blockhash));

/** S5: advance the nonce account `k`, so that no earlier signature of it lands. */
export const cancelIntent = (k, nonce) => join([TAG_CANCEL], u32le(k, "k"), nonceKey(nonce));

/**
 * The name of the intent in `hex`, from its tag and its length alone (a title for a list), or null
 * for any other bytes. No field is decoded: the checker shows the values.
 */
export function kindOfIntent(hex) {
  if (typeof hex !== "string" || !/^([0-9a-f]{2})+$/.test(hex)) return null;
  const [name, size] = KINDS[parseInt(hex.slice(0, 2), 16)] ?? [];
  return name !== undefined && hex.length === size * 2 ? name : null;
}
