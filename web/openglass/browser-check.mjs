// Real React components + the existing isolated wallet renderer fixture. No funds or writes.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import console from "node:console";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { overviewFixture, settleOverview } from "../../solspike/harness/overview-redesign-fixture.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const out = process.env.OPENGLASS_OUTPUT || resolve(tmpdir(), "zigs-openglass-review");
mkdirSync(out, { recursive: true });
const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE
  || (existsSync(localChrome) ? localChrome : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce", colorScheme: "light" });
const page = await context.newPage();
page.setDefaultTimeout(5000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.stack));
try {
  await overviewFixture(context, page);
  await settleOverview(page);
  assert.ok(await page.locator("[data-ogui-glass]").count() >= 2, "live Glass surfaces");
  assert.ok(await page.locator(".ogui-card").count() >= 2, "shared cards use Card");
  assert.ok(await page.locator(".ogui-button").count() >= 8, "navigation uses Button");
  assert.equal(await page.locator(".ogui-stat").count(), 1, "balance uses Stat");
  assert.equal(await page.locator("#total-balance-title").textContent(), "ZEC balance");

  async function layout(name, theme, width) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 1000 });
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await settleOverview(page);
    await page.waitForFunction((theme) => document.querySelector(".zigs-openglass")
      ?.dataset.oguiAppearance === theme, theme);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${name} ${theme} ${width}: no horizontal page overflow (${overflow})`);
    if (name === "overview") {
      const collision = await page.evaluate(() => {
        const value = document.querySelector(".ogui-stat strong").getBoundingClientRect();
        const actions = document.querySelector(".overview-actions").getBoundingClientRect();
        return value.right > actions.left && value.left < actions.right
          && value.bottom > actions.top && value.top < actions.bottom;
      });
      assert.equal(collision, false, `${width}: balance and actions do not overlap`);
    }
    await page.screenshot({ path: `${out}/${name}-${theme}-${width}.png`, fullPage: true });
  }
  for (const theme of ["light", "dark"]) {
    await layout("overview", theme, 1440);
    await layout("overview", theme, 390);
    await layout("overview", theme, 320);
  }
  await page.evaluate(() => {
    const stat = document.querySelector(".ogui-stat");
    stat.dataset.longValue = "true";
    stat.querySelector("strong").textContent = "21,000,000.00 ZEC";
  });
  for (const width of [1440, 390, 320]) {
    await layout("overview", "light", width);
    const clipped = await page.locator(".ogui-stat strong").evaluate((node) => node.scrollWidth > node.clientWidth + 1);
    assert.equal(clipped, false, `${width}: long balances remain readable`);
  }
  await page.evaluate(() => {
    const stat = document.querySelector(".ogui-stat");
    delete stat.dataset.longValue;
    stat.querySelector("strong").textContent = "0.00 ZEC";
  });
  await layout("overview", "light", 1440);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#tab-settings").click();
  await page.locator(".preferences-page").waitFor();
  const appearance = page.getByRole("combobox", { name: "Appearance" });
  await appearance.selectOption("light");
  await page.waitForFunction(() => document.querySelector(".zigs-openglass")?.dataset.oguiAppearance === "light");
  assert.equal(await page.evaluate(() => localStorage.getItem("zf-theme")), "light");
  await layout("settings", "light", 1440);
  await layout("settings", "dark", 390);

  // Native dialogs retain their original form, focus trap and Escape dismissal.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "New wallet", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.locator(".dialog .openglass-sheet-material[data-ogui-material=frosted]").count(), 1);
  await layout("setup", "light", 1440);
  await layout("setup", "dark", 390);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });

  // The existing field helper is now a real, labelled TextField. Its DOM input and contents
  // survive unrelated presentation refreshes, and detached cached islands can be reattached.
  await page.evaluate(async () => {
    const { nameField } = await import("/app-dom.js");
    const slot = nameField("glass-test-name");
    slot.id = "glass-field-slot";
    document.getElementById("app").append(slot);
    globalThis.zigsGlass.flush();
  });
  const field = page.getByRole("textbox", { name: "This device's label", exact: true });
  await field.fill("Everyday phone");
  assert.equal(await field.inputValue(), "Everyday phone");
  assert.equal(await page.evaluate(() => localStorage.getItem("zf-name")), "Everyday phone");
  await page.evaluate(() => {
    globalThis.__glassInput = document.getElementById("glass-test-name");
    document.documentElement.dataset.theme = "light";
    globalThis.zigsGlass.flush();
  });
  assert.equal(await field.inputValue(), "Everyday phone", "theme changes preserve typed input");
  assert.equal(await page.evaluate(() => globalThis.__glassInput === document.getElementById("glass-test-name")), true);
  await page.evaluate(async () => {
    const { el } = await import("/app-dom.js");
    const input = el("input", { id: "cached-native-input", value: "Keep this draft" });
    const slot = el("section", { class: "card" }, input);
    document.getElementById("app").append(slot);
    globalThis.zigsGlass.flush();
    globalThis.__glassSlot = slot;
    slot.remove();
    globalThis.zigsGlass.flush();
    document.getElementById("app").append(slot);
    globalThis.zigsGlass.flush();
  });
  assert.equal(await page.locator("#cached-native-input").inputValue(), "Keep this draft", "cached cards preserve native children");
  await page.evaluate(() => {
    globalThis.__glassSlot.remove();
    document.getElementById("glass-field-slot").remove();
    delete globalThis.__glassSlot;
    delete globalThis.__glassInput;
  });
  assert.deepEqual(errors, [], "no browser runtime errors");

  // A fresh browser also boots the real app with the same shim injection and strict CSP as
  // the Worker. No external service or existing wallet is involved in this local smoke test.
  const boot = await browser.newContext({ reducedMotion: "reduce" });
  const bootPage = await boot.newPage();
  const bootErrors = [];
  bootPage.on("pageerror", (error) => bootErrors.push(error.message));
  await bootPage.addInitScript(() => {
    globalThis.__policyViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      globalThis.__policyViolations.push(event.violatedDirective + ": " + event.blockedURI);
    });
  });
  const origin = "http://127.0.0.1:55847";
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".wasm": "application/wasm", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
  const csp = ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self'",
    "style-src 'self'", "font-src 'self'", "img-src 'self' data: blob:", "connect-src 'self'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
  await boot.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const file = resolve("web", url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (!file.startsWith(resolve("web") + "/") || !existsSync(file))
      return route.fulfill({ status: 404, body: "" });
    const html = url.pathname === "/";
    const bytes = readFileSync(file);
    return route.fulfill({ body: html ? bytes.toString().replace("<title>", '<script src="/shim.js"></script><title>') : bytes,
      contentType: mime[extname(file)] || "application/octet-stream", headers: html ? { "Content-Security-Policy": csp } : {} });
  });
  await bootPage.goto(origin);
  await bootPage.locator("#welcome-title").waitFor();
  assert.match(await bootPage.locator("#welcome-title").innerText(), /Your assets\s*Secured together/);
  await bootPage.waitForFunction(() => document.getElementById("engine-dot").classList.contains("ok"));
  assert.deepEqual(bootErrors, [], "real app boots without JavaScript errors");
  assert.deepEqual(await bootPage.evaluate(() => globalThis.__policyViolations), [], "no CSP violations");
  await boot.close();
  console.log(`OpenGlass browser checks passed. Screenshots: ${out}`);
} catch (error) {
  console.error(JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(0, 4000) }, null, 2));
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
