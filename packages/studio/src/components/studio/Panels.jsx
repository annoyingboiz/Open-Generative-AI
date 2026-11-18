"use client";

// Side panels of the Studio composer (redesign 01, §5.9–5.10): Camera, Camera move,
// Look, Settings, Adapt. Every choice applies at once; Done, ×, Esc and the scrim close.
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Aperture, CircleDashed, MagnifyingGlass, ArrowsClockwise, BookOpen, CaretRight } from "@phosphor-icons/react";
import { Switch, Slider, Input, Spinner, cn, SelectParts } from "../../ui/index.js";
import { lookData, autoLook, AUTO_LOOK } from "../../dzCreate.js";
import { useAdaptModels, post, LLM_KEY } from "../DzAdapt.jsx";
import { RequestView } from "../DzSentPanel.jsx";
import { StudioPanel, Overline, ChipMenu, MenuRow } from "./ui.jsx";

const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = SelectParts;
const FOCAL_STOPS = [null, 24, 35, 50, 85, 135];
// Pictures for the choices (generated 19.11 with Nano Banana 2, public/look/*).
export const lookPicture = (kind, id) => (id ? `/look/${kind}-${String(id).replace("/", "").replace(".", "_")}.webp` : null);

// ── Camera: three wheels and the focal track ────────────────────────────────
function Wheel({ title, options, value, onChange, icon: Icon }) {
  const list = [{ id: null, label: "Auto" }, ...options];
  const i = Math.max(0, list.findIndex((o) => o.id === value));
  const n = list.length;
  const go = (to) => onChange(list[(to + n) % n].id);
  const last = useRef(0);
  const drag = useRef(null);
  const onWheel = (e) => {
    const now = Date.now();
    if (Math.abs(e.deltaY) < 4 || now - last.current < 170) return;
    last.current = now;
    go(i + (e.deltaY > 0 ? 1 : -1));
  };
  const Option = ({ o, big, onClick }) => (
    <button type="button" onClick={onClick} title={o.note || undefined} tabIndex={big ? -1 : 0}
      className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-xl px-2 text-center transition-all duration-state ease-soft",
        big ? "h-[170px] border-[1.5px] border-signal" : "h-[120px] opacity-60 hover:opacity-100")}>
      {o.id == null
        ? <span className={cn("rounded-md border border-dashed border-input", big ? "h-[110px] w-[150px]" : "h-12 w-16")} />
        : o.image
          ? <img src={o.image} alt="" draggable={false} className={cn("rounded-md object-cover", big ? "h-[110px] w-[150px]" : "h-12 w-16")} />
          : <Icon size={big ? 56 : 32} weight="light" className="text-muted-foreground" />}
      <span className={cn("line-clamp-2", big ? "text-base font-semibold text-foreground" : "text-sm text-muted-foreground")}>{o.label}</span>
    </button>
  );
  return (
    <div className="relative flex min-w-0 flex-col rounded-2xl border border-border bg-card/60 p-1.5"
      onWheel={onWheel}
      onPointerDown={(e) => { drag.current = { y: e.clientY, i }; }}
      onPointerMove={(e) => { if (!drag.current || !e.buttons) return; const steps = Math.trunc((drag.current.y - e.clientY) / 48); if (steps && drag.current.i + steps !== i) go(drag.current.i + steps); }}
      onPointerUp={() => { drag.current = null; }}
      onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); go(i + 1); } if (e.key === "ArrowUp") { e.preventDefault(); go(i - 1); } }}
      tabIndex={0} role="listbox" aria-label={title} aria-activedescendant={`${title}-${i}`}>
      <div className="flex h-11 items-center justify-between px-3"><Overline>{title}</Overline><span className="text-xs tabular-nums text-muted-foreground">{i + 1} of {n}</span></div>
      <Option o={list[(i - 1 + n) % n]} onClick={() => go(i - 1)} />
      <div className="my-1 border-t border-border" />
      <Option o={list[i]} big />
      <div className="my-1 border-t border-border" />
      <Option o={list[(i + 1) % n]} onClick={() => go(i + 1)} />
      <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 h-10 rounded-b-xl bg-gradient-to-t from-card to-transparent" />
    </div>
  );
}

