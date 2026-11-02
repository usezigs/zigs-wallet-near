// The /near/quote, /near/swap and /near/status routes of cf/src/index.js and cf/src/near.js. The
// Worker gets a pair, an amount and a slippage from the page and asks NEAR Intents for a dry
// quote; behind NEAR_LIVE it asks for a live quote from SOL to ZEC and for the state of a swap. A
// stub replaces fetch and Date.now is fixed, so nothing here reaches a network.
// Run: node web/test/near-quote.mjs (Node 26)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A data: URL module resolves no relative import, so the gate and near modules get file URLs.
const GATE = new URL("../../cf/src/gate.js", import.meta.url).href;
const NEAR = new URL("../../cf/src/near.js", import.meta.url).href;
const source = readFileSync(new URL("../../cf/src/index.js", import.meta.url), "utf8").replace(
  'import { DurableObject } from "cloudflare:workers";',
  "const DurableObject = class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } };",
).replace('from "./gate.js";', `from "${GATE}";`).replace('from "./near.js";', `from "${NEAR}";`);
const { default: worker } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const UPSTREAM = "https://1click.chaindefuser.com/v0/quote";
const ID = {
  zec: "nep141:zec.omft.near",
  sol: "nep141:sol.omft.near",
  usdc: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
};
const CHAIN = { zec: "zec", sol: "sol", usdc: "sol" };
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
Date.now = () => NOW;
const step = (name) => console.log(`ok  ${name}`);

// The answer of NEAR Intents, as a live dry quote looks (HTTP 201): the request comes back in
// quoteRequest. `edit` changes the body before it goes out.
const good = (sent, edit) => {
  const out = String(BigInt(sent.amount) * 2n);
  const body = {
    quote: {
      amountIn: sent.amount, amountInFormatted: "1.0", amountInUsd: "1267.360000000000",
      minAmountIn: sent.amount, amountOut: out, amountOutUsd: "1266.447364777310",
      minAmountOut: String((BigInt(out) * 99n) / 100n), timeEstimate: 452,
      refundFee: "32000", withdrawFee: "98765",
    },
    quoteRequest: { ...sent, depositMode: "SIMPLE", appFees: [{ recipient: "ab", fee: 20 }] },
    signature: "ed25519:signature", timestamp: "2026-10-28T11:59:58.250Z",
    correlationId: "06c0f7d0-0c4d-4293-9de6-168aa14bd04d", depositAddress: "must-not-pass",
  };
  edit?.(body);
  return Response.json(body, { status: 201 });
};
const calls = [];
let reply = good;
// Like the real fetch, the stub fails when the signal of the call fires.
globalThis.fetch = async (url, init) => {
  const sent = init.body === undefined ? null : JSON.parse(init.body);
  calls.push({ url: String(url), init, sent });
  const answer = Promise.resolve().then(() => reply(sent));
  const stopped = new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });
  return Promise.race([answer, stopped]);
};
// A timeout of 10 s would stall the test: `fastDeadline` makes one of a few ms.
const realTimeout = AbortSignal.timeout, deadlines = [];
let fastDeadline = null;
AbortSignal.timeout = (ms) => {
  deadlines.push(ms);
  if (fastDeadline === null) return realTimeout.call(AbortSignal, ms);
  const stop = new AbortController();
  setTimeout(() => stop.abort(new DOMException("timed out", "TimeoutError")), fastDeadline);
  return stop.signal;
};

const assets = { fetch: async () => new Response("asset", { status: 404 }) };
const env = { DEV_NO_AUTH: "1", ASSETS: assets };
const bytes = (body) => (typeof body === "string" || body instanceof Uint8Array
  ? body : JSON.stringify(body));
// A Worker that throws counts as a failed check, with the label of the check.
const post = async (label, body, init = {}, e = env, path = "/near/quote") => {
  try {
    return await worker.fetch(new Request("https://app.zigs.app" + path,
      { method: "POST", body: bytes(body), ...init }), e);
  } catch (error) {
    return assert.fail(`${label}: the Worker threw ${error.message}`);
  }
};
const ask = { from: "zec", to: "sol", amount: "100000000", slippageBps: 100 };
const taken = () => calls.splice(0);
const json = async (res) => JSON.parse(await res.text());
const noStore = (res, label) => {
  assert.equal(res.headers.get("cache-control"), "no-store", label + ": no-store");
  assert.match(res.headers.get("content-type"), /^application\/json/, label + ": JSON");
};

// ── Only POST passes: 405 with Allow: POST, and the limit is not asked ──
{
  const counted = [];
  const e = { ...env, NEAR_PER_IP: { limit: async (o) => (counted.push(o), { success: false }) } };
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"]) {
    const res = await worker.fetch(new Request("https://app.zigs.app/near/quote", { method }), e);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "POST", method + ": Allow");
  }
  assert.deepEqual([calls.length, counted.length], [0, 0], "no call upstream, no limit counted");
  step("a method other than POST gives 405 with Allow: POST");
}

// ── The body has at most 512 bytes ──
{
  const pad = (n) => JSON.stringify(ask) + " ".repeat(n - JSON.stringify(ask).length);
  const big = await post("513 bytes", pad(513));
  assert.equal(big.status, 400, "513 bytes give 400");
  const huge = await post("1 MB", pad(1_000_000));
  assert.equal(huge.status, 400, "1 MB gives 400");
  assert.equal(calls.length, 0, "no call upstream for a body that is too large");
  const edge = await post("512 bytes", pad(512));
  assert.equal(edge.status, 200, "512 bytes pass");
  assert.equal(taken().length, 1);
  step("a body of 513 bytes gives 400 and a body of 512 bytes passes");
}

