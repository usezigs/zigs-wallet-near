// Self-check of solspike/tools/mainnet_proof.mjs. Nothing reads the network.
// The fixtures in fixtures/mainnet-proof are third-party mainnet transactions saved from
// getTransaction. No Zigs 9mE7 transaction had landed when this was written, so the Zigs steps are
// synthetic: built here from the instruction layout of the Zigs source. Each mutation must FAIL.
// Usage: node solspike/test/mainnet-proof.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  K, ED_HEAD, PROPOSAL_RENT, NULLIFIER_RENT, analyze, approvalDigest, b58enc, b58dec, classify,
  decode, kindOf,
} from "../tools/mainnet_proof.mjs";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log("ok  " + name);
};

// ---- real fixtures ----------------------------------------------------------------------------
const real = (n) => {
  const url = new URL(`fixtures/mainnet-proof/${n}.json`, import.meta.url);
  const f = JSON.parse(readFileSync(url, "utf8"));
  return decode(f.signature, f.result);
};
const failedNames = (res) => res.checks.filter((c) => !c.ok).map((c) => c.name);
const REAL = ["sol-deposit-legacy", "sol-withdraw-v1", "token-deposit-v1", "private-transfer-v1"];

test("real: all 4 mainnet fixtures conserve lamports (sum of deltas = -fee)", () => {
  for (const n of REAL) {
    const tx = real(n);
    assert.equal([...tx.delta.values()].reduce((a, b) => a + b, 0n), -tx.fee, n);
  }
});
test("real: a SOL deposit moves the SOL interface, not tree 0; a legacy message fails", () => {
  const tx = real("sol-deposit-legacy"), fees = new Set([tx.keys[0]]);
  assert.equal(tx.delta.get(K.INTERFACE), 100_000_000n);
  assert.equal(tx.delta.get(K.TREE0), 0n);
  assert.equal(kindOf(tx, { fees }), "shield");
  const res = classify(tx, { fees });
  assert.equal(res.facts.amount, 100_000_000n);
  assert.ok(failedNames(res).includes("message version is 1"));
  assert.ok(failedNames(res).includes("top-level programs are exactly the Zigs set"));
});
test("real: a token deposit (v1) is a shield with no SOL, so it fails", () => {
  const tx = real("token-deposit-v1"), fees = new Set([tx.keys[0]]);
  assert.equal(tx.version, 1);
  const res = classify(tx, { fees });
  assert.equal(res.kind, "shield");
  assert.ok(failedNames(res).includes("the SOL interface gains the amount"));
});
test("real: a direct pool withdraw has the interface leg, and is no Zigs step", () => {
  const tx = real("sol-withdraw-v1"), fees = new Set([tx.keys[0]]);
  assert.equal(tx.delta.get(K.INTERFACE), -10_000_000n);
  assert.equal(tx.delta.get(K.TREE0), -701_120n);
  assert.equal(tx.pre.get(K.INTERFACE) - 10_000_000n, tx.post.get(K.INTERFACE));
  assert.equal(kindOf(tx, { fees }), "pool-direct");
  const res = classify(tx, { fees });
  assert.ok(failedNames(res).includes("this transaction is a step of the owner run"));
});
test("real: a direct pool transfer pays 5,000 tree fee and funds 2 nullifier accounts", () => {
  const tx = real("private-transfer-v1");
  assert.equal(tx.delta.get(K.TREE0), 5_000n - 2n * NULLIFIER_RENT);
  assert.equal(kindOf(tx, { fees: new Set() }), "pool-direct");
});

// ---- synthetic Zigs transactions --------------------------------------------------------------
const addr = (n) => b58enc(new Uint8Array(32).fill(n));
const A = { fee1: addr(1), fee2: addr(2), funder: addr(3), group: addr(4), owner: addr(5),
  cancel: addr(6), null1: addr(7), null2: addr(8), recipient: addr(9), propS: addr(10),
  propW: addr(11), propC: addr(12), cancelRec: addr(13) };
