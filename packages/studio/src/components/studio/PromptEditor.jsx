"use client";

// The Studio prompt (redesign 01, §5.3; Denis 19.11: tags with thumbnails).
// A contentEditable field: the prompt stays a plain string ("… @img1 …"), and
// every known @tag is drawn as a chip with its picture. The engine talks to it
// through a textarea-like object (value, selectionStart/End, setSelectionRange,
// focus), so the @ list, inserts and ⌘Enter work as before.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { dzThumb } from "../../api.js";
import { TAG_RE } from "../../dzCreate.js";
import { cn } from "../../ui/index.js";

const CHIP = "mx-px inline-flex select-none items-center gap-1 rounded-xs border border-signal/40 bg-signal/[.14] py-px pl-0.5 pr-1.5 align-[-3px] text-[15px] font-medium leading-5 text-signal";

// The prompt string of the field's DOM (chips → "@tag", line breaks → "\n").
function serialize(root) {
  let out = "";
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue.replace(/\u00a0/g, " ");
      else if (c.nodeType === 1) {
        if (c.dataset?.tag) { out += `@${c.dataset.tag}`; continue; }
        if (c.tagName === "BR") { if (!c.dataset?.end) out += "\n"; continue; }
        if (/^(DIV|P)$/.test(c.tagName) && out && !out.endsWith("\n")) out += "\n";
        walk(c);
      }
    }
  };
  walk(root);
  return out;
}
const lenOf = (n) => (n.nodeType === 3 ? n.nodeValue.length : n.dataset?.tag ? n.dataset.tag.length + 1 : n.tagName === "BR" ? (n.dataset?.end ? 0 : 1) : null);

// Caret ⇄ offset in the prompt string.
function getOffset(root) {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const box = document.createElement("div");
  box.appendChild(pre.cloneContents());
  const start = serialize(box).length;
  const pre2 = document.createRange();
  pre2.selectNodeContents(root);
  pre2.setEnd(range.endContainer, range.endOffset);
  const box2 = document.createElement("div");
  box2.appendChild(pre2.cloneContents());
  return { start, end: serialize(box2).length };
}
function setOffset(root, start, end = start) {
  const place = (target) => {
    let left = target;
    const kids = [...root.childNodes];
    for (let i = 0; i < kids.length; i += 1) {
      const c = kids[i];
      const len = lenOf(c);
      if (len == null) continue;
      if (c.nodeType === 3) {
        if (left <= len) return [c, left];
        left -= len;
        continue;
      }
      // A chip or a line break is one piece: the caret goes before or after it.
      if (left === 0) return [root, i];
      if (left < len) return [root, i + 1];
      left -= len;
    }
    return [root, kids.length - (root.lastChild?.dataset?.end ? 1 : 0)];
  };
  const sel = window.getSelection();
  if (!sel) return;
  const [sn, so] = place(start);
  const [en, eo] = place(end);
  const r = document.createRange();
  r.setStart(sn, so);
  r.setEnd(en, eo);
  sel.removeAllRanges();
  sel.addRange(r);
}

// Draw the prompt: text nodes, plus a chip for every known tag (no HTML is parsed).
function render(root, value, tagMap) {
  root.textContent = "";
  let last = 0;
  const text = String(value || "");
  for (const m of text.matchAll(TAG_RE)) {
    const name = m[2].toLowerCase();
    const t = tagMap.get(name);
    if (!t) continue;
    const at = m.index + m[1].length;
    if (at > last) root.appendChild(document.createTextNode(text.slice(last, at)));
    const chip = document.createElement("span");
    chip.dataset.tag = m[2];
    chip.contentEditable = "false";
    chip.className = CHIP;
    chip.title = t.label ? `@${m[2]} · ${t.label}` : `@${m[2]}`;
    if (t.url) {
      const img = document.createElement("img");
      img.src = dzThumb(t.url, 64);
      img.alt = "";
      img.className = "h-[18px] w-[18px] rounded-[3px] object-cover";
      chip.appendChild(img);
    }
    chip.appendChild(document.createTextNode(`@${m[2]}`));
    root.appendChild(chip);
    last = at + 1 + m[2].length;
  }
  if (last < text.length) root.appendChild(document.createTextNode(text.slice(last)));
  // An ending line break needs something after it to show the empty line.
  if (text.endsWith("\n")) { const br = document.createElement("br"); br.dataset.end = "1"; root.appendChild(br); }
}

// A known tag typed in plain text, finished (followed by a non-word character): becomes a chip.
const hasLooseTag = (root, tagMap) => [...root.childNodes].some((c) => c.nodeType === 3 && [...c.nodeValue.matchAll(TAG_RE)].some((m) => {
  if (!tagMap.has(m[2].toLowerCase())) return false;
  const end = m.index + m[0].length;
  return end < c.nodeValue.length;
}));

