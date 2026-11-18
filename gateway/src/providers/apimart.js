// APIMart (https://apimart.ai) — docs: https://docs.apimart.ai
import { providerJson, providerFetch, ProviderHttpError, fileForm } from './http.js';

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

  // Price our account pays for this request (membership/custom pricing
  // applied). https://docs.apimart.ai/en/api-reference/account/request-logs
  async quote({ apiKey, proxy }, { model, body }) {
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
    try {
      const data = await providerJson(`${API}/v1/logs/requests/${encodeURIComponent(taskId)}`, { proxy, headers: auth(apiKey), timeoutMs: 15_000 });
      const records = (data?.data || []).filter((r) => r.type === 'consume');
      if (!records.length) return null;
      return records.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) return null; // not written yet
      throw error;
    }
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
