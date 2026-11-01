// The plain Solana Worker (web/sol/plain/worker.js and guard.js): every command against a fake
// JSON-RPC server, the host pin of each cluster, the genesis check, the send gate, the refusals of
// the guard, the API key that stays out of every answer, and the pace of the calls. The real
// Worker and guard run in Node. Only fetch is a fake, and so is the clock of the 30 s gate, which
// the test moves forward.
// Run: node web/test/plain-worker.mjs   (Node 26)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { GENESIS, checkCommand } from "../sol/plain/guard.js";

const WEB_SOL = new URL("../sol/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("/sol/")) return next(specifier, context);
    return { url: new URL(specifier.slice(5), WEB_SOL).href, shortCircuit: true };
  },
});
const step = (name) => console.log(`ok  ${name}`);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes) {
  let n = BigInt(`0x0${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  const zeros = bytes.findIndex((b) => b !== 0);
  return "1".repeat(zeros < 0 ? bytes.length : zeros) + out;
}

const KEY = "zk-test-key-0123456789";
const MAIN_URL = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;
const DEV_URL = `https://devnet.helius-rpc.com/?api-key=${KEY}`;
const ME = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM = "11111111111111111111111111111111";
const SIG =
  "58wiP4jDXuK8WwEKgm5qgrMfS6yU4qV7ofbPD3pqmVANcRARBW9deLu6LGEHerJ31DutVLKgZEbKdNjWFCsrpUbe";
const SIG2 = b58(Buffer.alloc(64, 5));
const txOf = (n = 200) => randomBytes(n).toString("base64");

// ── The fake network and the clock ──
const realNow = performance.now.bind(performance);
let skew = 0;
performance.now = () => realNow() + skew;
// Each command moves the clock past the pause of the pace, so the test does not wait for it. The
// block of the pace turns this off.
let quick = true;

const calls = []; // every fetch: { at, url, init, body }
const results = {};
const answer = (id, result) => Response.json({ jsonrpc: "2.0", id, result });
const resetResults = () => {
  for (const name of Object.keys(results)) delete results[name];
  Object.assign(results, {
    getGenesisHash: () => GENESIS.mainnet,
    getLatestBlockhash: () => ({ context: { slot: 9 },
      value: { blockhash: ME, lastValidBlockHeight: 464000100 } }),
    getMultipleAccounts: () => ({ context: { slot: 9 }, value: [{
      data: ["AwAAAA==", "base64"], executable: false, lamports: 759682820, owner: SYSTEM,
      space: 4 }, null] }),
    getBalance: () => ({ context: { slot: 9 }, value: 650240 }),
    getTokenAccountsByOwner: () => ({ context: { slot: 9 }, value: [{ pubkey: SIG2.slice(0, 44),
      account: { data: ["AQID", "base64"], executable: false, lamports: 2500000, owner: TOKEN,
        space: 165 } }] }),
    getMinimumBalanceForRentExemption: () => 650240,
    getSignaturesForAddress: () => [{ blockTime: 1793330980, confirmationStatus: "finalized",
      err: null, memo: null, signature: SIG, slot: 463133762 },
    { blockTime: 1793330000, confirmationStatus: "finalized", err: { InstructionError: [0, "x"] },
      memo: null, signature: SIG2, slot: 463133000 }],
    simulateTransaction: () => ({ context: { slot: 9 }, value: { err: null,
      logs: ["Program log: ok"], unitsConsumed: 150, loadedAccountsDataSize: 214493 } }),
    sendTransaction: () => SIG,
    getSignatureStatuses: () => ({ context: { slot: 9 }, value: [{ slot: 5, err: null,
      confirmationStatus: "finalized", confirmations: null }] }),
  });
};
resetResults();
let network = (body) => {
  const make = results[body.method];
  if (!make) throw new Error(`the test has no answer for ${body.method}`);
  return answer(body.id, make(body.params));
};
const defaultNetwork = network;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ at: realNow(), url: String(url), init, body });
  return network(body, init);
};

