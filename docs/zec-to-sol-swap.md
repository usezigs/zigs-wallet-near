# Design record: a real swap from ZEC to SOL through NEAR Intents

- **Status:** partly built on the branch `zec-to-sol-swap`, for staging only (section 0). The
  owner changed the plan on 2026-11-02. No funded swap has run.
- **Date:** 2026-11-02 (UTC).
- **Base:** `staging-combo` at `a6264ca9`. Each `file:line` below refers to that commit, unless
  the reference names another branch.
- **Scope:** the Zigs FROST ZEC wallet (mainnet, Ironwood) pays the ZEC. The plain Solana mainnet
  wallet of the same group (FROST-Ed25519, one group address) gets the SOL. NEAR Intents (the
  1Click API) runs the swap. Production (`app.zigs.app`) stays frozen. The route runs on
  `staging.zigs.app` only.

## 0. The owner's decision and what is built

The owner changed this record on 2026-11-02: the group gets a transparent address of its own, and
the route is built now, on the branch `zec-to-sol-swap`, for staging only. This section says what
the branch holds. Where it differs from sections 1 to 7, this section is valid, and those
sections stay as the record of the first proposal.

| Part | Built | Where |
|---|---|---|
| Payment to transparent addresses | A shielded payment can pay `t1`, `t3` (`tm`, `t2` on testnet). Each transparent output shows as a recipient and counts in the sum and in the ZIP 317 fee. The engine still refuses a transparent input, a TEX address and any Sapling part | `wasm/src/lib.rs`, `wasm/src/chain.rs`, `web/app-send.js`, `ios/Zigs` |
| Group transparent address | A t-of-n P2SH multisig address (ZIP 48, `sortedmulti`). Each seat derives a secp256k1 key from its FROST key share, so a backup restores it, and publishes the public key as a signed document. The address shows on Receive with its balance | `wasm/src/p2sh.rs`, `web/app-taddress.js` |
| Worker | `/near/swap-zec` (live quote, transparent deposit and refund, a deadline of 6 hours, at least 4 hours left). `/near/status` also passes the swap of the deposit address: the assets, the two addresses, the amount in, the quoted amount out and the time to pay before | `cf/src/near.js` |
| Page | The Swap page runs ZEC to SOL behind `NEAR_LIVE`. The recipient is the plain Solana address of the wallet and `refundTo` is the group transparent address. Nobody types an address. **Propose the payment** opens Send with the deposit address, the exact amount and a swap note | `web/app-swap-preview.js`, `web/app-swap-zec.js` |
| Approval check | Each device that approves a payment with the swap note reads `/near/status` for the deposit address. It approves only a swap from ZEC to SOL of the exact amount that pays the Solana address of this wallet, refunds to its transparent address and ends at the deadline in the note, with 30 minutes left. `plain` must be true: the same form rules as the group swap from SOL (`docs/sol-to-zec-group.md` section 4). The review of the payment shows the deposit address, the ZEC amount, and the SOL amount and the Solana address of the quote | `web/app-swap-zec.js` |
| Send check | No device sends a swap payment in the last 30 minutes before the deadline | `sendRefusal` in `web/app-payments.js` |
| Move from the transparent address | A device proposes a move of the payments of the group address to the shielded address of the wallet. Each device checks it with its engine (only this wallet, only the ZIP 317 fee, every input signs the whole transaction) and signs each input with its seat key. Any device with t signatures proves it and sends it. Dust stays behind; at most 50 payments in one move | `wasm/src/p2sh.rs`, `web/app-sweep.js` |

Changes against the first proposal:

- **Refund address (section 4).** Section 4.1 said that the group cannot hold a transparent key.
  That is true for a FROST key. The branch adds a separate secp256k1 key for each seat and a P2SH
  multisig, so the group holds the address with the same threshold. This is option D, and it
  replaces option A. The Worker accepts a `t3` refund address. It is not known whether NEAR
  Intents accepts one: no quote with a `t3` refund has run, and no refund to a P2SH address was
  ever paid. Step L0 answers the first question.
- **The quote check (section 3.4).** The branch does not check the Ed25519 signature of the quote.
  Each device checks the swap that `/near/status` gives instead. Section 3.4 says not to use the
  status in place of the signature. The branch does so as a first floor, with this limit: the
  check trusts the Zigs Worker and NEAR Intents. It stops one device that proposes a payment to the
  deposit address of another swap. It does not stop a Worker that lies. The signature check stays
  the target before a production route.
