// The move of the funds of the group transparent address to the shielded address of the wallet
// (wasm/src/p2sh.rs). One device proposes it: its chain wallet builds the PCZT from the payments
// that the light-wallet server lists. Each device checks the move with its own engine and signs
// each input with the ZIP 48 key of its seat. Any device of the wallet that holds t signatures
// proves the transaction and sends it. The documents under groups/<id>/sweep/: proposal {v, pczt},
// <seat> {v, digest, key, signatures} and sent {v, txid}, each signed by its seat. Every amount
// on screen comes from the check of this device, never from a document.
import { act, el } from "./app-dom.js";
import { engineOffThread, Z } from "./app-engine.js";
import { curChain, curNet, netName } from "./app-chain.js";
import { seatCheck } from "./app-dkg.js";
import { canWriteAs, checkIn, NO_SEAT_KEY, signedDoc, writer } from "./app-filter.js";
import { fmtZec, isStr, J, S, said, short, track } from "./app-kit.js";
import { sec } from "./app-keystore.js";
import { render } from "./app-loop.js";
import { broadcastAnywhere, freshTip } from "./app-payments.js";
import { localSeats } from "./app-seats.js";
import { log, showBanner, state } from "./app-state.js";
import { docFields } from "./signed.js";

let watched = null, docs = {}, store = null, checks = new Map(), sending = false;

/** Watches the move documents of `gid` in `db`. Returns the function that stops the watch. */
export function watchSweep(gid, db) {
  watched = gid; docs = {}; store = db; checks = new Map();
  if (!gid) return () => {};
  let live = true, stop = () => {};
  const received = (snap) => {
    if (!live || watched !== gid) return;
    docs = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    render();
  };
  const failed = (e) => log("the documents of the move from the transparent address: " + said(e));
  try { stop = db.collection("groups/" + gid + "/sweep").onSnapshot(received, failed); }
  catch (e) { failed(e); }
  return () => { live = false; stop(); };
}

// The document `name` when seat `need` signed it, else null. The proposal and the sent mark can
// come from any seat.
function signed(gid, name, need) {
  const d = docs[name];
  if (!d || d.v !== 1) return null;
  try {
    return checkIn(gid)("sweep/" + name, d.by, d.sig, docFields(d), need) === "yes" ? d : null;
  } catch { return null; }
}

// The group of the engine calls, as seat `seat` of this browser sees it.
const groupOf = (gid, seat, keys) =>
  S({ t: state.g.t, keys, key_package: S(sec(gid, seat).keyPackage) });

// What the engine of this device finds in the proposed move: {inputs, total, value, fee, txid,
// digest, expiry_height}, or {error}. Keyed by the transaction.
function checkOf(gid, pczt, keys) {
  const fvk = state.wallet?.orchard_fvk;
  if (!isStr(pczt) || !isStr(fvk)) return { error: "The proposed move cannot be read." };
  let ck = checks.get(pczt);
  if (!ck) {
    try {
      ck = J(Z.sweepCheck(pczt, groupOf(gid, localSeats()[0], keys), fvk, netName(state.g)));
    } catch (e) { ck = { error: said(e) }; }
    checks.set(pczt, ck);
  }
  return ck;
}

// The open move of the wallet: {pczt, ck, approved, count, sent, expired}, or null with no
// proposal. `count` is the number of distinct keys that approved.
function openMove(gid, keys) {
  const p = signed(gid, "proposal", docs.proposal?.by);
  if (!p) return null;
  const ck = checkOf(gid, p.pczt, keys);
  if (ck.error) return { ck };
  const tip = curChain()?.bal?.tip, approved = approvals(gid, ck.digest);
  return { pczt: p.pczt, ck, approved, count: new Set(approved.map((i) => docs[i].key)).size,
    sent: signed(gid, "sent", docs.sent?.by)?.txid === ck.txid,
    expired: Number.isInteger(tip) && tip >= ck.expiry_height };
}

// A compressed secp256k1 key in the hex of `sweepSign`. One key in other letters would count twice.
const KEY = /^0[23][0-9a-f]{64}$/;

// The seats that approved the move with `digest`, in seat order. An approval of another move does
// not count. The engine checks each signature when it finishes the move.
function approvals(gid, digest) {
  return Array.from({ length: state.g.n }, (_, i) => i + 1).filter((i) => {
    const d = signed(gid, String(i), i);
    return d?.digest === digest && isStr(d.key) && KEY.test(d.key) && Array.isArray(d.signatures);
  });
}

const isOpen = (m) => !!m && !m.ck.error && !m.expired && !m.sent;
const CHANGED = "The proposed move changed or expired. Check it again.";

// Seat `seat` of this browser may act for the wallet: it checked the wallet against its key share.
function checkedSeat(seat) {
  if (seat == null || !canWriteAs(seat)) throw new Error(NO_SEAT_KEY);
  if (seatCheck(seat) !== true) {
    throw new Error("Device " + seat + " has not checked this wallet against its key share yet.");
  }
}

async function writeDoc(db, gid, name, seat, fields) {
  const doc = await signedDoc(gid, "sweep/" + name, seat, { v: 1, ...fields });
  await db.doc("groups/" + gid + "/sweep/" + name).set(doc);
}

