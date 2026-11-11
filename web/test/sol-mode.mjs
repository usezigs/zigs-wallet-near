// The private Solana wallet on mainnet in the page (slice 8d): the router solMode of web/app-sol.js
// and the pool controller of web/sol/main.js, against the real page modules and the rig
// (sol-rig.mjs). A mainnet wallet is private by the pin of this browser or by the label of its
// Solana part, and only on a server that serves the private Worker (the D14 probe). It never
// falls back to plain, and a browser with the pin never loads the plain controller. The pool
// controller of a private wallet carries the wallet kind of the wasm and the mainnet Helius URL,
// and a wallet switch never keeps the URL of the last wallet. The page loads the plain controller
// once and never unloads it, so the plain cases run last.
// Run: node web/test/sol-mode.mjs   (Node 26)
import assert from "node:assert/strict";
import { docFields } from "../signed.js";
import { agreement } from "../sol/ceremony.js";
import { provesLocally, turnOnLocal } from "../sol/localprove.js";
import { labelOf, programOf } from "../sol/wallet.js";
import { config, loadRig, mainnetConfig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, W, data, waitFor } = rig;
// solMode is no name of page.mjs: the import gives the same module instance as the page.
const { solMode } = await import("../app-sol.js");
const step = (name) => console.log("ok  " + name);
const base = (gid) => "groups/" + gid;
const path = (gid, rel) => `groups/${gid}/${rel}`;
const PRIVATE = "mainnet-private";
const PLAIN = "mainnet-plain";
const pool = JSON.parse(W.sol_pool_wallet("mainnet"));
const PRIVATE_WALLET = { cluster: "mainnet", mode: "pool", ...pool };
const dones = (gid) => [1, 2, 3].map((i) => data.get(path(gid, "soldone/" + i)));
const noPlain = (what) => {
  assert.equal(t.plainLoading, null, what + ": the plain controller never loaded");
  assert.equal(t.plainSol, null, what);
};

// The D14 probe: HEAD /sol/worker-mainnet.js answers `probe.status`. `calls` keeps the options.
const probe = { status: 404, calls: [] };
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "/sol/worker-mainnet.js") return rigFetch(url, init);
  probe.calls.push(init);
  return new Response(null, { status: probe.status });
};
// The page asks once and keeps the answer: a test that asks again clears it first.
const ask = (status) => {
  probe.status = status;
  probe.calls.length = 0;
  delete t.ui.privateServed;
};
const answered = () => waitFor("the probe", () => typeof t.ui.privateServed === "boolean");
// The router of the open private wallet asks again, and the answer comes.
const probeWith = async (status) => {
  ask(status);
  solMode();
  await answered();
};
// The accept of this browser (design 2.4, C7): the first-seen pin in zf-signpins.
const pinPrivate = (gid) => {
  t.signPins["solmode:" + gid] = PRIVATE;
};
const show = async (gid) => {
  t.openGroup(gid);
  await waitFor("the wallet", () => t.state.gid === gid && t.state.g);
};
// A start document that seat 1 signed, as the store holds it.
async function signStart(gid, cluster) {
  const doc = await t.signedDoc(gid, "solstart/1", 1, { cluster, at: Date.now() });
  data.set(path(gid, "solstart/1"), doc);
  rig.notify();
}

