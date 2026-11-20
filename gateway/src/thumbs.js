// Small previews for grids: a picture or the first frame of a video, as a
// webp a few hundred pixels wide. Made once on first ask and kept on disk
// (data/thumbs), so grids load a few dozen KB per card instead of a 4K file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const WIDTHS = [256, 480, 800, 1600, 2048]; // 1600 / 2048: the large view shows a picture at screen size, not the 4K original
const MAX_PARALLEL = 2; // previews never take the whole CPU
const MAX_WAITING = 120; // more than this waiting → "busy" (try again)
const MAX_PIXELS = 50_000_000; // bigger pictures get no preview (original is sent)
const MAX_FRAME_BYTES = 30 * 1024 * 1024;
const KEEP_DAYS = 30; // unused previews are removed after this

export function createThumbs({ dataDir, log, ffmpegPath = 'ffmpeg' }) {
  const dir = path.join(dataDir, 'thumbs');
  fs.mkdirSync(dir, { recursive: true });
  sharp.concurrency(1);
  const inflight = new Map();
  let running = 0;
  const queue = [];
  // The picture someone opened (a large size) goes before the grid's small previews.
  const slot = (first = false) => new Promise((resolve) => {
    if (running < MAX_PARALLEL) { running += 1; resolve(); } else if (first) queue.unshift(resolve); else queue.push(resolve);
  });
  const release = () => { const next = queue.shift(); if (next) next(); else running -= 1; };

  // One frame of a video as PNG, already scaled down inside ffmpeg (one thread).
  const frameAt = (file, seek) => new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-threads', '1', ...(seek ? ['-ss', seek] : []), '-i', file,
      '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-f', 'image2pipe', '-vcodec', 'png', '-'];
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 20_000);
    p.stdout.on('data', (c) => { size += c.length; if (size > MAX_FRAME_BYTES) p.kill('SIGKILL'); else chunks.push(c); });
    p.stderr.on('data', (c) => { if (err.length < 2000) err += c; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length) resolve(buf); else reject(new Error(err.trim().slice(0, 200) || `ffmpeg exit ${code}`));
    });
  });
  // At 0.5 s (past a black first frame); a shorter clip: its very first frame.
  const firstFrame = async (file) => { try { return await frameAt(file, '0.5'); } catch { return frameAt(file, null); } };

  // → path of the preview, or null if it can't be made (the caller sends the original).
  async function thumbFor(file, mime, wanted) {
    const width = WIDTHS.find((w) => w >= Number(wanted)) || WIDTHS[WIDTHS.length - 1];
    const isVideo = String(mime).startsWith('video/');
    if (!isVideo && !String(mime).startsWith('image/')) return null;
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${width}`).digest('hex');
    const out = path.join(dir, key.slice(0, 2), `${key}.webp`);
    if (fs.existsSync(out)) return out;
    if (inflight.has(out)) return inflight.get(out);
    if (queue.length >= MAX_WAITING) return 'busy';
    const job = (async () => {
      await slot(width >= 1600);
      const tmp = `${out}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        const input = isVideo ? await firstFrame(file) : file;
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await sharp(input, { animated: false, limitInputPixels: MAX_PIXELS }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toFile(tmp);
        fs.renameSync(tmp, out);
        return out;
      } catch (error) {
        log?.warn?.(`preview for ${path.basename(file)}: ${error.message}`);
        return null;
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* moved into place, or never made */ }
        release();
        inflight.delete(out);
      }
    })();
    inflight.set(out, job);
    return job;
  }

  // Previews not opened for KEEP_DAYS go (their files may be gone too); a
  // preview asked for again is simply made again.
  function prune() {
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    let removed = 0;
    for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const d = path.join(dir, sub.name);
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        try { const st = fs.statSync(p); if (Math.max(st.atimeMs, st.mtimeMs) < cutoff || name.endsWith('.tmp')) { fs.unlinkSync(p); removed += 1; } } catch { /* gone */ }
      }
    }
    return removed;
  }
  // A served preview counts as used (atime may be off on the disk).
  const touch = (p) => { try { const t = new Date(); fs.utimesSync(p, t, t); } catch { /* ignore */ } };

  return { thumbFor, prune, touch };
}
