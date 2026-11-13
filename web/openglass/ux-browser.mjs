// Disposable browser, local assets only. Synthetic renderer states never authorize a payment.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { overviewFixture, settleOverview } from "../../solspike/harness/overview-redesign-fixture.mjs";

const out = process.env.UX_EVIDENCE_DIR || "/private/tmp/zigs-near-ux-pass2-evidence/browser";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const report = { method: "Real renderers, synthetic wallet data, external requests blocked", views: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await overviewFixture(context, page);
  for (const scene of ["payment-progress", "restore-checking", "swap-history", "solana-history"]) {
    await page.evaluate(async (scene) => {
      const { state } = await import("/app-state.js");
      const { el } = await import("/app-dom.js");
      const root = el("div", { class: "page" });
      if (scene === "payment-progress") {
        const { stageHeadline, paymentNextStep } = await import("/payment-model.js");
        const { outcomePanel } = await import("/outcome-seal.js");
        for (const [stage, facts] of [["approved", { approved: true }], ["signing", { signing: true }],
          ["resend", { resend: true }], ["held", { held: true }]]) {
          root.append(el("section", { class: "card" }, outcomePanel({ ...stageHeadline(facts),
            next: paymentNextStep(stage, { proposer: "device 2 (Laptop)", pendingSigners: ["device 1 (Phone)", "device 3 (Reserve)"] }) })));
        }
      } else if (scene === "restore-checking") {
        const backups = await import("/app-backups.js");
        backups.restoreWatch.set(state.gid + ":2", { gid: state.gid, seat: 2 });
        root.append(el("h1", {}, "Recovery"), backups.restoreProgressNote());
        backups.restoreWatch.clear();
      } else if (scene === "swap-history") {
        const { createSwapPreview } = await import("/app-swap-preview.js");
        const records = [];
        let active = { version: 1, from: "sol", group: false, wallet: "Synthetic wallet",
          swap: { amountIn: "17500000", amountOut: "133000", minAmountOut: "131670",
            depositAddress: "SyntheticDeposit" + "d".repeat(40), recipient: "SyntheticRecipient" + "r".repeat(80),
            refundTo: "SyntheticRefund" + "f".repeat(40), deadline: "2030-01-01T00:00:00.000Z", correlationId: "synthetic-quote" } };
        const route = { ...active.swap, from: "sol", to: "zec", plain: true };
        globalThis.__uxReads = 0;
        const recovery = { load: () => active && structuredClone(active), save: (r) => { active = structuredClone(r); },
          history: () => structuredClone(records), remove: () => { records.unshift(active); active = null; } };
        const provider = { openSwap() { throw Error("History must never open a swap"); },
          async swapStatus() { globalThis.__uxReads++; return { status: "FAILED", originTxs: ["source-tx"],
            destinationTxs: [], swap: route }; } };
        const clock = { now: () => 1_800_000_000_000, set: () => 0, clear() {} };
        globalThis.__uxSwap = createSwapPreview({ id: state.gid, live: true, name: "Synthetic wallet", recovery }, provider, clock);
        root.append(globalThis.__uxSwap.element);
      } else {
        const { payCards } = await import("/sol/payview.js");
        const c = { gid: state.gid, wallet: { cluster: "devnet" }, sessionPage: 0, loaded: {}, docs: {}, raw: {},
          commits: {}, shares: {}, sync: {}, sessions: Array.from({ length: 29 }, (_, i) => ({
            id: "synthetic-proposal-" + i, status: "failed", intent: "", error: "Synthetic ended proposal " + i })),
          host: { el, state, localSeats: () => [], sec: () => ({}), seatIds: () => [1, 2, 3], log() {} } };
        const draw = () => {
          const cards = payCards(c, (fn) => fn, { historyPage(page) { c.sessionPage = page; draw(); } });
          root.replaceChildren(el("h1", {}, "Solana proposals"), ...cards.filter((n) => n.querySelector("[data-session]")));
        };
        draw();
      }
      document.getElementById("app").replaceChildren(root);
    }, scene);
    await settleOverview(page);
    if (scene === "restore-checking") await page.locator('[data-restore-progress="checking"]').waitFor();
    if (scene === "swap-history") {
      await page.getByRole("button", { name: "Done", exact: true }).click();
      const history = page.locator("[data-swap-history]");
      await history.locator(":scope > summary").click();
      await history.locator("details > summary").click();
      assert.match(await history.innerText(), /FAILED/);
      assert.match(await history.innerText(), /source-tx/);
    }
    if (scene === "solana-history") {
      assert.equal(await page.locator('[data-sol="history-newer"]').isDisabled(), true);
      await page.getByRole("button", { name: "Older proposals", exact: true }).click();
      await page.getByRole("button", { name: "Older proposals", exact: true }).click();
      assert.equal(await page.locator('[data-sol="history-older"]').isDisabled(), true);
      assert.equal(await page.locator("[data-session]").count(), 5);
      assert.match(await page.locator('[data-sol="older"]').innerText(), /25–29 of 29/);
    }
    for (const width of [320, 390, 1440]) for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      await settleOverview(page);
      const facts = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
        text: document.getElementById("app").innerText }));
      report.views.push({ scene, width, theme, ...facts });
      assert.equal(facts.overflow, false, scene + " fits " + width + "px");
      if (width === 320 && theme === "light") await page.screenshot({ path: out + "/" + scene + ".png", fullPage: true });
    }
    if (scene === "swap-history") {
      await page.getByRole("button", { name: "Check current status", exact: true }).click();
      assert.equal(await page.evaluate(() => globalThis.__uxReads), 2);
      await page.evaluate(() => globalThis.__uxSwap.model.closeSwap());
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ views: report.views.length, errors: report.errors, out }));
