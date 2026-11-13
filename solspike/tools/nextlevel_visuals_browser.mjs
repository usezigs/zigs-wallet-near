// Production renderers with isolated, non-payable samples. No server, wallet boot or broadcast.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { chromium } = require("playwright");
const out = resolve(process.env.ZIGS_VISUALS_OUTPUT || "/private/tmp/zigs-nextlevel-review");
mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (pass, name) => { checks.push({ pass: !!pass, name }); assert.ok(pass, name); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE ||
     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440,
   height: 1000 } });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.stack));
page.setDefaultTimeout(10000);
const capture = (name) => page.screenshot({ path: resolve(out, name + ".png"), fullPage: true });
const facts = () => page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > innerWidth + 1,
  clipped: [...document.querySelectorAll(
    ".asset-row .money,.approval-count strong,.wallet-reveal-name")]
    .some((node) => node.scrollWidth > node.clientWidth + 1),
}));

async function matrix(name) {
  for (const width of [1440, 390, 320]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 1000 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await settleOverview(page);
    const layout = await facts();
    check(!layout.overflow && !layout.clipped,
       `${name}: ${width}px ${theme} fits without clipping`);
    await capture(`${name}-${width}-${theme}`);
  }
}

async function portfolio() {
  await context.route("**/portfolio/prices", (route) => route.fulfill({ contentType:
     "application/json",
    body: JSON.stringify({ source: "coingecko", prices: { zec: { usd: 245.8293, at:
       Date.now() } } }) }));
  await page.evaluate(async () => {
    const Z = await import("/pkg/zigs_engine.js"); await Z.default();
    (await import("/app-engine.js")).setZ(Z);
    const { state, ui } = await import("/app-state.js");
    const { signPins } = await import("/app-filter.js");
    const { gkeys, setSecrets } = await import("/app-keystore.js");
    const { FLOW_FIXTURES } = await import("/dev/metal-orbs/flow-fixtures.js");
    const { valuePortfolio } = await import("/portfolio-model.js");
    state.g.network = "mainnet"; state.g.name = "Studio wallet";
    state.wallet.network = "mainnet";
    state.wallet.address = "u1" + FLOW_FIXTURES.everyday.zcash.address.slice(6);
    state.seats[1].uid = "visual-fixture";
    state.seats[1].signPk = "synthetic-non-signing";
    (await import("/app-groups.js")).setMe("visual-fixture");
    setSecrets({ [state.gid + ":1"]: { uid: "visual-fixture", keyPackage: "synthetic-non-signing",
      signSk: "synthetic-non-signing", signPk: "synthetic-non-signing",
      checkedWallet: JSON.stringify(state.wallet) } });
    signPins["confirmednet:" + state.gid] = "mainnet";
    gkeys[state.gid] = btoa("x".repeat(32)).replace(/=+$/, ""); ui.plainServed = false;
    (await import("/app-sol.js")).overviewFixturePlain();
    const now = Date.now(), observations = [];
    for (let i = 0; i <= 720; i++) {
      const t = i / 720, at = now - (720 - i) * 60000;
      const usd = 232.9951 + 12.8342 * t + 1.8 * Math.sin(t * Math.PI * 6);
      observations.push(valuePortfolio([{ asset: "zec", amount: 100, at },
        { asset: "sol", amount: 0, at }, { asset: "usdc", amount: 0, at }], { zec: { usd, at } },
           at).observation);
    }
    localStorage.setItem("zf-portfolio-mainnet-" + state.gid, Z.secretSeal(gkeys[state.gid],
      "portfolio-v1\nmainnet\n" + state.gid, JSON.stringify({ version: 1, observations })));
    (await import("/app-chain.js")).setChain({ gid: state.gid, balAt: now, birthday: 4528000, cw:
       { free() {} },
      bal: { spendable: 10_000_000_000, pending: 0, max_send: 10_000_000_000,
        height: 4528665, tip: 4528665 }, sent: new Set(), received: [] });
    (await import("/app-loop.js")).draw();
  });
  await page.waitForFunction(() => document.querySelector(
    ".portfolio-chart-value")?.textContent === "$24,582.93");
  check(await page.locator(".asset-rows .asset-row").count() === 3,
    "portfolio sample retains the real ZEC, SOL and USDC layout");
  await matrix("portfolio");
  const plot = page.getByRole("slider", { name: "Explore portfolio history" });
  await plot.focus(); await plot.press("Home");
  await page.waitForFunction(() => document.querySelector(
    ".portfolio-chart-value")?.textContent !== "$24,582.93");
  check((await page.locator(".portfolio-chart-value").textContent()) !== "$24,582.93",
     "chart keyboard still explores history");
  await plot.press("Escape");
  await page.waitForFunction(() => document.querySelector(
    ".portfolio-chart-value")?.textContent === "$24,582.93");
  await page.evaluate(async () => (await import("/app-loop.js")).draw());
  check(await plot.evaluate((node) => node === document.activeElement),
     "wallet redraw preserves chart focus");
}

