# Prioritized remediation and release gates

Target: audited `codex/near/final4` at `bf75463`, 14 November 2026.

**Current decision: NO-GO for unrestricted real funds.** This is a plan, not an implementation record. The audit did not change production code/configuration, existing tests, branch state or deployments. A later remediation phase needs explicit authorization and must preserve the established visual language.

## Order of work

| Priority | Workstream | Primary issue | Owner role | Release condition |
| --- | --- | --- | --- | --- |
| P0 | Protect concurrent secret persistence | AUD-001 Critical | Wallet/storage + security + adversarial QA | Both added stale-save regressions pass under secure invariants; no erased/restored stale items or nonce resurrection in both modes. |
| P1 | Bind final transaction bytes and submission identity | AUD-002 High | Zcash engine + wallet controller | Independently parsed byte identity/content matches approval before RPC; node mismatch cannot create a successful wrong-ID mark. |
| P1 | Decide relay/custody/release threat boundaries | RISK-001/002/003/005 | Security + protocol + product/operations | Explicit supported threat model, tested recovery and correctly scoped availability; no implicit funds-readiness claim. |
| P2 | Correct network-context labels | AUD-003 | Wallet UI + QA | Mainnet/private-mainnet never says Devnet; pending/unavailable states remain accurate. |
| P2 | Repair committed release gates | AUD-004 | Feature owners + QA | Unchanged official Node26/full browser gates complete and pass; meaningful security assertions retained. |
| P2 | Gate focused regressions in CI | AUD-005 | QA/release engineering | New interaction/expansion/resize tests run in required jobs; intentional regressions fail the job. |
| P2 | Update vulnerable Worker development tooling | AUD-006 | Dependency/release engineering | Actual compatible lockfile no longer resolves observed advisories; build/local Worker/browser behavior revalidated. |
| P2 | Funded disposable-testnet validation | RISK-004 | Wallet/chain + QA | Required end-to-end signing/proving/send/recovery/settlement evidence, without using real funds or production credentials. |
| P3 | Define performance/platform budgets | OBS-001 and coverage gaps | Frontend/performance/accessibility QA | Representative mobile/network measurements and physical-provider coverage meet agreed release criteria. |

## P0 — AUD-001: conflict-safe key persistence

1. Specify per-item identity/version and deletion semantics for wallet shares, wallet keys, chats, personal account and recipients. Do not use a simple union that resurrects deliberately removed material.
2. Inside the shared exclusive lock, read and validate the freshest authoritative record, reconcile local changes against their known base/version, preserve foreign fields, and detect conflicting changes. Consider transactional storage/per-item records rather than whole-dictionary replacement.
3. Keep the current strict refusal to overwrite unreadable/corrupt data. Treat a changed vault/protection context as a conflict, not an empty record. Do not fall back from decryption failure to successful empty persistence.
4. Preserve monotonic nonce-burning/anti-replay marks and their existing lock semantics. A storage fix must not reintroduce burned nonces or duplicate signing.
5. Make the success return mean the relevant changes are durably present. On conflict, keep recoverable in-memory state and provide actionable recovery rather than silently reporting saved.
6. Convert the added invariant regressions into required tests only after fixing the source; **do not remove their delayed-event cases or relax their expectations**.

Acceptance matrix:

- Actual browser pages with ordinary, delayed, dropped and late storage events; stale and current versions; protected/unprotected modes; ordinary Web Locks and supported fallback behavior.
- Concurrent create/restore/add/remove, backup-related saves, chat/recipient saves and vault enable/lock transitions.
- Releasing delayed events cannot reapply stale state or undo a tombstone. Closing/reloading the last material-holding tab preserves recoverability from authoritative storage.
- Wrong-wallet/key conflicts fail closed. Optional backups do not justify losing the only current local copy.
- All existing nonce, vault, signed-document and cross-tab tests remain green. Retain boolean/hash-only evidence; never publish key/backup contents.

