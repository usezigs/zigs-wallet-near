// Original Zigs vector objects, inspired by Vitrum's bevels and studio-lit materials.
// Fixed local geometry only. No WebGL, image requests, wallet data or animation loop.
const SVG = "http://www.w3.org/2000/svg";
let sequence = 0;

const shape = (d, material = "body", depth = true) => ({ d, material, depth });
const line = (d, width = 2, material = "metal") => ({ d, width, material });
const OBJECTS = Object.freeze({
  phone: [
    shape("M34 12 61 8Q68 7 68 15V78Q68 85 61 86L34 90Q27 91 27 83V21"
      + "Q27 13 34 12Z", "metal"),
    shape("M32 23 63 19V73L32 77Z", "body", false),
    line("M42 17 53 15.5", 1.5, "side"),
    line("M42 82 53 80.5", 1.5, "side"),
    line("M29 27V72", .7),
  ],
  laptop: [
    shape("M16 23 71 15Q77 14 77 21V63L16 72Q11 73 11 67V30Q11 24 16 23Z", "metal"),
    shape("M16 29 72 21V60L16 68Z", "body", false),
    shape("M11 72 77 63 91 76Q92 78 88 79L21 89Q17 90 13 87L3 80Q0 77 5 75Z", "metal"),
    shape("M21 73 69 66 79 74 29 82Z", "body", false),
    line("M18 86 86 76", .8),
    line("M42 82 57 80", 1, "side"),
  ],
  chat: [
    shape("M36 31 76 26Q81 25 81 31V60Q81 65 76 66L64 67 50 79V69L36 71Z"),
    shape("M16 24Q16 19 22 18L62 13Q68 12 68 18V50Q68 55 62 56L38 59 23 73V61"
      + "L22 61Q16 62 16 56Z"),
    line("M23 25 61 20", 1),
    line("M28 34 55 31M28 43 46 41", 3, "accent"),
    line("M55 60 73 58V39", 1),
  ],
  addressBook: [
    shape("M28 18 66 12Q72 11 73 18L79 70Q80 77 73 78L34 84Z", "metal"),
    shape("M22 17 60 11Q66 10 67 17L73 70Q74 76 68 77L28 83Q23 84 22 78L16 25"
      + "Q15 19 22 17Z"),
    line("M27 21 33 76", 1),
    line("M13 32 23 30M15 47 25 45M17 62 27 60", 3),
    shape("M47 29a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z", "accent", false),
    shape("M36 61V58a12 12 0 0 1 24-2V58Z", "metal", false),
    line("M38 70 61 66", 1),
  ],
  devices: [
    shape("M16 17 60 12Q66 11 66 17V52Q66 57 60 58L16 63Q10 64 10 58V23"
      + "Q10 18 16 17Z", "metal"),
    shape("M16 23 60 18V50L16 55Z", "body", false),
    line("M24 65 24 71 47 68V62M17 74 53 70", 2),
    shape("M58 39 77 36Q82 35 82 41V77Q82 82 77 83L58 86Q53 87 53 81V45"
      + "Q53 40 58 39Z"),
    shape("M59 46 76 43V72L59 75Z", "accent", false),
    line("M65 80 71 79", 1.5),
    line("M27 33 36 39 48 27", 2),
  ],
  security: [
    shape("M46 11C56 18 65 21 76 21V46C76 64 63 77 46 85"
      + "C29 77 16 64 16 46V21C27 21 36 18 46 11Z", "metal"),
    shape("M46 19C54 24 62 27 68 27V46C68 60 58 71 46 78"
      + "C34 71 24 60 24 46V27C30 27 38 24 46 19Z", "body", false),
    line("M30 31V45C30 56 37 65 46 71", 1),
    shape("M46 34a7 7 0 0 1 4 13L52 59H40L42 47a7 7 0 0 1 4-13Z",
      "accent", false),
  ],
  approvals: [
    shape("M30 25 69 18Q76 17 76 24V65Q76 71 70 72L30 79Z", "metal"),
    shape("M20 19 59 12Q66 11 66 18V59Q66 65 60 66L21 73Q15 74 15 67V26"
      + "Q15 20 20 19Z"),
    line("M23 27 56 21", 1),
    line("M28 45 37 53 54 33", 4, "accent"),
    line("M28 62 52 58", 1.5),
  ],
  activity: [
    shape("M25 14 63 9Q68 8 69 14L75 69 68 66 63 74 56 70 50 78 43 74 37 82"
      + "L30 78 24 85 17 24Q16 16 25 14Z", "metal"),
    shape("M26 23 59 18 60 26 27 31Z", "body", false),
    line("M29 41 57 36M30 50 49 47M31 60 43 58", 2.5, "body"),
    shape("M67 48a18 18 0 1 1 0 36 18 18 0 0 1 0-36Z", "body"),
    line("M67 56V67L74 70", 2.5, "accent"),
  ],
  lock: [
    line("M30 45V30a16 16 0 0 1 32 0V41", 10, "side"),
    line("M28 42V27a16 16 0 0 1 32 0V39", 7),
    shape("M22 41 67 34Q74 33 74 40V72Q74 78 68 79L24 86Q17 87 17 80V48"
      + "Q17 42 22 41Z"),
    line("M25 48 65 42", 1),
    shape("M46 53a5 5 0 0 1 3 9L50 71 42 72 43 63a5 5 0 0 1 3-10Z",
      "accent", false),
  ],
  wallet: [
    shape("M24 22 62 13Q68 12 69 19L72 42 27 52Z", "metal"),
    shape("M32 20 63 16 66 30 35 36Z", "accent", false),
    shape("M18 36 68 27Q75 26 75 33V72Q75 78 68 79L20 87Q13 88 13 81V44"
      + "Q13 38 18 36Z"),
    line("M21 43 66 35M21 78 65 71", 1),
    shape("M59 48 80 44V64L59 68Q54 69 54 63V55Q54 49 59 48Z", "metal"),
    shape("M65 54a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z", "body", false),
  ],
  key: [
    shape("M55 12a23 23 0 1 1-7 44L32 75H24V84H13V72L36 45A23 23 0 0 1 55 12Z",
      "metal"),
    shape("M59 24a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z", "body", false),
    line("M21 73 42 49", 2, "body"),
    line("M44 24a16 16 0 0 1 13-7", 1.5),
  ],
  swap: [
    shape("M21 28 61 21V11L82 29 61 54V42L21 49Q15 50 15 44V35Q15 29 21 28Z",
      "metal"),
    shape("M71 61 32 68V56L11 81 32 95V86L71 79Q77 78 77 72V66Q77 60 71 61Z",
      "accent"),
    line("M23 34 61 27", 1),
  ],
});

