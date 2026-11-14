// Shared presentation only. Progress never grants wallet readiness or payment authority.
import { SETUP_STAGES } from "./setup-model.js";
import { icon, sculptedIcon } from "./app-icons.js";

const STAGE_ICONS = ["wallet", "devices", "security", "key", "lock"];

export function setupHeader(el, wallet, solWanted, onExit) {
  return el("header", { class: "guided-header" },
    el("div", {}, el("h1", {}, wallet.name),
      el("p", { class: "small muted" }, "Zcash " + (wallet.network || "testnet")
        + (solWanted ? " · Solana Devnet" : "") + " · Any " + wallet.t + " of " + wallet.n + " devices")),
    el("button", { class: "btn ghost", type: "button", onclick: onExit }, "Save and exit"));
}

export function setupProgress(el, index, review, onReview, stages = SETUP_STAGES) {
  const shown = review ?? index;
  const mark = (i) => el("span", { class: "setup-stage-mark", "aria-hidden": "true" },
    sculptedIcon(STAGE_ICONS[i] || "wallet"),
    el("span", { class: "setup-stage-number" }, i < index ? icon("check") : String(i + 1)));
  const items = stages.map((name, i) => el("li", {
    class: i === shown ? "current" : i < index ? "done" : "",
    "aria-current": i === shown ? "step" : null },
  onReview && i <= index ? el("button", { type: "button", class: "guided-stage-button",
    onclick: () => onReview(i) }, mark(i), el("span", { class: "setup-stage-label" }, name))
    : el("span", { class: "guided-stage-label" }, mark(i), el("span", { class: "setup-stage-label" }, name))));
  return el("nav", { class: "guided-progress", "aria-label": "Wallet setup progress",
    "data-setup-navigation": "guided", "data-active-step": String(shown),
    style: "--setup-step-count:" + stages.length + ";--setup-active:" + shown },
    el("p", { class: "guided-mobile-stage sr-only", role: "status" },
      "Step " + (shown + 1) + " of " + stages.length + ": " + stages[shown] + "."
        + (shown === 1 ? " Every device joins with the invite link." : "")),
    el("span", { class: "setup-progress-active", "aria-hidden": "true" }),
    el("ol", {}, items));
}
