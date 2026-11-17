"use client";

// DZ: Elements — named subjects (character, object, place) with pictures and
// an optional video, in the Library or in a project. Copies between them.
// The page, the editor, and the picker used in Create.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { uploadFile } from "../api.js";
import { useDzContext } from "../dzContext.js";
import { Button, Input, Textarea, Badge, Spinner, Segmented, cn, DialogParts, DropdownMenuParts, Popover, PopoverTrigger, PopoverContent } from "../ui/index.js";

const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = DialogParts;
const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } = DropdownMenuParts;

export const ELEMENT_KINDS = [
  { value: "character", label: "Character" },
  { value: "object", label: "Object" },
  { value: "place", label: "Place" },
  { value: "other", label: "Other" },
];

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
  return data;
}
const changed = () => window.dispatchEvent(new CustomEvent("dz:elements"));

export const dzElementsApi = {
  list: (project) => call("GET", `/dz/api/elements${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  create: async (data) => { const r = await call("POST", "/dz/api/elements", data); changed(); return r; },
  update: async (id, data) => { const r = await call("PATCH", `/dz/api/elements/${encodeURIComponent(id)}`, data); changed(); return r; },
  remove: async (id) => { const r = await call("DELETE", `/dz/api/elements/${encodeURIComponent(id)}`); changed(); return r; },
  copy: async (id, project) => { const r = await call("POST", `/dz/api/elements/${encodeURIComponent(id)}/copy`, { project: project || null }); changed(); return r; },
};

// Elements of the current context (and, in a project, the Library's too).
export function useDzElements() {
  const ctx = useDzContext();
  const [state, setState] = useState({ project: [], library: [], loaded: false });
  const key = ctx.project?.id || "";
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [lib, proj] = await Promise.all([dzElementsApi.list(null), key ? dzElementsApi.list(key) : Promise.resolve({ elements: [] })]);
        if (alive) setState({ project: proj.elements || [], library: lib.elements || [], loaded: true });
      } catch { if (alive) setState((s) => ({ ...s, loaded: true })); }
    };
    setState({ project: [], library: [], loaded: false });
    load();
    window.addEventListener("dz:elements", load);
    return () => { alive = false; window.removeEventListener("dz:elements", load); };
  }, [key]);
  return { ...state, ctx };
}

const Thumb = ({ el, className }) => (el.images?.[0]
  ? <img src={el.images[0]} alt="" className={cn("object-cover", className)} loading="lazy" />
  : el.video ? <video src={el.video} className={cn("object-cover", className)} muted playsInline preload="metadata" /> : <div className={cn("bg-muted", className)} />);

// ── Picking pictures/videos from recent work ─────────────────────────────

function RecentPicker({ kind, open, onOpenChange, onPick }) {
  const ctx = useDzContext();
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!open) return;
    setItems(null);
    const scope = ctx.project ? `&project=${encodeURIComponent(ctx.project.id)}` : "";
    Promise.all([
      fetch(`/api/v1/history?kind=${kind}&status=completed&limit=60${scope}`).then((r) => r.json()).catch(() => ({ items: [] })),
      fetch(`/api/v1/uploads?kind=${kind}&limit=60${scope}`).then((r) => r.json()).catch(() => ({ items: [] })),
    ]).then(([h, u]) => setItems([...(h.items || []).filter((i) => i.url).map((i) => ({ url: i.url, key: i.id })), ...(u.items || []).map((i) => ({ url: i.url, key: i.id }))]));
  }, [open, kind, ctx.project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>Pick {kind === "video" ? "a video" : "pictures"}</DialogTitle><DialogDescription>From your recent work and uploads{ctx.project ? " in this project" : ""}.</DialogDescription></DialogHeader>
        {!items ? <div className="flex justify-center py-10"><Spinner /></div> : items.length === 0 ? <p className="py-10 text-center text-muted-foreground">Nothing yet.</p> : (
          <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
            {items.map((i) => (
              <button key={i.key} onClick={() => { onPick(i.url); if (kind === "video") onOpenChange(false); }} className="overflow-hidden rounded-lg border border-border hover:border-primary">
                {kind === "video" ? <video src={i.url} className="aspect-square w-full object-cover" muted preload="metadata" /> : <img src={i.url} alt="" className="aspect-square w-full object-cover" loading="lazy" />}
              </button>
            ))}
          </div>
        )}
        <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────

export function ElementEditor({ element, open, onOpenChange, onSaved, onError }) {
  const ctx = useDzContext();
  const [form, setForm] = useState({ name: "", kind: "character", description: "", images: [], video: null });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [picker, setPicker] = useState(null); // 'image' | 'video'
  const fileInput = useRef(null);
  const videoInput = useRef(null);
  useEffect(() => {
    if (!open) return;
    setForm(element ? { name: element.name, kind: element.kind, description: element.description || "", images: element.images || [], video: element.video || null } : { name: "", kind: "character", description: "", images: [], video: null });
  }, [open, element]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const upload = async (files, asVideo) => {
    setUploading((n) => n + 1);
    try {
      for (const f of files) {
        const url = await uploadFile("session", f);
        if (asVideo) set({ video: url }); else setForm((x) => ({ ...x, images: [...x.images, url].slice(0, 8) }));
      }
    } catch (e) { onError?.(e.message); } finally { setUploading((n) => n - 1); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const data = { name: form.name, kind: form.kind, description: form.description, images: form.images, video: form.video };
      const r = element ? await dzElementsApi.update(element.id, data) : await dzElementsApi.create({ ...data, project: ctx.project?.id || null });
      onOpenChange(false);
      onSaved?.(r.element);
    } catch (e) { onError?.(e.message); } finally { setBusy(false); }
  };
  const canSave = form.name.trim() && (form.images.length || form.video) && !uploading && !busy;
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{element ? "Edit element" : `New element${ctx.project ? ` in ${ctx.project.name}` : ""}`}</DialogTitle>
            <DialogDescription>A character, object or place to reuse across generations. The first picture is the main one.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name, e.g. Anna" maxLength={40} />
              <Segmented value={form.kind} onChange={(kind) => set({ kind })} aria-label="Type" options={ELEMENT_KINDS} />
            </div>
            <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Short description (optional) — models that take elements use it" maxLength={300} rows={2} />
            <div className="grid gap-2">
              <div className="flex items-center justify-between"><span className="font-semibold">Pictures</span><span className="text-muted-foreground">{form.images.length}/8</span></div>
              <div className="flex flex-wrap gap-2">
                {form.images.map((url, i) => (
                  <div key={url} className={cn("group relative h-24 w-24 overflow-hidden rounded-xl border", i === 0 ? "border-primary" : "border-border")}>
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    {i === 0 && <span className="absolute left-1 top-1 rounded bg-primary px-1.5 text-[13px] font-bold text-primary-foreground">main</span>}
                    <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition group-hover:opacity-100">
                      {i > 0 ? <button className="rounded bg-black/70 px-1.5 text-[13px] text-white" onClick={() => set({ images: [url, ...form.images.filter((u) => u !== url)] })}>Main</button> : <span />}
                      <button aria-label="Remove" className="rounded bg-black/70 px-1.5 text-[13px] text-white" onClick={() => set({ images: form.images.filter((u) => u !== url) })}>✕</button>
                    </div>
                  </div>
                ))}
                {form.images.length < 8 && (
                  <div className="flex h-24 flex-col justify-center gap-1">
                    <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>Upload</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPicker("image")}>From work</Button>
                  </div>
                )}
                {uploading > 0 && <div className="flex h-24 w-24 items-center justify-center"><Spinner /></div>}
              </div>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ""; }} />
            </div>
            <div className="grid gap-2">
              <span className="font-semibold">Video element <span className="font-normal text-muted-foreground">(optional)</span></span>
              <p className="text-muted-foreground">A short clip of the character. Kling uses it for real people (3–8 s); other models get it as a video reference.</p>
              {form.video ? (
                <div className="flex items-center gap-3">
                  <video src={form.video} className="h-24 w-40 rounded-xl border border-border object-cover" muted controls preload="metadata" />
                  <Button size="sm" variant="ghost" onClick={() => set({ video: null })}>Remove</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => videoInput.current?.click()}>Upload video</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicker("video")}>From work</Button>
                </div>
              )}
              <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(e) => { upload([...e.target.files].slice(0, 1), true); e.target.value = ""; }} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={!canSave}>{busy ? <Spinner /> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RecentPicker kind={picker || "image"} open={Boolean(picker)} onOpenChange={(o) => !o && setPicker(null)}
        onPick={(url) => (picker === "video" ? set({ video: url }) : setForm((x) => (x.images.includes(url) ? x : { ...x, images: [...x.images, url].slice(0, 8) })))} />
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export function DzElementsPage({ projects = [], onError }) {
  const { project, library, loaded, ctx } = useDzElements();
  const [editing, setEditing] = useState(null); // element | 'new' | null
  const list = ctx.project ? project : library;
  const targets = projects.filter((p) => !p.archived && p.id !== ctx.project?.id);
  const report = (e) => onError?.(e.message || String(e));
  const card = (el) => (
    <div key={el.id} className="group overflow-hidden rounded-2xl border border-border bg-card">
      <button className="block w-full" onClick={() => setEditing(el)}><Thumb el={el} className="aspect-square w-full" /></button>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{el.name}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            <span>{ELEMENT_KINDS.find((k) => k.value === el.kind)?.label}</span>
            <span>· {el.images.length} pic{el.images.length === 1 ? "" : "s"}</span>
            {el.video && <Badge variant="secondary">video</Badge>}
            {el.author && <span>· {el.author}</span>}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label="More">⋯</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem className="text-base" onSelect={() => setEditing(el)}>Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground">Copy to…</DropdownMenuLabel>
            {ctx.project && <DropdownMenuItem className="text-base" onSelect={() => dzElementsApi.copy(el.id, null).catch(report)}>My Library</DropdownMenuItem>}
            {targets.map((p) => (
              <DropdownMenuItem key={p.id} className="gap-2 text-base" onSelect={() => dzElementsApi.copy(el.id, p.id).catch(report)}>
                <span className="h-3 w-3 rounded-full" style={{ background: p.color }} /> {p.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-base text-destructive" onSelect={() => { if (window.confirm(`Delete “${el.name}”?`)) dzElementsApi.remove(el.id).catch(report); }}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">
              {ctx.project && <span className="h-3 w-3 rounded-full" style={{ background: ctx.project.color }} />}
              {ctx.project ? `${ctx.project.name} · Elements` : "Elements"}
            </h1>
            <p className="text-lg text-muted-foreground">{ctx.project ? "Characters, objects and places of this project — everyone in it can use them. Copy one from your Library with “Copy to…”." : "Your characters, objects and places. Copy them into projects; a copy changes on its own."}</p>
          </div>
          {!ctx.project?.archived && <Button onClick={() => setEditing("new")}>+ New element</Button>}
        </div>
        {!loaded ? <div className="flex justify-center py-16"><Spinner /></div> : list.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-10 text-center text-lg text-muted-foreground">No elements yet.</p>
        ) : <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{list.map(card)}</div>}
        {ctx.project && library.length > 0 && (
          <>
            <h2 className="mb-3 mt-10 text-xl font-semibold text-muted-foreground">From your Library — copy into this project</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {library.map((el) => (
                <button key={el.id} onClick={() => dzElementsApi.copy(el.id, ctx.project.id).catch(report)} className="overflow-hidden rounded-xl border border-border text-left hover:border-primary" title="Copy into this project">
                  <Thumb el={el} className="aspect-square w-full" />
                  <div className="truncate px-2 py-1.5">{el.name} <span className="text-muted-foreground">+</span></div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <ElementEditor element={editing === "new" ? null : editing} open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} onError={onError} />
    </div>
  );
}

// ── Picker in Create ─────────────────────────────────────────────────────

export function ElementPicker({ selected = [], onChange, max = 7, note }) {
  const { project, library, loaded, ctx } = useDzElements();
  const [q, setQ] = useState("");
  const ids = new Set(selected.map((e) => e.id));
  const match = (e) => !q || e.name.toLowerCase().includes(q.toLowerCase());
  const toggle = (el) => {
    if (ids.has(el.id)) onChange(selected.filter((e) => e.id !== el.id));
    else if (selected.length < max) onChange([...selected, el]);
  };
  const row = (el) => (
    <button key={el.id} onClick={() => toggle(el)} disabled={!ids.has(el.id) && selected.length >= max}
      className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left disabled:opacity-40", ids.has(el.id) ? "bg-primary/15" : "hover:bg-accent")}>
      <Thumb el={el} className="h-10 w-10 shrink-0 rounded-md" />
      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{el.name}</span><span className="block truncate text-muted-foreground">{ELEMENT_KINDS.find((k) => k.value === el.kind)?.label}{el.video ? " · video" : ""}</span></span>
      {ids.has(el.id) && <span>✓</span>}
    </button>
  );
  const proj = project.filter(match);
  const lib = library.filter(match);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" className="h-10 rounded-xl px-3 font-medium">Elements{selected.length ? ` · ${selected.length}` : ""}</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search elements" className="mb-2" />
        {note && <p className="mb-2 px-1 text-muted-foreground">{note}</p>}
        <div className="max-h-80 overflow-y-auto">
          {!loaded && <div className="flex justify-center py-6"><Spinner /></div>}
          {ctx.project && proj.length > 0 && <div className="px-1 py-1 text-muted-foreground">This project</div>}
          {ctx.project && proj.map(row)}
          {lib.length > 0 && <div className="px-1 py-1 text-muted-foreground">{ctx.project ? "My Library" : "My elements"}</div>}
          {lib.map(row)}
          {loaded && !proj.length && !lib.length && <p className="px-1 py-4 text-muted-foreground">No elements yet. Make them on the Elements page.</p>}
        </div>
        <p className="px-1 pt-2 text-muted-foreground">Up to {max} for this model.</p>
      </PopoverContent>
    </Popover>
  );
}