const RENT = PROPOSAL_RENT;
const u64 = (n) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return [...b];
};
const u32 = (n) => [n, 0, 0, 0];
const body = (commitment, rentTo) => Uint8Array.from([...new Uint8Array(32).fill(commitment),
  ...b58dec(A.group), ...u64(2_000_000_000n), ...b58dec(rentTo), 1, ...b58dec(rentTo)]);
const edData = (proposal, b) => Uint8Array.from([...ED_HEAD, ...b58dec(A.group),
  ...new Uint8Array(64).fill(9), ...approvalDigest(proposal, b)]);
const bytes = (...b) => Uint8Array.from(b);

/** Turns a spec into a getTransaction answer. Account indices come from spec.keys. */
function toRpc(s) {
  const at = (k) => {
    const i = s.keys.indexOf(k);
    assert.ok(i >= 0, "key " + k);
    return i;
  };
  const ix = (i) =>
    ({ programIdIndex: at(i.prog), accounts: i.accts.map(at), data: b58enc(i.data) });
  const balances = (side) => s.keys.map((k) => Number(side[k] ?? 0n));
  const inner = (s.inner ?? []).map((g) => ({ index: g.index, instructions: g.ixs.map(ix) }));
  const message = { accountKeys: s.keys, instructions: s.ixs.map(ix),
    header: { numRequiredSignatures: s.required ?? 1 } };
  return { slot: s.slot, blockTime: s.time, version: s.version ?? 1,
    transaction: { signatures: ["sig"], message },
    meta: { err: s.err ?? null, fee: s.fee ?? 5000, computeUnitsConsumed: 1,
      preBalances: balances(s.pre), postBalances: balances(s.post), innerInstructions: inner } };
}

function fundAndShield() {
  const fund = { slot: 100, time: 1000, keys: [A.funder, A.fee1, K.SYSTEM],
    ixs: [{ prog: K.SYSTEM, accts: [A.funder, A.fee1], data: bytes(...u32(2), ...u64(7e7)) }],
    pre: { [A.funder]: 1_000_000_000n },
    post: { [A.funder]: 929_995_000n, [A.fee1]: 70_000_000n } };
  const shieldAccts = [K.TREE0, A.fee1, K.RING1G, K.SYSTEM, K.INTERFACE];
  const shield = { slot: 101, time: 1010, keys: [A.fee1, K.TREE0, K.INTERFACE, K.SYSTEM, K.RING1G],
    ixs: [{ prog: K.RING1G, accts: shieldAccts, data: bytes(15, 1, 2) }],
    pre: { [A.fee1]: 70_000_000n, [K.TREE0]: 9n, [K.INTERFACE]: 1_000_000_000n },
    post: { [A.fee1]: 19_995_000n, [K.TREE0]: 9n, [K.INTERFACE]: 1_050_000_000n } };
  return { fund, shield };
}

const create = (payer, prop, b, slot, start) => ({ slot, time: 1000 + slot,
  keys: [payer, prop, K.SYSTEM, K.APPROVALS],
  ixs: [{ prog: K.APPROVALS, accts: [payer, prop, K.SYSTEM], data: bytes(0, ...b) }],
  pre: { [payer]: start }, post: { [payer]: start - RENT - 5000n, [prop]: RENT } });

