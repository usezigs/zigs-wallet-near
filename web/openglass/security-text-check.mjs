// Enlarged metric text in real renderers; synthetic public wallet facts, no wallet operations.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserOutput, launchTestBrowser } from "../../solspike/harness/browser-test.mjs";
import { overviewFixture, settleOverview } from "../../solspike/harness/overview-redesign-fixture.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const output = browserOutput("security-text"), checks = [], errors = [];
const browser = await launchTestBrowser();
const check = (pass, label) => { checks.push({ pass: !!pass, label }); assert.ok(pass, label); };

async function metricFacts(page) {
  return page.locator(".security-metrics").evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    const rows = [...root.children].map((row) => {
      const label = row.querySelector("dt").getBoundingClientRect();
      const value = row.querySelector("dd").getBoundingClientRect();
      const separate = label.right <= value.left + 1 || label.bottom <= value.top + 1;
      const words = [...row.querySelectorAll("dt,dd:not(.security-metric-detail)")].flatMap((node) => {
        const text = node.firstChild;
        if (text?.nodeType !== Node.TEXT_NODE) return [];
        return [...text.textContent.matchAll(/[A-Za-z]{3,}/g)].map((match) => {
          const range = document.createRange();
          range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
          const rects = [...range.getClientRects()];
          return rects.length === 1 && rects[0].left >= bounds.left - 1
            && rects[0].right <= bounds.right + 1;
        });
      });
      return separate && words.length > 0 && words.every(Boolean);
    });
    return { rows, fits: root.scrollWidth <= root.clientWidth + 1 };
  });
}

async function oneCase(width, theme, scale) {
  const context = await browser.newContext({ viewport: { width, height: 844 },
    reducedMotion: "reduce", colorScheme: theme });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await overviewFixture(context, page, { messaging: true });
    await page.evaluate(async ({ theme, scale }) => {
      document.documentElement.dataset.theme = theme;
      (await import("/app-state.js")).ui.tab = "recovery";
      (await import("/app-loop.js")).draw();
      await new Promise((done) => requestAnimationFrame(done));
      const sizes = [...document.querySelectorAll(".security-dashboard,.security-dashboard *")]
        .map((node) => ({ node, font: parseFloat(getComputedStyle(node).fontSize),
          line: parseFloat(getComputedStyle(node).lineHeight) }));
      for (const { node, font, line } of sizes) {
        node.style.fontSize = font * scale + "px";
        if (Number.isFinite(line)) node.style.lineHeight = line * scale + "px";
      }
    }, { theme, scale });
    await settleOverview(page);
    const label = `${width} ${theme} ${scale * 100}% text`;
    await page.screenshot({ path: resolve(output, `${width}-${theme}-${scale}.png`), fullPage: true });
    if (width === 320 && scale === 2) await page.locator(".security-overview").screenshot({
      path: resolve(output, `${width}-${theme}-metrics.png`) });
    const facts = await metricFacts(page);
    check(facts.rows.length === 3 && facts.rows.every(Boolean), label + ": whole metric words without collisions");
    check(facts.fits, label + ": metrics fit their container");
    const action = page.locator(".security-primary");
    await action.scrollIntoViewIfNeeded(); await action.focus();
    check(await action.evaluate((n) => n === document.activeElement && n.checkVisibility()),
      label + ": primary action remains reachable and focusable");
  } finally { await context.close(); }
}

try {
  for (const width of [320, 375, 390]) for (const theme of ["dark", "light"])
    for (const scale of [1, 2]) await oneCase(width, theme, scale);
  check(errors.length === 0, "no browser runtime errors");
  console.log(`${checks.length} Security text checks passed`);
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ checks, errors,
    scope: "Computed 100%/200% text enlargement; desktop engine only, not OS text scale certification." }, null, 2));
  await browser.close();
}
