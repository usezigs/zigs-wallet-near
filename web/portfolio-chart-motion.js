// @ts-check
import { portfolioMoney } from "./portfolio-model.js";
import { morphPortfolio, portfolioGeometry, portfolioY } from "./portfolio-geometry.js";
import { chartSvg } from "./portfolio-chart-dom.js";
/** @typedef {typeof import('./portfolio-chart-dom.js').portfolioChartDom} DomFactory */
/** @typedef {import('./portfolio-geometry.js').Geometry} Geometry */
const ease = (/** @type {number} */ t) => 1 - (1 - t) ** 4;

/** Single animation clock for shape morphing, numeric settling and marker motion. */
export class PortfolioChartMotion {
  /** @param {ReturnType<DomFactory>} dom @param {()=>boolean} reduced
   * @param {(x:number)=>void} pointer */
  constructor(dom, reduced, pointer) {
    this.dom = dom; this.reduced = reduced; this.pointer = pointer;
    this.target = portfolioGeometry([], 600, 192); this.drawn = this.target;
    this.before = this.target;
    this.frame = 0; this.lastTime = 0; this.shapeStart = 0;
    this.shapeMoving = false; this.destroyed = false; this.selected = -1; this.markerX = 0;
    /** @type {number|null} */
    this.displayed = null;
    /** @type {number|null} */
    this.desired = null;
    /** @type {number|null} */
    this.pointerX = null;
  }
  queue() {
    if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame((t) => this.tick(t));
  }
  /** @param {Geometry} target */
  shape(target) {
    this.before = this.drawn; this.target = target; this.shapeStart = performance.now();
    this.shapeMoving = !this.reduced() && this.before.vertices.length > 1
      && target.vertices.length > 1;
    this.selected = -1; this.pointerX = null;
    if (!this.shapeMoving) this.finishShape();
    this.queue();
  }
  finishShape() { this.shapeMoving = false; this.drawn = this.target; this.paintGeometry(); }
  paintGeometry() {
    const { dom, drawn } = this;
    dom.line.setAttribute("d", drawn.line); dom.area.setAttribute("d", drawn.area);
    const end = drawn.vertices.at(-1);
    dom.end.style.display = end ? "" : "none";
    dom.end.setAttribute("cx", String(end?.x ?? 0));
    dom.end.setAttribute("cy", String(end?.y ?? 0));
    const isolated = drawn.vertices.filter((p, i, list) => (i === 0 || p.breakBefore)
      && (!list[i + 1] || list[i + 1].breakBefore));
    dom.dots.replaceChildren(...isolated.map((p) => chartSvg("circle", {
      cx: String(p.x), cy: String(p.y), r: "2.5", fill: "currentColor" })));
  }
  /** @param {number} dt */
  paintValue(dt) {
    let moving = false;
    if (this.desired === null || this.displayed === null) this.displayed = this.desired;
    else {
      const diff = this.desired - this.displayed;
      moving = !this.reduced() && Math.abs(diff) > .004;
      this.displayed = moving ? this.displayed + diff * (1 - Math.exp(-dt / 45)) : this.desired;
    }
    const text = portfolioMoney(this.displayed);
    if (this.dom.value.textContent !== text) this.dom.value.textContent = text;
    return moving;
  }
  /** @param {number} dt */
  paintMarker(dt) {
    const vertex = this.target.vertices[this.selected];
    if (!vertex) return false;
    const moving = !this.reduced() && Math.abs(this.markerX - vertex.x) > .05;
    const next = moving
      ? this.markerX + (vertex.x - this.markerX) * (1 - Math.exp(-dt / 32)) : vertex.x;
    this.markerX = portfolioY(this.drawn, next) === null ? vertex.x : next;
    const y = portfolioY(this.drawn, this.markerX) ?? vertex.y;
    this.dom.marker.setAttribute("cx", String(this.markerX));
    this.dom.marker.setAttribute("cy", String(y));
    this.dom.crosshair.setAttribute("x1", String(this.markerX));
    this.dom.crosshair.setAttribute("x2", String(this.markerX));
    return moving;
  }
  /** @param {number} time */
  tick(time) {
    this.frame = 0;
    const dt = Math.min(40, this.lastTime ? time - this.lastTime : 16); this.lastTime = time;
    if (this.pointerX !== null) {
      const x = this.pointerX; this.pointerX = null; this.pointer(x);
    }
    if (this.shapeMoving) {
      const t = Math.min(1, (time - this.shapeStart) / 300);
      this.drawn = morphPortfolio(this.before, this.target, ease(t));
      this.shapeMoving = t < 1; this.paintGeometry();
    }
    const valueMoving = this.paintValue(dt), markerMoving = this.paintMarker(dt);
    const moving = [this.shapeMoving, valueMoving, markerMoving].some(Boolean);
    this.dom.root.dataset.animating = String(moving);
    if (moving) this.queue();
  }
  destroy() { this.destroyed = true; cancelAnimationFrame(this.frame); }
}
