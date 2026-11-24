// Media delivery (package 10): videos that start at once.
//   faststart(file)  — MP4/MOV with the index (moov) after the data (mdat) is
//                      remuxed so the index comes first. No re-encoding.
//   playback         — a lighter copy of a heavy video for the player and the
//                      grid (H.264, up to 1080p, fast start), made in the
//                      background; the original stays for Download and models.
//   strip(file, n)   — n frames of a video side by side in one small webp, for
//                      the player's frame strip (it used to download the whole
//                      video a second time in the browser).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const VIDEO_EXT = /\.(mp4|mov|m4v)$/i;

// Top-level boxes of an ISO-BMFF file, in order (enough to see moov vs mdat).
export function topBoxes(file, max = 16) {
  const out = [];
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const h = Buffer.alloc(16);
    let off = 0;
    while (off < size && out.length < max) {
      if (fs.readSync(fd, h, 0, 16, off) < 8) break;
      let n = h.readUInt32BE(0);
      const type = h.toString('latin1', 4, 8);
      if (n === 1) n = Number(h.readBigUInt64BE(8));
      else if (n === 0) n = size - off;
      if (n < 8) break;
      out.push(type);
      off += n;
    }
  } catch { /* unreadable: no boxes */ } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
  }
  return out;
}
export const needsFaststart = (file) => {
  if (!VIDEO_EXT.test(file)) return false;
  const b = topBoxes(file);
  const moov = b.indexOf('moov');
  const mdat = b.indexOf('mdat');
  return moov > -1 && mdat > -1 && moov > mdat;
};

function run(bin, args, { timeoutMs = 10 * 60_000, nice = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const cmd = nice ? 'nice' : bin;
    const argv = nice ? ['-n', String(nice), bin, ...args] : args;
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stderr.on('data', (c) => { if (err.length < 2000) err += c; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(err.trim().slice(0, 300) || `${bin} exit ${code}`)); });
  });
}

// → true if the file was remuxed, false if it was already fine (or not a video).
// A failure leaves the original as it was.
export async function faststart(file, { ffmpegPath = 'ffmpeg' } = {}) {
  if (!needsFaststart(file)) return false;
  const tmp = `${file}.fs.${process.pid}.${Math.random().toString(36).slice(2)}${path.extname(file)}`;
  try {
    await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy', '-movflags', '+faststart', tmp], { timeoutMs: 5 * 60_000 });
    if (needsFaststart(tmp) || !topBoxes(tmp).includes('moov')) throw new Error('remux did not move the index');
    fs.renameSync(tmp, file);
    return true;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* moved or never made */ }
  }
}

// Heavy: more pixels than 1080p, or a bitrate well above what a 1080p player needs.
export const PLAYBACK = { MAX_W: 1920, MAX_H: 1080, HEAVY_BPS: 16_000_000, CRF: 22, MAXRATE: '8M', BUFSIZE: '16M', PRESET: 'veryfast', THREADS: 6 };

function probe(file, ffprobePath) {
  return new Promise((resolve) => {
    const p = spawn(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,bit_rate:format=bit_rate,duration', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 20_000);
    p.stdout.on('data', (c) => { out += c; });
    p.on('error', () => { clearTimeout(timer); resolve(null); });
    p.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        const s = j.streams?.[0] || {};
        resolve({ width: Number(s.width) || 0, height: Number(s.height) || 0, bps: Number(s.bit_rate) || Number(j.format?.bit_rate) || 0, duration: Number(j.format?.duration) || 0 });
      } catch { resolve(null); }
    });
  });
}

