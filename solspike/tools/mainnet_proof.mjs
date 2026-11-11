#!/usr/bin/env node
// Read-only proof checker for the owner run of the private Solana wallet on mainnet (slice 8,
// design steps 5.6 to 5.11). It calls only getSignaturesForAddress and getTransaction.
//
//   node solspike/tools/mainnet_proof.mjs --fee <addr> [--fee <addr>] --recipient <addr>
//     [--since-slot N] [--sig <signature>]... [--rpc URL] [--out DIR] [--max-calls N]
//     [--shield-lamports N] [--withdraw-lamports N] [--limit N]
//
// The layouts come from the Zigs source: tags and accounts from sol-program/src (lib.rs,
// instructions.rs, state.rs, approval.rs), the shield and transact accounts from
// wasm-sol/src/template.rs. The pool SOL sits in the SOL interface account, not in tree 0: a SOL
// deposit leaves tree 0 unchanged. The self-check is solspike/test/mainnet-proof.test.mjs.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const K = {
  RING1G: "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW",
  APPROVALS: "9mE7WUJHK6dQwzK6AP6wf1eyPmePULZrGeRbXqke2ukq",
  ED25519: "Ed25519SigVerify111111111111111111111111111",
  SYSVAR_IX: "Sysvar1nstructions1111111111111111111111111",
  SYSTEM: "11111111111111111111111111111111",
  BUDGET: "ComputeBudget111111111111111111111111111111",
  TREE0: "777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor",
  INTERFACE: "CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE",
  GENESIS: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};
export const DEPLOY_SLOT_9ME7 = 468153564;
export const POOL_TAG = { DEPOSIT: 15, TRANSACT: 16 };
export const RENT_PER_BYTE = 5080;
export const PROPOSAL_RENT = 1_356_360n;
export const NULLIFIER_RENT = 706_120n;
export const CAP = 500_000_000n;
export const APPROVAL_DOMAIN = "Zigs_SolApproval_v1";
// CANONICAL_HEAD of sol-program/src/approval.rs: count 1, pad 0, offsets as u16 LE.
export const ED_HEAD = [1, 0, 48, 0, 255, 255, 16, 0, 255, 255, 112, 0, 32, 0, 255, 255];
const ED_LEN = 144;
const DEFAULTS = { shield: 50_000_000n, withdraw: 10_000_000n };
const TX_OPTS = { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "finalized" };

