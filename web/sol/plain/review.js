// The checker screen of a plain proposal. It shows what plain_check_message says (wasm-sol/src/
// plain_check.rs, plain_display.rs) and nothing else: every value of a row is a line of the
// answer, kept as the checker wrote it. No row is built from the intent, the pins, a document or
// a field of the proposal, and the checker's text is not reworded. Only `accepted` can be approved.

// The label of each name in the lines of an accepted answer: one or two words.
const LABELS = {
  intent: "Action",
  cluster: "Network",
  recipient: "To",
  amount: "Amount",
  units: "Base units",
  symbol: "Asset",
  mint: "Mint",
  fee: "Fee lamports",
  rent: "Rent lamports",
  payer: "Fee payer",
  group: "Wallet",
};
const OTHER = "Other";

// Splits `text` at its first `mark`: [before, after], and after is "" when there is no mark.
function splitOnce(text, mark) {
  const at = text.indexOf(mark);
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + mark.length)];
}

function nameValue(line) {
  const [name, value] = splitOnce(line, " ");
  return { name, value };
}

const statementsOf = (W) =>
  new Map(W.plain_rule_list().split("\n").map((line) => splitOnce(line, "\t")));

// The statement of a rule is its text in plain_rule_list. A rule that the list does not know shows
// its id, so a row is never empty.
function refusedRules(W, body) {
  const statements = statementsOf(W);
  return body.map((line) => {
    const [id, detail] = splitOnce(line, "\t");
    return { id, statement: statements.get(id) ?? id, detail };
  });
}

function readAnswer(W, answer) {
  const [head, ...rest] = answer.split("\n");
  const body = rest.filter(Boolean);
  if (head === "accepted") {
    return { kind: "accepted", lines: body.map((line) => ({ line, ...nameValue(line) })) };
  }
  if (head === "refused") return { kind: "refused", rules: refusedRules(W, body) };
  return { kind: "error", text: answer.replace(/^error\t/, "") };
}

/**
 * The answer of the checker for one proposal, as { kind: "accepted", lines: [{ name, value,
 * line }] }, { kind: "refused", rules: [{ id, statement, detail }] } or { kind: "error", text }.
 * `statement` is the text of the rule in plain_rule_list. An answer of another shape, and a throw
 * of the wasm, are errors: they are neither accepted nor refused.
 */
export function reviewText({ W }, message, intent, pins, chain) {
  try {
    return readAnswer(W, String(W.plain_check_message(message, intent, pins, chain)));
  } catch (e) {
    return { kind: "error", text: String(e?.message ?? e) };
  }
}

/**
 * True only for an accepted answer that has a line, and a value for each line whose name this
 * page knows. A refusal and an error leave no way to approve.
 */
export const canApprove = (review) =>
  review.kind === "accepted" &&
  review.lines.length > 0 &&
  review.lines.every(({ name, value }) => !Object.hasOwn(LABELS, name) || value !== "");

/**
 * The rows of an accepted answer, one for each line and in the order of the checker:
 * { name, label, value } with the value as the checker wrote it. A name that this page does not
 * know shows as an "Other" row with the whole line, and is never left out. Other answers give none.
 */
export function screenRows(review) {
  if (!canApprove(review)) return [];
  return review.lines.map(({ name, value, line }) =>
    Object.hasOwn(LABELS, name)
      ? { name, label: LABELS[name], value }
      : { name, label: OTHER, value: line, other: true },
  );
}

/** One row for each rule that the checker refused: { id, statement, detail }. */
export const refusalRows = (review) =>
  review.kind === "refused" ? review.rules.map((rule) => ({ ...rule })) : [];

export const INCOMPLETE = "The checker answered with lines that Zigs cannot show.";
const REFUSED = "The checker refused this: ";
const UNCHECKED = "The checker could not check this: ";

/**
 * The text of a review that cannot be approved, for a person who is told why nothing was signed,
 * published or saved: each broken rule with its detail, or the error of the checker.
 */
export function stopText(review) {
  if (review.kind === "refused") {
    const rules = review.rules.map(({ statement, detail }) =>
      detail ? `${statement} (${detail})` : statement);
    return REFUSED + rules.join("; ");
  }
  return review.kind === "error" ? UNCHECKED + review.text : INCOMPLETE;
}
