// The transparent address of the open wallet: a P2SH multisig address (ZIP 48) that needs the
// signatures of t of the n devices. Each device derives its key from its own key share
// (wasm/src/p2sh.rs) and publishes the public part as the signed document p2sh/<seat>. Every
// device builds the address itself from the n signed keys, so no device can choose it alone.
// Version 3 wallets only: before, the documents carry no signature. A swap from ZEC gets its
// refunds at this address. The chain shows the address, its balance and every payment to it.
import { addrGroups, copyBtn, el, qrBox } from "./app-dom.js";
import { Z } from "./app-engine.js";
import { canWriteAs, checkIn, signedDoc, signedMode } from "./app-filter.js";
import { J, S, exclusive } from "./app-kit.js";
import { sec } from "./app-keystore.js";
import { render } from "./app-loop.js";
import { localSeats } from "./app-seats.js";
import { state } from "./app-state.js";
import { netName, netOf, pickServer } from "./app-chain.js";

let watched = null, raw = {}, store = null, balance = null, tried = new Set();
const READ_FAILED = "The keys of the transparent address could not be read. Reopen this wallet "
  + "to try again.";
let readError = "";

// The signed key of `seat` in its document, or null when the document is missing or its
// signature does not check.
function keyOf(gid, seat) {
  const d = raw[seat];
  if (!d || d.v !== 1 || typeof d.key !== "string") return null;
  try {
    return checkIn(gid)("p2sh/" + seat, d.by, d.sig, { v: 1, key: d.key }, seat) === "yes"
      ? d.key : null;
  } catch { return null; }
}

const ownKey = (gid, seat) => {
  const kp = sec(gid, seat)?.keyPackage;
  return kp ? Z.p2shKey(S(kp), netName(state.g)) : null;
};

// Each local seat publishes its key when its document does not hold the key that its share gives
// (a new wallet, a restore, or a document that someone changed). It writes at most once each time
// the wallet opens, so a server that changes the document cannot start a loop of writes.
function publish(gid) {
  if (gid !== state.gid || !store || !signedMode(gid)) return;
  for (const seat of localSeats()) {
    let key = null;
    try { key = ownKey(gid, seat); } catch { continue; }
    if (!key || keyOf(gid, seat) === key || !canWriteAs(seat) || tried.has(seat)) continue;
    tried.add(seat);
    void exclusive("p2sh:" + gid + ":" + seat, async () => {
      const rel = "p2sh/" + seat;
      const doc = await signedDoc(gid, rel, seat, { v: 1, key });
      await store.doc("groups/" + gid + "/" + rel).set(doc);
    }).catch(() => { readError = "This device could not publish its key. Reopen the wallet."; });
  }
}

/** Watches the published keys of `gid` in `db`. Returns the function that stops the watch. */
export function watchTaddress(gid, db) {
  watched = gid; raw = {}; store = db; balance = null; readError = ""; tried = new Set();
  if (!gid) return () => {};
  let live = true, stop = () => {};
  const received = (snap) => {
    if (!live || watched !== gid) return;
    raw = {};
    for (const d of snap.docs) if (/^[1-9]$|^1[0-5]$/.test(d.id)) raw[Number(d.id)] = d.data();
    readError = "";
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
  return () => { live = false; stop(); };
}

/**
 * The transparent address of the open wallet: {address} when all n devices published a signed
 * key and the engine accepts the set, {published, of} while some keys are missing, or {error}.
 */
export function groupTaddress() {
  const gid = state.gid, g = state.g;
  if (!g || watched !== gid) return { error: "" };
  if (!signedMode(gid)) return { error: "A transparent address needs a version 3 wallet." };
  if (readError) return { error: readError };
  const seats = Array.from({ length: g.n }, (_, i) => i + 1);
  const keys = seats.map((seat) => keyOf(gid, seat)).filter(Boolean);
  if (keys.length < g.n) return { published: keys.length, of: g.n };
  const [mine] = localSeats();
  try {
    const kp = S(sec(gid, mine).keyPackage);
    return { address: J(Z.p2shAddress(g.t, keys, kp, netName(g))).address };
  } catch (e) {
    return { error: "The published keys do not make a group address: " + (e?.message || e) };
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
    if (gid === state.gid) balance = { address, zat: out.total, utxos: out.utxos };
  } catch (e) {
    if (gid === state.gid) balance = { address, error: "The balance could not be read." };
    void e;
  }
  render();
}

const PUBLIC_TEXT = (g) => "This address belongs to the group: a payment from it needs " + g.t
  + " of the " + g.n + " devices. The chain shows its balance and every payment to it to "
  + "everyone. A swap from ZEC sends its refund here. Receive other payments at the shielded "
  + "address above. Zigs cannot move funds from this address yet.";
const WAITING_TEXT = (t) => t.published + " of " + t.of + " devices published their key. The "
  + "address shows when each device opened this wallet once.";

// The balance line: the read starts when the line first shows.
function balanceLine(address) {
  const b = taddressBalance();
  if (!b && balance?.address !== address) void readTaddressBalance(address);
  const text = !b ? "Reading the balance…" : b.error ? b.error
    : "Balance: " + (b.zat / 1e8).toFixed(8).replace(/\.?0+$/, "") + " ZEC in " + b.utxos.length
      + (b.utxos.length === 1 ? " payment" : " payments");
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
          copyBtn(t.address, "Copy transparent address", "btn"))];
  return el("section", { class: "callout", "data-taddress": "section",
    style: "display:grid;gap:8px" }, head, ...body);
}
