# Near Swap glass integration

Integrated the Swap feature from `Near` revision `74d1acd18b60ae98a58b937f0605aa7b0f527846`
into the working tree on `codex/near/glass`, 2026-11-13. The configured Git remote confirmed
that revision as the current `Near` head when the review began.

## Updated surfaces

- The composer, pay/receive panes, routing-mode cards, funding/payout panels, saved history
  and history rows use actual OpenGlass backgrounds through the shared bridge.
- The new privacy walkthrough and its illustrated notes, ledger, provider, address and receipt
  surfaces receive the same material treatment. Playback and manual/reduced-motion behavior
  remain intact.
- Review, asset-picker, quote, privacy, simulation and recovery dialogs retain their native
  focus and dismissal behavior, with the shared glass theme in both appearances.
- Primary actions use the shared shaded blue finish. Buttons and receipt links use the
  spring-driven cursor treatment. Radio-card labels opt in through `data-button-surface`;
  their original radio inputs and accessible labels remain native. Disabled radios block the
  parent hover effect. The older one-pixel hover lift is replaced by the shared subpixel response.
- Added inset spacing to quote/privacy actions and history rows so labels do not touch the
  new material edges. The two desktop panels still match and fit the tested viewport sizes.

The matching route-policy, quote-authentication, private/public funding verification and encrypted
recovery modules were brought across with the updated page. These are the existing `Near`
implementations; live-route configuration remains unchanged. The integration does not import the
unrelated homepage, payment, setup, global theme or journey-explorer redesigns from `Near`.

## Verification

| Check | Result |
| --- | --- |
| Updated Swap workflow review | 232 checks, 28 captures; zero runtime errors or forbidden requests |
| Presentation matrix | 25 Swap states × 4 widths × 2 appearances = 200 passing variants; zero material, label or overflow issue cases |
| Cursor interactions | 33 checks passed, including native radio cards and disabled-state cleanup |
| Existing OpenGlass interactions | 86 checks passed |
| OpenGlass smoke/cold boot | Passed, including strict CSP and existing entry/setup controls |
| Node 26 fast suite | 81/83 executed tests passed; the same two checkout/baseline failures remain; QR test skipped because `qrencode` is unavailable |
| Build and patch whitespace | Passed |
| Running Worker assets | New Swap module and NEAR artwork return HTTP 200 on port 8788 |

The two unchanged fast-suite failures are `solspike/test/policy.test.mjs` (missing historical
baseline tree) and `solspike/test/plain-equiv.test.mjs` (URL-encoded checkout path). A first
sandboxed run also blocked the local stub-server listeners; rerunning with loopback permission
passed those tests.

Widths were 320, 390, 768 and 1440px in both light and dark. The workflow review additionally
checks matched desktop panels at 1280×720, 1366×768, 1440×900, 1536×864 and 1277×1173, and the
privacy walkthrough's chapters, pause/resume, hidden-state suspension and manual reduced-motion mode.
It covers both routing choices, six simulated steps, encrypted receipt recovery, proposal tracking,
refunds, storage failure and provider-reported success versus wallet-confirmed receipt.

All workflow evidence uses disposable synthetic stores and mock transactions. External provider
requests are blocked; no real wallet was funded and no transaction was submitted. This verifies
presentation and the existing offline guards, not funded settlement or physical-device behavior.

## Reproduce

```sh
npm run build --prefix web
node solspike/tools/swap_preview_server.mjs
```

In a second terminal, select an installed Chromium binary and the Playwright module under `web/`,
then run `solspike/tools/swapflow_browser.mjs`. The server defaults to port 8856. It serves the real
React shell and native renderers with isolated Swap fixtures; it exposes no live funding endpoint.

```sh
OPENGLASS_AUDIT_SCENES='^swap-' node web/openglass/flow-audit.mjs
npm run test:button-hover --prefix web
npm run test:openglass --prefix web
node web/openglass/interaction-check.mjs
```

The [compact result summary](near-swap-glass.json) records the verified source revision and totals.
