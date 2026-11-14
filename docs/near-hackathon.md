# Zigs · NEAR HACKATHON

Zigs adds NEAR Intents cross-chain swaps to a shared Zcash/Solana wallet. The integration keeps
quote review, source-payment approval, route visibility and recovery in one interface.

Start with the [README](../README.md) or follow the [judge demo](near-demo.md).

## Existing foundation and integration scope

Zigs was already a wallet project. Its Rust engine, FROST threshold signing, Zcash shielded
payments, Solana wallet/pool integration, encrypted coordination, backups and messaging are
baseline capabilities, not a new NEAR contract or features supplied by 1Click.

The NEAR work connects that wallet to 1Click: live quotes, full-wallet swap creation paths,
provider authentication, group payment proposals, route policy, status/recovery and the guided
swap interface. The unfunded preview is a reproducible demonstration of the integration.

For a source-level review in this repository:

- [First NEAR quote integration](https://github.com/usezigs/zigs-wallet-near/commit/468a1d9c14d543674a5a2362935a484389be3dc1).
- [Code before the first NEAR adapter → merged entry](https://github.com/usezigs/zigs-wallet-near/compare/54ee019cd2c04366dd73649896c7975abe4ef89d...4ce239cfa0a3c9c619d07a2f66a2d71af40bda96).

The comparison also contains supporting wallet and interface changes. The source map below
identifies the integration itself. History preserves its development structure, with contributor
metadata normalized for privacy; timestamps are not proof of the original work dates. This
scope disclosure follows the organizer's distinction between an existing product and its new
integration ([rules Q-002–Q-005](https://nearhackathon.com/HACKATHON.md)).

## What NEAR does

The Zigs Worker calls NEAR Intents' [1Click Swap API](https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api)
for quotes, live swap deposit details and status. NEAR's service handles the cross-chain route;
Zigs constructs its bounded requests, authenticates the response and connects the source payment
to the wallet. Zigs' FROST signing and Zcash proofs remain in its own engine.

No new NEAR smart contract, NEAR AI integration or NEAR Chain Signatures deployment is claimed.

## Implementation map

| Area | Source | Behavior to inspect |
| --- | --- | --- |
| 1Click gateway | [cf/src/near.js](../cf/src/near.js) | Fixed asset allowlist, bounded request bodies, dry quotes, live-route gates, response checks, deadlines and upstream errors. |
| Browser adapter | [near-intents-swap-provider.js](../web/near-intents-swap-provider.js) | Same-origin Worker calls, typed quote parsing, swap validation and authenticated status reads. |
| Quote authentication | [near-quote-signature.js](../web/near-quote-signature.js) | Provider signature verification and expected quote-field validation. |
| Route policy | [near-swap-policy.js](../web/near-swap-policy.js) | Explicit public/Basic execution policy, unsupported modes rejected and no silent downgrade. |
| Swap state machine | [swap-preview-model.js](../web/swap-preview-model.js) | Quotes, stale results, expiry, review, simulation, live swaps and status handling. |
| Swap interface | [app-swap-preview.js](../web/app-swap-preview.js) | Amounts, assets, slippage, review, deposit instructions, status and history. |
| Privacy walkthrough | [app-swap-privacy.js](../web/app-swap-privacy.js) | Source, public deposit, provider, destination and refund disclosures. |
| Zcash-funded route | [app-swap-zec.js](../web/app-swap-zec.js) | A provider deposit becomes a group Zcash payment proposal. |
| Solana-funded routes | [app-swap-sol.js](../web/app-swap-sol.js), [sol/swap.js](../web/sol/swap.js) | Group-authorized funding and checks for a private-pool withdrawal. |
| Recovery | [swap-records.js](../web/swap-records.js), [app-swap-store.js](../web/app-swap-store.js), [swap-recovery.js](../web/swap-recovery.js) | Encrypted receipts, pinned routing mode, refreshed status and payment reconciliation. |
| Judge harness | [swap_preview_server.mjs](../solspike/tools/swap_preview_server.mjs), [swap-preview.mjs](../solspike/harness/swap-preview.mjs) | Real renderer and dry quotes with an explicitly simulated wallet and no execution endpoints. |

## API surface

| Zigs route | Purpose | In isolated judge preview? |
| --- | --- | --- |
| `POST /near/quote` | Dry price quote for the allowlisted ZEC, SOL and Solana USDC assets. | Yes. |
| `POST /near/swap` | Live SOL → ZEC quote and deposit details for external-wallet funding. | No. |
| `POST /near/swap-sol-group` | Live SOL → ZEC quote for plain Solana group funding. | No. |
| `POST /near/swap-zec` | Live ZEC → SOL quote for a group Zcash payment. | No. |
| `GET /near/status` | Provider status with the checked swap context. | No. |

USDC is included in price previews; that does not claim USDC execution for the live swap paths
above. Those paths connect SOL and ZEC. The full wallet's private SOL funding path proposes a
pool withdrawal to the quoted public deposit address through the existing Solana integration.

Live routes require `NEAR_LIVE=1`. Availability of a Solana funding mode also depends on the
wallet's setup and Solana server gates. Basic confidential execution requires `NEAR_API_KEY`
on the server; Standard public execution is an explicit key-free option. No credential is
needed for the isolated preview. See [cf/wrangler.jsonc](../cf/wrangler.jsonc) for the checked-in
configuration; those settings do not prove what a remote deployment currently enables.

## What the demo proves

| Capability | Evidence level |
| --- | --- |
| Real NEAR mainnet price quote with no partner key | Demonstrated by the local judge preview; depends on provider availability. |
| No execution in judge mode | The server exposes only dry quotes; the preview tests reject live creation, status calls and receipt writes. |
| Review and six-step swap journey | Browser demonstration using simulated wallet, approval, deposit, processing, delivery and recovery steps. |
| No silent public-route fallback | Offline tests cover browser, Worker, approval and recovery boundaries. |
| Quote signatures, field validation and error states | Implemented and exercised by fixture tests; the optional diagnostic also verifies an actual provider quote signature. |
| Receipt recovery and duplicate-payment protections | Implemented and exercised by state-machine and recovery fixtures. |
| Funded swaps, shielded ZEC arrival or completed refunds in Zigs | Not verified by this entry. No funded settlement claim. |

The simulation is not an on-chain receipt. A provider quote, its signature and a successful
UI walkthrough are not evidence that money settled.

## Privacy and security boundaries

- A private source balance does not hide the public provider deposit. Group identifiers,
  fee-paying addresses and timing can remain linkable.
- Standard routing is public. Basic requests confidential routing from the provider and
  requires provider access; it does not make either chain or the full route anonymous.
- Quote signature authentication and routing-mode consistency are separate checks. A mode echo
  is a provider assertion, not a signed proof of private execution.
- The provider sees the route. Hosting and RPC providers can observe connection metadata.
- The wallet and its Solana pool integration are experimental and have not received an
  independent security audit. The [privacy model](../PRIVACY.md) describes the larger system.
- Playing multiple devices in one browser is useful for a demo but gives that browser multiple
  signing shares. It does not provide the protection of physically separate devices.

## Validation

Run the six commands in the [README](../README.md#review-the-implementation). Their main coverage:

| Check | Coverage |
| --- | --- |
| `web/test/near-quote.mjs` | Asset/request checks, upstream responses, live-route gates and status parsing. |
| `web/test/near-confidential.mjs` | Explicit modes, unavailable credentials, downgrade refusal, approval/recovery policy and dry diagnostics. |
| `web/test/hackathon-swap.mjs` | Preview default, no execution/receipt writes during simulation and separate public/confidential routes. |
| `web/test/swapflow.mjs` | Pinned quote signatures, private-withdrawal guards, receipt evidence and wallet-key encryption. |
| `web/test/swap-preview.mjs` | Amount handling, races, expiry, review, approving-device checks and failure states. |
| `web/test/swap-recovery.mjs` | Saved swaps, status refresh and reconciliation. |

These are fixture checks, not funded-chain tests. The [demo guide](near-demo.md) gives a manual
browser run and a separate live dry-quote diagnostic.

## Dependencies and attribution

The existing wallet supplies the Rust/WASM engine, FROST, shielded proofs and Solana integration.
The NEAR adapter uses the 1Click HTTP API. The interface uses React, OpenGlass UI and Motion;
Zolana/Helius supplies the underlying Solana pool/prover tooling. Additional credits and licenses
are in the [README](../README.md#foundation-and-credits), [asset notes](../web/assets/README.md)
and bundled license files. Zigs does not claim authorship of those dependencies.
