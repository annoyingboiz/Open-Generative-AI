"use client";

// DZ: AI Director. Describe a scene in your own words → the text model breaks
// it into 4–8 shots (shot size, angle, camera / lens / focal / aperture, camera
// move, light, duration, a start-frame prompt for the image model and a motion
// prompt for the video model, each by that model's prompting notes). You edit
// the list; each shot is made in two steps, each with its price: start frames
// (pick the best) → the picked frame animated by the video model.
// Storyboards are saved on the server, in the Library or in a project.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dzGenerate, dzWithMeta, dzThumb } from "../api.js";
import { useDzQuote } from "./DzPrice.jsx";
import { useDzContext } from "../dzContext.js";
import { useDzTextModelOptions } from "../dzLlm.js";
import { dzSetStudioState, DZ_INSERT_EVENT } from "../dzStudioState.js";
import { ElementPicker, useDzElements } from "./DzElements.jsx";
import { DzMediaPicker } from "./DzMedia.jsx";
import { Viewer } from "./DzLibrary.jsx";
import { ModelPicker, ParamControl, CameraPanel } from "./DzCreateStudio.jsx";
import { createEntries, chooseVariant, paramsOf, CAMERA, LENS, FOCAL, APERTURE, CAMERA_MOVES, DEFAULT_CAMERA } from "../dzCreate.js";
import {
  dzStoryboards, SHOT_SIZES, SHOT_ANGLES, emptyShot, newShotId, durationsOf, fitDuration, frameRequest, videoRequest, elementRefs,
} from "../dzDirector.js";
import {
  Button, Segmented, Textarea, Input, Spinner, Tip, cn, Popover, PopoverTrigger, PopoverContent, SelectParts, OptionSelect,
} from "../ui/index.js";

