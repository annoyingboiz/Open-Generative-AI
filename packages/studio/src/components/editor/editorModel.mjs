// The picture editor's model (packages 12 and 13): numbering, what goes to the model and the prompt.
// Pure functions, no React: the editor, its composer and the tests use the same ones.
//
// Items, in the order they were made (the order is their number):
//   { id, kind: "rect" | "arrow" | "brush" | "point" | "object", note, hidden, ... }
// An object is a pasted picture ({ url, name }); every other kind is a mark.

// Mark colours are part of the picture sent to the model, so they are fixed values, the same
// in the light and the dark theme (they are content, not interface). Red is the default.
export const MARK_COLORS = [
  { id: "red", label: "Red", hex: "#EF4444" },
  { id: "yellow", label: "Yellow", hex: "#FACC15" },
  { id: "green", label: "Green", hex: "#22C55E" },
  { id: "blue", label: "Blue", hex: "#3B82F6" },
  { id: "white", label: "White", hex: "#FFFFFF" },
];
export const markHex = (id) => (MARK_COLORS.find((c) => c.id === id) || MARK_COLORS[0]).hex;
// Number circles: white with dark text (never red or orange: that reads as an error).
export const NUMBER_FILL = "#FFFFFF";
export const NUMBER_TEXT = "#111113";

export const MAX_OBJECTS = 9;
// References (package 13, C1): pictures a note points at, sent as their own files, never
// placed on the canvas. Up to 3 per note, 9 in one request.
export const MAX_REFS_PER_NOTE = 3;
export const MAX_REFS = 9;
export const KIND_NAME = { rect: "Rectangle", arrow: "Arrow", brush: "Painted area", point: "Note", object: "Object" };

export const isObject = (it) => it?.kind === "object";
export const isMark = (it) => Boolean(it) && it.kind !== "object";