// ── Only the four fields, a pair of the allowlist, an amount and a slippage pass ──
{
  const bad = [
    ["no body", ""], ["no JSON", "from=zec"], ["null", "null"], ["a string", '"zec"'],
    ["an array", "[]"], ["bytes that are no UTF-8", new Uint8Array([0xff, 0xfe, 0x7b, 0x7d])],
    ["an empty object", {}], ["a missing amount", { ...ask, amount: undefined }],
    ["an extra field", { ...ask, memo: "x" }], ["a dry field", { ...ask, dry: false }],
    ["a recipient", { ...ask, recipient: "u1abc" }],
    ["an asset id as from", { ...ask, from: ID.zec }],
    ["the same asset on both sides", { ...ask, to: "zec" }],
    ["an upper case key", { ...ask, from: "ZEC" }],
    ["an asset outside the allowlist as from", { ...ask, from: "btc" }],
    ["an asset outside the allowlist as to", { ...ask, to: "btc" }],
    ["constructor as from", { ...ask, from: "constructor" }],
    ["toString as to", { ...ask, to: "toString" }],
    ["__proto__ as to", '{"from":"zec","to":"__proto__","amount":"1","slippageBps":50}'],
    ["a number as from", { ...ask, from: 1 }], ["an array as to", { ...ask, to: ["sol"] }],
    ["a zero amount", { ...ask, amount: "0" }], ["a leading zero", { ...ask, amount: "01" }],
    ["a number as amount", { ...ask, amount: 100000000 }],
    ["a decimal amount", { ...ask, amount: "1.5" }],
    ["a negative amount", { ...ask, amount: "-1" }],
    ["an exponent", { ...ask, amount: "1e3" }], ["a space", { ...ask, amount: " 1" }],
    ["an amount of 31 digits", { ...ask, amount: "1".repeat(31) }],
    ["a slippage of 0", { ...ask, slippageBps: 0 }],
    ["a slippage of 75", { ...ask, slippageBps: 75 }],
    ["a text slippage", { ...ask, slippageBps: "50" }],
    ["no slippage", { ...ask, slippageBps: null }],
  ];
  for (const [what, body] of bad) {
    const res = await post(what, body);
    assert.equal(res.status, 400, what + " gives 400");
    assert.match(await res.text(), /^Send JSON with/, what + ": a short text");
  }
  assert.equal(calls.length, 0, "no call upstream for any refused ask");
  for (const slippageBps of [50, 100, 200]) {
    const res = await post("slippage", { ...ask, slippageBps });
    assert.equal(res.status, 200, "slippage " + slippageBps);
  }
  const wide = await post("30 digits", { ...ask, amount: "9".repeat(30) });
  assert.equal(wide.status, 200, "an amount of 30 digits passes");
  assert.equal(taken().length, 4);
  step("a key outside the allowlist, an extra field and a bad amount or slippage give 400, " +
    "with no call upstream");
}

// ── The Worker builds the whole dry request ──
{
  const e = { ...env };
  const hostile = {
    "content-type": "application/json", cookie: "zigs_session=secret", authorization: "Basic eDp5",
    "cf-connecting-ip": "203.0.113.9", "user-agent": "Mozilla/5.0 test",
    "x-forwarded-for": "198.51.100.7",
    origin: "https://app.zigs.app", referer: "https://app.zigs.app/#page", "x-api-key": "k",
  };
  for (const from of Object.keys(ID)) {
    for (const to of Object.keys(ID).filter((k) => k !== from)) {
      const own = { from, to, amount: "12345", slippageBps: 200 };
      const res = await post(`${from}-${to}`, own, { headers: hostile }, e);
      assert.equal(res.status, 200, `${from} to ${to}`);
      const [call] = taken();
      assert.equal(call.url, UPSTREAM, "the URL");
      assert.equal(call.init.method, "POST");
      assert.equal(call.init.redirect, "manual", "the redirect stays unfollowed");
      assert.ok(call.init.signal instanceof AbortSignal, "a timeout");
      const names = [...new Headers(call.init.headers).keys()].sort();
      assert.deepEqual(names, ["accept", "content-type"], "no header of the user goes upstream");
      const sample = (key) => call.sent[key];
      assert.deepEqual(call.sent, {
        dry: true, swapType: "EXACT_INPUT", slippageTolerance: 200, originAsset: ID[from],
        depositType: "ORIGIN_CHAIN", destinationAsset: ID[to], amount: "12345",
        refundTo: sample("refundTo"), refundType: "ORIGIN_CHAIN", recipient: sample("recipient"),
        recipientType: "DESTINATION_CHAIN", deadline: new Date(NOW + 600_000).toISOString(),
      }, `${from} to ${to}: the whole request`);
      assert.equal(call.sent.dry, true, "dry is always true");
    }
  }
  assert.deepEqual(deadlines.at(-1), 10_000, "a timeout of 10 s");
  step("the request is dry, with the fixed fields, the allowlist ids and a deadline in 10 "
    + "minutes; no header of the user goes upstream");
}

// ── The sample addresses are fixed, one per chain, and never come from the user ──
{
  const seen = new Map();
  for (const from of Object.keys(ID)) {
    for (const to of Object.keys(ID).filter((k) => k !== from)) {
      const headers = { "cf-connecting-ip": "203.0.113.9" };
      await post("sample", { ...ask, from, to }, { headers });
      const [{ sent }] = taken();
      seen.set(`${from}>${to}`, sent);
      assert.ok(!(sent.refundTo + sent.recipient).includes("203.0.113"), "no address of the user");
    }
  }
  const { refundTo: zec, recipient: sol } = seen.get("zec>sol");
  assert.match(zec, /^u1[0-9a-z]{80,}$/, "a mainnet unified address on the Zcash side");
  assert.match(sol, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "a base58 address on the Solana side");
  const address = (key) => (CHAIN[key] === "zec" ? zec : sol);
  for (const [pair, sent] of seen) {
    const [from, to] = pair.split(">");
    assert.deepEqual([sent.refundTo, sent.recipient], [address(from), address(to)], pair);
  }
  step("the refund and the recipient are fixed sample addresses of the chain of each side");
}

