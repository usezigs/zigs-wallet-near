import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Badge, Button, Card, Glass, IconButton, Select, Stat, TextField } from "open-glass-ui";
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
  const cleanups = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false || key === "class" || key === "data-glass") continue;
    if (key.startsWith("on")) {
      const event = key.slice(2);
      node.addEventListener(event, value);
      cleanups.push(() => node.removeEventListener(event, value));
    }
    else if (key === "style") node.style.cssText = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  return () => cleanups.forEach((cleanup) => cleanup());
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
  if (kind === "icon-button") return <IconButton ref={ref} className={attrs.class}
    aria-label={attrs["aria-label"]} type={attrs.type || "button"} disabled={!!attrs.disabled}>
    {content}</IconButton>;
  if (kind === "button") return <Button ref={ref}
    className={attrs.class + (shinyButton ? " openglass-reflective" : "")}
    variant={/\bdanger\b/.test(attrs.class) ? "danger" : /\bprimary\b/.test(attrs.class) ? "primary" : /\b(ghost|side-item)\b/.test(attrs.class) ? "quiet" : "secondary"}
    size={/\bsm\b/.test(attrs.class) ? "small" : /\blg\b/.test(attrs.class) ? "large" : "medium"}
    type={attrs.type || "button"} disabled={!!attrs.disabled}>{shinyButton ? shine : null}{content}</Button>;
  if (kind === "field") return <TextField ref={ref} className="field openglass-field"
    id={attrs.id} label={options.label} hint={options.hint} defaultValue={attrs.value || ""} />;
  if (kind === "select") return <Select ref={ref} className="field openglass-field"
    id={attrs.id} label={options.label} options={options.items} defaultValue={attrs.value} />;
  if (kind === "stat") return <Stat ref={ref} className="openglass-balance-stat"
    data-long-value={String(options.value).length > 12 ? "true" : undefined}
    label={options.label} value={options.value} change={options.change} />;
  if (kind === "badge") return <Badge ref={ref} className={attrs.class}
    tone={/\bbad\b/.test(attrs.class) ? "danger" : /\bwarn\b/.test(attrs.class) ? "warning"
      : /\bok\b/.test(attrs.class) ? "positive" : /\binfo\b/.test(attrs.class) ? "accent" : "neutral"}
    >{content}</Badge>;
  return <Glass ref={ref} material={options.material || "regular"} className={attrs.class + " openglass-reflective"}
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
      // Existing card layouts use direct-child selectors. Keep their native structure and
      // apply a Glass material below; opt in to Card for independent React presentation.
      if (["div", "section", "article"].includes(tag) && attrs["data-glass"] === "card")
        return mount("card", attrs, kids);
      if (["div", "section", "header"].includes(tag)
        && /\b(preferences-surface|overview-hero)\b/.test(cls))
        return mount("glass", attrs, kids, { tag });
      if (tag === "button" && ["button", "icon-button"].includes(attrs["data-glass"]))
        return mount(attrs["data-glass"], attrs, kids);
      if (tag === "span" && classes.has("badge")) return mount("badge", attrs, kids);
      return null;
    },
    field: (attrs, label, hint) => mount("field", attrs, [], { label, hint }),
    select: (attrs, label, items) => mount("select", attrs, [], { label, items }),
    stat: (attrs, options) => mount("stat", attrs, [], options),
    flush: schedule,
  };
  globalThis.zigsGlass = api;
  return api;
}

// Native owners keep their input references, validation, focus traps and async disabled state.
// Paint their material with a real Glass portal instead of replacing the element they own.
// In particular, a form or dialog must never acquire a second React focus/submit manager.
const surfaces = [
  ".card:not(.welcome)", "dialog", '[role="dialog"]', ".drawer", ".wallet-context-header", ".setup-wallet-status",
  ".guided-card", ".setup-device-row", ".surface-quiet", ".surface-chrome",
  ".recipient-card", ".recipient-editor", ".device-protection", ".sol-operation",
  ".setup-completion-actions", ".setup-backup-row", ".action-bar", ".transaction-views",
  '[role="tablist"]', ".overview-detail-popover", ".asset-note-body", ".receive-surface",
  ".setup-diagram", ".security-group", ".chat-compose", ".req-form", ".asset-choices", "#banner",
  ".swap-composer", ".swap-detail-card", ".swap-privacy", ".swap-settings-panel", ".swap-deposit",
  ".pq-form", ".pq-recap", ".pq-key-card", ".pq-result", ".swap-quantum-intro",
  ".messages-inbox", ".messages-thread", ".sol-receive-card", ".wallet-vault-card",
  ".security-overview", ".security-signer", ".security-access-entry", ".messages-layout", ".swap-quantum-panel",
  ".security-access-list", ".approval-empty", ".shared-control", ".approval-verify", ".transaction-receipt", ".sol-review",
  ".stage-panel", ".guide-step", ".network-privacy-mode", ".home-wallet-note",
  ".approval-visualization", ".home-hero",
  ".swap-execution", ".swap-execution-option", ".swap-pane", ".swap-payer", ".swap-payout",
  ".swap-history", ".swap-history-row", ".swap-privacy-explainer", ".privacy-film",
  ".privacy-film-note", ".privacy-film-ledger", ".privacy-film-provider", ".privacy-film-address",
  ".privacy-film-receipt", ".privacy-film-seal",
  ".browser-status > summary", ".side.menu-open #side-nav",
].join(", ");

function addMaterial(node, control = false) {
  if (node.matches("[data-ogui-glass], .ogui-card, .ogui-button")) return;
  if (node.querySelector(":scope > .openglass-backdrop-slot")) return;
  if (getComputedStyle(node).position === "static") node.classList.add("openglass-positioned");
  node.classList.add("openglass-sheet");
  // Native top-layer dialogs (Swap) live under body, outside the React theme element.
  if (!node.closest(".zigs-openglass, .openglass-overlay")) node.classList.add("openglass-overlay");
  if (control) node.classList.add("openglass-control");
  const frosted = node.matches('dialog, [role="dialog"], .drawer, .surface-chrome, .overview-detail-popover, .asset-choices, .swap-settings-panel, #banner, #side-nav');
  const slot = mount("backdrop", { class: "openglass-sheet-material" }, [],
    { material: frosted ? "frosted" : "regular" });
  slot.classList.add("openglass-backdrop-slot");
  slot.setAttribute("aria-hidden", "true");
  node.append(slot);
}

export function collectPortals() {
  for (const surface of document.querySelectorAll(surfaces)) addMaterial(surface);
  // These controls are held by imperative wallet code (for example go.disabled or pass.value).
  // Their actual DOM nodes and native events remain stable across theme and material updates.
  const controls = ["button", "summary.btn", ".swap-settings > summary", "a.btn", "a.swap-secondary"];
  for (const control of document.querySelectorAll(controls.join(", ")))
    addMaterial(control, true);
  return [...document.querySelectorAll("[data-openglass-slot]")]
    .map((slot) => entries.get(slot)).filter(Boolean)
    .map((entry) => ({ id: entry.id, portal: createPortal(<Island entry={entry} />, entry.slot, entry.id) }));
}

export function syncOverlayThemes() {
  const source = document.querySelector(".zigs-openglass");
  if (!source) return;
  const theme = getComputedStyle(source.querySelector(".shell") || source);
  for (const overlay of document.querySelectorAll(".openglass-overlay")) {
    overlay.dataset.oguiAppearance = source.dataset.oguiAppearance;
    for (const property of theme) if (property.startsWith("--ogui-"))
      overlay.style.setProperty(property, theme.getPropertyValue(property));
  }
}
