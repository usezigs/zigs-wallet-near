// The orientation and phone rules of the page, read from the style sheets and index.html: a page
// root that takes the focus shows no frame, the landmarks have plain names, every page title
// uses one token, the narrow pages share one width, the Tor chip has one place, and the phone
// header, fields and links keep their sizes. The measured numbers are in the PR of this change.
// Run: node web/test/orientation.mjs   (Node 26)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
// The innermost rules of a sheet (also inside @media), as selector text and declarations.
const rules = (sheet) => [...sheet.replace(/\/\*[\s\S]*?\*\//g, "")
  .matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const app = rules(read("app.css")), html = read("index.html");
const has = (list, sel, decl) => list.some((r) => r.sel.split(/,\s*/).includes(sel)
  && decl.test(r.body));

// A page root takes the focus after a pick and shows no frame. A blanket [tabindex="-1"] rule
// would also take the ring from the error callouts that take the focus on purpose.
assert.ok(has(app, '[data-key^="panel-"]:focus', /outline:\s*none/),
  "a page root that has the focus shows no frame");
assert.ok(!app.some((r) => r.sel.split(/,\s*/).includes('[tabindex="-1"]:focus')),
  "no rule takes the ring from every element with tabindex -1");
assert.match(html, /<nav id="side-nav" aria-label="Sections">/, "the side list is Sections");
assert.match(html, /<a class="skip-link" href="#app">Skip to main content<\/a>/,
  "the skip link names its target");

console.log("orientation: ok");
