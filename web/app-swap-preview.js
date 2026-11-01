// Live NEAR Intents quotes, the live swap from SOL to ZEC (paid from a wallet outside Zigs) and
// local demo interactions. No signing or payment APIs are imported.
import { copyBtn, el } from './app-dom.js';
import { icon } from './app-icons.js';
import { NearIntentsSwapProvider } from './near-intents-swap-provider.js';
import { createPostQuantumSwapPreview } from './app-postquantum-swap-preview.js';
import { SWAP_ASSETS, SWAP_DEMO_STEPS, SWAP_FINAL, SWAP_SLIPPAGES, SwapPreviewModel, swapAsset,
  swapDecimal, swapInputError, swapRate, swapSolAddress, swapTime, swapUsd }
  from './swap-preview-model.js';

export const LIVE_TAG = 'Quotes only';
// The tag of the live route (SOL to ZEC on a server with NEAR_LIVE): the funds are real.
export const SWAP_TAG = 'Live swap · real funds';
const previewTag = (live = false) => el('span', { class: 'swap-preview-tag' },
  el('span', { 'aria-hidden': 'true' }, '◌'),
  el('span', { class: 'swap-tag-text' }, live ? SWAP_TAG : LIVE_TAG));
const [ZEC_ID, SOL_ID] = [SWAP_ASSETS[0].id, SWAP_ASSETS[1].id];
const QUOTE_SUBTITLE = 'Live prices from NEAR Intents on mainnet. Zigs cannot run a swap, so no '
  + 'funds move.';
export const LIVE_SUBTITLE = 'Live prices from NEAR Intents on mainnet. Zigs runs a real swap '
  + 'from SOL to ZEC only, paid from a Solana wallet outside Zigs. Other pairs show quotes only.';
export const UNTESTED = 'The payout to a shielded address is untested: no real swap has paid one '
  + 'yet, and NEAR Intents could fail to pay it. Start with a small amount.';
export const SWAP_PRIVACY = 'To open the swap, Zigs sends the amount, the ZEC address of the '
  + 'wallet and your refund address to NEAR Intents through the Zigs server. NEAR Intents checks '
  + 'both addresses and links them to the deposit. Your Solana payment, its amount and its time '
  + 'are public on Solana.';
export const SWAP_AGREE = 'I understand that this swap moves real funds and that the payout to a '
  + 'shielded address is untested.';
export const SWAP_EXPIRED = 'The deposit address is no longer active. Do not send SOL to it.';
const SWAP_KEEP = 'The swap goes on without this page. Copy the deposit address and the quote ID: '
  + 'after a reload, this page cannot show this swap again.';
const NO_PAYOUT = 'Choose a mainnet wallet to receive the ZEC.';
const SWAP_STATES = Object.freeze({
  unknown: 'NEAR Intents does not list this swap yet.',
  PENDING_DEPOSIT: 'Waiting for your deposit.',
  KNOWN_DEPOSIT_TX: 'Deposit seen. Waiting for its confirmation.',
  INCOMPLETE_DEPOSIT: 'The deposit is less than the amount. NEAR Intents sends it back to the '
    + 'refund address.',
  PROCESSING: 'Swapping.',
  SUCCESS: 'Done. NEAR Intents sent the ZEC to the wallet. The wallet shows it after its next '
    + 'sync.',
  REFUNDED: 'Refunded. NEAR Intents sent the SOL back to the refund address.',
  FAILED: 'The swap failed. Contact NEAR Intents support with the quote ID.',
});
const swapState = (live) => (live.status ? SWAP_STATES[live.status.status]
  : 'Asking NEAR Intents for the state of the swap…');
const short = (address) => address.slice(0, 10) + '…' + address.slice(-8);
const utc = (iso) => iso.slice(0, 10) + ' ' + iso.slice(11, 19) + ' UTC';
const addressText = (value) => el('span', { class: 'swap-deposit-address' }, value);
const token = (asset) => el('img', { class: 'swap-token ' + asset.tone,
  src: asset.icon, alt: '', width: 32, height: 32, 'aria-hidden': 'true' });
