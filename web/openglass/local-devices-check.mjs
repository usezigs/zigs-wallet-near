// Real presentation and handlers with explicit synthetic facts; no keys, writes or submissions.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserOutput, launchTestBrowser } from "../../solspike/harness/browser-test.mjs";
import { overviewFixture, settleOverview } from "../../solspike/harness/overview-redesign-fixture.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const output = browserOutput("local-devices"), checks = [], errors = [];
const browser = await launchTestBrowser();
const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
const page = await context.newPage(); page.setDefaultTimeout(10000);
page.on("pageerror", (e) => errors.push(e.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const check = (pass, label) => { checks.push({ pass: !!pass, label }); assert.ok(pass, label); };

async function seed(count, required = 2, verified = true) {
  await page.evaluate(async ({ count, required, verified }) => {
    const { state, ui } = await import("/app-state.js");
    const g = { ...state.groups[0], network: "mainnet", t: required };
    const { setSecrets } = await import("/app-keystore.js");
    (await import("/app-groups.js")).setMe("synthetic-device-1");
    const wallet = { address: "u1" + "q".repeat(180), birthday: 4500000 };
    state.seats = Object.fromEntries([1, 2, 3].map((id) => [id, {
      uid: "synthetic-device-" + id, name: "Device " + id, signPk: String(id).repeat(64),
    }]));
    setSecrets(Object.fromEntries(Array.from({ length: count }, (_, i) => i + 1).map((id) => [
      g.id + ":" + id, { ...state.seats[id], version: 3, signSk: "synthetic-never-used",
        keyPackage: { synthetic: true }, checkedWallet: verified ? JSON.stringify(wallet) : null },
    ])));
    const { signPins } = await import("/app-filter.js");
    signPins["version:" + g.id] = "3"; signPins["confirmednet:" + g.id] = "mainnet";
    Object.assign(state, { g, gid: g.id, wallet, groups: [g], pending: false });
    ui.tab = "overview"; ui.send = false; ui.sendReview = null;
    (await import("/app-loop.js")).draw();
  }, { count, required, verified });
  await settleOverview(page);
}

async function optIn() {
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    const { mainnetLocalDevicesChoice } = await import("/app-local-devices.js");
    const host = document.createElement("section"); host.id = "local-choice-fixture";
    globalThis.__messagingView = () => {
      host.replaceChildren(mainnetLocalDevicesChoice(state.g, false, 2)); return host;
    };
    (await import("/app-loop.js")).draw();
  });
  await button("Review single-browser mainnet setup").click();
  await button("Keep devices separate").waitFor();
  await page.screenshot({ path: resolve(output, "mainnet-opt-in.png"), fullPage: true });
  check(await button("Keep devices separate").evaluate((n) => n === document.activeElement),
    "the consequence review focuses the safer cancellation");
  await button("Keep devices separate").click();
  await button("Review single-browser mainnet setup").waitFor();
  check(await button("Review single-browser mainnet setup").isVisible(), "cancel grants no consent");
  await button("Review single-browser mainnet setup").click();
  await button("Enable for this wallet").click();
  await page.waitForFunction(async () => {
    const { state } = await import("/app-state.js");
    return (await import("/local-devices.js")).mainnetLocalDevicesAllowed(state.g);
  });
  check(await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    return !(await import("/local-devices.js")).mainnetLocalDevicesAllowed({ ...state.g,
      id: "cd".repeat(10) });
  }), "mainnet choice cannot enable another wallet");
  await page.evaluate(() => { delete globalThis.__messagingView; });
}

