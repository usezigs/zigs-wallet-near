// The transparent address of the open wallet: a P2SH multisig address (ZIP 48) that needs the
// signatures of t of the n devices. Each device derives its key from its own key share
// (wasm/src/p2sh.rs) and publishes the public part as the signed document p2sh/<seat>. Every
// device builds the address itself from the n signed keys, so no device can choose it alone.
// Version 3 wallets only: before, the documents carry no signature. A swap from ZEC gets its
// refunds at this address. The chain shows the address, its balance and every payment to it.
// t devices move its funds to the shielded address of the wallet (app-sweep.js).
import { addrGroups, copyBtn, el, qrBox } from "./app-dom.js";
import { Z } from "./app-engine.js";
import { canWriteAs, checkIn, signedDoc, signedMode, signPins } from "./app-filter.js";
import { J, S, exclusive, oldest, said, saveMerged } from "./app-kit.js";
import { sec } from "./app-keystore.js";
import { render } from "./app-loop.js";
import { localSeats } from "./app-seats.js";
import { log, state } from "./app-state.js";
import { sweepPart, watchSweep } from "./app-sweep.js";
import { netName, netOf, pickServer } from "./app-chain.js";
import { pin } from "./chat.js";

let watched = null, raw = {}, store = null, balance = null, tried = new Set(), loaded = false;
const READ_FAILED = "The keys of the transparent address could not be read. Reopen this wallet "
  + "to try again.";
let readError = "";

// This device keeps the first signed key that it saw for each seat, in `zf-signpins` under
// "p2sh:<wallet id>:<network>:<seat>". A seat that signs another key later could move the address
// after funds arrived, and the server could show each device another one of its keys.
function keptKey(gid, seat, key) {
  const seen = pin(signPins, ["p2sh", gid, netName(state.g), seat].join(":"), key);
  if (seen === "new") saveMerged("zf-signpins", signPins, oldest);
  return seen !== "changed";
}

// The signed key of `seat` in its document: null when the document is missing or its signature
// does not check, undefined while the check runs, and false when it is another key than the one
// that this device kept.
function keyOf(gid, seat) {
  const d = raw[seat];
  if (!d || d.v !== 1 || typeof d.key !== "string") return null;
  let verdict;
  try {
    verdict = checkIn(gid)("p2sh/" + seat, d.by, d.sig, { v: 1, key: d.key }, seat);
  } catch { return null; }
  if (verdict !== "yes") return verdict === "wait" ? undefined : null;
  return keptKey(gid, seat, d.key) ? d.key : false;
}

const ownKey = (gid, seat) => {
  const kp = sec(gid, seat)?.keyPackage;
  return kp ? Z.p2shKey(S(kp), netName(state.g)) : null;
};

// Each local seat publishes its key when its document does not hold the key that its share gives
// (a new wallet, a restore, or a document that someone changed). Each seat decides once each time
// the wallet opens, after the store answered and the check of its document ended. So it does not
// write a key that the store holds, and a server that changes the document cannot start a loop.
function publish(gid) {
  if (gid !== state.gid || !store || !loaded || !signedMode(gid)) return;
  for (const seat of localSeats()) {
    const key = keyToPublish(gid, seat);
    if (!key) continue;
    void exclusive("p2sh:" + gid + ":" + seat, async () => {
      const rel = "p2sh/" + seat;
      const doc = await signedDoc(gid, rel, seat, { v: 1, key });
      await store.doc("groups/" + gid + "/" + rel).set(doc);
    }).catch((e) => {
      readError = "This device could not publish its key. Reopen the wallet.";
      log("publish the transparent key of seat " + seat + ": " + said(e));
    });
  }
}

// The key that `seat` must publish now, or null.
function keyToPublish(gid, seat) {
  if (tried.has(seat) || !canWriteAs(seat)) return null;
  try {
    const key = ownKey(gid, seat), held = keyOf(gid, seat);
    if (!key || held === undefined) return null;
    tried.add(seat);
    return held === key ? null : key;
  } catch (e) {
    tried.add(seat);
    log("the transparent key of seat " + seat + ": " + said(e));
    return null;
  }
}

/** The reactor calls this: the seats of this browser load after the watch of the keys starts. */
export const publishTaddressKeys = () => publish(state.gid);

/** Watches the published keys of `gid` in `db`. Returns the function that stops the watch. */
export function watchTaddress(gid, db) {
  watched = gid; raw = {}; store = db; balance = null; readError = ""; tried = new Set();
  loaded = false;
  if (!gid) { watchSweep(null); return () => {}; }
  let live = true, stop = () => {};
  const received = (snap) => {
    if (!live || watched !== gid) return;
    raw = {};
    for (const d of snap.docs) if (/^[1-9]$|^1[0-5]$/.test(d.id)) raw[Number(d.id)] = d.data();
    readError = ""; loaded = true;
    publish(gid);
    render();
  };
  const failed = () => {
    if (!live || watched !== gid) return;
    raw = {}; readError = READ_FAILED; render();
  };
  try {
    stop = db.collection("groups/" + gid + "/p2sh").onSnapshot(received, failed);
  } catch { failed(); }
  const stopSweep = watchSweep(gid, db);
  return () => { live = false; stop(); stopSweep(); };
}

