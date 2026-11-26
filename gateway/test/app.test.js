import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { encrypt, decrypt, hashPassword, verifyPassword } from '../src/crypto.js';

let upstream;
let app;
let dataDir;

const cookieOf = (res) => {
  const raw = res.headers['set-cookie'];
  const line = Array.isArray(raw) ? raw[0] : raw;
  return line ? line.split(';')[0] : '';
};

before(async () => {
  upstream = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ upstream: true, url: req.url, sawCookie: Boolean(req.headers.cookie), sawKey: Boolean(req.headers['x-api-key']) }));
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-'));
  app = await buildApp({
    host: '127.0.0.1', port: 0, studioUrl: `http://127.0.0.1:${upstream.address().port}`,
    dataDir, appSecret: '', sessionDays: 30, logLevel: 'error', startWorkers: false,
    providerEnv: { apimart: { apiKey: '', proxy: '' }, atlas: { apiKey: 'env-key-1234', proxy: '' } },
  }, { logger: false });
});

after(async () => {
  await app.close();
  upstream.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('crypto round-trips', () => {
  const key = Buffer.alloc(32, 7);
  assert.equal(decrypt(key, encrypt(key, 'sk-secret')), 'sk-secret');
  const h = hashPassword('correct horse');
  assert.ok(verifyPassword('correct horse', h));
  assert.ok(!verifyPassword('wrong', h));
});

let adminCookie;

test('first start redirects to setup, then creates admin', async () => {
  let res = await app.inject({ url: '/studio' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/setup');
  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
  res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'denis', displayName: 'Denis', password: 'long-enough-1', setupCode: 'wrong' } });
  assert.equal(res.statusCode, 403, 'setup needs the one-time code');
  res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'denis', displayName: 'Denis', password: 'short', setupCode } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'denis', displayName: 'Denis', password: 'long-enough-1', setupCode } });
  assert.equal(res.statusCode, 302);
  adminCookie = cookieOf(res);
  assert.match(adminCookie, /^dz_session=/);
  res = await app.inject({ url: '/setup' });
  assert.equal(res.headers.location, '/login', 'setup is closed once a user exists');
});

test('anonymous access is blocked', async () => {
  let res = await app.inject({ url: '/studio/video' });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /^\/login\?next=/);
  res = await app.inject({ url: '/api/v1/nano-banana-pro', method: 'POST', payload: {} });
  assert.equal(res.statusCode, 401);
});

test('signed-in user reaches the studio; cookies and keys are not forwarded', async () => {
  const res = await app.inject({ url: '/studio', headers: { cookie: adminCookie, 'x-api-key': 'legacy-xyz' } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.upstream, true);
  assert.equal(body.sawCookie, false);
  assert.equal(body.sawKey, false);
});

test('legacy upstream routes are disabled; models without a provider are refused', async () => {
  let res = await app.inject({ url: '/api/workflow/get-workflow-defs', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 410);
  res = await app.inject({ url: '/api/v1/nano-banana-pro', method: 'POST', payload: {}, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 404);
});

test('login flow and wrong password', async () => {
  let res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'denis', password: 'nope-nope' } });
  assert.equal(res.statusCode, 401);
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'DENIS', password: 'long-enough-1', next: '/studio/video' } });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/studio/video');
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'denis', password: 'long-enough-1', next: '//evil.com' } });
  assert.equal(res.headers.location, '/library/studio');
});

