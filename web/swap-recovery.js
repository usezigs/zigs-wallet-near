// Device-local swap tracking, sealed with the wallet's existing group secret.
// This cache grants no signing authority and never executes or proposes a payment.
const PREFIX = "zf-swap-recovery:";
const required = ["amountIn", "amountOut", "minAmountOut", "depositAddress", "recipient",
  "refundTo", "deadline"];
const optional = ["correlationId", "signature"];
const string = (v, max = 2048) => typeof v === "string" && v.length > 0 && v.length <= max;
const integer = (v) => typeof v === "string" && /^\d{1,48}$/.test(v) && BigInt(v) > 0n;

export function swapRecoveryRecord(live) {
  if (!live?.swap) return null;
  const record = { version: 1, from: live.from, group: live.group === true,
    wallet: live.wallet || "Wallet", swap: Object.fromEntries([...required, ...optional]
      .filter((k) => live.swap[k] !== undefined).map((k) => [k, live.swap[k]])) };
  if (live.proposal?.id) record.proposalId = live.proposal.id;
  if (live.proposal?.busy) record.proposalPending = true;
  return readSwapRecovery(record);
}

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const knownKeys = (v, fields) => Object.keys(v).every((k) => fields.includes(k));
const optionalText = (v) => v === undefined || typeof v === "string" && v.length <= 4096;
const proposalId = (v) => v === undefined || typeof v === "string" && /^[\w-]{1,128}$/.test(v);

function validRoute(record) {
  const allowed = ["version", "from", "group", "wallet", "swap", "proposalId", "proposalPending"];
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
    && (record.proposalPending === undefined || record.proposalPending === true);
  if (!valid) throw Error("The saved swap cannot be read. Its encrypted copy has been kept.");
  return structuredClone(record);
}

export function createSwapRecovery(engine, key, gid, storage) {
  if (!engine?.secretSeal || !engine?.secretOpen || !key || !gid) return null;
  // Access can itself throw when browser storage is disabled. Report that from load/save,
  // without making the whole Swap page unavailable.
  const local = () => storage ?? globalThis.localStorage;
  const name = PREFIX + gid, context = "swap-recovery\n" + gid;
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
    remove() { local().removeItem(name); },
  };
}
