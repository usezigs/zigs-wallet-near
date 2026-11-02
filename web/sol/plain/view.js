// The Solana tab of a plain wallet (ZOLANA.md 3.8, 4.1): the start card, the progress of the seats,
// the address with its balances, the fee addresses and the backup. It is the plain twin of the pool
// view, which it does not import. `data-sol` marks each value for the headless checks. The backup,
// the check of a saved file and the restore come from the page (`actions`): the backup module is
// not in the closure of the controller.
import { agreement, seatProgress, started, startBlock } from "../ceremony.js";
import { base58 } from "../docs.js";
import { feeMismatch, mismatchText, publishedFee } from "../fee.js";
import { holdsShare, solOf, stopOf } from "../secrets.js";
import { labelOf } from "../wallet.js";
import { privacyBadge } from "../../privacy-language.js";
import { BUSY, NOTHING_SIGNED, STEP_TEXT, TITLE_KEY, focusKey, resultText } from "./direct.js";
import { DECIMALS, amountText } from "./reads.js";
import { refusalRows, screenRows } from "./review.js";

const NETWORK = "Solana Mainnet";
const FACTS = "Real money, public on chain. Not audited. No sending yet: deposits stay here.";
const START_NOTE = "Helius sees your IP and wallet address. "
  + "Funding fee addresses links each device to this wallet.";
const ONLY_DEVICE_1 = "Device 1 adds Solana.";
const KEEP_OPEN = "Keep this page open until the setup ends.";
const DO_NOT_USE = "Do not use the Solana part of this wallet.";
const STOP_NEXT = "Zcash still works. To use Solana, create a new wallet.";
const RECEIVE_ONLY = "Only SOL and USDC. Other tokens can be lost.";
const FUNDS_STAY = "Funds sent to this address stay there.";
const EXPLORER = "https://explorer.solana.com/address/";
const EXPLORER_TX = "https://explorer.solana.com/tx/";
const EXPLORER_NOTE = "Helius and the explorer see your IP.";
const FEE_NOTE = "Fee addresses pay for setup now and for sending later.";
const BACKUP_SAVED = "saved";
const BACKUP_NONE = "not backed up. Back up before you deposit.";
const COPY_FAILED = "Copy failed. Select the text and copy it.";
const READING = "Reading…";
const NOT_READ = "Not read";
const NOT_ENABLED = "No USDC yet";
const COPIED_MS = 1500;
const SETUP_TITLE = "Set up sending";
const COST_NOTE = "Each step spends real SOL from a fee address.";
const MARKS = { createNonce: "create-nonce", enableUsdc: "enable-usdc" };
const SIGNS = (seat) => `Device ${seat} signs and pays.`;
// The checker shows fee and rent in lamports. The SOL form follows, so that the cost can be read.
const LAMPORT_ROWS = new Set(["fee", "rent"]);
// The rows that hold an address or a signature are set in the code face.
const CODE_ROWS = new Set(["recipient", "mint", "payer", "group"]);
const TITLES = {
  unavailable: "Solana is not available", "not started": "Add Solana", running: "Setting up Solana",
  ready: "Solana", stopped: "Solana stopped", differs: "Keys differ",
};
const UNITS = { sol: "SOL", usdc: "USDC" };
const GRID = "display:grid;gap:8px";

function statusOf(c, ag) {
  if (startBlock(c.host)) return "unavailable";
  if (stopOf(c)) return "stopped";
  if (!started(c.docs, labelOf(c))) return "not started";
  return { agree: "ready", differ: "differs", wait: "running" }[ag.state];
}

/** The state of the Solana part for the page: its status, the keys published and the seats. */
export function plainSetup(c) {
  const seats = c.host.seatIds();
  return {
    status: statusOf(c, agreement(c)),
    keys: seats.filter((i) => c.docs.soldone[i]).length,
    n: seats.length,
  };
}

