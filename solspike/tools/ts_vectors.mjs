// Writes wasm-sol/vectors/ts and wasm-sol/vectors/ts2: confidential transfers and withdrawals of a
// group with an Ed25519 owner that the TS SDK builds offline. `ts` has fixed salts and small
// amounts, `ts2` has salts and blindings from a hash of the vector name, u64 edge amounts and
// three inputs. Every hash and ciphertext comes from the SDK of privacy-rings at 3c018b82.
// tests/ts_vectors.rs and tests/ts_edge.rs check the Rust recompute against them.
//
//   node solspike/tools/ts_vectors.mjs <Zolana repo> [out dir]
//
// The seeds and keys are test values written in this file. No network and no key of an account.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zolanaRepo } from "./paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2] ?? zolanaRepo());
const out = process.argv[3] ?? path.join(here, "../../wasm-sol/vectors");
const sdk = await import(`${repo}/sdk-libs/ts/dist/index.js`);
const tx = await import(`${repo}/sdk-libs/ts/dist/transaction/index.js`);
const kit = await import(`${repo}/node_modules/@solana/kit/dist/index.node.mjs`);
const { NullifierKey, ShieldedAddress, ShieldedPublicKey, ViewingKey } = sdk;
const { AssetRegistry, ConfidentialTransfer, ProofInputUtxo, SppProofInputs, Utxo } = tx;
const { createExternalData, encodeConfidentialSlots } = tx;
await sdk.initializePoseidon();

const SOL = "11111111111111111111111111111111";
const EXPIRY = 1_800_000_000n; // tests/common/mod.rs EXPIRY
const U64_MAX = 18_446_744_073_709_551_615n;
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const sha = (text) => createHash("sha256").update(text).digest();
const address = (bytes) => kit.getAddressDecoder().decode(bytes);

function ed25519Public(seedByte) {
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.alloc(32, seedByte),
  ]);
  const key = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  return Uint8Array.from(key.export({ format: "der", type: "spki" }).subarray(-32));
}

/** The viewing secret of a seed with the RFC 7748 clamp, as role_vectors.mjs writes it. */
function viewingSecret(seed) {
  const secret = Uint8Array.from(sha(`${seed}/viewing`));
  secret[0] &= 248;
  secret[31] = (secret[31] & 127) | 64;
  return secret;
}

/** The group: an Ed25519 owner key with a nullifier key and an X25519 viewing key. */
function groupOf(seed, keyByte) {
  const key = ed25519Public(keyByte);
  const secret = Uint8Array.from(sha(`${seed}/nullifier`).subarray(0, 31));
  const viewingSk = viewingSecret(seed);
  const nullifier = NullifierKey.fromSecret(secret);
  const viewing = ViewingKey.fromBytes(viewingSk);
  const owner = ShieldedAddress.fromPublicKeys(
    ShieldedPublicKey.fromEd25519(key),
    nullifier.publicKey(),
    viewing.publicKey(),
  );
  return { key, secret, viewingSk, nullifier, viewing, owner };
}

function payeeOf(byte) {
  const nullifier = NullifierKey.fromSecret(new Uint8Array(31).fill(byte));
  const viewing = ViewingKey.fromBytes(new Uint8Array(32).fill(0).fill(byte, 31));
  const signer = ed25519Public(byte);
  const owner = ShieldedAddress.fromPublicKeys(
    ShieldedPublicKey.fromEd25519(signer),
    nullifier.publicKey(),
    viewing.publicKey(),
  );
  return { signer, owner };
}

const tagOf = (tag) =>
  tag.kind === "account"
    ? { kind: "account", index: tag.index }
    : { kind: "inline", value: hex(tag.value) };

/** An input blinding: a field element of 31 bytes (the top byte is zero). */
const blindingOf = (text) => Uint8Array.from([0, ...sha(text).subarray(0, 31)]);

/** The proof inputs of one vector: the transfer of the SDK, finalized with its own salt. */
function proofOf(spec, group, mints) {
  const sponsor = address(ed25519Public(0x51));
  const inputs = spec.inputs.map(([mint, amount], i) => {
    const owner = ShieldedPublicKey.fromEd25519(group.key);
    const utxo = new Utxo({ owner, asset: mint, amount, blinding: spec.blinding(i) });
    return ProofInputUtxo.fromNullifierKey(utxo, group.nullifier);
  });
  const transfer = new ConfidentialTransfer(group.owner, inputs, sponsor);
  const payee = payeeOf(0x43 + spec.payeeShift);
  if (spec.withdraw) {
    const recipient = address(new Uint8Array(32).fill(0x33));
    transfer.withdraw(SOL, spec.withdraw, { kind: "sol", recipient });
  } else {
    transfer.send(payee.owner, spec.send[0], spec.send[1]);
  }
  const prepared = transfer.prepare();
  const txKey = group.viewing.transactionViewingKey(prepared.firstNullifier);
  const registry = new AssetRegistry(mints.map((m) => [m.assetId, m.address]));
  const open = prepared.finalize({
    txViewingPublicKey: txKey.publicKey(),
    salt: spec.salt,
    payload: encodeConfidentialSlots(prepared.outputs, registry, txKey, spec.salt),
  });
  const proof = new SppProofInputs({
    payer: open.payer,
    inputUtxos: open.inputUtxos,
    outputs: open.outputs,
    externalData: createExternalData({ ...open.externalData, expiryUnixTs: EXPIRY }),
    blindingSeed: open.blindingSeed,
    outputTreeId: open.outputTreeId,
  });
  const txViewingPk = txKey.publicKey().toBytes();
  txKey.destroy();
  return { proof, inputs, payee, txViewingPk, sponsor };
}

