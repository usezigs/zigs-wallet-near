// Device-local swap tracking, sealed with the wallet's existing group secret.
// This cache grants no signing authority and never executes or proposes a payment.
const PREFIX = "zf-swap-recovery:";
const required = ["amountIn", "amountOut", "minAmountOut", "depositAddress", "recipient",
  "refundTo", "deadline"];
const optional = ["correlationId", "signature"];
const STATUSES = new Set(["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT",
  "PROCESSING", "SUCCESS", "REFUNDED", "FAILED", "unknown", "other"]);
const string = (v, max = 2048) => typeof v === "string" && v.length > 0 && v.length <= max;
const integer = (v) => typeof v === "string" && /^\d{1,48}$/.test(v) && BigInt(v) > 0n;

const proposalFields = (live) => ({
  ...(live.proposal?.id ? { proposalId: live.proposal.id } : {}),
  ...(live.proposal?.busy ? { proposalPending: true } : {}),
});
function progressOf(live) {
  if (!live.status || !STATUSES.has(live.status.status)) return live.savedProgress;
  return {
    status: live.status.status,
    originTxs: (live.status.originTxs ?? []).slice(0, 20),
    destinationTxs: (live.status.destinationTxs ?? []).slice(0, 20),
    ...(Number.isSafeInteger(live.checkedAt) ? { checkedAt: live.checkedAt } : {}),
  };
}

export function swapRecoveryRecord(live) {
  if (!live?.swap) return null;
  const record = { version: 1, from: live.from, group: live.group === true,
    wallet: live.wallet || "Wallet", swap: Object.fromEntries([...required, ...optional]
      .filter((k) => live.swap[k] !== undefined).map((k) => [k, live.swap[k]])),
    ...proposalFields(live) };
  const progress = progressOf(live);
  if (progress) record.progress = progress;
  return readSwapRecovery(record);
}

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const knownKeys = (v, fields) => Object.keys(v).every((k) => fields.includes(k));
const optionalText = (v) => v === undefined || typeof v === "string" && v.length <= 4096;
const proposalId = (v) => v === undefined || typeof v === "string" && /^[\w-]{1,128}$/.test(v);

function validRoute(record) {
  const allowed = ["version", "from", "group", "wallet", "swap", "proposalId",
    "proposalPending", "progress"];
  return object(record) && record.version === 1 && knownKeys(record, allowed)
    && ["sol", "zec"].includes(record.from)
    && typeof record.group === "boolean" && (!record.group || record.from === "sol")
    && string(record.wallet, 160);
}
function validSwap(swap) {
  return object(swap) && knownKeys(swap, [...required, ...optional])
    && required.every((k) => string(swap[k]))
    && ["amountIn", "amountOut", "minAmountOut"].every((k) => integer(swap[k]))
    && BigInt(swap.minAmountOut) <= BigInt(swap.amountOut)
    && Number.isFinite(Date.parse(swap.deadline))
    && optional.every((k) => optionalText(swap[k]));
}
export function readSwapRecovery(record) {
  const valid = validRoute(record) && validSwap(record.swap) && proposalId(record.proposalId)
    && (record.proposalPending === undefined || record.proposalPending === true)
    && (record.progress === undefined || validProgress(record.progress));
  if (!valid) throw Error("The saved swap cannot be read. Its encrypted copy has been kept.");
  return structuredClone(record);
}

function validProgress(p) {
  const txs = (v) => Array.isArray(v) && v.length <= 20 && v.every((id) => string(id, 256));
  return object(p) && knownKeys(p, ["status", "originTxs", "destinationTxs", "checkedAt"])
    && STATUSES.has(p.status) && txs(p.originTxs) && txs(p.destinationTxs)
    && (p.checkedAt === undefined || Number.isSafeInteger(p.checkedAt) && p.checkedAt >= 0);
}

