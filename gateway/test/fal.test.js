import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { fal } from '../src/providers/fal.js';
import { falBody, falPrice } from '../src/providers/fal-tools.js';
import { imageSize } from '../src/imagesize.js';

// A 2000×1000 PNG header is enough for the size reader.
function pngHeader(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

let app;
let dataDir;
let adminCookie;
let otherCookie;
let uploadUrl;
const calls = { submit: [], upload: [] };
const original = { submit: fal.submit, upload: fal.upload, poll: fal.poll };

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
  fal.submit = async (cfg, req) => { calls.submit.push({ cfg, req }); return { taskId: 'topaz/upscale/req-1' }; };
  fal.upload = async (cfg, f) => { calls.upload.push(f); return { url: 'https://v3.fal.media/files/in.png', expiresAt: Date.now() + 86_400_000 }; };
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-fal-'));
  app = await buildApp({
    host: '127.0.0.1', port: 0, studioUrl: 'http://127.0.0.1:9', dataDir, appSecret: 'test', sessionDays: 30, logLevel: 'error', startWorkers: false,
    providerEnv: { apimart: { apiKey: '', proxy: '' }, atlas: { apiKey: '', proxy: '' }, fal: { apiKey: 'fal-key', proxy: '' } },
  }, { logger: false });
  await app.ready();
  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
  let res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'admin', displayName: 'Admin', password: 'admin-pass-1', setupCode } });
  adminCookie = cookieOf(res);
  await app.inject({ method: 'POST', url: '/dz/settings/users', headers: { cookie: adminCookie }, payload: { username: 'wife', displayName: 'Wife', password: 'wife-pass-12' } });
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'wife', password: 'wife-pass-12' } });
  otherCookie = cookieOf(res);
  const mp = multipart('file', 'in.png', 'image/png', pngHeader(2000, 1000));
  res = await app.inject({ method: 'POST', url: '/api/v1/upload_file', headers: { cookie: adminCookie, ...mp.headers }, payload: mp.payload });
  uploadUrl = res.json().url;
});

