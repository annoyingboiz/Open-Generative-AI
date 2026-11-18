"use client";

// DZ: All work · Liked · Trash — one screen with three starting points.
//   Library: your personal work plus the work of your projects.
//   In a project: the project's work (the folder picked in the sidebar, or all of it).
// Filters: type, tool, liked, words in the prompt. "Select" for Move / Copy /
// Download / Trash on many at once. Trash keeps items 7 days.
import { useEffect, useState } from "react";
import { useDzContext } from "../dzContext.js";
import { dzThumb } from "../api.js";
import { useDzHistory, dzLibrary } from "../dzLibrary.js";
import DzLikeButton, { DzPendingTile, DzAudioTile } from "./DzLikeButton.jsx";
import { dzModelLabel, dzOpenUpscale, dzUpscaleSpec, dzVideoUpscaleSpec, dzOpenVideoUpscale } from "../dzCatalog.js";
import { Segmented, Button, Input, cn, SelectParts } from "../ui/index.js";
import { useDzSelection, SelectBox, GridToolbar, selectedRing } from "./DzSelection.jsx";

const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = SelectParts;
const TYPES = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "uploads", label: "Uploads" },
];
const TOOLS = [
  { value: "any", label: "Any tool" },
  { value: "create", label: "Create" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "upscale", label: "Upscale" },
  { value: "director", label: "Director" },
  { value: "tools", label: "Tools" },
  { value: "cinema", label: "Cinema (old)" },
];
const SECTION_TITLE = { all: "All work", liked: "Liked", trash: "Trash" };
const STUDIO_LABEL = { create: "Create", cinema: "Cinema", image: "Image", video: "Video", upscale: "Upscale", director: "Director", tools: "Tools" };

async function download(url, name) {
  try {
    const blob = await (await fetch(url)).blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank");
  }
}

