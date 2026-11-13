# Solana receiving

The receive screen has one job: give the sender the correct address for this wallet and network.

| Destination | Information and actions |
| --- | --- |
| Receive | One complete address, a locally generated QR code of that same address, Copy, network, supported assets and the address-type warning. Plain mainnet uses the ordinary Solana account address for SOL and USDC. A private mainnet wallet uses its full `solana-mainnet:` shielded address and explicitly requires a compatible shielded sender. |
| Settings → Current wallet → Solana account | Fee accounts, account identifiers, balance diagnostics, sending setup, nonce accounts, USDC setup, sync troubleshooting and an explicit explorer link. Secondary details start collapsed. |
| Security → Solana privacy & custody | What is public, provider visibility, timing links, program upgrade authorities and custody limitations. Recovery remains accessible through the existing security dashboard; account-specific recovery actions are also in Settings. |
| Payment tools | Send, Add SOL and existing proposal reviews. Receive opens with these tools closed. The Overview Send action opens them and retains its existing focus target. |

The program address and group key are account diagnostics, not extra receive destinations. A mainnet program address keeps its loss warning and has no Copy action. Fee accounts stay separate from the receive address. Receive, Settings and Security retain the existing key-agreement and stopped-wallet checks.

The same scan-and-copy surface supports private Devnet wallets, private Mainnet wallets, and plain Mainnet SOL/USDC wallets. Devnet retains its existing bare shielded-address format; private Mainnet retains its required `solana-mainnet:` prefix. The network remains visible beside the heading. Long shielded addresses have a compact preview and an accessible full-address disclosure; Copy and QR always use the complete value. The disclosure is scoped to the full address so opening it cannot carry over into another wallet.

The refined presentation uses a smaller white QR frame, quiet borders, a neutral copy button, and more consistent spacing. QR modules are sized to whole pixels so denser private addresses remain readable on small screens. Browser checks cover 320, 390, 768, and 1440px widths in both themes for all three wallet/network cases. No live funds are used.

A private shielded address is not an exchange deposit address or an ordinary Solana account. This change does not make private addresses compatible with ordinary wallets or NEAR settlement. Existing mainnet availability flags and transaction logic are unchanged.

## Sharing and privacy

Review screenshots use explicitly labelled, synthetic, unfunded display data in a fresh browser context. The local browser check blocks all external requests. It does not open a real wallet, use a real RPC key, or export key shares, transaction history, invite links, personal device labels or account identities. Screenshots are stored outside the tracked repository.

Hiding account diagnostics in the interface does not anonymize on-chain activity. Plain Solana balances and transfers are public. Private payments still expose the payee, and deposits, withdrawals, fee funding and provider requests can be linked. The interface keeps those facts available in Security and retains the short receive-page disclosures. No claim of guaranteed anonymity is made.

Publishing uses neutral project authorship. Review artifacts must use synthetic data and exclude local paths, personal names, personal author metadata, real addresses, real transaction identifiers and credentials.

## Validation

- A focused receive regression checks one copyable address, exact network-prefixed copying, compatible-sender wording, separate destinations and refusal after a stop or key disagreement.
- Existing protocol tests inspect account values across the receive, Settings and Security renderers so the moved disclosures retain their coverage.
- Browser QA checks desktop and mobile, dark and light themes, one visible address, copy success and failure, navigation, overflow and blocked external requests. An independent QR reader decodes the rendered QR images in every viewport and theme and compares the result with the complete copied address, including the private-mainnet prefix. Long addresses can be expanded with the keyboard; the app's redraw preservation does not expand a different wallet's address.

The available Node runtime is v25.6.1; the repository's aggregate script requires Node 26. Its 79 fast test files were therefore invoked directly. After rerunning the affected checks and the mock-server checks, 76 passed. Two history-comparison checks cannot resolve their pinned historical Git fixtures, and the QR round-trip check requires the missing `qrencode` command. The targeted ceremony, approval/payment, backup, plain-mainnet setup and browser checks passed separately. No live mainnet transaction was run.

## App-wide clarity pass

Everyday screens lead with the action and essential facts. Optional explanations remain available through native, keyboard-accessible disclosures.

- Zcash Receive uses one compact address, its exact QR and Copy/Share actions. Receiving help, test coins and public swap-refund details start collapsed. Known public refund funds open their section with an attention label. Address verification and moved-wallet checks remain in force. The integrated version follows the latest Near branch's centralized disclosure and mainnet policies.
- Send leads with recipient and amount. Recipient memos expand per recipient; notes, multiple recipients, list paste and priority fees live in More options. Filled optional fields reopen after a redraw, and drafts retain their values. An empty matching Address book adds no picker.
- Payment review retains the full recipient, amount, decoded transaction check, fee, expiry and approval action. Generic privacy explanations are collapsed. Public-recipient exposure and failed transaction checks remain prominent. Device-removal guidance is available with Change devices.
- Setup asks for the device label, wallet name and network without another device diagram or optional description field. Descriptions remain editable in Settings. Protection, threshold and network selection remain part of setup.
- Settings groups memo retrieval and provider disclosures under Privacy & Network. Wallet configuration is collapsed. Security remains the destination for recovery and device management. Help points to the new preference location.
- Demo-only USDC assets and unavailable Shield/Unshield actions are omitted. Empty Approvals omits the large device diagram. Messaging tabs use Chat and On-chain messages. Optional demo controls are grouped in Labs when a development harness enables them; the latest Near production entry does not install the Tor demo or enable swap demos.
- Address book supports network-prefixed private Mainnet SOL destinations and retains strict Devnet/public format checks.

### Swap continuity

Pending NEAR swap tracking is stored locally using the existing engine's authenticated encryption and wallet group secret, with a wallet-specific encryption context. The stored record includes only the required route, amounts, addresses, deadline, optional quote reference/signature, wallet label and plain-SOL proposal reference. No signing key or payment authorization is stored in this cache.

Reload restores tracking and requests a fresh NEAR status. Deposit details stay hidden until the provider confirms the saved route, amounts, recipient, refund and deadline. Restore never calls the swap-creation or payment handlers. Existing plain-SOL proposal IDs remain attached, and an interrupted proposal stays blocked from duplicate submission. Changing wallets hides the prior wallet's tracking and loads only the selected wallet's encrypted record.

Hide details keeps pending tracking. Done removes a final swap's local record. Failed writes explicitly ask the user to keep the page and quote details; damaged or unreadable records are preserved and block another live swap from replacing them. Browser storage and the wallet secret are required for reload recovery. This change does not alter provider trust, mainnet feature flags, approval rules or settlement guarantees.

### Additional validation

A synthetic renderer audit captured 29 screens and flow states at desktop and mobile sizes, with no browser errors or horizontal overflow. In those representative mobile states, visible words fell from 228 to 30 for testnet Receive, 212 to 77 for Send and 338 to 97 for payment review. These are fixture measurements, not counts for every possible wallet state.

Interaction checks exercised keyboard disclosures, optional-field preservation through the app's real redraw helpers, light/dark layouts at 320, 390 and 1440 pixels, and encrypted recovery through an actual browser reload. Recovery checks cover ciphertext inspection, wrong keys and wallet contexts, corrupt records, failed writes and cleanup, provider-route disagreement, pending proposal guards and no automatic payment. The full payment and unified wallet-setup integration tests passed. The Solana browser regression again decoded all 24 QR viewport/theme/network cases independently.
