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
  assert.equal(res.json().sources.find((s) => s.id === 'chatgpt').status, 'not connected', 'everyone can connect their own');
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
  assert.equal(res.statusCode, 424);
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

test('ChatGPT plans: one per person, stored encrypted; an admin may share theirs; defaults per person', async () => {
  const cg = app.ctx.chatgpt;
  const db = app.ctx.db;
  const id = (name) => db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  assert.throws(() => cg.importCredentials({ client_id: 'oaiapp_x', access_token: 'a', refresh_token: 'r', scopes: ['openid'] }, { username: 'admin' }), /plan permission/);
  assert.throws(() => cg.importCredentials({ client_id: 'dynamic_agent_client', access_token: 'a', refresh_token: 'r', scopes: ['chatgpt.tokens.use.direct'] }, { username: 'admin' }), /Registration/);
  assert.throws(() => cg.importCredentials({ client_id: 'oaiapp_x', access_token: 'a', refresh_token: 'r', scopes: ['chatgpt.tokens.use.direct'] }, { username: 'nobody' }), /No user/);
  const r = cg.importCredentials(JSON.stringify({ client_id: 'oaiapp_x', access_token: 'secret-access', refresh_token: 'secret-refresh', scopes: ['openid', 'chatgpt.tokens.use.direct'], email: 'me@example.com', expires_in: 3600 }), { username: 'admin' });
  assert.equal(r.owner, 'admin');
  const stored = db.prepare('SELECT value FROM meta WHERE key = ?').get(`chatgpt_creds:${id('admin')}`).value;
  assert.equal(stored.includes('secret-access'), false, 'stored encrypted');
  assert.equal(JSON.parse(db.prepare('SELECT value FROM meta WHERE key = ?').get(`chatgpt_reg:${id('admin')}`).value).client_id, 'oaiapp_x', 'registration kept apart, without tokens');
  const host1 = cg.hostId();
  assert.match(host1, /^urn:uuid:/);
  assert.equal(cg.hostId(), host1, 'the server keeps one host id');
  // The kid has no plan of their own: not usable, told to connect.
  let res = await as('kid', 'POST', '/dz/api/llm/chat', { model: 'chatgpt:gpt-6.1-sol', prompt: 'hi' });
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /Connect your ChatGPT/);
  res = await as('admin', 'GET', '/settings');
  assert.match(res.body, /me@example\.com/);
  assert.equal(res.body.includes('secret-'), false);
  res = await as('kid', 'GET', '/settings');
  assert.match(res.body, /Connect ChatGPT/);
  assert.equal(res.body.includes('me@example.com'), false, 'others don’t see the admin’s plan');
  res = await as('kid', 'POST', '/dz/settings/chatgpt/disconnect', { userId: String(id('admin')) });
  assert.equal(res.statusCode, 403);
  // Not shared: ChatGPT can be the admin's own default, not everyone's.
  assert.throws(() => app.ctx.llm.setDefault('chatgpt:gpt-6.1-sol'), /share it with everyone/);
  assert.throws(() => app.ctx.llm.setUserDefault({ id: id('kid') }, 'chatgpt:gpt-6.1-sol'), /Connect your ChatGPT/);
  app.ctx.llm.setUserDefault({ id: id('admin') }, 'chatgpt:gpt-6.1-sol');
  // Shared: the kid may use it; it can be everyone's default.
  res = await as('kid', 'POST', '/dz/settings/chatgpt/sharing', { sharing: 'all' });
  assert.equal(res.statusCode, 403, 'only an admin shares their plan');
  res = await as('admin', 'POST', '/dz/settings/chatgpt/sharing', { sharing: 'all' });
  assert.equal(res.statusCode, 302);
  assert.equal(cg.canUse({ id: id('kid') }), true);
  res = await as('kid', 'GET', '/settings');
  assert.match(res.body, /admin<\/b>’s plan, shared/);
  app.ctx.llm.setDefault('chatgpt:gpt-6.1-sol');
  assert.equal(app.ctx.llm.defaultId(), 'chatgpt:gpt-6.1-sol');
  // Back to "only me": everyone's default is dropped, the admin's own stays.
  res = await as('admin', 'POST', '/dz/settings/chatgpt/sharing', { sharing: 'owner' });
  assert.equal(app.ctx.llm.defaultId(), '');
  assert.equal(cg.canUse({ id: id('kid') }), false);
  assert.equal(db.prepare('SELECT value FROM meta WHERE key = ?').get(`llm_default:${id('admin')}`).value, 'chatgpt:gpt-6.1-sol');
});

test('Settings: your ChatGPT models can be picked as your default; a saved choice that is offline is kept', async () => {
  const { settingsPage } = await import('../src/pages.js');
  const models = [
    { id: 'chatgpt:gpt-6.2-sol', source: 'chatgpt', name: 'GPT-6.2 Sol', price: { in: 0, out: 0 }, free: true },
    { id: 'apimart:deepseek-v4-flash', source: 'apimart', name: 'DeepSeek V4 Flash', recommended: true, price: { in: 0.1, out: 0.5 } },
  ];
  const user = { id: 1, role: 'user', username: 'denis', display_name: 'Denis' };
  let html = settingsPage({ user, llm: { models, myDefault: 'chatgpt:gpt-6.2-sol', globalDefault: 'apimart:deepseek-v4-flash', chatgpt: { connected: true } } });
  const mine = html.slice(html.indexOf('My default text model'));
  assert.match(mine, /<optgroup label="Your ChatGPT plan"><option value="chatgpt:gpt-6.2-sol" selected>/);
  html = settingsPage({ user, llm: { models: models.slice(1), myDefault: 'chatgpt:gpt-6.2-sol', globalDefault: '', chatgpt: { connected: true } } });
  assert.match(html.slice(html.indexOf('My default text model')), /<option value="chatgpt:gpt-6.2-sol" selected>gpt-6.2-sol — not available right now/);
});
