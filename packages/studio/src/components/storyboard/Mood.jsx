"use client";

// Moodboard (package 05, §4.3): a free canvas — pictures and videos, frames with a
// typed name (a frame is a group because the user drew it), sticky notes, arrows, text.
// Own code (no canvas library): DOM elements in one transformed layer; see the report.
// Pan: hand tool, Space+drag, middle button or two-finger scroll. Zoom: Ctrl/⌘+wheel, pinch, the buttons.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cursor, Hand, Square, NoteBlank, ArrowUpRight, TextT, ImageSquare, Minus, Plus, CornersOut, UploadSimple, Clipboard, Images, Sparkle, DotsThree, Play } from "@phosphor-icons/react";
import { dzThumb, uploadFile } from "../../api.js";
import { DropdownMenuParts, cn } from "../../ui/index.js";
import { inFrame, newItemId, sizeOf, isVideoUrl } from "../../dzFilm.js";
import { RefPicker, EmptyState, mediaUrl } from "./parts.jsx";
import { setMoodSelection } from "./assistant.js";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } = DropdownMenuParts;
// Theme tokens only (both themes): the frame's dot and the sticky note's paper.
const COLORS = [["orange", "hsl(var(--signal))"], ["amber", "hsl(var(--warning))"], ["green", "hsl(var(--success))"], ["red", "hsl(var(--destructive))"], ["grey", "hsl(var(--muted-foreground))"]];
const colorOf = (c) => (COLORS.find(([k]) => k === c) || COLORS[0])[1];
const clampZ = (z) => Math.min(4, Math.max(0.1, z));
const PIC_H = 220;

function useLatest(v) { const r = useRef(v); r.current = v; return r; }