// The row of an asset from the last read. A bad USDC account shows its error on the USDC row only.
function rowOf(r, asset) {
  const bad = asset === "usdc" ? r.usdcError : "";
  if (bad) return { state: "bad", text: bad };
  if (r.at === null) {
    return r.error ? { state: "failed", text: NOT_READ } : { state: "reading", text: READING };
  }
  if (r[asset] === null) return { state: "off", text: NOT_ENABLED };
  const amount = amountText(r[asset], DECIMALS[asset]);
  const state = r.error ? "stale" : "ready";
  return { state, amount, unit: UNITS[asset], text: amount + " " + UNITS[asset] };
}

/**
 * What the page shows of the last read: { at, error, rows: { sol, usdc }, fees }. A row is
 * { state, text } and, with an amount, { amount, unit } too. `fees` maps a seat to its SOL text.
 */
export function readTexts(c) {
  const r = c.balances;
  const fees = Object.entries(r.fees).map(([seat, n]) => [seat, amountText(n, DECIMALS.sol)]);
  return {
    at: r.at,
    error: r.error,
    rows: { sol: rowOf(r, "sol"), usdc: rowOf(r, "usdc") },
    fees: Object.fromEntries(fees),
  };
}

// A button that copies `text`, and a hidden status that screen readers read. The button says Copied
// for a moment. A failed copy says what to do instead. The name starts with the visible word.
function copyButton(c, text, what, mark) {
  const { el } = c.host;
  const status = el("span", { class: "sr-only", role: "status", "data-sol": mark + "-status" });
  const copy = async (ev) => {
    const button = ev.currentTarget;
    const say = (word, name, spoken) => {
      button.textContent = word;
      button.setAttribute("aria-label", name);
      status.textContent = spoken;
    };
    try {
      await navigator.clipboard.writeText(text);
      say("Copied", "Copied", "Copied");
    } catch {
      say("Select and copy", "Select and copy " + what, COPY_FAILED);
    }
    setTimeout(() => say("Copy", "Copy " + what, ""), COPIED_MS);
  };
  const attrs = { class: "btn sm", type: "button", "data-sol": mark, "aria-label": "Copy " + what };
  return [el("button", { ...attrs, onclick: copy }, "Copy"), status];
}

function head(c, status) {
  const { el } = c.host;
  return el(
    "div",
    { class: "card-head" },
    el("h3", {}, TITLES[status]),
    el("div", { class: "row-actions" }, el("span", { class: "badge plain" }, NETWORK),
      privacyBadge(el, "public")),
    el("span", { "data-sol": "status", hidden: true }, status),
  );
}

const facts = (c) => c.host.el("div", { class: "callout warn", "data-sol": "facts" }, FACTS);

function startCard(c, act, actions) {
  const { el, localSeats } = c.host;
  const add = el("button", { class: "btn primary", type: "button", "data-sol": "add",
    onclick: act(actions.add) }, "Add Solana");
  return [facts(c), el("p", { class: "small", "data-sol": "start-note" }, START_NOTE),
    localSeats().includes(1) ? add : el("p", { class: "small" }, ONLY_DEVICE_1)];
}

function progress(c) {
  const { el, seatIds } = c.host;
  return [el("ul", { class: "list" },
    seatIds().map((i) => el("li", { "data-sol": "seat-" + i }, seatProgress(c, i)))),
  el("p", { class: "small" }, KEEP_OPEN)];
}

// Funds that reached the address before the stop stay there: the address and the balances show,
// with no Copy and no text that invites a deposit.
function heldFunds(c, address) {
  const { el } = c.host;
  return [balances(c, readTexts(c)), el("div", { style: GRID }, ...addressLines(el, address),
    el("p", { class: "small", "data-sol": "funds-stay" }, FUNDS_STAY))];
}

