// ChatGPT plans as a text-model source ("Sign in with ChatGPT" plan usage,
// OpenAI's open-source / self-hosted flow). Each person here connects their
// own ChatGPT account; Docs: https://developers.openai.com/siwc/token-sharing-open-source
//   · one record per person: issued client id + tokens of that registration,
//     stored encrypted (never in logs, URLs or the browser);
//   · the registration (client id, account) is kept after a disconnect, so a
//     later sign-in to the same account reuses it (no new client);
//   · this server has one permanent host id (ext_agent_host_id);
//   · sign-in from Settings: the server makes PKCE / state / nonce and the
//     link. After the sign-in OpenAI sends the browser to 127.0.0.1:1455:
//       - Director on the same computer (DZ_CHATGPT_LOOPBACK=1): it listens
//         there itself, done automatically;
//       - Director on another machine: the page there doesn't open; the person
//         pastes that address into Settings and the server finishes;
//     the Mac helper (tools/connect-chatgpt.mjs) stays as another way in;
//   · answers: Responses API, store:false, stream:true; refreshes serialized
//     per record across processes; Disconnect revokes first, then forgets;
//   · an admin may share their own plan with everyone here (e.g. family
//     without plans of their own); a person's own plan always comes first.
import crypto from 'node:crypto';
import http from 'node:http';
import { providerFetch } from './providers/http.js';
import { encrypt, decrypt } from './crypto.js';
import { now } from './db.js';

const AUTH_DEFAULT = 'https://auth.openai.com';
const API_DEFAULT = 'https://api.openai.com/v1';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPE = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const APP_NAME = 'Director (self-hosted)';
const PENDING_MS = 15 * 60_000;

export class ChatGptError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function createChatGpt({ db, masterKey, config, log }) {
  const q = {
    get: db.prepare('SELECT value FROM meta WHERE key = ?'),
    set: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    del: db.prepare('DELETE FROM meta WHERE key = ?'),
    list: db.prepare("SELECT key, value FROM meta WHERE key LIKE 'chatgpt_creds:%'"),
    userByName: db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ?'),
    userById: db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?'),
  };
  const proxy = config.openaiProxy || '';
  // Overridable only for tests (a fake OpenAI on localhost).
  const AUTH = config.chatgptAuthBase || AUTH_DEFAULT;
  const API = config.chatgptApiBase || API_DEFAULT;
  const TOKEN_URL = `${AUTH}/api/accounts/oauth/token`;
  const AUTHORIZE_URL = `${AUTH}/api/accounts/authorize`;
  const PORT = Number(config.chatgptCallbackPort) || 1455;
  const REDIRECT = `http://127.0.0.1:${PORT}/auth/callback`;
  const loopbackOn = Boolean(config.chatgptLoopback);

  // This server's own, permanent host id.
  function hostId() {
    let id = q.get.get('chatgpt_host_id')?.value;
    if (!id) { id = `urn:uuid:${crypto.randomUUID()}`; q.set.run('chatgpt_host_id', id); }
    return id;
  }

  const credsKey = (uid) => `chatgpt_creds:${uid}`;
  const regKey = (uid) => `chatgpt_reg:${uid}`;
  const unbox = (boxed) => { try { return JSON.parse(decrypt(masterKey, boxed)); } catch (error) { log?.warn?.(`chatgpt credentials unreadable: ${error.message}`); return null; } };
  const load = (key) => { const boxed = q.get.get(key)?.value; return boxed ? unbox(boxed) : null; };
  const reg = (uid) => { try { return JSON.parse(q.get.get(regKey(uid))?.value || 'null'); } catch { return null; } };
  const saveReg = (uid, r) => q.set.run(regKey(uid), JSON.stringify({ client_id: r.client_id, sub: r.sub || '', email: r.email || '', saved_at: now() }));

