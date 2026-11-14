// The words of the Help part of Settings, and the diagnostics text. Help works offline: it holds
// no link and asks for nothing. The diagnostics hold a fixed list of facts and no line of the
// log, which has free text. Display only: nothing here sends anything.

import { SECURITY_DISCLOSURES } from "./security-disclosures.js";

export const HELP = [
  ["What does a payment need?",
    ("A payment needs the number of device approvals set by its rule, for " +
      "example 2 of 3. Each device approves with its own key share. After " +
      "enough approvals, the selected devices sign together while this " +
      "wallet is open on them. Zcash then needs Build proof and Send to " +
      "network. Solana follows its own sending or execution steps.")],
  ["What if a device is lost?",
    "Keep the devices that still work, and do not delete their data. While enough devices "
    + "remain to meet the approval rule, they can move the Zcash funds to a new wallet. A Solana "
    + "part does not move this way. With fewer devices, first restore devices from their backup "
    + "files. Zigs cannot go around the approval rule. The Security section has more."],
  ["Where is my backup file?",
    "A backup file holds the key share of one device. Your browser saves it as a download, "
    + "usually in its download folder. Zigs does not know where. The file is locked with a "
    + "passphrase that you choose. Zigs cannot recover that passphrase. A device with a Solana "
    + ("part has two files, each protected by its chosen passphrase. Keep " +
      "each file and its passphrase apart, and make ")
    + ("sure that you can find both. The Security section shows saved-file " +
      "progress, not a guarantee that the files remain accessible.")],
  ["Does my passkey replace a recovery file?",
    ("No. A passkey unlocks this browser’s protected data; it does not " +
      "replace a recovery file for each device and chain. Keep those files " +
      "and their passphrases accessible. If the passkey or browser data is " +
      "lost, use the recovery files. Keep restored wallets open until Zigs " +
      "checks that each share fits.")],
  ["Do other devices need to stay open?",
    ("All devices must join during wallet setup. Later, payments need " +
      "enough approvals for the wallet’s rule. The selected devices must " +
      "then stay open to sign together. Keep the proposing device open too." +
      " Alerts depend on browser permissions and delivery; check Approvals " +
      "directly if an alert does not arrive.")],
  ["What is the difference between cancel, release hold, and resend?",
    ("Cancel proposal asks the wallet’s devices to stop. It cannot revoke " +
      "signed data held elsewhere. Release hold removes this browser’s " +
      "protection against using the same funds again. It does not cancel a " +
      "transaction. Resend transaction submits the same signed transaction " +
      "again. A new proposal is a separate payment. Check Activity before " +
      "making one when the previous outcome is unknown.")],
  ["How do I recover a swap after closing this page?",
    ("Reopen Swap in the same wallet and browser to resume saved tracking." +
      " Done keeps an encrypted record in Swap history when browser storage" +
      " works. Copy its recovery record before clearing browser data. " +
      "Provider reports are not independent chain verification. Check " +
      "source, payout, and refund transactions before paying again. A " +
      "failed swap can still need a refund check.")],
  ["How do I replace devices?",
    ("Keep enough working devices to meet the current approval rule, or " +
      "restore their recovery files first. For Zcash, check the new wallet," +
      " then approve transfers under the old rule. More than one transfer " +
      "may be needed. SOL and USDC need separate moves; the Zcash move does" +
      " not transfer them. Update future receipt addresses after checking " +
      "the new wallet.")],
  ["What do the servers see?",
    ("The group server keeps encrypted wallet data. It sees which IP " +
      "addresses open which wallet, and when data is sent. It cannot read " +
      "the sealed data without the wallet secret. The light-wallet server " +
      "supplies blocks and sees the transactions that you send, but never " +
      "sees a secret key. On direct connections, it sees your IP address. " +
      "Testnet normally uses the Zigs Worker proxy, so the upstream node " +
      "sees the Worker IP. A direct fallback can expose your IP address. " +
      "The Worker also hosts the group server, so one operator sees both " +
      "traffic streams. Solana uses Helius, which sees your IP address and " +
      "public wallet keys. Private Solana payments require proofs on your " +
      "device; no spend witness goes to the Helius prover. The Zigs server " +
      "operator can link this wallet to its Solana addresses by timing. " +
      "Public mainnet Solana accounts expose balances and payments. Private" +
      " Solana hides payment amounts, but payee owner keys, deposits and " +
      "withdrawals remain public. The private program has upgrade authority" +
      " outside wallet approvals. Explorers see the addresses or " +
      "transaction IDs you open. When you send, Helius also sees the signed" +
      " transaction.")],
  ["How do I read the memos of payments to this wallet?",
    (
      "Open Incoming payment memos under Privacy & Network in Settings, "
      + "review the privacy disclosure and enable it. A memo is "
      + "only in "
    )
    + "the full transaction, so this browser then asks the light-wallet server for each "
    + "transaction that pays this wallet. That server learns which transactions pay this wallet. "
    + ("The setting is off until you turn it on. Turning it off stops new " +
      "memo requests; memos already downloaded stay in this browser.")],
  ["Why is my payment not done yet?",
    ("Zcash payments need approvals, signing, a proof, submission to the " +
      "network, and block confirmations. Solana payments have separate " +
      "sending or execution steps. Open the payment in Approvals or " +
      "Activity to see what remains. A submitted transaction is not yet " +
      "confirmed. Check Activity before proposing another payment when the " +
      "outcome is unknown.")],
  ["Which networks does Zigs use?",
    "Zigs uses Zcash testnet or mainnet, and Solana Devnet. Testnet and Devnet use test coins. "
    + "Mainnet uses real ZEC. "
    + ("Where the server offers it, mainnet wallets can use public Solana " +
      "accounts with real SOL and USDC, or private Solana wallets with real" +
      " SOL. Public Solana balances and payments are visible on chain. " +
      "Private Solana hides payment amounts, but payee owner keys and " +
      "public deposits and withdrawals remain visible. The private " +
      "program's upgrade authority is outside wallet approvals. Both modes " +
      "need the wallet's approval rule for payments. Every wallet device " +
      "can see the recipients and amounts.")],
  ["Has Zigs been audited?", SECURITY_DISCLOSURES[0][1]],
  ["How is the private Solana program managed?", SECURITY_DISCLOSURES[1][1]],
];

/**
 * The diagnostics text. `facts` is a list of [name, value] pairs that the page chose: counts,
 * words of a fixed list and facts of the browser. It holds no free text, so no name, note,
 * amount, address, key or link of the wallet can get in.
 */
export const diagnosticsText = (facts) => ["Zigs diagnostics",
  "Made in this browser. Zigs sends nothing.", "",
  ...facts.map(([name, value]) => name + ": " + value)].join("\n");
