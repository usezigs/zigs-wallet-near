// The wire format, the chain bundle and the checker screen of the plain Solana intents S1 to S5
// (web/sol/plain/intent.js, chain.js, review.js) against the real wasm. The native vectors of
// wasm-sol/vectors/plain (written by the Rust encoders, pinned by wasm-sol/tests/plain_sign.rs)
// are the control of the encoders: the intent, the pins and the chain bundle that this page builds
// must equal their bytes, and the checker must answer with their text. The Worker is a fake that
// runs checkCommand of guard.js on every call and answers from the chain of a vector. It shows:
// the encoders equal the Rust ones; readChain asks only for the addresses of plain_reads, the
// genesis hash and the three rents, and writes the genesis hash, the rents and the account fields
// (executable flag, data, lamports above 2^53) as the Worker gave them; the screen shows the lines
// of the checker one for one, with the labels of this file, and builds nothing from the intent; a
// refusal gives one row for each rule; an error gives no way to approve.
// Run: node web/test/sol-plain-review.mjs   (Node 26)
import assert from "node:assert/strict";
import fs from "node:fs";
import { base58, keyOfBase58 } from "../sol/docs.js";
import { encodeChain, readChain } from "../sol/plain/chain.js";
import { GENESIS, checkCommand } from "../sol/plain/guard.js";
import {
  cancelIntent, createNonceIntent, enableTokenIntent, kindOfIntent, plainPins, sendSolIntent,
  sendTokenIntent, u32le, u64le,
} from "../sol/plain/intent.js";
import { canApprove, refusalRows, reviewText, screenRows } from "../sol/plain/review.js";
import * as W from "../sol/wasm/sol_wasm.js";

const web = new URL("../", import.meta.url);
W.initSync({ module: fs.readFileSync(new URL("sol/wasm/sol_wasm_bg.wasm", web)) });
const step = (name) => console.log("ok  " + name);
const c = { W };
const dir = new URL("../../wasm-sol/vectors/plain/", import.meta.url);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

// The values of wasm-sol/tests/support/plain.rs.
const PAYER = "22".repeat(32);
const NONCE = "33".repeat(32);
const BLOCKHASH = "44".repeat(32);
const LAMPORTS = 1_500_000_000n;
const UNITS = 2_500_000n;
const RENT_SPACES = [0, 80, 165];
const ROLES = ["", "payer", "group", "nonce", "recipient", "source", "dest"];

// ── The vectors ──
const vector = (name) => {
  const read = (ext) => fs.readFileSync(new URL(`${name}.${ext}`, dir));
  return {
    name,
    intent: read("intent"),
    pins: read("pins"),
    msg: read("msg"),
    chain: read("chain"),
    answer: read("answer").toString("utf8"),
  };
};
const names = fs.readdirSync(dir).filter((f) => f.endsWith(".answer")).map((f) => f.slice(0, -7));
const SHAPES = ["s1-create-nonce", "s2-send-sol", "s3-send-usdc", "s4-enable-usdc", "s5-cancel"];

/** The chain bundle of a vector as plain values (this decoder is the test's own). */
function decodeChain(bytes) {
  const buf = Buffer.from(bytes);
  let at = 0;
  const take = (n) => {
    at += n;
    assert.ok(at <= buf.length, "the vector chain ends inside a field");
    return buf.subarray(at - n, at);
  };
  const genesis = take(32);
  const rents = RENT_SPACES.map(() => take(8).readBigUInt64LE());
  const reads = Array.from({ length: take(1)[0] }, () => {
    const role = ROLES[take(1)[0]];
    const key = take(32);
    const account = take(1)[0] === 0 ? null : {
      lamports: take(8).readBigUInt64LE(),
      owner: take(32),
      executable: take(1)[0] === 1,
      data: take(take(4).readUInt32LE()),
    };
    return { role, key, account };
  });
  assert.equal(at, buf.length, "the vector chain has no bytes after the last read");
  return { genesis, rents, reads };
}

const viewOf = (account) =>
  account && {
    owner: base58(hex(account.owner)),
    lamports: String(account.lamports),
    executable: account.executable,
    data: Buffer.from(account.data).toString("base64"),
  };

/**
 * A fake plain Worker that answers from a decoded chain. `log` keeps every call. `genesis`, `skip`
 * and `rents` change the answer: another genesis hash, the roles whose account is not given, and
 * the rents by place (0, 80, 165 bytes) that differ from the chain.
 */
function workerOf(decoded, { genesis, skip = [], rents = [] } = {}) {
  const log = [];
  const table = new Map(
    decoded.reads.filter((r) => !skip.includes(r.role)).map((r) => [base58(hex(r.key)), r.account]),
  );
  const answers = {
    genesis: () => ({ genesis: genesis ?? base58(hex(decoded.genesis)) }),
    rent: ({ space }) => {
      const at = RENT_SPACES.indexOf(space);
      return { lamports: String(rents[at] ?? decoded.rents[at]) };
    },
    accounts: ({ addresses }) => ({
      accounts: addresses.map((a) => viewOf(table.get(a) ?? null)),
    }),
  };
  return {
    log,
    call: async (cmd, args = {}) => {
      checkCommand(cmd, args);
      log.push({ cmd, args });
      assert.ok(answers[cmd], `the Worker is asked for ${cmd}`);
      return structuredClone(answers[cmd](args));
    },
  };
}

