// Existing protocol checks inspect values across the receive, Settings and Security destinations.
// User-visible receive behavior and routing are covered separately by sol-receive.mjs.
import { solDetailsView, solView } from "../sol/view.js";
import { plainDetailsView, plainView } from "../sol/plain/view.js";
import { agreement } from "../sol/ceremony.js";
import { stopOf } from "../sol/secrets.js";

export function solSurfaces(c, act, actions) {
  const host = { ...c.host, openSolDetails: c.host.openSolDetails ?? (() => {}) };
  const ctx = { ...c, host };
  const ready = agreement(ctx).state === "agree" && !stopOf(ctx);
  return host.el("div", {}, solView(ctx, act, actions),
    ...(ready ? [solDetailsView(ctx, act, actions, "settings"),
      solDetailsView(ctx, act, actions, "security")] : []));
}

export function plainSurfaces(c, act, actions) {
  const host = { ...c.host, openSolDetails: c.host.openSolDetails ?? (() => {}) };
  const ctx = { ...c, host };
  const ready = agreement(ctx).state === "agree" && !stopOf(ctx);
  return host.el("div", { class: "sol-test-surfaces" }, plainView(ctx, act, actions),
    ...(ready ? [plainDetailsView(ctx, act, actions, "settings"),
      host.el("details", {}, host.el("summary", {}, "Public account disclosures"),
        plainDetailsView(ctx, act, actions, "security"))] : []));
}

export function appendPlainDestinations(t, view) {
  const p = t.plainSol, c = p?.ctl;
  if (t.ui.tab !== "solana" || !c || c.gid !== t.state.gid
    || agreement(c).state !== "agree" || stopOf(c)) return view;
  const actions = { backup: t.solBackup,
    check: (seat) => t.openBackupCheck(seat, "sol"), restoreFile: t.restore };
  return c.host.el("div", { class: "sol-test-surfaces" }, view,
    p.details("settings", t.act, actions),
    c.host.el("details", {}, c.host.el("summary", {}, "Public account disclosures"),
      p.details("security", t.act, actions)));
}
