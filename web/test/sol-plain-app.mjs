// The plain Solana wallet in the page (web/app-sol.js) against the real page modules, the real wasm
// and the rig (sol-rig.mjs). The probe of /sol/config-mainnet.json gates the plain controller; the
// controller lives in its own slot (plainSol), never in the pool slot (sol); a wallet switch closes
// it; the backup file, the restore and the saved-file check know the label. The page loads the
// pool module once and never unloads it, so the blocks run in this order: the plain wallet first,
// with the pool never loaded, and the pool controller last.
// Run: node web/test/sol-plain-app.mjs   (Node 26)
import assert from "node:assert/strict";
import { docFields } from "../signed.js";
import { backupText, backupWords, KIND } from "../sol/backup.js";
import { COLLECTIONS } from "../sol/docs.js";
import { config, loadRig, mainnetConfig, sleep, storage } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, data, waitFor } = rig;
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;
const solOf = (gid, i) => t.sec(gid, i).sol ?? {};
const PLAIN = "mainnet-plain";
const live = (gid, rel = "sol") => rig.live(`groups/${gid}/${rel}`);
const asked = () => waitFor("the answer of the probe", () => typeof t.ui.plainServed === "boolean");
const haveAll = (gid, name) => [1, 2, 3].every((i) => data.get(path(gid, `${name}/${i}`)));
// The page asks once and keeps the answer: a test that asks again clears it first.
const probe = (status) => {
  mainnetConfig.status = status;
  mainnetConfig.calls = 0;
  mainnetConfig.inits.length = 0;
  delete t.ui.plainServed;
};
// A device that never saw the confirmed number: its stored pins of the wallet are gone.
const forget = (gid, names) => {
  const pins = JSON.parse(storage.get("zf-signpins"));
  for (const k of names.map((name) => name + ":" + gid)) {
    delete t.signPins[k];
    delete pins[k];
  }
  storage.set("zf-signpins", JSON.stringify(pins));
};

// ── A server that answers 404 serves no plain wallet ──
const off = await rig.wallet({ name: "Off", network: "mainnet" });
await asked();
assert.equal(t.ui.plainServed, false, "a 404 means that the server serves no plain wallet");
assert.equal(mainnetConfig.calls, 1, "a confirmed mainnet wallet asks the server once");
assert.deepEqual(mainnetConfig.inits, [{ cache: "no-store" }], "and the request is not cached");
assert.equal(t.plainOn(), true, "the wallet is a plain wallet");
assert.equal(t.solOn(), false, "and no pool wallet");
assert.equal(config.calls, 0, "the page asked for no Helius URL");
{
  const start = await t.signedDoc(off, "solstart/1", 1, { cluster: PLAIN, at: Date.now() });
  data.set(path(off, "solstart/1"), start);
  rig.notify();
  await sleep(300);
  assert.equal(live(off), 0, "an unserved plain wallet opens no Solana watch");
  assert.equal(t.plainLoading, null, "and a signed start document loads nothing");
  assert.equal(mainnetConfig.calls, 1, "the page asked once, not once per pass");
  // The old text stays for a mainnet wallet that the server does not serve.
  const file = { kind: KIND, group: off, seat: 1, cluster: PLAIN };
  await assert.rejects(t.applyBackup(file, true), /testnet wallets only/);
  assert.equal(t.plainLoading, null, "a restore of its file loads nothing either");
  // Any answer but a success is no service.
  probe(503);
  t.openGroup(off);
  await asked();
  assert.equal(t.ui.plainServed, false, "a 503 means that the server does not serve it");
  assert.equal(live(off), 0, "and the wallet opens no watch");
  // Only a confirmed mainnet wallet of version 3 is a plain wallet.
  await waitFor("the wallet", () => t.state.gid === off && t.state.g);
  const real = t.state.g;
  for (const network of [undefined, "", "Mainnet", "testnet", " mainnet", "devnet", null]) {
    t.state.g = { ...real, network };
    assert.equal(t.plainOn(), false, "network " + JSON.stringify(network) + " is no plain wallet");
  }
  t.state.g = { ...real, version: 2 };
  assert.equal(t.plainOn(), false, "a wallet before version 3 is no plain wallet");
  t.state.g = null;
  assert.equal(t.plainOn(), false, "a wallet that is not loaded is no plain wallet");
  t.state.g = real;
  const late = await rig.wallet({ name: "Late", network: "mainnet" });
  forget(late, ["network", "confirmednet"]);
  assert.equal(t.netConfirmed(late), undefined, "control: no confirmed network");
  assert.equal(t.state.g.network, "mainnet", "control: the stored network says mainnet");
  assert.equal(t.plainOn(late), false, "the stored network is no confirmation");
}
step("a server that answers 404 serves no plain wallet");

