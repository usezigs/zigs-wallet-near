// Where the page gets the Helius URL (cf/src/index.js serves /sol/config.json). fetchRpcUrl takes
// the URL from the server answer only, keeps nothing in storage, says "not available" for a 503 or
// a 404, and asks to check the connection for every other failure. When the server gives no
// URL, the page loads nothing of Solana, says so once, and does not ask again at the next redraw.
// Before the load, its diagnostics name no Solana part. After the failed load, they say that Zigs
// could not read the Solana part, and its Activity list says that Solana did not load.
// Run: node web/test/sol-config.mjs   (Node 26)
import assert from "node:assert/strict";
import { MAINNET_DISCLOSURE } from "../sol/net.js";
import {
  NOT_LOADED, UNAVAILABLE, WORKER_POLICY_MAINNET, fetchRpcUrl, requireWorkerPolicy,
} from "../sol/session.js";
import { config, loadRig, sleep, storage } from "./sol-rig.mjs";

const KEY_NAME = "api-key";

const URL_OK = `https://devnet.helius-rpc.com/?${KEY_NAME}=not-a-real-key`;
const asked = [];
const answering = (make) => async (url, init) => {
  asked.push([String(url), init]);
  return make();
};
const withFetch = async (make, body) => {
  const real = globalThis.fetch;
  globalThis.fetch = answering(make);
  try {
    return await body();
  } finally {
    globalThis.fetch = real;
  }
};
const json = (value, status = 200) => () => Response.json(value, { status });

// The text of the open wallet page, with a recorder in place of the stub page of the rig.
class Rec extends Node {
  constructor() {
    super();
    Object.assign(this, { kids: [], style: {}, attrs: {} });
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  append(...nodes) {
    this.kids.push(...nodes);
  }
}
const textOf = (node) => node.text ?? node.kids.map(textOf).join("");
function pageText(t) {
  const real = globalThis.document;
  globalThis.document = {
    createElement: () => new Rec(),
    createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }),
    documentElement: { dataset: {} },
  };
  try {
    return textOf(t.groupView());
  } finally {
    globalThis.document = real;
  }
}

// ── fetchRpcUrl ──
{
  const before = storage.size;
  const url = await withFetch(json({ rpcUrl: URL_OK }), fetchRpcUrl);
  assert.equal(url, URL_OK);
  assert.deepEqual(asked.at(-1), ["/sol/config.json", { cache: "no-store" }]);
  assert.equal(storage.size, before, "the URL is not stored");
  assert.equal(UNAVAILABLE, "Solana is not available on this server");
  // S12: only a 503 or a 404 says that this server has no Solana.
  const off = [
    ["a 503 answer", json({ error: "Solana is not set up on this server." }, 503)],
    ["a 404 answer", () => new Response("Not found\n", { status: 404 })],
    ["a rpcUrl in an error answer", json({ rpcUrl: URL_OK }, 503)],
  ];
  for (const [what, make] of off) {
    await assert.rejects(() => withFetch(make, fetchRpcUrl), { message: UNAVAILABLE }, what);
  }
  // Any other failure is the connection: the person can press Try again.
  const offline = () => {
    throw new TypeError("offline");
  };
  const down = [
    ["no answer", offline],
    ["a 500 answer", () => new Response("", { status: 500 })],
    ["a rpcUrl in a 500 answer", json({ rpcUrl: URL_OK }, 500)],
    ["a body that is no JSON", () => new Response("<html>", { status: 200 })],
    ["no rpcUrl", json({})],
    ["an empty rpcUrl", json({ rpcUrl: "" })],
    ["a number as rpcUrl", json({ rpcUrl: 7 })],
    ["null", json(null)],
  ];
  for (const [what, make] of down) {
    await assert.rejects(() => withFetch(make, fetchRpcUrl), { message: NOT_LOADED }, what);
  }
}

