// Calendar grouping for the existing ledger order. No transaction or confirmation inference.
const dayKey = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0")].join("-");

export function groupLedgerDates(rows, now = Date.now()) {
  const today = new Date(now), yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayKey = dayKey(today), yesterdayKey = dayKey(yesterday), groups = new Map();
  for (const row of rows) {
    const date = new Date(Number.isFinite(row.t) && row.t > 0 ? row.t : NaN);
    const known = Number.isFinite(date.getTime());
    const key = row.m ? "pending" : known ? dayKey(date) : "unknown";
    if (!groups.has(key)) {
      const label = key === "pending" ? "Awaiting a block" : !known ? "Date unavailable"
        : key === todayKey ? "Today" : key === yesterdayKey ? "Yesterday"
          : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      groups.set(key, { key, label, rows: [] });
    }
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}
