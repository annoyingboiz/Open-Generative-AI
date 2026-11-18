"use client";

// DZ: Tools — Lip Sync, Motion Control, Talking Photo, Character Swap, Audio.
// Cards to pick a tool; each tool is the Create engine narrowed to its models
// (see dzTools.js): the slots it needs under its own names, the model's own
// settings, price before Generate, results of that tool below.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dzGenerate, dzWithMeta } from "../api.js";
import { useDzQuote } from "./DzPrice.jsx";
import { useDzHistory } from "../dzLibrary.js";
import { useDzContext } from "../dzContext.js";
import { dzSetStudioState, DZ_INSERT_EVENT } from "../dzStudioState.js";
import { useDzSelection, GridToolbar } from "./DzSelection.jsx";
import { Viewer } from "./DzLibrary.jsx";
import { ParamControl, ModelPicker, MediaSlot, ResultCard, fmtUsd } from "./DzCreateStudio.jsx";
import { createEntries, chooseVariant, missingFor, buildBody, keepValues, paramsOf } from "../dzCreate.js";
import { TOOLS, toolById } from "../dzTools.js";
import { Button, Textarea, Spinner, Popover, PopoverTrigger, PopoverContent, cn } from "../ui/index.js";

const STORE = "dz_tools_v1";
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isScalar = (x) => ["string", "number", "boolean"].includes(typeof x);
const cleanAttached = (a) => (isObj(a) ? Object.fromEntries(Object.entries(a).filter(([, l]) => Array.isArray(l)).map(([r, l]) => [r, l.filter((f) => isObj(f) && typeof f.url === "string").slice(0, 9).map((f) => ({ url: f.url, name: typeof f.name === "string" ? f.name : "" }))])) : {});
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "{}");
    if (!isObj(s)) return {};
    const per = isObj(s.per) ? Object.fromEntries(Object.entries(s.per).filter(([id, v]) => toolById(id) && isObj(v)).map(([id, v]) => [id, {
      model: typeof v.model === "string" ? v.model : undefined,
      values: isObj(v.values) ? Object.fromEntries(Object.entries(v.values).filter(([, x]) => isScalar(x))) : {},
      prompt: typeof v.prompt === "string" ? v.prompt : "",
      attached: cleanAttached(v.attached),
    }])) : {};
    return { tool: toolById(s.tool) ? s.tool : null, per };
  } catch { return {}; }
}

const ICONS = {
  lipsync: <path d="M4 12c2.5-3 5.5-4 8-4s5.5 1 8 4c-2.5 3-5.5 4-8 4s-5.5-1-8-4zM4 12h16" />,
  motion: <><circle cx="13" cy="4" r="2" /><path d="M9 21l2-6 3 2v4M7 12l3-4 4 1 3 3M11 15l-2-3" /></>,
  avatar: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0M17 3c1.5 1 1.5 3 0 4M19.5 1.5c2.5 2 2.5 5 0 7" /></>,
  swap: <><path d="M7 4L3 8l4 4M3 8h12M17 20l4-4-4-4M21 16H9" /></>,
  audio: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
};
const ToolIcon = ({ id, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[id]}</svg>
);

