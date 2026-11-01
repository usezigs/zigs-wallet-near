// The second DKG of a plain Solana wallet (web/sol/plain/control.js) against the real page modules
// and the real wasm (see sol-rig.mjs): a confirmed mainnet wallet gets the label "mainnet-plain"
// in every document and secret, a pool wallet keeps "devnet", and the plain controller loads no
// pool code. The page does not call the plain controller yet (no page wiring in this branch), so
// the test calls react() itself. The page loads the pool module once and never unloads it, so
// the blocks run in this order: the plain controller first, then the checks that the pool module
// never loaded, and the pool controller last.
// Run: node web/test/sol-plain-ceremony.mjs   (Node 26)
import assert from "node:assert/strict";
import fs from "node:fs";
import { docFields } from "../signed.js";
import { agreement, startBlock } from "../sol/ceremony.js";
import { CLUSTER, COLLECTIONS } from "../sol/docs.js";
import { attach } from "../sol/plain/control.js";
import { labelOf, walletOf } from "../sol/wallet.js";
import { config, loadRig, sleep, storage } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, W, data, waitFor } = rig;
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;
const base = (gid) => "groups/" + gid;
const solOf = (gid, i) => t.sec(gid, i).sol ?? {};
const stored = (gid, rel) => docFields(data.get(path(gid, rel)));
const PLAIN = "mainnet-plain";
const HEX64 = /^[0-9a-f]{64}$/;

// ── The wallet kind comes from the confirmed network and nothing else ──
{
  const pool = walletOf(W, "testnet");
  assert.equal(pool.cluster, "devnet", "a testnet wallet is on devnet");
  assert.equal(pool.mode, "pool", "a testnet wallet is a pool wallet");
  assert.equal(pool.label, CLUSTER, "a testnet wallet keeps the label devnet");
  assert.equal(pool.program, W.sol_program_label(), "and the program label of the pool");
  assert.equal(W.sol_wallet_label("devnet", "pool"), CLUSTER);
  assert.doesNotThrow(() => walletOf(W, "mainnet"), "mainnet is a plain wallet");
  const plain = walletOf(W, "mainnet");
  assert.equal(plain.cluster, "mainnet", "a mainnet wallet is on the mainnet cluster");
  assert.equal(plain.mode, "plain", "a mainnet wallet is a plain wallet");
  assert.equal(plain.label, PLAIN, "a mainnet wallet gets the label mainnet-plain");
  assert.equal(plain.program, W.sol_wallet_program_label("mainnet", "plain"));
  assert.notEqual(plain.program, pool.program);
  // Only the two names of a confirmed network count; the names of the prototype too are no network.
  const other = [undefined, null, "", "Testnet", "Mainnet", "devnet", "mainnet-beta", " testnet",
    "constructor", "__proto__", "toString", 1, {}, ["mainnet"]];
  for (const network of other) {
    assert.equal(walletOf(W, network), null, "no wallet for " + JSON.stringify(network));
  }
  assert.equal(labelOf({}), CLUSTER, "a controller with no wallet is the pool");
  assert.equal(labelOf({ wallet: plain }), PLAIN);
}
step("the wallet kind is derived from the confirmed network only");

