# Zolana v1 on Solana mainnet: design record

Status on 2026-11-10: this record comes before code. It maps what Zigs must change to use the
Zolana shielded pool v1.0.0, which runs on mainnet and on Devnet. Branch `zolana-v1`, based on
602127f3 (the commit that staging serves).

## 0. Checked facts and decisions

### 0.1 Facts checked on chain and upstream

- Mainnet and Devnet run the shielded pool `ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW` and the
  user registry `regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ`. The on-chain hashes equal the
  releases `shielded-pool-v1.0.0` (`682aba8e…`) and `user-registry-v1.0.0` (`f46624ad…`), both built
  from upstream commit 3c018b82. The mainnet deploy slots are 467127839 (pool) and 467127511
  (registry).
- Tree 0 (`777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor`) exists on both clusters, owned by the
  pool. Its `fee_per_tree` is 5,000 lamports on both clusters.
- The Helius mainnet gateway answers 401 on `/v1/spr` without a key, so the route exists. It answers
  404 on `/v1/zolana`. Nobody tested `/v1/spr` with a key yet.
- Upstream renamed the repo `helius-labs/zolana` to `helius-labs/privacy-rings`. The TS SDK is now
  `@heliuslabs/spr` 0.9.0-alpha. The upstream mainnet deploy notes say that the "private wallet"
  service is not deployed. Zigs does not use it.

### 0.2 Decisions taken for the Devnet slices

The owner can change each one. Section 4 gives the options.

- D1: local proving in the browser only (option A). This keeps the current privacy claim: the
  device builds the proof.
- D2: bundle the TS SDK from 3c018b82 or a later commit, pinned by commit.
- D3: build the web prover from its source commit, pinned by commit.
- D4: load the proving keys from the upstream CDN. Check CORS before slice 6.
- D5: move the Rust crates to `spr-*` at 3c018b82.
- D6: a tree fee cap of 10,000 lamports per tree, read again from the tree for each proposal.
- D7: a new FROST `PROGRAM_LABEL` with the new IDs and a version marker.
- D8: retire the old Devnet pool `sppU489…`. Do not drain it.
- D9: a new viewing label `zigs-sol/viewing-x25519/v1`.
- D10: delete the register intent.
- D13: keep SPL legs refused until a new asset table exists.
- D14: Devnet first, then a mainnet pool mode on staging behind a new flag that is off on
  production.

### 0.3 Owner-only items

- The `sol-program` deploys. A Devnet redeploy is a live chain write and needs the owner's yes. A
  mainnet deploy costs SOL, and only the owner runs it.
- Every funded mainnet test. Only the owner runs it.
- The ban on local servers (2026-11-04). It blocks `solspike/baseline.sh`, the Chrome tests and the
  baseline record. Until the owner lifts it, all checks run in process.
- A test of `/v1/spr` with the mainnet key from the real staging page.

## 1. Verdict

The pool is usable on mainnet now. The pool is ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW. The registry is regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ (3c018b82:program-libs/user-registry-interface/src/lib.rs:6-7). The Photon indexer and the Nitro TEE prover are deployed. The "private wallet" service is not deployed (tvc-gateway runs with no tasks). Zigs does not use that service.

Zigs cannot use the new pool today. Zigs is pinned to the old Devnet pool `sppU489...`, and nothing in the repo works against `ring1G...`. These items block it:

- **Pool and registry ids.** The old ids are in `wasm-sol/src/consts.rs:10-17` and `sol-program/src/cluster.rs:17-18`.
- **SDK bundle.** `web/sol/zolana.bundle.js` is built from c232da1b (`solspike/build.mjs:16-17`). It calls the gateway `/v1/zolana` (`web/sol/worker.js:226`). It sends `proverTee:false` (`web/sol/worker.js:235`). It uses P-256 viewing keys. The new SDK refuses a non-loopback prover without a TEE policy (abed9d63:sdk-libs/ts/src/client/prover/client.ts:194,229). The new SDK drops P-256 (26482c9a).
- **Fee rule.** `wasm-sol/src/template.rs:56` caps the tree fee at 162 lamports per nullifier. The new tree default is 5,000 lamports per tree (3c018b82:program-libs/interface/src/state/tree.rs:21). Approve would refuse every proposal.
- **Proofs.** The signer vector no longer holds the fee payer (3c018b82:programs/shielded-pool/src/instructions/transact/verify.rs:249-270). All proving keys and verifying keys changed. The old proofs and the old browser prover wasm do not verify.
- **Gating.** The pool wallet exists only for confirmed testnet wallets (`web/app-sol.js:26-30`, `web/sol/main.js:1-5`). Mainnet wallets get only the plain wallet (`web/app-sol.js:33-37`).
- **sol-program.** The mainnet build was never run against the real pool (`sol-program/build.sh:127-148`). It also has no mainnet deployment.

The plain mainnet Solana wallet stays untouched:

- Its import closure has 32 files. None is the bundle, the local prover, or the pool worker (`web/sol/plain/control.js:4-6`, `cf/test/gate.mjs:382-389`).
- It shares one file with the pool code. The shared wasm `web/sol/wasm/sol_wasm_bg.wasm` contains `sppU489` once. A wasm-sol change therefore changes a file the plain wallet loads. Re-run its in-process tests after any wasm-sol change.

## 2. Breaking changes by area

### 2.1 Program ids, cluster separation, labels

- The pool id and the registry id are the same on Devnet and mainnet. Only the genesis hash separates the clusters.
- Zigs files to change:
  - `wasm-sol/src/consts.rs:10-17,349-350`: pool, registry, not-a-recipient list.
  - `wasm-sol/src/pins.rs:78-100`: derived PDAs.
  - `sol-program/src/cluster.rs:14-40,62`: delete `DEVELOPMENT_POOL` and `ZIGS_MAINNET_POOL_ID`. Keep `GENESIS` as the only cluster key (`sol-program/src/lib.rs:35-37`).
  - `sol-program/build.sh:99-109,129-143`: `find_zolana` looks for the package name `zolana-interface`, which no longer exists. The cluster checks assume different pool ids per cluster.
  - `sol-program/svm-tests/src/lib.rs:31,41-46,58`.
  - `sol-program/svm-tests/tests/cluster.rs:29-55`: these tests assume different pool ids per cluster. They fail when both clusters hold the same id.
  - `sol-program/svm-tests/stub-pool/src/lib.rs:10-24`.
  - `sol-program/Cargo.toml:16`.
  - Tests, vectors and mocks that hold the old id:
    - `wasm-sol/tests/{roles,plain_rules,asset_pins,repo_pins}.rs`
    - `solspike/tools/{demo-check,verify-chain}.mjs`
    - `solspike/mock/synthetic.mjs:9,77`
    - `solspike/test/{worker,prepare}.test.mjs`
    - `web/test/{sol-wasm,demo-check,sol-chain}.mjs`
    - `docs/demo.md:81,236`
