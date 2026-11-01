// Two tabs of one browser and the secrets record (ZEC-12). The secrets are one record that each
// tab writes whole from its own memory. Tab A burns a nonce (Zcash or Solana) and saves it. Tab B
// holds the older copy and saves something else: a backup, a restore, a room, a ceremony step, a
// chat, a wallet key, the Solana choice, the account. Every such save takes the lock of the
// secrets and the once-only fields of storage first, so the burned nonce never comes back. A step
// that holds the lock saves with the held variant: a step that waited for the lock again would
// hang, and the deadlock cases below run each holder under a time limit.
// Tab B is the page under test. Tab A is a write to storage, as another tab makes it.
// Run: node web/test/nonce-locks.mjs   (Node 26)
import assert from "node:assert/strict";
import { aesKey, open as openVault, seal } from "../vault.js";
import { approvalOnce, clearPending, dropNonces, saveNonces, shareOnce } from "../sol/nonces.js";
import { putSol } from "../sol/secrets.js";
import { fakeLocks, fakePasskey } from "./passkey-fixture.mjs";
import { loadRig, sleep, storage } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, Z } = rig;
const ks = await import("../app-keystore.js");
const { planSolana, solHost } = await import("../app-sol.js");
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

const GID = "ab".repeat(10), K = GID + ":1", KEY = "k".repeat(43);
const share = { identifier: "01", verifying_share: "aa" };
const CID = "cc".repeat(10), ROOM = { key: "v".repeat(43), member: "dd".repeat(10), at: 1 };
const vrec = { cred: "YQ", salt: "Yg" };
const vkey = await aesKey(new Uint8Array(32).fill(7));
const addressOf = (byte) => JSON.parse(Z.accountKeys(byte.repeat(32), "testnet")).address;

// Seat 1 as tab B holds it (the nonces are live), and as tab A saved it (they are burned).
const solPart = (records) => ({ keyPackage: { sol: 1 }, ...records });
const seatB = () => ({
  keyPackage: share, nonces: { s1: { sighash: "aa", nonces: "n" } },
  marks: { s1: { approved: "aa" } },
  sol: solPart({ nonces: { z1: { digest: "d1", nonces: "sn" } }, used: {}, pending: {} }),
});
const seatA = () => ({
  keyPackage: share, nonces: {}, marks: { s1: { approved: "aa" } },
  unsent: { s1: { share: "x" } },
  sol: solPart({ nonces: {}, used: { d1: "z1" }, pending: { z1: { share: "sx", digest: "d1" } } }),
});

// ── The stored record, in the two modes ──
const parts = async (mode) => mode === "plain"
  ? { secrets: JSON.parse(storage.get("zf-secrets")), keys: JSON.parse(storage.get("zf-keys")),
    chats: JSON.parse(storage.get("zf-chats")) }
  : openVault(vkey, JSON.parse(storage.get("zf-vault")));

async function storeAs(mode, secrets) {
  storage.clear();
  if (mode === "plain") {
    storage.set("zf-secrets", JSON.stringify(secrets));
    storage.set("zf-keys", "{}");
    storage.set("zf-chats", JSON.stringify({ profile: null, list: {} }));
    return;
  }
  const rec = await seal(vkey, vrec, { secrets, keys: {}, chats: { profile: null, list: {} },
    personal: null });
  storage.set("zf-vault", JSON.stringify(rec));
}

// Tab B starts with the older copy; storage holds what tab A saved.
async function twoTabs(mode) {
  ks.setLocked(null);
  ks.setVault(mode === "sealed" ? { rec: vrec, key: vkey } : null);
  t.secrets = { [K]: seatB() };
  t.gkeys = {};
  for (const id of Object.keys(t.chats.list)) delete t.chats.list[id];
  t.restoreWatch.clear();
  await storeAs(mode, { [K]: seatA() });
  rig.data.set("groups/" + GID, { name: "Wallet" });
}

function assertBurned(secrets, what) {
  const s = secrets[K];
  assert.equal(s.nonces.s1, undefined, what + ": the Zcash nonce stays burned");
  assert.deepEqual(s.unsent.s1, { share: "x" }, what + ": the kept share stays");
  assert.deepEqual(s.marks.s1, { approved: "aa" }, what + ": the approval mark stays");
  assert.equal(s.sol.nonces.z1, undefined, what + ": the Solana nonce stays burned");
  assert.equal(s.sol.used.d1, "z1", what + ": the used digest stays");
  assert.ok(s.sol.pending.z1, what + ": the Solana share stays");
}

