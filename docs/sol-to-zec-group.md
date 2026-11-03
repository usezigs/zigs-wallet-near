# Design record: a swap from SOL to ZEC paid by the plain Solana wallet

Staging only (`NEAR_LIVE` "1"). Production stays frozen. Base: `bdc38bf6` of `staging-combo` (the
merge of the ZEC to SOL swap into staging, `8fe053c2`, and its baseline).

## 1. Summary

Today the Swap page runs a live swap from SOL to ZEC through NEAR Intents 1Click (`/near/swap`).
The person pays SOL from a wallet outside Zigs and types a refund address. The ZEC payout goes to
the ZEC address of the open mainnet wallet, under the 0.5 ZEC cap.

This record adds a second payer for the same pair: the plain Solana wallet of the group
(FROST-Ed25519, t of n approvals). The deposit becomes one plain send (S2), which the devices
approve as any other send. The route from a wallet outside Zigs stays as it is, with its checks.

## 2. The route

| Item | Paid from outside (today, unchanged) | Paid by the group (new) |
|---|---|---|
| Worker route | `POST /near/swap` | `POST /near/swap-sol-group` |
| Payer | A Solana wallet outside Zigs | The plain Solana address of the wallet, `base58(groupKey)` |
| Refund address | Typed by the person | `base58(groupKey)` of the plain wallet. Nobody types it |
| Payout | The ZEC address of the open mainnet wallet | The same |
| Deadline | 30 minutes (`NEAR_SWAP_DEADLINE_MS`), at least 5 minutes left | 6 hours (`NEAR_ZEC_DEADLINE_MS`), at least 4 hours left (`NEAR_ZEC_MIN_LEFT_MS`) |
| Cap | The payout must stay under the 0.5 ZEC cap, before and after the quote | The same, and each approving device checks it again |

The new route has its own entry in `NEAR_LIVE_ROUTES` of `cf/src/near.js`. It uses the same checks
of the request and of the answer as `/near/swap`: a unified address as the recipient, base58 of 32
bytes for the refund and the deposit address, the echo of every field, no memo and no virtual
chain. Only the deadline and the time left differ. The Worker cannot know the group key, so it
does not check that the refund address is the group address. The page sets it, and each approving
device checks it (section 4).

## 3. The proposal

After the quote, the page asks `/near/swap-sol-group` for a deposit address. Then **Propose the
payment** makes one plain send proposal (`proposeSend` of `web/sol/plain/propose.js`):

- the asset is SOL;
- the recipient is the deposit address;
- the amount is exactly `amountIn` lamports of the quote. The page writes it as a decimal text
  with `amountText(lamports, 9)`, which `unitsOf(text, 9)` reads back without loss.

The proposal carries one new optional signed field, `swap`:

```
near-sol-zec <deposit address> <deadline, ISO 8601 with milliseconds, UTC>
```

- The proposer signs it with the other fields of the proposal (`PROPOSAL` of
  `web/sol/plain/sessions.js`). `partFields` leaves out a field that is not there, so an old
  proposal still verifies as before.
- An app version without the field cannot verify a proposal with it, and drops it as a bad
  document. This is acceptable on staging: every device loads the same page.
- A proposal with a `swap` field of another form, or on another intent than a SOL send, is not
  shown and not signed.
- The list of sends and the approvals show the title "Swap deposit (SOL to ZEC)".
- The checker still makes every row of the review: the recipient, the amount, the base units, the
  fee and the payer. The swap check adds a separate block of sentences, never a checker row.

Before the page asks 1Click for a deposit address, it checks what it can know without the chain:

- the key setup of the plain wallet agreed (the address exists);
- this browser read the balance, and the balance holds the amount;
- the rent rule of section 6;
- this device has a free nonce account (Create nonce in the Solana tab);
- a seat of this browser can pay the fee (its fee key holds enough SOL).

Without these checks the page could get a deposit address for 6 hours that the group cannot pay.

One deposit address gets one session. The page does not propose a second send to a deposit
address that an open or sent session already pays. An approving device refuses a session when an
older session that did not fail pays the same deposit address.

## 4. The check of each approving device

Each device that reviews or approves the proposal runs the checker on its own read of the chain,
as for every send. For a proposal with the `swap` field it then reads `/near/status` for the
deposit address and approves only when all of these hold:

- the checker's recipient is the deposit address of the field;
- the deadline of the field is at least 30 minutes away;
- no older session that did not fail pays the same deposit address;
- the state is `PENDING_DEPOSIT`;
- the swap is from SOL to ZEC, and `plain` is true: no app fee, a slippage that Zigs offers and
  the address types that the Worker sends;
- `refundTo` is the plain Solana address of this wallet;
- `recipient` is the ZEC address of this wallet, which this device checked;
- `amountIn` is the checker's base units of the send;
- the deadline of the swap is the deadline of the field;
- the quoted payout keeps the wallet under the 0.5 ZEC cap.

The check lives in the page (`web/app-swap-sol.js`) and reaches the plain code through the host
key `swapCheck` of `solHost()`. `web/sol/plain` imports no page module. `approvePlain` runs the
review again, so the check runs again at the approval.

This check trusts the Zigs Worker and NEAR Intents, as the check of the ZEC route does. It does
not verify the Ed25519 signature of the quote. It stops one device that proposes a payment to the
deposit address of another swap. It does not stop a Worker that lies.

The ZEC address of the wallet is the one of the signed wallet document (`state.wallet.address`).
It is the same on every device, and each device checks it against its own key before it shows it.

