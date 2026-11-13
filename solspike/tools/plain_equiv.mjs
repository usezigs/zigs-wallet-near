// Proves that two builds of the checker wasm answer the same where the plain wallet and the Devnet
// pool must not change (slice 8 design record, section 3.4).
// Usage: node solspike/tools/plain_equiv.mjs <old> <new>
// Each side is a git ref (its web/sol/wasm files are read with git show), a directory with
// sol_wasm.js and sol_wasm_bg.wasm, or a path to a .wasm file (its sol_wasm.js sits beside it).
// The calls are in four groups:
// - plain: the five plain entries on the vectors of wasm-sol/vectors/plain and on 40 damaged
//   copies of each (fixed seed), the plain labels and the sends to the Zolana pool and registry.
// - keyed: the same vectors with the group key and the fee key of wasm-sol/vectors/fee_keys.json,
//   so the fee signature and the group share answer; then the aggregate and the fee verify.
// - mixed: plain pins of a mainnet pool wallet, the labels of each cluster and mode, the rule
//   lists, the key calls, and the ceremony and the digest under each label.
// - pool: the Devnet vectors of wasm-sol/vectors/smoke at POOL_REF, the PDA identity and the
//   approval digest. A build with sol_pool_wallet gets the wire of the private mainnet wallet:
//   pins 01 || pins || Devnet genesis, a shield with held 0, and the label as first argument.
// EXPECTED lists the differences that the private mainnet wallet makes. The tool prints each
// difference with its input. Exit code: 0 when every difference is in EXPECTED, 1 when one is
// not, 2 on a usage error.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
const S = JSON.stringify;
const J = JSON.parse;

/** Slice 8 base in this history; same pinned wasm bytes as the legacy ref 69803a1d. */
export const POOL_REF = "9688a60bc6bd39c8a6fa2fde38c7c9e386c44a00";
/** The groups of calls, in the order that they run. */
export const GROUPS = ["plain", "keyed", "mixed", "pool"];
const DEVNET_GENESIS = "ce59db5080fc2c6d3bcf7ca90712d3c2e5e6c28f27f0dfbb9953bdb0894c03ab";
const NOW = 1_800_000_000n - 3_600n;
const WALLET = "wallet-0001";
const SAFETY = "12345 67890 12345 67890 12345 67890";
const LABELS = ["devnet", "devnet-plain", "mainnet-plain", "mainnet", "mainnet-pool", "",
  "mainnet-private"];
// The wallet label of the cluster and mode bytes of the plain pins.
const LABEL_OF = { "1,1": "devnet-plain", "2,1": "mainnet-plain", "1,2": "devnet" };

const throwsThenAnswers = (o, n) => o.startsWith("THROW:") && !n.startsWith("THROW:");

function oneRuleAdded(o, n) {
  const before = o.split("\n");
  const added = n.split("\n").filter((line) => !before.includes(line));
  const kept = n.split("\n").filter((line) => !line.startsWith("shield-over-cap\t"));
  return added.length === 1 && added[0].startsWith("shield-over-cap\t") && kept.join("\n") === o;
}

/** The differences that the private mainnet wallet makes. No other answer may differ. */
export const EXPECTED = [
  { tag: /^rule_list$/, why: "one new pool rule, shield-over-cap", ok: oneRuleAdded },
  {
    tag: /^label mainnet-private (sol_commit|sol_echo|sol_dkg3|sol_digest)$/,
    why: "the label of the private mainnet wallet: the old build refuses it",
    ok: throwsThenAnswers,
  },
  { tag: /^sol_pool_wallet (devnet|mainnet)$/, why: "a new export", ok: throwsThenAnswers },
];

const expectedWhy = (tag, o, n) => EXPECTED.find((e) => e.tag.test(tag) && e.ok(o, n))?.why;

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
  const show = (f) => gitShow(spec, `${WASM_DIR}/${f}`);
  fs.writeFileSync(glue, show("sol_wasm.js"));
  fs.writeFileSync(wasm, show("sol_wasm_bg.wasm"));
  return glue;
}

