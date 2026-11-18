import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';

// A fake h3-bridge on a unix socket in a temp folder.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let app;
let dataDir;
let bridgeDir;
let bridge;
const jobs = new Map();
const received = [];
const cookies = {};
const cookieOf = (res) => { const raw = res.headers['set-cookie']; return (Array.isArray(raw) ? raw[0] : raw).split(';')[0]; };
const as = (who, method, url, payload, headers = {}) => app.inject({ method, url, headers: { cookie: cookies[who], ...headers }, ...(payload !== undefined ? { payload } : {}) });

function multipart(filename, mime, data) {
  const boundary = '----dz' + Date.now();
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-local-'));
  bridgeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-bridge-'));
  bridge = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.method === 'POST' && req.url === '/jobs') {
        const j = JSON.parse(body);
        received.push(j);
        jobs.set(j.id, { id: j.id, state: 'waiting', reason: 'Meetbot is processing a meeting', position: 1 });
        return send(200, jobs.get(j.id));
      }
      const m = /^\/jobs\/([^/]+)(\/cancel)?$/.exec(req.url);
      if (m && jobs.has(m[1])) {
        if (m[2]) jobs.set(m[1], { ...jobs.get(m[1]), state: 'cancelled' });
        return send(200, jobs.get(m[1]));
      }
      if (req.url === '/status') return send(200, { ok: true, comfy: true, jobs: [...jobs.values()] });
      return send(404, { error: 'No such job.' });
    });
  });
  await new Promise((r) => bridge.listen(path.join(bridgeDir, 'bridge.sock'), r));
  app = await buildApp({
    host: '127.0.0.1', port: 0, studioUrl: 'http://127.0.0.1:9', dataDir, appSecret: 'test', sessionDays: 30, logLevel: 'error',
    startWorkers: false, localBridgeDir: bridgeDir,
    providerEnv: { apimart: { apiKey: '', proxy: '' }, atlas: { apiKey: '', proxy: '' } },
  }, { logger: false });
  await app.ready();
  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
  let res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'admin', displayName: 'Admin', password: 'admin-pass-1', setupCode } });
  cookies.admin = cookieOf(res);
  await as('admin', 'POST', '/dz/settings/users', { username: 'wife', displayName: 'wife', password: 'wife-pass-123' });
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'wife', password: 'wife-pass-123' } });
  cookies.wife = cookieOf(res);
});

after(async () => {
  await app.close();
  bridge.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(bridgeDir, { recursive: true, force: true });
});

test('this server\'s models are listed for admins only, free, with <Picture N> references', async () => {
  let res = await as('admin', 'GET', '/dz/catalog.js');
  const adminLists = JSON.parse(/__DZ_CATALOG__=(.*);\n$/s.exec(res.body)[1]).lists;
  const local = Object.values(adminLists).flat().filter((m) => m.dzProvider === 'local');
  assert.deepEqual([...new Set(local.map((m) => m.dzFamily))].sort(), ['dz-minimax-h-3', 'dz-wan-2.2']);
  const refs = local.find((m) => m.endpoint === 'p/local/minimax-h3-r2v?m=i2v');
  assert.equal(refs.dzRefSyntax, 'PictureN');
  assert.equal(refs.inputs.reference_images.maxItems, 9);
  assert.equal(refs.dzPrice.label, 'free');
  assert.equal(refs.dzProviderName, 'This server');
  res = await as('wife', 'GET', '/dz/catalog.js');
  assert.equal(res.body.includes('"local"'), false);
  // Not even by the address.
  res = await as('wife', 'POST', '/api/v1/p/local/minimax-h3-i2v?m=i2v', { prompt: 'x' });
  assert.equal(res.statusCode, 404);
  res = await as('admin', 'POST', '/dz/api/quote', { endpoint: 'p/local/wan-2.2?m=t2v', body: { prompt: 'x', resolution: '720p', duration: 5 } });
  assert.deepEqual(res.json().price, { usd: 0, exact: true, source: 'quote' });
  assert.equal((await as('wife', 'GET', '/dz/api/local/status')).statusCode, 404);
  assert.equal((await as('admin', 'GET', '/dz/api/local/status')).json().comfy, true);
});

