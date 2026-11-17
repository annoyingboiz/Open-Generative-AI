// APIMart (https://apimart.ai) — docs: https://docs.apimart.ai
import { providerJson } from './http.js';

const API = 'https://api.apimart.ai';

export const apimart = {
  id: 'apimart',
  name: 'APIMart',
  website: 'https://apimart.ai',
  keysUrl: 'https://apimart.ai/console/token',

  async balance({ apiKey, proxy }) {
    const data = await providerJson(`${API}/v1/user/balance`, {
      proxy,
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 20_000,
    });
    if (data?.success === false) throw new Error(data.message || 'APIMart refused the key');
    return { amount: Number(data.remain_balance), currency: 'USD' };
  },
};
