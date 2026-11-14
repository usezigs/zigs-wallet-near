# Selected audit evidence — 14 November 2026

Audited commit: bf754639d047726adb63e8c08ebf463337699d21, branch codex/near/final4. These files contain selected non-secret evidence, not saved browser profiles, backup downloads, signing material or production credentials. No real funds were used.

## Index

- `stale-keystore-browser.log`, `stale-keystore-save-final.log`: AUD-001. Three audit secure-invariant commands intentionally fail on this commit; do not hide or suppress their assertions.
- `final-bytes-evidence.json`: AUD-002; mock broadcaster acceptance only, not real-chain acceptance.
- `current-ui-formation.json`, `mainnet-network-label.png`: actual bundled-WASM local formation and AUD-003. The public test address is masked in the screenshot.
- `recovery-current.log`, `multidevice-current.log`: 16 recovery and 11 independent-store ceremony assertions retained in audit-only copies with current creation helpers. Original checked-in ceremony gate remains failed.
- `fast-official.log`, `fast-results.json`, `slow-results.json`, `graph.log`, `lint.log`, `ceremony-original.log`: original gate evidence. Node25 manual results are qualified; official Node26 gate was environment-blocked. Full per-test transient logs are indexed in TEST_COVERAGE.md.
- `presentation-summary.json`, `portfolio-browser.log`: fixture renderer/layout/interaction evidence, not custody or settlement verification. Large screenshots/matrix details remain under `/private/tmp/zigs-production-audit/`.
- `entry-runtime.json`: actual entry under desktop/mobile network emulation and controlled engine-fetch failure. The corrected API interceptor preserves JavaScript asset names. Earlier interceptor failures were audit-harness defects, not product findings.
- `consensus-wasm.json`, `pczt-wasm-vectors.json`: bundled-engine checks; no source rebuild or funded proof.
- `testnet-connectivity.json`: one credential-free read-only public Testnet block-height request, not a wallet scan or submission.
- `relay-capability.log`: bounded characterization of documented namespace-only relay write/read behavior; no decryption, signature forgery or theft.
- `default-standard-unavailable.png`: masked default-profile funding availability limitation, with injected dry quote and no provider/deposit call.
- `npm-audit-cf.json`: public advisory metadata for locked development dependencies; deployed Worker exploitability not established.

## Reproduction scope

Portable audit tests and safety instructions are in `audit-tests/README.md`. The additional portable isolated Worker helper successfully started on a fresh loopback port; the three-small-write relay probe passed, then the process was stopped and temporary config/state removed. An initial sandbox-denied loopback listen was an environment limitation; the loopback-permitted rerun passed. No existing developer service was targeted.

The five root reports are authoritative for findings, severity, exact commands and limitations. Evidence tiers must remain distinct: actual local protocol/crypto, mock-backed boundaries, synthetic-state native DOM interaction, and source/config inspection. No artifact here proves funded settlement, deployed program authority, physical authenticator behavior, or production security certification.
