# Production-readiness audit: feature inventory and test coverage

Audit date: 14 November 2026. This is a fresh audit of `codex/near/final4` at `bf75463`. No application fixes, production configuration changes, commits, branch changes, deployments, or real-fund transactions are authorized during this audit.

## Preflight inventory — completed before runtime testing

The repository, application entrypoints, state/persistence architecture, service routes, run instructions, existing test runners, and relevant merge history were inspected before starting this audit's runtime tests. The inventory below is the test plan; a listed feature is **not** a claim that it works. Results and limitations will be filled from new evidence, not inherited from the earlier visual audit.

### Architecture and execution boundaries

| Component | Actual implementation and dependency |
| --- | --- |
| Web entry | `web/index.html`, OpenGlass bundle, `web/app.js`; native ES module feature renderers and event handlers, with React/OpenGlass material portals. Most wallet state is module-level state, not React state. |
| Wallet state/navigation | `app-state.js`, `app-loop.js`, `app-shell.js`, `app-links.js`, `app-groups.js`; hash routes and selected-wallet/tab state; native dialogs, DOM drawers and native top-layer popovers. |
| Zcash engine | Root Rust CLI plus `wasm/`; FROST DKG/signing, PCZT building/inspection, Halo2 proof, scanning, backup crypto; packaged WASM in `web/pkg`. |
| Solana engines | `wasm-sol/`, `web/sol/`, `web/sol/plain/`, Web Workers and pinned vectors; private pool / hosted Devnet prover versus plain mainnet SOL/USDC and mainnet private-pool approvals program. |
| Relay/API | `cf/src/index.js`: Cloudflare Worker and per-wallet SQLite Durable Object, encrypted document subscriptions/writes, leases and rate limits. Local Wrangler can emulate relay state. |
| External services | Zcash grpc-web lightwallet servers, Helius RPC/indexer/prover, key-host/proving artifacts, NEAR Intents, ZNS registry, optional CoinGecko or keyless Kraken market data, explorers and faucets. They are separate trust/availability boundaries. |
| Persistence | Optional passkey/PRF AES-GCM vault; without protection, localStorage wallet keys/shares; IndexedDB/document cache, encrypted swap/portfolio records, saved recipients/settings/drafts, per-tab and cross-tab locks, downloaded encrypted recovery files. Exact safety is subject to security assessment. |
| Native/CLI | `ios/` SwiftUI iPhone/macOS clients and Rust FFI; root CLI/engine. README excludes native clients from the current web release, but their presence and verification limits are inventoried. |
| Configuration | Default Worker: SOL=1, SOL_MAINNET=0, SOL_POOL_MAINNET=0, NEAR_LIVE=1, DEV_NO_AUTH=1. Staging differs. These are repository facts, not observations of a deployed public site. Existing developer services may contain real credentials and are not audit test environments. |

### Routes and exposed surfaces

- HTTP: entry/assets; `/ws` document relay; `/lwd/*` fixed-method grpc relay; `/zns`; `/portfolio/prices`; `/near/quote`, `/near/swap`, `/near/swap-sol-group`, `/near/swap-zec`, `/near/status`; Solana Devnet/mainnet config and gated worker/assets. Durable Object internal `/export` is an additional boundary to inspect.
- Wallet navigation: home/returning-wallet list, selected wallet/Overview, Swap, Approvals, Activity, Address book, Messages, Security/recovery, Settings; selected-wallet header, switcher, browser status, mobile menu, offline/error/loading/locked entry.
- Layers: creation/review wizard; join/QR; passkey/lock/restore; Send and payment review; Receive plus expanded address, QR, copy/share and disclosure; backup/export/check/restore/change-device; payment approval/progress/receipt drawer; recipient editor/delete; direct-chat/contact/cost/tutorial; help/education/network/privacy; Swap asset picker, slippage, details, review, simulation, privacy, deposit tracking/recovery, experimental post-quantum illustration.

## Feature and journey matrix

Status vocabulary: **Passed** (bounded evidenced checks), **Failed** (reproduced defect/test failure), **Partial** (some stages real and others simulated), **Not tested**, **Blocked** (specific unavailable dependency). The inventory was recorded before testing; statuses below now reflect the completed evidence and explicit gaps.

