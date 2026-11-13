// Original interface glyphs. Shared vector data for navigation, Swap and educational controls.
// All paths are local decorative artwork; labels, counts and wallet checks carry meaning.
export const SIDEBAR_GLYPHS = Object.freeze({
  home: {
    body: "M4.5 4.5h6v6h-6zM13.5 4.5h6v10h-6zM4.5 13.5h6v6h-6zM13.5 17.5h6v2h-6z",
    detail: "M7 7.5h1M15.5 7.5h2M7 16.5h1",
  },
  approvals: {
    body: "M4 14V4.5A1.5 1.5 0 0 1 5.5 3H15M8 6h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
    detail: "m9.5 13 2.5 2.5 4.5-5",
  },
  activity: {
    body: "M6 3.5h9l3 3v14H6zM15 3.5V7h3",
    detail: "M9 9.5h5M9 13h6M9 16.5h3",
  },
  addressBook: {
    body: "M7 4h12v16H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 4v16M3 8h3M3 12h3M3 16h3",
    detail: "M14.5 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM9.5 17v-1a3 3 0 0 1 6 0v1",
  },
  swap: {
    body: "M8 4H5a1 1 0 0 0-1 1v3M16 20h3a1 1 0 0 0 1-1v-3",
    detail: "M6 8.5h12m-3-3 3 3-3 3M18 15.5H6m3-3-3 3 3 3",
  },
  chat: {
    body: "M4.5 5h15v12h-8L7 20.5V17H4.5z",
    detail: "M8 9h8M8 12.5h5",
  },
  security: {
    body: "m12 3 7.5 3v5c0 4.6-3.5 8-7.5 10-4-2-7.5-5.4-7.5-10V6Z",
    detail: "M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM12 12v4",
  },
  settings: {
    body: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M18.5 12a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
    detail: "M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM10.2 13.8l3.6-3.6",
  },
  plus: { body: "M8 4H5a1 1 0 0 0-1 1v3M16 20h3a1 1 0 0 0 1-1v-3", detail: "M12 7v10M7 12h10" },
  wallet: { body: "M4 7h15v12H4zM4 7V5h12v2", detail: "M15 11h6v5h-6zM18 13.5h.01" },
  browser: { body: "M3.5 5h17v14h-17zM3.5 9h17", detail: "M6.5 7h.01M9 7h.01M8 12.5h8M8 15.5h5" },
  menu: { body: "M5 6h14M5 18h14", detail: "M5 12h14", open: "M6 6l12 12M18 6 6 18" },
  chevronDown: { body: "", detail: "m7 10 5 5 5-5" },
  devices: { body: "M3 5h12v11H3zM2 19h12M17 10h5v11h-5z", detail: "M6 8h6M19.5 18h.01" },
  preview: { body: "M4 4.5h16v15H4zM4 8h16", detail: "M7 6.3h.01M9.5 6.3h.01m.5 4.2 5 3-5 3z" },
  publicSwap: { body: "M4 6h3v3H4zM17 15h3v3h-3z", detail: "M10 7.5h10m-3-3 3 3-3 3M14 16.5H4m3-3-3 3 3 3" },
  confidentialSwap: { body: "M7 3.5H4a.5.5 0 0 0-.5.5v3M17 3.5h3a.5.5 0 0 1 .5.5v3M20.5 17v3a.5.5 0 0 1-.5.5h-3M7 20.5H4a.5.5 0 0 1-.5-.5v-3", detail: "M8 10.5h8V18H8zM9.5 10.5V8a2.5 2.5 0 0 1 5 0v2.5M12 13.5v1.5" },
  sliders: { body: "M4 7h5M13 7h7M4 17h9M17 17h3", detail: "M9 4h4v6H9zM13 14h4v6h-4z" },
  lock: { body: "M6 10h12v10H6z", detail: "M8.5 10V7a3.5 3.5 0 0 1 7 0v3M12 14v2.5" },
  unshield: { body: "m9 4.2 3-1.2 7.5 3v5c0 2.4-1 4.5-2.6 6.2M14.2 19.8 12 21c-4-2-7.5-5.4-7.5-10V6l1.6-.6", detail: "m3.5 3.5 17 17M10 10l4 4" },
  info: { body: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z", detail: "M12 10.5v6M12 7.5h.01M10.5 16.5h3" },
  copy: { body: "M8.5 7.5V4H20v12h-3.5M4 8h12v12H4z", detail: "M7 12h6M7 15.5h4" },
  check: { body: "", detail: "m5.5 12.5 4 4 9-9" },
  close: { body: "", detail: "m6 6 12 12M18 6 6 18" },
  chevronRight: { body: "", detail: "m10 7 5 5-5 5" },
  forward: { body: "M4 12h15", detail: "m13 6 6 6-6 6" },
  back: { body: "M5 12h15", detail: "m11 6-6 6 6 6" },
  send: { body: "M6 18 18 6", detail: "M7 6h11v11" },
  receive: { body: "M18 6 6 18", detail: "M6 7v11h11" },
  external: { body: "M10 4.5H4.5v15h15V14", detail: "M14 4.5h5.5V10M19 5 10 14" },
  restore: { body: "M4.5 8a8 8 0 1 1 .2 8", detail: "M4.5 3.5V8H9M12 8v4l3 2" },
  play: { body: "", detail: "m8 5 11 7-11 7Z" },
  pause: { body: "", detail: "M7 5h3v14H7zM14 5h3v14h-3z" },
  fingerprint: { body: "M4.5 8A8 8 0 0 1 20 11v2M4 12v2M7 17c.7-1.2 1-2.6 1-4v-2a4 4 0 0 1 8 0v3c0 2-.4 4-1.1 6", detail: "M11 19c1-2 1-4 1-7M5 18l-1 2M19 16l-1 4" },
  sol: { asset: "/assets/solana.svg" },
  zec: { asset: "/assets/zcash.svg" },
  usdc: { asset: "/assets/usdc.svg" },
});
const SVG = "http://www.w3.org/2000/svg";
const attributes = (node, attrs) => { for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
const node = (tag, attrs) => attributes(document.createElementNS(SVG, tag), attrs);

function glyphIcon(name, sidebar) {
  const glyph = SIDEBAR_GLYPHS[name];
  if (!glyph) throw new Error("Unknown interface icon: " + name);
  const span = attributes(document.createElement("span"), { class: "symbol " + (sidebar ? "sidebar-symbol" : "interface-symbol"),
    "data-icon": name, [sidebar ? "data-sidebar-icon" : "data-interface-icon"]: "", "aria-hidden": "true" });
  const cls = (part) => "interface-glyph-" + part + (sidebar ? " sidebar-glyph-" + part : "");
  const svg = node("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", focusable: "false" });
  if (glyph.asset) svg.append(node("image", { href: glyph.asset, x: sidebar ? "2" : "0", y: sidebar ? "2" : "0",
    width: sidebar ? "20" : "24", height: sidebar ? "20" : "24" }));
  else {
    svg.append(node("path", { class: cls("plane"), d: glyph.body }));
    svg.append(node("path", { class: cls("body"), d: glyph.body }));
    const detail = node("g", { class: cls("detail") });
    detail.append(node("path", { d: glyph.detail })); svg.append(detail);
    svg.append(node("path", { class: cls("trace"), d: glyph.detail, pathLength: "1" }));
    if (glyph.open) svg.append(node("path", { class: cls("open"), d: glyph.open }));
  }
  span.append(svg); return span;
}

/** Decorative glyphs; adjacent labels and actual application state supply their meaning. */
export const sidebarIcon = (name) => glyphIcon(name, true);
export const interfaceIcon = (name) => glyphIcon(name, false);
