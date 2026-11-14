# Flow-by-flow UX and interaction audit

14 November 2026 — `codex/near/final4` at `bf75463`.

**UX conclusion:** the exercised interface is generally coherent and responsive, but good presentation does not establish reliable wallet custody. AUD-001 is a severe persistence failure that can invalidate otherwise reassuring success feedback; AUD-003 is confirmed network-context misinformation. Release gates and real-funds journeys remain incomplete. **Do not treat the passing visual matrix as production approval.**

The established visual language was preserved. No styling, functional behavior, copy or production configuration was changed during this audit. Recommendations below concern correctness, interaction, clarity and accessibility, not a redesign.

## Method and evidence tiers

Before testing, 44 journey groups and their dependencies were inventoried in TEST_COVERAGE.md. Fresh browser presentation used actual renderers with synthetic state; native interactions covered menus, forms, keyboard, modal focus and responsive sizes. Separate actual-WASM/local-relay browser tests covered formation, backup/recovery and independent browser stores. Chain/provider operations were blocked or mocked, except a read-only public testnet height request. Default-profile Standard availability was checked with only a dry-price response mocked.

New results, not inherited earlier claims:

- 125 presentation states × seven widths × two themes = **1,750 Chromium cases**; 125 × three widths × two themes = **750 installed-WebKit cases**, zero recorded layout/label/theme/runtime failures in their checked scope.
- **93 interaction checks**, **215 setup checks**, **48 identity/chart/Swap checks**, **153 messaging-layout checks**, **58 Receive checks**.
- **54 welcome checks**, **145 local-device checks**, **37 security-text checks** including 200% text, **33 hover/control checks**.
- Current real-WASM formation: **12 pass, one network-label failure**. Adapted audit-only recovery: **16 pass**; independent-store DKG: **11 pass**, with original assertions retained. The checked-in ceremony runner itself failed before those later jobs.
- Fresh real entry: desktop ready 460ms; emulated 2Mbps/150ms mobile ready 19.6s with visible loading. Engine HTTP 503 produced an explicit visible failure banner; offline feedback and cancelling Create returned to Home. These are local measurements, not field performance or physical-mobile certification.

## Flow assessments

