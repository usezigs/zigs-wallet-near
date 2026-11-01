// The words and numbers of the Overview: the asset rows and the pending shortcut. Display only:
// nothing here approves, signs or sends. An amount that is not known shows as unknown, never as
// zero, except for the explicitly labelled presentation-only USD placeholder of a testnet wallet.
import { SWAP_ASSETS } from "./swap-preview-model.js";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** Display only. Unknown remains distinct from a confirmed zero; never a valuation source. */
export function formatUsdBalance(valuation) {
  const known = typeof valuation === "number" && Number.isFinite(valuation);
  const text = usd.format(known && valuation !== 0 ? valuation : 0);
  return { known, text, whole: text.slice(0, -3), fraction: text.slice(-3) };
}

/** The ZEC of the asset row in zatoshi: spendable plus incoming, or null before the first sync. */
export const zecTotal = (b) => (b ? b.spendable + b.pending : null);

export const PRICE_FRESH_MS = 5 * 60_000; // a price younger than this is reused
export const PRICE_RETRY_MS = 60_000; // the wait after a failed call
export const PRICE_TIMEOUT_MS = 15_000; // a call with no answer by then is a failed call
// A kept price older than this is dropped (the NEAR Intents terms allow at most 24 h).
export const PRICE_MAX_MS = 60 * 60_000;
const assetId = (key) => SWAP_ASSETS.find((a) => a.key === key).id;
// The withTimeout of app-kit.js, which a pure module cannot import (web/test/graph.mjs).
function within(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("no answer in " + ms + " ms")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
// The ask is fixed: exactly 1 ZEC in zatoshi, never an amount that depends on a wallet.
const PRICE_ASK = Object.freeze({ originAssetId: assetId("zec"),
  destinationAssetId: assetId("usdc"), amountAtomic: "100000000", slippageBps: 50 });

/**
 * The USD price of 1 ZEC for the Overview of a mainnet wallet, from one dry NEAR Intents quote of
 * 1 ZEC to USDC (1 USDC counts as 1 USD). It lives in memory for the page session. `ask()` calls
 * `provider.previewQuote` only when no call runs, no price is younger than 5 minutes and the last
 * failed call is at least 60 s old. A call fails after 15 s without an answer, and a price older
 * than 1 hour is dropped. `settled()` runs after each call, whatever its result.
 * ponytail: no timer. The Overview redraws about once a minute (the sync of the open wallet) and
 * each redraw calls `ask()`. Upgrade path: a shared fetch of the Worker for all page sessions.
 */
export function createZecPrice({ provider, now = () => Date.now(), settled = () => {},
  timeoutMs = PRICE_TIMEOUT_MS }) {
  let usdPerZec = null, at = null, failedAt = null, busy = false;
  const want = () => {
    const t = now();
    if (busy || (at !== null && t - at < PRICE_FRESH_MS)) return false;
    return failedAt === null || t - failedAt >= PRICE_RETRY_MS;
  };
  async function ask() {
    if (!want()) return;
    busy = true;
    try {
      const quote = await within(provider.previewQuote(PRICE_ASK), timeoutMs);
      const price = Number(quote.amountOut) / 1e6;
      if (!(price > 0)) throw new Error("no price");
      usdPerZec = price; at = now(); failedAt = null;
    } catch {
      failedAt = now();
    }
    busy = false;
    settled();
  }
  function read() {
    if (at !== null && now() - at > PRICE_MAX_MS) { usdPerZec = null; at = null; }
    return { usd: usdPerZec, at, failed: failedAt !== null };
  }
  return { ask, want, read };
}

/** The USD value of `zat` zatoshi at `usdPerZec` USD for 1 ZEC, or null when one is unknown. */
export const zecUsd = (zat, usdPerZec) => (zat === null || usdPerZec === null ? null
  : (zat / 1e8) * usdPerZec);

/** The age of a price in whole minutes or hours, as words. */
export function ageText(ms) {
  const min = Math.floor(Math.max(0, ms) / 60_000), hours = Math.floor(min / 60);
  if (min < 1) return "just now";
  if (min < 60) return min + (min === 1 ? " minute ago" : " minutes ago");
  return hours + (hours === 1 ? " hour ago" : " hours ago");
}

const NO_VALUE = {
  sync: { note: "Balance not synced yet", label: "USD value not available until the first sync" },
  wait: { note: "Price not available yet", label: "USD value not available yet" },
  failed: { note: "Price not available", label: "USD value not available" },
};
const QUOTE_FACTS = "1 USDC counts as 1 USD. The quote includes fees and spread. It is not a "
  + "market rate, and a swap can give another amount.";

/**
 * What the USD total of the Overview shows. `mainnet`: the wallet is on mainnet; `total`: zecTotal
 * or null; `price`: the read() of createZecPrice; `now`: the time in ms. A testnet wallet is a
 * demo ({demo: true}). A mainnet wallet is never a demo: `value` is null while the total or the
 * price is unknown, and `note` says why. `label` is the accessible name of the total, and `facts`
 * is the line that tells what the price is.
 * @returns {{demo: boolean, value?: object|null, label?: string, note?: string, facts?: string}}
 */
export function portfolioView({ mainnet, total, price, now }) {
  if (!mainnet) return { demo: true };
  if (total === null) return { demo: false, value: null, ...NO_VALUE.sync, facts: "" };
  if (price.usd === null) {
    return { demo: false, value: null, ...NO_VALUE[price.failed ? "failed" : "wait"], facts: "" };
  }
  const value = formatUsdBalance(zecUsd(total, price.usd));
  return { demo: false, value, label: "About " + value.text, facts: QUOTE_FACTS,
    note: "≈ Price of a NEAR Intents quote for 1 ZEC, " + ageText(now - price.at) };
}

// The row for each setup status of the Solana part (setupSummary of web/sol/view.js) but ready.
const SOL_STATES = {
  "not started": ["none", "Not added"], unavailable: ["unavailable", "Not available"],
  differs: ["differs", "Keys differ"], running: ["setup", "Setting up"],
  stopped: ["stopped", "Stopped"],
};

/**
 * The SOL asset row, or null when the wallet cannot have a Solana part.
 * @param {object} s on: the wallet can have the part; error: the module did not load; loading:
 *   the module loads or runs; setup: its setup summary (null until the module has read the
 *   Solana documents of the wallet); balance: the private balance text of the last sync, or
 *   null; sync: {text, busy} of that sync.
 * @returns {{state: string, text: string} | null}
 */
export function solRow({ on, error, loading, setup, balance, sync }) {
  if (!on) return null;
  if (error) return { state: "failed", text: "Did not load" };
  if (!setup) {
    return loading ? { state: "loading", text: "Loading…" } : { state: "idle", text: "Not open" };
  }
  if (setup.status !== "ready") {
    const [state, text] = SOL_STATES[setup.status] ?? ["unknown", "Unknown"];
    return { state, text };
  }
  return balanceRow(balance, sync ?? {});
}

// A balance carries the age of its sync: this page, a saved sync, an older one while a new sync
// runs, or an older one when the last sync failed.
function balanceRow(balance, { text = "", busy = false }) {
  if (balance == null) {
    return busy ? { state: "syncing", text: "Syncing…" }
      : { state: "unsynced", text: "Not synced yet" };
  }
  if (busy) return { state: "resync", text: balance };
  if (text.startsWith("failed")) return { state: "stale", text: balance };
  return { state: text.startsWith("saved") ? "saved" : "synced", text: balance };
}

/** The ZEC payments in progress, each counted once: open, waiting for their block, or held. */
export const zecInProgress = (open, flying, held) => new Set([...open, ...flying, ...held]).size;

/**
 * The pending shortcut to the Approvals inbox, or null when nothing is pending. zec: the ZEC
 * payments in progress (open, waiting for their block, or held by an approval here), each counted
 * once; sol: the Solana proposals that a seat of this browser can approve.
 * @returns {{count: number, text: string} | null}
 */
export function pendingShortcut({ zec, sol }) {
  if (!(zec + sol > 0)) return null;
  const text = [zec && zecLine(zec), sol && solLine(sol)].filter(Boolean).join(" ");
  return { count: zec + sol, text };
}
const zecLine = (n) => (n === 1 ? "1 Zcash payment is in progress."
  : n + " Zcash payments are in progress.");
const solLine = (n) => (n === 1 ? "1 Solana proposal waits for your approval."
  : n + " Solana proposals wait for your approval.");
