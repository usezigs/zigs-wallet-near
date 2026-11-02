// Command schema, host pin and redaction of the plain Solana Worker: web/sol/plain/worker.js,
// ZOLANA.md "Plain wallet RPC". This file has no import, so Node tests load it as it is. The
// Worker holds no key share and no SDK: a field outside its schema is refused by name, and a
// refusal never holds a value.

// ponytail: one exact origin per cluster. A Helius Secure URL (<name>.helius-rpc.com, paid plan)
// holds no key but has another host, so it needs a change of HOSTS here and of plainWorkerPolicy
// in cf/src/index.js.
export const HOSTS = {
  devnet: "https://devnet.helius-rpc.com",
  mainnet: "https://mainnet.helius-rpc.com",
};

/** The genesis hash of each cluster. The Worker refuses a server that shows another one. */
export const GENESIS = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};

/**
 * The policy of the response of /sol/plain/worker.js and of every module under /sol/plain. The
 * page compares the header with this text before it starts the Worker. cf/src/index.js builds
 * the same text (plainWorkerPolicy), and cf/test/gate.mjs checks that both agree.
 */
export const PLAIN_WORKER_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  `connect-src 'self' ${HOSTS.devnet} ${HOSTS.mainnet}`,
  "base-uri 'none'",
].join("; ");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_DIGIT = new Map([...B58].map((c, i) => [c, i]));
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_TX = 4096;
const MAX_TX_TEXT = 5464; // base64 of MAX_TX bytes
const MAX_SPACE = 10 * 1024 * 1024; // the largest account data of Solana

/** The bytes of a base58 text, or null when a character is outside the alphabet. */
export function base58Bytes(text) {
  const low = []; // base 256, least significant first
  for (const ch of text) {
    let carry = B58_DIGIT.get(ch);
    if (carry === undefined) return null;
    for (let i = 0; i < low.length; i += 1) {
      carry += low[i] * 58;
      low[i] = carry & 255;
      carry >>= 8;
    }
    for (; carry > 0; carry >>= 8) low.push(carry & 255);
  }
  const zeros = text.length - text.replace(/^1+/, "").length;
  const bytes = new Uint8Array(zeros + low.length);
  bytes.set(low.reverse(), zeros);
  return bytes;
}

export const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

/** The bytes of a canonical base64 text (the form that toBase64 writes), or null. */
export function base64Bytes(text) {
  const shaped = typeof text === "string" && text.length <= MAX_TX_TEXT && text.length % 4 === 0;
  if (!shaped || !BASE64.test(text)) return null;
  const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  return toBase64(bytes) === text ? bytes : null;
}

const keyOf = (re, size) => (v) =>
  typeof v === "string" && re.test(v) && base58Bytes(v)?.length === size;
export const isAddress = keyOf(ADDRESS, 32);
export const isSignature = keyOf(SIGNATURE, 64);
const isTx = (v) => {
  const size = base64Bytes(v)?.length;
  return size >= 1 && size <= MAX_TX;
};
const int = (min, max) => (v) => Number.isSafeInteger(v) && v >= min && v <= max;
const list = (item, max) => (v) =>
  Array.isArray(v) && v.length >= 1 && v.length <= max && Array.from(v).every(item);
const optional = (item) => (v) => v === undefined || item(v);

/** Per command: the allowed fields, each with its check. A field must be present and valid. */
export const SCHEMA = {
  init: {
    cluster: (v) => typeof v === "string" && Object.hasOwn(HOSTS, v),
    rpcUrl: (v) => typeof v === "string" && v.length <= 512,
  },
  genesis: {},
  blockhash: {},
  accounts: { addresses: list(isAddress, 100) },
  balance: { address: isAddress },
  tokenAccounts: { owner: isAddress, mint: isAddress },
  rent: { space: int(0, MAX_SPACE) },
  history: { address: isAddress, before: optional(isSignature), limit: int(1, 100) },
  transaction: { signature: isSignature },
  simulate: { tx: isTx },
  send: { tx: isTx },
  status: { signatures: list(isSignature, 100) },
  confirm: { signature: isSignature },
};

const shown = (name) => JSON.stringify(String(name).slice(0, 40));
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Throws a short error that names the command or field and never a value. */
export function checkCommand(cmd, args) {
  if (typeof cmd !== "string" || !Object.hasOwn(SCHEMA, cmd)) throw new Error("unknown command");
  if (!isObject(args)) throw new Error(`${cmd}: the arguments must be an object`);
  const fields = SCHEMA[cmd];
  const extra = Object.keys(args).find((name) => !Object.hasOwn(fields, name));
  if (extra !== undefined) throw new Error(`${cmd}: field ${shown(extra)} is not allowed`);
  const bad = Object.keys(fields).find((name) => !fields[name](args[name]));
  if (bad !== undefined) throw new Error(`${cmd}: field ${bad} is missing or malformed`);
}

/**
 * The URL of the RPC server for `cluster`: https, the exact origin of HOSTS (so no other host,
 * port or scheme), no user name, no password, no fragment, and the path "/". The Helius key is
 * in the query. Throws a text that holds no part of the URL.
 */
export function rpcEndpoint(cluster, text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("init: rpcUrl is not a URL");
  }
  const bare = url.username === "" && url.password === "" && url.hash === "";
  if (url.origin !== HOSTS[cluster] || !bare || url.pathname !== "/") {
    throw new Error(`init: rpcUrl must be on ${HOSTS[cluster]} with no user name or fragment`);
  }
  return url;
}

const KEY_PARAM = /(api-key=)[^&\s"'#\\)]+/gi;
const MARK = "[redacted]";

/**
 * redact(text) removes every added secret, longest first, and then the value of any api-key
 * parameter. redact.add(...values) adds secrets. The longest go first: the whole URL must go
 * before its key, or the rest of the query would stay in the text.
 */
export function makeRedactor() {
  const secrets = [];
  const redact = (text) => {
    let out = String(text);
    for (const secret of secrets) out = out.split(secret).join(MARK);
    return out.replace(KEY_PARAM, `$1${MARK}`);
  };
  redact.add = (...values) => {
    for (const v of values) {
      if (typeof v === "string" && v.length >= 8 && !secrets.includes(v)) secrets.push(v);
    }
    secrets.sort((a, b) => b.length - a.length);
  };
  return redact;
}
