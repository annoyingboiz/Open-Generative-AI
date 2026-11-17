// APIMart (https://apimart.ai) — docs: https://docs.apimart.ai
import fs from 'node:fs';
import { providerJson, providerFetch, ProviderHttpError } from './http.js';

const API = 'https://api.apimart.ai';
const auth = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });

const SUBMIT_PATH = { image: '/v1/images/generations', video: '/v1/videos/generations' };
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

  async submit({ apiKey, proxy }, { kind, model, body }) {
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
    let data;
    try {
      data = await providerJson(`${API}/v1/tasks/${encodeURIComponent(taskId)}?language=en`, { proxy, headers: auth(apiKey), timeoutMs: 30_000 });
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

  // Uploads a local file; APIMart only accepts public URLs for references.
  async upload({ apiKey, proxy }, { path, mime, name, kind }) {
    const bucket = UPLOAD_KIND[kind];
    if (!bucket) throw new Error(`APIMart: cannot upload ${mime}`);
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path)], { type: mime }), name || `file.${mime.split('/')[1]}`);
    const response = await providerFetch(`${API}/v1/uploads/${bucket}?retention_days=7`, {
      proxy, method: 'POST', headers: auth(apiKey), body: form, timeoutMs: 10 * 60_000,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(`APIMart upload failed: HTTP ${response.status} ${data?.error?.message || ''}`);
    return { url: data.url, expiresAt: data.expires_at ? data.expires_at * 1000 : Date.now() + 6 * 86_400_000 };
  },
};