- **The trigger of the check.** The check runs for a payment whose note marks a swap. A device that
  writes another note gets no check, and the approval shows a plain transparent payment. A check
  for every `t1` payee would tell NEAR Intents about each transparent payment of the wallet.
- **The expiry (section 3.5).** The payment keeps the expiry window of one day. The engine has no
  per-payment cap (`wasm/src/expiry.rs`). The send check covers the risk instead: no device sends
  in the last 30 minutes before the deadline. A transaction that a device sent before that time
  can still reach a block after the deadline.
- **Native apps.** The iPhone and Mac apps do not publish a transparent key yet. A group with a
  native seat has no transparent address, so the Swap page gives the reason and runs no swap.
- **Not verified here:** that 1Click `/v0/status` gives the quote of a `PENDING_DEPOSIT` address
  before any deposit. The Worker tests use recorded answers. Run L0 (section 6.3) to check it.

The gaps before the first funded swap:

1. No move from the transparent address has run on a chain. The cargo test proves a 2-of-3 move
   and runs its scripts with the interpreter. The first real move (testnet first) needs the
   owner's yes with the commit, the command and the amounts.
2. A move of the wallet (Change devices) leaves funds at the old transparent address. The move to
   the shielded address must run first, or the change must refuse while that address has a
   balance.
3. Run L0 with the owner's yes: one live quote, no deposit, and one `/near/status` read of its
   deposit address.

The live runs of section 6.3 change so: L1 pays the refund to the group transparent address, which
Receive shows with its balance, and then moves it to the shielded address. L2 is the full swap
through the group. Each run needs the owner's
yes with the commit, the command and the amounts.

## 1. Summary

The group pays one shielded Ironwood transaction with one extra transparent output. That output
pays the exact amount of a 1Click quote to the deposit address of the quote. 1Click then pays SOL
to the group address of the plain Solana wallet. A refund goes back to the unified address of the
ZEC wallet.

The proposed rules:

1. Each approving device accepts one transparent output only when it checked a signed 1Click quote
   itself. The output must pay the deposit address and the amount of that quote, exactly.
2. The fee check subtracts the value of that output before it compares the fee with the ZIP 317
   fee. The ZIP 317 fee counts that output as one more action.
3. The quote must name the group address of this wallet as the recipient, and the address of this
   ZEC wallet as the refund address. The device checks both itself.
4. The payment must expire before the deadline of the quote, with a margin.
5. Without a checked quote, every device keeps the rule of today: no transparent part at all.

The privacy cost is high. The deposit is public on the Zcash chain. The 1Click status of a deposit
address is open, so an observer can link the Zcash transaction to the Solana group address and to
the ZEC refund address (section 3.8). The page must not call this swap private.

## 2. What runs today

| Part | Today | Evidence |
|---|---|---|
| SOL to ZEC | A real swap on staging. The person pays SOL from a wallet outside Zigs. Zigs signs nothing. | `cf/src/near.js:114-122`, `web/app-swap-preview.js:20-21`, `PRIVACY.md:349-390` |
| Other pairs, ZEC to SOL included | Dry quotes only, with sample addresses | `cf/src/near.js:103-112`, `PRIVACY.md:286-347` |
| ZEC wallet | One Ironwood address with one shielded receiver. No transparent receiver | `README.md:101-102`, `README.md:849` |
| Plain Solana wallet | Receives SOL and USDC. It cannot send from the group address yet | `PRIVACY.md:546-553` |
| Approving device | Refuses every transparent part | `wasm/src/lib.rs:416-426`, `PRIVACY.md:785-788` |

## 3. The deposit

### 3.1 Why every device refuses it today

NEAR Intents takes ZEC only at a transparent deposit address (`PRIVACY.md:331-333`,
`web/app-swap-preview.js:61-63`). The chain-support page of NEAR Intents lists Zcash as
"transparent only", with `t1` and `t3` addresses (read on 2026-11-02).

Every approving device refuses such a transaction:

- `shielded_only` refuses any transparent input or output and any Sapling part
  (`wasm/src/lib.rs:416-426`). The reason is in its comment: value that leaves through a
  transparent output looks like a higher fee.
- `inspect_inner` computes `outflow` as the value that leaves the shielded pools
  (`wasm/src/lib.rs:443`, `wasm/src/lib.rs:455`). It calls that value the fee, and it accepts a fee
  from the ZIP 317 fee up to 10 times it (`wasm/src/lib.rs:512-519`, `wasm/src/chain.rs:58`).
