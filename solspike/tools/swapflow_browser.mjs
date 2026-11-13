// Run against swap_preview_server.mjs. Real renderer, real receipt encryption, synthetic funds.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = resolve(process.env.ZIGS_SWAP_OUTPUT || 'solspike/.state/swapflow');
mkdirSync(out, { recursive: true });
const origin = 'http://127.0.0.1:' + (process.env.ZIGS_SWAP_PORT || 8856);
const browser = await chromium.launch({ headless: true,
   executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
   reducedMotion: 'reduce' });
const page = await context.newPage(), errors = [], forbidden = [], checks = [], screenshots = [];
const livePreview = process.env.ZIGS_LIVE_PREVIEW_CHECK === '1';
const requests = [];
page.on('request', (request) => requests.push(new URL(request.url()).pathname));
page.setDefaultTimeout(30000);
page.on('pageerror', (e) => errors.push(e.message));
await context.route('**/*', (route) => {
  const request = route.request(), url = new URL(request.url());
  if (livePreview && url.origin === origin && url.pathname === '/near/quote'
    && request.method() === 'POST') return route.continue();
  if (url.origin !== origin || request.method() !== 'GET' || /\/near\//.test(url.pathname)) {
    forbidden.push(url.pathname); return route.abort();
  }
  return route.continue();
});
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
async function open(scenario = 'private', width = 1440, theme = 'dark') {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await page.goto(origin + '/__swap_preview__?scenario=' + scenario + '&theme=' + theme,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.swapHarnessReady);
  await page.evaluate(() => document.fonts.ready);
}
async function capture(name) {
  // Controlled-clock playback can defer a CSS frame. Capture the settled chapter, not opacity 0.
  await page.locator('.swap-privacy-explainer').evaluateAll((nodes) => nodes.forEach((node) =>
    node.getAnimations({ subtree: true }).forEach((animation) => animation.finish())));
  const dialog = await page.locator('dialog[open]').count();
  await page.screenshot({ path: resolve(out, name + '.png'), fullPage: !dialog });
     screenshots.push(name);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
     name + ': no horizontal overflow');
}
async function quote() {
  await page.getByRole('textbox', { name: 'Amount you pay', exact: true }).fill('0.1');
  await page.waitForFunction(() => window.swapFixture.model.value.phase === 'QUOTE_READY');
}
async function deposit(mode = 'basic') {
  await page.getByRole('radio', { name: mode === 'basic'
    ? /Confidential mainnet/ : /Standard mainnet/ }).check();
  await quote();
  await page.getByRole('button', { name: 'Initiate confidential swap', exact: false }).click();
  check(await page.getByRole('dialog').getByText('Private funds, public deposit', {
     exact: true }).isVisible(), 'review identifies public boundary');
  await page.locator('#swap-agree').check(); await capture('review-private');
  await page.getByRole('button', { name: 'Get deposit address', exact: true }).click();
  await page.locator('#swap-deposit:not([hidden])').waitFor();
}
try {
  const viewports = [320, 390, 768, 1440].flatMap((w) => ['light', 'dark'].map((t) => [w, t]));
  for (const [width, theme] of viewports) {
    await open('private', width, theme); await quote();
    check(await page.getByRole('radio', { name: /Hackathon preview/ }).isChecked(),
      'fresh visit defaults to unfunded preview');
       await capture('composer-' + width + '-' + theme);
    check(await page.getByText('Minimum received', { exact: true }).first().isVisible(),
       'minimum visible at ' + width + ' ' + theme);
    check(await page.getByRole('heading', { name: 'What stays private?',
       exact: true }).isVisible(), 'privacy explainer visible');
    if (width === 390) {
      await page.getByRole('button', { name: 'Initiate confidential swap', exact: false }).click();
      await capture('review-mobile-' + theme);
      await page.keyboard.press('Escape');
    }
  }
  await open('hackathon'); await desktopFit();
  await open(); await quote();
  await page.getByRole('button', { name: 'Initiate confidential swap', exact: false }).click();
  check(await page.getByRole('button', { name: 'Get deposit address', exact: true }).count() === 0,
    'preview review offers no live deposit action');
  await page.getByRole('button', { name: 'Simulate swap flow', exact: true }).click();
  for (let i = 0; i < 6; i++) await page.getByRole('button', {
    name: 'Next demo step', exact: false }).click();
  check(await page.getByText('Demo complete. The steps were simulated. No funds moved.', {
    exact: true }).isVisible(), 'preview completes six explicitly simulated steps');
  await capture('simulation-complete');
  await open(); await page.getByRole('button', {
     name: 'Use available private SOL balance' }).click();
  check(await page.getByRole('textbox', { name: 'Amount you pay',
     exact: true }).inputValue() === '0.25', 'Max uses private available balance');
  await deposit(); await capture('deposit-private');
  check(await page.getByText('Confidential mainnet · Basic · reported by NEAR Intents', {
    exact: true }).isVisible(), 'receipt identifies the provider-reported routing mode');
  await page.evaluate(() => window.swapFixture.routing('public'));
  check(await page.getByRole('button', { name: 'Propose private SOL withdrawal',
    exact: true }).isDisabled(), 'public-route downgrade blocks new funding');
  check(await page.getByRole('alert').getByText(/Confidential routing could not be confirmed/)
    .isVisible(), 'routing mismatch is announced with recovery guidance');
  await capture('routing-unconfirmed');
  await page.evaluate(() => window.swapFixture.routing('basic'));
  check(await page.getByRole('button', { name: 'Propose private SOL withdrawal',
    exact: true }).isEnabled(), 'matching confidential status restores the action');
  assert.equal(await page.evaluate(async () => {
    const { swapRecordOf } = await import('/swap-records.js');
    try {
      const record = swapRecordOf(window.swapFixture.model.value.live);
      await window.swapFixture.context.journal.save(record);
      return '';
    }
    catch (e) { return e.message; }
  }), '', 'real encrypted journal accepts the open swap');
  await page.getByRole('button', { name: 'Propose private SOL withdrawal', exact: true }).click();
  await page.getByText('Send of this wallet: 1 of 2 device approvals', { exact: true }).waitFor();
  check(await page.getByRole('button', { name: 'Propose private SOL withdrawal',
     exact: true }).isDisabled(), 'duplicate proposal blocked');
  await capture('approvals-private');
  await page.reload(); await page.waitForFunction(() => window.swapHarnessReady);
  await page.locator('#swap-deposit:not([hidden])').waitFor();
  check(await page.evaluate(() => window.swapFixture.model.value.live.swap.confidentiality)
    === 'basic', 'confidential mode survives encrypted receipt recovery');
  check(await page.getByText('Send of this wallet: 1 of 2 device approvals', {
     exact: true }).isVisible(), 'proposal tracking survives reload');
  await capture('resumed-private');
  await page.evaluate(() => window.swapFixture.status('SUCCESS'));
  check(!await page.getByRole('button', {
    name: 'Propose private SOL withdrawal', exact: true }).isVisible(),
    'funding action disappears after the deposit is received');
  check(await page.getByText(/Status: Provider reports payout sent/).isVisible(),
     'provider success waits for wallet');
  check(await page.getByText('Shielded ZEC received and confirmed in this wallet.', {
     exact: false }).count() === 0, 'provider success cannot imply shielded receipt');
  await page.evaluate(() => window.swapFixture.receipt({ amount: '20000000', confirmed: true,
     meetsMinimum: true }));
  await page.getByText('Status: Shielded ZEC received and confirmed in this wallet.', {
     exact: true }).waitFor();
  await capture('confirmed-shielded');
  await page.getByRole('button', { name: 'Hide tracking', exact: true }).click();
  await page.locator('#swap-deposit').waitFor({ state: 'hidden' });
  await page.reload(); await page.waitForFunction(() => window.swapHarnessReady);
  check(!await page.locator('#swap-deposit').isVisible(),
     'hidden history does not silently reopen');
  await page.getByRole('button', { name: /Resume SOL to ZEC swap/ }).click();
  await page.locator('#swap-deposit:not([hidden])').waitFor();
  await page.evaluate(() => window.swapFixture.status('REFUNDED'));
  check(await page.getByText('0.0995 SOL', { exact: true }).isVisible(),
     'actual refund amount shown');
  check(await page.getByText('deadline exceeded', { exact: true }).isVisible(),
     'refund reason shown');
  await capture('refund-private');
  await open('testnet'); await quote();
  check(await page.getByText(/Use a mainnet wallet for real swaps/).isVisible(),
     'testnet cannot look like mainnet execution');
  check(await page.getByRole('radio', { name: /Standard mainnet/ }).isDisabled()
    && await page.getByRole('radio', { name: /Confidential mainnet/ }).isDisabled(),
    'test funds cannot select mainnet execution');
  check(await page.getByRole('button', { name: 'Initiate confidential swap',
    exact: false }).isEnabled(),
    'test wallet can review an unfunded price preview');
  await capture('testnet-preview');
  await open('standard'); await deposit('public');
  check(await page.getByText('Standard mainnet · public route · reported by NEAR Intents', {
    exact: true }).isVisible(), 'standard receipt identifies public routing');
  await capture('standard-public');
  await page.reload(); await page.waitForFunction(() => window.swapHarnessReady);
  await page.locator('#swap-deposit:not([hidden])').waitFor();
  check(await page.evaluate(() => window.swapFixture.model.value.live.routeChoice === 'public'
    && window.swapFixture.model.value.execution === 'public'),
    'explicit standard choice survives encrypted recovery');
  await page.evaluate(() => window.swapFixture.routing('basic'));
  check(await page.getByRole('button', { name: 'Propose private SOL withdrawal',
    exact: true }).isDisabled(), 'a different returned mode blocks standard funding too');
  await open('save-error'); await deposit();
  check(await page.getByRole('button', { name: 'Propose private SOL withdrawal',
     exact: true }).isDisabled(), 'failed receipt save blocks funding');
  await capture('save-failure');
  await open('plain', 390); await quote(); await capture('plain-mobile');
  await page.getByRole('button', { name: 'Initiate confidential swap', exact: false }).click();
  for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab');
     check(await page.evaluate(() => !!document.activeElement.closest('dialog')),
        'focus remains in review'); }
  await page.keyboard.press('Escape');
  check(await page.getByRole('button', { name: 'Initiate confidential swap',
     exact: false }).evaluate((n) => n === document.activeElement), 'Escape restores focus');
  await privacyTour();
  if (livePreview) {
    const start = requests.length;
    await open('hackathon', 390, 'light');
    const response = page.waitForResponse((r) => r.url() === origin + '/near/quote');
    await quote();
    const quoted = await response, body = await quoted.json();
    check(quoted.status() === 200 && BigInt(body.minAmountOut) > 0n,
      'key-free judge preview receives a real mainnet price quote');
    check(!requests.slice(start).some((path) => path.startsWith('/pkg/')),
      'judge preview needs no compiled wallet or WASM engine');
    check(await page.getByRole('radio', { name: /Standard mainnet/ }).isDisabled(),
      'judge preview cannot select real execution');
    check(await page.getByText('Hackathon preview · no funds', { exact: true }).isVisible(),
      'simulation remains clearly labelled');
    await capture('hackathon-real-quote');
    await page.getByRole('button', { name: 'Initiate confidential swap', exact: false }).click();
    await page.getByRole('button', { name: 'Simulate swap flow', exact: true }).click();
    for (let i = 0; i < 6; i++) await page.getByRole('button', {
      name: 'Next demo step', exact: false }).click();
    await capture('hackathon-complete');
    writeFileSync(resolve(out, 'live-quote.json'), JSON.stringify(body, null, 2) + '\n');
  }
  check(errors.length === 0, 'no runtime errors: ' + errors.join(', '));
  check(forbidden.length === 0, 'no live-swap requests or transfers; only dry quotes permitted');
} finally {
  writeFileSync(resolve(out, 'validation.json'), JSON.stringify({ checks, screenshots,
     errors, forbidden }, null, 2) + '\n');
  await browser.close();
}
console.log('swapflow browser: ' + checks.length + ' checks; ' + screenshots.length + ' captures');

