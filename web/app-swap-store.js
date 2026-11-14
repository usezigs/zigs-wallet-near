// Swap addresses link financial activity. Seal the recovery journal with the wallet's existing
// key, in its own IndexedDB namespace. A damaged or unreadable record is never overwritten.
import { Z } from "./app-engine.js";
import { exclusive } from "./app-kit.js";
import { gkeys, idb, lockedElsewhere, lockedVault } from "./app-keystore.js";
import { readSwapRecord } from "./swap-records.js";

const keyOf = (gid) => "swaps:" + gid;
const contextOf = (gid) => "swaps\n" + gid;
function secretOf(gid) {
  if (lockedVault || lockedElsewhere() || !gkeys[gid]) {
    throw new Error("Unlock this wallet to save or resume its swaps.");
  }
  return gkeys[gid];
}

async function load(gid) {
  const secret = secretOf(gid), sealed = await idb("readonly", (st) => st.get(keyOf(gid)));
  if (!sealed) return [];
  const data = JSON.parse(Z.secretOpen(secret, contextOf(gid), sealed));
  if (!Array.isArray(data) || data.length > 200) throw new Error("The saved swap journal is damaged. Its stored copy was kept.");
  const records = data.map(readSwapRecord);
  if (records.some((r) => !r || r.walletId !== gid)) throw new Error("The saved swap journal could not be verified. Its stored copy was kept.");
  return records;
}

async function save(value) {
  const record = readSwapRecord(value);
  if (!record) throw new Error("The swap recovery receipt is incomplete.");
  return exclusive("swaps:" + record.walletId, async () => {
    const records = await load(record.walletId), address = record.swap.depositAddress;
    const next = [record, ...records.filter((r) => r.swap.depositAddress !== address)];
    // Never silently evict a pending financial operation.
    if (next.length > 200) throw new Error("This browser's swap journal is full. Keep its receipts before starting another swap.");
    const sealed = Z.secretSeal(secretOf(record.walletId), contextOf(record.walletId), JSON.stringify(next));
    await idb("readwrite", (st) => st.put(sealed, keyOf(record.walletId)));
    return next;
  });
}

export const swapJournal = { load, save };
