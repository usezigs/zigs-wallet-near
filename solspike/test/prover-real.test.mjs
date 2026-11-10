// One real 1x2 proof in process (SOL-4). Opt in with ZIGS_REAL_PROOF=1; it takes about 10 s of
// CPU and 1 GB of memory, so run it through heavy.sh:
//   ZIGS_REAL_PROOF=1 ~/.config/zigs/heavy.sh node solspike/test/prover-real.test.mjs
// It runs the vendored single-thread runtime (web/sol/prover/runtime/single) with the pinned 1_2
// zopro key from ~/.cache/zigs/zopro/78751f5d1c591777/ (download it once from the key folder and
// it is checked by its SHA-256 here), proves the pinned upstream request, and verifies the proof.
// A changed publicInputHash must not verify. The vendored fetch shim then answers a POST to the
// loopback prove URL with the same prover, and refuses a key that differs from the request.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SKIP = (why) => {
  console.log(`skip the real proof: ${why}`);
  process.exit(0);
};
if (process.env.ZIGS_REAL_PROOF !== "1") SKIP("set ZIGS_REAL_PROOF=1 (run it through heavy.sh)");

const PROVER = new URL("../../web/sol/prover/", import.meta.url);
const KEY_FILE = "transfer_confidential_1_2.zopro";
const KEY_PATH = join(homedir(), ".cache/zigs/zopro/78751f5d1c591777", KEY_FILE);
const KEY_URL = "https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/78751f5d1c591777/" + KEY_FILE;
const LOOPBACK = "http://127.0.0.1:3001";
const step = (name) => console.log(`ok  ${name}`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (!existsSync(KEY_PATH)) SKIP(`no key at ${KEY_PATH}; GET ${KEY_URL} once (6,867,248 bytes)`);
const { KEY_DIGESTS } = await import(new URL("key-digests.js", PROVER).href);
const pin = KEY_DIGESTS["transfer_confidential_1_2.key"];
const key = readFileSync(KEY_PATH);
assert.equal(key.length, pin.size, "the cached key has another size");
assert.equal(sha256(key), pin.sha256, "the cached key does not equal its pinned SHA-256");

const runtime = await import(new URL("runtime/single/zopro_spr.js", PROVER).href);
runtime.initSync({ module: readFileSync(new URL("runtime/single/zopro_spr_bg.wasm", PROVER)) });
const prover = new runtime.SprProver(new Uint8Array(key));
assert.equal(prover.digest(), pin.keySha256, "the gnark digest differs from the SDK pin");
const request = readFileSync(new URL("selftest-1x2.json", PROVER), "utf8");

const result = await prover.prove(request);
const proof = JSON.parse(result.proof);
assert.deepEqual(Object.keys(proof).sort(), ["ar", "bs", "krs", "provingKeySha256"]);
assert.equal(proof.provingKeySha256, pin.keySha256);
assert.equal(prover.verify(request, result.proof), true, "the proof does not verify");
step("the upstream 1x2 request proves with the pinned zopro key and verifies");

// verify binds the publicInputHash input: a changed value fails.
const other = { ...JSON.parse(request), publicInputHash: `0x${"1".padStart(64, "0")}` };
const changed = JSON.stringify(other);
assert.equal(prover.verify(changed, result.proof), false, "a changed publicInputHash verifies");
step("a changed publicInputHash does not verify");

const { createProverFetch } = await import(new URL("prover-fetch.js", PROVER).href);
const noNetwork = async (input) => assert.fail(`the shim passed ${String(input)} on`);
const shim = createProverFetch({
  proverUrl: LOOPBACK,
  fetch: noNetwork,
  prove: async (body) => ({ proof: (await prover.prove(body)).proof }),
});
const post = (path, body) =>
  shim(`${LOOPBACK}/prove/${path}`, { method: "POST", body, headers: { "x-sync": "true" } });
const reply = await post("transfer_confidential_1_2", request);
assert.equal(reply.status, 200);
const again = await reply.json();
assert.equal(prover.verify(request, JSON.stringify(again)), true);
const wrong = await post("transfer_confidential_2_2", request);
assert.deepEqual([wrong.status, (await wrong.json()).code], [500, "wasm_invalid_request"]);
const status = await shim(`${LOOPBACK}/prove/status`, { method: "POST", body: request });
assert.equal(status.status, 500, "an unsupported prove route was answered");
step("the loopback prove URL is answered by the shim, and a key that differs is refused");
prover.free();
console.log("real proof test passed");
