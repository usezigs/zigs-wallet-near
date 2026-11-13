# End-to-end UX and content audit

Audit date: 13 November 2026. Branch: `codex/near/ux`. Baseline: `Near` at `8c0218b` (`Merge OpenGlass UI and material motion into Near`).

The audit and copy-only phase below are a historical record. The user subsequently approved product fixes; see [the implementation record](ux-audit/IMPLEMENTATION.md) for the behavior changes and their separate verification. The original copy-only verification does not describe the later implementation diff.

## Executive summary

Zigs has a stronger underlying transaction model than its shortest explanations suggest. It checks decoded transactions, distinguishes approval from signing, reserves outstanding payment notes, qualifies unknown outcomes, and separates downloaded backups from checked files. The main launch risk is inconsistency between those safeguards and the explanations users encounter across setup, help, education, and swaps.

The most significant findings are:

1. **P1: payment timing and next steps are not consistently explained.** The Send review says approvals must finish within 24 hours, although the built transaction must also be signed, proved, sent, and included before its actual expiry. Help describes one payment lifecycle for different transaction rails.
2. **P1: help and education contain obsolete capability statements.** The FAQ describes all mainnet Solana as public; the branch also implements an explicitly consented private mode. The illustrated guide still describes a testnet USD demo that the current overview does not show, and says swaps are unavailable despite gated live SOL/ZEC implementations.
3. **P1: swap reports can sound like independently established settlement.** SUCCESS and REFUNDED are provider responses. The interface should attribute them and direct users to the destination wallet or chain. An external payer's refund hint currently reads as a guarantee after any failure.
4. **P1: important limitations require product or engineering work.** Private Solana's program upgrade authority, incomplete Solana history, ambiguous cancellation/Send holds, provider-dependent swaps, opaque RPC failures, and browser-only access deserve explicit release decisions. Copy cannot resolve them.
5. **P2: inconsistent nouns make tasks harder to find.** Address book refers to “Chats,” while navigation says “Messages.” “Personal account” is an actual single-key wallet account, yet one explanation says “It is not a wallet.” Native clients still say “seat” and “signer,” where the web app generally says “device.”

No newly demonstrated P0 is asserted. This is a UX/content audit, not a security audit, production availability check, or funded transaction certification. Mainnet and external authority risks already disclosed in the code remain material.

### Scope and method

Phase 1 was completed before product copy edits. Final source/diff review additionally identified F68–F70 before their banner-only fixes. Phase 2 is limited to existing display strings and the existing FAQ's answers. No components, FAQ entries, styles, layouts, animations, routes, identifiers, transaction logic, cryptography, interfaces, or capability gates are added or changed.

The audit uses the user's ten-part framework. Each flow below states its **goal**, **current journey**, and an **assessment** covering friction, messaging quality, missing information, and trust. Its findings table supplies the location, severity, problem, user impact, recommendation, exact proposed copy when appropriate, and implementation category. Findings with multiple scopes are split; only COPY findings are implementation candidates.

- **B:** exercised in a disposable browser. First-run pages use the real application boot and real WebAssembly engine, with local assets intercepted and external requests blocked.
- **R:** real renderers exercised with the repository's synthetic, unfunded wallet fixture. This proves rendered content and local interactions, not wallet ownership, formation, signing, or payment completion.
- **S:** source inspection, including relevant engine/controller behavior and existing test definitions. Test results are recorded separately; source inspection is never described as a completed live flow.
- Severity: **P0** critical security/financial safety or severe blocking; **P1** major confusion/high impact; **P2** meaningful clarity/usability; **P3** minor refinement.
- Scope: **COPY**, **PRODUCT**, **UI**, **TECHNICAL**. Suggested future text contingent on new behavior is not implemented.

The shared browser connector was occupied. Browser evidence used a separate headless Chrome profile through Playwright instead. No existing browser profile, real wallet, external account, funds, signing authority, or live service was used. No local audit server remained running.

### Personas

- **First-time self-custody user:** understands a device and a payment, but not threshold shares, notes, proofs, or public/private address types. Needs a clear next action and an honest account of what can be lost.
- **Individual using several devices:** coordinates a phone, laptop, and reserve; must not mistake multiple windows or restored copies for independent approvals.
- **Experienced crypto user or group coordinator:** needs exact native amounts, networks, transaction IDs, fee sources, approval authority, external trust boundaries, and credible failure/retry semantics.
- **Interrupted mobile or assistive-technology user:** needs meaningful labels, preserved drafts, context on return, and announcements that distinguish pending from completed actions.

### Verified product model and capability map

| Area | What this branch implements | Boundary |
|---|---|---|
| Shared wallet | 2–7 numbered participants, threshold at least 2; new wallets use version 3 signed coordination writes | A device is a signing identity held in a browser, not proof of a unique person or physical device |
| Formation | Independent share generation, 30-digit safety-number comparison, local address checks | All participants are needed for initial formation; the spending threshold applies afterward |
| Zcash | Testnet and mainnet; local scanning/proving; up to 8 recipients; shielded and supported transparent recipients | Three confirmations for spendable incoming funds; network fees and expiry remain public |
| Control changes | Replacement wallet and approved Zcash transfers | No in-place membership/threshold editing; Solana positions do not migrate through this operation |
| Recovery | Encrypted file per participant and chain; optional saved-file checks; restore verifies fit | A passkey is not a backup; copies of one share remain one participant; private notes/address book/direct chats have separate limitations |
| Solana | Devnet private pool; gated public mainnet SOL/USDC; gated private mainnet SOL | Separate keys, fee funds and trust assumptions. Private mode does not silently fall back to public |
| Swap | Mainnet dry quotes; gated external SOL→ZEC, group SOL→ZEC, and group ZEC→SOL deposits | NEAR Intents and the Worker are trusted; source approval does not establish destination receipt |
| Messaging | Wallet rooms, payment discussions, direct relay chats, recipient memos, and a separate on-chain messaging account | Different keys, visibility, fees, identity checks, retention, and recovery |
| Education | Illustrated guide, setup guide, optional name/funding/Tor/post-quantum previews | A preview never establishes a live capability or a successful security operation |
| Native | SwiftUI iPhone/Mac source using the shared Rust engine | Not run here; release documentation excludes native mainnet/Solana/personal-account feature parity |

Repository configuration, **not a live deployment observation**: `cf/wrangler.jsonc` sets production `SOL_MAINNET=0`, `SOL_POOL_MAINNET=0`, `NEAR_LIVE=0`; staging sets all three to 1. `MAINNET_ON=true` in `web/app-chain.js`. Server HTML controls live-swap availability. Current public deployment flags were not queried.

Architecture evidence: `README.md`, `PROTOCOL.md`, `PRIVACY.md`, `CHAT.md`, `ZOLANA.md`, `wasm/src/expiry.rs`, `wasm/src/session.rs`, `web/app-dkg.js`, `web/app-filter.js`, `web/app-payments.js`, `web/sol/`, `web/sol/plain/`, `cf/src/near.js`. The shipping shell is React/OpenGlass around existing DOM modules; audit conclusions are based on these controllers and engines as well as rendered screens.

## Flow-by-flow findings

### 01. Arrive and understand Zigs — B/S

**Goal:** decide whether Zigs fits the user's custody needs. **Journey:** landing → Create wallet, Join a wallet, Recover access, or How Zigs works. **Assessment:** the actions are clear, but “Hold your assets privately” is broader than the public Solana and transparent-payment model. A beginner learns the asset/network and unaudited status later. Experienced users can reach the long guide, but should not have to infer the scope of “private.”

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F01 | `web/app-shell.js`, `welcome` | P1 / COPY | The first-run summary applies a blanket privacy promise to assets with different visibility. | Replace “Hold your assets privately. Protect them with the people and devices you trust.” with “Share control of Zcash and supported Solana assets across the people and devices you trust.” Keep detailed privacy disclosures where they already exist. |
| F02 | Same landing, before any real-funds choice | P1 / UI | Audit status is available in Help/Security but absent from the first impression. Users may treat premium presentation as assurance. | Future existing-risk disclosure near entry: “Beta · Not independently audited.” Adding a disclosure element is outside this task. |

### 02. Open an existing wallet, join, or view — B/R/S

**Goal:** regain access or join an invited wallet. **Journey:** paste full invite → read wallet → take an open participant slot, or restore an existing share if slots are full. **Assessment:** malformed-link feedback is actionable and was exercised. Opening a link grants readable access, not a spending share. There is no generic external-wallet connection or universal seed import in this flow; “Join” should not imply either. View-only users need to understand why approving is unavailable.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F03 | `web/app-shell.js`, `joinWallet`; `web/app-links.js` | P2 / COPY | “Paste it here to open the wallet” does not explain what opening grants. | Existing helper: “Paste a private invite link to open the wallet. To approve payments, join an open device slot or restore your existing device’s backup.” Preserve invalid-link messages and secret-fragment handling. |
| F04 | `web/app-wallet.js`, view-only/unfinished states | P2 / UI | A disabled action and the absence of a local share can require hunting through Security. | Future state-specific guidance beside the action: “View only in this browser. Restore an existing device’s recovery file to approve.” Requires placement and condition review. |

### 03. Protect the browser during creation — B/S

**Goal:** decide how local signing data is protected. **Journey:** Protect this browser → credential operations → encrypted-copy check, or Skip for now → explicit risk confirmation. **Assessment:** the current copy distinguishes a passkey from another approval and names unprotected local storage accurately. The skip confirmation is substantive. Browser support detection can precede a later PRF failure, so a visible button alone must never imply compatibility.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F05 | `web/app-shell.js`, `deviceProtection`; `web/app-keystore.js` | P2 / TECHNICAL | WebAuthn presence does not establish that a chosen credential supports the required encryption operation. Users can fail late. | Exercise unsupported PRF, cancellation, interrupted cleanup, and storage-denial paths on actual browsers/authenticators. Preserve “not protected” until verification succeeds; no speculative compatibility promise. |

### 04. Unlock, lose a passkey, or delete locked data — S

