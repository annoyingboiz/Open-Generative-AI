"use client";

// DZ: Elements — named subjects (character, object, place) with pictures and
// an optional video, in the Library or in a project. Copies between them.
// The page, the editor, and the picker used in Create.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDzContext } from "../dzContext.js";
import { DzMediaPicker } from "./DzMedia.jsx";
import { dzGenerate, dzWithMeta, dzThumb } from "../api.js";
import { useDzQuote } from "./DzPrice.jsx";
import { createEntries, chooseVariant, missingFor, paramsOf, buildBody } from "../dzCreate.js";
import { Button, Input, Textarea, Badge, Spinner, Segmented, cn, DialogParts, DropdownMenuParts, SelectParts, Popover, PopoverTrigger, PopoverContent } from "../ui/index.js";

const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = DialogParts;
const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = SelectParts;
const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } = DropdownMenuParts;

export const ELEMENT_KINDS = [
  { value: "character", label: "Character" },
  { value: "object", label: "Prop" },
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
  duplicate: async (id) => { const r = await call("POST", `/dz/api/elements/${encodeURIComponent(id)}/copy`, { duplicate: true }); changed(); return r; },
  sync: async (id) => { const r = await call("POST", `/dz/api/elements/${encodeURIComponent(id)}/sync`); changed(); return r; },
};

// Elements of the current context (and, in a project, the Library's too).
export function useDzElements() {
  const ctx = useDzContext();
  // project: this project's · library: personal · others: (in the Library) every project's I'm in
  const [state, setState] = useState({ project: [], library: [], others: [], loaded: false });
  const key = ctx.project?.id || "";
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [lib, proj] = await Promise.all([
          key ? dzElementsApi.list(null) : dzElementsApi.list("all"),
          key ? dzElementsApi.list(key) : Promise.resolve({ elements: [] }),
        ]);
        const all = lib.elements || [];
        if (alive) setState({ project: proj.elements || [], library: all.filter((e) => !e.project_id), others: all.filter((e) => e.project_id), loaded: true });
      } catch { if (alive) setState((s) => ({ ...s, loaded: true })); }
    };
    setState({ project: [], library: [], others: [], loaded: false });
    load();
    window.addEventListener("dz:elements", load);
    return () => { alive = false; window.removeEventListener("dz:elements", load); };
  }, [key]);
  return { ...state, ctx };
}

const Thumb = ({ el, className }) => (el.images?.[0]
  ? <img src={dzThumb(el.images[0])} alt="" className={cn("object-cover", className)} loading="lazy" decoding="async" />
  : el.video ? <video src={el.video} className={cn("object-cover", className)} muted playsInline preload="metadata" /> : <div className={cn("bg-muted", className)} />);

// ── Editor ───────────────────────────────────────────────────────────────

// ── Shared bits ──────────────────────────────────────────────────────────

