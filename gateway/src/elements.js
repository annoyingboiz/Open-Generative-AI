// Elements: named subjects (a character, an object, a place) with pictures —
// the first is the main one — and an optional video. They live in the user's
// Library (personal) or in a project (every member). Moving between the two is
// always a copy: edits never reach the other copy.
import { newId } from './storage.js';
import { now } from './db.js';

export class ElementError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const KINDS = ['character', 'object', 'place', 'other'];
const MAX_IMAGES = 8;
const MAX_NAME = 40;
const MAX_DESC = 300;

export function createElements({ db, projects, generations }) {
  const q = {
    insert: db.prepare(`INSERT INTO elements (id, owner_id, project_id, name, kind, description, images_json, video_url, source_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    byId: db.prepare('SELECT * FROM elements WHERE id = ? AND deleted_at IS NULL'),
    personal: db.prepare('SELECT * FROM elements WHERE owner_id = ? AND project_id IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500'),
    inProject: db.prepare('SELECT * FROM elements WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500'),
    update: db.prepare('UPDATE elements SET name = ?, kind = ?, description = ?, images_json = ?, video_url = ?, updated_at = ? WHERE id = ?'),
    remove: db.prepare('UPDATE elements SET deleted_at = ? WHERE id = ?'),
    author: db.prepare('SELECT display_name FROM users WHERE id = ?'),
  };

  const view = (row, user) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    images: JSON.parse(row.images_json || '[]'),
    video: row.video_url || null,
    project_id: row.project_id || null,
    source_id: row.source_id || null,
    mine: row.owner_id === user.id,
    author: row.owner_id === user.id ? undefined : q.author.get(row.owner_id)?.display_name || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  });

  // Personal: the owner only. In a project: its current members.
  function visible(user, id) {
    const row = q.byId.get(String(id || ''));
    const ok = row && (row.project_id ? projects.isMember(user.id, row.project_id) : row.owner_id === user.id);
    if (!ok) throw new ElementError('Element not found.', 404);
    return row;
  }

  // Where an element goes: personal (null) or a project the user is in (not archived).
  const scopeOf = (user, project) => (project && project !== 'none' ? projects.target(user, String(project), null).projectId : null);

  function clean({ name, kind, description }, current = {}) {
    const n = String(name ?? current.name ?? '').replace(/\s+/g, ' ').trim();
    if (!n) throw new ElementError('Give the element a name.');
    if (n.length > MAX_NAME) throw new ElementError(`The name is too long (max ${MAX_NAME}).`);
    const k = kind ?? current.kind ?? 'character';
    if (!KINDS.includes(k)) throw new ElementError('Unknown element type.');
    const d = String(description ?? current.description ?? '').trim();
    if (d.length > MAX_DESC) throw new ElementError(`The description is too long (max ${MAX_DESC}).`);
    return { name: n, kind: k, description: d };
  }

  // Every picture/video becomes a file in the element's own scope.
  async function adoptAll(user, projectId, images, video) {
    const list = [...new Set(Array.isArray(images) ? images.filter((u) => typeof u === 'string' && u) : [])].slice(0, MAX_IMAGES);
    const v = typeof video === 'string' && video ? video : null;
    // All files checked first, then copied together (nothing half-done on an error).
    const out = await generations.adoptMany(user, v ? [...list, v] : list, { projectId });
    return { images: v ? out.slice(0, -1) : out, video: v ? out[out.length - 1] : null };
  }

  function list(user, { project } = {}) {
    if (project && project !== 'none') {
      const p = projects.get(user, String(project)).project;
      return { elements: q.inProject.all(p.id).map((r) => view(r, user)) };
    }
    return { elements: q.personal.all(user.id).map((r) => view(r, user)) };
  }

  async function create(user, body = {}) {
    const projectId = scopeOf(user, body.project);
    const fields = clean(body);
    const { images, video } = await adoptAll(user, projectId, body.images, body.video);
    if (!images.length && !video) throw new ElementError('Add at least one picture or a video.');
    const id = newId('el');
    const t = now();
    q.insert.run(id, user.id, projectId, fields.name, fields.kind, fields.description, JSON.stringify(images), video, null, t, t);
    return { element: view(q.byId.get(id), user) };
  }

  // Anyone who sees it can edit it (personal: the owner; project: members).
  async function update(user, id, body = {}) {
    const row = visible(user, id);
    if (row.project_id && projects.get(user, row.project_id).project.archived_at) throw new ElementError('The project is archived.', 409);
    const fields = clean(body, row);
    let images = JSON.parse(row.images_json || '[]');
    let video = row.video_url;
    if (body.images !== undefined || body.video !== undefined) {
      const adopted = await adoptAll(user, row.project_id || null, body.images !== undefined ? body.images : images, body.video !== undefined ? body.video : video);
      images = adopted.images;
      video = adopted.video;
    }
    if (!images.length && !video) throw new ElementError('Add at least one picture or a video.');
    q.update.run(fields.name, fields.kind, fields.description, JSON.stringify(images), video, now(), row.id);
    return { element: view(q.byId.get(row.id), user) };
  }

  // Personal: the owner. Project: the author or the project owner.
  function remove(user, id) {
    const row = visible(user, id);
    if (row.project_id && row.owner_id !== user.id && projects.roleIn(user.id, row.project_id) !== 'owner') {
      throw new ElementError('Only the author or the project owner can delete it.', 403);
    }
    q.remove.run(now(), row.id);
    return { ok: true };
  }

  // A copy into the Library (project: null) or into a project — files included.
  async function copy(user, id, { project = null } = {}) {
    const row = visible(user, id);
    const projectId = scopeOf(user, project);
    if ((row.project_id || null) === projectId && (projectId || row.owner_id === user.id)) throw new ElementError('It is already there.', 409);
    const { images, video } = await adoptAll(user, projectId, JSON.parse(row.images_json || '[]'), row.video_url);
    const newIdValue = newId('el');
    const t = now();
    q.insert.run(newIdValue, user.id, projectId, row.name, row.kind, row.description, JSON.stringify(images), video, row.id, t, t);
    return { element: view(q.byId.get(newIdValue), user) };
  }

  return { list, create, update, remove, copy, visible, kinds: KINDS };
}