| Flow and goal | Exercised path and result | Friction, ambiguity and remaining work |
| --- | --- | --- |
| Home / loading / damaged / offline | Real entry, synthetic damaged/loading/error states, engine failure and offline transitions. Clear loading/failure feedback; no measured horizontal overflow in tested entry sizes. | Mobile constrained-network readiness took 19.6s. Define a target and keep navigation/recovery understandable while loading. A diagnostic test initially blocked zns.js through its own broad interceptor; corrected and rerun, not a product failure. |
| Create / browser protection choice | Protect or explicitly skip, threshold/device count, 2-of-2 warning acknowledgement, network/names/review; real unfunded 2-of-2 formation on both networks. | Protection choice is genuine: Skip implies unprotected at-rest local storage. Avoid presenting a visually complete wizard as proof of separate-device protection. Optional backups mean AUD-001 can have last-copy consequences. |
| Automatic Solana / guided preparation | Actual default plan, pending/unserved Solana, Continue with Zcash, Overview and reload. Zcash is not blocked by unavailable Solana. | **AUD-003:** mainnet/private-mainnet setup header and continuity say Solana Devnet. Derive the label from actual mode/network, including unavailable status. Do not alter security pins or silently undo owner-requested automatic setup. |
| Join independent devices / verify | Three disposable browser stores, real 2-of-3 DKG, mandatory 30-digit acknowledgement, one verified shared address and one share per context. | Safety-number confirmation remains a human verification boundary. Replaced/malicious physical devices and every interrupted network schedule were not certified. |
| Played devices in one browser | Mainnet concentration consent and local threshold choices exercised; local shares and reload behavior checked. | Local played devices are separate shares, not independent physical security. Keep concentration consequences evident; do not imply that two clicks prove two independent devices. |
| Save/exit/reload setup | Current audit helper resumes preparation; real verified shares/guide restore after reload and Continue with Zcash. | Original checked-in helpers still expect removed g-sol controls, leaving release coverage broken (AUD-004). An adapted audit helper demonstrates functionality but does not repair the gate. |
| Wallet switching / navigation | Fixture navigation, mobile menu, selected-wallet context and modal restoration checks passed; actual tested wallet reload returns to Overview. | Hash routing/replaced state differs from a full per-tab browser-history router. Full Back/Forward combinations through every interrupted monetary operation remain partial. Do not certify those from a navigation click test. |
| Protect / unlock / lock | Virtual PRF authenticator flows, unsupported/cancelled choices, reload/unlock and cross-tab contracts passed. | Hardware authenticator, Safari/iOS provider and OS recovery behavior remain unverified. A sealed vault still suffers AUD-001's record-loss defect. |
| Backup / check file | Real WASM encrypted export; mismatched passphrase prevents download; wrong file/passphrase retries; checking the right file does not mutate signing material. | Saving a download, checking that file, and another device's backup claim are distinct. Retain explicit per-share/passphrase scope. No actual backup contents are included in audit evidence. |
| Cold restore / malformed file | Malformed/wrong restore imports no share; real encrypted cold restore restores one original share and works after protected reload. | Device migration, every legacy/native backup version and physical lost-device recovery are not fully certified. AUD-001 must be repaired before last-copy reassurance is credible. |
| Device changes / wallet migration | Configuration, warning and local-device controls plus mocked protocol contracts assessed. | Complete funded migration and replacement execution not tested; old devices' viewing access and copied-share versus independent-approval differences need to remain explicit. |
| Overview / assets / portfolio | Asset rows, availability states, chart/model/pricing errors and encrypted-history contracts; period and keyboard/touch behavior in fixtures; 144 fresh portfolio-browser checks passed. | Prices and history are observations, not a recovered historical market account. Provider outage/stale values must remain differentiated from zero. Actual fresh portfolio TypeScript gate was unavailable. |
| Send/Receive asset menu | Native top-layer menus in mainnet/testnet fixtures, hit testing, Escape, resizing an already-open panel and actual ZEC Receive selection passed. | Disabled/unavailable choices should continue to name the dependency, not look like an empty menu. Focused regression is omitted by required CI (AUD-005). |
| Receive | Full address expansion, QR integer-module sizing, exact clipboard data, Share/cancel/denied fallback, keyboard, both networks and five widths passed. | Independent QR reference decoding is blocked by missing qrencode. Phone/testnet guidance may normally scroll; full address/financial data must not be clipped to force a single page. |
| Send form / multi-payee / request | Real renderer editing and validation, memo/amount/request modules and contracts, with mock balances/chain/transaction building. | A successful form response does not verify funded construction or on-chain outcome. The broad app integration script stops early on its synthetic DOM failure; later scenarios are not passed by that run. |
| Review / approvals / reject / cancel | Decoded review and approval state renderers, signed-document and nonce contracts, pending/error/expired states exercised. | Full monetary end-to-end approval/proof/send was not executed. AUD-002 undermines the transition from approved ID to submitted bytes even when the review itself is correct. |
| Sign / proof / submit / receipt | Selected real Solana WASM signature contracts pass with mock chain; Zcash transaction inspection/expiry goldens match. Receipt/loading/error renderers pass. | No real Zcash proof, funded submit/finality, actual Solana execution or provider settlement certified. The app must keep approved, signed, proved, submitted, included and provider-reported facts distinct. |
| Activity / history / memos | Empty/populated/filtered/loading/error and Solana receipt states; ledger navigation, opt-in memo and model contracts. | Live chain reorg/full-history/unknown-send reconciliation and privacy consequences of fetching received memos remain partial. No fabricated receipt should fill gaps. |
| Address book | Create/edit/delete/search/invalid/no-results presentation and interaction; saved-recipient contracts and safe selection behavior. | Independent device-wide persistence under all delayed-event schedules is not certified. Do not generalize good form behavior to key/storage safety; AUD-001's persistence layer is shared. |
| Devnet private Solana | Setup, fee/address/Add SOL/private-send/public-withdrawal state/controller tests; signatures/lease/refusal cases with mocked chain/prover. | No real funded Devnet private deposit/proof/execute. Hosted prover and fee funding are external prerequisites; do not label those real steps passed from mocked execution. |
| Plain mainnet SOL / USDC | Real signature checking plus nonce/token/account/amount contracts; receive/send/settings/security renderers. | Actual RPC nonce creation, ATA rent, funded SOL/USDC delivery and unknown-outcome retry were not executed. Several fake-DOM tests fail before later scenarios (AUD-004). |
| Private mainnet SOL | Automatic plan and unavailable-service state; source checks and private-mode contracts inspected. | Administrative upgrade capability remains outside wallet threshold protection (RISK-002); small-pool privacy, actual program/prover and funded behavior need independent acceptance/verification. Hidden setup details alone are not demonstrated informed funding consent. |
| Swap preview / animation | Input/direction/slippage, quote error/stale states, compact review, six-stage simulation, pause/manual step and Escape checks passed. | Explicit demo/no-funds wording is essential. Animation completion is not a settlement receipt. Keep reduced motion/manual progression and timer/listener teardown. |
| Standard mainnet Swap | Default-profile real wallet + clearly mocked dry quote: selectable mode, connected private-SOL source, absent outside-payer controls, unavailable-service reason and disabled deposit action. | Default production service flags cannot fund this new-wallet route (RISK-005). It is accurate to say quoting/selection works; it is inaccurate to call execution production-verified. Resolve release-profile/UI availability expectations. |
| Confidential mainnet / ZEC→SOL | Mode/key/echo/signature/deadline and fixed-address/payment-proposal contracts with inert provider/chain; full reviews retain addresses and consent. | Provider access and funded shielded payout/refunds unverified. A dry quote is not execution proof; Standard must never silently replace required confidentiality. Real-funds review can scroll to retain critical terms. |
| Swap reload / recovery / tracking | Encrypted record/scope/duplicate/refusal/status contracts and synthetic tracking states. | Provider Success or Refunded must remain provider-attributed until destination evidence exists. Funded recovery, timeout, partial delivery and refund settlement remain unverified. |
| Post-quantum experiment | Configure/review/expiry/approvals/progress/delivery/refund presentation and model illustration states exercised. | This is a simulation; it cannot substantiate production post-quantum transaction security. |
| Wallet/direct messages / requests | Room/direct/contact/changed-key/setup/invite/cost-review renderers; signed chat and request parsing contracts; drafts and focus checks. | Real network delivery, on-chain messages, fees and account funding not executed. Payment request selection must remain a proposal input, never implicit authorization. |
| Messaging account / contacts | Setup/backup/funding/cost/invalid-recipient state contracts and UI fixtures. | Single-key messaging account is a different custody boundary from threshold wallet funds. Real on-chain memo round-trip/contact routing remains partial. |
| ZNS | Registry/mapping/error and approver-recheck contracts; no actual paid name-resolved transaction. | A resolved name must not replace full underlying address/network review. Registry availability and mapping freshness are external dependencies. |
| Settings / help / privacy | Theme, menus, disclosure, help/education/network states and keyboard behavior inspected; no redesign introduced. | Keep current capability/custody caveats aligned with the actual profile. Physical keyboard/OS behavior, every external link destination and all expanded-help combinations are not exhaustively certified. |
| Native apps | 45 isolated Swift recipient/Vault checks pass with substituted Keychain/normalization adapters. | Full Xcode, native UI/FFI build, physical Keychain/biometrics and native funded flows were not tested; README excludes native clients from current web release. |