/** The bytes of `file` at the git ref `ref`. */
export const gitShow = (ref, file) =>
  execFileSync("git", ["show", `${ref}:${file}`], { cwd: ROOT, maxBuffer: 1 << 27 });

async function load(spec, dir) {
  const glue = stageBuild(spec, dir);
  const mod = await import(pathToFileURL(glue).href);
  mod.initSync({ module: fs.readFileSync(path.join(dir, "sol_wasm_bg.wasm")) });
  return mod;
}

function text(r) {
  if (r instanceof Uint8Array) return "bytes:" + Buffer.from(r).toString("hex");
  return String(r);
}

/** The answer of one run as text: the value, or THROW: and the message. */
const guarded = (run) => (w) => {
  try {
    return text(run(w));
  } catch (e) {
    return "THROW:" + (e?.message ?? e);
  }
};

/** A case: a tag, the export and its input for the report, and the run on one build. */
const call = (tag, fn, args) => ({ tag, fn, args, run: guarded((w) => w[fn](...args)) });
const ran = (tag, fn, run) => ({ tag, fn, args: [], run: guarded(run) });

const bytes = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
const hexOf = (a) => Buffer.from(a).toString("hex");
const concat = (...parts) => Uint8Array.from(Buffer.concat(parts.map((p) => Buffer.from(p))));
const readJson = (file) => J(fs.readFileSync(path.join(ROOT, file), "utf8"));

function readVector(name) {
  const get = (e) => new Uint8Array(fs.readFileSync(path.join(VECTORS, `${name}.${e}`)));
  const answer = fs.readFileSync(path.join(VECTORS, `${name}.answer`), "utf8");
  const v = Object.fromEntries(EXT.map((e) => [e, get(e)]));
  return { ...v, accepted: answer.startsWith("accepted") };
}

const ENTRIES = [
  ["check", "plain_check_message", (x) => [x.msg, x.intent, x.pins, x.chain]],
  ["compile", "plain_compile_message", (x) => [x.intent, x.pins]],
  ["reads", "plain_reads", (x) => [x.intent, x.pins]],
  ["digest", "sol_plain_digest", (x) => [x.pins, x.msg]],
  ["fee_sign", "sol_plain_fee_sign", (x) => [x.msg, x.intent, x.pins, x.chain, ZERO_SECRET]],
];

const entryCases = (tag, x) =>
  ENTRIES.map(([name, fn, args]) => call(`${tag} ${name}`, fn, args(x)));

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

// The damaged copies of the earlier tool, each one through the five plain entries.
function damagedCases(name, v, next) {
  const out = [];
  for (let k = 0; k < 40; k++) {
    const [msg, intent, pins, chain] = damage(EXT.map((e) => v[e]), k, next);
    out.push(...entryCases(`${name} damaged${k}`, { msg, intent, pins, chain }));
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

const swap = (buf, pairs) => pairs.reduce((b, [from, to]) => replaceAll(b, from, to), buf);

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
    const tag = `${name} to ${id.slice(0, 6)}`;
    out.push(call(`${tag} compile`, "plain_compile_message", [intent, v.pins]));
    out.push(ran(`${tag} check`, "plain_check_message", (w) =>
      w.plain_check_message(w.plain_compile_message(intent, v.pins), intent, v.pins, chain)));
  }
  return out;
}

function labelCases() {
  const out = [call("plain_rule_list", "plain_rule_list", [])];
  for (const c of ["devnet", "mainnet"]) {
    out.push(call(`wallet_label ${c} plain`, "sol_wallet_label", [c, "plain"]));
    out.push(call(`wallet_program_label ${c} plain`, "sol_wallet_program_label", [c, "plain"]));
  }
  return out;
}

