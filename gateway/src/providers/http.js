import fs from 'node:fs';
// HTTP client for providers. Every request of a provider — API calls, uploads
// and result downloads — goes through that provider's optional proxy.
import { fetch, FormData, ProxyAgent, Agent } from 'undici';
import { socksDispatcher } from 'fetch-socks';

const dispatchers = new Map();
const direct = new Agent({ connect: { timeout: 20_000 } });

export function dispatcherFor(proxyUrl) {
  if (!proxyUrl) return direct;
  if (dispatchers.has(proxyUrl)) return dispatchers.get(proxyUrl);
  const url = new URL(proxyUrl);
  let dispatcher;
  if (url.protocol === 'socks5:' || url.protocol === 'socks5h:' || url.protocol === 'socks:') {
    // fetch-socks sends the destination host name to the proxy, so DNS is
    // resolved on the proxy side (socks5h behaviour) for both schemes.
    dispatcher = socksDispatcher({
      type: 5,
      host: url.hostname,
      port: Number(url.port || 1080),
      ...(url.username ? { userId: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : {}),
    }, { connect: { timeout: 20_000 } });
  } else if (url.protocol === 'http:' || url.protocol === 'https:') {
    dispatcher = new ProxyAgent({ uri: proxyUrl, connect: { timeout: 20_000 } });
  } else {
    throw new Error(`Unsupported proxy scheme: ${url.protocol} (use socks5h://, socks5:// or http://)`);
  }
  dispatchers.set(proxyUrl, dispatcher);
  return dispatcher;
}

export function validateProxyUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['socks5:', 'socks5h:', 'socks:', 'http:', 'https:'].includes(url.protocol)) {
      return 'Proxy must start with socks5h://, socks5:// or http://';
    }
    if (!url.hostname) return 'Proxy host is missing';
    return null;
  } catch {
    return 'Proxy is not a valid URL, e.g. socks5h://127.0.0.1:1080';
  }
}

export class ProviderHttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function providerFetch(url, { proxy, timeoutMs = 60_000, ...init } = {}) {
  return fetch(url, {
    ...init,
    dispatcher: dispatcherFor(proxy),
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });
}

export async function providerJson(url, options = {}) {
  const response = await providerFetch(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = typeof body === 'object' && body
      ? (body.error?.message || body.message || body.msg || JSON.stringify(body).slice(0, 200))
      : String(text).slice(0, 200);
    throw new ProviderHttpError(`HTTP ${response.status}: ${detail}`, { status: response.status, body });
  }
  return body;
}

// A multipart body with one file streamed from disk. It must be undici's own
// FormData: undici's fetch sends Node's global FormData as the text
// "[object FormData]" (both are "FormData", but different classes).
export async function fileForm(field, path, mime, name) {
  const form = new FormData();
  form.append(field, await fs.openAsBlob(path, { type: mime }), name);
  return form;
}
