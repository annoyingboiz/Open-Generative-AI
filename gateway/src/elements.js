// Elements: named subjects (a character, a prop, a place, …) to reuse across
// generations. Each has:
//   tag      — its @name in prompts (@char_mike), unique where it lives
//   views    — any number of labelled pictures, the first is the main one
//   videos   — several labelled clips (uploaded, or generated from its views)
//   description (rules for models, ≤400), notes (free text), draft/active
// They live in the user's Library (personal) or in a project (every member).
// Moving between the two is always a copy; a copy can be refreshed from its
// source ("Update from Library").
import { newId } from './storage.js';
import { now } from './db.js';

export class ElementError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const KINDS = ['character', 'object', 'place', 'other'];
const STATUSES = ['draft', 'active'];
const MAX_VIEWS = 24;
const MAX_VIDEOS = 8;
const MAX_NAME = 40;
const MAX_DESC = 400;
const MAX_NOTES = 2000;
const MAX_LABEL = 40;
const TAG_PREFIX = { character: 'char', object: 'prop', place: 'loc', other: 'obj' };
const TAG_RE = /^[a-z][a-z0-9_]{1,39}$/;
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', є: 'ye', ё: 'e', ж: 'zh', з: 'z', и: 'i', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

// "Анна" (character) → "char_anna".
export function tagFor(name, kind) {
  const latin = String(name || '').toLowerCase().split('').map((c) => CYR[c] ?? c).join('');
  const slug = latin.normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'x';
  return `${TAG_PREFIX[kind] || 'obj'}_${slug}`;
}

