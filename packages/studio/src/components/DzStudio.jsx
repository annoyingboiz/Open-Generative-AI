"use client";

// DZ: Studio — redesign package 01 (docs/ux/handoff/01-studio, §5). The work grid
// fills the screen; the composer floats over its bottom. The engine (models,
// attachments, price, generate, history) is the same as Image / Video
// (useDzCreateEngine); this file is only how the Studio looks and behaves.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Minus, At, X, Check, Cube, Rectangle, Monitor, Clock, VideoCamera, Images, MagicWand, Camera, ArrowsOutCardinal, Palette, SlidersHorizontal,
  Heart, DotsThree, ArrowsOut, ArrowSquareUp, DownloadSimple, Shapes, Trash, FolderSimple, Copy, UploadSimple, FilmSlate, ImageSquare, Flag, CaretDown, Info, Warning, ArrowsClockwise, ArrowElbowDownRight, ArrowLineRight, ArrowsOutSimple, LockSimple, PencilSimple, ArrowRight, ArrowClockwise, ArrowCounterClockwise, FrameCorners, ArrowUUpLeft,
} from "@phosphor-icons/react";
import { dzThumb } from "../api.js";
import { dzLibrary } from "../dzLibrary.js";
import { dzOpenUpscale, dzUpscaleSpec, dzIsOwnImage, dzVideoUpscaleSpec, dzOpenVideoUpscale } from "../dzCatalog.js";
import { useDzCreateEngine, fmtUsd, download, DZ_SEND_EVENT } from "./DzCreateStudio.jsx";
import StudioViewer from "./studio/Viewer.jsx";
import DzSentPanel from "./DzSentPanel.jsx";
import DrawModal from "./DrawModal.jsx";
import { lookData, autoLook, elementTags, elementFits, TAG_RE, buildBody, paramsOf, splitEdit } from "../dzCreate.js";
import { DropdownMenuParts, Spinner, cn } from "../ui/index.js";
import { Overline, Chip, ChipMenu, MenuRow, useEscLayer, fmtDur } from "./studio/ui.jsx";
import { groupsFor, groupItems, addToGroup, removeFromGroup } from "./studio/attachments.js";
import ModelMenu from "./studio/ModelMenu.jsx";
import PromptEditor from "./studio/PromptEditor.jsx";
import { LibraryWindow, FullList } from "./studio/Library.jsx";
import { dzRetry, dzFrame, useSeen, plainError, usualMinutes, refreshHistory } from "./studio/actions.js";
import { CameraLookPanel, MovePanel, LookPanel, SettingsPanel, AdaptPanel } from "./studio/Panels.jsx";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } = DropdownMenuParts;
const RATIO_KEYS = ["aspect_ratio", "ratio", "size", "image_size"];
const RES_KEYS = ["resolution", "quality"];
const RATIO_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;
const ratioNum = (v) => { const m = RATIO_RE.exec(String(v || "")); return m ? Number(m[1]) / Number(m[2]) : null; };
const shapeWord = (v) => { const r = ratioNum(v); return r == null ? "" : r > 1.05 ? "Landscape" : r < 0.95 ? "Vertical" : "Square"; };
const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));
const TITLE = { create: "Studio", image: "Image", video: "Video" };
const STUDIO_TABS = [["all", "All"], ["image", "Images"], ["video", "Videos"]];
const LIGHT_TABS = [["all", "All"], ["liked", "Liked"], ["upscaled", "Upscaled"]];
const EXAMPLES = {
  image: ["A brass desk lamp on a walnut table, soft window light", "Portrait of a bartender, low-key light, 85mm, film grain", "Product shot: a rock glass on black marble, one hard light"],
  video: ["A paper boat drifts down a rainy street gutter, camera follows low", "Steam rises from a coffee cup on a window sill, slow push-in", "Night drive through a neon city, light trails, handheld"],
};
// Composer width (package 02 §2.2, package 03 §2): clamp(min, content − 48, max).
const COMPOSER_W = { create: "w-[clamp(960px,100%,1320px)]", image: "w-[clamp(760px,100%,960px)]", video: "w-[clamp(840px,100%,1040px)]" };
const EXAMPLE = "A bartender in a small neighbourhood bar at night polishes a glass, rain on the windows, neon reflections on the wet counter. Slow dolly in from a medium shot to a close-up.";

// ── Grid ────────────────────────────────────────────────────────────────────
function useAspects() {
  const [map, setMap] = useState({});
  const set = (id, w, h) => { if (w && h) setMap((m) => (m[id] ? m : { ...m, [id]: w / h })); };
  return [map, set];
}
// Justified rows (§5.1): row height clamp(200px, 24% of the grid width, 560px); every row
// but the last fills the width exactly, keeping each picture's own shape.
const GAP = 6;
function justify(items, aspects, width) {
  if (!width) return [];
  const target = Math.min(560, Math.max(200, width * 0.24));
  const rows = [];
  let row = [];
  let sum = 0;
  for (const item of items) {
    const a = Math.min(4, Math.max(0.3, itemAspect(item, aspects)));
    row.push({ item, a });
    sum += a;
    const natural = sum * target + GAP * (row.length - 1);
    if (natural >= width) {
      const h = (width - GAP * (row.length - 1)) / sum;
      rows.push({ h, cells: row.map((c) => ({ ...c, w: c.a * h })) });
      row = [];
      sum = 0;
    }
  }
  if (row.length) rows.push({ h: target, cells: row.map((c) => ({ ...c, w: c.a * target })), last: true });
  return rows;
}
function useWidth(el) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}
const itemAspect = (item, measured) => measured[item.id] || ratioNum(item.params?.aspect_ratio || item.params?.ratio || item.params?.size || item.meta?.values?.aspect_ratio) || (item.kind === "video" ? 16 / 9 : 1);