| ID | User journey / dependency chain | Result and actual verification boundary |
| --- | --- | --- |
| J01 | Fresh load → engine ready / loading failure → retry / offline / damaged state | **Partially tested** — real entry, offline/cancel and forced WASM failure pass; degraded mobile measured; not every deployment failure. |
| J02 | New wallet → optional passkey or explicit skip → threshold/device counts → network/names → review → create | **Partially tested** — real WASM 2-of-2 both networks + form/invalid/policy fixtures; actual Solana setup unfunded/unserved. |
| J03 | Independent devices join → exchange real DKG rounds → verify address/device membership → reveal → Overview | **Tested and passed (local/unfunded)** — three independent contexts, real 2-of-3 DKG, one distinct share/context, safety acknowledgement. |
| J04 | Single-browser played devices, mainnet concentration consent, duplicate-click guards, reload during formation | **Partially tested** — current played-device formation/reload pass; original committed runner fails removed control (AUD-004). |
| J05 | Invite/contact hash parsing, secret adoption/removal from URL, wrong/malformed invite and known-wallet mismatch | **Partially tested** — link/signature contracts pass; real local invite/join exercised; hostile external link/browser matrix not exhaustive. |
| J06 | Wallet switch/disconnect/remove-local-copy, account/network context, unreadable data and cross-tab updates | **Tested and failed** — AUD-001 cross-tab key/share loss under explicit delayed events; ordinary controls pass. |
| J07 | Enable browser protection, unlock/lock/reload, wrong/unsupported passkey, concurrent-tab and storage failures | **Partially tested** — vault/PRF/cancel/unsupported/virtual-authenticator/reload checks pass; hardware providers untested; AUD-001 persists. |
| J08 | Backup export → passphrase confirmation → save → check exact file → restore one signing share → verify scope | **Partially tested** — 16 real encrypted recovery checks and 69 payload checks pass; native/full provider parity incomplete. |
| J09 | Damaged/wrong-network/wrong-wallet/duplicate backup, interrupted restore, recovery retry and replacement | **Partially tested** — wrong/malformed/retry/cold restore pass; full device replacement/funded recovery unverified. |
| J10 | Threshold changes/device migration, old device access, unknown signer/version, verification mismatch | **Partially tested** — configuration/control and mocked migration contracts; no funded threshold/device migration. |
| J11 | Zcash chain birthday/sync/reorg/mempool → incoming/pending/available balances → errors/retry | **Partially tested** — mock sync/reorg/fallback; real public Testnet height read HTTP200; no funded wallet scan. |
| J12 | Overview assets/market prices/history, stale/missing/partial data, period switching, encrypted history and chart touch/keyboard | **Partially tested** — valuation/prices/storage/model and renderer checks; no live user portfolio/production provider certification. |
| J13 | Send/Receive asset popovers, open-menu resize/dismissal, blocked/unready asset options and destination selection | **Tested and passed (fixture scope)** — mainnet/testnet choices, native top layer, hit testing, resize, Escape and actual Receive selection. |
| J14 | Receive verified ZEC address → full disclosure → QR → exact copy/share/cancel/fallback; mainnet/testnet/changed wallet | **Partially tested** — 58 Receive interaction/layout/QR-module checks pass; independent QR reference blocked by missing qrencode. |
| J15 | Send recipient/address/network/amount/fee/memo validation, max/balance, multi-recipient/pasted list and ZIP321 requests | **Partially tested** — form/request/memo validation and mock construction; broad app script fails early; no funded build. |
| J16 | Transaction build/decoded review → propose → signed proposal verification → approve/reject/cancel/expire | **Partially tested** — signed/approval/expiry/refusal contracts and UI; no full funded Zcash authorization journey. |
| J17 | Threshold commitments/signature shares → aggregation/proof → raw transaction submission → inclusion/receipt | **Blocked for funded execution** — no testnet payment/proof/broadcast/finality; actual crypto/inspection contracts do not establish settlement. |
| J18 | Double submission, stale result, mismatched tx metadata/bytes, nonce reuse, lease races, refresh/interrupted proof/send, uncertain result | **Tested and failed / partial** — AUD-002 raw-byte/ID boundary failure; mock duplicate/lease/nonce tests pass; actual unknown-send chain recovery unverified. |
| J19 | Activity filtering, memos opt-in, populated/loading/empty/error, transaction detail and explorer identity | **Partially tested** — synthetic ledger/filters/receipts + mock-chain contracts; no live complete history/reorg finality. |
| J20 | Address book create/edit/delete/search/select, duplicate/invalid/cross-network address, device persistence/vault | **Partially tested** — form/invalid/delete/select contracts and UI pass; delayed-event persistence guarantees not certified. |
| J21 | Automatic Solana inclusion → separate key ceremony → mode acceptance/pinning, partial/unavailable setup | **Tested and failed / partial** — actual auto-plan and Continue Zcash pass; mainnet labels fail AUD-003; Solana service intentionally unavailable. |
| J22 | Devnet private SOL: fee-address funding → Add SOL → sync → private payment / public withdrawal → approvals/execution | **Partially tested** — real signing/controller contracts against mock chain/prover; no funded Devnet deposit/private spend. |
| J23 | Mainnet plain SOL/USDC: address/balance → nonce account → enable token account → validate/propose/sign/submit | **Partially tested** — actual WASM signing/nonce/token checks with mock chain; no funded SOL/USDC execution. |
| J24 | Mainnet private SOL: program/key checks → deposit → private note sync → proposal/proof/approve/execute → recovery | **Blocked for chain execution / partial** — mode/program contracts; actual program, authority, proofs and funded mainnet pool not exercised. |
| J25 | Solana malformed/mismatched network/program/amount/recipient, stale reads, rent/fees, duplicate deposit, unknown execution and retry | **Partially tested** — rejection/lease/deposit/fee/unknown-state contract coverage; actual chain outcomes unverified. |
| J26 | Swap preview: asset direction/input/slippage → dry quote/error/expiry → details/review → six-stage simulation | **Tested and passed (preview/mock scope)** — input, slippage, quote races/errors/expiry, review, simulation/pause/manual/close. |
| J27 | Standard mainnet: connected-wallet source → exact quote/addresses/consent → deposit/proposal/approval → provider tracking | **Partially tested; default-profile blocked** — real mainnet wallet + mocked dry quote selects Standard; deposit disabled due unavailable funding. |
| J28 | Confidential mainnet: partner access/mode requirement → authenticated quote/signature/echo checks → no public fallback | **Partially tested** — provider-key/mode/signature/echo/deadline/no-fallback contracts; no provider-funded execution. |
| J29 | ZEC→SOL swap: fixed recipient/refund → real payment proposal → approval checks of provider quote/deadline | **Partially tested** — fixed addresses/proposal and approver contracts; no funded ZEC→SOL delivery. |
| J30 | Swap reload/recovery/encrypted receipt/status errors/refund/uncertain delivery, mismatch and duplicate proposal guards | **Partially tested** — encrypted recovery/status/scope/duplicate mock contracts; funded receipt/refund reconciliation unverified. |
| J31 | Experimental post-quantum illustration: configure/review/approve/progress/delivery/refund; explicitly simulated | **Tested and passed (simulation only)** — configure/review/expire/approve/progress/delivery/refund render/model states; no cryptographic security claim. |
| J32 | Wallet-room messaging/payment threads, signatures, unread/changed device, draft/reply persistence, offline/reconnect | **Partially tested** — signed room/thread contracts, UI/drafts/focus; actual on-chain delivery/fees not executed. |
| J33 | Direct chat/contact links: create/join/identity/changed key/invite, malformed messages and retry | **Partially tested** — signed chat/contact/invite/key-change contracts and UI; not every remote/network schedule. |
| J34 | Single-key messaging account: create/import/backup/funding → contact-specific address → cost review → on-chain memo message | **Partially tested** — setup/funding/cost/contact fixtures and real crypto components; no funded on-chain messaging round-trip. |
| J35 | Payment requests: create/read/paste ZIP321 → prefilled Send → review; invalid, multi-recipient and no implicit authorization | **Partially tested** — request parsing/multi-payee/pre-fill/no implicit authorization contracts and UI; no funded request completion. |
| J36 | ZNS testnet resolution, registry unavailable/changed mapping and approver recheck | **Partially tested** — registry/failure/mapping-change/recheck contracts; no actual paid name-resolved transaction. |
| J37 | Settings/theme/system preference, privacy/camouflage/proxy/memo opt-in, persistence and hidden/unsupported controls | **Partially tested** — theme/settings/privacy/memo/control contracts, persistence and renderer checks; physical OS/provider matrix untested. |
| J38 | Help/FAQ/journey diagrams/onboarding, dialog close/focus/keyboard, factual capability/recovery/privacy guidance | **Partially tested** — FAQ/help layers/keyboard/content inspection; not every external destination or dynamic combination. |
| J39 | Global modal/drawer/popover/menu: open/expand/resize/reopen, focus loops/restoration, scrolling, mobile keyboard, back/forward | **Partially tested** — broad expand/reopen/resize/focus/scroll and real formation/recovery interruptions; physical keyboards and full funded Back/Forward unverified. |
| J40 | API auth/origin/method/body/path/limits, WS ciphertext/lease behavior, unauthenticated writes/replay/DoS boundaries | **Partially tested / confirmed design risk** — gate/limits/contracts and actual local ID-only relay corruption/replay RISK-001; no production abuse test. |
| J41 | Browser secret storage/encryption/randomness/XSS/CSRF/CSP/logging/URL leakage, chain/amount/signature binding | **Tested and failed / partial** — AUD-001/AUD-002; 12 security contracts pass; no independent comprehensive crypto/XSS certification. |
| J42 | Dependency/build/lint/CI/assets/WASM provenance/performance/cleanup, merge integration and deployment configuration | **Tested and failed / partial** — build pass, local lint/graph/fixtures fail; CI omission/advisory confirmed; strict TS/Rust provenance blocked. |
| J43 | Root CLI DKG/sign/build/transaction attacks and Rust engine tests | **Blocked by environment** — cargo/rustc absent; root CLI native e2e and Rust rebuild/tests not run. |
| J44 | Native iPhone/macOS release boundaries, backup/recipient parity and platform tool availability | **Partially tested / blocked** — 45 isolated Swift recipient/vault checks pass; native historical ref missing; full Xcode/native UI/FFI/physical Keychain unavailable. |

