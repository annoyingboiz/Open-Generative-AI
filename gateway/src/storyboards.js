// Storyboards (AI Director): a scene, its shot list and what was made for each
// shot — start-frame candidates (one picked) and videos. Personal (Library) or
// in a project (every member sees and edits it), like Elements.
//
// Two kinds of data, kept apart so they never overwrite each other:
//   shots   — what people edit (text, presets, prompts); saved with a revision
//             number, a stale save gets 409 instead of erasing someone's edit;
//   media   — per shot: generated frames / videos and the picked ones; filled by
//             the server when a job made "for a shot" finishes, changed by
//             pick / remove / add.
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
const MAX_SCENE = 6000;
const MAX_SHOTS = 24;
const MAX_FRAMES = 24;
const MAX_VIDEOS = 12;
const MAX_SETTINGS = 16_384;
const SHOT_ID = /^[a-z0-9_-]{1,40}$/i;
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

// Shots from the studio: every one gets a valid unique id.
function cleanShots(list) {
  if (!Array.isArray(list)) throw new StoryboardError('Shots must be a list.');
  if (list.length > MAX_SHOTS) throw new StoryboardError(`Up to ${MAX_SHOTS} shots.`);
  const seen = new Set();
  return list.map((s) => {
    let id = String(s?.id || '');
    if (!SHOT_ID.test(id) || seen.has(id)) id = newId('s').slice(0, 20);
    seen.add(id);
    return cleanShot(s, { id });
  });
}