- `sign_commit`, `sign_package` and `sign_share` all call `inspect_inner`
  (`wasm/src/lib.rs:550`, `wasm/src/lib.rs:568`, `wasm/src/lib.rs:601`). So no device commits a
  nonce, packages or signs such a transaction.
- The test `inspect_refuses_a_transparent_output` holds this rule (`wasm/src/lib.rs:1657-1693`).
- `PRIVACY.md:785-788` and `README.md:585-586` state the rule to users.

### 3.2 The proposed rule

The engine gets one new input for a swap payment: an allowance `{address, value}`. Only the quote
check of section 3.4 makes an allowance. Without an allowance, `shielded_only` stays exactly as it
is today.

With an allowance, the device accepts the transaction only when all of these are true:

1. The transaction has no transparent input.
2. The transaction has exactly one transparent output.
3. The device decodes the address from the `script_pubkey` of that output itself. It ignores the
   optional `user_address` text of the PCZT. The `redeem_script` field is empty.
4. The script is a P2PKH script (`t1`), and its key hash equals the hash of the allowance address.
   The device refuses a P2SH (`t3`) script. A TEX address (ZIP 320) holds the same key hash as a
   `t1` address, so the script cannot show it. The quote check refuses it instead: it decodes the
   text of `depositAddress` and accepts only the `t1` encoding. If the first live quote (step L0
   in section 6.3) shows a `t3` deposit address, change this rule to P2SH only, not to both.
5. The value of the output equals the allowance value, to the zatoshi.
6. The transaction has no Sapling part, and its expiry height is not 0 (as today).
7. The fee check of section 3.3 passes.
8. The list of what the payment does shows the output as a deposit: "NEAR Intents deposit, swap to
   SOL", with the address, the value and the payout of the quote.

The approval stays tied to the sighash. ZIP 244 hashes the transparent outputs, so the sighash
covers the deposit address and the value. `sign_commit`, `sign_package` and `sign_share` must take
the same allowance and run the same check. A device without the allowance refuses the payment.

### 3.3 The fee check with the transparent output

Let `V` be the value of the one transparent output. With no transparent input:

- `outflow = fee + V`. So the device computes `fee = outflow - V`. It refuses a negative result.
- ZIP 317 counts one logical action for each 34 bytes of transparent outputs, rounded up. A P2PKH
  output has 34 bytes (8 for the value, 1 for the length, 25 for the script). So it adds one
  action.
- The standard fee is `zip317_fee(actions + 1, 0)` (`wasm/src/chain.rs:653-655`). Today the code
  calls `zip317_fee(actions, 0)` (`wasm/src/lib.rs:514`).
- The fee must be from that standard fee up to `PRIORITY_FACTOR` (10) times it, as today.

Example: a payment that spends one note has two Ironwood actions (the change and a padding
action) and one transparent output. The standard fee is 3 × 5,000 = 15,000 zat. The existing test
builds this case, and the builder charges 15,000 zat for it (`wasm/src/lib.rs:1680-1687`).

The note selection must also count this action. Else the builder finds a change that does not
balance and refuses to build. That failure loses no funds.

### 3.4 The quote check on each device

The binding needs the most care. A proposer, or the Zigs Worker, can name any transparent address as
"the deposit". So each approving device checks a signed 1Click quote itself, and only that check
makes the allowance.

The proposal carries the full 1Click answer: `quoteRequest`, `quote`, `timestamp` and `signature`.
Each device then does these checks:

1. **Signature.** The Ed25519 signature is valid under the pinned 1Click key. The branch `pq-swap`
   (`cf151ac4`, local only) has this check in `web/swap-near-adapter.js:56-110`. It builds the
   signed payload as SDK 0.1.26 does. The signed fields include `recipient`, `refundTo`, `amount`,
   `deadline`, `depositAddress`, `depositMemo` and `timeWhenInactive`
   (`web/swap-near-adapter.js:46-53` on that branch).
2. **Request.** `dry` is false. `swapType` is `EXACT_INPUT`. `originAsset` is
   `nep141:zec.omft.near`, and `destinationAsset` is `nep141:sol.omft.near`
   (`cf/src/near.js:27-31`). `depositType` and `refundType` are `ORIGIN_CHAIN`, and
   `recipientType` is `DESTINATION_CHAIN`.
3. **Recipient.** `recipient` equals `base58(groupKey)` of the plain Solana wallet of this wallet.
   The device takes the key from `plainAgreement` (`web/sol/ceremony.js:574-584`), which also
   checks that the key share of this browser fits (`web/sol/ceremony.js:543`). It is the address of
   the Receive card (`web/sol/plain/view.js:361`).