// ── A testnet wallet never asks for the mainnet config ──
const testnet = await rig.wallet({ name: "Test" });
probe(200);
t.openGroup(testnet);
await waitFor("the testnet wallet", () => t.state.gid === testnet && t.state.g);
for (let k = 0; k < 5; k++) {
  rig.notify();
  await sleep(60);
}
assert.equal(mainnetConfig.calls, 0, "a testnet wallet makes no request for the mainnet config");
assert.equal(t.ui.plainServed, undefined, "and the page keeps no answer");
assert.equal(t.plainOn(testnet), false);
step("a testnet wallet never asks for the mainnet config");

// ── A server that serves it: a watch on the start document, and nothing of the pool ──
const on = await rig.wallet({ name: "On", network: "mainnet" });
await waitFor("the answer of the probe", () => t.ui.plainServed === true);
await waitFor("the start watch", () => live(on, "solstart") >= 1);
assert.equal(t.plainLoading, null, "no start document, so nothing loads");
assert.equal(live(on), 1, "the start document is the only Solana watch of the wallet");
assert.equal(mainnetConfig.calls, 1, "one request for the whole page");
assert.equal(t.plainOn(), true);
assert.equal(t.solOn(), false, "a plain wallet is no pool wallet");
assert.equal(t.sol, null, "the pool controller is not loaded");
assert.equal(t.solLoading, null);
step("a served plain wallet watches its start document and nothing else");

// ── Only a start document that a seat signed loads the plain controller ──
{
  const rel = "solstart/1";
  const fields = { cluster: PLAIN, at: Date.now() };
  const signed = await t.signedDoc(on, rel, 1, fields);
  const ignored = async (doc, what) => {
    data.set(path(on, rel), doc);
    rig.notify();
    await sleep(300);
    assert.equal(t.plainLoading, null, what + " loads nothing");
  };
  await ignored({ ...signed, at: signed.at + 1 }, "a start document changed after the signature");
  await ignored(await t.signedDoc(on, rel, 2, fields), "a start document signed by seat 2");
  data.set(path(on, rel), signed);
  rig.notify();
  await waitFor("the plain controller", () => t.plainSol);
  const { plainSol, plainLoading } = t;
  assert.equal(plainSol.ctl.gid, on, "the controller follows the wallet");
  assert.equal(plainSol.ctl.wallet.label, PLAIN);
  assert.equal(t.sol, null, "the pool slot stays empty");
  assert.equal(t.solLoading, null);
  assert.equal(config.calls, 0, "and the page never asked for the Helius URL of the pool");
  await waitFor("the three soldone documents", () => haveAll(on, "soldone"));
  for (const i of [1, 2, 3]) {
    assert.equal(docFields(data.get(path(on, "soldone/" + i))).cluster, PLAIN);
  }
  await sleep(200);
  assert.equal(t.plainSol, plainSol, "the controller loads once");
  assert.equal(t.plainLoading, plainLoading);
}
step("a signed start document loads the plain controller, and the page loop runs the ceremony");

// ── The ceremony runs from the page loop after one call of device 1 ──
const added = await rig.wallet({ name: "Added", network: "mainnet" });
await waitFor("the controller follows the wallet", () => t.plainSol.ctl.gid === added);
await t.plainSol.add();
await waitFor("the three soldone documents", () => haveAll(added, "soldone"));
await waitFor("the three fee documents", () => haveAll(added, "solfee"));
assert.equal(docFields(data.get(path(added, "solstart/1"))).cluster, PLAIN);
assert.equal(t.sol, null, "the ceremony loaded no pool code");
assert.equal(config.calls, 0);
step("the ceremony runs from the page loop");

// ── A wallet switch closes the plain controller ──
{
  const ctl = t.plainSol.ctl;
  const before = mainnetConfig.calls;
  t.openGroup(testnet);
  assert.equal(ctl.gid, null, "opening a testnet wallet closes the plain controller");
  assert.equal(ctl.wallet, null);
  assert.equal(live(added), 0, "and no watch of the mainnet wallet is left");
  await waitFor("the testnet wallet", () => t.state.gid === testnet && t.state.g);
  await waitFor("the start watch", () => live(testnet, "solstart") === 1);
  assert.equal(t.solOn(), true, "the testnet wallet follows the old rules");
  assert.equal(live(testnet), 1, "with the start watch of the pool");
  assert.equal(mainnetConfig.calls, before, "and asks no mainnet config");
  assert.equal(t.sol, null);
  t.openGroup(added);
  await waitFor("the plain controller follows again", () => ctl.gid === added);
}
step("a wallet switch closes the plain controller");

// ── A wallet list and back, and an answer of the probe that comes later ──
{
  const ctl = t.plainSol.ctl;
  t.openGroup(null);
  assert.equal(ctl.gid, null, "the wallet list closes the plain controller");
  t.openGroup(added);
  await waitFor("the watch of the wallet starts again", () => ctl.gid === added);
  // Nothing but the answer of the probe runs the pass that opens the wallet.
  t.resetSolStart();
  probe(200);
  t.refilter();
  await waitFor("the pass after the answer of the probe", () => ctl.gid === added);
  assert.equal(mainnetConfig.calls, 1, "the page asked once");
}
step("the watch starts again after the wallet list, and the answer of the probe runs a pass");

