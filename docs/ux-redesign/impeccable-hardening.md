# Impeccable audit, hardening and reassessment

Work on `deslopify`, 13 November 2026. This pass preserves the current Zigs visual system.
No commit, push, merge or deployment is part of the work.

## Technical audit

The initial technical audit scored **17/20**, a separate scale from the ten-heuristic design
critique. Its report was delivered in chat before saving
`.impeccable/audit/2026-11-13T18-04-43Z__web-app-shell-js.md`.

Three initial patterns were confirmed:

- **P1:** recovery metric descriptions broke definition-list structure.
- **P2:** several dialog forms and drawers used unsupported HTML/ARIA role combinations.
- **P2:** the selected recovery filename disappeared from the rendered input after a redraw,
  while the selected File remained in application memory.

The broader UI check then exposed a fourth issue: the message composer could be partly outside
the phone viewport, or obscured by sticky wallet context in a short window.

## Changes

- Recovery metrics now keep their descriptions inside valid definitions without changing the
  local/remote evidence distinction.
- The shared `dialogForm` builder puts dialog semantics and geometry on a neutral container.
  Its native inner form owns inputs, validation and submission. Events bubble to the established
  handlers. CSS preserves the existing dialog layout, sticky actions and short-window behavior.
  Payment drawers use a neutral container rather than overriding an aside's role.
- File checking has an explicit chooser and persistent selected filename, including busy/error
  states. Selection is announced locally, and the owner can choose another file after an error.
  The selected file remains in memory; file contents and passphrases are not added to storage.
- Message focus brings the composer and its actions into view when they fit, or the field alone
  when the available viewport is smaller. Narrow composing views and short windows release the
  sticky wallet context so it does not cover the field. Scrolling is tied to focus/keyboard opening,
  not a continuous attempt to override the owner's reading position.

Form submission, payload checks, cryptographic operations, payment gates and financial terms retain
their existing behavior. A temporary first wrapper implementation was rejected during verification
because it had zero visible geometry; the final dialog container owns its visible bounds.

## Verification

- **Axe 4.14:** 96 seeded renderer states in both themes at 390 and 1440px. After fixes, no
  remaining rules were reported apart from 20 fixture-only missing-page-heading warnings. Those
  isolated renderers omit their production page header; they are not reported as production defects.
- **Genuine Chrome 200% page zoom:** 52 layouts in a disposable profile, physical widths 640
  and 1440, both themes. Confirmed DPR 2, CSS viewport width halved and pinch scale 1. No page
  or dialog horizontal overflow. The profile was removed after the run.
- **Chrome journeys:** 579 assertions across 156 variants, including required-field validation,
  one native Enter submission with correct FormData, synthesized touch submission, persistent
  selected-file identity, setup, recovery and payment forms.
- **WebKit 27.2 journeys:** the same 579 assertions and 156 variants passed. A matching browser
  engine was installed in the temporary QA directory; no user browser settings were changed.
- **Chrome full UI:** 1,141 checks, 168 layouts, 50 composer-focus cases. Includes long labels,
  narrow/short windows, modal and navigation focus, ARIA references, accessible control names
  via the Chrome AX tree, and usable control targets.
- **WebKit messaging:** 283 checks, 36 layouts, 50 composer-focus cases. Used DOM semantics and
  Playwright ARIA snapshots for names; it did not use Chrome's CDP accessibility tree.
- **Messaging regression:** 145 checks and 34 captures, including offline draft retention,
  explicit resend guidance, fee review, cancellation, changed cost and failure recovery.
- **Node 26:** app, unified setup, guided create, passkey setup (24 cases), optional passkey
  (32 cases), backup check (69 payload bindings and encrypted-file reopening), recovery,
  security dashboard, payment model, contrast and orientation passed.
- Local synthetic menu sample: all 120 frames below 25ms, no long tasks, six menu feedback
  measurements around 8–10ms, no infinite decorative animation. This is an observed local UI
  sample, not production hardware or full engine-startup performance evidence.

The new browser regressions are in `solspike/tools/ux_flow_browser.mjs`. Existing setup tests now
find their hidden review section recursively, so a semantic form wrapper does not invalidate the
actual setup-intent and no-bypass assertions.

Raw evidence is retained in ignored `solspike/.state/impeccable-hardening*` directories.
Browser states and records are disposable and synthetic. Physical phones, actual VoiceOver/NVDA,
unfamiliar human usability sessions, live network settlement and funded payments were not exercised.

