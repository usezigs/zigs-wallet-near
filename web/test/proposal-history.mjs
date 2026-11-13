import assert from "node:assert/strict";
import { HISTORY_PAGE_SIZE, proposalPage, proposalWatchIds } from "../sol/proposal-history.js";

const records = Array.from({ length: 79 }, (_, i) => ({ id: "proposal-" + i,
  status: i % 8 === 0 ? "sent" : i % 9 === 0 ? "failed" : "collecting" }));
const seen = [];
for (let page = 0; page < proposalPage(records).pages; page++) {
  const current = proposalPage(records, page);
  assert.ok(current.items.length <= HISTORY_PAGE_SIZE);
  seen.push(...current.items);
  const watched = proposalWatchIds(records, page, 50);
  assert.ok(watched.length <= 50 && new Set(watched).size === watched.length);
  for (const ss of current.items.filter((s) => s.status === "collecting"))
    assert.ok(watched.includes(ss.id), "an old visible open proposal gets a bounded subscription");
  assert.ok(!watched.some((id) => records.find((r) => r.id === id).status !== "collecting"));
}
assert.deepEqual(seen, records, "every older record is reachable once");
assert.equal(proposalPage(records, 1000).page, 6);
assert.equal(proposalPage(records, -1).page, 0);
assert.equal(proposalPage(records, NaN).page, 0);
assert.deepEqual(proposalPage([], 4).items, []);
assert.deepEqual(proposalWatchIds([{ id: "../bad", status: "collecting" }, ...records], 0, 50),
  proposalWatchIds(records, 0, 50), "invalid IDs take no subscription");
assert.deepEqual(proposalWatchIds(records, 0, 50),
  records.filter((s) => s.status === "collecting").slice(0, 50).map((s) => s.id),
  "the newest page retains the previous watch selection");
console.log("proposal-history: all pages reachable, bounds, ended/invalid exclusion "
  + "and visible old subscriptions ok");
