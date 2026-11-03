// The send form, the list of sends and the review of a proposal in the Solana tab of a plain wallet
// (ZOLANA.md 3.8, 3.9). A row shows its title, its proposer and a status chip, and no amount and
// no recipient: those come from the checker in the review, which a person opens with Review and
// closes with Approve or Close. The words of a change reach screen readers through host.announce
// (sends.js), so no node here carries a live role: the page rebuilds the nodes on every redraw.
import { BUSY } from "./direct.js";
import { refusalPart, rowList, txLink } from "./rowsview.js";
import { sameProposal } from "./sessions.js";
import {
  LOOK_TITLE, NOTHING_PROPOSED, PROPOSALS_KEY, formError, offered, reviewKey, rowsOf,
} from "./sends.js";

const GRID = "display:grid;gap:8px";
const NAMES = { sol: "SOL", usdc: "USDC" };
const TO_KEY = "sol-plain-to";
const AMOUNT_KEY = "sol-plain-amount";
const SEND_KEY = "sol-send";
const UNSURE = "Not confirmed yet. Zigs looks again.";
const approves = (seat) => `Device ${seat} approves.`;

// The note under a field that has an error, and the attributes that tie the field to it.
const flagged = (c, field, id) => (c.form.error?.field === field
  ? { "aria-describedby": id, "aria-invalid": "true" } : {});
const fieldError = (c, field, id) => {
  const error = c.form.error;
  return error?.field === field
    ? c.host.el("p", { class: "small bad", id, "data-sol": "error-" + field }, error.text) : null;
};

// What a proposal that Zigs stopped says: the refusal of the checker with its rules, else the text.
function failure(c) {
  const { el } = c.host;
  const error = c.form.error;
  if (!error || error.field) return null;
  return el("div", { style: GRID, "data-sol": "send-failed" },
    error.review?.kind === "refused" ? refusalPart(c, error.review, "send")
      : el("p", { class: "callout bad", "data-sol": "send-error" }, error.text),
    el("p", { class: "small" }, NOTHING_PROPOSED));
}

function assetChoice(c, actions, asset) {
  const { el } = c.host;
  const assets = [...new Set([...offered(c), asset])];
  if (assets.length < 2) return null;
  const button = (id) => el("button", { class: "btn sm" + (id === asset ? " primary" : ""),
    type: "button", "aria-pressed": String(id === asset), "data-sol": "asset-" + id,
    onclick: () => actions.pick(id) }, NAMES[id]);
  return el("div", { class: "row-actions", role: "group", "aria-label": "Asset" },
    ...assets.map(button));
}

// Only a key of the person clears the error: restoreFormState sends an input event of its own to
// every field after each redraw, and that must not remove the text of a refusal.
function input(c, key, attrs) {
  return c.host.el("input", { class: "input mono", id: key, "data-key": key, autocomplete: "off",
    spellcheck: "false", value: "", ...attrs,
    oninput: (ev) => { if (ev.isTrusted) c.form.error = null; } });
}

/** The form of a send: the asset, the Solana address of the recipient, the amount and Propose. */
export function sendForm(c, act, actions) {
  const { el } = c.host;
  const asset = c.form.asset;
  const to = input(c, TO_KEY, flagged(c, "recipient", "sol-plain-to-error"));
  // The focus goes to the amount for an error of the asset too, so the amount names that note.
  const amount = input(c, AMOUNT_KEY, { inputmode: "decimal",
    ...flagged(c, "asset", "sol-plain-asset-error"),
    ...flagged(c, "amount", "sol-plain-amount-error") });
  const propose = async () => {
    const typed = { asset, recipient: to.value, amount: amount.value };
    const bad = formError(c, typed);
    c.form.error = bad;
    if (bad) {
      (bad.field === "recipient" ? to : amount).focus?.();
      return;
    }
    await actions.propose(typed);
    if (c.form.error) return;
    // A redraw during the wait replaced these nodes, so the fields are found again by id.
    for (const id of [TO_KEY, AMOUNT_KEY]) {
      const field = document.getElementById(id);
      if (field) field.value = "";
    }
  };
  return el("div", { style: GRID, role: "group", "aria-labelledby": "sol-send-title",
    "data-sol": "send-form", "data-key": SEND_KEY, tabindex: "-1" },
  el("h4", { id: "sol-send-title" }, "Send"),
  assetChoice(c, actions, asset),
  el("label", { class: "field" }, el("span", {}, "To (Solana address)"), to),
  fieldError(c, "recipient", "sol-plain-to-error"),
  c.host.recipientSelect?.({ asset: NAMES[asset], network: "mainnet", type: "public",
    id: "sol-plain-saved", onSelect: (address) => {
      to.value = address;
      c.form.error = null;
      to.focus?.();
    } }),
  el("label", { class: "field" }, el("span", {}, `Amount (${NAMES[asset]})`), amount),
  fieldError(c, "amount", "sol-plain-amount-error"),
  fieldError(c, "asset", "sol-plain-asset-error"),
  failure(c),
  el("div", { class: "row-actions" }, el("button", { class: "btn primary", type: "button",
    "data-sol": "propose", onclick: act(propose) }, "Propose send")));
}

