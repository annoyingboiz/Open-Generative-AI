// Text models (LLM) — one door for every "brain" the studio uses (prompt
// adapter, AI Director, assistants). Sources:
//   local   — Ollama on this server: free; may be busy when the graphics
//             cards run other work (we say so instead of failing)
//   apimart — Claude, GPT, Gemini, DeepSeek, … through APIMart
//   atlas   — DeepSeek, Qwen, Kimi, GLM, Grok, Claude, … through Atlas Cloud
//   chatgpt — Denis's ChatGPT account (not connected yet)
// A model id is "<source>:<model>", e.g. "atlas:deepseek-ai/deepseek-v4-flash".
// Every call is logged with its tokens and cost and counts toward the user's
// monthly limit.
import fs from 'node:fs';
import { providerFetch } from './providers/http.js';
import { newId } from './storage.js';
import { now } from './db.js';

export class LlmError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const APIMART = 'https://api.apimart.ai';
const ATLAS = 'https://api.atlascloud.ai';
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_CHARS = 60_000;
const DEFAULT_MAX_TOKENS = 4000;

// Not text models (pictures, video, sound, embeddings, …).
const NOT_TEXT = /image|video|veo|kling|seedance|seedream|sora|(^|\/)wan|hailuo|flux|midjourney|tts|audio|music|suno|whisper|transcribe|embedding|dall-?e|upscale|vidu|pixverse|luma|runway|kolors|ideogram|recraft|nano-banana|happyhorse|ocr|babbage|davinci|instruct|search-api|deep-research|realtime/i;
// Shown first; only those the source really has. Changeable here.
const RECOMMENDED = [
  'apimart:claude-sonnet-5-5', 'apimart:gpt-5.5', 'apimart:gemini-3.5-flash', 'apimart:deepseek-v4-flash',
  'atlas:deepseek-ai/deepseek-v4-flash', 'atlas:moonshotai/kimi-k3', 'atlas:qwen/qwen3.7-plus', 'atlas:zai-org/glm-5.3',
  'local:qwen3.6:27b', 'local:gemma4:31b', 'local:gpt-oss:20b', 'local:qwen3.5:9b',
];
const VISION_GUESS = /gpt-4o|gpt-4\.1|gpt-5|gpt-6|claude|gemini|grok-4|qwen.*vl|glm-5v|kimi-k[23]|doubao-seed/i;