  // Older single-account storage → this person's record (once).
  (function migrate() {
    const boxed = q.get.get('chatgpt_creds')?.value;
    if (!boxed) return;
    const c = unbox(boxed);
    if (c?.owner_id) {
      const shared = q.get.get('chatgpt_sharing')?.value === 'all';
      q.set.run(credsKey(c.owner_id), encrypt(masterKey, JSON.stringify({ ...c, shared })));
      saveReg(c.owner_id, c);
    }
    q.del.run('chatgpt_creds');
    q.del.run('chatgpt_sharing');
  })();

  // Compare-and-save: only replaces the record it started from, so a refresh
  // never undoes a newer sign-in (another process) or a disconnect.
  function casSave(key, expectVersion, next) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const cur = load(key);
      if (expectVersion !== null && (!cur || cur.version !== expectVersion)) { db.exec('ROLLBACK'); return null; }
      const saved = { ...next, version: crypto.randomUUID() };
      q.set.run(key, encrypt(masterKey, JSON.stringify(saved)));
      db.exec('COMMIT');
      return saved;
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* closed */ } throw error; }
  }

  const records = () => q.list.all().map((r) => ({ key: r.key, uid: Number(r.key.split(':')[1]), c: unbox(r.value) })).filter((r) => r.c);
  const sharedRecord = () => records().filter((r) => r.c.shared && !r.c.lost).sort((a, b) => a.c.saved_at - b.c.saved_at)[0] || null;

  // Which plan this person uses: their own (working) one, else the shared one.
  function recordFor(user) {
    if (!user) return null;
    const key = credsKey(user.id);
    const own = load(key);
    if (own && !own.lost) return { key, c: own, own: true };
    const shared = sharedRecord();
    if (shared) return { key: shared.key, c: shared.c, own: false };
    return own ? { key, c: own, own: true } : null; // own but lost: shows "reconnect"
  }
  const canUse = (user) => { const r = recordFor(user); return Boolean(r && !r.c.lost); };

  function store(user, tok, { clientId, claims, issuer }) {
    const scopes = Array.isArray(tok.scopes) ? tok.scopes : String(tok.scope || '').split(/\s+/).filter(Boolean);
    if (!scopes.includes(PLAN_SCOPE)) throw new ChatGptError('The ChatGPT plan permission was not granted. Sign in again and keep “Use your ChatGPT plan” on.');
    if (!clientId || clientId === 'dynamic_agent_client') throw new ChatGptError('Registration was not completed (no issued client id).');
    if (!tok.access_token || !tok.refresh_token) throw new ChatGptError('OpenAI did not return the tokens. Try again.');
    const key = credsKey(user.id);
    const prev = load(key);
    const creds = casSave(key, null, {
      client_id: clientId, access_token: tok.access_token, refresh_token: tok.refresh_token, id_token: tok.id_token || null,
      scopes, email: claims.email || '', sub: claims.sub || '', issuer: issuer || AUTH,
      expires_at: Number(tok.expires_at) || (now() + (Number(tok.expires_in) || 3600) * 1000),
      saved_at: now(), owner_id: user.id, owner_username: user.username, host_id: hostId(), refreshed_at: null, lost: false,
      shared: Boolean(prev?.shared && prev.sub === claims.sub),
    });
    saveReg(user.id, creds);
    modelsCache.delete(key);
    // Another account replaced the old one: its session is ended at OpenAI.
    if (prev && prev.refresh_token && prev.refresh_token !== creds.refresh_token) revoke(prev).catch(() => {});
    return creds;
  }

  // From the Mac helper (stdin of the import script).
  function importCredentials(raw, { username }) {
    let c;
    try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new ChatGptError('Not a credentials file.'); }
    const user = q.userByName.get(String(username || ''));
    if (!user) throw new ChatGptError(`No user “${username}” here.`);
    for (const k of ['client_id', 'access_token', 'refresh_token']) if (!c?.[k]) throw new ChatGptError(`Missing ${k}.`);
    const creds = store(user, c, { clientId: c.client_id, claims: { email: c.email, sub: c.sub }, issuer: c.issuer });
    return { ok: true, email: creds.email, owner: user.username };
  }

  // ── Sign-in from Settings ──────────────────────────────────────────────
  const pending = new Map(); // state -> { uid, verifier, nonce, clientId, at }
  const prune = () => { for (const [k, p] of pending) if (Date.now() - p.at > PENDING_MS) pending.delete(k); };

  function startConnect(user, { fresh = false } = {}) {
    prune();
    for (const [k, p] of pending) if (p.uid === user.id) pending.delete(k); // one attempt at a time per person
    const r = fresh ? null : reg(user.id);
    const state = b64url(crypto.randomBytes(24));
    const nonce = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const clientId = r?.client_id || 'dynamic_agent_client';
    const params = new URLSearchParams({
      client_id: clientId,
      ...(clientId === 'dynamic_agent_client' ? { agent_name_hint: APP_NAME } : {}),
      ext_agent_host_id: hostId(),
      response_type: 'code', redirect_uri: REDIRECT, scope: SCOPE, resource: RESOURCE,
      state, nonce, code_challenge_method: 'S256', code_challenge: challenge,
      ...(r?.email ? { login_hint: r.email } : {}),
    });
    pending.set(state, { uid: user.id, verifier, nonce, clientId, expectSub: r?.sub || '', at: Date.now() });
    if (loopbackOn) ensureListener();
    return { url: `${AUTHORIZE_URL}?${params}`, loopback: loopbackOn, expiresInMin: PENDING_MS / 60_000 };
  }

  // The address the browser landed on (pasted, or seen by our listener).
  async function finishConnect(user, callback) {
    let u;
    try {
      const text = String(callback || '').trim();
      u = new URL(/^https?:\/\//i.test(text) ? text : `${REDIRECT}${text.startsWith('?') ? '' : '?'}${text}`);
    } catch { throw new ChatGptError('Paste the whole address from the browser (it starts with http://127.0.0.1).'); }
    if (u.hostname !== '127.0.0.1' || u.pathname !== '/auth/callback') throw new ChatGptError('This is not the sign-in address. Paste the address of the page that did not open (http://127.0.0.1:1455/auth/callback?…).');
    prune();
    const p = pending.get(u.searchParams.get('state') || '');
    if (!p || p.uid !== user.id) throw new ChatGptError('This sign-in has expired or belongs to another attempt. Press “Connect ChatGPT” again.');
    pending.delete(u.searchParams.get('state'));
    if (u.searchParams.get('error')) throw new ChatGptError(`Sign-in was cancelled or refused (${u.searchParams.get('error')}).`);
    const code = u.searchParams.get('code');
    const issued = u.searchParams.get('client_id') || (p.clientId !== 'dynamic_agent_client' ? p.clientId : '');
    if (!code || !issued) throw new ChatGptError('The address has no sign-in code. Press “Connect ChatGPT” again.');
    if (p.clientId !== 'dynamic_agent_client' && issued !== p.clientId) throw new ChatGptError('The answer came for another app id. Press “Connect ChatGPT” again.');
    const r = await providerFetch(TOKEN_URL, {
      proxy, method: 'POST', timeoutMs: 20_000, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: issued, code, code_verifier: p.verifier, redirect_uri: REDIRECT, resource: RESOURCE }).toString(),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.access_token) throw new ChatGptError(`OpenAI did not accept the sign-in code (${tok.error || `HTTP ${r.status}`}). Codes live a few minutes — press “Connect ChatGPT” again.`, 424);
    const { claims, issuer } = await verifyIdToken(tok.id_token, { clientId: issued, nonce: p.nonce });
    const creds = store(q.userById.get(user.id) || user, tok, { clientId: issued, claims, issuer });
    return { ok: true, email: creds.email };
  }

  // ID token: OpenAI's signature (JWKS), issuer, audience, expiry, nonce.
  let jwksCache = null;
  async function verifyIdToken(idToken, { clientId, nonce }) {
    const [h, p, s] = String(idToken || '').split('.');
    if (!h || !p || !s) throw new ChatGptError('OpenAI returned no ID token.', 424);
    let header;
    let claims;
    try { header = JSON.parse(fromB64url(h).toString()); claims = JSON.parse(fromB64url(p).toString()); } catch { throw new ChatGptError('The ID token is unreadable.', 424); }
    if (!jwksCache || Date.now() - jwksCache.at > 3600_000 || !jwksCache.keys.some((k) => k.kid === header.kid)) {
      const conf = await (await providerFetch(`${AUTH}/.well-known/openid-configuration`, { proxy, timeoutMs: 15_000 })).json();
      const jwks = await (await providerFetch(conf.jwks_uri, { proxy, timeoutMs: 15_000 })).json();
      jwksCache = { at: Date.now(), issuer: conf.issuer || AUTH, keys: jwks.keys || [] };
    }
    const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
    if (!jwk) throw new ChatGptError('The ID token is signed with an unknown key.', 424);
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const data = Buffer.from(`${h}.${p}`);
    const sig = fromB64url(s);
    const ok = header.alg === 'RS256' ? crypto.verify('RSA-SHA256', data, key, sig)
      : header.alg === 'ES256' ? crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig) : false;
    if (!ok) throw new ChatGptError('The ID token signature is not valid.', 424);
    if (claims.iss !== jwksCache.issuer) throw new ChatGptError('The ID token issuer is wrong.', 424);
    if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(clientId)) throw new ChatGptError('The ID token is for another app.', 424);
    if (!claims.exp || claims.exp * 1000 < Date.now() - 60_000) throw new ChatGptError('The ID token has expired.', 424);
    if (claims.nonce !== nonce) throw new ChatGptError('The ID token nonce does not match.', 424);
    return { claims, issuer: claims.iss };
  }

  // Director on the same computer as the browser: catch the callback ourselves.
  let listener = null;
  let listenerTimer = null;
  function ensureListener() {
    clearTimeout(listenerTimer);
    listenerTimer = setTimeout(() => { if (!pending.size && listener) { listener.close(); listener = null; } }, PENDING_MS).unref?.();
    if (listener) return;
    listener = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
      const p = pending.get(u.searchParams.get('state') || '');
      const page = (title, text) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset=utf-8><title>${title}</title><body style="font:18px system-ui;padding:40px;background:#111;color:#eee"><h2>${title}</h2><p>${text}</p>`); };
      if (!p) { page('Something is off', 'This sign-in has expired. Go back to Director and press “Connect ChatGPT” again.'); return; }
      try {
        const out = await finishConnect({ id: p.uid }, `${REDIRECT}${u.search}`);
        page('ChatGPT connected', `${out.email ? `${out.email} — ` : ''}you can close this tab and go back to Director.`);
      } catch (error) {
        page('Not connected', `${String(error.message).replace(/[<>&]/g, '')} You can close this tab.`);
      }
    });
    listener.on('error', (error) => { log?.warn?.(`chatgpt callback listener: ${error.message}`); listener = null; });
    listener.listen(PORT, config.chatgptLoopbackHost || '127.0.0.1');
  }

  // ── Tokens ─────────────────────────────────────────────────────────────
  // A lease in the database per record, so only one process refreshes it
  // (the refresh token rotates: using an old one twice kills the connection).
  const leaseId = crypto.randomUUID();
  function takeLease(key) {
    const lk = `chatgpt_refresh_lease:${key}`;
    db.exec('BEGIN IMMEDIATE');
    try {
      const cur = q.get.get(lk)?.value;
      const until = Number(String(cur || '').split('|')[1] || 0);
      if (cur && until > Date.now() && !cur.startsWith(`${leaseId}|`)) { db.exec('ROLLBACK'); return false; }
      q.set.run(lk, `${leaseId}|${Date.now() + 45_000}`);
      db.exec('COMMIT');
      return true;
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* closed */ } throw error; }
  }
  const dropLease = (key) => { const lk = `chatgpt_refresh_lease:${key}`; if (String(q.get.get(lk)?.value || '').startsWith(`${leaseId}|`)) q.del.run(lk); };

  const TERMINAL = /^(invalid_grant|invalid_refresh_token|token_expired|refresh_token_expired|refresh_token_invalidated|refresh_token_reused)$/;
  const errCode = (data) => (typeof data?.error === 'string' ? data.error : data?.error?.code) || data?.code || '';

  const refreshing = new Map(); // key -> promise
  async function freshToken(key, { force = false } = {}) {
    const c = load(key);
    if (!c) throw new ChatGptError('The ChatGPT account is not connected.', 409);
    if (c.lost) throw new ChatGptError('The ChatGPT connection has expired or was revoked. Reconnect it in Settings.', 409);
    if (!force && c.expires_at - now() > 5 * 60_000) return c;
    if (!refreshing.has(key)) refreshing.set(key, doRefresh(key, c.version).finally(() => refreshing.delete(key)));
    return refreshing.get(key);
  }
  async function doRefresh(key, startVersion) {
    const deadline = Date.now() + 30_000;
    while (!takeLease(key)) {
      if (Date.now() > deadline) throw new ChatGptError('Another refresh of the ChatGPT connection is still running. Try again.', 503);
      await new Promise((res) => setTimeout(res, 500));
    }
    try {
      const c = load(key);
      if (!c) throw new ChatGptError('The ChatGPT account is not connected.', 409);
      if (c.version !== startVersion && !c.lost && c.expires_at - now() > 60_000) return c; // someone else refreshed or signed in again
      const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: c.client_id, refresh_token: c.refresh_token, resource: RESOURCE });
      const r = await providerFetch(TOKEN_URL, { proxy, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), timeoutMs: 20_000 });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.access_token) {
        const code = errCode(data);
        if (TERMINAL.test(code)) {
          casSave(key, c.version, { ...c, lost: true });
          throw new ChatGptError('The ChatGPT connection has expired or was revoked. Reconnect it in Settings.', 409);
        }
        if (code === 'invalid_client') throw new ChatGptError('OpenAI does not accept this app’s client id (invalid_client). Reconnect it in Settings.', 424);
        throw new ChatGptError(`Could not refresh the ChatGPT connection (HTTP ${r.status}${code ? `, ${code}` : ''}). It stays connected; try again later.`, 503);
      }
      const scopes = data.scope ? String(data.scope).split(/\s+/).filter(Boolean) : c.scopes;
      const next = { ...c, access_token: data.access_token, refresh_token: data.refresh_token || c.refresh_token, id_token: data.id_token || c.id_token, expires_at: now() + (Number(data.expires_in) || 3600) * 1000, scopes, refreshed_at: now(), lost: false };
      const saved = casSave(key, c.version, next);
      if (saved) return saved;
      const cur = load(key); // replaced meanwhile (new sign-in or disconnect)
      if (!cur) throw new ChatGptError('The ChatGPT account was disconnected.', 409);
      return cur;
    } finally { dropLease(key); }
  }

  // ── What Settings and the model lists see ──────────────────────────────
  function status(user) {
    const own = user ? load(credsKey(user.id)) : null;
    const shared = sharedRecord();
    const base = { loopback: loopbackOn, usable: canUse(user) };
    const sharedInfo = shared && shared.uid !== user?.id ? { email: shared.c.email, owner: shared.c.owner_username } : null;
    if (!own) return { ...base, connected: false, registered: Boolean(reg(user?.id)?.client_id), shared: sharedInfo };
    return {
      ...base, connected: true, email: own.email, owner: own.owner_username, mine: true, lost: Boolean(own.lost), sharing: own.shared ? 'all' : 'owner',
      saved_at: own.saved_at, refreshed_at: own.refreshed_at, expires_at: own.expires_at, plan: own.scopes.includes(PLAN_SCOPE), shared: sharedInfo,
    };
  }
  // Admin overview: who has connected (no tokens).
  const accounts = () => records().map((r) => ({ userId: r.uid, username: r.c.owner_username, email: r.c.email, shared: Boolean(r.c.shared), lost: Boolean(r.c.lost), saved_at: r.c.saved_at }));
  const sharing = () => (sharedRecord() ? 'all' : 'owner');

  // An admin shares their own plan with everyone here (or stops).
  function setShared(user, on) {
    if (user.role !== 'admin') throw new ChatGptError('Only an admin can share a plan with everyone.', 403);
    const key = credsKey(user.id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const c = load(key);
      if (!c) throw new ChatGptError('Connect your ChatGPT first.', 409);
      if (casSave(key, c.version, { ...c, shared: Boolean(on) })) break;
    }
    if (on) for (const r of records()) if (r.uid !== user.id && r.c.shared) casSave(r.key, r.c.version, { ...r.c, shared: false }); // one shared plan
    return sharing();
  }

  // Models this person can use (visibility "list"), kept an hour per record.
  const modelsCache = new Map();
  async function models(user) {
    const rec = recordFor(user);
    if (!rec || rec.c.lost) return [];
    const hit = modelsCache.get(rec.key);
    if (hit && hit.sub === rec.c.sub && Date.now() - hit.at < 3600_000) return hit.list;
    try {
      const t = await freshToken(rec.key);
      const r = await providerFetch(`${API}/models`, { proxy, headers: { authorization: `Bearer ${t.access_token}` }, timeoutMs: 20_000 });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const list = (Array.isArray(data.models) ? data.models : []).filter((m) => m.visibility === 'list' && m.slug).map((m) => ({ slug: m.slug, name: m.display_name || m.slug }));
      modelsCache.set(rec.key, { at: Date.now(), sub: rec.c.sub, list });
      return list;
    } catch (error) {
      log?.warn?.(`chatgpt models: ${error.message}`);
      return hit && hit.sub === rec.c.sub ? hit.list : [];
    }
  }

  // Plain-language errors, keeping OpenAI's code; statuses as documented.
  function inferenceError(status, code, detail) {
    const tail = code ? ` (${code})` : '';
    if (code === 'subscription_sharing_usage_limit_exceeded') return new ChatGptError('Your ChatGPT plan limit for apps is used up for now. Pick another model or try later.', 429);
    if (/^subscription_sharing_(usage|user)_unavailable$/.test(code)) return new ChatGptError('ChatGPT plan usage is unavailable right now. Try again in a few minutes.', 503);
    if (code === 'subscription_sharing_unsupported_capability') return new ChatGptError(`ChatGPT can’t take this kind of input${tail}. Remove the images or try another model.`, 400);
    if (status === 401) return new ChatGptError(`ChatGPT did not accept this connection${tail}. If it keeps happening, reconnect in Settings.`, 409);
    if (status === 403) return new ChatGptError(`ChatGPT refused this request${tail}${detail ? `: ${detail}` : ''}.`, 403);
    if (status === 429) return new ChatGptError(`ChatGPT says: too many requests${tail}. Try later.`, 429);
    if (status >= 500) return new ChatGptError(`ChatGPT is unavailable right now${tail}. Try again in a few minutes.`, 503);
    return new ChatGptError(`ChatGPT: ${String(detail || code || `HTTP ${status}`).slice(0, 200)}`, 424);
  }

  // One answer through the Responses API (streamed; only response.completed is success).
  async function chat(user, { model, msgs, images = [] }) {
    const rec = recordFor(user);
    if (!rec) throw new ChatGptError('Connect your ChatGPT in Settings first.', 409);
    if (rec.c.lost) throw new ChatGptError('Your ChatGPT connection has expired or was revoked. Reconnect it in Settings.', 409);
    const instructions = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') || undefined;
    const input = msgs.filter((m) => m.role !== 'system').map((m, i, all) => {
      const last = i === all.length - 1 && m.role === 'user';
      const parts = [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }];
      if (last) for (const img of images) parts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.b64}` });
      return { role: m.role, content: parts };
    });
    const payload = JSON.stringify({ model, input, ...(instructions ? { instructions } : {}), store: false, stream: true });
    let r;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const t = await freshToken(rec.key, { force: attempt > 0 });
      r = await providerFetch(`${API}/responses`, {
        proxy, method: 'POST', timeoutMs: 110_000,
        headers: { authorization: `Bearer ${t.access_token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: payload,
      });
      if (r.status !== 401 || attempt > 0) break;
      await r.body?.cancel?.().catch?.(() => {}); // stale access token: refresh once and retry
    }
    const reqId = r.headers.get('x-request-id') || r.headers.get('openai-request-id') || '';
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let data = {};
      try { data = JSON.parse(text); } catch { /* plain */ }
      const code = data?.error?.code || '';
      const detail = data?.error?.message || data?.detail || text.slice(0, 200);
      if (reqId) log?.warn?.(`chatgpt responses HTTP ${r.status} ${code} request ${reqId}`);
      throw inferenceError(r.status, code, detail);
    }
    let textOut = '';
    let usage = { in: 0, out: 0 };
    let done = false;
    let buffer = '';
    const decoder = new TextDecoder();
    const handle = (ev) => {
      if (ev.type === 'response.output_text.delta') textOut += ev.delta || '';
      else if (ev.type === 'response.completed') {
        done = true;
        const u = ev.response?.usage || {};
        usage = { in: Number(u.input_tokens || 0), out: Number(u.output_tokens || 0) };
      } else if (ev.type === 'response.failed' || ev.type === 'error') {
        const err = ev.response?.error || ev.error || ev;
        throw inferenceError(424, err.code || '', err.message || '');
      } else if (ev.type === 'response.incomplete') {
        throw new ChatGptError(`ChatGPT stopped before finishing (${ev.response?.incomplete_details?.reason || 'incomplete'}). Try again.`, 424);
      }
    };
    // Server-sent events: blank line ends an event; data lines join with "\n".
    const flush = (block) => {
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (!data || data === '[DONE]') return;
      let ev;
      try { ev = JSON.parse(data); } catch { return; }
      handle(ev);
    };
    const drain = (final) => {
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n');
      if (final) buffer = buffer.replace(/\r$/, '\n');
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, i); buffer = buffer.slice(i + 2); flush(block); }
      if (final && buffer.trim()) { const block = buffer; buffer = ''; flush(block); }
    };
    try {
      for await (const chunk of r.body) {
        buffer += decoder.decode(chunk, { stream: true });
        drain(false);
        if (done) break;
      }
      if (!done) { buffer += decoder.decode(); drain(true); }
    } finally {
      if (!r.body.locked) await r.body.cancel?.().catch?.(() => {});
    }
    if (!done) throw new ChatGptError('The ChatGPT answer was cut off. Try again.', 424);
    if (reqId && !textOut) log?.warn?.(`chatgpt empty answer, request ${reqId}`);
    return { text: textOut.trim(), usage, finish: 'stop' };
  }

  async function revoke(c) {
    const conf = await (await providerFetch(`${AUTH}/.well-known/openid-configuration`, { proxy, timeoutMs: 15_000 })).json();
    if (!conf.revocation_endpoint) return false;
    const body = new URLSearchParams({ token: c.refresh_token, token_type_hint: 'refresh_token', client_id: c.client_id });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const r = await providerFetch(conf.revocation_endpoint, { proxy, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), timeoutMs: 15_000 });
      if (r.ok) return true;
      if (r.status < 500) return false;
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    }
    return false;
  }

  // Revoke at OpenAI first, then forget the tokens (the registration stays).
  async function disconnect(userId) {
    const key = credsKey(userId);
    const c = load(key);
    if (!c) return { ok: true, revoked: true };
    let revoked = false;
    try { revoked = await revoke(c); } catch (error) { log?.warn?.(`chatgpt revoke: ${error.message}`); }
    q.del.run(key);
    modelsCache.delete(key);
    return { ok: true, revoked };
  }

  return { status, accounts, models, chat, importCredentials, startConnect, finishConnect, disconnect, hostId, sharing, setShared, canUse, closeListener: () => { listener?.close(); listener = null; } };
}