const text = (cls, value, tag = 'p') => el(tag, { class: cls }, value);
const button = (label, cls, onclick, attrs = {}) => el('button', {
  type: 'button', class: cls, onclick, ...attrs,
}, label);
const detail = (name, value) => el('div', { class: 'swap-detail-row' }, el('dt', {}, name), el('dd', {}, value));
const chevron = () => el('span', { class: 'swap-chevron', 'aria-hidden': 'true' }, icon('chevronDown'));
export const ZEC_PRIVACY = 'A swap from ZEC leaves the shielded pool, because NEAR Intents takes '
  + 'ZEC only at a transparent deposit address, which is public. NEAR Intents accepts a shielded '
  + 'address as the recipient of a swap to ZEC, but no real swap has tested this.';
export const QUOTE_PRIVACY = 'Zigs sends the pair, the amount and the slippage to NEAR Intents '
  + 'through the Zigs server, with sample addresses and no address of yours. NEAR Intents sees '
  + 'the Zigs server, not your IP address.';
export const NO_RUN = 'Zigs cannot run this swap: the page shows quotes only, and no funds '
  + 'move.';
const privacy = (zec) => (zec ? ZEC_PRIVACY
  : 'Network visibility varies by route. Input, output and intermediate transfers may be '
    + 'publicly visible.') + ' ' + QUOTE_PRIVACY;
// The heading and the one line of the privacy box; privacy() gives the full text.
function privacyNote(from, to) {
  if (from.symbol === 'ZEC') return ['ZEC leaves the shielded pool',
    'NEAR Intents takes ZEC only at a public deposit address.'];
  if (to.symbol === 'ZEC') return ['The shielded payout is untested',
    'NEAR Intents accepts a shielded address, but no real swap has tested this.'];
  return ['Route visibility', 'Transfers on the route can be public.'];
}
const ASKING = 'Asking NEAR Intents for a quote…';
const STATUS = { QUOTING: ASKING, INPUT_VALID: ASKING };
const IDLE = 'Choose a pair and enter an amount to get a live quote.';
const LIVE_QUOTE = 'Live NEAR Intents quote, mainnet price';
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

