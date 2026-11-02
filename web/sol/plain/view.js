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
import { DECIMALS, amountText } from "./reads.js";

const NETWORK = "Solana Mainnet";
const FACTS = "Real money, public on chain. Not audited. Sending comes later.";
const START_NOTE = "Helius sees your IP and wallet address. "
  + "Funding fee addresses links each device to this wallet.";
const ONLY_DEVICE_1 = "Device 1 adds Solana.";
const KEEP_OPEN = "Keep this page open until the setup ends.";
const DO_NOT_USE = "Do not use the Solana part of this wallet.";
const STOP_NEXT = "Zcash still works. To use Solana, create a new wallet.";
const RECEIVE_ONLY = "Only SOL and USDC. Other tokens can be lost.";
const FUNDS_STAY = "Funds sent to this address stay there.";
const EXPLORER = "https://explorer.solana.com/address/";
const EXPLORER_NOTE = "The explorer sees your IP address.";
const FEE_NOTE = "Fee addresses are needed when sending starts.";
const BACKUP_SAVED = "saved";
const BACKUP_NONE = "not backed up";
const COPY_FAILED = "Copy failed. Select the text and copy it.";
const READING = "Reading…";
const NOT_READ = "Not read";
const NOT_ENABLED = "No USDC yet";
const COPIED_MS = 1500;
const TITLES = {
  unavailable: "Solana is not available", "not started": "Add Solana", running: "Setting up Solana",
  ready: "Receive", stopped: "Solana stopped", differs: "Keys differ",
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

function ready(c, act, actions, done) {
  const read = readTexts(c);
  return [facts(c), balances(c, read), receive(c, base58(done.groupKey)), fees(c, read),
    backup(c, act, actions)];
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