// ── The answer holds only the allowed fields ──
{
  const res = await post("answer", ask);
  noStore(res, "200");
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.deepEqual(body, {
    amountIn: "100000000", amountOut: "200000000", minAmountOut: "198000000",
    amountInUsd: 1267.36, amountOutUsd: 1266.44736477731, timeEstimate: 452,
    quotedAt: "2026-10-28T11:59:58.250Z",
  });
  assert.deepEqual(Object.keys(body).sort(), ["amountIn", "amountInUsd", "amountOut",
    "amountOutUsd", "minAmountOut", "quotedAt", "timeEstimate"].sort());
  assert.ok(!JSON.stringify(body).includes("must-not-pass"), "the deposit address stays behind");
  taken();
  // A status of 200 passes like 201. A USD value or a time that is no number is left out.
  reply = (sent) => {
    const res201 = good(sent, (b) => {
      Object.assign(b.quote, { amountInUsd: "abc", amountOutUsd: -3, timeEstimate: "" });
      b.timestamp = "not a time";
    });
    return new Response(res201.body, { status: 200, headers: res201.headers });
  };
  const odd = await json(await post("odd", ask));
  assert.deepEqual(odd, { amountIn: "100000000", amountOut: "200000000", minAmountOut: "198000000",
    quotedAt: new Date(NOW).toISOString() }, "bad optional fields are left out; the Worker clock");
  for (const [field, value] of [["amountInUsd", "1e3"], ["amountInUsd", " "], ["amountInUsd", null],
    ["amountInUsd", {}], ["timeEstimate", "9".repeat(400)], ["timeEstimate", Infinity]]) {
    reply = (sent) => good(sent, (b) => { b.quote[field] = value; });
    const one = await json(await post("optional", ask));
    assert.ok(!(field in one), `${field} ${String(value).slice(0, 5)} is left out`);
  }
  reply = (sent) => good(sent, (b) => { b.quote.amountInUsd = 0; b.quote.timeEstimate = "17"; });
  const zero = await json(await post("zero", ask));
  assert.deepEqual([zero.amountInUsd, zero.timeEstimate], [0, 17], "0 and a numeric string pass");
  reply = good;
  taken();
  step("the answer holds only the seven allowed fields, as no-store JSON");
}

// ── The answer is checked before it is used ──
{
  const tampers = {
    "dry false": (b) => { b.quoteRequest.dry = false; },
    "dry missing": (b) => { delete b.quoteRequest.dry; },
    "dry as text": (b) => { b.quoteRequest.dry = "true"; },
    "another origin asset": (b) => { b.quoteRequest.originAsset = ID.sol; },
    "another destination asset": (b) => { b.quoteRequest.destinationAsset = ID.usdc; },
    "another amount": (b) => { b.quoteRequest.amount = "100000001"; },
    "no quoteRequest": (b) => { delete b.quoteRequest; },
    "a text quoteRequest": (b) => { b.quoteRequest = "x"; },
    "no quote": (b) => { delete b.quote; },
    "another amountIn": (b) => { b.quote.amountIn = "100000001"; },
    "a number as amountOut": (b) => { b.quote.amountOut = 5; },
    "a decimal amountOut": (b) => { b.quote.amountOut = "1.5"; },
    "a text amountOut": (b) => { b.quote.amountOut = "lots"; },
    "an amountOut with 41 digits": (b) => { b.quote.amountOut = "9".repeat(41); },
    "a leading zero in amountOut": (b) => { b.quote.amountOut = "0123"; },
    "no minAmountOut": (b) => { delete b.quote.minAmountOut; },
    "a text minAmountOut": (b) => { b.quote.minAmountOut = "-1"; },
    "minAmountOut above amountOut": (b) => { b.quote.minAmountOut = "200000001"; },
  };
  for (const [what, edit] of Object.entries(tampers)) {
    reply = (sent) => good(sent, edit);
    const res = await post(what, ask);
    assert.equal(res.status, 502, "the echo check: " + what);
    assert.deepEqual(await json(res), { error: "unavailable" }, what);
    noStore(res, what);
  }
  for (const [what, make] of Object.entries({
    "an array": () => Response.json([], { status: 201 }),
    "null": () => Response.json(null, { status: 201 }),
    "no JSON": () => new Response("<html>", { status: 201 }),
    "an empty body": () => new Response("", { status: 200 }),
  })) {
    reply = make;
    assert.equal((await post(what, ask)).status, 502, what + " gives 502");
  }
  reply = (sent) => good(sent, (b) => { b.quote.minAmountOut = b.quote.amountOut; });
  assert.equal((await post("equal", ask)).status, 200, "minAmountOut equal to amountOut passes");
  reply = good;
  taken();
  step("a bad echo, a bad amount or an answer that is no quote gives 502");
}

