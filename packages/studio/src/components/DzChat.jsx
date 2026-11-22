"use client";

// DZ: assistants and their chats (package 15). One layout in two forms: the Chat page
// (left: the tree assistant → its chats; right: the assistant page or a chat) and the drawer
// from the top bar (the same tree, 280 px, and the chat column, 560 px). Every chat belongs
// to one assistant. Answers can go into the prompt of a composer ("Insert into prompt").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CaretRight, CaretDown, Plus, DotsThree, MagnifyingGlass, MagicWand, FilmSlate, ImageSquare, ChatCircle, Translate,
  PencilSimple, Copy, Trash, SidebarSimple, ArrowsOut, X, Paperclip, Microphone, ArrowUp, Check, Target, FileText,
} from "@phosphor-icons/react";
import { dzThumb } from "../api.js";
import { useDzContext } from "../dzContext.js";
import { useDzTextModelOptions } from "../dzLlm.js";
import { dzStoryboards } from "../dzDirector.js";
import { DzMediaPicker } from "./DzMedia.jsx";
import { Button, Textarea, Input, Spinner, Switch, OptionSelect, Segmented, Tip, cn, SidePanel, DropdownMenuParts } from "../ui/index.js";
import { dzScrollBoxRef } from "../dzScroll.js";
import { Chip, ChipMenu, MenuRow, fmtDur } from "./studio/ui.jsx";
import { EmptyState } from "./storyboard/parts.jsx";
import { extractPdfText } from "./dzPdf.js";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } = DropdownMenuParts;

const PLACE_KEY = { page: "dz_chat_place_page", drawer: "dz_chat_place_drawer" };
const OPEN_KEY = "dz_chat_open_assistants";
const TREE_KEY = "dz_chat_tree_hidden";
const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* optional */ } };

const dayOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const when = (t) => {
  const d = new Date(t);
  return dayOf(t) === dayOf(Date.now()) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
};
const money = (v) => (v == null ? "" : v === 0 ? "free" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function call(method, url, body) {
  const res = await fetch(url, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  return data;
}
const enc = encodeURIComponent;
export const dzAssistants = {
  list: (project) => call("GET", `/dz/api/assistants${project ? `?project=${enc(project)}` : ""}`),
  create: (data) => call("POST", "/dz/api/assistants", data),
  update: (id, data) => call("PATCH", `/dz/api/assistants/${enc(id)}`, data),
  remove: (id) => call("DELETE", `/dz/api/assistants/${enc(id)}`),
  duplicate: (id) => call("POST", `/dz/api/assistants/${enc(id)}/duplicate`),
  addFile: (id, data) => call("POST", `/dz/api/assistants/${enc(id)}/files`, data),
  fileText: (id, fileId) => call("GET", `/dz/api/assistants/${enc(id)}/files/${enc(fileId)}`),
  removeFile: (id, fileId) => call("DELETE", `/dz/api/assistants/${enc(id)}/files/${enc(fileId)}`),
  chats: (id) => call("GET", `/dz/api/assistants/${enc(id)}/chats`),
  newChat: (id) => call("POST", `/dz/api/assistants/${enc(id)}/chats`),
  chat: (id) => call("GET", `/dz/api/chats/${enc(id)}`),
  rename: (id, title) => call("PATCH", `/dz/api/chats/${enc(id)}`, { title }),
  removeChat: (id) => call("DELETE", `/dz/api/chats/${enc(id)}`),
  restoreChat: (id) => call("POST", `/dz/api/chats/${enc(id)}/restore`),
  send: (id, data) => call("POST", `/dz/api/chats/${enc(id)}/messages`, data),
};

const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));
const notifyError = (message, title = "Chat") => notify({ type: "error", title, message });

// An assistant's icon follows the template it was made from.
const ICONS = { "prompt-writer": MagicWand, "shot-list": FilmSlate, "reference-breakdown": ImageSquare, chat: ChatCircle };
const iconOf = (a) => ICONS[a?.template] || (/translat|dialog|ru to|en to/i.test(a?.name || "") ? Translate : ChatCircle);
function AssistantIcon({ a, size = "sm" }) {
  const Icon = iconOf(a);
  return (
    <span className={cn("flex shrink-0 items-center justify-center border border-border bg-accent text-foreground",
      size === "lg" ? "h-11 w-11 rounded-lg" : size === "md" ? "h-5 w-5 rounded-[6px]" : "h-[22px] w-[22px] rounded-[6px]")}>
      <Icon size={size === "lg" ? 20 : 13} />
    </span>
  );
}

// ── Answers (unchanged from before) ────────────────────────────────────────
// An answer: text and fenced code blocks (prompts) — no HTML from the model.
function splitAnswer(text) {
  const parts = [];
  const re = /```[^\n`]*\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    parts.push({ kind: "code", text: m[1].replace(/\n$/, "") });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts.filter((p) => p.text.trim());
}
function Inline({ text }) {
  const bits = text.split(/(\*\*[^*\n]+\*\*)/g);
  return bits.map((b, i) => (/^\*\*[^*\n]+\*\*$/.test(b) ? <strong key={i}>{b.slice(2, -2)}</strong> : <span key={i}>{b}</span>));
}
function InsertButtons({ text, canInsert, onInsert, small }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* not allowed */ } };
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", small && "mt-1.5")}>
      {canInsert && (
        <>
          <Button size="sm" className="h-8 rounded-lg" onClick={() => onInsert(text, "append")}>Insert into prompt</Button>
          <Button size="sm" variant="secondary" className="h-8 rounded-lg" onClick={() => onInsert(text, "replace")}>Replace prompt</Button>
        </>
      )}
      <Button size="sm" variant="ghost" className="h-8 rounded-lg" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}
function Message({ m, assistant, canInsert, onInsert, onOpen }) {
  if (m.role === "user") {
    return (
      <div className="ml-auto max-w-[84%] space-y-2 rounded-2xl rounded-br-md bg-accent px-3 py-2.5">
        {m.images?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {m.images.map((u) => <button key={u} type="button" onClick={() => onOpen(u)}><img src={dzThumb(u, 160)} alt="" className="h-14 w-14 rounded-lg object-cover" /></button>)}
          </div>
        )}
        {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
      </div>
    );
  }
  if (m.error) return <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-destructive">{m.error}</div>;
  const parts = splitAnswer(m.content || "");
  const codes = parts.filter((p) => p.kind === "code");
  return (
    <div className="space-y-2.5">
      {assistant && <p className="flex items-center gap-2 text-sm text-muted-foreground"><AssistantIcon a={assistant} size="md" />{assistant.name}</p>}
      {parts.map((p, i) => (p.kind === "code" ? (
        <div key={i} className="rounded-xl border border-border bg-overlay/40 p-3">
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[15px] leading-relaxed text-foreground/90">{p.text}</pre>
          <InsertButtons text={p.text} canInsert={canInsert} onInsert={onInsert} small />
        </div>
      ) : (
        <p key={i} className="whitespace-pre-wrap break-words leading-relaxed text-foreground/90"><Inline text={p.text.trim()} /></p>
      )))}
      {codes.length === 0 && m.content && <InsertButtons text={m.content} canInsert={canInsert} onInsert={onInsert} />}
      <p className="text-right text-sm text-muted-foreground">{[m.model?.replace(/^[a-z]+:/, ""), money(m.costUsd), m.ms ? `${(m.ms / 1000).toFixed(1)} s` : ""].filter(Boolean).join(" · ")}</p>
    </div>
  );
}
// "Copy the whole chat": plain text, one block per message.
const chatAsText = (chat, assistant) => (chat?.messages || []).filter((m) => !m.error)
  .map((m) => `${m.role === "user" ? "You" : assistant?.name || "Assistant"}:\n${m.content || ""}${m.images?.length ? `\n[${plural(m.images.length, "picture")}]` : ""}`).join("\n\n");

