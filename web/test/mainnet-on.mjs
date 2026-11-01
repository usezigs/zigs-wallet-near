// Mainnet is on (M1 of docs/hackathon-release.md), and the testnet faucet is the Valar faucet
// (M2). The network picker of a new wallet and of the personal account offers Testnet and Mainnet,
// Testnet is chosen, and Mainnet shows a tick that must be checked. A chat reads testnet and
// mainnet requests. Run: node web/test/mainnet-on.mjs   (Node 26)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadRig } from "./sol-rig.mjs";

const rig = await loadRig();
const { t } = rig;
const { MAINNET_ON, NETWORKS } = await import("../app-chain.js");
const { networkPick } = await import("../app-dom.js");
assert.equal(MAINNET_ON, true, "mainnet is on in this release");

// The page, drawn with a recorder in place of the document.
class Rec extends globalThis.Node {
  constructor(tag) { super(); Object.assign(this, { tag, kids: [], attrs: {}, style: {}, on: {} }); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { this.on[type] = fn; }
  append(...nodes) { this.kids.push(...nodes); }
}
const drawn = (build) => {
  const real = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new Rec(tag), createTextNode: (text) => ({ text }),
  };
  try { return build(); } finally { globalThis.document = real; }
};
const all = (node, ok) => typeof node !== "object" || node === null ? []
  : [...(ok(node) ? [node] : []), ...(node.kids ?? []).flatMap((k) => all(k, ok))];
const textOf = (node) => node?.text ?? (node?.kids ?? []).map(textOf).join("");
const inputs = (node) => all(node, (x) => x.tag === "input");
const radios = (node) => inputs(node).filter((x) => x.attrs.type === "radio");
const ticks = (node) => inputs(node).filter((x) => x.attrs.type === "checkbox");

// Testnet is chosen and Mainnet is offered. The tick shows when Mainnet is chosen, and it is
// checked only when the person checked it.
{
  const pick = drawn(() => networkPick({ net: "testnet", ack: false }));
  assert.deepEqual(radios(pick).map((r) => r.attrs.value), ["testnet", "mainnet"]);
  assert.deepEqual(radios(pick).map((r) => "checked" in r.attrs), [true, false],
    "Testnet is chosen");
  assert.equal(ticks(pick).length, 0, "no tick for Testnet");
  assert.match(textOf(pick), /Real ZEC\. At 0\.5 ZEC the app warns and hides the address/);
}
for (const ack of [false, true]) {
  const sel = { net: "mainnet", ack };
  const pick = drawn(() => networkPick(sel, "account", "p"));
  assert.deepEqual(radios(pick).map((r) => "checked" in r.attrs), [false, true],
    "Mainnet is chosen");
  assert.equal(ticks(pick).length, 1, "one tick for Mainnet");
  assert.equal("checked" in ticks(pick)[0].attrs, ack, "the tick shows the choice");
  assert.equal(ticks(pick)[0].attrs.id, "p-ack");
  assert.match(textOf(pick), /I understand that Zigs is not audited and that I can lose the funds in this account\./);
  ticks(pick)[0].on.change({ target: { checked: !ack } });
  assert.equal(sel.ack, !ack, "the tick writes the choice");
}
const pickMainnet = { net: "testnet", ack: false };
const radio = radios(drawn(() => networkPick(pickMainnet)))[1];
radio.on.change();
assert.equal(pickMainnet.net, "mainnet", "the Mainnet radio chooses Mainnet");
// The create dialog and the personal account start on testnet, with no tick.
assert.deepEqual([t.ui.net, t.ui.ack, t.ui.personal.net, t.ui.personal.ack],
  ["testnet", false, "testnet", false]);
console.log("ok  the picker offers Testnet and Mainnet, and Mainnet shows the tick");

// A chat reads testnet and mainnet requests.
const testAddr = "utest1m6h0x5p0ryej3e4raszk99rz3k3gxzj35j7ypw3mm98uxmxt3x7mnmu22cprpl7rls4cc5k"
  + "xzvhqxju6pp4rxsw6ajnkm0d4egf4yrjx";
const mainAddr = "u1ljgj2vz0uzz5ku88wq07pqwepyyaw6azem5rnl56xu0wfjkxpkd84e40y36wy6da7f"
  + "vcd845jwl09pg9uwc5zlx0cead3xsz7vuqm5z2";
const testReq = t.requestOf(`zcash:${testAddr}?amount=1`, true);
assert.ok(testReq && testReq.payees.length === 1, "a testnet request reads in a chat");
assert.equal(testReq.net, "test", "as a testnet request");
const mainReq = t.requestOf(`zcash:${mainAddr}?amount=1`, true);
assert.ok(mainReq && mainReq.payees.length === 1, "a mainnet request reads in a chat");
assert.equal(mainReq.net, "main", "as a mainnet request");
// A wallet and an account read the requests of their own network only.
const account = (network) => t.requestOf(`zcash:${mainAddr}?amount=1`, false, network);
assert.equal(account("mainnet")?.net, "main", "a mainnet account reads its own requests");
assert.notEqual(account("testnet")?.net, "main", "a testnet account reads no mainnet request");
const open = t.state.g;
t.state.g = { ...open, network: "mainnet" };
const room = t.requestOf(`zcash:${mainAddr}?amount=2`, false);
t.state.g = open;
assert.equal(room?.net, "main", "the room of a mainnet wallet reads its own requests");
console.log("ok  a chat reads testnet and mainnet requests");

// The faucet is the Valar testnet faucet. Mainnet has a server and a warning level.
assert.equal(NETWORKS.testnet.faucet, "https://faucet.testnet.valargroup.dev/");
assert.deepEqual(NETWORKS.mainnet.servers, ["https://zcash-mainnet.chainsafe.dev"]);
assert.equal(NETWORKS.mainnet.cap, 50000000, "the warning level is 0.5 ZEC");
assert.equal(NETWORKS.mainnet.prefix, "u1");
console.log("ok  the faucet is the Valar testnet faucet; mainnet has one server and a cap");

// Metadata names the actual networks; visible navigation omits repeated release boilerplate.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\s+/g, " ");
assert.equal(html.match(/Zcash \(testnet or mainnet\) and Solana Devnet/g)?.length, 1,
  "the description keeps the actual networks without repeated navigation boilerplate");
assert.doesNotMatch(html, /Beta:|>Beta<|Not audited\./,
  "visible navigation omits repeated release warnings");
assert.match(html, /A private Solana payment hides its amount, but its payee is public\./,
  "the description says that a private Solana payment hides its amount");
assert.equal(html.match(/hides its amount/g)?.length, 1, "and no other line makes the claim");
assert.doesNotMatch(html, /A Solana payment hides/, "a Solana deposit shows its amount");
console.log("ok  the page texts name Zcash and Solana Devnet");
console.log("mainnet-on: ok");
process.exit(0);