// ── Fresh copies of the Worker: each module copy is one Worker with its own state ──
const messages = []; // every message that a Worker posted: the key must be in none of them
const copies = [];
async function load() {
  const w = { waiting: new Map(), ids: 0 };
  w.self = {
    postMessage(m) {
      messages.push(m);
      w.waiting.get(m.id)?.(m);
    },
  };
  globalThis.self = w.self;
  await import(new URL(`plain/worker.js?copy=${copies.push(0)}`, WEB_SOL).href);
  w.ask = (cmd, args) => {
    const id = ++w.ids;
    if (quick) skew += 200;
    const reply = new Promise((ok) => w.waiting.set(id, ok));
    w.self.onmessage({ data: { id, cmd, args } });
    return reply;
  };
  return w;
}
async function ready(cluster = "mainnet", url = MAIN_URL) {
  const w = await load();
  const reply = await w.ask("init", { cluster, rpcUrl: url });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  calls.length = 0;
  return w;
}
async function ok(w, cmd, args = {}) {
  const reply = await w.ask(cmd, args);
  assert.equal(reply.ok, true, `${cmd}: ${JSON.stringify(reply)}`);
  return reply.result;
}
async function refused(w, cmd, args, pattern) {
  const before = calls.length;
  const reply = await w.ask(cmd, args);
  assert.equal(reply.ok, false, `${cmd} ${JSON.stringify(args)} was accepted`);
  assert.match(reply.error, pattern, `${cmd}: ${reply.error}`);
  assert.equal(calls.length, before, `${cmd} made a call before it was refused`);
  return reply.error;
}
function lastCall(method, params) {
  const { body } = calls.at(-1);
  assert.deepEqual([body.jsonrpc, body.method, body.params], ["2.0", method, params]);
  assert.equal(typeof body.id, "number");
}

// ── The guard: addresses, signatures, transactions, numbers, fields ──
{
  const key = (n, lead = 0) => b58(Buffer.concat([Buffer.alloc(lead), Buffer.alloc(n, 1)]));
  const sig = (n, lead = 0) => b58(Buffer.concat([Buffer.alloc(lead), Buffer.alloc(n, 9)]));
  const k32 = key(32), k31 = key(31), k33 = key(32, 1);
  const shaped = (text) => text.length >= 32 && text.length <= 90;
  for (const text of [k31, k33, sig(63), sig(64, 1)]) assert.ok(shaped(text), "the shape passes");
  assert.doesNotThrow(() => checkCommand("balance", { address: k32 }));
  const big = (n) => randomBytes(n).toString("base64");
  const bad = [
    ["balance", { address: k31 }, "a 31 byte key"],
    ["balance", { address: k33 }, "a 33 byte key"],
    ["balance", { address: ME.replace("5", "0") }, "a 0 in base58"],
    ["balance", { address: ME.replace("t", "l") }, "an l in base58"],
    ["balance", { address: ME.slice(0, 20) }, "a short text"],
    ["balance", { address: 5 }, "a number"],
    ["balance", {}, "no address"],
    ["balance", { address: ME, extra: 1 }, "an extra field"],
    ["transaction", { signature: sig(63) }, "a 63 byte signature"],
    ["transaction", { signature: sig(64, 1) }, "a 65 byte signature"],
    ["transaction", { signature: ME }, "a key as signature"],
    ["simulate", { tx: big(4097) }, "a transaction of 4097 bytes"],
    ["simulate", { tx: "" }, "an empty transaction"],
    ["simulate", { tx: "AB==" }, "base64 with a stray bit"],
    ["simulate", { tx: "AAA" }, "base64 without padding"],
    ["simulate", { tx: "AA-_" }, "url-safe base64"],
    ["send", { tx: "AAAA\n" }, "base64 with a newline"],
    ["send", { tx: Buffer.alloc(8) }, "bytes instead of text"],
    ["rent", { space: 10 * 1024 * 1024 + 1 }, "a space over 10 MiB"],
    ["rent", { space: -1 }, "a negative space"],
    ["rent", { space: 1.5 }, "a fraction"],
    ["rent", { space: "5" }, "a text number"],
    ["rent", { space: 2 ** 53 }, "an unsafe integer"],
    ["history", { address: ME, limit: 101 }, "limit 101"],
    ["history", { address: ME, limit: 0 }, "limit 0"],
    ["history", { address: ME }, "no limit"],
    ["history", { address: ME, limit: 5, before: ME }, "a key as before"],
    ["accounts", { addresses: [] }, "no addresses"],
    ["accounts", { addresses: Array(101).fill(ME) }, "101 addresses"],
    ["accounts", { addresses: [ME, k31] }, "one bad address"],
    ["status", { signatures: Array(101).fill(SIG) }, "101 signatures"],
    ["init", { cluster: "testnet", rpcUrl: MAIN_URL }, "another cluster"],
    ["init", { cluster: "__proto__", rpcUrl: MAIN_URL }, "a property name as cluster"],
    ["constructor", {}, "a property name as command"],
    ["airdrop", {}, "an unknown command"],
    ["balance", [ME], "an array as arguments"],
  ];
  for (const [cmd, args, what] of bad) assert.throws(() => checkCommand(cmd, args), Error, what);
  const good = [
    ["accounts", { addresses: Array(100).fill(ME) }], ["history", { address: ME, limit: 100 }],
    ["history", { address: ME, limit: 1, before: SIG }], ["simulate", { tx: big(4096) }],
    ["simulate", { tx: big(1) }], ["rent", { space: 10 * 1024 * 1024 }], ["rent", { space: 0 }],
    ["status", { signatures: Array(100).fill(SIG) }], ["genesis", {}], ["blockhash", {}],
  ];
  for (const [cmd, args] of good) assert.doesNotThrow(() => checkCommand(cmd, args), cmd);
  assert.throws(() => checkCommand("balance", { address: ME, ["x".repeat(100)]: 1 }),
    (e) => e.message.length < 80, "a long field name is cut");
  assert.throws(() => checkCommand("balance", { address: `secret-${KEY}` }),
    (e) => !e.message.includes(KEY), "a refusal never holds a value");
  step("the guard refuses a bad key, signature, transaction, number, field or command");
}

