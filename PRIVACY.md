# Zigs privacy model

Zigs is a shared wallet for shielded Zcash. This document states what each party can learn, what
Zigs does about it, and what it does not protect. If you find a leak that is not listed here, it
is a bug: please report it.

## Summary

- On chain, a Zigs payment has the shape of a payment from the standard Zcash wallet library: the
  same builder, padding, fee rule and anchor. Its expiry differs: up to one day after the
  proposal, where the library sets about 50 minutes. So the expiry can mark a Zigs payment, and so can a
  priority fee when the proposer chooses one ([On chain](#on-chain)). The signature does not show
  that a group signed, who the signers are, or which of them approved.
- The group server relays and stores encrypted data. It cannot read wallet names, signer names,
  addresses, amounts, notes, recipients or transactions. It does see who connects, to which
  wallet, and when.
- The light-wallet server sees your IP address and the blocks you download, as it does for every
  light wallet. On testnet, the app Worker relays the calls to the Zigs server, so that server
  sees the Worker and not your IP address. It never receives a key. If a person turns on memo
  reading in a browser, the app also fetches the full transaction of each payment to the wallet.
  The server then learns which transactions that browser reads. Memo reading is off by default.
  While a wallet is open in a visible tab, the app also asks the server for its whole Ironwood
  mempool every 30 seconds. The server sees the time of each call, not which payment is yours.
- A memo on a payment is readable by its recipient and by every signer of the sending wallet.
  Every signer of the receiving wallet reads the memos that arrive there.
- A testnet wallet that uses the Solana beta (web app only) also talks to the Helius Devnet host.
  Helius runs the RPC, the indexer and the prover. It sees more than the light-wallet server does:
  it sees the amounts and recipients of each spend, because it builds the proof. Read
  [Solana beta](#solana-beta-helius-devnet) before you use it.
- A mainnet wallet that has the plain Solana part (web app only; the server turns it on, and only
  staging has it on)
  reads its balances through the Helius mainnet host. That part has no pool and no privacy: every
  balance and payment is public on chain. Helius sees your IP address and the group address, and
  the explorer sees the address that it opens. Read
  [Solana mainnet plain wallet](#solana-mainnet-plain-wallet).
- The personal account (web app only) sends and reads messages on chain. A message is the memo of
  a shielded transaction. The account, its contacts and its messages never reach the group
  server. The light-wallet server sees the transactions that the account fetches and sends, and
  your IP address.
- A testnet payment to a ZNS name (web app only), such as `alice.zec`, looks the name up on the
  device, in a copy of the whole name registry that the app Worker downloads. No
  server learns which name you pay. The registry itself is public: anyone can see which address a
  name gives. Read [ZNS names](#zns-names-testnet).
- The Swap page shows live prices from NEAR Intents on mainnet (dry quotes, web app only). The app
  Worker asks for each quote. It sends the pair, the amount and the slippage, with sample addresses
  and no address of yours. NEAR Intents sees the Worker and not your IP address. A server with
  live swaps (staging only) also runs a real swap from SOL to ZEC: it sends the amount, the ZEC
  address of the wallet and your refund address. Read [Swap quotes](#swap-quotes-near-intents)
  and [Live swap from SOL to ZEC](#live-swap-from-sol-to-zec-staging-only).
- The Overview of a mainnet wallet (web app only) shows a USD total. It asks for the price of a
  fixed 1 ZEC from NEAR Intents, through the same route, about every 5 minutes while it shows, and
  at most once a minute after a failed call. The call holds no balance and no address. NEAR
  Intents sees the time of the call. The Worker sees the time and your IP address, not the
  balance. A testnet wallet asks nothing. Read [Swap quotes](#swap-quotes-near-intents).

## On chain

A payment is an Ironwood (v6) transaction with re-randomized FROST signatures (ZIP 312). The group
key is re-randomized for each spend, so the signature verifies like a single-signer RedPallas
signature under a fresh key.

The transaction shape matches the standard wallet library (`zcash_client_backend`), which Zodl
uses, except for the expiry and, when the proposer chooses it, the fee. We checked each visible
property:

| Property | Zigs | Standard wallet library |
|---|---|---|
| Transaction builder | `zcash_primitives` `Builder` | Same builder |
| Expiry | One day after the target height (3,456 blocks at 25 seconds, 1,152 at 75 seconds), at most up to the next network upgrade | Target height + 40, or + 120 from NU7: about 50 minutes (`default_tx_expiry_delta`) |
| Action padding | `BundlePadding::DEFAULT` | Same default |
| Fee | ZIP 317 standard rule, or 10 times it when the proposer chooses a priority fee | ZIP 317 standard rule |
| Anchor | Target height − 3 (3 confirmations) | Same (`ConfirmationsPolicy` trusted = 3) |
| Change | One note to the wallet's internal address | Same |
| Memos | Empty unless a signer writes one for a recipient | Empty unless the user writes one |
| Transparent parts | None for a shielded payment. A payment to a transparent address has one transparent output for it, and no transparent input | Same |
| Several recipients | One output per recipient, plus change | Same for a multi-recipient payment (ZIP 321) |

The code is `build_ironwood_pczt` and `spend_pczt` in `wasm/src`.

The long expiry marks a Zigs payment on chain. The expiry height is public, so an observer who
compares it with the height of the block that holds the payment sees a window of about a day,
where other wallets leave about 50 minutes. A group needs hours for its approvals, and the signatures
cover the expiry, so the window cannot be shorter. A priority fee is public too, and few wallets
pay one. Messages of the personal account keep the expiry and the fee of the standard library.

The number of actions is visible on chain, as for every Zcash transaction: it is the larger of
the inputs and the outputs, at least 2. A payment to 4 recipients has at least 5 actions, so it
shows that it is a larger payment, but not who or how much.

A payment to a transparent address (`t1` or `t3`, on testnet `tm` or `t2`) is public in part. The
chain shows that address and its amount to everyone, and the output takes no memo. The spent notes,
the change and the shielded recipients stay shielded. Send says this under the address. Zigs pays
no TEX address (ZIP 320): a TEX address takes funds from transparent addresses only, and Zigs
pays from the shielded pool. A transparent output adds one action to the ZIP 317 fee.

A version 3 wallet also has a transparent address of the group (`t3`, on testnet `t2`): a P2SH
multisig address (ZIP 48) that needs the signatures of t of the n devices. Each device derives
its secp256k1 key from its own key share and publishes the public key as a signed document, so
the group server sees that the wallet has such keys, but not the keys: the documents are
encrypted like the others. This address is public. The chain shows its balance and every payment
to it to everyone, and all payments to it link to one another. A swap from ZEC sends its refund
there. Receive shows it below the shielded address and says that it is public. Zigs cannot move
funds from this address yet.

## Group server (Cloudflare Worker and Durable Objects)

Every field of every wallet document is encrypted on the device with XChaCha20-Poly1305. The key
comes from the wallet secret in the invite link, which the server never receives. The document
path and field name are bound into each ciphertext, so the server cannot move a value elsewhere.

Values are padded before encryption to at least 64 bytes and then to the next power of two. The
server cannot tell a 0.005 ZEC payment from a 50 ZEC one, or a short note from a long one.

What the server can still see:

| Visible | Why | Mitigation |
|---|---|---|
| Wallet ids, document paths and field names | The store routes and merges by path and field | None yet. Field names show the step a payment is at (proposed, signed, sent). |
| Timing of every write | Writes happen when people act | None |
| Which IP addresses connect to which wallet | Each wallet has its own connection | Use Tor Browser, or a VPN, to hide your IP address |
| Number of signers and payments | Count of documents | None |
| When each device saves or checks a backup file, and whether it did | In a version 3 wallet each device publishes the document `setupstatus/<i>`: the safety number and four yes-or-no fields (`zecSaved`, `solSaved`, `zecChecked`, `solChecked`). The server sees its path, field names, padded size and the time of each write. A holder of the invite link can read it and can replace it, which can hide the backup progress of that device in the setup display, because devices ignore a document without a valid signature. | None. The document holds no file, key or hash. |
| Anyone who knows a wallet id, without its secret, can connect with it. Then that client gets the documents that the server stores for that wallet: each sealed document with its path, field names and padded size, then each new write as it happens. It can also write or replace documents of that wallet. It does not get the IP addresses or the connections of others | The server does not ask for the wallet secret. It checks the form of the id and its limits on connections and writes. Staging has a password gate, and app.zigs.app has none. Then it sends the stored documents and each later write to that connection, and takes its writes (`groupSocket` and `Store` in `cf/src/index.js`). A wallet id is in the old wallet of a move, and the address bar and the browser history hold the id of an open wallet (`#<id>`). A direct chat is a store of the same kind, and its id (`#c.<id>`) is in the address bar too | The values stay sealed under the wallet secret, which the server never receives. So such a client cannot read them or seal new ones, but it can write back an old value that it saw. The timing, the counts and the availability stay exposed: a replaced document stops the wallet (a denial of service) |
| The id of each wallet's message room, when each message is sent, how many messages, their padded sizes, and which IP addresses connect to the room | A room is one more namespace with its own connection, and each message is one document | Use Tor Browser, or a VPN, to hide your IP address. Message text, thread and sender stay sealed. |
| The id of each direct chat, its two member ids, when each message is sent, how many messages, their padded sizes, and which IP addresses connect to the chat | A chat is a namespace like a room. The server learns that two member ids talk to each other. | Use Tor Browser, or a VPN, to hide your IP address. Names, message text and signing keys stay sealed. The chat lives in the browser and is not in key share backups. |
| Nothing more for a payment request | A request is the text of a message, so it is sealed like any message. The page reads it on the device and contacts no server for it. | None needed |
| Nothing for the personal account and its messages | The account, its contacts and its on-chain messages never touch the group server. | None needed |

The server keeps no logs: Workers Logs are off (`observability.enabled = false`), and the code
writes nothing about requests. The `/zns` route is the exception. When it cannot read the name
registry, it writes a fixed cause, such as `zns: status`. When a refresh leaves out records of
the registry, it writes `zns: left out` once. These lines hold nothing about the request and no
text of the resolver. IP addresses are used in memory only: to apply rate limits, and as a tag
on each open WebSocket. The limits count each IPv4 address, or each /64 network of IPv6
addresses, because one IPv6 user usually holds a whole /64. So users who share an IPv4 address or
a /64 (one home, one office, one VPN exit) also share a counter, and one of them can use up the
limit of the others.
Cloudflare, as the host, can see connection metadata.
On staging, the password gate sets one first-party session cookie, `zigs_session`, for 7 days. It
holds no personal data: only an expiry and a signature from a key of the preview password.
app.zigs.app has no password gate and sets no `zigs_session` cookie.

## Light-wallet server (lightwalletd)

The app downloads compact blocks and finds the wallet's notes on the device. The server sees:

- your IP address and the time of each request (on testnet, our server sees the app Worker, see
  below);
- the wallet's birthday height (the first sync asks for the tree state there);
- the transactions you send, and from which IP address (on testnet, our server sees the app
  Worker);
- the full transactions you fetch to read memos (`GetTransaction`), with your IP address (on
  testnet, our server sees the app Worker). The app
  fetches them only where memo reading is on. It is off by default, for each wallet and each
  browser, until a signer turns it on.

- the whole Ironwood mempool (`GetMempoolTx`), with your IP address (on testnet, our server sees
  the app Worker), while a wallet or the personal account is open in a visible tab. The page asks
  after each finished sync and every 30 seconds, and stops when the wallet closes or the tab
  hides. Each call asks for every transaction in the mempool, the same for every wallet. The page
  reads at most 1,000 transactions and 20,000 Ironwood actions of the answer and stops at the
  first limit. It opens the notes on the device, one transaction at a time, and keeps only the
  notes that open with your viewing key. A call that takes 20 seconds counts as failed, but its
  stream can stay open, so the server can see two calls of the same wallet at once. So the
  server sees the time of each call and that this IP address has a wallet open, not which payment
  is yours. The page shows a payment that it finds this way as "Not in a block yet" and never
  counts it in the balance;
- for the personal account, the full transaction of every payment to it, always. A message to
  the account is a memo, and a memo is only in the full transaction. The memo switch of wallets
  does not apply. The server also sees the transaction that carries each message that the account
  sends, and the moment it is sent. The server does not see the text of any message, because the
  text is encrypted for the recipient.
- the transparent address of the group (`GetAddressUtxos`), with your IP address (on testnet,
  our server sees the app Worker), the first time Receive shows it after the wallet opens. The
  page asks for that one address
  and reads at most 100 of its unspent outputs. So the server can link this IP address to the
  group's transparent address and to its balance.

While it serves blocks, it does not learn which notes or outputs are yours: every wallet
downloads the same blocks. The fetch for a memo is the exception. The app asks for a transaction
only after it found a note of the wallet in it. So the server can tell that this IP address is
interested in that transaction, and that the transaction pays the wallet. The server cannot read
the transaction, because it is encrypted. It sees the same public parts as every observer of the
chain. The app keeps the memo in the saved wallet state. It asks again after a failure. To avoid
this leak, leave memo reading off. The page cannot use a light-wallet server of your own.

If one operator runs both the group server and the light-wallet server, they can match the moment
a wallet marks a payment as sent with the transaction that reaches the network at that moment.
This links a wallet id to a transaction id, but not to its amount or recipient.

- **Mainnet** wallets use ChainSafe's public light-wallet server, so the two servers have
  different operators. The page asks ChainSafe directly, so ChainSafe sees your IP address.
- **Testnet** wallets use the Zigs light-wallet server first, with ChainSafe as the backup. The
  page calls the Zigs server through the app Worker (`/lwd`), and its public side answers the
  Worker only. So our node sees each request from the Worker, not from your
  device, and it does not see your IP address. The Worker sees your IP address and the requests,
  as it does for the page and the group server. It keeps no log and sends no header of yours to the
  node. Envoy also removes the visitor headers of Cloudflare before lightwalletd. Cloudflare sees
  the same traffic as before, because the node was behind Cloudflare too. Devices on the owner's
  tailnet can also call the node directly: it then sees their tailnet address. The Worker also
  limits `/lwd` to 600 calls a minute for each IPv4 address or IPv6 /64 (`LWD_PER_IP`, counted per
  Cloudflare location), which uses the IP address in memory only. A first sync runs at about 70 to
  90 calls a minute on a fast computer (measured), and an open wallet then makes about 6 a minute,
  3 of them for the mempool. Each open wallet makes these calls on its own: the group wallet and
  the personal account can call at the same time, so both together make about twice as many.
  So the limit slows a stranger who uses our node through `/lwd`, but it does not stop one: a
  stranger can sync a wallet under it. Since 27 October 2026 app.zigs.app asks no password, so
  this limit is the only guard against a stranger there. Staging keeps its password.
  The ChainSafe backup still sees your IP address. A page over the limit also turns to ChainSafe,
  which then sees your IP address and, with memos on, which transactions you read. The iPhone and
  Mac apps still call `lwd.zigs.app` directly, which refuses them, so they use ChainSafe for testnet
  until APP-3 is done.

Tor Browser hides your IP address from both servers, but not this timing link. To remove the
link, point the app at a light-wallet server you trust (`NETWORKS` in `web/app-chain.js`,
`ZcashNetwork` in `ios/Zigs/Chain.swift`).

The **faucet** links of Receive and of the Overview of an empty wallet open the Valar testnet
faucet (faucet.testnet.valargroup.dev) in a new tab. That site is not Zigs. It sees your IP address and the address that you paste, so it can
link the two. Its public status lists each payout with a short form of the address, the
transaction id, the amount and the time. It pays once for each IP address and once for each
address every 24 hours.

Explorer links open a site that is not Zigs, in a new tab. That site sees your IP address and the
id that you open, and the time, so it can link them. The page sends no referrer.

- **Zcash:** the link **View in explorer**, in the payment panel and on each row of the activity
  list, opens testnet.zecblock.com (zecblock.com for a mainnet wallet) with the transaction id.
- **Solana:** the Solana explorer (explorer.solana.com) on Devnet sees the same when you open the
  id of a transaction or an account there. The Solana tab links to it from the Add SOL line, the
  result of a proposal, the proposal account and the cancels of old proposals (S16 of
  [docs/hackathon-release.md](docs/hackathon-release.md)). A line next to these links says so.
- **Zcash, the other links:** the ids of an expired payment in the payment panel, **View payment**
  on a memo in Messages, and **View transaction** in a chat of the personal account open the same
  Zcash explorer with the transaction id. The web app says what the explorer sees next to each
  Zcash link, or under the list that holds it. It says what the faucet sees next to each faucet
  link (Zcash and Solana).

## ZNS names (testnet)

**Status:** done (M10 of [docs/hackathon-release.md](docs/hackathon-release.md)). The Send form
takes a name and looks it up on the device (`web/zns.js`), in the copy that `/zns` serves. An
approving web app checks the name again. A live testnet payment to a name landed on 19 October
2026.

On testnet, the Send form of the web app accepts a ZNS name in place of an address: `alice`,
`alice.zec` or `alice.zcash`. ZNS is the naming service of Zcash Names (zcashnames.com), which
ZcashMe, Inc. runs. Its registry is on chain and public. Anyone can read every name, the address
that it gives and the history of both.

How the app reads the registry:

- The route `/zns` of the app Worker downloads the list of all names of the testnet registry from
  the public resolver `light.zcash.me`. It sends no header of yours to the resolver. It checks
  that the resolver states the published key of the registry. That shows which registry the
  resolver reads, but it does not prove the records. The Worker leaves out a name with a record
  that fails its checks, and a name that comes with two addresses, so that name gives "not
  found". It serves a copy that is at most 60 seconds old.
- The page downloads that copy (on staging, behind the same password as every other request)
  and finds the name on the device. It never asks a server about one name.

| Party | What it learns |
|---|---|
| ZNS resolver (`light.zcash.me`) | That the app Worker downloads the registry, and when. Not your IP address and not a name |
| App Worker | Your IP address and when your page downloads the registry. Not the name that you type |
| Group server | Nothing new. The name is one more field of the sealed proposal |
| Other signers of the wallet | The name and the address in the proposal, as for every recipient |
| Chain observers | A shielded payment with the shape of a payment from a standard wallet, except for its one-day expiry and an optional priority fee, which can mark it as a Zigs payment. Nothing shows that a name was used |

The timing of a download can still tell the Worker something:

- The page downloads the registry when a testnet wallet opens. It downloads it again when a copy
  older than 60 seconds must check a name: when you type a name, before a proposal, and before an
  approval.
- The Worker sees each download and its IP address. As the group server, it also sees which IP
  addresses open which wallet.
- So a download near a proposal or an approval can tell the Worker that a wallet may pay a name.
  When the registry holds few names, that can point to the payee.

What the app trusts, and what it checks:

- The address comes from the registry. One registrar, the ZNS Mint, writes the registry. The app
  checks the key that the resolver states, not each record on chain.
- The page trusts the app Worker for the registry, as it trusts it for the code of the page. A
  false Worker could send a false registry to the devices of one wallet. The approvers read the
  same copy, so their check would not see it. They still see the address, and the payment goes
  only to the address that they approve.
- A name can move to another address. The proposer sees the address that the name gives, and a
  note when the name changed recently. The form pays only the address that it showed: when the
  name gives another address at the proposal, the form refuses and shows the new address. Each
  approving web app looks the name up again, in its own copy, and refuses the approval when the
  name now gives another address than the payment. The iPhone and Mac apps show the address and do
  not check the name.
- "Propose again" after an expired payment keeps the name and the address of the first proposal,
  so the approvers check the name again.
- The page uses its copy for at most 60 seconds, so the copy is at most about 2 minutes behind
  the resolver. The resolver can fall behind the chain too. So the page refuses a registry that is
  more than 10 blocks below the chain height of the wallet.
- A Zigs wallet gets no name of its own. Under ZNS, anyone who can read the memos of an address
  can change the name of that address. Every signer of a wallet can read its memos
  ([docs/zns-spike.md](docs/zns-spike.md), section 3.3).
- Mainnet wallets do not look up names.
- zcashnames.co is another registry, with names that look the same. The app reads only the ZNS
  registry of zcashnames.com.

## Swap quotes (NEAR Intents)

**Status:** live quotes. The Swap page of the web app shows prices from NEAR Intents (the 1Click
API). The Overview of a mainnet wallet also uses one such quote, of a fixed 1 ZEC, to show a USD
total. A quote moves no funds and makes no deposit address. A server with live swaps (the var
`NEAR_LIVE`, on staging only) also runs a real swap from SOL to ZEC: read
[Live swap from SOL to ZEC](#live-swap-from-sol-to-zec-staging-only).

How a quote works:

- The page posts the pair (ZEC, SOL or USDC on Solana), the amount and the slippage to
  `/near/quote` of the app Worker. The page never calls NEAR Intents itself.
- The Worker builds a dry quote request (`"dry": true`) for NEAR Intents. A dry quote makes no
  deposit address and no state. The request holds two fixed sample addresses: a public Zcash test
  vector and a public Solana program id. They are not addresses of yours.
- The Worker sends a content type and an accept header only, and the partner key of Zigs
  (`X-API-Key`) when the server has one. It sends no cookie, no IP address and no user agent of
  yours. It checks the answer, keeps seven fields, and answers with `Cache-Control: no-store`. It
  stores nothing and writes no log.
- The Worker limits `/near/quote`, `/near/swap` and `/near/status` together to 60 calls a minute
  for each IPv4 address or IPv6 /64 (`NEAR_PER_IP`, counted per Cloudflare location). It uses the IP address in memory only.
- The Overview of a mainnet wallet asks for the price of 1 ZEC through the same route. It posts
  exactly 1 ZEC (100,000,000 zatoshi) to USDC with the slippage 50. The amount is fixed: it never
  depends on your balance. The page multiplies the price by the ZEC total of the wallet, on the
  device, and counts 1 USDC as 1 USD. It asks when the Overview shows and no price on the page is
  younger than 5 minutes. It runs one call at a time and waits at least 60 seconds after a failed
  call. A call with no answer in 15 seconds counts as failed. A hidden tab asks nothing, and a
  testnet wallet asks nothing. The price stays in memory only, for at most 1 hour: the page stores
  it nowhere.

| Party | What it learns |
|---|---|
| NEAR Intents (`1click.chaindefuser.com`) | The pair, the amount, the slippage and the time of each quote, and the sample addresses. It sees the Worker, not your IP address. It cannot link a quote to a wallet or to you. For the Overview, the pair and the amount are always 1 ZEC to USDC: it learns only the time |
| App Worker | Your IP address, and the pair, the amount and the slippage of each quote. It keeps no log. For the Overview, it learns your IP address and the time, and the fixed 1 ZEC to USDC ask |
| Cloudflare | Connection data, as for every request to the app |
| Group server, light-wallet server | Nothing |
| Chain observers | Nothing: no transaction exists |

What stays visible:

- The Swap page asks for a quote when you stop typing, and again when you change the pair or the
  slippage. So the Worker and NEAR Intents see each amount that you pause on.
- The Swap page clears a quote older than 60 seconds. It asks for a new quote only after
  an action of yours: when you type, change the pair or the slippage, press **Refresh quote**, or
  leave the simulation with **Back to swap**.
- A real swap from ZEC would leave the shielded pool. NEAR Intents takes ZEC only at a transparent
  deposit address, which is public. NEAR Intents accepts a shielded address as the recipient of a
  swap to ZEC, but no real swap has tested this. The page says this next to the quote.
- The basis of the shielded claim: a live dry quote accepted an Orchard-only unified address as
  recipient, and the Zodl wallet pays swaps to shielded addresses. A dry quote only checks the
  address, so no payout was made. The chain-support page of NEAR Intents still lists Zcash as
  "Partially supported - Transparent addresses only". Treat the shielded claim as unproven until
  a real swap pays to such an address.
- An open Overview of a mainnet wallet asks about once every 5 minutes, and at most once a minute
  while calls fail. It asks with no action of yours. So the Worker and NEAR Intents see the times
  at which someone has a mainnet wallet open in the web app. They do not see the balance, the
  wallet or the address.
- The USD total of the Overview is the price of a NEAR Intents quote for 1 ZEC, times your ZEC
  total. The quote includes the fees and the spread of NEAR Intents. It is not a market rate, and a
  swap can give another amount. The page shows the age of the price. Only ZEC counts in the total.
- NEAR Intents is a third party with its own terms. The prices are mainnet prices, and they can
  change within seconds.

## Live swap from SOL to ZEC (staging only)

**Status:** live on staging.zigs.app only (`NEAR_LIVE` is "1" there and "0" in production). You
pay SOL from a Solana wallet outside Zigs to a deposit address of NEAR Intents. NEAR Intents pays
ZEC to the address of the open mainnet wallet. Zigs signs nothing and holds no SOL. **The payout
to a shielded address is untested:** no real swap has paid one yet. The page says this next to
the deposit address.

How a live swap works:

- The review asks for your refund address: the Solana address that you pay from. The page posts
  the amount, the slippage, the ZEC address of the wallet and the refund address to `/near/swap`
  of the app Worker.
- The Worker builds a live quote request (`"dry": false`) from SOL to ZEC with these two addresses
  and a deadline 30 minutes later. It never puts a sample address in a live request. It checks
  that the answer repeats both addresses, the amount and the assets, and that the deposit address
  is a Solana address with no memo. The deadline is the earlier of the deadline of the deposit
  address and the refund time of the request, and it must be at least 5 minutes away. The Worker
  answers with the deposit address, the amounts, the deadline, the two addresses, the quote id
  and the quote signature.
- The deposit screen shows the deposit address, the exact amount, the deadline, the refund
  address, the payout address, the quote id and the quote signature. It stays in memory only: after a reload the page
  cannot show the swap again, but the swap goes on.
- While the screen shows, the page reads `/near/status` every 10 seconds (up to 60 seconds after
  errors and after the deadline) until the state is final. The Worker passes only the state, its
  time, the transaction hashes, the amounts and the refund reason. It drops the explorer links of NEAR Intents.
- The page refuses a payout that would take the wallet over the warning level of unaudited
  mainnet wallets (0.5 ZEC).

| Party | What it learns |
|---|---|
| NEAR Intents (`1click.chaindefuser.com`) | The amount, the ZEC address of the wallet and your refund address, linked to the deposit address. It screens the addresses (its terms) and can keep them. It sees the Worker, not your IP address |
| App Worker | Your IP address, the amount and both addresses. It keeps no log |
| Solana observers | Your payment: the refund address, the deposit address, the amount and the time |
| Zcash observers | The payout to the wallet. NEAR Intents lists Zcash with transparent addresses only, and a shielded payout is untested: the payout can be public |
| Group server, light-wallet server | Nothing |

What stays visible:

- NEAR Intents links your Solana address to the ZEC address of the wallet.
- A failed swap sends the SOL back to the refund address after the deadline. NEAR Intents has no
  duty to refund a deposit that it cannot process (its terms).

## Solana beta (Helius Devnet)

A testnet wallet in the web app can also hold private SOL on Devnet, in Zolana, the Helius
shielded pool on Solana ([ZOLANA.md](ZOLANA.md)). It is a beta. The Zcash part of the wallet stays
as it is above. A mainnet wallet never loads this code and never connects to the Helius Devnet host.
A mainnet wallet with the plain Solana part is described in
[Solana mainnet plain wallet](#solana-mainnet-plain-wallet).

The Solana code runs in a Worker of its own, `/sol/worker.js`. Only the Solana Worker scripts
(`/sol/worker.js` and `/sol/plain/worker.js`) carry a policy that names a Helius host. The policy
of the page names none. The Helius URL holds an
API key. The server gives it to the page at `/sol/config.json` (on staging, behind the same
password as every other request). So every user of the page can read it. Allowed Domains at
Helius limits its use by other sites, but it does not protect the key.

Each seat has a **fee address**: an Ed25519 key that the device derives from the Solana key share of
that seat. It pays the fees and the rents of the proposals that the seat makes, and the fee of each
payment that the seat executes, so the group key never pays. The chain shows it as the first
account of each such transaction, next to the program address of the group. It has a public SOL
funding trail, and it links that member to the group. The seat publishes
it in a signed document on the group server, and every signer of the wallet can read it. The page
stores no fee key: it derives the key again from the key share, so the Solana backup file restores
it. The key never goes to Helius. Any `t` signers together can rebuild the key share of a seat, so
they could also spend the SOL on that seat's fee address. Keep only the SOL for fees there.

The link **Get Devnet SOL** opens the Solana faucet (faucet.solana.com) in a new tab. That site is
not Zigs. It sees your IP address and the fee address that you paste, so it can link the two.

**Add SOL** moves SOL from the fee address of your device into the shielded balance of the group.
It is a pool deposit that only your device signs, with no approval from the other devices. The
amount and the sender (your fee address) are public on chain.

**Payments through the approvals program.** The funds of the group belong to an address of the
Zigs approvals program, a program-derived address (PDA) of the group key. A payment has three
public steps. The proposing seat creates a **proposal account**. Until the execute it shows the
commitment of the payment, the group key, the expiry and the fee address of that seat, and the
create transaction keeps these values in the chain history after the execute. Then the
seats sign an approval, off chain. Then a seat executes: the transaction shows the approval (the
group key, a digest and the group signature), the PDA as the owner, and the fee address of the
executing seat as payer. So the chain links the group key, the PDA and the fee addresses in
public, and shows when a payment waits. A private payment hides its amount, but the owner key of
the payee is public. A withdrawal shows its recipient and its amount. The program has an
upgrade key. With it, someone could replace the program and sign for the PDA of every group. A
spend also needs a proof, so a seat or the hosted prover would have to help (ZOLANA.md 7.2).

The beta funds of a group that existed before the program move once to the PDA, with a last
payment of the group key. That payment links the old address and the PDA in public.

Zolana is not Zcash. This table says what differs:

| Property | Zcash (the wallet above) | Solana beta (Zolana Default Ring) |
|---|---|---|
| Amount and asset | Hidden | Hidden on chain in a transfer. Public in a deposit and in a withdrawal |
| Sender and recipient | Hidden | Public: the payer (a member fee address) and the owner signer (the PDA of the group) are in the transaction, and the owner key tags each output. The proposal account and the approval show the group key |
| Link between spends and the group | None: each spend has a new key | The PDA and the group key are stable tags. A FROST signature does not show a multisig |
| Who sees the witness | Nobody: the proof runs on the device | The hosted prover of Helius: owners, assets, amounts, blindings and the nullifier secret. With local proving on (below), nobody: the proof runs on the device |
| What the index learns | IP address and blocks | The owner key (tag queries), IP address, timing, Merkle proofs of the inputs, and the app origin |
| What the group server can link | Nothing that it can match to the chain | The time of its Solana writes matches chain time. That links a wallet id to the owner key and the full history |
| Custody | Fewer than `t` seats cannot spend | The same for the seats. The pool upgrade key can replace the pool, and the protocol authority can pause trees |

What Helius sees: your IP address, the origin of the app, the owner keys of the wallet (the PDA
and the group key), the fee addresses of the seats of this browser, and the witness of each
spend. It can read the whole Solana history of the wallet. It cannot spend, because a spend needs
the group signature. It sees no key share. Every signer of the wallet reads the whole Solana
history too.

**Local proving.** A group can make its proofs on its own devices. One seat turns it on for the
whole group, after its device made a test proof, and nobody can turn it off. With it on, the
devices of the group do not send proofs to the hosted prover of Helius, so Helius no longer gets
the witness of a spend: the amounts, the blindings and the nullifier secret that links each spend
to its notes. A device that cannot prove shows an error and sends nothing; it never falls back to
the hosted prover. What stays visible:

- The indexer of Helius still sees which notes a payment spends (the device asks it for their
  Merkle and non-inclusion proofs), the other queries of the wallet (the tags and nullifiers that
  it looks up) and your IP address. The owner key of the payee is public on chain, as without
  local proving.
- The key server of Helius (a CloudFront host) sees your IP address and the origin of the app when
  it sends a proving key, once per payment size and device. The name of the key gives the number
  of notes that the payment spends.
- Every hosted proof that the group made before the switch gave Helius the nullifier secret of
  the group. The setting protects new payments from then on, and helps most when it is on before
  the first payment.

Two gaps remain. A tab that opened before the version of Zigs with local proving does not ask
before it proves: reload every open tab of the group after the switch. A browser that never saw
the switch, or a seat restored from a backup made before it, learns the switch from the group
server, so a server that hides it could make that device prove on the hosted prover: make the
Solana backups again after the switch, so that they carry it.

Proofs on a device are slower (about 3 s for one note to about 15 s for eight on a fast laptop),
and the first use downloads about 5 MB plus 9 to 59 MB for each payment size. Phones are not
tested: a phone may be too slow or run out of memory.

Each Solana screen says what is public and what Helius sees:

- **The Solana tab, in each state** (also before Add Solana and while the setup runs): a deposit
  shows its sender and amount on chain, and a withdrawal its recipient and amount. A private payment
  hides its amount, but it shows the owner key of the payee. The program address, the group key and
  the fee address of each device that pays are public too. Helius sees that you use Zigs, your IP
  address and the keys of the wallet, and its hosted prover sees each payment (with local proving
  on: the group makes its proofs on its devices, so they give Helius neither the amounts nor the
  nullifier secret). The Zigs server operator can link the wallet to these addresses by timing.
- **Before Add Solana:** the program address links to the group key, a fee address needs a public
  SOL funding trail, and the program and its upgrade key are outside the group.
- **The details of the wallet:** the two keys of the pool outside the group (below).
- **The sync:** the page syncs with no click when Overview or the Solana tab opens, and after a
  payment or a deposit. Overview shows the SOL balance, so a wallet with a Solana part contacts
  Helius when it opens on Overview, before the Solana tab. Each sync shows Helius the keys of the
  wallet with your IP address, so Helius can list every note of the wallet.
- **The fund card:** the fee address appears on chain next to the group. The page asks Helius for
  the balance of each fee address of this browser with your IP address, with no click. It asks
  when Overview or the Solana tab opens, after a payment or Add SOL, and again when such a read
  failed. It also asks every 30 s while a signed payment waits for a device that can pay.
- **Add SOL:** the amount and the sender are public, and Helius sees your IP address with the
  deposit.
- **Pay from the group:** the rent and the fees, and what the hosted prover sees: the owner keys,
  the payee, the amount, the notes that the payment spends and the secret that links each spend
  to its notes. With local proving on, it says that the proofs of the group give Helius neither
  the amount, the blindings nor that secret, that each proof Helius made before the switch gave
  it the secret, and that its indexer still sees which notes the payment spends and your IP
  address. A private payment shows the owner key of the payee and hides the amount. The
  withdrawal form says that the recipient, the asset and the amount are public.
- **Local proving:** the card of the switch says what it hides and what stays visible, the time
  and the downloads, that phones are not tested, that it cannot be turned off, and that the tabs
  and the Solana backups of the group need a reload and a new backup after the switch.
- **The move of the beta funds:** it links the old address and the program address in public, and
  the hosted prover sees it (with local proving on, the devices make that proof).
- **The rent of old proposals:** the cancel shows the fee address, the proposal account and the
  rent. The search asks Helius for the proposals of the group key and of the fee addresses of
  this browser, with your IP address.
- **The approval screen** of a payment, a withdrawal, the move and the nonce account: what becomes
  public (for a payment, the owner key of the payee), the public link of the fee address that
  pays, and for each spend what the hosted prover sees. With local proving on, it says that the
  execute is proved on a device, and that Helius made the first proof only if the payment was
  proposed before the switch or from an older page.

The details screen also shows the two keys of the pool, as read from Devnet on 18 October 2026.
Both sit outside the group, and Zigs does not know who holds them:

- The upgrade key `2kgbLowvCQuMWxDKbHUZAURycziuRrvmtTuDEYMGMRsj` (in the ProgramData account of
  the pool). It is a signing key, not a program address; the chain does not show how many people
  hold it. It can replace the pool program.
- The protocol authority `263Kgjft9NezaYTspFquMbAhgRf7xfAiyusaweLowdXo` (in the protocol config
  account `2AJashtYixa5hkGpBcT9dUdUqqx6wvDWrJdtXqHqQXvE`). It is a program address, by the
  Zolana spec a 2-of-5 Squads account. It can pause the trees, and then no payment can move the
  funds. It can also set the fees of the pool and change its other authorities, but not the
  upgrade key. The fee authority is the same address.

The screen does not read these keys live, so a change of a key does not show there.

Tor Browser hides your IP address from Helius. It does not hide the timing link of the group
server. A person who reads "private" may expect Zcash privacy. The Solana part gives less.

## Solana mainnet plain wallet

A mainnet wallet in the web app can add a plain Solana account ([ZOLANA.md](ZOLANA.md) 3.8 to
3.10). It holds real SOL and USDC. It has no pool, no hosted prover and no privacy. The code is not
audited. The page can receive. It can also create a nonce account and enable USDC, which the fee
address of one device pays. It cannot send SOL or USDC from the group address yet, so a deposit
stays in the wallet until send comes. The server serves the part only when the variable
`SOL_MAINNET` is `"1"`. It is `"1"` on staging and `"0"` on production.

The group address and its USDC account are normal Solana accounts. Everyone can read every balance
and every payment of them on chain and can link them to the group. Do not read Zcash privacy into
this part. The Solana tab says "Public" for this reason.

| Party | Sees | Does not see |
|---|---|---|
| Helius mainnet host, `https://mainnet.helius-rpc.com` | Your IP address, the app origin, and the addresses that the page reads: the group address, its USDC account and the published fee addresses, with the time of each read | Any key share, the Ed25519 seed. It cannot sign |
| The explorer, `explorer.solana.com` | Only when you press Open in explorer: the address in the link and your IP address | Anything else of the wallet |
| Cloudflare, the host of the app | The connection data of every call, also of the call for `/sol/config-mainnet.json`. Its Worker holds the Helius URL (`HELIUS_MAINNET_URL`) | Any key share |
| Zigs server operator | The time of the Solana writes of the wallet and the time of each call for the config. By timing, it can link the wallet to these addresses, as in the Solana beta | Any key share |
| Chain observers | Every balance and payment of the group address, and the fee address that pays a fee | Which devices signed |

The page reads the SOL of the group address, the USDC of its token account and the SOL of each
published fee address. A visible tab reads at most once in 30 s. A hidden tab reads nothing. Each
device pays fees from its own fee address, and funding that address links the device to this wallet
on chain. Create nonce and Enable USDC put the fee address of the device and the group address in
one transaction, so the chain links them. The explorer link opens `https://explorer.solana.com/address/` and the address, in a new
tab, with no cluster parameter.

The Helius URL holds an API key. It is a secret of the Worker (`HELIUS_MAINNET_URL`). The server
gives it to the page at `/sol/config-mainnet.json`, so every user of the page can read it. Allowed
Domains at Helius limits its use by other sites, but it does not protect the key. The page does not
store, log or show the URL.

Four controls keep this part apart from the pool:

1. The label `mainnet-plain`. The page derives it from the network that the people of the wallet
   confirmed (`web/sol/wallet.js`). The start document, the backup file and the saved-file check
   carry it.
2. The Worker guard and policy. The page names the cluster of the wallet, and `init` takes only the
   Helius host of that cluster. `web/sol/plain/guard.js` checks each command and pins `init` to that
   host, and the controller checks that the answer names the cluster. The server gives
   `/sol/plain/*` its own policy, which names the Helius Devnet and mainnet hosts, and the page
   starts the Worker only when the header equals it.
3. The drift abort. A seat part with another label stops (`driftOf` in `web/sol/ceremony.js`).
4. The restore check. A restore refuses a file of another label, and a key share that does not fit
   the published key (`web/sol/backup.js`).

## Use Zigs over Tor

The web app is prepared to run in Tor Browser, so that neither server sees your IP address. A
wallet with a Solana part (the Devnet pool on testnet, the plain account on mainnet) adds a third
host, Helius. A full session in Tor Browser has not been
tested yet.

The app has no Tor connection of its own. The "Tor demo" in the app (the pill "Tor · Demo" and
Settings) is a demo: it routes no traffic and leaves your connection unchanged.

1. Set the security level to **Standard**. The Safer and Safest levels turn off WebAssembly, and
   Zigs needs it for its cryptography. The app says so if it is off.
2. Tor Browser deletes all site data when it closes, including your key share. After the wallet
   is created, click **Back up key share** in the yellow note and choose a passphrase. At the start
   of each session, click **Recover access** and enter the passphrase. Keep the file and the
   passphrase apart ([how backups work](#key-share-backups)).
3. Finish each approval in one session. If Tor Browser closes between your approval and the group
   signature, the approval is lost. The payment shows this, and someone proposes it again.

What makes this safe to rely on:

- The page sends a Content-Security-Policy header. The browser lets it connect only to the group
  server and the light-wallet servers in `NETWORKS` (our testnet server through `/lwd` of its own
  host, and two ChainSafe servers), and to nothing else. The name registry also comes from its
  own host, through `/zns`, and the Swap quotes and the Overview price come through `/near/quote`.
  The Solana Worker (`/sol/worker.js`, testnet wallets only) has a policy of its own, which also
  names the Helius Devnet host and the one folder of proving keys of the local prover. The plain
  Solana Worker (`/sol/plain/worker.js`, mainnet wallets only) has a policy of its own, which names
  the Helius Devnet and mainnet hosts. The policy of the page names none of these.
- A restored seat works in a new session. The app checks the restored key data against what the
  wallet published for that seat. A proposal records the identity of the seat, not of the session.
- Backups leave out signing nonces, and a restore drops the nonces in older backup files, so a
  restored copy cannot reuse one.
- The backup note goes away when the app has opened the new file in memory, and offers it for
  download. The app cannot tell whether you saved it.

Not tested yet: a full session in Tor Browser. Also not tested: whether the light-wallet servers
accept connections from every Tor exit. Also not tested: whether many Tor users on one exit reach
the rate limits of the group server, of `/lwd` and of the `/near/` routes (`NEAR_PER_IP`, 60 calls
a minute), which count each IPv4 address or IPv6 /64.

## Your device

| Data | Web app | iPhone and Mac app |
|---|---|---|
| Key share, signing nonces, and for a version 2 or 3 wallet `vaultSk` | Browser local storage; sealed with a passkey when the lock is on | iPhone: Keychain, this device only, not in iCloud or iTunes device backups; sealed behind Face ID when the lock is on. Mac: login keychain |
| Wallet secrets (from invite links) | Same as the key share | Same as the key share |
| Sync state (notes, tree) | IndexedDB, sealed with the wallet key | File, sealed with the wallet key |
| For each payment: the sighash that a seat approved | With the key share (a field of the seat's secrets). Not in key share backups | Not kept yet (ZEC-8) |
| For each payment: a mark that this browser saw the signing start | Local storage, in plain (`zf-signing`) | Not kept yet (ZEC-8) |
| The PCZT that a seat approved | IndexedDB, sealed with the wallet key | Not kept yet (ZEC-8) |
| Cached balances for the wallet list | Local storage, sealed with the wallet key | Settings, sealed with the wallet key |
| Signing key of the seat (messages, and signed writes in a version 3 wallet) | With the key share (it is a field of the seat's secrets) | With the key share: Keychain, this device only. A seat gets it when the seat is taken |
| Direct chats (chat secrets, member ids) and the personal signing key | With the key share: local storage, or the sealed record when the lock is on. Not in key share backups. | Keychain, this device only, or the sealed record when the Face ID lock is on. Not in key share backups |
| The personal account: seed, contacts, sent messages, and the key of its saved sync state | With the lock on: a field of the sealed record. With the lock off: IndexedDB, sealed with an AES-GCM key that the browser cannot export. Local storage never holds the seed. | Not in the iPhone and Mac apps yet |
| The address book: names and addresses of recipients | Local storage in plain text (`zf-recipients`); with the lock on, a field of the sealed record | Keychain record `zf-recipients`, this device only; with the Face ID lock on, a field of the sealed record |
| Setup progress of a wallet: the step, the safety number, which backup files this browser checked, and SHA-256 hashes of the saved key shares (hashes only, never the shares) | Local storage, in plain text (`zf-guided-setup:<wallet id>`), also when the lock is on | Not in the iPhone and Mac apps |
| A note that you write about a wallet (at most 280 characters), not shared with other devices | Local storage, in plain text (`zf-wallet-description:<wallet id>`), also when the lock is on | Not in the iPhone and Mac apps |
| Pictures of wallet avatars, drawn from the public address of the wallet; the key is a hash of the address | IndexedDB `zigs-metal-orb-preview-v1`, at most 96 pictures, in plain. No secret in them. | Not in the iPhone and Mac apps |
| Pinned room ids, pinned signing keys, pinned wallet versions and shapes, pinned chat members, read times, the memo reading switch | Local storage, in plain text. No secret in them. | Signing key, version and shape pins, room pins (`zf-rooms`), chat member pins (`zf-chatpins`) and read times (`zf-read`): settings (UserDefaults), in plain text, so device backups can copy them. No secret in them. There is no memo reading switch yet |

Without the lock, anyone who controls your unlocked device can read your key share and wallet
secrets. One share alone cannot move funds: a payment needs a full threshold of signers.

### Key share backups

A backup file holds your key share, so the app locks it with a passphrase that you choose. The web,
iPhone and Mac apps make and open the same file.

- **What it holds.** The wallet secret and the seat secret. The seat secret has the key share, the
  public key package and the group key. For a version 2 or 3 wallet it also has `vaultSk`, the
  ZIP 2005 `sk`. The signing key of the seat is in it too, from the web, iPhone and Mac apps. A
  backup never holds signing nonces.
- **How it is locked.** Argon2id (RFC 9106) with 64 MiB of memory, 3 passes and 1 lane makes a
  32-byte key from the passphrase. XChaCha20-Poly1305 seals the text and authenticates the
  header, so a changed parameter fails to open. The format is in
  [PROTOCOL.md](PROTOCOL.md#9-keys-on-the-device).
- **The passphrase.** It has at least 16 characters, and at least 8 different ones. The apps
  normalize it to Unicode NFC, so any keyboard gives the same key. "Make a passphrase for me"
  gives 150 random bits. Zigs cannot recover a lost passphrase. Write it down and keep it apart
  from the file. The app never sends it anywhere. "Copy passphrase" puts it on the clipboard. On
  iPhone the copy stays on the device and leaves after 2 minutes. A browser cannot limit the copy.
- **Checked before you save.** The app opens the new file in memory and compares it with the
  original before it offers the download.
- **Restore.** The app takes only the key share and the keys that belong to it from the file. It
  drops the wallet checks that the file claims, so the restored seat checks the wallet again. It
  refuses a file for a seat that already has another key share, or that is still in setup.
- **Fit.** A restored seat counts as yours only when it fits the wallet. Three values must equal
  what the wallet published for the seat: the key share, the public key package and the group key.
  For a version 2 or 3 wallet, the `vaultSk` of the file must also give the viewing key of the
  wallet. Else the app undoes the restore. After a restart, a restored seat that does not fit is
  not used. The app shows a note and lets you remove it from the device. It keeps the message keys
  of the file only when the seat published their public keys. It keeps the message room of the file
  only when it equals the wallet document. It keeps the version of the file when it equals the
  wallet document, or when the file says version 3. Then signed writes stay on, and the app shows
  that the version moved.
- **Older files.** The backup format changed on 16 October 2026. The apps refuse a backup file
  that an older version made, and they tell you to make a new backup on a device that still holds
  the seat. Every seat asks for a new backup. A plain file of the current kind still restores. The
  app warns you and asks for a new encrypted backup.
- **Limit.** Anyone who has the file can try passphrases offline. Argon2id makes each try slow,
  but a guessable passphrase can still be found. A stolen file together with its passphrase gives
  the key share.

### Personal account backups

The backup of the personal account uses the same encrypted file as a key share (Argon2id and
XChaCha20-Poly1305, with a passphrase that you choose).

- **What it holds.** The network, the seed, the birthday and the contacts. It holds no message
  and no sync state. After a restore, the account syncs again from its birthday, and it shows
  the messages that it received. The text of the messages that you sent is lost.
- **Restore.** The page refuses a file that is not encrypted. It refuses a browser that has an
  account already, because a browser keeps one account. It checks every field before it saves
  anything.
- **Limit.** Anyone who has the file and the passphrase can spend the account and read the
  contacts. The contacts are names and addresses. A change of contacts makes the file out of
  date, and the page asks for a new backup.
- **Remove from this browser** deletes the seed. Without a backup file, the money in the account
  is lost.

### Lock with a passkey or Face ID

A passkey cannot sign for the wallet: it signs with P-256, and FROST for Zcash uses RedPallas. So
the passkey guards the key share instead. The lock is opt-in.

- **Web:** "Lock with a passkey" makes a passkey for the site. The WebAuthn PRF extension gives a
  32-byte secret on each Face ID, Touch ID or security key check. That secret is the AES-256-GCM
  key for one sealed record. The record holds the key shares, the signing nonces, the wallet
  secrets, the direct chats and the personal account.
  The plain copies are deleted only after the sealed record opens. The page asks for the passkey
  each time it opens (`web/vault.js`).
- **iPhone:** "Lock with Face ID" in Settings puts a random 256-bit key in the Keychain with a
  user-presence rule, so iOS gives it out only after Face ID or the passcode. The secrets are
  sealed with that key (AES-GCM). The app asks once each time it starts.
- Signing steps that run without a click still work, because the lock opens once per session.
- Someone who reads the browser storage or the Keychain gets the sealed record and the plain
  data that the table in "Your device" lists (pins, read times, setup progress, notes).
- If the passkey is lost, the locked seats in that browser are lost. Restore them from a backup
  file, or rely on the other signers. On iPhone, turning off the device passcode deletes the key.
- The Mac app does not offer the lock yet: its ad-hoc signature does not allow Keychain access
  rules. A Developer ID build is necessary.
- Not all browsers support the PRF extension. Current Chrome, Edge and Safari do. Other browsers
  show a clear error, and the keys stay as they are.

## Signers and invite links

- An invite link contains the wallet secret. Anyone who has the full link can read the wallet's
  data and take an open seat. Send links only through an end-to-end encrypted chat, such as Signal.
- **What a holder of the invite link can do.** The holder can read everything in the wallet. The
  holder can write any document too. In a version 3 wallet, each document that matters carries
  the signature of the seat that wrote it. The apps ignore a document without a valid signature
  of the right seat. So the holder cannot make an app show a false approval, cancel, "checked"
  mark, proposer or result such as "Sent". The holder cannot rename a seat, because each seat
  signs its own seat document. The apps show one line when they ignored data.
- The holder can still replace a real document with a false one. The apps then ignore it, and
  the wallet stops. This is a denial of service. The holder can also write an older signed
  document again, and can write the progress marks that have no signature. The funds stay safe,
  because FROST and the device checks do not depend on the store. A wallet of version 1 or 2 has
  no signed writes.
- Every signer holds the wallet's viewing key and sees every payment. A device that "Change
  devices" leaves out keeps the viewing key of the old wallet. It sees every later payment of the
  old wallet, and the move payment: the new address, the amount, the note and the id of the new
  wallet. It cannot read the new wallet, because the old wallet stores the new wallet's id, never
  its secret. With the id alone, it can still get the stored documents of the new wallet from the
  group server, and write documents that can stop it (Group server, above).
- A removed signer keeps the old wallet's message room and can read it. The new wallet has a new
  room that the removed signer cannot read.

## Not protected

- A threshold of signers who agree can move the funds. That is the rule they chose.
- **Quantum recoverability gives every signer `qsk`.** A wallet of version 2 or 3 is built to ZIP
  2005 (Proposed). So the funds can be recovered if quantum computers break today's keys. For
  this, every signer holds the same secret `qsk`. It is computed from the secret `sk` that the
  signers agreed on. As ZIP 2005 says, a quantum attacker who has `qsk` may steal the funds. Under
  a quantum attacker, one signer, or one stolen key share backup with its passphrase, could take
  the funds. Today the spend still needs a threshold of signers. The backup of a version 2 or 3
  wallet holds `vaultSk`, and `qsk` follows from it. Keep the file and its passphrase as secret as
  the key share. ZIP 2005 recommends that you move the funds to a post-quantum protocol as soon as
  one exists.
- A version 1 wallet (made before ZIP 2005 support) has no `qsk`. It cannot be recovered under
  ZIP 2005. Move its funds to a new wallet with Change devices.
- The signers must compare the safety number of a version 2 or 3 wallet over a channel that an
  attacker does not control. A call or a meeting is such a channel. The number covers the wallet
  id, the threshold, the number of seats, the network and every seat key.
- **The agreement on `sk` is not quantum-resistant.** The signers send their secret parts in
  X25519 boxes, and the encrypted documents stay in the group server. An attacker who recorded
  them, and later learns the wallet secret from an invite link, can break X25519 with a quantum
  computer. That attacker then gets `sk`, and so `qsk`. Send the invite link only through a private
  channel.
- A compromised device can sign with its own share, and can show its user false information.
  Each approving device decodes the transaction itself. It ties every output that carries value
  to the recipient it shows, checks that the outputs are exactly the listed recipients and
  amounts, and refuses a transaction with a transparent input, a transparent output that is not
  P2PKH or P2SH, a Sapling part, or a fee below the standard fee or above 10 times it. A
  transparent output shows as a recipient with the address of its script. The web, iPhone and Mac apps also check the memo of each
  recipient. Each approval is tied
  to the transaction's sighash. The device signs later only if the transaction is still the one
  it approved. Otherwise it marks the payment failed. So one honest signer sees the true
  payment.
- A signer checks the wallet address against its own key share and keeps the result on its
  device. If the wallet document in the store changes, the device checks it again. Other signers'
  "checked" marks are their claims. A seat approves a payment only after its own check passed.
- A move to a new wallet shows as checked only when this device holds a seat in the new wallet
  and that seat checked its address. A person who opens a wallet link without a seat sees the
  store's address, and nothing checked it.
- The group server can refuse service, drop messages or replay old ones. It cannot read them or
  write new ones.
- A device trusts the first signing key that it sees for each seat, in a version 3 wallet as for
  messages. A seat document counts only when its own key signed it. The safety number covers the
  box keys, not the signing keys. A holder of the invite link who takes an open seat first can set
  the key that devices trust for that seat. Compare the seat names with the other signers.
- A device also trusts the first number of signers and the first approval rule that it sees for
  a version 3 wallet. A holder who changes them before a device first sees the wallet can set
  the values for that device. The safety number covers both. Signers who compare it find the
  change.
- Wallet messages are not forward secret. Whoever gets a room secret later can read the room. A
  device that holds a seat can sign messages as that seat. Seats from before messages existed get
  their signing key when their device opens the wallet, and other devices trust the first key they
  see for each seat.
- A contact link holds the chat secret. Anyone who has the link can read the chat and write in it,
  also after both people joined. A third writer shows as "Unknown sender", but a silent reader is
  not seen. Until the contact opens the link and joins, anyone who has the link can take the
  second place. The chat shows the contact's name, so check it. A browser that forgets the chat (a
  private window, Tor Browser) cannot join it again, because the chat holds two people.
- The wallet follows chain reorganisations of up to 100 blocks. A deeper one, or a fork below
  the wallet's birthday, stops the sync with an error. The web, iPhone and Mac apps then delete the saved state and scan the wallet again
  from its birthday. A false light-wallet server can still show a chain that does not exist, or
  hide payments.
- The "Not in a block yet" line and row come from the mempool list of the light-wallet server,
  which signs nothing. A false server can hide a payment that waits for its block. A false server
  that knows an address of the wallet can show a made-up waiting payment of any amount, because a
  note needs only the address to be made, and the viewing key of the wallet opens it. The engine
  drops a single note above 21,000,000 ZEC, but the notes of one transaction add up in one row. A
  false server can also show a note of a block that the wallet has not synced yet, or of a branch
  that the chain left. The page shows such a payment only as waiting: the line "Not in a block
  yet", the row, and "A payment to this wallet is on its way" on an empty wallet. It never counts
  it as Available or Incoming, and it does not change the 0.5 ZEC warning level.
- A payment request names a wallet address, and may name an amount and a memo. Everyone who reads
  the message reads them. In a wallet room, these are the signers and anyone who has the invite
  link. In a direct chat, they are the contact and anyone who has the contact link. A request to
  a contact therefore links that contact to the wallet address. Send a request only to a person who
  may know that the wallet exists.
- The app offers the address of a wallet in a request only after the seat checked it. It does not
  offer the address of a mainnet wallet whose balance this browser does not know, or that is at the
  cap. A chat uses the last balance that this browser saved, so a mainnet wallet that this browser
  never synced gets no request.
- A request pays the address that its sender wrote, so check the address with the sender before
  you pay. A request from an unverified sender, and every request in a memo, shows a warning. The
  name and the message in a request are text from the sender. The card cuts them and marks them as
  not checked.
- A ZNS name gives the address that its registry holds. Whoever controls a name can point it at
  another address. The approvers in the web app check the name again, and the payment goes to the
  address that they approved. Before a large payment, check the address with the payee.
- **Propose this** sends nothing: the normal checks and approvals of a payment apply. Every
  approver reads its note. The note names the sender only when the sender is verified. Any holder
  of the invite link can write a message with a seat number and a bad signature.
- A memo is text that the payer chose. The app cannot check who wrote it, and it never calls a
  memo verified or private. The memo is on chain for good. Every signer can read the memos of
  the wallet, and so can a signer who left a wallet and kept its viewing key. A payer can write
  a note whose memo cannot be decrypted. The wallet then shows "Memo is not text" for it.
- An on-chain message is permanent, and only the memo encryption of Zcash protects its text. A
  message to the address that you gave a contact can come from anyone who knows that address. The
  page shows which contact's address received it, not who wrote it. A message to the public
  address of the account, or to an address that no contact has, shows as not verified.
- A message part is a note of value zero. A wallet that hides such notes does not show the
  message. The text of a message that you sent stays in the browser that sent it, and it is not in
  the backup file. Private windows and Tor Browser delete it when they close.
- The personal account is a hot account. Whoever controls the browser can spend it. The page warns
  when it pays fewer than 3 messages and when it holds more than 0.01 ZEC. Without the passkey
  lock, the AES key that seals the seed is not exportable, but code that runs on the same site can
  use it. Use the lock, and keep only a few cents in the account.
- Anyone who knows an address of the account can send it many messages. The account fetches the
  full transaction of each, and the page shows the 50 newest of the other messages.
- Anyone with an invite link can write many small messages into a wallet room or a chat. The
  iPhone and Mac apps open each message document once and stop reading a conversation with more
  than 10,000 documents. The web app downloads the whole room.
- The code is not audited. A mainnet wallet holds real ZEC and is limited to 0.5 ZEC: at that
  balance, or while the app does not know the balance, it stops showing the address and warns.
  An address that was shared stays valid. The app cannot stop someone from sending more, and
  payments out always stay possible.

## Checks

- Engine tests: sealed values of different lengths have the same size, old unpadded values still
  open, and tampered or misplaced values are rejected (`cargo test` in `wasm/`).
- Engine tests for memos: each payee reads its memo from the final transaction, and an output
  that the engine cannot read shows as unknown. A transaction with another id is refused. A
  note with a damaged tag is saved as unreadable. A transaction that never gives its memo goes
  behind the others. Engine tests for reorganisations: the wallet drops the notes, spends and
  memos of the dropped blocks, and stops at 100 blocks.
- Engine tests for payment requests check these points:
  - A request round trips through `makeRequest` and `parseRequest`.
  - The engine refuses a wrong network, more than 8 payees, a zero amount and a malformed URI.
  - The engine refuses a memo for a transparent address and a memo that is not text.
  - Each error names the payee. A payee index that ZIP 321 does not allow, and text from the
    sender, stay out of the error.
- Tests of the web app check these points:
  - Only a whole text is a request.
  - The cards show the warnings and the reasons.
  - **Propose this** writes nothing, and its note names only a verified sender.
  - A form made for one wallet is dropped when another wallet opens.
  - The request form names a wallet by its id, and a mainnet wallet with no known balance gets
    no form.
- Tests of the personal account check these points:
  - The seed is in no local storage entry, no log line and no view state. With the lock off it is
    only in the sealed IndexedDB record. With the lock on it is only in the sealed record.
  - The device key cannot be exported. A record that does not read blocks a new account and is
    never overwritten.
  - A message is saved before it is sent. A failed save sends nothing. A refused send frees the
    composer, and a message that no block holds expires.
  - The account reads memos by itself, and its sync is not dropped as a stale run.
  - The backup file has the seed, the network, the birthday and the contacts only, and a restore
    gives the same account. A file that is not encrypted, and a second account, are refused.
  - The contacts get the next free index, and an address is not a contact twice. A message to
    index 0 or to an unknown index shows as not verified under Other messages.
  - Joined messages, an unjoined marker, a memo that is not text, and a payment request in a memo
    show as they should. A memo goes through the display filters.
- Testnet transactions made by the web, iPhone and Mac apps are listed in the README.