- `wasm-sol/src/frost.rs:44-49`: `PROGRAM_LABEL` embeds `sppU489` and `regyS5rk`. It is signed material and binds the FROST group. A change alters every approval hash and every soldone document.
- The old Devnet vector `sol-program/svm-tests/vectors/devnet-main.txt` stays as Devnet history.
- Fixtures with derived addresses need regeneration: `wasm-sol/vectors/*`, `web/test/*`.

### 2.2 Pool wire format (mostly compatible)

These are unchanged:

- Instruction tags 15, 16, 17 (3c018b82:program-libs/event/src/tag.rs:33-35).
- The transact and deposit data layouts.
- The transact account order and flags (3c018b82:programs/shielded-pool/src/instructions/transact/account.rs:40-50).
- The PDA seeds, `N_PUBLIC_SLOTS` 3, and the 38 shapes.
- The tree account size of 40,080 bytes and the fee offset 8.

These changed:

- The name `ConfidentialEddsa` now means tag 7. Wire tag 0 is now `ConfidentialSigner(u8,u8,u8)` (3c018b82:program-libs/interface/src/verifying_keys/circuit.rs:294,301).
  - `sol-program/src/instructions.rs:175` compiles unchanged against the new crate. It then accepts tag 7 and rejects tag 0. This is a silent break after a crate bump.
  - Other sites: `sol-program/svm-tests/src/lib.rs:214` (compile error, needs 3 fields), `tests/real_pool.rs:28`, `tests/commitment.rs:126`.
  - Doc comments: `wasm-sol/src/transact.rs:5,45,88`.
- The nullifier PDA is now 11 bytes (3c018b82:program-libs/interface/src/state/nullifier_pda.rs:6). `sol-program/svm-tests/tests/replay.rs:368` follows the constant. Fix the 10-byte text in `ZOLANA.md`.
- Merge data layout changed (3c018b82:.../merge_transact.rs:68). Zigs refuses tag 17 (`wasm-sol/src/rules_ix.rs:62`), so there is no impact.
- The pool now does one System transfer for the tree fee. The System account is already forwarded.
- Pins that name old commits (all share the same pool interface):
  - `wasm-sol/src/consts.rs:1-2` (89640630).
  - `wasm-sol/tests/repo_pins.rs:1` (c232da1b).
  - `ZOLANA.md:174`.
  - `repo_pins.rs`: the SOL_INTERFACE test reads a byte array, but upstream now uses `pubkey_array!(base58)`. The tag test reads `SET_MERGING_ENABLED`, now `SET_MERGE_ENCRYPTION`.

### 2.3 Fee model

- The fee is now one flat `fee_per_tree` per distinct tree written (3c018b82:program-libs/tree/src/fees.rs:19,51). The field sits at the same offset 8. The default is 5,000 lamports (3c018b82:program-libs/interface/src/state/tree.rs:21). The cap is 1,000,000 (fees.rs:10). With tree 0 as input and output, the fee is paid once.
- Tree 0 holds 5,000 lamports per tree on mainnet and on Devnet (chain read, section 0.1).
- Zigs files to change:
  - `wasm-sol/src/template.rs:50-56`: `TREE_FEE_CAP`.
  - `wasm-sol/src/rules_legs.rs:119-130`: `fee_rule`. Report the fee once per tree, not times inputs.
  - `wasm-sol/src/snapshot.rs:31`: rename the field to `fee_per_tree`.
  - JS readers of `feePerNullifier`: `web/sol/spend.js:130`, `web/sol/propose.js:91`, `web/sol/worker.js:401`, and the test stub `web/test/sol-chain.mjs:363`. `web/sol/fee.js` handles the fee-payer key and does not read the fee.
  - Tests: `p3c.rs:472-483`, `fix_round.rs:784-790`.
  - Payer funding and fee-key balance checks that assume 0 to 162 lamports.
- `decodeTreeFees` in ts-sdk-v0.9.0-alpha still returns `feePerNullifier`. Only commits at or after 3c018b82 return `feePerTree` (git diff abed9d63 3c018b82 -- sdk-libs/ts/src/interface/codecs/index.ts).

### 2.4 Proof inputs and keys

- The signer vector holds only owner signers. The fee payer is not a slot (3c018b82:.../transact/verify.rs:249-270; docs/spec.md:1105,1251,1323). The Zigs owner PDA is the only owner signer, so the vector is `[owner PDA]` instead of `[fee payer, owner PDA]`. Every public input hash changes.
- Check for Zigs code that puts the payer in the signer vector or uses the payer as a dummy owner tag (`web/sol/prepare.js`, `wasm-sol/src/roles.rs`). This is unverified.
- Verifying keys changed in bbdecee0 (2026-10-20) and c4062d38 (2026-11-02). All 38 transfer_confidential keys differ from the old lock (0 of 38 equal).
- The new key set is `proving-keys/78751f5d1c591777` on `https://d3gbdb0egjwcw9.cloudfront.net` (3c018b82:prover/server/prover/provingkeys/zopro-keys.lock:1-4). It has 41 `.zopro` files. The sizes for the Zigs shapes N=1,2,3,4,5,6,8 (each with 2 outputs) are:

  | Shape | Size in bytes |
  |---|---|
  | 1_2 | 6,867,248 |
  | 2_2 | 12,181,958 |
  | 3_2 | 18,429,033 |
  | 4_2 | 22,606,307 |
  | 5_2 | 26,906,771 |
  | 6_2 | 35,309,492 |
  | 8_2 | 43,929,270 |

  The total is 166,230,079 bytes. Keys 5_2, 6_2 and 8_2 exceed the Cloudflare 25 MiB limit (26,214,400 bytes). Self-hosting them needs R2 or another host.
- The Zigs key table and guards must change:
  - `web/sol/prover/prover.js:1`: key folder `3a1c88f90f609eb1`.
  - `web/sol/localprover.js:9,20,22`: `KEY_FOLDER`, `KEY_FILE` (to `.zopro`), digest check.
  - `cf/src/index.js:36` and `web/sol/session.js:23-25`: CSP key folder.
  - `web/sol/prover/SHA256SUMS`, `ZOLANA.md` prover rows.
- The upstream gnark `.key` files are also published in the same prefix (3c018b82:docs/core-ceremony-publication.json). The new web prover uses `.zopro`.
- Compute units are unmeasured. Pins: `template.rs:76-86,106` (144,591 and 151,437), `CU_FLOOR_*`, `LOADED_MIN_POOL`. The pool ProgramData size of 598,229 bytes is for the old binary. Measure with `simulateTransaction` on staging.

### 2.5 SDK bundle and gateway

