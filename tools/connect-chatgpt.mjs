#!/usr/bin/env node
// Director — connect your ChatGPT plan (one-time, on your Mac).
//
// What it does (OpenAI "Sign in with ChatGPT" plan usage, open-source flow):
//   1. opens the OpenAI sign-in in your browser (PKCE S256, state, nonce,
//      callback on 127.0.0.1:1455 — only this Mac can receive it);
//   2. you allow "Use your ChatGPT plan";
//   3. checks the ID token signature (OpenAI's JWKS), issuer, audience, nonce,
//      expiry, and that the plan permission was really granted;
//   4. writes the credentials ONLY to a pipe (never to the screen or a file),
//      so they go straight to the server over SSH:
//
//   node connect-chatgpt.mjs | ssh stand 'cd ~/projects/ai-video-platform && docker compose exec -T gateway node src/import-chatgpt.mjs denis'
//
// Kept on this Mac (no tokens): ~/.config/director-chatgpt/registration.json
// with this Mac's host id and the issued client id, to reuse on reconnect.
// Needs Node 18+. No other packages.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const AUTH = 'https://auth.openai.com';
const AUTHORIZE = `${AUTH}/api/accounts/authorize`;
const TOKEN = `${AUTH}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PORT = Number(process.env.DIRECTOR_CALLBACK_PORT || 1455);
const REDIRECT = `http://127.0.0.1:${PORT}/auth/callback`;
const APP_NAME = 'Director (self-hosted)';
const DIR = path.join(os.homedir(), '.config', 'director-chatgpt');
const REG = path.join(DIR, 'registration.json');

const say = (m) => process.stderr.write(`${m}\n`);
if (process.stdout.isTTY) {
  say('Pipe this into the server, so the tokens never show on screen:');
  say("  node connect-chatgpt.mjs | ssh stand 'cd ~/projects/ai-video-platform && docker compose exec -T gateway node src/import-chatgpt.mjs denis'");
  process.exit(2);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function loadReg() {
  try { return JSON.parse(fs.readFileSync(REG, 'utf8')); } catch { return {}; }
}
function saveReg(reg) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${REG}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, REG);
}

async function verifyIdToken(idToken, { clientId, nonce }) {
  const [h, p, s] = String(idToken || '').split('.');
  if (!h || !p || !s) throw new Error('No ID token.');
  const header = JSON.parse(fromB64url(h).toString());
  const claims = JSON.parse(fromB64url(p).toString());
  const conf = await (await fetch(`${AUTH}/.well-known/openid-configuration`)).json();
  const jwks = await (await fetch(conf.jwks_uri)).json();
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('The ID token is signed with an unknown key.');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const data = Buffer.from(`${h}.${p}`);
  const sig = fromB64url(s);
  const alg = header.alg;
  const ok = alg === 'RS256' ? crypto.verify('RSA-SHA256', data, key, sig)
    : alg === 'ES256' ? crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)
      : false;
  if (!ok) throw new Error(`The ID token signature is not valid (${alg}).`);
  const iss = conf.issuer || AUTH;
  if (claims.iss !== iss && claims.iss !== AUTH) throw new Error('The ID token issuer is wrong.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('The ID token is for another app.');
  if (!claims.exp || claims.exp * 1000 < Date.now() - 60_000) throw new Error('The ID token has expired.');
  if (claims.nonce !== nonce) throw new Error('The ID token nonce does not match.');
  return { claims, issuer: claims.iss };
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* shown below */ }
}

const reg = loadReg();
reg.host_id ||= `urn:uuid:${crypto.randomUUID()}`; // this Mac's host id (the server keeps its own)
saveReg(reg);
const firstTime = !reg.client_id;
const state = b64url(crypto.randomBytes(24));
const nonce = b64url(crypto.randomBytes(24));
const verifier = b64url(crypto.randomBytes(48));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

const params = new URLSearchParams({
  client_id: firstTime ? 'dynamic_agent_client' : reg.client_id,
  ...(firstTime ? { agent_name_hint: APP_NAME } : {}),
  ext_agent_host_id: reg.host_id,
  response_type: 'code',
  redirect_uri: REDIRECT,
  scope: SCOPE,
  resource: RESOURCE,
  state,
  nonce,
  code_challenge_method: 'S256',
  code_challenge: challenge,
  ...(reg.email ? { login_hint: reg.email } : {}),
});
const url = `${AUTHORIZE}?${params}`;

const result = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
    const page = (title, text) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset=utf-8><title>${title}</title><body style="font:18px system-ui;padding:40px;background:#111;color:#eee"><h2>${title}</h2><p>${text}</p>`); };
    if (u.searchParams.get('state') !== state) { page('Something is off', 'The sign-in answer did not match. Close this tab and run the helper again.'); return; }
    server.close();
    if (u.searchParams.get('error')) { page('Not connected', 'Sign-in was cancelled or refused. You can close this tab.'); reject(new Error(`Sign-in refused: ${u.searchParams.get('error')}`)); return; }
    const code = u.searchParams.get('code');
    const issued = u.searchParams.get('client_id') || reg.client_id;
    if (!code || !issued || issued === 'dynamic_agent_client') { page('Not connected', 'Registration did not finish. Run the helper again.'); reject(new Error('No code or issued client id in the answer.')); return; }
    page('Signed in', 'You can close this tab and go back to the terminal.');
    resolve({ code, clientId: issued });
  });
  server.on('error', (e) => reject(new Error(`Can't listen on 127.0.0.1:${PORT}: ${e.message}`)));
  server.listen(PORT, '127.0.0.1', () => {
    say('Opening the OpenAI sign-in in your browser…');
    say('If it does not open, paste this into the browser on this Mac:');
    say(url);
    openBrowser(url);
  });
  setTimeout(() => { server.close(); reject(new Error('Timed out waiting for the sign-in (5 min).')); }, 5 * 60_000).unref();
});

const tokenRes = await fetch(TOKEN, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', client_id: result.clientId, code: result.code, code_verifier: verifier, redirect_uri: REDIRECT, resource: RESOURCE }).toString(),
});
const tok = await tokenRes.json().catch(() => ({}));
if (!tokenRes.ok || !tok.access_token) {
  say(`Token exchange failed (${tokenRes.status} ${tok.error || ''}). Run the helper again.`);
  process.exit(1);
}
const scopes = String(tok.scope || '').split(/\s+/).filter(Boolean);
if (!scopes.includes('chatgpt.tokens.use.direct')) {
  say('Signed in, but "Use your ChatGPT plan" was not allowed. Run again and keep it on.');
  process.exit(1);
}
const { claims, issuer } = await verifyIdToken(tok.id_token, { clientId: result.clientId, nonce });
// Remember the registration (no tokens) for the next sign-in.
saveReg({ ...reg, client_id: result.clientId, email: claims.email || reg.email || '', sub: claims.sub, saved_at: Date.now() });

process.stdout.write(JSON.stringify({
  client_id: result.clientId,
  access_token: tok.access_token,
  refresh_token: tok.refresh_token,
  id_token: tok.id_token,
  token_type: tok.token_type,
  expires_in: tok.expires_in,
  expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
  scopes,
  email: claims.email || '',
  sub: claims.sub,
  issuer,
  saved_at: Date.now(),
}));
say(`Signed in as ${claims.email || claims.sub}. Sending to the server…`);
