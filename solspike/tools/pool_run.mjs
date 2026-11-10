// Reads a run of the Zolana pool from the public RPC, read-only: no key, no Helius, no write.
//   node solspike/tools/pool_run.mjs --cluster devnet <signature>...
//   node solspike/tools/pool_run.mjs --cluster mainnet --address <address> --count 5 --json
// Options: --program <id> (a program id to name "approvals", 5PHZ... is known on Devnet),
// --record <dir> (saves each raw reply as <dir>/<signature>.json, and the list of an address as
// <dir>/addr-<address>.json). The test reads recorded replies only.
import { mkdirSync, writeFileSync } from "node:fs";

export const POOL = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const APPROVALS_DEVNET = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
// The pool makes a nullifier PDA (11 bytes) in its own code: the transaction shows a transfer and
// an assign, and no space. ponytail: 706120 is the rent minimum of 11 bytes read on Devnet; if a
// cluster has another rent, the account shows as pool-account until this number is changed.
const NULLIFIER_PDA_SIZE = 11;
const NULLIFIER_PDA_LAMPORTS = 706120;
const URLS = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};
const SYSTEM = "11111111111111111111111111111111";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const NAMES = {
  [POOL]: "pool",
  [APPROVALS_DEVNET]: "approvals",
  [SYSTEM]: "system",
  [LOADER]: "loader",
  Ed25519SigVerify111111111111111111111111111: "ed25519",
  ComputeBudget111111111111111111111111111111: "compute-budget",
  regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ: "registry",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "token",
};
// First byte of the pool instruction data: program-libs/event/src/tag.rs of privacy-rings.
const POOL_KINDS = [
  "create-protocol-config", "update-protocol-config", "create-tree", "pause-tree",
  "set-tree-fees", "claim-tree-lamports", "create-asset-counter", "create-spl-interface",
  "create-ring-config", "update-ring-config", "update-ring-config-owner", "set-ring-activation",
  "batch-update-nullifier-tree", "close-nullifier-pdas", "emit-event", "deposit", "transact",
  "merge-transact", "ring-deposit", "ring-transact", "ring-merge-transact",
  "ring-authority-transact", "create-cache", "close-cache",
];
// u32 little-endian first word of a System or loader instruction; u8 for compute budget.
const SYSTEM_KINDS = { 0: "create-account", 1: "assign", 2: "transfer", 8: "allocate" };
const LOADER_KINDS = {
  0: "initialize-buffer", 1: "write", 2: "deploy", 3: "upgrade", 4: "set-authority", 5: "close",
  6: "extend-program",
};
const BUDGET_KINDS = {
  1: "request-heap",
  2: "set-unit-limit",
  3: "set-unit-price",
  4: "set-loaded-size",
};
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decodes base58 text to bytes. */
export function base58Decode(text) {
  const bytes = [];
  for (const ch of text) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error(`base58: bad character ${ch}`);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 255;
      carry >>= 8;
    }
    for (; carry > 0; carry >>= 8) bytes.push(carry & 255);
  }
  const zeros = text.length - text.replace(/^1+/, "").length;
  const out = new Uint8Array(zeros + bytes.length);
  out.set(bytes.reverse(), zeros);
  return out;
}

/** Encodes bytes as base58 text. */
export function base58Encode(bytes) {
  const digits = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    for (; carry > 0; carry = (carry / 58) | 0) digits.push(carry % 58);
  }
  const zeros = bytes.findIndex((b) => b !== 0);
  const lead = "1".repeat(zeros < 0 ? bytes.length : zeros);
  return lead + digits.reverse().map((d) => B58[d]).join("");
}

const view = (data) => new DataView(data.buffer, data.byteOffset);
const u32 = (data) => (data.length >= 4 ? view(data).getUint32(0, true) : -1);
const u64 = (data, at) => view(data).getBigUint64(at, true);