function exec(prop, b, slot, withdraw) {
  const k = withdraw ? 1 : 2, nulls = [A.null1, A.null2].slice(0, k);
  const head = [A.fee1, K.TREE0, K.RING1G, K.SYSTEM, K.TREE0, ...nulls];
  const tail = withdraw ? [A.owner, K.INTERFACE, A.recipient] : [A.owner];
  const accts = [A.fee1, prop, A.owner, A.cancel, A.fee1, K.SYSVAR_IX, ...head, ...tail];
  const transact = [5, 5, 5, 5];
  const treeFee = 5000n;
  const pre = { [A.fee1]: 50_000_000n, [prop]: RENT, [K.TREE0]: 10_000_000n,
    [K.INTERFACE]: 2_000_000_000n, [A.recipient]: 0n };
  const post = { ...pre, [A.fee1]: 50_000_000n + RENT - 10_000n - treeFee, [prop]: 0n,
    [K.TREE0]: 10_000_000n + treeFee - NULLIFIER_RENT * BigInt(k) };
  nulls.forEach((n) => {
    post[n] = NULLIFIER_RENT;
  });
  if (withdraw) {
    post[K.INTERFACE] = pre[K.INTERFACE] - 10_000_000n;
    post[A.recipient] = 10_000_000n;
  }
  const cpi = { prog: K.RING1G, accts: [], data: bytes(16, ...transact) };
  return { slot, time: 1000 + slot, fee: 10_000n, pre, post,
    keys: [...new Set([...accts, K.ED25519, K.APPROVALS])],
    ixs: [{ prog: K.ED25519, accts: [], data: edData(prop, b) },
      { prog: K.APPROVALS, accts, data: bytes(1, ...transact) }],
    inner: [{ index: 1, ixs: [cpi] }] };
}

function build() {
  const bS = body(7, A.fee1), bW = body(8, A.fee1), bC = body(5, A.fee2);
  const S = fundAndShield();
  S.createS = create(A.fee1, A.propS, bS, 102, 19_995_000n);
  S.execS = exec(A.propS, bS, 103, false);
  S.createW = create(A.fee1, A.propW, bW, 104, 19_995_000n);
  S.execW = exec(A.propW, bW, 105, true);
  S.createC = create(A.fee2, A.propC, bC, 106, 20_000_000n);
  const cancelAccts = [A.fee2, A.propC, A.cancelRec, A.fee2, K.SYSTEM];
  S.cancel = { slot: 107, time: 1107, keys: [A.fee2, A.propC, A.cancelRec, K.SYSTEM, K.APPROVALS],
    ixs: [{ prog: K.APPROVALS, accts: cancelAccts, data: bytes(2) }],
    pre: { [A.fee2]: 20_000_000n - RENT - 5000n, [A.propC]: RENT },
    post: { [A.fee2]: 20_000_000n - 10_000n, [A.propC]: 0n } };
  return S;
}
const opts = { fees: [A.fee1, A.fee2], recipient: A.recipient };
const run = (mut, o = opts) => {
  const S = build();
  mut?.(S);
  const txs = Object.values(S).map((s) => ({ sig: "S" + s.slot, tx: decode("S" + s.slot, toRpc(s)),
    finalized: true }));
  return analyze(txs, o);
};

test("synthetic: the full run passes and closes G6", () => {
  const r = run();
  assert.deepEqual(r.failed, [], r.failed.join("\n"));
  assert.equal(r.verdict, "PASS");
  const kinds = ["funding", "shield", "create", "execute", "create", "withdraw", "create",
    "cancel"];
  assert.deepEqual(r.rows.map((x) => x.kind), kinds);
  assert.ok(r.zigsV1);
  assert.equal(r.room, 460_000_000n);
  assert.equal(r.rows.find((x) => x.kind === "withdraw").facts.amount, 10_000_000n);
});
test("synthetic: a stray transaction on a fee address is a warning, not a failure", () => {
  const memo = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
  const r = run((s) => {
    s.memo = { slot: 108, time: 1108, keys: [A.fee1, memo],
      ixs: [{ prog: memo, accts: [], data: bytes(1) }],
      pre: { [A.fee1]: 1_000_000n }, post: { [A.fee1]: 995_000n } };
  });
  assert.equal(r.verdict, "PASS", r.failed.join("\n"));
  assert.ok(r.warnings.some((w) => w.includes("not a step of the run")));
});

