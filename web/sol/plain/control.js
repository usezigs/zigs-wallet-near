// The controller of the plain Solana wallet of a confirmed mainnet wallet (ZOLANA.md 3.8-4.1).
// It runs the second DKG of ceremony.js with the label "mainnet-plain" and reads the balances of
// the group through the plain Worker, web/sol/plain/worker.js, which it starts after the server
// sent the policy header of that file. It loads no pool code: no pool Worker, no prover, no
// session, signing or view module (it has its own twins, plain/sessions.js and plain/sign.js, and
// shares the nonce lock of nonces.js). The mainnet config route is its only other request. A
// test follows the imports of this file, so every path below is a literal, and none is computed.
import { reactAborts } from "../abort.js";
import { addSolana, agreement, reactCeremony } from "../ceremony.js";
import { startSolWorker } from "../client.js";
import { COLLECTIONS, filterSol } from "../docs.js";
import { pendingShare, savedNonces } from "../nonces.js";
import * as W from "../wasm/sol_wasm.js";
import { walletOf } from "../wallet.js";
import { approvePlain, reviewSession } from "./approve.js";
import { closeDirect, confirmDirect, startDirect } from "./direct.js";
import { PLAIN_WORKER_POLICY } from "./guard.js";
import { readHeld } from "./held.js";
import { proposeSend, swapTyped, unitsOf } from "./propose.js";
import { readBalances } from "./reads.js";
import { ENDED, SESSIONS, feeShared, filterSessions, showable } from "./sessions.js";
import {
  NOTHING_PROPOSED, announceChanges, approveLooked, closeLook, depositPaid, pendingList,
  pendingRows, rowsOf, startLook, swapPayError,
} from "./sends.js";
import { limited, reactSessions } from "./sign.js";
import { plainDetailsView, plainSetup, plainView, readTexts } from "./view.js";

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
// Any holder of the wallet link can add session documents. The page watches the commits and the
// shares of the valid sessions that did not end, and at most this many of one proposer: a seat
// that posts many sessions cannot take every watch.
const WATCH_SEAT = 8;

// What belongs to the open wallet. The host, the wasm and the read records outlive it.
let opens = 0;
const unread = () => ({
  at: null, sol: null, usdc: null, usdcError: "", fees: {}, nonces: null, error: "", next: 0,
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
  started: null,
  watched: false,
  balances: unread(),
  direct: null,
  form: { asset: "sol", error: null },
  look: null,
  said: null,
  sessions: [],
  commits: {},
  shares: {},
  sessWait: 0,
  watching: new Map(),
  tries: new Map(),
  fails: new Map(),
  refused: new Map(),
  went: new Map(),
  unsure: new Map(),
  signedSeen: new Map(),
});

function teardown(c) {
  for (const stop of [...c.unsubs, ...c.watching.values()]) stop();
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
  const check = c.host.checkIn(c.gid);
  const onBad = (rel) => logIgnored(c, rel);
  const f = filterSol(c.raw, check, onBad);
  const s = filterSessions(c.raw, check, onBad, (seat) => feeShared(f.docs, seat));
  Object.assign(c, { docs: f.docs, wait: f.wait, sessWait: s.wait });
  Object.assign(c, { sessions: s.sessions, commits: s.commits, shares: s.shares });
}

// The commits and the shares of a session are collections below its document. Returns the
// function that stops both watches.
function watchSession(c, gid, base, id) {
  const stops = [];
  for (const [kind, name] of [["commits", "solcommits"], ["shares", "solshares"]]) {
    const onDocs = (snap) => {
      if (c.gid !== gid) return;
      c.raw[name] ??= {};
      c.raw[name][id] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
      c.host.refilter();
    };
    const path = base + "/" + SESSIONS + "/" + id + "/" + kind;
    const onError = (e) => c.host.log("subscription error on a Solana session: " + e.code);
    stops.push(c.host.sdb.collection(path).onSnapshot(onDocs, onError));
  }
  return () => stops.forEach((stop) => stop());
}

// This device has a stake in a session when it holds nonces or a made share for it, or the session
// is past the commits (a package, or signed).
const stake = (c, ss) =>
  ss.status !== "collecting" ||
  c.host.localSeats().some((i) => savedNonces(c, i, ss.id) || pendingShare(c, i, ss.id));

