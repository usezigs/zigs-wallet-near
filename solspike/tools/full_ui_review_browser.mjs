// Read-only UI audit: real renderers, disposable synthetic data, no external requests or submits.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overviewFixture, settleOverview, OVERVIEW_ORIGIN }
  from "../harness/overview-redesign-fixture.mjs";
import { installMessagingFixture } from "../harness/messaging-redesign.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve(process.env.ZIGS_FULL_UI_OUTPUT || "solspike/.state/full-ui-review");
mkdirSync(out, { recursive: true });
const checks = [], screens = [], layouts = [], focus = [], errors = [];
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce" });
const page = await context.newPage(), cdp = await context.newCDPSession(page);
page.setDefaultTimeout(5000);
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  const interval = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => ms === 60000 ? 0 : interval(fn, ms, ...args);
});

async function choose(tab, theme, width) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await page.evaluate(async ({ tab, theme }) => {
    const { state, ui } = await import("/app-state.js");
    document.documentElement.dataset.theme = theme;
    state.g = tab === "home" ? null : state.groups[0]; state.gid = state.g?.id ?? null;
    ui.tab = tab === "home" ? "overview" : tab;
    (await import("/app-loop.js")).draw(); window.scrollTo(0, 0);
  }, { tab, theme });
  await settleOverview(page);
}

function interfaceFacts() {
  const root = document.getElementById("app");
  const visible = (node) => node.checkVisibility({ checkVisibilityCSS: true })
    && !node.closest("[inert],[hidden]");
  const label = (node) => (node.getAttribute("aria-label") || node.id
    || node.textContent || node.tagName).slice(0, 90);
  const references = [...document.querySelectorAll(
    "[aria-labelledby],[aria-describedby],[aria-controls]")].filter(visible);
  const missing = references.flatMap((node) => ["aria-labelledby", "aria-describedby",
    "aria-controls"].flatMap((attr) => (node.getAttribute(attr) || "").split(/\s+/)
    .filter((id) => id && !document.getElementById(id)).map((id) => ({ id, attr }))));
  const fields = [...root.querySelectorAll("input:not([type=hidden]),textarea,select")]
    .filter(visible).filter((node) => !node.labels?.length && !node.getAttribute("aria-label")
      && !node.getAttribute("aria-labelledby")).map(label);
  const controls = [...root.querySelectorAll("button,summary,input,textarea,select")]
    .filter(visible).filter((node) => !node.matches(":disabled,[aria-disabled=true]"));
  const small = controls.filter((node) => !usableTarget(node)).map(label);
  const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
  return { missing, fields, small, uniqueIds: ids.length === new Set(ids).size,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    stringified: root.textContent.includes("[object"),
    images: [...root.querySelectorAll("img")].filter(visible)
      .filter((node) => !node.hasAttribute("alt")).map((node) => node.getAttribute("src")) };

  function usableTarget(node) {
    const target = node.matches("input[type=checkbox],input[type=radio]")
      ? node.closest("label") || node : node;
    const r = target.getBoundingClientRect();
    if (r.width >= 43 && r.height >= 43) return true;
    if (!node.matches(".pp-status")) return false;
    // This badge deliberately expands its hit area while retaining the compact visible pill.
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return [-23, 23].every((offset) => {
      const hit = document.elementFromPoint(x, y + offset);
      return hit === node || node.contains(hit);
    });
  }
}

async function inspect(label) {
  const facts = await page.evaluate(interfaceFacts);
  const tree = await cdp.send("Accessibility.getFullAXTree");
  const roles = ["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio",
    "tab", "switch", "DisclosureTriangle"];
  const unnamed = tree.nodes.filter((n) => !n.ignored && roles.includes(n.role?.value)
    && !n.name?.value).map((n) => n.role.value);
  check(!facts.overflow, label + ": no horizontal overflow");
  check(!facts.missing.length, label + ": ARIA references resolve");
  check(!facts.fields.length && !unnamed.length, label + ": fields and controls have names");
  check(!facts.small.length, label + ": active controls have usable targets: " + facts.small);
  check(facts.uniqueIds, label + ": document identifiers are unique");
  check(!facts.images.length && !facts.stringified, label + ": complete visual semantics");
  layouts.push({ label, ...facts, unnamed });
}

async function capture(name) {
  await page.screenshot({ path: resolve(out, name + ".png"), fullPage: true,
    animations: "disabled" });
  screens.push(name + ".png");
}