## Independent reassessment

Fresh isolated Assessment A and B reviewers are used. Neither is given a desired score or the
previous score, and Assessment B withholds its detector findings until A's judgment is finished.
The source target remains `web/app-shell.js`; no critique ignore list exists.

The updated score and any remaining priorities are recorded in the critique snapshot generated
after the independent review. The score is an assessment of the observed interface, not evidence
that untested physical-device or payment behavior has passed.

The first fresh review remained at **29/40**, with no confirmed P0/P1 and three P2 findings.
Its snapshot `2026-11-13T18-26-47Z__web-app-shell-js.md` was delivered before persistence and
read before the follow-up polish. The user chose three visible navigation groups and a Restore
action near the top of Security. All three priorities have been processed:

- Money, Contacts and Wallet care now group the eight direct section destinations. The phone
  menu uses two columns; labels remain whole words and optional badges have their own row.
- Restore is available near the Security overview heading. It opens the existing disclosure
  and moves keyboard focus to its summary. In current 390×844 captures the shortcut is at
  y=536px, while the previously buried disclosure began at y=2112px.
- Messages is the consistent destination name. Wallet conversations and Direct chats describe
  the two relay room types without assuming separate people. Setup uses Everyday wallet as
  an example. Multi-person capability and all transport/fee distinctions remain.
- The signing-rule badge stays on one line; duplicate full fund-movement wording is consolidated;
  paragraph wrapping and short descriptions have been refined.

The exact snapshot was then closed. Verification of the follow-up includes **1,152 full UI
checks** and **579 WebKit journey checks**; app and unified-setup tests passed. The side-menu
approval-count assertion now finds grouped destinations recursively and still checks the real
cross-wallet badge counts. No score was assigned to these fixes by the implementation agent.

A final isolated A/B review is run against the revised current build, with neither previous scores
nor a desired score provided to its reviewers. B continues withholding detector findings until A
finishes. Its resulting critique is the final score record for this pass.

## Final outcome

The final full independent critique scored **35/40**, with one P3 and no confirmed P0/P1/P2.
The P3 was a forward-looking “Verify before signing” instruction on already-completed payment
records. It is now limited to the applicable phase using existing state facts; signing, submission,
inclusion and terminal/error records retain the financial/privacy record without that instruction.

Implementation verification passed **140 assertions across 28 states**, and the app regression
suite passed with new submitted/included-record assertions. The independent designer then verified
the fix in fresh isolated frames (**32 checks across eight states**, both themes and sizes).
It cleared the P3 and amended Consistency from 3 to 4: **36/40 — Excellent**, with zero remaining
confirmed P0–P3 issues. Other heuristic scores and evidence limits are unchanged.

The 36/40 record is a bounded post-polish amendment to the 35/40 full review, not another full
review. Both were delivered in chat before persistence. The final archive is
`.impeccable/critique/2026-11-13T18-57-41Z__web-app-shell-js.md`, closed after processing; the full
35/40 snapshot is also closed. Trend: **29 → 29 → 35 → 36**, with broader scope in later reviews
and the final entry explicitly identified as an amendment.

Final source scan: zero findings. Runtime detector: eleven signals, comprising seven deliberately
covered inert-background elements under the open menu, a meaningful grouped-device diagram,
two typography aggregates mixing navigation captions with incomplete fixture page context, and
one inactive-background wrapping observation. No additional defect was substantiated by these
signals. The three detector views precede the final receipt-only condition and are unaffected by it.

Assessment A stayed isolated from B throughout, including its polish verification. B sealed its
report before a status inventory incidentally included an older detector agent's answer; A was
never exposed, and B's sealed findings/interpretation were unchanged. This provenance limitation
was disclosed. Native browser profile locks were handled with independent CLI browsers.

Detector overlays were captured successfully and then closed. Each helper was stopped with
`live-server stop --keep-inject`; existing previews on 4194 and 4196 remain available. Temporary
report bodies were removed. QA evidence remains intentionally in ignored state directories.

The four remaining 3/4 areas concern domain comprehension, preventing verification mistakes,
expert workflow efficiency and real failure recovery. These need further usability and real-device
evidence; 40/40 is not claimed. Actual screen readers, unfamiliar participants, physical device
independence and live settlement/recovery remain outside the completed UI validation.
