# Production-readiness audit

**Verdict: NO-GO for an unrestricted real-funds production release.**

Audited 14 November 2026, branch `codex/near/final4`, commit `bf754639d047726adb63e8c08ebf463337699d21`. This report assesses the checked-out code, not the current public deployment. `Near` has the same tree through merge `b6543bf`; the pre-polish comparison is local tracking `origin/Near` at `4690a24`, without fetching remote state.

## Executive summary

The application has substantial working functionality and valuable security controls. Fresh isolated tests completed real bundled-WASM Zcash wallet formation, independent-browser 2-of-3 key generation, encrypted backup/check/cold restore, virtual-passkey reload/unlock, and Solana signing contracts against mocked chains. Both browser presentation matrices passed: **1,750 Chromium and 750 installed-WebKit cases**. These are useful but do not establish safe custody or funded settlement.

A **Critical secret-availability defect** remains: with explicitly delayed cross-tab storage events, a successful stale save deletes a newly added wallet key and signing share, in both unprotected and encrypted storage. Ordinary-delivery controls pass. The potential consequence is unrecoverable access when the erased material is required, unbacked-up, and the last in-memory copy is lost. No real keys or funds were used or lost.

A **High transaction-integrity defect** also remains: the Zcash submission boundary checks claimed transaction-ID metadata, not its binding to the serialized bytes, and ignores the node-returned ID. The controlled reproduction uses an inert broadcaster; it does not demonstrate forged signatures or chain acceptance of invalid transactions.

Additional confirmed issues are incorrect mainnet setup labels, failing committed test/lint gates, omitted focused regression suites in CI, and vulnerable Worker development dependencies. Separate design/configuration risks include writable relay namespaces, administrative private-program upgrade authority, optional plaintext browser storage, and default Standard-mainnet funding being unavailable. Funded proving, spending, private-pool execution, swaps/refunds, physical authenticators, and full native builds remain unverified.

### Answers to the requested readiness questions

1. **Does every feature work? No.** Some flows work under the stated test conditions; the key-loss and submission-integrity defects preclude that claim.
2. **Broken edge cases or integration regressions? Yes.** Delayed cross-tab persistence loses key material; mainnet headers misidentify Solana; original ceremony and several Node/lint checks fail after UI integrations.
3. **Security issues that could endanger funds? Yes.** AUD-001 has conditional loss-of-access/funds impact. AUD-002 leaves a material transaction-integrity boundary incomplete. Documented administrative and relay risks require separate decisions.
4. **Intuitive, consistent, reliable? Partially.** The exercised UI layouts and many interactions pass; the network-label defect, configuration availability mismatch and persistence defect prevent a general reliability claim.
5. **What must be fixed?** AUD-001 and AUD-002 first, followed by network labels and release gates; resolve or explicitly constrain the documented trust/configuration risks and validate the intended funded testnet release paths.
6. **What is unverified?** See TEST_COVERAGE.md. Important gaps are real Zcash proof/submission/finality, funded Solana/private-pool and swap/refund behavior, exact Node 26 CI, Rust rebuild/provenance/advisory checks, full native apps, physical passkeys/mobile keyboards, and independent cryptographic review.

## Scope and method

Before runtime testing, the repository structure, architecture, manifests, APIs, state/persistence, actual pages/layers, journey dependencies and merge history were inventoried in TEST_COVERAGE.md. The team then reviewed critical paths manually, ran original tests unchanged, added audit-only adversarial tests, exercised real local browser ceremonies, and tested presentation, failure, interruption and persistence cases.

Production application/configuration and existing tests were **not changed**. No branch switch, commit, merge, push or deployment occurred. Existing credential-bearing developer services were not audit targets. Temporary loopback Workers used fresh config/cwd/state, filtered environments and no repository secret files. Browser stores and key material were disposable. Chain/provider traffic was blocked except one credential-free, read-only public **Testnet GetLatestBlock** call. No faucet, real-funds operation or transaction broadcast was performed.

Evidence tiers:

- **A:** actual production persistence in fresh native-browser pages with injected event delay; real WASM formation/backup and local relay; one public testnet height read.
- **B:** production controllers/crypto modules with mock relay/chain/provider or inert dependencies; valuable boundary tests, not settlement verification.
- **C:** real renderers with synthetic facts, DOM interaction, layout and accessibility checks.
- **D:** source/history/configuration/dependency inspection; does not replace runtime proof.