async function privacyTour() {
  const start = Date.now();
  await page.clock.install({ time: new Date(start) });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open('privacy');
  const panel = page.locator('.swap-privacy-explainer');
  const stages = panel.getByRole('button').filter({ has: page.locator('.swap-privacy-node') });
  const chapter = panel.getByRole('heading', { level: 3 });
  check(await page.locator('.swap-composer').getByRole('button', {
    name: 'Quote details' }).isVisible(), 'quote details stay beside the form');
  check(await page.getByRole('complementary').getByRole('button', {
    name: 'Quote details' }).count() === 0, 'right panel is reserved for privacy education');
  await page.waitForFunction(() => document.querySelector('.swap-privacy-explainer')
    .dataset.playing === 'true');
  check(await panel.getByRole('button', { name: 'Pause explainer', exact: true }).isVisible(),
    'the visual tutorial autoplays without a click');
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
  await checkAutoplayVisibility(panel);
  await stages.nth(0).click();
  await panel.getByRole('button', { name: 'Resume explainer', exact: true }).click();
  await page.clock.runFor(4100);
  check(await chapter.textContent() === 'The SOL deposit is public',
    'playback animates from the private source into the public deposit');
  await panel.getByRole('button', { name: 'Pause explainer', exact: true }).click();
  await page.clock.runFor(7000);
  check(await chapter.textContent() === 'The SOL deposit is public', 'pause holds the chapter');
  await capture('privacy-public-deposit');
  await panel.getByRole('button', { name: 'Resume explainer', exact: true }).click();
  await page.clock.runFor(4100);
  check(await chapter.textContent() === 'NEAR can connect the route',
    'provider chapter explains address linkage');
  await page.clock.runFor(6000); await page.clock.runFor(5700);
  check(await panel.getAttribute('data-playing') === 'true',
    'the destination gets its reading time');
  await page.clock.runFor(300);
  check(await panel.getAttribute('data-playing') === 'false',
    'the tutorial finishes in twenty seconds');
  check(!await panel.locator('.swap-privacy-controls').isVisible(),
    'playback stops without showing a replay option');
  check(await panel.locator('.swap-privacy-count,.swap-privacy-time').count() === 0,
    'the stage and seconds counters are removed');
  await page.clock.runFor(20000);
  check(await chapter.textContent() === 'ZEC is requested to a shielded address',
    'playback does not loop or imply confirmed delivery');
  await capture('privacy-shielded-destination');
  await stages.nth(0).click();
  await panel.getByRole('button', { name: 'Resume explainer', exact: true }).click();
  await page.getByRole('radio', { name: /Hackathon preview/ }).focus();
  await page.keyboard.press('ArrowRight');
  check(await page.getByRole('radio', { name: /Standard mainnet/ }).isChecked(),
    'the raised selector supports native keyboard navigation');
  await page.getByRole('radio', { name: /Confidential mainnet/ }).check();
  check(await panel.getByRole('button', { name: 'Pause explainer', exact: true }).isVisible(),
    'a routing change restarts the active tutorial with current route facts');
  await stages.nth(2).click();
  await panel.getByRole('button', { name: 'Privacy details, refunds and recovery' }).click();
  check(await panel.getByText(/Basic requests confidential routing/).isVisible(),
    'Basic mode explains its provider access requirement');
  const providerDisclosure = panel.getByRole('dialog')
    .getByText(/Zigs’ status lookup can also expose/);
  check(await providerDisclosure.isVisible(),
    'confidential chapter discloses remaining status visibility');
  await panel.getByRole('button', { name: 'Close privacy details' }).click();
  await page.getByRole('radio', { name: /Standard mainnet/ }).check();
  await stages.nth(2).click();
  await panel.getByRole('button', { name: 'Privacy details, refunds and recovery' }).click();
  check(await panel.getByText(/Standard routing requests no confidential/).isVisible(),
    'Standard mode makes no confidential routing claim');
  check(await panel.getByText(/That device alone controls it/).isVisible(),
    'refund disclosure identifies public single-device control');
  await panel.getByRole('button', { name: 'Close privacy details' }).click();
  await page.getByRole('button', { name: 'Reverse swap direction' }).click();
  await stages.nth(3).click();
  check(await chapter.textContent() === 'You receive public SOL',
    'reverse flow never claims private SOL receipt');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stages.nth(1).click();
  await page.clock.runFor(20000);
  check(await chapter.textContent() === 'ZEC leaves the shielded pool',
    'reduced motion uses manual chapters without timed advancement');
  check(await panel.locator('.swap-privacy-scene').evaluate((n) =>
    getComputedStyle(n).animationName) === 'none', 'reduced motion removes scene animation');
  check(await page.evaluate(() => !window.swapFixture.model.value.live),
    'the entire explainer leaves live-swap state empty');
  await page.clock.setSystemTime(new Date()); await page.clock.resume();
}