const KIND_TABS = [
  { value: "all", label: "All" },
  { value: "character", label: "Characters" },
  { value: "place", label: "Places" },
  { value: "object", label: "Props" },
  { value: "other", label: "Other" },
];
const TAG_PREFIX = { character: "char", object: "prop", place: "loc", other: "obj" };
const CYR = { а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", є: "ye", ё: "e", ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
export function suggestTag(name, kind) {
  const latin = String(name || "").toLowerCase().split("").map((c) => CYR[c] ?? c).join("");
  const slug = latin.normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "x";
  return `${TAG_PREFIX[kind] || "obj"}_${slug}`;
}
const kindLabel = (k) => ELEMENT_KINDS.find((x) => x.value === k)?.label || k;
// Ready-made names for views, by type (any label can be typed).
const VIEW_LABELS = {
  character: ["Front", "3/4 left", "3/4 right", "Profile", "Back", "Full body", "Face close-up", "Outfit"],
  object: ["Front", "Side", "Top", "Back", "Detail", "In use"],
  place: ["Wide", "Reverse", "Detail", "Night", "Day"],
  other: ["Main", "Detail"],
};
// The prompt a video element starts from, by type (editable before generating).
const VIDEO_TEMPLATES = {
  character: "The same person as in the reference images, on a plain light-grey studio background. The face slowly turns from one profile to the other, then the camera moves slowly over the details of the face, hair and clothes. Even soft light, no music, no text.",
  object: "The same object as in the reference images, on a slowly rotating turntable, plain light-grey studio background, one full 360° turn, even soft light, no text.",
  place: "The same place as in the reference images, a slow smooth panorama across the whole space, natural light, no people, no text.",
  other: "The subject of the reference images, slowly revealed from every side on a plain background, even soft light, no text.",
};
const VIDEO_LABEL = { character: "Turnaround", object: "360° turn", place: "Panorama", other: "Reveal" };

function download(url) {
  const a = document.createElement("a");
  a.href = url;
  a.download = url.split("/").pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const MediaTile = ({ url, video, className }) => (video
  ? <video src={url} poster={dzThumb(url, 256)} className={cn("object-cover", className)} muted playsInline preload="none" onMouseOver={(e) => e.currentTarget.play().catch(() => {})} onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
  : <img src={dzThumb(url, 256)} alt="" className={cn("object-cover", className)} loading="lazy" decoding="async" />);

// ── Editor (right-hand panel) ────────────────────────────────────────────

const EMPTY = { name: "", kind: "character", tag: "", tagEdited: false, status: "active", description: "", notes: "", views: [], videos: [] };

export function ElementEditor({ element, open, onOpenChange, onSaved, onError, onGenerateVideo, preset }) {
  const ctx = useDzContext();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false); // the picker is uploading
  const [picker, setPicker] = useState(null); // 'image' | 'video'
  useEffect(() => {
    if (!open) return;
    setForm(element ? {
      name: element.name, kind: element.kind, tag: element.tag || "", tagEdited: true, status: element.status || "active",
      description: element.description || "", notes: element.notes || "",
      views: (element.views || element.images?.map((url) => ({ url, label: "" })) || []).map((v) => ({ ...v })),
      videos: (element.videos || (element.video ? [{ url: element.video, label: "" }] : [])).map((v) => ({ ...v })),
    } : { ...EMPTY, ...(preset || {}) });
  }, [open, element]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => setForm((f) => {
    const next = { ...f, ...patch };
    // The tag follows the name and type until it is edited by hand.
    if (!next.tagEdited && (patch.name !== undefined || patch.kind !== undefined)) next.tag = next.name.trim() ? suggestTag(next.name, next.kind) : "";
    return next;
  });
  const setView = (i, patch) => setForm((f) => ({ ...f, views: f.views.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const moveView = (i, d) => setForm((f) => {
    const views = [...f.views];
    const j = i + d;
    if (j < 0 || j >= views.length) return f;
    [views[i], views[j]] = [views[j], views[i]];
    return { ...f, views };
  });
  const makeMain = (i) => setForm((f) => ({ ...f, views: [f.views[i], ...f.views.filter((_, j) => j !== i)] }));
  const save = async () => {
    setBusy(true);
    try {
      const data = { name: form.name, kind: form.kind, tag: form.tag || undefined, status: form.status, description: form.description, notes: form.notes, views: form.views, videos: form.videos };
      const r = element ? await dzElementsApi.update(element.id, data) : await dzElementsApi.create({ ...data, project: ctx.project?.id || null });
      onSaved?.(r.element);
      onOpenChange(false);
    } catch (e) { onError?.(e.message); } finally { setBusy(false); }
  };
  const canSave = form.name.trim() && (form.views.length || form.videos.length) && !busy && !picking;
  const labels = VIEW_LABELS[form.kind] || VIEW_LABELS.other;
  const nextLabel = () => labels.find((l) => !form.views.some((v) => v.label === l)) || "";
  if (!open) return null;
  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-card shadow-2xl" aria-label={element ? "Edit element" : "New element"}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-lg font-semibold">{element ? `Edit · ${element.name}` : `New element${ctx.project ? ` in ${ctx.project.name}` : ""}`}</h2>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}>✕</Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto custom-scrollbar px-5 py-4">
        <div className="space-y-2">
          <span className="font-semibold">Type</span>
          <Segmented value={form.kind} onChange={(kind) => set({ kind })} aria-label="Type" options={ELEMENT_KINDS} />
        </div>
        <div className="grid gap-3">
          <label className="grid gap-1.5"><span className="font-semibold">Name</span>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Mike, Rock glass, Old Room Bar" maxLength={40} />
          </label>
          <label className="grid gap-1.5"><span className="font-semibold">Tag <span className="font-normal text-muted-foreground">— how prompts call it</span></span>
            <div className="flex items-center gap-1 rounded-md border border-input bg-background pl-3">
              <span className="text-muted-foreground">@</span>
              <input value={form.tag} onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40), tagEdited: true }))}
                className="h-9 min-w-0 flex-1 bg-transparent pr-3 outline-none" placeholder="char_mike" aria-label="Tag" />
            </div>
          </label>
          <div className="grid gap-1.5"><span className="font-semibold">Status</span>
            <Segmented value={form.status} onChange={(status) => set({ status })} aria-label="Status" size="sm" className="w-auto"
              options={[{ value: "active", label: "Active" }, { value: "draft", label: "Draft — hidden in Create" }]} />
          </div>
        </div>
        <label className="grid gap-1.5">
          <span className="flex justify-between font-semibold">Description <span className="font-normal text-muted-foreground tabular-nums">{form.description.length}/400</span></span>
          <Textarea value={form.description} onChange={(e) => set({ description: e.target.value.slice(0, 400) })} rows={3}
            placeholder="What must stay the same: look, size, materials, colours. Models that take elements read it." />
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between"><span className="font-semibold">Views <span className="font-normal text-muted-foreground">— the first is the main one</span></span><span className="text-muted-foreground tabular-nums">{form.views.length}/24</span></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {form.views.map((v, i) => (
              <div key={v.url} className={cn("overflow-hidden rounded-xl border", i === 0 ? "border-signal" : "border-border")}>
                <div className="group relative">
                  <img src={dzThumb(v.url)} alt={v.label || ""} className="aspect-square w-full object-cover" />
                  {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-md bg-primary px-1.5 font-semibold text-primary-foreground">Main</span>}
                  <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <span className="flex gap-1">
                      <button type="button" aria-label="Move left" disabled={i === 0} onClick={() => moveView(i, -1)} className="h-8 w-8 rounded-md bg-overlay/75 text-overlay-foreground disabled:opacity-40">←</button>
                      <button type="button" aria-label="Move right" disabled={i === form.views.length - 1} onClick={() => moveView(i, 1)} className="h-8 w-8 rounded-md bg-overlay/75 text-overlay-foreground disabled:opacity-40">→</button>
                    </span>
                    <span className="flex gap-1">
                      {i > 0 && <button type="button" onClick={() => makeMain(i)} className="h-8 rounded-md bg-overlay/75 px-2 text-overlay-foreground">Main</button>}
                      <button type="button" aria-label="Remove view" onClick={() => setForm((f) => ({ ...f, views: f.views.filter((_, j) => j !== i) }))} className="h-8 w-8 rounded-md bg-overlay/75 text-overlay-foreground">✕</button>
                    </span>
                  </div>
                </div>
                <input value={v.label || ""} onChange={(e) => setView(i, { label: e.target.value.slice(0, 40) })} list={`dz-view-labels-${form.kind}`}
                  placeholder="Label, e.g. Profile" aria-label="View label" className="h-9 w-full bg-transparent px-2.5 outline-none" />
              </div>
            ))}
            {form.views.length < 24 && (
              <button type="button" onClick={() => setPicker("image")} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-muted-foreground hover:border-input hover:text-primary">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                <span className="font-semibold">Add views</span>
              </button>
            )}
          </div>
          <datalist id={`dz-view-labels-${form.kind}`}>{labels.map((l) => <option key={l} value={l} />)}</datalist>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between"><span className="font-semibold">Videos</span><span className="text-muted-foreground tabular-nums">{form.videos.length}/8</span></div>
          <p className="text-muted-foreground">Clips of the element (turnaround, walk…). Kling uses a person's clip directly; other models take it as a video reference.</p>
          {form.videos.map((v, i) => (
            <div key={v.url} className="flex items-center gap-3">
              <video src={v.url} className="h-20 w-32 shrink-0 rounded-lg border border-border object-cover" muted controls preload="metadata" />
              <Input value={v.label || ""} onChange={(e) => setForm((f) => ({ ...f, videos: f.videos.map((x, j) => (j === i ? { ...x, label: e.target.value.slice(0, 40) } : x)) }))} placeholder="Label, e.g. Turnaround" aria-label="Video label" />
              <Button variant="ghost" size="icon" aria-label="Remove video" onClick={() => setForm((f) => ({ ...f, videos: f.videos.filter((_, j) => j !== i) }))}>✕</Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {form.videos.length < 8 && <Button size="sm" variant="secondary" onClick={() => setPicker("video")}>Add video</Button>}
            {element && onGenerateVideo && form.views.length > 0 && form.videos.length < 8 && <Button size="sm" variant="secondary" onClick={() => onGenerateVideo(element)}>Generate video element…</Button>}
            {!element && <span className="text-muted-foreground">Save first to generate a video from the views.</span>}
          </div>
        </div>

        <label className="grid gap-1.5"><span className="font-semibold">Notes <span className="font-normal text-muted-foreground">(for people: real size, where it's from…)</span></span>
          <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value.slice(0, 2000) })} rows={3} />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={save} disabled={!canSave}>{busy ? <Spinner /> : element ? "Save" : "Create"}</Button>
      </div>
      <DzMediaPicker open={Boolean(picker)} onOpenChange={(o) => !o && setPicker(null)} accept={picker === "video" ? "video" : "image"}
        max={picker === "video" ? Math.max(1, 8 - form.videos.length) : Math.max(1, 24 - form.views.length)} onError={onError} onUploading={setPicking}
        title={picker === "video" ? "Videos of the element" : "Views of the element"}
        onPick={(list) => setForm((f) => (picker === "video"
          ? { ...f, videos: [...f.videos, ...list.filter((x) => !f.videos.some((v) => v.url === x.url)).map((x) => ({ url: x.url, label: "" }))].slice(0, 8) }
          : (() => {
            const used = new Set(f.views.map((v) => v.label));
            const add = list.filter((x) => !f.views.some((v) => v.url === x.url)).map((x) => {
              const label = labels.find((l) => !used.has(l)) || "";
              used.add(label);
              return { url: x.url, label };
            });
            return { ...f, views: [...f.views, ...add].slice(0, 24) };
          })()))} />
    </aside>
  );
}

