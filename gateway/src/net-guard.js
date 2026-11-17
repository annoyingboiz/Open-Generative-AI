// Guards for URLs the server itself fetches (provider result files, model
// thumbnails): https only, and never this machine or the local network.
import dns from 'node:dns/promises';
import net from 'node:net';

function ipv4Private(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127) // CGNAT, Tailscale
    || a >= 224;
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return ipv4Private(ip);
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(v);
  }
  return true;
}

export class UnsafeUrlError extends Error {}

export async function assertPublicHttpsUrl(raw, { viaProxy = false } = {}) {
  let url;
  try { url = new URL(raw); } catch { throw new UnsafeUrlError('Invalid URL'); }
  if (url.protocol !== 'https:') throw new UnsafeUrlError(`Only https URLs are fetched (got ${url.protocol})`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError('Refusing to fetch a private address');
    return url;
  }
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) throw new UnsafeUrlError('Refusing to fetch a local host name');
  // Through a provider proxy the name is resolved on the proxy side.
  if (!viaProxy) {
    const addresses = await dns.lookup(host, { all: true });
    if (addresses.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError('Host resolves to a private address');
  }
  return url;
}
