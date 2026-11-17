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

function Field({ field, value, onChange }) {
  const auto = value === undefined || value === null || value === "";
  if (field.type === "bool") {
    const on = value === undefined ? Boolean(field.default) : Boolean(value);
    return (
      <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer" title={field.hint || undefined}>
        <span className="text-[12px] text-white/70">{field.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => onChange(!on)}
          className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-[#22d3ee]" : "bg-white/15"}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
        </button>
      </label>
    );
  }
  if (field.type === "select") {
    const current = auto ? field.default : value;
    return (
      <div className="py-1.5" title={field.hint || undefined}>
        <div className="mb-1.5 text-[12px] text-white/70">{field.label}</div>
        <div className="flex flex-wrap gap-1">
          {field.default == null && (
            <button type="button" onClick={() => onChange(null)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${current == null ? "bg-white/15 text-white" : "bg-white/5 text-white/50 hover:text-white"}`}>Auto</button>
          )}
          {field.options.map((opt) => (
            <button key={opt} type="button" onClick={() => onChange(opt)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize ${current === opt ? "bg-white/15 text-white" : "bg-white/5 text-white/50 hover:text-white"}`}>{opt}</button>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === "text") {
    return (
      <div className="py-1.5">
        <div className="mb-1.5 text-[12px] text-white/70">{field.label}</div>
        <textarea
          value={value || ""}
          maxLength={field.max}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.hint || ""}
          rows={3}
          className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-white placeholder:text-white/30 focus:border-[#22d3ee]/50 focus:outline-none"
        />
      </div>
    );
  }
  // range
  const shown = auto ? (field.default ?? null) : Number(value);
  const isAuto = shown === null;
  return (
    <div className="py-1.5" title={field.hint || undefined}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] text-white/70">{field.label}</span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-white/55">{isAuto ? "Auto" : field.step === 1 ? shown : shown.toFixed(2)}</span>
          {!auto && <button type="button" onClick={() => onChange(null)} className="text-[10px] text-white/35 hover:text-white" title="Back to default">↺</button>}
        </span>
      </div>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={isAuto ? (field.min + field.max) / 2 : shown}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full accent-[#22d3ee] ${isAuto ? "opacity-40" : ""}`}
      />
    </div>
  );
}

// Settings + price + Upscale. `imageUrl` must be one of our /media files.
export function DzUpscalePanel({ apiKey, imageUrl, onStart, onDone, onError, compact = false }) {
  const spec = dzUpscaleSpec();
  const saved = useMemo(loadSaved, []);
  const [groupId, setGroupId] = useState(saved.groupId || spec?.groups?.[0]?.id);
  const group = spec?.groups.find((g) => g.id === groupId) || spec?.groups?.[0];
  const [modelByGroup, setModelByGroup] = useState(saved.modelByGroup || {});
  const model = group?.models.find((m) => m.id === modelByGroup[group?.id]) || group?.models?.[0];
  const [factor, setFactor] = useState(saved.factor || spec?.factor?.default || 2);
  const [values, setValues] = useState(saved.values || {}); // per model id
  const [busy, setBusy] = useState(0);
  // The drawer can close while a job runs: the job and its callbacks go on,
  // only this panel's own state is no longer touched.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => { save({ groupId, modelByGroup, factor, values }); }, [groupId, modelByGroup, factor, values]);

  const modelValues = (model && values[model.id]) || {};
  const setValue = (key, v) => setValues((prev) => ({ ...prev, [model.id]: { ...(prev[model.id] || {}), [key]: v } }));

  const body = useMemo(() => {
    if (!model || !imageUrl) return null;
    const b = { image_url: imageUrl, model: model.id, upscale_factor: factor };
    for (const f of [...(spec?.common || []), ...model.fields]) {
      const v = modelValues[f.key];
      if (v !== undefined && v !== null && v !== "") b[f.key] = v;
      else if (f.default !== null && f.default !== undefined && f.default !== "") b[f.key] = f.default;
    }
    return b;
  }, [model, imageUrl, factor, modelValues, spec]);

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
      <div className="p-5 text-[13px] leading-relaxed text-white/60">
        Upscaling runs on fal.ai. Ask the admin to add a fal.ai key in Settings.
      </div>
    );
  }

  const input = price?.input;
  return (
    <div className={`flex h-full flex-col ${compact ? "" : "rounded-2xl border border-white/[0.08] bg-[#0d0d10]"}`}>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* Model group */}
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">Type</div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/30 p-1">
            {spec.groups.map((g) => (
              <button key={g.id} type="button" onClick={() => setGroupId(g.id)} className={`rounded-lg py-1.5 text-[12px] font-semibold ${g.id === group.id ? "bg-white/12 text-white" : "text-white/50 hover:text-white"}`}>{g.name}</button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-white/45">{group.hint}</p>
        </div>

        {/* Model */}
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">Model</div>
          <div className="space-y-1">
            {group.models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModelByGroup((prev) => ({ ...prev, [group.id]: m.id }))}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${m.id === model.id ? "border-[#22d3ee]/40 bg-[#22d3ee]/10" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[12px] font-semibold ${m.id === model.id ? "text-[#22d3ee]" : "text-white/85"}`}>{m.id}</span>
                  <span className="text-[10px] tabular-nums text-white/35">{fmtUsd(m.price.usd)}/{m.price.mp} MP</span>
                </div>
                {m.hint && <div className="mt-0.5 text-[11px] text-white/40">{m.hint}</div>}
              </button>
            ))}
          </div>
        </div>

        {/* Scale */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/40">Scale</span>
            {input && <span className="text-[11px] tabular-nums text-white/45">{input.width}×{input.height} → {Math.round(input.width * factor)}×{Math.round(input.height * factor)}</span>}
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/30 p-1">
            {[1, 2, 3, 4].filter((f) => f >= spec.factor.min && f <= spec.factor.max).map((f) => (
              <button key={f} type="button" onClick={() => setFactor(f)} className={`rounded-lg py-1.5 text-[12px] font-bold ${factor === f ? "bg-white/12 text-white" : "text-white/50 hover:text-white"}`}>{f}×</button>
            ))}
          </div>
          {factor === 1 && <p className="mt-1.5 text-[11px] text-white/40">1× keeps the size and only enhances the image.</p>}
        </div>

        {/* Model settings */}
        {(model.fields.length > 0 || spec.common.length > 0) && (
          <details className="group rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-1" open={!compact}>
            <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[12px] font-semibold text-white/75">
              Advanced
              <span className="text-white/35 transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="pb-2">
              {model.fields.length === 0 && <p className="py-1.5 text-[11px] text-white/40">This model has no settings of its own.</p>}
              {[...model.fields, ...spec.common].map((f) => (
                <Field key={f.key} field={f} value={modelValues[f.key]} onChange={(v) => setValue(f.key, v)} />
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Price and run */}
      <div className="border-t border-white/[0.06] p-4">
        <div className="mb-2 flex items-center justify-between text-[11px] text-white/50">
          <span>{price?.output_mp ? `Output ${price.output_mp} MP` : imageUrl ? (dzIsOwnImage(imageUrl) ? "" : "Upload this image first") : "Choose an image"}</span>
          <span className={`tabular-nums ${loading ? "text-white/30" : "text-white/75"}`} title={price ? (price.exact ? "Price from fal's published rates" : "Estimate: fal does not publish this model's price") : undefined}>
            {price ? `${price.exact ? "" : "≈ "}${fmtUsd(price.usd)}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className="w-full rounded-xl bg-[#22d3ee] py-3 text-[13px] font-bold text-black transition-all hover:bg-[#67e8f9] disabled:cursor-not-allowed disabled:opacity-40"
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
export default function DzUpscaleStudio({ apiKey, initial, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError, droppedFiles, onFilesHandled }) {
  const [source, setSource] = useState(initial?.url || null);
  const [result, setResult] = useState(null); // { url, source }
  const [recent, setRecent] = useState([]);
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
      setSource(url);
      setResult(null);
      setPicker(false);
    } catch (e) {
      if (seq === uploadSeq.current) onGenerationError?.(String(e?.message || e));
    } finally {
      if (seq === uploadSeq.current) setUploading(false);
    }
  }, [apiKey, onGenerationError]);

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
              <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                {sources.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-white/35">No images yet.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {sources.map((item) => (
                      <button key={item.id} type="button" onClick={() => { setSource(item.url); setResult(null); setPicker(false); }} className="group relative aspect-square overflow-hidden rounded-lg border border-white/[0.06] hover:border-[#22d3ee]/60">
                        <img src={item.url} alt={item.prompt?.slice(0, 40) || "Image"} loading="lazy" className="h-full w-full object-cover" />
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
        {upscales.length > 0 && (
          <div className="flex-shrink-0">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">Recent upscales</div>
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