// The ids to watch: the sessions that can still progress and that this app shows, those with a
// stake first, then the newest (c.sessions is newest first), at most WATCH_SEAT of each proposer.
function watchIds(c) {
  const open = c.sessions.filter((ss) => !ENDED.has(ss.status) && showable(ss));
  const mine = open.filter((ss) => stake(c, ss));
  const others = open.filter((ss) => !mine.includes(ss));
  const used = new Map();
  const ids = [];
  for (const ss of [...mine, ...others]) {
    const n = used.get(ss.by) ?? 0;
    if (n < WATCH_SEAT) ids.push(ss.id);
    used.set(ss.by, n + 1);
  }
  return ids;
}

// Watches those sessions. A session that ended gives its watches back, and a document that is not
// a valid session never takes one.
function syncWatches(c) {
  const live = watchIds(c);
  for (const [id, stop] of c.watching) {
    if (live.includes(id)) continue;
    stop();
    c.watching.delete(id);
  }
  for (const id of live) {
    if (!c.watching.has(id)) c.watching.set(id, watchSession(c, c.gid, c.base, id));
  }
}

function watchSessions(c, gid, base) {
  const onDocs = (snap) => {
    if (c.gid !== gid) return;
    c.raw[SESSIONS] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    c.loaded[SESSIONS] = true;
    c.host.refilter();
  };
  const onError = (e) => c.host.log("subscription error on solsessions: " + e.code);
  c.unsubs.push(c.host.sdb.collection(base + "/" + SESSIONS).onSnapshot(onDocs, onError));
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
  watchSessions(c, gid, base);
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
async function startWorker(c) {
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
  return limited(worker);
}

// One start at a time: a caller that comes while the start runs gets the same Worker, and never
// starts a second one that teardown would not close. A failed start can be tried again.
function ensureWorker(c) {
  if (!c.started) {
    const start = startWorker(c);
    c.started = start;
    start.catch(() => {
      if (c.started === start) c.started = null;
    });
  }
  return c.started;
}

// A failed read keeps the old balances, shows its error and waits READ_GAP_MS before the next one.
// A timer wakes the reactor when the gap ends, after a good read too: the next read comes from it.
async function readJob(c, opened, groupKey) {
  const record = c.balances;
  record.next = Date.now() + READ_GAP_MS;
  try {
    const worker = await ensureWorker(c);
    // A failed read of the nonce accounts leaves the balances and the last count as they are.
    const [read, held] = await Promise.all([readBalances(c, worker, groupKey),
      readHeld(c, worker, groupKey).catch(() => null)]);
    if (c.opened === opened) {
      Object.assign(record, read, { at: Date.now(), error: "" }, held && { nonces: held });
    }
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
  syncWatches(c);
  announceChanges(c);
  reactCeremony(c);
  reactAborts(c);
  reactSessions(c, () => ensureWorker(c));
  readIfDue(c);
}

const settled = (c) => COLLECTIONS.every((name) => c.loaded[name]);
// Null until the documents of the wallet arrived. A start that still waits for its signature check
// is not "not started" yet. Both reads refresh first: the page holds the reactor while signing is
// not ready, so c.docs and c.wait may be older than the stored documents.
const setupOf = (c) => {
  if (!settled(c)) return null;
  refresh(c);
  const setup = plainSetup(c);
  return setup.status === "not started" && c.wait > 0 ? null : setup;
};
// Does the Solana part count seat i (its soldone document)? Null while that is not known.
const madeOf = (c, i) => {
  if (!settled(c)) return null;
  refresh(c);
  return c.docs.soldone[i] ? true : c.wait > 0 ? null : false;
};

// What the page asks of the proposals: `none` until the documents of the wallet arrived, else
// `read` after the documents are read again (the page holds the reactor, see setupOf).
const fresh = (c, read, none) => {
  if (!settled(c)) return none;
  refresh(c);
  return read(c);
};

// Create nonce and Enable USDC (direct.js). One key lets one step run at a time, so a double click
// is one action. The button of a step starts its review; Confirm and Cancel come from the review.
const directActions = (c) => {
  const once = (fn) => c.host.once("sol:direct", fn);
  const ensure = () => ensureWorker(c);
  return {
    createNonce: () => once(() => startDirect(c, "createNonce", ensure)),
    enableUsdc: () => once(() => startDirect(c, "enableUsdc", ensure)),
    confirm: () => once(() => confirmDirect(c, ensure)),
    cancel: () => closeDirect(c),
  };
};

// Propose a send and approve one (propose.js, approve.js). One key lets one proposal, and one key
// one approval, run at a time. The words go to the one live region of the page (host.announce); a
// refusal or an error reaches the page as a banner with its text. A failed proposal also leaves
// its text, and the review of a refusal, in c.form, which the form shows next to its fields. The
// live region says the failure as well, because the form has no live node.
const SAYS = {
  propose: ["Checking the send…", "Send proposed."],
  approve: ["Checking the proposal…", "Approval sent."],
};
const REFUSED = "The checker refused this.";
const sessionActions = (c) => {
  const ensure = () => ensureWorker(c);
  const once = (name, step) => c.host.once("sol:" + name, async () => {
    c.host.announce(SAYS[name][0]);
    await step();
    c.host.announce(SAYS[name][1]);
  });
  const propose = async (typed) => {
    try {
      await proposeSend(c, ensure, typed);
      c.form.error = null;
    } catch (e) {
      const text = String(e?.message ?? e);
      c.form.error = { text, review: e?.review };
      // No live node of the form says it. The words of a refusal are short: its rules are long.
      c.host.announce(`${e?.review?.kind === "refused" ? REFUSED : text} ${NOTHING_PROPOSED}`);
      throw e;
    }
  };
  return {
    propose: (typed) => once("propose", () => propose(typed)),
    approve: (ss, seat) => once("approve", () => approvePlain(c, ensure, ss, seat)),
    review: (ss, seat) => reviewSession(c, ensure, ss, seat),
  };
};

// The deposit of a live swap from SOL to ZEC, from the Swap page (docs/sol-to-zec-group.md):
// { deposit, lamports, deadline } of the swap. The key of Propose lets one proposal run at a time,
// and the send form keeps its own text. Resolves with the session id, or throws the reason.
const SWAP_BUSY = "Another proposal of this wallet runs now. Try again when it ends.";
async function proposeSwap(c, ensure, swap) {
  const typed = swapTyped(swap);
  const why = swapPayError(c, BigInt(swap.lamports)) ?? depositPaid(c, swap.deposit);
  if (why) throw new Error(why);
  let out = { error: new Error(SWAP_BUSY) };
  await c.host.once("sol:propose", async () => {
    c.host.announce(SAYS.propose[0]);
    try {
      out = { id: await proposeSend(c, ensure, typed) };
    } catch (e) {
      out = { error: e };
    }
  });
  c.host.announce(out.error ? String(out.error.message ?? out.error) : SAYS.propose[1]);
  if (out.error) throw out.error;
  return out.id;
}

// What the Swap page asks of the plain wallet: why it cannot pay `lamports` (a decimal text) now,
// or null, and the row of a send by its id, or null.
const NOT_YET = "Zigs has not read the Solana documents of this wallet yet.";
const swapActions = (c) => ({
  swapReady: (lamports) => fresh(c, (it) => {
    const units = unitsOf(String(lamports ?? ""), 0);
    return units === null ? "The amount is not a whole number of lamports."
      : swapPayError(it, units);
  }, NOT_YET),
  sendRow: (id) => fresh(c, (it) => rowsOf(it).find((row) => row.id === id) ?? null, null),
  proposeSwap: (swap) => proposeSwap(c, () => ensureWorker(c), swap),
});

// What the Solana tab calls: the choice of the asset, the review of a proposal and the approval of
// the proposal that was reviewed (sends.js). A failed review or approval stays on the screen of the
// review as its text, and is announced; it is no banner.
const viewActions = (c, sessions) => {
  const ensure = () => ensureWorker(c);
  const says = SAYS.approve;
  return {
    pick: (asset) => {
      c.form = { asset, error: null };
      c.host.render();
    },
    propose: sessions.propose,
    review: (id, seat) => c.host.once("sol:look", () => startLook(c, ensure, id, seat)),
    approve: (id, seat) => c.host.once("sol:approve", async () => {
      c.host.announce(says[0]);
      if (await approveLooked(c, ensure, id, seat)) c.host.announce(says[1]);
    }),
    close: () => closeLook(c),
  };
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
  const sessions = sessionActions(c);
  const shown = viewActions(c, sessions);
  return {
    ctl: c, // the state of the controller, for the tests
    open: (gid, base) => openGroup(c, gid, base),
    close: () => teardown(c),
    react: () => react(c),
    add: () => addSolana(c),
    ...sessions,
    ...swapActions(c),
    observe,
    view: (act, actions) => plainView(c, act,
      { ...actions, add: () => addSolana(c), ...directActions(c), ...shown }),
    details: (surface, act, actions) => plainDetailsView(c, act,
      { ...actions, add: () => addSolana(c), ...directActions(c), ...shown }, surface),
    pick: shown.pick,
    pending: () => fresh(c, (it) => pendingList(it).length, 0),
    pendingRows: () => fresh(c, pendingRows, []),
    setup: () => setupOf(c),
    made: (i) => madeOf(c, i),
    read: () => readTexts(c),
  };
}
