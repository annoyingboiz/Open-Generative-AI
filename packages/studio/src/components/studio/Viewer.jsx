"use client";

// One viewer for Studio, Image and Video (package 03, §6). Left: the media as large
// as it fits, a strip under it (neighbours for a picture, frames for a video),
// ← → to the neighbours. Right (360 px): Details / Versions, prompt with its tags,
// what was attached, model, size, seed, date, price, then what you can do with it.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  X, CaretLeft, CaretRight, Heart, DownloadSimple, DotsThree, Copy, ArrowCounterClockwise, ImageSquare, PencilSimple, VideoCamera,
  ArrowsOutSimple, ArrowLineRight, Flag, Play, Pause, Repeat, SpeakerHigh, SpeakerSlash, CornersOut, FrameCorners, Trash, Shapes, PaintBrush,
} from "@phosphor-icons/react";
import { DropdownMenuParts, cn } from "../../ui/index.js";
import { dzThumb } from "../../api.js";
import { dzOpenUpscale, dzUpscaleSpec, dzIsOwnImage, dzVideoUpscaleSpec, dzOpenVideoUpscale } from "../../dzCatalog.js";
import { promptTags, TAG_RE } from "../../dzCreate.js";
import { Overline, useEscLayer, fmtDur } from "./ui.jsx";
import { download } from "../DzCreateStudio.jsx";

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

// A row of thumbnails along the video, made in the browser from the file itself.
function useFrameStrip(url, n = 12) {
  const [frames, setFrames] = useState([]);
  useEffect(() => {
    setFrames([]);
    if (!url) return undefined;
    let alive = true;
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.src = url;
    const out = [];
    const canvas = document.createElement("canvas");
    const grab = async () => {
      const d = v.duration;
      if (!d || !Number.isFinite(d)) return;
      canvas.width = 128;
      canvas.height = Math.round(128 * (v.videoHeight / v.videoWidth || 9 / 16));
      for (let i = 0; i < n && alive; i += 1) {
        await new Promise((resolve) => { v.onseeked = resolve; v.currentTime = Math.min(d - 0.05, (d * (i + 0.5)) / n); });
        try { canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height); out.push(canvas.toDataURL("image/jpeg", 0.6)); } catch { return; }
        if (alive) setFrames([...out]);
      }
    };
    v.addEventListener("loadedmetadata", grab, { once: true });
    return () => { alive = false; v.removeAttribute("src"); v.load(); };
  }, [url, n]);
  return frames;
}

function VideoPlayer({ item, act }) {
  const ref = useRef(null);
  const box = useRef(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);
  const [muted, setMuted] = useState(true);
  const frames = useFrameStrip(item.url);
  const v = () => ref.current;
  const step = (n) => { const el = v(); if (!el) return; el.pause(); setPlaying(false); el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + n / FPS)); };
  const Btn = ({ label, children, onClick, on }) => (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cn("flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-overlay-foreground/80 transition-colors duration-state hover:bg-overlay-foreground/10 hover:text-overlay-foreground", on && "text-overlay-foreground")}>{children}</button>
  );
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div ref={box} className="flex min-h-0 flex-1 items-center justify-center bg-overlay">
        <video ref={ref} src={item.url} autoPlay muted={muted} loop={loop} playsInline className="max-h-full max-w-full rounded-md"
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={() => { const el = v(); if (el.paused) el.play(); else el.pause(); }} />
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
        <Btn label={loop ? "Loop on" : "Loop off"} on={loop} onClick={() => setLoop((x) => !x)}><Repeat size={16} className={loop ? "" : "opacity-50"} /></Btn>
        <Btn label={muted ? "Sound off" : "Sound on"} onClick={() => setMuted((x) => !x)}>{muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}</Btn>
        <Btn label="Full screen" onClick={() => (box.current?.requestFullscreen?.() || v()?.webkitEnterFullscreen?.())}><CornersOut size={16} /></Btn>
      </div>
    </div>
  );
}

