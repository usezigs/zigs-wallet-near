// Actual presentation modules, isolated synthetic facts, no server or payment execution.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const { chromium } = createRequire(new URL("../../web/package.json", import.meta.url))("playwright");
const out = resolve(process.env.ZIGS_JOURNEYS_OUTPUT || "/private/tmp/zigs-nextlevel-journeys");
mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (pass, name) => { checks.push({ pass: !!pass, name }); assert.ok(pass, name); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on("pageerror", (error) => errors.push(error.stack));
const capture = (name) => page.screenshot({ path: resolve(out, name + ".png"), fullPage: true });

async function matrix(name, selector) {
  for (const width of [1440, 390, 320]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 1000 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await settleOverview(page);
    const fits = await page.locator(selector).evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.left >= -1 && box.right <= innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1;
    });
    check(fits, `${name} fits at ${width}px in ${theme}`);
    await capture(`${name}-${width}-${theme}`);
  }
}

async function paymentFlow() {
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    const { setZ } = await import("/app-engine.js");
    const { setChain } = await import("/app-chain.js");
    const address = "utest1" + "syntheticaddress".repeat(12), amount = 25_000_000, fee = 10000;
    state.g.name = "Studio wallet";
    state.wallet.orchard_fvk = "synthetic-view-only";
    setZ({ inspect: () => JSON.stringify({ txid: "ab12".repeat(16), sighash: "synthetic-hash",
      expiry_height: 5000100, fee, standard_fee: fee, tx_version: "v5",
      lines: [{ kind: "spend", value: amount + fee }, { kind: "output", who: address, value: amount, memo_status: "empty" }] }),
    normalizeAddress: (value) => value, payeeAddress: (value) => value,
    expiryState: () => JSON.stringify({ expired: false, seconds_left: 1000, blocks_left: 100 }) });
    setChain({ gid: state.gid, cw: {}, bal: { spendable: 100_000_000, max_send: 100_000_000,
      height: 5000000, tip: 5000000 }, balAt: Date.now(), sent: new Set(), received: [] });
    ui.send = true; ui.pay = [{ k: 1, to: address, amt: "0.25", memo: "" }]; ui.note = "Studio payment";
    globalThis.__paymentSample = { address, amount, fee };
    (await import("/app-loop.js")).draw();
  });
  check(await page.locator("[data-payment-view=send] .payment-journey-step[aria-current=location]").innerText()
    .then((text) => text.includes("Send")), "composer identifies its view without claiming transaction completion");
  await page.getByRole("textbox", { name: "Amount · ZEC", exact: true }).fill("0.25000000");
  await matrix("send", ".dialog.payment-surface");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(async () => (await import("/app-loop.js")).draw());
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js"), sample = globalThis.__paymentSample;
    ui.sendReview = { note: ui.note, prep: { gid: state.gid, at: Date.now(),
      payees: [{ to: sample.address, amount: sample.amount, memo: "" }],
      t: { pczt: "synthetic-review", amount: sample.amount, fee: sample.fee } } };
    (await import("/app-loop.js")).draw();
  });
  check(await page.getByRole("button", { name: "Request approvals", exact: true }).isVisible(), "verified review retains its original approval request action");
  check(await page.locator(".payment-journey-marker").evaluate((node) => node.getAnimations().length > 0), "Motion connects the composer and review view markers");
  // Hold the actual animation so natural completion cannot conceal a missed cancellation.
  await page.locator(".payment-journey-marker").evaluate((node) => node.getAnimations().forEach((animation) => animation.pause()));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector(".payment-journey-marker").getAnimations().length === 0,
    null, { timeout: 1000 });
  check(await page.locator(".payment-journey-marker").evaluate((node) => node.getAnimations().length === 0), "reduced motion cancels a connected transition immediately");
  await matrix("review", ".dialog.payment-surface");
  check(await page.locator(".review-row .addr-full").textContent().then((text) => text.replace(/\s/g, "")
    === "utest1" + "syntheticaddress".repeat(12)), "review retains the complete recipient address");
  await page.getByRole("button", { name: "Back to edit", exact: true }).click();
  await page.locator("[data-payment-view=send]").waitFor();
  check(await page.getByRole("textbox", { name: "Amount · ZEC", exact: true }).inputValue() === "0.25000000", "Back to edit preserves the exact typed draft");
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js"), sample = globalThis.__paymentSample;
    ui.send = false; ui.sendReview = null; ui.tab = "activity";
    const ss = { id: "synthetic-record", status: "broadcast", pczt: "synthetic-record",
      amount: sample.amount, fee: sample.fee, payees: [{ to: sample.address, amount: sample.amount, memo: "" }],
      by: 1, createdAt: Date.now(), broadcastAt: Date.now(), broadcastTxid: "ab12".repeat(16),
      final: { txid: "ab12".repeat(16), tx_hex: "00".repeat(200), size: 200 } };
    const node = (await import("/app-drawer.js")).sessionLayer(ss);
    const host = document.createElement("div"); host.append(node);
    globalThis.__messagingView = () => host;
    document.getElementById("app").replaceChildren(host);
    globalThis.zigsGlass.flush();
  });
  check(await page.locator("[data-payment-view=record]").count() === 1, "activity uses the Record view, independently of network finality");
  await matrix("record", ".drawer.payment-surface");
}

