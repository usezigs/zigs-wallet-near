// Proves that two builds of the checker wasm answer the same for the plain wallet.
// Usage: node solspike/tools/plain_equiv.mjs <old> <new>
// Each side is a git ref (its web/sol/wasm files are read with git show), a directory with
// sol_wasm.js and sol_wasm_bg.wasm, or a path to a .wasm file (its sol_wasm.js sits beside it).
// Every plain export runs on the same inputs: the vectors of wasm-sol/vectors/plain, 840 damaged
// copies of them (fixed seed), the plain labels, the plain rule list and the sends to the ids of
// the Zolana pool and registry. The tool prints each difference with its input.
// Exit code: 0 when every answer is byte-equal, 1 when one differs, 2 on a usage error.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const VECTORS = path.join(ROOT, "wasm-sol/vectors/plain");
const WASM_DIR = "web/sol/wasm";
const EXT = ["msg", "intent", "pins", "chain"];
const ZERO_SECRET = JSON.stringify({ secret: "00".repeat(32) });
const SEND_IDS = [
  "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW",
  "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ",
  "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6",
  "regyS5rkAcw2YzDJCmTwCTHs2s246FXxbmuRZ42u2PD",
];
const SEND_VECTORS = ["mainnet-s2-send-sol", "mainnet-s3-send-usdc", "devnet-s2-send-sol",
  "devnet-s3-send-usdc"];
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Copies the glue and the wasm of one build into dir. A ref, a directory or a .wasm path. */
export function stageBuild(spec, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const glue = path.join(dir, "sol_wasm.mjs");
  const wasm = path.join(dir, "sol_wasm_bg.wasm");
  if (fs.existsSync(spec)) {
    const base = spec.endsWith(".wasm") ? path.dirname(spec) : spec;
    fs.copyFileSync(path.join(base, "sol_wasm.js"), glue);
    fs.copyFileSync(spec.endsWith(".wasm") ? spec : path.join(base, "sol_wasm_bg.wasm"), wasm);
    return glue;
  }
  const show = (f) => execFileSync("git", ["show", `${spec}:${WASM_DIR}/${f}`],
    { cwd: ROOT, maxBuffer: 1 << 27 });
  fs.writeFileSync(glue, show("sol_wasm.js"));
  fs.writeFileSync(wasm, show("sol_wasm_bg.wasm"));
  return glue;
}

async function load(spec, dir) {
  const glue = stageBuild(spec, dir);
  const mod = await import(pathToFileURL(glue).href);
  mod.initSync({ module: fs.readFileSync(path.join(dir, "sol_wasm_bg.wasm")) });
  return mod;
}

// A null first argument of plain_check_message means: the message that this build compiles.
function call(w, fn, args) {
  try {
    const msg = args[0] === null ? w.plain_compile_message(args[1], args[2]) : args[0];
    const a = [msg, ...args.slice(1)];
    const r = w[fn](...a);
    if (r instanceof Uint8Array) return "bytes:" + Buffer.from(r).toString("hex");
    return String(r);
  } catch (e) {
    return "THROW:" + (e?.message ?? e);
  }
}

function readVector(name) {
  const get = (e) => new Uint8Array(fs.readFileSync(path.join(VECTORS, `${name}.${e}`)));
  return Object.fromEntries(EXT.map((e) => [e, get(e)]));
}

function vectorCases(name, v) {
  const t = (s) => `${name} ${s}`;
  return [
    [t("check"), "plain_check_message", [v.msg, v.intent, v.pins, v.chain]],
    [t("compile"), "plain_compile_message", [v.intent, v.pins]],
    [t("reads"), "plain_reads", [v.intent, v.pins]],
    [t("digest"), "sol_plain_digest", [v.pins, v.msg]],
    [t("fee_sign"), "sol_plain_fee_sign", [v.msg, v.intent, v.pins, v.chain, ZERO_SECRET]],
    [t("sign_share"), "sol_plain_sign_share", [v.msg, v.intent, v.pins, v.chain, ZERO_SECRET]],
  ];
}

function xorshift() {
  let st = 0x9e3779b97f4a7c15n;
  const M = (1n << 64n) - 1n;
  return () => {
    st ^= (st << 13n) & M;
    st ^= st >> 7n;
    st ^= (st << 17n) & M;
    return Number(st % (1n << 32n));
  };
}

