# Portfolio value tracker

Surface mode: Operate. Extend the existing wallet balance panel with a precise, restrained
chart; preserve the wallet's identity, navigation, asset records and payment controls. Its
signature interaction is scrubbing actual recorded values without moving the surrounding UI.

The mainnet wallet Overview contains a live portfolio chart. It extends the existing Manrope,
semantic theme colors, balance panel and action controls with a compact overview composition.
The chart is implemented in native JavaScript ES modules and integrates with the application's
React/OpenGlass presentation shell. It uses custom SVG, Pointer Events, ResizeObserver and a
single animation-frame clock, with no additional production dependencies or chart build step.
Its reusable modules are checked with strict TypeScript
through JSDoc and the public contracts in `web/portfolio-types.d.ts`.

## Component and integration

- `web/portfolio-chart.js`: reusable component lifecycle and range controls.
- `web/portfolio-chart-content.js`: labels, comparison scope and state presentation.
- `web/portfolio-chart-dom.js`: semantic HTML and SVG built once per component lifetime.
- `web/portfolio-chart-motion.js`: coordinated numeric, line and marker animation.
- `web/portfolio-geometry.js`: monotone cubic paths, exact marker geometry and range morphing.
- `web/portfolio-interaction.js`: mouse, touch, cancellation and keyboard input.
- `web/portfolio-model.js`: valuation, freshness, observation validation and sampling.
- `web/portfolio-store.js`: wallet-encrypted local observation history.
- `web/portfolio-prices.js`: page-session price cache, request deduplication and retry policy.
- `web/app-portfolio.js`: existing wallet balances, crypto engine and render lifecycle.
- `web/portfolio-chart.css`: theme-aware presentation and responsive/reduced-motion behavior.
- `web/overview-compact.css`: compact assets, wallet context and status summaries.
- `web/overview-popover.js`: bounded native detail surfaces and asset-disclosure lifecycle.
- `cf/src/portfolio.js`: fixed server-side market-price request.

`app-wallet.js` places the component in the existing mainnet balance panel. `app-loop.js` retains
the component node through ordinary wallet redraws, and destroys its listeners, observers,
animation frame and decrypted observations when the view closes, locks or changes wallet.
During a focused chart interaction or captured gesture, background redraws are deferred to keep
the subtree connected. Fresh observations are recorded and applied after scrubbing ends.
Native asset amounts and all original payment launchers remain available below the chart.

## What is measured

Each recorded observation contains the supported assets, their actual observed balances, the
USD prices and source timestamps, balance-read timestamps, a scope identifier, and the resulting
sum of balance × price. Displayed historical values always come from actual retained
observations. A point is never fabricated at the start of a time range.

- ZEC: the existing synced shielded balance, spendable plus incoming, consistent with the asset
  row. The sync must have caught up to its reported tip.
- Plain mainnet Solana: the existing group SOL balance and the USDC token-account read. An
  explicitly absent USDC account is a confirmed zero. A failed token-account read is unknown.
- Private mainnet Solana: the existing private lamport balance and its actual sync timestamp.
- Device fee accounts, the separate messaging account, legacy public SOL held outside the
  private balance, unsupported tokens and unrelated wallet addresses are outside this scope.
- Testnet/Devnet assets have no USD valuation. Testnet retains the existing native balance UI.

A balance must be no older than two minutes and a price no older than five minutes. The price
of USDC is fetched, so depegs affect the total. A freshly observed zero is valid without a price.
Missing or stale assets are excluded from a clearly labeled partial subtotal; partial totals
are not persisted as complete portfolio history and cannot produce a current percentage change.

The percentage is **portfolio value change**, never investment return or P&L. It includes
deposits, withdrawals, transfers and fees. Its comparison begins with the first actual
observation in the selected range, whose date is shown. A zero baseline has no percentage.
No cash-flow-adjusted return is calculated.

## History coverage and privacy

No reliable historical shielded-holdings service existed in the application. This implementation
records real, contemporaneous observations going forward while the mainnet Overview is visible.
It does not attempt to reconstruct prior holdings from incomplete activity, apply today's
holdings to old prices, or fetch a price-only graph and label it as portfolio history.

Samples are recorded at most once a minute, except that changed holdings can trigger an earlier
sample. Stored history is bounded to 10,000 observations and 400 days; older records are dropped.
The six ranges filter those available observations, so a selected year may contain much less
than a year of coverage. The recorded-since label and empty-range state disclose that limitation.
Browser closure, background suspension, unsynced assets and provider failures leave gaps.
Intervals longer than three minutes and changed holdings/scopes break the SVG line and fill.
Envelope sampling keeps actual extrema and endpoints while preserving missing intervals.

The wallet's existing WASM authenticated `secretSeal` / `secretOpen` encrypts each local history
under a distinct wallet/network context. There is no plaintext history fallback or upload.
Unreadable saved data is preserved. A storage failure keeps history in session and shows a
notice. Read-before-write merges another tab's observations where possible; simultaneous writes
are best effort, not a cross-device synchronization protocol. History is not in recovery files.

