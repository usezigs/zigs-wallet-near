import { swapRecoveryRecord, swapRecoveryText } from './swap-recovery.js';
// Live NEAR Intents quotes, the live swap from SOL to ZEC (paid from a wallet outside Zigs, or by a
// plain send of the Solana wallet of the group that app-swap-sol.js proposes), the live swap from
// ZEC to SOL (paid by a group payment that app-swap-zec.js opens in Send) and local demo
// interactions. No signing or payment APIs are imported.
import { copyBtn as nativeCopyBtn, el } from './app-dom.js';
import { interfaceIcon } from './sidebar-icons.js';
import { sculptedIcon } from './app-icons.js';
import { NearIntentsSwapProvider } from './near-intents-swap-provider.js';
import { createPostQuantumSwapPreview } from './app-postquantum-swap-preview.js';
import { createSwapPrivacyExplainer } from './app-swap-privacy.js';
import { heliusSwapCredit, nearSwapCredit } from './app-swap-branding.js';
import { swapRecordOf } from './swap-records.js';
import { SWAP_ASSETS, SWAP_DEMO_STEPS, SWAP_FINAL, SWAP_SLIPPAGES, SwapPreviewModel, swapAsset,
  swapDecimal, swapInputError, swapRate, swapSolAddress, swapTime, swapUsd }
  from './swap-preview-model.js';
import { swapPrivacyProblem } from './swap-preview-model.js';
import { nearRouteLabel } from './near-swap-policy.js';

export const LIVE_TAG = 'Hackathon preview · no funds';
// The tag of a live route (SOL to ZEC or ZEC to SOL on a server with NEAR_LIVE): the funds are
// real.
export const SWAP_TAG = 'Live swap · real funds';
const previewTag = (live = false) => el('span', { class: 'swap-preview-tag' },
  interfaceIcon(live ? 'swap' : 'preview'),
  el('span', { class: 'swap-tag-text' }, live ? SWAP_TAG : LIVE_TAG));
const [ZEC_ID, SOL_ID] = [SWAP_ASSETS[0].id, SWAP_ASSETS[1].id];
const PRIVATE_ROUTE = 'Private SOL balance → public SOL deposit → NEAR Confidential Intents → shielded ZEC address.';
const privateRoute = (mode) => mode === 'public'
  ? 'Private SOL balance → public SOL deposit → standard NEAR Intents route → shielded ZEC address.'
  : PRIVATE_ROUTE;
const PRIVATE_REFUND = 'A refund returns to this device’s public fee address. This device alone '
  + 'controls that SOL until it adds it back to the wallet’s private balance.';
export const UNTESTED = 'This Zigs route has not been verified with a funded shielded payout. '
  + 'A successful quote does not prove delivery. Start with a small amount.';
export const SWAP_PRIVACY = 'To open the swap, Zigs sends the amount, the ZEC address of the '
  + 'wallet and your refund address to NEAR Intents through the Zigs server. NEAR Intents checks '
  + 'both addresses and links them to the deposit. Your Solana payment, its amount and its time '
  + 'are public on Solana.';
export const SWAP_AGREE = 'I understand that this swap moves real funds and that the payout to a '
  + 'shielded address is untested.';
export const SWAP_EXPIRED = 'The deposit address is no longer active. Do not send SOL to it.';
// The texts of the live swap from ZEC to SOL.
export const ZEC_SWAP_PRIVACY = 'To open the swap, Zigs sends the amount, the Solana address of '
  + 'this wallet and its transparent refund address to NEAR Intents through the Zigs server. The '
  + 'payment leaves the shielded pool: the chain shows the deposit address and the amount to '
  + 'everyone, and NEAR Intents links the deposit to the two addresses of the wallet.';
export const ZEC_REFUND = 'A refund goes to the transparent address of this wallet. The devices '
  + 'of the wallet can move it to the shielded address from Receive. No real swap has tested a '
  + 'refund to this address.';
export const ZEC_AGREE = 'I understand that this swap moves real funds, that its payment is '
  + 'public, and that a refund goes to a public transparent address of this wallet.';
const ZEC_EXPIRED = 'The deposit address is no longer active. Do not propose or send a payment '
  + 'to it.';
// The texts of the live swap from SOL that the plain Solana wallet of the group pays.
export const SOL_GROUP_PRIVACY = 'To open the swap, Zigs sends the amount, the ZEC address of the '
  + 'wallet and the Solana address of this wallet to NEAR Intents through the Zigs server. NEAR '
  + 'Intents links both addresses to the deposit. The send of this wallet, its amount and its time '
  + 'are public on Solana.';
export const SOL_GROUP_REFUND = 'A refund goes to the Solana address of this wallet, less the '
  + 'refund fee of NEAR Intents. No real swap has tested a refund to this address.';
export const SOL_GROUP_AGREE = 'I understand that this swap moves real funds, that the payout to a '
  + 'shielded address is untested, and that the send needs the approvals of this wallet before the '
  + 'deadline.';
const SOL_PROPOSE = 'The send needs the approvals of this wallet. Each device asks NEAR Intents '
  + 'for this swap before it approves, and approves only a swap that pays this wallet. No device '
  + 'approves or sends it in the last 30 minutes before the deadline. A send after the deadline '
  + 'is refunded, less a fee, or can be lost.';
// No device approves or sends the deposit of the group in this time before the deadline
// (SWAP_MARGIN_MS of web/sol/plain/sessions.js), so the page proposes none either.
export const GROUP_MARGIN_MS = 30 * 60_000;
const ZEC_PROPOSE = 'The payment needs the approvals of this wallet. Each device asks NEAR '
  + 'Intents for this swap before it approves, and approves only a swap that pays this wallet. '
  + 'Keep the note of the payment as it is: it marks the payment as this swap. No device sends '
  + 'it in the last 30 minutes before the deadline.';
const SWAP_KEEP = 'This swap continues independently of this page.';
// The words of the deposit screen of each origin.
const DEPOSIT_TEXT = Object.freeze({
  sol: { title: 'Live swap: SOL to ZEC', head: 'Untested payout', warn: UNTESTED,
    pay: 'Send exactly', unit: 'lamports', expired: SWAP_EXPIRED,
    txs: ['Solana transaction', 'Zcash transaction'] },
  zec: { title: 'Live swap: ZEC to SOL', head: 'Public payment', warn: ZEC_PROPOSE,
    pay: 'Pay exactly', unit: 'zatoshi', expired: ZEC_EXPIRED,
    txs: ['Zcash transaction', 'Solana transaction'] },
  group: { title: 'Live swap: SOL to ZEC', head: 'Send of this wallet', warn: SOL_PROPOSE,
    pay: 'Pay exactly', unit: 'lamports', expired: ZEC_EXPIRED,
    txs: ['Solana transaction', 'Zcash transaction'] },
});
const NO_PAYOUT = 'Choose a mainnet wallet to receive the ZEC.';
const SWAP_STATES = Object.freeze({
  unknown: 'NEAR Intents does not list this swap yet.',
  PENDING_DEPOSIT: 'Waiting for your deposit.',
  KNOWN_DEPOSIT_TX: 'Deposit seen. Waiting for its confirmation.',
  INCOMPLETE_DEPOSIT: 'The deposit is less than the amount. NEAR Intents sends it back to the '
    + 'refund address.',
  PROCESSING: 'Swapping.',
  SUCCESS: 'Provider reports payout sent. Waiting for your wallet to detect and confirm the shielded ZEC.',
  REFUNDED: 'NEAR Intents reports a SOL refund. Check the refund address on Solana.',
  FAILED: 'The swap failed. Contact NEAR Intents support with the quote ID.',
  other: 'NEAR Intents gives a state that Zigs does not know. Do not send SOL again. Contact '
    + 'NEAR Intents support with the quote ID.',
});
// The end states of a swap from ZEC: the payout is SOL, and a refund is ZEC.
const ZEC_STATES = Object.freeze({
  SUCCESS: 'Provider reports SOL payout sent. Check the transaction and your wallet’s public SOL balance.',
  REFUNDED: 'NEAR Intents reports a ZEC refund. Check the transparent balance in Receive before moving it to the shielded address.',
});
const swapState = (live) => (!live.status ? 'Asking NEAR Intents for the state of the swap…'
  : (live.from === 'zec' && ZEC_STATES[live.status.status]) || SWAP_STATES[live.status.status]);
const short = (address) => address.slice(0, 10) + '…' + address.slice(-8);
const utc = (iso) => iso.slice(0, 10) + ' ' + iso.slice(11, 19) + ' UTC';
const addressText = (value) => el('span', { class: 'swap-deposit-address' }, value);
const token = (asset) => el('img', { class: 'swap-token ' + asset.tone,
  src: asset.icon, alt: '', width: 32, height: 32, 'aria-hidden': 'true' });
const text = (cls, value, tag = 'p') => el(tag, { class: cls }, value);
const copyBtn = (value, label, cls) => {
  const control = nativeCopyBtn(value, label, cls, null, interfaceIcon);
  control.setAttribute('data-interface-control', ''); return control;
};
const button = (label, cls, onclick, attrs = {}) => el('button', {
  type: 'button', class: cls, 'data-interface-control': '', onclick, ...attrs,
}, label);
const detail = (name, value) => el('div', { class: 'swap-detail-row' }, el('dt', {}, name), el('dd', {}, value));
const chevron = () => el('span', { class: 'swap-chevron', 'aria-hidden': 'true' }, interfaceIcon('chevronDown'));
export const ZEC_PRIVACY = 'A swap from ZEC leaves the shielded pool, because NEAR Intents takes '
  + 'ZEC only at a transparent deposit address, which is public. NEAR Intents accepts a shielded '
  + 'address as the recipient of a swap to ZEC, but this Zigs route has not had a funded payout test.';