function stoppedCard(c, ag) {
  const { el } = c.host;
  return [el("div", { class: "callout bad", role: "alert", "data-sol": "stopped" },
    stopOf(c), " ", STOP_NEXT),
  ...(ag.state === "agree" ? heldFunds(c, base58(ag.done.groupKey)) : []),
  el("div", {}, el("button", { class: "btn sm", type: "button", "data-sol": "new-wallet",
    onclick: c.host.newWallet }, "Create a new wallet"))];
}

function balances(c, read) {
  const { el } = c.host;
  const cell = (asset) => {
    const row = read.rows[asset];
    return el("div", { class: "sol-hero" },
      el("span", { class: "label" }, UNITS[asset]),
      el("span", { class: "sol-amount" + (row.amount ? "" : " muted"),
        "data-sol": "balance-" + asset }, row.text));
  };
  const grid = "display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px";
  return el("div", { style: grid }, cell("sol"), cell("usdc"),
    read.error ? el("p", { class: "small bad", role: "status", "data-sol": "read-error" },
      read.error) : null);
}

const addressLines = (el, address) => [el("span", { class: "label" }, "Solana mainnet address"),
  el("div", { class: "addr-full", "data-sol": "address" }, address)];

function receive(c, address) {
  const { el } = c.host;
  const link = el("a", { class: "btn sm", href: EXPLORER + address, target: "_blank",
    rel: "noopener noreferrer", "data-sol": "explorer" }, "Open in explorer",
  el("span", { class: "sr-only" }, " (opens in a new tab)"));
  return el("div", { style: GRID, role: "group", "aria-label": "Receive SOL and USDC",
    "data-key": "sol-receive", tabindex: "-1" }, ...addressLines(el, address),
  el("p", { class: "small" }, RECEIVE_ONLY),
  el("div", { class: "row-actions" }, copyButton(c, address, "the Solana address", "copy-address"),
    link),
  el("p", { class: "small muted" }, EXPLORER_NOTE));
}

// A published fee key that the key share of this browser does not give is not shown as an address:
// people would fund it with real money.
function feeRows(c, read, seats) {
  const { el } = c.host;
  return seats.flatMap((i) => {
    const address = base58(publishedFee(c, i));
    return [el("dt", {}, "Device " + i),
      el("dd", { class: "row-actions" },
        el("span", { class: "hex", "data-sol": "fee-address-" + i }, address),
        copyButton(c, address, "the fee address of device " + i, "copy-fee-" + i)),
      el("dd", { class: "small", "data-sol": "fee-balance-" + i },
        read.fees[i] ? read.fees[i] + " SOL" : READING)];
  });
}

function fees(c, read) {
  const { el, localSeats } = c.host;
  const seats = localSeats().filter((i) => publishedFee(c, i) !== undefined);
  const bad = seats.filter((i) => feeMismatch(c, i));
  const good = seats.filter((i) => !bad.includes(i));
  if (!seats.length) return null;
  return el("div", { style: GRID },
    ...bad.map((i) => el("p", { class: "small bad", role: "alert" }, mismatchText(i))),
    good.length ? el("details", {}, el("summary", {}, "Fee addresses"),
      el("p", { class: "small" }, FEE_NOTE), el("dl", { class: "kv" }, ...feeRows(c, read, good)))
      : null);
}

function backupRow(c, act, actions, i) {
  const { el } = c.host;
  const part = solOf(c.host, c.gid, i);
  const holds = holdsShare(part);
  const state = !holds ? "no key share in this browser"
    : part.backupSaved === true ? BACKUP_SAVED : BACKUP_NONE;
  const button = (mark, label, name, onclick) => el("button", { class: "btn sm", type: "button",
    "data-sol": mark + "-" + i, "aria-label": name, onclick }, label);
  return el("div", { class: "row-actions", "data-sol": "backup-state-" + i },
    el("span", { class: "small" }, "Device " + i + ": " + state),
    holds ? button("backup", "Back up", "Back up the Solana part of device " + i,
      act(() => actions.backup(i))) : null,
    holds && part.backupSaved === true ? button("check", "Check saved file",
      "Check saved file, device " + i, () => actions.check(i)) : null);
}

