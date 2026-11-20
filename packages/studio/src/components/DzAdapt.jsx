"use client";

// DZ: "Adapt to model" — a text model rewrites the prompt by the prompting
// notes of the chosen image/video model (gateway: /dz/api/prompt/adapt).
// You see the new version, edit it, and only "Use this" puts it in the prompt.
import { useEffect, useMemo, useRef, useState } from "react";
import { useDzLlmModels } from "../dzLlm.js";
import { Button, Textarea, OptionSelect, Spinner, DialogParts, Segmented, cn } from "../ui/index.js";
import { RequestView } from "./DzSentPanel.jsx";

const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = DialogParts;
export const LLM_KEY = "dz_adapt_llm";
const money = (v) => (v == null ? "" : v === 0 ? "free" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);

export async function post(url, body) {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Adapt results (package 07, F2). One result per input, kept per composer.
// The input is exactly what the adapter gets: the prompt, the target model
// (family + kind), the context (mode, duration, aspect, audio, camera words, the
// attached files and elements by tag), the text model and the format. The camera
// look is not sent (the server adds it on every send), so it is not part of it.
// The scope is the composer: a tool tab (Image, Video, Studio) or one shot / group.
const RESULTS_KEY = "dz_adapt_results_v3";
const MAX_RECORDS = 100; // over every composer, the oldest go first
function hash(str) { // cyrb53: a short, stable key for a long input
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export function adaptInputKey({ prompt, model, context, llm, as }) {
  return hash(JSON.stringify([String(prompt ?? ""), model?.family || "", model?.kind || "", context ?? null, llm || "", as || "text"]));
}
// { [scope]: { [format]: { [inputKey]: rec } } }, rec: { key, result, at, used?, usedKey? }
// usedKey: the input once the result is in the prompt ("Use this"), so it shows as in use.
function readResults() {
  try {
    localStorage.removeItem("dz_studio_adapt_v1"); // one result per format for every composer: the Negroni bug
    localStorage.removeItem("dz_adapt_results_v2");
    const v = JSON.parse(localStorage.getItem(RESULTS_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function writeResults(all) {
  const flat = [];
  for (const [sc, formats] of Object.entries(all)) for (const [f, recs] of Object.entries(formats || {})) for (const [k, rec] of Object.entries(recs || {})) flat.push([sc, f, k, rec?.at || 0]);
  if (flat.length > MAX_RECORDS) {
    flat.sort((a, b) => a[3] - b[3]);
    for (const [sc, f, k] of flat.slice(0, flat.length - MAX_RECORDS)) {
      delete all[sc][f][k];
      if (!Object.keys(all[sc][f]).length) delete all[sc][f];
      if (!Object.keys(all[sc]).length) delete all[sc];
    }
  }
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify(all)); } catch { /* full or off: nothing kept */ }
}
// The kept result for this input: made from it, or put in use by it.
export function adaptRecall(scope, as, key) {
  if (!scope) return null;
  const recs = readResults()[scope]?.[as] || {};
  const ok = (rec) => rec?.result && typeof rec.result.prompt === "string";
  if (ok(recs[key])) return { rec: recs[key], inUse: recs[key].usedKey === key };
  const used = Object.values(recs).find((rec) => ok(rec) && rec.usedKey === key);
  return used ? { rec: used, inUse: true } : null;
}
export function adaptRemember(scope, as, rec) {
  if (!scope || !rec?.key) return;
  const all = readResults();
  all[scope] = all[scope] || {};
  all[scope][as] = { ...(all[scope][as] || {}), [rec.key]: { ...rec, at: Date.now() } };
  writeResults(all);
}
export function adaptForget(scope) {
  if (!scope) return;
  const all = readResults();
  if (all[scope]) { delete all[scope]; writeResults(all); }
}

// The adaptation on screen for the current input (package 07, F2). One result per
// input, kept per composer: no result → it runs; the same input → the kept one, no
// call; another input → it runs by itself and "Use this" waits (`current` is false)
// until the result for this input is there. A call already running for an input is
// joined, not repeated; Regenerate (`run(true)`) always makes a new one.
export function useAdaptResult({ active, loaded, scope, prompt, model, context, llm, as }) {
  const currentKey = adaptInputKey({ prompt, model, context, llm, as });
  // key: the input the result on screen belongs to; saved: the kept record shown (null for a fresh run).
  const [state, setState] = useState({ busy: false, error: "", result: null, key: null, saved: null });
  const [text, setText] = useState("");
  const seq = useRef(0);
  const inflight = useRef(new Map()); // input key → its call
  const run = async (force = false) => {
    const mine = ++seq.current;
    const key = currentKey;
    const format = as;
    setState({ busy: true, error: "", result: null, key, saved: null });
    try {
      let call = force ? null : inflight.current.get(key);
      if (!call) {
        const made = post("/dz/api/prompt/adapt", { prompt, model, context, llm: llm || undefined, as: format });
        call = made;
        inflight.current.set(key, made);
        // Kept for its own input even if the screen moved on meanwhile; a newer call for the same input wins.
        made.then((r) => { if (inflight.current.get(key) === made) adaptRemember(scope, format, { key, result: r }); }, () => {})
          .finally(() => { if (inflight.current.get(key) === made) inflight.current.delete(key); });
      }
      const r = await call;
      if (mine !== seq.current) return;
      setState({ busy: false, error: "", result: r, key, saved: null });
      setText(r.prompt);
    } catch (e) {
      if (mine === seq.current) setState({ busy: false, error: String(e?.message || e), result: null, key, saved: null });
    }
  };
  useEffect(() => {
    if (!active || !loaded || state.key === currentKey) return;
    const hit = adaptRecall(scope, as, currentKey);
    if (hit) {
      seq.current += 1;
      setState({ busy: false, error: "", result: hit.rec.result, key: currentKey, saved: hit.rec });
      setText(hit.inUse && typeof hit.rec.used === "string" ? hit.rec.used : hit.rec.result.prompt);
      return;
    }
    run();
  }, [active, loaded, currentKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = state.key === currentKey && !state.busy && Boolean(state.result);
  const inUse = Boolean(current && state.saved && state.saved.usedKey === currentKey);
  // "Use this": remember that this text is now the prompt (its input shows the result as in use).
  const use = (finalText) => {
    if (!current) return false;
    const src = state.saved || { key: currentKey, result: state.result };
    adaptRemember(scope, as, { key: src.key, result: src.result, used: finalText, usedKey: adaptInputKey({ prompt: finalText, model, context, llm, as }) });
    return true;
  };
  return { currentKey, state, setState, text, setText, run, use, current, inUse, saved: state.saved };
}

// Recommended text models (incl. your ChatGPT), your default first.
export function useAdaptModels() {
  const llm = useDzLlmModels();
  const options = useMemo(() => {
    const list = llm.models || [];
    const pick = list.filter((m) => m.recommended || m.id === llm.default);
    const seen = new Set();
    return [...pick.filter((m) => m.id === llm.default), ...pick]
      .filter((m) => (seen.has(m.id) ? false : seen.add(m.id)))
      .map((m) => ({ value: m.id, label: m.name, description: m.source === "chatgpt" ? "Your ChatGPT plan" : m.source === "local" ? "This server, free" : m.source === "atlas" ? "Atlas" : "APIMart", meta: m.free ? "free" : m.price ? `$${(+m.price.out).toFixed(2)}/1M` : "" }));
  }, [llm]);
  return { options, def: llm.default, loaded: llm.loaded };
}

// look: the chosen camera look (ids) — the rewrite puts it into the model's blocks.
// request: { endpoint, body } of the current model, to show what will be sent.
export function DzAdaptButton({ prompt, onUse, model, context, className, look = null, request = null, scope = null }) {
  const [open, setOpen] = useState(false);
  const can = Boolean(prompt?.trim() && model?.kind);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" className={cn("gap-1.5", className)} disabled={!can} onClick={() => setOpen(true)}
        title={can ? `Rewrite the prompt by ${model.name || "this model"}'s prompting notes` : "Write a prompt first"}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" /></svg>
        Adapt to model
      </Button>
      {open && <AdaptDialog prompt={prompt} model={model} context={context} look={look} request={request} scope={scope} onClose={() => setOpen(false)} onUse={(p, info) => { onUse(p, info); setOpen(false); }} />}
    </>
  );
}

function AdaptDialog({ prompt, model, context, look, request, scope, onClose, onUse }) {
  const { options, def, loaded } = useAdaptModels();
  const [llmId, setLlmId] = useState(() => { try { return localStorage.getItem(LLM_KEY) || ""; } catch { return ""; } });
  const chosen = options.some((o) => o.value === llmId) ? llmId : def || options[0]?.value || "";
  // Text or JSON out: starts as your prompt is, switch to compare.
  const [as, setAs] = useState(() => (/^\s*[{[]/.test(prompt || "") ? "json" : "text"));
  const { state, setState, text, setText, run, use: keep, current } = useAdaptResult({ active: true, loaded, scope, prompt, model, context, llm: chosen, as });
  const [notes, setNotes] = useState(null); // { name, body, sources } when shown
  const [myDefault, setMyDefault] = useState(null); // set here: the new default
  const currentDefault = myDefault || def;
  const makeDefault = async () => {
    try { await post("/dz/api/llm/my-default", { model: chosen }); setMyDefault(chosen); } catch (e) { setState((s) => ({ ...s, error: String(e?.message || e) })); }
  };
  useEffect(() => { try { if (llmId) localStorage.setItem(LLM_KEY, llmId); } catch { /* optional */ } }, [llmId]);
  const use = () => { if (keep(text)) onUse(text); };

  const showNotes = async () => {
    if (notes) { setNotes(null); return; }
    try {
      const res = await fetch(`/dz/api/prompt/notes?family=${encodeURIComponent(model.family || "")}&kind=${model.kind}`, { credentials: "same-origin" });
      if (res.ok) setNotes(await res.json());
    } catch { /* stays closed */ }
  };

  const r = state.result;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(760px,96vw)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adapt to {model.name || "this model"}</DialogTitle>
          <DialogDescription>
            A text model rewrites your prompt by this model's prompting notes. Check it, edit it, then use it — your prompt changes only when you press “Use this”.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1">
              <div className="mb-1.5 text-muted-foreground">Text model</div>
              <OptionSelect aria-label="Text model" value={chosen} onValueChange={setLlmId} options={options.length ? options : [{ value: "", label: loaded ? "No text models available" : "Loading…" }]} />
            </div>
            <Segmented className="w-auto" value={as} onChange={setAs} aria-label="Answer as"
              options={[{ value: "text", label: "Text" }, { value: "json", label: "JSON" }]} />
            <Button variant="secondary" onClick={() => run(true)} disabled={state.busy || !loaded}>{state.busy ? <><Spinner className="h-4 w-4" /> Rewriting…</> : r ? "Try again" : "Rewrite"}</Button>
            <Button variant="ghost" onClick={showNotes}>{notes ? "Hide notes" : "Model notes"}</Button>
          </div>
          <div className="-mt-2 text-muted-foreground">
            {chosen && chosen === currentDefault
              ? "This is your default text model."
              : chosen ? <button type="button" className="font-semibold text-primary hover:underline" onClick={makeDefault}>Make it my default text model</button> : null}
          </div>

          {notes && (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-background/50 p-4">
              <div className="mb-2 font-semibold">{notes.name}{notes.generic ? " — general notes (no notes for this exact family yet)" : ""}</div>
              <pre className="whitespace-pre-wrap font-sans text-muted-foreground">{notes.body}</pre>
              {notes.sources?.length > 0 && <div className="mt-2 text-muted-foreground/80">Sources: {notes.sources.join(" · ")}</div>}
            </div>
          )}

          {look && <p className="text-muted-foreground">Your camera look (camera, lens, light, era, move) is not rewritten: on every send the server adds it into this model's camera and style blocks — see “Sent to the model” below.</p>}
          <details className="rounded-xl border border-border px-4 py-2">
            <summary className="cursor-pointer text-muted-foreground">Your prompt</summary>
            <p className="mt-2 whitespace-pre-wrap">{prompt}</p>
          </details>

          {state.error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">{state.error}</p>}
          {state.busy && !r && <div className="flex items-center gap-2 py-6 text-muted-foreground"><Spinner className="h-5 w-5" /> Rewriting with {options.find((o) => o.value === chosen)?.label || "the text model"}…</div>}

          {r && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                <span>Adapted · notes: {r.memo?.name}{r.memo?.generic ? " (general)" : ""}{r.memo?.blocks?.length ? ` · blocks: ${r.memo.blocks.join(" / ")}` : ""}</span>
                <span className="tabular-nums">{[money(r.costUsd), r.ms != null ? `${(r.ms / 1000).toFixed(1)} s` : ""].filter(Boolean).join(" · ")}</span>
              </div>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(16, Math.max(6, Math.ceil(text.length / 80)))} className="rounded-xl text-base" spellCheck />
              {r.lostTags?.length > 0 && <p className="text-warning">The rewrite lost {r.lostTags.join(", ")} — add them back before using it, or try again.</p>}
              {r.changes?.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
              )}
              {request?.endpoint && text.trim() && (
                <details className="rounded-xl border border-border px-4 py-2" open>
                  <summary className="cursor-pointer font-semibold">Sent to the model with “Use this”</summary>
                  <div className="mt-3"><RequestView endpoint={request.endpoint} body={{ ...(request.body || {}), prompt: text }} look={look || null} /></div>
                </details>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={use} disabled={!r || !text.trim() || !current}>Use this</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
