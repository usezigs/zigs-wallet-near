// Compare actual glyph ink to painted, composited local backgrounds, not CSS backgroundColor.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { PNG } = require(resolve(dirname(require.resolve("playwright-core/package.json")),
  "lib/utilsBundle.js"));
const linear = (n) => (n /= 255) <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
const light = (c) => c.reduce((s, n, i) => s + linear(n) * [.2126, .7152, .0722][i], 0);
function ratio(a, b) {
  const x = light(a), y = light(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

function glyphFacts() {
  const required = (ink) => parseFloat(ink.fontSize) >= 24 || parseFloat(ink.fontSize) >= 18.66
    && parseFloat(ink.fontWeight) >= 700 ? 3 : 4.5;
  const nodes = document.querySelectorAll(".welcome-intro h1,.welcome-title-accent,"
    + ".welcome-summary,.welcome-intro button,.welcome-entry-meta > a");
  return [...nodes].map((n) => {
    const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) if (text.textContent.trim()) break;
    const ink = getComputedStyle(text?.parentElement || n), r = n.getBoundingClientRect();
    return { label: n.textContent.trim().slice(0, 90), color: ink.color,
      x: r.x + scrollX + (n.tagName === "BUTTON" ? 6 : -3),
      y: r.y + scrollY + (n.tagName === "BUTTON" ? r.height / 2
        : parseFloat(getComputedStyle(n).lineHeight) / 2),
      required: required(ink) };
  });
}

export async function welcomeContrast(page, path) {
  const facts = await page.evaluate(glyphFacts);
  const png = PNG.sync.read(await page.screenshot({ path, fullPage: true, scale: "css" }));
  return facts.map((f) => {
    const x = Math.max(0, Math.min(png.width - 1, Math.round(f.x)));
    const y = Math.max(0, Math.min(png.height - 1, Math.round(f.y)));
    const at = (y * png.width + x) * 4;
    const backdrop = [...png.data.subarray(at, at + 3)];
    const foreground = f.color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const contrast = ratio(foreground, backdrop);
    return { ...f, backdrop, contrast, pass: contrast >= f.required };
  });
}
