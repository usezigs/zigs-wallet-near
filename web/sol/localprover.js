// Local proving in the Solana Worker (SOL-4, ZOLANA.md 3.7). When the group proves on its devices,
// the web prover of Helius (web/sol/prover/, vendored by solspike/vendor-prover.mjs) answers the
// prove call of the SDK in a nested Worker of this origin and verifies each proof before it
// returns it, so the witness never leaves the device. It proves on one thread (threads: 0): the
// page is not cross-origin isolated, so the threaded runtime cannot run, and it is not shipped.
import { KEY_BASE_URL, SprWebProver } from "/sol/prover/index.js";
import { KEY_DIGESTS } from "/sol/prover/key-digests.js";

/** The pinned key set of the prover. The fetch guard and the /sol policy allow only this folder. */
export const KEY_FOLDER = "https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/78751f5d1c591777/";
/**
 * The ProgramData account of the pool program ring1G (the same address on both clusters) and the
 * slot of its deploy, by Helius host (ZOLANA.md, zolana-v1.md 0.1). A pool upgrade changes the
 * slot. The page checks the slot before it turns local proving on.
 */
export const POOL_DATA = "CMV9fRyA66cwi1ce4bynyXR9zDU7f99gXZWCUNesp8xr";
export const POOL_SLOTS = {
  "devnet.helius-rpc.com": "520179383",
  "mainnet.helius-rpc.com": "467127839",
};
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
// The circuits of our payments: N inputs to 2 outputs (transfer.js COUNTS).
const SHAPES = [1, 2, 3, 4, 5, 6, 8];
const KEY_FILE = /^transfer_confidential_[1-68]_2\.zopro$/;

if (KEY_BASE_URL !== KEY_FOLDER) throw new Error("the prover bundle names another key folder");
for (const n of SHAPES) {
  // The prover checks the size and the SHA-256 of each file against this table.
  const entry = KEY_DIGESTS[`transfer_confidential_${n}_2.key`];
  if (!KEY_FILE.test(entry?.file ?? "")) throw new Error(`the prover has no ${n}x2 zopro key`);
}

/** The deploy slot of the pool that this Helius host serves, or undefined for another host. */
export const pinnedSlot = (host) =>
  Object.hasOwn(POOL_SLOTS, host) ? POOL_SLOTS[host] : undefined;

/** True for GET of a key file of our circuits in the pinned folder, with no query. */
export function isKeyFetch(url, init) {
  const folder = new URL(KEY_FOLDER);
  if (url.origin !== folder.origin || !url.pathname.startsWith(folder.pathname)) return false;
  const name = url.pathname.slice(folder.pathname.length);
  return KEY_FILE.test(name) && url.search === "" && (init?.method ?? "GET") === "GET";
}

/**
 * The web prover. `proverUrl` is the loopback URL of the SDK client: its shim takes the prove call
 * and no request goes there. `fetch` carries the key downloads: the guarded fetch of the Worker.
 */
export function localProver(proverUrl, fetch) {
  return new SprWebProver({ proverUrl, threads: 0, fetch });
}

/**
 * The device check: one 1x2 proof of the pinned test request (valid on its own trees), verified
 * on this device. It loads the prover and the 1x2 key, so it also checks the download and the
 * SHA-256 of the key. Returns the time in ms.
 */
export async function testProof(prover) {
  const res = await fetch("/sol/prover/selftest-1x2.json");
  if (!res.ok) throw new Error("the test request did not load");
  const started = performance.now();
  await prover.proveRequest(await res.text());
  return Math.round(performance.now() - started);
}

const fromBase64 = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

/** The slot of the last deploy of the pool program (a decimal text), from its ProgramData. */
export async function poolSlot(solanaRpc) {
  const dataSlice = { offset: 4, length: 8 };
  const options = { encoding: "base64", commitment: "confirmed", dataSlice };
  const { value } = await solanaRpc.getAccountInfo(POOL_DATA, options).send();
  if (value === null || value.owner !== LOADER) throw new Error("the pool program data is missing");
  const bytes = fromBase64(value.data[0]);
  if (bytes.length !== 8) throw new Error("the pool program data is too short");
  return new DataView(bytes.buffer).getBigUint64(0, true).toString();
}

const NOTHING_SENT = " Nothing was sent to Helius.";
export const POOL_CHANGED =
  "This group makes its proofs on its devices, and the local prover no longer fits the Solana " +
  "pool: Helius changed the pool after this version of Zigs was tested with it. Nothing was " +
  "sent to Helius, and the funds stay in the pool. The group can pay again after a Zigs update " +
  "brings a prover for the new pool.";

// The codes of WasmProverError (web prover errors.ts), each with the text that the page shows.
const KEY = "This browser could not load the proving key for this payment size.";
const START = "This browser could not start the local prover.";
const WORKER = START + " It may have run out of memory.";
const CODES = {
  wasm_key_download_failed: KEY + " Check the connection and try again.",
  wasm_key_digest_mismatch: KEY + " The key did not match its pinned SHA-256.",
  wasm_key_manifest_error: KEY + " The prover has no key for this payment size.",
  wasm_key_load_failed: KEY + " This browser may not have enough memory.",
  wasm_init_failed: START,
  wasm_worker_failed: WORKER,
  wasm_worker_not_started: START,
  wasm_worker_terminated: WORKER,
  wasm_invalid_response: "The local prover gave an answer that this version does not know.",
  wasm_merge_too_wide: "The local prover does not take this payment: it spends too many notes.",
  wasm_key_catalog_invalid: KEY + " The key set of the prover is not valid.",
  wasm_invalid_request:
    "The local prover does not take this payment: the prover and the SDK differ.",
  wasm_prove_failed:
    "The local prover could not make the proof. This browser may not have enough memory.",
  wasm_verify_failed: "The local prover made a proof that does not verify.",
};
const OTHER = "The local prover failed (its key or its program did not load).";

/** The text of a failed local proof with the code of the prover, ending with NOTHING_SENT. */
export const proverText = (code) => (CODES[code] ?? OTHER) + NOTHING_SENT;
