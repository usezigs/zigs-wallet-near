// Real artwork, chart and Swap renderers with public/synthetic state. No external requests or funds.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserOutput, launchTestBrowser } from '../../solspike/harness/browser-test.mjs';
import { overviewFixture, settleOverview } from '../../solspike/harness/overview-redesign-fixture.mjs';
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const output = browserOutput('identity-overview'), checks = [], errors = [];
const browser = await launchTestBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
const page = await context.newPage(); page.setDefaultTimeout(20000);
page.on('pageerror', error => errors.push(error.message));
const check = (pass, label) => { assert.ok(pass, label); checks.push(label); };
const settle = async () => { await settleOverview(page); await page.waitForTimeout(80); };
const capture = name => page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
async function marbles() {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(async () => {
    const { walletMarble } = await import('/wallet-marble.js');
    const { el } = await import('/app-dom.js');
    const { FLOW_FIXTURES } = await import('/dev/metal-orbs/flow-fixtures.js');
    const draw = () => el('div', { class: 'page', style: 'display:flex;gap:32px;align-items:center;min-height:300px' },
      ...[32, 64, 192].map(size => walletMarble(FLOW_FIXTURES.everyday.zcash, { size })),
      walletMarble(FLOW_FIXTURES.ember.zcash, { size: 192 }));
    globalThis.__messagingView = draw;
    (await import('/app-loop.js')).draw();
  });
  await page.waitForFunction(() => document.querySelectorAll('.wallet-marble[data-motion=playing]').length === 4);
  const pixels = () => page.locator('.wallet-marble canvas').evaluateAll(nodes => nodes.map(n => n.toDataURL()));
  const before = await pixels(); await page.waitForTimeout(300); const after = await pixels();
  check(before.every((value, i) => value !== after[i]), 'every visible marble animates automatically');
  check(await page.locator('button.wallet-marble,.wallet-marble-control,.wallet-marble>.openglass-backdrop-slot').count() === 0,
    'marbles have no playback control or glass box');
  check(await page.locator('.wallet-marble canvas').evaluateAll(nodes => nodes.every(n => {
    const c = n.getContext('2d');
    return c.getImageData(0, 0, 1, 1).data[3] === 0;
  })), 'all marble canvases have transparent corners');
  const labels = await page.locator('.wallet-marble:has(canvas)').evaluateAll(nodes => nodes.map(n => n.dataset.identityRarity));
  check(labels[0] === labels[1] && labels[1] === labels[2], 'the same wallet keeps the same rarity at every size');
  check(labels.every(label => /^(Common|Uncommon|Rare|Epic) Identity$/.test(label)),
    'every identity exposes a valid tier');
  await page.evaluate(async () => (await import('/app-loop.js')).draw()); await settle();
  await page.waitForFunction(() => document.querySelectorAll('.wallet-marble[data-motion=playing]').length === 4);
  const redrawn = await pixels(); await page.waitForTimeout(250);
  check(redrawn.every((value, i) => value !== before[i]), 'ordinary redraws retain live artwork');
  await page.locator('.wallet-marble').last().evaluate(n => { n.style.position = 'absolute'; n.style.top = '2000px'; });
  await page.waitForTimeout(180);
  const offscreen = await pixels(); await page.waitForTimeout(180);
  check(offscreen.at(-1) === (await pixels()).at(-1), 'offscreen identities stop rendering');
  await page.locator('.wallet-marble').last().evaluate(n => { n.style.position = ''; n.style.top = ''; });
  await page.waitForFunction(() => document.querySelectorAll('.wallet-marble[data-motion=playing]').length === 4);
  await page.waitForTimeout(180);
  check(offscreen.at(-1) !== (await pixels()).at(-1), 'returning identities resume automatically');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100);
  const still = await pixels(); await page.waitForTimeout(150);
  check(JSON.stringify(still) === JSON.stringify(await pixels()), 'reduced motion preserves a crisp still');
  await capture('transparent-marbles');
}
async function chart() {
  await page.evaluate(async () => {
    const { createPortfolioChart } = await import('/portfolio-chart.js');
    const { valuePortfolio } = await import('/portfolio-model.js');
    const { el } = await import('/app-dom.js');
    const now = Date.now();
    const observations = Array.from({ length: 20 }, (_, i) => {
      const at = now - (19 - i) * 60000;
      return valuePortfolio([{ asset: 'zec', amount: 2, at }], { zec: { usd: 100 + i, at } }, at).observation;
    });
    const props = { observations, current: valuePortfolio([{ asset: 'zec', amount: 2, at: now }], { zec: { usd: 119, at: now } }, now),
      now, range: '1M', loading: false, failed: true, priceError: 'not_configured', storageNote: '',
      onRange(range) { props.range = range; instance.update(props); }, onRetry() {} };
    const instance = createPortfolioChart(props);
    const host = el('div', { class: 'page overview-page', style: 'max-width:760px;padding:24px' }, instance.element);
    globalThis.__chart = instance; globalThis.__chartProps = props;
    globalThis.__messagingView = () => host;
    (await import('/app-loop.js')).draw(); instance.mount();
  });
  await settle();
  check((await page.locator('.portfolio-chart-line').getAttribute('d')).includes('C'), 'saved chart history draws during a market-service outage');
  check(await page.locator('.portfolio-retry').isHidden(), 'configuration failure has no misleading retry countdown');
  const plot = page.getByRole('slider', { name: 'Explore portfolio history' });
  await plot.focus(); await plot.press('Home');
  await page.waitForFunction(() => document.querySelector('.portfolio-chart-value').textContent === '$200.00');
  check(await page.locator('.portfolio-chart-value').textContent() === '$200.00', 'keyboard scrubbing still reads historical values');
  await plot.press('Escape');
  await page.getByRole('button', { name: '1D', exact: true }).click();
  check(await page.getByRole('button', { name: '1D', exact: true }).getAttribute('aria-pressed') === 'true', 'chart ranges remain functional');
  await capture('chart-history');
  await page.evaluate(() => globalThis.__chart.destroy());
}
async function reveal() {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    const { state } = await import('/app-state.js');
    const { setMe } = await import('/app-groups.js');
    const { setSecrets } = await import('/app-keystore.js');
    const { el } = await import('/app-dom.js');
    const { walletReveal } = await import('/app-wallet-art.js');
    const { FLOW_FIXTURES } = await import('/dev/metal-orbs/flow-fixtures.js');
    const wallet = { ...FLOW_FIXTURES.ember.zcash, birthday: 4500000 };
    const g = { id: 'cd'.repeat(10), name: 'Ember reserve', n: 2, t: 2, version: 1, network: 'testnet' };
    setMe('synthetic');
    Object.assign(state, { g, gid: g.id, groups: [g], wallet, seats: { 1: { uid: 'synthetic', name: 'My laptop' } } });
    setSecrets({ [g.id + ':1']: { uid: 'synthetic', keyPackage: 'synthetic', checkedWallet: JSON.stringify(wallet) } });
    const host = el('div', { class: 'page guided-setup wallet-reveal-page' }, walletReveal(g, () => {}));
    globalThis.__messagingView = () => host;
    (await import('/app-loop.js')).draw();
  });
  await page.locator('.wallet-identity-rarity').filter({ hasText: /Identity/ }).waitFor();
  check(await page.locator('.wallet-reveal').evaluate(n => getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)'
    && getComputedStyle(n).boxShadow === 'none'), 'wallet reveal has no enclosing material box');
  check(/^(Common|Uncommon|Rare|Epic) Identity$/.test(await page.locator('.wallet-identity-rarity').innerText()),
    'wallet reveal displays its deterministic identity tier');
  await capture('wallet-reveal');
}
async function swap() {
  await page.evaluate(async () => {
    const { createSwapPreview } = await import('/app-swap-preview.js');
    const { MockSwapProvider } = await import('/swap-preview-model.js');
    const { ui } = await import('/app-state.js'); ui.tab = 'swap';
    const source = { id: 'synthetic-wallet', name: 'Everyday wallet', network: 'mainnet',
      preferredFrom: 'sol', solGroup: { mode: 'private', reason: 'Synthetic private wallet not funded' } };
    const view = createSwapPreview(source, new MockSwapProvider());
    globalThis.__swap = view; globalThis.__swapSource = source;
    globalThis.__messagingView = () => view.element;
    (await import('/app-loop.js')).draw();
  });
  await settle();
  check(await page.locator('.swap-wallet-provider').isVisible(), 'Helius Privacy Rings identifies the private SOL wallet even before funding is selected');
  check(await page.locator('.swap-pane .swap-helius-credit').isVisible(),
    'the unfunded private-wallet credit stays in the SOL field');
  check(await page.locator('.swap-heading .swap-helius-credit').count() === 0,
    'the provider credit has one location rather than a duplicate header row');
  check(await page.locator('.swap-execution-art > .icon-object').count() === 3,
    'all three swap modes use the shared sculpted icon family');
  for (const [width, height] of [[1440, 900], [1366, 768], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width, height }); await settle();
    for (let i = 0; i < 4; i++) {
      await page.locator('.swap-privacy-stop').nth(i).click(); await settle();
      const clean = await page.locator('.swap-privacy-explainer').evaluate(node => {
        const story = node.querySelector('.swap-privacy-story').getBoundingClientRect();
        const more = node.querySelector('.swap-privacy-more').getBoundingClientRect();
        return story.bottom <= more.top + 1 && node.scrollWidth <= node.clientWidth + 1;
      });
      check(clean, width + ' privacy stage ' + i + ': copy and disclosure never overlap');
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + ' Swap has no horizontal overflow');
    await capture('swap-' + width);
  }
  await page.evaluate(() => globalThis.__swap.setContext({ ...globalThis.__swapSource, solGroup: { mode: 'plain' } }));
  check(await page.locator('.swap-wallet-provider').isHidden(), 'public SOL never receives a private-wallet provider claim');
}
async function overview() {
  await overviewFixture(context, page, { messaging: true });
  await context.route('**/portfolio/prices', route => route.fulfill({ status: 503,
    contentType: 'application/json', body: JSON.stringify({ error: 'prices_not_configured' }) }));
  await page.evaluate(async () => {
    const { state, ui } = await import('/app-state.js');
    const { setSecrets, setGkeys } = await import('/app-keystore.js');
    const { signPins } = await import('/app-filter.js');
    const g = { ...state.g, network: 'mainnet' };
    const wallet = { address: 'u1' + 'q'.repeat(180), network: 'mainnet', birthday: 4500000 };
    state.seats = Object.fromEntries([1, 2, 3].map(i => [i, {
      uid: 'synthetic-device-' + i, name: 'Device ' + i, signPk: String(i).repeat(64),
    }]));
    (await import('/app-groups.js')).setMe('synthetic-device-1');
    setSecrets(Object.fromEntries([1, 2, 3].map(i => [g.id + ':' + i, { ...state.seats[i],
      version: 3, signSk: 'synthetic-not-used', keyPackage: 'synthetic-not-used', checkedWallet: JSON.stringify(wallet) }])));
    setGkeys({ [g.id]: 'synthetic-not-used' });
    (await import('/app-engine.js')).setZ({ normalizeAddress: a => a,
      secretSeal: (_key, _context, value) => value, secretOpen: (_key, _context, value) => value });
    signPins['confirmednet:' + g.id] = 'mainnet';
    Object.assign(state, { g, gid: g.id, wallet, groups: [g], pending: false });
    ui.tab = 'overview'; ui.plainServed = true;
    localStorage.removeItem('zf-portfolio-mainnet-' + g.id);
    (await import('/app-sol.js')).overviewFixturePlain();
    (await import('/app-chain.js')).setChain({ gid: g.id, cw: {}, balAt: Date.now(),
      bal: { spendable: 0, pending: 0, height: 5000000, tip: 5000000, max_send: 0 },
      sent: new Set(), received: [] });
    (await import('/app-loop.js')).draw();
  });
  await page.locator('.portfolio-chart').waitFor(); await settle();
  const warning = page.getByRole('button', { name: 'Wallet device warning', exact: true });
  check(await warning.isVisible(), 'the mainnet share warning remains available beside the wallet name');
  check(await page.locator('.wallet-device-warning-popover').isHidden(), 'the warning does not occupy an overview row');
  await warning.click();
  check(await page.locator('.wallet-device-warning-popover').isVisible(), 'the complete warning opens on demand');
  await page.keyboard.press('Escape');
  for (const [width, height] of [[1440, 900], [1366, 768]]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height });
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme); await settle();
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, viewport: innerHeight }));
    await capture('overview-' + width + '-' + theme);
    check(dimensions.page <= dimensions.viewport + 1, width + ' ' + theme + ': overview fits without page scrolling ' + JSON.stringify(dimensions));
  }
}
try {
  await overviewFixture(context, page, { messaging: true });
  await marbles(); await chart(); await reveal(); await swap(); await overview();
  check(errors.length === 0, 'no browser runtime errors: ' + errors.join(', '));
  console.log('Identity, chart and Swap: ' + checks.length + ' checks passed. Evidence: ' + output);
} catch (error) {
  await capture('failure');
  console.log(await page.evaluate(async () => ({ text: document.getElementById('app').innerText.slice(0, 1500),
    facts: (await import('/app-wallet-art.js')).walletArtFacts(),
    localSeats: (await import('/app-seats.js')).localSeats(),
    rarity: document.querySelector('.wallet-identity-rarity')?.outerHTML,
    identities: [...document.querySelectorAll('.wallet-marble')].map(n => ({ tier: n.dataset.identityRarity, ready: !!n._walletMarbleEntry?.descriptor })) })));
  throw error;
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