/** The wallet keys of a cluster, from the base58 lines of the native answers. */
function keysOf(cluster) {
  const line = (shape, name) =>
    new RegExp(`^${name} (\\S+)$`, "m").exec(vector(`${cluster}-${shape}`).answer)[1];
  return {
    group: keyOfBase58(line("s1-create-nonce", "group")),
    recipient: keyOfBase58(line("s2-send-sol", "recipient")),
  };
}

const intentOf = (shape, { recipient }) =>
  ({
    "s1-create-nonce": () => createNonceIntent(0, BLOCKHASH),
    "s2-send-sol": () => sendSolIntent(3, NONCE, recipient, LAMPORTS),
    "s3-send-usdc": () => sendTokenIntent(3, NONCE, 0, recipient, UNITS),
    "s4-enable-usdc": () => enableTokenIntent(0, BLOCKHASH),
    "s5-cancel": () => cancelIntent(3, NONCE),
  })[shape]();

const answerLines = (answer) => answer.split("\n").slice(1);
const ruleIds = (review) => refusalRows(review).map((row) => row.id);
const statements = new Map(W.plain_rule_list().split("\n").map((l) => l.split("\t")));
// The label of each name of an accepted answer. It is written out here on purpose, so that a
// change of a label in web/sol/plain/review.js is a change of this table too.
const LABEL_OF = {
  intent: "Action",
  cluster: "Network",
  recipient: "To",
  amount: "Amount",
  units: "Base units",
  symbol: "Asset",
  mint: "Mint",
  fee: "Fee lamports",
  rent: "Rent lamports",
  payer: "Fee payer",
  group: "Wallet",
};

// ── The encoders equal the Rust encoders; the chain and the checker follow ──
for (const cluster of ["devnet", "mainnet"]) {
  const keys = keysOf(cluster);
  assert.equal(keys.group.length, 64, "the group key of the vectors");
  const pins = plainPins({ cluster }, keys.group, PAYER);
  for (const shape of SHAPES) {
    const v = vector(`${cluster}-${shape}`);
    const label = `${cluster} ${shape}`;
    const intent = intentOf(shape, keys);
    assert.ok(same(intent, v.intent), `the intent equals the Rust intent: ${label}`);
    assert.ok(same(pins, v.pins), `the pins equal the Rust pins: ${label}`);
    const message = W.plain_compile_message(intent, pins);
    assert.ok(same(message, v.msg), `the compiled message equals the Rust message: ${label}`);

    const decoded = decodeChain(v.chain);
    const worker = workerOf(decoded);
    const chain = await readChain(c, worker, intent, pins);
    assert.ok(same(chain, v.chain), `readChain equals the Rust chain bundle: ${label}`);
    assert.ok(same(encodeChain(decoded), v.chain), `encodeChain equals the Rust chain: ${label}`);

    assert.equal(W.plain_check_message(message, intent, pins, chain), v.answer, `answer: ${label}`);
    const review = reviewText(c, message, intent, pins, chain);
    assert.equal(review.kind, "accepted", `the round trip is accepted: ${label}`);
    assert.ok(canApprove(review), `an accepted answer can be approved: ${label}`);
    assert.deepEqual(
      screenRows(review).map((r) => `${r.name} ${r.value}`),
      answerLines(v.answer),
      `the rows equal the lines of the checker one for one: ${label}`,
    );
    assert.deepEqual(refusalRows(review), [], `an accepted answer has no refusal rows: ${label}`);
  }
}
step("the encoders, the chain bundle and the round trip equal the Rust vectors (S1 to S5)");

// ── The reads: only the addresses of plain_reads, the genesis hash and the three rents ──
{
  const keys = keysOf("mainnet");
  const pins = plainPins({ cluster: "mainnet" }, keys.group, PAYER);
  const v = vector("mainnet-s3-send-usdc");
  const intent = intentOf("s3-send-usdc", keys);
  const worker = workerOf(decodeChain(v.chain));
  await readChain(c, worker, intent, pins);
  const rows = W.plain_reads(intent, pins).split("\n").map((row) => row.split("\t"));
  const wanted = rows.map((row) => row[2]);
  assert.deepEqual(rows.map((row) => row[0]), ["payer", "nonce", "recipient", "source", "dest"]);
  assert.deepEqual(
    worker.log.map((x) => x.cmd).sort(),
    ["accounts", "genesis", "rent", "rent", "rent"],
    "the Worker is asked for the genesis hash, the three rents and one account list",
  );
  assert.deepEqual(
    worker.log.filter((x) => x.cmd === "rent").map((x) => x.args.space),
    RENT_SPACES,
    "the rents are those of 0, 80 and 165 bytes",
  );
  const asked = worker.log.find((x) => x.cmd === "accounts").args.addresses;
  assert.deepEqual(asked, wanted, "the accounts read are the addresses of plain_reads, in order");
  assert.ok(asked.length <= 100);
  assert.ok(
    !asked.includes(base58(hex(intent.slice(5, 37)))),
    "the nonce value of the intent is not read as an address",
  );
  assert.notEqual(rows[4][2], base58(keys.recipient), "the dest read is the ATA of the recipient");
  assert.ok(!asked.includes(base58(keys.group)), "S3 reads the group by its token account only");
}
step("readChain reads only the addresses of plain_reads");