// A tile still on its way, or one that failed (package 03, §3.3, §4).
function PendingTile({ item, items, act }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const waiting = item.note && /wait|queue|gpu/i.test(item.note);
  const batch = item.meta?.batch;
  if (item.status === "failed") {
    return (
      <div className="flex h-full w-full flex-col justify-end gap-1.5 rounded-sm bg-card p-3 shadow-[inset_0_0_0_1px_hsl(var(--destructive)/.45)]">
        <span className="flex items-center gap-1.5 text-base font-semibold text-destructive"><Warning size={16} />Couldn't generate</span>
        <span className="line-clamp-4 text-sm text-muted-foreground" title={item.error || ""}>{plainError(item.error)}{!item.cost_final ? " Nothing was charged." : ""}</span>
        <span className="mt-1 flex items-center gap-1">
          {item.mine !== false && <button type="button" onClick={(e) => { e.stopPropagation(); act.retry(item); }} className="h-7 rounded-md border border-border bg-background/60 px-2.5 text-sm font-medium hover:bg-accent">Retry</button>}
          {item.meta?.entryKey && <button type="button" onClick={(e) => { e.stopPropagation(); act.editPrompt(item); }} className="h-7 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Edit prompt</button>}
        </span>
      </div>
    );
  }
  const usual = item.kind === "video" ? usualMinutes(items, item) : null;
  return (
    <div className="relative flex h-full w-full flex-col justify-end gap-0.5 bg-card p-3" title="It keeps going if you close the page">
      {!waiting && <span className="dz-shimmer absolute inset-0" aria-hidden="true" />}
      {batch?.n > 1 && <span className="absolute right-2.5 top-2 text-xs tabular-nums text-muted-foreground">{batch.i + 1} of {batch.n}</span>}
      {waiting ? (
        <>
          <span className="relative flex items-center gap-2 text-base font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-warning" /> Waiting for the GPU</span>
          <span className="relative line-clamp-2 text-sm text-muted-foreground">{item.note.replace(/^Waiting for the GPU:?\s*/i, "")}</span>
          <span className="relative mt-1 flex gap-1">
            {/* "Open tasks": there is no Tasks panel yet (package 01, open question 5) — only Cancel for now. */}
            {item.cancellable && <button type="button" onClick={(e) => { e.stopPropagation(); act.cancel(item); }} className="h-7 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Cancel</button>}
          </span>
        </>
      ) : (
        <>
          <span className="relative text-base font-semibold">{item.studio === "upscale" ? "Upscaling" : "Generating"}</span>
          <span className="relative truncate text-sm text-muted-foreground">{[item.meta?.modelName?.split(" · ")[0], item.created_at ? fmtDur((now - item.created_at) / 1000) : "", usual ? `usually about ${usual} min` : ""].filter(Boolean).join(" · ")}</span>
          {item.cancellable && (
            <button type="button" onClick={(e) => { e.stopPropagation(); act.cancel(item); }}
              className="relative mt-1.5 h-7 self-start rounded-md border border-border bg-background/60 px-2.5 text-sm font-medium opacity-0 transition-opacity duration-state hover:bg-accent group-hover:opacity-100 focus:opacity-100">Cancel</button>
          )}
        </>
      )}
    </div>
  );
}

// Tile menus (package 03, §5): pictures and videos have their own lists; the same in every tab.
function TileMenu({ item, act, open, setOpen, timeOf }) {
  const isVideo = item.kind === "video";
  const canUp = isVideo ? dzVideoUpscaleSpec() && dzIsOwnImage(item.url) : dzUpscaleSpec() && dzIsOwnImage(item.url);
  const Row = ({ icon: Icon, children, onSelect, danger }) => (
    <DropdownMenuItem onSelect={onSelect} className={cn("h-8 gap-2.5 px-2.5", danger && "text-destructive focus:text-destructive")}><Icon size={16} />{children}</DropdownMenuItem>
  );
  const prompt = item.meta?.prompt || item.prompt || "";
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="More" onClick={(e) => e.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-overlay/55 text-overlay-foreground backdrop-blur-md transition-colors duration-state hover:bg-overlay/75"><DotsThree size={16} weight="bold" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[236px] p-1.5" onClick={(e) => e.stopPropagation()}>
        <Row icon={ArrowsOut} onSelect={() => act.open(item)}>Open</Row>
        {isVideo ? (
          <>
            <Row icon={ArrowLineRight} onSelect={() => act.continueFrom(item)}>Continue from the last frame</Row>
            <Row icon={Flag} onSelect={() => act.firstAsStart(item)}>Use first frame as start</Row>
            <Row icon={FrameCorners} onSelect={() => act.saveFrame(item, timeOf?.())}>Save a frame as a picture</Row>
          </>
        ) : (
          <>
            <Row icon={ImageSquare} onSelect={() => act.useRef(item)}>Use as reference</Row>
            <Row icon={PencilSimple} onSelect={() => act.edit(item)}>Edit this picture</Row>
            <Row icon={VideoCamera} onSelect={() => act.makeVideo(item)}>Make video</Row>
          </>
        )}
        {canUp && <Row icon={ArrowSquareUp} onSelect={() => (isVideo ? dzOpenVideoUpscale(item.url) : dzOpenUpscale(item.url))}>Upscale</Row>}
        {!isVideo && <Row icon={Shapes} onSelect={() => window.dispatchEvent(new CustomEvent("dz:to-element", { detail: { items: [item] } }))}>Make element</Row>}
        {item.meta?.entryKey && <Row icon={ArrowCounterClockwise} onSelect={() => act.reuse(item)}>Reuse prompt and settings</Row>}
        {prompt && <Row icon={Copy} onSelect={() => { navigator.clipboard?.writeText(prompt).then(() => notify({ type: "notice", title: "Copied", message: "The prompt is on the clipboard." }), () => {}); }}>Copy prompt</Row>}
        <Row icon={DownloadSimple} onSelect={() => download(item.url)}>Download</Row>
        <DropdownMenuSeparator />
        <Row icon={Trash} danger onSelect={() => act.trash(item)}>Move to Trash</Row>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Quick actions (§5): up to three icon-only round buttons, bottom left, with tooltips.
function QuickActions({ item, act, timeOf }) {
  const isVideo = item.kind === "video";
  const canUp = isVideo ? dzVideoUpscaleSpec() && dzIsOwnImage(item.url) : dzUpscaleSpec() && dzIsOwnImage(item.url);
  const list = isVideo
    ? [[ArrowLineRight, "Continue from the last frame", () => act.continueFrom(item)], [FrameCorners, "Save a frame as a picture", () => act.saveFrame(item, timeOf?.())], canUp && [ArrowsOutSimple, "Upscale", () => dzOpenVideoUpscale(item.url)]]
    : [[ImageSquare, "Use as reference", () => act.useRef(item)], [VideoCamera, "Make video", () => act.makeVideo(item)], canUp && [ArrowsOutSimple, "Upscale", () => dzOpenUpscale(item.url)]];
  return (
    <div className="absolute bottom-2 left-2 flex gap-1">
      {list.filter(Boolean).map(([Icon, label, run]) => (
        <span key={label} className="group/q relative">
          <button type="button" aria-label={label} onClick={(e) => { e.stopPropagation(); run(e); }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-overlay/55 text-overlay-foreground backdrop-blur-md transition-colors duration-state hover:bg-overlay/75"><Icon size={14} /></button>
          <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-0 z-10 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-popover transition-opacity duration-state group-hover/q:opacity-100">{label}</span>
        </span>
      ))}
    </div>
  );
}

function Tile({ item, items, width, height, onMeasure, sel, act, isNew, markSeen, onMenu }) {
  const [menu, setMenuState] = useState(false);
  const setMenu = (v) => { setMenuState(v); onMenu?.(v); };
  const [progress, setProgress] = useState(0);
  const videoRef = useRef(null);
  const selecting = sel.selecting;
  const on = sel.has(item.id);
  const done = Boolean(item.url);
  const fresh = done && isNew(item);
  const duration = item.kind === "video" ? Number(item.params?.duration || item.meta?.values?.duration) : 0;
  // A video plays muted from the start on hover, with a 2 px progress line; leaving stops it on the poster.
  const enter = () => {
    if (fresh) markSeen(item);
    const v = videoRef.current;
    if (v) { v.currentTime = 0; v.play().catch(() => {}); }
  };
  const lastTime = useRef(0);
  const timeOf = () => (videoRef.current?.currentTime || lastTime.current || 0);
  const leave = () => { const v = videoRef.current; if (v) { lastTime.current = v.currentTime; v.pause(); v.currentTime = 0; v.load(); } setProgress(0); };
  return (
    <div role={done ? "button" : undefined} tabIndex={done ? 0 : -1} aria-pressed={selecting ? on : undefined}
      onClick={(e) => { if (!done) return; if (selecting) { sel.toggle(item, e); return; } act.open(item); }}
      onKeyDown={(e) => { if (done && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); if (selecting) sel.toggle(item, e); else act.open(item); } }}
      onMouseEnter={enter} onMouseLeave={leave}
      {...(done ? sel.dragProps(item) : {})}
      className="group relative flex-shrink-0 cursor-pointer overflow-hidden rounded-sm bg-muted"
      style={{ width, height }}>
      {!done ? <PendingTile item={item} items={items} act={act} />
        : item.kind === "audio" ? <span className="flex h-full w-full items-center justify-center p-3 text-center text-muted-foreground">♪ {item.meta?.toolTitle || item.prompt || "Audio"}</span>
          : item.kind === "video" ? (
            <video ref={videoRef} src={item.url} poster={dzThumb(item.url)} muted playsInline preload="metadata" className="h-full w-full object-cover"
              onLoadedMetadata={(e) => onMeasure(item.id, e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
              onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
              onEnded={(e) => { e.currentTarget.currentTime = 0; e.currentTarget.play().catch(() => {}); }} />
          ) : (
            <img src={dzThumb(item.url)} alt={item.prompt?.slice(0, 80) || "Result"} loading="lazy" decoding="async" className="h-full w-full object-cover"
              onLoad={(e) => onMeasure(item.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
          )}
      {done && <span className={cn("pointer-events-none absolute inset-0 rounded-sm transition-colors duration-state", on ? "bg-overlay/[.28] ring-2 ring-inset ring-signal" : "group-hover:bg-overlay-foreground/[.07] group-hover:ring-1 group-hover:ring-inset group-hover:ring-overlay-foreground/10")} />}
      {fresh && !selecting && <span className="pointer-events-none absolute left-2 top-2 rounded-xs bg-signal px-1.5 text-xs font-semibold leading-5 text-primary-foreground">New</span>}
      {done && (item.studio === "upscale" || duration > 0) && (
        <span className={cn("pointer-events-none absolute bottom-2 rounded-xs bg-overlay/60 px-1.5 text-xs font-medium tabular-nums text-overlay-foreground transition-opacity duration-state", selecting ? "left-2" : "right-2")}>{item.studio === "upscale" ? "Upscaled" : fmtDur(duration)}</span>
      )}
      {done && item.kind === "video" && progress > 0 && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-overlay-foreground/20"><span className="block h-full bg-signal" style={{ width: `${progress * 100}%` }} /></span>}
      {selecting && done && (
        <span className={cn("absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-[6px] border", on ? "border-signal bg-signal text-primary-foreground" : "border-overlay-foreground/80 bg-overlay/30")}>{on && <Check size={12} weight="bold" />}</span>
      )}
      {!selecting && done && item.kind !== "audio" && (
        <div className={cn("transition-opacity duration-state", menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}><QuickActions item={item} act={act} timeOf={timeOf} /></div>
      )}
      {!selecting && done && (
        <div className={cn("absolute right-2 top-2 flex gap-1.5 transition-opacity duration-state", menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}>
          <button type="button" aria-label={item.liked ? "Unlike" : "Like"} aria-pressed={Boolean(item.liked)} onClick={(e) => { e.stopPropagation(); act.like(item); }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-overlay/55 text-overlay-foreground backdrop-blur-md transition-colors duration-state hover:bg-overlay/75"><Heart size={15} weight={item.liked ? "fill" : "regular"} className={item.liked ? "text-signal" : ""} /></button>
          <TileMenu item={item} act={act} open={menu} setOpen={setMenu} timeOf={timeOf} />
        </div>
      )}
      {!selecting && done && item.liked && !menu && (
        <span className="pointer-events-none absolute right-[46px] top-2 flex h-7 w-7 items-center justify-center rounded-full bg-overlay/55 backdrop-blur-md transition-opacity group-hover:opacity-0"><Heart size={15} weight="fill" className="text-signal" /></span>
      )}
      {!done && item.status === "failed" && (
        <button type="button" aria-label="Remove" onClick={(e) => { e.stopPropagation(); act.trash(item); }}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/70 text-muted-foreground opacity-0 transition-opacity duration-state hover:text-foreground group-hover:opacity-100 focus:opacity-100"><X size={12} /></button>
      )}
    </div>
  );
}

// The tabs row, or in its place (same height) the selection actions (§5.2).
function TabsRow({ sel, kindFilter, setKindFilter, canSelect, tabs = STUDIO_TABS }) {
  const [busy, setBusy] = useState(false);
  const n = sel.count;
  const run = async (action, verb) => {
    setBusy(true);
    try {
      const r = await dzLibrary.batch(action, sel.chosen.map((i) => i.id));
      const done = r.done?.length || 0;
      notify({ type: r.failed?.length && !done ? "error" : "notice", title: verb, message: r.failed?.length ? `${done} done, ${r.failed.length} not: ${r.failed[0]?.error || ""}` : `${done} item${done === 1 ? "" : "s"}.` });
      if (done) sel.clear();
    } catch (e) { notify({ type: "error", title: verb, message: String(e?.message || e) }); }
    setBusy(false);
  };
  const Action = ({ icon: Icon, children, onClick, danger }) => (
    <button type="button" disabled={!n || busy} onClick={onClick}
      className={cn("flex h-8 items-center gap-1.5 rounded-md px-2 text-base font-medium transition-colors duration-state hover:bg-accent disabled:opacity-40", danger ? "text-destructive" : "text-foreground")}><Icon size={16} />{children}</button>
  );
  if (sel.selecting) {
    return (
      <div className="dz-sel-in flex h-11 items-center gap-1 border-b border-border">
        <span className="mr-2 text-base font-semibold tabular-nums">{n} selected</span>
        <button type="button" onClick={sel.selectAll} className="h-8 rounded-md px-2 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Select all</button>
        <span className="mx-2 h-5 w-px bg-border" />
        <Action icon={FolderSimple} onClick={() => window.dispatchEvent(new CustomEvent("dz:move", { detail: { items: sel.chosen, mode: "move" } }))}>Move to</Action>
        <Action icon={Copy} onClick={() => window.dispatchEvent(new CustomEvent("dz:move", { detail: { items: sel.chosen, mode: "copy" } }))}>Copy to</Action>
        <Action icon={DownloadSimple} onClick={async () => { for (const i of sel.chosen) { await download(i.url); await new Promise((r) => setTimeout(r, 250)); } }}>Download</Action>
        <Action icon={Shapes} onClick={() => window.dispatchEvent(new CustomEvent("dz:to-element", { detail: { items: sel.chosen } }))}>Make element</Action>
        <Action icon={Trash} danger onClick={() => run("trash", "Moved to Trash")}>Trash</Action>
        <button type="button" onClick={sel.clear} className="ml-auto h-8 rounded-md px-2 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Cancel</button>
      </div>
    );
  }
  return (
    <div className="flex h-11 items-end gap-5 border-b border-border" role="tablist" aria-label="Show">
      {tabs.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={kindFilter === v} onClick={() => setKindFilter(v)}
          className={cn("-mb-px h-11 border-b-2 text-base font-medium transition-colors duration-state", kindFilter === v ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
      ))}
      {canSelect && <button type="button" onClick={sel.start} className="mb-2.5 ml-auto h-6 text-base font-medium text-muted-foreground transition-colors duration-state hover:text-foreground">Select</button>}
    </div>
  );
}

// ── Strip (§5.4) ────────────────────────────────────────────────────────────
function Thumb({ item, kind, label, tag, onRemove, onDragStart, fault, menu }) {
  const [dur, setDur] = useState(null);
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  return (
    <div ref={anchor} className="dz-pop group/t relative h-12 w-12 flex-shrink-0" draggable onDragStart={onDragStart} tabIndex={0}
      onClick={menu ? () => setOpen((v) => !v) : undefined} role={menu ? "button" : undefined} aria-haspopup={menu ? "menu" : undefined}>
      {/* "Image to edit" has a small menu: Draw to edit (package 03, §8), Replace, Remove. */}
      {menu && (
        <ChipMenu open={open} onClose={() => setOpen(false)} anchor={anchor} className="w-[200px] p-1.5">
          {menu.map(([Icon, text, run]) => <MenuRow key={text} className="h-8 text-sm" onClick={(e) => { e.stopPropagation(); setOpen(false); run(); }}><Icon size={16} />{text}</MenuRow>)}
        </ChipMenu>
      )}
      <div className={cn("h-12 w-12 overflow-hidden rounded-slot bg-muted ring-signal transition-shadow duration-state group-hover/t:ring-2 group-focus/t:ring-2", fault && "ring-2 ring-destructive")}>
        {kind === "video" ? <video src={item.url} poster={dzThumb(item.url, 128)} muted preload="metadata" className="h-full w-full object-cover" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} />
          : kind === "audio" ? <span className="flex h-full items-center justify-center text-muted-foreground">♪</span>
            : <img src={dzThumb(item.url, 128)} alt="" className="h-full w-full object-cover" />}
        {(label || dur) && <span className="absolute inset-x-0 bottom-0 rounded-b-slot bg-overlay/70 text-center text-[11px] font-semibold leading-4 text-overlay-foreground">{label || fmtDur(dur)}</span>}
      </div>
      <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-popover transition-opacity delay-0 duration-state group-hover/t:opacity-100 group-hover/t:delay-300 group-focus/t:opacity-100">{tag}</span>
      <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove ${tag}`}
        className="absolute -right-1.5 -top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-popover text-foreground opacity-0 transition-opacity delay-0 duration-state hover:bg-accent focus:opacity-100 group-hover/t:opacity-100 group-hover/t:delay-300 group-focus/t:opacity-100"><X size={10} weight="bold" /></button>
    </div>
  );
}
const EmptySlot = ({ label, onClick, fault, small }) => (
  <button type="button" onClick={onClick} aria-label={label ? `Add ${label}` : "Add"}
    className={cn("flex h-12 w-12 flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-slot border border-dashed text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground", fault ? "border-destructive" : "border-input")}>
    <Plus size={small ? 12 : 14} />{label && <span className="text-[11px] leading-3">{label}</span>}
  </button>
);
const More = ({ n, onClick }) => <button type="button" onClick={onClick} className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-slot bg-muted text-base font-semibold text-foreground hover:bg-accent">+{n}</button>;

// The strip never overflows (redesign 02, §2.3): when the groups don't fit, the
// group with the most items shows fewer thumbnails (3 → 2 → 1) and "+N" takes the
// rest. Frames keep Start and End; their mids go into "+N" first.
function Strip({ groups, sent, attached, setAttached, activeGroup, openLibrary, openList, tagOf, fault, unusedCount, unusedOpen, onUnused, onDraw }) {
  const dragging = useRef(null);
  const box = useRef(null);
  const [caps, setCaps] = useState({});
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shape = groups.map((g) => `${g.id}:${groupItems(sent, g).length}/${groupItems(attached, g).length}/${g.max}`).join("|") + `|${unusedCount}`;
  // Start wide each time the row or what is in it changes, then step down until it fits (before paint).
  useLayoutEffect(() => { setCaps({}); }, [width, shape]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    const floor = (g) => (g.id === "frames" ? 2 : 1);
    const cand = groups.map((g) => ({ g, n: groupItems(sent, g).length, cap: caps[g.id] || 3 }))
      .filter((x) => x.cap > floor(x.g) && x.n > (x.g.id === "frames" ? 0 : x.cap - 1))
      .sort((x, y) => y.n - x.n || y.cap - x.cap);
    if (cand[0]) setCaps((c) => ({ ...c, [cand[0].g.id]: cand[0].cap - 1 }));
  });
  const drop = (g) => (e) => {
    const d = dragging.current;
    dragging.current = null;
    if (!d || d.group === g.id) return;
    e.preventDefault();
    const from = groups.find((x) => x.id === d.group);
    if (!from || from.kind !== g.kind) return;
    // Only when the target has room: a full group leaves the item where it was.
    setAttached((a) => (groupItems(a, g).length >= g.max ? a : addToGroup(removeFromGroup(a, from, d.item.url, d.item.role), g, [{ url: d.item.url, name: d.item.name }])));
  };
  const tagText = (item, fallback) => { const t = tagOf(item.url); return t ? `@${t.tag} · ${t.label || fallback}` : fallback; };
  const thumb = (g, item, label) => (
    <Thumb key={item.url} item={item} kind={g.kind} label={label} tag={tagText(item, label || g.label)} fault={fault === g.id}
      menu={g.id === "edit" ? [[PencilSimple, "Draw to edit…", () => onDraw?.(item.url)], [ArrowsClockwise, "Replace…", () => openLibrary("edit")], [Trash, "Remove", () => setAttached((a) => removeFromGroup(a, g, item.url, item.role))]] : null}
      onDragStart={(e) => { dragging.current = { group: g.id, item: { url: item.url, name: item.name, role: item.role } }; try { e.dataTransfer.setData("text/plain", item.url); } catch { /* optional */ } }}
      onRemove={() => setAttached((a) => removeFromGroup(a, g, item.url, item.role))} />
  );
  return (
    <div ref={box} className="flex min-w-0 items-start">
      {groups.map((g, gi) => {
        const items = groupItems(sent, g);
        const room = groupItems(attached, g).length < g.max;
        const cap = caps[g.id] || 3;
        let body;
        if (g.id === "frames") {
          const start = items.find((x) => x.role === "first");
          const mids = items.filter((x) => x.role === "middle");
          const end = items.find((x) => x.role === "last");
          const midShown = cap >= 3 ? mids.slice(0, 1) : [];
          const midRoom = g.roleMax.middle && (attached.middle || []).length < g.roleMax.middle;
          body = (
            <>
              {g.roleMax.first && (start ? thumb(g, start, "Start") : <EmptySlot label="Start" onClick={() => openLibrary(g.id)} fault={fault === g.id} />)}
              {midShown.map((m) => thumb(g, m, "Mid 1"))}
              {mids.length > midShown.length && <More n={mids.length - midShown.length} onClick={() => openList(g.id)} />}
              {midRoom && <EmptySlot label="Mid" onClick={() => openLibrary(g.id)} />}
              {g.roleMax.last && (end ? thumb(g, end, "End") : <EmptySlot label="End" onClick={() => openLibrary(g.id)} />)}
            </>
          );
        } else {
          body = (
            <>
              {items.slice(0, cap).map((it) => thumb(g, it, ""))}
              {items.length > cap && <More n={items.length - cap} onClick={() => openList(g.id)} />}
              {room && <EmptySlot onClick={() => openLibrary(g.id)} fault={fault === g.id && !items.length} />}
            </>
          );
        }
        return (
          <div key={g.id} className={cn("flex flex-shrink-0", gi > 0 && "ml-3.5 border-l border-border pl-3.5")} onDragOver={(e) => { if (dragging.current && dragging.current.group !== g.id) e.preventDefault(); }} onDrop={drop(g)}>
            <div>
              <button type="button" onClick={() => openLibrary(g.id)} className="relative mb-2 flex h-4 items-center gap-1.5 whitespace-nowrap">
                <Overline className={cn("whitespace-nowrap", activeGroup === g.id && "text-foreground")}>{g.label}</Overline>
                <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{items.length}{" "}/{" "}{g.max}</span>
                {activeGroup === g.id && <span className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-signal" />}
              </button>
              <div className="flex gap-2">{body}</div>
            </div>
          </div>
        );
      })}
      {unusedCount > 0 && (
        <button type="button" onClick={onUnused} aria-expanded={unusedOpen} aria-haspopup="dialog"
          className={cn("ml-auto mt-6 flex h-12 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-warning/45 px-3 text-[13px] font-semibold text-warning transition-colors duration-state",
            unusedOpen ? "bg-warning/20" : "bg-warning/10 hover:bg-warning/20")}>
          <Warning size={16} />{unusedCount} not used
        </button>
      )}
    </div>
  );
}

// The list of files this model does not get (redesign 02, §2.1, screen 02).
function NotUsedList({ open, onClose, items, modelName, tagOf, onRemove, onRemoveAll, anchor }) {
  const box = useRef(null);
  useEscLayer(open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    const on = (e) => { if (box.current && !box.current.contains(e.target) && !anchor.current?.contains(e.target)) onClose(); };
    const t = setTimeout(() => document.addEventListener("pointerdown", on), 0);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", on); };
  }, [open, onClose, anchor]);
  if (!open || !items.length) return null;
  const shown = items.slice(0, 4);
  const rest = items.slice(4);
  const restWords = (() => {
    if (!rest.length) return "";
    const roles = [...new Set(rest.map((x) => x.role))];
    const NOUN = { first: "start frame", middle: "middle frame", last: "end frame", reference: "reference", video: "reference video", source: "video to edit", audio: "audio file" };
    if (roles.length === 1) return `and ${rest.length} more ${NOUN[roles[0]]}${rest.length === 1 ? "" : "s"}`;
    return `and ${rest.length} more…`;
  })();
  return (
    <div ref={box} role="dialog" aria-label={`Not used by ${modelName}`}
      className="glass absolute bottom-[calc(100%+8px)] right-0 z-30 flex w-[440px] flex-col gap-0.5 rounded-xl border border-border p-2 shadow-float">
      <div className="px-2 pb-2 pt-1.5 text-[13px] leading-[18px] text-muted-foreground">
        <b className="block text-[14px] font-semibold leading-5 text-foreground">Not used by {modelName}</b>
        These stay attached but are not sent. Switch to a model that takes them and they come back.
      </div>
      {shown.map((it) => {
        const t = tagOf(it.url);
        const video = it.role === "video" || it.role === "source";
        return (
          <div key={`${it.role}-${it.url}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] leading-[18px] hover:bg-accent">
            {video ? <video src={it.url} poster={dzThumb(it.url, 96)} muted preload="metadata" className="h-9 w-9 flex-shrink-0 rounded-md object-cover" />
              : it.role === "audio" ? <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-muted">♪</span>
                : <img src={dzThumb(it.url, 96)} alt="" className="h-9 w-9 flex-shrink-0 rounded-md object-cover" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{[t?.label || it.name || "", t ? `@${t.tag}` : ""].filter(Boolean).join(" · ")}</span>
              <span className="block text-xs leading-4 text-muted-foreground">{it.reason}</span>
            </span>
            <button type="button" onClick={() => onRemove(it)} aria-label="Remove" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={14} /></button>
          </div>
        );
      })}
      {restWords && <div className="px-2 py-1.5 text-[13px] leading-[18px] text-muted-foreground">{restWords}</div>}
      <div className="mt-1.5 flex items-center gap-2 border-t border-border px-2 pb-1 pt-2">
        <button type="button" onClick={onRemoveAll} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"><Trash size={16} />Remove all {items.length}</button>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="h-7 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent">Keep</button>
      </div>
    </div>
  );
}

// ── Blocks (§5.3, row 2) ────────────────────────────────────────────────────
function Block({ icon: Icon, label, value, auto, onClick, active }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex h-14 min-w-0 items-center gap-3 rounded-md border px-3 text-left transition-colors duration-state hover:bg-accent", active ? "border-input bg-accent" : "border-border")}>
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon size={18} /></span>
      <span className="min-w-0">
        <Overline className="block">{label}</Overline>
        <span className={cn("block truncate text-sm", auto ? "text-muted-foreground" : "text-foreground")}>{value}</span>
      </span>
    </button>
  );
}

// ── Prompt with tag highlights (§5.3, row 3) ───────────────────────────────
function PromptField({ engine, onFocusChange, mentionGroups, onPasteFiles, placeholder }) {
  const { prompt, setPrompt, promptRef, readMention, onPromptKey, setMention, mention, tags, jsonPrompt } = engine;
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <PromptEditor value={prompt} onChange={(v) => { setPrompt(v); requestAnimationFrame(() => promptRef.current && readMention(promptRef.current)); }} tags={tags} modelName={engine.entry?.familyName} inputRef={promptRef} json={jsonPrompt.json}
        placeholder={placeholder || "Describe the shot. Type @ to use an element or anything you attached."}
        onKeyDown={onPromptKey}
        onKeyUp={(e) => {
          // Left/Right/Home/End always re-read the @ word under the caret; Up/Down move in the open list.
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || (!mention && ["ArrowUp", "ArrowDown"].includes(e.key))) readMention(promptRef.current);
        }}
        ariaProps={{ "aria-autocomplete": "list", "aria-expanded": Boolean(mention && mentionGroups.length), "aria-controls": mention ? "dz-mention-list" : undefined,
          "aria-activedescendant": mention && mentionGroups.length ? `dz-mention-${mention.index}` : undefined }}
        onClick={() => readMention(promptRef.current)}
        onFocus={() => { setFocused(true); onFocusChange(true); }}
        onBlur={() => { setFocused(false); onFocusChange(false); setTimeout(() => setMention(null), 150); }}
        onPasteFiles={onPasteFiles}
        // A box on the layout edges, padding 10 / 12, radius 10; fill and inner line only in focus
        // (package 02 §3 "Prompt field", corrected 19 Nov: the build as it was is right).
        className={cn("rounded-[10px] px-3 py-2.5 text-foreground caret-signal transition-colors duration-state", focused && "bg-muted shadow-[inset_0_0_0_1px_hsl(var(--input))]")} />
      {mention && (
        <div id="dz-mention-list" className="glass absolute bottom-[calc(100%+8px)] left-0 z-30 w-[420px] rounded-xl border border-border p-1.5 shadow-popover" role="listbox" aria-label="Tags">
          {mentionGroups.length === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">{mention.query ? `Nothing called “${mention.query}”.` : "Nothing to tag yet."} Attach files with + or make elements.</p>}
          {mentionGroups.map(([title, list]) => (
            <div key={title} className="py-0.5">
              <div className="px-2.5 py-1"><Overline>{title}</Overline></div>
              {list.map(({ o, i }) => (
                <button key={`${o.tag}-${o.element?.id || ""}`} id={`dz-mention-${i}`} type="button" role="option" aria-selected={i === mention.index} aria-disabled={Boolean(o.disabled)}
                  onMouseDown={(e) => { e.preventDefault(); engine.pickMention(o); }} title={o.disabled ? `Can't add: ${o.disabled}` : undefined}
                  className={cn("flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left", o.disabled ? "cursor-not-allowed opacity-50" : i === mention.index ? "bg-accent" : "hover:bg-accent")}>
                  {o.url ? <img src={dzThumb(o.url, 64)} alt="" className="h-7 w-7 rounded-xs object-cover" /> : <span className="h-7 w-7 rounded-xs bg-muted" />}
                  <span className="text-base font-medium text-signal">@{o.tag}</span>
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{o.label}{o.disabled ? ` · ${o.disabled}` : ""}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Elements window (§5.8) ──────────────────────────────────────────────────
function ElementsWindow({ open, onClose, engine, anchor }) {
  const [q, setQ] = useState("");
  const { elementLists, elements, entry, canUseElements, elementMax, activeElements } = engine;
  const all = useMemo(() => [...elementLists.project, ...elementLists.library, ...(elementLists.others || [])].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i && e.status !== "draft"), [elementLists]);
  const shown = all.filter((e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase()));
  const tags = elementTags(elements);
  const pick = (e) => {
    const chosen = elements.some((x) => x.id === e.id);
    if (!chosen) {
      if (!canUseElements || !elementFits(entry, e)) { notify({ type: "error", title: "Elements", message: `${entry?.familyName || "This model"} can't take ${e.name}.` }); return; }
      if (elements.length >= elementMax) { notify({ type: "error", title: "Elements", message: `This model takes up to ${elementMax} elements.` }); return; }
      engine.setElements((list) => [...list, e]);
    }
    const tag = (chosen ? tags : elementTags([...activeElements, e])).get(e.id);
    if (tag) engine.insertAtCursor(`@${tag}`);
    onClose();
  };
  return (
    <ChipMenu open={open} onClose={onClose} anchor={anchor} className="w-[420px] p-3">
      <div className="mb-2 flex items-center"><span className="text-lg font-semibold">Elements</span>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={14} /></button></div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search elements" autoFocus
        className="mb-2 h-9 w-full rounded-md border border-input bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none" />
      <div className="custom-scrollbar max-h-[320px] overflow-y-auto">
        {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No elements yet.</p>}
        {shown.map((e) => (
          <button key={e.id} type="button" onClick={() => pick(e)} className="flex h-14 w-full items-center gap-3 rounded-md px-1.5 text-left hover:bg-accent">
            {e.images?.[0] ? <img src={dzThumb(e.images[0], 96)} alt="" className="h-11 w-11 rounded-md object-cover" /> : <span className="h-11 w-11 rounded-md bg-muted" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-medium">{e.name}</span>
              <span className="block truncate text-xs capitalize text-muted-foreground">{e.kind || "element"} · {(e.images || []).length} view{(e.images || []).length === 1 ? "" : "s"}{e.project_name ? ` · ${e.project_name}` : ""}</span>
            </span>
            <span className="rounded-xs bg-signal/[.14] px-1.5 text-xs font-medium text-signal">@{tags.get(e.id) || elementTags([e]).get(e.id)}</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("dz:open-tab", { detail: { tab: "elements" } })); }}
        className="mt-2 flex h-9 w-full items-center gap-2 rounded-md px-2 text-base font-medium hover:bg-accent"><Plus size={16} /> New element</button>
    </ChipMenu>
  );
}

// ── Option menus: ratio, resolution, length (§5.7) ─────────────────────────
// Ratio, resolution and length (§5.7; package 03 §3.2): the model's own list. Values
// the same model has at another provider are listed dimmed, with the reason on the
// right (`others`); a locked chip (ratio with a start frame) opens on a dimmed list.
function ParamMenu({ p, value, onChange, title, icon, render, caption, modelName, note, others = [], right, locked = null }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  if (!p) return null;
  const own = Array.isArray(p.enum) ? p.enum
    : p.minValue != null && p.maxValue != null ? Array.from({ length: Math.min(30, Math.floor((p.maxValue - p.minValue) / (p.step || 1)) + 1) }, (_, i) => p.minValue + i * (p.step || 1)) : [];
  const same = (x, o) => String(x).toLowerCase().replace(/\s+/g, "") === String(o).toLowerCase().replace(/\s+/g, "");
  const extra = others.filter((o) => !own.some((x) => same(x, o)));
  const current = locked ? locked.value : value ?? p.default ?? own[0];
  return (
    <div className="relative" ref={anchor}>
      <Chip icon={icon} active={open} onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open} title={locked ? locked.note : undefined}>
        {render(current)}{locked && <LockSimple size={12} className="text-muted-foreground" aria-label="Locked" />}
      </Chip>
      <ChipMenu open={open} onClose={() => setOpen(false)} anchor={anchor} className="w-[260px] p-1.5">
        <div className="px-2.5 pb-1 pt-1.5"><Overline>{title} · {modelName}</Overline></div>
        <div className="custom-scrollbar max-h-[320px] overflow-y-auto">
          {own.map((o) => (
            <MenuRow key={String(o)} on={String(o) === String(current)} disabled={Boolean(locked)} onClick={() => { if (locked) return; onChange(o); setOpen(false); }}>
              {render(o, true, note ? own.find((x) => note(x)) === o : false)}
              {right && <span className="ml-auto text-sm tabular-nums text-muted-foreground">{right(o)}</span>}
            </MenuRow>
          ))}
          {extra.map((o) => (
            <MenuRow key={`x-${String(o)}`} disabled title="This provider can't make it">
              {render(o, true, false)}<span className="ml-auto text-sm font-normal text-muted-foreground">Not on this provider</span>
            </MenuRow>
          ))}
        </div>
        {locked && <p className="px-2.5 pb-1 pt-2 text-xs text-muted-foreground">{locked.note}</p>}
        {caption && <p className="px-2.5 pb-1 pt-2 text-xs text-muted-foreground">{caption}</p>}
      </ChipMenu>
    </div>
  );
}
// The same parameter's values at every provider of this model (for the dimmed rows).
function familyValues(entries, entry, keys) {
  const out = [];
  for (const e of entries) {
    if (e.family !== entry?.family) continue;
    for (const v of e.variants) {
      const ps = paramsOf(v.model);
      const p = [...ps.main, ...ps.advanced].find((x) => keys.includes(x.key) && Array.isArray(x.enum));
      for (const o of p?.enum || []) if (!out.some((x) => String(x).toLowerCase() === String(o).toLowerCase())) out.push(o);
    }
  }
  return out;
}
const PX = { "1k": "1024 px", "2k": "2048 px", "4k": "4096 px", "0.5k": "512 px" };
// Resolution names (redesign 02, §2.4). At Atlas "-esr" is an enhancement: the
// provider makes the nearest native size, then Tencent ESR sharpens and enlarges it;
// "-sr" is a plain upscale of the same kind (Seedance has both).
const isEnhanced = (v) => /-(e?sr)\b/i.test(String(v));
function resParts(v) {
  const raw = String(v);
  const m = /^(\d+(?:p|k))(?:-(esr|sr))?(?:\s*&\s*(\d+)\s*fps)?$/i.exec(raw.trim());
  if (!m) return { base: raw, kind: "", fps: "" };
  const base = /k$/i.test(m[1]) ? m[1].toUpperCase() : m[1].toLowerCase();
  return { base, kind: (m[2] || "").toLowerCase(), fps: m[3] || "" };
}
const resName = (v) => { const r = resParts(v); return [r.base, r.kind === "esr" ? "Enhanced" : r.kind === "sr" ? "Upscaled" : "", r.fps ? `· ${r.fps} fps` : ""].filter(Boolean).join(" "); };
const resShort = (v) => { const r = resParts(v); return `${r.base}${r.kind === "esr" ? "+" : r.kind === "sr" ? "↑" : ""}${r.fps ? ` ${r.fps}fps` : ""}`; };
const RatioIcon = ({ v }) => {
  const r = ratioNum(v) || 1;
  const w = r >= 1 ? 18 : Math.max(8, Math.round(18 * r));
  const h = r >= 1 ? Math.max(8, Math.round(18 / r)) : 18;
  return <span className="flex h-[18px] w-[18px] items-center justify-center"><span className="rounded-[2px] border-[1.5px] border-current" style={{ width: w, height: h }} /></span>;
};

// ── Studio ──────────────────────────────────────────────────────────────────
export default function DzStudio(props) {
  // One component for three tabs (package 03): Studio, and the light Image and Video tabs.
  const mode = props.mode === "image" || props.mode === "video" ? props.mode : "create";
  const light = mode !== "create";
  const engine = useDzCreateEngine({ ...props, mode });
  const {
    kind, setKind, entries, entry, attached, setAttached, params, values, setValue, setValuesByKind, prompt, setPrompt, camera, setCamera, move, setMove, count, setCount,
    canRun, missing, price, priceLoading, generate, busy, history, sel, ctx, kindFilter, setKindFilter, viewing, setViewing, applyResult, mention, mentionOptions,
    tags, look, adaptModel, adaptContext, quoteBody, variant, sentPreview, sentOpen, setSentOpen, addFiles, pickModel, elements, unusedCount, merged, elementSpec, activeElements, finalPrompt, plan, openForEdit, focusSeq, drawOpen, setDrawOpen,
  } = engine;

  // The look in the Studio: every part Auto unless chosen.
  useEffect(() => { if (!light && !camera?.auto) setCamera(autoLook(camera)); }, [light, camera, setCamera]);
  const a = autoLook(camera);

  const [panel, setPanel] = useState(null); // camera | move | look | settings | adapt | list
  const [pop, setPop] = useState(null); // model | els
  const [libGroup, setLibGroup] = useState(null); // library window open on a group
  const [listGroup, setListGroup] = useState(null);
  const [focus, setFocus] = useState(false);
  const [mini, setMini] = useState(false);
  // The bottom row (§2.3): first the model chip drops the provider, then Adapt its word, then it wraps.
  const rowRef = useRef(null);
  const [squeeze, setSqueeze] = useState(0);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setRowWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mini]);
  const rowKey = `${rowWidth}|${entry?.key}|${kind}|${count}|${values[RES_KEYS.find((k) => values[k] != null)] ?? ""}|${priceLoading}`;
  useLayoutEffect(() => { setSqueeze(0); }, [rowKey]);
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (el && squeeze < 3 && el.scrollWidth > el.clientWidth + 1) setSqueeze(squeeze + 1);
  });
  const [aspects, measure] = useAspects();
  const modelAnchor = useRef(null);
  const atAnchor = useRef(null);
  const scroller = useRef(null);
  const [gridEl, gridRef] = useState(null);
  const gridWidth = useWidth(gridEl);
  const fileInput = useRef(null);

  const groups = useMemo(() => groupsFor(entry), [entry]);
  // What the model gets (first N of each group, within its limits) and what it doesn't (§2.1).
  const sent = useMemo(() => splitEdit(plan.sent), [plan.sent]);
  const unused = plan.unused;
  const [unusedOpen, setUnusedOpen] = useState(false);
  const unusedAnchor = useRef(null);
  useEffect(() => { if (!unused.length) setUnusedOpen(false); }, [unused.length]);
  const dropUnused = (list) => {
    const before = attached;
    const gone = new Set(list.map((x) => `${x.role}|${x.url}`));
    setAttached((a) => Object.fromEntries(Object.entries(a).map(([role, files]) => [role, (files || []).filter((f) => !gone.has(`${role}|${f.url}`))])));
    return before;
  };
  const removeAllUnused = () => {
    const before = dropUnused(unused);
    const n = unused.length;
    setUnusedOpen(false);
    notify({ type: "notice", title: "Removed", message: `${n} file${n === 1 ? "" : "s"} removed from this shot.`, undo: () => setAttached(before) });
  };
  const tagOf = (url) => tags.find((t) => t.url === url);
  const closeAll = () => { setPanel(null); setPop(null); setLibGroup(null); };
  const openLibrary = (gid) => { setPop(null); setPanel(null); setLibGroup(gid || groups.find((g) => g.id === "reference")?.id || groups[0]?.id || null); };
  const openList = (gid) => { setLibGroup(null); setListGroup(gid); setPanel("list"); };

  // A picture sent here from another tab (Make video, Continue, Edit): the prompt takes focus.
  useEffect(() => { if (focusSeq) { setMini(false); requestAnimationFrame(() => engine.promptRef.current?.focus()); } }, [focusSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Image to edit" appears for a model that can edit: one notice per model, in the notice row.
  const [editTip, setEditTip] = useState(null);
  useEffect(() => {
    if (!entry?.canEdit) { setEditTip(null); return; }
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem("dz_edit_tip_seen") || "[]"); } catch { /* optional */ }
    if (seen.includes(entry.family)) { setEditTip(null); return; }
    setEditTip(`${entry.familyName} can edit a picture. Drop one into Image to edit, or leave it empty.`);
    try { localStorage.setItem("dz_edit_tip_seen", JSON.stringify([...seen, entry.family].slice(-50))); } catch { /* optional */ }
  }, [entry?.family, entry?.canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Model change: files the new model does not take stay attached; the notice row says so (§2.1, no toast).
  const choose = (key, { close } = {}) => {
    if (key !== entry?.key) pickModel(key);
    if (close) setPop(null);
  };

  // Parameters: ratio, resolution and length are chips; everything else is in Settings.
  const allParams = [...params.main, ...params.advanced];
  const ratioP = allParams.find((p) => RATIO_KEYS.includes(p.key) && Array.isArray(p.enum));
  const resP = allParams.find((p) => RES_KEYS.includes(p.key) && Array.isArray(p.enum));
  const durP = kind === "video" ? allParams.find((p) => p.key === "duration") : null;
  const settingsParams = allParams.filter((p) => p !== ratioP && p !== resP && p !== durP && !["num_images", "n", "batch_size"].includes(p.key));
  const settingsChanged = settingsParams.some((p) => values[p.key] != null && values[p.key] !== p.default);
  // Values this model has at other providers: listed dimmed with the reason (package 03, §3.2).
  const ratioOthers = useMemo(() => familyValues(entries, entry, RATIO_KEYS), [entries, entry]);
  const resOthers = useMemo(() => familyValues(entries, entry, RES_KEYS), [entries, entry]);
  // Ratio with a start frame (§4): when the endpoint that gets the frame takes no
  // ratio, the video follows the frame — the chip shows its ratio with a lock. An
  // endpoint that does take a ratio with a frame can re-frame, so nothing locks.
  const startUrl = sent.first?.[0]?.url || null;
  const [frameShape, setFrameShape] = useState(null);
  useEffect(() => {
    if (!startUrl) { setFrameShape(null); return undefined; }
    let alive = true;
    const img = new window.Image();
    img.onload = () => { if (alive && img.naturalWidth) setFrameShape(img.naturalWidth / img.naturalHeight); };
    img.src = startUrl;
    return () => { alive = false; };
  }, [startUrl]);
  const ratioFallback = !ratioP && kind === "video" && startUrl ? (() => {
    for (const v of entry?.variants || []) { const ps = paramsOf(v.model); const p = [...ps.main, ...ps.advanced].find((x) => RATIO_KEYS.includes(x.key) && Array.isArray(x.enum)); if (p) return p; }
    return null;
  })() : null;
  const ratioLock = ratioFallback ? {
    value: (() => {
      const list = ratioFallback.enum.filter((o) => ratioNum(o));
      if (!frameShape || !list.length) return "Frame";
      return list.reduce((best, o) => (Math.abs(Math.log(ratioNum(o) / frameShape)) < Math.abs(Math.log(ratioNum(best) / frameShape)) ? o : best), list[0]);
    })(),
    note: "Follows the start frame. Remove the frame to choose.",
  } : null;
  const placeholder = mode === "image"
    ? (sent.edit?.length ? "Say what to change." : "Describe the picture. Type @ to use an element or a reference.")
    : mode === "video" && startUrl ? "Say what happens in this picture."
      : "Describe the shot. Type @ to use an element or anything you attached.";

  // Block values: only what is not Auto.
  const d = lookData();
  const name = (list, id) => (list || []).find((x) => x.id === id)?.label || "";
  const camParts = [name(d.cameras, a.camera), name(d.lenses, a.lens), a.focal ? `${a.focal}mm` : "", a.aperture || "", a.filter ? name(d.filters, a.filter).split(" /")[0] : ""].filter(Boolean);
  const lookParts = [name(d.palettes, a.palette), name(d.lights, a.light), name(d.genres, a.genre), name(d.eras, a.era)].filter(Boolean);
  const moveLabel = move ? name(d.moves, move) : "";

  const generateNow = () => {
    if (!canRun) return;
    closeAll();
    generate();
    const what = kind === "video" ? (count > 1 ? "videos" : "video") : (count > 1 ? "pictures" : "picture");
    notify({ type: "notice", title: "Generate", message: light ? `${count > 1 ? `${count} ${what}` : `1 ${what}`} added to the queue.` : count > 1 ? `${count} jobs added. The tiles appear first in the grid.` : "Added to the queue. The tile appears first in the grid." });
  };

  // ── What the tiles and the viewer can do (package 03, §5–§7) ──
  const { isNew, markSeen } = useSeen();
  const [tileMenu, setTileMenu] = useState(false);
  const forcedMini = useRef(false);
  const focusPrompt = () => { forcedMini.current = false; setMini(false); requestAnimationFrame(() => engine.promptRef.current?.focus()); };
  const fail = (title) => (e) => notify({ type: "error", title, message: String(e?.message || e) });
  const addRef = (it) => {
    const gid = it.kind === "video" ? "video" : "reference";
    const g = groups.find((x) => x.id === gid);
    if (g) setAttached((prev) => addToGroup(prev, g, [{ url: it.url, name: "result" }]));
    else setAttached((prev) => ({ ...prev, [gid]: [...(prev[gid] || []), { url: it.url, name: "result" }] }));
    notify({ type: "notice", title: "References", message: "Added to References." });
  };
  // A frame of a video into the Start frame of the video composer; prompt and settings stay.
  const frameInto = async (it, at) => {
    try {
      const r = await dzFrame(it.id, { at });
      const file = { url: r.url, name: at === "first" ? "first frame" : "last frame" };
      if (mode === "image") { window.dispatchEvent(new CustomEvent(DZ_SEND_EVENT, { detail: { to: "video", url: r.url } })); return; }
      if (mode === "create") setKind("video");
      setAttached((prev) => ({ ...prev, first: [file] }));
      focusPrompt();
    } catch (e) { fail("Frame")(e); }
  };
  const act = {
    open: (it) => { markSeen(it); setViewing(it); },
    like: (it) => history.like(it.id, !it.liked),
    trash: (it) => history.trash(it.id).catch(fail("Trash")),
    trashStrict: (it) => history.trash(it.id),
    cancel: (it) => dzLibrary.cancel(it.id).catch(fail("Cancel")),
    useRef: addRef,
    makeVideo: (it) => (mode === "create" ? (applyResult(it, "animate"), focusPrompt()) : window.dispatchEvent(new CustomEvent(DZ_SEND_EVENT, { detail: { to: "video", url: it.url } }))),
    edit: (it) => {
      if (mode === "image" || (mode === "create" && kind === "image")) { openForEdit(it.url); focusPrompt(); return; }
      window.dispatchEvent(new CustomEvent("dz:open-tab", { detail: { tab: "image" } }));
      setTimeout(() => window.dispatchEvent(new CustomEvent(DZ_SEND_EVENT, { detail: { to: "image", url: it.url, role: "edit" } })), 0);
    },
    draw: (url) => { setDrawImage(url); setDrawOpen(true); },
    continueFrom: (it) => frameInto(it, "last"),
    firstAsStart: (it) => frameInto(it, "first"),
    saveFrame: async (it, t) => {
      try {
        await dzFrame(it.id, { at: Number.isFinite(t) && t > 0 ? t : "first", save: true });
        refreshHistory(it.studio);
        notify({ type: "notice", title: "Saved", message: "The frame is a picture now, next to the video. It is in Image and Studio." });
      } catch (e) { fail("Save frame")(e); }
    },
    reuse: (it) => { engine.reuse(it); focusPrompt(); },
    editPrompt: (it) => { engine.reuse(it); focusPrompt(); },
    retry: async (it) => {
      try {
        await dzRetry(it.id);
        history.trash(it.id).catch(() => {});
        refreshHistory(it.studio);
        notify({ type: "notice", title: "Retry", message: "Sent again. The new tile appears first in the grid." });
      } catch (e) { fail("Retry")(e); }
    },
  };
  const [drawImage, setDrawImage] = useState(null);
  // ⌘/Ctrl+Enter in the prompt runs it (the engine handles the key; route it here for the toast).
  const engineForPrompt = { ...engine, onPromptKey: (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !mention) { e.preventDefault(); generateNow(); return; } engine.onPromptKey(e); } };

  const mentionGroups = useMemo(() => {
    const withIndex = mentionOptions.map((o, i) => ({ o, i }));
    return [["Attached to this shot", withIndex.filter(({ o }) => !o.add && o.kind !== "element")], ["Elements", withIndex.filter(({ o }) => o.add || o.kind === "element")]].filter(([, l]) => l.length);
  }, [mentionOptions]);

  // Files dropped on the composer or pasted: References (or Start frame if the model takes no references).
  const takeFiles = (files) => {
    const has = (r) => entry?.slots.some((s) => s.role === r);
    const images = files.filter((f) => f.type.startsWith("image/"));
    const videos = files.filter((f) => f.type.startsWith("video/"));
    if (images.length) addFiles(has("reference") ? "reference" : "first", images);
    if (videos.length) addFiles(has("video") ? "video" : "source", videos);
  };

  // Mini composer (§5.3): folds when the grid scrolls past 24 px; never while something is open or the prompt has focus.
  const busyUi = Boolean(panel || pop || libGroup || focus || mention);
  // While a tile menu is open the composer is in its mini form (§5).
  // Restored on close only if nothing else (Make video, Continue…) opened the composer meanwhile.
  const miniBefore = useRef(false);
  useEffect(() => {
    if (tileMenu) { miniBefore.current = mini; forcedMini.current = true; setMini(true); return; }
    if (forcedMini.current) setMini(miniBefore.current);
    forcedMini.current = false;
  }, [tileMenu]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (busyUi) setMini(false); }, [busyUi]);
  const [stuck, setStuck] = useState(false);
  const onScroll = (e) => {
    const y = e.currentTarget.scrollTop;
    if ((y > 56) !== stuck) setStuck(y > 56);
    if (y > 24 && !mini && !busyUi) setMini(true);
    else if (y <= 0 && mini) setMini(false);
  };

  const items = history.items;
  const rows = useMemo(() => justify(items, aspects, gridWidth), [items, aspects, gridWidth]);
  const total = groups.reduce((n, g) => n + groupItems(sent, g).length, 0);
  const faultGroup = missing ? (groups.find((g) => /start frame|first/i.test(missing) && g.id === "frames") || groups.find((g) => new RegExp(g.label, "i").test(missing)))?.id : null;
  const priceText = price ? `${price.exact ? "" : "≈ "}${fmtUsd(price.usd * count)}` : entry?.priceLabel || "";
  const where = ctx.project ? [ctx.project.name, ...(ctx.folderPath || [])].join(" / ") : "Library";
  const libraryOpen = Boolean(libGroup);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <style>{`.dz-pop{animation:dzPop 180ms cubic-bezier(.2,.8,.2,1)}@keyframes dzPop{from{transform:scale(.8);opacity:0}}.dz-sel-in{animation:dzSelIn 160ms cubic-bezier(.2,.8,.2,1)}@keyframes dzSelIn{from{transform:translateY(-4px);opacity:0}}`}</style>
      <div ref={scroller} onScroll={onScroll} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 [container-type:inline-size]">
        <div className="flex items-baseline gap-3 pb-3 pt-6">
          <h1 className="text-xl font-semibold">{TITLE[mode]}</h1>
          <span className="truncate text-sm text-muted-foreground">{where}</span>
        </div>
        {(items.length > 0 || !history.loaded || kindFilter !== "all") && (
          // Tabs and Select stay at the top while the grid scrolls (Loom 19.11): see-through blur once stuck; the row keeps its own bottom line.
          <div className={cn("sticky top-0 z-[5] -mx-6 px-6 transition-[background-color,box-shadow,backdrop-filter] duration-state", stuck ? "bg-background/80 backdrop-blur-md" : "bg-background")}>
            <TabsRow sel={sel} kindFilter={kindFilter} setKindFilter={setKindFilter} canSelect={items.some((i) => i.url)} tabs={light ? LIGHT_TABS : STUDIO_TABS} />
          </div>
        )}
        {history.loaded && items.length === 0 && light && kindFilter === "all" ? (
          // Empty Image / Video (package 03, image-01, video-01): three example prompts; a click puts one into the prompt.
          <div className="flex min-h-[60%] flex-col items-center justify-center gap-3 pb-64 pt-24 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">{mode === "image" ? <ImageSquare size={20} /> : <VideoCamera size={20} />}</span>
            <p className="text-lg font-semibold">{mode === "image" ? "Make your first picture" : "Make your first video"}</p>
            <p className="max-w-sm text-muted-foreground">{mode === "image" ? "Describe it in the box below and press Generate. Or start from one of these." : "Describe it below, or start from a picture: put it into Start frame and say what happens."}</p>
            <div className="mt-1 flex w-full max-w-[520px] flex-col gap-2">
              {EXAMPLES[mode].map((t) => (
                <button key={t} type="button" onClick={() => { setPrompt(t); setMini(false); requestAnimationFrame(() => engine.promptRef.current?.focus()); }}
                  className="flex h-10 items-center gap-3 rounded-md border border-border px-3 text-left text-base hover:bg-accent"><ArrowElbowDownRight size={14} className="flex-shrink-0 text-muted-foreground" />{t}</button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {mode === "video" && groups.some((g) => g.id === "frames") && (
                <button type="button" onClick={() => openLibrary("frames")} className="flex h-8 items-center gap-2 rounded-md bg-muted px-3 text-base font-medium hover:bg-accent"><ImageSquare size={16} /> Start from a picture</button>
              )}
              <button type="button" onClick={() => fileInput.current?.click()} className={cn("flex h-8 items-center gap-2 rounded-md px-3 text-base font-medium hover:bg-accent", mode === "image" ? "border border-border" : "text-muted-foreground hover:text-foreground")}><UploadSimple size={16} /> {mode === "image" ? "Upload pictures" : "Upload"}</button>
            </div>
          </div>
        ) : history.loaded && items.length === 0 ? (
          <div className="flex min-h-[60%] flex-col items-center justify-center gap-3 pb-64 pt-24 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-muted-foreground"><FilmSlate size={24} /></span>
            <p className="text-lg font-semibold">Nothing here yet</p>
            <p className="max-w-sm text-muted-foreground">Describe a shot below, attach frames or references, and press Generate. Everything you make here appears in this grid.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => fileInput.current?.click()} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><UploadSimple size={16} /> Upload pictures or video</button>
              <button type="button" onClick={() => { setPrompt(EXAMPLE); setKind("video"); requestAnimationFrame(() => engine.promptRef.current?.focus()); }} className="h-8 rounded-md px-3 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground">See an example shot</button>
            </div>
          </div>
        ) : (
          <div ref={gridRef} className="flex flex-col gap-1.5 pb-[340px] pt-3">
            {rows.map((row, ri) => (
              <div key={ri} className="flex gap-1.5" style={{ height: row.h }}>
            {row.cells.map(({ item, w }) => (
              <Tile key={item.id} item={item} items={items} width={w} height={row.h} onMeasure={measure} sel={sel} act={act} isNew={isNew} markSeen={markSeen} onMenu={setTileMenu} />
            ))}
              </div>
            ))}
            {history.hasMore && (
              <div className="flex w-full justify-center py-4"><button type="button" onClick={history.loadMore} disabled={history.loadingMore} className="h-8 rounded-md border border-border px-3 text-base font-medium hover:bg-accent">{history.loadingMore ? "Loading…" : "Load more"}</button></div>
            )}
          </div>
        )}
      </div>

      {/* Scrim while the library window is open */}
      {libraryOpen && <div className="absolute inset-0 z-10 bg-scrim" onClick={() => setLibGroup(null)} aria-hidden="true" />}

      {/* Composer (§5.3) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-6">
        {mini ? (
          <button type="button" onClick={() => { setMini(false); requestAnimationFrame(() => engine.promptRef.current?.focus()); }}
            className="pointer-events-auto flex h-14 w-[min(640px,100%)] items-center gap-3 rounded-xl border border-border bg-card pl-4 pr-2 text-left shadow-float transition-[width] duration-[260ms] ease-soft">
            <span className={cn("min-w-0 flex-1 truncate text-base", !prompt && "text-muted-foreground")}>{prompt || "Describe the shot"}</span>
            <span className="flex-shrink-0 text-sm text-muted-foreground">{entry?.familyName}{total ? ` · ${total} attached` : ""}</span>
            <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); generateNow(); }} aria-disabled={!canRun}
              className={cn("flex h-10 items-center rounded-md bg-primary px-4 text-base font-medium text-primary-foreground", !canRun && "opacity-50")}>Generate</span>
          </button>
        ) : (
          <div className={cn("pointer-events-auto relative max-w-full rounded-xl border border-border bg-card p-4 shadow-float", COMPOSER_W[mode])}
            onDragOver={(e) => { if (Array.from(e.dataTransfer?.types || []).includes("Files")) { e.preventDefault(); e.stopPropagation(); } }}
            onDrop={(e) => { const files = Array.from(e.dataTransfer?.files || []); if (files.length) { e.preventDefault(); e.stopPropagation(); takeFiles(files); } }}>
            <LibraryWindow open={libraryOpen} groups={groups} groupId={libGroup} setGroupId={setLibGroup} attached={attached} sent={sent} setAttached={setAttached}
              onClose={() => setLibGroup(null)} onError={(m) => notify({ type: "error", title: "Upload", message: m })} onUploading={(on) => engine.setUploads((n) => Math.max(0, n + (on ? 1 : -1)))} />

            {/* 1. Attachments strip — always visible */}
            {/* The chip and its list share one anchor, so a click on the chip toggles rather than closes and reopens. */}
            <div ref={unusedAnchor}>
              <NotUsedList open={unusedOpen} onClose={() => setUnusedOpen(false)} items={unused} modelName={entry?.familyName || "this model"} tagOf={tagOf} anchor={unusedAnchor}
                onRemove={(it) => dropUnused([it])} onRemoveAll={removeAllUnused} />
            {groups.length > 0 || unused.length > 0 ? (
              <Strip groups={groups} sent={sent} attached={attached} setAttached={setAttached} activeGroup={libGroup || (panel === "list" ? listGroup : null)}
                openLibrary={openLibrary} openList={openList} tagOf={tagOf} fault={faultGroup}
                unusedCount={unused.length} unusedOpen={unusedOpen} onUnused={() => setUnusedOpen((v) => !v)} onDraw={act.draw} />
            ) : (
              <p className="flex h-[66px] items-center text-sm text-muted-foreground">{entry ? `${entry.familyName} takes text only.` : "Loading models…"}</p>
            )}
            </div>

            {/* 2–4 fold away while the library is open */}
            <div className={cn("grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-[240ms] ease-soft", libraryOpen ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}>
              {/* min-w-0: the column must not grow with the bottom row, or the row could never measure its own overflow. */}
              <div className={cn("min-w-0", libraryOpen ? "overflow-hidden" : "overflow-visible")}>
                {/* Camera · Move · Look · Settings live in Studio only; Image and Video have a Settings chip (package 03, §2). */}
                {!light && <div className={cn("mt-3 grid gap-2", kind === "video" ? "grid-cols-4" : "grid-cols-3")}>
                  <Block icon={Camera} label="Camera" value={camParts.length ? camParts.join(" · ") : "Auto"} auto={!camParts.length} onClick={() => setPanel("camera")} active={panel === "camera"} />
                  {kind === "video" && <Block icon={ArrowsOutCardinal} label="Move" value={moveLabel || "Auto"} auto={!moveLabel} onClick={() => setPanel("move")} active={panel === "move"} />}
                  <Block icon={Palette} label="Look" value={lookParts.length ? `${lookParts[0]}${lookParts.length > 1 ? ` +${lookParts.length - 1}` : ""}` : "Auto"} auto={!lookParts.length} onClick={() => setPanel("look")} active={panel === "look"} />
                  <Block icon={SlidersHorizontal} label="Settings" value={settingsChanged ? "Changed" : "Model defaults"} auto={!settingsChanged} onClick={() => setPanel("settings")} active={panel === "settings"} />
                </div>}

                <div className="mt-3"><PromptField engine={engineForPrompt} onFocusChange={setFocus} mentionGroups={mentionGroups} onPasteFiles={takeFiles} placeholder={placeholder} /></div>
                {/* Notice row (§2.1): full sentences, wrapped, never cut — files not sent, what is missing, look hints. */}
                {(plan.summary || missing || editTip || sentPreview.data?.hints?.length > 0) && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {editTip && (
                      <div className="flex items-start gap-2.5 text-[13px] leading-5 text-muted-foreground">
                        <Info size={16} className="mt-0.5 flex-shrink-0" /><span className="min-w-0 flex-1">{editTip}</span>
                        <button type="button" onClick={() => setEditTip(null)} aria-label="Dismiss" className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-xs hover:bg-accent hover:text-foreground"><X size={12} /></button>
                      </div>
                    )}
                    {plan.summary && (
                      <div className="flex items-start gap-2.5 text-[13px] leading-5 text-warning">
                        <Warning size={16} className="mt-0.5 flex-shrink-0" />
                        <span className="min-w-0 flex-1">{plan.summary}</span>
                        <span className="flex flex-shrink-0 gap-3.5 font-semibold text-foreground">
                          <button type="button" onClick={() => setUnusedOpen(true)} className="hover:underline">Show</button>
                          <button type="button" onClick={removeAllUnused} className="hover:underline">Remove them</button>
                        </span>
                      </div>
                    )}
                    {missing && <div className="flex items-start gap-2.5 text-[13px] leading-5 text-warning"><Warning size={16} className="mt-0.5 flex-shrink-0" /><span className="min-w-0 flex-1">{missing}</span></div>}
                    {(sentPreview.data?.hints || []).map((h) => <div key={h} className="flex items-start gap-2.5 text-[13px] leading-5 text-warning"><Info size={16} className="mt-0.5 flex-shrink-0" /><span className="min-w-0 flex-1">{h}</span></div>)}
                  </div>
                )}

                {/* 4. Bottom row — never wraps */}
                <div ref={rowRef} className={cn("mt-3 flex items-center gap-1.5 whitespace-nowrap", squeeze >= 3 && "flex-wrap gap-y-2")}>
                  <button type="button" onClick={() => openLibrary()} aria-label="Add from the library" disabled={!groups.length}
                    className="-ml-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground disabled:opacity-40"><Plus size={18} /></button>
                  <div className="relative" ref={atAnchor}>
                    <button type="button" onClick={() => setPop(pop === "els" ? null : "els")} aria-label="Elements" aria-expanded={pop === "els"}
                      className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground", pop === "els" && "bg-accent text-foreground")}><At size={18} /></button>
                    <ElementsWindow open={pop === "els"} onClose={() => setPop(null)} engine={engine} anchor={atAnchor} />
                  </div>
                  {!light && <div className="flex h-8 flex-shrink-0 items-center rounded-md bg-muted p-0.5" role="group" aria-label="Image or video">
                    {[["image", "Image"], ["video", "Video"]].map(([v, l]) => (
                      <button key={v} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}
                        className={cn("h-7 rounded-[6px] px-2.5 text-sm font-medium transition-colors duration-state", kind === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                    ))}
                  </div>}
                  <div className="relative" ref={modelAnchor}>
                    <Chip icon={Cube} active={pop === "model"} onClick={() => setPop(pop === "model" ? null : "model")} aria-expanded={pop === "model"} className="max-w-[240px]">
                      <span className="truncate" title={entry ? `${entry.familyName} · ${entry.providerName}` : undefined}>{entry ? (squeeze >= 1 ? entry.familyName : `${entry.familyName} · ${entry.providerName}`) : "Choose a model"}</span><CaretDown size={12} className="flex-shrink-0 text-muted-foreground" />
                    </Chip>
                    <ChipMenu open={pop === "model"} onClose={() => setPop(null)} anchor={modelAnchor}>
                      <ModelMenu entries={entries} entry={entry} onPick={choose} onClose={() => setPop(null)} kind={kind} />
                    </ChipMenu>
                  </div>
                  <ParamMenu p={ratioP || ratioFallback} value={values[ratioP?.key]} onChange={(v) => setValue(ratioP.key, v)} title="Aspect ratio" icon={Rectangle} modelName={entry?.familyName}
                    others={ratioOthers} locked={ratioLock}
                    render={(v, row) => (row ? <><RatioIcon v={v} /><span className="w-12 tabular-nums">{String(v)}</span><span className="text-muted-foreground">{shapeWord(v)}</span></> : String(v))} />
                  <ParamMenu p={resP} value={values[resP?.key]} onChange={(v) => setValue(resP.key, v)} title="Resolution" icon={Monitor} modelName={entry?.familyName}
                    others={resOthers} right={(v) => PX[String(v).toLowerCase()] || ""}
                    render={(v, row, first) => (row ? <><span className="flex-1">{resName(v)}</span>{first && <span className="text-xs text-muted-foreground">Sharper detail</span>}</> : resShort(v))}
                    note={(v) => resParts(v).kind === "esr"}
                    caption={resP?.enum?.some(isEnhanced) ? "Enhanced is upscaled by the provider and takes longer. The price updates next to Generate." : null} />
                  <ParamMenu p={durP} value={values[durP?.key]} onChange={(v) => setValue(durP.key, v)} title="Length" icon={Clock} modelName={entry?.familyName}
                    render={(v) => (Number(v) === -1 ? "Auto" : `${v}s`)} caption="The price updates next to Generate." />
                  <div className="flex h-8 flex-shrink-0 items-center gap-0.5 rounded-md border border-border px-1 text-sm font-medium" aria-label="How many results">
                    <button type="button" onClick={() => setCount(Math.max(1, count - 1))} disabled={count <= 1} aria-label="Fewer" className="flex h-6 w-6 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Minus size={12} /></button>
                    <span className="flex items-center gap-1 px-1 tabular-nums">{kind === "video" ? <VideoCamera size={14} className="text-muted-foreground" /> : <Images size={14} className="text-muted-foreground" />}{count} / 4</span>
                    <button type="button" onClick={() => setCount(Math.min(4, count + 1))} disabled={count >= 4} aria-label="More" className="flex h-6 w-6 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Plus size={12} /></button>
                  </div>
                  <span className="min-w-0 flex-1" />
                  {light && (
                    <Chip icon={SlidersHorizontal} onClick={() => setPanel("settings")} active={panel === "settings"} aria-label="Settings" title={settingsChanged ? "Settings · changed from the model's defaults" : "Settings"}>
                      {squeeze >= 2 ? null : "Settings"}{settingsChanged && <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-label="Changed" />}
                    </Chip>
                  )}
                  <Chip icon={MagicWand} onClick={() => setPanel("adapt")} disabled={!adaptModel || !prompt.trim()} aria-label="Adapt"
                    title={squeeze >= 2 ? "Adapt" : prompt.trim() ? "Rewrite the prompt for this model" : "Write a prompt first"}>{squeeze >= 2 ? null : "Adapt"}</Chip>
                  {/* The price opens what goes to the model (the bare "Sent" label is gone, B10). */}
                  <button type="button" onClick={() => variant && setSentOpen(true)} disabled={!variant}
                    className={cn("h-8 flex-shrink-0 rounded-md px-1.5 text-sm tabular-nums hover:bg-accent hover:text-foreground disabled:hover:bg-transparent", priceLoading ? "text-subtle" : "text-muted-foreground")}
                    title={`What goes to the model${price ? (price.exact ? " · exact price for your account" : " · estimate") : ""}`}>{priceText}</button>
                  <button type="button" onClick={generateNow} disabled={!canRun}
                    className="ml-2 flex h-10 flex-shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-base font-medium text-primary-foreground transition-[background-color,transform] duration-state hover:bg-primary-hover active:scale-[.98] disabled:opacity-50">
                    {busy > 0 && <Spinner className="h-4 w-4 border-primary-foreground/30 border-t-primary-foreground" />}Generate
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" multiple className="hidden"
        onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ""; if (f.length) takeFiles(f); }} />

      <CameraLookPanel open={panel === "camera"} onClose={() => setPanel(null)} look={camera} setLook={setCamera} hints={sentPreview.data?.hints || []} />
      <MovePanel open={panel === "move"} onClose={() => setPanel(null)} move={move} setMove={setMove} />
      <LookPanel open={panel === "look"} onClose={() => setPanel(null)} look={camera} setLook={setCamera} />
      <SettingsPanel open={panel === "settings"} onClose={() => setPanel(null)} modelName={entry?.familyName} params={settingsParams} values={values} setValue={setValue}
        onReset={() => setValuesByKind((prev) => { const next = { ...(prev[kind] || {}) }; for (const p of settingsParams) delete next[p.key]; return { ...prev, [kind]: next }; })} />
      <AdaptPanel open={panel === "adapt"} onClose={() => setPanel(null)} prompt={prompt} model={adaptModel} context={adaptContext} look={look}
        request={variant ? { endpoint: variant.model.endpoint, body: quoteBody ? { ...quoteBody } : null } : null}
        onUse={(t) => { setPrompt(t); setPanel(null); requestAnimationFrame(() => engine.promptRef.current?.focus()); }} />
      <FullList open={panel === "list"} onClose={() => setPanel(null)} groups={groups} groupId={listGroup} setGroupId={setListGroup} attached={attached} sent={sent} setAttached={setAttached}
        tagOf={tagOf} modelName={entry?.familyName || ""} onError={(m) => notify({ type: "error", title: "Upload", message: m })} onUploading={(on) => engine.setUploads((n) => Math.max(0, n + (on ? 1 : -1)))} />
      <StudioViewer item={viewing} items={items} onClose={() => setViewing(null)} onMove={(it) => { markSeen(it); setViewing(it); }} act={{ ...act, hasMore: history.hasMore }} />
      <DrawModal isOpen={drawOpen} onClose={() => { setDrawOpen(false); setDrawImage(null); }} apiKey={props.apiKey} batchSize={1} studio={mode} initialImage={drawImage}
        onError={(m) => notify({ type: "error", title: "Draw to Edit", message: m })} onDone={() => refreshHistory(mode)} />
      <DzSentPanel open={sentOpen} onOpenChange={setSentOpen}
        requests={variant ? [{ endpoint: variant.model.endpoint, body: quoteBody || buildBody(variant, { prompt: finalPrompt, values, attached: merged.attached, elements: elementSpec ? activeElements : [] }), look, problem: missing || null }] : []} />
    </div>
  );
}
