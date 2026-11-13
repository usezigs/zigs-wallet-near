// Isolated synthetic wallet data exercises the production component, real WASM encryption and
// dashboard integration. It never contacts a wallet server, holds funds, or submits transactions.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = resolve(process.env.ZIGS_PORTFOLIO_OUTPUT || "/private/tmp/zigs-tracker-review");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext();
const page = await context.newPage(), errors = [], checks = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (pass, label) => { checks.push({ pass: !!pass, label }); assert.ok(pass, label); };
async function settleChart() {
  await settleOverview(page);
  await page.waitForFunction(() => {
    const root = document.querySelector(".portfolio-chart");
    return root?.dataset.animating === "false" && root.getAnimations({ subtree: true })
      .every((animation) => animation.playState !== "running");
  });
}
await page.setViewportSize({ width: 1440, height: 1000 });
await overviewFixture(context, page);
let priceRequests = 0;
await context.route("**/portfolio/prices", (route) => {
  priceRequests++;
  return route.fulfill({ contentType: "application/json", body: JSON.stringify({
    source: "coingecko", prices: { zec: { usd: 245.8293, at: Date.now() } } }) });
});

async function seedHistory() {
  await page.evaluate(async () => {
    const Z = await import("/pkg/zigs_engine.js"); await Z.default();
    (await import("/app-engine.js")).setZ(Z);
    const { state, ui } = await import("/app-state.js");
    const { signPins } = await import("/app-filter.js");
    const { gkeys } = await import("/app-keystore.js");
    const { valuePortfolio } = await import("/portfolio-model.js");
    const { createPortfolioStore } = await import("/portfolio-store.js");
    const chain = await import("/app-chain.js");
    state.g.network = "mainnet"; state.g.name = "Chart QA · synthetic wallet";
    signPins["confirmednet:" + state.gid] = "mainnet";
    gkeys[state.gid] = btoa("x".repeat(32)).replace(/=+$/, ""); ui.plainServed = false;
    const key = gkeys[state.gid], aad = "portfolio-v1\nmainnet\n" + state.gid;
    const now = Date.now(), observations = [];
    for (let i = 0; i <= 720; i++) {
      const t = i / 720, at = now - (720 - i) * 60_000;
      const usd = 232.9951 + 12.8342 * t + 1.8 * Math.sin(t * Math.PI * 6)
        + .6 * Math.sin(t * Math.PI * 19) * (1 - t);
      observations.push(valuePortfolio([{ asset: "zec", amount: 100, at }],
        { zec: { usd, at } }, at).observation);
    }
    localStorage.setItem("zf-portfolio-mainnet-" + state.gid,
      Z.secretSeal(key, aad, JSON.stringify({ version: 1, observations })));
    globalThis.__portfolioQA = { observations, now };
    chain.setChain({ gid: state.gid, balAt: now, birthday: 4528000, cw: { free() {} },
      bal: { spendable: 10_000_000_000, pending: 0, max_send: 10_000_000_000,
        height: 4528665, tip: 4528665 }, sent: new Set(), received: [] });
    // Exercise decrypt/validation through the same adapter used in production.
    const store = createPortfolioStore({ storage: localStorage,
      key: "zf-portfolio-mainnet-" + state.gid,
      seal: (text) => Z.secretSeal(key, aad, text), open: (box) => Z.secretOpen(key, aad, box) });
    if (store.read().observations.length !== 721)
      throw Error("Encrypted observations did not load");
    (await import("/app-loop.js")).draw();
  });
  await page.waitForFunction(() => document.querySelector(".portfolio-chart-value")
    ?.textContent === "$24,582.93");
  await settleOverview(page);
}
await seedHistory();
const plot = page.getByRole("slider", { name: "Explore portfolio history" });
check(await page.locator(".portfolio-chart-line").getAttribute("d") !== "",
  "live SVG line renders");
check(priceRequests === 1, "one fixed market request, cached across range changes");

