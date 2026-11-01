// The controller of the plain Solana wallet of a confirmed mainnet wallet (ZOLANA.md 3.8-4.1).
// It runs the second DKG of ceremony.js with the label "mainnet-plain" and loads no pool code: no
// Worker, no prover, no session, signing or view module, and it reads no config. A test follows
// the imports of this file, so every path below is a literal, and none is computed.
import { reactAborts } from "../abort.js";
import { addSolana, reactCeremony } from "../ceremony.js";
import { COLLECTIONS, filterSol } from "../docs.js";
import * as W from "../wasm/sol_wasm.js";
import { walletOf } from "../wallet.js";

const LOG_MAX = 200;

// What belongs to the open wallet. The host and the wasm outlive it.
let opens = 0;
const blank = () => ({
  opened: ++opens,
  gid: null,
  base: null,
  wallet: null,
  raw: {},
  loaded: {},
  unsubs: [],
  logged: new Set(),
  docs: Object.fromEntries(COLLECTIONS.map((name) => [name, {}])),
  wait: 0,
});

function teardown(c) {
  for (const stop of c.unsubs) stop();
  Object.assign(c, blank());
}

function logIgnored(c, rel) {
  if (c.logged.has(rel) || c.logged.size >= LOG_MAX) return;
  c.logged.add(rel);
  c.host.log("ignored Solana data without a valid signature: " + rel);
}

/** Reads the stored documents again, with the signature checks of the page (memoised there). */
function refresh(c) {
  const f = filterSol(c.raw, c.host.checkIn(c.gid), (rel) => logIgnored(c, rel));
  Object.assign(c, { docs: f.docs, wait: f.wait });
}

// Opens only a version 3 wallet whose confirmed network gives a plain wallet. The network comes
// from the confirmed number (netConfirmed) and never from the group document.
function openGroup(c, gid, base) {
  teardown(c);
  if (!gid || c.host.groupVersion() !== 3) return;
  const wallet = walletOf(c.W, c.host.netConfirmed(gid));
  if (wallet?.mode !== "plain") return;
  Object.assign(c, { gid, base, wallet });
  for (const name of COLLECTIONS) {
    const onDocs = (snap) => {
      if (c.gid !== gid) return;
      c.raw[name] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
      c.loaded[name] = true;
      c.host.refilter();
    };
    const onError = (e) => c.host.log("subscription error on " + name + ": " + e.code);
    c.unsubs.push(c.host.sdb.collection(base + "/" + name).onSnapshot(onDocs, onError));
  }
}

function react(c) {
  if (!c.wallet || c.gid !== c.host.state.gid) return;
  refresh(c);
  reactCeremony(c);
  reactAborts(c);
}

/** Loads the wasm and returns the controller of the plain Solana wallet. */
export async function attach(host) {
  await W.default();
  const c = { host: { ...host, mode: "plain" }, W, ...blank() };
  return {
    ctl: c, // the state of the controller, for the tests
    open: (gid, base) => openGroup(c, gid, base),
    close: () => teardown(c),
    react: () => react(c),
    add: () => addSolana(c),
  };
}
