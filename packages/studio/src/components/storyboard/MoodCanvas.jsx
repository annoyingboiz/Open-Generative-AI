"use client";

// Moodboard canvas (package 05, §4.3) on Konva (MIT): pictures and videos, frames with a
// typed name (a frame is a group because the user drew it), sticky notes, arrows, text.
// Konva draws on a <canvas>; React only describes the scene. Pan and drag run imperatively
// (no React render per pointer move); off-screen items are not drawn; pictures load at the
// size they are shown. Undo/redo, snapping with guides, multi-select resize, z-order.
// Pan: hand tool, Space+drag, middle button or two-finger scroll. Zoom: Ctrl/⌘+wheel, pinch, the buttons.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Stage, Layer, Rect, Group, Image as KImage, Text as KText, Arrow as KArrow, Transformer, Line, Circle, RegularPolygon } from "react-konva";
import { Cursor, Hand, Square, NoteBlank, ArrowUpRight, TextT, ImageSquare, Minus, Plus, CornersOut, UploadSimple, Clipboard, Images, Sparkle, DotsThree, ArrowCounterClockwise, ArrowClockwise } from "@phosphor-icons/react";
import { dzThumb, uploadFile } from "../../api.js";
import { DropdownMenuParts, cn } from "../../ui/index.js";
import { inFrame, newItemId, sizeOf, isVideoUrl } from "../../dzFilm.js";
import { RefPicker, EmptyState, mediaUrl } from "./parts.jsx";
import { setMoodSelection } from "./assistant.js";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } = DropdownMenuParts;
const COLOR_KEYS = [["orange", "signal"], ["amber", "warning"], ["green", "success"], ["red", "destructive"], ["grey", "muted-foreground"]];
const clampZ = (z) => Math.min(4, Math.max(0.1, z));
const PIC_H = 220;
const HISTORY = 100;
const isMedia = (x) => x.type === "image" || x.type === "video";
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const ALL_ANCHORS = ["top-left", "top-center", "top-right", "middle-right", "middle-left", "bottom-left", "bottom-center", "bottom-right"];