// ── The writers: every kind of save that is no locked step ──
const file = () => ({
  kind: "zigs-key-share", group: GID, seat: 1, key: KEY, groupName: "Wallet", threshold: 2, of: 3,
  secret: { keyPackage: share, nonces: { evil: { nonces: "from the file" } } },
});
const writers = [
  ["backup", () => t.putSec(GID, 1, { backupSaved: true }), (p) => p.secrets[K].backupSaved],
  ["restore", () => t.applyBackup(file(), true), (p) => p.keys[GID] === KEY
    && p.secrets[K].nonces.evil === undefined],
  ["room", () => t.putSec(GID, 1, { room: { id: "r", key: KEY } }), (p) => p.secrets[K].room.id],
  ["ceremony", () => t.putSec(GID, 1, { r2secret: "s", r1secret: null }),
    (p) => p.secrets[K].r2secret === "s"],
  ["Solana choice", () => planSolana(GID), (p) => p.secrets[K].solAuto],
  ["chat", () => {
    t.chats.list[CID] = ROOM;
    return ks.persist();
  }, (p) => p.chats.list[CID].member === ROOM.member],
  ["wallet key", () => ks.putKey("other", KEY), (p) => p.keys.other === KEY],
];
const sealedOnly = [
  ["account", () => t.persistPersonal(), (p) => p.secrets[K].keyPackage.identifier === "01"],
];

async function runWriter(mode, [name, run, saved]) {
  await twoTabs(mode);
  await run();
  const stored = await parts(mode);
  assertBurned(stored.secrets, mode + " " + name);
  assert.ok(saved(stored), mode + " " + name + ": the save keeps its own change");
  assertBurned({ [K]: t.sec(GID, 1) }, mode + " " + name + " (memory)");
}

async function writerTable(label) {
  for (const w of writers) await runWriter("plain", w);
  for (const w of [...writers, ...sealedOnly]) await runWriter("sealed", w);
  const count = 2 * writers.length + sealedOnly.length;
  console.log("nonce-locks: " + label + ": " + count + " writers");
}
await writerTable("with Web Locks");

// ── Tab A burns inside its lock; tab B starts a save during that hold and waits for it ──
const rawLock = (hold) => navigator.locks.request("zigs-secrets", hold);
async function holdRace(mode) {
  await twoTabs(mode);
  await storeAs(mode, { [K]: seatB() });
  let release;
  const held = new Promise((entered) => rawLock(() => new Promise((done) => {
    release = done;
    entered();
  })));
  await held;
  const burned = { [K]: seatA() };
  await storeAs(mode, burned);   // tab A saves its burn inside its lock
  const before = JSON.stringify(await parts(mode));
  const saving = ks.putKey("other", KEY);
  await sleep(100);
  assert.equal(JSON.stringify(await parts(mode)), before, mode + ": tab B waits for tab A");
  release();
  assert.equal(await saving, true, mode + ": and saves after");
  const stored = await parts(mode);
  assertBurned(stored.secrets, mode + " race");
  assert.equal(stored.keys.other, KEY);
}
await holdRace("plain");
await holdRace("sealed");

// ── A record that does not read stops the save, and nothing is written over it ──
{
  await twoTabs("plain");
  storage.set("zf-secrets", "{damaged");
  assert.equal(await ks.persist(), false, "a damaged plain record stops the save");
  assert.equal(storage.get("zf-secrets"), "{damaged", "and stays as it was");
  await twoTabs("sealed");
  storage.set("zf-vault", "{\"v\":1,\"junk\":true}");
  assert.equal(await ks.persist(), false, "a sealed record that does not open stops the save");
  assert.equal(storage.get("zf-vault"), "{\"v\":1,\"junk\":true}", "and stays as it was");
  await twoTabs("plain");
  storage.delete("zf-secrets");
  assert.equal(await ks.persist(), true, "a first save over no record works");
}

// ── No lock request when nothing is written: locked vault ──
{
  const locks = fakeLocks();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });
  await twoTabs("plain");
  ks.setLocked({ damaged: true });
  assert.equal(await ks.persist(), false, "a locked tab saves nothing");
  assert.deepEqual(locks.requested, [], "and asks for no lock");
  ks.setLocked(null);
  storage.set("zf-vault", "{}");   // another tab turned the passkey lock on
  assert.equal(await ks.persist(), false, "a tab beside a lock of another tab saves nothing");
  assert.deepEqual(locks.requested, [], "and asks for no lock");
  storage.delete("zf-vault");
  assert.equal(await ks.persist(), true);
  assert.deepEqual(locks.requested, ["zigs-secrets"], "a save asks for the lock of the secrets");
  Object.defineProperty(globalThis, "navigator", realNavigator);
}

// ── A browser without Web Locks: the same saves keep the burned nonces ──
{
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  await writerTable("without Web Locks");
  await twoTabs("plain");
  const order = [];
  const step = t.exclusive("secrets", async () => {
    await sleep(50);
    order.push("step");
  });
  const saving = ks.putKey("other", KEY).then(() => order.push("save"));
  await Promise.all([step, saving]);
  assert.deepEqual(order, ["step", "save"], "a save queues behind a step of this tab");
  Object.defineProperty(globalThis, "navigator", realNavigator);
}

