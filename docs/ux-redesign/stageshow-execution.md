# Zigs experience pass — execution record

Implemented on `deslopify`, from `Near`. No commits, merges or deployments were made; `main`
remains untouched. The previous graphite/chalk redesign is the foundation, with the zebra,
Manrope, Geist Mono, restrained icy blue, light-aware balance surface, quiet glass and soft
window elevation retained.

Method: [Stageshow](https://github.com/benjitaylor/skills/tree/main/stageshow), used to build,
film and review six isolated journey illustrations before carrying their form and receipt
patterns into the production DOM/CSS. The existing [unslop direction](deslopify.md) and
[approved plan](stageshow-plan.md) remain the design context.

## Implemented

- A local design viewer at `web/dev/stageshow/`: six journeys, light/dark, separate compact
  compositions, native keyboard controls, Pause/Resume, Replay, and useful result posters.
  Reduced motion goes directly to the poster. The authored interface is hidden from the
  accessibility tree; the surrounding descriptions and real viewer controls remain available.
- Payment composition now groups recipient validation with the recipient and amount validation
  with the amount. Multi-recipient removal, saved recipients, precise values and memo fields
  keep their existing owners and behavior.
- Payment reviews read as one document: a deliberate total, full recipient records, separate
  costs and signing rule, then the actual proposal action. Mismatches still omit that action.
- Receive groups the QR and complete address as one destination. Normal receiving puts that
  destination and Copy before the longer privacy explanation. Restricted, unverified and moved
  wallets retain their leading explanation. No guidance or network restriction was removed.
- Copy feedback is announced on the existing control. The confirmation describes a clipboard
  action, never a deposit or payment.
- Backup/check/restore sheets share measured field spacing and readable file controls. Saved,
  checked, restored and other-device reports remain separate facts.
- Address-book records, message requests, device details, safety comparison, drawer recipients
  and settings details share the same spacing and long-content treatment. The Settings
  disclosure chevron now receives one correct rotation rather than two additive rotations.
- The entire Stageshow lab is excluded by `web/.assetsignore`. Its React dependencies, copied
  kit and development viewer are not part of the deployed wallet assets. Production keeps its
  existing module architecture.

## Surface and state disposition

“Kept” means the existing presentation was retained after reviewing it against the direction;
new styling is not required merely to make a screen different. Renderer evidence uses synthetic,
unfunded fixtures. Model tests establish state behavior, not an assertion that a live network
ceremony was performed. Exception states listed below retain the original capability gates.

| Area | Disposition and states | Evidence |
| --- | --- | --- |
| Shell / wallet context | **Kept/refined:** rail, current wallet/network, multi-wallet list, long context, open/closed mobile menu and focus return; locked/startup states keep existing controls | Main renderer matrix, orientation, app, optional-passkey |
| Home / collection | **Kept:** first visit, returning collection, no wallets, Create/Join/Recover hierarchy; loading/unsupported and Join validation remain explicit | Main matrix; startup/source review, setup and app tests |
| Create / browser protection | **Kept:** protection choices, unavailable/cancelled protection, Skip consequence, rule, names, review/back; no duplicate continuation | UX fixtures for four steps and Skip at 320/390/1440; guided-create, optional-passkey, passkey-setup |
| Join / formation | **Kept/refined:** invitation, waiting/partial participation, code comparison, mismatch, interrupted formation and address checks; full 30-digit safety value retains space | Setup scene; setup-stage, guided-setup and app tests; existing formation handlers inspected |
| Overview / assets | **Kept:** balance focal point, native amounts, empty/zero, incoming, unavailable fiat/assets, loading/stale and partial-sync distinctions | Main matrix; overview, sol-wallet-page, sol-plain-view and payment-model |
| Receive / funding | **Refined:** verified destination, QR/address grouping and Copy; **kept:** unavailable/unverified address, network restrictions, caps, moved wallet, transparent receive/sweep and Solana fee/rent prerequisites | Receive scene; main/UX fixtures; app, sol-rent, sol-plain-review and funding renderers |
| Send composer | **Refined:** validation locality, amount lane, memo rhythm and summary; **kept:** blank/invalid/saved/name/request inputs, Max, exact amounts, add/remove payee and draft | Main/UX fixtures; app lookup/request regressions, payees, recipients, payment-model |
| Payment review | **Refined:** receipt hierarchy, full address records, totals and costs; **kept:** decoded/blocked review, back/edit, changed outputs, memo and proposal semantics | Payment scene; UX matched/mismatch fixtures; app, payees, payment-model |
| Approvals / signing | **Kept/refined:** stable request amount, details and device contributions; needs review/waiting/ready/attention, held, expired/cancelled, proof/send/uncertain outcomes stay distinct | Approval scene; main matrix; approvals model combinations, app, shim-status |
| Activity / receipts | **Kept/refined:** ledger rhythm, amount alignment and readable drawer recipients; empty/populated, incoming/pending/included/failed, partial history and identifiers preserve their existing states | Main matrix; app, overview, payment-model; existing activity/receipt renderers inspected |
| Address book | **Refined:** address blocks/editor surface; **kept:** local-label explanation, search/no results, add/edit/delete/cancel, validation and long data | Main matrix; UX editor, recipients, app |
| Swap | **Kept:** pair/amount/receipt hierarchy, network and quote-only capability, loading/stale/unavailable/review/execution paths; quantum illustration remains labeled | Main matrix; swap-preview, near-quote and existing adapter renderers |
| Messages / requests | **Refined:** thread rhythm, request surface, readable long text; **kept:** team/direct, unread, sending/failure/retry, invite, request-to-Send and leave states | Messages scene; messaging renderer suite; messaging-presentation, requests, app |
| Zcash messaging account | **Kept:** separate funds and fee scope, creation/funding/contact/cost review, unavailable/damaged and backup/restore states | Messaging renderer suite; messaging-cost-review, messaging-account-view, account, personal |
| Security / devices | **Kept/refined:** rule hierarchy, device labels, long details and backup states; unfinished/formed, local/other/unknown reports remain explicit | Main matrix; security-dashboard, recovery, app |
| Backup / restore / replacement | **Refined:** shared sheet/file treatment; **kept:** passphrase validation, busy/error, saved/check/restored distinction, stale restore and replacement consequences | Recovery scene; UX save/check/restore/replacement fixtures; backup-check, recovery, app |
| Settings / connection / support | **Refined:** long descriptions/details and correct disclosure rotation; **kept:** appearance/system, notification permissions, descriptions, memo, network/Tor preview, diagnostics and forget consequence | Main/UX fixtures; orientation, wallet-description, app |
| Education | **Kept/refined:** original art, legible captions and chapter controls in both themes; pause/reduced motion, guide/journey and source details remain available | Education/support matrix, messaging tutorials, help and orientation tests |
| Shared states / mobile | **Kept/refined:** empty/busy/error/outcome family, full controls, focus retention, long data and small heights; motion/transparency/forced-color fallbacks | Main + UX + viewer matrices; contrast, orientation, app |

## Verification record

- Real-renderer matrix: **549/549 checks pass**. Final result recorded in
  `solspike/.state/stageshow-production-qa/results.json`.
- Detailed production journeys: **572 checks, 156 state variants**, including setup, matched and
  mismatched payment reviews, backup/save/check/restore, replacement, direct chat, contact,
  deletion consequences, Address book, Settings and network details. Browser wallet storage
  remained unchanged. `solspike/.state/stageshow-journeys-qa/report.json`.
- Populated Messaging: **145 checks, 34 screenshots, zero browser errors**, covering team,
  direct and Zcash conversations, requests, invitations, failures, cost review and tutorials.
- Viewer: **106 checks**, including all 24 combinations of scene/theme/width, primary contrast,
  action/footer crop clearance, keyboard playback, preference switching and reduced motion.
- Stageshow: **24 opening stills, 24 result posters, 24 complete motion captures and 24
  marked-state captures** pass the rehearsal gate. The final `shots/verification-summary.json` verifies **96/96 complete captures**, including every
  updated report; no failed or incomplete native recordings are counted.
- Lab TypeScript, standalone build and CSS namespace check pass. Production lint passes for
  297 JS and two Python files; `git diff --check` passes.
- Full `web/test/app.mjs`: **app ok**. Fast suite: **74/76 pass** under Node 26 with loopback
  access. `qr.mjs` skips because `qrencode` is not installed.
- Two existing fast-suite issues remain: `policy.test` depends on historical baseline commit
  `0a21b…` whose expected Worker source is absent from this repository history;
  `plain-equiv.test` uses URL `.pathname` without decoding spaces in the workspace path.
  Neither is caused by these presentation changes.

Visual review caught and corrected dark primary foregrounds, weak success ticks, light-logo
contrast, clipped compact glyphs, bottom action clearance, status-as-action labels, conversation
context, a total displayed before its amount was entered, and stale intermediate approval copy. The final fresh-eye review found
nothing in the refreshed sampled compositions and payment timing. See the scene rehearsal log.

## Scope of the evidence

Chrome on macOS; desktop widths through 1440, responsive widths down to 320, plus the dedicated
358px compact illustration inside a 390px viewport. Light, dark and system inheritance,
keyboard, enlarged text, forced colors, reduced motion and reduced transparency were exercised.

These checks use isolated synthetic state and stub decoders. They do not establish live-chain
performance, successful real payments, physical-device recovery or WebAuthn behavior, Safari/
Firefox rendering, or actual phone keyboard/hardware frame rate. Existing cryptographic,
network, proposal, signing and backup handlers remain the authority for those capabilities.
The lab's deterministic film clock proves sampled geometry and sequence; it does not establish
physical-device frame pacing. Earlier native film runs with screenshot-induced sampling gaps
are retained as inconclusive evidence and are not counted as passes.

The exact reproduction commands and licensing are in `web/dev/stageshow/README.md`.
