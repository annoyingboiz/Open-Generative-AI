// Runtime configuration, read once from the environment.
import path from 'node:path';

const env = process.env;

export const config = {
  host: env.HOST || '0.0.0.0',
  port: Number(env.PORT || 3300),
  // Where the Next.js studio is reachable from the gateway.
  studioUrl: env.STUDIO_URL || 'http://studio:3000',
  dataDir: path.resolve(env.DATA_DIR || './data'),
  // Optional master secret for encrypting provider keys. If empty, a random
  // key is generated once and stored in DATA_DIR/secret.key.
  appSecret: env.APP_SECRET || '',
  sessionDays: Number(env.SESSION_DAYS || 30),
  // Values from the environment are used when nothing is saved in Settings.
  providerEnv: {
    apimart: { apiKey: env.APIMART_API_KEY || '', proxy: env.APIMART_PROXY || '' },
    atlas: { apiKey: env.ATLAS_API_KEY || '', proxy: env.ATLAS_PROXY || '' },
    elevenlabs: { apiKey: env.ELEVENLABS_API_KEY || '', proxy: env.ELEVENLABS_PROXY || '' },
    fal: { apiKey: env.FAL_KEY || '', proxy: env.FAL_PROXY || '' },
  },
  logLevel: env.LOG_LEVEL || 'info',
  // Reverse proxies whose X-Forwarded-* / cf-connecting-ip headers we believe
  // (cloudflared on the same host connects from loopback).
  trustProxy: env.TRUST_PROXY || '127.0.0.1,::1',
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 300) * 1024 * 1024,
  userUploadQuotaBytes: Number(env.USER_UPLOAD_QUOTA_GB || 10) * 1024 ** 3,
  maxActiveJobsPerUser: Number(env.MAX_ACTIVE_JOBS_PER_USER || 8),
  // Optional: provider-change alerts to Telegram (Settings → Provider changes).
  telegram: { botToken: env.DZ_TELEGRAM_BOT_TOKEN || '', chatId: env.DZ_TELEGRAM_CHAT_ID || '' },
  publicUrl: env.PUBLIC_URL || '',
  // Ollama on this server (from inside Docker: the host's bridge address).
  ollamaUrl: env.DZ_OLLAMA_URL || 'http://172.17.0.1:11434',
  // Folder shared with h3-bridge (local H3 / Wan on this server's ComfyUI); empty = off.
  localBridgeDir: env.LOCAL_BRIDGE_DIR || '',
  // Optional proxy for OpenAI (ChatGPT plan), e.g. socks5h://…
  openaiProxy: env.DZ_OPENAI_PROXY || '',
  // ChatGPT sign-in: Director on the same computer as the browser listens for
  // OpenAI's callback itself (DZ_CHATGPT_LOOPBACK=1; in Docker also set
  // DZ_CHATGPT_LOOPBACK_HOST=0.0.0.0 and publish 127.0.0.1:1455:1455).
  chatgptLoopback: env.DZ_CHATGPT_LOOPBACK === '1',
  chatgptLoopbackHost: env.DZ_CHATGPT_LOOPBACK_HOST || '127.0.0.1',
  chatgptCallbackPort: Number(env.DZ_CHATGPT_CALLBACK_PORT) || 1455,
};
