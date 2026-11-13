// @ts-check
/** @param {number} dx @param {number} dy */
function gestureIntent(dx, dy) {
  if (dy > 8 && dy > dx) return "vertical";
  if (dx > 6 && dx > dy) return "horizontal";
  return "pending";
}
/** Directional intent preserves vertical page scrolling. Capture starts only after a horizontal
 * gesture, and document-level release/cancel handles a finger ending outside the chart.
 * @param {HTMLElement} plot @param {{selectX:(x:number)=>void, reset:()=>void,
 * key:(key:string)=>void, enabled:()=>boolean}} host */
export function bindPortfolioInteraction(plot, host) {
  const abort = new AbortController(), options = { signal: abort.signal };
  /** @type {{id:number,x:number,y:number,active:boolean}|null} */
  let gesture = null;
  const select = (/** @type {PointerEvent} */ ev) =>
    host.selectX(ev.clientX - plot.getBoundingClientRect().left);
  plot.addEventListener("pointerdown", (ev) => {
    if (!host.enabled() || (ev.pointerType === "mouse" && ev.button !== 0)) return;
    gesture = { id: ev.pointerId, x: ev.clientX, y: ev.clientY,
      active: ev.pointerType === "mouse" };
    if (gesture.active) { plot.setPointerCapture(ev.pointerId); select(ev); }
  }, options);
  /** @param {PointerEvent} ev */
  function moveGesture(ev) {
    if (!gesture || gesture.id !== ev.pointerId) return;
    const dx = Math.abs(ev.clientX - gesture.x), dy = Math.abs(ev.clientY - gesture.y);
    if (!gesture.active) {
      const intent = gestureIntent(dx, dy);
      if (intent === "vertical") { gesture = null; host.reset(); return; }
      if (intent === "horizontal") { gesture.active = true; plot.setPointerCapture(ev.pointerId); }
    }
    if (!gesture.active) return;
    if (ev.cancelable) ev.preventDefault();
    select(ev);
  }
  plot.addEventListener("pointermove", (ev) => {
    if (!host.enabled()) return;
    if (ev.pointerType === "mouse" && !gesture) { select(ev); return; }
    moveGesture(ev);
  }, { ...options, passive: false });
  const release = (/** @type {Event & {pointerId?:number}} */ ev) => {
    if (gesture && ev.pointerId !== undefined && ev.pointerId !== gesture.id) return;
    const id = gesture?.id;
    gesture = null;
    if (id !== undefined && plot.hasPointerCapture(id)) plot.releasePointerCapture(id);
    host.reset();
  };
  window.addEventListener("pointerup", release, options);
  window.addEventListener("pointercancel", release, options);
  window.addEventListener("blur", release, options);
  plot.addEventListener("lostpointercapture", (ev) => {
    // A queued lost event may precede a new capture on the same node. Pending capture still
    // belongs here; only a real loss of this gesture should end its historical selection.
    if (gesture?.id !== ev.pointerId || plot.hasPointerCapture(ev.pointerId)) return;
    gesture = null; host.reset();
  }, options);
  plot.addEventListener("pointerleave", (ev) => {
    if (ev.pointerType === "mouse" && !gesture) host.reset();
  }, options);
  plot.addEventListener("keydown", (ev) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(ev.key)) return;
    if (!host.enabled()) return;
    ev.preventDefault(); host.key(ev.key);
  }, options);
  plot.addEventListener("blur", host.reset, options);
  return { active: () => gesture !== null,
    destroy: () => { gesture = null; abort.abort(); } };
}
