// The signing sessions of the plain wallet (ZOLANA.md 3.8). A session is one document,
// `solsessions/<id>`, whose proposal a seat signed; the commits of the approving seats sit below
// it. This is the plain twin of web/sol/sessions.js, which the plain controller does not import:
// the closure of control.js holds no pool code. The path and the signed fields are the same. Only
// the proposal part exists so far, and a session is built from its signed fields alone, so an
// unsigned field of the document never reaches it.
import { readDocs } from "../docs.js";
import { indexOfSend, isSendIntent, kindOfIntent } from "./intent.js";

export const SESSIONS = "solsessions";
export const ENDED = new Set(["sent", "failed"]);
/** The fields that the proposer signs, in the order of the signature. */
export const PROPOSAL = ["intent", "message", "feeSig", "createdAt"];

/** The id rule of the pool. A session with another id has commits that nobody can read. */
export const SESSION_ID = /^[\w-]{1,64}$/;
const HEX = /^([0-9a-f]{2})+$/;
const FEE_SIG = /^[0-9a-f]{128}$/;
const MAX_MESSAGE_HEX = 2 * 1232; // a transaction fits one packet
const SHARED = "Another proposal on the same nonce account came first. Propose it again.";
const TITLES = { "send-sol": "Send SOL", "send-token": "Send token" };
const num = (n) => (Number.isFinite(n) ? n : 0);

/** The signed fields of the proposal in `d`, in the order of the signature. */
export function proposalFields(d) {
  const out = {};
  for (const k of PROPOSAL) if (d[k] !== undefined) out[k] = d[k];
  return out;
}

// A text (not a number, a list or an absent field) that the pattern accepts.
const fits = (value, pattern) => typeof value === "string" && pattern.test(value);

/** True for a session that this app shows and signs: a send with well formed hex fields. */
export const showable = (ss) =>
  isSendIntent(ss?.intent) &&
  fits(ss.id, SESSION_ID) &&
  fits(ss.message, HEX) &&
  ss.message.length <= MAX_MESSAGE_HEX &&
  fits(ss.feeSig, FEE_SIG);

/** The title of a session from its tag. A recipient or an amount comes from the checker only. */
export const titleOf = (ss) => (showable(ss) ? TITLES[kindOfIntent(ss.intent)] : null);

// A seat can be a proposer on one nonce account at a time: two open proposals of a seat on one
// nonce value cannot both land. The first by (createdAt, id) keeps it, so that every device
// reaches the same verdict, and the others end with a reason.
const byAge = (a, b) => num(a.createdAt) - num(b.createdAt) || (a.id < b.id ? -1 : 1);
function endDuplicates(sessions) {
  const taken = new Set();
  for (const ss of [...sessions].sort(byAge)) {
    if (ENDED.has(ss.status) || !showable(ss)) continue;
    const account = ss.by + ss.intent.slice(2, 74); // the index k and the nonce value
    if (taken.has(account)) Object.assign(ss, { status: "failed", error: SHARED });
    else taken.add(account);
  }
}

/** The indexes k of the nonce accounts of `seat` that an open session holds. */
export const heldIndexes = (sessions, seat) =>
  new Set(
    sessions
      .filter((ss) => ss.by === seat && !ENDED.has(ss.status) && showable(ss))
      .map((ss) => indexOfSend(ss.intent)),
  );

// One session: the verdict of the page on its proposal ("yes", "no" or "wait") and, for "yes",
// the session built from the signed fields, the writer and the id.
function readSession(id, d, check) {
  const fields = proposalFields(d);
  const verdict = check(SESSIONS + "/" + id, d.by, d.sig, fields, null);
  const ss = { ...fields, id, by: d.by, status: "collecting" };
  return { verdict, ss: verdict === "yes" ? ss : null };
}

/**
 * The sessions of `raw` and, for each valid one, its commits and shares. `raw` has `solsessions`
 * ({ id: document }), `solcommits` and `solshares` ({ id: { seat: document } }). `check(rel, by,
 * sig, fields, need)` is checkIn of app-filter.js. A session or document that is not valid is left
 * out, and `onBad(what)` hears it. Returns { sessions (newest first), commits, shares, bad, wait }.
 */
export function filterSessions(raw, check, onBad) {
  const out = { sessions: [], commits: {}, shares: {}, bad: 0, wait: 0 };
  for (const [id, d] of Object.entries(raw[SESSIONS] ?? {})) {
    const rel = SESSIONS + "/" + id;
    const { verdict, ss } = readSession(id, Object(d), check);
    if (verdict === "wait") out.wait++;
    if (verdict === "no") {
      out.bad++;
      onBad(rel + " proposal");
    }
    if (!ss) continue;
    out.sessions.push(ss);
    for (const [kind, name] of [["commits", "solcommits"], ["shares", "solshares"]]) {
      const found = readDocs(rel + "/" + kind, raw[name]?.[id], check, onBad);
      out[kind][id] = found.docs;
      out.bad += found.bad;
      out.wait += found.wait;
    }
  }
  endDuplicates(out.sessions);
  out.sessions.sort((a, b) => num(b.createdAt) - num(a.createdAt));
  return out;
}

/**
 * Signs the proposal as seat `seat` and writes it as the session `id`. The fields are exactly the
 * ones of PROPOSAL: any other would stay unsigned, so it is an error. `guard` runs after the
 * signature and throws when the wallet changed meanwhile: then nothing is written.
 */
export async function writeProposal(c, id, fields, seat, guard = () => {}) {
  const extra = Object.keys(fields).filter((k) => !PROPOSAL.includes(k));
  if (extra.length) throw new Error("Unsigned field in the proposal: " + extra.join(", "));
  const rel = SESSIONS + "/" + id;
  const { base } = c;
  const signed = await c.host.signedDoc(c.gid, rel, seat, proposalFields(fields));
  guard();
  await c.host.sdb.doc(base + "/" + rel).set(signed);
}

/** True when the session `ss` of an earlier read is still in `sessions` with the same proposal. */
export function sameProposal(sessions, ss) {
  const now = sessions.find((s) => s.id === ss.id);
  return !!now && now.by === ss.by && PROPOSAL.every((k) => now[k] === ss[k]);
}
