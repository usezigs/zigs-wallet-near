// Interactions on isolated UI fixtures. No wallet creation, transaction signing, or submissions.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserName, browserOutput, launchTestBrowser } from "../../solspike/harness/browser-test.mjs";
import { overviewFixture, settleOverview } from "../../solspike/harness/overview-redesign-fixture.mjs";
import { installMessagingFixture } from "../../solspike/harness/messaging-redesign.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const output = browserOutput("interactions", process.env.OPENGLASS_AUDIT_OUTPUT);
const browser = await launchTestBrowser();
const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(); page.setDefaultTimeout(5000);
const checks = [], errors = [], limitations = [];
page.on("pageerror", error => errors.push(error.message));
const check = (value, label) => { checks.push({ pass: !!value, label }); assert.ok(value, label); };
async function keyboardDialog() {
  for (const key of ["Tab", "Shift+Tab"]) for (let i = 0; i < 8; i++) {
    await page.keyboard.press(key);
    const focus = await page.evaluate(() => ({
      contained: !!document.activeElement.closest('dialog[open],[role="dialog"]'),
      active: document.activeElement.tagName + "#" + document.activeElement.id,
      modalOpen: !!document.querySelector("dialog[open]"),
    }));
    check(focus.contained, `Dialog contains ${key} ${i + 1}: ${JSON.stringify(focus)}`);
  }
}
try {
  await overviewFixture(context, page, { messaging: true });
  await page.evaluate(async () => {
    (await import("/app-engine.js")).setZ({ normalizeAddress: a => a, payeeAddress: a => a });
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: async value => { globalThis.__auditClipboard = value;
        globalThis.__auditCopyWrites = (globalThis.__auditCopyWrites || 0) + 1; } } });
  });
  await page.getByRole("button", { name: "New wallet", exact: true }).click();
  await page.getByRole("heading", { name: "Protect this browser", exact: true }).waitFor();
  check(await page.locator('.guided-plan > .openglass-backdrop-slot [data-ogui-material="frosted"]').count() === 1,
    "Create protection step is frosted");
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await page.getByRole("heading", { name: "Continue without passkey protection?", exact: true }).waitFor();
  check(await page.locator('.skip-protection-confirmation > .openglass-backdrop-slot [data-ogui-glass]').count() === 1,
    "Optional protection warning retains its glass surface and explicit acknowledgement");
  await page.getByRole("button", { name: "Back to protection", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await page.getByRole("button", { name: "Continue without protection", exact: true }).click();
  await page.getByRole("button", { name: "Use this arrangement", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Set up this device", exact: true }).waitFor();
  await page.locator("#g-name").fill("Treasury");
  await page.getByRole("textbox", { name: "This device's label", exact: true }).fill("Everyday phone");
  await page.getByRole("button", { name: "Continue", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Review your wallet", exact: true }).waitFor();
  check((await page.locator(".guided-plan").innerText()).includes("Treasury"), "Create review retains the wallet name");
  check((await page.locator(".guided-plan").innerText()).includes("Everyday phone"), "Create review retains the labelled TextField value");
  await keyboardDialog();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  check(true, "Create review dismisses without creating a wallet");

  // Restore the same disposable Overview data after the create entry cleared wallet selection.
  await overviewFixture(context, page, { messaging: true });
  await page.evaluate(async () => {
    (await import("/app-engine.js")).setZ({ normalizeAddress: a => a, payeeAddress: a => a });
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: async value => { globalThis.__auditClipboard = value;
        globalThis.__auditCopyWrites = (globalThis.__auditCopyWrites || 0) + 1; } } });
    (await import("/app-send.js")).openSend();
    (await import("/app-loop.js")).draw();
  });
  const recipient = page.locator('input[id^="s-to-"]').first();
  await recipient.fill("utest1" + "q".repeat(180));
  await page.locator('input[id^="s-amt-"]').first().fill("0.25");
  await page.evaluate(() => { globalThis.__auditRecipient = document.querySelector('input[id^="s-to-"]');
    document.documentElement.dataset.theme = "light"; globalThis.zigsGlass.flush(); });
  check(await page.evaluate(() => globalThis.__auditRecipient === document.querySelector('input[id^="s-to-"]')),
    "Send input node survives a theme update");
  check(await page.locator('input[id^="s-amt-"]').first().inputValue() === "0.25", "Send amount survives a theme update");
  await keyboardDialog(); await page.keyboard.press("Escape");
  await page.evaluate(async () => { (await import("/app-state.js")).ui.receive = true;
    (await import("/app-loop.js")).draw(); });
  await page.getByRole("dialog").getByRole("button", { name: "Copy address", exact: true }).click();
  check(await page.locator("#app > .page").first().evaluate(node => node.inert),
    "Receive keeps the underlying wallet view inert");
  check(await page.evaluate(() => globalThis.__auditClipboard === "utest1" + "q".repeat(180)), "Receive copies the exact synthetic address");
  check(await page.locator('.receive-copy[data-result="copied"]').isEnabled()
    && await page.locator(".receive-feedback").textContent() === "Full address copied",
    "Copy reports success and leaves its native owner usable");
  check(await page.evaluate(() => globalThis.__auditCopyWrites === 1),
    "One activation writes the complete address exactly once");
  await keyboardDialog(); await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await settleOverview(page);

  await page.evaluate(async () => {
    const { el } = await import("/app-dom.js"); globalThis.__auditClicks = 0;
    const view = document.querySelector("#app > .page");
    view.append(el("button", { "data-glass": "button", id: "listener-audit",
      onclick: () => globalThis.__auditClicks++ }, "Check listener"));
    globalThis.__messagingView = () => view;
    globalThis.zigsGlass.flush();
  });
  for (const theme of ["dark", "light", "dark", "light"]) await page.evaluate(value => {
    document.documentElement.dataset.theme = value; globalThis.zigsGlass.flush();
  }, theme);
  await page.locator("#listener-audit").focus(); await page.keyboard.press("Enter");
  check(await page.evaluate(() => globalThis.__auditClicks === 1), "Theme updates keep exactly one native listener per library button");

  await page.evaluate(async () => {
    const { createSwapPreview } = await import("/app-swap-preview.js"), { MockSwapProvider } = await import("/swap-preview-model.js");
    const swap = createSwapPreview({ demo: true, name: "Example wallet" }, new MockSwapProvider());
    globalThis.__messagingView = () => swap.element;
    document.getElementById("app").replaceChildren(swap.element); globalThis.zigsGlass.flush();
  });
  await page.getByRole("button", { name: "Choose asset to pay", exact: true }).click();
  check(await page.locator("body > dialog.openglass-overlay").count() === 1, "Native Swap dialog receives the external theme scope");
  await keyboardDialog();
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(value => document.querySelector(".zigs-openglass")?.dataset.oguiAppearance === value
      && document.querySelector("body > dialog")?.dataset.oguiAppearance === value, theme);
    const colors = await page.locator("body > dialog").evaluate(node => ({
      dialog: getComputedStyle(node).color,
      control: getComputedStyle(document.querySelector(".swap-asset-button")).color,
    }));
    check(colors.dialog === colors.control, `External dialog follows ${theme} system text colors: ${JSON.stringify(colors)}`);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("body > dialog").hover();
  await page.waitForFunction(() => document.querySelector("body > dialog")?.hasAttribute("data-openglass-motion")
    && document.querySelector("body > dialog > .openglass-backdrop-slot .openglass-edge-shine")?.hasAttribute("data-openglass-visible"));
  check(await page.locator("body > dialog > .openglass-backdrop-slot .openglass-edge-shine")
    .evaluate(node => getComputedStyle(node).animationName === "openglass-rim-light"),
    "Native dialog reflections respond to interaction");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settleOverview(page);
  check(await page.locator("body > dialog > .openglass-backdrop-slot .openglass-edge-shine")
    .evaluate(node => getComputedStyle(node).animationName === "none"), "Reduced motion stops native dialog reflections");
  let cdp = null;
  if (browserName === "chromium") {
    cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-transparency", value: "reduce" }, { name: "prefers-reduced-motion", value: "reduce" },
    ] });
    await settleOverview(page);
    check(await page.locator("body > dialog .openglass-sheet-material").first()
      .evaluate(node => getComputedStyle(node).backdropFilter === "none"), "External dialog has an opaque reduced-transparency fallback");
  } else limitations.push("Reduced-transparency emulation needs Chromium CDP; not verified in WebKit.");
  await page.emulateMedia({ forcedColors: "active" });
  await settleOverview(page);
  check(await page.locator("body > dialog .openglass-sheet-material").first()
    .evaluate(node => getComputedStyle(node).backdropFilter === "none"), "External dialog supports forced colors");
  await page.keyboard.press("Escape"); await page.locator("body > dialog").waitFor({ state: "detached" });
  check(await page.getByRole("button", { name: "Choose asset to pay", exact: true }).evaluate(node => node === document.activeElement),
    "Swap Escape dismissal returns focus to its opener");
  if (cdp) await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  await page.emulateMedia({ forcedColors: "none", colorScheme: "dark", reducedMotion: "reduce" });
  await page.reload();
  await page.locator("#app").waitFor({ state: "attached" });
  await installMessagingFixture(page, "setup", "after");
  const chat = page.getByRole("tab", { name: /^Chat(?:\s|$)/ });
  const onChain = page.getByRole("tab", { name: "On-chain messages", exact: true });
  const tabPaint = (tab) => tab.evaluate(node => ({
    text: getComputedStyle(node).color,
    opacity: getComputedStyle(node.querySelector(".openglass-backdrop-slot")).opacity,
    fill: getComputedStyle(node.querySelector("[data-ogui-glass]")).backgroundImage,
  }));
  await settleOverview(page);
  check(JSON.stringify(await tabPaint(chat)) !== JSON.stringify(await tabPaint(onChain)),
    "Selected and unselected tabs have visibly distinct materials");
  await onChain.click(); await settleOverview(page);
  check(await onChain.getAttribute("aria-selected") === "true" && await chat.getAttribute("aria-selected") === "false",
    "Changing transport keeps the native tab selection semantics");
  check((await tabPaint(onChain)).opacity === "1" && (await tabPaint(chat)).opacity === "0.35",
    "Selection styling follows the active transport");
  assert.deepEqual(errors, [], "No runtime errors during audited interactions");
  console.log(`OpenGlass interactions: ${checks.length} checks passed`);
} finally {
  writeFileSync(resolve(output, "interactions.json"), JSON.stringify({ checks, errors, limitations,
    scope: "Disposable UI fixtures; setup stopped at review; no wallet creation or payment submission." }, null, 2));
  await browser.close();
}
