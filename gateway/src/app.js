// The gateway application: sits in front of the Next.js studio.
//   /login /setup /logout /dz/*   — handled here (accounts, settings, JSON for the shell)
//   /api/*                         — handled here (provider gateway; legacy upstream routes are blocked)
//   everything else               — proxied to the studio, only for signed-in users
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import httpProxy from '@fastify/http-proxy';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { openDatabase } from './db.js';
import { loadMasterKey, newToken } from './crypto.js';
import { createAuth, createLoginThrottle, publicUser, SESSION_COOKIE, UserError } from './auth.js';
import { PROVIDERS, providerById, createProviderSettings, fetchBalances } from './providers/index.js';
import { validateProxyUrl } from './providers/http.js';
import { loginPage, setupPage, settingsPage, testResultPage } from './pages.js';
import { createStorage, sendFile, isAllowedUploadMime } from './storage.js';
import { createCatalog, DEFAULT_RECOMMENDED } from './catalog/index.js';
import { createGenerations, GenerationError } from './generations.js';
import { createQuoter } from './quotes.js';
import { toProviderBody } from './catalog/build.js';

const PUBLIC_PATHS = new Set(['/login', '/setup', '/healthz', '/favicon.ico']);

export async function buildApp(config, { logger = true } = {}) {
  process.umask(0o077); // database, keys and files readable by this user only
  const db = openDatabase(config.dataDir);
  const masterKey = loadMasterKey(config.dataDir, config.appSecret);
  const auth = createAuth({ db, sessionDays: config.sessionDays });
  const providers = createProviderSettings({ db, masterKey, envDefaults: config.providerEnv });
  const throttle = createLoginThrottle();

  const app = Fastify({
    logger: logger ? { level: config.logLevel } : false,
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024, // uploads have their own limits (multipart)
  });
  const storage = createStorage(config.dataDir, { allowLocalDownloads: config.testAllowLocalDownloads === true });
  // Small app-wide settings kept in the meta table (key "setting:<name>", JSON value).
  const appSettings = {
    get(name, fallback) {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`setting:${name}`);
      try { return row ? JSON.parse(row.value) : fallback; } catch { return fallback; }
    },
    set(name, value) {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(`setting:${name}`, JSON.stringify(value));
    },
  };
  const getRecommended = () => appSettings.get('recommended', DEFAULT_RECOMMENDED);
  const catalog = createCatalog({ dataDir: config.dataDir, providers, log: app.log, getRecommended });
  const quoter = createQuoter({ providers, log: app.log });
  const generations = createGenerations({ db, storage, providers, catalog, log: app.log, maxActiveJobsPerUser: config.maxActiveJobsPerUser, ...(config.testSettleDelaysMs ? { settleDelaysMs: config.testSettleDelaysMs } : {}) });
  app.decorate('ctx', { db, auth, providers, config, catalog, generations });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 } });

  const isHttps = (req) => req.protocol === 'https';
  // Real client IP: Cloudflare's header when the request came through our
  // trusted local tunnel, otherwise the address Fastify resolved.
  const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const clientIp = (req) => {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    return (LOOPBACK.has(req.socket.remoteAddress) && net.isIP(cf) && cf) || req.ip;
  };
  const setSessionCookie = (req, reply, token) => reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: isHttps(req), maxAge: config.sessionDays * 86_400,
  });
  const html = (reply, body, code = 200) => reply.code(code).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(body);
  const safeNext = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/studio');

  // ── Auth gate ───────────────────────────────────────────────────────────
  const crossSite = (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site') return true;
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return Boolean(origin);
    try { return new URL(origin).host !== req.headers.host; } catch { return true; }
  };

  app.addHook('onRequest', async (req, reply) => {
    const urlPath = req.url.split('?')[0];
    // CSRF guard for every state-changing request, sign-in and setup included.
    if (crossSite(req)) return reply.code(403).send({ error: 'Cross-origin request blocked' });
    req.user = auth.userFromToken(req.cookies?.[SESSION_COOKIE]);
    if (PUBLIC_PATHS.has(urlPath)) return;
    if (!auth.hasUsers()) return reply.redirect('/setup');
    if (req.user) return;
    if (urlPath.startsWith('/api/') || urlPath.startsWith('/dz/api/') || req.method !== 'GET') {
      return reply.code(401).send({ error: 'Sign in required' });
    }
    return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
  });

  // Security headers on everything we send, including the studio pages.
  // The CSP keeps the browser from contacting any third party (no third-party CDN,
  // no trackers): only this server, inline/eval scripts the studio needs.
  const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (req.url.startsWith('/media/')) {
      // User files: never run as a page, even if someone uploads HTML.
      reply.header('content-security-policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    } else {
      reply.header('content-security-policy', CSP);
    }
    if (isHttps(req)) reply.header('strict-transport-security', 'max-age=31536000');
    return payload;
  });

  app.get('/healthz', { logLevel: 'warn' }, async () => ({ ok: true }));

  // ── First start ─────────────────────────────────────────────────────────
  // Creating the admin needs a one-time code printed in the server log and
  // saved to DATA_DIR/setup-code, so nobody else can claim a fresh install.
  // Never through a public tunnel (Cloudflare adds cf-connecting-ip).
  const viaPublicTunnel = (req) => Boolean(req.headers['cf-connecting-ip']);
  const setupCodeFile = path.join(config.dataDir, 'setup-code');
  let setupCode = null;
  if (!auth.hasUsers()) {
    setupCode = fs.existsSync(setupCodeFile) ? fs.readFileSync(setupCodeFile, 'utf8').trim() : newToken().slice(0, 12);
    fs.writeFileSync(setupCodeFile, setupCode, { mode: 0o600 });
    app.log.warn(`First start: open /setup and enter this setup code: ${setupCode} (also in ${setupCodeFile})`);
  }
  app.get('/setup', async (req, reply) => {
    if (auth.hasUsers()) return reply.redirect('/login');
    if (viaPublicTunnel(req)) return html(reply, setupPage({ error: 'Open this page from the local network to create the admin.' }), 403);
    return html(reply, setupPage());
  });
  app.post('/setup', async (req, reply) => {
    if (auth.hasUsers()) return reply.redirect('/login');
    if (viaPublicTunnel(req)) return reply.code(403).send({ error: 'Local network only' });
    const { username, displayName, password, setupCode: code } = req.body || {};
    if (!setupCode || String(code || '').trim() !== setupCode) {
      return html(reply, setupPage({ error: 'Wrong setup code. It is in the server log and in DATA_DIR/setup-code.', values: req.body }), 403);
    }
    try {
      auth.createUser({ username, displayName, password, role: 'admin' });
    } catch (error) {
      if (error instanceof UserError) return html(reply, setupPage({ error: error.message, values: req.body }), 400);
      throw error;
    }
    try { fs.unlinkSync(setupCodeFile); } catch { /* already gone */ }
    setupCode = null;
    const session = await auth.login(username, password, req.headers['user-agent']);
    setSessionCookie(req, reply, session.token);
    return reply.redirect('/dz/settings?notice=welcome');
  });

  // ── Sign in / out ───────────────────────────────────────────────────────
  app.get('/login', async (req, reply) => {
    if (!auth.hasUsers()) return reply.redirect('/setup');
    if (req.user) return reply.redirect(safeNext(req.query.next));
    return html(reply, loginPage({ next: safeNext(req.query.next) }));
  });
  app.post('/login', async (req, reply) => {
    const { username, password, next } = req.body || {};
    const ipKey = `ip:${clientIp(req)}`;
    const userKey = `user:${String(username || '').trim().toLowerCase().slice(0, 64)}`;
    if (throttle.blocked(ipKey) || throttle.blocked(userKey)) {
      return html(reply, loginPage({ error: 'Too many attempts. Try again in 15 minutes.', next: safeNext(next), username }), 429);
    }
    const session = await auth.login(username, password, req.headers['user-agent']);
    if (!session) {
      throttle.fail(ipKey);
      throttle.fail(userKey);
      return html(reply, loginPage({ error: 'Wrong login or password.', next: safeNext(next), username }), 401);
    }
    throttle.reset(userKey);
    setSessionCookie(req, reply, session.token);
    return reply.redirect(safeNext(next));
  });
  app.post('/logout', async (req, reply) => {
    auth.logout(req.cookies?.[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/login');
  });

  // ── Settings ────────────────────────────────────────────────────────────
  const NOTICES = { welcome: 'Admin created. Add provider keys below.', saved: 'Saved.', password: 'Password changed.', user: 'Account saved.', recommended: 'Recommended models saved. Reload the studio to see them.' };

  async function renderSettings(req, reply, { error, notice, code = 200 } = {}) {
    const isAdmin = req.user.role === 'admin';
    return html(reply, settingsPage({
      user: req.user,
      providers: isAdmin ? PROVIDERS.map((p) => providers.publicView(p.id)) : [],
      balances: isAdmin ? await fetchBalances(providers) : [],
      users: isAdmin ? auth.listUsers() : [],
      recommended: isAdmin ? getRecommended() : [],
      families: isAdmin ? catalog.families() : [],
      error,
      notice: notice ?? NOTICES[req.query?.notice],
    }), code);
  }
  const requireAdmin = (req, reply) => {
    if (req.user.role !== 'admin') { reply.code(403).send({ error: 'Admin only' }); return false; }
    return true;
  };

  app.get('/dz/settings', (req, reply) => renderSettings(req, reply));

  app.post('/dz/settings/password', async (req, reply) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!(await auth.checkPassword(req.user.id, currentPassword))) {
      return renderSettings(req, reply, { error: 'Current password is wrong.', code: 400 });
    }
    try {
      const session = auth.changePassword(req.user.id, newPassword, { newSession: true, userAgent: req.headers['user-agent'] });
      setSessionCookie(req, reply, session.token);
    } catch (error) {
      if (error instanceof UserError) return renderSettings(req, reply, { error: error.message, code: 400 });
      throw error;
    }
    return reply.redirect('/dz/settings?notice=password');
  });

  app.post('/dz/settings/providers/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const provider = providerById(req.params.id);
    if (!provider) return reply.code(404).send({ error: 'Unknown provider' });
    const { apiKey, proxy, enabled, clearKey } = req.body || {};
    const proxyError = validateProxyUrl(String(proxy || '').trim());
    if (proxyError) return renderSettings(req, reply, { error: `${provider.name}: ${proxyError}`, code: 400 });
    providers.save(provider.id, {
      apiKey: String(apiKey || '').trim(),
      clearKey: Boolean(clearKey),
      proxy: String(proxy || '').trim(),
      enabled: Boolean(enabled),
    });
    catalog.refreshAll({ force: true }).catch(() => {}); // keys changed → rebuild the model list
    const [balance] = (await fetchBalances(providers)).filter((b) => b.id === provider.id);
    if (balance?.hasKey && balance.enabled && !balance.ok) {
      return renderSettings(req, reply, { error: `${provider.name}: saved, but the check failed — ${balance.error}` });
    }
    return renderSettings(req, reply, {
      notice: balance?.ok ? `${provider.name}: saved, key works — balance $${balance.amount.toFixed(2)}.` : `${provider.name}: saved.`,
    });
  });

  // Recommended models: shown first in every model picker, in this order.
  app.post('/dz/settings/recommended', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { action, key } = req.body || {};
    let list = [...getRecommended()];
    const known = new Set(catalog.families().map((f) => f.key));
    if (action === 'add') {
      if (!known.has(key)) return renderSettings(req, reply, { error: 'Unknown model family.', code: 400 });
      if (!list.includes(key)) list.push(key);
      list = list.slice(0, 24);
    } else if (action === 'remove') {
      list = list.filter((k) => k !== key);
    } else if (action === 'up') {
      const i = list.indexOf(key);
      if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    } else if (action === 'reset') {
      list = [...DEFAULT_RECOMMENDED];
    } else {
      return reply.code(400).send({ error: 'Unknown action' });
    }
    appSettings.set('recommended', list);
    catalog.requestRebuild();
    return reply.redirect('/dz/settings?notice=recommended#recommended');
  });

  const TEST_MODELS = {
    apimart: { model: 'z-image-turbo', body: (prompt) => ({ prompt, size: '1:1' }) },
    atlas: { model: 'black-forest-labs/flux-schnell', body: (prompt) => ({ prompt, size: '1024*1024' }) },
  };
  app.post('/dz/settings/test-generation', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const t = TEST_MODELS[req.body?.provider];
    if (!t) return reply.code(400).send({ error: 'Unknown provider' });
    try {
      if (!catalog.model(req.body.provider, t.model)) await catalog.refreshAll({ force: true });
      const { id } = await generations.submit(req.user, {
        providerId: req.body.provider, modelId: t.model, endpoint: `p/${req.body.provider}/${t.model}`,
        body: t.body(String(req.body.prompt || 'A red paper boat on a calm lake').slice(0, 500)),
      });
      return reply.redirect(`/dz/settings/test-generation/${id}`);
    } catch (error) {
      if (error instanceof GenerationError) return renderSettings(req, reply, { error: error.message, code: error.status });
      throw error;
    }
  });
  app.get('/dz/settings/test-generation/:id', async (req, reply) => {
    try {
      const result = generations.result(req.user, req.params.id);
      const row = db.prepare('SELECT provider, provider_model FROM generations WHERE id = ?').get(req.params.id);
      return html(reply, testResultPage({ result, provider: row.provider, model: row.provider_model }));
    } catch (error) {
      if (error instanceof GenerationError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  const parseLimit = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : Math.max(0, Number(v)));

  app.post('/dz/settings/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { username, displayName, password, role, monthlyLimitUsd } = req.body || {};
    try {
      auth.createUser({ username, displayName, password, role: role === 'admin' ? 'admin' : 'user', monthlyLimitUsd: parseLimit(monthlyLimitUsd) });
    } catch (error) {
      if (error instanceof UserError) return renderSettings(req, reply, { error: error.message, code: 400 });
      throw error;
    }
    return reply.redirect('/dz/settings?notice=user');
  });

  app.post('/dz/settings/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number(req.params.id);
    const { role, monthlyLimitUsd, disabled, newPassword, displayName } = req.body || {};
    try {
      auth.updateUser(id, { displayName, role, monthlyLimitUsd: parseLimit(monthlyLimitUsd), disabled: Boolean(disabled) });
      if (newPassword) {
        const session = auth.changePassword(id, newPassword, { newSession: id === req.user.id, userAgent: req.headers['user-agent'] });
        if (session) setSessionCookie(req, reply, session.token);
      }
    } catch (error) {
      if (error instanceof UserError) return renderSettings(req, reply, { error: error.message, code: 400 });
      throw error;
    }
    return reply.redirect('/dz/settings?notice=user');
  });

  // ── JSON for the studio shell ───────────────────────────────────────────
  app.get('/dz/api/me', async (req) => ({ user: publicUser(req.user) }));

  let balanceCache = { at: 0, data: null };
  app.get('/dz/api/balances', async (req) => {
    if (req.user.role !== 'admin') return { balances: [] };
    if (!balanceCache.data || Date.now() - balanceCache.at > 60_000 || req.query.fresh) {
      balanceCache = { at: Date.now(), data: await fetchBalances(providers) };
    }
    return { balances: balanceCache.data.map(({ error, ...b }) => ({ ...b, error: error ? 'unavailable' : undefined })) };
  });

  // ── API surface the studio calls ────────────────────────────────────────
  // Legacy upstream services (workflows, agents, apps…) are switched off for good.
  for (const prefix of ['/api/app', '/api/workflow', '/api/agents', '/api/api', '/api/upload-binary', '/api/v1/creative-agent', '/api/v1/get_upload_url', '/api/v1/upload-binary']) {
    app.all(prefix, legacyDisabled);
    app.all(`${prefix}/*`, legacyDisabled);
  }
  app.get('/api/v1/account/balance', async () => ({ balance: null }));

  const sendGenError = (reply, error) => {
    if (error instanceof GenerationError) return reply.code(error.status).send({ detail: error.message, error: error.message });
    throw error;
  };

  // Reference files (images, videos, audio) for generation.
  app.post('/api/v1/upload_file', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ detail: 'No file' });
    if (!isAllowedUploadMime(file.mimetype)) {
      file.file.resume();
      return reply.code(400).send({ detail: `File type ${file.mimetype} is not allowed` });
    }
    if (generations.uploadBytes(req.user.id) > config.userUploadQuotaBytes) {
      file.file.resume();
      return reply.code(413).send({ detail: 'Upload quota reached. Delete old references or ask the admin.' });
    }
    const saved = await generations.saveUpload(req.user, { stream: file.file, mime: file.mimetype, filename: file.filename, truncated: () => file.file.truncated });
    if (!saved) return reply.code(413).send({ detail: 'File is too large (max 500 MB)' });
    return { url: saved.url, file_url: saved.url, id: saved.id };
  });

  // Submit: /api/v1/p/<provider>/<provider model id>[?m=<studio mode>]
  // Models from the catalog get their fields translated for the provider.
  // Catalog variant behind a studio endpoint "p/<provider>/<model>[?m=mode]".
  // Only admins may call a provider model directly (outside the catalog);
  // everyone else goes through the field allowlist and pricing.
  function resolveEndpoint(user, providerId, modelId, mode) {
    const key = `p/${providerId}/${modelId}${mode ? `?m=${mode}` : ''}`;
    const variant = catalog.variant(key);
    if (!variant && user.role !== 'admin') return null;
    return { key, variant };
  }

  // Price before generating: { usd, exact, source } — shown next to Generate.
  const quoteThrottle = new Map(); // userId -> [timestamps]
  app.post('/dz/api/quote', async (req, reply) => {
    const t = Date.now();
    const recent = (quoteThrottle.get(req.user.id) || []).filter((x) => t - x < 60_000);
    if (recent.length >= 40) return reply.code(429).send({ error: 'Too many price checks, slow down.' });
    recent.push(t);
    quoteThrottle.set(req.user.id, recent);
    const m = /^p\/([a-z0-9-]+)\/([^?]+)(?:\?m=([a-z0-9]+))?$/i.exec(String(req.body?.endpoint || ''));
    if (!m) return reply.code(400).send({ error: 'Bad endpoint' });
    const [, providerId, modelId, mode] = m;
    const resolved = resolveEndpoint(req.user, providerId, modelId, mode);
    if (!resolved) return reply.code(404).send({ error: 'Unknown model' });
    const body = req.body?.body && typeof req.body.body === 'object' ? req.body.body : {};
    const providerBody = resolved.variant ? toProviderBody(resolved.variant, body) : body;
    const price = await quoter.quote({ providerId, modelId, providerBody, variant: resolved.variant });
    return { price };
  });

  app.post('/api/v1/p/:provider/*', async (req, reply) => {
    try {
      const providerId = req.params.provider;
      const modelId = req.params['*'];
      const resolved = resolveEndpoint(req.user, providerId, modelId, req.query.m);
      if (!resolved) return reply.code(404).send({ detail: 'Unknown model' });
      const { key, variant } = resolved;
      const body = variant ? toProviderBody(variant, req.body) : req.body;
      // The provider's own price for this exact request, or the catalog price.
      const price = await quoter.quote({ providerId, modelId, providerBody: body, variant });
      if (req.user.monthly_limit_usd != null && !Number.isFinite(price?.usd)) {
        return reply.code(402).send({ detail: 'This model has no known price, so it is not available with a spending limit.' });
      }
      const { id } = await generations.submit(req.user, {
        providerId,
        modelId,
        body,
        endpoint: key,
        kind: variant?.kind || null,
        estCostUsd: price?.usd ?? null,
        estSource: !price ? null : price.source === 'quote' ? (price.exact ? 'quote' : 'quote~') : 'estimate',
      });
      return { request_id: id, id, status: 'processing' };
    } catch (error) { return sendGenError(reply, error); }
  });

  // Model thumbnails from Atlas, fetched by the server (through Atlas's proxy)
  // so the browser never talks to third parties. Cached on disk.
  app.get('/dz/thumb', async (req, reply) => {
    const file = await catalog.thumbnail(String(req.query.u || ''));
    if (!file) return reply.code(404).send({ error: 'Not found' });
    return sendFile(req, reply, file.path, file.mime, { cacheControl: 'private, max-age=86400' });
  });

  // Model list for the studio (loaded before the studio code, see app/layout.js).
  app.get('/dz/catalog.js', async (req, reply) => reply
    .type('application/javascript; charset=utf-8')
    // no-store, not no-cache: Cloudflare's "Browser Cache TTL" rewrote no-cache
    // to max-age=14400, so browsers kept a 4-hour-old model list.
    .header('cache-control', 'private, no-store, max-age=0')
    .send(catalog.clientScript()));

  app.get('/api/v1/predictions/:id/result', async (req, reply) => {
    try { return generations.result(req.user, req.params.id); } catch (error) { return sendGenError(reply, error); }
  });
  app.delete('/api/v1/predictions/:id/media', async (req, reply) => {
    try { return generations.trash(req.user, req.params.id); } catch (error) { return sendGenError(reply, error); }
  });
  app.get('/api/v1/history', async (req) => generations.history(req.user, req.query));

  // Models from the studio's built-in catalog have no provider yet.
  app.all('/api/v1/*', async (req, reply) => reply.code(404).send({
    detail: 'This model is not available from your providers. Pick a model from APIMart or Atlas.',
  }));

  // ── Files: only the owner (or an admin) can open them ───────────────────
  app.get('/media/u/:file', async (req, reply) => {
    const f = generations.mediaFile(req.user, 'u', req.params.file.split('.')[0]);
    if (!f) return reply.code(404).send({ error: 'Not found' });
    return sendFile(req, reply, f.path, f.mime, { download: req.query.download === '1' });
  });
  app.get('/media/g/:id/:file', async (req, reply) => {
    const f = generations.mediaFile(req.user, 'g', req.params.id, req.params.file.split('.')[0]);
    if (!f) return reply.code(404).send({ error: 'Not found' });
    return sendFile(req, reply, f.path, f.mime, { download: req.query.download === '1' });
  });

  // ── Catalog refresh: on start, daily, and on demand (admin) ─────────────
  app.post('/dz/api/catalog/refresh', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await catalog.refreshAll({ force: true });
    return { ok: true, ...catalog.stats() };
  });

  // ── Everything else → studio ────────────────────────────────────────────
  await app.register(httpProxy, {
    upstream: config.studioUrl,
    prefix: '/',
    rewritePrefix: '/',
    http2: false,
    replyOptions: {
      rewriteRequestHeaders: (req, headers) => {
        const { cookie: _c, 'x-api-key': _k, ...rest } = headers;
        return rest;
      },
    },
  });

  app.addHook('onReady', async () => {
    if (config.startWorkers === false) return;
    generations.start();
    catalog.refreshAll().catch(() => {});
    setInterval(() => catalog.refreshAll().catch(() => {}), 3_600_000).unref();
  });
  app.addHook('onClose', async () => { generations.stop(); db.close(); });
  return app;
}

async function legacyDisabled(req, reply) {
  return reply.code(410).send({ error: 'This feature is not part of this build.' });
}
