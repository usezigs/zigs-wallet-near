// A local illustration driven only by the preview model. No wallet or provider calls.
import { el } from './app-dom.js';
import { sculptedIcon } from './app-icons.js';
import { interfaceIcon } from './sidebar-icons.js';
import { SWAP_DEMO_STEPS } from './swap-preview-model.js';

const objects = ['activity', 'devices', 'wallet', 'swap', 'lock', 'key'];
const stories = [
  ['Your quote is ready', 'The pair, amount and minimum receive are checked in this example.'],
  ['Devices come together', 'Example approvals gather around the source wallet. No signing request is made.'],
  ['A deposit enters the route', 'The illustration moves a token into the public deposit stage. No deposit exists.'],
  ['NEAR connects the route', 'The route is being illustrated between the two assets. No exchange is executed.'],
  ['The destination comes into view', 'An example receipt reaches the destination. This is not a wallet confirmation.'],
  ['The recovery record is ready', 'The final illustration shows how a receipt could be kept. Nothing is saved.'],
];
const durations = [1800, 2400, 2100, 2600, 2300, 1800];
export function createSwapSimulation({ from, to, advance, close }) {
  let step = -1, timer = null, disposed = false;
  const win = document.defaultView;
  const motion = win?.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = !motion || motion.matches;
  const mark = el('div', { class: 'swap-cinema-object', 'aria-hidden': 'true' });
  const title = el('h3', {}), copy = el('p', {}), status = el('p', { class: 'swap-cinema-status', role: 'status' });
  const asset = (item, position) => el('div', { class: 'swap-cinema-asset ' + position },
    el('img', { src: item.icon, alt: '', width: '40', height: '40' }), el('strong', {}, item.symbol),
    el('span', {}, position === 'source' ? 'Source' : 'Destination'));
  const stops = SWAP_DEMO_STEPS.map((label, i) => el('li', {},
    el('span', { class: 'swap-cinema-stop-icon', 'aria-hidden': 'true' }, sculptedIcon(objects[i])),
    el('span', {}, label)));
  const play = el('button', { type: 'button', class: 'swap-secondary swap-cinema-play', 'data-interface-control': '', onclick: () => {
    paused = !paused; paintPlayback(); schedule();
  } });
  const next = el('button', { type: 'button', class: 'swap-primary', 'data-interface-control': '', onclick: () => {
    clearTimeout(timer);
    if (step === 6) close(); else advance();
  } });
  const element = el('section', { class: 'swap-cinema', 'aria-label': 'Illustrated swap simulation' },
    el('p', { class: 'swap-cinema-disclosure' }, 'Simulation · no funds move and nothing is signed.'),
    el('div', { class: 'swap-cinema-stage' },
      asset(from, 'source'),
      el('div', { class: 'swap-cinema-track track-in', 'aria-hidden': 'true' }, el('i', {})),
      el('div', { class: 'swap-cinema-engine' },
        el('div', { class: 'swap-cinema-orbit', 'aria-hidden': 'true' }, el('i', {}), el('i', {}), el('i', {})),
        mark),
      el('div', { class: 'swap-cinema-track track-out', 'aria-hidden': 'true' }, el('i', {})),
      asset(to, 'destination')),
    el('div', { class: 'swap-cinema-story' }, status, title, copy),
    el('ol', { class: 'swap-cinema-stops', 'aria-label': 'Simulated stages' }, stops),
    el('div', { class: 'swap-cinema-actions' }, play, next));
  function paintPlayback() {
    element.dataset.paused = String(paused || document.hidden);
    play.replaceChildren(interfaceIcon(paused ? 'play' : 'pause'), document.createTextNode(paused ? 'Play simulation' : 'Pause'));
    play.setAttribute('aria-pressed', String(!paused));
  }
  function schedule() {
    clearTimeout(timer); timer = null;
    if (!disposed && !paused && !document.hidden && step >= 0 && step < 6) {
      timer = setTimeout(() => { if (element.isConnected) advance(); }, durations[step]);
    }
  }
  const visibility = () => { paintPlayback(); schedule(); };
  document.addEventListener?.('visibilitychange', visibility);
  const reduce = () => { if (motion.matches) { paused = true; paintPlayback(); schedule(); } };
  motion?.addEventListener('change', reduce);
  return { element, update(value, done) {
    const nextStep = done ? 6 : value;
    if (step === nextStep) return;
    step = nextStep; element.dataset.stage = String(step);
    element.style.setProperty('--stage-duration', (durations[step] || 1200) + 'ms');
    mark.replaceChildren(el('div', { class: 'swap-cinema-object-art' }, sculptedIcon(done ? 'approvals' : objects[step])));
    status.textContent = done ? '6 of 6 · simulated' : (step + 1) + ' of 6 · simulated';
    title.textContent = done ? 'Your swap journey, demonstrated' : stories[step][0];
    copy.textContent = done ? 'Demo complete. The steps were simulated. No funds moved.' : stories[step][1];
    stops.forEach((node, i) => {
      node.dataset.state = i < step ? 'complete' : i === step ? 'active' : 'upcoming';
      node.setAttribute('aria-current', i === step ? 'step' : 'false');
    });
    next.replaceChildren(document.createTextNode(done ? 'Back to swap' : 'Next demo step'), interfaceIcon(done ? 'back' : 'forward'));
    if (done && document.activeElement === play) next.focus({ preventScroll: true });
    play.hidden = done;
    paintPlayback(); schedule();
  }, destroy() {
    disposed = true; clearTimeout(timer); motion?.removeEventListener('change', reduce); document.removeEventListener?.('visibilitychange', visibility);
  } };
}
