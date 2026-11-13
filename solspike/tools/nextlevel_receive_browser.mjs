// Actual Receive renderer, isolated non-payable public fixtures, no wallet boot or submissions.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const { chromium } = createRequire(new URL("../../web/package.json", import.meta.url))("playwright");
const out = resolve(process.env.ZIGS_RECEIVE_OUTPUT || "/private/tmp/zigs-nextlevel-receive");
mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (pass, name) => { checks.push({ pass: !!pass, name }); assert.ok(pass, name); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  globalThis.__copies = []; globalThis.__shares = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text) => {
      if (globalThis.__copyFails) throw new DOMException("Blocked", "NotAllowedError");
      globalThis.__copies.push(text);
    },
  } });
  Object.defineProperty(navigator, "share", { configurable: true, value: async (payload) => {
    if (globalThis.__shareFails) throw new DOMException("Unavailable", globalThis.__shareFails);
    globalThis.__shares.push(payload);
  } });
});
const page = await context.newPage(); page.setDefaultTimeout(10000);
page.on("pageerror", (error) => errors.push(error.stack));
const shot = (name) => page.screenshot({ path: resolve(out, name + ".png"), fullPage: true });
const button = (name) => page.locator(".receive-dialog").getByRole("button", { name, exact: true });

async function mount({ network = "testnet", hidden = false, moved = false } = {}) {
  await page.evaluate(async ({ network, hidden, moved }) => {
    const { state, ui } = await import("/app-state.js");
    const { signPins } = await import("/app-filter.js");
    const { gkeys, setSecrets } = await import("/app-keystore.js");
    const { FLOW_FIXTURES } = await import("/dev/metal-orbs/flow-fixtures.js");
    const sample = FLOW_FIXTURES.everyday;
    state.g.network = network; state.g.name = "Studio wallet";
    state.g.movedTo = moved ? state.groups[1].id : null;
    state.wallet.network = network;
    state.wallet.address = network === "mainnet" ? "u1" + sample.zcash.address.slice(6) : sample.zcash.address;
    state.seats[1].uid = "receive-fixture"; state.seats[1].signPk = "non-signing-fixture";
    (await import("/app-groups.js")).setMe("receive-fixture");
    setSecrets({ [state.gid + ":1"]: { uid: "receive-fixture", keyPackage: "non-signing-fixture",
      signSk: "non-signing-fixture", signPk: "non-signing-fixture",
      checkedWallet: hidden ? null : JSON.stringify(state.wallet) } });
    gkeys[state.gid] = btoa("x".repeat(32)).replace(/=+$/, "");
    signPins["confirmednet:" + state.gid] = network;
    ui.receive = true;
    (await import("/app-loop.js")).draw();
    globalThis.__receiveAddress = state.wallet.address;
  }, { network, hidden, moved });
  await page.locator(".receive-dialog").waitFor(); await settleOverview(page);
}

async function matrix(network) {
  for (const width of [1440, 390, 320]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 1000 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await settleOverview(page);
    const facts = await page.locator(".receive-dialog").evaluate((node) => {
      const box = node.getBoundingClientRect(), code = node.querySelector(".receive-surface .qr svg");
      const rect = code?.getBoundingClientRect(), modules = code?.viewBox.baseVal.width;
      return { fits: box.left >= -1 && box.right <= innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1,
        qr: rect?.width >= modules * 2 && Math.abs(rect.width / modules - Math.round(rect.width / modules)) < .01
          && rect.width === rect.height && code.getAnimations().length === 0 };
    });
    check(facts.fits && facts.qr, `${network} ${width}px ${theme}: sheet fits and QR has square integer-size modules`);
    await shot(`receive-${network}-${width}-${theme}`);
  }
}

