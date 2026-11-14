// Real renderers with synthetic state; no signing, deposits, or live wallet submissions.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserName, browserOutput, launchTestBrowser } from '../../solspike/harness/browser-test.mjs';
import { overviewFixture, settleOverview } from '../../solspike/harness/overview-redesign-fixture.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const output = browserOutput('swap-flow-' + browserName);
const browser = await launchTestBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const fitDialog = async label => assert.ok(await page.locator('dialog[open]')
  .evaluate(n => n.scrollHeight <= n.clientHeight + 1), label + ' fits without scrolling');

async function network(value) {
  await page.evaluate(async value => {
    const { state, ui } = await import('/app-state.js');
    const { signPins } = await import('/app-filter.js');
    const g = { ...state.g, network: value };
    Object.assign(state, { g, groups: [g] });
    signPins['confirmednet:' + g.id] = value;
    ui.tab = 'overview';
    (await import('/app-loop.js')).draw();
  }, value);
  await settleOverview(page);
}

try {
  await overviewFixture(context, page, { messaging: true });
  await context.route('**/portfolio/prices', route => route.fulfill({ json: {
    source: 'kraken', prices: { zec: { usd: 50, at: Date.now() },
      sol: { usd: 100, at: Date.now() }, usdc: { usd: 1, at: Date.now() } },
  } }));
  for (const net of ['testnet', 'mainnet']) {
    await network(net);
    if (net === 'mainnet') await page.locator('.portfolio-chart').waitFor();
    for (const width of [1440, 390, 320]) for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      await settleOverview(page);
      for (const action of ['Send', 'Receive']) {
        const picker = page.locator('.overview-action-picker').filter({
          has: page.locator('summary').filter({ hasText: action }),
        });
        await picker.locator('summary').click();
        const panel = picker.locator('.asset-choices');
        await page.waitForFunction(() => !!document.querySelector('.asset-choices:popover-open'));
        const r = await panel.boundingBox();
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= width + 1 && r.y + r.height <= 900,
          `${net} ${action}: choices stay inside the viewport`);
        assert.ok(await panel.locator('.asset-choice').first().isVisible());
        assert.ok(await panel.evaluate(n => {
          const b = n.querySelector('button'), r = b.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === b;
        }), 'asset option is reachable above the chart');
        await page.screenshot({ path: resolve(output, `asset-picker-${net}-${action}-${width}-${theme}.png`) });
        await page.keyboard.press('Escape');
        assert.equal(await picker.getAttribute('open'), null);
      }
    }
  }

  // An open top-layer menu stays reachable when the viewport changes.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.overview-action-picker > summary').filter({ hasText: 'Receive' }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(150);
  const resized = await page.locator('.asset-choices:popover-open').boundingBox();
  assert.ok(resized.x >= 0 && resized.x + resized.width <= 321 && resized.y + resized.height <= 845,
    'an already-open menu follows viewport resizing');
  await page.keyboard.press('Escape');

  // Choosing an asset reaches the existing Receive flow, rather than just opening a menu.
  await page.evaluate(async () => {
    (await import('/app-engine.js')).setZ({ normalizeAddress: a => a, payeeAddress: a => a });
  });
  await page.locator('.overview-action-picker > summary').filter({ hasText: 'Receive' }).click();
  await page.locator('.asset-choices:popover-open .asset-choice').first().click();
  await page.getByRole('heading', { name: 'Receive ZEC', exact: true }).waitFor();
  await page.keyboard.press('Escape');

  await page.evaluate(async () => {
    const { createSwapPreview } = await import('/app-swap-preview.js');
    const { MockSwapProvider } = await import('/swap-preview-model.js');
    const { ui } = await import('/app-state.js');
    ui.tab = 'swap';
    const view = createSwapPreview({ id: 'synthetic', name: 'Everyday wallet', network: 'mainnet',
      live: true, preferredFrom: 'sol', solGroup: { mode: 'private', reason: 'Synthetic wallet only' } },
    new MockSwapProvider());
    globalThis.__testSwap = view;
    globalThis.__messagingView = () => view.element;
    (await import('/app-loop.js')).draw();
  });
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720], [390, 844], [320, 844]]) {
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height });
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      await settleOverview(page);
      if (width > 1100) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
        'desktop Swap fits with the full wallet header');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.locator('#swap-amount').fill('1');
      await button('Initiate confidential swap').click();
      assert.ok(await button('Simulate swap flow').evaluate(n => n.getBoundingClientRect().width >= Math.min(200, innerWidth - 64)),
        'review primary action has a readable width');
      await fitDialog('Review');
      await page.screenshot({ path: resolve(output, `swap-review-${width}-${theme}.png`) });
      await button('Simulate swap flow').click();
      await fitDialog('Simulation');
      await page.screenshot({ path: resolve(output, `swap-cinema-${width}-${theme}.png`) });
      for (let i = 0; i < 6; i++) await button('Next demo step').click();
      assert.ok((await page.locator('dialog[open]').innerText()).includes('Demo complete.'));
      await button('Back to swap').click();
    }
  }
  assert.ok(await page.locator('input[value="public"]').isEnabled(), 'Standard mainnet is available');
  await page.evaluate(() => globalThis.__testSwap.setContext({ id: 'synthetic', name: 'Everyday wallet',
    network: 'mainnet', live: true, preferredFrom: 'sol', threshold: '2 of 3 devices',
    payout: { address: 'u1' + 'q'.repeat(105) },
    solGroup: { mode: 'private', refundTo: '7DYCAhqwQSKqqL1h8V1XmY1BTcMWxrASQYKNMy87jeg3',
      balanceAtomic: '1000000000', ready: () => null } }));
  await page.locator('label:has(input[value="public"])').click();
  await page.locator('#swap-amount').fill('1');
  await button('Review standard swap').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-key="swap-review"]').disabled);
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720], [390, 844]]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height });
    await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    await settleOverview(page);
    assert.equal(await page.locator('.swap-funding,.swap-payer').count(), 0, 'no outside-wallet payer selector');
    assert.equal(await page.getByText('A Solana wallet outside Zigs', { exact: true }).count(), 0);
    assert.ok((await page.locator('.swap-pane-label').first().innerText()).includes('Confidential SOL'));
    if (width > 1100) assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
      'Standard mainnet has the compact full-header layout');
    await page.screenshot({ path: resolve(output, `standard-mainnet-${width}-${theme}.png`) });
  }
  assert.equal(await page.locator('.swap-powered strong').innerText(), 'NEAR Intents');
  await button('Review standard swap').click();
  assert.equal(await page.locator('dialog[open] input[type=radio]').count(), 0);
  assert.equal(await page.locator('#swap-refund').count(), 0, 'the connected wallet supplies its refund address');
  assert.ok((await page.locator('dialog[open]').innerText()).includes('Private SOL balance'));
  await page.keyboard.press('Escape');
  await page.locator('label:has(input[value="preview"])').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#swap-amount').fill('2');
  await button('Initiate confidential swap').click();
  await button('Simulate swap flow').click();
  await page.waitForTimeout(2100);
  assert.equal(await page.locator('.swap-cinema').getAttribute('data-stage'), '1');
  await button('Pause').click();
  await page.waitForTimeout(2700);
  assert.equal(await page.locator('.swap-cinema').getAttribute('data-stage'), '1', 'pause stops advancement');
  await button('Next demo step').click();
  assert.equal(await page.locator('.swap-cinema').getAttribute('data-stage'), '2');
  assert.equal(await page.locator('.swap-cinema-object-art').evaluate(n => getComputedStyle(n).opacity), '1',
    'manual advancement while paused keeps the new sculpture visible');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`${browserName}: mainnet/testnet asset popovers, Receive selection, viewport fit, compact review, six stages, Standard availability, autoplay, pause and Escape passed.`);
} finally { await browser.close(); }