- Package rename to `@heliuslabs/spr`. `createZolanaClient` becomes `createSprClient` (abed9d63:sdk-libs/ts/CHANGELOG.md:19-20; src/index.ts:14). Change `web/sol/worker.js:229`. `solspike/src/entry.js` re-exports, so the name flows through.
- Gateway path `/v1/spr` (abed9d63:sdk-libs/ts/src/endpoint.ts:17-32). Proofs go to `<prover>/prove/<key>`. Attestation is at `/attestation`. Change `web/sol/worker.js:226` and `web/sol/localprover.js:11`.
  - Tests and tools that name `/v1/zolana`: `web/test/demo-check.mjs:32-35,258,292-302`, `web/test/sol-errors.mjs:38`, `solspike/test/worker.test.mjs`, `solspike/test/worker-schema.test.mjs:307`, `solspike/tools/{demo-check,key-b,prove-canary,cors_probe}.mjs`, `solspike/harness/*`.
  - Whether the Helius mainnet gateway serves `/v1/spr` behind the api-key URL is unverified. The upstream example uses CloudFront hosts for Photon and the prover (087bc04:examples/wallet/src/deployments.ts:17-18).
- `proverTee:false` is gone (952d11c5; abed9d63:.../client.ts:178; .../prover/client.ts:194,229). Only a loopback prover URL allows plaintext. This is a redesign, not a constant bump:
  - The one-way gate (`web/sol/worker.js:81-83,145-163,176`) keys on the Helius origin and `PROVE_PATH`. A loopback prover origin is neither, so `passes()` blocks it.
  - Local mode: a local client with a loopback `proverUrl` and a fetch that reaches only the local prover. Keep the latch so local never falls back to hosted.
  - Hosted mode: a second client with `SignedTeePolicy.forNetwork("mainnet")`. The body is HPKE-encrypted (abed9d63:.../tee/session.ts:224-232). A fetch wrapper cannot read it, so `s.trace.prove` (read in `worker.js:153,482` and `prepare.js:194`) can be captured only on the local path.
  - Hosted mode needs CSP for `https://d3gbdb0egjwcw9.cloudfront.net/tee-policy/mainnet.json` (abed9d63:.../tee/signed.ts:63) and `/attestation`.
  - CSP and guard files: `cf/src/index.js:36,53-59`, `web/sol/session.js:23-25`, `web/sol/guard.js:7,34-38`, `cf/test/gate.mjs:227-230`.
  - Re-run the gate tests (`web/test/sol-*.mjs`) after the redesign.
- `proofDataSource` now defaults to `"prover"` (abed9d63:.../client.ts:320). Set `"client"` in `web/sol/worker.js` init so Photon serves Merkle and non-inclusion proofs to the local prover.
- Photon: the six methods Zigs uses keep their names (abed9d63:sdk-libs/ts/src/indexer/names.ts:1-7). Requests now carry `paginationToken`, `limit` and `filters.slot` (CHANGELOG.md:21). Responses over 10 MiB fail. `syncWallet` is still used (`worker.js:268`). Update the test stubs: `web/test/demo-check.mjs:192-258`, `solspike/mock/servers.mjs`.
- Pick which SDK commit to bundle. ts-sdk-v0.9.0-alpha (abed9d63) predates #533 (flat tree fee) and #591. A commit at or after 3c018b82 matches the on-chain pool. Verifying keys are identical at c5297afa, abed9d63 and 3c018b82, so proofs do not change between them.
  - Update `solspike/build.mjs` (`PIN`, module map `:42-53`, node_modules path check), `solspike/test/build.test.mjs`, `web/sol/SHA256SUMS`.
  - `solspike/build-prover.mjs`: `PROVER_PIN`, repo name.
  - `wasm-sol/Cargo.toml:19-20` and the vendor copy `wasm-sol/vendor/zolana-hasher`: crates are now `spr-*`.
- SDK calls Zigs uses were all found at abed9d63 with the same call shapes. Examples: `ConfidentialTransfer`, `LocalKeys.fromKeys`, `ShieldedAddress.forPda`, `encryptConfidentialTransfer`. Runtime behavior was not executed.
- Owner signer rule: abed9d63:.../assembly.ts:120-150 now lists Ed25519 and PDA owners of inputs and of outputs that carry data. The payer gets no special treatment. `web/sol/transfer.js:147-157` mirrors the old rule. Re-derive it. Re-check the CPI account order against `transactCpiAccounts`. The layout looks like the one Zigs uses (3c018b82:sdk-libs/ts/src/interface/instructions/index.ts:466-475).

### 2.6 Browser prover

- The Go bridge was removed in af6f597 (19 Oct 2026). The new prover is `zopro-spr` (Rust Groth16), built from zk-tools fac2a2b5d9e0 with nightly-2025-11-15 and wasm-bindgen 0.2.128 (087bc04:runtime.lock.json:1-8).
- The class is `SprWebProver`. The `wasmUrl` option is gone (087bc04:packages/web-prover/src/wasm-prover.ts:65-83).
- `solspike/build-prover.mjs` cannot build the new prover. It builds the Go wasm from the old pin.
- Zigs files to change:
  - `web/sol/localprover.js:36-45`: drop `wasmUrl`.
  - `web/sol/prover/*`, including the 19,994,792-byte `zolana-prover.wasm`.
  - The selftest fixture `web/sol/prover/selftest-1x2.json`. The new fixture has the same 58 key paths but other values (087bc04:fixtures/transfer-1x2.json).
  - Replace the `POOL_DATA` and `POOL_SLOT` pins (`web/sol/localprover.js:16-17`, `web/sol/worker.js:127,602-603`, `web/sol/localprove.js:130,201`). `POOL_SLOT` 512563584 is the old Devnet deploy slot. Without the replacement, a new pool trips `POOL_CHANGED`.
- Package `0.7.0-alpha` is unreleased (CHANGELOG.md:3). No web-prover tag follows 0.6.0-alpha.
- Local non-TEE proving is supported by upstream design, with a loopback `proverUrl`, `proofDataSource:"client"` and `prover.createFetch()` (087bc04:packages/web-prover/README.md:82-85; 087bc04:examples/wallet/src/zolana.ts:50,94-104). It was not run live (unverified).

### 2.7 Keys and registry

The nullifier key and nullifier formula are unchanged. The viewing key scheme changed. Registry data changed.

**Unchanged: nullifier**
- `nullifier_pk = Poseidon(secret)`. The git diff of `nullifier_key.rs` between 89640630 and 3c018b82 is empty (3c018b82:sdk-libs/keypair/src/nullifier_key.rs:35-47).
- The owner hash and nullifier formulas in `wasm-sol/src/hashes.rs:62-76,109-112` stay valid. The Zigs seed derivation labels (`wasm-sol/src/roles.rs:35-37,56-74`) stay valid.
- The derivation guard (`wasm-sol/src/consts.rs:128-133`, `check.rs:61-76`) stays.

