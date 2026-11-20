"use client";

// DZ: side chat with assistants, from any studio (a drawer on the right).
// An assistant has its own rules, a default text model and knowledge files;
// it lives in your Library or in a project. Chats are yours only. Answers can
// go straight into the prompt of the studio you are in ("Insert").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dzThumb } from "../api.js";
import { useDzContext } from "../dzContext.js";
import { useDzTextModelOptions } from "../dzLlm.js";
import { DzMediaPicker } from "./DzMedia.jsx";
import { Button, Textarea, Input, Spinner, Switch, OptionSelect, Tip, cn, SelectParts, SidePanel } from "../ui/index.js";
import { dzScrollBoxRef } from "../dzScroll.js";

const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } = SelectParts;
const LAST_KEY = "dz_chat_assistant";
const LAST_CHAT_KEY = "dz_chat_last_chats";
const when = (t) => {
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
};
const money = (v) => (v == null ? "" : v === 0 ? "free" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);

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
  addFile: (id, data) => call("POST", `/dz/api/assistants/${enc(id)}/files`, data),
  fileText: (id, fileId) => call("GET", `/dz/api/assistants/${enc(id)}/files/${enc(fileId)}`),
  removeFile: (id, fileId) => call("DELETE", `/dz/api/assistants/${enc(id)}/files/${enc(fileId)}`),
  chats: (id) => call("GET", `/dz/api/assistants/${enc(id)}/chats`),
  newChat: (id) => call("POST", `/dz/api/assistants/${enc(id)}/chats`),
  chat: (id) => call("GET", `/dz/api/chats/${enc(id)}`),
  removeChat: (id) => call("DELETE", `/dz/api/chats/${enc(id)}`),
  send: (id, data) => call("POST", `/dz/api/chats/${enc(id)}/messages`, data),
};

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

// **bold** inside plain text, safely.
function Inline({ text }) {
  const bits = text.split(/(\*\*[^*\n]+\*\*)/g);
  return bits.map((b, i) => (/^\*\*[^*\n]+\*\*$/.test(b) ? <strong key={i}>{b.slice(2, -2)}</strong> : <span key={i}>{b}</span>));
}

function InsertButtons({ text, canInsert, onInsert, small }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* not allowed */ } };
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", small && "mt-1.5")}>
      <Tip text={canInsert ? "Add to the end of the prompt in the studio you are in" : "Open Create, Image, Video or Director to insert"}>
        <span><Button size="sm" className="h-8 rounded-lg" disabled={!canInsert} onClick={() => onInsert(text, "append")}>Insert into prompt</Button></span>
      </Tip>
      <Button size="sm" variant="secondary" className="h-8 rounded-lg" disabled={!canInsert} onClick={() => onInsert(text, "replace")}>Replace prompt</Button>
      <Button size="sm" variant="ghost" className="h-8 rounded-lg" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}

function Message({ m, canInsert, onInsert, onOpen }) {
  if (m.role === "user") {
    return (
      <div className="ml-8 space-y-2 rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5">
        {m.images?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {m.images.map((u) => <button key={u} type="button" onClick={() => onOpen(u)}><img src={dzThumb(u, 160)} alt="" className="h-16 w-16 rounded-lg object-cover" /></button>)}
          </div>
        )}
        {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
      </div>
    );
  }
  if (m.error) {
    return <div className="mr-8 rounded-2xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-destructive">{m.error}</div>;
  }
  const parts = splitAnswer(m.content || "");
  const codes = parts.filter((p) => p.kind === "code");
  return (
    <div className="mr-4 space-y-2">
      {parts.map((p, i) => (p.kind === "code" ? (
        <div key={i} className="rounded-xl border border-border bg-overlay/40 p-3">
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[15px] leading-relaxed text-foreground/90">{p.text}</pre>
          <InsertButtons text={p.text} canInsert={canInsert} onInsert={onInsert} small />
        </div>
      ) : (
        <p key={i} className="whitespace-pre-wrap break-words leading-relaxed text-foreground/90"><Inline text={p.text.trim()} /></p>
      )))}
      {codes.length === 0 && m.content && <InsertButtons text={m.content} canInsert={canInsert} onInsert={onInsert} />}
      <p className="text-muted-foreground">{[m.model?.replace(/^[a-z]+:/, ""), money(m.costUsd), m.ms ? `${(m.ms / 1000).toFixed(1)} s` : ""].filter(Boolean).join(" · ")}</p>
    </div>
  );
}

