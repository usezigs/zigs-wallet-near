// Real presentation and native controls; synthetic public state, no signing or external requests.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserOutput, launchTestBrowser } from '../../solspike/harness/browser-test.mjs';
import { overviewFixture, settleOverview } from '../../solspike/harness/overview-redesign-fixture.mjs';
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const output = browserOutput('finalui'), checks = [], errors = [];
const browser = await launchTestBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await context.addInitScript(() => {
  globalThis.__setupCspViolations = [];
  document.addEventListener('securitypolicyviolation', event => {
    globalThis.__setupCspViolations.push(event.violatedDirective);
  });
});
const page = await context.newPage(); page.setDefaultTimeout(12000);
page.on('pageerror', error => errors.push(error.message));
const check = (pass, name) => { assert.ok(pass, name); checks.push(name); };
const capture = name => page.screenshot({ path: resolve(output, name + '.png'), fullPage: true, animations: 'disabled' });
async function settle() { await settleOverview(page); await page.waitForTimeout(80); }
async function fits(label, selector, vertical = true) {
  const result = await page.locator(selector).evaluate(node => {
    const r = node.getBoundingClientRect();
    return { horizontal: node.scrollWidth <= node.clientWidth + 1 && r.left >= -1 && r.right <= innerWidth + 1,
      vertical: r.bottom <= innerHeight + 1, bottom: r.bottom, viewport: innerHeight };
  });
  check(result.horizontal, label + ': no horizontal overflow');
  if (vertical && !result.vertical) {
    await capture('layout-failure');
    console.log(await page.locator(selector).evaluate(n => [...n.querySelectorAll('.setup-device-row,.setup-live-layout,.setup-wallet-status,.setup-connect,.testing')]
      .map(x => ({ cls: x.className, height: x.getBoundingClientRect().height, rows: getComputedStyle(x).gridTemplateRows }))));
  }
  if (vertical) check(result.vertical, label + ': fits viewport ' + JSON.stringify(result));
}
async function plan() {
  await page.evaluate(async () => {
    (await import('/app-engine.js')).setZ({ normalizeAddress: a => a });
    (await import('/app-groups.js')).setDb({});
    (await import('/app-keystore.js')).setSecrets({});
  });
  await page.getByRole('button', { name: 'New wallet', exact: true }).click(); await settle();
  await fits('protection', '.guide-step:not([hidden])'); await capture('protection-desktop');
  await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await page.getByRole('button', { name: 'Continue without protection', exact: true }).click();
  await page.locator('#g-n').waitFor();
  for (const n of [2, 3, 4, 5, 6, 7]) {
    await page.locator('#g-n').fill(String(n)); await settle();
    const row = await page.locator('.guide-step:not([hidden]) .security-nodes').evaluate(node => {
      const rects = [...node.children].map(n => n.getBoundingClientRect());
      return { count: rects.length, oneRow: rects.every(r => Math.abs(r.top - rects[0].top) < 1),
        fits: rects.every(r => r.right <= node.getBoundingClientRect().right + 1),
        size: node.querySelector('.security-node-mark').getBoundingClientRect().width };
    });
    check(row.count === n && row.oneRow && row.fits, n + ' proposed devices stay in a single row');
    if (n === 3) globalThis.threeSize = row.size;
    if (n === 7) check(row.size < globalThis.threeSize, 'icons shrink as devices are added');
  }
  await capture('threshold-seven-desktop');
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    for (const n of [2, 3, 4, 5, 6, 7]) for (const t of [...new Set([2, n])]) {
      await page.locator('#g-n').fill(String(n));
      await page.locator('#g-t').fill(String(t)); await settle();
      const row = await page.locator('.guide-step:not([hidden]) .security-nodes').evaluate(node => {
        const rects = [...node.children].map(n => n.getBoundingClientRect());
        return rects.length > 0 && rects.every(r => Math.abs(r.top - rects[0].top) < 1)
          && node.scrollWidth <= node.clientWidth + 1;
      });
      check(row, width + ': ' + t + ' of ' + n + ' devices stay side by side under the content policy');
      await fits(width + ': ' + t + ' of ' + n + ' complete threshold page', '.guide-step:not([hidden])');
      if (n === 2 || n === 7 && t === 2) await capture('threshold-' + t + '-of-' + n + '-' + width);
    }
  }
  for (const step of [0, 1, 2, 3]) {
    await page.evaluate(async step => {
      const { ui } = await import('/app-state.js');
      ui.createStep = step; ui.createDraft = { n: 7, t: 2, name: 'Everyday wallet', label: 'My laptop' };
      (await import('/app-loop.js')).draw();
    }, step);
    for (const width of [1440, 390, 320]) for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: width < 900 ? 844 : 900 });
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme); await settle();
      await fits('plan ' + step + ' ' + width + ' ' + theme, '.guide-step:not([hidden])', width >= 900);
      if (width === 390 && theme === 'light') await capture('plan-' + step + '-mobile');
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const network of ['testnet', 'mainnet']) {
    await page.evaluate(async network => {
      const { ui } = await import('/app-state.js');
      ui.net = network; ui.createStep = 3;
      ui.createDraft = { n: 3, t: 2, name: 'Everyday wallet', sol: false, solPrivate: false };
      (await import('/app-loop.js')).draw();
    }, network);
    await settle();
    check(await page.locator('#g-sol,#g-private').count() === 0,
      network + ': automatic private Solana has no opt-in control');
    check((await page.locator('.setup-review-summary').innerText()).includes(
      '+ private Solana on ' + (network === 'mainnet' ? 'mainnet' : 'devnet')),
    network + ': review includes private Solana despite a stale draft opt-out');
    check(await page.locator('.setup-review-information').evaluate(node => !node.open),
      network + ': supporting setup details are collapsed initially');
    await capture('review-' + network);
  }
  await page.keyboard.press('Escape');
}
async function guided(n, complete = false) {
  await page.evaluate(async ({ n, complete }) => {
    const { state, ui } = await import('/app-state.js');
    const { setSecrets, setGkeys } = await import('/app-keystore.js');
    const { setZ } = await import('/app-engine.js');
    const { setMe, setDb } = await import('/app-groups.js');
    const no = '12345 67890 12345 67890 12345 67890';
    const g = { id: 'ab'.repeat(10), name: 'Everyday wallet', n, t: 2, version: 1, network: 'mainnet' };
    const wallet = { address: 'u1' + 'q'.repeat(180), network: 'mainnet', birthday: 4500000 };
    const seats = Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, {
      uid: 'synthetic-device-' + (i + 1), name: i ? 'Device ' + (i + 1) : 'My laptop', boxPk: String(i + 1).repeat(64),
    }]));
    setZ({ safetyNumber: () => no, normalizeAddress: a => a }); setMe(seats[1].uid); setDb({});
    Object.assign(state, { g, gid: g.id, groups: [g], wallet: complete ? wallet : null,
      seats: complete ? seats : { 1: seats[1] }, seatsLoaded: true, seatsSettled: true, pending: false,
      dkg1: {}, dkg2: {}, abort: {}, done: complete ? Object.fromEntries(Object.keys(seats).map(i => [i, {
        groupKey: 'synthetic-group', publicKeyPackage: '{}',
      }])) : {}, verify: complete ? Object.fromEntries(Object.keys(seats).map(i => [i, { ok: true }])) : {},
      confirm: complete ? Object.fromEntries(Object.keys(seats).map(i => [i, { number: no }])) : {} });
    const held = complete ? Object.keys(seats) : ['1'];
    setSecrets(Object.fromEntries(held.map(i => [g.id + ':' + i, { ...seats[i], confirmed: no,
      keyPackage: 'synthetic-not-used', groupKey: 'synthetic-group', publicKeyPackage: {},
      checkedWallet: complete ? JSON.stringify(wallet) : null }])));
    setGkeys({ [g.id]: 'synthetic' });
    const record = (await import('/guided-setup-model.js')).emptyGuidedRecord();
    localStorage.setItem('zf-guided-setup:' + g.id, JSON.stringify(record));
    ui.create = false; ui.tab = 'overview'; ui.localDevicesReview = null;
    const { guidedSetupView } = await import('/app-setup.js');
    const host = guidedSetupView();
    // The reveal is tested separately; inspect the recovery document here.
    if (complete) {
      const reveal = host.querySelector('[data-key="wallet-reveal-continue"]');
      if (reveal) reveal.click();
    }
    globalThis.__messagingView = () => guidedSetupView();
    (await import('/app-loop.js')).draw();
  }, { n, complete });
  await settle();
  const reveal = page.getByRole('button', { name: 'Continue to backup options', exact: true });
  if (await reveal.count()) { await reveal.click(); await settle(); }
}
async function liveLayouts() {
  for (const complete of [false, true]) for (const n of [3, 7]) {
    await page.setViewportSize({ width: 1440, height: 900 }); await guided(n, complete);
    if (!complete) {
      if (!await page.locator('.testing').evaluate(n => n.open)) await page.locator('.testing>summary').click();
      await settle();
      check(await page.locator('.testing .device-protection').count() === 0,
        'solo setup does not repeat the completed protection choice');
    }
    for (const [width, height] of [[1440, 900], [1366, 768]]) for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height });
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme); await settle();
      await fits((complete ? 'backup' : 'expanded connection') + ' ' + n + ' ' + width, '.guided-setup');
    }
    await capture((complete ? 'backup-' : 'connect-') + n + '-desktop');
  }
}
try {
  await overviewFixture(context, page, { messaging: true });
  await plan(); await liveLayouts();
  check(await page.evaluate(() => globalThis.__setupCspViolations.length === 0),
    'setup has no blocked inline styles under the deployed content policy');
  check(errors.length === 0, 'no browser runtime errors: ' + errors.join(', '));
  console.log('Setup layout: ' + checks.length + ' checks passed. Evidence: ' + output);
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
