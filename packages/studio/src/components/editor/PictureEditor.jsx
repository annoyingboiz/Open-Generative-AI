"use client";

// The picture editor (package 12, docs/ux/handoff/12-editor). One picture, full screen: the
// user marks it up, pastes pictures onto it and writes a short note next to each thing. The
// notes are the prompt; the composer (the shared one) generates. The base picture never
// changes: everything added is a layer above it, and the model gets the base file itself.
//
// Built on what exists: the Moodboard's canvas kit (EditorCanvas), the composer's bottom row,
// bar and panels (DzStudio: ComposerRow, ComposerBar, ComposerPanels, Thumb, EmptySlot), the
// picker window (LibraryWindow) and the reference chip (RefChip). The request (E5) and the
// prompt are pure functions in editorModel.mjs.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, ArrowCounterClockwise, ArrowClockwise, FloppyDisk, ArrowElbowDownRight, Cursor, Hand, Square, ArrowUpRight, PaintBrush, Eraser, ChatCircleDots, ImageSquare,
  Minus, Plus, CornersOut, CaretDown, Eye, EyeSlash, LockSimple, Palette, Copy, Trash, FlipHorizontal, ArrowLineUp, ArrowLineDown, ArrowsClockwise, KeyReturn, Check, ArrowsLeftRight, WarningCircle, ArrowUp,
} from "@phosphor-icons/react";
import { dzThumb, uploadFile } from "../../api.js";
import { dzContextParams } from "../../dzContext.js";
import { useDzCreateEngine } from "../DzCreateStudio.jsx";
import { useComposerParams, ComposerRow, ComposerPanels, ComposerBar, Thumb, EmptySlot } from "../DzStudio.jsx";
import { LibraryWindow, PickerHereContext } from "../studio/Library.jsx";
import { RefChip } from "../studio/PromptEditor.jsx";
import { Overline } from "../studio/ui.jsx";
import { Tool } from "../storyboard/canvasKit.jsx";
import { DialogParts, Spinner, Switch, Tip, cn } from "../../ui/index.js";
import { useDzDropTarget } from "../../dzDrop.js";
import { dzScrollBoxRef } from "../../dzScroll.js";
import { dzMediaInfo } from "../DzPosterVideo.jsx";
import EditorCanvas from "./EditorCanvas.jsx";
import { MARK_COLORS, MAX_OBJECTS, KIND_NAME, numbered, isObject, isMark, summary, requestPictures, editorPrompt, requestPrompt, composerPrompt, hasWork, workWords } from "./editorModel.mjs";
import { anchorOf, boundsOf, renderPicture, toJpeg, forgetImages } from "./editorPictures.js";

const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } = DialogParts;
const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));
// A picked picture's name is often its whole prompt: a few words are enough for a layer.
const shortName = (n) => { const t = String(n || "").replace(/\s+/g, " ").trim(); if (!t) return "Picture"; if (t.length <= 28) return t; const cut = t.slice(0, 28); return `${cut.slice(0, cut.lastIndexOf(" ") > 12 ? cut.lastIndexOf(" ") : 28)}…`; };
const newId = (p) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const HISTORY = 100;
const TOOLS = [
  ["select", Cursor, "Select (V)", "v"], ["hand", Hand, "Hand (H, or hold Space)", "h"], null,
  ["rect", Square, "Rectangle (R)", "r"], ["arrow", ArrowUpRight, "Arrow (A)", "a"], ["brush", PaintBrush, "Brush (B)", "b"], ["eraser", Eraser, "Eraser (E)", "e"], null,
  ["note", ChatCircleDots, "Note (N)", "n"], ["picture", ImageSquare, "Add a picture (P)", "p"],
];
const OBJECTS_GROUP = { id: "objects", label: "Add to the picture", roles: ["reference"], kind: "image", max: MAX_OBJECTS, roleMax: { reference: MAX_OBJECTS } };