const plainNames = () =>
  fs.readdirSync(VECTORS).filter((f) => f.endsWith(".msg")).map((f) => f.slice(0, -4)).sort();

function plainGroup() {
  const next = xorshift();
  const out = labelCases();
  for (const name of plainNames()) {
    const v = readVector(name);
    out.push(...entryCases(name, v), ...damagedCases(name, v, next));
    if (SEND_VECTORS.includes(name)) out.push(...sendCases(name, v));
  }
  return out;
}

// ---- keyed: the plain vectors under the test group of wasm-sol/vectors/fee_keys.json ----

/** The test group, the fee key of seat 1, and saved nonces of seats 1 and 2 made by `ref`. */
function keyring(ref) {
  const file = readJson("wasm-sol/vectors/fee_keys.json");
  const kps = file.packages.map((p) => p.keyPackage);
  const made = kps.slice(0, 2).map((kp) => J(ref.sol_nonces(S(kp), "00".repeat(32))));
  const shares = Object.fromEntries(kps.map((kp) => [kp.identifier, kp.verifying_share]));
  const publicPackage = { header: kps[0].header, verifying_shares: shares,
    verifying_key: kps[0].verifying_key };
  return {
    kps,
    group: kps[0].verifying_key,
    fee: file.packages[0],
    tails: made.map((m) => m.nonces.slice(64)),
    commitments: { 1: made[0].commitments, 2: made[1].commitments },
    publicPackage: S(publicPackage),
  };
}

const KEY_HEX = /^[0-9a-f]{64}$/;

// Each account that plain_reads names for the old keys, with its address for the new keys.
function readPairs(ref, intent, before, after) {
  const rows = (pins) => text(ref.plain_reads(intent, pins)).split("\n").map((l) => l.split("\t"));
  const now = new Map(rows(after).map((r) => [r[0], r[1]]));
  return rows(before)
    .filter((r) => KEY_HEX.test(r[1] ?? "") && KEY_HEX.test(now.get(r[0]) ?? ""))
    .map((r) => [bytes(r[1]), bytes(now.get(r[0]))]);
}

/** The vector with the group key and the payer of the keyring, and the accounts they derive. */
function rekeyed(ref, v, keys) {
  const pairs = [
    [v.pins.slice(2, 34), bytes(keys.group)],
    [v.pins.slice(34, 66), bytes(keys.fee.public)],
  ];
  pairs.push(...readPairs(ref, v.intent, v.pins, swap(v.pins, pairs)));
  const x = Object.fromEntries(EXT.map((e) => [e, swap(v[e], pairs)]));
  return { ...x, label: LABEL_OF[`${v.pins[0]},${v.pins[1]}`] ?? "", accepted: v.accepted };
}

// An accepted vector signs the message that the build compiles; any other one its own bytes.
const messageOf = (w, x) => (x.accepted ? w.plain_compile_message(x.intent, x.pins) : x.msg);

/** The share of seat 1 or 2, with saved nonces for the digest of the message. */
function shareOf(w, x, keys, seat) {
  const msg = messageOf(w, x);
  const digest = w.sol_plain_digest(x.pins, msg);
  const round = {
    now: Number(NOW),
    cluster: x.label,
    keyPackage: keys.kps[seat - 1],
    nonces: digest + keys.tails[seat - 1],
    commitments: keys.commitments,
  };
  return w.sol_plain_sign_share(msg, x.intent, x.pins, x.chain, S(round));
}

const feeSign = (w, x, keys) =>
  w.sol_plain_fee_sign(messageOf(w, x), x.intent, x.pins, x.chain, S({ secret: keys.fee.secret }));

function keyedCases(name, x, keys) {
  return [
    ran(`${name} keyed fee_sign`, "sol_plain_fee_sign", (w) => feeSign(w, x, keys)),
    ran(`${name} keyed sign_share`, "sol_plain_sign_share", (w) => shareOf(w, x, keys, 1)),
  ];
}

