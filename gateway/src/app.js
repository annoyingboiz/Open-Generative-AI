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
import crypto from 'node:crypto';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { openDatabase } from './db.js';
import { loadMasterKey, newToken } from './crypto.js';
import { createAuth, createLoginThrottle, publicUser, SESSION_COOKIE, UserError } from './auth.js';
import { PROVIDERS, providerById, createProviderSettings, fetchBalances } from './providers/index.js';
import { validateProxyUrl } from './providers/http.js';
import { loginPage, setupPage, settingsPage, testResultPage } from './pages.js';
import { createStorage, sendFile, isAllowedUploadMime } from './storage.js';
import { createCatalog, DEFAULT_RECOMMENDED } from './catalog/index.js';
import { createChanges } from './catalog/changes.js';
import { createGenerations, GenerationError } from './generations.js';
import { createProjects, ProjectError } from './projects.js';
import { createElements, ElementError } from './elements.js';
import { createLlm, LlmError } from './llm.js';
import { createChatGpt } from './chatgpt.js';
import { createThumbs } from './thumbs.js';
import { createQuoter } from './quotes.js';
import { toProviderBody } from './catalog/build.js';
import { falTool, falBody, falPrice } from './providers/fal-tools.js';
import { VIDEO_UPSCALE, isVideoUpscaleEndpoint, videoUpscaleBody, providerPayload, videoUpscalePrice, videoInfo, outputSize, restoreAudio, extractAudio, VideoUpscaleError } from './video-upscale.js';
import { imageSize } from './imagesize.js';

