// Generations: submit to a provider, poll on the server, download results to
// our disk, keep history. Runs even when nobody has the page open.
import { providerById } from './providers/index.js';
import { newId, mimeForExt } from './storage.js';
import { now } from './db.js';

const ACTIVE = ['submitted', 'processing', 'downloading'];
const POLL_MS = { image: 2500, video: 5000, audio: 4000 };
// No time limit: we poll until the provider says done or failed (queues can
// take tens of minutes; Atlas ends and refunds jobs that run too long itself).
// After an hour we poll once a minute. A job fails only after many errors in
// a row (e.g. the provider no longer knows the task).
const SLOW_POLL_AFTER_MS = 3_600_000;
const SLOW_POLL_MS = 60_000;
const MAX_POLL_ERRORS = 40;
const SETTLE_DELAYS_MS = [5_000, 20_000, 60_000, 180_000, 900_000];
const TRASH_KEEP_MS = 7 * 86_400_000;
const LOCAL_MEDIA_RE = /^(?:https?:\/\/[^/]+)?\/media\/(u|g)\/([A-Za-z0-9_-]+)(?:\.[a-z0-9]+)?(?:\/(\d+)(?:\.[a-z0-9]+)?)?(?:[?#].*)?$/i;

export class GenerationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const DOWNLOAD_DEADLINE_MS = 60 * 60_000; // give up on a result file after an hour of retries

export function createGenerations({ db, storage, providers, catalog, log, maxActiveJobsPerUser = 8, settleDelaysMs = SETTLE_DELAYS_MS }) {
  const q = {
    insert: db.prepare(`INSERT INTO generations (id, user_id, endpoint, provider, provider_model, kind, status, prompt, params_json, est_cost_usd, est_source, studio, meta_json, next_poll_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'submitting', ?, ?, ?, ?, ?, ?, 0, ?, ?)`),
    setSubmitted: db.prepare("UPDATE generations SET provider_task_id = ?, status = 'submitted', next_poll_at = ?, updated_at = ? WHERE id = ?"),
    setFailed: db.prepare("UPDATE generations SET status = 'failed', error = ?, updated_at = ?, completed_at = ? WHERE id = ?"),
    setPolled: db.prepare('UPDATE generations SET status = ?, next_poll_at = ?, poll_errors = 0, updated_at = ? WHERE id = ?'),
    setDownloading: db.prepare("UPDATE generations SET status = 'downloading', provider_outputs_json = ?, cost_usd = COALESCE(?, cost_usd), cost_source = CASE WHEN ? IS NOT NULL THEN 'provider' ELSE cost_source END, updated_at = ? WHERE id = ?"),
    setCompleted: db.prepare("UPDATE generations SET status = 'completed', outputs_json = ?, settle_next_at = ?, updated_at = ?, completed_at = ? WHERE id = ?"),
    settleDue: db.prepare('SELECT * FROM generations WHERE settle_next_at IS NOT NULL AND settle_next_at <= ? ORDER BY settle_next_at LIMIT 10'),
    settleLater: db.prepare('UPDATE generations SET settle_attempts = settle_attempts + 1, settle_next_at = ? WHERE id = ?'),
    settleDone: db.prepare('UPDATE generations SET cost_usd = COALESCE(?, cost_usd), cost_source = COALESCE(?, cost_source), settle_next_at = NULL, updated_at = ? WHERE id = ?'),
    pollError: db.prepare('UPDATE generations SET poll_errors = poll_errors + 1, next_poll_at = ?, updated_at = ? WHERE id = ?'),
    byId: db.prepare('SELECT * FROM generations WHERE id = ?'),
    due: db.prepare(`SELECT * FROM generations WHERE status IN ('submitted','processing','downloading') AND next_poll_at <= ? ORDER BY next_poll_at LIMIT 10`),
    trash: db.prepare('UPDATE generations SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL'),
    restore: db.prepare('UPDATE generations SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL'),
    like: db.prepare('UPDATE generations SET liked_at = ? WHERE id = ? AND user_id = ?'),
    expired: db.prepare('SELECT * FROM generations WHERE deleted_at IS NOT NULL AND deleted_at < ?'),
    deleteRow: db.prepare('DELETE FROM generations WHERE id = ?'),
    spentThisMonth: db.prepare(`SELECT COALESCE(SUM(COALESCE(cost_usd, est_cost_usd, 0)), 0) AS usd FROM generations
      WHERE user_id = ? AND created_at >= ? AND status != 'failed'`),
    upload: db.prepare('SELECT * FROM uploads WHERE id = ?'),
    uploadBytes: db.prepare('SELECT COALESCE(SUM(bytes), 0) AS b FROM uploads WHERE user_id = ?'),
    activeJobs: db.prepare("SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND status IN ('submitting','submitted','processing','downloading')"),
    insertUpload: db.prepare('INSERT INTO uploads (id, user_id, path, mime, bytes, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    setUploadRefs: db.prepare('UPDATE uploads SET provider_refs = ? WHERE id = ?'),
    listUploads: db.prepare("SELECT id, path, mime, original_name, created_at FROM uploads WHERE user_id = ? AND mime LIKE ? AND created_at < ? ORDER BY created_at DESC LIMIT ?"),
  };
  const outputRefCache = new Map(); // `${provider}:${genId}/${n}` -> { url, expiresAt }

  // ── Uploads ─────────────────────────────────────────────────────────────
  async function saveUpload(user, { stream, mime, filename, truncated = () => false }) {
    const saved = await storage.saveUpload(user.id, stream, mime);
    if (truncated()) { storage.remove(saved.path); return null; }
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

  async function submit(user, { providerId, modelId, body, endpoint, estCostUsd = null, estSource = null, kind = null, studio = null, meta = null }) {
    const provider = providerById(providerId);
    if (!provider) throw new GenerationError(`Unknown provider: ${providerId}`, 404);
    const cfg = providers.resolve(providerId);
    if (!cfg.enabled || !cfg.apiKey) throw new GenerationError(`${provider.name} is not configured. Add its key in Settings.`, 409);
    const model = kind ? { id: modelId, kind } : catalog.model(providerId, modelId);
    if (!model) throw new GenerationError(`${provider.name} has no model "${modelId}" (catalog may need a refresh).`, 404);
    if (user.monthly_limit_usd != null) {
      const spent = q.spentThisMonth.get(user.id, monthStart()).usd;
      if (spent >= user.monthly_limit_usd || spent + (estCostUsd || 0) > user.monthly_limit_usd) {
        throw new GenerationError(`Monthly limit reached ($${spent.toFixed(2)} of $${user.monthly_limit_usd}). Ask the admin to raise it.`, 402);
      }
    }
    if (user.role !== 'admin' && q.activeJobs.get(user.id).n >= maxActiveJobsPerUser) {
      throw new GenerationError(`Too many generations running (${maxActiveJobsPerUser}). Wait for some to finish.`, 429);
    }
    const { onRequestId: _ignored, ...clean } = body || {};
    const id = newId('gen');
    const t = now();
    q.insert.run(id, user.id, endpoint, providerId, modelId, model.kind, String(clean.prompt || '').slice(0, 4000), JSON.stringify(clean), estCostUsd, estSource, studio, meta == null ? null : JSON.stringify(meta), t, t);
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
    q.setCompleted.run(JSON.stringify(saved), now() + settleDelaysMs[0], now(), now(), row.id);
  }

  // The real charge of a finished job, settled by the worker (survives
  // restarts): APIMart reports it per task in its request log (written a few
  // seconds later); for Atlas the quote taken before submitting is used.
  async function settle(row) {
    const provider = providerById(row.provider);
    if (provider?.actualCost && row.provider_task_id) {
      const usd = await provider.actualCost(providers.resolve(row.provider), row.provider_task_id).catch(() => null);
      if (Number.isFinite(usd)) { q.settleDone.run(usd, 'provider', now(), row.id); return; }
      if (row.settle_attempts + 1 < settleDelaysMs.length) { q.settleLater.run(now() + settleDelaysMs[row.settle_attempts + 1], row.id); return; }
    }
    const fromQuote = row.cost_usd == null && ['quote', 'quote~'].includes(row.est_source) && Number.isFinite(row.est_cost_usd);
    q.settleDone.run(fromQuote ? row.est_cost_usd : null, fromQuote ? row.est_source : null, now(), row.id);
  }

  async function step(row) {
    const kind = row.kind;
    const age = Date.now() - row.created_at;
    if (row.status === 'downloading' && age > DOWNLOAD_DEADLINE_MS && row.poll_errors >= MAX_POLL_ERRORS) {
      q.setFailed.run('Could not download the result file.', now(), now(), row.id);
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
      res.outputs = res.outputs.slice(0, 16);
      q.setDownloading.run(JSON.stringify(res.outputs), res.costUsd ?? null, res.costUsd ?? null, now(), row.id);
      await download({ ...row, status: 'downloading' }, res.outputs);
    } else if (res.state === 'failed') {
      q.setFailed.run(String(res.error || 'Generation failed').slice(0, 1000), now(), now(), row.id);
    } else {
      const wait = age > SLOW_POLL_AFTER_MS ? SLOW_POLL_MS : (POLL_MS[kind] || 3000);
      q.setPolled.run('processing', now() + wait, now(), row.id);
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
          // Retry later; many errors in a row mean the job is lost.
          if (row.poll_errors + 1 >= MAX_POLL_ERRORS) {
            q.setFailed.run(row.status === 'downloading' ? 'Could not download the result file.' : `Lost contact with the provider: ${error.message}`.slice(0, 1000), now(), now(), row.id);
          } else {
            q.pollError.run(now() + 15_000, now(), row.id);
          }
        }
      }
      for (const row of q.settleDue.all(now())) {
        try { await settle(row); } catch (error) { log?.warn(`cost ${row.id}: ${error.message}`); q.settleLater.run(now() + 60_000, row.id); }
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

  // ── Read side (in the shape the studio expects) ───────────────
  const outputUrls = (row) => JSON.parse(row.outputs_json || '[]').map((o, i) => `/media/g/${row.id}/${i}.${o.ext}`);

  function result(user, id) {
    const row = q.byId.get(id);
    if (!row || (row.user_id !== user.id && user.role !== 'admin')) throw new GenerationError('Not found', 404);
    if (row.status === 'completed') {
      const outputs = outputUrls(row);
      return { request_id: row.id, id: row.id, status: 'completed', outputs, url: outputs[0], cost: row.cost_usd ?? row.est_cost_usd, cost_final: row.cost_usd != null };
    }
    if (row.status === 'failed') return { request_id: row.id, id: row.id, status: 'failed', error: row.error || 'Generation failed' };
    return { request_id: row.id, id: row.id, status: 'processing' };
  }

  function historyItem(row) {
    const outputs = outputUrls(row);
    let meta = null;
    try { meta = row.meta_json ? JSON.parse(row.meta_json) : null; } catch { meta = null; }
    return {
      id: row.id,
      request_id: row.id,
      studio: row.studio || null,
      meta,
      liked: row.liked_at != null,
      deleted_at: row.deleted_at || null,
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
      cost_final: row.cost_usd != null,
      error: row.error,
      created_at: row.created_at,
      timestamp: new Date(row.created_at).toISOString(),
    };
  }

  // The user's own history, newest first. Filters (all optional):
  //   studio=cinema|image|video|upscale (comma list; "other" = no studio)
  //   kind=image|video|audio   liked=1   trash=1 (only deleted)   status=processing|completed|failed
  // Each user sees only their own items — there is no shared history.
  const STUDIOS = new Set(['cinema', 'image', 'video', 'upscale']);
  const KINDS = new Set(['image', 'video', 'audio']);
  function history(user, { cursor, limit = 50, studio, kind, liked, trash: inTrash, status } = {}) {
    const where = ['user_id = ?'];
    const args = [user.id];
    where.push(inTrash === '1' || inTrash === true ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL');
    if (studio) {
      const list = String(studio).split(',').map((x) => x.trim()).filter(Boolean);
      const named = list.filter((x) => STUDIOS.has(x));
      const parts = [];
      if (named.length) { parts.push(`studio IN (${named.map(() => '?').join(',')})`); args.push(...named); }
      if (list.includes('other')) parts.push('studio IS NULL');
      if (parts.length) where.push(`(${parts.join(' OR ')})`);
    }
    if (KINDS.has(kind)) { where.push('kind = ?'); args.push(kind); }
    if (liked === '1' || liked === true) where.push('liked_at IS NOT NULL');
    if (status === 'completed' || status === 'failed') { where.push('status = ?'); args.push(status); }
    if (status === 'processing') where.push("status IN ('submitting','submitted','processing','downloading')");
    where.push('created_at < ?');
    args.push(Number(cursor) || Number.MAX_SAFE_INTEGER);
    const rows = db.prepare(`SELECT * FROM generations WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
      .all(...args, Math.min(Number(limit) || 50, 200));
    return { items: rows.map(historyItem), next_cursor: rows.length ? String(rows[rows.length - 1].created_at) : null };
  }

  function owned(user, id) {
    const row = q.byId.get(id);
    if (!row || row.user_id !== user.id) throw new GenerationError('Not found', 404);
    return row;
  }

  function trash(user, id) {
    const info = q.trash.run(now(), id, user.id);
    if (!info.changes) throw new GenerationError('Not found', 404);
    return { ok: true };
  }

  function restore(user, id) {
    const info = q.restore.run(id, user.id);
    if (!info.changes) throw new GenerationError('Not found', 404);
    return { ok: true };
  }

  function like(user, id, liked) {
    owned(user, id);
    q.like.run(liked ? now() : null, id, user.id);
    return { ok: true, liked: Boolean(liked) };
  }

  // Delete for good — only from the trash, and files go with it.
  function purge(user, id) {
    const row = owned(user, id);
    if (row.deleted_at == null) throw new GenerationError('Move it to the trash first.', 409);
    for (const o of JSON.parse(row.outputs_json || '[]')) storage.remove(o.path);
    q.deleteRow.run(row.id);
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

  // The user's own uploaded files (newest first), e.g. to pick one to upscale.
  function uploads(user, { kind = 'image', cursor, limit = 60 } = {}) {
    const like = ['image', 'video', 'audio'].includes(kind) ? `${kind}/%` : '%';
    const rows = q.listUploads.all(user.id, like, Number(cursor) || Number.MAX_SAFE_INTEGER, Math.min(Number(limit) || 60, 200));
    return {
      items: rows.map((r) => ({ id: r.id, url: `/media/u/${r.id}.${r.path.split('.').pop()}`, mime: r.mime, name: r.original_name, created_at: r.created_at })),
      next_cursor: rows.length ? String(rows[rows.length - 1].created_at) : null,
    };
  }

  // Same for a /media/... link from a request body (e.g. an upscale input).
  function mediaFileForUrl(user, url) {
    const m = typeof url === 'string' && LOCAL_MEDIA_RE.exec(url);
    return m ? mediaFile(user, m[1].toLowerCase(), m[2], m[3]) : null;
  }

  return {
    uploadBytes: (userId) => q.uploadBytes.get(userId).b,
    saveUpload, uploads, submit, result, history, trash, restore, like, purge, mediaFile, mediaFileForUrl,
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