// ── A Worker that shows another cluster: the checker refuses the genesis hash ──
{
  const keys = keysOf("mainnet");
  const pins = plainPins({ cluster: "mainnet" }, keys.group, PAYER);
  const v = vector("mainnet-s2-send-sol");
  const intent = intentOf("s2-send-sol", keys);
  const message = W.plain_compile_message(intent, pins);
  const worker = workerOf(decodeChain(v.chain), { genesis: GENESIS.devnet });
  const chain = await readChain(c, worker, intent, pins);
  const review = reviewText(c, message, intent, pins, chain);
  assert.equal(review.kind, "refused", "the genesis hash of the Worker is not a constant");
  assert.deepEqual(ruleIds(review), ["plain-genesis"]);
  assert.ok(refusalRows(review)[0].detail.includes(GENESIS.devnet));
  assert.ok(!canApprove(review) && screenRows(review).length === 0);
}
step("the genesis hash of the chain bundle is the Worker's answer");

// ── A Worker that shows another rent: the checker refuses the pin ──
{
  const keys = keysOf("mainnet");
  const pins = plainPins({ cluster: "mainnet" }, keys.group, PAYER);
  const decoded = decodeChain(vector("mainnet-s2-send-sol").chain);
  const intent = intentOf("s2-send-sol", keys);
  const message = W.plain_compile_message(intent, pins);
  for (const [at, space] of RENT_SPACES.entries()) {
    const rents = [];
    rents[at] = decoded.rents[at] + 1n;
    const chain = await readChain(c, workerOf(decoded, { rents }), intent, pins);
    const review = reviewText(c, message, intent, pins, chain);
    assert.equal(review.kind, "refused", `a rent that the pin does not hold is refused: ${space}`);
    assert.deepEqual(ruleIds(review), ["plain-rent-pin"], `the rent of ${space} bytes`);
    const shown = decoded.rents.map((rent, i) => (i === at ? rent + 1n : rent)).join(", ");
    assert.ok(refusalRows(review)[0].detail.startsWith(`rent (${shown}),`),
      "the detail shows the rents that the Worker gave, in the order of the spaces");
    assert.ok(!canApprove(review) && screenRows(review).length === 0);
  }
}
step("the rents of the chain bundle are the Worker's answers");

// ── The account of the recipient, as the Worker gave it ──
{
  const keys = keysOf("mainnet");
  const pins = plainPins({ cluster: "mainnet" }, keys.group, PAYER);
  const decoded = decodeChain(vector("mainnet-s2-send-sol").chain);
  const intent = intentOf("s2-send-sol", keys);
  const message = W.plain_compile_message(intent, pins);
  const bytes = (length) => Uint8Array.from({ length }, (_, i) => i & 255);
  const system = { lamports: 1n, owner: new Uint8Array(32), executable: false, data: bytes(0) };
  const seen = async (change) => {
    const account = { ...system, ...change };
    const reads = decoded.reads.map((r) => (r.role === "recipient" ? { ...r, account } : r));
    const chain = await readChain(c, workerOf({ ...decoded, reads }), intent, pins);
    assert.ok(same(chain, encodeChain({ ...decoded, reads })), "the account is written as given");
    return reviewText(c, message, intent, pins, chain);
  };
  for (const lamports of [2n ** 53n + 1n, 2n ** 64n - 1n]) {
    const review = await seen({ lamports });
    assert.equal(review.kind, "accepted", `lamports above 2^53 are kept: ${lamports}`);
  }
  for (const [what, change] of [
    ["an executable account", { executable: true }],
    ["one byte of data", { data: bytes(1) }],
    ["300 bytes of data", { data: bytes(300) }],
  ]) {
    const review = await seen(change);
    assert.equal(review.kind, "refused", `a System recipient with ${what} is refused`);
    assert.deepEqual(ruleIds(review), ["plain-recipient-owner"], what);
    assert.ok(!canApprove(review));
  }
}
step("the account of the recipient reaches the checker as the Worker gave it");