const tagOf = (data) => (data.length ? `tag-${data[0]}` : "empty");
const KIND_READERS = {
  pool: (data) => POOL_KINDS[data[0]] ?? tagOf(data),
  system: (data) => SYSTEM_KINDS[u32(data)] ?? `tag-${u32(data)}`,
  loader: (data) => LOADER_KINDS[u32(data)] ?? `tag-${u32(data)}`,
  "compute-budget": (data) => BUDGET_KINDS[data[0]] ?? tagOf(data),
};

/** The kind of one instruction, from the first bytes of its data (undefined for other programs). */
export const kindOf = (name, data) => (data.length ? KIND_READERS[name]?.(data) : undefined);

/** All account keys of a transaction, with the ones loaded from lookup tables. */
const allKeys = (tx) => {
  const loaded = tx.meta.loadedAddresses ?? { writable: [], readonly: [] };
  return [...tx.transaction.message.accountKeys, ...loaded.writable, ...loaded.readonly];
};

function flattenInstructions(tx) {
  const top = tx.transaction.message.instructions.map((ix, index) => ({ ix, where: "top", index }));
  const inner = (tx.meta.innerInstructions ?? []).flatMap(({ index, instructions }) =>
    instructions.map((ix) => ({ ix, where: "inner", index })),
  );
  return [...top, ...inner];
}

// What a System instruction says about an account: its space and its new owner. A nullifier PDA
// is made with transfer, allocate and assign, a plain account with create-account.
function systemFacts(kind, keys, ix, data, facts) {
  const at = ix.accounts[kind === "create-account" ? 1 : 0];
  const fact = (facts[keys[at]] ??= {});
  if (kind === "create-account") {
    fact.space = Number(u64(data, 12));
    fact.owner = base58Encode(data.subarray(20, 52));
  } else if (kind === "allocate") fact.space = Number(u64(data, 4));
  else if (kind === "assign") fact.owner = base58Encode(data.subarray(4, 36));
}

function createdAccounts(facts, changes, names) {
  return changes
    .filter((row) => row.new && facts[row.account]?.owner)
    .map(({ account, post }) => {
      const { space, owner } = facts[account];
      const ownerName = names[owner] ?? owner;
      const byLamports = space === undefined && post === NULLIFIER_PDA_LAMPORTS;
      const nullifier = space === NULLIFIER_PDA_SIZE || byLamports;
      const kind = ownerName === "pool" && nullifier ? "nullifier-pda" : `${ownerName}-account`;
      return { account, kind, owner, space: space ?? null, lamports: post };
    });
}

function balanceChanges(tx, keys) {
  const { preBalances, postBalances } = tx.meta;
  return keys
    .map((account, i) => ({ account, pre: preBalances[i], post: postBalances[i] }))
    .filter((row) => row.pre !== row.post)
    .map((row) => ({ ...row, delta: row.post - row.pre, new: row.pre === 0 }));
}

/** Turns one raw getTransaction result into a report row. */
export function parseTransaction(signature, tx, extraNames = {}) {
  const names = { ...NAMES, ...extraNames };
  const keys = allKeys(tx);
  const instructions = [];
  const facts = {};
  for (const { ix, where, index } of flattenInstructions(tx)) {
    const program = keys[ix.programIdIndex];
    const name = names[program] ?? program;
    const data = base58Decode(ix.data);
    const kind = kindOf(name, data);
    instructions.push({ where, index, program: name, ...(kind ? { kind } : {}) });
    if (name === "system") systemFacts(kind, keys, ix, data, facts);
  }
  const err = tx.meta.err;
  const changes = balanceChanges(tx, keys);
  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    time: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    status: err ? "failed" : "ok",
    err,
    fee: tx.meta.fee,
    computeUnits: tx.meta.computeUnitsConsumed,
    programs: summarizePrograms(instructions),
    named: keys.filter((key) => names[key] && !instructions.some((i) => i.program === names[key]))
      .map((key) => names[key]),
    instructions,
    created: createdAccounts(facts, changes, names),
    balanceChanges: changes,
  };
}

