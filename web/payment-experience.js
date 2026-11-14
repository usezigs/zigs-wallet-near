// View continuity only. No payment, wallet, storage or network imports.
const documents = new WeakMap();
const views = [["send", "Send"], ["review", "Review"], ["approve", "Approve"], ["record", "Record"]];

/** Navigation context, never a claim that a payment has completed these operations. */
export function paymentJourney(el, current) {
  return el("ol", { class: "payment-journey", "aria-label": "Payment views, not transaction status" },
    views.map(([id, label], index) => el("li", { class: "payment-journey-step",
      "aria-current": id === current ? "location" : null },
      el("span", { class: "payment-journey-number", "aria-hidden": "true" }, String(index + 1).padStart(2, "0")),
      el("span", {}, label), id === current
        ? el("span", { class: "payment-journey-marker", "aria-hidden": "true" }) : null)));
}

function motionOwner(doc) {
  const win = doc.defaultView;
  const media = win.matchMedia("(prefers-reduced-motion:reduce),(update:slow),(forced-colors:active)");
  const effects = new Set();
  let previous = null;
  const stop = () => { effects.forEach((effect) => effect.cancel()); effects.clear(); previous = null; };
  const restrict = () => { if (doc.hidden || media.matches) stop(); };
  doc.addEventListener("visibilitychange", restrict);
  media.addEventListener("change", restrict);
  win.addEventListener("pagehide", stop);
  function animate(node, x, y) {
    if (!node || !win.zigsGlass?.animate) return;
    const effect = win.zigsGlass.animate(node,
      { transform: [`translate(${Math.max(-80, Math.min(80, x))}px,${Math.max(-24, Math.min(24, y))}px)`, "none"] },
      { duration: .28, ease: [.18, .8, .22, 1] });
    effects.add(effect);
    Promise.resolve(effect).then(() => effects.delete(effect), () => effects.delete(effect));
  }
  return ({ layer, identity = {} }) => {
    const surface = layer?.matches("[data-payment-view]") ? layer : null;
    for (const effect of effects) effect.cancel();
    effects.clear();
    if (!surface || doc.hidden || media.matches || win.navigator.connection?.saveData) { stop(); return; }
    const marker = surface.querySelector(".payment-journey-marker");
    const avatar = surface.querySelector(".wallet-context-label img");
    const current = { wallet: identity.wallet, view: surface.dataset.paymentView,
      marker: marker?.getBoundingClientRect(), avatar: avatar?.getBoundingClientRect() };
    if (previous?.wallet === current.wallet && previous.view !== current.view) {
      if (previous.marker && current.marker) animate(marker,
        previous.marker.left - current.marker.left, previous.marker.top - current.marker.top);
      if (previous.avatar && current.avatar) animate(avatar,
        previous.avatar.left - current.avatar.left, previous.avatar.top - current.avatar.top);
    }
    previous = current;
  };
}

/** Called after the existing render and focus restoration. Only decorative anchors move. */
export function presentPaymentExperience(parts, doc = globalThis.document) {
  if (!doc?.defaultView?.matchMedia) return;
  let present = documents.get(doc);
  if (!present) { present = motionOwner(doc); documents.set(doc, present); }
  present(parts);
}
