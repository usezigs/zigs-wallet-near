# Payment flow refinement

The approved setup palette and controls now carry through Zcash Send, the prepared
transaction review, Approvals and payment details. Shared Solana send controls and
receipt surfaces use the same treatment.

## Direction

- Product: shared wallet payments authorized by independent devices.
- Character: calm, precise, tactile.
- World: graphite surfaces and satin-metal instruments, inherited from wallet setup.
- Moments: the decoded amount and the actual device-approval records.
- Signature: thin rules separate transaction facts from explanatory details.

The craft workflow is informed by [Unslop by Damir Sokolovsky](https://heydamir.design/unslop)
(CC BY 4.0). Existing Zigs typography, symbols, product content and payment checks stay
in place.

## Audit and changes

- Spacing: the form, receipt and actions use 24px desktop groups and 20px mobile
  edges, with 44px minimum action targets.
- Color: heavy glass rims, bevels, icon frames and nested surface highlights give
  way to the setup palette, a quiet raised surface and hairlines. Warning and error
  colors retain their meaning.
- Icons: existing action and outcome symbols remain decorative. Configured device
  numbers use plain marks; membership is still separate from payment approvals.
- Copy: the main amount, fees, total, complete recipient address, risk warnings and
  stage wording remain. Input and change accounting opens from “Funds used and
  change”; no transaction data is discarded.
- Type: headings use 24–26px, primary amounts 32–40px, and figures use tabular
  spacing. Amount formatting and precision are unchanged.
- Layout: the existing selected payment stage appears after critical warnings and
  before the receipt, so confirmation and errors are visible sooner. Its existing
  precedence rules still determine the wording.
- Details: controls use an 8px radius, visible focus and matte surfaces. The funds
  disclosure supports the keyboard; recipient copying preserves the complete value.
- Visuals and motion: the transaction itself supplies the visual emphasis. No new
  artwork, network request, looping decoration or simulated payment progress is added.

## Validation

The isolated browser review uses real renderers with synthetic, non-authorizing
facts. It covers 80 layouts at 1440, 768, 390 and 320 pixels in both themes, including
seven devices, mismatches, waiting, threshold, submitted, confirmed and failed states.
Additional checks cover full-address copying, keyboard accounting details, forced
colors, usable actions and accessible descriptions.

Build, lint, app, approvals, outcome-seal, Solana payment and plain-account view/review
checks passed. No live payment, fee funding or physical device authorization was used
for this presentation review.