**Changed: viewing key**
- P-256 becomes X25519 (26482c9a). The key is `0x04 || u` (3c018b82:sdk-libs/keypair/src/x25519.rs:10-45). A P-256 key is refused (x25519.rs:93-99). The lengths are unchanged: a 33-byte public key and a 99-byte address.
- `view_root` is HKDF-Extract with salt `TSPP/view_root/x25519/v1` over the clamped secret. The tx key info is `TSPP/tx_viewing/x25519/v1`. The tx key is 32 bytes, clamped (docs/spec.md:379-398; 3c018b82:.../derivation.rs:24,202-208; viewing_key.rs:187-200).
- Slot encryption keeps its HKDF layout and AES-CTR (3c018b82:.../encryption.rs:20-32,73-98,133-148). Only the DH and the key type change.
- Zigs files to change:
  - `wasm-sol/src/roles.rs`: `secrets()`. Derive 32 bytes and clamp.
  - `wasm-sol/src/viewing.rs`: replace `p256` with x25519.
  - `wasm-sol/src/rules_ct.rs:86-100`: follows automatically.
  - `wasm-sol/Cargo.toml`.
  - Dead code to remove: `wasm-sol/vendor/zolana-hasher/src/p256.rs`, and comments at `wasm-sol/src/snapshot.rs:27` and `wasm-sol/src/address.rs:14`.
  - `web/sol/transfer.js:257`: `P256PublicKey` becomes `X25519PublicKey`. Drop the p256 filter at `:152`.
  - `web/sol/worker.js:177-190`.
  - Wasm and Worker must move together, or `web/sol/session.js:73-83` (`sameAddresses`) throws.
- Add upstream key derivation vectors as tests. The path `test-vectors/key_derivation.json` is named in `derivation.ts:6` but was not opened (unverified).

