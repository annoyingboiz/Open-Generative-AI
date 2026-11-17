// Generations: submit to a provider, poll on the server, download results to
// our disk, keep history. Runs even when nobody has the page open.
import { providerById } from './providers/index.js';
import { newId, mimeForExt } from './storage.js';
import { now } from './db.js';

const ACTIVE = ['submitted', 'processing', 'downloading'];
const POLL_MS = { image: 2500, video: 5000, audio: 4000 };
const TIMEOUT_MS = { image: 20 * 60_000, video: 90 * 60_000, audio: 30 * 60_000 };
const TRASH_KEEP_MS = 7 * 86_400_000;
const LOCAL_MEDIA_RE = /^(?:https?:\/\/[^/]+)?\/media\/(u|g)\/([A-Za-z0-9_-]+)(?:\.[a-z0-9]+)?(?:\/(\d+)(?:\.[a-z0-9]+)?)?(?:[?#].*)?$/i;

export class GenerationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function createGenerations({ db, storage, providers, catalog, log }) {
  const q = {
    insert: db.prepare(`INSERT INTO generations (id, user_id, endpoint, provider, provider_model, kind, status, prompt, params_json, est_cost_usd, next_poll_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'submitting', ?, ?, ?, 0, ?, ?)`),
    setSubmitted: db.prepare("UPDATE generations SET provider_task_id = ?, status = 'submitted', next_poll_at = ?, updated_at = ? WHERE id = ?"),
    setFailed: db.prepare("UPDATE generations SET status = 'failed', error = ?, updated_at = ?, completed_at = ? WHERE id = ?"),
    setPolled: db.prepare('UPDATE generations SET status = ?, next_poll_at = ?, updated_at = ? WHERE id = ?'),
    setDownloading: db.prepare("UPDATE generations SET status = 'downloading', provider_outputs_json = ?, cost_usd = COALESCE(?, cost_usd), updated_at = ? WHERE id = ?"),
    setCompleted: db.prepare("UPDATE generations SET status = 'completed', outputs_json = ?, updated_at = ?, completed_at = ? WHERE id = ?"),
    byId: db.prepare('SELECT * FROM generations WHERE id = ?'),
    due: db.prepare(`SELECT * FROM generations WHERE status IN ('submitted','processing','downloading') AND next_poll_at <= ? ORDER BY next_poll_at LIMIT 10`),
    history: db.prepare(`SELECT * FROM generations WHERE user_id = ? AND deleted_at IS NULL AND created_at < ? ORDER BY created_at DESC LIMIT ?`),
    trash: db.prepare('UPDATE generations SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL'),
    expired: db.prepare('SELECT * FROM generations WHERE deleted_at IS NOT NULL AND deleted_at < ?'),
    deleteRow: db.prepare('DELETE FROM generations WHERE id = ?'),
    spentThisMonth: db.prepare(`SELECT COALESCE(SUM(COALESCE(cost_usd, est_cost_usd, 0)), 0) AS usd FROM generations
      WHERE user_id = ? AND created_at >= ? AND status != 'failed'`),
    upload: db.prepare('SELECT * FROM uploads WHERE id = ?'),
    insertUpload: db.prepare('INSERT INTO uploads (id, user_id, path, mime, bytes, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    setUploadRefs: db.prepare('UPDATE uploads SET provider_refs = ? WHERE id = ?'),
  };
  const outputRefCache = new Map(); // `${provider}:${genId}/${n}` -> { url, expiresAt }

  // ── Uploads ─────────────────────────────────────────────────────────────
  async function saveUpload(user, { stream, mime, filename }) {
    const saved = await storage.saveUpload(user.id, stream, mime);
    q.insertUpload.run(saved.id, user.id, saved.path, mime, saved.bytes, filename || null, now());
    const ext = saved.path.split('.').pop();
    return { id: saved.id, url: `/media/u/${saved.id}.${ext}` };
  }

  // Replaces our /media/... links in a request with links the provider can read.
  async function resolveMedia(user, providerId, cfg, value) {
    if (Array.isArray(value)) return Promise.all(value.map((v) => resolveMedia(user, providerId, cfg, v)));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = await resolveMedia(user, providerId, cfg, v);
      return out;
    }
    if (typeof value !== 'string') return value;
    const m = LOCAL_MEDIA_RE.exec(value);
    if (!m) return value;
    const provider = providerById(providerId);
    if (m[1].toLowerCase() === 'u') {
      const up = q.upload.get(m[2]);
      if (!up || (up.user_id !== user.id && user.role !== 'admin')) throw new GenerationError('Reference file not found.', 404);
      const refs = JSON.parse(up.provider_refs || '{}');
      const cached = refs[providerId];
      if (cached && cached.expiresAt > Date.now() + 3_600_000) return cached.url;
      const ref = await provider.upload(cfg, { path: up.path, mime: up.mime, name: up.original_name, kind: up.mime.split('/')[0] });
      refs[providerId] = ref;
      q.setUploadRefs.run(JSON.stringify(refs), up.id);
      return ref.url;
    }
    const gen = q.byId.get(m[2]);
    const index = Number(m[3] || 0);
    const output = gen && JSON.parse(gen.outputs_json || '[]')[index];
    if (!output || (gen.user_id !== user.id && user.role !== 'admin')) throw new GenerationError('Reference file not found.', 404);
    const key = `${providerId}:${gen.id}/${index}`;
    const cached = outputRefCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 3_600_000) return cached.url;
    const ref = await provider.upload(cfg, { path: output.path, mime: output.mime, name: output.path.split('/').pop(), kind: output.mime.split('/')[0] });
    outputRefCache.set(key, ref);
    return ref.url;
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  function monthStart() {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }

  async function submit(user, { providerId, modelId, body, endpoint, estCostUsd = null, kind = null }) {
    const provider = providerById(providerId);
    if (!provider) throw new GenerationError(`Unknown provider: ${providerId}`, 404);
    const cfg = providers.resolve(providerId);
    if (!cfg.enabled || !cfg.apiKey) throw new GenerationError(`${provider.name} is not configured. Add its key in Settings.`, 409);
    const model = kind ? { id: modelId, kind } : catalog.model(providerId, modelId);
    if (!model) throw new GenerationError(`${provider.name} has no model "${modelId}" (catalog may need a refresh).`, 404);
    if (user.monthly_limit_usd != null) {
      const spent = q.spentThisMonth.get(user.id, monthStart()).usd;
      if (spent + (estCostUsd || 0) > user.monthly_limit_usd) {
        throw new GenerationError(`Monthly limit reached ($${spent.toFixed(2)} of $${user.monthly_limit_usd}). Ask the admin to raise it.`, 402);
      }
    }
    const { onRequestId: _ignored, ...clean } = body || {};
    const id = newId('gen');
    const t = now();
    q.insert.run(id, user.id, endpoint, providerId, modelId, model.kind, String(clean.prompt || '').slice(0, 4000), JSON.stringify(clean), estCostUsd, t, t);
    try {
      const resolved = await resolveMedia(user, providerId, cfg, clean);
      const { taskId } = await provider.submit(cfg, { kind: model.kind, model: modelId, body: resolved });
      q.setSubmitted.run(taskId, now() + (POLL_MS[model.kind] || 3000), now(), id);
    } catch (error) {
      q.setFailed.run(error.message.slice(0, 1000), now(), now(), id);
      throw error instanceof GenerationError ? error : new GenerationError(`${provider.name}: ${error.message}`, 502);
    }
    return { id };
  }

  // ── Polling worker ──────────────────────────────────────────────────────
  async function download(row, providerOutputs) {
    const cfg = providers.resolve(row.provider);
    const saved = [];
    for (let i = 0; i < providerOutputs.length; i += 1) {
      const file = await storage.downloadResult({ userId: row.user_id, generationId: row.id, index: i, url: providerOutputs[i], proxy: cfg.proxy });
      saved.push({ path: file.path, mime: file.mime, bytes: file.bytes, ext: file.ext });
    }
    q.setCompleted.run(JSON.stringify(saved), now(), now(), row.id);
  }

  async function step(row) {
    const kind = row.kind;
    if (Date.now() - row.created_at > (TIMEOUT_MS[kind] || TIMEOUT_MS.video) && row.status !== 'downloading') {
      q.setFailed.run('Timed out waiting for the provider.', now(), now(), row.id);
      return;
    }
    if (row.status === 'downloading') {
      await download(row, JSON.parse(row.provider_outputs_json || '[]'));
      return;
    }
    const provider = providerById(row.provider);
    const cfg = providers.resolve(row.provider);
    const res = await provider.poll(cfg, row.provider_task_id);
    if (res.state === 'completed') {
      if (!res.outputs?.length) { q.setFailed.run('Provider finished without a result file.', now(), now(), row.id); return; }
      q.setDownloading.run(JSON.stringify(res.outputs), res.costUsd ?? null, now(), row.id);
      await download({ ...row, status: 'downloading' }, res.outputs);
    } else if (res.state === 'failed') {
      q.setFailed.run(String(res.error || 'Generation failed').slice(0, 1000), now(), now(), row.id);
    } else {
      q.setPolled.run('processing', now() + (POLL_MS[kind] || 3000), now(), row.id);
    }
  }

  let timer = null;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const row of q.due.all(now())) {
        try {
          await step(row);
        } catch (error) {
          log?.warn(`generation ${row.id}: ${error.message}`);
          // Retry later; give up via the timeout above.
          q.setPolled.run(row.status === 'downloading' ? 'downloading' : row.status, now() + 15_000, now(), row.id);
        }
      }
    } finally {
      running = false;
    }
  }

  function purgeTrash() {
    for (const row of q.expired.all(now() - TRASH_KEEP_MS)) {
      for (const o of JSON.parse(row.outputs_json || '[]')) storage.remove(o.path);
      q.deleteRow.run(row.id);
    }
  }

  // ── Read side (Muapi-shaped so the studio understands it) ───────────────
  const outputUrls = (row) => JSON.parse(row.outputs_json || '[]').map((o, i) => `/media/g/${row.id}/${i}.${o.ext}`);

  function result(user, id) {
    const row = q.byId.get(id);
    if (!row || (row.user_id !== user.id && user.role !== 'admin')) throw new GenerationError('Not found', 404);
    if (row.status === 'completed') {
      const outputs = outputUrls(row);
      return { request_id: row.id, id: row.id, status: 'completed', outputs, url: outputs[0], cost: row.cost_usd ?? row.est_cost_usd };
    }
    if (row.status === 'failed') return { request_id: row.id, id: row.id, status: 'failed', error: row.error || 'Generation failed' };
    return { request_id: row.id, id: row.id, status: 'processing' };
  }

  function historyItem(row) {
    const outputs = outputUrls(row);
    return {
      id: row.id,
      request_id: row.id,
      status: row.status === 'completed' ? 'completed' : row.status === 'failed' ? 'failed' : 'processing',
      url: outputs[0] || null,
      outputs,
      prompt: row.prompt,
      model: row.endpoint,
      provider: row.provider,
      provider_model: row.provider_model,
      kind: row.kind,
      params: JSON.parse(row.params_json || '{}'),
      cost_usd: row.cost_usd ?? row.est_cost_usd,
      error: row.error,
      created_at: row.created_at,
      timestamp: new Date(row.created_at).toISOString(),
    };
  }

  function history(user, { cursor, limit = 50 } = {}) {
    const before = Number(cursor) || Number.MAX_SAFE_INTEGER;
    const rows = q.history.all(user.id, before, Math.min(Number(limit) || 50, 200));
    return { items: rows.map(historyItem), next_cursor: rows.length ? String(rows[rows.length - 1].created_at) : null };
  }

  function trash(user, id) {
    const info = q.trash.run(now(), id, user.id);
    if (!info.changes) throw new GenerationError('Not found', 404);
    return { ok: true };
  }

  // Resolves /media/... to a file the user may read.
  function mediaFile(user, kind, id, index) {
    if (kind === 'u') {
      const up = q.upload.get(id);
      if (!up || (up.user_id !== user.id && user.role !== 'admin')) return null;
      return { path: up.path, mime: up.mime };
    }
    const row = q.byId.get(id);
    if (!row || (row.user_id !== user.id && user.role !== 'admin')) return null;
    const o = JSON.parse(row.outputs_json || '[]')[Number(index) || 0];
    return o ? { path: o.path, mime: o.mime || mimeForExt(o.ext) } : null;
  }

  return {
    saveUpload, submit, result, history, trash, mediaFile,
    start() {
      if (!timer) {
        timer = setInterval(tick, 2000);
        timer.unref?.();
        setInterval(purgeTrash, 3_600_000).unref?.();
      }
    },
    stop() { clearInterval(timer); timer = null; },
    tick,
  };
}
