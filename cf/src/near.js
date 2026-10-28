// POST /near/quote: a dry quote from NEAR Intents (1Click) for three fixed assets. A dry quote
// needs no API key, creates no state and moves no funds. The Worker builds the whole upstream
// request: the page sends only a pair, an amount and a slippage. The addresses are fixed samples,
// never an address of a user. No header of the user goes upstream. Nothing is cached (the terms
// of NEAR Intents forbid a standalone proxy and a cache of their data over 24 hours).
const NEAR_URL = "https://1click.chaindefuser.com/v0/quote";
const NEAR_MAX_BODY = 512; // bytes
const NEAR_TIMEOUT_MS = 10_000;
const NEAR_DEADLINE_MS = 600_000; // the deadline of a quote request: 10 minutes
const NEAR_NO_STORE = { "Cache-Control": "no-store" };

// The keys that the page may send. The samples are a public ZIP-316 test vector (Orchard only)
// and the id of a public Solana program. Both pass the address check of a dry quote.
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
const NEAR_AMOUNT = /^[1-9][0-9]{0,29}$/;
const NEAR_INTEGER = /^(?:0|[1-9][0-9]{0,39})$/;
const NEAR_DECIMAL = /^[0-9]+(?:\.[0-9]+)?$/;
const NEAR_SLIPPAGE = [50, 100, 200];
// The text of a "too low" answer: "Amount is too low for bridge, try at least 132000".
const NEAR_TOO_LOW = /^Amount is too low\b.*\btry at least ([0-9]{1,30})\b/;
// These 4xx answers say that NEAR Intents did not serve the request. They do not say that the
// pair has no route, so the page must not tell the user "no route".
const NEAR_NOT_SERVED = new Set([401, 403, 408, 429]);

const nearText = (text, status, headers = {}) => new Response(text, { status, headers });
const nearJson = (body, status = 200) =>
  Response.json(body, { status, headers: NEAR_NO_STORE });
const nearUnavailable = () => nearJson({ error: "unavailable" }, 502);

// The ask of the page as an object, or null when it is not exactly the four allowed fields.
function nearAsk(bytes) {
  let ask = null;
  try {
    ask = bytes && JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (ask === null || typeof ask !== "object") return null;
  if (Object.keys(ask).sort().join() !== NEAR_KEYS) return null;
  const { from, to, amount, slippageBps } = ask;
  const sound = [NEAR_ASSETS.has(from), NEAR_ASSETS.has(to), from !== to,
    typeof amount === "string" && NEAR_AMOUNT.test(amount), NEAR_SLIPPAGE.includes(slippageBps)];
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

// { status, json } of the upstream answer (json is null when the body is no JSON), or null when
// the call failed or ran out of time. The redirect stays unfollowed.
async function nearCall(request) {
  try {
    const res = await fetch(NEAR_URL, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(NEAR_TIMEOUT_MS),
      headers: new Headers({ "content-type": "application/json", accept: "application/json" }),
      body: JSON.stringify(request),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

const NEAR_ECHO = ["dry", "originAsset", "destinationAsset", "amount"];
const NEAR_QUOTE_AMOUNTS = ["amountIn", "amountOut", "minAmountOut"];
const nearIntegers = (quote) => NEAR_QUOTE_AMOUNTS.every(
  (k) => typeof quote?.[k] === "string" && NEAR_INTEGER.test(quote[k]));

// True when the answer is a quote for the request that was sent, with sound amounts.
function nearSound(json, sent) {
  const { quote, quoteRequest: echo } = json ?? {};
  const same = NEAR_ECHO.every((k) => echo?.[k] === sent[k]);
  if (!same || !nearIntegers(quote)) return false;
  return quote.amountIn === sent.amount && BigInt(quote.minAmountOut) <= BigInt(quote.amountOut);
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

function nearRefusal({ status, json }) {
  const minAmount = status === 400 ? NEAR_TOO_LOW.exec(json?.message)?.[1] : undefined;
  if (minAmount) return nearJson({ error: "too-low", minAmount }, 400);
  const refused = status >= 400 && status < 500 && !NEAR_NOT_SERVED.has(status);
  return refused ? nearJson({ error: "no-route" }, 400) : nearUnavailable();
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
  if (await nearOverLimit(env, key)) {
    return nearText("Too many quote requests from this network. Wait a minute.\n", 429);
  }
  const ask = nearAsk(await readBody(req, NEAR_MAX_BODY));
  if (!ask) return nearText("Send JSON with from, to, amount and slippageBps.\n", 400);
  const now = Date.now(), request = nearRequest(ask, now);
  const up = await nearCall(request);
  if (!up) return nearUnavailable();
  if (up.status === 200 || up.status === 201) {
    return nearSound(up.json, request) ? nearJson(nearAnswer(up.json, now)) : nearUnavailable();
  }
  return nearRefusal(up);
}
