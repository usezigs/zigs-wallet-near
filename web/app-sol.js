// Solana host glue: solHost() and the lazy load of web/sol.
import { walletVersion } from "./util.js";
import { recipientSelect } from "./app-recipients.js";
import { docFields } from "./signed.js";
import { banner, clearBadBanner, log, openCreate, showBanner, state, ui } from "./app-state.js";
import { exclusive, oldest, readLocal, said, saveMerged } from "./app-kit.js";
import { pin } from "./chat.js";
import { Z } from "./app-engine.js";
import { mySeatSecrets, putSec, putSecHeld, sec, takeStored } from "./app-keystore.js";
import { localSeats, seatIds } from "./app-seats.js";
import { netName } from "./app-chain.js";
import {
  canWriteAs, checkIn, netConfirmed, refilter, signedDoc, signedMode, signPins,
} from "./app-filter.js";
import { openGroup, sdb, unsubGroup } from "./app-groups.js";
import { act, announce, el, guard } from "./app-dom.js";
import { confirmedNo, groupVersion, safetyNo, seatCheck } from "./app-dkg.js";
import { openBackupCheck, restore, sealAndSave } from "./app-backups.js";
import { focusAfter, once, react, render } from "./app-loop.js";
import { checkSolSwap, swapPayout } from "./app-swap-sol.js";

// The pool: Devnet, for version 3 wallets on the testnet that the people of the wallet confirmed
// (SOL-34), and the private wallet on mainnet (solMode). web/sol loads from the Solana tab, a
// signed solstart document, or the unsigned Solana hint (solPreload), which any holder of the
// invite link can write.
const solGroup = (gid) =>
  (gid === state.gid && state.g) || state.groups.find((x) => x.id === gid);
const testnetOn = (gid) => {
  const g = solGroup(gid);
  const testnet = g?.network === "testnet" && netConfirmed(gid) === "testnet";
  return testnet && walletVersion(g) === 3 && signedMode(gid);
};
export const solOn = (gid = state.gid) => testnetOn(gid) || solMode(gid) === "private";
// The plain Solana wallet, for version 3 wallets on the mainnet that the people of the wallet
// confirmed (ZOLANA.md 3.8) and that are not private (solMode). Its controller has its own slot
// (plainSol) and never the pool slot.
export const plainOn = (gid = state.gid) => solMode(gid) === "plain";
// The plain wallet is shown when the server serves it. Without that answer a mainnet wallet looks
// as it did before the plain wallet.
export const plainShown = (gid = state.gid) => plainOn(gid) && ui.plainServed === true;
// The private Solana wallet on mainnet (slice 8, design 2.4): a version 3 wallet whose people
// confirmed mainnet is private or plain. The label of a Solana part of a seat of this browser
// decides first, then the start that seat 1 signed, then the accept of this browser: the pin
// "solmode:<wallet id>" in zf-signpins, written once as the confirmed network is.
const PLAIN_LABEL = "mainnet-plain";
const PRIVATE_LABEL = "mainnet-private";
const MODE_PIN = "solmode:";
const POOL_WORKER_MAINNET = "/sol/worker-mainnet.js";
const mainnetOn = (gid) => {
  const g = solGroup(gid);
  const mainnet = g?.network === "mainnet" && netConfirmed(gid) === "mainnet";
  return mainnet && walletVersion(g) === 3 && signedMode(gid);
};
// A seat holds a Solana part once it holds ceremony material (driftOf of web/sol/ceremony.js).
const holdsPart = (s) => !!(s?.r1secret || s?.r2secret || s?.keyPackage);
const partOf = (gid) => mySeatSecrets(gid).map(([, s]) => s?.sol).find(holdsPart);
// The label of the start that seat 1 signed, or null. The page reads the start of the open wallet
// only (its own watch, or the controller that follows it), so another wallet counts as no start.
function startLabel(gid) {
  if (solStartRead === gid) return solStartSigned() ? solStartDoc.cluster : null;
  const ctl = [sol?.ctl, plainSol?.ctl].find((c) => c?.gid === gid && c.loaded?.solstart);
  return ctl?.docs.solstart[1]?.cluster ?? null;
}
// Rules 1 to 4 of design 2.4: the mode before the probe.
function baseMode(gid) {
  const part = partOf(gid);
  if (part) return part.cluster === PRIVATE_LABEL ? "private" : "plain";
  const start = startLabel(gid);
  if (start === PLAIN_LABEL) return "plain";
  const pinned = signPins[MODE_PIN + gid] === PRIVATE_LABEL;
  if (start === PRIVATE_LABEL && !pinned) return "accept";
  return pinned ? "private" : "plain";
}
/**
 * The Solana mode of wallet `gid`: null for any wallet but a version 3 wallet whose people
 * confirmed mainnet. Else "plain", "private" (the pool on mainnet), "accept" (seat 1 started a
 * private wallet that this browser has not accepted) or "unserved" (a private wallet on a server
 * that does not serve the private Worker, D14). A private wallet never falls back to plain.
 */
