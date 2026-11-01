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
const refined = read("site-refinement.css");
const has = (list, sel, decl) => list.some((r) => r.sel.split(/,\s*/).includes(sel)
  && decl.test(r.body));
// The declarations of the rules with exactly this selector text.
const bodyOf = (list, sel) => list.filter((r) => r.sel === sel).map((r) => r.body).join(";");

// A page root takes the focus after a pick and shows no frame. A blanket [tabindex="-1"] rule
// would also take the ring from the error callouts that take the focus on purpose.
assert.ok(has(app, '[data-key^="panel-"]:focus', /outline:\s*none/),
  "a page root that has the focus shows no frame");
assert.ok(!app.some((r) => r.sel.split(/,\s*/).includes('[tabindex="-1"]:focus')),
  "no rule takes the ring from every element with tabindex -1");
assert.match(html, /<nav id="side-nav" aria-label="Sections">/, "the side list is Sections");
assert.match(html, /<a class="skip-link" href="#app">Skip to main content<\/a>/,
  "the skip link names its target");

// One page title: --font-page at weight 700, 32/40 px and 26/32 px on a phone. No later rule
// gives a page h1 another weight or the Messages h1 another size.
assert.match(refined, /^ --font-page:700 2rem\/2\.5rem var\(--sans\);/m, "the title token");
assert.match(refined,
  /@media\(max-width:760px\)\{:root\{--font-page:700 1\.625rem\/2rem var\(--sans\)\}\}/,
  "the title token of a phone");
assert.deepEqual(rules(refined).filter((r) => /\bh1\b/.test(r.sel) && /font-weight/.test(r.body))
  .map((r) => r.sel), [".lobby-home .home-hero h1"], "only the home hero sets an h1 weight");
assert.doesNotMatch(bodyOf(rules(read("messaging.css")), ".messages-heading h1"), /font-size/,
  "the Messages title takes its size from the token");
// Approvals, Activity, Security and the Address book share the width of Settings. The wallet
// sections with the same ids stay at the full width, so the rule takes children of #app only.
assert.match(bodyOf(app, "#app>:is(#panel-approvals,#panel-activity,#panel-recovery,"
  + ".recipients-page)"), /max-width:1120px/, "the workspace lists are 1120 px wide");
assert.match(bodyOf(rules(read("settings-experience.css")), "#panel-settings"),
  /max-width:1120px/, "as Settings");

// One place for the Tor chip: a slot of the side panel, between the side list and the footer,
// so a phone shows it between the logo and Menu. No page header has a rule for it now.
assert.match(html, /<nav id="side-nav"[^>]*><\/nav>\s*<div class="side-privacy" id="privacy-slot">/,
  "the slot of the Tor chip follows the side list");
const sheets = ["app.css", "network-privacy-popup.css", "premium-experience.css"].map(read);
assert.ok(sheets.every((sheet) => !sheet.includes(":has(>.pp-header-status)")),
  "no page header makes room for the Tor chip");
assert.ok(has(rules(sheets[1]), ".side-privacy", /display:flex/), "the slot is a flex row");
assert.ok(has(app, ".logo-word", /display:\s*none/), "a narrow phone shows the logo mark only");
assert.ok(read("app.css").includes("@media(max-width:360px) { .logo-word { display:none; } }"),
  "from 360 px down");

console.log("orientation: ok");