export default function Mood({ film, edit, onOpenGroup }) {
  const items = film.mood?.items || [];
  const host = useRef(null);
  const [view, setView] = useState(() => { try { return JSON.parse(sessionStorage.getItem(`dz_mood_view_${film.id}`)) || { x: 40, y: 40, z: 1 }; } catch { return { x: 40, y: 40, z: 1 }; } });
  useEffect(() => { try { sessionStorage.setItem(`dz_mood_view_${film.id}`, JSON.stringify(view)); } catch { /* optional */ } }, [film.id, view]);
  const [tool, setTool] = useState("select");
  const [sel, setSel] = useState([]); // ids
  const [live, setLive] = useState(null); // { id → partial } while dragging (not saved yet)
  const [marquee, setMarquee] = useState(null);
  const [draft, setDraft] = useState(null); // a frame / arrow being drawn
  const [editing, setEditing] = useState(null); // id of a note / text / frame name in edit
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(0);
  const [space, setSpace] = useState(false);
  const viewRef = useLatest(view);
  const itemsRef = useLatest(items);
  useEffect(() => { setMoodSelection(sel.length); }, [sel.length]);
  const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));

  const shown = useMemo(() => items.map((it) => (live?.[it.id] ? { ...it, ...live[it.id] } : it)), [items, live]);
  const frames = shown.filter((x) => x.type === "frame");
  const others = shown.filter((x) => x.type !== "frame").sort((a, b) => (a.z || 0) - (b.z || 0));
  const media = shown.filter((x) => x.type === "image" || x.type === "video");
  const empty = !items.length;

  // ── Coordinates ──
  const toWorld = useCallback((cx, cy) => {
    const r = host.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  }, [viewRef]);
  const center = () => {
    const r = host.current?.getBoundingClientRect();
    return r ? toWorld(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 };
  };
  const zoomAt = (factor, cx, cy) => setView((v) => {
    const z = clampZ(v.z * factor);
    const r = host.current.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z };
  });
  const fit = () => {
    const r = host.current?.getBoundingClientRect();
    if (!r || !items.length) { setView({ x: 40, y: 40, z: 1 }); return; }
    const minX = Math.min(...items.map((i) => Math.min(i.x, i.type === "arrow" ? i.x2 : i.x)));
    const minY = Math.min(...items.map((i) => Math.min(i.y, i.type === "arrow" ? i.y2 : i.y)));
    const maxX = Math.max(...items.map((i) => (i.type === "arrow" ? Math.max(i.x, i.x2) : i.x + i.w)));
    const maxY = Math.max(...items.map((i) => (i.type === "arrow" ? Math.max(i.y, i.y2) : i.y + i.h)));
    const z = clampZ(Math.min((r.width - 80) / Math.max(1, maxX - minX), (r.height - 140) / Math.max(1, maxY - minY), 1.5));
    setView({ z, x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: Math.max(30, (r.height - 90 - (maxY - minY) * z) / 2) - minY * z });
  };

  // Wheel: Ctrl/⌘ (and pinch) zoom; otherwise pan.
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const on = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Saving ──
  const commit = (fn) => edit((f) => ({ ...f, mood: { ...(f.mood || {}), items: fn(f.mood?.items || []) } }));
  const maxZ = () => Math.max(0, ...items.map((i) => i.z || 0));
  const addItems = (list) => commit((cur) => [...cur, ...list]);

  // Files → pictures at a point (in rows), each at its own aspect ratio.
  const place = (refs, at) => {
    const out = [];
    let x = at.x;
    let y = at.y;
    let row = 0;
    let z = maxZ();
    for (const r of refs) {
      const w = r.w && r.h ? Math.round((PIC_H * r.w) / r.h) : 300;
      if (row >= 4) { x = at.x; y += PIC_H + 16; row = 0; }
      out.push({ id: newItemId(r.kind === "video" ? "video" : "image"), type: r.kind === "video" ? "video" : "image", url: r.url, x, y, w, h: PIC_H, z: (z += 1) });
      x += w + 16;
      row += 1;
    }
    return out;
  };
  const uploadAt = async (files, at) => {
    const list = [...files].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!list.length) return;
    setBusy((n) => n + list.length);
    const refs = [];
    for (const f of list) {
      try {
        const url = mediaUrl(await uploadFile("session", f));
        const kind = f.type.startsWith("video/") ? "video" : "image";
        refs.push({ url, kind, ...(await sizeOf(url, kind)) });
      } catch (e) { notify({ type: "error", title: "Upload", message: String(e?.message || e) }); }
      setBusy((n) => Math.max(0, n - 1));
    }
    if (refs.length) addItems(place(refs, at));
  };
  const fileInput = useRef(null);
  const pasteFrom = async () => {
    try {
      const clip = await navigator.clipboard.read();
      const files = [];
      for (const c of clip) for (const t of c.types) if (t.startsWith("image/")) files.push(new File([await c.getType(t)], `pasted.${t.split("/")[1]}`, { type: t }));
      if (files.length) uploadAt(files, center());
      else notify({ type: "notice", title: "Paste", message: "No picture on the clipboard. Copy one, or press ⌘V / Ctrl+V on the canvas." });
    } catch { notify({ type: "notice", title: "Paste", message: "Press ⌘V / Ctrl+V on the canvas to paste a picture." }); }
  };
  useEffect(() => {
    const on = (e) => {
      if (e.target.closest?.("input,textarea,[contenteditable=true]")) return;
      // Only while the Moodboard is on screen (the Storyboard tab stays mounted behind others).
      if (!host.current || host.current.offsetParent === null || !host.current.getClientRects().length) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); uploadAt(files, center()); }
    };
    window.addEventListener("paste", on);
    return () => window.removeEventListener("paste", on);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys: Delete removes the selection; Space pans; Esc clears.
  useEffect(() => {
    const down = (e) => {
      if (e.target.closest?.("input,textarea,[contenteditable=true]")) return;
      if (e.key === " " && !space) { setSpace(true); e.preventDefault(); }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) { e.preventDefault(); removeSel(false); }
      if (e.key === "Escape") { setSel([]); setTool("select"); }
      if (e.key === "v") setTool("select");
      if (e.key === "h") setTool("hand");
      if (e.key === "f") setTool("frame");
      if (e.key === "n") setTool("note");
      if (e.key === "a") setTool("arrow");
      if (e.key === "t") setTool("text");
    };
    const up = (e) => { if (e.key === " ") setSpace(false); };
    const el = host.current;
    el?.addEventListener("keydown", down);
    el?.addEventListener("keyup", up);
    return () => { el?.removeEventListener("keydown", down); el?.removeEventListener("keyup", up); };
  });
  const removeSel = (withPictures) => {
    const ids = new Set(sel);
    const cur = itemsRef.current;
    if (withPictures) for (const f of cur.filter((x) => ids.has(x.id) && x.type === "frame")) cur.filter((x) => x.type !== "frame" && x.type !== "arrow" && inFrame(f, x)).forEach((x) => ids.add(x.id));
    const frameN = cur.filter((x) => ids.has(x.id) && x.type === "frame").length;
    if (frameN && !withPictures && !window.confirm(`Delete ${frameN === 1 ? "this group" : `${frameN} groups`}? The pictures stay on the Moodboard; what was generated stays in your library.`)) return;
    commit((list) => list.filter((x) => !ids.has(x.id)));
    setSel([]);
  };

  // ── Pointer: select / move / resize / draw / pan ──
  const drag = useRef(null);
  const onDown = (e) => {
    if (editing) return;
    host.current?.focus({ preventScroll: true });
    const hand = tool === "hand" || space || e.button === 1;
    if (hand) { drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, v: view }; e.currentTarget.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    const p = toWorld(e.clientX, e.clientY);
    if (tool === "frame" || tool === "arrow") { drag.current = { kind: tool, p }; setDraft({ type: tool, x: p.x, y: p.y, x2: p.x, y2: p.y }); e.currentTarget.setPointerCapture(e.pointerId); return; }
    if (tool === "note" || tool === "text") {
      const it = tool === "note"
        ? { id: newItemId("note"), type: "note", x: p.x - 90, y: p.y - 60, w: 180, h: 120, text: "", color: "amber", z: maxZ() + 1 }
        : { id: newItemId("text"), type: "text", x: p.x, y: p.y - 14, w: 260, h: 36, text: "", z: maxZ() + 1 };
      addItems([it]);
      setSel([it.id]);
      setEditing(it.id);
      setTool("select");
      return;
    }
    // Empty canvas with the select tool: a marquee.
    if (!e.shiftKey) setSel([]);
    drag.current = { kind: "marquee", p, add: e.shiftKey ? sel : [] };
    setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const startMove = (e, it) => {
    if (tool !== "select" || space || e.button !== 0 || editing === it.id) return;
    e.stopPropagation();
    host.current?.focus({ preventScroll: true });
    const ids = sel.includes(it.id) ? sel : e.shiftKey ? [...sel, it.id] : [it.id];
    if (!sel.includes(it.id)) setSel(ids);
    // A frame takes what is inside it.
    const moving = new Set(ids);
    for (const f of items.filter((x) => moving.has(x.id) && x.type === "frame")) items.filter((x) => x.type !== "frame" && (x.type === "arrow" ? inFrame(f, { x: x.x, y: x.y, w: 0, h: 0 }) : inFrame(f, x))).forEach((x) => moving.add(x.id));
    drag.current = { kind: "move", p: toWorld(e.clientX, e.clientY), ids: [...moving], start: Object.fromEntries(items.filter((x) => moving.has(x.id)).map((x) => [x.id, { x: x.x, y: x.y, x2: x.x2, y2: x.y2 }])), moved: false };
    host.current.setPointerCapture(e.pointerId);
  };
  const startResize = (e, it) => {
    e.stopPropagation();
    drag.current = { kind: "resize", id: it.id, p: toWorld(e.clientX, e.clientY), w: it.w, h: it.h, ratio: it.type === "image" || it.type === "video" ? it.w / it.h : null };
    host.current.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") { setView({ ...d.v, x: d.v.x + e.clientX - d.sx, y: d.v.y + e.clientY - d.sy }); return; }
    const p = toWorld(e.clientX, e.clientY);
    if (d.kind === "marquee") {
      const m = { x: Math.min(d.p.x, p.x), y: Math.min(d.p.y, p.y), w: Math.abs(p.x - d.p.x), h: Math.abs(p.y - d.p.y) };
      setMarquee(m);
      const hit = items.filter((x) => (x.type === "arrow" ? false : x.x < m.x + m.w && x.x + x.w > m.x && x.y < m.y + m.h && x.y + x.h > m.y)).map((x) => x.id);
      setSel([...new Set([...d.add, ...hit])]);
      return;
    }
    if (d.kind === "frame" || d.kind === "arrow") { setDraft((r) => ({ ...r, x2: p.x, y2: p.y })); return; }
    if (d.kind === "move") {
      const dx = p.x - d.p.x;
      const dy = p.y - d.p.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      setLive(Object.fromEntries(d.ids.map((id) => { const s = d.start[id]; return [id, { x: s.x + dx, y: s.y + dy, ...(s.x2 != null ? { x2: s.x2 + dx, y2: s.y2 + dy } : {}) }]; })));
      return;
    }
    if (d.kind === "resize") {
      let w = Math.max(40, d.w + (p.x - d.p.x));
      let h = Math.max(30, d.h + (p.y - d.p.y));
      if (d.ratio) h = w / d.ratio;
      setLive({ [d.id]: { w, h } });
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "marquee") { setMarquee(null); return; }
    if (d.kind === "frame") {
      const r = draft;
      setDraft(null);
      setTool("select");
      const x = Math.min(r.x, r.x2); const y = Math.min(r.y, r.y2); const w = Math.abs(r.x2 - r.x); const h = Math.abs(r.y2 - r.y);
      if (w < 30 || h < 30) return;
      const n = items.filter((i) => i.type === "frame").length;
      const it = { id: newItemId("frame"), type: "frame", x, y, w, h, name: `Group ${n + 1}`, color: COLORS[n % COLORS.length][0] };
      addItems([it]);
      setSel([it.id]);
      setEditing(it.id);
      return;
    }
    if (d.kind === "arrow") {
      const r = draft;
      setDraft(null);
      setTool("select");
      if (Math.hypot(r.x2 - r.x, r.y2 - r.y) < 12) return;
      addItems([{ id: newItemId("arrow"), type: "arrow", x: r.x, y: r.y, x2: r.x2, y2: r.y2, w: 0, h: 0, z: maxZ() + 1 }]);
      return;
    }
    if (live) {
      const changes = live;
      setLive(null);
      if (d.kind === "resize" || d.moved) commit((list) => list.map((x) => (changes[x.id] ? { ...x, ...changes[x.id] } : x)));
    }
  };

  // Files dropped from the computer: where they land (inside a frame = in that group).
  const [over, setOver] = useState(false);
  const selFrame = sel.length === 1 ? frames.find((f) => f.id === sel[0]) : null;
  const countIn = (f) => media.filter((x) => inFrame(f, x)).length;
  const setItem = (id, patch) => commit((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const cursor = tool === "hand" || space ? (drag.current?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";

  return (
    <div className="relative h-full w-full overflow-hidden">
      <input ref={fileInput} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) uploadAt(f, center()); }} />
      <div ref={host} tabIndex={0} aria-label="Moodboard canvas" className={cn("absolute inset-0 overflow-hidden outline-none", over && "bg-accent/30")}
        style={{ cursor, backgroundImage: "radial-gradient(hsl(var(--border)) 1px, transparent 1px)", backgroundSize: `${22 * view.z}px ${22 * view.z}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={(e) => { setOver(false); if (e.dataTransfer.files?.length) { e.preventDefault(); uploadAt([...e.dataTransfer.files], toWorld(e.clientX, e.clientY)); } }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {frames.map((f) => (
            <div key={f.id} className={cn("absolute rounded-[14px] border", sel.includes(f.id) ? "border-signal" : "border-input")} style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
              onPointerDown={(e) => startMove(e, f)} onDoubleClick={(e) => { e.stopPropagation(); setEditing(f.id); }}>
              <div className="absolute bottom-full left-0 mb-2 flex items-center gap-2 whitespace-nowrap" style={{ transform: `scale(${1 / view.z})`, transformOrigin: "bottom left" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(f.color) }} />
                {editing === f.id ? (
                  <input autoFocus defaultValue={f.name} maxLength={60} onFocus={(e) => e.target.select()} onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => { setEditing(null); if (e.target.value.trim()) setItem(f.id, { name: e.target.value.trim() }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = f.name; e.currentTarget.blur(); } }}
                    className="w-48 rounded-sm bg-background px-1 text-base font-semibold outline-none ring-1 ring-ring" />
                ) : <span className="text-base font-semibold">{f.name || "Group"}</span>}
                <span className="text-base text-muted-foreground">{countIn(f)}</span>
              </div>
              {sel.includes(f.id) && <Handle onPointerDown={(e) => startResize(e, f)} z={view.z} />}
            </div>
          ))}
          {others.map((it) => <Item key={it.id} it={it} selected={sel.includes(it.id)} z={view.z} editing={editing === it.id}
            onDown={(e) => startMove(e, it)} onResize={(e) => startResize(e, it)} onEdit={() => setEditing(it.id)} onEndEdit={(text) => { setEditing(null); if (text != null) { if (!text.trim() && it.type === "text") commit((l) => l.filter((x) => x.id !== it.id)); else setItem(it.id, { text }); } }} />)}
          {draft?.type === "frame" && <div className="absolute rounded-[14px] border border-dashed border-signal" style={{ left: Math.min(draft.x, draft.x2), top: Math.min(draft.y, draft.y2), width: Math.abs(draft.x2 - draft.x), height: Math.abs(draft.y2 - draft.y) }} />}
          {draft?.type === "arrow" && <Arrow it={draft} z={view.z} />}
          {marquee && <div className="absolute border border-signal bg-signal/10" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
          {/* A selected frame: a small bar under it (Generate from this group, Rename, menu). */}
          {selFrame && !drag.current && (
            <div className="absolute flex items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-popover p-1 shadow-popover" style={{ left: selFrame.x, top: selFrame.y + selFrame.h + 8, transform: `scale(${1 / view.z})`, transformOrigin: "top left" }} onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => onOpenGroup(selFrame.id)} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"><Sparkle size={14} /> Generate from this group</button>
              <button type="button" onClick={() => setEditing(selFrame.id)} className="h-8 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Rename</button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" aria-label="Group menu" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><DotsThree size={16} weight="bold" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <div className="flex gap-1.5 px-2 py-1.5">{COLORS.map(([k, c]) => <button key={k} type="button" aria-label={k} onClick={() => setItem(selFrame.id, { color: k })} className={cn("h-5 w-5 rounded-full", selFrame.color === k && "ring-2 ring-foreground ring-offset-2 ring-offset-popover")} style={{ background: c }} />)}</div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => removeSel(false)}>Delete the group (keep pictures)</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { if (window.confirm("Delete the group and its pictures from the Moodboard? What was generated stays in your library.")) removeSel(true); }}>Delete with its pictures</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-16">
          <div className="pointer-events-auto">
            <EmptyState icon={ImageSquare} title="Drop pictures anywhere" text="This is your canvas. Bring references from your computer or paste them, then move them around, frame groups and draw arrows.">
              <button type="button" onClick={() => fileInput.current?.click()} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><UploadSimple size={14} /> Upload pictures</button>
              <button type="button" onClick={pasteFrom} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><Clipboard size={14} /> Paste from clipboard</button>
              <button type="button" onClick={() => setPicker(true)} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><Images size={14} /> Pick from my library</button>
            </EmptyState>
          </div>
        </div>
      )}
      {busy > 0 && <span className="absolute left-4 top-4 rounded-full bg-popover px-3 py-1 text-sm text-muted-foreground shadow-popover">Uploading {busy}…</span>}

      {/* Toolbar, bottom centre */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-float" role="toolbar" aria-label="Canvas tools">
        {[["select", Cursor, "Select (V)"], ["hand", Hand, "Pan (H, or hold Space)"]].map(([k, Icon, label]) => <Tool key={k} on={tool === k} label={label} onClick={() => setTool(k)}><Icon size={17} /></Tool>)}
        <span className="mx-1 h-5 w-px bg-border" />
        {[["frame", Square, "Frame — a group (F)"], ["note", NoteBlank, "Sticky note (N)"], ["arrow", ArrowUpRight, "Arrow (A)"], ["text", TextT, "Text (T)"]].map(([k, Icon, label]) => <Tool key={k} on={tool === k} label={label} onClick={() => setTool(k)}><Icon size={17} /></Tool>)}
        <span className="mx-1 h-5 w-px bg-border" />
        <Tool label="Pictures: uploads and library" onClick={() => setPicker(true)}><ImageSquare size={17} /></Tool>
      </div>
      {/* Zoom, bottom right */}
      <div className="absolute bottom-6 right-6 flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-float">
        <Tool label="Zoom out" onClick={() => zoomAt(1 / 1.2)}><Minus size={15} /></Tool>
        <button type="button" onClick={() => setView((v) => ({ ...v, z: 1 }))} className="h-8 w-14 rounded-md text-sm tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground">{Math.round(view.z * 100)}%</button>
        <Tool label="Zoom in" onClick={() => zoomAt(1.2)}><Plus size={15} /></Tool>
        <Tool label="Fit everything" onClick={fit}><CornersOut size={15} /></Tool>
      </div>

      <RefPicker open={picker} onClose={() => setPicker(false)} refs={[]} onChange={() => {}} title="Pictures for the Moodboard" onPickNew={(refs) => addItems(place(refs, center()))} />
    </div>
  );
}

const Tool = ({ on, label, onClick, children }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={on}
    className={cn("flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-state", on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>{children}</button>
);

const Handle = ({ onPointerDown, z }) => (
  <span onPointerDown={onPointerDown} className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-signal bg-background" style={{ transform: `scale(${1 / z})` }} />
);

function Arrow({ it, z, selected, onDown }) {
  const minX = Math.min(it.x, it.x2) - 12;
  const minY = Math.min(it.y, it.y2) - 12;
  const w = Math.abs(it.x2 - it.x) + 24;
  const h = Math.abs(it.y2 - it.y) + 24;
  const a = { x: it.x - minX, y: it.y - minY };
  const b = { x: it.x2 - minX, y: it.y2 - minY };
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const head = 12 / Math.max(0.5, z);
  const p1 = { x: b.x - head * Math.cos(ang - 0.45), y: b.y - head * Math.sin(ang - 0.45) };
  const p2 = { x: b.x - head * Math.cos(ang + 0.45), y: b.y - head * Math.sin(ang + 0.45) };
  const sw = 2 / Math.max(0.5, z);
  return (
    <svg className="absolute overflow-visible" style={{ left: minX, top: minY, width: w, height: h, pointerEvents: "none" }} aria-hidden="true">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14 / Math.max(0.5, z)} style={{ pointerEvents: onDown ? "stroke" : "none", cursor: "move" }} onPointerDown={onDown} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? "hsl(var(--signal))" : "hsl(var(--foreground))"} strokeWidth={sw} strokeLinecap="round" />
      <path d={`M ${p1.x} ${p1.y} L ${b.x} ${b.y} L ${p2.x} ${p2.y}`} fill="none" stroke={selected ? "hsl(var(--signal))" : "hsl(var(--foreground))"} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Item({ it, selected, z, editing, onDown, onResize, onEdit, onEndEdit }) {
  if (it.type === "arrow") return <Arrow it={it} z={z} selected={selected} onDown={onDown} />;
  const ring = selected ? "ring-2 ring-signal" : "";
  const style = { left: it.x, top: it.y, width: it.w, height: it.h };
  if (it.type === "image" || it.type === "video") {
    const video = it.type === "video" || isVideoUrl(it.url);
    return (
      <div className={cn("absolute overflow-visible", ring, "rounded-md")} style={style} onPointerDown={onDown}>
        <div className="h-full w-full overflow-hidden rounded-md bg-muted">
          {video ? <video src={it.url} poster={dzThumb(it.url, 640)} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
            : <img src={dzThumb(it.url, it.w * z > 400 ? 1280 : 640)} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />}
        </div>
        {video && <span className="pointer-events-none absolute bottom-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-overlay/60 text-overlay-foreground"><Play size={11} weight="fill" /></span>}
        {selected && <Handle onPointerDown={onResize} z={z} />}
      </div>
    );
  }
  const isNote = it.type === "note";
  return (
    <div className={cn("absolute", ring, isNote ? "rounded-sm p-3 shadow-popover" : "")} style={{ ...style, background: isNote ? "hsl(var(--warning))" : "transparent", color: isNote ? "hsl(var(--background))" : undefined, transform: isNote ? "rotate(-1.5deg)" : undefined }}
      onPointerDown={onDown} onDoubleClick={(e) => { e.stopPropagation(); onEdit(); }}>
      {editing ? (
        <textarea autoFocus defaultValue={it.text} onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => onEndEdit(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onEndEdit(null); } }}
          className={cn("h-full w-full resize-none bg-transparent outline-none", isNote ? "text-base leading-snug" : "text-lg font-semibold")} placeholder={isNote ? "Note…" : "Text"} />
      ) : (
        <p className={cn("h-full w-full overflow-hidden whitespace-pre-wrap break-words", isNote ? "text-base leading-snug" : "text-lg font-semibold", !it.text && "opacity-50")}>{it.text || (isNote ? "Double-click to write" : "Text")}</p>
      )}
      {selected && !editing && <Handle onPointerDown={onResize} z={z} />}
    </div>
  );
}