const fmtUsd = (usd) => (usd === 0 ? "0" : usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));
const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function IconButton({ title, onClick, danger, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/60 backdrop-blur-md transition-all ${danger ? "text-red-300 hover:bg-red-500 hover:text-white" : "text-white hover:bg-[#22d3ee] hover:text-black"}`}
    >
      {children}
    </button>
  );
}

export function Viewer({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!item) return null;
  const isVideo = item.kind === "video" || /\.(mp4|mov|webm)$/i.test(item.url || "");
  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose} role="dialog" aria-label="Preview">
      <div className="flex items-center justify-between gap-4 px-5 py-3 text-base text-foreground/90" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate">{item.prompt || item.name || ""}</span>
        {isVideo && dzVideoUpscaleSpec() && /\/media\/[ug]\//.test(item.url || "") && (
          <button type="button" onClick={() => { onClose(); dzOpenVideoUpscale(item.url); }} className="ml-auto flex-shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-foreground hover:bg-white/10">Upscale video</button>
        )}
        <button type="button" onClick={onClose} className="h-9 w-9 flex-shrink-0 rounded-lg text-muted-foreground hover:bg-white/10 hover:text-white" aria-label="Close">✕</button>
      </div>
      {/* A click on the empty dark area closes; on the picture or video it doesn't. */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {item.kind === "audio" ? (
          <audio src={item.url} controls autoPlay className="w-full max-w-xl" onClick={(e) => e.stopPropagation()} />
        ) : isVideo ? (
          <video src={item.url} controls autoPlay className="max-h-full max-w-full rounded-lg" onClick={(e) => e.stopPropagation()} />
        ) : (
          <img src={item.url} alt={item.prompt || "Image"} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        )}
      </div>
    </div>
  );
}

function Card({ item, view, onOpen, actions, sel }) {
  const isVideo = item.kind === "video";
  const studio = STUDIO_LABEL[item.studio] || null;
  const on = sel?.has(item.id);
  return (
    <div className={cn("group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-white/20", selectedRing(on))} {...(sel && view !== "uploads" ? sel.dragProps(item) : {})}>
      {sel && <SelectBox sel={sel} item={item} />}
      <button type="button" className="relative block w-full" onClick={(e) => { if (sel?.click(item, e)) return; if (item.url) onOpen(item); }} disabled={!item.url}>
        {!item.url ? (
          <DzPendingTile status={item.status} error={item.error} label={item.studio === "upscale" ? "Upscaling" : "Generating"} className="aspect-square w-full"
            note={item.note} onCancel={item.cancellable ? () => dzLibrary.cancel(item.id).catch((e) => window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "error", title: "Cancel", message: String(e?.message || e) } }))) : undefined} />
        ) : item.kind === "audio" ? (
          <DzAudioTile url={item.url} title={item.prompt?.slice(0, 80) || "Audio"} controls={false} className="aspect-square w-full" />
        ) : isVideo ? (
          <video
            src={item.url}
            poster={dzThumb(item.url)}
            className="aspect-square w-full bg-black/40 object-cover"
            muted
            loop
            playsInline
            preload="none"
            onMouseOver={(e) => e.currentTarget.play().catch(() => {})}
            onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
          />
        ) : (
          <img src={dzThumb(item.url)} alt={item.prompt?.slice(0, 60) || item.name || "Image"} loading="lazy" decoding="async" className="aspect-square w-full bg-black/40 object-cover" />
        )}
        {isVideo && item.url && <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-base font-semibold text-foreground">Video</span>}
      </button>
      {(item.url || item.status === "failed") && actions && !sel?.selecting && (
        <div className={cn("absolute right-2 top-2 flex flex-col gap-2 transition-opacity", item.url ? "opacity-100 md:opacity-0 md:group-hover:opacity-100" : "opacity-100")}>
          {actions}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
        {item.prompt ? (
          <p className="line-clamp-2 text-base leading-snug text-foreground/85" title={item.prompt}>{item.prompt}</p>
        ) : item.name ? (
          <p className="truncate text-base text-foreground/85" title={item.name}>{item.name}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-muted-foreground">
          {studio && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-muted-foreground">{studio}</span>}
          {item.meta?.copiedFrom && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-muted-foreground">Copy</span>}
          {item.author && <span className="truncate">{item.author}</span>}
          {item.model && <span className="truncate">{dzModelLabel(item.model) || item.provider_model}</span>}
          {Number.isFinite(item.cost_usd) && <span className="tabular-nums">${fmtUsd(item.cost_usd)}</span>}
          <span className="ml-auto tabular-nums">{fmtDate(item.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

function Grid({ children }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{children}</div>;
}

// Uploaded files: open, download, delete (one or chosen ones). A file an element
// still shows can't be deleted — the message names the element.
function Uploads({ onOpen, project, onError }) {
  const [items, setItems] = useState(null);
  const sel = useDzSelection(items || []);
  const [busy, setBusy] = useState(false);
  // Another place, or nothing left: choosing ends.
  useEffect(() => { sel.clear(); }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (items && !items.length) sel.clear(); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (ids) => {
    setBusy(true);
    try {
      const r = await dzLibrary.deleteUploads(ids);
      const done = r.done?.length || 0;
      const failed = r.failed || [];
      window.dispatchEvent(new CustomEvent("dz:notify", { detail: failed.length
        ? { type: done ? "success" : "error", title: "Uploads", message: `Deleted ${done} of ${ids.length}. ${failed[0].error}` }
        : { type: "success", title: "Uploads", message: `Deleted ${done} file${done === 1 ? "" : "s"}.` } }));
      if (done) { setItems((list) => (list || []).filter((u) => !r.done.includes(u.id))); sel.clear(); }
    } catch (e) { onError?.(String(e?.message || e)); } finally { setBusy(false); }
  };
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    const load = () => dzLibrary.uploads({ limit: 200, project: project || undefined }).then((d) => { if (!cancelled) setItems(d.items || []); }).catch(() => { if (!cancelled) setItems((v) => v || []); });
    load();
    const on = (e) => { if (!e?.detail || e.detail.status === "upload") load(); };
    window.addEventListener("dz:history", on);
    window.addEventListener("focus", on);
    return () => { cancelled = true; window.removeEventListener("dz:history", on); window.removeEventListener("focus", on); };
  }, [project]);
  if (!items) return <p className="py-16 text-center text-base text-muted-foreground">Loading…</p>;
  if (!items.length) return <p className="py-16 text-center text-base text-muted-foreground">Nothing uploaded yet. Files you add as references show up here.</p>;
  return (
    <>
      <div className="mb-4 flex min-h-[40px] flex-wrap items-center gap-2">
        {sel.selecting ? (
          <>
            <span className="font-semibold tabular-nums">{sel.count ? `${sel.count} selected` : "Choose files"}</span>
            <Button size="sm" variant="ghost" onClick={sel.selectAll}>Select all</Button>
            <Button size="sm" variant="destructive" disabled={!sel.count || busy}
              onClick={() => { if (window.confirm(`Delete ${sel.count} file${sel.count === 1 ? "" : "s"} for good? This can't be undone.`)) remove(sel.chosen.map((u) => u.id)); }}>Delete forever</Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={sel.clear}>Cancel</Button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Uploaded files are deleted for good (no trash).</span>
            <Button size="sm" variant="secondary" className="ml-auto" onClick={sel.start}>Select</Button>
          </>
        )}
      </div>
      <Grid>
        {items.map((u) => {
          const item = { ...u, kind: u.mime.split("/")[0], status: "completed" };
          return (
            <Card key={u.id} view="uploads" onOpen={onOpen} item={item} sel={sel}
              actions={(
                <>
                  <IconButton title="Download" onClick={() => download(u.url, u.name || u.url.split("/").pop())}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                  </IconButton>
                  <IconButton title="Delete forever" danger onClick={() => { if (window.confirm(`Delete “${u.name || "this file"}” for good?`)) remove([u.id]); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                  </IconButton>
                </>
              )} />
          );
        })}
      </Grid>
    </>
  );
}

