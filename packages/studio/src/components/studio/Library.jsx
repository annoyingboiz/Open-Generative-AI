"use client";

// Library window (redesign 01, §5.5) and the full list ("+N", screen 12).
// Every click applies at once: the picture joins the active group, numbered in
// order of adding; a full group dims the rest. The group decides the type.
import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, Broom, X, UploadSimple, DotsSixVertical, CaretDown } from "@phosphor-icons/react";
import { dzThumb, uploadFile } from "../../api.js";
import { useDzContext } from "../../dzContext.js";
import { usePaged } from "../DzMedia.jsx";
import { useDzElements } from "../DzElements.jsx";
import { Spinner, cn } from "../../ui/index.js";
import { StudioPanel, Overline, ChipMenu, MenuRow, usePresence, useEscLayer, useDialogFocus } from "./ui.jsx";
import { groupItems, addToGroup, removeFromGroup, clearGroup, reorderGroup, GROUPS } from "./attachments.js";

const SOURCES = [["uploads", "Uploads"], ["generations", "Generations"], ["liked", "Liked"], ["elements", "Elements"]];
const ACCEPT = { image: "image/png,image/jpeg,image/webp", video: "video/mp4,video/quicktime,video/webm", audio: "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg" };

// The browsing part: search, scope, source tabs and the grid. Shared by the window and the full list.
function Browser({ group, attached, setAttached, columns = 8, onError, onUploading }) {
  const ctx = useDzContext();
  const [source, setSource] = useState("generations");
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
  const elementItems = useMemo(() => {
    const list = where === "project" && ctx.project ? els.project : els.library;
    return list.flatMap((e) => [
      ...(accept === "image" ? (e.images || []).map((url, i) => ({ key: `${e.id}-${i}`, url, name: `${e.name} ${i + 1}`, kind: "image" })) : []),
      ...(accept === "video" && e.video ? [{ key: `${e.id}-v`, url: e.video, name: `${e.name} video`, kind: "video" }] : []),
    ]);
  }, [els, where, ctx.project, accept]);
  const all = source === "elements" ? elementItems : paged.items;
  const needle = q.trim().toLowerCase().replace(/^@/, "");
  const items = needle ? all.filter((i) => `${i.name || ""} ${i.prompt || ""} ${i.model || ""}`.toLowerCase().includes(needle)) : all;
  const chosen = group ? groupItems(attached, group) : [];
  const full = group ? chosen.length >= group.max : true;

  const toggle = (item) => {
    if (!group) return;
    const at = chosen.findIndex((x) => x.url === item.url);
    if (at >= 0) { setAttached((a) => removeFromGroup(a, group, item.url)); return; }
    if (full) return;
    setAttached((a) => addToGroup(a, group, [{ url: item.url, name: item.name || "" }]));
  };
  const upload = async (files) => {
    const list = files.filter((f) => f.type.startsWith(`${accept}/`)).slice(0, Math.max(0, group.max - chosen.length));
    if (!list.length) { onError?.(`Choose ${accept} files.`); return; }
    setUploading((n) => n + 1);
    onUploading?.(true);
    try {
      for (const f of list) {
        const url = await uploadFile("session", f);
        setAttached((a) => addToGroup(a, group, [{ url, name: f.name }]));
      }
      if (source === "uploads") setRefresh((k) => k + 1);
    } catch (e) { onError?.(String(e?.message || e)); }
    finally { setUploading((n) => n - 1); onUploading?.(false); }
  };
  const count = (id) => (id === source ? `${items.length}${id !== "elements" && paged.cursor ? "+" : ""}` : "");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        {SOURCES.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={source === id} onClick={() => setSource(id)}
            className={cn("-mb-px h-9 border-b-2 text-base font-medium transition-colors duration-state", source === id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label} <span className="tabular-nums text-muted-foreground">{count(id)}</span>
          </button>
        ))}
      </div>
      <div className="custom-scrollbar -mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {source === "uploads" && group && (
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading > 0 || full}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-input text-sm text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground disabled:opacity-40">
              {uploading ? <Spinner className="h-5 w-5" /> : <UploadSimple size={20} />}{uploading ? "Uploading" : "Upload"}
            </button>
          )}
          {items.map((item) => {
            const n = chosen.findIndex((x) => x.url === item.url);
            const on = n >= 0;
            const off = full && !on;
            return (
              <button key={item.key} type="button" onClick={() => toggle(item)} disabled={off} title={item.name || item.prompt || undefined}
                className={cn("relative aspect-square overflow-hidden rounded-md bg-muted transition-[opacity,box-shadow] duration-state", on && "ring-2 ring-signal", off && "opacity-20")}>
                {item.kind === "video"
                  ? <video src={item.url} poster={dzThumb(item.url, 256)} className="h-full w-full object-cover" muted playsInline preload="none" onMouseOver={(e) => e.currentTarget.play().catch(() => {})} onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
                  : item.kind === "audio" ? <span className="flex h-full items-center justify-center px-2 text-center text-sm text-muted-foreground">♪ {item.name}</span>
                    : <img src={dzThumb(item.url, 256)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
                {on && !full && <span className="absolute inset-0 bg-overlay/[.38]" />}
                {on && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-signal text-xs font-semibold text-primary-foreground">{n + 1}</span>}
              </button>
            );
          })}
        </div>
        {!paged.loading && items.length === 0 && <p className="py-10 text-center text-muted-foreground">{source === "elements" ? "No elements with matching files here yet." : `Nothing here yet.`}</p>}
        {paged.loading && source !== "elements" && <div className="flex justify-center py-6"><Spinner className="h-5 w-5" /></div>}
        {paged.cursor && source !== "elements" && !paged.loading && <div className="flex justify-center py-3"><button type="button" onClick={paged.more} className="h-8 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent">Load more</button></div>}
      </div>
      <input ref={fileInput} type="file" accept={ACCEPT[accept]} multiple={group?.max > 1} className="hidden" onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ""; if (f.length) upload(f); }} />
    </div>
  );
}

