# Zigs experience elevation plan

Execution and evidence: [stageshow-execution.md](stageshow-execution.md).

Use Stageshow to rehearse the important Zigs journeys before implementing their refinements in
the live web app. The objective is a product that feels composed, responsive, and recognisably
Zigs throughout: entry, setup, everyday payments, coordination, and recovery.

This is a plan, not a new implementation or validation report. The existing light/dark design,
zebra identity, restrained glass, and subtle elevation remain the foundation. Scope is the
desktop and mobile web app. Work belongs on `deslopify`, from `Near`; `main` requires the
user's approval. Current application and engine edits are preserved.

Method: [Stageshow](https://github.com/benjitaylor/skills/tree/main/stageshow), particularly its
craft, looks, framing, motion, and rehearsal references.

## Experience direction

**Product:** Shared wallets whose devices cooperate to approve payments.

**Character:** Discreet, precise, a little wild.

**Material:** Chalk in light mode; charcoal in dark mode; thin rims, soft elevation, and lightly
frosted navigation, headers, and floating menus. Financial content has a stable, opaque ground.

**Signature:** The zebra fingerprint, original zebra artwork, local Manrope/Geist Mono, existing
asset marks, and the wallet's own visual identity. Named devices get meaningful identity cues;
gray discs remain appropriate for unavailable identity, not a substitute for real content.

**Attention:** Every screen gives one task or financial fact the strongest emphasis. Supporting
details are easy to find. Glass and shadows establish depth; they do not become the subject.

**Motion:** A gesture has immediate feedback, its consequence follows, and the result settles.
Persistent financial values do not bob, pulse, or repeatedly count upward.

## How Stageshow fits

Create an isolated prototype lab under `web/dev/stageshow/`, using a local copy of the kit and
the closest gold example as each scene's starting point. Keep the required attribution and
notices. React is a development dependency of this lab; production keeps its existing DOM/CSS
architecture. Use sample data and isolated state without live services or wallet handlers.

Map the existing Zigs tokens into one reusable Stageshow look:

| Zigs role | Stageshow role |
| --- | --- |
| Page, panel, sunk, raised | Canvas, surface, well, raised |
| Text, muted, quiet | Strong, normal, faint text |
| Accent and semantic status colors | Accent and status tokens |
| Local Manrope / Geist Mono | UI and mono families |
| Control, panel, menu radii | Matching shape tokens |
| Card, raised, floating shadows | Card, hero, satellite, popover depth |

Named-product scenes use realistic content. Placeholder bars are allowed only in peripheral
illustration context. Live screens keep meaningful records, exact values, and real controls.
Stageshow's simplified chrome, word budgets, and authored cursor are illustration techniques;
they do not replace application semantics or actual interaction behavior.

Build a still first at the final viewing size, then a compact composition for a 358px column
inside a 390px viewport. Film both themes independently. In the live app, retain the existing
48px action/form targets and full responsive layouts rather than importing miniature demo sizes.

## Complete application pass

| Area and current renderers | Intended elevation | States to design and verify |
| --- | --- | --- |
| Shell and wallet context — `app-shell.js`, `app-wallet-switcher.js` | A calm rail; unmistakable current wallet/network; one selection treatment; anchored frosted menus; coherent desktop and phone navigation | Empty/multiple wallets, long names, switching, menu open/closed, keyboard return, locked browser |
| Home and wallet collection — `app-shell.js`, `homepage.css` | Zebra-led entry; crisp Create/Join/Recover hierarchy; returning visitors reach their wallets quickly; clear continuity into the selected wallet | First visit, returning, no wallets, multiple wallets, loading, unsupported browser, inline Join validation |
| Create plan and browser protection — `app-shell.js`, `app-keystore.js` | One purpose per step; a legible approval rule; concise review; protection choices and errors close to the action | Protect, unavailable/cancelled protection, optional Skip confirmation, default/custom rule, names, review/back |
| Join and wallet formation — `app-setup.js`, `app-guided-setup.js` | Explain what this device must do and what it is waiting for; participant arrivals preserve position; full safety comparison gets calm space | Invite, partial participation, waiting, mismatch, interrupted ceremony, address check, optional backups, ready |
| Overview and assets — `app-wallet.js`, `overview-rows.css` | A deliberate balance focal point; aligned asset ledger; readable native amounts; a quieter transaction and shared-control rail | Real zero, loading, stale, unknown fiat, incoming/available, not-added assets, unavailable actions, partial sync |
| Receive and funding — `app-send.js`, `app-funding-preview.js`, `app-taddress.js`, `app-sweep.js` | Asset/network first; clear address and QR grouping; Copy confirms on its own control; deposits and prerequisites have a direct next step | Verified/unavailable address, network restrictions, funding preview, transparent receive/sweep, Solana fee/rent prerequisites, busy/error/result |
| Send composer — `app-send.js`, `app-recipients.js` | Recipient, amount, memo, and cost read in order; summary follows edits without moving focus; multi-recipient rows share one grid | Blank/invalid recipient, saved recipient, name lookup, payment request, Max, precise/long amount, add/remove payee, saved draft |
| Payment review — `app-send.js`, `app-drawer.js` | One coherent review document: wallet/network, outputs, amount, memo, costs, rule, and next action; continuity from composer into proposal | Decoded review, back/edit, blocked review, changed output, long address/memo, proposal waiting |
| Approvals and signing — `app-wallet.js`, `app-drawer.js`, `app-approval-visualization.js` | A work queue organized by the existing required action; request details stay anchored as contributions arrive; configuration and payment progress look distinct | Needs review, waiting, ready, attention, expired/cancelled, locally held approvals, proof, submission, uncertain result |
| Activity and receipts — `activity.css`, `app-wallet.js`, `app-drawer.js` | A readable ledger; exact amounts in one column; outcome and transaction identity remain stable between list and detail | Empty, populated, received, pending, included, failed, partial history, stale data, long identifiers |
| Address book — `app-recipients.js` | Useful search and a compact editor; selected recipient remains recognizable through Send and review; names are clearly local labels | Empty, populated, search/no match, add/edit, validation, long names/addresses, delete/cancel |
| Swap — `app-swap-preview.js`, `app-postquantum-swap-preview.js`, chain adapters | Pair and amount lead; quote details form one receipt; active capability, network context, and the next available action are immediately clear | Fetching/stale/unavailable quote, destination selection, review, served execution states, quote-only mode, explicitly illustrative post-quantum preview |
| Messages and payment requests — `app-messaging-workspace.js`, `app-thread.js`, `app-payreq.js` | Calm conversation list; stable thread context; composer feedback stays at the composer; requests become readable payment objects | Team/direct conversation, unread, typing, sending/failure/retry, invite, request card, prefilled Send, payment discussion, leave |
| Zcash messaging account — `app-account-view.js`, `app-account.js` | Explain its separate funds and purpose; show fee funding and account state clearly; use the same fields and receipts as other flows | No account, setup, funding request, contact add/detail, cost review, unavailable/damaged account, backup/restore |
| Security and device details — `app-security-dashboard.js`, `app-wallet.js` | Plain-language signing rule; meaningful device identity; exact local and reported backup states; an actionable recovery hierarchy | Unfinished/formed wallet, current/other device, missing reports, details, local protection, pending recovery work |
| Backup, restore, and device replacement — `app-backups.js`, `app-shell.js` | A focused file/passphrase flow; persistent success/failure feedback; the scope of each file and replacement remains clear | Create file, passphrase validation, busy/error, saved versus checked, file check, restore/stale restore, Change devices and existing asset consequences |
| Settings, connection, and support — `app-settings-ui.js`, `app-help.js`, privacy modules | Consistent row anatomy; preferences grouped by scope; predictable detail disclosure; quiet glass only where it helps orientation | Light/dark/system, notification permission, description editing, memo setting, network explanation, Tor preview, diagnostics, advanced details, forget confirmation |
| Education — `app-how-zigs-works.js`, guide and tutorial modules | Focus each illustration on one fact; stronger captions in both themes; short contextual explanations; readable compact compositions | Journey/complete guide, chapter navigation, all illustrated steps, pause/reduced motion, source/details links |
| Shared states and mobile behavior — `app-loop.js`, `app-dom.js`, shared styles | A complete family of empty, busy, unavailable, error, and outcome treatments; the same action hierarchy survives the phone keyboard and enlarged text | Startup/engine failure, offline/reconnect, unknown/stale, empty/no results, interrupted action, focus retention, small height, keyboard, zoom, high contrast |

Current source behavior is the authority for available features and state transitions. Historical
coverage documents help enumerate surfaces but contain older capability descriptions.

## Six prototype stories

These are authored illustrations, not automation of real wallet actions. Each animation has
three to five beats, lasts about 10–16 seconds, and leaves its payoff visible for reading. This
duration describes the illustration, not network or cryptographic performance.

### 1. Propose a payment

- **Place:** The design lab's primary desktop scene and a separate compact composition.
- **Focal object:** The real-looking payment review, adapted from `hero-demo` and `form-error`.
- **Beats:** Choose a saved recipient; enter an exact amount; review outputs/costs; propose.
- **Payoff/poster:** The same request is waiting for the required approvals.
- **Leave out:** Unrelated history and navigation labels. Keep recipient, network, amount,
  fees, memo, approval rule, and the proposal's actual meaning visible.

### 2. Approve together

- **Place:** A focused request with a second device only where it explains a contribution.
- **Starting structure:** `device-pair` and `payout-flow`.
- **Beats:** Open the request; inspect its details; one contribution arrives; the required
  threshold is reached; the next real action becomes available.
- **Payoff/poster:** Approvals complete, with the next stage explicitly named.
- **Leave out:** Decorative device activity. Joined, online, approved, signed, submitted, and
  included remain different facts. A threshold being reached does not imply a finished payment.

### 3. Set up and verify

- **Place:** A continuous setup panel, using `phone-touch` for compact framing and `loading`
  for progress geometry.
- **Beats:** Set the rule; share/join through the existing invitation path; compare the full
  safety code; finish the existing address checks.
- **Payoff/poster:** A prepared wallet with its rule and the next step in view.
- **Leave out:** Engine internals. Preserve the full comparison value and actual waiting,
  mismatch, protection, and optional recovery choices in the live journey.

### 4. Receive and understand the balance

- **Place:** Receive panel and the affected asset row, based on `panel-annotation`/`choreography`.
- **Beats:** Select the asset/network; inspect the address; Copy acknowledges; a separate
  illustrative incoming record explains how the existing balance states relate.
- **Payoff/poster:** A clear receiving destination or incoming-state explanation.
- **Leave out:** Unrelated assets. A clipboard action never implies a deposit occurred.

### 5. Coordinate, then propose

- **Place:** The Messages workspace and its request card, based on `messages` and `share`.
- **Beats:** Read a conversation; open a request; inspect the amount/recipient; open the
  prefilled Send flow; reach review.
- **Payoff/poster:** The request is ready to review, with its source still understandable.
- **Leave out:** Unrelated conversations. A message or request is not a payment approval.

### 6. Save and check recovery material

- **Place:** Security plus one file-check panel, using `upload`, `form-error`, and `static-card`.
- **Beats:** Open the relevant device's backup; save through the existing flow; select the
  saved file for checking; show the actual check result.
- **Payoff/poster:** This file has been checked, with remaining device work stated separately.
- **Leave out:** Unrelated security details. Saved, checked, restored, and externally accessible
  are distinct states; illustration copy does not imply stronger recovery evidence.

## Implementation order and review artifacts

1. **Inventory and baseline.** Freeze before captures of the current UI and make a surface/state
   checklist from the table. Review long content, loading, empty, interrupted, and unavailable
   variants before choosing changes. Preserve concurrent application/engine work.
2. **Establish the standard.** Build the payment proposal and shared-approval stills first.
   Compare them with the chosen gold examples at their actual sizes, then with the current app.
   Resolve composition, hierarchy, and density before adding motion.
3. **Rehearse the core journeys.** Finish the six scenes in light, dark, desktop, and compact
   form. Provide a useful still/poster for each; animate only the journeys that gain clarity.
   A phase review contains the proposed UI, the gesture, the result, and the exceptions.
4. **Translate into production components.** Refine shell/fields/rows/sheets once, then apply
   them to Overview, Send/review, Approvals, setup/Receive, Security/recovery, Messages,
   Activity/Address book/Swap, Settings, and education. These are cohesive implementation
   slices, each with its related states; no blanket stylesheet replacement.
5. **Verify and reconcile.** Compare real browser journeys with the prototypes. Update the
   coverage register with actual evidence and any remaining gaps. Review the entire app as
   one system after the component-level work.

The first review artifact should contain four stills: a payment review and its waiting-for-
approvals result, each in light and dark. Add compact versions before approving its motion.
This tests the core product idea and sets the bar for subsequent surfaces.

## Completion criteria

- Every mapped surface/state has a disposition: kept because it meets the direction, refined,
  or explicitly blocked by an existing capability. No screen is redesigned merely to differ.
- The task, wallet, network, and next available action remain understandable at the point of use.
  Exact financial values, lifecycle distinctions, and decision-relevant context remain complete.
- Light/dark/system all work independently. Glass has a readable foreground on its actual
  background and an opaque fallback. Shadows establish hierarchy consistently.
- The desktop app keeps desktop proportions; mobile is composed for touch and the keyboard.
  Test fresh loads and resizing, long values, short windows, and enlarged text.
- Focus stays visible and correctly placed; native controls and modal/menu dismissal behave
  predictably. Reduced motion, reduced transparency, and forced colors remain supported.
- Stageshow scenes pass the film gate at their shown width and at 390px, including the still,
  interactions, exit, and loop seam. Each scene includes its `REHEARSAL.md`, copied gold,
  adaptations, and limits. A passed gate is followed by visual review of the full composition.
- Production changes pass the relevant application regressions, contrast/orientation checks,
  lint, and real-renderer browser matrix. Record browser engine and fixture/live scope accurately.
- No implementation, commit, deployment, or `main` change is implied by this planning artifact.
  New capabilities require their own implementation decision; visual prototypes do not enable them.