async function dashboardApprovalsReview() {
  await choose("overview", "dark", 1440);
  for (const formerView of ["recent", "pending"]) {
    await page.evaluate(async (value) => {
      (await import("/app-state.js")).ui.overviewActivity = value;
      (await import("/app-loop.js")).draw();
    }, formerView);
    await settleOverview(page);
    check(await page.locator("#overview-approvals").getByRole("heading", {
      name: "Approvals", exact: true }).isVisible(),
    formerView + ": dashboard approvals remain visible independently of the old transaction view");
    check(await page.locator(".overview-transactions .recent-transactions").isVisible(),
      formerView + ": recent transactions remain visible alongside approvals");
    check(await page.getByRole("button", { name: "View all approvals", exact: true }).isVisible(),
      formerView + ": the full Approvals destination is available even with an empty queue");
  }
  for (const width of [320, 390, 768, 1440]) for (const theme of ["dark", "light"]) {
    await choose("overview", theme, width);
    check(await page.evaluate(() => document.querySelector("#overview-approvals")
      .getBoundingClientRect().bottom
      <= document.querySelector(".overview-transactions").getBoundingClientRect().top),
    width + " " + theme + ": dashboard approvals precede transaction history");
  }
  await page.getByRole("button", { name: "View all approvals", exact: true }).click();
  await page.locator("#panel-approvals").waitFor();
  check(true, "the dashboard approval action opens the existing Approvals inbox");
  await choose("overview", "dark", 1440);
  await page.getByRole("button", { name: "View all activity", exact: true }).click();
  await page.locator("#panel-activity").waitFor();
  check(true, "the dashboard transaction action opens the existing Activity page");
  await choose("overview", "dark", 1440);
  await dashboardApprovalStates();
  await inspect("restored dashboard approvals");
  await capture("overview-approvals-restored");
}

async function dashboardApprovalStates() {
  for (const kind of ["waiting", "attention", "failed", "loading", "empty"]) {
    await page.evaluate(async (kind) => {
      const { state } = await import("/app-state.js");
      state.sessions = ["waiting", "attention"].includes(kind) ? [{
        id: "synthetic-dashboard-approval",
        status: kind === "waiting" ? "collecting" : "unreadable",
        createdAt: 1792735200000, payees: [], by: 1,
      }] : [];
      state.sessionsFailed = kind === "failed";
      state.sessionsLoaded = kind !== "loading";
      (await import("/app-loop.js")).draw();
    }, kind);
    await settleOverview(page);
    const approvals = page.locator("#overview-approvals");
    const content = await approvals.innerText();
    check(await approvals.isVisible(),
      kind + ": the dedicated dashboard approval panel stays visible");
    check(kind === "empty" ? content.includes("No approvals waiting")
      : !content.includes("No approvals waiting"),
    kind + ": approval status does not claim a false empty queue");
    if (kind === "waiting") check(content.includes("Waiting for the other devices or the network"),
      "the dashboard retains waiting approval counts");
    if (kind === "attention") check(content.includes("Needs attention"),
      "the dashboard retains unreadable items needing attention");
    if (kind === "failed") check(await approvals.getByRole("alert").count() === 1,
      "failed approval reads retain their alert");
    if (kind === "loading") check(content.includes("Checking payments"),
      "unread approvals retain their checking state");
  }
}

async function pageMatrix() {
  const variants = [320, 390, 768, 1440].flatMap((width) =>
    ["dark", "light"].map((theme) => ({ width, theme })));
  for (const { width, theme } of variants) {
    for (const tab of ["home", "overview", "approvals", "activity", "recipients", "swap",
      "chats", "recovery", "settings"]) {
      await choose(tab, theme, width); await inspect(`${tab} ${width} ${theme}`);
      if (tab === "swap" && width === 320) await capture(`swap-${theme}-320`);
    }
  }
}

async function menuReview() {
  await choose("home", "dark", 390);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("wallet-menu")
    .getAttribute("aria-expanded") === "true");
  check(await page.locator(".main").evaluate((node) => node.inert),
    "open mobile menu keeps the underlying page out of keyboard reach");
  for (const name of ["Money", "Contacts", "Wallet care"]) {
    check(await page.getByRole("group", { name, exact: true }).count() === 1,
      "navigation exposes the " + name + " group");
  }
  check(await page.locator(".side-section button[id^=tab-]").count() === 8,
    "grouping preserves all eight direct section actions");
  check(await page.locator(".side-section .side-name").evaluateAll((nodes) => nodes
    .filter((n) => !n.textContent.includes(" ")).every((n) => n.getBoundingClientRect().height
      <= parseFloat(getComputedStyle(n).lineHeight) + 1)),
  "compact phone navigation keeps whole destination words together");
  check(await page.locator('.side.menu-open #side-nav > .openglass-backdrop-slot '
    + '[data-ogui-material="frosted"]').count() === 1,
    "mobile navigation receives its own frosted Glass material");
  for (let i = 0; i < 16; i++) await page.keyboard.press("Tab");
  check(await page.evaluate(() => document.querySelector(".side").contains(document.activeElement)),
    "mobile menu keyboard loop stays inside navigation");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("wallet-menu")
    .getAttribute("aria-expanded") === "false");
  check(await page.locator("#wallet-menu").evaluate((node) => node === document.activeElement
    && node.getAttribute("aria-expanded") === "false"),
  "Escape dismisses mobile navigation and returns focus to Menu");
}

