import fs from 'node:fs';
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

export function createGenerations({ db, storage, providers, catalog, log, media = null, maxActiveJobsPerUser = 8, settleDelaysMs = SETTLE_DELAYS_MS, onProviderRejected = null, projects = null, uploadQuotaBytes = Infinity, maxUploadBytes = Infinity }) {
  // Personal items: only the author. Project items: every member of the project.
  const isMember = (userId, projectId) => Boolean(projectId && projects?.isMember(userId, projectId));
  // A project item belongs to the project: its author sees it only while still a member.
  // Unicode-aware lower case for prompt search (SQLite's LOWER() folds ASCII only).
  try { db.function('dz_fold', { deterministic: true }, (s) => (s == null ? '' : String(s).toLocaleLowerCase())); } catch { /* already registered */ }
  const canSee = (user, row) => Boolean(row && (row.project_id ? isMember(user.id, row.project_id) : row.user_id === user.id));
  const q = {
    insert: db.prepare(`INSERT INTO generations (id, user_id, endpoint, provider, provider_model, kind, status, prompt, params_json, est_cost_usd, est_source, studio, meta_json, project_id, folder_id, next_poll_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'submitting', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`),
    move: db.prepare('UPDATE generations SET project_id = ?, folder_id = ?, updated_at = ? WHERE id = ?'),
    insertCopy: db.prepare(`INSERT INTO generations (id, user_id, endpoint, provider, provider_model, kind, status, prompt, params_json, cost_usd, est_cost_usd, cost_source, est_source, studio, meta_json, project_id, folder_id, outputs_json, next_poll_at, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, 0, 0, 'copy', 'copy', ?, ?, ?, ?, ?, 0, ?, ?, ?)`),
    author: db.prepare('SELECT display_name FROM users WHERE id = ?'),
    setSubmitted: db.prepare("UPDATE generations SET provider_task_id = ?, status = 'submitted', next_poll_at = ?, updated_at = ? WHERE id = ?"),
    setFailed: db.prepare("UPDATE generations SET status = 'failed', error = ?, updated_at = ?, completed_at = ? WHERE id = ?"),
    setPolled: db.prepare('UPDATE generations SET status = ?, next_poll_at = ?, poll_errors = 0, updated_at = ? WHERE id = ?'),
    setNote: db.prepare('UPDATE generations SET note = ? WHERE id = ?'),
    // Poll results apply only to a job still waiting for the provider (not one cancelled meanwhile).
    setDownloading: db.prepare("UPDATE generations SET status = 'downloading', provider_outputs_json = ?, cost_usd = COALESCE(?, cost_usd), cost_source = CASE WHEN ? IS NOT NULL THEN 'provider' ELSE cost_source END, updated_at = ? WHERE id = ? AND status IN ('submitted', 'processing')"),
    setProcessing: db.prepare("UPDATE generations SET status = 'processing', next_poll_at = ?, poll_errors = 0, updated_at = ? WHERE id = ? AND status IN ('submitted', 'processing')"),
    setFailedIfActive: db.prepare("UPDATE generations SET status = 'failed', error = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status IN ('submitted', 'processing')"),
    pollRetry: db.prepare('UPDATE generations SET next_poll_at = ?, updated_at = ? WHERE id = ?'),
    setCompleted: db.prepare("UPDATE generations SET status = 'completed', outputs_json = ?, settle_next_at = ?, updated_at = ?, completed_at = ? WHERE id = ?"),
    settleDue: db.prepare('SELECT * FROM generations WHERE settle_next_at IS NOT NULL AND settle_next_at <= ? ORDER BY settle_next_at LIMIT 10'),
    settleLater: db.prepare('UPDATE generations SET settle_attempts = settle_attempts + 1, settle_next_at = ? WHERE id = ?'),
    settleDone: db.prepare('UPDATE generations SET cost_usd = COALESCE(?, cost_usd), cost_source = COALESCE(?, cost_source), settle_next_at = NULL, updated_at = ? WHERE id = ?'),
    pollError: db.prepare('UPDATE generations SET poll_errors = poll_errors + 1, next_poll_at = ?, updated_at = ? WHERE id = ?'),
    byId: db.prepare('SELECT * FROM generations WHERE id = ?'),
    // Work made here (provider 'dz') is not polled: it finishes by itself.
    due: db.prepare(`SELECT * FROM generations WHERE status IN ('submitted','processing','downloading') AND provider != 'dz' AND next_poll_at <= ? ORDER BY next_poll_at LIMIT 10`),
    setCompletedLocal: db.prepare("UPDATE generations SET status = 'completed', outputs_json = ?, settle_next_at = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'processing'"),
    setFailedLocal: db.prepare("UPDATE generations SET status = 'failed', error = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'processing'"),
    trash: db.prepare('UPDATE generations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'),
    restore: db.prepare('UPDATE generations SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL'),
    like: db.prepare('UPDATE generations SET liked_at = ? WHERE id = ?'),
    expired: db.prepare('SELECT * FROM generations WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND deleted_at < ?'),
    tombstone: db.prepare("UPDATE generations SET purged_at = ?, outputs_json = '[]', provider_outputs_json = '[]', updated_at = ? WHERE id = ?"),
    // Work made on this server (stitched shots…) that a restart cut short.
    staleLocalEdits: db.prepare("UPDATE generations SET status = 'failed', error = 'Interrupted (the server restarted). Try again.', updated_at = ?, completed_at = ? WHERE provider = 'dz' AND status = 'processing'"),
    staleSubmitting: db.prepare("UPDATE generations SET status = 'failed', error = 'Interrupted while sending to the provider. Try again.', updated_at = ?, completed_at = ? WHERE status = 'submitting' AND created_at < ?"),
    deleteRow: db.prepare('DELETE FROM generations WHERE id = ?'),
    // Pictures and videos plus text-model calls.
    spentThisMonth: db.prepare(`SELECT
      (SELECT COALESCE(SUM(COALESCE(cost_usd, est_cost_usd, 0)), 0) FROM generations WHERE user_id = ?1 AND created_at >= ?2 AND status != 'failed')
      + (SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls WHERE user_id = ?1 AND created_at >= ?2) AS usd`),
    upload: db.prepare('SELECT * FROM uploads WHERE id = ?'),
    uploadBytes: db.prepare('SELECT COALESCE(SUM(bytes), 0) AS b FROM uploads WHERE user_id = ?'),
    activeJobs: db.prepare("SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND status IN ('submitting','submitted','processing','downloading')"),
    deleteUpload: db.prepare('DELETE FROM uploads WHERE id = ?'),
    // Exact text search (instr, not LIKE: "_" in ids is not a wildcard). ?1 = "/media/u/<id>."
    assistantsUsing: db.prepare('SELECT name FROM assistants WHERE deleted_at IS NULL AND instr(files_json, ?) > 0 LIMIT 1'),
    elementsUsing: db.prepare(`SELECT name FROM elements WHERE deleted_at IS NULL AND (instr(views_json, ?1) > 0 OR instr(videos_json, ?1) > 0 OR instr(images_json, ?1) > 0 OR instr(COALESCE(video_url, ''), ?1) > 0) LIMIT 1`),
    runningUsing: db.prepare(`SELECT id FROM generations WHERE status IN ('submitting','submitted','processing','downloading') AND instr(params_json, ?1) > 0 LIMIT 1`),
    insertUpload: db.prepare('INSERT INTO uploads (id, user_id, path, mime, bytes, original_name, project_id, folder_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    setUploadRefs: db.prepare('UPDATE uploads SET provider_refs = ? WHERE id = ?'),
    listUploads: db.prepare("SELECT id, path, mime, original_name, created_at FROM uploads WHERE user_id = ? AND project_id IS NULL AND mime LIKE ? AND created_at < ? ORDER BY created_at DESC LIMIT ?"),
    listProjectUploads: db.prepare("SELECT id, path, mime, original_name, created_at FROM uploads WHERE project_id = ? AND mime LIKE ? AND created_at < ? ORDER BY created_at DESC LIMIT ?"),
  };
  let onCompleted = null; // (row) => … after a job's files are saved (e.g. element videos)
  let afterDownload = null; // { wants(row), run: async (row, saved) => … } may change the saved files in place
  const outputRefCache = new Map(); // `${provider}:${genId}/${n}` -> { url, expiresAt }

  // ── Uploads ─────────────────────────────────────────────────────────────
  async function saveUpload(user, { stream, mime, filename, truncated = () => false, projectId = null, folderId = null }) {
    const saved = await storage.saveUpload(user.id, stream, mime);
    if (truncated()) { storage.remove(saved.path); return null; }
    if (saved.bytes > maxUploadBytes || q.uploadBytes.get(user.id).b + saved.bytes > uploadQuotaBytes) {
      storage.remove(saved.path);
      throw new GenerationError(saved.bytes > maxUploadBytes ? 'The file is too large.' : 'Upload quota reached. Delete old uploads or ask the admin.', 413);
    }
    // A video starts at once in the player: index first (package 10, M1).
    if (media && await media.prepare(saved.path)) saved.bytes = fs.statSync(saved.path).size;
    q.insertUpload.run(saved.id, user.id, saved.path, mime, saved.bytes, filename || null, projectId, folderId, now());
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
      if (!canSee(user, up)) throw new GenerationError('Reference file not found.', 404);
      const refs = JSON.parse(up.provider_refs || '{}');
      const cached = refs[providerId];
      // A link with spaces (from an earlier upload named with spaces) is not reused.
      if (cached && cached.expiresAt > Date.now() + 3_600_000 && !/\s/.test(cached.url)) return cached.url;
      // The provider names its link after the file: send a safe name, never the user's
      // (spaces, Cyrillic, … break the link — "URL contains unescaped whitespace").
      const ref = await provider.upload(cfg, { path: up.path, mime: up.mime, name: up.path.split('/').pop(), kind: up.mime.split('/')[0] });
      refs[providerId] = ref;
      q.setUploadRefs.run(JSON.stringify(refs), up.id);
      return ref.url;
    }
    const gen = q.byId.get(m[2]);
    const index = Number(m[3] || 0);
    const output = gen && JSON.parse(gen.outputs_json || '[]')[index];
    if (!output || !canSee(user, gen)) throw new GenerationError('Reference file not found.', 404);
    const key = `${providerId}:${gen.id}/${index}`;
    const cached = outputRefCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 3_600_000) return cached.url;
    const ref = await provider.upload(cfg, { path: output.path, mime: output.mime, name: output.path.split('/').pop(), kind: output.mime.split('/')[0] });
    outputRefCache.set(key, ref);
    return ref.url;
  }

  // A link the provider can read for one of our /media files (uploaded once,
  // then reused — also by the generation that follows a price check).
  const urlInflight = new Map();
  function providerUrl(user, providerId, url) {
    const key = `${user.id}|${providerId}|${url}`;
    if (urlInflight.has(key)) return urlInflight.get(key);
    const p = resolveMedia(user, providerId, providers.resolve(providerId), url).finally(() => urlInflight.delete(key));
    urlInflight.set(key, p);
    return p;
  }

  // The provider's link for one of our files, only if we already have it (no upload).
  function cachedProviderUrl(user, providerId, url) {
    const m = typeof url === 'string' && LOCAL_MEDIA_RE.exec(url);
    if (!m) return null;
    if (m[1].toLowerCase() === 'u') {
      const up = q.upload.get(m[2]);
      if (!canSee(user, up)) return null;
      const cached = JSON.parse(up.provider_refs || '{}')[providerId];
      return cached && cached.expiresAt > Date.now() + 3_600_000 && !/\s/.test(cached.url) ? cached.url : null;
    }
    const gen = q.byId.get(m[2]);
    if (!gen || !canSee(user, gen)) return null;
    const cached = outputRefCache.get(`${providerId}:${gen.id}/${Number(m[3] || 0)}`);
    return cached && cached.expiresAt > Date.now() + 3_600_000 ? cached.url : null;
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  function monthStart() {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }

  async function submit(user, { providerId, modelId, body, endpoint, estCostUsd = null, estSource = null, kind = null, studio = null, meta = null, projectId = null, folderId = null, displayPrompt = null }) {
    const provider = providerById(providerId);
    if (!provider) throw new GenerationError(`Unknown provider: ${providerId}`, 404);
    const cfg = providers.resolve(providerId);
    if (!cfg.enabled || (!provider.noKey && !cfg.apiKey)) throw new GenerationError(`${provider.name} is not configured. Add its key in Settings.`, 409);
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
    q.insert.run(id, user.id, endpoint, providerId, modelId, model.kind, String(displayPrompt ?? clean.prompt ?? '').slice(0, 32000), JSON.stringify(clean), estCostUsd, estSource, studio, meta == null ? null : JSON.stringify(meta), projectId, folderId, t, t);
    try {
      const resolved = await resolveMedia(user, providerId, cfg, clean);
      const { taskId } = await provider.submit(cfg, { kind: model.kind, model: modelId, body: resolved });
      q.setSubmitted.run(taskId, now() + (POLL_MS[model.kind] || 3000), now(), id);
    } catch (error) {
      q.setFailed.run(error.message.slice(0, 1000), now(), now(), id);
      // The provider refused what we built from its spec: report it (Settings → Provider changes).
      if ([400, 422].includes(error.status)) {
        try { onProviderRejected?.({ provider: providerId, endpoint, model: modelId, status: error.status, message: error.message, params: Object.keys(clean), body: clean }); } catch { /* reporting is best effort */ }
      }
      throw error instanceof GenerationError ? error : new GenerationError(`${provider.name}: ${error.message}`, 424); // not 502: Cloudflare would replace the message
    }
    return { id };
  }

  // ── Polling worker ──────────────────────────────────────────────────────
  async function download(row, providerOutputs) {
    const cfg = providers.resolve(row.provider);
    const saved = [];
    const provider = providerById(row.provider);
    for (let i = 0; i < providerOutputs.length; i += 1) {
      // Results that are files here (this server's bridge folder, APIMart speech):
      // copied, not downloaded. This server's results are always files.
      const local = provider?.resultFile ? provider.resultFile(providerOutputs[i]) : null;
      if (local || row.provider === 'local') {
        if (!local) throw new Error('Bad result reference');
        const from = typeof local === 'string' ? local : local.path;
        const ext = typeof local === 'string' ? 'mp4' : local.ext;
        const file = await storage.copyResult({ userId: row.user_id, generationId: row.id, index: i, from, ext });
        saved.push({ path: file.path, mime: typeof local === 'string' ? 'video/mp4' : local.mime, bytes: file.bytes, ext });
        continue;
      }
      const file = await storage.downloadResult({ userId: row.user_id, generationId: row.id, index: i, url: providerOutputs[i], proxy: cfg.proxy });
      saved.push({ path: file.path, mime: file.mime, bytes: file.bytes, ext: file.ext });
    }
    // Videos with the index first, so the player starts at once (package 10, M1); a heavy one
    // gets its lighter playback copy in the background. Runs on the final file, after any
    // fix-up below, and before the result shows up (its URL is then never rewritten).
    const prepare = async () => {
      if (!media) return;
      for (const f of saved) {
        try { if (await media.prepare(f.path)) f.bytes = fs.statSync(f.path).size; } catch (error) { log?.warn(`prepare ${row.id}: ${error.message}`); }
      }
    };
    // Fix-ups on the files before they show up (e.g. the sound back into an
    // upscaled video). They run beside the worker, not in it: the job stays
    // "downloading" with its next check pushed back (a restart just redoes it).
    // The provider's temporary files (APIMart speech) go once the job is
    // completed: a retry before that still finds them; leftovers are swept.
    const release = () => { if (provider?.releaseResult) for (const ref of providerOutputs) provider.releaseResult(ref); };
    if (afterDownload?.wants(row)) {
      q.setPolled.run('downloading', now() + 10 * 60_000, now(), row.id);
      Promise.resolve()
        .then(() => afterDownload.run(row, saved))
        .catch((error) => log?.warn(`after download ${row.id}: ${error.message}`))
        .then(prepare)
        .finally(() => { if (finishDownload(row, saved)) release(); });
      return;
    }
    await prepare();
    if (finishDownload(row, saved)) release();
  }
  function finishDownload(row, saved) {
    const cur = q.byId.get(row.id);
    if (!cur || cur.status !== 'downloading') return false; // failed or removed meanwhile
    q.setCompleted.run(JSON.stringify(saved), now() + settleDelaysMs[0], now(), now(), row.id);
    // After-work (e.g. an element video) runs on its own: it never holds up other jobs.
    if (onCompleted) Promise.resolve().then(() => onCompleted(q.byId.get(row.id))).catch((error) => log?.warn(`after ${row.id}: ${error.message}`));
    return true;
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
      if (!q.setDownloading.run(JSON.stringify(res.outputs), res.costUsd ?? null, res.costUsd ?? null, now(), row.id).changes) return;
      await download({ ...row, status: 'downloading' }, res.outputs);
    } else if (res.state === 'failed') {
      q.setFailedIfActive.run(String(res.error || 'Generation failed').slice(0, 1000), now(), now(), row.id);
    } else {
      const wait = row.provider === 'local' ? 10_000 : age > SLOW_POLL_AFTER_MS ? SLOW_POLL_MS : (POLL_MS[kind] || 3000);
      if (!q.setProcessing.run(now() + wait, now(), row.id).changes) return;
      if ((res.note || null) !== (row.note || null)) q.setNote.run(res.note ? String(res.note).slice(0, 300) : null, row.id);
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
          // This server offline (the bridge restarting, the host rebooting): its queue
          // survives, so keep asking — for up to two days — instead of giving up.
          if (row.provider === 'local' && error.status === 503 && Date.now() - row.created_at < 2 * 86_400_000) {
            q.pollRetry.run(now() + 60_000, now(), row.id);
            continue;
          }
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

  // Files go, the row stays (as a tombstone): it still counts for spending.
  function removeFiles(row) {
    for (const o of JSON.parse(row.outputs_json || '[]')) storage.remove(o.path);
    q.tombstone.run(now(), now(), row.id);
  }
  function purgeTrash() {
    for (const row of q.expired.all(now() - TRASH_KEEP_MS)) removeFiles(row);
    q.staleSubmitting.run(now(), now(), now() - 10 * 60_000);
  }

  // ── Read side (in the shape the studio expects) ───────────────
  const outputUrls = (row) => JSON.parse(row.outputs_json || '[]').map((o, i) => `/media/g/${row.id}/${i}.${o.ext}`);

  function result(user, id) {
    const row = q.byId.get(id);
    if (!canSee(user, row)) throw new GenerationError('Not found', 404);
    if (row.status === 'completed') {
      const outputs = outputUrls(row);
      return { request_id: row.id, id: row.id, status: 'completed', outputs, url: outputs[0], cost: row.cost_usd ?? row.est_cost_usd, cost_final: row.cost_usd != null };
    }
    if (row.status === 'failed') return { request_id: row.id, id: row.id, status: 'failed', error: row.error || 'Generation failed' };
    return { request_id: row.id, id: row.id, status: 'processing' };
  }

  const authorNames = new Map();
  const authorName = (id) => {
    if (!authorNames.has(id)) authorNames.set(id, q.author.get(id)?.display_name || '');
    return authorNames.get(id);
  };
  function historyItem(row, user) {
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
      note: row.status === 'completed' || row.status === 'failed' ? null : row.note || null,
      cancellable: Boolean(providerById(row.provider)?.cancel) && ['submitted', 'processing'].includes(row.status) && row.user_id === user?.id,
      created_at: row.created_at,
      completed_at: row.completed_at || null,
      timestamp: new Date(row.created_at).toISOString(),
      project_id: row.project_id || null,
      folder_id: row.folder_id || null,
      mine: user ? row.user_id === user.id : true,
      author: user && row.user_id !== user.id ? authorName(row.user_id) : undefined,
    };
  }

  // The user's own history, newest first. Filters (all optional):
  //   studio=cinema|image|video|upscale (comma list; "other" = no studio)
  //   kind=image|video|audio   liked=1   trash=1 (only deleted)   status=processing|completed|failed
  // Each user sees only their own items — there is no shared history.
  const STUDIOS = new Set(['create', 'cinema', 'image', 'video', 'upscale', 'director', 'tools']);
  const KINDS = new Set(['image', 'video', 'audio']);
  //   project=<id> (that project; folder=<id>|root narrows it) · project=none (personal only)
  //   no project → the user's Library: their own items plus their projects' items.
  //   target=<board>:<shot or group> — what was made for one shot or group of a storyboard (package 05).
  function history(user, opts = {}) {
    const { cursor, limit = 50 } = opts;
    const { where, args } = historyWhere(user, opts);
    where.push('created_at < ?');
    args.push(Number(cursor) || Number.MAX_SAFE_INTEGER);
    const rows = db.prepare(`SELECT * FROM generations WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
      .all(...args, Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 200));
    return { items: rows.map((r) => historyItem(r, user)), next_cursor: rows.length ? String(rows[rows.length - 1].created_at) : null };
  }

  // How many there are behind each gallery filter (package 14, 3.11): the same place as the
  // gallery (project, folder, target, kind…), then All, pictures, videos, liked, upscaled.
  function historyCounts(user, opts = {}) {
    const base = { ...opts, liked: undefined, status: undefined, cursor: undefined };
    // One pass for All / pictures / videos / liked; upscaled is its own place (studio=upscale).
    const { where, args } = historyWhere(user, base);
    const r = db.prepare(`SELECT COUNT(*) AS n, SUM(kind = 'image') AS image, SUM(kind = 'video') AS video, SUM(liked_at IS NOT NULL) AS liked
      FROM generations WHERE ${where.join(' AND ')}`).get(...args);
    const up = historyWhere(user, { ...base, studio: 'upscale' });
    const upscaled = db.prepare(`SELECT COUNT(*) AS n FROM generations WHERE ${up.where.join(' AND ')}`).get(...up.args).n;
    const all = r.n || 0;
    return { all, image: base.kind ? all : r.image || 0, video: base.kind ? all : r.video || 0, liked: r.liked || 0, upscaled };
  }

  // The Tasks drawer (package 14, A4): this user's jobs that run or wait, and those that ended in
  // the last hour, with where each was started.
  function tasks(user) {
    const since = now() - 60 * 60_000;
    const rows = db.prepare(`SELECT * FROM generations WHERE user_id = ? AND purged_at IS NULL AND deleted_at IS NULL
      AND (status IN ('submitting','submitted','processing','downloading') OR (status IN ('completed','failed') AND completed_at >= ?))
      ORDER BY created_at DESC LIMIT 60`).all(user.id, since);
    // A project the user has left: its jobs are not theirs to list any more.
    return rows.filter((row) => canSee(user, row)).map((row) => {
      const item = historyItem(row, user);
      const active = item.status === 'processing';
      const waiting = active && /^(Waiting|In line)/.test(String(item.note || ''));
      return {
        id: item.id, kind: item.kind, studio: item.studio, url: item.url, outputs: item.outputs.length, note: item.note, error: item.error,
        state: !active ? item.status : waiting ? 'waiting' : 'running',
        created_at: item.created_at, completed_at: item.completed_at, project_id: item.project_id,
        model: item.meta?.modelName || item.provider_model || '', provider: providerById(row.provider)?.name || row.provider || '',
        target: item.meta?.target && typeof item.meta.target === 'object' ? { board: item.meta.target.board, id: item.meta.target.id, kind: item.meta.target.kind, step: item.meta.target.step } : null,
        editor: Boolean(item.meta?.editor), upscale: item.studio === 'upscale',
      };
    });
  }

  function historyWhere(user, { studio, kind, tool, board, target, source, liked, trash: inTrash, status, project, folder, q: search } = {}) {
    const where = ['purged_at IS NULL'];
    const args = [];
    if (project === 'none') {
      where.push('user_id = ? AND project_id IS NULL');
      args.push(user.id);
    } else if (project) {
      const p = projects?.get(user, project).project; // 404 if not a member
      where.push('project_id = ?');
      args.push(p.id);
      if (folder === 'root') where.push('folder_id IS NULL');
      else if (folder) { where.push('folder_id = ?'); args.push(projects.checkFolder(p.id, folder)); }
    } else {
      const ids = projects ? projects.memberProjectIds(user.id) : [];
      where.push(ids.length ? `((user_id = ? AND project_id IS NULL) OR project_id IN (${ids.map(() => '?').join(',')}))` : '(user_id = ? AND project_id IS NULL)');
      args.push(user.id, ...ids);
    }
    where.push(inTrash === '1' || inTrash === true ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL');
    if (studio) {
      const list = [...new Set(String(studio).split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 8);
      const named = list.filter((x) => STUDIOS.has(x));
      const parts = [];
      if (named.length) { parts.push(`studio IN (${named.map(() => '?').join(',')})`); args.push(...named); }
      if (list.includes('other')) parts.push('studio IS NULL');
      if (parts.length) where.push(`(${parts.join(' OR ')})`);
    }
    if (KINDS.has(kind)) { where.push('kind = ?'); args.push(kind); }
    // Tools tab: one tool's results (Lip Sync, Motion Control…).
    if (typeof tool === 'string' && /^[a-z]{2,20}$/.test(tool)) { where.push("json_extract(meta_json, '$.tool') = ?"); args.push(tool); }
    // Director: the stitched videos of one storyboard.
    if (typeof board === 'string' && /^[a-z0-9_]{4,40}$/i.test(board)) { where.push("json_extract(meta_json, '$.stitch.board') = ?"); args.push(board); }
    const tg = typeof target === 'string' && /^([a-z0-9_-]{4,40}):([a-z0-9_-]{1,40})$/i.exec(target);
    if (tg) {
      where.push("((json_extract(meta_json, '$.target.board') = ? AND json_extract(meta_json, '$.target.id') = ?) OR (json_extract(meta_json, '$.forShot.board') = ? AND json_extract(meta_json, '$.forShot.shot') = ?))");
      args.push(tg[1], tg[2], tg[1], tg[2]);
    }
    // The picture editor: the versions made from one source picture (package 13, C7).
    if (typeof source === 'string' && source.length > 0 && source.length <= 600) { where.push("json_extract(meta_json, '$.editor.source') = ?"); args.push(source); }
    // A version the editor failed to make is not kept in any gallery (only the editor lists it).
    else where.push("NOT (status = 'failed' AND json_extract(meta_json, '$.editor.source') IS NOT NULL)");
    if (liked === '1' || liked === true) where.push('liked_at IS NOT NULL');
    if (status === 'completed' || status === 'failed') { where.push('status = ?'); args.push(status); }
    if (status === 'processing') where.push("status IN ('submitting','submitted','processing','downloading')");
    // Words in the prompt (each one must be there), case-insensitive.
    const words = String(search || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const w of words) { where.push("dz_fold(prompt) LIKE ? ESCAPE '\\'"); args.push(`%${w.slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
    return { where, args };
  }

  // Visible: the author or a member of its project.
  function visible(user, id) {
    const row = q.byId.get(id);
    if (!canSee(user, row) || row.purged_at != null) throw new GenerationError('Not found', 404);
    return row;
  }
  // The author, or the owner of the project it is in.
  function editable(user, id) {
    const row = visible(user, id);
    if (row.user_id !== user.id && projects?.roleIn(user.id, row.project_id) !== 'owner') {
      throw new GenerationError('Only the author or the project owner can do this.', 403);
    }
    return row;
  }
  function owned(user, id) {
    const row = visible(user, id);
    if (row.user_id !== user.id) throw new GenerationError('Only the author can do this.', 403);
    return row;
  }

  // A failed job of this user, for "Retry" (package 03, §3.3): what was sent, as sent.
  function retrySource(user, id) {
    const row = owned(user, id);
    if (row.status !== 'failed') throw new GenerationError('Only a failed generation can be tried again.', 409);
    let meta = null;
    try { meta = row.meta_json ? JSON.parse(row.meta_json) : null; } catch { meta = null; }
    if (meta?.upscale || row.provider === 'dz') throw new GenerationError('Start this one again from its own tool.', 409);
    return { row, meta, body: JSON.parse(row.params_json || '{}') };
  }

  // Stop a job that is still waiting or running (providers that can: this server).
  async function cancel(user, id) {
    const row = owned(user, id);
    const provider = providerById(row.provider);
    if (!provider?.cancel) throw new GenerationError('This provider can\'t stop a job once it is sent.', 409);
    if (!['submitted', 'processing'].includes(row.status) || !row.provider_task_id) throw new GenerationError('It is not running any more.', 409);
    const job = await provider.cancel(providers.resolve(row.provider), row.provider_task_id);
    // Finished just before the click: its result is on the way, nothing to cancel.
    if (job?.state === 'done') throw new GenerationError('It has just finished — the result appears in a moment.', 409);
    if (!q.setFailedIfActive.run('Cancelled.', now(), now(), row.id).changes) throw new GenerationError('It is not running any more.', 409);
    q.setNote.run(null, row.id);
    return { ok: true };
  }

  function trash(user, id) {
    editable(user, id);
    if (!q.trash.run(now(), id).changes) throw new GenerationError('Not found', 404);
    return { ok: true };
  }

  function restore(user, id) {
    editable(user, id);
    if (!q.restore.run(id).changes) throw new GenerationError('Not found', 404);
    return { ok: true };
  }

  function like(user, id, liked) {
    visible(user, id);
    q.like.run(liked ? now() : null, id);
    return { ok: true, liked: Boolean(liked) };
  }

  // Move to a project (and folder), or back to personal. The author decides,
  // and must be a member of the target project.
  function move(user, id, { project = null, folder = null } = {}) {
    const row = owned(user, id);
    const { projectId, folderId } = projects ? projects.target(user, project || null, folder || null) : { projectId: null, folderId: null };
    q.move.run(projectId, folderId, now(), row.id);
    return { ok: true, project_id: projectId, folder_id: folderId };
  }

  // A copy of a finished item in another place (Library, or a project and
  // folder the user is in), owned by whoever copies it. Its files are copied
  // too, so the copy and the original live and die on their own. A copy costs
  // nothing and does not count as spending.
  async function copy(user, id, { project = null, folder = null } = {}) {
    const row = visible(user, id);
    if (row.status !== 'completed' || row.deleted_at != null) throw new GenerationError('Only finished items can be copied.', 409);
    const { projectId, folderId } = projects ? projects.target(user, project || null, folder || null) : { projectId: null, folderId: null };
    const outputs = JSON.parse(row.outputs_json || '[]');
    if (!outputs.length) throw new GenerationError('Nothing to copy.', 409);
    const newGen = newId('gen');
    const saved = [];
    let meta = null;
    try { meta = row.meta_json ? JSON.parse(row.meta_json) : null; } catch { meta = null; }
    // Files and the row together: if anything fails, nothing is left behind.
    try {
      for (let i = 0; i < outputs.length; i += 1) {
        const f = await storage.copyResult({ userId: user.id, generationId: newGen, index: i, from: outputs[i].path, ext: outputs[i].ext });
        saved.push({ ...outputs[i], path: f.path, bytes: f.bytes });
      }
      const t = now();
      q.insertCopy.run(newGen, user.id, row.endpoint, row.provider, row.provider_model, row.kind, row.prompt, row.params_json || '{}', row.studio,
        JSON.stringify({ ...(meta || {}), copiedFrom: row.id }), projectId, folderId, JSON.stringify(saved), t, t, t);
    } catch (error) {
      for (const f of saved) storage.remove(f.path);
      throw error.status ? error : new GenerationError('The file could not be copied.', 500);
    }
    return { ok: true, id: newGen, project_id: projectId, folder_id: folderId };
  }

  // The same action on many items; each one succeeds or fails on its own.
  const BATCH = { move: (u, id, o) => move(u, id, o), copy: (u, id, o) => copy(u, id, o), trash: (u, id) => trash(u, id), restore: (u, id) => restore(u, id), purge: (u, id) => purge(u, id) };
  async function batch(user, { action, ids, project = null, folder = null } = {}) {
    const fn = BATCH[action];
    if (!fn) throw new GenerationError('Unknown action.', 400);
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && x))];
    if (!list.length) throw new GenerationError('Nothing selected.', 400);
    if (list.length > 200) throw new GenerationError('Select at most 200 items at once.', 400);
    const done = [];
    const failed = [];
    for (const id of list) {
      try { await fn(user, id, { project, folder }); done.push(id); } catch (error) { failed.push({ id, error: error.message }); }
    }
    return { ok: failed.length === 0, done, failed };
  }

  // Delete for good — only from the trash, and files go with it.
  function purge(user, id) {
    const row = owned(user, id);
    if (row.purged_at != null) throw new GenerationError('Not found', 404);
    if (row.deleted_at == null) throw new GenerationError('Move it to the trash first.', 409);
    if (ACTIVE.includes(row.status) || row.status === 'submitting') throw new GenerationError('It is still running. Delete it when it has finished.', 409);
    removeFiles(row);
    return { ok: true };
  }

  // Resolves /media/... to a file the user may read.
  function mediaFile(user, kind, id, index) {
    if (kind === 'u') {
      const up = q.upload.get(id);
      if (!canSee(user, up)) return null;
      return { path: up.path, mime: up.mime };
    }
    const row = q.byId.get(id);
    if (!canSee(user, row)) return null;
    const o = JSON.parse(row.outputs_json || '[]')[Number(index) || 0];
    return o ? { path: o.path, mime: o.mime || mimeForExt(o.ext) } : null;
  }

  // The user's own uploaded files (newest first), e.g. to pick one to upscale.
  // In a project: the project's uploads (every member's). Otherwise: the user's own.
  function uploads(user, { kind = 'image', cursor, limit = 60, project } = {}) {
    const like = ['image', 'video', 'audio'].includes(kind) ? `${kind}/%` : '%';
    const n = Math.min(Math.max(Math.trunc(Number(limit)) || 60, 1), 200);
    const before = Number(cursor) || Number.MAX_SAFE_INTEGER;
    const rows = project && project !== 'none'
      ? q.listProjectUploads.all(projects.get(user, project).project.id, like, before, n)
      : q.listUploads.all(user.id, like, before, n);
    return {
      items: rows.map((r) => ({ id: r.id, url: `/media/u/${r.id}.${r.path.split('.').pop()}`, mime: r.mime, name: r.original_name, created_at: r.created_at })),
      next_cursor: rows.length ? String(rows[rows.length - 1].created_at) : null,
    };
  }

  // Delete uploaded files for good (file and record). Personal: the uploader.
  // In a project: the uploader or the project owner. A file an element still
  // shows is kept (remove it from the element first).
  function deleteUploads(user, ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter((x) => typeof x === 'string' && x))];
    if (!list.length) throw new GenerationError('Nothing selected.', 400);
    if (list.length > 200) throw new GenerationError('Select at most 200 files at once.', 400);
    const done = [];
    const failed = [];
    for (const id of list) {
      const up = q.upload.get(id);
      if (!up || !canSee(user, up)) { failed.push({ id, error: 'Not found.' }); continue; }
      const mayDelete = up.user_id === user.id || (up.project_id && projects?.roleIn(user.id, up.project_id) === 'owner');
      if (!mayDelete) { failed.push({ id, error: 'Only the person who uploaded it (or the project owner) can delete it.' }); continue; }
      const ref = `/media/u/${up.id}.`;
      const el = q.elementsUsing.get(ref);
      const as = !el && q.assistantsUsing.get(ref);
      if (as) { failed.push({ id, error: `The assistant “${as.name}” uses it.` }); continue; }
      if (el) { failed.push({ id, error: `The element “${el.name}” uses it.` }); continue; }
      if (q.runningUsing.get(ref)) { failed.push({ id, error: 'A generation that is still running uses it. Try again when it finishes.' }); continue; }
      storage.remove(up.path);
      q.deleteUpload.run(up.id);
      done.push(id);
    }
    return { ok: failed.length === 0, done, failed };
  }

  // A copy of a file the user can see, as an upload in the given scope (personal
  // or a project) — e.g. an element's pictures, so everyone who sees the element
  // sees its files. An upload already in that scope is reused as is.
  // Step 1 (no side effects): what each URL needs — reuse as is, or copy (with its size).
  function planAdopt(user, url, { projectId = null } = {}) {
    const m = typeof url === 'string' && LOCAL_MEDIA_RE.exec(url);
    if (!m) throw new GenerationError('Use a file from this app.', 400);
    if (m[1].toLowerCase() === 'u') {
      const up = q.upload.get(m[2]);
      if (!canSee(user, up)) throw new GenerationError('File not found.', 404);
      if ((up.project_id || null) === projectId && (projectId || up.user_id === user.id)) return { url, reuse: true };
    }
    const f = mediaFile(user, m[1].toLowerCase(), m[2], m[3]);
    if (!f) throw new GenerationError('File not found.', 404);
    let bytes = 0;
    try { bytes = fs.statSync(f.path).size; } catch { throw new GenerationError('File not found.', 404); }
    if (bytes > maxUploadBytes) throw new GenerationError('The file is too large to copy.', 413);
    return { url, reuse: false, file: f, bytes };
  }
  // Copies of several files, all or nothing, within the user's upload quota.
  async function adoptMany(user, urls, { projectId = null } = {}) {
    const plans = urls.map((u) => planAdopt(user, u, { projectId }));
    const need = plans.reduce((n, p) => n + (p.reuse ? 0 : p.bytes), 0);
    if (need && q.uploadBytes.get(user.id).b + need > uploadQuotaBytes) throw new GenerationError('Upload quota reached. Delete old references or ask the admin.', 413);
    const made = [];
    try {
      for (const p of plans) {
        if (p.reuse) { made.push({ url: p.url }); continue; }
        const saved = await storage.saveUpload(user.id, fs.createReadStream(p.file.path), p.file.mime);
        q.insertUpload.run(saved.id, user.id, saved.path, p.file.mime, saved.bytes, null, projectId, null, now());
        made.push({ url: `/media/u/${saved.id}.${saved.path.split('.').pop()}`, id: saved.id, path: saved.path });
      }
    } catch (error) {
      for (const x of made) if (x.id) { storage.remove(x.path); q.deleteUpload.run(x.id); }
      throw error;
    }
    return made.map((x) => x.url);
  }
  const adoptMedia = async (user, url, opts) => (await adoptMany(user, [url], opts))[0];

  // Made on this server, not by a provider (shots stitched into one video…):
  // a Library item that shows as running until `make()` gives the file
  // ({ path, ext, mime }), free. `make` gets nothing and must clean up after itself.
  function addLocalEdit(user, { kind = 'video', prompt = '', studio = null, meta = null, projectId = null, folderId = null, make }) {
    if (user.role !== 'admin' && q.activeJobs.get(user.id).n >= maxActiveJobsPerUser) {
      throw new GenerationError(`Too many generations running (${maxActiveJobsPerUser}). Wait for some to finish.`, 429);
    }
    const id = newId('gen');
    const t = now();
    q.insert.run(id, user.id, 'dz/edit', 'dz', 'edit', kind, String(prompt).slice(0, 32000), '{}', 0, 'estimate', studio, meta == null ? null : JSON.stringify(meta), projectId, folderId, t, t);
    q.setPolled.run('processing', t + 6 * 3600_000, t, id); // the provider worker leaves it alone
    Promise.resolve()
      .then(() => make())
      .then(async (out) => {
        let file;
        try { file = await storage.copyResult({ userId: user.id, generationId: id, index: 0, from: out.path, ext: out.ext }); } finally { out.cleanup?.(); }
        if (media && await media.prepare(file.path)) file.bytes = fs.statSync(file.path).size;
        if (!q.setCompletedLocal.run(JSON.stringify([{ path: file.path, mime: out.mime, bytes: file.bytes, ext: out.ext }]), now() + settleDelaysMs[0], now(), now(), id).changes) { storage.remove(file.path); return; }
        if (onCompleted) Promise.resolve().then(() => onCompleted(q.byId.get(id))).catch((error) => log?.warn(`after ${id}: ${error.message}`));
      })
      .catch((error) => {
        log?.warn(`local edit ${id}: ${error.message}`);
        q.setFailedLocal.run(String(error.message || 'Failed').slice(0, 500), now(), now(), id);
      });
    return { id };
  }

  // Same for a /media/... link from a request body (e.g. an upscale input).
  function mediaFileForUrl(user, url) {
    const m = typeof url === 'string' && LOCAL_MEDIA_RE.exec(url);
    return m ? mediaFile(user, m[1].toLowerCase(), m[2], m[3]) : null;
  }

  return {
    uploadBytes: (userId) => q.uploadBytes.get(userId).b,
    setOnCompleted(fn) { onCompleted = fn; },
    setAfterDownload(fn) { afterDownload = fn; },
    providerUrl,
    cachedProviderUrl,
    saveUpload, addLocalEdit, uploads, deleteUploads, submit, result, history, historyCounts, tasks, cancel, retrySource, visibleRow: visible, trash, restore, like, purge, move, copy, batch, mediaFile, mediaFileForUrl, adoptMedia, adoptMany,
    start() {
      // A restart between "saved" and "sent to the provider" leaves a job in
      // 'submitting' that nobody polls: end it so it doesn't hang forever.
      q.staleSubmitting.run(now(), now(), now() - 10 * 60_000);
      q.staleLocalEdits.run(now(), now());
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
