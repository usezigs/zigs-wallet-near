// The real SDK bundle against the real wasm (the checks that no other test makes):
//  - the Worker (worker.js, real SDK) and the wasm make the same group and PDA addresses, as the
//    page compares them in session.js sameAddresses;
//  - the fee read of the Worker decodes a tree account of the pool and refuses another owner;
//  - the pool of the SDK is ring1G, and the pool and the SOL interface of the wasm are the SDK
//    ones and the one of prepare.js;
//  - SHIELD: Add SOL is not fail-closed (a shield pays into the PDA that the wasm pins, and the
//    pool accepts any owner hash), so the deposit instruction that the wasm compiles for the
//    owner = the group PDA must equal the deposit instruction of the SDK byte for byte: data,
//    accounts and flags, and the owner hash and view tag in it;
//  - the same for the private mainnet wallet: its PDA under the approvals program 9mE7, its pins
//    with the mainnet genesis, and the tables of guard.js against the wasm.
// Run: node web/test/sol-sdk.mjs   (Node 26)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import * as W from "../sol/wasm/sol_wasm.js";

const WEB_SOL = new URL("../sol/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("/sol/")) return next(specifier, context);
    return { url: new URL(specifier.slice(5), WEB_SOL).href, shortCircuit: true };
  },
});
W.initSync({ module: readFileSync(new URL("wasm/sol_wasm_bg.wasm", WEB_SOL)) });
const step = (name) => console.log(`ok  ${name}`);
const J = JSON.parse;
const json = (name) => J(readFileSync(new URL(name, import.meta.url), "utf8"));

// ---- a fake network: the hasher wasm files, and one tree account for getAccountInfo ----

const POOL = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const TREE_BYTES = 40_080;
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
let treeAccount = { owner: POOL, data: Buffer.alloc(TREE_BYTES) };
function rpcAnswer(init) {
  const body = init?.body ? J(init.body) : null;
  const { owner, data } = treeAccount;
  const value = {
    data: [data.toString("base64"), "base64"],
    executable: false,
    lamports: 1_000_000,
    owner,
    rentEpoch: 0,
    space: data.length,
  };
  const results = {
    getSlot: 9,
    getBalance: { context: { slot: 9 }, value: 5 },
    getAccountInfo: { context: { slot: 9 }, value },
    getGenesisHash: DEVNET_GENESIS,
  };
  return Response.json({ jsonrpc: "2.0", id: body?.id, result: results[body?.method] ?? null });
}
globalThis.fetch = async (input, init) => {
  const href = String(input instanceof Request ? input.url : input);
  if (!href.startsWith("file:")) return rpcAnswer(init);
  const body = readFileSync(fileURLToPath(href));
  return new Response(body, { headers: { "content-type": "application/wasm" } });
};

const waiting = new Map();
globalThis.self = { postMessage: (message) => waiting.get(message.id)?.(message) };
await import(new URL("worker.js", WEB_SOL).href);
const sdk = await import(new URL("zolana.bundle.js", WEB_SOL).href);
const { SOL_INTERFACE: PREPARE_SOL_INTERFACE } = await import(new URL("prepare.js", WEB_SOL).href);
const { base58 } = await import(new URL("docs.js", WEB_SOL).href);
const { bytesOf, hexOf, intentHex, pinsHex } = await import(new URL("intent.js", WEB_SOL).href);
const { CLUSTERS } = await import(new URL("guard.js", WEB_SOL).href);
await sdk.initializePoseidon();
const hexOfAddress = (address) => hexOf(sdk.getAddressEncoder().encode(address));

let ids = 0;
function ask(cmd, args) {
  ids += 1;
  const id = ids;
  const answer = new Promise((ok) => waiting.set(id, ok));
  globalThis.self.onmessage({ data: { id, cmd, args } });
  return answer;
}

// The seeds: the four of wasm-sol/vectors/roles.json and the group of sol-group.json.
const seeds = [
  ...json("../../wasm-sol/vectors/roles.json").vectors,
  (({ solSeed, group }) => ({ name: "sol-group", solSeed, groupKey: group.key }))(
    json("sol-group.json"),
  ),
];

