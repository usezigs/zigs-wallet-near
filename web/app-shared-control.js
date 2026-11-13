// Membership presentation only. No connectivity, payment approval or signature inference.
import { icon } from "./app-icons.js";
import { el } from "./app-dom.js";
import { positionOverviewPopover } from "./overview-popover.js";

export function sharedControl({ required, total, participants, status, context, openSecurity,
  attention = false }) {
  const joined = participants.filter((p) => p.joined === true).length;
  const checking = participants.some((p) => p.joined === null);
  const panel = el("div", { class: "overview-detail-popover shared-control-people",
    id: "wallet-participants-" + context, "aria-label": "Wallet participants" },
    el("h3", {}, "Wallet participants"),
    el("ol", { class: "custody-devices", "aria-label": "Wallet participants" },
      participants.map((p) => el("li", { class: "custody-device "
        + (p.joined === true ? "joined" : "invited"),
        "data-motion-watch": "membership:" + context + ":" + p.id,
        "data-motion-value": p.joined === null ? "unknown" : p.joined ? "on" : "off" },
      el("span", { class: "custody-node", "aria-hidden": "true", "data-motion-mark": "" },
        String(p.id).padStart(2, "0")),
      el("span", { class: "custody-device-name" }, p.name),
      el("span", { class: "custody-device-state" },
        p.joined === null ? "Checking" : p.joined ? "Joined" : "Not joined")))),
    el("p", {}, "Membership is separate from payment approvals."));
  const people = el("button", { type: "button", class: "btn ghost sm",
    "aria-label": "View wallet participants", popovertarget: panel.id }, icon("devices"));
  positionOverviewPopover(people, panel);
  return el("section", { class: "shared-control", "aria-labelledby": "shared-control-title" },
    el("div", { class: "shared-control-heading" },
      el("h2", { id: "shared-control-title" }, "Shared control"),
      el("span", { class: "shared-control-status" + (attention ? " attention" : "") }, status)),
    el("p", { class: "shared-control-rule" }, el("strong", {}, required + " of " + total),
      el("span", {}, "approvals required")),
    el("p", { class: "shared-control-participation" }, total + " participating devices · "
      + (checking ? "Checking membership" : joined + " joined")),
    el("ol", { class: "shared-control-seats", "aria-label": "Configured devices, not payment approvals" },
      participants.map((p) => el("li", { class: "shared-control-seat" },
        el("span", { class: "shared-control-medallion", "aria-hidden": "true" }, String(p.id).padStart(2, "0")),
        el("span", { class: "shared-control-seat-name" }, p.name)))),
    el("p", { class: "shared-control-separation" }, "Configuration only · each payment has its own approvals"),
    el("div", { class: "shared-control-actions" }, people,
      el("button", { class: "btn ghost sm", type: "button", onclick: openSecurity },
        icon("security"), "Security")), panel);
}
