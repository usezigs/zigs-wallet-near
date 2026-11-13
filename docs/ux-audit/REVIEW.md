# UX branch review and qualification

13 November 2026. Target: `Near` at `fc8d504bf314b960392589f6e0f303189cfed043`.

The UX changes were reapplied onto the latest fetched Near before this draft PR. Conflicts were limited to the native testnet balance label and its test. Near's mainnet portfolio tracker, encrypted price history, chart lifecycle and compact overview were retained. The UX clarification remains “ZEC balance” on testnet.

## Local validation

- Node `v26.13.1`: 92 web check scripts passed. This is the full CI-style web queue, excluding the baseline helper list and the QR test, which requires the locally unavailable `qrencode` command. CI installs that dependency.
- `bash solspike/lint.sh`: passed, 317 JavaScript files and two Python files.
- `node web/build.mjs`: passed.
- `node web/openglass/ux-browser.mjs`: passed, 24 light/dark render variants at 320, 390 and 1440 pixels; no browser errors or horizontal overflow.
- `node web/openglass/browser-check.mjs`: passed.
- `node solspike/tools/portfolio_browser.mjs`: passed, 126 checks against the retained Near portfolio behavior.
- `git diff --check`: passed.

The new pure tests are registered in both the fast suite and baseline suite. The error feedback module is registered in the app loader; the module graph check passes for unlocked and locked vault states. The separate Playwright UX check lives outside `web/test`, so the server-free CI web queue does not attempt a macOS Chrome launch.

The web tests run the real engine, signature verification and application controllers against disposable in-memory stores and a fake chain. They cover complete local signing, broadcast/reconciliation handling, backup/restore, threshold and nonce restrictions, cancellation/holds, provider route verification, failed swap archive writes and reopening history. These are not live network settlements.

## Existing broader-tooling limits

The repository fast suite ran 81 checks and reported two existing historical-comparison failures:

- `solspike/test/plain-equiv.test.mjs` requires `69803a1d:wasm-sol/vectors/smoke`. That object is unavailable locally and GitHub cannot resolve that ref.
- `solspike/test/policy.test.mjs` requires `0a21b347774868e54d227a46b4024710dd7a3f44:cf/src/index.js`. That path does not exist in the recorded historical commit.

The scripts, historical refs and baseline manifest responsible for these failures are unchanged from `Near`. They were not bypassed or rewritten to make this UX PR appear green. The full web queue, including the updated app and payment/recovery tests, passes independently.

## Live network qualification still pending

The default Devnet harness configuration (`~/.config/zigs/live-env.sh`) is absent. Its SDK package/configuration, test RPC and disposable-wallet funding setup are not installed here; even the optional scenario-f mock harness stops at a missing `@solana/kit` package. No existing wallet key was used and no live transaction was sent.

| Flow | Completed here | Remaining qualification |
| --- | --- | --- |
| Zcash payment | Engine/controller signing, expiry, submission and unknown-outcome tests | Fund a disposable testnet wallet, send a payment and verify block inclusion independently. |
| Solana payment and restore | Fake-chain complete payment/restore suites, alternate approval devices, interrupted restore and subscription checks | On a configured Devnet harness, use a clean copy of the reviewed commit for `scenario-f`, independently checking receipts before and after restoring fresh browser contexts. |
| Swap recovery | Fresh route matching, unknown/failed outcomes, durable encrypted archive, reopen/status and duplicate-proposal checks | NEAR swap routes are mainnet-only; a testnet swap cannot certify them. Real provider deposit/payout/refund qualification requires a separately authorized funded staging run. |

Keep the PR draft until review and the intended live qualification are complete. The separate [private Solana authority review](PRIVATE_SOLANA_RELEASE_REVIEW.md) remains open; this PR changes disclosure, not program authority or release gates.
