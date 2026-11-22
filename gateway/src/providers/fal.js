// fal.ai (https://fal.ai) — docs: https://fal.ai/docs
// Queue API: POST https://queue.fal.run/<endpoint> → request id; status and
// result live under the app (first two segments of the endpoint).
// We only call the tools listed in fal-tools.js, not fal's whole catalog.
import fs from 'node:fs';
import { providerJson, providerFetch, ProviderHttpError } from './http.js';
import { FAL_TOOL_ENDPOINTS, falTool } from './fal-tools.js';
import { isVideoUpscaleEndpoint } from '../video-upscale.js';
import { assertPublicHttpsUrl } from '../net-guard.js';

const QUEUE = 'https://queue.fal.run';
const REST = 'https://rest.fal.ai';
const PLATFORM = 'https://api.fal.ai/v1';
const auth = (apiKey) => ({ Authorization: `Key ${apiKey}` });
const UPLOAD_DAYS = 3;

// "topaz/upscale/image/precision" → app "topaz/upscale".
const appOf = (endpoint) => endpoint.split('/').slice(0, 2).join('/');
const SAFE_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

function parseTaskId(taskId) {
  const parts = String(taskId).split('/');
  if (parts.length !== 3 || !parts.every((p) => SAFE_SEGMENT.test(p))) throw new Error(`fal: bad task id ${taskId}`);
  return { app: `${parts[0]}/${parts[1]}`, requestId: parts[2] };
}

