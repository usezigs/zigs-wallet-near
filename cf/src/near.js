// POST /near/quote: a dry quote from NEAR Intents (1Click) for three fixed assets. A dry quote
// creates no state and moves no funds. The Worker builds the whole upstream request: the page
// sends only a pair, an amount and a slippage. The addresses are fixed samples, never an address
// of a user. No header of the user goes upstream. Nothing is cached (the terms of NEAR Intents
// forbid a standalone proxy and a cache of their data over 24 hours).
// POST /near/swap, POST /near/swap-sol-group, POST /near/swap-zec and GET /near/status: a live swap
// from SOL to ZEC paid from a wallet outside Zigs, one paid by the plain Solana wallet of the
// group, one from ZEC to SOL, and the state of a swap. They answer 404 unless the var NEAR_LIVE is
// "1" (cf/wrangler.jsonc: staging only).
// The partner key of NEAR Intents is the secret NEAR_API_KEY. Without it every route still works,
// at the higher fee of NEAR Intents for calls with no key.
const NEAR_URL = "https://1click.chaindefuser.com/v0/quote";
const NEAR_STATUS_URL = "https://1click.chaindefuser.com/v0/status";
const NEAR_MAX_BODY = 512; // bytes
const NEAR_SWAP_MAX_BODY = 1024; // bytes: a unified address can have 400 characters
const NEAR_TIMEOUT_MS = 10_000;
const NEAR_DEADLINE_MS = 600_000; // the deadline of a quote request: 10 minutes
// The deadline of a live swap: refunds start when the swap is not done 30 minutes after the
// quote. The person pays from a wallet outside Zigs, which takes minutes, not hours.
const NEAR_SWAP_DEADLINE_MS = 1_800_000;
// A live quote with less time left than this to pay is refused: the person could pay after the
// deadline, and NEAR Intents can then refund or lose the deposit.
const NEAR_SWAP_MIN_LEFT_MS = 300_000;
// A swap from ZEC, and a swap from SOL that the plain wallet pays, is a group payment: the devices
// approve it in hours, not minutes. Its deadline is 6 hours after the quote, and a quote with less
// than 4 hours left to pay is refused. A deposit after the deadline goes back to the refund address
// of the group.
const NEAR_ZEC_DEADLINE_MS = 21_600_000;
const NEAR_ZEC_MIN_LEFT_MS = 14_400_000;
const NEAR_NO_STORE = { "Cache-Control": "no-store" };

