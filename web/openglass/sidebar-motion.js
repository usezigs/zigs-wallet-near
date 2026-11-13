// Decorative navigation and scoped glyph interactions. No wallet, router, financial or storage imports.
export function installSidebarMotion(root, animate) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const media = win.matchMedia("(prefers-reduced-motion:reduce),(update:slow),(forced-colors:active)");
  const effects = new Map(), byControl = new WeakMap();
  let previous = null, currentMarker = null, observedNav = null, observedButton = null;
  const allowed = () => !doc.hidden && !media.matches && !win.navigator.connection?.saveData;
  const cancel = (effect) => { effect?.cancel(); effects.delete(effect); };
  function run(target, values, options) {
    let effect;
    try { effect = animate(target, values, options); } catch { return null; }
    effects.set(effect, target);
    Promise.resolve(effect).then(() => effects.delete(effect), () => effects.delete(effect));
    return effect;
  }
  const stop = () => { for (const effect of effects.keys()) effect.cancel(); effects.clear(); previous = null; };
  const restrict = () => { if (!allowed()) stop(); else sync(); };
  media.addEventListener("change", restrict); doc.addEventListener("visibilitychange", restrict);
  win.navigator.connection?.addEventListener?.("change", restrict);
  win.addEventListener("pagehide", stop);
  const observer = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(() => sync()) : null;
  function sync() {
    for (const [effect, target] of effects) if (!target.isConnected) cancel(effect);
    const nav = root.querySelector("#side-nav"), active = nav?.querySelector("[data-sidebar-nav].active");
    const marker = nav?.querySelector(".sidebar-active-marker");
    if (!marker || !active) { previous = null; return; }
    if (nav !== observedNav || active !== observedButton) {
      observer?.disconnect(); observer?.observe(nav); observer?.observe(active);
      observedNav = nav; observedButton = active;
    }
    const box = active.getBoundingClientRect(), parent = nav.getBoundingClientRect();
    const visible = box.width > 0 && box.bottom > parent.top && box.top < parent.bottom;
    marker.hidden = !visible;
    if (!visible) { previous = null; return; }
    const y = box.top - parent.top + nav.scrollTop + 12;
    const next = { nav, key: active.getAttribute("data-sidebar-nav"), y };
    marker.style.left = box.left - parent.left + nav.scrollLeft + 1 + "px";
    marker.style.height = Math.max(12, box.height - 24) + "px";
    if (marker !== currentMarker || previous?.key !== next.key) {
      marker.getAnimations().forEach((effect) => effect.cancel());
      marker.style.transform = `translateY(${y}px)`;
      if (allowed() && previous?.nav === nav && previous.key !== next.key) {
        const from = y + Math.max(-480, Math.min(480, previous.y - y));
        run(marker, { transform: [`translateY(${from}px)`, `translateY(${y}px)`] },
          { duration: .24, ease: [.18, .8, .22, 1] });
      }
    } else if (previous.y !== y) marker.style.transform = `translateY(${y}px)`;
    currentMarker = marker; previous = next;
  }
  const controlFor = (target) => target.closest?.("[data-sidebar-nav],.side-head .icon-btn,#wallet-menu,[data-interface-control]");
  function engage(control) {
    if (!control || control.id === "wallet-menu" || !allowed() || control.matches(":disabled,[aria-disabled=true],label:has(input:disabled)") || !control.getClientRects().length) return;
    const trace = control.querySelector(".sidebar-glyph-trace,.interface-glyph-trace"), detail = control.querySelector(".sidebar-glyph-detail,.interface-glyph-detail");
    for (const effect of byControl.get(control) || []) cancel(effect);
    const own = [];
    if (trace) own.push(run(trace, { strokeDashoffset: [1, 0], opacity: [0, 1, 0] }, { duration: .4, ease: "easeOut" }));
    if (detail) {
      const name = control.querySelector("[data-icon]")?.getAttribute("data-icon");
      const start = name === "settings" ? "rotate(-18deg)" : name === "swap" ? "translateX(-1px)"
        : name === "chat" ? "translateY(-1px)" : "scale(.92)";
      own.push(run(detail, { transform: [start, "none"] }, { duration: .24, ease: [.18, .8, .22, 1] }));
    }
    byControl.set(control, own);
  }
  root.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const control = controlFor(event.target);
    if (control && !control.contains(event.relatedTarget)) engage(control);
  });
  root.addEventListener("focusin", (event) => {
    const control = controlFor(event.target);
    if (control && (control.matches(":focus-visible") || event.target.matches(":focus-visible"))) engage(control);
  });
  root.addEventListener("scroll", sync, true);
  win.addEventListener("resize", sync);
  return sync;
}