// A reference lives in its note as a token "@ref_<id>" (a chip in the field); the chip shows
// "@ref1", "@ref2"… by the reference's place in the whole request. Removing the chip from the
// text removes the reference.
const TOKEN_RE = /(^|[^\p{L}\p{N}_@])@(ref_[a-z0-9]+)(?![\p{L}\p{N}_])/giu;
export const newRefId = () => `ref_${Math.random().toString(36).slice(2, 8)}`;
export const refToken = (ref) => `@${ref.id}`;
// The references a note still carries, in the order of their chips in the text.
export function liveRefs(it) {
  const refs = it?.refs || [];
  if (!refs.length) return [];
  const byId = new Map(refs.map((r) => [r.id.toLowerCase(), r]));
  const out = [];
  for (const m of String(it.note || "").matchAll(TOKEN_RE)) {
    const r = byId.get(m[2].toLowerCase());
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}
// The note with each reference token written as nameOf(ref).
export function withRefNames(text, refs, nameOf) {
  const byId = new Map((refs || []).map((r) => [r.id.toLowerCase(), r]));
  return String(text || "").replace(TOKEN_RE, (all, pre, id) => { const r = byId.get(id.toLowerCase()); return r ? `${pre}${nameOf(r)}` : all; });
}

// Numbers, object tags and reference tags for the visible items: 1, 2, 3… in order; objects
// also get @obj1, @obj2… ("Object 1"…) in their own order; references @ref1, @ref2… in note
// order. A hidden item has no number, and it and its references are not sent.
export function numbered(items) {
  let n = 0;
  let k = 0;
  let r = 0;
  return (items || []).map((it) => {
    if (it.hidden) return { ...it, n: null, tag: null, label: isObject(it) ? "Object" : KIND_NAME[it.kind], refs: liveRefs(it).map((x) => ({ ...x, tag: null })) };
    n += 1;
    const refs = liveRefs(it).map((x) => { r += 1; return { ...x, tag: `ref${r}`, n: r }; });
    if (isObject(it)) { k += 1; return { ...it, n, tag: `obj${k}`, label: `Object ${k}`, refs }; }
    return { ...it, n, tag: null, label: KIND_NAME[it.kind], refs };
  });
}
// The references of the request, in order: [{ id, url, name, tag, n, item }].
export function requestRefs(items) {
  return numbered(items).filter((it) => it.n).flatMap((it) => it.refs.map((x) => ({ ...x, item: it.n, itemId: it.id })));
}

// A note as one sentence: trimmed, one line, with a full stop when it has no ending mark.
export function sentence(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return /[.!?…:;]$/.test(t) ? t : `${t}.`;
}
const hasText = (it) => Boolean(withRefNames(it.note, it.refs, () => "x").trim());

// Counts for the bar: notes written, pictures sent.
export function summary(items, { flat = false } = {}) {
  const list = numbered(items).filter((it) => it.n);
  const marks = list.filter(isMark).length;
  const objects = list.filter(isObject).length;
  const refs = list.reduce((a, it) => a + it.refs.length, 0);
  const notes = list.filter(hasText).length;
  const pictures = flat ? 1 + refs : 1 + (marks ? 1 : 0) + objects + refs;
  return { notes, marks, objects, refs, pictures };
}

// The pictures of the next request, in order (C4): the clean base, the copy with the marks
// (only with a mark), each object, each reference. markedUrl may be null in a preview.
export function requestPictures({ base, items, flat = false, markedUrl = null, flatUrl = null }) {
  const list = numbered(items).filter((it) => it.n);
  const refs = list.flatMap((it) => it.refs.map((x) => ({ role: "reference", url: x.url, tag: x.tag, label: `Reference for note ${it.n}`, detail: "Its own file · not placed on the picture", item: it.id })));
  if (flat) return [{ role: "flat", url: flatUrl, label: "One flattened picture", detail: "Base, pictures and marks in one file, full size" }, ...refs];
  const out = [{ role: "base", url: base?.url || null, label: "Base picture", detail: base?.w ? `Clean, full size · ${base.w} × ${base.h}` : "Clean, full size" }];
  const marks = list.filter(isMark);
  if (marks.length) {
    const nums = list.map((it) => it.n);
    const range = nums.length > 1 ? `Numbers ${nums[0]}–${nums[nums.length - 1]}` : `Number ${nums[0]}`;
    out.push({ role: "marks", url: markedUrl, label: "Copy with your marks", detail: marks.some((m) => m.kind === "brush") ? `${range}. Painted areas go as an outline` : `${range} ${nums.length > 1 ? "show" : "shows"} where each note applies` });
  }
  for (const it of list.filter(isObject)) out.push({ role: "object", url: it.url, tag: it.tag, label: it.label, detail: "Its own file, full size", item: it.id });
  return [...out, ...refs];
}

// The numbered note lines. tagOf(item) → the name of an object's file, refName(ref) → the
// name of a reference's file; colon: "1. @obj1: …" (editor) or "1. @img2 …" (composer).
export function noteLines(items, { tagOf = (it) => `@${it.tag}`, refName = (x) => `@${x.tag}`, colon = true, flat = false } = {}) {
  const out = [];
  for (const it of numbered(items)) {
    if (!it.n) continue;
    const text = sentence(withRefNames(it.note, it.refs, refName));
    if (isObject(it)) {
      if (flat) { if (text) out.push(`${it.n}. ${text}`); continue; }
      const chip = tagOf(it);
      out.push(text ? `${it.n}. ${chip}${colon ? ":" : ""} ${text}` : `${it.n}. Add ${chip} here.`);
    } else if (text) out.push(`${it.n}. ${text}`);
  }
  return out;
}

// The prompt (C4). names: { base, file(i) } → how picture 1, 2… is written. The opening
// says what every sent picture is (no sentence for a picture that is not sent), then the
// notes, the general instruction and the closing line.
function buildPrompt({ items, general = "", flat = false, file }) {
  const list = numbered(items).filter((it) => it.n);
  const marks = list.filter(isMark).length;
  const objects = list.filter(isObject);
  const refs = list.flatMap((it) => it.refs.map((x) => ({ ...x, item: it.n })));
  const index = new Map();
  let p = 1;
  const head = [];
  if (flat) {
    head.push(list.length ? `Edit ${file(1)}. The numbers on it only show which note applies where.` : `Edit ${file(1)}.`);
  } else {
    head.push(`Edit ${file(1)} (the base).`);
    if (marks) { p += 1; head.push(`${file(p)} is the same picture with numbered marks: it only shows where each change goes.`); }
    for (const o of objects) { p += 1; index.set(o.id, p); head.push(`${file(p)} is an object to place.`); }
  }
  for (const x of refs) { p += 1; index.set(x.id, p); head.push(`${file(p)} is a reference for change ${x.item}.`); }
  const lines = [head.join(" ")];
  lines.push(...noteLines(items, { flat, tagOf: (it) => file(index.get(it.id)), refName: (x) => file(index.get(x.id)) }));
  const g = sentence(general);
  if (g) lines.push(g);
  const keep = `Keep the size and proportions of ${file(1)}. Keep everything else unchanged.`;
  lines.push(marks || (flat && list.length) ? `Do not draw the marks or numbers. ${keep}` : keep);
  return lines.join("\n");
}

// The prompt in words ("image 1", "image 2"…): kept with a saved copy, and the shape of the
// request as the model reads it with Nano Banana Pro.
export function editorPrompt({ items, general = "", flat = false }) {
  return buildPrompt({ items, general, flat, file: (i) => `image ${i}` }).replace(/(^|[^\d][.!?] )image /gm, "$1Image ");
}

// The prompt as it is handed to the engine: the base is @edit (sent first), then @img1,
// @img2… in the order of the files (marked copy, objects, references), and the engine writes
// each tag the way the chosen model refers to its input pictures ("image 3", "<image_3>", …;
// a sentence that opens with one gets a capital). The chips in the editor keep @obj1, @ref1.
export function requestPrompt({ items, general = "", flat = false }) {
  return buildPrompt({ items, general, flat, file: (i) => (i === 1 ? "@edit" : `@img${i - 1}`) });
}

// "Send to composer" (E7): the shot composer gets the base in Image to edit and the marked
// copy, the objects and the references in References, so its own tags are @img1 (marked
// copy), @img2… The opening and the closing line are written out: no editor will add them there.
export function composerPrompt({ items, general = "" }) {
  const list = numbered(items).filter((it) => it.n);
  const marks = list.filter(isMark).length;
  const index = new Map();
  let p = marks ? 1 : 0;
  for (const o of list.filter(isObject)) { p += 1; index.set(o.id, p); }
  const refLines = [];
  for (const it of list) for (const x of it.refs) { p += 1; index.set(x.id, p); refLines.push(`@img${p} is a reference for change ${it.n}.`); }
  const lines = [];
  const head = [...(marks ? ["@img1 is the same picture with numbered marks: it only shows where each change goes."] : []), ...refLines];
  if (head.length) lines.push(head.join(" "));
  lines.push(...noteLines(items, { tagOf: (it) => `@img${index.get(it.id)}`, refName: (x) => `@img${index.get(x.id)}`, colon: false }));
  const g = sentence(general);
  if (g) lines.push(g);
  lines.push(marks ? "Do not draw the marks or numbers. Keep everything else unchanged." : "Keep everything else unchanged.");
  return lines.join("\n");
}

// The one-line text of the collapsed bar: "1. … 2. …".
export function barText(items) {
  return numbered(items).filter((it) => it.n && (hasText(it) || isObject(it)))
    .map((it) => `${it.n}. ${isObject(it) ? `@${it.tag} ` : ""}${withRefNames(it.note, it.refs, (x) => `@${x.tag}`).replace(/\s+/g, " ").trim()}`.trim()).join("  ");
}

// Something the user would lose by closing (E7): any item, or a general instruction.
export function hasWork(items, general = "") {
  return (items || []).length > 0 || Boolean(String(general || "").trim());
}
export function workWords(items) {
  const list = numbered(items);
  const notes = list.filter(hasText).length;
  const objects = list.filter(isObject).length;
  const marks = list.filter((it) => isMark(it) && !hasText(it)).length;
  const parts = [];
  if (notes) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
  if (objects) parts.push(objects === 1 ? "an object" : `${objects} objects`);
  if (marks) parts.push(marks === 1 ? "a mark" : `${marks} marks`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "changes";
}