// ── The Worker refuses a bad command before any call ──
{
  const w = await ready();
  await refused(w, "balance", { address: ME, extra: 1 }, /field "extra" is not allowed/);
  await refused(w, "balance", { address: ME.slice(0, 20) }, /field address is missing or mal/);
  await refused(w, "airdrop", {}, /unknown command/);
  await refused(w, "simulate", { tx: txOf(4097) }, /field tx is missing or malformed/);
  await refused(w, "history", { address: ME, limit: 101 }, /field limit/);
  await refused(w, "balance", [ME], /arguments must be an object/);
  const none = await w.ask("balance", undefined);
  assert.match(none.error, /field address is missing/, "no arguments at all");
  step("the Worker refuses every bad command before it fetches");
}

// ── Every command, against the fake JSON-RPC server ──
{
  const w = await load();
  calls.length = 0;
  const init = await ok(w, "init", { cluster: "mainnet", rpcUrl: MAIN_URL });
  assert.deepEqual(init, { cluster: "mainnet", genesis: GENESIS.mainnet });
  assert.equal(calls[0].url, MAIN_URL, "the pinned host, with the key in the query");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, { "content-type": "application/json" });
  lastCall("getGenesisHash", []);
  await refused(w, "init", { cluster: "mainnet", rpcUrl: MAIN_URL }, /already initialised/);

  assert.deepEqual(await ok(w, "genesis"), { genesis: GENESIS.mainnet });
  lastCall("getGenesisHash", []);
  assert.deepEqual(await ok(w, "blockhash"),
    { blockhash: ME, lastValidBlockHeight: "464000100" });
  lastCall("getLatestBlockhash", [{ commitment: "confirmed" }]);

  const accounts = await ok(w, "accounts", { addresses: [ME, SYSTEM] });
  lastCall("getMultipleAccounts", [[ME, SYSTEM], { encoding: "base64", commitment: "confirmed" }]);
  assert.deepEqual(accounts, { accounts: [
    { owner: SYSTEM, lamports: "759682820", executable: false, data: "AwAAAA==" }, null] });

  assert.deepEqual(await ok(w, "balance", { address: ME }), { lamports: "650240" });
  lastCall("getBalance", [ME, { commitment: "confirmed" }]);

  const tokens = await ok(w, "tokenAccounts", { owner: ME, mint: USDC });
  lastCall("getTokenAccountsByOwner",
    [ME, { mint: USDC }, { encoding: "base64", commitment: "confirmed" }]);
  assert.deepEqual(tokens, { accounts: [{ address: SIG2.slice(0, 44), owner: TOKEN,
    lamports: "2500000", executable: false, data: "AQID" }] });

  assert.deepEqual(await ok(w, "rent", { space: 0 }), { lamports: "650240" });
  lastCall("getMinimumBalanceForRentExemption", [0]);

  const history = await ok(w, "history", { address: ME, limit: 2 });
  lastCall("getSignaturesForAddress", [ME, { limit: 2, commitment: "confirmed" }]);
  assert.deepEqual(history.entries.map((e) => [e.signature, e.failed, e.slot, e.blockTime]),
    [[SIG, false, "463133762", 1793330980], [SIG2, true, "463133000", 1793330000]]);
  await ok(w, "history", { address: ME, limit: 3, before: SIG });
  lastCall("getSignaturesForAddress", [ME, { limit: 3, commitment: "confirmed", before: SIG }]);
  step("init, genesis, blockhash, accounts, balance, tokenAccounts, rent and history");
}