export default function DzLibrary({ section = "all", onGenerationError }) {
  const inTrash = section === "trash";
  const [type, setType] = useState("all");
  const [tool, setTool] = useState("any");
  const [likedOnly, setLikedOnly] = useState(false);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const uploads = type === "uploads" && !inTrash;
  const [open, setOpen] = useState(null);
  const ctx = useDzContext();
  const scope = ctx.project ? { project: ctx.project.id, folder: ctx.folder || undefined } : {};
  const filter = {
    ...scope,
    ...(type === "image" || type === "video" || type === "audio" ? { kind: type } : {}),
    ...(tool !== "any" ? { studio: tool } : {}),
    ...(section === "liked" || (likedOnly && section === "all") ? { liked: true } : {}),
    ...(inTrash ? { trash: true } : {}),
    ...(search ? { q: search } : {}),
  };
  const lib = useDzHistory(filter, { limit: 60 });
  const sel = useDzSelection(uploads ? [] : lib.items);
  const report = (e) => onGenerationError?.(String(e?.message || e));
  const canUpscale = Boolean(dzUpscaleSpec());
  const filtered = type !== "all" || tool !== "any" || likedOnly || Boolean(search);

  const actionsFor = (item) => {
    if (!item.url && !inTrash) {
      return item.status === "failed" ? (
        <IconButton title="Delete (move to trash)" danger onClick={() => lib.trash(item.id).catch(report)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
        </IconButton>
      ) : null;
    }
    if (inTrash) {
      return (
        <>
          <IconButton title="Restore" onClick={() => dzLibrary.restore(item.id).catch(report)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></svg>
          </IconButton>
          <IconButton title="Delete forever" danger onClick={() => { if (confirm("Delete this file for good? This can't be undone.")) dzLibrary.purge(item.id).catch(report); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
          </IconButton>
        </>
      );
    }
    return (
      <>
        <DzLikeButton id={item.id} liked={item.liked} onChange={lib.like} />
        <IconButton title="Download" onClick={() => download(item.url, item.url.split("/").pop())}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
        </IconButton>
        {dzVideoUpscaleSpec() && item.kind === "video" && (
          <IconButton title="Upscale video (1080p / 2K / 4K)" onClick={() => dzOpenVideoUpscale(item.url)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </IconButton>
        )}
        {canUpscale && item.kind === "image" && (
          <IconButton title="Upscale" onClick={() => dzOpenUpscale(item.url)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </IconButton>
        )}
        <IconButton title={item.mine !== false ? "Move or copy to…" : "Copy to…"} onClick={() => window.dispatchEvent(new CustomEvent("dz:move", { detail: { items: [item], mode: item.mine !== false ? "move" : "copy" } }))}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v6M9 14l3 3 3-3" /></svg>
        </IconButton>
        <IconButton title="Move to trash" danger onClick={() => lib.trash(item.id).catch(report)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
        </IconButton>
      </>
    );
  };

  const where = ctx.project ? (ctx.folderPath?.length ? "this folder" : "this project") : "your Library";
  const empty = filtered ? "Nothing matches these filters."
    : section === "liked" ? `Nothing liked in ${where} yet. Tap the heart on any result to keep it here.`
      : inTrash ? "Trash is empty. Deleted items stay here for 7 days."
        : `Nothing in ${where} yet. Everything you generate appears here, on every device.`;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 space-y-3 border-b border-border px-4 py-3 md:px-6">
        <GridToolbar ctx={ctx} sel={uploads ? null : sel} title={SECTION_TITLE[section]} inTrash={inTrash} canSelect={!uploads} />
        {!sel.selecting && (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={type} onChange={setType} options={inTrash ? TYPES.filter((t) => t.value !== "uploads") : TYPES} aria-label="Type" className="w-auto" size="sm" />
            {!uploads && (
              <Select value={tool} onValueChange={setTool}>
                <SelectTrigger className="h-9 w-[150px]" aria-label="Tool"><SelectValue /></SelectTrigger>
                <SelectContent>{TOOLS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {section === "all" && !uploads && (
              <Button size="sm" variant={likedOnly ? "default" : "secondary"} aria-pressed={likedOnly} onClick={() => setLikedOnly((v) => !v)}>♥ Liked</Button>
            )}
            {!uploads && <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search prompts" aria-label="Search prompts" className="h-9 w-[220px]" />}
            {filtered && <Button size="sm" variant="ghost" onClick={() => { setType("all"); setTool("any"); setLikedOnly(false); setText(""); }}>Clear</Button>}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-5 md:px-6">
        {uploads ? (
          <Uploads onOpen={setOpen} project={ctx.project?.id} onError={report} />
        ) : !lib.loaded ? (
          <p className="py-16 text-center text-base text-muted-foreground">Loading…</p>
        ) : lib.items.length === 0 ? (
          <p className="py-16 text-center text-base text-muted-foreground">{empty}</p>
        ) : (
          <>
            {inTrash && <p className="mb-4 text-base text-muted-foreground">Items in the trash are deleted for good after 7 days.</p>}
            <Grid>
              {lib.items.map((item) => (
                <Card key={item.id} item={item} view={section} onOpen={setOpen} actions={actionsFor(item)} sel={sel} />
              ))}
            </Grid>
            {lib.hasMore && (
              <div className="flex justify-center py-6">
                <Button variant="secondary" onClick={lib.loadMore} disabled={lib.loadingMore}>
                  {lib.loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <Viewer item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