function summarizePrograms(instructions) {
  const table = new Map();
  for (const { program, where } of instructions) {
    const row = table.get(program) ?? { program, top: 0, inner: 0 };
    row[where] += 1;
    table.set(program, row);
  }
  return [...table.values()];
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/** A public RPC client: one call at a time, a pause between calls, retries with backoff. */
export function makeRpc(cluster, { fetchFn = fetch, pauseMs = 700, tries = 6 } = {}) {
  const url = URLS[cluster];
  if (!url) throw new Error(`pool_run: cluster must be devnet or mainnet, got ${cluster}`);
  return async function rpc(method, params) {
    for (let attempt = 1; ; attempt++) {
      await delay(pauseMs);
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }).catch((err) => ({ ok: false, status: 0, text: async () => String(err) }));
      const retry = res.status === 0 || res.status === 429 || res.status >= 500;
      if (retry && attempt < tries) {
        await delay(2 ** attempt * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`pool_run: ${method} failed, HTTP ${res.status}`);
      const reply = await res.json();
      if (reply.error) throw new Error(`pool_run: ${method}: ${reply.error.message}`);
      return reply.result;
    }
  };
}

const TX_OPTS = { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "finalized" };

/** Reads the transactions. `source` is { signatures } or { address, count }. */
export async function readRun(rpc, source, { extraNames = {}, record } = {}) {
  let signatures = source.signatures;
  if (!signatures) {
    const list = await rpc("getSignaturesForAddress", [source.address, { limit: source.count }]);
    if (record) save(record, `addr-${source.address}`, list);
    signatures = list.map((row) => row.signature);
  }
  const rows = [];
  for (const signature of signatures) {
    const tx = await rpc("getTransaction", [signature, TX_OPTS]);
    if (!tx) throw new Error(`pool_run: ${signature} not found (pruned or not finalized)`);
    if (record) save(record, signature, tx);
    rows.push(parseTransaction(signature, tx, extraNames));
  }
  return rows;
}

function save(dir, name, value) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.json`, `${JSON.stringify(value)}\n`);
}

/** A short table, one block per transaction. */
export function formatTable(rows) {
  return rows
    .map((r) => {
      const kinds = r.instructions.filter((i) => i.kind).map((i) => `${i.program}:${i.kind}`);
      const progs = r.programs.map((p) => `${p.program} ${p.top}+${p.inner}`).join(", ");
      const err = r.err ? ` ${JSON.stringify(r.err)}` : "";
      const lines = [
        `${r.signature.slice(0, 16)}  slot ${r.slot}  ${r.time}  ${r.status}${err}`,
        `  fee ${r.fee}  cu ${r.computeUnits}  ${kinds.join(", ") || "none"}`,
        `  programs (top+inner): ${progs}${r.named.length ? `; named accounts: ${r.named}` : ""}`,
        ...r.created.map((c) => `  created ${c.account} ${c.kind} space ${c.space}`),
        ...r.balanceChanges.map((b) => `  ${b.account}  ${b.delta >= 0 ? "+" : ""}${b.delta}`),
      ];
      return lines.join("\n");
    })
    .join("\n\n");
}

function parseArgs(argv) {
  const opts = { cluster: "devnet", count: 5, signatures: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--")) opts[arg.slice(2)] = argv[++i];
    else opts.signatures.push(arg);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rpc = makeRpc(opts.cluster);
  const extraNames = opts.program ? { [opts.program]: "approvals" } : {};
  const source = opts.address
    ? { address: opts.address, count: Number(opts.count) }
    : { signatures: opts.signatures };
  if (!opts.address && !opts.signatures.length) {
    throw new Error("pool_run: give signatures or --address");
  }
  const rows = await readRun(rpc, source, { extraNames, record: opts.record });
  console.log(opts.json ? JSON.stringify(rows, null, 2) : formatTable(rows));
}

if (import.meta.main) main().catch((err) => (console.error(err.message), process.exit(1)));
