// Mainnet simulations of messages built by the Zigs code (web/sol and its wasm), with fresh random
// keys and iFSb... as the fee payer. No chain write: it only reads and calls simulateTransaction
// with sigVerify false, and it refuses to run if its own text holds a send call.
// Run: node solspike/tools/mainnet_sim.mjs [--dry] [--out DIR]
//   --dry builds the messages and makes no RPC call. The results go to DIR (default: the cwd).
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const at = process.argv.indexOf("--out");
const OUT = at > 0 ? process.argv[at + 1] : process.cwd();
if (!OUT) throw new Error("--out needs a folder");
fs.mkdirSync(OUT, { recursive: true });
const FORBIDDEN = ["send" + "Transaction", "send" + "RawTransaction", "request" + "Airdrop"];
const self = fs.readFileSync(new URL(import.meta.url), "utf8");
for (const word of FORBIDDEN) {
  if (self.includes(word)) throw new Error("refused: this file holds a chain write call");
}
const DRY = process.argv.includes("--dry");
const RPC = "https://api.mainnet-beta.solana.com";
const MIN_GAP_MS = 1100;
const BUDGET = 40;

const web = (rel) => import(path.join(REPO, "web", rel));
const { base58, keyOfBase58 } = await web("sol/docs.js");
const I = await web("sol/intent.js");
const P = await web("sol/plain/intent.js");
const W = await web("sol/wasm/sol_wasm.js");
const kit = await web("sol/zolana.bundle.js");
W.initSync({ module: fs.readFileSync(path.join(REPO, "web/sol/wasm/sol_wasm_bg.wasm")) });

const hex = I.hexOf;
const bytes = I.bytesOf;
const PAYER_ADDR = "iFSbwFzpLpaGMKtn5S6gznvzXqAVunoB6rcSpGi956o";
const AUTH_ADDR = "CuZ42BsoBcLaNTUboJpGhekGmrYMZ7sRhwVki4frz1FB";
const PAYER = keyOfBase58(PAYER_ADDR);
const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const addr = (h) => kit.getAddressDecoder().decode(bytes(h));
const J = JSON.parse;

// ---- RPC with a call count, a pause and a back-off on 429 ----
let calls = 0;
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params) {
  if (DRY) throw new Error("dry run: no RPC call");
  for (let wait = 2000; ; wait *= 2) {
    if (calls >= BUDGET) throw new Error("RPC budget used");
    await sleep(Math.max(0, last + MIN_GAP_MS - Date.now()));
    calls += 1;
    last = Date.now();
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status === 429 && wait <= 16000) {
      await sleep(wait);
      continue;
    }
    const body = await res.json();
    if (body.error) return { rpcError: body.error };
    return body.result;
  }
}

// ---- fresh keys in memory ----
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
function freshGroup(label) {
  const seed = randomBytes(32);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" });
  const groupKey = hex(createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12));
  const solSeed = hex(randomBytes(32));
  const roles = J(W.sol_roles(solSeed, groupKey));
  const pda = J(W.sol_pda_roles(label, solSeed, groupKey));
  return { groupKey, solSeed, roles, pda };
}

const wallet = J(W.sol_pool_wallet("mainnet")); // { label, program, ... } from the wasm
const label = wallet.label;
const group = freshGroup(label);
const payeeGroup = freshGroup(label);
const done = {
  cluster: label,
  groupKey: group.groupKey,
  nullifierPk: group.roles.nullifier_pk,
  viewingPk: group.roles.viewing_pk,
  pdaNullifierPk: group.pda.nullifier_pk,
};
const pinsFor = (genesis) => bytes(I.pinsHex(done, PAYER, genesis));

// ---- helpers over a v1 message ----
function describe(message) {
  const m = kit.getCompiledTransactionMessageDecoder().decode(message);
  const keys = m.staticAccounts;
  return {
    versionByte: "0x" + message[0].toString(16),
    signatures: message[1],
    bytes: message.length,
    instructions: m.instructionHeaders.map((h, i) => ({
      program: keys[h.programAccountIndex],
      accounts: [...m.instructionPayloads[i].instructionAccountIndices].map((x) => keys[x]),
      dataBytes: m.instructionPayloads[i].instructionData.length,
      dataTag: m.instructionPayloads[i].instructionData[0],
    })),
  };
}
const wire = (message) =>
  Buffer.concat([Buffer.from(message), Buffer.alloc(64 * message[1])]).toString("base64");

async function simulate(name, message, extra) {
  const info = describe(message);
  const entry = { name, ...extra, message: info, messageHex: hex(message) };
  if (DRY) return { ...entry, dry: true };
  const reply = await rpc("simulateTransaction", [
    wire(message),
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
  ]);
  if (reply.rpcError) return { ...entry, rpcError: reply.rpcError };
  const v = reply.value;
  const logs = v.logs ?? [];
  const ran = [...new Set(logs.map((l) => /^Program (\w+) invoke/.exec(l)?.[1]).filter(Boolean))];
  return {
    ...entry,
    slot: reply.context.slot,
    err: v.err,
    unitsConsumed: v.unitsConsumed,
    programsInvoked: ran,
    logs,
    logsTail: logs.slice(-6),
  };
}

const results = { cluster: "mainnet-beta", rpc: RPC, dry: DRY, label, simulations: [] };
const genesis = DRY ? GENESIS : await rpc("getGenesisHash", []);
if (genesis !== GENESIS) throw new Error("the RPC is not mainnet: " + genesis);
const bh = DRY
  ? { value: { blockhash: base58("11".repeat(32)) } }
  : await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
