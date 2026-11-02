// The controller of the plain Solana wallet of a confirmed mainnet wallet (ZOLANA.md 3.8-4.1).
// It runs the second DKG of ceremony.js with the label "mainnet-plain" and reads the balances of
// the group through the plain Worker, web/sol/plain/worker.js, which it starts after the server
// sent the policy header of that file. It loads no pool code: no pool Worker, no prover, no
// session, signing or view module. The mainnet config route is its only other request. A test
// follows the imports of this file, so every path below is a literal, and none is computed.
import { reactAborts } from "../abort.js";
import { addSolana, agreement, reactCeremony } from "../ceremony.js";
import { startSolWorker } from "../client.js";
import { COLLECTIONS, filterSol } from "../docs.js";
import * as W from "../wasm/sol_wasm.js";
import { walletOf } from "../wallet.js";
import { PLAIN_WORKER_POLICY } from "./guard.js";
import { readBalances } from "./reads.js";
import { plainSetup, plainView, readTexts } from "./view.js";

const LOG_MAX = 200;
// Helius allows few calls: one read job at a time, and one read of a wallet in 30 s, also after a
// failed one.
const READ_GAP_MS = 30_000;
const NO_SOLANA = new Set([404, 503]); // the answers of a server that does not serve mainnet
const UNAVAILABLE = "Solana mainnet is not available on this server";
const NOT_LOADED = "Solana did not load. Check your connection, then reload the page.";
const NO_POLICY =
  "The server did not send the policy of the Solana worker, so the worker was not started.";
const WRONG_CLUSTER = "The Solana worker answered for another cluster, so it was not used.";
const CLOSED = "The wallet closed during this Solana read.";
const TOO_SLOW = "Solana did not start in time. Check your connection.";
const START_MS = 20_000; // the limit of each step of the start of the Worker

// What belongs to the open wallet. The host, the wasm and the read records outlive it.
let opens = 0;
const unread = () => ({
  at: null, sol: null, usdc: null, usdcError: "", fees: {}, error: "", next: 0,
});
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
  worker: null,
  watched: false,
  balances: unread(),
});

function teardown(c) {
  for (const stop of c.unsubs) stop();
  c.worker?.close();
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
  if (!c.reads.has(gid)) c.reads.set(gid, unread());
  c.balances = c.reads.get(gid);
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

/** The Helius mainnet URL that the server gives. It is a secret: nothing keeps or logs it. */
async function fetchMainnetUrl() {
  const res = await fetch("/sol/config-mainnet.json", { cache: "no-store" }).catch(() => null);
  if (NO_SOLANA.has(res?.status)) throw new Error(UNAVAILABLE);
  const url = res?.ok ? (await res.json().catch(() => null))?.rpcUrl : undefined;
  if (typeof url !== "string" || !url) throw new Error(NOT_LOADED);
  return url;
}

async function requireWorkerPolicy() {
  const res = await fetch("/sol/plain/worker.js").catch(() => null);
  if (!res?.ok || res.headers.get("content-security-policy") !== PLAIN_WORKER_POLICY) {
    throw new Error(NO_POLICY);
  }
}

// Ends a step of the start that hangs: a hung start would hold the one read key for every wallet.
const within = (promise) =>
  new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error(TOO_SLOW)), START_MS);
    promise.then(ok, bad).finally(() => clearTimeout(timer));
  });

// The Worker of the open wallet: it starts once the server's policy header is the expected one,
// and its answer to init names the cluster of the wallet. It is on c from its start, so that
// teardown closes it also while it is in init: that frees the read key.
async function ensureWorker(c) {
  if (c.worker) return c.worker;
  const { opened, wallet } = c;
  await within(requireWorkerPolicy());
  const rpcUrl = await within(fetchMainnetUrl());
  if (c.opened !== opened) throw new Error(CLOSED);
  const worker = startSolWorker("/sol/plain/worker.js");
  c.worker = worker;
  try {
    const answer = await within(worker.call("init", { cluster: wallet.cluster, rpcUrl }));
    if (answer.cluster !== wallet.cluster) throw new Error(WRONG_CLUSTER);
  } catch (e) {
    if (c.worker === worker) c.worker = null;
    worker.close();
    throw e;
  }
  return worker;
}

// A failed read keeps the old balances, shows its error and waits READ_GAP_MS before the next one.
// A timer wakes the reactor when the gap ends, after a good read too: the next read comes from it.
async function readJob(c, opened, groupKey) {
  const record = c.balances;
  record.next = Date.now() + READ_GAP_MS;
  try {
    const worker = await ensureWorker(c);
    const read = await readBalances(c, worker, groupKey);
    if (c.opened === opened) Object.assign(record, read, { at: Date.now(), error: "" });
  } catch (e) {
    if (c.opened !== opened) return;
    Object.assign(record, { error: String(e?.message ?? e), next: Date.now() + READ_GAP_MS });
  }
  setTimeout(() => c.host.refilter(), Math.max(0, record.next - Date.now()) + 100);
  c.host.render();
}

const hidden = () => globalThis.document?.visibilityState === "hidden";

// Reads when the wallet is shown (observe), its seats agree, the tab is visible and the gap of
// this wallet has passed. host.once lets one read job run at a time.
function readIfDue(c) {
  if (!c.watched || Date.now() < c.balances.next || hidden()) return;
  const { done } = agreement(c);
  if (done) c.host.once("sol:read", () => readJob(c, c.opened, done.groupKey));
}

function react(c) {
  if (!c.wallet || c.gid !== c.host.state.gid) return;
  refresh(c);
  reactCeremony(c);
  reactAborts(c);
  readIfDue(c);
}

const settled = (c) => COLLECTIONS.every((name) => c.loaded[name]);
// Null until the documents of the wallet arrived. A start that still waits for its signature check
// is not "not started" yet.
const setupOf = (c) => {
  if (!settled(c)) return null;
  const setup = plainSetup(c);
  return setup.status === "not started" && c.wait > 0 ? null : setup;
};
// Does the Solana part count seat i (its soldone document)? Null while that is not known.
const madeOf = (c, i) => {
  if (!settled(c)) return null;
  return c.docs.soldone[i] ? true : c.wait > 0 ? null : false;
};

/** Loads the wasm and returns the controller of the plain Solana wallet. */
export async function attach(host) {
  await W.default();
  const c = { host: { ...host, mode: "plain" }, W, reads: new Map(), ...blank() };
  c.refresh = () => refresh(c); // restoreSolana reads the documents again while it waits
  // A hidden tab reads nothing: a pass of the reactor runs the read that came due meanwhile.
  globalThis.document?.addEventListener("visibilitychange", () => host.refilter());
  // The page does nothing to the chain until a screen shows the wallet and calls observe.
  const observe = (gid) => {
    if (gid !== c.gid || gid !== c.host.state.gid) return;
    c.watched = true;
    refresh(c);
    readIfDue(c);
  };
  return {
    ctl: c, // the state of the controller, for the tests
    open: (gid, base) => openGroup(c, gid, base),
    close: () => teardown(c),
    react: () => react(c),
    add: () => addSolana(c),
    observe,
    view: (act, actions) => plainView(c, act, { ...actions, add: () => addSolana(c) }),
    setup: () => setupOf(c),
    made: (i) => madeOf(c, i),
    read: () => readTexts(c),
  };
}
