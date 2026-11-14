// Presentation only: the moving lens follows the stage supplied by the native setup flow.
export function installSetupMotion(root, animate) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const media = win.matchMedia("(prefers-reduced-motion:reduce),(update:slow),(forced-colors:active)");
  const effects = new Set();
  let previous = null, current = null;
  const stop = () => { for (const effect of effects) effect.cancel(); effects.clear(); };
  const allowed = () => !doc.hidden && !media.matches && !win.navigator.connection?.saveData;
  media.addEventListener("change", stop);
  doc.addEventListener("visibilitychange", () => { if (doc.hidden) stop(); });
  win.addEventListener("pagehide", stop);
  const run = (target, frames, duration) => {
    const effect = animate(target, frames, { duration, ease: [.16, 1, .3, 1] });
    effects.add(effect);
    Promise.resolve(effect).then(() => effects.delete(effect), () => effects.delete(effect));
  };
  return () => {
    const nav = root.querySelector("[data-setup-navigation]");
    if (!nav) { stop(); previous = current = null; return; }
    if (nav === current) return;
    stop(); current = nav;
    const next = { scope: nav.dataset.setupNavigation, index: Number(nav.dataset.activeStep) };
    if (allowed() && previous?.scope === next.scope && previous.index !== next.index) {
      const lens = nav.querySelector(".setup-progress-active");
      if (lens) run(lens, { transform: [
        `translateX(${previous.index * 100}%)`, `translateX(${next.index * 100}%)`,
      ] }, .28);
      const mark = nav.querySelector(".current .icon-object");
      if (mark) run(mark, { transform: ["rotateY(-18deg) scale(.9)", "rotateY(0deg) scale(1)"],
        filter: ["brightness(.8)", "brightness(1)"] }, .28);
    }
    previous = next;
  };
}