// ── The router: plain with no pin, unserved without the probe, private with both ──
const priv = await rig.wallet({ name: "Private", network: "mainnet" });
assert.equal(solMode(priv), "plain", "a mainnet wallet with no pin and no start is plain");
assert.deepEqual(probe.calls, [], "a plain wallet does not ask for the private Worker");
pinPrivate(priv);
ask(404);
assert.equal(solMode(priv), "unserved", "the probe has not answered yet");
assert.equal(t.plainOn(priv), false, "and the wallet is not plain meanwhile");
await answered();
assert.equal(solMode(priv), "unserved", "a 404 means that the server serves no private wallet");
assert.deepEqual(probe.calls, [{ method: "HEAD", cache: "no-store" }], "one HEAD, not cached");
assert.deepEqual([t.plainOn(priv), t.solOn(priv)], [false, false], "neither controller");
noPlain("an unserved wallet");
await probeWith(200);
assert.equal(solMode(priv), "private", "the pin and the probe give private");
assert.deepEqual([t.plainOn(priv), t.solOn(priv)], [false, true], "the pool controller");
const testnet = await rig.wallet({ name: "Testnet" });
assert.equal(solMode(testnet), null, "a testnet wallet has no mode");
assert.equal(t.solOn(testnet), true, "and it stays a pool wallet");
step("the router: plain with no pin, unserved without the probe, private with both");

// ── The pool controller follows a private wallet with the mainnet kind and URL ──
mainnetConfig.status = 200;
await t.solLoad();
const c = t.sol.ctl;
await waitFor("the testnet wallet", () => c.gid === testnet);
assert.deepEqual([c.wallet, c.rpcUrl, c.devnetUrl], [null, config.rpcUrl, config.rpcUrl]);
await show(priv);
await waitFor("the controller follows the private wallet", () => c.gid === priv);
assert.deepEqual(c.wallet, PRIVATE_WALLET, "with the wallet kind of the wasm");
assert.deepEqual([labelOf(c), programOf(c)], [PRIVATE, pool.program]);
await waitFor("the mainnet URL", () => c.rpcUrl === mainnetConfig.rpcUrl);
// The open sets the URL before any await: none until the mainnet URL comes.
t.sol.open(priv, base(priv));
assert.equal(c.rpcUrl, null, "no URL of the last open");
await waitFor("the mainnet URL", () => c.rpcUrl === mainnetConfig.rpcUrl);
// A switch to a Devnet wallet gives the Devnet URL back, and no wallet kind.
await show(testnet);
await waitFor("the controller follows the testnet wallet", () => c.gid === testnet);
assert.deepEqual([c.wallet, c.rpcUrl], [null, config.rpcUrl], "the Devnet wallet");
noPlain("a private wallet");
step("the pool controller follows a private wallet with the mainnet kind and URL");

// ── A mainnet URL that comes after a wallet switch is not kept ──
{
  let release;
  const held = new Promise((done) => {
    release = done;
  });
  const before = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "/sol/config-mainnet.json") await held;
    return before(url, init);
  };
  try {
    await show(priv);
    await waitFor("the private wallet", () => c.gid === priv);
    assert.equal(c.rpcUrl, null, "the mainnet URL has not come");
    await show(testnet);
    await waitFor("the testnet wallet", () => c.gid === testnet);
    release();
    await sleep(200);
    assert.equal(c.rpcUrl, config.rpcUrl, "the late mainnet URL is not kept");
  } finally {
    globalThis.fetch = before;
  }
  // No mainnet URL on the server: the controller has none, and the log says why.
  mainnetConfig.status = 404;
  await show(priv);
  await waitFor("the log line", () => t.state.log.some((line) => /Solana mainnet URL/.test(line)));
  assert.equal(c.gid, priv);
  assert.equal(c.rpcUrl, null, "no URL from a server that answers 404");
  assert.ok(t.state.log.some((line) => /Solana mainnet URL: Solana is not available/.test(line)));
  mainnetConfig.status = 200;
}
step("a mainnet URL that comes after a wallet switch is not kept");

// ── A pin without the probe opens neither controller, and never goes to plain ──
{
  const off = await rig.wallet({ name: "Off", network: "mainnet" });
  pinPrivate(off);
  await probeWith(404);
  assert.equal(solMode(off), "unserved");
  rig.notify();
  await sleep(300);
  assert.notEqual(c.gid, off, "the pool controller does not follow it");
  assert.deepEqual([t.plainOn(off), t.solOn(off)], [false, false]);
  await t.plainLoad();
  noPlain("a pinned wallet on a server without the probe");
  t.sol.open(off, base(off));
  assert.equal(c.gid, null, "the pool controller refuses to open it");
  assert.equal(c.rpcUrl, config.rpcUrl);
}
step("a pin without the probe opens neither controller and never goes to plain");

