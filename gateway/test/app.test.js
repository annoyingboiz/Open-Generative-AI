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

test('admin creates a user; user cannot see keys or admin pages', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/settings/users', headers: { cookie: adminCookie },
    payload: { username: 'daughter', displayName: 'Daughter', password: 'kid-password-1', role: 'user', monthlyLimitUsd: '5' } });
  assert.equal(res.statusCode, 302);
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'daughter', password: 'kid-password-1' } });
  const userCookie = cookieOf(res);
  res = await app.inject({ url: '/dz/api/me', headers: { cookie: userCookie } });
  assert.deepEqual(res.json().user, { id: 2, username: 'daughter', displayName: 'Daughter', role: 'user', monthlyLimitUsd: 5, budget: { limit: 5, spent: 0, left: 5 } });
  res = await app.inject({ url: '/settings', headers: { cookie: userCookie } });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('Providers'), 'no provider section for users');
  res = await app.inject({ method: 'POST', url: '/dz/settings/providers/atlas', headers: { cookie: userCookie }, payload: { apiKey: 'x' } });
  assert.equal(res.statusCode, 403);
  res = await app.inject({ url: '/dz/api/balances', headers: { cookie: userCookie } });
  assert.deepEqual(res.json(), { balances: [] });
});

test('settings page never prints a full key', async () => {
  const res = await app.inject({ url: '/settings', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('env-key-1234'));
  assert.ok(res.body.includes('••••1234'));
});

test('settings moved to /settings/<section>; the old address redirects', async () => {
  let res = await app.inject({ url: '/dz/settings?notice=llm', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/settings?notice=llm');
  res = await app.inject({ url: '/settings/providers', headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('getElementById("providers")'));
  res = await app.inject({ url: '/settings/nope', headers: { cookie: adminCookie } });
  assert.equal(res.headers.location, '/settings');
});

test('bad proxy is rejected; cross-origin POST is blocked', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/settings/providers/atlas', headers: { cookie: adminCookie }, payload: { proxy: 'ftp://x', enabled: '1' } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/dz/settings/users', headers: { cookie: adminCookie, origin: 'https://evil.com', host: 'director.zabelin.design' }, payload: {} });
  assert.equal(res.statusCode, 403);
});

test('last admin cannot be demoted', async () => {
  const res = await app.inject({ method: 'POST', url: '/dz/settings/users/1', headers: { cookie: adminCookie }, payload: { role: 'user' } });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.includes('At least one active admin'));
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

test('recommended models: admin edits the list, users cannot', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/settings/recommended', headers: { cookie: adminCookie }, payload: { action: 'remove', key: 'dz-kling-4' } });
  assert.equal(res.statusCode, 302);
  res = await app.inject({ url: '/settings', headers: { cookie: adminCookie } });
  assert.ok(res.body.includes('Recommended models'));
  assert.ok(!res.body.includes('>dz-kling-4<'));
  assert.ok(res.body.includes('dz-nano-banana-pro'));
  res = await app.inject({ method: 'POST', url: '/dz/settings/recommended', headers: { cookie: adminCookie }, payload: { action: 'add', key: 'dz-not-a-model' } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/dz/settings/recommended', headers: { cookie: adminCookie }, payload: { action: 'reset' } });
  assert.equal(res.statusCode, 302);
  res = await app.inject({ url: '/settings', headers: { cookie: adminCookie } });
  assert.ok(res.body.includes('dz-kling-4'));
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'daughter', password: 'kid-password-1' } });
  res = await app.inject({ method: 'POST', url: '/dz/settings/recommended', headers: { cookie: cookieOf(res) }, payload: { action: 'reset' } });
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

test('location view request: never generates, refuses pictures that are not ours', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/api/location-view/request', headers: { cookie: adminCookie }, payload: { url: 'https://evil.example/x.jpg', shot: 'waist' } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/dz/api/location-view/request', headers: { cookie: adminCookie }, payload: { url: '/media/g/gen_none/0.jpg', shot: 'waist' } });
  assert.equal(res.statusCode, 400);
});
