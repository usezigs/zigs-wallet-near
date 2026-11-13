// Supporting overview details open in the top layer, keeping the financial overview in place.
// Native popovers provide outside-click/Escape dismissal without trapping keyboard focus.
/** @param {HTMLElement} trigger @param {HTMLElement} panel */
export function positionOverviewPopover(trigger, panel) {
  panel.setAttribute("popover", "auto");
  panel.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "open") return;
    const box = trigger.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 32);
    panel.style.width = width + "px";
    panel.style.left = Math.max(16, Math.min(box.right - width,
      window.innerWidth - width - 16)) + "px";
    panel.style.top = Math.max(16, Math.min(box.bottom + 8, window.innerHeight - 340)) + "px";
  });
}

/** Preserve native overview disclosures while moving expanded content out of document flow.
 * @param {ParentNode} root */
export function presentOverviewDetails(root) {
  for (const details of root.querySelectorAll(".asset-note, "
    + ".overview-page:has(.overview-portfolio) .workflow-details")) {
    if (!(details instanceof HTMLDetailsElement) || details.dataset.overviewPopover) continue;
    const summary = details.querySelector("summary");
    const panel = details.querySelector(".asset-note-body, .shared-control");
    if (!(summary instanceof HTMLElement) || !(panel instanceof HTMLElement)) continue;
    details.dataset.overviewPopover = "1";
    panel.classList.add("overview-detail-popover");
    positionOverviewPopover(summary, panel);
    details.addEventListener("toggle", () => {
      if (!panel.isConnected) return;
      if (details.open) panel.showPopover(); else panel.hidePopover();
    });
    panel.addEventListener("beforetoggle", (event) => {
      if (event.newState === "closed") details.open = false;
    });
    if (details.open) panel.showPopover();
  }
}
