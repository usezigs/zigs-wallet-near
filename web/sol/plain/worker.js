// The plain Solana Worker (ZOLANA.md "Plain wallet RPC"): JSON-RPC 2.0 over fetch to one pinned
// Helius host, for the plain wallet of a group on Devnet or mainnet. It imports no SDK, no prover
// and no wasm, and it holds no secret but the RPC URL. The response of this script carries its
// own CSP (cf/src), so the policy binds this file and every module that it imports.
import {
  GENESIS,
  base64Bytes,
  checkCommand,
  isSignature,
  makeRedactor,
  rpcEndpoint,
} from "/sol/plain/guard.js";

const scope = self;
const redact = makeRedactor();

// The Helius free plan allows 10 calls a second and 1 sendTransaction a second.
const GAP_MS = 125;
const SEND_GAP_MS = 1000;
// A send needs a passing simulation of the same bytes, not older than this.
const SIMULATED_MS = 30_000;
const SIMULATED_MAX = 16;
const CONFIRM_MS = 45_000;
const POLL_MS = 1000;
const LOG_LINES = 30;
const LOG_CHARS = 300;

// { cluster, href, verified }: verified turns true when the server showed the genesis hash.
let session = null;
// The text of a refusal that ends this Worker: the server is not the cluster of the pin.
let locked = null;
let lastId = 0;
let nextAt = 0;
let nextSendAt = 0;
const simulated = new Map(); // digest of the bytes -> time of their passing simulation

const now = () => performance.now();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const bad = (what) => new Error(`the RPC answer has a bad ${what}`);

function str(v, what) {
  if (typeof v !== "string") throw bad(what);
  return v;
}

function arr(v, what) {
  if (!Array.isArray(v)) throw bad(what);
  return v;
}

/** A small count: a safe integer from 0 up. */
function small(v, what) {
  if (!Number.isSafeInteger(v) || v < 0) throw bad(what);
  return v;
}

const time = (v) => (Number.isSafeInteger(v) ? v : null);

/** A u64 as a decimal text: `exact` keeps the digits of the big ones. */
function u64(v) {
  const number = typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!number && !(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v))) throw bad("number");
  return String(v);
}

const U64_FIELDS = /"(lamports|value|preBalances|postBalances)":(\[[0-9,]*\]|[0-9]+(?=[,}\]]))/g;

/** JSON.parse rounds integers above 2^53. The u64 fields of an answer become texts first. */
const exact = (text) =>
  text.replace(U64_FIELDS, (_all, key, num) => `"${key}":${num.replace(/[0-9]+/g, '"$&"')}`);

const STATUS_TEXT = {
  401: "Helius refused the API key.",
  403: "Helius refused this website. Its key does not allow this domain.",
  429: "Too many Helius calls. Wait a minute.",
};

function refusedText(status) {
  if (status >= 500) return "Helius is not answering.";
  return STATUS_TEXT[status] ?? `Helius answered with status ${status}.`;
}

/** Waits for the slot of this call: 8 calls a second at most, 1 send a second at most. */
async function pace(isSend) {
  const at = Math.max(now(), nextAt, isSend ? nextSendAt : 0);
  nextAt = at + GAP_MS;
  if (isSend) nextSendAt = at + SEND_GAP_MS;
  for (let wait = at - now(); wait > 0; wait = at - now()) await sleep(wait);
}

const isMoved = (res) =>
  res.redirected || res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);

async function bodyOf(method, res) {
  if (isMoved(res)) throw new Error(`${method}: the server redirected, which is refused`);
  if (!res.ok) throw new Error(`${method}: ${refusedText(res.status)}`);
  try {
    return JSON.parse(exact(await res.text()));
  } catch {
    throw new Error(`${method}: the answer is not JSON`);
  }
}

/** The result of the reply, or a throw. A redirect is an error: no second URL is fetched. */
async function resultOf(method, id, res) {
  const body = await bodyOf(method, res);
  if (body?.id !== id) throw new Error(`${method}: the answer is for another call`);
  if (body.error) {
    const text = redact(String(body.error.message ?? "")).slice(0, 300);
    throw new Error(`${method}: RPC error ${body.error.code}: ${text}`);
  }
  if (!("result" in body)) throw new Error(`${method}: the answer has no result`);
  return body.result;
}

