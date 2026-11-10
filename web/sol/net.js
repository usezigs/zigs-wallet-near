// The cluster table of the private Solana wallet (pool pages only: no file of the plain wallet
// imports this module, cf/test/gate.mjs checks it). The cap is lamports as decimal text, or null.
export const NET = {
  devnet: {
    worker: "/sol/worker.js",
    config: "/sol/config.json",
    explorer: "?cluster=devnet",
    faucet: true,
    coin: "Devnet SOL",
    badge: "Devnet",
    cap: null,
  },
  mainnet: {
    worker: "/sol/worker-mainnet.js",
    config: "/sol/config-mainnet.json",
    explorer: "",
    faucet: false,
    coin: "SOL",
    badge: "Mainnet",
    cap: "500000000",
  },
};

/** The table row of a cluster (Devnet by default). Throws on a name that is not in the table. */
export function netOf(cluster = "devnet") {
  const net = NET[cluster];
  if (!net) throw new Error(`Unknown Solana cluster: ${String(cluster)}`);
  return net;
}

/** The disclosure that the private mainnet wallet shows before setup. */
export const MAINNET_DISCLOSURE = [
  "This private wallet uses real SOL.",
  "It is a test on staging. No one audited it.",
  "One upgrade key can replace the program, and then move the funds of every private wallet. " +
    "The Zigs owner holds that key.",
  "The cap is 0.5 SOL. The app checks the private balance at each Add SOL, and only in this app. " +
    "Private sends out and deposits by other people can let a group hold more over time.",
  "Never send public SOL to the PDA address. No code can move it.",
  "Each fee address keeps 650,240 lamports. They leave only through Add SOL.",
  "Do not expect anonymity. The mainnet pool is small.",
];
