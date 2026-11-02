// The move of the funds of the group transparent address to the shielded address of the wallet
// (wasm/src/p2sh.rs). One device proposes it: its chain wallet builds the PCZT from the payments
// that the light-wallet server lists. Each device checks the move with its own engine and signs
// each input with the ZIP 48 key of its seat. Any device of the wallet that holds t signatures
// proves the transaction and sends it. The documents under groups/<id>/sweep/: proposal {v, pczt},
// <seat> {v, txid, key, signatures} and sent {v, txid}, each signed by its seat. Every amount on
// screen comes from the check of this device, never from a document.
import { act, el } from "./app-dom.js";
import { engineOffThread, Z } from "./app-engine.js";
import { curChain, netName } from "./app-chain.js";
import { canWriteAs, checkIn, NO_SEAT_KEY, signedDoc, writer } from "./app-filter.js";
import { fmtZec, isStr, J, S, said, short, track } from "./app-kit.js";
import { sec } from "./app-keystore.js";
import { render } from "./app-loop.js";
import { broadcastAnywhere, freshTip } from "./app-payments.js";
import { localSeats } from "./app-seats.js";
import { log, showBanner, state } from "./app-state.js";
import { docFields } from "./signed.js";

let watched = null, docs = {}, store = null, checks = new Map();

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

const ownPackage = (gid, seat) => S(sec(gid, seat).keyPackage);

// What the engine of this device finds in the proposed move: {inputs, total, value, fee, txid,
// expiry_height}, or {error}. Keyed by the transaction.
function checkOf(gid, pczt, keys) {
  const fvk = state.wallet?.orchard_fvk;
  if (!isStr(pczt) || !isStr(fvk)) return { error: "The proposed move cannot be read." };
  let ck = checks.get(pczt);
  if (!ck) {
    try {
      const g = state.g;
      ck = J(Z.sweepCheck(pczt, g.t, keys, ownPackage(gid, localSeats()[0]), fvk, netName(g)));
    } catch (e) { ck = { error: said(e) }; }
    checks.set(pczt, ck);
  }
  return ck;
}

// The open move of the wallet: {pczt, ck, approved, sent, expired}, or null with no proposal.
function openMove(gid, keys) {
  const p = signed(gid, "proposal", docs.proposal?.by);
  if (!p) return null;
  const ck = checkOf(gid, p.pczt, keys);
  if (ck.error) return { ck };
  const tip = curChain()?.bal?.tip;
  const sent = signed(gid, "sent", docs.sent?.by)?.txid === ck.txid;
  return { pczt: p.pczt, ck, approved: approvals(gid, ck.txid), sent,
    expired: Number.isInteger(tip) && tip >= ck.expiry_height };
}

// The seats whose signatures for the move `txid` this device sees, in seat order. Signatures of an
// older move do not count: one of them would make the whole finish fail.
function approvals(gid, txid) {
  return Array.from({ length: state.g.n }, (_, i) => i + 1).filter((i) => {
    const d = signed(gid, String(i), i);
    return d?.txid === txid && isStr(d.key) && Array.isArray(d.signatures);
  });
}

async function writeDoc(gid, name, seat, fields) {
  const doc = await signedDoc(gid, "sweep/" + name, seat, { v: 1, ...fields });
  await store.doc("groups/" + gid + "/sweep/" + name).set(doc);
}

/** Proposes a move of the payments `utxos` (transparentUtxos) of the group with the keys `keys`. */
export async function proposeSweep(keys, utxos) {
  const gid = state.gid, g = state.g, c = curChain(), seat = writer();
  if (!c?.bal) throw new Error("Wait for the first sync of this wallet, then move the funds.");
  if (seat == null) throw new Error(NO_SEAT_KEY);
  const out = J(await track(c.cw, c.cw.createSweep(S(utxos), g.t, keys, ownPackage(gid, seat))));
  await writeDoc(gid, "proposal", seat, { pczt: out.pczt });
}

