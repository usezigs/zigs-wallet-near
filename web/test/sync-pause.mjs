// A catch-up sync must give the page its thread back. The engine scans the blocks that the stream
// of the light-wallet server already holds without a wait, so a fast server held the page for 2 to
// 6 s at a time on mainnet (staging, 2026-11-13). The engine now asks the pause function of the
// page after each block (pacer in app-kit.js). This drives the real engine with a stub of fetch
// that sends 1,000 blocks at once, and measures the longest turn of the event loop.
// Run: node web/test/sync-pause.mjs   (Node 26)
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import { pacer, SLICE_MS } from "../app-kit.js";

Z.initSync({ module: fs.readFileSync(new URL("../pkg/zigs_engine_bg.wasm", import.meta.url)) });

// About 0.5 ms of trial decryption for each action (Node 26, M-series): about 1 s in all.
const BIRTHDAY = 4_500_000, BLOCKS = 1000, ACTIONS = 2, TIP = BIRTHDAY + BLOCKS - 1;
const LONG_MS = 200;   // a longer task is a long animation frame that a person feels

const varint = (n) => {
  const out = [];
  for (let v = BigInt(n); v >= 0x80n; v >>= 7n) out.push(Number(v & 0x7fn) | 0x80);
  return Buffer.from([...out, Number(BigInt(n) >> BigInt(7 * out.length))]);
};
const bytes = (no, b) => Buffer.concat([varint((no << 3) | 2), varint(b.length), Buffer.from(b)]);
const uint = (no, n) => Buffer.concat([varint(no << 3), varint(n)]);
const frame = (flag, body) => {
  const head = Buffer.alloc(5);
  head[0] = flag;
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
};
const TRAILER = frame(0x80, Buffer.from("grpc-status: 0\r\n"));

// A 32 byte value below the size of the Pallas base field (the top two bits are clear).
const fieldBytes = (seed) => {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(seed >>> 0, 0);
  b.writeUInt32LE(0x5eed, 4);
  return b;
};
const hashOf = (height) => fieldBytes(height ^ 0x7a1c);
// The Pallas generator (-1, 2): every action makes the engine do a full trial decryption.
const EPK = Buffer.from("00000000ed302d991bf94c09fc984622" + "0".repeat(30) + "40", "hex");
const CIPHERTEXT = Buffer.alloc(52, 7);
const action = (n) => Buffer.concat([
  bytes(1, fieldBytes(n * 2)), bytes(2, fieldBytes(n * 2 + 1)), bytes(3, EPK), bytes(4, CIPHERTEXT),
]);
// A compact block of one transaction with ACTIONS Ironwood actions (field 9 of CompactTx), and
// the tree sizes after it. The Ironwood tree is empty at the birthday.
function block(height) {
  const actions = Array.from({ length: ACTIONS }, (_, i) => bytes(9, action(height * ACTIONS + i)));
  const tx = Buffer.concat([uint(1, 0), bytes(2, fieldBytes(height)), ...actions]);
  const sizes = Buffer.concat([uint(1, 0), uint(2, 0), uint(3, (height - BIRTHDAY + 1) * ACTIONS)]);
  return Buffer.concat([
    uint(2, height), bytes(3, hashOf(height)), bytes(4, hashOf(height - 1)), uint(5, 1_792_000_000),
    bytes(7, tx), bytes(8, sizes),
  ]);
}

// The start and end heights of a GetBlockRange body: BlockRange { start: BlockID, end: BlockID }.
function rangeOf(body) {
  const read = (at) => {
    let n = 0, shift = 0, byte;
    do { byte = body[at++]; n += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80);
    return [n, at];
  };
  const heights = [];
  for (let at = 5; at < body.length;) {
    const [key, next] = read(at);
    const [len, inner] = read(next);
    if (key === ((1 << 3) | 2) || key === ((2 << 3) | 2)) heights.push(read(inner + 1)[0]);
    at = inner + len;
  }
  return heights;
}

const REPLIES = {
  GetLatestBlock: () => [uint(1, TIP)],
  GetTreeState: () => [Buffer.concat([
    bytes(1, "test"), uint(2, BIRTHDAY - 1),
    bytes(3, Buffer.from(hashOf(BIRTHDAY - 1)).reverse().toString("hex")),
  ])],
  GetBlockRange: (body) => {
    const [start, end] = rangeOf(body);
    return Array.from({ length: end - start + 1 }, (_, i) => block(start + i));
  },
};
// Every message of an answer comes in one chunk, as from a fast server: the worst case.
globalThis.fetch = async (url, init) => {
  const method = String(url instanceof Request ? url.url : url).split("/").pop();
  const req = url instanceof Request ? url : new Request(url, init);
  const body = Buffer.from(await req.arrayBuffer());
  const messages = REPLIES[method](body).map((m) => frame(0, m));
  return new Response(Buffer.concat([...messages, TRAILER]),
    { headers: { "content-type": "application/grpc-web+proto" } });
};

// The longest time between two turns of the event loop while `run` goes on, in ms.
async function longestTurn(run) {
  let last = performance.now(), longest = 0;
  const turn = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  };
  const tick = setInterval(turn, 1);
  const out = await run();
  turn();   // a run that never let the timer in is one long turn
  clearInterval(tick);
  return { out, longest };
}

const keys = JSON.parse(Z.accountKeys(JSON.parse(Z.accountNew("testnet")).seed, "testnet"));
const syncOnce = (pause) => longestTurn(async () => {
  const cw = new Z.ChainWallet(keys.ufvk, BIRTHDAY, "https://lwd.test");
  try { return JSON.parse(await cw.sync(() => {}, pause)); } finally { cw.free(); }
});

// ── Without a pause the fixture holds the thread: the test measures something ──
{
  const { out, longest } = await syncOnce(undefined);
  assert.equal(out.height, TIP, "the sync reaches the tip");
  assert.ok(longest > LONG_MS, `without a pause one turn takes ${Math.round(longest)} ms (more `
    + `than ${LONG_MS}): if not, raise BLOCKS or ACTIONS`);
  console.log(`ok  without a pause: ${Math.round(longest)} ms in one turn`);
}

// ── With the pacer of the page no turn is long, and the sync still reaches the tip ──
{
  const { out, longest } = await syncOnce(pacer());
  assert.equal(out.height, TIP, "the sync reaches the tip");
  assert.ok(longest < LONG_MS, `with the pacer the longest turn is ${Math.round(longest)} ms`);
  console.log(`ok  with the pacer (${SLICE_MS} ms slices): longest turn ${Math.round(longest)} ms`);
}
