// Storyboards (package 05: a film). Personal (Library) or in a project (every
// member sees and edits it), like Elements. A film has:
//   scenes  — ordered headings (name, one-line note), any number;
//   shots   — ordered, each in a scene, with a note and its references (any
//             number of pictures or videos, any aspect ratio; the first is the cover);
//   mood    — the Moodboard canvas: pictures, notes, arrows, text and frames;
//             a frame the user named is a group;
//   media   — per shot or group: what was generated for it (pictures, videos)
//             and, for a shot, the approved ones (any number; only by Approve).
//
// Two kinds of data, kept apart so they never overwrite each other:
//   edits   — name, note, scenes, shots, mood: saved with a revision number,
//             a stale save gets 409 instead of erasing someone's edit;
//   media   — filled by the server when a job made for a shot or a group
//             finishes (its target is in the job's meta), changed by
//             approve / remove / add. Nothing is approved automatically.
import { newId } from './storage.js';
import { now } from './db.js';
import fs from 'node:fs';
import { cleanShot, DEFAULT_LOOK } from './director.js';
import { stitch as stitchVideos, lastFrame as lastVideoFrame } from './edit.js';
import { cleanLook as cleanCameraLook } from './look.js';

export class StoryboardError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const MAX_NAME = 80;
const MAX_SCENE = 200_000; // the brief and the original documents kept with the film
const MAX_NOTE = 2000;
const MAX_SCENES = 500;
const MAX_SHOTS = 2000;
const MAX_REFS = 100; // per shot
const MAX_MEDIA = 600; // generated files per shot or group (approved ones are never dropped)
const MAX_MOOD = 1000; // items on the Moodboard
const MAX_SETTINGS = 16_384;
const SHOT_ID = /^[a-z0-9_-]{1,40}$/i;
const MEDIA_URL = /^\/media\/(g|u)\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/;
const ACTIVE = new Set(['submitting', 'submitted', 'processing', 'downloading']);

const parse = (t, fallback) => { try { const v = JSON.parse(t || ''); return v ?? fallback; } catch { return fallback; } };
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Studio settings (models, aspect, frames per shot, elements…): plain data, capped.
function cleanSettings(raw) {
  if (!isObj(raw)) return {};
  const keep = (v, depth = 0) => {
    if (v == null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
    if (typeof v === 'string') return v.slice(0, 500);
    if (depth > 3) return undefined;
    if (Array.isArray(v)) return v.slice(0, 40).map((x) => keep(x, depth + 1)).filter((x) => x !== undefined);
    if (isObj(v)) return Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [String(k).slice(0, 60), keep(x, depth + 1)]).filter(([, x]) => x !== undefined));
    return undefined;
  };
  const out = keep(raw);
  if (JSON.stringify(out).length > MAX_SETTINGS) throw new StoryboardError('Storyboard settings are too large.');
  return out;
}

// The board's look: camera defaults for every shot, plus filter, era and light (ids;
// names used before 18.11 are mapped).
function cleanLook(raw) {
  const l = isObj(raw) ? raw : {};
  const c = cleanCameraLook({ ...l, on: true }) || {};
  return {
    camera: c.camera || DEFAULT_LOOK.camera,
    lens: c.lens || DEFAULT_LOOK.lens,
    focal: c.focal || DEFAULT_LOOK.focal,
    aperture: c.aperture || DEFAULT_LOOK.aperture,
    filter: c.filter || null,
    era: c.era || null,
    light: c.light || null,
    note: String(l.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
  };
}

const line = (v, max) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v, lo, hi, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : fallback; };
const idOf = (v, prefix, seen) => {
  let id = String(v || '');
  if (!SHOT_ID.test(id) || seen.has(id)) id = newId(prefix).slice(0, 20);
  seen.add(id);
  return id;
};

