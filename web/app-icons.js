// Small interface symbols use fixed stroked paths. Asset marks use the official, locally
// bundled artwork; sources and trademark terms are recorded in assets/README.md. No artwork
// comes from a wallet document, a person or a remote request.
export { sculptedIcon } from "./icon-objects.js";
const PATHS = Object.freeze({
  home: "M3 10.5 12 3l9 7.5M5 9v12h5v-7h4v7h5V9",
  wallet: "M4 6h15v14H4zM4 6V4h12v2M15 11h6v5h-6zM17 13.5h.01",
  approvals: "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  activity: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  chat: "M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v4Z",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  info: "M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  security: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  unshield: "m9 4 3-1 8 3v6c0 2-1.5 4-3.3 5.6M14 20.1c-1.2.6-2 .9-2 .9s-8-4-8-9V6l2.6-1M3 3l18 18",
  addressBook: "M5 3h15v18H5zM2 7h4M2 12h4M2 17h4M12 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
    + "m-3 10v-1a3 3 0 0 1 6 0v1",
  swap: "M3 7h17l-4-4m4 4-4 4M21 17H4l4-4m-4 4 4 4",
  confidentialSwap: "M8.5 10.5h7v7h-7zM10 10.5V8.5a2 2 0 0 1 4 0v2M12 13.5V15",
  settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
  back: "M15 5l-7 7 7 7M8 12h13",
  send: "M7 17 17 7M7 7h10v10",
  receive: "M17 7 7 17M7 7v10h10",
  key: "M15 4a5 5 0 1 1-3 9l-7 7H2v-3l7-7a5 5 0 0 1 6-6ZM16 8h.01",
  fingerprint: "M8 3a8 8 0 0 1 12 7v3c0 1.4-.1 2.8-.4 4M4 7a8 8 0 0 0-1 4v2"
    + "M6 17c.7-1.2 1-2.6 1-4v-2a5 5 0 0 1 10 0v3c0 2-.4 4-1.1 6"
    + "M12 11a2 2 0 0 0-2 2v2c0 2-1 4-2 5M14 13v2c0 3-1 5-2 7",
  lock: "M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3",
  phone: "M7 2h10v20H7zM10 5h4M12 19h.01",
  laptop: "M4 4h16v12H4zM2 20h20l-2-4H4l-2 4Z",
  browser: "M3 4h18v16H3zM3 9h18M6 6.5h.01M9 6.5h.01",
  devices: "M3 4h14v11H3zM1 19h12M18 10h5v11h-5z",
  close: "M6 6l12 12M18 6 6 18",
  chevronRight: "m9 5 7 7-7 7", chevronDown: "m5 9 7 7 7-7",
  forward: "M3 12h16M12 5l7 7-7 7",
  external: "M14 4h6v6M20 4 10 14M10 4H4v16h16v-6",
  copy: "M9 8V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3"
    + "M5 8h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z",
  check: "m5 12 4 4L19 6",
  download: "M12 3v12m-5-5 5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  restore: "M3 4v6h6M3.5 10a9 9 0 1 1 .8 7M12 7v5l3 2",
  theme: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 3v18M15 6v12M18 9v6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4",
  people: "M9 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM3 21v-3a6 6 0 0 1 12 0v3"
    + "M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2",
});
const ASSETS = Object.freeze({
  zec: "/assets/zcash.svg",
  sol: "/assets/solana.svg",
  usdc: "/assets/usdc.svg",
});
const SVG = "http://www.w3.org/2000/svg";

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