## Severity-ranked confirmed defects

| ID | Severity | Category | Finding |
| --- | --- | --- | --- |
| AUD-001 | **Critical** | Reliability / Security availability | Stale cross-tab saves silently erase new wallet key/share material. |
| AUD-002 | **High** | Security integrity / Reliability | Final transaction bytes and node-returned identity are not bound to the approved transaction. |
| AUD-003 | Medium | UX / Functional | Mainnet/private-mainnet setup is labeled Solana Devnet. |
| AUD-004 | Medium | Reliability / Code Quality | Committed ceremony, import-graph, fixture and lint gates are broken. |
| AUD-005 | Medium | Reliability / Code Quality | Focused setup, Swap, messaging, identity and expanded-Receive regressions are absent from required browser CI. |
| AUD-006 | Medium | Security / Code Quality | Worker development tooling locks an affected Undici version. |

Counts: **1 Critical, 1 High, 4 Medium, 0 Low confirmed defects.** Design risks and unverified risks below are not inflated into additional proven exploits.

### AUD-001 — successful stale saves erase wallet keys and shares

- **Severity/category:** Critical; Reliability and Security availability. Critical follows the requested rule for an issue that can lead to lost funds, with the conditions below.
- **Affected journey:** create/import/restore or add wallet material in one tab while another open tab saves state; both plain and passkey-encrypted storage.
- **Location:** `web/app-keystore.js:84–95`, `120–131`, `141–155`; the source acknowledges whole-record stale-write loss at `151–152`.
- **Reproduction:** run `node audit-tests/stale-keystore-save.mjs`, then `node audit-tests/stale-keystore-browser.mjs`. Both intentionally exit 1 on the current implementation. The browser test creates fresh same-origin pages, generates inert records, tests normal delivery, then explicitly delays storage events. A adds a new wallet key/share; stale B calls actual `persist()`; queued events are subsequently released.
- **Expected:** a successful save preserves other-tab additions or refuses a stale write, while preserving nonce-burning/lock invariants.
- **Actual:** normal-event controls preserve additions in both modes. Delayed-event cases return success but delete both the new wallet key and share. Later event delivery rereads overwritten storage and cannot recover them.
- **Evidence:** native Chromium localStorage, Web Locks and actual persistence/AES-vault code; boolean-only results in `docs/audit-evidence/2026-11-14/stale-keystore-browser.log`. Supporting isolated-storage reproduction is retained separately.
- **Root cause:** serialization prevents simultaneous writers but each writer still replaces whole dictionaries from stale memory. Only once-only fields are merged; newly added items and removal tombstones are not reconciled.
- **Impact/limits:** no theft or nonce reuse was demonstrated. Natural ordinary-timing reproduction is not claimed: delayed delivery is explicit fault injection. Funds become inaccessible only if the erased key/share is necessary, no usable backup/other threshold copies remain, and the final in-memory copy closes or reloads. These are plausible normal recovery conditions, not actual losses in this audit.
- **Recommended fix:** transactional per-item/versioned persistence or merge-under-lock with explicit changes/tombstones; detect stale records and require recoverable conflict handling. Preserve existing anti-replay fields and nonce protections.
- **Regression recommendation:** retain both failing audit tests as secure-invariant tests; add ordinary/delayed/missing events, create/restore/remove concurrency, both storage modes, and cold-reload recovery checks. Never simply merge deleted keys back without versioned removal semantics.
- **Origin:** pre-existing acknowledged persistence limitation, not newly introduced by the latest visual merge.

### AUD-002 — final bytes and submitted identity are not independently bound