const mustFail = (name, mut, needle, o) => test("mutation: " + name, () => {
  const r = run(mut, o);
  assert.equal(r.verdict, "FAIL", "the verdict must be FAIL");
  const why = `"${needle}" not in:\n${r.failed.join("\n")}`;
  assert.ok(r.failed.some((f) => f.includes(needle)), why);
});
test("mutation: the create tag 0 changed to 2 is a cancel, not a create", () => {
  const S = build();
  S.createS.ixs[0].data[0] = 2;
  assert.equal(kindOf(decode("x", toRpc(S.createS)), { fees: new Set() }), "cancel");
  const r = run((s) => {
    s.createS.ixs[0].data[0] = 2;
  });
  assert.equal(r.verdict, "FAIL");
  assert.ok(!r.rows.some((x) => x.slot === 102 && x.kind === "create"));
});
const more = (s, step, key, by) => {
  s[step].post[key] += by;
};
mustFail("no Ed25519 instruction before execute", (s) => {
  s.execS.ixs.shift();
  s.execS.inner[0].index = 0;
}, "Ed25519");
mustFail("meta.err is set", (s) => {
  s.execW.err = { InstructionError: [1, "Custom"] };
}, "meta.err is null");
mustFail("the recipient gains 1 lamport more", (s) => more(s, "execW", A.recipient, 1n),
  "withdraw:");
mustFail("a legacy message", (s) => {
  s.shield.version = "legacy";
}, "message version is 1");
mustFail("a signer that is no fee address", (s) => {
  s.createS.keys[0] = A.funder;
  s.createS.ixs[0].accts[0] = A.funder;
}, "signer is a fee address");
mustFail("the body changed after the approval (digest)", (s) => {
  s.createW.ixs[0].data[40] ^= 1;
}, "approval digest");
mustFail("the proposal does not close", (s) => more(s, "execS", A.propS, 1n), "closes");
mustFail("the shield has another amount", (s) => {
  more(s, "shield", K.INTERFACE, 1n);
  more(s, "shield", A.fee1, -1n);
}, "coverage: one shield");
mustFail("the recipient is another address", () => {}, "coverage: a withdrawal",
  { ...opts, recipient: A.funder });
mustFail("the shield goes above the cap", (s) => {
  more(s, "shield", K.INTERFACE, 500_000_000n);
  more(s, "shield", A.fee1, -500_000_000n);
}, "within the cap");
mustFail("a create with a wrong rent", (s) => {
  more(s, "createS", A.propS, 1n);
  more(s, "createS", A.fee1, -1n);
}, "holds the rent");
mustFail("the withdraw has no create in the run", (s) => {
  delete s.createW;
}, "links to a create");
mustFail("the execute ran after the expiry of the body", (s) => {
  s.execS.time = 2_000_000_001;
}, "before the expiry");
mustFail("the Ed25519 key is not the group key", (s) => {
  s.execS.ixs[0].data[16] ^= 1;
}, "group key of the create body");
mustFail("the rent recipient of a create is not the payer", (s) => {
  s.createC = create(A.fee2, A.propC, body(5, A.funder), 106, 20_000_000n);
}, "rent recipient is the payer");
mustFail("a close-cancelled with the wrong shape", (s) => {
  s.close = { slot: 108, time: 1108, keys: [A.fee2, A.propC, A.cancelRec, K.APPROVALS],
    ixs: [{ prog: K.APPROVALS, accts: [A.fee2, A.propC, A.cancelRec], data: bytes(3) }],
    pre: { [A.fee2]: 1_000_000n }, post: { [A.fee2]: 995_000n } };
}, "close-cancelled has 4 accounts");
mustFail("an unknown 9mE7 tag", (s) => {
  s.createC.ixs[0].data[0] = 9;
}, "a step of the owner run");

console.log(`\nmainnet-proof: ${passed} tests passed`);
