// Test of solspike/tools/plain_equiv.mjs. Usage: node solspike/test/plain-equiv.test.mjs
// 1. The committed wasm against itself gives no difference.
// 2. The wasm of commit 602127f3 against the committed wasm gives only the known differences:
//    a plain send to the new pool or registry id. The old build accepted a send of SOL there,
//    the new one refuses it with plain-recipient-reserved. A send of USDC was refused by both.
// 3. A build with a changed plain label is found.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareBuilds } from "../tools/plain_equiv.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const COMMITTED = path.join(ROOT, "web/sol/wasm");
const OLD_COMMIT = "602127f3";

const same = await compareBuilds(COMMITTED, COMMITTED);
assert.ok(same.total > 1000, `only ${same.total} calls`);
assert.deepEqual(same.diffs.map((d) => d.tag), []);

const known = [];
for (const net of ["devnet", "mainnet"]) {
  for (const kind of ["s2-send-sol", "s3-send-usdc"]) {
    for (const id of ["ring1G", "regy3W"]) known.push(`${net}-${kind} to ${id} check`);
  }
}
const moved = await compareBuilds(OLD_COMMIT, COMMITTED);
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
  const changed = await compareBuilds(COMMITTED, tmp);
  assert.ok(changed.diffs.some((d) => d.fn === "sol_wallet_label"), "a changed label is missed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`plain-equiv test ok: ${same.total} calls, ${moved.diffs.length} known differences`);