4. **Refund.** `refundTo` is the unified address of this ZEC wallet. Its Orchard receiver equals
   the external address of the viewing key of this device (`wasm/src/lib.rs:438`). See section 4.
5. **Amount and address.** `amount` and `quote.amountIn` equal the allowance value `V`.
   `quote.depositAddress` decodes as a mainnet `t1` address (Base58Check). A `tex1` text is
   refused. The allowance address is that decoded address.
6. **Price.** `slippageTolerance` is 50, 100 or 200 (`cf/src/near.js:42`). `minAmountOut` is at
   least `floor(amountOut × (10000 - bps) / 10000)`, the floor rule of the `pq-swap` adapter.
7. **No extras.** The answer has no `depositMemo`, `customRecipientMsg`, `virtualChainRecipient`
   or `virtualChainRefundRecipient` (`NEAR_SWAP_NONE` of `cf/src/near.js`). A null value counts
   as none.
8. **Time.** See section 3.5.
9. **Once.** The device keeps the deposit addresses that it approved. It refuses a second payment
   to the same deposit address.

Run these checks in the JavaScript of the device, and pass only the allowance to the engine. The
signed payload holds the USD values as floats (`amountInUsd`). The canonical text must match the
JSON text of the SDK. The engine form `sorted_json` refuses floats (`wasm/src/lib.rs:825-845`).
The `pq-swap` check runs in JavaScript and verified three staging-signed quotes of the SDK.

Two limits:

- The pinned key comes from SDK 0.1.26. No production quote was checked against it
  (`web/swap-near-adapter.js:8` on `pq-swap`). Step L0 checks it. If 1Click changes the key,
  every swap stops. That failure is safe.
- The iPhone and Mac approvers have no allowance input. They refuse a swap payment. A group that
  needs a native seat to reach its threshold cannot approve a swap.

A weaker check reads `/near/status` on each device and compares `quoteResponse.quoteRequest`.
That check trusts the Zigs Worker, and `nearStatusAnswer` drops those fields today
(`cf/src/near.js:285-298`). Do not use it in place of the signature.

### 3.5 The time check

Group approvals take hours (`wasm/src/chain.rs:924`). The live SOL to ZEC route asks for a
30-minute deadline, because an outside wallet pays in minutes (`cf/src/near.js:16-18`). That is
too short for a group.

The proposed timing (the numbers are for the owner to decide):

- The Worker asks for a request `deadline` 6 hours after the quote.
- The proposer sets the expiry height of the payment to about 4 hours of blocks: 192 blocks at
  75 s before NU7, 576 blocks at 25 s from NU7 (`wasm/src/expiry.rs:23-30`). Today the window is
  24 hours (`wasm/src/expiry.rs:16`, `wasm/src/chain.rs:936`). The existing expiry check refuses
  only a payment that stays valid longer, so a shorter window passes (`wasm/src/expiry.rs:76-90`).
- Each device refuses the payment unless the expected time of its expiry height, plus a margin of
  2 hours, is before the earlier of `deadline` and `timeWhenInactive`. For 192 blocks, one standard
  deviation of the sum of the block times is about 17 minutes.
- A shorter window also lowers the price risk. A quote that waits for approvals can fail its
  minimum and end in a refund.

A short expiry window is unusual on the chain. Today the one-day expiry already marks a Zigs
payment (`README.md:310`).

### 3.6 The builder

- The payee type holds an Orchard address only (`wasm/src/lib.rs:295`). `parse_recipient`
  refuses every address that is not unified (`wasm/src/chain.rs:792-801`).
  `parse_payee` already detects transparent and TEX addresses, for the memo rule only
  (`wasm/src/chain.rs:780-787`).
- Add a separate swap spend: Ironwood spends, the change, and one transparent output from the
  allowance. Do not open the normal Send form to transparent addresses.
- The builder has `add_transparent_output` with the current features of the crates. The existing
  test calls it (`wasm/src/lib.rs:1687`).
- The proposal path calls `createSpend` today (`web/app-payments.js:364`). The approve path calls
  `signCommit` (`web/app-payments.js:555`) and `inspect` (`web/app-payments.js:726`). All three
  get the allowance on the swap path only.
- The proposal must carry the signed quote. Measure its size at step L0. It must fit the document
  limit of the group server (see the design note `docs/payment-size-limit.md` on the branch
  `payment-size-limit-design`).

### 3.7 Threats