// ── The plain controller loads no pool code ──
// The closure of its imports (static, re-export and import() with a literal path) holds no module
// of the pool, the Worker, the prover or the config. A computed import() path would escape this
// scan, so the closure must hold none.
{
  const web = new URL("../", import.meta.url);
  const SPEC = [/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g,
    /(?:^|\n)\s*import\s*["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g];
  const closure = new Map();
  const follow = (url) => {
    const rel = url.pathname.slice(web.pathname.length);
    if (closure.has(rel)) return;
    const text = fs.readFileSync(url, "utf8");
    closure.set(rel, text);
    for (const re of SPEC) for (const m of text.matchAll(re)) follow(new URL(m[1], url));
  };
  follow(new URL("sol/plain/control.js", web));
  const files = [...closure.keys()];
  const need = ["sol/plain/control.js", "sol/ceremony.js", "sol/fee.js", "sol/abort.js",
    "sol/docs.js", "sol/secrets.js", "sol/wallet.js", "sol/wasm/sol_wasm.js", "util.js"];
  for (const file of need) assert.ok(files.includes(file), "the closure holds " + file);
  const pool = ["main", "view", "session", "localprove", "localprover", "approve", "propose",
    "execute", "signing", "spend", "payview", "worker", "zolana.bundle", "transfer", "client",
    "addsol", "prepare", "store", "sessions", "nonces", "gate", "intent", "backup", "rent"];
  for (const file of files) {
    const banned = pool.some((name) => file === `sol/${name}.js`) || /prover/.test(file);
    assert.ok(!banned, "no pool module in the closure of the plain controller: " + file);
    assert.ok(!file.startsWith("app"), "no page module in the closure: " + file);
    const text = closure.get(file);
    assert.ok(!text.includes("/sol/config.json"), file + " asks for the config of the pool");
    assert.ok(!text.includes("/sol/worker.js"), file + " starts the Worker of the pool");
    assert.ok(!/\bimport\(\s*[^"'\s]/.test(text), file + " has a computed import path");
  }
}
step("the closure of the plain controller holds no pool code");

// ── A confirmed mainnet wallet runs the second DKG with the plain label ──
const plain = await attach(t.solHost());
const c = plain.ctl;
const pump = async (what, ok, ms = 60000) => {
  for (const t0 = Date.now(); !ok();) {
    if (Date.now() - t0 > ms) throw new Error("timeout: " + what);
    plain.react();
    await sleep(50);
  }
};
const passes = async (n) => {
  for (let k = 0; k < n; k++) {
    plain.react();
    await sleep(50);
  }
};
const opened = async (gid) => {
  plain.open(gid, base(gid));
  assert.equal(c.gid, gid, "the plain controller opened the wallet");
  await waitFor("the documents", () => COLLECTIONS.every((name) => c.loaded[name]));
};
const writes = new Map();
const countWrites = () => {
  writes.clear();
  rig.hook.before = (p, value) => {
    writes.set(p, (writes.get(p) ?? 0) + 1);
    return value;
  };
};
const dones = (gid) => [1, 2, 3].map((i) => data.get(path(gid, "soldone/" + i)));
const haveAll = (gid, name) => [1, 2, 3].every((i) => data.get(path(gid, `${name}/${i}`)));

const gid = await rig.wallet({ name: "Plain", network: "mainnet", n: 3, k: 2 });
assert.equal(t.netConfirmed(gid), "mainnet", "control: the people confirmed mainnet");
{
  const calls = { sol_roles: 0, sol_pda_roles: 0 };
  c.W = new Proxy(W, { get: (w, k) => (k in calls
    ? (...a) => { calls[k] += 1; return w[k](...a); } : w[k]) });
  await opened(gid);
  assert.equal(startBlock(c.host), null, "a confirmed mainnet wallet may start");
  assert.equal(c.wallet.label, PLAIN);
  countWrites();
  await plain.add();
  const start = stored(gid, "solstart/1");
  assert.equal(start.cluster, PLAIN, "the start document names the plain label");
  await pump("plain soldone", () => haveAll(gid, "soldone"));
  const docs = dones(gid).map(docFields);
  for (const [n, d] of docs.entries()) {
    assert.equal(d.cluster, PLAIN, "soldone " + (n + 1) + " names the plain label");
    assert.equal(d.program, W.sol_wallet_program_label("mainnet", "plain"));
    assert.deepEqual(Object.keys(d).sort(), ["at", "cluster", "groupKey", "program",
      "publicKeyPackage"], "a plain soldone holds no pool role and no PDA identity");
    assert.match(d.groupKey, HEX64, "the group key has 64 hex characters");
    assert.equal(d.groupKey, docs[0].groupKey, "one group key");
    assert.equal(typeof d.publicKeyPackage, "string");
  }
  assert.deepEqual(dones(gid).map((d) => d.by), [1, 2, 3], "each soldone names its writer");
  // The reactor writes a document once: the PDA step must not republish a plain soldone.
  await passes(20);
  for (const i of [1, 2, 3]) {
    assert.equal(writes.get(path(gid, "soldone/" + i)), 1, "soldone/" + i + " was written once");
  }
  await pump("plain solfee", () => haveAll(gid, "solfee"));
  const ag = agreement(c);
  assert.equal(ag.state, "agree", "the seats agree");
  assert.equal(ag.done.groupKey, docs[0].groupKey);
  assert.equal(Object.keys(ag.done).some((k) => k.startsWith("pda")), false, "no PDA identity");
  for (const i of [1, 2, 3]) {
    const s = solOf(gid, i);
    assert.equal(s.cluster, PLAIN, "seat " + i + " keeps the plain label in its secret");
    assert.equal(s.groupKey, docs[0].groupKey);
    assert.ok(s.keyPackage && s.solSeed, "seat " + i + " holds its key share");
    assert.equal(stored(gid, "solfee/" + i).cluster, PLAIN, "the fee document names the label");
    assert.equal(stored(gid, "soldkg2/" + i + "-" + (i % 3 + 1)).echo.length, 64);
  }
  // The label is inside the echo: a seat recomputes it from the public documents.
  const r1 = Object.fromEntries([1, 2, 3].map((i) => {
    const d = stored(gid, "soldkg1/" + i);
    return [i, { package: d.package, commit: d.commit }];
  }));
  const echo = (label) => W.sol_echo(gid, t.safetyNo(), label, JSON.stringify(r1));
  assert.equal(stored(gid, "soldkg2/1-2").echo, echo(PLAIN), "the echo binds the plain label");
  assert.notEqual(echo(PLAIN), echo(CLUSTER), "control: another label gives another echo");
  assert.deepEqual(calls, { sol_roles: 0, sol_pda_roles: 0 }, "a plain wallet has no pool roles");
  await passes(20);
  for (const rel of ["solstart/1", "soldone/1", "soldone/2", "soldone/3", "soldkg1/1",
    "solfee/1", "solfee/2", "solfee/3"]) {
    assert.equal(writes.get(path(gid, rel)), 1, rel + " was written once");
  }
  assert.equal(agreement(c).state, "agree", "and the seats still agree");
  c.W = W;
}
step("a confirmed mainnet wallet runs the second DKG with the label mainnet-plain");

// ── Documents and secrets of another label or mode do not fit a plain wallet ──
{
  const docs = [1, 2, 3].map((i) => stored(gid, "soldone/" + i));
  const view = (soldone) => ({ ...c, docs: { ...c.docs, soldone } });
  const all = (change) => Object.fromEntries(docs.map((d, n) => [n + 1, { ...d, ...change }]));
  assert.equal(agreement(view(all({}))).state, "agree", "control: the stored documents agree");
  const differs = (soldone, what) => assert.equal(agreement(view(soldone)).state, "differ", what);
  differs(all({ program: W.sol_program_label() }), "a soldone with the program label of the pool");
  differs(all({ cluster: "devnet-plain" }), "a soldone with the label devnet-plain");
  differs(all({ cluster: CLUSTER }), "a soldone with the label of the pool");
  differs(all({ groupKey: "ab".repeat(31) }), "a group key of the wrong length");
  differs(all({ pdaAddress: "ab".repeat(49) + "a" }), "a plain soldone with a PDA field");
  differs({ ...all({}), 2: { ...docs[1], groupKey: "cd".repeat(32) } }, "another group key");
  differs({ ...all({}), 3: { ...docs[2], program: "other" } }, "another program label");
  assert.equal(agreement(view({ ...all({}), 3: undefined })).state, "wait", "a missing soldone");
  // The seats agree, but the key shares of this browser do not fit the group key they publish.
  differs(all({ groupKey: "ef".repeat(32) }), "a key share that does not fit its soldone");
}
step("a soldone of another label, program or shape gives differ");

{
  // A start document of another label starts nobody.
  const other = await rig.wallet({ name: "Other", network: "mainnet" });
  await opened(other);
  const fields = { cluster: CLUSTER, at: Date.now() };
  data.set(path(other, "solstart/1"), await t.signedDoc(other, "solstart/1", 1, fields));
  rig.notify();
  await pump("the start document", () => c.docs.solstart[1], 15000);
  await passes(30);
  assert.equal(haveAll(other, "soldkg1"), false, "a start of another label starts nobody");
  assert.equal([1, 2, 3].some((i) => data.get(path(other, "soldkg1/" + i))), false);
  assert.deepEqual([1, 2, 3].map((i) => solOf(other, i)), [{}, {}, {}], "and keeps no secret");
  // A seat secret of another label stops the seat; the Zcash part is not touched.
  const drift = await rig.wallet({ name: "Drift", network: "mainnet" });
  await opened(drift);
  await t.putSec(drift, 2, { sol: { r1secret: {}, cluster: CLUSTER } });
  await plain.add();
  await pump("a stop of seat 2", () => solOf(drift, 2).aborted, 15000);
  assert.match(solOf(drift, 2).aborted, /holds a Solana part of another network or mode/);
  assert.match(solOf(drift, 2).aborted, /Do not use the Solana part of this wallet/);
  assert.equal(solOf(drift, 1).aborted, undefined, "the other seats do not stop on their own");
}
step("a start document or a seat secret of another label does not run on a plain wallet");

// ── The plain controller opens a confirmed mainnet wallet of version 3 only ──
{
  const testnet = await rig.wallet({ name: "Test" });
  plain.open(testnet, base(testnet));
  assert.equal(c.gid, null, "a confirmed testnet wallet is no plain wallet");
  assert.match(startBlock(c.host), /mainnet wallet/, "a testnet wallet may not start a plain part");
  plain.open(null, null);
  assert.equal(c.gid, null);
  const late = await rig.wallet({ name: "Late", network: "mainnet" });
  const real = t.state.g;
  t.state.g = { ...real, version: 2 };
  plain.open(late, base(late));
  assert.equal(c.gid, null, "a wallet before version 3 is not opened");
  t.state.g = real;
  // A device that never saw the confirmed number: the stored network says mainnet, and that is
  // no confirmation. Nothing waits between the forget and the open, so the page learns nothing.
  const stored = JSON.parse(storage.get("zf-signpins"));
  for (const k of ["network:" + late, "confirmednet:" + late]) {
    delete t.signPins[k];
    delete stored[k];
  }
  storage.set("zf-signpins", JSON.stringify(stored));
  assert.equal(t.netConfirmed(late), undefined, "control: no confirmed network");
  assert.equal(t.state.g.network, "mainnet", "control: the stored network says mainnet");
  plain.open(late, base(late));
  assert.equal(c.gid, null, "an unconfirmed mainnet wallet is not opened");
  assert.match(startBlock(c.host), /confirmed/, "an unconfirmed mainnet wallet may not start");
  assert.equal(c.wallet, null);
  t.openGroup("");
  await sleep(50);
  t.openGroup(late);
  await waitFor("the confirmed network", () => t.netConfirmed(late) === "mainnet");
  await waitFor("the wallet", () => t.state.gid === late && t.state.g);
  await opened(late);
  assert.equal(c.wallet.label, PLAIN, "the same wallet opens once the number is confirmed");
}
step("the plain controller opens a confirmed mainnet wallet of version 3 only");

// ── Nothing of the pool loaded or asked the server ──
assert.equal(t.sol, null, "the pool controller never loaded");
assert.equal(t.solLoading, null, "and nothing started to load it");
assert.equal(config.calls, 0, "the page never asked the server for the Helius URL");
step("the plain controller loaded no pool code and asked for no config");

// ── The pool controller keeps its wallets: testnet only, label devnet ──
{
  const pool = await rig.wallet({ name: "Pool" });
  const mainnet = await rig.wallet({ name: "Main", network: "mainnet" });
  await t.solLoad();
  assert.ok(t.sol, "the pool controller loaded");
  t.sol.open(mainnet, base(mainnet));
  assert.equal(t.sol.ctl.gid, null, "the pool controller does not open a mainnet wallet");
  t.openGroup(pool);
  await waitFor("the pool wallet", () => t.state.gid === pool && t.state.g);
  t.sol.open(pool, base(pool));
  assert.equal(t.sol.ctl.gid, pool, "it opens a confirmed testnet wallet");
  assert.equal(labelOf(t.sol.ctl), CLUSTER, "with the label devnet");
  // A plain part on a pool wallet stops the seat.
  await t.putSec(pool, 2, { sol: { r1secret: {}, cluster: PLAIN } });
  await t.sol.add();
  await waitFor("a stop of seat 2", () => solOf(pool, 2).aborted, 15000);
  assert.match(solOf(pool, 2).aborted, /holds a Solana part of another network or mode/);
  assert.equal(stored(pool, "solstart/1").cluster, CLUSTER, "the pool start names devnet");
}
step("the pool controller opens testnet wallets only and keeps the label devnet");

console.log("sol-plain-ceremony: ok");
process.exit(0);
