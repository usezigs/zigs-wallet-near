// Read-only adaptation of existing local address-verification facts. Art never grants readiness.
import { ready, state } from "./app-state.js";
import { myVerified } from "./app-dkg.js";
import { mySeatSecrets } from "./app-keystore.js";
import { el } from "./app-dom.js";
import { walletArtEntry } from "./wallet-art.js";
import { walletMarble } from "./wallet-marble.js";

export function walletArtFacts(g = state.g) {
  if (!g || g.unreadable || g.networkMoved) return null;
  const open = g.id === state.gid, w = open ? state.wallet : ready[g.id];
  if (!w?.address || !w.birthday || w.network !== (g.network || "testnet")) return null;
  const verified = open ? myVerified() : mySeatSecrets(g.id).some(([, s]) =>
    s.checkedWallet === JSON.stringify(w));
  return verified ? { address: w.address, network: w.network, verified: true } : null;
}

export const walletMark = (g = state.g, size = 48) => walletMarble(walletArtFacts(g), { size });

// Document-local presentation memory only: no wallet fields, tutorial cursor or persisted flag.
const reveals = new Map();
export function walletReveal(g, onContinue) {
  const facts = walletArtFacts(g);
  if (!facts) return null;
  const key = JSON.stringify([facts.network, facts.address]);
  let visit = reveals.get(key);
  if (visit?.dismissed) return null;
  if (!visit) { visit = { started: performance.now(), dismissed: false, settled: false }; reveals.set(key, visit); }
  const entry = walletArtEntry(facts);
  const dismiss = () => { visit.dismissed = true; onContinue(); };
  const scene = el("div", { class: "wallet-reveal-scene" },
    el("span", { class: "wallet-reveal-studio", "aria-hidden": "true" }),
    el("div", { class: "wallet-reveal-orb" }, walletMarble(facts, { size: 192 })),
    el("span", { class: "wallet-reveal-halo", "aria-hidden": "true" }));
  const reveal = el("section", { class: "wallet-reveal surface-quiet", "aria-labelledby": "wallet-reveal-title",
    "data-key": "wallet-reveal", tabindex: "-1" },
    scene,
    el("div", { class: "wallet-reveal-copy" }, el("h2", { id: "wallet-reveal-title" }, "Meet your new wallet"),
      el("p", { class: "wallet-reveal-name" }, g.name),
      el("p", { class: "small muted" }, "The same visual identity on every device")),
    el("p", { class: "wallet-identity-rarity", "data-identity-rarity": "loading" }),
    el("p", { class: "small muted wallet-reveal-traits" }, "Your wallet’s visual identity"),
    el("div", { class: "wallet-reveal-actions" },
      el("button", { class: "btn primary", type: "button", "data-key": "wallet-reveal-continue", onclick: dismiss },
        "Continue to backup options")),
    el("details", { class: "wallet-art-explanation" }, el("summary", {}, "How your marble is made"),
      el("p", { class: "small muted" }, "Your verified public Zcash address and network choose the shape and metal finish using SHA-256. Renaming this wallet or adding Solana keeps its image. This visual aid never replaces the full code or address checks."),
      el("p", { class: "small muted" }, "Your address also selects one of four artwork tiers: Common Identity, Uncommon Identity, Rare Identity or Epic Identity. The same tier appears on every device."),
      el("p", { class: "small muted" }, "Approximately one in twenty generated identities has an orange Ember inlay. Artwork is rendered locally; simpler graphics are used when 3D rendering is unavailable.")));
  reveal._walletRevealVisit = visit;
  const describe = () => {
    const traits = entry.descriptor?.traits;
    const rarity = reveal.querySelector(".wallet-identity-rarity");
    rarity.textContent = traits?.rarity || "";
    rarity.dataset.identityRarity = traits?.rarity.split(" ")[0].toLowerCase() || "unavailable";
    reveal.querySelector(".wallet-reveal-traits").textContent = traits
      ? traits.sculpture + " · " + traits.metal + (traits.rare ? " · Ember inlay" : "")
      : "Artwork unavailable · your wallet and backup options are ready";
  };
  // Cached artwork may already be ready before this node is mounted.
  if (entry.descriptor) describe(); else entry.ready.then(describe);
  return reveal;
}

/** Resumes one decorative timeline across the app's ordinary DOM redraws. */
export function presentWalletReveal(doc) {
  if (!revealDocuments.has(doc)) {
    revealDocuments.add(doc);
    const settle = () => {
      const current = doc.querySelector(".wallet-reveal");
      if (current?._walletRevealVisit) current._walletRevealVisit.settled = true;
      current?.classList.remove("wallet-reveal-playing");
    };
    doc.addEventListener("visibilitychange", () => { if (doc.hidden) settle(); });
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
      .addEventListener?.("change", (event) => { if (event.matches) settle(); });
  }
  const node = doc.querySelector(".wallet-reveal"), visit = node?._walletRevealVisit;
  if (!visit) return;
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (doc.hidden || reduced) visit.settled = true;
  const elapsed = performance.now() - visit.started;
  node.style.setProperty("--wallet-reveal-offset", -Math.min(elapsed, 1400) + "ms");
  node.classList.toggle("wallet-reveal-playing", !visit.settled && elapsed < 1400);
}
const revealDocuments = new WeakSet();