function node(tag, attrs) {
  const result = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, value);
  return result;
}

const COLORS = Object.freeze({
  body: ["#777f82", "#363e42", "#1c2328", "#3e484d"],
  side: ["#4b5459", "#13191d", "#090e11", "#586368"],
  metal: ["#f2f6f5", "#9da9ab", "#e0e7e6", "#68777b", "#c3cecc"],
  accent: ["#dfede7", "#abcbbb", "#6e9e8b", "#c2e0d0"],
});

function materials(id) {
  const defs = node("defs", {});
  for (const [name, stops] of Object.entries(COLORS)) {
    const gradient = node("linearGradient", { id: id + "-" + name,
      x1: "0", y1: "0", x2: ".7", y2: "1" });
    stops.forEach((color, i) => gradient.append(node("stop", {
      offset: String(i / (stops.length - 1)), "stop-color": color,
    })));
    defs.append(gradient);
  }
  return defs;
}

function objectPart(part, id, index) {
  const group = node("g", { class: "object-part object-part-" + index });
  if (part.depth) group.append(node("path", { d: part.d,
    fill: "url(#" + id + "-side)", transform: "translate(3 4)",
    stroke: "#788589", "stroke-width": ".5", class: "object-depth" }));
  const paint = "url(#" + id + "-" + part.material + ")";
  group.append(node("path", { d: part.d, fill: part.width ? "none" : paint,
    stroke: part.width ? paint : "var(--object-edge, #dbe9e280)",
    "stroke-width": part.width || ".7", class: part.width ? "object-line" : "object-face",
    "data-material": part.material }));
  return group;
}

/** Decorative, finite vector object. Adjacent text supplies all meaning and status. */
export function sculptedIcon(name) {
  if (!Object.hasOwn(OBJECTS, name)) throw new Error("app-icons: no object named " + name);
  const span = document.createElement("span"), id = "zigs-object-" + ++sequence;
  span.className = "symbol symbol-sculpted icon-object";
  span.setAttribute("aria-hidden", "true");
  span.setAttribute("data-icon", name);
  const svg = node("svg", { viewBox: "0 0 100 100", fill: "none", focusable: "false",
    "stroke-linejoin": "round", "stroke-linecap": "round" });
  svg.append(materials(id));
  svg.append(node("ellipse", { cx: "51", cy: "92", rx: "29", ry: "2.5",
    fill: "currentColor", opacity: ".1", class: "object-ground" }));
  OBJECTS[name].forEach((part, i) => svg.append(objectPart(part, id, i)));
  span.append(svg);
  return span;
}
