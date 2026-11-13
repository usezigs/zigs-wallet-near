// Educational route visibility only. This component never reads a wallet, signs or pays.
import { el } from './app-dom.js';
import { interfaceIcon } from './sidebar-icons.js';
import { createSwapPrivacyFilm } from './app-swap-privacy-art.js';
import { createSwapPrivacyPlayback } from './app-swap-privacy-motion.js';

const paragraph = (words, cls = '') => el('p', { class: cls }, words);
const stage = (kind, title, body, hidden, visible) => ({ kind, title, body, hidden, visible });
const publicSource = (asset) => stage('public', 'Your ' + asset + ' starts in public',
  'This source is a public Solana balance. It has no shielded source protection.',
  'No source privacy is added by this swap.',
  'The source address, balance and transaction history are public on Solana.');

function sourceStage(route) {
  if (route.from === 'zec') return stage('private', 'ZEC starts in the shielded pool',
    'Your ZEC starts as shielded notes in the wallet.',
    'The shielded sender, note amounts and balance are hidden on Zcash.',
    'The swap will create a public deposit. Its amount and timing can still be correlated.');
  if (!route.privateSource) return publicSource(route.from.toUpperCase());
  return stage('private', 'SOL starts in the private pool',
    'The wallet spends private pool notes, with its usual device approvals.',
    'Note ownership and spending are protected inside the pool.',
    'Group accounts and device fee addresses can still be linkable. This is an experimental pool.');
}

function depositStage(route) {
  if (route.from === 'zec') return stage('public', 'ZEC leaves the shielded pool',
    'The swap accepts ZEC at a transparent deposit address. This output is public.',
    'The spent notes and shielded change remain hidden.',
    'The deposit address, ZEC amount and transaction time are public on Zcash.');
  return stage('public', 'The SOL deposit is public',
    route.privateSource ? 'SOL leaves the private pool and goes to the provider’s deposit address.'
      : 'The source wallet sends to the provider’s deposit address on Solana.',
    route.privateSource ? 'Private pool note ownership stays hidden; the withdrawal itself is public.'
      : 'No deposit privacy is added by this route.',
    'Anyone can see the deposit address, amount, time and transaction fee payer on Solana.');
}

function providerStage(route) {
  const basic = route.execution === 'basic';
  return stage('provider', 'NEAR can connect the route',
    'NEAR receives the amount, deposit, payout and refund addresses. It can link both sides.',
    basic ? 'Basic requests confidential routing and requires provider access. It never falls back.'
      : 'Standard routing requests no confidential route protection.',
    'NEAR sees the route. Zigs’ status lookup can also expose route addresses to app users '
      + 'who know the deposit address.');
}

function destinationStage(route) {
  if (route.to === 'zec') return stage('private', 'ZEC is requested to a shielded address',
    'Once received in the shielded pool, the payout amount and recipient are hidden on Zcash.',
    'Public Zcash observers cannot read the shielded recipient or payout amount.',
    'NEAR still knows the payout address and amount. Funded delivery is unverified in Zigs.');
  return stage('public', 'You receive public ' + route.to.toUpperCase(),
    'The payout goes to a public Solana address. It does not enter the private SOL pool.',
    'No destination privacy is added by this payout.',
    'The receiving address, amount and time are public on Solana. NEAR knows the destination.');
}

const badges = { private: 'Protected on chain', public: 'Public on chain',
  provider: 'Visible to NEAR' };
const labels = ['Source', 'Deposit', 'NEAR', 'Receive'];
const field = (title, words) => el('div', {}, el('dt', {}, title), el('dd', {}, words));

function chapterSummary(route, index) {
  const source = route.from === 'zec'
    ? 'ZEC starts shielded. The public deposit’s amount and timing can still link activity.'
    : route.privateSource
      ? 'The private pool is experimental. Wallet approvals apply; group and fee addresses can still be linked.'
      : 'The source address, balance and transaction history are public on Solana.';
  const deposit = route.from === 'zec'
    ? 'The deposit address, amount and time are public. Spent notes and shielded change stay hidden.'
    : route.privateSource
      ? 'The deposit address, amount, time and fee payer are public. Pool note ownership stays hidden.'
      : 'The address, amount, time and fee payer are public. The source and deposit can be linked.';
  const destination = route.to === 'zec'
    ? 'Zcash hides the recipient and amount. NEAR still knows both; funded Zigs delivery is unverified.'
    : 'The receiving address, amount and time are public. This payout does not enter the private SOL pool.';
  return [source, deposit,
    'NEAR links the deposit, payout and refund addresses. Status lookups can also reveal route addresses.',
    destination][index];
}

