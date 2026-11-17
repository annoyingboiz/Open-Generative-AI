"use client";

// DZ: projects — the context switcher in the header, the folder path, the
// projects page (list in Library, settings inside a project), Move to….
import React, { useEffect, useMemo, useState } from "react";
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
  const recent = active.filter((p) => p.id !== ctx.project?.id).slice(0, 5);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn("flex h-9 min-w-0 max-w-[260px] items-center gap-2 rounded-full border px-3 text-base font-semibold transition-colors",
            ctx.project ? "border-transparent text-foreground" : "border-border text-foreground/80 hover:bg-accent")}
          style={ctx.project ? { background: `${ctx.project.color}26`, boxShadow: `inset 0 0 0 1px ${ctx.project.color}66` } : undefined}
          aria-label={ctx.project ? `Project ${ctx.project.name}. Switch` : "Library. Switch to a project"}
        >
          {ctx.project ? <Dot color={ctx.project.color} /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>}
          <span className="truncate">{ctx.project ? ctx.project.name : "Library"}</span>
          {ctx.project?.archived && <Badge variant="secondary">archived</Badge>}
          <span className="opacity-60">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem onSelect={() => onOpen(null)} className="gap-2 text-base">
          <span className="w-3" /> Library <span className="ml-auto text-muted-foreground">personal</span>
        </DropdownMenuItem>
        {recent.length > 0 && <DropdownMenuSeparator />}
        {recent.length > 0 && <DropdownMenuLabel className="text-muted-foreground">Recent projects</DropdownMenuLabel>}
        {recent.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => onOpen(p)} className="gap-2 text-base">
            <Dot color={p.color} /> <span className="truncate">{p.name}</span>
            {p.role === "member" && <span className="ml-auto text-muted-foreground">shared</span>}
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
          <FolderIcon /> Project root {!ctx.folder && <span className="ml-auto">✓</span>}
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

export function MoveDialog({ item, onOpenChange, projects = [] }) {
  const open = Boolean(item);
  const [target, setTarget] = useState(null); // project id or null (Library)
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setTarget(item.project_id || null);
    setFolder(item.folder_id || null);
    setError("");
  }, [open, item]);
  useEffect(() => {
    if (!target) { setFolders([]); return undefined; }
    let alive = true;
    dzProjectsApi.details(target).then((d) => alive && setFolders(d.folders || [])).catch(() => alive && setFolders([]));
    return () => { alive = false; };
  }, [target]);
  const tree = useMemo(() => folderTree(folders), [folders]);
  const move = async () => {
    setBusy(true);
    setError("");
    try { await dzProjectsApi.move(item.id, target, target ? folder : null); onOpenChange(false); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const row = (selected) => cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-base", selected ? "bg-primary/15 text-foreground" : "hover:bg-accent text-foreground/85");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move to…</DialogTitle>
          <DialogDescription>Personal work is only yours. In a project, every member sees it.</DialogDescription>
        </DialogHeader>
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
          <Button onClick={move} disabled={busy || (target === (item?.project_id || null) && (folder || null) === (item?.folder_id || null))}>{busy ? <Spinner /> : "Move"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