test('admin creates a user; user cannot see keys or admin settings', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/api/settings/people', headers: { cookie: adminCookie },
    payload: { username: 'daughter', name: 'Daughter', password: 'kid-password-1', role: 'user', limit: '5' } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'daughter', password: 'kid-password-1' } });
  const userCookie = cookieOf(res);
  res = await app.inject({ url: '/dz/api/me', headers: { cookie: userCookie } });
  assert.deepEqual(res.json().user, { id: 2, username: 'daughter', displayName: 'Daughter', role: 'user', monthlyLimitUsd: 5, budget: { limit: 5, spent: 0, left: 5 } });
  res = await app.inject({ url: '/dz/api/settings/account', headers: { cookie: userCookie } });
  assert.deepEqual(res.json(), { user: { id: 2, name: 'Daughter', username: 'daughter', role: 'user', owner: false }, spent: 0, limit: 5 });
  // The "This server" pages send a non-admin to their account; the JSON refuses.
  res = await app.inject({ url: '/settings/providers', headers: { cookie: userCookie } });
  assert.equal(res.headers.location, '/settings/account');
  res = await app.inject({ url: '/settings/account', headers: { cookie: userCookie } });
  assert.equal(res.json().upstream, true);
  for (const url of ['/dz/api/settings/providers', '/dz/api/settings/models', '/dz/api/settings/changes', '/dz/api/settings/people']) {
    res = await app.inject({ url, headers: { cookie: userCookie } });
    assert.equal(res.statusCode, 403, url);
  }
  res = await app.inject({ method: 'POST', url: '/dz/api/settings/providers/atlas', headers: { cookie: userCookie }, payload: { apiKey: 'x' } });
  assert.equal(res.statusCode, 403);
  res = await app.inject({ url: '/dz/api/settings/text', headers: { cookie: userCookie } });
  assert.equal(res.json().sources, undefined);
  res = await app.inject({ url: '/dz/api/balances', headers: { cookie: userCookie } });
  assert.deepEqual(res.json(), { balances: [] });
});

test('settings never send a full key; a key that fails the check is not saved', async () => {
  let res = await app.inject({ url: '/dz/api/settings/providers', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('env-key-1234'));
  const atlas = res.json().providers.find((p) => p.id === 'atlas');
  assert.equal(atlas.keyMask, '••••1234');
  assert.equal(atlas.keySource, 'env');
  assert.deepEqual(atlas.test, { model: 'FLUX.1 schnell', price: 'about $0.003' });
  // The check cannot pass here (no provider): the old key stays.
  res = await app.inject({ method: 'POST', url: '/dz/api/settings/providers/atlas', headers: { cookie: adminCookie }, payload: { apiKey: 'new-key-9999', enabled: true } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().kept, true);
  assert.match(res.json().error, /Atlas Cloud did not accept this key/);
  res = await app.inject({ url: '/dz/api/settings/providers', headers: { cookie: adminCookie } });
  assert.equal(res.json().providers.find((p) => p.id === 'atlas').keyMask, '••••1234');
});

test('Enabled alone keeps the proxy and the key', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/api/settings/providers/apimart', headers: { cookie: adminCookie }, payload: { proxy: 'socks5h://127.0.0.1:1080', enabled: true } });
  assert.equal(res.statusCode, 200); // no key: nothing to check
  res = await app.inject({ method: 'POST', url: '/dz/api/settings/providers/apimart/enabled', headers: { cookie: adminCookie }, payload: { enabled: false } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().provider.enabled, false);
  assert.equal(res.json().provider.proxy, 'socks5h://127.0.0.1:1080');
  res = await app.inject({ method: 'POST', url: '/dz/api/settings/providers/apimart', headers: { cookie: adminCookie }, payload: { proxy: '', enabled: true } });
  assert.equal(res.json().provider.proxy, '');
});

test('the old settings address goes to the account section', async () => {
  const res = await app.inject({ url: '/dz/settings?notice=llm', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/settings/account');
});

test('bad proxy is rejected; cross-origin POST is blocked', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/api/settings/providers/atlas', headers: { cookie: adminCookie }, payload: { proxy: 'ftp://x', enabled: true } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/dz/api/settings/people', headers: { cookie: adminCookie, origin: 'https://evil.com', host: 'director.zabelin.design' }, payload: {} });
  assert.equal(res.statusCode, 403);
});

test('the owner stays an active admin and cannot be deleted', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/api/settings/people/1', headers: { cookie: adminCookie }, payload: { name: 'Denis', role: 'user' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /owner/);
  res = await app.inject({ url: '/dz/api/settings/people', headers: { cookie: adminCookie } });
  assert.equal(res.json().people.find((p) => p.id === 1).owner, true);
  res = await app.inject({ method: 'DELETE', url: '/dz/api/settings/people/1', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 400);
});

test('people: edit, block, delete (soft) — the deleted person cannot sign in and the login is free again', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/api/settings/people', headers: { cookie: adminCookie }, payload: { username: 'temp', name: 'Temp', password: 'temp-pass-123', role: 'admin' } });
  assert.equal(res.statusCode, 200);
  const id = (await app.inject({ url: '/dz/api/settings/people', headers: { cookie: adminCookie } })).json().people.find((p) => p.username === 'temp').id;
  res = await app.inject({ method: 'POST', url: `/dz/api/settings/people/${id}`, headers: { cookie: adminCookie }, payload: { name: 'Temp Two', role: 'user', limit: '7' } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'temp', password: 'temp-pass-123' } });
  const tempCookie = cookieOf(res);
  res = await app.inject({ method: 'POST', url: `/dz/api/settings/people/${id}/block`, headers: { cookie: adminCookie }, payload: { blocked: true } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ url: '/dz/api/me', headers: { cookie: tempCookie } });
  assert.equal(res.statusCode, 401, 'blocking signs them out');
  let person = (await app.inject({ url: '/dz/api/settings/people', headers: { cookie: adminCookie } })).json().people.find((p) => p.id === id);
  assert.deepEqual([person.name, person.role, person.limit, person.blocked], ['Temp Two', 'user', 7, true]);
  res = await app.inject({ method: 'DELETE', url: `/dz/api/settings/people/${id}`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  person = (await app.inject({ url: '/dz/api/settings/people', headers: { cookie: adminCookie } })).json().people.find((p) => p.id === id);
  assert.equal(person, undefined);
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'temp', password: 'temp-pass-123' } });
  assert.equal(res.statusCode, 401);
  res = await app.inject({ method: 'POST', url: '/dz/api/settings/people', headers: { cookie: adminCookie }, payload: { username: 'temp', name: 'Temp again', password: 'temp-pass-456' } });
  assert.equal(res.statusCode, 200, 'the login is free again');
  res = await app.inject({ method: 'DELETE', url: '/dz/api/settings/people/1', headers: { cookie: adminCookie } });
  assert.match(res.json().error, /your own|owner/);
});

