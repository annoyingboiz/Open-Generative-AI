// DZ: scroll containment (package 08). One rule for the whole product: a scroll
// gesture belongs to the thing under the pointer, and the app shell never moves.
//
// CSS does most of it (app/globals.css): the page has no vertical elastic overscroll,
// and every scroller holds the vertical gesture at its end (overscroll-behavior-y:
// contain). Fixed overlays chain to the page, which does not scroll. Two things CSS
// can't do are done here:
//   1. An open drawer, dialog, picker or menu: scrolling over a part of it that has
//      nothing to scroll must do nothing (not scroll the gallery it floats over).
//   2. Controls that step on the wheel (the Camera / Lens / Aperture columns) must
//      consume the gesture, and a trackpad flick must not spin through the list.

const scrollable = (v) => v === "auto" || v === "scroll" || v === "overlay";
function canScroll(el, vertical, delta) {
  const st = getComputedStyle(el);
  if (vertical) {
    if (!scrollable(st.overflowY) || el.scrollHeight <= el.clientHeight + 1) return null;
    return delta > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
  }
  if (!scrollable(st.overflowX) || el.scrollWidth <= el.clientWidth + 1) return null;
  return delta > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0;
}

// An overlay (drawer, dialog, picker, menu, popover; Radix ones already lock scroll
// themselves): the nearest scroller under the pointer takes the gesture while it can
// move; at its end, or over a part with nothing to scroll, the gesture stops there.
// The listener sits on the overlay itself, so the rest of the app scrolls without a
// blocking wheel listener.
export function dzContainWheel(box) {
  if (!box) return () => {};
  const on = (e) => {
    if (e.defaultPrevented || e.ctrlKey) return; // handled by a control; pinch zoom stays the browser's
    const t = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!t) return;
    // A focused number or range field keeps what the browser does with the wheel.
    if (t === document.activeElement && t.matches?.('input[type="number"],input[type="range"]')) return;
    const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
    const delta = vertical ? e.deltaY : e.deltaX;
    if (!delta) return;
    for (let el = t; el; el = el.parentElement) {
      const can = canScroll(el, vertical, delta);
      if (can) return; // it scrolls; CSS keeps it from passing on at its end
      if (can === false || el === box) break; // a scroller at its end, or the overlay's edge: hold
    }
    e.preventDefault();
  };
  box.addEventListener("wheel", on, { passive: false });
  return () => box.removeEventListener("wheel", on);
}
// As a ref: ref={dzScrollBoxRef}, or call it from a ref the component already has.
export function dzScrollBoxRef(el) {
  if (el && !el.__dzWheel) el.__dzWheel = dzContainWheel(el);
}

// A wheel step control (package 08, rule 3). Mouse wheel, Magic Mouse and trackpad
// all send a stream of wheel events; a trackpad and a Magic Mouse go on sending
// them after the fingers leave (inertia). One gesture = events with no gap longer
// than GAP_MS, in one direction. Within a gesture:
//   step 1 after FIRST_PX, then each next step needs STEP_PX × (steps so far) more,
//   and at most MAX_STEPS steps. So one notch = 1 step; a short swipe ≈ 2; a long
//   flick with inertia = 4, never the whole list. A new swipe while the inertia of
//   the last one is still running (the deltas jump up again) starts a new gesture.
// Every event over the control is consumed: nothing behind it scrolls.
export const WHEEL_STEP = { GAP_MS: 180, FIRST_PX: 4, STEP_PX: 120, MAX_STEPS: 4 };
export function dzWheelStepper(el, onStep) {
  const g = { at: 0, dir: 0, acc: 0, steps: 0, last: 0, peak: 0 };
  const on = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (Math.abs(dx) > Math.abs(dy) || !dy) return; // sideways over a column: held, no step
    const now = performance.now();
    const dir = dy > 0 ? 1 : -1;
    const size = Math.abs(dy);
    // In the inertia tail (the deltas have fallen well below the gesture's peak), deltas
    // that jump up again are a new swipe.
    const tail = g.peak > 0 && g.last < g.peak * 0.3;
    const fresh = now - g.at > WHEEL_STEP.GAP_MS || dir !== g.dir || (tail && size > Math.max(8, g.last * 2));
    if (fresh) { g.dir = dir; g.acc = 0; g.steps = 0; g.peak = 0; }
    g.at = now;
    g.last = size;
    g.peak = Math.max(g.peak, size);
    if (g.steps >= WHEEL_STEP.MAX_STEPS) return;
    g.acc += size;
    const need = g.steps === 0 ? WHEEL_STEP.FIRST_PX : WHEEL_STEP.STEP_PX * g.steps;
    if (g.acc >= need) { g.acc = 0; g.steps += 1; onStep(dir); }
  };
  el.addEventListener("wheel", on, { passive: false });
  return () => el.removeEventListener("wheel", on);
}