// ── Data: the assistants of this place and your chats with them ───────────
function useChatData(projectId, active) {
  const [data, setData] = useState({ personal: [], project: [], chats: [], loaded: false });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try { const r = await dzAssistants.list(projectId); if (mine === seq.current) setData({ ...r, chats: r.chats || [], loaded: true }); return r; } catch (e) { if (mine === seq.current) { notifyError(String(e.message || e)); setData((d) => ({ ...d, loaded: true })); } return null; }
  }, [projectId]);
  useEffect(() => { setData({ personal: [], project: [], chats: [], loaded: false }); }, [projectId]);
  useEffect(() => { if (active) reload(); }, [active, reload]);
  useEffect(() => {
    const on = () => reload();
    window.addEventListener("dz:chats-changed", on);
    return () => window.removeEventListener("dz:chats-changed", on);
  }, [reload]);
  const assistants = useMemo(() => [...data.project, ...data.personal], [data]);
  const chatsOf = useCallback((aid) => data.chats.filter((c) => c.assistant_id === aid), [data.chats]);
  return { ...data, assistants, chatsOf, reload, setData };
}
// Tell the other form (page / drawer) that the lists changed.
const changed = () => window.dispatchEvent(new CustomEvent("dz:chats-changed"));

// ── The tree (C1) ─────────────────────────────────────────────────────────
function Tree({ data, place, go, newAssistantOpen, className }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(() => new Set(readJson(OPEN_KEY, [])));
  const toggle = (id, force) => setOpen((s) => {
    const n = new Set(s);
    if (force === true || (force === undefined && !n.has(id))) n.add(id); else n.delete(id);
    writeJson(OPEN_KEY, [...n]);
    return n;
  });
  const needle = q.trim().toLowerCase();
  const rows = data.assistants.map((a) => {
    const all = data.chatsOf(a.id);
    if (!needle) return { a, chats: all.slice(0, 3), total: all.length, show: true };
    const hits = all.filter((c) => String(c.title).toLowerCase().includes(needle));
    const named = a.name.toLowerCase().includes(needle);
    return { a, chats: hits, total: all.length, show: named || hits.length > 0, searching: true };
  }).filter((r) => r.show);
  const selectedA = place.view === "assistant" ? place.assistantId : null;
  return (
    <aside className={cn("flex min-h-0 flex-col gap-0.5 overflow-hidden border-r border-border p-3", className)}>
      <label className="mb-2 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border px-2.5 text-muted-foreground focus-within:border-input">
        <MagnifyingGlass size={14} className="shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assistants and chats" aria-label="Search assistants and chats"
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground" />
        {q && <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>}
      </label>
      <div className="mt-3 flex h-7 shrink-0 items-center pl-2.5 pr-1.5 text-overline uppercase text-muted-foreground">
        Assistants
        <Tip text="New assistant"><button type="button" aria-label="New assistant" onClick={() => go({ view: "new-assistant" })}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"><Plus size={14} /></button></Tip>
      </div>
      <nav aria-label="Assistants and chats" ref={dzScrollBoxRef} className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 custom-scrollbar">
        {!data.loaded && <div className="flex justify-center py-6"><Spinner /></div>}
        {data.loaded && rows.length === 0 && <p className="px-2.5 py-3 text-sm text-muted-foreground">{needle ? "Nothing found." : "No assistants yet. Make one with the plus."}</p>}
        {rows.map(({ a, chats, total, searching }) => {
          const expanded = searching ? true : open.has(a.id);
          const sel = selectedA === a.id;
          return (
            <div key={a.id}>
              <div className={cn("group flex h-9 min-w-0 items-center gap-2 rounded-lg pl-1 pr-1.5 text-base transition-colors duration-state", sel ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                <button type="button" aria-label={expanded ? `Collapse ${a.name}` : `Expand ${a.name}`} aria-expanded={expanded} onClick={() => toggle(a.id)}
                  className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground">
                  {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                </button>
                <button type="button" onClick={() => { toggle(a.id, true); go({ view: "assistant", assistantId: a.id, tab: "chats" }); }} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <AssistantIcon a={a} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                </button>
                {sel ? <AssistantMenu a={a} chatCount={total} go={go} /> : <span className="shrink-0 pr-1 text-sm tabular-nums text-muted-foreground">{total || ""}</span>}
              </div>
              {expanded && (
                <div className="mb-1 ml-[14px] flex flex-col gap-px border-l border-border pl-2.5">
                  {!searching && (
                    <button type="button" onClick={() => go({ view: "chat", assistantId: a.id, chatId: null })}
                      className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors duration-state",
                        place.view === "chat" && place.assistantId === a.id && !place.chatId ? "bg-muted font-medium text-foreground" : "text-foreground hover:bg-accent")}>
                      <Plus size={13} className="shrink-0" />New chat
                    </button>
                  )}
                  {chats.map((c) => (
                    <button key={c.id} type="button" onClick={() => go({ view: "chat", assistantId: a.id, chatId: c.id })}
                      className={cn("flex h-8 min-w-0 items-center rounded-lg px-2.5 text-left text-sm transition-colors duration-state",
                        place.view === "chat" && place.chatId === c.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                      <span className="truncate">{c.title}</span>
                    </button>
                  ))}
                  {!searching && total > 3 && (
                    <button type="button" onClick={() => go({ view: "assistant", assistantId: a.id, tab: "chats" })}
                      className="flex h-8 items-center rounded-lg px-2.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground">All {total} chats</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {newAssistantOpen && (
          <div className="flex h-9 items-center gap-2.5 rounded-lg bg-muted pl-6 pr-2 text-base font-medium text-foreground">
            <span className="flex h-[22px] w-[22px] items-center justify-center"><Plus size={14} /></span>New assistant
          </div>
        )}
      </nav>
    </aside>
  );
}

// ── Menus (C3, C5) ────────────────────────────────────────────────────────
function MoreButton({ label, className }) {
  return (
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={label} className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-state hover:bg-accent hover:text-foreground data-[state=open]:bg-accent", className)}>
        <DotsThree size={18} weight="bold" />
      </button>
    </DropdownMenuTrigger>
  );
}
function AssistantMenu({ a, chatCount, go, className }) {
  const duplicate = async () => {
    try { const r = await dzAssistants.duplicate(a.id); changed(); go({ view: "assistant", assistantId: r.assistant.id, tab: "settings" }); } catch (e) { notifyError(String(e.message || e)); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${a.name}” with its ${plural(chatCount, "chat")}? This can't be undone.`)) return;
    try { await dzAssistants.remove(a.id); changed(); go({ view: "home" }); } catch (e) { notifyError(String(e.message || e)); }
  };
  return (
    <DropdownMenu>
      <MoreButton label={`${a.name}: more`} className={cn("h-6 w-6", className)} />
      <DropdownMenuContent align="end" className="w-60 p-1.5">
        <DropdownMenuItem className="h-9 gap-2.5" onSelect={duplicate}><Copy size={16} />Duplicate</DropdownMenuItem>
        {!a.builtin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="h-9 gap-2.5 text-destructive focus:text-destructive" onSelect={remove}><Trash size={16} />Delete with its {plural(chatCount, "chat")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
// Delete at once, with Undo (package 14, A5).
async function deleteChat(c, after) {
  try {
    await dzAssistants.removeChat(c.id);
    changed();
    after?.();
    notify({ type: "notice", title: "Chat deleted", undo: async () => { try { await dzAssistants.restoreChat(c.id); changed(); } catch (e) { notifyError(String(e.message || e)); } } });
  } catch (e) { notifyError(String(e.message || e)); }
}
// The text is written in the same click (Safari allows the clipboard only there): a chat that
// still has to be read goes in as a promise.
async function copyChat(chatOrId, assistant) {
  try {
    if (typeof chatOrId === "string" && typeof window.ClipboardItem === "function" && navigator.clipboard?.write) {
      const blob = dzAssistants.chat(chatOrId).then((r) => new Blob([chatAsText(r.chat, assistant)], { type: "text/plain" }));
      await navigator.clipboard.write([new window.ClipboardItem({ "text/plain": blob })]);
    } else {
      const chat = typeof chatOrId === "string" ? (await dzAssistants.chat(chatOrId)).chat : chatOrId;
      await navigator.clipboard.writeText(chatAsText(chat, assistant));
    }
    notify({ type: "success", title: "Chat copied", message: "The whole chat is on the clipboard." });
  } catch (e) {
    console.warn("copy chat:", e?.message || e);
    notifyError("The browser did not allow the clipboard. Try again.", "Copy the whole chat");
  }
}
function ChatMenu({ onRename, onCopy, onDelete, className, align = "end" }) {
  // Rename puts the cursor in the title: the menu must not take the focus back when it closes.
  const renaming = useRef(false);
  return (
    <DropdownMenu>
      <MoreButton label="Chat menu" className={className} />
      <DropdownMenuContent align={align} className="w-56 p-1.5" onCloseAutoFocus={(e) => { if (renaming.current) { e.preventDefault(); renaming.current = false; } }}>
        <DropdownMenuItem className="h-9 gap-2.5" onSelect={() => { renaming.current = true; onRename(); }}><PencilSimple size={16} />Rename</DropdownMenuItem>
        <DropdownMenuItem className="h-9 gap-2.5" onSelect={onCopy}><Copy size={16} />Copy the whole chat</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-9 gap-2.5 text-destructive focus:text-destructive" onSelect={onDelete}><Trash size={16} />Delete chat</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
// A title that edits in place (Enter saves, Esc cancels).
function RenameField({ value, onDone, className }) {
  const [v, setV] = useState(value);
  const ref = useRef(null);
  useEffect(() => { const t = setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 30); return () => clearTimeout(t); }, []);
  const done = (save) => onDone(save && v.trim() && v.trim() !== value ? v.trim() : null);
  return (
    <input ref={ref} data-dz-esc-local="1" value={v} onChange={(e) => setV(e.target.value)} maxLength={120} aria-label="Chat title"
      onKeyDown={(e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") { e.stopPropagation(); done(false); } }} onBlur={() => done(true)}
      className={cn("min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-0.5 font-semibold text-foreground outline-none", className)} />
  );
}

// ── Assistant page (C2) and its form (C4) ────────────────────────────────
const groupOf = (t) => { const d = dayOf(t); const today = dayOf(Date.now()); return d === today ? "Today" : d === today - 86_400_000 ? "Yesterday" : "Earlier"; };

function ChatList({ assistant, chats, go }) {
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState(null);
  const list = chats.filter((c) => !q.trim() || String(c.title).toLowerCase().includes(q.trim().toLowerCase()));
  const groups = [];
  for (const c of list) { const g = groupOf(c.updated_at); const last = groups[groups.length - 1]; if (last?.name === g) last.items.push(c); else groups.push({ name: g, items: [c] }); }
  if (!chats.length) {
    return (
      <EmptyState icon={ChatCircle} title={`No chats with ${assistant.name} yet`} text="Every chat you start with this assistant is kept here." className="py-24">
        <Button onClick={() => go({ view: "chat", assistantId: assistant.id, chatId: null })}><Plus size={14} className="mr-1.5" />New chat</Button>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-1 px-6 py-4">
      <label className="mb-2 flex h-9 max-w-[420px] items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-input">
        <MagnifyingGlass size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in these chats" aria-label="Search in these chats" className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground" />
      </label>
      {list.length === 0 && <p className="py-4 text-muted-foreground">No chat has that in its title.</p>}
      {groups.map((g) => (
        <div key={g.name}>
          <p className="px-0 pb-1 pt-4 text-sm text-muted-foreground">{g.name}</p>
          {g.items.map((c) => (
            <div key={c.id} className="group -mx-3 flex h-12 items-center gap-2 rounded-lg px-3 transition-colors duration-state hover:bg-muted">
              {renaming === c.id
                ? <RenameField value={c.title} onDone={async (t) => { setRenaming(null); if (t) { try { await dzAssistants.rename(c.id, t); changed(); } catch (e) { notifyError(String(e.message || e)); } } }} />
                : <button type="button" onClick={() => go({ view: "chat", assistantId: assistant.id, chatId: c.id })} className="min-w-0 flex-1 truncate text-left text-base">{c.title}</button>}
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{when(c.updated_at)}</span>
              <ChatMenu className="opacity-0 focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                onRename={() => setRenaming(c.id)} onCopy={() => copyChat(c.id, assistant)} onDelete={() => deleteChat(c)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Knowledge files from the computer: text, Markdown and PDF (text read in the browser).
async function readKnowledgeFile(f) {
  if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") return { name: f.name, text: await extractPdfText(f) };
  if (f.size > 400_000) throw new Error(`${f.name} is too big (text files up to ~100k characters).`);
  return { name: f.name, text: await f.text() };
}

function AssistantForm({ assistant, modelOptions, apiKey, onCreated, onSaved, onCancel, go, templates = [], projectId = null, projectName = "", projectReadOnly = false }) {
  const isNew = !assistant;
  // New assistant: an optional template (its rules are filled in on the server unless you write
  // your own) and, inside a project, where it lives (Library is yours; a project's is shared).
  const [template, setTemplate] = useState("");
  const [scope, setScope] = useState("library");
  const [reading, setReading] = useState(0); // files still being read: Create waits for them
  const [form, setForm] = useState({ name: assistant?.name || "", description: assistant?.description || "", rules: assistant?.rules || "", model: assistant?.model || "", modelNotes: assistant ? assistant.modelNotes : true });
  const [files, setFiles] = useState(assistant?.files || []);
  const [queued, setQueued] = useState([]); // New assistant: files wait for Create
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileInput = useRef(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (assistant) setFiles(assistant.files || []); }, [assistant]);
  const upload = async (id, item) => (await dzAssistants.addFile(id, item)).assistant;
  const addText = async (list) => {
    for (const f of [...list]) {
      setReading((n) => n + 1);
      try {
        const item = await readKnowledgeFile(f);
        if (isNew) setQueued((q) => [...q, { ...item, kind: "text", key: `${f.name}-${Date.now()}` }]);
        else { const a = await upload(assistant.id, item); setFiles(a.files); changed(); }
      } catch (e) { notifyError(String(e.message || e)); } finally { setReading((n) => n - 1); }
    }
  };
  const addImages = async (list) => {
    for (const x of list) {
      try {
        const item = { url: x.url, name: x.name || "Picture" };
        if (isNew) setQueued((q) => [...q, { ...item, kind: "image", key: `${x.url}-${Date.now()}` }]);
        else { const a = await upload(assistant.id, item); setFiles(a.files); changed(); }
      } catch (e) { notifyError(String(e.message || e)); }
    }
  };
  const removeFile = async (fid) => {
    try { const r = await dzAssistants.removeFile(assistant.id, fid); setFiles(r.assistant.files); changed(); } catch (e) { notifyError(String(e.message || e)); }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        const body = { project: scope === "project" && projectId ? projectId : null, ...form };
        if (template) { body.template = template; if (!form.rules.trim()) delete body.rules; }
        const r = await dzAssistants.create(body);
        for (const item of queued) { try { await upload(r.assistant.id, item.kind === "text" ? { name: item.name, text: item.text } : { url: item.url, name: item.name }); } catch (e) { notifyError(String(e.message || e)); } }
        changed();
        onCreated(r.assistant);
      } else {
        const r = await dzAssistants.update(assistant.id, form);
        changed();
        onSaved(r.assistant);
      }
    } catch (e) { notifyError(String(e.message || e)); } finally { setBusy(false); }
  };
  const del = async () => {
    const n = assistant.chatCount || 0;
    if (!window.confirm(`Delete “${assistant.name}” with its ${plural(n, "chat")}? This can't be undone.`)) return;
    try { await dzAssistants.remove(assistant.id); changed(); go({ view: "home" }); } catch (e) { notifyError(String(e.message || e)); }
  };
  const shown = isNew ? queued.map((q) => ({ id: q.key, name: q.name, kind: q.kind, url: q.url, chars: q.text?.length })) : files;
  const tpl = templates.find((t) => t.id === template);
  const pickTemplate = (id) => {
    const t = templates.find((x) => x.id === id);
    setTemplate(id);
    setForm((f) => ({ ...f, name: t ? t.name : f.name, description: t ? t.description : f.description, modelNotes: t ? id === "prompt-writer" : f.modelNotes }));
  };
  return (
    <div className="max-w-[640px] space-y-5 px-6 py-6">
      {isNew && templates.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-muted-foreground">Start from</span>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={!template} onClick={() => setTemplate("")}>Blank</Chip>
            {templates.map((t) => <Chip key={t.id} active={template === t.id} onClick={() => pickTemplate(t.id)} title={t.description}>{t.name}</Chip>)}
          </div>
        </div>
      )}
      {isNew && projectId && !projectReadOnly && (
        <div className="space-y-1.5">
          <span className="text-muted-foreground">Keep it in</span>
          <Segmented value={scope} onChange={setScope} className="max-w-[360px]" aria-label="Where the assistant lives"
            options={[{ value: "library", label: "My Library" }, { value: "project", label: projectName || "This project" }]} />
        </div>
      )}
      <label className="block space-y-1.5"><span className="text-muted-foreground">Name</span>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={60} placeholder="e.g. Shot planner" /></label>
      <label className="block space-y-1.5"><span className="text-muted-foreground">What it is for</span>
        <Input value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={300} placeholder="One line: when to use it" /></label>
      <label className="block space-y-1.5"><span className="text-muted-foreground">Rules: how it works, what it answers, in what form</span>
        <Textarea value={form.rules} onChange={(e) => set("rules", e.target.value)} rows={5} className="min-h-[110px] resize-y" placeholder={tpl ? `The rules of the “${tpl.name}” template are used. Write your own here to replace them.` : "Write the rules in plain words. They go into every chat with this assistant."} /></label>
      <div className="space-y-1.5">
        <span className="text-muted-foreground">Text model</span>
        <OptionSelect value={form.model || "__default"} onValueChange={(v) => set("model", v === "__default" ? "" : v)} aria-label="Text model"
          options={[{ value: "__default", label: "Your default text model", description: "Whatever is your default in Settings" }, ...modelOptions]} />
      </div>
      <label className="flex items-start gap-3">
        <Switch checked={form.modelNotes} onCheckedChange={(v) => set("modelNotes", v)} className="mt-0.5" />
        <span><span className="block">Use the open model's prompting notes</span><span className="block text-sm text-muted-foreground">Writes by the rules of the model open in the studio.</span></span>
      </label>
      <div className="space-y-2">
        <p className="text-muted-foreground">Knowledge: goes into every chat with this assistant</p>
        <p className="text-sm text-muted-foreground/80">Text, Markdown or PDF files, and pictures. For example: a style guide, a character bible, prompting notes for one model.</p>
        {shown.map((f) => (
          <div key={f.id} className="flex h-9 max-w-[320px] items-center gap-2 rounded-lg border border-border pl-2.5 pr-1">
            {f.kind === "image" ? <img src={dzThumb(f.url, 64)} alt="" className="h-5 w-5 rounded object-cover" /> : <FileText size={14} className="shrink-0 text-muted-foreground" />}
            <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline" disabled={isNew || f.kind !== "text"}
              onClick={async () => { try { setPreview(await dzAssistants.fileText(assistant.id, f.id)); } catch (e) { notifyError(String(e.message || e)); } }}>
              {f.name}{f.chars ? <span className="text-muted-foreground"> · {Math.round(f.chars / 100) / 10}k chars</span> : null}
            </button>
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => (isNew ? setQueued((q) => q.filter((x) => x.key !== f.id)) : removeFile(f.id))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={13} /></button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}><Plus size={13} className="mr-1.5" />Files</Button>
          <Button size="sm" variant="secondary" onClick={() => setPicker(true)}><Plus size={13} className="mr-1.5" />Picture</Button>
        </div>
        <input ref={fileInput} type="file" multiple accept=".md,.markdown,.txt,.pdf,text/plain,text/markdown,application/pdf" className="hidden" onChange={(e) => { addText(e.target.files || []); e.target.value = ""; }} />
        <DzMediaPicker open={picker} onOpenChange={setPicker} accept="image" max={2} apiKey={apiKey} onError={notifyError} title="Picture for the assistant" onPick={addImages} />
        {preview && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/50 p-3">
            <div className="flex items-center justify-between"><span className="font-semibold">{preview.name}</span><Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Close</Button></div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[15px] text-foreground/80">{preview.text}</pre>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button onClick={save} disabled={busy || reading > 0 || !form.name.trim()}>{busy ? (isNew ? "Creating…" : "Saving…") : isNew ? "Create assistant" : "Save"}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {!isNew && !assistant.builtin && <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={del}>Delete assistant</Button>}
      </div>
    </div>
  );
}

function AssistantPage({ assistant, chats, tab, go, modelOptions, apiKey, compact }) {
  const head = (
    <div className={cn("flex items-start gap-3 px-6", compact ? "pt-4" : "pt-7")}>
      <AssistantIcon a={assistant} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold">{assistant.name}</h1>
        {assistant.description && <p className={cn("text-muted-foreground", compact ? "line-clamp-2" : "truncate")}>{assistant.description}{assistant.author ? ` · by ${assistant.author}` : ""}</p>}
      </div>
      <Button className="shrink-0" onClick={() => go({ view: "chat", assistantId: assistant.id, chatId: null })}><Plus size={14} className="mr-1.5" />New chat</Button>
      <AssistantMenu a={assistant} chatCount={chats.length} go={go} className="h-9 w-9" />
    </div>
  );
  const TabBtn = ({ id, children }) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => go({ view: "assistant", assistantId: assistant.id, tab: id })}
      className={cn("-mb-px flex h-10 items-center gap-1.5 border-b-2 text-base transition-colors duration-state", tab === id ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{children}</button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {head}
      <div role="tablist" className="mt-4 flex gap-5 border-b border-border px-6">
        <TabBtn id="chats">Chats <span className="text-sm font-normal text-muted-foreground">{chats.length}</span></TabBtn>
        <TabBtn id="settings">Settings</TabBtn>
      </div>
      <div ref={dzScrollBoxRef} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        {tab === "settings"
          ? <AssistantForm key={assistant.id} assistant={{ ...assistant, chatCount: chats.length }} modelOptions={modelOptions} apiKey={apiKey} go={go}
              onSaved={() => notify({ type: "success", title: "Assistant", message: "Saved." })} onCancel={() => go({ view: "assistant", assistantId: assistant.id, tab: "chats" })} />
          : <ChatList assistant={assistant} chats={chats} go={go} />}
      </div>
    </div>
  );
}

function NewAssistantPage({ go, modelOptions, apiKey, templates, projectId, projectName, projectReadOnly }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-3 px-6 pt-7">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-accent"><Plus size={18} /></span>
        <div className="min-w-0"><h1 className="text-xl font-semibold">New assistant</h1><p className="text-muted-foreground">Give it a name and rules. Its chats will be kept under it.</p></div>
      </div>
      <div ref={dzScrollBoxRef} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <AssistantForm modelOptions={modelOptions} apiKey={apiKey} go={go} templates={templates} projectId={projectId} projectName={projectName} projectReadOnly={projectReadOnly} onCreated={(a) => go({ view: "assistant", assistantId: a.id, tab: "chats" })} onCancel={() => go({ view: "home" })} />
      </div>
    </div>
  );
}

// ── Context (C7): what the assistant sees ──────────────────────────────────
const COMPOSER_NAME = { image: "Image", video: "Video", create: "Studio", tools: "Tools" };
// The storyboard of this place: the one changed last.
function useBoardOfPlace(projectId, enabled) {
  const [loaded, setBoard] = useState({ place: undefined, board: null });
  const board = loaded.place === (projectId || null) ? loaded.board : null;
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const place = projectId || null;
    (async () => {
      try {
        const r = await dzStoryboards.list(projectId || undefined);
        const first = (r.storyboards || [])[0];
        if (!first) { if (alive) setBoard({ place, board: null }); return; }
        const full = (await dzStoryboards.get(first.id)).storyboard;
        if (alive) setBoard({ place, board: full });
      } catch { if (alive) setBoard({ place, board: null }); }
    })();
    return () => { alive = false; };
  }, [projectId, enabled]);
  return board;
}
// The same text the storyboard screen gives the assistant for a scene or the whole board.
function boardContext(board, sceneId) {
  if (!board) return null;
  const scenes = board.scenes || [];
  const shots = board.shots || [];
  let sees;
  if (sceneId) {
    const i = scenes.findIndex((s) => s.id === sceneId);
    if (i < 0) return null;
    const sc = scenes[i];
    sees = `Scene ${i + 1}${sc.name ? ` · ${sc.name}` : ""} · ${plural(shots.filter((s) => s.scene === sc.id).length, "shot")}`;
  } else sees = `Storyboard · ${plural(scenes.length, "scene")} · ${plural(shots.length, "shot")}`;
  return { sees, seesFull: `Storyboard “${board.name}”. ${sees}.${board.note ? ` Note: ${board.note}` : ""}${board.scene ? ` The brief (start): ${String(board.scene).slice(0, 1500)}` : ""}` };
}

function ContextChip({ choice, setChoice, options, foot }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  return (
    <div ref={anchor} className="relative">
      <Chip icon={Target} className="border-0 text-muted-foreground hover:text-foreground" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open}>
        {choice.label || "No context"}<CaretDown size={12} className="text-muted-foreground" />
      </Chip>
      <ChipMenu open={open} onClose={() => setOpen(false)} anchor={anchor} className="w-[320px] p-1.5">
        {options.map((o, i) => (
          <div key={o.key}>
            {i > 0 && o.group !== options[i - 1].group && <div className="mx-1 my-1 border-t border-border" />}
            <MenuRow on={choice.key === o.key} onClick={() => { setChoice(o); setOpen(false); }}>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.meta && <span className="shrink-0 text-sm font-normal text-muted-foreground">{o.meta}</span>}
              {choice.key === o.key && <Check size={14} className="shrink-0" />}
            </MenuRow>
          </div>
        ))}
        {foot && <p className="mx-1 mt-1 border-t border-border px-2 pb-1 pt-2.5 text-sm text-muted-foreground">{foot}</p>}
      </ChipMenu>
    </div>
  );
}

// ── Voice input (C6): record, then the text goes into the field — never sent by itself ──
function useVoice({ onText }) {
  const [state, setState] = useState("idle"); // idle | starting | recording | stopping | working
  const [secs, setSecs] = useState(0);
  const [levels, setLevels] = useState([]);
  const rec = useRef(null);
  const gen = useRef(0); // a start, a cancel and an unmount each move it on: late streams are stopped
  const busy = useRef(false);
  const stopAll = () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    clearInterval(r.timer);
    cancelAnimationFrame(r.raf);
    try { r.stream.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
    try { r.ctx.close(); } catch { /* gone */ }
  };
  useEffect(() => () => { gen.current += 1; stopAll(); }, []);
  const start = async () => {
    if (rec.current || busy.current) return;
    busy.current = true;
    const mine = ++gen.current;
    setState("starting");
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {
      busy.current = false;
      if (mine === gen.current) { setState("idle"); notify({ type: "error", title: "Microphone", message: "Allow the microphone for this site to dictate." }); }
      return;
    }
    busy.current = false;
    if (mine !== gen.current) { stream.getTracks().forEach((t) => t.stop()); return; } // cancelled or closed meanwhile
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
    const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    media.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const r = { stream, media, chunks, ctx, analyser, started: Date.now(), last: 0, raf: 0, timer: 0 };
    rec.current = r;
    const tick = () => {
      if (rec.current !== r) return;
      const now = performance.now();
      if (now - r.last > 90) {
        r.last = now;
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i] - 128));
        setLevels((l) => [...l.slice(-119), Math.min(1, peak / 64)]);
      }
      r.raf = requestAnimationFrame(tick);
    };
    r.raf = requestAnimationFrame(tick);
    r.timer = setInterval(() => setSecs(Math.round((Date.now() - r.started) / 1000)), 250);
    media.start(250);
    setLevels([]);
    setSecs(0);
    setState("recording");
  };
  const cancel = () => {
    gen.current += 1;
    const r = rec.current;
    if (r && !r.stopping) { try { r.media.onstop = null; r.media.stop(); } catch { /* stopped */ } }
    if (!r?.stopping) { stopAll(); setState("idle"); }
  };
  const finish = async () => {
    const r = rec.current;
    if (!r || r.stopping) return;
    // One stop: the buttons are gone the moment it starts, and Cancel can't replace it.
    r.stopping = true;
    setState("stopping");
    const blob = await new Promise((resolve) => { r.media.onstop = () => resolve(new Blob(r.chunks, { type: r.media.mimeType || "audio/webm" })); try { r.media.stop(); } catch { resolve(new Blob(r.chunks)); } });
    stopAll();
    const mine = gen.current;
    setState("working");
    try {
      const form = new FormData();
      form.append("audio", blob, /mp4/.test(blob.type) ? "speech.m4a" : "speech.webm");
      const res = await fetch("/dz/api/speech", { method: "POST", credentials: "same-origin", body: form });
      const data = await res.json().catch(() => ({}));
      // Not set up (no ElevenLabs key): say so plainly, not "try again".
      if (res.status === 409) { notify({ type: "error", title: "Dictation", message: data.detail || "Dictation is not set up." }); return; }
      if (!res.ok || typeof data.text !== "string") throw new Error(data.detail || `HTTP ${res.status}`);
      if (mine === gen.current && data.text.trim()) onText(data.text.trim());
    } catch (e) {
      console.warn("speech:", e?.message || e);
      if (mine === gen.current) notify({ type: "error", title: "Dictation", message: "Could not recognise the speech. Try again." });
    } finally { setState("idle"); }
  };
  return { state, secs, levels, start, cancel, finish };
}
function Waveform({ levels }) {
  const bars = levels.slice(-90);
  return (
    <div className="flex h-7 min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden>
      {bars.map((v, i) => <span key={i} className="w-[2px] shrink-0 rounded-full bg-foreground" style={{ height: `${Math.max(3, Math.round(v * 26))}px` }} />)}
    </div>
  );
}

// ── The chat (C3) with its composer ───────────────────────────────────────
function ChatView({ assistant, chatId, go, variant, ctx, insert, modelOptions, textModels, apiKey, drawerHead }) {
  const [chat, setChat] = useState(null);
  const [loading, setLoading] = useState(Boolean(chatId));
  const [renaming, setRenaming] = useState(false);
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [picker, setPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState("");
  const [viewing, setViewing] = useState(null);
  const [myDefault, setMyDefault] = useState(null);
  const scroller = useRef(null);
  const field = useRef(null);
  const seq = useRef(0);
  const voice = useVoice({ onText: (t) => setText((cur) => (cur.trim() ? `${cur.replace(/\s+$/, "")} ${t}` : t)) });

  useEffect(() => {
    const mine = ++seq.current;
    setRenaming(false);
    setModel("");
    if (!chatId) { setChat(null); setLoading(false); return; }
    setLoading(true);
    dzAssistants.chat(chatId).then((r) => { if (mine === seq.current) setChat(r.chat); })
      .catch((e) => { if (mine === seq.current) { notifyError(String(e.message || e)); go({ view: "assistant", assistantId: assistant.id, tab: "chats" }); } })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [chat?.messages?.length, sending]);
  // Leaving this chat: an answer that arrives later is saved, but does not take you back.
  useEffect(() => () => { seq.current += 1; }, []);

  // Context: a new chat starts with the default of this form; a saved one keeps its own.
  const { options: ctxOptions, foot, resolve, defaultChoice } = ctx;
  const [choice, setChoiceRaw] = useState(null);
  useEffect(() => { setChoiceRaw(null); }, [chatId]);
  // A saved choice that can't be offered now (that shot or composer is not open, the scene is
  // gone) keeps its name in the chip, and nothing is sent for it until another one is chosen.
  const sc = chat?.context;
  const same = (o) => o.kind === sc.kind && (o.tab || null) === (sc.tab || null) && (o.scene || null) === (sc.scene || null) && (o.board || null) === (sc.board || null) && (o.shot || null) === (sc.shot || null);
  const saved = sc?.kind ? ctxOptions.find(same) || { key: `saved-${sc.kind}`, ...sc, label: sc.kind === "none" ? "No context" : `${sc.label || "Context"} (not open)`, unavailable: sc.kind !== "none" } : null;
  const current = choice || saved || defaultChoice;
  const setChoice = (o) => setChoiceRaw(o);

  const send = async () => {
    if (sending || loading || (!text.trim() && !images.length)) return;
    setSending(true);
    const mine = seq.current;
    try {
      let c = chat;
      if (!c) c = (await dzAssistants.newChat(assistant.id)).chat;
      const pending = { role: "user", content: text.trim(), images: images.map((x) => x.url), at: Date.now() };
      setChat({ ...c, messages: [...(c.messages || []), pending] });
      const sentText = text;
      const sentImages = images;
      setText("");
      setImages([]);
      try {
        const context = await resolve(current);
        const r = await dzAssistants.send(c.id, { text: sentText, images: sentImages.map((x) => x.url), model: model || undefined, context, choice: current.unavailable ? undefined : { kind: current.kind, board: current.board, scene: current.scene, shot: current.shot, tab: current.tab, label: current.label } });
        changed();
        if (mine !== seq.current) return; // you moved on: the answer is saved in its chat
        setChat(r.chat);
        if (!chatId) go({ view: "chat", assistantId: assistant.id, chatId: r.chat.id }, { replace: true });
      } catch (e) {
        if (mine === seq.current) { setText(sentText); setImages(sentImages); setChat(c.messages?.length ? c : null); }
        notifyError(String(e.message || e));
      }
    } catch (e) { notifyError(String(e.message || e)); } finally { setSending(false); }
  };

  const effectiveModel = model || assistant.model || myDefault || textModels.def || "";
  const chosenOption = modelOptions.find((o) => o.value === effectiveModel);
  const visionWarn = images.length > 0 && chosenOption && !chosenOption.vision;
  const makeDefault = async () => {
    try { await call("POST", "/dz/api/llm/my-default", { model: effectiveModel }); setMyDefault(effectiveModel); setModel(""); notify({ type: "success", title: "Chat", message: "Saved as your default text model." }); } catch (e) { notifyError(String(e.message || e)); }
  };
  const title = chat?.title && chat.title !== "New chat" ? chat.title : "New chat";
  const menu = chat && (
    <ChatMenu onRename={() => setRenaming(true)} onCopy={() => copyChat(chat, assistant)}
      onDelete={() => deleteChat(chat, () => go({ view: "assistant", assistantId: assistant.id, tab: "chats" }))} />
  );
  const path = (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-[15px]">
      <button type="button" onClick={() => go({ view: "assistant", assistantId: assistant.id, tab: "chats" })} className="flex shrink-0 items-center gap-2 text-muted-foreground hover:text-foreground">
        {(() => { const I = iconOf(assistant); return <I size={14} />; })()}{assistant.name}
      </button>
      <span className="text-muted-foreground/60">/</span>
      {renaming && chat
        ? <RenameField value={chat.title} onDone={async (t) => { setRenaming(false); if (t) { try { const r = await dzAssistants.rename(chat.id, t); setChat((c) => ({ ...c, title: r.chat.title })); changed(); } catch (e) { notifyError(String(e.message || e)); } } }} />
        : <span className="min-w-0 truncate font-semibold" title={title}>{title}</span>}
    </div>
  );
  const empty = !loading && !(chat?.messages || []).length;
  const canInsert = insert.can();
  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col">
      {drawerHead ? drawerHead({ path, menu }) : (
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border pl-5 pr-4">{path}{menu}</div>
      )}
      <div ref={(el) => { scroller.current = el; dzScrollBoxRef(el); }} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className={cn("mx-auto flex w-full max-w-[760px] flex-col gap-5 pb-2", variant === "drawer" ? "px-4 pt-5" : "px-6 pt-6")}>
          {loading && <div className="flex justify-center py-8"><Spinner /></div>}
          {empty && (
            <EmptyState icon={iconOf(assistant)} title={`New chat with ${assistant.name}`} className="py-24"
              text={current.kind !== "none" ? `It sees ${current.label}${assistant.modelNotes ? " and the model open in the studio" : ""}. Pictures can be attached.` : `Write a message${assistant.modelNotes ? " — it knows the prompting rules of the model open in the studio" : ""}. Pictures can be attached.`} />
          )}
          {(chat?.messages || []).map((m, i) => (
            <Message key={i} m={m} assistant={assistant} canInsert={canInsert} onOpen={(u) => setViewing(u)} onInsert={(t, how) => insert.run(t, how, m.refs || [])} />
          ))}
          {sending && <div className="flex items-center gap-2 text-muted-foreground"><Spinner className="h-4 w-4" /> Writing…</div>}
        </div>
      </div>
      {/* Composer */}
      <div className={cn("shrink-0", variant === "drawer" ? "px-4 pb-4 pt-2" : "flex justify-center px-6 pb-5 pt-2")}>
        <div className="w-full max-w-[760px] space-y-2">
          {visionWarn && <p className="text-sm text-warning">This text model may not see pictures — pick one marked for images (GPT, Claude, Gemini, Qwen VL…).</p>}
          <div className="flex flex-col gap-2 rounded-xl border border-input bg-muted px-3 pb-2 pt-2.5">
            {images.length > 0 && !["starting", "recording", "stopping"].includes(voice.state) && (
              <div className="flex flex-wrap gap-1.5">
                {images.map((x, i) => (
                  <div key={x.url} className="relative">
                    <img src={dzThumb(x.url, 160)} alt="" className="h-14 w-14 rounded-lg object-cover" />
                    <button type="button" onClick={() => setImages((l) => l.filter((_, j) => j !== i))} aria-label="Remove picture"
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-overlay/75 text-overlay-foreground"><X size={10} /></button>
                  </div>
                ))}
              </div>
            )}
            {["starting", "recording", "stopping"].includes(voice.state) ? (
              <>
                <div className="flex h-10 items-center gap-3">
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
                  <span className="w-9 shrink-0 text-sm tabular-nums text-muted-foreground">{fmtDur(voice.secs)}</span>
                  <Waveform levels={voice.levels} />
                </div>
                <div className="flex items-center gap-1">
                  <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Listening… speak, then press the check mark</p>
                  <Tip text="Discard"><button type="button" aria-label="Discard the recording" onClick={voice.cancel} disabled={voice.state === "stopping"} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={16} /></button></Tip>
                  <Tip text="Turn into text"><button type="button" aria-label="Turn the recording into text" onClick={voice.finish} disabled={voice.state !== "recording"} className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary-hover"><Check size={16} weight="bold" /></button></Tip>
                </div>
              </>
            ) : (
              <>
                <div className="relative">
                  <Textarea ref={field} value={text} onChange={(e) => setText(e.target.value)} rows={2} disabled={voice.state === "working"}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                    placeholder={`Message ${assistant.name}…`} aria-label={`Message ${assistant.name}`}
                    className="max-h-[30vh] min-h-[44px] resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" />
                  {voice.state === "working" && <span className="absolute right-0 top-0 flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" />Turning speech into text…</span>}
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <Tip text="Attach pictures (up to 4)"><button type="button" aria-label="Attach pictures" disabled={images.length >= 4} onClick={() => setPicker(true)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Paperclip size={16} /></button></Tip>
                  <ContextChip choice={current} setChoice={setChoice} options={ctxOptions} foot={foot} />
                  <OptionSelect value={effectiveModel} onValueChange={setModel} options={modelOptions} placeholder={textModels.loaded ? "Text model" : "Loading…"} aria-label="Text model"
                    className="h-8 min-h-8 w-auto max-w-[220px] border-0 bg-transparent px-2 py-0 text-sm text-muted-foreground shadow-none hover:bg-accent hover:text-foreground [&>span>span>span+span]:hidden [&>span.ml-2]:hidden [&_.font-semibold]:font-medium" />
                  {effectiveModel && effectiveModel !== (myDefault ?? textModels.def) && (
                    <Tip text="Use this text model everywhere by default (Chat, Adapt, Director) — you can change it in Settings">
                      <button type="button" onClick={makeDefault} className="h-8 shrink-0 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">Make default</button>
                    </Tip>
                  )}
                  <span className="flex-1" />
                  <Tip text="Dictate"><button type="button" aria-label="Dictate" disabled={voice.state === "working"} onClick={voice.start}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Microphone size={16} /></button></Tip>
                  <button type="button" aria-label="Send" disabled={sending || loading || voice.state === "working" || (!text.trim() && !images.length)} onClick={send}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:bg-primary-hover disabled:opacity-40">
                    {sending ? <Spinner className="h-4 w-4 border-primary-foreground/30 border-t-primary-foreground" /> : <ArrowUp size={16} weight="bold" />}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <DzMediaPicker open={picker} onOpenChange={setPicker} accept="image" max={Math.max(1, 4 - images.length)} apiKey={apiKey} onError={notifyError} title="Pictures for the chat"
        onPick={(list) => setImages((l) => [...l, ...list.filter((x) => !l.some((y) => y.url === x.url))].slice(0, 4))} />
      {viewing && createPortal(
        <div ref={dzScrollBoxRef} className="fixed inset-0 z-[150] flex items-center justify-center bg-overlay/90 p-6" onClick={() => setViewing(null)} role="dialog" aria-label="Picture">
          <img src={dzThumb(viewing, 2048)} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>, document.body)}
    </section>
  );
}

// ── The workspace: tree + right side, in either form ─────────────────────
// A place: { view: home | assistant | chat | new-assistant, assistantId, chatId, tab }.
function useChatPlace(variant) {
  const [place, setPlace] = useState(() => readJson(PLACE_KEY[variant], { view: "home" }));
  const go = useCallback((p) => { setPlace(p); writeJson(PLACE_KEY[variant], p); }, [variant]);
  return [place, go];
}

function useContextOptions({ variant, activeTab, projectId, projectName, getStudio, lastComposer, active }) {
  const board = useBoardOfPlace(projectId, active);
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener("dz:studio-state", on);
    return () => window.removeEventListener("dz:studio-state", on);
  }, []);
  const none = { key: "none", kind: "none", label: "No context", group: 0 };
  const options = [none];
  let defaultChoice = none;
  // Under the drawer: the shot that is open, or the composer of the open studio.
  if (variant === "drawer") {
    const st = getStudio(activeTab);
    if (activeTab === "director" && st?.writable && /^Shot \d+/.test(st.sees || "")) {
      const o = { key: `shot-${st.targetId || ""}`, kind: "shot", tab: "director", board: st.board, shot: st.targetId, label: (st.sees || "").split(" · ")[0], group: 1 };
      options.push(o);
      defaultChoice = o;
    } else if (COMPOSER_NAME[activeTab] && st && st.writable !== false) {
      const o = { key: `composer-${activeTab}`, kind: "composer", tab: activeTab, label: `${COMPOSER_NAME[activeTab]} prompt`, group: 1 };
      options.push(o);
      defaultChoice = o;
    }
  }
  if (board) {
    (board.scenes || []).forEach((sc, i) => options.push({ key: `scene-${sc.id}`, kind: "scene", board: board.id, scene: sc.id, label: `Scene ${i + 1}${sc.name ? ` · ${sc.name}` : ""}`, meta: plural((board.shots || []).filter((s) => s.scene === sc.id).length, "shot"), group: 2 }));
    options.push({ key: "board", kind: "board", board: board.id, label: "Whole storyboard", meta: plural((board.shots || []).length, "shot"), group: 3 });
  }
  const shotOffered = options.some((o) => o.kind === "shot");
  const foot = `${projectName}${board ? ` · ${board.name}` : " · no storyboard yet"}.${shotOffered ? "" : " Open a shot to offer it here too."}`;
  // What goes with the message for a choice: exactly what the screens send today.
  const resolve = async (o) => {
    const notesTab = o?.tab || (COMPOSER_NAME[activeTab] || activeTab === "director" ? activeTab : lastComposer());
    const notesModel = notesTab ? getStudio(notesTab)?.model : undefined;
    if (!o || o.kind === "none" || o.unavailable) return { tab: variant === "page" ? "chat" : activeTab, ...(notesModel ? { model: notesModel } : {}) };
    if (o.kind === "shot" || o.kind === "composer") {
      const st = getStudio(o.tab);
      if (!st || (o.kind === "shot" && st.targetId !== o.shot)) return { tab: o.tab, ...(notesModel ? { model: notesModel } : {}) };
      return { tab: o.tab, model: st.model, prompt: st.prompt, sees: st.seesFull || st.sees || undefined, refs: st.refs || undefined };
    }
    let b = board && board.id === o.board ? board : null;
    if (o.board) { try { b = (await dzStoryboards.get(o.board)).storyboard; } catch { /* use what we have */ } }
    const c = boardContext(b, o.kind === "scene" ? o.scene : null);
    return { tab: "director", ...(notesModel ? { model: notesModel } : {}), ...(c ? { sees: c.seesFull } : {}) };
  };
  return { options, foot, resolve, defaultChoice };
}

export function DzChatWorkspace({ variant, active, activeTab, getStudio, insert, apiKey, onOpenAsPage, onClose, initialPlace, placeSeq, treeHidden = false, onToggleTree }) {
  const ctxGlobal = useDzContext();
  const projectId = ctxGlobal.project?.id || null;
  const projectName = ctxGlobal.project?.name || "Library";
  const data = useChatData(projectId, active);
  const [place, goPlace] = useChatPlace(variant);
  // Phones: the page shows the tree or the right side, with a button to switch.
  const [mobileTree, setMobileTree] = useState(false);
  const go = useCallback((p, opts) => { setMobileTree(false); goPlace(p, opts); }, [goPlace]);
  // "Open as a page": the page takes the drawer's place.
  useEffect(() => { if (initialPlace) go(initialPlace); }, [placeSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  const textModels = useDzTextModelOptions({ all: true });
  const ctx = useContextOptions({ variant, activeTab, projectId, projectName, getStudio, lastComposer: insert.lastTab, active });

  // A place that no longer exists falls back to the first assistant. One just made (or
  // duplicated) may not be in the list yet: the list is read again once before falling back.
  const assistant = data.assistants.find((a) => a.id === place.assistantId) || null;
  const [rechecked, setRechecked] = useState({ id: null, done: false });
  const missing = Boolean(place.assistantId && !assistant && (place.view === "assistant" || place.view === "chat"));
  useEffect(() => {
    if (!data.loaded || !missing || rechecked.id === place.assistantId) return;
    const id = place.assistantId;
    setRechecked({ id, done: false });
    data.reload().finally(() => setRechecked((r) => (r.id === id ? { id, done: true } : r)));
  }, [data.loaded, missing, place.assistantId]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = missing && !(rechecked.id === place.assistantId && rechecked.done);
  const view = place.view === "new-assistant" ? "new-assistant" : assistant && (place.view === "assistant" || place.view === "chat") ? place.view : "home";
  useEffect(() => {
    if (!data.loaded || view !== "home" || waiting) return;
    const first = [...data.assistants].sort((a, b) => (b.lastChatAt || 0) - (a.lastChatAt || 0))[0];
    if (first) go({ view: "assistant", assistantId: first.id, tab: "chats" });
  }, [data.loaded, view, waiting, data.assistants]); // eslint-disable-line react-hooks/exhaustive-deps

  const modelOptions = textModels.options;
  const drawerHead = variant === "drawer" ? ({ path, menu }) => (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
      <Tip text={treeHidden ? "Show assistants" : "Hide assistants"}>
        <button type="button" aria-label={treeHidden ? "Show assistants" : "Hide assistants"} aria-pressed={!treeHidden} onClick={onToggleTree}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"><SidebarSimple size={16} /></button>
      </Tip>
      {path}
      {menu}
      <Tip text="Open as a page"><button type="button" aria-label="Open as a page" onClick={() => onOpenAsPage(place)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowsOut size={16} /></button></Tip>
      <Tip text="Close"><button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={16} /></button></Tip>
    </div>
  ) : null;
  const simpleHead = (titleNode) => (drawerHead ? drawerHead({ path: <span className="min-w-0 flex-1 truncate font-semibold">{titleNode}</span>, menu: null }) : null);

  let right;
  if (view === "new-assistant") {
    right = <>{simpleHead("New assistant")}<div className="min-h-0 flex-1"><NewAssistantPage go={go} modelOptions={modelOptions} apiKey={apiKey} templates={data.templates || []} projectId={projectId} projectName={projectName} projectReadOnly={Boolean(ctxGlobal.project?.archived)} /></div></>;
  } else if (view === "assistant") {
    right = <>{simpleHead(assistant.name)}<div className="min-h-0 flex-1"><AssistantPage assistant={assistant} chats={data.chatsOf(assistant.id)} tab={place.tab === "settings" ? "settings" : "chats"} go={go} modelOptions={modelOptions} apiKey={apiKey} compact={variant === "drawer"} /></div></>;
  } else if (view === "chat") {
    right = <ChatView key={`${assistant.id}:${place.chatId || "new"}`} assistant={assistant} chatId={place.chatId || null} go={go} variant={variant} ctx={ctx} insert={insert}
      modelOptions={modelOptions} textModels={textModels} apiKey={apiKey} drawerHead={drawerHead} />;
  } else {
    right = (
      <>{simpleHead("Chat")}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {data.loaded && !waiting && !data.assistants.length ? (
            <EmptyState icon={ChatCircle} title="No assistants yet" text="An assistant has its own rules, text model and knowledge. Its chats are kept under it.">
              <Button onClick={() => go({ view: "new-assistant" })}><Plus size={14} className="mr-1.5" />New assistant</Button>
            </EmptyState>
          ) : <Spinner />}
        </div>
      </>
    );
  }
  return (
    <div className="relative flex h-full min-h-0 w-full">
      {!treeHidden && <Tree data={data} place={view === "home" ? { view: "home" } : place} go={go} newAssistantOpen={view === "new-assistant"}
        className={variant === "drawer" ? "w-[280px] shrink-0" : cn("w-[296px] shrink-0", mobileTree ? "max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full max-md:bg-background" : "max-md:hidden")} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {variant === "page" && (
          <div className="flex h-11 shrink-0 items-center border-b border-border px-3 md:hidden">
            <Button size="sm" variant="ghost" onClick={() => setMobileTree((v) => !v)}><SidebarSimple size={16} className="mr-1.5" />Assistants and chats</Button>
          </div>
        )}
        {right}
      </div>
    </div>
  );
}

// The Chat page (C1–C7).
export function DzChatPage(props) {
  return <div className="h-full w-full"><DzChatWorkspace variant="page" {...props} /></div>;
}

// The drawer (C8): the Chat page in a narrow form, over a scrim that covers the whole app.
export default function DzChatDrawer({ open, onOpenChange, ...rest }) {
  // The tree's state is remembered; a window narrower than 1200 px opens with it hidden.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { if (open) setNarrow(readJson(TREE_KEY, false) || window.innerWidth < 1200); }, [open]);
  const toggleTree = () => setNarrow((v) => { writeJson(TREE_KEY, !v); return !v; });
  return (
    <>
      {open && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[60] bg-scrim" aria-hidden onClick={() => onOpenChange(false)} />, document.body)}
      <SidePanel open={open} onOpenChange={onOpenChange} title="Chat" bare
        className={cn("top-0 h-full max-w-[100vw] transition-[max-width,width] sm:max-w-[100vw]", narrow ? "w-[560px]" : "w-[840px]")}>
        {open && <DzChatWorkspace variant="drawer" active={open} onClose={() => onOpenChange(false)} treeHidden={narrow} onToggleTree={toggleTree} {...rest} />}
      </SidePanel>
    </>
  );
}