async function restoreRouteReview() {
  for (const theme of ["light", "dark"]) {
    await choose("recovery", theme, 390);
    const shortcut = page.locator(".security-restore-shortcut");
    check(await shortcut.evaluate((node) => {
      const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
    }), theme + ": Restore is available in the first phone viewport");
    await shortcut.click();
    check(await page.locator("#security-restore").evaluate((node) => node.open
      && node.querySelector("summary") === document.activeElement),
    theme + ": Restore opens existing guidance and moves keyboard focus there");
    check(await page.locator('[data-key="security-restore-file"]').isVisible(),
      theme + ": recovery-file selection remains in the existing restore path");
  }
}

async function stressReview() {
  await choose("overview", "dark", 390);
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    state.groups[0].name = "FamilyStudioReserveWallet".repeat(4);
    Object.values(state.seats).forEach((s, i) => { s.name = ["FamilyStudioLaptop".repeat(4),
      "Reserve recovery signer kept offline", "海外旅行用の共有端末"][i]; });
    const balance = (await import("/app-chain.js")).curChain().bal;
    balance.spendable = 21000000 * 1e8; balance.pending = 21000000 * 1e8;
  });
  for (const width of [320, 390, 768, 1440]) for (const theme of ["dark", "light"]) {
    for (const tab of ["overview", "approvals", "activity", "recovery", "settings"]) {
      await choose(tab, theme, width); await inspect(`long labels ${tab} ${width} ${theme}`);
    }
  }
  await choose("recovery", "light", 320); await capture("long-names-security-320");
}

async function composerReview(scene, width, theme) {
  const field = page.locator(".composer textarea:visible").first();
  if (!await field.count()) return;
  for (const height of width < 600 ? [844, 360] : [1000]) {
    await page.setViewportSize({ width, height }); await settleOverview(page);
    await field.evaluate((node) => node.blur()); await field.focus(); await settleOverview(page);
    const result = await field.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { top: r.top, bottom: r.bottom, viewport: innerHeight,
        clear: r.top >= 0 && r.bottom <= innerHeight && (hit === node || node.contains(hit)) };
    });
    focus.push({ scene, width, theme, height, ...result });
    check(result.clear, `${scene} ${width}×${height} ${theme}: focused composer is unobscured`);
  }
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await page.evaluate(() => window.scrollTo(0, 0)); await settleOverview(page);
}

async function messagingReview() {
  for (const scene of ["team", "direct", "contact", "changed-key", "invite", "setup"]) {
    await page.goto(OVERVIEW_ORIGIN);
    await installMessagingFixture(page, scene, "after");
    if (scene === "setup") await page.locator("#messages-tab-zcash").click();
    const variants = [320, 390, 1440].flatMap((width) =>
      ["dark", "light"].map((theme) => ({ width, theme })));
    for (const { width, theme } of variants) await messagingVariant(scene, width, theme);
  }
}

