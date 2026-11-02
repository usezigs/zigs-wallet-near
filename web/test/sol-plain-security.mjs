// The Security page and the help diagnostics of a plain Solana wallet (securityRecoveryTab of
// web/app-wallet.js, solPartSetup of web/app-sol.js, web/app-help.js) against the real page
// modules and the real wasm (sol-rig.mjs). It shows: a mainnet wallet that the server does not
// serve, and a wallet with no Solana part, list no Solana file; a served wallet lists the Solana
// key share of each local device with its backup and the result of the saved-file check; a part
// that sets up, a part with keys that differ and a part that stopped have their own scope; the
// diagnostics say the state of the plain part, "unavailable" for an unserved mainnet wallet, and
// count nothing of payments. The page loads no pool code. A testnet wallet keeps the scope of the
// pool.
// Run: node web/test/sol-plain-security.mjs   (Node 26)
import assert from "node:assert/strict";
import { checkBackupPayload } from "../backup-check.js";
import { agreement } from "../sol/ceremony.js";
import { backupText } from "../sol/backup.js";
import { config, loadRig, mainnetConfig } from "./sol-rig.mjs";

const rig = await loadRig();
const { diagnostics } = await import("../app-help.js");
const { backupCheckExpected } = await import("../app-backups.js");
const { beginGuided, markBackupChecked } = await import("../app-guided-setup.js");
const { plainShown } = await import("../app-sol.js");
const { t, data, waitFor } = rig;
const step = (name) => console.log("ok  " + name);
const path = (gid, rel) => `groups/${gid}/${rel}`;

// ── The page text, with a recorder in place of the document ──
class Rec extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, kids: [], attrs: {}, on: {}, style: {} });
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(k, v) { this.on[k] = v; }
  append(...kids) { this.kids.push(...kids); }
}
const text = (n) => n.text ?? n.kids.map(text).join("");
const all = (n, test) => [...(test(n) ? [n] : []), ...(n.kids ?? []).flatMap((k) => all(k, test))];
const one = (n, test) => all(n, test)[0];
const recording = (document) => new Proxy(document, { get: (o, k) => ({
  createElement: (tag) => new Rec(tag), createElementNS: (_ns, tag) => new Rec(tag),
  createTextNode: (value) => ({ text: value }),
})[k] ?? o[k] });
const security = () => {
  const before = globalThis.document;
  globalThis.document = recording(before);
  try {
    t.ui.tab = "recovery";
    return t.walletView(null, null);
  } finally {
    globalThis.document = before;
  }
};
const click = (node) => node.on.click({ preventDefault() {}, currentTarget: {} });

// ── What the Security page says about the Solana files ──
const SOLANA = "Solana key share";
const chains = (tree) => all(tree, (n) => n.className === "security-signer-chains").map(text);
const device = (tree, id) => one(tree, (n) => n.attrs?.id === "security-signer-" + id);
const fileRow = (tree, id) => all(device(tree, id), (n) => n.className === "security-file-row")
  .find((row) => text(one(row, (n) => n.tag === "strong")) === SOLANA);
const status = (tree, id) => text(one(fileRow(tree, id),
  (n) => n.className === "security-file-copy").kids[1]);
const key = (tree, name) => one(tree, (n) => n.attrs?.["data-key"] === name);
const notes = (tree) => all(tree, (n) => n.className === "security-scope-note").map(text).join(" ");
const review = (tree) => all(tree, (n) => n.tag === "button" && text(n) === "Review Solana status");
const noSolana = (tree, what) => {
  assert.deepEqual([...new Set(chains(tree))], ["Zcash"], what + ": every device is Zcash");
  for (const id of [1, 2, 3]) assert.equal(fileRow(tree, id), undefined, what + ": no Solana file");
};
const noPool = () => {
  assert.equal(t.sol, null, "the page loaded no pool code");
  assert.equal(config.calls, 0, "and asked for no Helius Devnet URL");
};
const lines = (re) => diagnostics().split("\n").filter((line) => re.test(line));

// ── A mainnet wallet that the server does not serve ──
mainnetConfig.status = 404;
await rig.wallet({ name: "Off", network: "mainnet" });
await waitFor("the answer of the probe", () => t.ui.plainServed === false);
assert.equal(plainShown(), false);
noSolana(security(), "an unserved mainnet wallet");
assert.deepEqual(lines(/^Solana/), ["Solana part: unavailable"],
  "its diagnostics say unavailable and count nothing");
noPool();
step("an unserved mainnet wallet lists no Solana file and says unavailable");