// A picture or video of a shot: our own media URL, its kind and size (for its own aspect ratio).
function cleanRefs(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    const url = String(r?.url || '');
    if (!MEDIA_URL.test(url) || out.some((x) => x.url === url)) continue;
    const ref = { url, kind: r.kind === 'video' ? 'video' : 'image' };
    const w = num(r.w, 0, 20_000, 0);
    const h = num(r.h, 0, 20_000, 0);
    if (w > 0 && h > 0) Object.assign(ref, { w, h });
    if (r.name) ref.name = line(r.name, 80);
    out.push(ref);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

// Scenes: ordered headings. Every one gets a valid unique id.
function cleanScenes(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new StoryboardError('Scenes must be a list.');
  if (list.length > MAX_SCENES) throw new StoryboardError(`Up to ${MAX_SCENES} scenes.`);
  const seen = new Set();
  return list.map((sc) => ({ id: idOf(sc?.id, 'sc', seen), name: line(sc?.name, 80), note: line(sc?.note, 300) }));
}

// Shots from the studio: every one gets a valid unique id and a scene that exists.
function cleanShots(list, scenes = null) {
  if (!Array.isArray(list)) throw new StoryboardError('Shots must be a list.');
  if (list.length > MAX_SHOTS) throw new StoryboardError(`Up to ${MAX_SHOTS} shots.`);
  const seen = new Set();
  const sceneIds = scenes ? new Set(scenes.map((x) => x.id)) : null;
  return list.map((s) => {
    const id = idOf(s?.id, 's', seen);
    const scene = String(s?.scene || '');
    return {
      ...cleanShot(s, { id }),
      scene: sceneIds ? (sceneIds.has(scene) ? scene : scenes[0]?.id || '') : (SHOT_ID.test(scene) ? scene : ''),
      note: line(s?.note, 200),
      refs: cleanRefs(s?.refs),
    };
  });
}

// The Moodboard: free items. Frames are groups (the user named them).
const MOOD_TYPES = new Set(['image', 'video', 'note', 'text', 'arrow', 'frame']);
function cleanMood(raw) {
  const m = isObj(raw) ? raw : {};
  const list = Array.isArray(m.items) ? m.items : [];
  if (list.length > MAX_MOOD) throw new StoryboardError(`Up to ${MAX_MOOD} things on the Moodboard.`);
  const seen = new Set();
  const items = [];
  for (const it of list) {
    if (!isObj(it) || !MOOD_TYPES.has(it.type)) continue;
    const x = { id: idOf(it.id, it.type === 'frame' ? 'g' : 'm', seen), type: it.type, x: num(it.x, -1e6, 1e6), y: num(it.y, -1e6, 1e6), w: num(it.w, 0, 50_000, 200), h: num(it.h, 0, 50_000, 200) };
    if (it.type === 'image' || it.type === 'video') {
      const url = String(it.url || '');
      if (!MEDIA_URL.test(url)) continue;
      x.url = url;
    }
    if (it.type === 'note' || it.type === 'text') x.text = String(it.text ?? '').slice(0, MAX_NOTE);
    if (it.type === 'frame') x.name = line(it.name, 60);
    if (it.type === 'frame' || it.type === 'note') x.color = line(it.color, 20);
    if (it.type === 'arrow') { x.x2 = num(it.x2, -1e6, 1e6); x.y2 = num(it.y2, -1e6, 1e6); }
    if (Number.isFinite(Number(it.z))) x.z = num(it.z, -1e6, 1e6);
    items.push(x);
  }
  return { items };
}
// Where a job's result goes: { board, id, kind: 'shot'|'group' } — `target` in the
// job's meta (package 05), or `forShot` from before.
export function targetOf(meta) {
  const t = isObj(meta?.target) ? meta.target : null;
  if (t && typeof t.board === 'string' && SHOT_ID.test(String(t.id || ''))) return { board: t.board, id: String(t.id), kind: t.kind === 'group' ? 'group' : 'shot', step: t.step === 'video' ? 'video' : 'frame' };
  const f = isObj(meta?.forShot) ? meta.forShot : null;
  if (f && typeof f.board === 'string' && SHOT_ID.test(String(f.shot || ''))) return { board: f.board, id: String(f.shot), kind: 'shot', step: f.step === 'video' ? 'video' : 'frame' };
  return null;
}
// How long the media of a deleted shot or group is kept for Undo (in memory: a restart starts the clock again).
const MEDIA_GRACE_MS = 30 * 60_000;
const groupIds = (mood) => new Set((mood.items || []).filter((x) => x.type === 'frame').map((x) => x.id));

export function createStoryboards({ db, projects, generations, log }) {
  const q = {
    insert: db.prepare(`INSERT INTO storyboards (id, owner_id, project_id, name, scene, look_json, settings_json, shots_json, media_json, rev, created_at, updated_at, scenes_json, mood_json, note, v2)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, ?, ?, ?, ?, 1)`),
    byId: db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL'),
    personal: db.prepare('SELECT * FROM storyboards WHERE owner_id = ? AND project_id IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200'),
    inProject: db.prepare('SELECT * FROM storyboards WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200'),
    update: db.prepare('UPDATE storyboards SET name = ?, scene = ?, look_json = ?, settings_json = ?, shots_json = ?, scenes_json = ?, mood_json = ?, note = ?, rev = rev + 1, updated_by = ?, updated_at = ? WHERE id = ? AND rev = ?'),
    old: db.prepare('SELECT * FROM storyboards WHERE v2 = 0'),
    migrate: db.prepare('UPDATE storyboards SET scenes_json = ?, shots_json = ?, media_json = ?, v2 = 1 WHERE id = ? AND v2 = 0'),
    genMeta: db.prepare('SELECT id, user_id, project_id, status, studio, meta_json, outputs_json, completed_at FROM generations WHERE id = ?'),
    setMedia: db.prepare('UPDATE storyboards SET media_json = ?, updated_at = ? WHERE id = ?'),
    remove: db.prepare('UPDATE storyboards SET deleted_at = ? WHERE id = ?'),
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    author: db.prepare('SELECT display_name FROM users WHERE id = ?'),
    jobs: db.prepare(`SELECT id, user_id, project_id, status, error, meta_json, created_at, completed_at FROM generations
      WHERE created_at > ? AND deleted_at IS NULL AND instr(meta_json, ?) > 0 ORDER BY created_at`),
    genState: db.prepare('SELECT id, project_id, deleted_at, purged_at FROM generations WHERE id = ?'),
    uploadState: db.prepare('SELECT id, project_id FROM uploads WHERE id = ?'),
    forShotJobs: db.prepare(`SELECT * FROM generations WHERE status = 'completed' AND completed_at > ? AND (instr(meta_json, '"forShot"') > 0 OR instr(meta_json, '"target"') > 0) ORDER BY completed_at LIMIT 500`),
  };

  // Boards made before package 05, migrated in place once: one scene holding the
  // same shots (their title becomes the note), the picked frame and video become
  // the approved ones. Revisions are not changed.
  function migrateOld() {
    for (const row of q.old.all()) {
      try {
        const shots = parse(row.shots_json, []).filter(isObj);
        const scenes = shots.length ? [{ id: newId('sc').slice(0, 20), name: '', note: '' }] : [];
        const moved = shots.map((x) => ({ ...x, scene: scenes[0]?.id || '', note: line(x.note || x.title, 200), refs: Array.isArray(x.refs) ? x.refs : [] }));
        const media = parse(row.media_json, {});
        for (const m of Object.values(media)) {
          if (!isObj(m)) continue;
          if (!Array.isArray(m.approved)) m.approved = [m.frame, m.video].filter((u) => typeof u === 'string' && u);
          delete m.frame; delete m.video;
        }
        q.migrate.run(JSON.stringify(scenes), JSON.stringify(moved), JSON.stringify(media), row.id);
      } catch (error) { log?.warn?.(`storyboard ${row.id}: not migrated: ${error.message}`); }
    }
  }
  migrateOld();
  const isTarget = (row, id) => parse(row.shots_json, []).some((x) => x.id === id) || groupIds(parse(row.mood_json, {})).has(id);

  // A file of the board that can't be opened from it any more (sent to Trash,
  // purged, or moved out of the board's place) is marked `gone`.
  function isGone(row, url) {
    const place = row.project_id || null;
    let m = /^\/media\/g\/([^/]+)\//.exec(url);
    if (m) { const g = q.genState.get(m[1]); return !g || g.deleted_at != null || g.purged_at != null || (g.project_id || null) !== place; }
    m = /^\/media\/u\/([^.]+)\./.exec(url);
    if (m) { const u = q.uploadState.get(m[1]); return !u || (u.project_id || null) !== place; }
    return true;
  }
  // Per shot or group: files marked `gone` when they can't be opened any more;
  // `approved` keeps only live ones. `frame` / `video` are the first approved picture
  // and video (the cover, the print page, stitching).
  function withState(row, media) {
    const goneUrl = (url) => isGone(row, url);
    const out = {};
    for (const [shotId, m] of Object.entries(media || {})) {
      if (!isObj(m)) continue;
      const mark = (list) => (list || []).map((x) => (goneUrl(x.url) ? { ...x, gone: true } : x));
      const frames = mark(m.frames);
      const videos = mark(m.videos);
      const liveF = new Set(frames.filter((x) => !x.gone).map((x) => x.url));
      const liveV = new Set(videos.filter((x) => !x.gone).map((x) => x.url));
      const approved = (m.approved || []).filter((u) => liveF.has(u) || liveV.has(u));
      out[shotId] = { frames, videos, approved, frame: approved.find((u) => liveF.has(u)) || null, video: approved.find((u) => liveV.has(u)) || null };
    }
    return out;
  }
  const view = (row, user, extra = {}) => ({
    id: row.id,
    name: row.name,
    note: row.note || '',
    scene: row.scene,
    scenes: parse(row.scenes_json, []).filter(isObj),
    mood: cleanMood(parse(row.mood_json, {})),
    look: cleanLook(parse(row.look_json, {})),
    settings: parse(row.settings_json, {}),
    // Shots saved before 18.11 carry camera names: shown with today's ids.
    shots: parse(row.shots_json, []).filter(isObj).map((s) => ({ ...cleanShot(s, { id: s.id }), scene: String(s.scene || ''), note: line(s.note, 200), refs: cleanRefs(s.refs) })),
    // Only live shots and groups: a deleted one's media waits for Undo but is not shown.
    media: withState(row, (() => {
      const ids = new Set([...parse(row.shots_json, []).map((x) => x?.id), ...groupIds(parse(row.mood_json, {}))]);
      return Object.fromEntries(Object.entries(parse(row.media_json, {})).filter(([k]) => ids.has(k)));
    })()),
    rev: row.rev,
    project_id: row.project_id || null,
    mine: row.owner_id === user.id,
    author: row.owner_id === user.id ? undefined : q.author.get(row.owner_id)?.display_name || '',
    updated_by: row.updated_by && row.updated_by !== user.id ? q.author.get(row.updated_by)?.display_name || '' : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...extra,
  });

  // Personal: the owner only. In a project: its current members.
  function visible(user, id) {
    const row = q.byId.get(String(id || ''));
    const ok = row && (row.project_id ? projects.isMember(user.id, row.project_id) : row.owner_id === user.id);
    if (!ok) throw new StoryboardError('Storyboard not found.', 404);
    return row;
  }
  function editable(user, id) {
    const row = visible(user, id);
    if (row.project_id && projects.get(user, row.project_id).project.archived_at) throw new StoryboardError('The project is archived.', 409);
    return row;
  }
  const scopeOf = (user, project) => (project && project !== 'none' ? projects.target(user, String(project), null).projectId : null);

  // Jobs made for this board that are still running (or finished but not in it
  // yet), and recent failures — so a reload or another member sees them too.
  function jobsOf(row) {
    const media = parse(row.media_json, {});
    const targets = new Set([...parse(row.shots_json, []).map((s) => s.id), ...groupIds(parse(row.mood_json, {}))]);
    const has = (id, genId) => {
      const m = media[id] || {};
      return [...(m.frames || []), ...(m.videos || [])].some((x) => x.gen === genId);
    };
    const out = [];
    for (const g of q.jobs.all(now() - 2 * 86_400_000, `"board":"${row.id}"`)) {
      const t = targetOf(parse(g.meta_json, {}));
      if (!t || t.board !== row.id || !targets.has(t.id)) continue;
      // Only jobs that could join this board: same place, made by someone who can edit it.
      if ((g.project_id || null) !== (row.project_id || null)) continue;
      if (row.project_id ? !projects.isMember(g.user_id, row.project_id) : g.user_id !== row.owner_id) continue;
      const base = { id: g.id, target: t.id, shot: t.id, step: t.step };
      if (ACTIVE.has(g.status)) out.push({ ...base, status: 'running', since: g.created_at });
      else if (g.status === 'completed' && !has(t.id, g.id) && now() - (g.completed_at || 0) < 10 * 60_000) out.push({ ...base, status: 'running', since: g.created_at });
      else if (g.status === 'failed' && now() - (g.completed_at || 0) < 60 * 60_000) out.push({ ...base, status: 'failed', error: String(g.error || 'Failed').slice(0, 300), at: g.completed_at });
    }
    return out;
  }

  function list(user, { project } = {}) {
    const rows = project && project !== 'none' ? q.inProject.all(projects.get(user, String(project)).project.id) : q.personal.all(user.id);
    return {
      storyboards: rows.map((r) => {
        const shots = parse(r.shots_json, []).filter(isObj);
        const media = parse(r.media_json, {});
        const scenes = parse(r.scenes_json, []);
        const approvedOf = (s) => (media[s.id]?.approved || []).filter((u) => !isGone(r, u));
        // Up to three pictures for the card: approved first, then shot covers, then the Moodboard.
        const pics = [];
        const add = (u) => { if (u && /^\/media\//.test(u) && !pics.includes(u) && pics.length < 3 && !isGone(r, u)) pics.push(u); };
        for (const s of shots) approvedOf(s).filter((u) => !/\.(mp4|webm|mov)$/i.test(u)).slice(0, 1).forEach(add);
        for (const s of shots) if ((s.refs || [])[0]?.kind !== 'video') add((s.refs || [])[0]?.url);
        for (const it of parse(r.mood_json, {}).items || []) if (it.type === 'image') add(it.url);
        const isVideo = (u) => /\.(mp4|webm|mov)$/i.test(u);
        return {
          id: r.id, name: r.name, scenes: scenes.length, shots: shots.length, cover: pics[0] || null, covers: pics,
          approved: shots.filter((s) => approvedOf(s).length).length,
          videos: shots.filter((s) => approvedOf(s).some(isVideo)).length,
          updated_at: r.updated_at, mine: r.owner_id === user.id,
        };
      }),
    };
  }

  function cleanName(name) {
    const n = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!n) throw new StoryboardError('Give the storyboard a name.');
    if (n.length > MAX_NAME) throw new StoryboardError(`The name is too long (max ${MAX_NAME}).`);
    return n;
  }
  function cleanScene(scene) {
    const s = String(scene ?? '').replace(/\r\n/g, '\n').trim();
    if (s.length > MAX_SCENE) throw new StoryboardError(`The brief is too long (max ${MAX_SCENE.toLocaleString('en')} characters).`);
    return s;
  }

  // A new film is empty unless something is given (package 05: any order, nothing required).
  function create(user, body = {}) {
    const projectId = scopeOf(user, body.project);
    const id = newId('sb');
    const t = now();
    const shotsIn = body.shots || [];
    let scenes = cleanScenes(body.scenes);
    if (!scenes.length && shotsIn.length) scenes = cleanScenes([{ name: '' }]);
    q.insert.run(id, user.id, projectId, cleanName(body.name || 'Untitled storyboard'), cleanScene(body.scene), JSON.stringify(cleanLook(body.look)),
      JSON.stringify(cleanSettings(body.settings)), JSON.stringify(cleanShots(shotsIn, scenes)), t, t,
      JSON.stringify(scenes), JSON.stringify(cleanMood(body.mood)), String(body.note ?? '').slice(0, MAX_NOTE));
    return { storyboard: view(q.byId.get(id), user, { jobs: [] }) };
  }

  function get(user, id) {
    const row = visible(user, id);
    return { storyboard: view(row, user, { jobs: jobsOf(row) }) };
  }

  // Edits: the revision the studio started from must still be current.
  function update(user, id, body = {}) {
    const row = editable(user, id);
    const rev = Number(body.rev);
    if (!Number.isInteger(rev)) throw new StoryboardError('Missing revision.');
    const name = body.name === undefined ? row.name : cleanName(body.name);
    const scene = body.scene === undefined ? row.scene : cleanScene(body.scene);
    const look = body.look === undefined ? row.look_json : JSON.stringify(cleanLook(body.look));
    const settings = body.settings === undefined ? row.settings_json : JSON.stringify(cleanSettings(body.settings));
    let scenes = body.scenes === undefined ? parse(row.scenes_json, []) : cleanScenes(body.scenes);
    const shotsIn = body.shots === undefined ? parse(row.shots_json, []) : body.shots;
    // Shots need a scene: a board with shots and no scenes gets one.
    if (!scenes.length && Array.isArray(shotsIn) && shotsIn.length) scenes = cleanScenes([{ name: '' }]);
    const shots = JSON.stringify(cleanShots(shotsIn, scenes));
    const mood = body.mood === undefined ? row.mood_json : JSON.stringify(cleanMood(body.mood));
    const note = body.note === undefined ? row.note : String(body.note ?? '').slice(0, MAX_NOTE);
    const r = q.update.run(name, scene, look, settings, shots, JSON.stringify(scenes), mood, note, user.id, now(), row.id, rev);
    if (!r.changes) {
      const fresh = q.byId.get(row.id);
      const err = new StoryboardError(`${fresh?.updated_by && fresh.updated_by !== user.id ? `${q.author.get(fresh.updated_by)?.display_name || 'Someone'} changed` : 'Changed'} this storyboard meanwhile — reloaded.`, 409);
      err.storyboard = fresh ? view(fresh, user, { jobs: jobsOf(fresh) }) : null;
      throw err;
    }
    // Media of shots and groups that are gone is dropped — after a while: a deleted shot or scene
    // can come back with Undo (package 14, A5) with its pictures, videos and approvals. The
    // generations themselves stay where they were made (the Library or the project), with likes and all.
    const fresh = q.byId.get(row.id);
    const ids = new Set([...parse(fresh.shots_json, []).map((s) => s.id), ...groupIds(parse(fresh.mood_json, {}))]);
    const media = parse(fresh.media_json, {});
    // When a target went is stored with its media (gone_at), so the 30 minutes hold across restarts
    // and a shot brought back later than that comes back without them.
    const t = now();
    let changed = false;
    const kept = {};
    for (const [k, m] of Object.entries(media)) {
      if (!isObj(m)) { kept[k] = m; continue; }
      const gone = Number(m.gone_at) || 0;
      if (ids.has(k)) {
        if (gone && t - gone >= MEDIA_GRACE_MS) { changed = true; continue; }
        if (gone) { const { gone_at: _g, ...rest } = m; kept[k] = rest; changed = true; } else kept[k] = m;
      } else if (!gone) { kept[k] = { ...m, gone_at: t }; changed = true; }
      else if (t - gone < MEDIA_GRACE_MS) kept[k] = m;
      else changed = true;
    }
    if (changed) q.setMedia.run(JSON.stringify(kept), now(), row.id);
    const final = q.byId.get(row.id);
    return { storyboard: view(final, user, { jobs: jobsOf(final) }) };
  }

  // Personal: the owner. Project: the author or the project owner.
  function remove(user, id) {
    const row = editable(user, id);
    if (row.project_id && row.owner_id !== user.id && projects.roleIn(user.id, row.project_id) !== 'owner') {
      throw new StoryboardError('Only the author or the project owner can delete it.', 403);
    }
    q.remove.run(now(), row.id);
    return { ok: true };
  }

  // Change one target's media (synchronous read-modify-write: nothing runs between).
  function changeMedia(row, targetId, fn) {
    const media = parse(q.byId.get(row.id)?.media_json, {});
    const m = isObj(media[targetId]) ? media[targetId] : { frames: [], videos: [], approved: [] };
    m.frames ||= []; m.videos ||= []; m.approved ||= [];
    delete m.frame; delete m.video;
    fn(m);
    // Too many: the oldest ones that are not approved leave the list (the files stay in the Library).
    for (const key of ['frames', 'videos']) {
      if (m[key].length <= MAX_MEDIA) continue;
      const keep = new Set(m.approved);
      const drop = m[key].length - MAX_MEDIA;
      let dropped = 0;
      m[key] = m[key].filter((x) => (keep.has(x.url) || dropped >= drop ? true : (dropped += 1, false)));
    }
    media[targetId] = m;
    q.setMedia.run(JSON.stringify(media), now(), row.id);
  }
  const targetIn = (row, id) => {
    if (!isTarget(row, id)) throw new StoryboardError('That shot or group is gone — reload.', 404);
    return id;
  };
  const isVideoUrl = (url) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);

  // A job made for this target whose output is this URL (a generation of the board's place):
  // it joins the target's list if it is not there yet (e.g. approved before the server attached it).
  function listedOrJoin(row, targetId, url) {
    const m = parse(row.media_json, {})[targetId] || {};
    if ([...(m.frames || []), ...(m.videos || [])].some((x) => x.url === url)) return true;
    const g = /^\/media\/g\/([^/]+)\//.exec(url);
    const gen = g && q.genMeta.get(g[1]);
    const t = gen && targetOf(parse(gen.meta_json, {}));
    if (!t || t.board !== row.id || t.id !== targetId) return false;
    attachGenerated(gen);
    const again = parse(q.byId.get(row.id)?.media_json, {})[targetId] || {};
    return [...(again.frames || []), ...(again.videos || [])].some((x) => x.url === url);
  }

  // { target (or shot), op: 'approve'|'unapprove'|'remove'|'add', url }
  // 'pick' / 'unpick' (before package 05) mean approve / unapprove.
  async function media(user, id, body = {}) {
    let row = editable(user, id);
    const targetId = targetIn(row, String(body.target || body.shot || ''));
    const url = String(body.url || '');
    const op = body.op === 'pick' ? 'approve' : body.op === 'unpick' ? 'unapprove' : body.op;
    if (op === 'add') {
      // A ready picture or video for the shot (upload, or one from the library):
      // copied into the board's place, nothing is generated and nothing approved.
      const [own] = await generations.adoptMany(user, [url], { projectId: row.project_id || null });
      try {
        row = editable(user, id);
        targetIn(row, targetId);
      } catch (error) {
        // The board or shot changed while copying: the fresh copy is not kept.
        const made = own !== url && /^\/media\/u\/([^.]+)\./.exec(own);
        if (made) { try { generations.deleteUploads(user, [made[1]]); } catch { /* best effort */ } }
        throw error;
      }
      const key = body.kind === 'video' || isVideoUrl(own) ? 'videos' : 'frames';
      changeMedia(row, targetId, (m) => {
        if (!m[key].some((x) => x.url === own)) m[key].push({ url: own, gen: null, at: now(), own: true });
      });
    } else if (op === 'approve' || op === 'unapprove' || op === 'remove') {
      if (op !== 'unapprove' && !listedOrJoin(row, targetId, url)) throw new StoryboardError('Not one of this shot\'s files.', 404);
      if (op === 'approve' && isGone(row, url)) throw new StoryboardError('That file is in the Trash or was moved out of here.', 409);
      row = q.byId.get(row.id);
      changeMedia(row, targetId, (m) => {
        if (op === 'approve') { if (!m.approved.includes(url)) m.approved.push(url); }
        else if (op === 'unapprove') m.approved = m.approved.filter((u) => u !== url);
        else {
          m.frames = m.frames.filter((x) => x.url !== url);
          m.videos = m.videos.filter((x) => x.url !== url);
          m.approved = m.approved.filter((u) => u !== url);
        }
      });
    } else throw new StoryboardError('Unknown change.');
    return get(user, id);
  }

  // A finished job made for a shot or a group joins its pictures / videos (once).
  // Nothing is approved here: only the user's Approve does that (package 05, §3).
  function attachGenerated(gen) {
    const t = targetOf(parse(gen?.meta_json, null));
    if (!t || gen.status !== 'completed') return;
    const user = q.user.get(gen.user_id);
    if (!user) return;
    let row;
    try { row = editable(user, t.board); } catch { return; } // gone, or no longer theirs to change
    if (!isTarget(row, t.id)) return;
    // Made in the board's place (its project, or the owner's Library) — or everyone could not open it.
    if ((gen.project_id || null) !== (row.project_id || null)) return;
    const outputs = parse(gen.outputs_json, []);
    const files = outputs.map((o, i) => {
      const mime = String(o?.mime || '');
      if (!mime.startsWith('image/') && !mime.startsWith('video/')) return null;
      return { url: `/media/g/${gen.id}/${i}${o.tex ? `-t${o.tex.v}` : ''}.${o.ext}`, key: mime.startsWith('video/') ? 'videos' : 'frames' };
    }).filter(Boolean);
    if (!files.length) return;
    changeMedia(row, t.id, (m) => {
      if ([...m.frames, ...m.videos].some((x) => x.gen === gen.id)) return;
      for (const f of files) m[f.key].push({ url: f.url, gen: gen.id, at: gen.completed_at || now(), ...(gen.studio === 'upscale' ? { up: true } : {}) });
    });
  }
  // Jobs from the last week not in their board yet (a restart, an error).
  function attachPending() {
    for (const gen of q.forShotJobs.all(now() - 7 * 86_400_000)) {
      try { attachGenerated(gen); } catch (error) { log?.warn?.(`storyboard ${gen.id}: ${error.message}`); }
    }
  }

  // The AI Director's plan replaces the shot list (same revision rules).
  function applyPlan(user, id, rev, plan) {
    const row = editable(user, id);
    const shots = plan.shots.map((s, i) => ({ ...s, id: newId('s').slice(0, 20) || `s${i}` }));
    return update(user, row.id, {
      rev,
      shots,
      ...(plan.title && /^Untitled (scene|film|storyboard)$/.test(row.name) ? { name: plan.title } : {}),
      ...(plan.look ? { look: { ...cleanLook(parse(row.look_json, {})), note: plan.look } } : {}),
    });
  }

  // Before a paid plan: the studio's revision must still be current.
  function checkRev(user, id, rev) {
    const row = editable(user, id);
    if (!Number.isInteger(Number(rev)) || Number(rev) !== row.rev) {
      const err = new StoryboardError('This storyboard changed meanwhile — reloaded. Plan again.', 409);
      err.storyboard = view(row, user, { jobs: jobsOf(row) });
      throw err;
    }
    return row;
  }

  // The picked videos of the board's shots (all, or the ones asked for), in
  // shot order, stitched into one video — a new item in the board's place.
  function stitchShots(user, id, body = {}) {
    const row = editable(user, id);
    const shots = parse(row.shots_json, []);
    const media = parse(row.media_json, {});
    const want = Array.isArray(body.shots) && body.shots.length ? new Set(body.shots.map(String)) : null;
    const vid = (sid) => (media[sid]?.approved || []).find((u) => isVideoUrl(u) && !isGone(row, u));
    const chosen = shots.filter((s) => (!want || want.has(s.id)) && vid(s.id));
    if (chosen.length < 2) throw new StoryboardError('Approve a video in at least two shots first.');
    const files = chosen.map((s, i) => {
      const url = vid(s.id);
      const file = !isGone(row, url) && generations.mediaFileForUrl(user, url);
      if (!file?.path) throw new StoryboardError(`Shot ${shots.indexOf(s) + 1} (${s.title || 'untitled'}): its video is gone — pick another one.`, 409);
      return { path: file.path, n: i };
    });
    const name = String(row.name || 'Scene').slice(0, 120);
    const { id: genId } = generations.addLocalEdit(user, {
      kind: 'video',
      prompt: `${name} — ${chosen.length} shots stitched`,
      studio: 'director',
      meta: { stitch: { board: row.id, shots: chosen.map((s) => s.id) }, modelName: 'Stitched shots · this server', boardName: name },
      projectId: row.project_id || null,
      make: () => stitchVideos(files),
    });
    return { id: genId };
  }

  // The last frame of a shot's picked video becomes the next shot's start frame.
  const continuing = new Set(); // user ids: one at a time each
  async function continueShot(user, id, body = {}) {
    if (continuing.has(user.id)) throw new StoryboardError('Still taking the last frame of another shot — a moment.', 429);
    continuing.add(user.id);
    try { return await continueShotNow(user, id, body); } finally { continuing.delete(user.id); }
  }
  async function continueShotNow(user, id, body = {}) {
    let row = editable(user, id);
    const shots = parse(row.shots_json, []);
    const i = shots.findIndex((s) => s.id === String(body.shot || ''));
    if (i < 0) throw new StoryboardError('That shot is gone — reload.', 404);
    const next = shots[i + 1];
    if (!next) throw new StoryboardError('Add a shot after this one first.');
    const vidOf = (r, sid) => (parse(r.media_json, {})[sid]?.approved || []).find((u) => isVideoUrl(u));
    const url = vidOf(row, shots[i].id);
    const file = url && !isGone(row, url) && generations.mediaFileForUrl(user, url);
    if (!file?.path) throw new StoryboardError('Approve a video for this shot first.');
    const frame = await lastVideoFrame(file.path);
    let saved;
    try {
      saved = await generations.saveUpload(user, { stream: fs.createReadStream(frame.path), mime: 'image/png', filename: `${String(shots[i].title || 'shot').slice(0, 40)} – last frame.png`, projectId: row.project_id || null });
    } finally { frame.cleanup(); }
    // The board may have changed meanwhile: same source video, same next shot — or nothing is kept.
    try {
      row = editable(user, id);
      const now2 = parse(row.shots_json, []);
      const j = now2.findIndex((s) => s.id === shots[i].id);
      if (j < 0 || now2[j + 1]?.id !== next.id || vidOf(row, shots[i].id) !== url) throw new StoryboardError('The shots changed meanwhile — try again.', 409);
    } catch (error) {
      const made = /^\/media\/u\/([^.]+)\./.exec(saved?.url || '');
      if (made) { try { generations.deleteUploads(user, [made[1]]); } catch { /* best effort */ } }
      throw error;
    }
    changeMedia(row, next.id, (m) => {
      m.frames.push({ url: saved.url, gen: null, at: now(), own: true, from: shots[i].id });
    });
    return get(user, id);
  }

  return { list, create, get, update, remove, media, stitchShots, continueShot, attachGenerated, attachPending, applyPlan, editable, visible, checkRev };
}
