# Deslopify checkpoint and release rehearsal

Validated 13 November 2026 on `deslopify`, for draft PR #2 into `Near`.
The branch includes `Near` at `97e7621` and retains portfolio tracking, Solana receiving,
the icon system and the OpenGlass presentation. Work was isolated from the separate
`nextlevelvisuals` checkout. No target branch was merged or deployed by this rehearsal.

## Integration and corrections

- Preserve the three navigation groups, direct access to all eight destinations, prominent
  Restore shortcut, and browser-local recovery evidence with separate remote reports.
- Keep financial cards, balances, dialogs and receipts opaque within the restrained glass shell.
- Retain native validation inside semantic dialog hosts, recovery-file selection, messaging drafts,
  current network gates and phase-appropriate payment instructions.
- Give Swap's main region a valid accessible name when optional demo tabs are absent.
- Keep focused fields and labels clear of measured sticky dialog headings and actions in WebKit,
  including 320px layouts. Reading scroll remains under the person's control.
- Show the pending restore notice even before a wallet's group record loads. A real cold restore
  while the disposable browser was offline exposed this missing notice. The recovery flow now
  reports pending verification, then reports success only after the original address matches.
  The OpenGlass browser regression covers this unloaded state in both themes and three sizes.
- Place the initial-setup device reminder inside the approval-rule controls. This retains Near's
  warning while removing 17px of overflow at 1366 × 768. The subsequent Near setup polish
  moves this guidance into its approval explanation; that arrangement is retained.

## Automated validation

Latest ignored evidence directories are `solspike/.state/validation-final-*` and
`solspike/.state/validation-merged-ux`. Logs are local `/private/tmp/zigs-validation-*.log` files.

| Check | Result |
|---|---|
| Production OpenGlass build | Passed; separate wallet modules and worker URLs retained |
| OpenGlass browser check | Passed: themes, native input identity, cached content, modal dismissal, real unfunded boot and strict CSP |
| Integrated OpenGlass UX states | 30 views, no browser errors; includes cold restore before group loading |
| Chrome interface review | 1,152 checks, 168 layouts, 50 composer-focus variants |
| Chrome journey review | 579 checks, 156 variants |
| WebKit journey review | 579 checks, 156 variants |
| Messaging regression | 145 checks, 34 captures, no uncaught browser errors |
| Fast regression suite | 82 of 82 passed, including the reference QR check |
| Repository lint | Passed: 318 JavaScript and two Python files |
| Full baseline gate | Passed: 93 tests, 22 hashed files, zero problems |

After the concurrent Near setup-artwork update (`97e7621`), the fast suite (82/82), real
unified-setup regression, build, lint and full interface review were repeated. Chrome and WebKit
journeys recheck both themes, 48px actions, inline navigation and short desktop windows. The
transaction and recovery code was unchanged by this later integration. The retained capture
links below precede that later artwork update; current captures remain in ignored
`solspike/.state/validation-setup-*`.

The full baseline ran afresh on `eec59ad` under Node 26.12.1, including QR; no cached test exits were reused.

The two prior tooling failures are fixed without dropping assertions. The policy test checks the
unchanged source SHA-256 and all three URL policies already pinned in `baseline.json`, avoiding
an absent historical commit. The differential tool decodes filesystem URLs and uses historical
full commit IDs present in this repository. Its slice-8 WASM still matches the original hash;
the pre-v1 artifact has an independent hash pin. All 4,552 calls pass, including eight expected old
plain-wallet differences and seven expected pool differences. The check also passes through a
path containing spaces. No engine binary was rebuilt.

The baseline previously referenced a missing commit. Its 22 hash pins were audited against the
corresponding imported history; five had subsequently changed on existing main. Those five now
match existing main `eb533917eaee7b70c4348c502e944064513c4c42` byte for byte. The remaining
hashes, source policy, URL policies and served-header expectations are unchanged. The test list
includes the existing unlisted tests and helpers, with passing results required. This is an
explicit repair of historical metadata, rather than a replacement of all expectations with the
current output.

The QR reference was built from official libqrencode 4.1.1 source in `/private/tmp`, verified
against archive SHA-256 `5385bc1b8c2f20f3b91d258bf8ccc8cf62023935df2d2676b5b67049f31a049c`.
All five reference matrices match module for module. Node 26.12.1, the QR tool and browser
profiles were temporary local tools; no global package installation was needed.

