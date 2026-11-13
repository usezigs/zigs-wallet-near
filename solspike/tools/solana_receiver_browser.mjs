// Local renderer QA. Every displayed value is synthetic; all external requests are blocked.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve, extname } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { default: jsQR } = await import(process.env.QR_READER_MODULE || "jsqr");
const { default: pngjs } = await import(process.env.PNG_MODULE || "pngjs");
const root = resolve("web");
const out = resolve(process.env.SOL_RECEIVE_QA_DIR || "/tmp/zigs-solana-receive-qa");
mkdirSync(out, { recursive: true });
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/network-privacy-demo-entry.js") return res.writeHead(200,
    { "Content-Type": "text/javascript" }).end("// Renderer QA: no wallet boot.");
  const file = join(root, path === "/" ? "index.html" : path);
  if (!file.startsWith(root + "/") || !existsSync(file)) return res.writeHead(404).end();
  let body = readFileSync(file);
  if (path === "/") body = body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,
    (script) => script.includes("/openglass-dist/app.js") ? script : "")
    .replace(/<link[^>]+rel="(?:modulepreload|preload)"[^>]*>/g, "");
  res.writeHead(200, { "Content-Type": ({ ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml"
  })[extname(file)] || "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
async function checkViewports(page, mode, expected) {
for (const width of [1440, 768, 390, 320]) {
  await page.setViewportSize({ width, height: 900 });
  for (const theme of ["dark", "light"]) {
    await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
    const addresses = await page.locator('.receive-address-preview, [data-sol="address"], '
      + '[data-sol="shielded"], [data-sol="owner"], [data-sol="group-key"], '
      + '[data-sol^="fee-address-"]').all();
    const visibility = await Promise.all(addresses.map((address) => address.isVisible()));
    const visible = visibility.filter(Boolean).length;
    assert.equal(visible, 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const qr = page.locator('[data-sol="receive-qr"] svg');
    assert.equal(await qr.count(), 1, "one locally rendered QR code");
    assert.ok(await qr.evaluate((svg) => {
      const pixels = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      return Math.abs(pixels - Math.round(pixels)) < .001;
    }), "QR modules retain whole-pixel sizing");
    assert.match(await qr.getAttribute("aria-label"),
      new RegExp("Solana " + (mode === "devnet" ? "Devnet" : "Mainnet")
        + ".*receive address QR code"));
    const png = pngjs.PNG.sync.read(await qr.screenshot());
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height,
      { inversionAttempts: "dontInvert" });
    assert.equal(decoded?.data, expected, "the visible QR scans to the exact copied address");
    await page.screenshot({ path: join(out, mode + "-" + width + "-" + theme + ".png"),
      fullPage: true });
    if (width === 1440 && theme === "light") await page.locator(".sol-receive-card").screenshot({
      path: join(out, mode + "-card-synthetic.png") });
  }
}
}

try {
  const context = await browser.newContext({ reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"] });
  const remote = [], errors = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    remote.push(new URL(route.request().url()).hostname);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  for (const mode of ["plain", "private", "devnet"]) {
    await page.goto(origin);
    await page.locator("#app").waitFor({ state: "attached" });
    await page.evaluate(async (mode) => {
      const { el, qrBox, receiveAddress } = await import("/app-dom.js");
      const { solView, solDetailsView } = await import("/sol/view.js");
      const { plainView, plainDetailsView } = await import("/sol/plain/view.js");
      const { receiveFixture } = await import("/test/sol-receive-fixture.mjs");
      const view = mode === "plain" ? plainView : solView;
      const detail = mode === "plain" ? plainDetailsView : solDetailsView;
      const root = document.getElementById("app");
      const draw = (surface = "receive") => {
        const title = el("header", { class: "card-head" }, el("h2", {}, "Solana"),
          el("span", { class: "small muted" }, "Demo · synthetic data"));
        const body = surface === "receive" ? view(c, (fn) => fn, {})
          : el("section", { class: "card card-pad" },
            el("h3", {}, surface === "settings" ? "Solana settings" : "Security & privacy"),
            el("button", { class: "btn sm", onclick: () => draw() }, "Back to receiving"),
            detail(c, (fn) => fn, {}, surface));
        root.replaceChildren(el("main", { style: "max-width:840px;margin:0 auto;"
          + "padding:32px 16px;display:grid;gap:24px" }, title, body));
      };
      const c = receiveFixture(el, mode, draw);
      c.host.qrBox = qrBox;
      c.host.receiveAddress = receiveAddress;
      globalThis.receiveQa = { c, draw };
      draw();
    }, mode);
    const copyMark = mode === "plain" ? "copy-address" : "copy-shielded";
    const address = page.locator('[data-sol="'
      + (mode === "plain" ? "address" : "shielded") + '"]');
    const expected = await address.textContent();
    await page.locator('[data-sol="' + copyMark + '"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
    await page.evaluate(() => navigator.clipboard.writeText = async () => {
      throw Error("Synthetic clipboard refusal");
    });
    await page.locator('[data-sol="' + copyMark + '"]').click();
    assert.match(await page.locator('[data-sol="' + copyMark + '"]').innerText(),
      /Select and copy/);
    await page.evaluate(() => globalThis.receiveQa.draw());
    await checkViewports(page, mode, expected);
    if (mode !== "plain") {
      const summary = page.locator(".receive-address > summary");
      assert.equal(await address.isVisible(), false, "long addresses start compact");
      await summary.focus();
      await page.keyboard.press("Enter");
      assert.equal(await address.isVisible(), true, "the full address is keyboard-accessible");
      assert.equal(await page.locator(".receive-address-preview").isVisible(), false);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      // The app's redraw preservation must not carry an expanded address into another wallet.
      await page.evaluate(async () => {
        const { saveFormState, restoreFormState } = await import("/app-loop.js");
        const root = document.getElementById("app"), saved = saveFormState(root);
        const done = globalThis.receiveQa.c.docs.soldone[1], original = done.pdaAddress;
        done.pdaAddress = "be".repeat(99);
        globalThis.receiveQa.draw();
        restoreFormState(root, saved);
        if (root.querySelector(".receive-address").open) {
          throw Error("Another wallet's address expanded");
        }
        done.pdaAddress = original;
        globalThis.receiveQa.draw();
      });
      assert.equal(await address.isVisible(), false);
    }
    await page.getByRole("button", { name: "Solana settings", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Solana settings", exact: true })
      .count(), 1);
    await page.getByRole("button", { name: "Back to receiving" }).click();
    await page.getByRole("button", { name: "Security & privacy", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Security & privacy", exact: true })
      .count(), 1);
    assert.match(await page.locator("#app").innerText(),
      mode === "plain" ? /public on chain/i : /public too/);
    console.log("ok  " + mode
      + ": 320–1440px, dark/light, exact QR/copy, address disclosure and routes");
  }
  assert.deepEqual(remote, [], "the renderer makes no external requests");
  assert.deepEqual(errors, [], "no browser exceptions");
  await context.close();
  console.log("solana-receiver-browser: ok; synthetic screenshots in " + out);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
