// Projects: a shared working context. Members see and add to everything in a
// project; personal history (no project) stays visible to its author only.
// Folders nest inside a project. One workspace for now (workspace_id = 1).
import crypto from 'node:crypto';
import { newId } from './storage.js';
import { now } from './db.js';

export class ProjectError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const PROJECT_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#f87171'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_NAME = 80;
const MAX_FOLDERS = 500;
const MAX_DEPTH = 6;

const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', є: 'ye', ё: 'e', ж: 'zh', з: 'z', и: 'i', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export function slugBase(name) {
  const latin = String(name || '').toLowerCase().split('').map((c) => CYR[c] ?? c).join('');
  return latin.normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
}

function cleanName(name, what = 'Name') {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) throw new ProjectError(`${what} can't be empty.`);
  if (n.length > MAX_NAME) throw new ProjectError(`${what} is too long (max ${MAX_NAME}).`);
  return n;
}

export function createProjects({ db }) {
  const q = {
    insert: db.prepare('INSERT INTO projects (id, owner_id, name, slug, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    addMember: db.prepare('INSERT INTO project_members (project_id, user_id, role, added_at, last_used_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, user_id) DO NOTHING'),
    removeMember: db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ? AND role != 'owner'"),
    member: db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'),
    byId: db.prepare('SELECT * FROM projects WHERE id = ?'),
    bySlug: db.prepare('SELECT * FROM projects WHERE slug = ?'),
    slugTaken: db.prepare('SELECT 1 FROM projects WHERE slug = ?'),
    mine: db.prepare(`SELECT p.*, m.role, m.last_used_at,
        (SELECT COUNT(*) FROM project_members x WHERE x.project_id = p.id) AS members,
        (SELECT COUNT(*) FROM generations g WHERE g.project_id = p.id AND g.deleted_at IS NULL AND g.purged_at IS NULL) AS items
      FROM projects p JOIN project_members m ON m.project_id = p.id
      WHERE m.user_id = ? ORDER BY (p.archived_at IS NOT NULL), COALESCE(m.last_used_at, p.created_at) DESC`),
    memberIds: db.prepare('SELECT project_id FROM project_members WHERE user_id = ?'),
    members: db.prepare(`SELECT u.id, u.username, u.display_name, m.role, m.added_at FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ? ORDER BY (m.role = 'owner') DESC, u.display_name`),
    touch: db.prepare('UPDATE project_members SET last_used_at = ? WHERE project_id = ? AND user_id = ?'),
    update: db.prepare('UPDATE projects SET name = ?, color = ?, archived_at = ?, updated_at = ? WHERE id = ?'),
    folders: db.prepare('SELECT id, parent_id, name, created_at FROM folders WHERE project_id = ? ORDER BY name COLLATE NOCASE'),
    folder: db.prepare('SELECT * FROM folders WHERE id = ?'),
    folderCount: db.prepare('SELECT COUNT(*) AS n FROM folders WHERE project_id = ?'),
    insertFolder: db.prepare('INSERT INTO folders (id, project_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    updateFolder: db.prepare('UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?'),
    deleteFolder: db.prepare('DELETE FROM folders WHERE id = ?'),
    moveGenerationsUp: db.prepare('UPDATE generations SET folder_id = ? WHERE folder_id = ?'),
    moveUploadsUp: db.prepare('UPDATE uploads SET folder_id = ? WHERE folder_id = ?'),
    moveFoldersUp: db.prepare('UPDATE folders SET parent_id = ?, updated_at = ? WHERE parent_id = ?'),
    user: db.prepare('SELECT id, username, display_name, disabled FROM users WHERE username = ? COLLATE NOCASE'),
    users: db.prepare('SELECT id, username, display_name FROM users WHERE disabled = 0 ORDER BY display_name'),
  };

  const roleIn = (userId, projectId) => (projectId ? q.member.get(projectId, userId)?.role || null : null);
  const isMember = (userId, projectId) => Boolean(roleIn(userId, projectId));
  const memberProjectIds = (userId) => q.memberIds.all(userId).map((r) => r.project_id);

  function publicProject(p, extra = {}) {
    return {
      id: p.id, name: p.name, slug: p.slug, color: p.color,
      archived: p.archived_at != null, created_at: p.created_at,
      role: extra.role ?? p.role ?? null,
      members: p.members ?? undefined, items: p.items ?? undefined, last_used_at: p.last_used_at ?? undefined,
    };
  }

  // A project the user may see, by id or slug; 404 otherwise (no existence leak).
  function get(user, idOrSlug) {
    const p = q.byId.get(String(idOrSlug || '')) || q.bySlug.get(String(idOrSlug || ''));
    const role = p && roleIn(user.id, p.id);
    if (!role) throw new ProjectError('Project not found.', 404);
    return { project: p, role };
  }
  function requireOwner(user, id) {
    const r = get(user, id);
    if (r.role !== 'owner') throw new ProjectError('Only the project owner can do this.', 403);
    return r;
  }

  function uniqueSlug(name) {
    const base = slugBase(name);
    if (!q.slugTaken.get(base)) return base;
    for (let i = 0; i < 20; i += 1) {
      const s = `${base}-${crypto.randomBytes(2).toString('hex')}`;
      if (!q.slugTaken.get(s)) return s;
    }
    return `${base}-${crypto.randomBytes(6).toString('hex')}`;
  }

  function list(user) {
    return q.mine.all(user.id).map((p) => publicProject(p));
  }

  function create(user, { name, color } = {}) {
    const n = cleanName(name);
    const c = COLOR_RE.test(String(color || '')) ? color.toLowerCase() : PROJECT_COLORS[q.mine.all(user.id).length % PROJECT_COLORS.length];
    const id = newId('prj');
    const t = now();
    db.exec('BEGIN');
    try {
      q.insert.run(id, user.id, n, uniqueSlug(n), c, t, t);
      q.addMember.run(id, user.id, 'owner', t, t);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return details(user, id);
  }

  function details(user, idOrSlug) {
    const { project, role } = get(user, idOrSlug);
    return {
      project: publicProject(project, { role }),
      members: q.members.all(project.id).map((m) => ({ id: m.id, username: m.username, name: m.display_name, role: m.role })),
      folders: q.folders.all(project.id),
    };
  }

  function update(user, id, { name, color, archived } = {}) {
    const { project } = requireOwner(user, id);
    const n = name === undefined ? project.name : cleanName(name);
    const c = color === undefined ? project.color : COLOR_RE.test(String(color)) ? color.toLowerCase() : (() => { throw new ProjectError('Pick a color.'); })();
    const a = archived === undefined ? project.archived_at : archived ? (project.archived_at || now()) : null;
    q.update.run(n, c, a, now(), project.id);
    return details(user, project.id);
  }

  function touch(user, id) {
    const { project } = get(user, id);
    q.touch.run(now(), project.id, user.id);
    return { ok: true };
  }

  function addMember(user, id, username) {
    const { project } = requireOwner(user, id);
    const u = q.user.get(String(username || '').trim());
    if (!u || u.disabled) throw new ProjectError('No such account.', 404);
    q.addMember.run(project.id, u.id, 'member', now(), null);
    return details(user, project.id);
  }

  // The owner removes anyone but themselves; a member can leave.
  function removeMember(user, id, userId) {
    const { project, role } = get(user, id);
    const target = Number(userId);
    if (target !== user.id && role !== 'owner') throw new ProjectError('Only the project owner can do this.', 403);
    if (roleIn(target, project.id) === 'owner') throw new ProjectError('The owner can’t leave their own project. Archive it instead.', 409);
    q.removeMember.run(project.id, target);
    return target === user.id ? { ok: true, left: true } : details(user, project.id);
  }

  // ── Folders ─────────────────────────────────────────────────────────────
  function folderIn(projectId, folderId) {
    if (!folderId) return null;
    const f = q.folder.get(String(folderId));
    if (!f || f.project_id !== projectId) throw new ProjectError('Folder not found.', 404);
    return f;
  }
  function depthOf(f) {
    let d = 0;
    for (let cur = f; cur?.parent_id && d <= MAX_DEPTH + 1; cur = q.folder.get(cur.parent_id)) d += 1;
    return d;
  }

  function createFolder(user, id, { name, parent } = {}) {
    const { project } = get(user, id);
    if (project.archived_at) throw new ProjectError('The project is archived.', 409);
    const n = cleanName(name, 'Folder name');
    const p = folderIn(project.id, parent);
    if (p && depthOf(p) + 1 >= MAX_DEPTH) throw new ProjectError(`Folders nest up to ${MAX_DEPTH} levels.`, 409);
    if (q.folderCount.get(project.id).n >= MAX_FOLDERS) throw new ProjectError('Too many folders in this project.', 409);
    const fid = newId('fld');
    const t = now();
    q.insertFolder.run(fid, project.id, p?.id || null, n, t, t);
    return { folder: { id: fid, parent_id: p?.id || null, name: n, created_at: t }, folders: q.folders.all(project.id) };
  }

  function updateFolder(user, folderId, { name, parent } = {}) {
    const f = q.folder.get(String(folderId || ''));
    if (!f) throw new ProjectError('Folder not found.', 404);
    get(user, f.project_id);
    const n = name === undefined ? f.name : cleanName(name, 'Folder name');
    let parentId = f.parent_id;
    if (parent !== undefined) {
      const p = folderIn(f.project_id, parent || null);
      // No folder inside itself or its own subfolder.
      for (let cur = p; cur; cur = cur.parent_id ? q.folder.get(cur.parent_id) : null) {
        if (cur.id === f.id) throw new ProjectError('A folder can’t go inside itself.', 409);
      }
      if (p && depthOf(p) + 1 >= MAX_DEPTH) throw new ProjectError(`Folders nest up to ${MAX_DEPTH} levels.`, 409);
      parentId = p?.id || null;
    }
    q.updateFolder.run(n, parentId, now(), f.id);
    return { folders: q.folders.all(f.project_id) };
  }

  // Deleting a folder keeps its contents: they move one level up.
  function deleteFolder(user, folderId) {
    const f = q.folder.get(String(folderId || ''));
    if (!f) throw new ProjectError('Folder not found.', 404);
    get(user, f.project_id);
    db.exec('BEGIN');
    try {
      q.moveGenerationsUp.run(f.parent_id, f.id);
      q.moveUploadsUp.run(f.parent_id, f.id);
      q.moveFoldersUp.run(f.parent_id, now(), f.id);
      q.deleteFolder.run(f.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { folders: q.folders.all(f.project_id) };
  }

  // Where a new item goes: { projectId, folderId } after access checks.
  function target(user, project, folder) {
    if (!project) return { projectId: null, folderId: null };
    const { project: p } = get(user, project);
    if (p.archived_at) throw new ProjectError('This project is archived. Restore it to add new work.', 409);
    const f = folderIn(p.id, folder);
    return { projectId: p.id, folderId: f?.id || null };
  }

  return {
    list, create, details, update, touch, addMember, removeMember,
    createFolder, updateFolder, deleteFolder, target,
    isMember, roleIn, memberProjectIds, get,
    users: () => q.users.all().map((u) => ({ id: u.id, username: u.username, name: u.display_name })),
    colors: PROJECT_COLORS,
  };
}