export default function DzTools({ apiKey, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError }) {
  const saved = useMemo(load, []);
  const [toolId, setToolId] = useState(saved.tool || null);
  const [per, setPer] = useState(saved.per || {});
  const tool = toolById(toolId);
  const state = (tool && per[tool.id]) || { values: {}, prompt: "", attached: {} };
  const update = (patch) => setPer((prev) => {
    const cur = prev[tool.id] || { values: {}, prompt: "", attached: {} };
    return { ...prev, [tool.id]: { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) } };
  });
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify({ tool: toolId, per })); } catch { /* optional */ } }, [toolId, per]);

  const [catalogReady, setCatalogReady] = useState(false);
  useEffect(() => { setCatalogReady(true); }, []);
  // Models of every tool (to show counts on the cards).
  const entriesByTool = useMemo(() => (catalogReady ? Object.fromEntries(TOOLS.map((t) => [t.id, createEntries(t.kind, { match: t.match })])) : {}), [catalogReady]);
  const entries = (tool && entriesByTool[tool.id]) || [];
  const entry = entries.find((e) => e.key === state.model) || entries[0] || null;

  const attached = state.attached || {};
  const slotRoles = new Set((entry?.slots || []).map((s) => s.role));
  const used = Object.fromEntries(Object.entries(attached).filter(([role, files]) => slotRoles.has(role) && files?.length));
  const variant = entry ? chooseVariant(entry, used) : null;
  const params = useMemo(() => {
    if (!variant) return { main: [], advanced: [] };
    const all = [...paramsOf(variant.model).main, ...paramsOf(variant.model).advanced];
    const promoted = (tool?.main || []).map((k) => all.find((p) => p.key === k)).filter(Boolean);
    const base = paramsOf(variant.model).main.filter((p) => !promoted.includes(p));
    const main = [...promoted, ...base].slice(0, 5);
    return { main, advanced: all.filter((p) => !main.includes(p)) };
  }, [variant, tool]);
  const values = variant ? keepValues(state.values || {}, variant) : state.values || {};
  const labels = tool?.labels || {};
  const prompt = state.prompt || "";
  const [uploads, setUploads] = useState(0);
  const missing = entry && !variant ? "This model can't take these files together. Remove some or pick another model." : missingFor(variant, used, labels);
  const hasPrompt = variant ? variant.model.hasPrompt !== false : false;
  const needsPrompt = Boolean(variant?.model.promptRequired);
  const canRun = Boolean(variant && !missing && !uploads && (!needsPrompt || prompt.trim()) && (prompt.trim() || Object.keys(used).length));
  const body = variant && canRun ? buildBody(variant, { prompt: hasPrompt ? prompt.trim() : "", values, attached: used }) : null;
  const quoteBody = body || (variant && !missing && !uploads ? buildBody(variant, { prompt: prompt.trim() || "price check", values, attached: used }) : null);
  const { price, loading: priceLoading } = useDzQuote(apiKey, () => (quoteBody ? [dzGenerate, { endpoint: variant.model.endpoint, ...quoteBody }] : null), 1, { textMatters: tool?.kind === "audio" });

  // The side chat sees the open tool and its text; it can write into it.
  const promptRef = useRef(null);
  useEffect(() => {
    dzSetStudioState("tools", { model: entry && tool ? { family: entry.family, name: `${entry.familyName} (${tool.title})`, kind: tool.kind } : null, prompt, writable: Boolean(tool && hasPrompt) });
  }, [entry, tool, prompt, hasPrompt]);
  useEffect(() => {
    const on = (e) => {
      const { tab, text, how } = e.detail || {};
      if (tab !== "tools" || !tool || typeof text !== "string" || !text.trim()) return;
      update((cur) => ({ prompt: how === "replace" || !String(cur.prompt || "").trim() ? text.trim() : `${String(cur.prompt).replace(/\s+$/, "")}\n\n${text.trim()}` }));
      requestAnimationFrame(() => promptRef.current?.focus());
    };
    window.addEventListener(DZ_INSERT_EVENT, on);
    return () => window.removeEventListener(DZ_INSERT_EVENT, on);
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickModel = (key) => {
    const next = entries.find((e) => e.key === key);
    const nextVariant = next ? chooseVariant(next, {}) || next.variants[0] : null;
    update((cur) => ({ model: key, values: keepValues(cur.values || {}, nextVariant) }));
  };
  const setValue = (key, v) => update((cur) => ({ values: { ...(cur.values || {}), [key]: v } }));
  const addUrls = (role, list) => {
    const slot = entry?.slots.find((s) => s.role === role);
    if (!slot) return;
    update((cur) => {
      const have = cur.attached?.[role] || [];
      const add = list.filter((x) => !have.some((h) => h.url === x.url)).map((x) => ({ url: x.url, name: x.name || "" }));
      return { attached: { ...(cur.attached || {}), [role]: [...have, ...add].slice(0, slot.max) } };
    });
  };
  const removeFile = (role, i) => update((cur) => ({ attached: { ...(cur.attached || {}), [role]: (cur.attached?.[role] || []).filter((_, j) => j !== i) } }));

  const [busy, setBusy] = useState(0);
  const generate = useCallback(async () => {
    if (!canRun || !variant || !tool) return;
    const meta = { kind: tool.kind, tool: tool.id, toolTitle: tool.title, entryKey: entry.key, modelName: `${entry.familyName} · ${entry.providerName}`, prompt, values, attached: used };
    const request = { endpoint: variant.model.endpoint, ...body };
    setBusy((n) => n + 1);
    onGenerationStart?.();
    try {
      const res = await dzWithMeta({ studio: "tools", meta }, () => dzGenerate(apiKey, request));
      onGenerationEnd?.();
      if (res?.url) onGenerationComplete?.({ url: res.url, type: tool.kind });
    } catch (e) {
      onGenerationEnd?.();
      onGenerationError?.(String(e?.message || e).replace(/^API Request Failed: \d+ [^-]*- /, ""));
    } finally {
      setBusy((n) => n - 1);
    }
  }, [canRun, variant, tool, entry, prompt, values, used, body, apiKey, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError]);

  const reuse = (item) => {
    const m = item.meta || {};
    if (!toolById(m.tool)) return;
    setToolId(m.tool);
    setPer((prev) => ({ ...prev, [m.tool]: {
      model: typeof m.entryKey === "string" ? m.entryKey : prev[m.tool]?.model,
      values: isObj(m.values) ? Object.fromEntries(Object.entries(m.values).filter(([, x]) => isScalar(x))) : {},
      prompt: typeof m.prompt === "string" ? m.prompt : "",
      attached: cleanAttached(m.attached),
    } }));
  };

  // Results of this tool in the current place (all tools on the cards page).
  const ctx = useDzContext();
  const history = useDzHistory({ studio: "tools", ...(tool ? { kind: tool.kind } : {}), ...(ctx.project ? { project: ctx.project.id, folder: ctx.folder || undefined } : { project: "none" }) });
  const items = useMemo(() => (tool ? history.items.filter((i) => !i.meta?.tool || i.meta.tool === tool.id) : history.items), [history.items, tool]);
  const sel = useDzSelection(items);
  const [viewing, setViewing] = useState(null);

  const cards = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {TOOLS.map((t) => {
        const n = entriesByTool[t.id]?.length || 0;
        return (
          <button key={t.id} type="button" onClick={() => setToolId(t.id)} disabled={catalogReady && n === 0}
            className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary"><ToolIcon id={t.id} /></span>
            <span className="text-lg font-semibold text-foreground">{t.title}</span>
            <span className="leading-snug text-muted-foreground">{t.text}</span>
            <span className="mt-auto text-muted-foreground/80">{catalogReady ? (n ? `${n} model${n === 1 ? "" : "s"}` : "No models with your keys") : ""}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 px-4 pt-3 md:px-8">
        <div className="mx-auto max-w-[1600px] space-y-3">
          <GridToolbar ctx={ctx} sel={sel} title={tool ? tool.title : "Tools"} canSelect={items.length > 0}>
            {tool && <Button variant="secondary" size="sm" onClick={() => setToolId(null)}>All tools</Button>}
          </GridToolbar>
          {tool && (
            <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1" role="tablist" aria-label="Tools">
              {TOOLS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={t.id === tool.id} onClick={() => setToolId(t.id)}
                  className={cn("flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 font-medium transition-colors", t.id === tool.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                  <ToolIcon id={t.id} size={16} />{t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-6 pt-3 md:px-8">
        <div className="mx-auto max-w-[1600px] space-y-6">
          {!tool && cards}
          {tool && history.loaded && items.length === 0 && (
            <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary"><ToolIcon id={tool.id} size={28} /></span>
              <div className="text-3xl font-bold text-foreground">{tool.title}</div>
              <p className="text-lg text-muted-foreground">{tool.text}</p>
            </div>
          )}
          {items.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {items.map((item) => (
                <ResultCard key={item.id} item={item} sel={sel} onOpen={setViewing} onReuse={reuse} onLike={history.like}
                  onTrash={(id) => history.trash(id).catch((e) => onGenerationError?.(String(e?.message || e)))} />
              ))}
            </div>
          )}
          {history.hasMore && (
            <div className="flex justify-center py-6"><Button variant="secondary" onClick={history.loadMore} disabled={history.loadingMore}>{history.loadingMore ? "Loading…" : "Load more"}</Button></div>
          )}
        </div>
      </div>

      {tool && (
        <div className="flex-shrink-0 border-t border-border bg-card/80 px-3 pb-3 pt-3 backdrop-blur md:px-6">
          <div className="mx-auto max-w-[1100px] space-y-3">
            {!entry && <p className="text-muted-foreground">No {tool.title} models with your provider keys yet.</p>}
            {entry && entry.slots.length > 0 && (
              <div className="flex gap-4 overflow-x-auto custom-scrollbar pb-1">
                {entry.slots.map((s) => (
                  <MediaSlot key={s.role} role={s.role} max={s.max} label={labels[s.role]} files={attached[s.role] || []} apiKey={apiKey} onError={onGenerationError}
                    onUploading={(on) => setUploads((n) => Math.max(0, n + (on ? 1 : -1)))}
                    onPick={(list) => addUrls(s.role, list)} onRemove={(i) => removeFile(s.role, i)} />
                ))}
              </div>
            )}
            {entry && hasPrompt && (
              <Textarea ref={promptRef} value={prompt} onChange={(e) => update({ prompt: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); } }}
                rows={tool.kind === "audio" ? 5 : 2} placeholder={tool.promptLabel} aria-label={tool.promptLabel}
                className="min-h-[64px] max-h-[45vh] resize-y rounded-2xl text-base" />
            )}
            {entry && (
              <div className="flex flex-wrap items-center gap-2">
                <ModelPicker entries={entries} entry={entry} onPick={pickModel} />
                {params.main.map((p) => <ParamControl key={p.key} p={p} value={values[p.key]} onChange={(v) => setValue(p.key, v)} compact={p.key === "duration"} />)}
                {params.advanced.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="secondary" className="h-10 rounded-xl px-3 font-medium">Advanced</Button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="max-h-[60vh] w-[min(420px,calc(100vw-24px))] space-y-3 overflow-y-auto custom-scrollbar rounded-2xl">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Advanced settings</span>
                        <Button size="sm" variant="ghost" onClick={() => update((cur) => {
                          const next = { ...(cur.values || {}) };
                          for (const p of params.advanced) delete next[p.key];
                          return { values: next };
                        })}>Reset</Button>
                      </div>
                      {params.advanced.map((p) => <ParamControl key={p.key} p={p} value={values[p.key]} onChange={(v) => setValue(p.key, v)} />)}
                    </PopoverContent>
                  </Popover>
                )}
                <div className="ml-auto flex items-center gap-3">
                  <span className={cn("tabular-nums", priceLoading ? "text-muted-foreground/60" : "text-muted-foreground")} title={price ? (price.exact ? "Exact price for your account" : "Estimate") : undefined}>
                    {price ? `${price.exact ? "" : "≈ "}${fmtUsd(price.usd)}` : entry.priceLabel || ""}
                  </span>
                  <Button size="lg" className="h-11 rounded-xl px-6" onClick={generate} disabled={!canRun}>
                    {busy > 0 ? <><Spinner className="h-4 w-4 border-primary-foreground/30 border-t-primary-foreground" /> Generating{busy > 1 ? ` · ${busy}` : ""}</> : "Generate"}
                  </Button>
                </div>
              </div>
            )}
            {missing && <p className="text-amber-300">{missing}</p>}
          </div>
        </div>
      )}
      <Viewer item={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