// ── Holders: each step that holds the lock saves without asking for it again ──
const within = (what, work) => Promise.race([work, new Promise((_, no) => {
  setTimeout(() => no(new Error("hangs: " + what)), 5000);
})]);

// Tab B and storage hold the same record: the holders make their own steps.
async function synced(mode) {
  await twoTabs(mode);
  await storeAs(mode, { [K]: seatB() });
  t.secrets = { [K]: seatB() };
}
const holders = [
  ["release", () => {
    t.state.gid = GID;
    return t.releaseHold("s1");
  }, (seat) => assert.deepEqual([seat.nonces.s1, seat.marks.s1],
    [undefined, { approved: "aa", released: true }], "the release burned the nonce and marked it")],
  ["storage event", () => t.takeFromTab(ks.vault ? "zf-vault" : "zf-secrets"),
    (seat) => assert.ok(seat.nonces.s1, "a storage event keeps what storage holds")],
  ["recipient", (mode) => ks.saveRecipient({ name: "Studio " + mode, asset: "ZEC",
    address: addressOf(mode === "plain" ? "01" : "02"), network: "testnet", type: "shielded" }),
  (seat) => assert.ok(seat.nonces.s1, "a recipient save keeps the nonces")],
];
async function holderCases(mode) {
  for (const [name, run, check] of holders) {
    await synced(mode);
    await within(mode + " " + name, run(mode));
    check((await parts(mode)).secrets[K]);
  }
}

// The Solana steps in one run: each holds the lock and saves through the host of the page
// (solHost in app-sol.js), which must give them the held save.
async function solanaCases(mode) {
  await synced(mode);
  const c = { host: solHost(), gid: GID };
  const one = { digest: "d2", nonces: "n2", commitments: "c2" };
  await within("putSol", putSol(c.host, GID, 1, { backupSaved: true }));
  await within("approvalOnce", approvalOnce(c, 1, "s2", "d2", async () => one));
  await within("saveNonces", saveNonces(c, 1, "s3", { ...one, digest: "d3" }));
  const made = await within("shareOnce", shareOnce(c, 1, "s3",
    (e) => ({ share: "sh", digest: e.digest })));
  assert.deepEqual(made, { share: "sh", digest: "d3" });
  await within("clearPending", clearPending(c, 1, "s3"));
  await within("dropNonces", dropNonces(c, 1, "s2"));
  const sol = (await parts(mode)).secrets[K].sol;
  assert.deepEqual([sol.nonces.s2, sol.nonces.s3, sol.used.d3, sol.pending.s3],
    [undefined, undefined, "s3", undefined], mode + ": the Solana steps saved");
}
await holderCases("plain");
await holderCases("sealed");
await solanaCases("plain");
await solanaCases("sealed");

// takeVaultRest saves when the sealed record of another tab has no account field.
{
  await twoTabs("sealed");
  const old = { secrets: { [K]: seatA() }, keys: {}, chats: { profile: null, list: {} } };
  storage.set("zf-vault", JSON.stringify(await seal(vkey, vrec, old)));
  t.personal = { seed: "s" };
  await within("account of an older page", t.takeFromTab("zf-vault"));
  assert.ok("personal" in await openVault(vkey, JSON.parse(storage.get("zf-vault"))));
  t.personal = null;
}

// The passkey lock holds both locks and saves inside them.
{
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: fakePasskey() });
  await twoTabs("plain");
  ks.setVault(null);
  storage.set("zf-secrets", JSON.stringify({ [K]: seatB() }));
  t.secrets = { [K]: seatB() };
  await within("lockWithPasskey", ks.lockWithPasskey());
  assert.ok(storage.has("zf-vault"), "the sealed record is saved");
  Object.defineProperty(globalThis, "navigator", realNavigator);
}

// The held saves refuse to run with no lock, and change nothing then.
{
  await twoTabs("plain");
  assert.throws(() => ks.persistHeld(), /without the lock/);
  assert.throws(() => ks.putSecHeld(GID, 1, { guard: 1 }), /without the lock/);
  assert.equal(t.sec(GID, 1).guard, undefined, "the refused change did not reach memory");
}

// A step that holds the lock and saves with the locking save hangs. The cases above would fail.
{
  await twoTabs("plain");
  const err = await within("control", t.exclusive("secrets", () => ks.putKey("x", KEY)))
    .then(() => "no hang", (e) => e.message);
  assert.match(err, /hangs: control/, "the control: a holder that locks again does hang");
}

console.log("nonce-locks: ok");
process.exit(0);
