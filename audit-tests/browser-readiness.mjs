// Audit-only real entrypoint checks. Requires a disposable, credential-free local Worker.
// Blocks every chain/provider HTTP route and all non-local requests. Never opens saved wallets.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchTestBrowser } from '../solspike/harness/browser-test.mjs';
const origin = process.env.ZIGS_AUDIT_ORIGIN;
assert.ok(origin, 'Set ZIGS_AUDIT_ORIGIN to an isolated audit Worker, never a developer/prod service');
const url = new URL(origin);
assert.ok(url.hostname === 'localhost' && !['8787', '8788'].includes(url.port));
const out = resolve(process.env.ZIGS_AUDIT_OUTPUT || '/private/tmp/zigs-production-audit/entry-runtime');
mkdirSync(out, { recursive: true });
const browser = await launchTestBrowser(), records = [];
try {
  for (const mode of ['cold-desktop', 'cold-mobile-2Mbps-150ms', 'engine-failure']) {
    const context = await browser.newContext({ viewport: mode.includes('mobile')
      ? { width: 390, height: 844 } : { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    let blocked = 0;
    await context.route('**/*', route => {
      const request = route.request(), u = new URL(request.url());
      if (u.origin !== origin) { blocked++; return route.abort(); }
      if (/^\/(near\/|lwd\/|portfolio\/prices$|zns$|sol\/config(?:-mainnet)?\.json$)/.test(u.pathname)
        || request.method() !== 'GET') {
        blocked++; return route.fulfill({ status: 503, body: 'Unavailable in isolated audit.' });
      }
      if (mode === 'engine-failure' && u.pathname.endsWith('.wasm'))
        return route.fulfill({ status: 503, body: 'Controlled WASM load failure.' });
      return route.continue();
    });
    const page = await context.newPage(), errors = [], consoleErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => {
      const u = new URL(socket.url());
      assert.ok(u.host === url.host && u.pathname === '/ws', 'Only the disposable local relay is allowed');
    });
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)); });
    await page.addInitScript(() => {
      globalThis.__auditLongTasks = [];
      try { new PerformanceObserver(list => {
        globalThis.__auditLongTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })));
      }).observe({ type: 'longtask', buffered: true }); } catch {}
    });
    if (mode.includes('mobile')) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150,
        downloadThroughput: 250000, uploadThroughput: 100000 });
    }
    const started = Date.now();
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const domReadyMs = Date.now() - started;
    console.log(JSON.stringify({ mode, stage: 'domcontentloaded', domReadyMs }));
    const diagnostic = setTimeout(async () => console.log(JSON.stringify({ mode, stage: 'startup-snapshot', errors,
      text: (await page.locator('body').innerText()).slice(0, 1700) })), 10000);
    await page.getByRole('button', { name: 'Create wallet', exact: true }).waitFor({ timeout: 90000 });
    clearTimeout(diagnostic);
    const createVisibleMs = Date.now() - started;
    if (mode === 'engine-failure') {
      await page.waitForFunction(() => document.querySelector('#engine-text')?.textContent.includes('failed'), null, { timeout: 30000 });
    } else await page.waitForFunction(async () => !!(await import('/app-engine.js')).Z
      && (await import('/app-groups.js')).dbReady, null, { timeout: 90000 });
    const readyMs = Date.now() - started;
    const facts = await page.evaluate(() => ({
      paints: performance.getEntriesByType('paint').map(e => ({ name: e.name, start: e.startTime })),
      resources: performance.getEntriesByType('resource').map(e => ({
        path: new URL(e.name).pathname, encodedBytes: e.encodedBodySize, duration: e.duration })),
      longTasks: globalThis.__auditLongTasks,
      engineText: document.querySelector('#engine-text')?.textContent,
      banner: document.querySelector('#banner')?.innerText,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    const record = { mode, domReadyMs, createVisibleMs, readyMs, blocked, errors, consoleErrors, ...facts };
    if (mode !== 'engine-failure') {
      await context.setOffline(true);
      await page.waitForTimeout(150);
      record.offlineVisible = await page.getByText(/No network connection/, { exact: false }).isVisible();
      await context.setOffline(false);
      await page.waitForTimeout(250);
      await page.getByRole('button', { name: 'Create wallet', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      record.cancelCreateReturnedHome = await page.getByRole('button', { name: 'Create wallet', exact: true }).isVisible();
      assert.ok(record.offlineVisible && record.cancelCreateReturnedHome);
    } else record.failureFeedbackVisible = await page.locator('#banner').isVisible();
    assert.ok(!facts.horizontalOverflow, 'Entry content stays within the viewport');
    assert.equal(errors.length, 0, 'No uncaught browser exceptions');
    if (mode === 'engine-failure') assert.ok(record.failureFeedbackVisible);
    await page.screenshot({ path: resolve(out, mode + '.png'), fullPage: true });
    records.push(record);
    writeFileSync(resolve(out, 'results.json'), JSON.stringify(records, null, 2));
    console.log(JSON.stringify({ mode, domReadyMs, createVisibleMs, readyMs,
      resourceCount: facts.resources.length, encodedBytes: facts.resources.reduce((s, r) => s + r.encodedBytes, 0),
      maxLongTaskMs: Math.max(0, ...facts.longTasks.map(t => t.duration)), runtimeErrors: errors.length,
      engineText: facts.engineText, horizontalOverflow: facts.horizontalOverflow,
      failureFeedbackVisible: record.failureFeedbackVisible }));
    await context.close();
  }
} finally { await browser.close(); }