async function actions() {
  await button("Copy address").click();
  check(await page.evaluate(() => globalThis.__copies.at(-1) === globalThis.__receiveAddress), "Copy writes only the exact address");
  check(await page.locator(".receive-feedback").textContent().then((value) => value.includes("copied")), "Copy success has visible and announced feedback");
  check(await page.locator(".receive-copy").evaluate((node) => node === document.activeElement), "Copy preserves focus on the original button");
  await button("Share address").click();
  check(await page.evaluate(() => JSON.stringify(globalThis.__shares.at(-1)) === JSON.stringify({ text: globalThis.__receiveAddress })), "Share passes only the address to the native share sheet");
  await page.evaluate(() => { globalThis.__shareFails = "AbortError"; });
  await button("Share address").click();
  check(await page.locator(".receive-feedback").textContent().then((value) => value.includes("cancelled")), "Cancelling Share is a neutral result");
  await page.evaluate(() => { globalThis.__shareFails = "NotAllowedError"; });
  await button("Share address").click();
  check(await page.locator(".receive-feedback").textContent().then((value) => value.includes("Copy address")), "Unavailable Share gives a usable fallback");
  await page.evaluate(() => { globalThis.__copyFails = true; });
  await page.locator(".receive-copy").click();
  check(await page.evaluate(() => document.querySelector(".receive-address").open
    && getSelection().toString() === globalThis.__receiveAddress), "Blocked clipboard opens and selects the full address");
  await shot("receive-copy-fallback-320-light");
  await page.evaluate(() => { globalThis.__copyFails = false; globalThis.__shareFails = null; });
}

async function accessibility() {
  await page.emulateMedia({ forcedColors: "active" });
  const qr = await page.locator(".receive-code .qr svg").evaluate((node) => ({
    background: getComputedStyle(node.querySelector("rect")).fill,
    foreground: getComputedStyle(node.querySelector("path")).fill,
    motion: [...node.getAnimations({ subtree: true }), ...node.closest(".receive-dialog").getAnimations()].length,
  }));
  check(qr.background === "rgb(255, 255, 255)" && qr.foreground === "rgb(0, 0, 0)" && qr.motion === 0,
    "Forced colors preserve black-on-white QR modules and reduced motion leaves the code static");
  await shot("receive-forced-colors-320");
  await page.emulateMedia({ forcedColors: "none" });
  await page.evaluate(() => {
    globalThis.__receiveTextStyles = [...document.querySelectorAll(".receive-dialog, .receive-dialog *")]
      .filter((node) => node.namespaceURI === "http://www.w3.org/1999/xhtml")
      .map((node) => [node, node.style.fontSize, parseFloat(getComputedStyle(node).fontSize)]);
    for (const [node, , size] of globalThis.__receiveTextStyles) node.style.fontSize = size * 2 + "px";
  });
  check(await page.locator(".receive-dialog").evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    "Actual 200% text fits at 320px without horizontal scrolling");
  await button("Copy address").scrollIntoViewIfNeeded();
  check(await button("Copy address").isVisible(), "Enlarged text retains the Copy action");
  await shot("receive-double-text-320-light");
  await page.evaluate(() => {
    for (const [node, value] of globalThis.__receiveTextStyles) node.style.fontSize = value;
    delete globalThis.__receiveTextStyles;
  });
}

try {
  await overviewFixture(context, page, { messaging: true });
  await mount();
  if (process.env.ZIGS_RECEIVE_BASELINE === "1") {
    await shot("receive-before-1440");
    await page.setViewportSize({ width: 390, height: 844 }); await settleOverview(page);
    await shot("receive-before-390");
    console.log("Receive baseline saved: " + out);
  } else {
    await matrix("testnet"); await actions();
    await mount({ network: "mainnet" }); await matrix("mainnet");
    check(await page.locator(".receive-network-label").textContent() === "Zcash Mainnet", "The mainnet card names its actual network");
    await mount({ hidden: true });
    check(await page.locator(".receive-surface").count() === 0, "An unchecked local address stays hidden");
    check(await button("Copy address").count() === 0, "An unchecked local address has no copy action");
    await mount({ moved: true });
    check(await button("Share address").count() === 0, "A replaced wallet has no Share action");
    check(await page.locator(".receive-dialog").textContent().then((text) => text.includes("Ask senders to use the new wallet")), "A replaced wallet keeps its warning before its old address");
    await page.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
    await mount();
    check(await button("Share address").count() === 0, "Unsupported Share exposes only Copy");
    await accessibility();
    await button("Close").focus();
    await page.keyboard.press("Escape"); await page.locator(".receive-dialog").waitFor({ state: "detached" });
    check(true, "Keyboard Escape closes the existing modal");
    check(errors.length === 0, "No browser runtime errors");
    writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors }, null, 2));
    console.log(`${checks.length} Receive checks passed. Screenshots: ${out}`);
  }
} catch (error) {
  await shot("failure"); writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
