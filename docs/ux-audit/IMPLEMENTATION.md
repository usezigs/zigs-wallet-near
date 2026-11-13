# Approved UX fixes

13 November 2026 · `codex/near/ux` · initially based on `Near` at `8c0218b`, reconciled with `Near` at `fc8d504` before the draft PR.

This follows the user's approval to implement the suggested fixes after the content audit. The original audit's copy-only restriction applies to that earlier phase. This pass adds interaction and local recovery behavior while retaining the current OpenGlass components and styles.

| Area | Result | Boundary |
| --- | --- | --- |
| Payment next action | The existing verified stage now names the proposing device or missing selected signing devices, separates proof from sending, and tells users to check uncertain outcomes. | Guidance never authorizes an action; signing and broadcast predicates remain in the existing controllers. |
| Cancel, hold, resend | “Cancel proposal” explains cancellation limits. “Resend transaction” means the same signed transaction. Releasing Send explicitly does not cancel the transaction. | Existing cancel restrictions, hold lifetime, release confirmation and resend timing remain intact. |
| Swap recovery | Done archives encrypted tracking records, including failed outcomes and provider-reported transaction IDs. History can copy a recovery record or check current status. Failed, corrupt, full or unconfirmed archive writes retain active tracking. | A restored record cannot open a swap or pay automatically. Fresh route matching still precedes payment details. Provider reports are attributed, not treated as independently verified settlement. |
| Swap deadlines | Wallet send cutoff and provider deadline appear separately. A matching Zcash deposit proposal can be reopened, with its transaction expiry block shown separately. | Existing 30-minute cutoff, exact recipient/refund matching and proposal guards remain in place. A recorded but not yet loaded proposal cannot be recreated through this screen. |
| Restore | Opening a file produces an informational checking state. A persistent restored share with unloaded verification data still shows pending progress after interruption. | Only the existing fit check declares a matching restore successful. Mismatch rollback and restored nonce exclusions remain intact. |
| Known failures | Known rate limits, storage exhaustion, network failures and submission refusals explain recovery. Uncertain submission explicitly requires checking Activity before a new payment. | Unknown validation and security refusals retain their original messages. Classified diagnostics contain fixed facts rather than raw RPC URLs or credentials. No new automatic retry or submission behavior. |
| Older private Solana proposals | Newer/Older controls reach all locally loaded proposals, 12 per page. The selected page's valid open proposals receive priority inside the existing 50-session subscription limit. | Sent/failed records and invalid IDs do not consume subscriptions. Activity and Approvals still summarize the newest 12; their notes point to Solana history. This does not fetch records the server has not supplied. |
| Device replacement and help | The migration screen explains Zcash transfers, separate SOL/USDC moves, old viewing access and future receipts. Setup explains initial device presence and recovery risk. Five FAQs cover passkeys, device availability, cancellation, swaps and replacement. | No in-place key rotation or cross-chain migration is claimed or added. A passkey is not presented as recovery. |
| Private Solana consent | Setup now names the owner's upgrade authority and its scope beyond wallet approvals. | Authority, deployment and cryptography are unchanged. The [release review](PRIVATE_SOLANA_RELEASE_REVIEW.md) remains an engineering/owner decision. |

## Verification

`implementation-verification.json` records the initial implementation checks. The [review record](REVIEW.md) and `review-verification.json` describe the subsequent Near reconciliation, Node 26 tests, browser checks and remaining live qualification. The focused tests cover uncertain submission, preserved domain refusals, encrypted archive round trips and failed writes, interrupted close, corrupt/full history, no automatic payment after restore, route checks, all history pages, live controller subscription bounds, interrupted restore visibility and existing hold/signing restrictions.

`node web/build.mjs` builds successfully. `node web/openglass/browser-check.mjs` checks the existing shell. `node web/openglass/ux-browser.mjs` exercises 24 synthetic renderer variants at 320, 390 and 1440 pixels, in light/dark themes. It clicks history navigation through its bounds, closes a failed swap into history, rechecks its status, and checks horizontal overflow and browser errors. The four mobile captures were visually inspected.

The browser fixture blocks external requests and uses synthetic, unfunded wallet state. These checks do not certify funded chain transactions, native clients, authenticator hardware, real provider refunds or live production availability. The initial implementation pass performed no commit or push; the subsequent review pass prepares this branch for a draft PR. No live transaction, authority change or deployment was performed.

## Storage limits

Swap recovery is scoped to this browser and encrypted with the existing wallet secret. It is not a substitute for key recovery files. Up to 100 archived records, within a 2 MB ciphertext limit, are retained. A full archive keeps the current record open and offers copying its recovery details; it does not silently evict older financial history. Clearing browser data removes this local history.

## Review locations

- Payment display: `web/payment-model.js`, `web/app-drawer.js`, `web/outcome-seal.js`.
- Restore and migration: `web/app-backups.js`, `web/app-wallet.js`.
- Encrypted swap history and resume: `web/swap-recovery.js`, `web/swap-preview-model.js`, `web/app-swap-preview.js`, `web/app-swap-zec.js`.
- Error classification: `web/error-feedback.js`, `web/app-dom.js`, `web/app-loop.js`, `web/app-state.js`.
- Private Solana history: `web/sol/proposal-history.js`, `web/sol/main.js`, `web/sol/payview.js`.
- Guidance and consent: `web/help-model.js`, `web/app-shell.js`, `web/app-setup.js`, `web/sol/net.js`.
