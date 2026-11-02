// The one-device steps of the plain wallet (ZOLANA.md 3.8, 3.10): Create nonce (S1) and Enable
// USDC (S4). Both have one signature, the fee key of a device, and they spend only the SOL of that
// fee address, so the device acts alone: no session and no group signature. The order is fixed.
// Read the chain, compile, run the checker and show its lines. Only after the person confirms: sign
// the exact message that the checker accepted, simulate it, send the bytes that passed, and wait
// for the id of that signature. The state is c.direct, which the view draws and teardown drops.
// The secret of the fee key lives for the length of one call of the wasm and is never stored.
import { agreement, startBlock } from "../ceremony.js";
import { COLLECTIONS, base58, keyOfBase58 } from "../docs.js";
import { feeProblem, readyFee } from "../fee.js";
import { holdsShare, solOf, stopOf } from "../secrets.js";
import { readChain } from "./chain.js";
import { toBase64 } from "./guard.js";
import { bytesOfHex, createNonceIntent, enableTokenIntent, join, plainPins } from "./intent.js";
import { USDC } from "./reads.js";
import { INCOMPLETE, canApprove, reviewText } from "./review.js";
import { SESSIONS } from "./sessions.js";

export const TITLE_KEY = "sol-direct-title";
/** The key that gives the focus back to the button of a kind (data-key). */
export const focusKey = (kind) => "sol-direct-" + kind;
/** The name of each step. */
export const STEP_TEXT = { createNonce: "Create nonce", enableUsdc: "Enable USDC" };
export const BUSY = { reading: "Reading the chain…", sending: "Signing and sending…" };
export const NOTHING_SIGNED = "Nothing was signed.";
const RESULT = {
  confirmed: "Confirmed", finalized: "Confirmed", failed: "Failed on chain",
  unknown: "Sent, not confirmed yet",
};

const BLANK = "00".repeat(32); // the address of a nonce account does not depend on the blockhash
// ponytail: a device looks at its first 100 nonce accounts (the most that one accounts call takes).
// The upgrade path is a second call that starts at 100.
export const NONCE_WINDOW = 100;
const NO_SOL = /AccountNotFound|InsufficientFunds|insufficient lamports/i;
const LOADING = "Zigs has not loaded the Solana data of this wallet yet. Try again in a moment.";
const CHECKING = "Zigs is still checking the Solana data of this wallet. Try again in a moment.";
const NOT_AGREED = "The devices have not agreed on one Solana key yet.";
const NO_DEVICE = "This browser holds no device that can sign for Solana.";
const NONCE_FULL = "This device has no free nonce account among its first 100.";
const NO_NONCE = "The wasm named no nonce account for this wallet.";
export const BAD_ANSWER = "The Worker answered with data that Zigs cannot use.";
const UNSEEN = { status: "unknown", slot: "" };
const SIMULATED = "The network refused this in a test run: ";
const TOO_OLD = "This review is too old. Nothing was sent. Start again.";

const textOf = (e) => String(e?.message ?? e);

/** The text for a fee address that cannot pay. Mainnet has no faucet, so it names none. */
const poorText = (seat) =>
  `Device ${seat} has too little SOL at its fee address, and mainnet has no faucet.`;

// Why no step may run now, or null: the wallet stopped, its documents (also its sessions) are not
// read or checked, or the devices do not agree on one key. It reads the documents again first.
export function block(c) {
  c.refresh();
  const stop = stopOf(c) || startBlock(c.host);
  if (stop) return stop;
  if (![...COLLECTIONS, SESSIONS].every((name) => c.loaded[name])) return LOADING;
  if (c.wait > 0 || c.sessWait > 0) return CHECKING;
  return agreement(c).state === "agree" ? null : NOT_AGREED;
}

const TRANSIENT = [LOADING, CHECKING];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * `block`, after a short wait while the only reason is that a document of the wallet is still
 * loaded or checked (a signature check takes a moment). A real reason comes at once.
 */
export async function settledBlock(c, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const why = block(c);
    if (!TRANSIENT.includes(why) || Date.now() > end) return why;
    await sleep(50);
  }
}

