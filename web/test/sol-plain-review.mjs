// The wire format, the chain bundle and the checker screen of the plain Solana intents S1 to S5
// (web/sol/plain/intent.js, chain.js, review.js) against the real wasm. The native vectors of
// wasm-sol/vectors/plain (written by the Rust encoders, pinned by wasm-sol/tests/plain_sign.rs)
// are the control of the encoders: the intent, the pins and the chain bundle that this page builds
// must equal their bytes, and the checker must answer with their text. The Worker is a fake that
// runs checkCommand of guard.js on every call and answers from the chain of a vector. It shows:
// the encoders equal the Rust ones; readChain asks only for the addresses of plain_reads, the
// genesis hash and the three rents; the screen shows the lines of the checker one for one and
// builds nothing from the intent; a refusal gives one row for each rule; an error gives no way to
// approve. Run: node web/test/sol-plain-review.mjs   (Node 26)
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
 * A fake plain Worker that answers from a decoded chain. `log` keeps every call. `genesis` and
 * `skip` change the answer: another genesis hash, and the roles whose account is not given.
 */
function workerOf(decoded, { genesis, skip = [] } = {}) {
  const log = [];
  const table = new Map(
    decoded.reads.filter((r) => !skip.includes(r.role)).map((r) => [base58(hex(r.key)), r.account]),
  );
  const answers = {
    genesis: () => ({ genesis: genesis ?? base58(hex(decoded.genesis)) }),
    rent: ({ space }) => ({ lamports: String(decoded.rents[RENT_SPACES.indexOf(space)]) }),
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
  const attack = "Attack1111111111111111111111111111111111111";
  const proposal = { intent: hex(intent), pins: hex(pins), reads: [attack] };
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
  assert.ok(!asked.some((a) => proposal.reads.includes(a)), "an address of a proposal is not read");
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
}
step("an error and a refusal give no way to approve and no rows");

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

// ── Every vector, through the screen model ──
for (const name of names) {
  const v = vector(name);
  const review = reviewText(c, v.msg, v.intent, v.pins, v.chain);
  const [head, ...lines] = v.answer.split("\n");
  const kind = head.startsWith("error") ? "error" : head;
  assert.equal(review.kind, kind, `the kind of ${name}`);
  assert.equal(canApprove(review), kind === "accepted", `only accepted can be approved: ${name}`);
  if (kind === "accepted") {
    assert.deepEqual(screenRows(review).map((r) => `${r.name} ${r.value}`), lines, name);
  } else if (kind === "refused") {
    assert.deepEqual(ruleIds(review), lines.map((l) => l.split("\t")[0]), name);
    for (const row of refusalRows(review)) {
      assert.ok(statements.has(row.id), `known rule: ${row.id}`);
    }
  } else {
    assert.equal(review.text, head.slice(6), name);
  }
}
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
  const base = { genesis: decoded.genesis, rents: decoded.rents, reads: decoded.reads };
  const account = decoded.reads[0].account;
  const bad = (change, pattern, what) =>
    assert.throws(() => encodeChain({ ...base, ...change }), pattern, what);
  bad({ genesis: decoded.genesis.subarray(1) }, /genesis hash is not 32 bytes/, "short genesis");
  bad({ rents: [1n, 2n] }, /bad rents/, "two rents");
  bad({ rents: [1n, 2n, 2n ** 64n] }, /does not fit in 8 bytes/, "a rent above u64");
  bad({ reads: [{ ...decoded.reads[0], role: "boss" }] }, /not the role of a read/, "a role");
  bad({ reads: [{ ...decoded.reads[0], key: new Uint8Array(31) }] }, /address of the payer/);
  bad({ reads: [{ ...decoded.reads[0], account: { ...account, owner: new Uint8Array(3) } }] },
    /owner of the payer/, "a short owner");
  bad({ reads: [{ ...decoded.reads[0], account: { ...account, lamports: -1n } }] },
    /lamports of the payer does not fit/, "negative lamports");
  bad({ reads: Array.from({ length: 101 }, () => decoded.reads[0]) }, /bad rents or reads/);
  const row = `payer\t${"11".repeat(32)}`;
  const stub = { plain_reads: () => Array.from({ length: 101 }, () => row).join("\n") };
  await rejects(readChain({ W: stub }, workerOf(decoded), intent, pins), /too many reads/,
    "more than 100 reads");
  const wrongRole = { plain_reads: () => `owner\t${"11".repeat(32)}` };
  await rejects(readChain({ W: wrongRole }, workerOf(decoded), intent, pins), /named the role/);
}
step("readChain and encodeChain refuse what they cannot encode");

// ── The encoders: the tags, the limits, the kinds ──
{
  const key = "ab".repeat(32);
  assert.deepEqual([...u32le(1)], [1, 0, 0, 0]);
  assert.deepEqual([...u32le(2 ** 32 - 1)], [255, 255, 255, 255]);
  assert.deepEqual([...u64le(2n ** 64n - 1n)], Array(8).fill(255));
  assert.deepEqual([...u64le("258")], [2, 1, 0, 0, 0, 0, 0, 0]);
  for (const value of [-1, 2 ** 32, 1.5, "", "-1", " 1", "1e3", null, undefined, true, {}]) {
    assert.throws(() => u32le(value), RangeError, `u32le refuses ${String(value)}`);
  }
  for (const value of [-1n, 2n ** 64n, 2 ** 64, "18446744073709551616", NaN]) {
    assert.throws(() => u64le(value), RangeError, `u64le refuses ${String(value)}`);
  }
  assert.throws(() => sendSolIntent(0, NONCE, key, 2n ** 64n), /the amount does not fit/);
  assert.throws(() => sendSolIntent(2 ** 32, NONCE, key, 1n), /k does not fit/);
  assert.throws(() => sendTokenIntent(0, NONCE, 256, key, 1n), /the token does not fit/);
  assert.throws(() => enableTokenIntent(-1, BLOCKHASH), /the token does not fit/);
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
