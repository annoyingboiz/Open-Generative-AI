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
import { DzMediaBrowser } from "./DzMedia.jsx";
import { useDzContext } from "../dzContext.js";
import { Button, buttonVariants, Segmented, OptionSelect, Slider, Switch, Textarea, InfoTip, Tip, SectionLabel, Spinner, cn } from "../ui/index.js";

const STORE_KEY = "dz_upscale_settings";
const fmtUsd = (usd) => `$${usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;

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

function FieldLabel({ field }) {
  return (
    <span className="flex items-center gap-2 text-base font-medium text-foreground">
      {field.label}
      <InfoTip text={field.hint} />
    </span>
  );
}

// One control, drawn from the server spec. Ranges without a default are
// "Auto" (the model decides) until switched to manual.
function Field({ field, value, onChange }) {
  if (field.type === "bool") {
    const on = value === undefined || value === null ? Boolean(field.default) : Boolean(value);
    return (
      <div className="flex items-center justify-between gap-3 py-2.5">
        <FieldLabel field={field} />
        <Switch checked={on} onCheckedChange={onChange} aria-label={field.label} />
      </div>
    );
  }
  if (field.type === "select") {
    const current = value === undefined || value === null || value === "" ? field.default : value;
    const options = [
      ...(field.default == null ? [{ value: "__auto", label: "Auto" }] : []),
      ...field.options.map((o) => ({ value: o, label: field.labels?.[o] || o })),
    ];
    return (
      <div className="space-y-2 py-2.5">
        <FieldLabel field={field} />
        <Segmented size="sm" value={current ?? "__auto"} onChange={(v) => onChange(v === "__auto" ? null : v)} options={options} aria-label={field.label} />
      </div>
    );
  }
  if (field.type === "text") {
    return (
      <div className="space-y-2 py-2.5">
        <FieldLabel field={field} />
        <Textarea value={value || ""} maxLength={field.max} onChange={(e) => onChange(e.target.value)} placeholder="Describe the image (optional)" rows={3} />
      </div>
    );
  }
  const canAuto = field.default === null || field.default === undefined;
  const isAuto = canAuto && (value === undefined || value === null || value === "");
  const shown = isAuto ? field.start : (value === undefined || value === null || value === "" ? field.default : Number(value));
  return (
    <div className="space-y-1 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel field={field} />
        <span className="flex items-center gap-2">
          {canAuto && (
            <Button
              size="sm"
              variant={isAuto ? "secondary" : "ghost"}
              className={cn("h-8 px-2.5", isAuto && "text-primary")}
              onClick={() => onChange(isAuto ? field.start : null)}
              aria-pressed={isAuto}
            >
              Auto
            </Button>
          )}
          <span className={cn("w-12 text-right tabular-nums", isAuto ? "text-muted-foreground/60" : "text-foreground")}>{field.step === 1 ? shown : Number(shown).toFixed(2)}</span>
        </span>
      </div>
      <Slider min={field.min} max={field.max} step={field.step} value={[Number(shown)]} disabled={isAuto} onValueChange={([v]) => onChange(v)} aria-label={field.label} />
    </div>
  );
}

const fieldApplies = (field, valueOf) => !field.when || Object.entries(field.when).every(([k, want]) => valueOf(k) === want);
const priceLabel = (m) => `${fmtUsd(m.price.usd)} / ${m.price.mp} MP${m.price.assumed ? " ≈" : ""}`;

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

  // Hidden settings keep their values but are not sent: Advanced off = the model's defaults.
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

  const shell = compact ? "flex h-full flex-col" : "flex h-full flex-col rounded-2xl border border-border bg-card";

  if (!spec) {
    return (
      <div className={cn(shell, "items-start gap-3 p-6")}>
        <div className="text-lg font-semibold text-foreground">Upscale is not set up yet</div>
        <p className="text-base leading-relaxed text-muted-foreground">
          Upscaling uses Topaz models on fal.ai. {isAdmin ? "Add your fal.ai API key in Settings to turn it on." : "Ask the admin to add a fal.ai API key in Settings."}
        </p>
        {isAdmin && (
          <a href="/dz/settings#provider-fal" className={buttonVariants()}>Add fal.ai key</a>
        )}
      </div>
    );
  }

  const input = price?.input;
  const visibleAdvanced = model.fields.filter((f) => fieldApplies(f, valueOf));
  return (
    <div className={shell}>
      <div className="flex-1 space-y-6 overflow-y-auto custom-scrollbar p-5">
        <section className="space-y-2">
          <SectionLabel>Type</SectionLabel>
          <Segmented value={group.id} onChange={setGroupId} options={spec.groups.map((g) => ({ value: g.id, label: g.name }))} aria-label="Upscale type" />
          <p className="text-base leading-snug text-muted-foreground">{group.hint}</p>
        </section>

        <section className="space-y-2">
          <SectionLabel>Model</SectionLabel>
          <OptionSelect
            aria-label="Model"
            value={model.id}
            onValueChange={(id) => setModelByGroup((prev) => ({ ...prev, [group.id]: id }))}
            options={group.models.map((m) => ({ value: m.id, label: m.id, description: m.hint, meta: priceLabel(m) }))}
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Scale</SectionLabel>
            {input && <span className="tabular-nums text-muted-foreground">{input.width}×{input.height} → {Math.round(input.width * factor)}×{Math.round(input.height * factor)}</span>}
          </div>
          <Segmented
            value={factor}
            onChange={setFactor}
            aria-label="Scale"
            options={[1, 2, 3, 4].filter((f) => f >= spec.factor.min && f <= spec.factor.max).map((f) => ({ value: f, label: `${f}×` }))}
          />
          {factor === 1 && <p className="text-base text-muted-foreground">1× keeps the size and only enhances the image.</p>}
        </section>

        {(spec.common || []).map((f) => (
          <Field key={f.key} field={f} value={modelValues[f.key]} onChange={(v) => setValue(f.key, v)} />
        ))}

        {/* Advanced: only for models that have settings of their own (like
            Higgsfield). Settings that don't apply right now are hidden. */}
        {model.fields.length > 0 && (
          <section className="rounded-xl border border-border bg-background/40 px-4">
            <div className="flex items-center justify-between gap-3 py-3">
              <span className="text-base font-semibold text-foreground">Advanced settings</span>
              <span className="flex items-center gap-2">
                {advanced && changed && <Button size="sm" variant="ghost" onClick={reset}>Reset</Button>}
                <Switch checked={advanced} onCheckedChange={setAdvanced} aria-label="Advanced settings" />
              </span>
            </div>
            {advanced && (
              <div className="divide-y divide-border/60 border-t border-border pb-1">
                {visibleAdvanced.map((f) => (
                  <Field key={f.key} field={f} value={modelValues[f.key]} onChange={(v) => setValue(f.key, v)} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <div className="space-y-3 border-t border-border p-5">
        <div className="flex items-center justify-between text-base">
          <span className="text-muted-foreground">{price?.output_mp ? `Output ${price.output_mp} MP` : imageUrl ? (dzIsOwnImage(imageUrl) ? "" : "Upload this image first") : "Choose an image"}</span>
          <span className={cn("font-semibold tabular-nums", loading ? "text-muted-foreground/60" : "text-foreground")} title={price ? (price.exact ? "Price from fal's published rates" : "Estimate: fal does not publish this model's price") : undefined}>
            {price ? `${price.exact ? "" : "≈ "}${fmtUsd(price.usd)}` : ""}
          </span>
        </div>
        <Button size="lg" className="w-full" onClick={run} disabled={!canRun}>
          {busy > 0 ? <><Spinner className="h-4 w-4 border-primary-foreground/30 border-t-primary-foreground" /> Upscaling{busy > 1 ? ` · ${busy}` : ""}…</> : "Upscale"}
        </Button>
        {busy > 0 && <p className="text-center text-base text-muted-foreground">You can start another one meanwhile.</p>}
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
        <div className="absolute top-1/2 left-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-base font-bold text-black shadow-lg">⇆</div>
      </div>
      <span className="absolute top-3 left-3 rounded-lg bg-black/70 px-2.5 py-1 text-base font-semibold text-white/90">Before</span>
      <span className="absolute top-3 right-3 rounded-lg bg-black/70 px-2.5 py-1 text-base font-semibold text-white/90">After</span>
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
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState(false);
  const fileInput = useRef(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // In a project: its images; in Library: everything the user can see.
  const ctx = useDzContext();
  const scopeQuery = ctx.project ? `&project=${encodeURIComponent(ctx.project.id)}` : "";
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/history?limit=120${scopeQuery}`);
      if (!res.ok) return;
      const data = await res.json();
      setRecent((data.items || []).filter((i) => i.status === "completed" && i.kind === "image" && i.url));
    } catch { /* shown as empty */ }
    try {
      const res = await fetch(`/api/v1/uploads?kind=image&limit=120${scopeQuery}`);
      if (res.ok) setUploads((await res.json()).items || []);
    } catch { /* shown as empty */ }
  }, [scopeQuery]);
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

  return (
    <div className="flex h-full w-full flex-col gap-5 overflow-hidden bg-background p-4 md:flex-row md:p-6">
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />

      {/* Image */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <div className="relative min-h-[300px] flex-1 overflow-hidden rounded-2xl border border-border bg-card">
          {source && !picker ? (
            result && result.source === source ? (
              <Compare before={source} after={result.url} />
            ) : (
              <img src={source} alt="To upscale" className="absolute inset-0 h-full w-full object-contain" />
            )
          ) : (
            <div className="flex h-full flex-col overflow-hidden p-4">
              <div className="flex flex-wrap items-center gap-3 pb-3">
                <div className="mr-auto">
                  <div className="text-xl font-semibold text-foreground">Choose an image to upscale</div>
                  <div className="text-base text-muted-foreground">Drop a file anywhere, upload one, or pick from your work.</div>
                </div>
                {uploading && <span className="flex items-center gap-2 text-muted-foreground"><Spinner className="h-4 w-4" /> Uploading…</span>}
                {source && <Button variant="secondary" onClick={() => setPicker(false)}>Cancel</Button>}
              </div>
              <div className="min-h-0 flex-1">
                <DzMediaBrowser inline accept="image" max={1} apiKey={apiKey} onError={onGenerationError}
                  onConfirm={(list) => { if (list[0]?.url) { setSource(list[0].url); setResult(null); setPicker(false); loadHistory(); } }} />
              </div>
            </div>
          )}
          {source && !picker && (
            <div className="absolute bottom-4 left-4 flex gap-2">
              <Button variant="secondary" size="sm" className="bg-black/70 text-white backdrop-blur hover:bg-black/90" onClick={() => setPicker(true)}>Change image</Button>
              {result && result.source === source && (
                <Button variant="secondary" size="sm" className="bg-black/70 text-white backdrop-blur hover:bg-black/90" onClick={() => downloadFile(result.url, `upscaled-${Date.now()}.${result.url.split(".").pop()}`)}>Download</Button>
              )}
            </div>
          )}
        </div>

        {/* Recent upscales. Fixed height, so the image above doesn't jump when the first one lands. */}
        <div className="h-[112px] flex-shrink-0 space-y-2">
          <SectionLabel>Recent upscales</SectionLabel>
          {upscales.length === 0 && <p className="text-base text-muted-foreground/70">Your upscaled images will appear here.</p>}
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
            {upscales.slice(0, 30).map((item) => (
              <Tip key={item.id} text={`${item.params?.model || ""} · ${item.params?.upscale_factor || ""}×${item.cost_usd != null ? ` · ${fmtUsd(item.cost_usd)}` : ""}`}>
                <button
                  type="button"
                  onClick={() => { const src = item.params?.image_url; if (src) { setSource(src); setResult({ url: item.url, source: src }); setPicker(false); } }}
                  className="h-[72px] w-[72px] flex-shrink-0 overflow-hidden rounded-xl border border-border transition-colors hover:border-primary"
                >
                  <img src={item.url} alt="Upscaled" loading="lazy" className="h-full w-full object-cover" />
                </button>
              </Tip>
            ))}
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="h-[52vh] w-full flex-shrink-0 md:h-full md:w-[400px]">
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
