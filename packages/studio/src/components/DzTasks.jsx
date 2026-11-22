"use client";

// Tasks (package 14, A4): what runs, waits or ended in the last hour, in a drawer on the right
// (the assistant's SidePanel). The header pill opens it; "Open" goes where the task was started.
import { useCallback, useEffect, useRef, useState } from "react";
import { ImageSquare, VideoCamera, SpeakerHigh } from "@phosphor-icons/react";
import { dzThumb } from "../api.js";
import { SidePanel, cn } from "../ui/index.js";

async function fetchTasks() {
  const r = await fetch("/dz/api/tasks", { credentials: "same-origin", cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).items || [];
}

// The list, kept fresh: every few seconds while something runs or the drawer is open, and after
// any change in the library (a generation started or ended somewhere in the app).
export function useDzTasks({ busy = false, open = false } = {}) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try { const list = await fetchTasks(); if (mine === seq.current) setItems(list); } catch { /* keep the last list */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(load, 600); };
    window.addEventListener("dz:history", later);
    window.addEventListener("focus", later);
    return () => { clearTimeout(t); window.removeEventListener("dz:history", later); window.removeEventListener("focus", later); };
  }, [load]);
  const active = items.some((x) => x.state === "running" || x.state === "waiting");
  useEffect(() => {
    if (!active && !busy && !open) return undefined;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 5000);
    return () => clearInterval(t);
  }, [active, busy, open, load]);
  // A generation sent from here shows at once (the server has it a moment later).
  useEffect(() => { if (busy) load(); }, [busy, load]);
  const running = items.filter((x) => x.state === "running").length;
  const waiting = items.filter((x) => x.state === "waiting").length;
  return { items, running, waiting, reload: load };
}

const KIND_WORD = { image: "picture", video: "video", audio: "sound" };
const STUDIO_NAME = { create: "Studio", cinema: "Studio", image: "Image", video: "Video", upscale: "Upscale", director: "Storyboard", tools: "Tools" };
const fmtClock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// "Shot 2 · picture", "Upscale · Shot 1", "Studio · video".
export function taskTitle(t) {
  const word = KIND_WORD[t.kind] || "file";
  if (t.upscale) return `Upscale${t.place ? ` · ${t.place.label}` : ""}`;
  if (t.place) return `${t.place.label} · ${word}`;
  if (t.editor) return `Editor · ${word}`;
  return `${STUDIO_NAME[t.studio] || "Library"} · ${word}`;
}
function taskLine(t) {
  const where = t.project?.name || "Library";
  if (t.state === "failed") return `${where} · failed: ${String(t.error || "the provider returned an error").replace(/\.$/, "")}`;
  if (t.state === "waiting") return `${where} · ${String(t.note || "waiting").replace(/^Waiting for the GPU: /, "waiting for the graphics card: ").replace(/^In line on this server/, "in line on this server")}`;
  if (t.state === "completed") return `${where} · ${t.outputs > 1 ? `${t.outputs} ${KIND_WORD[t.kind] || "file"}s` : [t.model, t.provider].filter(Boolean).join(" · ")}`;
  return [where, t.model, t.provider].filter(Boolean).join(" · ");
}

function Row({ t, now, onOpen }) {
  const Icon = t.kind === "video" ? VideoCamera : t.kind === "audio" ? SpeakerHigh : ImageSquare;
  const state = t.state === "running" ? fmtClock(now - t.created_at) : t.state === "waiting" ? "In line" : t.state === "failed" ? "Failed" : "Done";
  return (
    <li className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
      <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
        {t.url && t.kind !== "audio" ? <img src={dzThumb(t.url, 128)} alt="" className="h-full w-full object-cover" /> : <Icon size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium">{taskTitle(t)}</span>
        <span className={cn("block text-sm leading-5", t.state === "failed" ? "text-muted-foreground" : "truncate text-muted-foreground")} title={taskLine(t)}>{taskLine(t)}</span>
        {(t.state === "running" || t.state === "waiting") && (
          <span className="mt-1.5 block h-0.5 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
            <span className={cn("block h-full w-1/3 rounded-full", t.state === "running" ? "dz-task-run bg-foreground" : "bg-muted-foreground")} />
          </span>
        )}
      </span>
      <span className={cn("flex-shrink-0 text-sm tabular-nums", t.state === "failed" ? "text-destructive" : "text-muted-foreground")}>{state}</span>
      <button type="button" onClick={() => onOpen(t)} className="h-8 flex-shrink-0 rounded-md px-2.5 text-base font-medium text-foreground hover:bg-accent">Open</button>
    </li>
  );
}

export function DzTasksPanel({ open, onOpenChange, items, onOpenTask }) {
  const [now, setNow] = useState(() => Date.now());
  const running = items.filter((x) => x.state === "running");
  const waiting = items.filter((x) => x.state === "waiting");
  const finished = items.filter((x) => x.state === "completed" || x.state === "failed");
  useEffect(() => {
    if (!open || !running.length) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open, running.length]);
  // An empty group is not shown (A4).
  const group = (name, list) => (list.length ? (
    <section key={name} className="px-5 pt-5">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{name} · {list.length}</h3>
      <ul>{list.map((t) => <Row key={t.id} t={t} now={now} onOpen={(x) => { onOpenTask(x); onOpenChange(false); }} />)}</ul>
    </section>
  ) : null);
  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title="Tasks">
      <style>{".dz-task-run{animation:dzTaskRun 1.6s ease-in-out infinite}@keyframes dzTaskRun{from{transform:translateX(-100%)}to{transform:translateX(300%)}}@media (prefers-reduced-motion:reduce){.dz-task-run{animation:none}}"}</style>
      <div className="custom-scrollbar h-full overflow-y-auto pb-6">
        {items.length ? (
          <>
            {group("Running", running)}
            {group("Waiting", waiting)}
            {group("Finished in the last hour", finished)}
          </>
        ) : <p className="px-5 py-10 text-center text-base text-muted-foreground">Nothing runs now, and nothing ended in the last hour.</p>}
      </div>
    </SidePanel>
  );
}
