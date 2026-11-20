// DZ: Storyboard v2 (package 05) — a film on the server, edited here.
// Edits (name, note, scenes, shots, Moodboard) are saved with the film's revision;
// media (what was generated for a shot or group, approved) is changed by the server.
import { useCallback, useEffect, useRef, useState } from "react";
import { dzStoryboards } from "./dzDirector.js";

export { dzStoryboards };

const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
export const newSceneId = () => rid("sc");
export const newShotId = () => rid("s");
export const newItemId = (type) => rid(type === "frame" ? "g" : "m");
export const isVideoUrl = (url) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(String(url || ""));
const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));

// Shot numbers run through the whole film (Shot 4 can be the first of scene 2).
export function numbered(film) {
  const out = [];
  let n = 0;
  for (const sc of film?.scenes || []) {
    const shots = (film.shots || []).filter((s) => s.scene === sc.id).map((s) => ({ ...s, n: (n += 1) }));
    out.push({ scene: sc, shots });
  }
  return out;
}

// The natural size of a picture or video (for its own aspect ratio).
export function sizeOf(url, kind) {
  return new Promise((resolve) => {
    if (kind === "video" || isVideoUrl(url)) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve({ w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => resolve({ w: 16, h: 9 });
      v.src = url;
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 4, h: 3 });
    img.src = url;
  });
}

// What a shot looks like on the Generated layer: approved, variants, takes, upscaled.
export function shotState(film, shot) {
  const m = film?.media?.[shot.id] || { frames: [], videos: [], approved: [] };
  const frames = (m.frames || []).filter((x) => !x.gone);
  const videos = (m.videos || []).filter((x) => !x.gone);
  const approved = m.approved || [];
  const all = [...frames, ...videos].sort((a, b) => (b.at || 0) - (a.at || 0));
  const firstApproved = approved[0] || null;
  return {
    variants: frames.length + videos.length,
    pictures: frames.length,
    takes: videos.length,
    approved,
    upscaled: [...frames, ...videos].some((x) => x.up && (!firstApproved || x.url === firstApproved)),
    cover: firstApproved || null,
    latest: all[0]?.url || null,
    running: (film?.jobs || []).filter((j) => j.target === shot.id && j.status === "running").length,
  };
}

// Someone else saved meanwhile (409): their copy, with my edits since the last sync
// laid over it — per scene, shot and Moodboard item (by id), and per text field.
function mergeById(base = [], mine = [], theirs = []) {
  const b = new Map(base.map((x) => [x.id, JSON.stringify(x)]));
  const m = new Map(mine.map((x) => [x.id, x]));
  const t = new Map(theirs.map((x) => [x.id, x]));
  const out = [];
  // My order when I reordered, else theirs; then whatever the other side added.
  const myOrderChanged = mine.map((x) => x.id).filter((id) => b.has(id)).join() !== base.map((x) => x.id).filter((id) => m.has(id)).join();
  const order = myOrderChanged ? [...mine.map((x) => x.id), ...theirs.map((x) => x.id).filter((id) => !m.has(id))] : [...theirs.map((x) => x.id), ...mine.map((x) => x.id).filter((id) => !t.has(id))];
  for (const id of [...new Set(order)]) {
    const inBase = b.has(id);
    const mineX = m.get(id);
    const theirsX = t.get(id);
    if (inBase && !mineX) continue; // I deleted it
    if (inBase && !theirsX) { if (JSON.stringify(mineX) !== b.get(id)) out.push(mineX); continue; } // they deleted it; kept only if I changed it
    if (mineX && (!inBase || JSON.stringify(mineX) !== b.get(id))) out.push(mineX); // mine is new or changed
    else if (theirsX) out.push(theirsX);
  }
  return out;
}
export function mergeFilm(base, mine, theirs) {
  const pick = (k) => (JSON.stringify(mine[k]) !== JSON.stringify(base[k]) ? mine[k] : theirs[k]);
  return {
    ...theirs,
    name: pick("name"),
    note: pick("note"),
    scene: pick("scene"),
    scenes: mergeById(base.scenes, mine.scenes, theirs.scenes),
    shots: mergeById(base.shots, mine.shots, theirs.shots),
    mood: { ...(theirs.mood || {}), items: mergeById(base.mood?.items, mine.mood?.items, theirs.mood?.items) },
  };
}

