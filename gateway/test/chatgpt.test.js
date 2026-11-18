import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { loadMasterKey, encrypt } from '../src/crypto.js';
import { createChatGpt } from '../src/chatgpt.js';

// A fake OpenAI: token refresh (rotating), /models, /responses as SSE.
let server;
let base;
let respMode = 'ok';
const seen = { refresh: [], auth: [] };
let accessGen = 1;
let validAccess = 'acc-1';
// Signing key of the fake OpenAI (ID tokens).
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const codes = new Map(); // code -> { challenge, nonce, clientId }
let revoked = [];
let scopeOverride = null;
function idToken(claims) {
  const head = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64u(claims);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
// What OpenAI's sign-in would do with the link we made: a code for the callback.
function signIn(url, { email = 'wife@example.com', sub = 'user-wife' } = {}) {
  const u = new URL(url);
  const code = `code-${crypto.randomUUID()}`;
  const clientId = u.searchParams.get('client_id') === 'dynamic_agent_client' ? 'oaiapp_new' : u.searchParams.get('client_id');
  codes.set(code, { challenge: u.searchParams.get('code_challenge'), nonce: u.searchParams.get('nonce'), clientId, email, sub });
  return `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}${u.searchParams.get('client_id') === 'dynamic_agent_client' ? `&client_id=${clientId}` : ''}`;
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (req.url === '/auth/.well-known/openid-configuration') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ issuer: `${base}/auth`, jwks_uri: `${base}/auth/jwks`, revocation_endpoint: `${base}/auth/revoke` })); return; }
      if (req.url === '/auth/jwks') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; }
      if (req.url === '/auth/revoke') { revoked.push(new URLSearchParams(body).get('token')); res.end('{}'); return; }
      if (req.url === '/auth/api/accounts/oauth/token' && new URLSearchParams(body).get('grant_type') === 'authorization_code') {
        const f = new URLSearchParams(body);
        const c = codes.get(f.get('code'));
        res.setHeader('content-type', 'application/json');
        const pkce = c && crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') === c.challenge;
        if (!c || !pkce || f.get('client_id') !== c.clientId || f.get('redirect_uri') !== 'http://127.0.0.1:' + (process.env.TEST_CB_PORT || 1455) + '/auth/callback') { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid_grant' })); return; }
        codes.delete(f.get('code'));
        accessGen += 1;
        validAccess = `acc-${accessGen}`;
        res.end(JSON.stringify({ access_token: validAccess, refresh_token: `ref-${accessGen}`, expires_in: 3600, scope: scopeOverride || 'openid email offline_access chatgpt.tokens.use.direct',
          id_token: idToken({ iss: `${base}/auth`, aud: c.clientId, sub: c.sub, email: c.email, nonce: c.nonce, exp: Math.floor(Date.now() / 1000) + 600 }) }));
        return;
      }
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

function setup(extra = {}, seed = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-cg-'));
  const db = openDatabase(dir);
  db.prepare("INSERT INTO users (id, username, display_name, role, pw_hash, created_at) VALUES (1, 'denis', 'Denis', 'admin', 'x', 0), (2, 'kid', 'Kid', 'user', 'x', 0)").run();
  seed?.(db, loadMasterKey(dir, 'secret'));
  const config = { chatgptAuthBase: `${base}/auth`, chatgptApiBase: `${base}/api`, ...extra };
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
  await assert.rejects(cg.chat({ id: 2 }, { model: 'gpt-x', msgs: [{ role: 'user', content: 'hi' }] }), (e) => e.status === 409, 'no plan of their own, none shared');
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

test('connect from Settings: link with PKCE, pasted address finishes, ID token checked, each person their own plan', async () => {
  const { cg, db } = setup();
  const kid = { id: 2, username: 'kid', role: 'user' };
  const start = cg.startConnect(kid);
  const u = new URL(start.url);
  assert.equal(u.searchParams.get('client_id'), 'dynamic_agent_client', 'first time: registration');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:1455/auth/callback');
  assert.match(u.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
  const landed = signIn(start.url);
  // Someone else can't finish this person's sign-in; junk is refused.
  await assert.rejects(cg.finishConnect({ id: 1, username: 'denis' }, landed), /expired or belongs/);
  await assert.rejects(cg.finishConnect(kid, 'https://evil.example/auth/callback?code=x'), /not the sign-in address/);
  const out = await cg.finishConnect(kid, landed);
  assert.equal(out.email, 'wife@example.com');
  assert.equal(cg.status(kid).connected, true);
  assert.equal(cg.status({ id: 1 }).connected, false, 'the admin has no plan from this');
  const rec = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'chatgpt_reg:2'").get().value);
  assert.equal(rec.client_id, 'oaiapp_new');
  // The same address twice: the attempt is used up.
  await assert.rejects(cg.finishConnect(kid, landed), /expired/);
  // Next sign-in reuses the issued client id (no new registration).
  const again = new URL(cg.startConnect(kid).url);
  assert.equal(again.searchParams.get('client_id'), 'oaiapp_new');
  assert.equal(again.searchParams.get('login_hint'), 'wife@example.com');
  // Reconnect with the saved registration but another account: refused.
  await assert.rejects(cg.finishConnect(kid, signIn(cg.startConnect(kid).url, { sub: 'someone-else', email: 'x@y' })), /another ChatGPT account/);
  // A forged ID token (wrong nonce) is refused.
  const bad = signIn(cg.startConnect(kid).url);
  codes.get(new URL(bad).searchParams.get('code')).nonce = 'other';
  await assert.rejects(cg.finishConnect(kid, bad), /nonce/);
  // Refused sign-ins have their tokens revoked right away.
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(revoked.length >= 1, 'the other account’s tokens were revoked');
  // Disconnect revokes at OpenAI first; the registration stays for later.
  revoked = [];
  const d = await cg.disconnect(2);
  assert.equal(d.revoked, true);
  assert.equal(revoked.length, 1);
  assert.equal(cg.status(kid).connected, false);
  assert.ok(db.prepare("SELECT 1 FROM meta WHERE key = 'chatgpt_reg:2'").get());
});

test('plan use not allowed: the registration is kept, nothing usable stored', async () => {
  const { cg, db } = setup();
  const kid = { id: 2, username: 'kid', role: 'user' };
  const landed = signIn(cg.startConnect(kid).url);
  scopeOverride = 'openid email offline_access';
  await assert.rejects(cg.finishConnect(kid, landed), /was not allowed/);
  scopeOverride = null;
  assert.equal(JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'chatgpt_reg:2'").get().value).client_id, 'oaiapp_new');
  assert.equal(cg.status(kid).connected, false);
  assert.equal(new URL(cg.startConnect(kid).url).searchParams.get('client_id'), 'oaiapp_new', 'the next try reuses it');
});

test('same computer: Director catches the callback itself', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  process.env.TEST_CB_PORT = String(port);
  const { cg } = setup({ chatgptLoopback: true, chatgptCallbackPort: port });
  const kid = { id: 2, username: 'kid', role: 'user' };
  const start = cg.startConnect(kid);
  assert.equal(start.loopback, true);
  await new Promise((r) => setTimeout(r, 50));
  const page = await (await fetch(signIn(start.url))).text();
  assert.match(page, /ChatGPT connected/);
  assert.equal(cg.status(kid).connected, true);
  cg.closeListener();
  delete process.env.TEST_CB_PORT;
});

test('the older single-account record moves to its owner', async () => {
  const { cg } = setup({}, (db, key) => {
    db.prepare("INSERT INTO meta (key, value) VALUES ('chatgpt_creds', ?), ('chatgpt_sharing', 'all')").run(encrypt(key, JSON.stringify({ client_id: 'oaiapp_old', access_token: validAccess, refresh_token: 'r', scopes: ['chatgpt.tokens.use.direct'], email: 'd@x', sub: 's', owner_id: 1, owner_username: 'denis', expires_at: Date.now() + 3600_000, saved_at: 1, version: 'v' })));
  });
  assert.equal(cg.status({ id: 1 }).email, 'd@x');
  assert.equal(cg.status({ id: 1 }).sharing, 'all');
  assert.equal(cg.canUse({ id: 2 }), true, 'it was shared, so it still is');
});