// ── The screen shows the checker's lines, whatever the intent says ──
{
  const keys = keysOf("mainnet");
  const pins = plainPins({ cluster: "mainnet" }, keys.group, PAYER);
  const intent = intentOf("s2-send-sol", keys);
  const other = base58("55".repeat(32));
  const answer = `accepted\nintent send-sol\ncluster mainnet\nrecipient ${other}\namount 1.5\n`
    + "mystery 12 34\nfee 10000";
  const fake = { plain_check_message: () => answer, plain_rule_list: W.plain_rule_list };
  const review = reviewText({ W: fake }, new Uint8Array(1), intent, pins, new Uint8Array(1));
  const rows = screenRows(review);
  assert.equal(rows.find((r) => r.name === "recipient").value, other,
    "the recipient row is the line of the checker, not a field of the intent");
  assert.equal(rows.find((r) => r.name === "amount").value, "1.5", "the amount is not reworded");
  assert.equal(rows.length, 6, "no line of the checker is left out");
  const mystery = rows.find((r) => r.name === "mystery");
  assert.deepEqual(
    mystery,
    { name: "mystery", label: "Other", value: "mystery 12 34", other: true },
    "an unknown name shows in an other row, with its whole line",
  );
  assert.deepEqual(rows.map((r) => r.name), ["intent", "cluster", "recipient", "amount",
    "mystery", "fee"], "the rows keep the order of the checker");
  for (const row of rows.filter((r) => !r.other)) {
    assert.ok(row.label.split(" ").length <= 2, `the label of ${row.name} is one or two words`);
  }
  const sameName = (key, value) => assert.deepEqual(
    screenRows({ kind: "accepted", lines: [{ name: key, value, line: key + " " + value }] }),
    [{ name: key, label: "Other", value: key + " " + value, other: true }],
    "a name from the prototype chain is no known name");
  sameName("constructor", "x");
  sameName("toString", "y");
}
step("the screen shows only the lines of the checker");

// ── The answers of the checker that are not accepted ──
{
  const fake = (answer) => ({
    plain_check_message: () => answer,
    plain_rule_list: W.plain_rule_list,
  });
  const ask = (answer) => reviewText({ W: fake(answer) }, 1, 2, 3, 4);
  for (const answer of ["error\tchain: the read of the recipient is missing", "error\t",
    "something else", "", "acceptedX\nintent send-sol", "ACCEPTED\nintent send-sol"]) {
    const review = ask(answer);
    assert.equal(review.kind, "error", `neither accepted nor refused is an error: ${answer}`);
    assert.ok(!canApprove(review), "an error gives no way to approve");
    assert.deepEqual(screenRows(review), [], "an error gives no rows");
    assert.deepEqual(refusalRows(review), []);
  }
  assert.equal(ask("error\tchain: the read of the recipient is missing").text,
    "chain: the read of the recipient is missing", "the text of the checker is kept");
  const thrown = reviewText({ W: { plain_check_message() { throw new Error("bad input"); } } },
    1, 2, 3, 4);
  assert.deepEqual(thrown, { kind: "error", text: "bad input" }, "a throw is an error");
  assert.ok(!canApprove(thrown));
  const refused = ask("refused\nplain-data\tinstruction 1: the data differs");
  assert.equal(refused.kind, "refused");
  assert.ok(!canApprove(refused), "a refusal gives no way to approve");
  assert.deepEqual(screenRows(refused), [], "a refusal gives no recipient, amount or mint row");
  assert.ok(!canApprove(ask("refused")), "a refusal with no rule line gives no way to approve");
}
step("an error and a refusal give no way to approve and no rows");

// ── An accepted answer must be complete before it can be approved ──
{
  const ask = (answer, W2 = {}) => reviewText({ W: { plain_check_message: () => answer,
    plain_rule_list: W.plain_rule_list, ...W2 } }, 1, 2, 3, 4);
  const empty = ask("accepted");
  assert.equal(empty.kind, "accepted", "control: an accepted head with no line is accepted");
  assert.ok(!canApprove(empty), "an accepted answer with no line cannot be approved");
  assert.deepEqual(screenRows(empty), [], "and it shows no rows");
  for (const answer of ["accepted\nintent", "accepted\nintent send-sol\nfee",
    "accepted\nintent \ncluster mainnet"]) {
    const review = ask(answer);
    assert.equal(review.kind, "accepted", `control: ${JSON.stringify(answer)} is accepted`);
    assert.ok(!canApprove(review), `a known name with no value cannot be approved: ${answer}`);
    assert.deepEqual(screenRows(review), [], "and it shows no rows");
  }
  assert.ok(canApprove(ask("accepted\nintent send-sol\nmystery")),
    "a name that the page does not know shows its whole line and does not block");
  assert.ok(canApprove(ask("accepted\nintent send-sol\nfee 5000")), "a complete answer");
  // A throw of plain_rule_list is an error of the review, not an exception of the page.
  const noList = { plain_rule_list() { throw new Error("no list"); } };
  const broken = ask("refused\nplain-data\tx", noList);
  assert.deepEqual(broken, { kind: "error", text: "no list" }, "a throw of the list is an error");
  assert.ok(!canApprove(broken));
  // A rule that the list does not know shows its id as the statement.
  const unknown = ask("refused\nplain-data\tinstruction 0\nplain-new-rule\tthe detail");
  assert.deepEqual(refusalRows(unknown).map((r) => r.statement),
    [statements.get("plain-data"), "plain-new-rule"], "an unknown rule id is its own statement");
  assert.equal(refusalRows(unknown)[1].detail, "the detail");
}
step("an incomplete accepted answer cannot be approved, and a rule list that throws is an error");

