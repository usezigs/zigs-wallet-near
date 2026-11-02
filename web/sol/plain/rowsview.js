// The parts of the plain tab that show the lines of the checker (review.js) and a transaction: the
// list of rows of an accepted answer, the refusal with its rules, and the explorer link. Both the
// steps of one device (view.js) and the reviews of a proposal (sendview.js) draw them.
import { DECIMALS, amountText } from "./reads.js";
import { refusalRows } from "./review.js";

export const EXPLORER_TX = "https://explorer.solana.com/tx/";
const REFUSED = "The checker refused this.";
const COST = "Cost (fee + rent)";
// The checker shows fee and rent in lamports. The SOL form follows, so that the cost can be read.
const LAMPORT_ROWS = new Set(["fee", "rent"]);
// The rows that hold an address or a signature are set in the code face.
const CODE_ROWS = new Set(["recipient", "mint", "payer", "group"]);
// The value of the Action row, in words. Another value shows as the checker wrote it.
export const ACTION_WORDS = {
  "create-nonce": "Create nonce account",
  "enable-token": "Enable USDC",
  "send-sol": "Send SOL",
  "send-token": "Send token",
  cancel: "Cancel a proposal",
};
const whole = (value) => typeof value === "string" && /^\d+$/.test(value);

/**
 * The rows with a cost row after the rent row: fee plus rent, in SOL. It is there only when both
 * lines are whole numbers. The checker shows the lines, and this sum comes from two of them.
 */
export function withCost(rows) {
  const line = (name) => rows.find((row) => row.name === name)?.value;
  if (!whole(line("fee")) || !whole(line("rent"))) return rows;
  const total = BigInt(line("fee")) + BigInt(line("rent"));
  const at = rows.findIndex((row) => row.name === "rent") + 1;
  const value = `${amountText(total, DECIMALS.sol)} SOL`;
  return [...rows.slice(0, at), { name: "cost", label: COST, value }, ...rows.slice(at)];
}

/** The text of a row: the Action in words, a fee or rent in lamports and SOL, else as written. */
export function valueOf({ name, value }) {
  if (name === "intent") return ACTION_WORDS[value] ?? value;
  return LAMPORT_ROWS.has(name) && whole(value)
    ? `${value} (${amountText(value, DECIMALS.sol)} SOL)` : value;
}

/** The list of the rows of an accepted answer. `mark` is its data-sol. */
export function rowList(c, rows, mark) {
  const { el } = c.host;
  const lines = withCost(rows).flatMap((row) => [el("dt", {}, row.label),
    el("dd", { class: CODE_ROWS.has(row.name) ? "hex" : null, "data-sol": "row-" + row.name },
      valueOf(row))]);
  return el("dl", { class: "kv", "data-sol": mark }, ...lines);
}

/**
 * A refusal: one line first, then the rule of each broken line of the checker in a closed details
 * element. `mark` is the start of the data-sol names.
 */
export function refusalPart(c, review, mark) {
  const { el } = c.host;
  const rules = refusalRows(review).map((rule) => el("li", { "data-sol": "rule-" + rule.id },
    el("strong", {}, rule.statement), " ", el("span", { class: "small" }, rule.detail)));
  return [el("p", { class: "callout bad", "data-sol": mark + "-refused" }, REFUSED),
    el("details", { "data-sol": mark + "-why" }, el("summary", {}, `Reasons (${rules.length})`),
      el("ul", { class: "list", "data-sol": mark + "-rules" }, ...rules))];
}

/** The link that opens a transaction in the explorer, in a new tab. No cluster parameter. */
export function txLink(c, txId, mark, key = null) {
  const { el } = c.host;
  return el("a", { class: "btn sm", href: EXPLORER_TX + txId, rel: "noopener noreferrer",
    "data-sol": mark, "data-key": key, target: "_blank" }, "Open in explorer",
  el("span", { class: "sr-only" }, " (the transaction, opens in a new tab)"));
}
