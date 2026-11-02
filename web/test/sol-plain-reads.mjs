// The balance reads of the plain Solana wallet (web/sol/plain/control.js, reads.js, intent.js)
// against the real page modules and the real wasm (see sol-rig.mjs). Worker is a fake that runs
// checkCommand of guard.js on every message and answers from a table: the test cannot show that a
// browser loads the real module Worker under the policy header (a staging smoke test does). It
// shows: the Worker starts only after the policy check; init holds the cluster and the URL and
// nothing else; the URL stays out of storage, log, banner, state, store, console and error texts;
// every message has the schema of the plain Worker; the USDC address is the one that the wasm
// names; the pace of the reads (one job at a time, 30 s per wallet, also after a failure, no read
// in a hidden tab); a start that hangs ends, and a close ends a start that is in init.
// Run: node web/test/sol-plain-reads.mjs   (Node 26)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { agreement } from "../sol/ceremony.js";
import { COLLECTIONS, base58 } from "../sol/docs.js";
import { publishedFee } from "../sol/fee.js";
import { attach } from "../sol/plain/control.js";
import { GENESIS, PLAIN_WORKER_POLICY, base58Bytes, checkCommand } from "../sol/plain/guard.js";
import { readTexts } from "../sol/plain/view.js";
import { enableTokenIntent, plainPins } from "../sol/plain/intent.js";
import { DECIMALS, amountText, tokenAmount, usdcAddress } from "../sol/plain/reads.js";
import { config, loadRig, mainnetConfig, sleep, storage } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, W, data, waitFor } = rig;
const step = (name) => console.log("ok  " + name);
// The key of the fake Helius URL must be in no place that the page controls (assertNoKey below).
const KEY = mainnetConfig.rpcUrl.split("=").pop();
const printed = []; // every line that went to the console
for (const level of ["log", "info", "warn", "error", "debug"]) {
  const real = console[level].bind(console);
  console[level] = (...args) => {
    printed.push(args.map((arg) => inspect(arg, { depth: null })).join(" "));
    real(...args);
  };
}
const errors = []; // the error text that each read ended with
const path = (gid, rel) => `groups/${gid}/${rel}`;
const base = (gid) => "groups/" + gid;
const haveAll = (gid, name) => [1, 2, 3].every((i) => data.get(path(gid, `${name}/${i}`)));

