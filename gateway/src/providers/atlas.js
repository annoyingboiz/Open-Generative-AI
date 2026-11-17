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
    // Live API: { available: { value, currency }, cash, bonus, ... }.
    // Docs show a flat { value, currency }; accept both.
    const body = data?.data ?? data;
    const money = body?.available ?? body;
    const amount = Number(money?.value);
    if (!Number.isFinite(amount)) throw new Error('Unexpected balance response from Atlas');
    return { amount, currency: String(money.currency || 'usd').toUpperCase() };
  },
};
