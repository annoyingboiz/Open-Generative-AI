"use client";

// Package 06, A2: one drop overlay for the whole app. A surface that takes files dropped
// from the computer registers itself here while it is on screen; the shell shows the shared
// overlay with that surface's words and hands the files to it. The last registered visible
// surface wins (an open picker over a working screen over the Storyboard tab).
import { useEffect, useRef } from "react";

const targets = [];

const onScreen = (el) => {
  if (!el || !el.isConnected) return false;
  if (typeof el.checkVisibility === "function") return el.checkVisibility();
  return el.getClientRects().length > 0;
};

// → { title, line(n), drop(files, point) } or null
export function dzActiveDropTarget() {
  for (let i = targets.length - 1; i >= 0; i -= 1) {
    const t = targets[i].current;
    if (t && t.enabled !== false && onScreen(t.el?.current || t.el?.())) return t;
  }
  return null;
}

// el: a ref to an element of the surface (its visibility decides); onDrop(files, { x, y }).
export function useDzDropTarget(spec) {
  const ref = useRef(spec);
  ref.current = spec;
  useEffect(() => {
    targets.push(ref);
    return () => { const i = targets.indexOf(ref); if (i >= 0) targets.splice(i, 1); };
  }, []);
}

// What is under the pointer at a drop (the overlay itself lets the pointer through).
export const dzDropHit = (point, selector) => document.elementFromPoint(point.x, point.y)?.closest?.(selector) || null;