For each applicable journey, coverage must consider success, invalid input, empty/missing data, loading/pending, upstream failures/timeouts, duplicate clicks, refresh/interruption, back/forward, cancel/retry/recovery, and persistence. A fixture screenshot does not verify signing, settlement, recovery, or physical-device behavior.

## Branch and merge comparison

`Near` at `b6543bf` contains the current HEAD through a merge and has identical tree content; comparing only `Near...HEAD` would hide this branch's changes. The inspected pre-polish base is local tracking `origin/Near` at `4690a24` (no fetch or remote-state claim). Relevant recent integrations include `13dee6e`, `9b274e7`, `598412f`, `451dcd4`, `51bd1f5`, `1e0d0e0`; new commits `7d792d7` and `bf75463` modify automatic Solana setup, portfolio pricing, Swap/funding, native popovers and UI tests. Regression analysis must evaluate actual intent and functionality rather than assume the base is correct.

## Execution plan and evidence rules

- Existing Node rigs and in-memory/mock-chain tests: real engine use must be distinguished from mocked relay/chain/provider responses.
- Real local browser ceremonies: use the existing ephemeral Worker runner, whose config/state are in a temporary directory, secrets are absent and chain/provider requests are blocked. Preserve the original runner's failures.
- Browser presentation matrices and interaction suites: disposable stores/fixture modules only; classify as presentation/handler coverage.
- External services, funded chain settlement, deployed program bytecode/key ownership, physical browsers/devices and native apps remain unverified unless actual permitted evidence is obtained.
- Never use the existing credential-bearing developer app for audit transactions; do not run the default baseline runner that loads `cf/.dev.vars`.
- Command outputs, exit codes, screenshots and machine-readable results are retained under `/private/tmp/zigs-production-audit/` (test-specific evidence paths will be recorded). Synthetic secret/backup contents are not included in reports.

## Commands and observed results