/** One JSON-RPC call to the pinned host. */
async function rpc(method, params) {
  if (session === null) throw new Error("the Worker is not initialised");
  await pace(method === "sendTransaction");
  const id = (lastId += 1);
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    redirect: "error",
  };
  const res = await fetch(session.href, init).catch((err) => {
    throw new Error(`${method}: the request failed (${err?.message})`);
  });
  return resultOf(method, id, res);
}

async function checkGenesis() {
  const hash = await rpc("getGenesisHash", []);
  if (hash !== GENESIS[session.cluster]) {
    locked = `This server is not Solana ${session.cluster}. This Worker refuses every command.`;
    session = null;
    throw new Error(locked);
  }
  session.verified = true;
  return hash;
}

async function init({ cluster, rpcUrl }) {
  if (session?.verified) throw new Error("init: the Worker is already initialised");
  const url = rpcEndpoint(cluster, rpcUrl);
  redact.add(rpcUrl, url.href, url.search, url.searchParams.get("api-key"));
  session = { cluster, href: url.href, verified: false };
  return { cluster, genesis: await checkGenesis() };
}

const genesis = async () => ({ genesis: await checkGenesis() });

async function blockhash() {
  const result = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const value = result?.value;
  return {
    blockhash: str(value?.blockhash, "blockhash"),
    lastValidBlockHeight: u64(value?.lastValidBlockHeight),
  };
}

function accountView(a) {
  return {
    owner: str(a?.owner, "owner"),
    lamports: u64(a?.lamports),
    executable: a?.executable === true,
    data: str(a?.data?.[0], "data"),
  };
}

async function accounts({ addresses }) {
  const options = { encoding: "base64", commitment: "confirmed" };
  const result = await rpc("getMultipleAccounts", [addresses, options]);
  const value = arr(result?.value, "account list");
  if (value.length !== addresses.length) throw bad("account list");
  return { accounts: value.map((a) => (a === null ? null : accountView(a))) };
}

async function balance({ address }) {
  const result = await rpc("getBalance", [address, { commitment: "confirmed" }]);
  return { lamports: u64(result?.value) };
}

async function tokenAccounts({ owner, mint }) {
  const options = { encoding: "base64", commitment: "confirmed" };
  const result = await rpc("getTokenAccountsByOwner", [owner, { mint }, options]);
  const found = arr(result?.value, "token account list");
  const view = (x) => ({ address: str(x?.pubkey, "address"), ...accountView(x?.account) });
  return { accounts: found.map(view) };
}

async function rent({ space }) {
  return { lamports: u64(await rpc("getMinimumBalanceForRentExemption", [space])) };
}

function entryView(x) {
  if (!isSignature(x?.signature)) throw bad("signature");
  const failed = x.err != null;
  return { signature: x.signature, failed, slot: u64(x.slot), blockTime: time(x.blockTime) };
}

async function history({ address, before, limit }) {
  const options = { limit, commitment: "confirmed" };
  if (before !== undefined) options.before = before;
  const found = arr(await rpc("getSignaturesForAddress", [address, options]), "history");
  return { entries: found.map(entryView) };
}

function tokenBalance(b) {
  const amount = b?.uiTokenAmount;
  return {
    accountIndex: small(b?.accountIndex, "index"),
    mint: str(b?.mint, "mint"),
    owner: typeof b?.owner === "string" ? b.owner : null,
    amount: u64(amount?.amount),
    decimals: small(amount?.decimals, "decimals"),
  };
}

/** The accounts of a transaction in the order of its balance lists: static, then loaded. */
function keysOf(got) {
  const loaded = got.meta?.loadedAddresses;
  const keys = [...arr(got.transaction?.message?.accountKeys, "key list")];
  keys.push(...(loaded?.writable ?? []), ...(loaded?.readonly ?? []));
  return keys.map((k) => str(k, "key"));
}

const tokenBalances = (list) => arr(list ?? [], "token balances").map(tokenBalance);

/** What the page reads of a landed transaction: balances before and after, and its keys. */
function transactionView(got) {
  const { meta } = got;
  return {
    found: true,
    slot: u64(got.slot),
    blockTime: time(got.blockTime),
    err: meta?.err == null ? null : JSON.stringify(meta.err),
    fee: u64(meta?.fee),
    accountKeys: keysOf(got),
    preBalances: arr(meta?.preBalances, "balances").map(u64),
    postBalances: arr(meta?.postBalances, "balances").map(u64),
    preTokenBalances: tokenBalances(meta?.preTokenBalances),
    postTokenBalances: tokenBalances(meta?.postTokenBalances),
  };
}