function FocalTrack({ value, onChange }) {
  const i = Math.max(0, FOCAL_STOPS.indexOf(value ?? null));
  const ref = useRef(null);
  const dragging = useRef(false);
  const setFrom = (e) => {
    const r = ref.current.getBoundingClientRect();
    const k = Math.round(((e.clientX - r.left) / r.width) * (FOCAL_STOPS.length - 1));
    onChange(FOCAL_STOPS[Math.max(0, Math.min(FOCAL_STOPS.length - 1, k))]);
  };
  return (
    <div className="space-y-3">
      <Overline>Focal length · {value ? `${value}mm` : "Auto"}</Overline>
      <div ref={ref} role="slider" tabIndex={0} aria-label="Focal length" aria-valuetext={value ? `${value} mm` : "Auto"}
        className="relative h-6 cursor-pointer touch-none"
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); setFrom(e); }}
        onPointerMove={(e) => { if (dragging.current) setFrom(e); }}
        onPointerUp={() => { dragging.current = false; }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(FOCAL_STOPS[Math.min(FOCAL_STOPS.length - 1, i + 1)]); }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange(FOCAL_STOPS[Math.max(0, i - 1)]); }
        }}>
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        {FOCAL_STOPS.map((f, k) => (
          <span key={k} className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-input" style={{ left: `${(k / (FOCAL_STOPS.length - 1)) * 100}%` }} />
        ))}
        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-popover transition-[left] duration-state ease-soft" style={{ left: `${(i / (FOCAL_STOPS.length - 1)) * 100}%` }} />
      </div>
      <div className="relative h-4">
        {FOCAL_STOPS.map((f, k) => (
          <button key={k} type="button" onClick={() => onChange(f)} className={cn("absolute -translate-x-1/2 text-xs tabular-nums", k === i ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}
            style={{ left: `${(k / (FOCAL_STOPS.length - 1)) * 100}%` }}>{f ?? "Auto"}</button>
        ))}
      </div>
    </div>
  );
}

export function CameraLookPanel({ open, onClose, look, setLook, hints = [] }) {
  const d = lookData();
  const a = autoLook(look);
  const set = (k, v) => setLook((prev) => ({ ...autoLook(prev), [k]: v }));
  return (
    <StudioPanel open={open} onClose={onClose} title="Camera" resetLabel="Reset to Auto"
      onReset={() => setLook((prev) => ({ ...autoLook(prev), camera: null, lens: null, aperture: null, focal: null, filter: null }))}>
      <div className="grid grid-cols-3 gap-3">
        <Wheel title="Camera" icon={Camera} options={d.cameras.map((o) => ({ ...o, image: lookPicture("camera", o.id) }))} value={a.camera} onChange={(v) => set("camera", v)} />
        <Wheel title="Lens" icon={Aperture} options={d.lenses.map((o) => ({ ...o, image: lookPicture("lens", o.id) }))} value={a.lens} onChange={(v) => set("lens", v)} />
        <Wheel title="Aperture" icon={CircleDashed} options={(d.apertures || []).map((f) => ({ id: f, label: f, image: lookPicture("aperture", f) }))} value={a.aperture} onChange={(v) => set("aperture", v)} />
      </div>
      <div className="mt-6"><FocalTrack value={a.focal} onChange={(v) => set("focal", v)} /></div>
      {(d.filters || []).map((f) => (
        <label key={f.id} className="mt-5 flex items-center justify-between gap-3">
          <span><span className="text-base font-medium">{f.label}</span> <span className="text-sm text-muted-foreground">· {f.note}</span></span>
          <Switch checked={a.filter === f.id} onCheckedChange={(v) => set("filter", v ? f.id : null)} />
        </label>
      ))}
      <p className="mt-6 text-sm text-muted-foreground">Scroll a wheel, or click the option above or below. Drag the focal handle. Anything left on Auto is chosen by the model.</p>
      {hints.length > 0 && <ul className="mt-3 space-y-1 text-sm text-warning">{hints.map((h, i) => <li key={i}>{h}</li>)}</ul>}
    </StudioPanel>
  );
}

