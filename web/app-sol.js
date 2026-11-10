// Solana host glue: solHost() and the lazy load of web/sol.
import { walletVersion } from "./util.js";
import { recipientSelect } from "./app-recipients.js";
import { docFields } from "./signed.js";
import { banner, clearBadBanner, log, openCreate, showBanner, state, ui } from "./app-state.js";
import { exclusive, said } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { putSec, putSecHeld, sec, takeStored } from "./app-keystore.js";
import { localSeats, seatIds } from "./app-seats.js";
import { netName } from "./app-chain.js";
import {
  canWriteAs, checkIn, netConfirmed, refilter, signedDoc, signedMode,
} from "./app-filter.js";
import { openGroup, sdb, unsubGroup } from "./app-groups.js";
import { act, announce, el, guard } from "./app-dom.js";
import { confirmedNo, groupVersion, safetyNo, seatCheck } from "./app-dkg.js";
import { openBackupCheck, restore, sealAndSave } from "./app-backups.js";
import { focusAfter, once, react, render } from "./app-loop.js";
import { checkSolSwap } from "./app-swap-sol.js";

// Devnet, for version 3 wallets on the testnet that the people of the wallet confirmed (SOL-34).
// web/sol loads from the Solana tab, a signed solstart document, or the unsigned Solana hint
// (solPreload), which any holder of the invite link can write.
const solGroup = (gid) =>
  (gid === state.gid && state.g) || state.groups.find((x) => x.id === gid);
export const solOn = (gid = state.gid) => {
  const g = solGroup(gid);
  const testnet = g?.network === "testnet" && netConfirmed(gid) === "testnet";
  return testnet && walletVersion(g) === 3 && signedMode(gid);
};
// The plain Solana wallet, for version 3 wallets on the mainnet that the people of the wallet
// confirmed (ZOLANA.md 3.8). Its controller has its own slot (plainSol) and never the pool slot.
export const plainOn = (gid = state.gid) => {
  const g = solGroup(gid);
  const mainnet = g?.network === "mainnet" && netConfirmed(gid) === "mainnet";
  return mainnet && walletVersion(g) === 3 && signedMode(gid);
};
// The plain wallet is shown when the server serves it. Without that answer a mainnet wallet looks
// as it did before the plain wallet.
export const plainShown = (gid = state.gid) => plainOn(gid) && ui.plainServed === true;
// The group document asks for a Solana part (createGroup). It is a hint only: any holder of the
// link can write it, so it changes the texts and the preload, and it never starts the ceremony.
export const solPlanned = (g = state.g) =>
  g?.solana === true && (g.network || "testnet") === "testnet" && walletVersion(g) === 3;
// Does this server serve Solana? undefined: not asked yet, null: asked, then true or false. The
// create dialog offers the Solana part only on a server that answers.
export function solServed() {
  if (ui.solServed === undefined) {
    ui.solServed = null;
    // The small body is read to its end: a cancelled request counts as a failed one (S19).
    globalThis.fetch("/sol/config.json", { cache: "no-store" }).then((r) => {
      ui.solServed = r.ok;
      return r.text();
    }).catch(() => { if (ui.solServed === null) ui.solServed = false; }).finally(render);
  }
  return ui.solServed === true;
}
// Does this server serve the plain wallet? The same states as solServed. Only plainReact asks, so
// a testnet wallet never does. The server answers 404 until SOL_MAINNET is "1". The page does not
// keep the body. The answer changes what the reactor does, so it runs a pass.
// The promise of the probe, for a restore that waits for it. It resolves with no value: the body
// holds the Helius URL and its key.
export let plainAnswer = null;
export function plainServed() {
  if (ui.plainServed === undefined) {
    ui.plainServed = null;
    plainAnswer = globalThis.fetch("/sol/config-mainnet.json", { cache: "no-store" }).then((r) => {
      ui.plainServed = r.ok;
      return r.text().then(() => undefined);
    }).catch(() => { if (ui.plainServed === null) ui.plainServed = false; }).finally(refilter);
  }
  return ui.plainServed === true;
}
// The Solana choice of the create dialog: the hint for the other seats first, then `solAuto` in
// the secret of seat 1, which starts the ceremony with no button. A failed hint starts nothing.
export async function planSolana(gid) {
  if (!sec(gid, 1)) return;
  await sdb.doc("groups/" + gid).update({ solana: true });
  await putSec(gid, 1, { solAuto: true });
}
// What a person accepts with the Solana part. It holds PUBLIC_TEXT of web/sol/view.js, which loads
// only with the module (unified-setup.mjs keeps the two equal).
export const SOL_DISCLOSURE = "Solana Devnet: a program owns the funds of the group at a public "
  + "program address. A deposit shows its sender and amount on chain. A withdrawal shows its "
  + "recipient and amount. A private payment hides its amount, but it shows the owner key of the "
  + "payee. The program address, the group key and the fee address of each device that pays are "
  + "public too. Helius sees that you use Zigs, your IP address and the keys of this wallet. "
  + "With local proving off, a payment is refused and Helius makes no proof. The Zigs server "
  + "operator can link this wallet to these addresses by timing. Each device funds its own fee "
  + "address, and that funding shows who sent the SOL. Every device sees the whole Solana "
  + "history of the wallet. The program has no audit, and its upgrade key is outside the group.";