// ---- base58 and byte helpers ------------------------------------------------------------------
const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58dec(text) {
  let n = 0n;
  for (const ch of text) {
    const at = ALPHA.indexOf(ch);
    if (at < 0) throw new Error("bad base58 character");
    n = n * 58n + BigInt(at);
  }
  const bytes = [];
  for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 255n));
  const zeros = text.length - text.replace(/^1+/, "").length;
  return Uint8Array.from([...Array.from({ length: zeros }, () => 0), ...bytes]);
}
export function b58enc(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  for (; n > 0n; n /= 58n) out = ALPHA[Number(n % 58n)] + out;
  const zeros = bytes.findIndex((b) => b !== 0);
  return "1".repeat(zeros < 0 ? bytes.length : zeros) + out;
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sha256 = (...parts) => {
  const h = createHash("sha256");
  parts.forEach((p) => h.update(p));
  return new Uint8Array(h.digest());
};
const u64le = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(at, true);
const u32le = (bytes) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
export const fmtSol = (l) => {
  const v = BigInt(l), sign = v < 0n ? "-" : "", a = v < 0n ? -v : v;
  const frac = (a % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${sign}${a / 1_000_000_000n}${frac ? "." + frac : ""} SOL`;
};
const utc = (t) =>
  (t ? new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ") + "Z" : "?");
export const explorer = (sig) => `https://explorer.solana.com/tx/${sig}`;

// ---- one transaction, decoded -----------------------------------------------------------------
/** Decodes a getTransaction answer (encoding json) into the parts that the checks read. */
export function decode(sig, r) {
  const m = r.transaction.message;
  const loaded = r.meta.loadedAddresses ?? {};
  const keys = [...m.accountKeys, ...(loaded.writable ?? []), ...(loaded.readonly ?? [])];
  const ix = (i) => ({
    prog: keys[i.programIdIndex],
    accts: i.accounts.map((a) => keys[a]),
    data: b58dec(i.data),
  });
  const pre = new Map(keys.map((k, i) => [k, BigInt(r.meta.preBalances[i])]));
  const post = new Map(keys.map((k, i) => [k, BigInt(r.meta.postBalances[i])]));
  const delta = new Map(keys.map((k) => [k, post.get(k) - pre.get(k)]));
  const inner = (r.meta.innerInstructions ?? []).map((g) => ({
    index: g.index,
    ixs: g.instructions.map(ix),
  }));
  return {
    sig, slot: r.slot, time: r.blockTime, version: r.version, err: r.meta.err,
    fee: BigInt(r.meta.fee), cu: r.meta.computeUnitsConsumed, keys,
    signers: r.transaction.signatures.length, required: m.header?.numRequiredSignatures,
    ixs: m.instructions.map(ix), inner, delta, pre, post,
  };
}
const d = (tx, k) => tx.delta.get(k) ?? 0n;
const programs = (tx) => [...new Set(tx.ixs.map((i) => i.prog))].sort();

// ---- the checks -------------------------------------------------------------------------------
const mk = () => {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail: String(detail) });
  return { checks, add };
};

function commonChecks(tx, add, ctx, zigs) {
  add("meta.err is null", tx.err === null, JSON.stringify(tx.err));
  add("read at finalized commitment", ctx.finalized !== false, "getTransaction at finalized");
  const sum = [...tx.delta.values()].reduce((a, b) => a + b, 0n);
  add("lamports are conserved (sum of deltas = -fee)", sum === -tx.fee, `sum ${sum}`);
  if (!zigs) return;
  add("message version is 1", tx.version === 1, `version ${tx.version}`);
  add("one required signature", tx.required === 1 && tx.signers === 1, `${tx.required}`);
  add("signer is a fee address", ctx.fees.has(tx.keys[0]), tx.keys[0]);
}

const progs = (tx, add, ...want) =>
  add("top-level programs are exactly the Zigs set", same(programs(tx), want.sort()),
    programs(tx).join(","));

/** The body of a create instruction (data after the tag), parsed by state.rs. */
export function parseBody(body) {
  if (body.length < 105) return null;
  const count = body[104];
  if (count > 4 || body.length !== 105 + 32 * count) return null;
  const at = (a, b) => body.slice(a, b);
  return {
    commitment: at(0, 32), group: at(32, 64), expiry: u64le(body, 64), rentRecipient: at(72, 104),
    authorities: Array.from({ length: count }, (_, i) => at(105 + 32 * i, 137 + 32 * i)), body,
  };
}

function checkCreate(tx, add) {
  progs(tx, add, K.APPROVALS);
  const ix = tx.ixs.find((i) => i.prog === K.APPROVALS);
  const a = ix.accts, payer = tx.keys[0];
  add("create has accounts [payer, proposal, System]",
    a.length === 3 && a[0] === payer && a[2] === K.SYSTEM, a.length);
  const body = parseBody(ix.data.slice(1));
  add("proposal body parses (state.rs)", body, `data ${ix.data.length} bytes`);
  if (!body) return { kind: "create" };
  const proposal = a[1];
  const rent = BigInt(128 + 2 + body.body.length) * BigInt(RENT_PER_BYTE);
  add("proposal account is new and holds the rent of its size",
    tx.pre.get(proposal) === 0n && tx.post.get(proposal) === rent, `post ${tx.post.get(proposal)}`);
  add("proposal rent is 1,356,360 (one abort authority)",
    body.body.length !== 137 || rent === PROPOSAL_RENT);
  const rentTo = b58enc(body.rentRecipient);
  add("rent recipient is the payer", rentTo === payer, rentTo);
  add("payer paid rent and fee", d(tx, payer) === -(rent + tx.fee), `delta ${d(tx, payer)}`);
  const expiry = Number(body.expiry);
  return { kind: "create", proposal, group: b58enc(body.group), body, rent, expiry, ix };
}

function approvalOf(tx, at) {
  const ed = tx.ixs[at - 1];
  return ed?.prog === K.ED25519 && ed.accts.length === 0 ? ed.data : null;
}

function executeShape(tx, add, at) {
  const a = tx.ixs[at].accts;
  const ed = approvalOf(tx, at);
  add("Ed25519 instruction with no accounts is right before execute", ed !== null);
  const head = ed !== null && ed.length === ED_LEN && same(ed.slice(0, 16), ED_HEAD);
  add("Ed25519 data has 144 bytes and the canonical head", head);
  add("execute has the fixed prefix with the Instructions sysvar",
    a.length >= 12 && a[0] === tx.keys[0] && a[5] === K.SYSVAR_IX, `accounts ${a.length}`);
  return ed;
}

function executeTransact(tx, add, a, withdraw) {
  const end = a.length - (withdraw ? 3 : 1);
  const nullifiers = a.slice(11, end);
  const head = [tx.keys[0], K.TREE0, K.RING1G, K.SYSTEM, K.TREE0];
  add("transact head: payer, tree, pool, System, tree", same(a.slice(6, 11), head));
  add("the owner PDA is passed again after the nullifiers", a[end] === a[2]);
  const fresh = (k) => tx.post.get(k) === NULLIFIER_RENT && tx.pre.get(k) === 0n;
  add("nullifier accounts each hold 706,120 after the call",
    nullifiers.length >= 1 && nullifiers.every(fresh), `${nullifiers.length} accounts`);
  return nullifiers;
}

function executeCpi(tx, add, at) {
  const data = tx.ixs[at].data;
  const group = tx.inner.find((g) => g.index === at);
  const isTransact = (i) => i.prog === K.RING1G && i.data[0] === POOL_TAG.TRANSACT;
  const cpi = group?.ixs.find(isTransact);
  add("CPI into ring1G transact (tag 16) with the same data",
    cpi !== undefined && same(cpi.data.slice(1), data.slice(1)));
}

function executeMoney(tx, add, a, nullifiers) {
  const proposal = a[1], rentTo = a[4], payer = tx.keys[0];
  add("the proposal account closes and gives back 1,356,360",
    tx.pre.get(proposal) === PROPOSAL_RENT && tx.post.get(proposal) === 0n,
    `pre ${tx.pre.get(proposal)} post ${tx.post.get(proposal)}`);
  const treeFee = d(tx, K.TREE0) + NULLIFIER_RENT * BigInt(nullifiers.length);
  const back = rentTo === payer ? PROPOSAL_RENT : 0n;
  const rentBack = rentTo === payer
    ? d(tx, payer) === PROPOSAL_RENT - tx.fee - treeFee : d(tx, rentTo) === PROPOSAL_RENT;
  add("rent recipient gains the rent", rentBack, `delta ${d(tx, rentTo)}`);
  add("tree fee is within the cap of 10,000", treeFee >= 0n && treeFee <= 10_000n, `${treeFee}`);
  add("executor paid fee and tree fee", d(tx, payer) === back - tx.fee - treeFee,
    `delta ${d(tx, payer)}`);
  return { proposal, rentTo, treeFee };
}

function executeLeg(tx, add, a, withdraw, rentTo) {
  const iface = d(tx, K.INTERFACE);
  if (!withdraw) {
    add("send: the SOL interface does not change", iface === 0n, `interface ${iface}`);
    return { kind: "execute" };
  }
  const to = a[a.length - 1], amount = -iface;
  const ok = amount > 0n && d(tx, to) === amount && to !== tx.keys[0] && to !== rentTo;
  add("withdraw: the SOL interface loses the amount and the recipient gains it", ok,
    `interface ${iface}, recipient ${d(tx, to)}`);
  return { kind: "withdraw", recipient: to, amount };
}

const softsOf = (tx, treeFee) => [
  tx.fee === 10_000n ? null : `executor fee is ${tx.fee}, expected 10,000`,
  treeFee === 5_000n ? null : `tree fee is ${treeFee}, expected 5,000`,
].filter(Boolean);

function checkExecute(tx, add) {
  progs(tx, add, K.ED25519, K.APPROVALS);
  const at = tx.ixs.findIndex((i) => i.prog === K.APPROVALS);
  const a = tx.ixs[at].accts;
  const ed = executeShape(tx, add, at);
  if (a.length < 12) return { kind: "execute" };
  const withdraw = a[a.length - 2] === K.INTERFACE;
  const nullifiers = executeTransact(tx, add, a, withdraw);
  executeCpi(tx, add, at);
  const money = executeMoney(tx, add, a, nullifiers);
  tx.softs = softsOf(tx, money.treeFee);
  const approval = { ed, group: ed?.slice(16, 48), digestMessage: ed?.slice(112, 144) };
  const leg = executeLeg(tx, add, a, withdraw, money.rentTo);
  return { ...leg, ...money, ...approval, nullifiers: nullifiers.length };
}

function checkCancel(tx, add) {
  progs(tx, add, K.APPROVALS);
  const ix = tx.ixs.find((i) => i.prog === K.APPROVALS), a = ix.accts;
  add("cancel has [payer, proposal, cancellation, rent recipient, System] and no data",
    a.length >= 5 && a[0] === tx.keys[0] && a[4] === K.SYSTEM && ix.data.length === 1);
  const rentTo = a[3], rent = tx.pre.get(a[1]);
  add("the proposal account closes", rent > 0n && tx.post.get(a[1]) === 0n);
  const back = rentTo === tx.keys[0] ? d(tx, rentTo) > -tx.fee : d(tx, rentTo) === rent;
  add("the rent goes back to the rent recipient", back, `delta ${d(tx, rentTo)}`);
  return { kind: "cancel", proposal: a[1], rent };
}

function checkClose(tx, add) {
  const ix = tx.ixs.find((i) => i.prog === K.APPROVALS);
  add("close-cancelled has 4 accounts and no data", ix.accts.length === 4 && ix.data.length === 1);
  return { kind: "close" };
}

function checkShield(tx, add) {
  progs(tx, add, K.RING1G);
  const ix = tx.ixs.find((i) => i.prog === K.RING1G), payer = tx.keys[0];
  const want = [K.TREE0, payer, K.RING1G, K.SYSTEM, K.INTERFACE];
  add("shield accounts [tree 0, payer, pool, System, SOL interface]", same(ix.accts, want));
  const amount = d(tx, K.INTERFACE);
  add("the SOL interface gains the amount", amount > 0n, `interface ${amount}`);
  add("tree 0 does not change (a deposit pays no tree fee)", d(tx, K.TREE0) === 0n,
    `tree ${d(tx, K.TREE0)}`);
  add("payer paid the amount and the fee", d(tx, payer) === -(amount + tx.fee),
    `delta ${d(tx, payer)}`);
  add("amount is within the cap of 0.5 SOL", amount <= CAP, fmtSol(amount));
  return { kind: "shield", amount };
}

const isFunding = (ctx) => (i) =>
  i.prog === K.SYSTEM && i.data.length === 12 && i.accts.length === 2 && u32le(i.data) === 2
  && ctx.fees.has(i.accts[1]);

function checkFunding(tx, add, ctx) {
  const moves = tx.ixs.filter(isFunding(ctx));
  const amount = moves.reduce((s, i) => s + u64le(i.data, 4), 0n);
  const to = moves[0].accts[1];
  const plain = (i) => i.prog === K.SYSTEM || i.prog === K.BUDGET;
  add("only System transfers (and compute budget) in the message", tx.ixs.every(plain));
  add("the fee address gains the transferred amount", d(tx, to) >= amount, `delta ${d(tx, to)}`);
  return { kind: "funding", amount, to };
}

const APPROVAL_KINDS = { 0: "create", 1: "execute", 2: "cancel", 3: "close" };

/** The kind of a transaction, from its instructions (no check yet). */
export function kindOf(tx, ctx) {
  const zig = tx.ixs.find((i) => i.prog === K.APPROVALS);
  if (zig) return APPROVAL_KINDS[zig.data[0]] ?? "9mE7-unknown";
  const pool = tx.ixs.find((i) => i.prog === K.RING1G);
  if (pool) return pool.data[0] === POOL_TAG.DEPOSIT ? "shield" : "pool-direct";
  return tx.ixs.some(isFunding(ctx)) ? "funding" : "other";
}

const HANDLERS = { create: checkCreate, execute: checkExecute, cancel: checkCancel,
  close: checkClose, shield: checkShield, funding: checkFunding };
const ZIGS_KINDS = new Set(["create", "execute", "cancel", "close", "shield"]);
// A fee address must never call the pool or the approvals program outside the Zigs steps. Any
// other transaction (a dust transfer, a memo) is only a warning.
const FAIL_KINDS = new Set(["pool-direct", "9mE7-unknown"]);
// The steps whose landing closes G6.
const LANDED_KINDS = new Set(["create", "execute", "withdraw", "shield", "cancel"]);

/** Classifies and checks one decoded transaction. Returns { kind, checks, facts }. */
export function classify(tx, ctx) {
  const { checks, add } = mk();
  const kind = kindOf(tx, ctx);
  commonChecks(tx, add, ctx, ZIGS_KINDS.has(kind));
  const facts = HANDLERS[kind] ? HANDLERS[kind](tx, add, ctx) : { kind };
  if (FAIL_KINDS.has(kind)) add("this transaction is a step of the owner run", false, kind);
  return { kind: facts.kind, facts, checks, softs: tx.softs ?? [] };
}

// ---- the whole run ----------------------------------------------------------------------------
/** Digest of an approval: SHA-256(domain, genesis, program id, proposal, body). */
export function approvalDigest(proposal, body) {
  const domain = new TextEncoder().encode(APPROVAL_DOMAIN);
  return sha256(domain, b58dec(K.GENESIS), b58dec(K.APPROVALS), b58dec(proposal), body);
}

function linkOne(r, create) {
  const add = (name, ok, detail = "") => r.checks.push({ name, ok: !!ok, detail: String(detail) });
  if (!create) {
    add("an execute links to a create of this run (proposal, group key, digest)", false, "none");
    return;
  }
  r.create = create.sig;
  const body = create.facts.body, f = r.facts;
  add("create came first", create.slot <= r.slot, `${create.slot} <= ${r.slot}`);
  add("Ed25519 key is the group key of the create body", f.group && same(f.group, body.group));
  add("rent recipient of the body is the one of the execute",
    b58enc(body.rentRecipient) === f.rentTo);
  const digest = approvalDigest(create.facts.proposal, body.body);
  add("Ed25519 message is the approval digest of the body",
    f.digestMessage && same(f.digestMessage, digest));
  add("the execute ran before the expiry of the body", r.time <= create.facts.expiry,
    `${r.time} <= ${create.facts.expiry}`);
}

/** Checks the link of each execute to its create: proposal, group key, rent recipient, digest. */
function linkChecks(rows) {
  const creates = rows.filter((x) => x.kind === "create" && x.facts.body);
  for (const r of rows.filter((x) => x.kind === "execute" || x.kind === "withdraw")) {
    const proposal = r.facts.proposal;
    linkOne(r, proposal && creates.find((x) => x.facts.proposal === proposal));
  }
}

const short = (r) => `${r.kind} ${r.sig.slice(0, 8)}`;

function coverage(of, opts) {
  const failed = [];
  const need = (name, ok) => { if (!ok) failed.push(`coverage: ${name}`); };
  const shield = opts.shieldLamports ?? DEFAULTS.shield;
  const withdraw = opts.withdrawLamports ?? DEFAULTS.withdraw;
  const toRecipient = (r) => !opts.recipient || r.facts.recipient === opts.recipient;
  need("a fee address was funded", of("funding").length >= 1);
  need(`one shield of ${fmtSol(shield)}`, of("shield").some((r) => r.facts.amount === shield));
  need("a private send executed (create linked, digest verified)",
    of("execute").some((r) => r.create && r.checks.every((c) => c.ok)));
  need(`a withdrawal of ${fmtSol(withdraw)} to the recipient`,
    of("withdraw").some((r) => r.facts.amount === withdraw && toRecipient(r)));
  return failed;
}

function warningsOf(rows, of) {
  const warnings = rows.flatMap((r) => r.softs.map((s) => `${short(r)}: ${s}`));
  const done = new Set([...of("execute"), ...of("withdraw"), ...of("cancel")]
    .map((r) => r.facts.proposal));
  of("create").filter((r) => !done.has(r.facts.proposal))
    .forEach((r) => warnings.push(`${short(r)}: open proposal, rent not back yet`));
  rows.filter((r) => r.kind === "other")
    .forEach((r) => warnings.push(`${r.sig.slice(0, 8)}: not a step of the run (other)`));
  return warnings;
}

/**
 * The verdict over decoded transactions. `txs` is a list of { sig, tx, finalized }.
 * `opts`: fees (Set or list), recipient, shieldLamports, withdrawLamports.
 */
export function analyze(txs, opts) {
  const ctx = { fees: new Set(opts.fees) };
  const rows = txs.map(({ sig, tx, finalized }) => {
    const res = classify(tx, { ...ctx, finalized });
    return { sig, slot: tx.slot, time: tx.time, version: tx.version, cu: tx.cu, ...res };
  }).sort((a, b) => a.slot - b.slot);
  linkChecks(rows);
  const of = (k) => rows.filter((r) => r.kind === k);
  const failed = rows.flatMap((r) =>
    r.checks.filter((c) => !c.ok).map((c) => `${short(r)}: ${c.name}`));
  failed.push(...coverage(of, opts));
  const sum = (k) => of(k).reduce((s, r) => s + r.facts.amount, 0n);
  const balance = sum("shield") - sum("withdraw");
  const room = CAP > balance ? CAP - balance : 0n;
  const zigsV1 = rows.find((r) => LANDED_KINDS.has(r.kind) && r.version === 1
    && r.checks.every((c) => c.ok));
  const warnings = warningsOf(rows, of);
  return { rows, failed, warnings, verdict: failed.length ? "FAIL" : "PASS", room, zigsV1 };
}

// ---- report -----------------------------------------------------------------------------------
const STEP = { funding: "Fund fee address", shield: "Shield (Add SOL)", create: "Create proposal",
  execute: "Execute private send", withdraw: "Execute withdrawal", cancel: "Cancel proposal",
  close: "Close cancellation", "pool-direct": "Pool call (not Zigs)", other: "Other" };
const AMOUNT = {
  create: (f) => `rent ${fmtSol(f.rent ?? 0n)}`,
  execute: () => "hidden (private)",
  cancel: (f) => `rent back ${fmtSol(f.rent ?? 0n)}`,
};
const amountOf = (r) =>
  AMOUNT[r.kind]?.(r.facts) ?? (r.facts.amount === undefined ? "-" : fmtSol(r.facts.amount));
const resultOf = (r) => {
  const bad = r.checks.filter((c) => !c.ok).map((c) => c.name);
  return bad.length ? "FAIL: " + bad.join("; ") : "OK";
};

/** The markdown report of a result of analyze(). */
export function render(result, meta) {
  const lines = ["# Zolana mainnet proof report", "",
    `Checked at ${meta.at}. RPC ${meta.rpc}. RPC calls: ${meta.calls} of ${meta.maxCalls}.`,
    `Fee addresses: ${[...meta.fees].join(", ")}. Recipient: ${meta.recipient ?? "not given"}.`,
    "", "| Step | Signature | Slot | UTC time | Explorer | Amount | Result |",
    "|---|---|---|---|---|---|---|"];
  for (const r of result.rows) {
    lines.push(`| ${STEP[r.kind] ?? r.kind} | ${r.sig.slice(0, 12)}... | ${r.slot} | `
      + `${utc(r.time)} | [link](${explorer(r.sig)}) | ${amountOf(r)} | ${resultOf(r)} |`);
  }
  lines.push("", `Room under the cap after the run (one wallet): ${fmtSol(result.room)}. `
    + "The cap check of step 5.11 leaves no transaction. The owner reports it.");
  result.warnings.forEach((w) => lines.push(`Warning: ${w}`));
  const g6 = result.zigsV1
    ? `G6: CLOSED by ${result.zigsV1.sig} (finalized, version 1, every check passed).`
    : "G6: stays open. No finalized version 1 Zigs message passed every check.";
  lines.push("", "Rule: a landed version 1 Zigs message closes G6.", g6, "",
    result.verdict === "PASS" ? "PASS" : "FAIL: " + result.failed.join(" | "));
  return lines.join("\n") + "\n";
}

// ---- RPC and command line ---------------------------------------------------------------------
/** A JSON-RPC caller with a call budget, a gap between calls and a back-off on HTTP 429. */
export function makeRpc(url, maxCalls, gapMs = 1000) {
  const state = { calls: 0, last: 0 };
  const call = async (method, params) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (state.calls >= maxCalls) throw new Error(`RPC call budget of ${maxCalls} is used`);
      const wait = state.last + gapMs * (attempt + 1) - Date.now();
      if (wait > 0) await new Promise((x) => setTimeout(x, wait));
      state.calls++;
      state.last = Date.now();
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
      const headers = { "content-type": "application/json" };
      const res = await fetch(url, { method: "POST", headers, body });
      if (res.status === 429) continue;
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      const out = await res.json();
      if (out.error) throw new Error(`${method}: ${JSON.stringify(out.error)}`);
      return out.result;
    }
    throw new Error(`${method}: rate limited (HTTP 429) after 4 tries`);
  };
  return { call, state };
}

