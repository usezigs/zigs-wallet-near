// Two tabs of one browser and the secrets record (ZEC-12). The secrets are one record that each
// tab writes whole from its own memory. Tab A burns a nonce (Zcash or Solana) and saves it. Tab B
// holds the older copy and saves something else: a backup, a restore, a room, a ceremony step, a
// chat, a wallet key, the Solana choice, the account. Every such save takes the lock of the
// secrets and the once-only fields of storage first, so the burned nonce never comes back. A step
// that holds the lock saves with the held variant: a step that waited for the lock again would
// hang, and the deadlock cases below run each holder under a time limit.
// A save waits for the lock. A step that holds it and reads storage must not undo the changes of
// its own tab that wait behind it: a new chat or account change, a removed seat, wallet key, chat
// or account, the saves of a passkey prompt. Those cases (laterLocks) grant the lock in a later
// task, as a browser does: Node's own navigator.locks runs the step at once and hides the race.
// Tab B is the page under test. Tab A is a write to storage, as another tab makes it.
// Run: node web/test/nonce-locks.mjs   (Node 26)
import assert from "node:assert/strict";
import { newPersonal } from "../personal.js";
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

const GID = "ab".repeat(10), K = GID + ":1", K2 = GID + ":2", KEY = "k".repeat(43);
const share = { identifier: "01", verifying_share: "aa" };
const CID = "cc".repeat(10), ROOM = { key: "v".repeat(43), member: "dd".repeat(10), at: 1 };
const vrec = { cred: "YQ", salt: "Yg" };
const vkey = await aesKey(new Uint8Array(32).fill(7));
const addressOf = (byte) => JSON.parse(Z.accountKeys(byte.repeat(32), "testnet")).address;

// Seat 1 as tab B holds it (the nonces are live), and as tab A saved it (they are burned). Tab A
// also holds a mark, a salt and a body that tab B lacks: a save of tab B must keep them.
const solPart = (records) => ({ keyPackage: { sol: 1 }, ...records });
const seatB = () => ({
  keyPackage: share, nonces: { s1: { sighash: "aa", nonces: "n" } },
  marks: { s1: { approved: "aa" } },
  sol: solPart({ nonces: { z1: { digest: "d1", nonces: "sn" } }, used: {}, pending: {} }),
});
const seatA = () => ({
  keyPackage: share, nonces: {}, marks: { s1: { approved: "aa" }, s2: { burned: true } },
  unsent: { s1: { share: "x" } },
  sol: solPart({ nonces: {}, used: { d1: "z1" }, pending: { z1: { share: "sx", digest: "d1" } },
    salts: { z1: "salt" }, bodies: { c1: "body" } }),
});
// A second seat with live nonces in every once-only field.
const seat2 = () => ({
  keyPackage: share, nonces: { s1: { sighash: "bb", nonces: "n2" } },
  marks: { s1: { approved: "bb" } }, unsent: { s1: { share: "y" } },
  sol: solPart({ nonces: { z2: { digest: "d2", nonces: "sn2" } }, used: { d2: "z2" }, pending: {},
    salts: { z2: "salt2" }, bodies: { c2: "body2" } }),
});

// ── The stored record, in the two modes ──
const parts = async (mode) => mode === "plain"
  ? { secrets: JSON.parse(storage.get("zf-secrets")), keys: JSON.parse(storage.get("zf-keys")),
    chats: JSON.parse(storage.get("zf-chats")) }
  : openVault(vkey, JSON.parse(storage.get("zf-vault")));

async function storeAs(mode, secrets, more = {}) {
  const { keys = {}, chats = { profile: null, list: {} }, personal = null } = more;
  storage.clear();
  if (mode === "plain") {
    storage.set("zf-secrets", JSON.stringify(secrets));
    storage.set("zf-keys", JSON.stringify(keys));
    storage.set("zf-chats", JSON.stringify(chats));
    return;
  }
  const rec = await seal(vkey, vrec, { secrets, keys, chats, personal });
  storage.set("zf-vault", JSON.stringify(rec));
}

