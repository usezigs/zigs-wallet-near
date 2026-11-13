// Tests of the password gate (cf/src/gate.js), offline: node cf/test/gate.mjs   (Node 26)
// The gate sets a session cookie after a valid password and gives no Basic challenge to a
// background request of a browser, so that iOS Safari, which sends no cached password on the
// group WebSocket, never prompts again while the page runs.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { PLAIN_WORKER_POLICY } from "../../web/sol/plain/guard.js";
import { WORKER_POLICY_MAINNET } from "../../web/sol/session.js";
import { closureOf, web } from "../../web/test/closure.mjs";
import { COOKIE, MAX_AGE_S, gate, sessionCookie, withCookie } from "../src/gate.js";

// The real fetch handler of cf/src/index.js, as web/test/lwd.mjs loads it: a stub for the
// Cloudflare import, and the file URLs of the gate and near modules, which a data: URL cannot
// resolve.
const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
  .replace('import { DurableObject } from "cloudflare:workers";', "const DurableObject = class {};")
  .replace('from "./gate.js";', `from "${new URL("../src/gate.js", import.meta.url).href}";`)
  .replace('from "./near.js";', `from "${new URL("../src/near.js", import.meta.url).href}";`)
  .replace('from "./portfolio.js";',
    `from "${new URL("../src/portfolio.js", import.meta.url).href}";`);
const { default: worker } = await import(
  `data:text/javascript;base64,${Buffer.from(index).toString("base64")}`);

