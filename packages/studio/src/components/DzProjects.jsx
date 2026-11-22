"use client";

// DZ: projects — the context switcher in the header, the folder path, the
// projects page (list in Library, settings inside a project), Move to….
import React, { useEffect, useMemo, useState } from "react";
import { Check } from "@phosphor-icons/react";
import { Button, Input, Badge, Spinner, cn, DialogParts, DropdownMenuParts } from "../ui/index.js";

const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = DialogParts;
const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } = DropdownMenuParts;

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
  return data;
}

export const dzProjectsApi = {
  list: () => call("GET", "/dz/api/projects"),
  create: (name, color) => call("POST", "/dz/api/projects", { name, color }),
  details: (id) => call("GET", `/dz/api/projects/${encodeURIComponent(id)}`),
  update: (id, patch) => call("PATCH", `/dz/api/projects/${encodeURIComponent(id)}`, patch),
  touch: (id) => call("POST", `/dz/api/projects/${encodeURIComponent(id)}/touch`),
  addMember: (id, username) => call("POST", `/dz/api/projects/${encodeURIComponent(id)}/members`, { username }),
  removeMember: (id, userId) => call("DELETE", `/dz/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`),
  createFolder: (id, name, parent) => call("POST", `/dz/api/projects/${encodeURIComponent(id)}/folders`, { name, parent: parent || null }),
  updateFolder: (folderId, patch) => call("PATCH", `/dz/api/folders/${encodeURIComponent(folderId)}`, patch),
  deleteFolder: (folderId) => call("DELETE", `/dz/api/folders/${encodeURIComponent(folderId)}`),
  users: () => call("GET", "/dz/api/users"),
  batch: async (action, ids, project, folder) => {
    const r = await call("POST", "/api/v1/predictions/batch", { action, ids, project: project || null, folder: folder || null });
    window.dispatchEvent(new CustomEvent("dz:history", { detail: { status: "changed" } }));
    return r;
  },
  move: async (genId, project, folder) => {
    const r = await call("POST", `/api/v1/predictions/${encodeURIComponent(genId)}/move`, { project: project || null, folder: folder || null });
    window.dispatchEvent(new CustomEvent("dz:history", { detail: { status: "changed" } }));
    return r;
  },
};