// ── The pure parts: amount text, token account decode, independent ATA derivation ──
{
  const text = (units, decimals) => amountText(units, decimals);
  assert.equal(text(0n, DECIMALS.sol), "0");
  assert.equal(text(1n, DECIMALS.sol), "0.000000001", "1 lamport");
  assert.equal(text(1_500_000_000n, DECIMALS.sol), "1.5", "1.5 SOL");
  assert.equal(text(1_000_000_000n, DECIMALS.sol), "1", "1 SOL");
  assert.equal(text(1n, DECIMALS.usdc), "0.000001", "1 USDC unit");
  assert.equal(text(12_345_678n, DECIMALS.usdc), "12.345678", "12345678 USDC units");
  assert.equal(text("18446744073709551615", DECIMALS.sol), "18446744073.709551615", "u64 max");
  const label = W.sol_wallet_program_label("mainnet", "plain");
  assert.ok(label.endsWith("/" + DECIMALS.usdc), "USDC has the decimals of the wasm mint table");
  assert.equal(DECIMALS.sol, 9);

  const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const SYSTEM = "11111111111111111111111111111111";
  const data64 = (amount, { length = 165, state = 1 } = {}) => {
    const bytes = Buffer.alloc(length, 0xaa); // mint and owner fields are not the amount
    bytes.fill(0, 64, 72);
    bytes.writeBigUInt64LE(amount, 64);
    if (length > 108) bytes[108] = state;
    return bytes.toString("base64");
  };
  const account = (extra = {}) => ({
    owner: TOKEN, lamports: "2039280", executable: false, data: data64(12_345_678n), ...extra,
  });
  assert.equal(tokenAmount(account()), 12_345_678n, "a valid token account");
  assert.equal(tokenAmount(account({ data: data64(2n ** 53n + 1n) })), 9007199254740993n,
    "an amount above 2^53 stays exact");
  assert.equal(tokenAmount(account({ data: data64(2n ** 64n - 1n) })), 2n ** 64n - 1n, "u64 max");
  assert.equal(tokenAmount(account({ data: data64(0n) })), 0n, "an enabled account with no USDC");
  assert.equal(tokenAmount(null), null, "no account: not enabled");
  for (const system of [account({ owner: SYSTEM, data: "" }), account({ owner: SYSTEM })]) {
    assert.doesNotThrow(() => tokenAmount(system), "System-owned: no USDC");
    assert.equal(tokenAmount(system), null, "System-owned: no USDC");
  }
  const refused = (what, change) => assert.throws(() => tokenAmount(account(change)),
    /not an initialised token account/, what);
  const STAKE = "Stake11111111111111111111111111111111111111";
  refused("an owner that is no token program", { owner: STAKE });
  refused("the Token-2022 program", { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" });
  refused("data of 164 bytes", { data: data64(1n, { length: 164 }) });
  refused("data of 166 bytes", { data: data64(1n, { length: 166 }) });
  refused("an uninitialised account", { data: data64(1n, { state: 0 }) });
  refused("a frozen account", { data: data64(1n, { state: 2 }) });
  refused("data that is no base64", { data: "not base64!" });
  refused("no data", { data: "" });

  // The associated token account, derived again here from the mint of the label table.
  const P = 2n ** 255n - 19n;
  const power = (b, e) => {
    let out = 1n;
    for (b %= P; e > 0n; e >>= 1n, b = (b * b) % P) if (e & 1n) out = (out * b) % P;
    return out;
  };
  const D = (P - 121665n) * power(121666n, P - 2n) % P;
  const onCurve = (bytes) => {
    const y = BigInt("0x" + Buffer.from(bytes).reverse().toString("hex")) % (1n << 255n) % P;
    const y2 = (y * y) % P;
    const ratio = (((y2 - 1n + P) % P) * power(D * y2 + 1n, P - 2n)) % P;
    return ratio === 0n || power(ratio, (P - 1n) / 2n) === 1n;
  };
  const sha = (parts) => createHash("sha256").update(Buffer.concat(parts)).digest();
  const ATA_PROGRAM = Buffer.from(base58Bytes("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"));
  const mint = Buffer.from(base58Bytes(/USDC=([1-9A-HJ-NP-Za-km-z]+)\//.exec(label)[1]));
  const ataOf = (owner) => {
    const seeds = [Buffer.from(owner, "hex"), Buffer.from(base58Bytes(TOKEN)), mint];
    for (let bump = 255; bump >= 0; bump -= 1) {
      const tail = [Buffer.from([bump]), ATA_PROGRAM, Buffer.from("ProgramDerivedAddress")];
      const key = sha([...seeds, ...tail]);
      if (!onCurve(key)) return base58(key.toString("hex"));
    }
    throw new Error("no bump");
  };
  const wallet = { cluster: "mainnet" };
  for (let n = 0; n < 8; n += 1) {
    const group = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    assert.equal(usdcAddress({ W, wallet }, group), ataOf(group), "the wasm and the test agree");
  }
  // The payer takes no part in the address. The rows differ by role: the payer row is no ATA.
  const group = "11".repeat(32);
  const rows = (payer) => W.plain_reads(enableTokenIntent(0, "00".repeat(32)),
    plainPins(wallet, group, payer)).split("\n").map((row) => row.split("\t"));
  const [one, two] = [rows("22".repeat(32)), rows("33".repeat(32))];
  const source = (list) => list.find(([role]) => role === "source")[2];
  assert.equal(source(one), source(two), "another payer gives the same account");
  assert.equal(source(one), usdcAddress({ W, wallet }, group));
  assert.notEqual(one.find(([role]) => role === "payer")[2], source(one), "control: another row");
  assert.throws(() => usdcAddress({ W, wallet: { cluster: "nowhere" } }, group), /named no USDC/,
    "a wallet the wasm does not know gives no address");
}
step("amount text, token account decode and the USDC address");

// ── The fakes: fetch, Worker, storage, the clock ──
const requests = []; // every request for a file under /sol: { url, init }
let policy = PLAIN_WORKER_POLICY;
let policyStatus = 200;
let hang = null; // the path of a request that gets no answer
const pageFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("/sol/")) requests.push({ url: String(url), init });
  if (String(url) === hang) return new Promise(() => {});
  if (String(url) !== "/sol/plain/worker.js") return pageFetch(url, init);
  const headers = policy === null ? {} : { "content-security-policy": policy };
  return new Response("// the plain Worker\n", { status: policyStatus, headers });
};
const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => session.get(k) ?? null,
  setItem: (k, v) => void session.set(k, String(v)),
  removeItem: (k) => void session.delete(k),
};
const sent = []; // every message that a Worker got: { cmd, args }
const made = []; // every Worker that the page started
const chain = { lamports: new Map(), accounts: new Map() };
let hold = null; // a promise that the answers of `balance` wait for
let holdInit = null; // a promise that the answer of `init` waits for
const balanceAnswer = async ({ address }) => {
  await hold;
  return { lamports: chain.lamports.get(address) ?? "0" };
};
const initAnswer = async ({ cluster }) => {
  await holdInit;
  return { cluster, genesis: GENESIS[cluster] };
};
const answers = {
  init: initAnswer,
  balance: balanceAnswer,
  accounts: ({ addresses }) => ({ accounts: addresses.map((a) => chain.accounts.get(a) ?? null) }),
};
globalThis.Worker = class {
  constructor(url, options) {
    Object.assign(this, { url, options, closed: false });
    made.push(this);
  }
  postMessage({ id, cmd, args }) {
    sent.push({ cmd, args });
    const reply = (message) => {
      if (!this.closed) this.onmessage({ data: { id, ...message } });
    };
    Promise.resolve()
      .then(() => {
        checkCommand(cmd, args);
        return answers[cmd](args);
      })
      .then((result) => reply({ ok: true, result }), (e) => reply({ ok: false, error: e.message }));
  }
  terminate() {
    this.closed = true;
  }
};
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
const later = (ms) => void (skew += ms);
const calls = (cmd) => sent.filter((m) => m.cmd === cmd).length;
const text = (units, decimals) => amountText(units, decimals);
const texts = () => readTexts(c);
const reset = () => {
  requests.length = 0;
  sent.length = 0;
  mainnetConfig.calls = 0;
  mainnetConfig.inits.length = 0;
  config.calls = 0;
};
const passes = async (n) => {
  for (let k = 0; k < n; k++) {
    plain.react();
    plain.observe(gid);
    await sleep(20);
  }
};
// A read ends with a new balance (`at`) or with an error. `before` is the state to leave.
const readDone = async (record, before) => {
  await waitFor("the read", () => record.at !== before.at || record.error !== before.error);
  errors.push(record.error);
};
const snapshot = () => ({ at: c.balances.at, error: c.balances.error });
// ── A mainnet wallet whose seats agree (the plain ceremony ends) ──
const gid = await rig.wallet({ name: "Reads", network: "mainnet", n: 3, k: 2 });
const refiltered = []; // the time of each call of host.refilter by the controller
const plain = await attach({ ...t.solHost(), refilter: () => {
  refiltered.push(Date.now());
  t.refilter();
} });
const c = plain.ctl;
// The strings under `root` (keys of objects and maps too) that hold the key. Bytes are skipped.
const entriesOf = (v) => {
  if (v instanceof Map) return [...v];
  if (v instanceof Set) return [...v].map((member) => ["<member>", member]);
  return Object.entries(v);
};
function keyPaths(root, name) {
  const found = [];
  const seen = new WeakSet();
  const visit = (v, path) => {
    if (typeof v === "string") return void (v.includes(KEY) && found.push(path));
    if (typeof v !== "object" || v === null || ArrayBuffer.isView(v) || seen.has(v)) return;
    seen.add(v);
    for (const [k, x] of entriesOf(v)) {
      visit(k, path + ".<key>");
      visit(x, path + "." + String(k));
    }
  };
  visit(root, name);
  return found;
}
// The host and the wasm are the page's, not the state of the controller.
const ownState = () =>
  Object.fromEntries(Object.entries(c).filter(([k]) => k !== "host" && k !== "W"));
function assertNoKey(when) {
  const places = {
    controller: ownState(), state: t.state, banner: t.banner, storage, session, store: data,
  };
  const found = [
    ...Object.entries(places).flatMap(([name, root]) => keyPaths(root, name)),
    ...printed.filter((line) => line.includes(KEY)).map((line) => "the console: " + line),
    ...errors.filter((text) => text.includes(KEY)).map((text) => "an error text: " + text),
  ];
  assert.equal(found.length, 0, `the key is in ${found.join("; ")} (${when})`);
}
const pump = async (what, ok, ms = 60000) => {
  for (const t0 = Date.now(); !ok();) {
    if (Date.now() - t0 > ms) throw new Error("timeout: " + what);
    plain.react();
    await sleep(50);
  }
};
const opened = async (id) => {
  plain.open(id, base(id));
  assert.equal(c.gid, id, "the plain controller opened the wallet");
  await waitFor("the documents", () => COLLECTIONS.every((name) => c.loaded[name]));
};
await opened(gid);
await plain.add();
await pump("the plain ceremony", () => haveAll(gid, "soldone") && haveAll(gid, "solfee"));
await pump("the fee keys", () => [1, 2, 3].every((i) => publishedFee(c, i)));
await pump("agreement", () => agreement(c).state === "agree");
const groupKey = agreement(c).done.groupKey;
const groupAddress = base58(groupKey);
const feeAddresses = [1, 2, 3].map((i) => base58(publishedFee(c, i)));
const ata = usdcAddress(c, groupKey);

chain.lamports.set(groupAddress, "1500000000");
chain.lamports.set(feeAddresses[0], "5000000");
chain.lamports.set(feeAddresses[2], "123456789");
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_DATA = Buffer.alloc(165);
TOKEN_DATA.writeBigUInt64LE(12_345_678n, 64);
TOKEN_DATA[108] = 1;
chain.accounts.set(ata, { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", lamports: "2039280",
  executable: false, data: TOKEN_DATA.toString("base64") });

// ── Nothing happens until a screen shows the wallet ──
// The page itself asked the server once (the probe). The controller asked for nothing, not even
// while its ceremony ended and its seats agreed.
const asked = () => requests.filter((r) => r.url === "/sol/plain/worker.js").length;
for (let k = 0; k < 10; k++) {
  plain.react();
  await sleep(20);
}
assert.deepEqual([asked(), made.length, sent.length], [0, 0, 0],
  "a controller that nobody observes asks for nothing");
plain.observe("not-this-wallet");
await sleep(50);
assert.equal(asked(), 0, "observe of another wallet does nothing");
reset();
mainnetConfig.status = 200;
step("a controller that nobody observes makes no request");

// ── The Worker starts only after the policy of the server is the expected one ──
{
  const cases = [
    ["another policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'", 200],
    ["a policy with a host more", PLAIN_WORKER_POLICY + " https://example.com", 200],
    ["no policy header", null, 200],
    ["a missing file with the right policy", PLAIN_WORKER_POLICY, 404],
  ];
  for (const [what, header, status] of cases) {
    [policy, policyStatus] = [header, status];
    const before = snapshot();
    plain.observe(gid);
    await readDone(c.balances, before);
    assert.equal(made.length, 0, "no Worker starts on " + what);
    assert.equal(sent.length, 0, "no message goes out on " + what);
    assert.equal(mainnetConfig.calls, 0, "the secret URL is not even asked on " + what);
    assert.match(c.balances.error, /did not send the policy of the Solana worker/, what);
    c.balances.error = "";
    later(31_000);
  }
  [policy, policyStatus] = [PLAIN_WORKER_POLICY, 200];
  assert.equal(c.balances.at, null, "no read ended");
}
step("the Worker does not start unless the policy header is the expected text");

// ── The config route: its failures stop the start, and nothing is stored ──
{
  const failures = [[404, /not available/], [503, /not available/], [500, /did not load/]];
  for (const [status, words] of failures) {
    mainnetConfig.status = status;
    const before = snapshot();
    plain.observe(gid);
    await readDone(c.balances, before);
    assert.match(c.balances.error, words, "status " + status);
    assert.equal(made.length, 0, "no Worker starts on status " + status);
    c.balances.error = "";
    later(31_000);
  }
  mainnetConfig.status = 200;
  const url = mainnetConfig.rpcUrl;
  mainnetConfig.rpcUrl = 12345;
  const before = snapshot();
  plain.observe(gid);
  await readDone(c.balances, before);
  assert.match(c.balances.error, /did not load/, "a body with no URL text");
  assert.equal(made.length, 0);
  mainnetConfig.rpcUrl = url;
  later(31_000);
}
step("a config answer that is no URL starts no Worker");

// ── The first read: init, the schema of every message, the addresses, the amounts ──
reset();
{
  const before = snapshot();
  plain.observe(gid);
  await readDone(c.balances, before);
  assert.equal(c.balances.error, "", "the read worked: " + c.balances.error);
  assert.equal(made.length, 1, "one Worker");
  assert.equal(made[0].url, "/sol/plain/worker.js", "it is the plain Worker");
  assert.deepEqual(made[0].options, { type: "module" });
  const init = { cluster: "mainnet", rpcUrl: mainnetConfig.rpcUrl };
  assert.deepEqual(sent[0], { cmd: "init", args: init },
    "init holds the cluster and the URL and nothing else");
  assert.equal(calls("init"), 1);
  for (const { cmd, args } of sent) assert.doesNotThrow(() => checkCommand(cmd, args), cmd);
  assert.deepEqual(requests.map((r) => r.url), ["/sol/plain/worker.js", "/sol/config-mainnet.json"],
    "the policy check, then the mainnet config, and no other file");
  assert.deepEqual(requests[1].init, { cache: "no-store" }, "the config is not cached");
  assert.equal(config.calls, 0, "the pool config was not asked");
  const balances = sent.filter((m) => m.cmd === "balance").map((m) => m.args);
  assert.ok(balances.every((a) => Object.keys(a).join() === "address"), "balance holds an address");
  assert.deepEqual(balances.map((a) => a.address).sort(), [groupAddress, ...feeAddresses].sort(),
    "the group and the three published fee addresses");
  const accounts = sent.filter((m) => m.cmd === "accounts").map((m) => m.args);
  assert.deepEqual(accounts[0], { addresses: [ata] }, "the USDC account that the wasm names");
  assert.equal(accounts.length, 2, "and one read of the nonce accounts of the paying device");
  assert.equal(new Set(accounts[1].addresses).size, 100, "the first 100 addresses, all different");
  assert.equal(sent.length, 1 + 1 + 1 + 1 + 3,
    "init, group, USDC account, nonce accounts and three fee addresses");
  assert.deepEqual(c.balances.nonces, { seat: 1, have: 0, ks: [] }, "no nonce account on chain");
  const b = c.balances;
  assert.equal(text(b.sol, DECIMALS.sol), "1.5", "the SOL of the group");
  assert.equal(text(b.usdc, DECIMALS.usdc), "12.345678", "the USDC of the group");
  assert.deepEqual(Object.keys(b.fees).sort(), ["1", "2", "3"]);
  assert.deepEqual([b.fees[1], b.fees[2], b.fees[3]], [5000000n, 0n, 123456789n], "the fee SOL");
  assert.equal(typeof b.at, "number");
}
step("the first read starts the plain Worker and reads the group and the fee addresses");

// ── The URL stays out of storage, log, banner, state, store, console and error texts ──
{
  assertNoKey("after the first read");
  assert.deepEqual(Object.keys(c.worker).sort(), ["call", "close"], "the handle has no URL");
}
step("the Helius URL is in no storage, state, store, log, banner, console or balance");

// ── The pace: one read in 30 s, no read in a hidden tab, one job at a time ──
{
  const count = () => calls("balance");
  await passes(10);
  assert.equal(count(), 4, "no second read inside the gap, however often the page asks");
  later(29_000);
  await passes(5);
  assert.equal(count(), 4, "29 s is inside the gap");
  const document = globalThis.document;
  globalThis.document = new Proxy(document, {
    get: (target, key) => (key === "visibilityState" ? "hidden" : target[key]),
  });
  later(60_000);
  await passes(5);
  assert.equal(count(), 4, "a hidden tab reads nothing");
  globalThis.document = document;
  const before = snapshot();
  await passes(1);
  await readDone(c.balances, before);
  assert.equal(count(), 8, "the visible tab reads again after the gap");
  assert.equal(calls("init"), 1, "and keeps its Worker");
  assert.equal(made.length, 1);

  // A job that runs blocks the next one, also past the gap.
  let release;
  hold = new Promise((done) => void (release = done));
  later(31_000);
  plain.observe(gid);
  await waitFor("the held read", () => calls("balance") === 12);
  later(60_000);
  await passes(10);
  assert.equal(calls("balance"), 12, "one read job at a time");
  hold = null;
  const waiting = snapshot();
  release();
  await readDone(c.balances, waiting);
  assert.equal(c.balances.error, "", "the held read ended");
}
step("a wallet is read once in 30 s, never in a hidden tab, and one job at a time");

// ── A failed read keeps the old balance, shows the error and waits 30 s ──
{
  later(31_000);
  const old = { ...c.balances };
  answers.balance = () => {
    throw new Error("Error: balance: Helius is not answering.");
  };
  const before = snapshot();
  plain.observe(gid);
  await readDone(c.balances, before);
  assert.match(c.balances.error, /Helius is not answering/, "the error shows");
  assert.equal(c.balances.sol, old.sol, "the old SOL stays");
  assert.equal(c.balances.usdc, old.usdc, "the old USDC stays");
  assert.deepEqual(c.balances.fees, old.fees, "the old fee balances stay");
  assert.equal(c.balances.at, old.at, "and so does the time of the last good read");
  const failed = calls("balance");
  await passes(10);
  later(29_000);
  await passes(5);
  assert.equal(calls("balance"), failed, "no retry inside 30 s of the failure");
  answers.balance = balanceAnswer;
  later(2_000);
  const failing = snapshot();
  await passes(1);
  await readDone(c.balances, failing);
  assert.equal(c.balances.error, "", "the next read after the gap works and clears the error");
  assert.notEqual(c.balances.at, old.at);

  // A failure that comes late waits 30 s from its end, not from the start of the read.
  later(31_000);
  let fail;
  hold = new Promise((_, reject) => void (fail = reject));
  const slow = [calls("balance"), snapshot()];
  plain.observe(gid);
  await waitFor("the held read", () => calls("balance") === slow[0] + 4);
  later(25_000);
  hold = null;
  fail(new Error("balance: Helius is not answering."));
  await readDone(c.balances, slow[1]);
  assert.match(c.balances.error, /not answering/, "the late failure shows");
  later(10_000);
  await passes(5);
  assert.equal(calls("balance"), slow[0] + 4, "a late failure waits 30 s from its end");
  later(21_000);
  const ending = snapshot();
  await passes(1);
  await readDone(c.balances, ending);
  assert.equal(c.balances.error, "", "and the read after that works");
}
step("a failed read keeps the old balance and waits 30 s");

// ── A timer wakes the reactor when the gap ends, also after a good read ──
{
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms <= 29_000 || ms > 30_300) return realSetTimeout(fn, ms, ...rest);
    timers.push({ fn, ms });
    return 0;
  };
  try {
    later(31_000);
    const before = snapshot();
    plain.observe(gid);
    await readDone(c.balances, before);
    assert.equal(c.balances.error, "", "a good read");
    assert.equal(timers.length, 1, "a good read sets one timer for the end of its gap");
    const woke = refiltered.length;
    later(30_200);
    timers[0].fn();
    assert.equal(refiltered.length, woke + 1, "the timer asks the page for a pass");
    const reads = calls("balance");
    const next = snapshot();
    plain.react();
    await readDone(c.balances, next);
    assert.ok(calls("balance") > reads, "that pass reads again, after a good read");
    // A failed read sets its timer too.
    later(31_000);
    answers.balance = () => {
      throw new Error("Error: balance: Helius is not answering.");
    };
    const failing = snapshot();
    plain.observe(gid);
    await readDone(c.balances, failing);
    assert.equal(timers.length, 3, "a failed read sets a timer for the end of its gap");
    assert.ok(timers.every(({ ms }) => ms > 29_000 && ms <= 30_300), "of about 30 s");
    answers.balance = balanceAnswer;
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  // The pool asks for a pass when the tab shows again; so does the plain wallet.
  const listeners = [];
  const real = globalThis.document;
  globalThis.document = new Proxy(real, { get: (target, key) => key === "addEventListener"
    ? (type, fn) => listeners.push([type, fn]) : target[key] });
  let asked = 0;
  await attach({ ...t.solHost(), refilter: () => void asked++ });
  globalThis.document = real;
  assert.deepEqual(listeners.map(([type]) => type), ["visibilitychange"],
    "the controller listens for visibilitychange");
  listeners[0][1]();
  assert.equal(asked, 1, "a tab that shows again asks for a pass");
}
step("a timer wakes a shown wallet after every read, and a tab that shows again asks for a pass");

