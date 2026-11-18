"use client";

// DZ: "Sent to the model" — what the chosen model will actually get: the
// final prompt (camera look written in by the server, by that model's rules)
// and the whole request body. For seeing and experimenting; nothing is sent.
import { useEffect, useRef, useState } from "react";
import { Button, SidePanel, Spinner, cn } from "../ui/index.js";

async function preview(payload) {
  const res = await fetch("/dz/api/prompt/preview", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  return data;
}

// The server's view of a request, refreshed (debounced) while `enabled`.
// Returns { data, loading, error }; data.hints are the "unusual combo" notes.
export function useDzPromptPreview({ endpoint, body, look, size = null, enabled = true }) {
  const key = enabled && endpoint ? JSON.stringify({ endpoint, body, look, size }) : "";
  const [state, setState] = useState({ data: null, loading: false, error: null });
  const seq = useRef(0);
  useEffect(() => {
    if (!key) { setState({ data: null, loading: false, error: null }); return undefined; }
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      preview(JSON.parse(key))
        .then((data) => { if (mine === seq.current) setState({ data, loading: false, error: null }); })
        .catch((e) => { if (mine === seq.current) setState({ data: null, loading: false, error: String(e?.message || e) }); });
    }, 450);
    return () => clearTimeout(timer);
  }, [key]);
  return state;
}

const PLACE = {
  start: "Camera sentence first, then your text; light and era at the end.",
  end: "Your text first; camera, light and era appended.",
  blocks: null,
};

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {}); }}>
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

export function DzHints({ hints, className = "" }) {
  if (!hints?.length) return null;
  return (
    <div className={cn("space-y-1", className)}>
      {hints.map((h) => <p key={h} className="text-amber-300">{h}</p>)}
    </div>
  );
}

export default function DzSentPanel({ open, onOpenChange, title = "Sent to the model", requests = [] }) {
  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title={title} className="max-w-[min(720px,100vw)] sm:max-w-[min(720px,100vw)]">
      <div className="space-y-8 p-1">
        <p className="text-muted-foreground">Exactly what the model gets when you press Generate: your prompt with the camera look written in by the server, in this model's words and place, and the whole request. Nothing is sent from here.</p>
        {requests.length === 0 && <p className="text-muted-foreground">Choose a model and write a prompt first.</p>}
        {requests.map((r) => <RequestView key={r.label || r.endpoint} {...r} enabled={open} />)}
      </div>
    </SidePanel>
  );
}

export function RequestView({ label, endpoint, body, look, size, enabled = true, problem }) {
  const { data, loading, error } = useDzPromptPreview({ endpoint, body, look, size, enabled: enabled && !problem });
  const rules = data?.rules;
  const bodyText = data ? JSON.stringify(data.body, null, 2) : "";
  return (
    <section className="space-y-3">
      {label && <h3 className="text-lg font-semibold text-foreground">{label}</h3>}
      {problem && <p className="text-amber-300">{problem}</p>}
      {!problem && (loading && !data ? <Spinner className="h-5 w-5" /> : error ? <p className="text-destructive">{error}</p> : data && (
        <>
          <p className="text-muted-foreground">
            {data.model.id} · {data.model.provider}
            {rules ? ` · rules: ${rules.name}${rules.generic ? " (general)" : ""}` : look ? "" : " · no camera look"}
          </p>
          {rules && look && (
            <p className="text-muted-foreground">
              {rules.place === "blocks" ? `Camera → “${rules.camera}:” block; light and era → “${rules.style}:” block.` : PLACE[rules.place]}
            </p>
          )}
          <DzHints hints={data.hints} />
          {data.prompt != null && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Prompt{data.promptField !== "prompt" ? ` (sent as “${data.promptField}”)` : ""}</span>
                <Copy text={data.prompt} />
              </div>
              <pre className={cn("max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/40 p-3 font-mono leading-relaxed", loading && "opacity-60")}>{data.prompt || "—"}</pre>
            </div>
          )}
          <details className="space-y-1.5">
            <summary className="cursor-pointer font-semibold">Whole request</summary>
            <div className="flex justify-end"><Copy text={bodyText} /></div>
            <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-muted/40 p-3 font-mono">{bodyText}</pre>
          </details>
        </>
      ))}
    </section>
  );
}
