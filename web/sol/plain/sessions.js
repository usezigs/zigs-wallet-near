// The signing sessions of the plain wallet (ZOLANA.md 3.8). A session is one document,
// `solsessions/<id>`, whose proposal a seat signed; the commits and the shares of the signing
// seats sit below it. This is the plain twin of web/sol/sessions.js, which the plain controller
// does not import: the closure of control.js holds no pool code. The path, the parts and the
// signed fields are the same: proposal, package, signed, sent and failure. A part counts only when
// the part before it counts. A session is built from signed fields alone, so an unsigned field of
// the document never reaches it.
import { base58, readDocs } from "../docs.js";
import { indexOfSend, isSendIntent, kindOfIntent } from "./intent.js";

export const SESSIONS = "solsessions";
export const ENDED = new Set(["sent", "failed"]);
/**
 * The fields that the proposer signs, in the order of the signature. `swap` is there only on the
 * deposit of a swap (swapOf), so a proposal without it signs the fields that it signed before.
 */
export const PROPOSAL = ["intent", "message", "feeSig", "createdAt", "swap"];
/** No device approves or sends a swap deposit in this time before its deadline. */
export const SWAP_MARGIN_MS = 30 * 60_000;
const SWAP_MARK =
  /^near-sol-zec ([1-9A-HJ-NP-Za-km-z]{32,44}) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/;

/** The signed parts of a session document, as the pool names them (web/sol/sessions.js). */
export const PARTS = {
  proposal: { by: "by", sig: "sig", fields: PROPOSAL },
  package: { by: "packageBy", sig: "packageSig", fields: ["package", "signers", "digest"] },
  signed: { by: "signedBy", sig: "signedSig", fields: ["signature"], needs: "package" },
  sent: { by: "sentBy", sig: "sentSig", fields: ["txId", "slot", "outcome"], needs: "signed" },
  failure: { by: "errorBy", sig: "errorSig", fields: ["error"] },
};

/** The id rule of the pool. A session with another id has commits that nobody can read. */
export const SESSION_ID = /^[\w-]{1,64}$/;
const HEX = /^([0-9a-f]{2})+$/;
const SIGNATURE = /^[0-9a-f]{128}$/;
const MAX_MESSAGE_HEX = 2 * 1232; // a transaction fits one packet
const DAY_MS = 24 * 60 * 60 * 1000; // the most that a clock may run ahead of this one
export const SHARED = "Another proposal on the same nonce account came first. Propose it again.";
export const SUPERSEDED =
  "Another send on the same nonce account landed first, so this one can never be sent. " +
  "Propose it again.";
export const TWIN_FEE = "Two devices show one fee address, so this proposal cannot be used.";
const TITLES = { "send-sol": "Send SOL", "send-token": "Send token" };
const SWAP_TITLE = "Swap deposit (SOL to ZEC)";
const num = (n) => (Number.isFinite(n) ? n : 0);

/** The `swap` field of the deposit of a swap from SOL to ZEC (docs/sol-to-zec-group.md). */
export const swapMark = (deposit, deadline) => `near-sol-zec ${deposit} ${deadline}`;

/**
 * The swap that the proposal `ss` pays: { deposit, deadline (ms), iso }, or null when it has no
 * `swap` field or a field of another form.
 */
export function swapOf(ss) {
  const m = typeof ss?.swap === "string" ? SWAP_MARK.exec(ss.swap) : null;
  const at = m ? Date.parse(m[2]) : NaN;
  if (!m || !Number.isFinite(at) || new Date(at).toISOString() !== m[2]) return null;
  return { deposit: m[1], deadline: at, iso: m[2] };
}

// A proposal with no `swap` field, or the deposit of a swap: a SOL send with a field of the form.
const swapFits = (ss) =>
  ss.swap === undefined || (kindOfIntent(ss.intent) === "send-sol" && swapOf(ss) !== null);

/** The signed fields of part `name` in the document `d`, in the order of the signature. */
export function partFields(name, d) {
  const out = {};
  for (const k of PARTS[name].fields) if (d[k] !== undefined) out[k] = d[k];
  return out;
}

/** The signed fields of the proposal in `d`, in the order of the signature. */
export const proposalFields = (d) => partFields("proposal", d);

// A text (not a number, a list or an absent field) that the pattern accepts.
const fits = (value, pattern) => typeof value === "string" && pattern.test(value);

/**
 * True for an id that is safe as the key of a plain object: `constructor` and `__proto__` match
 * the id rule, and a map that takes them as keys would answer for every other id.
 */
export const safeId = (id) => fits(id, SESSION_ID) && !(id in Object.prototype);

/** A time that a proposal may carry: a whole number above 0 that is not far ahead of this clock. */
const timeOk = (t) => Number.isSafeInteger(t) && t > 0 && t <= Date.now() + DAY_MS;

