# Security audit — Zigs final4

**Security readiness: NO-GO for unrestricted real-funds use.** This is an evidence-based engineering assessment, not cryptographic certification or an ASVS compliance attestation.

Date: 14 November 2026. Target: `codex/near/final4` at `bf75463`. Canonical issue IDs, severities and complete defect fields are in AUDIT_REPORT.md; this document adds threat boundaries, security evidence and risk treatment. No production code/configuration was repaired during the audit.

## Threat model and assessed assets

Assets include signing shares, wallet encryption/viewing keys, nonce/anti-replay state, vault keys, recovery files, recipient/amount/network/fee/memo approval data, private notes, transaction identity, and the availability of enough signing participants. Trust boundaries include browser origin/storage, other tabs, physical authenticators, encrypted relay documents, external RPC/prover/provider responses, compiled WASM/vendor assets, and an administratively upgradeable Solana program.

Actors considered: stale/concurrent legitimate tabs; a malicious relay or namespace holder; a malicious participant able to sign its own documents; hostile or stale RPC/provider results; malformed external links/data; compromised same-origin scripts/extensions; and administrative upgrade authority. These actors have different powers. Knowing a wallet ID is not the same as knowing its encryption secret, and one signing share is not sufficient to forge a threshold transaction.

### Framework

Review categories were mapped to [OWASP ASVS 5.0.0](https://asvs.owasp.org/) and its [released standard](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/OWASP_Application_Security_Verification_Standard_5.0.0_en.pdf): cryptography/key lifecycle (V11), sensitive data (V14), API/authorization/configuration boundaries (V4/V8/V13), and logging/errors (V16). Only the listed controls were assessed; this is not completion of every ASVS requirement. [Cryptography guidance](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x20-V11-Cryptography.md) and [logging/error guidance](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) informed the manual review.

## Confirmed security-relevant defects

### AUD-001 — Critical secret availability / potential loss of access

- **Feature:** multi-tab wallet creation/import/restore and subsequent persistence, protected and unprotected modes.
- **Location:** `web/app-keystore.js:84–95,120–131,141–155`.
- **Reproduction:** `node audit-tests/stale-keystore-browser.mjs`; expected exit 1 on current code. Two fresh pages use actual native storage/Web Locks and application persistence. Test ordinary delivery first, then explicitly delay the stale page's storage events. Add a new wallet key/share in the other page and save from stale memory.
- **Expected:** concurrent successful saves preserve additions or reject stale state, without resurrecting deleted material or reusing nonces.
- **Actual:** both normal controls preserve the key/share. Both delayed cases report success while deleting them. Releasing queued events does not restore overwritten values.
- **Evidence:** boolean-only native-browser log and portable isolated-storage regression, under `docs/audit-evidence/2026-11-14/` and `audit-tests/`.
- **Root cause:** a lock serializes whole-record replacement, but only once-only fields are merged with fresh storage. It does not merge new dictionary items or removals.
- **Security impact:** conditional lost access, not exfiltration. If erased material is necessary for the threshold/decryption, no backup exists and the remaining in-memory copy is closed, funds may become inaccessible. This meets the user's Critical criterion. No real funds, live wallet material, theft, signature forgery or nonce reuse occurred in the test. Delayed event delivery is fault injection, not an observed universal ordinary-browser race.
- **Mitigation:** versioned transactional per-item updates or correct merge-under-lock/tombstones and conflict detection. Protect anti-replay invariants during the fix.
- **Required regression:** normal/delayed/missing events, additions and removals, plain/sealed modes, restore/create concurrency and fresh-reload preservation.

### AUD-002 — High transaction submission integrity

- **Feature:** Zcash submission/resubmission of a completed transaction.
- **Location:** `web/app-payments.js:404–417,430–446`, `wasm/src/chain.rs:1085–1093`.
- **Reproduction:** `node audit-tests/final-transaction-binding.mjs`, intentionally failing the secure invariant. Actual boundary functions receive approved/claimed ID A with unrelated opaque raw-byte stand-in; inert broadcaster reports B.
- **Expected:** independently bind serialized transaction identity/network/approved content before network transmission; do not mark A submitted when the node reports B.
- **Actual:** stand-in bytes reach the broadcast dependency and the status is recorded under supplied A, ignoring B.
- **Evidence/root cause:** runtime VM characterization plus the submission source, which compares metadata but does not derive ID from raw bytes. The engine wrapper only decodes hex/submits and returns a node ID. A final-document signature proves its participant author, not the truth of the transaction-byte claim.
- **Threat limit:** the broadcaster is mocked; invalid bytes being accepted by a real chain was not demonstrated. Unrelated valid bytes would still need valid signatures. This is not an unauthenticated FROST forgery or demonstrated stolen funds. Chain scanning independently limits claims of final inclusion.
- **Mitigation/regression:** engine parse/hash/content checks; pre-send mismatch refusal; returned-ID handling; independently known serialized A/B vectors and malformed bytes; zero RPC on mismatch; safe uncertain state after inconsistent submission results. Cover resend and interrupted tracking.

### AUD-006 — Medium development-toolchain dependency exposure

The public lockfile scan found Wrangler 4.149.0 → Miniflare 5.20261006.1-alpha → Undici 7.29.1 in `cf/package-lock.json`, all marked development dependencies. Npm reports three affected package nodes and eight underlying advisories; the following maintainer reports are representative:

- [Content-encoding resource-exhaustion/process crash](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c).
- [TLS renegotiation client denial of service](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm).
- [Redirect/cache cross-user response disclosure](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26).
- [TLS option/pinning handling weakness](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx).

The cache and TLS-option advisories have specific Agent/cache/option preconditions; those conditions were not established in the app handlers. Miniflare uses Undici, while production Cloudflare handlers use Workerd fetch and do not import Undici. Therefore this is **not a demonstrated deployed Worker vulnerability** and is not labeled a Critical wallet exploit. Exploitation was not attempted.

Reproduction uses empty npm user/global configs and a fresh audit cache, lockfiles only, ignore-scripts and the public registry. Web and solspike scans reported zero known advisories at audit time, not comprehensive safety. Select supported compatible tooling updates that resolve the observed advisories (the audited fix range begins at Undici 7.30.1), then re-audit the actual lockfile and run isolated Worker/build/browser tests. Rust and manually vendored packages/binaries remain outside this npm result.

## Documented architecture risks and release decisions

### RISK-001 — High relay availability risk, confirmed by bounded runtime probe

- **Feature/category:** encrypted coordination state; Security availability.
- **Location:** `cf/src/index.js:526–534,605–625,667–685`.
- **Reproduction:** on a disposable local Worker only, `node audit-tests/relay-capability.mjs ws://localhost:<audit-port>`. Three small writes use one new random group namespace and no wallet encryption secret. A second client reads ciphertext and overwrites it with invalid ciphertext; a reconnect reads the corruption; a previously captured value can be replayed.
- **Expected security property for a hardened release:** possession of a non-secret namespace identifier should not by itself allow persistent destructive writes or rollback, or the weaker boundary must be explicitly accepted with tested recovery.
- **Actual/evidence:** the probe passes its characterization assertions and the server persists those writes. Limits constrain rate/size, not whether a writer has a separate capability. This behavior is explicitly documented in PRIVACY.md and PROTOCOL.md; it is not presented as a newly discovered accidental authentication bypass.
- **Impact:** coordination can be denied or rolled back when a group ID is known. No decryption, valid approval forgery or threshold-spend bypass was demonstrated. Sustained-adversary full-wallet recovery was not tested.
- **Treatment/regression:** separate authenticated write capability/per-writer authorization and version/replay/repair controls; never send the decryption secret to authenticate writes. Test read-only outsiders, bounded poisoned writes, reconnect, rollback and self-service recovery. No production or quota-exhaustion attack was attempted.

### RISK-002 — administrative private-mainnet custody authority

The source disclosure at `web/sol/net.js:35–37` states that the owner-controlled upgrade key can replace the private approval program and move funds without the wallet threshold restricting that key. New mainnet setup automatically chooses this mode, as explicitly requested by the owner; the disclosure is retained inside initially collapsed Setup details. This is an **administrative trust capability with potentially Critical fund impact**, not a new outside-attacker exploit.

Actual deployed bytecode, upgrade ownership/key security and governance were not independently checked. Required product/security decisions are a truthful custody threat model, conspicuous first-funding disclosure, upgrade governance and independent program/prover review. Do not silently undo the requested automatic setup or enable production service flags as an audit fix. Regression should establish exactly which authority checks the client performs and how upgrades are surfaced before funds move.

### RISK-003 — optional unprotected storage and unlocked-browser exposure

The supported Skip protection path persists key material in localStorage. The passkey vault seals it at rest, but an unlocked same-origin context has the key material needed to operate. A vault does not provide immunity to a compromised origin, malicious extension or active-memory access. These are supported-mode/threat-model limitations, not demonstrated vault bypasses.

Passkey cancellation/unsupported-provider tests and explicit skip confirmation passed. Retain honest recovery/last-copy guidance and decide which environments/unprotected use are supported. Physical WebAuthn/Keychain/browser-provider behavior was not certified.

### RISK-004 — infrastructure, signing and settlement assurance gaps

Real funded proof generation/submission/finality and swap/refund delivery are unverified. Core crypto crates, deployed Solana approval/pool code, vendored prover artifacts and distributed binaries have not received an independent cryptographic/smart-contract certification in this audit. Prebuilt WASM passed selected vectors, but a reproducible native rebuild was blocked by missing Rust tools.

A public testnet height read succeeded; this is not a statement that all configured nodes agree, a wallet scan works, a transaction can be proved/broadcast, or a provider delivers a shielded payout. Keep these boundaries explicit in launch decisions and remediation gates.

### Browser-distributed RPC configuration tokens

Solana config intentionally supplies browser RPC configuration, including a provider URL that can contain a key. Such a key is not a server-only secret. Its intended browser origin/quota restrictions must be reviewed operationally; actual production token restrictions were not inspected because credentials were not used or printed. No active provider-key abuse was attempted or established.

### Initial key discovery / trust on first observation

Participant identity/threshold pins and signed-document validation protect later changes, but initial discovery remains an explicit trust boundary. Safety-number/address verification and distinct-device checks are important. Their local protocol/UI tests passed; independent human verification, compromised-device enrollment and physical multi-device deployment remain unverified.

## Controls with positive bounded evidence

| Control | Evidence and limits |
| --- | --- |
| Vault crypto/backup binding | Passing vault and backup-check contracts; real WASM encrypted-file export/check/cold restore and virtual-PRF reload. Not physical authenticator certification; AUD-001 still affects sealed-record availability. |
| Nonce ownership/burning | Nonce-lock and Solana cross-tab tests pass, including multiple writers and Web Locks alternatives. This does not cover dictionary-item loss or certify every browser crash schedule. |
| Document integrity | Signed/chat tests pass, with paths/fields/canonical content and participant checks. A participant-signed claim still needs semantic validation; see AUD-002. |
| Solana signature/message checks | Real WASM aggregate/signature contracts pass against mock chain messages; strict chain/program/recipient/amount/nonce and failure checks are exercised. Not actual deployed-program/funded execution proof. |
| Request boundaries | Gate, plain-worker, mode and plain-security contracts pass; fixed upstreams/header allowlists/redirect refusal/limits and redacted diagnostics were inspected. Relay write capability remains weaker by documented design. |
| Browser policy/sinks | Strict CSP, no-referrer and nosniff are present. Selected dynamic rendering sinks use authored markup, own QR output or text-node construction. No attacker-controlled XSS proof was established; this is not universal XSS absence. |
| Randomness/crypto primitives | Reviewed code uses platform/OS randomness and established primitive libraries. No independent side-channel or mathematical cryptographic audit was performed. |
| Chain context | Bundled WASM expiry transitions and four PCZT goldens matched, with actual configured consensus networks. Not mainnet node/finality certification. |

## Security execution record

Twelve scoped original contracts passed: `vault`, `nonce-locks`, `signed`, `chat`, `optional-passkey`, `sol-plain-security`, `cf/test/gate`, `plain-worker`, `sol-plain-sign`, `sol-nonce-tabs`, `backup-check`, `sol-mode`. Backup-check covers 69 payload-binding cases; optional passkey covers 32 policy cases. `sol-config` fails on a fake DOM missing dataset, as recorded in AUD-004; no existing test was modified.

Three audit secure-invariant regressions intentionally fail: stale save in isolated storage, stale save in native browser, final transaction binding. The relay characterization exits 0 because it confirms the documented behavior, not because that behavior provides stronger authorization. Full command logs/exits and evidence tiers are in TEST_COVERAGE.md.

## Unverified security work before real-funds launch

Funded disposable-testnet proof/send/confirm/reorg/unknown-result recovery; deployed Solana code/authority checks; hosted prover trust and malicious response review; independent crypto/program review; hardware/physical passkey and browser extension threat testing; production provider token restrictions; production auth/CDN/infrastructure configuration; Rust/vendor advisory and binary provenance review; and resource-exhaustion testing under an agreed bounded plan. No live denial-of-service, credential attack, production-write or fund operation was authorized or performed.