Reproduce with Node 26, `qrencode`, Chrome and the pinned project dependencies:

```sh
npm ci --prefix web --no-audit --no-fund
npm ci --prefix solspike --no-audit --no-fund
npm ci --prefix cf --no-audit --no-fund
npm run build --prefix web
sh scripts/test-fast.sh
bash solspike/lint.sh
bash solspike/baseline.sh check
node web/openglass/browser-check.mjs
```

The baseline needs the documented local `cf/.dev.vars` with `DEV_NO_AUTH=1`.
Browser tools accept `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE`; point the former at
`web/node_modules/playwright/index.mjs`. The WebKit run uses the same journey source with
its launcher changed to the matching Playwright WebKit engine. It is not a physical iPhone test.
Copied upstream skill and Stageshow sources retain their original formatting; first-party
changes pass `git diff --check` with those vendor directories excluded.

## Real testnet rehearsal

These checks ran against the actual app and committed engine using separate disposable Chrome
contexts on one Mac, including a 390px context. They did not use synthetic wallet/session records.
The local development coordinator used `DEV_NO_AUTH=1`; the chain was public Zcash testnet.
Only newly generated test wallets and test coins were used. Private recovery files, passphrases,
invites, keys and browser state remain ignored locally and are absent from the PR.

| Journey | Observed result |
|---|---|
| Formation | Real 2-of-3 and 2-of-2 ceremonies completed; all participants derived the same testnet address. Complete safety codes were compared before acknowledgement. |
| Invalid recovery | Wrong passphrase and corrupted ciphertext each stored zero shares. |
| Cold recovery | Actual encrypted backup restored in a fresh browser while offline. Pending verification remained visible, no premature success appeared, and reconnection verified the original address. Restored nonces were empty. |
| Recovery followed by spending | Device 1 of the funded 2-of-2 wallet was closed and restored from its actual UI-exported encrypted backup into a fresh browser. That restored share then approved and signed the payment below. |
| Interrupted approval | The second browser was offline while the restored first browser approved. Exactly one approval was present; proof and broadcast actions were unavailable. Reconnection retained the same proposal and exact recipient/amount, then the second browser approved. |
| Submission and inclusion | Two approvals and two signature shares produced a verified combined signature and proof. The actual Send action submitted one transaction. Submission was observed before block inclusion; the wallet later reported it in a block. A separate recipient scan found the exact amount spendable. Only one proposal existed. |

The app's configured Valar faucet definitively failed both shielded and transparent test-address
claims with “the wallet cannot pay this address”; neither returned a payout transaction.
The user explicitly approved a claim through [Fauzec's documented API](https://fauzec.com/).
It supplied 1 test ZEC; the app waited for spendable funds before preparing the payment.

- Funding transaction: `aa79c87e2b05b92832e06577978e17c8e3ceff63a136484b2e2fa6bbab7e39f2`.
- Payment transaction: `191701b1aa02e50df8ee519a52fecaa27eafb4d38c9ed2adf05d9ff74e50c31a`.
- Payment: 100,000 zat (0.001 test ZEC); fee: 10,000 zat (0.0001 test ZEC).
- Sender's confirmed scan height: 4,617,073. Independent recipient scan at 4,617,074:
  one note, 100,000 zat spendable, zero pending.
- Application source: `e4f066a` plus the two-line setup-layout fix subsequently committed as
  `eec59ad`. The layout fix does not alter transaction handling.

## Remaining release evidence

Physical phone/laptop setup and recovery still need independent hardware. A 390px browser
context establishes responsive rendering, not mobile operating-system behavior or device
independence. Usability with an unfamiliar person also remains unperformed.
Screen-reader testing was removed from this pass at the user's request. No further Mac settings
changes are authorized. The draft PR remains a review checkpoint; these results do not authorize
merging into `Near`, merging into `main`, or deployment.

The earlier independent **36/40** assessment predates integration. This validation does not
invent a new score or establish 40/40. A fresh assessment and the remaining human/device evidence
are needed for that claim.

## Review captures

These captures contain synthetic, unfunded renderer state:

- [Light desktop overview](visuals/deslopify-checkpoint/overview-light-desktop.png)
- [Dark desktop overview](visuals/deslopify-checkpoint/overview-dark-desktop.png)
- [Light desktop setup](visuals/deslopify-checkpoint/setup-light-desktop.png)
- [Dark phone setup](visuals/deslopify-checkpoint/setup-dark-phone.png)