/** A visible, finite autoplay tutorial. Reduced motion keeps the visual chapters manual. */
export function createSwapPrivacyExplainer() {
  let routeKey = '', steps = [], controlKey = '', player, currentRoute;
  const film = createSwapPrivacyFilm();
  const content = el('div', { class: 'swap-privacy-story', 'aria-live': 'off' });
  const caption = paragraph('', 'swap-privacy-caption');
  const boundary = paragraph('', 'swap-privacy-boundary');
  const refund = paragraph('');
  const stageFacts = el('dl', { class: 'swap-privacy-facts' });
  const stageDescription = paragraph('');
  const title = el('h2', { id: 'swap-privacy-title' }, 'What stays private?');
  const play = el('button', { type: 'button', class: 'swap-privacy-play', 'data-interface-control': '',
    onclick: () => player.toggle() }, 'Pause');
  const playbackControls = el('div', { class: 'swap-privacy-controls' }, play);
  const closeDetails = () => details.close();
  const details = el('dialog', { class: 'swap-modal swap-privacy-dialog',
    'aria-labelledby': 'swap-privacy-details-title',
    onkeydown: (event) => { if (event.key === 'Escape') event.stopPropagation(); } },
  el('div', { class: 'swap-modal-heading' },
    el('h2', { id: 'swap-privacy-details-title', tabindex: '-1' }, 'Privacy details'),
    el('button', { type: 'button', class: 'swap-close', onclick: closeDetails, 'data-interface-control': '',
      'aria-label': 'Close privacy details' }, interfaceIcon('close'))),
  el('div', { class: 'swap-modal-content' }, stageDescription, stageFacts, boundary,
    paragraph('Price previews send the pair, amount and slippage through Zigs with public sample '
      + 'addresses. Real execution sends the wallet’s payout and refund addresses too. '
      + 'The Zigs server sees the requesting device’s IP address.'), refund,
    paragraph('For real swaps, recovery receipts are encrypted in this browser. They help resume '
      + 'tracking; a receipt alone cannot prove that the payout reached the wallet.')));
  const more = el('button', { type: 'button', class: 'swap-privacy-more', 'data-interface-control': '',
    'aria-haspopup': 'dialog', onclick: () => {
      player.pause(); details.showModal(); details.querySelector('h2').focus();
    } }, 'Privacy details, refunds and recovery', interfaceIcon('info'));
  const controls = labels.map((label, i) => el('button', { type: 'button',
    class: 'swap-privacy-stop', 'data-interface-control': '', onclick: () => {
      content.setAttribute('aria-live', 'polite'); player.seek(i);
    } },
  el('span', { class: 'swap-privacy-node', 'aria-hidden': 'true' }),
  el('span', {}, label)));
  const map = el('ol', { class: 'swap-privacy-map', 'aria-label': 'Privacy stages' },
    controls.map((control) => el('li', {}, control)));
  const element = el('section', { class: 'swap-privacy-explainer',
    'aria-labelledby': 'swap-privacy-title' },
  el('header', {}, title, caption),
  map,
  playbackControls,
  el('div', { class: 'swap-privacy-meter', 'aria-hidden': 'true' }, el('span')),
  film.element, content, more, details);

  function select(index) {
    const current = steps[index];
    if (!current) return;
    element.dataset.stage = current.kind;
    element.dataset.chapter = String(index);
    controls.forEach((control, i) => {
      control.setAttribute('aria-pressed', String(i === index));
      control.dataset.kind = steps[i].kind;
      control.setAttribute('aria-label', String(i + 1) + '. ' + steps[i].title);
      control.querySelector('.swap-privacy-node').replaceChildren(
        interfaceIcon(steps[i].kind === 'private' ? 'lock' : i === 2 ? 'swap' : 'unshield'));
    });
    content.replaceChildren(el('article', { class: 'swap-privacy-scene' },
      paragraph(badges[current.kind], 'swap-privacy-visibility'),
      el('h3', {}, current.title),
      paragraph(chapterSummary(currentRoute, index), 'swap-privacy-description')));
    stageDescription.textContent = current.body;
    stageFacts.replaceChildren(
      field(index === 2 ? 'Route protection' : 'What stays hidden', current.hidden),
      field('Who can still see what', current.visible));
  }
  function frame(index, progress, total) {
    film.frame(index, progress);
    map.style.setProperty('--privacy-progress', String(Math.min(1, (index + progress) / 3)));
    element.style.setProperty('--tutorial-progress', String(total));
  }
  function drawControl(state) {
    const { playing, finished, reduced, manual } = state;
    const key = [playing, finished, reduced, manual].join('|');
    if (key === controlKey) return;
    controlKey = key;
    play.replaceChildren(interfaceIcon(finished ? 'restore' : playing ? 'pause' : 'play'),
      el('span', {}, finished ? 'Replay' : playing ? 'Pause' : 'Resume'));
    play.setAttribute('aria-label', finished ? 'Replay explainer' : playing ? 'Pause explainer' : 'Resume explainer');
    playbackControls.hidden = reduced;
    element.dataset.playing = String(playing);
    element.dataset.motion = reduced || manual ? 'manual' : 'animated';
    content.setAttribute('aria-live', manual ? 'polite' : 'off');
  }
  player = createSwapPrivacyPlayback(element, film.element, {
    select, frame, change: drawControl });
  return { element, pause: player.pause, update(route) {
    const key = JSON.stringify(route);
    if (key === routeKey) return;
    routeKey = key; currentRoute = route;
    steps = [sourceStage(route), depositStage(route), providerStage(route),
      destinationStage(route)];
    film.route(route);
    caption.textContent = route.execution === 'preview'
      ? 'Illustration only · no funds move'
      : 'Illustration · not live transaction progress';
    boundary.textContent = route.to === 'zec'
      ? 'The public deposit and provider visibility remain. Shielded delivery still needs a funded test.'
      : 'The deposit and SOL payout are public. This route does not deliver private SOL.';
    refund.textContent = refundVisibility(route);
    player.reset();
  } };
}

function refundVisibility(route) {
  if (route.from === 'zec') return 'A ZEC refund returns to the wallet’s transparent address. '
    + 'Its amount and receiving address are public until the wallet shields it again.';
  if (route.privateSource) return 'A SOL refund returns to the proposing device’s public fee '
    + 'address. That device alone controls it until it adds the SOL back to the private pool.';
  return 'A SOL refund returns to the public Solana refund address chosen in the review. '
    + 'It does not become private automatically.';
}