async function checkAutoplayVisibility(panel) {
  await panel.evaluate((node) => { node.hidden = true; });
  await page.waitForFunction(() => document.querySelector('.swap-privacy-explainer')
    .dataset.playing === 'false');
  const before = await panel.evaluate((node) => node.style.getPropertyValue('--tutorial-progress'));
  await page.clock.runFor(15000);
  const after = await panel.evaluate((node) => node.style.getPropertyValue('--tutorial-progress'));
  check(after === before,
    'an offscreen tutorial pauses without consuming its chapters');
  await panel.evaluate((node) => { node.hidden = false; });
  await page.waitForFunction(() => document.querySelector('.swap-privacy-explainer')
    .dataset.playing === 'true');
  check(true, 'a visible tutorial resumes automatically');
}

async function desktopFit() {
  const sizes = [[1280, 720], [1366, 768], [1440, 900], [1536, 864], [1277, 1173]];
  const results = [];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (let chapter = 0; chapter < 4; chapter++) {
      await page.locator('.swap-privacy-stop').nth(chapter).click();
      const layout = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('.swap-composer,.swap-privacy-explainer')];
        const tools = document.querySelector('.swap-composer-tools').getBoundingClientRect();
        const quote = document.querySelector('.swap-composer .swap-quote').getBoundingClientRect();
        const more = document.querySelector('.swap-privacy-more').getBoundingClientRect();
        const story = document.querySelector('.swap-privacy-scene').getBoundingClientRect();
        return { pageHeight: document.documentElement.scrollHeight, viewport: innerHeight,
          bottomGaps: [tools.top - quote.bottom, more.top - story.bottom],
          boxes: boxes.map((node) => {
            const r = node.getBoundingClientRect();
            return { width: r.width, height: r.height, top: r.top, bottom: r.bottom,
              contentFits: node.scrollHeight <= node.clientHeight + 1 };
          }) };
      });
      const [left, right] = layout.boxes;
      const label = width + '×' + height + ' chapter ' + (chapter + 1);
      results.push({ label, ...layout });
      writeFileSync(resolve(out, 'panel-geometry.json'), JSON.stringify(results, null, 2) + '\n');
      check(Math.abs(left.width - right.width) < 1 && Math.abs(left.height - right.height) < 1,
        label + ': panels have equal width and height');
      check(layout.pageHeight <= layout.viewport + 1
        && Math.max(left.bottom, right.bottom) <= height, label + ': fits without page scrolling');
      check(layout.boxes.every((box) => box.contentFits), label + ': panel content is not clipped');
      check(left.height <= 521 && layout.bottomGaps.every((gap) => gap < 96),
        label + ': panels avoid excess height and empty footer space');
    }
    if (width === 1280 || width === 1440) await capture('matched-panels-' + width + '-' + height);
  }
  writeFileSync(resolve(out, 'panel-geometry.json'), JSON.stringify(results, null, 2) + '\n');
  await page.setViewportSize({ width: 390, height: 844 });
}
