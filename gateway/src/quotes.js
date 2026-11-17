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

export function createQuoter({ providers, log }) {
  const cache = new Map(); // key -> { at, value }

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

    const key = cacheKey(providerId, modelId, providerBody);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    try {
      const got = await provider.quote(cfg, { model: modelId, body: forQuote(providerBody) });
      if (!got) return fallback();
      const value = { ...got, source: 'quote' }; // only provider quotes are cached
      cache.set(key, { at: Date.now(), value });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
      return value;
    } catch (error) {
      log?.warn(`quote ${providerId}/${modelId}: ${error.message}`);
      return fallback();
    }
  }

  return { quote };
}