// ── transaction: balances and keys of a legacy and of a v1 transaction ──
{
  const w = await ready();
  const token = (amount) => [{ accountIndex: 3, mint: USDC, owner: ME, programId: TOKEN,
    uiTokenAmount: { amount, decimals: 6, uiAmount: 1.5, uiAmountString: "1.5" } }];
  const landed = (extra = {}, message = {}) => ({ slot: 463133762, blockTime: 1793330980,
    version: "legacy", transaction: { signatures: [SIG], message: { accountKeys: [ME, SYSTEM, USDC],
      recentBlockhash: ME, instructions: [], header: {}, ...message } },
    meta: { err: null, fee: 20000, preBalances: [999760003, 5, 1], postBalances: [999740003, 5, 1],
      preTokenBalances: token("1972502781730"), postTokenBalances: token("1972502781731"),
      loadedAddresses: { readonly: [], writable: [] }, logMessages: ["Program log: x"],
      ...extra } });
  results.getTransaction = () => landed();
  const view = await ok(w, "transaction", { signature: SIG });
  lastCall("getTransaction",
    [SIG, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]);
  assert.deepEqual(view, { found: true, slot: "463133762", blockTime: 1793330980, err: null,
    fee: "20000", accountKeys: [ME, SYSTEM, USDC], preBalances: ["999760003", "5", "1"],
    postBalances: ["999740003", "5", "1"],
    preTokenBalances: [{ accountIndex: 3, mint: USDC, owner: ME, amount: "1972502781730",
      decimals: 6 }],
    postTokenBalances: [{ accountIndex: 3, mint: USDC, owner: ME, amount: "1972502781731",
      decimals: 6 }] });
  // The shape of a v1 transaction is from the Helius page on transaction v1, not from a landing.
  const v1 = landed({ loadedAddresses: { writable: [TOKEN], readonly: [SIG2.slice(0, 44)] } },
    { transactionConfig: { computeUnitLimit: 200000, priorityFee: null } });
  results.getTransaction = () => ({ ...v1, version: 1 });
  const loaded = await ok(w, "transaction", { signature: SIG });
  assert.deepEqual(loaded.accountKeys, [ME, SYSTEM, USDC, TOKEN, SIG2.slice(0, 44)],
    "loaded accounts follow the static ones");
  results.getTransaction = () => landed({ err: { InstructionError: [1, { Custom: 13 }] } });
  assert.equal((await ok(w, "transaction", { signature: SIG })).err,
    '{"InstructionError":[1,{"Custom":13}]}');
  results.getTransaction = () => null;
  assert.deepEqual(await ok(w, "transaction", { signature: SIG }), { found: false });
  results.getTransaction = () => landed({ preBalances: "no" });
  assert.match((await w.ask("transaction", { signature: SIG })).error, /bad balances/);
  step("transaction gives balances, token balances and keys, and found false for none");
}

