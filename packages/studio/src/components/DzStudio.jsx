"use client";

// DZ: Studio — redesign package 01 (docs/ux/handoff/01-studio, §5). The work grid
// fills the screen; the composer floats over its bottom. The engine (models,
// attachments, price, generate, history) is the same as Image / Video
// (useDzCreateEngine); this file is only how the Studio looks and behaves.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Minus, At, X, Check, Cube, Rectangle, Monitor, Clock, VideoCamera, Images, MagicWand, Camera, ArrowsOutCardinal, Palette, SlidersHorizontal,
  Heart, DotsThree, ArrowsOut, ArrowSquareUp, DownloadSimple, Shapes, Trash, FolderSimple, Copy, UploadSimple, FilmSlate, ImageSquare, Flag, CaretDown, Info,
} from "@phosphor-icons/react";
import { dzThumb } from "../api.js";
import { dzLibrary } from "../dzLibrary.js";
import { dzOpenUpscale, dzUpscaleSpec, dzIsOwnImage, dzVideoUpscaleSpec, dzOpenVideoUpscale } from "../dzCatalog.js";
import { useDzCreateEngine, fmtUsd, download } from "./DzCreateStudio.jsx";
import { Viewer } from "./DzLibrary.jsx";
import DzSentPanel from "./DzSentPanel.jsx";
import { lookData, autoLook, elementTags, elementFits, TAG_RE, buildBody } from "../dzCreate.js";
import { DropdownMenuParts, Spinner, cn } from "../ui/index.js";
import { Overline, Chip, ChipMenu, MenuRow, useEscLayer, fmtDur } from "./studio/ui.jsx";
import { groupsFor, groupItems, addToGroup, removeFromGroup, unusedItems, GROUP_OF_ROLE } from "./studio/attachments.js";
import ModelMenu from "./studio/ModelMenu.jsx";
import { LibraryWindow, FullList } from "./studio/Library.jsx";
import { CameraLookPanel, MovePanel, LookPanel, SettingsPanel, AdaptPanel } from "./studio/Panels.jsx";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } = DropdownMenuParts;
const RATIO_KEYS = ["aspect_ratio", "ratio", "size", "image_size"];
const RES_KEYS = ["resolution", "quality"];
const RATIO_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;
const ratioNum = (v) => { const m = RATIO_RE.exec(String(v || "")); return m ? Number(m[1]) / Number(m[2]) : null; };
const shapeWord = (v) => { const r = ratioNum(v); return r == null ? "" : r > 1.05 ? "Landscape" : r < 0.95 ? "Vertical" : "Square"; };
const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));
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

function PendingTile({ item }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const waiting = item.note && /wait|queue|gpu/i.test(item.note);
  if (item.status === "failed") {
    return (
      <div className="flex h-full w-full flex-col justify-end gap-1 bg-destructive/[.06] p-3">
        <span className="text-base font-semibold text-destructive">Failed</span>
        {item.error && <span className="line-clamp-3 text-sm text-destructive" title={item.error}>{item.error}</span>}
      </div>
    );
  }
  return (
    <div className="relative flex h-full w-full flex-col justify-end gap-0.5 bg-card p-3" title="It keeps going if you close the page">
      {!waiting && <span className="dz-shimmer absolute inset-0" aria-hidden="true" />}
      {waiting ? (
        <>
          <span className="relative flex items-center gap-2 text-base font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-warning" /> Waiting for the GPU</span>
          <span className="relative line-clamp-2 text-sm text-muted-foreground">{item.note.replace(/^Waiting for the GPU:?\s*/i, "")}</span>
        </>
      ) : (
        <>
          <span className="relative text-base font-semibold">{item.studio === "upscale" ? "Upscaling" : "Generating"}</span>
          <span className="relative truncate text-sm text-muted-foreground">{[item.meta?.modelName?.split(" · ")[0], item.created_at ? fmtDur((now - item.created_at) / 1000) : ""].filter(Boolean).join(" · ")}</span>
        </>
      )}
      {item.cancellable && (
        <button type="button" onClick={(e) => { e.stopPropagation(); dzLibrary.cancel(item.id).catch((err) => notify({ type: "error", title: "Cancel", message: String(err?.message || err) })); }}
          className="relative mt-1 self-start text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Cancel</button>
      )}
    </div>
  );
}