// Two shares of one message make a signature, and the fee key verifies its own signature.
function signedCases(x, keys) {
  const aggregate = (w) => {
    const shares = { 1: J(shareOf(w, x, keys, 1)).share, 2: J(shareOf(w, x, keys, 2)).share };
    return w.sol_aggregate(messageOf(w, x), keys.publicPackage, S(keys.commitments), S(shares));
  };
  const verify = (w) => {
    const sig = feeSign(w, x, keys);
    const other = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    const msg = messageOf(w, x);
    return [sig, other].map((s) => w.sol_fee_verify(keys.fee.public, msg, s)).join(" ");
  };
  return [
    ran("keyed aggregate", "sol_aggregate", aggregate),
    ran("keyed fee_verify", "sol_fee_verify", verify),
  ];
}

function keyedGroup(ref) {
  const keys = keyring(ref);
  const out = [];
  for (const name of plainNames()) {
    const x = rekeyed(ref, readVector(name), keys);
    out.push(...keyedCases(name, x, keys));
    if (name === "mainnet-s2-send-sol") out.push(...signedCases(x, keys));
  }
  return out;
}

// ---- mixed: labels, rule lists, key calls and the ceremony ----

function pairCases() {
  const out = [
    call("sol_program_label", "sol_program_label", []),
    call("rule_list", "rule_list", []),
  ];
  for (const c of ["devnet", "mainnet", "testnet", ""]) {
    for (const m of ["plain", "pool", ""]) {
      const tag = `pair ${c}/${m}`;
      out.push(call(`${tag} sol_wallet_label`, "sol_wallet_label", [c, m]));
      out.push(call(`${tag} sol_wallet_program_label`, "sol_wallet_program_label", [c, m]));
    }
  }
  for (const c of ["devnet", "mainnet"]) {
    out.push(call(`sol_pool_wallet ${c}`, "sol_pool_wallet", [c]));
  }
  return out;
}

function keyCases(keys) {
  const out = [];
  keys.kps.forEach((kp, i) => {
    out.push(call(`sol_fee_key seat ${i + 1}`, "sol_fee_key", [S(kp)]));
    out.push(call(`sol_share_fits seat ${i + 1}`, "sol_share_fits", [S(kp)]));
  });
  const bad = S({ ...keys.kps[0], signing_share: keys.kps[1].signing_share });
  out.push(call("sol_share_fits another share", "sol_share_fits", [bad]));
  out.push(call("sol_fee_key another share", "sol_fee_key", [bad]));
  for (const r of readJson("wasm-sol/vectors/roles.json").vectors) {
    out.push(call(`sol_roles ${r.name}`, "sol_roles", [r.solSeed, r.groupKey]));
  }
  return out;
}

// The plain pins of a pool wallet on mainnet: cluster byte 2, mode byte 2.
function poolPinCases() {
  return plainNames().map((name) => {
    const v = readVector(name);
    const pins = Uint8Array.from(v.pins);
    pins.set([2, 2], 0);
    const args = [v.msg, v.intent, pins, v.chain];
    return call(`${name} pins mainnet pool`, "plain_check_message", args);
  });
}

const memo = new WeakMap();
function cached(w, key, make) {
  if (!memo.has(w)) memo.set(w, new Map());
  const all = memo.get(w);
  if (!all.has(key)) all.set(key, make());
  return all.get(key);
}

const filled = (n) => n.toString(16).padStart(2, "0").repeat(32);

/** Round 1 of three seats of a 2-of-3 wallet, made once by `ref` (sol_dkg1 is random). */
function dkgSeats(ref) {
  return [1, 2, 3].map((id) => {
    const r1 = J(ref.sol_dkg1(id, 3, 2));
    return { id, secret1: S(r1.secret), package: r1.package, r: filled(16 + id),
      boxPk: filled(32 + id) };
  });
}