// ── u64 values keep every digit ──
{
  const w = await ready();
  network = (body) => {
    const big = {
      getBalance: '{"context":{"slot":9},"value":9007199254740993}',
      getMultipleAccounts: '{"context":{"slot":9},"value":[{"data":["AA==","base64"],' +
        '"executable":false,"lamports":18446744073709551615,"owner":"' + SYSTEM + '"}]}',
      getTransaction: JSON.stringify({ slot: 9, transaction: { message: { accountKeys: [ME] } },
        meta: { err: null, fee: 5, preBalances: [0], postBalances: [0] } })
        .replace('"preBalances":[0]', '"preBalances":[9007199254740993,18446744073709551615]')
        .replace('"postBalances":[0]', '"postBalances":[1,9007199254740995]'),
    }[body.method];
    return new Response(`{"jsonrpc":"2.0","id":${body.id},"result":${big}}`);
  };
  assert.equal((await ok(w, "balance", { address: ME })).lamports, "9007199254740993");
  const got = await ok(w, "accounts", { addresses: [ME] });
  assert.equal(got.accounts[0].lamports, "18446744073709551615");
  const tx = await ok(w, "transaction", { signature: SIG });
  assert.deepEqual(tx.preBalances, ["9007199254740993", "18446744073709551615"]);
  assert.deepEqual(tx.postBalances, ["1", "9007199254740995"]);
  network = defaultNetwork;
  step("a balance above 2^53 comes back as an exact decimal text");
}

// ── simulate, send and the gate ──
{
  const w = await ready();
  const tx = txOf();
  await refused(w, "send", { tx }, /did not pass a simulation/);
  const simulate = await ok(w, "simulate", { tx });
  lastCall("simulateTransaction", [tx, { encoding: "base64", sigVerify: true,
    replaceRecentBlockhash: false, commitment: "confirmed" }]);
  assert.deepEqual(simulate, { err: null, unitsConsumed: "150", loadedAccountsDataSize: "214493",
    logs: ["Program log: ok"] });
  assert.deepEqual(await ok(w, "send", { tx }), { signature: SIG });
  lastCall("sendTransaction", [tx, { encoding: "base64", preflightCommitment: "confirmed" }]);
  assert.ok(calls.every((c) => c.init.redirect === "error"), "no call follows a redirect");

  await refused(w, "send", { tx: txOf() }, /did not pass a simulation/);
  const other = txOf();
  await ok(w, "simulate", { tx: other });
  await refused(w, "send", { tx: txOf() }, /did not pass a simulation/);

  // A failing simulation comes back with its logs, and it also takes back an earlier pass.
  const logs = [...Array(40).fill("x".repeat(400)), "Program log: " + MAIN_URL, "Program failed"];
  results.simulateTransaction = () => ({ context: { slot: 9 },
    value: { err: { InstructionError: [1, { Custom: 13 }] }, logs, unitsConsumed: 246 } });
  const failed = await ok(w, "simulate", { tx: other });
  assert.equal(failed.err, '{"InstructionError":[1,{"Custom":13}]}');
  assert.equal(failed.logs.length, 30, "the last 30 lines");
  assert.ok(failed.logs.every((l) => l.length <= 300), "each line is cut");
  assert.ok(failed.logs.includes("Program log: [redacted]"), "the URL in a log is cut out");
  assert.equal(JSON.stringify(failed).includes(KEY), false, "the logs are redacted");
  await refused(w, "send", { tx: other }, /did not pass a simulation/);
  const never = txOf();
  await ok(w, "simulate", { tx: never });
  await refused(w, "send", { tx: never }, /did not pass a simulation/);
  results.simulateTransaction = () => ({ context: { slot: 9 }, value: { logs: [] } });
  assert.equal((await ok(w, "simulate", { tx: never })).err, '"no result"');
  await refused(w, "send", { tx: never }, /did not pass a simulation/);
  results.simulateTransaction = () => ({ context: { slot: 9 }, value: null });
  assert.match((await w.ask("simulate", { tx: never })).error, /bad simulation/);
  resetResults();
  step("send needs a passing simulation of the same bytes; a failure comes back with its logs");
}

// ── The gate lasts 30 s ──
{
  const w = await ready();
  const tx = txOf();
  await ok(w, "simulate", { tx });
  skew += 29_000;
  await ok(w, "send", { tx });
  await ok(w, "simulate", { tx });
  skew += 30_500;
  await refused(w, "send", { tx }, /did not pass a simulation/);
  await ok(w, "simulate", { tx });
  await ok(w, "send", { tx });
  // The map holds 16 passes: the 17th takes the place of the oldest.
  const first = txOf();
  await ok(w, "simulate", { tx: first });
  for (let i = 0; i < 16; i++) await ok(w, "simulate", { tx: txOf() });
  await refused(w, "send", { tx: first }, /did not pass a simulation/);
  step("a pass opens the gate for 30 s and not longer, and the map stays small");
}