// One film: load, edit (saved shortly after, with the revision), media changes, refresh.
export function useFilm(id) {
  const [film, setFilm] = useState(null);
  const [error, setError] = useState(null);
  const filmRef = useRef(null);
  const dirty = useRef(false);
  const seq = useRef(0); // edits since the last save started
  const timer = useRef(null);
  const saving = useRef(null);
  const base = useRef(null); // the last copy the server confirmed (for merging on 409)
  const retries = useRef(0);
  filmRef.current = film;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { storyboard } = await dzStoryboards.get(id);
      setError(null);
      setFilm((cur) => {
        // Local edits not saved yet stay; media, jobs and the revision come from the server.
        if (cur && dirty.current) return { ...cur, media: storyboard.media, jobs: storyboard.jobs };
        base.current = storyboard;
        return storyboard;
      });
    } catch (e) { setError(e); }
  }, [id]);

  useEffect(() => { setFilm(null); dirty.current = false; load(); }, [id, load]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current) { await saving.current; }
    if (!dirty.current || !filmRef.current) return true;
    const f = filmRef.current;
    const mine = seq.current;
    const run = (async () => {
      try {
        const { storyboard } = await dzStoryboards.update(f.id, { rev: f.rev, name: f.name, note: f.note, scene: f.scene, scenes: f.scenes, shots: f.shots, mood: f.mood });
        base.current = { ...f, rev: storyboard.rev };
        retries.current = 0;
        if (seq.current === mine) { dirty.current = false; base.current = storyboard; setFilm(storyboard); }
        else setFilm((cur) => (cur ? { ...cur, rev: storyboard.rev, media: storyboard.media, jobs: storyboard.jobs } : storyboard));
        return true;
      } catch (e) {
        if (e.status === 409 && e.storyboard) {
          // Someone saved meanwhile: keep my edits over their copy and save again.
          const merged = base.current ? mergeFilm(base.current, filmRef.current, e.storyboard) : e.storyboard;
          base.current = e.storyboard;
          filmRef.current = merged;
          setFilm(merged);
          dirty.current = Boolean(base.current) && merged !== e.storyboard;
          if (dirty.current && retries.current < 3) { retries.current += 1; timer.current = setTimeout(() => { flush(); }, 200); }
          notify({ type: "notice", title: "Storyboard", message: "Someone else changed this film meanwhile — both changes are kept." });
        } else if ((!e.status || e.status >= 500 || e.status === 429) && retries.current < 5) {
          // A passing failure: try again a little later (the edits stay).
          retries.current += 1;
          timer.current = setTimeout(() => { flush(); }, 2000 * retries.current);
        } else notify({ type: "error", title: "Storyboard", message: `Not saved: ${e.message}` });
        return false;
      } finally { saving.current = null; }
    })();
    saving.current = run;
    const ok = await run;
    // Edits made while this save ran go out next.
    if (ok && dirty.current) { timer.current = setTimeout(() => { flush(); }, 300); }
    return ok;
  }, []);

  // Change the film locally; the change is saved a moment later.
  const edit = useCallback((fn) => {
    setFilm((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      if (next === cur) return cur;
      dirty.current = true;
      seq.current += 1;
      filmRef.current = next;
      return next;
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, 600);
  }, [flush]);

  // Approve / remove / add a ready file: the target must be saved first.
  const media = useCallback(async (body) => {
    if (!(await flush())) return null;
    const f = filmRef.current;
    try {
      const { storyboard } = await dzStoryboards.media(f.id, body);
      setFilm((cur) => (cur ? { ...cur, media: storyboard.media, jobs: storyboard.jobs } : storyboard));
      return storyboard;
    } catch (e) {
      notify({ type: "error", title: "Storyboard", message: e.message });
      return null;
    }
  }, [flush]);

  // New results arrive from the server: refresh on generation events and while jobs run.
  useEffect(() => {
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(load, 900); };
    window.addEventListener("dz:history", later);
    window.addEventListener("focus", later);
    return () => { clearTimeout(t); window.removeEventListener("dz:history", later); window.removeEventListener("focus", later); };
  }, [load]);
  const running = (film?.jobs || []).some((j) => j.status === "running");
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 5000);
    return () => clearInterval(t);
  }, [running, load]);
  // Unsaved edits go out when the page is left.
  useEffect(() => {
    const out = () => {
      const f = filmRef.current;
      if (!dirty.current || !f) return;
      try { dzStoryboards.update(f.id, { rev: f.rev, name: f.name, note: f.note, scene: f.scene, scenes: f.scenes, shots: f.shots, mood: f.mood }, { keepalive: true }); } catch { /* best effort */ }
    };
    window.addEventListener("pagehide", out);
    return () => { window.removeEventListener("pagehide", out); out(); };
  }, []);

  return { film, error, edit, flush, media, reload: load };
}