// ── Viewer ───────────────────────────────────────────────────────────────

function ElementViewer({ element, onClose, onEdit, onGenerateVideo, onUse }) {
  const media = element ? [...(element.views || []).map((v) => ({ ...v, video: false })), ...(element.videos || []).map((v) => ({ ...v, video: true }))] : [];
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setI(0); setCopied(false); }, [element?.id]);
  useEffect(() => {
    if (!element) return undefined;
    const onKey = (e) => {
      if (e.key === "ArrowRight") setI((x) => Math.min(media.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [element, media.length]);
  if (!element) return null;
  const cur = media[Math.min(i, media.length - 1)];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[min(1200px,96vw)] gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <DialogTitle className="sr-only">{element.name}</DialogTitle>
        <DialogDescription className="sr-only">Views and videos of the element</DialogDescription>
        <div className="grid max-h-[92vh] md:grid-cols-[1fr_340px]">
          <div className="flex min-h-0 flex-col bg-overlay">
            <div className="flex min-h-[320px] flex-1 items-center justify-center p-4">
              {cur ? (cur.video ? <video key={cur.url} src={cur.url} controls autoPlay className="max-h-[66vh] max-w-full rounded-lg" /> : <img src={cur.url} alt={cur.label || element.name} className="max-h-[66vh] max-w-full rounded-lg object-contain" />) : null}
            </div>
            {cur?.label && <div className="px-4 pb-2 text-center text-foreground">{cur.label}</div>}
            <div className="flex gap-2 overflow-x-auto custom-scrollbar border-t border-border p-3">
              {media.map((m, j) => (
                <button key={m.url} type="button" onClick={() => setI(j)} aria-label={m.label || (m.video ? "Video" : "View")}
                  className={cn("relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2", j === i ? "border-signal" : "border-transparent opacity-70 hover:opacity-100")}>
                  <MediaTile url={m.url} video={m.video} className="h-full w-full" />
                  {m.video && <span className="absolute bottom-0.5 left-0.5 rounded bg-overlay/75 px-1 text-overlay-foreground">▶</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
            <div>
              <div className="text-2xl font-bold">{element.name}</div>
              <div className="text-muted-foreground">{kindLabel(element.kind)}{element.status === "draft" ? " · Draft" : ""}{element.author ? ` · ${element.author}` : ""}</div>
            </div>
            <button type="button" onClick={() => { navigator.clipboard?.writeText(`@${element.tag}`).then(() => setCopied(true)).catch(() => {}); }}
              className="flex items-center justify-between rounded-xl bg-signal/15 px-3 py-2 text-left font-semibold text-signal hover:bg-signal/20" title="Copy the tag">
              @{element.tag}<span className="font-normal">{copied ? "Copied" : "Copy"}</span>
            </button>
            {element.description && <p className="whitespace-pre-wrap text-foreground/90">{element.description}</p>}
            {element.notes && <div><div className="font-semibold">Notes</div><p className="whitespace-pre-wrap text-muted-foreground">{element.notes}</p></div>}
            <div className="text-muted-foreground">{(element.views || []).length} view{(element.views || []).length === 1 ? "" : "s"} · {(element.videos || []).length} video{(element.videos || []).length === 1 ? "" : "s"}</div>
            <div className="mt-auto grid gap-2">
              {element.status !== "draft" && <Button onClick={() => onUse(element)}>Use in Create</Button>}
              <Button variant="secondary" onClick={() => onGenerateVideo(element)} disabled={!(element.views || []).length || (element.videos || []).length >= 8}>Generate video element…</Button>
              <Button variant="secondary" onClick={() => onEdit(element)}>Edit</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Generate video element ───────────────────────────────────────────────
// A video model makes a clip from the element's own views; the clip joins the
// element's videos when it is ready (the server attaches it, even if this page closes).

export function VideoElementDialog({ element, onClose, onError, apiKey = "session" }) {
  // Models that take reference pictures first (they see every chosen view), then start-frame ones.
  const entries = useMemo(() => (element ? createEntries("video").filter((e) => e.slots.some((s) => s.role === "reference" || s.role === "first"))
    .sort((a, b) => Number(!a.slots.some((s) => s.role === "reference")) - Number(!b.slots.some((s) => s.role === "reference"))) : []), [element]);
  const [entryKey, setEntryKey] = useState("");
  const [chosen, setChosen] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!element) return;
    setError("");
    setEntryKey(entries[0]?.key || "");
    setChosen((element.views || []).map((v) => v.url));
    setPrompt(VIDEO_TEMPLATES[element.kind] || VIDEO_TEMPLATES.other);
    setLabel(VIDEO_LABEL[element.kind] || "Video");
    setDuration(undefined);
  }, [element?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const entry = entries.find((e) => e.key === entryKey) || null;
  const refSlot = entry?.slots.find((s) => s.role === "reference");
  // Views go in as references (up to the model's limit), or the main one as the start frame.
  const files = chosen.slice(0, refSlot ? refSlot.max : 1).map((url) => ({ url }));
  const attached = refSlot ? { reference: files } : { first: files.slice(0, 1) };
  const picked = entry && files.length ? chooseVariant(entry, attached) : null;
  // An endpoint that needs something else too (another file) can't be used here.
  const variant = picked && !missingFor(picked, attached) ? picked : null;
  const durationParam = variant ? paramsOf(variant.model).main.find((p) => p.key === "duration") : null;
  // A duration from another model is dropped when it isn't one of this model's.
  const durationOk = durationParam && duration !== undefined && (!Array.isArray(durationParam.enum) || durationParam.enum.some((x) => String(x) === String(duration)));
  const values = durationOk ? { duration } : {};
  useEffect(() => { setDuration(undefined); }, [entryKey]);
  const body = variant ? buildBody(variant, { prompt, values, attached }) : null;
  const { price, loading } = useDzQuote(apiKey, () => (body ? [dzGenerate, { endpoint: variant.model.endpoint, ...body }] : null));
  const tooMany = refSlot && chosen.length > refSlot.max;
  const full = (element?.videos || []).length >= 8;
  const run = async () => {
    if (!variant || !body || full) return;
    setBusy(true);
    setError("");
    const name = element.name;
    const meta = { kind: "video", entryKey: entry.key, modelName: `${entry.familyName} · ${entry.providerName}`, prompt, forElement: { id: element.id, label } };
    let accepted = false;
    // The dialog closes once the server has taken the job; a refusal stays here.
    const request = { endpoint: variant.model.endpoint, ...body, onRequestId: () => {
      accepted = true;
      onClose();
      window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "success", title: "Video element", message: `Making “${label}” for ${name}. It joins the element when ready.` } }));
    } };
    try {
      await dzWithMeta({ studio: "create", meta }, () => dzGenerate(apiKey, request));
      window.dispatchEvent(new CustomEvent("dz:elements"));
      setTimeout(() => window.dispatchEvent(new CustomEvent("dz:elements")), 3000);
      window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "success", title: "Video element", message: `“${label}” is ready in ${name}.` } }));
    } catch (e) {
      const msg = String(e?.message || e);
      if (accepted) onError?.(msg); else setError(msg);
    } finally { setBusy(false); }
  };
  if (!element) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate video element · {element.name}</DialogTitle>
          <DialogDescription>A video model makes a clip from the element's views. It is added to the element's videos when ready.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <span className="font-semibold">Views to use {refSlot ? <span className="font-normal text-muted-foreground">— up to {refSlot.max} for this model</span> : <span className="font-normal text-muted-foreground">— this model takes one start frame</span>}</span>
            <div className="flex flex-wrap gap-2">
              {(element.views || []).map((v) => {
                const on = chosen.includes(v.url);
                return (
                  <button key={v.url} type="button" onClick={() => setChosen((c) => (on ? c.filter((u) => u !== v.url) : [...c, v.url]))} title={v.label || undefined}
                    className={cn("relative h-20 w-20 overflow-hidden rounded-lg border-2", on ? "border-signal" : "border-border opacity-50")}>
                    <img src={dzThumb(v.url, 256)} alt={v.label || ""} className="h-full w-full object-cover" />
                    {on && <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">{chosen.indexOf(v.url) + 1}</span>}
                  </button>
                );
              })}
            </div>
            {tooMany && <p className="text-warning">Only the first {refSlot.max} chosen views go in.</p>}
          </div>
          <label className="grid gap-1.5"><span className="font-semibold">Model</span>
            <Select value={entryKey} onValueChange={setEntryKey}>
              <SelectTrigger aria-label="Model"><SelectValue placeholder="Pick a video model" /></SelectTrigger>
              <SelectContent className="max-h-[360px]">{entries.map((e) => <SelectItem key={e.key} value={e.key}>{e.familyName} · {e.providerName}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          {durationParam && Array.isArray(durationParam.enum) && (
            <label className="grid gap-1.5"><span className="font-semibold">Duration</span>
              <Select value={String(duration ?? durationParam.default ?? durationParam.enum[0])} onValueChange={(v) => setDuration(durationParam.enum.find((x) => String(x) === v))}>
                <SelectTrigger aria-label="Duration"><SelectValue /></SelectTrigger>
                <SelectContent>{durationParam.enum.map((d) => <SelectItem key={String(d)} value={String(d)}>{Number(d) === -1 ? "Auto" : `${d} s`}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          )}
          <label className="grid gap-1.5"><span className="font-semibold">Prompt <span className="font-normal text-muted-foreground">— a template for this type, change it freely</span></span>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
          </label>
          <label className="grid gap-1.5"><span className="font-semibold">Name of the clip</span>
            <Input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 40))} />
          </label>
        </div>
        {full && <p className="text-warning">This element already has 8 videos. Remove one to add another.</p>}
        {picked && !variant && <p className="text-warning">{missingFor(picked, attached)} Pick another model.</p>}
        {error && <p className="text-destructive">{error}</p>}
        <DialogFooter className="items-center gap-3">
          <span className="mr-auto text-muted-foreground tabular-nums">{price ? `${price.exact ? "" : "≈ "}$${price.usd.toFixed(2)}` : loading ? "…" : entry?.priceLabel || ""}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={!variant || !prompt.trim() || busy || !entries.length || full}>{busy ? <Spinner /> : "Generate"}</Button>
        </DialogFooter>
        {!entries.length && <p className="text-warning">No video model that takes pictures is available.</p>}
      </DialogContent>
    </Dialog>
  );
}

