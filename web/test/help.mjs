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
  assert.doesNotMatch(question + answer, /\bseats?\b|signers?/i,
    "answers use device terminology");
  assert.ok(answer.split(/(?<=\.) /).every((s) => s.split(" ").length <= 30),
    "short sentences: " + question);
}
const servers = HELP.find(([question]) => /servers see/.test(question))[1];
assert.match(servers, /no spend witness goes to the Helius prover/,
  "private spend data stays off the hosted prover");
assert.match(servers, /proofs on your device/, "proofs are made locally");
assert.match(servers, /IP address and public wallet keys/,
  "Helius receives network and public-key metadata");
assert.match(servers, /never sees a secret key/, "the node receives no secret key");
assert.doesNotMatch(servers, /never a key|the keys of this wallet/, "no loose word key");
assert.match(servers, /sees which IP addresses open which wallet, and when data is sent/,
  "the group server observes wallet connections and timing");
assert.match(servers, /sees the transactions that you send/,
  "the node sees submitted transactions");
assert.match(servers, /Testnet normally uses the Zigs Worker proxy/, "proxy use is qualified");
assert.match(servers, /direct fallback can expose your IP address/,
  "direct fallback is not presented as IP hiding");
assert.match(servers, /one operator sees both traffic streams/,
  "one operator observes both services");
assert.match(servers, /by timing/, "cross-chain timing linkage is disclosed");
assert.match(servers, /Public mainnet Solana accounts expose balances and payments/,
  "public mode is public");
assert.match(servers,
  new RegExp("Private Solana hides payment amounts, but payee owner keys, deposits "
    + "and withdrawals remain public"),
  "private mode has bounded privacy");
assert.match(servers, /upgrade authority outside wallet approvals/,
  "threshold approvals do not restrict upgrades");
assert.match(servers, /Explorers see the addresses or transaction IDs you open/,
  "external explorer disclosure");
assert.match(servers, /When you send, Helius also sees the signed transaction\.$/,
  "Helius sees sends");
assert.match(HELP.find(([q]) => q === "Has Zigs been audited?")[1],
  /not undergone an independent security audit/);
const networks = HELP.find(([question]) => /networks/.test(question))[1];
assert.match(networks, /Testnet and Devnet use test coins\. Mainnet uses real ZEC/,
  "test assets differ from real funds");
assert.match(networks, /Where the server offers it/, "availability is server-dependent");
assert.match(networks, /public Solana accounts with real SOL and USDC/, "public mainnet assets");
assert.match(networks, /private Solana wallets with real SOL/, "private mainnet assets");
assert.match(networks, /Public Solana balances and payments are visible on chain/,
  "public mode has no privacy promise");
assert.match(networks, /upgrade authority is outside wallet approvals/,
  "private mode has external authority");
assert.match(networks, /Both modes need the wallet's approval rule for payments/,
  "both modes retain the payment rule");
assert.match(networks, /Every wallet device can see the recipients and amounts/,
  "shared viewing access");
const backup = HELP.find(([question]) => /backup file/.test(question))[1];
assert.match(backup, /download folder\. Zigs does not know where/,
  "the file location is not known");
assert.match(backup, /two files, each protected by its chosen passphrase/,
  "each chain file has its own encryption");
assert.match(backup, /not a guarantee that the files remain accessible/,
  "saved is not guaranteed recovery");
console.log("ok  the answers");

assert.equal(diagnosticsText([["Browser online", true], ["Devices joined", 3]]),
  "Zigs diagnostics\nMade in this browser. Zigs sends nothing.\n\nBrowser online: true\n"
  + "Devices joined: 3", "a fact is a name and its value");
assert.equal(diagnosticsText([]), "Zigs diagnostics\nMade in this browser. Zigs sends nothing.\n",
  "no fact");
console.log("ok  the text");
