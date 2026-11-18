// APIMart (https://apimart.ai) — docs: https://docs.apimart.ai
import fs from 'node:fs';
import nodePath from 'node:path';
import crypto from 'node:crypto';
import { providerJson, providerFetch, ProviderHttpError, fileForm } from './http.js';

const API = 'https://api.apimart.ai';
const auth = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });

const SUBMIT_PATH = { image: '/v1/images/generations', video: '/v1/videos/generations' };

// Audio. Music and sound effects are async tasks under /v1/music (their own
// task query); speech answers at once with the audio itself. Our model ids are
// the catalog's; `model` is what APIMart gets. Docs: docs.apimart.ai → Audio.
export const APIMART_AUDIO = {
  suno: { path: '/v1/music/generations', model: 'suno' },
  'suno-sounds': { path: '/v1/music/generations/sounds', model: 'suno' },
  flowmusic: { path: '/v1/music/generations', model: 'flowmusic' },
  'flowmusic-lyria-3.5': { path: '/v1/music/generations', model: 'flowmusic', fixed: { version: 'lyria-3.5' } },
  'gpt-4o-mini-tts': { path: '/v1/audio/speech', model: 'gpt-4o-mini-tts', speech: true },
};
const SPEECH_EXT = { wav: ['wav', 'audio/wav'], aac: ['aac', 'audio/aac'], flac: ['flac', 'audio/flac'], opus: ['ogg', 'audio/ogg'] };
// Speech files wait here between "submit" and the download step.
let speechDir = null;
export function configureApimartFiles(dir) { speechDir = dir || null; }
const FILE_RE = /^apimart-file:([a-f0-9-]{36}\.(wav|aac|flac|ogg))$/;
// task ids we store: "music:<id>" (music API), "file:<name>" (speech, done at once), "<id>" (everything else)
const splitTask = (taskId) => {
  const m = /^(music|file):(.+)$/.exec(String(taskId));
  return m ? { type: m[1], id: m[2] } : { type: 'task', id: String(taskId) };
};
const UPLOAD_KIND = { image: 'images', video: 'videos', audio: 'audios' };

