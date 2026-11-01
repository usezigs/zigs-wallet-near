// The Overview model (web/overview-model.js): the ZEC total, the USD price of 1 ZEC and the USD
// total of a mainnet wallet, the states of the SOL row and the pending shortcut. An unknown amount
// is never zero, and nothing pending gives no shortcut.
// Run: node web/test/overview.mjs   (Node 26)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ageText, createZecPrice, formatUsdBalance, pendingShortcut, portfolioView, PRICE_FRESH_MS,
  PRICE_RETRY_MS, solRow, zecInProgress, zecTotal, zecUsd,
} from "../overview-model.js";
import { NearIntentsSwapProvider } from "../near-intents-swap-provider.js";
import { describeOrb } from "../wallet-identity.js";
import { fallbackSvg } from "../wallet-avatar-svg.js";

for (const unknown of [null, undefined, NaN, Infinity, -Infinity, "12", {}, false]) {
  assert.deepEqual(formatUsdBalance(unknown), {
    known: false, text: "$0.00", whole: "$0", fraction: ".00",
  }, "only finite numbers are confirmed valuations");
}
assert.deepEqual(formatUsdBalance(0), {
  known: true, text: "$0.00", whole: "$0", fraction: ".00",
});
assert.equal(formatUsdBalance(-0).text, "$0.00", "numeric zero has no negative sign");
assert.equal(formatUsdBalance(1234567.89).text, "$1,234,567.89");
assert.equal(formatUsdBalance(-42.5).text, "-$42.50");
const source = Object.freeze({ valuation: null });
formatUsdBalance(source.valuation);
assert.equal(source.valuation, null, "presentation never overwrites an unknown valuation");

const publicAddress = "utest1" + "q".repeat(180);
const first = await describeOrb("zcash:testnet", publicAddress);
const again = await describeOrb("zcash:testnet", publicAddress.toUpperCase());
assert.equal(first.digest, again.digest, "canonical public address keeps one identity");
assert.equal(fallbackSvg(first), fallbackSvg(again), "SVG geometry is deterministic");
assert.equal(createHash("sha256").update(fallbackSvg(first)).digest("hex"),
  "a4b39cc58f8a7282193e3c75447e3dff7c4a53ba3c618053782818beebd5f9f6",
  "promoted SVG keeps the existing prototype projection byte-for-byte");
assert.notEqual(first.digest, (await describeOrb("zcash:mainnet", publicAddress)).digest);
assert.notEqual(first.digest, (await describeOrb("zcash:testnet", "utest1pppp")).digest);
assert.doesNotMatch(fallbackSvg(first), /utest1|address|keyPackage|viewing/i);

assert.equal(zecTotal(null), null, "no sync yet: unknown, not zero");
assert.equal(zecTotal({ spendable: 0, pending: 0, sending: 0 }), 0, "an empty wallet is zero");
assert.equal(zecTotal({ spendable: 150, pending: 25, sending: 40 }), 175,
  "spendable plus incoming; the amount on its way out is not counted twice");
console.log("ok  the ZEC total");

const ready = { status: "ready" };
assert.equal(solRow({ on: false, setup: ready, balance: "1 SOL" }), null, "no Solana part");
assert.equal(solRow({ on: true, error: "x", setup: ready, balance: "1 SOL" }).state, "failed");
assert.equal(solRow({ on: true, loading: true, setup: null }).state, "loading",
  "the module still loads");
assert.deepEqual(solRow({ on: true, loading: false, setup: null }),
  { state: "idle", text: "Not open" }, "nothing loads: no Loading text");
const status = (s) => solRow({ on: true, setup: { status: s }, balance: "1 SOL" });
assert.equal(status("stopped").state, "stopped");
assert.equal(status("running").state, "setup");
assert.deepEqual(status("not started"), { state: "none", text: "Not added" });
assert.equal(status("unavailable").state, "unavailable");
assert.deepEqual(status("differs"), { state: "differs", text: "Keys differ" },
  "seats with different keys never show a balance");