async function walkthrough() {
  await page.evaluate(async () => {
    const { ui } = await import("/app-state.js"); ui.send = false; ui.sendReview = null;
    const node = (await import("/app-how-zigs-works.js")).howZigsWorksDialog();
    const host = document.createElement("div"); host.append(node);
    globalThis.__messagingView = () => host;
    document.getElementById("app").replaceChildren(host); globalThis.zigsGlass.flush();
  });
  await matrix("walkthrough", ".home-how-dialog");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  check(await page.locator(".hw-payment-story").getAttribute("data-step") === "2", "phone buttons advance the persistent illustration");
  check(await page.locator(".hw-story-chapter:visible").count() === 1, "phones show one readable step at a time");
  await page.getByRole("button", { name: "Approve", exact: true }).press("End");
  check(await page.locator(".hw-payment-story").getAttribute("data-step") === "3", "walkthrough supports keyboard step selection");
  check(await page.locator(".hw-story-caption").textContent().then((text) => text.includes("Confirmation follows")), "submission is explicitly separate from confirmation");
  await page.setViewportSize({ width: 1440, height: 1000 }); await settleOverview(page);
  check(await page.locator(".hw-story-chapter:visible").count() === 4, "desktop retains every chapter in document reading order");
  await page.locator(".home-how-content").evaluate((node) => {
    const step = node.querySelector('[data-story-step="2"]');
    node.scrollTop += step.getBoundingClientRect().top - node.getBoundingClientRect().top - 160;
  });
  await page.waitForFunction(() => document.querySelector(".hw-payment-story")?.dataset.step === "2");
  check(await page.locator(".hw-story-stage").evaluate((node) => getComputedStyle(node).position === "sticky"), "desktop scrolling advances a persistent sticky illustration");
  check(await page.locator(".hw-story-stage").evaluate((node) => node.getBoundingClientRect().top
    >= document.querySelector(".hw-toolbar").getBoundingClientRect().bottom), "sticky step controls remain below the guide toolbar");
  await capture("walkthrough-approve-1440-light");
  await page.getByRole("button", { name: "Read the complete payment guide", exact: true }).click();
  check(await page.locator("#hw-reference").isVisible(), "the full technical guide remains reachable");
  await page.getByRole("button", { name: "A payment walkthrough", exact: true }).click();
  await settleOverview(page);
  check(await page.locator(".hw-payment-story").getAttribute("data-step") === "2", "guide view changes preserve reading progress");
}