| # | Threat | Control |
|---|---|---|
| T1 | A proposer or the Worker names the deposit address of another quote, which pays the Solana address of an attacker | Each device checks the 1Click signature and that `recipient` is its own group address (3.4 items 1 and 3) |
| T2 | A forged quote | The signature under the pinned key. The key is not checked against a production quote yet (step L0) |
| T3 | The payment pays more or less than the quote | The exact value rule (3.2 item 5). Less gives `INCOMPLETE_DEPOSIT` and a refund. More can be lost |
| T4 | Value leaves as a "fee" (the reason for `shielded_only`) | The fee is `outflow - V`, inside the ZIP 317 range (3.3) |
| T5 | A second transparent output, a transparent input, a P2SH or TEX script | Refused (3.2 items 1 to 4) |
| T6 | The payment lands after the deadline, and 1Click refunds or loses it | The expiry rule with a margin (3.5) |
| T7 | An old quote, or two payments to one deposit address | The time check, and the list of approved deposit addresses (3.4 item 9) |
| T8 | A refund to an address outside the wallet | `refundTo` must be the address of this wallet (3.4 item 4) |
| T9 | A bad price through a high slippage | The slippage set and the floor of `minAmountOut` (3.4 item 6). The review shows the rate and the USD values |
| T10 | A memo or a virtual-chain field changes where the funds go | Refused (3.4 item 7) |
| T11 | 1Click fails or does not pay | Not controlled. NEAR Intents has no duty to refund a deposit that it cannot process (`PRIVACY.md:389-390`). Use tiny amounts |
| T12 | The refund comes as an Orchard (version 5) output | The scanner reads Ironwood outputs only (`wasm/src/chain.rs:276-290`, `PROTOCOL.md:1029-1032`). The refund does not show in the balance. Section 4.4 |
| T13 | The SOL lands in a wallet that cannot send | Start the code work after `sol-plain-c4` and `sol-plain-c5` |
| T14 | One compromised approving device | Not changed: a threshold of honest devices must approve, and each one decodes the transaction itself |

### 3.8 The privacy cost

The deposit is public. These items become visible:

- **Zcash observers** see the transparent output: the deposit address, the value `V` and the time.
  They see the id of the transaction. The spent notes and the change stay shielded.
- **Anyone who knows the deposit address** can ask 1Click for the status of the swap. The status
  answer holds the full quote, with `recipient` and `refundTo`. The Worker reads that quote
  (`cf/src/near.js:278-281`), and the `pq-swap` adapter checks its signature
  (`web/swap-near-adapter.js:395` on that branch). The status works without a partner key: the
  Worker calls it with no key today (`cf/src/near.js:127-131`). So a chain observer can link the
  Zcash transaction to the Solana group address and to the ZEC refund address. A live ZEC status
  answer did not confirm this yet.
- **Solana observers** see the payout to the group address. That address is public and linked to
  the group already (`PRIVACY.md:554-556`). The amount and the time also link the payout to the
  Zcash deposit without any 1Click data.
- **NEAR Intents** learns the amount, the Solana group address and the ZEC address of the wallet,
  linked to the deposit. It screens the addresses and can keep them (`PRIVACY.md:380`).
- **The App Worker** sees your IP address, the amount and both addresses. It keeps no log (as in
  `PRIVACY.md:381`).

The ZEC wallet has one address (`README.md:849`). So every swap links that one address to the
Solana group address. A fresh diversified address for each refund would limit this link. That
needs engine work and is not in this design.

The same status leak applies to the SOL to ZEC route of today: the Solana deposit is public, and
its status names the ZEC payout address. `PRIVACY.md:378-390` does not say this. This is a
follow-up for that route.

## 4. The refund address

### 4.1 Why the group cannot hold a transparent key

Section 0 replaces this section: the branch gives each seat a separate secp256k1 key, and the
group holds a P2SH multisig address with the same threshold. The text below stays as the record
of the first proposal.

- The ZEC wallet has one shielded receiver and no transparent receiver (`README.md:101-102`).
- A transparent (P2PKH) spend needs an ECDSA signature on secp256k1. The FROST group signs
  RedPallas on the Pallas curve (ZIP 312). FROST makes Schnorr signatures. It cannot make
  an ECDSA signature. So the group
  cannot own a transparent address, and a refund to a transparent address leaves the group.

### 4.2 The dry quotes