// ── Errors of NEAR Intents: too low, no route, unavailable ──
{
  const refuse = (status, body, headers = {}) => () => Response.json(body, { status, headers });
  const low = (digits) => ({ message: "Amount is too low for bridge, try at least " + digits });
  const NO_ROUTE = { error: "no-route" }, DOWN = { error: "unavailable" };
  const redirect = () => new Response(null,
    { status: 302, headers: { Location: "https://evil.example/" } });
  const cases = [
    ["too low", refuse(400, low("132000")), 400, { error: "too-low", minAmount: "132000" }],
    ["too low, a minimum of 30 digits", refuse(400, low("9".repeat(30))), 400,
      { error: "too-low", minAmount: "9".repeat(30) }],
    ["too low, a minimum of 31 digits", refuse(400, low("9".repeat(31))), 400, NO_ROUTE],
    ["a minimum with no number", refuse(400, { message: "Amount is too low for bridge" }), 400,
      NO_ROUTE],
    ["another 400", refuse(400, { message: "Failed to get quote" }), 400, NO_ROUTE],
    ["a 400 with no JSON", () => new Response("bad", { status: 400 }), 400, NO_ROUTE],
    ["a too low text with 422", refuse(422, low("132000")), 400, NO_ROUTE],
    ["404", refuse(404, { message: "x" }), 400, NO_ROUTE],
    ["422", refuse(422, { message: "x" }), 400, NO_ROUTE],
    ["401", refuse(401, { message: "x" }), 502, DOWN],
    ["403", refuse(403, { message: "x" }), 502, DOWN],
    ["408", refuse(408, { message: "x" }), 502, DOWN],
    ["429", refuse(429, { message: "x" }), 502, DOWN],
    ["500", refuse(500, { message: "x" }), 502, DOWN],
    ["502", () => new Response("bad gateway", { status: 502 }), 502, DOWN],
    ["503", refuse(503, { message: "x" }), 502, DOWN],
    ["a redirect", redirect, 502, DOWN],
    ["a 304", () => new Response(null, { status: 304 }), 502, DOWN],
    ["a 202 with a sound body", (sent) => {
      const ok = good(sent);
      return new Response(ok.body, { status: 202, headers: ok.headers });
    }, 502, DOWN],
    ["a network failure", () => { throw new TypeError("fetch failed"); }, 502, DOWN],
  ];
  for (const [what, make, status, body] of cases) {
    reply = make;
    const res = await post(what, ask);
    assert.equal(res.status, status, what);
    noStore(res, what);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), body, what);
    assert.ok(!text.includes("evil.example"), what + ": nothing of the upstream text");
  }
  reply = () => new Promise(() => {}); // never answers
  fastDeadline = 20;
  const slow = await post("timeout", ask);
  fastDeadline = null;
  assert.equal(slow.status, 502, "a timeout gives 502");
  assert.deepEqual(await json(slow), { error: "unavailable" });
  reply = good;
  taken();
  step("too low gives 400 with the minimum; other 4xx give 400 no-route; 401, 403, 408, 429, " +
    "5xx, a redirect, a 202, a timeout and a failure give 502");
}

