// Local provider credits. Route selection and privacy disclosures remain separate.
import { el } from './app-dom.js';

export const nearSwapCredit = () => el('div', { class: 'swap-powered' },
  el('img', { src: '/assets/near-sculpted.svg', alt: '', width: '52', height: '52',
    class: 'swap-powered-mark', 'aria-hidden': 'true' }),
  el('span', { class: 'swap-powered-copy' },
    el('span', {}, 'Powered by'), el('strong', {}, 'NEAR Confidential Intents')));

export const heliusSwapCredit = () => el('span', { class: 'swap-helius-credit' },
  el('img', { src: '/assets/helius.svg', alt: '', width: '22', height: '22',
    'aria-hidden': 'true' }),
  el('span', {}, el('span', { class: 'swap-helius-prefix' }, 'Powered by '),
    el('strong', {}, 'Helius Privacy Rings')));
