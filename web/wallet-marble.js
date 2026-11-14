// Public-address artwork only. One live renderer per visible identity; repeated marks share it.
import { walletArtEntry, walletArtImage } from "./wallet-art.js";

const controllers = new WeakMap();
const FRAME_MS = 1000 / 30, TURN_MS = 28000;

export function walletMarble(facts, { size = 64 } = {}) {
  const node = document.createElement("span");
  node.className = "wallet-marble";
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", "Wallet marble");
  node.setAttribute("data-art-state", facts ? "loading" : "unavailable");
  node.setAttribute("style", "--wallet-marble-size:" + size + "px");
  node.append(walletArtImage(facts, { size: [32, 48, 64, 96].includes(size) ? size : 96 }));
  const entry = walletArtEntry(facts);
  node._walletMarbleEntry = entry;
  node._walletMarbleSize = size;
  entry?.ready.then(() => {
    node.dataset.artState = entry.mode;
    if (entry.descriptor) {
      const { rarity } = entry.descriptor.traits;
      node.dataset.identityRarity = rarity;
      node.setAttribute("aria-label", rarity + " wallet marble");
      node.title = rarity;
    }
  });
  return node;
}

/** Reconcile every mark after native DOM replacement; identities retain their rotation. */
export function presentWalletMarble(doc = document) {
  let controller = controllers.get(doc);
  if (!controller) {
    if (!doc.querySelector(".wallet-marble")) return;
    controller = createMarbleController(doc); controllers.set(doc, controller);
  }
  controller.present();
}

function createMarbleController(doc) {
  const win = doc.defaultView;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  const forced = win.matchMedia("(forced-colors: active)");
  const identities = new Map(), hosts = new Map();
  let frame = 0, previous = 0, rendererModule;
  const observer = new win.IntersectionObserver((entries) => {
    for (const entry of entries) {
      const slot = hosts.get(entry.target);
      if (slot) slot.visible = entry.isIntersecting;
    }
    refresh();
  });
  const visible = (slot) => slot.host.isConnected && slot.visible && !doc.hidden
    && !forced.matches && !slot.host.closest("[inert],[hidden]");
  const stop = () => { win.cancelAnimationFrame(frame); frame = 0; previous = 0; };
  const release = (item) => {
    const studio = item.studio; item.studio = null; studio?.dispose();
    for (const slot of item.slots) slot.host.dataset.motion = "static";
  };
  function fail(item) {
    release(item); item.failed = true;
    for (const slot of item.slots) {
      slot.host.classList.remove("wallet-marble-live"); slot.host.dataset.motion = "static";
    }
  }
  function draw(item) {
    item.studio.draw(item.angle, Math.sin(item.angle) * .065);
    for (const slot of item.slots.filter(visible)) {
      if (!slot.context) continue;
      slot.context.clearRect(0, 0, slot.canvas.width, slot.canvas.height);
      slot.context.drawImage(item.studio.canvas, 0, 0, slot.canvas.width, slot.canvas.height);
      slot.host.classList.add("wallet-marble-live");
      slot.host.dataset.motion = reduced.matches ? "static" : "playing";
    }
  }
  async function prepare(item) {
    if (item.loading || item.failed) return;
    item.loading = true;
    try {
      await item.entry.ready;
      rendererModule ??= import("./dev/metal-orbs/renderer.js");
      const { createStudio } = await rendererModule;
      if (identities.get(item.entry) !== item || !item.slots.some(visible)) return;
      if (!item.entry.descriptor) { item.failed = true; return; }
      item.studio = createStudio({ size: item.size });
      const studio = item.studio;
      item.studio.setSculpture(item.entry.descriptor);
      item.studio.canvas.addEventListener("webglcontextlost", () => {
        if (identities.get(item.entry) === item && item.studio === studio) fail(item);
      }, { once: true });
      draw(item);
    } catch { fail(item); }
    finally { item.loading = false; if (item.studio) refresh(); }
  }
  function tick(now) {
    frame = 0;
    if (doc.hidden || forced.matches || reduced.matches) return;
    const elapsed = Math.min(previous ? now - previous : 0, 80);
    const due = !previous || now - previous >= FRAME_MS - 1;
    let playing = false;
    for (const item of identities.values()) {
      if (!item.studio || !item.slots.some(visible)) continue;
      playing = true;
      if (due) {
        item.angle = (item.angle + elapsed * Math.PI * 2 / TURN_MS) % (Math.PI * 2);
        try { draw(item); } catch { fail(item); }
      }
    }
    if (due) previous = now;
    if (playing) frame = win.requestAnimationFrame(tick);
  }
  function refresh() {
    stop();
    for (const item of identities.values()) {
      if (!item.slots.some(visible)) { release(item); continue; }
      if (item.failed) continue;
      if (!item.studio) void prepare(item);
      else try { draw(item); } catch { fail(item); }
    }
    if (!doc.hidden && !reduced.matches && !forced.matches
      && [...identities.values()].some((item) => item.studio && item.slots.some(visible)))
      frame = win.requestAnimationFrame(tick);
  }
  function present() {
    for (const [host, slot] of hosts) if (!host.isConnected) {
      observer.unobserve(host); slot.canvas.remove(); hosts.delete(host);
    }
    for (const item of identities.values()) item.slots = [];
    for (const host of doc.querySelectorAll(".wallet-marble")) {
      const entry = host._walletMarbleEntry;
      if (!entry) continue;
      let slot = hosts.get(host);
      if (!slot) {
        const canvas = doc.createElement("canvas");
        const size = Math.min(512, Math.ceil(host._walletMarbleSize * Math.min(win.devicePixelRatio || 1, 2)));
        canvas.width = canvas.height = size; canvas.setAttribute("aria-hidden", "true");
        const box = host.getBoundingClientRect();
        slot = { host, canvas, context: canvas.getContext("2d"),
          visible: box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < win.innerHeight };
        hosts.set(host, slot); host.append(canvas); observer.observe(host);
      }
      let item = identities.get(entry);
      if (!item) {
        item = { entry, slots: [], size: 0, studio: null, angle: 0, failed: false, loading: false };
        identities.set(entry, item);
      }
      item.slots.push(slot);
      if (slot.canvas.width > item.size) {
        release(item); item.size = slot.canvas.width;
      }
    }
    for (const [entry, item] of identities) if (!item.slots.length) {
      identities.delete(entry); release(item);
    }
    refresh();
  }
  doc.addEventListener("visibilitychange", refresh);
  reduced.addEventListener("change", refresh); forced.addEventListener("change", refresh);
  win.addEventListener("pagehide", () => {
    stop();
    for (const item of identities.values()) release(item);
  });
  win.addEventListener("pageshow", refresh);
  return { present };
}