// The keys that the page may send. The samples are a public ZIP-316 test vector (Orchard only)
// and the id of a public Solana program. Both pass the address check of a dry quote. A live swap
// never uses them: a refund to the program id would be lost.
const NEAR_ASSETS = new Map([
  ["zec", { id: "nep141:zec.omft.near", chain: "zec" }],
  ["sol", { id: "nep141:sol.omft.near", chain: "sol" }],
  ["usdc", { id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", chain: "sol" }],
]);
const NEAR_SAMPLES = {
  zec: "u1ddnjsdcpm36r6aq79n3s68shjweksnmwtdltrh046s8m6xcws9ygyawalxx8n6hg6vegk0wh8zjnafxgh6mspp"
    + "jsljvyt0ynece3lvm0",
  sol: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
};
const NEAR_KEYS = "amount,from,slippageBps,to";
const NEAR_SWAP_KEYS = "amount,recipient,refundTo,slippageBps";
const NEAR_AMOUNT = /^[1-9][0-9]{0,29}$/;
const NEAR_INTEGER = /^(?:0|[1-9][0-9]{0,39})$/;
const NEAR_DECIMAL = /^[0-9]+(?:\.[0-9]+)?$/;
const NEAR_SLIPPAGE = [50, 100, 200];
// A mainnet unified address of Zcash (bech32m, lower case). NEAR Intents checks the checksum.
const NEAR_UA = /^u1[02-9ac-hj-np-z]{60,400}$/;
const NEAR_BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// The text of a "too low" answer: "Amount is too low for bridge, try at least 132000".
const NEAR_TOO_LOW = /^Amount is too low\b.*\btry at least ([0-9]{1,30})\b/;
// These 4xx answers say that NEAR Intents did not serve the request. They do not say that the
// pair has no route, so the page must not tell the user "no route".
const NEAR_NOT_SERVED = new Set([401, 403, 408, 429]);
const NEAR_TOO_MANY = "Too many quote requests from this network. Wait a minute.\n";

const nearText = (text, status, headers = {}) => new Response(text, { status, headers });
const nearJson = (body, status = 200) =>
  Response.json(body, { status, headers: NEAR_NO_STORE });
const nearUnavailable = () => nearJson({ error: "unavailable" }, 502);
const nearOff = () => nearText("Not found\n", 404);

// True when `text` is base58 of exactly 32 bytes: the form of a Solana address. The curve is not
// checked.
function nearSolAddress(text) {
  if (typeof text !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return false;
  let value = 0n;
  for (const c of text) value = value * 58n + BigInt(NEAR_BASE58.indexOf(c));
  const zeros = /^1*/.exec(text)[0].length;
  return zeros + (value ? Math.ceil(value.toString(16).length / 2) : 0) === 32;
}

// True when `text` has the form of a transparent mainnet address of Zcash: Base58Check of 26 bytes
// with the version of t1 (P2PKH) or t3 (P2SH). The checksum is not checked here: NEAR Intents
// and the engine of the page check it.
const NEAR_T_VERSIONS = new Set(["1cb8", "1cbd"]);
function nearZecTransparent(text) {
  if (typeof text !== "string" || !/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(text)) return false;
  let value = 0n;
  for (const c of text) value = value * 58n + BigInt(NEAR_BASE58.indexOf(c));
  const hex = value.toString(16);
  return hex.length === 52 && NEAR_T_VERSIONS.has(hex.slice(0, 4));
}

// The live routes. `recipient` checks the address that gets the payout, `refund` the address of a
// refund on the origin chain, and `deposit` the deposit address of the answer. The Worker cannot
// know the group key, so the devices that approve a group-paid swap check its refund address.
const NEAR_LIVE_ROUTES = {
  fromSol: { origin: "sol", destination: "zec", recipient: (a) => NEAR_UA.test(a),
    refund: nearSolAddress, deposit: nearSolAddress, deadline: NEAR_SWAP_DEADLINE_MS,
    minLeft: NEAR_SWAP_MIN_LEFT_MS },
  fromSolGroup: { origin: "sol", destination: "zec", recipient: (a) => NEAR_UA.test(a),
    refund: nearSolAddress, deposit: nearSolAddress, deadline: NEAR_ZEC_DEADLINE_MS,
    minLeft: NEAR_ZEC_MIN_LEFT_MS },
  fromZec: { origin: "zec", destination: "sol", recipient: nearSolAddress,
    refund: nearZecTransparent, deposit: nearZecTransparent, deadline: NEAR_ZEC_DEADLINE_MS,
    minLeft: NEAR_ZEC_MIN_LEFT_MS },
};

// The JSON object of the body when it has exactly the keys `keys`, else null.
function nearParse(bytes, keys) {
  let ask = null;
  try {
    ask = bytes && JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (ask === null || typeof ask !== "object") return null;
  return Object.keys(ask).sort().join() === keys ? ask : null;
}

// The ask of the page as an object, or null when it is not exactly the four allowed fields.
function nearAsk(bytes) {
  const ask = nearParse(bytes, NEAR_KEYS);
  if (!ask) return null;
  const { from, to, amount, slippageBps } = ask;
  const sound = [NEAR_ASSETS.has(from), NEAR_ASSETS.has(to), from !== to,
    typeof amount === "string" && NEAR_AMOUNT.test(amount), NEAR_SLIPPAGE.includes(slippageBps)];
  return sound.every(Boolean) ? ask : null;
}

// The ask of a live swap on `route`: the amount of the origin asset, the slippage, the address
// that gets the payout and the address that gets a refund. Null when a field is missing, extra or
// not sound.
function nearSwapAsk(bytes, route) {
  const ask = nearParse(bytes, NEAR_SWAP_KEYS);
  if (!ask) return null;
  const { amount, recipient, refundTo, slippageBps } = ask;
  const sound = [typeof amount === "string" && NEAR_AMOUNT.test(amount),
    NEAR_SLIPPAGE.includes(slippageBps),
    typeof recipient === "string" && route.recipient(recipient), route.refund(refundTo)];
  return sound.every(Boolean) ? ask : null;
}

function nearRequest({ from, to, amount, slippageBps }, now) {
  const origin = NEAR_ASSETS.get(from), destination = NEAR_ASSETS.get(to);
  return {
    dry: true, swapType: "EXACT_INPUT", slippageTolerance: slippageBps,
    originAsset: origin.id, depositType: "ORIGIN_CHAIN", destinationAsset: destination.id,
    amount, refundTo: NEAR_SAMPLES[origin.chain], refundType: "ORIGIN_CHAIN",
    recipient: NEAR_SAMPLES[destination.chain], recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + NEAR_DEADLINE_MS).toISOString(),
  };
}

function nearSwapRequest({ amount, recipient, refundTo, slippageBps }, now, route) {
  return {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: slippageBps,
    originAsset: NEAR_ASSETS.get(route.origin).id, depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_ASSETS.get(route.destination).id, amount, refundTo,
    refundType: "ORIGIN_CHAIN", recipient, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + route.deadline).toISOString(),
  };
}

// { status, json } of the upstream answer (json is null when the body is no JSON), or null when
// the call failed or ran out of time. A call with a body is a POST, else a GET. The redirect stays
// unfollowed. Only the partner key, when it is set, goes with the call.
async function nearCall(env, url, body) {
  const headers = new Headers({ accept: "application/json" });
  if (body) headers.set("content-type", "application/json");
  if (env.NEAR_API_KEY) headers.set("x-api-key", env.NEAR_API_KEY);
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET", redirect: "manual",
      signal: AbortSignal.timeout(NEAR_TIMEOUT_MS), headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

const NEAR_ECHO = ["dry", "originAsset", "destinationAsset", "amount"];
// A live answer must echo every field that decides where the funds go.
const NEAR_SWAP_ECHO = ["dry", "swapType", "originAsset", "destinationAsset", "amount",
  "recipient", "refundTo", "depositType", "refundType", "recipientType"];
// The page shows no memo and no virtual chain: a deposit that needs one could be lost.
const NEAR_SWAP_NONE = ["depositMemo", "customRecipientMsg", "virtualChainRecipient",
  "virtualChainRefundRecipient"];
// NEAR Intents writes these fields as null when a swap has none.
const nearNone = (obj) => NEAR_SWAP_NONE.every((k) => obj[k] == null);
const NEAR_QUOTE_AMOUNTS = ["amountIn", "amountOut", "minAmountOut"];
const nearIntegers = (quote) => NEAR_QUOTE_AMOUNTS.every(
  (k) => typeof quote?.[k] === "string" && NEAR_INTEGER.test(quote[k]));
const nearTime = (text) => (typeof text === "string" ? Date.parse(text) : NaN);
const nearIso = (text) => (Number.isNaN(nearTime(text))
  ? undefined : new Date(nearTime(text)).toISOString());
// The time to pay before: the deadline of the deposit address, or the refund time of the request
// when that comes first. A deposit after the refund time is refunded, not swapped.
const nearPayBy = (quote, sent) => Math.min(nearTime(quote.deadline), nearTime(sent.deadline));

// True when the answer is a quote for the request that was sent, with sound amounts.
function nearSound(json, sent) {
  const { quote, quoteRequest: echo } = json ?? {};
  const same = NEAR_ECHO.every((k) => echo?.[k] === sent[k]);
  if (!same || !nearIntegers(quote)) return false;
  return quote.amountIn === sent.amount && BigInt(quote.minAmountOut) <= BigInt(quote.amountOut);
}

// True when the answer is a live quote for the swap that was sent: the same addresses, sound
// amounts, a deposit address of the origin chain with no memo, and a deadline the person or the
// group can meet.
function nearSwapSound(json, sent, now, route) {
  const { quote, quoteRequest: echo } = json ?? {};
  const echoed = NEAR_SWAP_ECHO.every((k) => echo?.[k] === sent[k]);
  if (!echoed || !nearIntegers(quote)) return false;
  const left = nearPayBy(quote, sent) - now;
  const sound = [quote.amountIn === sent.amount,
    BigInt(quote.minAmountOut) <= BigInt(quote.amountOut),
    nearNone(quote) && nearNone(echo),
    route.deposit(quote.depositAddress),
    left >= route.minLeft];
  return sound.every(Boolean);
}

// A finite, non-negative number from a number or a numeric string, else undefined.
function nearNumber(value) {
  const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
  return NEAR_DECIMAL.test(text) && Number.isFinite(Number(text)) ? Number(text) : undefined;
}

// Only these fields go to the page. A field that NEAR Intents adds later stays behind.
function nearAnswer(json, now) {
  const { amountIn, amountOut, minAmountOut } = json.quote;
  const stamp = typeof json.timestamp === "string" ? Date.parse(json.timestamp) : NaN;
  return {
    amountIn, amountOut, minAmountOut,
    amountInUsd: nearNumber(json.quote.amountInUsd),
    amountOutUsd: nearNumber(json.quote.amountOutUsd),
    timeEstimate: nearNumber(json.quote.timeEstimate),
    quotedAt: new Date(Number.isNaN(stamp) ? now : stamp).toISOString(),
  };
}

// The id and the signature of a live quote: the person needs them for a dispute with NEAR
// Intents. A value of another form stays behind.
const NEAR_TOKEN = /^[0-9A-Za-z:_-]{1,200}$/;
const nearToken = (value) => (typeof value === "string" && NEAR_TOKEN.test(value)
  ? value : undefined);

// The fields of a live quote for the page. The addresses are the ones that the page sent, which
// the echo check found in the answer.
function nearSwapAnswer(json, sent, now) {
  return {
    ...nearAnswer(json, now), depositAddress: json.quote.depositAddress,
    deadline: new Date(nearPayBy(json.quote, sent)).toISOString(),
    timeWhenInactive: nearIso(json.quote.timeWhenInactive),
    recipient: sent.recipient, refundTo: sent.refundTo,
    correlationId: nearToken(json.correlationId), signature: nearToken(json.signature),
  };
}

function nearRefusal({ status, json }) {
  const minAmount = status === 400 ? NEAR_TOO_LOW.exec(json?.message)?.[1] : undefined;
  if (minAmount) return nearJson({ error: "too-low", minAmount }, 400);
  const refused = status >= 400 && status < 500 && !NEAR_NOT_SERVED.has(status);
  return refused ? nearJson({ error: "no-route" }, 400) : nearUnavailable();
}

// The answer of a quote route for the upstream answer `up`: `answer(json)` when `sound(json)`
// accepts it, else 502, or the refusal of a 4xx.
function nearReply(up, sound, answer) {
  if (!up) return nearUnavailable();
  if (up.status !== 200 && up.status !== 201) return nearRefusal(up);
  return sound(up.json) ? nearJson(answer(up.json)) : nearUnavailable();
}

// Like overLwdLimit (index.js), this fails open: without the binding (local tests), no limit.
async function nearOverLimit(env, key) {
  if (!env.NEAR_PER_IP) return false;
  return !(await env.NEAR_PER_IP.limit({ key })).success;
}

/**
 * The /near/quote route. `key` is the client key of the limit per network. `readBody(req, max)`
 * gives the whole body when it has at most `max` bytes, else null. Both come from index.js.
 */
export async function nearQuote(req, env, { key, readBody }) {
  if (req.method !== "POST") return nearText("Use POST.\n", 405, { Allow: "POST" });
  if (await nearOverLimit(env, key)) return nearText(NEAR_TOO_MANY, 429);
  const ask = nearAsk(await readBody(req, NEAR_MAX_BODY));
  if (!ask) return nearText("Send JSON with from, to, amount and slippageBps.\n", 400);
  const now = Date.now(), request = nearRequest(ask, now);
  return nearReply(await nearCall(env, NEAR_URL, request), (json) => nearSound(json, request),
    (json) => nearAnswer(json, now));
}

// A live quote on `route` with a deposit address. Like nearQuote.
async function nearLiveSwap(req, env, { key, readBody }, route) {
  if (env.NEAR_LIVE !== "1") return nearOff();
  if (req.method !== "POST") return nearText("Use POST.\n", 405, { Allow: "POST" });
  if (await nearOverLimit(env, key)) return nearText(NEAR_TOO_MANY, 429);
  const ask = nearSwapAsk(await readBody(req, NEAR_SWAP_MAX_BODY), route);
  if (!ask) return nearText("Send JSON with amount, recipient, refundTo and slippageBps.\n", 400);
  const now = Date.now(), request = nearSwapRequest(ask, now, route);
  return nearReply(await nearCall(env, NEAR_URL, request),
    (json) => nearSwapSound(json, request, now, route),
    (json) => nearSwapAnswer(json, request, now));
}

/** The /near/swap route: a live quote from SOL to ZEC, paid from a wallet outside Zigs. */
export const nearSwap = (req, env, ctx) => nearLiveSwap(req, env, ctx, NEAR_LIVE_ROUTES.fromSol);

/**
 * The /near/swap-sol-group route: a live quote from SOL to ZEC that the plain Solana wallet of the
 * group pays with a send that its devices approve (docs/sol-to-zec-group.md).
 */
export const nearSwapSolGroup = (req, env, ctx) =>
  nearLiveSwap(req, env, ctx, NEAR_LIVE_ROUTES.fromSolGroup);

/**
 * The /near/swap-zec route: a live quote from ZEC to SOL. The refund address is a transparent
 * address, and the deposit address is a transparent address that a group payment pays.
 */
export const nearSwapZec = (req, env, ctx) =>
  nearLiveSwap(req, env, ctx, NEAR_LIVE_ROUTES.fromZec);

const NEAR_STATES = new Set(["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT",
  "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"]);
const NEAR_STATUS_AMOUNTS = ["amountIn", "amountOut", "depositedAmount", "refundedAmount"];
const NEAR_HASH = /^[0-9A-Za-z]{16,128}$/;
const NEAR_REASON = /^[A-Z_]{1,40}$/;
// The hashes of a list of transactions. The explorer links stay behind: the page never shows a
// link that came from upstream.
const nearHashes = (list) => (Array.isArray(list) ? list.slice(0, 8) : [])
  .map((tx) => tx?.hash).filter((hash) => typeof hash === "string" && NEAR_HASH.test(hash));

// True when the answer is the state of the swap of `address`.
function nearStatusSound(json, address) {
  return json !== null && typeof json === "object"
    && json.quoteResponse?.quote?.depositAddress === address;
}

// The swap that the deposit address belongs to, from the quote in the state: the asset keys, the
// two addresses, the amount in and the time to pay before. Each device that approves a group
// payment to the deposit address compares them with its own (web/app-swap-zec.js). A field of
// another form stays behind.
const NEAR_ADDRESS = /^[0-9A-Za-z]{20,400}$/;
const nearKeyOf = (id) => [...NEAR_ASSETS].find(([, asset]) => asset.id === id)?.[0];
// NEAR Intents adds this fee (0.2 % to its own account) to each request without a partner key.
// The cap stops a proposer with a key from giving most of the deposit to that account.
const NEAR_KEYLESS_FEE = "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd";
const NEAR_FEE_KEYS = ["recipient", "fee", "limitOrderId"];
const nearFeeBps = (fee) => Number.isInteger(fee) && fee >= 0 && fee <= 20;
const nearKeylessFee = (entry) => entry?.recipient === NEAR_KEYLESS_FEE && nearFeeBps(entry.fee)
  && entry.limitOrderId == null && Object.keys(entry).every((k) => NEAR_FEE_KEYS.includes(k));
// True when the swap has the form that nearSwapRequest asks for. A proposer can ask NEAR Intents
// for a quote with the addresses of the group and an app fee, a wide slippage or a memo deposit:
// the group sends no memo, so a deposit to a memo address could be lost.
function nearPlainAsk(ask, quote) {
  const fees = ask.appFees ?? [];
  return [ask.dry === false, ask.swapType === "EXACT_INPUT", ask.depositType === "ORIGIN_CHAIN",
    ask.refundType === "ORIGIN_CHAIN", ask.recipientType === "DESTINATION_CHAIN",
    (ask.depositMode ?? "SIMPLE") === "SIMPLE", NEAR_SLIPPAGE.includes(ask.slippageTolerance),
    Array.isArray(fees) && fees.length <= 1 && fees.every(nearKeylessFee),
    nearNone(ask) && nearNone(quote)].every(Boolean);
}

function nearStatusSwap(response) {
  const { quote, quoteRequest: ask } = response;
  if (!ask || typeof ask !== "object") return undefined;
  const address = (v) => (typeof v === "string" && NEAR_ADDRESS.test(v) ? v : undefined);
  const payBy = nearPayBy(quote, ask);
  return {
    from: nearKeyOf(ask.originAsset), to: nearKeyOf(ask.destinationAsset),
    recipient: address(ask.recipient), refundTo: address(ask.refundTo),
    amountIn: NEAR_INTEGER.test(quote.amountIn) ? quote.amountIn : undefined,
    amountOut: NEAR_INTEGER.test(quote.amountOut) ? quote.amountOut : undefined,
    deadline: Number.isNaN(payBy) ? undefined : new Date(payBy).toISOString(),
    plain: nearPlainAsk(ask, quote),
  };
}

// Only these fields of a state go to the page. A state that is not known is "other": "unknown"
// is for a swap that NEAR Intents does not list (404).
function nearStatusAnswer(json) {
  const details = json.swapDetails ?? {};
  const out = {
    status: NEAR_STATES.has(json.status) ? json.status : "other",
    updatedAt: nearIso(json.updatedAt),
    originTxs: nearHashes(details.originChainTxHashes),
    destinationTxs: nearHashes(details.destinationChainTxHashes),
    refundReason: NEAR_REASON.test(details.refundReason) ? details.refundReason : undefined,
    swap: nearStatusSwap(json.quoteResponse),
  };
  for (const k of NEAR_STATUS_AMOUNTS) {
    if (typeof details[k] === "string" && NEAR_INTEGER.test(details[k])) out[k] = details[k];
  }
  return out;
}

// The answer of the status route for the upstream answer `up` about `address`. 404 says that
// NEAR Intents does not know the address (yet).
function nearStatusReply(up, address) {
  if (up?.status === 404) return nearJson({ error: "unknown" }, 404);
  const sound = up?.status === 200 && nearStatusSound(up.json, address);
  return sound ? nearJson(nearStatusAnswer(up.json)) : nearUnavailable();
}

/** The /near/status route: the state of a live swap, by its deposit address. */
export async function nearStatus(req, env, url, { key }) {
  if (env.NEAR_LIVE !== "1") return nearOff();
  if (req.method !== "GET") return nearText("Use GET.\n", 405, { Allow: "GET" });
  if (await nearOverLimit(env, key)) return nearText(NEAR_TOO_MANY, 429);
  const address = url.searchParams.get("depositAddress");
  const known = nearSolAddress(address) || nearZecTransparent(address);
  if (!known) return nearText("Add ?depositAddress= with the address.\n", 400);
  return nearStatusReply(await nearCall(env, NEAR_STATUS_URL + "?depositAddress=" + address),
    address);
}