/** True for a session that this app shows and signs: a send with well formed hex fields. */
export const showable = (ss) =>
  isSendIntent(ss?.intent) &&
  safeId(ss.id) &&
  fits(ss.message, HEX) &&
  ss.message.length <= MAX_MESSAGE_HEX &&
  fits(ss.feeSig, SIGNATURE) &&
  timeOk(ss.createdAt) &&
  swapFits(ss);

/**
 * The title of a session from its tag and its `swap` field. A recipient or an amount comes from
 * the checker only.
 */
export function titleOf(ss) {
  if (!showable(ss)) return null;
  return ss.swap === undefined ? TITLES[kindOfIntent(ss.intent)] : SWAP_TITLE;
}

/**
 * The session that already pays the deposit address of the swap deposit `ss`: an older one that
 * did not fail (by createdAt, then id), or null. One deposit address gets one send.
 */
export function earlierSwap(sessions, ss) {
  const deposit = swapOf(ss)?.deposit;
  if (!deposit) return null;
  const older = (o) => byAge(o, ss) < 0;
  return sessions.find((o) => o.id !== ss.id && o.status !== "failed" && showable(o)
    && swapOf(o)?.deposit === deposit && older(o)) ?? null;
}

/** True when the swap deposit `ss` has less than SWAP_MARGIN_MS left before its deadline. */
export const swapLate = (ss, now = Date.now()) => {
  const swap = swapOf(ss);
  return swap !== null && swap.deadline - now < SWAP_MARGIN_MS;
};

/**
 * True when the valid fee document of another seat shows the same key as the one of `seat`
 * (`docs` is c.docs). A device that copies the fee key of another device could copy its proposals
 * and sign them under its own name, so the proposals of both stand for no one.
 */
export function feeShared(docs, seat) {
  const key = docs.solfee?.[seat]?.key;
  if (key === undefined) return false;
  const others = Object.entries(docs.solfee).filter(([i]) => Number(i) !== Number(seat));
  return others.some(([, doc]) => doc?.key === key);
}

// The nonce account of an open or landed send: its writer, the index k and the nonce value. The
// value alone is not enough, because two accounts that are made in one slot hold the same value.
const accountOf = (ss) => ss.by + ss.intent.slice(2, 74);
const open = (ss) => !ENDED.has(ss.status) && showable(ss);

// The first by (createdAt, id) keeps the account, so that every device reaches the same verdict,
// and the other open proposals on it end with a reason.
const byAge = (a, b) => num(a.createdAt) - num(b.createdAt) || (a.id < b.id ? -1 : 1);
function endDuplicates(sessions) {
  const taken = new Set();
  for (const ss of [...sessions].sort(byAge).filter(open)) {
    if (taken.has(accountOf(ss))) Object.assign(ss, { status: "failed", error: SHARED });
    else taken.add(accountOf(ss));
  }
}

// A send that landed used its nonce: every other session that waits on that account and value
// ends, also a signed one. This reads signed documents only, so a node that lags ends nothing.
function endSuperseded(sessions) {
  const used = new Set(
    sessions.filter((ss) => ss.status === "sent" && showable(ss)).map(accountOf),
  );
  for (const ss of sessions.filter(open)) {
    if (used.has(accountOf(ss))) Object.assign(ss, { status: "failed", error: SUPERSEDED });
  }
}

/** The indexes k of the nonce accounts of `seat` that an open session holds. */
export const heldIndexes = (sessions, seat) =>
  new Set(sessions.filter((ss) => ss.by === seat && open(ss)).map((ss) => indexOfSend(ss.intent)));

// The pool order: a landed send stays landed, whatever failure text was written.
function statusOf(ok) {
  if (ok.sent) return "sent";
  if (ok.failure) return "failed";
  if (ok.signed) return "signed";
  return ok.package ? "signing" : "collecting";
}

// A part is there when the document holds any of its fields, its writer or its signature.
const present = (name, d) =>
  name === "proposal" ||
  [...PARTS[name].fields, PARTS[name].by, PARTS[name].sig].some((k) => d[k] !== undefined);

// The sent mark must name the transaction that the signatures give: the first signature is the
// id. The fee key signs first, then the group (web/sol/sessions.js sentMatches).
const sentMatches = (f) =>
  fits(f.signature, SIGNATURE) && fits(f.feeSig, SIGNATURE) && f.txId === base58(f.feeSig);

// The verdict of one part ("yes", "no" or "wait"): the part before it must count, and the sent mark
// must name the transaction.
function askPart(name, d, state, ask) {
  const need = PARTS[name].needs;
  if (need && state.verdict[need] !== "yes") return state.verdict[need] === "wait" ? "wait" : "no";
  if (name === "sent" && !sentMatches({ ...state.fields, ...partFields(name, d) })) return "no";
  return ask(name);
}

// Reads every part that the document holds, in the order of PARTS. Stops at a proposal that does
// not count. Returns the signed fields of the parts that count and the verdicts.
function readParts(d, ask) {
  const state = { verdict: {}, fields: {}, bad: [], wait: 0 };
  for (const name of Object.keys(PARTS)) {
    if (!present(name, d)) continue;
    const v = (state.verdict[name] = askPart(name, d, state, ask));
    if (v === "yes") Object.assign(state.fields, partFields(name, d));
    if (v === "no") state.bad.push(name);
    if (v === "wait") state.wait++;
    if (name === "proposal" && v !== "yes") break;
  }
  return state;
}

