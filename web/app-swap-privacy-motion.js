// A finite educational playhead. No wallet state, storage, provider or payment access.
// A short setup and deposit, with more reading time for provider and destination visibility.
const CHAPTER_MS = [4000, 4000, 6000, 6000];
const CHAPTER_START_MS = CHAPTER_MS.map((_, index) => CHAPTER_MS.slice(0, index)
  .reduce((sum, duration) => sum + duration, 0));
export const SWAP_PRIVACY_DURATION_MS = CHAPTER_MS.reduce((sum, duration) => sum + duration, 0);

export function createSwapPrivacyPlayback(element, target, callbacks) {
  const doc = element.ownerDocument, win = doc?.defaultView;
  const reduced = win?.matchMedia('(prefers-reduced-motion: reduce),(update: slow),(forced-colors: active)');
  const prefersStatic = () => !!reduced?.matches || !!win?.navigator.connection?.saveData;
  const state = { index: 0, elapsed: 0, playing: false, finished: false, manual: false,
    reduced: prefersStatic() };
  let held = false, visible = false, ready = false, frame = 0, last = 0;
  const observer = win?.IntersectionObserver ? new win.IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.35);
    sync();
  }, { threshold: [0, 0.35] }) : null;
  observer?.observe(target);

  function eligible() {
    return ready && visible && element.isConnected && !doc.hidden && !state.reduced
      && !held && !state.finished;
  }
  function paint() {
    const progress = state.manual ? 1
      : (state.elapsed - CHAPTER_START_MS[state.index]) / CHAPTER_MS[state.index];
    callbacks.frame(state.index, state.finished ? 1 : progress,
      state.elapsed / SWAP_PRIVACY_DURATION_MS);
    callbacks.change(state);
  }
  function stop() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0; last = 0; state.playing = false;
    paint();
  }
  function sync() {
    if (!eligible()) { stop(); return; }
    if (frame) return;
    state.playing = true; last = win.performance.now();
    callbacks.change(state); frame = win.requestAnimationFrame(tick);
  }
  function tick(now) {
    frame = 0;
    if (!eligible()) { stop(); return; }
    state.elapsed = Math.min(SWAP_PRIVACY_DURATION_MS,
      state.elapsed + Math.max(0, Math.min(now - last, 250)));
    last = now;
    const index = CHAPTER_START_MS.findLastIndex((start) => state.elapsed >= start);
    if (index !== state.index) { state.index = index; callbacks.select(index); }
    state.finished = state.elapsed >= SWAP_PRIVACY_DURATION_MS;
    paint();
    if (state.finished) { stop(); return; }
    frame = win.requestAnimationFrame(tick);
  }
  function reset() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0; ready = true;
    Object.assign(state, { index: 0, elapsed: 0, finished: false, manual: false, playing: false });
    callbacks.select(0); paint(); sync();
  }
  function seek(index) {
    held = true;
    Object.assign(state, { index, elapsed: CHAPTER_START_MS[index], manual: true,
      finished: index === 3 });
    callbacks.select(index); stop();
  }
  function toggle() {
    if (state.reduced) { seek((state.index + 1) % 4); return; }
    if (state.playing) { held = true; stop(); return; }
    held = false;
    if (state.finished) reset();
    if (state.manual) { state.manual = false; state.elapsed = CHAPTER_START_MS[state.index]; }
    sync();
  }
  const visibility = () => sync();
  const preference = () => {
    state.reduced = prefersStatic();
    if (state.reduced) { held = true; state.manual = true; }
    sync();
  };
  doc?.addEventListener?.('visibilitychange', visibility);
  reduced?.addEventListener?.('change', preference);
  win?.navigator.connection?.addEventListener?.('change', preference);
  win?.addEventListener('pagehide', (event) => {
    stop();
    if (event.persisted) return;
    observer?.disconnect();
    doc.removeEventListener('visibilitychange', visibility);
    reduced?.removeEventListener('change', preference);
    win?.navigator.connection?.removeEventListener?.('change', preference);
  }, { once: true });
  return { state, reset, seek, toggle, pause() { held = true; stop(); } };
}