- **Severity/category:** High; Security integrity and Reliability.
- **Affected journey:** Zcash Submit / Resend after approval/proof completion.
- **Location:** `web/app-payments.js:404–417`, `430–446`; `wasm/src/chain.rs:1085–1093`; final-document signatures at `web/signed.js:70–72` authenticate one participant's statement rather than independently proving byte identity.
- **Reproduction:** `node audit-tests/final-transaction-binding.mjs` intentionally exits 1. It executes the actual production boundary functions unchanged in an inert VM. Approved ID A and final metadata A are supplied with unrelated opaque byte stand-in; mock broadcaster returns B.
- **Expected:** reject malformed/mismatched bytes before submission; independently derive/check transaction/network identity against the approved PCZT, and handle a node-returned mismatch explicitly.
- **Actual:** byte stand-in reaches the broadcaster; the application records claimed A and displays Submitted even when the broadcaster reports B.
- **Evidence:** portable regression and `docs/audit-evidence/2026-11-14/final-bytes-evidence.json`; source-level `broadcastTx` ignores `broadcastAnywhere`'s returned value. The Rust wrapper hex-decodes/submits but does not close this binding gap.
- **Root cause:** metadata equality is treated as transaction-byte identity. Existing app tests use placeholder serialized transactions, so their metadata checks do not prove this property.
- **Impact/limits:** the broadcaster is mocked and accepts the stand-in; a real node would reject invalid bytes. No FROST forgery, unauthorized spend or actual chain acceptance was demonstrated. A participant with final-document authority is distinct from an unauthenticated attacker. Independent chain scanning further limits false final-settlement claims, but does not repair this submission boundary.
- **Recommended fix:** expose an engine parse/hash/inspection operation for the actual serialized transaction; bind its network, ID and approved content before RPC; compare the node-reported identity and preserve an uncertain/mismatch state rather than signing a success mark under supplied metadata.
- **Regression recommendation:** known valid serialized A/B transactions with independently computed IDs; claimed A/raw B and malformed bytes must produce zero submission calls; returned B after A must not mark A submitted. Cover resend, expiry, wallet switching and final-author validation.
- **Origin:** existing explicitly unfinished boundary, rather than a new simulation or visual defect.

### AUD-003 — mainnet setup says Solana Devnet

- **Severity/category:** Medium; UX and Functional network-context clarity.
- **Affected journey:** new mainnet wallet through connect/verify/prepare and continuity status.
- **Location:** `web/setup-wizard.js:7–12`, particularly `11`; `web/app-setup.js:83–87`.
- **Reproduction:** current-UI real-WASM Mainnet 2-of-2 formation on a credential-free local Worker, Solana unavailable, fixed test birthday. Inspect the guided header and continuity panel before Continue with Zcash.
- **Expected:** actual planned mainnet/private-mainnet context, with unavailable/pending status if appropriate.
- **Actual:** verified wallet/group network is mainnet and the address has the expected `u1` prefix, but both panels say Solana Devnet.
- **Evidence:** `docs/audit-evidence/2026-11-14/current-ui-formation.json`, masked `mainnet-network-label.png`; the run produced 12 passing checks and this one failed UX assertion, with zero runtime exceptions.
- **Root cause:** hard-coded Devnet suffix depends on Solana being wanted, not its planned network.
- **Impact/limits:** confusing safety information during real-wallet setup. No wrong-chain signature or incorrect cryptographic network was demonstrated.
- **Recommended fix:** derive labels from the same planned/confirmed network/mode model; preserve authorization pins and pending-state distinctions.
- **Regression recommendation:** remote and local setup, both networks, partial/unavailable Solana, each guided stage and reload.
- **Origin:** automatic mainnet-private planning exposed a shared presentation assumption that only Devnet accompanies setup.

### AUD-004 — committed regression/lint gates are not healthy

- **Severity/category:** Medium; Reliability and Code Quality. This is a release-validation defect, not a claim that every failing fixture is a user-facing crash.
- **Affected journeys:** wallet formation/recovery release gates, dependency graph, Solana views/controllers and pricing/Receive maintenance.
- **Reproduction/evidence:** run the unchanged commands listed in TEST_COVERAGE.md. The official ceremony runner exits 1 at removed `#g-sol` (`web/openglass/single-browser-check.mjs:97`; also helper `solspike/harness/ceremony-browser.mjs:86`). Its break-on-failure skips later recovery/multidevice/passkey jobs. `node web/test/graph.mjs` reports an unlisted simulation module and a pure/page import violation. `sol-wallet-page.mjs` has an obsolete label expectation. Five FAST and three SLOW test scripts encounter missing `dataset`/`classList` in synthetic DOM artwork adapters. `bash solspike/lint.sh` fails three complexity checks.
- **Expected:** committed gates reflect the intended behavior and complete required assertions without lowering their standards.
- **Actual:** seven FAST test/integration failures, three SLOW failures, one original ceremony failure, and three lint violations. The official Node 26 FAST command also exits 2 here because only Node 25 is installed; that is a separate environment limitation.
- **Root causes:** UI/automatic-Solana/artwork/pricing integration changed assumptions without updating all manifests, fixtures and gate entrypoints. Graph failures include `app-swap-simulation.js` absent from `app.js` and `setup-wizard.js` importing page `app-icons.js`. Lint locations: `solspike/tools/nextlevel_receive_browser.mjs:66`, `cf/src/portfolio.js:17,32`.
- **Recommended fix:** adapt creation helpers to the new automatic plan without removing security assertions; fix graph/layering contracts; give inert DOM fixtures complete required capabilities or nonvisual seams; update intended label assertions; refactor complexity rather than raising limits.
- **Regression recommendation:** original Node 26/full browser gates must pass as checked in. Added current-UI audit tests cannot replace repairing the committed gate.
- **Limits/counterevidence:** unchanged native-browser code works for real local formation and recovery when independent audit-only helpers use current UI. Native DOM elements possess `dataset`; fixture crashes alone do not demonstrate browser crashes. Remote CI status was not queried.
- **Origin:** recent UI/automatic-setup integrations; source history traces major artwork assumptions to `438b691` and latest simulation/pricing/labels to `bf75463`.