// ── Amounts above 2^53 stay exact; a System-owned USDC address means not enabled ──
{
  later(31_000);
  chain.lamports.set(groupAddress, "18446744073709551615");
  chain.accounts.set(ata, { owner: "11111111111111111111111111111111", lamports: "650240",
    executable: false, data: "" });
  const before = snapshot();
  plain.observe(gid);
  await readDone(c.balances, before);
  assert.equal(c.balances.sol, 18446744073709551615n, "the SOL is exact");
  assert.equal(c.balances.usdc, null, "a System-owned account at the address: not enabled");
  later(31_000);
  chain.accounts.delete(ata);
  const next = snapshot();
  plain.observe(gid);
  await readDone(c.balances, next);
  assert.equal(c.balances.usdc, null, "no account: not enabled");
}
step("amounts stay exact and a System-owned USDC address means not enabled");

// ── A bad USDC account is an error of the USDC row and hides no other balance ──
{
  const frozen = Buffer.from(TOKEN_DATA);
  frozen[108] = 2;
  const stake = { owner: "Stake11111111111111111111111111111111111111", lamports: "1",
    executable: false, data: TOKEN_DATA.toString("base64") };
  for (const [what, account] of [["an odd owner", stake],
    ["a frozen account", { ...stake, owner: TOKEN, data: frozen.toString("base64") }]]) {
    later(31_000);
    chain.lamports.set(groupAddress, "7");
    chain.lamports.set(feeAddresses[0], "9");
    chain.accounts.set(ata, account);
    const odd = snapshot();
    plain.observe(gid);
    await readDone(c.balances, odd);
    assert.equal(c.balances.error, "", what + " fails no read");
    assert.match(c.balances.usdcError, /not an initialised token account/, what + " is a USDC err");
    assert.equal(c.balances.usdc, null, what + " gives no USDC amount");
    assert.equal(c.balances.sol, 7n, "the SOL is read with " + what);
    assert.equal(c.balances.fees[1], 9n, "and so is a fee balance");
    assert.equal(texts().rows.sol.text, "0.000000007 SOL", "the SOL row shows its amount");
    assert.deepEqual(texts().rows.usdc,
      { state: "bad", text: c.balances.usdcError }, "the USDC row shows the error");
  }
  later(31_000);
  chain.lamports.set(feeAddresses[0], "5000000");
  chain.accounts.set(ata, { owner: TOKEN, lamports: "2039280", executable: false,
    data: TOKEN_DATA.toString("base64") });
  const good = snapshot();
  plain.observe(gid);
  await readDone(c.balances, good);
  assert.equal(c.balances.usdcError, "", "a good account clears the USDC error");
  assert.equal(texts().rows.usdc.text, "12.345678 USDC");
  chain.lamports.set(groupAddress, "18446744073709551615");
}
step("a bad USDC account shows on its row and hides no other balance");