function round2(w, seats) {
  return cached(w, "dkg2", () => {
    const inbox = Object.fromEntries(seats.map((s) => [s.id, {}]));
    const secrets = {};
    for (const s of seats) {
      const others = seats.filter((o) => o.id !== s.id).map((o) => [o.id, o.package]);
      const out = J(w.sol_dkg2(s.secret1, S(Object.fromEntries(others))));
      secrets[s.id] = out.secret;
      for (const [to, pkg] of Object.entries(out.outgoing)) inbox[to][s.id] = pkg;
    }
    return { secrets, inbox };
  });
}

const commits = (w, seats, label) =>
  seats.map((s) => w.sol_commit(WALLET, s.id, s.boxPk, label, s.r));

function docsOf(w, seats, label) {
  const all = commits(w, seats, label);
  return S(Object.fromEntries(seats.map((s, i) => [s.id, { package: s.package, commit: all[i] }])));
}

function dkg3(w, seats, label) {
  const mid = round2(w, seats);
  const docs = docsOf(w, seats, label);
  const echo = w.sol_echo(WALLET, SAFETY, label, docs);
  const parts = Object.fromEntries(seats.map((s) => [s.id, { r: s.r, boxPk: s.boxPk }]));
  const peers = (s) => seats.filter((o) => o.id !== s.id).map((o) => [o.id, echo]);
  const ctx = (s) => ({ walletId: WALLET, safety: SAFETY, cluster: label, seat: s.id, echo,
    peerEchoes: Object.fromEntries(peers(s)), parts });
  const one = (s) => w.sol_dkg3(S(mid.secrets[s.id]), docs, S(mid.inbox[s.id]), S(ctx(s)));
  return seats.map(one).join("\n");
}

function ceremonyCases(ref) {
  const seats = dkgSeats(ref);
  const msg = Uint8Array.from([0x81, 1, 2, 3]);
  const out = [ran("ceremony sol_dkg2", "sol_dkg2", (w) => S(round2(w, seats)))];
  for (const label of LABELS) {
    const tag = `label ${label}`;
    out.push(ran(`${tag} sol_commit`, "sol_commit", (w) => commits(w, seats, label).join(" ")));
    out.push(ran(`${tag} sol_echo`, "sol_echo", (w) =>
      w.sol_echo(WALLET, SAFETY, label, docsOf(w, seats, label))));
    out.push(ran(`${tag} sol_dkg3`, "sol_dkg3", (w) => dkg3(w, seats, label)));
    out.push(call(`${tag} sol_digest`, "sol_digest", [label, msg]));
  }
  return out;
}

function mixedGroup(ref) {
  return [...poolPinCases(), ...pairCases(), ...keyCases(keyring(ref)), ...ceremonyCases(ref)];
}

// ---- pool: the Devnet pool under the wire of each side ----

/** True for a build of the private mainnet wallet: it takes the new pool wire. */
const newWire = (w) => typeof w.sol_pool_wallet === "function";

/** The new pins of old Devnet pins: cluster byte 1, the old pins, the Devnet genesis. */
export const newPins = (pins) => concat([1], pins, bytes(DEVNET_GENESIS));

/** The new form of an old proposal: a shield (tag 2) gets held 0 after its amount. */
export const newIntent = (intent) =>
  intent[0] === 2 ? concat(intent.slice(0, 41), new Uint8Array(8), intent.slice(41)) : intent;

/** The names of the smoke vectors at `ref`, and a reader of their files at that ref. */
export function smokeAt(ref = POOL_REF) {
  const dir = "wasm-sol/vectors/smoke";
  const list = execFileSync("git", ["ls-tree", "--name-only", `${ref}:${dir}`], { cwd: ROOT });
  const msgs = String(list).split("\n").filter((f) => f.endsWith(".msg"));
  const read = (name, ext) => new Uint8Array(gitShow(ref, `${dir}/${name}.${ext}`));
  return { names: msgs.map((f) => f.slice(0, -4)).sort(), read };
}

