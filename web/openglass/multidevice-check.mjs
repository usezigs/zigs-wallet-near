// Three independent fresh stores; real unfunded 2-of-3 ceremony; no signing or broadcasts.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { browserOutput, launchTestBrowser } from "../../solspike/harness/browser-test.mjs";
import { bindCeremony, ceremonyButton as button, ceremonyPage, createCeremonyWallet,
  fixedBirthday, readyCeremonyOverview, safeCeremonyCapture } from "../../solspike/harness/ceremony-browser.mjs";

const output = browserOutput("multidevice"), devices = [], checks = [], errors = [];
const browser = await launchTestBrowser();
const check = (pass, label) => { checks.push({ pass: !!pass, label }); assert.ok(pass, label); };

async function join(invite, seat) {
  const device = await ceremonyPage(browser, errors); devices.push(device);
  const { page } = device, url = new URL(invite);
  url.searchParams.set("qaDevice", String(seat));
  await page.goto(url.href); await bindCeremony(page);
  await page.waitForFunction(() => globalThis.__ceremony.engine.Z && globalThis.__ceremony.app.state.g);
  await fixedBirthday(page);
  const action = button(page, "Join as device " + seat); await action.waitFor();
  check(await action.isDisabled(), `device ${seat}: joining requires a protection choice`);
  await button(page, "Skip for now").click(); await button(page, "Back to protection").click();
  check(await action.isDisabled(), `device ${seat}: cancellation grants no joining consent`);
  await page.waitForTimeout(430); await button(page, "Skip for now").click();
  await button(page, "Continue without protection").click();
  await page.locator("#seat-name").fill("QA device " + seat); await action.click();
  await page.waitForFunction((seat) => globalThis.__ceremony.seats.localSeats().includes(seat), seat);
}

async function verifyDevices() {
  for (const { page } of devices) await page.getByRole("heading", {
    name: "Check that your devices match", exact: true,
  }).waitFor({ timeout: 90000 });
  const codes = await Promise.all(devices.map(({ page }) => page.locator(".safety").innerText()));
  check(new Set(codes).size === 1 && codes[0].replace(/\D/g, "").length === 30,
    "all stores show the same full safety number; its value is not logged");
  for (const { page } of devices) {
    check(await button(page, "Codes match").isDisabled(), "full-number acknowledgement is required");
    await page.getByRole("checkbox", {
      name: "I compared all 30 digits on every device.", exact: true,
    }).check();
  }
  for (const { page } of devices) await button(page, "Codes match").click();
  for (const { page } of devices) await page.waitForFunction(() => {
    const { app: { state }, seats, dkg } = globalThis.__ceremony;
    return state.wallet && dkg.seatCheck(seats.localSeats()[0]) === true;
  }, null, { timeout: 90000 });
  const facts = await Promise.all(devices.map(({ page }) => page.evaluate(() => ({
    address: globalThis.__ceremony.app.state.wallet.address,
    seats: globalThis.__ceremony.seats.localSeats(), rule: globalThis.__ceremony.app.state.g.t,
  }))));
  check(new Set(facts.map((f) => f.address)).size === 1, "all devices verify one shared address");
  check(facts.every((f, i) => f.seats.length === 1 && f.seats[0] === i + 1 && f.rule === 2),
    "each independent store holds one distinct share under the original threshold");
}

try {
  const first = await ceremonyPage(browser, errors); devices.push(first);
  await createCeremonyWallet(first.page, 3, true);
  const invite = await first.page.evaluate(async () => (await import("/app-links.js"))
    .inviteLink(globalThis.__ceremony.app.state.gid));
  await join(invite, 2); await join(invite, 3); await verifyDevices();
  for (let i = 0; i < devices.length; i++) {
    await readyCeremonyOverview(devices[i].page);
    await safeCeremonyCapture(devices[i].page, resolve(output, `device-${i + 1}.png`));
  }
  await first.page.reload(); await bindCeremony(first.page); await button(first.page, "Unlock").click();
  await first.page.waitForFunction(() => globalThis.__ceremony.keys.passkeyProtected()
    && globalThis.__ceremony.dkg.seatCheck(1) === true);
  check(errors.length === 0, "no runtime errors; protected independent signer reloads and unlocks");
  console.log(`${checks.length} independent-store ceremony checks passed`);
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ checks, errors,
    scope: "Real unfunded Testnet ceremony; local relay only; no financial submissions." }, null, 2));
  for (const d of devices) await d.context.close(); await browser.close();
}
