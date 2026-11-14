// Native Chromium localStorage/Web Locks; real app persistence code; generated inert test data.
// Two pages in a fresh isolated browser context. Delayed storage events are explicit fault
// injection, not a claim that ordinary event timing naturally reproduces on every browser.
// Expected secure invariant: a stale successful save preserves another tab's new wallet/share.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchTestBrowser } from '../solspike/harness/browser-test.mjs';
import { overviewFixture } from '../solspike/harness/overview-redesign-fixture.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const browser = await launchTestBrowser(), results = [];
try {
  for (const mode of ['plain', 'sealed']) for (const delayed of [false, true]) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      globalThis.__auditDelayEvents = false; globalThis.__auditEvents = [];
      addEventListener('storage', event => {
        if (!globalThis.__auditDelayEvents) return;
        globalThis.__auditEvents.push(event); event.stopImmediatePropagation();
      }, { capture: true });
    });
    const a = await context.newPage(), b = await context.newPage();
    await overviewFixture(context, a, { messaging: true });
    await overviewFixture(context, b, { messaging: true });
    const seed = { mode, delayed, oldId: 'aa'.repeat(10), newId: 'bb'.repeat(10),
      oldKey: randomBytes(32).toString('base64'), newKey: randomBytes(32).toString('base64'),
      aes: [...randomBytes(32)] };
    await b.evaluate(async seed => {
      const ks = await import('/app-keystore.js');
      const { aesKey } = await import('/vault.js');
      ks.setLocked(null);
      ks.setSecrets({ [seed.oldId + ':1']: { keyPackage: { synthetic: true }, nonces: {}, marks: {} } });
      ks.setGkeys({ [seed.oldId]: seed.oldKey });
      ks.setVault(seed.mode === 'sealed' ? {
        key: await aesKey(new Uint8Array(seed.aes)), rec: { cred: 'YQ', salt: 'Yg' },
      } : null);
      globalThis.__auditDelayEvents = seed.delayed;
    }, seed);
    await a.evaluate(async seed => {
      const { aesKey, seal } = await import('/vault.js');
      const remote = {
        secrets: Object.fromEntries([seed.oldId, seed.newId].map(id => [id + ':1',
          { keyPackage: { synthetic: true }, nonces: {}, marks: {} }])),
        keys: { [seed.oldId]: seed.oldKey, [seed.newId]: seed.newKey },
        chats: { profile: null, list: {} }, personal: null,
      };
      if (seed.mode === 'plain') {
        localStorage.setItem('zf-secrets', JSON.stringify(remote.secrets));
        localStorage.setItem('zf-keys', JSON.stringify(remote.keys));
      } else localStorage.setItem('zf-vault', JSON.stringify(await seal(
        await aesKey(new Uint8Array(seed.aes)), { cred: 'YQ', salt: 'Yg' }, remote)));
    }, seed);
    await b.waitForTimeout(250);
    const row = await b.evaluate(async seed => {
      const ks = await import('/app-keystore.js'), { open } = await import('/vault.js');
      const delayedEventCount = globalThis.__auditEvents.length;
      const saved = await ks.persist();
      globalThis.__auditDelayEvents = false;
      // Deliver delayed events after the save. The handler rereads the overwritten storage.
      for (const ev of globalThis.__auditEvents.splice(0)) dispatchEvent(new StorageEvent('storage', {
        key: ev.key, oldValue: ev.oldValue, newValue: ev.newValue, url: ev.url, storageArea: localStorage,
      }));
      await new Promise(resolve => setTimeout(resolve, 100));
      const after = seed.mode === 'plain' ? {
        secrets: JSON.parse(localStorage.getItem('zf-secrets')), keys: JSON.parse(localStorage.getItem('zf-keys')),
      } : await open(ks.vault.key, JSON.parse(localStorage.getItem('zf-vault')));
      return { mode: seed.mode, delayed: seed.delayed, delayedEventCount, saveReportedSuccess: saved,
        newSharePreserved: Object.hasOwn(after.secrets, seed.newId + ':1'),
        newWalletKeyPreserved: Object.hasOwn(after.keys, seed.newId) };
    }, seed);
    results.push(row); await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ method: 'fresh native browser pages, generated test records; events delayed only when labeled', results }, null, 2));
assert.ok(results.every(r => r.saveReportedSuccess && r.newSharePreserved && r.newWalletKeyPreserved),
  'A successful save must preserve other-tab additions even with delayed storage-event delivery');
