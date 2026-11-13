// Test of solspike/tools/plain_equiv.mjs. Usage: node solspike/test/plain-equiv.test.mjs
// 1. The committed wasm against itself gives no difference in any group of calls.
// 2. In the plain group, the pre-v1 wasm against the committed wasm gives only the
//    known differences:
//    a plain send to the new pool or registry id. The old build accepted a send of SOL there,
//    the new one refuses it with plain-recipient-reserved. A send of USDC was refused by both.
// 3. A build with a changed plain label is found.
// 4. The wasm of POOL_REF (the base of slice 8) against the committed wasm, in every group: only
//    the differences of EXPECTED, each one once. The smoke vectors of the tree are those of
//    POOL_REF in the new wire, with the same answers. The six ts-* vectors were made again from
//    vectors/ts after POOL_REF (CHECKER_PIN), so only their frame and answer are compared.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  POOL_REF,
  compareBuilds,
  gitShow,
  newIntent,
  newPins,
  smokeAt,
} from "../tools/plain_equiv.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMMITTED = path.join(ROOT, "web/sol/wasm");
// Parent of the v1 design record in this history (legacy ref 602127f3); keep its bytes pinned.
const OLD_COMMIT = "b6f9322ee4d00e4985c96de4e111cff80d842a3f";
assert.equal(createHash("sha256").update(gitShow(OLD_COMMIT, "web/sol/wasm/sol_wasm_bg.wasm"))
  .digest("hex"), "89281921b1470006c5df63f5377e06441f4b300d3f93b097439a66ba98eb3c73");

const same = await compareBuilds(COMMITTED, COMMITTED);
assert.ok(same.total > 4500, `only ${same.total} calls`);
assert.deepEqual(same.diffs.map((d) => d.tag), []);

const known = [];
for (const net of ["devnet", "mainnet"]) {
  for (const kind of ["s2-send-sol", "s3-send-usdc"]) {
    for (const id of ["ring1G", "regy3W"]) known.push(`${net}-${kind} to ${id} check`);
  }
}
const moved = await compareBuilds(OLD_COMMIT, COMMITTED, ["plain"]);
assert.deepEqual(moved.diffs.map((d) => d.tag).sort(), known.sort());
for (const d of moved.diffs) {
  assert.ok(d.new.includes("plain-recipient-reserved"), d.tag);
  assert.ok(!d.old.includes("plain-recipient-reserved"), d.tag);
  if (d.tag.includes("send-sol")) assert.ok(d.old.startsWith("accepted"), d.tag);
  assert.ok(d.new.startsWith("refused"), d.tag);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plain-equiv-test-"));
try {
  fs.copyFileSync(path.join(COMMITTED, "sol_wasm.js"), path.join(tmp, "sol_wasm.js"));
  const bytes = fs.readFileSync(path.join(COMMITTED, "sol_wasm_bg.wasm"));
  const at = bytes.indexOf("devnet-plain");
  assert.ok(at > 0, "label text not in the wasm");
  bytes[at] ^= 1;
  fs.writeFileSync(path.join(tmp, "sol_wasm_bg.wasm"), bytes);
  const changed = await compareBuilds(COMMITTED, tmp, ["plain"]);
  assert.ok(changed.diffs.some((d) => d.fn === "sol_wallet_label"), "a changed label is missed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const base = gitShow(POOL_REF, "web/sol/wasm/sol_wasm_bg.wasm");
assert.equal(createHash("sha256").update(base).digest("hex"),
  "60901305d22de1f4f68d5e8d0e85939dc5e7d4c8d58b6abcd545f77521fa1c60", "the wasm of POOL_REF");
assert.equal(base.length, 1_106_922);
const pool = await compareBuilds(POOL_REF, COMMITTED);
const added = ["sol_commit", "sol_echo", "sol_dkg3", "sol_digest"].map(
  (fn) => `label mainnet-private ${fn}`);
const wanted = ["rule_list", "sol_pool_wallet devnet", "sol_pool_wallet mainnet", ...added];
assert.deepEqual(pool.unexpected.map((d) => d.tag), [], "no difference outside EXPECTED");
assert.deepEqual(pool.diffs.map((d) => d.tag).sort(), wanted.sort());
assert.equal(pool.total, same.total, "both sides ran the same calls");

const { names, read } = smokeAt(POOL_REF);
const SMOKE = path.join(ROOT, "wasm-sol/vectors/smoke");
const tree = (name, ext) => fs.readFileSync(path.join(SMOKE, `${name}.${ext}`));
const genesis = Buffer.from(newPins(new Uint8Array(161))).subarray(162);
assert.equal(names.length, 34);
for (const name of names) {
  assert.deepEqual(tree(name, "answer"), Buffer.from(read(name, "answer")), name + ".answer");
  const pins = tree(name, "pins");
  assert.deepEqual([pins.length, pins[0]], [194, 1], name + ".pins: the Devnet wire");
  assert.deepEqual(pins.subarray(162), genesis, name + ".pins: the Devnet genesis");
  if (name.startsWith("ts-")) continue;
  assert.deepEqual(pins, Buffer.from(newPins(read(name, "pins"))), name + ".pins");
  const intent = Buffer.from(newIntent(read(name, "intent")));
  assert.deepEqual(tree(name, "intent"), intent, name + ".intent");
}
console.log(`plain-equiv test ok: ${same.total} calls, ${moved.diffs.length} known differences, ` +
  `${pool.diffs.length} expected differences against ${POOL_REF}`);
