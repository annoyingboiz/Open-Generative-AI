// Small previews for grids: a picture or the first frame of a video, as a
// webp a few hundred pixels wide. Made once on first ask and kept on disk
// (data/thumbs), so grids load a few dozen KB per card instead of a 4K file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const WIDTHS = [256, 480, 800];
const MAX_PARALLEL = 2; // previews never take the whole CPU

export function createThumbs({ dataDir, log, ffmpegPath = 'ffmpeg' }) {
  const dir = path.join(dataDir, 'thumbs');
  fs.mkdirSync(dir, { recursive: true });
  sharp.concurrency(1);
  const inflight = new Map();
  let running = 0;
  const queue = [];
  const slot = () => new Promise((resolve) => {
    if (running < MAX_PARALLEL) { running += 1; resolve(); } else queue.push(resolve);
  });
  const release = () => { const next = queue.shift(); if (next) next(); else running -= 1; };

  // The first frame of a video (at 0.5 s, or the very first if shorter) as PNG.
  const firstFrame = (file) => new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'];
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 20_000);
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length) resolve(buf); else reject(new Error(err.trim().slice(0, 200) || `ffmpeg exit ${code}`));
    });
  });

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
    const job = (async () => {
      await slot();
      try {
        const input = isVideo ? await firstFrame(file) : file;
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const tmp = `${out}.${process.pid}.tmp`;
        await sharp(input, { animated: false, limitInputPixels: 300_000_000 }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toFile(tmp);
        fs.renameSync(tmp, out);
        return out;
      } catch (error) {
        log?.warn?.(`preview for ${path.basename(file)}: ${error.message}`);
        return null;
      } finally {
        release();
        inflight.delete(out);
      }
    })();
    inflight.set(out, job);
    return job;
  }

  return { thumbFor };
}