export const QUOTE_PRIVACY = 'Zigs sends the pair, the amount and the slippage to NEAR Intents '
  + 'through the Zigs server, with sample addresses and no address of yours. NEAR Intents sees '
  + 'the Zigs server, not your IP address.';
export const NO_RUN = 'Preview only. No deposit address is requested, no funds move and nothing is signed.';
const privacy = (zec) => (zec ? ZEC_PRIVACY
  : 'Network visibility varies by route. Input, output and intermediate transfers may be '
    + 'publicly visible.') + ' ' + QUOTE_PRIVACY;
const ASKING = 'Asking NEAR Intents for a quote…';
const STATUS = { QUOTING: ASKING, INPUT_VALID: ASKING };
const IDLE = 'Choose a pair and enter an amount to get a live quote.';
const LIVE_QUOTE = 'Mainnet price estimate · execution is quoted separately';
// A quote of the demo provider (the development harness) is no price of the market.
const quoteLabel = (q) => (q.source === 'demo' ? 'Demo quote, not a price' : LIVE_QUOTE);
function statusText(s) {
  if (s.quote) return quoteLabel(s.quote);
  return s.error && s.amount ? '' : STATUS[s.phase] ?? IDLE;
}
const money = (q, name, usd) => detail(name + ' (NEAR Intents estimate)', swapUsd(q?.[usd]));
// The rows of a quote: the same in the page, the details dialog and the review.
const quoteRows = (q, from, to) => [
  detail('Rate', q ? '1 ' + from.symbol + ' ≈ ' + swapRate(q, from, to) + ' ' + to.symbol : '—'),
  detail('Minimum received', q ? swapDecimal(q.minAmountOut, to) + ' ' + to.symbol : '—'),
  money(q, 'Value you pay', 'amountInUsd'), money(q, 'Value you receive', 'amountOutUsd'),
  detail('Estimated time', swapTime(q?.timeEstimate))];
// The quote block of the details dialog. update() draws it again, so it never shows an old quote.
const quoteBlock = (s) => [text('swap-caption', statusText(s)),
  el('dl', { class: 'swap-quote-details' },
    quoteRows(s.quote, swapAsset(s.from), swapAsset(s.to)))];

// The deposit of the group: the open wallet (`source`) is the one that the swap refunds to and
// pays, no send was proposed from this screen, and 30 minutes are left at `now`.
const sameGroup = (source, w) => source.solGroup?.refundTo === w.refundTo
  && source.payout?.address === w.recipient;
function groupPay(source, live, now) {
  const p = live.proposal ?? {};
  const left = Date.parse(live.swap.deadline) - now;
  return !!source.live && (!live.restored || live.verified)
    && !!source.solGroup?.pay && sameGroup(source, live.swap) && !p.id && !p.busy && !p.attempted
    && (!source.solGroup.mode || !live.funding || source.solGroup.mode === live.funding)
    && !live.storageError
    && !swapPrivacyProblem(live)
    && left >= GROUP_MARGIN_MS;
}
// The words of the send `id` in the list of sends of the plain wallet.
function sendWords(group, id) {
  const row = group?.proposal?.(id);
  if (!row) return 'Open the wallet that pays this swap to see its send.';
  return row.error ? row.word + '. ' + row.error : row.word;
}
// The state of the send of the group that pays the deposit of `live`.
function proposalState(group, live) {
  const p = live.proposal;
  if (!live.group || !p) return [];
  if (p.busy) return [text('swap-caption', 'Checking the send…')];
  if (p.error) return [text('swap-error', 'Not proposed: ' + p.error)];
  if (!p.id) return [text('swap-caption', 'Proposal was interrupted. Open Solana to check its activity before trying another payment.')];
  return [text('swap-deposit-status', 'Send of this wallet: ' + sendWords(group, p.id))];
}

