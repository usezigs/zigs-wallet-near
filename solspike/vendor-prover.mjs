// Vendors the web prover of Helius (SOL-4, local proving) into web/sol/prover/. The source is the
// npm tarball of @heliuslabs/spr-web-prover at PROVER_VERSION (git head 087bc04), checked against
// its npm integrity before any file is read. The dist files are served as they are, without the
// threads runtime: the page is not cross-origin isolated, so the prover runs with threads: 0.
// The 1x2 request of the device check comes from fixtures/transfer-1x2.json of the same commit.
// Usage: node solspike/vendor-prover.mjs <tarball> <transfer-1x2.json> [--out DIR]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROVER_VERSION = "0.7.0-alpha";
export const PROVER_INTEGRITY =
  "sha512-wkg85YuhR5c3QvMv2kQf4StRedZRDyfhOOuvqo1D9q42wsonCDqegVTQnCQYbLvhHF0/kl3jL8TsFvtAkWIbOw==";
export const FIXTURE_SHA256 = "d05cbed6fc599a0aeeb2968ca1d0bd7a38cdfb3a716af7ee76da873fd85a291b";
export const FIXTURE = "selftest-1x2.json";
/** The files of the single-thread runtime, from the package folder `dist/runtime`. */
export const RUNTIME = [
  "runtime/single/zopro_spr.js",
  "runtime/single/zopro_spr_bg.wasm",
  "runtime/manifest.json",
  "runtime/LICENSE-APACHE",
  "runtime/LICENSE-MIT",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The dist files that the page serves: every .js file of dist, the runtime files, the license. */
export function distFiles(dist) {
  const modules = readdirSync(dist).filter((name) => name.endsWith(".js"));
  return [...modules, ...RUNTIME, "LICENSE"].sort();
}

/** Throws unless the tarball has the pinned npm integrity. */
export function checkIntegrity(tarball) {
  const got = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
  if (got !== PROVER_INTEGRITY) throw new Error(`the tarball has the integrity ${got}`);
}

/** Copies the files of the tarball and the fixture into `out`, and writes SHA256SUMS. */
export function vendorProver({ tarball, fixture, out }) {
  checkIntegrity(tarball);
  const request = readFileSync(fixture);
  if (sha256(request) !== FIXTURE_SHA256) throw new Error("the 1x2 request is not the pinned one");
  const work = mkdtempSync(join(tmpdir(), "zigs-prover-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", work, "package/dist", "package/package.json"]);
    const pkg = JSON.parse(readFileSync(join(work, "package/package.json"), "utf8"));
    if (pkg.version !== PROVER_VERSION) throw new Error(`the package is ${pkg.version}`);
    const dist = join(work, "package/dist");
    rmSync(out, { recursive: true, force: true });
    for (const name of distFiles(dist)) {
      mkdirSync(dirname(join(out, name)), { recursive: true });
      cpSync(join(dist, name), join(out, name));
    }
    writeFileSync(join(out, FIXTURE), request);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const files = [...readdirSync(out, { recursive: true, withFileTypes: true })]
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(out.length + 1))
    .sort();
  const lines = files.map((name) => `${sha256(readFileSync(join(out, name)))}  ${name}\n`);
  writeFileSync(join(out, "SHA256SUMS"), lines.join(""));
  return files;
}

function cli() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = resolve(at < 0 ? join(HERE, "../web/sol/prover") : args[at + 1]);
  const [tarball, fixture] = at < 0 ? args : args.toSpliced(at, 2);
  if (!tarball || !fixture) throw new Error("usage: vendor-prover.mjs <tarball> <request.json>");
  const files = vendorProver({ tarball: resolve(tarball), fixture: resolve(fixture), out });
  console.log(`vendored ${files.length} files of ${PROVER_VERSION} into ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    cli();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
