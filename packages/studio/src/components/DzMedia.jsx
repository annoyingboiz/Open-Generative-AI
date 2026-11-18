"use client";

// DZ: one media picker for the whole app — wherever a picture, video or sound
// goes in (references, start frames, element views, upscale input).
//   Tabs: Uploads · Generations · Liked · Elements
//   Type: All / Images / Videos (when the slot takes both)
//   Where: this project / Library (inside a project)
//   Badges: Video, Upscaled, Edit, Copy · the first tile uploads from the device
//   One-file slots pick on click; several-file slots choose up to the model's limit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uploadFile, dzThumb } from "../api.js";
import { useDzContext } from "../dzContext.js";
import { useDzElements } from "./DzElements.jsx";
import { Button, Spinner, Segmented, cn, DialogParts } from "../ui/index.js";

const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = DialogParts;

const ACCEPT = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg",
};
const kindOfUrl = (url, mime) => {
  if (mime) return mime.split("/")[0];
  if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(url)) return "audio";
  return "image";
};

function badgesOf(item) {
  const out = [];
  if (item.kind === "video") out.push("Video");
  if (item.kind === "audio") out.push("Audio");
  if (item.studio === "upscale") out.push("Upscaled");
  else if (/edit|[?&]m=i2i/i.test(item.model || "") || /^Draw to Edit/i.test(item.prompt || "")) out.push("Edit");
  if (item.meta?.copiedFrom) out.push("Copy");
  return out;
}

async function getJson(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// One page of a tab, with "Load more".
function usePaged(tab, type, where, accept, ctx, refreshKey) {
  const [state, setState] = useState({ items: [], cursor: null, loading: true });
  const seq = useRef(0);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    const kind = type !== "all" ? type : accept !== "any" ? accept : "";
    if (tab === "uploads") {
      p.set("kind", kind || "all");
      if (where === "project" && ctx.project) p.set("project", ctx.project.id);
      return `/api/v1/uploads?${p}`;
    }
    if (tab === "generations" || tab === "liked") {
      p.set("status", "completed");
      if (kind) p.set("kind", kind);
      if (tab === "liked") p.set("liked", "1");
      if (where === "project" && ctx.project) p.set("project", ctx.project.id);
      return `/api/v1/history?${p}`;
    }
    return null;
  }, [tab, type, where, accept, ctx.project]);
  const load = useCallback(async (cursor) => {
    if (!query) return;
    const mine = cursor ? seq.current : ++seq.current;
    setState((s) => ({ ...s, loading: true, ...(cursor ? {} : { items: [] }) }));
    try {
      const data = await getJson(`${query}&limit=60${cursor ? `&cursor=${cursor}` : ""}`);
      if (mine !== seq.current) return;
      const items = (data.items || []).filter((i) => i.url).map((i) => ({
        key: i.id, url: i.url, name: i.name || i.prompt || "", kind: i.kind || kindOfUrl(i.url, i.mime),
        studio: i.studio, model: i.model, prompt: i.prompt, meta: i.meta,
      })).filter((i) => accept === "any" || i.kind === accept);
      setState((s) => ({ items: cursor ? [...s.items, ...items.filter((x) => !s.items.some((y) => y.key === x.key))] : items, cursor: (data.items || []).length >= 60 ? data.next_cursor : null, loading: false }));
    } catch {
      if (mine === seq.current) setState((s) => ({ ...s, loading: false }));
    }
  }, [query, accept]);
  useEffect(() => { load(null); }, [load, refreshKey]);
  return { ...state, more: () => state.cursor && load(state.cursor) };
}