// ── status and confirm ──
{
  const w = await ready();
  const mixed = [null, { slot: 7, err: null, confirmationStatus: "processed" },
    { slot: 8, err: null, confirmationStatus: "confirmed" },
    { slot: 9, err: { InstructionError: [0, "x"] }, confirmationStatus: "finalized" },
    { slot: 10, err: null, confirmationStatus: "finalized" }];
  results.getSignatureStatuses = () => ({ context: { slot: 11 }, value: mixed });
  const sigs = [SIG, SIG2, SIG, SIG2, SIG];
  const got = await ok(w, "status", { signatures: sigs });
  lastCall("getSignatureStatuses", [sigs, { searchTransactionHistory: true }]);
  assert.deepEqual(got.statuses.map((s) => [s.status, s.slot]),
    [["none", ""], ["pending", "7"], ["confirmed", "8"], ["failed", "9"], ["finalized", "10"]]);
  results.getSignatureStatuses = () => ({ context: { slot: 11 }, value: [] });
  assert.match((await w.ask("status", { signatures: [SIG] })).error, /bad status list/);

  const steps = [null, { slot: 3, err: null, confirmationStatus: "processed" },
    { slot: 4, err: null, confirmationStatus: "confirmed" }];
  results.getSignatureStatuses = () => ({ context: { slot: 11 }, value: [steps.shift()] });
  calls.length = 0;
  assert.deepEqual(await ok(w, "confirm", { signature: SIG }),
    { status: "confirmed", slot: "4", err: null });
  assert.equal(calls.length, 3, "one look each second until confirmed");
  lastCall("getSignatureStatuses", [[SIG], { searchTransactionHistory: false }]);

  results.getSignatureStatuses = () => ({ context: { slot: 11 }, value: [{ slot: 4,
    err: { InstructionError: [1, "x"] }, confirmationStatus: "confirmed" }] });
  assert.equal((await ok(w, "confirm", { signature: SIG })).status, "failed");
  // No answer in 45 s: the clock jumps with the first look, so the Worker gives up at once.
  results.getSignatureStatuses = () => {
    skew += 50_000;
    return { context: { slot: 11 }, value: [null] };
  };
  assert.deepEqual(await ok(w, "confirm", { signature: SIG }),
    { status: "unknown", slot: "", err: null });
  resetResults();
  step("status reads many signatures, and confirm waits for confirmed, failed or 45 s");
}

// ── The host pin, both ways ──
{
  const pins = [
    ["mainnet", DEV_URL, "the Devnet host for a mainnet Worker"],
    ["devnet", MAIN_URL, "the mainnet host for a Devnet Worker"],
    ["mainnet", `https://u:p@mainnet.helius-rpc.com/?api-key=${KEY}`, "a user name and password"],
    ["mainnet", `https://:p@mainnet.helius-rpc.com/?api-key=${KEY}`, "a password only"],
    ["mainnet", `https://mainnet.helius-rpc.com:8443/?api-key=${KEY}`, "another port"],
    ["mainnet", `http://mainnet.helius-rpc.com/?api-key=${KEY}`, "http"],
    ["mainnet", `https://mainnet.helius-rpc.com.evil.example/?api-key=${KEY}`, "a longer host"],
    ["mainnet", `https://evil.example/?api-key=${KEY}`, "another host"],
    ["mainnet", `https://x.mainnet.helius-rpc.com/?api-key=${KEY}`, "a subdomain"],
    ["mainnet", `https://mainnet.helius-rpc.com@evil.example/?api-key=${KEY}`, "a host after @"],
    ["mainnet", `https://mainnet.helius-rpc.com/v1/x?api-key=${KEY}`, "another path"],
    ["mainnet", `https://mainnet.helius-rpc.com/?api-key=${KEY}#x`, "a fragment"],
    ["mainnet", `wss://mainnet.helius-rpc.com/?api-key=${KEY}`, "wss"],
    ["mainnet", `http://127.0.0.1:8803/?api-key=${KEY}`, "a loopback host"],
    ["mainnet", "mainnet.helius-rpc.com", "a text that is no URL"],
    ["devnet", `https://devnet.helius-rpc.com:444/?api-key=${KEY}`, "another port on Devnet"],
  ];
  for (const [cluster, url, what] of pins) {
    const w = await load();
    calls.length = 0;
    const error = await refused(w, "init", { cluster, rpcUrl: url }, /^Error: init: rpcUrl/);
    assert.equal(error.includes(KEY), false, `${what}: the error shows the key`);
    await refused(w, "balance", { address: ME }, /not initialised/);
  }
  // The same host under other spellings is the same origin and works.
  const same = [MAIN_URL, `https://MAINNET.helius-rpc.com:443/?api-key=${KEY}`];
  for (const url of same) {
    const w = await load();
    await ok(w, "init", { cluster: "mainnet", rpcUrl: url });
    assert.equal(calls.at(-1).url, MAIN_URL, "the URL that was checked is the URL that is fetched");
  }
  calls.length = 0;
  results.getGenesisHash = () => GENESIS.devnet;
  const dev = await load();
  await ok(dev, "init", { cluster: "devnet", rpcUrl: DEV_URL });
  assert.equal(calls[0].url, DEV_URL);
  resetResults();
  step("each cluster takes its own Helius origin only, with no user, port, path or redirect");
}