assert.deepEqual(status("something new"), { state: "unknown", text: "Unknown" },
  "an unknown status is no setup step");
assert.deepEqual(solRow({ on: true, setup: ready, balance: null }),
  { state: "unsynced", text: "Not synced yet" }, "no sync yet: unknown, not zero");
assert.deepEqual(solRow({ on: true, setup: ready, balance: "0 SOL" }),
  { state: "synced", text: "0 SOL" }, "a synced empty wallet is zero");
assert.deepEqual(solRow({ on: true, setup: ready, balance: "0.0025 SOL" }),
  { state: "synced", text: "0.0025 SOL" }, "the exact text of the sync");
const synced = (text, busy = false) => solRow({ on: true, setup: ready, balance: "1 SOL",
  sync: { text, busy } }).state;
assert.equal(synced("synced at slot 9, x"), "synced");
assert.equal(synced("saved sync of slot 9"), "saved", "a balance of the saved sync says so");
assert.equal(synced("failed: offline"), "stale", "a failed sync marks the old balance");
assert.equal(synced("failed: offline", true), "resync", "a retry keeps the balance marked old");
assert.equal(synced("saved sync of slot 9", true), "resync");
assert.equal(solRow({ on: true, setup: ready, balance: null, sync: { text: "", busy: true } })
  .state, "syncing", "a first sync runs");
console.log("ok  the SOL row");

assert.equal(pendingShortcut({ zec: 0, sol: 0 }), null, "nothing pending, no shortcut");
assert.equal(pendingShortcut({}), null, "no counts, no shortcut");
assert.deepEqual(pendingShortcut({ zec: 1, sol: 0 }),
  { count: 1, text: "1 Zcash payment is in progress." });
assert.deepEqual(pendingShortcut({ zec: 2, sol: 1 }), { count: 3,
  text: "2 Zcash payments are in progress. 1 Solana proposal waits for your approval." },
  "each chain says what it counts");
assert.deepEqual(pendingShortcut({ zec: 0, sol: 2 }),
  { count: 2, text: "2 Solana proposals wait for your approval." }, "only Solana");
assert.equal(zecInProgress(["a", "b"], ["a"], ["c", "a"]), 3, "each payment once");
assert.equal(zecInProgress([], [], ["h"]), 1, "a held approval alone counts");
assert.equal(zecInProgress([], [], []), 0);
console.log("ok  the pending shortcut");