// The PDA of ["multisig", group key] under an approvals program (Devnet: 5PHZ, mainnet: 9mE7),
// derived here with node:crypto and an Ed25519 off-curve test, so that no wasm value stands on
// both sides.
const APPROVALS = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
const MAINNET_APPROVALS = "9mE7WUJHK6dQwzK6AP6wf1eyPmePULZrGeRbXqke2ukq";
const DEVNET = {
  cluster: "devnet",
  label: "devnet",
  genesis: DEVNET_GENESIS,
  approvals: APPROVALS,
};
const MAINNET = {
  cluster: "mainnet",
  label: "mainnet-private",
  genesis: MAINNET_GENESIS,
  approvals: MAINNET_APPROVALS,
};
const P = 2n ** 255n - 19n;
const power = (base, exp) => {
  let out = 1n;
  for (let b = base % P; exp > 0n; exp >>= 1n, b = (b * b) % P) if (exp & 1n) out = (out * b) % P;
  return out;
};
const D = ((P - 121665n) * power(121666n, P - 2n)) % P;
function onCurve(bytes) {
  const y = BigInt(`0x${Buffer.from(bytes).reverse().toString("hex")}`) & ((1n << 255n) - 1n);
  if (y >= P) return false;
  const u = (y * y - 1n + P) % P;
  const x2 = (u * power((D * y * y + 1n) % P, P - 2n)) % P;
  return x2 === 0n || power(x2, (P - 1n) / 2n) === 1n;
}
function derivePda(groupKeyHex, approvals = APPROVALS) {
  const program = Buffer.from(hexOf(sdk.getAddressEncoder().encode(approvals)), "hex");
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = createHash("sha256")
      .update("multisig")
      .update(Buffer.from(groupKeyHex, "hex"))
      .update(Uint8Array.of(bump))
      .update(program)
      .update("ProgramDerivedAddress")
      .digest();
    if (!onCurve(hash)) return hash.toString("hex");
  }
  throw new Error("no bump");
}
const rolesOf = (seed, row = DEVNET) => ({
  ...J(W.sol_roles(seed.solSeed, seed.groupKey)),
  pda: J(W.sol_pda_roles(row.label, seed.solSeed, seed.groupKey)),
});
const RPC_URL = "https://devnet.helius-rpc.com/?api-key=" + "k3y9".repeat(5);

async function initOf(seed, roles) {
  const answer = await ask("init", {
    cluster: "devnet",
    rpcUrl: RPC_URL,
    nullifierSecret: roles.nullifier_secret,
    pdaNullifierSecret: roles.pda.nullifier_secret,
    viewingSecret: roles.viewing_sk,
    groupKey: seed.groupKey,
    pda: roles.pda.pda,
  });
  assert.equal(answer.ok, true, `${seed.name}: ${answer.error}`);
  return answer.result ?? answer;
}

// ---- the group and PDA addresses: what session.js sameAddresses compares ----

for (const seed of seeds) {
  const roles = rolesOf(seed);
  const init = await initOf(seed, roles);
  const shown = `${seed.name}`;
  assert.equal(roles.pda.pda, derivePda(seed.groupKey), `${shown}: PDA derived in the test`);
  if (seed.pda) {
    assert.equal(roles.pda.pda, seed.pda, `${shown}: PDA of roles.json`);
    assert.equal(roles.pda.owner_hash, seed.pdaOwnerHash, `${shown}: PDA owner hash of roles.json`);
  }
  assert.equal(init.shielded, roles.address, `${shown}: group address`);
  assert.equal(init.owner, base58(seed.groupKey), `${shown}: group owner`);
  assert.equal(init.pdaShielded, roles.pda.address, `${shown}: PDA address`);
  assert.equal(init.pda, base58(roles.pda.pda), `${shown}: PDA`);
  assert.equal(init.ownerHash, roles.owner_hash, `${shown}: group owner hash`);
  assert.equal(init.pdaOwnerHash, roles.pda.owner_hash, `${shown}: PDA owner hash`);
  assert.deepEqual([init.cluster, init.genesis], ["devnet", DEVNET_GENESIS], `${shown}: genesis`);
}
step("the group and PDA addresses of the Worker equal those of the wasm for 5 seeds");

// ---- the fee read ----

