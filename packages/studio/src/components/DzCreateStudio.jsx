"use client";

// DZ: Create — the one studio. Image | Video, every model of every provider,
// and an interface drawn from what the chosen model accepts at that provider
// (see dzCreate.js): media slots, @ references, main settings, Advanced,
// camera look and camera moves, price before you press Generate. History
// comes from the server Library.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dzGenerate, dzWithMeta, uploadFile, dzThumb } from "../api.js";
import { useDzQuote } from "./DzPrice.jsx";
import { useDzHistory, dzLibrary } from "../dzLibrary.js";
import { useDzContext } from "../dzContext.js";
import { dzOpenUpscale, dzUpscaleSpec, dzIsOwnImage, dzVideoUpscaleSpec, dzOpenVideoUpscale } from "../dzCatalog.js";
import { DzAdaptButton } from "./DzAdapt.jsx";
import { dzSetStudioState, DZ_INSERT_EVENT } from "../dzStudioState.js";
import DzLikeButton, { DzPendingTile, DzAudioTile } from "./DzLikeButton.jsx";
import DrawModal from "./DrawModal.jsx";
import { ElementPicker, useDzElements } from "./DzElements.jsx";
import { useDzSelection, SelectBox, GridToolbar, selectedRing } from "./DzSelection.jsx";
import { DzMediaPicker } from "./DzMedia.jsx";
import DzSentPanel, { useDzPromptPreview, DzHints } from "./DzSentPanel.jsx";
import { Viewer } from "./DzLibrary.jsx";
import {
  createEntries, chooseVariant, missingFor, buildBody, keepValues, paramsOf, refSyntaxFor, composePrompt,
  parseJsonPrompt, promptTags, translateTags, elementTags, elementFits, TAG_RE, mergeElements, elementsInputOf, entryTakesElements, klingElementPairs,
  ROLE_INFO, DEFAULT_CAMERA, lookData, normalizeCamera, lookOf, lookLabel,
} from "../dzCreate.js";
import {
  Button, Segmented, ScrollTabs, Switch, Slider, Textarea, Input, Logo, Spinner, InfoTip, Tip, cn,
  Popover, PopoverTrigger, PopoverContent, SelectParts,
} from "../ui/index.js";

const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = SelectParts;

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isScalar = (x) => ["string", "number", "boolean"].includes(typeof x);
const cleanValues = (v) => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => isScalar(x))) : {});
const cleanFiles = (list) => (Array.isArray(list) ? list.filter((f) => isObj(f) && typeof f.url === "string" && f.url).map((f) => ({ url: f.url, name: typeof f.name === "string" ? f.name : "" })) : []);
// Restored state is untrusted (old versions, hand edits): keep only well-formed parts.
function normalizeSaved(raw) {
  const s = isObj(raw) ? raw : {};
  const out = {};
  if (s.kind === "image" || s.kind === "video") out.kind = s.kind;
  if (isObj(s.modelByKind)) out.modelByKind = Object.fromEntries(Object.entries(s.modelByKind).filter(([, v]) => typeof v === "string"));
  if (isObj(s.valuesByKind)) out.valuesByKind = { image: cleanValues(s.valuesByKind.image), video: cleanValues(s.valuesByKind.video) };
  if (typeof s.prompt === "string") out.prompt = s.prompt;
  if (isObj(s.camera)) out.camera = Object.fromEntries(Object.entries(s.camera).filter(([, v]) => isScalar(v)));
  if (typeof s.move === "string") out.move = s.move;
  if ([1, 2, 3, 4].includes(s.count)) out.count = s.count;
  if (Array.isArray(s.elements)) out.elements = s.elements.filter((e) => isObj(e) && typeof e.id === "string" && typeof e.name === "string").slice(0, 7).map((e) => ({
    id: e.id, name: e.name, kind: typeof e.kind === "string" ? e.kind : "other", description: typeof e.description === "string" ? e.description : "",
    images: Array.isArray(e.images) ? e.images.filter((u) => typeof u === "string").slice(0, 8) : [], video: typeof e.video === "string" ? e.video : null,
  }));
  if (isObj(s.attached)) out.attached = Object.fromEntries(Object.entries(s.attached).filter(([role]) => ROLE_INFO[role]).map(([role, list]) => [role, cleanFiles(list)]));
  return out;
}
const load = (store) => { try { return normalizeSaved(JSON.parse(localStorage.getItem(store) || "{}")); } catch { return {}; } };

// One engine, three tabs: Create (image + video), Image, Video.
const MODES = {
  create: { store: "dz_create_v1", title: "Create", text: "Images and video with any model you have. Pick a model below — the panel shows exactly what that model accepts." },
  image: { store: "dz_image_v2", title: "Image", text: "Pick an image model — the panel shows exactly what it accepts: references, sizes, settings." },
  video: { store: "dz_video_v2", title: "Video", text: "Pick a video model — the panel shows its frames, references and settings." },
};

// Animate: put a picture into a video model — as its start frame, or as a
// reference (within the slot limit). If the chosen model takes no pictures,
// switch to the first one that takes a start frame.
function animateInto(videoEntries, currentKey, attached, url) {
  const cur = videoEntries.find((e) => e.key === currentKey) || videoEntries[0];
  const slot = (e, r) => e?.slots.find((sl) => sl.role === r);
  const target = slot(cur, "first") || slot(cur, "reference") ? cur : videoEntries.find((e) => slot(e, "first")) || cur;
  const file = { url, name: "result" };
  if (slot(target, "first")) return { modelKey: target?.key, attached: { ...attached, first: [file] } };
  const ref = slot(target, "reference");
  if (ref) return { modelKey: target.key, attached: { ...attached, reference: [file, ...(attached.reference || [])].slice(0, ref.max) } };
  return { modelKey: target?.key, attached: { ...attached, first: [file] } };
}

