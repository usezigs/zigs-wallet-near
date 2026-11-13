// Product QA with unfunded synthetic state. No external services, keys or transactions.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node solspike/tools/release_browser.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { overviewFixture, settleOverview } from '../harness/overview-redesign-fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.ZIGS_RELEASE_QA_DIR || 'solspike/.state/release-qa');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome',
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
const errors = [];
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await overviewFixture(context, page);
  await page.evaluate(async () => {
    const { state } = await import('/app-state.js');
    state.g.name = 'Household wallet';
    const { setChain } = await import('/app-chain.js');
    setChain({ gid: state.gid, cw: {}, bal: { spendable: 12500000, pending: 0,
      height: 4528665, tip: 4528665 }, sent: new Set(), received: [] });
    (await import('/app-loop.js')).draw();
  });
  await settleOverview(page);
  assert.match(await page.locator('.overview-hero').innerText(), /0.125 ZEC/);
  assert.doesNotMatch(await page.locator('#app').innerText(), /Demo|not audited|unaudited|0\.5 SOL/i);
  assert.equal(await page.locator('#asset-usdc').count(), 0);
  assert.equal(await page.locator('.privacy-popup:visible').count(), 0);
  for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await settleOverview(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    if (process.env.ZIGS_RELEASE_QA_CAPTURE !== "0")
      await page.screenshot({ path: resolve(output, `overview-${width}-${theme}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async () => {
    const { ui } = await import('/app-state.js');
    ui.tab = 'recovery';
    (await import('/app-loop.js')).draw();
  });
  const disclosure = page.locator('#security-disclosures');
  assert.equal(await disclosure.count(), 1);
  assert.equal(await disclosure.evaluate(node => node.open), false);
  assert.doesNotMatch(await page.locator('#app').innerText(), /independent security audit/i);
  await disclosure.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.match(await disclosure.innerText(), /not undergone an independent security audit/i);
  await page.evaluate(async () => {
    const { helpView } = await import('/app-help.js');
    document.getElementById('app').replaceChildren(helpView());
  });
  await page.getByText('Guides & frequently asked questions', { exact: true }).click();
  const faq = page.locator('.preferences-faq > details').filter({ hasText: 'Has Zigs been audited?' });
  assert.equal(await faq.count(), 1);
  assert.equal(await faq.evaluate(node => node.open), false);
  await faq.locator('summary').click();
  assert.match(await faq.innerText(), /not undergone an independent security audit/i);
  assert.deepEqual(errors, []);
  console.log('release browser: desktop/mobile, real test balance, no prototype rows/popups, collapsed accessible disclosures: passed');
  console.log(output);
} finally {
  await browser.close();
}
