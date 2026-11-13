// @ts-check
import { PORTFOLIO_RANGES, portfolioMoney, portfolioPoints,
  samplePortfolio } from "./portfolio-model.js";
import { nearestPortfolioPoint, portfolioGeometry } from "./portfolio-geometry.js";
import { portfolioChartDom } from "./portfolio-chart-dom.js";
import { PortfolioChartMotion } from "./portfolio-chart-motion.js";
import { portfolioEndpointContent, portfolioHeaderContent,
  portfolioStateContent } from "./portfolio-chart-content.js";
import { bindPortfolioInteraction } from "./portfolio-interaction.js";
/** @typedef {import('./portfolio-types').PortfolioChartProps} Props */
/** @typedef {import('./portfolio-types').PortfolioRange} Range */
const HEIGHT = 192;

class PortfolioChart {
  /** @param {Props} props @param {boolean} animateEntry */
  constructor(props, animateEntry) {
    this.props = props; this.animateEntry = animateEntry; this.hasEntered = false;
    this.dom = portfolioChartDom(PORTFOLIO_RANGES);
    this.media = matchMedia("(prefers-reduced-motion: reduce)");
    this.width = 600; this.selected = -1; this.signature = "";
    this.retryTimer = 0; this.retryUntil = 0;
    /** @type {Props|null} */
    this.pendingProps = null;
    this.measure = document.createElement("canvas").getContext("2d");
    this.abort = new AbortController();
    this.motion = new PortfolioChartMotion(this.dom, () => this.media.matches, (x) => {
      const width = this.dom.plot.getBoundingClientRect().width || this.width;
      if (this.motion.target.vertices.length) this.select(nearestPortfolioPoint(
        this.motion.target.vertices, x * this.motion.target.width / width));
    });
    this.interaction = bindPortfolioInteraction(this.dom.plot, {
      selectX: (x) => { this.motion.pointerX = x; this.motion.queue(); },
      reset: () => this.reset(), enabled: () => this.motion.target.vertices.length > 0,
      key: (key) => this.key(key),
    });
    this.observer = new ResizeObserver((entries) => {
      const next = Math.max(160, Math.round(entries[0].contentRect.width));
      if (next !== this.width) this.resize(next);
    });
    this.media.addEventListener("change", () => {
      if (this.media.matches) this.motion.finishShape();
      this.updateHeader();
    }, { signal: this.abort.signal });
    this.bindRanges();
    this.dom.root.addEventListener("focusout", () => queueMicrotask(() => {
      if (!this.motion.destroyed && !this.dom.root.contains(document.activeElement))
        this.props.onInteractionEnd?.();
    }), { signal: this.abort.signal });
    this.dom.retry.addEventListener("click", () => this.props.onRetry(),
      { signal: this.abort.signal });
    this.update(props);
    void document.fonts.ready.then(() => { if (!this.motion.destroyed) this.fitValue(); });
  }
  /** Keep the selected observation stable while the viewport itself changes.
   * @param {number} width */
  resize(width) {
    const at = this.motion.target.vertices[this.selected]?.point.at;
    this.width = width; this.rebuildGeometry();
    this.selected = this.motion.target.vertices.findIndex((vertex) => vertex.point.at === at);
    this.motion.selected = this.selected; this.updateHeader(); this.fitValue();
  }
  bindRanges() {
    this.dom.buttons.forEach((button, index) => {
      button.addEventListener("click", () => this.props.onRange(
        /** @type {Range} */ (button.dataset.range)), { signal: this.abort.signal });
      button.addEventListener("keydown", (ev) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
        ev.preventDefault();
        const at = ev.key === "Home" ? 0 : ev.key === "End" ? 5
          : (index + (ev.key === "ArrowLeft" ? 5 : 1)) % 6;
        this.dom.buttons[at].focus(); this.dom.buttons[at].click();
      }, { signal: this.abort.signal });
    });
  }
  updateHeader() {
    const { dom, motion } = this;
    const content = portfolioHeaderContent(this.props, motion.target, this.selected);
    motion.desired = content.value;
    dom.date.textContent = content.date;
    dom.root.dataset.scrubbing = String(this.selected >= 0);
    dom.root.dataset.direction = content.direction;
    dom.value.setAttribute("aria-label", portfolioMoney(content.value));
    dom.changeValue.textContent = content.change; dom.changeLabel.textContent = content.label;
    dom.plot.setAttribute("aria-valuenow", String(this.selected < 0
      ? Math.max(0, motion.target.vertices.length - 1) : this.selected));
    dom.plot.setAttribute("aria-valuetext", content.value === null ? "No observations"
      : portfolioMoney(content.value) + ", " + content.date);
    motion.queue();
  }
  /** @param {number} index @param {boolean} [speak] */
  select(index, speak = false) {
    if (index === this.selected) return;
    this.selected = index; this.motion.selected = index; this.updateHeader();
    if (speak) this.dom.spoken.textContent = this.dom.plot.getAttribute("aria-valuetext");
  }
  reset() {
    this.motion.pointerX = null; this.select(-1);
    const pending = this.pendingProps;
    this.pendingProps = null;
    if (pending) this.update(pending);
    this.props.onInteractionEnd?.();
  }
  fitValue() {
    if (!this.measure) return;
    const value = this.dom.value, styles = getComputedStyle(value);
    const base = parseFloat(styles.getPropertyValue("--portfolio-balance-base")) || 46;
    const values = this.props.observations.map((p) => p.value);
    const largest = Math.max(this.props.current.value ?? 0, ...values);
    this.measure.font = `${styles.fontWeight} ${base}px ${styles.fontFamily}`;
    const measured = this.measure.measureText(portfolioMoney(largest)).width;
    const fitted = Math.min(base, base * (this.width - 4) / Math.max(1, measured));
    value.style.fontSize = Math.max(12, fitted).toFixed(2) + "px";
  }
  updateRetry() {
    const remaining = Math.max(0, this.retryUntil - performance.now());
    this.dom.retry.disabled = this.props.loading || remaining > 0;
    this.dom.retry.textContent = this.props.loading ? "Retrying…" : remaining > 0
      ? `Try again in ${Math.ceil(remaining / 1000)}s` : "Try again";
    if (this.props.failed && remaining > 0) this.retryTimer = window.setTimeout(
      () => this.updateRetry(), Math.min(1000, remaining));
  }
  /** @param {string} key */
  key(key) {
    if (key === "Escape") { this.reset(); return; }
    const last = this.motion.target.vertices.length - 1;
    const at = this.selected < 0 ? last : this.selected;
    const index = key === "Home" ? 0 : key === "End" ? last
      : Math.max(0, Math.min(last, at + (key === "ArrowLeft" ? -1 : 1)));
    this.select(index, true);
  }
  rebuildGeometry() {
    const { props, dom } = this;
    const points = samplePortfolio(portfolioPoints(props.observations, props.range, props.now));
    const key = [props.range, this.width, points.length,
      points.map((p) => p.at + ":" + p.value + ":" + p.breakBefore).join(",")].join("|");
    if (key === this.signature) return;
    this.signature = key; this.selected = -1;
    this.motion.shape(portfolioGeometry(points, this.width, HEIGHT));
    dom.svg.setAttribute("viewBox", `0 0 ${this.width} ${HEIGHT}`);
    dom.svg.setAttribute("width", String(this.width));
    dom.svg.setAttribute("height", String(HEIGHT));
    const dates = portfolioEndpointContent(props, this.motion.target);
    dom.firstDate.textContent = dates.first; dom.lastDate.textContent = dates.last;
    dom.plot.tabIndex = points.length ? 0 : -1;
    dom.plot.setAttribute("aria-disabled", String(!points.length));
    dom.plot.setAttribute("aria-valuemax", String(Math.max(0, points.length - 1)));
    if (!this.hasEntered && points.length > 1) {
      dom.root.classList.toggle("portfolio-enter", this.animateEntry && !this.media.matches);
      this.hasEntered = true;
    }
  }
  paintState() {
    const { dom, props } = this, count = this.motion.target.vertices.length;
    const content = portfolioStateContent(props, count);
    dom.root.dataset.history = count > 1 ? "ready" : count ? "single" : "empty";
    dom.root.dataset.loading = String(content.loading);
    dom.empty.hidden = count > 1; dom.emptyTitle.textContent = content.title;
    dom.emptyText.textContent = content.text; dom.retry.hidden = !props.failed;
    dom.title.textContent = content.partial ? "Partial portfolio value" : "Total portfolio value";
    dom.coverage.textContent = content.coverage;
    dom.storage.textContent = props.storageNote; dom.storage.hidden = !props.storageNote;
    clearTimeout(this.retryTimer);
    this.retryUntil = performance.now() + (props.retryAfterMs ?? 0);
    this.updateRetry();
  }
  /** @param {Props} props */
  update(props) {
    if (this.selected >= 0 && props.range === this.props.range) {
      this.pendingProps = props; return;
    }
    this.props = props; this.rebuildGeometry(); this.paintState(); this.updateHeader();
    this.fitValue();
    this.dom.buttons.forEach((button) => button.setAttribute("aria-pressed",
      String(button.dataset.range === props.range)));
    const index = PORTFOLIO_RANGES.indexOf(props.range);
    this.dom.indicator.style.transform = `translateX(${index * 100}%)`;
  }
  destroy() {
    this.motion.destroy(); this.observer.disconnect(); this.interaction.destroy();
    this.abort.abort();
    clearTimeout(this.retryTimer);
    this.dom.root.remove();
  }
}

/** Framework-independent live component. Scrubbing never invokes the application's render loop.
 * @param {Props} props @param {{animateEntry?:boolean}} [options] */
export function createPortfolioChart(props, { animateEntry = true } = {}) {
  const chart = new PortfolioChart(props, animateEntry);
  return { element: chart.dom.root, mount: () => chart.observer.observe(chart.dom.plot),
    update: (/** @type {Props} */ next) => chart.update(next), destroy: () => chart.destroy(),
    interacting: () => chart.selected >= 0 || chart.interaction.active()
      || chart.dom.root.contains(document.activeElement) };
}
