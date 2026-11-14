// Real encrypted files in disposable stores. No secret/backup contents enter the report.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { browserOutput, launchTestBrowser } from "../../solspike/harness/browser-test.mjs";
import { bindCeremony, ceremonyButton as button, ceremonyPage, createCeremonyWallet,
  protectCeremonyPage, readyCeremonyOverview, safeCeremonyCapture } from "../../solspike/harness/ceremony-browser.mjs";

const output = browserOutput("recovery"), checks = [], errors = [], contexts = [];
const browser = await launchTestBrowser();
const passphrase = "Disposable-audit-backup-only-2026";
const check = (pass, label) => { checks.push({ pass: !!pass, label }); assert.ok(pass, label); };
async function fresh(unsupported = false) {
  const value = await ceremonyPage(browser, errors, unsupported);
  contexts.push(value.context); return value.page;
}
async function noWallet(page, label) {
  check(await page.evaluate(() => !globalThis.__ceremony.app.state.groups.length
    && !Object.keys(globalThis.__ceremony.keys.secrets).length), label);
}

async function protectionErrors() {
  let page = await fresh(true); await button(page, "Create wallet").click();
  check(await button(page, "Protect this browser").isDisabled(), "unsupported API is unavailable");
  await noWallet(page, "unsupported protection creates no wallet or share");
  await page.context().close();
  page = await fresh();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2",
    ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: false,
    hasPrf: true } });
  await button(page, "Create wallet").click();
  await page.evaluate(() => {
    const original = navigator.credentials.create.bind(navigator.credentials);
    navigator.credentials.create = (options) => {
      globalThis.__cancelCredential = new AbortController();
      return original({ ...options, signal: globalThis.__cancelCredential.signal });
    };
  });
  await button(page, "Protect this browser").click();
  await page.waitForFunction(() => !!globalThis.__cancelCredential);
  await page.evaluate(() => globalThis.__cancelCredential.abort(
    new DOMException("Audit cancellation", "NotAllowedError")));
  await page.getByText(/Passkey setup was cancelled or timed out/).first().waitFor();
  await noWallet(page, "cancelled real credential request creates no wallet or share");
  await safeCeremonyCapture(page, resolve(output, "passkey-cancelled.png"));
  await page.context().close();
}

async function signerDetails(page) {
  const details = page.locator(".security-signer details").first();
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
  return details;
}

async function exportAndCheck(page) {
  await page.locator("#tab-recovery").click(); await signerDetails(page);
  await page.evaluate(() => {
    const { keys, app: { state } } = globalThis.__ceremony;
    globalThis.__originalKey = JSON.stringify(keys.sec(state.gid, 1).keyPackage);
  });
  await button(page, "Back up Zcash share for device 1").click();
  await page.locator("#bk-pass").fill(passphrase); await page.locator("#bk-again").fill("mismatch");
  check(await button(page, "Encrypt and save file").isDisabled(), "mismatched passphrase blocks save");
  await page.locator("#bk-again").fill(passphrase);
  const downloading = page.waitForEvent("download");
  await button(page, "Encrypt and save file").click(); const download = await downloading;
  const path = await download.path(); check(!!path, "real engine produces an encrypted download");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  // Panel persistence was explicitly excluded by the user. Reopen for the functional file check.
  const details = await signerDetails(page);
  check((await details.innerText()).includes("Saved · not checked"), "download is not a checked file");
  await button(page, "Check file for the Zcash share of device 1").click();
  await page.locator("#bc-file").setInputFiles(path); await page.locator("#bc-pass").fill("wrong passphrase");
  await button(page, "Check saved file").click(); await page.getByRole("alert").waitFor();
  check(await button(page, "Choose another file").isEnabled(), "wrong passphrase can be retried");
  check((await page.locator("#bc-file-name").textContent()) !== "No file selected",
    "failed check retains the selected filename");
  await page.locator("#bc-pass").fill(passphrase); await button(page, "Check saved file").click();
  await page.getByRole("dialog").waitFor({ state: "detached" }); await signerDetails(page);
  check((await details.innerText()).includes("Checked in this browser"), "encrypted file check succeeds");
  check(await page.evaluate(() => {
    const { keys, app: { state } } = globalThis.__ceremony;
    return globalThis.__originalKey === JSON.stringify(keys.sec(state.gid, 1).keyPackage);
  }), "file check leaves signing material unchanged");
  await safeCeremonyCapture(page, resolve(output, "checked.png"));
  return path;
}

async function coldRestore(path) {
  const page = await fresh(); await protectCeremonyPage(page); await page.keyboard.press("Escape");
  await page.locator("#restore").setInputFiles({ name: "invalid-qa.zigsbackup",
    mimeType: "application/json", buffer: Buffer.from("Invalid disposable QA file") });
  await page.getByText(/This file is not a Zigs backup/).first().waitFor();
  await noWallet(page, "malformed backup imports no wallet or share");
  await page.locator("#restore").setInputFiles(path); await page.locator("#rs-pass").fill("wrong");
  await button(page, "Restore backup").click();
  await page.waitForFunction(() => globalThis.__ceremony.app.ui.restore?.busy === false);
  await noWallet(page, "wrong restore passphrase imports no share");
  await page.locator("#rs-pass").fill(passphrase); await button(page, "Restore backup").click();
  await page.waitForFunction(() => globalThis.__ceremony.seats.localSeats().length === 1
    && globalThis.__ceremony.dkg.seatCheck(1) === true, null, { timeout: 45000 });
  check(await page.evaluate(() => globalThis.__ceremony.app.state.g.t === 2
    && globalThis.__ceremony.app.state.g.n === 2), "restore keeps one device under the original 2-of-2 rule");
  check(await page.locator('[data-restore-progress="checking"]').count() === 0,
    "pending note clears after matching relay data is verified");
  await page.reload(); await bindCeremony(page); await button(page, "Unlock").click();
  await page.waitForFunction(() => globalThis.__ceremony.dkg.seatCheck(1) === true);
  check(true, "cold-restored share survives protected reload and virtual passkey unlock");
  await safeCeremonyCapture(page, resolve(output, "restored.png"));
}

try {
  await protectionErrors();
  const page = await fresh(); await createCeremonyWallet(page, 2);
  await page.locator("details.testing summary").click(); await button(page, "Play device 2").click();
  await readyCeremonyOverview(page);
  await coldRestore(await exportAndCheck(page));
  check(errors.length === 0, "no browser runtime errors");
  console.log(`${checks.length} real encrypted-recovery checks passed`);
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ checks, errors,
    scope: "Real encrypted Testnet file and fresh stores; local relay only; no funds or submissions.",
    excluded: "Security card persistence (R5) was excluded by the user." }, null, 2));
  for (const context of contexts) await context.close(); await browser.close();
}
