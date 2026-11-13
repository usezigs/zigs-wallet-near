// Receive presentation only. The caller supplies the already-allowed destination and QR.
// No wallet, engine, store or payment imports; each interaction belongs to this card's nodes.
export function receiveDestinationCard(el, icon, { address, addressNode, code, sculpture, walletName, network,
  moved = false, onShareFailure }) {
  const feedback = el("p", { class: "receive-feedback", role: "status", "aria-live": "polite",
    "aria-atomic": "true" });
  const say = (text, tone = "neutral") => {
    if (!feedback.isConnected) return;
    feedback.setAttribute("data-tone", tone); feedback.textContent = text;
  };
  function selectAddress() {
    if (!addressNode.isConnected) return;
    if (addressNode.tagName === "DETAILS") addressNode.open = true;
    const value = addressNode.matches("[data-receive-address]") ? addressNode
      : addressNode.querySelector("[data-receive-address]");
    if (!value) return;
    value.setAttribute("tabindex", "-1"); value.focus({ preventScroll: true });
    const doc = value.ownerDocument, range = doc.createRange(); range.selectNodeContents(value);
    const selection = doc.defaultView.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    value.scrollIntoView({ block: "nearest" });
  }
  let copy, copying = false;
  copy = el("button", { class: "btn primary receive-copy", type: "button", onclick: async () => {
    if (copying) return;
    copying = true; copy.setAttribute("aria-busy", "true");
    try {
      await navigator.clipboard.writeText(address);
      if (!copy.isConnected) return;
      copy.replaceChildren(icon("check"), "Copied"); copy.setAttribute("data-result", "copied");
      say("Full address copied", "success");
    } catch {
      if (!copy.isConnected) return;
      copy.replaceChildren(icon("copy"), "Copy address"); copy.removeAttribute("data-result");
      selectAddress(); say("Copy was blocked. The full address is selected; copy it manually.", "error");
    } finally { copying = false; copy.removeAttribute("aria-busy"); }
  } }, icon("copy"), "Copy address");
  let share = null, sharing = false;
  if (!moved && typeof navigator.share === "function") {
    share = el("button", { class: "btn receive-share", type: "button", onclick: async () => {
      if (sharing) return;
      sharing = true; share.setAttribute("aria-busy", "true");
      try {
        await navigator.share({ text: address });
        // Browsers resolve at different points. Opening a share sheet is not delivery proof.
        say("Share options opened");
      } catch (error) {
        if (!share.isConnected) return;
        if (error?.name === "AbortError") say("Sharing cancelled");
        else { say("Sharing is unavailable. Use Copy address.", "error"); onShareFailure?.(); }
      } finally { sharing = false; share.removeAttribute("aria-busy"); }
    } }, "Share address");
  }
  return el("section", { class: "receive-surface receive-wallet-card", "aria-label": "Zcash receiving address" },
    el("header", { class: "receive-wallet-identity" }, sculpture,
      el("div", {}, el("p", { class: "receive-wallet-label" }, "Receiving wallet"),
        el("h3", {}, walletName))),
    el("div", { class: "receive-card-body" },
      el("figure", { class: "receive-code" }, code, el("figcaption", {}, "Scan to receive ZEC")),
      el("div", { class: "receive-destination" },
        el("p", { class: "receive-address-label" }, "Shielded address"), addressNode,
        el("div", { class: "receive-actions" }, copy, share), feedback)),
    moved ? null : el("p", { class: "receive-network-note" },
      el("strong", {}, "Only ZEC on " + network),
      el("span", {}, "Funds become spendable after 3 confirmations")));
}
