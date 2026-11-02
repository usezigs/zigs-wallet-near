// A plain controller that fails to load (plainLoad in web/app-sol.js): the Solana tab says so, one
// banner shows, the page does not try again (only a reload mends it), and a backup or a restore
// says that Solana did not load. attach fails at its listener for a tab that shows again.
// Run: node web/test/sol-plain-load.mjs   (Node 26)
import assert from "node:assert/strict";
import { KIND } from "../sol/backup.js";
import { config, loadRig, mainnetConfig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, waitFor } = rig;

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
const tabText = () => {
  const before = globalThis.document;
  globalThis.document = new Proxy(before, { get: (o, k) => ({
    createElement: (tag) => new Rec(tag), createElementNS: (_ns, tag) => new Rec(tag),
    createTextNode: (value) => ({ text: value }),
  })[k] ?? o[k] });
  try {
    t.ui.tab = "solana";
    return text(t.walletView(null, null));
  } finally {
    globalThis.document = before;
  }
};

let attached = 0;
const real = globalThis.document;
// The listener of the plain controller is the one that asks the reactor for a pass.
const fails = (type, fn) => {
  if (!String(fn).includes("refilter")) return;
  attached++;
  throw new Error("no listener");
};
globalThis.document = new Proxy(real, { get: (o, k) => (k === "addEventListener" ? fails : o[k]) });
mainnetConfig.status = 200;
const gid = await rig.wallet({ name: "Load", network: "mainnet" });
await waitFor("the answer of the probe", () => t.ui.plainServed === true, 10000);
assert.match(tabText(), /Loading Solana…/, "the tab starts the load");
await waitFor("the failure", () => /did not load/.test(tabText()), 10000);
const shown = "Solana did not load: no listener";
assert.match(tabText(), new RegExp(shown), "the tab says why");
assert.equal(t.banner.text, shown, "one banner says it too");
assert.doesNotMatch(tabText(), /Try again/, "a reload is the only retry");
for (let k = 0; k < 10; k++) {
  t.refilter();
  tabText();
  await sleep(40);
}
assert.equal(attached, 1, "the page does not try again");
assert.equal(t.plainSol, null);
await assert.rejects(t.applyBackup({ kind: KIND, group: gid, seat: 1, cluster: "mainnet-plain" },
  true), /Solana did not load\./, "a restore says that Solana did not load");
await assert.rejects(t.solBackup(1), new RegExp(shown), "so does a backup");
assert.equal(attached, 1, "and neither loaded again");
assert.equal(t.sol, null, "the pool did not load");
assert.equal(config.calls, 0);
globalThis.document = real;
console.log("ok  a plain controller that fails to load shows one text and is not tried again");
console.log("sol-plain-load: ok");
process.exit(0);