// ── A missing read is an error of the checker, with the text of the checker ──
{
  const keys = keysOf("mainnet");
  const pins = plainPins({ cluster: "mainnet" }, keys.group, PAYER);
  const v = vector("mainnet-s2-send-sol");
  const intent = intentOf("s2-send-sol", keys);
  const message = W.plain_compile_message(intent, pins);
  const decoded = decodeChain(v.chain);
  const reads = decoded.reads.filter((r) => r.role !== "recipient");
  const missing = encodeChain({ ...decoded, reads });
  const review = reviewText(c, message, intent, pins, missing);
  assert.equal(review.kind, "error", "a missing read gives an error, not a refusal");
  assert.equal(review.text, "chain: the read of the recipient is missing");
  assert.ok(!canApprove(review) && screenRows(review).length === 0);
}
step("a missing read is an error with no way to approve");

// ── Tampered messages: the rule ids, one row for each, with the statement of the rule ──
{
  const keys = keysOf("mainnet");
  const pins = plainPins({ cluster: "mainnet" }, keys.group, PAYER);
  const v = vector("mainnet-s2-send-sol");
  const intent = intentOf("s2-send-sol", keys);
  const chain = await readChain(c, workerOf(decodeChain(v.chain)), intent, pins);
  const recipient = Buffer.from(keys.recipient, "hex");
  const swapped = (message, key) => {
    const at = message.indexOf(recipient);
    assert.ok(at > 0 && message.indexOf(recipient, at + 1) < 0, "the recipient occurs once");
    const out = Buffer.from(message);
    Buffer.from(key, "hex").copy(out, at);
    return out;
  };
  // One broken rule group: another recipient in the message.
  const one = reviewText(c, swapped(v.msg, "66".repeat(32)), intent, pins, chain);
  assert.equal(one.kind, "refused", "a recipient changed in the message is refused");
  assert.deepEqual(ruleIds(one), ["plain-key-table", "plain-accounts"],
    "a changed recipient names the rules of the account table");
  // Two more broken rules: the same change in a message with other data.
  const data = vector("mainnet-changed-data");
  const two = reviewText(c, swapped(data.msg, "66".repeat(32)), intent, pins, chain);
  assert.deepEqual(ruleIds(two), ["plain-key-table", "plain-accounts", "plain-data"],
    "every broken rule has its own row");
  const twoMsg = swapped(data.msg, "66".repeat(32));
  const raw = answerLines(W.plain_check_message(twoMsg, intent, pins, chain));
  assert.equal(refusalRows(two).length, raw.length, "one row for each line of the checker");
  for (const [i, row] of refusalRows(two).entries()) {
    const [id, detail] = raw[i].split("\t");
    assert.deepEqual(Object.keys(row), ["id", "statement", "detail"]);
    assert.equal(row.id, id);
    assert.equal(row.detail, detail, "the detail is the text of the checker");
    assert.equal(row.statement, statements.get(id), "the statement is the text of plain_rule_list");
    assert.ok(row.statement && row.statement !== row.detail && row.detail, "id, statement, detail");
  }
  assert.ok(!canApprove(two) && screenRows(two).length === 0);
  // One rule that fails on two instructions: the data of AdvanceNonce and of the transfer.
  const twice = Buffer.from(v.msg);
  const advance = Buffer.from("04000000", "hex");
  const transfer = Buffer.concat([Buffer.from("02000000", "hex"), u64le(LAMPORTS)]);
  for (const needle of [advance, transfer]) {
    const at = twice.indexOf(needle);
    assert.ok(at > 0 && twice.indexOf(needle, at + 1) < 0, "the instruction data occurs once");
    twice[at] ^= 1;
  }
  const both = reviewText(c, twice, intent, pins, chain);
  assert.deepEqual(ruleIds(both), ["plain-data", "plain-data"], "one row for each instruction");
  assert.deepEqual(
    refusalRows(both).map((row) => row.detail.split(":")[0]),
    ["instruction 0", "instruction 1"],
    "the two rows keep their own detail",
  );
  assert.deepEqual(
    refusalRows(both).map((row) => `${row.id}\t${row.detail}`),
    answerLines(W.plain_check_message(twice, intent, pins, chain)),
    "the rows equal the lines of the checker",
  );
  // The early rules of the wallet stop the others: a payer equal to the group key alone, and with
  // a wrong genesis hash.
  const bad = plainPins({ cluster: "mainnet" }, keys.group, keys.group);
  assert.deepEqual(ruleIds(reviewText(c, v.msg, intent, bad, chain)), ["plain-payer"]);
  const wrong = await readChain(c, workerOf(decodeChain(v.chain), { genesis: GENESIS.devnet }),
    intent, pins);
  assert.deepEqual(
    ruleIds(reviewText(c, v.msg, intent, bad, wrong)),
    ["plain-genesis", "plain-payer"],
    "two rules that fire together give two rows",
  );
}
step("a tampered message gives one row for each broken rule");