**Goal:** open local encrypted data without losing access. **Journey:** Unlock → provider authentication; lost passkey → review deletion consequences → delete or keep. **Assessment:** deletion consequences cover shares, chats, the messaging account, and recipients. The unlock sentence assumes Apple biometrics or a security key, excluding PIN-based providers. Actual lost-credential recovery was not tested.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F06 | `web/app-shell.js`, `lockView` | P2 / COPY | “Unlock with Face ID, Touch ID or your security key” can make a supported PIN flow look wrong. | “Your passkey provider may ask for a fingerprint, face, PIN or security key.” This describes provider options, not recovery capability. |
| F07 | `web/app-shell.js`, `forgetBox`; `web/app-keystore.js` | P1 / TECHNICAL | Copy cannot prove an accessible backup exists before local deletion. Loss can be permanent. | Validate deletion/restore with disposable credentials and recovery files, including incomplete storage. Retain the explicit destructive confirmation and do not promise passkey reset recovery. |

### 05. Choose the participant count and threshold — B/S

**Goal:** balance convenient approvals with tolerable device loss. **Journey:** default 2 of 3 → numeric controls → review tolerance → acknowledge an all-devices rule if selected. **Assessment:** meanings and loss margin are explained well. A newcomer can still assume the reserve may remain offline during formation. The current warning should distinguish setup participation from later payment participation.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F08 | `web/app-shell.js`, `ruleStep`; `web/app-tutorial.js` | P2 / UI | The all-participants setup requirement is clearer at review than at the rule decision. | Future contextual sentence near the controls: “All devices join setup. After setup, any required subset can approve payments.” Placing it is UI work. Preserve the 2–7 and threshold validation. |

### 06. Label this device and choose networks — B/S

**Goal:** identify the wallet and choose test or real assets. **Journey:** device label → wallet name → Testnet/Mainnet → review optional Solana configuration. **Assessment:** labels correctly do not verify identity. Mainnet's description names the Zcash network without explicitly contrasting real money with Testnet's free coins. This is a material first-use decision.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F09 | `web/app-dom.js`, `networkPick` | P1 / COPY | “Send and receive ZEC on the Zcash network” does not say mainnet uses real funds. | “Real ZEC. Transactions use real funds and network fees.” Implement only the existing descriptive text, leaving the network values and radio identifiers intact. |

### 07. Invite devices and occupy slots — S

**Goal:** connect only the intended independent participants. **Journey:** copy/share invitation or QR → join slot → check labels → keep all devices connected. **Assessment:** privacy warnings and same-browser demo boundaries exist. Labels are self-chosen; a full invite can expose history and allow an open slot to be occupied. Sending invitations and actual multi-device joining were not performed.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F10 | `web/app-setup.js`, `inviteCard`, `demoDevices`, `joinCard` | P1 / PRODUCT | An unintended holder can occupy an open slot. Copy and a recognizable label cannot identify them. | Preserve full safety-number comparison as the identity check. Product work should define a clear abandon/restart path for an occupied unintended slot; proposed future warning: “An unexpected device joined. Stop setup and check every device before continuing.” |

### 08. Compare the safety number and handle mismatch — S

**Goal:** verify the exact formation participants and configuration. **Journey:** reveal full 30 digits → compare on actual screens/independent channel → confirm or report mismatch. **Assessment:** the eight-digit preview is explicitly insufficient; educational drawings are not remote checks. Correct, high-value safeguards should remain. The audit did not compare physical devices.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F11 | `web/app-setup.js`, `safetyCard`, `confirmPart`, `mismatchPart` | P2 / TECHNICAL | Mismatch, changed-number, and interrupted confirmation are important source-inspected paths without physical-device evidence. | Run a physical-device matrix, including swapped invitations and different device labels. Preserve “compare all 30 digits”; do not simplify it to matching the preview. |

### 09. Prepare keys, check addresses, and recover from service failure — S

**Goal:** finish formation without creating conflicting wallets. **Journey:** participants exchange ceremony messages → local address checks → optional separate Solana preparation → continue with Zcash if eligible. **Assessment:** the app names waiting devices, distinguishes chains, and cautions against resetting saved keys. Technical terms remain in expandable details. A network outage must not look like a fresh-creation requirement.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F12 | `web/app-setup.js`, `guidedPrepare`; `web/app-dkg.js` | P1 / TECHNICAL | Terminal cryptographic stops and temporary service failures need different recovery actions. Global raw errors do not guarantee this distinction. | Verify each error's actual state and preserve the existing “do not recreate/reset” advice for temporary Solana unavailability. Define typed recoverable/terminal errors before broad wording changes. |

### 10. Complete setup and choose optional backups — S

**Goal:** know the wallet is formed and what remains to do. **Journey:** prepared state → optional save/check files → Open Overview → receive or fund. **Assessment:** optional backups are consistently labeled, and formation is not represented as funding. The user can finish without recovery material. “Optional” can be interpreted as “unimportant” by a novice.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F13 | `web/app-setup.js`, `guidedReady`, `recoveryExplanation` | P2 / UI | Recovery consequence is mostly inside details on the compact completion screen. | Future concise visible support: “Without enough working devices or recovery files, funds can become inaccessible.” Do not add a mandatory backup gate in a copy task. |

### 11. Understand balances, prices, and synchronization — R/S

**Goal:** know what is held and what can be spent now. **Journey:** overview total → per-asset balance → balance details → Refresh. **Assessment:** the code distinguishes unknown, saved, stale, pending, and spendable values; native ZEC uses up to eight decimal places. Testnet shows native coins, not a USD price. Mainnet's USD valuation includes ZEC only and is derived from a provider quote, not a guaranteed realizable value.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F14 | `web/how-zigs-works-content.js`, Receiving → Confirmed, pending and available | P1 / COPY | The guide says Testnet shows `$0.00` with a Demo label. It contradicts the actual overview and could make zero/unknown ambiguous. | Replace the obsolete sentences with “Testnet shows native test-coin balances, not a USD valuation.” Preserve the detailed qualification of mainnet's quote-based ZEC value. |
| F15 | `web/app-wallet.js`, `testnetTotal`, `liveTotal` | P2 / COPY | Testnet headings say “Wallet balance” even though the value is ZEC only. A user can mistake it for all assets. | Existing visible labels: “ZEC balance” and “ZEC balance on Testnet.” No valuation or formatting changes. |

### 12. Fund an empty test wallet — R/S

**Goal:** obtain spendable test coins. **Journey:** Copy address → external faucet → Incoming → Available after three confirmations. **Assessment:** faucet visibility and cooldown explanations are useful. “About 75 seconds” is a nominal estimate, not evidence the faucet paid or a confirmation guarantee. Real faucet payouts were not attempted.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F16 | `web/app-wallet.js`, `fundCard`; external faucet | P2 / PRODUCT | A faucet outage and an unpaid claim can look like wallet sync failure. | Future troubleshooting should distinguish no transaction ID, unconfirmed transaction, and confirmed-but-unsynced receipt. Proposed help: “Check whether the faucet gave you a transaction ID before troubleshooting wallet sync.” Requires service-specific verification. |

### 13. Receive Zcash and copy/share addresses — R/S

**Goal:** share the correct checked receiving address. **Journey:** Receive → wallet/network context → QR/copy/share → optional full address/privacy details. **Assessment:** address checks, full-value access, matching QR/copy sources, and the three-confirmation rule are present. The detail sentence “Senders and the network cannot see the balance or who controls it” is broader than a shielded-chain privacy claim.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F17 | `web/app-send.js`, `receiveLead` | P1 / COPY | The privacy sentence can be read as an identity/anonymity guarantee. | Replace it with “Shielded payments hide recipient addresses and amounts on chain.” Retain the adjacent invite-holder/device viewing disclosures; this does not promise network anonymity. |

### 14. Find a transparent address and a swap refund — S

**Goal:** locate public refund funds without confusing them with private receipts. **Journey:** Receive → Public address and swap refunds → balance/read → Copy transparent address. **Assessment:** the section explains public amounts and common approval rule. The refund is not already shielded and has a separate read path. A failed balance read offers little guidance.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F18 | `web/app-taddress.js`, `readTaddressBalance`, `balanceLine` | P2 / UI | “The balance could not be read” has no adjacent retry control in the balance line. Users cannot tell whether funds are absent. | Future state with a retry action: “Public balance unavailable. Retry the balance check before deciding whether the refund arrived.” A new control/behavior is outside scope. |

### 15. Shield public refund funds — S

**Goal:** move transparent ZEC into this wallet's shielded balance. **Journey:** propose sweep → independent decoded checks → participant signatures → proof/send → check chain. **Assessment:** it is a separate threshold transaction with a fee and public source amount, not an automatic refund feature. Existing receiving copy can imply that approvals alone trigger the whole move.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F19 | `web/app-taddress.js`, `PUBLIC_TEXT`; `web/app-sweep.js` | P1 / COPY | “Zigs moves the funds ... when ... devices approve” hides remaining steps. | Future concise correction: “Moving these funds needs the wallet’s approvals, a proof and submission to the network.” Leave implementation for a sweep-specific review because this audit did not exercise the full separate sweep lifecycle. |
| F69 | `web/app-sweep.js`, `sendSweep` submission banner | P1 / COPY | “The move confirms with the next block” promises timing after a broadcast response. | “The move was submitted to the network. Wait for block confirmation.” This narrow banner correction does not change or certify the separate sweep lifecycle. |

### 16. Compose a single Zcash payment and retain a draft — S

**Goal:** pay the correct address and amount. **Journey:** Send asset → address/name → amount → memo/note → review. **Assessment:** self-address, network, decimal precision, fee affordability, and transparent-memo restrictions are checked. Drafts are encrypted with the wallet secret for 24 hours. “The form still works” after a save failure does not tell an interrupted user what can disappear.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F20 | `web/app-send.js`, `draftLine` | P2 / COPY | Failed persistence is understated. Closing the page can lose the draft. | “This draft could not be saved in this browser. Keep this page open to retain what you typed.” Does not claim a transaction was sent or funds were reserved. |

### 17. Add recipients or paste a batch — S

**Goal:** make one reviewed payment to several destinations. **Journey:** Add recipient/Paste a list → parse rows → correct row-specific errors → inspect all recipients → request approvals. **Assessment:** eight recipients is enforced; memos and the single approval round remain distinct. Successful parsing is not ownership verification. List-import edge cases were reviewed through the existing parser/tests, not a funded batch.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F21 | `web/app-send.js`, `pasteList`; `web/payees.js` | P2 / UI | The helper describes the format but does not state the eight-recipient limit before importing. | Add the limit to existing import guidance in a future copy/fit pass: “Up to 8 recipients. One address and amount per line, followed by an optional memo.” Check spreadsheet tabs, commas, multiline input, and per-recipient Unicode memo bytes. |

