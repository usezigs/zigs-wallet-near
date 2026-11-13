# Zigs visual redesign on deslopify

This redesign gives the desktop and mobile web app one quieter visual system while preserving
its zebra artwork, fingerprint logo, local fonts, and wallet identity sculptures. The approved
direction is discreet, precise, and a little wild: charcoal and chalk surfaces, restrained icy
blue, lightly frosted chrome, subtle window elevation, and financial information with a clear
reading order. Light mode applies throughout, including the balance panel and Home.

The work follows [unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), licensed
under CC BY 4.0. The process credit is also retained in the shared stylesheets. The existing
artwork is reused; no image generation or new runtime dependencies are introduced.

## Scope and direction

- Product: shared wallets whose devices cooperate to approve payments.
- Character: discreet, precise, a little wild.
- World: ink, graphite, and engraved financial instruments, with a warmer chalk light theme.
- Moments: the original zebra on Home; balances and approval progress in the working app.
- Signature: the original zebra fingerprint, surrounded by quiet navigation and controls.

The shared changes cover Home and returning-wallet lists, wallet Overview, Approvals, Activity,
Address book, Swap, Messages, Security, Settings, setup, and payment/recovery dialogs. The native
apps are outside this web redesign. The branch is `deslopify`, created from `Near`. No commit,
merge, deployment, or change to `main` is part of this delivery.

## Audit and nine passes

The starting interface had competing metallic icon tiles, reflections, prominent container
borders, tightly tracked small labels, oversized navigation rows, repeated reassurance copy,
and a framed Home banner with substantial unused space beneath it.

1. **Spacing.** A 248px desktop rail, compact navigation, consistent 24px groups, and measured
   panel/row padding establish the rhythm. Action and form targets retain 48px height.
2. **Color.** The palette now lives in `design-system.css`. Both explicit and system-selected
   themes share the same tokens. Decorative separators are quiet; field boundaries and focus
   indicators retain functional contrast. The balance panel and its controls follow the active theme.
3. **Icons.** Existing line symbols remain, with consistent size/stroke and no relief shadow,
   metallic tile, or separate choreography. Official asset marks remain unchanged.
4. **Copy.** Home describes assets and shared control. Approvals explains the task. Messages
   names the empty state directly. Network, deposit, privacy, and approval disclosures remain.
5. **Type.** Manrope and Geist Mono remain local. Working titles, labels, and financial values
   have consistent roles; small labels lose tight tracking and excessive weights.
6. **Layout.** Home becomes a complete first-screen composition. On phones, actions precede
   the zebra. Overview separates the balance, asset ledger, transaction queue, and shared rule.
7. **Details.** Controls use 8px corners and containing panels use 12–16px corners. Selected
   navigation uses a surface step. Settings and conversations read as structured lists. Low-opacity
   shadows and fine upper rims add depth; sticky context headers and utility menus use glass.
   Reduced-transparency preferences restore opaque chrome.
8. **Visuals.** The original zebra is the main expressive image, rendered as dark ink on chalk in light mode
   using the same image asset. Wallet sculptures remain
   content; the staged code-to-sculpture sequence and lighting halo are removed.
9. **Motion.** Duplicate page entrances and decorative Home lighting are disconnected. The
   wallet sculpture starts still and can be played deliberately. Reduced-motion support stays.

## Validation

- **531/531 browser assertions passed** in fresh headless Chrome with synthetic, unfunded
  renderer fixtures. Nine screens were checked at 320, 390, 768, 1024, and 1440px in light/dark
  themes. Checks include page/dialog overflow, control sizing, exact native balance text,
  deposit restrictions, quote-only disclosures, system theme parity, mobile keyboard/menu
  behavior, visible focus, setup/receive/send dialogs, long addresses, high-contrast mode,
  and enlarged text. Recovery, education, networking, and privacy-preview dialogs are included.
  Theme-specific balance/Home backgrounds, frosted headers, subtle elevation, and the opaque
  reduced-transparency fallback are checked. No renderer errors were recorded.
- **The main application regression passed** (`web/test/app.mjs`).
- The fast suite ran 76 tests. After correcting its old title-style expectation and rerunning
  the two tests that needed loopback permission, **74 passed**. Two existing checks remain
  blocked: `policy.test.mjs` references a historical commit without `cf/src/index.js`;
  `plain-equiv.test.mjs` treats a URL-encoded workspace path containing spaces as a Git ref.
  Neither check nor its affected backend/WASM source was changed for this redesign.
- `qr.mjs` was skipped by the existing runner because `qrencode` is not installed.
- Shared palette checks passed: 96 text pairs, 20 functional boundary/focus pairs, six
  transient heading pairs, and 36 transient status-mark pairs in each theme. Text is checked
  at 4.5:1; functional boundaries/focus at 3:1. Decorative card borders are not controls.
- The repository lint script passed using its pinned oxlint 1.74.0 from a temporary QA
  directory. Project dependencies were not modified.

The browser harness is `solspike/tools/deslopify_browser.mjs`; its default evidence directory
is the ignored `solspike/.state/deslopify-qa/`. The theme/material refinement evidence is in
`solspike/.state/deslopify-polish-qa/`. Set `PLAYWRIGHT_MODULE` to an installed
Playwright entry point and optionally `CHROME_EXECUTABLE` to run it. Set
`ZIGS_DESIGN_QA_CAPTURE=0` to run checks without regenerating images.

Browser evidence covers synthetic presentation states. Live funded payments, physical phones,
physical authenticators, native apps, and production deployment were not exercised.

## Stageshow journey pass

The approved journey plan has been executed in the isolated lab and translated into the live
forms, reviews, receiving, recovery and supporting surfaces. See [the execution record](stageshow-execution.md)
for the complete surface/state disposition, final checks, known test limitations and preview commands.