function backup(c, act, actions) {
  const { el, localSeats } = c.host;
  const input = el("input", { id: "sol-restore", type: "file", hidden: true,
    accept: ".zigsbackup,.json,application/json",
    onchange: (ev) => {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (file) actions.restoreFile(file);
    } });
  return el("div", { style: GRID }, el("h4", {}, "Backup"),
    ...localSeats().map((i) => backupRow(c, act, actions, i)),
    el("div", { class: "row-actions" }, el("button", { class: "btn sm", type: "button",
      "data-sol": "restore", "aria-label": "Restore a backup of the Solana part",
      onclick: () => input.click() }, "Restore a backup"), input));
}

const shortId = (id) => id.slice(0, 8) + "…" + id.slice(-6);

// Create nonce, and Enable USDC while the last read shows no USDC account: it comes from the
// balance read and from nothing else. A step that runs disables both.
function stepButtons(c, actions, busy) {
  const { el } = c.host;
  const usdcOff = readTexts(c).rows.usdc.state === "off";
  const button = (step) => el("button", { class: "btn", type: "button", disabled: busy,
    "data-sol": MARKS[step], "data-key": focusKey(step), onclick: () => actions[step]() },
  STEP_TEXT[step]);
  return el("div", { class: "row-actions" }, button("createNonce"),
    usdcOff ? button("enableUsdc") : null);
}

// The screen of a step: a heading that takes the focus when the screen opens, then its parts.
// Escape cancels it; closeDirect ignores a step that reads or sends.
function screen(c, actions, state, ...parts) {
  const { el } = c.host;
  const onkeydown = (ev) => ev.key === "Escape" && actions.cancel();
  return el("div", { style: GRID, role: "group", "aria-labelledby": "sol-direct-title",
    "data-sol": "direct-" + state.step, onkeydown },
  el("h4", { id: "sol-direct-title", tabindex: "-1", "data-key": TITLE_KEY,
    "data-sol": "direct-title" }, STEP_TEXT[state.kind]), ...parts);
}

// The words of a step reach screen readers through host.announce (direct.js), so no node here
// carries a live role: the page rebuilds the nodes on every redraw and would say them again.
const note = (c, mark, text) => c.host.el("p", { class: "small", "data-sol": mark }, text);

const valueOf = ({ name, value }) => LAMPORT_ROWS.has(name) && /^\d+$/.test(value)
  ? `${value} (${amountText(value, DECIMALS.sol)} SOL)` : value;

// The lines of the checker first, then Confirm and Cancel. Both wait while the step sends.
function reviewScreen(c, actions, state) {
  const { el } = c.host;
  const sending = state.step === "sending";
  const rows = screenRows(state.review).flatMap((row) => [el("dt", {}, row.label),
    el("dd", { class: CODE_ROWS.has(row.name) ? "hex" : null, "data-sol": "row-" + row.name },
      valueOf(row))]);
  const button = (mark, cls, text, onclick) => el("button", { class: "btn " + cls, type: "button",
    disabled: sending, "data-sol": mark, "data-key": "sol-direct-" + mark, onclick }, text);
  return screen(c, actions, state, el("dl", { class: "kv", "data-sol": "direct-rows" }, ...rows),
    note(c, "direct-signs", SIGNS(state.seat)),
    sending ? note(c, "direct-busy", BUSY.sending) : null,
    el("div", { class: "row-actions" },
      button("confirm", "primary", "Confirm", () => actions.confirm()),
      button("cancel", "", "Cancel", () => actions.cancel())));
}

