// Small video edits on this server (ffmpeg): shots stitched into one video,
// the last frame of a video as a picture. One edit at a time (the box is shared).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { videoInfo } from './video-upscale.js';

export class EditError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const MAX_CLIPS = 30;
const MAX_TOTAL_SECONDS = 15 * 60;
let busy = Promise.resolve();
// Runs edits one after another.
const queued = (fn) => { const run = busy.then(fn, fn); busy = run.catch(() => {}); return run; };

function ffmpeg(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-v', 'error', '-y', '-threads', '2', ...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, _out, stderr) => {
      if (error) reject(new EditError(`ffmpeg: ${String(stderr || error.message).trim().slice(-300)}`, 500)); else resolve();
    });
  });
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// The clips' common size: the first clip's, at most 1920 on the long side.
function targetSize(infos) {
  const first = infos[0];
  const scale = Math.min(1, 1920 / Math.max(first.width, first.height));
  return { width: even(first.width * scale), height: even(first.height * scale) };
}

// files: [{ path }] in order → one MP4 (H.264 + AAC), every clip fitted into
// the first one's frame (letterboxed if needed), 24/25/30 fps as the first,
// silent clips get silence so the sound stays in sync. Returns { path, ext, mime, cleanup }.
export function stitch(files) {
  if (!Array.isArray(files) || files.length < 2) throw new EditError('Pick videos for at least two shots.');
  if (files.length > MAX_CLIPS) throw new EditError(`At most ${MAX_CLIPS} shots in one video.`);
  return queued(async () => {
    const infos = await Promise.all(files.map((f) => videoInfo(f.path)));
    const bad = infos.findIndex((x) => !x || !x.width || !x.height);
    if (bad >= 0) throw new EditError(`Shot ${bad + 1}: the video can't be read.`);
    const total = infos.reduce((n, x) => n + (x.duration || 0), 0);
    if (total > MAX_TOTAL_SECONDS) throw new EditError('The video would be longer than 15 minutes.');
    const { width, height } = targetSize(infos);
    const fps = [24, 25, 30].reduce((best, f) => (Math.abs(f - infos[0].fps) < Math.abs(best - infos[0].fps) ? f : best), 24);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-stitch-'));
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    try {
      const args = [];
      files.forEach((f) => args.push('-i', f.path));
      const parts = [];
      infos.forEach((info, i) => {
        parts.push(`[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${i}]`);
        const dur = Math.max(0.1, info.duration || 0).toFixed(3);
        parts.push(info.audio
          ? `[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${dur}[a${i}]`
          : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${dur}[a${i}]`);
      });
      parts.push(`${infos.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${infos.length}:v=1:a=1[v][a]`);
      const out = path.join(dir, 'stitched.mp4');
      await ffmpeg([...args, '-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], Math.max(120_000, total * 8_000));
      return { path: out, ext: 'mp4', mime: 'video/mp4', cleanup, width, height, duration: total };
    } catch (error) {
      cleanup();
      throw error;
    }
  });
}

// The last frame of a video as a PNG (for the next shot's start frame).
export function lastFrame(file) {
  return queued(async () => {
    const info = await videoInfo(file);
    if (!info) throw new EditError('The video can\'t be read.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-frame-'));
    const out = path.join(dir, 'last.png');
    try {
      // A little before the end: the very last timestamp sometimes has no frame.
      await ffmpeg(['-sseof', '-0.25', '-i', file, '-update', '1', '-q:v', '1', out], 60_000);
      if (!fs.existsSync(out) || !fs.statSync(out).size) await ffmpeg(['-ss', String(Math.max(0, info.duration - 0.5)), '-i', file, '-frames:v', '1', out], 60_000);
      return { path: out, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    } catch (error) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  });
}
