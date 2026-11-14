// @ts-check
import { positionOverviewPopover } from "./overview-popover.js";
let chartIds = 0;
/** @param {string} tag @param {string} className @param {string} [text] */
export function chartNode(tag, className, text = "") {
  const node = document.createElement(tag);
  node.className = className; node.textContent = text;
  return node;
}
/** @param {string} tag @param {Record<string,string>} [attributes] */
export function chartSvg(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
/** Build once: the pointer loop only writes the value, date and SVG attributes.
 * @param {readonly string[]} ranges */
export function portfolioChartDom(ranges) {
  const id = "portfolio-" + ++chartIds;
  const root = chartNode("section", "portfolio-chart");
  root.setAttribute("aria-label", "Portfolio value history");
  const heading = chartNode("div", "portfolio-chart-heading");
  const title = chartNode("h2", "portfolio-chart-title", "Total portfolio value");
  const unit = chartNode("span", "portfolio-chart-unit", "USD");
  heading.append(title, unit);
  const value = chartNode("p", "portfolio-chart-value", "—");
  const change = chartNode("p", "portfolio-chart-change");
  const changeValue = chartNode("span", "portfolio-change-value");
  const changeLabel = chartNode("span", "portfolio-change-label");
  change.append(changeValue, changeLabel);
  const date = chartNode("p", "portfolio-chart-date", "Current balance");
  const plot = chartNode("div", "portfolio-chart-plot");
  plot.setAttribute("role", "slider");
  plot.setAttribute("aria-label", "Explore portfolio history");
  plot.setAttribute("aria-describedby", id + "-help");
  plot.setAttribute("aria-valuemin", "0");
  const svg = chartSvg("svg", { "aria-hidden": "true", focusable: "false" });
  const defs = chartSvg("defs");
  const gradient = chartSvg("linearGradient", { id: id + "-fill", x1: "0", y1: "0",
    x2: "0", y2: "1" });
  gradient.append(chartSvg("stop", { offset: "0", "stop-color": "currentColor",
    "stop-opacity": ".13" }), chartSvg("stop", { offset: "1", "stop-color": "currentColor",
    "stop-opacity": "0" }));
  defs.append(gradient);
  const area = chartSvg("path", { class: "portfolio-chart-area", fill: `url(#${id}-fill)` });
  const line = chartSvg("path", { class: "portfolio-chart-line", fill: "none",
    "stroke-width": "2", stroke: "currentColor", "stroke-linecap": "round",
    "stroke-linejoin": "round" });
  const dots = chartSvg("g", { class: "portfolio-chart-dots" });
  const crosshair = chartSvg("line", { class: "portfolio-chart-crosshair", y1: "4",
    y2: "188", "stroke-width": "1" });
  const marker = chartSvg("circle", { class: "portfolio-chart-marker", r: "4",
    "stroke-width": "2" });
  const end = chartSvg("circle", { class: "portfolio-chart-end", r: "3" });
  svg.append(defs, area, line, dots, end, crosshair, marker);
  const empty = chartNode("div", "portfolio-chart-empty");
  const emptyTitle = chartNode("p", "portfolio-empty-title");
  const emptyText = chartNode("p", "portfolio-empty-text");
  const retry = /** @type {HTMLButtonElement} */ (
    chartNode("button", "portfolio-retry", "Try again"));
  retry.type = "button";
  empty.append(emptyTitle, emptyText);
  const endpoints = chartNode("div", "portfolio-chart-endpoints");
  const firstDate = chartNode("span", ""), lastDate = chartNode("span", "");
  endpoints.append(firstDate, lastDate);
  plot.append(svg, date, endpoints, empty);
  const controls = chartNode("div", "portfolio-chart-ranges");
  controls.setAttribute("role", "group"); controls.setAttribute("aria-label", "Chart time range");
  const indicator = chartNode("span", "portfolio-range-indicator");
  indicator.setAttribute("aria-hidden", "true");
  controls.append(indicator);
  const buttons = ranges.map((range) => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = range;
    button.dataset.range = range;
    controls.append(button); return button;
  });
  const coverage = chartNode("p", "portfolio-chart-coverage");
  const details = document.createElement("div");
  details.className = "portfolio-chart-method";
  const summary = document.createElement("button");
  summary.type = "button"; summary.setAttribute("aria-label", "About this chart");
  const infoIcon = chartSvg("svg", { viewBox: "0 0 24 24", width: "16", height: "16",
    fill: "none", stroke: "currentColor", "stroke-width": "1.5", "aria-hidden": "true" });
  infoIcon.append(chartSvg("circle", { cx: "12", cy: "12", r: "9" }),
    chartSvg("path", { d: "M12 11v6M12 7v1" }));
  summary.append(infoIcon);
  const methodBody = chartNode("div", "overview-detail-popover portfolio-method-body");
  methodBody.id = id + "-method";
  summary.setAttribute("popovertarget", methodBody.id);
  positionOverviewPopover(summary, methodBody);
  const coverageDetails = chartNode("p", "");
  const explanation = chartNode("p", "", "Value is the sum of each observed asset balance × its "
    + "USD market price. Value changes include deposits, withdrawals and fees; they are not "
    + "investment returns. Gaps and balance changes break the line. History starts when this "
    + "browser records the wallet and is saved encrypted on this device, up to 10,000 "
    + "observations. "
    + "Earlier holdings and offline activity cannot be reconstructed.");
  const attribution = chartNode("a", "", "Data provided by CoinGecko");
  attribution.setAttribute("href", "https://www.coingecko.com/en/api");
  attribution.setAttribute("target", "_blank");
  attribution.setAttribute("rel", "noopener noreferrer");
  const help = chartNode("p", "sr-only", "Use Left and Right arrows to explore observations. "
    + "Home and End select the first and last. Escape returns to the current value.");
  help.id = id + "-help";
  const storage = chartNode("p", "portfolio-chart-storage");
  const spoken = chartNode("span", "sr-only");
  spoken.setAttribute("role", "status"); spoken.setAttribute("aria-live", "polite");
  methodBody.append(coverageDetails, explanation, attribution);
  details.append(summary, methodBody);
  root.append(heading, value, change, plot, controls, coverage, retry, storage,
    details, help, spoken);
  return { root, value, changeValue, changeLabel, date, plot, svg, line, area, marker,
    crosshair, end, dots, empty, emptyTitle, emptyText, retry, firstDate, lastDate,
    controls, indicator, buttons, coverage, coverageDetails, storage, spoken, title, attribution };
}
