import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Badge, Button, Card, Glass, Stat, TextField } from "open-glass-ui";
import { EdgeShine } from "./material-motion.jsx";

// The wallet deliberately keeps native input references and native event handlers. Only the
// presentation crosses this boundary. All islands are portals of the single system provider;
// moving native children into a ref-owned outlet leaves React's own DOM in its original slot.
const entries = new WeakMap();
let nextId = 0, notify = () => {};

function NativeContent({ nodes, slot }) {
  const outlet = useRef(null);
  useLayoutEffect(() => {
    outlet.current.append(...nodes);
    // Cached views (notably Swap) can be detached and reattached. Restore their native content
    // on unmount, so reconnecting a slot can mount the same component again without losing it.
    return () => { slot.append(...nodes); };
  }, [nodes, slot]);
  return <span className="openglass-native" ref={outlet} />;
}

function nativeAttributes(node, attrs) {
  if (!node) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false || key === "class" || key === "data-glass") continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "style") node.style.cssText = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
}

function Island({ entry }) {
  const { kind, attrs, nodes, slot, options } = entry;
  const ref = useRef(null);
  useLayoutEffect(() => nativeAttributes(ref.current, attrs), [attrs]);
  const content = <NativeContent nodes={nodes} slot={slot} />;
  const shine = <EdgeShine />;
  const heroFrame = /\bwelcome\b/.test(attrs.class);
  if (kind === "card") return <Card
    className={attrs.class + (heroFrame ? "" : " openglass-reflective")} ref={ref}>
    {heroFrame ? null : shine}{content}</Card>;
  const shinyButton = kind === "button" && !/\b(ghost|side-item)\b/.test(attrs.class);
  if (kind === "button") return <Button ref={ref}
    className={attrs.class + (shinyButton ? " openglass-reflective" : "")}
    variant={/\bprimary\b/.test(attrs.class) ? "primary" : /\b(ghost|side-item)\b/.test(attrs.class) ? "quiet" : "secondary"}
    size={/\bsm\b/.test(attrs.class) ? "small" : /\blg\b/.test(attrs.class) ? "large" : "medium"}
    type={attrs.type || "button"} disabled={!!attrs.disabled}>{shinyButton ? shine : null}{content}</Button>;
  if (kind === "field") return <TextField ref={ref} className="field openglass-field"
    id={attrs.id} label={options.label} hint={options.hint} defaultValue={attrs.value || ""} />;
  if (kind === "stat") return <Stat ref={ref} className="openglass-balance-stat"
    data-long-value={String(options.value).length > 12 ? "true" : undefined}
    label={options.label} value={options.value} change={options.change} />;
  if (kind === "badge") return <Badge ref={ref} className={attrs.class}
    tone={/\bbad\b/.test(attrs.class) ? "danger" : /\bwarn\b/.test(attrs.class) ? "warning"
      : /\bok\b/.test(attrs.class) ? "positive" : /\binfo\b/.test(attrs.class) ? "accent" : "neutral"}
    >{content}</Badge>;
  const financialSurface = /\boverview-hero\b/.test(attrs.class);
  return <Glass ref={ref} material="frosted" className={attrs.class + " openglass-reflective"}
    style={financialSurface ? { background: "var(--studio-surface,var(--panel))",
      boxShadow: "var(--studio-shadow,none)", backdropFilter: "none", WebkitBackdropFilter: "none" } : undefined}
    as={options.tag || "div"} aria-hidden={kind === "backdrop" ? "true" : undefined}>
    {shine}{kind === "backdrop" ? null : content}</Glass>;
}

function mount(kind, attrs = {}, kids = [], options = {}) {
  const slot = document.createElement("span");
  slot.className = "openglass-slot";
  slot.dataset.openglassSlot = String(++nextId);
  const nodes = kids.flat().filter((kid) => kid != null && kid !== false)
    .map((kid) => kid instanceof Node ? kid : document.createTextNode(String(kid)));
  slot.append(...nodes);
  entries.set(slot, { id: nextId, kind, attrs, nodes, slot, options });
  notify();
  return slot;
}

export function installBridge(schedule) {
  notify = schedule;
  const api = {
    element(tag, attrs, kids) {
      const cls = attrs.class || "";
      const classes = new Set(cls.split(/\s+/));
      // Form roots, dialogs, and controls with imperative references keep their native owners.
      if (["div", "section", "article"].includes(tag) && classes.has("card") && !attrs.onclick)
        return mount("card", attrs, kids);
      if (["div", "section", "header"].includes(tag)
        && /\b(preferences-surface|overview-hero)\b/.test(cls))
        return mount("glass", attrs, kids, { tag });
      if (tag === "button" && attrs["data-glass"] === "button") return mount("button", attrs, kids);
      if (tag === "span" && classes.has("badge")) return mount("badge", attrs, kids);
      return null;
    },
    field: (attrs, label, hint) => mount("field", attrs, [], { label, hint }),
    stat: (attrs, options) => mount("stat", attrs, [], options),
    flush: schedule,
  };
  globalThis.zigsGlass = api;
  return api;
}

export function collectPortals() {
  // Existing modal owners retain their focus trap, Escape handling, form node and validation.
  // A real Glass surface supplies their material without adding a second dialog/focus manager.
  for (const sheet of document.querySelectorAll(".dialog, .drawer, form.card, .wallet-context-header")) {
    if (sheet.querySelector(":scope > .openglass-backdrop-slot")) continue;
    sheet.classList.add("openglass-sheet");
    const slot = mount("backdrop", { class: "openglass-sheet-material" });
    slot.classList.add("openglass-backdrop-slot");
    slot.setAttribute("aria-hidden", "true");
    sheet.prepend(slot);
  }
  return [...document.querySelectorAll("[data-openglass-slot]")]
    .map((slot) => entries.get(slot)).filter(Boolean)
    .map((entry) => ({ id: entry.id, portal: createPortal(<Island entry={entry} />, entry.slot, entry.id) }));
}