// ── Seat 1 with solAuto and the pin starts a private wallet, and never mainnet-plain ──
const auto = await rig.wallet({ name: "Auto", network: "mainnet" });
{
  pinPrivate(auto);
  await probeWith(200);
  await rig.db.doc(base(auto)).update({ solana: true });
  await t.putSec(auto, 1, { solAuto: true });
  t.refilter();
  await waitFor("every private soldone", () => dones(auto).every(Boolean), 30000);
  await waitFor("the private agreement", () => agreement(c).state === "agree");
  assert.equal(c.gid, auto);
  assert.equal(docFields(data.get(path(auto, "solstart/1"))).cluster, PRIVATE, "the signed start");
  for (const d of dones(auto).map(docFields)) {
    assert.deepEqual([d.cluster, d.program], [PRIVATE, pool.program], "each soldone");
  }
  assert.equal(agreement(c).done.cluster, PRIVATE);
  await t.plainLoad();
  noPlain("seat 1 of a private wallet");
  // The switch of local proving of a private wallet names its label.
  const worker = {
    call: async (cmd) => (cmd === "poolSlot" ? { slot: "1", pinned: "1" } : { ms: 1 }),
  };
  const said = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    await turnOnLocal(c, worker);
  } finally {
    globalThis.confirm = said;
  }
  assert.equal(docFields(data.get(path(auto, "solprove/1"))).cluster, PRIVATE, "the switch");
  assert.equal(provesLocally(c), true);
  // The label of the Solana part decides: no pin needed any more.
  delete t.signPins["solmode:" + auto];
  assert.equal(solMode(auto), "private", "the private part keeps the wallet private");
  pinPrivate(auto);
}
step("seat 1 with solAuto and the pin signs mainnet-private, and no plain controller loads");

// ── A signed private start without the pin asks for the accept; the pin then opens it ──
{
  // A browser with no part and no pin learns the start from the watch of the plain path.
  delete t.ui.plainServed;
  const acc = await rig.wallet({ name: "Accept", network: "mainnet" });
  await waitFor("the plain probe", () => t.ui.plainServed === true);
  await waitFor("the start watch", () => rig.live(path(acc, "solstart")) >= 1);
  assert.equal(solMode(acc), "plain", "no start yet");
  await signStart(acc, PRIVATE);
  await waitFor("the accept", () => solMode(acc) === "accept");
  assert.deepEqual([t.plainOn(acc), t.solOn(acc)], [false, false], "neither controller");
  await sleep(300);
  noPlain("a private start without the pin");
  assert.notEqual(c.gid, acc, "the pool controller waits for the accept");
  pinPrivate(acc);
  t.refilter();
  await waitFor("the pool controller after the accept", () => c.gid === acc);
  assert.equal(solMode(acc), "private");
  assert.equal(labelOf(c), PRIVATE);
  noPlain("an accepted private wallet");
}
step("a signed private start without the pin asks for the accept, and the pin opens it");

// ── Plain stays plain: a signed plain start beats the pin; no pin and no start is plain ──
{
  const signed = await rig.wallet({ name: "Signed plain", network: "mainnet" });
  pinPrivate(signed);
  await signStart(signed, PLAIN);
  await waitFor("the plain mode", () => solMode(signed) === "plain");
  assert.equal(t.plainOn(signed), true, "a signed mainnet-plain start gives plain");
  const bare = await rig.wallet({ name: "Bare", network: "mainnet" });
  assert.equal(solMode(bare), "plain");
  assert.deepEqual([t.plainOn(bare), t.solOn(bare)], [true, false], "as before slice 8");
}
step("a signed plain start, or no start and no pin, gives plain as before");

console.log("sol-mode: ok");
process.exit(0);