// ── Camera move ─────────────────────────────────────────────────────────────
// Each move plays as a loop over one of six scenes (CSS camera moves, no video needed).
const MOVE_CSS = `
@keyframes mv-in{from{transform:scale(1)}to{transform:scale(1.28)}}
@keyframes mv-out{from{transform:scale(1.28)}to{transform:scale(1)}}
@keyframes mv-pl{from{transform:scale(1.18) translateX(7%)}to{transform:scale(1.18) translateX(-7%)}}
@keyframes mv-pr{from{transform:scale(1.18) translateX(-7%)}to{transform:scale(1.18) translateX(7%)}}
@keyframes mv-tu{from{transform:scale(1.18) translateY(-7%)}to{transform:scale(1.18) translateY(7%)}}
@keyframes mv-td{from{transform:scale(1.18) translateY(7%)}to{transform:scale(1.18) translateY(-7%)}}
@keyframes mv-cu{from{transform:scale(1.12) translateY(-6%)}to{transform:scale(1.3) translateY(6%)}}
@keyframes mv-cd{from{transform:scale(1.3) translateY(6%)}to{transform:scale(1.12) translateY(-6%)}}
@keyframes mv-or{from{transform:perspective(500px) rotateY(-9deg) scale(1.25)}to{transform:perspective(500px) rotateY(9deg) scale(1.25)}}
@keyframes mv-hh{0%{transform:scale(1.12) translate(0,0) rotate(0)}25%{transform:scale(1.12) translate(-1.2%,.8%) rotate(-.6deg)}50%{transform:scale(1.12) translate(.8%,-1%) rotate(.4deg)}75%{transform:scale(1.12) translate(1.2%,.6%) rotate(-.3deg)}100%{transform:scale(1.12) translate(0,0) rotate(0)}}
@keyframes mv-dr{from{transform:scale(1.35) translateY(4%)}to{transform:scale(1.1) translateY(-4%)}}
@keyframes mv-dz{from{transform:scale(1.3);filter:blur(0)}to{transform:scale(1);filter:blur(.4px)}}
@keyframes mv-tr{from{transform:scale(1.2) translateX(-6%) translateY(1%)}to{transform:scale(1.2) translateX(6%) translateY(-1%)}}
.mv-run{animation-duration:3.2s;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}
.mv-run.mv-hh{animation-duration:1.4s;animation-direction:normal}
`;
const MOVE_ANIM = { "dolly-in": "mv-in", "push-in": "mv-in", "zoom-in": "mv-in", "dolly-out": "mv-out", "pan-left": "mv-pl", "pan-right": "mv-pr", "truck-left": "mv-pl", "truck-right": "mv-pr",
  "tilt-up": "mv-tu", "tilt-down": "mv-td", "crane-up": "mv-cu", "crane-down": "mv-cd", orbit: "mv-or", handheld: "mv-hh", drone: "mv-dr", "dolly-zoom": "mv-dz", tracking: "mv-tr" };

