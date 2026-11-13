// Display-only synthetic data. No live wallet, key share, RPC endpoint or transaction.
export function receiveFixture(el, mode = "private", navigate = () => {}) {
  const plain = mode === "plain", devnet = mode === "devnet", gid = "synthetic-receive-wallet";
  const cluster = devnet ? "devnet" : "mainnet", network = devnet ? "testnet" : "mainnet";
  const wallet = { cluster, mode: plain ? "plain" : "pool",
    label: devnet ? "devnet" : plain ? "mainnet-plain" : "mainnet-private", program: "synthetic-program" };
  const done = { cluster: wallet.label, program: wallet.program,
    groupKey: "36".repeat(32), publicKeyPackage: {} };
  if (!plain) Object.assign(done, { nullifierPk: "47".repeat(32), viewingPk: "02" + "58".repeat(32),
    address: "69".repeat(99), pda: "7a".repeat(32), pdaNullifierPk: "8b".repeat(32),
    pdaOwnerHash: "9c".repeat(32), pdaAddress: "ad".repeat(99) });
  return { gid, wallet, W: {}, wait: 0, sessions: [], commits: {}, shares: {},
    docs: { solstart: { 1: { cluster: wallet.label } }, soldone: { 1: done, 2: done },
      soldkg1: {}, soldkg2: {}, solabort: {}, solfee: {}, solprove: {} },
    sync: {}, chain: {}, loaded: {}, form: { asset: "sol", error: null }, direct: null,
    fails: new Map(), refused: new Map(),
    balances: { at: 1, sol: 0n, usdc: null, usdcError: "", fees: {}, nonces: null, error: "" },
    host: { el, state: { gid, g: { id: gid, name: "Demo wallet", n: 2, t: 2, network } },
      groupVersion: () => 3, network: () => network, netConfirmed: () => network,
      solMode: () => devnet ? null : plain ? "plain" : "private", seatIds: () => [1, 2], localSeats: () => [],
      mode: plain ? "plain" : "pool", sec: () => ({}), canWriteAs: () => false, openSolDetails: navigate,
      solanaAction: () => "receive", render() {} } };
}