const PASSWORD = `pw-${randomBytes(12).toString("hex")}`;
const ENV = { APP_PASSWORD: PASSWORD };
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const BASE = "https://app.zigs.app";
const basic = (pw, user = "demo") => `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;
const NAV = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };
const SOCKET = {
  "Sec-Fetch-Mode": "websocket", "Sec-Fetch-Dest": "websocket", Upgrade: "websocket",
};
const request = (path, headers = {}) => new Request(BASE + path, { headers });
const valueOf = (setCookie) => setCookie.split(";")[0].slice(COOKIE.length + 1);
const withSession = (value, headers = {}) =>
  ({ ...headers, Cookie: `other=1; ${COOKIE}=${value}` });

// ── The https redirect comes first ──
{
  const http = request("/x?y=1", { "cf-visitor": '{"scheme":"http"}' });
  const { refused } = await gate(http, { DEV_NO_AUTH: "1" }, NOW);
  assert.equal(refused.status, 301, "even with DEV_NO_AUTH");
  assert.equal(refused.headers.get("Location"), `${BASE}/x?y=1`);
  const proxied = request("/", { "x-forwarded-proto": "http", Authorization: basic(PASSWORD) });
  const onHttp = await gate(proxied, ENV, NOW);
  assert.equal(onHttp.refused.status, 301, "a password never goes on http");
  assert.deepEqual(await gate(request("/"), { DEV_NO_AUTH: "1" }, NOW), {}, "local runs stay open");
  console.log("ok  the https redirect comes first, and DEV_NO_AUTH keeps local runs open");
}

// ── A valid password passes and gets the session cookie ──
let session = null;
{
  const { refused, cookie } = await gate(request("/", { ...NAV, Authorization: basic(PASSWORD) }),
    ENV, NOW);
  assert.equal(refused, undefined);
  const parts = cookie.split("; ");
  assert.equal(parts[0].split("=")[0], COOKIE);
  assert.deepEqual(parts.slice(1),
    [`Max-Age=${MAX_AGE_S}`, "Path=/", "HttpOnly", "Secure", "SameSite=Strict"]);
  assert.equal(MAX_AGE_S, 604_800, "seven days");
  session = valueOf(cookie);
  const b64 = Buffer.from(PASSWORD).toString("base64");
  assert.ok(!cookie.includes(PASSWORD) && !cookie.includes(b64), "the cookie holds no password");
  assert.match(session, /^\d+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(Number(session.split(".")[0]), NOW / 1000 + MAX_AGE_S, "the expiry is in the value");
  const any = await gate(request("/x", { Authorization: basic(PASSWORD, "anyone") }), ENV, NOW);
  assert.ok(any.cookie, "any user name");
  const secureOn = async (url) => (await sessionCookie(new Request(url), PASSWORD, NOW))
    .includes("; Secure");
  // wrangler dev gives the Worker the route host over http, with no cf-visitor header.
  assert.equal(await secureOn("http://app.zigs.app/"), false, "local dev: Safari drops Secure");
  assert.equal(await secureOn("https://app.zigs.app/"), true, "production is https");
  console.log("ok  a valid password passes and gets a seven-day HttpOnly cookie with no password");
}

// ── The cookie alone opens every route, the WebSocket too ──
{
  for (const [path, headers] of [["/ws?g=" + "0".repeat(20), SOCKET], ["/sol/worker.js", {}],
    ["/lwd/x", { "Sec-Fetch-Mode": "cors" }], ["/", NAV]]) {
    assert.deepEqual(await gate(request(path, withSession(session, headers)), ENV, NOW), {}, path);
  }
  const both = request("/", withSession(session, { Authorization: basic(PASSWORD) }));
  assert.deepEqual(await gate(both, ENV, NOW), {}, "a valid cookie gets no new one");
  const shadowed = { Cookie: `${COOKIE}=junk; ${COOKIE}=1.x; other=2; ${COOKIE}=${session}` };
  assert.deepEqual(await gate(request("/ws", { ...SOCKET, ...shadowed }), ENV, NOW), {},
    "a cookie of the same name from a sibling host shadows no valid one");
  const junk = (n) => Array(n).fill(`${COOKIE}=junk`);
  const fourth = { Cookie: [...junk(3), `${COOKIE}=${session}`].join("; ") };
  assert.deepEqual(await gate(request("/ws", { ...SOCKET, ...fourth }), ENV, NOW), {},
    "the fourth value still counts");
  const many = { Cookie: [...junk(4), `${COOKIE}=${session}`].join("; ") };
  const capped = await gate(request("/ws", { ...SOCKET, ...many }), ENV, NOW);
  assert.equal(capped.refused?.status, 401, "at most four values of the name count");
  const late = NOW + (MAX_AGE_S - 1) * 1000;
  assert.deepEqual(await gate(request("/ws", withSession(session, SOCKET)), ENV, late), {});
  console.log("ok  the cookie alone opens every route, the WebSocket too, until it expires");
}

// ── A forged, expired, malformed or old cookie is refused ──
{
  const [expiry, mac] = session.split(".");
  const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
  const bad = [
    ["a forged mac", `${expiry}.${flipped}`],
    ["a longer life", `${Number(expiry) + 3600}.${mac}`],
    ["no mac", expiry],
    ["a short mac", `${expiry}.${mac.slice(1)}`],
    ["a long mac", `${expiry}.${mac}A`],
    ["junk", "x"],
    ["an empty value", ""],
  ];
  for (const [what, value] of bad) {
    const { refused } = await gate(request("/ws", withSession(value, SOCKET)), ENV, NOW);
    assert.equal(refused?.status, 401, what);
  }
  const expired = await gate(request("/ws", withSession(session, SOCKET)), ENV,
    NOW + MAX_AGE_S * 1000);
  assert.equal(expired.refused?.status, 401, "an expired cookie");
  const renamed = { Cookie: `x${COOKIE}=${session}` };
  assert.equal((await gate(request("/", renamed), ENV, NOW)).refused?.status, 401, "another name");
  const changed = { APP_PASSWORD: PASSWORD + "-new" };
  const old = await gate(request("/ws", withSession(session, SOCKET)), changed, NOW);
  assert.equal(old.refused?.status, 401, "a new password ends every old cookie");
  console.log("ok  a forged, expired, malformed, renamed or old-password cookie fails");
}

// ── No secret, no entry: also not with a cookie that an empty password would sign ──
{
  // WebCrypto takes no empty HMAC key, so node:crypto signs as cookieKey would with "".
  const keyOfEmpty = createHmac("sha256", "").update("zigs session cookie v1").digest();
  const expiry = String(NOW / 1000 + MAX_AGE_S);
  const empty = `${expiry}.${createHmac("sha256", keyOfEmpty).update(expiry).digest("base64url")}`;
  for (const env of [{}, { APP_PASSWORD: "" }]) {
    const tries = [request("/", withSession(empty, NAV)),
      request("/", { Authorization: basic("") }), request("/", withSession(session, NAV))];
    for (const req of tries) assert.equal((await gate(req, env, NOW)).refused?.status, 401);
  }
  const typo = request("/", { ...NAV, Authorization: basic(PASSWORD + "x") });
  const wrong = await gate(typo, ENV, NOW);
  assert.equal(wrong.refused?.status, 401, "a wrong password");
  const broken = await gate(request("/", { Authorization: "Basic %%%" }), ENV, NOW);
  assert.equal(broken.refused?.status, 401, "credentials that are no base64");
  const b64 = Buffer.from(`demo:${PASSWORD}`).toString("base64");
  const bearer = await gate(request("/", { Authorization: `Bearer ${b64}` }), ENV, NOW);
  assert.equal(bearer.refused?.status, 401, "only the Basic scheme");
  const colon = { APP_PASSWORD: "a:b:c" };
  const colons = await gate(request("/", { Authorization: basic("a:b:c") }), colon, NOW);
  assert.ok(colons.cookie, "a password with colons: all after the first colon counts");
  // A wrong password whose SHA-256 ends with the same byte: a compare of one byte would take it.
  const last = (text) => createHash("sha256").update(text).digest().at(-1);
  let twin = 0;
  while (last(PASSWORD + twin) !== last(PASSWORD)) twin += 1;
  const near = await gate(request("/", { Authorization: basic(PASSWORD + twin) }), ENV, NOW);
  assert.equal(near.refused?.status, 401, "every byte of the digest counts");
  console.log("ok  without the secret nothing passes, and a wrong password fails");
}

// ── Only a navigation or a request without fetch metadata gets the Basic challenge ──
{
  const challenge = async (headers) =>
    (await gate(request("/", headers), ENV, NOW)).refused.headers.get("WWW-Authenticate");
  const BASIC = 'Basic realm="Zigs preview", charset="UTF-8"';
  assert.equal(await challenge(NAV), BASIC, "a navigation");
  assert.equal(await challenge({ "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "document" }),
    BASIC, "a document");
  assert.equal(await challenge({}), BASIC, "no fetch metadata: curl, a tool, an old browser");
  assert.equal(await challenge({ "Sec-Fetch-Mode": "cors" }), BASIC,
    "Node fetch: a mode but no Sec-Fetch-Dest, as demo-check sends it");
  assert.equal(await challenge({ "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe" }),
    BASIC, "a navigation of a frame");
  const quiet = [SOCKET, { "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" },
    { "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" },
    { "Sec-Fetch-Mode": "same-origin", "Sec-Fetch-Dest": "worker" }];
  for (const headers of quiet) {
    assert.equal(await challenge(headers), null, JSON.stringify(headers));
  }
  const plain = (await gate(request("/ws", SOCKET), ENV, NOW)).refused;
  assert.equal(plain.status, 401);
  assert.match(await plain.text(), /needs a password/);
  console.log("ok  a navigation or a tool gets the Basic challenge; a background request does not");
}

// ── The cookie goes on the response, but not on a WebSocket upgrade ──
{
  const res = withCookie(new Response("page", { headers: { "X-A": "1" } }), "c=1");
  assert.equal(res.headers.get("Set-Cookie"), "c=1");
  assert.equal(res.headers.get("X-A"), "1");
  assert.equal(await res.text(), "page");
  const frozen = await fetch("data:text/plain,asset");
  assert.equal(withCookie(frozen, "c=1").headers.get("Set-Cookie"), "c=1", "immutable headers");
  const upgrade = { status: 101, webSocket: {} };
  assert.equal(withCookie(upgrade, "c=1"), upgrade, "a 101 passes as it is");
  const none = new Response("x");
  assert.equal(withCookie(none, undefined), none);
  console.log("ok  the response carries the cookie; a WebSocket upgrade passes unchanged");
}
// ── The real handler sets the cookie, takes it alone, and prompts no background request ──
{
  const assets = { fetch: async () => new Response("asset body") };
  const env = { ...ENV, ASSETS: assets };
  const call = (headers) => worker.fetch(request("/app.js", headers), env);
  const first = await call({ Authorization: basic(PASSWORD) });
  assert.equal(first.status, 200);
  const cookie = first.headers.get("Set-Cookie");
  const attributes = "; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Strict";
  assert.ok(cookie.startsWith(`${COOKIE}=`) && cookie.endsWith(attributes), cookie);
  assert.equal(await first.text(), "asset body");
  const again = await call({ Cookie: cookie.split(";")[0], ...SOCKET });
  assert.deepEqual([again.status, again.headers.get("Set-Cookie")], [200, null]);
  const quiet = await call(SOCKET);
  assert.deepEqual([quiet.status, quiet.headers.get("WWW-Authenticate")], [401, null]);
  console.log("ok  the real handler sets the cookie, takes it alone, and prompts no socket");
}

// ── The plain Solana wallet: /sol/config-mainnet.json and the files of /sol/plain ──
// SOL_MAINNET is the switch of the owner. It is off ("0") at the top level of cf/wrangler.jsonc
// (production) and on ("1") in staging, and the Devnet
// beta (/sol/config.json and the other files of /sol) answers as before.
{
  const served = [];
  const assets = {
    fetch: async (req) => {
      served.push(new URL(req.url).pathname);
      return new Response("asset body", { headers: { "content-type": "text/javascript" } });
    },
  };
  const WORKER_POLICY = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
    "connect-src 'self' https://devnet.helius-rpc.com " +
    "https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/78751f5d1c591777/; base-uri 'none'";
  const PLAIN_POLICY = "default-src 'none'; script-src 'self'; connect-src 'self' " +
    "https://devnet.helius-rpc.com https://mainnet.helius-rpc.com; base-uri 'none'";
  const PROVER_POLICY = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
    "connect-src 'self'; base-uri 'none'";
  const MAIN_SECRET = "https://mainnet.helius-rpc.com/?api-key=mainnet-test-value";
  const DEV_SECRET = "https://devnet.helius-rpc.com/?api-key=devnet-test-value";
  const OPEN = { DEV_NO_AUTH: "1", ASSETS: assets, HELIUS_MAINNET_URL: MAIN_SECRET,
    HELIUS_DEVNET_URL: DEV_SECRET };
  const ask = (path, env, init = {}) => worker.fetch(
    new Request(BASE + path, { headers: { "x-forwarded-proto": "https" }, ...init }), env);
  const CONFIG = "/sol/config-mainnet.json";
  const policyOf = async (path, env) =>
    (await ask(path, env)).headers.get("content-security-policy");
  const hasNoSecret = async (res, what) =>
    assert.doesNotMatch(await res.text(), /test-value/, `${what} gave a value`);

  assert.equal(PLAIN_WORKER_POLICY, PLAIN_POLICY, "the page and the server agree on one text");
  const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(wrangler.vars.SOL_MAINNET, "0", "mainnet is off at the top level");
  assert.equal(wrangler.env.staging.vars.SOL_MAINNET, "1", "and on in staging");
  assert.equal(wrangler.env.staging.vars.DEV_NO_AUTH, "0", "staging keeps its password");
  assert.equal(JSON.stringify(wrangler).includes("api-key"), false, "no key in the config");

  // The config route is 404 for everything but the string "1", with or without the secret.
  for (const SOL_MAINNET of [undefined, "0", "", "true", " 1", "1 ", "on", 1, true, null]) {
    for (const SOL of ["1", "0"]) {
      const env = { ...OPEN, SOL, SOL_MAINNET };
      served.length = 0;
      for (const method of ["GET", "POST"]) {
        const res = await ask(CONFIG, env, { method });
        assert.equal(res.status, 404, `${method} with SOL_MAINNET=${String(SOL_MAINNET)}`);
        await hasNoSecret(res, "a 404");
      }
      assert.deepEqual(served, [], "the asset server was not asked");
    }
  }
  console.log("ok  /sol/config-mainnet.json is 404 unless SOL_MAINNET is the string 1");

  // On: 503 without the secret, 200 with it, GET only, never cached.
  for (const SOL of ["1", "0", undefined]) {
    const env = { ...OPEN, SOL, SOL_MAINNET: "1" };
    const res = await ask(CONFIG, env);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^application\/json/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(await res.json(), { rpcUrl: MAIN_SECRET });
    assert.equal((await ask(`${CONFIG}?x=1`, env)).status, 200, "a query string");
    for (const unset of [undefined, "", null]) {
      const none = await ask(CONFIG, { ...env, HELIUS_MAINNET_URL: unset });
      assert.equal(none.status, 503, `unset as ${JSON.stringify(unset)}`);
      assert.equal(none.headers.get("cache-control"), "no-store");
      const body = await none.json();
      assert.equal(typeof body.error, "string");
      assert.equal(body.rpcUrl, undefined);
    }
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD"]) {
      const bad = await ask(CONFIG, env, { method });
      assert.equal(bad.status, 405, method);
      await hasNoSecret(bad, `a ${method}`);
    }
  }
  const spellings = ["/SOL/config-mainnet.json", "//sol/config-mainnet.json",
    "/sol//config-mainnet.json", "/sol/config-mainnet.json/", "/sol/Config-Mainnet.json",
    "/sol%2Fconfig-mainnet.json", "/sol/%63onfig-mainnet.json", "/sol/config-mainnet.json%2f"];
  for (const path of spellings) {
    await hasNoSecret(await ask(path, { ...OPEN, SOL: "1", SOL_MAINNET: "1" }), path);
  }
  console.log("ok  with SOL_MAINNET on: 503 without the secret, 200 with it, GET only, no-store");

  // The password gate comes first. A request with the password gets the answer.
  const gated = { ...OPEN, DEV_NO_AUTH: undefined, APP_PASSWORD: PASSWORD, SOL_MAINNET: "1" };
  const denied = await ask(CONFIG, gated);
  assert.equal(denied.status, 401);
  await hasNoSecret(denied, "the gate");
  const withPassword = {
    headers: { "x-forwarded-proto": "https", Authorization: basic(PASSWORD) },
  };
  const pass = await ask(CONFIG, gated, withPassword);
  assert.equal(pass.status, 200);
  assert.deepEqual(await pass.json(), { rpcUrl: MAIN_SECRET });
  const plainDenied = await ask("/sol/plain/worker.js", { ...gated, SOL: "1" });
  assert.equal(plainDenied.status, 401, "the files of /sol/plain are behind the gate too");
  console.log("ok  the password gate answers before /sol/config-mainnet.json and /sol/plain");

  // /sol/config.json keeps its behaviour, whatever SOL_MAINNET says.
  for (const SOL_MAINNET of ["0", "1"]) {
    const env = { ...OPEN, SOL: "1", SOL_MAINNET };
    const on = await ask("/sol/config.json", env);
    assert.equal(on.status, 200);
    assert.deepEqual(await on.json(), { rpcUrl: DEV_SECRET });
    assert.equal(on.headers.get("content-security-policy"), WORKER_POLICY);
    const off = await ask("/sol/config.json", { ...env, SOL: "0" });
    assert.equal(off.status, 404, "with SOL off");
    await hasNoSecret(off, "SOL off");
    const unset = await ask("/sol/config.json", { ...env, HELIUS_DEVNET_URL: undefined });
    assert.equal(unset.status, 503);
    assert.equal((await ask("/sol/config.json", env, { method: "POST" })).status, 405);
  }
  console.log("ok  /sol/config.json answers as before and never holds the mainnet URL");

  // The files of /sol/plain carry the policy of the plain Worker, in every spelling.
  for (const [SOL, SOL_MAINNET] of [["1", "0"], ["1", "1"], ["0", "1"], ["1", undefined]]) {
    const env = { ...OPEN, SOL, SOL_MAINNET };
    for (const file of ["worker.js", "guard.js"]) {
      const res = await ask(`/sol/plain/${file}`, env);
      assert.equal(res.status, 200, `SOL=${SOL} SOL_MAINNET=${SOL_MAINNET}`);
      assert.equal(res.headers.get("content-security-policy"), PLAIN_POLICY);
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(await res.text(), "asset body");
    }
  }
  const loose = ["/SOL/Plain/worker.js", "/sol//plain/worker.js", "/sol/plain%2Fworker.js",
    "/sol%2Fplain%2Fworker.js", "/sol\\plain\\worker.js", "/sol/pl%61in/guard.js",
    "/sol/plain/..%2fworker.js", "/sol/plain", "/sol/plain/", "/sol/plain/x/y.wasm"];
  for (const path of loose) {
    assert.equal(await policyOf(path, { ...OPEN, SOL: "1" }), PLAIN_POLICY, path);
  }
  const rest = [["/sol/worker.js", WORKER_POLICY], ["/sol/guard.js", WORKER_POLICY],
    ["/sol/plainx.js", WORKER_POLICY], ["/sol/xplain/a.js", WORKER_POLICY],
    ["/sol/prover/prover.worker.js", PROVER_POLICY], ["/sol/plain.js", WORKER_POLICY]];
  for (const [path, policy] of rest) {
    assert.equal(await policyOf(path, { ...OPEN, SOL: "1", SOL_MAINNET: "1" }), policy, path);
  }
  console.log("ok  /sol/plain carries the plain Worker policy; the other /sol files keep theirs");

  // With SOL off and SOL_MAINNET on, only the plain modules answer, in one spelling.
  const only = { ...OPEN, SOL: "0", SOL_MAINNET: "1" };
  const closed = ["/sol/worker.js", "/sol/guard.js", "/sol/config.json", "/sol/zolana.bundle.js",
    "/sol/wasm/sol_wasm.d.ts", "/sol/prover/prover.worker.js", "/sol", "/sol/", "/sol/plain",
    "/sol/plain/", "/SOL/plain/worker.js", "/sol/Plain/worker.js", "/sol/plain/Worker.js",
    "/sol//plain/worker.js", "/sol/plain/..%2fworker.js", "/sol/plain%2Fworker.js",
    "/sol%2Fplain/worker.js", "/sol/plain/wor%6Ber.js", "/sol/plain/worker.js/",
    "/sol/plain/worker.json", "/sol/plain/sub/worker.js", "/sol/plain/.js", "/sol/plain/a_b.js",
    "/sol/plain/./../worker.js", "/sol/plain\\..\\worker.js", "/sol/plain/%2e%2e/worker.js",
    "/sol/plain/worker.js%00", "/sol/plain/worker.js%2f..%2fguard.js"];
  served.length = 0;
  for (const path of closed) {
    const res = await ask(path, only);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get("content-security-policy"), null, path);
    await hasNoSecret(res, path);
  }
  assert.deepEqual(served, [], "the asset server was not asked for any Devnet file");
  for (const file of ["worker", "guard"]) {
    assert.equal((await ask(`/sol/plain/${file}.js?v=1`, only)).status, 200);
  }
  assert.deepEqual(served, ["/sol/plain/worker.js", "/sol/plain/guard.js"]);
  console.log("ok  with SOL off, only /sol/plain/<name>.js answers: no path reaches a Devnet file");

  // The plain wallet also loads shared modules and the wasm file: the page imports them from /sol.
  // The list of the server is the closure of the plain controller and of the backup module (which
  // the page imports for a restore), plus the wasm file, and every other file of web/sol is 404.
  const closure = closureOf(["sol/plain/control.js", "sol/backup.js"]);
  const wanted = [...closure.keys()].filter((f) => /^sol\/(?!plain\/)/.test(f)).map((f) => "/" + f);
  wanted.push("/sol/wasm/sol_wasm_bg.wasm");
  const listed = /PLAIN_SOL_FILES = new Set\(\[([^\]]*)\]\)/.exec(index)[1].match(/"[^"]*"/g);
  assert.deepEqual(listed.map((text) => JSON.parse(text)).sort(), wanted.sort(),
    "the list of the server is the closure of the plain wallet");
  const solDir = new URL("sol/", web);
  const onDisk = readdirSync(solDir, { recursive: true })
    .filter((f) => statSync(new URL(f, solDir)).isFile()).map((f) => `/sol/${f}`);
  for (const path of wanted) assert.ok(onDisk.includes(path), `${path} is a file of web/sol`);
  const plainFile = (path) => /^\/sol\/plain\/[a-z0-9-]+\.js$/.test(path);
  served.length = 0;
  for (const path of onDisk) {
    const res = await ask(path, only);
    const answers = wanted.includes(path) || plainFile(path);
    assert.equal(res.status, answers ? 200 : 404, path);
    if (!answers) continue;
    const policy = plainFile(path) ? PLAIN_POLICY : WORKER_POLICY;
    assert.equal(res.headers.get("content-security-policy"), policy, `the policy of ${path}`);
  }
  assert.deepEqual(served.sort(), [...wanted, ...onDisk.filter(plainFile)].sort(),
    "the asset server was asked for the plain wallet files and no other");
  // The Devnet files stay 404 in every spelling, and so do other spellings of a listed file.
  const poolOnly = ["worker.js", "main.js", "session.js", "view.js", "config.json",
    "zolana.bundle.js", "prover/prover.worker.js", "guard.js", "wasm/sol_wasm.d.ts"];
  const spelled = [];
  for (const file of poolOnly) {
    const first = "%" + file.charCodeAt(0).toString(16);
    spelled.push(`/sol/${file}`, `/sol/${first}${file.slice(1)}`, `/sol\\${file}`,
      `/sol//${file}`, `/SOL/${file}`, `/sol/${file[0].toUpperCase()}${file.slice(1)}`,
      `//sol/${file}`, `/sol/${file}/`, `/sol/./${file}`, `/sol/x/../${file}`);
  }
  for (const path of wanted) {
    spelled.push(path.toUpperCase(), path.replace("/sol/", "/sol//"), `${path}/`, `${path}%00`,
      path.replace("/sol/", "/sol%2f"), path.replace(/\.(js|wasm)$/, ".$1.map"));
  }
  served.length = 0;
  for (const path of spelled) {
    const res = await ask(path, only);
    assert.equal(res.status, 404, `${path} in plain-only mode`);
    await hasNoSecret(res, path);
  }
  assert.deepEqual(served, [], "no spelling reached the asset server");
  console.log("ok  with SOL off, the files of the plain wallet answer and no Devnet file does");

  // ── The private mainnet Worker (D14): /sol/worker-mainnet.js ──
  {
    const PATH = "/sol/worker-mainnet.js";
    const MAIN_POLICY = WORKER_POLICY.replace("devnet.helius", "mainnet.helius");
    assert.equal(WORKER_POLICY_MAINNET, MAIN_POLICY, "the page and the server agree on one text");
    assert.equal(wrangler.vars.SOL_POOL_MAINNET, "0", "the private mainnet wallet is off");
    assert.equal(wrangler.env.staging.vars.SOL_POOL_MAINNET, "1", "staging serves it, cap 0.5");
    const vars = [wrangler.vars, wrangler.env.staging.vars];
    for (const v of vars) {
      const flags = [undefined, "0", "", "true", " 1", "1 ", "on", 1, true, null];
      for (const SOL_POOL_MAINNET of flags) {
        served.length = 0;
        const env = { ...OPEN, ...v, DEV_NO_AUTH: "1", SOL: "1", SOL_POOL_MAINNET };
        const res = await ask(PATH, env);
        assert.equal(res.status, 404, `SOL_POOL_MAINNET=${String(SOL_POOL_MAINNET)}`);
        assert.deepEqual(served, [], "the asset server was not asked");
      }
      for (const SOL of [undefined, "0", "", "true", 1]) {
        for (const SOL_MAINNET of ["0", "1"]) {
          served.length = 0;
          const env = { ...OPEN, SOL, SOL_MAINNET, SOL_POOL_MAINNET: "1" };
          assert.equal((await ask(PATH, env)).status, 404, `SOL=${String(SOL)}`);
          assert.deepEqual(served, []);
        }
      }
    }
    const on = { ...OPEN, SOL: "1", SOL_POOL_MAINNET: "1" };
    for (const SOL_MAINNET of ["0", "1"]) {
      served.length = 0;
      const res = await ask(PATH, { ...on, SOL_MAINNET });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-security-policy"), MAIN_POLICY);
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(await res.text(), "asset body");
      assert.deepEqual(served, ["/sol/worker.js"], "the body is the file of /sol/worker.js");
    }
    assert.equal(await policyOf("/sol/worker.js", on), WORKER_POLICY, "Devnet keeps its policy");
    // Other spellings never get the mainnet policy (the real asset server has no such file).
    const other = ["/SOL/worker-mainnet.js", "/sol//worker-mainnet.js", "/sol/worker-mainnet.js/",
      "/sol/Worker-Mainnet.js", "/sol/worker-mainnet.JS", "/sol%2Fworker-mainnet.js",
      "/sol/worker%2Dmainnet.js", "/sol/worker-mainnet.js%00", "/sol/worker-mainnet.js.map",
      "/sol/plain/worker-mainnet.js"];
    for (const path of other) {
      assert.notEqual(await policyOf(path, on), MAIN_POLICY, path);
    }
    assert.equal(await policyOf(PATH, { ...on, DEV_NO_AUTH: undefined, APP_PASSWORD: PASSWORD }),
      null, "the password gate answers first");
    assert.equal(closure.has("sol/net.js"), false, "no plain file imports net.js");
    console.log("ok  /sol/worker-mainnet.js is 404 unless SOL and SOL_POOL_MAINNET are 1");
  }

  // Both off: nothing under /sol answers, the plain files too, and other paths still do.
  for (const SOL_MAINNET of [undefined, "0", "true", ""]) {
    served.length = 0;
    const off = { ...OPEN, SOL: "0", SOL_MAINNET };
    for (const path of ["/sol/plain/worker.js", "/sol/plain/guard.js", "/sol/worker.js", CONFIG]) {
      assert.equal((await ask(path, off)).status, 404, `${path} with SOL_MAINNET=${SOL_MAINNET}`);
    }
    assert.deepEqual(served, []);
    assert.equal((await ask("/app.js", off)).status, 200, "other paths still reach the assets");
  }
  console.log("ok  with both switches off, no /sol path answers");
}
console.log("gate: ok");