export function MovePanel({ open, onClose, move, setMove }) {
  const [q, setQ] = useState("");
  const moves = [{ id: "", label: "Auto" }, ...(lookData().moves || [])];
  const shown = moves.filter((m) => !q.trim() || m.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <StudioPanel open={open} onClose={onClose} title="Camera move" onReset={() => setMove("")}>
      <style>{MOVE_CSS}</style>
      <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3">
        <MagnifyingGlass size={16} className="text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${moves.length - 1} moves`} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none" />
      </label>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {shown.map((m) => {
          const on = (move || "") === m.id;
          const i = moves.findIndex((x) => x.id === m.id);
          const anim = MOVE_ANIM[m.id];
          return (
            <button key={m.id || "auto"} type="button" onClick={() => setMove(m.id)}
              className={cn("group flex flex-col overflow-hidden rounded-md border text-left transition-colors duration-state", on ? "border-[1.5px] border-signal" : "border-border hover:border-input")}>
              <span className="relative block aspect-video overflow-hidden bg-muted">
                {m.id ? (
                  <img src={`/look/move-${((i - 1) % 6) + 1}.webp`} alt="" loading="lazy" draggable={false}
                    className={cn("h-full w-full object-cover", anim && "mv-run", anim, anim && !on && "[animation-play-state:paused] group-hover:[animation-play-state:running]")} style={anim ? { animationName: anim } : undefined} />
                ) : <span className="absolute inset-3 rounded-xs border border-dashed border-input" />}
                {on && m.id && <span className="absolute left-1.5 top-1.5 rounded-xs bg-signal px-1.5 text-xs font-medium text-primary-foreground">Playing</span>}
              </span>
              <span className={cn("px-2.5 py-1.5 text-sm", on ? "font-semibold text-foreground" : "text-muted-foreground")}>{m.label}</span>
            </button>
          );
        })}
      </div>
    </StudioPanel>
  );
}

