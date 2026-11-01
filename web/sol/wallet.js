// The kind of a Solana wallet (ZOLANA.md 3.9, limit 2): a FROST key package carries no mode, so the
// page derives cluster, mode and label from the network that the people of the wallet confirmed,
// never from a document, a secret or a file. The wasm gives the label and the program label.
import { CLUSTER } from "./docs.js";

const CLUSTER_OF = { testnet: "devnet", mainnet: "mainnet" };
const MODE_OF = { devnet: "pool", mainnet: "plain" };

/**
 * The wallet kind of a confirmed network: { cluster, mode, label, program }, or null for any
 * value but "testnet" and "mainnet".
 */
export function walletOf(W, network) {
  if (typeof network !== "string" || !Object.hasOwn(CLUSTER_OF, network)) return null;
  const cluster = CLUSTER_OF[network],
    mode = MODE_OF[cluster];
  return {
    cluster,
    mode,
    label: W.sol_wallet_label(cluster, mode),
    program: W.sol_wallet_program_label(cluster, mode),
  };
}

/** The label that the ceremony and the documents of the controller carry. A pool wallet: devnet. */
export const labelOf = (c) => c.wallet?.label ?? CLUSTER;

/** The version label of the program ids of the controller. */
export const programOf = (c) => c.wallet?.program ?? c.W.sol_program_label();

export const isPlain = (c) => c.wallet?.mode === "plain";