export function createLlm({ db, providers, generations, config, log }) {
  const q = {
    insert: db.prepare(`INSERT INTO llm_calls (id, user_id, source, model, purpose, prompt_tokens, completion_tokens, cost_usd, ms, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
    spent: db.prepare(`SELECT
      (SELECT COALESCE(SUM(COALESCE(cost_usd, est_cost_usd, 0)), 0) FROM generations WHERE user_id = ?1 AND created_at >= ?2 AND status != 'failed')
      + (SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls WHERE user_id = ?1 AND created_at >= ?2) AS usd`),
    recent: db.prepare('SELECT * FROM llm_calls ORDER BY created_at DESC LIMIT ?'),
  };
  const ollamaUrl = (config.ollamaUrl || 'http://172.17.0.1:11434').replace(/\/+$/, '');

  // ── Model lists (cached) ────────────────────────────────────────────────
  const cache = new Map(); // source → { at, models, status, note }
  const apimartPrices = new Map(); // model → { in, out, at } USD per 1M tokens
  const TTL = { local: 60_000, apimart: 6 * 3600_000, atlas: 6 * 3600_000 };

  async function listLocal() {
    try {
      const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const models = (data.models || []).filter((m) => !/embed/i.test(m.name)).map((m) => ({
        id: `local:${m.name}`, source: 'local', model: m.name, name: m.name,
        note: [m.details?.parameter_size, m.details?.quantization_level].filter(Boolean).join(' · '),
        price: { in: 0, out: 0 }, free: true, vision: (m.capabilities || []).includes('vision'),
      }));
      return { status: 'ok', models };
    } catch (error) {
      return { status: 'offline', note: 'The local machine (Ollama) does not answer.', models: [] };
    }
  }

  async function providerList(id) {
    const c = providers.resolve(id);
    if (!c.enabled) return { status: 'off', note: 'Turned off in Providers.', models: [] };
    if (!c.apiKey) return { status: 'no key', note: 'No API key.', models: [] };
    const base = id === 'apimart' ? APIMART : ATLAS;
    const r = await providerFetch(`${base}/v1/models`, { proxy: c.proxy, headers: { authorization: `Bearer ${c.apiKey}` }, timeoutMs: 20_000 });
    if (!r.ok) return { status: 'error', note: `Model list failed (HTTP ${r.status}).`, models: [] };
    const data = (await r.json()).data || [];
    const models = data.filter((m) => {
      if (id === 'atlas' && Array.isArray(m.output_modalities)) return m.output_modalities.includes('text') && !NOT_TEXT.test(m.id);
      return !NOT_TEXT.test(m.id);
    }).map((m) => {
      const p = m.pricing ? { in: Number(m.pricing.prompt) * 1e6, out: Number(m.pricing.completion) * 1e6 } : null;
      return {
        id: `${id}:${m.id}`, source: id, model: m.id, name: m.name || m.id,
        note: m.context_length ? `${Math.round(m.context_length / 1000)}k context` : '',
        price: p && Number.isFinite(p.in) && Number.isFinite(p.out) ? p : null,
        free: false,
        vision: Array.isArray(m.input_modalities) ? m.input_modalities.includes('image') : VISION_GUESS.test(m.id),
      };
    });
    return { status: 'ok', models };
  }

  async function sourceList(id, { force = false } = {}) {
    const hit = cache.get(id);
    if (!force && hit && Date.now() - hit.at < TTL[id]) return hit;
    let out;
    try { out = id === 'local' ? await listLocal() : await providerList(id); } catch (error) { out = { status: 'error', note: error.message, models: [] }; }
    const entry = { ...out, at: Date.now() };
    // A failed refresh keeps the last good list (marked).
    if (out.status !== 'ok' && hit?.models?.length && id !== 'local') { cache.set(id, { ...hit, at: Date.now() - TTL[id] + 300_000 }); return { ...hit, note: out.note }; }
    cache.set(id, entry);
    return entry;
  }

  // APIMart's price for our account, per 1M tokens (asked per model, kept a day).
  async function apimartPrice(model) {
    const hit = apimartPrices.get(model);
    if (hit && Date.now() - hit.at < 86_400_000) return hit;
    const c = providers.resolve('apimart');
    try {
      const r = await providerFetch(`${APIMART}/v1/pricing/model?${new URLSearchParams({ model })}`, { proxy: c.proxy, headers: { authorization: `Bearer ${c.apiKey}` }, timeoutMs: 15_000 });
      const d = await r.json();
      const u = d?.unit_prices;
      if (d?.unit === 'per_million_tokens' && u && Number.isFinite(Number(u.input)) && Number.isFinite(Number(u.output))) {
        const p = { in: Number(u.input), out: Number(u.output), at: Date.now() };
        apimartPrices.set(model, p);
        return p;
      }
    } catch { /* unknown */ }
    return null;
  }

  const chatgptStatus = () => ({ id: 'chatgpt', name: 'ChatGPT account', status: 'not connected', note: 'Denis’s own ChatGPT account — needs his sign-in setup first.' });

  async function list(user, { force = false } = {}) {
    const [local, apimart, atlas] = await Promise.all(['local', 'apimart', 'atlas'].map((s) => sourceList(s, { force })));
    // Prices for the recommended APIMart models (the rest: asked at first use).
    const am = apimart.models || [];
    await Promise.all(am.filter((m) => RECOMMENDED.includes(m.id)).map(async (m) => { const p = await apimartPrice(m.model); if (p) m.price = { in: p.in, out: p.out }; }));
    for (const m of am) { const p = apimartPrices.get(m.model); if (p && !m.price) m.price = { in: p.in, out: p.out }; }
    const all = [...local.models, ...am, ...(atlas.models || [])].map((m) => ({ ...m, recommended: RECOMMENDED.includes(m.id) }));
    const def = defaultModel(all);
    return {
      sources: [
        { id: 'local', name: 'This server (Ollama)', status: local.status, note: local.note || 'Free. Busy while the graphics cards run other work.', count: local.models.length },
        { id: 'apimart', name: 'APIMart', status: apimart.status, note: apimart.note || '', count: am.length },
        { id: 'atlas', name: 'Atlas Cloud', status: atlas.status, note: atlas.note || '', count: (atlas.models || []).length },
        { ...chatgptStatus(), count: 0, ...(user?.role === 'admin' ? {} : { hidden: true }) },
      ].filter((s) => !s.hidden),
      models: all.sort((a, b) => Number(b.recommended) - Number(a.recommended) || RECOMMENDED.indexOf(a.id) - RECOMMENDED.indexOf(b.id) || a.source.localeCompare(b.source) || a.name.localeCompare(b.name)),
      default: def,
    };
  }

  function defaultModel(all) {
    const saved = q.getMeta.get('llm_default')?.value || '';
    if (saved && all.some((m) => m.id === saved)) return saved;
    return RECOMMENDED.find((id) => all.some((m) => m.id === id)) || all[0]?.id || null;
  }
  function setDefault(id) {
    const v = String(id || '');
    if (v && !/^(local|apimart|atlas):.+/.test(v)) throw new LlmError('Unknown model.');
    q.setMeta.run('llm_default', v);
    return { ok: true };
  }

  // ── Calls ───────────────────────────────────────────────────────────────
  // Our /media/... pictures → base64 (providers can't open our private links).
  function imagesOf(user, urls) {
    const list = (Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && u).slice(0, MAX_IMAGES + 1);
    if (list.length > MAX_IMAGES) throw new LlmError(`At most ${MAX_IMAGES} pictures per message.`);
    return list.map((url) => {
      const f = generations.mediaFileForUrl(user, url);
      if (!f || !String(f.mime || '').startsWith('image/')) throw new LlmError('A picture is not available (or is not a picture).', 404);
      const st = fs.statSync(f.path);
      if (st.size > MAX_IMAGE_BYTES) throw new LlmError('A picture is too big for a text model (max 8 MB).');
      return { mime: f.mime, b64: fs.readFileSync(f.path).toString('base64') };
    });
  }

  function cleanMessages(body) {
    const msgs = [];
    if (body.system) msgs.push({ role: 'system', content: String(body.system) });
    for (const m of Array.isArray(body.messages) ? body.messages : []) {
      if (!m || !['user', 'assistant', 'system'].includes(m.role)) continue;
      msgs.push({ role: m.role, content: String(m.content ?? '') });
    }
    if (body.prompt) msgs.push({ role: 'user', content: String(body.prompt) });
    if (!msgs.some((m) => m.role === 'user' && m.content.trim())) throw new LlmError('Nothing to send.');
    const size = msgs.reduce((n, m) => n + m.content.length, 0);
    if (size > MAX_INPUT_CHARS) throw new LlmError(`The text is too long (max ${MAX_INPUT_CHARS} characters).`);
    return msgs;
  }

  const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p?.text || '').join('') : '');

  async function callOpenAiStyle(source, model, msgs, images, { maxTokens, temperature }) {
    const c = providers.resolve(source);
    if (!c.enabled || !c.apiKey) throw new LlmError(`${source === 'apimart' ? 'APIMart' : 'Atlas'} is not set up.`, 409);
    const messages = msgs.map((m) => ({ ...m }));
    if (images.length) {
      const last = [...messages].reverse().find((m) => m.role === 'user');
      last.content = [{ type: 'text', text: last.content }, ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))];
    }
    const body = { model, messages, stream: false, max_tokens: maxTokens, ...(temperature != null ? { temperature } : {}) };
    const r = await providerFetch(`${source === 'apimart' ? APIMART : ATLAS}/v1/chat/completions`, {
      proxy: c.proxy, method: 'POST', timeoutMs: 180_000,
      headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new LlmError(r.ok ? 'The model answered in an unexpected format.' : `The provider refused (HTTP ${r.status}).`, 502); }
    if (!r.ok || data.error) throw new LlmError(String(data.error?.message || data.message || `HTTP ${r.status}`).slice(0, 300), 502);
    const choice = data.choices?.[0];
    const text = textOf(choice?.message?.content).trim();
    const usage = { in: Number(data.usage?.prompt_tokens || 0), out: Number(data.usage?.completion_tokens || 0) };
    if (!text) {
      throw new LlmError(choice?.finish_reason === 'length'
        ? 'The model spent all its tokens thinking and wrote nothing. Try again with a bigger limit or another model.'
        : 'The model returned an empty answer.', 502);
    }
    return { text, usage, finish: choice?.finish_reason || null };
  }

  async function callLocal(model, msgs, images, { maxTokens, temperature }) {
    const messages = msgs.map((m) => ({ ...m }));
    if (images.length) {
      const last = [...messages].reverse().find((m) => m.role === 'user');
      last.images = images.map((i) => i.b64);
    }
    let r;
    try {
      r = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(150_000),
        body: JSON.stringify({ model, messages, stream: false, options: { num_predict: maxTokens, ...(temperature != null ? { temperature } : {}) } }),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') throw new LlmError('The local machine is busy right now (its graphics cards are doing other work). Try again later or pick a cloud model.', 503);
      throw new LlmError('The local machine is offline right now. Pick a cloud model.', 503);
    }
    const raw = await r.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { /* below */ }
    if (!r.ok || data.error) {
      const msg = String(data.error || raw || `HTTP ${r.status}`);
      if (/memory|cuda|out of|resource|busy|unable to allocate|insufficient/i.test(msg)) {
        throw new LlmError('The local machine is busy right now (its graphics cards are doing other work). Try again later or pick a cloud model.', 503);
      }
      if (/not found|pull/i.test(msg)) throw new LlmError(`The model ${model} is not on the local machine.`, 404);
      throw new LlmError(`Local model error: ${msg.slice(0, 200)}`, 502);
    }
    const text = textOf(data.message?.content).trim();
    if (!text) throw new LlmError(data.done_reason === 'length' ? 'The model used all its tokens and wrote nothing. Try a bigger limit.' : 'The model returned an empty answer.', 502);
    return { text, usage: { in: Number(data.prompt_eval_count || 0), out: Number(data.eval_count || 0) }, finish: data.done_reason || null };
  }

  const monthStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

  // { model, system?, messages?, prompt?, images?, maxTokens?, temperature?, purpose? } → { text, model, usage, costUsd, ms }
  async function chat(user, body = {}) {
    const id = String(body.model || defaultModel((await list(user)).models) || '');
    const m = /^(local|apimart|atlas|chatgpt):(.+)$/.exec(id);
    if (!m) throw new LlmError('Pick a text model.');
    const [, source, model] = m;
    if (source === 'chatgpt') throw new LlmError('The ChatGPT account is not connected yet.', 409);
    if (user.monthly_limit_usd != null && source !== 'local') {
      const spent = q.spent.get(user.id, monthStart()).usd;
      if (spent >= user.monthly_limit_usd) throw new LlmError(`Monthly limit reached ($${spent.toFixed(2)} of $${user.monthly_limit_usd}). Ask the admin to raise it.`, 402);
    }
    const msgs = cleanMessages(body);
    const images = imagesOf(user, body.images);
    const maxTokens = Math.min(16_000, Math.max(64, Number(body.maxTokens) || DEFAULT_MAX_TOKENS));
    const temperature = body.temperature == null ? null : Math.min(2, Math.max(0, Number(body.temperature)));
    const purpose = String(body.purpose || 'chat').slice(0, 40);
    const started = Date.now();
    try {
      const out = source === 'local'
        ? await callLocal(model, msgs, images, { maxTokens, temperature })
        : await callOpenAiStyle(source, model, msgs, images, { maxTokens, temperature });
      let price = null;
      if (source === 'atlas') price = (await sourceList('atlas')).models.find((x) => x.model === model)?.price || null;
      if (source === 'apimart') price = await apimartPrice(model);
      const costUsd = source === 'local' ? 0 : price ? (out.usage.in * price.in + out.usage.out * price.out) / 1e6 : null;
      const ms = Date.now() - started;
      q.insert.run(newId('llm'), user.id, source, model, purpose, out.usage.in, out.usage.out, costUsd ?? 0, ms, 'ok', null, now());
      return { text: out.text, model: id, usage: out.usage, costUsd, priceKnown: costUsd != null, ms, finish: out.finish };
    } catch (error) {
      q.insert.run(newId('llm'), user.id, source, model, purpose, 0, 0, 0, Date.now() - started, 'failed', String(error.message).slice(0, 300), now());
      if (error instanceof LlmError) throw error;
      log?.warn?.(`llm ${id}: ${error.message}`);
      throw new LlmError(error?.name === 'TimeoutError' ? 'The model took too long to answer.' : `The model could not be reached: ${error.message}`, 502);
    }
  }

  const recent = (limit = 20) => q.recent.all(limit);

  return { list, chat, setDefault, recent, spentThisMonth: (userId) => q.spent.get(userId, monthStart()).usd };
}
