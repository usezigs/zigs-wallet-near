// The start watch of a mainnet wallet in the page (slice 8d, design 2.4) against the real page
// modules and the rig (sol-rig.mjs). A browser with the pin "solmode:<wallet id>" watches the start
// that seat 1 signed also where no controller follows the wallet: on a server without the private
// Worker (D14), a signed mainnet-plain start then gives plain (rule 2), and the plain controller
// follows the wallet. The server serves the plain wallet here, as staging does. The plain
// controller leaves a wallet that becomes private (the pin of an accept): the pool controller
// follows it after a signed mainnet-private start, and the plain controller follows it again after
// a signed mainnet-plain start. A signed mainnet-private start without the pin also makes it leave,
// and it stays away. The page loads each controller once and never unloads it, so the blocks run
// in this order.
// Run: node web/test/sol-start-watch.mjs   (Node 26)
import assert from "node:assert/strict";
import { docFields } from "../signed.js";
import { loadRig, mainnetConfig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, data, waitFor } = rig;
// No name of page.mjs: the import gives the same module instance as the page.
const { acceptPrivate, privateServed, solMode } = await import("../app-sol.js");
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;
const PRIVATE = "mainnet-private";
const PLAIN = "mainnet-plain";

// The private Worker: HEAD /sol/worker-mainnet.js answers `probe.status`.
const probe = { status: 404 };
const rigFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "/sol/worker-mainnet.js") return rigFetch(url, init);
  return new Response(null, { status: probe.status });
};
mainnetConfig.status = 200;
// The page asks once and keeps the answer: a test that asks again clears it first.
async function probeWith(status) {
  probe.status = status;
  delete t.ui.privateServed;
  privateServed();
  await waitFor("the probe", () => typeof t.ui.privateServed === "boolean");
}
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
// The labels of the round 1 documents of the wallet and of the Solana parts of this browser.
const labels = (gid) => [1, 2, 3].flatMap((i) => {
  const doc = data.get(path(gid, "soldkg1/" + i));
  return [doc ? docFields(doc).cluster : null, t.sec(gid, i)?.sol?.cluster ?? null];
}).filter(Boolean);
const keyed = (gid) => [1, 2, 3].every((i) => t.sec(gid, i)?.sol?.keyPackage);

// ── A pin on a server without the private Worker: a signed plain start gives plain ──
{
  await probeWith(404);
  const gid = await rig.wallet({ name: "Pinned", network: "mainnet" });
  t.openGroup(null);
  // The join tick of an unsigned hint pinned the private mode in this browser.
  acceptPrivate(gid);
  await show(gid);
  assert.equal(solMode(gid), "unserved");
  await waitFor("the start watch of an unserved wallet",
    () => rig.live(path(gid, "solstart")) === 1);
  assert.deepEqual([t.plainOn(gid), t.solOn(gid)], [false, false], "no controller yet");
  await signStart(gid, PLAIN);
  await waitFor("the plain mode", () => solMode(gid) === "plain");
  await waitFor("the plain controller follows the wallet", () => t.plainSol?.ctl.gid === gid);
  // A reopen with the signed plain start and the pin gives plain at once.
  t.openGroup(null);
  await show(gid);
  await waitFor("the plain controller follows again", () => t.plainSol.ctl.gid === gid);
  assert.equal(solMode(gid), "plain");
  await waitFor("the plain parts", () => keyed(gid), 30000);
  assert.ok(labels(gid).every((label) => label === PLAIN), "only plain labels: " + labels(gid));
  assert.deepEqual([t.sol, t.solLoading], [null, null], "the pool controller never loaded");
  await sleep(100);
}
step("a pin on a server without the private Worker: a signed plain start gives plain");

// ── The plain controller leaves a wallet that turns private, and the pool follows it ──
await probeWith(200);
// A plain wallet with no start, whose devices then accept the private wallet.
async function acceptedPlain(name) {
  const gid = await rig.wallet({ name, network: "mainnet" });
  await waitFor("the plain controller follows the wallet", () => t.plainSol.ctl.gid === gid);
  assert.equal(solMode(gid), "plain", "no pin and no start");
  acceptPrivate(gid);
  t.refilter();
  await waitFor("the plain controller leaves the wallet", () => t.plainSol.ctl.gid === null);
  assert.equal(solMode(gid), "private");
  return gid;
}
{
  const gid = await acceptedPlain("Accepted");
  await signStart(gid, PRIVATE);
  await waitFor("the pool controller follows the wallet", () => t.sol?.ctl.gid === gid);
  await waitFor("the private parts", () => keyed(gid), 30000);
  assert.ok(labels(gid).every((label) => label === PRIVATE), "only private labels: " + labels(gid));
  assert.equal(solMode(gid), "private");
  assert.equal(t.plainSol.ctl.gid, null, "the plain controller does not follow it");
}
step("the plain controller leaves a wallet that becomes private, and the pool controller follows");

// ── A signed plain start brings the plain controller back ──
{
  const gid = await acceptedPlain("Back to plain");
  await waitFor("the pool controller follows the wallet", () => t.sol.ctl.gid === gid);
  await signStart(gid, PLAIN);
  await waitFor("the plain mode", () => solMode(gid) === "plain");
  await waitFor("the plain controller follows again", () => t.plainSol.ctl.gid === gid);
  await waitFor("the plain parts", () => keyed(gid), 30000);
  // The pool controller still follows the wallet, but it runs no round 1 for a plain start.
  assert.ok(labels(gid).every((label) => label === PLAIN), "only plain labels: " + labels(gid));
}
step("a signed plain start brings the plain controller back to that wallet");

// ── A signed private start without the pin: the plain controller leaves and stays away ──
{
  const gid = await rig.wallet({ name: "Waits", network: "mainnet" });
  await waitFor("the plain controller follows the wallet", () => t.plainSol.ctl.gid === gid);
  await signStart(gid, PRIVATE);
  t.refilter();
  await waitFor("the accept", () => solMode(gid) === "accept");
  t.refilter();
  await waitFor("the plain controller leaves the wallet", () => t.plainSol.ctl.gid === null);
  const { opened } = t.plainSol.ctl;
  for (let k = 0; k < 10; k++) {
    t.refilter();
    await sleep(50);
  }
  assert.equal(t.plainSol.ctl.opened, opened, "the plain controller does not open it again");
  assert.equal(solMode(gid), "accept", "the watch of the page keeps the start");
  assert.deepEqual(labels(gid), [], "no round 1 and no part");
}
step("a signed private start without the pin: the plain controller leaves and stays away");

console.log("sol-start-watch: ok");
process.exit(0);
