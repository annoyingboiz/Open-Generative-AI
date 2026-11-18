// Denis's ChatGPT plan as a text-model source ("Sign in with ChatGPT" plan
// usage, OpenAI's open-source / self-hosted VM flow):
//   · sign-in happens once on the Mac (tools/connect-chatgpt.mjs); the tokens
//     come here over SSH and are stored encrypted (never in chat, logs or URLs);
//   · this server keeps its own host id and refreshes the access token itself;
//   · answers come from the Responses API with store:false, stream:true;
//   · only the account's owner (the person it was connected for) can use it,
//     it costs nothing here (the plan pays) and never falls back to paid API;
//   · Disconnect revokes the refresh token at OpenAI, then deletes it here.
// Docs: https://developers.openai.com/siwc/token-sharing-open-source
import crypto from 'node:crypto';
import { providerFetch } from './providers/http.js';
import { encrypt, decrypt } from './crypto.js';
import { now } from './db.js';

const AUTH_DEFAULT = 'https://auth.openai.com';
const API_DEFAULT = 'https://api.openai.com/v1';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';

export class ChatGptError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function createChatGpt({ db, masterKey, config, log }) {
  const q = {
    get: db.prepare('SELECT value FROM meta WHERE key = ?'),
    set: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    del: db.prepare('DELETE FROM meta WHERE key = ?'),
    user: db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ?'),
  };
  const proxy = config.openaiProxy || '';
  // Overridable only for tests (a fake OpenAI on localhost).
  const AUTH = config.chatgptAuthBase || AUTH_DEFAULT;
  const API = config.chatgptApiBase || API_DEFAULT;
  const TOKEN_URL = `${AUTH}/api/accounts/oauth/token`;

  // This server's own, permanent host id (never the Mac's).
  function hostId() {
    let id = q.get.get('chatgpt_host_id')?.value;
    if (!id) { id = `urn:uuid:${crypto.randomUUID()}`; q.set.run('chatgpt_host_id', id); }
    return id;
  }