// The wallet list with the create dialog open. Inside an open wallet the dialog does not show.
export const newWallet = () => { openGroup(null); openCreate(); render(); };
// The seats of this browser with a Solana key share whose backup file was not saved. A stopped
// part gets no backup (web/sol/backup.js refuses it), also when another seat stopped it.
const solStopped = () => solSetup()?.status === "stopped";
export const solUnsaved = () => localSeats().filter((i) => {
  const f = solFile(i);
  return f?.saved === false && !f.missing;
});
/**
 * The Solana file of seat i of this browser, or null when the seat has no Solana part here.
 * `missing`: the Solana part of the wallet counts this seat (its soldone document), but this
 * browser holds no share of it: a seat restored from its Zcash file alone (ZOLANA.md 4.3).
 * `unknown`: this browser holds no share, and the Solana documents are not read yet (`failed`:
 * the module did not load), so it does not know yet.
 */
export function solFile(i) {
  if (plainShown()) return plainPart(i);
  if (!solOn() || solStopped()) return null;
  const s = sec(state.gid, i)?.sol;
  if (solShare(s)) return { saved: s.backupSaved === true, restored: s.restored === true };
  const made = solMade(i);
  if (made === null) return { unknown: true, failed: !!solError };
  return made ? { saved: false, missing: true } : null;
}
// Null until the module follows this wallet and its Solana documents are read.
const solMade = (i) => (solOpenHere() && collections
  ? fromSol("device part", (c) => madeOf(c, i), null) : null);
// The soldone document of the seat is enough. Its absence counts once every document is checked.
function madeOf(c, i) {
  if (!collections.every((n) => c.loaded[n])) return null;
  return c.docs?.soldone?.[i] ? true : c.wait > 0 ? null : false;
}
const solShare = (s) => !!(s?.keyPackage && s.solSeed && s.groupKey) && !s.aborted;
// The backup dialog of the Solana part of seat i, from the backup note of the wallet.
export async function solBackup(i) {
  if (plainShown()) return plainBackup(i);
  await solLoad();
  if (!sol) throw new Error(solError || "Solana did not load.");
  const { backupWords } = await import("./sol/backup.js");
  ui.backup = { words: backupWords(sol.ctl, i), made: false, busy: false };
  render();
}
const SOL_OFF = "Solana is not available on this server";
export let sol = null, solLoading = null, solError = "";
export let plainSol = null, plainLoading = null, plainError = "";
let solStartDoc = null;   // the stored solstart/1 of the open wallet, whoever wrote it
let solWatched = null;    // the wallet whose start document is watched
let solStartRead = null;  // the wallet whose start documents arrived
export function resetSolStart() {
  plainSol?.close();
  solStartDoc = null; solWatched = null; solStartRead = null;
}
// host.putSec is the save of a step that holds the lock of the secrets (putSol, shareOnce).
export const solHost = () => ({
  Z, sdb, state, el, act, log, once, render, refilter, showBanner, sec, putSec: putSecHeld,
  focusAfter, announce,
  signedDoc,
  recipientSelect,
  exclusive, takeStored,
  canWriteAs, localSeats, seatIds, checkIn, safetyNo, seatCheck, confirmedNo, openGroup, restore,
  groupVersion, sealAndSave, network: () => netName(state.g), netConfirmed, mode: "pool",
  askBackup: (words) => { ui.backup = { words, made: false, busy: false }; render(); },
  newWallet,
  swapCheck: (ask) => checkSolSwap(ask),
});
// A server with SOL off does not serve the module (its config answers 503), and the text says so.
// Any other failure is the connection (SOL-26). view.js is part of the module: it gives the setup
// steps (solSetup). A browser keeps a failed import() for the life of the page, so only a reload
// mends it; Try again (the Solana tab) can mend a failure after the import.
const SOL_DOWN = "Solana did not load. Check your connection, then reload the page.";
let setupSummary = null, pendingCount = null, pendingRows = null, loadingCount = null;
let olderCount = null, activityRows = null, activityWaits = null, collections = null;
let importFailed = false;
const SOL_RETRY = "Solana did not load. Check your connection, then press Try again.";
/** The tab text of a failed load. `retry`: Try again can mend it (a failure after the import). */
export const failText = (error, retry) => (retry ? SOL_RETRY : error);
export async function whyNotLoaded() {
  const status = await globalThis.fetch("/sol/config.json", { cache: "no-store" })
    .then((r) => r.status, () => 0);
  return status === 503 || status === 404 ? SOL_OFF : SOL_DOWN;
}
// main.js imports the wasm glue again in attach: the browser gives it the module of this load.
const solModule = () => Promise.all([import("./sol/main.js"), import("./sol/view.js"),
  import("./sol/docs.js"), import("./sol/wasm/sol_wasm.js")])
  .then(([m, v, d]) => {
    ({ setupSummary, pendingCount, pendingRows, loadingCount, olderCount, activityRows,
      activityWaits } = v);
    collections = d.COLLECTIONS;
    return m;
  })
  .catch(async () => {
    importFailed = true;
    throw new Error(await whyNotLoaded());
  });
