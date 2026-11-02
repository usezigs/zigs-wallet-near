// The wire forms that the plain wasm entries read (wasm-sol/src/plain.rs): the 66 bytes of the pins
// and the intent that names the token account of the group. The page builds them to ask the wasm
// which account to read, so that no address comes from a document or from the network.
const CLUSTER_BYTE = { devnet: 1, mainnet: 2 };
const MODE_PLAIN = 1;
const TAG_ENABLE_TOKEN = 16;

export const bytesOfHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** The 66 bytes of the pins of a plain wallet: cluster, mode, group key and payer (both hex). */
export function plainPins(wallet, groupKey, payer) {
  const head = [CLUSTER_BYTE[wallet.cluster], MODE_PLAIN];
  return Uint8Array.from([...head, ...bytesOfHex(groupKey), ...bytesOfHex(payer)]);
}

/** The intent "enable token": its tag, the place of the token in the pinned table, a blockhash. */
export const enableTokenIntent = (token, blockhash) =>
  Uint8Array.from([TAG_ENABLE_TOKEN, token, ...bytesOfHex(blockhash)]);