// ── The limit per network: 429 over it, the key of the client, none without the binding ──
{
  const keys = [];
  let allow = true;
  const limit = async ({ key }) => (keys.push(key), { success: allow });
  const e = { ...env, NEAR_PER_IP: { limit } };
  const at = (ip) => ({ headers: { "cf-connecting-ip": ip } });
  assert.equal((await post("allowed", ask, at("203.0.113.9"), e)).status, 200);
  await post("v6", ask, at("2001:db8:1:2:3:4:5:6"), e);
  await post("mapped", ask, at("::ffff:203.0.113.10"), e);
  await post("local", ask, {}, e);
  assert.deepEqual(keys, ["203.0.113.9", "2001:db8:1:2::/64", "203.0.113.10", "local"],
    "the key is the one of the other limits");
  taken();
  allow = false;
  const res = await post("over", ask, at("203.0.113.9"), e);
  assert.equal(res.status, 429, "over the limit gives 429");
  assert.match(await res.text(), /Too many quote requests/);
  assert.equal(calls.length, 0, "no call upstream over the limit");
  const bad = await post("over, bad body", "x", at("203.0.113.9"), e);
  assert.equal(bad.status, 429, "the limit comes before the body check");
  const free = await post("no binding", ask);
  assert.equal(free.status, 200, "without the binding there is no limit");
  taken();
  const config = readFileSync(new URL("../../cf/wrangler.jsonc", import.meta.url), "utf8");
  const binding = /"name": "NEAR_PER_IP", "namespace_id": "(\d+)", "simple": \{ "limit": (\d+), /g;
  const found = [...config.matchAll(binding)].map((m) => m.slice(1).join("/"));
  assert.deepEqual(found, ["1007/60", "1008/60"], "60 a minute, in production and staging");
  const ids = [...config.matchAll(/"namespace_id": "(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "each rate-limit namespace id is used once");
  step("over the limit gives 429 with no call upstream; the key and the config are right");
}

// ── The gate runs first, and only this path is the route ──
{
  const locked = { ASSETS: assets, APP_PASSWORD: "pw-for-this-test" };
  const open = await post("no password", ask, {}, locked);
  assert.equal(open.status, 401, "a request with no password gets 401");
  const wrong = { headers: { authorization: "Basic " + btoa("x:wrong") } };
  assert.equal((await post("wrong", ask, wrong, locked)).status, 401, "a wrong password gets 401");
  assert.equal((await post("off", ask, {}, { ...locked, DEV_NO_AUTH: "0" })).status, 401);
  assert.equal((await post("no secret", ask, {}, { ASSETS: assets })).status, 401,
    "without the secret the gate refuses everything");
  assert.equal(calls.length, 0, "no call upstream for a refused request");
  const right = { headers: { authorization: "Basic " + btoa("x:pw-for-this-test") } };
  const res = await post("right", ask, right, locked);
  assert.equal(res.status, 200, "the right password passes");
  assert.match(res.headers.get("set-cookie"), /^zigs_session=/, "and gets the session cookie");
  taken();
  for (const path of ["/near/quote/", "/near", "/near/other", "/near/quote/x", "/NEAR/quote"]) {
    const other = await post(path, ask, {}, env, path);
    assert.equal(other.status, 404, path + " is no route");
  }
  assert.equal(calls.length, 0, "no call upstream for another path");
  step("the gate refuses first; another path is no route");
}

// ── The partner key NEAR_API_KEY goes upstream as X-API-Key, never to the page ──
{
  const KEY = "partner-key-for-this-test";
  const res = await post("key", ask, {}, { ...env, NEAR_API_KEY: KEY });
  assert.equal(res.status, 200);
  assert.ok(!(await res.text()).includes(KEY), "the key never reaches the page");
  const [call] = taken();
  const headers = new Headers(call.init.headers);
  assert.deepEqual([...headers.keys()].sort(), ["accept", "content-type", "x-api-key"],
    "the key header goes upstream");
  assert.equal(headers.get("x-api-key"), KEY, "the key goes as X-API-Key");
  step("the partner key goes upstream as X-API-Key when it is set, and never to the page");
}

// ── The live swap from SOL to ZEC: /near/swap and /near/status, behind NEAR_LIVE ──
const LIVE = { ...env, NEAR_LIVE: "1" };
const UA = "u1ddnjsdcpm36r6aq79n3s68shjweksnmwtdltrh046s8m6xcws9ygyawalxx8n6hg6vegk0wh8zjnafxgh6"
  + "mspp" + "jsljvyt0ynece3lvm0";
const REFUND = "CZ8YUVdk7znjrUmnb5n7kgySk9yRAsQDYmyCxzfSky9t"; // 32 bytes of 0xab
const DEPOSIT = "7DYCAhqwQSKqqL1h8V1XmY1BTcMWxrASQYKNMy87jeg3"; // 32 bytes of 0x5c
const STATUS_URL = "https://1click.chaindefuser.com/v0/status?depositAddress=" + DEPOSIT;
const swapAsk = { amount: "17500000", recipient: UA, refundTo: REFUND, slippageBps: 100 };
const minutes = (n) => new Date(NOW + n * 60_000).toISOString();
// The answer of NEAR Intents to a live quote: the request comes back, with a deposit address.
const liveGood = (sent, edit) => {
  const body = {
    quote: {
      depositAddress: DEPOSIT, amountIn: sent.amount, amountInFormatted: "0.0175",
      amountInUsd: "1.65", minAmountIn: sent.amount, amountOut: "133000", amountOutFormatted:
        "0.00133", amountOutUsd: "1.63", minAmountOut: "131670", deadline: minutes(30),
      timeWhenInactive: minutes(20), timeEstimate: 135, refundFee: "105631",
      withdrawFee: "32000",
    },
    quoteRequest: { ...sent, depositMode: "SIMPLE", appFees: [{ recipient: "ab", fee: 20 }] },
    signature: "ed25519:5wQkS9", timestamp: "2026-10-28T11:59:59.000Z",
    correlationId: "06c0f7d0-0c4d-4293-9de6-168aa14bd04d",
  };
  edit?.(body);
  return Response.json(body, { status: 201 });
};
const swap = (label, body, e = LIVE, init = {}) => post(label, body, init, e, "/near/swap");
const status = async (label, address = DEPOSIT, e = LIVE, init = {}) => {
  try {
    const query = address === null ? "" : "?depositAddress=" + address;
    return await worker.fetch(new Request("https://app.zigs.app/near/status" + query, init), e);
  } catch (error) {
    return assert.fail(`${label}: the Worker threw ${error.message}`);
  }
};

// ── NEAR_LIVE: only the string "1" opens the routes; the config has it on staging only ──
{
  const counted = [];
  const limit = async (o) => (counted.push(o), { success: true });
  for (const NEAR_LIVE of [undefined, "0", "", "true", " 1", "1 ", 1, true]) {
    const e = { ...env, NEAR_LIVE, NEAR_PER_IP: { limit } };
    for (const method of ["POST", "GET"]) {
      const res = await swap(`swap ${method} ${String(NEAR_LIVE)}`, method === "GET" ? undefined
        : swapAsk, e, { method });
      assert.equal(res.status, 404, `/near/swap ${method} with NEAR_LIVE=${String(NEAR_LIVE)}`);
    }
    assert.equal((await status("status off", DEPOSIT, e)).status, 404, "/near/status is off");
  }
  assert.deepEqual([calls.length, counted.length], [0, 0], "no call upstream, no limit counted");
  const config = JSON.parse(readFileSync(new URL("../../cf/wrangler.jsonc", import.meta.url),
    "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(config.vars.NEAR_LIVE, "0", "production stays off");
  assert.equal(config.env.staging.vars.NEAR_LIVE, "1", "staging is on");
  assert.deepEqual([config.vars.SOL_MAINNET, config.env.staging.vars.SOL_MAINNET], ["0", "1"],
    "SOL_MAINNET is off in production and on in staging");
  assert.ok(!JSON.stringify(config).includes("NEAR_API_KEY\":"), "the key is no var");
  step("the live routes answer 404 unless NEAR_LIVE is \"1\"; staging only is on");
}

// ── The page of a server with NEAR_LIVE gets data-near-live on <html> ──
{
  const realRewriter = globalThis.HTMLRewriter;
  const seen = [];
  globalThis.HTMLRewriter = class {
    constructor() { this.handlers = {}; }
    on(selector, handler) { this.handlers[selector] = handler; return this; }
    transform(res) {
      const marks = {};
      this.handlers.html.element({ setAttribute: (k, v) => { marks[k] = v; } });
      seen.push(marks);
      return res;
    }
  };
  const page = { fetch: async () => new Response("<html><title>t</title></html>") };
  try {
    for (const NEAR_LIVE of ["1", "0", undefined, "true"]) {
      const e = { ...env, ASSETS: page, NEAR_LIVE };
      await worker.fetch(new Request("https://app.zigs.app/"), e);
    }
  } finally {
    globalThis.HTMLRewriter = realRewriter;
  }
  assert.deepEqual(seen, [{ "data-near-live": "1" }, {}, {}, {}],
    "the mark is there for \"1\" only");
  step("the page carries data-near-live only when NEAR_LIVE is \"1\"");
}

// ── /near/swap takes POST, four fields, a mainnet unified address and a Solana address ──
{
  for (const method of ["GET", "PUT", "DELETE", "HEAD"]) {
    const res = await worker.fetch(new Request("https://app.zigs.app/near/swap", { method }), LIVE);
    assert.deepEqual([res.status, res.headers.get("allow")], [405, "POST"], "swap " + method);
  }
  const bad = [
    ["no body", ""], ["no JSON", "x"], ["an array", "[]"],
    ["a dry quote ask", ask], ["a missing refund", { ...swapAsk, refundTo: undefined }],
    ["an extra from", { ...swapAsk, from: "sol" }], ["an extra dry", { ...swapAsk, dry: true }],
    ["a t-address", { ...swapAsk, recipient: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs" }],
    ["a testnet address", { ...swapAsk, recipient: "utest1" + UA.slice(2) }],
    ["an upper case address", { ...swapAsk, recipient: UA.toUpperCase() }],
    ["a short address", { ...swapAsk, recipient: UA.slice(0, 61) }],
    ["an address with b", { ...swapAsk, recipient: UA.slice(0, -1) + "b" }],
    ["a number as recipient", { ...swapAsk, recipient: 5 }],
    ["a refund of 31 bytes", { ...swapAsk,
      refundTo: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofL" }],
    ["a refund of 33 bytes", { ...swapAsk,
      refundTo: "JJEfe6DcPM2ziB2vfUWDV6aHVerXRGkv3TcyvJUNGHZz" }],
    ["a refund with 0", { ...swapAsk, refundTo: "0" + REFUND.slice(1) }],
    ["a refund with a space", { ...swapAsk, refundTo: REFUND + " " }],
    ["an EVM refund", { ...swapAsk, refundTo: "0x76b4c56085ED136a8744D52bE956396624a730E8" }],
    ["a zero amount", { ...swapAsk, amount: "0" }], ["a number amount", { ...swapAsk, amount: 1 }],
    ["a slippage of 75", { ...swapAsk, slippageBps: 75 }],
    ["1025 bytes", JSON.stringify(swapAsk) + " ".repeat(1025 - JSON.stringify(swapAsk).length)],
  ];
  for (const [what, body] of bad) {
    const res = await swap(what, body);
    assert.equal(res.status, 400, what + " gives 400");
    assert.match(await res.text(), /^Send JSON with amount, recipient, refundTo/, what);
  }
  assert.equal(calls.length, 0, "no call upstream for a refused swap");
  const edge = JSON.stringify(swapAsk) + " ".repeat(1024 - JSON.stringify(swapAsk).length);
  reply = liveGood;
  assert.equal((await swap("1024 bytes", edge)).status, 200, "1024 bytes pass");
  const max = "JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG"; // 32 bytes of 0xff
  for (const refundTo of [max, "11111111111111111111111111111111"]) {
    assert.equal((await swap("32 bytes", { ...swapAsk, refundTo })).status, 200, refundTo);
  }
  assert.equal(taken().length, 3);
  reply = good;
  step("/near/swap refuses a bad method, field, address, amount or slippage, with no call");
}

// ── The Worker builds the whole live request from the ask, and checks the whole answer ──
{
  reply = liveGood;
  const hostile = { cookie: "zigs_session=secret", "cf-connecting-ip": "203.0.113.9",
    "x-api-key": "of-the-user", "content-type": "application/json" };
  const res = await swap("live", swapAsk, LIVE, { headers: hostile });
  assert.equal(res.status, 200);
  noStore(res, "live");
  const [call] = taken();
  assert.equal(call.url, UPSTREAM, "the quote URL");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "manual");
  assert.deepEqual([...new Headers(call.init.headers).keys()].sort(), ["accept", "content-type"],
    "no header of the user and no key of the user goes upstream");
  assert.deepEqual(call.sent, {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: ID.sol,
    depositType: "ORIGIN_CHAIN", destinationAsset: ID.zec, amount: "17500000", refundTo: REFUND,
    refundType: "ORIGIN_CHAIN", recipient: UA, recipientType: "DESTINATION_CHAIN",
    deadline: minutes(30),
  }, "the whole live request");
  assert.deepEqual(await json(res), {
    amountIn: "17500000", amountOut: "133000", minAmountOut: "131670", amountInUsd: 1.65,
    amountOutUsd: 1.63, timeEstimate: 135, quotedAt: "2026-10-28T11:59:59.000Z",
    depositAddress: DEPOSIT, deadline: minutes(30), timeWhenInactive: minutes(20),
    recipient: UA, refundTo: REFUND, correlationId: "06c0f7d0-0c4d-4293-9de6-168aa14bd04d",
    signature: "ed25519:5wQkS9",
  }, "only the allowed fields go to the page");
  const tampers = {
    "dry true": (b) => { b.quoteRequest.dry = true; },
    "no dry": (b) => { delete b.quoteRequest.dry; },
    "another recipient": (b) => { b.quoteRequest.recipient = UA.slice(0, -1) + "q"; },
    "another refund": (b) => { b.quoteRequest.refundTo = DEPOSIT; },
    "another origin": (b) => { b.quoteRequest.originAsset = ID.usdc; },
    "another destination": (b) => { b.quoteRequest.destinationAsset = ID.sol; },
    "another amount": (b) => { b.quoteRequest.amount = "17500001"; },
    "a deposit inside NEAR": (b) => { b.quoteRequest.depositType = "INTENTS"; },
    "a refund inside NEAR": (b) => { b.quoteRequest.refundType = "INTENTS"; },
    "a payout inside NEAR": (b) => { b.quoteRequest.recipientType = "INTENTS"; },
    "an exact output": (b) => { b.quoteRequest.swapType = "EXACT_OUTPUT"; },
    "a memo": (b) => { b.quote.depositMemo = "1111111"; },
    "an empty memo": (b) => { b.quote.depositMemo = ""; },
    "a recipient message": (b) => { b.quoteRequest.customRecipientMsg = "x.near"; },
    "a virtual recipient": (b) => { b.quote.virtualChainRecipient = "0xb4c2"; },
    "a virtual refund": (b) => { b.quote.virtualChainRefundRecipient = "0xb4c2"; },
    "no deposit address": (b) => { delete b.quote.depositAddress; },
    "an EVM deposit address": (b) => {
      b.quote.depositAddress = "0x76b4c56085ED136a8744D52bE956396624a730E8"; },
    "a deposit address of 31 bytes": (b) => {
      b.quote.depositAddress = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofL"; },
    "no deadline": (b) => { delete b.quote.deadline; },
    "a deadline that is no time": (b) => { b.quote.deadline = "soon"; },
    "a deadline in the past": (b) => { b.quote.deadline = minutes(-1); },
    "a deadline in 4 minutes": (b) => { b.quote.deadline = minutes(4); },
    "another amountIn": (b) => { b.quote.amountIn = "17500001"; },
    "minAmountOut above amountOut": (b) => { b.quote.minAmountOut = "133001"; },
    "a text amountOut": (b) => { b.quote.amountOut = "lots"; },
  };
  for (const [what, edit] of Object.entries(tampers)) {
    reply = (sent) => liveGood(sent, edit);
    const out = await swap(what, swapAsk);
    assert.equal(out.status, 502, "the live check: " + what);
    assert.deepEqual(await json(out), { error: "unavailable" }, what);
  }
  // The page shows the earlier of the address deadline and the refund time of the request.
  for (const [what, edit, payBy] of [
    ["a deadline in 5 minutes", (b) => { b.quote.deadline = minutes(5); }, minutes(5)],
    ["a deadline in 3 days", (b) => { b.quote.deadline = minutes(3 * 24 * 60); }, minutes(30)],
    ["no inactive time", (b) => { delete b.quote.timeWhenInactive; }, minutes(30)],
    ["no correlation id or signature", (b) => { delete b.correlationId; b.signature = "<x>"; },
      minutes(30)],
  ]) {
    reply = (sent) => liveGood(sent, edit);
    const out = await swap(what, swapAsk);
    assert.equal(out.status, 200, what + " passes");
    const body = await json(out);
    assert.notEqual(body.signature, "<x>", what + ": a signature of another form stays behind");
    assert.equal(body.deadline, payBy,
      what + ": the deadline is the earlier of the address deadline and the refund time");
  }
  reply = (sent) => liveGood(sent, (b) => { b.quote.depositMemo = "1"; });
  assert.ok(!(await (await swap("memo text", swapAsk)).text()).includes(DEPOSIT),
    "a refused answer shows no deposit address");
  const refuse = (code, body) => () => Response.json(body, { status: code });
  for (const [what, make, code, body] of [
    ["too low", refuse(400, { message: "Amount is too low for bridge, try at least 17392641" }),
      400, { error: "too-low", minAmount: "17392641" }],
    ["a bad address", refuse(400, { message: "Invalid recipient" }), 400, { error: "no-route" }],
    ["429", refuse(429, {}), 502, { error: "unavailable" }],
    ["500", refuse(500, {}), 502, { error: "unavailable" }],
    ["a failure", () => { throw new TypeError("fetch failed"); }, 502, { error: "unavailable" }],
  ]) {
    reply = make;
    const out = await swap(what, swapAsk);
    assert.deepEqual([out.status, await json(out)], [code, body], what);
  }
  const keyed = await swap("key", swapAsk, { ...LIVE, NEAR_API_KEY: "k-live" });
  assert.equal(new Headers(taken().at(-1).init.headers).get("x-api-key"), "k-live");
  assert.ok(!(await keyed.text()).includes("k-live"), "the key never reaches the page");
  reply = good;
  taken();
  step("the live request is dry false with the two addresses; the echo, the memo, the deposit "
    + "address and the deadline are checked; only the allowed fields go to the page");
}

// ── /near/status: GET with an address; only the state, hashes and amounts go back ──
{
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await status("status " + method, DEPOSIT, LIVE, { method });
    assert.deepEqual([res.status, res.headers.get("allow")], [405, "GET"], "status " + method);
  }
  for (const address of [null, "", "0x76b4c56085ED136a8744D52bE956396624a730E8",
    "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofL", DEPOSIT + "%26x%3D1", "x"]) {
    const res = await status("address " + address, address);
    assert.equal(res.status, 400, "a bad address gives 400: " + address);
  }
  assert.equal(calls.length, 0, "no call upstream for a bad address");
  const tx = (hash) => ({ hash, explorerUrl: "https://evil.example/tx/" + hash });
  const SOL_TX = "5wQkS9".padEnd(88, "A"), ZEC_TX = "ab".repeat(32);
  const state = (edit) => () => {
    const body = {
      correlationId: "c", status: "SUCCESS", updatedAt: "2026-10-28T12:05:00Z",
      quoteResponse: { quote: { depositAddress: DEPOSIT } },
      swapDetails: { intentHashes: ["i"], nearTxHashes: ["n"], amountIn: "17500000",
        amountOut: "133100", depositedAmount: "17500000", refundedAmount: "0",
        refundReason: "PARTIAL_DEPOSIT", slippage: 12,
        originChainTxHashes: [tx(SOL_TX)], destinationChainTxHashes: [tx(ZEC_TX)] },
    };
    edit?.(body);
    return Response.json(body);
  };
  reply = state();
  const res = await status("success");
  noStore(res, "status");
  const [call] = taken();
  assert.deepEqual([call.url, call.init.method, call.init.body], [STATUS_URL, "GET", undefined]);
  assert.deepEqual([...new Headers(call.init.headers).keys()], ["accept"], "accept only");
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), {
    status: "SUCCESS", updatedAt: "2026-10-28T12:05:00.000Z", originTxs: [SOL_TX],
    destinationTxs: [ZEC_TX], refundReason: "PARTIAL_DEPOSIT", amountIn: "17500000",
    amountOut: "133100", depositedAmount: "17500000", refundedAmount: "0",
  }, "only the allowed fields");
  assert.ok(!text.includes("evil.example"), "no explorer link from upstream");
  for (const [what, edit, check] of [
    ["a state that is not known", (b) => { b.status = "NEW_STATE"; },
      (o) => assert.equal(o.status, "other", "a state that is not known is other")],
    ["a lower case state", (b) => { b.status = "success"; },
      (o) => assert.equal(o.status, "other")],
    ["no details", (b) => { delete b.swapDetails; },
      (o) => assert.deepEqual([o.originTxs, o.destinationTxs, o.amountOut], [[], [], undefined])],
    ["bad hashes", (b) => { b.swapDetails.originChainTxHashes = [tx("<script>"), tx(5), "x",
      null, tx("short")]; }, (o) => assert.deepEqual(o.originTxs, [])],
    ["many hashes", (b) => { b.swapDetails.destinationChainTxHashes = Array(20).fill(tx(ZEC_TX)); },
      (o) => assert.equal(o.destinationTxs.length, 8)],
    ["a bad amount and reason", (b) => {
      Object.assign(b.swapDetails, { amountOut: "1.5", refundReason: "<b>" }); },
    (o) => assert.deepEqual([o.amountOut, o.refundReason], [undefined, undefined])],
  ]) {
    reply = state(edit);
    check(await json(await status(what)));
  }
  for (const [what, make, code, body] of [
    ["another deposit address", state((b) => { b.quoteResponse.quote.depositAddress = REFUND; }),
      502, { error: "unavailable" }],
    ["no quoteResponse", state((b) => { delete b.quoteResponse; }), 502, { error: "unavailable" }],
    ["an array", () => Response.json([]), 502, { error: "unavailable" }],
    ["404", () => Response.json({ message: "Deposit address not found" }, { status: 404 }), 404,
      { error: "unknown" }],
    ["401", () => Response.json({}, { status: 401 }), 502, { error: "unavailable" }],
    ["500", () => new Response("x", { status: 500 }), 502, { error: "unavailable" }],
    ["a redirect", () => new Response(null, { status: 302, headers: { Location: "https://x/" } }),
      502, { error: "unavailable" }],
    ["a failure", () => { throw new TypeError("fetch failed"); }, 502, { error: "unavailable" }],
  ]) {
    reply = make;
    const out = await status(what);
    assert.deepEqual([out.status, await json(out)], [code, body], what);
  }
  reply = () => new Promise(() => {});
  fastDeadline = 20;
  assert.equal((await status("timeout")).status, 502, "a timeout gives 502");
  fastDeadline = null;
  reply = state();
  await status("key", DEPOSIT, { ...LIVE, NEAR_API_KEY: "k-status" });
  assert.equal(new Headers(taken().at(-1).init.headers).get("x-api-key"), "k-status");
  reply = good;
  taken();
  step("/near/status asks GET with the address only and gives the state, hashes and amounts");
}

// ── The limit per network counts the live routes too, before the body and the address ──
{
  const keys = [];
  const limit = async ({ key }) => (keys.push(key), { success: false });
  const e = { ...LIVE, NEAR_PER_IP: { limit } };
  const at = { headers: { "cf-connecting-ip": "203.0.113.9" } };
  const over = await swap("over", "x", e, at);
  assert.equal(over.status, 429, "/near/swap over the limit");
  const stat = await status("over", "x", e, at);
  assert.equal(stat.status, 429, "/near/status over the limit");
  assert.deepEqual(keys, ["203.0.113.9", "203.0.113.9"], "one counter, the key of the client");
  assert.equal(calls.length, 0, "no call upstream over the limit");
  const locked = { ASSETS: assets, APP_PASSWORD: "pw", NEAR_LIVE: "1" };
  assert.equal((await swap("gate", swapAsk, locked)).status, 401, "the gate runs first");
  assert.equal((await status("gate", DEPOSIT, locked)).status, 401, "for the state too");
  assert.equal(calls.length, 0);
  step("the live routes share the limit per network and stay behind the gate");
}
console.log("near-quote tests passed");
process.exit(0);
