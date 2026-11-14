# Impeccable documentation, critique and polish

Completed on `deslopify`, 13 November 2026. No commit, push, merge or deployment.

## Design system

Root `DESIGN.md` records the implemented light/dark palettes, type roles, spacing, geometry,
elevation and component conventions. `.impeccable/design.json` extends it with token metadata,
motion, breakpoints and eight self-contained component previews. The approved creative direction
remains “Discreet, precise, a little wild,” with the original zebra and restrained glass utility
surfaces. Product and financial documents remain opaque.

## Independent critique

Two isolated reviewers inspected setup, approval and recovery. Assessment A finished before B's
detector findings entered synthesis. The source target is `web/app-shell.js`, slug
`web-app-shell-js`. No ignore list existed.

The initial assessment scored **29/40 (Good)** across all ten Nielsen heuristics. This is the first
recorded score for this target; it is not a score for the polished result. The complete critique
was delivered in chat before saving the snapshot
`.impeccable/critique/2026-11-13T17-43-09Z__web-app-shell-js.md`.

The six-file static scan returned zero findings. Three runtime views produced six occurrences:
two selected-device glows, two short final lines, a nested device-group diagram and a recovery
guidance accent. The latter two were judged intentional product communication. The selected-device
halo was removed while retaining its selection outline; counter descriptions were shortened.

Native browser access failed with the shared-profile lock. Reviewers used separate isolated
Chrome processes instead, preserving existing user tabs. B successfully injected the detector into
three headful views, captured its overlays and console results, then closed the browser. Its helper
on port 8400 was stopped with `live-server stop --keep-inject`. Existing preview servers were left
running. No CSP or production HTML was changed for the critique.

## Decisions and resolved priorities

The user chose browser-local recovery headlines with separate remote reports, and concise payment
privacy summaries with expandable detail.

1. **Recovery scope (P1):** local file checks now have a local denominator and an explicit completed
   state. Remote reports remain separate and qualified. Backup/check actions identify the device
   and chain. Concentration, unknown-scope and missing-share warnings retain precedence. Local
   completion does not establish wallet-wide recovery or promote remote reports to local checks.
2. **Replacement consequences (P2):** a summary appears before configuration. Zcash movement,
   retained access to old-wallet history and possible server-document disruption are presented in
   scannable points before the existing action. Existing operations and limits remain intact.
3. **Approval repetition (P2):** one visible privacy summary leads to a native keyboard-operable
   disclosure containing the full public-action, fee, expiry and invite-holder explanation. The
   duplicate stage heading and repeated post-submission expiry paragraph were removed. All six
   payment stages, exact transaction records, warnings and approval gates remain.
4. **Own-device instructions (P2):** joining, full-code comparison and mismatch recovery lead with
   the owner's devices, with a secondary clause for devices held by another person.

The fixed laptop illustration remains a minor illustrative limitation. Navigation restructuring
was not part of this refinement. No additional critique score was fabricated after the fixes.

## Verification

- Targeted renderer check: **570 assertions across 88 states**, at 320, 390, 820 and 1440px,
  in both themes. No browser JavaScript errors or horizontal overflow. Checked privacy disclosure
  keyboard behavior, local/remote recovery scope, retained qualifications and all six payment stages.
- Broader journey suite: **572 checks across 156 variants**, including setup, replacement,
  backup/save/check/restore, send/review, receive, contacts, messaging entry and settings.
- Node 26: `app`, `unified-setup`, `sol-plain-security`, `security-dashboard`, `guided-setup`,
  `approvals`, `contrast` and `orientation` passed. Existing setup assertions were aligned with
  the previously redesigned home headings and the new own-device/check-file wording.
- Both themes passed 96 text pairs, 20 boundary pairs, six transient heading pairs and 36
  transient status-mark pairs. Lint passed for 297 JS and two Python files; `git diff --check` passed.
- `DESIGN.md` frontmatter parsed and its references resolved; the schemaVersion 2 sidecar contains
  eight component previews.

Browser evidence is retained in ignored `solspike/.state/impeccable-critique-A/`,
`impeccable-critique-B/`, `impeccable-polish/` and `impeccable-polish-journeys/`. Temporary report
input was removed; the documentation tab and isolated review/verification browsers were closed.
The existing user preview was preserved. Real funds, physical-device ceremonies, live payments,
actual restoration and VoiceOver/NVDA were not exercised by the browser review.

The exact critique snapshot was read before edits and is closed after all four priorities were
processed. The initial score remains in trend history.
