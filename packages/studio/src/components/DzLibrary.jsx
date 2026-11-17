"use client";

// DZ: Library — everything you made, on any device. Only your own items.
//   All · Images · Videos · Upscaled · Liked · Uploads · Trash
// Trash keeps items 7 days; "Delete forever" removes the files at once.
import { useEffect, useState } from "react";
import { useDzHistory, dzLibrary } from "../dzLibrary.js";
import DzLikeButton, { DzPendingTile } from "./DzLikeButton.jsx";
import { dzModelLabel, dzOpenUpscale, dzUpscaleSpec } from "../dzCatalog.js";

const VIEWS = [
  { id: "all", label: "All", filter: {} },
  { id: "images", label: "Images", filter: { kind: "image" } },
  { id: "videos", label: "Videos", filter: { kind: "video" } },
  { id: "upscaled", label: "Upscaled", filter: { studio: "upscale" } },
  { id: "liked", label: "Liked", filter: { liked: true } },
  { id: "uploads", label: "Uploads", uploads: true },
  { id: "trash", label: "Trash", filter: { trash: true } },
];
const STUDIO_LABEL = { cinema: "Cinema", image: "Image", video: "Video", upscale: "Upscale" };

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

const fmtUsd = (usd) => (usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3));
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

function Viewer({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!item) return null;
  const isVideo = item.kind === "video" || /\.(mp4|mov|webm)$/i.test(item.url || "");
  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-between gap-4 px-5 py-3 text-[14px] text-white/80" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate">{item.prompt || item.name || ""}</span>
        <button type="button" onClick={onClose} className="h-9 w-9 flex-shrink-0 rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close">✕</button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video src={item.url} controls autoPlay className="max-h-full max-w-full rounded-lg" />
        ) : (
          <img src={item.url} alt={item.prompt || "Image"} className="max-h-full max-w-full rounded-lg object-contain" />
        )}
      </div>
    </div>
  );
}

function Card({ item, view, onOpen, actions }) {
  const isVideo = item.kind === "video";
  const studio = STUDIO_LABEL[item.studio] || null;
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0b0d] transition-colors hover:border-white/20">
      <button type="button" className="relative block w-full" onClick={() => item.url && onOpen(item)} disabled={!item.url}>
        {!item.url ? (
          <DzPendingTile status={item.status} error={item.error} className="aspect-square w-full" />
        ) : isVideo ? (
          <video
            src={item.url}
            className="aspect-square w-full bg-black/40 object-cover"
            muted
            loop
            playsInline
            preload="metadata"
            onMouseOver={(e) => e.currentTarget.play().catch(() => {})}
            onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
          />
        ) : (
          <img src={item.url} alt={item.prompt?.slice(0, 60) || item.name || "Image"} loading="lazy" className="aspect-square w-full bg-black/40 object-cover" />
        )}
        {isVideo && item.url && <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-[12px] font-semibold text-white/85">Video</span>}
      </button>
      {item.url && view !== "uploads" && (
        <div className="absolute right-2 top-2 flex flex-col gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          {actions}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
        {item.prompt ? (
          <p className="line-clamp-2 text-[14px] leading-snug text-white/75" title={item.prompt}>{item.prompt}</p>
        ) : item.name ? (
          <p className="truncate text-[14px] text-white/75" title={item.name}>{item.name}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/40">
          {studio && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white/60">{studio}</span>}
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

function Uploads({ onOpen }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let cancelled = false;
    dzLibrary.uploads({ limit: 200 }).then((d) => { if (!cancelled) setItems(d.items || []); }).catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);
  if (!items) return <p className="py-16 text-center text-[15px] text-white/40">Loading…</p>;
  if (!items.length) return <p className="py-16 text-center text-[15px] text-white/40">Nothing uploaded yet. Files you add as references show up here.</p>;
  return (
    <Grid>
      {items.map((u) => (
        <Card key={u.id} view="uploads" onOpen={onOpen} item={{ ...u, kind: u.mime.split("/")[0], status: "completed" }} />
      ))}
    </Grid>
  );
}

export default function DzLibrary({ onGenerationError }) {
  const [viewId, setViewId] = useState(() => {
    try { return localStorage.getItem("dz_library_view") || "all"; } catch { return "all"; }
  });
  const view = VIEWS.find((v) => v.id === viewId) || VIEWS[0];
  useEffect(() => { try { localStorage.setItem("dz_library_view", view.id); } catch { /* optional */ } }, [view.id]);
  const [open, setOpen] = useState(null);
  const lib = useDzHistory(view.filter || {}, { limit: 60 });
  const report = (e) => onGenerationError?.(String(e?.message || e));
  const canUpscale = Boolean(dzUpscaleSpec());

  const actionsFor = (item) => {
    if (view.id === "trash") {
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
        {canUpscale && item.kind === "image" && (
          <IconButton title="Upscale" onClick={() => dzOpenUpscale(item.url)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </IconButton>
        )}
        <IconButton title="Move to trash" danger onClick={() => lib.trash(item.id).catch(report)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
        </IconButton>
      </>
    );
  };

  const empty = {
    all: "Nothing here yet. Everything you generate in any studio appears here, on every device.",
    images: "No images yet.",
    videos: "No videos yet.",
    upscaled: "No upscaled images yet.",
    liked: "Nothing liked yet. Tap the heart on any result to keep it here.",
    trash: "Trash is empty. Deleted items stay here for 7 days.",
  }[view.id];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-app-bg">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-1 border-b border-white/[0.06] px-4 py-3 md:px-6">
        <h1 className="mr-4 text-[18px] font-bold text-white">Library</h1>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setViewId(v.id)}
            aria-pressed={v.id === view.id}
            className={`rounded-lg px-3 py-1.5 text-[14px] font-semibold transition-colors ${v.id === view.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-5 md:px-6">
        {view.uploads ? (
          <Uploads onOpen={setOpen} />
        ) : !lib.loaded ? (
          <p className="py-16 text-center text-[15px] text-white/40">Loading…</p>
        ) : lib.items.length === 0 ? (
          <p className="py-16 text-center text-[15px] text-white/40">{empty}</p>
        ) : (
          <>
            {view.id === "trash" && <p className="mb-4 text-[14px] text-white/45">Items in the trash are deleted for good after 7 days.</p>}
            <Grid>
              {lib.items.map((item) => (
                <Card key={item.id} item={item} view={view.id} onOpen={setOpen} actions={actionsFor(item)} />
              ))}
            </Grid>
            {lib.hasMore && (
              <div className="flex justify-center py-6">
                <button type="button" onClick={lib.loadMore} disabled={lib.loadingMore} className="rounded-xl bg-white/10 px-5 py-2.5 text-[14px] font-semibold text-white/85 hover:bg-white/15 disabled:opacity-50">
                  {lib.loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <Viewer item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