const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = SelectParts;
const fmtUsd = (usd) => `$${usd === 0 ? "0" : usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
const LLM_KEY = "dz_director_llm";
const boardKey = (scope) => `dz_director_board:${scope || "library"}`;
const errText = (e) => String(e?.message || e).replace(/^API Request Failed: \d+ [^-]*- /, "");
const notify = (message, type = "error") => window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type, title: "Director", message } }));

// Small select used inside shot cards.
function Pick({ label, value, options, onChange, none = "Board look", width = "w-auto" }) {
  return (
    <Select value={value == null || value === "" ? "__none" : String(value)} onValueChange={(v) => onChange(v === "__none" ? null : options.find((o) => String(o.value ?? o) === v)?.value ?? v)}>
      <SelectTrigger aria-label={label} className={cn("h-9 gap-1.5 rounded-lg border-transparent bg-muted px-2.5", width)}>
        <span className="text-muted-foreground">{label}:</span><SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[360px]">
        {none && <SelectItem value="__none">{none}</SelectItem>}
        {options.map((o) => {
          const v = typeof o === "object" ? o.value : o;
          return <SelectItem key={String(v)} value={String(v)}>{typeof o === "object" ? o.label : String(o)}</SelectItem>;
        })}
      </SelectContent>
    </Select>
  );
}

// A strip of results for one step: thumbnails, the picked one ringed, jobs still running.
function Strip({ items, picked, running, kind, onPick, onRemove, onOpen }) {
  if (!items.length && !running) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
      {items.map((x) => (
        <div key={x.url} className={cn("group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2", x.url === picked ? "border-primary" : "border-transparent")}>
          {x.gone ? (
            <span className="flex h-full w-full items-center justify-center bg-muted px-1 text-center text-[11px] leading-tight text-muted-foreground" title="Sent to Trash or moved out of here">Not here</span>
          ) : (
            <button type="button" className="h-full w-full" onClick={() => (x.url === picked ? onOpen(x.url) : onPick(x.url))} title={x.url === picked ? "Picked — click to view" : "Use this one"}>
              {kind === "video" ? <video src={x.url} className="h-full w-full object-cover" muted preload="metadata" /> : <img src={dzThumb(x.url, 160)} alt="" className="h-full w-full object-cover" />}
            </button>
          )}
          <button type="button" onClick={() => onRemove(x.url)} aria-label="Remove from this shot" title="Remove from this shot (stays in All work)"
            className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      ))}
      {Array.from({ length: running }, (_, i) => (
        <div key={`r${i}`} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40"><Spinner className="h-4 w-4" /></div>
      ))}
    </div>
  );
}

function ShotCard({
  shot, index, total, look, media, jobs, local, aspect, readOnly, apiKey,
  frameEntry, videoEntry, frameValues, videoValues, elements, frames, dur,
  onChange, onMove, onDuplicate, onDelete, onRun, onMedia, onOpen, onAddFrame, onDismiss,
}) {
  const m = media || { frames: [], videos: [], frame: null, video: null };
  const set = (k, v) => onChange({ ...shot, [k]: v });
  const fr = useMemo(() => frameRequest({ entry: frameEntry, shot, look, values: frameValues, elements }), [frameEntry, shot, look, frameValues, elements]);
  const vr = useMemo(() => videoRequest({ entry: videoEntry, shot, values: videoValues, frame: m.frame, dur }), [videoEntry, shot, videoValues, m.frame, dur]);
  // A price shows even before a frame is picked (any picture gives the same price).
  const vrQuote = useMemo(() => (vr.body ? vr : videoRequest({ entry: videoEntry, shot, values: videoValues, frame: "/media/u/price-check.png", dur })), [vr, videoEntry, shot, videoValues, dur]);
  const framePrice = useDzQuote(apiKey, () => (fr.body ? [dzGenerate, { endpoint: fr.variant.model.endpoint, ...fr.body }] : null), frames);
  const videoPrice = useDzQuote(apiKey, () => (vrQuote.body ? [dzGenerate, { endpoint: vrQuote.variant.model.endpoint, ...vrQuote.body }] : null));
  const running = (step) => Math.max(jobs.filter((j) => j.step === step && j.status === "running").length, local[step] || 0);
  const failed = jobs.filter((j) => j.status === "failed");
  const [picker, setPicker] = useState(false);
  const d = fitDuration(shot.duration, dur);
  const durOptions = dur.list.length ? dur.list : dur.range ? Array.from({ length: Math.min(30, dur.range.max - dur.range.min + 1) }, (_, i) => dur.range.min + i) : [];
  const price = (p, n = 1) => (p.price ? `${p.price.exact ? "" : "≈ "}${fmtUsd(p.price.usd * n)}` : "");

  return (
    <section className="rounded-2xl border border-border bg-card/60 p-3 md:p-4" aria-label={`Shot ${index + 1}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-primary/15 px-2 font-semibold text-primary">{index + 1}</span>
        <Input value={shot.title} onChange={(e) => set("title", e.target.value)} placeholder="Shot title" disabled={readOnly} className="h-9 max-w-[260px] font-semibold" />
        <Pick label="Size" value={shot.size} options={SHOT_SIZES} onChange={(v) => set("size", v)} none="—" />
        <Pick label="Angle" value={shot.angle} options={SHOT_ANGLES} onChange={(v) => set("angle", v)} none="—" />
        <Pick label="Move" value={shot.move} options={CAMERA_MOVES.map((x) => ({ value: x.id, label: x.label }))} onChange={(v) => set("move", v)} none="None" />
        {durOptions.length > 0 && (
          <Pick label="Length" value={d ?? ""} options={durOptions.map((n) => ({ value: n, label: `${n}s` }))} onChange={(v) => set("duration", v == null ? null : Number(v))} none="Model default" />
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={readOnly || index === 0} onClick={() => onMove(-1)} aria-label="Move up">↑</Button>
          <Button size="sm" variant="ghost" disabled={readOnly || index === total - 1} onClick={() => onMove(1)} aria-label="Move down">↓</Button>
          <Button size="sm" variant="ghost" disabled={readOnly} onClick={onDuplicate}>Duplicate</Button>
          <Button size="sm" variant="ghost" disabled={readOnly} className="text-red-300 hover:text-red-200" onClick={onDelete}>Delete</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {/* What happens + the camera of this shot */}
        <div className="space-y-2">
          <Textarea value={shot.action} onChange={(e) => set("action", e.target.value)} disabled={readOnly} rows={3} placeholder="What happens in this shot" className="min-h-[72px] resize-y" />
          <Input value={shot.light} onChange={(e) => set("light", e.target.value)} disabled={readOnly} placeholder="Light (e.g. low warm key from the left, teal rim)" className="h-9" />
          <div className="flex flex-wrap gap-1.5">
            <Pick label="Camera" value={shot.camera} options={Object.keys(CAMERA)} onChange={(v) => set("camera", v)} />
            <Pick label="Lens" value={shot.lens} options={Object.keys(LENS)} onChange={(v) => set("lens", v)} />
            <Pick label="Focal" value={shot.focal} options={Object.keys(FOCAL).map((f) => ({ value: Number(f), label: `${f}mm` }))} onChange={(v) => set("focal", v == null ? null : Number(v))} />
            <Pick label="Aperture" value={shot.aperture} options={Object.keys(APERTURE)} onChange={(v) => set("aperture", v)} />
          </div>
        </div>

        {/* Step 1: the start frame */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold">1 · Start frame</span>
            {m.frames.length > 0 && <span className="text-muted-foreground">{m.frames.length} made</span>}
          </div>
          <button type="button" disabled={!m.frame} onClick={() => m.frame && onOpen(m.frame, "image")}
            className="relative block w-full overflow-hidden rounded-xl border border-border bg-muted/40" style={{ aspectRatio: aspect }}>
            {m.frame ? <img src={dzThumb(m.frame, 640)} alt={`Shot ${index + 1} start frame`} className="h-full w-full object-cover" />
              : running("frame") ? <span className="flex h-full items-center justify-center gap-2 text-muted-foreground"><Spinner className="h-4 w-4" /> Making the frame…</span>
                : <span className="flex h-full items-center justify-center px-4 text-center text-muted-foreground">No frame yet</span>}
          </button>
          <Strip items={m.frames} picked={m.frame} running={running("frame")} kind="image" onOpen={(u) => onOpen(u, "image")}
            onPick={(url) => onMedia({ shot: shot.id, kind: "frame", op: "pick", url })} onRemove={(url) => onMedia({ shot: shot.id, kind: "frame", op: "remove", url })} />
          <Textarea value={shot.frame_prompt} onChange={(e) => set("frame_prompt", e.target.value)} disabled={readOnly} rows={5} placeholder="Start-frame prompt (for the image model)" className="min-h-[96px] resize-y font-[inherit]" />
          {fr.trimmed && <p className="text-amber-300">Not every element fits this image model{fr.trimmed.dropped.length ? `: left out ${fr.trimmed.dropped.join(", ")}` : ""}.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button className="rounded-xl" disabled={readOnly || !fr.body} onClick={() => onRun("frame", fr)} title={fr.problem || undefined}>
              {frames > 1 ? `Make ${frames} frames` : "Make frame"}
            </Button>
            <Button variant="secondary" className="rounded-xl" disabled={readOnly} onClick={() => setPicker(true)}>Use my image</Button>
            <span className={cn("tabular-nums", framePrice.loading ? "text-muted-foreground/60" : "text-muted-foreground")}>{price(framePrice, frames)}</span>
          </div>
          {fr.problem && <p className="text-amber-300">{fr.problem}</p>}
          <DzMediaPicker open={picker} onOpenChange={setPicker} accept="image" max={1} apiKey={apiKey} title="Start frame" onPick={(list) => list[0] && onAddFrame(list[0].url)} />
        </div>

        {/* Step 2: the picked frame animated */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold">2 · Video</span>
            {m.videos.length > 0 && <span className="text-muted-foreground">{m.videos.length} made</span>}
          </div>
          <div className="relative w-full overflow-hidden rounded-xl border border-border bg-muted/40" style={{ aspectRatio: aspect }}>
            {m.video ? <video key={m.video} src={m.video} controls playsInline preload="metadata" className="h-full w-full object-cover" />
              : running("video") ? <span className="flex h-full items-center justify-center gap-2 text-muted-foreground"><Spinner className="h-4 w-4" /> Making the video…</span>
                : <span className="flex h-full items-center justify-center px-4 text-center text-muted-foreground">{m.frame ? "Ready to animate the picked frame" : "Pick a start frame first"}</span>}
          </div>
          <Strip items={m.videos} picked={m.video} running={running("video")} kind="video" onOpen={(u) => onOpen(u, "video")}
            onPick={(url) => onMedia({ shot: shot.id, kind: "video", op: "pick", url })} onRemove={(url) => onMedia({ shot: shot.id, kind: "video", op: "remove", url })} />
          <Textarea value={shot.motion_prompt} onChange={(e) => set("motion_prompt", e.target.value)} disabled={readOnly} rows={5} placeholder="Motion prompt (for the video model)" className="min-h-[96px] resize-y" />
          <div className="flex flex-wrap items-center gap-2">
            <Button className="rounded-xl" disabled={readOnly || !vr.body} onClick={() => onRun("video", vr)} title={vr.problem || undefined}>Make video</Button>
            <span className={cn("tabular-nums", videoPrice.loading ? "text-muted-foreground/60" : "text-muted-foreground")}>{price(videoPrice)}</span>
          </div>
          {m.frame && vr.problem && <p className="text-amber-300">{vr.problem}</p>}
        </div>
      </div>

      {failed.map((j) => (
        <div key={j.id} className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">
          <span className="flex-1">{j.step === "video" ? "Video" : "Frame"} failed: {j.error}</span>
          <button type="button" onClick={() => onDismiss(j.id)} className="text-red-200/70 hover:text-red-100" aria-label="Dismiss">✕</button>
        </div>
      ))}
    </section>
  );
}

export default function DzDirector({ apiKey, onGenerationStart, onGenerationEnd, onGenerationComplete, onGenerationError }) {
  const ctx = useDzContext();
  const scope = ctx.project?.id || "";
  const readOnly = Boolean(ctx.project?.archived);
  const [catalogReady, setCatalogReady] = useState(false);
  useEffect(() => { setCatalogReady(true); }, []);
  const imageEntries = useMemo(() => (catalogReady ? createEntries("image") : []), [catalogReady]);
  const videoEntries = useMemo(() => (catalogReady ? createEntries("video").filter((e) => e.slots.some((s) => s.role === "first")) : []), [catalogReady]);

  const [boards, setBoards] = useState([]);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [draft, setDraft] = useState(null); // { id, name, scene, look, settings, shots, author, updated_by }
  const [media, setMedia] = useState({});
  const [jobs, setJobs] = useState([]);
  const [local, setLocal] = useState({}); // "shot:step" -> requests still being sent from here
  const [dismissed, setDismissed] = useState(() => new Set());
  const [planning, setPlanning] = useState(false);
  const [planInfo, setPlanInfo] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [saveState, setSaveState] = useState("saved"); // saved | saving | unsaved
  const revRef = useRef(0);
  const dirtyRef = useRef(false);
  const editVer = useRef(0);
  const saveTimer = useRef(null);
  const saving = useRef(null); // the save in flight (a promise)
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // The board on screen: answers about another board (a slow load, a refresh
  // or a change sent before switching) are ignored.
  const currentRef = useRef(null);

  const textModels = useDzTextModelOptions();
  const [llmId, setLlmId] = useState(() => { try { return localStorage.getItem(LLM_KEY) || ""; } catch { return ""; } });
  const llmChosen = textModels.options.some((o) => o.value === llmId) ? llmId : textModels.def || textModels.options[0]?.value || "";
  useEffect(() => { try { if (llmId) localStorage.setItem(LLM_KEY, llmId); } catch { /* optional */ } }, [llmId]);

  // ── Loading ────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    try {
      const r = await dzStoryboards.list(scope || null);
      setBoards(r.storyboards || []);
      return r.storyboards || [];
    } catch (e) { onGenerationError?.(errText(e)); return []; } finally { setBoardsLoaded(true); }
  }, [scope, onGenerationError]);

  const takeServer = useCallback((sb, { force = false } = {}) => {
    if (!sb || sb.id !== currentRef.current) return;
    setMedia(sb.media || {});
    setJobs(sb.jobs || []);
    if (force || !dirtyRef.current) {
      revRef.current = sb.rev;
      dirtyRef.current = false;
      setSaveState("saved");
      setDraft({ id: sb.id, name: sb.name, scene: sb.scene, look: sb.look, settings: sb.settings || {}, shots: sb.shots || [], author: sb.author, mine: sb.mine, updated_by: sb.updated_by });
    }
    setBoards((list) => list.map((b) => (b.id === sb.id ? { ...b, name: sb.name, shots: sb.shots.length, cover: sb.shots.map((s) => sb.media?.[s.id]?.frame).find(Boolean) || null } : b)));
  }, []);

  const open = useCallback(async (id) => {
    clearTimeout(saveTimer.current);
    currentRef.current = id || null;
    setCurrentId(id);
    setDraft(null); setMedia({}); setJobs([]); setPlanInfo(null);
    dirtyRef.current = false;
    try { localStorage.setItem(boardKey(scope), id || ""); } catch { /* optional */ }
    if (!id) return;
    try { takeServer((await dzStoryboards.get(id)).storyboard, { force: true }); } catch (e) {
      if (currentRef.current !== id) return;
      onGenerationError?.(errText(e)); currentRef.current = null; setCurrentId(null);
    }
  }, [scope, takeServer, onGenerationError]);

  useEffect(() => {
    let alive = true;
    setBoardsLoaded(false);
    (async () => {
      const list = await loadList();
      if (!alive) return;
      let want = null;
      try { want = localStorage.getItem(boardKey(scope)); } catch { /* optional */ }
      open(list.some((b) => b.id === want) ? want : list[0]?.id || null);
    })();
    return () => { alive = false; };
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Saving (debounced, with the revision we started from) ───────────────
  // Resolves true when everything on screen is saved; false after a conflict
  // (the board was reloaded) or an error — then nothing may build on the draft.
  const save = useCallback(async ({ keepalive = false } = {}) => {
    if (saving.current) { if (!(await saving.current)) return false; }
    const d = draftRef.current;
    if (!d || d.id !== currentRef.current) return false;
    if (!dirtyRef.current) return true;
    const ver = editVer.current;
    setSaveState("saving");
    const p = (async () => {
      try {
        const r = await dzStoryboards.update(d.id, { rev: revRef.current, name: d.name, scene: d.scene, look: d.look, settings: d.settings, shots: d.shots }, { keepalive });
        if (d.id !== currentRef.current) return false;
        revRef.current = r.storyboard.rev;
        const clean = editVer.current === ver;
        if (clean) { dirtyRef.current = false; setSaveState("saved"); }
        setMedia(r.storyboard.media || {});
        setJobs(r.storyboard.jobs || []);
        setBoards((list) => list.map((b) => (b.id === d.id ? { ...b, name: d.name, shots: d.shots.length } : b)));
        return clean;
      } catch (e) {
        if (d.id !== currentRef.current) return false;
        if (e.status === 409 && e.storyboard) { takeServer(e.storyboard, { force: true }); notify(errText(e)); } else { setSaveState("unsaved"); onGenerationError?.(`Not saved: ${errText(e)}`); }
        return false;
      }
    })();
    saving.current = p;
    try { return await p; } finally { if (saving.current === p) saving.current = null; }
  }, [takeServer, onGenerationError]);
  // Save now (and again if more was typed meanwhile); true when all is saved.
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    for (let i = 0; i < 3; i += 1) {
      if (saving.current && !(await saving.current)) return false;
      if (!dirtyRef.current) return true;
      if (!(await save()) && !dirtyRef.current) return false;
    }
    return !dirtyRef.current;
  }, [save]);

  const edit = useCallback((fn) => {
    if (readOnly) return;
    setDraft((d) => (d ? fn(d) : d));
    dirtyRef.current = true;
    editVer.current += 1;
    setSaveState("unsaved");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { save(); }, 900);
  }, [save, readOnly]);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => { clearTimeout(saveTimer.current); if (dirtyRef.current) saveRef.current({ keepalive: true }); }, []);
  // Save on leaving the page (keepalive: the request outlives the page).
  useEffect(() => {
    const onHide = () => { if (dirtyRef.current) save({ keepalive: true }); };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [save]);

  // ── Polling while something is being made ──────────────────────────────
  const refresh = useCallback(async () => {
    const id = draftRef.current?.id;
    if (!id) return;
    try { takeServer((await dzStoryboards.get(id)).storyboard); } catch { /* next time */ }
  }, [takeServer]);
  const busyCount = jobs.filter((j) => j.status === "running").length + Object.values(local).reduce((a, b) => a + b, 0);
  useEffect(() => {
    if (!busyCount) return undefined;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [busyCount, refresh]);
  // Someone else may be editing the same board: look again now and then.
  useEffect(() => {
    if (!draft?.id) return undefined;
    const t = setInterval(() => { if (!document.hidden && !dirtyRef.current) refresh(); }, 30_000);
    return () => clearInterval(t);
  }, [draft?.id, refresh]);

  // ── Settings: models, values, elements ─────────────────────────────────
  const settings = draft?.settings || {};
  const look = draft?.look || {};
  const setSettings = (patch) => edit((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const imageEntry = imageEntries.find((e) => e.key === settings.image) || imageEntries.find((e) => /nano-banana/.test(e.family)) || imageEntries[0] || null;
  const videoEntry = videoEntries.find((e) => e.key === settings.video) || videoEntries[0] || null;
  const imageVariant = imageEntry ? chooseVariant(imageEntry, {}) || imageEntry.variants[0] : null;
  const videoVariant = videoEntry ? chooseVariant(videoEntry, { first: [{ url: "x" }] }) || videoEntry.variants[0] : null;
  const frameValues = useMemo(() => settings.imageValues || {}, [settings.imageValues]);
  const videoValues = useMemo(() => settings.videoValues || {}, [settings.videoValues]);
  const imageParams = imageVariant ? paramsOf(imageVariant.model).main.filter((p) => !["num_images", "n", "batch_size"].includes(p.key)) : [];
  const videoParams = videoVariant ? paramsOf(videoVariant.model).main.filter((p) => p.key !== "duration") : [];
  const dur = useMemo(() => durationsOf(videoVariant), [videoVariant]);
  const frames = [1, 2, 3, 4].includes(settings.frames) ? settings.frames : 1;
  const aspectValue = frameValues.aspect_ratio || frameValues.ratio || imageParams.find((p) => p.key === "aspect_ratio" || p.key === "ratio")?.default || "16:9";
  const aspect = /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(String(aspectValue)) ? String(aspectValue).replace(":", " / ") : "16 / 9";

  const elementLists = useDzElements();
  const allElements = useMemo(() => [...elementLists.project, ...elementLists.library, ...(elementLists.others || [])], [elementLists]);
  const elements = useMemo(() => (settings.elements || []).map((id) => allElements.find((e) => e.id === id)).filter((e) => e && e.status !== "draft"), [settings.elements, allElements]);

  // Side chat: it sees the scene and the video model; "Insert" puts text into the scene.
  useEffect(() => {
    dzSetStudioState("director", { model: videoEntry ? { family: videoEntry.family, name: videoEntry.familyName, kind: "video" } : null, prompt: draft?.scene || "", writable: Boolean(draft) && !readOnly });
  }, [videoEntry, draft, readOnly]);
  const editRef = useRef(edit);
  editRef.current = edit;
  useEffect(() => {
    const on = (e) => {
      const { tab, text, how } = e.detail || {};
      if (tab !== "director" || typeof text !== "string" || !text.trim()) return;
      if (!draftRef.current) { notify("Open or create a storyboard first."); return; }
      editRef.current((d) => ({ ...d, scene: (how === "replace" || !d.scene?.trim() ? text.trim() : `${d.scene.replace(/\s+$/, "")}\n\n${text.trim()}`).slice(0, 6000) }));
    };
    window.addEventListener(DZ_INSERT_EVENT, on);
    return () => window.removeEventListener(DZ_INSERT_EVENT, on);
  }, []);

  // ── Board actions ──────────────────────────────────────────────────────
  const switchTo = async (id) => { if (id === currentId) return; await flush(); open(id); }; // a failed save was reported; switching still works
  const createBoard = async () => {
    try {
      if (draftRef.current && !(await flush())) return;
      // Frames in the film's shape: 16:9 when the image model has it (the video takes the frame's shape).
      const ar = imageParams.find((p) => p.key === "aspect_ratio" || p.key === "ratio");
      const imageValues = ar && Array.isArray(ar.enum) && ar.enum.map(String).includes("16:9") ? { [ar.key]: "16:9" } : {};
      const r = await dzStoryboards.create({ project: scope || null, name: "Untitled scene", settings: imageEntry && videoEntry ? { image: imageEntry.key, video: videoEntry.key, frames: 1, imageValues } : {} });
      setBoards((list) => [{ id: r.storyboard.id, name: r.storyboard.name, shots: 0, cover: null, mine: true }, ...list]);
      open(r.storyboard.id);
    } catch (e) { onGenerationError?.(errText(e)); }
  };
  const deleteBoard = async () => {
    if (!draft || !window.confirm(`Delete “${draft.name}”? Frames and videos stay in All work.`)) return;
    try {
      clearTimeout(saveTimer.current);
      dirtyRef.current = false;
      await dzStoryboards.remove(draft.id);
      const list = boards.filter((b) => b.id !== draft.id);
      setBoards(list);
      open(list[0]?.id || null);
    } catch (e) { onGenerationError?.(errText(e)); }
  };

  const plan = async () => {
    if (!draft?.scene?.trim()) { onGenerationError?.("Describe the scene first."); return; }
    const hasWork = draft.shots.some((s) => (media[s.id]?.frames || []).length || (media[s.id]?.videos || []).length);
    if (draft.shots.length && !window.confirm(`Replace the ${draft.shots.length} shot${draft.shots.length === 1 ? "" : "s"} with a new plan?${hasWork ? " Frames and videos already made stay in All work." : ""}`)) return;
    setPlanning(true);
    setPlanInfo(null);
    try {
      // Plan from what is saved — exactly what is on screen now.
      if (!(await flush())) return;
      const draft = draftRef.current;
      if (!draft?.scene?.trim()) return;
      const audio = [videoValues.generate_audio, videoValues.audio, videoValues.sound, videoValues.enable_audio].find((v) => typeof v === "boolean");
      const r = await dzStoryboards.plan(draft.id, {
        rev: revRef.current, scene: draft.scene, count: settings.count || "auto",
        image: { family: imageEntry?.family }, video: { family: videoEntry?.family },
        aspect: String(aspectValue || ""), durations: dur.list, range: dur.range, audio,
        look: look.note || "", references: elementRefs(elements), llm: llmChosen || undefined,
      });
      takeServer(r.storyboard, { force: true });
      setPlanInfo(r.plan);
      loadList();
    } catch (e) {
      if (e.status === 409 && e.storyboard) takeServer(e.storyboard, { force: true });
      onGenerationError?.(errText(e));
    } finally { setPlanning(false); }
  };

  // ── Shots ──────────────────────────────────────────────────────────────
  const setShot = (i, next) => edit((d) => ({ ...d, shots: d.shots.map((s, j) => (j === i ? next : s)) }));
  const moveShot = (i, dir) => edit((d) => { const shots = [...d.shots]; const [s] = shots.splice(i, 1); shots.splice(i + dir, 0, s); return { ...d, shots }; });
  const duplicateShot = (i) => edit((d) => { const shots = [...d.shots]; shots.splice(i + 1, 0, { ...d.shots[i], id: newShotId(), title: d.shots[i].title ? `${d.shots[i].title} (2)`.slice(0, 80) : "" }); return { ...d, shots }; });
  const deleteShot = (i) => {
    const s = draft.shots[i];
    const made = (media[s.id]?.frames || []).length + (media[s.id]?.videos || []).length;
    if (made && !window.confirm(`Delete shot ${i + 1}? Its ${made} frame${made === 1 ? "" : "s"}/video${made === 1 ? "" : "s"} stay in All work.`)) return;
    edit((d) => ({ ...d, shots: d.shots.filter((_, j) => j !== i) }));
  };
  const addShot = () => edit((d) => ({ ...d, shots: [...d.shots, emptyShot()] }));

  const changeMedia = async (body) => {
    const id = currentRef.current;
    if (!id) return;
    try { takeServer((await dzStoryboards.media(id, body)).storyboard); } catch (e) { if (currentRef.current === id) onGenerationError?.(errText(e)); }
  };
  const addFrame = async (shotId, url) => {
    if (!(await flush())) return; // the shot must be saved before a file joins it
    await changeMedia({ shot: shotId, kind: "frame", op: "add", url });
  };

  // One step of a shot: ×frames for start frames, one video. Each is its own job;
  // the server puts the result into the shot (also after a reload).
  const run = async (shot, step, req) => {
    if (!req?.body || !draft) return;
    // The shot must be on the server before its job (the result joins it there).
    if (!(await flush())) return;
    const boardId = currentRef.current;
    if (!draftRef.current?.shots.some((s) => s.id === shot.id)) return;
    const key = `${shot.id}:${step}`;
    const n = step === "frame" ? frames : 1;
    const entry = step === "frame" ? imageEntry : videoEntry;
    const meta = {
      kind: step === "frame" ? "image" : "video",
      entryKey: entry.key,
      modelName: `${entry.familyName} · ${entry.providerName}`,
      prompt: step === "frame" ? shot.frame_prompt : shot.motion_prompt,
      values: Object.fromEntries(Object.entries(req.body).filter(([k, v]) => k !== "prompt" && k !== "elements" && (typeof v !== "string" || !v.startsWith("/media/")))),
      forShot: { board: boardId, shot: shot.id, step },
      shotTitle: shot.title || "",
      boardName: draftRef.current?.name || "",
    };
    const one = async () => {
      setLocal((l) => ({ ...l, [key]: (l[key] || 0) + 1 }));
      onGenerationStart?.();
      try {
        const res = await dzWithMeta({ studio: "director", meta }, () => dzGenerate(apiKey, { endpoint: req.variant.model.endpoint, ...req.body }));
        onGenerationEnd?.();
        if (res?.url) onGenerationComplete?.({ url: res.url, type: meta.kind });
      } catch (e) {
        onGenerationEnd?.();
        onGenerationError?.(errText(e));
      } finally {
        setLocal((l) => { const next = { ...l, [key]: Math.max(0, (l[key] || 1) - 1) }; if (!next[key]) delete next[key]; return next; });
        setTimeout(refresh, 700);
      }
    };
    setTimeout(refresh, 1500);
    await Promise.all(Array.from({ length: n }, one));
  };

  // "Frames for all shots": shots with no frame yet, three at a time.
  const shotsWithoutFrame = (draft?.shots || []).filter((s) => !media[s.id]?.frame && !jobs.some((j) => j.shot === s.id && j.step === "frame" && j.status === "running") && !local[`${s.id}:frame`]);
  const firstReq = shotsWithoutFrame[0] ? frameRequest({ entry: imageEntry, shot: shotsWithoutFrame[0], look, values: frameValues, elements }) : null;
  const allFramesPrice = useDzQuote(apiKey, () => (firstReq?.body ? [dzGenerate, { endpoint: firstReq.variant.model.endpoint, ...firstReq.body }] : null), shotsWithoutFrame.length * frames);
  const runAllFrames = async () => {
    const list = shotsWithoutFrame.map((s) => ({ s, req: frameRequest({ entry: imageEntry, shot: s, look, values: frameValues, elements }) })).filter((x) => x.req.body);
    const queue = [...list];
    const worker = async () => { while (queue.length) { const { s, req } = queue.shift(); await run(s, "frame", req); } };
    // At most ~6 jobs at once (the server allows 8 per person): ×1 → 6 shots, ×4 → 1 shot at a time.
    const workers = Math.max(1, Math.floor(6 / frames));
    await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, worker));
  };

  const jobsFor = (shotId) => jobs.filter((j) => j.shot === shotId && !dismissed.has(j.id));
  const localFor = (shotId) => ({ frame: local[`${shotId}:frame`] || 0, video: local[`${shotId}:video`] || 0 });

  // ── Render ─────────────────────────────────────────────────────────────
  const where = ctx.project ? ctx.project.name : "your Library";
  return (
    <div className="flex h-full w-full bg-background">
      {/* Storyboards of this place */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border md:flex">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-semibold">Storyboards</span>
          <Button size="sm" onClick={createBoard} disabled={readOnly}>New</Button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto custom-scrollbar px-2 pb-3">
          {!boardsLoaded && <div className="flex justify-center py-6"><Spinner /></div>}
          {boardsLoaded && !boards.length && <p className="px-2 py-4 text-muted-foreground">None in {where} yet.</p>}
          {boards.map((b) => (
            <button key={b.id} type="button" onClick={() => switchTo(b.id)}
              className={cn("flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors", b.id === currentId ? "bg-primary/10" : "hover:bg-accent")}>
              {b.cover ? <img src={dzThumb(b.cover, 160)} alt="" className="h-10 w-14 shrink-0 rounded-md object-cover" /> : <span className="h-10 w-14 shrink-0 rounded-md bg-muted" />}
              <span className="min-w-0">
                <span className={cn("block truncate font-semibold", b.id === currentId && "text-primary")}>{b.name}</span>
                <span className="block text-muted-foreground">{b.shots} shot{b.shots === 1 ? "" : "s"}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto custom-scrollbar">
        {!draft ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
            <h2 className="text-2xl font-semibold">AI Director</h2>
            <p className="text-muted-foreground">Describe a scene in your own words. The Director breaks it into shots — shot size, camera, lens, camera move, light — and writes a start-frame prompt and a motion prompt for your models. You edit the list, make start frames, pick the best ones and animate them, shot by shot, each with its price.</p>
            {currentId && !draft ? <Spinner /> : <Button size="lg" onClick={createBoard} disabled={readOnly}>New storyboard</Button>}
            {/* Phones: the list is above, in a select */}
            {boards.length > 0 && (
              <div className="w-full md:hidden">
                <OptionSelect value={currentId || ""} onValueChange={switchTo} options={boards.map((b) => ({ value: b.id, label: b.name, description: `${b.shots} shots` }))} placeholder="Open a storyboard" aria-label="Storyboards" />
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-[1400px] space-y-4 p-3 md:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <div className="md:hidden">
                <OptionSelect value={currentId || ""} onValueChange={switchTo} options={boards.map((b) => ({ value: b.id, label: b.name, description: `${b.shots} shots` }))} aria-label="Storyboards" />
              </div>
              <Input value={draft.name} onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} disabled={readOnly} aria-label="Storyboard name" className="h-10 max-w-[420px] text-lg font-semibold" />
              <span className="text-muted-foreground">
                {readOnly ? "Archived project — read only" : saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Not saved yet" : "Saved"}
                {draft.author ? ` · by ${draft.author}` : ""}{draft.updated_by ? ` · last edit ${draft.updated_by}` : ""}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="secondary" size="sm" className="md:hidden" onClick={createBoard} disabled={readOnly}>New</Button>
                <Button variant="ghost" size="sm" className="text-red-300 hover:text-red-200" onClick={deleteBoard} disabled={readOnly}>Delete storyboard</Button>
              </div>
            </div>

            {/* The scene and how it is made */}
            <section className="space-y-3 rounded-2xl border border-border bg-card/60 p-3 md:p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">Scene</span>
                <span className="text-muted-foreground">{(draft.scene || "").length}/6000</span>
              </div>
              <Textarea value={draft.scene} onChange={(e) => edit((d) => ({ ...d, scene: e.target.value }))} disabled={readOnly} rows={5} maxLength={6000}
                placeholder="What happens, who is in it, where and when, the mood. Any language. Example: Night. Anna waits on a wet rooftop; Mike comes out of the stairwell, they argue, she leaves without looking back."
                className="min-h-[110px] resize-y text-base" />
              <Input value={look.note || ""} onChange={(e) => edit((d) => ({ ...d, look: { ...d.look, note: e.target.value } }))} disabled={readOnly} maxLength={300}
                placeholder="Look of the film (optional): e.g. 35mm film grain, teal and orange, rain, neon" className="h-10" />

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2 rounded-xl bg-muted/30 p-2.5">
                  <span className="text-muted-foreground">Start frames · image model</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <ModelPicker entries={imageEntries} entry={imageEntry} onPick={(key) => setSettings({ image: key })} />
                    {imageParams.map((p) => <ParamControl key={p.key} p={p} value={frameValues[p.key]} onChange={(v) => setSettings({ imageValues: { ...frameValues, [p.key]: v } })} compact />)}
                    <Tip text="How many start frames each “Make frame” makes (separate jobs, each paid) — then you pick the best">
                      <span><Segmented value={frames} onChange={(v) => setSettings({ frames: v })} size="sm" className="w-auto" aria-label="Frames per shot" options={[1, 2, 3, 4].map((n) => ({ value: n, label: `×${n}` }))} /></span>
                    </Tip>
                  </div>
                </div>
                <div className="space-y-2 rounded-xl bg-muted/30 p-2.5">
                  <span className="text-muted-foreground">Animation · video model (takes a start frame)</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <ModelPicker entries={videoEntries} entry={videoEntry} onPick={(key) => setSettings({ video: key })} />
                    {videoParams.map((p) => <ParamControl key={p.key} p={p} value={videoValues[p.key]} onChange={(v) => setSettings({ videoValues: { ...videoValues, [p.key]: v } })} compact />)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ElementPicker selected={elements} onChange={(list) => setSettings({ elements: list.map((e) => e.id) })} max={7}
                  note="Characters, places and props of this scene: the Director uses their @tags, and their pictures go to the image model as references." />
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="secondary" className="h-10 rounded-xl px-3 font-medium">Board look · {look.camera || DEFAULT_CAMERA.camera}</Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[min(440px,calc(100vw-24px))] rounded-2xl">
                    <p className="mb-3 text-muted-foreground">Default camera, lens, focal length and aperture for every shot. A shot can set its own.</p>
                    <CameraPanel camera={{ ...DEFAULT_CAMERA, ...look, on: true }} setCamera={(fn) => edit((d) => { const next = typeof fn === "function" ? fn({ ...DEFAULT_CAMERA, ...d.look, on: true }) : fn; const { on, ...rest } = next; return { ...d, look: { ...d.look, ...rest } }; })} />
                  </PopoverContent>
                </Popover>
                <Select value={String(settings.count || "auto")} onValueChange={(v) => setSettings({ count: v === "auto" ? "auto" : Number(v) })}>
                  <SelectTrigger aria-label="How many shots" className="h-10 w-auto gap-2 rounded-xl border-transparent bg-muted px-3">
                    <span className="text-muted-foreground">Shots:</span><SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (4–8)</SelectItem>
                    {[3, 4, 5, 6, 7, 8, 10, 12].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="min-w-[220px] max-w-[300px]">
                  <OptionSelect value={llmChosen} onValueChange={setLlmId} options={textModels.options} placeholder={textModels.loaded ? "No text model" : "Loading…"} aria-label="Text model" className="min-h-10 py-1" />
                </div>
                <Button size="lg" className="ml-auto h-11 rounded-xl px-6" onClick={plan} disabled={readOnly || planning || !draft.scene?.trim() || !imageEntry || !videoEntry}>
                  {planning ? <><Spinner className="h-4 w-4 border-primary-foreground/30 border-t-primary-foreground" /> Planning…</> : draft.shots.length ? "Plan again" : "Plan shots"}
                </Button>
              </div>
              {planInfo && (
                <p className="text-muted-foreground">
                  Planned with {planInfo.llm}{planInfo.costUsd != null ? ` · ${planInfo.costUsd === 0 ? "free" : fmtUsd(planInfo.costUsd)}` : ""} · {Math.round((planInfo.ms || 0) / 1000)} s · prompts by the notes for {planInfo.memos?.image} and {planInfo.memos?.video}.
                </p>
              )}
            </section>

            {draft.shots.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{draft.shots.length} shot{draft.shots.length === 1 ? "" : "s"}</span>
                {shotsWithoutFrame.length > 0 && (
                  <>
                    <Button variant="secondary" className="rounded-xl" disabled={readOnly || !firstReq?.body} onClick={runAllFrames}>
                      Frames for {shotsWithoutFrame.length === draft.shots.length ? "all shots" : `${shotsWithoutFrame.length} shots without one`}
                    </Button>
                    <span className="tabular-nums text-muted-foreground">{allFramesPrice.price ? `≈ ${fmtUsd(allFramesPrice.price.usd * shotsWithoutFrame.length * frames)}` : ""}</span>
                  </>
                )}
              </div>
            )}

            {draft.shots.map((s, i) => (
              <ShotCard key={s.id} shot={s} index={i} total={draft.shots.length} look={look} media={media[s.id]} jobs={jobsFor(s.id)} local={localFor(s.id)}
                aspect={aspect} readOnly={readOnly} apiKey={apiKey} frameEntry={imageEntry} videoEntry={videoEntry} frameValues={frameValues} videoValues={videoValues}
                elements={elements} frames={frames} dur={dur}
                onChange={(next) => setShot(i, next)} onMove={(dir) => moveShot(i, dir)} onDuplicate={() => duplicateShot(i)} onDelete={() => deleteShot(i)}
                onRun={(step, req) => run(s, step, req)} onMedia={changeMedia} onOpen={(url, kind) => setViewing({ url, kind, prompt: s.title || `Shot ${i + 1}` })}
                onAddFrame={(url) => addFrame(s.id, url)} onDismiss={(id) => setDismissed((set) => new Set([...set, id]))} />
            ))}
            {!readOnly && (
              <div className="flex justify-center pb-8">
                <Button variant="secondary" className="rounded-xl" onClick={addShot}>+ Add a shot</Button>
              </div>
            )}
          </div>
        )}
      </main>
      <Viewer item={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
