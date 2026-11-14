import assert from "node:assert/strict";
import {
  allowMainnetLocalDevices, localDeviceRisk, mainnetLocalDevicesAllowed,
} from "../local-devices.js";

const saved = new Map();
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
};
const wallet = { id: "ab".repeat(10), network: "mainnet", n: 3, t: 2 };
const other = { ...wallet, id: "ac".repeat(10) };
assert.equal(mainnetLocalDevicesAllowed(wallet), false, "mainnet starts without consent");
allowMainnetLocalDevices(wallet);
assert.equal(mainnetLocalDevicesAllowed(wallet), true, "explicit choice survives a read");
assert.equal(mainnetLocalDevicesAllowed(other), false, "consent belongs to one wallet");
assert.equal(mainnetLocalDevicesAllowed({ ...wallet, network: "testnet" }), false);
assert.equal(mainnetLocalDevicesAllowed({ ...wallet, t: 3 }), false,
  "a different approval rule needs its own acknowledgement");
assert.throws(() => allowMainnetLocalDevices({ ...wallet, id: "constructor" }));

const share = (id, verified = true) => ({ id, has: true, verified });
assert.equal(localDeviceRisk(wallet, [share(1), share(1)]), null,
  "two copies of one share do not count as two devices");
assert.deepEqual(localDeviceRisk(wallet, [share(1), share(2)]), {
  held: 2, required: 2, canApproveZcash: true,
});
assert.equal(localDeviceRisk(wallet, [share(1), share(2, false)]).canApproveZcash, false,
  "an unverified share cannot support an approval claim");
assert.equal(localDeviceRisk({ ...wallet, t: 3 }, [share(1), share(2)])
  .canApproveZcash, false, "co-location below the threshold still needs another device");
assert.equal(localDeviceRisk(wallet, [share(1), { ...share(2), has: false }]), null);
assert.equal(localDeviceRisk({ ...wallet, network: "testnet" }, [share(1), share(2)]), null);
assert.equal(localDeviceRisk(wallet, [share(0), share(4), share(1)]), null);

saved.set("zf-mainnet-local-devices:" + other.id, "malformed");
assert.equal(mainnetLocalDevicesAllowed(other), false);
globalThis.localStorage.setItem = () => { throw new Error("storage denied"); };
assert.throws(() => allowMainnetLocalDevices(other), /could not save/);
globalThis.localStorage.getItem = () => { throw new Error("storage denied"); };
assert.equal(mainnetLocalDevicesAllowed(wallet), false, "unreadable consent never enables setup");
console.log("ok  wallet-scoped mainnet consent and distinct verified share warnings");