const NO_SEAT = "This browser holds no device of this wallet, so it cannot build the transparent "
  + "address of the group.";
const MOVED = (seats) => "Device " + seats.join(", ") + " published another transparent key than "
  + "the one that this browser saw first. The address does not show, because it would change. Ask "
  + "the people of this wallet.";

// Why the address of the open wallet cannot show yet, or null.
function addressBlocker(gid, g) {
  if (!g || watched !== gid || !state.seatsLoaded) return { error: "" };
  if (!signedMode(gid)) return { error: "A transparent address needs a version 3 wallet." };
  if (readError) return { error: readError };
  return localSeats().length ? null : { error: NO_SEAT };
}

// The n signed keys of the group: {keys}, {published, of} while some are missing, or {error}.
function groupKeys(gid, n) {
  const all = Array.from({ length: n }, (_, i) => keyOf(gid, i + 1));
  const moved = all.flatMap((key, i) => (key === false ? [i + 1] : []));
  if (moved.length) return { error: MOVED(moved) };
  const keys = all.filter(Boolean);
  return keys.length < n ? { published: keys.length, of: n } : { keys };
}

/**
 * The transparent address of the open wallet: {address, keys} when all n devices published a
 * signed key and the engine accepts the set, {published, of} while some keys are missing, or
 * {error}.
 */
export function groupTaddress() {
  const gid = state.gid, g = state.g;
  const blocker = addressBlocker(gid, g);
  if (blocker) return blocker;
  const set = groupKeys(gid, g.n);
  if (!set.keys) return set;
  try {
    const kp = S(sec(gid, localSeats()[0]).keyPackage);
    return { address: J(Z.p2shAddress(g.t, set.keys, kp, netName(g))).address, keys: set.keys };
  } catch (e) {
    return { error: "The published keys do not make a group address: " + said(e) };
  }
}

/** The balance of the transparent address: {zat} once read, {error}, or null before a read. */
export const taddressBalance = () => (balance && !balance.reading
  && balance.address === groupTaddress().address ? balance : null);

/** Reads the balance of `address` from a light-wallet server of the open wallet. */
export async function readTaddressBalance(address) {
  const gid = state.gid;
  balance = { address, reading: true };
  try {
    const url = await pickServer(netOf(state.g));
    const out = J(await Z.transparentUtxos(url, address));
    if (gid === state.gid) balance = { address, zat: out.total, utxos: out.utxos, more: out.more };
  } catch (e) {
    if (gid === state.gid) balance = { address, error: "The balance could not be read." };
    log("the balance of the transparent address: " + said(e));
  }
  render();
}

const PUBLIC_TEXT = (g) => "This address belongs to the group: a payment from it needs " + g.t
  + " of the " + g.n + " devices. The chain shows its balance and every payment to it to "
  + "everyone. A swap from ZEC sends its refund here. Receive other payments at the shielded "
  + "address above. Zigs moves the funds to the shielded address of this wallet when " + g.t
  + " devices approve. The chain shows the amount of the move too.";
const WAITING_TEXT = (t) => t.published + " of " + t.of + " devices published their key. The "
  + "address shows when each device opened this wallet once.";

// The balance line: the read starts when the line first shows.
function balanceLine(address) {
  const b = taddressBalance();
  if (!b && balance?.address !== address) void readTaddressBalance(address);
  const text = !b ? "Reading the balance…" : b.error ? b.error
    : "Balance: " + (b.more ? "at least " : "") + (b.zat / 1e8).toFixed(8).replace(/\.?0+$/, "")
      + " ZEC in " + b.utxos.length + (b.utxos.length === 1 ? " payment" : " payments");
  return el("p", { class: "small", "data-taddress": "balance" }, text);
}

/** The part of the Receive dialog for the transparent address of the group, or null. */
export function taddressSection() {
  const t = groupTaddress(), g = state.g;
  if (t.error === "" || !g) return null;
  const head = el("h3", { style: "font-size:15px" }, "Transparent address · public");
  const body = t.error ? [el("p", { class: "small muted" }, t.error)]
    : !t.address ? [el("p", { class: "small muted" }, WAITING_TEXT(t))]
      : [el("p", { class: "small muted" }, PUBLIC_TEXT(g)), qrBox(t.address, "Transparent address"),
        el("div", { class: "addr-full" }, addrGroups(t.address)), balanceLine(t.address),
        el("div", { class: "dialog-actions" },
          copyBtn(t.address, "Copy transparent address", "btn")),
        sweepPart(t.keys, taddressBalance())];
  return el("section", { class: "callout", "data-taddress": "section",
    style: "display:grid;gap:8px" }, head, ...body);
}