// The assistant's settings, inside the drawer (no popup).
function AssistantEditor({ assistant, modelOptions, onSaved, onDeleted, onBack, onError, apiKey }) {
  const [form, setForm] = useState({ name: assistant.name, description: assistant.description || "", rules: assistant.rules || "", model: assistant.model || "", modelNotes: assistant.modelNotes });
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState(assistant.files || []);
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState(null); // { name, text }
  const fileInput = useRef(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { const r = await dzAssistants.update(assistant.id, form); onSaved(r.assistant); } catch (e) { onError(String(e.message || e)); } finally { setBusy(false); }
  };
  const addText = async (fileList) => {
    for (const f of [...fileList]) {
      try {
        if (f.size > 400_000) throw new Error(`${f.name} is too big (text files up to ~100k characters).`);
        const text = await f.text();
        const r = await dzAssistants.addFile(assistant.id, { name: f.name, text });
        setFiles(r.assistant.files);
        onSaved(r.assistant, { stay: true });
      } catch (e) { onError(String(e.message || e)); }
    }
  };
  const addImages = async (list) => {
    for (const x of list) {
      try { const r = await dzAssistants.addFile(assistant.id, { url: x.url, name: x.name || "Picture" }); setFiles(r.assistant.files); onSaved(r.assistant, { stay: true }); } catch (e) { onError(String(e.message || e)); }
    }
  };
  const removeFile = async (fid) => {
    try { const r = await dzAssistants.removeFile(assistant.id, fid); setFiles(r.assistant.files); onSaved(r.assistant, { stay: true }); } catch (e) { onError(String(e.message || e)); }
  };
  const del = async () => {
    if (!window.confirm(`Delete the assistant “${assistant.name}”? Your chats with it stay hidden with it.`)) return;
    try { await dzAssistants.remove(assistant.id); onDeleted(assistant.id); } catch (e) { onError(String(e.message || e)); }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Button size="sm" variant="ghost" onClick={onBack}>← Back</Button>
        <span className="font-semibold">Assistant settings</span>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto custom-scrollbar p-4">
        <label className="block space-y-1.5"><span className="text-muted-foreground">Name</span><Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={60} /></label>
        <label className="block space-y-1.5"><span className="text-muted-foreground">What it is for</span><Input value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={300} /></label>
        <label className="block space-y-1.5">
          <span className="text-muted-foreground">Rules — how it works, what it answers, in what form</span>
          <Textarea value={form.rules} onChange={(e) => set("rules", e.target.value)} rows={10} className="min-h-[180px] resize-y" />
        </label>
        <div className="space-y-1.5">
          <span className="text-muted-foreground">Text model</span>
          <OptionSelect value={form.model || "__default"} onValueChange={(v) => set("model", v === "__default" ? "" : v)} aria-label="Text model"
            options={[{ value: "__default", label: "Your default text model", description: "Whatever is your default in Settings" }, ...modelOptions]} />
        </div>
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block">Use the open model's prompting notes</span>
            <span className="block text-muted-foreground">It writes prompts by the rules of the model open in the studio (Kling, Seedance, Nano Banana…).</span>
          </span>
          <Switch checked={form.modelNotes} onCheckedChange={(v) => set("modelNotes", v)} />
        </label>
        <div className="space-y-2">
          <span className="text-muted-foreground">Knowledge — goes into every chat with it</span>
          {files.length === 0 && <p className="text-muted-foreground/80">No files yet: style guides, rules, examples (.md, .txt) and up to 2 pictures.</p>}
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2.5 rounded-xl border border-border px-2.5 py-2">
              {f.kind === "image" ? <img src={dzThumb(f.url, 96)} alt="" className="h-9 w-9 rounded-md object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">Aa</span>}
              <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" disabled={f.kind !== "text"}
                onClick={async () => { try { setPreview(await dzAssistants.fileText(assistant.id, f.id)); } catch (e) { onError(String(e.message || e)); } }}>
                {f.name}{f.chars ? <span className="text-muted-foreground"> · {Math.round(f.chars / 100) / 10}k chars</span> : null}
              </button>
              <Button size="sm" variant="ghost" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>✕</Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>Add text files</Button>
            <Button size="sm" variant="secondary" onClick={() => setPicker(true)}>Add a picture</Button>
          </div>
          <input ref={fileInput} type="file" multiple accept=".md,.markdown,.txt,text/plain,text/markdown" className="hidden" onChange={(e) => { addText(e.target.files || []); e.target.value = ""; }} />
          <DzMediaPicker open={picker} onOpenChange={setPicker} accept="image" max={2} apiKey={apiKey} onError={onError} title="Picture for the assistant" onPick={addImages} />
          {preview && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/50 p-3">
              <div className="flex items-center justify-between"><span className="font-semibold">{preview.name}</span><Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Close</Button></div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[15px] text-foreground/80">{preview.text}</pre>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border p-3">
        <Button onClick={save} disabled={busy || !form.name.trim()}>{busy ? "Saving…" : "Save"}</Button>
        <Button variant="ghost" onClick={onBack}>Cancel</Button>
        <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={del}>Delete</Button>
      </div>
    </div>
  );
}

export default function DzChatPanel({ open, onOpenChange, activeTab, canInsert, onInsert, getStudio, apiKey }) {
  const ctx = useDzContext();
  const projectId = ctx.project?.id || null;
  const textModels = useDzTextModelOptions({ all: true });
  // What the open screen shows the assistant (a storyboard's shot, group, scene…), as one short line.
  const [sees, setSees] = useState("");
  useEffect(() => {
    const read = () => setSees(String(getStudio?.()?.sees || ""));
    read();
    window.addEventListener("dz:studio-state", read);
    return () => window.removeEventListener("dz:studio-state", read);
  }, [getStudio, activeTab]);
  const [lists, setLists] = useState({ personal: [], project: [], templates: [], loaded: false });
  const [assistantId, setAssistantId] = useState(() => { try { return localStorage.getItem(LAST_KEY) || ""; } catch { return ""; } });
  const [chats, setChats] = useState([]);
  const [chat, setChat] = useState(null);
  const [view, setView] = useState("chat"); // chat | edit | new
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [picker, setPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState("");
  const [viewing, setViewing] = useState(null);
  const wide = () => typeof window === "undefined" || window.innerWidth >= 768;
  const [showList, setShowList] = useState(true); // phones: the chat list over the conversation
  const scroller = useRef(null);
  const notify = (message) => window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "error", title: "Chat", message } }));

  const all = useMemo(() => [...lists.project, ...lists.personal], [lists]);
  // The remembered assistant; else the one you chatted with last (chats live on the
  // server, so a new browser or a cleared one opens your latest conversation).
  const latest = useMemo(() => [...all].sort((a, b) => (b.lastChatAt || 0) - (a.lastChatAt || 0))[0] || null, [all]);
  const assistant = all.find((a) => a.id === assistantId) || latest || null;
  // A project's assistant in an archived project is read only; your own ones never are.
  const readOnly = Boolean(assistant?.project_id && ctx.project?.archived);

  // Answers that arrive after you switched (project, assistant, chat) are dropped.
  const listSeq = useRef(0);
  const loadLists = useCallback(async () => {
    const seq = ++listSeq.current;
    try {
      const r = await dzAssistants.list(projectId);
      if (seq === listSeq.current) setLists({ ...r, loaded: true });
      return r;
    } catch (e) { if (seq === listSeq.current) { notify(String(e.message || e)); setLists((l) => ({ ...l, loaded: true })); } return null; }
  }, [projectId]);
  useEffect(() => { setLists((l) => ({ ...l, project: [], loaded: false })); }, [projectId]);
  useEffect(() => { if (open) loadLists(); }, [open, loadLists]);
  useEffect(() => { try { if (assistant?.id) localStorage.setItem(LAST_KEY, assistant.id); } catch { /* optional */ } }, [assistant?.id]);
  useEffect(() => { setModel(""); }, [assistant?.id]);

  // Chats of the assistant: open the latest (or none yet).
  const chatSeq = useRef(0);
  const [loadingChat, setLoadingChat] = useState(false);
  const loadChats = useCallback(async (aid, pick) => {
    const seq = ++chatSeq.current;
    setChats([]);
    setChat(null);
    if (!aid) return;
    setLoadingChat(true);
    try {
      const r = await dzAssistants.chats(aid);
      if (seq !== chatSeq.current) return;
      setChats(r.chats);
      let remembered = null;
      try { remembered = JSON.parse(localStorage.getItem(LAST_CHAT_KEY) || "{}")[aid] || null; } catch { /* optional */ }
      const id = pick || (r.chats.some((x) => x.id === remembered) ? remembered : r.chats[0]?.id);
      const c = id ? (await dzAssistants.chat(id)).chat : null;
      if (seq === chatSeq.current) setChat(c);
    } catch (e) { if (seq === chatSeq.current) notify(String(e.message || e)); } finally { if (seq === chatSeq.current) setLoadingChat(false); }
  }, []);
  const openChat = async (id) => {
    const seq = ++chatSeq.current;
    if (!id) { setChat(null); return; }
    setLoadingChat(true);
    try { const c = (await dzAssistants.chat(id)).chat; if (seq === chatSeq.current) setChat(c); } catch (e) { notify(String(e.message || e)); } finally { if (seq === chatSeq.current) setLoadingChat(false); }
  };
  useEffect(() => { if (open && assistant?.id) loadChats(assistant.id); }, [open, assistant?.id, loadChats]);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [chat?.messages?.length, sending]);
  // Remember the open chat of each assistant.
  useEffect(() => {
    if (!chat?.id || !chat.assistant_id) return;
    try { const m = JSON.parse(localStorage.getItem(LAST_CHAT_KEY) || "{}"); m[chat.assistant_id] = chat.id; localStorage.setItem(LAST_CHAT_KEY, JSON.stringify(m)); } catch { /* optional */ }
  }, [chat?.id, chat?.assistant_id]);

  const createFrom = async (template) => {
    try {
      const r = await dzAssistants.create(template === "__blank" ? { project: null, name: "New assistant", rules: "" } : { project: null, template });
      await loadLists();
      setAssistantId(r.assistant.id);
      setView(template === "__blank" ? "edit" : "chat");
    } catch (e) { notify(String(e.message || e)); }
  };

  const send = async () => {
    if (!assistant || sending || loadingChat || (!text.trim() && !images.length)) return;
    setSending(true);
    const seq = chatSeq.current;
    try {
      let c = chat;
      if (!c || c.assistant_id !== assistant.id) c = (await dzAssistants.newChat(assistant.id)).chat;
      if (seq !== chatSeq.current) return;
      const studio = getStudio?.() || null;
      const pending = { role: "user", content: text.trim(), images: images.map((x) => x.url), at: Date.now() };
      setChat({ ...c, messages: [...(c.messages || []), pending] });
      const sentText = text;
      const sentImages = images;
      setText("");
      setImages([]);
      try {
        const r = await dzAssistants.send(c.id, { text: sentText, images: sentImages.map((x) => x.url), model: model || undefined, context: studio ? { tab: activeTab, model: studio.model, prompt: studio.prompt, sees: studio.seesFull || studio.sees || undefined, refs: studio.refs || undefined } : { tab: activeTab } });
        if (seq !== chatSeq.current) return; // you moved on: the answer is saved in its chat
        setChat(r.chat);
        setChats((list) => [{ id: r.chat.id, title: r.chat.title, updated_at: r.chat.updated_at, n: r.chat.messages.length }, ...list.filter((x) => x.id !== r.chat.id)]);
      } catch (e) {
        if (seq === chatSeq.current) { setText(sentText); setImages(sentImages); setChat(c); }
        notify(String(e.message || e));
      }
    } catch (e) { notify(String(e.message || e)); } finally { setSending(false); }
  };

  const modelOptions = textModels.options;
  const [myDefault, setMyDefault] = useState(null); // set from here: the new default
  const makeDefault = async () => {
    try { await call("POST", "/dz/api/llm/my-default", { model: effectiveModel }); setMyDefault(effectiveModel); setModel(""); window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "success", title: "Chat", message: "Saved as your default text model." } })); } catch (e) { notify(String(e.message || e)); }
  };
  const effectiveModel = model || assistant?.model || myDefault || textModels.def || "";
  const chosenOption = modelOptions.find((o) => o.value === effectiveModel);
  const visionWarn = images.length > 0 && chosenOption && !chosenOption.vision;

  const header = (
    <div className="flex min-w-0 items-center gap-2">
      {view === "chat" && assistant && !readOnly && (
        <Button size="sm" variant="ghost" onClick={() => setView("edit")} title="Assistant settings: rules, model, knowledge">Settings</Button>
      )}
    </div>
  );

  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title="Chat" actions={header} className="max-w-[min(960px,100vw)] sm:max-w-[min(960px,100vw)]">
      {view === "edit" && assistant ? (
        <AssistantEditor key={assistant.id} assistant={assistant} modelOptions={modelOptions} apiKey={apiKey} onError={notify} onBack={() => setView("chat")}
          onSaved={(a, opts) => { setLists((l) => ({ ...l, personal: l.personal.map((x) => (x.id === a.id ? a : x)), project: l.project.map((x) => (x.id === a.id ? a : x)) })); if (!opts?.stay) setView("chat"); }}
          onDeleted={(id) => { setLists((l) => ({ ...l, personal: l.personal.filter((x) => x.id !== id), project: l.project.filter((x) => x.id !== id) })); setAssistantId(""); setView("chat"); }} />
      ) : view === "new" || (lists.loaded && !all.length) ? (
        <div className="h-full space-y-3 overflow-y-auto custom-scrollbar p-4">
          {view === "new" && <Button size="sm" variant="ghost" onClick={() => setView("chat")}>← Back</Button>}
          <p className="text-muted-foreground">Start from a template (you can change everything later) or from scratch. It goes to your Library; to share one with a project, make it inside that project.</p>
          {lists.templates.map((t) => (
            <button key={t.id} type="button" onClick={() => createFrom(t.id)} className="block w-full rounded-xl border border-border p-3 text-left transition-colors hover:border-input hover:bg-accent">
              <span className="block font-semibold">{t.name}</span>
              <span className="block text-muted-foreground">{t.description}</span>
            </button>
          ))}
          <button type="button" onClick={() => createFrom("__blank")} className="block w-full rounded-xl border border-dashed border-border p-3 text-left text-muted-foreground hover:text-foreground">+ From scratch</button>
          {projectId && !readOnly && (
            <Button size="sm" variant="secondary" onClick={async () => {
              try { const r = await dzAssistants.create({ project: projectId, name: "Project assistant", rules: "" }); await loadLists(); setAssistantId(r.assistant.id); setView("edit"); } catch (e) { notify(String(e.message || e)); }
            }}>New assistant in {ctx.project.name}</Button>
          )}
        </div>
      ) : (
        <div className="flex h-full">
          {/* Left: assistant and its chats (on phones: behind the "Chats" button) */}
          <aside className={cn("flex w-[260px] shrink-0 flex-col border-r border-border bg-muted/40", showList ? "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:w-[82%] max-md:bg-card" : "max-md:hidden")}>
            <div className="space-y-2 border-b border-border p-3">
              <Select value={assistant?.id || ""} onValueChange={(v) => (v === "__new" ? setView("new") : setAssistantId(v))}>
                <SelectTrigger aria-label="Assistant" className="h-10 w-full rounded-xl"><SelectValue placeholder="Choose an assistant" /></SelectTrigger>
                <SelectContent className="max-h-[420px]">
                  {lists.project.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{ctx.project?.name || "This project"}</SelectLabel>
                      {lists.project.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.chatCount ? ` · ${a.chatCount} chat${a.chatCount === 1 ? "" : "s"}` : ""}</SelectItem>)}
                    </SelectGroup>
                  )}
                  {lists.personal.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>My assistants</SelectLabel>
                      {lists.personal.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.chatCount ? ` · ${a.chatCount} chat${a.chatCount === 1 ? "" : "s"}` : ""}</SelectItem>)}
                    </SelectGroup>
                  )}
                  <SelectItem value="__new">+ New assistant…</SelectItem>
                </SelectContent>
              </Select>
              <Button className="h-9 w-full rounded-lg" disabled={!assistant} onClick={() => { chatSeq.current += 1; setChat(null); setText(""); setShowList(wide()); }}>+ New chat</Button>
            </div>
            <nav aria-label="Chats" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto custom-scrollbar p-2">
              {chats.length === 0 && <p className="px-2 py-3 text-muted-foreground">No chats with {assistant?.name || "this assistant"} yet.</p>}
              {chats.map((c) => (
                <div key={c.id} className={cn("group flex items-center gap-1 rounded-lg pr-1", chat?.id === c.id ? "bg-signal/10" : "hover:bg-accent")}>
                  <button type="button" onClick={() => { openChat(c.id); setShowList(wide()); }} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                    <span className={cn("block truncate", chat?.id === c.id && "font-semibold text-signal")}>{c.title}</span>
                    <span className="block text-[14px] text-muted-foreground">{when(c.updated_at)}</span>
                  </button>
                  <button type="button" aria-label={`Delete chat ${c.title}`} title="Delete chat"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    onClick={async () => {
                      if (!window.confirm(`Delete “${c.title}”?`)) return;
                      try { await dzAssistants.removeChat(c.id); setChats((l) => l.filter((x) => x.id !== c.id)); if (chat?.id === c.id) setChat(null); } catch (e) { notify(String(e.message || e)); }
                    }}>✕</button>
                </div>
              ))}
            </nav>
          </aside>

          {/* Right: the conversation */}
          <section className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Button size="sm" variant="secondary" className="md:hidden" onClick={() => setShowList((v) => !v)}>Chats</Button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{chat?.title && chat.title !== "New chat" ? chat.title : assistant ? `New chat · ${assistant.name}` : "Chat"}</p>
              {assistant?.description && <p className="truncate text-muted-foreground">{assistant.description}{assistant.author ? ` · by ${assistant.author}` : ""}</p>}
            </div>
          </div>
          {/* Messages */}
          <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto custom-scrollbar p-4">
            {!lists.loaded && <div className="flex justify-center py-8"><Spinner /></div>}
            {lists.loaded && assistant && !(chat?.messages || []).length && (
              <div className="py-6 text-center text-muted-foreground">
                <p className="font-semibold text-foreground">{assistant.name}</p>
                <p>Write a message{assistant.modelNotes ? " — it knows the prompting rules of the model open in the studio" : ""}. Pictures can be attached.</p>
              </div>
            )}
            {(chat?.messages || []).map((m, i) => <Message key={i} m={m} canInsert={typeof canInsert === "function" ? canInsert() : canInsert} onInsert={(t, how) => onInsert(t, how, m.refs || [])} onOpen={(u) => setViewing(u)} />)}
            {sending && <div className="flex items-center gap-2 text-muted-foreground"><Spinner className="h-4 w-4" /> Writing…</div>}
          </div>

          {/* Composer */}
          <div className="space-y-2 border-t border-border p-3">
            {images.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {images.map((x, i) => (
                  <div key={x.url} className="group relative">
                    <img src={dzThumb(x.url, 160)} alt="" className="h-14 w-14 rounded-lg object-cover" />
                    <button type="button" onClick={() => setImages((l) => l.filter((_, j) => j !== i))} aria-label="Remove picture"
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-overlay/75 text-[11px] text-overlay-foreground">✕</button>
                  </div>
                ))}
              </div>
            )}
            {sees && <p className="flex items-center gap-1.5 self-start rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground" title="What the assistant sees with your message">Sees: {sees}</p>}
            {visionWarn && <p className="text-warning">This text model may not see pictures — pick one marked for images (GPT, Claude, Gemini, Qwen VL…).</p>}
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} disabled={!assistant}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
              placeholder={assistant ? `Message ${assistant.name}… (Enter to send, Shift+Enter for a new line)` : "Choose an assistant"} className="max-h-[30vh] min-h-[80px] resize-y" />
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" className="h-9 rounded-lg" disabled={!assistant || images.length >= 4} onClick={() => setPicker(true)} title="Attach pictures (up to 4)">+ Picture</Button>
              <div className="min-w-0 flex-1">
                <OptionSelect value={effectiveModel} onValueChange={setModel} options={modelOptions} placeholder={textModels.loaded ? "Text model" : "Loading…"} aria-label="Text model" className="min-h-9 py-1" />
              </div>
              {effectiveModel && effectiveModel !== (myDefault ?? textModels.def) && (
                <Tip text="Use this text model everywhere by default (Chat, Adapt, Director) — you can change it in Settings">
                  <span><Button size="sm" variant="ghost" className="h-9 rounded-lg" onClick={makeDefault}>Make default</Button></span>
                </Tip>
              )}
              <Button className="h-9 rounded-lg px-4" disabled={!assistant || sending || loadingChat || (!text.trim() && !images.length)} onClick={send}>{sending ? <Spinner className="h-4 w-4 border-primary-foreground/30 border-t-primary-foreground" /> : "Send"}</Button>
            </div>
          </div>
          <DzMediaPicker open={picker} onOpenChange={setPicker} accept="image" max={Math.max(1, 4 - images.length)} apiKey={apiKey} onError={notify} title="Pictures for the chat"
            onPick={(list) => setImages((l) => [...l, ...list.filter((x) => !l.some((y) => y.url === x.url))].slice(0, 4))} />
          </section>
        </div>
      )}
      {viewing && (
        <div ref={dzScrollBoxRef} className="fixed inset-0 z-[150] flex items-center justify-center bg-overlay/90 p-6" onClick={() => setViewing(null)} role="dialog" aria-label="Picture">
          <img src={dzThumb(viewing, 2048)} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </SidePanel>
  );
}