Blocking evidence: `node audit-tests/stale-keystore-save.mjs` and `node audit-tests/stale-keystore-browser.mjs` currently exit1.

## P1 — AUD-002: transaction-byte integrity

1. Add a well-scoped engine operation that parses the final serialized transaction and derives its canonical transaction ID/network/branch and any approval-relevant content needed for comparison.
2. Bind that result to the inspected approved PCZT before any submission. Participant-signed final metadata is insufficient independent evidence.
3. Reject malformed/wrong-transaction/wrong-network bytes without an RPC call. Keep approved-byte identity stable across ordinary Send, resend, restored progress and wallet switching.
4. Validate the returned node identity/response. If an inconsistent or unknown outcome follows transmission, preserve an explicit uncertain/mismatch state and reconcile the approved transaction; do not blindly mark supplied metadata submitted or generate a second payment.
5. Preserve signature/authorization verification; hashing bytes alone does not replace validation of the transaction's actual authorization or approval terms.

Acceptance: independently generated valid serialized A/B vectors with known IDs; claimed A/raw B refusal; malformed data; returned B after A; timeout after possible send; already-known tx; expiry; reload/resend; chain reconciliation and no duplicate payment. The current audit test uses inert dependencies, so add real engine/vector tests as well as fixing the boundary regression. No mainnet funds are required.

## P1 — release threat model and service profile

### Relay availability (RISK-001)

Decide whether public namespace-ID write access is acceptable for the intended release. If hardening is required, use a separate writer capability/authentication scheme, replay/version checks and bounded record repair/export recovery. Do not transmit the wallet decryption secret as authorization. Test outsider corruption/replay, reconnect, sustained bounded interference and recovery with one or more participants offline. Existing signatures protect semantic approval, not the availability of overwritten relay records.

### Private-program authority (RISK-002)

Before accepting private funds, document and independently verify the intended program/upgrade authority and governance. Decide how unrestricted owner upgrades fit the custody promise and surface that distinction at funding. Automatic private setup was explicitly requested earlier; do not silently reverse it or replace the established UI world. A documentation decision alone does not establish deployed code/authority safety.

### Browser protection (RISK-003)

Define supported unprotected-storage use and active-origin/extension threats. Keep explicit opt-out, per-share backup/passphrase and last-copy consequences accurate. Do not describe the passkey vault as protection from compromised unlocked JavaScript.

### Default service availability (RISK-005)

Choose the intended release profile. Current defaults enable Standard selection while mainnet SOL/private services remain disabled. Either make quote-only/unavailable capability explicit or provide a separately approved service configuration. Do not enable production mainnet flags merely to make an audit test pass. Revalidate both SOL→ZEC and ZEC→SOL, old/new wallets, unavailable setup, no-refund-source and connected-wallet-only behavior.

## P2 — correctness and trustworthy gates

### Network labels (AUD-003)

Use the planned/confirmed network and mode from a common state source at `setup-wizard.js:11` and `app-setup.js:87`. Preserve network authorization pins. Test every setup stage, remote joins, pending/unserved Solana and reload for both networks.

### Original test integration (AUD-004)

- Repair removed g-sol assumptions in the original creation helpers and explicitly handle automatic Solana plus Continue with Zcash. Retain protection, threshold, safety-number, share ownership, reload and recovery assertions.
- Repair the import manifest and pure/page dependency contract; a successful esbuild bridge build is not proof that the graph contract passes.
- Complete the necessary DOM adapter capabilities or inject a safe nonvisual artwork seam. Do not disable actual artwork-error assertions or count fake-DOM failures as native browser defects.
- Update the stale SOL-label assertion to the intended Confidential SOL/provider labeling while retaining asset/network/readiness checks.
- Refactor the three complexity violations under the current limits; do not raise lint limits just for the new code.
- Run the formal Node26 pipeline, not only the Node25-qualified manual substitute. Preserve failed logs and distinguish environment blocks from assertions.
- Restore the intended historical object prerequisite for the native boundary comparison or implement an equivalent reviewed baseline check; do not simply skip native invariants.

