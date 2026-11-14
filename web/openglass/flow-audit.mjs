// Full presentation audit. Isolated stores, real renderers, no network submissions or funds.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserName, browserOutput, launchTestBrowser } from "../../solspike/harness/browser-test.mjs";
import { overviewFixture, settleOverview, OVERVIEW_ORIGIN } from "../../solspike/harness/overview-redesign-fixture.mjs";
import { installMessagingFixture } from "../../solspike/harness/messaging-redesign.mjs";
import { SWAP_DEMO_STEPS } from "../swap-preview-model.js";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const output = browserOutput("matrix", process.env.OPENGLASS_AUDIT_OUTPUT);
const widths = process.env.ZIGS_BROWSER_SMOKE === "1" ? [320, 1024, 1440]
  : [320, 375, 390, 768, 1024, 1440, 1920];
const records = [], errors = [], scenes = [], failures = [];
const sceneFilter = process.env.OPENGLASS_AUDIT_SCENES ? new RegExp(process.env.OPENGLASS_AUDIT_SCENES) : null;
const browser = await launchTestBrowser();
const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  globalThis.qaSol = { setup: { status: "ready" }, rows: [] };
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
page.on("pageerror", (error) => errors.push({ scene: scenes.at(-1), message: error.message }));
await overviewFixture(context, page, { messaging: true });
// Static fixtures keep their own renderer mounted, while interactive journeys use the normal loop.
let staticFixture = false;
await context.route("**/app-loop.js", (route) => {
  let source = readFileSync("web/app-loop.js", "utf8")
    .replace("export function react() {", "export function react() { return;")
    .replace("function pageView() {", "function pageView() { if(globalThis.__messagingView) return globalThis.__messagingView();");
  if (staticFixture) source = source.replace("export function render() {", "export function render() { return;");
  return route.fulfill({ body: source, contentType: "text/javascript" });
});
await context.route("**/app-wallet.js", (route) => route.fulfill({ contentType: "text/javascript",
  body: readFileSync("web/app-wallet.js", "utf8") + "\nexport { activityTab, pageHeading, groupHead };" }));
const activity = readFileSync("solspike/tools/activity_design_browser.mjs", "utf8");
const patchSol = new Function("return (" + activity.slice(activity.indexOf("function fixtureSol("),
  activity.indexOf("\nconst server")) + ")")();
await context.route("**/app-sol.js", (route) => route.fulfill({ contentType: "text/javascript",
  body: patchSol(readFileSync("web/app-sol.js", "utf8")) }));
await context.route("**/test/*.mjs", (route) => route.fulfill({ contentType: "text/javascript",
  body: readFileSync(resolve("web", new URL(route.request().url()).pathname.slice(1)), "utf8") }));