### 18. Resolve a ZNS recipient name — S

**Goal:** pay a name without silently trusting a changed address. **Journey:** testnet name → local registry resolution → display full result → fresh check at review/approval. **Assessment:** the web approver rechecks resolution and the registry-copy privacy boundary is documented. Registry availability and actual sender identity remain outside name-format validation.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F22 | `web/app-send.js`, `shownOf`, `freshHit`; `web/zns.js` | P2 / PRODUCT | A resolved name can be mistaken for verified human identity. The address book explicitly disclaims this; name resolution needs equally contextual treatment. | Future helper: “This name resolves to the address below. Confirm the recipient separately.” Preserve refusal when a displayed resolution changes. No registry or recipient logic changes. |

### 19. Review costs, priority fees, and expiry — S

**Goal:** understand exactly what is proposed before sharing it. **Journey:** decoded review → recipients/memos → total including fee → approval rule/privacy → Request approvals. **Assessment:** the action correctly says it does not sign or send. The one-day note names approvals only, while expiry applies to the complete transaction and can be shortened by an upgrade boundary. A priority fee must not promise a faster block.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F23 | `web/app-send.js`, `EXPIRY_NOTE`; `wasm/src/expiry.rs` | P1 / COPY | Finishing approvals is not enough to beat expiry. | “The transaction usually expires within about 24 hours. Approve, sign, prove and send it in time for block inclusion. Check its expiry in the payment details.” The displayed exact height remains authoritative. |
| F24 | `web/app-send.js`, `priorityBox` | P2 / COPY | “For a faster block” implies an outcome the wallet does not control. | Replace only that phrase with “to request faster inclusion.” Preserve the 10× factor and fingerprinting disclosure. |

### 20. Request and collect approvals — R/S

**Goal:** ask enough distinct participants to review one payment. **Journey:** request approvals → Approvals inbox → decoded payment review → Approve on each available device. **Assessment:** counts represent actual applicable approvals; the inbox distinguishes Zcash from partial Solana results. Devices must open Zigs; browser notifications concern messages and are not a proven background approval notification system.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F25 | `web/help-model.js`, “What does a payment need?” | P1 / COPY | “Then the payment can be sent” skips Zcash's proof and manual submission and implies a universal rail. | Explain that chosen devices sign while open, Zcash then needs Build proof and Send to network, and Solana follows its own sending/execution steps. Exact implemented answer is in the copy log. |
| F26 | `web/app-settings-ui.js`, notifications; `web/app-groups.js` | P1 / PRODUCT | Users may expect a background alert on another signer device. Current notifications are message alerts while open. | Future existing-flow instruction: “Open this wallet on the other devices to review the request.” Define approval notification delivery/reliability separately; do not promise push notifications. |

### 21. Sign together and build the Zcash proof — S

**Goal:** complete authorization after the threshold. **Journey:** proposer builds signing package → selected devices contribute while open → combine → Build proof → ready to send. **Assessment:** these are distinct states, not extra user approvals. Closing the proposing or selected device can stop progress even after enough approvals. Proof takeover exists after a stall, but timing and device availability need real-browser testing.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F27 | `web/payment-model.js`, approved/signing/proving states; `web/app-payments.js` | P2 / UI | The exact devices needed now are not always available beside the headline. | Future state-specific text: “Keep the proposing device and the selected signing devices open until signing finishes.” Derive names from the actual package; do not invent online status. |

### 22. Send, wait, and establish confirmation — S

**Goal:** submit once and learn whether it landed. **Journey:** Send to network → submitted/broadcast → sync → included block → confirmations. **Assessment:** the model carefully separates attempted broadcast, a reported sent mark, inclusion, and spendability. That nuance is flattened in Help, which describes Zcash proof steps as universal and only cautions against duplication during “Confirming.”

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F28 | `web/help-model.js`, “Why is my payment not done yet?” | P1 / COPY | Users with an unknown send outcome or Solana payment get incomplete guidance. | Name the Zcash steps and Solana execution separately. “A submitted transaction is not yet confirmed. Check Activity before proposing another payment when the outcome is unknown.” |
| F68 | `web/app-payments.js`, `broadcastTx`, `resendTx` | P1 / COPY | Success banners promise confirmation “with the next block,” although the completed call only establishes submission. | “Submitted to the network. Wait for block confirmation in Activity.” For resend: “The same transaction was submitted again. Wait for block confirmation in Activity.” |

### 23. Reject, cancel, and release a Send hold — S

**Goal:** stop an unwanted proposal without paying twice. **Journey:** Cancel before the signed state → cancellation write → possible retained local hold → check activity/expiry → deliberate release if appropriate. **Assessment:** there is no separate per-device Reject journey. A global cancel is not cryptographic revocation; the hold warning is appropriately cautious, while the confirmation says no device can approve afterward.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F29 | `web/app-drawer.js`, `CANCEL_ASK`, `holdCard`; `web/app-payments.js`, `cancelPayment` | P1 / TECHNICAL | Cancellation wording can overstate what a relay state change guarantees, especially around stale or malicious devices. | Reconcile the confirmation with signed-share retention and local holds. Candidate pending review: “Cancel this proposal? Zigs asks devices to stop. Check Activity before proposing a replacement.” Do not change logic or security wording without a state-specific review. |
| F30 | Same actions | P2 / PRODUCT | A user wanting to decline their approval can cancel for everyone instead. | Define whether a per-device decision is needed and how it affects signing. No new Reject button or protocol state here. |

### 24. Retry a send, expire, or propose again — S

**Goal:** recover from an unknown or expired outcome safely. **Journey:** inspect chain → resend identical finished bytes where allowed → wait for authoritative expiry → review a replacement where allowed. **Assessment:** the engine's unknown/expired/done distinction and overlapping-note replacement avoid simple “try again” promises. “Send again” can still sound like a new payment to a first-timer.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F31 | `web/payment-model.js`, resend; `web/app-drawer.js`, `finishButtons` | P2 / UI | The crucial “same transaction” explanation is in body text rather than the action itself. | Future label/help pair: “Resend transaction” / “Submits the same transaction again; it does not create a new payment.” Review visible and accessible labels together in a dedicated interaction pass. |

### 25. Inspect history and enable incoming memos — R/S

**Goal:** understand what happened and read incoming notes deliberately. **Journey:** Activity filters → receipt/explorer → Settings → Incoming payment memos disclosure → enable/disable. **Assessment:** loading, failed sync, ignored records, and incomplete Solana history are qualified. Turning retrieval off leaves downloaded memos in storage. The FAQ omits that important retention consequence, although Settings explains it.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F32 | `web/help-model.js`, incoming-memos answer | P2 / COPY | Users can assume disabling retrieval removes messages already downloaded. | Append “Turning it off stops new memo requests; memos already downloaded stay in this browser.” Match existing `memoSwitch` behavior. |
| F33 | `web/sol/payview.js`, `SHOWN`; `web/approvals-model.js`, older results | P1 / PRODUCT | Only the newest 12 private Solana proposals are shown. An “empty” review is not a complete historical search. | Preserve truncation disclosure and design a supported older-record recovery/history path. Source inspection does not establish an exploit or lost funds. |

### 26. Save, search, edit, select, or remove payment recipients — R/S

**Goal:** reuse the right destination without treating a name as verification. **Journey:** Address book → choose asset/network/type → save → select in Send → full review; remove requires confirmation. **Assessment:** local-only storage, independent chat contacts, concurrent edits, and format-only validation are explained. The page sends users to “Chats,” which is not the current navigation label.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F34 | `web/app-recipients.js`, `recipientsView` | P2 / COPY | “Chat contacts stay in Chats” creates a navigation mismatch. | “Save payment recipients for all wallets in this browser. Chat contacts stay in Messages.” Browser scope is more precise than physical-device scope. |

### 27. Add/remove devices or change the rule — R/S

**Goal:** replace compromised/lost participation or change control. **Journey:** Security → Advanced wallet management → replacement wallet → new formation → old wallet approves one or more Zcash transfers → use new address. **Assessment:** this does not revoke old shares in place, erase old viewing access, or migrate Solana. Fees, unspendable remainder, future old-address receipts, and disruptive relay writes remain important limits.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F35 | `web/app-wallet.js`, `changeSignersCard`, `SOL_STAYS`, `PLAIN_STAYS`; `web/privacy-language.js` | P1 / PRODUCT | “Change devices” can imply a complete migration. Solana and later receipts to the old address remain exposed to old control. | Define chain-specific migration and completion criteria; retain current explicit limitations. Future completion instruction: “Use the new Zcash address for future receipts. Check and move Solana separately.” No automatic transfer or revocation claim. |

### 28. Save an encrypted recovery file — S

**Goal:** preserve one participant's authority outside the browser. **Journey:** choose chain/device → enter or generate strong passphrase → confirm → encrypt/read-back → download → store separately. **Assessment:** the minimum, distinct-character rule, no seed-phrase equivalence, clipboard risk, and file-plus-passphrase authority are clear. The FAQ treats two chain files as requiring necessarily different passphrases, though each file merely has its own chosen passphrase.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F36 | `web/help-model.js`, “Where is my backup file?” | P2 / COPY | “Two files and two passphrases” is less precise than per-file encryption, and “saved” is not proof a file can be reopened. | “A device with a Solana part has two files, each protected by its chosen passphrase.” End with “The Security section shows saved-file progress, not a guarantee that the files remain accessible.” |

### 29. Check a downloaded recovery file — R/S

**Goal:** establish that this copy matches this browser's current share. **Journey:** Verify file/Check saved file → choose file/passphrase → open locally → compare → record local checked state. **Assessment:** checking is separate from restoring, does not import nonces, and remote reports are qualified. A checked copy can subsequently be lost; no copy can prove ongoing accessibility.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F37 | `web/app-backups.js`, `backupCheckDialog`; `web/app-security-dashboard.js` | P3 / COPY | “Verify” and “check” describe the same operation across setup and Security. Minor extra learning, not a security defect. | Future terminology pass: use “Check saved file” consistently while retaining existing identifiers and preserving the no-restore explanation. Current labels are not changed here to avoid accessible-name/test churn. |

### 30. Restore a share and handle a mismatching backup — S

