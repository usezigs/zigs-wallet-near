# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

This record covers the desktop and mobile web experience in `web/`. Native clients in `ios/`
exist in the repository but are outside the current web design scope.

## Users

The primary user is an individual spreading control of their wallet across their own devices.
The user explicitly confirmed this audience during Impeccable initialization on 2026-11-13.
Default explanations and examples should make sense for one person's phone, laptop and reserve
or recovery device; do not assume each signing device belongs to a different person.

The underlying wallet also supports devices controlled by multiple people. That capability
must remain intact; a separate priority audience or institutional workflow has not been confirmed.

## Product Purpose

Zigs lets a person manage funds while requiring a chosen number of their participating devices
to cooperate on payments. Success means understanding which devices are needed, checking the
full destination and cost, completing the actual approval and payment stages, and retaining a
way to recover from device loss.

## Positioning

The core mechanism is threshold control: any required subset of a wallet's devices cooperates
to authorize payments. The Zcash implementation creates a shared shielded address without
reconstructing one complete spending key during the normal signing workflow. The group server
does not hold the signing shares. Do not turn this mechanism into an unqualified security,
anonymity, custody or audit claim; the repository documents important limits and exceptions.

## Operating Context

- People create or join a wallet, set its approval rule, verify the participating devices and
  wallet address, receive funds, review proposals, contribute approvals, follow transaction
  progress, and manage recovery material.
- The web app works on desktop and mobile browsers. A device is a signing participant/key
  share held in a browser context; a device label does not verify a person's identity.
- One browser can hold several signing participants, including for demos. This concentrates
  control and failure risk; copies of one share do not create additional independent approvals.
- Wallets expose their current asset and network context. Testnet demonstrations, quote-only
  features, previews and staged capabilities must remain clearly distinguishable from live use.
- Messaging coordinates activity and can carry payment requests. It does not itself authorize
  a payment. The separate single-key Zcash messaging account pays its own message fees.

## Capabilities and Constraints

- Preserve existing wallet creation/joining, formation and verification, balances, receiving,
  Send/review, approvals, activity/receipts, Address book, Swap, Messages, Security, recovery,
  Settings and education workflows.
- Network, Solana mode, asset and swap availability depend on current code and server flags.
  Read the current implementation before promising a capability; historical prose and synthetic
  screenshots are not sufficient evidence of deployment availability.
- Keep full addresses, precise native amounts, memos, network costs, approval rules and
  decision-relevant warnings accessible. Factual payment terms must not change during visual work.
- Joined, available, approved, signed, proved, submitted and included are different facts.
  Pending or unknown outcomes must not appear completed.
- Saved backup, checked file, restored share and another device's self-report are different
  facts. Preserve passphrase, device replacement and viewing-access consequences.
- The production web client uses JavaScript ES modules, DOM helpers and CSS with the existing
  Rust/WebAssembly engines and service architecture. React in `web/dev/stageshow/` belongs to
  the isolated illustration lab, not to a production framework migration.
- Current implementation work belongs on `deslopify`, created from `Near`. Committing or merging
  to `main` requires the user's explicit approval. Do not commit, deploy or publish as part of init.

## Brand Commitments

Keep the Zigs name, original zebra fingerprint, original zebra artwork and wallet identity.
The user approved a discreet, precise, slightly wild character and asked for a premium, clean
experience with restrained glass and subtle elevation, consistently in light and dark modes.
Preserve this commitment when refining existing surfaces. Detailed visual decisions remain in
the current styles and `docs/ux-redesign/`; this product record does not replace their authority.

## Evidence on Hand

- `README.md`, `PROTOCOL.md`, `PRIVACY.md`, `CHAT.md` and `ZOLANA.md` explain mechanisms,
  workflows and important limitations; reconcile older capability descriptions with current code.
- `web/logo.png` and `web/assets/brand/hero-zebra.png` contain original identity artwork.
- `web/design-system.css` and the production component styles contain the incumbent UI system.
- `docs/ux-redesign/deslopify.md`, `stageshow-plan.md` and `stageshow-execution.md` in that folder
  record the approved web direction, implementation scope and verification limits.
- `web/dev/stageshow/` contains six authored journey illustrations. Its records, addresses,
  device contributions and file results are synthetic, and it is excluded from deployed assets.
- Browser and model tests support specific documented checks. Synthetic or unfunded evidence
  must not be presented as a successful funded payment, physical-device recovery, independent
  audit, customer endorsement or hardware performance result.

## Product Principles

1. Design first for one individual coordinating their own devices, while preserving multi-person use.
2. Make the wallet, network, exact payment terms and next available action understandable together.
3. Show only progress and outcomes established by the actual underlying state.
4. Treat device loss and recovery as ordinary journeys with explicit scope and consequences.
5. Preserve the established identity and existing capability gates when improving the interface.

## Accessibility & Inclusion

The approved web pass supports keyboard navigation and visible focus, readable contrast,
responsive touch controls, enlarged text, reduced motion, reduced transparency and forced colors.
Keep full financial identifiers and actionable error explanations available to assistive technology.
No additional jurisdiction-specific standard or user-specific accommodation has been established.
