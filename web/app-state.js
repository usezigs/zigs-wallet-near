// Shared state objects (state, ui, raw, inbox, ready, busy), the log and the banner.
import { errorFeedback } from "./error-feedback.js";

// Payment proposals of every wallet where this browser holds a seat, for the approval counts.
export const inbox = {}, inboxSubs = new Map();
export const ready = {}, readySubs = new Map();
export const state = {
  groups: [], gid: null, cid: null, contact: null, g: null, seats: {}, seatsLoaded: false,
  seatsSettled: false, sessionsLoaded: false, sessionsFailed: false,
  dkg1: {}, dkg2: {}, confirm: {}, abort: {}, done: {}, verify: {}, wallet: null, sessions: [],
  sid: null, commits: {}, commitsLoaded: false, shares: {}, ignored: 0, pending: false, log: [],
};
// What the store holds, before signed writes are checked (in app-filter.js). `state` holds
// what the page may use.
export const emptyRaw = () => ({
  seats: {}, dkg1: {}, dkg2: {}, confirm: {}, abort: {}, done: {}, verify: {}, wallet: null,
  sessions: {}, commits: {}, shares: {},
});
export const raw = emptyRaw(), rawInbox = {}, rawReady = {};
export const busy = new Set();
export let banner = null;

let bannerTimer = null;
export function showBanner(kind, text) {
  banner = { kind, text };
  const b = document.getElementById("banner");
  b.setAttribute("role", kind === "bad" ? "alert" : "status");
  b.hidden = false; b.className = kind;
  document.getElementById("banner-text").textContent = text;
  clearTimeout(bannerTimer);
  if (kind === "ok") bannerTimer = setTimeout(() => { b.hidden = true; }, 4000);
}
export function showError(error) {
  const feedback = errorFeedback(error);
  showBanner("bad", feedback.message);
  // Only fixed classification facts are logged. Raw RPC payloads, URLs and exception text
  // are not copied into diagnostics by this helper.
  if (feedback.detail) log(feedback.detail);
}
// Hides a bad banner. With `text`, only while the banner still shows that text.
export function clearBadBanner(text) {
  if (banner && banner.kind === "bad" && (text === undefined || banner.text === text)) {
    banner = null;
    document.getElementById("banner").hidden = true;
  }
}
export function log(msg) { state.log.unshift(new Date().toLocaleTimeString() + "  " + msg); state.log.length = Math.min(state.log.length, 60); }
// View state that only this browser cares about.
export const ui = {
  forget: false, tab: "overview", send: false, pay: null, payKey: 0, listError: "", after: null,
  create: false, receive: false, move: false, net: "testnet", notify: false,
  createStep: 0, createDraft: null, marginAck: false,
  newChat: false, leave: false, backup: null, restore: null, menu: false,
  localDevicesReview: null, localDevicesError: "",
  request: null, note: "", priority: false, sendFor: null, contactAdd: false,
  joinBad: "", joinOpen: false, join: {},
  personal: { net: "testnet", fund: "0.003", drop: false },
};
// A create dialog opens at its first step, with no values kept from an earlier one. A network
// choice is reset when the dialog closes.
export function resetCreate() {
  ui.createStep = 0; ui.createDraft = null; ui.marginAck = false; ui.sol = undefined;
  ui.createError = null; ui.net = "testnet";
}
export const openCreate = () => { resetCreate(); ui.create = true; };
// The network choice of the account card does not outlive the card.
export function resetPersonalPick() {
  Object.assign(ui.personal, { net: "testnet" });
}
try { ui.notify = localStorage.getItem("zf-notify") === "1"; } catch { /* no storage */ }
document.getElementById("banner-close").addEventListener("click", () => {
  document.getElementById("banner").hidden = true;
});
