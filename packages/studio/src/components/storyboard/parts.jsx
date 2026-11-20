"use client";

// Small shared parts of the Storyboard (package 05).
import { useEffect, useRef, useState } from "react";
import { LibraryWindow } from "../studio/Library.jsx";
import { sizeOf } from "../../dzFilm.js";
import { uploadFile } from "../../api.js";
import { cn } from "../../ui/index.js";

// Our own media URL without the origin (the server keeps /media/… only).
export const mediaUrl = (u) => String(u || "").replace(/^https?:\/\/[^/]+(?=\/media\/)/, "");

// Files from the computer → our own files with their sizes (pictures and videos only).
export async function uploadAll(files) {
  const list = [...files].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
  const out = [];
  for (const f of list) {
    const url = mediaUrl(await uploadFile("session", f));
    const kind = f.type.startsWith("video/") ? "video" : "image";
    const { w, h } = await sizeOf(url, kind);
    out.push({ url, kind, w, h, name: f.name.slice(0, 80) });
  }
  return out;
}

// The existing empty-state pattern (icon tile, title, text, actions).
export function EmptyState({ icon: Icon, title, text, children, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-20 text-center", className)}>
      {Icon && <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Icon size={20} /></span>}
      <p className="text-lg font-semibold">{title}</p>
      {text && <p className="max-w-md text-muted-foreground">{text}</p>}
      {children && <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

// Text that edits in place on click; Enter or leaving saves, Esc cancels.
export function InlineText({ value, onChange, placeholder, className, maxLength = 200 }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const input = useRef(null);
  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const done = (save) => { setEditing(false); if (save && draft.trim() !== (value || "")) onChange(draft.trim()); };
  if (editing) {
    return (
      <input ref={input} value={draft} maxLength={maxLength} onChange={(e) => setDraft(e.target.value)} onBlur={() => done(true)}
        onKeyDown={(e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") { e.stopPropagation(); done(false); } }}
        className={cn("min-w-[120px] rounded-sm bg-transparent outline-none ring-1 ring-input", className)} aria-label={placeholder} />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className={cn("truncate rounded-sm text-left hover:bg-accent/60", !value && "text-muted-foreground", className)}>
      {value || placeholder}
    </button>
  );
}

const REF_GROUPS = [
  { id: "reference", label: "Pictures", roles: ["reference"], kind: "image", max: 100, roleMax: { reference: 100 } },
  { id: "video", label: "Videos", roles: ["video"], kind: "video", max: 100, roleMax: { video: 100 } },
];

// The existing reference picker (library window: Uploads, Generations, Liked, Elements)
// for a shot's or a group's references. `refs` in order; new ones are added at the end
// with their sizes (`onChange` gets a list, or a function of the current list).
// `onPickNew`: instead, every picked file becomes a new shot (on Done).
export function RefPicker({ open, onClose, refs = [], onChange, onPickNew = null, title }) {
  const [groupId, setGroupId] = useState("reference");
  const [picked, setPicked] = useState([]);
  useEffect(() => { if (open) { setPicked([]); setGroupId("reference"); } }, [open]);
  const list = onPickNew ? picked : refs;
  const attached = { reference: list.filter((r) => r.kind !== "video").map((r) => ({ url: r.url, name: r.name || "" })), video: list.filter((r) => r.kind === "video").map((r) => ({ url: r.url, name: r.name || "" })) };
  const setAttached = (fn) => {
    const next = typeof fn === "function" ? fn(attached) : fn;
    const urls = [...(next.reference || []).map((f) => ({ ...f, kind: "image" })), ...(next.video || []).map((f) => ({ ...f, kind: "video" }))].map((f) => ({ ...f, url: mediaUrl(f.url) }));
    const keep = list.filter((r) => urls.some((u) => u.url === r.url));
    const added = urls.filter((u) => !list.some((r) => r.url === u.url)).map((u) => ({ url: u.url, kind: u.kind, name: u.name || "" }));
    const result = [...keep, ...added];
    if (onPickNew) setPicked(result); else onChange(result);
    // Sizes for the new ones (their own aspect ratio), then saved again.
    if (added.length) {
      Promise.all(added.map(async (r) => ({ ...r, ...(await sizeOf(r.url, r.kind)) }))).then((sized) => {
        const withSize = (arr) => arr.map((r) => sized.find((s) => s.url === r.url) || r);
        if (onPickNew) setPicked((p) => withSize(p)); else onChange((cur) => withSize(cur));
      });
    }
  };
  const close = () => { if (onPickNew && picked.length) onPickNew(picked); onClose(); };
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-scrim" onClick={close} aria-hidden="true" />
      <div className="fixed bottom-6 left-1/2 z-50 h-0 w-[min(1040px,calc(100vw-48px))] -translate-x-1/2" aria-label={title || "References"}>
        <LibraryWindow open groups={REF_GROUPS} groupId={groupId} setGroupId={setGroupId} attached={attached} setAttached={setAttached} onClose={close} title={title || null}
          onError={(m) => window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "error", title: "Upload", message: m } }))} />
      </div>
    </>
  );
}
