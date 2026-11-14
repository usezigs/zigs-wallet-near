# OpenGlass flow audit

Reviewed 2026-11-13 on `codex/near/glass`, against the working tree based on `fc8d504`.
This is an interface/material audit, not a cryptographic or financial security audit.

The presentation matrix passes all **952 variants**: 119 states at 320, 390, 768 and 1440px,
each in light and dark. It reports zero uncovered major surfaces, untreated buttons, unresolved
ARIA references, unlabelled fields, horizontal page/dialog overflow or browser runtime errors.
A second scan of visible section/article/aside/form/disclosure backgrounds found no remaining
unclassified major opaque panels. Screenshots were visually reviewed by screen family; this
does not mean every one of the 952 variants received individual visual inspection.

The initial material scan excluded the welcome hero as brand artwork, so its passing result
missed that surface. The hero is now mandatory: its OpenGlass layer sits above the artwork and
below the text/actions, with shallow refraction, a lit rim and interaction reflections. The
follow-up passes all 72 entry-state variants plus 12 dedicated new/returning welcome layouts,
including light-mode action contrast, actual Create/Join controls, reduced motion,
reduced transparency, forced colors and strict CSP.

## Coverage

The subsequent [Near Swap review](near-swap-glass.md) verifies the updated Swap feature from
`74d1acd`, including all 25 Swap states in 200 variants. Its sixth simulation step brings the
current full audit command to 120 states/960 variants. The 119-state/952-variant result above
records the preceding full run; the newer targeted result is recorded separately.

| Family | States | Included states |
| --- | ---: | --- |
| Main navigation | 8 | Overview, approvals, activity, recipients, Swap, messages, security/recovery, settings |
| Recipients | 6 | Saved, add, validation error, edit, deletion warning, no results |
| Entry/system | 9 | New, returning, join, locked, damaged, engine/group loading, offline, error |
| Create wallet | 4 | Protection, arrangement, names, final review; explicit Skip warning tested interactively |
| Dialogs | 12 | Send, multiple recipients, invalid send, receive, backup, busy/check backup, restore, device changes, new chat, help, network/privacy |
| Guided setup | 8 | Connect, join, verify, mismatch, prepare, stopped, backup, complete |
| Approvals | 10 | Empty, requested, waiting, multiple, loading, failed, review, failed/unknown review, completed |
| Activity | 8 | Empty, populated, filtered, loading, error, Solana, 105-row history, receipt |
| Receipts | 9 | Submitted, confirmed, stale, failed, large, unreadable; Solana confirmed, failed, expired |
| Messaging | 9 | Team/direct/contact, changed key, invite, setup, cost review, add contact, guide |
| Solana | 12 | Receive, settings, security and payment tools for plain, private and devnet wallets |
| Swap | 24 | Composer, both pickers, details, slippage, review, five simulation steps; quantum configuration, review, expiry, approvals, progress, delivery and refund; unavailable/unsupported states |

The audit scripts retain the exact state names. The accompanying
[result summary](openglass-flow-audit.json) records every state and the validation totals.

## Gaps fixed

- Applied actual OpenGlass materials to the remaining security/device panes, setup stages,
  invitations, message panes, payment tools, receipts, Swap panels, guides and native controls.
- Preserved the original hierarchy of native cards. An automatic Card content wrapper had
  disrupted direct-child layout rules, including mobile messaging. A decorative Glass portal
  now supplies the material without restructuring those panels.
- Extended the theme and material scope to native Swap dialogs mounted outside the React root.
  They follow both system appearances and receive the same interaction highlights and opaque
  accessibility fallbacks as the rest of the app.
- Made selected tabs/filters visibly distinct while preserving their native selection semantics.
- Corrected Swap's missing panel-label reference and kept the mobile message composer visible
  after focus and layout settling.
- Preserved input node identity, draft values, native event handlers, disabled actions,
  background inertness, dialog keyboard containment and focus restoration. Copy feedback keeps
  React's component structure intact.

Inputs, QR backing plates and safety notices intentionally retain readable fills. Reflections
respond to hover/focus; labels, balances and QR codes do not move. Reduced motion, reduced
transparency and forced colors disable the decorative effects as appropriate.

## Validation

| Check | Result |
| --- | --- |
| OpenGlass build | Pass |
| Presentation matrix | 119 states, 952 variants; zero issue cases/failures/runtime errors |
| Focused interactions | 86 checks passed |
| Existing full UI review | 1,141 checks, 168 layouts and 50 composer-focus variants passed; zero runtime errors |
| OpenGlass smoke/cold boot | Pass, including strict CSP, retained native controls, both appearances, small viewports, keyboard and forced colors |
| Fast regression suite, Node 26 | 77 of 79 executed tests passed; two unrelated failures described below; QR test skipped because `qrencode` is unavailable |
| Patch whitespace | `git diff --check` passed |

The fast-suite failures are in unchanged tests: `solspike/test/policy.test.mjs` requires the
historical baseline tree `0a21b347774868e54d227a46b4024710dd7a3f44`, which is unavailable in this
checkout; `solspike/test/plain-equiv.test.mjs` treats the URL-encoded space in this checkout's
path as a filesystem path and fails its Git invocation. They do not pass here, and are not
counted as passing UI verification.

The browser runs use local Chrome and the production presentation renderers with disposable
synthetic stores and blocked external requests. They exercise actual controls where useful;
approval/receipt/error outcomes use staged display fixtures. Create stops at final review,
and payment flows stop before transaction signing or submission. Mock Swap simulation outcomes
are exercised as demos. No real wallet was created, funded or used to send a transaction.
Physical-device and Safari behavior have not been validated by this audit.

## Reproduce

```sh
npm ci --prefix web
npm run build --prefix web
npm run test:openglass --prefix web
npm run audit:openglass --prefix web
```

Both audit scripts select local macOS Chrome when installed, otherwise Playwright Chromium.
Set `CHROME_EXECUTABLE` to use another Chromium binary. Set `OPENGLASS_AUDIT_OUTPUT` for a
persistent report/screenshot directory. `OPENGLASS_AUDIT_SCENES` optionally filters the
presentation matrix by a regular expression; a filtered run is not the complete audit.

The separate full UI suite is `solspike/tools/full_ui_review_browser.mjs`; it uses
`PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE` and `ZIGS_FULL_UI_OUTPUT` to select its runtime and
evidence directory. The fast regression command is `sh scripts/test-fast.sh` with Node 26.
