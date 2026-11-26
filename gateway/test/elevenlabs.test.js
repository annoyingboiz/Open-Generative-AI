import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { buildApp } from '../src/app.js';
import { setElevenlabsApiForTests, toSrt } from '../src/providers/elevenlabs.js';

// A stand-in for api.elevenlabs.io: records what it gets, answers like the real one.
const seen = [];
let server;
let app;
let dataDir;
let adminCookie;
let wifeCookie;
const MP3 = Buffer.from('ID3fake-mp3-bytes');
const cookieOf = (res) => { const raw = res.headers['set-cookie']; return (Array.isArray(raw) ? raw[0] : raw).split(';')[0]; };
function multipart(field, filename, mime, data) {
  const boundary = '----dz' + Date.now();
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = Buffer.alloc(0);
    req.on('data', (c) => { body = Buffer.concat([body, c]); });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, key: req.headers['xi-api-key'], type: req.headers['content-type'] || '', body: body.toString('latin1') });
      const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/v1/models') return json([
        { model_id: 'eleven_v4', name: 'Eleven v4', can_do_text_to_speech: true },
        { model_id: 'eleven_flash_v2_5', name: 'Flash v2.5', can_do_text_to_speech: true },
        { model_id: 'eleven_multilingual_sts_v2', name: 'STS', can_do_text_to_speech: false, can_do_voice_conversion: true },
      ]);
      if (req.url.startsWith('/v2/voices')) return json({ voices: [
        { voice_id: 'pre1', name: 'Roger', category: 'premade', labels: { accent: 'american', gender: 'male' } },
        { voice_id: 'me1', name: 'Denis', category: 'cloned', labels: {} },
      ], has_more: false });
      if (req.url === '/v1/user/subscription') return json({ tier: 'creator', character_count: 1000, character_limit: 275000, next_character_count_reset_unix: 1796000000 });
      if (/^\/v1\/(text-to-speech|voice-changer)\/|^\/v1\/sound-generation/.test(req.url)) { res.writeHead(200, { 'content-type': 'audio/mpeg' }); return res.end(MP3); }
      if (req.url === '/v1/speech-to-text') return json({ language_code: 'ru', text: 'Привет мир. Это тест.', words: [
        { text: 'Привет', start: 0, end: 0.5, type: 'word' }, { text: ' ', start: 0.5, end: 0.5, type: 'spacing' }, { text: 'мир.', start: 0.5, end: 1, type: 'word' },
        { text: 'Это', start: 2, end: 2.3, type: 'word' }, { text: 'тест.', start: 2.3, end: 2.8, type: 'word' }] });
      return json({ detail: 'not found' }, 404);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  setElevenlabsApiForTests(`http://127.0.0.1:${server.address().port}`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-el-'));
  app = await buildApp({
    host: '127.0.0.1', port: 0, studioUrl: 'http://127.0.0.1:9', dataDir, appSecret: 'test', sessionDays: 30, logLevel: 'error', startWorkers: false,
    providerEnv: { apimart: { apiKey: '', proxy: '' }, atlas: { apiKey: '', proxy: '' }, fal: { apiKey: '', proxy: '' }, elevenlabs: { apiKey: 'el-key', proxy: '' } },
  }, { logger: false });
  await app.ready();
  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
  let res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'admin', displayName: 'Admin', password: 'admin-pass-1', setupCode } });
  adminCookie = cookieOf(res);
  await app.inject({ method: 'POST', url: '/dz/api/settings/people', headers: { cookie: adminCookie }, payload: { username: 'wife', name: 'Wife', password: 'wife-pass-12' } });
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'wife', password: 'wife-pass-12' } });
  wifeCookie = cookieOf(res);
  await app.ctx.catalog.refreshAll({ force: true });
});

