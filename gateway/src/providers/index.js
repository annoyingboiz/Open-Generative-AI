// Provider registry and per-provider settings (key + proxy).
// To add a provider: create a module next to apimart.js / atlas.js that
// exports the same shape, and list it in PROVIDERS below.
import { apimart } from './apimart.js';
import { atlas } from './atlas.js';
import { fal } from './fal.js';
import { local } from './local.js';
import { elevenlabs } from './elevenlabs.js';
import { encrypt, decrypt, maskSecret } from '../crypto.js';
import { now } from '../db.js';

export const PROVIDERS = [apimart, atlas, fal, elevenlabs];

// Shows a proxy without its password: socks5h://user:••••@host:port
function maskProxy(value) {
  try {
    const u = new URL(value);
    if (u.password) u.password = '••••';
    return u.password || u.username ? u.toString() : value;
  } catch { return value || ''; }
}
// "This server" (local ComfyUI through h3-bridge) has no key, balance or catalog
// to refresh, so it is not in PROVIDERS — but jobs find it by id.
export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || (id === local.id ? local : undefined);

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
    let billingKey = '';
    if (row?.billing_key_enc) { try { billingKey = decrypt(masterKey, row.billing_key_enc); } catch { billingKey = ''; } }
    return { id, apiKey, proxy, enabled, keySource, billingKey };
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
      billingKeyField: Boolean(providerById(id)?.billingKey),
      hasBillingKey: Boolean(c.billingKey),
      billingKeyMask: maskSecret(c.billingKey),
    };
  }

  const setBilling = db.prepare('UPDATE provider_settings SET billing_key_enc = ? WHERE provider = ?');
  function save(id, { apiKey, clearKey, proxy, enabled, billingKey, clearBillingKey }) {
    const current = getRow.get(id);
    let apiKeyEnc = current?.api_key_enc ?? null;
    if (clearKey) apiKeyEnc = null;
    else if (apiKey) apiKeyEnc = encrypt(masterKey, apiKey.trim());
    const keepProxy = typeof proxy === 'string' && proxy.includes('••••') && current?.proxy_url;
    // No proxy given (switching Enabled alone): keep the saved one, else the one from .env.
    upsert.run(id, apiKeyEnc, keepProxy ? current.proxy_url : (proxy ?? current?.proxy_url ?? envDefaults[id]?.proxy ?? ''), enabled ? 1 : 0, now());
    if (clearBillingKey) setBilling.run(null, id);
    else if (billingKey) setBilling.run(encrypt(masterKey, billingKey.trim()), id);
  }

  return { resolve, publicView, save };
}

// Balance of every enabled provider with a key. Errors are reported per provider.
export async function fetchBalances(settings) {
  return Promise.all(PROVIDERS.map((provider) => balanceOf(settings, provider)));
}

// One provider's balance (Settings → Providers after a save or a switch).
export async function balanceOf(settings, provider) {
  const c = settings.resolve(provider.id);
  const base = { id: provider.id, name: provider.name, enabled: c.enabled, hasKey: Boolean(c.apiKey) };
  if (!c.enabled || !c.apiKey) return { ...base, ok: false };
  try {
    const b = await provider.balance(c);
    // ElevenLabs: credits left on your plan, its name and when it renews.
    const note = b.note || (b.currency === 'CREDITS' ? [b.tier ? `${b.tier} plan` : '', b.limit ? `of ${b.limit.toLocaleString('en-US')}` : '', b.resetsAt ? `renews ${new Date(b.resetsAt).toISOString().slice(0, 10)}` : ''].filter(Boolean).join(' · ') : null);
    return { ...base, ok: true, amount: b.amount, currency: b.currency, note: note || null };
  } catch (error) {
    return { ...base, ok: false, error: error.message };
  }
}
