"use client";

// DZ: "Adapt to model" — a text model rewrites the prompt by the prompting
// notes of the chosen image/video model (gateway: /dz/api/prompt/adapt).
// You see the new version, edit it, and only "Use this" puts it in the prompt.
import { useEffect, useMemo, useRef, useState } from "react";
import { useDzLlmModels } from "../dzLlm.js";
import { Button, Textarea, OptionSelect, Spinner, DialogParts, cn } from "../ui/index.js";

const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = DialogParts;
const LLM_KEY = "dz_adapt_llm";
const money = (v) => (v == null ? "" : v === 0 ? "free" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);

async function post(url, body) {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Recommended text models (incl. your ChatGPT), your default first.
function useAdaptModels() {
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

export function DzAdaptButton({ prompt, onUse, model, context, className }) {
  const [open, setOpen] = useState(false);
  const can = Boolean(prompt?.trim() && model?.kind);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" className={cn("gap-1.5", className)} disabled={!can} onClick={() => setOpen(true)}
        title={can ? `Rewrite the prompt by ${model.name || "this model"}'s prompting notes` : "Write a prompt first"}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" /></svg>
        Adapt to model
      </Button>
      {open && <AdaptDialog prompt={prompt} model={model} context={context} onClose={() => setOpen(false)} onUse={(p) => { onUse(p); setOpen(false); }} />}
    </>
  );
}

function AdaptDialog({ prompt, model, context, onClose, onUse }) {
  const { options, def, loaded } = useAdaptModels();
  const [llmId, setLlmId] = useState(() => { try { return localStorage.getItem(LLM_KEY) || ""; } catch { return ""; } });
  const chosen = options.some((o) => o.value === llmId) ? llmId : def || options[0]?.value || "";
  const [state, setState] = useState({ busy: false, error: "", result: null });
  const [text, setText] = useState("");
  const [notes, setNotes] = useState(null); // { name, body, sources } when shown
  const [myDefault, setMyDefault] = useState(null); // set here: the new default
  const currentDefault = myDefault || def;
  const makeDefault = async () => {
    try { await post("/dz/api/llm/my-default", { model: chosen }); setMyDefault(chosen); } catch (e) { setState((s) => ({ ...s, error: String(e?.message || e) })); }
  };
  useEffect(() => { try { if (llmId) localStorage.setItem(LLM_KEY, llmId); } catch { /* optional */ } }, [llmId]);

  const run = async () => {
    setState({ busy: true, error: "", result: null });
    try {
      const r = await post("/dz/api/prompt/adapt", { prompt, model, context, llm: chosen || undefined });
      setState({ busy: false, error: "", result: r });
      setText(r.prompt);
    } catch (e) {
      setState({ busy: false, error: String(e?.message || e), result: null });
    }
  };
  // Starts by itself once the text models are known — once (React may run effects twice).
  const started = useRef(false);
  useEffect(() => { if (loaded && !started.current) { started.current = true; run(); } }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <Button variant="secondary" onClick={run} disabled={state.busy || !loaded}>{state.busy ? <><Spinner className="h-4 w-4" /> Rewriting…</> : r ? "Try again" : "Rewrite"}</Button>
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

          <details className="rounded-xl border border-border px-4 py-2">
            <summary className="cursor-pointer text-muted-foreground">Your prompt</summary>
            <p className="mt-2 whitespace-pre-wrap">{prompt}</p>
          </details>

          {state.error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">{state.error}</p>}
          {state.busy && !r && <div className="flex items-center gap-2 py-6 text-muted-foreground"><Spinner className="h-5 w-5" /> Rewriting with {options.find((o) => o.value === chosen)?.label || "the text model"}…</div>}

          {r && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                <span>Adapted · notes: {r.memo?.name}{r.memo?.generic ? " (general)" : ""}{r.memo?.blocks?.length ? ` · blocks: ${r.memo.blocks.join(" / ")}` : ""}</span>
                <span className="tabular-nums">{[money(r.costUsd), r.ms != null ? `${(r.ms / 1000).toFixed(1)} s` : ""].filter(Boolean).join(" · ")}</span>
              </div>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(16, Math.max(6, Math.ceil(text.length / 80)))} className="rounded-xl text-base" spellCheck />
              {r.lostTags?.length > 0 && <p className="text-amber-300">The rewrite lost {r.lostTags.join(", ")} — add them back before using it, or try again.</p>}
              {r.changes?.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onUse(text)} disabled={!r || !text.trim()}>Use this</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