// Image tab → Video tab hand-off (Animate).
export const DZ_SEND_EVENT = "dz:send-to";
export const fmtUsd = (usd) => `$${usd === 0 ? "0" : usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
const ACCEPT = { image: "image/png,image/jpeg,image/webp", video: "video/mp4,video/quicktime,video/webm", audio: "audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" };

export async function download(url) {
  try {
    const blob = await (await fetch(url)).blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = url.split("/").pop().split("?")[0] || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch { window.open(url, "_blank"); }
}

const optLabel = (p, v) => {
  if (p.key === "duration") return Number(v) === -1 ? "Auto" : `${v}s`;
  const named = p.enumLabels && Object.hasOwn(p.enumLabels, String(v)) ? p.enumLabels[String(v)] : null;
  return typeof named === "string" ? named : String(v);
};

// ── Small controls ─────────────────────────────────────────────────────────

export function ParamControl({ p, value, onChange, compact }) {
  const current = value ?? p.default;
  if (Array.isArray(p.enum)) {
    return (
      <Select value={current == null ? undefined : String(current)} onValueChange={(v) => onChange(p.enum.find((x) => String(x) === v))}>
        <SelectTrigger aria-label={p.title} className={cn("h-10 w-auto min-w-[88px] gap-2 rounded-xl px-3", compact && "border-transparent bg-muted")}>
          <span className="text-muted-foreground">{compact ? "" : `${p.title}: `}</span>
          <SelectValue placeholder={p.title} />
        </SelectTrigger>
        <SelectContent className="max-h-[360px]">
          {p.enum.map((o) => <SelectItem key={String(o)} value={String(o)}>{optLabel(p, o)}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (p.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-3 py-1">
        <span>{p.title}</span>
        <Switch checked={Boolean(current)} onCheckedChange={onChange} />
      </label>
    );
  }
  if (p.type === "int" || p.type === "number") {
    const min = p.minValue ?? 0;
    const max = p.maxValue ?? (p.type === "int" ? 100 : 1);
    const step = p.step ?? (p.type === "int" ? 1 : 0.01);
    const v = Number(current ?? min);
    if (compact && p.key === "duration") {
      return (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" className="h-10 rounded-xl px-3 font-medium">{`${v}s`}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 rounded-xl">
            <div className="mb-3 flex items-center justify-between"><span className="font-semibold">Duration</span><span className="tabular-nums text-muted-foreground">{v}s</span></div>
            <Slider min={min} max={max} step={step} value={[v]} onValueChange={([x]) => onChange(x)} />
            <div className="mt-2 flex justify-between text-muted-foreground"><span>{min}s</span><span>{max}s</span></div>
          </PopoverContent>
        </Popover>
      );
    }
    return (
      <div className="space-y-2 py-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">{p.title}<InfoTip text={p.description} /></span>
          <Input type="number" min={min} max={max} step={step} value={value ?? ""} placeholder={p.default != null ? String(p.default) : "auto"} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className="h-9 w-24 text-right" />
        </div>
        {p.minValue != null && p.maxValue != null && <Slider min={min} max={max} step={step} value={[v]} onValueChange={([x]) => onChange(x)} />}
      </div>
    );
  }
  return (
    <div className="space-y-2 py-1">
      <span className="flex items-center gap-2">{p.title}<InfoTip text={p.description} /></span>
      {p.key.includes("prompt") || p.key === "lyrics" ? (
        <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={p.key === "lyrics" ? 6 : 2} placeholder={p.default || ""} />
      ) : (
        <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={p.default != null ? String(p.default) : ""} />
      )}
    </div>
  );
}

export function ModelPicker({ entries, entry, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("recommended");
  // No recommended models here (Tools, Audio): open on All instead of an empty list.
  const hasRecommended = entries.some((e) => e.recommended != null);
  const shownTab = tab === "recommended" && !hasRecommended ? "all" : tab;
  const vendors = useMemo(() => {
    const seen = new Map();
    for (const e of entries) if (!seen.has(e.vendorName)) seen.set(e.vendorName, e.vendorLogo);
    return [...seen.entries()].map(([name, logo]) => ({ name, logo }));
  }, [entries]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = entries;
    if (shownTab === "recommended") list = entries.filter((e) => e.recommended != null);
    else if (shownTab !== "all") list = entries.filter((e) => e.vendorName === shownTab);
    if (needle) list = entries.filter((e) => `${e.familyName} ${e.providerName} ${e.vendorName}`.toLowerCase().includes(needle));
    return list;
  }, [entries, q, shownTab]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" className="h-10 max-w-[320px] justify-start gap-2.5 rounded-xl px-2.5 font-medium" aria-label="Choose model">
          <Logo src={entry?.logo} name={entry?.vendorName || ""} size={26} className="rounded-lg" />
          <span className="truncate">{entry ? `${entry.familyName} · ${entry.providerName}` : "Choose a model"}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-60"><path d="M6 9l6 6 6-6" /></svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" sideOffset={10} className="w-[min(640px,calc(100vw-24px))] rounded-2xl p-0">
        <div className="space-y-3 border-b border-border p-3">
          <ScrollTabs
            aria-label="Model groups"
            value={q ? "all" : shownTab}
            onChange={(v) => { setTab(v); setQ(""); }}
            items={[...(hasRecommended ? [{ value: "recommended", label: "★ Recommended" }] : []), { value: "all", label: "All" }, ...vendors.map((v) => ({ value: v.name, label: v.name, icon: <Logo src={v.logo} name={v.name} size={20} className="rounded-md" /> }))]}
          />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models…" autoFocus />
        </div>
        <div className="max-h-[420px] overflow-y-auto custom-scrollbar p-2">
          {shown.length === 0 && <p className="p-6 text-center text-muted-foreground">No models found.</p>}
          {shown.map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => { onPick(e.key); setOpen(false); }}
              className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent", e.key === entry?.key && "bg-primary/10")}
            >
              <Logo src={e.logo} name={e.vendorName} size={40} />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate font-semibold", e.key === entry?.key && "text-primary")}>{e.familyName}</span>
                <span className="block truncate text-muted-foreground">{e.vendorName} · {e.providerName}{e.slots.length ? ` · ${e.slots.map((s) => ROLE_INFO[s.role].label.toLowerCase()).join(", ")}` : ""}</span>
              </span>
              {e.priceLabel && <span className="shrink-0 tabular-nums text-muted-foreground">{e.priceLabel}</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// A slot: its files and "+", which opens the shared picker (uploads,
// generations, liked, elements, or a new upload).
export function MediaSlot({ role, max, files, onPick, onRemove, uploading, apiKey, onError, onUploading, label }) {
  const [picker, setPicker] = useState(false);
  const info = label ? { ...ROLE_INFO[role], label } : ROLE_INFO[role];
  const full = files.length >= max;
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <span className="text-muted-foreground">{info.label}{max > 1 ? ` · ${files.length}/${max}` : ""}</span>
      <div className="flex gap-1.5">
        {files.map((f, i) => (
          <div key={`${f.url}-${i}`} className="group relative h-16 w-16 overflow-hidden rounded-xl border border-border bg-muted">
            {info.kind === "image" ? <img src={dzThumb(f.url, 256)} alt="" className="h-full w-full object-cover" />
              : info.kind === "video" ? <video src={f.url} className="h-full w-full object-cover" muted />
                : <span className="flex h-full items-center justify-center text-muted-foreground">♪</span>}
            <button type="button" onClick={() => onRemove(i)} aria-label="Remove" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        ))}
        {!full && (
          <button
            type="button"
            onClick={() => setPicker(true)}
            disabled={uploading}
            className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            aria-label={`Add ${info.label.toLowerCase()}`}
          >
            {uploading ? <Spinner className="h-5 w-5" /> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}
          </button>
        )}
      </div>
      <DzMediaPicker open={picker} onOpenChange={setPicker} accept={info.kind} max={Math.max(1, max - files.length)} apiKey={apiKey} onError={onError} onUploading={onUploading}
        title={`${info.label}${max > 1 ? ` · ${max - files.length} more` : ""}`} onPick={onPick} />
    </div>
  );
}

// Camera look: camera, lens, focal, aperture, filter (switch "Camera look"),
// plus era and light (on their own). The server writes them into the prompt
// in the chosen model's words; "Sent to the model" shows the result.
export function CameraPanel({ camera, setCamera, hints = [] }) {
  const d = lookData();
  const c = normalizeCamera(camera);
  const set = (k, v) => setCamera((prev) => ({ ...normalizeCamera(prev), [k]: v }));
  const Cards = ({ label, k, options }) => (
    <div className="space-y-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="grid grid-cols-3 gap-1.5">
        {options.map((o) => (
          <button key={o.id} type="button" onClick={() => set(k, o.id)} title={o.note || undefined}
            className={cn("flex flex-col items-start gap-0.5 rounded-xl border p-2 text-left leading-tight transition-colors", c[k] === o.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
            <span className="font-medium">{o.label}</span>
            {o.note && <span className="line-clamp-2 text-muted-foreground">{o.note}</span>}
          </button>
        ))}
      </div>
    </div>
  );
  const Chips = ({ label, k, options }) => (
    <div className="space-y-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => set(k, o.value)}
            className={cn("rounded-lg border px-2.5 py-1 tabular-nums transition-colors", c[k] === o.value ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{o.label}</button>
        ))}
      </div>
    </div>
  );
  const lens = d.lenses.find((l) => l.id === c.lens);
  const pick = (k, list, none) => (
    <Select value={c[k] || "none"} onValueChange={(v) => set(k, v === "none" ? null : v)}>
      <SelectTrigger className="h-10 w-full rounded-xl"><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-[320px]">
        <SelectItem value="none">{none}</SelectItem>
        {list.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  return (
    <div className="max-h-[60vh] space-y-4 overflow-y-auto custom-scrollbar pr-1">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1.5"><span className="text-muted-foreground">Era</span>{pick("era", d.eras, "Any")}</label>
        <label className="space-y-1.5"><span className="text-muted-foreground">Light</span>{pick("light", d.lights, "Any")}</label>
      </div>
      <label className="flex items-center justify-between gap-3">
        <span className="font-semibold">Camera look</span>
        <Switch checked={c.on} onCheckedChange={(v) => set("on", v)} />
      </label>
      <p className="text-muted-foreground">Camera, lens, focal length and aperture, written into the prompt the way the chosen model understands them.</p>
      {c.on && (
        <div className="space-y-4">
          <Cards label="Camera" k="camera" options={d.cameras} />
          <Cards label="Lens" k="lens" options={d.lenses} />
          <Chips label={`Focal length${lens?.focal ? ` · this lens is usually ${lens.focal[0]}–${lens.focal[1]} mm` : ""}`} k="focal" options={d.focals.map((f) => ({ value: f, label: `${f}mm` }))} />
          <Chips label="Aperture" k="aperture" options={d.apertures.map((f) => ({ value: f, label: f }))} />
        </div>
      )}
      {d.filters.map((f) => (
        <label key={f.id} className="flex items-center justify-between gap-3">
          <span><span className="font-medium">{f.label}</span> <span className="text-muted-foreground">· {f.note}</span></span>
          <Switch checked={c.filter === f.id} onCheckedChange={(v) => set("filter", v ? f.id : null)} />
        </label>
      ))}
      <DzHints hints={hints} />
    </div>
  );
}

export function ResultCard({ item, onUse, onReuse, onLike, onTrash, onOpen, sel }) {
  const isVideo = item.kind === "video";
  const isAudio = item.kind === "audio";
  const canUpscale = !isVideo && !isAudio && dzUpscaleSpec() && dzIsOwnImage(item.url);
  const canUpscaleVideo = isVideo && dzVideoUpscaleSpec() && dzIsOwnImage(item.url);
  const Icon = ({ title, onClick, children, danger }) => (
    <Tip text={title}>
      <button type="button" aria-label={title} onClick={(e) => { e.stopPropagation(); onClick(); }} className={cn("flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/65 text-white backdrop-blur-md transition-colors", danger ? "hover:bg-destructive" : "hover:bg-primary hover:text-primary-foreground")}>{children}</button>
    </Tip>
  );
  const on = sel?.has(item.id);
  return (
    <div className={cn("group relative overflow-hidden rounded-2xl border border-border bg-card", selectedRing(on))} {...(sel ? sel.dragProps(item) : {})}
      onClickCapture={(e) => { if (sel?.click(item, e)) e.stopPropagation(); }}>
      {sel && <SelectBox sel={sel} item={item} />}
      {item.url && item.studio === "upscale" && !sel?.selecting && <span className="pointer-events-none absolute left-2 top-2 z-[1] rounded-md bg-black/75 px-2 py-0.5 font-semibold text-white">Upscaled</span>}
      {!item.url ? <DzPendingTile status={item.status} error={item.error} label={item.studio === "upscale" ? "Upscaling" : "Generating"} className="aspect-square w-full"
        note={item.note} onCancel={item.cancellable ? () => dzLibrary.cancel(item.id).catch((e) => window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "error", title: "Cancel", message: String(e?.message || e) } }))) : undefined} />
        : (
          isAudio ? <DzAudioTile url={item.url} title={item.meta?.toolTitle || "Audio"} className="aspect-square w-full" /> : <button type="button" className="block w-full cursor-zoom-in" onClick={() => onOpen?.(item)} aria-label="Open">
            {isVideo ? <video src={item.url} poster={dzThumb(item.url)} className="aspect-square w-full bg-black object-cover" muted loop playsInline preload="none" onMouseOver={(e) => e.currentTarget.play().catch(() => {})} onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} controls={false} />
              : <img src={dzThumb(item.url)} alt={item.prompt?.slice(0, 60) || "Result"} loading="lazy" decoding="async" className="aspect-square w-full bg-black/40 object-cover" />}
          </button>
        )}
      {!item.url && item.status === "failed" && !sel?.selecting && (
        <div className="absolute right-2 top-2">
          <Icon title="Delete (move to trash)" danger onClick={() => onTrash(item.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg></Icon>
        </div>
      )}
      {item.url && !sel?.selecting && (
        <div className="absolute right-2 top-2 flex flex-col gap-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <DzLikeButton id={item.id} liked={item.liked} onChange={onLike} className="h-9 w-9" />
          {!isVideo && !isAudio && onUse && <Icon title="Animate — use as start frame of a video" onClick={() => onUse(item, "animate")}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></Icon>}
          {!isVideo && !isAudio && onUse && <Icon title="Use as reference" onClick={() => onUse(item, "reference")}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 12h8M12 8v8" /></svg></Icon>}
          {item.meta?.entryKey && onReuse && <Icon title="Reuse settings" onClick={() => onReuse(item)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></svg></Icon>}
          {canUpscaleVideo && <Icon title="Upscale video (1080p / 2K / 4K)" onClick={() => dzOpenVideoUpscale(item.url)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg></Icon>}
          {canUpscale && <Icon title="Upscale" onClick={() => dzOpenUpscale(item.url)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg></Icon>}
          <Icon title="Download" onClick={() => download(item.url)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg></Icon>
          {<Icon title={item.mine !== false ? "Move or copy to…" : "Copy to…"} onClick={() => window.dispatchEvent(new CustomEvent("dz:move", { detail: { items: [item], mode: item.mine !== false ? "move" : "copy" } }))}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v6M9 14l3 3 3-3" /></svg></Icon>}
          <Icon title="Move to trash" danger onClick={() => onTrash(item.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg></Icon>
        </div>
      )}
      <div className="space-y-1 px-3 py-2.5">
        {item.prompt && <p className="line-clamp-2 leading-snug text-foreground/85" title={item.prompt}>{item.meta?.prompt || item.prompt}</p>}
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="truncate">{item.author ? `${item.author} · ` : ""}{item.meta?.modelName || ""}</span>
          {Number.isFinite(item.cost_usd) && <span className="ml-auto shrink-0 tabular-nums">{fmtUsd(item.cost_usd)}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Studio ─────────────────────────────────────────────────────────────────

export default function DzCreateStudio({ apiKey, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError, droppedFiles, onFilesHandled, mode = "create" }) {
  const cfg = MODES[mode] || MODES.create;
  const fixedKind = mode === "image" || mode === "video" ? mode : null;
  const saved = useMemo(() => load(cfg.store), [cfg.store]);
  const [kindState, setKind] = useState(saved.kind === "video" ? "video" : "image");
  const kind = fixedKind || kindState;
  const [modelByKind, setModelByKind] = useState(saved.modelByKind || {});
  const [valuesByKind, setValuesByKind] = useState(saved.valuesByKind || { image: {}, video: {} });
  const [prompt, setPrompt] = useState(saved.prompt || "");
  const [camera, setCamera] = useState(() => normalizeCamera(saved.camera));
  const [move, setMove] = useState(saved.move || "");
  const [count, setCount] = useState(saved.count || 1); // ×1–4: same request, several results
  const [attached, setAttached] = useState(saved.attached || {});
  const [uploadingRole, setUploadingRole] = useState(null);
  const [elements, setElements] = useState(saved.elements || []); // chosen elements (Library or project)
  // Keep the chosen elements in step with what the user can see now (current
  // project + Library): fresh pictures, and none from a project they left or switched away from.
  const elementLists = useDzElements();
  useEffect(() => {
    if (!elementLists.loaded) return;
    const fresh = new Map([...elementLists.library, ...elementLists.project, ...(elementLists.others || [])].map((e) => [e.id, e]));
    setElements((prev) => {
      const next = prev.map((e) => fresh.get(e.id)).filter((e) => e && e.status !== "draft");
      return next.length === prev.length && next.every((e, i) => e === prev[i]) ? prev : next;
    });
  }, [elementLists]);
  const [uploads, setUploads] = useState(0); // files still uploading — Generate waits for them
  // "Use in Create" on the Elements page adds the element here (Create tab only),
  // within the current model's limit — or says why not.
  const elementMaxRef = useRef(7);
  useEffect(() => {
    if (mode !== "create") return undefined;
    const on = (e) => {
      const el = e.detail;
      if (!el?.id || el.status === "draft") return;
      setElements((list) => {
        if (list.some((x) => x.id === el.id)) return list;
        if (list.length >= elementMaxRef.current) {
          setTimeout(() => window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "error", title: "Elements", message: `This model takes up to ${elementMaxRef.current} elements — remove one to add ${el.name}.` } })), 0);
          return list;
        }
        return [...list, el];
      });
    };
    window.addEventListener("dz:use-element", on);
    return () => window.removeEventListener("dz:use-element", on);
  }, [mode]);
  const [busy, setBusy] = useState(0);
  const [drawOpen, setDrawOpen] = useState(false);
  const promptRef = useRef(null);
  const attachedRef = useRef(attached);
  attachedRef.current = attached;

  // The catalog script is loaded with the page; read it on the client only.
  const [catalogReady, setCatalogReady] = useState(false);
  useEffect(() => { setCatalogReady(true); }, []);
  const entries = useMemo(() => (catalogReady ? createEntries(kind) : []), [kind, catalogReady]);
  const entry = entries.find((e) => e.key === modelByKind[kind]) || entries[0] || null;
  const storedValues = valuesByKind[kind] || {};

  useEffect(() => {
    try { localStorage.setItem(cfg.store, JSON.stringify({ kind, modelByKind, valuesByKind, prompt, camera, move, attached, elements, count })); } catch { /* optional */ }
  }, [cfg.store, kind, modelByKind, valuesByKind, prompt, camera, move, attached, elements, count]);

  // Only the slots this model has; other attached files are kept but not sent.
  const slotRoles = new Set((entry?.slots || []).map((s) => s.role));
  const used = Object.fromEntries(Object.entries(attached).filter(([role, files]) => slotRoles.has(role) && files?.length));
  const unusedCount = Object.entries(attached).filter(([role]) => !slotRoles.has(role)).reduce((n, [, f]) => n + (f?.length || 0), 0);
  // Elements: natively (Kling `elements`) or as extra reference files.
  const nativeElements = entryTakesElements(entry);
  const canUseElements = Boolean(entry && (nativeElements || entry.slots.some((sl) => sl.role === "reference" || sl.role === "video")));
  const activeElements = canUseElements ? elements : [];
  const merged = entry ? mergeElements(entry, used, activeElements) : { attached: used, native: false };
  const variant = entry ? chooseVariant(entry, merged.attached, { native: merged.native }) : null;
  const elementSpec = variant ? elementsInputOf(variant.model) : null;
  // What actually goes into the request: Kling subjects, or element files among the references.
  const elementPairs = elementSpec ? klingElementPairs(activeElements, elementSpec) : [];
  const elementFilesUsed = !elementSpec && Object.values(merged.attached).some((files) => (files || []).some((f) => f.element));
  const elementsUsed = elementPairs.length > 0 || elementFilesUsed;
  const elementMax = elementSpec?.maxItems || (nativeElements ? (entry.variants.map((v) => elementsInputOf(v.model)?.maxItems || 0).reduce((a, b) => Math.max(a, b), 0) || 7) : 7);
  elementMaxRef.current = elementMax;
  const params = variant ? paramsOf(variant.model) : { main: [], advanced: [] };
  // Only values this endpoint accepts (attaching files can switch the endpoint).
  const values = variant ? keepValues(storedValues, variant) : storedValues;
  const syntax = variant ? refSyntaxFor(variant.model) : null;
  const missing = entry && !variant ? "This model can't take these files together. Remove some or pick another model." : missingFor(variant, merged.attached);
  // Our tags (@img1, @char_mike) → this model's own words, then Camera.
  const tags = promptTags({ attached: merged.attached, syntax, elements: activeElements, elementPairs, variant });
  // Native elements beyond what the chosen endpoint takes are left out — say so.
  const nativeDropped = elementSpec ? activeElements.filter((e) => !elementPairs.some((p) => p.element.id === e.id)).map((e) => e.name) : [];
  const trimmed = merged.trimmed || (nativeDropped.length ? { dropped: nativeDropped, cut: 0 } : null);
  const finalPrompt = composePrompt(translateTags(prompt, tags));
  // The look goes to the server, which writes it into the prompt for this model.
  const look = useMemo(() => lookOf(camera, kind === "video" ? move : ""), [camera, kind, move]);
  const usedTags = useMemo(() => {
    const names = new Set([...String(prompt).matchAll(TAG_RE)].map((m) => m[2].toLowerCase()));
    return tags.filter((t) => names.has(t.tag.toLowerCase()));
  }, [prompt, tags]);
  const jsonPrompt = useMemo(() => parseJsonPrompt(prompt), [prompt]);
  // What "Adapt to model" needs to know: the model, what's attached, the settings.
  const adaptModel = entry ? { family: entry.family, name: entry.familyName, kind } : null;
  const adaptContext = useMemo(() => {
    const a = merged.attached || {};
    const has = (r) => (a[r] || []).length > 0;
    const mode = kind === "video"
      ? (has("first") ? `image-to-video (start frame${has("last") ? " and end frame" : ""} attached)` : has("source") ? "video editing" : has("reference") || has("video") || elementsUsed ? "reference-to-video" : "text-to-video")
      : (has("reference") || elementsUsed ? "image with reference images / editing" : "text-to-image");
    const audio = [values.generate_audio, values.audio, values.sound, values.enable_audio].find((v) => typeof v === "boolean");
    const moveLabel = kind === "video" && move ? lookData().moves.find((m) => m.id === move)?.label : "";
    const cameraText = [lookLabel(camera), moveLabel ? `move: ${moveLabel}` : ""].filter(Boolean).join(", ");
    return {
      mode, duration: values.duration, aspect: values.aspect_ratio || values.ratio, audio,
      camera: cameraText || undefined,
      tags: tags.map((t) => ({ tag: t.tag, label: `${t.label || t.kind}${t.to ? ` (sent to the model as ${t.to})` : ""}` })),
    };
  }, [merged.attached, kind, values, camera, move, tags, elementsUsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsPrompt = variant?.model.promptRequired;
  const canRun = Boolean(variant && !missing && !uploads && (!needsPrompt || prompt.trim()) && (prompt.trim() || Object.keys(merged.attached).length || elementsUsed));
  const body = variant && canRun ? buildBody(variant, { prompt: finalPrompt, values, attached: merged.attached, elements: elementSpec ? activeElements : [] }) : null;
  // The price shows as soon as the model and files are set — not only after the prompt is typed.
  const quoteBody = body || (variant && !missing && !uploads ? buildBody(variant, { prompt: finalPrompt || "price check", values, attached: merged.attached, elements: elementSpec ? activeElements : [] }) : null);
  const { price, loading: priceLoading } = useDzQuote(apiKey, () => (quoteBody ? [dzGenerate, { endpoint: variant.model.endpoint, ...quoteBody }] : null));
  // The server's view (hints on unusual camera combos; the drawer shows the final prompt).
  const [sentOpen, setSentOpen] = useState(false);
  const sentPreview = useDzPromptPreview({ endpoint: variant?.model.endpoint, body: quoteBody ? { ...quoteBody, prompt: "" } : null, look, enabled: Boolean(variant && look && !sentOpen) });

  // The side chat sees which model is open here and the prompt; it can put text into the prompt.
  useEffect(() => {
    dzSetStudioState(mode, { model: entry ? { family: entry.family, name: entry.familyName, kind } : null, prompt });
  }, [mode, entry, kind, prompt]);
  useEffect(() => {
    const on = (e) => {
      const { tab, text, how } = e.detail || {};
      if (tab !== mode || typeof text !== "string" || !text.trim()) return;
      setPrompt((p) => (how === "replace" || !p.trim() ? text.trim() : `${p.replace(/\s+$/, "")}\n\n${text.trim()}`));
      requestAnimationFrame(() => promptRef.current?.focus());
    };
    window.addEventListener(DZ_INSERT_EVENT, on);
    return () => window.removeEventListener(DZ_INSERT_EVENT, on);
  }, [mode]);

  const setValue = (key, v) => setValuesByKind((prev) => ({ ...prev, [kind]: { ...(prev[kind] || {}), [key]: v } }));
  const pickModel = (key) => {
    setModelByKind((prev) => ({ ...prev, [kind]: key }));
    const next = entries.find((e) => e.key === key);
    const nextVariant = next ? chooseVariant(next, {}) || next.variants[0] : null;
    setValuesByKind((prev) => ({ ...prev, [kind]: keepValues(prev[kind] || {}, nextVariant) }));
  };

  // The current context: a project (and folder), or personal work only.
  const ctx = useDzContext();
  // Everything of this kind in the current place, whatever tool made it
  // (Image shows upscales and Draw to Edit too; Create shows all).
  // Create shows both kinds (with a filter); Image and Video their own.
  const [kindFilter, setKindFilter] = useState("all");
  const [viewing, setViewing] = useState(null); // a result opened in the viewer
  const showKind = mode === "image" ? "image" : mode === "video" ? "video" : kindFilter === "all" ? null : kindFilter;
  const history = useDzHistory({ ...(showKind ? { kind: showKind } : {}), ...(ctx.project ? { project: ctx.project.id, folder: ctx.folder || undefined } : { project: "none" }) });
  const sel = useDzSelection(history.items);

  const addFiles = useCallback(async (role, files) => {
    const info = ROLE_INFO[role];
    const slot = entry?.slots.find((s) => s.role === role);
    if (!slot) return;
    const room = slot.max - (attached[role]?.length || 0);
    const list = files.filter((f) => f.type.startsWith(`${info.kind}/`)).slice(0, Math.max(0, room));
    if (!list.length) { onGenerationError?.(`Choose ${info.kind} files for “${info.label}”.`); return; }
    setUploadingRole(role);
    setUploads((n) => n + 1);
    try {
      for (const f of list) {
        const url = await uploadFile(apiKey, f);
        setAttached((prev) => ({ ...prev, [role]: [...(prev[role] || []), { url, name: f.name }].slice(0, slot.max) }));
      }
    } catch (e) {
      onGenerationError?.(String(e?.message || e));
    } finally {
      setUploads((n) => n - 1);
      setUploadingRole((r) => (r === role ? null : r));
    }
  }, [apiKey, attached, entry, onGenerationError]);

  // Files dropped anywhere on the page.
  useEffect(() => {
    if (!droppedFiles?.length || !entry) return;
    const files = [...droppedFiles];
    onFilesHandled?.();
    const has = (r) => entry.slots.some((s) => s.role === r);
    const images = files.filter((f) => f.type.startsWith("image/"));
    const videos = files.filter((f) => f.type.startsWith("video/"));
    if (images.length) addFiles(kind === "video" && has("first") && !(attached.first || []).length ? "first" : has("reference") ? "reference" : "first", images);
    if (videos.length) addFiles(has("video") ? "video" : "source", videos);
  }, [droppedFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Files chosen in the picker (already on our server).
  const addUrls = (role, list) => {
    const slot = entry?.slots.find((s) => s.role === role);
    if (!slot) return;
    setAttached((prev) => {
      const have = prev[role] || [];
      const add = list.filter((x) => !have.some((h) => h.url === x.url)).map((x) => ({ url: x.url, name: x.name || "" }));
      return { ...prev, [role]: [...have, ...add].slice(0, slot.max) };
    });
  };
  const removeFile = (role, i) => setAttached((prev) => ({ ...prev, [role]: (prev[role] || []).filter((_, j) => j !== i) }));

  const insertAtCursor = (text) => {
    const el = promptRef.current;
    if (!el) { setPrompt((p) => `${p}${p && !p.endsWith(" ") ? " " : ""}${text} `); return; }
    const start = el.selectionStart ?? prompt.length;
    const end = el.selectionEnd ?? prompt.length;
    const before = prompt.slice(0, start);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}${text} ${prompt.slice(end)}`;
    setPrompt(next);
    requestAnimationFrame(() => { el.focus(); const pos = before.length + pad.length + text.length + 1; el.setSelectionRange(pos, pos); });
  };

  const generate = useCallback(async () => {
    if (!canRun || !variant) return;
    const meta = {
      kind,
      entryKey: entry.key,
      modelName: `${entry.familyName} · ${entry.providerName}`,
      prompt,
      values,
      camera,
      move: kind === "video" ? move : "",
      attached: used,
      elements: (elementSpec ? elementPairs.map((p) => p.element) : elementsUsed ? activeElements : []).map((e) => ({ id: e.id, name: e.name })),
    };
    const request = { endpoint: variant.model.endpoint, ...body };
    // ×N: the same request N times, each its own job and result card.
    const one = async () => {
      setBusy((n) => n + 1);
      onGenerationStart?.();
      try {
        const res = await dzWithMeta({ studio: mode, meta, look }, () => dzGenerate(apiKey, request));
        onGenerationEnd?.();
        if (res?.url) onGenerationComplete?.({ url: res.url, type: kind });
      } catch (e) {
        onGenerationEnd?.();
        onGenerationError?.(String(e?.message || e).replace(/^API Request Failed: \d+ [^-]*- /, ""));
      } finally {
        setBusy((n) => n - 1);
      }
    };
    await Promise.all(Array.from({ length: count }, one));
  }, [canRun, variant, kind, entry, prompt, values, camera, move, look, used, body, count, apiKey, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError]);

  const applyResult = (item, how) => {
    if (how === "animate" && fixedKind === "image") {
      // The Image tab hands the picture to the Video tab.
      window.dispatchEvent(new CustomEvent(DZ_SEND_EVENT, { detail: { to: "video", url: item.url } }));
      return;
    }
    if (how === "animate") {
      const next = animateInto(createEntries("video"), modelByKind.video, attached, item.url);
      setKind("video");
      if (next.modelKey !== modelByKind.video) setModelByKind((prev) => ({ ...prev, video: next.modelKey }));
      setAttached(next.attached);
      return;
    }
    setAttached((prev) => ({ ...prev, reference: [...(prev.reference || []), { url: item.url, name: "result" }] }));
  };
  // Video tab: take a picture sent from the Image tab (Animate).
  useEffect(() => {
    if (mode !== "video") return undefined;
    const onSend = (e) => {
      const { to, url } = e.detail || {};
      if (to !== "video" || typeof url !== "string") return;
      const next = animateInto(entries, entry?.key, attachedRef.current, url);
      if (next.modelKey && next.modelKey !== entry?.key) setModelByKind((prev) => ({ ...prev, video: next.modelKey }));
      setAttached(next.attached);
    };
    window.addEventListener(DZ_SEND_EVENT, onSend);
    return () => window.removeEventListener(DZ_SEND_EVENT, onSend);
  }, [mode, entry, entries]);

  const reuse = (item) => {
    const m = item.meta || {};
    if (m.kind && !fixedKind) setKind(m.kind);
    if (fixedKind && m.kind && m.kind !== fixedKind) return;
    if (m.entryKey) setModelByKind((prev) => ({ ...prev, [m.kind || kind]: m.entryKey }));
    if (m.values) setValuesByKind((prev) => ({ ...prev, [m.kind || kind]: cleanValues(m.values) }));
    if (typeof m.prompt === "string") setPrompt(m.prompt);
    if (m.camera) setCamera(normalizeCamera(m.camera));
    setMove(m.move || "");
    if (isObj(m.attached)) setAttached(normalizeSaved({ attached: m.attached }).attached || {});
  };

  // Typing "@": our tags for what is attached and chosen, plus every element
  // the user can add (picking one adds it). Arrow keys, Enter/Tab, Esc.
  const [mention, setMention] = useState(null); // { start, query, index }
  const mentionOptions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const chosenIds = new Set(elements.map((e) => e.id));
    // Every element the user can use here (this project + Library; in the
    // Library also every project's). One that can't go in says why.
    const candidates = [...elementLists.project, ...elementLists.library, ...(elementLists.others || [])]
      .filter((e, i, all) => !chosenIds.has(e.id) && all.findIndex((x) => x.id === e.id) === i && e.status !== "draft");
    const takesPics = entry?.slots.some((s) => s.role === "reference") || entryTakesElements(entry);
    const takesVideo = entry?.slots.some((s) => s.role === "video") || entryTakesElements(entry);
    const whyNot = (e) => {
      if (!canUseElements || (!takesPics && !takesVideo)) return "this model takes no reference files";
      if (!elementFits(entry, e)) return (e.images || []).length ? "this model takes no pictures here" : "it has no pictures, and this model takes no videos";
      return elements.length >= elementMax ? `this model takes up to ${elementMax} elements` : null;
    };
    // Each candidate's tag as it will be once added (next to the chosen ones only).
    const tagIfAdded = (e) => elementTags([...activeElements, e]).get(e.id);
    const list = [
      ...tags.map((t) => ({ ...t, add: false })),
      ...candidates.map((e) => ({ tag: tagIfAdded(e), label: e.project_name ? `${e.name} · ${e.project_name}` : e.name, kind: "element", element: e, url: e.images?.[0] || null, add: true, disabled: whyNot(e) })),
    ];
    return list.filter((o) => !q || o.tag.toLowerCase().includes(q) || String(o.label || "").toLowerCase().includes(q))
      .sort((a, b) => Number(Boolean(a.disabled)) - Number(Boolean(b.disabled))).slice(0, 10);
  }, [mention, tags, elements, elementLists, canUseElements, elementMax, activeElements, entry]);
  const readMention = (el) => {
    const pos = el.selectionStart ?? 0;
    const m = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_]*)$/u.exec(el.value.slice(0, pos));
    setMention(m ? { start: pos - m[2].length - 1, query: m[2], index: 0 } : null);
  };
  const pickMention = (o) => {
    const el = promptRef.current;
    if (!mention || !el || o.disabled) return;
    const end = el.selectionStart ?? prompt.length;
    const text = `@${o.tag} `;
    const next = `${prompt.slice(0, mention.start)}${text}${prompt.slice(end).replace(/^\s+/, "")}`;
    setPrompt(next);
    if (o.add && o.element) setElements((list) => (list.some((x) => x.id === o.element.id) || list.length >= elementMax ? list : [...list, o.element]));
    setMention(null);
    requestAnimationFrame(() => { el.focus(); const p = mention.start + text.length; el.setSelectionRange(p, p); });
  };
  const onPromptKey = (e) => {
    if (mention && mentionOptions.some((o) => !o.disabled)) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index + 1) % mentionOptions.length })); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index - 1 + mentionOptions.length) % mentionOptions.length })); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const o = mentionOptions[Math.min(mention.index, mentionOptions.length - 1)]; pickMention(o.disabled ? mentionOptions.find((x) => !x.disabled) : o); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); }
  };

  const items = history.items;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Where you are + Select; while choosing, what to do with the chosen */}
      <div className="flex-shrink-0 px-4 pt-3 md:px-8">
        <div className="mx-auto max-w-[1600px]">
          <GridToolbar ctx={ctx} sel={sel} title={cfg.title} canSelect={items.length > 0}>
            {mode === "create" && (
              <Segmented value={kindFilter} onChange={setKindFilter} size="sm" className="w-auto" aria-label="Show"
                options={[{ value: "all", label: "All" }, { value: "image", label: "Images" }, { value: "video", label: "Videos" }]} />
            )}
          </GridToolbar>
        </div>
      </div>
      {/* Results */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-6 pt-3 md:px-8">
        {history.loaded && items.length === 0 ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-3 text-center">
            <div className="text-3xl font-bold text-foreground">{cfg.title}</div>
            <p className="text-lg text-muted-foreground">{cfg.text}</p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1600px] grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {items.map((item) => (
              <ResultCard key={item.id} item={item} sel={sel} onOpen={setViewing} onUse={applyResult} onReuse={reuse} onLike={history.like} onTrash={(id) => history.trash(id).catch((e) => onGenerationError?.(String(e?.message || e)))} />
            ))}
          </div>
        )}
        {history.hasMore && (
          <div className="flex justify-center py-6"><Button variant="secondary" onClick={history.loadMore} disabled={history.loadingMore}>{history.loadingMore ? "Loading…" : "Load more"}</Button></div>
        )}
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-border bg-card/80 px-3 pb-3 pt-3 backdrop-blur md:px-6">
        <div className="mx-auto max-w-[1100px] space-y-3">
          {entry && entry.slots.length > 0 && (
            <div className="flex gap-4 overflow-x-auto custom-scrollbar pb-1">
              {entry.slots.map((s) => (
                <MediaSlot key={s.role} role={s.role} max={s.max} files={attached[s.role] || []} uploading={uploadingRole === s.role} apiKey={apiKey} onError={onGenerationError} onUploading={(on) => setUploads((n) => Math.max(0, n + (on ? 1 : -1)))}
                  onPick={(list) => addUrls(s.role, list)} onRemove={(i) => removeFile(s.role, i)} />
              ))}
            </div>
          )}
          {elements.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Elements:</span>
              {elements.map((e) => (
                <span key={e.id} className={cn("flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2", !canUseElements && "opacity-50")}>
                  {e.images?.[0] ? <img src={e.images[0]} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="h-6 w-6 rounded-full bg-muted" />}
                  <span className="font-medium">{e.name}</span>
                  <button type="button" aria-label={`Remove ${e.name}`} onClick={() => setElements((list) => list.filter((x) => x.id !== e.id))} className="text-muted-foreground hover:text-foreground">✕</button>
                </span>
              ))}
              {!canUseElements && <span className="text-amber-300">This model takes no references — elements are not used.</span>}
            </div>
          )}
          {unusedCount > 0 && <p className="text-muted-foreground">{unusedCount} attached file{unusedCount > 1 ? "s are" : " is"} not used by this model.</p>}

          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">In the prompt (or type @):</span>
              {tags.map((t) => (
                <button key={t.tag} type="button" onClick={() => insertAtCursor(`@${t.tag}`)} title={`Sent to this model as ${t.to}`}
                  className={cn("flex items-center gap-1.5 rounded-lg bg-primary/15 py-1 pl-1 pr-2.5 font-semibold text-primary transition-colors hover:bg-primary/20", !t.url && "pl-2.5", t.unused && "opacity-60")}>
                  {t.url && <img src={t.url} alt="" className="h-6 w-6 rounded object-cover" />}
                  {t.kind === "element" && <span className="font-normal text-foreground/80">{t.label}</span>}@{t.tag}
                </button>
              ))}
            </div>
          )}
          {trimmed && (
            <p className="text-amber-300">
              Not everything fits this model{trimmed.dropped.length ? `: left out ${trimmed.dropped.join(", ")}` : ""}{trimmed.cut ? `${trimmed.dropped.length ? ";" : ":"} ${trimmed.cut} element picture${trimmed.cut === 1 ? "" : "s"} not sent` : ""}. Remove some files or elements, or pick a model with more slots.
            </p>
          )}

          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); readMention(e.target); }}
            onKeyDown={onPromptKey}
            onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) readMention(e.target); }}
            onClick={(e) => readMention(e.target)}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            rows={jsonPrompt.json ? 8 : 3}
            spellCheck={!jsonPrompt.json}
            placeholder={kind === "video" ? "Describe the shot: subject, action, mood… (plain text or JSON)" : "Describe the image… (plain text or JSON)"}
            className={cn("min-h-[88px] max-h-[45vh] resize-y rounded-2xl text-base", jsonPrompt.json && "font-mono")}
          />
          {mention && mentionOptions.length === 0 && (
            <div className="rounded-xl border border-border bg-popover px-3 py-2 text-muted-foreground">
              {mention.query ? `Nothing called “${mention.query}”.` : "Nothing to tag yet."} Attach files with “+” (they become @image1, @image2…) or make elements on the Elements page.
            </div>
          )}
          {mention && mentionOptions.length > 0 && (
            <div role="listbox" aria-label="Tags" className="max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl">
              {mentionOptions.map((o, i) => (
                <button key={`${o.tag}-${o.add}-${o.element?.id || ""}`} type="button" role="option" aria-selected={i === mention.index} aria-disabled={Boolean(o.disabled)}
                  onMouseDown={(e) => { e.preventDefault(); pickMention(o); }} title={o.disabled ? `Can't add: ${o.disabled}` : undefined}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left", o.disabled ? "cursor-not-allowed opacity-50" : i === mention.index ? "bg-accent" : "hover:bg-accent/60")}>
                  {o.url ? <img src={o.url} alt="" className="h-8 w-8 rounded-md object-cover" /> : <span className="h-8 w-8 rounded-md bg-muted" />}
                  <span className="font-semibold text-primary">@{o.tag}</span>
                  <span className="truncate text-muted-foreground">{o.label}{o.disabled ? ` · ${o.disabled}` : o.add ? " · add element" : ""}</span>
                  {!o.add && o.to && <span className="ml-auto shrink-0 text-muted-foreground">→ {o.to}</span>}
                </button>
              ))}
            </div>
          )}
          {usedTags.length > 0 && (
            <p className="text-muted-foreground">
              This model gets: {usedTags.map((t) => `@${t.tag} → ${t.to}`).join(" · ")}
            </p>
          )}
          <DzHints hints={sentPreview.data?.hints || []} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {variant && <Button variant="ghost" size="sm" onClick={() => setSentOpen(true)}>Sent to the model</Button>}
            {adaptModel && prompt.trim() && (
              <DzAdaptButton prompt={prompt} model={adaptModel} context={adaptContext} look={look}
                request={variant ? { endpoint: variant.model.endpoint, body: quoteBody ? { ...quoteBody } : null } : null}
                onUse={(p) => setPrompt(p)} />
            )}
          </div>
          {jsonPrompt.json && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {jsonPrompt.ok ? (
                <>
                  <span className="text-emerald-300">JSON prompt — sent as written{camera.on || (kind === "video" && move) ? (Array.isArray(jsonPrompt.value) ? "; Camera is not added to a JSON list" : "; Camera is added as its own keys") : ""}.</span>
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setPrompt(JSON.stringify(jsonPrompt.value, null, 2))}>Format</button>
                </>
              ) : (
                <span className="text-amber-300">Looks like JSON but has an error: {jsonPrompt.error}. It will be sent as plain text.</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!fixedKind && <Segmented className="w-auto" value={kind} onChange={setKind} aria-label="Image or video" options={[{ value: "image", label: "Image" }, { value: "video", label: "Video" }]} />}
            <ModelPicker entries={entries} entry={entry} onPick={pickModel} />
            {params.main.map((p) => <ParamControl key={p.key} p={p} value={values[p.key]} onChange={(v) => setValue(p.key, v)} compact />)}

            {kind === "video" && (
              <Select value={move || "none"} onValueChange={(v) => setMove(v === "none" ? "" : v)}>
                <SelectTrigger aria-label="Camera move" className="h-10 w-auto gap-2 rounded-xl border-transparent bg-muted px-3">
                  <span className="text-muted-foreground">Move:</span><SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[360px]">
                  <SelectItem value="none">None</SelectItem>
                  {lookData().moves.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <Button variant={look && (camera.on || camera.era || camera.light || camera.filter) ? "default" : "secondary"} className="h-10 max-w-[280px] rounded-xl px-3 font-medium"><span className="truncate">Camera{lookLabel(camera) ? ` · ${lookLabel(camera)}` : ""}</span></Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-[min(440px,calc(100vw-24px))] rounded-2xl"><CameraPanel camera={camera} setCamera={setCamera} hints={sentPreview.data?.hints || []} /></PopoverContent>
            </Popover>

            {canUseElements ? (
              <ElementPicker selected={elements} onChange={setElements} max={elementMax}
                note={nativeElements ? "This model takes elements directly (name, pictures, video)." : "Their pictures go in as references."} />
            ) : entry && (
              <Tip text={`${entry.familyName} at ${entry.providerName} takes no reference pictures, so elements can't be used. ${entry.familyName} at another provider may — check the model list.`}>
                <span><Button variant="secondary" className="h-10 rounded-xl px-3 font-medium" disabled>Elements</Button></span>
              </Tip>
            )}
            {kind === "image" && (
              <Button variant="secondary" className="h-10 rounded-xl px-3 font-medium" onClick={() => setDrawOpen(true)}>Draw to Edit</Button>
            )}

            {params.advanced.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary" className="h-10 rounded-xl px-3 font-medium">Advanced</Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="max-h-[60vh] w-[min(400px,calc(100vw-24px))] space-y-3 overflow-y-auto custom-scrollbar rounded-2xl">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Advanced settings</span>
                    <Button size="sm" variant="ghost" onClick={() => setValuesByKind((prev) => {
                      const next = { ...(prev[kind] || {}) };
                      for (const p of params.advanced) delete next[p.key];
                      return { ...prev, [kind]: next };
                    })}>Reset</Button>
                  </div>
                  {params.advanced.map((p) => <ParamControl key={p.key} p={p} value={values[p.key]} onChange={(v) => setValue(p.key, v)} />)}
                </PopoverContent>
              </Popover>
            )}

            <div className="ml-auto flex items-center gap-3">
              <Tip text="How many results to make with one click (separate jobs, each paid)">
                <span><Segmented value={count} onChange={setCount} size="sm" className="w-auto" aria-label="How many"
                  options={[1, 2, 3, 4].map((n) => ({ value: n, label: `×${n}` }))} /></span>
              </Tip>
              <span className={cn("tabular-nums", priceLoading ? "text-muted-foreground/60" : "text-muted-foreground")} title={price ? (price.exact ? "Exact price for your account" : "Estimate") : undefined}>
                {price ? `${price.exact ? "" : "≈ "}${fmtUsd(price.usd * count)}${count > 1 ? ` (${count} × ${fmtUsd(price.usd)})` : ""}` : entry?.priceLabel ? `${count > 1 ? `${count} × ` : ""}${entry.priceLabel}` : ""}
              </span>
              <Button size="lg" className="h-11 rounded-xl px-6" onClick={generate} disabled={!canRun}>
                {busy > 0 ? <><Spinner className="h-4 w-4 border-primary-foreground/30 border-t-primary-foreground" /> Generating{busy > 1 ? ` · ${busy}` : ""}</> : "Generate"}
              </Button>
            </div>
          </div>
          {missing && <p className="text-amber-300">{missing}</p>}
        </div>
      </div>
      <DrawModal isOpen={drawOpen} onClose={() => setDrawOpen(false)} apiKey={apiKey} batchSize={1} studio={mode} onError={onGenerationError} onDone={() => window.dispatchEvent(new CustomEvent("dz:history", { detail: { studio: mode } }))} />
      <Viewer item={viewing} onClose={() => setViewing(null)} />
      <DzSentPanel open={sentOpen} onOpenChange={setSentOpen}
        requests={variant ? [{ endpoint: variant.model.endpoint, body: quoteBody || buildBody(variant, { prompt: finalPrompt, values, attached: merged.attached, elements: elementSpec ? activeElements : [] }), look, problem: missing || null }] : []} />
    </div>
  );
}