const blockhash = DRY ? "11".repeat(32) : keyOfBase58(bh.value.blockhash);
let now = Math.floor(Date.now() / 1000);
if (!DRY) {
  const clock = await rpc("getAccountInfo", [
    "SysvarC1ock11111111111111111111111111111111",
    { encoding: "base64", commitment: "confirmed" },
  ]);
  now = Number(Buffer.from(clock.value.data[0], "base64").readBigInt64LE(32));
}
results.genesis = genesis;
results.chainClock = now;
results.feePayer = PAYER_ADDR;
results.group = {
  groupKey: addr(group.groupKey),
  ownerPda: addr(group.pda.pda),
  note: "random, in memory only, no secret kept",
};
const pins = pinsFor(genesis);
results.pinsBytes = pins.length;

// A: Add SOL (the shield), 0.01 SOL, held 0.
{
  const intent = bytes(I.intentHex("shield", { blockhash, amount: 10_000_000n, held: 0n }));
  const message = W.compile_message(intent, pins, new Uint8Array(0));
  const code = "intentHex(shield) + wasm compile_message";
  results.simulations.push(await simulate("A shield (Add SOL) 0.01 SOL", message, { code }));
}

// B: create (tag 0) of the approvals program for a private send of the fresh group.
{
  const expiry = BigInt(now + 23 * 3600);
  const plan = I.planHex({
    blindingSeed: hex(randomBytes(32)),
    outputs: [
      { role: "payee", mint: I.ZERO_KEY, amount: 5_000_000n, blinding: hex(randomBytes(32)) },
      { role: "change", mint: I.ZERO_KEY, amount: 0n, blinding: hex(randomBytes(32)) },
    ],
  });
  const fields = {
    expiry, inputs: 1, outputs: 2, payee: payeeGroup.pda.address, amount: 5_000_000n,
    commitment: hex(randomBytes(32)), blockhash,
  };
  const intent = I.intentHex("propose", fields);
  const proposal = bytes(I.paymentHex(intent, { plan, transact: "" }));
  const message = W.compile_message(proposal, pins, new Uint8Array(0));
  const code = "intentHex(propose) + paymentHex + wasm compile_message";
  const extra = { code, fakeCommitment: fields.commitment };
  results.simulations.push(await simulate("B create (tag 0) of a private send", message, extra));
  const w = {
    expiry, inputs: 1, outputs: 2, recipient: keyOfBase58(AUTH_ADDR), amount: 5_000_000n,
    commitment: hex(randomBytes(32)), blockhash,
  };
  const wIntent = I.intentHex("proposeWithdraw", w);
  const wPlan = I.planHex({
    blindingSeed: hex(randomBytes(32)),
    outputs: [
      { role: "change", mint: I.ZERO_KEY, amount: 0n, blinding: hex(randomBytes(32)) },
      { role: "dummy", mint: I.ZERO_KEY, amount: 0n, blinding: hex(randomBytes(32)) },
    ],
  });
  const wProposal = bytes(I.paymentHex(wIntent, { plan: wPlan, transact: "" }));
  const wMessage = W.compile_message(wProposal, pins, new Uint8Array(0));
  const wCode = "intentHex(proposeWithdraw) + paymentHex + wasm compile_message";
  const wExtra = { code: wCode, fakeCommitment: w.commitment };
  results.simulations.push(await simulate("B2 create (tag 0) of a withdrawal", wMessage, wExtra));
}

// C: the plain mainnet wallet (Zigs plain template).
{
  const plainWallet = { cluster: "mainnet" };
  // The checker refuses a fee payer that is the group key: iFSb pays, a fresh group key sends.
  const plainPins = P.plainPins(plainWallet, freshGroup(label).groupKey, PAYER);
  const nonce = hex(randomBytes(32));
  const send = P.sendSolIntent(0, nonce, keyOfBase58(AUTH_ADDR), 1_000_000n);
  let message;
  try {
    message = W.plain_compile_message(send, plainPins);
    const extra = { code: "plain sendSolIntent + wasm plain_compile_message", fakeNonce: nonce };
    results.simulations.push(await simulate("C plain send 1,000,000 lamports", message, extra));
  } catch (e) {
    const compileError = String(e?.message ?? e);
    results.simulations.push({ name: "C plain send 1,000,000 lamports", compileError });
  }
  const create = P.createNonceIntent(0, blockhash);
  try {
    message = W.plain_compile_message(create, plainPins);
    const extra = { code: "plain createNonceIntent + wasm plain_compile_message" };
    results.simulations.push(await simulate("C2 plain create-nonce", message, extra));
  } catch (e) {
    const compileError = String(e?.message ?? e);
    results.simulations.push({ name: "C2 plain create-nonce", compileError });
  }
}

results.rpcCalls = calls;
const text = JSON.stringify(results, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
fs.writeFileSync(path.join(OUT, DRY ? "results.dry.json" : "results.json"), text);
for (const s of results.simulations) {
  const failure = s.compileError ?? s.rpcError;
  const outcome = JSON.stringify(failure ?? s.err);
  const ran = (s.programsInvoked ?? []).join(",");
  console.log(s.name, "|", outcome, s.unitsConsumed ?? "", s.message?.versionByte ?? "", ran);
}
console.log("rpc calls:", calls);