// ── Enable USDC: the mint of the message is the pinned mint ──
{
  const keys = keysOf("mainnet");
  const pins = plainPins({ cluster: "mainnet" }, keys.group, PAYER);
  const v = vector("mainnet-s4-enable-usdc");
  const intent = intentOf("s4-enable-usdc", keys);
  const chain = await readChain(c, workerOf(decodeChain(v.chain)), intent, pins);
  const mint = Buffer.from(keyOfBase58(/^mint (\S+)$/m.exec(v.answer)[1]), "hex");
  const at = v.msg.indexOf(mint);
  assert.ok(at > 0 && v.msg.indexOf(mint, at + 1) < 0, "the mint occurs once in the message");
  const other = Buffer.from(v.msg);
  Buffer.from("66".repeat(32), "hex").copy(other, at);
  const review = reviewText(c, other, intent, pins, chain);
  assert.equal(review.kind, "refused", "another mint in the message is refused");
  assert.deepEqual(ruleIds(review), ["plain-key-table", "plain-accounts"]);
  assert.ok(!canApprove(review) && screenRows(review).length === 0, "and shows no mint row");
  const same = reviewText(c, v.msg, intent, pins, chain);
  assert.equal(screenRows(same).find((r) => r.name === "mint").value, base58(hex(mint)),
    "control: the accepted message shows the pinned mint");
}
step("a mint that is not the pinned mint is refused");

// ── Every vector, through the screen model ──
const labelled = new Set();
for (const name of names) {
  const v = vector(name);
  const review = reviewText(c, v.msg, v.intent, v.pins, v.chain);
  const [head, ...lines] = v.answer.split("\n");
  const kind = head.startsWith("error") ? "error" : head;
  assert.equal(review.kind, kind, `the kind of ${name}`);
  assert.equal(canApprove(review), kind === "accepted", `only accepted can be approved: ${name}`);
  if (kind === "accepted") {
    assert.deepEqual(screenRows(review).map((r) => `${r.name} ${r.value}`), lines, name);
    const named = lines.map((line) => line.split(" ")[0]);
    assert.deepEqual(
      screenRows(review).map((r) => [r.name, r.label]),
      named.map((n) => [n, LABEL_OF[n]]),
      `the labels of ${name}`,
    );
    named.forEach((n) => labelled.add(n));
  } else if (kind === "refused") {
    assert.deepEqual(ruleIds(review), lines.map((l) => l.split("\t")[0]), name);
    for (const row of refusalRows(review)) {
      assert.ok(statements.has(row.id), `known rule: ${row.id}`);
    }
  } else {
    assert.equal(review.text, head.slice(6), name);
  }
}
assert.deepEqual([...labelled].sort(), Object.keys(LABEL_OF).sort(), "the vectors use each label");
step("the screen model follows every native answer");