const CLOSED = "The wallet closed during this step. Nothing was published.";

/**
 * The guard after an await: throws when the wallet closed since `opened` or a stop came. A
 * document that is only being checked again does not stop the step.
 */
export function stillOpen(c, opened) {
  const why = c.opened === opened ? block(c) : CLOSED;
  if (why && !TRANSIENT.includes(why)) throw new Error(why);
}

// The first device of this browser that holds a key share and a fee key that its document shows.
export function payerSeat(c) {
  const { localSeats, canWriteAs } = c.host;
  const seats = localSeats().filter((i) => canWriteAs(i) && holdsShare(solOf(c.host, c.gid, i)));
  const seat = seats.find((i) => feeProblem(c, i) === null);
  if (seat !== undefined) return seat;
  throw new Error(seats.length ? feeProblem(c, seats[0]) : NO_DEVICE);
}

// The address (base58) of nonce account k of the payer, as the wasm derives it.
export function nonceAddress(W, k, pins) {
  const rows = W.plain_reads(createNonceIntent(k, BLANK), pins).split("\n");
  const nonce = rows.map((row) => row.split("\t")).find(([role]) => role === "nonce");
  if (!nonce?.[2]) throw new Error(NO_NONCE);
  return nonce[2];
}

// The first index whose nonce account is missing, from one read of the first NONCE_WINDOW.
async function freeNonce({ W }, worker, pins) {
  const addresses = Array.from({ length: NONCE_WINDOW }, (_, k) => nonceAddress(W, k, pins));
  const { accounts } = await worker.call("accounts", { addresses });
  if (!Array.isArray(accounts) || accounts.length !== addresses.length) {
    throw new Error(BAD_ANSWER);
  }
  const k = accounts.findIndex((account) => account === null);
  if (k < 0) throw new Error(NONCE_FULL);
  return k;
}

// The intent of a kind with a fresh blockhash. S1 takes the first free nonce index, S4 the token 0.
async function intentOf(c, worker, kind, pins) {
  const index = kind === "createNonce" ? await freeNonce(c, worker, pins) : 0;
  const { blockhash } = await worker.call("blockhash");
  const hash = keyOfBase58(blockhash);
  if (hash === null) throw new Error(BAD_ANSWER);
  return kind === "createNonce" ? createNonceIntent(index, hash) : enableTokenIntent(USDC, hash);
}

// What the person sees of a review that cannot be approved: the checker's answer, and a sentence
// when the fee address is short of SOL.
function stopped(review, seat) {
  const poor = review.kind === "refused" && review.rules.some((r) => r.id === "plain-rent-payer");
  const shown = review.kind === "accepted" ? { kind: "error", text: INCOMPLETE } : review;
  return { step: "stopped", review: shown, note: poor ? poorText(seat) : "" };
}

async function examine(c, worker, kind, seat) {
  const { key: payer } = readyFee(c, seat); // the secret of the fee key is not kept
  const pins = plainPins(c.wallet, agreement(c).done.groupKey, payer);
  const intent = await intentOf(c, worker, kind, pins);
  const message = c.W.plain_compile_message(intent, pins);
  const chain = await readChain(c, worker, intent, pins);
  const review = reviewText(c, message, intent, pins, chain);
  const run = { message, intent, pins, chain };
  return canApprove(review) ? { step: "review", review, run } : stopped(review, seat);
}

/** The words of a finished step, as people read them: "Create nonce: Confirmed, device 1." */
export const resultText = ({ kind, result, seat }) =>
  `${STEP_TEXT[kind]}: ${RESULT[result.status] ?? RESULT.unknown}, device ${seat}.`;

const SPOKEN = {
  reading: () => BUSY.reading,
  sending: () => BUSY.sending,
  stopped: (s) => [s.note, s.review.kind === "error" ? s.review.text : "", NOTHING_SIGNED]
    .filter(Boolean).join(" "),
  done: resultText,
  failed: (s) => s.text,
};

// What a screen reader hears when the step changes. The page rebuilds its nodes on every redraw,
// so the words go to one live region that stays (host.announce) and the nodes carry no role.
// A review is silent: the focus goes to its heading.
const announce = (c, state) => {
  const words = SPOKEN[state.step]?.(state);
  if (words) c.host.announce(words);
};

