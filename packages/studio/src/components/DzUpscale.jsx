"use client";

// DZ: Upscale — Topaz models on fal.ai.
//   DzUpscalePanel   model, scale and per-model settings, price, Upscale button
//                    (used in the side drawer and in the Upscale tab)
//   DzUpscaleStudio  the Upscale tab: pick an image (upload, history), compare
//                    before/after, recent upscales
// The controls come from the server (window.__DZ_CATALOG__.tools.upscale), the
// same spec the gateway uses to check fields and compute the price.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dzUpscale, uploadFile } from "../api.js";
import { useDzQuote } from "./DzPrice.jsx";
import { dzUpscaleSpec, dzIsOwnImage } from "../dzCatalog.js";

const STORE_KEY = "dz_upscale_settings";
const fmtUsd = (usd) => `$${usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3)}`.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch { return {}; }
}
function save(value) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(value)); } catch { /* optional */ }
}

async function downloadFile(url, name) {
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

// The upscale spec from the server. A fal key added after the page loaded is
// picked up on the next focus of the window (no reload needed).
export function useDzUpscaleSpec() {
  const [spec, setSpec] = useState(() => dzUpscaleSpec());
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/dz/api/tools", { cache: "no-store" });
        if (!res.ok) return;
        const { tools } = await res.json();
        if (typeof window !== "undefined") {
          window.__DZ_CATALOG__ = { ...(window.__DZ_CATALOG__ || {}), tools: tools || {} };
          window.dispatchEvent(new Event("dz:tools"));
        }
      } catch { /* keep what we have */ }
    };
    const onTools = () => { if (!cancelled) setSpec(dzUpscaleSpec()); };
    const onFocus = () => { if (document.visibilityState !== "hidden") check(); };
    window.addEventListener("dz:tools", onTools);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    if (!dzUpscaleSpec()) check();
    return () => {
      cancelled = true;
      window.removeEventListener("dz:tools", onTools);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
  return spec;
}

function Info({ text }) {
  if (!text) return null;
  return (
    <span className="group/info relative inline-flex">
      <span className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-white/25 text-[9px] font-bold text-white/45">i</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-52 -translate-x-1/2 rounded-lg border border-white/10 bg-[#1b1b20] px-2.5 py-1.5 text-[11px] font-normal leading-snug text-white/80 opacity-0 shadow-xl transition-opacity group-hover/info:opacity-100">{text}</span>
    </span>
  );
}

function Label({ field, children }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-white/80">
      {field.label}
      <Info text={field.hint} />
      {children}
    </span>
  );
}

