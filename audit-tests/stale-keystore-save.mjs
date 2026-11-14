// Audit regression: real persistence/vault code, disposable fake browser storage only.
// Expected secure invariant: a stale tab must not erase a newly stored wallet/share.
// This intentionally fails on the audited implementation. It never reads real browser data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadRig, storage } from '../web/test/sol-rig.mjs';
import { aesKey, seal, open as openVault } from '../web/vault.js';

await loadRig();
const ks = await import('../web/app-keystore.js');
const oldId = 'aa'.repeat(10), newId = 'bb'.repeat(10);
const oldSeat = oldId + ':1', newSeat = newId + ':1';
const oldKey = randomBytes(32).toString('base64'), addedKey = randomBytes(32).toString('base64');
const staleSecrets = { [oldSeat]: { keyPackage: { synthetic: true }, nonces: {}, marks: {} } };
const remoteSecrets = { ...staleSecrets,
  [newSeat]: { keyPackage: { synthetic: true }, nonces: {}, marks: {} } };
const results = [];
for (const mode of ['plain', 'sealed']) {
  storage.clear(); ks.setLocked(null);
  ks.setSecrets(structuredClone(staleSecrets)); ks.setGkeys({ [oldId]: oldKey });
  let key;
  if (mode === 'plain') {
    ks.setVault(null);
    storage.set('zf-secrets', JSON.stringify(remoteSecrets));
    storage.set('zf-keys', JSON.stringify({ [oldId]: oldKey, [newId]: addedKey }));
  } else {
    key = await aesKey(randomBytes(32));
    const rec = { cred: 'YQ', salt: 'Yg' }; ks.setVault({ key, rec });
    storage.set('zf-vault', JSON.stringify(await seal(key, rec, {
      secrets: remoteSecrets, keys: { [oldId]: oldKey, [newId]: addedKey },
      chats: { profile: null, list: {} }, personal: null,
    })));
  }
  const saved = await ks.persist();
  const after = mode === 'plain' ? {
    secrets: JSON.parse(storage.get('zf-secrets')), keys: JSON.parse(storage.get('zf-keys')),
  } : await openVault(key, JSON.parse(storage.get('zf-vault')));
  results.push({ mode, saveReportedSuccess: saved,
    newSharePreserved: Object.hasOwn(after.secrets, newSeat),
    newWalletKeyPreserved: Object.hasOwn(after.keys, newId) });
}
console.log(JSON.stringify({ scenario: 'stale save before storage-event delivery; generated test data only', results }, null, 2));
assert.ok(results.every(r => r.saveReportedSuccess && r.newSharePreserved && r.newWalletKeyPreserved),
  'A successful stale-tab save must preserve another tab\'s newly persisted share and wallet key');
process.exit(0);