The staging Worker builds every dry quote from ZEC with the Orchard-only sample unified address as
`refundTo` and `refundType: "ORIGIN_CHAIN"` (`cf/src/near.js:32-36`, `cf/src/near.js:103-112`). So a
dry quote from ZEC through `POST https://staging.zigs.app/near/quote` tests a shielded refund
address. The calls went to the Worker that staging runs, not to a6264ca9. `cf/src/near.js` is the
same at `3a4f922f` (the last staging deploy that a hand-over note names) and at a6264ca9, so the
deployed Worker sends the same sample. On 2026-11-02 these calls ran (no deposit address exists
for a dry quote):

| Time (UTC) | Ask | Answer |
|---|---|---|
| 20:02:43 | ZEC to SOL, 50,000 zat, slippage 100 | 400 `too-low`, minimum 132,000 zat |
| 20:02:44 | ZEC to SOL, 200,000 zat (2.30 USD) | 200: about 24,853,853 lamports, at least 24,605,314. Time estimate 454 s |
| 20:02:44 | ZEC to USDC, 200,000 zat | 200: about 2,278,189 USDC units (2.28 USDC) |
| 20:02:46 | SOL to ZEC, 20,000,000 lamports (control) | 200: about 126,784 zat, at least 125,516 |

The result: 1Click accepted a request with a shielded (Orchard-only) unified refund address.

The limits of this result:

- The Worker does not check that the answer repeats `refundTo` (`cf/src/near.js:143`,
  `cf/src/near.js:161-166`), and it drops the echo. So a 200 says only that 1Click did not refuse
  the request.
- There is no negative control. Nobody sent a bad refund address to a dry quote. So it is not
  known whether a dry quote checks `refundTo` at all. The comment at `cf/src/near.js:24-26` says
  that the samples pass the address check, but no record shows a refusal.
- No refund to a unified address was ever paid. Third-party reports differ. In October 2025 a
  public report said that a NEAR Intents refund of ZEC went to a transparent address, and that
  shielded refunds would come in a later update. A swap provider guide says that NEAR Intents
  cannot quote unified Zcash addresses. The dry quotes above contradict that guide.
- It is not known whether a live quote (`dry: false`) checks `refundTo` more than a dry quote.
  Step L0 answers this for a ZEC refund address. The SOL to ZEC route showed only that 1Click
  accepts an Orchard-only unified address as the recipient of a live quote.

### 4.3 The options

| Option | Custody | Privacy | Status |
|---|---|---|---|
| A. The unified address of the ZEC wallet | The refund comes back to the group | NEAR Intents learns the wallet address, and the status leak of 3.8 shows it | Dry quote accepted. A paid refund is untested |
| B. A transparent address outside Zigs that one person controls | The refund leaves the group and goes to one person | The refund is public and links that person | The pattern of the SOL to ZEC route, where the person pays from an outside Solana wallet |
| C. `refundType: "INTENTS"` (a NEAR Intents account) | The refund needs a NEAR key outside the group | NEAR account activity | Not proposed |

**Recommendation:** option A, with step L1 (section 6.3) as the test before any group payment.
Use option B only as a fallback, chosen by the owner for each run. The device check of 3.4 item 4
then needs a second form, and the review must name the person who gets the refund.

### 4.4 The refund risk in the scanner

The engine records Ironwood outputs only (`wasm/src/chain.rs:276-290`). If 1Click pays a refund as
an Orchard (version 5) output, the wallet does not show it (`PROTOCOL.md:1029-1032`). The funds are
not lost to another person, because the refund pays the group address, but the balance and the
spend path miss them until the engine scans Orchard notes. Step L1 tests which pool 1Click uses.
NU7 activates at block 3,543,405, about 2026-11-06 (`README.md:853-854`). L1 needs the Worker step
of section 6.1 first, so it will most likely run after NU7. The run after NU7 is the one that
counts. Run L1 before NU7 only if the steps get there in time.

## 5. The payout

### 5.1 How the SOL to ZEC route works today