/** The provider and clock arguments are for the isolated development harness and the tests. */
export function createSwapPreview(context = {}, provider = new NearIntentsSwapProvider(), clock) {
  let source = context, modal = null, observer = null, trigger = null, detailBlock = null;
  let pickerSide = null, searchText = '', rotation = 0;
  let liveReview = null, shown = null, depositCopy = null, depositState = null;
  const model = new SwapPreviewModel(provider, update, clock);
  const liveRoute = () => !!source.live && model.value.from === SOL_ID && model.value.to === ZEC_ID;
  const root = el('div', { class: 'page swap-page', id: 'panel-swap',
    'data-key': 'panel-swap', tabindex: '-1' });
  const pay = el('input', { id: 'swap-amount', class: 'swap-amount', type: 'text',
    inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '0.00',
    'aria-label': 'Amount you pay', 'aria-describedby': 'swap-error',
    oninput: (ev) => { model.type(ev.target.value); } });
  const receive = el('input', { class: 'swap-amount swap-output', readonly: true,
    'aria-label': 'Amount you receive', value: '—', tabindex: '0' });
  const fromButton = button('', 'swap-asset-button', (ev) => openPicker('from', ev.currentTarget),
    { 'aria-label': 'Choose asset to pay', 'aria-haspopup': 'dialog', 'data-key': 'swap-from' });
  const toButton = button('', 'swap-asset-button', (ev) => openPicker('to', ev.currentTarget),
    { 'aria-label': 'Choose asset to receive', 'aria-haspopup': 'dialog', 'data-key': 'swap-to' });
  const fromNetwork = text('swap-network', ''), toNetwork = text('swap-network', '');
  const error = text('swap-error', ''); error.id = 'swap-error'; error.setAttribute('role', 'status');
  const quoteLine = text('swap-quote-status', statusText({}));
  quoteLine.setAttribute('role', 'status');
  const quoteDetails = el('dl', { class: 'swap-quote-details' });
  const reverse = button(icon('swap'), 'swap-reverse', () => {
    rotation += 180; reverse.style.setProperty('--swap-rotation', rotation + 'deg');
    void model.reverse();
  }, { 'aria-label': 'Reverse swap direction', 'data-key': 'swap-reverse' });
  const review = button(['Review quote', el('span', { 'aria-hidden': 'true' }, icon('external'))],
    'swap-primary', (ev) => {
      if (!model.review()) return;
      openModal('Review quote', ev.currentTarget); drawReview();
    }, { disabled: true, 'data-key': 'swap-review', 'aria-haspopup': 'dialog' });
  const routeFrom = el('div', { class: 'swap-route-end' });
  const routeTo = el('div', { class: 'swap-route-end' });
  const privacyHead = text('', '', 'h2'), privacyLine = text('', ''), privacyText = text('', '');
  const destination = el('select', { id: 'swap-destination', 'aria-label': 'Example destination (demo)',
    onchange: (ev) => { model.chooseDestination(ev.target.value); } },
  el('option', { value: 'example' }, 'Example destination · demo only'),
  el('option', { value: '' }, 'Choose a destination'));
  const demoTarget = el('div', { class: 'swap-destination' },
    el('label', { for: 'swap-destination' }, 'Receive to · Demo'), destination);
  const payoutBox = el('div', { class: 'swap-destination swap-payout', hidden: true });
  const headTag = previewTag();
  const subtitle = el('p', { class: 'swap-subtitle', id: 'swap-subtitle' }, QUOTE_SUBTITLE);
  const deposit = el('section', { class: 'swap-deposit', id: 'swap-deposit', tabindex: '-1',
    'aria-labelledby': 'swap-deposit-title', 'data-key': 'swap-deposit', hidden: true });
  const settings = el('details', { class: 'swap-settings' });
  const settingValue = el('span', {}, '0.5%');
  const presets = [50, 100, 200].map((bps) => button(bps / 100 + '%', 'swap-preset', () => {
    void model.update({ slippageBps: bps });
  }, { 'aria-pressed': bps === 50 ? 'true' : 'false' }));
  settings.append(el('summary', {}, icon('settings'), 'Slippage', settingValue),
    el('div', { class: 'swap-settings-panel' }, text('', 'Maximum slippage', 'strong'),
      text('swap-caption', 'Sent with the quote request'), el('div', { class: 'swap-presets' }, presets)));
  const sourceLine = text('swap-source-context', '');
  const networkLine = text('', '');
  const quantumFlow = createPostQuantumSwapPreview(() => {
    quantumIntroNodes().forEach(node => { node.hidden = false; });
    quantumContinue.focus();
  });
  const quantumContinue = button(['Continue', el('span', { 'aria-hidden': 'true' }, icon('forward'))],
    'swap-primary pq-continue', () => {
      quantumIntroNodes().forEach(node => { node.hidden = true; });
      quantumFlow.start();
    }, { 'aria-label': 'Continue to post-quantum swap demo' });
  let activeTab = 'private';
  const modes = [
    { id: 'private', label: 'Swap', status: 'Live quotes' },
    { id: 'quantum', label: 'Post-quantum swap', status: 'Demo' },
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
      const index = ev.key === 'Home' ? 0 : ev.key === 'End' ? 1
        : (modes.findIndex((m) => m.id === activeTab) + (ev.key === 'ArrowRight' ? 1 : -1) + modes.length) % modes.length;
      selectTab(modes[index].id, true);
    },
  }));
  root.append(el('header', { class: 'swap-heading' },
    el('div', { class: 'swap-topline' }, headTag),
    el('h1', {}, 'Swap'), subtitle),
  el('div', { class: 'swap-mode-tabs', role: 'tablist', 'aria-label': 'Swap pages' }, modeTabs),
  el('div', { class: 'swap-panel', id: 'swap-panel-private', role: 'tabpanel',
    'aria-labelledby': 'swap-tab-private', tabindex: '0' },
  deposit,
  el('div', { class: 'swap-grid' },
    el('section', { class: 'swap-composer', 'aria-label': 'Swap composer' },
      el('div', { class: 'swap-pane' },
        el('div', { class: 'swap-pane-label' }, el('label', { for: 'swap-amount' }, 'You pay')),
        el('div', { class: 'swap-amount-row' }, pay, fromButton),
        el('div', { class: 'swap-network-row' }, fromNetwork,
          button('Max', 'swap-max', null, { disabled: true, 'aria-describedby': 'swap-subtitle' }))),
      el('div', { class: 'swap-switch-row' }, reverse),
      el('div', { class: 'swap-pane swap-receive' },
        el('div', { class: 'swap-pane-label' }, el('span', {}, 'You receive'),
          text('swap-caption', 'Estimate', 'span')),
        el('div', { class: 'swap-amount-row' }, receive, toButton), toNetwork),
      el('div', { class: 'swap-quote' }, quoteLine, quoteDetails), error,
      el('div', { class: 'swap-composer-footer' }, review)),
    el('aside', { class: 'swap-support', 'aria-label': 'Swap route and details' },
      el('section', { class: 'swap-detail-card' },
        el('div', { class: 'swap-detail-heading' }, el('h2', {},
          button(['Swap details', el('span', { 'aria-hidden': 'true' }, icon('external'))], 'swap-details-open',
            (ev) => { openModal('Swap details', ev.currentTarget); drawDetails(); },
            { 'aria-haspopup': 'dialog', 'data-key': 'swap-details' })), settings),
        text('swap-caption', 'Route'),
        el('div', { class: 'swap-route' }, routeFrom,
          el('span', { class: 'swap-route-link', 'aria-hidden': 'true' }, icon('forward')), routeTo),
        el('div', { class: 'swap-provider' }, el('span', { class: 'swap-provider-mark', 'aria-hidden': 'true' }, 'N'),
          el('div', {}, text('', 'NEAR Intents', 'strong'), text('swap-caption', 'Live quotes · mainnet only'))),
        demoTarget, payoutBox,
        button(['Execution & network context', icon('external')], 'swap-disclosure',
          (ev) => { openModal('Swap details', ev.currentTarget); drawDetails(); }, { 'aria-haspopup': 'dialog' })),
      el('section', { class: 'swap-privacy', 'aria-label': 'Route privacy' },
        icon('security'), el('div', {}, privacyHead, privacyLine,
          el('details', {}, el('summary', {}, 'What NEAR Intents sees'), privacyText)))))),
  el('section', { class: 'swap-panel swap-quantum-panel', id: 'swap-panel-quantum', role: 'tabpanel',
    'aria-labelledby': 'swap-tab-quantum', tabindex: '0', hidden: true },
    el('div', { class: 'swap-quantum-intro' },
      text('swap-eyebrow', 'Planned Zcash privacy'),
      el('h2', {}, 'Separate swap addresses.', el('br'), 'Same shared wallet.'),
      text('swap-quantum-description', 'A separate viewing key for each ZEC swap, with your existing wallet approvals.'),
      el('div', { class: 'swap-quantum-status' }, icon('security'),
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
    quantumFlow.element));
  update();

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
    root.dataset.swapPhase = s.phase;
    drawPair(from, to);
    if (pay.value !== s.amount) pay.value = s.amount;
    pay.setAttribute('aria-invalid', String(!!s.error));
    destination.value = s.destination;
    receive.value = s.quote ? swapDecimal(s.quote.amountOut, to) : '—';
    receive.setAttribute('aria-label', 'Amount you receive: ' + receive.value + ' ' + to.symbol);
    error.textContent = s.error;
    error.hidden = !s.error;
    const ready = !!s.quote && ['QUOTE_READY', 'REVIEW_CANCELLED'].includes(s.phase);
    if (s.phase === 'REVIEW_CANCELLED') model.resume();
    review.disabled = !ready;
    quoteLine.textContent = statusText(s);
    quoteDetails.replaceChildren(...quoteRows(s.quote, from, to));
    detailBlock?.replaceChildren(...quoteBlock(s));
    settingValue.textContent = s.slippageBps / 100 + '%';
    presets.forEach((b, i) => b.setAttribute('aria-pressed', String(SWAP_SLIPPAGES[i] === s.slippageBps)));
    [privacyHead.textContent, privacyLine.textContent] = privacyNote(from, to);
    privacyText.textContent = privacy(from.symbol === 'ZEC' || to.symbol === 'ZEC')
      + (liveRoute() ? ' ' + SWAP_PRIVACY : '');
    headTag.querySelector('.swap-tag-text').textContent = liveRoute() ? SWAP_TAG : LIVE_TAG;
    subtitle.textContent = source.live ? LIVE_SUBTITLE : QUOTE_SUBTITLE;
    drawPayout();
    drawDeposit(s);
    liveReview?.update(s);
    drawContext();
    drawRetry(s);
    syncModal(s);
  }
  function drawPair(from, to) {
    fromButton.replaceChildren(token(from), el('span', {}, from.symbol), chevron());
    toButton.replaceChildren(token(to), el('span', {}, to.symbol), chevron());
    fromNetwork.textContent = from.network + ' · mainnet'; toNetwork.textContent = to.network + ' · mainnet';
    routeFrom.replaceChildren(token(from), text('swap-caption', 'From', 'span'), text('', from.network, 'strong'), text('swap-caption', from.symbol));
    routeTo.replaceChildren(token(to), text('swap-caption', 'To', 'span'), text('', to.network, 'strong'), text('swap-caption', to.symbol));
  }
  function drawContext() {
    sourceLine.textContent = 'Source wallet: ' + (source.name || 'no wallet selected') + '. '
      + (source.threshold || 'Approval requirements will be shown with a selected wallet.');
    networkLine.textContent = (source.networks || 'Zcash Testnet · Solana Devnet')
      + '. NEAR Intents quotes are mainnet prices. ' + (source.live
        ? 'Zigs runs a real swap from SOL to ZEC only.' : 'Zigs cannot run a swap here.');
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
    if (modal) closeModal(false);
    trigger = opener; modal = el('dialog', { class: 'swap-modal', 'aria-labelledby': 'swap-modal-title' });
    modal.addEventListener('cancel', (ev) => { ev.preventDefault(); closeModal(); });
    // The native dialog owns Escape; do not let the wallet's unrelated layer handler consume it.
    modal.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeModal(); }
      if (ev.key === 'Tab') {
        const stops = [...modal.querySelectorAll('button,input,select,summary,[tabindex="0"]')]
          .filter((n) => !n.disabled && n.getClientRects().length);
        const at = stops.indexOf(document.activeElement), last = stops.length - 1;
        if (at < 0 || (ev.shiftKey ? at === 0 : at === last)) {
          ev.preventDefault(); stops[ev.shiftKey ? last : 0]?.focus();
        }
      }
    });
    modal.addEventListener('click', (ev) => { if (ev.target === modal) {
      const r = modal.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) closeModal();
    } });
    modal.append(el('div', { class: 'swap-modal-heading' },
      el('div', {}, previewTag(liveRoute()),
        el('h2', { id: 'swap-modal-title', tabindex: '-1' }, title)),
      button(icon('close'), 'swap-close', () => closeModal(), { 'aria-label': 'Close dialog' })),
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
      text('swap-caption', 'Only ZEC, SOL and USDC are available for quotes.'));
    drawAssets(); search.focus();
  }
  function drawAssets() {
    const matches = SWAP_ASSETS.filter((a) => (a.symbol + ' ' + a.name + ' ' + a.network).toLowerCase().includes(searchText.trim().toLowerCase()));
    modal.querySelector('.swap-asset-list').replaceChildren(...(matches.length ? matches.map((a) => button([
      token(a), el('span', {}, text('', a.symbol + ' · ' + a.network, 'strong'), text('swap-caption', a.name, 'span')),
      el('span', { class: 'swap-choice-mark', 'aria-hidden': 'true' }, a.id === model.value[pickerSide] ? '✓' : '↗'),
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
    modal.querySelector('.swap-modal-content').replaceChildren(
      text('swap-details-route', from.network + ' → NEAR Intents → ' + to.network),
      detailBlock,
      el('div', { class: 'swap-destination' }, el('label', { for: select.id }, 'Receive to · Demo'), select),
      text('swap-caption', sourceLine.textContent),
      el('div', { class: 'swap-review-warning' }, text('', 'Privacy & network context', 'strong'),
        text('', privacy(from.symbol === 'ZEC' || to.symbol === 'ZEC')), text('', networkLine.textContent),
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
      button(['Simulate swap flow', el('span', { 'aria-hidden': 'true' }, icon('forward'))], 'swap-primary', () => {
        modal.querySelector('h2').textContent = 'Swap flow simulation'; model.simulate();
        modal.querySelector('h2').focus();
      }), button('Back to swap', 'swap-secondary', () => closeModal()));
  }
  function drawProgress() {
    const s = model.value, done = s.phase === 'DEMO_COMPLETE';
    modal.querySelector('.swap-modal-content').replaceChildren(
      text('swap-simulation-note', 'Demo only · simulated steps. No funds move and nothing is signed.'),
      el('ol', { class: 'swap-progress-list' }, SWAP_DEMO_STEPS.map((step, i) => el('li', {
        class: i < s.step ? 'is-demonstrated' : i === s.step ? 'is-current' : '',
        'aria-current': i === s.step ? 'step' : null,
      }, el('span', { class: 'swap-step-number', 'aria-hidden': 'true' }, i < s.step ? '✓' : i + 1),
      el('div', {}, text('', step, 'strong'), text('swap-caption', i < s.step ? 'Demonstrated · no real event'
        : i === s.step ? 'Next simulated step' : 'Later simulated step'))))),
      el('p', { class: 'swap-demo-result', role: 'status' }, done ? 'Demo complete. The steps were simulated. No funds moved.'
        : 'Advance each example step yourself. Nothing is broadcast or signed.'),
      button(done ? 'Back to swap' : 'Next demo step →', 'swap-primary', () => {
        if (done) { closeModal(false); void model.update(); return; }
        model.advance(); modal.querySelector('.swap-primary').focus({ preventScroll: true });
      }));
  }
  // The ZEC address that a live swap pays to (from app-shell.js), or the reason why there is none.
  function payoutText(payout) {
    if (!payout.address) return payout.reason || NO_PAYOUT;
    return (source.name || 'Wallet') + ' · ' + short(payout.address);
  }
  function drawPayout() {
    const payout = source.payout ?? {};
    payoutBox.hidden = !liveRoute(); demoTarget.hidden = liveRoute();
    payoutBox.replaceChildren(text('', 'Receive to', 'span'),
      text(payout.address ? 'swap-payout-address' : 'swap-caption', payoutText(payout), 'strong'));
  }
  // The review of the live route: the real payout address, the refund address that the person
  // types, the untested payout and the button that asks NEAR Intents for a deposit address.
  function drawLiveReview() {
    const s = model.value, from = swapAsset(s.from), to = swapAsset(s.to);
    const payout = source.payout ?? {};
    let refundTo = '', agreed = false;
    const errorLine = text('swap-error', ''); errorLine.setAttribute('role', 'alert');
    const refundNote = text('swap-caption',
      'NEAR Intents sends the SOL back to this address if the swap fails.');
    refundNote.id = 'swap-refund-note';
    const go = button('Get deposit address', 'swap-primary', async () => {
      go.disabled = true;
      const opened = await model.openSwap({ recipient: payout.address, refundTo,
        room: payout.room, wallet: source.name || 'Wallet' });
      if (opened) deposit.focus();
    }, { disabled: true, 'data-key': 'swap-open' });
    const refund = el('input', { id: 'swap-refund', class: 'swap-search', type: 'text',
      autocomplete: 'off', spellcheck: 'false', placeholder: 'Solana address',
      'aria-describedby': 'swap-refund-note', oninput: (ev) => {
        refundTo = ev.target.value.trim(); review.update(model.value);
      } });
    const agree = el('input', { id: 'swap-agree', type: 'checkbox', onchange: (ev) => {
      agreed = ev.target.checked; review.update(model.value);
    } });
    const review = { update(now) {
      const busy = !!now.live;
      go.disabled = busy || !payout.address || !swapSolAddress(refundTo) || !agreed;
      errorLine.textContent = now.live?.swap ? 'Close the open live swap first.' : now.swapError;
      errorLine.hidden = !errorLine.textContent;
    } };
    liveReview = review;
    modal.querySelector('.swap-modal-content').replaceChildren(
      el('div', { class: 'swap-review-amount' }, text('swap-caption', 'Estimated receive amount'),
        text('', swapDecimal(s.quote.amountOut, to), 'strong'),
        text('swap-caption', to.symbol + ' · ' + to.network)),
      el('dl', { class: 'swap-review-details' },
        detail('You pay', s.amount + ' ' + from.symbol + ' · ' + from.network),
        ...quoteRows(s.quote, from, to),
        detail('Maximum slippage', s.slippageBps / 100 + '%'),
        detail('Quote', quoteLabel(s.quote)
          + (s.quote.quotedAt ? ' · ' + s.quote.quotedAt.slice(11, 19) + ' UTC' : '')),
        detail('Receive to', payoutText(payout)),
        detail('Pay from', 'A Solana wallet outside Zigs'),
        detail('Route', from.network + ' → NEAR Intents → ' + to.network)),
      el('label', { for: 'swap-refund', class: 'swap-field-label' },
        'Refund address: the Solana address that you pay from'),
      refund, refundNote,
      el('div', { class: 'swap-review-warning' }, text('', 'Real funds', 'strong'),
        text('', UNTESTED), text('', SWAP_PRIVACY)),
      el('label', { class: 'swap-agree' }, agree, el('span', {}, SWAP_AGREE)),
      errorLine, go, button('Back to swap', 'swap-secondary', () => closeModal()));
    review.update(s);
  }
  // The deposit screen of the open live swap. It stays on the page, apart from any dialog, until
  // the person closes it: a wallet switch or an old quote does not remove an address in use.
  function drawDeposit(s) {
    const live = s.live?.swap ? s.live : null;
    deposit.hidden = !live;
    if (!live) { shown = null; deposit.replaceChildren(); return; }
    if (shown !== live) { shown = live; buildDeposit(live); }
    const waiting = !live.status || ['unknown', 'PENDING_DEPOSIT'].includes(live.status.status);
    const expired = model.swapExpired();
    depositCopy.hidden = expired || !waiting;
    const tx = (name, list) => (list?.length ? [detail(name, list.map(addressText))] : []);
    depositState.replaceChildren(
      el('p', { class: 'swap-deposit-status', role: 'status' }, 'Status: ' + swapState(live)),
      ...(expired ? [text('swap-error', SWAP_EXPIRED)] : []),
      ...(live.statusError && !SWAP_FINAL.includes(live.status?.status)
        ? [text('swap-caption', live.statusError)] : []),
      el('dl', { class: 'swap-review-details' }, tx('Solana transaction', live.status?.originTxs),
        tx('Zcash transaction', live.status?.destinationTxs)));
  }
  function buildDeposit(live) {
    const w = live.swap, sol = swapAsset(SOL_ID), zec = swapAsset(ZEC_ID);
    depositCopy = copyBtn(w.depositAddress, 'Copy address', 'swap-secondary');
    depositState = el('div', { class: 'swap-deposit-state' });
    deposit.replaceChildren(
      el('div', { class: 'swap-deposit-heading' },
        el('h2', { id: 'swap-deposit-title' }, 'Live swap: SOL to ZEC'), previewTag(true)),
      el('div', { class: 'swap-review-warning' }, text('', 'Untested payout', 'strong'),
        text('', UNTESTED)),
      el('dl', { class: 'swap-review-details' },
        detail('Send exactly', swapDecimal(w.amountIn, sol) + ' SOL ('
          + BigInt(w.amountIn).toLocaleString('en-US') + ' lamports)'),
        detail('To this address', addressText(w.depositAddress)),
        detail('Pay before', utc(w.deadline) + '. A deposit after this time can be lost.'),
        detail('Refund address', addressText(w.refundTo)),
        detail('Payout', 'About ' + swapDecimal(w.amountOut, zec) + ' ZEC, at least '
          + swapDecimal(w.minAmountOut, zec) + ' ZEC'),
        detail('Paid to', [live.wallet + ' · ', addressText(w.recipient)]),
        detail('Quote ID', w.correlationId || '—')),
      depositCopy, depositState, text('swap-caption', SWAP_KEEP),
      button('Close', 'swap-secondary', () => model.closeSwap(),
        { 'data-key': 'swap-close-deposit' }));
  }
  return { element: root, model, setContext(next) {
    const moved = source.id !== next.id || source.threshold !== next.threshold
      || source.networks !== next.networks || source.payout?.address !== next.payout?.address;
    if (moved) {
      closeModal(); resetQuantumFlow(); model.stale();
    }
    source = next; update();
  } };
}
