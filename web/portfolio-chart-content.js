// @ts-check
import { portfolioMoney, valueChange } from "./portfolio-model.js";
/** @typedef {import('./portfolio-types').PortfolioChartProps} Props */
/** @typedef {import('./portfolio-types').PortfolioObservation} Observation */
/** @typedef {import('./portfolio-geometry.js').Geometry} Geometry */
export const portfolioDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric",
  year: "numeric", hour: "2-digit", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const shortTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** @param {Props} props */
const noChange = (props) => ({ change: "", direction: "neutral", label: props.current.missing.length
  ? "Some assets are unavailable" : "Portfolio value change appears as history builds" });
/** @param {Observation|undefined} start @param {Observation|null|undefined} end
 * @param {number|null} value @param {number} count */
const comparable = (start, end, value, count) => !!start && !!end && value !== null
  && count > 1 && start.scope === end.scope;

/** @param {Props} props @param {Geometry} geometry
 * @param {Observation|undefined} point @param {number|null} value */
function changeContent(props, geometry, point, value) {
  const start = geometry.vertices[0]?.point, end = point ?? props.current.observation;
  if (!point && props.current.missing.length) return noChange(props);
  if (!comparable(start, end, value, geometry.vertices.length)) return noChange(props);
  const delta = valueChange(/** @type {Observation} */ (start).value,
    /** @type {number} */ (value));
  const percent = delta.percent === null ? ""
    : ` (${delta.sign}${Math.abs(delta.percent).toFixed(2)}%)`;
  return { change: delta.sign + portfolioMoney(Math.abs(delta.amount)) + percent,
    direction: delta.direction, label: "value change · since " + shortDate.format(start.at) };
}
/** @param {Observation|undefined} point @param {Props} props @param {Observation|undefined} last */
function headerDate(point, props, last) {
  if (point) return portfolioDate.format(point.at);
  if (props.current.value === null && last)
    return "Last recorded · " + portfolioDate.format(last.at);
  return "Current balance";
}
/** @param {Observation|undefined} point @param {Props} props @param {Observation|undefined} last */
const headerValue = (point, props, last) =>
  point?.value ?? props.current.value ?? last?.value ?? null;

/** @param {Props} props @param {Geometry} geometry @param {number} selected */
export function portfolioHeaderContent(props, geometry, selected) {
  const point = geometry.vertices[selected]?.point, last = geometry.vertices.at(-1)?.point;
  const value = headerValue(point, props, last), date = headerDate(point, props, last);
  return { value, date, ...changeContent(props, geometry, point, value) };
}

/** @param {Props} props @param {number} count */
function emptyContent(props, count) {
  const waiting = props.current.value === null && count === 0;
  if (waiting && props.loading) return { title: "Reading your portfolio",
    text: "Your recorded history stays on this device." };
  if (waiting && props.failed) return { title: "Market prices are unavailable",
    text: "Try again in a moment. Your saved history is safe." };
  if (props.observations.length > 0 && !count) return { title: "No observations in this range",
    text: "Choose a longer range to explore your recorded balances." };
  return { title: "Your history starts here",
    text: "As this wallet syncs, its observed value will take shape here." };
}

/** @param {Props} props @param {number} count */
function coverageContent(props, count) {
  if (props.failed) return "Price update failed. Showing available observations.";
  const missing = props.current.missing.map((id) => id.toUpperCase()).join(", ");
  if (missing) return missing + " balance or price unavailable · excluded from the current value.";
  if (count) return "Recorded since " + portfolioDate.format(props.observations[0].at)
    + " · observed values, including transfers";
  return "History begins with your first complete valuation.";
}

/** @param {Props} props @param {number} count */
export function portfolioStateContent(props, count) {
  return { ...emptyContent(props, count), coverage: coverageContent(props, count),
    partial: props.current.missing.length > 0 && props.current.value !== null,
    loading: props.loading && count === 0 && props.current.value === null };
}

/** @param {Props} props @param {Geometry} geometry */
export function portfolioEndpointContent(props, geometry) {
  const firstVertex = geometry.vertices[0], lastVertex = geometry.vertices.at(-1);
  if (!firstVertex || !lastVertex) return { first: "", last: "" };
  const first = firstVertex.point, last = lastVertex.point;
  const sameDay = new Date(first.at).toDateString() === new Date(last.at).toDateString();
  const format = props.range === "1D" || sameDay ? shortTime : shortDate;
  return { first: format.format(first.at),
    last: geometry.vertices.length > 1 ? format.format(last.at) : "" };
}
