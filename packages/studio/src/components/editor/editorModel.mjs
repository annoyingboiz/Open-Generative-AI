// The picture editor's model (package 12): numbering, what goes to the model and the prompt.
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
export const KIND_NAME = { rect: "Rectangle", arrow: "Arrow", brush: "Painted area", point: "Note", object: "Picture" };

export const isObject = (it) => it?.kind === "object";
export const isMark = (it) => Boolean(it) && it.kind !== "object";

// Numbers and object tags for the visible items: 1, 2, 3… in order; objects also get
// @obj1, @obj2… in their own order. A hidden item has no number and is not sent.
export function numbered(items) {
  let n = 0;
  let k = 0;
  return (items || []).map((it) => {
    if (it.hidden) return { ...it, n: null, tag: null };
    n += 1;
    if (isObject(it)) { k += 1; return { ...it, n, tag: `obj${k}` }; }
    return { ...it, n, tag: null };
  });
}

// A note as one sentence: trimmed, one line, with a full stop when it has no ending mark.
export function sentence(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return /[.!?…:;]$/.test(t) ? t : `${t}.`;
}

// Counts for the bar: notes written, pictures sent.
export function summary(items, { flat = false } = {}) {
  const list = numbered(items).filter((it) => it.n);
  const marks = list.filter(isMark).length;
  const objects = list.filter(isObject).length;
  const notes = list.filter((it) => String(it.note || "").trim()).length;
  const pictures = flat ? 1 : 1 + (marks ? 1 : 0) + objects;
  return { notes, marks, objects, pictures };
}

// The pictures of the next request, in order (E5). Marked copy only with at least one mark.
// base: { url, w, h }; objects carry their own url. markedUrl may be null in a preview.
export function requestPictures({ base, items, flat = false, markedUrl = null, flatUrl = null }) {
  const list = numbered(items).filter((it) => it.n);
  if (flat) return [{ role: "flat", url: flatUrl, label: "One flattened picture", detail: "Base, pictures and marks in one file, full size" }];
  const out = [{ role: "base", url: base?.url || null, label: "Base picture", detail: base?.w ? `Clean, full size · ${base.w} × ${base.h}` : "Clean, full size" }];
  const marks = list.filter(isMark);
  if (marks.length) {
    const nums = list.filter((it) => it.n).map((it) => it.n);
    const range = nums.length > 1 ? `Numbers ${nums[0]}–${nums[nums.length - 1]}` : `Number ${nums[0]}`;
    out.push({ role: "marks", url: markedUrl, label: "Copy with your marks", detail: `${range} show where each note applies` });
  }
  for (const it of list.filter(isObject)) out.push({ role: "object", url: it.url, tag: it.tag, label: `Object: ${it.name || "Picture"}`, detail: "Its own file, full size", item: it.id });
  return out;
}

// The numbered note lines. tagOf(item) → the chip text for an object ("@obj1" in the editor,
// "@img2" in the shot composer); colon: "1. @obj1: …" (editor) or "1. @img2 …" (composer).
export function noteLines(items, { tagOf = (it) => `@${it.tag}`, colon = true, flat = false } = {}) {
  const out = [];
  for (const it of numbered(items)) {
    if (!it.n) continue;
    const text = sentence(it.note);
    if (isObject(it)) {
      if (flat) { if (text) out.push(`${it.n}. ${text}`); continue; }
      const chip = tagOf(it);
      out.push(text ? `${it.n}. ${chip}${colon ? ":" : ""} ${text}` : `${it.n}. Add ${chip} here.`);
    } else if (text) out.push(`${it.n}. ${text}`);
  }
  return out;
}

// The prompt the model gets (E5). The first and the last line are the editor's.
export function editorPrompt({ items, general = "", flat = false }) {
  const list = numbered(items).filter((it) => it.n);
  const marks = list.filter(isMark).length;
  const objects = list.filter(isObject);
  const lines = [];
  if (flat) {
    lines.push(list.length ? "Edit picture 1. The numbers on it only show which note applies where." : "Edit picture 1.");
  } else {
    let first = "Edit picture 1 (the base).";
    let p = 2;
    if (marks) { first += " Picture 2 is the same picture with numbered marks: it only shows where each change goes."; p = 3; }
    for (const o of objects) { first += ` Picture ${p} is @${o.tag}.`; p += 1; }
    lines.push(first);
  }
  lines.push(...noteLines(items, { flat }));
  const g = sentence(general);
  if (g) lines.push(g);
  lines.push(marks || (flat && list.length) ? "Do not draw the marks or numbers. Keep everything else unchanged." : "Keep everything else unchanged.");
  return lines.join("\n");
}

// "Send to composer" (E7): the shot composer gets the base in Image to edit and the marked
// copy plus the objects in References, so its own tags are @img1 (marked copy), @img2…
// The first and the last line are written out: no editor will add them there.
export function composerPrompt({ items, general = "" }) {
  const list = numbered(items).filter((it) => it.n);
  const marks = list.filter(isMark).length;
  const offset = marks ? 1 : 0;
  const objIndex = new Map(list.filter(isObject).map((o, i) => [o.id, i + 1 + offset]));
  const lines = [];
  if (marks) lines.push("@img1 is the same picture with numbered marks: it only shows where each change goes.");
  lines.push(...noteLines(items, { tagOf: (it) => `@img${objIndex.get(it.id)}`, colon: false }));
  const g = sentence(general);
  if (g) lines.push(g);
  lines.push(marks ? "Do not draw the marks or numbers. Keep everything else unchanged." : "Keep everything else unchanged.");
  return lines.join("\n");
}

// The one-line text of the collapsed bar: "1. … 2. …".
export function barText(items) {
  return numbered(items).filter((it) => it.n && (String(it.note || "").trim() || isObject(it)))
    .map((it) => `${it.n}. ${isObject(it) ? `@${it.tag} ` : ""}${String(it.note || "").replace(/\s+/g, " ").trim()}`.trim()).join("  ");
}

// Something the user would lose by closing (E7): any item, or a general instruction.
export function hasWork(items, general = "") {
  return (items || []).length > 0 || Boolean(String(general || "").trim());
}
export function workWords(items) {
  const list = numbered(items);
  const notes = list.filter((it) => String(it.note || "").trim()).length;
  const objects = list.filter(isObject).length;
  const marks = list.filter((it) => isMark(it) && !String(it.note || "").trim()).length;
  const parts = [];
  if (notes) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
  if (objects) parts.push(objects === 1 ? "an object" : `${objects} objects`);
  if (marks) parts.push(marks === 1 ? "a mark" : `${marks} marks`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "changes";
}