/** Seat `seat` of this browser checks the open move again and signs each of its inputs. */
export async function approveSweep(seat, keys) {
  const gid = state.gid, g = state.g, m = openMove(gid, keys);
  if (!m || m.ck.error || m.expired || m.sent) throw new Error("No move waits for an approval.");
  if (!canWriteAs(seat)) throw new Error(NO_SEAT_KEY);
  const tip = await freshTip();
  const out = J(Z.sweepSign(m.pczt, g.t, keys, ownPackage(gid, seat), state.wallet.orchard_fvk,
    netName(g), tip));
  await writeDoc(gid, String(seat), seat, { txid: m.ck.txid, key: out.key,
    signatures: out.signatures });
}

/** Proves the open move with the signatures of t seats, sends it, and marks it as sent. */
export async function sendSweep(keys) {
  const gid = state.gid, g = state.g, m = openMove(gid, keys), seat = writer();
  if (!m || m.ck.error || m.expired) throw new Error("No move can be sent now.");
  if (m.approved.length < g.t) throw new Error("The move needs " + g.t + " approvals first.");
  if (seat == null) throw new Error(NO_SEAT_KEY);
  const sigs = m.approved.slice(0, g.t).map((i) => ({ key: docs[i].key,
    signatures: docs[i].signatures }));
  log("building Halo2 proof of the move (about a minute)…");
  const out = await engineOffThread("sweepFinish", m.pczt, S(sigs));
  await broadcastAnywhere(out.tx_hex);
  await writeDoc(gid, "sent", seat, { txid: out.txid });
  showBanner("ok", "Sent. The move confirms with the next block.");
}

const MOVE = "Move to the shielded address";
const button = (text, fn) => el("button", { class: "btn", onclick: act(fn) }, text);

// What the open move does, from the check of this device.
function moveText(m, g) {
  const { inputs, value, fee } = m.ck;
  const what = "A move of " + fmtZec(value) + " to the shielded address of this wallet spends "
    + inputs + (inputs === 1 ? " payment" : " payments") + " of the transparent address. The "
    + "network fee is " + fmtZec(fee) + ".";
  if (m.sent) {
    return what + " It was sent to the network (" + short(m.ck.txid) + "). The balance changes "
      + "when a block holds it.";
  }
  return what + " " + m.approved.length + " of " + g.t + " devices approved it.";
}

// The buttons of an open move: an approval for each seat of this browser that did not sign, and
// Send once t seats signed.
function moveButtons(m, g, keys) {
  const mine = localSeats().filter((i) => !m.approved.includes(i) && canWriteAs(i));
  const out = mine.map((i) => button("Approve as device " + i, () => approveSweep(i, keys)));
  if (m.approved.length >= g.t) out.push(button("Send the move", () => sendSweep(keys)));
  return out;
}

/**
 * The part of the transparent section for the move to the shielded address: the open move, or
 * the button that proposes one when the address holds payments. `keys` are the published keys of
 * the group, and `balance` is the last read of the address ({utxos}), or null.
 */
export function sweepPart(keys, balance) {
  const gid = state.gid, g = state.g, m = openMove(gid, keys);
  // A sent move keeps the payments listed until a block holds it: no new move for those.
  const swept = m?.sent && balance?.zat === m.ck.total;
  const canPropose = balance?.utxos?.length > 0 && !swept;
  const line = (text) => el("p", { class: "small", "data-sweep": "state" }, text);
  const parts = [];
  if (m?.ck.error) parts.push(line("The proposed move does not check, so this browser does not "
    + "approve it: " + m.ck.error));
  else if (m?.expired && !m.sent) parts.push(line("The proposed move expired. Propose it again."));
  else if (m) parts.push(line(moveText(m, g)));
  const open = m && !m.ck.error && !m.expired && !m.sent;
  const buttons = open ? moveButtons(m, g, keys) : [];
  if (!open && canPropose) buttons.push(button(MOVE, () => proposeSweep(keys, balance.utxos)));
  if (!parts.length && !buttons.length) return null;
  return el("div", { "data-sweep": "part", style: "display:grid;gap:8px" }, ...parts,
    el("div", { class: "dialog-actions" }, ...buttons));
}