## Confirmed UX-facing findings

### AUD-001: successful storage feedback can hide loss of signing material

Severity Critical; Reliability/Security availability. Actual stale persistence reports success while deleting new key/share entries under delayed events. This is deeper than a label or animation problem. Correct the persistence transaction/conflict semantics; do not attempt to fix it by changing success copy alone. Require native-browser regression controls and fresh-reload preservation in both storage modes. Full reproduction and impact conditions are in AUDIT_REPORT.md.

### AUD-003: wrong network in mainnet setup

Severity Medium; UX/Functional. Reproduce current-UI mainnet formation, then inspect guided header and continuity. Expected mainnet/private-mainnet context; actual literal Solana Devnet. The real wallet network/address remained mainnet. Fix data-derived labels at `setup-wizard.js:11` and `app-setup.js:87`, retaining the authorization model. Screenshot evidence: `docs/audit-evidence/2026-11-14/mainnet-network-label.png`.

### RISK-005: selecting Standard does not establish funded availability

The default profile has a real-wallet service mismatch: live Swap selection is enabled but mainnet private/public SOL services are disabled. In the bounded runtime test the screen honestly states the server cannot offer private funding, and deposit creation remains disabled. Expected behavior depends on release intent: either expose quote-only/unavailable status earlier or supply an approved service profile. Do not enable production gates or restore an outside-payer option without an explicit product decision.

## Accessibility and interaction assessment

Positive measured areas include native control labels/focus, 93 keyboard/dialog checks, 200% security text, reduced motion, forced-color/transparency fallbacks in the interaction contracts, stable focused input nodes during selected theme/render updates, and native top-layer menu visibility. Phone, intermediate and desktop layouts were exercised in both themes. The fresh-entry and Receive checks include actual post-click outcomes rather than only click response.

Limits: no physical screen reader, full speech/voice control, mobile OS keyboard, physical touch device or hardware authenticator certification. Token contrast tests and sampled composited welcome contrast do not prove contrast for every possible record/state. Synthetic touch evidence is not a physical-device claim. Back/Forward, refresh and interrupted operations are strongest for formation/recovery and modeled payment states; full funded journeys remain unverified.

## Prioritized improvements without redesign

1. **P0 / AUD-001:** repair key persistence/conflicts; preserve last-copy recovery and nonce safety.
2. **P1 / AUD-002:** make displayed/submitted identity follow independently checked transaction bytes and node results.
3. **P1:** make the intended launch profile explicit; retain truthful custody/provider/unavailable status and resolve required funding dependencies.
4. **P2 / AUD-003:** fix data-derived network labels across every setup stage.
5. **P2 / AUD-004–005:** repair committed gate assumptions and wire the actual expanded/reopened/resized interaction regressions into CI.
6. **P2:** run funded disposable-testnet cancellation/unknown-result/recovery journeys before production claims; retain explicit not-verified labels in reports until completed.
7. **P3 / OBS-001:** establish mobile startup and interaction budgets, then optimize measured bottlenecks within the existing design.

No unrelated color, typography, icon or layout redesign is recommended or implemented by this audit.
