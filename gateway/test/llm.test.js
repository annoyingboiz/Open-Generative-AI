import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';

// A fake Ollama: lists two models, answers chats; "busy" mode answers like a
// machine whose graphics cards are full.
let ollama;
let mode = 'ok';
let lastChat = null;
let app;
let dataDir;
const cookies = {};
const cookieOf = (res) => { const raw = res.headers['set-cookie']; return (Array.isArray(raw) ? raw[0] : raw).split(';')[0]; };
const as = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: cookies[who] }, ...(payload !== undefined ? { payload } : {}) });

before(async () => {
  ollama = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [
          { name: 'qwen3.5:9b', details: { parameter_size: '9B', quantization_level: 'Q4' }, capabilities: ['completion', 'thinking'] },
          { name: 'gemma4:31b', details: { parameter_size: '31B' }, capabilities: ['completion', 'vision'] },
          { name: 'nomic-embed-text', details: {} },
        ] }));
        return;
      }
      if (req.url === '/api/chat') {
        lastChat = JSON.parse(body);
        if (mode === 'busy') { res.statusCode = 500; res.end(JSON.stringify({ error: 'model requires more system memory (12 GiB) than is available' })); return; }
        if (mode === 'empty') { res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done_reason: 'length', prompt_eval_count: 5, eval_count: 64 })); return; }
        res.end(JSON.stringify({ message: { role: 'assistant', content: '  A bartender pours a cocktail, slow motion.  ' }, done_reason: 'stop', prompt_eval_count: 21, eval_count: 9 }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-llm-'));
  app = await buildApp({
    host: '127.0.0.1', port: 0, studioUrl: 'http://127.0.0.1:9', dataDir, appSecret: 'test', sessionDays: 30, logLevel: 'error',
    startWorkers: false, ollamaUrl: `http://127.0.0.1:${ollama.address().port}`,
    providerEnv: { apimart: { apiKey: '', proxy: '' }, atlas: { apiKey: '', proxy: '' } },
  }, { logger: false });
  await app.ready();
  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
  let res = await app.inject({ method: 'POST', url: '/setup', payload: { username: 'admin', displayName: 'Admin', password: 'admin-pass-1', setupCode } });
  cookies.admin = cookieOf(res);
  await as('admin', 'POST', '/dz/settings/users', { username: 'kid', displayName: 'kid', password: 'kid-pass-123', monthlyLimitUsd: '0' });
  res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'kid', password: 'kid-pass-123' } });
  cookies.kid = cookieOf(res);
});