function finish(c, state, change, key) {
  if (c.direct !== state) return;
  Object.assign(state, change);
  announce(c, state);
  c.host.focusAfter(key, true);
  c.host.render();
}

/**
 * Starts a step for `kind` ("createNonce" or "enableUsdc"): reads the chain and checks the message
 * with the first ready device of this browser. It signs and sends nothing. `ensure` gives the
 * plain Worker. The result is in c.direct: step "review" (the person can confirm), "stopped" (the
 * checker refused or failed) or "failed" (this step could not read).
 */
export async function startDirect(c, kind, ensure) {
  const state = { kind, step: "reading" };
  c.direct = state;
  announce(c, state);
  c.host.render();
  let change;
  try {
    const why = block(c);
    if (why) throw new Error(why);
    const seat = payerSeat(c);
    change = { seat, ...(await examine(c, await ensure(), kind, seat)) };
  } catch (e) {
    change = { step: "failed", text: textOf(e) };
  }
  finish(c, state, change, change.step === "failed" ? focusKey(kind) : TITLE_KEY);
}

// The text for a test run that failed: what the network said, and the fee sentence if it fits.
// The blockhash of a review that stayed open for about a minute is gone: the person starts again.
function simulateText(run, seat) {
  if (/BlockhashNotFound/.test(run.err)) return TOO_OLD;
  const logs = (Array.isArray(run.logs) ? run.logs : []).join(" | ").slice(0, 300);
  const said = [SIMULATED + run.err, logs].filter(Boolean).join(" ");
  return NO_SOL.test(`${run.err} ${logs}`) ? `${poorText(seat)} ${said}` : said;
}

// The signature (hex) of the fee key on the exact message that the checker accepted. The wasm
// runs the checker again and signs only if this key is the payer. No text leaves with the secret.
export function sign(c, seat, { message, intent, pins, chain }) {
  const { secret } = readyFee(c, seat);
  try {
    return c.W.sol_plain_fee_sign(message, intent, pins, chain, JSON.stringify({ secret }));
  } catch (e) {
    throw new Error(textOf(e).split(secret).join("[hidden]"));
  }
}

// Signs, simulates, sends the bytes that passed, and waits for the id. Returns the result.
async function send(c, state, ensure) {
  const why = block(c);
  if (why) throw new Error(why);
  const { seat, run } = state;
  const signature = sign(c, seat, run);
  const tx = toBase64(join(run.message, bytesOfHex(signature)));
  const worker = await ensure();
  const test = await worker.call("simulate", { tx });
  if (test.err !== null) throw new Error(simulateText(test, seat));
  const stop = block(c); // a closed wallet or a stop that came meanwhile sends nothing
  if (stop) throw new Error(stop);
  await worker.call("send", { tx });
  const txId = base58(signature);
  // The bytes are sent now. A wait that fails is not a failed send: the id is all that is known.
  const seen = await worker.call("confirm", { signature: txId }).catch(() => UNSEEN);
  return { status: seen.status, slot: seen.slot, txId };
}

/**
 * Confirms the review in c.direct: signs, simulates, sends and waits. It does nothing unless the
 * step is "review". A wait that ends with no answer is status "unknown": nothing is sent again.
 */
export async function confirmDirect(c, ensure) {
  const state = c.direct;
  if (state?.step !== "review") return;
  state.step = "sending";
  announce(c, state);
  c.host.render();
  let change;
  try {
    change = { step: "done", result: await send(c, state, ensure) };
  } catch (e) {
    change = { step: "failed", text: textOf(e) };
  }
  if (c.direct !== state) return; // the wallet closed meanwhile
  c.balances.next = 0; // the next read of the balances shows what changed
  finish(c, state, change, focusKey(state.kind));
  c.host.refilter();
}

/** Closes the review, or the result of the last step, and gives the focus back to its button. */
export function closeDirect(c) {
  const state = c.direct;
  if (!state || state.step === "reading" || state.step === "sending") return;
  c.direct = null;
  c.host.focusAfter(focusKey(state.kind), true);
  c.host.render();
}