  function load() {
    const boxed = q.get.get('chatgpt_creds')?.value;
    if (!boxed) return null;
    try { return JSON.parse(decrypt(masterKey, boxed)); } catch (error) { log?.warn?.(`chatgpt credentials unreadable: ${error.message}`); return null; }
  }
  const newVersion = () => crypto.randomUUID();
  // Compare-and-save: only replaces the credentials it started from, so a refresh
  // never undoes a newer import (another process) or a disconnect.
  function casSave(expectVersion, next) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const cur = load();
      if (expectVersion !== null && (!cur || cur.version !== expectVersion)) { db.exec('ROLLBACK'); return null; }
      const saved = { ...next, version: newVersion() };
      q.set.run('chatgpt_creds', encrypt(masterKey, JSON.stringify(saved)));
      db.exec('COMMIT');
      return saved;
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* closed */ } throw error; }
  }

  // From the Mac helper (stdin of the import script). Checks the plan permission,
  // keeps this server's host id, binds the connection to one person here.
  function importCredentials(raw, { username }) {
    let c;
    try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new ChatGptError('Not a credentials file.'); }
    const owner = q.user.get(String(username || ''));
    if (!owner) throw new ChatGptError(`No user “${username}” here.`);
    const scopes = Array.isArray(c?.scopes) ? c.scopes : String(c?.scope || '').split(/\s+/).filter(Boolean);
    if (!scopes.includes(PLAN_SCOPE)) throw new ChatGptError('The ChatGPT plan permission was not granted. Sign in again and keep “Use your ChatGPT plan” on.');
    for (const k of ['client_id', 'access_token', 'refresh_token']) if (!c?.[k]) throw new ChatGptError(`Missing ${k}.`);
    if (c.client_id === 'dynamic_agent_client') throw new ChatGptError('Registration was not completed (no issued client id).');
    const creds = casSave(null, {
      client_id: c.client_id, access_token: c.access_token, refresh_token: c.refresh_token, id_token: c.id_token || null,
      scopes, email: c.email || '', sub: c.sub || '', issuer: c.issuer || AUTH,
      expires_at: Number(c.expires_at) || (now() + (Number(c.expires_in) || 3600) * 1000),
      saved_at: now(), owner_id: owner.id, owner_username: owner.username, host_id: hostId(), refreshed_at: null, lost: false,
    });
    return { ok: true, email: creds.email, owner: owner.username };
  }

  // A lease in the database, so only one process refreshes at a time (the
  // refresh token rotates: using an old one twice kills the connection).
  const leaseId = crypto.randomUUID();
  function takeLease() {
    db.exec('BEGIN IMMEDIATE');
    try {
      const cur = q.get.get('chatgpt_refresh_lease')?.value;
      const until = Number(String(cur || '').split('|')[1] || 0);
      if (cur && until > Date.now() && !cur.startsWith(`${leaseId}|`)) { db.exec('ROLLBACK'); return false; }
      q.set.run('chatgpt_refresh_lease', `${leaseId}|${Date.now() + 45_000}`);
      db.exec('COMMIT');
      return true;
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* closed */ } throw error; }
  }
  const dropLease = () => { if (String(q.get.get('chatgpt_refresh_lease')?.value || '').startsWith(`${leaseId}|`)) q.del.run('chatgpt_refresh_lease'); };

  const TERMINAL = /^(invalid_grant|invalid_refresh_token|token_expired|refresh_token_expired|refresh_token_invalidated|refresh_token_reused)$/;
  const errCode = (data) => (typeof data?.error === 'string' ? data.error : data?.error?.code) || data?.code || '';

  let refreshing = null;
  async function freshToken({ force = false } = {}) {
    const c = load();
    if (!c) throw new ChatGptError('The ChatGPT account is not connected.', 409);
    if (c.lost) throw new ChatGptError('The ChatGPT connection has expired or was revoked. Reconnect it in Settings.', 409);
    if (!force && c.expires_at - now() > 5 * 60_000) return c;
    if (!refreshing) refreshing = doRefresh(c.version).finally(() => { refreshing = null; });
    return refreshing;
  }
  async function doRefresh(startVersion) {
    const deadline = Date.now() + 30_000;
    while (!takeLease()) {
      if (Date.now() > deadline) throw new ChatGptError('Another refresh of the ChatGPT connection is still running. Try again.', 503);
      await new Promise((res) => setTimeout(res, 500));
    }
    try {
      const c = load();
      if (!c) throw new ChatGptError('The ChatGPT account is not connected.', 409);
      if (c.version !== startVersion && !c.lost && c.expires_at - now() > 60_000) return c; // someone else refreshed or re-imported
      const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: c.client_id, refresh_token: c.refresh_token, resource: RESOURCE });
      const r = await providerFetch(TOKEN_URL, { proxy, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), timeoutMs: 20_000 });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.access_token) {
        const code = errCode(data);
        if (TERMINAL.test(code)) {
          casSave(c.version, { ...c, lost: true });
          throw new ChatGptError('The ChatGPT connection has expired or was revoked. Reconnect it in Settings.', 409);
        }
        if (code === 'invalid_client') throw new ChatGptError('OpenAI does not accept this app’s client id (invalid_client). Reconnect from the Mac to register again.', 424);
        throw new ChatGptError(`Could not refresh the ChatGPT connection (HTTP ${r.status}${code ? `, ${code}` : ''}). It stays connected; try again later.`, 503);
      }
      const scopes = data.scope ? String(data.scope).split(/\s+/).filter(Boolean) : c.scopes;
      const next = { ...c, access_token: data.access_token, refresh_token: data.refresh_token || c.refresh_token, id_token: data.id_token || c.id_token, expires_at: now() + (Number(data.expires_in) || 3600) * 1000, scopes, refreshed_at: now(), lost: false };
      const saved = casSave(c.version, next);
      if (saved) return saved;
      const cur = load(); // replaced meanwhile (new import or disconnect)
      if (!cur) throw new ChatGptError('The ChatGPT account was disconnected.', 409);
      return cur;
    } finally { dropLease(); }
  }

  function status(user) {
    const c = load();
    if (!c) return { connected: false };
    return {
      connected: true, email: c.email, owner: c.owner_username, mine: user?.id === c.owner_id, lost: Boolean(c.lost),
      saved_at: c.saved_at, refreshed_at: c.refreshed_at, expires_at: c.expires_at, plan: c.scopes.includes(PLAN_SCOPE),
    };
  }

  // Models this account can use (visibility "list"), in OpenAI's order; kept an
  // hour per credentials version (a new import starts a fresh list).
  let modelsCache = null;
  async function models(user) {
    const c = load();
    if (!c || c.lost || user?.id !== c.owner_id) return [];
    if (modelsCache && modelsCache.sub === c.sub && modelsCache.client === c.client_id && Date.now() - modelsCache.at < 3600_000) return modelsCache.list;
    try {
      const t = await freshToken();
      const r = await providerFetch(`${API}/models`, { proxy, headers: { authorization: `Bearer ${t.access_token}` }, timeoutMs: 20_000 });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const raw = Array.isArray(data.models) ? data.models : [];
      const list = raw.filter((m) => m.visibility === 'list' && m.slug).map((m) => ({ slug: m.slug, name: m.display_name || m.slug }));
      modelsCache = { at: Date.now(), sub: c.sub, client: c.client_id, list };
      return list;
    } catch (error) {
      log?.warn?.(`chatgpt models: ${error.message}`);
      return modelsCache && modelsCache.sub === c.sub ? modelsCache.list : [];
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
    const c = load();
    if (!c) throw new ChatGptError('The ChatGPT account is not connected.', 409);
    if (user.id !== c.owner_id) throw new ChatGptError('This ChatGPT account belongs to someone else.', 403);
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
      const t = await freshToken({ force: attempt > 0 });
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

  // Revoke at OpenAI first, then forget here.
  async function disconnect() {
    const c = load();
    if (!c) return { ok: true, revoked: true };
    let revoked = false;
    try {
      const conf = await (await providerFetch(`${AUTH}/.well-known/openid-configuration`, { proxy, timeoutMs: 15_000 })).json();
      if (conf.revocation_endpoint) {
        const body = new URLSearchParams({ token: c.refresh_token, token_type_hint: 'refresh_token', client_id: c.client_id });
        for (let attempt = 0; attempt < 3 && !revoked; attempt += 1) {
          const r = await providerFetch(conf.revocation_endpoint, { proxy, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), timeoutMs: 15_000 });
          if (r.ok) revoked = true; else if (r.status < 500) break; else await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
        }
      }
    } catch (error) { log?.warn?.(`chatgpt revoke: ${error.message}`); }
    q.del.run('chatgpt_creds');
    modelsCache = null;
    return { ok: true, revoked };
  }

  return { status, models, chat, importCredentials, disconnect, hostId };
}