// ── The review of one proposal ──

// The review that is open for this row and one of its seats, or null. A review of a proposal that
// the page does not hold any more is not shown: the person reviews again.
const lookFor = (c, row) => (c.look?.id === row.id && row.seats.includes(c.look.seat)
  && c.look.ss && sameProposal(c.sessions, c.look.ss) ? c.look : null);

// The sentences of the swap check of a swap deposit (approve.js): a block apart from the rows of
// the checker, which stay as the checker wrote them.
function swapPart(c, lines) {
  const { el } = c.host;
  if (!lines?.length) return null;
  return el("div", { class: "callout", "data-sol": "look-swap" }, el("strong", {}, "Swap deposit"),
    ...lines.map((line) => el("p", { class: "small" }, line)));
}

function lookBody(c, actions, look) {
  const { el } = c.host;
  const close = el("button", { class: "btn", type: "button", "data-sol": "look-close",
    onclick: () => actions.close() }, "Close");
  if (look.step === "reading") return [el("p", { class: "small", "data-sol": "look-busy" },
    BUSY.reading)];
  if (look.step === "shown") {
    return [swapPart(c, look.result.swap), rowList(c, look.result.rows, "look-rows"),
      el("p", { class: "small", "data-sol": "look-signs" }, approves(look.seat)),
      look.note ? el("p", { class: "callout bad", "data-sol": "look-note" }, look.note) : null,
      el("div", { class: "row-actions" }, el("button", { class: "btn primary", type: "button",
        "data-sol": "approve", "aria-label": `Approve as device ${look.seat}`,
        onclick: () => actions.approve(look.id, look.seat) }, "Approve"), close)];
  }
  const refused = look.review?.kind === "refused";
  return [...(refused ? refusalPart(c, look.review, "look")
    : [el("p", { class: "callout bad", "data-sol": "look-error" }, look.text)]),
  el("div", { class: "row-actions" }, close)];
}

function lookScreen(c, actions, look) {
  const { el } = c.host;
  return el("div", { style: GRID, role: "group", "aria-labelledby": "sol-look-title",
    "data-sol": "look-" + look.step, onkeydown: (ev) => ev.key === "Escape" && actions.close() },
  el("h4", { id: "sol-look-title", tabindex: "-1", "data-key": LOOK_TITLE }, "Review"),
  ...lookBody(c, actions, look));
}

// ── The rows ──

function reviewButtons(c, actions, row) {
  const { el } = c.host;
  return row.seats.map((seat) => {
    const label = row.seats.length > 1 ? `Review as device ${seat}` : "Review";
    return el("button", { class: "btn sm", type: "button", "data-sol": "review-" + row.id,
      "data-key": reviewKey(row.id, seat), "aria-label": `${label}: ${row.title}`,
      onclick: () => actions.review(row.id, seat) }, label);
  });
}

function rowView(c, actions, row) {
  const { el } = c.host;
  const look = lookFor(c, row);
  const link = row.txId && ["sent", "chain", "unconfirmed"].includes(row.state)
    ? txLink(c, row.txId, "tx-" + row.id) : null;
  return el("li", { "data-sol": "proposal-" + row.id },
    el("div", { class: "row-actions" }, el("strong", {}, row.title),
      el("span", { class: "small" }, "Device " + row.by),
      el("span", { class: "badge " + row.tone, "data-sol": "state-" + row.id }, row.word)),
    row.error ? el("p", { class: "small", "data-sol": "error-" + row.id }, row.error) : null,
    row.state === "unconfirmed" ? el("p", { class: "small", "data-sol": "unsure-" + row.id },
      UNSURE) : null,
    el("div", { class: "row-actions" }, ...(look ? [] : reviewButtons(c, actions, row)), link),
    look ? lookScreen(c, actions, look) : null);
}

/** The sends: the open ones first, the ended ones in a closed details element. Null when none. */
export function sendList(c, actions) {
  const { el } = c.host;
  const rows = rowsOf(c);
  if (!rows.length) return null;
  const open = rows.filter((row) => !row.ended);
  const ended = rows.filter((row) => row.ended);
  const list = (some) => el("ul", { class: "list" },
    ...some.map((row) => rowView(c, actions, row)));
  return el("div", { style: GRID, "data-sol": "proposals" },
    el("h4", { id: PROPOSALS_KEY, tabindex: "-1", "data-key": PROPOSALS_KEY }, "Sends"),
    open.length ? list(open) : null,
    ended.length ? el("details", {}, el("summary", {}, `Finished (${ended.length})`),
      list(ended)) : null);
}
