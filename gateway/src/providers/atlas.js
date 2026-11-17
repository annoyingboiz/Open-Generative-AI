// Atlas Cloud (https://atlascloud.ai) — docs: https://www.atlascloud.ai/docs
// Atlas blocks some countries (e.g. Ukraine); set a proxy in Settings there.
import { providerJson } from './http.js';

const API = 'https://api.atlascloud.ai';

export const atlas = {
  id: 'atlas',
  name: 'Atlas Cloud',
  website: 'https://www.atlascloud.ai',
  keysUrl: 'https://www.atlascloud.ai/console/api-keys',

  async balance({ apiKey, proxy }) {
    const data = await providerJson(`${API}/public/v1/balance`, {
      proxy,
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 20_000,
    });
    const body = data?.data ?? data;
    return { amount: Number(body.value), currency: String(body.currency || 'usd').toUpperCase() };
  },
};