export default function PromptEditor({ value, onChange, tags, inputRef, json, placeholder, onKeyDown, onKeyUp, onClick, onFocus, onBlur, onPasteFiles, className, ariaProps }) {
  const composing = useRef(false);
  // A caret asked for by the engine (after an @ pick, an insert): kept for the next redraw,
  // which may come after it (React commits the new prompt later than the request).
  const wanted = useRef(null);
  const root = useRef(null);
  const emitted = useRef(null);
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.tag.toLowerCase(), t])), [tags]);
  const chipKey = useMemo(() => tags.map((t) => `${t.tag}:${t.url || ""}`).join("|"), [tags]);

  // The textarea-like face the engine uses.
  useEffect(() => {
    const api = {
      get value() { return root.current ? serialize(root.current) : ""; },
      get selectionStart() { const o = root.current && getOffset(root.current); return o ? o.start : (this.value || "").length; },
      get selectionEnd() { const o = root.current && getOffset(root.current); return o ? o.end : (this.value || "").length; },
      setSelectionRange(a, b) { wanted.current = { start: a, end: b ?? a, at: Date.now() }; if (root.current) setOffset(root.current, a, b ?? a); },
      focus() { root.current?.focus({ preventScroll: true }); },
      blur() { root.current?.blur(); },
    };
    inputRef.current = api;
    return () => { if (inputRef.current === api) inputRef.current = null; };
  }, [inputRef]);

  // Outside changes (Adapt, @ list, chat, reuse) and new tags: redraw, keeping the caret.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (value === emitted.current && el.dataset.chips === chipKey) return;
    if (composing.current && value === emitted.current) return; // new chips wait for the IME to finish
    const focused = document.activeElement === el;
    const want = wanted.current && Date.now() - wanted.current.at < 1000 ? wanted.current : null;
    const off = want || (focused ? getOffset(el) : null);
    render(el, value, tagMap);
    el.dataset.chips = chipKey;
    emitted.current = value;
    if ((focused || want) && off) setOffset(el, Math.min(off.start, value.length), Math.min(off.end, value.length));
  }, [value, chipKey, tagMap]);

  const emit = (next) => { emitted.current = next; onChange(next); };
  // Typed edits go through the browser (so ⌘Z undoes them); the rest redraws.
  const insertNative = (text) => (typeof document !== "undefined" && document.execCommand ? document.execCommand("insertText", false, text) : false);
  const replaceSelection = (text) => {
    wanted.current = null;
    if (!text.includes("\n") && insertNative(text)) return;
    const el = root.current;
    const v = serialize(el);
    const off = getOffset(el) || { start: v.length, end: v.length };
    const next = v.slice(0, off.start) + text + v.slice(off.end);
    render(el, next, tagMap);
    setOffset(el, off.start + text.length);
    emit(next);
  };

  return (
    <div
      ref={root}
      role="textbox"
      aria-multiline="true"
      aria-label="Prompt"
      aria-placeholder={placeholder}
      contentEditable
      suppressContentEditableWarning
      spellCheck={!json}
      data-placeholder={placeholder}
      {...ariaProps}
      className={cn("custom-scrollbar max-h-[330px] min-h-[44px] overflow-y-auto whitespace-pre-wrap break-words outline-none",
        "empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]", json ? "font-mono text-[13px] leading-5" : "text-prompt", className)}
      onInput={(e) => {
        const el = root.current;
        wanted.current = null;
        let next = serialize(el);
        // Blocks or line breaks the browser made (drop, autocorrect): back to flat text + chips.
        const messy = [...el.childNodes].some((c) => c.nodeType === 1 && !c.dataset?.tag && !c.dataset?.end);
        if (!e.nativeEvent.isComposing && !composing.current && (messy || hasLooseTag(el, tagMap))) {
          const off = getOffset(el);
          render(el, next, tagMap);
          if (off) setOffset(el, off.start, off.end);
          next = serialize(el);
        }
        // An emptied field keeps no stray <br>, so the placeholder shows.
        if (!next) el.textContent = "";
        emit(next);
      }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; const el = root.current; if (el && hasLooseTag(el, tagMap)) { const off = getOffset(el); const v = serialize(el); render(el, v, tagMap); if (off) setOffset(el, off.start, off.end); emit(v); } }}
      onKeyDown={(e) => {
        // While an IME composes, Enter picks its candidate: leave the keys to it.
        if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) return;
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); replaceSelection("\n"); }
      }}
      onKeyUp={onKeyUp}
      onMouseDown={() => { wanted.current = null; }}
      onClick={onClick}
      onFocus={onFocus}
      onBlur={onBlur}
      onPaste={(e) => {
        e.preventDefault();
        const files = Array.from(e.clipboardData?.files || []);
        if (files.length) { onPasteFiles?.(files); return; }
        const text = e.clipboardData?.getData("text/plain") || "";
        if (text) replaceSelection(text.replace(/\r\n?/g, "\n"));
      }}
      onDrop={(e) => { if (e.dataTransfer?.files?.length) return; e.preventDefault(); const t = e.dataTransfer?.getData("text/plain"); if (t) replaceSelection(t); }}
    />
  );
}
