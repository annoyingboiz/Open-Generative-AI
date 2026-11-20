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
  return { prepare, playbackFor, playbackKey, playbackByKey, stripFor, isHeavy, videoInfo };
}