The preflight inventory above preceded execution. Results below are from this audit, not copied from the earlier UI-polish report. All existing tests remain unchanged.

### Environment and evidence tiers

- Node **25.6.1**, npm **11.9.0**, local Chrome and an installed WebKit engine. Repository CI/official FAST requires **Node 26**, which was not installed; manually executed Node 25 results are not called an official Node 26 pass.
- Rust/cargo and cargo-audit absent; TypeScript compiler and qrencode absent. Xcode command resolves to CommandLineTools only, not full Xcode. Swift compiler ran the isolated recipient/vault test.
- **Real crypto/local protocol:** bundled WASM DKG, independent browser stores, backup crypto, virtual PRF unlock, expiry/PCZT vectors; local relay only, fixed birthday4500000. **Real external read:** one public testnet GetLatestBlock, no wallet data.
- **Mock-backed execution:** Node controllers/signing rigs use in-memory relay/fake DOM and mocked chains/provers/providers. In particular app.mjs stubs finalize to placeholder bytes and replaces package/share/combine recorder calls; passing it would not prove Zcash proof execution.
- **Presentation:** 125 synthetic-state renderer scenes; native DOM events/focus/layout asserted against those facts. This does not test funded settlement.
- Temporary local Workers were started from new config/cwd/state with filtered environment, no repository secret files, and external chain/provider requests blocked. Both were stopped and temporary state removed. The portable audit-only `isolated-worker.mjs` helper was then startup-checked on a third fresh loopback Worker and its bounded relay characterization passed; it was also stopped and its temporary state removed. Its initial restricted-sandbox listen EPERM is an environment limitation; the loopback-permitted run passed. The existing localhost8788 developer service was not used for audit wallet operations.
- Complete transient logs/screenshots remain under `/private/tmp/zigs-production-audit/`; selected durable, secret-free evidence is under `docs/audit-evidence/2026-11-14/`. No backup files or browser profiles are published.

### Command ledger: major runs

| Actual command / execution | Observed result | Evidence / classification |
| --- | --- | --- |
| `npm run build --prefix web` | Pass; esbuild about35ms;287.3KB JS/148.0KB CSS | Ignored output only; not full typechecking. |
| `sh scripts/test-fast.sh` | Exit2: requires Node26, installed25.6.1 | `fast-official.log`; environment block, not a fabricated pass. |
| Manual86 unchanged FAST entries, three lanes, per-test65s cap | Final78pass/7fail/1QR environment block | Exact per-command rows below; two restricted-sandbox failures passed unchanged on loopback-permitted rerun. |
| Manual17 unchanged SLOW entries via deny-external-fetch preload, three lanes,600s cap | 14pass/3fixture failures/0timeouts | `slow-results.json`; real-crypto versus mock boundary stated above. |
| `bash solspike/lint.sh` | Exit1, three complexity violations | Receive matrix12>8; Kraken mapper14>8; price load12>8. Subsequent unexecuted checks not assumed passed. |
| `node web/openglass/ceremony-check.mjs` | Exit1 waiting removed g-sol control; later jobs skipped by runner | `ceremony-original.log`; original gate remains failed. |
| `node /private/tmp/zigs-production-audit/current-ui-formation.mjs` | 12pass/1AUD-003 label failure/0runtime errors | Actual WASM2of2 both networks, Continue Zcash/reload, no sessions or transactions. |
| Audit-only current-UI copies of recovery-check/multidevice-check | 16 and11 assertions pass | Original assertions retained; only obsolete create/ready helper adapted. Original gates were not changed or marked passed. |
| `OPENGLASS_AUDIT_OUTPUT=.../ui-matrix ZIGS_CAPTURE_MATRIX=1 node web/openglass/flow-audit.mjs` | 125states/1750cases/0issues/0runtime errors | Fresh Chromium renderer fixtures; seven widths/both themes. |
| `WEBKIT_EXECUTABLE=.../webkit-2336/pw_run.sh ZIGS_BROWSER=webkit ZIGS_BROWSER_SMOKE=1 OPENGLASS_AUDIT_OUTPUT=.../webkit-matrix node web/openglass/flow-audit.mjs` | 125states/750cases/0issues/0runtime errors | Installed WebKit, widths320/1024/1440,both themes; not physical Safari/iOS. |
| `node solspike/tools/portfolio_browser.mjs` | 144pass | Real DOM chart touch capture/cancel, keyboard, retry and encrypted-history checks with fixture facts; `portfolio-browser.log`. |
| `node web/openglass/interaction-check.mjs` | 93pass | Native form/dialog/focus/navigation contracts on disposable fixtures. |
| `npm run test:final-ui --prefix web` | Pass: setup215,identity/chart/Swap48,messaging153; focused Swap journey pass | No funds; fixture facts. |
| `node solspike/tools/nextlevel_receive_browser.mjs` | 58pass | Collapsed/expanded address,5widths,both networks/themes,copy/share failure/keyboard/QR-module geometry. Independent reference QR blocked separately. |
| `node web/openglass/welcome-check.mjs` | 54pass | Sampled rendered contrast/artwork/preferences; not all-app WCAG certification. |
| `node web/openglass/local-devices-check.mjs` | 145pass | Synthetic local device-control handlers and state. |
| `node web/openglass/security-text-check.mjs` | 37pass | Includes200% computed text enlargement. |
| `node web/openglass/button-hover-check.mjs` | 33pass; p95frame16.7ms,no long tasks/child DOM mutations | Local headless90frame synthetic pointer sample, not hardware benchmark. |
| `ZIGS_AUDIT_ORIGIN=http://localhost:55954 node audit-tests/browser-readiness.mjs` | Corrected run: desktop ready460ms; emulated2Mbps/150ms mobile19.6s; forcedWASM503 visible failure444ms;0runtime errors;offline/cancel pass | Real entry/local Worker, fresh stores; no wallet/chain/provider credentials. Earlier probe failure was audit interceptor incorrectly matching zns.js; log preserved, blocker corrected to exact API paths. Not a product failure. |
| `node audit-tests/stale-keystore-save.mjs` | Exit1 secure invariant fails | Confirmed AUD-001, generated/inert storage only. |
| `node audit-tests/stale-keystore-browser.mjs` | Exit1 secure invariant fails; normal plain/sealed controls pass, delayed cases lose both items | Actual native storage/Web Locks/AES; explicit delayed-event injection. |
| `node audit-tests/final-transaction-binding.mjs` | Exit1 secure invariant fails | AUD-002, actual boundary code/inert dependencies; no real-chain invalid-byte acceptance claim. |
| `node audit-tests/relay-capability.mjs ws://localhost:55954` | Exit0 characterization confirms ID-only read/corrupt/replay | Three tiny writes, random disposable namespace; RISK-001 documented design, not theft. |
| Empty npmconfigs/cache: `npm audit --prefix web/cf/solspike --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --json` | web0known;solspike0known;cfexit1,3affected devpackage nodes/8Undici advisories | Public metadata only, no npm credential configuration; no dependency/install/lock changes. |
| `python3 ios/check-recipients.py` | 45pass | Isolated Keychain/normalization adapters and real Swift record/AES logic; no physical Keychain/biometrics/network. |
| `python3 ios/check-ui-boundaries.py` | Cannot compare: missing historical Git object33645815…; childgitexit128 | History prerequisite block, not a proved native runtime violation. |
| `xcodebuild -version` | Full Xcode unavailable; activeCommandLineTools only | Native UI/FFI build blocked. |
| Bundled WASM expiry/PCZT inspections | 4boundary checks and4golden sighashes pass | Consensus configuration/vector coverage only, no funded proof/broadcast. |
| Public Testnet GetLatestBlock, fixed emptyChainSpec | HTTP200,65bytes,height4619021,571ms | No credentials/address/faucet/transaction. Upstream read reachability only. |
| Second temporary Worker matching default flags + actual new mainnet wallet + mocked dry quote | Standard selectable but deposit disabled with explicit unavailable-funding reason;0outside choices | `default-standard.json`; same knownDevnet-label assertion fails,0runtime errors. No provider/deposit calls. |