export function createElements({ db, projects, generations, log }) {
  const q = {
    insert: db.prepare(`INSERT INTO elements (id, owner_id, project_id, name, kind, description, images_json, video_url, source_id, tag, status, notes, views_json, videos_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    byId: db.prepare('SELECT * FROM elements WHERE id = ? AND deleted_at IS NULL'),
    personal: db.prepare('SELECT * FROM elements WHERE owner_id = ? AND project_id IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500'),
    inProject: db.prepare('SELECT * FROM elements WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500'),
    update: db.prepare(`UPDATE elements SET name = ?, kind = ?, description = ?, tag = ?, status = ?, notes = ?, views_json = ?, videos_json = ?,
      images_json = ?, video_url = ?, updated_at = ? WHERE id = ?`),
    setVideos: db.prepare('UPDATE elements SET videos_json = ?, video_url = ?, updated_at = ? WHERE id = ?'),
    remove: db.prepare('UPDATE elements SET deleted_at = ? WHERE id = ?'),
    author: db.prepare('SELECT display_name FROM users WHERE id = ?'),
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    tagTakenPersonal: db.prepare('SELECT id FROM elements WHERE owner_id = ? AND project_id IS NULL AND tag = ? AND deleted_at IS NULL'),
    tagTakenProject: db.prepare('SELECT id FROM elements WHERE project_id = ? AND tag = ? AND deleted_at IS NULL'),
    noTag: db.prepare('SELECT id, owner_id, project_id, name, kind FROM elements WHERE tag IS NULL AND deleted_at IS NULL'),
    liveTags: db.prepare('SELECT owner_id, project_id, tag FROM elements WHERE tag IS NOT NULL AND deleted_at IS NULL'),
    setTag: db.prepare('UPDATE elements SET tag = ? WHERE id = ?'),
    forElementJobs: db.prepare(`SELECT * FROM generations WHERE status = 'completed' AND kind = 'video' AND completed_at > ? AND meta_json LIKE '%"forElement"%' ORDER BY completed_at LIMIT 200`),
  };

  const takenBy = (ownerId, projectId, tag) => (projectId ? q.tagTakenProject.get(projectId, tag) : q.tagTakenPersonal.get(ownerId, tag))?.id || null;
  // The wanted tag, or the first free "<tag>_2", "<tag>_3", … where it lives.
  function freeTag(ownerId, projectId, wanted, selfId = null) {
    const base = wanted.slice(0, 33);
    for (let n = 1; n < 10_000; n += 1) {
      const t = n === 1 ? base : `${base}_${n}`;
      const by = takenBy(ownerId, projectId, t);
      if (!by || by === selfId) return t;
    }
    throw new ElementError('No free tag left for this name.', 409);
  }
  // Elements made before tags existed get one — tags per place kept in memory, one pass.
  {
    const rows = q.noTag.all();
    if (rows.length) {
      const scope = (r) => (r.project_id ? `p:${r.project_id}` : `u:${r.owner_id}`);
      const used = new Map();
      for (const r of q.liveTags.all()) { if (!used.has(scope(r))) used.set(scope(r), new Set()); used.get(scope(r)).add(r.tag); }
      db.exec('BEGIN');
      try {
        for (const r of rows) {
          const set = used.get(scope(r)) || new Set();
          used.set(scope(r), set);
          const base = tagFor(r.name, r.kind).slice(0, 33);
          let t = base;
          for (let n = 2; set.has(t); n += 1) t = `${base}_${n}`;
          set.add(t);
          q.setTag.run(t, r.id);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  }
  const isTagClash = (error) => /UNIQUE constraint failed: elements\./.test(String(error?.message || ''));

  const parse = (text) => { try { const v = JSON.parse(text || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const view = (row, user) => {
    const views = parse(row.views_json);
    const videos = parse(row.videos_json);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      tag: row.tag,
      status: row.status || 'active',
      description: row.description,
      notes: row.notes || '',
      views,
      videos,
      // For older callers: the pictures and the first video.
      images: views.map((v) => v.url),
      video: videos[0]?.url || null,
      project_id: row.project_id || null,
      source_id: row.source_id || null,
      mine: row.owner_id === user.id,
      author: row.owner_id === user.id ? undefined : q.author.get(row.owner_id)?.display_name || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  };

  // Personal: the owner only. In a project: its current members.
  function visible(user, id) {
    const row = q.byId.get(String(id || ''));
    const ok = row && (row.project_id ? projects.isMember(user.id, row.project_id) : row.owner_id === user.id);
    if (!ok) throw new ElementError('Element not found.', 404);
    return row;
  }
  function editable(user, id) {
    const row = visible(user, id);
    if (row.project_id && projects.get(user, row.project_id).project.archived_at) throw new ElementError('The project is archived.', 409);
    return row;
  }

  // Where an element goes: personal (null) or a project the user is in (not archived).
  const scopeOf = (user, project) => (project && project !== 'none' ? projects.target(user, String(project), null).projectId : null);

  function clean(body, current = {}) {
    const n = String(body.name ?? current.name ?? '').replace(/\s+/g, ' ').trim();
    if (!n) throw new ElementError('Give the element a name.');
    if (n.length > MAX_NAME) throw new ElementError(`The name is too long (max ${MAX_NAME}).`);
    const k = body.kind ?? current.kind ?? 'character';
    if (!KINDS.includes(k)) throw new ElementError('Unknown element type.');
    const d = String(body.description ?? current.description ?? '').trim();
    if (d.length > MAX_DESC) throw new ElementError(`The description is too long (max ${MAX_DESC}).`);
    const notes = String(body.notes ?? current.notes ?? '').trim();
    if (notes.length > MAX_NOTES) throw new ElementError(`Notes are too long (max ${MAX_NOTES}).`);
    const status = body.status ?? current.status ?? 'active';
    if (!STATUSES.includes(status)) throw new ElementError('Unknown status.');
    let tag = body.tag != null && body.tag !== '' ? String(body.tag).trim().replace(/^@/, '').toLowerCase() : null;
    if (tag && !TAG_RE.test(tag)) throw new ElementError('A tag is 2–40 Latin letters, digits or _, starting with a letter.');
    return { name: n, kind: k, description: d, notes, status, tag };
  }

  // [{ url, label }] from views/videos (or the older images/video fields).
  const media = (list, max, what) => {
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      const url = typeof x === 'string' ? x : typeof x?.url === 'string' ? x.url : '';
      if (!url || out.some((o) => o.url === url)) continue;
      out.push({ url, label: String(typeof x === 'object' && x?.label ? x.label : '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL) });
    }
    if (out.length > max) throw new ElementError(`Too many ${what} (max ${max}).`);
    return out;
  };
  const viewsIn = (body, fallback) => (body.views !== undefined ? media(body.views, MAX_VIEWS, 'views') : body.images !== undefined ? media(body.images, MAX_VIEWS, 'views') : fallback);
  const videosIn = (body, fallback) => (body.videos !== undefined ? media(body.videos, MAX_VIDEOS, 'videos') : body.video !== undefined ? media(body.video ? [body.video] : [], MAX_VIDEOS, 'videos') : fallback);

  // Every file becomes a file in the element's own scope (all or nothing).
  async function adoptAll(user, projectId, views, videos) {
    const urls = [...views, ...videos].map((x) => x.url);
    const out = await generations.adoptMany(user, urls, { projectId });
    return {
      views: views.map((v, i) => ({ ...v, url: out[i] })),
      videos: videos.map((v, i) => ({ ...v, url: out[views.length + i] })),
    };
  }

  function list(user, { project } = {}) {
    if (project && project !== 'none') {
      const p = projects.get(user, String(project)).project;
      return { elements: q.inProject.all(p.id).map((r) => view(r, user)) };
    }
    return { elements: q.personal.all(user.id).map((r) => view(r, user)) };
  }

  // `tag` is taken as is when `exact`; otherwise the next free one is used if it got taken meanwhile.
  function insert(user, projectId, f, views, videos, sourceId, tag, { exact = false } = {}) {
    const id = newId('el');
    const t = now();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const useTag = attempt === 0 ? tag : freeTag(user.id, projectId, tag);
      try {
        q.insert.run(id, user.id, projectId, f.name, f.kind, f.description, JSON.stringify(views.map((v) => v.url)), videos[0]?.url || null, sourceId,
          useTag, f.status, f.notes, JSON.stringify(views), JSON.stringify(videos), t, t);
        return q.byId.get(id);
      } catch (error) {
        if (!isTagClash(error)) throw error;
        if (exact) throw new ElementError(`The tag @${tag} is already used here.`, 409);
      }
    }
    throw new ElementError('Could not give this element a free tag. Try again.', 409);
  }

  async function create(user, body = {}) {
    const projectId = scopeOf(user, body.project);
    const f = clean(body);
    const wantedViews = viewsIn(body, []);
    const wantedVideos = videosIn(body, []);
    if (!wantedViews.length && !wantedVideos.length) throw new ElementError('Add at least one picture or a video.');
    const tag = f.tag ? (takenBy(user.id, projectId, f.tag) ? null : f.tag) : freeTag(user.id, projectId, tagFor(f.name, f.kind));
    if (!tag) throw new ElementError(`The tag @${f.tag} is already used here.`, 409);
    const { views, videos } = await adoptAll(user, projectId, wantedViews, wantedVideos);
    return { element: view(insert(user, projectId, f, views, videos, null, tag, { exact: Boolean(f.tag) }), user) };
  }

  // Anyone who sees it can edit it (personal: the owner; project: members).
  async function update(user, id, body = {}) {
    const row = editable(user, id);
    const f = clean(body, row);
    let tag = row.tag;
    if (f.tag && f.tag !== row.tag) {
      const by = takenBy(row.owner_id, row.project_id, f.tag);
      if (by && by !== row.id) throw new ElementError(`The tag @${f.tag} is already used here.`, 409);
      tag = f.tag;
    }
    let views = viewsIn(body, parse(row.views_json));
    let videos = videosIn(body, parse(row.videos_json));
    if (body.views !== undefined || body.images !== undefined || body.videos !== undefined || body.video !== undefined) {
      ({ views, videos } = await adoptAll(user, row.project_id || null, views, videos));
    }
    if (!views.length && !videos.length) throw new ElementError('Add at least one picture or a video.');
    try {
      q.update.run(f.name, f.kind, f.description, tag, f.status, f.notes, JSON.stringify(views), JSON.stringify(videos),
        JSON.stringify(views.map((v) => v.url)), videos[0]?.url || null, now(), row.id);
    } catch (error) {
      if (isTagClash(error)) throw new ElementError(`The tag @${tag} is already used here.`, 409);
      throw error;
    }
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
  // `duplicate: true` makes a second one in the same place.
  async function copy(user, id, { project = null, duplicate = false } = {}) {
    const row = visible(user, id);
    const projectId = duplicate ? (row.project_id || null) : scopeOf(user, project);
    if (duplicate && row.project_id) editable(user, id);
    if (!duplicate && (row.project_id || null) === projectId && (projectId || row.owner_id === user.id)) throw new ElementError('It is already there.', 409);
    const { views, videos } = await adoptAll(user, projectId, parse(row.views_json), parse(row.videos_json));
    const f = { name: row.name, kind: row.kind, description: row.description, notes: row.notes || '', status: row.status || 'active' };
    const tag = freeTag(user.id, projectId, row.tag || tagFor(row.name, row.kind));
    return { element: view(insert(user, projectId, duplicate ? { ...f, name: `${row.name} copy`.slice(0, MAX_NAME) } : f, views, videos, duplicate ? null : row.id, tag), user) };
  }

  // A copy takes everything from its source again (its own tag and status stay).
  async function sync(user, id) {
    const row = editable(user, id);
    if (!row.source_id) throw new ElementError('This element is not a copy.', 409);
    let src;
    try { src = visible(user, row.source_id); } catch { throw new ElementError('The original is gone or you no longer see it.', 404); }
    const { views, videos } = await adoptAll(user, row.project_id || null, parse(src.views_json), parse(src.videos_json));
    q.update.run(src.name, src.kind, src.description, row.tag, row.status || 'active', src.notes || '', JSON.stringify(views), JSON.stringify(videos),
      JSON.stringify(views.map((v) => v.url)), videos[0]?.url || null, now(), row.id);
    return { element: view(q.byId.get(row.id), user) };
  }

  // A finished video made "for an element" (Generate video element): it joins
  // the element's videos under the label given at submit time. Safe to run
  // again for the same job (it is attached once); retried for recent jobs.
  async function attachGenerated(gen) {
    let meta = null;
    try { meta = gen?.meta_json ? JSON.parse(gen.meta_json) : null; } catch { return; }
    const target = meta?.forElement;
    if (!target?.id || gen.status !== 'completed' || gen.kind !== 'video') return;
    const outputs = JSON.parse(gen.outputs_json || '[]');
    const out = outputs[0];
    if (!out || !String(out.mime || '').startsWith('video/')) return;
    const user = q.user.get(gen.user_id);
    if (!user) return;
    let row;
    try { row = editable(user, target.id); } catch { return; } // gone, or not theirs to change
    const has = (r) => parse(r.videos_json).some((v) => v.from === gen.id);
    if (has(row)) return;
    if (parse(row.videos_json).length >= MAX_VIDEOS) { log?.warn?.(`element ${row.id} is full; video ${gen.id} not added`); return; }
    const [own] = await generations.adoptMany(user, [`/media/g/${gen.id}/0.${out.ext}`], { projectId: row.project_id || null });
    const fresh = q.byId.get(row.id);
    if (!fresh || has(fresh)) return;
    const videos = parse(fresh.videos_json);
    if (videos.length >= MAX_VIDEOS) return;
    videos.push({ url: own, label: String(target.label || 'Generated').slice(0, MAX_LABEL), from: gen.id });
    q.setVideos.run(JSON.stringify(videos), videos[0]?.url || null, now(), row.id);
  }
  // Jobs from the last week whose video is not in its element yet (a restart, an error).
  async function attachPending() {
    for (const gen of q.forElementJobs.all(now() - 7 * 86_400_000)) {
      try { await attachGenerated(gen); } catch (error) { log?.warn?.(`element video ${gen.id}: ${error.message}`); }
    }
  }

  return { list, create, update, remove, copy, sync, attachGenerated, attachPending, visible, kinds: KINDS };
}