async function approvals() {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const result = await page.evaluate(async () => {
    const { ApprovalVisualization } = await import("/app-approval-visualization.js");
    const { createMotionController } = await import("/app-motion.js");
    const host = document.createElement("div"); host.style.cssText =
       "max-width:640px;margin:24px auto";
    globalThis.__messagingView = () => host;
    document.getElementById("app").replaceChildren(host);
    const media = matchMedia("(prefers-reduced-motion:reduce)");
    const controller = createMotionController({ document, media });
    const draw = (count, extra = {}) => {
      host.replaceChildren(ApprovalVisualization({ required: 2, total: 3, confirmed: count,
        context: "synthetic-approval", stage: { title: "Waiting for approvals", detail:
           "Synthetic presentation sample" },
        participants: ["Phone", "Laptop", "Recovery device"].map((name, index) => ({ id:
           index + 1, name,
          confirmed: index < count, motionValue: index < count ? "on" : "off" })), ...extra }));
      controller.present({ view: host, identity: { wallet: "synthetic", panel: "approval",
         session: "sample" } });
    };
    draw(1);
    const historical = host.querySelectorAll("[data-motion-library]").length;
    draw(2);
    const effects = host.querySelectorAll("[data-motion-library=motion]");
    const animated = effects.length, correct = effects.length > 0 &&
       effects[0].closest(".signer-node").textContent.includes("Laptop");
    const active =
       effects[0]?.getAnimations().some((animation) => animation.playState === "running");
    const playbacks = effects[0]?.getAnimations() || [];
    let moves = false;
    if (playbacks.length) {
      playbacks.forEach((playback) => { playback.pause(); playback.currentTime = 260; });
      const first = getComputedStyle(effects[0]).strokeDashoffset;
      playbacks.forEach((playback) => { playback.currentTime = 460; });
      moves = first !== getComputedStyle(effects[0]).strokeDashoffset
        && Number(getComputedStyle(effects[0]).opacity) > .9;
    }
    const ring = host.querySelector(".approval-quorum-value").getAttribute("stroke-dasharray");
    draw(2);
    const repeated = host.querySelectorAll("[data-motion-library]").length;
    draw(null, { participants: undefined });
    const unknown = host.querySelector(".approval-quorum-fraction").textContent.startsWith("—")
      && host.textContent.includes("Count unavailable");
    draw(1, { confirmed: 2 });
    const mismatch = host.querySelectorAll(".signer-node").length;
    controller.destroy();
    globalThis.__visualApproval = { host, draw, controller: createMotionController({ document,
       media }) };
    globalThis.__visualApproval.draw = (count) => {
      host.replaceChildren(ApprovalVisualization({ required: 2, total: 3, confirmed: count,
        context: "synthetic-approval", stage: { title: "Approvals are complete", detail:
           "Signing and submission are separate steps." },
        participants: ["Phone", "Laptop", "Recovery device"].map((name, index) => ({ id:
           index + 1, name,
          confirmed: index < count, motionValue: index < count ? "on" : "off" })) }));
      globalThis.__visualApproval.controller.present({ view: host, identity: { wallet: "sample",
         panel: "approvals" } });
    };
    globalThis.__visualApproval.draw(1);
    return { historical, animated, correct, active, moves, repeated, ring, unknown, mismatch };
  });
  check(result.historical === 0 && result.animated === 1 && result.correct && result.active &&
     result.moves,
    "real Motion animates only the newly recorded device approval: " + JSON.stringify(result));
  check(result.repeated === 0, "ordinary redraw never replays an approval");
  check(result.ring === "100 100" && result.unknown && result.mismatch === 0,
    "quorum uses known counts and preserves unknown/inconsistent record fallbacks");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => globalThis.__visualApproval.draw(2));
  check(await page.locator("[data-motion-library]").count() === 0,
     "reduced motion suppresses the event trace");
  await matrix("approvals");
  await page.emulateMedia({ forcedColors: "active" });
  check(await page.locator(".approval-medallion").first().evaluate((node) => getComputedStyle(
    node).display === "none"),
    "forced colors removes decorative traces and retains the approval text");
  await page.emulateMedia({ forcedColors: "none" });
  await page.evaluate(() => { globalThis.__visualApproval.controller.destroy();
     delete globalThis.__visualApproval; });
}

