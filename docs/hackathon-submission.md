# NEAR HACKATHON · Zigs submission draft

Working submission material for the NEAR integration. The repository remains private until its
owner explicitly approves publication. This file is a draft, not a submitted application.

[README](../README.md) · [Implementation scope](near-hackathon.md) · [Judge demo](near-demo.md)

## Project summary

**Zigs — shared approval, cross-chain execution.**

Zigs connects an existing shared Zcash/Solana wallet to NEAR Intents through the 1Click Swap API.
A group can review a cross-chain quote, understand the privacy boundaries, and use its wallet
approval flow for a supported source payment. The interface includes explicit public/confidential
routing choices, provider quote authentication, status tracking and encrypted receipt recovery.

The reproducible judge demo gets real mainnet price quotes without a partner key, then simulates
the approval, deposit, settlement and recovery journey. It cannot create a live swap or move funds.
Funded end-to-end settlement, shielded ZEC delivery and refunds have not been verified in Zigs.
The existing wallet and its dependencies are disclosed as the foundation rather than new NEAR work.

## Draft application description

The following is a project-description draft only; it contains no contact or payout details.

> Shared treasuries should be able to move between chains without giving one person all the keys
> or hiding what a swap exposes. Zigs integrates NEAR Intents through the 1Click Swap API into an
> existing shared Zcash/Solana wallet. We built live price quotes, validated swap creation paths,
> explicit public and Basic confidential routing, provider quote verification, group-funded
> payment proposals, encrypted receipts and recovery, and an interactive privacy walkthrough.
>
> Judges can run a key-free local demo: enter SOL, receive a real mainnet price quote, inspect
> slippage and visibility at each boundary, then simulate the six-step swap journey. The preview
> cannot create a live swap or move funds. Full-wallet execution paths are implemented and tested
> with fixtures; funded settlement, shielded ZEC delivery and refunds in Zigs are not verified.
> The README separates the existing wallet foundation from the NEAR integration and links the
> implementation and reproducible checks.

## Review links

| Item | Location |
| --- | --- |
| Repository | This repository; keep private until publication is approved. |
| Reproducible demo | [near-demo.md](near-demo.md), including commands and visible results. |
| Integration and baseline | [near-hackathon.md](near-hackathon.md#existing-foundation-and-integration-scope). |
| Full wallet deployment | [app.zigs.app](https://app.zigs.app); its configuration can differ from this checkout. |
| Demo recording | Use the [recording outline](near-demo.md#two-minute-recording-outline); add the actual public demo-post URL only after it exists. |
| Track candidates | `defi` for cross-chain execution; `privacy` for the explicit privacy boundaries. The owner chooses the submitted tracks. |

## Release and submission checklist

- [ ] Run the focused offline checks in the README and build the web interface.
- [ ] Reproduce the unfunded judge walkthrough; retain the real error if the provider is unavailable.
- [ ] Resolve the remaining release/privacy checks and approve repository publication separately.
- [ ] Record the demo with the simulation clearly labeled, and publish the required demo post.
- [ ] Review the current [organizer instructions](https://nearhackathon.com/HACKATHON.md), eligibility, deadlines and submission requirements.
- [ ] Keep the lead's name, contact email, payout account, consent and complete submission payload outside Git.
- [ ] Let the owner review the exact submission before it is sent. Do not assume this draft was submitted.

No contact details, payout account, invented demo URL or complete application payload belong in
this repository. A documentation update does not authorize publication, social posts, a
submission, deployment or any funded transaction.