const hintFor = (group, full) => (full ? "Full. Remove one to pick another." : group?.kind === "video" ? "Only videos are shown for this group." : group?.kind === "audio" ? "Only sounds are shown for this group." : "Only pictures are shown for this group.");

// Above the strip, same width as the composer (the composer folds to the strip meanwhile).
export function LibraryWindow({ open, groups, groupId, setGroupId, attached, setAttached, onClose, onError, onUploading }) {
  const { mounted, shown } = usePresence(open, 240);
  useEscLayer(open, onClose);
  const box = useRef(null);
  useDialogFocus(open && mounted, box, { trap: false });
  const group = groups.find((g) => g.id === groupId) || groups[0];
  if (!mounted || !group) return null;
  const chosen = groupItems(attached, group);
  const full = chosen.length >= group.max;
  return (
    <div ref={box} tabIndex={-1} className={cn("glass absolute inset-x-0 bottom-[calc(100%+12px)] z-20 flex outline-none h-[min(640px,calc(100vh-260px))] flex-col rounded-2xl border border-border p-4 shadow-float transition-[opacity,transform] duration-[240ms] ease-soft",
      shown ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-[.985] opacity-0")} role="dialog" aria-label="Library">
      <div className="mb-3 flex h-8 flex-shrink-0 items-center gap-5">
        {groups.map((g) => {
          const n = groupItems(attached, g).length;
          const on = g.id === group.id;
          return (
            <button key={g.id} type="button" onClick={() => setGroupId(g.id)}
              className={cn("relative h-8 text-base font-medium transition-colors duration-state", on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {g.label} <span className={cn("tabular-nums", n >= g.max ? "text-signal" : "text-muted-foreground")}>{n} / {g.max}</span>
              {on && <span className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-signal" />}
            </button>
          );
        })}
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={16} /></button>
      </div>
      <Browser key={group.id} group={group} attached={attached} setAttached={setAttached} onError={onError} onUploading={onUploading} />
      <div className="mt-3 flex h-9 flex-shrink-0 items-center gap-4">
        <span className="text-sm tabular-nums text-muted-foreground">{chosen.length} of {group.max} chosen</span>
        <button type="button" onClick={() => setAttached((a) => clearGroup(a, group))} disabled={!chosen.length} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Broom size={16} /> Clear</button>
        <span className="ml-auto text-sm text-muted-foreground">{hintFor(group, full)}</span>
        <button type="button" onClick={onClose} className="h-8 rounded-md bg-primary px-4 text-base font-medium text-primary-foreground hover:bg-primary-hover active:scale-[.98]">Done</button>
      </div>
    </div>
  );
}

// The full list (screen 12): every attachment by group on the left, the library on the right.
export function FullList({ open, onClose, groups, groupId, setGroupId, attached, setAttached, tagOf, modelName, onError, onUploading }) {
  const group = groups.find((g) => g.id === groupId) || groups[0];
  const drag = useRef(null);
  const total = groups.reduce((n, g) => n + groupItems(attached, g).length, 0);
  const [roleMenu, setRoleMenu] = useState(null);
  const moveTo = (item, fromGroup, role) => {
    const target = groups.find((g) => g.roles.includes(role));
    if (!target) return;
    setAttached((a) => {
      const cleared = removeFromGroup(a, fromGroup, item.url);
      return addToGroup(cleared, target, [{ url: item.url, name: item.name }], role);
    });
  };
  return (
    <StudioPanel open={open} onClose={onClose} title="Attached to this shot" width={900} bodyClassName="flex gap-5 p-0"
      aside={(
        <>
          <span className="text-sm tabular-nums text-muted-foreground">{total} item{total === 1 ? "" : "s"} · {modelName}</span>
          <button type="button" onClick={() => setAttached((a) => groups.reduce((acc, g) => clearGroup(acc, g), a))} className="h-8 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Clear all</button>
        </>
      )}>
      <div className="custom-scrollbar w-[340px] flex-shrink-0 overflow-y-auto border-r border-border p-5">
        {groups.map((g) => {
          const list = groupItems(attached, g);
          return (
            <section key={g.id} className="mb-5">
              <button type="button" onClick={() => setGroupId(g.id)} className={cn("relative mb-2 text-base font-medium", g.id === group?.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {g.label} <span className="tabular-nums text-muted-foreground">{list.length} / {g.max}</span>
                {g.id === group?.id && <span className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-signal" />}
              </button>
              {list.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
              {list.map((item) => {
                const t = tagOf(item.url);
                const roles = g.id === "frames" ? Object.keys(g.roleMax) : [];
                return (
                  <div key={item.url} draggable onDragStart={() => { drag.current = { g: g.id, url: item.url }; }}
                    onDragOver={(e) => { if (drag.current?.g === g.id) e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); if (drag.current?.g === g.id) setAttached((a) => reorderGroup(a, g, drag.current.url, item.url)); drag.current = null; }}
                    className="flex h-14 items-center gap-2.5 rounded-md px-1 hover:bg-accent/60">
                    <DotsSixVertical size={16} className="flex-shrink-0 cursor-grab text-muted-foreground" />
                    {g.kind === "video" ? <video src={item.url} poster={dzThumb(item.url, 128)} className="h-[42px] w-14 flex-shrink-0 rounded-xs object-cover" muted preload="metadata" />
                      : g.kind === "audio" ? <span className="flex h-[42px] w-14 flex-shrink-0 items-center justify-center rounded-xs bg-muted">♪</span>
                        : <img src={dzThumb(item.url, 128)} alt="" className="h-[42px] w-14 flex-shrink-0 rounded-xs object-cover" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base">{t?.label || item.name || g.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{t ? `@${t.tag}` : ""}{item.name ? ` · ${item.name}` : ""}</span>
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
                    <button type="button" onClick={() => setAttached((a) => removeFromGroup(a, g, item.url))} aria-label="Remove" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={14} /></button>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col py-5 pr-5">
        {group && <Browser key={group.id} group={group} attached={attached} setAttached={setAttached} columns={4} onError={onError} onUploading={onUploading} />}
        {group && <p className="mt-2 text-sm text-muted-foreground">Click a {group.kind === "video" ? "video" : "picture"} to add it to {group.label}. Drag a row on the left to reorder.</p>}
      </div>
    </StudioPanel>
  );
}

export { GROUPS };