// ── The backup file and the restore know the label ──
{
  const c = t.plainSol.ctl;
  const file = (i) => JSON.parse(backupText(c.host, added, i));
  const good = file(2);
  assert.equal(good.kind, KIND);
  assert.equal(good.cluster, PLAIN, "the backup file of a plain seat names the plain label");
  const words = backupWords(c, 2);
  assert.doesNotMatch(JSON.stringify(words), /viewing|proving/i, "a plain wallet has no such keys");
  assert.match(words.file, /sign as this device for the funds at the group address/);
  assert.match(words.file, /spend the SOL of its fee address/);
  assert.match(backupWords({ ...c, wallet: null }, 2).file, /viewing and proving keys/,
    "the words of the pool stay");
  const clean = async (i) => {
    delete t.sec(added, i).sol;
    await t.putSec(added, i, {});
  };
  await clean(2);
  assert.deepEqual(solOf(added, 2), {});
  const refuses = (change, why) => assert.rejects(t.applyBackup({ ...good, ...change }, true), why);
  await refuses({ cluster: "devnet" }, /another network or mode/);
  await refuses({ cluster: "mainnet" }, /not a Zigs Solana backup/);
  await refuses({ cluster: "mainnet-beta" }, /not a Zigs Solana backup/);
  assert.deepEqual(solOf(added, 2), {}, "no refused file stored anything");
  // A restore that comes before the probe answered waits for the answer.
  probe(200);
  let release;
  const held = new Promise((done) => void (release = done));
  const asking = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "/sol/config-mainnet.json") await held;
    return asking(url, init);
  };
  let settled = false;
  const restoring = t.applyBackup(good, true);
  restoring.then(() => void (settled = true), () => void (settled = true));
  await sleep(300);
  assert.equal(settled, false, "a restore before the answer of the probe waits for it");
  assert.equal(t.ui.plainServed, null, "the probe is out");
  release();
  await restoring;
  globalThis.fetch = asking;
  const part = solOf(added, 2);
  assert.equal(part.cluster, PLAIN, "a restored seat keeps the plain label");
  assert.equal(part.restored, true);
  assert.equal(part.backupSaved, true);
  assert.deepEqual(part.keyPackage, good.keyPackage, "and its own key share");
  assert.equal(part.groupKey, good.groupKey);
  assert.equal(part.solSeed, good.solSeed);
  assert.deepEqual(file(2), good, "the restored seat gives the same file");
  assert.equal(t.sol, null, "the restore loaded no pool code");
  assert.equal(config.calls, 0);
}
step("the backup file, the restore and the words know the label");

// ── A plain file restores while a testnet wallet is open; an unlisted wallet refuses ──
{
  const file = JSON.parse(backupText(t.plainSol.ctl.host, added, 3));
  const listed = structuredClone(t.state.g);
  t.openGroup(testnet);
  await waitFor("the testnet wallet", () => t.state.gid === testnet && t.state.g);
  delete t.sec(added, 3).sol;
  await t.putSec(added, 3, {});
  const pool = config.calls;
  await assert.rejects(t.applyBackup(file, true), /does not know this wallet yet/,
    "a plain file of a wallet that is not listed refuses at once");
  assert.equal(t.sol, null, "and the pool did not load");
  assert.equal(config.calls, pool, "nor did the page ask for its config");
  assert.equal(t.state.gid, testnet, "and the open wallet stays");
  t.state.groups = [{ ...listed, id: added }];
  await t.applyBackup(file, true);
  assert.equal(solOf(added, 3).cluster, PLAIN, "a listed plain wallet restores from any wallet");
  assert.equal(t.state.gid, added, "and the restore opened it");
  t.state.groups = [];
}
step("a plain file restores while another wallet is open, and an unlisted wallet refuses");

// ── The pool controller refuses a plain file and keeps its words ──
{
  const good = JSON.parse(backupText(t.plainSol.ctl.host, added, 1));
  await t.solLoad();
  assert.ok(t.sol, "the pool controller loaded");
  const pool = await rig.wallet({ name: "Pool" });
  await waitFor("the pool controller follows the wallet", () => t.sol.ctl.gid === pool
    && COLLECTIONS.every((name) => t.sol.ctl.loaded[name]));
  await assert.rejects(t.applyBackup({ ...good, group: pool }, true), /another network or mode/);
  await assert.rejects(t.sol.restore({ ...good, group: pool }, true), /another network or mode/);
  assert.deepEqual(solOf(pool, 1), {}, "a plain file stored nothing in a pool seat");
  assert.match(backupWords(t.sol.ctl, 1).file, /viewing and proving keys/);
}
step("the pool controller refuses a plain file and keeps its words");

console.log("sol-plain-app: ok");
process.exit(0);
