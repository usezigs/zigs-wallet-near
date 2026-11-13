import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { animate } from "motion/mini";
import { Button, Glass, GlassSystemProvider, GlassThemeProvider, IconButton } from "open-glass-ui";
import "open-glass-ui/styles.css";
import "./theme.css";
import { collectPortals, installBridge, syncOverlayThemes } from "./bridge.jsx";
import { installMaterialMotion } from "./material-motion.jsx";
import { installSidebarMotion } from "./sidebar-motion.js";
import { SIDEBAR_GLYPHS } from "../sidebar-icons.js";
import { useButtonHover } from "./use-button-hover.js";

function ShellGlyph({ name }) {
  const glyph = SIDEBAR_GLYPHS[name];
  return <span className="symbol sidebar-symbol" data-icon={name} data-sidebar-icon="" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path className="sidebar-glyph-plane" d={glyph.body} />
      <path className="sidebar-glyph-body" d={glyph.body} />
      <g className="sidebar-glyph-detail"><path d={glyph.detail} /></g>
      <path className="sidebar-glyph-trace" d={glyph.detail} pathLength="1" />
      {glyph.open ? <path className="sidebar-glyph-open" d={glyph.open} /> : null}
    </svg>
  </span>;
}

function AppShell() {
  useButtonHover();
  return <>
    <a className="skip-link" href="#app">Skip to main content</a>
    <div className="shell">
      <Glass as="aside" material="frosted" className="side" aria-label="Wallets">
        <a className="logo" href="#" aria-label="Zigs home">
          <span className="nav-zebra" aria-hidden="true" />
          <span className="logo-word">Zigs</span>
        </a>
        <Button className="btn wallet-menu" id="wallet-menu" type="button" data-key="menu"
          aria-controls="side-nav" aria-expanded="false"><ShellGlyph name="menu" />Menu</Button>
        <nav id="side-nav" aria-label="Sections" />
        <div className="side-privacy" id="privacy-slot" />
        <div className="side-foot">
          <details className="browser-status" id="engine">
            <summary><span className="sidebar-status-mark"><ShellGlyph name="browser" />
              <span className="dot busy" id="engine-dot" /></span>
              <span>Browser status</span><ShellGlyph name="chevronDown" /></summary>
            <p id="engine-text">Loading crypto engine…</p>
          </details>
          <p className="side-note">Keys are made and used in this browser. <a href="https://zigs.app" target="_blank" rel="noopener">About Zigs</a></p>
        </div>
      </Glass>
      <main className="main">
        <div id="offline" role="status" />
        <div id="app" className="page" tabIndex={-1} />
      </main>
    </div>
    <div id="banner" hidden role="status"><span id="banner-text" />
      <IconButton className="icon-btn" id="banner-close" type="button" aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </IconButton>
    </div>
  </>;
}

const root = createRoot(document.getElementById("openglass-root"));
const syncMaterialMotion = installMaterialMotion(document.getElementById("openglass-root"));
const syncSidebarMotion = installSidebarMotion(document.getElementById("openglass-root"), animate);
let queued = false, drawing = false, last = "";
function refresh() {
  if (drawing) return;
  drawing = true;
  try {
    const portals = collectPortals();
    const appearance = document.documentElement.dataset.theme || "system";
    const signature = appearance + ":" + window.matchMedia("(prefers-color-scheme: dark)").matches
      + ":" + portals.map((entry) => entry.id).join(",");
    if (signature === last) { syncOverlayThemes(); syncMaterialMotion(); syncSidebarMotion(); return; }
    last = signature;
    flushSync(() => root.render(
      <GlassSystemProvider renderer="auto" theme={{ appearance: "system" }}>
        <GlassThemeProvider appearance={appearance} theme={{ preset: "neutral", glass: { rim: .65, highlight: .75, lensing: .45, shadow: .7, brightness: 1.25 } }} className="zigs-openglass">
          <AppShell />
          {portals.map((entry) => entry.portal)}
        </GlassThemeProvider>
      </GlassSystemProvider>,
    ));
    syncOverlayThemes();
    syncMaterialMotion();
    syncSidebarMotion();
  } finally { drawing = false; }
}
function schedule() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; refresh(); });
}
const bridge = installBridge(schedule);
bridge.flush = refresh;
// Motion is bundled locally. Native presenters retain ownership of their DOM and focus.
bridge.animate = animate;
refresh();
// The provider resolves system appearance after hydration. Native top-layer dialogs must
// follow that resolved palette as well as the document's explicit appearance preference.
new window.MutationObserver(syncOverlayThemes).observe(document.querySelector(".zigs-openglass"), {
  attributes: true, attributeFilter: ["data-ogui-appearance", "style"],
});
// Also cover cached views and overlays mounted outside the usual wallet draw loop.
new window.MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
new window.MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedule);

// Keep the existing module graph and crypto workers separate from the presentation bundle.
// A variable import is intentionally external to esbuild, preserving the CSP/worker URLs.
const walletEntry = "/network-privacy-demo-entry.js";
await import(walletEntry);
