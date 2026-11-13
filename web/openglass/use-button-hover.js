import { useEffect } from "react";
import { cancelFrame, frame, springValue } from "motion";

const CONTROLS = 'button, [role="button"], summary, a.btn, a.hw-reference-link, a.swap-secondary, [data-button-surface]';
const BLOCKED = ':disabled, [aria-disabled="true"], [aria-busy="true"], [data-button-surface]:has(> input:disabled)';
const POSITION = { stiffness: 360, damping: 28, mass: .55, restDelta: .002, restSpeed: .01 };
const PRESENCE = { stiffness: 240, damping: 26, mass: .7, restDelta: .002, restSpeed: .01 };
const VARIABLES = ["--button-hover-x", "--button-hover-y", "--button-hover-opacity",
  "--button-hover-magnet-x", "--button-hover-magnet-y", "--button-hover-radius"];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const owners = new WeakMap();

// Presentation only: no wrappers, operation handlers, React state updates or continuous loop.
// Delegation includes cached native views and body-mounted feature dialogs automatically.
export function installButtonHover(scope, { magnet = .65 } = {}) {
  const doc = scope.ownerDocument || scope, win = doc.defaultView;
  const fine = win.matchMedia("(any-hover: hover) and (any-pointer: fine)");
  const restricted = ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)",
    "(forced-colors: active)", "(prefers-contrast: more)", "(update: slow)"]
    .map(query => win.matchMedia(query));
  const controllers = new Map(), listeners = [];
  let current = null, destroyed = false;
  const strength = clamp(magnet, 0, .8);
  const enabled = () => !destroyed && !doc.hidden && fine.matches
    && !restricted.some(media => media.matches) && !win.navigator.connection?.saveData;
  const eligible = node => node.isConnected && within(node) && !node.matches(BLOCKED)
    && !node.closest('[inert], [hidden], [data-button-hover="off"]');
  const within = node => scope === doc || scope.contains(node);
  const find = event => {
    const node = event.target instanceof win.Element ? event.target.closest(CONTROLS) : null;
    return node && within(node) && eligible(node) ? node : null;
  };
  const mutations = new win.MutationObserver(() => {
    for (const controller of controllers.values()) {
      if (!eligible(controller.node) || !controller.light.isConnected) controller.destroy();
    }
  });

  function create(node, event) {
    if (owners.has(node)) return null; // Overlapping hook scopes share the first owner.
    // One measurement on entry; pointer moves only update Motion's spring targets.
    let bounds = node.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const point = event => ({
      x: clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height * 2 - 1, -1, 1),
    });
    const initial = point(event), x = springValue(initial.x, POSITION), y = springValue(initial.y, POSITION);
    const presence = springValue(0, PRESENCE), values = [x, y, presence];
    const light = doc.createElement("span");
    light.className = "button-hover-light";
    light.setAttribute("aria-hidden", "true");
    const positioned = win.getComputedStyle(node).position === "static";
    let active = true, disposed = false;
    const controller = { node, light,
      move(event) { const next = point(event); x.set(next.x); y.set(next.y); },
      leave() { active = false; x.set(0); y.set(0); presence.set(0); schedule(); },
      enter(event) {
        if (!active) bounds = node.getBoundingClientRect();
        active = true; controller.move(event); presence.set(1);
      },
      destroy() {
        if (disposed) return;
        disposed = true;
        if (current === controller) current = null;
        cancelFrame(paint);
        for (const unsubscribe of subscriptions) unsubscribe();
        for (const value of values) { value.stop(); value.destroy(); }
        light.remove();
        if (node.getAttribute("data-button-hover") === "active") node.removeAttribute("data-button-hover");
        if (positioned) node.classList.remove("button-hover-positioned");
        for (const name of VARIABLES) node.style.removeProperty(name);
        controllers.delete(node);
        owners.delete(node);
        if (!controllers.size) mutations.disconnect();
      },
    };
    function paint() {
      if (disposed) return;
      if (!enabled() || !eligible(node) || light.parentElement !== node) { controller.destroy(); return; }
      const amount = clamp(presence.get(), 0, 1);
      if (!active && amount < .002) { controller.destroy(); return; }
      const px = clamp(x.get(), -1, 1), py = clamp(y.get(), -1, 1);
      node.style.setProperty("--button-hover-x", `${((px + 1) * 50).toFixed(2)}%`);
      node.style.setProperty("--button-hover-y", `${((py + 1) * 50).toFixed(2)}%`);
      node.style.setProperty("--button-hover-opacity", amount.toFixed(3));
      // Less than one physical pixel in total, including diagonal travel. The layout stays put.
      node.style.setProperty("--button-hover-magnet-x", `${(px * strength * amount).toFixed(3)}px`);
      node.style.setProperty("--button-hover-magnet-y", `${(py * strength * .65 * amount).toFixed(3)}px`);
    }
    function schedule() { frame.render(paint); }
    const subscriptions = values.map(value => value.on("change", schedule));
    controllers.set(node, controller);
    owners.set(node, controller);
    node.style.setProperty("--button-hover-radius", `${clamp(bounds.width * .55, 56, 110)}px`);
    node.setAttribute("data-button-hover", "active");
    if (positioned) node.classList.add("button-hover-positioned");
    node.append(light); presence.set(1); schedule();
    mutations.observe(doc.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "aria-busy", "inert", "hidden", "data-button-hover"] });
    return controller;
  }

  const reset = () => { for (const controller of [...controllers.values()]) controller.destroy(); };
  const leave = () => { current?.leave(); current = null; };
  const over = event => {
    if (event.pointerType !== "mouse" || event.buttons || !enabled()) return;
    const node = find(event);
    if (current?.node === node) return;
    leave();
    if (!node) return;
    current = controllers.get(node) || create(node, event);
    current?.enter(event);
  };
  const move = event => {
    if (event.pointerType !== "mouse" || !enabled()) { reset(); return; }
    if (event.buttons) return;
    if (!current || !current.node.contains(event.target)) over(event);
    current?.move(event);
  };
  const out = event => { if (current && !current.node.contains(event.relatedTarget)) leave(); };
  function on(target, type, listener, options = { passive: true }) {
    target.addEventListener(type, listener, options);
    listeners.push(() => target.removeEventListener(type, listener, options));
  }
  on(scope, "pointerover", over);
  on(scope, "pointermove", move);
  on(scope, "pointerout", out);
  on(scope, "pointerdown", event => { if (event.pointerType !== "mouse") reset(); });
  on(scope, "pointercancel", reset);
  on(doc, "keydown", reset);
  on(doc, "visibilitychange", reset);
  on(win, "blur", reset);
  on(win, "pagehide", reset);
  on(win, "resize", reset);
  on(doc, "scroll", reset, { capture: true, passive: true });
  for (const media of [fine, ...restricted]) on(media, "change", reset);
  if (win.navigator.connection) on(win.navigator.connection, "change", reset);
  return () => { destroyed = true; reset(); mutations.disconnect(); listeners.forEach(remove => remove()); };
}

/** Add to an app shell, or pass a ref to a smaller button group. Opt out with data-button-hover="off". */
export function useButtonHover(scopeRef, { magnet = .65 } = {}) {
  useEffect(() => installButtonHover(scopeRef?.current || document, { magnet }), [scopeRef, magnet]);
}
