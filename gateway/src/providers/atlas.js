// Atlas Cloud (https://atlascloud.ai) — docs: https://www.atlascloud.ai/docs
// Atlas blocks some countries (e.g. Ukraine); set a proxy in Settings there.
import fs from 'node:fs';
import { providerJson, providerFetch, ProviderHttpError } from './http.js';

const API = 'https://api.atlascloud.ai';
const auth = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });
const SUBMIT_PATH = { image: '/api/v1/model/generateImage', video: '/api/v1/model/generateVideo', audio: '/api/v1/model/generateAudio' };

export const atlas = {
  id: 'atlas',
  name: 'Atlas Cloud',
  website: 'https://www.atlascloud.ai',
  keysUrl: 'https://www.atlascloud.ai/console/api-keys',

  async balance({ apiKey, proxy }) {
    const data = await providerJson(`${API}/public/v1/balance`, { proxy, headers: auth(apiKey), timeoutMs: 20_000 });
    // Live API: { available: { value, currency }, cash, bonus, ... }.
    // Docs show a flat { value, currency }; accept both.
    const body = data?.data ?? data;
    const money = body?.available ?? body;
    const amount = Number(money?.value);
    if (!Number.isFinite(amount)) throw new Error('Unexpected balance response from Atlas');
    return { amount, currency: String(money.currency || 'usd').toUpperCase() };
  },

  // Public list with prices and a link to each model's input schema.
  async listModels({ proxy }) {
    const data = await providerJson(`${API}/api/v1/models`, { proxy, timeoutMs: 60_000 });
    return data?.data || [];
  },

  async schema({ proxy }, url) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)atlascloud\.ai$/i.test(u.hostname)) throw new Error(`Refusing schema URL outside atlascloud.ai: ${u.hostname}`);
    return providerJson(u.href, { proxy, timeoutMs: 30_000, redirect: 'error' });
  },

  async submit({ apiKey, proxy }, { kind, model, body }) {
    const pathFor = SUBMIT_PATH[kind];
    if (!pathFor) throw new Error(`Atlas: ${kind} generation is not supported`);
    const data = await providerJson(`${API}${pathFor}`, {
      proxy,
      method: 'POST',
      headers: { ...auth(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model }),
      timeoutMs: 120_000,
    });
    const taskId = data?.data?.id || data?.id;
    if (!taskId) throw new Error(`Atlas: no prediction id in response ${JSON.stringify(data).slice(0, 200)}`);
    return { taskId };
  },

  async poll({ apiKey, proxy }, taskId) {
    let data;
    try {
      data = await providerJson(`${API}/api/v1/model/prediction/${encodeURIComponent(taskId)}`, { proxy, headers: auth(apiKey), timeoutMs: 30_000 });
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status >= 500) return { state: 'processing', transient: error.message };
      throw error;
    }
    const p = data?.data || data || {};
    const status = String(p.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded') {
      return { state: 'completed', outputs: (p.outputs || []).filter((u) => typeof u === 'string'), costUsd: null, progress: 100 };
    }
    if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
      return { state: 'failed', error: typeof p.error === 'string' ? p.error : (p.error?.message || status) };
    }
    return { state: 'processing', progress: null };
  },

  async upload({ apiKey, proxy }, { path, mime, name }) {
    const form = new FormData();
    // Streamed from disk, not read into memory.
    form.append('file', await fs.openAsBlob(path, { type: mime }), name || `file.${mime.split('/')[1]}`);
    const response = await providerFetch(`${API}/api/v1/model/uploadMedia`, {
      proxy, method: 'POST', headers: auth(apiKey), body: form, timeoutMs: 10 * 60_000,
    });
    const data = await response.json().catch(() => ({}));
    const url = data?.url || data?.data?.download_url || data?.data?.url;
    if (!response.ok || !url) throw new Error(`Atlas upload failed: HTTP ${response.status} ${data?.message || ''}`);
    // Upload retention is not documented; re-upload after a day to be safe.
    return { url, expiresAt: Date.now() + 86_400_000 };
  },
};