// The Solana part of the open wallet for the setup steps and the approval count. The Zcash pages
// call them, so a throw gives a log line, not a broken wallet page.
const solOpenHere = (gid = state.gid) => !!sol && solOn(gid) && sol.ctl.gid === gid;
function fromSol(what, read, none) {
  try {
    return read(sol.ctl);
  } catch (e) {
    log("Solana " + what + ": " + said(e));
    return none;
  }
}
// Null until the Solana documents of the wallet arrived. While some still wait for their signature
// check, "not started" can be a part that is ready, so it counts as not known yet either.
function setupOf(c) {
  if (!collections.every((n) => c.loaded[n])) return null;
  const s = setupSummary(c);
  return s.status === "not started" && c.wait > 0 ? null : s;
}
export const solSetup = () =>
  solOpenHere() && setupSummary ? fromSol("setup steps", setupOf, null) : null;
// The Solana proposals that this browser can still approve, for wallet `gid`. The module follows
// the open wallet only, so any other wallet counts 0.
// A plain wallet counts the sends of its own part (plain/sends.js), a testnet wallet the pool.
export const solPending = (gid = state.gid) => {
  if (plainHere(gid)) return fromPlain("approval count", (p) => p.pending(), 0);
  return solOpenHere(gid) && pendingCount ? fromSol("approval count", pendingCount, 0) : 0;
};
// Those proposals of the open wallet as rows ({id, title, by}), by the same rule as the count.
export const solPendingRows = () => {
  if (plainHere()) return fromPlain("approval list", (p) => p.pendingRows(), []);
  return solOpenHere() && pendingRows ? fromSol("approval list", pendingRows, []) : [];
};
// The Solana rows of the Activity list of the open wallet (see activityRows of web/sol/view.js),
// or null while the module or the Solana proposals of the wallet are not read.
export const solActivity = () =>
  solOpenHere() && activityRows ? fromSol("activity", activityRows, null) : null;
// True while some Solana proposals of the open wallet still wait for their check.
export const solActivityWaits = () =>
  solOpenHere() && activityWaits ? fromSol("activity check", activityWaits, false) : false;
// The proposals of the open wallet that this browser can approve once its read of them ends.
export const solLoadingCount = () =>
  solOpenHere() && loadingCount ? fromSol("loading count", loadingCount, 0) : 0;
// The proposals of the open wallet that are older than the newest ones that Zigs lists.
export const solOlderCount = () =>
  solOpenHere() && olderCount ? fromSol("older count", olderCount, 0) : 0;
// The private balance text of the last sync (or of the saved sync) of wallet `gid`, or null,
// and the state of that sync: {text, busy}.
export const solBalance = (gid = state.gid) =>
  solOpenHere(gid) ? fromSol("balance", (c) => c.sync?.balance ?? null, null) : null;
export const solSync = (gid = state.gid) => solOpenHere(gid)
  ? fromSol("sync", (c) => ({ text: String(c.sync?.text ?? ""), busy: !!c.sync?.busy }), null)
  : null;
