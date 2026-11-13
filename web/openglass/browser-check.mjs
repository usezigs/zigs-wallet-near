// Real React components + the existing isolated wallet renderer fixture. No funds or writes.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const heroLayouts = [];
page.on("pageerror", (error) => errors.push(error.stack));

async function checkWelcomeHero(target, name) {
  const hero = target.locator(".home-hero");
  await hero.locator(":scope > .openglass-backdrop-slot > [data-ogui-glass]").waitFor();
  await target.evaluate(async () => {
    await document.fonts.ready;
    await document.querySelector(".home-hero-art").decode();
  });
  for (const theme of ["dark", "light"]) for (const width of [1440, 390, 320]) {
    await target.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await target.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await target.waitForFunction(value => document.querySelector(".zigs-openglass")?.dataset.oguiAppearance === value, theme);
    await settleOverview(target);
    const paint = await hero.evaluate(node => {
      const slot = node.querySelector(":scope > .openglass-backdrop-slot");
      const material = slot.firstElementChild;
      const order = element => Number(getComputedStyle(element).zIndex);
      return { materialZ: order(slot), artZ: order(node.querySelector(".welcome-brand")),
        scrimZ: Number(getComputedStyle(node, "::after").zIndex),
        contentZ: order(node.querySelector(".welcome-intro")),
        filter: getComputedStyle(material).backdropFilter,
        fill: getComputedStyle(material).backgroundImage,
        pointerEvents: getComputedStyle(slot).pointerEvents,
        secondaryInk: [...node.querySelectorAll(".welcome-secondary-actions .btn")].map(button => getComputedStyle(button).color),
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.ok(paint.materialZ > paint.artZ && paint.materialZ > paint.scrimZ,
      `${name}: glass is visibly above the artwork and scrim`);
    assert.ok(paint.contentZ > paint.materialZ, `${name}: glass never blurs the copy or controls`);
    assert.notEqual(paint.fill, "none", `${name}: visible glass sheen`);
    const blur = Number(/blur\(([\d.]+)px\)/.exec(paint.filter)?.[1]);
    assert.ok(blur > 0 && blur <= 1, `${name}: shallow refraction preserves the zebra detail`);
    assert.equal(paint.pointerEvents, "none", `${name}: glass does not intercept actions`);
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(value => {
      const channel = Number(value) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
    // Compare with the brightest part of the smoked glass behind these small links.
    assert.ok(paint.secondaryInk.every(color => (luminance(color) + .05) / (luminance("rgb(58, 61, 65)") + .05) >= 4.5),
      `${name}: secondary hero actions keep readable contrast in either theme`);
    assert.equal(paint.pageOverflow, false, `${name} ${theme} ${width}: welcome fits`);
    heroLayouts.push({ name, theme, width, ...paint });
    await target.screenshot({ path: `${out}/${name}-${theme}-${width}.png`, fullPage: true, animations: "disabled" });
  }
}

try {
  await overviewFixture(context, page);
  await settleOverview(page);
  assert.ok(await page.locator("[data-ogui-glass]").count() >= 2, "live Glass surfaces");
  assert.ok(await page.locator(".card.openglass-sheet").count() >= 2, "shared cards keep native layouts with Glass materials");
  assert.ok(await page.locator(".ogui-button").count() >= 8, "navigation uses Button");
  assert.equal(await page.locator(".ogui-stat").count(), 1, "balance uses Stat");
  assert.equal(await page.locator("#total-balance-title").textContent(), "Wallet balance");

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
      assert.equal(await page.evaluate(() => {
        const expected = getComputedStyle(document.querySelector(".ogui-stat strong")).color;
        return [...document.querySelectorAll(".overview-actions .btn:not(.primary):not(:disabled)")]
          .every((node) => getComputedStyle(node).color === expected);
      }), true, `${theme} ${width}: secondary wallet actions use readable theme ink`);
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
  // Cover the exact guided Connect screen, which previously escaped the glass migration.
  const setupContext = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce", colorScheme: "dark" });
  const setup = await setupContext.newPage();
  setup.setDefaultTimeout(5000);
  setup.on("pageerror", (error) => errors.push(error.stack));
  await overviewFixture(setupContext, setup);
  // Exercise every destination using its real renderer, without network submissions.
  for (const tab of ["approvals", "activity", "recipients", "swap", "chats", "recovery", "settings", "overview"]) {
    await setup.locator("#tab-" + tab).click();
    await settleOverview(setup);
    assert.ok(await setup.locator("#app [data-ogui-glass], #app .ogui-card").count() > 0,
      `${tab}: shared material reaches the destination`);
    assert.equal(await setup.locator("#app :is(button, summary, a).btn:not(.ogui-button):not(.openglass-control)").count(), 0,
      `${tab}: no untreated native action buttons`);
    assert.ok(await setup.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${tab}: no desktop horizontal overflow`);
  }
  const receivePicker = setup.locator(".overview-action-picker").nth(1);
  await receivePicker.locator("summary").click();
  await receivePicker.locator(".asset-choice").first().click();
  await setup.getByRole("dialog").waitFor();
  assert.equal(await setup.locator(".receive-dialog > .openglass-backdrop-slot [data-ogui-material=frosted]").count(), 1);
  await setup.keyboard.press("Escape");
  await setup.getByRole("dialog").waitFor({ state: "detached" });
  await setup.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    const { setSecrets, setGkeys } = await import("/app-keystore.js");
    const { beginGuided } = await import("/app-guided-setup.js");
    state.g = { ...state.g, name: "Treasury", network: "mainnet" };
    state.wallet = null;
    state.seats = { 1: { uid: "synthetic-device", boxPk: "11".repeat(32), signPk: "22".repeat(32) } };
    setSecrets({ [state.gid + ":1"]: { uid: "synthetic-device", version: 3,
      boxPk: "11".repeat(32), signPk: "22".repeat(32), signSk: "33".repeat(32) } });
    setGkeys({ [state.gid]: "00".repeat(32) });
    ui.tab = "overview";
    beginGuided(state.gid);
    (await import("/app-loop.js")).draw();
  });
  await setup.getByRole("heading", { name: "Connect your second device" }).waitFor();
  assert.equal(await setup.locator(".setup-wallet-status > .openglass-backdrop-slot [data-ogui-material=regular]").count(), 1);
  assert.equal(await setup.locator(".setup-device-row > .openglass-backdrop-slot [data-ogui-glass]").count(), 3);
  assert.equal(await setup.locator(".guided-invitation.openglass-sheet").count(), 1);
  assert.equal(await setup.locator(".setup-invite-actions button.ogui-button").count(), 3);
  for (const theme of ["dark", "light"]) for (const width of [1440, 390, 320]) {
    await setup.setViewportSize({ width, height: width < 761 ? 844 : 1000 });
    await setup.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await settleOverview(setup);
    assert.ok(await setup.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Connect ${theme} ${width}: no horizontal overflow`);
    await setup.screenshot({ path: `${out}/connect-${theme}-${width}.png`, fullPage: true });
  }
  await setup.setViewportSize({ width: 1440, height: 1000 });
  await setup.getByRole("button", { name: "Show QR code", exact: true }).click();
  await setup.getByRole("dialog").waitFor();
  assert.equal(await setup.locator(".setup-qr-dialog > .openglass-backdrop-slot [data-ogui-material=frosted]").count(), 1);
  for (let i = 0; i < 8; i++) {
    await setup.keyboard.press("Tab");
    assert.ok(await setup.evaluate(() => !!document.activeElement.closest('[role="dialog"]')),
      "Connect invitation retains keyboard containment");
  }
  await setup.keyboard.press("Escape");
  await setup.getByRole("dialog").waitFor({ state: "detached" });
  await setup.getByRole("button", { name: "Show QR code", exact: true }).waitFor({ state: "visible" });
  await setupContext.close();

  // Native form controls held by wallet code keep identity and async disabled state.
  await page.evaluate(async () => {
    const { el } = await import("/app-dom.js");
    const button = el("button", { class: "btn", id: "native-held-button", type: "button" }, "Native action");
    document.getElementById("app").append(button);
    globalThis.__heldGlassButton = button;
    globalThis.zigsGlass.flush();
    button.disabled = true;
    document.documentElement.dataset.theme = "dark";
    globalThis.zigsGlass.flush();
  });
  assert.equal(await page.evaluate(() => globalThis.__heldGlassButton === document.getElementById("native-held-button")), true);
  assert.equal(await page.locator("#native-held-button").isDisabled(), true);
  assert.equal(await page.locator("#native-held-button > .openglass-backdrop-slot [data-ogui-glass]").count(), 1);
  await page.evaluate(() => { globalThis.__heldGlassButton.remove(); delete globalThis.__heldGlassButton; });
  await page.emulateMedia({ forcedColors: "active" });
  assert.equal(await page.locator(".openglass-sheet-material").first().evaluate((node) => getComputedStyle(node).backdropFilter), "none");
  assert.equal(await page.locator(".side").evaluate(node => getComputedStyle(node).backdropFilter), "none",
    "Sidebar uses the opaque forced-colors fallback");
  await page.emulateMedia({ forcedColors: "none" });
  assert.deepEqual(errors, [], "no browser runtime errors");

  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    state.g = null; state.gid = null; ui.tab = "overview";
    (await import("/app-loop.js")).draw();
  });
  await checkWelcomeHero(page, "welcome-returning");

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
  await bootPage.getByRole("heading", { name: "Private by design. Secured together." }).waitFor();
  await bootPage.waitForFunction(() => document.getElementById("engine-dot").classList.contains("ok"));
  await checkWelcomeHero(bootPage, "welcome-new");
  // The decorative layer must not stop the actual welcome entry controls working.
  await bootPage.getByRole("button", { name: "Join a wallet", exact: true }).click();
  await bootPage.getByRole("textbox", { name: "Invite link", exact: true }).fill("Synthetic invitation draft");
  assert.equal(await bootPage.getByRole("textbox", { name: "Invite link", exact: true }).inputValue(), "Synthetic invitation draft");
  await bootPage.getByRole("button", { name: "Join a wallet", exact: true }).click();
  await bootPage.setViewportSize({ width: 1440, height: 1000 });
  await bootPage.emulateMedia({ reducedMotion: "no-preference" });
  const heroRim = bootPage.locator(".home-hero > .openglass-backdrop-slot .openglass-edge-shine");
  await bootPage.locator(".home-hero").hover();
  await bootPage.waitForFunction(() => {
    const rim = document.querySelector(".home-hero > .openglass-backdrop-slot .openglass-edge-shine");
    return rim?.hasAttribute("data-openglass-visible") && getComputedStyle(rim).animationName === "openglass-rim-light";
  });
  await bootPage.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await heroRim.evaluate(node => getComputedStyle(node).animationName), "none", "Reduced motion stops hero reflections");
  const cdp = await boot.newCDPSession(bootPage);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  const heroMaterial = bootPage.locator(".home-hero > .openglass-backdrop-slot > [data-ogui-glass]");
  assert.equal(await heroMaterial.evaluate(node => getComputedStyle(node).backdropFilter), "none");
  assert.equal(await heroMaterial.evaluate(node => getComputedStyle(node).backgroundColor), "rgb(16, 21, 29)");
  assert.equal(await bootPage.locator(".side").evaluate(node => getComputedStyle(node).backdropFilter), "none",
    "Sidebar respects reduced transparency");
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  await bootPage.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  assert.equal(await heroMaterial.evaluate(node => getComputedStyle(node).backdropFilter), "none");
  assert.equal(await heroRim.evaluate(node => getComputedStyle(node).display), "none");
  await bootPage.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  await bootPage.getByRole("button", { name: "Create wallet", exact: true }).click();
  await bootPage.getByRole("dialog").waitFor();
  await bootPage.keyboard.press("Escape");
  await bootPage.getByRole("dialog").waitFor({ state: "detached" });
  assert.deepEqual(bootErrors, [], "real app boots without JavaScript errors");
  assert.deepEqual(await bootPage.evaluate(() => globalThis.__policyViolations), [], "no CSP violations");
  writeFileSync(`${out}/welcome-hero-report.json`, JSON.stringify({ passed: true, layouts: heroLayouts,
    checks: ["visible material above artwork", "crisp copy above material", "shallow refraction", "readable secondary actions",
      "responsive fit", "working Join/Create controls", "hover reflections", "reduced motion", "reduced transparency", "forced colors", "strict CSP"],
    runtimeErrors: [...errors, ...bootErrors] }, null, 2));
  await boot.close();
  console.log(`OpenGlass browser checks passed. Screenshots: ${out}`);
} catch (error) {
  console.error(JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(0, 4000) }, null, 2));
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