// One control. `disabled`: the field does not apply right now (e.g. face
// settings while face enhancement is off) — shown, but it can't be changed.
function Field({ field, value, onChange, disabled }) {
  const wrap = `py-2 ${disabled ? "opacity-35" : ""}`;
  if (field.type === "bool") {
    const on = value === undefined || value === null ? Boolean(field.default) : Boolean(value);
    return (
      <div className={`flex items-center justify-between gap-3 ${wrap}`}>
        <Label field={field} />
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={field.label}
          disabled={disabled}
          onClick={() => onChange(!on)}
          className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${on ? "bg-[#22d3ee]" : "bg-white/15"}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
        </button>
      </div>
    );
  }
  if (field.type === "select") {
    const current = value === undefined || value === null || value === "" ? field.default : value;
    const label = (opt) => field.labels?.[opt] || opt;
    return (
      <div className={wrap}>
        <div className="mb-1.5"><Label field={field} /></div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-black/30 p-1">
          {field.default == null && (
            <button type="button" disabled={disabled} onClick={() => onChange(null)} className={`flex-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed ${current == null ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>Auto</button>
          )}
          {field.options.map((opt) => (
            <button key={opt} type="button" disabled={disabled} onClick={() => onChange(opt)} className={`flex-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed ${current === opt ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>{label(opt)}</button>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === "text") {
    return (
      <div className={wrap}>
        <div className="mb-1.5"><Label field={field} /></div>
        <textarea
          value={value || ""}
          maxLength={field.max}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe the image (optional)"
          rows={3}
          className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-[#22d3ee]/50 focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
    );
  }
  // Range. A field without a default is "Auto" (the model decides) until the
  // user switches Auto off; while Auto is on the slider is locked.
  const canAuto = field.default === null || field.default === undefined;
  const isAuto = canAuto && (value === undefined || value === null || value === "");
  const shown = isAuto ? field.start : (value === undefined || value === null || value === "" ? field.default : Number(value));
  return (
    <div className={wrap}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Label field={field} />
        <span className="flex items-center gap-2">
          {canAuto && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(isAuto ? field.start : null)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold disabled:cursor-not-allowed ${isAuto ? "bg-[#22d3ee]/15 text-[#22d3ee]" : "bg-white/5 text-white/45 hover:text-white"}`}
              title={isAuto ? "The model picks this value. Click to set it yourself." : "Let the model pick this value"}
            >
              Auto
            </button>
          )}
          <span className={`w-9 text-right text-[12px] tabular-nums ${isAuto ? "text-white/30" : "text-white/70"}`}>{field.step === 1 ? shown : Number(shown).toFixed(2)}</span>
        </span>
      </div>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={shown}
        disabled={disabled || isAuto}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={field.label}
        className="w-full accent-[#22d3ee] disabled:cursor-not-allowed disabled:opacity-40"
      />
    </div>
  );
}

const fieldApplies = (field, valueOf) => !field.when || Object.entries(field.when).every(([k, want]) => valueOf(k) === want);

function ModelSelect({ group, model, onPick }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const price = (m) => `${fmtUsd(m.price.usd)} / ${m.price.mp} MP${m.price.assumed ? " ≈" : ""}`;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left hover:border-white/20"
      >
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-white">{model.id}</span>
          {model.hint && <span className="block truncate text-[12px] text-white/45">{model.hint}</span>}
        </span>
        <span className="flex flex-shrink-0 items-center gap-2 text-[11px] tabular-nums text-white/40">
          {price(model)}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[360px] overflow-y-auto custom-scrollbar rounded-xl border border-white/10 bg-[#151519] p-1 shadow-[0_16px_40px_rgba(0,0,0,0.6)]">
          {group.models.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === model.id}
              onClick={() => { onPick(m.id); setOpen(false); }}
              className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left ${m.id === model.id ? "bg-[#22d3ee]/10" : "hover:bg-white/[0.05]"}`}
            >
              <span className="min-w-0">
                <span className={`block text-[13px] font-semibold ${m.id === model.id ? "text-[#22d3ee]" : "text-white/90"}`}>{m.id}</span>
                {m.hint && <span className="block text-[12px] text-white/45">{m.hint}</span>}
              </span>
              <span className="flex-shrink-0 pt-0.5 text-[11px] tabular-nums text-white/35">{price(m)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Settings + price + Upscale. `imageUrl` must be one of our /media files.
export function DzUpscalePanel({ apiKey, imageUrl, onStart, onDone, onError, compact = false, isAdmin = false }) {
  const spec = useDzUpscaleSpec();
  const saved = useMemo(loadSaved, []);
  const [groupId, setGroupId] = useState(saved.groupId || null);
  const group = spec?.groups.find((g) => g.id === groupId) || spec?.groups?.[0];
  const [modelByGroup, setModelByGroup] = useState(saved.modelByGroup || {});
  const model = group?.models.find((m) => m.id === modelByGroup[group?.id]) || group?.models?.[0];
  const [factor, setFactor] = useState(saved.factor || spec?.factor?.default || 2);
  const [values, setValues] = useState(saved.values || {}); // per model id
  const [busy, setBusy] = useState(0);
  const [advanced, setAdvanced] = useState(Boolean(saved.advanced));
  // The drawer can close while a job runs: the job and its callbacks go on,
  // only this panel's own state is no longer touched.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => { save({ groupId, modelByGroup, factor, values, advanced }); }, [groupId, modelByGroup, factor, values, advanced]);

  const modelValues = (model && values[model.id]) || {};
  const setValue = (key, v) => setValues((prev) => ({ ...prev, [model.id]: { ...(prev[model.id] || {}), [key]: v } }));
  const fields = useMemo(() => (model ? [...model.fields, ...(spec?.common || [])] : []), [model, spec]);
  // Hidden settings keep their values but are not sent: Advanced off = the model's defaults.
  const valueOf = useCallback((key) => {
    const f = fields.find((x) => x.key === key);
    const v = modelValues[key];
    return v === undefined || v === null || v === "" ? f?.default : v;
  }, [fields, modelValues]);
  const changed = Boolean(model?.fields.some((f) => modelValues[f.key] !== undefined && modelValues[f.key] !== null));
  const reset = () => setValues((prev) => {
    const kept = { ...(prev[model.id] || {}) };
    for (const f of model.fields) delete kept[f.key];
    return { ...prev, [model.id]: kept };
  });

  const body = useMemo(() => {
    if (!model || !imageUrl) return null;
    const b = { image_url: imageUrl, model: model.id, upscale_factor: factor };
    for (const f of fields) {
      if (!fieldApplies(f, valueOf)) continue;
      if (!advanced && model.fields.includes(f)) continue;
      const v = valueOf(f.key);
      if (v !== undefined && v !== null && v !== "") b[f.key] = v;
    }
    return b;
  }, [model, imageUrl, factor, fields, valueOf, advanced]);

  const canRun = Boolean(body && dzIsOwnImage(imageUrl));
  const { price, loading } = useDzQuote(apiKey, () => (canRun ? [dzUpscale, { endpoint: group.endpoint, ...body }] : null));

  const run = useCallback(async () => {
    if (!canRun) return;
    if (mounted.current) setBusy((n) => n + 1);
    onStart?.({ source: imageUrl });
    try {
      const res = await dzUpscale(apiKey, { endpoint: group.endpoint, ...body });
      if (!res?.url) throw new Error("No result file");
      onDone?.({ url: res.url, source: imageUrl, model: model.id, factor, id: res.request_id });
    } catch (e) {
      onError?.(String(e?.message || e).replace(/^API Request Failed: \d+ [^-]*- /, ""));
    } finally {
      if (mounted.current) setBusy((n) => n - 1);
    }
  }, [canRun, apiKey, group, body, imageUrl, model, factor, onStart, onDone, onError]);

  if (!spec) {
    return (
      <div className={`flex h-full flex-col items-start gap-3 p-5 ${compact ? "" : "rounded-2xl border border-white/[0.08] bg-[#0d0d10]"}`}>
        <div className="text-[15px] font-semibold text-white/90">Upscale is not set up yet</div>
        <p className="text-[13px] leading-relaxed text-white/55">
          Upscaling uses Topaz models on fal.ai. {isAdmin ? "Add your fal.ai API key in Settings to turn it on." : "Ask the admin to add a fal.ai API key in Settings."}
        </p>
        {isAdmin && (
          <a href="/dz/settings#provider-fal" className="rounded-xl bg-[#22d3ee] px-4 py-2 text-[13px] font-bold text-black hover:bg-[#67e8f9]">Add fal.ai key</a>
        )}
      </div>
    );
  }

  const input = price?.input;
  return (
    <div className={`flex h-full flex-col ${compact ? "" : "rounded-2xl border border-white/[0.08] bg-[#0d0d10]"}`}>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-5">
        {/* Type */}
        <div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/30 p-1">
            {spec.groups.map((g) => (
              <button key={g.id} type="button" onClick={() => setGroupId(g.id)} className={`rounded-lg py-2 text-[13px] font-semibold ${g.id === group.id ? "bg-white/12 text-white" : "text-white/50 hover:text-white"}`}>{g.name}</button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-snug text-white/45">{group.hint}</p>
        </div>

        {/* Model */}
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">Model</div>
          <ModelSelect group={group} model={model} onPick={(id) => setModelByGroup((prev) => ({ ...prev, [group.id]: id }))} />
        </div>

        {/* Scale */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">Scale</span>
            {input && <span className="text-[12px] tabular-nums text-white/50">{input.width}×{input.height} → {Math.round(input.width * factor)}×{Math.round(input.height * factor)}</span>}
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/30 p-1">
            {[1, 2, 3, 4].filter((f) => f >= spec.factor.min && f <= spec.factor.max).map((f) => (
              <button key={f} type="button" onClick={() => setFactor(f)} className={`rounded-lg py-2 text-[13px] font-bold ${factor === f ? "bg-white/12 text-white" : "text-white/50 hover:text-white"}`}>{f}×</button>
            ))}
          </div>
          {factor === 1 && <p className="mt-1.5 text-[12px] text-white/40">1× keeps the size and only enhances the image.</p>}
        </div>

        {/* Settings everyone needs (output format) */}
        {(spec.common || []).map((f) => (
          <Field key={f.key} field={f} value={modelValues[f.key]} onChange={(v) => setValue(f.key, v)} />
        ))}

        {/* Advanced: only for models that have settings of their own, like
            Higgsfield. Settings that don't apply right now (face settings while
            face enhancement is off) are hidden, not greyed out. */}
        {model.fields.length > 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[13px] font-semibold text-white/85">Advanced settings</span>
              <span className="flex items-center gap-2">
                {advanced && changed && (
                  <button type="button" onClick={reset} className="rounded-md px-2 py-0.5 text-[12px] font-semibold text-white/55 hover:bg-white/5 hover:text-white" title="Back to the model's defaults">Reset</button>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={advanced}
                  aria-label="Advanced settings"
                  onClick={() => setAdvanced((v) => !v)}
                  className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${advanced ? "bg-[#22d3ee]" : "bg-white/15"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${advanced ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </span>
            </div>
            {advanced && (
              <div className="border-t border-white/[0.06] pb-1">
                {model.fields.filter((f) => fieldApplies(f, valueOf)).map((f) => (
                  <Field key={f.key} field={f} value={modelValues[f.key]} onChange={(v) => setValue(f.key, v)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Price and run */}
      <div className="border-t border-white/[0.06] p-4">
        <div className="mb-2 flex items-center justify-between text-[12px] text-white/50">
          <span>{price?.output_mp ? `Output ${price.output_mp} MP` : imageUrl ? (dzIsOwnImage(imageUrl) ? "" : "Upload this image first") : "Choose an image"}</span>
          <span className={`tabular-nums ${loading ? "text-white/30" : "text-white/80"}`} title={price ? (price.exact ? "Price from fal's published rates" : "Estimate: fal does not publish this model's price") : undefined}>
            {price ? `${price.exact ? "" : "≈ "}${fmtUsd(price.usd)}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className="w-full rounded-xl bg-[#22d3ee] py-3 text-[14px] font-bold text-black transition-all hover:bg-[#67e8f9] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy > 0 ? `Upscaling${busy > 1 ? ` · ${busy}` : ""}… (you can start another)` : "Upscale"}
        </button>
      </div>
    </div>
  );
}

// Drag to compare the original and the upscaled image.
function Compare({ before, after }) {
  const [pos, setPos] = useState(50);
  const box = useRef(null);
  const move = (clientX) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={box}
      className="relative h-full w-full select-none overflow-hidden"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons) move(e.clientX); }}
    >
      <img src={after} alt="Upscaled" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      <img src={before} alt="Original" className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} draggable={false} />
      <div className="absolute inset-y-0 w-0.5 bg-white/80 shadow" style={{ left: `${pos}%` }}>
        <div className="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[11px] font-bold text-black shadow-lg">⇆</div>
      </div>
      <span className="absolute top-3 left-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold text-white/80">Before</span>
      <span className="absolute top-3 right-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold text-white/80">After</span>
    </div>
  );
}

const isUpscale = (item) => String(item?.model || "").startsWith("p/fal/topaz/upscale");

// The Upscale tab.
const VIEW_KEY = "dz_upscale_view";
function loadView() {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") || {}; } catch { return {}; }
}

export default function DzUpscaleStudio({ apiKey, initial, isAdmin = false, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError, droppedFiles, onFilesHandled }) {
  // The chosen image and its last result survive a page reload.
  const [source, setSource] = useState(() => initial?.url || null);
  const [result, setResult] = useState(null); // { url, source }
  useEffect(() => {
    if (initial?.url) return;
    const v = loadView();
    if (dzIsOwnImage(v.source)) { setSource(v.source); if (v.result?.source === v.source) setResult(v.result); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ source, result })); } catch { /* optional */ }
  }, [source, result]);
  const [recent, setRecent] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [pickTab, setPickTab] = useState("generated");
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState(false);
  const fileInput = useRef(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/history?limit=120");
      if (!res.ok) return;
      const data = await res.json();
      setRecent((data.items || []).filter((i) => i.status === "completed" && i.kind === "image" && i.url));
    } catch { /* shown as empty */ }
    try {
      const res = await fetch("/api/v1/uploads?kind=image&limit=120");
      if (res.ok) setUploads((await res.json()).items || []);
    } catch { /* shown as empty */ }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  // `initial` is a new object on every "Open in Upscale tab", even for the same image.
  useEffect(() => { if (initial?.url) { setSource(initial.url); setResult(null); setPicker(false); } }, [initial]);

  // Only the latest upload may change the selection.
  const uploadSeq = useRef(0);
  const upload = useCallback(async (file) => {
    if (!file || !/^image\//.test(file.type)) { onGenerationError?.("Choose an image file (PNG, JPEG or WebP)."); return; }
    const seq = ++uploadSeq.current;
    setUploading(true);
    try {
      const url = await uploadFile(apiKey, file);
      if (seq !== uploadSeq.current) return;
      loadHistory();
      setSource(url);
      setResult(null);
      setPicker(false);
    } catch (e) {
      if (seq === uploadSeq.current) onGenerationError?.(String(e?.message || e));
    } finally {
      if (seq === uploadSeq.current) setUploading(false);
    }
  }, [apiKey, onGenerationError, loadHistory]);

  useEffect(() => {
    if (droppedFiles?.length) { upload(droppedFiles[0]); onFilesHandled?.(); }
  }, [droppedFiles, upload, onFilesHandled]);

  const upscales = recent.filter(isUpscale);
  const sources = recent.filter((i) => !isUpscale(i));

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden bg-app-bg p-4 md:flex-row md:p-6">
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />

      {/* Image */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40">
          {source && !picker ? (
            result && result.source === source ? (
              <Compare before={source} after={result.url} />
            ) : (
              <img src={source} alt="To upscale" className="absolute inset-0 h-full w-full object-contain" />
            )
          ) : (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex flex-col items-center justify-center gap-3 border-b border-white/[0.06] px-6 py-8 text-center">
                <div className="text-[15px] font-semibold text-white/85">Choose an image to upscale</div>
                <div className="text-[12px] text-white/45">Drop a file anywhere, upload one, or pick from your images below.</div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="rounded-xl bg-[#22d3ee] px-4 py-2 text-[13px] font-bold text-black hover:bg-[#67e8f9] disabled:opacity-50">{uploading ? "Uploading…" : "Upload from computer"}</button>
                  {source && <button type="button" onClick={() => setPicker(false)} className="rounded-xl bg-white/10 px-4 py-2 text-[13px] font-semibold text-white/80 hover:bg-white/15">Cancel</button>}
                </div>
              </div>
              <div className="flex gap-1 px-3 pt-3">
                {[["generated", `Generated · ${sources.length}`], ["uploads", `Uploads · ${uploads.length}`]].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setPickTab(id)} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${pickTab === id ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}>{label}</button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                {(pickTab === "uploads" ? uploads : sources).length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-white/40">{pickTab === "uploads" ? "Nothing uploaded yet." : "No generated images yet."}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {(pickTab === "uploads" ? uploads : sources).map((item) => (
                      <button key={item.id} type="button" onClick={() => { setSource(item.url); setResult(null); setPicker(false); }} className="group relative aspect-square overflow-hidden rounded-lg border border-white/[0.06] hover:border-[#22d3ee]/60">
                        <img src={item.url} alt={item.prompt?.slice(0, 40) || item.name || "Image"} loading="lazy" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {source && !picker && (
            <div className="absolute bottom-3 left-3 flex gap-2">
              <button type="button" onClick={() => setPicker(true)} className="rounded-lg bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-white/85 backdrop-blur hover:bg-black/90">Change image</button>
              {result && result.source === source && (
                <button type="button" onClick={() => downloadFile(result.url, `upscaled-${Date.now()}.${result.url.split(".").pop()}`)} className="rounded-lg bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-white/85 backdrop-blur hover:bg-black/90">Download</button>
              )}
            </div>
          )}
        </div>

        {/* Recent upscales */}
        {/* Fixed height, so the image above doesn't jump when the first upscale lands. */}
        {(
          <div className="h-[92px] flex-shrink-0">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">Recent upscales</div>
            {upscales.length === 0 && <p className="text-[12px] text-white/30">Your upscaled images will appear here.</p>}
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
              {upscales.slice(0, 30).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={`${item.params?.model || ""} ${item.params?.upscale_factor || ""}×${item.cost_usd != null ? ` · ${fmtUsd(item.cost_usd)}` : ""}`}
                  onClick={() => { const src = item.params?.image_url; if (src) { setSource(src); setResult({ url: item.url, source: src }); setPicker(false); } }}
                  className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-white/[0.08] hover:border-[#22d3ee]/60"
                >
                  <img src={item.url} alt="Upscaled" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="h-[46vh] w-full flex-shrink-0 md:h-full md:w-[340px]">
        <DzUpscalePanel
          apiKey={apiKey}
          isAdmin={isAdmin}
          imageUrl={source}
          onStart={() => onGenerationStart?.()}
          onDone={(r) => {
            onGenerationEnd?.();
            if (r.source === sourceRef.current) setResult({ url: r.url, source: r.source });
            onGenerationComplete?.({ url: r.url, type: "image" });
            loadHistory();
          }}
          onError={(msg) => { onGenerationEnd?.(); onGenerationError?.(msg); }}
        />
      </div>
    </div>
  );
}
