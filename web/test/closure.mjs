// The files that a module loads, found by the text of its imports (a library of the tests, no test
// of its own). Every static specifier and every import() argument must be a relative literal, so
// that no import can hide from the scan. Used by sol-plain-ceremony.mjs and cf/test/gate.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";

export const web = new URL("../", import.meta.url);
const FROM = /\b(?:import|export)\b[^;"'`]*?\bfrom\s*(["'`])([^"'`]*)\1/g;
const BARE = /\bimport\s*(["'`])([^"'`]*)\1/g;
const DYNAMIC = /\bimport\s*\(([^)]*)\)/g;
const RELATIVE = /^\.{1,2}\//;
const LITERAL = /^\s*(["'])(\.{1,2}\/[^"'\\]*)\1\s*$/;

/** The closure of the files `entries` (paths from web/): a Map from path to text. */
export function closureOf(entries) {
  const closure = new Map();
  const follow = (url) => {
    const rel = url.pathname.slice(web.pathname.length);
    if (closure.has(rel)) return;
    const text = fs.readFileSync(url, "utf8");
    closure.set(rel, text);
    for (const m of [...text.matchAll(FROM), ...text.matchAll(BARE)]) {
      assert.match(m[2], RELATIVE, rel + " imports a path that is not relative: " + m[2]);
      follow(new URL(m[2], url));
    }
    for (const m of text.matchAll(DYNAMIC)) {
      const lone = LITERAL.exec(m[1]);
      assert.ok(lone, rel + " has an import() whose path is no relative literal: " + m[1]);
      follow(new URL(lone[2], url));
    }
  };
  for (const entry of entries) follow(new URL(entry, web));
  return closure;
}
