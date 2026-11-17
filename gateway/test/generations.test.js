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
const calls = { submit: [], upload: [], quote: [] };
const original = { submit: apimart.submit, poll: apimart.poll, upload: apimart.upload, quote: apimart.quote, actualCost: apimart.actualCost };
let nextQuote = null;

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
    fetchedAt: Date.now(), list: [{ id: 'test-image', category: 'image', capability_tags: ['Text to Image'] }, { id: 'chat-model', category: 'chat' }],
  }));

  let polls = 0;
  apimart.submit = async (cfg, req) => { calls.submit.push({ cfg, req }); return { taskId: 'task_1' }; };
  apimart.poll = async () => (++polls < 2 ? { state: 'processing' } : { state: 'completed', outputs: [fileUrl], costUsd: 0.02 });
  apimart.quote = async (cfg, req) => { calls.quote.push(req); return nextQuote; };
  apimart.actualCost = async () => 0.031;
  apimart.upload = async (cfg, f) => { calls.upload.push(f); return { url: 'https://cdn.apimart.example/ref.png', expiresAt: Date.now() + 86_400_000 }; };

  app = await buildApp({
    host: '127.0.0.1', port: 0, studioUrl: 'http://127.0.0.1:9', dataDir, appSecret: 'test', sessionDays: 30, logLevel: 'error',
    startWorkers: false, testAllowLocalDownloads: true,
    providerEnv: { apimart: { apiKey: 'sk-test', proxy: '' }, atlas: { apiKey: '', proxy: '' } },
  }, { logger: false });
  await app.ready();

  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
  let res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'admin', displayName: 'Admin', password: 'admin-pass-1', setupCode } });
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
  app.ctx.db.prepare('UPDATE generations SET settle_next_at = 0 WHERE settle_next_at IS NOT NULL').run();
  await app.ctx.generations.tick();
  res = await app.inject({ url: `/api/v1/predictions/${genId}/result`, headers: { cookie: adminCookie } });
  assert.equal(res.json().cost, 0.031, 'actual charge from the provider replaces the task cost');
  assert.equal(res.json().cost_final, true);
  assert.equal(app.ctx.db.prepare('SELECT cost_source FROM generations WHERE id = ?').get(genId).cost_source, 'provider');
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
  // The trash lists it; restore brings it back.
  res = await app.inject({ url: '/api/v1/history?trash=1', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 1);
  assert.ok(res.json().items[0].deleted_at);
  res = await app.inject({ method: 'POST', url: `/api/v1/predictions/${genId}/restore`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ url: '/api/v1/history', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 1);
});