## 5. The deadline and the durable nonce

A plain send uses a durable nonce: the signed transaction never expires. Approvals take hours,
so the route asks for a deadline of 6 hours.

- **Approvals.** No device approves in the last 30 minutes before the deadline.
- **Send.** The send step (`web/sol/plain/sign.js`) does not send a swap deposit in the last 30
  minutes before the deadline. When the status of the transaction is "none" and the nonce
  account still holds the nonce of the transaction, the step ends the session with a reason. The
  nonce account is free again, and the next send on it makes the old signature useless.
- **A late deposit.** The proposal, the fee signature and the group signature are in the store.
  Any reader of the store can still send the signed transaction after the session ended. 1Click
  refunds a deposit that comes after the deadline to the refund address, which is the group
  address, less a refund fee. One live quote showed `refundFee` 105,921 lamports. No real refund
  has run, so this is not verified.
- **An inactive address.** The live quote of 2026-11-01 had `timeWhenInactive` 72 hours after the
  deadline of the request. A deposit after that time can be lost.
- **The only hard stop** is to advance the nonce account. The intent S5 (`cancelIntent` of
  `web/sol/plain/intent.js`) exists, but no flow proposes it yet (C6). A cancel also needs t
  approvals. Until C6 exists, the window between the deadline and the inactive time (about 66
  hours after the 6 hours) protects a late send with a refund, and after it only a new send on
  the same nonce account protects the group.

## 6. The rent of the group address

- The fee key of the proposing device pays the fee. The group pays only the amount.
- After the send, the group address holds 0 or at least 650,240 lamports (the rent minimum of an
  account with no data, `RENT_ZERO`). The checker refuses other sends (`PlainRentGroup`).
- The deposit address is a new account, so it must get at least 650,240 lamports
  (`PlainRentRecipient`). The 1Click minimum (17,272,134 lamports on 2026-11-01) is far above it.
- The checker refuses a recipient that is not an Ed25519 key (`PlainRecipientCurve`). The deposit
  address of the live quote of 2026-11-01 is on the curve. A deposit address off the curve stops
  the proposal before any signature.
- The page checks the rent rule of the group before it asks for a deposit address, and says the
  amount that would stay.

## 7. Privacy

- NEAR Intents links the plain Solana address of the group to the ZEC address of the wallet. The
  status of a swap names both addresses to anyone who knows the deposit address.
- Solana observers see the send: the group address, the deposit address, the amount, the fee
  payer and the time.
- Helius (the RPC of the plain wallet) sees the reads and the send of each device, as for every
  plain send.
- Each device that reviews or approves the proposal makes the Worker ask NEAR Intents for the
  swap again. The Worker sees the IP address of that device.
- The group server stores the proposal and its `swap` field encrypted, as every wallet document.
  It sees the time of each write.

`PRIVACY.md` has these items in the section of the live swap from SOL to ZEC.

## 8. The page

- The review of SOL to ZEC asks where the SOL comes from: this wallet (with its approvals) or a
  Solana wallet outside Zigs. The second choice is the flow of today, unchanged.
- For this wallet, the review shows the payout address, the refund address (the plain Solana
  address of this wallet), the deadline rule and the privacy text, and asks for consent.
- The deposit screen shows the deposit, the exact amount in SOL and lamports, the deadline, the
  refund address, the payout and the quote id and signature. **Propose the payment** makes the
  plain proposal. Then the screen shows the state of the proposal (from the list of sends) and the
  state of the swap (from `/near/status`).
- The state of the swap is read every 60 seconds on this route, because approvals take hours. The
  Worker allows 60 NEAR Intents calls a minute for each IPv4 address or IPv6 /64.
- After a reload, the screen cannot show the swap again. The proposal stays in the Solana tab.

## 9. Tests

- `web/test/near-quote.mjs`: the new route asks for a swap from SOL with a 6-hour deadline,
  refuses less than 4 hours left, takes the same echo checks, and is off without `NEAR_LIVE`.
  `/near/swap` still sends 30 minutes.
- `web/test/swap-preview.mjs`: the provider path, the choice in the review, the refund address of
  the group, the proposal of the exact lamports with the `swap` field, the state of the proposal,
  and the check of the approving device.
- `web/test/sol-plain-*.mjs`: the signed `swap` field, the title, the refusal of a bad field, the
  check before an approval and the late send.

## 10. Live runs (each needs the owner's yes)

- **L0:** one live quote on `/near/swap-sol-group`, no deposit, and one `/near/status` read of its
  deposit address. It checks the 6-hour deadline, the inactive time and that the deposit address
  is on the curve.
- **Nonce account:** a Create nonce of the proposing device, when it has none. It costs the rent
  of a nonce account (1,056,640 lamports) and a fee, paid by the fee key.
- **L3, the funded run:** a group-paid swap of a small amount L (at least the 1Click minimum) from
  the plain wallet. The group keeps 0 or at least 650,240 lamports after it. The fee key pays the
  network fee. The payout is about L in ZEC at the quote, under the cap. The Zcash scanner reads
  Ironwood outputs only, so a payout as an Orchard output may not show before NU7 (about
  2026-11-06 02:00 UTC).

## 11. Open items

- C6: a flow that advances the nonce of a signed swap deposit after its deadline.
- The quote signature check (also open for the other routes).
- A deposit screen that comes back after a reload, from the `swap` field of the proposal.
- The iPhone and Mac apps have no plain Solana wallet, so they do not approve this send.