const redact = (u) => {
  try {
    return new URL(u).origin;
  } catch {
    return "(invalid URL)";
  }
};

const OPTION = { "--fee": "fee", "--sig": "sig", "--recipient": "recipient", "--rpc": "rpc",
  "--out": "out", "--since-slot": "sinceSlot", "--max-calls": "maxCalls", "--limit": "limit",
  "--shield-lamports": "shieldLamports", "--withdraw-lamports": "withdrawLamports" };
const NUMBER_KEYS = new Set(["sinceSlot", "maxCalls", "limit"]);
const BIGINT_KEYS = new Set(["shieldLamports", "withdrawLamports"]);
const convert = (key, v) => {
  if (NUMBER_KEYS.has(key)) return Number(v);
  return BIGINT_KEYS.has(key) ? BigInt(v) : v;
};

/** Parses the command line. Throws on an unknown option or a missing value. */
export function parseArgs(argv) {
  const o = { fee: [], sig: [], rpc: "https://api.mainnet-beta.solana.com",
    sinceSlot: DEPLOY_SLOT_9ME7, maxCalls: 40, limit: 100, out: process.cwd() };
  for (let i = 0; i < argv.length; i += 2) {
    const key = OPTION[argv[i]];
    if (!key || argv[i + 1] === undefined) throw new Error(`bad option ${argv[i]}`);
    if (Array.isArray(o[key])) o[key].push(argv[i + 1]);
    else o[key] = convert(key, argv[i + 1]);
  }
  if (!o.fee.length && !o.sig.length) throw new Error("give --fee <address> or --sig <signature>");
  return o;
}