// ── "To element…" for chosen results ────────────────────────────────────

export function ToElementDialog({ items, onClose, onError }) {
  const { project, library, loaded, ctx } = useDzElements();
  const list = (ctx.project ? project : library).filter((e) => !ctx.project?.archived);
  const [target, setTarget] = useState("new");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("character");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTarget("new"); setName(""); setKind("character"); }, [items]);
  if (!items) return null;
  // Pictures become views, videos become videos; anything else (sound) is skipped.
  const pics = items.filter((i) => i.kind === "image" && i.url).map((i) => ({ url: i.url, label: "" }));
  const vids = items.filter((i) => i.kind === "video" && i.url).map((i) => ({ url: i.url, label: "" }));
  const run = async () => {
    setBusy(true);
    try {
      const el = target === "new" ? { views: [], videos: [], name } : list.find((e) => e.id === target);
      const newPics = pics.filter((p) => !(el.views || []).some((v) => v.url === p.url));
      const newVids = vids.filter((p) => !(el.videos || []).some((v) => v.url === p.url));
      const addPics = newPics.slice(0, Math.max(0, 24 - (el.views || []).length));
      const addVids = newVids.slice(0, Math.max(0, 8 - (el.videos || []).length));
      if (!addPics.length && !addVids.length) throw new Error(`${el.name} is full (24 views, 8 videos) or already has these.`);
      if (target === "new") await dzElementsApi.create({ name, kind, views: addPics, videos: addVids, project: ctx.project?.id || null });
      else await dzElementsApi.update(el.id, { views: [...(el.views || []), ...addPics], videos: [...(el.videos || []), ...addVids] });
      const added = addPics.length + addVids.length;
      const skipped = items.length - added;
      window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "success", title: "Elements", message: `Added ${added} file${added === 1 ? "" : "s"} to ${el.name}.${skipped ? ` ${skipped} skipped (already there, no room, or not a picture/video).` : ""}` } }));
      window.dispatchEvent(new CustomEvent("dz:moved"));
      onClose();
    } catch (e) { onError?.(e.message); } finally { setBusy(false); }
  };
  const row = (selected) => cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left", selected ? "bg-signal/15" : "hover:bg-accent");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {items.length} to an element</DialogTitle>
          <DialogDescription>Pictures become views, videos become its videos{ctx.project ? ` — elements of ${ctx.project.name}` : " — your Library's elements"}.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[50vh] gap-1 overflow-y-auto">
          <button type="button" className={row(target === "new")} onClick={() => setTarget("new")}><span className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border">+</span> New element</button>
          {target === "new" && (
            <div className="grid gap-2 py-2 pl-14">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={40} autoFocus />
              <Segmented value={kind} onChange={setKind} size="sm" aria-label="Type" options={ELEMENT_KINDS} />
            </div>
          )}
          {!loaded && <div className="flex justify-center py-4"><Spinner /></div>}
          {list.map((e) => (
            <button key={e.id} type="button" className={row(target === e.id)} onClick={() => setTarget(e.id)}>
              <Thumb el={e} className="h-10 w-10 rounded-md" />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{e.name}</span><span className="block truncate text-muted-foreground">@{e.tag} · {(e.views || []).length} views</span></span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={busy || (target === "new" && !name.trim()) || (!pics.length && !vids.length)}>{busy ? <Spinner /> : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export function DzElementsPage({ projects = [], onError, apiKey = "session" }) {
  const { project, library, loaded, ctx } = useDzElements();
  const [editing, setEditing] = useState(null); // element | 'new' | null
  const [viewing, setViewing] = useState(null);
  const [videoFor, setVideoFor] = useState(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");
  // Panels belong to the context they were opened in.
  useEffect(() => { setEditing(null); setViewing(null); setVideoFor(null); }, [ctx.project?.id]);
  const all = ctx.project ? project : library;
  // Keep an open viewer in step with fresh data (a new video, an edit).
  useEffect(() => { if (viewing) setViewing((v) => all.find((e) => e.id === v.id) || null); }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = q.trim().toLowerCase();
  const list = all
    .filter((e) => tab === "all" || e.kind === tab)
    .filter((e) => !needle || e.name.toLowerCase().includes(needle) || String(e.tag || "").includes(needle.replace(/^@/, "")) || String(e.description || "").toLowerCase().includes(needle))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.updated_at - a.updated_at));
  const counts = Object.fromEntries(KIND_TABS.map((t) => [t.value, t.value === "all" ? all.length : all.filter((e) => e.kind === t.value).length]));
  const targets = projects.filter((p) => !p.archived && p.id !== ctx.project?.id);
  const report = (e) => onError?.(e.message || String(e));
  const archived = Boolean(ctx.project?.archived);
  const use = (el) => { setViewing(null); window.dispatchEvent(new CustomEvent("dz:use-element", { detail: el })); };
  const card = (el) => (
    <div key={el.id} className="group overflow-hidden rounded-2xl border border-border bg-card">
      <button className="relative block w-full" onClick={() => setViewing(el)}>
        <Thumb el={el} className="aspect-square w-full" />
        {el.status === "draft" && <span className="absolute left-2 top-2 rounded-md bg-overlay/75 px-2 font-semibold text-overlay-foreground">Draft</span>}
        {(el.videos || []).length > 0 && <span className="absolute bottom-2 left-2 rounded-md bg-overlay/75 px-2 font-semibold text-overlay-foreground">▶ {el.videos.length}</span>}
      </button>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{el.name}</div>
          <div className="truncate text-primary">@{el.tag}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            <span>{kindLabel(el.kind)}</span>
            <span>· {(el.views || []).length} view{(el.views || []).length === 1 ? "" : "s"}</span>
            {el.source_id && <span>· copy</span>}
            {el.author && <span>· {el.author}</span>}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label={`Actions: ${el.name}`}>⋯</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem className="text-base" onSelect={() => setViewing(el)}>View</DropdownMenuItem>
            {!archived && <DropdownMenuItem className="text-base" onSelect={() => setEditing(el)}>Edit</DropdownMenuItem>}
            {!archived && (el.views || []).length > 0 && (el.videos || []).length < 8 && <DropdownMenuItem className="text-base" onSelect={() => setVideoFor(el)}>Generate video element…</DropdownMenuItem>}
            {el.status !== "draft" && <DropdownMenuItem className="text-base" onSelect={() => use(el)}>Use in Create</DropdownMenuItem>}
            {!archived && <DropdownMenuItem className="text-base" onSelect={() => dzElementsApi.duplicate(el.id).catch(report)}>Duplicate</DropdownMenuItem>}
            {el.source_id && !archived && (
              <DropdownMenuItem className="text-base" onSelect={() => { if (window.confirm(`Take everything from the original again? Changes made to “${el.name}” here are replaced (its tag stays).`)) dzElementsApi.sync(el.id).catch(report); }}>Update from original</DropdownMenuItem>
            )}
            {el.images?.[0] && <DropdownMenuItem className="text-base" onSelect={() => download(el.images[0])}>Download main view</DropdownMenuItem>}
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
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">
                {ctx.project && <span className="h-3 w-3 rounded-full" style={{ background: ctx.project.color }} />}
                {ctx.project ? `${ctx.project.name} · Elements` : "Elements"}
              </h1>
              <p className="text-lg text-muted-foreground">{ctx.project ? "Characters, props and places of this project — everyone in it can use them." : "Your characters, props and places. Copy them into projects; a copy changes on its own."}</p>
            </div>
            {!archived && <Button onClick={() => { setViewing(null); setEditing("new"); }}>+ New element</Button>}
          </div>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Segmented value={tab} onChange={setTab} size="sm" className="w-auto" aria-label="Type"
              options={KIND_TABS.map((t) => ({ value: t.value, label: `${t.label}${counts[t.value] ? ` · ${counts[t.value]}` : ""}` }))} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, @tag, description" className="h-9 w-[260px]" aria-label="Search elements" />
            <Segmented value={sort} onChange={setSort} size="sm" className="w-auto" aria-label="Sort" options={[{ value: "recent", label: "Recent" }, { value: "name", label: "A–Z" }]} />
          </div>
          {!loaded ? <div className="flex justify-center py-16"><Spinner /></div> : list.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-10 text-center text-lg text-muted-foreground">{all.length ? "Nothing matches." : "No elements yet."}</p>
          ) : <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{list.map(card)}</div>}
          {ctx.project && library.length > 0 && (
            <>
              <h2 className="mb-3 mt-10 text-xl font-semibold text-muted-foreground">From your Library — copy into this project</h2>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {library.map((el) => (
                  <button key={el.id} disabled={archived} onClick={() => dzElementsApi.copy(el.id, ctx.project.id).catch(report)} className="overflow-hidden rounded-xl border border-border text-left hover:border-input disabled:opacity-50" title="Copy into this project">
                    <Thumb el={el} className="aspect-square w-full" />
                    <div className="truncate px-2 py-1.5">{el.name} <span className="text-muted-foreground">+</span></div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {/* The editor slides over the page (it doesn't push it), wide enough for views. */}
      {editing && (
        <div className="fixed inset-y-0 right-0 top-14 z-40 w-full md:w-[min(720px,70vw)]">
          <ElementEditor element={editing === "new" ? null : editing} open onOpenChange={(o) => !o && setEditing(null)} onError={onError}
            onSaved={() => setViewing(null)} onGenerateVideo={(el) => setVideoFor(el)} />
        </div>
      )}
      <ElementViewer element={viewing} onClose={() => setViewing(null)} onEdit={(el) => { setViewing(null); setEditing(el); }} onGenerateVideo={(el) => { setViewing(null); setVideoFor(el); }} onUse={use} />
      <VideoElementDialog element={videoFor} onClose={() => setVideoFor(null)} onError={onError} apiKey={apiKey} />
    </div>
  );
}

// ── Picker in Create ─────────────────────────────────────────────────────

export function ElementPicker({ selected = [], onChange, max = 7, note }) {
  const { project, library, others, loaded, ctx } = useDzElements();
  const [q, setQ] = useState("");
  const ids = new Set(selected.map((e) => e.id));
  // Drafts stay out of Create.
  const match = (e) => e.status !== "draft" && (!q || e.name.toLowerCase().includes(q.toLowerCase()) || String(e.tag || "").includes(q.toLowerCase().replace(/^@/, "")));
  const toggle = (el) => {
    if (ids.has(el.id)) onChange(selected.filter((e) => e.id !== el.id));
    else if (selected.length < max) onChange([...selected, el]);
  };
  const row = (el) => (
    <button key={el.id} onClick={() => toggle(el)} disabled={!ids.has(el.id) && selected.length >= max}
      className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left disabled:opacity-40", ids.has(el.id) ? "bg-signal/15" : "hover:bg-accent")}>
      <Thumb el={el} className="h-10 w-10 shrink-0 rounded-md" />
      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{el.name}</span><span className="block truncate text-muted-foreground">@{el.tag} · {ELEMENT_KINDS.find((k) => k.value === el.kind)?.label}{el.video ? " · video" : ""}</span></span>
      {ids.has(el.id) && <span>✓</span>}
    </button>
  );
  const proj = project.filter(match);
  const lib = library.filter(match);
  const oth = (others || []).filter(match);
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
          {oth.length > 0 && <div className="px-1 py-1 text-muted-foreground">From my projects</div>}
          {oth.map(row)}
          {loaded && !proj.length && !lib.length && !oth.length && <p className="px-1 py-4 text-muted-foreground">No elements yet. Make them on the Elements page.</p>}
        </div>
        <p className="px-1 pt-2 text-muted-foreground">Up to {max} for this model.</p>
      </PopoverContent>
    </Popover>
  );
}