| Part | Code |
|---|---|
| The page shows the live route only for SOL to ZEC on a server with `NEAR_LIVE` | `web/app-swap-preview.js:108`, `web/app-shell.js:495` |
| The payout is the ZEC address of the open mainnet wallet, with the room under the 0.5 ZEC cap | `web/app-shell.js:498-513` |
| The review asks for a Solana refund address and a consent tick, then calls `openSwap` | `web/app-swap-preview.js:475-526` (`:485`, `:515`, `:518`) |
| The model refuses a payout over the cap, before and after the quote | `web/swap-preview-model.js:247-268` (`:250`, `:258`) |
| The provider posts `{amount, recipient, refundTo, slippageBps}` and checks the answer | `web/near-intents-swap-provider.js:112-118`, `:46-56` |
| The Worker accepts a unified recipient and a Solana refund address | `cf/src/near.js:91-101` (`NEAR_UA` at `:44`, `nearSolAddress` at `:59-67`) |
| The Worker builds a live request from SOL to ZEC with a 30-minute deadline | `cf/src/near.js:114-122`, `:16-18` |
| The Worker checks the echo, no memo, a Solana deposit address and the time left | `cf/src/near.js:145-149`, `:170-181` (`:178`) |
| The Worker sends a reduced answer to the page | `cf/src/near.js:210-218` |
| The status route accepts a Solana deposit address only | `cf/src/near.js:309-317` (`:314`) |
| The deposit screen tells the person to send exactly the amount from an outside wallet | `web/app-swap-preview.js:546-569` (`:556`) |

### 5.2 What changes for ZEC to SOL

| Part | SOL to ZEC (today) | ZEC to SOL (proposed) |
|---|---|---|
| Who pays | An outside Solana wallet | The group, with a payment that needs the approval threshold |
| Recipient | The ZEC address of the wallet (`web/app-shell.js:498-513`) | `base58(groupKey)` of the plain Solana wallet, only when `plainAgreement` says "agree" and the server serves the plain part (`SOL_MAINNET` "1") |
| Refund | A Solana address that the person types | The ZEC address of the wallet, never typed (section 4) |
| Worker ask check | `NEAR_UA` recipient, Solana refund | Solana recipient (`nearSolAddress`), `NEAR_UA` refund |
| Assets | `sol` to `zec` | `zec` to `sol` |
| Deadline | 30 minutes | 6 hours (section 3.5) |
| Deposit address check | `nearSolAddress` (`cf/src/near.js:178`) | A mainnet P2PKH address (Base58Check, prefix `t1`) |
| Answer to the page | Reduced fields (`cf/src/near.js:210-218`) | The full signed answer, which each device checks (section 3.4) |
| Status route | Solana deposit address only (`cf/src/near.js:314`) | Also a `t1` deposit address |
| Provider check | `SOL_ADDRESS` deposit address (`web/near-intents-swap-provider.js:48`) | A `t1` deposit address, and the full signed answer kept |
| Cap check | The ZEC room under 0.5 ZEC (`web/swap-preview-model.js:250`) | None for SOL: the plain wallet has no cap (owner decision of 2026-11-01). A refund never raises the ZEC total above its value before the swap |
| After the quote | The deposit screen and a status poll | A group proposal with the quote. Approvals, the proof, the broadcast, then the status poll |
| States text | "Waiting for your deposit" of SOL | ZEC texts: the payment waits for approvals, then for its block |
| Privacy text | `SWAP_PRIVACY` (`web/app-swap-preview.js:24-27`) | `ZEC_PRIVACY` (`web/app-swap-preview.js:61-63`) and the status leak of 3.8 |

Keep the Worker routes apart. Use a new route for ZEC to SOL, or one explicit direction field. Do
not loosen the checks of the SOL to ZEC route.

The SOL payout must be at least the rent-exempt minimum of a Solana account (890,880 lamports)
when the group address holds less than that. The minimum quote of 132,000 zat gives about
16,400,000 lamports, so the real minimum is the 1Click minimum.

## 6. Steps

### 6.1 Order

Each step needs the step before it. No step has a time estimate.

0. **Before the code:** `sol-plain-c4` and `sol-plain-c5` pass QA and merge into
   `staging-combo`. The mainnet ZEC wallet holds at least 215,000 zat of confirmed notes
   (200,000 for the swap and 15,000 for the fee). The R0b run of the SOL to ZEC route pays about
   120,000 zat only, so a direct payment must add the rest.
1. **Worker:** the ZEC to SOL route, the status route for `t1`, and the full signed answer. Deploy
   to staging only, after the owner's yes for that deploy.
2. **L0:** one live quote with no deposit (section 6.3). If the signature fails or the deposit
   address is not `t1`, stop and change this record.
3. **L1:** the refund test from an outside wallet (section 6.3). If the refund is not an Ironwood
   note of the wallet, stop. The owner then chooses option B or engine work for Orchard notes.
4. **Engine:** the allowance, the transparent output rule, the fee check, the swap spend and the
   shorter expiry.
5. **Page:** the quote check of section 3.4 (the `pq-swap` code is a source), the swap proposal
   with the quote, the review and the approver view.
6. **Text:** `PRIVACY.md` (the rule at `:785-788`, the swap sections at `:286-390`, the status leak
   of 3.8), `README.md` (`:583-586`, and the swap text), and the page texts.