### AUD-005 — important new browser regressions are not in required CI

- **Severity/category:** Medium; Reliability and Code Quality/coverage.
- **Affected journeys:** setup layout, identity, messaging, connected-wallet Swap and expanded Receive.
- **Location:** `.github/workflows/browser.yml:37–40`; `web/openglass/run-checks.mjs:7–9`; scripts in `web/package.json`.
- **Reproduction:** follow CI's `npm run test:browser --prefix web` into `run-checks.mjs`; compare against `test:final-ui` and `test:receive`.
- **Expected:** required CI runs the focused regressions used to substantiate repaired user flows.
- **Actual:** focused setup/identity/messages/Swap and expanded-Receive suites are separately callable but omitted from this required entrypoint.
- **Evidence/root cause:** command mapping and current checked-in workflow; the general matrix is not a substitute for those assertions. During this audit the omitted suites were run manually and passed under their stated fixture scope.
- **Recommended fix:** add focused regressions to required jobs or consolidate assertions into the gate, with explicit browser and time budgets.
- **Regression recommendation:** show each critical suite executes in CI and deliberately broken expanded-address/creation controls cause required-job failure.

### AUD-006 — known vulnerable Worker development dependency chain

- **Severity/category:** Medium project severity; Security/toolchain maintenance. Upstream advisories include High severities.
- **Affected journey:** local Worker/Miniflare development and CI tooling, not a demonstrated deployed Worker handler exploit.
- **Location:** `cf/package.json` devDependency and `cf/package-lock.json:1304,1420,1461`: Wrangler 4.149.0 → Miniflare 5.20261006.1-alpha → Undici 7.29.1, marked development dependencies.
- **Reproduction:** fresh empty npm user/global configs and cache; `npm audit --prefix cf --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --json`. Exit 1; three affected package nodes / eight Undici advisories. Web and solspike scans returned zero known advisories at audit time.
- **Expected:** a supported toolchain resolution without these known applicable advisories, or an explicit assessed exception.
- **Actual/evidence:** affected lockfile resolution; sanitized npm JSON and maintainer links in SECURITY_AUDIT.md. No Undici import was found in production `cf/src` handlers; Miniflare does use Undici.
- **Root cause:** locked transitive development tooling is behind the advisory fix range.
- **Recommended fix:** select compatible supported Wrangler/Miniflare updates resolving Undici at least 7.30.1 for the observed advisories; verify the exact resulting advisory scan and isolated runtime.
- **Regression recommendation:** lockfile audit and build/local Worker/browser suites after upgrade; review feature compatibility and applicable advisory preconditions.
- **Limits:** exploitability against this app was not established; special cache/agent/TLS-option preconditions must not be assumed present. Rust and manually vendored binary/source supply chains were not comprehensively advisory-scanned.

## Confirmed design behavior, configuration limits and unverified risks

These are separate from the six confirmed defects. They require release decisions, not silent redesigns during this audit.

