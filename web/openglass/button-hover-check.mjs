// Real pointer input and measured rendering on isolated presentation fixtures. No submissions.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { overviewFixture, settleOverview } from "../../solspike/harness/overview-redesign-fixture.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const output = resolve(process.env.OPENGLASS_AUDIT_OUTPUT || "/tmp/zigs-glass-audit/flows");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE
  || (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
const page = await context.newPage(); page.setDefaultTimeout(5000);
page.setDefaultNavigationTimeout(30000);
const checks = [], errors = [];
let passed = false, performanceResult = null;
page.on("pageerror", error => errors.push(error.message));
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
const ticks = count => page.evaluate(async count => {
  for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
}, count);
async function hover(target, x = .8, y = .3) {
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
  await target.locator(":scope > .button-hover-light").waitFor();
}
try {
  await overviewFixture(context, page);
  await settleOverview(page);
  check(await page.locator(".button-hover-light").count() === 0, "Idle buttons allocate no cursor layers");
  // Exercise the real React Button without activating the wallet operation.
  const button = page.getByRole("button", { name: "New wallet", exact: true });
  const before = await button.boundingBox();
  await hover(button, .2, .3); await ticks(24);
  const start = await button.evaluate(node => ({
    x: Number.parseFloat(node.style.getPropertyValue("--button-hover-x")),
    color: getComputedStyle(node).color, font: getComputedStyle(node).font,
    fill: getComputedStyle(node).backgroundImage, text: node.textContent,
  }));
  await page.mouse.move(before.x + before.width * .8, before.y + before.height * .7);
  const immediate = await button.evaluate(node => Number.parseFloat(node.style.getPropertyValue("--button-hover-x")));
  check(immediate < 79, "Cursor light follows through a spring instead of jumping to the new position");
  await page.waitForFunction(() => Number.parseFloat(document.querySelector('[data-button-hover="active"]')
    ?.style.getPropertyValue("--button-hover-x")) > 77);
  const after = await button.evaluate(node => {
    const style = getComputedStyle(node);
    return { box: node.getBoundingClientRect().toJSON(), x: Number.parseFloat(node.style.getPropertyValue("--button-hover-x")),
      color: style.color, font: style.font, fill: style.backgroundImage, text: node.textContent,
      pointerEvents: getComputedStyle(node.querySelector(".button-hover-light")).pointerEvents,
      ariaHidden: node.querySelector(".button-hover-light").getAttribute("aria-hidden") };
  });
  check(start.x < 23 && after.x > 77, "Highlight tracks both sides of the button");
  check(Math.hypot(after.box.x - before.x, after.box.y - before.y) < 1, "Magnetic travel stays below one pixel");
  check(Math.abs(after.box.width - before.width) < .01 && Math.abs(after.box.height - before.height) < .01,
    `Hover preserves button dimensions (${before.width}×${before.height} to ${after.box.width}×${after.box.height})`);
  check(start.color === after.color && start.font === after.font && start.fill === after.fill && start.text === after.text,
    "Pointer movement preserves the existing finish, typography and label");
  check(after.pointerEvents === "none" && after.ariaHidden === "true", "Light cannot intercept input or enter the accessibility tree");
  await page.screenshot({ path: resolve(output, "button-hover-react-dark.png"), fullPage: true });

  // Measure a cursor path on the real component using the browser's frame cadence.
  performanceResult = await button.evaluate(async node => {
    const times = [], longTasks = []; let mutations = 0;
    const box = node.getBoundingClientRect();
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(node, { childList: true, subtree: true });
    const tasks = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
    tasks.observe({ type: "longtask", buffered: false });
    let last;
    for (let i = 0; i < 90; i++) {
      const now = await new Promise(requestAnimationFrame);
      if (last !== undefined) times.push(now - last);
      last = now;
      node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse",
        clientX: box.x + box.width * (.5 + Math.sin(i / 10) * .35),
        clientY: box.y + box.height * (.5 + Math.cos(i / 12) * .3) }));
    }
    observer.disconnect(); tasks.disconnect();
    const sorted = [...times].sort((a, b) => a - b);
    return { frames: times.length, p95Ms: sorted[Math.floor(sorted.length * .95)],
      averageMs: times.reduce((a, b) => a + b, 0) / times.length, longTasks, childMutations: mutations,
      method: "90 frame-paced synthetic pointer moves after real mouse input, local headless Chrome" };
  });
  check(performanceResult.childMutations === 0, "Pointer movement performs no DOM restructuring or React child renders");
  check(performanceResult.longTasks.length === 0, "The measured cursor path introduces no long tasks");
  await page.mouse.move(1420, 980);
  await page.waitForFunction(() => !document.querySelector("[data-button-hover=active]"));
  const settled = await button.boundingBox();
  check(Math.abs(settled.x - before.x) < .01 && Math.abs(settled.y - before.y) < .01, "Leaving springs back to the original position");
  check(await page.locator(".button-hover-light").count() === 0, "Settled springs release layers and style hints");

  await page.evaluate(async () => {
    const { el } = await import("/app-dom.js");
    globalThis.__hoverClicks = 0;
    const native = el("button", { class: "btn primary", id: "native-hover-check", type: "button",
      onclick: () => globalThis.__hoverClicks++ }, "Native action");
    document.getElementById("app").append(native); globalThis.zigsGlass.flush();
  });
  const native = page.locator("#native-hover-check");
  await hover(native); await ticks(16);
  check(await native.locator(":scope > .button-hover-light").count() === 1, "New native buttons adopt the same hook automatically");
  await native.click();
  check(await page.evaluate(() => globalThis.__hoverClicks === 1), "Native click handler still runs exactly once");
  await native.focus(); await page.keyboard.press("Enter");
  check(await page.evaluate(() => globalThis.__hoverClicks === 2), "Keyboard activation retains the original action");
  check(await page.locator(".button-hover-light").count() === 0, "Keyboard use clears magnetic movement");
  await hover(native);
  await native.evaluate(node => { node.disabled = true; });
  await page.waitForFunction(() => !document.querySelector("[data-button-hover=active]"));
  check(await native.isDisabled(), "Disabling a hovered action immediately clears its effect");
  await native.evaluate(node => { node.disabled = false; node.dataset.buttonHover = "off"; });
  await page.mouse.move(1420, 980); await native.hover(); await ticks(3);
  check(await native.locator(".button-hover-light").count() === 0, "Individual buttons can opt out without changing their component");
  await native.evaluate(node => { delete node.dataset.buttonHover; });
  await page.mouse.move(1420, 980); await hover(native);
  await native.evaluate(node => { node.dataset.buttonHover = "off"; });
  await page.waitForFunction(() => !document.querySelector("#native-hover-check .button-hover-light"));
  check(await native.getAttribute("data-button-hover") === "off", "Opting out while hovered clears the spring and preserves the opt-out");
  await native.evaluate(node => { delete node.dataset.buttonHover; });

  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.mouse.move(1420, 980); await hover(native); await ticks(12);
    await page.screenshot({ path: resolve(output, `button-hover-native-${theme}.png`), fullPage: true });
  }
  for (const mode of ["reduce", "no-preference"]) {
    await page.emulateMedia({ reducedMotion: mode });
    if (mode === "reduce") {
      await page.mouse.move(1420, 980); await native.hover(); await ticks(3);
      check(await native.locator(".button-hover-light").count() === 0, "Reduced motion disables cursor tracking and movement");
    }
  }
  const cdp = await context.newCDPSession(page);
  for (const feature of ["prefers-reduced-transparency", "prefers-contrast", "forced-colors"]) {
    await page.mouse.move(1420, 980); await hover(native);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: feature,
      value: feature === "forced-colors" ? "active" : feature === "prefers-contrast" ? "more" : "reduce" }] });
    await page.waitForFunction(() => !document.querySelector("[data-button-hover=active]"));
    await native.hover(); await ticks(3);
    check(await native.locator(".button-hover-light").count() === 0, `${feature} disables decorative cursor effects`);
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  }
  await page.mouse.move(1420, 980); await hover(native);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.waitForFunction(() => !document.querySelector("#native-hover-check .button-hover-light"));
  check(await native.locator(".button-hover-light").count() === 0, "Resize releases cached geometry and active springs");
  await hover(native);
  await native.evaluate(node => { globalThis.__removedHoverButton = node; node.remove(); });
  await page.waitForFunction(() => !globalThis.__removedHoverButton.hasAttribute("data-button-hover"));
  check(await page.evaluate(() => !globalThis.__removedHoverButton.style.getPropertyValue("--button-hover-opacity")),
    "Detached cached views release their animation state");

  await page.evaluate(async () => {
    const { createSwapPreview } = await import("/app-swap-preview.js"), { MockSwapProvider } = await import("/swap-preview-model.js");
    document.getElementById("app").replaceChildren(createSwapPreview({ demo: true }, new MockSwapProvider()).element);
    globalThis.zigsGlass.flush();
  });
  await page.getByRole("button", { name: "Choose asset to pay", exact: true }).click();
  await hover(page.locator("body > dialog .swap-asset-choice").first());
  check(await page.locator("body > dialog .button-hover-light").count() === 1, "Native top-layer dialogs receive the same interaction");
  await page.keyboard.press("Escape");
  check(await page.locator(".button-hover-light").count() === 0, "Dialog keyboard dismissal leaves no cursor layers behind");

  await page.evaluate(async () => {
    const { createSwapPreview } = await import("/app-swap-preview.js"), { MockSwapProvider } = await import("/swap-preview-model.js");
    document.getElementById("app").replaceChildren(createSwapPreview({ live: true, network: "mainnet",
      preferredFrom: "sol" }, new MockSwapProvider()).element);
    globalThis.zigsGlass.flush();
  });
  const route = page.locator('.swap-execution-option[data-mode="basic"]');
  const routeBefore = await route.boundingBox();
  await hover(route); await ticks(16);
  check(await route.evaluate(node => node.tagName === "LABEL" && node.querySelector('input[type="radio"]') !== null),
    "Routing cards retain native radio semantics while adopting cursor light");
  check(!await route.locator("input").isChecked(), "Hover does not change the selected routing mode");
  const routeAfter = await route.boundingBox();
  check(Math.hypot(routeAfter.x - routeBefore.x, routeAfter.y - routeBefore.y) < 1
    && Math.abs(routeBefore.width - routeAfter.width) < .01
    && await route.evaluate(node => getComputedStyle(node).transform === "none"),
    "Routing-card movement stays subpixel and replaces the older hover lift");
  await route.locator("input").evaluate(node => { node.disabled = true; });
  await page.waitForFunction(() => !document.querySelector('.swap-execution-option[data-mode="basic"] .button-hover-light'));
  check(await route.locator("input").isDisabled(), "Disabling the native radio clears its parent surface interaction");

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const touch = await touchContext.newPage(); touch.on("pageerror", error => errors.push(error.message));
  touch.setDefaultNavigationTimeout(30000);
  await overviewFixture(touchContext, touch);
  const receive = touch.locator(".overview-action-picker").nth(1);
  await receive.locator("summary").tap();
  check(await touch.locator(".button-hover-light").count() === 0, "Touch input retains native taps with no hover layer or magnetic movement");
  check(await receive.getAttribute("open") !== null, "Touch still opens the native Receive picker");
  await touchContext.close();
  check(errors.length === 0, "No runtime errors during cursor interaction checks");
  passed = true;
  console.log(JSON.stringify({ passed, checks: checks.length, performance: performanceResult, output }));
} finally {
  writeFileSync(resolve(output, "button-hover.json"), JSON.stringify({ passed, checks, errors, performance: performanceResult }, null, 2));
  await browser.close();
}
