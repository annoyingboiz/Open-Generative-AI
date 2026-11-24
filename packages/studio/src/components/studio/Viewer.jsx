"use client";

// One viewer for Studio, Image and Video (package 03, §6). Left: the media as large
// as it fits, a strip under it (neighbours for a picture, frames for a video),
// ← → to the neighbours. Right (360 px): Details / Versions, prompt with its tags,
// what was attached, model, size, seed, date, price, then what you can do with it.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  X, CaretLeft, CaretRight, Heart, DownloadSimple, DotsThree, Copy, ArrowCounterClockwise, ImageSquare, PencilSimple, VideoCamera,
  ArrowsOutSimple, ArrowLineRight, Drop, Flag, Play, Pause, Repeat, SpeakerHigh, SpeakerSlash, CornersOut, FrameCorners, Trash, Shapes, PencilLine, Check, Plus, Minus,
} from "@phosphor-icons/react";
import { DropdownMenuParts, Spinner, cn } from "../../ui/index.js";
import { dzThumb, dzPlay, dzStrip } from "../../api.js";
import { dzOpenUpscale, dzUpscaleSpec, dzIsOwnImage, dzVideoUpscaleSpec, dzOpenVideoUpscale } from "../../dzCatalog.js";
import { promptTags, TAG_RE } from "../../dzCreate.js";
import { Overline, useEscLayer, fmtDur } from "./ui.jsx";
import { download } from "../DzCreateStudio.jsx";
import { dzScrollBoxRef } from "../../dzScroll.js";
import { dzMediaInfo } from "../DzPosterVideo.jsx";
import { dzLibrary } from "../../dzLibrary.js";
import { TextureControl } from "./Texture.jsx";
import { checkBadges, hasColourSource, colourLine } from "./actions.js";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } = DropdownMenuParts;
const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));
const FPS = 24; // one frame back / forward; providers deliver 24 fps in most cases
const fmtDate = (t) => (t ? new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const fmtUsd = (usd) => (Number.isFinite(usd) ? `$${usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}` : "");
const fmtTime = (t) => { const m = Math.floor(t / 60); const s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, "0")}`; };

// The prompt with its tags as chips (picture + tag), as in the composer.
function PromptText({ text, tags }) {
  const map = new Map(tags.map((t) => [t.tag.toLowerCase(), t]));
  const parts = [];
  let last = 0;
  for (const m of String(text || "").matchAll(TAG_RE)) {
    const t = map.get(m[2].toLowerCase());
    if (!t) continue;
    const at = m.index + m[1].length;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <span key={at} className="mx-px inline-flex items-center gap-1 rounded-xs bg-signal/[.14] px-1 align-baseline font-medium text-signal shadow-[inset_0_0_0_1px_hsl(var(--signal)/.35)]">
        {t.url && <img src={dzThumb(t.url, 64)} alt="" className="h-4 w-4 rounded-[3px] object-cover" />}@{m[2]}
      </span>,
    );
    last = at + 1 + m[2].length;
  }
  if (last < String(text || "").length) parts.push(String(text).slice(last));
  return <p className="whitespace-pre-wrap break-words text-base leading-6">{parts}</p>;
}

// A row of thumbnails along the video (package 10, M4): the server makes them once as one
// small picture (?strip=12); here it is cut into frames. It used to download the whole
// video a second time in the browser, competing with the player.
function useFrameStrip(url, n = 12) {
  const [frames, setFrames] = useState([]);
  useEffect(() => {
    setFrames([]);
    const src = dzStrip(url, n);
    if (!src) return undefined;
    let alive = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (!alive || !img.naturalWidth) return;
      const w = img.naturalWidth / n;
      const h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w);
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      const out = [];
      for (let i = 0; i < n; i += 1) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, i * w, 0, w, h, 0, 0, canvas.width, h);
        out.push(canvas.toDataURL("image/jpeg", 0.7));
      }
      setFrames(out);
    };
    img.src = src;
    return () => { alive = false; img.onload = null; };
  }, [url, n]);
  return frames;
}

// Controls live outside the components that use them: a component made inside another one is a
// new type on every render, so React rebuilds its button. The player re-renders several times a
// second (time updates), and a click whose press and release land on two different buttons is lost.
const Btn = ({ label, children, onClick, on }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick}
    className={cn("flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-overlay-foreground/80 transition-colors duration-state hover:bg-overlay-foreground/10 hover:text-overlay-foreground", on && "text-overlay-foreground")}>{children}</button>
);
const Action = ({ icon: Icon, children, onClick, disabled = false, title }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-40"><Icon size={16} />{children}</button>
);
const IconBtn = ({ label, children, onClick }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded-md text-overlay-foreground/80 hover:bg-overlay-foreground/10 hover:text-overlay-foreground">{children}</button>
);

function VideoPlayer({ item, act }) {
  const ref = useRef(null);
  const box = useRef(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);
  const [muted, setMuted] = useState(true);
  // Heavy videos play a lighter copy (package 10). "Original quality" switches to the original at
  // the same second, to judge the real quality (e.g. of a 4K upscale).
  const [original, setOriginal] = useState(false);
  const [isCopy, setIsCopy] = useState(false);
  const [res, setRes] = useState(null);
  const resume = useRef(null);
  // Is a lighter copy playing? Asked once (not cached: the copy may be made later).
  useEffect(() => {
    let alive = true;
    if (item.url?.startsWith("/media/")) {
      fetch(`${item.url}${item.url.includes("?") ? "&" : "?"}playinfo=1`, { credentials: "same-origin", cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setIsCopy(Boolean(j?.copy)); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [item.url]);
  const frames = useFrameStrip(item.url);
  const v = () => ref.current;
  // The free area between the top row and the controls (package 14, A3): the video is fitted into
  // it at any shape — a percentage max-height does not hold inside this flex column.
  const [area, setArea] = useState(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setArea({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const fitStyle = area ? { maxWidth: area.w, maxHeight: area.h } : { maxWidth: "100%", maxHeight: "100%" };
  // Loading state from the first moment; no first frame after a few seconds → Retry (package 10, M6).
  const [load, setLoad] = useState("loading"); // loading | ready | slow | error
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (load !== "loading") return undefined;
    const t = setTimeout(() => setLoad((s) => (s === "loading" ? "slow" : s)), 5000);
    return () => clearTimeout(t);
  }, [load, attempt]);
  const retry = () => { setLoad("loading"); setAttempt((n) => n + 1); const el = v(); if (el) { el.load(); el.play().catch(() => {}); } };
  const step = (n) => { const el = v(); if (!el) return; el.pause(); setPlaying(false); el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + n / FPS)); };
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div ref={box} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-overlay">
        <div className="relative flex items-center justify-center" style={fitStyle}>
          <video ref={ref} src={original ? item.url : dzPlay(item.url)} autoPlay muted={muted} loop={loop} playsInline preload="auto" poster={dzThumb(item.url, 1600)} className="block rounded-md object-contain" style={fitStyle}
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { const el = e.currentTarget; setDur(el.duration); setRes({ w: el.videoWidth, h: el.videoHeight });  if (resume.current) { el.currentTime = resume.current.t; if (resume.current.playing) el.play().catch(() => {}); else el.pause(); resume.current = null; } }}
            onLoadedData={() => setLoad("ready")} onPlaying={() => setLoad("ready")} onWaiting={() => setLoad((s) => (s === "ready" ? "loading" : s))}
            onError={() => { if (original) { setOriginal(false); return; } setLoad("error"); }}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={() => { const el = v(); if (el.paused) el.play(); else el.pause(); }} />
          {load !== "ready" && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-md bg-overlay/40 text-overlay-foreground">
              {load === "loading" ? <Spinner className="h-6 w-6 border-overlay-foreground/30 border-t-overlay-foreground" /> : (
                <>
                  <span className="text-sm">{load === "error" ? "The video did not load." : "Still loading."}</span>
                  <button type="button" onClick={retry} className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-md border border-overlay-foreground/25 px-3 text-sm font-medium hover:bg-overlay-foreground/10"><Repeat size={14} />Retry</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Frame strip: a click jumps there; the line marks where you are. */}
      <div className="relative mt-4 flex h-9 w-full cursor-pointer overflow-hidden rounded-md bg-overlay-foreground/5"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const el = v(); if (el && dur) el.currentTime = ((e.clientX - r.left) / r.width) * dur; }}>
        {frames.map((f, i) => <img key={i} src={f} alt="" className="h-full min-w-0 flex-1 object-cover" />)}
        {dur > 0 && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-signal" style={{ left: `${(t / dur) * 100}%` }} />}
      </div>
      <div className="mt-2 flex items-center gap-1 text-sm text-overlay-foreground">
        <Btn label={playing ? "Pause" : "Play"} onClick={() => { const el = v(); if (el.paused) el.play(); else el.pause(); }}>{playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}</Btn>
        <span className="ml-1 tabular-nums">{fmtTime(t)}</span><span className="tabular-nums text-overlay-foreground/60">&nbsp;/ {fmtDur(dur)}</span>
        <span className="flex-1" />
        <Btn label="One frame back" onClick={() => step(-1)}><CaretLeft size={16} /></Btn>
        <Btn label="One frame forward" onClick={() => step(1)}><CaretRight size={16} /></Btn>
        <button type="button" onClick={() => act.saveFrame(item, v()?.currentTime || 0)} title="Save this frame as a picture, next to the video"
          className="ml-1 flex h-8 items-center gap-1.5 rounded-md border border-overlay-foreground/20 px-2.5 font-medium hover:bg-overlay-foreground/10"><FrameCorners size={16} />Save frame</button>
        <Btn label="Speed" onClick={() => { const next = { 0.5: 1, 1: 1.5, 1.5: 2, 2: 0.5 }[rate]; setRate(next); if (v()) v().playbackRate = next; }}><span className="rounded-md border border-overlay-foreground/20 px-1.5 text-xs tabular-nums">{rate}×</span></Btn>
        {(isCopy || original) && (
          <button type="button" title={original ? `Original · ${res ? `${res.w} × ${res.h}` : ""} — back to the quick copy` : `Quick copy${res ? ` · ${res.w} × ${res.h}` : ""} — switch to the original quality`}
            onClick={() => { const el = v(); resume.current = el ? { t: el.currentTime, playing: !el.paused } : null; setLoad("loading"); setOriginal((x) => !x); }}
            className={cn("ml-1 flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium hover:bg-overlay-foreground/10", original ? "border-overlay-foreground/60 text-overlay-foreground" : "border-overlay-foreground/20 text-overlay-foreground/80")}>
            {original ? `Original${res ? ` · ${res.h >= 2000 || res.w >= 3000 ? "4K" : `${Math.min(res.w, res.h)}p`}` : ""}` : "Original quality"}
          </button>
        )}
        <Btn label={loop ? "Loop on" : "Loop off"} on={loop} onClick={() => setLoop((x) => !x)}><Repeat size={16} className={loop ? "" : "opacity-50"} /></Btn>
        <Btn label={muted ? "Sound off" : "Sound on"} onClick={() => { const next = !muted; const el = v(); if (el) { el.muted = next; if (!next && el.paused) el.play().catch(() => {}); } setMuted(next); }}>{muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}</Btn>
        <Btn label="Full screen" onClick={() => (box.current?.requestFullscreen?.() || v()?.webkitEnterFullscreen?.())}><CornersOut size={16} /></Btn>
      </div>
    </div>
  );
}

// The screen-size copy for the large view: as wide as the view really is in device pixels
// (a Retina screen needs more than 2048). Fitted on screen it looks the same as the original.
export function screenWidth() {
  if (typeof window === "undefined") return 2048;
  const need = Math.max(0, window.innerWidth - 400) * (window.devicePixelRatio || 1);
  return need > 2048 ? 2880 : 2048;
}

const ZOOM_MAX = 8; // 800 %
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pct = (s) => `${Math.round(s * 100)}%`;

// A picture in the large view (quality, package 10 follow-up):
// - fitted: the screen-size copy (fast, looks the same as the original on this screen);
// - zoomed (wheel or pinch at the pointer, + / −, double click, 100 %): the original is loaded
//   (with its progress) and shown pixel for pixel; drag to move around;
// - a label says what is on screen: "Screen copy" or "Original · 3840 × 2160".
// Keys: + / − zoom, 0 fit, 1 100 %. Arrows still go to the neighbours.
function ScreenImage({ url, alt }) {
  const local = typeof url === "string" && url.startsWith("/media/");
  const box = useRef(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState(null); // the original's size
  const [scale, setScale] = useState(null); // null = fitted
  const [center, setCenter] = useState(null); // the picture point in the middle of the view (original pixels)
  const [copyReady, setCopyReady] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [orig, setOrig] = useState({ src: null, progress: 0, state: "idle" }); // idle | loading | ready | error
  const [wantOrig, setWantOrig] = useState(false); // set at the first zoom; kept until another picture

  useEffect(() => {
    setScale(null); setCenter(null); setCopyReady(false); setCopyFailed(false); setNat(null);
    setOrig({ src: null, progress: 0, state: "idle" }); setWantOrig(false);
    if (!local) return undefined;
    let alive = true;
    dzMediaInfo(url).then((j) => { if (alive && j?.width) setNat({ w: j.width, h: j.height }); });
    return () => { alive = false; };
  }, [url, local]);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setView({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [local]);

  // The original, with its progress (it can be 10 MB and more). The browser keeps it afterwards.
  useEffect(() => {
    if (!wantOrig || !local) return undefined;
    let alive = true;
    let objectUrl = null;
    const ctrl = new AbortController();
    setOrig({ src: null, progress: 0, state: "loading" });
    (async () => {
      try {
        const r = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
        if (!r.ok || !r.body) throw new Error(String(r.status));
        const total = Number(r.headers.get("content-length")) || 0;
        const reader = r.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); got += value.length;
          if (alive && total) setOrig((o) => ({ ...o, progress: got / total }));
        }
        objectUrl = URL.createObjectURL(new Blob(chunks, { type: r.headers.get("content-type") || "image/jpeg" }));
        if (alive) setOrig({ src: objectUrl, progress: 1, state: "ready" });
      } catch {
        if (alive) setOrig({ src: null, progress: 0, state: "error" });
      }
    })();
    return () => { alive = false; ctrl.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [wantOrig, url]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = nat && view.w && view.h ? Math.min(view.w / nat.w, view.h / nat.h, 1) : 1;
  const s = scale ?? fit;
  const c = center && scale !== null ? center : nat ? { x: nat.w / 2, y: nat.h / 2 } : { x: 0, y: 0 };
  // Keep the picture covering the view where it is larger than the view; centred where smaller.
  const keep = (cx, cy, sc) => {
    if (!nat) return { x: cx, y: cy };
    const hw = view.w / 2 / sc; const hh = view.h / 2 / sc;
    return {
      x: nat.w <= view.w / sc ? nat.w / 2 : clamp(cx, hw, nat.w - hw),
      y: nat.h <= view.h / sc ? nat.h / 2 : clamp(cy, hh, nat.h - hh),
    };
  };
  // Zoom to `next` keeping the picture point under (px, py) — view coordinates — in place.
  const zoomTo = (next, px = view.w / 2, py = view.h / 2) => {
    if (!nat) return;
    const sc = clamp(next, fit, ZOOM_MAX);
    if (sc <= fit + 1e-6) { setScale(null); setCenter(null); return; }
    const ix = c.x + (px - view.w / 2) / s;
    const iy = c.y + (py - view.h / 2) / s;
    setWantOrig(true);
    setScale(sc);
    setCenter(keep(ix - (px - view.w / 2) / sc, iy - (py - view.h / 2) / sc, sc));
  };
  // The view changed size: keep a zoomed picture covering it (fit follows by itself).
  useEffect(() => {
    if (scale === null || !center || !nat) return;
    const k = keep(center.x, center.y, Math.max(scale, fit));
    if (scale < fit) setScale(null);
    else if (k.x !== center.x || k.y !== center.y) setCenter(k);
  }, [view.w, view.h, nat]); // eslint-disable-line react-hooks/exhaustive-deps
  const STEPS = [0.25, 0.5, 1, 2, 4, 8];
  const stepUp = () => zoomTo(STEPS.find((x) => x > s + 1e-6) ?? ZOOM_MAX);
  const stepDown = () => zoomTo([...STEPS].reverse().find((x) => x < s - 1e-6) ?? fit);

  // Wheel and trackpad pinch zoom at the pointer (non-passive: the page itself never zooms).
  const live = useRef({});
  live.current = { zoomTo, s, nat };
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!live.current.nat) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      live.current.zoomTo(live.current.s * k, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [local]);
  // Keys: + / − / 0 / 1.
  useEffect(() => {
    const on = (e) => {
      if (!nat || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target?.closest?.('[role="menu"],[role="menuitem"]') || document.querySelector("[data-radix-popper-content-wrapper]")) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); stepUp(); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); stepDown(); }
      else if (e.key === "0") { e.preventDefault(); zoomTo(fit); }
      else if (e.key === "1") { e.preventDefault(); zoomTo(1); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });
  // Drag to move around a zoomed picture; two fingers on a touch screen pinch to zoom.
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const r = box.current.getBoundingClientRect();
      pinch.current = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, s, mx: (p1.x + p2.x) / 2 - r.left, my: (p1.y + p2.y) / 2 - r.top };
      drag.current = null;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (scale === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, c };
  };
  const onPointerMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      zoomTo(pinch.current.s * (d / pinch.current.d), pinch.current.mx, pinch.current.my);
      return;
    }
    const d = drag.current;
    if (!d) return;
    setCenter(keep(d.c.x - (e.clientX - d.x) / s, d.c.y - (e.clientY - d.y) / s, s));
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  };
  const onDoubleClick = (e) => {
    const r = box.current.getBoundingClientRect();
    if (scale === null) zoomTo(1, e.clientX - r.left, e.clientY - r.top);
    else zoomTo(fit);
  };

  if (!local) return <div className="relative h-full w-full"><img src={url} alt={alt} className="absolute inset-0 h-full w-full object-contain" /></div>;
  // No copy could be made (a picture over the preview limit): the original, loaded on purpose with its progress.
  const copySrc = dzThumb(url, view.w * (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) > 2048 ? 2880 : 2048);
  const w = nat ? nat.w * s : 0; const h = nat ? nat.h * s : 0;
  const left = view.w / 2 - c.x * s; const top = view.h / 2 - c.y * s;
  const showOrig = (scale !== null || copyFailed) && orig.state === "ready";
  const label = showOrig ? (nat ? `Original · ${nat.w} × ${nat.h}` : "Original") : orig.state === "loading" ? `Loading original… ${Math.round(orig.progress * 100)}%` : orig.state === "error" ? "The original did not load" : "Screen copy";
  return (
    <div ref={box} className={cn("relative h-full w-full touch-none select-none overflow-hidden", scale !== null && (drag.current ? "cursor-grabbing" : "cursor-grab"))}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}>
      {!nat ? (
        // The size is not known yet: the copy, fitted as before.
        <>
          {!copyReady && <img src={dzThumb(url, 480)} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-contain blur-[2px]" />}
          <img key={url} src={copySrc} alt={alt} draggable={false} onLoad={() => setCopyReady(true)} onError={() => { setCopyFailed(true); setWantOrig(true); }}
            className={cn("absolute inset-0 h-full w-full object-contain transition-opacity duration-state", copyReady ? "opacity-100" : "opacity-0")} />
          {showOrig && <img src={orig.src} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 h-full w-full object-contain" />}
        </>
      ) : (
        <div className="absolute" style={{ left, top, width: w, height: h }}>
          {!copyReady && <img src={dzThumb(url, 480)} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 h-full w-full blur-[2px]" />}
          <img key={url} src={copySrc} alt={alt} draggable={false} onLoad={() => setCopyReady(true)} onError={() => { setCopyFailed(true); setWantOrig(true); }}
            className={cn("absolute inset-0 h-full w-full transition-opacity duration-state", copyReady ? "opacity-100" : "opacity-0")} />
          {showOrig && <img src={orig.src} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 h-full w-full" style={{ imageRendering: s >= 2 ? "pixelated" : "auto" }} />}
        </div>
      )}
      {!copyReady && !showOrig && <Spinner className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 border-overlay-foreground/30 border-t-overlay-foreground" />}
      {nat && (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md bg-overlay/70 px-1.5 py-1 text-sm text-overlay-foreground" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Btn label="Zoom out (−)" onClick={stepDown}><Minus size={16} /></Btn>
          <button type="button" title="Fit (0) · 100 % (1)" onClick={() => zoomTo(scale === null ? 1 : fit)}
            className="h-8 min-w-14 rounded-md px-1.5 tabular-nums text-overlay-foreground/80 hover:bg-overlay-foreground/10 hover:text-overlay-foreground">{scale === null ? "Fit" : pct(s)}</button>
          <Btn label="Zoom in (+)" onClick={stepUp}><Plus size={16} /></Btn>
          <span className={cn("ml-1 flex items-center gap-1.5 whitespace-nowrap px-1.5 text-xs", showOrig ? "text-overlay-foreground" : "text-overlay-foreground/70")}>
            {orig.state === "loading" && <Spinner className="h-3 w-3 border-overlay-foreground/30 border-t-overlay-foreground" />}{label}
          </span>
        </div>
      )}
    </div>
  );
}

export default function StudioViewer({ item: given, items = [], onClose, onMove, act }) {
  useEscLayer(Boolean(given), onClose);
  // The item as the gallery has it now (a like changes it there), and a like pressed here shows at
  // once even when the gallery drops the item (the Liked tab) — package 14, A3.
  const [likedHere, setLikedHere] = useState({});
  const fresh0 = given ? items.find((i) => i.id === given.id) || given : null;
  // A texture re-render (handoff 17, §6) shows here at once, before the gallery reloads.
  const [texHere, setTexHere] = useState({});
  // A colour match or a switch back to the original (color-fidelity-answers.md) shows here at once too.
  const [colHere, setColHere] = useState({});
  const fresh1 = fresh0 && texHere[fresh0.id] && fresh0.url !== texHere[fresh0.id].url ? { ...fresh0, url: texHere[fresh0.id].url, outputs: [texHere[fresh0.id].url], texture: texHere[fresh0.id].texture } : fresh0;
  const fresh = fresh1 && colHere[fresh1.id]?.url && fresh1.url !== colHere[fresh1.id].url ? { ...fresh1, url: colHere[fresh1.id].url, outputs: [colHere[fresh1.id].url] } : fresh1;
  const item = fresh && likedHere[fresh.id] !== undefined ? { ...fresh, liked: likedHere[fresh.id] } : fresh;
  const [texBusy, setTexBusy] = useState(false);
  // "Match colour to source": what the server says about this picture (state, reason, offsets).
  const [colour, setColour] = useState(null);
  const [colBusy, setColBusy] = useState(false);
  const colourable = hasColourSource(given ? items.find((i) => i.id === given.id) || given : null);
  useEffect(() => {
    setColour(null);
    if (!given || !colourable) return undefined;
    let alive = true;
    dzLibrary.colour(given.id).then((r) => { if (alive) setColour(r); }).catch(() => {});
    return () => { alive = false; };
  }, [given?.id, colourable]); // eslint-disable-line react-hooks/exhaustive-deps
  const setColourTo = (to) => {
    if (!given || colBusy) return;
    const id = given.id;
    setColBusy(true);
    dzLibrary.setColour(id, to)
      .then((r) => { setColour(r); if (r.url) setColHere((m) => ({ ...m, [id]: { url: r.url } })); if (r.state === "no-shift") notify({ type: "notice", title: "No colour shift found", message: "The picture already matches its source. Nothing was changed." }); })
      .catch((e) => notify({ type: "error", title: "Colour not matched", message: e?.message || "Try again." }))
      .finally(() => setColBusy(false));
  };
  const retexture = (v) => {
    if (!item || texBusy) return;
    const id = item.id;
    setTexBusy(true);
    dzLibrary.texture(id, v)
      .then((r) => setTexHere((m) => ({ ...m, [id]: { url: r.url, texture: r.texture } })))
      .catch((e) => notify({ type: "error", title: "Texture not changed", message: e?.message || "Try again." }))
      .finally(() => setTexBusy(false));
  };
  // The override lives only while the view is open and until the gallery has the same state;
  // one like request per item at a time (a second click waits for the first).
  const liking = useRef(new Set());
  useEffect(() => { if (!given) setLikedHere({}); }, [given]);
  const freshLiked = fresh ? items.some((i) => i.id === fresh.id) && Boolean(fresh.liked) : null;
  useEffect(() => {
    if (!fresh || likedHere[fresh.id] === undefined || liking.current.has(fresh.id)) return;
    if (items.some((i) => i.id === fresh.id) && freshLiked === likedHere[fresh.id]) setLikedHere(({ [fresh.id]: _d, ...rest }) => rest);
  }, [fresh?.id, freshLiked, likedHere]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleLike = () => {
    if (!item || liking.current.has(item.id)) return;
    const id = item.id;
    const was = Boolean(item.liked);
    liking.current.add(id);
    setLikedHere((m) => ({ ...m, [id]: !was }));
    Promise.resolve(act.like(item))
      .catch(() => setLikedHere((m) => ({ ...m, [id]: was })))
      .finally(() => { liking.current.delete(id); });
  };
  const [tab, setTab] = useState("details");
  const [size, setSize] = useState(null);
  useEffect(() => { setTab("details"); setSize(null); }, [item?.id]);
  // The original picture's size (the large view shows a screen-size copy).
  useEffect(() => {
    if (!item?.url || item.kind === "video" || !item.url.startsWith("/media/")) return undefined;
    let alive = true;
    fetch(`${item.url}${item.url.includes("?") ? "&" : "?"}info=1`, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.width) setSize({ w: j.width, h: j.height }); }).catch(() => {});
    return () => { alive = false; };
  }, [item?.url, item?.kind]);
  const list = useMemo(() => items.filter((i) => i.url && i.kind !== "audio"), [items]);
  const index = item ? list.findIndex((i) => i.id === item.id) : -1;
  const go = (d) => { const next = list[index + d]; if (next) onMove(next); };
  useEffect(() => {
    if (!item) return undefined;
    const on = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
      // Arrows inside an open menu move in the menu, not to another item.
      if (e.target?.closest?.('[role="menu"],[role="menuitem"]') || document.querySelector("[data-radix-popper-content-wrapper]")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const meta = item?.meta || {};
  const tags = useMemo(() => {
    try { return promptTags({ attached: meta.attached || {} }); } catch { return []; }
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  const isVideo = item.kind === "video";
  const prompt = meta.prompt || item.prompt || "";
  const attachedList = Object.entries(meta.attached || {}).flatMap(([role, files]) => (Array.isArray(files) ? files.map((f) => ({ ...f, role })) : []));
  const refTitle = isVideo && attachedList.every((f) => ["first", "middle", "last"].includes(f.role)) ? "Frames" : "References";
  // Children by the item's own link without its version part (-t<n> / -c<n>), so a texture or colour
  // version does not hide the edits made from it.
  const baseOf = (u) => String(u || "").replace(/^(\/media\/g\/[A-Za-z0-9_-]+\/\d+)(?:-[tc]\d+)?\.[a-z0-9]+.*$/i, "$1");
  const same = (u) => Boolean(u) && baseOf(u) === baseOf(item.url);
  const versions = list.filter((i) => i.id !== item.id && (i.meta?.frameOf === item.id || same(i.meta?.upscale?.source) || same(i.params?.image_url)
    || (i.meta?.attached?.edit || []).some((f) => same(f.url))));
  const ratio = item.params?.aspect_ratio || item.params?.ratio || meta.values?.aspect_ratio || meta.values?.ratio;
  const res = item.params?.resolution || meta.values?.resolution || item.params?.quality;
  const duration = Number(item.params?.duration || meta.values?.duration) || 0;
  const sound = [item.params?.generate_audio, item.params?.audio, meta.values?.generate_audio].find((x) => typeof x === "boolean");
  const seed = item.params?.seed ?? meta.values?.seed;
  const sizeText = isVideo
    ? [ratio, res, duration ? `${duration} s` : ""].filter(Boolean).join(" · ")
    : [ratio, size ? `${size.w} × ${size.h}` : ""].filter(Boolean).join(" · ");
  const rows = [
    ["Model", meta.modelName || item.provider_model || ""],
    ["Size", sizeText],
    ...(isVideo && sound != null ? [["Sound", sound ? "On" : "Off"]] : []),
    ...(seed != null && seed !== "" ? [["Seed", String(seed)]] : []),
    ["Made", fmtDate(item.created_at)],
    ["Cost", fmtUsd(item.cost_usd)],
  ].filter(([, v]) => v);
  const canUp = isVideo ? dzVideoUpscaleSpec() && dzIsOwnImage(item.url) : dzUpscaleSpec() && dzIsOwnImage(item.url);
  const openAttached = (f) => {
    const found = items.find((i) => i.url === f.url);
    onMove(found || { id: `att-${f.url}`, url: f.url, kind: /\.(mp4|mov|webm)$/i.test(f.url) ? "video" : "image", prompt: f.name || "", meta: {} });
  };
  const real = !String(item.id).startsWith("att-");
  return (
    <div ref={dzScrollBoxRef} className="fixed inset-0 z-[150] flex bg-scrim backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={isVideo ? "Video" : "Picture"}>
      <div className="relative flex min-w-0 flex-1 flex-col bg-overlay/95 px-6 pb-5 pt-3 text-overlay-foreground">
        <div className="flex h-10 flex-shrink-0 items-center gap-2">
          <IconBtn label="Close" onClick={onClose}><X size={18} /></IconBtn>
          {index >= 0 && <span className="text-sm tabular-nums text-overlay-foreground/70">{index + 1} of {list.length}{act.hasMore ? "+" : ""}</span>}
          <span className="flex-1" />
          {/* Storyboard working screen (package 09, P1): green "Approved" while approved; a click removes it. */}
          {act.approve && !String(item.id).startsWith("att-") && (() => {
            const on = act.isApproved(item);
            return (
              <button type="button" onClick={() => act.approve(item)} aria-pressed={on}
                className={cn("mr-1 flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors duration-state", on ? "border-transparent bg-success text-overlay-foreground hover:bg-success/85" : "border-overlay-foreground/25 text-overlay-foreground hover:bg-overlay-foreground/10")}>
                <Check size={16} weight="bold" />{on ? "Approved" : "Approve"}
              </button>
            );
          })()}
          {real && <IconBtn label={item.liked ? "Unlike" : "Like"} onClick={toggleLike}><Heart size={18} weight={item.liked ? "fill" : "regular"} /></IconBtn>}
          <IconBtn label="Download" onClick={() => download(item.url)}><DownloadSimple size={18} /></IconBtn>
          {real && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label="More" className="flex h-8 w-8 items-center justify-center rounded-md text-overlay-foreground/80 hover:bg-overlay-foreground/10 hover:text-overlay-foreground"><DotsThree size={18} weight="bold" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="z-[160] w-[220px] p-1.5">
                {!isVideo && act.openEditor && <DropdownMenuItem className="h-8 gap-2.5" onSelect={() => { onClose(); act.openEditor(item.url); }}><PencilLine size={16} />Open in editor</DropdownMenuItem>}
                {!isVideo && <DropdownMenuItem className="h-8 gap-2.5" onSelect={() => window.dispatchEvent(new CustomEvent("dz:to-element", { detail: { items: [item] } }))}><Shapes size={16} />Make element</DropdownMenuItem>}
                {prompt && <DropdownMenuItem className="h-8 gap-2.5" onSelect={() => navigator.clipboard?.writeText(prompt).then(() => notify({ type: "notice", title: "Copied", message: "The prompt is on the clipboard." }), () => {})}><Copy size={16} />Copy prompt</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="h-8 gap-2.5 text-destructive focus:text-destructive" onSelect={async () => {
                  const next = list[index + 1] || list[index - 1];
                  try { await act.trashStrict(item); } catch (e) { notify({ type: "error", title: "Trash", message: String(e?.message || e) }); return; }
                  if (next) onMove(next); else onClose();
                }}><Trash size={16} />Move to Trash</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center pt-3">
          {isVideo ? <VideoPlayer key={item.id} item={item} act={act} /> : (
            <div className="flex min-h-0 w-full flex-1 items-center justify-center">
              <ScreenImage key={item.url} url={item.url} alt={prompt.slice(0, 80) || "Picture"} />
            </div>
          )}
          {!isVideo && list.length > 1 && (
            // Neighbours from the same grid; the current one is marked with --signal.
            // The frame of the current one is drawn inside the tile: the row clips anything outside.
            <div className="mt-4 flex max-w-full gap-1.5 overflow-hidden">
              {list.slice(Math.max(0, index - 3), Math.max(0, index - 3) + 7).map((n) => (
                <button key={n.id} type="button" onClick={() => onMove(n)} aria-label="Open"
                  className={cn("relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md", n.id === item.id ? "after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:outline after:outline-2 after:-outline-offset-2 after:outline-signal" : "opacity-70 hover:opacity-100")}>
                  {n.kind === "video" ? <img src={dzThumb(n.url, 128)} alt="" className="h-full w-full object-cover" /> : <img src={dzThumb(n.url, 128)} alt="" className="h-full w-full object-cover" />}
                </button>
              ))}
            </div>
          )}
          {/* The neighbours warm up (package 10, M4): a video's first bytes only (its index and first
              frames), a picture's screen-size copy; never whole files. */}
          {[list[index - 1], list[index + 1]].filter(Boolean).map((n) => (n.kind === "video"
            ? <video key={`warm-${n.id}`} src={dzPlay(n.url)} preload="metadata" muted playsInline aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute h-px w-px opacity-0" />
            : n.url?.startsWith("/media/") ? <img key={`warm-${n.id}`} src={dzThumb(n.url, screenWidth())} alt="" aria-hidden="true" className="pointer-events-none absolute h-px w-px opacity-0" /> : null))}
          {index > 0 && <button type="button" onClick={() => go(-1)} aria-label="Previous" className="absolute left-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-overlay-foreground/20 bg-overlay/60 hover:bg-overlay-foreground/10"><CaretLeft size={18} /></button>}
          {index >= 0 && index < list.length - 1 && <button type="button" onClick={() => go(1)} aria-label="Next" className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-overlay-foreground/20 bg-overlay/60 hover:bg-overlay-foreground/10"><CaretRight size={18} /></button>}
        </div>
      </div>

      <aside className="custom-scrollbar flex w-[360px] flex-shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
        <div className="flex h-12 flex-shrink-0 items-end gap-5 border-b border-border px-5">
          {[["details", "Details"], ["versions", `Versions${versions.length ? ` ${versions.length}` : ""}`]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setTab(v)} className={cn("-mb-px h-10 border-b-2 text-base font-medium", tab === v ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        {tab === "details" ? (
          <div className="flex flex-col gap-5 p-5">
            {prompt && (
              <section>
                <Overline className="mb-2 block">Prompt</Overline>
                <PromptText text={prompt} tags={tags} />
                <div className="mt-2 flex flex-wrap gap-1">
                  <button type="button" onClick={() => navigator.clipboard?.writeText(prompt).then(() => notify({ type: "notice", title: "Copied", message: "The prompt is on the clipboard." }), () => {})}
                    className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><Copy size={16} />Copy</button>
                  {meta.entryKey && <button type="button" onClick={() => { onClose(); act.reuse(item); }} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowCounterClockwise size={16} />Reuse prompt and settings</button>}
                </div>
              </section>
            )}
            {attachedList.length > 0 && (
              <section>
                <Overline className="mb-2 block">{refTitle} · {attachedList.length}</Overline>
                <div className="flex flex-wrap gap-1.5">
                  {attachedList.map((f) => (
                    <button key={`${f.role}-${f.url}`} type="button" onClick={() => openAttached(f)} title={f.name || f.role} className="h-11 w-11 overflow-hidden rounded-md bg-muted hover:ring-2 hover:ring-signal">
                      <img src={dzThumb(f.url, 96)} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </section>
            )}
            {checkBadges(item).length > 0 && (
              <section>
                <Overline className="mb-2 block">Checked after generation</Overline>
                {checkBadges(item).map((b) => (
                  <div key={b.id} className="flex items-start gap-2 text-sm">
                    <span className={cn("mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full", b.quiet ? "bg-muted-foreground/40" : "bg-warning")} />
                    <span><span className="font-semibold">{b.text}.</span> <span className="text-muted-foreground">{b.note}</span>
                      {!b.quiet && !b.noRetry && act.again && meta.entryKey && item.mine !== false && <button type="button" onClick={() => { onClose(); act.again(item); }} className="ml-1.5 font-semibold underline decoration-input underline-offset-[3px]">Retry</button>}
                    </span>
                  </div>
                ))}
              </section>
            )}
            {colour && ["matched", "original", "unavailable", "no-shift"].includes(colour.state) && (
              <section>
                <Overline className="mb-2 block">Colour</Overline>
                <p className="text-sm">{colourLine(colour)}
                  {colour.state === "matched" && item.mine !== false && <button type="button" disabled={colBusy} onClick={() => setColourTo("original")} className="ml-1.5 font-semibold underline decoration-input underline-offset-[3px] disabled:opacity-40">Show original</button>}
                  {colour.state === "original" && item.mine !== false && <button type="button" disabled={colBusy} onClick={() => setColourTo("matched")} className="ml-1.5 font-semibold underline decoration-input underline-offset-[3px] disabled:opacity-40">Use matched colour</button>}
                </p>
              </section>
            )}
            {isVideo && item.texture && item.mine !== false && (
              <section>
                <TextureControl preset={item.texture.preset} value={{ on: item.texture.on, strength: item.texture.strength }} busy={texBusy} onCommit={retexture} />
              </section>
            )}
            {rows.length > 0 && (
              <dl className="grid grid-cols-[104px_1fr] gap-y-1.5 text-sm">
                {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
              </dl>
            )}
            {real && (
              <section>
                <Overline className="mb-2 block">Use it</Overline>
                <div className="grid grid-cols-2 gap-2">
                  {isVideo ? (
                    <>
                      <Action icon={ArrowLineRight} onClick={() => { onClose(); act.continueFrom(item); }}>Continue</Action>
                      {canUp && <Action icon={ArrowsOutSimple} onClick={() => { onClose(); dzOpenVideoUpscale(item.url); }}>Upscale</Action>}
                      <Action icon={Flag} onClick={() => { onClose(); act.firstAsStart(item); }}>First frame</Action>
                      {/* "To Storyboard" is hidden until Storyboard is rebuilt (§6). */}
                    </>
                  ) : (
                    <>
                      <Action icon={ImageSquare} onClick={() => { act.useRef(item); }}>As reference</Action>
                      <Action icon={PencilSimple} onClick={() => { onClose(); act.edit(item); }}>Edit</Action>
                      <Action icon={VideoCamera} onClick={() => { onClose(); act.makeVideo(item); }}>Make video</Action>
                      {canUp && <Action icon={ArrowsOutSimple} onClick={() => { onClose(); dzOpenUpscale(item.url); }}>Upscale</Action>}
                      {colourable && item.mine !== false && colour && ["ready", "no-shift", "unavailable"].includes(colour.state) && (
                        <Action icon={colBusy ? Spinner : Drop} disabled={colBusy || colour.state === "unavailable"} title={colour.state === "unavailable" ? colour.reason : "Remove a colour cast the edit added, measured against the first picture of the chain. The original stays in Versions."} onClick={() => setColourTo("match")}>Match colour to source</Action>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-5">
            {colour && ["matched", "original"].includes(colour.state) && [["matched", "Matched colour", `${colour.words} removed`], ["original", "Provider original", "As the model returned it"]].map(([st, label, sub]) => (
              <button key={st} type="button" disabled={colBusy || colour.state === st || item.mine === false} onClick={() => setColourTo(st)} className="flex items-center gap-3 rounded-md p-1.5 text-left hover:bg-accent disabled:hover:bg-transparent">
                <span className={cn("flex h-12 w-12 items-center justify-center rounded-md border", colour.state === st ? "border-foreground" : "border-border")}><Drop size={18} /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{label}{colour.state === st ? " · shown" : ""}</span>
                  <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                </span>
              </button>
            ))}
            {versions.length === 0 && !(colour && ["matched", "original"].includes(colour.state)) && <p className="text-sm text-muted-foreground">No edits, upscales or saved frames of this one in view yet.</p>}
            {versions.map((v) => (
              <button key={v.id} type="button" onClick={() => onMove(v)} className="flex items-center gap-3 rounded-md p-1.5 text-left hover:bg-accent">
                <img src={dzThumb(v.url, 96)} alt="" className="h-12 w-12 rounded-md object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{v.studio === "upscale" ? "Upscaled" : v.meta?.frameOf ? "Saved frame" : "Edit"}</span>
                  <span className="block truncate text-xs text-muted-foreground">{fmtDate(v.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