async function listSignatures(call, o) {
  const listed = new Map();
  for (const fee of o.fee) {
    const opts = { limit: o.limit, commitment: "finalized" };
    const rows = await call("getSignaturesForAddress", [fee, opts]);
    if (rows.length === o.limit) console.error(`warning: ${fee} may hold more rows`);
    rows.filter((r) => r.slot >= o.sinceSlot).forEach((r) => listed.set(r.signature, r));
  }
  o.sig.forEach((s) => listed.set(s, listed.get(s) ?? { signature: s }));
  return [...listed.values()];
}

async function fetchAll(call, rows) {
  const txs = [];
  for (const row of rows.filter((r) => !r.err)) {
    const r = await call("getTransaction", [row.signature, TX_OPTS]);
    if (!r) {
      console.error(`not found at finalized: ${row.signature}`);
      continue;
    }
    const finalized = (row.confirmationStatus ?? "finalized") === "finalized";
    txs.push({ sig: row.signature, tx: decode(row.signature, r), finalized });
  }
  return txs;
}

const jsonSafe = (k, v) => {
  if (typeof v === "bigint") return v.toString();
  return v instanceof Uint8Array ? undefined : v;
};

function writeReport(o, result, meta) {
  const rows = result.rows.map((r) => ({ step: STEP[r.kind] ?? r.kind, kind: r.kind,
    signature: r.sig, slot: r.slot, time: utc(r.time), explorer: explorer(r.sig),
    amount: amountOf(r), result: resultOf(r), version: r.version, computeUnits: r.cu,
    linkedCreate: r.create ?? null, checks: r.checks }));
  const json = { meta, verdict: result.verdict, failed: result.failed, warnings: result.warnings,
    g6: result.zigsV1 ? "closed" : "open", rows };
  fs.mkdirSync(o.out, { recursive: true });
  const md = render(result, meta);
  fs.writeFileSync(path.join(o.out, "mainnet-proof-report.md"), md);
  const file = path.join(o.out, "mainnet-proof-report.json");
  fs.writeFileSync(file, JSON.stringify(json, jsonSafe, 1));
  console.log(md);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { call, state } = makeRpc(o.rpc, o.maxCalls);
  const rows = await listSignatures(call, o);
  const txs = await fetchAll(call, rows);
  const result = analyze(txs, { fees: o.fee, recipient: o.recipient,
    shieldLamports: o.shieldLamports, withdrawLamports: o.withdrawLamports });
  rows.filter((r) => r.err).forEach((r) =>
    result.warnings.push(`${r.signature.slice(0, 8)}: failed on chain (meta.err), not counted`));
  const meta = { at: new Date().toISOString(), rpc: redact(o.rpc), calls: state.calls,
    maxCalls: o.maxCalls, fees: o.fee, recipient: o.recipient };
  writeReport(o, result, meta);
  process.exitCode = result.verdict === "PASS" ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(2);
  });
}