async function interactions() {
  const box = await plot.boundingBox();
  await page.mouse.move(box.x + 8, box.y + 70);
  await page.waitForFunction(() => document.querySelector(".portfolio-chart-value")
    .textContent === "$23,299.51");
  check(await page.locator(".portfolio-chart").getAttribute("data-scrubbing") === "true",
    "pointer scrubs historical value and date");
  const onLine = await page.evaluate(() => {
    const marker = document.querySelector(".portfolio-chart-marker");
    const path = document.querySelector(".portfolio-chart-line");
    const x = Number(marker.getAttribute("cx")), y = Number(marker.getAttribute("cy"));
    let lo = 0, hi = path.getTotalLength();
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (path.getPointAtLength(mid).x < x) lo = mid; else hi = mid;
    }
    return Math.abs(path.getPointAtLength((lo + hi) / 2).y - y) < .05;
  });
  check(onLine, "marker sits precisely on the actual rendered cubic");
  await page.mouse.move(box.x + box.width + 20, box.y);
  await page.waitForFunction(() => document.querySelector(".portfolio-chart-value")
    .textContent === "$24,582.93");
  await plot.focus(); await plot.press("Home");
  await page.evaluate(async () => { (await import("/app-loop.js")).draw(); });
  check(await plot.evaluate((node) => document.activeElement === node),
    "focused slider stays connected and focused through a wallet update");
  await plot.press("ArrowRight");
  check(Number(await plot.getAttribute("aria-valuenow")) === 1, "keyboard explores observations");
  await plot.press("End"); await plot.press("Escape");
  check(await page.locator(".portfolio-chart-date").innerText() === "Current balance",
    "Escape resets");
  for (const range of ["1D", "1W", "1M", "3M", "1Y", "ALL"]) {
    const button = page.getByRole("button", { name: range, exact: true });
    await button.click();
    check(await button.getAttribute("aria-pressed") === "true", range + " selected");
  }
  check(priceRequests === 1, "range exploration never refetches cached history or prices");
  await page.getByRole("button", { name: "1M", exact: true }).click();
  await page.getByRole("button", { name: "1M", exact: true }).press("ArrowRight");
  check(await page.getByRole("button", { name: "3M", exact: true })
    .getAttribute("aria-pressed") === "true", "ranges support arrow keys");
  await page.getByRole("button", { name: "1M", exact: true }).click();
  await page.evaluate(async () => {
    const chart = document.querySelector(".portfolio-chart");
    (await import("/app-loop.js")).draw();
    if (chart !== document.querySelector(".portfolio-chart"))
      throw Error("Chart remounted on redraw");
  });
  check(true, "wallet status redraw retains component identity");
  await settleChart();
}
await interactions();

async function touchInteraction() {
  await page.setViewportSize({ width: 390, height: 844 });
  await plot.scrollIntoViewIfNeeded();
  await settleChart();
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const box = await plot.boundingBox(), x = box.x + 50, y = box.y + 80;
  const points = (at) => [{ x: at, y, id: 1 }];
  await plot.evaluate((node) => node.addEventListener("gotpointercapture", (ev) => {
    globalThis.__portfolioPointer = ev.pointerId;
  }, { once: true }));
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(x) });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(x + 30) });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove", touchPoints: points(x + 120) });
  await page.waitForFunction(() => document.querySelector(".portfolio-chart")
    .dataset.scrubbing === "true");
  check(true, "horizontal touch gesture scrubs with pointer capture");
  await page.evaluate(() => {
    globalThis.__portfolioDelayedDraw = false;
    setTimeout(async () => {
      (await import("/app-chain.js")).curChain().balAt = Date.now();
      (await import("/app-loop.js")).draw();
      globalThis.__portfolioDelayedDraw = true;
    }, 1100);
  });
  await page.waitForFunction(() => globalThis.__portfolioDelayedDraw);
  check(await plot.evaluate((node) => node.isConnected
    && node.hasPointerCapture(globalThis.__portfolioPointer)),
  "captured touch stays connected beyond a queued wallet update");
  check(await page.locator(".portfolio-chart").getAttribute("data-scrubbing") === "true",
    "queued wallet update keeps the selected historical observation");
  const previous = await plot.getAttribute("aria-valuenow");
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove", touchPoints: points(x + 150) });
  await page.waitForFunction((previous) => document.querySelector(".portfolio-chart-plot")
    .getAttribute("aria-valuenow") !== previous, previous);
  check(true, "touch continues scrubbing after the queued update");
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => document.querySelector(".portfolio-chart")
    .dataset.scrubbing === "false");
  check(true, "touch release restores current value");
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(x) });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(x + 50) });
  await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  check(await page.locator(".portfolio-chart").getAttribute("data-scrubbing") === "false",
    "touch cancellation resets gracefully");
  check(await plot.evaluate((node) => getComputedStyle(node).touchAction.includes("pan-y")),
    "vertical page scrolling remains available");
  await client.detach();
  await page.evaluate(() => window.scrollTo(0, 0));
  await settleChart();
}
await touchInteraction();

async function captureMatrix() {
  for (const width of [1440, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      await settleChart();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        width + " " + theme + ": no horizontal overflow");
      check(await page.locator(".portfolio-chart-ranges button").evaluateAll((buttons) =>
        buttons.every((b) => b.getBoundingClientRect().height >= 44)), "44px range targets");
      if (width === 1440 || width === 390) await page.screenshot({
        path: resolve(output, (width === 1440 ? "desktop" : "mobile") + "-" + theme + ".png"),
        fullPage: true });
    }
  }
}
await captureMatrix();

