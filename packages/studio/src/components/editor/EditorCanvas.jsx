"use client";

// The picture editor's canvas (package 12, E1–E3). Konva, with the Moodboard's canvas kit:
// the same wheel / pinch / Space-drag gestures, the same picture cache and theme tokens, the
// same selection handles. Coordinates are the base picture's own pixels; the view only moves
// and scales them. Pan and drag run imperatively (no React render per pointer move).
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { Stage, Layer, Rect, Group, Image as KImage, Arrow as KArrow, Line, Circle, Transformer } from "react-konva";
import { dzThumb } from "../../api.js";
import { useTokens, useImg, useCanvasGestures } from "../storyboard/canvasKit.jsx";
import { markHex, NUMBER_FILL, NUMBER_TEXT } from "./editorModel.mjs";
import { boundsOf } from "./editorPictures.js";

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const ALL_ANCHORS = ["top-left", "top-center", "top-right", "middle-right", "middle-left", "bottom-left", "bottom-center", "bottom-right"];
const ZOOM_MAX = 8; // 800 % of the fitted size
const ZOOM_MIN = 0.25;

// The base (or a version) as shown: a screen-size copy, the original once zoomed past it.
const PictureNode = memo(function PictureNode({ url, w, h, zoom }) {
  const shown = w * zoom * (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const small = dzThumb(url, 1600);
  const src = !url?.startsWith("/media/") ? url : shown > 2600 ? url : shown > 1500 ? dzThumb(url, 2880) : small;
  const img = useImg(src, small);
  return img ? <KImage image={img} width={w} height={h} listening={false} perfectDrawEnabled={false} />
    : <Rect width={w} height={h} fill="rgba(127,127,127,0.15)" listening={false} />;
});

const ObjectNode = memo(function ObjectNode({ it, zoom }) {
  const shown = it.w * zoom * (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const small = dzThumb(it.url, 640);
  const img = useImg(!it.url?.startsWith("/media/") ? it.url : shown > 700 ? dzThumb(it.url, 1600) : small, small);
  return (
    <Group id={it.id} name="item" x={it.cx} y={it.cy} rotation={it.rotation || 0} offsetX={it.w / 2} offsetY={it.h / 2} width={it.w} height={it.h}>
      {img ? <KImage image={img} width={it.w} height={it.h} scaleX={it.flipX ? -1 : 1} x={it.flipX ? it.w : 0} perfectDrawEnabled={false} />
        : <Rect width={it.w} height={it.h} fill="rgba(127,127,127,0.25)" />}
    </Group>
  );
});

function Canvas({ reserveBottom = 0, base, shownUrl, showWork, items, erasers, tool, color, brushSize, selected, onSelect, onCreate, onStroke, onErase, onMove, onTransform, onPoint, onPick, onFiles, overlay, onView, onCanvasDown, disabled }, ref) {
  const tk = useTokens();
  const host = useRef(null);
  const stageRef = useRef(null);
  const trRef = useRef(null);
  const overlayRef = useRef(null);
  const paintRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const viewRef = useRef({ x: 0, y: 0, z: 0.1 });
  const [view, setViewState] = useState(viewRef.current);
  const fitRef = useRef(0.1);
  const settle = useRef(0);
  const [space, setSpace] = useState(false);
  const [draft, setDraft] = useState(null);
  const [dragging, setDragging] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const applyView = useCallback((v) => {
    viewRef.current = v;
    const st = stageRef.current;
    if (st) { st.position({ x: v.x, y: v.y }); st.scale({ x: v.z, y: v.z }); st.batchDraw(); }
    // Notes keep their size at any zoom (E3.9): the overlay scales with the picture, each note back by 1/z.
    if (overlayRef.current) { overlayRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`; overlayRef.current.style.setProperty("--iz", String(1 / v.z)); }
    if (host.current) { host.current.style.backgroundSize = `${22 * v.z}px ${22 * v.z}px`; host.current.style.backgroundPosition = `${v.x}px ${v.y}px`; }
    clearTimeout(settle.current);
    settle.current = setTimeout(() => { setViewState(v); onView?.({ z: v.z, fit: fitRef.current }); }, 90);
  }, [onView]);
  useEffect(() => () => clearTimeout(settle.current), []);

  // The canvas fills its box; the picture fits it on open and when the box changes size.
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const fitView = useCallback(() => {
    if (!base?.w || !size.w) return;
    const room = Math.max(120, size.h - 48 - reserveBottom);
    const z = Math.min((size.w - 48) / base.w, room / base.h);
    fitRef.current = z;
    applyView({ z, x: (size.w - base.w * z) / 2, y: Math.max(24, (room + 48 - base.h * z) / 2) });
  }, [base?.w, base?.h, size.w, size.h, reserveBottom, applyView]);
  const fitted = useRef(null);
  useEffect(() => {
    const key = `${base?.url}|${base?.w}|${size.w}x${size.h}`;
    if (!base?.w || fitted.current === key) return;
    // A new picture or a new box: fit (a zoomed view keeps its place when only the box changes).
    const keepZoom = fitted.current && fitted.current.startsWith(`${base.url}|`) && Math.abs(viewRef.current.z - fitRef.current) > 1e-6;
    fitted.current = key;
    if (keepZoom) { fitRef.current = Math.min((size.w - 48) / base.w, Math.max(120, size.h - 48 - reserveBottom) / base.h); applyView(viewRef.current); return; }
    fitView();
  }, [base?.url, base?.w, base?.h, size.w, size.h, fitView, applyView]);

  const toWorld = useCallback((cx, cy) => {
    const r = host.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  }, []);
  const zoomAt = useCallback((factor, cx, cy) => {
    const v = viewRef.current;
    const z = Math.min(fitRef.current * ZOOM_MAX, Math.max(fitRef.current * ZOOM_MIN, v.z * factor));
    const r = host.current.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    applyView({ z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z });
  }, [applyView]);
  const gestureFns = useRef(null);
  gestureFns.current = { zoomAt, applyView, view: () => viewRef.current };
  useCanvasGestures(host, gestureFns);
  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomAt(1.25), zoomOut: () => zoomAt(1 / 1.25), fit: fitView,
    toScreen: (p) => { const v = viewRef.current; const r = host.current?.getBoundingClientRect(); return r ? { x: r.left + v.x + p.x * v.z, y: r.top + v.y + p.y * v.z } : p; },
    center: () => { const r = host.current?.getBoundingClientRect(); return r ? toWorld(r.left + r.width / 2, r.top + r.height / 2) : { x: base.w / 2, y: base.h / 2 }; },
    toWorld,
    focus: () => host.current?.focus({ preventScroll: true }),
    el: () => host.current,
  }), [zoomAt, fitView, toWorld, base?.w, base?.h]);

  // Space: pan while held (as on the Moodboard).
  useEffect(() => {
    const down = (e) => { if (e.key === " " && !e.target.closest?.("input,textarea,[contenteditable=true]")) { e.preventDefault(); setSpace(true); } };
    const up = (e) => { if (e.key === " ") setSpace(false); };
    const el = host.current;
    el?.addEventListener("keydown", down);
    el?.addEventListener("keyup", up);
    return () => { el?.removeEventListener("keydown", down); el?.removeEventListener("keyup", up); };
  }, []);

  // ── Hit test ──
  const hitAt = (evt) => {
    const st = stageRef.current;
    if (!st) return {};
    st.setPointersPositions(evt);
    const pos = st.getPointerPosition();
    let n = pos ? st.getIntersection(pos) : null;
    if (!n) return {};
    if (n.getParent()?.getClassName?.() === "Transformer" || String(n.name()).includes("_anchor")) return { handle: true };
    if (n.name() === "arrow-end") return { end: n.getAttr("end"), arrow: n.getAttr("arrow") };
    while (n && n !== st && !(n.getAttr("itemId") || (n.id() && itemsRef.current.some((x) => x.id === n.id())))) n = n.getParent();
    return { id: n && n !== st ? n.getAttr("itemId") || n.id() : null };
  };

  // ── Pointer ──
  const drag = useRef(null);
  const endDrag = useRef(null);
  const listen = () => {
    const move = (e) => onPointerMove(e);
    const up = (e) => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); onPointerUp(e); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    endDrag.current = up;
  };
  useEffect(() => () => endDrag.current?.({}), []);
  const follow = (id, dx, dy) => {
    for (const el of overlayRef.current?.querySelectorAll(`[data-follow="${id}"]`) || []) el.style.translate = dx || dy ? `${dx}px ${dy}px` : "";
  };

  const onDown = (e) => {
    if (e.target.closest?.("[data-overlay-ui]")) return;
    onCanvasDown?.();
    host.current?.focus({ preventScroll: true });
    const hand = tool === "hand" || space || e.button === 1;
    if (hand) { drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, v: viewRef.current }; setDragging(true); listen(); return; }
    if (e.button !== 0 || disabled) return;
    const p = toWorld(e.clientX, e.clientY);
    if (tool === "rect" || tool === "arrow") { const r = { kind: tool, x: p.x, y: p.y, x2: p.x, y2: p.y }; drag.current = { kind: tool, r }; setDraft(r); listen(); return; }
    if (tool === "brush" || tool === "eraser") {
      const sizeW = brushSize / viewRef.current.z;
      drag.current = { kind: tool, points: [p.x, p.y], size: sizeW };
      setDraft({ kind: tool, points: [p.x, p.y], size: sizeW });
      listen();
      return;
    }
    if (tool === "note") { e.preventDefault(); onPoint(p); return; }
    if (tool === "picture") { onPick(); return; }
    // Select.
    const hit = hitAt(e.nativeEvent);
    if (hit.handle) return;
    if (hit.end) {
      const it = itemsRef.current.find((x) => x.id === hit.arrow);
      drag.current = { kind: "end", id: hit.arrow, end: hit.end, start: { ...it } };
      setDragging(true);
      listen();
      return;
    }
    if (hit.id) {
      onSelect(hit.id);
      const it = itemsRef.current.find((x) => x.id === hit.id);
      drag.current = { kind: "move", id: hit.id, it, p, moved: false, d: { x: 0, y: 0 } };
      listen();
      return;
    }
    onSelect(null);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") { applyView({ ...d.v, x: d.v.x + e.clientX - d.sx, y: d.v.y + e.clientY - d.sy }); return; }
    const p = toWorld(e.clientX, e.clientY);
    if (d.kind === "rect" || d.kind === "arrow") { d.r = { ...d.r, x2: p.x, y2: p.y }; setDraft(d.r); return; }
    if (d.kind === "brush" || d.kind === "eraser") {
      const n = d.points.length;
      if (Math.hypot(p.x - d.points[n - 2], p.y - d.points[n - 1]) * viewRef.current.z < 1.5) return;
      d.points.push(p.x, p.y);
      const line = stageRef.current?.findOne("#draft-paint");
      if (line) { line.points(d.points.slice()); line.getLayer()?.batchDraw(); }
      return;
    }
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
      const dx = p.x - d.p.x;
      const dy = p.y - d.p.y;
      if (!d.moved && Math.hypot(dx, dy) * viewRef.current.z < 3) return;
      if (!d.moved) { d.moved = true; setDragging(true); }
      d.d = { x: dx, y: dy };
      const st = stageRef.current;
      const it = d.it;
      if (it.kind === "arrow") st?.findOne(`#${it.id}`)?.points([it.x + dx, it.y + dy, it.x2 + dx, it.y2 + dy]);
      else if (it.kind === "brush") for (const n of st?.find(`.stroke-${it.id}`) || []) n.position({ x: dx, y: dy });
      else if (it.kind === "rect") st?.findOne(`#${it.id}`)?.position({ x: Math.min(it.x, it.x + it.w) + dx, y: Math.min(it.y, it.y + it.h) + dy });
      else if (it.kind === "point") st?.findOne(`#${it.id}`)?.position({ x: it.x + dx, y: it.y + dy });
      else if (it.kind === "object") st?.findOne(`#${it.id}`)?.position({ x: it.cx + dx, y: it.cy + dy });
      st?.batchDraw();
      follow(it.id, dx, dy);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (d.kind === "rect" || d.kind === "arrow") {
      setDraft(null);
      const r = d.r;
      const z = viewRef.current.z;
      if (d.kind === "rect") {
        const w = Math.abs(r.x2 - r.x); const h = Math.abs(r.y2 - r.y);
        if (w * z < 6 || h * z < 6) return;
        onCreate({ kind: "rect", x: Math.min(r.x, r.x2), y: Math.min(r.y, r.y2), w, h });
      } else if (Math.hypot(r.x2 - r.x, r.y2 - r.y) * z >= 12) onCreate({ kind: "arrow", x: r.x, y: r.y, x2: r.x2, y2: r.y2 });
      return;
    }
    if (d.kind === "brush" || d.kind === "eraser") {
      setDraft(null);
      (d.kind === "brush" ? onStroke : onErase)({ points: d.points, size: d.size });
      return;
    }
    if (d.kind === "end") { if (d.pts) onMove(d.id, { x: d.pts[0], y: d.pts[1], x2: d.pts[2], y2: d.pts[3] }); return; }
    if (d.kind === "move" && d.moved) {
      const { x: dx, y: dy } = d.d;
      const it = d.it;
      const st = stageRef.current;
      for (const n of st?.find(`.stroke-${it.id}`) || []) n.position({ x: 0, y: 0 });
      follow(it.id, 0, 0);
      if (it.kind === "arrow") onMove(it.id, { x: it.x + dx, y: it.y + dy, x2: it.x2 + dx, y2: it.y2 + dy });
      else if (it.kind === "brush") onMove(it.id, { strokes: it.strokes.map((s) => ({ ...s, points: s.points.map((v, i) => v + (i % 2 ? dy : dx)) })) });
      else if (it.kind === "rect") onMove(it.id, { x: Math.min(it.x, it.x + it.w) + dx, y: Math.min(it.y, it.y + it.h) + dy, w: Math.abs(it.w), h: Math.abs(it.h) });
      else if (it.kind === "point") onMove(it.id, { x: it.x + dx, y: it.y + dy });
      else if (it.kind === "object") onMove(it.id, { cx: it.cx + dx, cy: it.cy + dy });
    }
  };

  // Files dropped on the canvas: pasted pictures at the drop point (handled by the editor).
  const onDragOver = (e) => { if (Array.from(e.dataTransfer?.types || []).includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } };
  const onDrop = (e) => { const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); onFiles(files, toWorld(e.clientX, e.clientY)); } };

  // ── Transformer: a rectangle by any handle; a picture by a corner (locked ratio) and the top handle (rotate) ──
  const sel = showWork ? items.find((x) => x.id === selected && !x.hidden) : null;
  const transformable = sel && (sel.kind === "rect" || sel.kind === "object") && !draft;
  useEffect(() => {
    const tr = trRef.current;
    const st = stageRef.current;
    if (!tr || !st || tr.isTransforming()) return;
    const node = transformable ? st.findOne(`#${sel.id}`) : null;
    const cur = tr.nodes();
    if ((node && cur[0] === node && cur.length === 1) || (!node && !cur.length)) { tr.forceUpdate(); return; }
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  });
  const onTransformEnd = () => {
    const n = trRef.current?.nodes()[0];
    if (!n || !sel) return;
    const sx = Math.abs(n.scaleX());
    const sy = Math.abs(n.scaleY());
    n.scale({ x: 1, y: 1 });
    if (sel.kind === "rect") onTransform(sel.id, { x: n.x(), y: n.y(), w: Math.max(4, sel.w * sx), h: Math.max(4, sel.h * sy) });
    else onTransform(sel.id, { cx: n.x(), cy: n.y(), w: Math.max(8, sel.w * sx), h: Math.max(8, sel.h * sx), rotation: n.rotation() });
  };

  const z = view.z;
  const visible = showWork ? items.filter((x) => !x.hidden) : [];
  const objects = visible.filter((x) => x.kind === "object").sort((a, b) => (a.z || 0) - (b.z || 0));
  const strokes = useMemo(() => {
    const out = [];
    for (const it of visible) if (it.kind === "brush") for (const s of it.strokes || []) out.push({ ...s, id: it.id, hex: markHex(it.color) });
    for (const e of erasers || []) out.push({ ...e, erase: true });
    return out.sort((a, b) => a.seq - b.seq);
  }, [visible, erasers]); // eslint-disable-line react-hooks/exhaustive-deps
  const selArrow = sel?.kind === "arrow" ? sel : null;
  const cursor = tool === "hand" || space ? (dragging && !draft ? "grabbing" : "grab") : tool === "select" ? "default" : disabled ? "not-allowed" : "crosshair";
  const sw = (px) => px / z; // a line px wide on screen

  return (
    <div ref={host} tabIndex={0} aria-label="Picture to edit" className="absolute inset-0 touch-none overflow-hidden overscroll-none outline-none"
      style={{ cursor, backgroundImage: "radial-gradient(hsl(var(--border)) 1px, transparent 1px)", backgroundSize: `${22 * z}px ${22 * z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={onDown} onDragOver={onDragOver} onDrop={onDrop}>
      <Stage ref={stageRef} width={size.w} height={size.h} x={viewRef.current.x} y={viewRef.current.y} scaleX={viewRef.current.z} scaleY={viewRef.current.z}>
        <Layer listening={false}>
          {base?.w ? <PictureNode url={shownUrl} w={base.w} h={base.h} zoom={z} /> : null}
        </Layer>
        <Layer>
          {objects.map((it) => <ObjectNode key={it.id} it={it} zoom={z} />)}
        </Layer>
        {/* Painted areas: one layer, half-transparent as a whole; the eraser removes paint only. */}
        <Layer ref={paintRef} opacity={0.5}>
          {strokes.map((s) => (s.erase
            ? <Line key={`e${s.seq}`} points={s.points.length === 2 ? [...s.points, s.points[0] + 0.01, s.points[1]] : s.points} stroke="#000" strokeWidth={s.size} lineCap="round" lineJoin="round" globalCompositeOperation="destination-out" listening={false} perfectDrawEnabled={false} />
            : <Line key={`s${s.seq}`} name={`stroke-${s.id}`} itemId={s.id} points={s.points.length === 2 ? [...s.points, s.points[0] + 0.01, s.points[1]] : s.points} stroke={s.hex} strokeWidth={s.size} lineCap="round" lineJoin="round" hitStrokeWidth={Math.max(s.size, sw(14))} perfectDrawEnabled={false} />))}
          {draft && (draft.kind === "brush" || draft.kind === "eraser") && (
            <Line id="draft-paint" points={draft.points} stroke={draft.kind === "eraser" ? "#000" : markHex("red")} strokeWidth={draft.size} lineCap="round" lineJoin="round"
              globalCompositeOperation={draft.kind === "eraser" ? "destination-out" : "source-over"} listening={false} />
          )}
        </Layer>
        <Layer>
          {visible.map((it) => {
            if (it.kind === "rect") return <Rect key={it.id} id={it.id} x={Math.min(it.x, it.x + it.w)} y={Math.min(it.y, it.y + it.h)} width={Math.abs(it.w)} height={Math.abs(it.h)} stroke={markHex(it.color)} strokeWidth={2.5} strokeScaleEnabled={false} fill="rgba(0,0,0,0)" hitStrokeWidth={14} perfectDrawEnabled={false} />;
            if (it.kind === "arrow") return <KArrow key={it.id} id={it.id} points={[it.x, it.y, it.x2, it.y2]} stroke={markHex(it.color)} fill={markHex(it.color)} strokeWidth={sw(3)} pointerLength={sw(14)} pointerWidth={sw(12)} hitStrokeWidth={sw(16)} lineCap="round" lineJoin="round" />;
            if (it.kind === "point") return <Circle key={it.id} id={it.id} x={it.x} y={it.y} radius={sw(5)} fill={NUMBER_FILL} stroke={NUMBER_TEXT} strokeWidth={1.5} strokeScaleEnabled={false} hitStrokeWidth={sw(18)} />;
            return null;
          })}
        </Layer>
        <Layer>
          {draft?.kind === "rect" && <Rect x={Math.min(draft.x, draft.x2)} y={Math.min(draft.y, draft.y2)} width={Math.abs(draft.x2 - draft.x)} height={Math.abs(draft.y2 - draft.y)} stroke={markHex(color)} strokeWidth={2.5} strokeScaleEnabled={false} listening={false} />}
          {draft?.kind === "arrow" && <KArrow points={[draft.x, draft.y, draft.x2, draft.y2]} stroke={markHex(color)} fill={markHex(color)} strokeWidth={sw(3)} pointerLength={sw(14)} pointerWidth={sw(12)} listening={false} />}
          {/* A selected brush stroke group or point: a thin box around it (no handles: they move). */}
          {sel && (sel.kind === "brush" || sel.kind === "point") && !dragging && (() => { const b = boundsOf(sel); const pad = sw(6); return <Rect x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} stroke={tk.foreground} strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} listening={false} />; })()}
          {selArrow && !dragging && [["a", selArrow.x, selArrow.y], ["b", selArrow.x2, selArrow.y2]].map(([end, x, y]) => (
            <Circle key={end} id={`end-${end}`} name="arrow-end" end={end} arrow={selArrow.id} x={x} y={y} radius={sw(5)} fill={tk.background} stroke={tk.foreground} strokeWidth={1.5} strokeScaleEnabled={false} />
          ))}
          <Transformer ref={trRef} flipEnabled={false} ignoreStroke
            rotateEnabled={sel?.kind === "object"} keepRatio={sel?.kind === "object"} enabledAnchors={sel?.kind === "object" ? CORNERS : ALL_ANCHORS} rotateAnchorOffset={22}
            anchorSize={8} anchorCornerRadius={4} anchorStroke={NUMBER_FILL} anchorFill={NUMBER_FILL} borderStroke={NUMBER_FILL} borderStrokeWidth={1}
            boundBoxFunc={(oldBox, box) => (Math.abs(box.width) < 8 || Math.abs(box.height) < 8 ? oldBox : box)}
            onTransformStart={() => setDragging(true)} onTransformEnd={() => { setDragging(false); onTransformEnd(); }} />
        </Layer>
      </Stage>
      {/* Notes, pills and the selection's small toolbar: HTML in picture coordinates, kept at screen size. */}
      <div ref={overlayRef} className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${viewRef.current.x}px, ${viewRef.current.y}px) scale(${viewRef.current.z})`, "--iz": String(1 / viewRef.current.z) }}>
        {overlay({ z, dragging })}
      </div>
    </div>
  );
}

export default forwardRef(Canvas);
