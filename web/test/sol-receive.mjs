import assert from "node:assert/strict";
import { solDetailsView, solView } from "../sol/view.js";
import { plainDetailsView, plainView } from "../sol/plain/view.js";
import { base58 } from "../sol/docs.js";
import { receiveFixture } from "./sol-receive-fixture.mjs";

const el = (tag, attrs = {}, ...kids) => ({ tag, attrs, kids: kids.flat(Infinity).filter(Boolean) });
const all = (n, pick) => typeof n === "object"
  ? [...(pick(n) ? [n] : []), ...n.kids.flatMap((k) => all(k, pick))] : [];
const text = (n) => typeof n === "object" ? n.kids.map(text).join(" ") : String(n);
const mark = (tree, name) => all(tree, (n) => n.attrs["data-sol"] === name)[0];
const act = (fn) => fn;
const copies = [], destinations = [];
Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true,
  value: { writeText: async (value) => { copies.push(value); } } });
for (const mode of ["private", "plain", "devnet"]) {
  const c = receiveFixture(el, mode, (surface) => destinations.push(surface));
  const encoded = [];
  c.host.qrBox = (value, label) => {
    encoded.push(value);
    return el("svg", { role: "img", "aria-label": label });
  };
  const pool = mode !== "plain";
  const render = pool ? solView : plainView;
  const details = pool ? solDetailsView : plainDetailsView;
  const tree = render(c, act, {});
  assert.equal(all(tree, (n) => n.attrs["data-key"] === "sol-receive").length, 1);
  assert.equal(all(tree, (n) => n.tag === "button" && (n.attrs["data-sol"] ?? "").startsWith("copy-")).length, 1,
    "receiving offers one address to copy");
  for (const name of ["owner", "group-key", "pool-upgrade", "zigs-upgrade", "fee-address-1",
    "create-nonce", "balance-public"]) assert.equal(mark(tree, name), undefined,
    name + " belongs outside the receive page");
  assert.doesNotMatch(text(tree), /helius-rpc|api-key|synthetic-program/);
  const copyMark = pool ? "copy-shielded" : "copy-address";
  const expected = pool ? (mode === "private" ? "solana-mainnet:" : "") + c.docs.soldone[1].pdaAddress
    : base58(c.docs.soldone[1].groupKey);
  assert.ok(mark(tree, "receive-qr"), "the receive address has a QR code");
  assert.deepEqual(encoded, [expected], "QR and Copy use the same complete address");
  const button = { textContent: "Copy", setAttribute() {} };
  await mark(tree, copyMark).attrs.onclick({ currentTarget: button });
  assert.equal(copies.pop(), expected, "copy uses the complete canonical address");
  for (const surface of ["settings", "security"]) {
    mark(tree, "open-" + surface).attrs.onclick();
    assert.equal(destinations.pop(), surface);
  }
  const security = details(c, act, {}, "security");
  assert.match(text(security), pool ? /payee.*public/ : /every balance and payment/);
  if (pool) {
    assert.match(text(tree), /not a standard Solana account address/);
    assert.ok(mark(security, "pool-upgrade"));
    const settings = details(c, act, {}, "settings");
    if (mode === "private") {
      assert.ok(mark(settings, "owner-warning"));
      assert.equal(mark(settings, "copy-program"), undefined, "unsafe mainnet PDA has no copy");
    } else assert.ok(mark(settings, "copy-program"), "Devnet keeps its diagnostic program copy");
    assert.ok(mark(settings, "group-key"));
  } else {
    assert.match(text(tree), /Only SOL and USDC/);
    assert.equal(mark(tree, "explorer"), undefined, "external explorer belongs in Settings");
    assert.ok(mark(details(c, act, {}, "settings"), "explorer"));
    assert.equal(all(tree, (n) => n.tag === "details").every((n) => !n.attrs.open), true);
  }
  // A disagreement or stop cannot offer an address to deposit to.
  const bad = { ...c, docs: { ...c.docs, soldone: { ...c.docs.soldone,
    2: { ...c.docs.soldone[2], groupKey: "be".repeat(32) } } } };
  assert.equal(mark(render(bad, act, {}), copyMark), undefined);
  assert.equal(mark(render(bad, act, {}), "receive-qr"), undefined);
  const stopped = { ...c, docs: { ...c.docs, solabort: { 1: { reason: "Synthetic stop" } } } };
  assert.equal(mark(render(stopped, act, {}), copyMark), undefined);
  assert.equal(mark(render(stopped, act, {}), "receive-qr"), undefined);
  console.log("ok  " + mode + ": one address, matching QR/copy, routes and refusal states");
}

// Exercise the real app adapter for destinations, focus and per-wallet state.
{
  const { loadRig } = await import("./sol-rig.mjs");
  const { t } = await loadRig();
  t.state.gid = "synthetic-navigation-wallet";
  const host = t.solHost();
  assert.equal(typeof host.qrBox, "function", "the app provides its local QR renderer");
  assert.equal(typeof host.receiveAddress, "function", "the app provides expandable long addresses");
  for (const [surface, tab] of [["settings", "settings"], ["security", "recovery"]]) {
    host.openSolDetails(surface);
    assert.equal(t.ui.tab, tab);
    assert.deepEqual(t.ui.solDetailsTarget, { gid: t.state.gid, surface });
    assert.equal(t.wantFocus.key, "sol-" + surface);
  }
  t.ui.solanaAction = { gid: t.state.gid, action: "send" };
  assert.equal(host.solanaAction(), "send");
  t.state.gid = "another-synthetic-wallet";
  assert.equal(host.solanaAction(), "receive", "a different wallet starts with receiving");
  console.log("ok  app adapter: Settings/Security routing, focus and per-wallet action state");
}

console.log("sol-receive: ok");
process.exit(0);