async function retryRecovery() {
  await page.evaluate(() => {
    const { component, props } = globalThis.__portfolioState;
    globalThis.__portfolioRetryCalls = 0;
    const next = { ...props, observations: [], current: { ...props.current, value: null },
      failed: true, retryAfterMs: 100, onRetry() {
        globalThis.__portfolioRetryCalls++;
        component.update({ ...next, loading: true, retryAfterMs: 0 });
      } };
    component.update(next);
  });
  await page.waitForFunction(() => !document.querySelector(".portfolio-retry").disabled);
  await page.locator(".portfolio-retry").click();
  check(await page.evaluate(() => globalThis.__portfolioRetryCalls === 1),
    "retry becomes actionable when backoff expires");
  check(await page.locator(".portfolio-retry").innerText() === "Retrying…",
    "retry provides explicit loading feedback");
}

async function componentStates() {
  // The exact production component, mounted inside the actual wallet balance panel.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.activeElement?.blur());
  await settleChart();
  await page.evaluate(async () => {
    const { createPortfolioChart } = await import("/portfolio-chart.js");
    const { valuePortfolio } = await import("/portfolio-model.js");
    const now = Date.now(), { observations } = globalThis.__portfolioQA;
    const current = valuePortfolio([{ asset: "zec", amount: 100, at: now }],
      { zec: { usd: 245.8293, at: now } }, now);
    const props = { observations, current, now, range: "1D", loading: false, failed: false,
      storageNote: "", onRange() {}, onRetry() {} };
    const slot = document.querySelector(".portfolio-slot");
    const component = createPortfolioChart(props, { animateEntry: false });
    slot.replaceChildren(component.element); component.mount();
    globalThis.__portfolioState = { component, props };
  });
  const states = ["zero", "single", "empty", "partial", "loading", "error",
    "negative", "gap", "large"];
  for (const state of states) {
    await page.evaluate((state) => {
      const { component, props } = globalThis.__portfolioState;
      const current = { ...props.current }, next = { ...props, current };
      if (["empty", "loading", "error"].includes(state)) {
        next.observations = []; current.value = null; current.observation = null;
      }
      if (state === "loading") next.loading = true;
      if (state === "error") next.failed = true;
      if (state === "error") next.retryAfterMs = 30_000;
      const updates = {
        single() { next.observations = props.observations.slice(-1); },
        partial() { current.missing = ["sol"]; },
        large() { current.value = 999_999_999_999.99; },
        zero() {
        current.value = 0;
        next.observations = props.observations.map((p) => ({ ...p, value: 0 }));
        },
        negative() {
        current.value = 22000;
        next.observations = props.observations.map((p, i) => ({ ...p,
          value: 24000 - i / 720 * 2000 }));
        },
        gap() { next.observations = props.observations.filter((_, i) => i < 300 || i > 400); },
      };
      updates[state]?.();
      component.update(next);
    }, state);
    await settleChart();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      state + ": no layout overflow");
    if (["empty", "loading", "error"].includes(state)) check(
      await page.locator(".portfolio-chart-end").evaluate((node) =>
        getComputedStyle(node).display === "none"), state + ": no invented endpoint");
    if (state === "error") check(await page.locator(".portfolio-retry").isDisabled(),
      "retry backoff has a disabled control with a countdown");
    await page.locator(".overview-portfolio").screenshot({
      path: resolve(output, "state-" + state + ".png") });
  }
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => {
      const { component, props } = globalThis.__portfolioState; component.update(props);
    });
    await settleChart();
    const before = await plot.evaluate((node) => node.getBoundingClientRect().y
      - node.closest(".portfolio-chart").getBoundingClientRect().y);
    await page.evaluate(() => {
      const { component, props } = globalThis.__portfolioState;
      component.update({ ...props, current: { ...props.current, value: 999_999_999_999.99 } });
    });
    await settleChart();
    const after = await plot.evaluate((node) => node.getBoundingClientRect().y
      - node.closest(".portfolio-chart").getBoundingClientRect().y);
    check(Math.abs(before - after) < 1, width + ": large values keep the chart position fixed");
    check(await page.locator(".portfolio-chart-value").evaluate((node) =>
      node.scrollWidth <= node.clientWidth + 1), width + ": complete large balance fits");
    await page.locator(".overview-portfolio").screenshot({
      path: resolve(output, "large-" + width + ".png") });
  }
  await retryRecovery();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    const { component, props } = globalThis.__portfolioState; component.update(props);
  });
  await plot.focus(); await plot.press("Home");
  await page.waitForFunction(() => document.querySelector(".portfolio-chart-value")
    .textContent === "$23,299.51");
  check(true, "reduced motion retains precise keyboard interaction");
}
await componentStates();
check(errors.length === 0, "no browser exceptions: " + errors.join(", "));
writeFileSync(resolve(output, "checks.json"),
  JSON.stringify({ checks, errors, priceRequests }, null, 2));
console.log("portfolio browser: " + checks.length + " checks passed; captures: " + output);
await browser.close();
