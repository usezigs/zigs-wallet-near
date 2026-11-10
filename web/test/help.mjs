// The Help words and the diagnostics text (web/help-model.js): the answers hold no link, use the
// word device and name what each server sees, and the diagnostics text holds the facts that the
// page gives and nothing else.
// Run: node web/test/help.mjs   (Node 26)
import assert from "node:assert/strict";
import { HELP, diagnosticsText } from "../help-model.js";

assert.ok(HELP.length >= 5, "Help has its answers");
for (const [question, answer] of HELP) {
  assert.ok(question.endsWith("?") && answer.length > 40, "a question and a real answer");
  assert.doesNotMatch(answer, /https?:|www\.|\.com|\.app/, "an answer needs no network: no link");
  assert.doesNotMatch(question + answer, /\bseats?\b|signers?|passkey/i,
    "an answer says device, and Zigs has no passkey");
  assert.ok(answer.split(/(?<=\.) /).every((s) => s.split(" ").length <= 30),
    "short sentences: " + question);
}
const servers = HELP.find(([question]) => /servers see/.test(question))[1];
assert.match(servers, /nothing goes to the Helius prover/, "the servers answer names the prover");
assert.match(servers, /proofs on your device/, "and says where the proofs are made");
assert.match(servers, /public keys of this wallet/, "Helius sees public keys");
assert.match(servers, /never sees a secret key/, "no server sees a secret key");
assert.doesNotMatch(servers, /never a key|the keys of this wallet/, "no loose word key");
assert.match(servers, /sees which IP addresses open which wallet, and when data is sent/,
  "the group server sees the IP addresses of each wallet and the time of each write");
assert.match(servers, /sees the transactions that you send/, "the light-wallet server sees sends");
assert.match(servers, /on testnet the Zigs light-wallet server sees only the Zigs Worker/,
  "on testnet the Zigs node sees the Worker, not the device");
assert.match(servers, /Worker is also the group server, so one operator sees the traffic of both/,
  "one operator sees both");
assert.ok(servers.includes("The Solana part also asks Helius. Helius sees your IP address and the "
  + "public keys of this wallet. The wallet makes proofs on your device, so "
  + "nothing goes to the Helius prover. The Zigs server operator can link this wallet to its "
  + "Solana addresses by timing."), "the Devnet sentences of the servers answer stay");
assert.match(servers, /by timing\. On mainnet, the Solana part is a plain account\./,
  "the servers answer names the plain part after the Devnet sentences");
assert.match(servers, /Helius sees your IP address and the address of this wallet, and the expl/,
  "the servers answer names the explorer");
assert.match(servers, /When you send, Helius also sees the signed transaction\.$/,
  "and that Helius sees a send");
const networks = HELP.find(([question]) => /networks/.test(question))[1];
assert.ok(networks.startsWith("Zigs uses Zcash testnet or mainnet, and Solana Devnet. "
  + "Testnet and Devnet use test coins. Mainnet uses real ZEC: it is a beta, it is not audited, "
  + "and you can lose the funds. "), "the Devnet sentence of the networks answer stays");
assert.match(networks, /a mainnet wallet also has a Solana part\. It is a plain account with/,
  "the networks answer names the plain part");
assert.match(networks, /real SOL and USDC, with no privacy and no hosted prover\./,
  "the networks answer says what the plain part lacks");
assert.doesNotMatch(networks, /comes later|cannot send|not available yet/,
  "no claim that it cannot send");
assert.match(networks, /no hosted prover\. A send needs the same approvals as a Zcash payment\./,
  "the networks answer says that a send needs approvals");
assert.match(networks, /Every device of the group sees its recipient and amount\./,
  "and who sees the recipient and the amount");
const backup = HELP.find(([question]) => /backup file/.test(question))[1];
assert.match(backup, /download folder\. Zigs does not know where/, "the place is not known");
assert.match(backup, /two files and two passphrases/, "a Solana part is a second file");
console.log("ok  the answers");

assert.equal(diagnosticsText([["Browser online", true], ["Devices joined", 3]]),
  "Zigs diagnostics\nMade in this browser. Zigs sends nothing.\n\nBrowser online: true\n"
  + "Devices joined: 3", "a fact is a name and its value");
assert.equal(diagnosticsText([]), "Zigs diagnostics\nMade in this browser. Zigs sends nothing.\n",
  "no fact");
console.log("ok  the text");