// ── Cut check (docs/ux/44, decision b) ──────────────────────────────────────
// A hard cut inside a clip made as "one continuous shot". The clip is read as small grey
// frames (96×54) and neighbouring frames are compared. Measured on 37 clips
// (REPORT-shot-size.md): the two real cuts jump by 45–56, everything else stays at 5 or
// below; a cut is also far above the next-largest change in its clip (34–188×, others ≤1.5×).
export const CUT_W = 96;
export const CUT_H = 54;
export const CUT_MIN = 8;
export const CUT_RATIO = 4;
// frames: Uint8Array of n×96×54 grey pixels → { frames, cuts: [frame…], max, cut }.
// Every jump above 8 that is also at least 4× the clip's usual large change (90th
// percentile) is a cut, so a clip with two cuts reports both.
export function cutScore(buf, { w = CUT_W, h = CUT_H } = {}) {
  const size = w * h;
  const n = Math.floor(buf.length / size);
  if (n < 3) return { frames: n, cuts: [], cut: false };
  const d = new Float64Array(n - 1);
  for (let i = 1; i < n; i += 1) {
    let sum = 0;
    const a = (i - 1) * size;
    const b = i * size;
    for (let k = 0; k < size; k += 1) sum += Math.abs(buf[b + k] - buf[a + k]);
    d[i - 1] = sum / size;
  }
  const sorted = Array.from(d).sort((x, y) => x - y);
  const p90 = sorted[Math.floor(0.9 * (sorted.length - 1))];
  // Mean difference between any two frames (for the flash test below).
  const diff = (x, y) => { let sum = 0; for (let k = 0; k < size; k += 1) sum += Math.abs(buf[y * size + k] - buf[x * size + k]); return sum / size; };
  const cuts = [];
  for (let i = 0; i < d.length; i += 1) {
    if (!(d[i] > CUT_MIN && d[i] >= CUT_RATIO * Math.max(p90, 0.01))) continue;
    // A flash (lightning, a camera flash): the picture comes back within 3 frames — not a cut.
    let back = false;
    for (let j = i + 2; j <= Math.min(n - 1, i + 4) && !back; j += 1) back = diff(i, j) <= CUT_MIN;
    if (back) { i += 3; continue; }
    cuts.push(i + 1);
  }
  const max = sorted[sorted.length - 1];
  return { frames: n, cuts, max: Math.round(max * 100) / 100, p90: Math.round(p90 * 100) / 100, cut: cuts.length > 0 };
}