async function reveal() {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const result = await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    const { setSecrets } = await import("/app-keystore.js");
    const { FLOW_FIXTURES } = await import("/dev/metal-orbs/flow-fixtures.js");
    const { walletReveal, presentWalletReveal } = await import("/app-wallet-art.js");
    const { presentWalletMarble } = await import("/wallet-marble.js");
    Object.assign(state, { gid: "synthetic-reveal", g: { id: "synthetic-reveal", name:
       "Studio wallet", version: 1, n: 3, t: 2, network: "testnet" },
      wallet: { address: FLOW_FIXTURES.ember.zcash.address, birthday: 1, network: "testnet" },
      seats: { 1: { uid: "visual-fixture" } }, verify: {} });
    setSecrets({ [state.gid + ":1"]: { uid: "visual-fixture", keyPackage: "synthetic-non-signing",
      checkedWallet: JSON.stringify(state.wallet) } });
    const before = JSON.stringify(state.wallet);
    let continued = false;
    const node = walletReveal(state.g, () => { continued = true; });
    globalThis.__messagingView = () => node;
    document.getElementById("app").replaceChildren(node);
    presentWalletMarble(document); presentWalletReveal(document);
    globalThis.__visualReveal = { node, before, presentWalletReveal, get continued() {
       return continued; } };
    return { ready: !!node, enabled:
       !node.querySelector("button[data-key=wallet-reveal-continue]").disabled,
      playing: node.classList.contains("wallet-reveal-playing"), copy:
         getComputedStyle(node.querySelector(".wallet-reveal-copy")).opacity };
  });
  check(result.ready && result.enabled && result.playing && result.copy === "1",
     "wallet copy and Continue are available during the reveal");
  await page.waitForFunction(() => !!document.querySelector(
    ".wallet-reveal-traits")?.textContent.includes("Ember"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(await page.locator(".wallet-reveal").evaluate((node) => !node.classList.contains(
    "wallet-reveal-playing")),
    "live reduced-motion changes settle the reveal");
  await matrix("reveal");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => globalThis.__visualReveal.presentWalletReveal(document));
  check(await page.locator(".wallet-reveal").evaluate((node) => !node.classList.contains(
    "wallet-reveal-playing")),
    "a settled reveal never replays after preferences change");
  await page.getByRole("button", { name: "Continue to backup options", exact: true }).click();
  check(await page.evaluate(async () => globalThis.__visualReveal.continued
    && globalThis.__visualReveal.before === JSON.stringify((await import(
      "/app-state.js")).state.wallet)),
    "Continue retains its existing callback and leaves wallet facts unchanged");
}

try {
  await overviewFixture(context, page, { messaging: true });
  check(await page.evaluate(() => typeof globalThis.zigsGlass?.animate === "function"),
     "Motion is bundled in the actual shell");
  await portfolio(); await approvals(); await reveal();
  check(errors.length === 0, "no browser runtime errors");
  writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(`${checks.length} visual checks passed. Screenshots: ${out}`);
} catch (error) {
  await capture("failure");
  writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors, failure:
     String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
