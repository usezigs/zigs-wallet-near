// pool_run.mjs on recorded Devnet replies (solspike/test/fixtures/pool-run): no network.
// Usage: node solspike/test/pool-run.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POOL,
  base58Decode,
  base58Encode,
  formatTable,
  makeRpc,
  parseTransaction,
  readRun,
} from "../tools/pool_run.mjs";

const DIR = new URL("./fixtures/pool-run/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8"));
const DEPOSIT =
  "5QTXTxt9PqyyYJniD4Z7ofVdzFFEypaiLcvkcUqPZoSVU6kDjYu8wdWvcQQc2HiXBpAa71AdWQpm9NerMrSy28xK";
const TRANSACT =
  "3ssfkq23v8SSbo1XsAVAzuittztabYS1nBZ2GH39gwCf6rnTTNrymAUiHxxCUYtwypqBRJ2AbAaVEHUMmdA73cfi";
const TWO =
  "3KWCZQ5LdAPMWNViaSrRxbrnjj2JAzj8KjQXF7fxXA36Jf5cW64VnM2zHFe7g1UiA6sjPLE19nar4dPsvUYECLrL";
const UPGRADE =
  "4LDBkBUvymHT9vhdW5oCX9mpT6Bwg4c1A78uYwT1FNdAScjztTBW5uXC7oQfBYddBFda6vTfYqquaj63diaP7jgY";
const APPROVALS = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";

// A replay of the recorded replies in place of the network.
const replay = async (method, [what]) =>
  load(method === "getSignaturesForAddress" ? `addr-${what}` : what);

assert.equal(base58Encode(base58Decode(POOL)), POOL, "base58 round trip");
assert.equal(base58Encode(base58Decode("1".repeat(32))), "1".repeat(32), "leading zeros");
assert.throws(() => base58Decode("0OIl"), /bad character/);
assert.throws(() => makeRpc("helius"), /devnet or mainnet/);

const extraNames = { [APPROVALS]: "approvals" };
const [deposit, transact, two, upgrade] = await readRun(
  replay,
  { signatures: [DEPOSIT, TRANSACT, TWO, UPGRADE] },
  { extraNames },
);

const poolKinds = (row) => row.instructions.filter((i) => i.program === "pool").map((i) => i.kind);
assert.deepEqual(poolKinds(deposit), ["deposit", "deposit", "emit-event", "emit-event"]);
assert.deepEqual(poolKinds(transact), ["transact", "emit-event"]);
assert.deepEqual(
  [transact.slot, transact.status, transact.fee, transact.computeUnits, transact.time],
  [520887227, "ok", 10560, 142205, "2026-11-10T22:05:58.000Z"],
);
assert.deepEqual(transact.programs, [
  { program: "pool", top: 1, inner: 1 },
  { program: "system", top: 0, inner: 2 },
]);
assert.deepEqual(
  deposit.programs.map((p) => p.program),
  ["compute-budget", "registry", "pool", "system", "token"],
);
assert.deepEqual(
  deposit.instructions.filter((i) => i.program === "compute-budget").map((i) => i.kind),
  ["set-unit-limit", "set-unit-price"],
);

assert.deepEqual(transact.created.map((c) => c.kind), ["nullifier-pda"]);
assert.equal(two.created.length, 2, "two inputs make two nullifier PDAs");
assert.ok(two.created.every((c) => c.kind === "nullifier-pda" && c.lamports === 706120));
assert.deepEqual(deposit.created.map((c) => [c.kind, c.space]), [["registry-account", 100]]);
const gain = transact.balanceChanges.find((b) => b.account === transact.created[0].account);
assert.deepEqual([gain.delta, gain.new], [706120, true]);
assert.ok(transact.balanceChanges.every((b) => b.delta !== 0), "only real changes");

// The approvals program is an account of the upgrade, and the loader is the only program run.
const upgraded = { where: "top", index: 0, program: "loader", kind: "upgrade" };
assert.deepEqual(upgrade.instructions, [upgraded]);
assert.deepEqual(upgrade.named, ["approvals"]);
assert.equal(upgrade.created.length, 0);

// A failed transaction keeps its error.
const failed = load(TRANSACT);
failed.meta.err = { InstructionError: [0, { Custom: 7 }] };
const row = parseTransaction("sig", failed);
assert.equal(row.status, "failed");
assert.match(formatTable([row]), /failed \{"InstructionError":\[0,\{"Custom":7\}\]\}/);

// An address and a count: the list is the recorded one, each transaction is a recorded one.
const calls = [];
const listing = async (method, params) => {
  calls.push([method, params[1]?.limit]);
  return method === "getSignaturesForAddress" ? load(`addr-${POOL}`) : load(TRANSACT);
};
const listed = await readRun(listing, { address: POOL, count: 12 });
assert.equal(listed.length, 12);
assert.deepEqual(calls[0], ["getSignaturesForAddress", 12]);

// A pruned transaction is an error, not an empty row.
await assert.rejects(readRun(async () => null, { signatures: ["x"] }), /not found/);

const table = formatTable([deposit, transact, upgrade]);
assert.match(table, /pool:deposit/);
assert.match(table, /loader:upgrade/);
assert.match(table, /created .* nullifier-pda/);
console.log("pool-run: ok");