// The price of 1 ZEC: one dry quote of exactly 1 ZEC to USDC, kept for 5 minutes. `now.t` is the
// clock; `answer` makes the reply of the provider (a thrown error is a failed call).
const T0 = 1_000_000;
function priceRig(answer = async () => ({ amountOut: "1232971711" })) {
  const asks = [], now = { t: T0 }, rig = { asks, now, settled: 0 };
  const provider = { previewQuote: async (ask) => { asks.push(ask); return answer(ask); } };
  rig.price = createZecPrice({ provider, now: () => now.t, settled: () => { rig.settled++; } });
  return rig;
}
const FIXED_ASK = { originAssetId: "nep141:zec.omft.near",
  destinationAssetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  amountAtomic: "100000000", slippageBps: 50 };
{
  const r = priceRig();
  assert.deepEqual(r.price.read(), { usd: null, at: null, failed: false }, "no price yet");
  assert.equal(r.price.want(), true, "a page with no price asks");
  await r.price.ask();
  assert.deepEqual(r.asks, [FIXED_ASK], "the ask is exactly 1 ZEC in zatoshi, ZEC to USDC");
  assert.deepEqual(r.price.read(), { usd: 1232.971711, at: T0, failed: false },
    "USDC has 6 decimals, 1 USDC counts as 1 USD");
  assert.equal(r.settled, 1, "the page redraws after a call");
  r.now.t = T0 + PRICE_FRESH_MS - 1;
  assert.equal(r.price.want(), false, "a price of 4 min 59 s is reused");
  await r.price.ask();
  assert.equal(r.asks.length, 1, "so there is no second call");
  r.now.t = T0 + PRICE_FRESH_MS;
  assert.equal(r.price.want(), true, "a price of 5 min is old");
  await r.price.ask();
  assert.equal(r.asks.length, 2, "so the next ask calls again");
  assert.equal(r.price.read().at, T0 + PRICE_FRESH_MS, "and the new price has its own time");
  console.log("ok  the price: a fixed ask of 1 ZEC, reused for 5 minutes");
}
{
  // One call at a time: asks that come while a call runs start no second call.
  let release;
  const r = priceRig(() => new Promise((done) => { release = done; }));
  const first = r.price.ask();
  assert.equal(r.price.want(), false, "no ask while a call runs");
  await r.price.ask();
  assert.equal(r.asks.length, 1, "the second ask starts nothing");
  release({ amountOut: "5000000" });
  await first;
  assert.equal(r.price.read().usd, 5);
  assert.equal(r.settled, 1, "one call, one redraw");
  console.log("ok  the price: at most one call in flight");
}
{
  // A failed call waits 60 s. The old price stays; a later success clears the failure.
  let fail = true;
  const r = priceRig(async () => {
    if (fail) throw new Error("down");
    return { amountOut: "2000000" };
  });
  await r.price.ask();
  assert.deepEqual(r.price.read(), { usd: null, at: null, failed: true });
  assert.equal(r.settled, 1, "a failed call also redraws");
  r.now.t = T0 + PRICE_RETRY_MS - 1;
  await r.price.ask();
  assert.equal(r.asks.length, 1, "no retry before 60 s");
  r.now.t = T0 + PRICE_RETRY_MS;
  await r.price.ask();
  assert.equal(r.asks.length, 2, "a retry at 60 s");
  r.now.t = T0 + 2 * PRICE_RETRY_MS - 1;
  await r.price.ask();
  assert.equal(r.asks.length, 2, "a second failure waits 60 s again");
  fail = false;
  r.now.t = T0 + 2 * PRICE_RETRY_MS;
  await r.price.ask();
  const good = { usd: 2, at: T0 + 2 * PRICE_RETRY_MS, failed: false };
  assert.deepEqual(r.price.read(), good);
  fail = true;
  r.now.t += PRICE_FRESH_MS;
  await r.price.ask();
  assert.deepEqual(r.price.read(), { ...good, failed: true },
    "a failed refresh keeps the old price and its time");
  r.now.t += PRICE_RETRY_MS - 1;
  assert.equal(r.price.want(), false, "and waits 60 s");
  console.log("ok  the price: a failed call waits 60 s");
}
for (const bad of ["0", "abc", undefined, null, "-5"]) {
  const r = priceRig(async () => ({ amountOut: bad }));
  await r.price.ask();
  assert.equal(r.price.read().failed, true, "an answer without a price is a failure: " + bad);
  assert.equal(r.price.read().usd, null);
}
{
  const r = priceRig(async () => { throw new Error("x"); });
  await assert.doesNotReject(r.price.ask(), "a failed call never rejects into the page");
}
console.log("ok  the price: an answer without a price is a failure");

// The real provider sends the fixed body to /near/quote, whatever the balance of the wallet.
{
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push({ url, method: init.method, body: init.body });
    return Response.json({ amountIn: "100000000", amountOut: "1232971711",
      minAmountOut: "1226806852" });
  };
  const price = createZecPrice({ provider: new NearIntentsSwapProvider(fetchFn) });
  await price.ask();
  assert.deepEqual(sent, [{ url: "/near/quote", method: "POST",
    body: '{"from":"zec","to":"usdc","amount":"100000000","slippageBps":50}' }]);
  console.log("ok  the request body is the fixed amount of 1 ZEC");
}