async function warningMatrix() {
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 900 });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    for (const tab of ["overview", "recovery", "settings", "swap"]) {
      await page.evaluate(async (tab) => {
        (await import("/app-state.js")).ui.tab = tab; (await import("/app-loop.js")).draw();
      }, tab);
      await settleOverview(page);
      check(await page.locator('.wallet-context-header [data-local-devices-warning="threshold"]')
        .isVisible(), `${width} ${theme} ${tab}: warning remains in wallet context`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${width} ${theme} ${tab}: no page overflow`);
      if (tab === "overview" && [320, 1440].includes(width)) await page.screenshot({
        path: resolve(output, `mainnet-warning-${width}-${theme}.png`), fullPage: true });
    }
  }
}

async function paymentWarnings() {
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    const address = "u1" + "q".repeat(180), amount = 25000000, fee = 10000;
    (await import("/app-engine.js")).setZ({
      inspect: () => JSON.stringify({ txid: "ab12".repeat(16), sighash: "synthetic-hash",
        expiry_height: 5000100, fee, standard_fee: fee, tx_version: "v5",
        lines: [{ kind: "spend", value: amount + fee },
          { kind: "output", who: address, value: amount, memo_status: "empty" }] }),
      normalizeAddress: (value) => value, payeeAddress: (value) => value,
      expiryState: () => JSON.stringify({ expired: false, seconds_left: 1000, blocks_left: 100 }),
    });
    const payees = [{ to: address, amount, memo: "" }];
    ui.send = true; ui.sendReview = { note: "Synthetic presentation only", prep: {
      gid: state.gid, at: Date.now(), payees, t: { pczt: "synthetic-never-submitted", amount, fee },
    } };
    globalThis.__warningPayment = { id: "synthetic-warning", status: "proposed",
      pczt: "synthetic-never-submitted", amount, fee, payees, by: 1, createdAt: Date.now() };
    (await import("/app-loop.js")).draw();
  });
  for (const view of ["review", "approve"]) {
    if (view === "approve") await page.evaluate(async () => {
      const { state, ui } = await import("/app-state.js");
      ui.send = false; ui.sendReview = null; ui.tab = "overview";
      const ss = globalThis.__warningPayment;
      state.sessions = [ss]; state.sid = null;
      const sessionLayer = (await import("/app-drawer.js")).sessionLayer;
      const host = document.createElement("div");
      globalThis.__messagingView = () => { host.replaceChildren(sessionLayer(ss)); return host; };
      (await import("/app-loop.js")).draw();
    });
    for (const width of [320, 390, 1440]) for (const theme of ["dark", "light"]) {
      await page.setViewportSize({ width, height: width < 761 ? 844 : 900 });
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await settleOverview(page);
      const surface = page.locator(`[data-payment-view="${view}"]`);
      check(await surface.locator('[data-local-devices-warning="threshold"]').isVisible(),
        `${width} ${theme} ${view}: concentration warning stays inside the payment surface`);
      check(await surface.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
        `${width} ${theme} ${view}: payment warning fits`);
    }
  }
  await page.evaluate(() => { delete globalThis.__messagingView; });
}

try {
  await overviewFixture(context, page, { messaging: true });
  await seed(1); check(await page.locator("[data-local-devices-warning]").count() === 0,
    "one held share does not claim concentration");
  await optIn();
  await seed(2, 3); check(await page.locator('[data-local-devices-warning="shared"]').isVisible(),
    "two of three required shares report co-location without an approval claim");
  await seed(2, 2, false); check(await page.locator('[data-local-devices-warning="shared"]').isVisible(),
    "unverified local shares do not imply signing readiness");
  await seed(2);
  await page.evaluate(async () => {
    (await import("/app-state.js")).state.pending = true;
    (await import("/app-loop.js")).draw();
  });
  await settleOverview(page);
  check(await page.locator('[data-local-devices-warning="shared"]').isVisible(),
    "checking shared state does not imply signing readiness");
  await seed(2); await warningMatrix();
  await page.screenshot({ path: resolve(output, "mainnet-warning.png"), fullPage: true,
    mask: [page.locator(".qr,.secret-link,.safety,input[type=password]")] });
  await page.evaluate(() => { localStorage.removeItem("zf-mainnet-local-devices:" + "ab".repeat(10)); });
  await seed(2); check(await page.locator('[data-local-devices-warning="threshold"]').isVisible(),
    "existing or restored shares warn independently of setup consent");
  await paymentWarnings();
  check(errors.length === 0, "no runtime errors");
  console.log(`${checks.length} local-device checks passed`);
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ checks, errors,
    scope: "Production renderers; synthetic public facts only; no funded actions." }, null, 2));
  await context.close(); await browser.close();
}