// ── A served wallet that has no Solana part yet ──
Object.assign(mainnetConfig, { status: 200, calls: 0 });
delete t.ui.plainServed;
const gid = await rig.wallet({ name: "Plain", network: "mainnet" });
await waitFor("the answer of the probe", () => t.ui.plainServed === true);
await waitFor("the start documents", () => t.plainNotAdded());
assert.equal(plainShown(), true);
noSolana(security(), "a wallet with no Solana part");
assert.deepEqual(lines(/^Solana/), ["Solana part: not added"],
  "its diagnostics say not added and count nothing");
noPool();
step("a served wallet with no Solana part lists no Solana file and says not added");

// ── The seats set up; the page waits for the documents ──
const start = await t.signedDoc(gid, "solstart/1", 1, { cluster: "mainnet-plain", at: Date.now() });
data.set(path(gid, "solstart/1"), start);
rig.notify();
await waitFor("the plain controller", () => t.plainSol?.ctl.gid === gid);
await waitFor("the part is ready", () => t.plainSol.setup()?.status === "ready"
  && agreement(t.plainSol.ctl).state === "agree", 60000);
const c = t.plainSol.ctl;
// The page holds the reactor in places: the controller reads its raw documents at each call, so a
// block with no await shows the part in another state.
// The signature check accepts every document here, so a forged key is a document that differs.
const withRaw = (change, show) => {
  const { raw, host } = c;
  c.raw = { ...raw, ...change(raw) };
  c.host = { ...host, checkIn: () => () => "yes" };
  try {
    return show();
  } finally {
    Object.assign(c, { raw, host });
  }
};
{
  const tree = withRaw((raw) => ({ soldone: { 1: raw.soldone[1] } }), security);
  assert.match(notes(tree), /Solana · Status is still being read or setup is unfinished\./,
    "a part that sets up has its own scope");
  assert.equal(review(tree).length, 1, "with a button to the Solana section");
  assert.equal(key(tree, "security-check-1-sol").attrs.disabled, "",
    "and no saved file is checked before the part is ready");
  const text1 = withRaw((raw) => ({ soldone: { 1: raw.soldone[1] } }), diagnostics);
  assert.match(text1, /^Solana part: setting up$/m);
  assert.match(text1, /^Solana backup files not saved: \d+$/m);
  assert.match(text1, /^Solana payments to approve: 0$/m, "the count of the sends to approve");
  const forged = (raw) => ({ soldone: { ...raw.soldone, 2: { ...raw.soldone[2],
    groupKey: "00".repeat(32) } } });
  const differs = withRaw(forged, security);
  assert.match(notes(differs), /Setup stopped\. Do not use the Solana part\./,
    "keys that differ are an unusable part, as the Solana tab says");
  assert.equal(review(differs).length, 1, "with a button to the Solana section");
  assert.match(withRaw(forged, diagnostics), /^Solana part: keys differ$/m);
  const none = withRaw(() => ({ solstart: {}, soldone: {} }), security);
  noSolana(none, "a part that never started");
}
{
  const { host } = c;
  const stop = "Solana setup stopped: a device left. Do not use the Solana part of this wallet.";
  c.host = { ...host, sec: () => ({ sol: { aborted: stop } }) };
  try {
    const tree = security();
    assert.match(notes(tree), /Setup stopped\. Do not use the Solana part\./, "a stopped part");
    assert.equal(review(tree).length, 1);
    assert.match(diagnostics(), /^Solana part: stopped$/m);
  } finally {
    c.host = host;
  }
}
noPool();
step("a part that sets up, differs or stopped has its own scope and word");