const TREE = base58("77".repeat(32));
const fees = Buffer.alloc(TREE_BYTES);
fees[0] = 1; // StateDiscriminator.treeAccount
fees.writeBigUInt64LE(5000n, 8); // feePerTree
fees.writeBigUInt64LE(11n, 16); // appendReimbursement
fees.writeBigUInt64LE(13n, 24); // closeReimbursement
fees.writeBigUInt64LE(17n, 32); // feeBalance
treeAccount = { owner: POOL, data: fees };
const read = await ask("treeFees", { tree: TREE });
assert.equal(read.ok, true, read.error);
const got = read.result ?? read;
assert.deepEqual(
  [got.feePerTree, got.appendReimbursement, got.closeReimbursement, got.feeBalance],
  ["5000", "11", "13", "17"],
);
treeAccount = { owner: "11111111111111111111111111111111", data: fees };
const other = await ask("treeFees", { tree: TREE });
assert.equal(other.ok, false, "a tree account of another owner was accepted");
treeAccount = { owner: POOL, data: Buffer.alloc(TREE_BYTES - 1) };
assert.equal((await ask("treeFees", { tree: TREE })).ok, false, "a short account was accepted");
step("the fee read gives feePerTree of a pool tree account and refuses another owner or size");

// ---- the pool and the SOL interface ----

assert.equal(sdk.SHIELDED_POOL_PROGRAM_ID, POOL, "the pool of the SDK is ring1G");
assert.equal(hexOfAddress(sdk.SOL_INTERFACE), PREPARE_SOL_INTERFACE, "prepare.js SOL interface");
assert.equal(sdk.SOL_INTERFACE, "CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE");
step("the pool of the SDK is ring1G and its SOL interface is the one of prepare.js");

// ---- the shield cross-check ----

const PAYER = "51".repeat(32);
const BLOCKHASH = "07".repeat(32);

/**
 * The wasm message of Add SOL for a seed and an amount on the row of a cluster, cut into its one
 * pool instruction.
 */
function wasmShield(seed, roles, amount, row = DEVNET) {
  const done = {
    cluster: row.label,
    groupKey: seed.groupKey,
    nullifierPk: roles.nullifier_pk,
    viewingPk: roles.viewing_pk,
    pdaNullifierPk: roles.pda.nullifier_pk,
  };
  const intent = intentHex("shield", { blockhash: BLOCKHASH, amount, held: 0n });
  const pins = bytesOf(pinsHex(done, PAYER, row.genesis));
  const bytes = W.compile_message(bytesOf(intent), pins, new Uint8Array(0));
  const message = sdk.getCompiledTransactionMessageDecoder().decode(bytes);
  assert.equal(message.instructionHeaders.length, 1, "Add SOL is one instruction");
  const [head] = message.instructionHeaders;
  const { header, staticAccounts: keys } = message;
  const signers = header.numSignerAccounts;
  const flags = (i) => ({
    signer: i < signers,
    writable:
      i < signers
        ? i < signers - header.numReadonlySignerAccounts
        : i < keys.length - header.numReadonlyNonSignerAccounts,
  });
  const payload = message.instructionPayloads[0];
  return {
    program: keys[head.programAccountIndex],
    accounts: payload.instructionAccountIndices.map((i) => ({ address: keys[i], ...flags(i) })),
    data: Uint8Array.from(payload.instructionData),
  };
}

/** The deposit instruction of the SDK for the PDA identity of the seed. */
async function sdkShield(seed, roles, amount, wasm, row = DEVNET) {
  const viewing = sdk.ViewingKey.fromBytes(Uint8Array.from(bytesOf(roles.viewing_sk)));
  const address = sdk.ShieldedAddress.forPda({
    pda: bytesOf(derivePda(seed.groupKey, row.approvals)),
    nullifierPublicKey: bytesOf(roles.pda.nullifier_pk),
    viewingPublicKey: viewing.publicKey(),
  });
  const payer = sdk.getAddressDecoder().decode(bytesOf(PAYER));
  const ix = await sdk.depositInstruction({
    tree: wasm.accounts[0].address,
    depositor: payer,
    deposits: [
      {
        asset: { kind: "sol" },
        viewTag: address.confidentialViewTag(),
        recipientOwnerHash: address.ownerHash(),
        amount,
      },
    ],
  });
  return { ix, address };
}

