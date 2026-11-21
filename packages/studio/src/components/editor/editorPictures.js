"use client";

// The pictures the editor makes (package 12, E5): the copy with the marks and their numbers,
// and the one flattened picture. Both at the base picture's own size (no 800 px canvas), drawn
// with the 2D canvas from the items, not from the screen. The base itself is never redrawn:
// the model gets the original file.
import { numbered, isObject, markHex, DEFAULT_MARK_COLOR, NUMBER_FILL, NUMBER_TEXT } from "./editorModel.mjs";

// What the edit models take (provider docs, 2026-11; see package 11 notes): Nano Banana /
// Gemini image — 7 MB per inline picture; Seedream — about 6000 px a side; GPT Image — 50 MB.
export const EXPORT = { MAX_SIDE: 6000, MAX_PIXELS: 36_000_000, MAX_BYTES: 7 * 1024 * 1024, QUALITIES: [0.92, 0.85, 0.78] };
export function exportSize(w, h) {
  const k = Math.min(1, EXPORT.MAX_SIDE / Math.max(w, h), Math.sqrt(EXPORT.MAX_PIXELS / (w * h)));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

const cache = new Map();
// Full-size pictures decoded for an export are dropped from the cache right after it.
export function forgetImages(srcs) { for (const s of srcs) cache.delete(s); }
export function loadImage(src) {
  if (!src) return Promise.reject(new Error("No picture"));
  if (!cache.has(src)) {
    cache.set(src, new Promise((resolve, reject) => {
      const img = new window.Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => { cache.delete(src); reject(new Error("The picture did not load.")); };
      img.src = src;
    }));
    if (cache.size > 40) cache.delete(cache.keys().next().value);
  }
  return cache.get(src);
}

// Where an item's number (and its note) sits, in base pixels.
export function anchorOf(it) {
  if (it.kind === "rect") return { x: Math.min(it.x, it.x + it.w), y: Math.min(it.y, it.y + it.h) };
  if (it.kind === "arrow") return { x: it.x, y: it.y };
  if (it.kind === "point") return { x: it.x, y: it.y };
  if (it.kind === "brush") { const b = boundsOf(it); return { x: b.x, y: b.y }; }
  if (it.kind === "object") { const b = boundsOf(it); return { x: b.x, y: b.y }; }
  return { x: 0, y: 0 };
}

// The box of an item, in base pixels (a rotated picture: the box around it).
export function boundsOf(it) {
  if (it.kind === "rect") return { x: Math.min(it.x, it.x + it.w), y: Math.min(it.y, it.y + it.h), w: Math.abs(it.w), h: Math.abs(it.h) };
  if (it.kind === "arrow") return { x: Math.min(it.x, it.x2), y: Math.min(it.y, it.y2), w: Math.abs(it.x2 - it.x), h: Math.abs(it.y2 - it.y) };
  if (it.kind === "point") return { x: it.x, y: it.y, w: 0, h: 0 };
  if (it.kind === "brush") {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const s of it.strokes || []) {
      const r = s.size / 2;
      for (let i = 0; i < s.points.length; i += 2) {
        x0 = Math.min(x0, s.points[i] - r); y0 = Math.min(y0, s.points[i + 1] - r);
        x1 = Math.max(x1, s.points[i] + r); y1 = Math.max(y1, s.points[i + 1] + r);
      }
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
  }
  if (it.kind === "object") {
    const a = ((it.rotation || 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(a)); const s = Math.abs(Math.sin(a));
    const w = it.w * c + it.h * s; const h = it.w * s + it.h * c;
    return { x: it.cx - w / 2, y: it.cy - h / 2, w, h };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

// One picture: k = output pixels per base pixel.
function drawObject(ctx, it, img, k) {
  ctx.save();
  ctx.translate(it.cx * k, it.cy * k);
  ctx.rotate(((it.rotation || 0) * Math.PI) / 180);
  if (it.flipX) ctx.scale(-1, 1);
  ctx.drawImage(img, (-it.w / 2) * k, (-it.h / 2) * k, it.w * k, it.h * k);
  ctx.restore();
}

// The painted areas. "fill" (a saved copy): every stroke and eraser stroke in order on its
// own layer, laid over the picture half-transparent (the eraser only removes paint).
// "outline" (what the model gets, package 13 C4): each painted area as a line in its mark
// colour around it, nothing over the area itself — a fill hides the very thing to change.
function paintLayer(strokes, erasers, W, H, k, color) {
  const all = [...strokes, ...(erasers || []).map((e) => ({ ...e, erase: true }))].sort((a, b) => a.seq - b.seq);
  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const p = layer.getContext("2d");
  p.lineCap = "round";
  p.lineJoin = "round";
  for (const s of all) {
    p.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    p.strokeStyle = s.erase ? "#000" : (s.color || color);
    p.lineWidth = s.size * k;
    p.beginPath();
    p.moveTo(s.points[0] * k, s.points[1] * k);
    if (s.points.length === 2) p.lineTo(s.points[0] * k + 0.01, s.points[1] * k);
    for (let i = 2; i < s.points.length; i += 2) p.lineTo(s.points[i] * k, s.points[i + 1] * k);
    p.stroke();
  }
  return layer;
}
function drawPaint(ctx, list, erasers, W, H, k, { mode = "outline", lineW = 4 } = {}) {
  const brushes = list.filter((it) => it.kind === "brush" && (it.strokes || []).length);
  if (!brushes.length) return;
  if (mode === "fill") {
    const strokes = brushes.flatMap((it) => it.strokes.map((s) => ({ ...s, color: markHex(it.color) })));
    const layer = paintLayer(strokes, erasers, W, H, k);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    layer.width = 0; layer.height = 0;
    return;
  }
  const w = Math.max(2, lineW * 1.25);
  for (const it of brushes) {
    const mask = paintLayer(it.strokes, erasers, W, H, k, "#000");
    // The area grown by the line width all round, less the area itself: a line just outside it.
    const ring = document.createElement("canvas");
    ring.width = W;
    ring.height = H;
    const r = ring.getContext("2d");
    const steps = 24;
    for (let i = 0; i < steps; i += 1) {
      const a = (i / steps) * Math.PI * 2;
      r.drawImage(mask, Math.cos(a) * w, Math.sin(a) * w);
    }
    r.globalCompositeOperation = "destination-out";
    r.drawImage(mask, 0, 0);
    r.globalCompositeOperation = "source-in";
    r.fillStyle = markHex(it.color);
    r.fillRect(0, 0, W, H);
    ctx.drawImage(ring, 0, 0);
    mask.width = 0; mask.height = 0; ring.width = 0; ring.height = 0;
  }
}

// Rectangles, arrows, points; an object's place as a dashed outline (in the marked copy
// the picture itself is not drawn: it is sent as its own file); then every number.
function drawMarks(ctx, list, k, { lineW, badgeR, objectOutlines }) {
  // Every item has its number; objects get a dashed outline only in the marked copy.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const it of list) {
    const hex = markHex(it.color);
    if (it.kind === "rect") {
      ctx.strokeStyle = hex;
      ctx.lineWidth = lineW;
      ctx.strokeRect(Math.min(it.x, it.x + it.w) * k, Math.min(it.y, it.y + it.h) * k, Math.abs(it.w) * k, Math.abs(it.h) * k);
    } else if (it.kind === "arrow") {
      const ax = it.x * k; const ay = it.y * k; const bx = it.x2 * k; const by = it.y2 * k;
      const ang = Math.atan2(by - ay, bx - ax);
      const head = lineW * 4.5;
      ctx.strokeStyle = hex;
      ctx.fillStyle = hex;
      ctx.lineWidth = lineW;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx - Math.cos(ang) * head * 0.6, by - Math.sin(ang) * head * 0.6); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - head * Math.cos(ang - Math.PI / 7), by - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(bx - head * Math.cos(ang + Math.PI / 7), by - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath(); ctx.fill();
    } else if (it.kind === "point") {
      ctx.fillStyle = NUMBER_FILL;
      ctx.strokeStyle = NUMBER_TEXT;
      ctx.lineWidth = Math.max(1, lineW * 0.5);
      ctx.beginPath(); ctx.arc(it.x * k, it.y * k, badgeR * 0.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (it.kind === "object" && objectOutlines) {
      ctx.save();
      ctx.translate(it.cx * k, it.cy * k);
      ctx.rotate(((it.rotation || 0) * Math.PI) / 180);
      ctx.strokeStyle = markHex(DEFAULT_MARK_COLOR);
      ctx.lineWidth = lineW;
      ctx.setLineDash([lineW * 3, lineW * 2]);
      ctx.strokeRect((-it.w / 2) * k, (-it.h / 2) * k, it.w * k, it.h * k);
      ctx.restore();
    }
  }
  // Numbers: white circles, dark text, at each item's place (a point's number sits beside it).
  ctx.font = `700 ${Math.round(badgeR * 1.15)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const it of list) {
    const a = anchorOf(it);
    const x = it.kind === "point" ? a.x * k + badgeR * 1.6 : a.x * k + badgeR * 0.2;
    const y = it.kind === "point" ? a.y * k : a.y * k - badgeR * 1.2;
    const cx = Math.min(Math.max(x, badgeR + 2), ctx.canvas.width - badgeR - 2);
    const cy = Math.min(Math.max(y, badgeR + 2), ctx.canvas.height - badgeR - 2);
    ctx.fillStyle = NUMBER_FILL;
    ctx.beginPath(); ctx.arc(cx, cy, badgeR, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1, badgeR * 0.12);
    ctx.strokeStyle = NUMBER_TEXT;
    ctx.stroke();
    ctx.fillStyle = NUMBER_TEXT;
    ctx.fillText(String(it.n), cx, cy + badgeR * 0.05);
  }
}

// Draw the copy with marks (flat = false) or the one flattened picture (flat = true) into a
// canvas of width × height for a base of base.w × base.h pixels.
export async function renderPicture({ base, baseSrc, items, erasers, flat = false, width, height, objectSrc = (o) => o.url, paint = "outline" }) {
  const k = width / base.w;
  const list = numbered(items).filter((it) => it.n);
  const [baseImg, ...objImgs] = await Promise.all([
    loadImage(baseSrc || base.url),
    ...(flat ? list.filter(isObject).map((o) => loadImage(objectSrc(o)).catch(() => null)) : []),
  ]);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(baseImg, 0, 0, width, height);
  if (flat) {
    const objs = list.filter(isObject).map((o, i) => ({ o, img: objImgs[i] })).sort((a, b) => (a.o.z || 0) - (b.o.z || 0));
    for (const { o, img } of objs) if (img) drawObject(ctx, o, img, k);
  }
  const side = Math.max(width, height);
  const lineW = Math.max(2, side / 450);
  drawPaint(ctx, list, erasers, width, height, k, { mode: paint, lineW });
  drawMarks(ctx, list, k, { lineW, badgeR: Math.max(9, side / 75), objectOutlines: !flat });
  return c;
}

// A canvas as a JPEG within the model limits: quality first, then size.
export async function toJpeg(render, w, h) {
  let size = exportSize(w, h);
  for (let tries = 0; tries < 6; tries += 1) {
    const c = await render(size.width, size.height);
    for (const q of EXPORT.QUALITIES) {
      const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", q));
      if (!blob) throw new Error("The picture could not be made.");
      if (blob.size <= EXPORT.MAX_BYTES) { c.width = 0; c.height = 0; return { blob, width: size.width, height: size.height }; }
    }
    c.width = 0; c.height = 0;
    size = { width: Math.round(size.width * 0.85), height: Math.round(size.height * 0.85) };
  }
  throw new Error("The picture is too large to send.");
}
