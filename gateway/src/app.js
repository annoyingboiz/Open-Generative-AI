// The gateway application: sits in front of the Next.js studio.
//   /login /setup /logout /dz/*   — handled here (accounts, settings, JSON for the shell)
//   /api/*                         — handled here (provider gateway; Muapi is blocked)
//   everything else               — proxied to the studio, only for signed-in users
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import httpProxy from '@fastify/http-proxy';
import { openDatabase } from './db.js';
import { loadMasterKey } from './crypto.js';
import { createAuth, createLoginThrottle, publicUser, SESSION_COOKIE, UserError } from './auth.js';
import { PROVIDERS, providerById, createProviderSettings, fetchBalances } from './providers/index.js';
import { validateProxyUrl } from './providers/http.js';
import { loginPage, setupPage, settingsPage } from './pages.js';

const PUBLIC_PATHS = new Set(['/login', '/setup', '/healthz', '/favicon.ico']);

export async function buildApp(config, { logger = true } = {}) {
  const db = openDatabase(config.dataDir);
  const masterKey = loadMasterKey(config.dataDir, config.appSecret);
  const auth = createAuth({ db, sessionDays: config.sessionDays });
  const providers = createProviderSettings({ db, masterKey, envDefaults: config.providerEnv });
  const throttle = createLoginThrottle();

  const app = Fastify({
    logger: logger ? { level: config.logLevel } : false,
    trustProxy: true,
    bodyLimit: 50 * 1024 * 1024,
  });
  app.decorate('ctx', { db, auth, providers, config });
  await app.register(cookie);
  await app.register(formbody);

  const isHttps = (req) => req.protocol === 'https';
  const setSessionCookie = (req, reply, token) => reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: isHttps(req), maxAge: config.sessionDays * 86_400,
  });
  const html = (reply, body, code = 200) => reply.code(code).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(body);
  const safeNext = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/studio');

  // ── Auth gate ───────────────────────────────────────────────────────────
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    req.user = auth.userFromToken(req.cookies?.[SESSION_COOKIE]);
    if (PUBLIC_PATHS.has(path)) return;
    if (!auth.hasUsers()) return reply.redirect('/setup');
    if (req.user) {
      // Basic CSRF guard for state-changing requests: same-origin only.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) {
          return reply.code(403).send({ error: 'Cross-origin request blocked' });
        }
      }
      return;
    }
    if (path.startsWith('/api/') || path.startsWith('/dz/api/') || req.method !== 'GET') {
      return reply.code(401).send({ error: 'Sign in required' });
    }
    return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
  });

  app.get('/healthz', async () => ({ ok: true }));

  // ── First start ─────────────────────────────────────────────────────────
  app.get('/setup', async (req, reply) => {
    if (auth.hasUsers()) return reply.redirect('/login');
    return html(reply, setupPage());
  });
  app.post('/setup', async (req, reply) => {
    if (auth.hasUsers()) return reply.redirect('/login');
    const { username, displayName, password } = req.body || {};
    try {
      auth.createUser({ username, displayName, password, role: 'admin' });
    } catch (error) {
      if (error instanceof UserError) return html(reply, setupPage({ error: error.message, values: req.body }), 400);
      throw error;
    }
    const session = auth.login(username, password, req.headers['user-agent']);
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
    if (throttle.blocked(req.ip)) {
      return html(reply, loginPage({ error: 'Too many attempts. Try again in 15 minutes.', next: safeNext(next), username }), 429);
    }
    const session = auth.login(username, password, req.headers['user-agent']);
    if (!session) {
      throttle.fail(req.ip);
      return html(reply, loginPage({ error: 'Wrong login or password.', next: safeNext(next), username }), 401);
    }
    throttle.reset(req.ip);
    setSessionCookie(req, reply, session.token);
    return reply.redirect(safeNext(next));
  });
  app.post('/logout', async (req, reply) => {
    auth.logout(req.cookies?.[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/login');
  });

  // ── Settings ────────────────────────────────────────────────────────────
  const NOTICES = { welcome: 'Admin created. Add provider keys below.', saved: 'Saved.', password: 'Password changed.', user: 'Account saved.' };

  async function renderSettings(req, reply, { error, notice, code = 200 } = {}) {
    const isAdmin = req.user.role === 'admin';
    return html(reply, settingsPage({
      user: req.user,
      providers: isAdmin ? PROVIDERS.map((p) => providers.publicView(p.id)) : [],
      balances: isAdmin ? await fetchBalances(providers) : [],
      users: isAdmin ? auth.listUsers() : [],
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
    if (!auth.checkPassword(req.user.id, currentPassword)) {
      return renderSettings(req, reply, { error: 'Current password is wrong.', code: 400 });
    }
    try {
      auth.changePassword(req.user.id, newPassword, { keepToken: req.cookies[SESSION_COOKIE] });
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
    const [balance] = (await fetchBalances(providers)).filter((b) => b.id === provider.id);
    if (balance?.hasKey && balance.enabled && !balance.ok) {
      return renderSettings(req, reply, { error: `${provider.name}: saved, but the check failed — ${balance.error}` });
    }
    return renderSettings(req, reply, {
      notice: balance?.ok ? `${provider.name}: saved, key works — balance $${balance.amount.toFixed(2)}.` : `${provider.name}: saved.`,
    });
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
      if (newPassword) auth.changePassword(id, newPassword, id === req.user.id ? { keepToken: req.cookies[SESSION_COOKIE] } : {});
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
  // Muapi-only services are switched off for good.
  for (const prefix of ['/api/app', '/api/workflow', '/api/agents', '/api/api', '/api/upload-binary', '/api/v1/creative-agent', '/api/v1/get_upload_url', '/api/v1/upload-binary']) {
    app.all(prefix, muapiDisabled);
    app.all(`${prefix}/*`, muapiDisabled);
  }
  app.get('/api/v1/account/balance', async () => ({ balance: null }));
  // Generation goes through the provider layer (step 3). Until then: a clear error.
  app.all('/api/v1/*', async (req, reply) => reply.code(503).send({
    detail: 'Generation through APIMart / Atlas is not wired yet (next build step).',
  }));

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

  app.addHook('onClose', async () => db.close());
  return app;
}

async function muapiDisabled(req, reply) {
  return reply.code(410).send({ error: 'This feature needs Muapi servers and is disabled in this build.' });
}
