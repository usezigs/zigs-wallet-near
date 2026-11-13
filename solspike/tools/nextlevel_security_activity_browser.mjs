// Production wallet pages, synthetic setup/recovery/history facts. No exports or submissions.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const { chromium } = createRequire(new URL("../../web/package.json", import.meta.url))("playwright");
const out = resolve(process.env.ZIGS_SECURITY_ACTIVITY_OUTPUT || "/private/tmp/zigs-nextlevel-security-activity");
mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (pass, name) => { checks.push({ pass: !!pass, name }); assert.ok(pass, name); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage(); page.setDefaultTimeout(10000);
page.on("pageerror", (error) => errors.push(error.stack));
const shot = (name) => page.screenshot({ path: resolve(out, name + ".png"), fullPage: true });

async function security(kind = "mixed") {
  await page.evaluate(async (kind) => {
    const { el } = await import("/app-dom.js");
    const { state, ui } = await import("/app-state.js"); ui.tab = "recovery";
    const file = (extra = {}) => ({ has: true, saved: true, checked: false, checkable: true, ...extra });
    const facts = { n: 3, t: 2, formed: true, solScope: "ready", rosterKnown: true,
      signers: [
        { id: 1, label: "Phone", local: true, joined: true, address: "Address checked",
          zec: file({ checked: true }), sol: file() },
        { id: 2, label: "Laptop", local: false, joined: true, address: "Address checked",
          zec: file({ reported: true, checked: true }), sol: file({ reported: true, checked: true }) },
        { id: 3, label: "Reserve device", local: false, joined: true, address: "Address checked",
          zec: file({ saved: false }), sol: file({ saved: false }) },
      ] };
    if (kind === "unknown") { facts.rosterKnown = false; facts.solScope = "pending";
      facts.signers.forEach((s) => { s.rosterUnknown = true; }); }
    if (kind === "missing") facts.signers[0].sol = file({ has: false, missing: true });
    if (kind === "concentrated") facts.signers.forEach((s) => { s.local = true;
      s.zec = file({ checked: true }); s.sol = file({ checked: true }); });
    if (kind === "long") facts.signers[0].label = "Everyday phone and shared expenses device with a long recognizable label";
    globalThis.__securityCalls = [];
    const actions = { backup: (id, chain) => globalThis.__securityCalls.push(["backup", id, chain]),
      check: (id, chain) => globalThis.__securityCalls.push(["check", id, chain]),
      setup: () => globalThis.__securityCalls.push(["setup"]),
      guide: () => globalThis.__securityCalls.push(["guide"]),
      restore: () => globalThis.__securityCalls.push(["restore"]),
      settings: () => globalThis.__securityCalls.push(["settings"]), restoreInput: null };
    const { securityDashboard } = await import("/app-security-dashboard.js");
    const render = () => securityDashboard(facts, actions, {
      invite: el("p", {}, "Synthetic presentation: private invite omitted"),
      management: el("p", {}, "Existing wallet management actions"), solana: null,
      lost: "Keep working devices and restore a missing share from its recovery file.",
    });
    const host = el("div", { class: "page wallet-page", id: "security-display-fixture" },
      el("header", { class: "security-page-heading" }, el("h2", {}, "Security"),
        el("p", { class: "small muted" }, "Shared control and recovery for " + state.g.name)), render());
    globalThis.__messagingView = () => host;
    (await import("/app-loop.js")).draw();
  }, kind);
  await settleOverview(page);
}

async function matrix(name, selector) {
  for (const width of [1440, 390, 320]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 1000 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
    await settleOverview(page);
    check(await page.locator(selector).evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
      && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} fits ${width}px ${theme}`);
    await shot(`${name}-${width}-${theme}`);
  }
}

async function activity(kind = "populated") {
  await page.evaluate(async (kind) => {
    delete globalThis.__messagingView;
    const { state, ui } = await import("/app-state.js");
    const { setZ } = await import("/app-engine.js");
    const { setChain } = await import("/app-chain.js");
    (await import("/app-groups.js")).setDb({ collection: () => ({ onSnapshot: () => () => {} }) });
    const now = Date.now(), address = "utest1" + "syntheticaddress".repeat(12), txid = "ab12".repeat(16);
    state.g.name = "Studio wallet"; state.wallet.orchard_fvk = "non-spendable-display-fixture";
    setZ({ normalizeAddress: (value) => value, payeeAddress: (value) => value,
      blockSpanSeconds: (_network, from, to) => (to - from) * 75,
      inspect: () => JSON.stringify({ txid, sighash: "display-fixture", expiry_height: 5000100,
        fee: 10000, standard_fee: 10000, tx_version: "v5", lines: [
          { kind: "spend", value: 25010000 }, { kind: "output", who: address, value: 25000000, memo_status: "empty" }] }),
      expiryState: () => JSON.stringify({ expired: false, seconds_left: 1000, blocks_left: 100 }) });
    state.sessions = kind === "empty" || kind === "error" ? [] : [{ id: "display-payment",
      status: "collecting", pczt: "display-payment", by: 1, amount: 25000000, fee: 10000,
      createdAt: now - 5000, payees: [{ to: address, amount: 25000000, memo: "" }] }];
    const solRows = kind === "empty" || kind === "error" ? [] : [
      { id: "display-sol", t: now - 86400000, title: "Private payment", by: 1,
        amount: "0.001 SOL", sign: "out", word: "Signing", tone: "info" },
      { id: "display-failed", t: now - 3 * 86400000, title: "Add SOL", by: 1,
        amount: "0.003 SOL", sign: "", word: "Failed on chain", tone: "bad", added: "Tried" },
    ];
    await (await import("/app-sol.js")).overviewFixtureSol("synced", solRows);
    setChain({ gid: state.gid, birthday: 4528000, cw: kind === "error" ? null : {},
      bal: { spendable: 0, pending: 0, max_send: 0, height: 5000000, tip: 5000000 }, balAt: now,
      error: kind === "error" ? "Synthetic sync unavailable" : "", sent: new Set(),
      received: kind === "empty" || kind === "error" ? [] : [
        { height: 4999999, txid: "cd34".repeat(16), value: 123456789, confirmed: true, memos: [] },
        { height: 4998800, txid: "ef56".repeat(16), value: 12500000, confirmed: false, memos: [] },
      ] });
    ui.tab = "activity"; ui.chainFilter = "all"; state.sid = null;
    (await import("/app-loop.js")).draw();
  }, kind);
  await settleOverview(page);
}

async function setup(kind = "connect", seated = 1) {
  await page.evaluate(async ({ kind, seated }) => {
    const { state, ui } = await import("/app-state.js");
    const { setZ } = await import("/app-engine.js");
    const { gkeys, setSecrets } = await import("/app-keystore.js");
    const { signPins } = await import("/app-filter.js");
    const { FLOW_FIXTURES } = await import("/dev/metal-orbs/flow-fixtures.js");
    const no = "12345 67890 12345 67890 12345 67890";
    state.g.name = "Studio wallet"; state.g.version = 2; state.g.network = "testnet";
    signPins["version:" + state.gid] = "2"; signPins["confirmednet:" + state.gid] = "testnet";
    state.seats = Object.fromEntries([1, 2, 3].slice(0, kind === "connect" ? seated : 3).map((id) => [id,
      { uid: "display-device-" + id, name: ["Phone", "Laptop", "Reserve device"][id - 1],
        boxPk: "non-signing-display-key-" + id }]));
    state.confirm = kind === "prepare" || kind === "backup" ? Object.fromEntries([1, 2, 3].map((id) => [id, { number: no }])) : {};
    state.done = kind === "backup" ? Object.fromEntries([1, 2, 3].map((id) => [id,
      { publicKeyPackage: JSON.stringify({ display: "non-signing-public-package" }), groupKey: "non-signing-group" }])) : {};
    state.dkg1 = {}; state.dkg2 = {}; state.abort = {}; state.verify = kind === "backup" ? { 2: { ok: true }, 3: { ok: true } } : {};
    state.wallet = kind === "backup" ? { address: FLOW_FIXTURES.everyday.zcash.address,
      network: "testnet", birthday: 4528000 } : null;
    const held = { uid: "display-device-1", boxSk: "non-signing-display-key", boxPk: "non-signing-display-key-1",
      confirmed: kind === "prepare" || kind === "backup" ? no : null };
    if (kind === "backup") Object.assign(held, { keyPackage: "non-signing-display-key",
      publicKeyPackage: JSON.stringify({ display: "non-signing-public-package" }), groupKey: "non-signing-group", checkedWallet: JSON.stringify(state.wallet) });
    setSecrets({ [state.gid + ":1"]: held });
    (await import("/app-groups.js")).setMe("display-device-1");
    gkeys[state.gid] = btoa("x".repeat(32)).replace(/=+$/, "");
    setZ({ safetyNumber: () => no, normalizeAddress: (value) => value });
    (await import("/app-guided-setup.js")).beginGuided(state.gid);
    ui.tab = "overview"; state.sid = null;
    const { guidedSetupView } = await import("/app-setup.js");
    globalThis.__messagingView = () => guidedSetupView();
    (await import("/app-loop.js")).draw();
  }, { kind, seated });
  await settleOverview(page);
  if (kind === "backup" && await page.locator(".wallet-reveal").count()) {
    await page.getByRole("button", { name: "Continue to backup options", exact: true }).click();
    await page.locator(".setup-completion").waitFor();
  }
}

async function activityChecks() {
  await activity(); await matrix("activity", ".activity-workspace");
  await enlargedText("activity", ".activity-workspace");
  check(await page.locator(".activity-day").count() >= 3, "Activity groups existing records by local calendar date");
  check(await page.locator(".activity-ledger .row-item").count() === 5, "Date grouping preserves every Zcash and Solana record");
  check(await page.locator(".activity-date-note").textContent().then((text) => text.includes("estimated")), "Received Zcash dates retain their estimated qualification");
  const received = page.locator('.activity-ledger a[href$="' + "cd34".repeat(16) + '"]');
  check(await received.innerText().then((text) => text.includes("1.23456789") && text.includes("Confirmed")), "The ledger preserves exact values and the existing confirmation state");
  await page.getByRole("button", { name: "Solana", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-key="activity-filter-sol"]')?.getAttribute("aria-pressed") === "true"
    && document.querySelectorAll(".activity-ledger .row-item").length === 2);
  check(await page.locator(".activity-ledger .row-item").count() === 2, "Network filtering retains the existing Solana records");
  await page.getByRole("button", { name: "All activity", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".activity-ledger .row-item").length === 5);
  const payment = page.locator('[data-key="pay-display-payment"]'); await payment.focus(); await payment.press("Enter");
  await page.locator('[data-payment-view="record"]').waitFor();
  check(await page.getByRole("heading", { name: "Payment record", exact: true }).isVisible(), "A ledger payment opens its existing Record drawer");
  await page.keyboard.press("Escape");
  await page.locator('[data-payment-view="record"]').waitFor({ state: "detached" });
  check(await payment.evaluate((node) => node === document.activeElement), "Closing the record returns keyboard focus to the ledger row");
  await activity("error");
  check(await page.locator(".activity-workspace").innerText().then((text) => text.includes("sync failed") && !text.includes("Your activity starts here")), "Failed history never becomes a successful empty state");
  await activity("empty");
  check(await page.locator(".activity-empty").innerText().then((text) => text.includes("Your activity starts here")), "A finished empty read retains its empty state");
  const dateChecks = await page.evaluate(async () => {
    const { groupLedgerDates } = await import("/activity-dates.js");
    const now = new Date(2026, 10, 13, 12).getTime();
    const rows = [{ t: now, id: "today" }, { t: new Date(2026, 10, 12, 23).getTime(), id: "yesterday" },
      { t: 0, id: "unknown" }, { t: now, m: {}, id: "pending" }];
    const grouped = groupLedgerDates(rows, now);
    return grouped.map((group) => [group.label, group.rows[0].id]);
  });
  check(JSON.stringify(dateChecks) === JSON.stringify([["Today", "today"], ["Yesterday", "yesterday"],
    ["Date unavailable", "unknown"], ["Awaiting a block", "pending"]]), "Date labels preserve unknown timestamps and separate mempool observations");
}

async function setupChecks() {
  await setup("connect"); await matrix("setup-connect", ".guided-setup");
  check(await page.locator(".setup-device-mark").count() === 3, "Connect retains one distinct medallion per configured device");
  check(await page.locator(".setup-waiting-label").innerText().then((text) => text.includes("Device 2") && text.includes("Device 3")), "Setup identifies the devices it is waiting for");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(async () => (await import("/app-loop.js")).draw());
  await setup("connect", 2);
  check(await page.locator('[data-device-seat="2"] .setup-device-mark').getAttribute("data-motion-library") === "motion", "A newly joined device gets a short actual Motion acknowledgement");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup("verify"); await matrix("setup-verify", ".guided-setup");
  check(await page.locator(".safety-group").allTextContents().then((values) => values.join("").replace(/\s/g, "") === "123456789012345678901234567890"), "Verification preserves all 30 actual comparison digits");
  check(await page.locator(".safety").evaluate((node) => node.getAnimations({ subtree: true }).length === 0), "The safety number stays stationary");
  await enlargedText("setup-verify", ".guided-setup");
  await setup("prepare"); await matrix("setup-prepare", ".guided-setup");
  check(await page.locator(".setup-live-layout .setup-wallet-status").count() === 1, "Preparation reuses the same device-status layout");
  check(await page.getByRole("heading", { name: "Prepare your wallet", exact: true }).isVisible(), "Existing preparation stages remain present");
  await setup("backup"); await matrix("setup-backup", ".guided-setup");
  check(await page.getByRole("button", { name: "Open Overview", exact: true }).isEnabled(), "Prepared wallets can enter Overview without requiring optional backups");
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js"); state.done[2].groupKey = "different-display-group";
    (await import("/app-loop.js")).draw();
  });
  check(await page.getByRole("button", { name: "Open Overview", exact: true }).isDisabled()
    && await page.locator('[data-key="stop-setup"]').innerText().then((text) => text.includes("different wallet keys")),
  "A key mismatch still stops setup and prevents continuation");
  await shot("setup-mismatch-320-light");
}

async function enlargedText(name, selector) {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    globalThis.__walletPageText = [root, ...root.querySelectorAll("*")]
      .filter((node) => node.namespaceURI === "http://www.w3.org/1999/xhtml")
      .map((node) => { const style = getComputedStyle(node);
        return [node, node.style.fontSize, node.style.lineHeight, parseFloat(style.fontSize), parseFloat(style.lineHeight)]; });
    for (const [node, , , size, height] of globalThis.__walletPageText) {
      node.style.fontSize = size * 2 + "px";
      if (Number.isFinite(height)) node.style.lineHeight = height * 2 + "px";
    }
    scrollTo(0, 0);
  }, selector);
  await settleOverview(page);
  const sizing = await page.locator(selector).evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth,
    clipped: [...node.querySelectorAll(".money")].filter((amount) => amount.scrollWidth > amount.clientWidth + 1)
      .map((amount) => ({ width: amount.clientWidth, scroll: amount.scrollWidth, text: amount.textContent,
        whiteSpace: getComputedStyle(amount).whiteSpace })),
  }));
  check(sizing.scroll <= sizing.width + 1 && sizing.clipped.length === 0,
    `${name}: actual 200% text fits at 320px and preserves full amounts: ${JSON.stringify(sizing)}`);
  await shot(`${name}-double-text-320-light`);
  await page.evaluate(() => {
    for (const [node, font, line] of globalThis.__walletPageText) { node.style.fontSize = font; node.style.lineHeight = line; }
    delete globalThis.__walletPageText;
  });
}

try {
  await overviewFixture(context, page, { messaging: true });
  await security();
  if (process.env.ZIGS_SECURITY_ACTIVITY_BASELINE === "1") {
    await shot("security-before-1440");
    await page.setViewportSize({ width: 390, height: 844 }); await settleOverview(page);
    await shot("security-before-390");
    console.log("Security baseline saved: " + out);
  } else {
    await matrix("security", ".security-dashboard");
    await enlargedText("security", ".security-dashboard");
    check(await page.locator(".security-file-preview").count() === 6, "Each device exposes its existing per-chain recovery status");
    check(await page.locator(".security-signer").nth(1).innerText().then((text) => text.includes("Reported checked")), "Remote reports keep their reported qualification");
    await page.locator(".security-primary").click();
    check(await page.evaluate(() => JSON.stringify(globalThis.__securityCalls) === JSON.stringify([["check", 1, "sol"]])), "Primary action delegates to the original device and chain handler");
    const summary = page.locator("#security-signer-1 > summary"); await summary.focus(); await summary.press("Enter");
    check(await page.locator("#security-signer-1").getAttribute("open") !== null, "Keyboard opens the original device disclosure");
    await page.getByRole("button", { name: "Back up Zcash share for device 1", exact: true }).click();
    check(await page.evaluate(() => JSON.stringify(globalThis.__securityCalls.at(-1)) === JSON.stringify(["backup", 1, "zec"])), "Device backup retains its original handler");
    await security("unknown");
    check(await page.locator(".security-overview").innerText().then((text) => text.includes("Status unavailable") && !text.includes("of 6 checked")), "Unread configuration never invents a recovery denominator");
    check(await page.locator(".security-file-preview").allTextContents().then((values) => values.every((text) => !text.includes("Checked in this browser"))), "Unread device records do not show stale successful checks in the preview");
    await security("missing");
    check(await page.locator(".security-primary").innerText().then((text) => text.includes("Restore a device")), "Missing material retains the restore action");
    await security("concentrated");
    check(await page.locator(".security-overview").innerText().then((text) => text.includes("All 3 signing shares") && text.includes("Attention recommended")), "Completed file checks do not suppress browser concentration risk");
    await security("long"); await page.setViewportSize({ width: 320, height: 844 }); await settleOverview(page);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Long device names fit at 320px");
    await activityChecks();
    await setupChecks();
    check(errors.length === 0, "No browser runtime errors");
    writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors }, null, 2));
    console.log(`${checks.length} wallet-page checks passed. Screenshots: ${out}`);
  }
} catch (error) {
  await shot("failure"); writeFileSync(resolve(out, "validation.json"), JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