// ── A Worker of another cluster is not used ──
{
  plain.close();
  assert.ok(made.every((w) => w.closed), "closing the controller closed its Worker");
  later(31_000);
  chain.accounts.delete(ata);
  answers.init = () => ({ cluster: "devnet", genesis: GENESIS.devnet });
  await opened(gid);
  const mark = [made.length, calls("balance")];
  const before = snapshot();
  plain.observe(gid);
  await readDone(c.balances, before);
  assert.match(c.balances.error, /another cluster/, "the controller stops with a text");
  assert.equal(made.length, mark[0] + 1, "a Worker started");
  assert.ok(made.at(-1).closed, "and it was closed");
  assert.equal(calls("balance"), mark[1], "no read went to it");
  answers.init = initAnswer;
}
step("a Worker that answers for another cluster is closed and not used");

// ── A wallet switch closes the Worker; the gap of a wallet outlives the switch ──
{
  later(31_000);
  const before = snapshot();
  plain.observe(gid);
  await readDone(c.balances, before);
  assert.equal(c.balances.error, "");
  const good = made.at(-1);
  const record = c.balances;
  const other = await rig.wallet({ name: "Other", network: "mainnet", n: 3, k: 2 });
  await waitFor("the other wallet", () => t.state.gid === other && t.state.g);
  await opened(other);
  assert.ok(good.closed, "a wallet switch closes the Worker");
  assert.notEqual(c.balances, record, "the other wallet has its own record");
  plain.observe(other);
  await sleep(50);
  assert.equal(made.at(-1), good, "a wallet without agreeing seats starts no Worker");
  t.openGroup(gid);
  await waitFor("the first wallet", () => t.state.gid === gid && t.state.g);
  await opened(gid);
  assert.equal(c.balances, record, "the wallet gets its record and its balances back");
  assert.equal(c.balances.sol, 18446744073709551615n);
  const mark = [made.length, calls("balance")];
  await passes(10);
  assert.deepEqual([made.length, calls("balance")], mark, "switching back does not skip the gap");
  later(31_000);
  const again = snapshot();
  await passes(1);
  await readDone(c.balances, again);
  assert.equal(made.length, mark[0] + 1, "the next read starts a new Worker");
  assert.deepEqual(made.at(-1).options, { type: "module" });
}
step("a wallet switch closes the Worker and the gap of the wallet stays");