const PUBLIC_PATHS = new Set(['/login', '/setup', '/healthz', '/favicon.ico', '/dz/fonts/inter-latin.woff2', '/dz/fonts/inter-cyrillic.woff2']);

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
  const changes = createChanges({ dir: path.join(config.dataDir, 'catalog'), log: app.log, notify: (added) => notifyChanges(added) });
  async function notifyChanges(added) {
    const { botToken, chatId } = config.telegram || {};
    if (!botToken || !chatId || !added.length) return;
    const reverted = added.filter((e) => e.status === 'reverted').length;
    // Provider error texts may echo prompts or signed links: for refusals only the setting names go out.
    const safeDetail = (e) => (e.type === 'rejected' ? '' : String(e.detail || '').replace(/https?:\/\/\S+/g, '[link]').slice(0, 80));
    const lines = added.slice(0, 12).map((e) => `• ${e.provider} · ${e.name || e.model || e.endpoint || ''} — ${e.type}${e.param ? ` ${e.param}` : ''}${safeDetail(e) ? `: ${safeDetail(e)}` : ''}`);
    const text = [`Director: ${added.length} provider change(s)${reverted ? `, ${reverted} rolled back` : ''}`, ...lines, added.length > 12 ? `…and ${added.length - 12} more` : '', config.publicUrl ? `${config.publicUrl}/dz/settings#changes` : ''].filter(Boolean).join('\n');
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) });
    } catch (error) { app.log.warn(`telegram: ${error.message}`); }
  }
  const catalog = createCatalog({ dataDir: config.dataDir, providers, log: app.log, getRecommended, changes });
  const quoter = createQuoter({ providers, log: app.log });
  const projects = createProjects({ db });
  const generations = createGenerations({ db, storage, providers, catalog, log: app.log, projects, maxActiveJobsPerUser: config.maxActiveJobsPerUser, uploadQuotaBytes: config.userUploadQuotaBytes ?? Infinity, maxUploadBytes: config.maxUploadBytes ?? Infinity, onProviderRejected: (r) => changes.providerRejected(r), ...(config.testSettleDelaysMs ? { settleDelaysMs: config.testSettleDelaysMs } : {}) });
  const elements = createElements({ db, projects, generations, log: app.log });
  generations.setOnCompleted((row) => elements.attachGenerated(row));
  // Most video upscalers drop the sound: put the original's back in. The sound
  // was copied aside when the job started (job-owned, survives deleting the source).
  const audioDir = path.join(config.dataDir, 'upscale-audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const audioFileOf = (row) => {
    let up = null;
    try { up = JSON.parse(row.meta_json || '{}').upscale; } catch { up = null; }
    const name = up?.audio_file;
    return name && /^[a-z0-9_-]+\.m4a$/i.test(name) ? path.join(audioDir, name) : null;
  };
  generations.setAfterDownload({
    wants: (row) => row.studio === 'upscale' && row.kind === 'video' && Boolean(audioFileOf(row)),
    run: async (row, saved) => {
      const audio = audioFileOf(row);
      if (!fs.existsSync(audio)) return;
      for (const out of saved) {
        if (!/^video\//.test(out.mime || '')) continue;
        const info = await videoInfo(out.path);
        if (!info || info.audio) continue;
        const ok = (await restoreAudio(out.path, audio)) || (await restoreAudio(out.path, audio));
        if (ok) out.bytes = fs.statSync(out.path).size;
        else app.log.warn(`upscale ${row.id}: could not put the sound back`);
      }
      fs.rmSync(audio, { force: true });
    },
  });
  const pruneAudio = () => {
    for (const f of fs.readdirSync(audioDir)) {
      const p = path.join(audioDir, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > 3 * 86_400_000) fs.rmSync(p, { force: true }); } catch { /* gone */ }
    }
  };
  const chatgpt = createChatGpt({ db, masterKey, config, log: app.log });
  const llm = createLlm({ db, providers, generations, config, log: app.log, chatgpt });
  const thumbs = createThumbs({ dataDir: config.dataDir, log: app.log });
  if (config.startWorkers !== false) setInterval(() => { try { thumbs.prune(); pruneAudio(); } catch { /* ignore */ } }, 24 * 3600_000).unref?.();
  if (config.startWorkers !== false) {
    setTimeout(() => elements.attachPending().catch(() => {}), 30_000).unref?.();
    setInterval(() => elements.attachPending().catch(() => {}), 10 * 60_000).unref?.();
  }
  app.decorate('ctx', { db, auth, providers, config, catalog, generations, elements, llm, chatgpt });
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

  // Inter for the server pages (sign-in, settings), served by us — no font CDN.
  const fontDir = path.join(path.dirname(require.resolve('@fontsource-variable/inter/package.json')), 'files');
  for (const subset of ['latin', 'cyrillic']) {
    app.get(`/dz/fonts/inter-${subset}.woff2`, (req, reply) => sendFile(req, reply, path.join(fontDir, `inter-${subset}-wght-normal.woff2`), 'font/woff2', { cacheControl: 'public, max-age=31536000, immutable' }));
  }

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
  const NOTICES = { welcome: 'Admin created. Add provider keys below.', saved: 'Saved.', password: 'Password changed.', user: 'Account saved.', recommended: 'Recommended models saved. Reload the studio to see them.', changes: 'Provider changes updated.', checked: 'Check started. It takes a minute or two — reload this page to see new changes.', llm: 'Default text model saved.' };

  async function renderSettings(req, reply, { error, notice, code = 200, llmTry = null } = {}) {
    const isAdmin = req.user.role === 'admin';
    const balancesP = isAdmin ? fetchBalances(providers) : Promise.resolve([]);
    // Everyone gets their ChatGPT box and own default; admins also the sources and tests.
    // The page never waits long for providers: after 4 s it shows what is known.
    const lists = isAdmin
      ? await Promise.race([llm.list(req.user).catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))])
      : await llm.quickList(req.user).catch(() => null);
    const llmInfo = {
      ...(lists || llm.cachedList(req.user)), try: llmTry, chatgpt: chatgpt.status(req.user), username: req.user.username, isAdmin,
      ...(isAdmin ? { recent: llm.recent(10), accounts: chatgpt.accounts() } : {}),
    };
    return html(reply, settingsPage({
      user: req.user,
      providers: isAdmin ? PROVIDERS.map((p) => providers.publicView(p.id)) : [],
      balances: await balancesP,
      users: isAdmin ? auth.listUsers() : [],
      recommended: isAdmin ? getRecommended() : [],
      families: isAdmin ? catalog.families() : [],
      changes: isAdmin ? { entries: changes.list({ limit: 150 }), summary: changes.summary(), telegram: Boolean(config.telegram?.botToken && config.telegram?.chatId) } : null,
      llm: llmInfo,
      error,
      notice: notice ?? NOTICES[req.query?.notice],
    }), code);
  }
  const renderSettingsSeen = async (req, reply, opts) => {
    const out = await renderSettings(req, reply, opts);
    if (req.user.role === 'admin') changes.markSeen(); // the admin has seen the list
    return out;
  };
  const requireAdmin = (req, reply) => {
    if (req.user.role !== 'admin') { reply.code(403).send({ error: 'Admin only' }); return false; }
    return true;
  };

  app.get('/dz/settings', (req, reply) => renderSettingsSeen(req, reply));

  // ── Text models (LLM) ───────────────────────────────────────────────────
  const llmError = (reply, error) => {
    if (error instanceof LlmError) return reply.code(error.status).send({ error: error.message });
    app.log.error(error);
    return reply.code(500).send({ error: 'Text model error.' });
  };
  app.get('/dz/api/llm/models', async (req, reply) => {
    reply.header('cache-control', 'private, no-store');
    try { return await llm.list(req.user, { force: req.query?.refresh === '1' && req.user.role === 'admin' }); } catch (error) { return llmError(reply, error); }
  });
  app.post('/dz/api/llm/chat', async (req, reply) => {
    try { return await llm.chat(req.user, req.body || {}); } catch (error) { return llmError(reply, error); }
  });
  app.post('/dz/settings/llm/default', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { llm.setDefault(req.body?.model); return reply.redirect('/dz/settings?notice=llm#llm'); } catch (error) { return renderSettings(req, reply, { error: error.message, code: 400 }); }
  });
  // ChatGPT, each person their own. Connect: the server makes the sign-in link
  // (opens in a new tab); finish: the address the browser landed on.
  const chatgptError = (req, reply, error) => {
    if (error?.status && error.message) return renderSettings(req, reply, { error: error.message, code: error.status >= 500 ? 424 : error.status });
    throw error;
  };
  app.post('/dz/settings/chatgpt/connect', async (req, reply) => {
    const { url } = chatgpt.startConnect(req.user, { fresh: req.body?.fresh === '1' });
    return reply.redirect(url);
  });
  app.post('/dz/settings/chatgpt/finish', async (req, reply) => {
    try {
      const r = await chatgpt.finishConnect(req.user, req.body?.callback);
      llm.dropUnusableDefaults();
      return renderSettings(req, reply, { notice: `ChatGPT connected${r.email ? `: ${r.email}` : ''}.` });
    } catch (error) { return chatgptError(req, reply, error); }
  });
  // Your own connection, or (admin) someone else's: revoke at OpenAI, then forget.
  app.post('/dz/settings/chatgpt/disconnect', async (req, reply) => {
    const target = req.body?.userId ? Number(req.body.userId) : req.user.id;
    if (target !== req.user.id && req.user.role !== 'admin') return reply.code(403).send({ error: 'Not allowed' });
    const r = await chatgpt.disconnect(target);
    llm.dropUnusableDefaults();
    return renderSettings(req, reply, { notice: r.revoked ? 'ChatGPT disconnected and revoked at OpenAI.' : 'ChatGPT disconnected here; OpenAI did not confirm the revocation — you can also remove the app in ChatGPT → Settings.' });
  });
  // An admin shares their own plan with everyone here (people without one), or stops.
  app.post('/dz/settings/chatgpt/sharing', async (req, reply) => {
    try {
      chatgpt.setShared(req.user, req.body?.sharing === 'all');
      llm.dropUnusableDefaults();
      return reply.redirect('/dz/settings?notice=llm#llm');
    } catch (error) { return chatgptError(req, reply, error); }
  });
  // Everyone: their own default text model.
  app.post('/dz/settings/llm/my-default', async (req, reply) => {
    try { llm.setUserDefault(req.user, req.body?.model); return reply.redirect('/dz/settings?notice=llm#llm'); } catch (error) { return renderSettings(req, reply, { error: error.message, code: 400 }); }
  });
  app.post('/dz/settings/llm/try', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const started = Date.now();
    try {
      const r = await llm.chat(req.user, { model: req.body?.model, prompt: req.body?.prompt, purpose: 'settings-test', maxTokens: 1500 });
      return renderSettings(req, reply, { llmTry: { ok: true, model: r.model, text: r.text, costUsd: r.costUsd, ms: r.ms, usage: r.usage, prompt: req.body?.prompt } });
    } catch (error) {
      return renderSettings(req, reply, { llmTry: { ok: false, model: req.body?.model, text: error.message, ms: Date.now() - started, prompt: req.body?.prompt } });
    }
  });

  // ── Provider changes (admin) ────────────────────────────────────────────
  app.get('/dz/api/changes/summary', async (req, reply) => {
    reply.header('cache-control', 'private, no-store');
    if (req.user.role !== 'admin') return { unseen: 0 };
    return changes.summary();
  });
  app.post('/dz/settings/changes/check', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    // Takes a minute or two (every schema and docs page) — runs in the background.
    catalog.refreshAll({ force: true, docs: true }).catch((error) => app.log.warn(`changes check: ${error.message}`));
    return reply.redirect('/dz/settings?notice=checked#changes');
  });

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
      notice: !balance?.ok ? `${provider.name}: saved.` : balance.amount == null ? `${provider.name}: saved, key works.` : `${provider.name}: saved, key works — balance $${balance.amount.toFixed(2)}.`,
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
    if (error instanceof GenerationError || error instanceof ProjectError || error instanceof ElementError || error instanceof VideoUpscaleError) return reply.code(error.status).send({ detail: error.message, error: error.message });
    throw error;
  };
  // Where new work goes: ?project=&folder= (or _dz.project/_dz.folder) → checked ids.
  const contextOf = (user, project, folder) => projects.target(user, project ? String(project) : null, folder ? String(folder) : null);

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
    let ctx;
    try { ctx = contextOf(req.user, req.query.project, req.query.folder); } catch (error) { file.file.resume(); return sendGenError(reply, error); }
    const saved = await generations.saveUpload(req.user, { stream: file.file, mime: file.mimetype, filename: file.filename, truncated: () => file.file.truncated, ...ctx });
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
    // Video upscalers (fal + Atlas): our own spec, only with that provider's key.
    if (isVideoUpscaleEndpoint(providerId, modelId)) {
      const spec = catalog.tools().videoUpscale;
      return !mode && spec?.models.some((m) => m.provider === providerId && m.endpoint === modelId) ? { key, tool: { tool: VIDEO_UPSCALE, kind: 'video' }, video: true } : null;
    }
    // Tools on fal.ai (upscaling): their own field list and price rules.
    if (providerId === 'fal') {
      const tool = falTool(modelId);
      return tool && !mode && catalog.hasTool(tool.tool.id) ? { key, tool } : null;
    }
    const variant = catalog.variant(key);
    if (!variant && user.role !== 'admin') return null;
    return { key, variant };
  }

  function providerBodyFor(resolved, providerId, modelId, body) {
    if (resolved.tool) return falBody(modelId, body);
    return resolved.variant ? toProviderBody(resolved.variant, body) : body;
  }

  // Video upscale: our copy of the video tells size, length and sound; the
  // request is built for the chosen model and checked against its limits.
  async function videoRequest(user, providerId, modelId, raw) {
    const file = generations.mediaFileForUrl(user, raw?.video_url);
    if (!file || !/^video\//.test(file.mime || '')) throw new VideoUpscaleError('Choose a video to upscale.');
    const info = await videoInfo(file.path);
    if (!info?.width || !info?.duration) throw new VideoUpscaleError('Could not read this video.');
    const full = videoUpscaleBody(providerId, modelId, raw, info);
    return { file, info, full, payload: providerPayload(full) };
  }
  // Atlas prices these by the video itself: it gets a copy first (reused by the upscale).
  const videoQuotes = new Map();
  async function videoPrice(user, providerId, modelId, req) {
    const { info, full, payload } = req;
    const output = outputSize(info, full.target);
    const base = { input: { width: info.width, height: info.height, duration: Math.round(info.duration * 10) / 10, fps: info.fps, audio: info.audio }, output: { width: output.width, height: output.height } };
    if (providerId !== 'atlas') {
      const p = videoUpscalePrice(providerId, modelId, full, info);
      return p ? { usd: p.usd, exact: p.exact, source: 'quote', ...base } : null;
    }
    const field = 'video' in payload ? 'video' : 'video_url';
    // A price check never sends the video on its own: only when asked (check) or already there.
    const url = generations.cachedProviderUrl(user, 'atlas', payload[field]) || (req.check ? await generations.providerUrl(user, 'atlas', payload[field]) : null);
    if (!url) return { needsCheck: true, ...base };
    const body = { ...payload, [field]: url };
    const key = JSON.stringify([modelId, body]);
    const hit = videoQuotes.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return { ...hit.value, ...base };
    const q = await providerById('atlas').quote(providers.resolve('atlas'), { model: modelId, body }).catch((error) => { app.log.warn(`video quote ${modelId}: ${error.message}`); return null; });
    const value = q ? { usd: q.usd, exact: q.exact, source: 'quote' } : null;
    if (value) { videoQuotes.set(key, { at: Date.now(), value }); if (videoQuotes.size > 500) videoQuotes.delete(videoQuotes.keys().next().value); }
    return value ? { ...value, ...base } : null;
  }

  // Upscale prices depend on the input size: read it from our copy of the file.
  function toolQuote(user, modelId, providerBody) {
    const file = generations.mediaFileForUrl(user, providerBody.image_url);
    let dims = null;
    try { dims = file && /^image\//.test(file.mime) ? imageSize(file.path) : null; } catch { dims = null; }
    const price = falPrice(modelId, providerBody, dims);
    return price ? { usd: price.usd, exact: price.exact, source: 'quote', output_mp: Math.round(price.outputMp * 10) / 10, input: dims } : null;
  }

  async function priceFor(user, resolved, providerId, modelId, providerBody) {
    if (resolved.tool) return toolQuote(user, modelId, providerBody);
    return quoter.quote({ providerId, modelId, providerBody, variant: resolved.variant });
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
    const { _dz: _ignored, ...body } = req.body?.body && typeof req.body.body === 'object' ? req.body.body : {};
    if (resolved.video) {
      try {
        const vr = await videoRequest(req.user, providerId, modelId, body);
        const p = await videoPrice(req.user, providerId, modelId, { ...vr, check: body.check === true });
        if (p?.needsCheck) { const { needsCheck: _n, ...info } = p; return { price: null, needsCheck: true, info }; }
        return { price: p };
      } catch (error) {
        if (error instanceof VideoUpscaleError || error instanceof GenerationError) return { price: null, problem: error.message };
        throw error;
      }
    }
    const providerBody = providerBodyFor(resolved, providerId, modelId, body);
    const price = await priceFor(req.user, resolved, providerId, modelId, providerBody);
    return { price };
  });

  app.post('/api/v1/p/:provider/*', async (req, reply) => {
    try {
      const providerId = req.params.provider;
      const modelId = req.params['*'];
      const resolved = resolveEndpoint(req.user, providerId, modelId, req.query.m);
      if (!resolved) return reply.code(404).send({ detail: 'Unknown model' });
      const { key, variant } = resolved;
      // `_dz`: our own data about the request (which studio, its settings) —
      // stored with the history item, never sent to the provider.
      const { _dz: dz, ...requestBody } = req.body || {};
      const studio = ['create', 'cinema', 'image', 'video', 'upscale'].includes(dz?.studio) ? dz.studio : null;
      const metaText = dz?.meta && typeof dz.meta === 'object' ? JSON.stringify(dz.meta) : null;
      const meta = metaText && metaText.length <= 65_536 ? { ...dz.meta } : null;
      if (meta) delete meta.upscale; // ours, set by the server for video upscales only
      const { projectId, folderId } = contextOf(req.user, dz?.project, dz?.folder);
      if (resolved.video) {
        const vr = await videoRequest(req.user, providerId, modelId, requestBody);
        const price = await videoPrice(req.user, providerId, modelId, { ...vr, check: true });
        // Keep the sound aside for this job (the source may be deleted before it ends).
        let audioFile = null;
        if (vr.info.audio) {
          const name = `${crypto.randomUUID()}.m4a`;
          if (await extractAudio(vr.file.path, path.join(audioDir, name))) audioFile = name;
        }
        if (req.user.monthly_limit_usd != null && !(price && price.exact && Number.isFinite(price.usd))) {
          return reply.code(402).send({ detail: 'No exact price for this upscale, so it is not available with a spending limit.' });
        }
        const { id } = await generations.submit(req.user, {
          providerId, modelId, body: vr.payload, endpoint: key, kind: 'video',
          estCostUsd: price?.usd ?? null, estSource: price ? (price.exact ? 'quote' : 'quote~') : null,
          studio: 'upscale',
          meta: { ...(meta || {}), upscale: { model: vr.full.tool_model, target: vr.full.target, source: requestBody.video_url, input: price?.input || null, output: price?.output || null, audio: vr.info.audio, audio_file: audioFile } },
          projectId, folderId,
        });
        return { request_id: id, id, status: 'processing' };
      }
      const body = providerBodyFor(resolved, providerId, modelId, requestBody);
      if (resolved.tool && !generations.mediaFileForUrl(req.user, body.image_url)) {
        return reply.code(400).send({ detail: 'Choose an image to upscale.' });
      }
      // The provider's own price for this exact request, or the catalog price.
      const price = await priceFor(req.user, resolved, providerId, modelId, body);
      // A tool price we only assume (fal doesn't publish it) can't back a spending limit.
      if (req.user.monthly_limit_usd != null && resolved.tool && price && !price.exact) {
        return reply.code(402).send({ detail: 'This model has no published price, so it is not available with a spending limit.' });
      }
      if (req.user.monthly_limit_usd != null && !Number.isFinite(price?.usd)) {
        return reply.code(402).send({ detail: 'This model has no known price, so it is not available with a spending limit.' });
      }
      const { id } = await generations.submit(req.user, {
        providerId,
        modelId,
        body,
        endpoint: key,
        kind: variant?.kind || resolved.tool?.kind || null,
        estCostUsd: price?.usd ?? null,
        estSource: !price ? null : price.source === 'quote' ? (price.exact ? 'quote' : 'quote~') : 'estimate',
        studio: studio || (resolved.tool ? 'upscale' : null),
        meta,
        projectId,
        folderId,
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
  app.get('/api/v1/history', async (req, reply) => {
    try { return generations.history(req.user, req.query); } catch (error) { return sendGenError(reply, error); }
  });
  app.post('/api/v1/predictions/:id/move', async (req, reply) => {
    try { return generations.move(req.user, req.params.id, { project: req.body?.project || null, folder: req.body?.folder || null }); } catch (error) { return sendGenError(reply, error); }
  });
  app.post('/api/v1/predictions/:id/copy', async (req, reply) => {
    try { return await generations.copy(req.user, req.params.id, { project: req.body?.project || null, folder: req.body?.folder || null }); } catch (error) { return sendGenError(reply, error); }
  });
  // Many at once: { action: move|copy|trash|restore|purge, ids: [...], project?, folder? }.
  app.post('/api/v1/predictions/batch', async (req, reply) => {
    try { return await generations.batch(req.user, req.body || {}); } catch (error) { return sendGenError(reply, error); }
  });
  app.post('/api/v1/predictions/:id/like', async (req, reply) => {
    try { return generations.like(req.user, req.params.id, req.body?.liked !== false); } catch (error) { return sendGenError(reply, error); }
  });
  app.post('/api/v1/predictions/:id/restore', async (req, reply) => {
    try { return generations.restore(req.user, req.params.id); } catch (error) { return sendGenError(reply, error); }
  });
  app.delete('/api/v1/predictions/:id', async (req, reply) => {
    try { return generations.purge(req.user, req.params.id); } catch (error) { return sendGenError(reply, error); }
  });
  app.post('/api/v1/uploads/delete', async (req, reply) => {
    try { return generations.deleteUploads(req.user, req.body?.ids); } catch (error) { return sendGenError(reply, error); }
  });
  app.get('/api/v1/uploads', async (req, reply) => {
    try { return generations.uploads(req.user, req.query); } catch (error) { return sendGenError(reply, error); }
  });

  // ── Projects ────────────────────────────────────────────────────────────
  const projectRoute = (fn) => async (req, reply) => {
    reply.header('cache-control', 'private, no-store');
    try { return await fn(req, reply); } catch (error) { return sendGenError(reply, error); }
  };
  app.get('/dz/api/projects', projectRoute((req) => ({ projects: projects.list(req.user), colors: projects.colors })));
  app.post('/dz/api/projects', projectRoute((req) => projects.create(req.user, req.body || {})));
  app.get('/dz/api/projects/:id', projectRoute((req) => projects.details(req.user, req.params.id)));
  app.patch('/dz/api/projects/:id', projectRoute((req) => projects.update(req.user, req.params.id, req.body || {})));
  app.post('/dz/api/projects/:id/touch', projectRoute((req) => projects.touch(req.user, req.params.id)));
  app.post('/dz/api/projects/:id/members', projectRoute((req) => projects.addMember(req.user, req.params.id, req.body?.username)));
  app.delete('/dz/api/projects/:id/members/:userId', projectRoute((req) => projects.removeMember(req.user, req.params.id, req.params.userId)));
  app.post('/dz/api/projects/:id/folders', projectRoute((req) => projects.createFolder(req.user, req.params.id, req.body || {})));
  app.patch('/dz/api/folders/:id', projectRoute((req) => projects.updateFolder(req.user, req.params.id, req.body || {})));
  app.delete('/dz/api/folders/:id', projectRoute((req) => projects.deleteFolder(req.user, req.params.id)));
  // ── Elements (Library or project; copies between them) ────────────────
  app.get('/dz/api/elements', projectRoute((req) => elements.list(req.user, req.query)));
  app.post('/dz/api/elements', projectRoute((req) => elements.create(req.user, req.body || {})));
  app.patch('/dz/api/elements/:id', projectRoute((req) => elements.update(req.user, req.params.id, req.body || {})));
  app.delete('/dz/api/elements/:id', projectRoute((req) => elements.remove(req.user, req.params.id)));
  app.post('/dz/api/elements/:id/copy', projectRoute((req) => elements.copy(req.user, req.params.id, { project: req.body?.project || null, duplicate: req.body?.duplicate === true })));
  app.post('/dz/api/elements/:id/sync', projectRoute((req) => elements.sync(req.user, req.params.id)));

  // Names to add people to a project (signed-in users only; no roles, no limits).
  app.get('/dz/api/users', projectRoute(() => ({ users: projects.users() })));
  // Tools that depend on a provider key (e.g. Upscale on fal.ai), for the
  // studio to notice a key added after the page was loaded.
  app.get('/dz/api/tools', async (req, reply) => reply.header('cache-control', 'private, no-store').send({ tools: catalog.tools() }));

  // Models from the studio's built-in catalog have no provider yet.
  app.all('/api/v1/*', async (req, reply) => reply.code(404).send({
    detail: 'This model is not available from your providers. Pick a model from APIMart or Atlas.',
  }));

  // ── Files: only people who may see them can open them ───────────────────
  // The browser keeps files but asks every time (a 304 when unchanged), so
  // access is always checked; never in a shared cache. ?w=480 → a small webp
  // preview (a video's first frame).
  const sendMedia = async (req, reply, f) => {
    if (req.query.w && req.query.download !== '1') {
      const t = await thumbs.thumbFor(f.path, f.mime, req.query.w);
      if (t === 'busy') return reply.code(503).header('retry-after', '5').send({ error: 'Previews are busy, try again.' });
      if (t) { thumbs.touch(t); return sendFile(req, reply, t, 'image/webp', { cacheControl: 'private, no-cache' }); }
      if (String(f.mime).startsWith('video/')) return reply.code(404).send({ error: 'No preview' });
    }
    return sendFile(req, reply, f.path, f.mime, { download: req.query.download === '1', cacheControl: 'private, no-cache' });
  };
  app.get('/media/u/:file', async (req, reply) => {
    const f = generations.mediaFile(req.user, 'u', req.params.file.split('.')[0]);
    if (!f) return reply.code(404).send({ error: 'Not found' });
    return sendMedia(req, reply, f);
  });
  app.get('/media/g/:id/:file', async (req, reply) => {
    const f = generations.mediaFile(req.user, 'g', req.params.id, req.params.file.split('.')[0]);
    if (!f) return reply.code(404).send({ error: 'Not found' });
    return sendMedia(req, reply, f);
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
  app.addHook('onClose', async () => { generations.stop(); chatgpt.closeListener(); db.close(); });
  return app;
}

async function legacyDisabled(req, reply) {
  return reply.code(410).send({ error: 'This feature is not part of this build.' });
}
