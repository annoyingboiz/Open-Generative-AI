"use client";

// Storyboard tab (package 05, §4.5; package 06, S5–S7): scenes top to bottom, each with its shots.
// References layer — All pictures or One per shot; Generated layer.
// Nothing here generates: a click opens the shot's working screen.
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, CaretLeft, CaretRight, DotsThree, Check, Sparkle, TextAlignLeft, Images, X, ArrowUpRight, Play, FilmSlate, FileText, Rows, SquaresFour, Spinner as SpinIcon } from "@phosphor-icons/react";
import { dzThumb } from "../../api.js";
import { DropdownMenuParts, SegSwitch, Tip, cn } from "../../ui/index.js";
import { numbered, shotState, newSceneId, newShotId, splitScript, isVideoUrl } from "../../dzFilm.js";
import { RefPicker, EmptyState, InlineText, uploadAll, pickerHereOf } from "./parts.jsx";
import { useDzHistory } from "../../dzLibrary.js";
import { setSceneSelection } from "./assistant.js";
import { useDzDropTarget, dzDropHit } from "../../dzDrop.js";
import { dzScrollBoxRef } from "../../dzScroll.js";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } = DropdownMenuParts;
const DRAG = "application/x-dz-ref";
const REF_H = 190; // package 06, S6
const GAP = 8;

function Ref({ r, height = REF_H, onRemove, dragData, onDropBefore }) {
  const w = r.w && r.h ? Math.round((height * r.w) / r.h) : Math.round(height * 1.5);
  const [over, setOver] = useState(false);
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG, JSON.stringify(dragData)); e.dataTransfer.effectAllowed = "move"; }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const raw = e.dataTransfer.getData(DRAG); if (raw) { e.preventDefault(); e.stopPropagation(); onDropBefore(JSON.parse(raw)); } }}
      className={cn("group/r relative flex-shrink-0 cursor-grab overflow-hidden rounded-[10px] bg-muted active:cursor-grabbing", over && "ring-2 ring-signal")} style={{ width: w, height }}>
      {r.kind === "video" ? <video src={r.url} poster={dzThumb(r.url, 480)} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
        : <img src={dzThumb(r.url, 480)} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" loading="lazy" />}
      {r.kind === "video" && <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-overlay/60 text-overlay-foreground"><Play size={10} weight="fill" /></span>}
      <button type="button" aria-label="Remove from the shot" onClick={onRemove}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-overlay/60 text-overlay-foreground opacity-0 transition-opacity duration-state hover:bg-overlay/80 group-hover/r:opacity-100 focus:opacity-100"><X size={12} /></button>
    </div>
  );
}

