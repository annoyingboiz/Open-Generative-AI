"use client";

// Package 06, A2: one drop overlay for the whole app. A surface that takes files dropped
// from the computer registers itself here while it is on screen; the shell shows the shared
// overlay with that surface's words and hands the files to it. The last registered visible
// surface wins (an open picker over a working screen over the Storyboard tab).
import { useEffect, useRef, useState } from "react";

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

// Package 09, P4: a picture dragged inside the app (a gallery tile, a reference of the
// shot) towards a composer slot. One at a time; composers listen to highlight the slot
// groups that can take it and to open themselves if they were folded.
//   { url, kind: "image" | "video", name?, label? } while dragging, else null.
let picture = null;
const EVT = "dz:picture-drag";
export function dzPictureDragStart(p) {
  picture = p && p.url ? { url: p.url, kind: p.kind === "video" ? "video" : "image", name: p.name || "", ...(p.label ? { label: p.label } : {}) } : null;
  if (!picture) return;
  window.dispatchEvent(new CustomEvent(EVT, { detail: picture }));
  // Ends with the drag, wherever it ends (a drop anywhere, Escape, leaving the window).
  const end = () => { window.removeEventListener("dragend", end, true); window.removeEventListener("drop", later, true); dzPictureDragEnd(); };
  const later = () => setTimeout(end, 0); // after the drop handlers have read it
  window.addEventListener("dragend", end, true);
  window.addEventListener("drop", later, true);
}
export function dzPictureDragEnd() {
  if (!picture) return;
  picture = null;
  window.dispatchEvent(new CustomEvent(EVT, { detail: null }));
}
export const dzPictureDrag = () => picture;
export function useDzPictureDrag() {
  const [p, setP] = useState(picture);
  useEffect(() => {
    const on = (e) => setP(e.detail || null);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return p;
}