**Goal:** recover existing authority without overwriting a working share. **Journey:** file → passphrase → parse/shape/conflict checks → temporary import → published-wallet fit → accepted or undone; restore separate Solana file if present. **Assessment:** provisional restoration and final matching are distinct, and no imported signing nonces are used. A restart during provisional checking or an incompatible old format needs a precise outcome.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F38 | `web/app-backups.js`, `announceRestore`, `settleRestore`, `staleRestoreNote` | P1 / TECHNICAL | “Restored ... It counts ... once it matches” can be interpreted as finished before the asynchronous fit decision. | Verify restarts and failed reads before changing the success state. Future pending text: “Backup opened. Checking that this share matches the wallet.” Use a success announcement only after the current fit checks succeed; that behavior change is not implemented. |

### 31. Enable Solana and consent to its mode — S

**Goal:** choose a supported public or private Solana account deliberately. **Journey:** server capability check → network/mode consent → separate ceremony → no private-to-public silent fallback. **Assessment:** private mainnet exposes real funds to program upgrade authority, beyond wallet approvals. Help's unconditional public-mainnet description is wrong for this branch. Availability is server configuration, not inferred from rendering.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F39 | `web/help-model.js`, network/server answers; `web/app-sol.js`, `solMode`; `web/sol/net.js` | P1 / COPY | FAQ omits gated private mainnet and its authority/visibility differences. | Describe public SOL/USDC and private SOL as server-dependent choices. State that private amounts do not conceal payee owner keys and program upgrades are outside wallet approvals. Exact answers are in the copy log. |
| F40 | `web/security-disclosures.js`; `web/sol/net.js` | P1 / PRODUCT | One upgrade authority can replace the private approvals program and move funds. A threshold is not protection against it. | Make a release decision on acceptable authority and exposure. Preserve the current disclosure; no “non-custodial means nobody else can move funds” claim. This is an existing architectural risk, not a newly demonstrated exploit. |

### 32. Fund a Solana fee address and deposit with Add SOL — S

**Goal:** fund operational fees and the private group balance correctly. **Journey:** fund each needed public fee address → read balance → Add SOL from selected device → track uncertain deposit → sync pool. **Assessment:** device fee money differs from group holdings; Add SOL does not require group approval. Direct public SOL sent to a private program address is not the deposit path and can become inaccessible. Recipient-type distinction is financially critical.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F41 | `web/sol/view.js`, receive; `web/sol/payview.js`, `fundCard`, `addSolCard`; `web/sol/addsol.js` | P1 / UI | Users must distinguish shielded transfer addresses, fee addresses, and program diagnostics. A standard Solana payer may not support the shielded format. | Keep the existing “not a standard Solana account address” warning and Add SOL path. Test whether users can pick the right address without Security. Do not add public program-address copy affordances. |

### 33. Make a private Solana payment or public withdrawal — S

**Goal:** transfer private holdings with the intended visibility. **Journey:** choose private payment/public withdrawal → exact units → decoded intent/proof review → threshold approvals → automatic execution by an eligible fee payer → chain outcome. **Assessment:** a hidden amount is not an anonymous recipient; withdrawals expose recipient and amount. Approval threshold and automatic execution differ from manual Zcash submission.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F42 | `web/sol/payview.js`, `approveRow`, `executeLine`, `resultLine` | P1 / UI | Users transferring Zcash expectations can wait for a Send button or miss that enough approvals trigger execution. | Future review helper: “After enough approvals, an eligible device can execute this payment automatically. Keep a device with fee funds open.” Derive eligibility from controller state; no execution behavior change. |

### 34. Prove locally, migrate legacy pool funds, and reclaim rent — S

**Goal:** finish or clean up Solana operations without confusing locked rent with fees. **Journey:** local proving checks/downloads → payment/legacy transfer; expired proposal → Find reclaimable rent → proposing fee key reclaims. **Assessment:** hosted proving fallback is refused; proposal-account rent is distinct from consumed network fees. Legacy nonce-account setup and rent scans are advanced journeys with different expiry rules.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F43 | `web/sol/localprove.js`, `web/sol/payview.js`, `RENT_TEXT`, `moveCard`; `web/sol/rent.js` | P2 / UI | Long technical sections mix proof readiness, legacy state, and rent recovery. The user may treat reclaimable rent as a failed payment refund. | Future task-specific help: “Reclaiming rent returns the expired proposal account’s remaining SOL. It does not refund a payment or network fees.” A contextual insertion requires UI review; do not alter scan/cancel authority. |

### 35. Set up public mainnet Solana sending and USDC — S

**Goal:** make a public account ready for threshold payments. **Journey:** separate key formation → fund fee address → create nonce accounts → enable USDC where needed → review confirmed setup. **Assessment:** rent, nonce capacity, fee-payer keys, and the group's SOL balance are different prerequisites. Native users do not have this workflow. Setup must not be presented as a universal activation charge.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F44 | `web/sol/plain/view.js`, `sendSetup`; `web/sol/plain/direct.js` | P2 / UI | “Create nonce” and “Enable USDC” are technical tasks users can confuse with payment approval. | Future existing-step explanations: “Create an account used to coordinate sends” and “Create this wallet’s USDC token account.” Keep exact rent/fee and signing authority in review. No rename of programmatic operation kinds. |

### 36. Send or receive public SOL and USDC — S

**Goal:** use the plain mainnet account with exact public terms. **Journey:** Receive SOL/USDC or compose send → validate address, precision, balance and nonce → review → approve → send/confirm. **Assessment:** supported tokens, public visibility, foreign-address checks, unread/stale balances, and fee payer are explicit. A lack of USDC account is different from a verified zero USDC balance.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F45 | `web/sol/plain/view.js`, `NOT_ENABLED`, `rowOf` | P2 / COPY | “No USDC yet” is used when the token account is absent, not just when its balance is zero. | Candidate: “USDC account not enabled.” Retain as a future rail-specific copy change after testing all places that consume `readTexts`; it is not implemented in this pass. |

### 37. Select a swap pair, amount, and slippage — R/S

**Goal:** understand a quote and whether it can be executed here. **Journey:** choose assets → enter amount → provider dry quote → minimum received, USD estimates, time → slippage presets → quote expiry/review. **Assessment:** quote requests use sample addresses and quotes expire after 60 seconds. Slippage is only described as “Sent with the quote request,” which explains plumbing rather than the user's exposure. No independent fee/price-impact breakdown is available in the dry quote model.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F46 | `web/app-swap-preview.js`, slippage helper | P2 / COPY | The current helper does not explain the minimum output. | Replace “Sent with the quote request” with “Sets the minimum quoted amount you receive.” Do not promise guaranteed fill, refund, or bounded total cost. |
| F47 | `cf/src/near.js`, `web/near-intents-swap-provider.js`, `quoteRows` | P1 / TECHNICAL | The quote model exposes input/output estimates, not an independently verified fee breakdown or price-impact measure. Users cannot identify all costs from a synthetic spread. | Investigate supported upstream fields and exact fee inclusion before adding them. Do not invent fee/impact numbers or claim “all fees included.” |

### 38. Swap external SOL to the wallet's ZEC — S

**Goal:** pay from a self-controlled external Solana wallet and receive ZEC here. **Journey:** live route → payout/refund review → risk agreement → Get deposit address → externally send exact SOL before deadline → provider tracking → check Zcash receipt. **Assessment:** no Zigs group approval controls the external payment. Untested shielded payout and deadline risks are disclosed. The refund helper implies every failed swap refunds automatically.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F48 | `web/app-swap-preview.js`, `drawLiveReview` | P1 / COPY | “NEAR Intents sends the SOL back to this address if the swap fails” overpromises refund behavior. | “NEAR Intents uses this address for any SOL refund.” Keep the self-controlled, non-exchange payer/refund-address instruction. |

### 39. Swap group SOL to the wallet's ZEC — S

**Goal:** use public group SOL under the existing threshold. **Journey:** choose group payer → check balance/rent/nonce/fee → create swap → propose exact deposit → each approver rechecks route → complete payment before cutoff → track destination. **Assessment:** creating a deposit address does not pay it. The exact destination/refund checks trust the Worker and provider; a signature displayed in details is not locally verified by this integration.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F49 | `web/app-swap-sol.js`, `checkSolSwap`; `web/sol/plain/sessions.js` | P1 / TECHNICAL | The displayed quote signature can look like independent route verification although the code trusts the service response. | Review provider authentication and disclosure. Candidate explanatory text: “The wallet checks the route returned by Zigs and NEAR Intents; it does not independently verify the quote signature.” Add only after confirming the complete trust model. |

### 40. Swap group ZEC to the wallet's SOL — S

**Goal:** approve a transparent deposit that pays the correct public Solana account. **Journey:** checked destination/refund keys → live quote/address → Send review with protected swap note → approvals/sign/proof/send → provider settlement. **Assessment:** the deposit leaves the shielded pool; refunds are transparent and need a separate shielding journey. The quote deadline and Zcash transaction expiry are separate; late-swap-send refusal can leave Send reserved until its transaction expires.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F50 | `web/app-swap-zec.js`, `LATE_SEND`, `swapNote`; `web/app-swap-preview.js`, `ZEC_PROPOSE` | P1 / PRODUCT | A swap can become too late to send before the Zcash payment expires. Users may be blocked from fresh sends without understanding both clocks. | Design an explicit dual-deadline review and safe completion/release path. Candidate: “The swap deposit closes before this transaction expires. Do not reuse the deposit address.” No note-prefix or expiry logic changes. |

### 41. Track, restore, hide, or finish a swap — S

**Goal:** return to an in-progress swap without duplicating its deposit. **Journey:** save encrypted local record → reload → verify recorded route with provider → show details → poll status → inspect source/destination IDs → hide or Done. **Assessment:** route re-verification and uncertain-proposal recovery are good safeguards. A provider SUCCESS/REFUNDED does not independently establish chain inclusion; incomplete deposits and failed routes need recovery evidence.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F51 | `web/app-swap-preview.js`, `SWAP_STATES`, `ZEC_STATES` | P1 / COPY | “Done ... sent” and “Refunded” sound like locally confirmed outcomes. | Attribute each report: “NEAR Intents reports ...” and ask for destination sync/public-refund verification. Preserve the existing raw status keys and polling. |
| F52 | `web/swap-preview-model.js`, `SWAP_FINAL`; `web/app-swap-preview.js`, Done | P1 / PRODUCT | FAILED is terminal for tracking, yet a user may still need help recovering funds. Dismissing local state can remove the convenient quote record. | Define export/retention and a support handoff before closing failed tracking. Candidate: “Keep the quote ID and transaction IDs until the funds are accounted for.” New recovery/export behavior is outside scope. |