// One shot in "All pictures": a bordered frame, its references in one row at their own widths.
function ShotFrame({ shot, onNote, onAdd, onRemoveRef, onMoveRef, onOpen, onDelete, width }) {
  const row = useRef(null);
  const [over, setOver] = useState(false);
  const [scroll, setScroll] = useState({ first: 1, last: 0, can: false, left: false, right: false });
  const refs = shot.refs || [];
  const widths = refs.map((r) => (r.w && r.h ? Math.round((REF_H * r.w) / r.h) : Math.round(REF_H * 1.5)));
  const natural = refs.length ? Math.max(240, widths.reduce((a, b) => a + b + GAP, 0) + 64 + 26) : 226; // refs + plus + padding and border
  const measure = () => {
    const el = row.current;
    if (!el) return;
    const can = el.scrollWidth > el.clientWidth + 4;
    let x = 0; let first = 0; let last = 0;
    widths.forEach((w, i) => {
      const a = x; const b = x + w;
      if (b > el.scrollLeft + 4 && !first) first = i + 1;
      if (a < el.scrollLeft + el.clientWidth - 4) last = i + 1;
      x += w + GAP;
    });
    setScroll({ first: first || 1, last, can, left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => { measure(); }, [refs.length, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (dir) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div data-dz-shot={shot.id}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG);
        if (raw) { e.preventDefault(); e.stopPropagation(); onMoveRef(JSON.parse(raw), null); }
      }}
      className={cn("group/s min-w-0 rounded-[14px] border bg-card/40 p-3 transition-colors duration-state", over ? "border-signal" : "border-border")}
      style={{ width: Math.min(natural, width), maxWidth: "100%" }}>
      <div className="flex h-6 items-center gap-2">
        <button type="button" onClick={onOpen} className="flex-shrink-0 text-[15px] font-semibold hover:underline">Shot {shot.n}</button>
        <span className="flex-1" />
        {scroll.can ? (
          <span className="flex flex-shrink-0 items-center gap-1 text-sm tabular-nums text-muted-foreground">
            {scroll.first}–{scroll.last} of {refs.length}
            <button type="button" aria-label="Earlier" disabled={!scroll.left} onClick={() => step(-1)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"><CaretLeft size={14} /></button>
            <button type="button" aria-label="Later" disabled={!scroll.right} onClick={() => step(1)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"><CaretRight size={14} /></button>
          </span>
        ) : <span className="flex-shrink-0 text-base tabular-nums text-muted-foreground">{refs.length}</span>}
        <span className="flex flex-shrink-0 items-center opacity-0 transition-opacity duration-state group-hover/s:opacity-100 group-focus-within/s:opacity-100">
          <button type="button" aria-label={`Open shot ${shot.n}`} onClick={onOpen} className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowUpRight size={14} /></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" aria-label="Shot menu" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><DotsThree size={16} weight="bold" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpen}>Open the working screen</DropdownMenuItem>
              <DropdownMenuItem onSelect={onAdd}>Add references…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>Delete shot</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <InlineText value={shot.note} onChange={onNote} placeholder="Click to add a note" className="mb-2.5 mt-0.5 block w-full text-base text-muted-foreground" maxLength={200} />
      {refs.length ? (
        <div ref={row} onScroll={measure} className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ gap: GAP }}>
          {refs.map((r, i) => (
            <Ref key={r.url} r={r} dragData={{ shot: shot.id, url: r.url }} onRemove={() => onRemoveRef(r.url)} onDropBefore={(d) => onMoveRef(d, i)} />
          ))}
          <button type="button" onClick={onAdd} aria-label="Add references"
            className="flex w-16 flex-shrink-0 items-center justify-center rounded-[10px] border border-dashed border-input text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground" style={{ height: REF_H }}><Plus size={16} /></button>
        </div>
      ) : (
        // An empty shot (S7): one area — a click opens the picker, files can be dropped on it.
        <button type="button" onClick={onAdd} className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-input text-base text-muted-foreground transition-colors duration-state hover:bg-accent/40 hover:text-foreground" style={{ height: REF_H }}>
          <Plus size={14} /> Add references
        </button>
      )}
    </div>
  );
}

const Badge = ({ children, className }) => (
  <span className={cn("flex h-6 items-center gap-1 rounded-full bg-overlay/60 px-2 text-xs font-semibold text-overlay-foreground backdrop-blur-md", className)}>{children}</span>
);
export const ApprovedBadge = ({ n = 1 }) => (
  <span className="flex h-6 items-center gap-1 rounded-full bg-success px-2 text-xs font-semibold text-overlay-foreground"><Check size={12} weight="bold" />{n > 1 ? `${n} approved` : "Approved"}</span>
);

function Thumb16({ url, dim, className }) {
  const video = isVideoUrl(url);
  // Pictures keep their own aspect ratio inside the 16:9 tile (package 05, rule 5).
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden rounded-md bg-muted", className)}>
      {url ? (video ? <video src={url} poster={dzThumb(url, 960)} muted playsInline preload="metadata" className={cn("h-full w-full object-contain", dim && "opacity-40")} />
        : <img src={dzThumb(url, 960)} alt="" className={cn("h-full w-full object-contain", dim && "opacity-40")} loading="lazy" />)
        : <span className="flex h-full items-center justify-center text-muted-foreground"><Images size={22} /></span>}
    </div>
  );
}