// One session: the verdicts of its parts and, when the proposal counts, the session built from the
// signed fields, the writer and the id.
function readSession(id, d, check) {
  const rel = SESSIONS + "/" + id;
  const ask = (name) => {
    const part = PARTS[name];
    return check(rel, d[part.by], d[part.sig], partFields(name, d), null);
  };
  const state = readParts(d, ask);
  const ok = Object.fromEntries(Object.entries(state.verdict).map(([k, v]) => [k, v === "yes"]));
  const ss = ok.proposal ? { ...state.fields, id, by: d.by, status: statusOf(ok) } : null;
  return { ...state, ss };
}

// The commits and the shares below the session `id`, signed as a whole by their seats.
function readBelow(out, { raw, id, check, onBad }) {
  for (const [kind, name] of [["commits", "solcommits"], ["shares", "solshares"]]) {
    const found = readDocs(SESSIONS + "/" + id + "/" + kind, raw[name]?.[id], check, onBad);
    out[kind][id] = found.docs;
    out.bad += found.bad;
    out.wait += found.wait;
  }
}

// One document of the collection: its session, with the commits and shares below it.
function addSession(out, [id, d], { raw, check, onBad, twin }) {
  const rel = SESSIONS + "/" + id;
  if (id in Object.prototype) {
    out.bad++;
    onBad(rel + " id");
    return;
  }
  const { ss, bad, wait } = readSession(id, Object(d), check);
  out.wait += wait;
  out.bad += bad.length;
  for (const part of bad) onBad(rel + " " + part);
  if (!ss) return;
  const twinned = !ENDED.has(ss.status) && twin(ss.by);
  if (twinned) Object.assign(ss, { status: "failed", error: TWIN_FEE });
  readBelow(out, { raw, id, check, onBad });
  out.sessions.push(ss);
}

// A document that makes the reader throw is a bad document, not a stop of every device.
function tryAdd(out, entry, how) {
  try {
    addSession(out, entry, how);
  } catch {
    out.bad++;
    how.onBad(SESSIONS + "/" + entry[0] + " unreadable");
  }
}

/**
 * The sessions of `raw` and, for each valid one, its commits and shares. `raw` has `solsessions`
 * ({ id: document }), `solcommits` and `solshares` ({ id: { seat: document } }). `check(rel, by,
 * sig, fields, need)` is checkIn of app-filter.js. A session or document that is not valid is left
 * out, and `onBad(what)` hears it. `twin(seat)` says that another seat shows the fee key of
 * `seat`: its open sessions end. A document with an id that is a name of Object.prototype is
 * left out. Returns { sessions (newest first), commits, shares, bad, wait }.
 */
export function filterSessions(raw, check, onBad, twin = () => false) {
  const out = { sessions: [], commits: {}, shares: {}, bad: 0, wait: 0 };
  const how = { raw, check, onBad, twin };
  for (const entry of Object.entries(raw[SESSIONS] ?? {})) tryAdd(out, entry, how);
  endSuperseded(out.sessions);
  endDuplicates(out.sessions);
  out.sessions.sort((a, b) => num(b.createdAt) - num(a.createdAt));
  return out;
}

/**
 * Signs the fields of part `name` as seat `seat` and writes them into the session `id`. The
 * proposal makes the document (`create`), every later part updates it. The fields are exactly the
 * ones of the part: any other would stay unsigned, so it is an error. `guard` runs after the
 * signature and throws when the wallet changed meanwhile: then nothing is written.
 */
export async function writePart(c, id, name, fields, { seat, create = false, guard = () => {} }) {
  const part = PARTS[name];
  const extra = Object.keys(fields).filter((k) => !part.fields.includes(k));
  if (extra.length) throw new Error(`Unsigned field in the ${name}: ` + extra.join(", "));
  const rel = SESSIONS + "/" + id;
  const { base } = c;
  const doc = await c.host.signedDoc(c.gid, rel, seat, partFields(name, fields));
  guard();
  const ref = c.host.sdb.doc(base + "/" + rel);
  const signed = { ...partFields(name, fields), [part.by]: doc.by, [part.sig]: doc.sig };
  await (create ? ref.set(signed) : ref.update(signed));
}

/** Signs the proposal as seat `seat` and writes it as the session `id`. */
export const writeProposal = (c, id, fields, seat, guard = () => {}) =>
  writePart(c, id, "proposal", fields, { seat, create: true, guard });

/** True when the session `ss` of an earlier read is still in `sessions` with the same proposal. */
export function sameProposal(sessions, ss) {
  const now = sessions.find((s) => s.id === ss.id);
  return !!now && now.by === ss.by && PROPOSAL.every((k) => now[k] === ss[k]);
}