7. **QA:** one round. Then record the baseline as the last commit.
8. **L2:** the full swap through the group (section 6.3). If L2 runs before NU7, run **L3**, the
   same swap, after NU7.

### 6.2 Tests

Plain tests only. No mutation tests.

- **Engine (`cargo test` in `wasm/`):**
  - With no allowance, a transparent output is refused as today
    (`inspect_refuses_a_transparent_output` stays).
  - With an allowance, one P2PKH output to the address with the exact value passes, at 15,000 zat
    for two actions.
  - Each of these is refused: another address, the value plus or minus 1 zat, a second transparent
    output, a transparent input, a P2SH script, a `redeem_script`, a Sapling part.
  - The fee is `outflow - V`: 10,000 zat (the old standard) is refused, 15,000 passes, 150,000
    passes, 150,001 is refused.
  - `sign_commit`, `sign_package` and `sign_share` refuse without the allowance and pass with it.
  - The swap spend counts the transparent action in the note selection, and its expiry is the
    short window.
- **Quote check (a new web test):**
  - A recorded live ZEC to SOL quote from L0 verifies. The three SDK quotes of `pq-swap` verify.
  - Each signed field changed by one character is refused.
  - A wrong `recipient`, a `refundTo` of another wallet, a deadline too close, a `depositMemo`, a
    high slippage and a low `minAmountOut` are refused.
  - A second payment to an approved deposit address is refused.
- **Worker (`web/test/near-quote.mjs`):** the request shape of the new route, the echo checks, the
  `t1` check, the status route with a `t1` address, and that the SOL to ZEC route is unchanged.
- **Page (`web/test/swap-preview.mjs`):** the ZEC to SOL route shows only with a ready plain
  Solana wallet. The texts and the states.
- **Suite:** `sh scripts/test-fast.sh` and `bash solspike/lint.sh`. Record the baseline after the
  last code commit.
- **One hand-revert check:** remove the `fee = outflow - V` subtraction by hand. The engine tests
  must fail. Then restore it.

### 6.3 Live runs

Each funded run is a live chain write. Each one needs the owner's yes for that run, with the
commit, the command and the amounts. No run happens as part of this record.

| Run | What moves | Pass |
|---|---|---|
| L0 | Nothing. One live quote (`dry: false`) from ZEC to SOL through the new Worker route, with the plain group address as recipient and the wallet address as `refundTo`. Nobody pays the deposit address | 200. The deposit address is `t1`. The signature verifies under the pinned key. Record `refundFee`, `timeWhenInactive` and the size of the answer |
| L1 | About 199,000 zat from a shielded wallet outside Zigs that the owner controls. It pays the deposit address of a new L0-type quote of 200,000 zat. The deposit is too small on purpose, so 1Click refunds it to the Zigs wallet after the deadline of the quote | `INCOMPLETE_DEPOSIT`, then `REFUNDED` with a Zcash transaction hash. The Zigs wallet shows the note after a sync. Read `refundFee` from L0 first: if it is near the deposit, raise the amounts |
| L2 | 200,000 zat plus a 15,000 zat fee from the Zigs mainnet wallet, through the group | `SUCCESS` with a Solana transaction hash. The plain Solana wallet shows about 0.0249 SOL (the 20:02 UTC quote). The ZEC change comes back |
| L3 | The same as L2, after NU7. Only when L2 ran before NU7 | The same as L2 |

Do not use the sample unified address of `cf/src/near.js:32-34` in a funded run. Its keys are
public. Do not use an exchange address in any run.

## 7. Decisions for the owner

1. Accept the privacy cost of section 3.8 for this route.
2. The refund address: option A, with option B as a fallback for each run (section 4.3).
3. The deadline (6 hours) and the expiry window (4 hours) of section 3.5.
4. Native approvers refuse swap payments (section 3.4). A group that needs one cannot swap.

## 8. How this record was made

- Code read on `staging-combo` `a6264ca9`, and on `pq-swap` `cf151ac4` for the quote signature.
- Four dry quotes through the staging Worker, with the staging password from its file. No live
  quote, no deposit address, no deposit and no chain write. The table of section 4.2 holds all
  four answers.
- Public sources read on 2026-11-02: the chain-support page of NEAR Intents
  (`docs.near-intents.org`), a news report of 2025-10-21 about a ZEC refund of NEAR Intents to a
  transparent address, and the Zcash guide of a swap provider (`docs.swapkit.dev`).
