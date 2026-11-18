"use client";

// DZ: Upscale → Video. Models from fal.ai and Atlas Cloud (the server spec
// window.__DZ_CATALOG__.tools.videoUpscale, the same one the gateway uses to
// build each provider's request and price).
//   DzVideoUpscalePanel  model, target (1080p / 2K / 4K), its settings, price
//   DzVideoUpscaleView   the video half of the Upscale tab: pick a video,
//                        compare before/after, recent video upscales
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dzUpscaleVideo, dzVideoUpscaleQuote, uploadFile, dzThumb } from "../api.js";
import { dzVideoUpscaleSpec, dzIsOwnImage } from "../dzCatalog.js";
import { DzMediaBrowser } from "./DzMedia.jsx";
import { Field, fieldApplies } from "./DzToolFields.jsx";
import { useDzContext } from "../dzContext.js";
import { Button, buttonVariants, Segmented, OptionSelect, Tip, SectionLabel, Spinner, cn } from "../ui/index.js";

const STORE_KEY = "dz_video_upscale_settings";
const VIEW_KEY = "dz_video_upscale_view";
const fmtUsd = (usd) => `$${usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* optional */ } };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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

// The spec from the server; a key added later shows up on the next "dz:tools".
export function useDzVideoUpscaleSpec() {
  const [spec, setSpec] = useState(() => dzVideoUpscaleSpec());
  useEffect(() => {
    const onTools = () => setSpec(dzVideoUpscaleSpec());
    window.addEventListener("dz:tools", onTools);
    onTools();
    return () => window.removeEventListener("dz:tools", onTools);
  }, []);
  return spec;
}

// Short price note for the model list (4K from 720p, 24 fps ≈ 199 MP per second).
function priceNote(m) {
  if (m.price.kind === "topaz") return m.price.half ? "$0.04/s at 4K" : "$0.08/s at 4K";
  if (m.price.kind === "mp") return `≈${fmtUsd(m.price.usd * 199)}/s at 4K`;
  return "priced by length";
}

export function DzVideoUpscalePanel({ apiKey, videoUrl, onStart, onDone, onError, isAdmin = false }) {
  const spec = useDzVideoUpscaleSpec();
  const saved = useMemo(() => load(STORE_KEY), []);
  const [modelId, setModelId] = useState(saved.modelId || null);
  const model = spec?.models.find((m) => m.id === modelId) || spec?.models?.[0];
  const [targetBy, setTargetBy] = useState(saved.targetBy || {});
  const target = model && (model.targets.includes(targetBy[model.id]) ? targetBy[model.id] : model.targets.includes("4k") ? "4k" : model.targets.at(-1));
  const [values, setValues] = useState(saved.values || {}); // per model id
  const [busy, setBusy] = useState(0);
  const [quote, setQuote] = useState({ price: null, problem: null, needsCheck: false, info: null, loading: false });
  const [checkSeq, setCheckSeq] = useState(0); // "Check price" asked for this request
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { store(STORE_KEY, { modelId, targetBy, values }); }, [modelId, targetBy, values]);

  const modelValues = (model && values[model.id]) || {};
  const setValue = (key, v) => setValues((prev) => ({ ...prev, [model.id]: { ...(prev[model.id] || {}), [key]: v } }));
  const valueOf = useCallback((key) => {
    const f = model?.fields.find((x) => x.key === key);
    const v = modelValues[key];
    return v === undefined || v === null || v === "" ? f?.default : v;
  }, [model, modelValues]);
  const changed = Boolean(model?.fields.some((f) => modelValues[f.key] !== undefined && modelValues[f.key] !== null));
  const reset = () => setValues((prev) => ({ ...prev, [model.id]: {} }));

  const body = useMemo(() => {
    if (!model || !videoUrl) return null;
    const b = { tool_model: model.id, video_url: videoUrl, target };
    for (const f of model.fields) {
      if (!fieldApplies(f, valueOf)) continue;
      const v = valueOf(f.key);
      if (v !== undefined && v !== null && v !== "") b[f.key] = v;
    }
    return b;
  }, [model, videoUrl, target, valueOf]);
  const canRun = Boolean(body && dzIsOwnImage(videoUrl));

  // Price, debounced. Atlas models: the first check sends the video to Atlas (reused when you upscale).
  // Atlas prices need the video at Atlas: the first check is asked for ("Check price").
  const bodyKey = canRun ? JSON.stringify([model.provider, model.endpoint, body]) : "";
  const checkFor = useRef({ key: "", seq: 0 });
  useEffect(() => {
    if (!bodyKey) { setQuote({ price: null, problem: null, needsCheck: false, info: null, loading: false }); return undefined; }
    let cancelled = false;
    // Nothing from the previous request stays on screen (price, warning) while this one is checked.
    setQuote((q) => ({ price: null, problem: null, needsCheck: false, info: q.info, loading: true }));
    const check = checkSeq > 0 && checkFor.current.seq === checkSeq && checkFor.current.key === bodyKey;
    const timer = setTimeout(async () => {
      const [provider, endpoint, b] = JSON.parse(bodyKey);
      const r = await dzVideoUpscaleQuote({ provider, endpoint, ...b, ...(check ? { check: true } : {}) });
      if (!cancelled) setQuote({ ...r, loading: false });
    }, check ? 0 : 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bodyKey, checkSeq]);
  const askPrice = () => { const seq = checkSeq + 1; checkFor.current = { key: bodyKey, seq }; setCheckSeq(seq); };

  const run = useCallback(async () => {
    if (!canRun || quote.problem) return;
    if (mounted.current) setBusy((n) => n + 1);
    onStart?.({ source: videoUrl });
    try {
      const res = await dzUpscaleVideo(apiKey, { provider: model.provider, endpoint: model.endpoint, ...body });
      if (!res?.url) throw new Error("No result file");
      onDone?.({ url: res.url, source: videoUrl, model: model.id, target, id: res.request_id });
    } catch (e) {
      onError?.(String(e?.message || e).replace(/^API Request Failed: \d+ [^-]*- /, ""));
    } finally {
      if (mounted.current) setBusy((n) => n - 1);
    }
  }, [canRun, quote.problem, apiKey, model, body, videoUrl, target, onStart, onDone, onError]);

  if (!spec) {
    return (
      <div className="flex h-full flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6">
        <div className="text-lg font-semibold text-foreground">Video upscaling is not set up yet</div>
        <p className="text-base leading-relaxed text-muted-foreground">
          It uses models on fal.ai and Atlas Cloud. {isAdmin ? "Add a fal.ai or Atlas key in Settings." : "Ask the admin to add a fal.ai or Atlas key in Settings."}
        </p>
        {isAdmin && <a href="/settings" className={buttonVariants()}>Open Settings</a>}
      </div>
    );
  }

  const price = quote.price;
  const input = price?.input || quote.info?.input;
  const output = price?.output || quote.info?.output;
  const visible = model.fields.filter((f) => fieldApplies(f, valueOf));
  const targetLabel = (id) => spec.targets.find((t) => t.id === id)?.label || id;
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card">
      <div className="flex-1 space-y-6 overflow-y-auto custom-scrollbar p-5">
        <section className="space-y-2">
          <SectionLabel>Model</SectionLabel>
          <OptionSelect
            aria-label="Model"
            value={model.id}
            onValueChange={setModelId}
            options={spec.models.map((m) => ({ value: m.id, label: m.name, description: m.hint, meta: priceNote(m) }))}
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Resolution</SectionLabel>
            {input && output && <span className="tabular-nums text-muted-foreground">{input.width}×{input.height} → {output.width}×{output.height}</span>}
          </div>
          <Segmented value={target} onChange={(v) => setTargetBy((p) => ({ ...p, [model.id]: v }))} aria-label="Resolution"
            options={model.targets.map((t) => ({ value: t, label: targetLabel(t) }))} />
        </section>

        {model.fields.length > 0 && (
          <section className="rounded-xl border border-border bg-background/40 px-4">
            <div className="divide-y divide-border/60 pb-1">
              {visible.map((f) => <Field key={f.key} field={f} value={modelValues[f.key]} onChange={(v) => setValue(f.key, v)} />)}
            </div>
            {changed && (
              <div className="flex justify-end border-t border-border py-2">
                <Button size="sm" variant="ghost" onClick={reset}>Reset to defaults</Button>
              </div>
            )}
          </section>
        )}
      </div>

      <div className="space-y-3 border-t border-border p-5">
        {quote.problem && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-base text-warning">{quote.problem}</p>}
        <div className="flex items-center justify-between gap-3 text-base">
          <span className="text-muted-foreground">
            {input ? `${input.duration} s · ${input.fps} fps${input.audio ? " · sound kept" : ""}` : videoUrl ? (dzIsOwnImage(videoUrl) ? (quote.loading ? "Checking the video…" : "") : "Upload this video first") : "Choose a video"}
          </span>
          <span className={cn("font-semibold tabular-nums", quote.loading ? "text-muted-foreground/60" : "text-foreground")} title={price ? (price.exact ? "Exact price for this video" : "Estimate") : undefined}>
            {price ? `${price.exact ? "" : "≈ "}${fmtUsd(price.usd)}` : ""}
          </span>
        </div>
        {quote.needsCheck && !price ? (
          <Button size="lg" variant="secondary" className="w-full" onClick={askPrice} disabled={!canRun || quote.loading}>
            {quote.loading ? <><Spinner className="h-4 w-4" /> Checking…</> : "Check price"}
          </Button>
        ) : (
          <Button size="lg" className="w-full" onClick={run} disabled={!canRun || Boolean(quote.problem) || (!price && quote.loading)}>
            {busy > 0 ? <><Spinner className="h-4 w-4 border-primary-foreground/30 border-t-primary-foreground" /> Upscaling{busy > 1 ? ` · ${busy}` : ""}…</> : `Upscale video${price ? ` · ${fmtUsd(price.usd)}` : ""}`}
          </Button>
        )}
        <p className="text-center text-base text-muted-foreground">
          {quote.needsCheck && !price ? "Atlas prices by the video itself: the check sends it to Atlas (free)." : busy > 0 ? "Takes a few minutes. You can start another one or leave this tab." : "Takes a few minutes; the result lands in your work."}
        </p>
      </div>
    </div>
  );
}

// Before/after on one picture: drag the line; both videos play in step.
function VideoCompare({ before, after }) {
  const [pos, setPos] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(true);
  const box = useRef(null);
  const a = useRef(null); // after (leads)
  const b = useRef(null); // before (follows)
  const move = (clientX) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  const sync = () => {
    if (!a.current || !b.current) return;
    if (Math.abs(b.current.currentTime - a.current.currentTime) > 0.08) b.current.currentTime = a.current.currentTime;
  };
  const toggle = async () => {
    if (!a.current) return;
    if (a.current.paused) { sync(); await Promise.all([a.current.play().catch(() => {}), b.current?.play().catch(() => {})]); } else { a.current.pause(); b.current?.pause(); }
  };
  const seek = (t) => { if (a.current) a.current.currentTime = t; if (b.current) b.current.currentTime = t; setTime(t); };
  return (
    <div className="flex h-full w-full flex-col">
      <div
        ref={box}
        className="relative min-h-0 flex-1 select-none overflow-hidden"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e.clientX); }}
        onPointerMove={(e) => { if (e.buttons) move(e.clientX); }}
      >
        <video ref={a} src={after} muted={muted} loop playsInline preload="auto" className="absolute inset-0 h-full w-full object-contain"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(e) => { setTime(e.currentTarget.currentTime); sync(); }}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)} onSeeked={sync} />
        <video ref={b} src={before} muted loop playsInline preload="auto" className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
        <div className="absolute inset-y-0 w-0.5 bg-overlay-foreground/80 shadow" style={{ left: `${pos}%` }}>
          <div className="absolute top-1/2 left-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-overlay-foreground text-base font-bold text-overlay shadow-lg">⇆</div>
        </div>
        <span className="absolute top-3 left-3 rounded-lg bg-overlay/70 px-2.5 py-1 text-base font-semibold text-overlay-foreground/90">Before</span>
        <span className="absolute top-3 right-3 rounded-lg bg-overlay/70 px-2.5 py-1 text-base font-semibold text-overlay-foreground/90">After</span>
      </div>
      <div className="flex items-center gap-3 border-t border-border bg-overlay/40 px-4 py-2.5">
        <Button size="sm" variant="secondary" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? "Pause" : "Play"}</Button>
        <input type="range" min={0} max={duration || 0} step={0.01} value={time} onChange={(e) => seek(Number(e.target.value))} className="flex-1 accent-primary" aria-label="Position" />
        <span className="w-24 text-right tabular-nums text-muted-foreground">{fmtTime(time)} / {fmtTime(duration)}</span>
        <Button size="sm" variant="ghost" onClick={() => setMuted((m) => !m)}>{muted ? "Sound off" : "Sound on"}</Button>
      </div>
    </div>
  );
}

export function DzVideoUpscaleView({ apiKey, initialPick, isAdmin = false, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError, droppedFiles, onFilesHandled }) {
  const [source, setSource] = useState(() => initialPick?.url || null);
  const [result, setResult] = useState(null); // { url, source }
  useEffect(() => {
    if (initialPick?.url) return;
    const v = load(VIEW_KEY);
    if (dzIsOwnImage(v.source)) { setSource(v.source); if (v.result?.source === v.source) setResult(v.result); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { store(VIEW_KEY, { source, result }); }, [source, result]);
  const [recent, setRecent] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState(false);
  const [running, setRunning] = useState(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  // A new object on every "Upscale" click, even for the same video.
  useEffect(() => { if (initialPick?.url) { setSource(initialPick.url); setResult(null); setPicker(false); } }, [initialPick]);

  const ctx = useDzContext();
  const scopeQuery = ctx.project ? `&project=${encodeURIComponent(ctx.project.id)}` : "";
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/history?limit=60&studio=upscale&kind=video${scopeQuery}`);
      if (res.ok) setRecent(((await res.json()).items || []).filter((i) => i.status !== "failed"));
    } catch { /* shown as empty */ }
  }, [scopeQuery]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  // While upscales run, the list refreshes so finished ones show up.
  useEffect(() => {
    if (!running && !recent.some((i) => i.status === "processing")) return undefined;
    const t = setInterval(loadHistory, 15_000);
    return () => clearInterval(t);
  }, [running, recent, loadHistory]);

  const uploadSeq = useRef(0);
  const upload = useCallback(async (file) => {
    if (!file || !/^video\//.test(file.type)) { onGenerationError?.("Choose a video file (MP4, MOV or WebM)."); return; }
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

  const modelName = (id) => dzVideoUpscaleSpec()?.models.find((m) => m.id === id)?.name || id || "";

  return (
    <div className="flex h-full w-full flex-col gap-5 overflow-hidden md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <div className="relative min-h-[300px] flex-1 overflow-hidden rounded-2xl border border-border bg-card">
          {source && !picker ? (
            result && result.source === source ? (
              <VideoCompare before={source} after={result.url} />
            ) : (
              <video src={source} controls playsInline className="absolute inset-0 h-full w-full object-contain" />
            )
          ) : (
            <div className="flex h-full flex-col overflow-hidden p-4">
              <div className="flex flex-wrap items-center gap-3 pb-3">
                <div className="mr-auto">
                  <div className="text-xl font-semibold text-foreground">Choose a video to upscale</div>
                  <div className="text-base text-muted-foreground">Drop a file anywhere, upload one, or pick from your work.</div>
                </div>
                {uploading && <span className="flex items-center gap-2 text-muted-foreground"><Spinner className="h-4 w-4" /> Uploading…</span>}
                {source && <Button variant="secondary" onClick={() => setPicker(false)}>Cancel</Button>}
              </div>
              <div className="min-h-0 flex-1">
                <DzMediaBrowser inline accept="video" max={1} apiKey={apiKey} onError={onGenerationError} onUploading={setUploading}
                  onConfirm={(list) => { if (list[0]?.url) { setSource(list[0].url); setResult(null); setPicker(false); } }} />
              </div>
            </div>
          )}
          {source && !picker && (
            <div className={cn("absolute left-4 flex gap-2", result && result.source === source ? "bottom-16" : "top-4")}>
              <Button variant="secondary" size="sm" className="bg-overlay/70 text-overlay-foreground backdrop-blur hover:bg-overlay/90" onClick={() => setPicker(true)}>Change video</Button>
              {result && result.source === source && (
                <Button variant="secondary" size="sm" className="bg-overlay/70 text-overlay-foreground backdrop-blur hover:bg-overlay/90" onClick={() => downloadFile(result.url, `upscaled-${Date.now()}.${result.url.split(".").pop()}`)}>Download</Button>
              )}
            </div>
          )}
        </div>

        <div className="h-[112px] flex-shrink-0 space-y-2">
          <SectionLabel>Recent video upscales</SectionLabel>
          {recent.length === 0 && <p className="text-base text-muted-foreground/70">Your upscaled videos will appear here.</p>}
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
            {recent.slice(0, 30).map((item) => {
              const up = item.meta?.upscale || {};
              const label = `${modelName(up.model)} · ${(up.target || "").toUpperCase()}${item.cost_usd != null ? ` · ${fmtUsd(item.cost_usd)}` : ""}`;
              return (
                <Tip key={item.id} text={item.url ? label : `Upscaling… ${label}`}>
                  <button
                    type="button"
                    disabled={!item.url}
                    onClick={() => { const src = up.source || item.params?.video_url; if (src && item.url) { setSource(src); setResult({ url: item.url, source: src }); setPicker(false); } }}
                    className="relative h-[72px] w-[72px] flex-shrink-0 overflow-hidden rounded-xl border border-border transition-colors hover:border-input disabled:cursor-wait"
                  >
                    {item.url
                      ? <img src={dzThumb(item.url, 256)} alt="Upscaled video" loading="lazy" className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center bg-muted/40"><Spinner className="h-5 w-5" /></span>}
                    {up.target && <span className="absolute bottom-1 left-1 rounded bg-overlay/75 px-1 text-sm font-semibold text-overlay-foreground">{up.target.toUpperCase()}</span>}
                  </button>
                </Tip>
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-[56vh] w-full flex-shrink-0 md:h-full md:w-[400px]">
        <DzVideoUpscalePanel
          apiKey={apiKey}
          isAdmin={isAdmin}
          videoUrl={source}
          onStart={() => { setRunning((n) => n + 1); onGenerationStart?.(); setTimeout(loadHistory, 1500); }}
          onDone={(r) => {
            setRunning((n) => n - 1);
            onGenerationEnd?.();
            if (r.source === sourceRef.current) setResult({ url: r.url, source: r.source });
            onGenerationComplete?.({ url: r.url, type: "video" });
            loadHistory();
          }}
          onError={(msg) => { setRunning((n) => n - 1); onGenerationEnd?.(); onGenerationError?.(msg); loadHistory(); }}
        />
      </div>
    </div>
  );
}