// Collects every URL from APIMart's task result, whatever the nesting.
function resultUrls(result) {
  const urls = [];
  const take = (v) => {
    if (!v) return;
    if (typeof v === 'string') { if (/^https?:\/\//.test(v)) urls.push(v); return; }
    if (Array.isArray(v)) { v.forEach(take); return; }
    if (typeof v === 'object') take(v.url ?? v.urls ?? v.video_url ?? v.image_url ?? v.audio_url);
  };
  take(result?.images);
  take(result?.videos);
  take(result?.audios);
  take(result?.url);
  // Music tasks: result.music[] with audio_url (plus a cover image we skip).
  if (Array.isArray(result?.music)) for (const m of result.music) take(m?.audio_url || m?.wav_url);
  return [...new Set(urls)];
}

export const apimart = {
  id: 'apimart',
  name: 'APIMart',
  website: 'https://apimart.ai',
  keysUrl: 'https://apimart.ai/console/token',

  async balance({ apiKey, proxy }) {
    const data = await providerJson(`${API}/v1/user/balance`, { proxy, headers: auth(apiKey), timeoutMs: 20_000 });
    if (data?.success === false) throw new Error(data.message || 'APIMart refused the key');
    return { amount: Number(data.remain_balance), currency: 'USD' };
  },

  async listModels({ apiKey, proxy }) {
    const data = await providerJson(`${API}/v1/models?expand=parameters`, { proxy, headers: auth(apiKey), timeoutMs: 60_000 });
    return data?.data || [];
  },

  // Public endpoint, no key: per-model price (per image / per second, by resolution).
  async price({ proxy }, model) {
    const data = await providerJson(`${API}/api/pricing/model?model=${encodeURIComponent(model)}`, { proxy, timeoutMs: 20_000 });
    return data?.success ? data.data : null;
  },

  // Price our account pays for this request (membership/custom pricing
  // applied). https://docs.apimart.ai/en/api-reference/account/request-logs
  async quote({ apiKey, proxy }, { model, body }) {
    // Audio is priced per request / per token: the catalog price stands (no spec API).
    if (APIMART_AUDIO[model]) return null;
    const spec = {};
    if (body.resolution) spec.resolution = body.resolution;
    if (body.size) spec.size = body.size;
    if (body.quality) spec.quality = body.quality;
    if (Number.isFinite(Number(body.duration))) spec.duration = Math.round(Number(body.duration));
    if (Number.isFinite(Number(body.n)) && Number(body.n) > 1) spec.n = Math.round(Number(body.n));
    const ask = async (params) => providerJson(`${API}/v1/pricing/model?${new URLSearchParams({ model, ...params })}`, { proxy, headers: auth(apiKey), timeoutMs: 15_000 });
    // A spec field the price list doesn't know (e.g. "2K" on a model priced
    // only for 4K, or a size that doesn't change the price) means the default
    // applies: drop it and ask again.
    let data;
    for (;;) {
      try {
        data = await ask(spec);
        break;
      } catch (error) {
        const field = ['size', 'resolution', 'quality'].find((f) => spec[f] !== undefined && new RegExp(`\\b${f}\\b`, 'i').test(error.message))
          || ['size', 'resolution', 'quality'].find((f) => spec[f] !== undefined);
        if (!(error instanceof ProviderHttpError) || error.status !== 400 || !field) throw error;
        delete spec[field];
      }
    }
    const usd = Number(data?.total_usd ?? data?.unit_price_usd);
    if (!Number.isFinite(usd)) return null;
    const perSecondWithoutDuration = data?.unit === 'per_second' && spec.duration === undefined;
    return { usd, exact: data?.estimated !== true && !perSecondWithoutDuration };
  },

  // What a finished task actually cost (logs appear a few seconds later).
  async actualCost({ apiKey, proxy }, taskId) {
    const task = splitTask(taskId);
    if (task.type === 'file') return null; // speech: no task log to look up
    try {
      const data = await providerJson(`${API}/v1/logs/requests/${encodeURIComponent(task.id)}`, { proxy, headers: auth(apiKey), timeoutMs: 15_000 });
      const records = (data?.data || []).filter((r) => r.type === 'consume');
      if (!records.length) return null;
      return records.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) return null; // not written yet
      throw error;
    }
  },

  async submit({ apiKey, proxy }, { kind, model, body }) {
    const audio = APIMART_AUDIO[model];
    if (audio?.speech) {
      if (!speechDir) throw new Error('APIMart speech: no folder for results');
      const format = SPEECH_EXT[body.response_format] ? body.response_format : 'wav';
      const response = await providerFetch(`${API}${audio.path}`, {
        proxy,
        method: 'POST',
        headers: { ...auth(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, response_format: format, model: audio.model }),
        timeoutMs: 180_000,
      });
      const type = String(response.headers.get('content-type') || '');
      if (!response.ok || /json|text\//i.test(type)) {
        const text = await response.text();
        let detail = text.slice(0, 200);
        try { const j = JSON.parse(text); detail = j.error?.message || j.message || detail; } catch { /* plain text */ }
        throw new ProviderHttpError(`HTTP ${response.status}: ${detail}`, { status: response.ok ? 502 : response.status });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > 200 * 1024 * 1024) throw new Error('APIMart speech: empty or oversized audio');
      fs.mkdirSync(speechDir, { recursive: true });
      const name = `${crypto.randomUUID()}.${SPEECH_EXT[format][0]}`;
      await fs.promises.writeFile(nodePath.join(speechDir, name), buffer);
      return { taskId: `file:${name}` };
    }
    if (audio) {
      const data = await providerJson(`${API}${audio.path}`, {
        proxy,
        method: 'POST',
        headers: { ...auth(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...(audio.fixed || {}), model: audio.model }),
        timeoutMs: 120_000,
      });
      const first = Array.isArray(data?.data) ? data.data[0] : data?.data;
      const taskId = first?.task_id || data?.task_id || first?.id;
      if (!taskId) throw new Error(`APIMart: no task id in response ${JSON.stringify(data).slice(0, 200)}`);
      return { taskId: `music:${taskId}` };
    }
    const pathFor = SUBMIT_PATH[kind];
    if (!pathFor) throw new Error(`APIMart: ${kind} generation is not supported yet`);
    const data = await providerJson(`${API}${pathFor}`, {
      proxy,
      method: 'POST',
      headers: { ...auth(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model }),
      timeoutMs: 120_000,
    });
    const first = Array.isArray(data?.data) ? data.data[0] : data?.data;
    const taskId = first?.task_id || data?.task_id || first?.id;
    if (!taskId) throw new Error(`APIMart: no task id in response ${JSON.stringify(data).slice(0, 200)}`);
    return { taskId };
  },

  async poll({ apiKey, proxy }, taskId) {
    const task = splitTask(taskId);
    if (task.type === 'file') return { state: 'completed', outputs: [`apimart-file:${task.id}`], costUsd: null, progress: 100 };
    const queryPath = task.type === 'music' ? '/v1/music/tasks/' : '/v1/tasks/';
    let data;
    try {
      data = await providerJson(`${API}${queryPath}${encodeURIComponent(task.id)}?language=en`, { proxy, headers: auth(apiKey), timeoutMs: 30_000 });
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status >= 500) return { state: 'processing', transient: error.message };
      throw error;
    }
    const t = data?.data || {};
    const status = String(t.status || '').toLowerCase();
    if (status === 'completed') {
      return { state: 'completed', outputs: resultUrls(t.result), costUsd: Number.isFinite(t.cost) ? t.cost : null, progress: 100 };
    }
    if (status === 'failed' || status === 'cancelled') {
      return { state: 'failed', error: t.error?.message || status };
    }
    return { state: 'processing', progress: t.progress ?? null };
  },

  // A speech file saved at submit: { path, ext, mime }; null for normal (URL) results.
  resultFile(ref) {
    const m = FILE_RE.exec(String(ref || ''));
    if (!m || !speechDir) return null;
    const [ext, mime] = SPEECH_EXT[Object.keys(SPEECH_EXT).find((k) => SPEECH_EXT[k][0] === m[2])];
    return { path: nodePath.join(speechDir, m[1]), ext, mime };
  },
  releaseResult(ref) {
    const file = this.resultFile(ref);
    if (file) fs.promises.unlink(file.path).catch(() => {});
  },
  // Speech files nobody collected (a failed save, a job that failed while
  // downloading, a crash): jobs take them within minutes, so a day is plenty.
  sweepFiles(maxAgeMs = 24 * 3600_000) {
    if (!speechDir) return;
    let names = [];
    try { names = fs.readdirSync(speechDir); } catch { return; }
    const cutoff = Date.now() - maxAgeMs;
    for (const name of names) {
      if (!FILE_RE.test(`apimart-file:${name}`)) continue;
      const file = nodePath.join(speechDir, name);
      try { if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file); } catch { /* gone already */ }
    }
  },

  // Uploads a local file; APIMart only accepts public URLs for references.
  async upload({ apiKey, proxy }, { path, mime, name, kind }) {
    const bucket = UPLOAD_KIND[kind];
    if (!bucket) throw new Error(`APIMart: cannot upload ${mime}`);
    // Streamed from disk, not read into memory.
    const form = await fileForm('file', path, mime, name || `file.${mime.split('/')[1]}`);
    const response = await providerFetch(`${API}/v1/uploads/${bucket}?retention_days=3`, {
      proxy, method: 'POST', headers: auth(apiKey), body: form, timeoutMs: 10 * 60_000,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(`APIMart upload failed: HTTP ${response.status} ${data?.error?.message || ''}`);
    // 3 days is the free tier (7+ days is billed and needs "pay-as-you-go uploads").
    // Re-upload a few hours before expiry so a running job never gets a dead link.
    return { url: String(data.url).replace(/\s/g, (c) => encodeURIComponent(c)), expiresAt: (data.expires_at ? data.expires_at * 1000 : Date.now() + 3 * 86_400_000) - 6 * 3_600_000 };
  },
};