/** One vector in the layout that tests/common/ts.rs reads. */
function vector(spec, seed, keyByte, mint) {
  const group = groupOf(seed, keyByte);
  const mints = [{ address: mint.address, assetId: mint.assetId }];
  const { proof, inputs, payee, txViewingPk, sponsor } = proofOf(spec, group, mints);
  const ids = new Map([[SOL, 1n], [mint.address, mint.assetId]]);
  const own = hex(group.owner.signingPublicKey.toBytes());
  const outputs = proof.outputs.map((o, i) => {
    const published = proof.externalData.outputs[i];
    let role = "dummy";
    if (!o.isDummy()) {
      role = hex(o.ownerAddress.signingPublicKey.toBytes()) === own ? "change" : "payee";
    }
    return {
      role,
      mint: o.asset,
      assetId: String(ids.get(o.asset)),
      amount: o.amount.toString(),
      blinding: hex(o.blinding),
      utxoHash: hex(published.utxoHash),
      ownerTag: tagOf(published.ownerTag),
      data: hex(published.data),
    };
  });
  return {
    name: spec.name,
    group: {
      key: hex(group.key),
      payer: hex(kit.getAddressEncoder().encode(sponsor)),
      nullifierSecret: hex(group.secret),
      viewingSk: hex(group.viewingSk),
      nullifierPk: hex(group.owner.nullifierPublicKey),
      viewingPk: hex(group.owner.viewingPublicKey.toBytes()),
      ownerHash: hex(group.owner.ownerHash()),
    },
    payee: {
      address: hex(payee.owner.toBytes()),
      key: hex(payee.signer),
      ownerHash: hex(payee.owner.ownerHash()),
    },
    mint: {
      address: hex(kit.getAddressEncoder().encode(mint.address)),
      assetId: String(mint.assetId),
    },
    salt: hex(spec.salt),
    blindingSeed: hex(proof.blindingSeed),
    txViewingPk: hex(txViewingPk),
    inputs: inputs.map((input, i) => ({
      mint: spec.inputs[i][0],
      amount: spec.inputs[i][1].toString(),
      blinding: hex(input.utxo.blinding),
      utxoHash: hex(input.hash()),
      nullifier: hex(input.nullifier()),
    })),
    withdraw: spec.withdraw ? spec.withdraw.toString() : null,
    outputs,
  };
}

// Two SPL mints of the Devnet asset table of the wasm (wasm-sol/src/assets.rs), with their ids.
const SPL1 = "ETzu3EpvF7Jqz5ZWng4QANZDvogjgcveRmztm2mb8Xss";
const SPL2 = "5d2KjyaU2mfRuUqiJWV8MzCzzfkSt2fg81zS9QTdXjQj";

/** ts: fixed salt and input blindings 0x7000 + index, small amounts. */
const fixed = (name, inputs, action) => ({
  name,
  inputs,
  ...action,
  payeeShift: 0,
  salt: Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i),
  blinding: (i) => Uint8Array.from({ length: 32 }, (_, k) => (k === 30 ? 0x70 : k === 31 ? i : 0)),
});

/** ts2: salt and blindings from a hash of the name, so the files are the same on every run. */
const edge = (name, inputs, action) => ({
  name,
  inputs,
  ...action,
  payeeShift: 0x10,
  salt: Uint8Array.from(sha(`${name}/salt`).subarray(0, 16)),
  blinding: (i) => blindingOf(`${name}/blinding/${i}`),
});

const SET_TS = [
  fixed("transfer-sol", [[SOL, 100n]], { send: [SOL, 40n] }),
  fixed("transfer-spl", [[SPL1, 1000n]], { send: [SPL1, 300n] }),
  fixed("transfer-everything-with-dummy", [[SOL, 100n]], { send: [SOL, 100n] }),
  fixed("transfer-sol-and-spl-with-dummy", [[SOL, 100n], [SPL1, 50n]], { send: [SPL1, 20n] }),
  fixed("withdraw-with-dummy", [[SOL, 100n]], { withdraw: 30n }),
  fixed("withdraw-everything-zero-change", [[SOL, 100n]], { withdraw: 100n }),
];
const SET_TS2 = [
  edge("v-big-sol", [[SOL, 2n ** 63n + 2n]], { send: [SOL, 2n ** 62n] }),
  edge("v-max-spl", [[SPL2, U64_MAX]], { send: [SPL2, U64_MAX - 1n] }),
  edge("v-sol-all-in", [[SOL, 31337n]], { send: [SOL, 31337n] }),
  edge("v-three-inputs", [[SOL, 1_000_000_007n], [SPL2, 77_777n], [SOL, 5n]], {
    send: [SOL, 999_999_999n],
  }),
  edge("v-withdraw", [[SOL, 2_000_000_000n]], { withdraw: 1_234_567_891n }),
];

function write(sub, set, keyByte, mint) {
  mkdirSync(path.join(out, sub), { recursive: true });
  for (const spec of set) {
    const v = vector(spec, `zigs-sol ts vectors: ${sub}`, keyByte, mint);
    writeFileSync(path.join(out, sub, `${spec.name}.json`), `${JSON.stringify(v, null, 1)}\n`);
    console.log(sub, spec.name, v.outputs.map((o) => `${o.role}:${o.amount}`).join(" "));
  }
}
write("ts", SET_TS, 0x65, { address: SPL1, assetId: 2n });
write("ts2", SET_TS2, 0x66, { address: SPL2, assetId: 7n });