### 42. Coordinate in a wallet room or payment discussion — R/S

**Goal:** discuss a payment without accidentally approving it. **Journey:** Messages → wallet room, or receipt → payment discussion → send signed encrypted relay text. **Assessment:** no blockchain fee and “messages do not approve payments” are clear. Membership is a signing identity, not verified human identity. Relay disconnection preserves drafts only in the current tab and may deliver an earlier send later.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F53 | `web/app-messaging-workspace.js`, `emptyConversation` | P2 / COPY | “A little closer. A little more private.” does not tell an empty inbox user what to do. | Replace the existing heading with “Choose a conversation.” Preserve the adjacent fee and separate-approval explanations. |

### 43. Create/join a direct chat, verify a contact, or leave — S

**Goal:** exchange private relay messages with the intended person. **Journey:** private invitation → explicit Join chat → pinned key/signature checks → converse → deliberate Leave confirmation. **Assessment:** the link can expose history; matching signatures prove key continuity, not identity. Direct chats are not in wallet backups and cannot simply be rejoined after leaving. These are unusually strong consequences for a familiar chat affordance.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F54 | `web/app-thread.js`, `chatInviteCard`, `leaveBox`; `web/app-messages.js` | P2 / UI | Retention and no-rejoin consequences sit inside conversation details until departure. | Future onboarding/support text: “Keep this browser’s chat access. Wallet recovery files do not restore direct chats.” Preserve current confirmation and pinned-key warnings. No chat backup feature is implied. |

### 44. Create, back up, fund, or remove the on-chain messaging account — R/S

**Goal:** pay message fees from a separate account. **Journey:** On-chain messages → choose network → create single-key account → back up seed/contacts → fund through a three-output request → remove only after reviewing consequences. **Assessment:** this is real spend authority without the shared wallet's threshold. One screen says “It is not a wallet,” even though it holds spendable money. The three funding outputs are described as cryptographic “notes.”

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F55 | `web/app-account-view.js`, `accountCard` | P1 / COPY | “It is not a wallet” weakens the real custody consequence. | “Pays the fee of your on-chain messages. This separate account has no shared-wallet approval rule; whoever controls this browser can spend it.” |
| F56 | Same file, `fundBlock` | P2 / COPY | “Asks for 3 equal notes” is unexplained jargon and not exactly equal for every integer split. | “Splits the amount into 3 payment outputs so separate funds are available for message fees.” The one-zatoshi rounding behavior remains unchanged. |

### 45. Add an on-chain contact and send/read a paid memo — S

**Goal:** send a message, know its fee, and recognize incoming replies. **Journey:** add contact's shielded address → share contact-specific reply address → fee/parts review → send → uncertain/on-chain state → incoming grouped memo. **Assessment:** these are permanent on-chain texts; longer messages use multiple memo parts. Contact routing does not verify a person. Sent-message history is not in the account backup. No funded message was sent here.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F57 | `web/personal.js`, `SENT_WORDS`; `web/app-account-view.js` | P2 / COPY | “May not be sent” is an awkward label for an unknown outcome, although its body warns it may still arrive. | Candidate future label: “Send outcome unknown.” Keep underlying state `unsure` and its note reservation. Do not automatically resend or treat it as failed. |
| F70 | `web/app-account.js`, `deliver` success banner | P1 / COPY | “It arrives with the next block” promises message delivery before blockchain inclusion. | “Message submitted to the network. Wait for its on-chain status before sending again.” Preserve existing memo reservations and sent-state tracking. |

### 46. Make, read, and pay a payment request — S

**Goal:** ask for funds or review a request before deciding to pay. **Journey:** Request a payment → choose target/optional amount/memo → relay text/ZIP 321 card → inspect sender trust and destinations → fill Send → ordinary review/approvals. **Assessment:** a request is not a payment or authorization. A request's editable amount and memo need fresh review; sender identity and destination ownership are separate facts.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F58 | `web/app-payreq.js`, request card/`requestClaims`; `web/requests.js` | P2 / UI | Sender-signature trust can be mistaken for verification of the requested recipient. | Future contextual reminder near the action: “A verified sender signature does not verify the recipient address. Review every destination before paying.” No automatic payment or new trust badge. |

### 47. Preferences, diagnostics, network privacy, and incoming-data controls — R/S

**Goal:** configure this browser and troubleshoot without sharing secrets. **Journey:** Settings → appearance/notifications → Privacy & Network → optional memos → diagnostics copy. **Assessment:** diagnostics use an allowlisted facts list, not arbitrary log lines. Notifications apply while open. Integrated Tor is explicitly unavailable; the UI does not change transport. A VPN/Tor statement should not imply protection from all metadata or a compromised host.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F59 | `web/app-dom.js`, `act`; `web/app-payments.js`, server errors | P1 / TECHNICAL | Raw engine/RPC/host error text can reach the primary banner. It may be technical, unhelpful, or contain more diagnostic context than intended. | Classify known failures and expose safe primary recovery copy with bounded diagnostics separately. Example only when confirmed: “The network connection failed. Check your connection, then retry this step.” Do not globally replace unknown errors with a guessed cause. |
| F60 | `web/app-network-privacy.js`, Standard connection | P2 / COPY | “To hide it, use Tor Browser or a VPN” can sound absolute. | Candidate: “Tor Browser or a VPN can limit direct IP exposure; services may still link activity through other metadata.” Leave for networking/privacy review rather than changing a security claim speculatively. |

### 48. Help, the illustrated guide, and all optional previews — B/R/S

**Goal:** understand the product without confusing examples with capabilities. **Journey:** How Zigs works chapters/journeys; FAQ; replay guide; name checkout/funding/Tor/post-quantum previews where reachable. **Assessment:** diagrams generally state they are illustrative. Name registration and simulated funding are not live, no setup fee is charged, and no post-quantum swap is implemented. The guide still treats all Swap UI as unavailable. Adding missing FAQ entries would add rendered components, so this task recommends them without adding rows.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F61 | `web/how-zigs-works-content.js`, Solana → External authority and feature boundaries | P1 / COPY | “Swap ... illustrations ... not live cross-chain execution” incorrectly covers the actual gated live route. | Distinguish enabled mainnet SOL/ZEC routes from the separately labeled post-quantum demo. Preserve external-provider and quantum-resistance qualifications. |
| F62 | `web/how-zigs-works-journey-content.js`, private-swaps description | P2 / COPY | “The current implementation does not execute swaps” confuses the illustration with the application. | “This illustration does not execute swaps. Check Swap for the routes available on your server.” |
| F63 | `web/funding-preview.js`, `web/zns-setup-preview.js`, `web/network-privacy-popup.js`, `web/app-postquantum-swap-preview.js` | P2 / PRODUCT | Demos model paid setup, names, Tor routing, or post-quantum behavior that is not available. Their labels are necessary, not evidence of release readiness. | Keep current Demo/unavailable/no-payment labels and prevent previews from becoming live capability indicators. Recheck if linked into onboarding. No demo behavior or content is changed in this pass. |

### 49. Native creation and joining — S only

**Goal:** create/join from iPhone or Mac with correct expectations. **Journey:** SwiftUI names → signer/rule controls → testnet availability → private invitation → safety check → ceremony. **Assessment:** `NativeCreationViews.swift` explains separate devices and replacement-wallet changes, but uses seat, signer, name, and nickname where web uses device/label. The native release is not feature-equivalent to the web. No Xcode build, simulator, or physical device was run.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F64 | `ios/Zigs/NativeCreationViews.swift` | P2 / COPY | “You take seat 1” assumes internal vocabulary. | Candidate: “This device joins as device 1.” Audit all native strings and accessible names together before applying; no native source edits here. |

### 50. Native receiving, sending, and approvals — S only

**Goal:** review and complete supported Zcash transactions. **Journey:** Group/Prepared workspace → Receive or Send → inspect decoded recipients → Approve as seat → prove → network submission → Chain view. **Assessment:** shared engine checks are used; native mainnet actions are explicitly refused. Web payment status and hold semantics should not be assumed to have identical native presentation. A shortened transaction ID remains selectable, but long receipts need device QA.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F65 | `ios/Zigs/SessionView.swift`, `NextAction`, `Timeline` | P1 / TECHNICAL | Native mainnet, cancellation, expiry, and unknown outcomes require their own end-to-end evidence; web tests do not establish native parity. | Validate status/action parity on testnet, including interrupted signing and broadcast. Future visible terminology: “Approve as device 1.” Do not enable mainnet or alter payment behavior. |

### 51. Native backup, restore, and local protection — S only

**Goal:** preserve and recover a native signing share. **Journey:** key-share backup → passphrase/file → restore fit checks → device-protection policy. **Assessment:** shared-format rules and no imported nonces are documented in `Backup.swift`; obsolete formats are rejected. Platform biometric/keychain behavior differs from browser passkeys. Cross-platform file interoperability was not exercised with real platform downloads.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F66 | `ios/Zigs/Backup.swift`, `Vault.swift` | P1 / TECHNICAL | Recovery depends on files, passphrases, platform storage, and compatible wallet data. Source parity is insufficient evidence of successful recovery. | Test web→iPhone→Mac restores with disposable files, Unicode passphrases, incompatible versions, and damaged storage. Keep platform protection and file recovery as separate concepts. |

### 52. Native messaging, contacts, and settings — S only

**Goal:** coordinate safely and understand missing capabilities. **Journey:** wallet/direct conversations and payment memos → signature/identity labels → settings/contacts. **Assessment:** native source exposes relay messages, recipient management, and basic memos; README explicitly distinguishes web-only account and request capabilities. Users moving between platforms can mistake text-only requests for equivalent actionable cards.

| ID | Location | Severity / scope | Problem and impact | Recommendation / exact copy |
|---|---|---|---|---|
| F67 | `ios/Zigs/ChatViews.swift`, `NativeMessagingViews.swift`, `RecipientViews.swift`; `README.md` | P2 / PRODUCT | Payment requests, Solana, and the personal messaging account lack web feature parity; generic wallet wording does not convey the boundary. | Establish a versioned feature matrix and platform-specific help. Suggested guidance when relevant: “Open this request in the web app to review it as a payment request.” Gate it on actual support; no routing change here. |