export function createStoryboards({ db, projects, generations, log }) {
  const q = {
    insert: db.prepare(`INSERT INTO storyboards (id, owner_id, project_id, name, scene, look_json, settings_json, shots_json, media_json, rev, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, ?)`),
    byId: db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL'),
    personal: db.prepare('SELECT * FROM storyboards WHERE owner_id = ? AND project_id IS NULL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200'),
    inProject: db.prepare('SELECT * FROM storyboards WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200'),
    update: db.prepare('UPDATE storyboards SET name = ?, scene = ?, look_json = ?, settings_json = ?, shots_json = ?, rev = rev + 1, updated_by = ?, updated_at = ? WHERE id = ? AND rev = ?'),
    setMedia: db.prepare('UPDATE storyboards SET media_json = ?, updated_at = ? WHERE id = ?'),
    remove: db.prepare('UPDATE storyboards SET deleted_at = ? WHERE id = ?'),
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    author: db.prepare('SELECT display_name FROM users WHERE id = ?'),
    jobs: db.prepare(`SELECT id, user_id, project_id, status, error, meta_json, created_at, completed_at FROM generations
      WHERE created_at > ? AND deleted_at IS NULL AND instr(meta_json, ?) > 0 ORDER BY created_at`),
    genState: db.prepare('SELECT id, project_id, deleted_at, purged_at FROM generations WHERE id = ?'),
    uploadState: db.prepare('SELECT id, project_id FROM uploads WHERE id = ?'),
    forShotJobs: db.prepare(`SELECT * FROM generations WHERE status = 'completed' AND completed_at > ? AND instr(meta_json, '"forShot"') > 0 ORDER BY completed_at LIMIT 500`),
  };

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
  function withState(row, media) {
    const goneUrl = (url) => isGone(row, url);
    const out = {};
    for (const [shotId, m] of Object.entries(media || {})) {
      const mark = (list) => (list || []).map((x) => (goneUrl(x.url) ? { ...x, gone: true } : x));
      const frames = mark(m.frames);
      const videos = mark(m.videos);
      const live = (list, url) => (url && list.some((x) => x.url === url && !x.gone) ? url : null);
      out[shotId] = { ...m, frames, videos, frame: live(frames, m.frame), video: live(videos, m.video) };
    }
    return out;
  }
  const view = (row, user, extra = {}) => ({
    id: row.id,
    name: row.name,
    scene: row.scene,
    look: cleanLook(parse(row.look_json, {})),
    settings: parse(row.settings_json, {}),
    // Shots saved before 18.11 carry camera names: shown with today's ids.
    shots: parse(row.shots_json, []).map((s) => (isObj(s) ? cleanShot(s, { id: s.id }) : s)).filter(isObj),
    media: withState(row, parse(row.media_json, {})),
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
    const shots = new Set(parse(row.shots_json, []).map((s) => s.id));
    const has = (shotId, genId) => {
      const m = media[shotId] || {};
      return [...(m.frames || []), ...(m.videos || [])].some((x) => x.gen === genId);
    };
    const out = [];
    for (const g of q.jobs.all(now() - 2 * 86_400_000, `"board":"${row.id}"`)) {
      const f = parse(g.meta_json, {})?.forShot;
      if (!f || f.board !== row.id || !shots.has(f.shot)) continue;
      // Only jobs that could join this board: same place, made by someone who can edit it.
      if ((g.project_id || null) !== (row.project_id || null)) continue;
      if (row.project_id ? !projects.isMember(g.user_id, row.project_id) : g.user_id !== row.owner_id) continue;
      const step = f.step === 'video' ? 'video' : 'frame';
      if (ACTIVE.has(g.status)) out.push({ id: g.id, shot: f.shot, step, status: 'running', since: g.created_at });
      else if (g.status === 'completed' && !has(f.shot, g.id) && now() - (g.completed_at || 0) < 10 * 60_000) out.push({ id: g.id, shot: f.shot, step, status: 'running', since: g.created_at });
      else if (g.status === 'failed' && now() - (g.completed_at || 0) < 60 * 60_000) out.push({ id: g.id, shot: f.shot, step, status: 'failed', error: String(g.error || 'Failed').slice(0, 300), at: g.completed_at });
    }
    return out;
  }

  function list(user, { project } = {}) {
    const rows = project && project !== 'none' ? q.inProject.all(projects.get(user, String(project)).project.id) : q.personal.all(user.id);
    return {
      storyboards: rows.map((r) => {
        const shots = parse(r.shots_json, []);
        const media = parse(r.media_json, {});
        const cover = shots.map((s) => media[s.id]?.frame).find((u) => u && !isGone(r, u)) || null;
        return { id: r.id, name: r.name, shots: shots.length, cover, updated_at: r.updated_at, mine: r.owner_id === user.id };
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
    if (s.length > MAX_SCENE) throw new StoryboardError(`The scene is too long (max ${MAX_SCENE} characters).`);
    return s;
  }

  function create(user, body = {}) {
    const projectId = scopeOf(user, body.project);
    const id = newId('sb');
    const t = now();
    q.insert.run(id, user.id, projectId, cleanName(body.name || 'Untitled scene'), cleanScene(body.scene), JSON.stringify(cleanLook(body.look)),
      JSON.stringify(cleanSettings(body.settings)), JSON.stringify(cleanShots(body.shots || [])), t, t);
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
    const shots = body.shots === undefined ? row.shots_json : JSON.stringify(cleanShots(body.shots));
    const r = q.update.run(name, scene, look, settings, shots, user.id, now(), row.id, rev);
    if (!r.changes) {
      const fresh = q.byId.get(row.id);
      const err = new StoryboardError(`${fresh?.updated_by && fresh.updated_by !== user.id ? `${q.author.get(fresh.updated_by)?.display_name || 'Someone'} changed` : 'Changed'} this storyboard meanwhile — reloaded.`, 409);
      err.storyboard = fresh ? view(fresh, user, { jobs: jobsOf(fresh) }) : null;
      throw err;
    }
    // Media of shots that are gone is dropped (the files stay in the Library).
    const fresh = q.byId.get(row.id);
    const ids = new Set(parse(fresh.shots_json, []).map((s) => s.id));
    const media = parse(fresh.media_json, {});
    const kept = Object.fromEntries(Object.entries(media).filter(([k]) => ids.has(k)));
    if (Object.keys(kept).length !== Object.keys(media).length) q.setMedia.run(JSON.stringify(kept), now(), row.id);
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

  // Change one shot's media (synchronous read-modify-write: nothing runs between).
  function changeMedia(row, shotId, fn) {
    const media = parse(q.byId.get(row.id)?.media_json, {});
    const m = media[shotId] || { frames: [], videos: [], frame: null, video: null };
    m.frames ||= []; m.videos ||= [];
    fn(m);
    media[shotId] = m;
    q.setMedia.run(JSON.stringify(media), now(), row.id);
  }
  const shotOf = (row, shotId) => {
    const s = parse(row.shots_json, []).find((x) => x.id === shotId);
    if (!s) throw new StoryboardError('That shot is gone — reload.', 404);
    return s;
  };

  // { shot, kind: 'frame'|'video', op: 'pick'|'unpick'|'remove'|'add', url }
  async function media(user, id, body = {}) {
    let row = editable(user, id);
    const shotId = String(body.shot || '');
    shotOf(row, shotId);
    const kind = body.kind === 'video' ? 'video' : 'frame';
    const listKey = kind === 'video' ? 'videos' : 'frames';
    const url = String(body.url || '');
    if (body.op === 'add') {
      // Your own picture as the start frame: copied into the board's place.
      if (kind !== 'frame') throw new StoryboardError('Only a frame can be added.');
      const [own] = await generations.adoptMany(user, [url], { projectId: row.project_id || null });
      try {
        row = editable(user, id);
        shotOf(row, shotId);
      } catch (error) {
        // The board or shot changed while copying: the fresh copy is not kept.
        const made = own !== url && /^\/media\/u\/([^.]+)\./.exec(own);
        if (made) { try { generations.deleteUploads(user, [made[1]]); } catch { /* best effort */ } }
        throw error;
      }
      changeMedia(row, shotId, (m) => {
        if (!m.frames.some((x) => x.url === own)) m.frames.push({ url: own, gen: null, at: now(), own: true });
        if (m.frames.length > MAX_FRAMES) m.frames = m.frames.filter((x) => x.url === m.frame).concat(m.frames.filter((x) => x.url !== m.frame).slice(-(MAX_FRAMES - 1)));
        m.frame = own;
      });
    } else if (body.op === 'pick' || body.op === 'remove') {
      changeMedia(row, shotId, (m) => {
        if (!m[listKey].some((x) => x.url === url)) throw new StoryboardError('Not one of this shot\'s files.', 404);
        if (body.op === 'pick') {
          if (isGone(row, url)) throw new StoryboardError('That file is in the Trash or was moved out of here.', 409);
          m[kind] = url;
        }
        else {
          m[listKey] = m[listKey].filter((x) => x.url !== url);
          if (m[kind] === url) m[kind] = m[listKey].at(-1)?.url || null;
        }
      });
    } else if (body.op === 'unpick') {
      changeMedia(row, shotId, (m) => { m[kind] = null; });
    } else throw new StoryboardError('Unknown change.');
    return get(user, id);
  }

  // A finished job made for a shot joins its frames / videos (once). The first
  // one (or a new one when nothing is picked) becomes the picked one.
  function attachGenerated(gen) {
    const meta = parse(gen?.meta_json, null);
    const f = meta?.forShot;
    if (!f?.board || !f.shot || gen.status !== 'completed') return;
    const user = q.user.get(gen.user_id);
    if (!user) return;
    let row;
    try { row = editable(user, f.board); } catch { return; } // gone, or no longer theirs to change
    if (!parse(row.shots_json, []).some((s) => s.id === f.shot)) return;
    // Made in the board's place (its project, or the owner's Library) — or everyone could not open it.
    if ((gen.project_id || null) !== (row.project_id || null)) return;
    const step = f.step === 'video' ? 'video' : 'frame';
    const want = step === 'video' ? 'video/' : 'image/';
    const outputs = parse(gen.outputs_json, []);
    const urls = outputs.map((o, i) => (String(o?.mime || '').startsWith(want) ? `/media/g/${gen.id}/${i}.${o.ext}` : null)).filter(Boolean);
    if (!urls.length) return;
    changeMedia(row, f.shot, (m) => {
      const listKey = step === 'video' ? 'videos' : 'frames';
      if (m[listKey].some((x) => x.gen === gen.id)) return;
      for (const url of urls) m[listKey].push({ url, gen: gen.id, at: gen.completed_at || now() });
      const max = step === 'video' ? MAX_VIDEOS : MAX_FRAMES;
      if (m[listKey].length > max) {
        const picked = m[step];
        m[listKey] = m[listKey].filter((x) => x.url === picked).concat(m[listKey].filter((x) => x.url !== picked).slice(-(max - 1)));
      }
      if (!m[step]) m[step] = urls[0];
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
      ...(plan.title && /^Untitled scene$/.test(row.name) ? { name: plan.title } : {}),
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
    const chosen = shots.filter((s) => (!want || want.has(s.id)) && media[s.id]?.video);
    if (chosen.length < 2) throw new StoryboardError('Pick a video in at least two shots first.');
    const files = chosen.map((s, i) => {
      const url = media[s.id].video;
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
  async function continueShot(user, id, body = {}) {
    let row = editable(user, id);
    const shots = parse(row.shots_json, []);
    const i = shots.findIndex((s) => s.id === String(body.shot || ''));
    if (i < 0) throw new StoryboardError('That shot is gone — reload.', 404);
    const next = shots[i + 1];
    if (!next) throw new StoryboardError('Add a shot after this one first.');
    const url = parse(row.media_json, {})[shots[i].id]?.video;
    const file = url && !isGone(row, url) && generations.mediaFileForUrl(user, url);
    if (!file?.path) throw new StoryboardError('Pick a video for this shot first.');
    const frame = await lastVideoFrame(file.path);
    let saved;
    try {
      saved = await generations.saveUpload(user, { stream: fs.createReadStream(frame.path), mime: 'image/png', filename: `${String(shots[i].title || 'shot').slice(0, 40)} – last frame.png`, projectId: row.project_id || null });
    } finally { frame.cleanup(); }
    row = editable(user, id);
    if (!parse(row.shots_json, []).some((s) => s.id === next.id)) throw new StoryboardError('The next shot is gone — reload.', 404);
    changeMedia(row, next.id, (m) => {
      m.frames.push({ url: saved.url, gen: null, at: now(), own: true, from: shots[i].id });
      if (m.frames.length > MAX_FRAMES) m.frames = m.frames.filter((x) => x.url === saved.url || x.url === m.frame).concat(m.frames.filter((x) => x.url !== saved.url && x.url !== m.frame).slice(-(MAX_FRAMES - 2)));
      m.frame = saved.url;
    });
    return get(user, id);
  }

  return { list, create, get, update, remove, media, stitchShots, continueShot, attachGenerated, attachPending, applyPlan, editable, visible, checkRev };
}