**Changed: registry**
- `UserRecord` is 100 bytes (was 134). `RegisterData` has no `owner_p256` Option and no secp256r1 precompile (3c018b82:program-libs/user-registry-interface/src/state.rs:7-18,47-48; instruction.rs:11-15). Tags 0, 1, 2 are unchanged. Tag 1 is now `set_merge_encryption`.
- `update_keys` now carries only the viewing key (#591, 3c018b82:.../instruction.rs:17-22). The nullifier key has no update path. Zigs refuses `update_keys` by tag (`wasm-sol/src/rules_ix.rs:70`), so no code change. Update the text in `ZOLANA.md:388,399-400`.
- The npm 0.9.0-alpha `update_keys` builder fails against the deployed program (code reading only, not run).
- The Zigs `Register` parser reads the first nullifier byte as the Option flag if reused: `wasm-sol/src/fixed.rs:121-160`, `wasm-sol/src/template.rs:285-300`, `wasm-sol/src/rules_ix.rs:105-128`, `wasm-sol/src/rule.rs:110,157`. The beta never signs register (`ZOLANA.md:399,473`; `wasm-sol/src/beta.rs:39,173`). Delete the register intent, rules, template builder, `wasm-sol/vectors/smoke/register*.answer`, `nullifier-pk.answer`, and the secp256r1 pin if unused (`consts.rs:200-214,343-344`).
- `solspike/tools/verify-chain.mjs:139-165` parses the 134-byte record. Delete it or rewrite it.
- The registry `regy3WAe...` is the same on Devnet and mainnet.

### 2.8 Asset table

- `wasm-sol/vectors/devnet-assets.json` and `wasm-sol/src/assets_devnet.bin` hold 84 mints of the old pool at slot 510959509 (`wasm-sol/tests/asset_pins.rs:34-45`).
- Compact ids come from the new pool's `spl_asset_counter` (3c018b82:program-libs/interface/src/state/spl_asset_counter.rs:22). The new registry content was not read (unverified).
- `wasm-sol/src/pins.rs:102` calls `AssetTable::devnet` only. Mainnet needs its own table, built with `wasm-sol/tools/fetch_assets.mjs`. Until then, keep SPL legs refused. Zigs spends only SOL (`web/sol/transfer.js:28`). SOL id 1 is fixed (abed9d63:sdk-libs/ts/src/transaction/asset.ts:9-10).

### 2.9 App gating, worker and config

Files to change:
- `web/app-sol.js:26-37,43-73,83`: `solOn` is Devnet only. A mainnet pool mode needs a new gate.
- `web/app-setup.js:220-223`, `web/app-shell.js:999`: the create dialog says "+ Solana Devnet".
- `web/sol/main.js`, `web/sol/guard.js`: `HELIUS_HOST` is devnet only.
- `cf/src/index.js:37-38,108-158`: config routes and the plain-only file list.
- `cf/wrangler.jsonc:21,52`: production has `SOL '1'` and `SOL_MAINNET '0'`. Staging has `SOL '1'` and `SOL_MAINNET '1'`. A new flag must be off on production.
- `cf/test/gate.mjs:215-360,430`.
- `scripts/deploy-staging.sh`.

### 2.10 Docs

- `ZOLANA.md` (nullifier tree text at 720 and 1066, key and Allowed Domains questions), `PRIVACY.md:513-580,650,665-680`, `README.md`, `docs/demo.md` (freeze rule at 60-87), `docs/hackathon-*.md`, `web/privacy-language.js:35`, `web/app-sol.js:83`.
- State "Devnet only" until a mainnet pool wallet exists and the owner decides.
- The nullifier batch is now 4,999, with queue 499,900 (3c018b82:.../nullifier_tree/constants.rs:5,10). No Zigs code uses the old figures.

## 3. Consequences for existing Devnet users

- **Old pool.** Devnet now runs `ring1G...`. Upstream no longer supports `sppU489`. The new trees are empty. A new SDK cannot parse an old address, because the P-256 key does not decode as X25519 (x25519.rs:18-20).
  - Notes and funds on `sppU489` can be spent only with the old stack: the old bundle, the 41 old proving keys, the old multisig CPI into `sppU489`.
  - They also need an indexer and prover that still answer. Whether those still exist is unverified.
  - Pool-wallet funds are Devnet test funds, but the owner should decide between abandoning and draining (see section 4).
- **Registrations.** The beta registered nothing. The spike registered under `regyS5rk` with 134-byte records. Those stay as orphan data, because records have no close path. PDAs under `regy3WAe` are different accounts and start empty. Nothing to migrate.
- **Backups.** `kind zigs-sol-backup` holds `solSeed` and the key packages, but no viewing key and no snapshot (`web/sol/backup.js:36-46,80-86`).
  - After the change, the wasm computes a new viewing key, address and label.
  - The published soldone of an old wallet still has the old values, so `fitsSolana` is false. Restore refuses with "does not fit" (`web/sol/backup.js:107-111`, `web/sol/ceremony.js:493-506`).
  - The agreement state is "differ" with the text "The devices published different Solana keys" (`web/sol/ceremony.js:510-513,562-564`).
  - The file stays a valid secret store, but an old Devnet pool wallet cannot be restored into the new stack. A new wallet needs a new second DKG, which gives a new `solSeed` (`wasm-sol/src/frost.rs:320-331`).
  - Plain mainnet backups (label `mainnet-plain`) are not affected.
- **Saved snapshots.** The sealed snapshot context has no pool or label (`web/sol/store.js:36-37,40-48`, `web/sol/session.js:140-147,325-340`). A new build would show an old balance until the first sync overwrites it. Add the program label to `context(gid)` or wipe the `zigs-sol` IndexedDB on the move.
- **Approvals program.** The Devnet address is `5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL` (`solspike/tools/demo-check.mjs:72-78`). It CPIs into the pool id it was built with. Its Devnet build must be redeployed for the new pool.
- **Production.** `app.zigs.app` has `SOL '1'` (`cf/wrangler.jsonc:21`). Whether the Devnet secret is set on production is unverified. Staging only, per the staging-only rule.

## 4. Owner decisions

1. **Prover and privacy wording.** How should Zigs prove on the new pool?
   - A: local-only proving in the browser. Plaintext inputs never leave the device. It needs the `.zopro` key set and a rebuilt prover wasm.
   - B: local proving plus hosted TEE proving through a second client. It needs two CSP additions and loses plaintext capture of the prove body.
   - C: hosted TEE only. It drops the local wasm, but trust moves to the Nitro attestation and the Helius host.
   - Recommendation: A first, with B later if devices are too slow. Wording: "your device builds the proof" for A. For hosted TEE, say "an attested enclave builds the proof; Zigs cannot see it" only after the attestation check works. Do not claim mainnet privacy until the mainnet wallet exists.
2. **SDK commit to bundle.** Which one?
   - A: ts-sdk-v0.9.0-alpha (abed9d63). It is released but predates the flat tree fee.
   - B: a commit at or after 3c018b82. It matches the on-chain pool but is unreleased.
   - Recommendation: B.
3. **Web prover pin.** Which one?
   - A: unreleased 0.7.0-alpha (087bc04), built from source (Rust, wasm-bindgen).
   - B: wait for a release.
   - Recommendation: A, pinned by commit.
4. **Key hosting.** Which one?
   - A: use the CDN keys. This avoids the 25 MiB limit. It needs CORS for Range requests (unverified).
   - B: self-host. This needs R2 for the 5, 6 and 8 input keys.
   - Recommendation: A.
5. **Rust crate path.** Which one?
   - A: keep `zolana-interface` at 89640630 for parsing and change only `POOL_ID`. It is the smallest diff.
   - B: move to `spr-interface` and `spr-hasher` at 3c018b82 and rename `ConfidentialEddsa` to `ConfidentialSigner`.
   - Recommendation: B. It matches the deployed source and avoids the silent tag 0 and tag 7 break. Confirm that the old git URL still redirects.
6. **Fee cap.** Pin a cap above 5,000 (for example 10,000), or use `MAX_FEE_PER_TREE` 1,000,000?
   - The payer pays in SOL, so the cap is a payer-side loss limit.
   - Recommendation: 10,000, re-read from the tree on every proposal. The mainnet tree fee is unverified.
7. **FROST `PROGRAM_LABEL`.** Which one?
   - A: keep `zolana-devnet:sppU489...` and keep old group keys valid. This makes a confusing key mismatch instead of a version message.
   - B: a new label with the new ids, and a ceremony version marker. Every approval and soldone changes.
   - Recommendation: B. Devnet pool wallets are retired anyway.
8. **Old Devnet pool funds.** Retire, or drain with the old build first?
   - Recommendation: retire. Replace, don't deprecate.
9. **Viewing scalar label.** Keep `zigs-sol/viewing-scalar/v1`, or use a new label such as `zigs-sol/viewing-x25519/v1`?
   - Recommendation: the new label. The old name describes a P-256 scalar.
10. **Register intent.** Delete it, or port it to the 66-byte layout?
    - Recommendation: delete it. The beta never signs it.
11. **sol-program mainnet deploy.** Deploy a new mainnet approvals program?
    - This is a chain write that costs SOL. Only the owner runs it. Work sessions send the coordinator the commit, the command and the amounts.
    - It needs a new program id. That replaces `MULTISIG_DEVNET` (`wasm-sol/src/consts.rs:138`) and changes the approval digest. The expected hashes are in `sol-program/build.sh:46-48`.
    - Recommendation: Devnet redeploy first. Decide mainnet after the Devnet end-to-end check.
12. **Funded mainnet test.** Which one?
    - Options: none, a small SOL deposit and transfer, or a full group send.
    - The owner runs every mainnet value transfer.
    - Recommendation: stay on Devnet until slice 8, then one small owner-run SOL deposit and one group transfer, with a loss limit the owner names.
13. **SPL legs on mainnet.** Keep them refused until the asset table is rebuilt from the new registry?
    - Recommendation: yes.
14. **Scope of "mainnet private".** Devnet swap only, or a mainnet pool mode in the app too?
    - The deploy tag says the private wallet service is not deployed. Zigs does not depend on it.
    - Recommendation: Devnet first. Then a mainnet pool mode on staging behind a new flag, off on production.
15. **Ban on local servers.** This ban blocks `solspike/baseline.sh` (it starts wrangler dev through `solspike/serve.sh` on port 8795) and any baseline record. It also blocks the browser harness, Chrome tests, and the live tools.
    - Two tests, `web/test/demo-check.mjs:351-358` and `solspike/test/worker.test.mjs:340-346`, bind a loopback socket on `127.0.0.1` port 0 in the test process.
    - Options: keep the ban and skip those two tests; or lift it for in-process loopback sockets only; or lift it for a baseline run.
    - Recommendation: lift it for in-process loopback sockets only. Record `baseline.json` last, after the last code commit, and only when the owner lifts the ban for wrangler.

### Decisions for slices 5 and 6 (10 November 2026)

The owner took these decisions. They replace the recommendations above where they differ.

- SDK pin: the source of helius-labs/privacy-rings at 3c018b82, the shielded-pool-v1.0.0 deploy
  commit. The build checks the tree id of `sdk-libs/ts/src` (d4f0af29), so a checkout at 06eccf91
  also passes. The bundle needs `X25519PublicKey`. The SDK root lacks it, so `entry.js` takes it
  from the public `./keypair` subpath.
- Web prover: vendor the npm dist of `@heliuslabs/spr-web-prover@0.7.0-alpha` (gitHead 087bc04).
  Check it against the integrity
  `sha512-wkg85YuhR5c3QvMv2kQf4StRedZRDyfhOOuvqo1D9q42wsonCDqegVTQnCQYbLvhHF0/kl3jL8TsFvtAkWIbOw==`
  and pin it with a SHA256SUMS file for each file. This replaces D3 (build from source). Zigs does
  not ship the threads runtime. `solspike/build-prover.mjs` and the old Go prover files are
  retired.
- Proving keys: the upstream CDN folder
  `https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/78751f5d1c591777/` (`.zopro` files). The
  digests of the prover package and of the SDK pin them.
- Gate: keep the solprove switch and refuse "hosted". Proofs are local only (D1). No plain-closure
  file changes for this.
- Prover URL: `http://127.0.0.1:3001`. The wallet never fetches it over the network. The SDK
  client gets the `createFetch()` of the prover.
- `POOL_DATA` and `POOL_SLOT` are the ProgramData account of ring1G and its deploy slot, keyed by
  the Helius host. Devnet slot 520179383. Mainnet slot 467127839. The brief says that both were
  read from the ProgramData accounts on 2026-11-10. The upstream release manifest lists the same
  slots. The ProgramData address must be checked against the program account data, not only by
  derivation.
- The plain mainnet wallet does not change: the wasm of the plain wallet, `plain/`, `backup.js`
  and its closure, and the plain vectors and tests stay as they are.

### Slice 6 result (10 November 2026)

- `web/sol/prover/` holds the 17 dist modules, the single-thread runtime (`runtime/single`, its
  manifest and licenses) and the 1x2 request of 087bc04 as `selftest-1x2.json`. `SHA256SUMS`
  lists each file. `solspike/vendor-prover.mjs` checks the npm integrity and rebuilds the folder.
  `runtime.js` still names `runtime/threads/`, which is not shipped. The prover runs with
  `threads: 0` and never loads it.
- The Worker proves only at the loopback URL, through the `createFetch()` shim of the prover. The
  guard blocks every prove path of the Helius origin and every other loopback or foreign call.
  The page answer "hosted" is refused with a text.
- `POOL_SLOTS` is keyed by Helius host. `POOL_DATA` is the PDA of ring1G under the upgradeable
  loader. A test derives it.
- On-chain check of 2026-11-10: the program accounts of ring1G name the ProgramData account
  `CMV9fRyA66cwi1ce4bynyXR9zDU7f99gXZWCUNesp8xr` on both clusters. The deploy slots are 520179383
  (Devnet) and 467127839 (mainnet). The upgrade authority of the pool is
  `AftkmqRyF25wtqEFq7eqxFGCqdL2jSo8DPGZE845Xyw9` on Devnet and
  `CuZ42BsoBcLaNTUboJpGhekGmrYMZ7sRhwVki4frz1FB` on mainnet.
- Key fetch from another origin (Chromium 152): one byte range of the key folder fetched from
  another origin needs no preflight (answer 206, 16 bytes). An OPTIONS preflight to the CDN
  answers 403. Safari and Firefox are not checked.
- The privacy texts of `app-sol.js`, the help answer and the guide say that proofs are made on
  the device and that a payment is refused with local proving off. `payview.js` keeps one note
  about first proofs of an older version.
- The SHA-256 check of the key files covers a download and a cache hit of the pinned file. A load
  of the raw key form from Cache Storage (`key-store.js` `#cachedRaw`) checks the pin header, the
  format header and the byte length, and does not hash the content again. Later loads rest on the
  Cache Storage of the same origin and on the self-verify of each proof. If a stronger guarantee
  is needed, ask upstream for a content hash of the raw form.
- Not done: a proof of a request that Zigs builds with the new SDK, and a run in a browser
  (nested Workers, Cache API).

## 5. Devnet-first plan

All checks are in process: `worker.fetch` with stubs, cargo tests, fake chain. None needs wrangler or a server. Each slice may pass through one QA round. A slice that changes Zigs code needs the baseline recorded last (blocked, see decision 15).

**Slice 1: pool and registry constants, cluster, label**
- Files: `wasm-sol/src/consts.rs`, `pins.rs`, `frost.rs`, `sol-program/src/cluster.rs`, `build.sh`, `svm-tests`, test and mock files from 2.1, `web/test/sol-wasm.mjs:350-355`.
- Work:
  - Set `ring1G...` and `regy3WAe...` for both clusters.
  - Delete `DEVELOPMENT_POOL` and `ZIGS_MAINNET_POOL_ID`.
  - Use `GENESIS` as the only cluster key.
  - Change the label (decision 7).
  - Regenerate derived-address vectors.
- Checks: wasm-sol cargo tests; `sol-program` cargo tests; the `cluster` test rewritten to separate by genesis only; `cf/test/gate.mjs`; `sol-plain-*` and `sol-wasm` tests, to prove the plain wallet is unchanged.
- Depends on: decisions 5, 7, 8.

**Slice 2: crate bump and CircuitId rename**
- Files: `sol-program/Cargo.toml`, `Cargo.lock`, `src/instructions.rs:175`, `svm-tests`, `build.sh` `find_zolana`, `wasm-sol/Cargo.toml`, the `wasm-sol/vendor/zolana-hasher` copy, `repo_pins.rs`.
- Checks: cargo tests, including a svm-test that proves tag 0 is accepted and tag 7 is rejected; the nullifier PDA size 11 in `replay.rs`. The real_pool build needs an SBF toolchain.
- Depends on: slice 1, decision 5.

**Slice 3: fee model**
- Files: `wasm-sol/src/template.rs`, `rules_legs.rs`, `snapshot.rs`, `web/sol/spend.js`, `propose.js`, `worker.js`, `fee.js`, tests `p3c.rs`, `fix_round.rs`.
- Checks: new `fee_rule` tests for 1, 2 and 8 inputs (one fee per distinct tree) and for fee above the cap; JS tests for the rename.
- Depends on: slice 1, decision 6, SDK pin (decision 2).

**Slice 4: viewing key and registry cleanup**
- Files: `wasm-sol/src/roles.rs`, `viewing.rs`, `Cargo.toml`, `address.rs`, `snapshot.rs`, the register code from 2.7, vectors, `web/sol/transfer.js`, `ZOLANA.md`.
- Checks: upstream key derivation vectors in `wasm-sol/tests`; a clamp test; the hash vectors still match for the same `solSeed`; the existing checks refuse tag 1 and `update_keys` by tag.
- Depends on: slice 1, decisions 9 and 10, vector path (open question).

**Slice 5: SDK bundle, gateway, proof inputs**
- Files: `solspike/build.mjs`, `solspike/src/entry.js`, `web/sol/zolana.bundle.js` and `SHA256SUMS`, `web/sol/worker.js`, `transfer.js`, `prepare.js`, `session.js`, the Photon test stubs, tools naming `/v1/zolana`.
- Work: rename to `createSprClient`, path `/v1/spr`, `proofDataSource:"client"`, and re-derive the owner signers (no payer; check the dummy owner tag in `prepare.js` and `roles.rs`).
- Checks: `solspike/test/worker*.test.mjs` with `worker-sdk-stub.mjs`; `build.test.mjs` blob checks (needs the clone); a stub test that the signer list omits the payer and includes the PDA owner.
- Depends on: slices 3 and 4, decision 2. The bundle build is a heavy command and needs a heavy slot.

**Slice 6: prover and gate redesign**
- Files: `web/sol/localprover.js`, `localprove.js`, `worker.js` (guard, `passes`, `isProveCall`), `web/sol/prover/*`, `solspike/build-prover.mjs`, `cf/src/index.js:36,53-59`, `web/sol/session.js:23-25`, `web/sol/guard.js`, `cf/test/gate.mjs`, `web/test/sol-*.mjs`.
- Work: loopback or local client, latch, `.zopro` keys, new prover build, `POOL_DATA` and `POOL_SLOT` for `ring1G...`, a hosted TEE client if decision 1 is B.
- Checks: gate tests prove that local never falls back to hosted and that a non-loopback prove without a TEE policy is refused; CSP string tests; key size and SHA-256 table test for the 7 needed keys; selftest fixture parse. A real 1x2 proof and the `simulateTransaction` check need the live path and the owner's go-ahead.
- Depends on: slice 5, decisions 1, 3, 4.

**Slice 7: assets, approvals program, Devnet end-to-end**
- Files: `wasm-sol/vectors/*`, `assets_devnet.bin`, `tools/fetch_assets.mjs`, `asset_pins.rs`, `sol-program` Devnet build and `build.sh` hashes.
- Work: refuse SPL legs until the table is rebuilt; re-measure CU and re-pin `CU_FLOOR_*` and `LOADED_MIN_POOL`.
- Checks: in-process asset pin tests; svm-tests. The Devnet deploy and the first live run go to the owner for approval (send the coordinator the commit, command and amounts).
- Depends on: slices 1, 2, 5, 6.

**Slice 8: mainnet pool mode and docs**
- Files: `web/app-sol.js`, `app-setup.js`, `app-shell.js`, `cf/src/index.js`, `cf/wrangler.jsonc` (new flag, off on production), `scripts/deploy-staging.sh`, `ZOLANA.md`, `PRIVACY.md`, `README.md`, `docs/*`, `web/privacy-language.js`.
- Checks: `cf/test/gate.mjs` for the flag; closure test that the plain wallet closure is unchanged; privacy wording tests.
- Depends on: slice 7, decisions 1, 11, 12, 14.

Slice 8 and any mainnet transfer wait for owner approval. Staging only, never `app.zigs.app`.

## 6. Open questions and unverified claims

- Answered: tree 0 exists on both clusters with `fee_per_tree` 5,000 (section 0.1). The derived address is `777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor`, from a local calculation. The `sol_interface` and `cpi_authority` derivations matched the constants in 3c018b82:program-libs/interface/src/lib.rs:129-138. Unverified: the chain was not read.
- Compute units of transact and execute against the new pool, and the mainnet pool ProgramData size, are unmeasured.
- Does the Helius mainnet gateway serve `/v1/spr` to Photon and the prover behind the api-key URL, or must Zigs use the CloudFront hosts?
- Does the CDN answer CORS for Range requests on `.zopro` files from the Zigs origin? Does the old folder `3a1c88f90f609eb1` still exist?
- Is `@heliuslabs/spr-web-prover` 0.7.0-alpha published on npm? What is the size of `single/zopro_spr_bg.wasm`? Browser memory for the 8_2 key in a `threads:0` runtime is also unmeasured.
- Does Zigs code outside the bundle put the payer in the signer vector or use it as a dummy owner tag (`web/sol/prepare.js`, `wasm-sol/src/roles.rs`)? Not read.
- Does the wasm-sol code in the plain wallet's call path use any pool function? Only the pool id inside the wasm file was shown.
- Does `cf/src` store or validate soldone `viewingPk` or the program label? Not read.
- Where are the upstream key derivation vectors? Does any circuit or the prover bind the viewing key (the audit envelope clamp at viewing_key.rs:75-83)? Clamped bytes are the safe choice.
- Does the old git URL `helius-labs/zolana` still redirect for cargo at rev 89640630? Untested.
- Mainnet SPL registry content, USDC id, and the ProgramData address and deploy slot of `ring1G...` are unknown.
- Whether `regyS5rk` and `sppU489` still exist on Devnet, and whether any gateway still serves `/v1/zolana`, are unknown.
- Which gnark and prover version matches 3c018b82 is unverified. The claim that `prover/` still builds a browser wasm is unverified.
- Whether the Devnet secret is set on production is unknown.
- `solspike/tools/node_modules` is a symlink into a scratchpad of another worktree. Whether it is tracked in git is unverified.
- Whether each wasm-sol module (`transact.rs`, `spend.rs`, `v1.rs`) needs more than the changes listed here was not judged module by module.
- The `ZOLANA.md:45` "no audit established" claim needs a check against upstream. It was not checked.
- The upstream registry doc `docs/registry_program.md` is stale (it names program id `9EwHPNds...` and sync-delegate instructions). Do not use it as a source.
- `register.rs:46-53` does not check `nullifier_pubkey < Fr`, though docs/spec.md:3022 says it does. This does not touch Zigs.

## 7. Added after review


1. **SDK export moves in abed9d63.** The CHANGELOG says `ShieldedPda`, `ProgramOwner`, `bindProgramTransaction`, `decodeProgramTransaction`, `toProgramWalletUtxo` and `transactCpiAccounts` moved to `@heliuslabs/spr/program` and "may change in any release" (`abed9d63:sdk-libs/ts/CHANGELOG.md:19-29`).
   - Zigs uses `ShieldedAddress.forPda` at `web/sol/worker.js:209`. The report asserts it is "found at abed9d63" but never mentions this move.
   - Whether `forPda` itself moved is unverified. Recheck every pool-CPI import in `solspike/src/entry.js` and `web/sol/transfer.js`.
2. **Plain-wallet closure is wider than the wasm.** `web/sol/backup.js:9-15` imports `ceremony.js`, `docs.js`, `fee.js`, `secrets.js` and `wallet.js`.
   - `cf/test/gate.mjs:382-389` includes the backup closure in the plain served file list.
   - Any change to `ceremony.js`, `docs.js` (`CLUSTER`) or `backup.js` for the new label or restore logic therefore changes files the plain mainnet wallet loads.
   - Slice 1 and slice 4 need a plain-wallet closure and in-process test re-run, not only after wasm-sol changes.
3. **Dummy owner tags have an upstream vector.** `3c018b82:test-vectors/dummy_owner_tags.json` has `payer_seed` and `owner_tag_kind` cases (including "self-paid with change").
   - This is the right test for the report's open question about payer and dummy owner tags. Port it into the slice 5 checks.
   - The same folder has `key_derivation.json`, which answers the report's "where are the vectors" question.
4. **Tree fee payment at `ring1G...`.** Fee collection moved from per-nullifier to per-tree, in the pool, not only the SDK. The payer-balance and rent checks in Zigs sizing code (the report's "payer funding" bullet) should be listed as files to read. They are not named.
5. **Not covered by the report:**
   - SPL token flows beyond "keep refused".
   - Transaction size and address lookup tables. `web/sol/worker.js` has no ALT use (checked by grep). With 8 inputs the size margin is unmeasured.
   - Rent for the new nullifier PDA, which is 11 bytes.
   - Durable nonce use. The code reads nonce accounts at `web/sol/worker.js:380-389`. The report does not check that the proof and approval flow still fits one nonce-bound transaction.
   - Worker CSP for the CloudFront key host, only partly covered (`cf/src/index.js:36` holds the old key folder).
   - The demo and `docs/demo.md` freeze rule, named but not analysed.
   - Backups, partly covered.
6. **Stale-state risk at `web/test/sol-chain.mjs:363`.** The test stub still builds the old fee field. Rename it with the Rust snapshot field.

## 8. Status after slices 1 to 4 (10 November 2026)

Slices 1 to 4 are on branch `zolana-v1`: the program ids, the `spr-*` crates, the flat fee per
tree, the X25519 viewing key, the deleted register intent and the rebuilt wasm. One QA round gave
PASS-WITH-GAPS. One fix commit closed the findings that code can close.

- Plain mainnet wallet. No plain vector, group address, approval digest or label changed. A plain
  send refuses the new pool and registry ids and still refuses the retired ones.
  `tests/plain_rules.rs` checks all four. `tests/plain_wallet.rs` counts 97 pool rules (was 101).
- Do not deploy this branch alone. The wasm checks X25519 keys and the flat fee, but the JS and
  the SDK bundle still use P-256 keys and `feePerNullifier`. Every pool spend fails until slice 5
  lands. The JS sites: `web/sol/transfer.js:123,156,257`, `web/sol/worker.js:177-224,403`,
  `web/sol/session.js:73-95`, `web/sol/intent.js:192`.
- Slice 5 must make `vectors/ts`, `ts2`, `pay`, `roles.json` and `web/test/sol-group.json` again
  with the SDK. Now node:crypto made the keys, and the Rust code made the pay and group message
  hashes, so those hash checks are circular.
- Not run: the SBF svm-tests and ELF builds (no `cargo-build-sbf`). The `EXPECTED_DARWIN` and
  `EXPECTED_LINUX` hashes in `sol-program/build.sh` are stale. The approvals program needs a Devnet
  redeploy, which the owner approves.
- Known limits: `fee_rule` charges the input tree fee for each distinct tree (pins use tree 0
  only). `vendor/spr-hasher` keeps light-poseidon 0.4 and ark 0.5; the upstream hash vectors pass.

## 9. Slice 8: the private mainnet wallet on staging (11 November 2026)

The owner took three decisions on 10 November 2026. They replace the recommendations above where
they differ.

1. Override SOL-45 (a multisig upgrade key with a time lock before mainnet) and the audit no-go of
   ZOLANA.md 7, for staging only, with a cap: the checker refuses a shield that takes the private
   balance of a group above 0.5 SOL.
2. A new mainnet approvals program `9mE7WUJHK6dQwzK6AP6wf1eyPmePULZrGeRbXqke2ukq`. The owner
   alone holds its upgrade authority `iFSbwFzpLpaGMKtn5S6gznvzXqAVunoB6rcSpGi956o` for the staging
   test. It moves to a Squads multisig with a time lock before any production use.
3. A new mainnet wallet becomes private by a mode that device 1 chooses at setup and that every
   device accepts. Existing plain mainnet wallets stay plain.

Slices 8a to 8e and 8g are merged on `zolana-sdk` at `e38961ed`. Slice 8f is this record, with
the deploy record in ZOLANA.md 6.15 and the custody record in ZOLANA.md 7.2.

- **8a, program.** The test rig loads the mainnet ELF at `9mE7…`. The shared vector
  `wasm-sol/vectors/program/mainnet.json` holds the owner PDA, the proposal and cancellation
  addresses and the approval digest under `9mE7…`. The svm-tests and `wasm-sol/tests/mainnet.rs`
  both read it, so the wasm and the program must agree. `EXPECTED_MAINNET_LINUX` in
  `sol-program/build.sh` pins the mainnet ELF (`00aa2169…`, 54,728 bytes).
- **8b, checker and cluster binding.** The checker has a mainnet row: the label `mainnet-private`,
  a program label that ends in `9mE7…`, and the mainnet genesis. The pins wire has 194 bytes and
  starts with a cluster byte. `Pins::decode` refuses an RPC genesis that is not the genesis of the
  row. The pool Worker binds to the cluster of its wallet and checks `getGenesisHash`. The rule
  `shield-over-cap` refuses a shield above the cap (98 pool rules). On mainnet the group key signs
  no v1 message: CreateNonce and Transfer are retired there. The plain differential compared the
  new wasm with the slice 8 base.
- **8c, transport.** `/sol/worker-mainnet.js` serves the body of `/sol/worker.js` with a policy
  that names only the Helius mainnet host and the folder of proving keys. The server answers 404
  for it unless `SOL` and `SOL_POOL_MAINNET` are both `"1"` (D14). The private wallet reads its
  URL from `/sol/config-mainnet.json`, the secret of the plain wallet. `web/sol/net.js` holds the
  cluster table of the pool pages, and no plain-closure file imports it (`cf/test/gate.mjs`).
- **8d, setup, routing and restore.** Device 1 offers the private wallet when it makes a mainnet
  wallet. Each device accepts it before it joins, with a first-seen pin `solmode:<wallet id>` in
  `zf-signpins`. A private mainnet wallet opens in the pool controller, and a `mainnet-private`
  backup file restores through the private route. The local proving switch binds to the label of
  the wallet.
- **8e, Add SOL and texts.** Add SOL first checks that the approvals program exists, runs and
  belongs to the upgradeable loader. On mainnet it then syncs and refuses an amount above the room
  under the cap, and it counts the Add SOL of the tab that a sync does not show yet. A mainnet
  wallet that names no cap refuses Add SOL. The payee of a private payment binds to its network,
  and a mainnet withdrawal to a program address is refused. The public PDA copy and the move card
  do not show on mainnet.
- **8g, wallet page.** The Solana tab shows for a private wallet that waits for the accept or that
  the server does not serve. The SOL row opens it, and the page names Solana Mainnet.
- **Deploy.** The owner deployed `9mE7…` on 11 November 2026 in slot 468153564 (ZOLANA.md 6.15).
  A read-only preflight the same day passed: the program and its ProgramData, tree 0 (G2, closed)
  and the genesis. G6, a landed Zigs v1 message on mainnet, is open: the repo records no plain
  mainnet send from staging.
- **Still open.** `SOL_POOL_MAINNET` is `"0"` on production and on staging at `e38961ed`; the
  owner turns it on for staging only. The owner steps have not run: the setup of the first
  private wallet, the funding of the fee addresses, one shield, one private send, one withdrawal
  and the cap check. The repo records no Zigs payment through ring1G on any cluster. The baseline
  record waits for the end of the local-server ban.