after(async () => {
  await app.close();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const catalogOf = async (cookie) => {
  const res = await app.inject({ url: '/dz/catalog.js', headers: { cookie } });
  const m = /__DZ_CATALOG__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/m.exec(res.body);
  return m ? JSON.parse(m[1]) : JSON.parse(res.body);
};

test('elevenlabs: your models and voices in the audio list (yours first), admins only', async () => {
  const v = app.ctx.catalog.variant('p/elevenlabs/eleven_v4?m=t2a');
  assert.ok(v, 'v4 from your key');
  const voice = v.model.inputs.voice_id;
  assert.deepEqual(voice.enum, ['me1', 'pre1']);
  assert.equal(voice.enumLabels.me1, 'Denis · your voice');
  assert.equal(v.model.dzFamily, 'dz-4-text-to-speech', 'same family as Atlas v4: one model, two providers');
  assert.equal(v.model.dzPrice.label, '$0.08/1k chars');
  assert.ok(app.ctx.catalog.variant('p/elevenlabs/voice-changer?m=t2a'), 'voice changer: your key has the STS model');
  assert.ok(app.ctx.catalog.variant('p/elevenlabs/sound-effects?m=t2a'));
  assert.equal(app.ctx.catalog.variant('p/elevenlabs/eleven_v3?m=t2a'), null, 'not offered by this key');
  // Someone else can't use the owner's plan.
  const res = await app.inject({ method: 'POST', url: '/api/v1/p/elevenlabs/eleven_v4?m=t2a', headers: { cookie: wifeCookie }, payload: { prompt: 'hi', voice_id: 'me1' } });
  assert.ok([403, 404].includes(res.statusCode), `wife: ${res.statusCode}`);
});

test('elevenlabs: speech with your voice → an audio item; settings nested; balance in credits', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/v1/p/elevenlabs/eleven_v4?m=t2a', headers: { cookie: adminCookie },
    payload: { prompt: 'Привет, это мой голос.', voice_id: 'me1', stability: 0.4, speed: 1.1, _dz: { studio: 'tools' } } });
  assert.equal(res.statusCode, 200, res.body);
  const id = res.json().request_id;
  const call = seen.find((x) => x.url.startsWith('/v1/text-to-speech/me1'));
  assert.ok(call, 'sent to your voice');
  assert.equal(call.key, 'el-key');
  assert.match(call.url, /output_format=mp3_44100_128/);
  const sent = JSON.parse(Buffer.from(call.body, 'latin1').toString('utf8'));
  assert.deepEqual(sent, { text: 'Привет, это мой голос.', model_id: 'eleven_v4', voice_settings: { stability: 0.4, speed: 1.1 } });
  // The audio was saved at submit; the first check makes it a library item.
  app.ctx.db.prepare('UPDATE generations SET next_poll_at = 0 WHERE id = ?').run(id);
  await app.ctx.generations.tick();
  await new Promise((r) => setTimeout(r, 200));
  const row = app.ctx.db.prepare('SELECT status, kind, outputs_json FROM generations WHERE id = ?').get(id);
  assert.equal(row.status, 'completed');
  assert.equal(row.kind, 'audio');
  const out = JSON.parse(row.outputs_json)[0];
  assert.equal(out.mime, 'audio/mpeg');
  assert.deepEqual(fs.readFileSync(out.path), MP3);
  res = await app.inject({ url: '/dz/api/balances?fresh=1', headers: { cookie: adminCookie } });
  const b = res.json().balances.find((x) => x.id === 'elevenlabs');
  assert.equal(b.amount, 274000);
  assert.equal(b.currency, 'CREDITS');
  assert.match(b.note, /creator plan · of 275,000 · renews/);
});

test('elevenlabs: transcription → text, words and subtitles; admins only', async () => {
  const mp = multipart('file', 'voice.mp3', 'audio/mpeg', MP3);
  let res = await app.inject({ method: 'POST', url: '/api/v1/upload_file', headers: { cookie: adminCookie, ...mp.headers }, payload: mp.payload });
  assert.equal(res.statusCode, 200, res.body);
  const url = res.json().url;
  res = await app.inject({ method: 'POST', url: '/dz/api/transcribe', headers: { cookie: wifeCookie }, payload: { url } });
  assert.equal(res.statusCode, 403);
  res = await app.inject({ method: 'POST', url: '/dz/api/transcribe', headers: { cookie: adminCookie }, payload: { url, diarize: true } });
  assert.equal(res.statusCode, 200, res.body);
  const out = res.json();
  assert.equal(out.text, 'Привет мир. Это тест.');
  assert.equal(out.language, 'ru');
  assert.equal(out.words.length, 4, 'spacing left out');
  assert.match(out.srt, /^1\n00:00:00,000 --> 00:00:01,000\nПривет мир\.\n\n2\n00:00:02,000 --> 00:00:02,800\nЭто тест\.\n$/);
  const call = seen.find((x) => x.url === '/v1/speech-to-text');
  assert.match(call.type, /multipart\/form-data/);
  assert.match(call.body, /name="model_id"\r\n\r\nscribe_v2/);
  assert.match(call.body, /name="diarize"\r\n\r\ntrue/);
});

test('toSrt: breaks at pauses and long lines', () => {
  assert.equal(toSrt([]), '');
  const srt = toSrt([{ text: 'a', start: 0, end: 1 }, { text: 'b', start: 3, end: 4 }]);
  assert.equal(srt.split('\n\n').length, 2);
});
