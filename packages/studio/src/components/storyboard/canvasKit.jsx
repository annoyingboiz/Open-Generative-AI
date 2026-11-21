"use client";

// The canvas kit (package 05 Moodboard, shared with the picture editor in package 12):
// theme tokens for Konva, the shared picture cache, the wheel / pinch gestures and the
// toolbar button. One implementation, used by both canvases.
import { useEffect, useState } from "react";
import { cn } from "../../ui/index.js";

// ── Theme tokens for the canvas (it cannot read CSS variables itself) ──
export function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const hsl = (name, a = 1) => {
    const [h = "0", s = "0%", l = "50%"] = cs.getPropertyValue(`--${name}`).trim().split(/\s+/);
    return a === 1 ? `hsl(${h}, ${s}, ${l})` : `hsla(${h}, ${s}, ${l}, ${a})`;
  };
  return {
    signal: hsl("signal"), signalSoft: hsl("signal", 0.1), warning: hsl("warning"), success: hsl("success"), destructive: hsl("destructive"),
    foreground: hsl("foreground"), muted: hsl("muted"), mutedFg: hsl("muted-foreground"), background: hsl("background"),
    border: hsl("border"), input: hsl("input"), overlay: hsl("overlay", 0.6), overlayFg: hsl("overlay-foreground"), shadow: hsl("overlay", 0.25),
    font: getComputedStyle(document.body).fontFamily || "sans-serif",
  };
}
export function useTokens() {
  const [tk, setTk] = useState(readTokens);
  useEffect(() => {
    const mo = new MutationObserver(() => setTk(readTokens()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => mo.disconnect();
  }, []);
  return tk;
}
// ── Pictures: one HTMLImageElement per URL, shared; the bigger size replaces the smaller when ready ──
// state: loading | ok | failed. Least recently used entries go first past the limit.
export const imgCache = new Map();
const IMG_LIMIT = 300;
// Evict the least recently used pictures that no tile on screen holds, down to the limit.
function trimImgCache(keep = null) {
  for (const [k, old] of imgCache) { if (imgCache.size <= IMG_LIMIT) break; if (!old.users && k !== keep) imgCache.delete(k); }
}
export function loadImg(src, onReady) {
  let e = imgCache.get(src);
  if (e) { imgCache.delete(src); imgCache.set(src, e); } // mark as recently used
  else {
    const img = new window.Image();
    e = { img, state: "loading", cbs: new Set(), users: 0 };
    const entry = e;
    img.onload = () => { entry.state = "ok"; entry.cbs.forEach((f) => f()); entry.cbs.clear(); };
    img.onerror = () => { entry.state = "failed"; entry.cbs.clear(); };
    img.src = src;
    imgCache.set(src, e);
    trimImgCache(src);
  }
  e.users += 1;
  const entry = e;
  if (e.state === "loading" && onReady) e.cbs.add(onReady);
  const off = () => { entry.users = Math.max(0, entry.users - 1); if (onReady) entry.cbs.delete(onReady); if (!entry.users) trimImgCache(); };
  return { e, off };
}
export function useImg(src, fallback) {
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    const a = loadImg(src, bump);
    const b = fallback && fallback !== src ? loadImg(fallback, bump) : null;
    return () => { a.off(); b?.off(); };
  }, [src, fallback]);
  const e = imgCache.get(src);
  if (e?.state === "ok") return e.img;
  const f = fallback && imgCache.get(fallback);
  return f?.state === "ok" ? f.img : null;
}

// Wheel: Ctrl/⌘ (and pinch) zoom; otherwise pan. Every gesture over the canvas is
// the canvas's (package 08, rule 5): no page bounce, no browser zoom, no Back / Forward.
// A field being edited scrolls its own text and holds the gesture at its end: a
// gesture that starts in a field never pans the canvas.
// Listeners are installed once; they call the latest zoomAt / applyView through a ref
// (fns.current = { zoomAt, applyView, view }), so a re-render during a pinch does not lose it.
export function useCanvasGestures(host, fns) {
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    let pinch = null; // Safari: pinch comes as gesture events, not as Ctrl + wheel
    const on = (e) => {
      const { zoomAt: zoom, applyView: apply, view } = fns.current;
      const field = e.target.closest?.("textarea,input,[contenteditable=true]");
      if (field && !e.ctrlKey && !e.metaKey) {
        const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
        const d = vertical ? e.deltaY : e.deltaX;
        const can = vertical
          ? (d > 0 ? field.scrollTop + field.clientHeight < field.scrollHeight - 1 : field.scrollTop > 0)
          : (d > 0 ? field.scrollLeft + field.clientWidth < field.scrollWidth - 1 : field.scrollLeft > 0);
        if (!can) e.preventDefault();
        return;
      }
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { if (!pinch) zoom(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY); }
      else { const v = view(); apply({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }); }
    };
    const start = (e) => { e.preventDefault(); pinch = { s: 1 }; };
    const change = (e) => {
      e.preventDefault();
      if (!pinch || !e.scale) return;
      fns.current.zoomAt(e.scale / pinch.s, e.clientX, e.clientY);
      pinch.s = e.scale;
    };
    const end = (e) => { e.preventDefault(); pinch = null; };
    el.addEventListener("wheel", on, { passive: false });
    el.addEventListener("gesturestart", start, { passive: false });
    el.addEventListener("gesturechange", change, { passive: false });
    el.addEventListener("gestureend", end, { passive: false });
    return () => {
      el.removeEventListener("wheel", on);
      el.removeEventListener("gesturestart", start);
      el.removeEventListener("gesturechange", change);
      el.removeEventListener("gestureend", end);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// A toolbar button of the floating canvas toolbar.
export const Tool = ({ on, label, onClick, disabled, children }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={on} disabled={disabled}
    className={cn("flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-state disabled:opacity-35 disabled:hover:bg-transparent", on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>{children}</button>
);