// Tab B starts with the older copy; storage holds what tab A saved.
async function twoTabs(mode) {
  ks.setLocked(null);
  ks.setVault(mode === "sealed" ? { rec: vrec, key: vkey } : null);
  t.secrets = { [K]: seatB() };
  t.gkeys = {};
  t.adoptPersonal(null);
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
  assert.deepEqual(s.marks.s2, { burned: true }, what + ": a mark that only storage holds stays");
  assert.equal(s.sol.salts.z1, "salt", what + ": the Solana salt stays");
  assert.equal(s.sol.bodies.c1, "body", what + ": the Solana body stays");
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

// A seat that storage lacks gets no once-only field from this tab either.
async function unknownSeat(mode) {
  await twoTabs(mode);
  t.secrets[K2] = seat2();
  assert.equal(await ks.putKey("other", KEY), true);
  const kept = { keyPackage: share, sol: solPart({}) };
  assert.deepEqual((await parts(mode)).secrets[K2], kept, mode + ": a seat that storage lacks");
  assert.deepEqual(t.sec(GID, 2), kept, mode + ": and in memory");
}
await unknownSeat("plain");
await unknownSeat("sealed");
await assert.rejects(ks.persistSealed(), /needs the argument fresh/, "fresh is required");

// ── The lock is granted in a later task, as a browser does ──
// A step that holds it reads storage, and the saves of this tab wait behind it. They must not
// undo each other.
function laterLocks() {
  const turns = new Map(), line = new Map();
  return {
    queued: (name) => line.get(name) ?? 0,
    request: (name, fn) => {
      line.set(name, (line.get(name) ?? 0) + 1);
      const run = (turns.get(name) || Promise.resolve())
        .then(() => new Promise((go) => setTimeout(go, 0)))
        .then(() => {
          line.set(name, line.get(name) - 1);
          return fn();
        });
      turns.set(name, run.catch(() => {}));
      return run;
    },
  };
}
const setNavigator = (value) => Object.defineProperty(globalThis, "navigator",
  { configurable: true, value });
async function until(ok) {
  for (let n = 0; !ok(); n++) {
    assert.ok(n < 1000, "timeout");
    await sleep(2);
  }
}
// Holds the lock of the secrets, as a step of another tab does, until the returned function runs.
async function gateLock(locks) {
  let open;
  await new Promise((entered) => {
    const step = new Promise((done) => { open = done; });
    locks.request("zigs-secrets", () => {
      entered();
      return step;
    });
  });
  return open;
}

const G2 = "ef".repeat(10), K3 = G2 + ":1", CID2 = "c1".repeat(10);
const ROOM2 = { key: "w".repeat(43), member: "d1".repeat(10), at: 2 };
const account = newPersonal({ seed: "01".repeat(32), network: "testnet", birthday: 1000 },
  "a".repeat(43));
const memory = () => ({ secrets: t.secrets, keys: t.gkeys, chats: t.chats, personal: t.personal });
// Tab B holds the older copy of a full record (three seats, two wallet keys, a chat and, sealed,
// an account). Storage holds what tab A saved: the burned nonces of seat 1.
async function fullTabs(mode) {
  await twoTabs(mode);
  const rest = () => ({ [K2]: seat2(), [K3]: { keyPackage: share } });
  const room = { profile: null, list: { [CID]: ROOM } };
  await storeAs(mode, { [K]: seatA(), ...rest() }, { keys: { [GID]: KEY, [G2]: KEY },
    chats: room, personal: mode === "sealed" ? account : null });
  t.secrets = { [K]: seatB(), ...rest() };
  t.gkeys = { [GID]: KEY, [G2]: KEY };
  t.chats.list[CID] = ROOM;
  if (mode === "sealed") t.personal = structuredClone(account);
}
const bothCopies = async (mode, ok, what) => {
  const stored = await parts(mode);
  assert.ok(ok(stored), mode + " " + what + ": in storage");
  assert.ok(ok(memory()), mode + " " + what + ": in memory");
  assertBurned(stored.secrets, mode + " " + what);
  assertBurned({ [K]: t.sec(GID, 1) }, mode + " " + what + " (memory)");
};

// ── M1: a storage step holds the lock; a chat or account change asks a save behind it ──
const addChat = () => {
  t.chats.list[CID2] = ROOM2;
  return ks.persist();
};
const hasChat = (p) => p.chats.list[CID2]?.member === ROOM2.member;
const changes = [
  ["chat", "plain", "zf-chats", addChat, hasChat],
  ["chat", "sealed", "zf-vault", addChat, hasChat],
  ["account", "sealed", "zf-vault", () => t.changePersonal((p) => { p.backedUp = true; }),
    (p) => p.personal?.backedUp === true],
];
async function changeBehindStep([what, mode, key, change, saved]) {
  const locks = laterLocks();
  setNavigator({ locks });
  await fullTabs(mode);
  const open = await gateLock(locks);
  const step = t.takeFromTab(key);
  const changing = change();
  await until(() => locks.queued("zigs-secrets") >= 2);
  open();
  await Promise.all([step, changing]);
  await bothCopies(mode, saved, "a " + what + " change behind a storage step");
}
for (const c of changes) await changeBehindStep(c);

// ── M2: a locked step runs before the save of a removal; the item stays removed ──
const removals = [
  ["seat", () => t.undoRestore({ gid: GID, seat: 2, addedKey: false }),
    (p) => !(K2 in p.secrets) && K in p.secrets],
  ["wallet key", () => t.undoRestore({ gid: G2, seat: 1, addedKey: true }),
    (p) => !(K3 in p.secrets) && !(G2 in p.keys) && GID in p.keys],
  ["chat", () => t.leaveChat(CID), (p) => !(CID in p.chats.list)],
  ["account", () => t.removeAccount(), (p) => p.personal === null],
];
async function removeBehindStep(mode, [what, remove, gone]) {
  if (what === "account" && mode === "plain") return;
  const locks = laterLocks();
  setNavigator({ locks });
  await fullTabs(mode);
  const open = await gateLock(locks);
  const step = t.exclusive("secrets", async () => {
    await sleep(30);
    await t.takeStored();
  });
  const removing = remove();
  open();
  await Promise.all([step, removing]);
  await t.exclusive("secrets", async () => {});   // undoRestore does not wait for its save
  await bothCopies(mode, gone, "a removed " + what);
}
for (const r of removals) await removeBehindStep("plain", r);
for (const r of removals) await removeBehindStep("sealed", r);

// ── The account reread (rereadVault) takes no lock: it keeps an account save that waits ──
async function rereadBehindSave(name, act, during, kept) {
  const locks = laterLocks();
  setNavigator({ locks });
  await fullTabs("sealed");
  const open = await gateLock(locks);
  const acting = act();
  await until(() => locks.queued("zigs-secrets") >= 1);   // the account save waits behind the gate
  await within(name, during());   // a step that waits for the save would hang here
  open();
  await acting;
  await bothCopies("sealed", kept, name);
}
const backUp = () => t.changePersonal((p) => { p.backedUp = true; });
await rereadBehindSave("an account change kept over a reread", backUp, () => t.rereadPersonal(),
  (p) => p.personal?.backedUp === true);
await rereadBehindSave("an account removal kept over a change", () => t.removeAccount(),
  () => assert.rejects(backUp(), /There is no personal account/), (p) => p.personal === null);

// ── H1: saves during the passkey prompt are in the sealed record ──
async function protectionWindow() {
  const locks = laterLocks(), pk = fakePasskey(locks), create = pk.credentials.create;
  let open, asking = false;
  const gate = new Promise((go) => { open = go; });
  pk.credentials.create = async (...args) => {
    asking = true;
    await gate;
    return create(...args);
  };
  setNavigator(pk);
  await fullTabs("plain");
  ks.setVault(null);
  const locking = ks.lockWithPasskey();
  await until(() => asking);
  const saves = [t.putSec(GID, 1, { signSk: "sk", signPk: "pk" }), ks.putKey("other", KEY),
    t.putSec(GID, 2, { room: { id: "r", key: KEY } })];
  delete t.chats.list[CID];
  saves.push(addChat());
  open();
  await locking;
  assert.deepEqual(await Promise.all(saves), [true, true, true, true], "the saves resolve true");
  const sealed = await openVault(ks.vault.key, JSON.parse(storage.get("zf-vault")));
  const ok = (p) => p.secrets[K].signSk === "sk" && p.secrets[K].signPk === "pk"
    && p.keys.other === KEY && p.secrets[K2].room.id === "r" && hasChat(p)
    && !(CID in p.chats.list);
  assert.ok(ok(sealed), "the changes of the prompt are in the sealed record");
  assert.ok(ok(memory()), "and in memory");
  assertBurned(sealed.secrets, "protection window");
  assertBurned({ [K]: t.sec(GID, 1) }, "protection window (memory)");
  assert.equal(storage.has("zf-secrets"), false, "the plain copies are gone");
}
await protectionWindow();

// ── No save waits: a step takes what another tab saved, and writes nothing over it ──
async function takesOtherTab(mode, key) {
  await twoTabs(mode);
  await storeAs(mode, { [K]: seatA(), [K2]: seat2() }, { keys: { other: KEY },
    chats: { profile: null, list: { [CID]: ROOM } } });
  await t.takeFromTab(key);
  const ok = (p) => K2 in p.secrets && p.keys.other === KEY && CID in p.chats.list;
  assert.ok(ok(memory()), mode + ": this tab takes the seat, the key and the chat");
  assert.ok(ok(await parts(mode)), mode + ": and storage keeps them");
  assertBurned((await parts(mode)).secrets, mode + " no save waits");
}
await takesOtherTab("plain", "zf-chats");
await takesOtherTab("sealed", "zf-vault");

// One write holds the ask of every save before it: a second step flushes nothing again. Tab A
// saves a seat between the two steps, and the second step takes it.
async function secondStep(mode) {
  const locks = laterLocks();
  setNavigator({ locks });
  await twoTabs(mode);
  await storeAs(mode, { [K]: seatB() });
  const open = await gateLock(locks);
  const first = t.exclusive("secrets", () => t.takeStored());
  const otherTab = t.exclusive("secrets", () => storeAs(mode, { [K]: seatB(), [K2]: seat2() }));
  const second = t.exclusive("secrets", () => t.takeStored());
  const saving = ks.putKey("other", KEY);
  open();
  await Promise.all([first, otherTab, second, saving]);
  const ok = (p) => K2 in p.secrets && p.keys.other === KEY;
  assert.ok(ok(await parts(mode)) && ok(memory()), mode + ": the seat of tab A stays");
}
await secondStep("plain");
await secondStep("sealed");

// A save asks for the lock while the step decrypts the record: the step reads it again.
async function askedDuringRead() {
  const locks = laterLocks(), get = localStorage.getItem;
  setNavigator({ locks });
  await fullTabs("sealed");
  let armed = true, saving;
  localStorage.getItem = (name) => {
    if (armed && name === "zf-vault") {
      armed = false;
      delete t.secrets[K2];
      saving = ks.persist();
    }
    return get(name);
  };
  try {
    await t.exclusive("secrets", () => t.takeStored());
  } finally { localStorage.getItem = get; }
  await saving;
  await bothCopies("sealed", (p) => !(K2 in p.secrets), "a seat removed during the read");
}
await askedDuringRead();

// A save asks for the lock between the read of a storage step and its replace of the chats.
async function askedAfterRead() {
  const locks = laterLocks(), get = localStorage.getItem;
  setNavigator({ locks });
  await fullTabs("plain");
  let armed = true, saving;
  localStorage.getItem = (name) => {
    if (armed && name === "zf-secrets") {
      armed = false;
      queueMicrotask(() => { saving = addChat(); });
    }
    return get(name);
  };
  try { await t.takeFromTab("zf-chats"); } finally { localStorage.getItem = get; }
  await saving;
  await bothCopies("plain", hasChat, "a chat added after the read");
}
await askedAfterRead();

// A write that fails stops the step: nothing is read over the changes of this tab, and no loop.
async function flushFails(mode) {
  const locks = laterLocks();
  setNavigator({ locks });
  await twoTabs(mode);
  if (mode === "plain") storage.set("zf-secrets", "{damaged");
  else storage.set("zf-vault", "{\"v\":1,\"junk\":true}");
  const open = await gateLock(locks);
  const step = t.exclusive("secrets", () => t.takeStored()).then(() => "no stop", (e) => e.message);
  const saving = addChat();
  open();
  assert.match(await within(mode + " failed flush", step), /could not save its own changes/);
  assert.equal(await saving, false, mode + ": the save fails too");
  assert.ok(hasChat(memory()), mode + ": memory keeps the change");
}
await flushFails("plain");
await flushFails("sealed");
await twoTabs("plain");
assert.equal(await ks.persist(), true, "a save that works clears the failure");
t.adoptPersonal(null);
t.setAcct(null);
Object.defineProperty(globalThis, "navigator", realNavigator);

// ── The payment steps hold the lock too: the approval (commitNow), the cancel (burnUnsigned)
// and the drop of a sent share (dropUnsent). Each runs for real, under a short limit. ──
const wallet = { orchard_fvk: "fvk", ufvk: "u", birthday: 1 };
function payRig() {
  const inspect = JSON.stringify({ sighash: "sh", tx_version: "V6", spends: [], lines: [], fee: 1,
    standard_fee: 1, expiry_height: 5000000, txid: "tx" });
  t.setZ({ ...Z, inspect: () => inspect, latestHeight: async () => 1000,
    signCommit: () => JSON.stringify({ nonces: ["n"], commitments: ["c"] }) });
  Object.assign(t.state, { gid: GID, wallet, seats: { 1: { uid: "me-uid" } },
    g: { network: "testnet" } });
  t.setChain({ gid: GID, url: "https://lwd.test", bal: { height: 1000, spendable: 1e8, pending: 0 },
    received: [], sent: new Set(), cw: { free() {} } });
}
const payment = (id, more) => ({ id, status: "collecting", pczt: "P" + id, createdBy: "me-uid",
  ...more });
async function paySync(mode, more) {
  await twoTabs(mode);
  payRig();
  const seat = () => ({ keyPackage: share, checkedWallet: JSON.stringify(wallet), ...more });
  await storeAs(mode, { [K]: seat() });
  t.secrets = { [K]: seat() };
}
const kept = { nonces: ["n"], commitments: ["c"], sighash: "sh" };
async function payCases(mode) {
  await paySync(mode, {});
  await within(mode + " approve", t.approve(payment("a" + mode), 1));
  assert.ok((await parts(mode)).secrets[K].nonces["a" + mode], mode + ": the approval is saved");
  await paySync(mode, { nonces: { ["c" + mode]: kept } });
  await within(mode + " cancel", t.cancelPayment(payment("c" + mode)));
  assert.equal((await parts(mode)).secrets[K].nonces["c" + mode], undefined, mode + ": burned");
  const sid = "d" + mode, unsent = { rel: "sessions/" + sid + "/shares/1", doc: { shares: "x" } };
  await paySync(mode, { nonces: { [sid]: kept }, unsent: { [sid]: unsent } });
  t.reactSession(payment(sid, { status: "signing", package: "pkg", signers: [1] }),
    { commits: {}, shares: {} });
  await rig.waitFor(mode + " dropUnsent", () => !t.sec(GID, 1).unsent[sid], 5000);
  assert.ok(rig.data.has("groups/" + GID + "/" + unsent.rel), mode + ": the share went out");
  await within(mode + " dropUnsent", t.exclusive("secrets", async () => {}));
  assert.equal((await parts(mode)).secrets[K].unsent[sid], undefined, mode + ": and its copy went");
}
payRig();
await payCases("plain");
await payCases("sealed");

// A step that holds the lock and saves with the locking save hangs. The cases above would fail.
{
  await twoTabs("plain");
  const err = await within("control", t.exclusive("secrets", () => ks.putKey("x", KEY)))
    .then(() => "no hang", (e) => e.message);
  assert.match(err, /hangs: control/, "the control: a holder that locks again does hang");
}

console.log("nonce-locks: ok");
process.exit(0);