after(async () => {
  await app?.close();
  ollama?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('model list: local models (no embeddings), cloud sources without keys say so, ChatGPT only for the admin', async () => {
  let res = await as('admin', 'GET', '/dz/api/llm/models');
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json();
  assert.deepEqual(data.models.map((m) => m.id).sort(), ['local:gemma4:31b', 'local:qwen3.5:9b']);
  assert.equal(data.models.find((m) => m.id === 'local:gemma4:31b').vision, true);
  assert.ok(data.models.every((m) => m.free));
  assert.equal(data.sources.find((s) => s.id === 'local').status, 'ok');
  assert.equal(data.sources.find((s) => s.id === 'apimart').status, 'no key');
  assert.equal(data.sources.find((s) => s.id === 'chatgpt').status, 'not connected');
  assert.ok(['local:gemma4:31b', 'local:qwen3.5:9b'].includes(data.default));
  res = await as('kid', 'GET', '/dz/api/llm/models');
  assert.equal(res.json().sources.some((s) => s.id === 'chatgpt'), false);
});

test('chat on the local machine: free, logged, works even at a $0 limit; busy and offline get plain messages', async () => {
  let res = await as('kid', 'POST', '/dz/api/llm/chat', { model: 'local:qwen3.5:9b', system: 'Be brief.', prompt: 'Rewrite: bartender cocktail', purpose: 'adapter' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().text, 'A bartender pours a cocktail, slow motion.');
  assert.equal(res.json().costUsd, 0);
  assert.deepEqual(res.json().usage, { in: 21, out: 9 });
  assert.deepEqual(lastChat.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(lastChat.stream, false);
  assert.equal(lastChat.think, false, 'thinking models are asked not to think');
  mode = 'empty';
  res = await as('kid', 'POST', '/dz/api/llm/chat', { model: 'local:qwen3.5:9b', prompt: 'hi', purpose: 'empty' });
  assert.equal(res.statusCode, 502);
  assert.match(res.json().error, /thinking/);
  assert.equal(app.ctx.db.prepare("SELECT completion_tokens FROM llm_calls WHERE purpose = 'empty'").get().completion_tokens, 64);
  mode = 'ok';
  const row = app.ctx.db.prepare("SELECT * FROM llm_calls WHERE purpose = 'adapter'").get();
  assert.equal(row.status, 'ok');
  assert.equal(row.source, 'local');

  mode = 'busy';
  res = await as('kid', 'POST', '/dz/api/llm/chat', { model: 'local:qwen3.5:9b', prompt: 'hi' });
  assert.equal(res.statusCode, 503);
  assert.match(res.json().error, /local machine is busy/i);
  mode = 'ok';

  // Cloud models with no known price are refused for people with a limit.
  res = await as('kid', 'POST', '/dz/api/llm/chat', { model: 'atlas:deepseek-ai/deepseek-v4-flash', prompt: 'hi' });
  assert.equal(res.statusCode, 409);
  res = await as('kid', 'POST', '/dz/api/llm/chat', { model: 'local:qwen3.5:9b', messages: Array.from({ length: 101 }, () => ({ role: 'user', content: 'x' })) });
  assert.equal(res.statusCode, 400);
  // A restart releases bookings of calls that never finished.
  assert.equal(app.ctx.db.prepare("SELECT COUNT(*) n FROM llm_calls WHERE status = 'running'").get().n, 0);
  res = await as('admin', 'POST', '/dz/api/llm/chat', { model: 'chatgpt:gpt', prompt: 'hi' });
  assert.equal(res.statusCode, 409);
  res = await as('admin', 'POST', '/dz/api/llm/chat', { model: 'local:qwen3.5:9b', prompt: '' });
  assert.equal(res.statusCode, 400);
  res = await as('admin', 'POST', '/dz/api/llm/chat', { model: 'local:qwen3.5:9b', prompt: 'x'.repeat(60_001) });
  assert.equal(res.statusCode, 400);
  // A picture the user can't open is refused.
  res = await as('admin', 'POST', '/dz/api/llm/chat', { model: 'local:gemma4:31b', prompt: 'what is it', images: ['/media/u/up_nope.png'] });
  assert.equal(res.statusCode, 404);
});

test('settings: default model and a test call', async () => {
  let res = await as('admin', 'POST', '/dz/settings/llm/default', { model: 'local:qwen3.5:9b' });
  assert.equal(res.statusCode, 302);
  res = await as('admin', 'GET', '/dz/api/llm/models');
  assert.equal(res.json().default, 'local:qwen3.5:9b');
  res = await as('admin', 'POST', '/dz/settings/llm/try', { model: 'local:qwen3.5:9b', prompt: 'hello' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /A bartender pours a cocktail/);
  res = await as('kid', 'POST', '/dz/settings/llm/default', { model: 'local:qwen3.5:9b' });
  assert.equal(res.statusCode, 403);
  // Offline: nothing answers.
  ollama.close();
  await new Promise((r) => setTimeout(r, 50));
  res = await as('admin', 'POST', '/dz/api/llm/chat', { model: 'local:qwen3.5:9b', prompt: 'hi' });
  assert.equal(res.statusCode, 503);
  assert.match(res.json().error, /offline/i);
});
