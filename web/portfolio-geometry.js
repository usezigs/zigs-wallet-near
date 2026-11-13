// @ts-check
/** @typedef {import('./portfolio-types').PortfolioPoint} Point */
/** @typedef {{x:number, y:number, point:Point, breakBefore:boolean}} Vertex */
/** @typedef {{x:number,y:number,c1:number,c2:number,end:Vertex,start:Vertex}} Curve */
/** @typedef {{vertices:Vertex[], curves:Curve[], line:string, area:string,
 * width:number, height:number}} Geometry */
const n = (/** @type {number} */ value) => Number(value.toFixed(3));

/** Monotone cubic interpolation: no overshoot inventing peaks or negative portfolio values.
 * Padding keeps markers intact. Time is proportional; gaps retain their actual width.
 * @param {Point[]} points @param {number} width @param {number} height @returns {Geometry} */
export function portfolioGeometry(points, width, height) {
  const first = points[0]?.at ?? 0, last = points.at(-1)?.at ?? first;
  const min = Math.min(...points.map((p) => p.value), 0 === points.length ? 0 : Infinity);
  const max = Math.max(...points.map((p) => p.value), 0);
  const span = max - min, pad = span ? span * .12 : Math.max(Math.abs(max) * .05, 1);
  const low = min - pad, high = max + pad;
  const vertices = points.map((point) => ({ point, breakBefore: point.breakBefore,
    x: last === first ? width / 2 : 8 + (point.at - first) / (last - first) * (width - 16),
    y: 16 + (1 - (point.value - low) / (high - low)) * (height - 32) }));
  return geometryFromVertices(vertices, width, height);
}

/** @param {Vertex[]} vertices @param {number} width @param {number} height @returns {Geometry} */
export function geometryFromVertices(vertices, width, height) {
  /** @type {Curve[]} */
  const curves = [];
  let line = "", area = "", startX = 0;
  const slope = (/** @type {number} */ i) => {
    if (i < 0 || i >= vertices.length - 1 || vertices[i + 1].breakBefore) return null;
    const a = vertices[i], b = vertices[i + 1];
    return (b.y - a.y) / (b.x - a.x || 1);
  };
  const tangent = (/** @type {number} */ i) => {
    const a = slope(i - 1), b = slope(i);
    if (a === null) return b ?? 0;
    if (b === null) return a;
    if (a * b <= 0) return 0;
    return 2 * a * b / (a + b);
  };
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i];
    if (p.breakBefore || i === 0) {
      if (i) area += `L${n(vertices[i - 1].x)},${height}L${n(startX)},${height}Z`;
      startX = p.x;
      const move = `M${n(p.x)},${n(p.y)}`;
      line += move; area += move;
      continue;
    }
    const a = vertices[i - 1], dx = (p.x - a.x) / 3;
    const c1 = a.y + tangent(i - 1) * dx, c2 = p.y - tangent(i) * dx;
    const curve = `C${n(a.x + dx)},${n(c1)} ${n(p.x - dx)},${n(c2)} ${n(p.x)},${n(p.y)}`;
    line += curve; area += curve;
    curves.push({ x: a.x, y: a.y, c1, c2, start: a, end: p });
  }
  const last = vertices.at(-1);
  if (last) area += `L${n(last.x)},${height}L${n(startX)},${height}Z`;
  return { vertices, curves, line, area, width, height };
}

/** Exactly the cubic used to draw the SVG. Returns null inside unobserved gaps.
 * @param {Geometry} geometry @param {number} x */
export function portfolioY(geometry, x) {
  const exact = geometry.vertices.find((p) => Math.abs(p.x - x) < .001);
  if (exact) return exact.y;
  const c = geometry.curves.find((p) => p.start.x <= x && p.end.x >= x);
  if (!c) return null;
  const t = (x - c.x) / (c.end.x - c.x), u = 1 - t;
  return u ** 3 * c.y + 3 * u ** 2 * t * c.c1 + 3 * u * t ** 2 * c.c2 + t ** 3 * c.end.y;
}

/** @param {Geometry} before @param {Geometry} target @param {number} t */
export function morphPortfolio(before, target, t) {
  const vertices = target.vertices.map((p) => {
    const oldY = portfolioY(before, p.x / target.width * before.width) ?? p.y;
    return { ...p, y: oldY + (p.y - oldY) * t };
  });
  return geometryFromVertices(vertices, target.width, target.height);
}

/** @param {Vertex[]} vertices @param {number} x */
export function nearestPortfolioPoint(vertices, x) {
  let low = 0, high = vertices.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (vertices[mid].x < x) low = mid + 1; else high = mid;
  }
  if (low && Math.abs(vertices[low - 1].x - x) < Math.abs(vertices[low].x - x)) low--;
  return low;
}
