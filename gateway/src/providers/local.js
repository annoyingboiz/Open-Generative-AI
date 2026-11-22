// "This server": MiniMax H3 and Wan 2.2 on the home server's own ComfyUI,
// through h3-bridge (local/h3-bridge — runs on the host, one job at a time,
// waits while the machine is busy). Free. Admins only (see app.js).
//
// The bridge shares a folder with us (LOCAL_BRIDGE_DIR, mounted into the
// container): we copy input pictures into <dir>/in/, talk HTTP over
// <dir>/bridge.sock, and copy results back from <dir>/jobs/<id>/.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

let DIR = '';
export function configureLocal(dir) { DIR = dir ? path.resolve(dir) : ''; }
export const localConfigured = () => Boolean(DIR);

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const IN_REF = /^bridge-in:([A-Za-z0-9_-]{6,80}\.(?:png|jpe?g|webp))$/;
const OUT_REF = /^bridge-out:([A-Za-z0-9_-]{6,64})\/(clip\.mp4)$/;
const MODELS = {
  'minimax-h3-i2v': { engine: 'h3' },
  'minimax-h3-r2v': { engine: 'h3' },
  'wan-2.2': { engine: 'wan' },
};

function call(method, urlPath, body, { timeoutMs = 15_000 } = {}) {
  if (!DIR) return Promise.reject(Object.assign(new Error('This server is not set up for local generation.'), { status: 409 }));
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      socketPath: path.join(DIR, 'bridge.sock'), method, path: urlPath,
      headers: { 'content-type': 'application/json', ...(data ? { 'content-length': data.length } : {}) },
      timeout: timeoutMs,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; if (text.length > 1_000_000) req.destroy(new Error('Bridge answer too large')); });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(text || '{}'); } catch { json = {}; }
        if (res.statusCode >= 400) reject(Object.assign(new Error(json.error || `Bridge HTTP ${res.statusCode}`), { status: res.statusCode }));
        else resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('The local bridge did not answer.')));
    req.on('error', (error) => reject(Object.assign(new Error(/ENOENT|ECONNREFUSED/.test(error.code || error.message) ? 'The local machine is offline (h3-bridge is not running).' : error.message), { status: 503 })));
    if (data) req.write(data);
    req.end();
  });
}

// A job's state as one short line for the studio ("Waiting for the GPU: …").
function noteOf(job) {
  if (job.state === 'waiting') return `Waiting for the GPU: ${job.reason || 'the machine is busy'}${job.position > 1 ? ` · ${job.position - 1} ahead` : ''}`;
  if (job.state === 'queued') return job.position > 1 ? `In line on this server · ${job.position - 1} ahead` : 'Starting on this server';
  if (job.state === 'running') {
    const s = Number(job.progress?.elapsed_s) || 0;
    return `Rendering on this server${s ? ` · ${Math.floor(s / 60)} min ${s % 60} s` : ''}`;
  }
  return null;
}

export const local = {
  id: 'local',
  name: 'This server',
  noKey: true,

  // Our file → a copy in the bridge's inbox (pictures only).
  async upload(cfg, { path: file, mime }) {
    const ext = IMAGE_EXT[mime];
    if (!ext) throw Object.assign(new Error('This server takes pictures only (PNG, JPEG, WebP).'), { status: 400 });
    const name = `${crypto.randomBytes(12).toString('base64url')}.${ext}`;
    const inbox = path.join(DIR, 'in');
    await fs.promises.mkdir(inbox, { recursive: true });
    await fs.promises.copyFile(file, path.join(inbox, name));
    return { url: `bridge-in:${name}`, expiresAt: Date.now() + 86_400_000 };
  },

  async submit(cfg, { model, body }) {
    const spec = MODELS[model];
    if (!spec) throw Object.assign(new Error(`Unknown local model ${model}`), { status: 404 });
    const name = (v) => { const m = IN_REF.exec(String(v || '')); if (!m) throw Object.assign(new Error('A picture did not reach this server.'), { status: 400 }); return m[1]; };
    const refs = Array.isArray(body.reference_images) ? body.reference_images.map(name) : [];
    // Each endpoint runs one way: the start-frame model needs its frame, the reference model takes no frame.
    if (model === 'minimax-h3-i2v' && (!body.image || refs.length)) throw Object.assign(new Error('This model needs a start frame (and no references).'), { status: 409 });
    if (model === 'minimax-h3-r2v' && body.image) throw Object.assign(new Error('Use the start-frame model for a start frame.'), { status: 409 });
    const id = `dz_${crypto.randomBytes(12).toString('base64url')}`;
    await call('POST', '/jobs', {
      id,
      engine: spec.engine,
      prompt: body.prompt,
      image: body.image ? name(body.image) : undefined,
      refs: refs.length ? refs : undefined,
      res: body.resolution,
      ratio: body.aspect_ratio || 'auto',   // "auto": the bridge follows the start frame
      seconds: Number(body.duration) || 5,
      turbo: body.turbo === true,
      sound: body.generate_audio !== false,
      seed: Number.isInteger(body.seed) ? body.seed : undefined,
    });
    return { taskId: id };
  },

  async poll(cfg, taskId) {
    let job;
    try { job = await call('GET', `/jobs/${encodeURIComponent(taskId)}`); } catch (error) {
      if (error.status === 404) return { state: 'failed', error: 'The job was lost on this server.' };
      throw error;
    }
    if (job.state === 'done') return { state: 'completed', outputs: (job.outputs || []).map((o) => `bridge-out:${taskId}/${o}`), costUsd: 0 };
    if (job.state === 'failed') return { state: 'failed', error: job.error || 'Failed on this server.' };
    if (job.state === 'cancelled') return { state: 'failed', error: 'Cancelled.' };
    return { state: 'processing', note: noteOf(job) };
  },

  async cancel(cfg, taskId) {
    return call('POST', `/jobs/${encodeURIComponent(taskId)}/cancel`);
  },

  // A result reference → the file on disk (inside the bridge folder only).
  resultFile(ref) {
    const m = OUT_REF.exec(String(ref || ''));
    if (!m || !DIR) return null;
    const file = path.join(DIR, 'jobs', m[1], m[2]);
    return file.startsWith(path.join(DIR, 'jobs') + path.sep) ? file : null;
  },

  status: () => call('GET', '/status', undefined, { timeoutMs: 5000 }),
};

// The studio's models for this provider (static: the bridge decides what runs).
export const LOCAL_MODELS = MODELS;