// A refusal shows one row for each rule of the checker, an error its text. Nothing was signed.
function stoppedScreen(c, actions, state) {
  const { el } = c.host;
  const { review } = state;
  const alert = (mark, text) => el("p", { class: "callout bad", "data-sol": mark }, text);
  const rules = refusalRows(review).map((rule) => el("li", { "data-sol": "rule-" + rule.id },
    el("strong", {}, rule.statement), " ", el("span", { class: "small" }, rule.detail)));
  return screen(c, actions, state, state.note ? alert("direct-poor", state.note) : null,
    review.kind === "refused" ? el("ul", { class: "list", "data-sol": "direct-rules" }, rules)
      : alert("direct-error", review.text),
    note(c, "direct-nothing", NOTHING_SIGNED),
    el("div", { class: "row-actions" }, el("button", { class: "btn", type: "button",
      "data-sol": "cancel", "data-key": "sol-direct-cancel", onclick: () => actions.cancel() },
    "Close")));
}

// The result of a step: its words, the short form of its signature and the explorer link.
function resultLine(c, state) {
  const { el } = c.host;
  const { txId } = state.result;
  const link = el("a", { class: "btn sm", href: EXPLORER_TX + txId, rel: "noopener noreferrer",
    "data-sol": "direct-explorer", target: "_blank" }, "Open in explorer",
  el("span", { class: "sr-only" }, " (the transaction, opens in a new tab)"));
  return el("div", { style: GRID, "data-sol": "direct-result" },
    el("p", { class: "small" }, resultText(state), " ",
      el("span", { class: "hex", "data-sol": "direct-signature" }, shortId(txId))),
    el("div", { class: "row-actions" }, link));
}

const STEP_BODY = {
  idle: (c, actions) => [stepButtons(c, actions, false)],
  reading: (c, actions) => [note(c, "direct-busy", BUSY.reading), stepButtons(c, actions, true)],
  review: (c, actions, state) => [reviewScreen(c, actions, state)],
  sending: (c, actions, state) => [reviewScreen(c, actions, state)],
  stopped: (c, actions, state) => [stoppedScreen(c, actions, state)],
  done: (c, actions, state) => [resultLine(c, state), stepButtons(c, actions, false)],
  failed: (c, actions, state) => [c.host.el("p", { class: "callout bad",
    "data-sol": "direct-failed" }, state.text), stepButtons(c, actions, false)],
};
const SCREENS = new Set(["review", "sending", "stopped"]);

// The two steps that one device takes alone with its fee key (direct.js).
function sendSetup(c, actions) {
  const { el, localSeats } = c.host;
  const state = c.direct;
  if (!localSeats().length) return null;
  const body = STEP_BODY[state?.step ?? "idle"](c, actions, state);
  return el("div", { style: GRID, "data-sol": "send-setup" },
    SCREENS.has(state?.step) ? null : el("h4", {}, SETUP_TITLE),
    SCREENS.has(state?.step) ? null : note(c, "direct-cost", COST_NOTE), ...body);
}

function ready(c, act, actions, done) {
  const read = readTexts(c);
  return [facts(c), balances(c, read), receive(c, base58(done.groupKey)), sendSetup(c, actions),
    fees(c, read), backup(c, act, actions)];
}

/**
 * The tab. `actions` has backup(seat), check(seat) and restoreFile(file) from the page, and add
 * from the controller. `act` wraps a button action (act of app-dom.js).
 */
export function plainView(c, act, actions) {
  const { el } = c.host;
  const ag = agreement(c);
  const status = statusOf(c, ag);
  const body = {
    unavailable: () => [el("p", { class: "small" }, startBlock(c.host))],
    "not started": () => startCard(c, act, actions),
    running: () => progress(c),
    stopped: () => stoppedCard(c, ag),
    differs: () => [el("div", { class: "callout bad", role: "alert" }, ag.why, " ", DO_NOT_USE)],
    ready: () => ready(c, act, actions, ag.done),
  }[status]();
  return el("section", { class: "card card-pad sol-view" }, head(c, status), ...body);
}