### Original Node command results (not the official Node26 gate)

Final qualified totals: **103 entries:92pass,10test/integration failures,1QR reference environment block.** Scoped security reruns overlap these entries and are not added to that denominator. Individual original tests were not edited. The original app,sol-app,sol-ceremony failures stop their own later scenarios; those scenarios remain unverified by those runs.


| Entry / actual script | Exit and final classification | Seconds | Evidence log |
| --- | --- | ---: | --- |
| `web/test/chain-fallback.mjs` | exit0 / Pass (Node25) | 4.95 | `/private/tmp/zigs-production-audit/merge-fast/chain-fallback.log` |
| `web/test/optional-passkey.mjs` | exit0 / Pass (Node25) | 5.62 | `/private/tmp/zigs-production-audit/merge-fast/optional-passkey.log` |
| `web/test/backup-check.mjs` | exit0 / Pass (Node25) | 1.58 | `/private/tmp/zigs-production-audit/merge-fast/backup-check.log` |
| `web/test/graph.mjs` | exit1 / Fail (see AUD-004) | 0.33 | `/private/tmp/zigs-production-audit/merge-fast/graph.log` |
| `web/test/personal.mjs` | exit0 / Pass (Node25) | 1.22 | `/private/tmp/zigs-production-audit/merge-fast/personal.log` |
| `web/test/chat.mjs` | exit0 / Pass (Node25) | 4.32 | `/private/tmp/zigs-production-audit/merge-fast/chat.log` |
| `web/test/sol-rent.mjs` | exit0 / Pass (Node25) | 0.90 | `/private/tmp/zigs-production-audit/merge-fast/sol-rent.log` |
| `web/test/sol-receive.mjs` | exit0 / Pass (Node25) | 0.16 | `/private/tmp/zigs-production-audit/merge-fast/sol-receive.log` |
| `web/test/sol-config.mjs` | exit1 / Fail (see AUD-004) | 0.81 | `/private/tmp/zigs-production-audit/merge-fast/sol-config.log` |
| `web/test/sol-errors.mjs` | exit0 / Pass (Node25) | 0.86 | `/private/tmp/zigs-production-audit/merge-fast/sol-errors.log` |
| `web/test/sol-sdk.mjs` | exit0 / Pass (Node25) | 0.85 | `/private/tmp/zigs-production-audit/merge-fast/sol-sdk.log` |
| `web/test/sol-addsol.mjs` | exit0 / Pass (Node25) | 1.51 | `/private/tmp/zigs-production-audit/merge-fast/sol-addsol.log` |
| `web/test/sol-pool-mainnet.mjs` | exit0 / Pass (Node25) | 1.65 | `/private/tmp/zigs-production-audit/merge-fast/sol-pool-mainnet.log` |
| `web/test/messaging-presentation.mjs` | exit0 / Pass (Node25) | 0.15 | `/private/tmp/zigs-production-audit/merge-fast/messaging-presentation.log` |
| `web/test/messaging-cost-review.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/messaging-cost-review.log` |
| `web/test/guided-create.mjs` | exit0 / Pass (Node25) | 0.68 | `/private/tmp/zigs-production-audit/merge-fast/guided-create.log` |
| `web/test/premium-motion.mjs` | exit0 / Pass (Node25) | 0.05 | `/private/tmp/zigs-production-audit/merge-fast/premium-motion.log` |
| `web/test/homepage-motion.mjs` | exit0 / Pass (Node25) | 0.04 | `/private/tmp/zigs-production-audit/merge-fast/homepage-motion.log` |
| `web/test/messaging-account-view.mjs` | exit0 / Pass (Node25) | 0.21 | `/private/tmp/zigs-production-audit/merge-fast/messaging-account-view.log` |
| `web/test/outcome-seal.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/outcome-seal.log` |
| `web/test/wallet-description.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/wallet-description.log` |
| `web/test/guided-setup.mjs` | exit0 / Pass (Node25) | 0.13 | `/private/tmp/zigs-production-audit/merge-fast/guided-setup.log` |
| `web/test/local-devices.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/local-devices.log` |
| `web/test/passkey-setup.mjs` | exit0 / Pass (Node25) | 0.25 | `/private/tmp/zigs-production-audit/merge-fast/passkey-setup.log` |
| `web/test/recipients.mjs` | exit0 / Pass (Node25) | 0.14 | `/private/tmp/zigs-production-audit/merge-fast/recipients.log` |
| `web/test/swap-recovery.mjs` | exit0 / Pass (Node25) | 0.10 | `/private/tmp/zigs-production-audit/merge-fast/swap-recovery.log` |
| `web/test/swapflow.mjs` | exit0 / Pass (Node25) | 0.17 | `/private/tmp/zigs-production-audit/merge-fast/swapflow.log` |
| `web/test/near-confidential.mjs` | exit0 / Pass (Node25) | 0.06 | `/private/tmp/zigs-production-audit/merge-fast/near-confidential.log` |
| `web/test/hackathon-swap.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/hackathon-swap.log` |
| `web/test/swap-preview.mjs` | exit0 / Pass (Node25) | 0.50 | `/private/tmp/zigs-production-audit/merge-fast/swap-preview.log` |
| `web/test/payees.mjs` | exit0 / Pass (Node25) | 0.07 | `/private/tmp/zigs-production-audit/merge-fast/payees.log` |
| `web/test/vault.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/vault.log` |
| `web/test/lwd.mjs` | exit0 / Pass (Node25) | 0.11 | `/private/tmp/zigs-production-audit/merge-fast/lwd.log` |
| `web/test/zns.mjs` | exit0 / Pass (Node25) | 0.20 | `/private/tmp/zigs-production-audit/merge-fast/zns.log` |
| `web/test/near-quote.mjs` | exit0 / Pass (Node25) | 0.12 | `/private/tmp/zigs-production-audit/merge-fast/near-quote.log` |
| `web/test/shim.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/shim.log` |
| `web/test/requests.mjs` | exit0 / Pass (Node25) | 0.06 | `/private/tmp/zigs-production-audit/merge-fast/requests.log` |
| `web/test/signed.mjs` | exit0 / Pass (Node25) | 0.08 | `/private/tmp/zigs-production-audit/merge-fast/signed.log` |
| `web/test/shim-status.mjs` | exit0 / Pass (Node25) | 0.10 | `/private/tmp/zigs-production-audit/merge-fast/shim-status.log` |
| `web/test/util.mjs` | exit0 / Pass (Node25) | 0.06 | `/private/tmp/zigs-production-audit/merge-fast/util.log` |
| `web/test/qr.mjs` | exit1 / Blocked: qrencode missing | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/qr.log` |
| `web/test/sol-docs.mjs` | exit0 / Pass (Node25) | 0.05 | `/private/tmp/zigs-production-audit/merge-fast/sol-docs.log` |
| `web/test/account.mjs` | exit0 / Pass (Node25) | 0.21 | `/private/tmp/zigs-production-audit/merge-fast/account.log` |
| `web/test/sol-transfer.mjs` | exit0 / Pass (Node25) | 0.17 | `/private/tmp/zigs-production-audit/merge-fast/sol-transfer.log` |
| `web/test/sol-wasm.mjs` | exit0 / Pass (Node25) | 0.27 | `/private/tmp/zigs-production-audit/merge-fast/sol-wasm.log` |
| `web/test/mainnet-on.mjs` | exit0 / Pass (Node25) | 1.84 | `/private/tmp/zigs-production-audit/merge-fast/mainnet-on.log` |
| `web/test/sol-plain-app.mjs` | exit0 / Pass (Node25) | 5.33 | `/private/tmp/zigs-production-audit/merge-fast/sol-plain-app.log` |
| `web/test/mempool.mjs` | exit0 / Pass (Node25) | 10.12 | `/private/tmp/zigs-production-audit/merge-fast/mempool.log` |
| `web/test/sol-mode.mjs` | exit0 / Pass (Node25) | 4.76 | `/private/tmp/zigs-production-audit/merge-fast/sol-mode.log` |
| `web/test/sol-start-watch.mjs` | exit0 / Pass (Node25) | 3.29 | `/private/tmp/zigs-production-audit/merge-fast/sol-start-watch.log` |
| `web/test/sol-wallet-page.mjs` | exit1 / Fail (see AUD-004) | 0.86 | `/private/tmp/zigs-production-audit/merge-fast/sol-wallet-page.log` |
| `web/test/sol-private.mjs` | exit0 / Pass (Node25) | 6.78 | `/private/tmp/zigs-production-audit/merge-fast/sol-private.log` |
| `web/test/sol-plain-view.mjs` | exit1 / Fail (see AUD-004) | 1.09 | `/private/tmp/zigs-production-audit/merge-fast/sol-plain-view.log` |
| `web/test/sol-plain-load.mjs` | exit1 / Fail (see AUD-004) | 0.62 | `/private/tmp/zigs-production-audit/merge-fast/sol-plain-load.log` |
| `web/test/sol-plain-security.mjs` | exit0 / Pass (Node25) | 1.71 | `/private/tmp/zigs-production-audit/merge-fast/sol-plain-security.log` |
| `web/test/sol-plain-review.mjs` | exit0 / Pass (Node25) | 0.08 | `/private/tmp/zigs-production-audit/merge-fast/sol-plain-review.log` |
| `web/test/sol-plain-direct.mjs` | exit1 / Fail (see AUD-004) | 0.67 | `/private/tmp/zigs-production-audit/merge-fast/sol-plain-direct.log` |
| `web/test/sol-plain-reads.mjs` | exit0 / Pass (Node25) | 6.04 | `/private/tmp/zigs-production-audit/merge-fast/sol-plain-reads.log` |
| `web/test/sol-plain-ui.mjs` | exit1 / Fail (see AUD-004) | 0.66 | `/private/tmp/zigs-production-audit/merge-fast/sol-plain-ui.log` |
| `web/test/smoke.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/smoke.log` |
| `web/test/help.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/help.log` |
| `web/test/contrast.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/contrast.log` |
| `web/test/orientation.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/orientation.log` |
| `web/test/overview.mjs` | exit0 / Pass (Node25) | 0.07 | `/private/tmp/zigs-production-audit/merge-fast/overview.log` |
| `web/test/portfolio.mjs` | exit0 / Pass (Node25) | 0.06 | `/private/tmp/zigs-production-audit/merge-fast/portfolio.log` |
| `web/test/setup-stage.mjs` | exit0 / Pass (Node25) | 0.04 | `/private/tmp/zigs-production-audit/merge-fast/setup-stage.log` |
| `web/test/approvals.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/approvals.log` |
| `web/test/recovery.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/recovery.log` |
| `web/test/security-dashboard.mjs` | exit0 / Pass (Node25) | 0.04 | `/private/tmp/zigs-production-audit/merge-fast/security-dashboard.log` |
| `web/test/payment-model.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/payment-model.log` |
| `web/test/error-feedback.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/error-feedback.log` |
| `web/test/proposal-history.mjs` | exit0 / Pass (Node25) | 0.03 | `/private/tmp/zigs-production-audit/merge-fast/proposal-history.log` |
| `web/test/sol-plain-sessions.mjs` | exit0 / Pass (Node25) | 4.97 | `/private/tmp/zigs-production-audit/merge-fast/sol-plain-sessions.log` |
| `cf/test/gate.mjs` | exit0 / Pass (Node25) | 0.08 | `/private/tmp/zigs-production-audit/merge-fast/cf_test_gate.log` |
| `web/test/sol-nonce-tabs.mjs` | exit0 / Pass (Node25) | 0.06 | `/private/tmp/zigs-production-audit/merge-fast/sol-nonce-tabs.log` |
| `web/test/plain-worker.mjs` | exit0 / Pass (Node25) | 4.20 | `/private/tmp/zigs-production-audit/merge-fast/plain-worker.log` |
| `web/test/no-storage.mjs` | exit0 / Pass (Node25) | 0.20 | `/private/tmp/zigs-production-audit/merge-fast/no-storage.log` |
| `web/test/sync-pause.mjs` | exit0 / Pass (Node25) | 2.15 | `/private/tmp/zigs-production-audit/merge-fast/sync-pause.log` |
| `solspike/test/pool-run.test.mjs` | exit0 / Pass (Node25) | 0.04 | `/private/tmp/zigs-production-audit/merge-fast/solspike_test_pool-run.test.log` |
| `solspike/test/policy.test.mjs` | exit0 / Pass (Node25) | 0.06 | `/private/tmp/zigs-production-audit/merge-fast/solspike_test_policy.test.log` |
| `web/test/nonce-locks.mjs` | exit0 / Pass (Node25) | 6.00 | `/private/tmp/zigs-production-audit/merge-fast/nonce-locks.log` |
| `solspike/test/worker.test.mjs` | exit1 initially; unchanged loopback-permitted rerun exit0 / Pass | 0.10 | `/private/tmp/zigs-production-audit/merge-fast/solspike_test_worker.test.log` |
| `solspike/test/worker-schema.test.mjs` | exit0 initially; unchanged loopback-permitted rerun exit0 / Pass | 1.07 | `/private/tmp/zigs-production-audit/merge-fast/solspike_test_worker-schema.test.log` |
| `solspike/test/mainnet-proof.test.mjs` | exit0 / Pass (Node25) | 0.06 | `/private/tmp/zigs-production-audit/merge-fast/solspike_test_mainnet-proof.test.log` |
| `solspike/test/plain-equiv.test.mjs` | exit0 / Pass (Node25) | 5.71 | `/private/tmp/zigs-production-audit/merge-fast/solspike_test_plain-equiv.test.log` |
| `web/test/demo-check.mjs` | exitSIGTERM initially; unchanged loopback-permitted rerun exit0 / Pass | 65.00 | `/private/tmp/zigs-production-audit/merge-fast/demo-check.log` |
| `web/test/sol-fee.mjs` (deny-external preload) | exit0 / Pass (Node25) | 6.40 | `/private/tmp/zigs-production-audit/slow-sol-fee.log` |
| `web/test/sol-limits.mjs` (deny-external preload) | exit0 / Pass (Node25) | 16.67 | `/private/tmp/zigs-production-audit/slow-sol-limits.log` |
| `web/test/app.mjs` (deny-external preload) | exit1 / Fail (fixture; AUD-004) | 26.77 | `/private/tmp/zigs-production-audit/slow-app.log` |
| `web/test/sol-app.mjs` (deny-external preload) | exit1 / Fail (fixture; AUD-004) | 1.28 | `/private/tmp/zigs-production-audit/slow-sol-app.log` |
| `web/test/sol-ceremony.mjs` (deny-external preload) | exit1 / Fail (fixture; AUD-004) | 11.30 | `/private/tmp/zigs-production-audit/slow-sol-ceremony.log` |
| `web/test/sol-sessions.mjs` (deny-external preload) | exit0 / Pass (Node25) | 34.56 | `/private/tmp/zigs-production-audit/slow-sol-sessions.log` |
| `web/test/sol-pay-exec.mjs` (deny-external preload) | exit0 / Pass (Node25) | 51.24 | `/private/tmp/zigs-production-audit/slow-sol-pay-exec.log` |
| `web/test/sol-pay.mjs` (deny-external preload) | exit0 / Pass (Node25) | 64.47 | `/private/tmp/zigs-production-audit/slow-sol-pay.log` |
| `web/test/sol-pay-seats.mjs` (deny-external preload) | exit0 / Pass (Node25) | 59.48 | `/private/tmp/zigs-production-audit/slow-sol-pay-seats.log` |
| `web/test/sol-pay-end.mjs` (deny-external preload) | exit0 / Pass (Node25) | 32.69 | `/private/tmp/zigs-production-audit/slow-sol-pay-end.log` |
| `web/test/sol-pay-lease.mjs` (deny-external preload) | exit0 / Pass (Node25) | 54.60 | `/private/tmp/zigs-production-audit/slow-sol-pay-lease.log` |
| `web/test/sol-pay-look.mjs` (deny-external preload) | exit0 / Pass (Node25) | 49.73 | `/private/tmp/zigs-production-audit/slow-sol-pay-look.log` |
| `web/test/sol-prove.mjs` (deny-external preload) | exit0 / Pass (Node25) | 3.12 | `/private/tmp/zigs-production-audit/slow-sol-prove.log` |
| `web/test/unified-setup.mjs` (deny-external preload) | exit0 / Pass (Node25) | 23.75 | `/private/tmp/zigs-production-audit/slow-unified-setup.log` |
| `web/test/sol-swap-proposal.mjs` (deny-external preload) | exit0 / Pass (Node25) | 1.30 | `/private/tmp/zigs-production-audit/slow-sol-swap-proposal.log` |
| `web/test/sol-plain-ceremony.mjs` (deny-external preload) | exit0 / Pass (Node25) | 13.44 | `/private/tmp/zigs-production-audit/slow-sol-plain-ceremony.log` |
| `web/test/sol-plain-sign.mjs` (deny-external preload) | exit0 / Pass (Node25) | 116.69 | `/private/tmp/zigs-production-audit/slow-sol-plain-sign.log` |

## Coverage of requested failure dimensions

| Dimension | Strongest new evidence | What this does not establish |
| --- | --- | --- |
| Normal successful paths | Actual local formation/recovery/multidevice; real signing contracts and many native renderer handlers | Funded chain/provider success |
| Invalid input | Address/amount/memo/request/signature/network/malformed-backup contracts; browser invalid forms | Every possible malicious input or independent crypto audit |
| Empty/missing/loading |125renderer states; unservedSolana; engine503; failedquotes and mocked chain/errors | All deployed infrastructure failure modes |
| API/timeouts/network | Offline/reconnect/local failures, controller timeouts, public testnet read | Production credentials/infrastructure, funded uncertain-send recovery |
| Duplicate/repeated actions | Nonce locks, leases, proposal guards, disabled/busy and ceremony checks | Every browser/process crash schedule |
| Refresh/interruption | Real formation/recovery reload; encrypted receipt models; stale persistence fault | AUD-001 passes only normal controls, delayed case fails; full funded restarts absent |
| Back/Forward/navigation | Native navigation/focus/cancel tests, hash-link contracts, wallet reload | Full monetary Back/Forward journey matrix and physical OS navigation |
| Cancel/retry/recovery | Virtual passkey cancellation, backup/check wrongpassphrase, share failure, engine/offline recovery | Physical biometric recovery, actual chain/provider refunds |
| Persistence/state | Real storage/AES tests and observed critical conflict; portfolio/recipient/chat contracts | Universal durability, cross-device recovery or safe stale saves |

## Explicitly not verified / blocked

No actual funded Zcash proof/send/finality/reorg, funded Solana deposit/private execution/plain token delivery, provider-funded swap/refund delivery, on-chain message round-trip, deployed program/upgrade-authority inspection, production credential restriction check, full independent ASVS/cryptography/program audit, physical passkey/mobile OS keyboard/screen-reader certification, full native apps/FFI or Rust reproducible builds/advisory scan. Native CLI and required Node26/strict TypeScript/independent QR-reference gates were blocked by the stated tools/history prerequisites. No claim that a blocked or mocked feature is production-working is made.

No application functional or visual fixes were made during this audit. New tests are under audit-tests; three secure-invariant tests intentionally fail until their defects are repaired. Do not remove or weaken those assertions to obtain a green result.