// The picker's body — in a dialog (DzMediaPicker) or inline (Upscale).
export function DzMediaBrowser({ accept = "image", max = 1, onConfirm, onError, apiKey = "session", confirmLabel = "Add", onCancel, inline = false, onUploading }) {
  const ctx = useDzContext();
  const [tab, setTab] = useState("generations");
  const [type, setType] = useState("all");
  const [where, setWhere] = useState(ctx.project ? "project" : "library");
  const [chosen, setChosen] = useState([]); // [{ url, name, kind }]
  // Another project: start over (nothing from the old one stays chosen).
  useEffect(() => { setWhere(ctx.project ? "project" : "library"); setChosen([]); }, [ctx.project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [uploading, setUploading] = useState(0);
  // A closed picker, or one now showing another project, ignores late uploads.
  const alive = useRef(true);
  const uploadSeq = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { uploadSeq.current += 1; }, [ctx.project?.id]);
  useEffect(() => { if (!uploading) return undefined; onUploading?.(true); return () => onUploading?.(false); }, [uploading > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const [refreshKey, setRefreshKey] = useState(0);
  const fileInput = useRef(null);
  const els = useDzElements();
  const paged = usePaged(tab, type, where, accept, ctx, refreshKey);
  const single = max <= 1;
  const full = chosen.length >= max;

  const pick = (item) => {
    if (uploading || ctx.pending) return;
    if (single) { onConfirm([{ url: item.url, name: item.name, kind: item.kind }]); return; }
    setChosen((list) => {
      if (list.some((x) => x.url === item.url)) return list.filter((x) => x.url !== item.url);
      if (list.length >= max) return list;
      return [...list, { url: item.url, name: item.name, kind: item.kind }];
    });
  };

  const upload = async (files) => {
    const okKinds = accept === "any" ? ["image", "video"] : [accept];
    const list = files.filter((f) => okKinds.includes(f.type.split("/")[0])).slice(0, single ? 1 : Math.max(0, max - chosen.length));
    if (!list.length) { onError?.(`Choose ${accept === "any" ? "image or video" : accept} files.`); return; }
    const seq = ++uploadSeq.current;
    setUploading((n) => n + 1);
    const done = [];
    try {
      for (const f of list) {
        const url = await uploadFile(apiKey, f);
        done.push({ url, name: f.name, kind: f.type.split("/")[0] });
      }
    } catch (e) {
      if (alive.current) onError?.(String(e?.message || e));
    } finally {
      if (alive.current) setUploading((n) => n - 1);
    }
    if (!done.length || !alive.current || seq !== uploadSeq.current) return;
    if (single) { onConfirm(done.slice(0, 1)); return; }
    setChosen((prev) => [...prev, ...done.filter((d) => !prev.some((p) => p.url === d.url))].slice(0, max));
    if (tab === "uploads") setRefreshKey((k) => k + 1);
  };

  // Elements: each element's pictures (and its video, for video slots), grouped by name.
  const elementGroups = useMemo(() => {
    const list = where === "project" && ctx.project ? els.project : els.library;
    return list.map((e) => ({
      id: e.id, name: e.name,
      items: [
        ...((accept === "image" || accept === "any") && type !== "video" ? (e.images || []).map((url, i) => ({ key: `${e.id}-${i}`, url, name: `${e.name} ${i + 1}`, kind: "image" })) : []),
        ...((accept === "video" || accept === "any") && type !== "image" && e.video ? [{ key: `${e.id}-v`, url: e.video, name: `${e.name} video`, kind: "video" }] : []),
      ],
    })).filter((g) => g.items.length);
  }, [els, where, ctx.project, accept, type]);

  const tile = (item) => {
    const on = chosen.some((x) => x.url === item.url);
    const badges = badgesOf(item);
    const blocked = (!single && !on && full) || uploading > 0;
    return (
      <button key={item.key} type="button" onClick={() => pick(item)} disabled={blocked}
        title={item.name || undefined}
        className={cn("group relative aspect-square overflow-hidden rounded-xl border bg-muted transition-colors", on ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary", blocked && "opacity-40")}>
        {item.kind === "video" ? <video src={item.url} poster={dzThumb(item.url, 256)} className="h-full w-full object-cover" muted playsInline preload="none" onMouseOver={(e) => e.currentTarget.play().catch(() => {})} onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
          : item.kind === "audio" ? <span className="flex h-full items-center justify-center px-2 text-center text-muted-foreground">♪ {item.name}</span>
            : <img src={dzThumb(item.url, 256)} alt={item.name || ""} loading="lazy" decoding="async" className="h-full w-full object-cover" />}
        {badges.length > 0 && (
          <span className="absolute bottom-1.5 left-1.5 flex flex-wrap gap-1">
            {badges.map((b) => <span key={b} className="rounded-md bg-black/75 px-1.5 text-base font-semibold text-white">{b}</span>)}
          </span>
        )}
        {!single && (
          <span className={cn("absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 font-bold", on ? "border-primary bg-primary text-primary-foreground" : "border-white/80 bg-black/40 text-transparent opacity-0 group-hover:opacity-100")}>
            {on ? chosen.findIndex((x) => x.url === item.url) + 1 : "✓"}
          </span>
        )}
      </button>
    );
  };

  const uploadTile = (
    <button key="upload" type="button" onClick={() => fileInput.current?.click()} disabled={uploading > 0 || (!single && full)}
      className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50">
      {uploading ? <Spinner className="h-6 w-6" /> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>}
      <span className="font-semibold">{uploading ? "Uploading…" : "Upload"}</span>
    </button>
  );

  const typeOptions = accept === "any"
    ? [{ value: "all", label: "All" }, { value: "image", label: "Images" }, { value: "video", label: "Videos" }]
    : null;
  const noun = accept === "video" ? "videos" : accept === "audio" ? "sounds" : accept === "any" ? "files" : "images";
  const emptyText = {
    uploads: `No uploaded ${noun} here yet.`,
    generations: `No generated ${noun} here yet.`,
    liked: `Nothing liked here yet.`,
    elements: "No elements with matching files here yet.",
  }[tab];

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", inline && "h-full")}>
      <input ref={fileInput} type="file" accept={accept === "any" ? `${ACCEPT.image},${ACCEPT.video}` : ACCEPT[accept]} multiple={!single} hidden
        onChange={(e) => { upload([...(e.target.files || [])]); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={tab} onChange={setTab} size="sm" className="w-auto" aria-label="Source"
          options={[{ value: "uploads", label: "Uploads" }, { value: "generations", label: "Generations" }, { value: "liked", label: "Liked" }, ...(accept !== "audio" ? [{ value: "elements", label: "Elements" }] : [])]} />
        {typeOptions && <Segmented value={type} onChange={setType} size="sm" className="w-auto" aria-label="Type" options={typeOptions} />}
        {ctx.project && (
          <Segmented value={where} onChange={setWhere} size="sm" className="w-auto" aria-label="Where"
            options={[{ value: "project", label: "This project" }, { value: "library", label: "Library" }]} />
        )}
      </div>
      <div className={cn("min-h-0 overflow-y-auto custom-scrollbar pr-1", inline ? "flex-1" : "max-h-[58vh]")}>
        {ctx.pending ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : tab === "elements" ? (
          !els.loaded ? <div className="flex justify-center py-10"><Spinner /></div>
            : elementGroups.length === 0 ? <p className="py-10 text-center text-muted-foreground">{emptyText}</p>
              : (
                <div className="space-y-4">
                  {elementGroups.map((g) => (
                    <div key={g.id} className="space-y-2">
                      <div className="font-semibold text-foreground">{g.name}</div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">{g.items.map(tile)}</div>
                    </div>
                  ))}
                </div>
              )
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
              {tab !== "liked" && uploadTile}
              {paged.items.map(tile)}
            </div>
            {paged.loading && <div className="flex justify-center py-6"><Spinner /></div>}
            {!paged.loading && paged.items.length === 0 && <p className="py-6 text-center text-muted-foreground">{emptyText}</p>}
            {!paged.loading && paged.cursor && <div className="flex justify-center py-4"><Button variant="secondary" size="sm" onClick={paged.more}>Load more</Button></div>}
          </>
        )}
      </div>
      {!single && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-muted-foreground tabular-nums">{chosen.length} / {max} chosen</span>
          {chosen.length > 0 && <Button size="sm" variant="ghost" onClick={() => setChosen([])}>Clear</Button>}
          <div className="ml-auto flex gap-2">
            {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
            <Button onClick={() => onConfirm(chosen)} disabled={!chosen.length || uploading > 0}>{confirmLabel}{chosen.length ? ` ${chosen.length}` : ""}</Button>
          </div>
        </div>
      )}
      {single && onCancel && !inline && (
        <div className="flex justify-end border-t border-border pt-3"><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
      )}
    </div>
  );
}

// The picker in a dialog. `max` = how many more the slot takes.
export function DzMediaPicker({ open, onOpenChange, title, description, accept = "image", max = 1, onPick, onError, apiKey, onUploading }) {
  const ctx = useDzContext();
  const [busy, setBusy] = useState(false);
  // Switching project closes the picker: its files belong to the old place.
  const projectId = ctx.project?.id || null;
  const openedIn = useRef(projectId);
  useEffect(() => { if (open) openedIn.current = projectId; }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && openedIn.current !== projectId) onOpenChange(false); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const noun = accept === "video" ? "a video" : accept === "audio" ? "a sound" : accept === "any" ? "files" : max > 1 ? "images" : "an image";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && busy) return; onOpenChange(o); }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title || `Add ${noun}`}</DialogTitle>
          <DialogDescription>{description || (max > 1 ? `Choose up to ${max} — from uploads, earlier work, liked or elements — or upload new ones.` : "Pick one from uploads, earlier work, liked or elements — or upload a new one.")}</DialogDescription>
        </DialogHeader>
        {open && (
          <DzMediaBrowser accept={accept} max={max} apiKey={apiKey} onError={onError} onCancel={() => { if (!busy) onOpenChange(false); }}
            onUploading={(on) => { setBusy(on); onUploading?.(on); }}
            onConfirm={(list) => { onPick(list); onOpenChange(false); }} />
        )}
        <DialogFooter className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