/**
 * Proposes a move of the payments of the group with the keys `keys`. `reread` reads the payments
 * of the address again and gives the new balance ({utxos}).
 */
export async function proposeSweep(keys, reread) {
  const gid = state.gid, c = curChain(), seat = writer(), db = store;
  if (!c?.bal) throw new Error("Wait for the first sync of this wallet, then move the funds.");
  checkedSeat(seat);
  const group = groupOf(gid, seat, keys), b = await reread();
  if (!(b?.utxos?.length > 0)) throw new Error(b?.error ?? "The address holds no payment now.");
  const out = J(await track(c.cw, c.cw.createSweep(S(b.utxos), group)));
  await writeDoc(db, gid, "proposal", seat, { pczt: out.pczt });
}

/** Seat `seat` of this browser checks the move `digest` again and signs each of its inputs. */
export async function approveSweep(seat, keys, digest) {
  const gid = state.gid, m = openMove(gid, keys), db = store, net = netName(state.g);
  if (!isOpen(m) || m.ck.digest !== digest) throw new Error(CHANGED);
  checkedSeat(seat);
  const fvk = state.wallet.orchard_fvk, group = groupOf(gid, seat, keys);
  const tip = await freshTip();
  const out = J(Z.sweepSign(m.pczt, group, fvk, net, tip));
  await writeDoc(db, gid, String(seat), seat, { digest: out.digest, key: out.key,
    signatures: out.signatures });
}

/**
 * Proves the move `digest` with the signatures of t seats, sends it, and marks it as sent. The
 * engine skips a set of signatures that does not verify, so one seat cannot block the others.
 */
export async function sendSweep(keys, digest) {
  const gid = state.gid, t = state.g.t, m = openMove(gid, keys), seat = writer(), db = store;
  if (!isOpen(m) || m.ck.digest !== digest) throw new Error(CHANGED);
  if (m.count < t) throw new Error("The move needs " + t + " approvals first.");
  checkedSeat(seat);
  const where = { net: curNet(), ufvk: state.wallet.ufvk, birthday: state.wallet.birthday };
  const sets = m.approved.map((i) => ({ key: docs[i].key, signatures: docs[i].signatures }));
  sending = true;
  render();
  try {
    log("building Halo2 proof of the move (about a minute)…");
    const out = await engineOffThread("sweepFinish", m.pczt, S(sets), t);
    await broadcastAnywhere(out.tx_hex, where);
    await writeDoc(db, gid, "sent", seat, { txid: out.txid });
  } finally {
    sending = false;
    render();
  }
  showBanner("ok", "The move was submitted to the network. Wait for block confirmation.");
}

const MOVE = "Move to the shielded address";
const button = (text, fn) => el("button", { class: "btn", onclick: act(fn) }, text);

// What the open move does, from the check of this device.
function moveText(m) {
  const { inputs, value, fee } = m.ck;
  const what = "A move of " + fmtZec(value) + " to the shielded address of this wallet spends "
    + inputs + (inputs === 1 ? " payment" : " payments") + " of the transparent address. The "
    + "network fee is " + fmtZec(fee) + ".";
  if (m.sent) {
    return what + " It was sent to the network (" + short(m.ck.txid) + "). The balance changes "
      + "when a block holds it.";
  }
  return what + " " + m.count + " of " + state.g.t + " devices approved it.";
}

// The line of a proposed move: why it gets no approval, or what it does.
function moveLine(m) {
  if (m.ck.error) {
    return "The proposed move does not check, so this browser does not approve it: " + m.ck.error;
  }
  return m.expired && !m.sent ? "The proposed move expired. Propose it again." : moveText(m);
}

// The buttons of an open move: an approval for each seat of this browser that did not sign, and
// Send once t keys signed. Each button acts only on the move that it shows.
function moveButtons(m, keys) {
  const digest = m.ck.digest;
  const mine = localSeats().filter((i) => !m.approved.includes(i) && canWriteAs(i));
  const approve = (i) => button("Approve as device " + i, () => approveSweep(i, keys, digest));
  const out = mine.map(approve);
  if (sending) out.push(el("p", { class: "small" }, "Proving and sending the move…"));
  else if (m.count >= state.g.t) out.push(button("Send the move", () => sendSweep(keys, digest)));
  return out;
}

// A new move needs payments at the address. A sent move keeps its payments listed until a block
// holds it or it expires, so no new move is proposed meanwhile.
const mayPropose = (m, balance) => !isOpen(m) && !(m?.sent && !m.expired)
  && balance?.utxos?.length > 0;

/**
 * The part of the transparent section for the move to the shielded address: the proposed move,
 * or the button that proposes one when the address holds payments. `keys` are the published keys
 * of the group, `balance` is the last read of the address ({utxos}) or null, and `reread` reads it
 * again.
 */
export function sweepPart(keys, balance, reread) {
  const m = openMove(state.gid, keys);
  const buttons = isOpen(m) ? moveButtons(m, keys) : [];
  if (mayPropose(m, balance)) buttons.push(button(MOVE, () => proposeSweep(keys, reread)));
  if (!m && !buttons.length) return null;
  return el("div", { "data-sweep": "part", style: "display:grid;gap:8px" },
    m && el("p", { class: "small", "data-sweep": "state" }, moveLine(m)),
    el("div", { class: "dialog-actions" }, ...buttons));
}