### Required CI coverage (AUD-005)

Wire `test:final-ui` and `test:receive` assertions into required browser jobs or consolidate them into the actual gate. Include native open/expand/reopen/resize/hit-test/focus checks and the newly added persistence/byte-binding regressions. Prove that a broken expanded address, wrong network label and stale save cause required failures. Keep test budgets explicit and mocks/funded tiers labeled.

### Dependencies and builds (AUD-006)

Update supported compatible Wrangler/Miniflare resolution to eliminate the observed Undici advisories; examine actual reachability and lockfile changes. Re-run public-metadata audit using credential-free npm config, build and isolated Worker tests. Establish Rust/vendor advisory checks and reproducible WASM/program artifact verification. Do not infer clean supply chain from npm's zero-advisory web result alone.

## P2 — complete monetary validation with disposable testnet assets

Prerequisites: disposable generated wallets only, supported testnet service endpoints/prover artifacts, no production credentials, bounded funding and cleanup plan. Do not reuse the existing developer wallet/profile or secrets.

Required Zcash paths: receive/scan, single/multiple recipients and memo, decoded review/proposal, independent approvals/rejections, real signature shares/aggregation, actual proof, submission, inclusion and balance update; transparent recipient where supported; wrong network/amount/address; expiry/reorg; reload during proof/send; unknown response/reconciliation; no duplicates; cold recovery before/after each critical stage.

Required Solana paths: fee funding/rent, Add SOL, private payment/public withdrawal, nonce/ATA/USDC where supported, program/chain checks, approvals/leases, local/hosted prover boundary, real execute/confirm, delayed responses, uncertain deposit/send, interrupted proof and reproof, migration and recovery. Do not substitute mock SUCCESS for actual chain evidence.

Required swaps: provider-supported test environment or explicitly scoped disposable testnet alternative; quote echo/signature/addresses/minimum/deadline, connected-wallet funding, independent approval recheck, destination evidence, failures/timeouts/partial delivery, actual refund and encrypted reload recovery. If the provider cannot supply a safe test environment, keep those production-readiness claims blocked rather than spending real funds under this audit.

Required messaging: disposable account funding, on-chain memo send/receive/contact verification, cost and request-to-proposal boundaries, multi-memo delivery and cancellation/retry. Keep its single-key custody distinct from wallet threshold funds.

## P3 — performance and platform coverage

Use the measured 19.6s fresh-context readiness on 2Mbps/150ms as a starting point, not an invented universal failure threshold. Agree a budget, profile the critical 181-request/~4.45MB path, and optimize within the current design. Retest on representative devices, constrained CPU/network, large histories and visibility transitions. Preserve clear loading and recoverable errors.

Physical verification still needed: supported screen readers, touch/mobile keyboards, OS Back/Forward/interruptions, hardware/passkey recovery/providers, actual Safari/iOS and full native/FFI builds. The 45 isolated Swift checks do not certify Keychain/biometric/native UI behavior.

## Final release decision gate

A release owner should require all of the following evidence:

1. AUD-001 and AUD-002 independently reviewed and fixed; secure-invariant tests pass without weakened expectations.
2. Correct network messaging and healthy required Node26/build/lint/browser/ceremony gates, with focused regressions executed by CI.
3. Documented and accepted relay, administrator, browser-storage and provider/prover trust model; service configuration matches advertised availability.
4. Funded disposable-testnet monetary/recovery evidence and deployment artifact/provenance checks, or a plainly restricted unfunded demonstration scope.
5. Independent wallet/cryptographic/program security review appropriate to the intended real-funds exposure; critical residual risks resolved or the release remains blocked.

Until then the decision remains **NO-GO for real-funds production**. An explicitly unfunded demonstration is a different scope and must not be presented as custody or settlement approval.