function damage(base, k, next) {
  const x = base.map((b) => b.slice());
  const w = next() % 4;
  if (k % 2) x[w] = x[w].slice(0, next() % (x[w].length + 1));
  else if (x[w].length) x[w][next() % x[w].length] ^= 1 << (next() % 8);
  return x;
}

function damagedCases(name, v, next) {
  const out = [];
  for (let k = 0; k < 40; k++) {
    const x = damage(EXT.map((e) => v[e]), k, next);
    out.push([`${name} damaged${k}`, "plain_check_message", x]);
  }
  return out;
}

function decodeB58(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  return Uint8Array.from(Buffer.from(n.toString(16).padStart(64, "0"), "hex"));
}

function replaceAll(buf, from, to) {
  const out = Buffer.from(buf);
  for (let i = out.indexOf(from); i >= 0; i = out.indexOf(from, i + 32)) {
    Buffer.from(to).copy(out, i);
  }
  return new Uint8Array(out);
}

// A send intent is tag 14 (SOL) or 15 (token): tag, 4 bytes, 32 bytes, [1 byte], recipient.
function sendCases(name, v) {
  const off = v.intent[0] === 14 ? 37 : 38;
  const rec = v.intent.slice(off, off + 32);
  const out = [];
  for (const id of SEND_IDS) {
    const to = decodeB58(id);
    const intent = Uint8Array.from(v.intent);
    intent.set(to, off);
    const chain = replaceAll(v.chain, rec, to);
    out.push([`${name} to ${id.slice(0, 6)} compile`, "plain_compile_message", [intent, v.pins]]);
    out.push([`${name} to ${id.slice(0, 6)} check`, "plain_check_message",
      [null, intent, v.pins, chain]]);
  }
  return out;
}

function labelCases() {
  const out = [["plain_rule_list", "plain_rule_list", []]];
  for (const c of ["devnet", "mainnet"]) {
    out.push([`wallet_label ${c} plain`, "sol_wallet_label", [c, "plain"]]);
    out.push([`wallet_program_label ${c} plain`, "sol_wallet_program_label", [c, "plain"]]);
  }
  return out;
}

/** Every plain call as [tag, export name, args]. */
export function buildCases() {
  const names = fs.readdirSync(VECTORS).filter((f) => f.endsWith(".msg"))
    .map((f) => f.slice(0, -4)).sort();
  const next = xorshift();
  const out = labelCases();
  for (const name of names) {
    const v = readVector(name);
    out.push(...vectorCases(name, v), ...damagedCases(name, v, next));
    if (SEND_VECTORS.includes(name)) out.push(...sendCases(name, v));
  }
  return out;
}

/** Runs every case on both builds. Returns the count and the list of differences. */
export async function compareBuilds(oldSpec, newSpec) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plain-equiv-"));
  try {
    const oldW = await load(oldSpec, path.join(tmp, "old"));
    const newW = await load(newSpec, path.join(tmp, "new"));
    const cases = buildCases();
    const diffs = [];
    for (const [tag, fn, args] of cases) {
      const o = call(oldW, fn, args);
      const n = call(newW, fn, args);
      if (o !== n) diffs.push({ tag, fn, args, old: o, new: n });
    }
    return { total: cases.length, diffs };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const hex = (a) => (a instanceof Uint8Array ? Buffer.from(a).toString("hex") : JSON.stringify(a));

function report(d) {
  console.log(`DIFF ${d.tag} (${d.fn})`);
  d.args.forEach((a, i) => console.log(`  input ${i}: ${hex(a)}`));
  console.log(`  old: ${d.old}`);
  console.log(`  new: ${d.new}`);
}

async function main() {
  const [oldSpec, newSpec] = process.argv.slice(2);
  if (!oldSpec || !newSpec) {
    console.error("usage: node solspike/tools/plain_equiv.mjs <old> <new> (ref, dir or .wasm)");
    process.exit(2);
  }
  const { total, diffs } = await compareBuilds(oldSpec, newSpec);
  diffs.forEach(report);
  const equal = total - diffs.length;
  console.log(`plain-equiv: ${total} calls, ${equal} equal, ${diffs.length} different`);
  process.exit(diffs.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  await main();
}