// ── Camera drift (docs/ux/46 §6.4): from the picture itself, so it works without a face ──
// Frames every 0.25 s as 192×108 grey; each pair is matched by a scale about the centre and a
// shift (coarse at half size, then fine), and the scales are chained. → zoom of the last frame
// against the first (0.56 = the picture shrank to 56 %: the camera pulled back 44 %).
export const DRIFT_W = 192;
export const DRIFT_H = 108;
function half(img, w, h) {
  const w2 = w >> 1; const h2 = h >> 1; const o = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y += 1) for (let x = 0; x < w2; x += 1) {
    const i = 2 * y * w + 2 * x; o[y * w2 + x] = (img[i] + img[i + 1] + img[i + w] + img[i + w + 1]) / 4;
  }
  return o;
}
// Mean |B − A warped| over the central part: B(p) ≈ A(c + (p − c) / s − t).
function cost(A, B, w, h, s, tx, ty) {
  const cx = w / 2; const cy = h / 2; let sum = 0; let n = 0;
  const x0 = Math.round(w * 0.15); const x1 = Math.round(w * 0.85); const y0 = Math.round(h * 0.15); const y1 = Math.round(h * 0.85);
  for (let y = y0; y < y1; y += 1) {
    const sy = cy + (y - cy) / s - ty; const iy = Math.floor(sy); if (iy < 0 || iy >= h - 1) continue; const fy = sy - iy;
    for (let x = x0; x < x1; x += 1) {
      const sx = cx + (x - cx) / s - tx; const ix = Math.floor(sx); if (ix < 0 || ix >= w - 1) continue; const fx = sx - ix;
      const i = iy * w + ix;
      const a = (A[i] * (1 - fx) + A[i + 1] * fx) * (1 - fy) + (A[i + w] * (1 - fx) + A[i + w + 1] * fx) * fy;
      sum += Math.abs(B[y * w + x] - a); n += 1;
    }
  }
  return n ? sum / n : Infinity;
}
const spread = (A) => { let m = 0; for (let i = 0; i < A.length; i += 1) m += A[i]; m /= A.length; let v = 0; for (let i = 0; i < A.length; i += 1) v += (A[i] - m) ** 2; return Math.sqrt(v / A.length); };
export function pairZoom(A, B, w = DRIFT_W, h = DRIFT_H) {
  // Too little picture to match (black, fog, a flat wall): no scale can be read; count it as none.
  if (spread(A) < 4 || spread(B) < 4) return 1;
  const a2 = half(A, w, h); const b2 = half(B, w, h); const w2 = w >> 1; const h2 = h >> 1;
  // Unchanged unless another scale is clearly better (ties and near-ties stay at 1).
  const still = cost(a2, b2, w2, h2, 1, 0, 0);
  let best = { c: still * 0.98, s: 1, tx: 0, ty: 0 };
  for (let s = 0.86; s <= 1.1401; s += 0.02) for (let ty = -4; ty <= 4; ty += 1) for (let tx = -4; tx <= 4; tx += 1) {
    const c = cost(a2, b2, w2, h2, s, tx, ty); if (c < best.c) best = { c, s, tx, ty };
  }
  const A1 = Float32Array.from(A); const B1 = Float32Array.from(B);
  const fine = { c: cost(A1, B1, w, h, best.s, best.tx * 2, best.ty * 2), s: best.s, tx: best.tx * 2, ty: best.ty * 2 };
  for (let s = best.s - 0.02; s <= best.s + 0.0201; s += 0.004) for (let ty = best.ty * 2 - 2; ty <= best.ty * 2 + 2; ty += 1) for (let tx = best.tx * 2 - 2; tx <= best.tx * 2 + 2; tx += 1) {
    const c = cost(A1, B1, w, h, s, tx, ty); if (c < fine.c * 0.999) Object.assign(fine, { c, s, tx, ty });
  }
  return fine.s;
}
// buf: n frames of 192×108 grey → { zoom, steps } (zoom of the last frame against the first).
// Yields to the event loop between pairs (each pair is a few million pixel reads).
export async function driftZoom(buf, { w = DRIFT_W, h = DRIFT_H } = {}) {
  const size = w * h; const n = Math.floor(buf.length / size);
  if (n < 2) return { zoom: 1, steps: 0 };
  let zoom = 1;
  for (let i = 1; i < n; i += 1) {
    zoom *= pairZoom(buf.subarray((i - 1) * size, i * size), buf.subarray(i * size, (i + 1) * size), w, h);
    await new Promise((r) => setImmediate(r));
  }
  return { zoom: Math.round(zoom * 1000) / 1000, steps: n - 1 };
}
export const DRIFT_MIN = 0.15; // "more than 15 %" (docs/ux/44 b)

// ── Shot size from the face (docs/ux/46 §6.4: only when a face is found) ──
// YuNet's box is the face without hair. Fitted on 136 measured frames (REPORT-shot-size, stages
// 13–20): head units from the top of the head to the bottom edge = 0.591 × face units + 0.493
// (median error 0.06). The cut points are those of the shot-size report.
export function shotFromFace(faceTop, faceH, frameH) {
  const u = 0.591 * ((frameH - faceTop) / faceH) + 0.493;
  const id = u <= 1.4 ? 'face' : u <= 2.4 ? 'head-shoulders' : u <= 3.3 ? 'waist' : u <= 5.9 ? 'knees' : 'full';
  return { id, headUnits: Math.round(u * 100) / 100 };
}

// Generated clips are seconds long; anything over this is not checked (its frames would not fit).
export const CUT_MAX_SECONDS = 120;