export default function PictureEditor({ url, apiKey, target = null, place: openedAt = null, placeOf = null, onClose, onSendToComposer, approve = null, isApproved = () => false }) {
  // ── The base picture and its size ──
  const [base, setBase] = useState({ url, w: 0, h: 0 });
  useEffect(() => {
    let alive = true;
    dzMediaInfo(base.url).then((j) => {
      if (!alive) return;
      if (j?.width) { setBase((b) => (b.url === base.url ? { ...b, w: j.width, h: j.height } : b)); return; }
      const img = new window.Image();
      img.onload = () => { if (alive) setBase((b) => (b.url === base.url ? { ...b, w: img.naturalWidth, h: img.naturalHeight } : b)); };
      img.src = base.url;
    });
    return () => { alive = false; };
  }, [base.url]);

  // ── The work: items (marks and objects) and eraser strokes, with undo / redo ──
  const [doc, setDocState] = useState({ items: [], erasers: [] });
  const docRef = useRef(doc);
  docRef.current = doc;
  const undo = useRef([]);
  const redo = useRef([]);
  const [, bump] = useState(0);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const commit = useCallback((fn) => {
    const prev = docRef.current;
    const next = fn(prev);
    if (next === prev) return;
    undo.current.push(prev);
    if (undo.current.length > HISTORY) undo.current.shift();
    redo.current = [];
    docRef.current = next;
    setDocState(next);
    setDirty(true);
    bump((n) => n + 1);
  }, []);
  const pushUndo = (snap) => { undo.current.push(snap); if (undo.current.length > HISTORY) undo.current.shift(); redo.current = []; bump((n) => n + 1); };
  // Typing a note: live, without a history step per key (one step when the note is saved).
  const live = useCallback((fn) => { const next = fn(docRef.current); docRef.current = next; setDocState(next); setDirty(true); }, []);
  const items = doc.items;
  const list = useMemo(() => numbered(items), [items]);
  const byId = useMemo(() => new Map(list.map((x) => [x.id, x])), [list]);
  const [general, setGeneralRaw] = useState("");
  const setGeneral = (v) => { setGeneralRaw(v); setDirty(true); };
  const [flat, setFlat] = useState(false);
  const [adapted, setAdapted] = useState(null); // the prompt rewritten by Adapt, until the notes change

  // ── Tools ──
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState("red");
  const [brushSize, setBrushSize] = useState(28);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState(null); // { id, isNew, before }
  const lineSnap = useRef(null); // the work before typing in a composer note line
  const brushGroup = useRef(null); // E3.7: strokes one after another belong to one note
  const breakBrush = () => { brushGroup.current = null; };
  const canvas = useRef(null);
  const [zoom, setZoom] = useState({ z: 1, fit: 1 });

  // ── Versions (E6) ──
  const [versions, setVersions] = useState([]); // { id, url, status: pending | done | failed, error }
  const [shown, setShown] = useState("base"); // "base" or a version id
  const [comparing, setComparing] = useState(false);
  const baseWork = useRef(null); // the marks, objects and notes of the last Generate, for "Base"
  const shownVersion = shown === "base" ? null : versions.find((v) => v.id === shown) || null;
  const viewingBase = !shownVersion;

  // ── The composer (E4): the shared engine in the editor's own scope ──
  const pending = useRef([]); // version ids waiting for their result, in order
  const onDone = useRef(null);
  const onFail = useRef(null);
  onDone.current = ({ url: out }) => {
    const id = pending.current.shift();
    if (id) setVersions((vs) => vs.map((v) => (v.id === id ? { ...v, url: out, status: "done" } : v)));
  };
  onFail.current = (m) => {
    const id = pending.current.shift();
    if (id) setVersions((vs) => vs.map((v) => (v.id === id ? { ...v, status: "failed", error: m } : v)));
    setErr({ head: "Not generated.", text: String(m || "The model gave no result.") });
  };
  const engine = useDzCreateEngine({ apiKey, mode: "image", target, scope: "editor", onGenerationComplete: (r) => onDone.current(r), onGenerationError: (m) => onFail.current(m) });
  const cp = useComposerParams(engine);
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [pop, setPop] = useState(null);
  const [panel, setPanel] = useState(null);
  const [tab, setTab] = useState("layers");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(null); // "generate" | "save" | "send"
  const [closing, setClosing] = useState(false);

  // The editor opens on Nano Banana Pro (the model the template was made for) unless the user chose another here.
  const chosenOnce = useRef(false);
  useEffect(() => {
    if (chosenOnce.current || !engine.entries.length) return;
    chosenOnce.current = true;
    if (engine.saved?.modelByKind?.image) return;
    const nbp = engine.entries.find((e) => /nano banana pro$/i.test(e.familyName) && e.canEdit) || engine.entries.find((e) => /nano banana pro/i.test(e.familyName) && e.canEdit);
    if (nbp && nbp.key !== engine.entry?.key) engine.pickModel(nbp.key);
  }, [engine.entries.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // The result keeps the base's shape: the ratio chip starts at the base's own ratio (or the
  // model's "auto"), once per base and model; the user can still change it.
  const ratioFor = useRef(new Set()); // base|model pairs already set: a later choice of the user stays
  useEffect(() => {
    const p = cp.ratioP;
    if (!p || !base.w || !engine.entry) return;
    const key = `${base.url}|${engine.entry.key}`;
    if (ratioFor.current.has(key)) return;
    ratioFor.current.add(key);
    const auto = p.enum.find((o) => /^(auto|match_input_image|match input)$/i.test(String(o)));
    const shape = base.w / base.h;
    const num = (o) => { const m = /^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/.exec(String(o)); return m ? Number(m[1]) / Number(m[2]) : null; };
    const list = p.enum.filter((o) => num(o));
    const best = auto ?? (list.length ? list.reduce((a, o) => (Math.abs(Math.log(num(o) / shape)) < Math.abs(Math.log(num(a) / shape)) ? o : a), list[0]) : null);
    if (best != null && engine.values?.[p.key] !== best) engine.setValue(p.key, best);
  }, [cp.ratioP, base.url, base.w, base.h, engine.entry?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = summary(items, { flat });
  const objects = list.filter((x) => isObject(x) && x.n);
  const marks = list.filter((x) => isMark(x) && x.n);
  // What the engine gets: engine tags (@edit, @img1…), written per model by the engine (E5).
  const prompt = adapted || requestPrompt({ items, general, flat });
  const notesWritten = counts.notes > 0 || Boolean(general.trim()) || objects.length > 0;
  // Notes changed: an Adapt result no longer fits them.
  const promptKey = requestPrompt({ items, general, flat });
  const adaptedFor = useRef(null);
  useEffect(() => { if (adapted && adaptedFor.current !== promptKey) setAdapted(null); }, [promptKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The engine sees what the next request will send (for the price and the model's limits);
  // the marked copy is made only when Generate is pressed, the base stands in for it here.
  const att = useMemo(() => {
    if (!base.url) return {};
    if (flat) return { edit: [{ url: base.url, name: "picture" }] };
    const refs = [...(marks.length ? [{ url: base.url, name: "marks" }] : []), ...objects.map((o) => ({ url: o.url, name: o.name || "object" }))];
    return { edit: [{ url: base.url, name: "base" }], ...(refs.length ? { reference: refs } : {}) };
  }, [base.url, flat, marks.length, objects.map((o) => o.url).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const sending = useRef(null);
  useEffect(() => { if (!sending.current) engine.setAttached(att); }, [att]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sending.current) engine.setPrompt(prompt); }, [prompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const editModel = Boolean(engine.entry?.canEdit);
  const running = versions.some((v) => v.status === "pending");
  // Every picture of the request must reach the model (E5): a model that takes fewer is refused, not trimmed.
  const tooMany = editModel && engine.unusedCount > 0;
  const canGo = Boolean(engine.variant && editModel && viewingBase && notesWritten && base.w && !busy && !engine.uploads && !tooMany && !running);
  const whyNot = !engine.entry ? "Loading models…" : !editModel ? `${engine.entry.familyName} can't edit a picture. Choose a model that can.`
    : !viewingBase ? "Go back to Base to change the picture again."
      : tooMany ? `${engine.entry.familyName} can't take all ${counts.pictures} pictures of this request: ${engine.unusedCount} would be left out. Remove some pictures or choose another model.`
        : running ? "Wait for the versions that are still generating." : null;

  // ── Pictures for the request ──
  const makePicture = async (asFlat, doc = docRef.current) => {
    const render = (width, height) => renderPicture({ base, items: doc.items, erasers: doc.erasers, flat: asFlat, width, height });
    let blob;
    try { ({ blob } = await toJpeg(render, base.w, base.h)); }
    finally { forgetImages([base.url, ...doc.items.filter(isObject).map((o) => o.url)]); }
    const name = asFlat ? "picture-flattened.jpg" : "picture-marks.jpg";
    return uploadFile(apiKey, new File([blob], name, { type: "image/jpeg" }));
  };

  // ── Generate (E5, E6) ──
  const [genTick, setGenTick] = useState(0);
  const generate = async () => {
    if (!canGo) { if (whyNot) setErr({ head: "Not generated.", text: whyNot }); else if (!notesWritten) setErr({ head: "Nothing to change yet.", text: "Mark a place and write next to it what to change." }); return; }
    setErr(null);
    setBusy("generate");
    setPanel(null); setPop(null); setNote(null);
    // One snapshot of the request at the click: the canvas is locked meanwhile, and the files,
    // the marked copy and the prompt all come from this same version of the work.
    const snap = { doc: docRef.current, general, flat, prompt, marks: marks.length, objects: objects.map((o) => ({ url: o.url, name: o.name || "object" })) };
    try {
      let a;
      if (snap.flat) a = { edit: [{ url: await makePicture(true, snap.doc), name: "picture" }] };
      else {
        const marked = snap.marks ? await makePicture(false, snap.doc) : null;
        const refs = [...(marked ? [{ url: marked, name: "marks" }] : []), ...snap.objects];
        a = { edit: [{ url: base.url, name: "base" }], ...(refs.length ? { reference: refs } : {}) };
      }
      sending.current = { att: a, prompt: snap.prompt, work: { doc: snap.doc, general: snap.general, flat: snap.flat } };
      engine.setAttached(a);
      engine.setPrompt(snap.prompt);
      setGenTick((n) => n + 1);
    } catch (e) {
      sending.current = null;
      setBusy(null);
      setErr({ head: "Not generated.", text: String(e?.message || e) });
    }
  };
  // Runs once the engine has the request's files and prompt (one render later).
  useEffect(() => {
    const s = sending.current;
    if (!s || engine.attached !== s.att || engine.prompt !== s.prompt) return;
    sending.current = null;
    setBusy(null);
    if (!engine.canRun || engine.unusedCount > 0) { setErr({ head: "Not generated.", text: engine.missing || "This model can't take all the pictures of this request." }); engine.setAttached(att); engine.setPrompt(prompt); return; }
    const ids = Array.from({ length: engine.count }, () => newId("ver"));
    pending.current.push(...ids);
    // One batch at a time (Generate waits for it), so its results fill its versions in any order;
    // a job that ends with neither a result nor an error is marked failed when the batch ends.
    Promise.resolve().then(() => engine.generate()).catch((e) => onFail.current(String(e?.message || e))).finally(() => {
      pending.current = pending.current.filter((id) => !ids.includes(id));
      setVersions((vs) => vs.map((v) => (ids.includes(v.id) && v.status === "pending" ? { ...v, status: "failed", error: "The model gave no result." } : v)));
    });
    baseWork.current = s.work;
    setVersions((vs) => [...vs, ...ids.map((id) => ({ id, url: null, status: "pending" }))]);
    setShown(ids[0]);
    setTab("versions");
    // The work is kept with Base; the canvas shows the result (E6).
    docRef.current = { items: [], erasers: [] };
    setDocState(docRef.current);
    undo.current = []; redo.current = [];
    setGeneralRaw(""); setAdapted(null); setNote(null); setSelected(null); breakBrush();
    setDirty(false);
  }, [engine.attached, engine.prompt, genTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const showBase = () => {
    setShown("base");
    // Base brings its marks, objects and notes back, to adjust and run again (E6).
    if (baseWork.current && !docRef.current.items.length) {
      const w = baseWork.current;
      docRef.current = w.doc; setDocState(w.doc); setGeneralRaw(w.general); setFlat(w.flat);
    }
  };
  const useAsBase = (v) => {
    if (!v?.url) return;
    setBase({ url: v.url, w: 0, h: 0 });
    baseWork.current = null;
    docRef.current = { items: [], erasers: [] }; setDocState(docRef.current);
    undo.current = []; redo.current = [];
    setGeneralRaw(""); setShown("base"); setTab("layers");
    notify({ type: "notice", title: "Editor", message: "That version is the base now. Mark it up for the next pass." });
  };

  // ── Items ──
  // A note field: a new item's note is part of the step that made the item; changing an existing
  // note becomes one step when it is saved with a different text.
  const open = (id, isNew) => { const it = docRef.current.items.find((x) => x.id === id); setNote({ id, isNew, before: it?.note || "", snap: isNew ? null : docRef.current, wasDirty: dirtyRef.current }); };
  const create = (shape) => {
    breakBrush();
    const it = { id: newId(shape.kind), note: "", hidden: false, color, ...shape };
    commit((d) => ({ ...d, items: [...d.items, it] }));
    setSelected(it.id);
    open(it.id, true);
  };
  const seq = useRef(1);
  const onStroke = ({ points, size }) => {
    const stroke = { seq: seq.current++, points, size };
    const g = brushGroup.current && docRef.current.items.find((x) => x.id === brushGroup.current);
    if (g) {
      commit((d) => ({ ...d, items: d.items.map((x) => (x.id === g.id ? { ...x, strokes: [...x.strokes, stroke] } : x)) }));
      // The same area, the same note: its field opens again (E3.7).
      setNote({ id: g.id, isNew: false, before: g.note || "", snap: docRef.current, wasDirty: true });
      return;
    }
    const it = { id: newId("brush"), kind: "brush", note: "", hidden: false, color: "red", strokes: [stroke] };
    commit((d) => ({ ...d, items: [...d.items, it] }));
    brushGroup.current = it.id;
    setSelected(null);
    open(it.id, true);
  };
  const onErase = ({ points, size }) => { breakBrush(); commit((d) => ({ ...d, erasers: [...d.erasers, { seq: seq.current++, points, size }] })); };
  const setItem = (id, patch) => commit((d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const remove = (id) => {
    breakBrush();
    commit((d) => ({ ...d, items: d.items.filter((x) => x.id !== id) }));
    if (selected === id) setSelected(null);
    if (note?.id === id) setNote(null);
  };
  const duplicate = (id) => {
    const it = docRef.current.items.find((x) => x.id === id);
    if (!it) return;
    if (isObject(it) && objects.length >= MAX_OBJECTS) { notify({ type: "notice", title: "Editor", message: `Up to ${MAX_OBJECTS} pictures.` }); return; }
    const d = Math.max(12, (base.w || 1000) / 60);
    const copy = { ...it, id: newId(it.kind), note: "" };
    if (it.kind === "rect" || it.kind === "point") { copy.x += d; copy.y += d; }
    if (it.kind === "arrow") { copy.x += d; copy.y += d; copy.x2 += d; copy.y2 += d; }
    if (it.kind === "brush") copy.strokes = it.strokes.map((s) => ({ ...s, seq: seq.current++, points: s.points.map((v) => v + d) }));
    if (it.kind === "object") { copy.cx += d; copy.cy += d; copy.z = maxZ() + 1; }
    commit((dd) => ({ ...dd, items: [...dd.items, copy] }));
    setSelected(copy.id);
  };
  const maxZ = () => Math.max(0, ...docRef.current.items.filter(isObject).map((o) => o.z || 0));
  const reorder = (id, front) => {
    const zs = docRef.current.items.filter(isObject).map((o) => o.z || 0);
    setItem(id, { z: front ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1 });
  };
  const stepHistory = (from, to) => {
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push(docRef.current);
    docRef.current = prev;
    setDocState(prev);
    setNote(null);
    breakBrush();
    if (selected && !prev.items.some((x) => x.id === selected)) setSelected(null);
    setDirty(true);
    bump((n) => n + 1);
  };
  const doUndo = () => stepHistory(undo, redo);
  const doRedo = () => stepHistory(redo, undo);

  // Pasted pictures: placed in the middle (or where dropped), a third of the base wide.
  const placeObjects = async (urls, at = null) => {
    const room = MAX_OBJECTS - docRef.current.items.filter(isObject).length;
    const take = urls.slice(0, Math.max(0, room));
    if (urls.length > take.length) notify({ type: "notice", title: "Editor", message: `Up to ${MAX_OBJECTS} pictures on one base.` });
    if (!take.length) return;
    const c = at || canvas.current?.center() || { x: base.w / 2, y: base.h / 2 };
    const made = [];
    let z = maxZ();
    for (const [i, u] of take.entries()) {
      const info = await dzMediaInfo(u.url).catch(() => null);
      const ratio = info?.width ? info.width / info.height : 4 / 3;
      const w = Math.round((base.w || 1000) * 0.32);
      made.push({ id: newId("object"), kind: "object", url: u.url, name: shortName(u.name), note: "", hidden: false, cx: c.x + i * w * 0.08, cy: c.y + i * w * 0.08, w, h: Math.round(w / ratio), rotation: 0, flipX: false, z: (z += 1) });
    }
    breakBrush();
    commit((d) => ({ ...d, items: [...d.items, ...made] }));
    const last = made[made.length - 1];
    setSelected(last.id);
    setTool("select");
    setPicker(false); // the note field opens next to the picture (E3.8); the picker would cover it
    open(last.id, true);
  };
  const uploadObjects = async (files, at) => {
    const urls = [];
    setBusy("upload");
    try { for (const f of files) urls.push({ url: await uploadFile(apiKey, f), name: f.name.replace(/\.[^.]+$/, "") }); }
    catch (e) { notify({ type: "error", title: "Upload", message: String(e?.message || e) }); }
    finally { setBusy(null); }
    if (urls.length) placeObjects(urls, at);
  };
  const replaceRef = useRef(null);
  // The picker: chosen pictures in, removed ones out (it shows the objects as its "chosen").
  const pickerAttached = useMemo(() => ({ reference: objects.map((o) => ({ url: o.url, name: o.name })) }), [objects.map((o) => o.url).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const setPickerAttached = (fn) => {
    const next = (typeof fn === "function" ? fn(pickerAttached) : fn).reference || [];
    if (replaceRef.current) {
      const fresh = next.find((x) => !pickerAttached.reference.some((y) => y.url === x.url));
      if (fresh) { setItem(replaceRef.current, { url: fresh.url, name: shortName(fresh.name) }); replaceRef.current = null; setPicker(false); }
      return;
    }
    const added = next.filter((x) => !pickerAttached.reference.some((y) => y.url === x.url));
    const gone = pickerAttached.reference.filter((x) => !next.some((y) => y.url === x.url)).map((x) => x.url);
    if (gone.length) commit((d) => ({ ...d, items: d.items.filter((x) => !(isObject(x) && gone.includes(x.url))) }));
    if (added.length) placeObjects(added);
  };
  const canvasHost = useRef(null);
  useDzDropTarget({ el: canvasHost, enabled: viewingBase, title: "Drop pictures here", line: (n) => `${n} picture${n === 1 ? "" : "s"} · pasted onto the picture where you drop`, drop: (files, pt) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length) uploadObjects(imgs, pt && canvas.current ? canvas.current.toWorld(pt.x, pt.y) : null);
  } });

  // ── Notes (E3) ──
  const typeNote = (id, text) => live((d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, note: text } : x)) }));
  const closeNote = (how, keepBrush = false) => {
    if (!note) return;
    const id = note.id;
    const now = docRef.current.items.find((x) => x.id === id)?.note || "";
    if (how === "cancel") {
      // Esc: the note goes back to what it was; nothing changed, nothing to undo.
      if (now !== note.before) { const next = { ...docRef.current, items: docRef.current.items.map((x) => (x.id === id ? { ...x, note: note.before && !note.isNew ? note.before : "" } : x)) }; docRef.current = next; setDocState(next); }
      if (!note.isNew && note.wasDirty === false) setDirty(false);
    } else if (note.snap && now !== note.before) pushUndo(note.snap);
    setNote(null);
    if (!keepBrush || how !== "save") breakBrush();
    if (how === "generate") setTimeout(generate, 0);
    canvas.current?.focus();
  };
  const noteKeys = (e) => {
    e.stopPropagation();
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return; // an input method is composing (Enter picks a word)
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeNote("generate"); return; }
    if (e.key === "Enter") { e.preventDefault(); closeNote("save"); return; }
    if (e.key === "Escape") { e.preventDefault(); closeNote("cancel"); }
  };

  // ── Keys ──
  useEffect(() => {
    const down = (e) => {
      if (closing || picker || panel || pop || busy === "generate") return;
      if (e.target.closest?.("input,textarea,[contenteditable=true]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && k === "y") { e.preventDefault(); doRedo(); return; }
      if (mod && k === "d" && selected) { e.preventDefault(); duplicate(selected); return; }
      if (mod) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); remove(selected); return; }
      if (e.key === "Escape") { if (selected) setSelected(null); else if (tool !== "select") setTool("select"); else requestClose(); return; }
      const t = TOOLS.find((x) => x && x[3] === k);
      if (t) { e.preventDefault(); pickTool(t[0]); }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  });
  const pickTool = (t) => {
    breakBrush();
    if (t === "picture") { replaceRef.current = null; setPicker(true); return; }
    setTool(t);
    if (t !== "select") setSelected(null);
  };

  // ── Save a copy, Send to composer, Close (E7) ──
  const saveCopy = async () => {
    if (!base.w) return false;
    setBusy("save");
    try {
      const upload = await makePicture(true);
      const res = await fetch("/dz/api/editor/copy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: upload, from: base.url, prompt: editorPrompt({ items, general }), ...dzContextParams(), ...(target ? { target: { board: target.board, id: target.id, kind: target.kind } } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `HTTP ${res.status}`);
      setDirty(false);
      notify({ type: "notice", title: "Saved", message: "A copy is next to the original. The original is unchanged." });
      return true;
    } catch (e) {
      notify({ type: "error", title: "Save a copy", message: String(e?.message || e) });
      return false;
    } finally { setBusy(null); }
  };
  const sendToComposer = async () => {
    if (!base.w) return;
    setBusy("send");
    try {
      const marked = marks.length ? await makePicture(false) : null;
      onSendToComposer?.({ edit: base.url, references: [...(marked ? [{ url: marked, name: "marks", label: "Marks" }] : []), ...objects.map((o) => ({ url: o.url, name: o.name || "object", label: "Object" }))], prompt: composerPrompt({ items, general }) });
      onClose();
    } catch (e) {
      notify({ type: "error", title: "Send to composer", message: String(e?.message || e) });
    } finally { setBusy(null); }
  };
  const requestClose = () => { if (dirty && hasWork(items, general)) setClosing(true); else onClose(); };

  // ── Overlay: notes and pills, the selection's small toolbar ──
  const overlay = ({ z, dragging, vkey }) => (
    <>
      {viewingBase && list.filter((it) => it.n).map((it) => {
        const a = anchorOf(it);
        const editing = note?.id === it.id;
        const text = String(it.note || "").trim();
        const isPoint = it.kind === "point";
        return (
          <div key={it.id} data-follow={it.id} className="absolute" style={{ left: a.x, top: a.y }}>
            <div className={cn("absolute", isPoint ? "left-0 top-0" : "bottom-0 left-0")} style={{ transform: "scale(var(--iz))", transformOrigin: isPoint ? "left center" : "bottom left" }}>
              <Inside deps={[text, vkey, editing, a.x, a.y]} className={cn(isPoint ? "-translate-y-1/2 pl-4" : "pb-2")}>
                {editing ? (
                  <NoteField it={it} onType={(t) => typeNote(it.id, t)} onKeyDown={noteKeys} onBlur={() => { if (note?.id === it.id) closeNote("save", tool === "brush"); }}
                    onRemoveNote={note.isNew ? null : () => { typeNote(it.id, ""); closeNote("save"); }} onEnter={() => closeNote("save")} />
                ) : text || isObject(it) ? (
                  <button type="button" data-overlay-ui onPointerDown={(e) => e.stopPropagation()} onClick={() => { setSelected(it.id); open(it.id, false); }}
                    className="pointer-events-auto flex max-w-[360px] items-center gap-1.5 whitespace-nowrap rounded-full bg-overlay/80 py-1 pl-1 pr-3 text-sm text-overlay-foreground shadow-popover backdrop-blur-sm transition-colors duration-state hover:bg-overlay/90">
                    <Num n={it.n} />{isObject(it) && <RefChip tag={it.tag} url={it.url} />}<span className="truncate">{text}</span>
                  </button>
                ) : (
                  <button type="button" data-overlay-ui aria-label={`Write a note for ${it.n}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setSelected(it.id); open(it.id, false); }} className="pointer-events-auto rounded-full"><Num n={it.n} /></button>
                )}
              </Inside>
            </div>
          </div>
        );
      })}
      {viewingBase && !dragging && selected && byId.get(selected) && note?.id !== selected && (() => {
        const it = byId.get(selected);
        const b = boundsOf(it);
        return (
          <div data-follow={it.id} className="absolute" style={{ left: b.x, top: b.y + b.h }}>
            <div className="absolute left-0 top-0" style={{ transform: "scale(var(--iz))", transformOrigin: "top left" }}>
              <Inside deps={[it.id, vkey, b.x, b.y, b.w, b.h]} data-overlay-ui onPointerDown={(e) => e.stopPropagation()} className="pointer-events-auto mt-3 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-popover">
                {isObject(it) ? (
                  <>
                    <Tool label="Flip" onClick={() => setItem(it.id, { flipX: !it.flipX })}><FlipHorizontal size={15} /></Tool>
                    <Tool label="Bring forward" onClick={() => reorder(it.id, true)}><ArrowLineUp size={15} /></Tool>
                    <Tool label="Send back" onClick={() => reorder(it.id, false)}><ArrowLineDown size={15} /></Tool>
                    <Tool label="Replace…" onClick={() => { replaceRef.current = it.id; setPicker(true); }}><ArrowsClockwise size={15} /></Tool>
                    <Tool label="Remove" onClick={() => remove(it.id)}><Trash size={15} /></Tool>
                  </>
                ) : (
                  <>
                    {it.kind !== "point" && <ColourMenu value={it.color} onPick={(c) => setItem(it.id, { color: c })} />}
                    <Tool label="Duplicate (⌘D)" onClick={() => duplicate(it.id)}><Copy size={15} /></Tool>
                    <Tool label="Remove (Delete)" onClick={() => remove(it.id)}><Trash size={15} /></Tool>
                  </>
                )}
              </Inside>
            </div>
          </div>
        );
      })()}
    </>
  );

  // ── Layout ──
  const composerBox = useRef(null);
  const [composerH, setComposerH] = useState(56);
  useEffect(() => {
    const el = composerBox.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setComposerH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);
  const shownUrl = comparing || viewingBase ? base.url : shownVersion?.url || base.url;
  const place = (placeOf && base.url !== url ? placeOf(base.url) : null) || openedAt;
  const title = place?.title ? `${place.title}${place.n ? ` · picture ${place.i} of ${place.n}` : ""}` : place?.n ? `Picture ${place.i} of ${place.n}` : "";
  const hereTabs = target?.pickerHere || null;
  const pictureCount = counts.pictures;
  const barSummary = counts.notes ? `${counts.notes} note${counts.notes === 1 ? "" : "s"} · sends ${pictureCount} picture${pictureCount === 1 ? "" : "s"}` : `${engine.entry?.familyName || ""} · sends ${pictureCount} picture${pictureCount === 1 ? "" : "s"}`;

  // While the marked copy is made and the request handed over, nothing can change it (E5).
  const lockWhileSending = busy === "generate" ? { inert: true, "aria-busy": true } : {};

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground" role="dialog" aria-modal="true" aria-label="Picture editor">
      {/* Header (E1) */}
      <header {...lockWhileSending} className="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-border pl-3 pr-[316px]">
        <button type="button" onClick={requestClose} aria-label="Close the editor" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={18} /></button>
        <span className="text-base font-semibold">Editor</span>
        {title && <span className="truncate text-sm text-muted-foreground">{title}</span>}
        <span className="flex-1" />
        <Tip text="Undo (⌘Z)"><button type="button" onClick={doUndo} disabled={!undo.current.length} aria-label="Undo" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"><ArrowCounterClockwise size={17} /></button></Tip>
        <Tip text="Redo (⇧⌘Z)"><button type="button" onClick={doRedo} disabled={!redo.current.length} aria-label="Redo" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-35"><ArrowClockwise size={17} /></button></Tip>
        <button type="button" onClick={saveCopy} disabled={!viewingBase || !items.length || Boolean(busy)} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-45">
          {busy === "save" ? <Spinner className="h-3.5 w-3.5" /> : <FloppyDisk size={15} />}Save a copy</button>
        <button type="button" onClick={sendToComposer} disabled={!viewingBase || !onSendToComposer || Boolean(busy)} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-45">
          {busy === "send" ? <Spinner className="h-3.5 w-3.5" /> : <ArrowElbowDownRight size={15} />}Send to composer</button>
      </header>

      <div {...lockWhileSending} className="relative flex min-h-0 flex-1">
        {/* Stage */}
        <div ref={canvasHost} className="relative min-w-0 flex-1">
          {base.w ? (
            <EditorCanvas ref={canvas} reserveBottom={150} base={base} shownUrl={shownUrl} showWork={viewingBase && !comparing} items={items} erasers={doc.erasers} tool={tool} color={color} brushSize={brushSize}
              selected={selected} onSelect={(id) => { breakBrush(); setSelected(id); }} onCreate={create} onStroke={onStroke} onErase={onErase}
              onMove={(id, patch) => setItem(id, patch)} onTransform={(id, patch) => setItem(id, patch)} onPoint={(p) => create({ kind: "point", x: p.x, y: p.y })}
              onPick={() => { replaceRef.current = null; setPicker(true); }} onFiles={(files, at) => uploadObjects(files, at)} overlay={overlay} onView={setZoom}
              onCanvasDown={() => { if (note) closeNote("save", tool === "brush"); }} disabled={!viewingBase || busy === "generate"} />
          ) : <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6" /></div>}

          {!viewingBase && (
            <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ bottom: composerH + 92 }}>
              <button type="button" onPointerDown={() => setComparing(true)} onPointerUp={() => setComparing(false)} onPointerLeave={() => setComparing(false)}
                onKeyDown={(e) => { if (e.key === " ") setComparing(true); }} onKeyUp={() => setComparing(false)}
                className="pointer-events-auto flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium shadow-float hover:bg-accent"><ArrowsLeftRight size={15} />{comparing ? "Showing the base" : "Hold to compare with the base"}</button>
            </div>
          )}
          {shownVersion?.status === "pending" && !comparing && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="flex items-center gap-2 rounded-full bg-overlay/70 px-4 py-2 text-sm text-overlay-foreground"><Spinner className="h-4 w-4 border-overlay-foreground/30 border-t-overlay-foreground" />Generating…</span></div>
          )}
          {shownVersion?.status === "failed" && !comparing && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="flex max-w-md items-center gap-2 rounded-lg bg-overlay/80 px-4 py-2 text-sm text-overlay-foreground"><WarningCircle size={16} />{shownVersion.error || "Not generated."}</span></div>
          )}

          {/* Tools, zoom and the composer, bottom centre (E1, E4) */}
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-3 px-6">
            <div className="relative flex w-full items-center justify-center">
              <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-float" role="toolbar" aria-label="Editor tools">
                {TOOLS.map((t, i) => (t ? (
                  <Tool key={t[0]} on={tool === t[0] || (t[0] === "picture" && picker)} label={t[2]} onClick={() => pickTool(t[0])} disabled={!viewingBase && t[0] !== "select" && t[0] !== "hand"}>{(() => { const I = t[1]; return <I size={17} />; })()}</Tool>
                ) : <span key={i} className="mx-1 h-5 w-px bg-border" />))}
                {(tool === "rect" || tool === "arrow") && (
                  <><span className="mx-1 h-5 w-px bg-border" />{MARK_COLORS.map((c) => (
                    <button key={c.id} type="button" aria-label={`Colour: ${c.label}`} aria-pressed={color === c.id} onClick={() => setColor(c.id)} className="flex h-8 w-7 items-center justify-center rounded-md hover:bg-accent">
                      <span className={cn("h-5 w-5 rounded-full border border-border", color === c.id && "ring-2 ring-foreground ring-offset-2 ring-offset-card")} style={{ background: c.hex }} />
                    </button>
                  ))}</>
                )}
                {(tool === "brush" || tool === "eraser") && (
                  <><span className="mx-1 h-5 w-px bg-border" /><label className="flex h-8 items-center gap-2 px-2 text-sm text-muted-foreground">Size
                    <input type="range" min={6} max={120} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-24 accent-foreground" aria-label="Brush size" /></label></>
                )}
              </div>
              {expanded && <ZoomBox z={zoom} canvas={canvas} className="pointer-events-auto absolute right-0" />}
            </div>
            <div ref={composerBox} className="pointer-events-auto w-full max-w-[1000px]">
              {!expanded ? (
                <div className="flex justify-center">
                  <ComposerBar onOpen={() => setExpanded(true)} onGenerate={generate} canGo={canGo && notesWritten} summary={barSummary} className="w-[min(800px,100%)]">
                    <span className="min-w-0 flex-1 truncate text-base">
                      {counts.notes || objects.length ? <BarNotes list={list} /> : <span className="text-muted-foreground">Draw or add something, then type next to it what to change</span>}
                    </span>
                  </ComposerBar>
                </div>
              ) : (
                <EditorComposer engine={engine} cp={cp} base={base} list={list} marks={marks} objects={objects} general={general} setGeneral={setGeneral}
                  setNoteText={typeNote} onLineFocus={() => { lineSnap.current = docRef.current; }} onLineBlur={() => { if (lineSnap.current && lineSnap.current !== docRef.current) pushUndo(lineSnap.current); lineSnap.current = null; }}
                  onCollapse={() => setExpanded(false)} onAddPicture={() => { replaceRef.current = null; setPicker(true); }} removeObject={remove}
                  pop={pop} setPop={setPop} panel={panel} setPanel={setPanel} onGenerate={generate} canGo={canGo} err={err} setErr={setErr} busy={busy === "generate"} adapted={adapted} clearAdapted={() => setAdapted(null)} />
              )}
            </div>
            {!expanded && <ZoomBox z={zoom} canvas={canvas} className="pointer-events-auto absolute bottom-0 right-6" />}
          </div>

          {/* The picker (E2): the shared picture window, for up to nine pictures. */}
          {picker && (
            <div className="absolute bottom-[96px] left-1/2 z-30 w-[min(640px,calc(100%-48px))] -translate-x-1/2">
              <PickerHereContext.Provider value={hereTabs}>
                <LibraryWindow open={picker} groups={[OBJECTS_GROUP]} groupId="objects" setGroupId={() => {}} attached={pickerAttached} setAttached={setPickerAttached}
                  title={replaceRef.current ? "Replace the picture" : "Add to the picture"} onClose={() => { setPicker(false); replaceRef.current = null; }}
                  onError={(m) => notify({ type: "error", title: "Upload", message: m })} onUploading={(on) => setBusy(on ? "upload" : null)} />
              </PickerHereContext.Provider>
            </div>
          )}
        </div>

        {/* Right panel (E1, E3, E5, E6) */}
        <aside ref={dzScrollBoxRef} className="flex w-[300px] flex-shrink-0 flex-col border-l border-border bg-card">
          <div className="-mt-[52px] flex h-[52px] flex-shrink-0 items-end gap-5 border-b border-border px-4" role="tablist">
            {[["layers", "Layers", items.length + 1], ["versions", "Versions", versions.length + 1], ["model", "To model", pictureCount]].map(([id, label, n]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={cn("relative h-[52px] whitespace-nowrap pt-1 text-sm font-medium transition-colors duration-state", tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {label} <span className="tabular-nums text-muted-foreground">{n}</span>
                {tab === id && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />}
              </button>
            ))}
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
            {tab === "layers" && <LayersTab list={list} base={base} target={target} selected={selected} onSelect={(id) => { setSelected(id); setTool("select"); }} onToggle={(id, hidden) => setItem(id, { hidden })} />}
            {tab === "versions" && <VersionsTab versions={versions} base={base} shown={shown} onShow={(id) => (id === "base" ? showBase() : setShown(id))} onUseAsBase={useAsBase} approve={approve} isApproved={isApproved} />}
            {tab === "model" && <ModelTab base={base} items={items} erasers={doc.erasers} flat={flat} setFlat={setFlat} prompt={engine.finalPrompt || prompt} adapted={adapted} clearAdapted={() => setAdapted(null)} />}
          </div>
          <p className="flex-shrink-0 border-t border-border p-4 text-sm leading-5 text-muted-foreground">
            {tab === "layers" ? (items.length ? "Click a number on the picture to change its note. The eye hides a layer and its note: hidden ones are not sent." : "Nothing added yet. Mark a place, paint over an area or add a picture — a note field opens next to it. The base picture is never changed.")
              : tab === "versions" ? "Each Generate adds a version here and to the shot's gallery. One change per pass keeps the rest of the picture stable."
                : "This is a preview. Nothing is sent until you press Generate."}
          </p>
        </aside>
      </div>

      <ComposerPanels engine={engine} cp={cp} panel={panel} setPanel={setPanel} adaptText={prompt}
        onAdaptUse={(t) => { adaptedFor.current = promptKey; setAdapted(t); setPanel(null); setTab("model"); }} />

      {/* Close with unsaved work (E7, screen 17) */}
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Close the editor?</DialogTitle>
            <DialogDescription>{(() => { const w = workWords(items) || "work"; const one = /^(1|an?) [a-z]+$/i.test(w); return `You have ${w} on this picture that ${one ? "was" : "were"} not saved or generated. ${one ? "It" : "They"} will be lost.`; })()}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setClosing(false)} className="h-9 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Cancel</button>
            <button type="button" onClick={() => { setClosing(false); onClose(); }} className="h-9 whitespace-nowrap rounded-md border border-border px-3 text-sm font-medium hover:bg-accent">Close without saving</button>
            <button type="button" disabled={busy === "save"} onClick={async () => { if (await saveCopy()) { setClosing(false); onClose(); } }}
              className="flex h-9 items-center gap-2 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60">{busy === "save" && <Spinner className="h-3.5 w-3.5 border-primary-foreground/30 border-t-primary-foreground" />}Save a copy and close</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>,
    document.body,
  );
}

// ── Small parts ──
// A note, its field or the selection toolbar: kept inside the canvas near its edges.
function Inside({ deps, children, ...rest }) {
  const ref = useRef(null);
  useKeepInside(ref, deps);
  return <div ref={ref} {...rest}>{children}</div>;
}
// A note field or pill near the canvas edge slides back inside it (it stays attached to its place).
function useKeepInside(ref, deps) {
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.closest('[aria-label="Picture to edit"]');
    if (!el || !box) return;
    el.style.translate = "";
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const fit = (lo, hi, min, max) => (hi > max - 8 ? Math.max(min + 8 - lo, max - 8 - hi) : lo < min + 8 ? min + 8 - lo : 0);
    const dx = fit(r.left, r.right, b.left, b.right);
    const dy = fit(r.top, r.bottom, b.top, b.bottom);
    if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

// A number: white circle, dark text (E3.10) — content colours, the same in both themes.
const Num = ({ n }) => <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums" style={{ background: "#FFFFFF", color: "#111113" }}>{n}</span>;

function NoteField({ it, onType, onKeyDown, onBlur, onRemoveNote, onEnter }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) setTimeout(() => { el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); }, 0); }, [it.id]);
  return (
    <div data-overlay-ui onPointerDown={(e) => e.stopPropagation()} className="pointer-events-auto flex w-[400px] items-center gap-1.5 rounded-xl border border-input bg-popover py-1 pl-1 pr-1 shadow-popover">
      <Num n={it.n} />
      {isObject(it) && <RefChip tag={it.tag} url={it.url} />}
      <input ref={ref} value={it.note || ""} onChange={(e) => onType(e.target.value)} onKeyDown={onKeyDown} onBlur={onBlur} aria-label={`Note ${it.n}`}
        placeholder={isObject(it) ? "What to do with this picture" : it.kind === "point" ? "What should change here" : "What to change here"}
        className="h-7 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground" />
      {onRemoveNote && <button type="button" aria-label="Remove the note" onMouseDown={(e) => e.preventDefault()} onClick={onRemoveNote} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Trash size={14} /></button>}
      <button type="button" aria-label="Save the note (Enter)" onMouseDown={(e) => e.preventDefault()} onClick={onEnter} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><KeyReturn size={14} /></button>
    </div>
  );
}

function BarNotes({ list }) {
  return list.filter((it) => it.n && (String(it.note || "").trim() || isObject(it))).map((it) => (
    <span key={it.id} className="mr-4">{it.n}. {isObject(it) && <RefChip tag={it.tag} url={it.url} />} {String(it.note || "").trim()}</span>
  ));
}

function ColourMenu({ value, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <Tool label="Colour" on={open} onClick={() => setOpen((v) => !v)}><Palette size={15} /></Tool>
      {open && (
        <span className="absolute left-0 top-[calc(100%+6px)] flex gap-1 rounded-lg border border-border bg-popover p-1 shadow-popover">
          {MARK_COLORS.map((c) => (
            <button key={c.id} type="button" aria-label={`Colour: ${c.label}`} onClick={() => { onPick(c.id); setOpen(false); }} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent">
              <span className={cn("h-5 w-5 rounded-full border border-border", value === c.id && "ring-2 ring-foreground ring-offset-2 ring-offset-popover")} style={{ background: c.hex }} />
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function ZoomBox({ z, canvas, className }) {
  const pct = Math.round((z.z / (z.fit || z.z || 1)) * 100);
  return (
    <div className={cn("flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-float", className)}>
      <Tool label="Zoom out" onClick={() => canvas.current?.zoomOut()}><Minus size={15} /></Tool>
      <span className="w-12 text-center text-sm tabular-nums text-muted-foreground">{pct}%</span>
      <Tool label="Zoom in" onClick={() => canvas.current?.zoomIn()}><Plus size={15} /></Tool>
      <Tool label="Fit" onClick={() => canvas.current?.fit()}><CornersOut size={15} /></Tool>
    </div>
  );
}

// The expanded composer (E4, screen 13): Base · Marks · Objects, the notes as a numbered list
// (one source of truth with the picture), one free line, then the shared bottom row.
function EditorComposer({ engine, cp, base, list, marks, objects, general, setGeneral, setNoteText, onLineFocus, onLineBlur, onCollapse, onAddPicture, removeObject, pop, setPop, panel, setPanel, onGenerate, canGo, err, setErr, busy, adapted, clearAdapted }) {
  const lines = list.filter((it) => it.n && (isObject(it) || isMark(it)));
  return (
    <div className="relative rounded-xl border border-border bg-card p-4 shadow-float">
      <Tip text="Collapse"><button type="button" aria-label="Collapse" onClick={onCollapse} className="absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><CaretDown size={16} /></button></Tip>
      <div className="flex items-stretch">
        <StripGroup label="Base" n={1} max={1}><span className="contents [&_button[aria-label^='Remove']]:hidden"><Thumb item={{ url: base.url, role: "edit" }} kind="image" tag="Base picture · stays untouched" onRemove={() => {}} /></span></StripGroup>
        <span className="mx-3.5 w-px self-stretch bg-border" />
        <StripGroup label="Marks" n={marks.length ? 1 : 0} max={1}>{marks.length ? <span className="contents [&_button[aria-label^='Remove']]:hidden"><Thumb item={{ url: base.url, role: "marks" }} kind="image" label="Marks" tag="The copy with your marks (made when you press Generate)" onRemove={() => {}} /></span> : <span className="flex h-12 items-center text-sm text-muted-foreground">Draw a mark</span>}</StripGroup>
        <span className="mx-3.5 w-px self-stretch bg-border" />
        <StripGroup label="Objects" n={objects.length} max={MAX_OBJECTS}>
          {objects.map((o) => <Thumb key={o.id} item={{ url: o.url, role: "reference" }} kind="image" tag={`@${o.tag} · ${o.name || "Picture"}`} onRemove={() => removeObject(o.id)} />)}
          {objects.length < MAX_OBJECTS && <EmptySlot onClick={onAddPicture} />}
        </StripGroup>
      </div>
      <div className="mt-3 space-y-1.5">
        {lines.map((it) => (
          <label key={it.id} className="flex min-h-[30px] items-center gap-1.5 text-prompt">
            <span className="w-6 flex-shrink-0 tabular-nums">{it.n}.</span>
            {isObject(it) && <RefChip tag={it.tag} url={it.url} />}
            <input value={it.note || ""} onFocus={onLineFocus} onBlur={onLineBlur} onChange={(e) => setNoteText(it.id, e.target.value)} placeholder={isObject(it) ? "What to do with this picture" : `What to change at ${it.n}`}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
          </label>
        ))}
        <input value={general} onChange={(e) => setGeneral(e.target.value)} placeholder="Anything for the whole picture… (optional)" aria-label="An instruction for the whole picture"
          className="h-[30px] w-full bg-transparent text-prompt outline-none placeholder:text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{adapted ? <>The prompt was adapted for {engine.entry?.familyName}. <button type="button" onClick={clearAdapted} className="underline decoration-input underline-offset-[3px] hover:text-foreground">Use my notes</button></> : "The editor adds by itself what each picture is for. See the To model tab."}</p>
      </div>
      {err && (
        <div role="alert" className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-destructive">
          <WarningCircle size={14} className="mt-[3px] flex-shrink-0" />
          <span className="min-w-0 text-foreground"><b className="font-semibold text-destructive">{err.head}</b> {err.text}
            <button type="button" onClick={() => setErr(null)} className="ml-1.5 whitespace-nowrap font-semibold text-foreground underline decoration-input underline-offset-[3px]">Dismiss</button></span>
        </div>
      )}
      <div className="mt-3">
        <ComposerRow engine={{ ...engine, busy: busy ? 1 : engine.busy }} cp={cp} light pop={pop} setPop={setPop} panel={panel} setPanel={setPanel} onPlus={onAddPicture} plusDisabled={objects.length >= MAX_OBJECTS} plusLabel="Add a picture" elements={false}
          onGenerate={onGenerate} canGo={canGo} />
      </div>
    </div>
  );
}

function StripGroup({ label, n, max, children }) {
  return (
    <div className="flex-shrink-0">
      <div className="mb-2 flex h-4 items-center gap-1.5 whitespace-nowrap"><Overline>{label}</Overline><span className="text-[11px] font-medium uppercase tabular-nums text-subtle">{n} / {max}</span></div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function LayersTab({ list, base, target, selected, onSelect, onToggle }) {
  return (
    <ul className="p-1.5">
      {[...list].reverse().map((it) => (
        <li key={it.id}>
          <div role="button" tabIndex={0} onClick={() => onSelect(it.id)} onKeyDown={(e) => { if (e.key === "Enter") onSelect(it.id); }}
            className={cn("group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent", selected === it.id && "bg-accent", it.hidden && "opacity-55")}>
            {isObject(it) ? <img src={dzThumb(it.url, 128)} alt="" className="h-9 w-11 flex-shrink-0 rounded-sm object-cover" />
              : <span className="flex h-9 w-11 flex-shrink-0 items-center justify-center rounded-sm bg-muted text-sm font-semibold tabular-nums">{it.n || "–"}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{isObject(it) ? it.name || "Picture" : KIND_NAME[it.kind]}</span>
              <span className="block truncate text-xs text-muted-foreground">{isObject(it) ? `${it.n ? `${it.n} · ` : ""}${String(it.note || "").trim() || `@${it.tag || "obj"}`}` : String(it.note || "").trim() || "No note"}</span>
            </span>
            <button type="button" aria-label={it.hidden ? "Show the layer" : "Hide the layer"} onClick={(e) => { e.stopPropagation(); onToggle(it.id, !it.hidden); }} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground">{it.hidden ? <EyeSlash size={15} /> : <Eye size={15} />}</button>
          </div>
        </li>
      ))}
      <li className="flex items-center gap-3 px-2 py-1.5">
        <img src={dzThumb(base.url, 128)} alt="" className="h-9 w-11 flex-shrink-0 rounded-sm object-cover" />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">Base picture</span><span className="block truncate text-xs text-muted-foreground">{target?.name ? `${target.name} · ` : ""}stays untouched</span></span>
        <span className="flex h-7 w-7 items-center justify-center text-muted-foreground" aria-label="Locked"><LockSimple size={15} /></span>
      </li>
    </ul>
  );
}

function VersionsTab({ versions, base, shown, onShow, onUseAsBase, approve, isApproved }) {
  const v = versions.find((x) => x.id === shown);
  if (!versions.length) return <div className="px-6 py-6 text-center"><p className="font-semibold">No versions yet</p><p className="mt-1 text-sm text-muted-foreground">Each Generate adds a version here and to the shot's gallery.</p></div>;
  const tile = (id, url, label, status) => (
    <button key={id} type="button" onClick={() => onShow(id)} aria-pressed={shown === id}
      className={cn("relative aspect-video overflow-hidden rounded-md bg-muted outline-none ring-offset-2 ring-offset-card", shown === id ? "ring-2 ring-foreground" : "hover:ring-2 hover:ring-input")}>
      {url && <img src={dzThumb(url, 480)} alt="" className="h-full w-full object-cover" />}
      {status === "pending" && <span className="absolute inset-0 flex items-center justify-center"><Spinner className="h-5 w-5" /></span>}
      {status === "failed" && <span className="absolute inset-0 flex items-center justify-center text-destructive"><WarningCircle size={18} /></span>}
      <span className="absolute left-1.5 top-1.5 rounded-xs bg-overlay/70 px-1.5 text-xs font-semibold text-overlay-foreground">{label}</span>
    </button>
  );
  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-2">
        {tile("base", base.url, "Base", "done")}
        {versions.map((x, i) => tile(x.id, x.url, String(i + 1), x.status))}
      </div>
      {v && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={v.status !== "done"} onClick={() => onUseAsBase(v)} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"><ArrowUp size={14} />Use as the base</button>
          {approve && <button type="button" disabled={v.status !== "done"} onClick={() => approve({ url: v.url })} className={cn("flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50", v.url && isApproved(v.url) ? "border-success text-success" : "border-border")}><Check size={14} />{v.url && isApproved(v.url) ? "Approved" : "Approve"}</button>}
        </div>
      )}
    </div>
  );
}

// To model (E5, screen 14): a preview of the next request, not a history.
function ModelTab({ base, items, erasers, flat, setFlat, prompt, adapted, clearAdapted }) {
  const pics = requestPictures({ base, items, flat });
  const [preview, setPreview] = useState(null);
  const hasMarks = pics.some((p) => p.role === "marks" || p.role === "flat");
  // A small preview of the copy with the marks (or the flattened picture), redrawn as the work changes.
  useEffect(() => {
    if (!hasMarks || !base.w) { setPreview(null); return undefined; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const w = 360; const h = Math.round((w * base.h) / base.w);
        const c = await renderPicture({ base, baseSrc: dzThumb(base.url, 480), items, erasers, flat, width: w, height: h, objectSrc: (o) => dzThumb(o.url, 480) });
        if (alive) setPreview(c.toDataURL("image/jpeg", 0.8));
      } catch { if (alive) setPreview(null); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [hasMarks, base.url, base.w, base.h, items, erasers, flat]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="p-4">
      <ul className="space-y-3">
        {pics.map((p, i) => (
          <li key={`${p.role}${i}`} className="flex gap-3">
            <span className="h-[46px] w-[72px] flex-shrink-0 overflow-hidden rounded-sm bg-muted">
              {(p.role === "marks" || p.role === "flat") ? (preview && <img src={preview} alt="" className="h-full w-full object-cover" />) : <img src={dzThumb(p.url, 160)} alt="" className="h-full w-full object-cover" />}
            </span>
            <span className="min-w-0"><span className="block text-sm font-medium">{i + 1} · {p.label}</span><span className="block text-xs leading-4 text-muted-foreground">{p.detail}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm font-semibold">Prompt</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">{prompt}</p>
      {adapted && <button type="button" onClick={clearAdapted} className="mt-1 text-sm text-muted-foreground underline decoration-input underline-offset-[3px] hover:text-foreground">Adapted for this model · use my notes</button>}
      <div className="mt-5 flex items-start gap-3 border-t border-border pt-4">
        <Switch checked={flat} onCheckedChange={setFlat} aria-label="Send as one flattened picture" />
        <span><span className="block text-sm font-medium">Send as one flattened picture</span><span className="block text-xs leading-4 text-muted-foreground">For building a scene out of several pictures</span></span>
      </div>
    </div>
  );
}