## Prioritized improvement backlog

Effort estimates are relative (S: copy/local review; M: several states or services; L: protocol/platform work), not delivery promises.

| Rank | Findings | Priority | Scope / effort | Concrete acceptance criterion |
|---|---|---|---|---|
| 1 | F23, F25, F28, F68–F70 | P1 | COPY / S | Existing review and Help distinguish approval, signing, proof, submission, inclusion, and per-rail execution; exact expiry remains unchanged |
| 2 | F39, F61, F62, F14 | P1/P2 | COPY / S | No unconditional public-mainnet or “all swaps unavailable” statement; Testnet has no fictitious USD display |
| 3 | F48, F51 | P1 | COPY / S | Provider payout/refund statements are attributed and contain no universal refund promise |
| 4 | F01, F09, F17 | P1 | COPY / S | Entry privacy scope and real-mainnet funds are explicit; no sender/network anonymity guarantee |
| 5 | F29, F30, F31 | P1/P2 | TECHNICAL + PRODUCT + UI / M | Every cancel/reject/retry state has an exact authority, duplicate-payment implication, and available next step |
| 6 | F40, F41 | P1 | PRODUCT + UI / L | Private-Solana release decision accepts/changes upgrade authority; new users choose correct fee/deposit/receive addresses |
| 7 | F50, F52 | P1 | PRODUCT / M | Dual deadlines and failed-swap evidence survive the user's safe exit and support process |
| 8 | F47, F49 | P1 | TECHNICAL / M | Fee inclusion, quote authenticity, route trust, and price-impact availability are established before claims are added |
| 9 | F59, F12 | P1 | TECHNICAL / M | Known failures map to actionable safe primary messages; raw RPC strings are not treated as known causes |
| 10 | F33 | P1 | PRODUCT / M | A user can access/recover older Solana records without mistaking the latest-12 list for complete history |
| 11 | F07, F38, F66 | P1 | TECHNICAL / M | Interrupted restore, lost passkey, and cross-platform recovery are exercised using disposable keys/files |
| 12 | F55, F56, F36, F32 | P1/P2 | COPY / S | Separate single-key custody, funding outputs, per-file passphrases, and retained memos are understandable |
| 13 | F03, F06, F15, F20, F34, F46, F53 | P2 | COPY / S | Join/unlock/balance/draft/slippage/empty-inbox language names the actual scope and next step |
| 14 | F02, F08, F13, F26, F27, F42 | P1/P2 | UI + PRODUCT / M | Decision-relevant risk and waiting-device guidance appear at the existing decision point, based on real state |
| 15 | F18, F19, F35, F43, F44, F45 | P1/P2 | UI + PRODUCT + COPY / M | Public refunds, sweeping, migration, rent, nonce setup, and absent token accounts each have specific guidance |
| 16 | F64–F67, F54, F58, F60, F63 | P1/P2 | TECHNICAL + PRODUCT + UI + COPY / M–L | Native parity, chat retention, recipient trust, network limits, and demo boundaries have task-specific validation |

## Copy improvement log

Phase 2 implemented **33 changed display-string values in 14 application files**, addressing the COPY findings listed below. All 9 existing FAQ questions remain in place; no new rendered FAQ entry was added. Exact static segments are shown for interpolated messages; their variables, prefixes, status keys, IDs, and formatting logic are unchanged. Concatenated literals are recorded as the exact resulting text.

The backlog above records original audit priorities. COPY work in ranks 1–4, 12, and 13 is implemented; the remaining ranks and explicitly deferred COPY candidates remain open. Test-only updates align existing expectations with the revised copy; they do not relax transaction, restore, or capability checks.

### C01 — F55 · accountCard

| Field | Details |
|---|---|
| Location | `web/app-account-view.js` · `accountCard` |
| Original | Pays the fee of your on-chain messages. It is not a wallet: anyone who controls this browser can spend it, with no approval. |
| Updated | Pays the fee of your on-chain messages. This separate account has no shared-wallet approval rule; whoever controls this browser can spend it. |
| Reason | Clarify separate single-key custody and the absence of shared-wallet approval protection. |

### C02 — F56 · fundBlock

| Field | Details |
|---|---|
| Location | `web/app-account-view.js` · `fundBlock` |
| Original | Asks for 3 equal notes, so the account can send after each block. |
| Updated | Splits the amount into 3 payment outputs so separate funds are available for message fees. |
| Reason | Explain funding outputs without requiring knowledge of notes or promising exact equal division. |

### C03 — F70 · deliver success banner

| Field | Details |
|---|---|
| Location | `web/app-account.js` · `deliver success banner` |
| Original | Sent to the network. It arrives with the next block. |
| Updated | Message submitted to the network. Wait for its on-chain status before sending again. |
| Reason | Attribute submission accurately and avoid promising message arrival in the next block. |

### C04 — F09 · networkPick

| Field | Details |
|---|---|
| Location | `web/app-dom.js` · `networkPick` |
| Original | Send and receive ZEC on the Zcash network. |
| Updated | Real ZEC. Transactions use real funds and network fees. |
| Reason | State that mainnet uses real funds and fees at the network decision. |

### C05 — F53 · emptyConversation

| Field | Details |
|---|---|
| Location | `web/app-messaging-workspace.js` · `emptyConversation` |
| Original | A little closer. A little more private. |
| Updated | Choose a conversation. |
| Reason | Give the empty state a useful task-oriented heading. |

### C06 — F68 · broadcastTx success banner

| Field | Details |
|---|---|
| Location | `web/app-payments.js` · `broadcastTx success banner` |
| Original | Sent to the network. It confirms with the next block. |
| Updated | Submitted to the network. Wait for block confirmation in Activity. |
| Reason | Distinguish successful submission from uncertain future block confirmation. |

### C07 — F68 · resendTx success banner

| Field | Details |
|---|---|
| Location | `web/app-payments.js` · `resendTx success banner` |
| Original | Sent again. It confirms with the next block. |
| Updated | The same transaction was submitted again. Wait for block confirmation in Activity. |
| Reason | State that the same transaction was resubmitted without promising inclusion timing. |

### C08 — F34 · recipientsView

| Field | Details |
|---|---|
| Location | `web/app-recipients.js` · `recipientsView` |
| Original | Save payment recipients for all wallets on this device. Chat contacts stay in Chats. |
| Updated | Save payment recipients for all wallets in this browser. Chat contacts stay in Messages. |
| Reason | Match Messages navigation and precise browser-local storage scope. |

### C09 — F17 · receiveLead

| Field | Details |
|---|---|
| Location | `web/app-send.js` · `receiveLead` |
| Original | . Senders and the network cannot see the balance or who controls it. The devices of this wallet and anyone who has the invite link can see its balance and history. A device that Change devices leaves out later can still see them. |
| Updated | . Shielded payments hide recipient addresses and amounts on chain. The devices of this wallet and anyone who has the invite link can see its balance and history. A device that Change devices leaves out later can still see them. |
| Reason | Scope the privacy claim to shielded on-chain information; preserve invite-holder viewing limits. |

### C10 — F20 · draftLine

| Field | Details |
|---|---|
| Location | `web/app-send.js` · `draftLine` |
| Original | This draft could not be saved in this browser. The form still works. |
| Updated | This draft could not be saved in this browser. Keep this page open to retain what you typed. |
| Reason | State how to retain unsaved text when local persistence fails. |

### C11 — F23 · EXPIRY_NOTE

| Field | Details |
|---|---|
| Location | `web/app-send.js` · `EXPIRY_NOTE` |
| Original | The approvals must finish within about 24 hours. After that the payment expires, and a device proposes it again. |
| Updated | The transaction usually expires within about 24 hours. Approve, sign, prove and send it in time for block inclusion. Check its expiry in the payment details. |
| Reason | Explain that the entire transaction lifecycle must beat expiry, not just approvals. |

### C12 — F24 · priorityBox

| Field | Details |
|---|---|
| Location | `web/app-send.js` · `priorityBox` |
| Original |  times the standard fee, for a faster block when the network is busy. The fee is public. Few wallets pay a priority fee, so it can show that Zigs made this payment, as the expiry height can. |
| Updated |  times the standard fee, to request faster inclusion when the network is busy. The fee is public. Few wallets pay a priority fee, so it can show that Zigs made this payment, as the expiry height can. |
| Reason | Describe a request for faster inclusion without promising network performance; the factor interpolation is unchanged. |

### C13 — F06 · lockView

| Field | Details |
|---|---|
| Location | `web/app-shell.js` · `lockView` |
| Original | The key shares in this browser are encrypted with your passkey. Unlock with Face ID, Touch ID or your security key. |
| Updated | The key shares in this browser are encrypted with your passkey. Your passkey provider may ask for a fingerprint, face, PIN or security key. |
| Reason | Include passkey providers that authenticate with a PIN or non-Apple biometric. |

### C14 — F01 · welcome

| Field | Details |
|---|---|
| Location | `web/app-shell.js` · `welcome` |
| Original | Hold your assets privately. Protect them with the people and devices you trust. |
| Updated | Share control of Zcash and supported Solana assets across the people and devices you trust. |
| Reason | Avoid a blanket privacy claim across assets with different public visibility. |

### C15 — F03 · joinWallet

| Field | Details |
|---|---|
| Location | `web/app-shell.js` · `joinWallet` |
| Original | Did someone send you an invite link? Paste it here to open the wallet. |
| Updated | Paste a private invite link to open the wallet. To approve payments, join an open device slot or restore your existing device’s backup. |
| Reason | Distinguish opening a wallet from holding a share that can approve. |

### C16 — F51 · SWAP_STATES.SUCCESS

| Field | Details |
|---|---|
| Location | `web/app-swap-preview.js` · `SWAP_STATES.SUCCESS` |
| Original | Done. NEAR Intents sent the ZEC to the wallet. The wallet shows it after its next sync. |
| Updated | NEAR Intents reports the ZEC payout was sent. Sync the wallet to check its receipt. |
| Reason | Attribute payout to the provider and ask the user to check destination receipt. |

### C17 — F51 · SWAP_STATES.REFUNDED

| Field | Details |
|---|---|
| Location | `web/app-swap-preview.js` · `SWAP_STATES.REFUNDED` |
| Original | Refunded. NEAR Intents sent the SOL back to the refund address. |
| Updated | NEAR Intents reports a SOL refund. Check the refund address on Solana. |
| Reason | Attribute the refund report and name the chain to check. |