// ── A close during a read ends the job and frees the read key ──
{
  later(31_000);
  let release;
  hold = new Promise((done) => void (release = done));
  const mark = calls("balance");
  plain.observe(gid);
  await waitFor("the held read", () => calls("balance") > mark);
  const running = made.at(-1);
  plain.close();
  assert.ok(running.closed, "the close stopped the Worker of the running read");
  release();
  hold = null;
  await sleep(100);
  await opened(gid);
  later(31_000);
  const before = snapshot();
  plain.observe(gid);
  await readDone(c.balances, before);
  assert.equal(c.balances.error, "", "a later read works: the job of the closed wallet ended");
}
step("a close during a read ends the job and frees the read key");

// ── A close during init closes the Worker that starts and frees the read key ──
{
  plain.close();
  await opened(gid);
  later(31_000);
  let release;
  holdInit = new Promise((done) => void (release = done));
  const mark = [made.length, calls("init")];
  plain.observe(gid);
  await waitFor("the held init", () => calls("init") > mark[1]);
  const starting = made.at(-1);
  assert.equal(made.length, mark[0] + 1, "one Worker is in init");
  plain.close();
  assert.ok(starting.closed, "the close stopped the Worker that was still in init");
  await opened(gid);
  release();
  holdInit = null;
  await sleep(100);
  assert.equal(c.balances.error, "", "a start cut by the close leaves no error");
  later(31_000);
  const before = snapshot();
  plain.observe(gid);
  await readDone(c.balances, before);
  assert.equal(c.balances.error, "", "a later read works: the job of the closed wallet ended");
  assert.equal(made.length, mark[0] + 2, "the later read started its own Worker");
  assert.ok(starting.closed, "the old Worker stays closed");
  assert.ok(!made.at(-1).closed, "and the new one is open");
}
step("a close during init closes the Worker and frees the read key");