/** Overview starts the existing balance sync without opening Solana payment/prover tools. */
export function solObserveOverview() {
  if (globalThis.document?.visibilityState === "hidden") return;
  if (plainHere()) plainSol.observe(state.gid);
  if (!solOpenHere()) return;
  sol.observe(state.gid);
}
// A failed load waits for Try again (solRetry): a retry on every redraw would loop.
export function solRetry() {
  if (!solError) return;   // a second tap while the retry loads
  solLoading = null;
  solError = "";
  solLoad();
  render();
}
let failBanner = "";   // the text of the banner that the last failed load showed
export function solLoad() {
  solLoading ||= solModule().then((m) => m.attach(solHost())).then((m) => {
    sol = m;
    if (failBanner && banner?.text === failBanner) clearBadBanner();
    failBanner = "";
    if (solOn()) sol.open(state.gid, "groups/" + state.gid);
    render(); react();
  }, (e) => {
    solError = said(e);
    failBanner = solError === SOL_DOWN ? SOL_DOWN : "Solana did not load: " + solError;
    showBanner("bad", failBanner);
    render();
  });
  return solLoading;
}
// The open wallet gets its watch once it is a Solana wallet. The confirmed network can come after
// the wallet opened, so the reactor asks again.
export function solWatch() {
  const gid = state.gid;
  if (!gid || solWatched === gid || !solOn(gid)) return;
  solWatched = gid;
  solAttach(gid, "groups/" + gid);
}
// Before the module loads, one watch keeps the start document. Any holder of the invite link can
// write one, so solReact loads the module from it only when a seat signed it.
export function solAttach(gid, base) {
  if (sol) { sol.open(gid, base); return; }
  watchStart(gid, base);
}
function watchStart(gid, base) {
  unsubGroup.push(sdb.collection(base + "/solstart").onSnapshot((snap) => {
    solStartDoc = snap.docs.find((d) => d.id === "1")?.data() ?? null;
    solStartRead = gid;
    refilter();
  }));
}
// Before the module loads: the start documents of the open wallet arrived and hold no start, so
// the wallet has no Solana part yet.
export const solNotAdded = () => !sol && !solError && solStartRead === state.gid && !solStartDoc;
const solStartSigned = () => !!solStartDoc && checkIn(state.gid)("solstart/1", solStartDoc.by,
  solStartDoc.sig, docFields(solStartDoc), 1) === "yes";
// A seat of a wallet with the Solana hint loads the module at the start of setup, so the key
// ceremony does not wait for it. The watch still opens only for a confirmed testnet wallet.
function solPreload() {
  const auto = sec(state.gid, 1)?.solAuto === true;
  if (!sol && !solLoading && (solPlanned() || auto) && localSeats().length) solLoad();
}
export function solReact() {
  plainReact();
  solPreload();
  if (!solOn()) return;
  solWatch();
  if (sol) sol.react();
  else if (!solLoading && solStartSigned()) solLoad();
}
// The plain controller loads once. A failed load shows one banner and the reactor does not try
// again: only a reload mends it.
export function plainLoad() {
  plainLoading ||= import("./sol/plain/control.js").then((m) => m.attach(solHost())).then((m) => {
    plainSol = m;
    if (plainOn()) plainSol.open(state.gid, "groups/" + state.gid);
    render(); react();
  }, (e) => {
    plainError = "Solana did not load: " + said(e);
    showBanner("bad", plainError);
    render();
  });
  return plainLoading;
}
// The open wallet gets its watch once it is a plain wallet and the server serves it.
function plainWatch() {
  const gid = state.gid;
  if (!gid || solWatched === gid || !plainOn(gid)) return;
  solWatched = gid;
  if (plainSol) plainSol.open(gid, "groups/" + gid);
  else watchStart(gid, "groups/" + gid);
}
// Only a wallet that is plain on a server that serves it comes here. A testnet wallet never asks.
function plainReact() {
  if (!plainOn() || !plainServed()) return;
  plainWatch();
  if (plainSol) plainSol.react();
  else if (!plainLoading && solStartSigned()) plainLoad();
}
const retryButton = () => el("button", { class: "btn sm", type: "button", "data-sol": "retry-load",
  onclick: solRetry }, "Try again");
/** The Solana tab after a failed load: its text, and Try again only where a retry can mend it. */
export const loadFail = (error, retry) => el("div", { style: "display:grid;gap:8px" },
  el("p", { class: "small" }, failText(error, retry)), retry ? el("div", {}, retryButton()) : null);
export const solTab = () => sol ? guard(sol.view)
  : solError ? loadFail(solError, !importFailed)
  : (solLoad(), el("p", { class: "small" }, "Loading Solana…"));
// The plain controller follows wallet `gid`, which is shown as a plain wallet.
const plainHere = (gid = state.gid) => !!plainSol && plainShown(gid) && plainSol.ctl.gid === gid;
function fromPlain(what, read, none) {
  try {
    return read(plainSol);
  } catch (e) {
    log("Solana plain " + what + ": " + said(e));
    return none;
  }
}
// Null until the Solana documents of the wallet arrived (see solSetup).
export const plainSetup = () =>
  (plainHere() ? fromPlain("setup steps", (p) => p.setup(), null) : null);