// ── The mainnet URL and the mainnet Worker ──
{
  const MAIN_OK = `https://mainnet.helius-rpc.com/?${KEY_NAME}=not-a-real-key`;
  assert.equal(await withFetch(json({ rpcUrl: MAIN_OK }), () => fetchRpcUrl("mainnet")), MAIN_OK);
  assert.deepEqual(asked.at(-1), ["/sol/config-mainnet.json", { cache: "no-store" }]);
  for (const status of [404, 503]) {
    const make = () => new Response("", { status });
    await assert.rejects(() => withFetch(make, () => fetchRpcUrl("mainnet")),
      { message: UNAVAILABLE }, `mainnet ${status}`);
  }
  for (const name of ["testnet", "constructor", "__proto__", "toString"]) {
    await assert.rejects(() => fetchRpcUrl(name), /Unknown Solana cluster/, name);
  }

  const DEV_POLICY = WORKER_POLICY_MAINNET.replace("mainnet.helius", "devnet.helius");
  assert.match(WORKER_POLICY_MAINNET, /connect-src 'self' https:\/\/mainnet\.helius-rpc\.com /);
  assert.doesNotMatch(WORKER_POLICY_MAINNET, /devnet/);
  const policy = (text) => () =>
    new Response("", { status: 200, headers: { "content-security-policy": text } });
  await withFetch(policy(WORKER_POLICY_MAINNET), () => requireWorkerPolicy("mainnet"));
  assert.equal(asked.at(-1)[0], "/sol/worker-mainnet.js");
  await withFetch(policy(DEV_POLICY), () => requireWorkerPolicy("devnet"));
  assert.equal(asked.at(-1)[0], "/sol/worker.js");
  await assert.rejects(() => withFetch(policy(DEV_POLICY), () => requireWorkerPolicy("mainnet")),
    /did not send the policy/, "the Devnet header does not pass for mainnet");
  await assert.rejects(() => withFetch(policy(WORKER_POLICY_MAINNET),
    () => requireWorkerPolicy("devnet")), /did not send the policy/, "nor the reverse");
  await assert.rejects(() => withFetch(() => new Response("", { status: 404 }),
    () => requireWorkerPolicy("mainnet")), { message: UNAVAILABLE }, "a 404 is UNAVAILABLE");
  await assert.rejects(() => withFetch(() => new Response("", { status: 200 }),
    () => requireWorkerPolicy("mainnet")), /did not send the policy/, "no header");

  const text = MAINNET_DISCLOSURE.join("\n");
  assert.match(text, /Add SOL/);
  assert.match(text, /shielded address/);
  assert.match(text, /does not receive public SOL deposits/);
  assert.doesNotMatch(text, /not audited|staging|0\.5 SOL/);
}

// ── The page, with a server that gives no URL ──
{
  config.down = true;
  const rig = await loadRig();
  const { t, waitFor } = rig;
  // The page gets the Solana start documents only after `startDocs` ends, so the test can read
  // the diagnostics before they arrive.
  let arrive;
  const startDocs = new Promise((ok) => {
    arrive = ok;
  });
  const collection = rig.db.collection;
  rig.db.collection = (path) => {
    const ref = collection(path);
    if (!path.endsWith("/solstart")) return ref;
    const onSnapshot = (next, onError) =>
      ref.onSnapshot((snap) => startDocs.then(() => next(snap)), onError);
    return { ...ref, onSnapshot };
  };
  const gid = await rig.wallet({ name: "Down" });
  await waitFor("the wallet", () => t.state.gid === gid && t.state.g);
  assert.equal(t.solOn(), true, "a testnet wallet is on");
  const real = globalThis.fetch;
  let configCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "/sol/config.json") configCalls++;
    return real(url, init);
  };
  try {
    // Before the Solana tab draws, the module is not loaded. The start documents arrived and hold
    // no start, so the diagnostics name no Solana part and count nothing of it.
    const { diagnostics } = await import("../app-help.js");
    await waitFor("the start watch", () => rig.live("groups/" + gid + "/solstart") > 0);
    await sleep(50);
    assert.match(diagnostics(), /^Solana part: not read yet$/m,
      "before the start documents arrive, the diagnostics say not read yet");
    arrive();
    await sleep(50);
    assert.equal(t.sol, null, "the module is not loaded yet");
    const none = diagnostics();
    assert.match(none, /^Solana part: not added$/m,
      "a wallet with no start document has no Solana part");
    assert.doesNotMatch(none, /^Solana (backup files|payments)/m,
      "and the diagnostics count nothing of it");
    const tab = () => t.walletView([], null);
    t.ui.tab = "solana";
    tab();
    await waitFor("the failure", () => t.solError !== "");
    assert.equal(t.solError, UNAVAILABLE);
    assert.equal(t.sol, null, "nothing of Solana is attached");
    assert.match(t.banner.text, /Solana did not load: Solana is not available on this server/);
    // The diagnostics tell a failed load from a read that is still going (unified-setup.mjs).
    assert.match(diagnostics(), /^Solana backup files not saved: could not read$/m,
      "a failed Solana load says could not read");
    assert.match(diagnostics(), /^Solana payments to approve: could not read$/m,
      "and so does the count of payments");
    assert.match(diagnostics(), /^Solana part: could not read$/m,
      "the Solana part of a failed load says could not read");
    t.ui.tab = "activity";
    assert.match(pageText(t), /Solana did not load, so its transactions are not shown here\./,
      "an Activity list says that Solana did not load");
    t.ui.tab = "solana";
    for (let i = 0; i < 5; i++) tab();
    await t.solLoad();
    await sleep(100);
    assert.equal(configCalls, 1, "a redraw does not ask the server again");
    await assert.rejects(
      () => t.applyBackup({ kind: "zigs-sol-backup", group: gid, seat: 1 }, true),
      new RegExp(UNAVAILABLE),
    );
  } finally {
    globalThis.fetch = real;
    t.ui.tab = "overview";
  }
}
console.log("sol-config: ok");
process.exit(0);