// ── A redirect is an error, and no second URL is fetched ──
{
  const evil = "https://evil.example/steal";
  const w = await load();
  calls.length = 0;
  network = () => new Response(null, { status: 302, headers: { location: evil } });
  await w.ask("init", { cluster: "mainnet", rpcUrl: MAIN_URL }).then((reply) => {
    assert.equal(reply.ok, false);
    assert.match(reply.error, /redirected/);
  });
  network = () => {
    throw new TypeError(`Failed to fetch ${MAIN_URL}: redirect mode is "error"`);
  };
  const thrown = await w.ask("init", { cluster: "mainnet", rpcUrl: MAIN_URL });
  assert.equal(thrown.ok, false);
  assert.match(thrown.error, /request failed/);
  assert.equal(thrown.error.includes(KEY), false, "the key is cut from a fetch error");
  network = () => Object.defineProperty(new Response("{}"), "redirected", { value: true });
  assert.match((await w.ask("init", { cluster: "mainnet", rpcUrl: MAIN_URL })).error, /redirected/);
  assert.ok(calls.every((c) => c.url === MAIN_URL && c.init.redirect === "error"));
  assert.equal(calls.length, 3, "the Location URL was never fetched");
  network = defaultNetwork;
  await refused(w, "balance", { address: ME }, /not initialised/);
  await ok(w, "init", { cluster: "mainnet", rpcUrl: MAIN_URL });
  step("a redirect is an error, nothing is fetched twice, and a failed init can start again");
}

// ── The genesis check ──
{
  results.getGenesisHash = () => GENESIS.devnet;
  const w = await load();
  calls.length = 0;
  const reply = await w.ask("init", { cluster: "mainnet", rpcUrl: MAIN_URL });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /not Solana mainnet/);
  assert.equal(calls.length, 1);
  results.getGenesisHash = () => GENESIS.mainnet;
  for (const [cmd, args] of [["balance", { address: ME }], ["blockhash", {}], ["genesis", {}],
    ["init", { cluster: "mainnet", rpcUrl: MAIN_URL }], ["simulate", { tx: txOf() }]]) {
    await refused(w, cmd, args, /not Solana mainnet/);
  }
  resetResults();
  results.getGenesisHash = () => GENESIS.mainnet.slice(1) + "1";
  const odd = await load();
  assert.equal((await odd.ask("init", { cluster: "mainnet", rpcUrl: MAIN_URL })).ok, false);
  results.getGenesisHash = () => null;
  const none = await load();
  assert.equal((await none.ask("init", { cluster: "mainnet", rpcUrl: MAIN_URL })).ok, false);
  resetResults();
  // A server that changes its chain after init is caught by the genesis command.
  const live = await ready();
  results.getGenesisHash = () => GENESIS.devnet;
  assert.match((await live.ask("genesis", {})).error, /not Solana mainnet/);
  results.getGenesisHash = () => GENESIS.mainnet;
  await refused(live, "balance", { address: ME }, /not Solana mainnet/);
  resetResults();
  // A Devnet Worker wants the Devnet hash.
  results.getGenesisHash = () => GENESIS.mainnet;
  const wrong = await load();
  assert.match((await wrong.ask("init", { cluster: "devnet", rpcUrl: DEV_URL })).error,
    /not Solana devnet/);
  resetResults();
  step("a server with another genesis hash is refused for good, and no command runs after it");
}