// The film list of the current place.
export function useFilms(project) {
  const [films, setFilms] = useState(null);
  const load = useCallback(async () => {
    try { const r = await dzStoryboards.list(project || "none"); setFilms(r.storyboards || []); } catch { setFilms((f) => f || []); }
  }, [project]);
  useEffect(() => { setFilms(null); load(); }, [load]);
  return { films, reload: load };
}

// "Paste a script" without a model call (package 05, §4.5): headings (INT./EXT., "Scene …",
// lines in capitals) start scenes; every other paragraph is a shot with that text as its note.
export function splitScript(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const scenes = [];
  let cur = null;
  let para = [];
  const heading = (l) => /^(INT\.|EXT\.|INT\/EXT|I\/E|scene\b|сцена\b)/i.test(l) || (/^[^a-zа-яё]*$/.test(l) && /[A-ZА-ЯЁ]{3}/.test(l) && l.length <= 80);
  const endPara = () => {
    const t = para.join(" ").replace(/\s+/g, " ").trim();
    para = [];
    if (!t) return;
    if (!cur) { cur = { name: "", note: "", shots: [] }; scenes.push(cur); }
    cur.shots.push(t.slice(0, 200));
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { endPara(); continue; }
    if (heading(l)) { endPara(); cur = { name: l.replace(/^scene\s*\d*[:.\-–—]?\s*/i, "").slice(0, 80) || l.slice(0, 80), note: "", shots: [] }; scenes.push(cur); continue; }
    para.push(l);
  }
  endPara();
  return scenes;
}

// ── Moodboard groups: a frame holds what lies inside it (its centre) ──
export const inFrame = (frame, it) => {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  return cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h;
};
export function frameItems(mood, frameId) {
  const items = mood?.items || [];
  const frame = items.find((x) => x.id === frameId && x.type === "frame");
  if (!frame) return [];
  return items.filter((x) => (x.type === "image" || x.type === "video") && inFrame(frame, x))
    .sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
}
export const frameRefs = (mood, frameId) => frameItems(mood, frameId).map((x) => ({ url: x.url, kind: x.type === "video" ? "video" : "image", w: x.w, h: x.h }));
// New pictures into a frame: in rows under what is there; the frame grows to hold them.
export function addToFrame(mood, frameId, refs, newId) {
  const items = [...(mood?.items || [])];
  const fi = items.findIndex((x) => x.id === frameId);
  if (fi < 0) return mood;
  const frame = { ...items[fi] };
  const inside = frameItems(mood, frameId);
  const pad = 16;
  const H = 180;
  let y = inside.length ? Math.max(...inside.map((x) => x.y + x.h)) + 12 : frame.y + pad;
  let x = frame.x + pad;
  let rowH = 0;
  const added = [];
  for (const r of refs) {
    if (inside.some((it) => it.url === r.url) || added.some((it) => it.url === r.url)) continue;
    const w = r.w && r.h ? Math.round((H * r.w) / r.h) : 240;
    if (x + w > frame.x + Math.max(frame.w, 600) - pad && x > frame.x + pad) { x = frame.x + pad; y += rowH + 12; rowH = 0; }
    const it = { id: newId(r.kind === "video" ? "video" : "image"), type: r.kind === "video" ? "video" : "image", url: r.url, x, y, w, h: H };
    items.push(it);
    added.push(it);
    x += w + 12;
    rowH = Math.max(rowH, H);
  }
  if (added.length) {
    frame.w = Math.max(frame.x + frame.w, ...added.map((it) => it.x + it.w + pad)) - frame.x;
    frame.h = Math.max(frame.y + frame.h, ...added.map((it) => it.y + it.h + pad)) - frame.y;
  }
  items[fi] = frame;
  return { ...mood, items };
}