// ── A ready part: the key share of each device, its backup, the check of the saved file ──
const SAME_RULE = /Zcash \+ Solana · same approval rule/;
{
  const tree = security();
  assert.deepEqual(chains(tree), ["Zcash · Solana", "Zcash · Solana", "Zcash · Solana"]);
  assert.match(text(one(tree, (n) => n.className === "security-overview")), SAME_RULE,
    "the signing rule covers both chains");
  assert.equal(notes(tree).includes("Solana ·"), false, "a ready part has no scope note");
  assert.equal(review(tree).length, 0);
  for (const id of [1, 2, 3]) {
    assert.equal(status(tree, id), "Not saved or checked", "device " + id + " has no file yet");
    assert.ok(key(tree, `security-backup-${id}-sol`), "device " + id + " can back up");
    assert.equal(key(tree, `security-check-${id}-sol`).attrs.disabled, undefined,
      "and can check a saved file once it saved one");
  }
  assert.match(text(one(tree, (n) => n.className === "security-overview")), / of 6 checked/,
    "the count of recovery files holds the Solana files");
  const live = diagnostics();
  assert.match(live, /^Solana part: ready$/m);
  assert.match(live, /^Solana backup files not saved: 3$/m);
  assert.match(live, /^Solana payments to approve: 0$/m);
  await click(key(tree, "security-backup-2-sol"));
  assert.match(t.ui.backup?.words.title ?? "", /Back up the Solana part of device 2/,
    "Back up opens the backup of the plain seat");
  t.ui.backup = null;
  await click(key(tree, "security-check-2-sol"));
  assert.deepEqual([t.ui.backup?.check, t.ui.backup?.chain, t.ui.backup?.seat],
    [true, "sol", 2], "Verify file opens the check of the plain seat");
  t.ui.backup = null;
  for (const id of [1, 2, 3]) {
    const names = all(device(tree, id), (n) => n.tag === "button" && n.attrs["aria-label"]);
    assert.ok(names.length >= 4 && names.every((n) => n.attrs["aria-label"].startsWith(text(n))),
      "device " + id + ": the name of a button starts with its visible text");
  }
  const file = JSON.parse(backupText(c.host, gid, 2));
  const expected = backupCheckExpected(gid, 2, "sol");
  assert.equal(expected.cluster, "mainnet-plain", "the check expects the label of a plain seat");
  assert.equal(checkBackupPayload(file, expected), true, "it accepts the file that Back up writes");
  assert.throws(() => checkBackupPayload({ ...file, cluster: "devnet" }, expected),
    /not the saved recovery file/, "and refuses a file with the label of the pool");
  noPool();
}
await t.putSec(gid, 1, { sol: { ...t.sec(gid, 1).sol, backupSaved: true } });
assert.equal(status(security(), 1), "Saved · not checked", "a saved file is not a checked file");
assert.match(diagnostics(), /^Solana backup files not saved: 2$/m);
await markBackupChecked(gid, 1, "sol");
{
  const tree = security();
  assert.equal(status(tree, 1), "Checked in this browser", "the result of the check shows");
  assert.equal(status(tree, 2), "Not saved or checked", "and only for the device that checked");
  assert.match(text(one(tree, (n) => n.className === "security-overview")), /1 of 6 checked/);
}
const part = t.sec(gid, 3).sol;
delete t.sec(gid, 3).sol;
{
  const tree = security();
  assert.equal(status(tree, 3), "Share missing here", "a device with no key share here");
  assert.match(text(one(tree, (n) => n.attrs?.role === "alert")), /Device 3 has signing material/);
  assert.ok(one(device(tree, 3), (n) => n.tag === "button" && text(n) === "Restore file"));
}
t.sec(gid, 3).sol = part;
noPool();
step("a ready part lists the Solana key shares with their backup and the saved-file check");

// ── The diagnostics before the page has read the part ──
{
  const real = t.secrets, loaded = c.loaded;
  const k = Object.keys(real).find((name) => name.startsWith(gid + ":") && real[name].keyPackage);
  t.secrets = { ...real, [k]: { ...real[k], sol: undefined } };
  c.loaded = { ...loaded, soldone: false };
  try {
    const unread = diagnostics();
    assert.match(unread, /^Solana part: not read yet$/m, "the part says not read yet");
    assert.match(unread, /^Solana backup files not saved: not read yet$/m, "and so do its files");
  } finally {
    t.secrets = real;
    c.loaded = loaded;
  }
}
step("the diagnostics say not read yet before the page read the part");

// ── A testnet wallet is no plain wallet ──
await rig.wallet({ name: "Test" });
assert.equal(plainShown(), false);
await waitFor("the pool start documents", () => /^Solana part: not added$/m.test(diagnostics()));
assert.match(diagnostics(), /^Network: testnet$/m);
step("a testnet wallet is no plain wallet");

// ── The Security page of that wallet keeps the scope of the pool ──
noSolana(security(), "a testnet wallet with no start");
beginGuided(t.state.gid, { solExpected: true });
{
  const tree = security();
  assert.match(notes(tree), /Solana · Status is still being read or setup is unfinished\./,
    "a wallet that expects Solana and has no start has the scope of a part that sets up");
  assert.equal(review(tree).length, 1, "a testnet wallet has its button to the Solana section");
}
step("a testnet wallet keeps the Security scope of the pool");

console.log("sol-plain-security: ok");
process.exit(0);