after(async () => {
  Object.assign(fal, original);
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('image size from PNG, GIF and JPEG headers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sz-'));
  fs.writeFileSync(path.join(dir, 'a.png'), pngHeader(1234, 567));
  assert.deepEqual(imageSize(path.join(dir, 'a.png')), { width: 1234, height: 567 });
  const gif = Buffer.from('474946383961' + '4001' + 'f000' + '00', 'hex');
  fs.writeFileSync(path.join(dir, 'a.gif'), gif);
  assert.deepEqual(imageSize(path.join(dir, 'a.gif')), { width: 320, height: 240 });
  // SOI, APP0 (len 16), SOF0 with 480×640.
  const jpg = Buffer.concat([Buffer.from('ffd8ffe00010', 'hex'), Buffer.alloc(14), Buffer.from('ffc0001108' + '01e0' + '0280' + '03', 'hex'), Buffer.alloc(12)]);
  fs.writeFileSync(path.join(dir, 'a.jpg'), jpg);
  assert.deepEqual(imageSize(path.join(dir, 'a.jpg')), { width: 640, height: 480 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fal body keeps only fields of the chosen model, clamped', () => {
  const body = falBody('topaz/upscale/image/precision', {
    image_url: 'x', model: 'CGI', upscale_factor: 9, sharpen: 2, fix_compression: 0.5, creativity: 4, face_enhancement: 'true', output_format: 'tiff', onRequestId: 'z',
  });
  assert.deepEqual(body, { image_url: 'x', model: 'CGI', upscale_factor: 4, sharpen: 1, face_enhancement: true });
  const redefine = falBody('topaz/upscale/image/generative', { image_url: 'x', model: 'Redefine', creativity: 4.6, texture: 0, prompt: 'p'.repeat(2000) });
  assert.equal(redefine.creativity, 5);
  assert.equal(redefine.texture, 1);
  assert.equal(redefine.prompt.length, 1024);
  assert.equal(falBody('topaz/upscale/image/generative', { image_url: 'x', model: 'Nope' }).model, 'Wonder 4');
  assert.throws(() => falBody('fal-ai/flux/dev', {}));
});

test('fal price per started megapixels of output', () => {
  const input = { width: 2000, height: 1000 }; // 2 MP
  assert.deepEqual(falPrice('topaz/upscale/image/precision', { model: 'Standard V2', upscale_factor: 2 }, input), { usd: 0.08, exact: true, outputMp: 8 });
  assert.equal(falPrice('topaz/upscale/image/precision', { model: 'Standard V2', upscale_factor: 4 }, input).usd, 0.16); // 32 MP
  assert.equal(falPrice('topaz/upscale/image/generative', { model: 'Wonder 3', upscale_factor: 4 }, input).usd, 0.32); // 32/8
  assert.equal(falPrice('topaz/upscale/image/generative', { model: 'Redefine', upscale_factor: 4 }, input).usd, 0.64); // 32/4
  assert.equal(falPrice('topaz/upscale/image/generative', { model: 'Wonder 4', upscale_factor: 2 }, input).exact, false);
  assert.equal(falPrice('topaz/upscale/image/creative', { model: 'Bloom 2', upscale_factor: 2 }, input).usd, 0.32); // 8/2
  assert.equal(falPrice('topaz/upscale/image/precision', { model: 'Standard V2' }, null), null);
});

test('catalog tells the studio about the upscale tool', async () => {
  const res = await app.inject({ url: '/dz/catalog.js', headers: { cookie: adminCookie } });
  assert.match(res.body, /"upscale":\{"provider":"fal"/);
  assert.match(res.body, /topaz\/upscale\/image\/precision/);
});

test('quote reads the input size from our copy of the file', async () => {
  let res = await app.inject({ method: 'POST', url: '/dz/api/quote', headers: { cookie: adminCookie },
    payload: { endpoint: 'p/fal/topaz/upscale/image/precision', body: { image_url: uploadUrl, model: 'Standard V2', upscale_factor: 4 } } });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().price, { usd: 0.16, exact: true, source: 'quote', output_mp: 32, input: { width: 2000, height: 1000 } });
  // Someone else's file: no price, and no peeking at its size.
  res = await app.inject({ method: 'POST', url: '/dz/api/quote', headers: { cookie: otherCookie },
    payload: { endpoint: 'p/fal/topaz/upscale/image/precision', body: { image_url: uploadUrl, model: 'Standard V2' } } });
  assert.equal(res.json().price, null);
  res = await app.inject({ method: 'POST', url: '/dz/api/quote', headers: { cookie: adminCookie },
    payload: { endpoint: 'p/fal/fal-ai/flux/dev', body: {} } });
  assert.equal(res.statusCode, 404, 'only our tools, even for admins');
});

test('submit sends a clean body with the file uploaded to fal', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/v1/p/fal/topaz/upscale/image/precision', headers: { cookie: adminCookie },
    payload: { image_url: uploadUrl, model: 'Text Refine', upscale_factor: 2, strength: 0.5, creativity: 3 } });
  assert.equal(res.statusCode, 200, res.body);
  const sent = calls.submit.at(-1);
  assert.equal(sent.cfg.apiKey, 'fal-key');
  assert.deepEqual(sent.req, { kind: 'image', model: 'topaz/upscale/image/precision', body: { image_url: 'https://v3.fal.media/files/in.png', model: 'Text Refine', upscale_factor: 2, strength: 0.5 } });
  res = await app.inject({ method: 'POST', url: '/api/v1/p/fal/topaz/upscale/image/precision', headers: { cookie: adminCookie },
    payload: { image_url: 'https://elsewhere.example/a.png', model: 'CGI' } });
  assert.equal(res.statusCode, 400, 'only our own files');
  res = await app.inject({ method: 'POST', url: '/api/v1/p/fal/topaz/upscale/image/precision', headers: { cookie: otherCookie },
    payload: { image_url: uploadUrl, model: 'CGI' } });
  assert.equal(res.statusCode, 400, 'not another user\'s file');
});

test('fal task ids are checked before building URLs', async () => {
  fal.poll = original.poll;
  await assert.rejects(() => fal.poll({ apiKey: 'k' }, '../../evil/x'), /bad task id/);
});
