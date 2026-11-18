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

const AUTH = 'https://auth.openai.com';
const TOKEN_URL = `${AUTH}/api/accounts/oauth/token`;
const API = 'https://api.openai.com/v1';
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
  const save = (c) => q.set.run('chatgpt_creds', encrypt(masterKey, JSON.stringify(c)));

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
    const creds = {
      client_id: c.client_id, access_token: c.access_token, refresh_token: c.refresh_token, id_token: c.id_token || null,
      scopes, email: c.email || '', sub: c.sub || '', issuer: c.issuer || AUTH,
      expires_at: Number(c.expires_at) || (now() + (Number(c.expires_in) || 3600) * 1000),
      saved_at: now(), owner_id: owner.id, owner_username: owner.username, host_id: hostId(), refreshed_at: null,
    };
    save(creds);
    modelsCache = null;
    return { ok: true, email: creds.email, owner: owner.username };
  }

  // One refresh at a time; the rotating refresh token is replaced together with the rest.
  let refreshing = null;
  async function freshToken() {
    const c = load();
    if (!c) throw new ChatGptError('The ChatGPT account is not connected.', 409);
    if (c.expires_at - now() > 5 * 60_000) return c;
    if (!refreshing) {
      refreshing = (async () => {
        const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: c.client_id, refresh_token: c.refresh_token, resource: RESOURCE });
        const r = await providerFetch(TOKEN_URL, { proxy, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), timeoutMs: 20_000 });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.access_token) {
          const lost = r.status === 400 || r.status === 401 || /invalid_grant|revoked|expired/i.test(String(data.error || ''));
          if (lost) { save({ ...load(), lost: true }); throw new ChatGptError('The ChatGPT connection has expired or was revoked. Reconnect it in Settings.', 409); }
          throw new ChatGptError(`Could not refresh the ChatGPT connection (HTTP ${r.status}).`, 424);
        }
        const scopes = data.scope ? String(data.scope).split(/\s+/).filter(Boolean) : c.scopes;
        const next = { ...load(), access_token: data.access_token, refresh_token: data.refresh_token || c.refresh_token, expires_at: now() + (Number(data.expires_in) || 3600) * 1000, scopes, refreshed_at: now(), lost: false };
        save(next);
        return next;
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  function status(user) {
    const c = load();
    if (!c) return { connected: false };
    return {
      connected: true, email: c.email, owner: c.owner_username, mine: user?.id === c.owner_id, lost: Boolean(c.lost),
      saved_at: c.saved_at, refreshed_at: c.refreshed_at, expires_at: c.expires_at, plan: c.scopes.includes(PLAN_SCOPE),
    };
  }

  // Models this account can use (visibility "list"), in OpenAI's order; kept an hour.
  let modelsCache = null;
  async function models(user) {
    const c = load();
    if (!c || c.lost || user?.id !== c.owner_id) return [];
    if (modelsCache && Date.now() - modelsCache.at < 3600_000) return modelsCache.list;
    try {
      const t = await freshToken();
      const r = await providerFetch(`${API}/models`, { proxy, headers: { authorization: `Bearer ${t.access_token}` }, timeoutMs: 20_000 });
      const data = await r.json().catch(() => ({}));
      const raw = Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data : [];
      const list = raw.filter((m) => (m.visibility ? m.visibility === 'list' : true)).map((m) => ({ slug: m.slug || m.id, name: m.display_name || m.slug || m.id })).filter((m) => m.slug);
      modelsCache = { at: Date.now(), list };
      return list;
    } catch (error) {
      log?.warn?.(`chatgpt models: ${error.message}`);
      return modelsCache?.list || [];
    }
  }

  // One answer through the Responses API (streamed; read to response.completed).
  async function chat(user, { model, msgs, images = [] }) {
    const c = load();
    if (!c) throw new ChatGptError('The ChatGPT account is not connected.', 409);
    if (user.id !== c.owner_id) throw new ChatGptError('This ChatGPT account belongs to someone else.', 403);
    const t = await freshToken();
    const instructions = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') || undefined;
    const input = msgs.filter((m) => m.role !== 'system').map((m, i, all) => {
      const last = i === all.length - 1 && m.role === 'user';
      const parts = [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }];
      if (last) for (const img of images) parts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.b64}` });
      return { role: m.role, content: parts };
    });
    const r = await providerFetch(`${API}/responses`, {
      proxy, method: 'POST', timeoutMs: 110_000,
      headers: { authorization: `Bearer ${t.access_token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ model, input, ...(instructions ? { instructions } : {}), store: false, stream: true }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let msg = text;
      try { msg = JSON.parse(text).error?.message || text; } catch { /* plain */ }
      if (r.status === 401) { modelsCache = null; throw new ChatGptError('ChatGPT refused the connection. Reconnect it in Settings.', 409); }
      throw new ChatGptError(`ChatGPT: ${String(msg).slice(0, 200) || `HTTP ${r.status}`}`, 424);
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
        const code = ev.response?.error?.code || ev.error?.code || ev.code || '';
        if (/subscription_sharing_usage_limit_exceeded/.test(code)) throw new ChatGptError('Your ChatGPT plan limit for apps is used up for now. Try later or pick another model.', 429);
        if (/subscription_sharing_usage_unavailable/.test(code)) throw new ChatGptError('ChatGPT plan usage is not available for this account right now.', 409);
        throw new ChatGptError(`ChatGPT failed: ${ev.response?.error?.message || code || 'unknown error'}`, 424);
      } else if (ev.type === 'response.incomplete') {
        done = true;
        if (!textOut) throw new ChatGptError(`ChatGPT stopped early (${ev.response?.incomplete_details?.reason || 'incomplete'}).`, 424);
      }
    };
    for await (const chunk of r.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (!data || data === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        handle(ev);
      }
    }
    if (!done) throw new ChatGptError('The ChatGPT answer was cut off. Try again.', 424);
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