export default function StudioViewer({ item, items = [], onClose, onMove, act }) {
  useEscLayer(Boolean(item), onClose);
  const [tab, setTab] = useState("details");
  const [size, setSize] = useState(null);
  useEffect(() => { setTab("details"); setSize(null); }, [item?.id]);
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
  const versions = list.filter((i) => i.id !== item.id && (i.meta?.frameOf === item.id || i.meta?.upscale?.source === item.url || i.params?.image_url === item.url
    || (i.meta?.attached?.edit || []).some((f) => f.url === item.url)));
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
  const Action = ({ icon: Icon, children, onClick }) => (
    <button type="button" onClick={onClick} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"><Icon size={16} />{children}</button>
  );
  const openAttached = (f) => {
    const found = items.find((i) => i.url === f.url);
    onMove(found || { id: `att-${f.url}`, url: f.url, kind: /\.(mp4|mov|webm)$/i.test(f.url) ? "video" : "image", prompt: f.name || "", meta: {} });
  };
  const IconBtn = ({ label, children, onClick }) => (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded-md text-overlay-foreground/80 hover:bg-overlay-foreground/10 hover:text-overlay-foreground">{children}</button>
  );
  const real = !String(item.id).startsWith("att-");
  return (
    <div className="fixed inset-0 z-[150] flex bg-scrim backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={isVideo ? "Video" : "Picture"}>
      <div className="relative flex min-w-0 flex-1 flex-col bg-overlay/95 px-6 pb-5 pt-3 text-overlay-foreground">
        <div className="flex h-10 flex-shrink-0 items-center gap-2">
          <IconBtn label="Close" onClick={onClose}><X size={18} /></IconBtn>
          {index >= 0 && <span className="text-sm tabular-nums text-overlay-foreground/70">{index + 1} of {list.length}{act.hasMore ? "+" : ""}</span>}
          <span className="flex-1" />
          {real && <IconBtn label={item.liked ? "Unlike" : "Like"} onClick={() => act.like(item)}><Heart size={18} weight={item.liked ? "fill" : "regular"} className={item.liked ? "text-signal" : ""} /></IconBtn>}
          <IconBtn label="Download" onClick={() => download(item.url)}><DownloadSimple size={18} /></IconBtn>
          {real && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label="More" className="flex h-8 w-8 items-center justify-center rounded-md text-overlay-foreground/80 hover:bg-overlay-foreground/10 hover:text-overlay-foreground"><DotsThree size={18} weight="bold" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="z-[160] w-[220px] p-1.5">
                {!isVideo && <DropdownMenuItem className="h-8 gap-2.5" onSelect={() => { onClose(); act.draw(item.url); }}><PaintBrush size={16} />Draw to edit…</DropdownMenuItem>}
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
              <img src={item.url} alt={prompt.slice(0, 80) || "Picture"} className="max-h-full max-w-full rounded-md object-contain"
                onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
            </div>
          )}
          {!isVideo && list.length > 1 && (
            // Neighbours from the same grid; the current one is marked with --signal.
            <div className="mt-4 flex max-w-full gap-1.5 overflow-hidden">
              {list.slice(Math.max(0, index - 3), Math.max(0, index - 3) + 7).map((n) => (
                <button key={n.id} type="button" onClick={() => onMove(n)} aria-label="Open"
                  className={cn("h-12 w-12 flex-shrink-0 overflow-hidden rounded-md", n.id === item.id ? "ring-2 ring-signal" : "opacity-70 hover:opacity-100")}>
                  {n.kind === "video" ? <img src={dzThumb(n.url, 128)} alt="" className="h-full w-full object-cover" /> : <img src={dzThumb(n.url, 128)} alt="" className="h-full w-full object-cover" />}
                </button>
              ))}
            </div>
          )}
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
                    </>
                  )}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-5">
            {versions.length === 0 && <p className="text-sm text-muted-foreground">No edits, upscales or saved frames of this one in view yet.</p>}
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
