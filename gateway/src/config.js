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
    fal: { apiKey: env.FAL_KEY || '', proxy: env.FAL_PROXY || '' },
  },
  logLevel: env.LOG_LEVEL || 'info',
  // Reverse proxies whose X-Forwarded-* / cf-connecting-ip headers we believe
  // (cloudflared on the same host connects from loopback).
  trustProxy: env.TRUST_PROXY || '127.0.0.1,::1',
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 300) * 1024 * 1024,
  userUploadQuotaBytes: Number(env.USER_UPLOAD_QUOTA_GB || 10) * 1024 ** 3,
  maxActiveJobsPerUser: Number(env.MAX_ACTIVE_JOBS_PER_USER || 8),
};
