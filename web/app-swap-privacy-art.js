// Code-native teaching illustrations. Labels describe visibility, never wallet or chain data.
import { el } from './app-dom.js';
import { interfaceIcon } from './sidebar-icons.js';

const word = (text, cls = '') => el('span', { class: cls }, text);
const line = (label, value, cls = '') => el('div', { class: 'privacy-film-field ' + cls },
  word(label), word(value));
const coin = (asset, cls = '') => el('div', { class: 'privacy-film-coin ' + cls }, interfaceIcon(asset));
const foot = (text) => el('p', { class: 'privacy-film-foot' }, text);
const scene = (name, ...children) => el('div', { class: 'privacy-film-scene',
  'data-scene': name }, ...children);

function sourceArt(route) {
  const privateSource = route.privateSource || route.from === 'zec';
  const sheet = el('div', { class: 'privacy-film-note privacy-film-note-front' },
    el('div', { class: 'privacy-film-note-title' }, interfaceIcon(privateSource ? 'lock' : 'unshield'),
      word(privateSource ? 'Private notes' : 'Public balance')),
    line('Owner', privateSource ? '••••••' : 'Visible'),
    line('Value', privateSource ? '••••••' : 'Visible'));
  return scene('source', el('div', { class: 'privacy-film-notes' },
    el('div', { class: 'privacy-film-note privacy-film-note-back' }),
    el('div', { class: 'privacy-film-note privacy-film-note-middle' }), sheet),
  coin(route.from, 'privacy-film-source-coin'),
  foot(privateSource ? 'Private notes · wallet approvals apply' : 'A public source balance'));
}

function depositArt(route) {
  const card = el('div', { class: 'privacy-film-ledger' },
    el('div', { class: 'privacy-film-note-title' }, interfaceIcon('unshield'), word('Public deposit')),
    line('Address', 'Visible', 'privacy-film-reveal privacy-film-reveal-one'),
    line('Amount', 'Visible', 'privacy-film-reveal privacy-film-reveal-two'),
    line('Time', 'Visible', 'privacy-film-reveal privacy-film-reveal-three'));
  return scene('deposit', card, coin(route.from, 'privacy-film-traveller'),
    foot('Visible on ' + (route.from === 'zec' ? 'Zcash' : 'Solana')));
}

function providerLinks() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 320 180');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'privacy-film-links');
  ['M92 38C168 38 155 90 232 90', 'M92 90H232', 'M92 142C168 142 155 90 232 90']
    .forEach((d, i) => {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d); path.setAttribute('pathLength', '1');
      path.setAttribute('class', 'privacy-film-link privacy-film-link-' + i);
      svg.append(path);
    });
  return svg;
}

function providerArt(route) {
  return scene('provider', providerLinks(),
    el('div', { class: 'privacy-film-addresses' }, ['Deposit', 'Payout', 'Refund'].map((name) =>
      el('div', { class: 'privacy-film-address' }, interfaceIcon(name === 'Deposit' ? 'send' : name === 'Payout' ? 'receive' : 'restore'), word(name)))),
    el('div', { class: 'privacy-film-provider' }, word('NEAR'),
      word(route.execution === 'basic' ? 'Basic route' : 'Standard route')),
    foot('The provider can connect all three'));
}

function destinationArt(route) {
  const shielded = route.to === 'zec';
  return scene('destination',
    el('div', { class: 'privacy-film-receipt', 'data-shielded': String(shielded) },
      el('div', { class: 'privacy-film-note-title' }, coin(route.to),
        word(shielded ? 'Shielded destination' : 'Public destination')),
      line('Recipient', shielded ? '••••••' : 'Visible'),
      line('Amount', shielded ? '••••••' : 'Visible'),
      el('div', { class: 'privacy-film-seal' }, interfaceIcon(shielded ? 'lock' : 'unshield'))),
    foot(shielded ? 'Hidden on Zcash · still known to NEAR' : 'Public on Solana · known to NEAR'));
}

export function createSwapPrivacyFilm() {
  const element = el('div', { class: 'privacy-film', 'aria-hidden': 'true' });
  const names = ['source', 'deposit', 'provider', 'destination'];
  return { element,
    route(route) {
      element.replaceChildren(sourceArt(route), depositArt(route), providerArt(route),
        destinationArt(route));
    },
    frame(index, progress) {
      // Resolve the visual action early, then hold the picture while its explanation is read.
      const beat = Math.min(1, Math.max(0, progress) / 0.3);
      const action = beat * beat * (3 - 2 * beat);
      element.dataset.scene = names[index];
      element.style.setProperty('--film-progress', String(action));
    } };
}
