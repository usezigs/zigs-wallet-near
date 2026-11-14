// Connect the reusable chart to live wallet reads, the existing crypto engine and render lifecycle.
import { el } from "./app-dom.js";
import { state } from "./app-state.js";
import { Z } from "./app-engine.js";
import { gkeys } from "./app-keystore.js";
import { balanceNow, curChain, netName } from "./app-chain.js";
import { plainNotAdded, plainRead, plainShown, solMode, solNotAdded,
  solOn, solPortfolioHolding } from "./app-sol.js";
import { render } from "./app-loop.js";
import { appendObservation, PORTFOLIO_RANGES, valuePortfolio } from "./portfolio-model.js";
import { createPortfolioPrices } from "./portfolio-prices.js";
import { createPortfolioStore } from "./portfolio-store.js";
import { createPortfolioChart } from "./portfolio-chart.js";
import { presentOverviewDetails } from "./overview-popover.js";

const prices = createPortfolioPrices({ settled: () => render(),
  fetcher: (url, options) => globalThis.fetch(url, options) });
const slots = new WeakMap(), entered = new Set();
let active = null, range = "1M";
let rememberedRange = false;
function selectedRange() {
  if (!rememberedRange) {
    rememberedRange = true;
    try {
      const saved = globalThis.sessionStorage.getItem("zf-portfolio-range");
      if (PORTFOLIO_RANGES.includes(saved)) range = saved;
    } catch {}
  }
  return range;
}
function selectRange(next) {
  range = next;
  try { globalThis.sessionStorage.setItem("zf-portfolio-range", next); } catch {}
  refreshPortfolio();
}

// Saved balances without an observation time never become a historical observation today.
function liveHoldings() {
  const c = curChain(), b = c?.bal ? balanceNow(c.bal) : null;
  const zecKnown = b && !c.error && !c.syncing && c.bal.height >= c.bal.tip;
  const result = [{ asset: "zec", amount: zecKnown ? (b.spendable + b.pending) / 1e8 : null,
    at: zecKnown ? c.balAt ?? null : null }];
  if (plainShown() && !plainNotAdded()) {
    const read = plainRead();
    for (const asset of ["sol", "usdc"]) {
      const row = read?.rows[asset], known = row?.state === "ready" || row?.state === "off";
      result.push({ asset, amount: known ? (row.state === "off" ? 0 : Number(row.amount)) : null,
        at: known ? read.at : null });
    }
  } else if (solOn() && solMode() !== "plain" && !solNotAdded()) {
    result.push(solPortfolioHolding());
  }
  return result;
}

function memoryHistory() {
  let observations = [];
  return {
    record(next) { observations = appendObservation(observations, next); },
    read: () => ({ observations, note: "History is available this session. Unlock to save it." }),
    clearMemory() { observations = []; },
  };
}
function historyStore(gid, secret) {
  if (!Z || !secret) return memoryHistory();
  const context = "portfolio-v1\nmainnet\n" + gid;
  try {
    return createPortfolioStore({ storage: localStorage, key: "zf-portfolio-mainnet-" + gid,
      seal: (text) => Z.secretSeal(secret, context, text),
      open: (box) => Z.secretOpen(secret, context, box) });
  } catch { return memoryHistory(); }
}

/** A slot lets app-loop retain the actual chart node and active pointer across wallet redraws. */
export function portfolioOverview() {
  if (netName(state.g) !== "mainnet") return null;
  const slot = el("div", { class: "portfolio-slot" });
  slots.set(slot, { gid: state.gid, secret: gkeys[state.gid] });
  if (globalThis.document?.visibilityState !== "hidden") void prices.ask();
  return slot;
}

function refreshPortfolio() {
  if (!active) return;
  const now = Date.now(), read = prices.read();
  const current = valuePortfolio(liveHoldings(), read.prices, now);
  // Do not record a timestamp during a hidden/background redraw.
  if (document.visibilityState !== "hidden") active.store.record(current.observation);
  const history = active.store.read();
  const props = { ...history, current, now, range: selectedRange(), storageNote: history.note,
    loading: read.loading, failed: read.failed, priceError: read.error, retryAfterMs: read.retryAfterMs,
    onRange: selectRange, onRetry: () => { void prices.ask(); refreshPortfolio(); },
    onInteractionEnd: () => {
      if (active?.deferred) { active.deferred = false; render(); }
    } };
  if (active.chart) active.chart.update(props);
  else {
    active.chart = createPortfolioChart(props, { animateEntry: !entered.has(active.gid) });
    entered.add(active.gid);
    if (entered.size > 50) entered.delete(entered.values().next().value);
  }
}

// Background wallet updates must not disconnect a focused slider or captured pointer. Keep the
// connected view until interaction ends, while recording the fresh reads. The chart defers its
// geometry update during a scrub so the selected historical observation cannot jump.
export function keepPortfolioView(view) {
  const slot = view.querySelector(".portfolio-slot"), config = slot && slots.get(slot);
  if (!config || !active?.chart?.element.isConnected || !active.chart.interacting()) return false;
  if (active.gid !== config.gid || active.secret !== config.secret) return false;
  active.deferred = true; refreshPortfolio();
  return true;
}

/** Called after the app replaces its view. Closing, locking or switching wallets destroys all
 * chart listeners, observers, animation frames and decrypted observations of the old wallet. */
export function presentPortfolio(root) {
  const slot = root.querySelector(".portfolio-slot"), config = slot && slots.get(slot);
  if (!config || !active || active.gid !== config.gid || active.secret !== config.secret) {
    active?.chart?.destroy(); active?.store.clearMemory(); active = null;
  }
  if (!config) return;
  presentOverviewDetails(root.querySelector(".overview-page"));
  if (!active) active = { ...config, store: historyStore(config.gid, config.secret), chart: null };
  refreshPortfolio();
  slot.replaceChildren(active.chart.element);
  active.chart.mount();
}
