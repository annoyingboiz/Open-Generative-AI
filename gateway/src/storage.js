// Files on disk: user uploads (references) and generated results.
//   DATA_DIR/uploads/u<user>/<id>.<ext>
//   DATA_DIR/media/u<user>/<yyyy>/<mm>/<generation>-<n>.<ext>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { providerFetch } from './providers/http.js';
import { assertPublicHttpsUrl } from './net-guard.js';

const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/flac': 'flac',
  'model/gltf-binary': 'glb',
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));
MIME_BY_EXT.jpeg = 'image/jpeg';

export const mimeForExt = (ext) => MIME_BY_EXT[String(ext).toLowerCase()] || 'application/octet-stream';
export const extForMime = (mime) => EXT_BY_MIME[String(mime || '').split(';')[0].trim().toLowerCase()];
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;

// Only media types go in. No HTML, SVG, scripts.
const ALLOWED_UPLOAD = /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp3|wav|x-wav|ogg|aac|mp4|flac))$/;
export const isAllowedUploadMime = (mime) => ALLOWED_UPLOAD.test(String(mime || '').toLowerCase());

export function createStorage(dataDir, { allowLocalDownloads = false } = {}) {
  const uploadsRoot = path.join(dataDir, 'uploads');
  const mediaRoot = path.join(dataDir, 'media');
  fs.mkdirSync(uploadsRoot, { recursive: true });
  fs.mkdirSync(mediaRoot, { recursive: true });

  async function saveUpload(userId, stream, mime) {
    const id = newId('up');
    const dir = path.join(uploadsRoot, `u${userId}`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.${extForMime(mime) || 'bin'}`);
    await pipeline(stream, fs.createWriteStream(file));
    return { id, path: file, bytes: fs.statSync(file).size };
  }

  // Downloads a provider result to our disk (through the provider's proxy).
  async function downloadResult({ userId, generationId, index, url, proxy }) {
    if (!allowLocalDownloads) await assertPublicHttpsUrl(url, { viaProxy: Boolean(proxy) });
    const response = await providerFetch(url, { proxy, timeoutMs: 15 * 60_000, redirect: 'error' });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
    const headerMime = (response.headers.get('content-type') || '').split(';')[0].trim();
    const urlExt = (new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i) || [])[1];
    const ext = extForMime(headerMime) || (urlExt ? urlExt.toLowerCase() : 'bin');
    const mime = extForMime(headerMime) ? headerMime : mimeForExt(ext);
    const d = new Date();
    const dir = path.join(mediaRoot, `u${userId}`, String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${generationId}-${index}.${ext}`);
    const tmp = `${file}.part`;
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmp));
    fs.renameSync(tmp, file);
    return { path: file, mime, bytes: fs.statSync(file).size, ext };
  }

  function remove(file) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }

  return { saveUpload, downloadResult, remove, uploadsRoot, mediaRoot };
}

// Sends a file with HTTP Range support (needed for video seeking).
export function sendFile(req, reply, file, mime, { download = false, name } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { return reply.code(404).send({ error: 'File not found' }); }
  reply.header('content-type', mime);
  reply.header('accept-ranges', 'bytes');
  reply.header('cache-control', 'private, max-age=31536000, immutable');
  if (download) reply.header('content-disposition', `attachment; filename="${(name || path.basename(file)).replace(/"/g, '')}"`);
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    let start = range[1] === '' ? undefined : Number(range[1]);
    let end = range[2] === '' ? undefined : Number(range[2]);
    if (start === undefined) { start = Math.max(0, stat.size - end); end = stat.size - 1; }
    if (end === undefined || end >= stat.size) end = stat.size - 1;
    if (start > end || start >= stat.size) {
      return reply.code(416).header('content-range', `bytes */${stat.size}`).send();
    }
    reply.code(206).header('content-range', `bytes ${start}-${end}/${stat.size}`).header('content-length', end - start + 1);
    return reply.send(fs.createReadStream(file, { start, end }));
  }
  reply.header('content-length', stat.size);
  return reply.send(fs.createReadStream(file));
}
