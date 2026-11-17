// Prices before a generation, from the provider for our account:
//   Atlas   POST /api/v1/model/calculate   (exact price of this exact request)
//   APIMart GET  /v1/pricing/model         (our account's price for this spec)
// Falls back to the catalog price when a provider can't quote.
import crypto from 'node:crypto';
import { providerById } from './providers/index.js';
import { estimateCost } from './catalog/build.js';

const TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 2000;

// Media values don't change the price (only how many there are), and local
// /media links mean nothing to the provider: replace them with a placeholder.
const PLACEHOLDER = { image: 'https://example.com/reference.png', video: 'https://example.com/reference.mp4', audio: 'https://example.com/reference.mp3' };
function forQuote(value, key = '') {
  if (Array.isArray(value)) return value.map((v) => forQuote(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, forQuote(v, k)]));
  if (typeof value === 'string' && /^(?:https?:\/\/[^/]+)?\/media\/[ug]\//.test(value)) {
    return /video/.test(key) ? PLACEHOLDER.video : /audio/.test(key) ? PLACEHOLDER.audio : PLACEHOLDER.image;
  }
  return value;
}

// Reference videos/audio can change the price (Atlas bills their duration),
// so a quote with them is only an estimate and is not cached.
function hasTimedMedia(value, key = '') {
  if (Array.isArray(value)) return value.some((v) => hasTimedMedia(v, key));
  if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => hasTimedMedia(v, k));
  return typeof value === 'string' && /video|audio/i.test(key) && value.length > 0;
}

// Pricing APIs have their own limits (APIMart: 60/min per key): stay under.
const PROVIDER_PER_MINUTE = 50;

export function createQuoter({ providers, log }) {
  const cache = new Map(); // key -> { at, value }
  const inflight = new Map(); // key -> Promise
  const calls = new Map(); // providerId -> [timestamps]
  const allowCall = (providerId) => {
    const t = Date.now();
    const recent = (calls.get(providerId) || []).filter((x) => t - x < 60_000);
    if (recent.length >= PROVIDER_PER_MINUTE) { calls.set(providerId, recent); return false; }
    recent.push(t);
    calls.set(providerId, recent);
    return true;
  };

  function cacheKey(providerId, modelId, body) {
    const { prompt, negative_prompt: _n, ...rest } = body || {};
    const shape = JSON.stringify(forQuote(rest), Object.keys(rest).sort());
    return crypto.createHash('sha256').update(`${providerId}\0${modelId}\0${shape}\0${prompt ? 1 : 0}`).digest('hex');
  }

  // → { usd, exact, source: 'quote' | 'estimate' } or null.
  async function quote({ providerId, modelId, providerBody, variant }) {
    const fallback = () => {
      const usd = variant ? estimateCost(variant, providerBody) : null;
      return Number.isFinite(usd) ? { usd, exact: false, source: 'estimate' } : null;
    };
    const provider = providerById(providerId);
    const cfg = providers.resolve(providerId);
    if (!provider?.quote || !cfg.enabled || !cfg.apiKey) return fallback();

    const timed = hasTimedMedia(providerBody);
    const key = cacheKey(providerId, modelId, providerBody);
    const hit = !timed && cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    if (!allowCall(providerId)) return fallback();
    const job = (async () => {
      try {
        const got = await provider.quote(cfg, { model: modelId, body: forQuote(providerBody) });
        if (!got) return fallback();
        const value = { ...got, exact: got.exact && !timed, source: 'quote' };
        if (!timed) { // only provider quotes without timed media are cached
          cache.set(key, { at: Date.now(), value });
          if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
        }
        return value;
      } catch (error) {
        log?.warn(`quote ${providerId}/${modelId}: ${error.message}`);
        return fallback();
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, job);
    return job;
  }

  return { quote };
}