| ID | Severity / classification | Affected flow; evidence; expected/actual and recommendation |
| --- | --- | --- |
| RISK-001 | High availability; **documented design, runtime confirmed** | Relay namespace holders can read ciphertext, overwrite a record with invalid ciphertext, reconnect to persistent corruption, and replay an older value without the encryption secret. `audit-tests/relay-capability.mjs` performed three tiny writes in one fresh random local namespace only. `cf/src/index.js:526–534,667–685` checks namespace/path/size/rate, not writer capability. This matches PRIVACY/PROTOCOL documentation. No decryption, valid approval forgery or theft demonstrated. For production availability, add separate write-capability authentication/version/repair controls without sending the decryption secret; adversarial reconnect/recovery tests are required. |
| RISK-002 | Critical fund-custody impact; **documented administrative trust, not a new exploit** | Private-mainnet approval-program upgrade authority is documented as able to replace the program and move private-wallet funds outside the wallet threshold. See `web/sol/net.js:35–37`, automatic planning in `app-shell.js`, disclosure under collapsed Setup details. Automatic setup was owner-requested; do not reverse it without a product decision. Actual deployed authority ownership/bytecode was not checked. Resolve governance/custody policy, conspicuous funding disclosure and independent review before a private-funds release. |
| RISK-003 | High sensitive-storage exposure; **explicit supported mode** | Skipping browser protection stores local wallet material in unprotected localStorage. A protected vault does not protect active unlocked JS memory from same-origin malicious code/extensions. Passkey choices and warnings were exercised; no new XSS or vault bypass was demonstrated. Define supported threat model, key-loss/recovery expectations and acceptable unprotected use. |
| RISK-004 | High release uncertainty; **not verified** | No funded Zcash proving/send/finality, Solana private program/prover/deposit/execute, plain SOL/USDC delivery or swap/refund settlement was executed. Mainnet credentials/addresses/funds were not used. Passing mocks and PCZT vectors cannot certify these operations. Require disposable, funded testnet end-to-end coverage, explicit authority review and a scoped independent security assessment. |
| RISK-005 | Medium availability; **default-profile limitation, runtime confirmed** | Default flags enable Standard Swap but disable mainnet/private SOL service. A fresh real mainnet wallet can finish Zcash setup; Standard is selectable with a mocked dry quote, but review has no refund source and Get deposit address disabled with an honest server-unavailable reason. Zero outside-wallet options remain by design. No live provider call occurs. Align release claims/UI availability with chosen service profile; do not automatically enable real-funds flags to make the test pass. |
| OBS-001 | Low performance observation; **no formal SLO established** | Fresh context on a warm isolated Worker: desktop usable/engine-ready in 460ms; emulated 2Mbps down / 150ms latency mobile in 19.6s with visible loading. About 4.45MB encoded resources / 181 requests in that mobile run. Define a startup budget, optimize critical graph/assets and measure representative devices. This is not production RUM or a claim of a universal regression. |

## Verification summary and limits

- Manually executed original FAST/SLOW commands under installed Node 25: **92 passed / 10 failed / 1 QR-reference environment block across 103 entries**. Separate security repetitions are not added to this denominator.
- Official FAST requires Node 26 and was blocked. Rust/cargo, full Xcode and independent QR-reference tooling were unavailable. Strict portfolio TypeScript checking was not executed.
- Original ceremony runner failed; independent current-UI actual-WASM formation had 12 pass / 1 network-label failure. Audit-only copies retained all original recovery (16 pass) and independent-store DKG (11 pass) assertions while adapting creation helpers; original tests were not modified or falsely marked passed.
- Bundled WASM expiry checks passed across both NU7 activation boundaries; four repository PCZT sighash goldens matched. These are not a reproducible Rust rebuild or funded network verification.
- Public Testnet GetLatestBlock returned HTTP 200, height 4,619,021, in 571ms. This proves only that read operation at audit time.
- Presentation: 2,500 Chromium/WebKit cases, 93 interaction checks, setup 215, identity/overview/Swap 48, messaging 153, Receive 58, portfolio 144; additional entry/device/text/hover results and command evidence are in TEST_COVERAGE.md.
- Native recipient/Vault logic passed 45 isolated checks using substituted Keychain/normalization adapters; physical Keychain/biometrics and native apps were not tested. The native history-boundary script is blocked by a missing historical Git object, not a demonstrated native behavior defect.

See SECURITY_AUDIT.md, UX_AUDIT.md, TEST_COVERAGE.md and REMEDIATION_PLAN.md. The verdict may be relaxed to an explicitly **unfunded demonstration** only with truthful limitations and no claim of production custody readiness; it is **not** a conditional approval for live funds.