function TileMenu({ item, onUseStart, onUseRef, onTrash, open, setOpen }) {
  const isVideo = item.kind === "video";
  const canUp = isVideo ? dzVideoUpscaleSpec() && dzIsOwnImage(item.url) : dzUpscaleSpec() && dzIsOwnImage(item.url);
  const Row = ({ icon: Icon, children, onSelect, danger }) => (
    <DropdownMenuItem onSelect={onSelect} className={cn("h-8 gap-2.5 px-2.5", danger && "text-destructive focus:text-destructive")}><Icon size={16} />{children}</DropdownMenuItem>
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="More" onClick={(e) => e.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-overlay/55 text-overlay-foreground backdrop-blur-md transition-colors duration-state hover:bg-overlay/75"><DotsThree size={16} weight="bold" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[212px] p-1.5" onClick={(e) => e.stopPropagation()}>
        <Row icon={ArrowsOut} onSelect={() => window.dispatchEvent(new CustomEvent("dz:studio-open", { detail: item }))}>Open</Row>
        {!isVideo && <Row icon={Flag} onSelect={() => onUseStart(item)}>Use as start frame</Row>}
        <Row icon={ImageSquare} onSelect={() => onUseRef(item)}>{isVideo ? "Use as reference video" : "Use as reference"}</Row>
        {canUp && <Row icon={ArrowSquareUp} onSelect={() => (isVideo ? dzOpenVideoUpscale(item.url) : dzOpenUpscale(item.url))}>Upscale</Row>}
        <Row icon={Shapes} onSelect={() => window.dispatchEvent(new CustomEvent("dz:to-element", { detail: { items: [item] } }))}>Make element</Row>
        <Row icon={DownloadSimple} onSelect={() => download(item.url)}>Download</Row>
        <DropdownMenuSeparator />
        <Row icon={Trash} danger onSelect={() => onTrash(item.id)}>Move to Trash</Row>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Tile({ item, width, height, onMeasure, sel, onOpen, onLike, onUseStart, onUseRef, onTrash }) {
  const [menu, setMenu] = useState(false);
  const selecting = sel.selecting;
  const on = sel.has(item.id);
  const done = Boolean(item.url);
  const duration = item.kind === "video" ? Number(item.params?.duration || item.meta?.values?.duration) : 0;
  return (
    <div role={done ? "button" : undefined} tabIndex={done ? 0 : -1} aria-pressed={selecting ? on : undefined}
      onClick={(e) => { if (!done) return; if (selecting) { sel.toggle(item, e); return; } onOpen(item); }}
      onKeyDown={(e) => { if (done && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); if (selecting) sel.toggle(item, e); else onOpen(item); } }}
      {...(done ? sel.dragProps(item) : {})}
      className="group relative flex-shrink-0 cursor-pointer overflow-hidden rounded-sm bg-muted"
      style={{ width, height }}>
      {!done ? <PendingTile item={item} />
        : item.kind === "audio" ? <span className="flex h-full w-full items-center justify-center p-3 text-center text-muted-foreground">♪ {item.meta?.toolTitle || item.prompt || "Audio"}</span>
          : item.kind === "video" ? (
            <video src={item.url} poster={dzThumb(item.url)} muted loop playsInline preload="metadata" className="h-full w-full object-cover"
              onLoadedMetadata={(e) => onMeasure(item.id, e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
              onMouseOver={(e) => e.currentTarget.play().catch(() => {})} onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
          ) : (
            <img src={dzThumb(item.url)} alt={item.prompt?.slice(0, 80) || "Result"} loading="lazy" decoding="async" className="h-full w-full object-cover"
              onLoad={(e) => onMeasure(item.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
          )}
      {done && <span className={cn("pointer-events-none absolute inset-0 rounded-sm transition-colors duration-state", on ? "bg-overlay/[.28] ring-2 ring-inset ring-signal" : "group-hover:bg-overlay-foreground/[.07] group-hover:ring-1 group-hover:ring-inset group-hover:ring-overlay-foreground/10")} />}
      {done && (item.studio === "upscale" || duration > 0) && (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-xs bg-overlay/60 px-1.5 text-xs font-medium tabular-nums text-overlay-foreground">{item.studio === "upscale" ? "Upscaled" : fmtDur(duration)}</span>
      )}
      {selecting && done && (
        <span className={cn("absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-[6px] border", on ? "border-signal bg-signal text-primary-foreground" : "border-overlay-foreground/80 bg-overlay/30")}>{on && <Check size={12} weight="bold" />}</span>
      )}
      {!selecting && done && (
        <div className={cn("absolute right-2 top-2 flex gap-1.5 transition-opacity duration-state", menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}>
          <button type="button" aria-label={item.liked ? "Unlike" : "Like"} aria-pressed={Boolean(item.liked)} onClick={(e) => { e.stopPropagation(); onLike(item.id, !item.liked); }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-overlay/55 text-overlay-foreground backdrop-blur-md transition-colors duration-state hover:bg-overlay/75"><Heart size={15} weight={item.liked ? "fill" : "regular"} className={item.liked ? "text-signal" : ""} /></button>
          <TileMenu item={item} open={menu} setOpen={setMenu} onUseStart={onUseStart} onUseRef={onUseRef} onTrash={onTrash} />
        </div>
      )}
      {!selecting && done && item.liked && !menu && (
        <span className="pointer-events-none absolute right-[46px] top-2 flex h-7 w-7 items-center justify-center rounded-full bg-overlay/55 backdrop-blur-md transition-opacity group-hover:opacity-0"><Heart size={15} weight="fill" className="text-signal" /></span>
      )}
      {!done && item.status === "failed" && (
        <button type="button" aria-label="Move to Trash" onClick={(e) => { e.stopPropagation(); onTrash(item.id); }} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-overlay/55 text-overlay-foreground hover:bg-overlay/75"><Trash size={14} /></button>
      )}
    </div>
  );
}

// The tabs row, or in its place (same height) the selection actions (§5.2).
function TabsRow({ sel, kindFilter, setKindFilter, canSelect }) {
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
      {[["all", "All"], ["image", "Images"], ["video", "Videos"]].map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={kindFilter === v} onClick={() => setKindFilter(v)}
          className={cn("-mb-px h-11 border-b-2 text-base font-medium transition-colors duration-state", kindFilter === v ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
      ))}
      {canSelect && <button type="button" onClick={sel.start} className="mb-2.5 ml-auto h-6 text-base font-medium text-muted-foreground transition-colors duration-state hover:text-foreground">Select</button>}
    </div>
  );
}

// ── Strip (§5.4) ────────────────────────────────────────────────────────────
function Thumb({ item, kind, label, tag, onRemove, onDragStart, fault }) {
  const [dur, setDur] = useState(null);
  return (
    <div className="dz-pop group/t relative h-12 w-12 flex-shrink-0" draggable onDragStart={onDragStart} tabIndex={0}>
      <div className={cn("h-12 w-12 overflow-hidden rounded-slot bg-muted ring-signal transition-shadow duration-state group-hover/t:ring-2 group-focus/t:ring-2", fault && "ring-2 ring-destructive")}>
        {kind === "video" ? <video src={item.url} poster={dzThumb(item.url, 128)} muted preload="metadata" className="h-full w-full object-cover" onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} />
          : kind === "audio" ? <span className="flex h-full items-center justify-center text-muted-foreground">♪</span>
            : <img src={dzThumb(item.url, 128)} alt="" className="h-full w-full object-cover" />}
        {(label || dur) && <span className="absolute inset-x-0 bottom-0 rounded-b-slot bg-overlay/70 text-center text-[11px] font-semibold leading-4 text-overlay-foreground">{label || fmtDur(dur)}</span>}
      </div>
      <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-popover transition-opacity delay-0 duration-state group-hover/t:opacity-100 group-hover/t:delay-300 group-focus/t:opacity-100">{tag}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${tag}`}
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

function Strip({ groups, unused, attached, setAttached, activeGroup, openLibrary, openList, tagOf, modelName, fault }) {
  const dragging = useRef(null);
  const drop = (g) => (e) => {
    const d = dragging.current;
    dragging.current = null;
    if (!d || d.group === g.id) return;
    e.preventDefault();
    const from = groups.find((x) => x.id === d.group);
    if (!from || from.kind !== g.kind) return;
    // Only when the target has room: a full group leaves the item where it was.
    setAttached((a) => (groupItems(a, g).length >= g.max ? a : addToGroup(removeFromGroup(a, from, d.item.url), g, [d.item])));
  };
  const tagText = (item, fallback) => { const t = tagOf(item.url); return t ? `@${t.tag} · ${t.label || fallback}` : fallback; };
  const thumb = (g, item, label) => (
    <Thumb key={item.url} item={item} kind={g.kind} label={label} tag={tagText(item, label || g.label)} fault={fault === g.id}
      onDragStart={() => { dragging.current = { group: g.id, item: { url: item.url, name: item.name } }; }}
      onRemove={() => setAttached((a) => removeFromGroup(a, g, item.url))} />
  );
  return (
    <div className="flex items-start">
      {groups.map((g, gi) => {
        const items = groupItems(attached, g);
        const room = items.length < g.max;
        let body;
        if (g.id === "frames") {
          const start = items.find((x) => x.role === "first");
          const mids = items.filter((x) => x.role === "middle");
          const end = items.find((x) => x.role === "last");
          body = (
            <>
              {g.roleMax.first && (start ? thumb(g, start, "Start") : <EmptySlot label="Start" onClick={() => openLibrary(g.id)} fault={fault === g.id} />)}
              {mids.slice(0, 1).map((m) => thumb(g, m, "Mid 1"))}
              {mids.length > 1 && <More n={mids.length - 1} onClick={() => openList(g.id)} />}
              {g.roleMax.middle && mids.length < g.roleMax.middle && <EmptySlot label="Mid" onClick={() => openLibrary(g.id)} />}
              {g.roleMax.last && (end ? thumb(g, end, "End") : <EmptySlot label="End" onClick={() => openLibrary(g.id)} />)}
            </>
          );
        } else {
          body = (
            <>
              {items.slice(0, 3).map((it) => thumb(g, it, ""))}
              {items.length > 3 && <More n={items.length - 3} onClick={() => openList(g.id)} />}
              {room && <EmptySlot onClick={() => openLibrary(g.id)} fault={fault === g.id && !items.length} />}
            </>
          );
        }
        return (
          <div key={g.id} className={cn("flex", gi > 0 && "ml-3.5 border-l border-border pl-3.5")} onDragOver={(e) => { if (dragging.current && dragging.current.group !== g.id) e.preventDefault(); }} onDrop={drop(g)}>
            <div>
              <button type="button" onClick={() => openLibrary(g.id)} className="relative mb-2 flex h-4 items-center gap-1.5">
                <Overline className={cn(activeGroup === g.id && "text-foreground")}>{g.label}</Overline>
                <span className="text-[11px] tabular-nums text-muted-foreground">{items.length} / {g.max}</span>
                {activeGroup === g.id && <span className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-signal" />}
              </button>
              <div className="flex gap-2">{body}</div>
            </div>
          </div>
        );
      })}
      {unused.length > 0 && (
        <div className="ml-3.5 border-l border-border pl-3.5 opacity-50" title="Kept, not sent to this model">
          <div className="mb-2 flex h-4 items-center gap-1.5"><Overline>Not used by {modelName}</Overline><span className="text-[11px] text-muted-foreground">{unused.length}</span></div>
          <div className="flex gap-2">
            {unused.slice(0, 2).map((it) => (
              <div key={`${it.role}-${it.url}`} className="h-12 w-12 overflow-hidden rounded-slot bg-muted">
                {GROUP_OF_ROLE[it.role] === "video" || it.role === "source" ? <video src={it.url} poster={dzThumb(it.url, 128)} muted preload="metadata" className="h-full w-full object-cover" /> : it.role === "audio" ? <span className="flex h-full items-center justify-center">♪</span> : <img src={dzThumb(it.url, 128)} alt="" className="h-full w-full object-cover" />}
              </div>
            ))}
            {unused.length > 2 && <span className="flex h-12 w-12 items-center justify-center rounded-slot bg-muted text-base font-semibold">+{unused.length - 2}</span>}
            <button type="button" onClick={() => setAttached((a) => Object.fromEntries(Object.entries(a).filter(([role]) => groups.some((g) => g.roleMax[role]))))} aria-label="Remove the unused items"
              className="flex h-12 w-12 items-center justify-center rounded-slot border border-dashed border-input text-muted-foreground hover:bg-accent hover:text-foreground"><X size={14} /></button>
          </div>
        </div>
      )}
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
function PromptField({ engine, onFocusChange, mentionGroups, onPasteFiles }) {
  const { prompt, setPrompt, promptRef, readMention, onPromptKey, setMention, mention, tags, jsonPrompt } = engine;
  const back = useRef(null);
  const known = useMemo(() => new Set(tags.map((t) => t.tag.toLowerCase())), [tags]);
  const json = jsonPrompt.json;
  // Grow upward with the text up to ~330 px, then scroll inside.
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 330)}px`;
  }, [prompt, promptRef, json]);
  const parts = useMemo(() => {
    const out = [];
    let last = 0;
    for (const m of String(prompt).matchAll(TAG_RE)) {
      const start = m.index + m[1].length;
      if (!known.has(m[2].toLowerCase())) continue;
      out.push(prompt.slice(last, start));
      out.push(<mark key={start} className="rounded-xs bg-signal/[.14] text-signal shadow-[0_0_0_1px_hsl(var(--signal)/.42)]">{prompt.slice(start, start + m[2].length + 1)}</mark>);
      last = start + m[2].length + 1;
    }
    out.push(prompt.slice(last));
    return out;
  }, [prompt, known]);
  const shared = cn("w-full whitespace-pre-wrap break-words rounded-[10px] px-3 py-2.5", json ? "font-mono text-[13px] leading-5" : "text-prompt");
  return (
    <div className="relative">
      <div ref={back} aria-hidden="true" className={cn(shared, "pointer-events-none absolute inset-0 overflow-hidden text-foreground")}>{parts}{"\n"}</div>
      <textarea ref={promptRef} value={prompt} rows={1} spellCheck={!json}
        placeholder="Describe the shot. Type @ to use an element or anything you attached."
        onChange={(e) => { setPrompt(e.target.value); readMention(e.target); }}
        onKeyDown={onPromptKey}
        onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) readMention(e.target); }}
        onClick={(e) => readMention(e.target)}
        onScroll={(e) => { if (back.current) back.current.scrollTop = e.currentTarget.scrollTop; }}
        onFocus={() => onFocusChange(true)}
        onBlur={() => { onFocusChange(false); setTimeout(() => setMention(null), 150); }}
        onPaste={(e) => { const files = Array.from(e.clipboardData?.files || []); if (files.length) { e.preventDefault(); onPasteFiles(files); } }}
        className={cn(shared, "custom-scrollbar relative block resize-none bg-transparent text-transparent caret-signal outline-none transition-colors duration-state placeholder:text-muted-foreground focus:bg-muted focus:shadow-[inset_0_0_0_1px_hsl(var(--input))] focus-visible:outline-none selection:bg-signal/30 selection:text-foreground")} />
      {mention && (
        <div className="glass absolute bottom-[calc(100%+8px)] left-0 z-30 w-[420px] rounded-xl border border-border p-1.5 shadow-popover" role="listbox" aria-label="Tags">
          {mentionGroups.length === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">{mention.query ? `Nothing called “${mention.query}”.` : "Nothing to tag yet."} Attach files with + or make elements.</p>}
          {mentionGroups.map(([title, list]) => (
            <div key={title} className="py-0.5">
              <div className="px-2.5 py-1"><Overline>{title}</Overline></div>
              {list.map(({ o, i }) => (
                <button key={`${o.tag}-${o.element?.id || ""}`} type="button" role="option" aria-selected={i === mention.index} aria-disabled={Boolean(o.disabled)}
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
function ParamMenu({ p, value, onChange, title, icon, render, caption, modelName }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  if (!p) return null;
  const options = Array.isArray(p.enum) ? p.enum
    : p.minValue != null && p.maxValue != null ? Array.from({ length: Math.min(30, Math.floor((p.maxValue - p.minValue) / (p.step || 1)) + 1) }, (_, i) => p.minValue + i * (p.step || 1)) : [];
  const current = value ?? p.default ?? options[0];
  return (
    <div className="relative" ref={anchor}>
      <Chip icon={icon} active={open} onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open}>{render(current)}</Chip>
      <ChipMenu open={open} onClose={() => setOpen(false)} anchor={anchor} className="w-[240px] p-1.5">
        <div className="px-2.5 pb-1 pt-1.5"><Overline>{title} · {modelName}</Overline></div>
        <div className="custom-scrollbar max-h-[320px] overflow-y-auto">
          {options.map((o) => (
            <MenuRow key={String(o)} on={String(o) === String(current)} onClick={() => { onChange(o); setOpen(false); }}>
              {render(o, true)}
            </MenuRow>
          ))}
        </div>
        {caption && <p className="px-2.5 pb-1 pt-2 text-xs text-muted-foreground">{caption}</p>}
      </ChipMenu>
    </div>
  );
}
const RatioIcon = ({ v }) => {
  const r = ratioNum(v) || 1;
  const w = r >= 1 ? 18 : Math.max(8, Math.round(18 * r));
  const h = r >= 1 ? Math.max(8, Math.round(18 / r)) : 18;
  return <span className="flex h-[18px] w-[18px] items-center justify-center"><span className="rounded-[2px] border-[1.5px] border-current" style={{ width: w, height: h }} /></span>;
};

// ── Studio ──────────────────────────────────────────────────────────────────
export default function DzStudio(props) {
  const engine = useDzCreateEngine({ ...props, mode: "create" });
  const {
    kind, setKind, entries, entry, attached, setAttached, params, values, setValue, setValuesByKind, prompt, setPrompt, camera, setCamera, move, setMove, count, setCount,
    canRun, missing, price, priceLoading, generate, busy, history, sel, ctx, kindFilter, setKindFilter, viewing, setViewing, applyResult, mention, mentionOptions,
    tags, look, adaptModel, adaptContext, quoteBody, variant, sentPreview, sentOpen, setSentOpen, addFiles, pickModel, elements, unusedCount, merged, elementSpec, activeElements, finalPrompt,
  } = engine;

  // The look in the Studio: every part Auto unless chosen.
  useEffect(() => { if (!camera?.auto) setCamera(autoLook(camera)); }, [camera, setCamera]);
  const a = autoLook(camera);

  const [panel, setPanel] = useState(null); // camera | move | look | settings | adapt | list
  const [pop, setPop] = useState(null); // model | els
  const [libGroup, setLibGroup] = useState(null); // library window open on a group
  const [listGroup, setListGroup] = useState(null);
  const [focus, setFocus] = useState(false);
  const [mini, setMini] = useState(false);
  const [aspects, measure] = useAspects();
  const modelAnchor = useRef(null);
  const atAnchor = useRef(null);
  const scroller = useRef(null);
  const [gridEl, gridRef] = useState(null);
  const gridWidth = useWidth(gridEl);
  const fileInput = useRef(null);

  const groups = useMemo(() => groupsFor(entry), [entry]);
  const unused = useMemo(() => unusedItems(attached, groups), [attached, groups]);
  const tagOf = (url) => tags.find((t) => t.url === url);
  const closeAll = () => { setPanel(null); setPop(null); setLibGroup(null); };
  const openLibrary = (gid) => { setPop(null); setPanel(null); setLibGroup(gid || groups.find((g) => g.id === "reference")?.id || groups[0]?.id || null); };
  const openList = (gid) => { setLibGroup(null); setListGroup(gid); setPanel("list"); };

  // Results opened from the tile menu.
  useEffect(() => {
    const on = (e) => setViewing(e.detail);
    window.addEventListener("dz:studio-open", on);
    return () => window.removeEventListener("dz:studio-open", on);
  }, [setViewing]);

  // Model change: attachments the new model does not take stay, dimmed, with Undo.
  const choose = (key, { close } = {}) => {
    const prevKey = entry?.key;
    if (key !== prevKey) {
      const next = entries.find((e) => e.key === key);
      const lost = unusedItems(attached, groupsFor(next)).length;
      pickModel(key);
      if (lost > unused.length) {
        notify({ type: "notice", title: next?.familyName, message: `${next?.familyName || "This model"} does not take ${lost} of your items. ${lost === 1 ? "It is" : "They are"} kept but not sent.`, undo: () => pickModel(prevKey) });
      }
    }
    if (close) setPop(null);
  };

  // Parameters: ratio, resolution and length are chips; everything else is in Settings.
  const allParams = [...params.main, ...params.advanced];
  const ratioP = allParams.find((p) => RATIO_KEYS.includes(p.key) && Array.isArray(p.enum));
  const resP = allParams.find((p) => RES_KEYS.includes(p.key) && Array.isArray(p.enum));
  const durP = kind === "video" ? allParams.find((p) => p.key === "duration") : null;
  const settingsParams = allParams.filter((p) => p !== ratioP && p !== resP && p !== durP && !["num_images", "n", "batch_size"].includes(p.key));
  const settingsChanged = settingsParams.some((p) => values[p.key] != null && values[p.key] !== p.default);

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
    notify({ type: "notice", title: "Generate", message: count > 1 ? `${count} jobs added. The tiles appear first in the grid.` : "Added to the queue. The tile appears first in the grid." });
  };
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
  useEffect(() => { if (busyUi) setMini(false); }, [busyUi]);
  const onScroll = (e) => {
    const y = e.currentTarget.scrollTop;
    if (y > 24 && !mini && !busyUi) setMini(true);
    else if (y <= 0 && mini) setMini(false);
  };

  const items = history.items;
  const rows = useMemo(() => justify(items, aspects, gridWidth), [items, aspects, gridWidth]);
  const total = groups.reduce((n, g) => n + groupItems(attached, g).length, 0);
  const faultGroup = missing ? (groups.find((g) => /start frame|first/i.test(missing) && g.id === "frames") || groups.find((g) => new RegExp(g.label, "i").test(missing)))?.id : null;
  const priceText = price ? `${price.exact ? "" : "≈ "}${fmtUsd(price.usd * count)}` : entry?.priceLabel || "";
  const where = ctx.project ? [ctx.project.name, ...(ctx.folderPath || [])].join(" / ") : "Library";
  const libraryOpen = Boolean(libGroup);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <style>{`.dz-pop{animation:dzPop 180ms cubic-bezier(.2,.8,.2,1)}@keyframes dzPop{from{transform:scale(.8);opacity:0}}.dz-sel-in{animation:dzSelIn 160ms cubic-bezier(.2,.8,.2,1)}@keyframes dzSelIn{from{transform:translateY(-4px);opacity:0}}`}</style>
      <div ref={scroller} onScroll={onScroll} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 [container-type:inline-size]">
        <div className="flex items-baseline gap-3 pb-3 pt-6">
          <h1 className="text-xl font-semibold">Studio</h1>
          <span className="truncate text-sm text-muted-foreground">{where}</span>
        </div>
        {(items.length > 0 || !history.loaded || kindFilter !== "all") && <TabsRow sel={sel} kindFilter={kindFilter} setKindFilter={setKindFilter} canSelect={items.some((i) => i.url)} />}
        {history.loaded && items.length === 0 ? (
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
              <Tile key={item.id} item={item} width={w} height={row.h} onMeasure={measure} sel={sel} onOpen={setViewing}
                onLike={history.like} onTrash={(id) => history.trash(id).catch((e) => notify({ type: "error", title: "Trash", message: String(e?.message || e) }))}
                onUseStart={(it) => applyResult(it, "animate")}
                onUseRef={(it) => {
                  const gid = it.kind === "video" ? "video" : "reference";
                  const g = groups.find((x) => x.id === gid);
                  if (g) setAttached((prev) => addToGroup(prev, g, [{ url: it.url, name: "result" }]));
                  else setAttached((prev) => ({ ...prev, [gid]: [...(prev[gid] || []), { url: it.url, name: "result" }] }));
                }} />
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
          <div className="pointer-events-auto relative w-[min(1080px,100%)] rounded-xl border border-border bg-card p-3.5 shadow-float"
            onDragOver={(e) => { if (Array.from(e.dataTransfer?.types || []).includes("Files")) { e.preventDefault(); e.stopPropagation(); } }}
            onDrop={(e) => { const files = Array.from(e.dataTransfer?.files || []); if (files.length) { e.preventDefault(); e.stopPropagation(); takeFiles(files); } }}>
            <LibraryWindow open={libraryOpen} groups={groups} groupId={libGroup} setGroupId={setLibGroup} attached={attached} setAttached={setAttached}
              onClose={() => setLibGroup(null)} onError={(m) => notify({ type: "error", title: "Upload", message: m })} onUploading={(on) => engine.setUploads((n) => Math.max(0, n + (on ? 1 : -1)))} />

            {/* 1. Attachments strip — always visible */}
            {groups.length > 0 || unused.length > 0 ? (
              <Strip groups={groups} unused={unused} attached={attached} setAttached={setAttached} activeGroup={libGroup || (panel === "list" ? listGroup : null)}
                openLibrary={openLibrary} openList={openList} tagOf={tagOf} modelName={entry?.familyName || "this model"} fault={faultGroup} />
            ) : (
              <p className="flex h-[66px] items-center text-sm text-muted-foreground">{entry ? `${entry.familyName} takes text only.` : "Loading models…"}</p>
            )}

            {/* 2–4 fold away while the library is open */}
            <div className={cn("grid transition-[grid-template-rows,opacity] duration-[240ms] ease-soft", libraryOpen ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")}>
              <div className={cn(libraryOpen ? "overflow-hidden" : "overflow-visible")}>
                <div className={cn("mt-3 grid gap-2", kind === "video" ? "grid-cols-4" : "grid-cols-3")}>
                  <Block icon={Camera} label="Camera" value={camParts.length ? camParts.join(" · ") : "Auto"} auto={!camParts.length} onClick={() => setPanel("camera")} active={panel === "camera"} />
                  {kind === "video" && <Block icon={ArrowsOutCardinal} label="Move" value={moveLabel || "Auto"} auto={!moveLabel} onClick={() => setPanel("move")} active={panel === "move"} />}
                  <Block icon={Palette} label="Look" value={lookParts.length ? `${lookParts[0]}${lookParts.length > 1 ? ` +${lookParts.length - 1}` : ""}` : "Auto"} auto={!lookParts.length} onClick={() => setPanel("look")} active={panel === "look"} />
                  <Block icon={SlidersHorizontal} label="Settings" value={settingsChanged ? "Changed" : "Model defaults"} auto={!settingsChanged} onClick={() => setPanel("settings")} active={panel === "settings"} />
                </div>

                <div className="mt-3"><PromptField engine={engineForPrompt} onFocusChange={setFocus} mentionGroups={mentionGroups} onPasteFiles={takeFiles} /></div>
                {sentPreview.data?.hints?.length > 0 && <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning"><Info size={14} className="mt-px flex-shrink-0" />{sentPreview.data.hints[0]}</p>}

                {/* 4. Bottom row — never wraps */}
                <div className="mt-3 flex items-center gap-1.5 whitespace-nowrap max-[1000px]:flex-wrap max-[1000px]:gap-y-2">
                  <button type="button" onClick={() => openLibrary()} aria-label="Add from the library" disabled={!groups.length}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground disabled:opacity-40"><Plus size={18} /></button>
                  <div className="relative" ref={atAnchor}>
                    <button type="button" onClick={() => setPop(pop === "els" ? null : "els")} aria-label="Elements" aria-expanded={pop === "els"}
                      className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground", pop === "els" && "bg-accent text-foreground")}><At size={18} /></button>
                    <ElementsWindow open={pop === "els"} onClose={() => setPop(null)} engine={engine} anchor={atAnchor} />
                  </div>
                  <div className="flex h-8 flex-shrink-0 items-center rounded-md bg-muted p-0.5" role="group" aria-label="Image or video">
                    {[["image", "Image"], ["video", "Video"]].map(([v, l]) => (
                      <button key={v} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}
                        className={cn("h-7 rounded-[6px] px-2.5 text-sm font-medium transition-colors duration-state", kind === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                    ))}
                  </div>
                  <div className="relative" ref={modelAnchor}>
                    <Chip icon={Cube} active={pop === "model"} onClick={() => setPop(pop === "model" ? null : "model")} aria-expanded={pop === "model"} className="max-w-[240px]">
                      <span className="truncate">{entry ? `${entry.familyName} · ${entry.providerName}` : "Choose a model"}</span><CaretDown size={12} className="flex-shrink-0 text-muted-foreground" />
                    </Chip>
                    <ChipMenu open={pop === "model"} onClose={() => setPop(null)} anchor={modelAnchor}>
                      <ModelMenu entries={entries} entry={entry} onPick={choose} onClose={() => setPop(null)} />
                    </ChipMenu>
                  </div>
                  <ParamMenu p={ratioP} value={values[ratioP?.key]} onChange={(v) => setValue(ratioP.key, v)} title="Aspect ratio" icon={Rectangle} modelName={entry?.familyName}
                    render={(v, row) => (row ? <><RatioIcon v={v} /><span className="w-12 tabular-nums">{String(v)}</span><span className="text-muted-foreground">{shapeWord(v)}</span></> : String(v))} />
                  <ParamMenu p={resP} value={values[resP?.key]} onChange={(v) => setValue(resP.key, v)} title="Resolution" icon={Monitor} modelName={entry?.familyName} render={(v) => String(v)} />
                  <ParamMenu p={durP} value={values[durP?.key]} onChange={(v) => setValue(durP.key, v)} title="Length" icon={Clock} modelName={entry?.familyName}
                    render={(v) => (Number(v) === -1 ? "Auto" : `${v}s`)} caption="The price updates next to Generate." />
                  <div className="flex h-8 flex-shrink-0 items-center gap-0.5 rounded-md border border-border px-1 text-sm font-medium" aria-label="How many results">
                    <button type="button" onClick={() => setCount(Math.max(1, count - 1))} disabled={count <= 1} aria-label="Fewer" className="flex h-6 w-6 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Minus size={12} /></button>
                    <span className="flex items-center gap-1 px-1 tabular-nums">{kind === "video" ? <VideoCamera size={14} className="text-muted-foreground" /> : <Images size={14} className="text-muted-foreground" />}{count} / 4</span>
                    <button type="button" onClick={() => setCount(Math.min(4, count + 1))} disabled={count >= 4} aria-label="More" className="flex h-6 w-6 items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Plus size={12} /></button>
                  </div>
                  <span className="min-w-0 flex-1" />
                  {variant && <button type="button" onClick={() => setSentOpen(true)} className="h-8 flex-shrink-0 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground" title="What goes to the model">Sent</button>}
                  <Chip icon={MagicWand} onClick={() => setPanel("adapt")} disabled={!adaptModel || !prompt.trim()} title={prompt.trim() ? "Rewrite the prompt for this model" : "Write a prompt first"}>Adapt</Chip>
                  {missing && <span className="max-w-[200px] flex-shrink truncate text-xs text-warning" title={missing}>{missing}</span>}
                  <span className={cn("flex-shrink-0 text-sm tabular-nums", priceLoading ? "text-subtle" : "text-muted-foreground")} title={price ? (price.exact ? "Exact price for your account" : "Estimate") : undefined}>{priceText}</span>
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
      <FullList open={panel === "list"} onClose={() => setPanel(null)} groups={groups} groupId={listGroup} setGroupId={setListGroup} attached={attached} setAttached={setAttached}
        tagOf={tagOf} modelName={entry?.familyName || ""} onError={(m) => notify({ type: "error", title: "Upload", message: m })} onUploading={(on) => engine.setUploads((n) => Math.max(0, n + (on ? 1 : -1)))} />
      <Viewer item={viewing} onClose={() => setViewing(null)} />
      <DzSentPanel open={sentOpen} onOpenChange={setSentOpen}
        requests={variant ? [{ endpoint: variant.model.endpoint, body: quoteBody || buildBody(variant, { prompt: finalPrompt, values, attached: merged.attached, elements: elementSpec ? activeElements : [] }), look, problem: missing || null }] : []} />
    </div>
  );
}
