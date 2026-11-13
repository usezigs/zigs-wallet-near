# Nextlevel visuals

13 November 2026 · `nextlevelvisuals` · Web presentation

Zigs uses graphite surfaces and restrained studio lighting around the portfolio, payment flow,
recorded device approvals, and address-derived wallet sculpture. The follow-up adds a welcome
shader, an illustrated payment walkthrough, consistent setup, recovery and activity pages,
and a redesigned sidebar. The branch now includes the merged `Near` work through `74d1acd`,
with the existing local visual edits reconciled on top.

## Implemented

- The portfolio has larger supporting type, consistent action shapes, grouped asset rows,
  clearer chart selection, and opaque financial surfaces. The sticky wallet header stays opaque.
- The Zcash payment approval panel has a count-based quorum ring and separate metallic device medallions.
  A 720 ms trace plays only when the existing presentation observer sees an approval change
  from off to on. Initial records, unknown/checking states, ordinary redraws, and repeated
  approvals do not trigger it. Existing stage text, aggregate fallbacks and announcements stay.
- The wallet reveal presents the existing public-address sculpture immediately, with a
  1.4-second entrance. Its name, explanatory text and Continue action remain visible and usable
  throughout. The previous illustrative code sequence and its delayed text entrance are removed.
- OpenGlass uses restrained reflection and shadow settings. Decorative rotating rims and
  floating-button loops are replaced by stationary edge light.
- Overview shows the configured approval rule and separate device medallions without a
  disclosure. The card distinguishes wallet configuration from approvals of a particular payment.
- Send, Review, Approve and Record share a view rail, wallet identity and financial typography.
  Motion connects the decorative marker and wallet avatar when the view changes. Financial
  text, inputs and focus remain under the existing app controller. Review opens at its heading,
  Back to edit preserves the typed draft, and financial sheets use opaque surfaces.
- Verified wallets reuse their existing address-derived sculpture in payment headers. The
  existing verification and fallback rules continue to decide which artwork is available.
- The welcome zebra has a monochrome Bayer-dither atmosphere adapted from Radiant. It shares
  the existing WebGL canvas, frame limit and lifecycle; the original portrait and red eye stay.
- How Zigs works opens with a four-chapter Zcash payment illustration. Native desktop scrolling
  advances one sticky illustration; phones have explicit, keyboard-accessible step buttons.
  The complete guide and existing journeys remain available. Reading position survives view
  changes. The example has no wallet-state, network or payment imports.
- Receive ZEC uses an opaque sheet and an address card with the existing wallet sculpture,
  explicit network, unmodified black-and-white QR, address disclosure and adjacent Copy/Share
  actions. Copy confirms the exact full address and preserves button focus. If the clipboard is
  blocked, the disclosure opens and the full address is focused and selected for manual copying.
  Share cancellation is neutral; unavailable sharing offers Copy. Unchecked local addresses stay
  hidden, and replaced-wallet warnings and sharing restrictions remain in force.
- Actual wallet setup shares a device-status layout across Connect, Verify and Prepare, using
  the same numbered metal medallions on the completed-wallet and recovery views. The panel
  names waiting devices and distinguishes unread records from missing connections. A known
  not-joined → joined change gets a 240 ms Motion acknowledgement; initial records stay still.
  The previous repeating pending-device pulse is removed. All 30 comparison digits stay static.
  Preparation and recovery illustrations remain available in contextual disclosures.
- Security/recovery exposes the existing per-chain file status in each device summary. The next
  action names its device and chain, and the corresponding device card has a quiet border.
  Local checks, remote reports, missing material, unknown status and browser concentration keep
  their original meanings. Backup, verification, restore and settings callbacks remain existing
  application actions.
- Activity groups the existing records by local calendar date, with stable amount/status columns
  and the same payment Record drawer. Unknown timestamps remain undated; mempool observations
  are grouped as awaiting a block. Received Zcash dates are explicitly estimates from block
  heights. Grouping neither filters records nor changes confirmation states or exact amounts.
  Existing network filters, explorer links, incomplete-history notices and keyboard return work.