// The Send choice of a plain wallet: the form takes this asset.
export const plainPick = (asset) => plainSol?.pick(asset);
// The texts of the last read of the balances (readTexts of web/sol/plain/view.js), or null.
export const plainRead = () =>
  (plainHere() ? fromPlain("balances", (p) => p.read(), null) : null);
// Before the plain controller loads: the start documents arrived and hold no start.
export const plainNotAdded = () => plainShown() && !plainSol && !plainError
  && solStartRead === state.gid && !solStartDoc;
// Does the wallet have a Solana part, or can it have one? Not when it is known to have none.
export const plainAdded = () => plainShown() && !plainNotAdded()
  && plainSetup()?.status !== "not started";
// The setup steps and the load error of the Solana part that this wallet shows: the plain part of a
// served mainnet wallet, else the pool.
export const solPartSetup = () => (plainShown() ? plainSetup() : solSetup());
export const solPartError = () => (plainShown() ? plainError : solError);
// The ready gate of the check of a saved Solana file (backupCheckExpected).
export const solReady = () => solPartSetup()?.status === "ready";
const plainStopped = () => plainSetup()?.status === "stopped";
// solFile for a plain seat. The tab itself needs no module of the pool.
function plainPart(i) {
  if (!plainShown() || plainStopped()) return null;
  const s = sec(state.gid, i)?.sol;
  if (solShare(s)) return { saved: !!s.backupSaved, restored: !!s.restored };
  const made = plainHere() ? fromPlain("device part", (p) => p.made(i), null) : null;
  if (made === null) return { unknown: true, failed: !!plainError };
  return made ? { saved: false, missing: true } : null;
}
const plainActions = {
  backup: (i) => solBackup(i),
  check: (i) => openBackupCheck(i, "sol"),
  restoreFile: (file) => restore(file),
};
/**
 * The Solana tab of a plain wallet. It shows the wallet only while the controller follows it and
 * has its Solana documents.
 */
export function plainTab() {
  if (plainError) return loadFail(plainError, false);
  const loading = el("p", { class: "small" }, "Loading Solana…");
  if (!plainSol) return (plainLoad(), loading);
  if (!plainSetup()) return loading;
  plainSol.observe(state.gid);
  return guard(plainSol.view, act, plainActions);
}
const NET_UNCONFIRMED = "This browser does not know yet which network the people of this wallet "
  + "confirmed. Open the wallet, wait until your device shows Address checked, then try again.";
async function plainRestore(b, encrypted) {
  await plainLoad();
  if (!plainSol) throw new Error("Solana did not load.");
  const { restoreSolana } = await import("./sol/backup.js");
  return restoreSolana(plainSol.ctl, b, encrypted);
}
async function plainBackup(i) {
  await plainLoad();
  if (!plainSol) throw new Error(plainError || "Solana did not load.");
  const { backupWords } = await import("./sol/backup.js");
  ui.backup = { words: backupWords(plainSol.ctl, i), made: false, busy: false };
  render();
}
const PLAIN_LABEL = "mainnet-plain";
const NOT_LISTED = "This browser does not know this wallet yet. Wait a moment, then open the file "
  + "again.";
const PROBE_MS = 10000;
const NOT_ASKED = "This browser does not know yet whether this server serves the Solana wallet. "
  + "Wait a moment, then open the file again.";
// Does this Solana file go to the plain controller? Only the wallet decides, never the label of the
// file: a plain label can only make a restore refuse. A mainnet wallet waits up to PROBE_MS for
// the probe.
async function plainRoute(b) {
  if (!solGroup(b.group)) {
    if (b.cluster === PLAIN_LABEL) throw new Error(NOT_LISTED);
    return false;
  }
  if (!plainOn(b.group)) return false;
  plainServed();
  let timer;
  await Promise.race([plainAnswer, new Promise((done) => { timer = setTimeout(done, PROBE_MS); })]);
  clearTimeout(timer);
  if (ui.plainServed === null) throw new Error(NOT_ASKED);
  return ui.plainServed === true;
}
export async function solRestore(b, encrypted) {
  if (await plainRoute(b)) return plainRestore(b, encrypted);
  if (solGroup(b.group) && !solOn(b.group)) {
    throw new Error(netConfirmed(b.group) ? "Solana runs on version 3 testnet wallets only."
      : NET_UNCONFIRMED);
  }
  await solLoad();
  if (!sol) throw new Error(solError || "Solana did not load.");
  return sol.restore(b, encrypted);
}