// The storyboard note (the idea), at the top of the Storyboard: several lines, edits in place.
function FilmNote({ value, onChange, brief, onOpenBrief }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);
  const done = (save) => { setEditing(false); if (save && draft.trim() !== (value || "")) onChange(draft.trim()); };
  return (
    <div className="flex items-start gap-3 pt-5">
      <FileText size={16} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
      {editing ? (
        <textarea autoFocus value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} onBlur={() => done(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) done(true); if (e.key === "Escape") { e.stopPropagation(); done(false); } }}
          rows={3} aria-label="Storyboard note" className="min-w-0 flex-1 resize-y rounded-sm bg-transparent text-base outline-none ring-1 ring-input" />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={cn("line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap rounded-sm text-left text-base hover:bg-accent/60", !value && "text-muted-foreground")}>
          {value || "Add a note: the idea in a few lines"}
        </button>
      )}
      {brief && <button type="button" onClick={onOpenBrief} className="flex-shrink-0 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">The brief</button>}
    </div>
  );
}

export default function Board({ film, edit, onOpenShot, layer, setLayer, refView, setRefView, onOpenBrief }) {
  const groups = useMemo(() => numbered(film), [film]);
  // The assistant sees the scene at the top of the view (§4.6).
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  useEffect(() => {
    const el = document.getElementById("dz-film-scroll");
    if (!el) return undefined;
    let raf = 0;
    let last = "";
    const look = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top + 64;
      const gs = groupsRef.current;
      const i = gs.findIndex(({ scene }) => (document.getElementById(`dz-scene-${scene.id}`)?.getBoundingClientRect().bottom || 0) > top);
      const g = gs.length > 1 && i >= 0 ? gs[i] : null;
      const key = g ? `${g.scene.id}:${g.scene.name}:${g.shots.length}` : "";
      if (key === last) return;
      last = key;
      setSceneSelection(g ? { n: i + 1, name: g.scene.name, shots: g.shots.length } : null);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(look); };
    el.addEventListener("scroll", on, { passive: true });
    look();
    return () => { el.removeEventListener("scroll", on); if (raf) cancelAnimationFrame(raf); setSceneSelection(null); };
  }, [groups]);
  const totalShots = film.shots.length;
  const [picker, setPicker] = useState(null); // { shot } | { scene } — the reference picker
  const [pickerHere, setPickerHere] = useState(null); // that shot's generations, for the picker's This shot tab (package 09, P5)
  const [busy, setBusy] = useState(0);
  const [pasting, setPasting] = useState(false);
  const fileFor = useRef(null); // { scene } — files for new shots
  const fileInput = useRef(null);
  const box = useRef(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));

  // ── Edits ──
  const setShot = (id, fn) => edit((f) => ({ ...f, shots: f.shots.map((s) => (s.id === id ? fn(s) : s)) }));
  const setScene = (id, fn) => edit((f) => ({ ...f, scenes: f.scenes.map((s) => (s.id === id ? fn(s) : s)) }));
  // A new scene comes with one empty shot (S7).
  const addScene = () => edit((f) => { const id = newSceneId(); return { ...f, scenes: [...f.scenes, { id, name: "", note: "" }], shots: [...f.shots, { id: newShotId(), scene: id, note: "", refs: [] }] }; });
  // New shots at the end of a scene (one per picture), in film order.
  const addShots = (sceneId, refsList) => edit((f) => {
    let scenes = f.scenes;
    let sid = sceneId;
    if (!sid) { sid = newSceneId(); scenes = [...scenes, { id: sid, name: "", note: "" }]; }
    const made = refsList.map((refs) => ({ id: newShotId(), scene: sid, note: "", refs }));
    const lastIdx = f.shots.map((s) => s.scene).lastIndexOf(sid);
    const shots = lastIdx < 0 ? [...f.shots, ...made] : [...f.shots.slice(0, lastIdx + 1), ...made, ...f.shots.slice(lastIdx + 1)];
    return { ...f, scenes, shots };
  });
  const moveRef = (d, toShot, before) => edit((f) => {
    const from = f.shots.find((s) => s.id === d.shot);
    const ref = from?.refs.find((r) => r.url === d.url);
    if (!ref) return f;
    let shots = f.shots.map((s) => (s.id === d.shot ? { ...s, refs: s.refs.filter((r) => r.url !== d.url) } : s));
    shots = shots.map((s) => {
      if (s.id !== toShot) return s;
      const list = s.refs.filter((r) => r.url !== d.url);
      const at = before == null ? list.length : Math.min(before - (d.shot === toShot && s.refs.findIndex((r) => r.url === d.url) < before ? 1 : 0), list.length);
      return { ...s, refs: [...list.slice(0, at), ref, ...list.slice(at)] };
    });
    return { ...f, shots };
  });
  const refToNewShot = (d, sceneId) => edit((f) => {
    const from = f.shots.find((s) => s.id === d.shot);
    const ref = from?.refs.find((r) => r.url === d.url);
    if (!ref) return f;
    const shots = f.shots.map((s) => (s.id === d.shot ? { ...s, refs: s.refs.filter((r) => r.url !== d.url) } : s));
    const lastIdx = shots.map((s) => s.scene).lastIndexOf(sceneId);
    const made = { id: newShotId(), scene: sceneId, note: "", refs: [ref] };
    return { ...f, shots: lastIdx < 0 ? [...shots, made] : [...shots.slice(0, lastIdx + 1), made, ...shots.slice(lastIdx + 1)] };
  });
  const withUpload = async (files, then) => {
    setBusy((n) => n + files.length);
    try { then(await uploadAll(files)); } catch (e) { notify({ type: "error", title: "Upload", message: String(e?.message || e) }); } finally { setBusy((n) => Math.max(0, n - files.length)); }
  };
  // Dropped anywhere on an empty Storyboard: scene 1 with one shot per picture.
  const dropFirst = (files) => withUpload(files, (refs) => {
    if (!refs.length) return;
    const sid = newSceneId();
    edit((f) => ({ ...f, scenes: [...f.scenes, { id: sid, name: "", note: "" }], shots: [...f.shots, ...refs.map((r) => ({ id: newShotId(), scene: sid, note: "", refs: [r] }))] }));
  });
  const deleteScene = (sc) => {
    const n = film.shots.filter((s) => s.scene === sc.id).length;
    if (n && !window.confirm(`Delete this scene and its ${n} shot${n === 1 ? "" : "s"}? What was generated stays in your library.`)) return;
    edit((f) => ({ ...f, scenes: f.scenes.filter((s) => s.id !== sc.id), shots: f.shots.filter((s) => s.scene !== sc.id) }));
  };
  const moveScene = (sc, dir) => edit((f) => {
    const i = f.scenes.findIndex((s) => s.id === sc.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= f.scenes.length) return f;
    const scenes = [...f.scenes];
    [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
    return { ...f, scenes };
  });
  const deleteShot = (shot) => {
    const st = shotState(film, shot);
    if ((st.variants || (shot.refs || []).length) && !window.confirm(`Delete shot ${shot.n}? What was generated for it stays in your library.`)) return;
    edit((f) => ({ ...f, shots: f.shots.filter((s) => s.id !== shot.id) }));
  };
  const pasteScript = (text) => {
    const parsed = splitScript(text);
    if (!parsed.length) return;
    edit((f) => {
      const scenes = [...f.scenes];
      const shots = [...f.shots];
      for (const sc of parsed) {
        const id = newSceneId();
        scenes.push({ id, name: sc.name.slice(0, 80), note: sc.note });
        for (const note of sc.shots) shots.push({ id: newShotId(), scene: id, note, refs: [] });
      }
      return { ...f, scenes, shots };
    });
    setPasting(false);
  };

  const approvedIn = (shots) => shots.filter((s) => shotState(film, s).approved.length).length;

  const empty = !film.scenes.length;
  const lastScene = film.scenes[film.scenes.length - 1];

  // Files dropped from the computer (package 06, A2, the shared overlay): on a shot — added to
  // its references; on a scene outside its shots — a new shot holding them; with no scenes —
  // scene 1, one shot per file; elsewhere — a new shot at the end of the last scene.
  const dropFiles = (files, pt) => {
    const shotEl = dzDropHit(pt, "[data-dz-shot]");
    const sceneEl = dzDropHit(pt, "[data-dz-scene]");
    if (!film.scenes.length) { dropFirst(files); return; }
    const shotId = shotEl?.getAttribute("data-dz-shot");
    if (shotId) { withUpload(files, (refs) => setShot(shotId, (s) => ({ ...s, refs: [...(s.refs || []), ...refs.filter((r) => !(s.refs || []).some((x) => x.url === r.url))] }))); return; }
    const sceneId = sceneEl?.getAttribute("data-dz-scene") || lastScene?.id;
    withUpload(files, (refs) => { if (refs.length) addShots(sceneId, [refs]); });
  };
  const dropRef = useRef(dropFiles);
  dropRef.current = dropFiles;
  useDzDropTarget({ el: box, title: "Drop files here", line: "Drop on a shot to add references", onDrop: (files, pt) => dropRef.current(files, pt) });
  const addShotTo = (sceneId) => addShots(sceneId, [[]]);

  return (
    <div ref={box} className="relative pb-24">
      <input ref={fileInput} type="file" multiple accept="image/*,video/*" className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = "";
          const t = fileFor.current;
          fileFor.current = null;
          if (!files.length) return;
          if (t?.first) dropFirst(files);
          else if (t?.scene) withUpload(files, (refs) => addShots(t.scene, refs.map((r) => [r])));
        }} />

      {/* S5: References | Generated as the composer's segmented switch; on References, the view as two icons. */}
      <div className="sticky top-0 z-[5] -mx-6 flex h-14 items-center gap-4 bg-background px-6">
        <SegSwitch value={layer} onChange={setLayer} aria-label="Layer" options={[["references", "References"], ["generated", "Generated"]]} />
        {busy > 0 && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><SpinIcon size={14} className="animate-spin" /> Uploading {busy}…</span>}
        {layer === "references" && !empty && (
          <div className="ml-auto flex h-8 items-center rounded-md border border-border p-0.5" role="group" aria-label="View">
            {[["all", Rows, "All pictures"], ["one", SquaresFour, "One per shot"]].map(([v, Icon, label]) => (
              <Tip key={v} text={label} side="bottom">
                <button type="button" aria-label={label} aria-pressed={refView === v} onClick={() => setRefView(v)}
                  className={cn("flex h-7 w-8 items-center justify-center rounded-[6px] transition-colors duration-state", refView === v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}><Icon size={15} /></button>
              </Tip>
            ))}
          </div>
        )}
      </div>

      {(film.note || film.scene || !empty) && <FilmNote value={film.note} onChange={(v) => edit((f) => ({ ...f, note: v }))} brief={Boolean(film.scene)} onOpenBrief={onOpenBrief} />}

      {empty ? (
        <EmptyState icon={FilmSlate} title="No scenes yet" text="Add a scene and put pictures into its shots. Or send a group from the Moodboard, or paste a script.">
          <button type="button" onClick={addScene} className="flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-base font-medium text-primary-foreground hover:bg-primary-hover"><Plus size={14} /> Add a scene</button>
          <button type="button" onClick={() => setPasting(true)} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><TextAlignLeft size={14} /> Paste a script</button>
        </EmptyState>
      ) : groups.map(({ scene, shots }, si) => (
        <section key={scene.id} id={`dz-scene-${scene.id}`} data-dz-scene={scene.id} className="scroll-mt-16 pt-6"
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) e.preventDefault(); }}
          onDrop={(e) => { const raw = e.dataTransfer.getData(DRAG); if (raw) { e.preventDefault(); refToNewShot(JSON.parse(raw), scene.id); } }}>
          <div className="group/h mb-3 flex items-baseline gap-2">
            <h2 className="flex-shrink-0 text-[18px] font-semibold leading-6">Scene {si + 1} ·</h2>
            <InlineText value={scene.name} onChange={(v) => setScene(scene.id, (s) => ({ ...s, name: v }))} placeholder="Untitled" className="flex-shrink-0 text-[18px] font-semibold leading-6" maxLength={80} />
            <InlineText value={scene.note} onChange={(v) => setScene(scene.id, (s) => ({ ...s, note: v }))} placeholder="Click to add a note" className="min-w-0 flex-1 text-base text-muted-foreground" maxLength={300} />
            {layer === "generated" && shots.length > 0 && <span className="flex-shrink-0 text-base text-muted-foreground">{approvedIn(shots)} of {shots.length} shots approved</span>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label="Scene menu" className="flex h-7 w-7 flex-shrink-0 items-center justify-center self-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><DotsThree size={16} weight="bold" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => addShotTo(scene.id)}>Add a shot</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { fileFor.current = { scene: scene.id }; fileInput.current?.click(); }}>Add shots from pictures…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={si === 0} onSelect={() => moveScene(scene, -1)}>Move up</DropdownMenuItem>
                <DropdownMenuItem disabled={si === groups.length - 1} onSelect={() => moveScene(scene, 1)}>Move down</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => deleteScene(scene)}>Delete scene</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {layer === "references" && refView === "all" && (
            <div className="flex flex-wrap items-start gap-3">
              {shots.map((shot) => (
                <ShotFrame key={shot.id} shot={shot} width={width}
                  onNote={(v) => setShot(shot.id, (s) => ({ ...s, note: v }))}
                  onAdd={() => setPicker({ shot: shot.id })}
                  onOpen={() => onOpenShot(shot.id)}
                  onDelete={() => deleteShot(shot)}
                  onRemoveRef={(url) => setShot(shot.id, (s) => ({ ...s, refs: s.refs.filter((r) => r.url !== url) }))}
                  onMoveRef={(d, before) => moveRef(d, shot.id, before)} />
              ))}
            </div>
          )}

          {layer === "references" && refView === "one" && (
            <div className="grid grid-cols-3 gap-3">
              {shots.map((shot) => (
                <div key={shot.id} data-dz-shot={shot.id} className="text-left">
                  {(shot.refs || []).length ? (
                    <button type="button" onClick={() => { setRefView("all"); requestAnimationFrame(() => document.getElementById(`dz-scene-${scene.id}`)?.scrollIntoView({ block: "start" })); }} className="relative block w-full">
                      <Thumb16 url={shot.refs[0].url} />
                      <Badge className="absolute left-2.5 top-2.5">{shot.refs.length} reference{shot.refs.length === 1 ? "" : "s"}</Badge>
                    </button>
                  ) : (
                    <button type="button" onClick={() => setPicker({ shot: shot.id })} className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input text-base text-muted-foreground transition-colors duration-state hover:bg-accent/40 hover:text-foreground">
                      <Plus size={16} /> Add references
                    </button>
                  )}
                  <p className="mt-2 truncate text-base"><b className="font-semibold">Shot {shot.n}</b> <span className="text-muted-foreground">{shot.note}</span></p>
                </div>
              ))}
            </div>
          )}

          {layer === "generated" && (
            <div className="grid grid-cols-3 gap-3">
              {shots.map((shot) => {
                const st = shotState(film, shot);
                const cover = st.cover || (!st.approved.length && st.latest) || null;
                return (
                  <div key={shot.id} data-dz-shot={shot.id} className="group text-left">
                    <div className="relative">
                      <button type="button" onClick={() => onOpenShot(shot.id)} className="block w-full" aria-label={`Open shot ${shot.n}`}>
                        <Thumb16 url={cover || (shot.refs || [])[0]?.url} dim={!cover} />
                      </button>
                      {st.approved.length > 0 && <span className="pointer-events-none absolute left-2.5 top-2.5"><ApprovedBadge n={st.approved.length} /></span>}
                      {st.variants > 0 && (
                        <Badge className="pointer-events-none absolute right-2.5 top-2.5">{st.variants} variant{st.variants === 1 ? "" : "s"}{st.approved.length ? "" : " · none approved"}</Badge>
                      )}
                      {st.upscaled && <Badge className="pointer-events-none absolute bottom-2.5 right-2.5">2x</Badge>}
                      {st.takes > 0 && <Badge className="pointer-events-none absolute bottom-2.5 left-2.5"><Play size={10} weight="fill" />{st.takes} take{st.takes === 1 ? "" : "s"}</Badge>}
                      {st.running > 0 && <Badge className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2"><SpinIcon size={12} className="animate-spin" /> {st.running} running</Badge>}
                      {!st.variants && (
                        <button type="button" onClick={() => onOpenShot(shot.id)}
                          className="absolute left-1/2 top-1/2 flex h-8 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md bg-primary px-3 text-base font-medium text-primary-foreground shadow-float hover:bg-primary-hover"><Sparkle size={14} /> Generate</button>
                      )}
                    </div>
                    <p className="mt-2 truncate text-base"><b className="font-semibold">Shot {shot.n}</b> <span className="text-muted-foreground">{shot.note}</span></p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}

      {/* S7: under the last scene. */}
      {!empty && (
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={() => addShotTo(lastScene.id)} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><Plus size={14} /> Add a shot</button>
          <button type="button" onClick={addScene} className="flex h-8 items-center gap-2 rounded-md px-3 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground"><Plus size={14} /> Add a scene</button>
        </div>
      )}

      {/* The reference picker: the existing library window. For a shot: its references; for a scene: new shots. */}
      {picker?.shot && <ShotHere film={film} shotId={picker.shot} onHere={setPickerHere} />}
      <RefPicker open={Boolean(picker)} onClose={() => setPicker(null)} here={picker?.shot ? pickerHere : null}
        title={picker?.shot ? `References for Shot ${groups.flatMap((g) => g.shots).find((s) => s.id === picker.shot)?.n ?? ""}` : "Pictures for new shots"}
        refs={picker?.shot ? (film.shots.find((s) => s.id === picker.shot)?.refs || []) : []}
        onChange={(refs) => {
          if (picker?.shot) setShot(picker.shot, (s) => ({ ...s, refs: typeof refs === "function" ? refs(s.refs) : refs }));
        }}
        onPickNew={picker?.scene ? (refs) => addShots(picker.scene, refs.map((r) => [r])) : null} />

      {pasting && <PasteScript onClose={() => setPasting(false)} onDone={pasteScript} />}
    </div>
  );
}

function PasteScript({ onClose, onDone }) {
  const [text, setText] = useState("");
  const parsed = splitScript(text);
  const shots = parsed.reduce((n, s) => n + s.shots.length, 0);
  return (
    <div ref={dzScrollBoxRef} className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" onClick={onClose}>
      <div className="w-[min(720px,100%)] rounded-2xl border border-border bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Paste a script">
        <p className="text-lg font-semibold">Paste a script</p>
        <p className="mt-1 text-sm text-muted-foreground">Headings (INT. / EXT., “Scene …”, lines in capitals) start scenes; every other paragraph becomes a shot with that text as its note. Everything stays editable.</p>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} className="mt-3 h-72 w-full resize-none rounded-md border border-input bg-background p-3 text-base outline-none focus:border-input" placeholder={"EXT. EVENING STREET\n\nWide. Empty street, the sun is low.\n\nMike from behind, walking home."} />
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{parsed.length ? `${parsed.length} scene${parsed.length === 1 ? "" : "s"} · ${shots} shot${shots === 1 ? "" : "s"}` : ""}</span>
          <button type="button" onClick={onClose} className="ml-auto h-8 rounded-md px-3 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Cancel</button>
          <button type="button" disabled={!parsed.length} onClick={() => onDone(text)} className="h-8 rounded-md bg-primary px-4 text-base font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40">Add</button>
        </div>
      </div>
    </div>
  );
}

// The picker opened for a shot on the Storyboard tab gets its This shot tab (package 09, P5):
// the shot's generations from the storyboard, its liked ones from the library.
function ShotHere({ film, shotId, onHere }) {
  const liked = useDzHistory({ target: `${film.id}:${shotId}`, project: film.project_id || "none", liked: true }, { limit: 60 });
  const here = pickerHereOf(film, { id: shotId, kind: "shot" }, liked.items);
  const key = JSON.stringify(here);
  useEffect(() => { onHere(JSON.parse(key)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onHere(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