// ── Look ────────────────────────────────────────────────────────────────────
export function LookPanel({ open, onClose, look, setLook }) {
  const d = lookData();
  const a = autoLook(look);
  const set = (k, v) => setLook((prev) => ({ ...autoLook(prev), [k]: v }));
  const Cards = ({ k, kind, options }) => (
    <div className="grid grid-cols-4 gap-2.5">
      {[{ id: null, label: "Auto" }, ...(options || [])].map((o) => {
        const on = a[k] === o.id;
        return (
          <button key={o.id || "auto"} type="button" onClick={() => set(k, o.id)}
            className={cn("flex flex-col overflow-hidden rounded-md border text-left text-sm transition-colors duration-state", on ? "border-[1.5px] border-signal font-semibold text-foreground" : "border-border text-muted-foreground hover:border-input hover:text-foreground")}>
            {o.id == null
              ? <span className="m-1.5 mb-0 flex aspect-[16/7] items-center justify-center rounded-xs border border-dashed border-input" />
              : <img src={lookPicture(kind, o.id)} alt="" loading="lazy" className="aspect-[16/7] w-full object-cover" />}
            <span className="truncate px-2.5 py-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
  const Chips = ({ k, options }) => (
    <div className="flex flex-wrap gap-2">
      {[{ id: null, label: "Auto" }, ...(options || [])].map((o) => {
        const on = a[k] === o.id;
        return (
          <button key={o.id || "auto"} type="button" onClick={() => set(k, o.id)}
            className={cn("h-8 rounded-md border px-3 text-sm font-medium transition-colors duration-state", on ? "border-[1.5px] border-signal text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}>{o.label}</button>
        );
      })}
    </div>
  );
  return (
    <StudioPanel open={open} onClose={onClose} title="Look" resetLabel="Reset to Auto"
      onReset={() => setLook((prev) => ({ ...autoLook(prev), palette: null, light: null, genre: null, era: null }))}>
      <p className="mb-5 text-sm text-muted-foreground">Anything left on Auto is decided by the model from your scene.</p>
      <div className="space-y-6">
        <section className="space-y-2.5"><Overline>Colour palette</Overline><Cards k="palette" kind="palette" options={d.palettes} /></section>
        <section className="space-y-2.5"><Overline>Lighting</Overline><Cards k="light" kind="light" options={d.lights} /></section>
        <section className="space-y-2.5"><Overline>Genre</Overline><Chips k="genre" options={d.genres} /></section>
        <section className="space-y-2.5"><Overline>Era</Overline><Chips k="era" options={d.eras} /></section>
      </div>
    </StudioPanel>
  );
}

// ── Settings: the parameters this model has, from its schema ────────────────
const optLabel = (p, v) => {
  if (p.key === "duration") return Number(v) === -1 ? "Auto" : `${v}s`;
  const named = p.enumLabels && Object.hasOwn(p.enumLabels, String(v)) ? p.enumLabels[String(v)] : null;
  return typeof named === "string" ? named : String(v);
};
function SettingControl({ p, value, onChange }) {
  const current = value ?? p.default;
  if (Array.isArray(p.enum)) {
    return (
      <Select value={current == null ? undefined : String(current)} onValueChange={(v) => onChange(p.enum.find((x) => String(x) === v))}>
        <SelectTrigger aria-label={p.title} className="h-8 w-full"><SelectValue placeholder="Model default" /></SelectTrigger>
        <SelectContent className="max-h-[360px]">{p.enum.map((o) => <SelectItem key={String(o)} value={String(o)}>{optLabel(p, o)}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (p.type === "boolean") return <div className="flex justify-end"><Switch checked={Boolean(current)} onCheckedChange={onChange} aria-label={p.title} /></div>;
  if ((p.type === "int" || p.type === "number") && p.minValue != null && p.maxValue != null) {
    const step = p.step ?? (p.type === "int" ? 1 : 0.01);
    const v = Number(current ?? p.minValue);
    return (
      <div className="flex items-center gap-3">
        <Slider min={p.minValue} max={p.maxValue} step={step} value={[v]} onValueChange={([x]) => onChange(x)} aria-label={p.title} />
        <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">{value == null && p.default == null ? "—" : v}</span>
      </div>
    );
  }
  if (p.type === "int" || p.type === "number") {
    return <Input type="number" value={value ?? ""} placeholder={p.default != null ? String(p.default) : "Random"} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className="text-right" aria-label={p.title} />;
  }
  return <Input value={value ?? ""} placeholder={p.default != null ? String(p.default) : ""} onChange={(e) => onChange(e.target.value)} aria-label={p.title} />;
}

export function SettingsPanel({ open, onClose, modelName, params, values, setValue, onReset }) {
  return (
    <StudioPanel open={open} onClose={onClose} title="Settings" width={560} resetLabel="Reset to defaults" onReset={onReset}
      aside={<span className="truncate text-sm text-muted-foreground">{modelName}</span>}>
      <p className="mb-3 text-sm text-muted-foreground">These are the settings {modelName || "this model"} has. Another model shows its own list.</p>
      {params.length === 0 && <p className="py-6 text-center text-muted-foreground">This model has no other settings.</p>}
      <div className="divide-y divide-border">
        {params.map((p) => (
          <div key={p.key} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium">{p.title || p.key}</div>
              {p.description && <div className="line-clamp-2 text-xs text-muted-foreground" title={p.description}>{p.description}</div>}
            </div>
            <div className="w-[260px] flex-shrink-0"><SettingControl p={p} value={values[p.key]} onChange={(v) => setValue(p.key, v)} /></div>
          </div>
        ))}
      </div>
    </StudioPanel>
  );
}

// ── Adapt: the rewrite, split into the model's blocks ───────────────────────
// "Label: text" lines (the blocks the model's notes define) → [{ label, text }].
export function splitBlocks(text) {
  const out = [];
  for (const line of String(text || "").split(/\n/)) {
    const m = /^\s*([A-Z][A-Za-z /&-]{1,28}):\s*(.*)$/.exec(line);
    if (m) out.push({ label: m[1], text: m[2] });
    else if (out.length) out[out.length - 1].text += (out[out.length - 1].text ? "\n" : "") + line;
    else if (line.trim()) out.push({ label: "", text: line });
  }
  return out.length > 1 && out.every((b) => b.label) ? out : null;
}
const joinBlocks = (blocks) => blocks.map((b) => `${b.label}: ${b.text.trim()}`).join("\n");
const money = (v) => (v == null ? "" : v === 0 ? "Free" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);

export function AdaptPanel({ open, onClose, prompt, model, context, look, request, onUse }) {
  const { options, def, loaded } = useAdaptModels();
  const [llmId, setLlmId] = useState(() => { try { return localStorage.getItem(LLM_KEY) || ""; } catch { return ""; } });
  const chosen = options.some((o) => o.value === llmId) ? llmId : def || options[0]?.value || "";
  const [as, setAs] = useState(() => (/^\s*[{[]/.test(prompt || "") ? "json" : "text"));
  const [state, setState] = useState({ busy: false, error: "", result: null });
  const [text, setText] = useState("");
  const [llmMenu, setLlmMenu] = useState(false);
  const [notes, setNotes] = useState(null);
  const llmAnchor = useRef(null);
  const seq = useRef(0);
  useEffect(() => { try { if (llmId) localStorage.setItem(LLM_KEY, llmId); } catch { /* optional */ } }, [llmId]);

  const run = async (format = as, llm = chosen) => {
    const mine = ++seq.current;
    setState({ busy: true, error: "", result: null });
    try {
      const r = await post("/dz/api/prompt/adapt", { prompt, model, context, llm: llm || undefined, as: format });
      if (mine !== seq.current) return;
      setState({ busy: false, error: "", result: r });
      setText(r.prompt);
    } catch (e) {
      if (mine === seq.current) setState({ busy: false, error: String(e?.message || e), result: null });
    }
  };
  // A new opening starts a new rewrite (once the text models are known).
  const openedFor = useRef(null);
  useEffect(() => {
    if (!open) { openedFor.current = null; return; }
    if (loaded && openedFor.current !== prompt) { openedFor.current = prompt; run(); }
  }, [open, loaded, prompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = state.result;
  const blocks = as === "text" ? splitBlocks(text) : null;
  const json = as === "json" ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  const memoBlocks = r?.memo?.blocks || [];
  const llmLabel = options.find((o) => o.value === chosen)?.label || (loaded ? "No text model" : "Loading…");
  const showNotes = async () => {
    if (notes) { setNotes(null); return; }
    try {
      const res = await fetch(`/dz/api/prompt/notes?family=${encodeURIComponent(model?.family || "")}&kind=${model?.kind}`, { credentials: "same-origin" });
      if (res.ok) setNotes(await res.json());
    } catch { /* stays closed */ }
  };

  return (
    <StudioPanel open={open} onClose={onClose} title={`Adapt to ${model?.name || "this model"}`} width={600}
      foot={(
        <>
          <button type="button" onClick={() => run()} disabled={state.busy || !loaded} className="flex h-8 items-center gap-2 rounded-md px-3 text-base font-medium text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground disabled:opacity-50"><ArrowsClockwise size={16} /> Try again</button>
          <button type="button" onClick={onClose} className="ml-auto h-8 rounded-md border border-border px-3 text-base font-medium hover:bg-accent">Cancel</button>
          <button type="button" onClick={() => onUse(text)} disabled={!r || !text.trim() || state.busy || (as === "json" && !json)} className="h-8 rounded-md bg-primary px-4 text-base font-medium text-primary-foreground transition-colors duration-state hover:bg-primary-hover disabled:opacity-50">Use this</button>
        </>
      )}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative" ref={llmAnchor}>
          <button type="button" onClick={() => setLlmMenu((v) => !v)} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm font-medium hover:bg-accent">{llmLabel}<CaretRight size={12} className="rotate-90 text-muted-foreground" /></button>
          <ChipMenu open={llmMenu} onClose={() => setLlmMenu(false)} anchor={llmAnchor} className="!bottom-auto top-[calc(100%+8px)] w-72 p-1.5">
            {options.map((o) => (
              <MenuRow key={o.value} on={o.value === chosen} onClick={() => { setLlmId(o.value); setLlmMenu(false); run(as, o.value); }}>
                <span className="min-w-0 flex-1 truncate">{o.label}</span><span className="text-xs text-muted-foreground">{o.meta || o.description}</span>
              </MenuRow>
            ))}
          </ChipMenu>
        </div>
        <div className="flex h-8 items-center rounded-md bg-muted p-0.5" role="group" aria-label="Answer as">
          {[["text", "Text"], ["json", "JSON"]].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={as === v} onClick={() => { if (as !== v) { setAs(v); if (loaded) run(v); } }}
              className={cn("h-7 rounded-[6px] px-3 text-sm font-medium transition-colors duration-state", as === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        <button type="button" onClick={showNotes} className="ml-auto flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"><BookOpen size={16} /> {notes ? "Hide notes" : "Model notes"}</button>
      </div>
      {notes && (
        <div className="custom-scrollbar mt-3 max-h-56 overflow-y-auto rounded-xl border border-border p-3 text-sm">
          <div className="mb-1 font-semibold">{notes.name}</div>
          <pre className="whitespace-pre-wrap font-sans text-muted-foreground">{notes.body}</pre>
        </div>
      )}
      <details className="group mt-4 rounded-xl border border-border">
        <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-base font-medium"><CaretRight size={14} className="transition-transform group-open:rotate-90" /> Your prompt
          <span className="ml-auto min-w-0 max-w-[60%] truncate text-sm font-normal text-muted-foreground">{prompt}</span></summary>
        <p className="whitespace-pre-wrap px-3 pb-3 text-sm text-muted-foreground">{prompt}</p>
      </details>

      <div className="mt-5 flex items-center justify-between"><Overline>Adapted</Overline>
        <span className="text-xs tabular-nums text-muted-foreground">{r ? [r.memo?.name ? `${r.memo.name} notes` : "", r.ms != null ? `${(r.ms / 1000).toFixed(1)} s` : "", money(r.costUsd)].filter(Boolean).join(" · ") : ""}</span></div>
      {state.error && <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">{state.error}</p>}
      {state.busy && (
        <div className="mt-2 rounded-xl border border-border p-3" aria-busy="true">
          {(memoBlocks.length ? memoBlocks : ["Scene", "Action", "Camera", "Sound"]).map((b) => (
            <div key={b} className="flex gap-4 py-2"><span className="w-24 flex-shrink-0"><Overline>{b}</Overline></span><span className="dz-shimmer h-4 flex-1 rounded-xs bg-muted" /></div>
          ))}
          <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Rewriting with {llmLabel}</div>
        </div>
      )}
      {r && !state.busy && (
        <>
          {blocks ? (
            <div className="mt-2 divide-y divide-border rounded-xl border border-border px-3">
              {blocks.map((b, i) => (
                <label key={i} className="flex gap-4 py-2.5">
                  <span className="w-24 flex-shrink-0 pt-1"><Overline>{b.label}</Overline></span>
                  <textarea value={b.text} rows={Math.max(1, Math.ceil(b.text.length / 52))}
                    onChange={(e) => setText(joinBlocks(blocks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))))}
                    className="min-w-0 flex-1 resize-none rounded-md bg-transparent px-1 py-0.5 text-base outline-none focus:bg-muted focus-visible:outline-none" />
                </label>
              ))}
            </div>
          ) : (
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(18, Math.max(6, Math.ceil(text.length / 70)))} spellCheck={as === "text"}
              className={cn("mt-2 w-full resize-y rounded-xl border border-border bg-transparent p-3 outline-none focus:bg-muted focus-visible:outline-none", as === "json" ? "font-mono text-[13px] leading-5" : "text-base")} />
          )}
          {as === "json" && !json && <p className="mt-2 text-sm text-warning">This is not valid JSON yet — fix it or try again; only a valid object is sent.</p>}
          <p className="mt-2 text-xs text-muted-foreground">Click any block to edit it. Your prompt changes only when you press Use this.</p>
          {r.lostTags?.length > 0 && <p className="mt-2 text-sm text-warning">The rewrite lost {r.lostTags.join(", ")} — add them back, or try again.</p>}
          {r.changes?.length > 0 && <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{r.changes.slice(0, 3).map((c, i) => <li key={i}>{c}</li>)}</ul>}
          {request?.endpoint && text.trim() && (
            <details className="group mt-4 rounded-xl border border-border">
              <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-base font-medium"><CaretRight size={14} className="transition-transform group-open:rotate-90" /> What the model receives
                <span className="ml-auto text-sm font-normal text-muted-foreground">This text plus Camera and Look, added on send</span></summary>
              <div className="px-3 pb-3"><RequestView endpoint={request.endpoint} body={{ ...(request.body || {}), prompt: text }} look={look || null} /></div>
            </details>
          )}
        </>
      )}
    </StudioPanel>
  );
}

export { AUTO_LOOK };
