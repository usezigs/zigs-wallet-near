// Real page renderers and the real on-page art, with synthetic public state and no services.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserName, browserOutput, launchTestBrowser } from "../../solspike/harness/browser-test.mjs";
import { overviewFixture, settleOverview } from "../../solspike/harness/overview-redesign-fixture.mjs";
import { welcomeContrast } from "../../solspike/harness/rendered-contrast.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const output = browserOutput("welcome"), records = [], checks = [], errors = [];
const browser = await launchTestBrowser();
const widths = process.env.ZIGS_BROWSER_SMOKE === "1" ? [320, 1024, 1440]
  : [320, 375, 390, 768, 1024, 1440, 1920];
const check = (pass, label) => { checks.push({ pass: !!pass, label }); };

async function home(page, theme) {
  await page.evaluate(async (theme) => {
    document.documentElement.dataset.theme = theme;
    const { state, ui } = await import("/app-state.js");
    (await import("/app-engine.js")).setZ({ normalizeAddress: (a) => a });
    (await import("/app-groups.js")).setDb({});
    Object.assign(state, { g: null, gid: null, groups: [] }); ui.tab = "overview";
    (await import("/app-loop.js")).draw();
  }, theme);
  await page.waitForFunction((theme) => document.querySelector(".zigs-openglass")
    ?.dataset.oguiAppearance === theme, theme);
  await page.locator(".home-hero-art").evaluate((n) => n.decode());
  await settleOverview(page);
}

async function visibleArt(page) {
  return page.evaluate(() => {
    const selector = document.querySelector(".home-scene-live")
      ? ".home-hero-portrait" : ".home-hero-art";
    const n = document.querySelector(selector), r = n?.getBoundingClientRect();
    return !!r?.width && !!r.height && n.checkVisibility({ checkOpacity: true })
      && getComputedStyle(n).objectFit === "contain";
  });
}

async function oneCase(width, theme) {
  const context = await browser.newContext({ viewport: { width, height: width < 761 ? 844 : 1000 },
    colorScheme: theme, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push({ width, theme, message: e.message }));
  try {
    await overviewFixture(context, page); await home(page, theme);
    const label = `${width} ${theme}`;
    const results = await welcomeContrast(page, resolve(output, label.replace(" ", "-") + ".png"));
    records.push({ width, theme, results });
    check(results.length >= 7 && results.every((r) => r.pass), label + ": readable welcome glyphs");
    check(await visibleArt(page), label + ": visible proportion-preserving on-page artwork");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      label + ": no horizontal overflow");
    if (width === widths[0] && theme === "light") await negativeControls(page);
    if (width === 1440) await preferenceStates(page, theme);
  } finally { await context.close(); }
}

async function preferenceStates(page, theme) {
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await page.waitForFunction((value) => document.querySelector(".zigs-openglass")
    ?.dataset.oguiAppearance === value, theme);
  check((await welcomeContrast(page)).every((r) => r.pass), theme + ": system appearance is readable");
  await page.getByRole("button", { name: "Create wallet", exact: true }).hover();
  check((await welcomeContrast(page)).every((r) => r.pass), theme + ": hover keeps readable ink");
  await page.getByRole("button", { name: "Join a wallet", exact: true }).focus();
  check(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none"),
    theme + ": keyboard focus is visible");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(800);
  check(await visibleArt(page), theme + ": live artwork or its supported fallback is visible");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => !document.querySelector(".home-scene-live"));
  check(await visibleArt(page), theme + ": reduced motion restores the visible still");
}

async function negativeControls(page) {
  // Mutate a same-origin linked sheet: exercise the production CSP without inline style tags.
  const add = rule => page.evaluate(rule => {
    const sheet = [...document.styleSheets].find(s => s.href?.endsWith('/setup-refinement.css'));
    const index = sheet.cssRules.length; sheet.insertRule(rule, index); return index;
  }, rule);
  const remove = index => page.evaluate(index => {
    [...document.styleSheets].find(s => s.href?.endsWith('/setup-refinement.css')).deleteRule(index);
  }, index);
  const ink = await add('.welcome-intro h1{color:#10151d!important}');
  check((await welcomeContrast(page)).some((r) => !r.pass), 'negative control rejects unreadable ink');
  await remove(ink);
  const hidden = await add('.home-hero-art,.home-hero-portrait{opacity:0!important}');
  check(!await visibleArt(page), 'negative control rejects hidden on-page artwork');
  await remove(hidden);
}

try {
  for (const width of widths) for (const theme of ["dark", "light"]) await oneCase(width, theme);
  assert.equal(errors.length, 0, "No browser runtime errors");
  assert.ok(checks.every((c) => c.pass), "Welcome checks failed; inspect report.json");
  console.log(`${checks.length} welcome checks passed in ${browserName}`);
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ browser: browserName,
    checks, errors, records, method: "Composited local backdrop samples and actual glyph-parent ink." }, null, 2));
  await browser.close();
}