- The sidebar uses an original SVG set with a consistent 1.5 px stroke and quiet inset surfaces.
  All eight section icons, New wallet, generic wallet fallback, browser status, disclosure and
  phone Menu use the same visual language. Available address-derived wallet art retains its
  existing identity rules. The navigation rail moves for actual section changes; hover and
  keyboard focus play short icon details through Motion. Redraws settle without replay, phone
  Menu morphs to a close mark, and motion preferences cancel ongoing decorative effects.
- Swap's main action names the selected mode: Preview swap, Review standard swap or Review
  confidential swap. Max, Reverse, quote details, slippage and tutorial controls have at least
  44 px click targets on desktop and 48 px on phones. Financial actions use the existing
  high-contrast primary tokens, opaque surfaces and consistent control shapes.
- The route-privacy tutorial has explicit Pause, Resume and Replay controls. It remains finite
  and respects reduced motion, slow displays, forced colors and data saving. The general Swap
  journey, diagrams and navigation labels now describe the merged flow rather than an
  unavailable plan: preview versus execution, Standard versus Basic, public deposits, distinct
  wallet approvals, provider reports, wallet receipt checks and browser-local recovery records.
  Phone guide tabs use short labels while retaining their full accessible names.
- Swap now shares original SVG geometry with the sidebar: distinct preview/public/confidential
  mode tiles, direction controls, privacy marks, slippage, pickers, modal controls, playback,
  copy feedback and the post-quantum mock. Guide navigation, chapter controls and source links
  use the same family. The 24-unit grid, 1.5 px strokes and light secondary fill stay consistent;
  official token and provider marks retain their existing artwork. A short Motion trace responds
  to hover and keyboard focus. Disabled controls and motion preferences retain static glyphs.
  Live tracking now grows in normal document flow so history cannot cover recovery controls.

## Actual tools and references

`motion@14.14.0` is pinned in `web/package.json`. The shell imports `motion/mini`, bundles it
locally, and exposes its animator through the existing presentation bridge. Native presenters
keep their DOM ownership, focus logic, input references and cancellation lifecycles. The native
Web Animations fallback remains available to standalone fixtures.