test('provider changes: pages of entries; the first page marks them seen', async () => {
  const res = await app.inject({ url: '/dz/api/settings/changes?offset=0&limit=50', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.entries));
  assert.equal(typeof body.total, 'number');
  assert.equal(typeof body.summary.unseen, 'number');
  assert.equal(body.telegram, false);
});

test('recommended models: admin edits the list, users cannot', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/api/settings/models', headers: { cookie: adminCookie }, payload: { action: 'remove', key: 'dz-kling-4' } });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.json().recommended.includes('dz-kling-4'));
  assert.ok(res.json().recommended.includes('dz-nano-banana-pro'));
  res = await app.inject({ method: 'POST', url: '/dz/api/settings/models', headers: { cookie: adminCookie }, payload: { action: 'add', key: 'dz-not-a-model' } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/dz/api/settings/models', headers: { cookie: adminCookie }, payload: { action: 'reset' } });
  assert.ok(res.json().recommended.includes('dz-kling-4'));
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'daughter', password: 'kid-password-1' } });
  res = await app.inject({ method: 'POST', url: '/dz/api/settings/models', headers: { cookie: cookieOf(res) }, payload: { action: 'reset' } });
  assert.equal(res.statusCode, 403);
});

test('security headers: strict CSP on pages, sandbox on media', async () => {
  const res = await app.inject({ url: '/login' });
  assert.match(res.headers['content-security-policy'], /connect-src 'self'/);
  assert.match(res.headers['content-security-policy'], /img-src 'self' data: blob:/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
});

test('login throttle cannot be bypassed with a forged X-Forwarded-For', async () => {
  for (let i = 0; i < 10; i += 1) {
    await app.inject({ method: 'POST', url: '/login', remoteAddress: '192.168.8.50', headers: { 'x-forwarded-for': `1.2.3.${i}` }, payload: { username: 'denis', password: 'bad-password' } });
  }
  const res = await app.inject({ method: 'POST', url: '/login', remoteAddress: '192.168.8.50', headers: { 'x-forwarded-for': '9.9.9.9' }, payload: { username: 'denis', password: 'long-enough-1' } });
  assert.equal(res.statusCode, 429);
});

test('cross-site sign-in is refused (login CSRF)', async () => {
  const res = await app.inject({ method: 'POST', url: '/login', headers: { origin: 'https://evil.example', host: 'director.zabelin.design' }, payload: { username: 'denis', password: 'long-enough-1' } });
  assert.equal(res.statusCode, 403);
});

test('the studio API lives at /api/v1; legacy /api/api/v1 is refused', async () => {
  let res = await app.inject({ url: '/api/v1/history', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ url: '/api/api/v1/history', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 410);
});

test('product icons are public (package 11): favicon, apple touch icon, manifest', async () => {
  let res = await app.inject({ url: '/favicon.ico' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/x-icon');
  assert.equal(res.headers['cache-control'], 'public, max-age=86400');
  res = await app.inject({ url: '/dz/brand/favicon.svg?v=1' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<svg/);
  assert.match(res.headers['cache-control'], /immutable/);
  res = await app.inject({ url: '/apple-touch-icon.png' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  res = await app.inject({ url: '/manifest.webmanifest?v=1' });
  assert.equal(res.statusCode, 200);
  const m = res.json();
  assert.equal(m.name, 'Director');
  assert.deepEqual(m.icons.map((i) => i.sizes), ['192x192', '512x512']);
  res = await app.inject({ url: '/dz/brand/../app.js' });
  assert.notEqual(res.statusCode, 200);
  res = await app.inject({ url: '/dz/brand/secret.txt' });
  assert.notEqual(res.statusCode, 200);
  res = await app.inject({ url: '/login' });
  assert.match(res.body, /rel="icon" href="\/dz\/brand\/favicon\.svg\?v=1"/);
});

test('a proxy with a password: shown masked, kept when the masked value comes back', async () => {
  const { createProviderSettings } = await import('../src/providers/index.js');
  const { openDatabase } = await import('../src/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwp-'));
  const db = openDatabase(dir);
  const settings = createProviderSettings({ db, masterKey: Buffer.alloc(32, 3), envDefaults: { atlas: { apiKey: '', proxy: '' } } });
  settings.save('atlas', { apiKey: 'k-1234', proxy: 'socks5h://bob:s3cret@10.0.0.1:1080', enabled: true });
  const view = settings.publicView('atlas');
  assert.equal(view.proxy, 'socks5h://bob:••••@10.0.0.1:1080');
  settings.save('atlas', { proxy: view.proxy, enabled: true });
  assert.equal(settings.resolve('atlas').proxy, 'socks5h://bob:s3cret@10.0.0.1:1080');
  settings.save('atlas', { proxy: 'socks5h://bob:%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2@10.0.0.1:1080', enabled: true });
  assert.equal(settings.resolve('atlas').proxy, 'socks5h://bob:s3cret@10.0.0.1:1080');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('people: a bad new password changes nothing; a deleted owner of a project hands it to the server owner', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/api/settings/people', headers: { cookie: adminCookie }, payload: { username: 'pm', name: 'PM', password: 'pm-pass-1234' } });
  const id = (await app.inject({ url: '/dz/api/settings/people', headers: { cookie: adminCookie } })).json().people.find((p) => p.username === 'pm').id;
  res = await app.inject({ method: 'POST', url: `/dz/api/settings/people/${id}`, headers: { cookie: adminCookie }, payload: { name: 'PM', role: 'admin', limit: '', newPassword: 'short' } });
  assert.equal(res.statusCode, 400);
  const pm = (await app.inject({ url: '/dz/api/settings/people', headers: { cookie: adminCookie } })).json().people.find((p) => p.id === id);
  assert.equal(pm.role, 'user', 'nothing saved');
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'pm', password: 'pm-pass-1234' } });
  const pmCookie = cookieOf(res);
  res = await app.inject({ method: 'POST', url: '/dz/api/projects', headers: { cookie: pmCookie }, payload: { name: 'PM project' } });
  assert.equal(res.statusCode, 200, res.body);
  const projectId = res.json().project.id;
  res = await app.inject({ method: 'DELETE', url: `/dz/api/settings/people/${id}`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200, res.body);
  const db = app.ctx.db;
  assert.equal(db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(projectId).owner_id, 1);
  assert.equal(db.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = 1").get(projectId).role, 'owner');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE user_id = ?').get(id).n, 0);
});

test('a proxy from .env with a password: the masked value coming back keeps it', async () => {
  const { createProviderSettings } = await import('../src/providers/index.js');
  const { openDatabase } = await import('../src/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwp-'));
  const db = openDatabase(dir);
  const settings = createProviderSettings({ db, masterKey: Buffer.alloc(32, 3), envDefaults: { apimart: { apiKey: 'env-k', proxy: 'socks5h://al:pw@10.0.0.2:1080' } } });
  const view = settings.publicView('apimart');
  assert.equal(view.proxy, 'socks5h://al:••••@10.0.0.2:1080');
  settings.save('apimart', { proxy: view.proxy, enabled: false });
  assert.equal(settings.resolve('apimart').proxy, 'socks5h://al:pw@10.0.0.2:1080');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
