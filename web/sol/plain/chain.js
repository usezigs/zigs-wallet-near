// The chain bundle of a plain proposal (wasm-sol/src/plain_chain.rs): what the page read through
// the plain Worker, and only at the addresses that the wasm names (plain_reads). The checker
// compares each read with the address that it derives itself, so another address is refused.
import { base58 } from "../docs.js";
import { base58Bytes, base64Bytes } from "./guard.js";
import { join, keyBytes, u32le, u64le } from "./intent.js";

const ROLES = { payer: 1, group: 2, nonce: 3, recipient: 4, source: 5, dest: 6 };
// The account sizes whose rent minimum the checker pins: none, a nonce account, a token account.
const RENT_SPACES = [0, 80, 165];
const MAX_READS = 100; // the limit of one `accounts` call of the Worker

const bytes58 = (text) => (typeof text === "string" ? base58Bytes(text) : null);

const key32 = (bytes, what) => {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new Error(`chain: the ${what} is not 32 bytes`);
  }
  return bytes;
};

function accountBytes(role, account) {
  if (account === null) return Uint8Array.of(0);
  const { lamports, owner, executable, data } = account;
  return join(
    [1],
    u64le(lamports, `the lamports of the ${role}`),
    key32(owner, `owner of the ${role}`),
    [executable === true ? 1 : 0],
    u32le(data.length, `the data of the ${role}`),
    data,
  );
}

/**
 * The wire form of PlainChain: the genesis hash (32 bytes), the rent minimums of 0, 80 and 165
 * bytes (three u64), a count, then each read as role, address, present flag and, if present,
 * lamports, owner, executable flag and data with its u32 length. `reads` keeps its order.
 * { genesis, rents: [zero, nonce, token], reads: [{ role, key, account }] }; `account` is null for
 * an absent account, else { lamports, owner, executable, data }.
 */
export function encodeChain({ genesis, rents, reads }) {
  if (rents.length !== 3 || reads.length > MAX_READS) throw new Error("chain: bad rents or reads");
  const parts = [key32(genesis, "genesis hash"), ...rents.map((rent) => u64le(rent, "a rent"))];
  parts.push([reads.length]);
  for (const { role, key, account } of reads) {
    if (!Object.hasOwn(ROLES, role)) throw new Error(`chain: ${role} is not the role of a read`);
    parts.push([ROLES[role]], key32(key, `address of the ${role}`), accountBytes(role, account));
  }
  return join(...parts);
}

/** The reads that the wasm names for this proposal: [{ role, hex, key }], in its order. */
function readRows(W, intent, pins) {
  const rows = W.plain_reads(intent, pins)
    .split("\n")
    .map((row) => row.split("\t"));
  if (rows[0][0] === "error") throw new Error(rows[0].slice(1).join("\t"));
  if (rows.length > MAX_READS) throw new Error("chain: the wasm names too many reads");
  return rows.map(([role, hex]) => {
    if (!Object.hasOwn(ROLES, role)) throw new Error(`chain: the wasm named the role ${role}`);
    return { role, hex, key: keyBytes(hex, `the address of the ${role}`) };
  });
}

const dataOf = (text) => (text === "" ? new Uint8Array(0) : base64Bytes(text));

// An account as the Worker answers it: null when absent. Anything else must be a whole account,
// and its data must be valid base64 (an empty text is no data). A missing answer is no absence.
function accountOf(role, raw) {
  if (raw === null) return null;
  const { owner, data, lamports, executable } = raw ?? {};
  const [key, bytes] = [bytes58(owner), dataOf(data)];
  const shaped = key?.length === 32 && bytes !== null && typeof lamports === "string";
  if (!shaped || typeof executable !== "boolean") {
    throw new Error(`chain: the Worker gave no readable account for the ${role}`);
  }
  return { lamports, owner: key, executable: executable === true, data: bytes };
}

/**
 * Reads what the checker needs of one proposal through `worker` (the plain Worker handle) and
 * returns the chain bundle (bytes). The addresses come from plain_reads and from nothing else.
 * The genesis hash and the rents are the Worker's answers.
 */
export async function readChain({ W }, worker, intent, pins) {
  const rows = readRows(W, intent, pins);
  const addresses = rows.map(({ hex }) => base58(hex));
  const [{ genesis }, zero, nonce, token, { accounts }] = await Promise.all([
    worker.call("genesis", {}),
    ...RENT_SPACES.map((space) => worker.call("rent", { space })),
    worker.call("accounts", { addresses }),
  ]);
  if (!Array.isArray(accounts) || accounts.length !== rows.length) {
    throw new Error("chain: the Worker answered another number of accounts");
  }
  return encodeChain({
    genesis: bytes58(genesis),
    rents: [zero, nonce, token].map(({ lamports }) => lamports),
    reads: rows.map(({ role, key }, i) => ({ role, key, account: accountOf(role, accounts[i]) })),
  });
}