test('a job: the picture is copied to the bridge, it waits with a reason, can be cancelled; a finished one is copied back', async () => {
  const up = multipart('frame.png', 'image/png', PNG);
  let res = await as('admin', 'POST', '/api/v1/upload_file', up.payload, up.headers);
  assert.equal(res.statusCode, 200, res.body);
  const frame = res.json().url;
  res = await as('admin', 'POST', '/api/v1/p/local/minimax-h3-i2v?m=i2v', { prompt: 'She turns.', image: frame, resolution: '720p', duration: 5, turbo: true, generate_audio: false, _dz: { studio: 'video' } });
  assert.equal(res.statusCode, 200, res.body);
  const genId = res.json().id;
  const sent = received.at(-1);
  assert.equal(sent.engine, 'h3');
  assert.equal(sent.res, '720p');
  assert.equal(sent.turbo, true);
  assert.equal(sent.sound, false);
  assert.match(sent.image, /^[A-Za-z0-9_-]+\.png$/);
  assert.ok(fs.existsSync(path.join(bridgeDir, 'in', sent.image)), 'the picture is in the bridge inbox');

  // Waiting: the reason shows on the history item, and it can be cancelled.
  app.ctx.db.prepare('UPDATE generations SET next_poll_at = 0 WHERE id = ?').run(genId);
  await app.ctx.generations.tick();
  res = await as('admin', 'GET', `/api/v1/predictions/${genId}/result`);
  let item = res.json();
  res = await as('admin', 'GET', '/api/v1/history?limit=5');
  item = res.json().items.find((x) => x.id === genId);
  assert.match(item.note, /Waiting for the GPU: Meetbot is processing a meeting/);
  assert.equal(item.cancellable, true);
  res = await as('admin', 'POST', `/api/v1/predictions/${genId}/cancel`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(jobs.get(sent.id).state, 'cancelled');
  res = await as('admin', 'GET', '/api/v1/history?limit=5');
  item = res.json().items.find((x) => x.id === genId);
  assert.equal(item.status, 'failed');
  assert.equal(item.error, 'Cancelled.');
  assert.equal(item.note, null);

  // A finished job: the clip is copied from the bridge folder into our media.
  res = await as('admin', 'POST', '/api/v1/p/local/wan-2.2?m=t2v', { prompt: 'Rain on a window.', resolution: '480p', duration: 3 });
  const gen2 = res.json().id;
  const job2 = received.at(-1);
  assert.equal(job2.engine, 'wan');
  fs.mkdirSync(path.join(bridgeDir, 'jobs', job2.id), { recursive: true });
  fs.writeFileSync(path.join(bridgeDir, 'jobs', job2.id, 'clip.mp4'), Buffer.from('fake-mp4'));
  jobs.set(job2.id, { id: job2.id, state: 'done', outputs: ['clip.mp4'] });
  app.ctx.db.prepare('UPDATE generations SET next_poll_at = 0 WHERE id = ?').run(gen2);
  await app.ctx.generations.tick();
  res = await as('admin', 'GET', '/api/v1/history?limit=5');
  item = res.json().items.find((x) => x.id === gen2);
  assert.equal(item.status, 'completed');
  assert.match(item.url, /^\/media\/g\//);
  res = await as('admin', 'GET', item.url);
  assert.equal(res.body, 'fake-mp4');
  // Another person's job can't be cancelled; nor a finished one.
  assert.equal((await as('admin', 'POST', `/api/v1/predictions/${gen2}/cancel`)).statusCode, 409);
});

test('the bridge offline: a clear message, no job', async () => {
  const offline = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-nobridge-'));
  const { configureLocal } = await import('../src/providers/local.js');
  configureLocal(offline);
  try {
    const res = await as('admin', 'POST', '/api/v1/p/local/wan-2.2?m=t2v', { prompt: 'x', resolution: '480p', duration: 3 });
    assert.equal(res.statusCode, 424);
    assert.match(res.json().detail, /offline \(h3-bridge is not running\)/);
  } finally {
    configureLocal(bridgeDir);
    fs.rmSync(offline, { recursive: true, force: true });
  }
});
