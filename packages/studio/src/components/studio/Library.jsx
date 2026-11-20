"use client";

// Library window (redesign 01, §5.5) and the full list ("+N", screen 12).
// Every click applies at once: the picture joins the active group, numbered in
// order of adding; a full group dims the rest. The group decides the type.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, Broom, X, UploadSimple, DotsSixVertical, CaretDown, CaretLeft } from "@phosphor-icons/react";
import { useDzDropTarget } from "../../dzDrop.js";
import { dzThumb, uploadFile } from "../../api.js";
import { useDzContext } from "../../dzContext.js";
import { usePaged } from "../DzMedia.jsx";
import { useDzElements } from "../DzElements.jsx";
import { Spinner, cn } from "../../ui/index.js";
import { StudioPanel, Overline, ChipMenu, MenuRow, usePresence, useEscLayer, useDialogFocus } from "./ui.jsx";
import { groupItems, addToGroup, removeFromGroup, clearGroup, reorderGroup, GROUPS } from "./attachments.js";

const SOURCES = [["uploads", "Uploads"], ["generations", "Generations"], ["liked", "Liked"], ["elements", "Elements"]];

// Package 06, S3: inside a storyboard the picker gets a first tab with that storyboard's
// Moodboard, grouped by the user's frames. A storyboard provides:
// { frames: [{ id, name, color (CSS colour), items: [{ url, kind, w, h }] }], loose: [...],
//   place(refs) — put uploaded files on its Moodboard, outside frames }.
export const PickerBoardContext = createContext(null);
const PIC_H = 112;
const ACCEPT = { image: "image/png,image/jpeg,image/webp", video: "video/mp4,video/quicktime,video/webm", audio: "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg" };

