// Fresh local-only browser stores, real Zcash crypto/relay, fixed birthday, no chain/provider I/O.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installAuthenticator } from "./passkey-ui.mjs";

const web = fileURLToPath(new URL("../../web/", import.meta.url));
const types = new Set([".html", ".js", ".css", ".wasm", ".woff2", ".png", ".svg", ".webp"]);
export const ceremonyButton = (p, name) => p.getByRole("button", { name, exact: true });
export const ceremonyOrigin = process.env.ZIGS_CEREMONY_ORIGIN || "http://localhost:8788";
assert.equal(new URL(ceremonyOrigin).hostname, "localhost", "Virtual passkeys need localhost");

export async function bindCeremony(page) {
  await page.evaluate(async () => {
    const [engine, groups, seats, dkg, keys, app] = await Promise.all([
      import("/app-engine.js"), import("/app-groups.js"), import("/app-seats.js"),
      import("/app-dkg.js"), import("/app-keystore.js"), import("/app-state.js"),
    ]);
    globalThis.__ceremony = { engine, groups, seats, dkg, keys, app };
  });
}

export async function ceremonyPage(browser, errors, unsupported = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    colorScheme: "dark", reducedMotion: "reduce" });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ceremonyOrigin) return route.abort();
    const file = resolve(web, url.pathname === "/" ? "index.html" : "." + url.pathname);
    if (!file.startsWith(web) || !existsSync(file) || !types.has(extname(file))) {
      return route.fulfill({ status: 503, body: "No chain/provider service in this test." });
    }
    return route.continue();
  });
  if (unsupported) await context.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined });
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message.replace(/https?:\/\/\S+/g, "[service URL]")));
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    if (url.host !== new URL(ceremonyOrigin).host || url.pathname !== "/ws") {
      errors.push("A ceremony attempted a non-local relay socket");
    }
  });
  await page.goto(ceremonyOrigin); await bindCeremony(page);
  await page.waitForFunction(() => globalThis.__ceremony.engine.Z
    && globalThis.__ceremony.groups.dbReady);
  await fixedBirthday(page);
  return { context, page };
}

export async function fixedBirthday(page) {
  await page.evaluate(async () => {
    const engine = await import("/app-engine.js");
    engine.setZ({ ...engine.Z, latestHeight: async () => 4500000 });
  });
}

export async function protectCeremonyPage(page) {
  await installAuthenticator(page); await ceremonyButton(page, "Create wallet").click();
  await ceremonyButton(page, "Protect this browser").click();
  await page.waitForFunction(() => globalThis.__ceremony.keys.passkeyProtected());
}

export async function ceremonyNext(page, name) {
  await page.waitForTimeout(430);
  await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
}

export async function createCeremonyWallet(page, n, protectedBrowser = false) {
  if (protectedBrowser) {
    await protectCeremonyPage(page); await ceremonyNext(page, "Continue to approval rule");
  } else {
    await ceremonyButton(page, "Create wallet").click();
    await ceremonyButton(page, "Skip for now").click();
    await ceremonyButton(page, "Continue without protection").click();
  }
  await page.locator("#g-n").fill(String(n)); await page.locator("#g-t").fill("2");
  if (n === 2) await page.locator("#g-margin-ack").check();
  await ceremonyNext(page, "Use this arrangement");
  await page.locator("#g-name").fill("Disposable QA wallet");
  await page.locator("#my-name").fill("QA device 1");
  await page.locator("#g-net-testnet").check(); await ceremonyNext(page, "Continue");
  await page.locator("#g-sol").evaluate((n) => { if (n.checked) n.click(); });
  await ceremonyNext(page, "Create wallet");
  await page.getByRole("heading", { name: "Connect your second device", exact: true }).waitFor();
}

export async function readyCeremonyOverview(page) {
  const reveal = ceremonyButton(page, "Continue to backup options");
  const overview = ceremonyButton(page, "Open Overview");
  await reveal.or(overview).waitFor({ timeout: 90000 });
  if (await reveal.count()) await reveal.click();
  await overview.click(); await page.locator(".overview-hero").waitFor();
}

export async function safeCeremonyCapture(page, path) {
  await page.screenshot({ path, fullPage: true,
    mask: [page.locator(".safety,.qr,.secret-link,#bk-pass,#bk-again,#bc-pass,#rs-pass,"
      + "input[type=password],input[type=file]")] });
}