async function seed() {
  await page.goto(OVERVIEW_ORIGIN);
  await page.locator("#app").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    const { setZ } = await import("/app-engine.js");
    const { setChain } = await import("/app-chain.js");
    const { setMe } = await import("/app-groups.js");
    const { setSecrets, setGkeys } = await import("/app-keystore.js");
    const { signPins } = await import("/app-filter.js");
    const g = { id: "ab".repeat(10), name: "Everyday wallet", n: 3, t: 2, version: 3, network: "testnet" };
    const address = "utest1" + "q".repeat(180), no = "12345 67890 12345 67890 12345 67890";
    const seats = Object.fromEntries([1, 2, 3].map((i) => [i, {
      uid: "synthetic-device-" + i, name: ["Everyday phone", "Studio laptop", "Reserve device"][i - 1],
      boxPk: String(i).repeat(64), signPk: String(i + 3).repeat(64),
    }]));
    const wallet = { address, birthday: 4500000, orchard_fvk: "synthetic-viewing-key" };
    const secret = { ...seats[1], version: 3, signSk: "77".repeat(32), confirmed: no,
      checkedWallet: JSON.stringify(wallet), keyPackage: { signing_share: "88".repeat(32) },
      publicKeyPackage: {}, groupKey: "99".repeat(32) };
    Object.assign(state, { g, gid: g.id, groups: [g], wallet, seats, seatsLoaded: true,
      seatsSettled: true, sessionsLoaded: true, sessionsSettled: true, sessionsFailed: false,
      sessions: [], pending: false, sid: null, commits: {}, shares: {}, verify: {}, done: {}, confirm: {} });
    setMe(seats[1].uid); setSecrets({ [g.id + ":1"]: secret }); setGkeys({ [g.id]: "a".repeat(43) });
    signPins["version:" + g.id] = "3"; signPins["confirmednet:" + g.id] = "testnet";
    setZ({ normalizeAddress: (a) => a, payeeAddress: (a) => a, safetyNumber: () => no,
      inspect: () => JSON.stringify({ txid: "ab".repeat(32), sighash: "synthetic-hash", fee: 10000,
        standard_fee: 10000, expiry_height: 5000100, tx_version: "v5", lines: [
          { kind: "spend", value: 25010000 }, { kind: "output", who: address, value: 25000000, memo_status: "empty" }] }),
      expiryState: () => JSON.stringify({ expired: false, seconds_left: 1000, blocks_left: 100 }),
      blockSpanSeconds: (_net, from, to) => (to - from) * 75 });
    setChain({ gid: g.id, cw: {}, bal: { spendable: 100000000, pending: 0, height: 5000000,
      tip: 5000000, max_send: 99990000 }, balAt: Date.now(), sent: new Set(), received: [] });
    globalThis.__glassAudit = { state, ui, g, wallet, seats, secret, address, no };
    ui.tab = "overview";
    (await import("/app-loop.js")).draw();
  });
}

function facts() {
  const shown = (node) => node.checkVisibility() && node.getClientRects().length
    && !node.closest('[hidden], [inert], details:not([open]) > :not(summary)');
  const name = (node) => (node.getAttribute("aria-label") || node.id || node.className || node.tagName).toString().slice(0, 100);
  const painted = (node) => node.matches(".ogui-card,[data-ogui-glass]")
    || !!node.querySelector(":scope > .openglass-backdrop-slot > [data-ogui-glass]");
  const surfaces = [...document.querySelectorAll('.card:not(.welcome), .home-hero, .surface-quiet, .surface-chrome, dialog[open], [role="dialog"], .drawer, .swap-composer, .swap-detail-card, .swap-privacy, .swap-settings-panel, .swap-privacy-explainer, .swap-execution, .swap-execution-option, .swap-history, .swap-history-row, .privacy-film, .pq-form, .pq-recap, .pq-result, .messages-inbox, .messages-thread, .sol-receive-card, .wallet-vault-card')].filter(shown);
  const controls = [...document.querySelectorAll("button,summary.btn,a.btn")].filter(shown);
  const missing = [...document.querySelectorAll("[aria-labelledby],[aria-describedby],[aria-controls]")].filter(shown)
    .flatMap((node) => ["aria-labelledby", "aria-describedby", "aria-controls"].flatMap((attribute) =>
      (node.getAttribute(attribute) || "").split(/\s+/).filter((id) => id && !document.getElementById(id))
        .map((id) => ({ node: name(node), attribute, id }))));
  const fields = [...document.querySelectorAll("input:not([type=hidden]),textarea,select")].filter(shown)
    .filter((node) => !node.labels?.length && !node.getAttribute("aria-label") && !node.getAttribute("aria-labelledby")).map(name);
  const overflow = [...document.querySelectorAll("dialog[open],.dialog,.drawer")].filter(shown)
    .filter((node) => node.scrollWidth > node.clientWidth + 1).map(name);
  const uncovered = surfaces.filter((node) => !painted(node)).map(name);
  const untreated = controls.filter((node) => !node.matches(".ogui-button") && !painted(node)).map(name);
  const nativeDialogs = [...document.querySelectorAll("dialog[open]")].map((node) => ({
    name: name(node), scoped: !!node.closest(".zigs-openglass,.openglass-overlay"),
    theme: node.closest(".openglass-overlay")?.dataset.oguiAppearance,
  }));
  const otherPanels = [...document.querySelectorAll("#app :is(section,article,aside,form,details)")].filter(shown)
    .filter(node => !painted(node) && !node.matches(".welcome"))
    .filter(node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      return box.width > 180 && box.height > 80
        && (style.backgroundImage !== "none" || !["rgba(0, 0, 0, 0)", "transparent"].includes(style.backgroundColor));
    }).map(name);
  return { surfaces: surfaces.length, controls: controls.length, uncovered, untreated, missing, fields, overflow,
    otherPanels,
    headings: [...document.querySelectorAll("#app h1,#app h2,dialog[open] h2")].filter(shown).map(node => node.textContent),
    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, nativeDialogs,
    slotCount: document.querySelectorAll("[data-openglass-slot]").length };
}

