# Deslopify checkpoint and release rehearsal

Prepared 13 November 2026 on `deslopify`, for a draft PR into `Near`.
The redesign checkpoint is `b4830f3`. Integration includes `Near` at `fc8d504`;
the newer portfolio, Solana receiving, icon system and OpenGlass presentation remain available.
Neither target branch is merged or deployed by this checkpoint.

## Integration details

- Preserve the three navigation groups, direct access to all eight destinations, the prominent
  Restore shortcut, and browser-local recovery evidence with separate remote reports.
- Keep native forms inside semantic dialog hosts, persistent recovery-file selection, messaging
  draft behavior and phase-appropriate payment instructions.
- Retain Near's current feature and network gates. Receive uses its current address rendering
  and supporting disclosures. Copy buttons retain icons and polite announcements.
- Give Swap's main region a valid accessible name when optional demo tabs are absent.
- Keep financial cards, balances, dialogs and receipts on opaque surfaces within the glass shell.
- Correct WebKit focus scrolling using measured sticky dialog chrome. At 320px, native focus
  previously placed the payment field behind a 123.5px heading. Focus now clears the actual heading
  and actions. Adjustment occurs on field focus or keyboard opening, without overriding reading scroll.
- Update browser fixtures for the production OpenGlass entry, current welcome heading and stable
  messaging transport IDs. Wallet boot is suppressed in synthetic renderer fixtures.

## Automated validation

Final results and logs are retained locally in ignored `solspike/.state/deslopify-near/`.

| Check | Result |
|---|---|
| Production OpenGlass build | Passed; separate wallet modules and worker URLs retained |
| OpenGlass browser check | Passed; actual shell, theme changes, native input identity, cached content, modal dismissal, real unfunded app boot and strict CSP |
| Chrome full interface review | 1,152 checks, 168 layouts, 50 composer-focus variants |
| Chrome journey review | 579 checks, 156 variants |
| WebKit journey review | 579 checks, 156 variants |
| Messaging regression | 145 checks, 34 captures, no uncaught browser errors |
| Node 26 app and unified setup | Passed |
| Fast regression suite | 77 of 79 passed; QR check skipped because `qrencode` is absent |
| Repository lint | Passed: 314 JavaScript and two Python files |

The two fast-suite failures also occurred before integration: `policy.test.mjs` requests
`cf/src/index.js` at a historical commit that does not contain that path; `plain-equiv.test.mjs`
uses the URL-encoded workspace directory as a filesystem path. Their checks are not waived or
reported as passing. Full baseline, live transactions and physical-device checks remain open.
The copied upstream skill and Stageshow assets include their original whitespace/Windows line
endings; first-party changes pass `git diff --check` with those vendor directories excluded.

Reproduce with Node 26, a Chrome installation, and the pinned project dependencies:

```sh
npm ci --prefix web --no-audit --no-fund
npm ci --prefix solspike --no-audit --no-fund
npm run build --prefix web
sh scripts/test-fast.sh
bash solspike/lint.sh
node web/test/app.mjs
node web/test/unified-setup.mjs
node web/openglass/browser-check.mjs
```

The browser tools in `solspike/tools/` accept `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE`.
Point `PLAYWRIGHT_MODULE` at the installed `web/node_modules/playwright/index.mjs` when running
those tools from the repository root. Output environment variables keep captures in ignored
state directories. The WebKit run uses the same journey source with its browser launcher changed
to the matching Playwright WebKit engine; it is not a physical iPhone test.

## Live and human checks still to run

This machine lacks the configured live-test environment, RPC credential and staging password.
No live rehearsal or funded payment was attempted. A synthetic browser state, an encrypted-file
fixture, and a real unfunded app boot each establish different evidence; none proves settlement
or recovery on independent hardware.

| Journey | Rehearsal and acceptance criteria | Status |
|---|---|---|
| Setup | Use a phone and laptop on test networks. Create and join, compare the complete safety number and address, and confirm the chosen approval rule. Include one cancelled protection prompt. | Needs configured test environment and physical devices |
| Payment approval | Receive test coins, review the exact destination, amount, fee and network, collect required approvals, submit, and verify inclusion separately from submission. Never use mainnet funds. | Needs configured test environment |
| Interrupted connection | Disconnect during coordination; reconnect and inspect the existing proposal before retrying. Confirm truthful progress, retained drafts and no duplicate action. | Live fault rehearsal pending; synthetic messaging regression passed |
| Backup and restore | Save distinct encrypted recovery files and separate passphrases. Check each file, try a wrong file/passphrase, then restore into a fresh browser on another device. Confirm share identity and the ability to participate in a subsequent test payment. | Physical restoration pending; encrypted-file and form fixtures passed |
| Screen reader | Use VoiceOver or NVDA through navigation, creation, payment review and file selection. Verify announcements, exact values, validation, modal focus and return focus in both appearances. | Human assistive-technology check pending |

Run a live batch only from a clean checkout of the reviewed `deslopify` commit, using the existing
coordinator workflow documented in `solspike/README.md`. Keep keys, passphrases and recovery
files out of the PR and screenshots. Record the commit, network, device/browser versions,
transaction IDs and outcome for each completed check. Merge review remains separate.

## Review captures

These captures contain synthetic, unfunded renderer state. They show the integrated presentation;
the earlier independent **36/40** score describes the pre-integration assessment and is not a new
score for the merged interface.

- [Light desktop overview](visuals/deslopify-checkpoint/overview-light-desktop.png)
- [Dark desktop overview](visuals/deslopify-checkpoint/overview-dark-desktop.png)
- [Light desktop setup](visuals/deslopify-checkpoint/setup-light-desktop.png)
- [Dark phone setup](visuals/deslopify-checkpoint/setup-dark-phone.png)
