# Audit-only tests — no application repairs

These tests use generated/inert material, fresh browser stores and mock dependencies. They must never target a production service, a saved browser profile or an existing wallet.

The following three commands **intentionally fail** the required secure invariant on audited commit bf75463. Their nonzero exits are evidence of the unresolved defects, not failures to suppress:

- `node audit-tests/stale-keystore-save.mjs` — AUD-001, actual persistence/AES logic with disposable storage.
- `node audit-tests/stale-keystore-browser.mjs` — AUD-001, real two-page storage/Web Locks/AES; normal controls pass and explicitly delayed-event cases lose additions.
- `node audit-tests/final-transaction-binding.mjs` — AUD-002, actual submission-boundary function source with inert broadcaster/storage/signature dependencies. Opaque bytes and mock acceptance do not establish a real chain accepts an invalid spend.

Browser tests require the installed `web` Playwright dependency and a supported local Chrome binary. They do not use the browser profile visible in the app.

For real-entry/relay checks, first build the current web interface, then run `node audit-tests/isolated-worker.mjs` in a separate terminal. It creates temporary config/cwd/SQLite state, filters child environment, disables chain/provider flags, binds loopback, and prints a newly allocated localhost origin. It does not load cf/.dev.vars. Stop it with Ctrl+C to remove its temporary state.

Using that **newly printed origin**, not ports8787/8788:

- `ZIGS_AUDIT_ORIGIN=http://localhost:<port> node audit-tests/browser-readiness.mjs` — actual entry, constrained network, offline/cancel and controlled WASM failure. Its exact API blocker preserves JS modules such as zns.js. Observes only the new local relay socket.
- `node audit-tests/relay-capability.mjs ws://localhost:<port>` — three small writes in one random new namespace, confirming documented ID-only ciphertext read/corruption/replay. Exit0 means the weaker boundary was characterized, not that stronger authorization passed. No quota exhaustion or existing group is targeted.

Do not run the repository baseline server runner with a real developer secret file for this audit. Existing unchanged tests and the official Node26 gate have their own reported failures/limits; these added tests do not replace them.
