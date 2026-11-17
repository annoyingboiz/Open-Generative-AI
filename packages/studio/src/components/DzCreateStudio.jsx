"use client";

// DZ: Create — the one studio. Image | Video, every model of every provider,
// and an interface drawn from what the chosen model accepts at that provider
// (see dzCreate.js): media slots, @ references, main settings, Advanced,
// camera look and camera moves, price before you press Generate. History
// comes from the server Library.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dzGenerate, dzWithMeta, uploadFile } from "../api.js";
import { useDzQuote } from "./DzPrice.jsx";
import { useDzHistory } from "../dzLibrary.js";
import { useDzContext } from "../dzContext.js";
import { dzOpenUpscale, dzUpscaleSpec, dzIsOwnImage } from "../dzCatalog.js";
import DzLikeButton, { DzPendingTile } from "./DzLikeButton.jsx";
import DrawModal from "./DrawModal.jsx";
import { ElementPicker } from "./DzElements.jsx";
import {
  createEntries, chooseVariant, missingFor, buildBody, keepValues, paramsOf, refSyntaxFor, composePrompt,
  mergeElements, elementsInputOf, entryTakesElements,
  ROLE_INFO, CAMERA, LENS, FOCAL, APERTURE, CAMERA_ASSETS, CAMERA_MOVES, DEFAULT_CAMERA,
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
const fmtUsd = (usd) => `$${usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
const ACCEPT = { image: "image/png,image/jpeg,image/webp", video: "video/mp4,video/quicktime,video/webm", audio: "audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" };

async function download(url) {
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
  return String(v);
};

// ── Small controls ─────────────────────────────────────────────────────────

function ParamControl({ p, value, onChange, compact }) {
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
      {p.key.includes("prompt") ? (
        <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={p.default || ""} />
      ) : (
        <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={p.default != null ? String(p.default) : ""} />
      )}
    </div>
  );
}

function ModelPicker({ entries, entry, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("recommended");
  const vendors = useMemo(() => {
    const seen = new Map();
    for (const e of entries) if (!seen.has(e.vendorName)) seen.set(e.vendorName, e.vendorLogo);
    return [...seen.entries()].map(([name, logo]) => ({ name, logo }));
  }, [entries]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = entries;
    if (tab === "recommended") list = entries.filter((e) => e.recommended != null);
    else if (tab !== "all") list = entries.filter((e) => e.vendorName === tab);
    if (needle) list = entries.filter((e) => `${e.familyName} ${e.providerName} ${e.vendorName}`.toLowerCase().includes(needle));
    return list;
  }, [entries, q, tab]);
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
            value={q ? "all" : tab}
            onChange={(v) => { setTab(v); setQ(""); }}
            items={[{ value: "recommended", label: "★ Recommended" }, { value: "all", label: "All" }, ...vendors.map((v) => ({ value: v.name, label: v.name, icon: <Logo src={v.logo} name={v.name} size={20} className="rounded-md" /> }))]}
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

function MediaSlot({ role, max, files, onAdd, onRemove, uploading }) {
  const input = useRef(null);
  const info = ROLE_INFO[role];
  const full = files.length >= max;
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <span className="text-muted-foreground">{info.label}{max > 1 ? ` · ${files.length}/${max}` : ""}</span>
      <div className="flex gap-1.5">
        {files.map((f, i) => (
          <div key={`${f.url}-${i}`} className="group relative h-16 w-16 overflow-hidden rounded-xl border border-border bg-muted">
            {info.kind === "image" ? <img src={f.url} alt="" className="h-full w-full object-cover" />
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
            onClick={() => input.current?.click()}
            disabled={uploading}
            className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            aria-label={`Add ${info.label.toLowerCase()}`}
          >
            {uploading ? <Spinner className="h-5 w-5" /> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept={ACCEPT[info.kind]} multiple={max > 1} className="hidden" onChange={(e) => { onAdd([...(e.target.files || [])]); e.target.value = ""; }} />
    </div>
  );
}

function CameraPanel({ camera, setCamera }) {
  const set = (k, v) => setCamera((c) => ({ ...c, [k]: v }));
  const Pick = ({ label, k, options, assets }) => (
    <div className="space-y-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="grid grid-cols-3 gap-1.5">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => set(k, o)} className={cn("flex flex-col items-center gap-1 rounded-xl border p-1.5 text-center leading-tight transition-colors", camera[k] === o ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
            {assets?.[o] && <img src={assets[o]} alt="" className="h-12 w-full rounded-lg object-cover" />}
            <span className="line-clamp-2">{k === "focal" ? `${o}mm` : o}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-3">
        <span className="font-semibold">Camera look</span>
        <Switch checked={camera.on} onCheckedChange={(v) => set("on", v)} />
      </label>
      <p className="text-muted-foreground">Adds the camera, lens, focal length and aperture to the prompt.</p>
      {camera.on && (
        <div className="max-h-[50vh] space-y-4 overflow-y-auto custom-scrollbar pr-1">
          <Pick label="Camera" k="camera" options={Object.keys(CAMERA)} assets={CAMERA_ASSETS} />
          <Pick label="Lens" k="lens" options={Object.keys(LENS)} assets={CAMERA_ASSETS} />
          <Pick label="Focal length" k="focal" options={Object.keys(FOCAL).map(Number)} />
          <Pick label="Aperture" k="aperture" options={Object.keys(APERTURE)} />
        </div>
      )}
    </div>
  );
}

function ResultCard({ item, onUse, onReuse, onLike, onTrash }) {
  const isVideo = item.kind === "video";
  const canUpscale = !isVideo && dzUpscaleSpec() && dzIsOwnImage(item.url);
  const Icon = ({ title, onClick, children, danger }) => (
    <Tip text={title}>
      <button type="button" aria-label={title} onClick={(e) => { e.stopPropagation(); onClick(); }} className={cn("flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/65 text-white backdrop-blur-md transition-colors", danger ? "hover:bg-destructive" : "hover:bg-primary hover:text-primary-foreground")}>{children}</button>
    </Tip>
  );
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card">
      {!item.url ? <DzPendingTile status={item.status} error={item.error} className="aspect-square w-full" />
        : isVideo ? <video src={item.url} className="aspect-square w-full bg-black object-cover" muted loop playsInline preload="metadata" onMouseOver={(e) => e.currentTarget.play().catch(() => {})} onMouseOut={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} controls={false} />
          : <img src={item.url} alt={item.prompt?.slice(0, 60) || "Result"} loading="lazy" className="aspect-square w-full bg-black/40 object-cover" />}
      {item.url && (
        <div className="absolute right-2 top-2 flex flex-col gap-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <DzLikeButton id={item.id} liked={item.liked} onChange={onLike} className="h-9 w-9" />
          {!isVideo && <Icon title="Animate — use as start frame of a video" onClick={() => onUse(item, "animate")}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></Icon>}
          {!isVideo && <Icon title="Use as reference" onClick={() => onUse(item, "reference")}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 12h8M12 8v8" /></svg></Icon>}
          {item.meta && <Icon title="Reuse settings" onClick={() => onReuse(item)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></svg></Icon>}
          {canUpscale && <Icon title="Upscale" onClick={() => dzOpenUpscale(item.url)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg></Icon>}
          <Icon title="Download" onClick={() => download(item.url)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg></Icon>
          {item.mine !== false && <Icon title="Move to…" onClick={() => window.dispatchEvent(new CustomEvent("dz:move", { detail: item }))}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v6M9 14l3 3 3-3" /></svg></Icon>}
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
  const [camera, setCamera] = useState({ ...DEFAULT_CAMERA, ...(saved.camera || {}) });
  const [move, setMove] = useState(saved.move || "");
  const [attached, setAttached] = useState(saved.attached || {});
  const [uploadingRole, setUploadingRole] = useState(null);
  const [elements, setElements] = useState(saved.elements || []); // chosen elements (Library or project)
  const [uploads, setUploads] = useState(0); // files still uploading — Generate waits for them
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
    try { localStorage.setItem(cfg.store, JSON.stringify({ kind, modelByKind, valuesByKind, prompt, camera, move, attached, elements })); } catch { /* optional */ }
  }, [cfg.store, kind, modelByKind, valuesByKind, prompt, camera, move, attached, elements]);

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
  const elementMax = nativeElements ? (entry.variants.map((v) => elementsInputOf(v.model)?.maxItems || 0).reduce((a, b) => Math.max(a, b), 0) || 7) : 7;
  const params = variant ? paramsOf(variant.model) : { main: [], advanced: [] };
  // Only values this endpoint accepts (attaching files can switch the endpoint).
  const values = variant ? keepValues(storedValues, variant) : storedValues;
  const syntax = variant ? refSyntaxFor(variant.model) : null;
  const missing = entry && !variant ? "This model can't take these files together. Remove some or pick another model." : missingFor(variant, merged.attached);
  const finalPrompt = composePrompt(prompt, { kind, camera, move });
  const needsPrompt = variant?.model.promptRequired;
  const canRun = Boolean(variant && !missing && !uploads && (!needsPrompt || prompt.trim()) && (prompt.trim() || Object.keys(merged.attached).length || activeElements.length));
  const body = variant && canRun ? buildBody(variant, { prompt: finalPrompt, values, attached: merged.attached, elements: elementSpec ? activeElements : [] }) : null;
  const { price, loading: priceLoading } = useDzQuote(apiKey, () => (body ? [dzGenerate, { endpoint: variant.model.endpoint, ...body }] : null));

  const setValue = (key, v) => setValuesByKind((prev) => ({ ...prev, [kind]: { ...(prev[kind] || {}), [key]: v } }));
  const pickModel = (key) => {
    setModelByKind((prev) => ({ ...prev, [kind]: key }));
    const next = entries.find((e) => e.key === key);
    const nextVariant = next ? chooseVariant(next, {}) || next.variants[0] : null;
    setValuesByKind((prev) => ({ ...prev, [kind]: keepValues(prev[kind] || {}, nextVariant) }));
  };

  // The current context: a project (and folder), or personal work only.
  const ctx = useDzContext();
  const history = useDzHistory({ studio: mode, ...(ctx.project ? { project: ctx.project.id, folder: ctx.folder || undefined } : { project: "none" }) });

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
      elements: activeElements.map((e) => ({ id: e.id, name: e.name })),
    };
    const request = { endpoint: variant.model.endpoint, ...body };
    setBusy((n) => n + 1);
    onGenerationStart?.();
    try {
      const res = await dzWithMeta({ studio: mode, meta }, () => dzGenerate(apiKey, request));
      onGenerationEnd?.();
      if (res?.url) onGenerationComplete?.({ url: res.url, type: kind });
    } catch (e) {
      onGenerationEnd?.();
      onGenerationError?.(String(e?.message || e).replace(/^API Request Failed: \d+ [^-]*- /, ""));
    } finally {
      setBusy((n) => n - 1);
    }
  }, [canRun, variant, kind, entry, prompt, values, camera, move, used, body, apiKey, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError]);

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
    if (m.camera) setCamera({ ...DEFAULT_CAMERA, ...m.camera });
    setMove(m.move || "");
    if (isObj(m.attached)) setAttached(normalizeSaved({ attached: m.attached }).attached || {});
  };

  // Prompt tags for what is attached; an element's tag shows its name.
  const refChips = [];
  if (syntax) {
    const seenElement = new Set();
    let n = 0;
    for (const role of ["first", "middle", "last", "reference"]) for (const f of merged.attached[role] || []) {
      n += 1;
      if (f.element) { if (!seenElement.has(f.element)) { seenElement.add(f.element); refChips.push({ label: syntax.image(n), name: f.name }); } }
      else refChips.push({ label: syntax.image(n), role });
    }
    let v = 0;
    for (const role of ["video", "source"]) for (const f of merged.attached[role] || []) { v += 1; refChips.push({ label: syntax.video(v), role, name: f.element ? f.name : undefined }); }
    let a = 0;
    for (const _ of merged.attached.audio || []) { a += 1; refChips.push({ label: syntax.audio(a), role: "audio" }); }
  }
  if (elementSpec) activeElements.slice(0, elementSpec.maxItems || 7).forEach((e, i) => refChips.push({ label: `@element_${i + 1}`, name: e.name }));

  const items = history.items;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Results */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-6 pt-5 md:px-8">
        {history.loaded && items.length === 0 ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-3 text-center">
            <div className="text-3xl font-bold text-foreground">{cfg.title}</div>
            <p className="text-lg text-muted-foreground">{cfg.text}</p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1600px] grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {items.map((item) => (
              <ResultCard key={item.id} item={item} onUse={applyResult} onReuse={reuse} onLike={history.like} onTrash={(id) => history.trash(id).catch((e) => onGenerationError?.(String(e?.message || e)))} />
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
                <MediaSlot key={s.role} role={s.role} max={s.max} files={attached[s.role] || []} uploading={uploadingRole === s.role} onAdd={(files) => addFiles(s.role, files)} onRemove={(i) => removeFile(s.role, i)} />
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

          {refChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Refer to them in the prompt:</span>
              {refChips.map((c) => (
                <button key={c.label} type="button" onClick={() => insertAtCursor(c.label)} title={c.name ? `${c.name}` : undefined} className="rounded-lg bg-primary/15 px-2.5 py-1 font-semibold text-primary transition-colors hover:bg-primary/20">{c.name ? <span className="mr-1 font-normal text-foreground/80">{c.name}</span> : null}{c.label}</button>
              ))}
            </div>
          )}

          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); } }}
            rows={3}
            placeholder={kind === "video" ? "Describe the shot: subject, action, mood…" : "Describe the image…"}
            className="min-h-[88px] rounded-2xl text-base"
          />

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
                  {CAMERA_MOVES.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <Button variant={camera.on ? "default" : "secondary"} className="h-10 rounded-xl px-3 font-medium">Camera{camera.on ? " · on" : ""}</Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-[min(440px,calc(100vw-24px))] rounded-2xl"><CameraPanel camera={camera} setCamera={setCamera} /></PopoverContent>
            </Popover>

            {canUseElements && (
              <ElementPicker selected={elements} onChange={setElements} max={elementMax}
                note={nativeElements ? "This model takes elements directly (name, pictures, video)." : "Their pictures go in as references."} />
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
              <span className={cn("tabular-nums", priceLoading ? "text-muted-foreground/60" : "text-muted-foreground")} title={price ? (price.exact ? "Exact price for your account" : "Estimate") : undefined}>
                {price ? `${price.exact ? "" : "≈ "}${fmtUsd(price.usd)}` : entry?.priceLabel || ""}
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
    </div>
  );
}