export function solMode(gid = state.gid) {
  if (!mainnetOn(gid)) return null;
  const mode = baseMode(gid);
  if (mode !== "private") return mode;
  return privateServed() ? mode : "unserved";
}
// Does this server serve the private Worker? The same states as solServed. A private wallet and the
// create dialog of a mainnet wallet ask. The server answers 404 unless SOL and SOL_POOL_MAINNET
// are "1" (cf/src/index.js). privateAnswer is the promise of the probe, for a restore that waits.
let privateAnswer = null;
export function privateServed() {
  if (ui.privateServed === undefined) {
    ui.privateServed = null;
    const head = { method: "HEAD", cache: "no-store" };
    privateAnswer = globalThis.fetch(POOL_WORKER_MAINNET, head).then((r) => {
      ui.privateServed = r.status === 200;
    }).catch(() => { if (ui.privateServed === null) ui.privateServed = false; }).finally(refilter);
  }
  return ui.privateServed === true;
}
// The accept of this browser (design 2.4 Consent): the first-seen pin "solmode:<wallet id>" =
// mainnet-private, read back from storage. A failed write refuses, and the tab forgets its own
// copy, so a later save of zf-signpins does not store it either.
const NO_PIN = "This browser could not save that it accepts the private Solana wallet. Nothing "
  + "was started.";
const OTHER_PART = "A device of this wallet in this browser holds a Solana part of another "
  + "network or mode, so the private Solana wallet was not accepted.";
// The label of a seat secret. Round 1 writes it before the seat publishes soldkg1 (ceremony.js),
// and it stays after a stop. A part with no label is the pool on Devnet.
const labelHeld = (s) => s?.cluster ?? (holdsPart(s) ? "devnet" : null);
const otherPart = (gid) => mySeatSecrets(gid).some(([, s]) => {
  const label = labelHeld(s?.sol);
  return label !== null && label !== PRIVATE_LABEL;
});
/** Pins the private mode of wallet `gid` in this browser. Throws when it cannot. */
export function acceptPrivate(gid) {
  if (otherPart(gid)) throw new Error(OTHER_PART);
  const key = MODE_PIN + gid;
  const fresh = pin(signPins, key, PRIVATE_LABEL) === "new";
  if (fresh) saveMerged("zf-signpins", signPins, oldest);
  if (signPins[key] === PRIVATE_LABEL && readLocal("zf-signpins")[key] === PRIVATE_LABEL) return;
  if (fresh && signPins[key] === PRIVATE_LABEL) delete signPins[key];
  throw new Error(NO_PIN);
}
// The private choice of the create dialog (design 2.4 Create), in this order: the accept of this
// browser, the hint for the other seats (texts only), then solAuto in the secret of seat 1, which
// starts the ceremony with no button. A step that fails starts nothing after it.
export async function planPrivate(gid) {
  if (!sec(gid, 1)) throw new Error("Only device 1 can start the private Solana wallet.");
  acceptPrivate(gid);
  await sdb.doc("groups/" + gid).update({ solana: true, solMode: PRIVATE_LABEL });
  await putSec(gid, 1, { solAuto: true });
}
// The group document asks for the private Solana wallet (planPrivate). A hint only, as
// solPlanned: it changes the join card, and never the mode (solMode).
export const privatePlanned = (g = state.g) =>
  g?.solana === true && g.solMode === PRIVATE_LABEL && g.network === "mainnet"
  && walletVersion(g) === 3;