async function swapGuide() {
  await page.getByRole("button", { name: "Explore the journeys", exact: true }).click();
  await page.locator('[data-key="hw-journey-private-swaps"]').click();
  const guide = page.locator('#hw-journey-panel');
  check((await guide.innerText()).includes('Illustrated guide') && !/Unavailable|planned journey|future swap/i.test(await guide.innerText()),
    'the Swap journey describes the available flow without an obsolete unavailable label');
  const expected = ['Hackathon preview', 'never falls back to Standard', '30 minutes', 'Confirm receipt'];
  for (let i = 0; i < 4; i++) {
    await page.locator('.hw-step-choice').nth(i).click();
    check((await page.locator('.hw-step-description').innerText()).includes(expected[i]),
      `Swap guide chapter ${i + 1} preserves the current mode, approval or receipt boundary`);
  }
  for (const width of [1440, 390, 320]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 1000 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await settleOverview(page);
    let fits = true;
    for (let i = 0; i < 4; i++) {
      await page.locator('.hw-step-choice').nth(i).click();
      fits &&= await page.locator('.home-how-content').evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
    }
    fits &&= await page.locator('.hw-view-choices button').evaluateAll((nodes) => nodes.every((node) => {
      const label = node.querySelector('.hw-view-label-compact');
      return !label.checkVisibility() || getComputedStyle(node).whiteSpace === 'nowrap'
        && node.scrollWidth <= node.clientWidth + 1;
    }));
    check(fits, `all four Swap guide chapters and their navigation labels fit at ${width}px in ${theme}`);
    if (width !== 390) await capture(`swap-guide-${width}-${theme}`);
  }
}

async function welcome() {
  await page.evaluate(async () => {
    delete globalThis.__messagingView;
    const { state, ui } = await import("/app-state.js");
    state.g = null; state.gid = null; state.groups = []; ui.tab = "overview";
    (await import("/app-loop.js")).draw();
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.waitForSelector(".home-scene-live");
  const pixels = await page.evaluate(async () => {
    const { createHeroScene, sceneSample } = await import("/homepage-scene.js");
    const scene = createHeroScene(document.querySelector(".home-hero-art")); scene.resize(320, 1);
    const gl = scene.canvas.getContext("webgl"), samples = [];
    for (const time of [1500, 5000]) {
      scene.draw(sceneSample(time)); const bytes = new Uint8Array(320 * 320 * 4);
      gl.readPixels(0, 0, 320, 320, gl.RGBA, gl.UNSIGNED_BYTE, bytes); samples.push(bytes);
    }
    let atmosphere = 0, movement = 0, eye = 0, changedEye = 0;
    for (let i = 0; i < samples[0].length; i += 4) {
      const a = samples[0], b = samples[1];
      if (a[i + 3] > 0 && a[i + 3] < 40) atmosphere++;
      if (Math.abs(a[i] - b[i]) > 2) movement++;
      if (a[i] > 75 && a[i] > a[i + 1] * 2.5) {
        eye++; if (Math.abs(a[i] - b[i]) > 2) changedEye++;
      }
    }
    scene.dispose(); return { atmosphere, movement, eye, changedEye };
  });
  check(pixels.atmosphere > 100 && pixels.movement > 100 && pixels.eye > 0 && pixels.changedEye === 0,
    "Radiant shader renders a moving atmosphere while preserving the red eye: " + JSON.stringify(pixels));
  await capture("welcome-1440-dark");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForSelector(".home-scene-live", { state: "detached" });
  check(await page.locator(".home-hero-art").isVisible(), "reduced motion restores the original zebra still");
  await page.setViewportSize({ width: 390, height: 844 }); await capture("welcome-390-static");
}

try {
  await overviewFixture(context, page, { messaging: true });
  check(await page.locator(".shared-control").isVisible(), "shared control is visible without opening a disclosure");
  check(await page.locator(".shared-control-medallion").count() === 3, "configured devices are shown as neutral, separate medallions");
  await paymentFlow(); await walkthrough(); await swapGuide(); await welcome();
  check(errors.length === 0, "no browser runtime errors");
  writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(`${checks.length} journey checks passed. Screenshots: ${out}`);
} catch (error) {
  await capture("failure");
  writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
