// Real sidebar, synthetic wallet facts, no wallet boot, exports or payment execution.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const { chromium } = createRequire(new URL("../../web/package.json", import.meta.url))("playwright");
const out = resolve(process.env.ZIGS_SIDEBAR_OUTPUT || "/private/tmp/zigs-nextlevel-sidebar");
mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (pass, name) => { checks.push({ pass: !!pass, name }); assert.ok(pass, name); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage(); page.setDefaultTimeout(10000);
page.on("pageerror", (error) => errors.push(error.stack));
const shot = (name) => page.screenshot({ path: resolve(out, name + ".png") });
const nav = () => page.locator("#side-nav");

async function matrix() {
  for (const width of [1440, 1024, 390, 320]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 1000 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; scrollTo(0, 0); }, theme);
    await settleOverview(page);
    if (width < 761 && !await nav().isVisible()) await page.locator("#wallet-menu").click();
    await page.waitForFunction(() => document.querySelector("#side-nav")?.checkVisibility());
    const facts = await nav().evaluate((node) => ({ fits: node.scrollWidth <= node.clientWidth + 1,
      labels: [...node.querySelectorAll('[data-sidebar-nav] .side-name')].every((label) => label.scrollWidth <= label.clientWidth + 1),
      icons: node.querySelectorAll("[data-sidebar-nav] [data-sidebar-icon]").length }));
    check(facts.fits && facts.labels && facts.icons === 8, `${width}px ${theme}: all eight sidebar icons and labels fit`);
    await shot(`sidebar-${width}-${theme}`);
    if (width === 1440) await page.locator(".side").screenshot({ path: resolve(out, `sidebar-detail-${theme}.png`) });
    if (width < 761) { await page.keyboard.press("Escape"); await nav().waitFor({ state: "hidden" }); }
  }
}

async function motion() {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await settleOverview(page);
  for (const id of ["overview", "approvals", "activity", "recipients", "swap", "chats", "recovery", "settings"]) {
    await page.mouse.move(500, 800); await page.locator("#tab-" + id).hover();
    check(await page.locator("#tab-" + id + " .sidebar-glyph-trace").evaluate((node) => node.getAnimations().length > 0),
      `${id}: actual Motion plays its icon acknowledgement on hover`);
  }
  const trace = page.locator("#tab-settings .sidebar-glyph-trace");
  await trace.evaluate((node) => node.getAnimations().forEach((effect) => effect.pause()));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector("#tab-settings .sidebar-glyph-trace").getAnimations().length === 0);
  check(true, "Live reduced motion cancels an ongoing icon effect");
  await page.mouse.move(500, 800); await page.locator("#tab-activity").hover();
  check(await page.locator("#tab-activity .sidebar-glyph-trace").evaluate((node) => node.getAnimations().length === 0), "Reduced motion retains static hover feedback");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(async () => {
    (await import("/app-loop.js")).draw();
    globalThis.__sidebarNativeAnimate = Element.prototype.animate;
    globalThis.__sidebarRailAnimation = null;
    Element.prototype.animate = function(...args) {
      const effect = globalThis.__sidebarNativeAnimate.apply(this, args);
      if (this.matches(".sidebar-active-marker")) globalThis.__sidebarRailAnimation = effect;
      return effect;
    };
  });
  await page.locator("#tab-activity").click();
  await page.waitForFunction(() => document.getElementById("tab-activity")?.getAttribute("aria-current") === "page");
  check(await page.evaluate(() => {
    const effect = globalThis.__sidebarRailAnimation, frames = effect?.effect.getKeyframes();
    Element.prototype.animate = globalThis.__sidebarNativeAnimate;
    if (!frames || frames[0].transform === frames.at(-1).transform) return false;
    effect.pause(); effect.currentTime = 120; return true;
  }), "The selected-section rail moves with real navigation");
  await page.evaluate(async () => (await import("/app-loop.js")).draw());
  check(await page.locator(".sidebar-active-marker").evaluate((node) => node.getAnimations().length === 0)
    && await page.evaluate(() => globalThis.__sidebarRailAnimation.playState === "idle"), "An ordinary redraw cancels the previous rail and settles selection without replaying it");
  await page.emulateMedia({ forcedColors: "active" });
  await page.mouse.move(500, 800); await page.locator("#tab-settings").hover();
  check(await page.locator("#tab-settings .sidebar-glyph-trace").evaluate((node) => node.getAnimations().length === 0), "Forced colors settle decorative motion");
  for (const selector of ["[data-sidebar-nav].active", ".wallet-context.active"]) {
    check(await nav().locator(selector).evaluate((row) => {
      const label = row.querySelector(".side-name"), text = getComputedStyle(label), surface = getComputedStyle(row);
      const rgb = (value) => value.match(/[\d.]+/g).map(Number);
      const foreground = rgb(text.color), own = rgb(text.backgroundColor), background = own[3] === 0 ? rgb(surface.backgroundColor) : own;
      const luminance = (values) => values.slice(0, 3).map((value) => {
        const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const a = luminance(foreground), b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5;
    }), `Forced colors keep the selected ${selector.includes("wallet") ? "wallet" : "section"} label readable`);
  }
  await shot("sidebar-forced-colors");
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
}

async function keyboardAndMobile() {
  await page.locator("#tab-settings").focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("tab-settings")?.getAttribute("aria-current") === "page");
  check(await page.locator("#panel-settings").evaluate((node) => node === document.activeElement), "Keyboard navigation keeps the existing page-focus behavior");
  await page.setViewportSize({ width: 320, height: 844 }); await settleOverview(page);
  await page.locator("#wallet-menu").click(); await nav().waitFor({ state: "visible" });
  check(await page.locator(".main").getAttribute("inert") !== null, "The phone menu keeps the page inert");
  await page.locator("#tab-activity").focus(); await page.keyboard.press("Escape");
  await nav().waitFor({ state: "hidden" });
  check(await page.locator("#wallet-menu").evaluate((node) => node === document.activeElement), "Escape returns focus to the phone Menu button");
  await page.locator("#wallet-menu").click(); await nav().waitFor({ state: "visible" });
  const last = nav().locator("button:not(:disabled), a[href]").last(); await last.focus(); await last.press("Tab");
  check(await page.locator("#wallet-menu").evaluate((node) => node === document.activeElement), "Tab remains inside the open phone menu");
  await page.locator("#tab-activity").click(); await nav().waitFor({ state: "hidden" });
  check(await page.locator("#wallet-menu").getAttribute("aria-expanded") === "false", "Choosing a section closes the phone menu");
  for (const state of ["busy", "bad", "ok"]) {
    await page.evaluate((state) => { document.getElementById("engine-dot").className = "dot " + state; }, state);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Phone header fits while browser status is ${state}`);
  }
}

try {
  await overviewFixture(context, page, { messaging: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; }); await settleOverview(page);
  if (process.env.ZIGS_SIDEBAR_BASELINE === "1") {
    await shot("sidebar-before"); await page.locator(".side").screenshot({ path: resolve(out, "sidebar-detail-before.png") });
    console.log("Sidebar baseline saved: " + out);
  } else {
    await matrix(); await motion(); await keyboardAndMobile();
    check(errors.length === 0, "No browser runtime errors");
    writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors }, null, 2));
    console.log(`${checks.length} sidebar checks passed. Screenshots: ${out}`);
  }
} catch (error) {
  await shot("failure"); writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