async function inspect(scene, width, theme) {
  await page.setViewportSize({ width, height: ({ 320: 800, 375: 812, 390: 844,
    768: 1024, 1024: 768, 1440: 900, 1920: 1080 })[width] });
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; globalThis.zigsGlass.flush(); }, theme);
  await settleOverview(page);
  const value = await page.evaluate(facts);
  const issues = ["uncovered", "untreated", "missing", "fields", "overflow"].filter((key) => value[key].length);
  if (value.pageOverflow) issues.push("pageOverflow");
  if (value.nativeDialogs.some((dialog) => !dialog.scoped || dialog.theme && dialog.theme !== theme)) issues.push("overlayTheme");
  const record = { scene, width, theme, ...value, issues };
  records.push(record);
  if (issues.length || process.env.ZIGS_CAPTURE_MATRIX === "1"
    && ((width === 1440 && theme === "dark") || (width === 390 && theme === "light"))) {
    await page.screenshot({ path: resolve(output, `${scene}-${theme}-${width}.png`), fullPage: true,
      animations: "disabled", mask: [page.locator(".safety,.qr,.secret-link,input[type=password],.addr-full")],
      maskColor: "#343b45" });
  }
  return issues.length === 0;
}

async function matrix(name, prepare, { fresh = true, staticView = true } = {}) {
  if (sceneFilter && !sceneFilter.test(name)) return;
  scenes.push(name); staticFixture = staticView;
  try {
    if (fresh) await seed();
    await prepare();
    if (name.startsWith("dialog-")) assert.ok(await page.locator('[role="dialog"],dialog[open]').count(), name + ": actual dialog rendered");
    for (const width of widths) for (const theme of ["dark", "light"])
      await inspect(name, width, theme);
    console.log(`Audited ${name}`);
  } catch (error) {
    failures.push({ scene: name, message: error.message });
    console.log(`FAILED ${name}: ${error.message.split("\n")[0]}`);
  }
}

// Reuse established state fixtures, without their historical presentation assertions.
function fixture(file, fnName) {
  const source = readFileSync(file, "utf8"), start = source.indexOf("async function " + fnName + "(");
  const end = source.indexOf("\nasync function ", start + 1);
  const fn = source.slice(start, end).replace("await page.goto(origin);",
    'await page.goto(origin); await page.locator("#app").waitFor({ state: "attached" });');
  return (...args) => new Function("page", "origin", "args", "return (" + fn + ")(...args)")(page, OVERVIEW_ORIGIN, args);
}
const approvals = fixture("solspike/tools/approvals_experience_browser.mjs", "scene");
const activityScene = fixture("solspike/tools/activity_design_browser.mjs", "scene");
const receipt = fixture("solspike/tools/transaction_receipts_browser.mjs", "fixture");

