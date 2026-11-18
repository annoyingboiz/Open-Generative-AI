import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { loadMasterKey } from '../src/crypto.js';
import { createChatGpt } from '../src/chatgpt.js';

// A fake OpenAI: token refresh (rotating), /models, /responses as SSE.
let server;
let base;
let respMode = 'ok';
const seen = { refresh: [], auth: [] };
let accessGen = 1;
let validAccess = 'acc-1';

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (req.url === '/auth/api/accounts/oauth/token') {
        const f = new URLSearchParams(body);
        seen.refresh.push(f.get('refresh_token'));
        res.setHeader('content-type', 'application/json');
        if (f.get('refresh_token') === 'dead') { res.statusCode = 400; res.end(JSON.stringify({ error: 'refresh_token_reused' })); return; }
        accessGen += 1;
        validAccess = `acc-${accessGen}`;
        res.end(JSON.stringify({ access_token: validAccess, refresh_token: `ref-${accessGen}`, expires_in: 3600 }));
        return;
      }
      seen.auth.push(req.headers.authorization);
      if (req.headers.authorization !== `Bearer ${validAccess}`) { res.statusCode = 401; res.end('{"detail":"bad token"}'); return; }
      if (req.url === '/api/models') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ models: [{ slug: 'gpt-x', display_name: 'GPT X', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] }));
        return;
      }
      if (req.url === '/api/responses') {
        if (respMode === 'limit') { res.statusCode = 429; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } })); return; }
        res.setHeader('content-type', 'text/event-stream');
        const ev = (o) => `event: ${o.type}\r\ndata: ${JSON.stringify(o)}\r\n\r\n`;
        const parts = respMode === 'incomplete'
          ? [ev({ type: 'response.output_text.delta', delta: 'Half' }), ev({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } })]
          : [ev({ type: 'response.output_text.delta', delta: 'Hel' }), ev({ type: 'response.output_text.delta', delta: 'lo, бар' }), ev({ type: 'response.completed', response: { usage: { input_tokens: 7, output_tokens: 3 } } })];
        const all = Buffer.from(parts.join(''));
        // Send in awkward pieces (splits CRLF pairs and UTF-8 letters).
        for (let i = 0; i < all.length; i += 7) { res.write(all.subarray(i, i + 7)); await new Promise((r) => setTimeout(r, 1)); }
        res.end();
        return;
      }
      res.statusCode = 404; res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-cg-'));
  const db = openDatabase(dir);
  db.prepare("INSERT INTO users (id, username, display_name, role, pw_hash, created_at) VALUES (1, 'denis', 'Denis', 'admin', 'x', 0), (2, 'kid', 'Kid', 'user', 'x', 0)").run();
  const config = { chatgptAuthBase: `${base}/auth`, chatgptApiBase: `${base}/api` };
  const masterKey = loadMasterKey(dir, 'secret');
  return { db, cg: createChatGpt({ db, masterKey, config, log: { warn() {} } }), cg2: createChatGpt({ db, masterKey, config, log: { warn() {} } }) };
}
const creds = (over = {}) => ({ client_id: 'oaiapp_1', access_token: validAccess, refresh_token: 'ref-1', scopes: ['openid', 'chatgpt.tokens.use.direct'], email: 'd@x', sub: 's1', expires_in: 3600, ...over });

test('answers stream in odd pieces with CRLF and still come out whole', async () => {
  const { cg } = setup();
  cg.importCredentials(creds(), { username: 'denis' });
  respMode = 'ok';
  const out = await cg.chat({ id: 1 }, { model: 'gpt-x', msgs: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }] });
  assert.equal(out.text, 'Hello, бар');
  assert.deepEqual(out.usage, { in: 7, out: 3 });
  await assert.rejects(cg.chat({ id: 2 }, { model: 'gpt-x', msgs: [{ role: 'user', content: 'hi' }] }), (e) => e.status === 403);
});

test('an unfinished answer is an error, the plan limit is a 429', async () => {
  const { cg } = setup();
  cg.importCredentials(creds(), { username: 'denis' });
  respMode = 'incomplete';
  await assert.rejects(cg.chat({ id: 1 }, { model: 'gpt-x', msgs: [{ role: 'user', content: 'hi' }] }), /stopped before finishing/);
  respMode = 'limit';
  await assert.rejects(cg.chat({ id: 1 }, { model: 'gpt-x', msgs: [{ role: 'user', content: 'hi' }] }), (e) => e.status === 429 && /limit/.test(e.message));
  respMode = 'ok';
});

test('a near-expiry token is refreshed once, the new refresh token is kept; a rejected one retries after refresh', async () => {
  const { cg, cg2 } = setup();
  cg.importCredentials(creds({ expires_in: 60 }), { username: 'denis' });
  seen.refresh.length = 0;
  const [a, b] = await Promise.all([cg.models({ id: 1 }), cg2.models({ id: 1 })]);
  assert.deepEqual(a, [{ slug: 'gpt-x', name: 'GPT X' }]);
  assert.deepEqual(b, a);
  assert.equal(seen.refresh.length, 1, 'two processes, one refresh');
  assert.equal(seen.refresh[0], 'ref-1');
  // The access token is invalidated early: the next call refreshes and retries once.
  validAccess = 'rotated-elsewhere';
  const before = seen.refresh.length;
  validAccess = 'nobody';
  await cg.chat({ id: 1 }, { model: 'gpt-x', msgs: [{ role: 'user', content: 'hi' }] });
  assert.equal(seen.refresh.length, before + 1);
  assert.match(seen.refresh.at(-1), /^ref-\d+$/, 'used the rotated refresh token');
  assert.notEqual(seen.refresh.at(-1), 'ref-1');
});

test('a reused refresh token marks the connection lost; a newer import is never overwritten by an old refresh', async () => {
  const { cg } = setup();
  cg.importCredentials(creds({ refresh_token: 'dead', expires_in: 1 }), { username: 'denis' });
  await assert.rejects(cg.chat({ id: 1 }, { model: 'gpt-x', msgs: [{ role: 'user', content: 'hi' }] }), (e) => e.status === 409);
  assert.equal(cg.status({ id: 1 }).lost, true);
  cg.importCredentials(creds({ access_token: validAccess, email: 'new@x' }), { username: 'denis' });
  const st = cg.status({ id: 1 });
  assert.equal(st.lost, false);
  assert.equal(st.email, 'new@x');
});