// MAINNET_DISCLOSURE of web/sol/net.js, the one text of the private wallet. A page module reads
// web/sol only with import(), so the text is null until the module loads, and the load redraws.
let disclosure = null, disclosureLoad = null;
export function privateDisclosure() {
  disclosureLoad ||= import("./sol/net.js").then((m) => { disclosure = m.MAINNET_DISCLOSURE; },
    (e) => log("Solana text: " + said(e))).finally(render);
  return disclosure;
}
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
  + "history of the wallet. Program upgrades are managed separately from wallet approvals.";
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
let solWatched = null;    // the wallet that solWatch took up
let plainWatched = null;  // the wallet that plainWatch took up
let startWatched = null;  // the wallet whose start document is watched
let solStartRead = null;  // the wallet whose start documents arrived
export function resetSolStart() {
  plainSol?.close();
  solStartDoc = null; solWatched = null; plainWatched = null; startWatched = null;
  solStartRead = null;
}
// host.putSec is the save of a step that holds the lock of the secrets (putSol, shareOnce).
export const solHost = () => ({
  Z, sdb, state, el, act, log, once, render, refilter, showBanner, sec, putSec: putSecHeld,
  focusAfter, announce,
  signedDoc,
  recipientSelect,
  exclusive, takeStored,
  canWriteAs, localSeats, seatIds, checkIn, safetyNo, seatCheck, confirmedNo, openGroup, restore,
  groupVersion, sealAndSave, network: () => netName(state.g), netConfirmed, mode: "pool", solMode,
  askBackup: (words) => { ui.backup = { words, made: false, busy: false }; render(); },
  newWallet,
  swapCheck: (ask) => checkSolSwap(ask, undefined, ask.mode === "private"
    ? { ...swapPayout(), refundTo: ask.refundTo } : undefined),
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
  if (!gid || !solOn(gid)) return;
  if (solWatched !== gid) {
    solWatched = gid;
    solAttach(gid, "groups/" + gid);
  } else if (privateLate(gid)) {
    sol.open(gid, "groups/" + gid);
  }
}
// The pool controller does not follow the open private wallet: the wallet became private after
// its first watch (the answer of the probe, or the pin of an accept).
const privateLate = (gid) => !!sol && sol.ctl.gid !== gid && solMode(gid) === "private";
// Before the module loads, one watch keeps the start document. Any holder of the invite link can
// write one, so solReact loads the module from it only when a seat signed it.
export function solAttach(gid, base) {
  if (sol) { sol.open(gid, base); return; }
  watchStart(gid, base);
}
function watchStart(gid, base) {
  if (startWatched === gid) return;
  startWatched = gid;
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
// A mainnet wallet that is not plain (private, "accept" or "unserved") keeps its own watch of the
// start that seat 1 signed, whichever controller follows it: a signed mainnet-plain start must
// reach the router (rule 2 of design 2.4), also on a server without the private Worker. The plain
// controller leaves such a wallet once that watch has read the start, so the start stays known.
function barredWatch() {
  const gid = state.gid;
  if (!gid || !plainBarred()) return;
  watchStart(gid, "groups/" + gid);
  if (plainSol?.ctl.gid !== gid || solStartRead !== gid) return;
  plainSol.close();
  plainWatched = null;
}
export function solReact() {
  barredWatch();
  plainReact();
  solPreload();
  if (!solOn()) return;
  solWatch();
  if (sol) sol.react();
  else if (!solLoading && solStartSigned()) solLoad();
}
// Only a plain wallet loads the plain controller: a private wallet never imports it, also not
// through a caller outside this file (the swap check of app-swap-zec.js).
const plainBarred = () => ![null, "plain"].includes(solMode());
// The plain controller loads once. A failed load shows one banner and the reactor does not try
// again: only a reload mends it.
export function plainLoad() {
  if (!plainLoading && plainBarred()) return Promise.resolve();
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
// The open wallet gets its watch once it is a plain wallet and the server serves it, and again
// after barredWatch closed the plain controller. A close by any other caller stays.
function plainWatch() {
  const gid = state.gid;
  if (plainWatched === gid) return;
  plainWatched = gid;
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
const UNSERVED = "This server does not serve the private Solana wallet, so it does not open here.";
const ACCEPT_INTRO = "Device 1 started a private Solana wallet on mainnet. This browser takes part "
  + "only after you accept it.";
// The Solana tab of a private wallet that this browser has not accepted (solMode "accept").
function acceptCard() {
  const texts = privateDisclosure();
  if (!texts) return el("p", { class: "small" }, "Loading Solana…");
  const accept = act(() => {
    acceptPrivate(state.gid);
    refilter();
  });
  return el("div", { style: "display:grid;gap:8px" },
    el("p", { class: "small" }, ACCEPT_INTRO),
    texts.map((line) => el("p", { class: "small" }, line)),
    el("div", {}, el("button", { class: "btn primary", type: "button",
      "data-sol": "accept-private", onclick: accept }, "Accept the private wallet")));
}
const MODE_TABS = { accept: acceptCard, unserved: () => el("p", { class: "small" }, UNSERVED) };
/** Does wallet `gid` show the Solana tab of the pool? Also a private wallet that it explains. */
export const solTabOn = (gid = state.gid) => solOn(gid) || Object.hasOwn(MODE_TABS, solMode(gid));
export function solTab() {
  const modeTab = MODE_TABS[solMode()];
  if (modeTab) return modeTab();
  return sol ? guard(sol.view)
    : solError ? loadFail(solError, !importFailed)
    : (solLoad(), el("p", { class: "small" }, "Loading Solana…"));
}
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
const NOT_LISTED = "This browser does not know this wallet yet. Wait a moment, then open the file "
  + "again.";
const PROBE_MS = 10000;
const NOT_ASKED = "This browser does not know yet whether this server serves the Solana wallet. "
  + "Wait a moment, then open the file again.";
/** Waits for `promise`, but not longer than PROBE_MS. */
async function within(promise) {
  let timer;
  await Promise.race([promise, new Promise((done) => { timer = setTimeout(done, PROBE_MS); })]);
  clearTimeout(timer);
}
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
  await within(plainAnswer);
  if (ui.plainServed === null) throw new Error(NOT_ASKED);
  return ui.plainServed === true;
}
const OTHER_MODE = "This Solana backup is for another network or mode. It was not used.";
const NO_PRIVATE_START = "Device 1 of this wallet did not start a private Solana wallet, so this "
  + "file was not used.";
const START_UNKNOWN = "This browser could not check the Solana start of this wallet in time. Wait "
  + "a moment, then open the file again.";
const PRIVATE_NOT_ASKED = "This browser does not know yet whether this server serves the private "
  + "Solana wallet. Wait a moment, then open the file again.";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// The label of the start that seat 1 signed, read from the store, or null when it has none.
async function signedStart(gid) {
  const ref = sdb.doc("groups/" + gid + "/solstart/1");
  for (const end = Date.now() + PROBE_MS; ;) {
    const snap = await ref.get();
    const d = snap.exists ? snap.data() : null;
    const verdict = d ? checkIn(gid)("solstart/1", d.by, d.sig, docFields(d), 1) : "no";
    if (verdict !== "wait") return verdict === "yes" ? docFields(d).cluster : null;
    if (Date.now() > end) throw new Error(START_UNKNOWN);
    await sleep(150);
  }
}
async function privateUnserved() {
  privateServed();
  await within(privateAnswer);
  if (ui.privateServed === null) return PRIVATE_NOT_ASKED;
  return ui.privateServed ? null : UNSERVED;
}
// Why a mainnet-private file of wallet `gid` is refused, or null. It opens the wallet first.
async function privateRefusal(gid) {
  if (!solGroup(gid)) return NOT_LISTED;
  if (!mainnetOn(gid)) return netConfirmed(gid) ? OTHER_MODE : NET_UNCONFIRMED;
  if (state.gid !== gid) openGroup(gid);
  const start = await signedStart(gid);
  if (start !== PRIVATE_LABEL) return start ? OTHER_MODE : NO_PRIVATE_START;
  return privateUnserved();
}
// A mainnet-private file (design 2.4 Restore) needs a wallet that seat 1 started as a private
// wallet, on a server that serves the private Worker. Only then this browser pins the private
// mode, and the pool controller restores the file. Any refusal writes no pin.
async function privateRestore(b, encrypted) {
  const why = await privateRefusal(b.group);
  if (why) throw new Error(why);
  acceptPrivate(b.group);
  await solLoad();
  if (!sol) throw new Error(solError || "Solana did not load.");
  if (sol.ctl.gid !== b.group) sol.open(b.group, "groups/" + b.group);
  return sol.restore(b, encrypted);
}
// A mainnet-private file goes to the private route, which the wallet must allow. Any other file
// goes where the wallet decides.
export async function solRestore(b, encrypted) {
  if (b.cluster === PRIVATE_LABEL) return privateRestore(b, encrypted);
  if (await plainRoute(b)) return plainRestore(b, encrypted);
  if (solGroup(b.group) && !solOn(b.group)) {
    throw new Error(netConfirmed(b.group) ? "Solana runs on version 3 testnet wallets only."
      : NET_UNCONFIRMED);
  }
  await solLoad();
  if (!sol) throw new Error(solError || "Solana did not load.");
  return sol.restore(b, encrypted);
}