try {
  for (const tab of ["overview", "approvals", "activity", "recipients", "swap", "chats", "recovery", "settings"])
    await matrix("route-" + tab, () => page.evaluate(async (tab) => {
      (await import("/app-state.js")).ui.tab = tab;
      (await import("/app-loop.js")).draw();
    }, tab));
  for (const mode of ["saved", "editor", "invalid", "edit", "delete-confirmation", "no-results"])
    await matrix("recipients-" + mode, async () => {
      await page.evaluate(async (mode) => {
        const { recipients } = await import("/app-keystore.js"), { ui, address } = globalThis.__glassAudit;
        ui.tab = "recipients";
        if (["saved", "edit", "delete-confirmation", "no-results"].includes(mode)) recipients.entries.push({
          id: "cd".repeat(10), name: "Studio address", address, asset: "ZEC", network: "testnet", type: "shielded" });
        globalThis.__paintRecipients = async () => document.getElementById("app").replaceChildren(
          (await import("/app-recipients.js")).recipientsView());
        await globalThis.__paintRecipients();
      }, mode);
      if (["editor", "invalid"].includes(mode)) await page.getByRole("button", { name: "Add recipient", exact: true }).click();
      if (mode === "edit") await page.getByRole("button", { name: "Edit Studio address", exact: true }).click();
      if (mode === "delete-confirmation") await page.getByRole("button", { name: "Delete Studio address", exact: true }).click();
      await page.evaluate(() => globalThis.__paintRecipients());
      if (mode === "invalid") {
        await page.getByLabel("Name on this device", { exact: true }).fill("Studio address");
        await page.getByLabel("Full payment address", { exact: true }).fill("invalid-address");
        await page.getByRole("button", { name: "Save recipient", exact: true }).click();
        await page.evaluate(() => globalThis.__paintRecipients());
        assert.ok(await page.locator(".recipient-editor [role=alert]").count(), "Recipient validation error is rendered");
      }
      if (mode === "no-results") await page.getByRole("searchbox", { name: "Search payment recipients" }).fill("no such recipient");
    });
  for (const mode of ["new", "returning", "join", "locked", "damaged", "loading-engine", "loading-group", "offline", "error"])
    await matrix("entry-" + mode, () => page.evaluate(async (mode) => {
      const { state, ui } = globalThis.__glassAudit;
      const shell = await import("/app-shell.js"), { el, unreadable } = await import("/app-dom.js");
      state.gid = null; state.g = null;
      if (mode === "new") state.groups = [];
      if (mode === "join") { ui.joinOpen = true; ui.joinBad = "This invitation is incomplete."; }
      if (["locked", "damaged"].includes(mode)) (await import("/app-keystore.js")).setLocked({ damaged: mode === "damaged" });
      if (mode === "loading-engine") (await import("/app-engine.js")).setZ(null);
      const view = mode.startsWith("loading") ? shell.loadingView()
        : ["locked", "damaged"].includes(mode) ? shell.lockView() : shell.lobby();
      document.getElementById("app").replaceChildren(view);
      if (mode === "offline") document.getElementById("offline").append(el("div", { class: "callout warn" }, "No network connection. Cached information may be old."));
      if (mode === "error") { document.getElementById("app").append(unreadable());
        (await import("/app-state.js")).showBanner("bad", "The local connection could not be reached."); }
    }, mode));
  for (const step of [0, 1, 2, 3]) await matrix("create-step-" + step, () => page.evaluate(async (step) => {
    const { state, ui } = globalThis.__glassAudit;
    state.g = null; state.gid = null; ui.createStep = step; ui.createDraft = { name: "Treasury", n: 3, t: 2 };
    document.getElementById("app").replaceChildren((await import("/app-shell.js")).createDialog());
  }, step));
  for (const mode of ["send", "send-multiple", "send-error", "receive", "backup", "backup-busy", "backup-check", "restore", "change-devices", "new-chat", "help", "network"])
    await matrix("dialog-" + mode, () => page.evaluate(async (mode) => {
      const { state, ui, address } = globalThis.__glassAudit, { el } = await import("/app-dom.js");
      const send = await import("/app-send.js"), backups = await import("/app-backups.js");
      let view;
      if (mode.startsWith("send")) {
        ui.send = true; ui.pay = [{ k: 0, to: mode === "send-error" ? "invalid" : "", amt: "", memo: "" }];
        if (mode === "send-multiple") ui.pay.push({ k: 1, to: address, amt: "0.25", memo: "Studio expenses" });
        ui.listError = mode === "send-error" ? "Check the recipient address." : ""; view = send.sendDialog();
      } else if (mode === "receive") view = send.receiveDialog();
      else if (mode.startsWith("backup")) {
        ui.backup = { seat: 1, chain: "zec", busy: mode === "backup-busy", check: mode === "backup-check",
          words: { title: "Save this device’s Zcash share", pass: "Choose a passphrase.", file: "Keep the file and passphrase apart.", save: async () => false } };
        view = backups.backupDialog();
      } else if (mode === "restore") { ui.restore = { name: "Synthetic recovery file", text: "", busy: false }; view = backups.restoreDialog(); }
      else if (mode === "change-devices") view = (await import("/app-shell.js")).createDialog(state.g);
      else if (mode === "new-chat") view = (await import("/app-thread.js")).newChatDialog();
      else if (mode === "help") {
        const help = await import("/app-how-zigs-works.js"); help.openHowZigsWorks(); view = help.howZigsWorksDialog();
      }
      else view = (await import("/app-network-privacy.js")).networkPrivacyPanel();
      document.getElementById("app").replaceChildren(view || el("p", {}, "No dialog rendered"));
    }, mode));
  for (const mode of ["connect", "join", "verify", "mismatch", "prepare", "stopped", "backup", "complete"])
    await matrix("setup-" + mode, () => page.evaluate(async (mode) => {
      const { state, g, seats, secret, no, wallet } = globalThis.__glassAudit;
      const { setSecrets } = await import("/app-keystore.js");
      const record = (await import("/guided-setup-model.js")).emptyGuidedRecord();
      state.wallet = null; state.seats = ["connect", "join"].includes(mode) ? { 1: seats[1] } : seats;
      const held = { ...secret }; delete held.checkedWallet; delete held.keyPackage;
      held.confirmed = ["verify", "mismatch"].includes(mode) ? null : no;
      setSecrets(mode === "join" ? {} : { [g.id + ":1"]: held });
      state.confirm = ["verify", "mismatch"].includes(mode) ? {} : Object.fromEntries([1, 2, 3].map(i => [i, { number: no }]));
      if (mode === "mismatch") state.confirm[2] = { number: "99999 ".repeat(5) + "99999" };
      if (mode === "stopped") state.abort = { 2: { reason: "Synthetic setup stopped for review." } };
      if (["backup", "complete"].includes(mode)) {
        state.wallet = wallet; state.verify = { 1: { ok: true }, 2: { ok: true }, 3: { ok: true } };
        held.keyPackage = secret.keyPackage; held.checkedWallet = JSON.stringify(wallet);
        state.done = Object.fromEntries([1, 2, 3].map(i => [i, { groupKey: secret.groupKey, publicKeyPackage: "{}" }]));
        record.completed = mode === "complete";
      }
      localStorage.setItem("zf-guided-setup:" + g.id, JSON.stringify(record));
      document.getElementById("app").replaceChildren((await import("/app-setup.js")).guidedSetupView());
    }, mode));
  for (const name of ["empty", "request", "waiting", "multiple", "loading", "failed", "review", "review-failed", "review-unknown", "completed"])
    await matrix("approvals-" + name, () => approvals(name), { fresh: false });
  for (const name of ["empty", "populated", "filtered", "loading", "error", "solana", "busy", "receipt"])
    await matrix("activity-" + name, () => activityScene(name), { fresh: false });
  for (const name of ["submitted", "confirmed", "stale", "failed", "large", "unreadable", "sol-confirmed", "sol-failed", "sol-expired"])
    await matrix("receipt-" + name, () => receipt(name), { fresh: false });
  for (const name of ["team", "direct", "contact", "changed-key", "invite", "setup"])
    await matrix("messages-" + name, async () => {
      await installMessagingFixture(page, name, "after");
      if (name === "setup") {
        await page.getByRole("tab", { name: "On-chain messages", exact: true }).click();
        await page.evaluate(() => globalThis.__messagingFixture.loop.draw());
      }
    });
  await matrix("messages-cost-review", async () => {
    await installMessagingFixture(page, "contact", "after");
    await page.locator(".composer textarea").fill("Synthetic message for reviewing the network fee.");
    await page.getByRole("button", { name: "Send on chain", exact: true }).click();
    await page.evaluate(async () => {
      const view = await import("/app-account-view.js");
      if (!view.hasMessagingCostReview()) throw Error("Cost review did not open; no message should be submitted");
      document.getElementById("app").append(view.messagingCostReviewDialog());
    });
  });
  await matrix("messages-add-contact", async () => {
    await installMessagingFixture(page, "contact", "after");
    await page.evaluate(async () => {
      const view = await import("/app-account-view.js"); view.openContactDialog();
      document.getElementById("app").append(view.contactDialog());
    });
  });
  await matrix("messages-guide", async () => {
    await installMessagingFixture(page, "team", "after");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-key="messages-learn"]').click();
    await page.evaluate(async () => document.getElementById("app").append(
      (await import("/app-messaging-education.js")).messagingTutorialDialog()));
  });
  for (const mode of ["plain", "private", "devnet"]) for (const surface of ["receive", "settings", "security", "send-tools"])
    await matrix("solana-" + mode + "-" + surface, () => page.evaluate(async ({ mode, surface }) => {
      const { el, qrBox, receiveAddress } = await import("/app-dom.js");
      const { receiveFixture } = await import("/test/sol-receive-fixture.mjs");
      const module = await import(mode === "plain" ? "/sol/plain/view.js" : "/sol/view.js");
      const c = receiveFixture(el, mode); Object.assign(c.host, { qrBox, receiveAddress });
      if (surface === "send-tools") {
        c.host.solanaAction = () => "send";
        document.getElementById("app").replaceChildren(mode === "plain" ? module.plainView(c, fn => fn, {})
          : el("section", { class: "card card-pad" }, el("h2", {}, "Synthetic Solana payment tools"),
            ...(await import("/sol/payview.js")).payCards(c, fn => fn, {})));
      } else document.getElementById("app").replaceChildren(surface === "receive"
        ? (mode === "plain" ? module.plainView : module.solView)(c, fn => fn, {})
        : (mode === "plain" ? module.plainDetailsView : module.solDetailsView)(c, fn => fn, {}, surface));
    }, { mode, surface }));
  for (const kind of ["normal", "error", "unsupported"]) {
    await matrix("swap-" + kind, () => page.evaluate(async (kind) => {
      const { createSwapPreview } = await import("/app-swap-preview.js"), { MockSwapProvider } = await import("/swap-preview-model.js");
      globalThis.__swapAudit = createSwapPreview({ demo: true, name: "Example wallet", threshold: "2 of 3 devices" },
        new MockSwapProvider(kind === "error" ? { fail: true } : kind === "unsupported" ? { unsupported: true } : {}));
      document.getElementById("app").replaceChildren(globalThis.__swapAudit.element);
    }, kind));
    if (kind === "normal") {
      for (const picker of ["pay", "receive"]) {
        await matrix("swap-picker-" + picker, async () => {
          await page.getByRole("button", { name: "Choose asset to " + picker, exact: true }).click();
        }, { fresh: false });
        await page.keyboard.press("Escape");
      }
      await matrix("swap-details", () => page.locator('[data-key="swap-details"]').click(), { fresh: false });
      await page.keyboard.press("Escape");
      await matrix("swap-slippage", () => page.locator(".swap-settings > summary").click(), { fresh: false });
      await page.locator(".swap-settings > summary").click();
      await matrix("swap-review", async () => {
        await page.locator("#swap-amount").fill("1");
        await page.waitForFunction(() => !document.querySelector('[data-key="swap-review"]').disabled);
        await page.locator('[data-key="swap-review"]').click();
      }, { fresh: false });
      await matrix("swap-simulation", () => page.getByRole("button", { name: "Simulate swap flow", exact: true }).click(), { fresh: false });
      for (let step = 1; step <= SWAP_DEMO_STEPS.length; step++) await matrix("swap-simulation-step-" + step, async () => {
        await page.getByRole("button", { name: /^Next demo step/ }).click();
        if (step === SWAP_DEMO_STEPS.length) assert.equal(await page.evaluate(() => globalThis.__swapAudit.model.value.phase), "DEMO_COMPLETE");
      }, { fresh: false });
      await page.keyboard.press("Escape");
      await matrix("swap-quantum-introduction", async () => {
        await page.locator(".swap-experiments > summary").click();
        await page.getByRole("tab", { name: "Post-quantum swap", exact: true }).click();
      }, { fresh: false });
      await matrix("swap-quantum-configure", () => page.getByRole("button", {
        name: "Continue to post-quantum swap demo", exact: true }).click(), { fresh: false });
      await matrix("swap-quantum-details", () => page.getByRole("button", {
        name: "Swap details & privacy", exact: true }).click(), { fresh: false });
      await page.keyboard.press("Escape");
      const reviewQuantum = async () => {
        await page.waitForFunction(() => !document.querySelector(".pq-form .swap-primary").disabled);
        await page.getByRole("button", { name: "Review demo swap", exact: true }).click();
      };
      await matrix("swap-quantum-review", reviewQuantum, { fresh: false });
      await matrix("swap-quantum-expired", () => page.getByRole("button", {
        name: "Simulate quote expiry", exact: true }).click(), { fresh: false });
      const approvalsQuantum = async () => {
        await page.getByRole("button", { name: "Continue to demo approvals", exact: true }).click();
      };
      await matrix("swap-quantum-approvals", async () => {
        await page.getByRole("button", { name: "Refresh demo quote", exact: true }).click();
        await reviewQuantum(); await approvalsQuantum();
      }, { fresh: false });
      await matrix("swap-quantum-approved", async () => {
        await page.getByRole("button", { name: "Simulate this device approval", exact: true }).click();
        await page.getByRole("button", { name: "Simulate second device approval", exact: true }).click();
      }, { fresh: false });
      await matrix("swap-quantum-progress", () => page.getByRole("button", {
        name: "Continue to simulated execution", exact: true }).click(), { fresh: false });
      await matrix("swap-quantum-delivery", async () => {
        for (const name of ["Simulate deposit confirmation", "Simulate route execution", "Simulate delivery"])
          await page.getByRole("button", { name, exact: true }).click();
      }, { fresh: false });
      await matrix("swap-quantum-refund", async () => {
        await page.getByRole("button", { name: "Try another demo swap", exact: true }).click();
        await reviewQuantum(); await approvalsQuantum();
        for (const name of ["Simulate this device approval", "Simulate second device approval",
          "Continue to simulated execution", "Simulate deposit confirmation", "Simulate route execution", "Simulate refund instead"])
          await page.getByRole("button", { name, exact: true }).click();
      }, { fresh: false });
    }
  }
} finally {
  await browser.close();
  const issues = records.filter(record => record.issues.length);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ browser: browserName, scenes, cases: records.length, records, failures, errors,
    passed: !issues.length && !failures.length && !errors.length,
    scope: "Production presentation renderers with disposable synthetic states. No transaction signing, funding, external requests, or transaction submission." }, null, 2));
  console.log(JSON.stringify({ scenes: scenes.length, cases: records.length, issueCases: issues.length, failures: failures.length,
    runtimeErrors: errors.length, report: resolve(output, "report.json") }));
}
assert.equal(failures.length + errors.length + records.filter(record => record.issues.length).length, 0,
  "Every audited state must have glass coverage, working labels, valid theme scope, and a fitting layout");