// The value: zatoshi times the price, in USD.
assert.equal(zecUsd(null, 5), null, "no balance: no value");
assert.equal(zecUsd(100, null), null, "no price: no value");
assert.equal(zecUsd(0, 5), 0, "an empty wallet is worth zero");
assert.equal(zecUsd(100_000_000, 1232.971711), 1232.971711);
assert.equal(formatUsdBalance(zecUsd(1_000_000, 1232.971711)).text, "$12.33",
  "0.01 ZEC at 1232.971711 USD is $12.33");
const mixed = zecTotal({ spendable: 900_000, pending: 100_000 });
assert.equal(formatUsdBalance(zecUsd(mixed, 1232.971711)).text, "$12.33",
  "spendable plus incoming");
assert.ok(Number.isFinite(zecUsd(2_100_000_000_000_000, 1232.971711)), "21 million ZEC is finite");
assert.equal(ageText(0), "just now");
assert.equal(ageText(-5000), "just now", "a clock that moved back is no negative age");
assert.equal(ageText(59_999), "just now");
assert.equal(ageText(60_000), "1 minute ago");
assert.equal(ageText(119_999), "1 minute ago");
assert.equal(ageText(120_000), "2 minutes ago");
assert.equal(ageText(59 * 60_000), "59 minutes ago");
assert.equal(ageText(60 * 60_000), "1 hour ago");
assert.equal(ageText(150 * 60_000), "2 hours ago");
console.log("ok  the USD value and the age");

// The labels of each state.
const PRICE = { usd: 1232.971711, at: T0, failed: false };
const NONE = { usd: null, at: null, failed: false }, FAILED = { usd: null, at: null, failed: true };
const view = (total, price, now = T0) => portfolioView({ mainnet: true, total, price, now });
assert.deepEqual(portfolioView({ mainnet: false, total: 1_000_000, price: PRICE, now: T0 }),
  { demo: true }, "a testnet wallet stays a demo, whatever the price");
assert.deepEqual(view(null, PRICE), { demo: false, value: null, facts: "",
  note: "Balance not synced yet", label: "USD value not available until the first sync" },
"before the first sync there is no value, with or without a price");
assert.deepEqual(view(null, NONE), view(null, PRICE));
assert.deepEqual(view(1_000_000, NONE), { demo: false, value: null, facts: "",
  note: "Price not available yet", label: "USD value not available yet" });
assert.deepEqual(view(1_000_000, FAILED), { demo: false, value: null, facts: "",
  note: "Price not available", label: "USD value not available" });
const priced = view(1_000_000, PRICE, T0 + 2 * 60_000);
assert.equal(priced.value.text, "$12.33");
assert.equal(priced.value.known, true);
assert.equal(priced.label, "About $12.33");
assert.equal(priced.note, "≈ Price of a NEAR Intents quote for 1 ZEC, 2 minutes ago");
assert.equal(priced.facts, "1 USDC counts as 1 USD. The quote includes fees and spread. It is not "
  + "a market rate, and a swap can give another amount.");
assert.equal(view(1_000_000, PRICE).note.endsWith("1 ZEC, just now"), true);
assert.equal(view(0, PRICE).value.text, "$0.00", "an empty wallet shows a true zero");
assert.equal(view(0, PRICE).value.known, true);
const old = view(1_000_000, { ...PRICE, failed: true }, T0 + 9 * 60_000);
assert.equal(old.value.text, "$12.33", "a failed refresh keeps the old value");
assert.match(old.note, /9 minutes ago$/, "and the age says how old it is");
for (const total of [null, 0, 1_000_000]) {
  for (const price of [NONE, FAILED, PRICE]) {
    const v = view(total, price);
    assert.equal(v.demo, false, "a mainnet wallet is never a demo");
    assert.doesNotMatch([v.note, v.label, v.facts, v.value?.text].join(" "), /demo/i,
      "and no text says Demo");
  }
}
for (const unknown of [view(null, PRICE), view(1, NONE), view(1, FAILED)]) {
  assert.equal(unknown.value, null, "an unknown value is no $0.00");
  assert.doesNotMatch(JSON.stringify(unknown), /\$0\.00/);
}
console.log("ok  the labels of the USD total");
console.log("overview: ok");
