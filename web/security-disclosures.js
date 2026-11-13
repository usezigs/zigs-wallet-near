// Shared facts for the FAQ and the expandable Security section.
export const SECURITY_DISCLOSURES = Object.freeze([
  ["Audit status", "Zigs has not undergone an independent security audit. Software defects, "
    + "compromised devices or failures in its dependencies can put funds at risk."],
  ["Private Solana program authority", "The Zigs owner holds the upgrade key for the private "
    + "Solana approvals program. That key can replace the program and could move the funds of "
    + "every private wallet. Wallet approvals do not restrict that authority."],
  ["Solana privacy", "Private payments hide their amounts but expose the payee’s owner key. "
    + "Public deposits and withdrawals reveal their amounts and endpoints. A small pool and "
    + "transaction timing can make activity easier to link. Plain Solana balances and payments "
    + "are public on chain."],
  ["Deposits and fee funds", "Use Add SOL for public deposits into a private Solana wallet. "
    + "Public SOL sent directly to its program address cannot be recovered by the current "
    + "program. Each fee address retains 650,240 lamports; its remaining SOL moves through Add SOL."],
]);
