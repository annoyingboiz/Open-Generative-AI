import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { apimart } from '../src/providers/apimart.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let files;
let app;
let dataDir;
let adminCookie;
let userCookie;
const calls = { submit: [], upload: [] };
const original = { submit: apimart.submit, poll: apimart.poll, upload: apimart.upload };

const cookieOf = (res) => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw[0] : raw).split(';')[0];
};

function multipart(field, filename, mime, data) {
  const boundary = '----dz' + Date.now();
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

before(async () => {
  files = http.createServer((req, res) => { res.setHeader('content-type', 'image/png'); res.end(PNG); });
  await new Promise((r) => files.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${files.address().port}/out.png`;

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-gen-'));
  fs.mkdirSync(path.join(dataDir, 'catalog'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'catalog', 'apimart-models.json'), JSON.stringify({
    fetchedAt: Date.now(), list: [{ id: 'test-image', category: 'image' }, { id: 'chat-model', category: 'chat' }],
  }));

  let polls = 0;
  apimart.submit = async (cfg, req) => { calls.submit.push({ cfg, req }); return { taskId: 'task_1' }; };
  apimart.poll = async () => (++polls < 2 ? { state: 'processing' } : { state: 'completed', outputs: [fileUrl], costUsd: 0.02 });
  apimart.upload = async (cfg, f) => { calls.upload.push(f); return { url: 'https://cdn.apimart.example/ref.png', expiresAt: Date.now() + 86_400_000 }; };

  app = await buildApp({
    host: '127.0.0.1', port: 0, studioUrl: 'http://127.0.0.1:9', dataDir, appSecret: 'test', sessionDays: 30, logLevel: 'error',
    startWorkers: false,
    providerEnv: { apimart: { apiKey: 'sk-test', proxy: '' }, atlas: { apiKey: '', proxy: '' } },
  }, { logger: false });
  await app.ready();

  let res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'admin', displayName: 'Admin', password: 'admin-pass-1' } });
  adminCookie = cookieOf(res);
  await app.inject({ method: 'POST', url: '/dz/settings/users', headers: { cookie: adminCookie }, payload: { username: 'kid', displayName: 'Kid', password: 'kid-pass-12', monthlyLimitUsd: '0.01' } });
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'kid', password: 'kid-pass-12' } });
  userCookie = cookieOf(res);
});

after(async () => {
  Object.assign(apimart, original);
  await app.close();
  files.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let uploadUrl;
let genId;

test('upload a reference image; non-media is refused', async () => {
  const mp = multipart('file', 'ref.png', 'image/png', PNG);
  let res = await app.inject({ method: 'POST', url: '/api/v1/upload_file', headers: { cookie: adminCookie, ...mp.headers }, payload: mp.payload });
  assert.equal(res.statusCode, 200, res.body);
  uploadUrl = res.json().url;
  assert.match(uploadUrl, /^\/media\/u\/up_[\w-]+\.png$/);
  const bad = multipart('file', 'x.html', 'text/html', Buffer.from('<script>'));
  res = await app.inject({ method: 'POST', url: '/api/v1/upload_file', headers: { cookie: adminCookie, ...bad.headers }, payload: bad.payload });
  assert.equal(res.statusCode, 400);
});

test('submit replaces our media links with provider uploads', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/p/apimart/test-image', headers: { cookie: adminCookie },
    payload: { prompt: 'a cat', image_urls: [`https://director.example${uploadUrl}`], size: '1:1' } });
  assert.equal(res.statusCode, 200, res.body);
  genId = res.json().request_id;
  assert.match(genId, /^gen_/);
  const sent = calls.submit.at(-1);
  assert.equal(sent.cfg.apiKey, 'sk-test');
  assert.deepEqual(sent.req, { kind: 'image', model: 'test-image', body: { prompt: 'a cat', image_urls: ['https://cdn.apimart.example/ref.png'], size: '1:1' } });
  assert.equal(calls.upload.length, 1);
});

test('unknown model and non-media model are refused', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/v1/p/apimart/nope', headers: { cookie: adminCookie }, payload: { prompt: 'x' } });
  assert.equal(res.statusCode, 404);
  res = await app.inject({ method: 'POST', url: '/api/v1/p/apimart/chat-model', headers: { cookie: adminCookie }, payload: { prompt: 'x' } });
  assert.equal(res.statusCode, 404);
  res = await app.inject({ method: 'POST', url: '/api/v1/nano-banana-pro', headers: { cookie: adminCookie }, payload: { prompt: 'x' } });
  assert.equal(res.statusCode, 404);
});

test('server polls, downloads the result, and serves it to the owner only', async () => {
  let res = await app.inject({ url: `/api/v1/predictions/${genId}/result`, headers: { cookie: adminCookie } });
  assert.equal(res.json().status, 'processing');
  // Make the job due and run the worker twice (processing → completed).
  app.ctx.db.prepare('UPDATE generations SET next_poll_at = 0').run();
  await app.ctx.generations.tick();
  app.ctx.db.prepare('UPDATE generations SET next_poll_at = 0').run();
  await app.ctx.generations.tick();
  res = await app.inject({ url: `/api/v1/predictions/${genId}/result`, headers: { cookie: adminCookie } });
  const body = res.json();
  assert.equal(body.status, 'completed', JSON.stringify(body));
  assert.equal(body.cost, 0.02);
  assert.match(body.outputs[0], new RegExp(`^/media/g/${genId}/0\\.png$`));
  res = await app.inject({ url: body.outputs[0], headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.deepEqual(res.rawPayload, PNG);
  res = await app.inject({ url: body.outputs[0], headers: { cookie: adminCookie, range: 'bytes=0-3' } });
  assert.equal(res.statusCode, 206);
  assert.equal(res.rawPayload.length, 4);
  res = await app.inject({ url: body.outputs[0], headers: { cookie: userCookie } });
  assert.equal(res.statusCode, 404, 'other users cannot open it');
  res = await app.inject({ url: `/api/v1/predictions/${genId}/result`, headers: { cookie: userCookie } });
  assert.equal(res.statusCode, 404);
});

test('history is per user; trash hides an item', async () => {
  let res = await app.inject({ url: '/api/v1/history', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 1);
  assert.equal(res.json().items[0].provider, 'apimart');
  res = await app.inject({ url: '/api/v1/history', headers: { cookie: userCookie } });
  assert.equal(res.json().items.length, 0);
  res = await app.inject({ method: 'DELETE', url: `/api/v1/predictions/${genId}/media`, headers: { cookie: userCookie } });
  assert.equal(res.statusCode, 404, 'cannot delete someone else\'s');
  res = await app.inject({ method: 'DELETE', url: `/api/v1/predictions/${genId}/media`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ url: '/api/v1/history', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 0);
});

test('monthly limit stops generation', async () => {
  // Kid's limit is $0.01; a previous paid job brings them over.
  app.ctx.db.prepare("INSERT INTO generations (id, user_id, endpoint, provider, provider_model, kind, status, cost_usd, created_at, updated_at) VALUES ('gen_old', 2, 'x', 'apimart', 'test-image', 'image', 'completed', 0.02, ?, ?)").run(Date.now(), Date.now());
  const res = await app.inject({ method: 'POST', url: '/api/v1/p/apimart/test-image', headers: { cookie: userCookie }, payload: { prompt: 'x' } });
  assert.equal(res.statusCode, 402);
  assert.match(res.json().detail, /Monthly limit/);
});
