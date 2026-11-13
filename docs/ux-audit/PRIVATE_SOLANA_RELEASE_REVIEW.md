# Private Solana release review

Status: unresolved production decision; no authority transaction authorized or executed by this UX pass.

The repository's current custody record is [ZOLANA.md, section 7.2](../../ZOLANA.md). It records an owner-controlled upgrade authority for the mainnet approvals program, a staging exception, removal of the former trial balance cap, and outstanding production requirements. These are repository records, not a fresh on-chain verification.

An upgrade can replace the approvals program and bypass its wallet digest rule. The custody record explains the additional witness material needed to spend notes and other powers such as freezing groups or stranding funds. The existing disclosure assumes the worst case: the upgrade authority could move every private wallet's funds. Wallet threshold approvals do not constrain that authority. Setup now presents that fact before private-mode acceptance, alongside the existing Help and Security disclosures.

The recorded production exit calls for moving authority to a multisig with a time lock, pinning the ProgramData slot, an independent audit and eventual immutability. Those requirements remain open here. This pass neither accepts exposure on the owner's behalf nor changes the staging/production capability gates.

Before a production decision, the owner and engineering reviewer need a dated record of:

1. The actual deployed program, ProgramData account, upgrade authority and capability-gate state, checked directly against the intended network.
2. The chosen custody policy and completed authority steps, or an explicit revised owner decision documenting the residual control and exposure.
3. Upgrade detection, incident communication and a tested exit route that fits the chosen delay; the current UX migration moves Zcash only.
4. Independent review status and consistency of the setup, Help and Security disclosures with the approved configuration.

Do not infer that the authority has changed, that production is enabled, or that an independent security audit has occurred from the successful local UX tests.