The approval trace uses the SVG path-light technique illustrated by
[Magic UI Animated Beam](https://magicui.design/docs/components/animated-beam). This is a small,
independently authored, event-driven treatment; the Magic UI React component and its looping
animation are not copied or installed. The wallet sculpture reuses Zigs' existing Three.js
renderer and identity rules. No new graphics runtime, external media request or CDN is needed.

The welcome scene includes actual Bayer-matrix and quantization code from Paul Bakaus'
[Radiant Dither Gradient](https://radiant-shaders.com/shader/dither-gradient), adapted to the
existing Zigs shader. Source: [standalone shader](https://radiant-shaders.com/dither-gradient.html).
The MIT notice is retained in `web/vendor/radiant-LICENSE.txt`; the adapted shader lives in
`web/vendor/radiant-dither.js`. It introduces no second render loop or graphics dependency.

The walkthrough uses native IntersectionObserver and CSS rather than adding another scroll
runtime. Only decorative anchors animate across payment views; there are no snapshot clones
of addresses, amounts or input fields.

Interface paths are independently authored in `web/sidebar-icons.js`, shared by the native
navigation, React shell, Swap and tutorials. `web/interface-icons.css` styles the reusable
renderer; guide navigation uses the same path data. `web/openglass/sidebar-motion.js` uses the already bundled
`motion/mini` for the 240 ms selection rail and icon details, plus a 400 ms accent trace.
It adds no package, network request or continuous animation loop.

The Receive card adds no animation or dependency. QR geometry and its quiet zone come from the
existing encoder and remain stationary. Native share feedback says that share options opened;
the API resolves at different stages on different platforms and does not establish delivery.
References: [Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share),
[clipboard writing](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).

Motion documentation: [animate](https://motion.dev/docs/animate),
[reduced motion](https://motion.dev/docs/react-accessibility).

Reduced motion, slow displays, forced colors and data-saving preferences retain the existing
static artwork or settle decorative transitions. The walkthrough remains readable without motion.

## Verification

`npm run build --prefix web` builds the production presentation bundle.
`npm run test:openglass --prefix web` checks both themes, responsive layouts, actual native
form preservation, keyboard dismissal, and real app boot under its strict content security policy.

`npm run test:visuals --prefix web` checks the production renderers in fresh, isolated browser
contexts. It includes 1440, 390 and 320 px layouts in both themes; actual Motion playback and
stroke movement; historical/redraw suppression; unknown and inconsistent approval records;
chart keyboard interaction/focus; reduced motion; forced colors; reveal visibility and its
existing Continue callback. Samples are synthetic and non-payable. The script blocks external
requests and never boots the wallet or broadcasts a transaction.

`npm run test:journeys --prefix web` verifies the shared-control card, production Send/Review
and Record renderers, full recipient text, exact draft preservation, actual Motion playback and
live reduced-motion cancellation. It checks all three widths and both themes, phone step and
keyboard controls, desktop scroll selection, toolbar clearance, guide access and retained reading
progress. A WebGL pixel check verifies background movement and an unchanged red eye. These
56 checks use isolated synthetic data and block external requests. This includes all four
updated Swap guide chapters at 1440, 390 and 320 px in both themes.

The existing homepage renderer browser check also verifies opaque foreground pixels, moving
atmosphere, offscreen pauses, context-loss cleanup, unavailable WebGL and static fallbacks.
Its output directory can be redirected with `ZIGS_SCENE_OUTPUT`.

`npm run test:receive --prefix web` exercises the actual Receive renderer with non-payable public
fixtures and stubbed OS copy/share APIs. It checks both networks and themes at 1440, 390 and
320 px; square QR modules at integer pixel sizes; exact clipboard/share payloads; cancellation;
permission failures; manual selection; focus retention; unsupported sharing; unchecked and
replaced wallets; forced-color QR contrast; actual 200% text; and keyboard dismissal. It blocks
external requests and does not create a wallet, contact a share target or submit a payment.

`npm run test:wallet-pages --prefix web` runs 69 checks against the production setup, Security
and Activity renderers. It covers 1440, 390 and 320 px in both themes; 200% font and line sizes;
qualified remote reports; unknown/missing/concentrated recovery states; original recovery
callbacks; native network filters and payment-record navigation; exact amounts; date labels;
focus return; real Motion acknowledgement of a joined device; all 30 comparison digits; native
preparation and optional-backup continuation; and mismatched-key blocking. Fixtures are synthetic
and non-payable, with inert subscription and operation boundaries and external requests blocked.

`npm run test:sidebar --prefix web` runs 32 checks on the production sidebar at 1440, 1024,
390 and 320 px in both themes. It checks every section icon's actual Motion playback, live
reduced-motion cancellation, navigation-rail movement and redraw cleanup, forced-color label
contrast, native page focus, phone Menu focus trapping and dismissal, and browser-status header
layout. It uses isolated synthetic wallet data, blocks external requests and never boots a wallet.

The merged `solspike/tools/swapflow_browser.mjs` suite passes 274 checks with 28 captures. It
includes all three mode-specific action labels, actual utility-control target sizes and primary
text contrast in both themes, explicit replay, static forced-color keyboard chapters, existing
quote invalidation and approval guards, encrypted recovery, route downgrade rejection and
wallet-scanned receipt checks. Requests to real swap services and payment endpoints are blocked.
The local preview uses `solspike/tools/swap_preview_server.mjs` with synthetic wallet facts.
Focused Swap, recovery, confidential-route and hackathon-mode tests also pass.
An additional isolated icon interaction check verifies 14 cases: the shared family, distinct
mode glyphs, original asset loading, picker indicators, actual Motion playback and live reduced
motion cancellation, reachable recovery controls, copy success/reset/failure glyphs, and full
synthetic addresses preserved in the copied receipt. Clipboard APIs are stubbed and all external
or payment requests are blocked. No transaction is proposed or sent.

During integration, native dialog-form error handling and the new navigation groups are retained.
Payment-view continuity is connected directly to the current presentation lifecycle, without
restoring the old general entrance controller. Build, the 123-module graph, native app and Solana
integration checks, and the sidebar, Receive, wallet-page, portfolio and approval regressions pass.

The presentation follows the existing graphite/silver direction: separate device medallions,
calm financial surfaces and short event-driven feedback. No new runtime or media dependency is
introduced by these passes.

Focused tests also cover the presentation controller, public artwork identity, approval and
portfolio models, payment stage precedence, contrast, module imports, and the existing app
and Solana page integration. Browser inspection uses Chromium on this machine; it is not a
physical-phone or funded-transaction certification.