### C18 — F51 · ZEC_STATES.SUCCESS

| Field | Details |
|---|---|
| Location | `web/app-swap-preview.js` · `ZEC_STATES.SUCCESS` |
| Original | Done. NEAR Intents sent the SOL to the Solana address of this wallet. |
| Updated | NEAR Intents reports the SOL payout was sent. Check this wallet’s Solana balance and transaction. |
| Reason | Distinguish the provider payout report from locally verified destination state. |

### C19 — F51 · ZEC_STATES.REFUNDED

| Field | Details |
|---|---|
| Location | `web/app-swap-preview.js` · `ZEC_STATES.REFUNDED` |
| Original | Refunded. NEAR Intents sent the ZEC back to the transparent address of this wallet. Move it to the shielded address from Receive. |
| Updated | NEAR Intents reports a ZEC refund. Check the transparent balance in Receive before moving it to the shielded address. |
| Reason | Check public refund funds before attempting their separate shielding operation. |

### C20 — F46 · slippage helper

| Field | Details |
|---|---|
| Location | `web/app-swap-preview.js` · `slippage helper` |
| Original | Sent with the quote request |
| Updated | Sets the minimum quoted amount you receive. |
| Reason | Explain the user-facing effect of slippage on the quoted minimum. |

### C21 — F48 · drawLiveReview refundNote

| Field | Details |
|---|---|
| Location | `web/app-swap-preview.js` · `drawLiveReview refundNote` |
| Original | NEAR Intents sends the SOL back to this address if the swap fails. |
| Updated | NEAR Intents uses this address for any SOL refund. |
| Reason | Remove the unsupported promise of an automatic refund for every failure. |

### C22 — F69 · sendSweep submission banner

| Field | Details |
|---|---|
| Location | `web/app-sweep.js` · `sendSweep submission banner` |
| Original | Sent. The move confirms with the next block. |
| Updated | The move was submitted to the network. Wait for block confirmation. |
| Reason | Remove an unsupported next-block confirmation promise. |

### C23 — F15 · balanceOverview heading

| Field | Details |
|---|---|
| Location | `web/app-wallet.js` · `balanceOverview heading` |
| Original | Wallet balance |
| Updated | ZEC balance |
| Reason | Make the asset scope clear without changing any values or calculations. |

### C24 — F15 · testnetTotal stat label

| Field | Details |
|---|---|
| Location | `web/app-wallet.js` · `testnetTotal stat label` |
| Original | Wallet balance in ZEC |
| Updated | ZEC balance on Testnet |
| Reason | Make clear this is only ZEC, not a total including Solana. |

### C25 — F25 · HELP: What does a payment need?

| Field | Details |
|---|---|
| Location | `web/help-model.js` · `HELP: What does a payment need?` |
| Original | A payment needs approval from as many devices as the approval rule names, for example 2 of 3. Each device approves with its own key share. After enough approvals, the devices sign together, and then the payment can be sent. |
| Updated | A payment needs the number of device approvals set by its rule, for example 2 of 3. Each device approves with its own key share. After enough approvals, the selected devices sign together while this wallet is open on them. Zcash then needs Build proof and Send to network. Solana follows its own sending or execution steps. |
| Reason | Distinguish threshold approval, selected-device signing, Zcash proof/submission, and Solana-specific steps. |

### C26 — F36 · HELP: Where is my backup file?

| Field | Details |
|---|---|
| Location | `web/help-model.js` · `HELP: Where is my backup file?` |
| Original | A backup file holds the key share of one device. Your browser saves it as a download, usually in its download folder. Zigs does not know where. The file is locked with a passphrase that you choose. Zigs cannot recover that passphrase. A device with a Solana part has two files and two passphrases. Keep each file and its passphrase apart, and make sure that you can find both. The Security section shows which files this browser saved. |
| Updated | A backup file holds the key share of one device. Your browser saves it as a download, usually in its download folder. Zigs does not know where. The file is locked with a passphrase that you choose. Zigs cannot recover that passphrase. A device with a Solana part has two files, each protected by its chosen passphrase. Keep each file and its passphrase apart, and make sure that you can find both. The Security section shows saved-file progress, not a guarantee that the files remain accessible. |
| Reason | Describe per-file passphrase encryption and qualify saved-file progress. |

### C27 — F39 · HELP: What do the servers see?

| Field | Details |
|---|---|
| Location | `web/help-model.js` · `HELP: What do the servers see?` |
| Original | The group server keeps the encrypted data of the wallet. It cannot read the data. It sees which IP addresses open which wallet, and when data is sent. The light-wallet server sends the blocks to this page. It sees the transactions that you send, and it never sees a secret key. It sees your IP address, except that on testnet the Zigs light-wallet server sees only the Zigs Worker. That Worker is also the group server, so one operator sees the traffic of both. The Solana part also asks Helius. Helius sees your IP address and the public keys of this wallet. The wallet makes proofs on your device, so nothing goes to the Helius prover. The Zigs server operator can link this wallet to its Solana addresses by timing. On mainnet, the Solana part is a plain account. Helius sees your IP address and the address of this wallet, and the explorer sees the address that you open. When you send, Helius also sees the signed transaction. |
| Updated | The group server keeps encrypted wallet data. It sees which IP addresses open which wallet, and when data is sent. It cannot read the sealed data without the wallet secret. The light-wallet server supplies blocks and sees the transactions that you send, but never sees a secret key. On direct connections, it sees your IP address. Testnet normally uses the Zigs Worker proxy, so the upstream node sees the Worker IP. A direct fallback can expose your IP address. The Worker also hosts the group server, so one operator sees both traffic streams. Solana uses Helius, which sees your IP address and public wallet keys. Private Solana payments require proofs on your device; no spend witness goes to the Helius prover. The Zigs server operator can link this wallet to its Solana addresses by timing. Public mainnet Solana accounts expose balances and payments. Private Solana hides payment amounts, but payee owner keys, deposits and withdrawals remain public. The private program has upgrade authority outside wallet approvals. Explorers see the addresses or transaction IDs you open. When you send, Helius also sees the signed transaction. |
| Reason | Correct public/private Solana scope and disclose direct testnet fallback consistently with Settings and app-chain.js. |

### C28 — F32 · HELP: How do I read the memos of payments to this wallet?

| Field | Details |
|---|---|
| Location | `web/help-model.js` · `HELP: How do I read the memos of payments to this wallet?` |
| Original | Open Incoming payment memos under Privacy & Network in Settings, review the privacy disclosure and enable it. A memo is only in the full transaction, so this browser then asks the light-wallet server for each transaction that pays this wallet. That server learns which transactions pay this wallet. The setting is off until you turn it on. |
| Updated | Open Incoming payment memos under Privacy & Network in Settings, review the privacy disclosure and enable it. A memo is only in the full transaction, so this browser then asks the light-wallet server for each transaction that pays this wallet. That server learns which transactions pay this wallet. The setting is off until you turn it on. Turning it off stops new memo requests; memos already downloaded stay in this browser. |
| Reason | Explain that switching retrieval off does not delete already-downloaded memos. |

### C29 — F28 · HELP: Why is my payment not done yet?

| Field | Details |
|---|---|
| Location | `web/help-model.js` · `HELP: Why is my payment not done yet?` |
| Original | A payment goes through these steps: approval, signing, proof, send, and then block confirmations. Open the payment in Approvals or Activity to see its step. A payment can need a few blocks to confirm. Do not pay again while it shows Confirming. |
| Updated | Zcash payments need approvals, signing, a proof, submission to the network, and block confirmations. Solana payments have separate sending or execution steps. Open the payment in Approvals or Activity to see what remains. A submitted transaction is not yet confirmed. Check Activity before proposing another payment when the outcome is unknown. |
| Reason | Give per-rail steps and caution about proposing a second payment when outcome is unknown. |

### C30 — F39 · HELP: Which networks does Zigs use?

| Field | Details |
|---|---|
| Location | `web/help-model.js` · `HELP: Which networks does Zigs use?` |
| Original | Zigs uses Zcash testnet or mainnet, and Solana Devnet. Testnet and Devnet use test coins. Mainnet uses real ZEC. Where a server offers it, a mainnet wallet also has a Solana part. It is a plain account with real SOL and USDC, with no privacy and no hosted prover. A send needs the same approvals as a Zcash payment. Every device of the group sees its recipient and amount. |
| Updated | Zigs uses Zcash testnet or mainnet, and Solana Devnet. Testnet and Devnet use test coins. Mainnet uses real ZEC. Where the server offers it, mainnet wallets can use public Solana accounts with real SOL and USDC, or private Solana wallets with real SOL. Public Solana balances and payments are visible on chain. Private Solana hides payment amounts, but payee owner keys and public deposits and withdrawals remain visible. The private program's upgrade authority is outside wallet approvals. Both modes need the wallet's approval rule for payments. Every wallet device can see the recipients and amounts. |
| Reason | Describe server-gated public SOL/USDC and private SOL with distinct visibility and upgrade authority. |

### C31 — F14 · Receiving: Confirmed, pending and available

| Field | Details |
|---|---|
| Location | `web/how-zigs-works-content.js` · `Receiving: Confirmed, pending and available` |
| Original | Zcash holdings here are shielded holdings. A USD display is a valuation, not another balance. On a testnet wallet, $0.00 with a Demo label stands for an unknown USD value. It must not be read as a verified zero or used to infer a price. On a mainnet wallet, the USD total is the ZEC total times the price of a NEAR Intents quote for 1 ZEC, with 1 USDC counted as 1 USD. The quote includes fees and spread. It is not a market rate. |
| Updated | The primary Zcash balance shows shielded funds; public swap refunds have a separate transparent balance. A USD display is a valuation, not another balance. Testnet shows native test-coin balances, not a USD valuation. On a mainnet wallet, the USD total is the ZEC total times the price of a NEAR Intents quote for 1 ZEC, with 1 USDC counted as 1 USD. The quote includes fees and spread. It is not a market rate. |
| Reason | Remove the obsolete Testnet USD demo claim and distinguish separately read transparent refunds. |

### C32 — F61 · Solana: External authority and feature boundaries