// ── readChain and encodeChain refuse what they cannot encode ──
{
  const keys = keysOf("mainnet");
  const pins = plainPins({ cluster: "mainnet" }, keys.group, PAYER);
  const intent = intentOf("s2-send-sol", keys);
  const decoded = decodeChain(vector("mainnet-s2-send-sol").chain);
  const rejects = (promise, pattern, what) => assert.rejects(promise, pattern, what);
  await rejects(readChain(c, workerOf(decoded), new Uint8Array([4, 0, 0]), pins), /./,
    "an intent of the pool is no plain intent");
  await rejects(readChain(c, workerOf(decoded), intent, new Uint8Array(66)), /cluster byte 0/,
    "pins that do not parse make no read");
  const odd = workerOf(decoded);
  const inner = odd.call;
  odd.call = async (cmd, args) => {
    const answer = await inner(cmd, args);
    return cmd === "accounts" ? { accounts: answer.accounts.slice(1) } : answer;
  };
  await rejects(readChain(c, odd, intent, pins), /another number of accounts/,
    "a short account list is no list of absent accounts");
  const lying = workerOf(decoded);
  const real = lying.call;
  lying.call = async (cmd, args) => {
    const answer = await real(cmd, args);
    if (cmd !== "accounts") return answer;
    return { accounts: answer.accounts.map((a) => (a && { ...a, data: "!!not base64" })) };
  };
  await rejects(readChain(c, lying, intent, pins), /no readable account/,
    "data that is not base64 is not an empty account");
  const noOwner = workerOf(decoded);
  const inner2 = noOwner.call;
  noOwner.call = async (cmd, args) => {
    const answer = await inner2(cmd, args);
    if (cmd !== "accounts") return answer;
    return { accounts: answer.accounts.map((a) => (a ? { ...a, owner: "1" } : a)) };
  };
  await rejects(readChain(c, noOwner, intent, pins), /no readable account/, "a short owner");
  const hole = workerOf(decoded);
  const inner3 = hole.call;
  hole.call = async (cmd, args) => {
    const answer = await inner3(cmd, args);
    return cmd === "accounts" ? { accounts: answer.accounts.map((a) => a ?? undefined) } : answer;
  };
  await rejects(readChain(c, hole, intent, pins), /no readable account/,
    "an entry that is missing is no absent account");
  for (const executable of [undefined, null, "true", 1, 0, "", {}]) {
    const odd = workerOf(decoded);
    const inner4 = odd.call;
    odd.call = async (cmd, args) => {
      const answer = await inner4(cmd, args);
      if (cmd !== "accounts") return answer;
      return { accounts: answer.accounts.map((a) => (a ? { ...a, executable } : a)) };
    };
    await rejects(readChain(c, odd, intent, pins), /no readable account/,
      `an executable flag that is not a boolean is refused: ${String(executable)}`);
  }
  const base = { genesis: decoded.genesis, rents: decoded.rents, reads: decoded.reads };
  const account = decoded.reads[0].account;
  const bad = (change, pattern, what) =>
    assert.throws(() => encodeChain({ ...base, ...change }), pattern, what);
  bad({ genesis: decoded.genesis.subarray(1) }, /genesis hash is not 32 bytes/, "short genesis");
  bad({ rents: [1n, 2n] }, /bad rents/, "two rents");
  bad({ rents: [1n, 2n, 2n ** 64n] },
    /a rent is above 18446744073709551615, the largest number in 8 bytes$/, "a rent above u64");
  bad({ reads: [{ ...decoded.reads[0], role: "boss" }] }, /not the role of a read/, "a role");
  bad({ reads: [{ ...decoded.reads[0], key: new Uint8Array(31) }] }, /address of the payer/);
  bad({ reads: [{ ...decoded.reads[0], account: { ...account, owner: new Uint8Array(3) } }] },
    /owner of the payer/, "a short owner");
  bad({ reads: [{ ...decoded.reads[0], account: { ...account, lamports: -1n } }] },
    /lamports of the payer is below 0$/, "negative lamports");
  bad({ reads: Array.from({ length: 101 }, () => decoded.reads[0]) }, /bad rents or reads/);
  const hundred = Array.from({ length: 100 }, () => decoded.reads[0]);
  assert.doesNotThrow(() => encodeChain({ ...base, reads: hundred }), "100 reads are the limit");
  const row = `payer\t${"11".repeat(32)}`;
  const stub = { plain_reads: () => Array.from({ length: 101 }, () => row).join("\n") };
  await rejects(readChain({ W: stub }, workerOf(decoded), intent, pins), /too many reads/,
    "more than 100 reads");
  const wrongRole = { plain_reads: () => `owner\t${"11".repeat(32)}` };
  await rejects(readChain({ W: wrongRole }, workerOf(decoded), intent, pins), /named the role/);
}
step("readChain and encodeChain refuse what they cannot encode");

// ── encodeChain on the edges that no vector holds ──
{
  // The hex of PlainChain::encode (wasm-sol/src/plain_chain.rs) for this chain, made with an
  // example of the crate: byte i of fill(seed, n) is (seed + 7 i) mod 256.
  const fill = (seed, length) => Uint8Array.from({ length }, (_, i) => (seed + 7 * i) & 255);
  const account = (lamports, owner, executable, data) => ({ lamports, owner, executable, data });
  const edge = {
    genesis: fill(9, 32),
    rents: [0x0102030405060708n, 2n ** 53n + 1n, 0n],
    reads: [
      { role: "recipient", key: fill(1, 32),
        account: account(2n ** 64n - 1n, fill(40, 32), true, fill(5, 300)) },
      { role: "dest", key: fill(2, 32), account: null },
      { role: "payer", key: fill(3, 32),
        account: account(2n ** 53n + 1n, fill(41, 32), false, new Uint8Array(0)) },
    ],
  };
  const rust = [
    "0910171e252c333a41484f565d646b727980878e959ca3aab1b8bfc6cdd4dbe20807060504030201010000000000",
    "20000000000000000000030401080f161d242b323940474e555c636a71787f868d949ba2a9b0b7bec5ccd3da01ff",
    "ffffffffffffff282f363d444b525960676e757c838a91989fa6adb4bbc2c9d0d7dee5ecf3fa01012c010000050c",
    "131a21282f363d444b525960676e757c838a91989fa6adb4bbc2c9d0d7dee5ecf3fa01080f161d242b323940474e",
    "555c636a71787f868d949ba2a9b0b7bec5ccd3dae1e8eff6fd040b121920272e353c434a51585f666d747b828990",
    "979ea5acb3bac1c8cfd6dde4ebf2f900070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2",
    "d9e0e7eef5fc030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dce3eaf1f8ff060d14",
    "1b222930373e454c535a61686f767d848b9299a0a7aeb5bcc3cad1d8dfe6edf4fb020910171e252c333a41484f56",
    "5d646b727980878e959ca3aab1b8bfc6cdd4dbe2e9f0f7fe050c131a21282f363d444b525960676e757c838a9198",
    "9fa6adb4bbc2c9d0d7dee5ecf3fa01080f161d242b3206020910171e252c333a41484f565d646b727980878e959c",
    "a3aab1b8bfc6cdd4db0001030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc010100",
    "0000000020002930373e454c535a61686f767d848b9299a0a7aeb5bcc3cad1d8dfe6edf4fb020000000000",
  ].join("");
  assert.equal(rust.length, 2 * 549, "the Rust chain holds 549 bytes");
  assert.equal(hex(encodeChain(edge)), rust,
    "encodeChain equals the Rust encoder: executable, 300 bytes of data, lamports above 2^53");
}
step("encodeChain equals the Rust encoder on the edges of an account");