// ── A step of the start that hangs ends after 20 s (START_MS of control.js) ──
// The limit runs on the real timer, so the test shortens that one delay.
{
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms === 20_000 ? 30 : ms, ...rest);
  try {
    const steps = [
      ["the policy check", () => (hang = "/sol/plain/worker.js")],
      ["the config request", () => (hang = "/sol/config-mainnet.json")],
      ["init", () => (holdInit = new Promise(() => {}))],
    ];
    for (const [what, start] of steps) {
      plain.close();
      await opened(gid);
      later(31_000);
      const [mark, before] = [made.length, snapshot()];
      start();
      plain.observe(gid);
      await readDone(c.balances, before);
      [hang, holdInit] = [null, null];
      assert.match(c.balances.error, /did not start in time/, "a hung " + what + " ends");
      assert.ok(made.slice(mark).every((w) => w.closed), "no Worker stays open after " + what);
      later(31_000);
      const next = snapshot();
      plain.observe(gid);
      await readDone(c.balances, next);
      assert.equal(c.balances.error, "", "the read after a hung " + what + " works");
    }
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}
step("a step of the start that hangs ends, and the next read works");

// ── A seat that published no fee key is not read ──
{
  later(31_000);
  const saved = c.raw.solfee[2];
  delete c.raw.solfee[2];
  const [mark, before] = [calls("balance"), snapshot()];
  plain.observe(gid);
  await readDone(c.balances, before);
  assert.equal(c.balances.error, "", "a seat with no fee key does not fail the read");
  assert.equal(calls("balance") - mark, 3, "the group and the two published fee addresses");
  assert.deepEqual(Object.keys(c.balances.fees).sort(), ["1", "3"], "no fee balance for seat 2");
  assert.deepEqual([c.balances.fees[1], c.balances.fees[3]], [5000000n, 123456789n]);
  c.raw.solfee[2] = saved;
}
step("a seat without a published fee key is left out of the read");

assertNoKey("at the end");
step("the Helius URL is in no place at the end of the run");

console.log("sol-plain-reads: ok");
process.exit(0);