function resultUrls(data) {
  const urls = [];
  const take = (v) => {
    if (!v) return;
    if (typeof v === 'string') { if (/^https:\/\//.test(v)) urls.push(v); return; }
    if (Array.isArray(v)) { v.forEach(take); return; }
    if (typeof v === 'object') take(v.url);
  };
  take(data?.image);
  take(data?.images);
  take(data?.video);
  return [...new Set(urls)];
}

const errorText = (body, fallback) => {
  if (!body || typeof body !== 'object') return fallback;
  const d = body.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join('; ').slice(0, 500);
  return body.error || body.message || fallback;
};

export const fal = {
  id: 'fal',
  name: 'fal.ai',
  website: 'https://fal.ai',
  keysUrl: 'https://fal.ai/dashboard/keys',

  // Needs a key with the "billing:usage:read" permission (presets BILLING, READONLY or FULL).
  // The key that makes pictures usually has none, so Settings takes a second key for the
  // balance only (BILLING preset: it can read the balance and nothing else).
  billingKey: true,
  async balance({ apiKey, proxy, billingKey }) {
    let data;
    try {
      data = await providerJson(`${PLATFORM}/account/billing?expand=credits`, { proxy, headers: auth(billingKey || apiKey), timeoutMs: 20_000 });
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || error.status !== 403) throw error;
      if (billingKey) throw new Error('The balance key has no billing access: make it on the BILLING preset.');
      // The key has no billing permission: check that it works at all.
      await providerJson(`${PLATFORM}/models/pricing?endpoint_id=${FAL_TOOL_ENDPOINTS[0]}`, { proxy, headers: auth(apiKey), timeoutMs: 20_000 });
      return { amount: null, currency: 'USD', note: 'Key works. To see the balance, add a balance key (BILLING preset) below.' };
    }
    const amount = Number(data?.credits?.current_balance);
    if (!Number.isFinite(amount)) throw new Error('Unexpected balance response from fal');
    return { amount, currency: String(data.credits.currency || 'USD').toUpperCase() };
  },

  // Fixed list: only our tools. Shape matches what the catalog stores.
  async listModels() {
    return FAL_TOOL_ENDPOINTS.map((id) => ({ id, kind: falTool(id).kind }));
  },

  async submit({ apiKey, proxy }, { model, body }) {
    if (!falTool(model) && !isVideoUpscaleEndpoint('fal', model)) throw new Error(`fal: ${model} is not one of our tools`);
    const data = await providerJson(`${QUEUE}/${model}`, {
      proxy,
      method: 'POST',
      headers: { ...auth(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    });
    const requestId = data?.request_id;
    if (!requestId || !SAFE_SEGMENT.test(requestId)) throw new Error(`fal: no request id in response ${JSON.stringify(data).slice(0, 200)}`);
    return { taskId: `${appOf(model)}/${requestId}` };
  },

  async poll({ apiKey, proxy }, taskId) {
    const { app, requestId } = parseTaskId(taskId);
    const base = `${QUEUE}/${app}/requests/${requestId}`;
    let status;
    try {
      status = await providerJson(`${base}/status?logs=0`, { proxy, headers: auth(apiKey), timeoutMs: 30_000 });
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status >= 500) return { state: 'processing', transient: error.message };
      throw error;
    }
    const state = String(status?.status || '').toUpperCase();
    if (state !== 'COMPLETED') return { state: 'processing', progress: null };
    if (status.error) return { state: 'failed', error: errorText({ detail: status.error }, 'fal: request failed') };
    // The model's own answer: its output, or its error with the same status code.
    const response = await providerFetch(base, { proxy, headers: auth(apiKey), timeoutMs: 30_000 });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (response.status >= 500) return { state: 'processing', transient: `HTTP ${response.status}` };
    // Status and result can race: fal answers 400 "still in progress" for a moment.
    if (response.status === 400 && /in progress/i.test(errorText(data, ''))) return { state: 'processing', transient: 'result not ready' };
    if (!response.ok) return { state: 'failed', error: errorText(data, `fal: HTTP ${response.status}`) };
    return { state: 'completed', outputs: resultUrls(data), costUsd: null, progress: 100 };
  },

  // What the request was billed (fal writes billing events with some delay).
  // Needs "billing:usage:read" too; without it we keep the price we computed.
  async actualCost({ apiKey, proxy }, taskId) {
    const { requestId } = parseTaskId(taskId);
    try {
      const start = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const data = await providerJson(`${PLATFORM}/models/billing-events?${new URLSearchParams({ request_id: requestId, start })}`, { proxy, headers: auth(apiKey), timeoutMs: 15_000 });
      const events = (data?.billing_events || []).filter((e) => e.request_id === requestId);
      if (!events.length) return null;
      return events.reduce((sum, e) => sum + (Number(e.cost_total) || 0), 0);
    } catch (error) {
      if (error instanceof ProviderHttpError && [401, 403, 404].includes(error.status)) return null;
      throw error;
    }
  },

  // fal CDN: ask for an upload URL, then PUT the file (streamed from disk).
  async upload({ apiKey, proxy }, { path, mime, name }) {
    const init = await providerJson(`${REST}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
      proxy,
      method: 'POST',
      headers: {
        ...auth(apiKey),
        'Content-Type': 'application/json',
        'X-Fal-Object-Lifecycle': JSON.stringify({ expiration_duration_seconds: UPLOAD_DAYS * 86_400 }),
      },
      body: JSON.stringify({ content_type: mime, file_name: name || `file.${mime.split('/')[1] || 'bin'}` }),
      timeoutMs: 30_000,
    });
    if (!init?.upload_url || !init?.file_url) throw new Error('fal upload: no upload URL');
    // Both URLs come from fal's answer: make sure they are public HTTPS
    // addresses before we send a file there or hand the link to a model.
    await assertPublicHttpsUrl(init.upload_url, { viaProxy: Boolean(proxy) });
    if (new URL(init.file_url).protocol !== 'https:') throw new Error('fal upload: file URL is not HTTPS');
    const size = fs.statSync(path).size;
    const response = await providerFetch(init.upload_url, {
      proxy,
      method: 'PUT',
      headers: { 'Content-Type': mime, 'Content-Length': String(size) },
      body: fs.createReadStream(path),
      duplex: 'half',
      redirect: 'error',
      timeoutMs: 10 * 60_000,
    });
    if (!response.ok) throw new Error(`fal upload failed: HTTP ${response.status}`);
    // Re-upload half a day before the file expires.
    return { url: init.file_url, expiresAt: Date.now() + UPLOAD_DAYS * 86_400_000 - 12 * 3_600_000 };
  },
};