// ── The encoders: the tags, the limits, the kinds ──
{
  const key = "ab".repeat(32);
  assert.deepEqual([...u32le(1)], [1, 0, 0, 0]);
  assert.deepEqual([...u32le(2 ** 32 - 1)], [255, 255, 255, 255]);
  assert.deepEqual([...u64le(2n ** 64n - 1n)], Array(8).fill(255));
  assert.deepEqual([...u64le("258")], [2, 1, 0, 0, 0, 0, 0, 0]);
  // The text says what is wrong: not a whole number, below 0, or above the largest number.
  const refuses = (make, value, text) => assert.throws(() => make(value, "n"),
    (e) => e instanceof RangeError && e.message === text, `${make.name} refuses ${String(value)}`);
  for (const value of [1.5, "", " 1", "1e3", null, undefined, true, {}, NaN, 2 ** 64]) {
    refuses(u32le, value, "n is not a whole number");
    refuses(u64le, value, "n is not a whole number");
  }
  for (const value of [-1, "-1", -1n, -(2 ** 40)]) {
    refuses(u32le, value, "n is below 0");
    refuses(u64le, value, "n is below 0");
  }
  for (const value of [2 ** 32, "4294967296", 2n ** 32n]) {
    refuses(u32le, value, "n is above 4294967295, the largest number in 4 bytes");
  }
  for (const value of [2n ** 64n, "18446744073709551616"]) {
    refuses(u64le, value, "n is above 18446744073709551615, the largest number in 8 bytes");
  }
  assert.throws(() => sendTokenIntent(0, NONCE, 256, key, 1n),
    (e) => e.message.endsWith("in 1 byte") && !e.message.includes("1 bytes"), "byte, not bytes");
  assert.throws(() => sendSolIntent(0, NONCE, key, 2n ** 64n),
    /the amount is above 18446744073709551615, the largest number in 8 bytes$/);
  assert.throws(() => sendSolIntent(2 ** 32, NONCE, key, 1n),
    /k is above 4294967295, the largest number in 4 bytes$/);
  assert.throws(() => sendTokenIntent(0, NONCE, 256, key, 1n),
    /the token is above 255, the largest number in 1 byte$/);
  assert.throws(() => sendTokenIntent(0, NONCE, 0, key, 2n ** 64n),
    /the amount is above 18446744073709551615, the largest number in 8 bytes$/);
  assert.throws(() => createNonceIntent(2 ** 32, BLOCKHASH), /k is above 4294967295/);
  assert.throws(() => cancelIntent(2 ** 32, NONCE), /k is above 4294967295/);
  for (const intent of [createNonceIntent(7, BLOCKHASH), cancelIntent(7, NONCE)]) {
    assert.deepEqual(Array.from(intent.slice(1, 5)), [7, 0, 0, 0], "k is written");
  }
  assert.throws(() => enableTokenIntent(-1, BLOCKHASH), /the token is below 0$/);
  const badKeys = ["", "ab", key.slice(1), key + "00", key.toUpperCase(), "zz".repeat(32), null];
  for (const bad of badKeys) {
    assert.throws(() => sendSolIntent(0, NONCE, bad, 1n), /the recipient is not 32 bytes of hex/);
    assert.throws(() => cancelIntent(0, bad), /the nonce value is not 32 bytes of hex/);
    assert.throws(() => createNonceIntent(0, bad), /the blockhash is not 32 bytes of hex/);
  }
  const tags = [createNonceIntent(0, BLOCKHASH), sendSolIntent(0, NONCE, key, 1n),
    sendTokenIntent(0, NONCE, 0, key, 1n), enableTokenIntent(0, BLOCKHASH), cancelIntent(0, NONCE)];
  assert.deepEqual(tags.map((x) => x[0]), [13, 14, 15, 16, 17]);
  assert.deepEqual(tags.map((x) => x.length), [37, 77, 78, 34, 37]);
  assert.deepEqual(tags.map((x) => kindOfIntent(hex(x))),
    ["create-nonce", "send-sol", "send-token", "enable-token", "cancel"], "the five tags");
  const pool = Uint8Array.of(4, ...tags[2].slice(1));
  assert.equal(kindOfIntent(hex(pool)), null, "a pool tag is no plain kind");
  const first = hex(tags[0]);
  const badKinds = ["", "0d", first.slice(2), first + "00", "zz", null, undefined, 13];
  for (const bad of badKinds) {
    assert.equal(kindOfIntent(bad), null, `no kind for ${String(bad)}`);
  }
  assert.equal(kindOfIntent(hex(tags[1]).replace(/^0e/, "0d")), null, "a tag with another length");
}
step("the encoders refuse a field that wraps, and kindOfIntent reads the tag");
