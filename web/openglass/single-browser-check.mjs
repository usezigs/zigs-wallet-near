// Real unfunded Testnet/Mainnet formation in fresh browser stores. No chain services or payments.
// Requires the local Worker relay (npm run build, then wrangler dev on port 8788).
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserOutput, launchTestBrowser } from "../../solspike/harness/browser-test.mjs";
import { installAuthenticator } from "../../solspike/harness/passkey-ui.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const web = resolve(root, "web");
const origin = new URL(process.env.ZIGS_SINGLE_BROWSER_ORIGIN || "http://localhost:8788").origin;
assert.equal(new URL(origin).hostname, "localhost",
  "Use http://localhost:<port> for this local relay check; the passkey flow cannot use a numeric IP address");
const out = browserOutput("formation", process.env.OPENGLASS_SINGLE_BROWSER_OUTPUT);
const browser = await launchTestBrowser();
const checks = [], errors = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
const button = (page, name) => page.getByRole("button", { name, exact: true });
const demoLabel = "Trying Zigs alone? Play the other devices in this browser";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml",
  ".webp": "image/webp" };

async function bindModules(page) {
  await page.evaluate(async () => {
    const [engine, groups, seats, dkg, keys, app] = await Promise.all([
      import("/app-engine.js"), import("/app-groups.js"), import("/app-seats.js"),
      import("/app-dkg.js"), import("/app-keystore.js"), import("/app-state.js"),
    ]);
    globalThis.__solo = { engine, groups, seats, dkg, keys, app };
  });
}

async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    colorScheme: "dark", reducedMotion: "reduce" });
  // Permit only local build assets. HTTP chain/provider proxies never reach the Worker.
  // Only the same-origin WebSocket relay handles this run's newly generated wallet IDs.
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const file = resolve(web, url.pathname === "/" ? "index.html" : "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(web + "/") || !existsSync(file) || !types[extname(file)])
      return route.fulfill({ status: 503, body: "No chain or provider service in this test." });
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", socket => {
    const url = new URL(socket.url());
    check(url.host === new URL(origin).host && url.pathname === "/ws",
      "Wallet ceremony uses only the local relay socket");
  });
  await page.goto(origin);
  await bindModules(page);
  await page.waitForFunction(() => !!globalThis.__solo.engine.Z && globalThis.__solo.groups.dbReady);
  await page.evaluate(async () => {
    const engine = await import("/app-engine.js");
    // A fixed birthday replaces the only chain fact formation needs. Cryptography stays real.
    engine.setZ({ ...engine.Z, latestHeight: async () => 4500000 });
  });
  return { context, page };
}

async function next(page, name) {
  // Retain the wallet's existing accidental double-tap guard between plan steps.
  await page.waitForTimeout(430);
  await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
}

