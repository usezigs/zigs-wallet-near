// Loaded only by the loopback development server, never by web/app.js.
import { renderSide, swapWorkspace } from '/app-shell.js';
import { createSwapPreview } from '/app-swap-preview.js';
import { MockSwapProvider } from '/swap-preview-model.js';
import { NearIntentsSwapProvider } from '/near-intents-swap-provider.js';
import { ui } from '/app-state.js';

ui.tab = 'swap'; renderSide();
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario');
if (['dark', 'light'].includes(params.get('theme'))) document.documentElement.dataset.theme =
  params.get('theme');
const fixture = scenario === 'error' ? { fail: true } : scenario === 'unsupported' ? {
  unsupported: true }
  : scenario === 'balance' ? { balanceAtomic: '10000000' }
    : scenario === 'stale-balance' ? { staleBalance: true } : {};
if (scenario === 'hackathon') {
  const preview = createSwapPreview({ id: 'hackathon-example', name: 'Example wallet · simulated',
    network: 'mainnet', networks: 'Mainnet prices · simulated wallet', preferredFrom: 'sol',
    threshold: 'Example: 2 of 3 devices', live: false, simulated: true,
    solGroup: { mode: 'private', refundTo: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      balanceAtomic: '250000000', ready: () => 'Simulated wallet · no funds' } },
  new NearIntentsSwapProvider());
  document.getElementById('app').replaceChildren(preview.element);
  window.swapFixture = preview;
} else if (['private', 'plain', 'standard', 'privacy', 'testnet', 'quotes', 'save-error']
  .includes(scenario)) {
  await mountSwapflow(scenario);
} else if (scenario === 'before') {
  const before = await import('/__swap_before__.js');
  document.getElementById('app').replaceChildren(before.swapWorkspace());
} else {
  // Context is explicitly synthetic. No real wallet, secrets or engine are booted.
  const preview = createSwapPreview({ demo: true, name: 'Example wallet · fixture',
    threshold: '2 of 3 device approvals per payment.' },
    new MockSwapProvider(fixture));
  document.getElementById('app').replaceChildren(preview.element);
  window.swapFixture = preview;
  window.swapProductionView = swapWorkspace;
}
document.getElementById('engine-text').textContent = scenario === 'hackathon'
  ? 'Live quotes · simulated wallet · no funds'
  : 'Isolated UI fixture · engine not started';
if (scenario === 'hackathon') document.querySelector('.side-empty').textContent =
  'Example wallet only · no wallet connected';
// Importing the shared widgets also imports the app render loop. A background focus redraw
// must not replace this isolated fixture with the unbooted app's loading screen.
document.getElementById('app').replaceChildren = () => {};
window.swapHarnessReady = true;

async function mountSwapflow(scenario) {
  const engine = await import('/pkg/zigs_engine.js');
  const bytes = await (await fetch('/pkg/zigs_engine_bg.wasm')).arrayBuffer();
  await engine.default({ module_or_path: bytes });
  const { setZ } = await import('/app-engine.js');
  const { setGkeys } = await import('/app-keystore.js');
  const { swapJournal } = await import('/app-swap-store.js');
  setZ(engine);
  const gid = 'swapflow-fixture-' + scenario;
  const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(7))).replace(/=+$/, '');
  setGkeys({ [gid]: secret });
  const sol = '7DYCAhqwQSKqqL1h8V1XmY1BTcMWxrASQYKNMy87jeg3';
  const ua = 'u1' + 'q'.repeat(105);
  const proposalKey = 'swapflow-proposal:' + gid;
  let status = 'PENDING_DEPOSIT', routing = null, receipt = null,
     proposed = JSON.parse(sessionStorage.getItem(proposalKey) || 'null'), preview;
  const provider = new MockSwapProvider();
  provider.openSwap = async (ask) => {
    routing = ask.confidentiality;
    const asset = ask.from === 'sol';
    return { confidentiality: routing, amountIn: ask.amountAtomic,
      amountOut: asset ? '20000000' : '50000000',
      minAmountOut: asset ? '19900000' : '49750000', recipient: ask.recipient,
      refundTo: ask.refundTo, depositAddress: asset ? sol : 't1' + 'a'.repeat(33),
      deadline: new Date(Date.now() + 6 * 3600_000).toISOString(),
      correlationId: 'synthetic-swapflow-receipt',
         signature: 'synthetic-not-a-provider-signature' };
  };
  provider.swapStatus = async () => ({ status, swap: {
    confidentiality: routing ?? preview?.model.value.live?.swap.confidentiality ?? 'basic' },
    originTxs: proposed ? ['ab'.repeat(32)] : [],
    destinationTxs: status === 'SUCCESS' ? ['cd'.repeat(32)] : [],
    ...(status === 'REFUNDED' ? { refundedAmount: '99500000',
       refundReason: 'DEADLINE_EXCEEDED' } : {}) });
  const context = { id: gid, name: 'Example wallet · synthetic',
    threshold: '2 of 3 device approvals', network: scenario === 'testnet' ? 'testnet' : 'mainnet',
    preferredFrom: 'sol',
    networks: scenario === 'testnet' ? 'Zcash Testnet · Solana Devnet' : 'Zcash Mainnet',
    live: scenario !== 'quotes', payout: scenario === 'testnet' ? {
       reason: 'A mainnet wallet is required.' } : { address: ua },
    journal: scenario === 'save-error' ? { load: async () => [], save: async () => {
       throw Error('Synthetic quota failure'); } } : swapJournal,
    receipt: () => receipt,
    zec: { recipient: sol, refundTo: 't1' + 'a'.repeat(33), pay: () => {} },
    solGroup: { mode: scenario === 'plain' ? 'plain' : 'private', refundTo: sol,
      refundLabel: 'Public fee address of device 1', balanceAtomic: '250000000',
      ready: () => null,
      pay: async (swap) => { proposed = { id: 'synthetic-withdrawal', deposit: swap.depositAddress,
        word: '1 of 2 device approvals' }; sessionStorage.setItem(proposalKey,
           JSON.stringify(proposed)); return proposed.id; },
      proposal: (id) => proposed?.id === id ? proposed : null,
      proposalForDeposit: (address) => proposed?.deposit === address ? proposed : null } };
  preview = createSwapPreview(context, provider);
  document.getElementById('app').replaceChildren(preview.element);
  window.swapFixture = { ...preview, context,
    async status(next) { status = next; await preview.model.readSwap(preview.model.value.live); },
    async routing(next) { routing = next; await preview.model.readSwap(preview.model.value.live); },
    receipt(next) { receipt = next; preview.setContext(context); } };
}
