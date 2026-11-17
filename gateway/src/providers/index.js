// Provider registry and per-provider settings (key + proxy).
// To add a provider: create a module next to apimart.js / atlas.js that
// exports the same shape, and list it in PROVIDERS below.
import { apimart } from './apimart.js';
import { atlas } from './atlas.js';
import { fal } from './fal.js';
import { encrypt, decrypt, maskSecret } from '../crypto.js';
import { now } from '../db.js';

export const PROVIDERS = [apimart, atlas, fal];

// Shows a proxy without its password: socks5h://user:••••@host:port
function maskProxy(value) {
  try {
    const u = new URL(value);
    if (u.password) u.password = '••••';
    return u.password || u.username ? u.toString() : value;
  } catch { return value || ''; }
}
export const providerById = (id) => PROVIDERS.find((p) => p.id === id);

export function createProviderSettings({ db, masterKey, envDefaults }) {
  const getRow = db.prepare('SELECT * FROM provider_settings WHERE provider = ?');
  const upsert = db.prepare(`
    INSERT INTO provider_settings (provider, api_key_enc, proxy_url, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      api_key_enc = excluded.api_key_enc,
      proxy_url = excluded.proxy_url,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);

  // Full config for server-side use only. Never send to the browser.
  function resolve(id) {
    const row = getRow.get(id);
    const env = envDefaults[id] || {};
    let apiKey = '';
    let keySource = 'none';
    if (row?.api_key_enc) {
      apiKey = decrypt(masterKey, row.api_key_enc);
      keySource = 'settings';
    } else if (env.apiKey) {
      apiKey = env.apiKey;
      keySource = 'env';
    }
    const proxy = row ? (row.proxy_url || '') : (env.proxy || '');
    const enabled = row ? Boolean(row.enabled) : true;
    return { id, apiKey, proxy, enabled, keySource };
  }

  // Safe view for the settings page.
  function publicView(id) {
    const c = resolve(id);
    return {
      id,
      name: providerById(id)?.name || id,
      keysUrl: providerById(id)?.keysUrl,
      hasKey: Boolean(c.apiKey),
      keyMask: maskSecret(c.apiKey),
      keySource: c.keySource,
      proxy: maskProxy(c.proxy),
      enabled: c.enabled,
    };
  }

  function save(id, { apiKey, clearKey, proxy, enabled }) {
    const current = getRow.get(id);
    let apiKeyEnc = current?.api_key_enc ?? null;
    if (clearKey) apiKeyEnc = null;
    else if (apiKey) apiKeyEnc = encrypt(masterKey, apiKey.trim());
    const keepProxy = typeof proxy === 'string' && proxy.includes('••••') && current?.proxy_url;
    upsert.run(id, apiKeyEnc, keepProxy ? current.proxy_url : (proxy ?? current?.proxy_url ?? ''), enabled ? 1 : 0, now());
  }

  return { resolve, publicView, save };
}

// Balance of every enabled provider with a key. Errors are reported per provider.
export async function fetchBalances(settings) {
  return Promise.all(PROVIDERS.map(async (provider) => {
    const c = settings.resolve(provider.id);
    const base = { id: provider.id, name: provider.name, enabled: c.enabled, hasKey: Boolean(c.apiKey) };
    if (!c.enabled || !c.apiKey) return { ...base, ok: false };
    try {
      const b = await provider.balance(c);
      return { ...base, ok: true, amount: b.amount, currency: b.currency, note: b.note || null };
    } catch (error) {
      return { ...base, ok: false, error: error.message };
    }
  }));
}