/** A user-requested support record, never a payment request or authority to submit anything. */
export function swapRecoveryText(live) {
  const r = swapRecoveryRecord(live);
  if (!r) return "";
  return ["Zigs swap recovery record", "Historical record, not a payment instruction. "
    + "Verify the current outcome before paying again.", ...routeLines(r), ...reportLines(r)]
    .join("\n");
}
function routeLines(r) {
  const w = r.swap;
  return [
    "Wallet: " + r.wallet, "Route: " + r.from.toUpperCase() + " to " + (r.from === "sol" ?
      "ZEC" : "SOL"),
    "Quote ID: " + (w.correlationId || "not supplied"), "Deposit deadline (UTC): " + w.deadline,
    "Amount in (base units): " + w.amountIn, "Quoted amount out (base units): " + w.amountOut,
    "Minimum quoted out (base units): " + w.minAmountOut,
    "Deposit address: " + w.depositAddress, "Recipient: " + w.recipient,
      "Refund address: " + w.refundTo,
  ];
}
const proposalNote = (r) => r.proposalId
  || (r.proposalPending ? "may exist; check Approvals" : "not recorded here");
function reportLines(r) {
  const p = r.progress;
  return [
    "Wallet payment proposal: " + proposalNote(r),
    "Provider report (not chain verification): " + (p?.status || "unknown"),
    "Source transactions: " + (p?.originTxs.join(", ") || "not supplied"),
    "Destination transactions: " + (p?.destinationTxs.join(", ") || "not supplied"),
  ];
}

export function createSwapRecovery(engine, key, gid, storage) {
  if (!engine?.secretSeal || !engine?.secretOpen || !key || !gid) return null;
  // Access can itself throw when browser storage is disabled. Report that from load/save,
  // without making the whole Swap page unavailable.
  const local = () => storage ?? globalThis.localStorage;
  const name = PREFIX + gid, context = "swap-recovery\n" + gid;
  const historyName = PREFIX + "history:" + gid, historyContext = "swap-history\n" + gid;
  const history = () => {
    const raw = local().getItem(historyName);
    if (raw === null) return [];
    try {
      if (raw.length > 2_000_000) throw Error();
      const records = JSON.parse(engine.secretOpen(key, historyContext, raw));
      if (!Array.isArray(records) || records.length > 100) throw Error();
      return records.map(readSwapRecovery);
    } catch { throw Error(
      "The saved swap history cannot be read. Its encrypted copy has been kept."); }
  };
  return {
    load() {
      const raw = local().getItem(name);
      if (raw === null) return null;
      if (raw.length > 65536) {
        throw Error("The saved swap cannot be read. Its encrypted copy has been kept.");
      }
      try { return readSwapRecovery(JSON.parse(engine.secretOpen(key, context, raw))); }
      catch { throw Error("The saved swap cannot be read. Its encrypted copy has been kept."); }
    },
    save(record) {
      const text = JSON.stringify(readSwapRecovery(record));
      const sealed = engine.secretSeal(key, context, text);
      local().setItem(name, sealed);
      if (local().getItem(name) !== sealed) throw Error("Swap recovery could not be saved.");
    },
    history,
    remove() {
      // Archive and read back before removing active tracking. A full/corrupt/blocked history
      // must never silently delete the only record of a failed swap.
      const current = this.load();
      if (!current) return;
      const records = history().filter((r) => !(r.from === current.from
        && r.swap.depositAddress === current.swap.depositAddress &&
          r.swap.deadline === current.swap.deadline));
      if (records.length >= 100) throw Error(
        "Swap history is full. Keep tracking open and copy the recovery record.");
      const sealed = engine.secretSeal(key, historyContext, JSON.stringify([current, ...records]));
      if (sealed.length > 2_000_000) throw Error(
        "Swap history is full. Keep tracking open and copy the recovery record.");
      local().setItem(historyName, sealed);
      if (local().getItem(historyName) !== sealed) throw Error(
        "Swap history could not be saved. Tracking was kept.");
      local().removeItem(name);
      if (local().getItem(name) !== null) throw Error(
        "The active swap could not be closed. Its record was kept.");
    },
  };
}
