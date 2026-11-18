import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildApp } from '../src/app.js';
import { fal } from '../src/providers/fal.js';
import { atlas } from '../src/providers/atlas.js';
import { videoUpscaleBody, videoUpscalePrice, videoInfo, restoreAudio, providerPayload } from '../src/video-upscale.js';

let app;
let dataDir;
let tmp;
let admin;
let videoUrl;
const calls = { submit: [], upload: [], quote: [] };
const original = { falSubmit: fal.submit, falUpload: fal.upload, atlasQuote: atlas.quote, atlasUpload: atlas.upload, atlasSubmit: atlas.submit };
const cookieOf = (res) => { const raw = res.headers['set-cookie']; return (Array.isArray(raw) ? raw[0] : raw).split(';')[0]; };
function multipart(field, filename, mime, data) {
  const boundary = '----dz' + Date.now();
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const mkVideo = (file, { w = 1280, h = 720, secs = 2, audio = true } = {}) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=24:duration=${secs}`,
  ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`, '-c:a', 'aac'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', file]);

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vu-'));
  fal.submit = async (cfg, req) => { calls.submit.push(req); return { taskId: 'fal-ai/topaz/req-1' }; };
  fal.upload = async (cfg, f) => { calls.upload.push(['fal', f.name]); return { url: 'https://v3.fal.media/files/in.mp4', expiresAt: Date.now() + 86_400_000 }; };
  atlas.upload = async (cfg, f) => { calls.upload.push(['atlas', f.name]); return { url: 'https://atlas.example/in.mp4', expiresAt: Date.now() + 86_400_000 }; };
  atlas.quote = async (cfg, req) => { calls.quote.push(req); return { usd: 0.296, exact: true }; };
  atlas.submit = async (cfg, req) => { calls.submit.push(req); return { taskId: 'atlas-1' }; };
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-vu-'));
  app = await buildApp({
    host: '127.0.0.1', port: 0, studioUrl: 'http://127.0.0.1:9', dataDir, appSecret: 'test', sessionDays: 30, logLevel: 'error', startWorkers: false,
    providerEnv: { apimart: { apiKey: '', proxy: '' }, atlas: { apiKey: 'atlas-key', proxy: '' }, fal: { apiKey: 'fal-key', proxy: '' } },
  }, { logger: false });
  await app.ready();
  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
  const res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'admin', displayName: 'Admin', password: 'admin-pass-1', setupCode } });
  admin = cookieOf(res);
  const file = path.join(tmp, 'shot.mp4');
  mkVideo(file);
  const mp = multipart('file', 'shot.mp4', 'video/mp4', fs.readFileSync(file));
  videoUrl = (await app.inject({ method: 'POST', url: '/api/v1/upload_file', headers: { cookie: admin, ...mp.headers }, payload: mp.payload })).json().url;
});
after(async () => {
  fal.submit = original.falSubmit; fal.upload = original.falUpload;
  atlas.quote = original.atlasQuote; atlas.upload = original.atlasUpload; atlas.submit = original.atlasSubmit;
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

const info = { width: 1280, height: 720, duration: 5, fps: 24, frames: 120, audio: true };

test('each model gets the target in its own terms', () => {
  const t = videoUpscaleBody('fal', 'fal-ai/topaz/upscale/video', { tool_model: 'topaz-starlight-precise', video_url: 'v', target: '4k', fps: '60' }, info);
  assert.equal(t.model, 'Starlight Precise 2.5');
  assert.equal(t.upscale_factor, 3);
  assert.equal(t.target_fps, 60);
  assert.equal(t.H264_output, true);
  assert.equal(videoUpscaleBody('fal', 'fal-ai/seedvr/upscale/video', { video_url: 'v', target: '2k' }, info).target_resolution, '1440p');
  const fv = videoUpscaleBody('fal', 'fal-ai/flashvsr/upscale/video', { video_url: 'v', target: '1080p' }, info);
  assert.equal(fv.upscale_factor, 1.5);
  assert.equal(fv.preserve_audio, true);
  const bp = videoUpscaleBody('atlas', 'byteplus/video/upscaler', { video_url: 'v', target: '4k', tool_version: 'professional', scene: 'ugc' }, info);
  assert.equal(bp.resolution, '4k');
  assert.equal(bp.scene, undefined, 'scene only for standard');
  assert.equal(videoUpscaleBody('atlas', 'tencent/video/upscaler', { video_url: 'v', target: '2k', style: 'restore' }, info).template, 'restore-2k');
  assert.equal(videoUpscaleBody('atlas', 'tencent/video/upscaler', { video_url: 'v', target: '4k', style: 'live-action-smallface' }, info).template, 'live-action-smallface-4k');
  assert.equal(videoUpscaleBody('atlas', 'tencent/video/upscaler', { video_url: 'v', target: '4k' }, info).template, 'seedance2-enhance-4k');
  const gm = videoUpscaleBody('atlas', 'google/gemini-omni-1.2-flash/video-upscale', { video_url: 'v', target: '2k' }, info);
  assert.equal(gm.resolution, '4k', '2K is not offered: falls back to its biggest');
  assert.equal(gm.video, 'v');
  assert.throws(() => videoUpscaleBody('atlas', 'google/gemini-omni-1.2-flash/video-upscale', { video_url: 'v', target: '4k' }, { ...info, duration: 20 }), /15 seconds/);
  assert.throws(() => videoUpscaleBody('atlas', 'google/gemini-omni-1.2-flash/video-upscale', { video_url: 'v', target: '4k' }, { ...info, width: 1000, height: 1000 }), /16:9/);
  assert.throws(() => videoUpscaleBody('fal', 'fal-ai/topaz/upscale/video', { video_url: 'v', target: '1080p' }, { ...info, width: 1920, height: 1080 }), /already/);
  assert.deepEqual(Object.keys(providerPayload(t)).filter((k) => ['tool_model', 'target'].includes(k)), []);
});

test('fal prices from the published rates', () => {
  const topaz = videoUpscalePrice('fal', 'fal-ai/topaz/upscale/video', { tool_model: 'topaz-starlight-precise', target: '4k' }, info);
  assert.equal(topaz.usd, 0.4); // above 1080p: $0.08/s × 5 s
  assert.equal(videoUpscalePrice('fal', 'fal-ai/topaz/upscale/video', { tool_model: 'topaz-starlight-precise', target: '4k', target_fps: 60 }, info).usd, 0.8);
  assert.equal(videoUpscalePrice('fal', 'fal-ai/topaz/upscale/video', { tool_model: 'topaz-gaia-2', target: '1080p' }, info).usd, 0.05);
  // SeedVR2: 3840×2160 × 120 frames × $0.001/MP
  assert.equal(videoUpscalePrice('fal', 'fal-ai/seedvr/upscale/video', { tool_model: 'seedvr2', target: '4k' }, info).usd, 0.995);
  assert.equal(videoUpscalePrice('atlas', 'byteplus/video/upscaler', { tool_model: 'byteplus', target: '4k' }, info), null);
});

test('video info and putting the sound back', async () => {
  const a = path.join(tmp, 'a.mp4');
  const b = path.join(tmp, 'b.mp4');
  mkVideo(a, { audio: true });
  mkVideo(b, { w: 1920, h: 1080, audio: false });
  const ia = await videoInfo(a);
  assert.equal(ia.width, 1280);
  assert.equal(ia.audio, true);
  assert.ok(ia.duration > 1.9 && ia.duration < 2.2);
  assert.equal((await videoInfo(b)).audio, false);
  assert.equal(await restoreAudio(b, a), true);
  const ib = await videoInfo(b);
  assert.equal(ib.audio, true);
  assert.equal(ib.width, 1920, 'picture untouched');
});

test('quote and submit: fal priced here, Atlas quoted with its own copy of the video', async () => {
  const tools = (await app.inject({ method: 'GET', url: '/dz/api/tools', headers: { cookie: admin } })).json().tools;
  assert.ok(tools.videoUpscale.models.some((m) => m.id === 'seedvr2'));
  assert.ok(tools.videoUpscale.models.some((m) => m.id === 'byteplus'));
  let res = await app.inject({ method: 'POST', url: '/dz/api/quote', headers: { cookie: admin }, payload: { endpoint: 'p/fal/fal-ai/topaz/upscale/video', body: { tool_model: 'topaz-proteus', video_url: videoUrl, target: '4k' } } });
  let price = res.json().price;
  assert.equal(price.usd, 0.16); // 2 s × $0.08
  assert.deepEqual(price.output, { width: 3840, height: 2160 });
  assert.equal(price.input.audio, true);
  res = await app.inject({ method: 'POST', url: '/dz/api/quote', headers: { cookie: admin }, payload: { endpoint: 'p/atlas/byteplus/video/upscaler', body: { tool_model: 'byteplus', video_url: videoUrl, target: '4k' } } });
  price = res.json().price;
  assert.equal(price.usd, 0.296);
  assert.equal(calls.quote.at(-1).body.video_url, 'https://atlas.example/in.mp4');
  assert.equal(calls.quote.at(-1).body.scene, 'aigc');
  res = await app.inject({ method: 'POST', url: '/dz/api/quote', headers: { cookie: admin }, payload: { endpoint: 'p/fal/fal-ai/topaz/upscale/video', body: { video_url: '/media/u/nope.mp4', target: '4k' } } });
  assert.match(res.json().problem, /Choose a video/);
  // Submit: provider gets no keys of ours; studio "upscale", sound noted for later.
  res = await app.inject({ method: 'POST', url: '/api/v1/p/atlas/byteplus/video/upscaler', headers: { cookie: admin }, payload: { tool_model: 'byteplus', video_url: videoUrl, target: '2k' } });
  assert.equal(res.statusCode, 200, res.body);
  const sent = calls.submit.at(-1);
  assert.equal(sent.kind, 'video');
  assert.equal(sent.body.video_url, 'https://atlas.example/in.mp4');
  assert.equal(sent.body.tool_model, undefined);
  assert.equal(calls.upload.filter(([p]) => p === 'atlas').length, 1, 'uploaded once, reused');
  const row = app.ctx.db.prepare('SELECT studio, kind, meta_json, est_cost_usd FROM generations WHERE id = ?').get(res.json().id);
  assert.equal(row.studio, 'upscale');
  assert.equal(JSON.parse(row.meta_json).upscale.audio, true);
  assert.equal(row.est_cost_usd, 0.296);
  // Unknown endpoints and modes are refused.
  res = await app.inject({ method: 'POST', url: '/api/v1/p/fal/fal-ai/topaz/upscale/video?m=x', headers: { cookie: admin }, payload: { video_url: videoUrl } });
  assert.equal(res.statusCode, 404);
});