test('library: studio and its settings are stored, not sent; likes; delete for good only from the trash', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/v1/p/apimart/test-image', headers: { cookie: adminCookie },
    payload: { prompt: 'a dog', size: '1:1', _dz: { studio: 'cinema', meta: { camera: 'Alexa 35', lens: '50mm' } } } });
  assert.equal(res.statusCode, 200, res.body);
  const id = res.json().request_id;
  assert.deepEqual(calls.submit.at(-1).req.body, { prompt: 'a dog', size: '1:1' }, '_dz never reaches the provider');
  res = await app.inject({ url: '/api/v1/history?studio=cinema', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 1);
  assert.deepEqual(res.json().items[0].meta, { camera: 'Alexa 35', lens: '50mm' });
  assert.equal(res.json().items[0].studio, 'cinema');
  res = await app.inject({ url: '/api/v1/history?studio=image', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 0);
  res = await app.inject({ url: '/api/v1/history?studio=other', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 1, 'items without a studio');
  res = await app.inject({ url: '/api/v1/history?status=processing', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 1);

  res = await app.inject({ method: 'POST', url: `/api/v1/predictions/${id}/like`, headers: { cookie: userCookie }, payload: { liked: true } });
  assert.equal(res.statusCode, 404, 'only the owner');
  res = await app.inject({ method: 'POST', url: `/api/v1/predictions/${id}/like`, headers: { cookie: adminCookie }, payload: { liked: true } });
  assert.equal(res.json().liked, true);
  res = await app.inject({ url: '/api/v1/history?liked=1', headers: { cookie: adminCookie } });
  assert.deepEqual(res.json().items.map((i) => i.id), [id]);
  await app.inject({ method: 'POST', url: `/api/v1/predictions/${id}/like`, headers: { cookie: adminCookie }, payload: { liked: false } });
  res = await app.inject({ url: '/api/v1/history?liked=1', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 0);

  res = await app.inject({ method: 'DELETE', url: `/api/v1/predictions/${id}`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 409, 'trash first');
  await app.inject({ method: 'DELETE', url: `/api/v1/predictions/${id}/media`, headers: { cookie: adminCookie } });
  res = await app.inject({ method: 'DELETE', url: `/api/v1/predictions/${id}`, headers: { cookie: userCookie } });
  assert.equal(res.statusCode, 404);
  res = await app.inject({ method: 'DELETE', url: `/api/v1/predictions/${id}`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 409, 'not while it is still running');
  app.ctx.db.prepare("UPDATE generations SET status = 'completed', cost_usd = 0.5 WHERE id = ?").run(id);
  res = await app.inject({ method: 'DELETE', url: `/api/v1/predictions/${id}`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 200, res.body);
  res = await app.inject({ url: '/api/v1/history?trash=1', headers: { cookie: adminCookie } });
  assert.equal(res.json().items.length, 0);
  // The row stays as a tombstone, so its cost still counts.
  const row = app.ctx.db.prepare('SELECT purged_at, cost_usd, outputs_json FROM generations WHERE id = ?').get(id);
  assert.ok(row.purged_at);
  assert.equal(row.cost_usd, 0.5);
  res = await app.inject({ method: 'POST', url: `/api/v1/predictions/${id}/restore`, headers: { cookie: adminCookie } });
  assert.equal(res.statusCode, 404, 'deleted for good cannot come back');
  res = await app.inject({ url: '/api/v1/history?limit=-1', headers: { cookie: adminCookie } });
  assert.ok(res.json().items.length <= 1, 'limit is clamped');
});

test('monthly limit stops generation', async () => {
  // Kid's limit is $0.01; a previous paid job brings them over.
  app.ctx.db.prepare("INSERT INTO generations (id, user_id, endpoint, provider, provider_model, kind, status, cost_usd, created_at, updated_at) VALUES ('gen_old', 2, 'x', 'apimart', 'test-image', 'image', 'completed', 0.02, ?, ?)").run(Date.now(), Date.now());
  let res = await app.inject({ method: 'POST', url: '/api/v1/p/apimart/test-image', headers: { cookie: userCookie }, payload: { prompt: 'x' } });
  assert.equal(res.statusCode, 404, 'non-admins cannot bypass the catalog');
  res = await app.inject({ method: 'POST', url: '/api/v1/p/apimart/test-image?m=t2i', headers: { cookie: userCookie }, payload: { prompt: 'x' } });
  assert.equal(res.statusCode, 402, 'unpriced model is not allowed with a limit');
  // With a price, the limit itself applies.
  const variant = app.ctx.catalog.variant('p/apimart/test-image?m=t2i');
  variant.server.price = { usd: 0.02, unit: 'image' };
  res = await app.inject({ method: 'POST', url: '/api/v1/p/apimart/test-image?m=t2i', headers: { cookie: userCookie }, payload: { prompt: 'x' } });
  assert.equal(res.statusCode, 402);
  assert.match(res.json().detail, /Monthly limit/);
});

test('quote: provider price for our account, media replaced by placeholders, limit uses it', async () => {
  nextQuote = { usd: 0.05, exact: true };
  let res = await app.inject({ method: 'POST', url: '/dz/api/quote', headers: { cookie: userCookie },
    payload: { endpoint: 'p/apimart/test-image?m=t2i', body: { prompt: 'x', image_urls: ['/media/u/up_abc.png'] } } });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().price, { usd: 0.05, exact: true, source: 'quote' });
  assert.equal(calls.quote.at(-1).model, 'test-image');
  res = await app.inject({ method: 'POST', url: '/dz/api/quote', headers: { cookie: userCookie }, payload: { endpoint: 'p/apimart/test-image', body: {} } });
  assert.equal(res.statusCode, 404, 'outside the catalog only for admins');
  res = await app.inject({ method: 'POST', url: '/dz/api/quote', headers: { cookie: userCookie }, payload: { endpoint: 'https://evil/x', body: {} } });
  assert.equal(res.statusCode, 400);
  // The kid is over the $0.01 limit; the quoted price is what the check uses.
  res = await app.inject({ method: 'POST', url: '/api/v1/p/apimart/test-image?m=t2i', headers: { cookie: userCookie }, payload: { prompt: 'y' } });
  assert.equal(res.statusCode, 402);
  assert.match(res.json().detail, /Monthly limit/);
  nextQuote = null;
});