const roleFlags = (role) => ({ signer: role >= 2, writable: role % 2 === 1 });
// A tree address from the SDK, not from the wasm: the client of the Worker derives tree 0.
const client = await sdk.createSprClient({
  solanaRpcUrl: RPC_URL,
  indexerUrl: "https://devnet.helius-rpc.com/v1/spr",
  proverUrl: "http://127.0.0.1:3001",
  proofDataSource: "client",
});

/** The wasm deposit of a seed, an amount and a row equals the SDK deposit for its PDA owner. */
async function sameShield(seed, amount, row) {
  const roles = rolesOf(seed, row);
  const pda = derivePda(seed.groupKey, row.approvals);
  const wasm = wasmShield(seed, roles, amount, row);
  const { ix, address } = await sdkShield(seed, roles, amount, wasm, row);
  const label = `${seed.name} ${row.label} ${amount}`;
  assert.equal(roles.pda.pda, pda, `${label}: the PDA of the wasm`);
  assert.equal(wasm.program, sdk.SHIELDED_POOL_PROGRAM_ID, `${label}: program`);
  assert.equal(ix.programAddress, wasm.program, `${label}: SDK program`);
  assert.equal(wasm.accounts[0].address, client.tree, `${label}: tree 0 of the SDK`);
  assert.equal(hexOf(wasm.data), hexOf(ix.data), `${label}: instruction data`);
  const sdkAccounts = ix.accounts.map((a) => ({ address: a.address, ...roleFlags(a.role) }));
  assert.deepEqual(wasm.accounts, sdkAccounts, `${label}: account metas`);
  assert.equal(hexOf(address.ownerHash()), roles.pda.owner_hash, `${label}: owner hash`);
  const tag = hexOf(address.confidentialViewTag());
  assert.equal(tag, pda, `${label}: view tag`);
  const data = hexOf(wasm.data);
  assert.ok(data.includes(roles.pda.owner_hash), `${label}: the data holds the owner hash`);
  assert.ok(data.includes(pda), `${label}: the data holds the view tag`);
  assert.equal(wasm.accounts[1].address, base58(PAYER), `${label}: depositor is the payer`);
  assert.equal(hexOfAddress(wasm.accounts[4].address), PREPARE_SOL_INTERFACE);
}

for (const seed of seeds) {
  for (const amount of [1n, 20_000_000n, 0xffff_ffff_ffff_ffffn]) {
    await sameShield(seed, amount, DEVNET);
  }
}
step("the wasm Add SOL deposit equals the SDK deposit for the PDA owner (5 seeds, 3 amounts)");

// ---- the private mainnet wallet ----

// guard.js keeps its own table for the Worker: its programs and genesis hashes must be the ones
// of the wasm rows. The program of mainnet is the last field of the signed program label.
const pool = J(W.sol_pool_wallet("mainnet"));
assert.deepEqual([pool.label, pool.cap], ["mainnet-private", null]);
assert.equal(pool.program.split(":").at(-1), CLUSTERS.mainnet.program, "the program label");
assert.equal(J(W.sol_pool_wallet("devnet")).cap, null, "Devnet has no cap");
for (const row of [DEVNET, MAINNET]) {
  const { program, genesis } = CLUSTERS[row.cluster];
  assert.deepEqual([program, genesis], [row.approvals, row.genesis], row.cluster);
  const other = row === DEVNET ? MAINNET : DEVNET;
  for (const seed of seeds) {
    const roles = rolesOf(seed, row);
    assert.equal(roles.pda.pda, derivePda(seed.groupKey, program), `${seed.name}: ${row.label}`);
    assert.equal(wasmShield(seed, roles, 1n, row).program, sdk.SHIELDED_POOL_PROGRAM_ID);
    const wrong = { ...row, genesis: other.genesis };
    assert.throws(() => wasmShield(seed, roles, 1n, wrong), /^Error: pins: /, "another genesis");
  }
}
assert.notEqual(rolesOf(seeds[0], MAINNET).pda.pda, rolesOf(seeds[0]).pda.pda, "another PDA");
step("guard.js names the programs and genesis hashes of the wasm rows; each row has its own PDA");

for (const seed of seeds) {
  for (const amount of [1n, 500_000_001n, 5_000_000_000n]) await sameShield(seed, amount, MAINNET);
}
step("the mainnet Add SOL deposit equals the SDK deposit for the PDA under 9mE7 (5 seeds)");

console.log("sol-sdk: ok");
process.exit(0);