// Flat folder list → [{ ...folder, depth }] in tree order.
export function folderTree(folders = []) {
  const byParent = new Map();
  for (const f of folders) {
    const k = f.parent_id || "";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(f);
  }
  const out = [];
  const walk = (parent, depth) => {
    for (const f of byParent.get(parent) || []) {
      out.push({ ...f, depth });
      if (depth < 8) walk(f.id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

const Dot = ({ color, className }) => <span className={cn("inline-block h-3 w-3 shrink-0 rounded-full", className)} style={{ background: color || "hsl(var(--muted-foreground))" }} />;

function FolderIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
}

// ── New project ──────────────────────────────────────────────────────────

export function NewProjectDialog({ open, onOpenChange, colors = [], onCreated }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setName(""); setColor(null); setError(""); } }, [open]);
  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await dzProjectsApi.create(name.trim(), color || undefined);
      onOpenChange(false);
      onCreated?.(r.project);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Everything you make while it is open goes into it. Add people later in its settings.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" maxLength={80} />
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
            {colors.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
                className={cn("h-8 w-8 rounded-full border-2 transition", color === c ? "border-foreground scale-110" : "border-transparent")} style={{ background: c }} />
            ))}
          </div>
          {error && <p className="text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || busy}>{busy ? <Spinner /> : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Header: context chip + folder path ───────────────────────────────────

export function ProjectSwitcher({ ctx, projects = [], onOpen, onNew, onAll }) {
  const active = projects.filter((p) => !p.archived);
  // The current place carries a check mark (package 14, 3.16): it is listed first among the projects.
  const current = ctx.project ? active.find((p) => p.id === ctx.project.id) || ctx.project : null;
  const recent = [...(current ? [current] : []), ...active.filter((p) => p.id !== ctx.project?.id).slice(0, 5)];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 max-w-[240px] items-center gap-2 rounded-md border border-border px-2.5 text-base font-medium text-foreground transition-colors duration-state hover:bg-accent"
          aria-label={ctx.project ? `Project ${ctx.project.name}. Switch` : "Library. Switch to a project"}
        >
          {ctx.project && <Dot color={ctx.project.color} />}
          <span className="truncate">{ctx.project ? ctx.project.name : "Library"}</span>
          {ctx.project?.archived && <span className="text-sm text-muted-foreground">archived</span>}
          <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" className="shrink-0 text-muted-foreground" aria-hidden="true"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" /></svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem onSelect={() => onOpen(null)} className="gap-2 text-base">
          <span className="w-3" /> Library <span className="ml-auto text-muted-foreground">personal</span>
          {!ctx.project && <Check size={16} className="text-foreground" aria-label="Current" />}
        </DropdownMenuItem>
        {recent.length > 0 && <DropdownMenuSeparator />}
        {recent.length > 0 && <DropdownMenuLabel className="text-muted-foreground">Recent projects</DropdownMenuLabel>}
        {recent.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => onOpen(p)} className="gap-2 text-base">
            <Dot color={p.color} /> <span className="truncate">{p.name}</span>
            {p.role === "member" && <span className="ml-auto text-muted-foreground">shared</span>}
            {p.id === ctx.project?.id && <Check size={16} className={cn("text-foreground", p.role !== "member" && "ml-auto")} aria-label="Current" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAll} className="text-base">All projects…</DropdownMenuItem>
        <DropdownMenuItem onSelect={onNew} className="text-base">+ New project</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FolderPath({ ctx, folders = [], onFolder, onNewFolder }) {
  const tree = useMemo(() => folderTree(folders), [folders]);
  const current = folders.find((f) => f.id === ctx.folder);
  if (!ctx.project) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 min-w-0 max-w-[220px] items-center gap-1.5 rounded-lg px-2 text-base text-foreground/80 hover:bg-accent" aria-label="Folder for new work">
          <span className="opacity-50">/</span>
          <FolderIcon />
          <span className="truncate">{current ? current.name : "All"}</span>
          <span className="opacity-60">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-72 overflow-y-auto">
        <DropdownMenuLabel className="text-muted-foreground">New work goes to</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onFolder(null)} className="gap-2 text-base">
          <FolderIcon /> <span>All <span className="text-muted-foreground">— shows everything, new work at the top level</span></span> {!ctx.folder && <span className="ml-auto">✓</span>}
        </DropdownMenuItem>
        {tree.map((f) => (
          <DropdownMenuItem key={f.id} onSelect={() => onFolder(f.id)} className="gap-2 text-base" style={{ paddingLeft: 8 + (f.depth + 1) * 14 }}>
            <FolderIcon /> <span className="truncate">{f.name}</span> {ctx.folder === f.id && <span className="ml-auto">✓</span>}
          </DropdownMenuItem>
        ))}
        {!ctx.project.archived && <DropdownMenuSeparator />}
        {!ctx.project.archived && <DropdownMenuItem onSelect={onNewFolder} className="text-base">+ New folder{current ? ` in “${current.name}”` : ""}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NameDialog({ open, onOpenChange, title, description, placeholder, initial = "", submitLabel = "Save", onSubmit }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setValue(initial); setError(""); } }, [open, initial]);
  const submit = async (e) => {
    e?.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    try { await onSubmit(value.trim()); onOpenChange(false); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} maxLength={80} />
          {error && <p className="text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!value.trim() || busy}>{busy ? <Spinner /> : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Move to… ─────────────────────────────────────────────────────────────

// Move to… / Copy to…: one or many items into Library or a project and folder.
// `request` = { items: [...], mode: "move" | "copy" } (a single item works too).
// Move is for the author's own items; anything you can see can be copied.
export function MoveDialog({ item: request, onOpenChange, projects = [] }) {
  const open = Boolean(request);
  const items = useMemo(() => (!request ? [] : Array.isArray(request.items) ? request.items : request.id ? [request] : []), [request]);
  const [mode, setMode] = useState("move");
  const [target, setTarget] = useState(null); // project id or null (Library)
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const theirs = items.filter((i) => i.mine === false).length;
  const same = (key) => (items.length && items.every((i) => (i[key] || null) === (items[0][key] || null)) ? items[0][key] || null : undefined);
  const fromProject = same("project_id");
  const fromFolder = same("folder_id");
  useEffect(() => {
    if (!open) return;
    const m = request?.mode === "copy" || (items.length && items.every((i) => i.mine === false)) ? "copy" : "move";
    setMode(m);
    setTarget(fromProject === undefined ? null : fromProject);
    setFolder(fromProject === undefined ? null : fromFolder ?? null);
    setError("");
  }, [open, request]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fresh folders every time the dialog opens (a folder may have been added since).
  useEffect(() => {
    if (!open || !target) { setFolders([]); return undefined; }
    let alive = true;
    dzProjectsApi.details(target).then((d) => alive && setFolders(d.folders || [])).catch(() => alive && setFolders([]));
    return () => { alive = false; };
  }, [target, open, request]);
  const tree = useMemo(() => folderTree(folders), [folders]);
  const n = items.length;
  const movable = n - theirs;
  const unchanged = mode === "move" && fromProject !== undefined && fromFolder !== undefined && target === fromProject && (folder || null) === fromFolder;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const ids = (mode === "move" ? items.filter((i) => i.mine !== false) : items).map((i) => i.id);
      const r = await dzProjectsApi.batch(mode, ids, target, target ? folder : null);
      const done = r.done?.length || 0;
      const verb = mode === "move" ? "Moved" : "Copied";
      const failed = r.failed || [];
      window.dispatchEvent(new CustomEvent("dz:notify", {
        detail: failed.length || (mode === "move" && theirs)
          ? { type: done ? "success" : "error", title: verb, message: `${verb} ${done} of ${n}.${failed[0]?.error ? ` ${failed[0].error}` : ""}${mode === "move" && theirs ? ` ${theirs} by others stay — copy them instead.` : ""}` }
          : { type: "success", title: verb, message: `${verb} ${done} item${done === 1 ? "" : "s"}.` },
      }));
      if (done) window.dispatchEvent(new CustomEvent("dz:moved"));
      if (!done && failed.length) { setError(failed[0].error || "Nothing was done."); return; }
      onOpenChange(false);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const row = (selected) => cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-base", selected ? "bg-signal/15 text-foreground" : "hover:bg-accent text-foreground/85");
  const what = n === 1 ? "1 item" : `${n} items`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "move" ? "Move" : "Copy"} {what} to…</DialogTitle>
          <DialogDescription>
            {mode === "move" ? "It leaves where it is now." : "The original stays; the copy is yours, with its own files, and costs nothing."} Personal work is only yours; in a project every member sees it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Move or copy">
          {["move", "copy"].map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={m === "move" && !movable}
              onClick={() => setMode(m)}
              className={cn("h-9 flex-1 rounded-lg font-semibold", mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground", m === "move" && !movable && "opacity-40")}>
              {m === "move" ? "Move" : "Copy"}
            </button>
          ))}
        </div>
        {mode === "move" && theirs > 0 && <p className="text-warning">{theirs} of them {theirs === 1 ? "was" : "were"} made by someone else — only the author can move it. Those stay; copy them instead.</p>}
        <div className="grid max-h-[50vh] gap-1 overflow-y-auto">
          <button className={row(!target)} onClick={() => { setTarget(null); setFolder(null); }}><span className="w-3" /> Library (personal)</button>
          {projects.filter((p) => !p.archived).map((p) => (
            <div key={p.id}>
              <button className={row(target === p.id && !folder)} onClick={() => { setTarget(p.id); setFolder(null); }}><Dot color={p.color} /> {p.name}</button>
              {target === p.id && tree.map((f) => (
                <button key={f.id} className={row(folder === f.id)} style={{ paddingLeft: 24 + (f.depth + 1) * 14 }} onClick={() => setFolder(f.id)}><FolderIcon /> {f.name}</button>
              ))}
            </div>
          ))}
        </div>
        {error && <p className="text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !n || unchanged || (mode === "move" && !movable)}>{busy ? <Spinner /> : mode === "move" ? "Move" : "Copy"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sidebar folder tree (inside a project) ─────────────────────────────────
// "All" plus the folders; click picks the folder (what you see and where new
// work goes). Folders open and close; the ⋯ menu adds, renames, deletes.
// Cards dragged onto a folder move there (only the author's own; others are reported).
export function FolderTree({ project, folders = [], current, onPick, onNew, onRename, onDelete, onDropItems, collapsed = false }) {
  const [closed, setClosed] = useState(() => new Set());
  const [over, setOver] = useState(undefined);
  useEffect(() => {
    try { setClosed(new Set(JSON.parse(localStorage.getItem(`dz_tree_${project.id}`) || "[]"))); } catch { setClosed(new Set()); }
  }, [project.id]);
  const toggle = (id) => setClosed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem(`dz_tree_${project.id}`, JSON.stringify([...next])); } catch { /* optional */ }
    return next;
  });
  const tree = useMemo(() => folderTree(folders), [folders]);
  const hasKids = useMemo(() => new Set(folders.map((f) => f.parent_id).filter(Boolean)), [folders]);
  // A folder shows when none of its parents is closed.
  const parentOf = useMemo(() => new Map(folders.map((f) => [f.id, f.parent_id || null])), [folders]);
  const shown = (f) => { let p = parentOf.get(f.id); while (p) { if (closed.has(p)) return false; p = parentOf.get(p); } return true; };
  // The current folder's parents stay open.
  useEffect(() => {
    if (!current) return;
    setClosed((prev) => { let p = parentOf.get(current); let next = prev; while (p) { if (next.has(p)) { next = new Set(next); next.delete(p); } p = parentOf.get(p); } return next; });
  }, [current, parentOf]);
  const dropProps = (folderId) => (project.archived || !onDropItems ? {} : {
    onDragOver: (e) => { if (Array.from(e.dataTransfer.types).includes("application/x-dz-items")) { e.preventDefault(); e.stopPropagation(); setOver(folderId); } },
    onDragLeave: () => setOver((o) => (o === folderId ? undefined : o)),
    onDrop: (e) => {
      const raw = e.dataTransfer.getData("application/x-dz-items");
      setOver(undefined);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      try { onDropItems(JSON.parse(raw), folderId); } catch { /* not ours */ }
    },
  });
  if (collapsed) return null;
  const rowCls = (active, isOver) => cn(
    "group flex h-9 w-full min-w-0 items-center gap-1.5 rounded-lg pr-1 text-left text-base transition-colors",
    active ? "bg-signal/15 font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
    isOver && "ring-2 ring-signal",
  );
  return (
    <div className="space-y-0.5" role="tree" aria-label="Folders">
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="text-base font-semibold text-muted-foreground/80">Folders</span>
        {!project.archived && <button type="button" onClick={() => onNew(null)} className="rounded-md px-1.5 text-lg leading-6 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="New folder" title="New folder">+</button>}
      </div>
      <button type="button" role="treeitem" aria-selected={!current} onClick={() => onPick(null)} className={rowCls(!current, over === null)} style={{ paddingLeft: 12 }} {...dropProps(null)}>
        <span className="w-4" />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
        <span className="truncate">All</span>
      </button>
      {tree.filter(shown).map((f) => (
        <div key={f.id} role="treeitem" aria-selected={current === f.id} aria-expanded={hasKids.has(f.id) ? !closed.has(f.id) : undefined}
          className={rowCls(current === f.id, over === f.id)} style={{ paddingLeft: 12 + f.depth * 14 }} {...dropProps(f.id)}>
          <button type="button" aria-label={closed.has(f.id) ? "Open" : "Close"} onClick={() => hasKids.has(f.id) && toggle(f.id)}
            className={cn("flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground", !hasKids.has(f.id) && "invisible")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={cn("transition-transform", !closed.has(f.id) && "rotate-90")}><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <button type="button" onClick={() => onPick(f.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <FolderIcon />
            <span className="truncate">{f.name}</span>
          </button>
          {!project.archived && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`Folder actions: ${f.name}`} className="h-7 w-7 shrink-0 rounded-md text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100">⋯</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem className="text-base" onSelect={() => onNew(f)}>New folder inside</DropdownMenuItem>
                <DropdownMenuItem className="text-base" onSelect={() => onRename(f)}>Rename</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-base text-destructive" onSelect={() => onDelete(f)}>Delete folder…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Projects page ────────────────────────────────────────────────────────

export function DzProjectsPage({ ctx, projects = [], colors = [], userId, onOpen, onNew, onChanged, onError }) {
  if (ctx.project) return <ProjectSettings ctx={ctx} colors={colors} userId={userId} onOpen={onOpen} onChanged={onChanged} onError={onError} />;
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  const card = (p) => (
    <button key={p.id} onClick={() => onOpen(p)} className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-foreground/30">
      <div className="h-1.5 w-12 rounded-full" style={{ background: p.color }} />
      <div className="text-xl font-semibold text-foreground">{p.name}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>{p.items || 0} items</span>
        <span>{p.members || 1} {p.members === 1 ? "person" : "people"}</span>
        {p.role === "member" && <span>shared with you</span>}
      </div>
    </button>
  );
  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Projects</h1>
            <p className="text-lg text-muted-foreground">Open a project to work inside it: everything you make goes there, for everyone in it.</p>
          </div>
          <Button onClick={onNew}>+ New project</Button>
        </div>
        {active.length === 0 && <p className="rounded-2xl border border-dashed border-border p-10 text-center text-lg text-muted-foreground">No projects yet.</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{active.map(card)}</div>
        {archived.length > 0 && (
          <>
            <h2 className="mb-3 mt-10 text-xl font-semibold text-muted-foreground">Archived</h2>
            <div className="grid gap-4 opacity-70 sm:grid-cols-2 lg:grid-cols-3">{archived.map(card)}</div>
          </>
        )}
      </div>
    </div>
  );
}

function ProjectSettings({ ctx, colors, userId, onOpen, onChanged, onError }) {
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [adding, setAdding] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState(null); // { mode: 'new'|'rename', folder?, parent? }
  const id = ctx.project.id;
  const reload = () => dzProjectsApi.details(id).then(setData).catch((e) => onError?.(e.message));
  useEffect(() => { reload(); dzProjectsApi.users().then((r) => setUsers(r.users || [])).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const owner = data?.project.role === "owner";
  const act = async (fn) => {
    try { const r = await fn(); if (r?.project || r?.members || r?.folders) await reload(); onChanged?.(); return r; } catch (e) { onError?.(e.message); return null; }
  };
  if (!data) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const memberIds = new Set(data.members.map((m) => m.id));
  const candidates = users.filter((u) => !memberIds.has(u.id));
  const tree = folderTree(data.folders);
  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="mx-auto grid max-w-3xl gap-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 h-1.5 w-14 rounded-full" style={{ background: data.project.color }} />
            <h1 className="text-3xl font-bold text-foreground">{data.project.name}</h1>
            <p className="text-lg text-muted-foreground">{owner ? "You own this project." : "Shared with you."} {data.project.archived && "Archived — nothing new can be added."}</p>
          </div>
          {owner && <Button variant="secondary" onClick={() => setRenameOpen(true)}>Rename</Button>}
        </div>

        {owner && (
          <section className="grid gap-3">
            <h2 className="text-xl font-semibold">Color</h2>
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <button key={c} aria-label={c} aria-pressed={data.project.color === c} onClick={() => act(() => dzProjectsApi.update(id, { color: c }))}
                  className={cn("h-9 w-9 rounded-full border-2", data.project.color === c ? "border-foreground" : "border-transparent")} style={{ background: c }} />
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">People</h2>
          <div className="grid gap-2">
            {data.members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
                <span className="font-semibold">{m.name}</span>
                <span className="text-muted-foreground">{m.username}</span>
                <span className="ml-auto text-muted-foreground">{m.role}</span>
                {owner && m.role !== "owner" && <Button size="sm" variant="ghost" onClick={() => act(() => dzProjectsApi.removeMember(id, m.id))}>Remove</Button>}
              </div>
            ))}
          </div>
          {owner && candidates.length > 0 && (
            <div className="flex gap-2">
              <select value={adding} onChange={(e) => setAdding(e.target.value)} className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-base">
                <option value="">Add a person…</option>
                {candidates.map((u) => <option key={u.id} value={u.username}>{u.name} ({u.username})</option>)}
              </select>
              <Button disabled={!adding} onClick={() => act(() => dzProjectsApi.addMember(id, adding)).then(() => setAdding(""))}>Add</Button>
            </div>
          )}
          <p className="text-muted-foreground">People in a project see and add to everything in it. Their personal Library stays private.</p>
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Folders</h2>
            {!data.project.archived && <Button size="sm" variant="secondary" onClick={() => setFolderDialog({ mode: "new" })}>+ Folder</Button>}
          </div>
          {tree.length === 0 && <p className="text-muted-foreground">No folders. New work goes to the project root.</p>}
          <div className="grid gap-1">
            {tree.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent" style={{ paddingLeft: 8 + f.depth * 18 }}>
                <FolderIcon /> <span className="truncate">{f.name}</span>
                <span className="ml-auto flex gap-1">
                  {!data.project.archived && <Button size="sm" variant="ghost" onClick={() => setFolderDialog({ mode: "new", parent: f })}>+ Inside</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setFolderDialog({ mode: "rename", folder: f })}>Rename</Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Delete “${f.name}”? Its work moves one level up.`)) act(() => dzProjectsApi.deleteFolder(f.id)); }}>Delete</Button>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-wrap gap-3 border-t border-border pt-6">
          {owner && <Button variant="secondary" onClick={() => act(() => dzProjectsApi.update(id, { archived: !data.project.archived }))}>{data.project.archived ? "Restore project" : "Archive project"}</Button>}
          {!owner && userId != null && <Button variant="ghost" onClick={async () => { if (!window.confirm("Leave this project? You will no longer see its work.")) return; const r = await act(() => dzProjectsApi.removeMember(id, userId)); if (r) onOpen(null); }}>Leave project</Button>}
        </section>
      </div>

      <NameDialog open={renameOpen} onOpenChange={setRenameOpen} title="Rename project" initial={data.project.name} placeholder="Project name"
        onSubmit={(name) => act(() => dzProjectsApi.update(id, { name })).then((r) => { if (!r) throw new Error("Not saved"); })} />
      <NameDialog open={Boolean(folderDialog)} onOpenChange={(o) => !o && setFolderDialog(null)}
        title={folderDialog?.mode === "rename" ? "Rename folder" : folderDialog?.parent ? `New folder in “${folderDialog.parent.name}”` : "New folder"}
        initial={folderDialog?.folder?.name || ""} placeholder="Folder name" submitLabel={folderDialog?.mode === "rename" ? "Save" : "Create"}
        onSubmit={(name) => act(() => (folderDialog.mode === "rename" ? dzProjectsApi.updateFolder(folderDialog.folder.id, { name }) : dzProjectsApi.createFolder(id, name, folderDialog.parent?.id))).then((r) => { if (!r) throw new Error("Not saved"); })} />
    </div>
  );
}
