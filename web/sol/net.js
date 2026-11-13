// The cluster table of the private Solana wallet (pool pages only: no file of the plain wallet
// imports this module, cf/test/gate.mjs checks it). Wallet deployment metadata comes from the
// wasm (sol_pool_wallet).
export const NET = {
  devnet: {
    worker: "/sol/worker.js",
    config: "/sol/config.json",
    explorer: "?cluster=devnet",
    faucet: true,
    coin: "Devnet SOL",
    badge: "Devnet",
  },
  mainnet: {
    worker: "/sol/worker-mainnet.js",
    config: "/sol/config-mainnet.json",
    explorer: "",
    faucet: false,
    coin: "SOL",
    badge: "Mainnet",
  },
};

/** The table row of a cluster (Devnet by default). Throws on a name that is not in the table. */
export function netOf(cluster = "devnet") {
  const net = Object.hasOwn(NET, cluster) ? NET[cluster] : undefined;
  if (!net) throw new Error(`Unknown Solana cluster: ${String(cluster)}`);
  return net;
}

/** The disclosure that the private mainnet wallet shows before setup. */
export const MAINNET_DISCLOSURE = [
  "Hold SOL privately and send with your wallet’s approval rule.",
  "Use Add SOL to deposit from a device’s fee address, or share the shielded address for " +
    "private payments. The program address does not receive public SOL deposits.",
];