// Separate physical details allow small, purposeful gestures without moving the control.
const DETAILS = Object.freeze({
  home: "M3 10.5 12 3l9 7.5", approvals: "m9 12 2 2 4-4", activity: "M12 7v5l3 2",
  chat: "M8 8h8M8 12h5", search: "M16 16l5 5", plus: "M12 5v14",
  security: "m8 12 3 3 5-6", addressBook: "M2 7h4M2 12h4M2 17h4",
  swap: "M3 7h17l-4-4m4 4-4 4", settings: "M9 4v6M15 14v6",
  confidentialSwap: "M3.7 8.5a8.8 8.8 0 0 1 14.6-3.2L21 8M21 3.5V8h-4.5"
    + "M20.3 15.5a8.8 8.8 0 0 1-14.6 3.2L3 16M3 20.5V16h4.5",
  send: "M7 7h10v10", receive: "M7 7v10h10", lock: "M8 11V8a4 4 0 0 1 8 0v3",
  wallet: "M15 11h6v5h-6zM17 13.5h.01", key: "M16 8h.01", browser: "M3 9h18",
  back: "M15 5l-7 7 7 7", forward: "M12 5l7 7-7 7",
  phone: "M10 5h4M12 19h.01", laptop: "M2 20h20l-2-4H4l-2 4Z",
  devices: "M18 10h5v11h-5z", external: "M14 4h6v6M20 4 10 14",
  fingerprint: "M12 11a2 2 0 0 0-2 2v2c0 2-1 4-2 5M14 13v2c0 3-1 5-2 7",
});
const BODIES = Object.freeze({
  home: "M5 9v12h5v-7h4v7h5V9",
  approvals: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  activity: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z",
  plus: "M5 12h14", send: "M7 17 17 7", receive: "M17 7 7 17",
  security: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z",
  settings: "M4 7h16M4 17h16", swap: "M21 17H4l4-4m-4 4 4 4",
  lock: "M5 11h14v10H5z", browser: "M3 4h18v16H3zM6 6.5h.01M9 6.5h.01",
  back: "M8 12h13", forward: "M3 12h16", phone: "M7 2h10v20H7z",
  laptop: "M4 4h16v12H4z", devices: "M3 4h14v11H3zM1 19h12",
  external: "M10 4H4v16h16v-6",
  fingerprint: "M8 3a8 8 0 0 1 12 7v3c0 1.4-.1 2.8-.4 4M4 7a8 8 0 0 0-1 4v2"
    + "M6 17c.7-1.2 1-2.6 1-4v-2a5 5 0 0 1 10 0v3c0 2-.4 4-1.1 6",
  wallet: "M4 6h15v14H4zM4 6V4h12v2",
  key: "M15 4a5 5 0 1 1-3 9l-7 7H2v-3l7-7a5 5 0 0 1 6-6Z",
  addressBook: "M5 3h15v18H5zM12 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
    + "m-3 10v-1a3 3 0 0 1 6 0v1",
});

function symbolPath(value, className) {
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", value); path.setAttribute("class", className);
  return path;
}

/** Decorative brand object only; never a device, wallet or security status. */
export function zigsEmblem(size = "hero") {
  const hero = size !== "small";
  const plate = document.createElement("div");
  plate.className = "zigs-emblem zigs-emblem--" + (hero ? "hero welcome-brand-plate" : "small");
  plate.setAttribute("aria-hidden", "true");
  if (hero) {
    plate.setAttribute("data-motion", "brand");
    plate.setAttribute("data-welcome-brand", "");
  }
  const face = document.createElement("div");
  face.className = "zigs-emblem-face";
  const image = document.createElement("img");
  image.className = "zigs-emblem-logo" + (hero ? " welcome-brand-logo" : "");
  const attrs = { src: "/logo.png?v=fingerprint-17dbdecb64d0", alt: "", width: "160", height: "160",
    draggable: "false" };
  for (const [key, value] of Object.entries(attrs)) image.setAttribute(key, value);
  face.append(image);
  plate.append(face);
  return plate;
}

function artwork(name) {
  const image = document.createElementNS(SVG, "image");
  image.setAttribute("href", ASSETS[name]);
  image.setAttribute("width", "24");
  image.setAttribute("height", "24");
  return image;
}

/**
 * A decorative symbol: a span with an inline SVG, hidden from screen readers. The text next to
 * it carries the meaning.
 * @param {string} name An interface symbol or asset mark; an unknown name throws.
 * @returns {HTMLSpanElement}
 */
export function icon(name) {
  const asset = Object.hasOwn(ASSETS, name);
  if (!asset && !Object.hasOwn(PATHS, name)) {
    throw new Error("app-icons: no symbol named " + name);
  }
  const span = document.createElement("span");
  span.className = "symbol";
  span.setAttribute("data-icon", name);
  span.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG, "svg");
  const attrs = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round",
    focusable: "false" };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  if (asset) svg.append(artwork(name));
  else {
    svg.append(symbolPath(BODIES[name] || PATHS[name], "icon-relief"),
      symbolPath(BODIES[name] || PATHS[name], "icon-body"));
    if (DETAILS[name]) {
      const detail = svgNode("g", { class: "icon-detail" });
      detail.append(symbolPath(DETAILS[name], "icon-relief"),
        symbolPath(DETAILS[name], "icon-face"));
      svg.append(detail);
    }
  }
  span.append(svg);
  return span;
}