async function formWallet(network, n, protectedBrowser) {
  const { context, page } = await fresh();
  const label = `${network} 2-of-${n}`;
  try {
    await button(page, "Create wallet").click();
    if (protectedBrowser) {
      await installAuthenticator(page);
      await button(page, "Protect this browser").click();
      await page.waitForFunction(() => globalThis.__solo.keys.passkeyProtected());
      await next(page, "Continue to approval rule");
    } else {
      await button(page, "Skip for now").click();
      await button(page, "Continue without protection").click();
    }
    await page.locator("#g-n").fill(String(n));
    await page.locator("#g-t").fill("2");
    if (n === 2) await page.locator("#g-margin-ack").check();
    await next(page, "Use this arrangement");
    await page.locator("#g-name").fill("Single-browser " + network + " review");
    await page.locator("#my-name").fill("Demo device 1");
    await page.locator("#g-net-" + network).check();
    await next(page, "Continue");
    // Solana is intentionally offline in this regression. The current review keeps this
    // submission control hidden, so set its existing opt-out through its native change handler.
    if (network === "testnet") await page.locator("#g-sol").evaluate(node => { if (node.checked) node.click(); });
    await next(page, "Create wallet");
    const demo = page.locator("details.testing");
    await demo.getByText(demoLabel, { exact: true }).waitFor();
    check(await demo.locator("summary").isVisible(), `${label}: solo-browser option remains visible`);
    if (network === "mainnet") {
      await demo.locator("summary").click();
      check((await demo.innerText()).includes("real mainnet payments by itself")
        && !(await demo.innerText()).includes("For a demo or a review only"),
      `${label}: mainnet explains that local shares can authorize real payments`);
      check(await button(page, "Play device 2").isDisabled(),
        `${label}: passkey/skip alone does not acknowledge mainnet local devices`);
      await button(page, "Review single-browser mainnet setup").click();
      await button(page, "Keep devices separate").click();
      check(await button(page, "Play device 2").isDisabled(), `${label}: cancellation keeps gate`);
      await button(page, "Review single-browser mainnet setup").click();
      await button(page, "Enable for this wallet").click();
    }

    // Check the actual disclosure/controls across both palettes and the narrowest layout.
    for (const theme of ["dark", "light"]) for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      if (!await demo.getAttribute("open").then(value => value !== null))
        await demo.locator("summary").click();
      const play = button(page, "Play device 2");
      check(await play.isVisible() && await play.isEnabled(),
        `${label} ${theme} ${width}: Play device 2 is usable`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${label} ${theme} ${width}: no horizontal overflow`);
    }
    await page.screenshot({ path: resolve(out, `${network}-solo-2-of-${n}.png`), fullPage: true,
      mask: [page.locator(".qr,.secret-link,.safety,.safety-quick")] });
    // Keyboard activation exercises the native handlers under the glass/hover bridge.
    for (let seat = 2; seat <= n; seat++) {
      await button(page, "Play device " + seat).focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(expected => globalThis.__solo.seats.localSeats().includes(expected), seat);
      check(true, `${label}: keyboard joins device ${seat} in the same tab`);
    }
    await page.waitForFunction(() => {
      const { app: { state }, seats: { localSeats, keysAgree }, dkg: { seatCheck } } = globalThis.__solo;
      return !!state.wallet && keysAgree() && localSeats().length === state.g.n
        && localSeats().every(seat => seatCheck(seat) === true);
    }, null, { timeout: 90000 });
    const facts = await page.evaluate(async () => {
      const { state } = await import("/app-state.js");
      const { localSeats } = await import("/app-seats.js");
      return { network: state.g.network, n: state.g.n, t: state.g.t,
        seats: localSeats(), address: state.wallet.address?.startsWith(
          state.g.network === "mainnet" ? "u1" : "utest1") };
    });
    check(facts.network === network && facts.n === n && facts.t === 2 && facts.address,
      `${label}: real engine forms and verifies an unfunded wallet on the selected network`);
    check(facts.seats.length === n && context.pages().length === 1,
      `${label}: every device stays in one browser tab`);
    check(await page.locator(".safety").count() === 0,
      `${label}: no impossible cross-device code comparison blocks solo setup`);
    const reveal = button(page, "Continue to backup options");
    if (await reveal.count()) await reveal.click();
    check((await page.locator(".setup-wallet-status").innerText())
      .includes(`This browser holds ${n} of ${n} signing shares`),
    `${label}: completed setup identifies shares held together in this browser`);
    await button(page, "Open Overview").click();
    await page.locator(".overview-hero").waitFor();
    check(await page.locator(".overview-hero").isVisible(),
      `${label}: solo setup reaches the normal wallet Overview`);
    if (network === "mainnet") check(await page.locator('[data-local-devices-warning="threshold"]')
      .isVisible(), `${label}: a persistent warning identifies the held approval threshold`);

    // No proposal is made. Exercise the actual approval renderer against the verified local
    // seats, then test recovery of those same seats from the browser's saved store on reload.
    await page.evaluate(async () => {
      const { nextAction } = await import("/app-drawer.js");
      const { el } = await import("/app-dom.js");
      const section = el("section", { id: "solo-approval-check" });
      section.append(...nextAction({ id: "synthetic-unsubmitted-review", status: "collecting" },
        { sighash: "synthetic-unsubmitted-review" }, { match: true, rows: [], extra: [] }));
      document.getElementById("app").append(section);
      globalThis.zigsGlass.flush();
    });
    for (let seat = 1; seat <= n; seat++) check(
      await button(page, "Approve as device " + seat).isVisible()
        && await button(page, "Approve as device " + seat).isEnabled(),
      `${label}: separate approval for local device ${seat} remains available`);
    await page.reload();
    await bindModules(page);
    if (protectedBrowser) await button(page, "Unlock").click();
    await page.waitForFunction(expected => {
      const { seats: { localSeats }, dkg: { seatCheck } } = globalThis.__solo;
      return localSeats().length === expected && localSeats().every(seat => seatCheck(seat) === true);
    }, n, { timeout: 30000 });
    check(true, `${label}: all local devices survive reload${protectedBrowser ? " and passkey unlock" : ""}`);
    if (network === "mainnet") check(await page.locator('[data-local-devices-warning="threshold"]')
      .isVisible(), `${label}: warning survives reload and unlock`);
  } catch (error) {
    const facts = await page.evaluate(async () => {
      const { state, ui, banner } = await import("/app-state.js");
      return { network: state.g?.network, walletSelected: !!state.g, pending: state.pending,
        seats: Object.keys(state.seats), createError: ui.createError,
        banner: banner?.text, headings: [...document.querySelectorAll("h1,h2")].map(n => n.textContent),
        demo: !!document.querySelector("details.testing") };
    });
    console.error(JSON.stringify(facts));
    await page.screenshot({ path: resolve(out, `${network}-failure-2-of-${n}.png`), fullPage: true,
      mask: [page.locator(".qr,.secret-link,.safety,.safety-quick")] });
    throw error;
  } finally { await context.close(); }
}

try {
  for (const network of ["testnet", "mainnet"]) {
    await formWallet(network, 2, false);
    await formWallet(network, 3, true);
  }
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(`Single-browser Testnet and Mainnet: ${checks.length} checks passed`);
} catch (error) {
  errors.push(error.message);
  throw error;
} finally {
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ checks, errors,
    scope: "Fresh stores; real unfunded Zcash Testnet/Mainnet formation; local relay only; no funding, proposal, approval or broadcast." }, null, 2));
  await browser.close();
}