export function createMedia({ dataDir, log, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe' }) {
  const dir = path.join(dataDir, 'thumbs'); // pruned with the previews: an unused copy is made again on demand
  fs.mkdirSync(dir, { recursive: true });
  const keyOf = (file, tag) => {
    const st = fs.statSync(file);
    return crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${tag}`).digest('hex');
  };
  const outFor = (file, tag, ext) => { const k = keyOf(file, tag); return path.join(dir, k.slice(0, 2), `${k}.${ext}`); };

  // ── Playback copies: one at a time, at low priority; never the GPU ──
  const heavyCache = new Map(); // file|size|mtime → probe result
  const failedAt = new Map(); // playback path → { at, tries }: a failing copy is retried later, not on every request
  const retryAfter = (tries) => Math.min(24 * 3600_000, 10 * 60_000 * 2 ** (tries - 1));
  const queue = [];
  const queued = new Set();
  let busy = false;
  // A video's size, length and bit rate (probed once per file version).
  async function videoInfo(file) {
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    const k = `${file}|${st.size}|${st.mtimeMs}`;
    if (heavyCache.has(k)) return heavyCache.get(k);
    const p = await probe(file, ffprobePath);
    if (p) heavyCache.set(k, p);
    if (heavyCache.size > 2000) heavyCache.delete(heavyCache.keys().next().value);
    return p;
  }
  async function isHeavy(file) {
    const p = await videoInfo(file);
    return Boolean(p && (Math.max(p.width, p.height) > PLAYBACK.MAX_W || Math.min(p.width, p.height) > PLAYBACK.MAX_H || p.bps > PLAYBACK.HEAVY_BPS));
  }
  const playbackPath = (file) => { try { return outFor(file, 'play-v1', 'mp4'); } catch { return null; } };
  // → the playback copy if it is ready, else null (and it is queued when the video is heavy).
  async function playbackFor(file) {
    if (!VIDEO_EXT.test(file)) return null;
    const out = playbackPath(file);
    if (!out) return null;
    if (fs.existsSync(out)) return out;
    const failed = failedAt.get(out);
    if (failed && Date.now() - failed.at < retryAfter(failed.tries)) return null;
    if (await isHeavy(file)) enqueue(file);
    return null;
  }
  // The playback copy's version for its own URL (?play=<key>), or null while it is not ready.
  async function playbackKey(file) {
    const out = await playbackFor(file);
    return out ? path.basename(out, '.mp4').slice(0, 16) : null;
  }
  function enqueue(file) {
    if (queued.has(file)) return;
    queued.add(file);
    queue.push(file);
    if (!busy) next();
  }
  async function next() {
    const file = queue.shift();
    if (!file) { busy = false; return; }
    busy = true;
    const t0 = Date.now();
    let out = null;
    const tmp = () => `${out}.${process.pid}.tmp.mp4`;
    try {
      out = playbackPath(file);
      if (out && !fs.existsSync(out)) {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        // Fits inside 1920×1080 (portrait inside 1080×1920), never upscaled, even sizes.
        const fit = `scale=w='if(gte(iw,ih),min(${PLAYBACK.MAX_W},iw),min(${PLAYBACK.MAX_H},iw))':h='if(gte(iw,ih),min(${PLAYBACK.MAX_H},ih),min(${PLAYBACK.MAX_W},ih))':force_original_aspect_ratio=decrease:force_divisible_by=2`;
        await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?',
          '-vf', `${fit},format=yuv420p`, '-c:v', 'libx264', '-preset', PLAYBACK.PRESET, '-crf', String(PLAYBACK.CRF), '-maxrate', PLAYBACK.MAXRATE, '-bufsize', PLAYBACK.BUFSIZE,
          '-profile:v', 'high', '-threads', String(PLAYBACK.THREADS), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp()], { timeoutMs: 30 * 60_000, nice: 15 });
        fs.renameSync(tmp(), out);
        failedAt.delete(out);
        log?.info?.({ media: 'playback', file: path.basename(file), ms: Date.now() - t0, bytes: fs.statSync(out).size, from: fs.statSync(file).size }, 'playback copy made');
      }
    } catch (error) {
      if (out) { const f = failedAt.get(out); failedAt.set(out, { at: Date.now(), tries: (f?.tries || 0) + 1 }); if (failedAt.size > 500) failedAt.delete(failedAt.keys().next().value); }
      log?.warn?.(`playback copy for ${path.basename(file)}: ${error.message}`);
    } finally {
      if (out) try { fs.unlinkSync(tmp()); } catch { /* moved or never made */ }
      queued.delete(file);
      setImmediate(next);
    }
  }
  // After a video is saved: fast start now, the playback copy in the background.
  async function prepare(file) {
    if (!VIDEO_EXT.test(file)) return false;
    let fixed = false;
    try { fixed = await faststart(file, { ffmpegPath }); } catch (error) { log?.warn?.(`fast start for ${path.basename(file)}: ${error.message}`); }
    playbackFor(file).catch(() => {});
    return fixed;
  }

  // ── Frame strip: n frames in one webp, made once ──
  // At most two at a time (each is small); one size only, so a file has one strip.
  const stripInflight = new Map();
  const STRIP_N = 12;
  const STRIP_MAX = 2;
  let stripRunning = 0;
  const stripWaiting = [];
  const stripSlot = () => (stripRunning < STRIP_MAX ? (stripRunning += 1, Promise.resolve()) : new Promise((r) => stripWaiting.push(r)));
  const stripDone = () => { const nextUp = stripWaiting.shift(); if (nextUp) nextUp(); else stripRunning -= 1; };
  async function stripFor(file) {
    if (!VIDEO_EXT.test(file) && !/\.webm$/i.test(file)) return null;
    const count = STRIP_N;
    let out;
    try { out = outFor(file, `strip-${count}`, 'webp'); } catch { return null; }
    if (fs.existsSync(out)) return out;
    if (stripInflight.has(out)) return stripInflight.get(out);
    if (stripWaiting.length >= 20) return null;
    const job = (async () => {
      const tmp = `${out}.${process.pid}.tmp.webp`;
      await stripSlot();
      try {
        const p = await probe(file, ffprobePath);
        const d = p?.duration || 0;
        if (!d) return null;
        fs.mkdirSync(path.dirname(out), { recursive: true });
        // One frame per slice of the clip, 160 px wide, side by side.
        await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', file,
          '-vf', `fps=${count}/${d.toFixed(3)},scale=160:-2,tile=${count}x1`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '70', tmp], { timeoutMs: 120_000, nice: 10 });
        fs.renameSync(tmp, out);
        return out;
      } catch (error) {
        log?.warn?.(`frame strip for ${path.basename(file)}: ${error.message}`);
        return null;
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* moved */ }
        stripInflight.delete(out);
        stripDone();
      }
    })();
    stripInflight.set(out, job);
    return job;
  }

  // ?play=<key> → the copy itself, only while <key> still names this file's current copy.
  function playbackByKey(file, key) {
    const out = playbackPath(file);
    return out && /^[0-9a-f]{16}$/.test(String(key)) && path.basename(out).startsWith(key) && fs.existsSync(out) ? out : null;
  }
  // → { v, cut: null | { at, frame }, cuts: [{ at, frame }] } for a finished video; null when it
  // can't be read. `background`: the backlog of older videos waits in its own line, one at a
  // time, so a new clip is never held up behind it.
  let backlogChain = Promise.resolve();
  const ffRaw = (args, cap) => new Promise((resolve) => {
    const p = spawn('nice', ['-n', '10', ffmpegPath, '-hide_banner', '-loglevel', 'error', '-threads', '1', ...args, 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const parts = []; let bytes = 0; let over = false;
    const timer = setTimeout(() => p.kill('SIGKILL'), 30_000);
    p.stdout.on('data', (c) => { bytes += c.length; if (bytes <= cap) parts.push(c); else if (!over) { over = true; p.kill('SIGKILL'); } });
    p.on('error', () => { clearTimeout(timer); resolve(null); });
    p.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && !over ? Buffer.concat(parts) : null); });
  });
  // v3: cuts, camera drift (picture scale), shot size from the face (first, middle, last frame).
  async function scanVideo(file) {
    const info = await videoInfo(file);
    if (info?.duration > CUT_MAX_SECONDS) return { v: 3, cut: null, cuts: [], skipped: 'long' };
    const buf = await ffRaw(['-i', file, '-an', '-vf', `scale=${CUT_W}:${CUT_H}:flags=area,format=gray`, '-f', 'rawvideo'], 64 * 1024 * 1024);
    if (!buf) return null;
    const r = cutScore(buf);
    if (r.frames < 3) return null;
    const fps = info?.duration ? r.frames / info.duration : 24;
    const cuts = r.cuts.map((frame) => ({ at: Math.round((frame / fps) * 10) / 10, frame }));
    const out = { v: 3, cut: cuts[0] || null, cuts, drift: null, shot: null };
    // Drift: meaningless across a cut (another camera position), so only without one.
    if (!cuts.length) {
      // 4 samples a second up to 6 s, 2 beyond (a 10 s clip: 20 pairs).
      const rate = info?.duration > 6 ? 2 : 4;
      const g = await ffRaw(['-i', file, '-an', '-vf', `fps=${rate},scale=${DRIFT_W}:${DRIFT_H}:flags=area,format=gray`, '-f', 'rawvideo'], 8 * 1024 * 1024);
      if (g) {
        const d = await driftZoom(g);
        out.drift = { zoom: d.zoom };
        if (Math.abs(d.zoom - 1) > DRIFT_MIN) out.drift.move = d.zoom < 1 ? 'pull' : 'push';
      }
    }
    // Shot size: the face on the first, middle and last frame (the median of what is found).
    try {
      const pick = [0, Math.floor(r.frames / 2), r.frames - 1];
      // Fitted inside YuNet's 640×640 (portrait clips too), even sizes set explicitly.
      const iw = info?.width || 1280; const ih = info?.height || 720;
      const even = (v) => Math.max(2, 2 * Math.round(v / 2));
      const fw = iw >= ih ? 640 : even((640 * iw) / ih); const fh = iw >= ih ? even((640 * ih) / iw) : 640;
      const rgb = await ffRaw(['-i', file, '-an', '-vf', `select=${pick.map((n) => `eq(n\\,${n})`).join('+')},scale=${fw}:${fh}:flags=area`, '-vsync', '0', '-pix_fmt', 'rgb24', '-f', 'rawvideo'], 8 * 1024 * 1024);
      if (rgb && rgb.length >= fw * fh * 3) {
        const { detectFaces } = await import('./faces.js');
        const units = [];
        for (let k = 0; k * fw * fh * 3 < rgb.length && k < 3; k += 1) {
          const faces = await detectFaces(rgb.subarray(k * fw * fh * 3, (k + 1) * fw * fh * 3), fw, fh);
          if (faces[0]) units.push(shotFromFace(faces[0].y, faces[0].h, fh));
        }
        if (units.length) {
          units.sort((a, b) => a.headUnits - b.headUnits);
          out.shot = units[Math.floor(units.length / 2)];
        }
      }
    } catch (error) { log?.warn?.(`shot check ${path.basename(file)}: ${error.message}`); }
    return out;
  }
  function checkVideo(file, { background = false } = {}) {
    if (!VIDEO_EXT.test(file) && !/\.webm$/i.test(file)) return Promise.resolve(null);
    const run = () => scanVideo(file).catch((error) => { log?.warn?.(`cut check ${path.basename(file)}: ${error.message}`); return null; });
    if (!background) return run();
    const job = backlogChain.then(run);
    backlogChain = job.catch(() => {});
    return job;
  }

  return { prepare, playbackFor, playbackKey, playbackByKey, stripFor, isHeavy, videoInfo, checkVideo };
}
