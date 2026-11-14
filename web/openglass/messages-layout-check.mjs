// Real message renderers, signed synthetic conversations and no external requests or sends.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserOutput, launchTestBrowser } from '../../solspike/harness/browser-test.mjs';
import { overviewFixture, settleOverview, OVERVIEW_ORIGIN } from '../../solspike/harness/overview-redesign-fixture.mjs';
import { installMessagingFixture } from '../../solspike/harness/messaging-redesign.mjs';
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const output = browserOutput('messages-layout'), checks = [], errors = [];
const browser = await launchTestBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', colorScheme: 'dark' });
const page = await context.newPage(); page.setDefaultTimeout(10000);
page.on('pageerror', error => errors.push(error.message));
const check = (pass, label) => { assert.ok(pass, label); checks.push(label); };
const settle = async () => { await settleOverview(page); await page.waitForTimeout(80); };
const capture = name => page.screenshot({ path: resolve(output, name + '.png'), fullPage: true, animations: 'disabled' });
function clipped() {
  const shown = n => !n.matches('[aria-hidden=true],.openglass-backdrop-slot') && n.checkVisibility()
    && !n.closest('[hidden],details:not([open])>:not(summary)');
  return [...document.querySelectorAll('.messages-empty>*,.messages-composer,.messages-conversation-body>.composer,.messages-account-setup')].filter(shown).flatMap(node => {
    const box = node.getBoundingClientRect();
    for (let parent = node.parentElement; parent && parent.id !== 'app'; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowY;
      if (['auto', 'scroll'].includes(overflow)) break;
      if (!['hidden', 'clip'].includes(overflow)) continue;
      const r = parent.getBoundingClientRect();
      if (box.top < r.top - 2 || box.bottom > r.bottom + 2) return [{ node: node.className, parent: parent.className, top: box.top, bottom: box.bottom, parentTop: r.top, parentBottom: r.bottom }];
    }
    return [];
  });
}
async function matrix(scene) {
  await page.goto(OVERVIEW_ORIGIN);
  await page.locator('#app').waitFor({ state: 'attached' });
  await installMessagingFixture(page, scene, 'after');
  if (scene === 'setup') await page.getByRole('tab', { name: 'On-chain messages', exact: true }).click();
  for (const [width, height] of [[1440, 900], [1366, 768], [1024, 600], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme); await settle();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scene} ${width} ${theme}: no horizontal overflow`);
      const hidden = await page.evaluate(clipped);
      if (hidden.length) { await capture('clipping-' + scene + '-' + width); console.log(hidden); }
      check(hidden.length === 0, `${scene} ${width} ${theme}: content and composer are never clipped`);
      if (scene === 'inbox' && width >= 761) {
        const thread = page.locator('.messages-empty');
        await thread.evaluate(n => { n.scrollTop = n.scrollHeight; });
        const reachable = await thread.evaluate(n => {
          const note = n.querySelector('p:last-of-type').getBoundingClientRect(), box = n.getBoundingClientRect();
          return note.bottom <= box.bottom + 1;
        });
        check(reachable, `${width} ${theme}: all empty-state information can be reached`);
      }
    }
    if ([1440, 320].includes(width)) await capture(scene + '-' + width);
  }
  if (['team', 'direct', 'contact'].includes(scene)) {
    await page.setViewportSize({ width: 1366, height: 600 }); await settle();
    const log = page.locator('.messages-workspace .chat-log').first();
    if (await log.count()) {
      await log.evaluate(n => { const row = n.querySelector('.msg'); if (row) for (let i = 0; i < 30; i++) n.append(row.cloneNode(true)); });
      const result = await log.evaluate(n => { n.scrollTop = n.scrollHeight; return n.scrollTop > 0 || n.scrollHeight <= n.clientHeight; });
      check(result, scene + ': long histories can scroll to their newest message');
    }
    check((await page.evaluate(clipped)).length === 0, scene + ': long histories keep the composer reachable');
  }
}
try {
  await overviewFixture(context, page, { messaging: true });
  for (const scene of ['inbox', 'team', 'direct', 'contact', 'changed-key', 'invite', 'setup']) await matrix(scene);
  check(errors.length === 0, 'no browser runtime errors: ' + errors.join(', '));
  console.log('Messages layout: ' + checks.length + ' checks passed. Evidence: ' + output);
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
