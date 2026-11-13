# Zigs icon craft

Branch: `codex/near/icons`, based on `Near`. Work is isolated from the existing
`deslopify` working tree.

## Direction

- **Product:** Shared wallets whose payments require independent device approvals.
- **Character:** Calm, precise, tactile.
- **World:** Smoked glass, satin silver and engraved financial instruments.
- **Moments:** Larger empty-state and recovery illustrations; quiet symbols on controls.
- **Signature:** An extruded graphite edge, silver bevel and small sage inlay.

The reference link resolves to [Vitrum](https://github.com/volkanakyel/vitrum-3d),
reviewed at `75ab46df5c96473e87674a9a394d89fdbc5b651a`. Its material presets informed
the lighting and bevel treatment. The shipped paths and renderer are original Zigs
code. No Vitrum runtime, Three.js dependency or remote artwork was added.

The polish workflow was informed by [unslop by Damir Sokolovsky](https://heydamir.design/unslop)
(CC BY 4.0). This pass keeps the existing product, type, palette and page structure.

## Changes

The audit found mixed small-icon strokes, text characters used as controls and
illustrations that repeated the zebra instead of explaining the current context.

`web/icon-objects.js` supplies twelve local vector objects through the existing
`sculptedIcon` API. Each has unique gradient IDs and finite geometry. Wallet,
shield, approvals, messages, contacts, activity, vault and recovery objects are
integrated in the relevant existing surfaces. Devices and exchange are available
in the collection for larger educational placements.

Setup uses the same satin-metal key, phone and laptop objects for browser protection,
the proposed approval arrangement, device connection and final review. Small Security
device symbols keep their existing meaning with plain, unframed surfaces. Setup
buttons share a matte finish, and the approval-rule explanation opens from a compact
information disclosure. Protection, consent and ceremony checks are unchanged.

Small symbols share a 1.5-unit rounded stroke and inherit their text color. Copy
actions retain their text, show a check after success and return to the copy icon.
Notification, appearance, recovery, download and team symbols clarify their actions.
Text-character plus and close controls now use matching vectors.

`web/icon-craft.css` keeps material detail inside the objects, removes redundant
icon tiles and supplies a solid silhouette for forced colors. Objects remain
decorative, hidden from assistive technology and outside the tab order. The
existing text remains responsible for status and accessible names.

No looping animation, canvas, WebGL or external request is introduced by the icons.

## Review

Serve the repository root with a static server and open
`/docs/ux-redesign/icons.html` for the collection with its appearance switch.
The app itself continues to use the project's existing web server.

- [Dark collection](visuals/icons/collection-dark.png)
- [Light collection](visuals/icons/collection-light.png)

## Validation

The isolated browser review used the real renderers with synthetic wallet data.
All nine screens (home, overview, approvals, activity, address book, messages,
security, settings and swap) fit at 320, 390, 768 and 1440 pixels in both themes:
72 layouts. Checks covered horizontal overflow, unique document IDs, resolved SVG
materials, decorative accessibility and named buttons.

Additional checks covered mobile-menu focus return, clipboard success and refusal,
icon restoration after feedback, the real recovery dialog's accessible title,
and forced-color silhouettes. Both collection previews were visually inspected.

Repository checks passed:

- `bash solspike/lint.sh` (297 JavaScript files and 2 Python files)
- `node web/test/app.mjs`
- `node web/test/graph.mjs` (96 modules; also with a locked vault)
- `node web/test/orientation.mjs`
- `node web/test/contrast.mjs`
- `node web/test/messaging-account-view.mjs`
- `node web/test/messaging-presentation.mjs`
- `node web/test/messaging-cost-review.mjs`
- `node web/test/security-dashboard.mjs`
- `node web/test/backup-check.mjs`
- `node web/test/premium-motion.mjs`
- `git diff --check`

Browser QA exercises presentation and synthetic clipboard feedback. No live wallet
transaction, physical passkey or native iOS/macOS build was exercised.