/** The provider and clock arguments are for the isolated development harness and the tests. */
export function createSwapPreview(context = {}, provider = new NearIntentsSwapProvider(), clock) {
  let source = context, modal = null, observer = null, trigger = null, detailBlock = null;
  let pickerSide = null, searchText = '', rotation = 0;
  let liveReview = null, shown = null, depositCopy = null, depositState = null, depositClose = null;
  let records = [], historyWallet = null, historyError = '', historyLoading = false, payerChosen = false;
  // Who pays a live swap from SOL: 'group' (the plain Solana wallet) or 'outside'.
  let solPayer = 'outside';
  let recoveryError = '', savedRecovery = '', recoverySaved = false, recoveryScope = source.id;
  let recoveryBlocked = false;
  let historyActions = [];
  const model = new SwapPreviewModel(provider, update, clock);
  if (source.preferredFrom === 'sol') Object.assign(model.value, { from: SOL_ID, to: ZEC_ID });
  const journal = source.journal;
  model.journal = journal ? { save: async (record) => {
    const next = await journal.save(record);
    if (source.id === record.walletId) { records = next; drawHistory(); }
  } } : null;
  const pair = () => model.value.from + '>' + model.value.to;
  const availableLivePair = () => !!source.live && source.network !== 'testnet'
    && [SOL_ID + '>' + ZEC_ID, ZEC_ID + '>' + SOL_ID].includes(pair());
  const liveRoute = () => model.value.execution !== 'preview' && availableLivePair();
  const fromZec = () => model.value.from === ZEC_ID;
  // The payout of the live route: from SOL, the ZEC address of the wallet; from ZEC, its plain
  // Solana address.
  const routePayout = () => (fromZec() ? { address: source.zec?.recipient,
    reason: source.zec?.reason ?? 'Choose a mainnet wallet to swap its ZEC.' }
    : source.payout ?? {});
  const root = el('div', { class: 'page swap-page', id: 'panel-swap',
    'data-key': 'panel-swap', tabindex: '-1', role: 'region',
    'aria-labelledby': 'swap-page-title' });
  const historyBlock = el('details', { class: 'workflow-details', 'data-swap-history': '', hidden: true });
  const pay = el('input', { id: 'swap-amount', class: 'swap-amount', type: 'text',
    inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '0.00',
    'aria-label': 'Amount you pay', 'aria-describedby': 'swap-error',
    oninput: (ev) => { model.type(ev.target.value); } });
  const payPrivacy = el('span', { class: 'swap-asset-privacy' });
  const receivePrivacy = el('span', { class: 'swap-asset-privacy' });
  const receive = el('input', { class: 'swap-amount swap-output', readonly: true,
    'aria-label': 'Amount you receive', value: '—', tabindex: '0' });
  const fromButton = button('', 'swap-asset-button', (ev) => openPicker('from', ev.currentTarget),
    { 'aria-label': 'Choose asset to pay', 'aria-haspopup': 'dialog', 'data-key': 'swap-from' });
  const toButton = button('', 'swap-asset-button', (ev) => openPicker('to', ev.currentTarget),
    { 'aria-label': 'Choose asset to receive', 'aria-haspopup': 'dialog', 'data-key': 'swap-to' });
  const fromNetwork = el('div', { class: 'swap-network' }), toNetwork = text('swap-network', '');
  const error = text('swap-error', ''); error.id = 'swap-error'; error.setAttribute('role', 'status');
  const quoteLine = text('swap-quote-status', statusText({}));
  quoteLine.setAttribute('role', 'status');
  const quoteDetails = el('dl', { class: 'swap-quote-details' });
  const reverse = button([interfaceIcon('swap'), el('span', {}, 'Reverse')], 'swap-reverse', () => {
    rotation += 180; reverse.style.setProperty('--swap-rotation', rotation + 'deg');
    void model.reverse();
  }, { 'aria-label': 'Reverse swap direction', 'data-key': 'swap-reverse' });
  const review = button([interfaceIcon('swap'), text('swap-action-label', 'Preview swap', 'span')],
    'swap-primary swap-initiate', (ev) => {
      if (!model.review()) return;
      openModal('Review quote', ev.currentTarget); drawReview();
    }, { disabled: true, 'data-key': 'swap-review', 'aria-haspopup': 'dialog' });
  const privacyExplainer = createSwapPrivacyExplainer();
  const destination = el('select', { id: 'swap-destination', 'aria-label': 'Example destination (demo)',
    onchange: (ev) => { model.chooseDestination(ev.target.value); } },
  el('option', { value: 'example' }, 'Example destination · demo only'),
  el('option', { value: '' }, 'Choose a destination'));
  const demoTarget = el('div', { class: 'swap-destination' },
    el('label', { for: 'swap-destination' }, 'Receive to · Demo'), destination);
  const payoutBox = el('div', { class: 'swap-destination swap-payout', hidden: true });
  const fundingChoice = el('div', { class: 'swap-funding' });
  const fundingNote = text('swap-caption swap-funding-note', '');
  const max = button('Max', 'swap-max', () => {
    const amount = source.solGroup?.balanceAtomic;
    if (solPayer === 'group' && /^\d+$/.test(amount || '')) void model.update({ amount: swapDecimal(amount, swapAsset(SOL_ID)) });
  }, { disabled: true, 'aria-label': 'Use available private SOL balance' });
  const headTag = previewTag();
  const walletProvider = el('div', { class: 'swap-wallet-provider', hidden: true });
  const walletProviderNote = text('swap-caption', '');
  walletProvider.append(walletProviderNote, heliusSwapCredit());
  const executionHelp = text('swap-caption', '');
  executionHelp.id = 'swap-execution-help'; executionHelp.setAttribute('role', 'status');
  const executionChoices = [
    ['preview', 'Hackathon preview', 'Demo - Pending NEAR API key', 'activity'],
    ['public', 'Standard mainnet', 'NEAR Intents - Not Confidential', 'swap'],
    ['basic', 'Confidential mainnet', 'Provider access required', 'security'],
  ].map(([value, label, caption, art]) => el('label', {
    class: 'swap-execution-option', 'data-mode': value, 'data-interface-control': '', 'data-button-surface': '' },
    el('input', { type: 'radio', name: 'swap-execution', value, checked: value === 'preview',
      'aria-describedby': 'swap-execution-help', onchange: async () => {
        if (model.value.live) return;
        closeModal(); await model.chooseExecution(value);
      } }), el('span', { class: 'swap-execution-art', 'aria-hidden': 'true' }, sculptedIcon(art)),
    el('span', { class: 'swap-execution-copy' }, text('', label, 'strong'),
      text('swap-caption', caption, 'span')),
    el('span', { class: 'swap-execution-indicator', 'aria-hidden': 'true' }, interfaceIcon('check'))));
  const executionBox = el('fieldset', { class: 'swap-execution' }, el('legend', {}, 'Swap mode'),
    el('div', { class: 'swap-execution-options' }, executionChoices), executionHelp);
  const deposit = el('section', { class: 'swap-deposit', id: 'swap-deposit', tabindex: '-1',
    'aria-labelledby': 'swap-deposit-title', 'data-key': 'swap-deposit', hidden: true });
  const history = el('section', { class: 'swap-history', 'aria-label': 'Saved swaps', hidden: true });
  const settings = el('details', { class: 'swap-settings' });
  const settingValue = el('span', {}, '0.5%');
  const presets = [50, 100, 200].map((bps) => button(bps / 100 + '%', 'swap-preset', () => {
    void model.update({ slippageBps: bps });
  }, { 'aria-pressed': bps === 50 ? 'true' : 'false' }));
  settings.append(el('summary', { 'data-interface-control': '' }, interfaceIcon('sliders'), 'Slippage', settingValue),
    el('div', { class: 'swap-settings-panel' }, text('', 'Maximum slippage', 'strong'),
      text('swap-caption', 'Sets the minimum quoted amount you receive.'), el('div', { class: 'swap-presets' }, presets)));
  const sourceLine = text('swap-source-context', '');
  const networkLine = text('', '');
  const quantumFlow = createPostQuantumSwapPreview(() => {
    quantumIntroNodes().forEach(node => { node.hidden = false; });
    quantumContinue.focus();
  });
  const quantumContinue = button(['Continue', el('span', { 'aria-hidden': 'true' }, interfaceIcon('forward'))],
    'swap-primary pq-continue', () => {
      quantumIntroNodes().forEach(node => { node.hidden = true; });
      quantumFlow.start();
    }, { 'aria-label': 'Continue to post-quantum swap demo' });
  let activeTab = 'private';
  const modes = [
    { id: 'private', label: 'Swap', status: 'Live quotes' },
    ...(source.demo === true ? [{ id: 'quantum', label: 'Post-quantum swap', status: 'Demo' }] : []),
  ];
  const modeTabs = modes.map((mode) => button([
    el('span', { class: 'swap-tab-label' }, mode.label),
    el('span', { class: 'swap-tab-status', id: 'swap-tab-' + mode.id + '-status' }, mode.status),
  ], 'swap-mode-tab', () => selectTab(mode.id), {
    role: 'tab', id: 'swap-tab-' + mode.id, 'aria-controls': 'swap-panel-' + mode.id,
    'aria-selected': String(mode.id === activeTab), tabindex: mode.id === activeTab ? '0' : '-1',
    'aria-label': mode.label, 'aria-describedby': 'swap-tab-' + mode.id + '-status',
    onkeydown: (ev) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
      ev.preventDefault();
      const index = ev.key === 'Home' ? 0 : ev.key === 'End' ? modes.length - 1
        : (modes.findIndex((m) => m.id === activeTab) + (ev.key === 'ArrowRight' ? 1 : -1) + modes.length) % modes.length;
      selectTab(modes[index].id, true);
    },
  }));
  root.append(el('header', { class: 'swap-heading' },
    el('div', { class: 'swap-titleline' }, el('h1', { id: 'swap-page-title' }, 'Swap'), headTag),
    nearSwapCredit()),

  el('div', { class: 'swap-panel', id: 'swap-panel-private', role: source.demo === true ? 'tabpanel' : 'region',
    'aria-labelledby': source.demo === true ? 'swap-tab-private' : 'swap-page-title',
    tabindex: source.demo === true ? '0' : null },
  ...(source.demo === true ? [] : [executionBox]), deposit,
  el('div', { class: 'swap-grid' },
    el('section', { class: 'swap-composer', 'aria-label': 'Swap composer' },
      el('div', { class: 'swap-pane' },
        el('div', { class: 'swap-pane-label' }, el('label', { for: 'swap-amount' }, 'You pay'), payPrivacy),
        el('div', { class: 'swap-amount-row' }, pay, fromButton),
        el('div', { class: 'swap-network-row' }, fromNetwork,
          max)), fundingChoice, fundingNote,
      el('div', { class: 'swap-switch-row' }, reverse),
      el('div', { class: 'swap-pane swap-receive' },
        el('div', { class: 'swap-pane-label' }, el('span', {}, 'You receive · estimate'), receivePrivacy),
        el('div', { class: 'swap-amount-row' }, receive, toButton), toNetwork),
      el('div', { class: 'swap-quote' }, quoteLine, quoteDetails), error,
      demoTarget, payoutBox,
      el('div', { class: 'swap-composer-tools' },
          button(['Quote details', el('span', { 'aria-hidden': 'true' }, interfaceIcon('info'))], 'swap-details-open',
            (ev) => { openModal('Swap details', ev.currentTarget); drawDetails(); },
            { 'aria-haspopup': 'dialog', 'data-key': 'swap-details' }), settings),
      el('div', { class: 'swap-composer-footer' }, review)),
    el('aside', { class: 'swap-support', 'aria-label': 'Swap privacy explainer' },
      privacyExplainer.element))),
  ...(source.demo === true ? [el('details', { class: 'workflow-details swap-experiments', ontoggle: (ev) => {
    if (!ev.currentTarget.open && activeTab !== 'private') selectTab('private', false);
  } }, el('summary', {}, 'Labs and interface demos'),
    el('p', { class: 'swap-caption' }, 'Optional interface previews. No assets move.'),
    el('div', { class: 'swap-mode-tabs', role: 'tablist', 'aria-label': 'Swap pages' }, modeTabs))] : []),
  el('section', { class: 'swap-panel swap-quantum-panel', id: 'swap-panel-quantum', role: 'tabpanel',
    'aria-labelledby': 'swap-tab-quantum', tabindex: '0', hidden: true },
    el('div', { class: 'swap-quantum-intro' },
      text('swap-eyebrow', 'Planned Zcash privacy'),
      el('h2', {}, 'Separate swap addresses.', el('br'), 'Same shared wallet.'),
      text('swap-quantum-description', 'A separate viewing key for each ZEC swap, with your existing wallet approvals.'),
      el('div', { class: 'swap-quantum-status' }, interfaceIcon('security'),
        el('div', {}, text('', 'Planned feature · try the demo', 'strong'),
          text('', 'No keys are generated and no assets move.'))),
      quantumContinue),
    el('div', { class: 'swap-quantum-steps', 'aria-label': 'Proposed swap experience' },
      [
        ['01', 'Separate addresses', 'Zigs would create a dedicated Zcash receiving or refund address automatically.'],
        ['02', 'Wallet approvals', 'The proposed flow would keep your shared wallet’s approval requirement.'],
        ['03', 'Recovery design', 'Swap receipts and refunds must remain recoverable after losing a device.'],
      ].map(([number, title, description]) => el('div', { class: 'swap-quantum-step' },
        el('span', { class: 'swap-step-number', 'aria-hidden': 'true' }, number),
        el('div', {}, text('', title, 'h3'), text('', description))))),
    el('div', { class: 'swap-quantum-boundary' },
      text('', 'What this would protect', 'strong'),
      text('', 'The full swap is not quantum-secure. Provider and public-chain visibility remain. '
        + ZEC_PRIVACY)),
    quantumFlow.element), history);
  root.append(historyBlock);
  restoreRecovery();
  drawLegacyHistory();
  update();
  void loadHistory();

  function drawLegacyHistory() {
    historyActions = [];
    if (!source.recovery?.history) { historyBlock.hidden = true; return; }
    try {
      const records = source.recovery.history();
      historyBlock.hidden = !records.length;
      historyBlock.replaceChildren(el('summary', {}, 'Saved swap records · ' + records.length),
        text('swap-caption', 'Historical provider reports, not proof of receipt. Records stay encrypted in this browser after Done, including failed swaps.'),
        ...records.map((record) => {
          const live = { swap: record.swap, from: record.from, group: record.group,
            wallet: record.wallet, savedProgress: record.progress,
            proposal: record.proposalId ? { id: record.proposalId } : record.proposalPending ? { busy: true } : undefined };
          const track = button('Check current status', 'swap-secondary', () => {
            if (model.value.live) return;
            model.restoreSwap(record);
          }, { disabled: !!model.value.live });
          historyActions.push(track);
          return el('details', { class: 'workflow-details' },
            el('summary', {}, record.from.toUpperCase() + ' → ' + (record.from === 'sol' ? 'ZEC' : 'SOL')
              + ' · ' + record.swap.deadline.slice(0, 10) + ' · ' + (record.progress?.status || 'Outcome unknown')),
            el('dl', { class: 'swap-review-details' },
              detail('Quote ID', record.swap.correlationId || 'Not supplied'),
              detail('Source transactions', record.progress?.originTxs.join(', ') || 'Not supplied'),
              detail('Destination transactions', record.progress?.destinationTxs.join(', ') || 'Not supplied')),
            copyBtn(() => swapRecoveryText(live), 'Copy recovery record', 'swap-secondary'), track);
        }));
    } catch (error) {
      historyBlock.hidden = false;
      historyBlock.replaceChildren(el('summary', {}, 'Swap history needs attention'),
        text('swap-error', 'The saved history could not be read. Its encrypted copy was kept. Keep the current record open and check browser storage.'));
    }
  }

  function restoreRecovery() {
    if (!source.recovery) return;
    try {
      const record = source.recovery.load();
      if (record) { savedRecovery = JSON.stringify(record); recoverySaved = true; model.restoreSwap(record); }
    } catch { recoveryBlocked = true; recoveryError = 'The saved swap cannot be read. Its encrypted copy has been kept. Check browser storage before starting another swap.'; }
  }
  function persistRecovery(live) {
    if (!live?.swap || !source.recovery || recoveryBlocked
      || (journal && !live.restored)) return;
    try {
      const record = swapRecoveryRecord(live), stamp = JSON.stringify(record);
      if (stamp !== savedRecovery) source.recovery.save(record);
      savedRecovery = stamp; recoverySaved = true; recoveryError = '';
    } catch { recoverySaved = false; recoveryError = 'Swap recovery could not be saved. Keep this page open and keep the quote details.'; }
  }
  function selectTab(id, focus = true) {
    if (id !== activeTab) { closeModal(); resetQuantumFlow(); }
    activeTab = id;
    modeTabs.forEach((tab, i) => {
      const selected = modes[i].id === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      root.querySelector('#swap-panel-' + modes[i].id).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }

  function quantumIntroNodes() {
    return [...root.querySelector('#swap-panel-quantum').children].filter(node => node !== quantumFlow.element);
  }
  function resetQuantumFlow() {
    quantumFlow.reset();
    quantumIntroNodes().forEach(node => { node.hidden = false; });
  }

  function update() {
    const s = model.value, from = swapAsset(s.from), to = swapAsset(s.to);
    if (!payerChosen) solPayer = source.solGroup?.refundTo ? 'group' : 'outside';
    root.dataset.swapPhase = s.phase;
    root.dataset.execution = s.execution;
    drawPair(from, to);
    if (pay.value !== s.amount) pay.value = s.amount;
    pay.setAttribute('aria-invalid', String(!!s.error));
    destination.value = s.destination;
    receive.value = s.quote ? swapDecimal(s.quote.amountOut, to) : '—';
    receive.setAttribute('aria-label', 'Amount you receive: ' + receive.value + ' ' + to.symbol);
    error.textContent = recoveryBlocked ? recoveryError : s.error;
    error.hidden = !error.textContent;
    const ready = !!s.quote && ['QUOTE_READY', 'REVIEW_CANCELLED'].includes(s.phase);
    if (s.phase === 'REVIEW_CANCELLED') model.resume();
    review.disabled = !ready || (s.execution !== 'preview' && !liveRoute());
    drawExecution(s);
    quoteLine.textContent = statusText(s);
    quoteDetails.replaceChildren(...quoteRows(s.quote, from, to));
    detailBlock?.replaceChildren(...quoteBlock(s));
    settingValue.textContent = s.slippageBps / 100 + '%';
    presets.forEach((b, i) => b.setAttribute('aria-pressed', String(SWAP_SLIPPAGES[i] === s.slippageBps)));
    privacyExplainer.update({ from: from.key, to: to.key, execution: s.execution,
      privateSource: s.from === SOL_ID && source.solGroup?.mode === 'private'
        && solPayer === 'group' });
    const liveTag = String(liveRoute());
    if (headTag.dataset.live !== liveTag) {
      headTag.replaceChildren(interfaceIcon(liveRoute() ? 'swap' : 'preview'),
        text('swap-tag-text', liveRoute() ? SWAP_TAG : LIVE_TAG, 'span'));
      headTag.dataset.live = liveTag;
    }
    const modeStatus = modeTabs[0]?.querySelector('.swap-tab-status');
    if (modeStatus) modeStatus.textContent = liveRoute() ? 'Live route' : 'Quote preview';
    drawFunding(s);
    drawPayout();
    drawDeposit(s);
    historyActions.forEach((b) => { b.disabled = !!s.live; });
    liveReview?.update(s);
    drawContext();
    drawRetry(s);
    syncModal(s);
    drawHistory();
  }
  function drawExecution(s) {
    if (review.dataset.execution !== s.execution) {
      const labels = { preview: 'Preview swap', public: 'Review standard swap', basic: 'Review confidential swap' };
      review.replaceChildren(interfaceIcon(s.execution === 'basic' ? 'confidentialSwap' : 'swap'),
        text('swap-action-label', labels[s.execution], 'span'));
      review.dataset.execution = s.execution;
    }
    executionChoices.forEach((label) => {
      const input = label.querySelector('input');
      input.checked = input.value === s.execution;
      input.disabled = !!s.live || (input.value !== 'preview' && !availableLivePair());
    });
    executionHelp.hidden = s.execution === 'preview';
    executionHelp.textContent = executionHelp.hidden
      ? ''
      : s.execution === 'public'
        ? 'Real funds. The standard route is public and NEAR Intents can link the swap addresses. No confidential routing is requested.'
        : 'Real funds. Basic confidential routing is required. If provider access is unavailable, the swap stops; it never switches to Standard.';
    if (!executionHelp.hidden && !availableLivePair()) executionHelp.textContent += source.simulated
      ? ' Example wallet · live modes unavailable here.'
      : ' Real execution requires a supported mainnet wallet and a live-enabled server.';
  }
  function drawFunding(s) {
    fundingChoice.hidden = fromZec() || !liveRoute();
    const key = [source.solGroup?.refundTo, source.solGroup?.mode, source.solGroup?.reason, solPayer].join('|');
    if (fundingChoice.dataset.choice !== key) {
      fundingChoice.dataset.choice = key;
      fundingChoice.replaceChildren(...payerChoice(true));
    }
    const balance = source.solGroup?.balanceAtomic;
    const hasBalance = solPayer === 'group' && /^\d+$/.test(balance || '');
    const privateSource = source.solGroup?.mode === 'private';
    max.setAttribute('aria-label', privateSource ? 'Use available private SOL balance' : 'Use public SOL balance');
    max.hidden = !hasBalance || s.from !== SOL_ID;
    max.disabled = !hasBalance || !!s.live;
    const why = source.network === 'testnet' ? 'Use a mainnet wallet for real swaps. This screen only previews mainnet prices.'
      : liveRoute() && !fromZec() && solPayer === 'group' ? source.solGroup?.reason
        || (s.quote && source.solGroup?.ready?.(s.quote.amountIn)) || '' : '';
    fundingNote.textContent = why || '';
    fundingNote.hidden = !why;
  }
  async function loadHistory() {
    if (!journal || !source.id || historyWallet === source.id) return;
    const gid = source.id;
    historyWallet = gid; historyLoading = true; records = []; historyError = ''; drawHistory();
    try {
      const got = await journal.load(gid);
      if (source.id !== gid) return;
      records = got;
      const active = got.find((r) => !r.hidden);
      if (active && !model.value.live) model.restoreSwap(active);
    } catch {
      if (source.id === gid) historyError = 'Saved swaps could not be read. The stored copy was kept. Unlock the wallet and reopen Swap to retry.';
    } finally {
      if (source.id === gid) { historyLoading = false; drawHistory(); }
    }
  }
  function drawHistory() {
    if (!history) return;
    history.hidden = !journal || (!records.length && !historyError && !historyLoading);
    history.replaceChildren(el('h2', {}, 'Saved swaps'),
      ...(historyLoading ? [text('swap-caption', 'Loading encrypted receipts…')] : []),
      ...(historyError ? [el('p', { class: 'swap-error', role: 'alert' }, historyError), button('Retry reading saved swaps', 'swap-secondary',
        () => { historyWallet = null; void loadHistory(); })] : []),
      ...records.map((r) => el('div', { class: 'swap-history-row' },
        el('div', {}, text('', (r.from === 'sol' ? 'SOL → ZEC' : 'ZEC → SOL'), 'strong'),
          text('swap-caption', new Date(r.createdAt).toLocaleString() + ' · '
            + historyState(r))),
        button(model.value.live?.swap?.depositAddress === r.swap.depositAddress ? 'Tracking open' : 'Resume tracking',
          'swap-secondary', () => {
            model.closeSwap(); model.restoreSwap(r); deposit.focus();
          }, { disabled: !!model.value.live, 'aria-label': 'Resume ' + (r.from === 'sol' ? 'SOL to ZEC' : 'ZEC to SOL')
            + ' swap from ' + new Date(r.createdAt).toLocaleString() }))),
      text('swap-caption', 'Receipts are encrypted in this browser. Other devices keep their own swap history. Hiding tracking does not cancel a swap.'));
  }
  function drawPair(from, to) {
    fromButton.replaceChildren(token(from), el('span', {}, from.symbol), chevron());
    toButton.replaceChildren(token(to), el('span', {}, to.symbol), chevron());
    const privateSol = from.id === SOL_ID && source.solGroup?.mode === 'private' && solPayer === 'group';
    const confidentialFrom = from.key === 'zec' || privateSol;
    const confidentialTo = to.key === 'zec';
    payPrivacy.replaceChildren(interfaceIcon(confidentialFrom ? 'lock' : 'unshield'),
      el('span', {}, (confidentialFrom ? 'Confidential ' : 'Public ') + from.symbol));
    receivePrivacy.replaceChildren(interfaceIcon(confidentialTo ? 'lock' : 'unshield'),
      el('span', {}, (confidentialTo ? 'Confidential ' : 'Public ') + to.symbol));
    const privateWallet = from.id === SOL_ID && source.solGroup?.mode === 'private';
    walletProvider.hidden = !privateWallet;
    walletProviderNote.hidden = privateSol;
    walletProviderNote.textContent = source.solGroup?.refundTo
      ? 'Private SOL wallet option' : 'Private SOL wallet · setup required';
    fromNetwork.replaceChildren(...(privateSol ? [] : [
      el('span', { class: 'swap-network-label' }, from.key === 'zec'
        ? 'Shielded Zcash balance' : 'Public ' + from.network + ' balance')]), walletProvider);
    toNetwork.textContent = to.key === 'zec' ? 'Shielded Zcash receiving address' : 'Public ' + to.network + ' receiving address';
  }
  function historyState(record) {
    const receipt = record.from === 'sol' && source.receipt?.(record.swap, record.status?.destinationTxs);
    if (receipt?.confirmed && receipt.meetsMinimum) return 'Shielded ZEC confirmed in wallet';
    return record.status?.status === 'SUCCESS' ? 'Provider payout sent · check wallet receipt'
      : record.status?.status || 'Waiting for deposit';
  }
  function drawContext() {
    sourceLine.textContent = 'Source wallet: ' + (source.name || 'no wallet selected') + '. '
      + (source.threshold || 'Approval requirements will be shown with a selected wallet.');
    networkLine.textContent = (source.networks || 'Zcash Testnet · Solana Devnet')
      + '. Quotes use mainnet prices. Preview simulates the flow without a deposit or signature.';
  }
  function drawRetry(s) {
    root.querySelectorAll('.swap-retry').forEach((n) => n.remove());
    const retry = s.error && s.amount && !swapInputError(s, provider.fixture)
      && ['QUOTE_ERROR', 'QUOTE_STALE'].includes(s.phase);
    if (retry) error.append(' ', button('Refresh quote', 'swap-retry', () => { void model.update(); }));
  }
  // A dialog of the review or the simulation goes when the quote goes.
  function syncModal(s) {
    const keeps = ['REVIEW_OPEN', 'DEMO_PROGRESS', 'DEMO_COMPLETE', 'REVIEW_CANCELLED'];
    if (modal && !pickerSide && modal.dataset.swapDetails !== 'true' && !keeps.includes(s.phase)) {
      closeModal(false);
    }
    if (modal && ['DEMO_PROGRESS', 'DEMO_COMPLETE'].includes(s.phase)) drawProgress();
  }

  function closeModal(cancel = true) {
    observer?.disconnect(); observer = null;
    const old = modal; modal = null; pickerSide = null; detailBlock = null; liveReview = null;
    old?.close(); old?.remove();
    if (cancel) { model.cancelReview(); model.resume(); model.exitSimulation(); }
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  function openModal(title, opener) {
    privacyExplainer.pause();
    if (modal) closeModal(false);
    trigger = opener; modal = el('dialog', { class: 'swap-modal', 'aria-labelledby': 'swap-modal-title' });
    modal.addEventListener('cancel', (ev) => { ev.preventDefault(); closeModal(); });
    // The native dialog owns Escape; do not let the wallet's unrelated layer handler consume it.
    modal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeModal(); }
      if (ev.key === 'Tab') {
        const stops = [...modal.querySelectorAll('button,input,select,summary,[tabindex="0"]')]
          .filter((n) => !n.disabled && n.getClientRects().length && n.checkVisibility());
        const at = stops.indexOf(document.activeElement), last = stops.length - 1;
        // Some WebKit configurations skip buttons during native Tab traversal. Own each step.
        ev.preventDefault(); ev.stopPropagation();
        const next = at < 0 ? (ev.shiftKey ? last : 0)
          : (at + (ev.shiftKey ? -1 : 1) + stops.length) % stops.length;
        stops[next]?.focus();
      }
    });
    modal.addEventListener('click', (ev) => { if (ev.target === modal) {
      const r = modal.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) closeModal();
    } });
    modal.append(el('div', { class: 'swap-modal-heading' },
      el('div', {}, previewTag(liveRoute()),
        el('h2', { id: 'swap-modal-title', tabindex: '-1' }, title)),
      button(interfaceIcon('close'), 'swap-close', () => closeModal(), { 'aria-label': 'Close dialog' })),
    el('div', { class: 'swap-modal-content' }));
    document.body.append(modal); modal.showModal();
    modal.querySelector('h2').focus();
    observer = new window.MutationObserver(() => { if (!root.isConnected) closeModal(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function openPicker(side, opener) {
    openModal(side === 'from' ? 'Choose asset to pay' : 'Choose asset to receive', opener);
    pickerSide = side; searchText = '';
    const search = el('input', { class: 'swap-search', type: 'search', placeholder: 'Search asset or network',
      'aria-label': 'Search assets', oninput: (ev) => { searchText = ev.target.value; drawAssets(); } });
    modal.querySelector('.swap-modal-content').append(search,
      el('div', { class: 'swap-asset-list' }),
      text('swap-caption', source.demo === true ? 'ZEC, SOL and USDC' : 'ZEC on Zcash · SOL on Solana'));
    drawAssets(); search.focus();
  }
  function drawAssets() {
    const matches = SWAP_ASSETS.filter(a => source.demo === true || a.key !== 'usdc').filter((a) => (a.symbol + ' ' + a.name + ' ' + a.network).toLowerCase().includes(searchText.trim().toLowerCase()));
    modal.querySelector('.swap-asset-list').replaceChildren(...(matches.length ? matches.map((a) => button([
      token(a), el('span', {}, text('', a.symbol + ' · ' + a.network, 'strong'), text('swap-caption', a.name, 'span')),
      el('span', { class: 'swap-choice-mark', 'aria-hidden': 'true' }, interfaceIcon(a.id === model.value[pickerSide] ? 'check' : 'chevronRight')),
    ], 'swap-asset-choice', () => {
      const side = pickerSide; closeModal(false); void model.update({ [side]: a.id });
    }, { 'aria-label': a.symbol + ' on ' + a.network }))
      : [text('swap-picker-empty', 'No assets match your search.')]));
  }
  function reviewRows() {
    const s = model.value, q = s.quote, from = swapAsset(s.from), to = swapAsset(s.to);
    return el('dl', { class: 'swap-review-details' },
      detail('You pay', s.amount + ' ' + from.symbol + ' · ' + from.network),
      detail('Estimated receive', swapDecimal(q.amountOut, to) + ' ' + to.symbol + ' · ' + to.network),
      ...quoteRows(q, from, to),
      detail('Maximum slippage', s.slippageBps / 100 + '%'),
      detail('Mode', 'Hackathon preview · no execution'),
      detail('Quote', quoteLabel(q)
        + (q.quotedAt ? ' · ' + q.quotedAt.slice(11, 19) + ' UTC' : '')),
      detail('Recipient', (s.destination ? 'Example destination' : 'None chosen') + ' · Demo'),
      detail('Refund destination', 'Example refund · Demo'),
      detail('Source wallet', source.name || 'No wallet selected'),
      detail('Approval requirement', source.threshold || 'Shown after wallet selection'),
      detail('Route', from.network + ' → NEAR Intents → ' + to.network));
  }
  function drawDetails() {
    modal.dataset.swapDetails = 'true';
    const s = model.value, from = swapAsset(s.from), to = swapAsset(s.to);
    const select = destination.cloneNode(true);
    select.id = 'swap-modal-destination'; select.value = s.destination;
    select.addEventListener('change', (ev) => { model.chooseDestination(ev.target.value); });
    detailBlock = el('div', {}, quoteBlock(s));
    const live = liveRoute();
    const receive = live
      ? el('dl', { class: 'swap-review-details' },
        detail('Receive to', payoutText(routePayout())))
      : el('div', { class: 'swap-destination' },
        el('label', { for: select.id }, 'Receive to · Demo'), select);
    const zec = from.symbol === 'ZEC' || to.symbol === 'ZEC';
    modal.querySelector('.swap-modal-content').replaceChildren(
      text('swap-details-route', from.network + ' → NEAR Intents → ' + to.network),
      detailBlock,
      receive,
      text('swap-caption', sourceLine.textContent),
      el('div', { class: 'swap-review-warning' }, text('', 'Privacy & network context', 'strong'),
        text('', !live ? privacy(zec) : fromZec() ? ZEC_SWAP_PRIVACY : SWAP_PRIVACY),
        text('', networkLine.textContent),
        text('', 'A swap through NEAR Intents would run through an external provider and a trusted swapping agent. Wallet approval protection would not extend to the whole route.')),
      text('swap-caption', 'Only ZEC, SOL and USDC are shown.'),
      button('Back to swap', 'swap-secondary', () => closeModal()));
  }
  function drawReview() {
    if (liveRoute()) { drawLiveReview(); return; }
    const s = model.value, from = swapAsset(s.from), to = swapAsset(s.to);
    modal.querySelector('.swap-modal-content').replaceChildren(
      el('div', { class: 'swap-review-amount' }, text('swap-caption', 'Estimated receive amount'),
        text('', swapDecimal(s.quote.amountOut, to), 'strong'), text('swap-caption', to.symbol + ' · ' + to.network)),
      reviewRows(),
      el('div', { class: 'swap-review-warning' }, text('', 'Review the route boundary', 'strong'),
        text('', privacy(from.symbol === 'ZEC' || to.symbol === 'ZEC')), text('', NO_RUN)),
      text('swap-simulation-note', 'Demo: the steps below are simulated. No funds move and nothing is signed.'),
      button(['Simulate swap flow', el('span', { 'aria-hidden': 'true' }, interfaceIcon('forward'))], 'swap-primary', () => {
        modal.querySelector('h2').textContent = 'Swap flow simulation'; model.simulate();
        modal.querySelector('h2').focus();
      }), button('Back to swap', 'swap-secondary', () => closeModal()));
  }
  function drawProgress() {
    const s = model.value, done = s.phase === 'DEMO_COMPLETE';
    const from = swapAsset(s.from).symbol, to = swapAsset(s.to).symbol;
    const descriptions = [s.quote.source === 'demo' ? 'Synthetic quote · not a market price'
      : 'Real mainnet price quote · no funds committed',
    'Example device approvals · no signing request',
    'Example public ' + from + ' deposit · no transaction created',
    'Example standard NEAR Intents exchange · no execution',
    to === 'ZEC' ? 'Example shielded ZEC receipt · no wallet scan or payment'
      : 'Example public SOL receipt · no payment',
    'Example reload recovery · no receipt is written or restored'];
    modal.querySelector('.swap-modal-content').replaceChildren(
      text('swap-simulation-note', 'Demo only · simulated steps. No funds move and nothing is signed.'),
      el('ol', { class: 'swap-progress-list' }, SWAP_DEMO_STEPS.map((step, i) => el('li', {
        class: i < s.step ? 'is-demonstrated' : i === s.step ? 'is-current' : '',
        'aria-current': i === s.step ? 'step' : null,
      }, el('span', { class: 'swap-step-number', 'aria-hidden': 'true' }, i < s.step ? '✓' : i + 1),
      el('div', {}, text('', step, 'strong'), text('swap-caption', i < s.step ? 'Demonstrated · no real event'
        : i === s.step ? descriptions[i] : 'Later simulated step'))))),
      el('p', { class: 'swap-demo-result', role: 'status' }, done ? 'Demo complete. The steps were simulated. No funds moved.'
        : 'Advance each example step yourself. Nothing is broadcast or signed.'),
      button([done ? 'Back to swap' : 'Next demo step', interfaceIcon(done ? 'back' : 'forward')], 'swap-primary', () => {
        if (done) { closeModal(false); void model.update(); return; }
        model.advance(); modal.querySelector('.swap-primary').focus({ preventScroll: true });
      }));
  }
  // The address that a live swap pays to (from app-shell.js), or the reason why there is none.
  function payoutText(payout) {
    if (!payout.address) return payout.reason || NO_PAYOUT;
    return (source.name || 'Wallet') + ' · ' + payout.address;
  }
  function drawPayout() {
    const payout = routePayout();
    payoutBox.hidden = !liveRoute(); demoTarget.hidden = source.demo !== true || liveRoute();
    payoutBox.replaceChildren(text('', 'Receive to', 'span'),
      text(payout.address ? 'swap-payout-address' : 'swap-caption', payoutText(payout), 'strong'));
  }
  // The amount and the quote rows of a live review, with the rows `rows` of the route.
  function liveSummary(s, from, to, rows) {
    return [el('div', { class: 'swap-review-amount' },
      text('swap-caption', 'Estimated receive amount'),
      text('', swapDecimal(s.quote.amountOut, to), 'strong'),
      text('swap-caption', to.symbol + ' · ' + to.network)),
    el('dl', { class: 'swap-review-details' },
      detail('You pay', s.amount + ' ' + from.symbol + ' · ' + from.network),
      ...quoteRows(s.quote, from, to),
      detail('Maximum slippage', s.slippageBps / 100 + '%'),
      detail('Routing', nearRouteLabel(s.execution)),
      detail('Quote', quoteLabel(s.quote)
        + (s.quote.quotedAt ? ' · ' + s.quote.quotedAt.slice(11, 19) + ' UTC' : '')),
      ...rows,
      detail('Route', from.network + ' → NEAR Intents → ' + to.network))];
  }
  // The agreement, the error line and the button of a live review. `ready()` says whether the
  // addresses allow a swap, and `where()` gives them to openSwap. `why()` gives the reason that the
  // payer cannot pay now, which the error line shows.
  function liveControls(agreeText, ready, where, why = () => '') {
    let agreed = false;
    const errorLine = text('swap-error', ''); errorLine.setAttribute('role', 'alert');
    const go = button('Get deposit address', 'swap-primary', async () => {
      go.disabled = true;
      if (await model.openSwap(where())) deposit.focus();
    }, { disabled: true, 'data-key': 'swap-open' });
    const agree = el('input', { id: 'swap-agree', type: 'checkbox', onchange: (ev) => {
      agreed = ev.target.checked; review.update(model.value);
    } });
    const review = { update(now) {
      const block = why() || '';
      go.disabled = !!now.live || !ready() || !!block || !agreed || recoveryBlocked;
      errorLine.textContent = now.live?.swap ? 'Finish tracking the current swap before starting another.'
        : recoveryError || now.swapError || block;
      errorLine.hidden = !errorLine.textContent;
    } };
    liveReview = review;
    const routingConsent = model.value.execution === 'public'
      ? ' I choose the standard public route. NEAR Intents can link the deposit, recipient and refund addresses.'
      : ' I require Basic confidential routing and understand that NEAR Intents sees the route.';
    return { review, parts: [el('label', { class: 'swap-agree' }, agree,
      el('span', {}, agreeText + routingConsent)),
      errorLine, go, button('Back to swap', 'swap-secondary', () => closeModal())] };
  }
  // The review of the live route from SOL: the real payout address, the refund address that the
  // person types, the untested payout and the button that asks NEAR Intents for a deposit address.
  function drawLiveReview() {
    if (fromZec()) { drawZecReview(); return; }
    if (solPayer === 'group') { drawGroupReview(); return; }
    const s = model.value, from = swapAsset(s.from), to = swapAsset(s.to);
    const payout = source.payout ?? {};
    let refundTo = '';
    const refundNote = text('swap-caption',
      'NEAR Intents uses this address for any SOL refund.');
    refundNote.id = 'swap-refund-note';
    const ctl = liveControls(SWAP_AGREE, () => !!payout.address && swapSolAddress(refundTo),
      () => ({ recipient: payout.address, refundTo, room: payout.room,
        wallet: source.name || 'Wallet', walletId: source.id, funding: 'outside' }));
    const refund = el('input', { id: 'swap-refund', class: 'swap-search', type: 'text',
      autocomplete: 'off', spellcheck: 'false', placeholder: 'Solana address',
      'aria-describedby': 'swap-refund-note', oninput: (ev) => {
        refundTo = ev.target.value.trim(); ctl.review.update(model.value);
      } });
    modal.querySelector('.swap-modal-content').replaceChildren(
      ...liveSummary(s, from, to, [detail('Receive to', payoutText(payout)),
        detail('Pay from', 'A Solana wallet outside Zigs')]),
      ...payerChoice(),
      el('label', { for: 'swap-refund', class: 'swap-field-label' },
        'Refund address: the Solana address that you pay from. Use a wallet that you control, '
          + 'not an exchange.'),
      refund, refundNote,
      el('div', { class: 'swap-review-warning' }, text('', 'Real funds', 'strong'),
        text('', UNTESTED), text('', SWAP_PRIVACY)),
      ...ctl.parts);
    ctl.review.update(s);
  }
  // The choice of the payer of a swap from SOL, on a page that knows the Solana wallet of the
  // group (app-swap-sol.js): a list of one node, or none. A wallet that cannot pay says why, and
  // its choice is off.
  function payerChoice(composer = false) {
    if (!source.solGroup) return [];
    const group = source.solGroup;
    const choose = (value) => {
      solPayer = value; payerChosen = true;
      if (composer) {
        if (modal) closeModal();
        update();
        fundingChoice.querySelector('input:checked')?.focus();
      }
      else { drawLiveReview(); modal.querySelector('input[name="swap-payer"]:checked')?.focus(); }
    };
    const radio = (value, label) => el('label', { class: 'swap-agree' },
      el('input', { type: 'radio', name: composer ? 'swap-funding-payer' : 'swap-payer', value, checked: solPayer === value,
        disabled: value === 'group' && !group.refundTo, 'data-key': 'swap-payer-' + value,
        onchange: () => choose(value) }), el('span', {}, label));
    return [el('fieldset', { class: 'swap-payer' },
      el('legend', { class: 'swap-field-label' }, 'Pay from'),
      radio('group', (group.mode === 'private' ? 'Private SOL balance' : 'Public SOL balance')
        + ' · ' + (source.threshold || 'wallet approvals')),
      group.refundTo ? null : text('swap-caption', group.reason),
      radio('outside', 'A Solana wallet outside Zigs'))];
  }
  // The review of the live route from SOL that the plain Solana wallet of the group pays: the ZEC
  // address of the wallet receives, its Solana address gets a refund, and nobody types an address.
  // The button waits until the wallet can pay the amount (balance, rent, nonce account, fee).
  function drawGroupReview() {
    const s = model.value, from = swapAsset(s.from), to = swapAsset(s.to);
    const payout = source.payout ?? {}, group = source.solGroup ?? {};
    const privateSource = group.mode === 'private';
    const why = () => (group.refundTo ? group.ready(s.quote.amountIn) : group.reason);
    const consent = privateSource ? 'I understand that private SOL leaves through a public deposit, that the shielded ZEC payout is untested, and that this device alone controls any public SOL refund.' : SOL_GROUP_AGREE;
    const ctl = liveControls(consent, () => !!payout.address && !!group.refundTo,
      () => ({ recipient: payout.address, refundTo: group.refundTo, room: payout.room,
        wallet: source.name || 'Wallet', walletId: source.id, funding: group.mode || 'plain', group: true }), why);
    modal.querySelector('.swap-modal-content').replaceChildren(
      ...liveSummary(s, from, to, [detail('Receive to', payoutText(payout)),
        detail('Pay from', (privateSource ? 'Private SOL balance' : 'Public SOL balance') + ' · ' + (source.threshold || 'its approvals')),
        detail('Refund address', group.refundTo
          ? (privateSource ? group.refundLabel : 'Public Solana address of this wallet') + ' · ' + group.refundTo : '—'),
        ...(privateSource ? [detail('Privacy boundary', privateRoute(s.execution))] : [])]),
      ...payerChoice(),
      el('div', { class: 'swap-review-warning' }, text('', privateSource ? 'Private funds, public deposit' : 'Real funds, public send',
        'strong'), text('', UNTESTED), text('', privateSource ? PRIVATE_REFUND : SOL_GROUP_REFUND),
        el('details', {}, el('summary', {}, 'Provider visibility and approval deadline'),
          text('', SOL_GROUP_PRIVACY), text('', SOL_PROPOSE))),
      ...ctl.parts);
    ctl.review.update(s);
  }
  // The review of the live route from ZEC: the wallet pays, the plain Solana address of the
  // wallet receives, and a refund goes to the transparent address of the group. Nobody types an
  // address.
  function drawZecReview() {
    const s = model.value, from = swapAsset(s.from), to = swapAsset(s.to);
    const zec = source.zec ?? {};
    const ctl = liveControls(ZEC_AGREE, () => !!zec.recipient && !!zec.refundTo,
      () => ({ recipient: zec.recipient, refundTo: zec.refundTo,
        wallet: source.name || 'Wallet', walletId: source.id, funding: 'plain' }));
    modal.querySelector('.swap-modal-content').replaceChildren(
      ...liveSummary(s, from, to, [detail('Receive to', payoutText(routePayout())),
        detail('Pay from', 'This wallet · ' + (source.threshold || 'its approvals')),
        detail('Refund address', zec.refundTo
          ? 'The transparent address of this wallet · ' + short(zec.refundTo) : '—')]),
      el('div', { class: 'swap-review-warning' }, text('', 'Real funds, public payment', 'strong'),
        text('', ZEC_SWAP_PRIVACY), text('', ZEC_REFUND)),
      ...ctl.parts);
    ctl.review.update(s);
  }
  // The deposit screen of the open live swap. It stays on the page, apart from any dialog, until
  // the person closes it: a wallet switch or an old quote does not remove an address in use.
  function drawDeposit(s) {
    const live = s.live?.swap ? s.live : null;
    const zecProposal = live?.from === 'zec' ? source.zec?.proposal?.(live.swap) : null;
    if (zecProposal) live.proposal = { id: zecProposal.id };
    persistRecovery(live);
    deposit.hidden = !live;
    if (!live) { shown = null; deposit.replaceChildren(); return; }
    if (live.restored && !live.verified) {
      shown = null;
      deposit.replaceChildren(el('h2', { id: 'swap-deposit-title' }, 'Checking your saved swap'),
        text('swap-caption', live.statusError || 'Verifying the saved route with NEAR Intents before showing payment details.'),
        text('swap-caption', 'Do not make another deposit while the outcome is unknown. The recovery record is historical, not a payment instruction.'),
        copyBtn(() => swapRecoveryText(live), 'Copy recovery record', 'swap-secondary'));
      return;
    }
    if (live.collapsed) {
      shown = null;
      deposit.replaceChildren(el('h2', { id: 'swap-deposit-title' }, 'Swap in progress'),
        text('swap-caption', swapState(live)),
        button('View swap details', 'swap-secondary', () => { live.collapsed = false; update(); }));
      return;
    }
    if (live.group && live.proposal?.attempted && !live.proposal.id) {
      const found = source.solGroup?.proposalForDeposit?.(live.swap.depositAddress);
      if (found) { live.proposal = { id: found.id, attempted: true }; void model.keepSwap(live); }
    }
    if (shown !== live) { shown = live; buildDeposit(live); }
    depositClose.textContent =
      journal && !live.restored ? 'Hide tracking'
        : SWAP_FINAL.includes(live.status?.status) ? 'Done' : 'Hide details';
    const waiting = !live.status || ['unknown', 'PENDING_DEPOSIT'].includes(live.status.status);
    const expired = model.swapExpired(), words = DEPOSIT_TEXT[depositKind(live)];
    depositCopy.hidden = expired || !waiting;
    depositCopy.disabled = !payOn(live);
    const tx = (name, list) => (list?.length ? [detail(name, list.map(addressText))] : []);
    if (live.from === 'zec') depositCopy.textContent = zecProposal ? 'Open deposit payment' : 'Review deposit payment';
    const receipt = live.from === 'sol' && source.id === live.walletId
      ? source.receipt?.(live.swap, live.status?.destinationTxs) : null;
    const receiptWord = receipt?.confirmed && receipt.meetsMinimum
      ? 'Shielded ZEC received and confirmed in this wallet.'
      : receipt ? 'Shielded ZEC detected in this wallet. Waiting for confirmation or the rest of the payout.' : '';
    depositState.replaceChildren(...(waiting ? proposalState(source.solGroup, live) : []),
      lifecycle(live, receipt),
      ...(live.proposal?.recovering ? [text('swap-caption', 'A previous payment proposal may exist. Review Approvals before proposing another.')] : []),
      ...(recoveryError || live.recoveryRemovalError ? [text('swap-error', recoveryError || live.recoveryRemovalError)] : []),
      ...(zecProposal ? [text('swap-caption', 'Zcash transaction expiry: '
        + (Number.isInteger(zecProposal.expiryHeight) ? 'block ' + zecProposal.expiryHeight : 'not known here')
        + '. This is separate from the swap deposit cutoff.'),
        button('Open deposit payment', 'swap-secondary', zecProposal.open)] : []),
      el('p', { class: 'swap-deposit-status', role: 'status' }, 'Status: ' + (receiptWord || swapState(live))),
      ...(swapPrivacyProblem(live) ? [el('p', { class: 'swap-error', role: 'alert' },
        swapPrivacyProblem(live))] : []),
      ...(live.storageError ? [el('p', { class: 'swap-error', role: 'alert' }, live.storageError), button('Retry saving receipt',
        'swap-secondary', async () => { await model.keepSwap(live); update(); })] : []),
      ...(expired ? [text('swap-error', words.expired)] : []),
      ...(live.statusError && !SWAP_FINAL.includes(live.status?.status)
        ? [text('swap-caption', live.statusError)] : []),
      el('dl', { class: 'swap-review-details' },
        ...(receipt ? [detail('Received in shielded wallet', swapDecimal(receipt.amount, swapAsset(ZEC_ID)) + ' ZEC')] : []),
        ...(live.status?.amountOut ? [detail('Provider reports paid', swapDecimal(live.status.amountOut,
          swapAsset(live.from === 'sol' ? ZEC_ID : SOL_ID)) + (live.from === 'sol' ? ' ZEC' : ' SOL'))] : []),
        ...(live.status?.refundedAmount ? [detail('Refund amount', swapDecimal(live.status.refundedAmount,
          swapAsset(live.from === 'sol' ? SOL_ID : ZEC_ID)) + (live.from === 'sol' ? ' SOL' : ' ZEC'))] : []),
        ...(live.status?.refundReason ? [detail('Refund reason', live.status.refundReason.replaceAll('_', ' ').toLowerCase())] : []),
        tx(words.txs[0], live.status?.originTxs), tx(words.txs[1], live.status?.destinationTxs)),
      ...(['FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT', 'other'].includes(live.status?.status)
        ? [el('a', { class: 'swap-secondary', href: 'https://docs.near-intents.org/resources/faqs', target: '_blank', rel: 'noopener noreferrer' },
          'NEAR Intents help (opens external site)')] : []));
    drawHistory();
  }
  function lifecycle(live, receipt) {
    const state = live.status?.status, inRoute = ['KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'].includes(state);
    const confirmed = receipt?.confirmed && receipt.meetsMinimum;
    const step = confirmed ? 4 : state === 'SUCCESS' ? 3 : inRoute ? 2 : live.proposal?.id ? 1 : 0;
    const labels = [live.group ? 'Propose withdrawal' : 'Send deposit',
      live.group ? 'Device approvals' : 'Deposit confirmation', 'Provider processing',
      ...(live.from === 'sol' ? ['Shielded ZEC detection', 'Wallet confirmation'] : ['Verify public SOL in wallet'])];
    return el('ol', { class: 'swap-lifecycle', 'aria-label': 'Swap progress' }, labels.map((label, i) =>
      el('li', { class: i < step || confirmed ? 'is-complete' : i === step ? 'is-current' : '',
        ...(i === step && !confirmed ? { 'aria-current': 'step' } : {}) },
        el('span', { 'aria-hidden': 'true' }, i < step || confirmed ? '✓' : String(i + 1)), label)));
  }
  // From SOL, the person copies the address and pays from a wallet outside Zigs. From ZEC, the
  // button opens Send with the payment of the deposit, from the open wallet only when the swap pays
  // that wallet: the person can open another wallet while the deposit shows.
  function zecPay(w) {
    const z = source.zec;
    return z?.pay && z.recipient === w.recipient && z.refundTo === w.refundTo ? z.pay : null;
  }
  const groupOk = (live) => groupPay(source, live, model.clock.now());
  // The button of a deposit that this wallet pays is on only while the open wallet can pay it.
  // The copy button of a payment from outside is always on.
  function payOn(live) {
    if (!source.live || live.restored && !live.verified) return false;
    if (swapPrivacyProblem(live)) return false;
    if (live.storageError || (model.journal && !live.saved)) return false;
    if (live.group) return groupOk(live);
    return live.from === 'zec' ? !!zecPay(live.swap)
      && (!live.proposal?.id || !!source.zec?.proposal?.(live.swap)) : true;
  }
  // A click can come after the margin and before the next redraw: it redraws the button as off.
  async function proposeGroup(live) {
    if (!groupOk(live)) { update(); return; }
    const payer = source.solGroup, walletId = source.id;
    live.proposal = { busy: true, attempted: true }; update();
    if (!await model.keepSwap(live)) {
      live.proposal = null; update(); return;
    }
    if (source.id !== walletId || source.solGroup?.refundTo !== payer.refundTo
      || !sameGroup(source, live.swap) || Date.parse(live.swap.deadline) - model.clock.now() < GROUP_MARGIN_MS) {
      live.proposal = { error: 'The wallet or approval window changed. No withdrawal was started.' };
      await model.keepSwap(live); update(); return;
    }
    try {
      live.proposal = { id: await payer.pay(live.swap), attempted: true };
    } catch (e) {
      live.proposal = { error: String(e?.message ?? e), attempted: true };
    }
    await model.keepSwap(live);
    if (model.value.live === live) update();
  }
  const depositKind = (live) => (live.group ? 'group' : live.from);
  function depositAction(live) {
    const w = live.swap;
    if (live.group) {
      return button(live.funding === 'private' ? 'Propose private SOL withdrawal' : 'Propose the payment', 'swap-primary', () => { void proposeGroup(live); },
        { disabled: !groupOk(live), 'data-key': 'swap-propose' });
    }
    if (live.from !== 'zec') return copyBtn(w.depositAddress, 'Copy address', 'swap-secondary');
    return button('Review deposit payment', 'swap-primary', () => {
      const existing = source.zec?.proposal?.(w);
      if (existing) { existing.open(); return; }
      if (payOn(live) && !model.swapExpired()) zecPay(w)?.(w);
    },
      { disabled: !zecPay(w), 'data-key': 'swap-propose' });
  }
  function buildDeposit(live) {
    const w = live.swap, words = DEPOSIT_TEXT[depositKind(live)];
    const [paid, got] = [live.from, live.from === 'zec' ? 'sol' : 'zec']
      .map((key) => SWAP_ASSETS.find((a) => a.key === key));
    const amount = (value, asset) => swapDecimal(value, asset) + ' ' + asset.symbol;
    depositCopy = depositAction(live);
    depositState = el('div', { class: 'swap-deposit-state' });
    depositClose = button('Hide details', 'swap-secondary', () => {
      if (journal && !live.restored) { void model.closeSwap(); return; }
      if (!SWAP_FINAL.includes(live.status?.status)) { live.collapsed = true; update(); return; }
      persistRecovery(live);
      if (source.recovery && !recoverySaved) { update(); return; }
      try { source.recovery?.remove(); }
      catch { live.recoveryRemovalError = 'The recovery record could not be archived. Keep tracking open and copy the record before changing browser storage. Try Done again after storage is available.'; update(); return; }
      savedRecovery = ''; recoverySaved = false; model.closeSwap(); drawLegacyHistory();
    }, { 'data-key': 'swap-close-deposit' });
    deposit.replaceChildren(
      el('div', { class: 'swap-deposit-heading' },
        el('h2', { id: 'swap-deposit-title' }, live.funding === 'private' ? 'Private SOL → shielded ZEC' : words.title), previewTag(true)),
      el('div', { class: 'swap-review-warning' }, text('', words.head, 'strong'),
        text('', live.funding === 'private' ? privateRoute(w.confidentiality) + ' ' + PRIVATE_REFUND : words.warn)),
      el('dl', { class: 'swap-review-details' },
        detail(words.pay, amount(w.amountIn, paid) + ' ('
          + BigInt(w.amountIn).toLocaleString('en-US') + ' ' + words.unit + ')'),
        detail('To this address', addressText(w.depositAddress)),
        detail('Pay before', utc(w.deadline) + '. A deposit after this time can be lost.'),
        ...((live.group || live.from === 'zec') ? [detail('Complete wallet sending before',
          utc(new Date(Date.parse(w.deadline) - GROUP_MARGIN_MS).toISOString())
            + ' · wallet payments stop 30 minutes before the provider deadline.')] : []),
        detail('Refund address', addressText(w.refundTo)),
        detail('Routing', w.confidentiality === 'public' && live.routeChoice !== 'public'
          ? 'Tracking only · older public route' : nearRouteLabel(w.confidentiality)
            + ' · reported by NEAR Intents'),
        detail('Payout', 'About ' + amount(w.amountOut, got) + ', at least '
          + amount(w.minAmountOut, got)),
        detail('Receive to', [live.wallet + ' · ', addressText(w.recipient)])),
      depositCopy, depositState,
      el('details', { class: 'swap-recovery-details' }, el('summary', {}, 'Recovery receipt and provider reference'),
        el('dl', { class: 'swap-review-details' }, detail('Quote ID', w.correlationId || '—'),
          detail('Quote signature', w.signature ? addressText(w.signature) : '—')),
        text('swap-caption', 'The quote signature authenticates payment terms. It does not sign '
          + 'the confidentiality setting; routing relies on NEAR Intents and the Zigs connection.'),
        ...(live.restored || !journal
          ? [copyBtn(() => swapRecoveryText(live), 'Copy recovery record', 'swap-secondary')]
          : [copyBtn(JSON.stringify(swapRecordOf(live) || {}), 'Copy recovery receipt', 'swap-secondary')])),
      text('swap-caption', model.journal ? 'Saved receipts are encrypted in this browser. Check the saving status above before leaving. Hiding tracking does not cancel the swap.' : SWAP_KEEP),
      depositClose);
  }
  // A change of any of these closes the dialogs and drops the quote. The addresses of a swap from
  // ZEC count only on that route.
  const where = (c) => [c.id, c.threshold, c.networks, c.payout?.address, c.solGroup?.mode, c.solGroup?.refundTo,
    ...(fromZec() ? [c.zec?.recipient, c.zec?.refundTo] : [])].join('\n');
  return { element: root, model, setContext(next) {
    const changedWallet = recoveryScope !== next.id;
    if (changedWallet) {
      model.clearLive(); savedRecovery = ''; recoverySaved = false; recoveryError = ''; recoveryBlocked = false;
    }
    if (where(source) !== where(next)) {
      closeModal(); resetQuantumFlow(); model.stale();
    }
    if (source.id !== next.id) {
      payerChosen = false;
      if (!model.value.live) model.value.execution = 'preview';
    }
    source = next;
    if (changedWallet) { recoveryScope = next.id; restoreRecovery(); drawLegacyHistory(); }
    update(); void loadHistory();
  } };
}