async function transaction({ signature }) {
  const options = { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 };
  const got = await rpc("getTransaction", [signature, options]);
  return got === null ? { found: false } : transactionView(got);
}

async function digestOf(bytes) {
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(sum, (b) => b.toString(16).padStart(2, "0")).join("");
}

function expire() {
  for (const [digest, at] of simulated) {
    if (now() - at > SIMULATED_MS) simulated.delete(digest);
  }
}

function remember(digest) {
  expire();
  simulated.delete(digest);
  simulated.set(digest, now());
  if (simulated.size > SIMULATED_MAX) simulated.delete(simulated.keys().next().value);
}

const logsOf = (logs) =>
  (Array.isArray(logs) ? logs : []).slice(-LOG_LINES).map((l) => redact(l).slice(0, LOG_CHARS));

const countOrNull = (v) => (v == null ? null : u64(v));

/**
 * A signed transaction, simulated with its signatures checked and its own blockhash. The bytes
 * that pass are the only bytes that send accepts, for SIMULATED_MS.
 */
async function simulate({ tx }) {
  const options = {
    encoding: "base64",
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: "confirmed",
  };
  const value = (await rpc("simulateTransaction", [tx, options]))?.value;
  if (value === null || typeof value !== "object") throw bad("simulation");
  const digest = await digestOf(base64Bytes(tx));
  const passed = value.err === null;
  if (passed) remember(digest);
  else simulated.delete(digest);
  return {
    err: passed ? null : redact(JSON.stringify(value.err ?? "no result")),
    unitsConsumed: countOrNull(value.unitsConsumed),
    loadedAccountsDataSize: countOrNull(value.loadedAccountsDataSize),
    logs: logsOf(value.logs),
  };
}

async function send({ tx }) {
  expire();
  if (!simulated.has(await digestOf(base64Bytes(tx)))) {
    throw new Error("send: these bytes did not pass a simulation in the last 30 seconds");
  }
  const signature = await rpc("sendTransaction", [
    tx,
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  if (!isSignature(signature)) throw bad("signature");
  return { signature };
}

/** One look at a signature: none, pending (seen, not confirmed), confirmed, finalized, failed. */
function statusView(seen) {
  if (!seen) return { status: "none", slot: "", err: null };
  const slot = u64(seen.slot);
  if (seen.err) return { status: "failed", slot, err: JSON.stringify(seen.err) };
  const level = seen.confirmationStatus;
  const done = level === "confirmed" || level === "finalized";
  return { status: done ? level : "pending", slot, err: null };
}

async function statuses(signatures, search) {
  const options = { searchTransactionHistory: search };
  const result = await rpc("getSignatureStatuses", [signatures, options]);
  const value = arr(result?.value, "status list");
  if (value.length !== signatures.length) throw bad("status list");
  return value.map(statusView);
}

async function status({ signatures }) {
  return { statuses: await statuses(signatures, true) };
}

const FINAL = new Set(["confirmed", "finalized", "failed"]);

async function confirm({ signature }) {
  const end = now() + CONFIRM_MS;
  let [seen] = await statuses([signature], false);
  while (!FINAL.has(seen.status) && now() < end) {
    await sleep(POLL_MS);
    [seen] = await statuses([signature], false);
  }
  return FINAL.has(seen.status) ? seen : { status: "unknown", slot: "", err: null };
}

const HANDLERS = {
  init,
  genesis,
  blockhash,
  accounts,
  balance,
  tokenAccounts,
  rent,
  history,
  transaction,
  simulate,
  send,
  status,
  confirm,
};

/** Throws when this command may not run now: bad shape, a locked Worker, or no genesis check. */
function admit(cmd, input) {
  checkCommand(cmd, input);
  if (locked !== null) throw new Error(locked);
  if (cmd !== "init" && !session?.verified) throw new Error("the Worker is not initialised");
}

async function answer({ id, cmd, args }) {
  try {
    const input = args ?? {};
    admit(cmd, input);
    // Chain data can echo any text, so an answer goes through the redactor as an error does.
    const result = await HANDLERS[cmd](input);
    scope.postMessage({ id, ok: true, result: JSON.parse(redact(JSON.stringify(result))) });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: redact(`${err?.name}: ${err?.message}`) });
  }
}

// One command at a time, in order.
let queue = Promise.resolve();
scope.onmessage = (event) => {
  if (typeof event.data?.id !== "number") return;
  queue = queue.then(() => answer(event.data));
};