function smokeCases() {
  const { names, read } = smokeAt();
  const out = [];
  for (const name of names) {
    const [msg, intent, pins, snapshot] = ["msg", "intent", "pins", "snapshot"].map((e) =>
      read(name, e));
    const wire = (w) => (newWire(w) ? [newIntent(intent), newPins(pins)] : [intent, pins]);
    out.push(ran(`smoke ${name} check`, "check_message", (w) =>
      w.check_message(msg, ...wire(w), snapshot, NOW)));
    out.push(ran(`smoke ${name} compile`, "compile_message", (w) =>
      w.compile_message(...wire(w), new Uint8Array(0))));
  }
  return out;
}

const devnetFirst = (w, args) => (newWire(w) ? ["devnet", ...args] : args);

function programCases() {
  const out = readJson("wasm-sol/vectors/roles.json").vectors.map((r) =>
    ran(`sol_pda_roles ${r.name}`, "sol_pda_roles", (w) =>
      w.sol_pda_roles(...devnetFirst(w, [r.solSeed, r.groupKey]))));
  const landed = readJson("wasm-sol/vectors/program/landed.json");
  for (const track of ["dmain", "emain"]) {
    for (const key of ["proposal", "proposal_v5"]) {
      const args = [landed[track][key], landed[track].body];
      out.push(ran(`sol_approval_digest ${track} ${key}`, "sol_approval_digest", (w) =>
        w.sol_approval_digest(...devnetFirst(w, args))));
    }
  }
  return out;
}

const poolGroup = () => [...smokeCases(), ...programCases()];

/** Every call of `groups`, as { tag, fn, args, run }. `ref` makes the random inputs once. */
export function buildCases(ref, groups = GROUPS) {
  const make = { plain: plainGroup, keyed: keyedGroup, mixed: mixedGroup, pool: poolGroup };
  return groups.flatMap((g) => make[g](ref));
}

/**
 * Runs every case of `groups` on both builds. Returns the count, every difference (with the
 * reason when EXPECTED names it) and the differences that EXPECTED does not name.
 */
export async function compareBuilds(oldSpec, newSpec, groups = GROUPS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plain-equiv-"));
  try {
    const oldW = await load(oldSpec, path.join(tmp, "old"));
    const newW = await load(newSpec, path.join(tmp, "new"));
    const cases = buildCases(oldW, groups);
    const diffs = [];
    for (const { tag, fn, args, run } of cases) {
      const [o, n] = [run(oldW), run(newW)];
      if (o !== n) diffs.push({ tag, fn, args, old: o, new: n, expected: expectedWhy(tag, o, n) });
    }
    return { total: cases.length, diffs, unexpected: diffs.filter((d) => !d.expected) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const shown = (a) => (a instanceof Uint8Array ? hexOf(a) : S(a));

function report(d) {
  console.log(`DIFF ${d.tag} (${d.fn})${d.expected ? ", expected: " + d.expected : ""}`);
  d.args.forEach((a, i) => console.log(`  input ${i}: ${shown(a)}`));
  console.log(`  old: ${d.old}`);
  console.log(`  new: ${d.new}`);
}

async function main() {
  const [oldSpec, newSpec] = process.argv.slice(2);
  if (!oldSpec || !newSpec) {
    console.error("usage: node solspike/tools/plain_equiv.mjs <old> <new> (ref, dir or .wasm)");
    process.exit(2);
  }
  const { total, diffs, unexpected } = await compareBuilds(oldSpec, newSpec);
  diffs.forEach(report);
  const equal = total - diffs.length;
  console.log(`plain-equiv: ${total} calls, ${equal} equal, ${diffs.length} different, ` +
    `${unexpected.length} not expected`);
  process.exit(unexpected.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