// ── The API key stays out of every answer ──
{
  const w = await ready();
  const echo = `${MAIN_URL} and api-key=${KEY} and ${KEY} and %61pi-key=${KEY}`;
  network = () => {
    throw new TypeError(`fetch failed: ${echo}`);
  };
  const a = await w.ask("balance", { address: ME });
  network = (body) => Response.json({ jsonrpc: "2.0", id: body.id,
    error: { code: -32602, message: `Invalid param at ${echo}` } });
  const b = await w.ask("balance", { address: ME });
  network = () => new Response(`<html>${echo}</html>`, { status: 200 });
  const c = await w.ask("balance", { address: ME });
  network = () => new Response(echo, { status: 403 });
  const d = await w.ask("balance", { address: ME });
  network = (body) => Response.json({ jsonrpc: "2.0", id: body.id, result: { value: echo } });
  const e = await w.ask("balance", { address: ME });
  for (const reply of [a, b, c, d, e]) {
    assert.equal(reply.ok, false);
    assert.equal(JSON.stringify(reply).includes(KEY), false, JSON.stringify(reply));
  }
  assert.match(b.error, /RPC error -32602: Invalid param at \[redacted\]/);
  assert.match(d.error, /refused this website/);
  network = defaultNetwork;
  step("the API key is in no error, even when the server or the network repeats the URL");
}

// ── The statuses of Helius ──
{
  const w = await ready();
  const cases = [[401, /refused the API key/], [403, /does not allow this domain/],
    [429, /Too many Helius calls/], [503, /not answering/], [418, /status 418/]];
  for (const [status, pattern] of cases) {
    network = () => new Response("no", { status });
    assert.match((await w.ask("balance", { address: ME })).error, pattern, String(status));
  }
  network = (body) => Response.json({ jsonrpc: "2.0", id: body.id + 1, result: 1 });
  assert.match((await w.ask("balance", { address: ME })).error, /another call/);
  network = (body) => Response.json({ jsonrpc: "2.0", id: body.id });
  assert.match((await w.ask("balance", { address: ME })).error, /no result/);
  network = defaultNetwork;
  step("a refusal of Helius reads as a short text");
}

// ── The pace of the calls ──
{
  quick = false;
  const w = await ready();
  const runs = Array.from({ length: 6 }, () => w.ask("balance", { address: ME }));
  const replies = await Promise.all(runs);
  assert.ok(replies.every((r) => r.ok));
  const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
  assert.equal(gaps.length, 5);
  for (const gap of gaps) assert.ok(gap >= 120, `calls ${gap.toFixed(0)} ms apart: 8 a second`);

  const one = txOf(), two = txOf();
  await ok(w, "simulate", { tx: one });
  await ok(w, "simulate", { tx: two });
  calls.length = 0;
  await ok(w, "send", { tx: one });
  await ok(w, "send", { tx: two });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].at - calls[0].at >= 995, "1 send a second at most");
  quick = true;
  step("calls leave 125 ms apart at least, and two sends 1 s apart at least");
}

// ── The Worker has no SDK, no wasm and no key share ──
{
  const sources = ["worker.js", "guard.js"].map((name) =>
    readFileSync(new URL(`plain/${name}`, WEB_SOL), "utf8"));
  const [worker, guard] = sources;
  const specifiers = [...worker.matchAll(/^import [^"]*"([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(specifiers, ["/sol/plain/guard.js"], "the Worker imports its guard only");
  assert.doesNotMatch(guard, /^\s*import /m, "the guard imports nothing");
  for (const source of sources) {
    assert.doesNotMatch(source, /importScripts|import\(|WebAssembly|\.wasm|localStorage/);
  }
  step("the Worker imports nothing but its guard: no SDK, no prover, no wasm");
}

// ── No message of this run holds the key ──
{
  assert.ok(messages.length > 50, "the run posted many messages");
  assert.equal(JSON.stringify(messages).includes(KEY), false, "no answer holds the API key");
  assert.doesNotMatch(JSON.stringify(messages), /api-key=(?!\[redacted\])/, "no key value");
  step("not one of the answers of this run holds the API key");
}
console.log("plain-worker: ok");
process.exit(0);