// ── Theme tokens for the canvas (it cannot read CSS variables itself) ──
function readTokens() {
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
function useTokens() {
  const [tk, setTk] = useState(readTokens);
  useEffect(() => {
    const mo = new MutationObserver(() => setTk(readTokens()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => mo.disconnect();
  }, []);
  return tk;
}
const colorOf = (tk, c) => tk[(COLOR_KEYS.find(([k]) => k === c) || COLOR_KEYS[0])[1].replace("muted-foreground", "mutedFg")];

// ── Pictures: one HTMLImageElement per URL, shared; the bigger size replaces the smaller when ready ──
// state: loading | ok | failed. Least recently used entries go first past the limit.
const imgCache = new Map();
const IMG_LIMIT = 300;
function loadImg(src, onReady) {
  let e = imgCache.get(src);
  if (e) { imgCache.delete(src); imgCache.set(src, e); } // mark as recently used
  else {
    const img = new window.Image();
    e = { img, state: "loading", cbs: new Set() };
    const entry = e;
    img.onload = () => { entry.state = "ok"; entry.cbs.forEach((f) => f()); entry.cbs.clear(); };
    img.onerror = () => { entry.state = "failed"; entry.cbs.clear(); };
    img.src = src;
    imgCache.set(src, e);
    while (imgCache.size > IMG_LIMIT) { const [k, old] = imgCache.entries().next().value; old.cbs.clear(); imgCache.delete(k); }
  }
  let off = () => {};
  if (e.state === "loading" && onReady) { e.cbs.add(onReady); const entry = e; off = () => entry.cbs.delete(onReady); }
  return { e, off };
}
function useImg(src, fallback) {
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
// object-cover inside w×h
function coverCrop(img, w, h) {
  if (!img || !w || !h) return undefined;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const r = w / h;
  if (Math.abs(iw / ih - r) < 0.01) return undefined;
  return iw / ih > r ? { x: (iw - ih * r) / 2, y: 0, width: ih * r, height: ih } : { x: 0, y: (ih - iw / r) / 2, width: iw, height: iw / r };
}

const MediaNode = memo(function MediaNode({ it, tk, zoom }) {
  const video = it.type === "video" || isVideoUrl(it.url);
  const shownPx = it.w * zoom * (window.devicePixelRatio || 1);
  const small = dzThumb(it.url, 640);
  const src = shownPx > 700 ? dzThumb(it.url, 1280) : small;
  const img = useImg(src, small);
  const r = Math.min(6, it.w / 8);
  const crop = useMemo(() => coverCrop(img, it.w, it.h), [img, it.w, it.h]);
  return (
    <Group id={it.id} x={it.x} y={it.y}>
      {img ? <KImage image={img} width={it.w} height={it.h} cornerRadius={r} crop={crop} perfectDrawEnabled={false} />
        : <Rect width={it.w} height={it.h} cornerRadius={r} fill={tk.muted} perfectDrawEnabled={false} />}
      {video && (
        <Group x={20} y={it.h - 20} listening={false}>
          <Circle radius={12} fill={tk.overlay} />
          <RegularPolygon sides={3} radius={5.5} rotation={90} x={1} fill={tk.overlayFg} />
        </Group>
      )}
    </Group>
  );
});

const NoteNode = memo(function NoteNode({ it, tk, editing }) {
  const empty = !it.text;
  return (
    <Group id={it.id} x={it.x} y={it.y} rotation={-1.5}>
      {/* A flat offset shadow: a blurred canvas shadow costs a lot with many notes. */}
      <Rect y={3} width={it.w} height={it.h} cornerRadius={2} fill={tk.shadow} listening={false} perfectDrawEnabled={false} />
      <Rect width={it.w} height={it.h} cornerRadius={2} fill={tk.warning} perfectDrawEnabled={false} />
      {!editing && <KText x={12} y={12} width={it.w - 24} height={it.h - 24} text={it.text || "Double-click to write"} fontSize={14} lineHeight={1.35} fontFamily={tk.font} fill={tk.background} opacity={empty ? 0.5 : 1} wrap="word" ellipsis listening={false} />}
    </Group>
  );
});

const TextNode = memo(function TextNode({ it, tk, editing }) {
  return (
    <Group id={it.id} x={it.x} y={it.y}>
      <Rect width={it.w} height={it.h} fill="rgba(0,0,0,0)" perfectDrawEnabled={false} />
      {!editing && <KText width={it.w} height={it.h} text={it.text || "Text"} fontSize={18} fontStyle="600" lineHeight={1.3} fontFamily={tk.font} fill={tk.foreground} opacity={it.text ? 1 : 0.5} wrap="word" ellipsis listening={false} />}
    </Group>
  );
});

// Points are memoised: a new array on every render would make react-konva re-apply them
// and undo an arrow being dragged imperatively.
const ArrowNode = memo(function ArrowNode({ it, tk, selected, zoom }) {
  const points = useMemo(() => [it.x, it.y, it.x2, it.y2], [it.x, it.y, it.x2, it.y2]);
  return (
    <KArrow id={it.id} points={points} stroke={selected ? tk.signal : tk.foreground} fill={selected ? tk.signal : tk.foreground}
      strokeWidth={2 / Math.max(0.5, zoom)} pointerLength={12 / Math.max(0.5, zoom)} pointerWidth={10 / Math.max(0.5, zoom)} hitStrokeWidth={16 / Math.max(0.5, zoom)} lineCap="round" lineJoin="round" />
  );
});

export default function MoodCanvas({ film, edit, onOpenGroup }) {
  const items = film.mood?.items || [];
  const tk = useTokens();
  const host = useRef(null);
  const stageRef = useRef(null);
  const trRef = useRef(null);
  const overlayRef = useRef(null);
  const labelRefs = useRef(new Map());
  const [size, setSize] = useState({ w: 800, h: 600 });

  // The view is applied imperatively while panning/zooming; React gets it shortly after.
  const viewKey = `dz_mood_view_${film.id}`;
  const viewRef = useRef(null);
  if (!viewRef.current) { try { viewRef.current = JSON.parse(sessionStorage.getItem(viewKey)) || { x: 40, y: 40, z: 1 }; } catch { viewRef.current = { x: 40, y: 40, z: 1 }; } }
  const [view, setViewState] = useState(viewRef.current);
  const settle = useRef(0);
  const applyView = useCallback((v) => {
    viewRef.current = v;
    const st = stageRef.current;
    if (st) { st.position({ x: v.x, y: v.y }); st.scale({ x: v.z, y: v.z }); st.batchDraw(); }
    if (overlayRef.current) overlayRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    if (host.current) { host.current.style.backgroundSize = `${22 * v.z}px ${22 * v.z}px`; host.current.style.backgroundPosition = `${v.x}px ${v.y}px`; }
    clearTimeout(settle.current);
    settle.current = setTimeout(() => { setViewState(v); try { sessionStorage.setItem(viewKey, JSON.stringify(v)); } catch { /* optional */ } }, 120);
  }, [viewKey]);
  useEffect(() => () => clearTimeout(settle.current), []);

  const [tool, setTool] = useState("select");
  const [sel, setSel] = useState([]);
  const [marquee, setMarquee] = useState(null);
  const [draft, setDraft] = useState(null);
  const guidesRef = useRef(null); // a Konva group; guide lines are drawn into it directly, no React render
  const tkRef = useRef(null);
  const setGuides = (lines) => {
    const g = guidesRef.current;
    if (!g) return;
    if (!lines.length && !g.hasChildren()) return;
    g.destroyChildren();
    for (const l of lines) g.add(new Konva.Line({ points: l.v ? [l.at, l.from, l.at, l.to] : [l.from, l.at, l.to, l.at], stroke: tkRef.current.signal, strokeWidth: 1, strokeScaleEnabled: false, dash: [4, 4], listening: false }));
    g.getLayer()?.batchDraw();
  };
  tkRef.current = tk;
  const [editing, setEditing] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(0);
  const [space, setSpace] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => { setMoodSelection(sel.length); }, [sel.length]);
  const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));

  // Size of the canvas = the tab.
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => { applyView(viewRef.current); }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  // QA: with localStorage dz_debug set, the stage is reachable from the console (draw timing).
  useEffect(() => { try { if (localStorage.getItem("dz_debug")) window.__dzMoodStage = stageRef.current; } catch { /* optional */ } }, []);

  const frames = items.filter((x) => x.type === "frame");
  const others = useMemo(() => items.filter((x) => x.type !== "frame").sort((a, b) => (a.z || 0) - (b.z || 0)), [items]);
  const media = items.filter(isMedia);
  const empty = !items.length;

  // Only what is on screen (and one screen around it) is drawn.
  const visible = useMemo(() => {
    const v = view;
    const x0 = (-v.x - size.w) / v.z;
    const y0 = (-v.y - size.h) / v.z;
    const x1 = (-v.x + 2 * size.w) / v.z;
    const y1 = (-v.y + 2 * size.h) / v.z;
    const keep = new Set(sel);
    return (it) => {
      if (keep.has(it.id)) return true;
      const ax = it.type === "arrow" ? Math.min(it.x, it.x2) : it.x;
      const ay = it.type === "arrow" ? Math.min(it.y, it.y2) : it.y;
      const bx = it.type === "arrow" ? Math.max(it.x, it.x2) : it.x + it.w;
      const by = it.type === "arrow" ? Math.max(it.y, it.y2) : it.y + it.h;
      return bx >= x0 && ax <= x1 && by >= y0 && ay <= y1;
    };
  }, [view, size.w, size.h, sel]);

  // ── Coordinates ──
  const toWorld = useCallback((cx, cy) => {
    const r = host.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  }, []);
  const center = () => {
    const r = host.current?.getBoundingClientRect();
    return r ? toWorld(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 };
  };
  const zoomAt = (factor, cx, cy) => {
    const v = viewRef.current;
    const z = clampZ(v.z * factor);
    const r = host.current.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    applyView({ z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z });
  };
  const fit = () => {
    const r = host.current?.getBoundingClientRect();
    const list = itemsRef.current;
    if (!r || !list.length) { applyView({ x: 40, y: 40, z: 1 }); return; }
    const minX = Math.min(...list.map((i) => (i.type === "arrow" ? Math.min(i.x, i.x2) : i.x)));
    const minY = Math.min(...list.map((i) => (i.type === "arrow" ? Math.min(i.y, i.y2) : i.y)));
    const maxX = Math.max(...list.map((i) => (i.type === "arrow" ? Math.max(i.x, i.x2) : i.x + i.w)));
    const maxY = Math.max(...list.map((i) => (i.type === "arrow" ? Math.max(i.y, i.y2) : i.y + i.h)));
    const z = clampZ(Math.min((r.width - 80) / Math.max(1, maxX - minX), (r.height - 140) / Math.max(1, maxY - minY), 1.5));
    applyView({ z, x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: Math.max(30, (r.height - 90 - (maxY - minY) * z) / 2) - minY * z });
  };

  // Wheel: Ctrl/⌘ (and pinch) zoom; otherwise pan.
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const on = (e) => {
      if (e.target.closest?.("textarea,input")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
      else { const v = viewRef.current; applyView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }); }
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Saving, with undo/redo ──
  const undo = useRef([]);
  const redo = useRef([]);
  const [, bumpHistory] = useState(0);
  const setItems = (next) => edit((f) => ({ ...f, mood: { ...(f.mood || {}), items: next } }));
  const commit = (fn) => {
    const prev = itemsRef.current;
    const next = fn(prev);
    if (next === prev) return;
    undo.current.push(prev);
    if (undo.current.length > HISTORY) undo.current.shift();
    redo.current = [];
    itemsRef.current = next;
    setItems(next);
    bumpHistory((n) => n + 1);
  };
  const stepHistory = (from, to) => {
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push(itemsRef.current);
    itemsRef.current = prev;
    setItems(prev);
    const ids = new Set(prev.map((x) => x.id));
    setSel((s) => s.filter((id) => ids.has(id)));
    setEditing(null);
    bumpHistory((n) => n + 1);
  };
  const doUndo = () => stepHistory(undo, redo);
  const doRedo = () => stepHistory(redo, undo);
  const maxZ = () => Math.max(0, ...itemsRef.current.map((i) => i.z || 0));
  const addItems = (list) => commit((cur) => [...cur, ...list]);
  const setItem = (id, patch) => commit((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // Files → pictures at a point (in rows), each at its own aspect ratio.
  const place = (refs, at) => {
    const out = [];
    let x = at.x;
    let y = at.y;
    let row = 0;
    let z = maxZ();
    for (const r of refs) {
      const w = r.w && r.h ? Math.round((PIC_H * r.w) / r.h) : 300;
      if (row >= 4) { x = at.x; y += PIC_H + 16; row = 0; }
      out.push({ id: newItemId(r.kind === "video" ? "video" : "image"), type: r.kind === "video" ? "video" : "image", url: r.url, x, y, w, h: PIC_H, z: (z += 1) });
      x += w + 16;
      row += 1;
    }
    return out;
  };
  const uploadAt = async (files, at) => {
    const list = [...files].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!list.length) return;
    setBusy((n) => n + list.length);
    const refs = [];
    for (const f of list) {
      try {
        const url = mediaUrl(await uploadFile("session", f));
        const kind = f.type.startsWith("video/") ? "video" : "image";
        refs.push({ url, kind, ...(await sizeOf(url, kind)) });
      } catch (e) { notify({ type: "error", title: "Upload", message: String(e?.message || e) }); }
      setBusy((n) => Math.max(0, n - 1));
    }
    if (refs.length) addItems(place(refs, at));
  };
  const fileInput = useRef(null);
  const pasteFrom = async () => {
    try {
      const clip = await navigator.clipboard.read();
      const files = [];
      for (const c of clip) for (const t of c.types) if (t.startsWith("image/")) files.push(new File([await c.getType(t)], `pasted.${t.split("/")[1]}`, { type: t }));
      if (files.length) uploadAt(files, center());
      else notify({ type: "notice", title: "Paste", message: "No picture on the clipboard. Copy one, or press ⌘V / Ctrl+V on the canvas." });
    } catch { notify({ type: "notice", title: "Paste", message: "Press ⌘V / Ctrl+V on the canvas to paste a picture." }); }
  };
  const onScreen = () => host.current && host.current.offsetParent !== null && host.current.getClientRects().length > 0;
  useEffect(() => {
    const on = (e) => {
      if (e.target.closest?.("input,textarea,[contenteditable=true]")) return;
      // Only while the Moodboard is on screen (the tab stays mounted behind others).
      if (!onScreen()) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); uploadAt(files, center()); }
    };
    window.addEventListener("paste", on);
    return () => window.removeEventListener("paste", on);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection helpers ──
  // A frame takes what is inside it (centre inside; an arrow by its middle).
  const withMembers = (ids) => {
    const list = itemsRef.current;
    const out = new Set(ids);
    for (const f of list.filter((x) => out.has(x.id) && x.type === "frame")) {
      for (const x of list) {
        if (x.type === "frame") continue;
        const inside = x.type === "arrow" ? inFrame(f, { x: (x.x + x.x2) / 2, y: (x.y + x.y2) / 2, w: 0, h: 0 }) : inFrame(f, x);
        if (inside) out.add(x.id);
      }
    }
    return out;
  };
  const removeSel = (withPictures) => {
    const ids = new Set(selRef.current);
    const cur = itemsRef.current;
    if (withPictures) for (const f of cur.filter((x) => ids.has(x.id) && x.type === "frame")) cur.filter((x) => x.type !== "frame" && x.type !== "arrow" && inFrame(f, x)).forEach((x) => ids.add(x.id));
    commit((list) => list.filter((x) => !ids.has(x.id)));
    setSel([]);
  };
  const duplicateSel = () => {
    const ids = new Set(selRef.current);
    if (!ids.size) return;
    let z = maxZ();
    const copies = itemsRef.current.filter((x) => ids.has(x.id)).map((x) => ({ ...x, id: newItemId(x.type), x: x.x + 24, y: x.y + 24, ...(x.type === "arrow" ? { x2: x.x2 + 24, y2: x.y2 + 24 } : {}), ...(x.type === "frame" ? { name: `${x.name || "Group"} copy` } : { z: (z += 1) }) }));
    addItems(copies);
    setSel(copies.map((c) => c.id));
  };
  const reorder = (front) => {
    const ids = new Set(selRef.current.filter((id) => itemsRef.current.find((x) => x.id === id && x.type !== "frame")));
    if (!ids.size) return;
    const zs = itemsRef.current.map((x) => x.z || 0);
    let z = front ? Math.max(0, ...zs) : Math.min(0, ...zs);
    commit((list) => list.map((x) => (ids.has(x.id) ? { ...x, z: front ? (z += 1) : (z -= 1) } : x)));
  };
  const nudge = (dx, dy) => {
    const ids = withMembers(selRef.current);
    if (!ids.size) return;
    commit((list) => list.map((x) => (ids.has(x.id) ? { ...x, x: x.x + dx, y: x.y + dy, ...(x.type === "arrow" ? { x2: x.x2 + dx, y2: x.y2 + dy } : {}) } : x)));
  };

  // Keys.
  useEffect(() => {
    const down = (e) => {
      if (e.target.closest?.("input,textarea,[contenteditable=true]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && k === "y") { e.preventDefault(); doRedo(); return; }
      if (mod && k === "a") { e.preventDefault(); setSel(itemsRef.current.map((x) => x.id)); return; }
      if (mod && k === "d") { e.preventDefault(); duplicateSel(); return; }
      if (k === "]" ) { e.preventDefault(); reorder(true); return; }
      if (k === "[") { e.preventDefault(); reorder(false); return; }
      if (e.key.startsWith("Arrow") && selRef.current.length) {
        e.preventDefault();
        const s = e.shiftKey ? 10 : 1;
        nudge(e.key === "ArrowLeft" ? -s : e.key === "ArrowRight" ? s : 0, e.key === "ArrowUp" ? -s : e.key === "ArrowDown" ? s : 0);
        return;
      }
      if (mod) return;
      if (e.key === " " && !space) { setSpace(true); e.preventDefault(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selRef.current.length) { e.preventDefault(); removeSel(false); }
      if (e.key === "Escape") { setSel([]); setTool("select"); }
      if (k === "v") setTool("select");
      if (k === "h") setTool("hand");
      if (k === "f") setTool("frame");
      if (k === "n") setTool("note");
      if (k === "a") setTool("arrow");
      if (k === "t") setTool("text");
    };
    const up = (e) => { if (e.key === " ") setSpace(false); };
    const el = host.current;
    el?.addEventListener("keydown", down);
    el?.addEventListener("keyup", up);
    return () => { el?.removeEventListener("keydown", down); el?.removeEventListener("keyup", up); };
  });

  // ── Transformer: resize one or many (pictures keep their ratio) ──
  const selItems = items.filter((x) => sel.includes(x.id));
  const resizable = selItems.filter((x) => x.type !== "arrow");
  // Pictures never stretch: any picture in the selection locks the ratio for all.
  const keepRatio = resizable.some(isMedia);
  useEffect(() => {
    const tr = trRef.current;
    const st = stageRef.current;
    if (!tr || !st) return;
    if (tr.isTransforming()) return; // never reset the handles mid-resize
    const nodes = editing ? [] : resizable.map((x) => st.findOne(`#${x.id}`)).filter(Boolean);
    const cur = tr.nodes();
    if (cur.length === nodes.length && cur.every((n, i) => n === nodes[i])) { tr.forceUpdate(); return; }
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }); // after every render: nodes may have been culled or re-created
  const onTransformEnd = () => {
    const tr = trRef.current;
    const changes = {};
    for (const n of tr.nodes()) {
      const it = itemsRef.current.find((x) => x.id === n.id());
      if (!it) continue;
      const sx = n.scaleX();
      const sy = n.scaleY();
      const w = Math.max(30, it.w * sx);
      const h = Math.max(24, keepRatio || isMedia(it) ? w * (it.h / it.w) : it.h * sy);
      changes[it.id] = { x: n.x(), y: n.y(), w, h };
      n.scale({ x: 1, y: 1 });
    }
    commit((list) => list.map((x) => (changes[x.id] ? { ...x, ...changes[x.id] } : x)));
  };

  // ── Hit test: the item under the pointer (or a transformer handle) ──
  const hitAt = (evt) => {
    const st = stageRef.current;
    if (!st) return { id: null };
    st.setPointersPositions(evt);
    const pos = st.getPointerPosition();
    let n = pos ? st.getIntersection(pos) : null;
    if (!n) return { id: null };
    if (n.getParent()?.getClassName?.() === "Transformer" || String(n.name()).includes("_anchor")) return { handle: true };
    if (n.name() === "arrow-end") return { end: n.getAttr("end"), arrow: n.getAttr("arrow") };
    while (n && n !== st && !(n.id() && itemsRef.current.some((x) => x.id === n.id()))) n = n.getParent();
    return { id: n && n !== st ? n.id() : null };
  };

  // ── Snapping: the moving box's edges and centre to other items' edges and centres ──
  const snap = (box, skip) => {
    if (!box) return { dx: 0, dy: 0, lines: [] };
    const T = 6 / viewRef.current.z;
    const xs = [];
    const ys = [];
    for (const it of itemsRef.current) {
      if (skip.has(it.id) || it.type === "arrow") continue;
      xs.push(it.x, it.x + it.w / 2, it.x + it.w);
      ys.push(it.y, it.y + it.h / 2, it.y + it.h);
    }
    const best = (vals, cands) => {
      let b = null;
      for (const v of vals) for (const c of cands) { const d = c - v; if (Math.abs(d) <= T && (!b || Math.abs(d) < Math.abs(b.d))) b = { d, at: c }; }
      return b;
    };
    const bx = best([box.x, box.x + box.w / 2, box.x + box.w], xs);
    const by = best([box.y, box.y + box.h / 2, box.y + box.h], ys);
    const dx = bx ? bx.d : 0;
    const dy = by ? by.d : 0;
    const lines = [];
    if (bx) lines.push({ v: true, at: bx.at, from: box.y + dy - 40, to: box.y + dy + box.h + 40 });
    if (by) lines.push({ v: false, at: by.at, from: box.x + dx - 40, to: box.x + dx + box.w + 40 });
    return { dx, dy, lines };
  };

  // ── Pointer: select / move / draw / pan / marquee ──
  const drag = useRef(null);
  const endDrag = useRef(null);
  const listen = () => {
    const move = (e) => onMove(e);
    const up = (e) => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); onUp(e); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    endDrag.current = up;
  };
  useEffect(() => () => endDrag.current?.({}), []);

  const onDown = (e) => {
    // A click outside the field being edited ends the edit through its blur (which saves it).
    if (editing) { if (!e.target.closest?.("textarea,input")) { const a = document.activeElement; if (a?.closest?.("[data-overlay-ui]")) a.blur(); else setEditing(null); } return; }
    // Menus open in a portal; their events still bubble here through React — not canvas clicks.
    if (!host.current?.contains(e.target) || e.target.closest?.("[data-overlay-ui]")) return;
    host.current?.focus({ preventScroll: true });
    const hand = tool === "hand" || space || e.button === 1;
    if (hand) { drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, v: viewRef.current }; setDragging(true); listen(); return; }
    if (e.button !== 0) return;
    const p = toWorld(e.clientX, e.clientY);
    if (tool === "frame" || tool === "arrow") { const r = { type: tool, x: p.x, y: p.y, x2: p.x, y2: p.y }; drag.current = { kind: tool, p, r }; setDraft(r); listen(); return; }
    if (tool === "note" || tool === "text") {
      e.preventDefault(); // keep the focus for the note's text field
      const it = tool === "note"
        ? { id: newItemId("note"), type: "note", x: p.x - 90, y: p.y - 60, w: 180, h: 120, text: "", color: "amber", z: maxZ() + 1 }
        : { id: newItemId("text"), type: "text", x: p.x, y: p.y - 14, w: 260, h: 36, text: "", z: maxZ() + 1 };
      addItems([it]);
      setSel([it.id]);
      setEditing(it.id);
      setTool("select");
      return;
    }
    const hit = hitAt(e.nativeEvent);
    if (hit.handle) return; // the transformer resizes
    if (hit.end) {
      const it = itemsRef.current.find((x) => x.id === hit.arrow);
      drag.current = { kind: "end", id: hit.arrow, end: hit.end, start: { ...it } };
      setDragging(true);
      listen();
      return;
    }
    if (hit.id) {
      const cur = selRef.current;
      const ids = cur.includes(hit.id) ? (e.shiftKey ? cur.filter((x) => x !== hit.id) : cur) : e.shiftKey ? [...cur, hit.id] : [hit.id];
      setSel(ids);
      if (!ids.includes(hit.id)) return;
      const list = itemsRef.current;
      const moving = withMembers(ids);
      const ms = list.filter((x) => moving.has(x.id));
      const boxes = ms.filter((x) => x.type !== "arrow");
      const box = boxes.length ? { x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)), w: Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)), h: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)) } : null;
      drag.current = { kind: "move", p, ids: [...moving], start: Object.fromEntries(ms.map((x) => [x.id, { ...x }])), box, moved: false, d: { x: 0, y: 0 } };
      listen();
      return;
    }
    // Empty canvas: a marquee.
    if (!e.shiftKey) setSel([]);
    drag.current = { kind: "marquee", p, add: e.shiftKey ? selRef.current : [] };
    setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
    listen();
  };

  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") { applyView({ ...d.v, x: d.v.x + e.clientX - d.sx, y: d.v.y + e.clientY - d.sy }); return; }
    const p = toWorld(e.clientX, e.clientY);
    if (d.kind === "marquee") {
      const m = { x: Math.min(d.p.x, p.x), y: Math.min(d.p.y, p.y), w: Math.abs(p.x - d.p.x), h: Math.abs(p.y - d.p.y) };
      setMarquee(m);
      const hit = itemsRef.current.filter((x) => (x.type === "arrow"
        ? Math.min(x.x, x.x2) >= m.x && Math.max(x.x, x.x2) <= m.x + m.w && Math.min(x.y, x.y2) >= m.y && Math.max(x.y, x.y2) <= m.y + m.h
        : x.x < m.x + m.w && x.x + x.w > m.x && x.y < m.y + m.h && x.y + x.h > m.y)).map((x) => x.id);
      setSel([...new Set([...d.add, ...hit])]);
      return;
    }
    if (d.kind === "frame" || d.kind === "arrow") { d.r = { ...d.r, x2: p.x, y2: p.y }; setDraft(d.r); return; }
    if (d.kind === "end") {
      const st = stageRef.current;
      const n = st?.findOne(`#${d.id}`);
      const pts = d.end === "a" ? [p.x, p.y, d.start.x2, d.start.y2] : [d.start.x, d.start.y, p.x, p.y];
      n?.points(pts);
      d.pts = pts;
      st?.findOne(`#end-${d.end}`)?.position({ x: p.x, y: p.y });
      n?.getLayer()?.batchDraw();
      return;
    }
    if (d.kind === "move") {
      let dx = p.x - d.p.x;
      let dy = p.y - d.p.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3 / viewRef.current.z) return;
      if (!d.moved) { d.moved = true; setDragging(true); }
      let lines = [];
      if (!(e.metaKey || e.ctrlKey) && d.box) {
        const s = snap({ ...d.box, x: d.box.x + dx, y: d.box.y + dy }, new Set(d.ids));
        dx += s.dx;
        dy += s.dy;
        lines = s.lines;
      }
      d.d = { x: dx, y: dy };
      const st = stageRef.current;
      for (const id of d.ids) {
        const s0 = d.start[id];
        const n = st?.findOne(`#${id}`);
        if (s0.type === "arrow") n?.points([s0.x + dx, s0.y + dy, s0.x2 + dx, s0.y2 + dy]);
        else n?.position({ x: s0.x + dx, y: s0.y + dy });
        const lab = labelRefs.current.get(id);
        if (lab) { lab.style.left = `${s0.x + dx}px`; lab.style.top = `${s0.y + dy}px`; }
      }
      st?.batchDraw();
      setGuides(lines);
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    setGuides([]);
    if (!d) return;
    if (d.kind === "marquee") { setMarquee(null); return; }
    if (d.kind === "end") {
      if (d.pts) setItem(d.id, { x: d.pts[0], y: d.pts[1], x2: d.pts[2], y2: d.pts[3] });
      return;
    }
    if (d.kind === "frame") {
      const r = d.r;
      setDraft(null);
      setTool("select");
      const x = Math.min(r.x, r.x2); const y = Math.min(r.y, r.y2); const w = Math.abs(r.x2 - r.x); const h = Math.abs(r.y2 - r.y);
      if (w < 30 || h < 30) return;
      const n = itemsRef.current.filter((i) => i.type === "frame").length;
      const it = { id: newItemId("frame"), type: "frame", x, y, w, h, name: `Group ${n + 1}`, color: COLOR_KEYS[n % COLOR_KEYS.length][0] };
      addItems([it]);
      setSel([it.id]);
      setEditing(it.id);
      return;
    }
    if (d.kind === "arrow") {
      const r = d.r;
      setDraft(null);
      setTool("select");
      if (Math.hypot(r.x2 - r.x, r.y2 - r.y) >= 12) addItems([{ id: newItemId("arrow"), type: "arrow", x: r.x, y: r.y, x2: r.x2, y2: r.y2, w: 0, h: 0, z: maxZ() + 1 }]);
      return;
    }
    if (d.kind === "move" && d.moved) {
      const { x: dx, y: dy } = d.d;
      const moved = new Set(d.ids);
      commit((list) => list.map((x) => (moved.has(x.id) ? { ...x, x: x.x + dx, y: x.y + dy, ...(x.type === "arrow" ? { x2: x.x2 + dx, y2: x.y2 + dy } : {}) } : x)));
    }
  };

  const onDouble = (e) => {
    if (!host.current?.contains(e.target) || e.target.closest?.("[data-overlay-ui]")) return;
    const hit = hitAt(e.nativeEvent);
    const it = hit.id && itemsRef.current.find((x) => x.id === hit.id);
    if (it && (it.type === "note" || it.type === "text" || it.type === "frame")) { setSel([it.id]); setEditing(it.id); }
  };

  // Files dropped from the computer: where they land (inside a frame = in that group).
  const [over, setOver] = useState(false);
  const selFrame = sel.length === 1 ? frames.find((f) => f.id === sel[0]) : null;
  const countIn = (f) => media.filter((x) => inFrame(f, x)).length;
  const editItem = editing && items.find((x) => x.id === editing);
  const selArrow = sel.length === 1 ? items.find((x) => x.id === sel[0] && x.type === "arrow") : null;
  const cursor = tool === "hand" || space ? (dragging && drag.current?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";
  const z = view.z;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <input ref={fileInput} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) uploadAt(f, center()); }} />
      <div ref={host} tabIndex={0} aria-label="Moodboard canvas" className={cn("absolute inset-0 overflow-hidden outline-none", over && "bg-accent/30")}
        style={{ cursor, backgroundImage: "radial-gradient(hsl(var(--border)) 1px, transparent 1px)", backgroundSize: `${22 * view.z}px ${22 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={onDown} onDoubleClick={onDouble}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={(e) => { setOver(false); if (e.dataTransfer.files?.length) { e.preventDefault(); uploadAt([...e.dataTransfer.files], toWorld(e.clientX, e.clientY)); } }}>
        <Stage ref={stageRef} width={size.w} height={size.h} x={viewRef.current.x} y={viewRef.current.y} scaleX={viewRef.current.z} scaleY={viewRef.current.z}>
          <Layer>
            {frames.filter(visible).map((f) => (
              <Rect key={f.id} id={f.id} x={f.x} y={f.y} width={f.w} height={f.h} cornerRadius={14} stroke={sel.includes(f.id) ? tk.signal : tk.input} strokeWidth={1} strokeScaleEnabled={false} fill="rgba(0,0,0,0)" perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
            ))}
            {others.filter(visible).map((it) => (
              isMedia(it) ? <MediaNode key={it.id} it={it} tk={tk} zoom={z} />
                : it.type === "note" ? <NoteNode key={it.id} it={it} tk={tk} editing={editing === it.id} />
                  : it.type === "text" ? <TextNode key={it.id} it={it} tk={tk} editing={editing === it.id} />
                    : it.type === "arrow" ? <ArrowNode key={it.id} it={it} tk={tk} zoom={z} selected={sel.includes(it.id)} /> : null
            ))}
          </Layer>
          <Layer>
            {draft?.type === "frame" && <Rect x={Math.min(draft.x, draft.x2)} y={Math.min(draft.y, draft.y2)} width={Math.abs(draft.x2 - draft.x)} height={Math.abs(draft.y2 - draft.y)} cornerRadius={14} stroke={tk.signal} dash={[6, 4]} strokeWidth={1} strokeScaleEnabled={false} listening={false} />}
            {draft?.type === "arrow" && <KArrow points={[draft.x, draft.y, draft.x2, draft.y2]} stroke={tk.foreground} fill={tk.foreground} strokeWidth={2 / Math.max(0.5, z)} pointerLength={12 / Math.max(0.5, z)} pointerWidth={10 / Math.max(0.5, z)} listening={false} />}
            {marquee && <Rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} stroke={tk.signal} fill={tk.signalSoft} strokeWidth={1} strokeScaleEnabled={false} listening={false} />}
            <Group ref={guidesRef} listening={false} />
            {selArrow && !dragging && [["a", selArrow.x, selArrow.y], ["b", selArrow.x2, selArrow.y2]].map(([end, x, y]) => (
              <Circle key={end} id={`end-${end}`} name="arrow-end" end={end} arrow={selArrow.id} x={x} y={y} radius={5 / z} fill={tk.background} stroke={tk.signal} strokeWidth={1.5} strokeScaleEnabled={false} />
            ))}
            {selArrow && dragging && drag.current?.kind === "end" && <Circle id={`end-${drag.current.end}`} x={drag.current.end === "a" ? selArrow.x : selArrow.x2} y={drag.current.end === "a" ? selArrow.y : selArrow.y2} radius={5 / z} fill={tk.background} stroke={tk.signal} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />}
            <Transformer ref={trRef} rotateEnabled={false} keepRatio={keepRatio} flipEnabled={false} ignoreStroke
              enabledAnchors={keepRatio ? CORNERS : ALL_ANCHORS}
              anchorSize={8} anchorCornerRadius={2} anchorStroke={tk.signal} anchorFill={tk.background} borderStroke={tk.signal} borderStrokeWidth={1}
              boundBoxFunc={(oldBox, box) => (Math.abs(box.width) < 30 || Math.abs(box.height) < 24 ? oldBox : box)}
              onTransformStart={() => setDragging(true)} onTransformEnd={() => { setDragging(false); onTransformEnd(); }} />
          </Layer>
        </Stage>

        {/* HTML on top of the canvas, in canvas coordinates: frame names, the group bar, text being edited. */}
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" ref={overlayRef} style={{ transform: `translate(${viewRef.current.x}px, ${viewRef.current.y}px) scale(${viewRef.current.z})` }}>
          {frames.filter(visible).map((f) => (
            <div key={f.id} ref={(el) => { if (el) labelRefs.current.set(f.id, el); else labelRefs.current.delete(f.id); }} className="absolute" style={{ left: f.x, top: f.y }}>
              <div className="absolute bottom-0 left-0 mb-2 flex items-center gap-2 whitespace-nowrap" style={{ transform: `scale(${1 / z})`, transformOrigin: "bottom left" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(tk, f.color) }} />
                {editing === f.id ? (
                  <input data-overlay-ui autoFocus defaultValue={f.name} maxLength={60} onFocus={(e) => e.target.select()} onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value.trim() !== f.name) setItem(f.id, { name: e.target.value.trim() }); }}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = f.name; e.currentTarget.blur(); } }}
                    className="pointer-events-auto w-48 rounded-sm bg-background px-1 text-base font-semibold outline-none ring-1 ring-ring" />
                ) : <span className="text-base font-semibold">{f.name || "Group"}</span>}
                <span className="text-base text-muted-foreground">{countIn(f)}</span>
              </div>
            </div>
          ))}
          {editItem && (editItem.type === "note" || editItem.type === "text") && (
            <textarea data-overlay-ui key={editItem.id} ref={focusOnce} defaultValue={editItem.text}
              onBlur={(e) => { const text = e.target.value; setEditing(null); if (!text.trim() && editItem.type === "text") commit((l) => l.filter((x) => x.id !== editItem.id)); else if (text !== editItem.text) setItem(editItem.id, { text }); }}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.currentTarget.value = editItem.text || ""; e.currentTarget.blur(); } }}
              placeholder={editItem.type === "note" ? "Note…" : "Text"}
              className={cn("pointer-events-auto absolute resize-none bg-transparent outline-none", editItem.type === "note" ? "p-3 text-base leading-snug" : "text-lg font-semibold")}
              style={{ left: editItem.x, top: editItem.y, width: editItem.w, height: editItem.h, color: editItem.type === "note" ? tk.background : undefined, transform: editItem.type === "note" ? "rotate(-1.5deg)" : undefined, transformOrigin: "top left" }} />
          )}
          {selFrame && !dragging && !editing && (
            <div data-overlay-ui className="pointer-events-auto absolute flex items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-popover p-1 shadow-popover" style={{ left: selFrame.x, top: selFrame.y + selFrame.h + 8 / z, transform: `scale(${1 / z})`, transformOrigin: "top left" }}>
              <button type="button" onClick={() => onOpenGroup(selFrame.id)} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"><Sparkle size={14} /> Generate from this group</button>
              <button type="button" onClick={() => setEditing(selFrame.id)} className="h-8 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Rename</button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" aria-label="Group menu" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><DotsThree size={16} weight="bold" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <div className="flex gap-1 px-1 py-1">{COLOR_KEYS.map(([k]) => (
                    <DropdownMenuItem key={k} aria-label={`Colour: ${k}`} onSelect={() => setItem(selFrame.id, { color: k })} className="h-7 w-7 justify-center p-0">
                      <span className={cn("h-5 w-5 rounded-full", selFrame.color === k && "ring-2 ring-foreground ring-offset-2 ring-offset-popover")} style={{ background: colorOf(tk, k) }} />
                    </DropdownMenuItem>
                  ))}</div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => removeSel(false)}>Delete the group (keep pictures)</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => removeSel(true)}>Delete with its pictures</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-16">
          <div className="pointer-events-auto">
            <EmptyState icon={ImageSquare} title="Drop pictures anywhere" text="This is your canvas. Bring references from your computer or paste them, then move them around, frame groups and draw arrows.">
              <button type="button" onClick={() => fileInput.current?.click()} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><UploadSimple size={14} /> Upload pictures</button>
              <button type="button" onClick={pasteFrom} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><Clipboard size={14} /> Paste from clipboard</button>
              <button type="button" onClick={() => setPicker(true)} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><Images size={14} /> Pick from my library</button>
            </EmptyState>
          </div>
        </div>
      )}
      {busy > 0 && <span className="absolute left-4 top-4 rounded-full bg-popover px-3 py-1 text-sm text-muted-foreground shadow-popover">Uploading {busy}…</span>}

      {/* Toolbar, bottom centre */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-float" role="toolbar" aria-label="Canvas tools">
        {[["select", Cursor, "Select (V)"], ["hand", Hand, "Pan (H, or hold Space)"]].map(([k, Icon, label]) => <Tool key={k} on={tool === k} label={label} onClick={() => setTool(k)}><Icon size={17} /></Tool>)}
        <span className="mx-1 h-5 w-px bg-border" />
        {[["frame", Square, "Frame — a group (F)"], ["note", NoteBlank, "Sticky note (N)"], ["arrow", ArrowUpRight, "Arrow (A)"], ["text", TextT, "Text (T)"]].map(([k, Icon, label]) => <Tool key={k} on={tool === k} label={label} onClick={() => setTool(k)}><Icon size={17} /></Tool>)}
        <span className="mx-1 h-5 w-px bg-border" />
        <Tool label="Pictures: uploads and library" onClick={() => setPicker(true)}><ImageSquare size={17} /></Tool>
      </div>
      {/* Undo / redo and zoom, bottom right */}
      <div className="absolute bottom-6 right-6 flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-float">
        <Tool label="Undo (⌘Z)" onClick={doUndo} disabled={!undo.current.length}><ArrowCounterClockwise size={15} /></Tool>
        <Tool label="Redo (⇧⌘Z)" onClick={doRedo} disabled={!redo.current.length}><ArrowClockwise size={15} /></Tool>
        <span className="mx-1 h-5 w-px bg-border" />
        <Tool label="Zoom out" onClick={() => zoomAt(1 / 1.2)}><Minus size={15} /></Tool>
        <button type="button" onClick={() => zoomAt(1 / viewRef.current.z)} className="h-8 w-14 rounded-md text-sm tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground">{Math.round(view.z * 100)}%</button>
        <Tool label="Zoom in" onClick={() => zoomAt(1.2)}><Plus size={15} /></Tool>
        <Tool label="Fit everything" onClick={fit}><CornersOut size={15} /></Tool>
      </div>

      <RefPicker open={picker} onClose={() => setPicker(false)} refs={[]} onChange={() => {}} title="Pictures for the Moodboard" onPickNew={(refs) => addItems(place(refs, center()))} />
    </div>
  );
}

// Focus a field that appears under the pointer once the click that made it is over.
const focusOnce = (el) => { if (el && !el.dataset.focused) { el.dataset.focused = "1"; setTimeout(() => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 0); } };

const Tool = ({ on, label, onClick, disabled, children }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={on} disabled={disabled}
    className={cn("flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-state disabled:opacity-35 disabled:hover:bg-transparent", on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>{children}</button>
);