async function backupReminderReview() {
  await page.goto(OVERVIEW_ORIGIN);
  await installMessagingFixture(page, "team", "after");
  const before = await page.evaluate(async () => {
    const { state, keys, loop, gid } = globalThis.__messagingFixture;
    const { localSeats } = await import("/app-seats.js");
    const { walletView } = await import("/app-wallet.js");
    state.wallet.address = "utest1" + "syntheticwallet".repeat(10);
    await (await import("/app-sol.js")).overviewFixtureSol();
    // Read-only renderer fixture, with two unsaved local shares; no wallet operations.
    globalThis.__messagingView = () => walletView([], null);
    loop.draw();
    return { seats: localSeats(), unsaved: localSeats().every((i) =>
      !keys.sec(gid, i).backupSaved), secrets: JSON.stringify(keys.secrets) };
  });
  check(before.seats.length === 2 && before.unsaved,
    "backup presentation fixture holds two unsaved local shares");
  const variants = [390, 1440].flatMap((width) =>
    ["dark", "light"].map((theme) => ({ width, theme })));
  for (const { width, theme } of variants) {
    for (const tab of ["overview", "approvals", "activity", "recovery", "settings"]) {
      await choose(tab, theme, width);
      check(!/Back up your key share|This browser can forget it/.test(
        await page.locator("#app").innerText()),
      `${tab} ${width} ${theme}: unsaved shares do not create a page-wide backup warning`);
      await inspect(`unsaved shares ${tab} ${width} ${theme}`);
      if (tab === "recovery") check(await page.locator('[data-key="security-backup-1-zec"]')
        .count() === 1 && await page.locator('[data-key="security-backup-3-zec"]').count() === 1,
      `${width} ${theme}: Security retains manual backup for the unsaved share`);
      if (tab === "overview" && theme === "dark") await capture(`no-backup-banner-${width}`);
    }
  }
  check(before.secrets === await page.evaluate(() =>
    JSON.stringify(globalThis.__messagingFixture.keys.secrets)),
  "removing the visual reminders does not mark unsaved shares as saved");
}

async function messagingVariant(scene, width, theme) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await page.evaluate((t) => { document.documentElement.dataset.theme = t;
    window.scrollTo(0, 0); }, theme);
  await settleOverview(page); await inspect(`messages ${scene} ${width} ${theme}`);
  check(await page.locator(".messages-backup-reminder").count() === 0,
    `${scene} ${width} ${theme}: conversation omits the automatic backup reminder`);
  await composerReview(scene, width, theme);
  if (scene === "setup") await setupSpaceReview(width, theme);
  if (scene === "contact" && width === 390) await backReview(theme);
  if (width === 390 && theme === "dark") await capture("messages-" + scene);
}

async function setupSpaceReview(width, theme) {
  const facts = await page.locator(".messages-layout").evaluate((node) => {
    const thread = node.querySelector(".messages-setup-thread");
    const box = thread.getBoundingClientRect();
    const form = thread.querySelector(".messages-account-setup").getBoundingClientRect();
    const actions = [...thread.querySelectorAll(".dialog-actions button")]
      .map((button) => button.getBoundingClientRect());
    return { inboxHidden: !node.querySelector(".messages-inbox").checkVisibility(),
      pageScroll: thread.scrollHeight <= thread.clientHeight + 1,
      formFits: form.bottom <= box.bottom + 1,
      actionsFit: actions.every((r) => r.top >= box.top && r.bottom <= box.bottom + 1) };
  });
  check(facts.inboxHidden && facts.pageScroll && facts.formFits && facts.actionsFit,
    width + " " + theme + ": setup uses the page without an empty sidebar or clipped form/actions");
  const action = page.getByRole("button", { name: "Recover access", exact: true });
  await action.evaluate((node) => node.blur()); await action.focus();
  check(await page.getByRole("button", { name: "Recover access", exact: true }).evaluate((node) => {
    const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
  }), width + " " + theme + ": setup action is reachable by page scrolling");
  await page.evaluate(() => window.scrollTo(0, 0)); await settleOverview(page);
  if (width === 1440) await capture("messages-setup-" + theme + "-desktop");
}

async function backReview(theme) {
  const back = page.locator('[data-key="contact-back"]');
  check(await back.getAttribute("aria-label") === "Back to conversations",
    theme + ": on-chain Back action has an explicit accessible name");
  check(await back.locator('[data-icon="back"]').count() === 1
    && await back.evaluate((n) => getComputedStyle(n, "::before").content === "none"),
  theme + ": mobile on-chain Back has one SVG and no duplicated CSS arrow");
}

try {
  await overviewFixture(context, page, { messaging: true });
  await page.evaluate(() => localStorage.setItem("zf-name", ""));
  const before = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  await pageMatrix(); await dashboardApprovalsReview();
  await menuReview(); await restoreRouteReview();
  check(before === await page.evaluate(() => JSON.stringify({ ...localStorage })),
    "page audit and navigation leave synthetic browser storage unchanged");
  await stressReview(); await backupReminderReview(); await messagingReview();
  check(!errors.length, "no browser errors: " + errors.join("; "));
  console.log(`full UI review: ${checks.length} checks, ${layouts.length} layouts, `
    + `${focus.length} composer focus variants`);
} finally {
  await browser.close();
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ checks, layouts, focus,
    screens, errors, context: "Disposable synthetic data; external requests blocked; no submits" },
  null, 2));
}
