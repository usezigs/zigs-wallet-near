// Checks of the vendored web prover (SOL-4). Usage: node solspike/test/prover-files.test.mjs
// Every file of web/sol/prover equals its line in web/sol/prover/SHA256SUMS, no file is missing or
// extra, and the threads runtime is not there. The runtime files equal the manifest of the
// package. The dist names the key folder that localprover.js, the /sol policy of cf/src/index.js
// and the policy check of session.js allow. The prover table holds the zopro key of each of our 7
// circuits with the gnark digest that the SDK pins. POOL_DATA is the ProgramData PDA of ring1G.
// With ZIGS_PROVER_TARBALL (the npm tarball) and ZIGS_PROVER_FIXTURE (fixtures/transfer-1x2.json
// of the same commit), vendor-prover.mjs rebuilds every file into a temporary folder and must
// give the same bytes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_SHA256, vendorProver } from "../vendor-prover.mjs";

const DIR = new URL("../../web/sol/prover/", import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const step = (name) => console.log(`ok  ${name}`);

const sums = Object.fromEntries(
  read("SHA256SUMS")
    .toString()
    .trim()
    .split("\n")
    .map((line) => line.split("  ").reverse()),
);
const onDisk = readdirSync(DIR, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS")
  .map((entry) => join(entry.parentPath, entry.name).slice(DIR.pathname.length));
assert.deepEqual(Object.keys(sums).sort(), onDisk.sort(), "SHA256SUMS lists other files");
for (const [name, hash] of Object.entries(sums)) assert.equal(sha256(read(name)), hash, name);
assert.equal(
  onDisk.filter((name) => name.startsWith("runtime/threads/")).length,
  0,
  "the threads runtime is vendored",
);
step("every file of web/sol/prover equals its SHA-256 in SHA256SUMS, and no file is extra");

const manifest = JSON.parse(read("runtime/manifest.json"));
const present = manifest.files.filter((file) => onDisk.includes(`runtime/${file.path}`));
assert.equal(present.length, 4, "the single runtime and its licenses are in the manifest");
for (const file of present) {
  const bytes = read(`runtime/${file.path}`);
  assert.deepEqual([bytes.length, sha256(bytes)], [file.size, file.sha256], file.path);
}
step("the files of the single-thread runtime equal the manifest of the package");

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const FOLDER = /(https:\/\/d3gbdb0egjwcw9\.cloudfront\.net\/proving-keys\/[0-9a-f]{16}\/)/;
const dist = await import(new URL("index.js", DIR).href);
const { KEY_DIGESTS } = await import(new URL("key-digests.js", DIR).href);
const folderOf = (text) => FOLDER.exec(text)?.[1];
const folders = {
  worker: folderOf(source("web/sol/localprover.js")),
  policy: folderOf(source("cf/src/index.js")),
  page: folderOf(source("web/sol/session.js")),
};
for (const [where, folder] of Object.entries(folders)) {
  assert.equal(folder, dist.KEY_BASE_URL, `the key folder of ${where}`);
}
assert.equal(typeof dist.SprWebProver, "function", "the dist exports no SprWebProver");
step("the dist, the Worker, the /sol policy and the page name one key folder");

// The gnark digests of the SDK pin (sdk-libs/ts/src/interface/proving-keys.ts at 3c018b82).
const SDK_PINS = {
  1: "c0b5c1a1081136911a6ad5496fb989ed26d85b09e983a4d5048cff96e0833d85",
  2: "51380b1264737ebd4d31f40ebf6874db039078ce998d4fa187c049ace99798bb",
  3: "72379691c3b515ff939a9e57fa52204489bdae376642a4e675c0b8830118b097",
  4: "d9298a68c83261700a4d3eab6a1922aab19e625a843d9df50628c3ec86e43aee",
  5: "c5dfa2067fec93936aef24b748378516c40ef0a4f6987118e36285893864d45a",
  6: "226387d770058209d40029988d6f3ab154c42a0802ee066284db4c8db886ca40",
  8: "b64dcce8e5a55ae0f120bd32118f5bfdaf88f48bb3a3860e9cae9bac1611135e",
};
const shapes = dist.TRANSFER_SHAPES.filter((s) => s.outputs === 2).map((s) => s.inputs);
let total = 0;
for (const [n, pin] of Object.entries(SDK_PINS)) {
  assert.ok(shapes.includes(Number(n)), `no ${n}x2 key`);
  const entry = KEY_DIGESTS[`transfer_confidential_${n}_2.key`];
  assert.equal(entry.file, `transfer_confidential_${n}_2.zopro`);
  assert.equal(entry.keySha256, pin, `the gnark digest of ${n}x2 differs from the SDK pin`);
  total += entry.size;
}
assert.equal(total, 166_230_079, "the key sizes differ from zolana-v1.md 2.4");
const checkout = join(
  homedir(),
  ".cache/zigs/upstream/privacy-rings/sdk-libs/ts/src/interface/proving-keys.ts",
);
if (existsSync(checkout)) {
  const text = readFileSync(checkout, "utf8");
  for (const pin of Object.values(SDK_PINS)) assert.ok(text.includes(pin), "pin not in the SDK");
  step("the 7 gnark digests of the prover table equal the pins of the SDK source");
} else {
  console.log("skip the SDK source check: no checkout at ~/.cache/zigs/upstream/privacy-rings");
}

const fixture = JSON.parse(read("selftest-1x2.json"));
assert.equal(sha256(read("selftest-1x2.json")), FIXTURE_SHA256);
assert.deepEqual([fixture.circuitType, fixture.nInputs, fixture.nOutputs], [
  "transfer-confidential",
  1,
  2,
]);
step("the request of the device check is the pinned 1x2 confidential transfer");

// The ProgramData account of an upgradeable program is the PDA of its id under the loader. The
// loader makes the program account name exactly this address. Base58 and the Ed25519 off-curve
// test are written out here so that the check needs no package.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fromBase58 = (text) => {
  let n = 0n;
  for (const ch of text) n = n * 58n + BigInt(ALPHABET.indexOf(ch));
  const hex = n === 0n ? "" : n.toString(16);
  const zeros = text.length - text.replace(/^1+/, "").length;
  const even = hex.padStart(hex.length + (hex.length % 2), "0");
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(even, "hex")]);
};
const toBase58 = (bytes) => {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let text = "";
  for (; n > 0n; n /= 58n) text = ALPHABET[Number(n % 58n)] + text;
  return "1".repeat(bytes.findIndex((b) => b !== 0)) + text;
};
const P = 2n ** 255n - 19n;
const power = (base, exp) => {
  let out = 1n;
  for (let b = base % P; exp > 0n; exp >>= 1n, b = (b * b) % P) if (exp & 1n) out = (out * b) % P;
  return out;
};
const D = (P - 121665n) * power(121666n, P - 2n) % P;
function onCurve(bytes) {
  const y = BigInt(`0x${Buffer.from(bytes).reverse().toString("hex")}`) & ((1n << 255n) - 1n);
  if (y >= P) return false;
  const u = (y * y - 1n + P) % P;
  const x2 = (u * power((D * y * y + 1n) % P, P - 2n)) % P;
  return x2 === 0n || power(x2, (P - 1n) / 2n) === 1n;
}
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
function programData(id) {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = createHash("sha256")
      .update(fromBase58(id))
      .update(Uint8Array.of(bump))
      .update(fromBase58(LOADER))
      .update("ProgramDerivedAddress")
      .digest();
    if (!onCurve(hash)) return toBase58(hash);
  }
  throw new Error("no bump");
}
const OLD_POOL = "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6";
assert.equal(programData(OLD_POOL), "ACEAhi1f3WaD49cTN5yUAULmwytoQjp6MTVfaWaQAqKw", "old pin");
const NEW_POOL = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const derived = programData(NEW_POOL);
assert.equal(derived, "CMV9fRyA66cwi1ce4bynyXR9zDU7f99gXZWCUNesp8xr");
assert.ok(source("web/sol/localprover.js").includes(`POOL_DATA = "${derived}"`), "POOL_DATA");
step("POOL_DATA is the ProgramData PDA of ring1G (the derivation also gives the old pin)");

const tarball = process.env.ZIGS_PROVER_TARBALL;
const request = process.env.ZIGS_PROVER_FIXTURE;
if (tarball && request) {
  const out = mkdtempSync(join(tmpdir(), "zigs-prover-test-"));
  try {
    vendorProver({ tarball, fixture: request, out });
    assert.equal(read("SHA256SUMS").toString(), readFileSync(join(out, "SHA256SUMS"), "utf8"));
    step("vendoring from the pinned tarball gives the same bytes");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
} else {
  console.log("skip the vendor check: set ZIGS_PROVER_TARBALL and ZIGS_PROVER_FIXTURE");
}
console.log("prover file tests passed");