See [PRIVACY.md](../PRIVACY.md#portfolio-observations-and-market-prices) for network visibility.

## Market data setup

Configure one of these Worker secrets for the intended environment:

```sh
cd cf
npx wrangler secret put COINGECKO_DEMO_API_KEY --env staging
# Or use COINGECKO_PRO_API_KEY for a paid plan.
```

The Demo key uses `api.coingecko.com`; the Pro key uses `pro-api.coingecko.com` and takes
precedence. Only the server holds the key. The request always asks for `zcash`, `solana` and
`usd-coin`, USD, full precision, and `include_last_updated_at=true`. No wallet addresses,
holdings, browser cookies or user authorization headers go upstream. The existing gate runs
before the new endpoint. The endpoint is not a caller-configurable proxy.

CoinGecko's [price endpoint](https://docs.coingecko.com/demo/reference/simple-price) supplies
market prices and source timestamps. Appropriate account access/plan is required; no credential
is included in this repository. Its [keyless endpoint guidance](https://docs.coingecko.com/docs/keyless-public-api)
does not recommend production polling, so this implementation explicitly returns unavailable
when no key is configured. The chart includes linked attribution under About this chart.

The Worker deduplicates in-flight requests and caches success/failure for one minute per
isolate. The browser also deduplicates and caches requests, aborts after ten seconds and backs
off for a minute after failure. The Worker aborts upstream after eight seconds. Range changes
make no API request. Public HTTP responses use `no-store`.
The retry control shows the remaining backoff and stays disabled until another request is allowed;
an active retry is labeled Retrying. Large values fit within a fixed-height balance header.

## Interaction and accessibility

The line reveals once as real history becomes available, and its fill fades in. Cached range
changes morph over 300ms; a sliding indicator follows the selected range. Balance values settle
with tabular numerals. A shared animation clock tracks the marker on the exact rendered cubic.
Discontinuous observations remain visibly separate.

Mouse hover, press/drag, and horizontal touch scrubbing select actual plotted observations.
The value, timestamp and value-change label update together, then return to the current value
on leave, release or cancellation. Touch direction is established before capture; vertical
page scrolling and pinch zoom remain available. A slider alternative supports Left/Right,
Home/End and Escape, with meaningful value/date text. Range buttons support arrows, Home/End,
Tab and activation. Range and principal action targets are at least 44px.

Reduced motion keeps interaction immediate. Both themes, forced colors, resize, flat values,
unknown balances, a single observation, missing prices, stale data, storage failures, negative
changes, large balances and recording gaps have explicit handling.

## Verification

```sh
node web/test/portfolio.mjs
tsc -p web/tsconfig.portfolio.json
bash solspike/lint.sh
sh scripts/test-fast.sh  # Node 26
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROME_EXECUTABLE=/path/to/chrome node solspike/tools/portfolio_browser.mjs
```

The browser harness runs the production dashboard with visibly labeled synthetic wallet data,
real WASM encryption and isolated fake market responses. Its captures are QA fixtures, not
evidence of a funded wallet or a historical backfill. It exercises desktop/mobile layouts,
both themes, every range, marker alignment, pointer/keyboard/touch interaction, cancellation,
reduced motion, component retention, and loading/empty/error/partial/flat/gapped states.
It performs no live transfer or deployment.

Recorded verification on November 13, 2026, after merging with Near's OpenGlass shell:
126 tracker browser checks and the OpenGlass integration checks passed, strict TypeScript
passed, and the repository lint passed. The required fast
suite passed 77 of 79 tests. `policy.test` cannot read its historical `cf/src/index.js` at the
configured baseline commit; `plain-equiv.test` cannot read historical vectors at `69803a1d`.
Those Git fixtures are absent from this repository. QR testing was skipped because `qrencode`
is not installed. The independent review scored the four requested fixes resolved: stable large
balances, uninterrupted background-update interaction, empty-state endpoint visibility and
understandable retry behavior.

## Compact overview sizing

The user's follow-up requires the overview to fit one viewport. The chart now measures its
responsive 72–96px plot height as well as its width, keeping the curve, marker and crosshair in
the same coordinates. The balance retains its prominence and fixed header height; the change
row reserves consistent space across magnitudes. Six range buttons and Send/Receive/Swap remain
visible. Full methodology and historical coverage are available through About this chart.
Missing asset names and failed price updates remain visible in the header; retry stays within
the plot's visual area as a sibling of the slider, keeping its disabled state independent.

Asset rows retain exact native values, privacy labels and sync/error state. Availability labels
remain available to assistive technology. A network that differs from the wallet's network
remains visible beside that asset, including Devnet and unsupported assets; matching network
metadata is represented by the wallet header. Detailed operations remain in the asset disclosure.
The Wallet approval rule disclosure opens a bounded surface with device membership and a
Security action; the full device list opens from its own button. All supporting detail surfaces use the browser's
top layer, stay within the viewport, dismiss with Escape/outside click, and do not add page
height. The mobile About Zigs link shares the brand bar. The Recent tab previews the latest
transaction and links directly to the full Activity screen.

The browser suite asserts exact document height at 1440×900, 1366×768, 1280×720, 1024×768,
768×1024, 390×844, 375×812 and 320×844, in both themes, with all three assets present. It also
checks expanded details, a populated Recent tab, chart loading/empty/error/partial/flat/gapped
states, large values, and all original interaction regressions. No page overflow is hidden to
make these checks pass. Enlarged text and exceptional financial notices retain natural flow
rather than clipping important information.
An additional mixed-network case verifies visible Solana Devnet context and its deposit warning
inside a Mainnet wallet at 1280×720 and 390×844, while preserving the same viewport fit.