// The browsing part: search, scope, source tabs and the grid. Shared by the window and the full list.
function Browser({ group, attached, setAttached, columns = 8, onError, onUploading, st = null, initial = null }) {
  const ctx = useDzContext();
  const board = useContext(PickerBoardContext);
  const [source, setSource] = useState(initial?.source || (board ? "moodboard" : "generations"));
  const [inElement, setInElement] = useState(initial?.element || null); // Elements tab: inside one element (S2)
  const box = useRef(null);
  const [where, setWhere] = useState(ctx.project ? "project" : "library");
  const [q, setQ] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeAnchor = useRef(null);
  const [refresh, setRefresh] = useState(0);
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef(null);
  useEffect(() => { setWhere(ctx.project ? "project" : "library"); }, [ctx.project?.id]);
  const accept = group?.kind || "image";
  const paged = usePaged(source, "all", where, accept, ctx, refresh);
  const els = useDzElements();
  // Elements (S2): the elements first; inside one, its views (or videos) with their labels.
  const elementList = useMemo(() => {
    const list = (where === "project" && ctx.project ? els.project : els.library).filter((e) => e.status !== "draft");
    const all = [...list, ...[...els.project, ...els.library].filter((e) => e.id === inElement && !list.some((x) => x.id === e.id))];
    return all.filter((e) => (accept === "video" ? (e.videos || []).length : (e.views || e.images || []).length));
  }, [els, where, ctx.project, accept, inElement]);
  const element = inElement ? elementList.find((e) => e.id === inElement) : null;
  const filesOf = (e) => (accept === "video"
    ? (e.videos || []).map((v, i) => ({ url: v.url, label: v.label || `Video ${i + 1}` }))
    : (e.views || (e.images || []).map((url) => ({ url }))).map((v, i) => ({ url: v.url, label: v.label || (i === 0 ? "Main" : `View ${i + 1}`) })));
  const elementItems = element ? filesOf(element).map((v, i) => ({ key: `${element.id}-${i}`, url: v.url, name: v.label, label: v.label, kind: accept })) : [];
  const boardItems = useMemo(() => (board ? [...board.frames.flatMap((f) => f.items), ...board.loose].filter((x) => (x.kind === "video" ? "video" : "image") === accept) : []), [board, accept]);
  const all = source === "elements" ? elementItems : source === "moodboard" ? boardItems : paged.items;
  const needle = q.trim().toLowerCase().replace(/^@/, "");
  const items = needle ? all.filter((i) => `${i.name || ""} ${i.prompt || ""} ${i.model || ""}`.toLowerCase().includes(needle)) : all;
  // Package 04: only files that are on count as chosen; a dimmed file never fills a slot.
  const inGroup = group ? groupItems(attached, group).map((x) => ({ ...x, off: st?.stateOf(x) || null })) : [];
  const chosen = inGroup.filter((x) => !x.off);
  const max = group ? (st ? st.maxOf(group, chosen.length) : group.max) : 0;
  const full = group ? chosen.length >= max : true;
  const isOn = st ? st.isOn : null;

  const toggle = (item) => {
    if (!group) return;
    const at = chosen.findIndex((x) => x.url === item.url);
    if (at >= 0) { setAttached((a) => removeFromGroup(a, group, item.url, chosen[at].role)); return; }
    // Attached but off: a click turns it on (what conflicts turns off) or brings it into the sent ones.
    const dim = inGroup.find((x) => x.url === item.url && x.off);
    if (dim) { if (dim.off.why === "together") st?.turnOn([dim.role]); else if (dim.off.why === "limit") st?.bringOn(dim); return; }
    if (full) return;
    setAttached((a) => addToGroup(a, group, [{ url: item.url, name: item.name || "", ...(item.label ? { label: item.label } : {}) }], null, isOn));
  };
  const addAll = (list) => { if (group) setAttached((a) => addToGroup(a, group, list.map((x) => ({ url: x.url, name: x.name || "" })), null, isOn)); };
  const upload = async (files) => {
    const list = files.filter((f) => f.type.startsWith(`${accept}/`)).slice(0, Math.max(0, max - chosen.length));
    if (!list.length) { onError?.(`Choose ${accept} files.`); return; }
    setUploading((n) => n + 1);
    onUploading?.(true);
    try {
      const placed = [];
      for (const f of list) {
        const url = await uploadFile("session", f);
        setAttached((a) => addToGroup(a, group, [{ url, name: f.name }], null, isOn));
        placed.push({ url, kind: accept, name: f.name });
      }
      // Inside a storyboard an upload also lands on its Moodboard, outside frames (package 06, A2).
      if (board?.place && placed.length) board.place(placed);
      if (source === "uploads") setRefresh((k) => k + 1);
    } catch (e) { onError?.(String(e?.message || e)); }
    finally { setUploading((n) => n - 1); onUploading?.(false); }
  };
  const count = (id) => (id === "moodboard" ? `${boardItems.length}` : id === source ? `${source === "elements" && !element ? elementList.length : items.length}${id !== "elements" && paged.cursor ? "+" : ""}` : "");
  const sources = board ? [["moodboard", "Moodboard"], ...SOURCES] : SOURCES;
  // The open picker takes files dropped on the window (package 06, A2).
  useDzDropTarget({ el: box, title: "Drop files to upload", line: board ? "They also land on the Moodboard" : "", enabled: Boolean(group), onDrop: (files) => upload(files) });
  const tile = (item, h = null) => {
    const n = chosen.findIndex((x) => x.url === item.url);
    const on = n >= 0;
    const dim = !on ? inGroup.find((x) => x.url === item.url && x.off) : null;
    const blocked = full && !on && !dim;
    const why = dim?.off.reason ? [dim.off.reason.text, dim.off.reason.action].filter(Boolean).join(" ") : null;
    const style = h ? { height: h, width: item.w && item.h ? Math.round((h * item.w) / item.h) : h } : undefined;
    return (
      <button key={item.key || item.url} type="button" onClick={() => toggle(item)} disabled={blocked} title={why || item.name || item.prompt || undefined} style={style}
        className={cn("relative overflow-hidden rounded-md bg-muted transition-[opacity,box-shadow] duration-state", !h && "aspect-square", on && "ring-2 ring-signal", dim && "ring-2 ring-input", blocked && "opacity-20")}>
        {item.kind === "video"
          ? <video src={item.url} poster={dzThumb(item.url, 256)} className="h-full w-full object-cover" muted playsInline preload="none" onMouseOver={(e) => e.currentTarget.play().catch(() => {})} onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
          : item.kind === "audio" ? <span className="flex h-full items-center justify-center px-2 text-center text-sm text-muted-foreground">♪ {item.name}</span>
            : <img src={dzThumb(item.url, 256)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
        {on && !full && <span className="absolute inset-0 bg-overlay/[.38]" />}
        {on && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-signal text-xs font-semibold text-primary-foreground">{n + 1}</span>}
        {dim && <span className="absolute inset-0 bg-card/50" />}
        {dim && <span className="absolute right-1.5 top-1.5 rounded-full border border-border bg-popover px-1.5 text-[11px] font-semibold uppercase leading-[18px] text-muted-foreground">off</span>}
        {item.label && <span className="absolute inset-x-1 bottom-1 rounded-xs bg-overlay/[.66] text-center text-[11px] leading-4 text-overlay-foreground">{item.label}</span>}
      </button>
    );
  };
  const section = (key, dot, name, list) => (
    <div key={key} className="mb-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />{name} <span className="font-normal text-muted-foreground">{list.length}</span>
        {group && list.length > 0 && <button type="button" onClick={() => addAll(list)} className="ml-auto h-6 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Add all {list.length}</button>}
      </div>
      <div className="flex flex-wrap gap-2.5">{list.map((x) => tile({ ...x, key: `${key}-${x.url}` }, PIC_H))}</div>
    </div>
  );

  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input px-3">
          <MagnifyingGlass size={16} className="text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${accept === "video" ? "videos" : accept === "audio" ? "sounds" : "pictures"} by prompt, model or @tag`}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none" />
        </label>
        {ctx.project && (
          <div className="relative" ref={scopeAnchor}>
            <button type="button" onClick={() => setScopeOpen((v) => !v)} className="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent">
              {where === "project" ? "This project" : "Library"} <CaretDown size={12} className="text-muted-foreground" />
            </button>
            <ChipMenu open={scopeOpen} onClose={() => setScopeOpen(false)} anchor={scopeAnchor} align="end" className="!bottom-auto top-[calc(100%+6px)] w-48 p-1.5">
              <MenuRow on={where === "project"} onClick={() => { setWhere("project"); setScopeOpen(false); }}>This project</MenuRow>
              <MenuRow on={where === "library"} onClick={() => { setWhere("library"); setScopeOpen(false); }}>Library</MenuRow>
            </ChipMenu>
          </div>
        )}
      </div>
      <div role="tablist" className="mt-3 flex h-9 flex-shrink-0 items-end gap-5 border-b border-border">
        {sources.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={source === id} onClick={() => { setSource(id); if (id === "elements") setInElement(null); }}
            className={cn("-mb-px h-9 border-b-2 text-base font-medium transition-colors duration-state", source === id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label} <span className="tabular-nums text-muted-foreground">{count(id)}</span>
          </button>
        ))}
      </div>
      <div className="custom-scrollbar -mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {source === "moodboard" && board && (
          boardItems.length ? (
            <>
              {board.frames.map((f) => { const list = f.items.filter((x) => (x.kind === "video" ? "video" : "image") === accept && (!needle || `${x.name || ""}`.toLowerCase().includes(needle))); return list.length ? section(f.id, f.color, f.name || "Group", list) : null; })}
              {(() => { const list = board.loose.filter((x) => (x.kind === "video" ? "video" : "image") === accept); return list.length ? section("loose", "hsl(var(--muted-foreground))", "Not in a group", list) : null; })()}
            </>
          ) : <p className="py-10 text-center text-muted-foreground">Nothing on this storyboard's Moodboard yet.</p>
        )}
        {source === "elements" && !element && (
          <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(columns, 6)}, minmax(0, 1fr))` }}>
            {elementList.filter((e) => !needle || `${e.name} ${e.tag}`.toLowerCase().includes(needle)).map((e) => {
              const files = filesOf(e);
              const picked = files.filter((v) => chosen.some((c) => c.url === v.url)).length;
              return (
                <button key={e.id} type="button" onClick={() => setInElement(e.id)} className="group text-left">
                  <span className="relative block aspect-square overflow-hidden rounded-md bg-muted">
                    {files[0] && (accept === "video" ? <video src={files[0].url} poster={dzThumb(files[0].url, 256)} muted playsInline preload="none" className="h-full w-full object-cover" /> : <img src={dzThumb(files[0].url, 256)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-state group-hover:scale-[1.03]" />)}
                    {picked > 0 && <span className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1 text-xs font-semibold text-primary-foreground">{picked}</span>}
                  </span>
                  <span className="mt-1.5 block truncate text-sm font-medium">{e.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{files.length} {accept === "video" ? "video" : "view"}{files.length === 1 ? "" : "s"}</span>
                </button>
              );
            })}
          </div>
        )}
        {source === "elements" && element && (
          <div className="mb-3 flex items-center gap-2 text-sm">
            <button type="button" onClick={() => setInElement(null)} aria-label="All elements" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><CaretLeft size={14} /></button>
            <b className="font-semibold">{element.name}</b>
            <span className="text-muted-foreground">@{element.tag} · {element.kind ? `${element.kind[0].toUpperCase()}${element.kind.slice(1)} · ` : ""}{elementItems.length} {accept === "video" ? "video" : "view"}{elementItems.length === 1 ? "" : "s"} · pick the {accept === "video" ? "videos" : "views"} to send</span>
          </div>
        )}
        {source !== "moodboard" && !(source === "elements" && !element) && (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {source === "uploads" && group && (
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading > 0 || full}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-input text-sm text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground disabled:opacity-40">
              {uploading ? <Spinner className="h-5 w-5" /> : <UploadSimple size={20} />}{uploading ? "Uploading" : "Upload"}
            </button>
          )}
          {items.map((item) => tile(item))}
        </div>
        )}
        {source !== "moodboard" && !paged.loading && (source === "elements" ? (element ? !items.length : !elementList.length) : !items.length) && <p className="py-10 text-center text-muted-foreground">{source === "elements" ? "No elements with matching files here yet." : `Nothing here yet.`}</p>}
        {paged.loading && source !== "elements" && source !== "moodboard" && <div className="flex justify-center py-6"><Spinner className="h-5 w-5" /></div>}
        {paged.cursor && source !== "elements" && source !== "moodboard" && !paged.loading && <div className="flex justify-center py-3"><button type="button" onClick={paged.more} className="h-8 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent">Load more</button></div>}
      </div>
      <input ref={fileInput} type="file" accept={ACCEPT[accept]} multiple={group?.max > 1} className="hidden" onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ""; if (f.length) upload(f); }} />
    </div>
  );
}

const hintFor = (group, full) => (full ? "Full. Remove one to pick another." : group?.kind === "video" ? "Only videos are shown for this group." : group?.kind === "audio" ? "Only sounds are shown for this group." : "Only pictures are shown for this group.");

// Above the strip, same width as the composer (the composer folds to the strip meanwhile).
export function LibraryWindow({ open, groups, groupId, setGroupId, attached, sent = attached, setAttached, onClose, onError, onUploading, st = null, title = null, initial = null }) {
  const board = useContext(PickerBoardContext);
  const { mounted, shown } = usePresence(open, 240);
  useEscLayer(open, onClose);
  const box = useRef(null);
  useDialogFocus(open && mounted, box, { trap: false });
  const group = groups.find((g) => g.id === groupId) || groups[0];
  if (!mounted || !group) return null;
  const chosen = groupItems(sent, group);
  const maxOf = (g, n) => (st ? st.maxOf(g, n) : g.max);
  const full = chosen.length >= maxOf(group, chosen.length);
  return (
    <div ref={box} tabIndex={-1} className={cn("glass absolute inset-x-0 bottom-[calc(100%+12px)] z-20 flex outline-none h-[min(640px,calc(100vh-260px))] flex-col rounded-2xl border border-border p-4 shadow-float transition-[opacity,transform] duration-[240ms] ease-soft",
      shown ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-[.985] opacity-0")} role="dialog" aria-label="Library">
      <div className="mb-3 flex h-8 flex-shrink-0 items-center gap-5">
        {/* A titled picker (package 06, S3: "References for Shot N · 2 chosen"); its groups stay as small switches. */}
        {title && (
          <span className="relative flex h-8 items-center gap-2 whitespace-nowrap text-base font-semibold">{title} <span className="font-normal tabular-nums text-muted-foreground">{chosen.length} chosen</span>
            <span className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-signal" /></span>
        )}
        {(!title || groups.length > 1) && groups.map((g) => {
          const n = groupItems(sent, g).length;
          const on = g.id === group.id;
          return (
            <button key={g.id} type="button" onClick={() => setGroupId(g.id)}
              className={cn("relative h-8 whitespace-nowrap text-base font-medium transition-colors duration-state", on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {g.label} {!title && <span className={cn("tabular-nums", n >= maxOf(g, n) ? "text-signal" : "text-muted-foreground")}>{n}{"\u00a0"}/{"\u00a0"}{maxOf(g, n)}</span>}
              {on && !title && <span className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-signal" />}
              {on && title && <span className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-foreground" />}
            </button>
          );
        })}
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={16} /></button>
      </div>
      <Browser key={`${group.id}:${initial?.element || ""}`} group={group} attached={attached} setAttached={setAttached} onError={onError} onUploading={onUploading} st={st} initial={initial} />
      <div className="mt-3 flex h-9 flex-shrink-0 items-center gap-4">
        <span className="text-sm tabular-nums text-muted-foreground">{chosen.length} of {maxOf(group, chosen.length)} chosen</span>
        <button type="button" onClick={() => setAttached((a) => clearGroup(a, group))} disabled={!chosen.length} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Broom size={16} /> Clear</button>
        <span className="ml-auto text-sm text-muted-foreground">{full ? hintFor(group, full) : initial?.element ? "Each view you pick is sent as one reference picture." : board ? "Drop files here to upload. They also land on the Moodboard." : hintFor(group, full)}</span>
        <button type="button" onClick={onClose} className="h-8 rounded-md bg-primary px-4 text-base font-medium text-primary-foreground hover:bg-primary-hover active:scale-[.98]">Done</button>
      </div>
    </div>
  );
}

// The full list (screen 12): every attachment by group on the left, the library on the right.
export function FullList({ open, onClose, groups, groupId, setGroupId, attached, sent = attached, setAttached, tagOf, modelName, onError, onUploading, st = null }) {
  const group = groups.find((g) => g.id === groupId) || groups[0];
  const drag = useRef(null);
  const [over, setOver] = useState(null);
  const total = groups.reduce((n, g) => n + groupItems(attached, g).length, 0);
  const offTotal = groups.reduce((n, g) => n + groupItems(attached, g).filter((x) => st?.stateOf(x)).length, 0);
  const [roleMenu, setRoleMenu] = useState(null);
  const moveTo = (item, fromGroup, role) => {
    const target = groups.find((g) => g.roles.includes(role));
    if (!target) return;
    setAttached((a) => {
      const cleared = removeFromGroup(a, fromGroup, item.url, item.role);
      return addToGroup(cleared, target, [{ url: item.url, name: item.name }], role, st?.isOn);
    });
  };
  return (
    <StudioPanel open={open} onClose={onClose} title="Attached to this shot" width={900} bodyClassName="flex gap-5 p-0"
      aside={(
        <>
          <span className="text-sm tabular-nums text-muted-foreground">{total} item{total === 1 ? "" : "s"}{offTotal ? ` · ${offTotal} off` : ""} · {modelName}</span>
          <button type="button" onClick={() => setAttached((a) => groups.reduce((acc, g) => clearGroup(acc, g), a))} className="h-8 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Clear all</button>
        </>
      )}>
      <div className="custom-scrollbar w-[380px] flex-shrink-0 overflow-y-auto border-r border-border p-5">
        {groups.map((g) => {
          // Every file, on and off (package 04): which ones are sent is chosen here.
          const list = groupItems(attached, g).map((x) => ({ ...x, off: st?.stateOf(x) || null }));
          const onN = list.filter((x) => !x.off).length;
          const offN = list.length - onN;
          const max = st ? st.maxOf(g, onN) : g.max;
          return (
            <section key={g.id} className="mb-5">
              <button type="button" onClick={() => setGroupId(g.id)} className={cn("relative mb-2 whitespace-nowrap text-base font-medium", g.id === group?.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {g.label} <span className="tabular-nums text-muted-foreground">{list.length && !onN ? `${list.length} · off` : `${onN}\u00a0/\u00a0${max}${offN ? ` · ${offN} off` : ""}`}</span>
                {g.id === group?.id && <span className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-signal" />}
              </button>
              {list.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
              {list.map((item) => {
                const t = item.off ? null : tagOf(item.url);
                const roles = g.id === "frames" ? Object.keys(g.roleMax) : [];
                const why = item.off?.reason ? [item.off.reason.text, item.off.reason.action].filter(Boolean).join(" ") : undefined;
                const canOn = item.off && item.off.why !== "kind";
                return (
                  <div key={`${item.role}-${item.url}`} draggable title={why}
                    // Safari starts a drag only when it carries data (B2).
                    onDragStart={(e) => { drag.current = { g: g.id, url: item.url }; try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", item.url); } catch { /* old browsers */ } }}
                    onDragEnter={(e) => { if (drag.current?.g === g.id) { e.preventDefault(); setOver(item.url); } }}
                    onDragOver={(e) => { if (drag.current?.g === g.id) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const d = drag.current; if (d?.g === g.id) setAttached((a) => reorderGroup(a, g, d.url, item.url)); drag.current = null; setOver(null); }}
                    onDragEnd={() => { drag.current = null; setOver(null); }}
                    className={cn("flex min-h-14 items-center gap-2.5 rounded-md px-1 py-1 hover:bg-accent/60", over === item.url && drag.current?.url !== item.url && "bg-accent ring-1 ring-signal/60")}>
                    <DotsSixVertical size={16} className="flex-shrink-0 cursor-grab text-muted-foreground" />
                    <span className={cn("flex-shrink-0", item.off && "dz-off")}>
                      {g.kind === "video" ? <video src={item.url} poster={dzThumb(item.url, 128)} draggable={false} className="pointer-events-none h-[42px] w-14 rounded-xs object-cover" muted preload="metadata" />
                        : g.kind === "audio" ? <span className="flex h-[42px] w-14 items-center justify-center rounded-xs bg-muted">♪</span>
                          : <img src={dzThumb(item.url, 128)} alt="" draggable={false} className="h-[42px] w-14 rounded-xs object-cover" />}
                    </span>
                    <span className={cn("min-w-0 flex-1", item.off && "text-muted-foreground")}>
                      {/* The file's own name gets the width (up to two lines, B6); the tag and role go under it. */}
                      <span className="line-clamp-2 break-words text-base leading-5" title={item.name || t?.label || g.label}>{item.name || t?.label || g.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[t ? `@${t.tag}` : "", item.name ? t?.label : ""].filter(Boolean).join(" · ")}</span>
                    </span>
                    {roles.length > 1 ? (
                      <div className="relative">
                        <button type="button" onClick={() => setRoleMenu(roleMenu === item.url ? null : item.url)} className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium hover:bg-accent">
                          {{ first: "Start", middle: "Mid", last: "End" }[item.role]} <CaretDown size={10} />
                        </button>
                        {roleMenu === item.url && (
                          <div className="glass absolute right-0 top-[calc(100%+4px)] z-10 w-28 rounded-md border border-border p-1 shadow-popover">
                            {roles.map((r) => (
                              <MenuRow key={r} on={r === item.role} className="h-8 text-sm" onClick={() => { setRoleMenu(null); if (r !== item.role) moveTo(item, g, r); }}>{{ first: "Start", middle: "Mid", last: "End" }[r]}</MenuRow>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">{g.kind === "video" ? "Video" : g.kind === "audio" ? "Audio" : "Ref"}</span>}
                    {canOn && (
                      <button type="button" onClick={() => (item.off.why === "limit" ? st.bringOn(item) : st.turnOn([item.role]))}
                        className="flex h-7 flex-shrink-0 items-center rounded-md px-2 text-xs font-semibold underline decoration-input underline-offset-[3px] hover:bg-accent">Send</button>
                    )}
                    <button type="button" onClick={() => setAttached((a) => removeFromGroup(a, g, item.url, item.role))} aria-label="Remove" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={14} /></button>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col py-5 pr-5">
        {group && Object.keys(group.roleMax || {}).length > 0 && <Browser key={group.id} group={group} attached={attached} setAttached={setAttached} columns={4} onError={onError} onUploading={onUploading} st={st} />}
        {group && <p className="mt-2 text-sm text-muted-foreground">Click a {group.kind === "video" ? "video" : "picture"} to add it to {group.label}. Drag a row on the left to reorder.</p>}
      </div>
    </StudioPanel>
  );
}

export { GROUPS };