| Field | Details |
|---|---|
| Location | `web/how-zigs-works-content.js` · `Solana: External authority and feature boundaries` |
| Original | Changing Zcash devices and moving Zcash does not automatically migrate a Solana position. Zcash and SOL are not swapped merely by sharing a wallet interface. Swap and post-quantum swap illustrations in this UI are design previews, not live cross-chain execution or a quantum-resistant custody guarantee. |
| Updated | Changing Zcash devices and moving Zcash does not automatically migrate a Solana position. Where the server enables them, Swap supports live mainnet SOL/ZEC routes through NEAR Intents. Other routes may show quotes only. The separately labeled post-quantum swap is a demo, not live execution or a quantum-resistant custody guarantee. |
| Reason | Distinguish enabled live SOL/ZEC routes from the post-quantum illustration. |

### C33 — F62 · Private Swaps journey description

| Field | Details |
|---|---|
| Location | `web/how-zigs-works-journey-content.js` · `Private Swaps journey description` |
| Original | A preview of a possible cross-chain journey. The current implementation does not execute swaps. |
| Updated | This illustration does not execute swaps. Check Swap for the routes available on your server. |
| Reason | Scope the no-execution claim to this illustration, not the whole application. |

## Unimplemented recommendations

All PRODUCT, UI, and TECHNICAL findings remain unimplemented. This includes components/placement, approval notifications, per-device rejection, hold/cancellation semantics, chain migration, older-history access, program authority, fee/price-impact data, quote authenticity, error taxonomy, and support/export behavior. COPY candidates explicitly marked for a future rail/platform/privacy review are also unimplemented. No new FAQ entries were added: each row renders an additional disclosure component.

### Proposed missing FAQ content (future content/UI work)

| Question | Proposed answer, subject to placement/state review |
|---|---|
| Can I connect an existing external wallet? | “This shared wallet uses Zigs device shares. Join with its private invitation or restore an existing device's recovery file. An external wallet can fund a supported receiving address; it does not become a Zigs approval device.” |
| Does a passkey restore my wallet? | “A passkey unlocks data already saved in this browser. A recovery file and its separate passphrase restore that file's share. Recovery still needs enough distinct usable shares for the wallet's rule.” |
| Do other devices get notified about an approval? | “Open Zigs and this wallet on the other devices to review requests. Message notifications work only while Zigs is open and browser permission is enabled.” |
| What does cancelling a proposal stop? | “Cancellation asks participating devices to stop that proposal. It cannot revoke enough signed data already held elsewhere. Check the payment's status and any Send hold before proposing a replacement.” |
| Why is my swap payment public? | “A ZEC swap deposit uses a transparent address. Public SOL transfers also expose their amount and addresses. A shielded destination does not hide the route from NEAR Intents.” |
| What if a swap reports failure or the outcome is unknown? | “Keep the quote ID and transaction IDs. Check source payment, destination receipt, and refund separately. Do not pay again just because tracking is unavailable.” |
| What does a checked recovery file prove? | “It matched the current share when this browser opened it. It does not prove the file or passphrase remains accessible. Other devices' reports are not checks performed here.” |
| Will changing devices move every asset? | “This operation creates a replacement wallet and moves Zcash through approved payments. Solana positions need separate attention. Stop sharing the old Zcash receiving address.” |
| Which information is missing from recovery files? | “Wallet files restore their own share and included keys, not the entire browser. Direct chats, saved recipients, private descriptions, and sent personal-message history have separate storage limits.” |

### Terminology contract

| Term | Use it for | Do not imply |
|---|---|---|
| Device | One numbered signing identity/share in Zigs | Verified person or independently located hardware |
| Signer / seat | Technical identity in protocol/source; explain as device in novice-facing copy | Another approval merely from another window or restored copy |
| Propose / request approvals | Share reviewed transaction terms | Signature, funds moved, or a notification delivery guarantee |
| Approve | One participant authorizes the checked transaction and contributes commitment material | Threshold reached or on-chain execution |
| Sign | Selected participants contribute signature shares | Proof, submission, or inclusion |
| Prove | Construct required cryptographic proof | Transaction sent |
| Submit / broadcast | Send signed transaction bytes to a service/network | Included, irreversible finality, or successful payout |
| Included / confirmed | State established by relevant chain data, qualified by confirmations | Provider report alone or permanent immunity from a reorganization |
| Execute | Solana program operation, with its actual outcome | Merely reaching the off-chain approval threshold |
| Saved / checked / restored | Download progress / file matched / authority imported and checked respectively | Guaranteed future accessibility or a new independent approval |
| Public / shielded / private | Specific visibility of an asset or operation | Universal anonymity, audited security, or no external authority |
| Messaging account | Separate single-key fee-paying Zcash account | The shared wallet's approval protection |

## Unverified flows and evidence limits

| Flow / evidence | Why not claimed as end-to-end verified |
|---|---|
| Physical multi-device formation and identity comparison | No actual second/third devices or independently verified people were involved |
| Passkey creation/unlock/loss | No real platform authenticator was enrolled or deleted; browser protection was inspected and the explicit Skip path exercised |
| Funded Zcash send, batch, proof and mainnet receipt | No funds, external nodes, or irreversible transactions were used |
| Full transparent refund sweep | Source inspected; no funded transparent inputs or threshold sweep submitted |
| Actual Solana Devnet/mainnet keys, deposits, proofs, fees, nonces, execution, withdrawal, rent | Source and synthetic tests only; no Helius service, pool, or deployed authority was exercised |
| NEAR quote liquidity, actual swap payout/refund, late/partial deposit recovery | No live upstream calls or funds; availability flags are repository configuration, not deployment checks |
| Funded on-chain messages and external sender replies | Source/synthetic tests only; no account funds or real memos sent |
| Real recovery file downloads/restores and inter-device availability | Tests use synthetic data; actual storage, passphrase custody and platform recovery were not proven |
| Native clients and accessibility platforms | No Xcode build/simulator, VoiceOver, NVDA, or actual iOS Safari session was run |
| All rare failures and optional previews | Inventoried in source. Their existence was not treated as a browser execution of every network/error branch |

Browser walkthrough captured 25 views: landing; invalid invite; protection; skip confirmation; rule; names/network; review; education; overview; approvals; activity; recipients; quote-only swap; messages; security; settings; receiving; and overview/swap/security/settings at 390px and 320px. None had page-level horizontal overflow or an uncaught JavaScript error in that walkthrough. Fixture wallet data, addresses, balances, and engine-ready marks are synthetic; no successful formation or spending claim follows from them. Existing OpenGlass checks separately exercised real startup, settings, dialog dismissal, field persistence, light/dark modes, and narrow screens.

## Remaining risks

- Software is not independently audited. This review neither removes nor certifies the documented cryptographic, service, program-upgrade, browser-compromise, or quantum-recovery risks.
- The group relay can disrupt availability; invite/view access, local signing authority, and threshold authority remain distinct. Copy cannot revoke leaked secrets or old viewing keys.
- Browser loss, stale copies of the same share, incomplete local storage, or insufficient independent usable shares can make recovery fail even after a “saved” indication.
- Cross-chain routes trust external services and have different cutoffs, public visibility, and untested refund/payout claims. Provider success is not independently verified destination receipt.
- Native parity, actual deployed capability flags, real device performance, and rare failure states remain unverified.
- UX state correctness depends on the underlying predicates. No such predicate, status key, API, transaction note marker, capability flag, or timing value was changed to improve wording.

## Verification record

All implementation work is complete within the content-only scope. [Machine-readable verification](ux-audit/verification.json) records commands, scope, and source hashes; [the exact copy-change data](ux-audit/copy-changes.json) mirrors the log above.

| Check | Result | What it establishes |
|---|---|---|
| Baseline targeted tests | 21 passed | Existing selected wallet, setup, recovery, swap, and rendering checks passed before copy edits |
| Targeted checks across the copy pass | 24 passed, 0 failed | Existing Help, payment, approval, setup, recovery, recipients, requests, swap/provider, security, mainnet, Solana, account and integration checks remain green |
| Final banner changes | `app.mjs` and `personal.mjs` rerun and passed | The payment/account integration and personal-message models remain intact after the last four display changes; other suites passed after the preceding copy pass |
| Production web build | Passed | OpenGlass entry bundle builds using the branch's existing dependencies |
| JavaScript syntax | 19 changed files passed | 14 application modules plus 5 existing test files parse |
| Normalized source comparison | 14 application files / 33 display-string values | Code structure is unchanged after folding static string concatenation and replacing string values with placeholders; each changed value was manually reviewed as display copy |
| Diff review | Passed | No CSS, JSX/component structure, HTML, IDs, routes, imports, status keys, transaction markers, numeric constants, or predicates changed; 5 test files only align existing copy expectations |
| Repository OpenGlass browser suite | Passed before and after the main copy pass | Real startup plus synthetic overview, themes, narrow widths, dialogs, field persistence and keyboard dismissal |
| Updated browser walkthrough | 28 views, no uncaught errors or page overflow | Original 25 views plus expanded Help at 320/1440px and a CSS zoom 200% stress check |
| Changed-copy context checks | 18 variants, no uncaught errors or page/dialog overflow | Synthetic matching Send review, existing messaging-account/funding renderers, and provider-reported swap payout, each at 320/390/1440px in both themes |

Targeted commands: `node web/test/<name>.mjs` for `help`, `payment-model`, `approvals`, `overview`, `guided-create`, `guided-setup`, `unified-setup`, `recovery`, `backup-check`, `recipients`, `requests`, `swap-preview`, `near-quote`, `swap-recovery`, `security-dashboard`, `wallet-description`, `messaging-cost-review`, `mainnet-on`, `sol-docs`, `sol-plain-ui`, `sol-plain-review`, `sol-receive`, `app`, and `personal`. Build: `node web/build.mjs`. Browser suite: `node web/openglass/browser-check.mjs`. Whitespace: `git diff --check`.

Checks ran with the available Node v25.6.1; several test headers recommend Node 26, so a release CI run on the declared runtime remains appropriate. The initial sandbox blocked browser launch; the approved disposable-browser run succeeded. The connector's shared profile was busy and was not reused. No visual detector/overlay or visual redesign was run because the requested task excludes visual implementation changes.

Raw local screenshots, text, and scratch verification scripts are under `/private/tmp/zigs-near-ux-evidence/` and `/private/tmp/zigs-near-ux-*.mjs`. They are synthetic local QA artifacts, not production usage evidence. The isolated checkout remains at `/private/tmp/zigs-near-ux`. Changes are uncommitted; no branch was pushed or merged.
