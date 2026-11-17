// Password hashing (scrypt), session tokens and encryption of stored secrets
// (AES-256-GCM). Only node:crypto — no native dependencies.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export const MAX_PASSWORD_LENGTH = 1024;

// Async variant: does not block the event loop while hashing.
export function verifyPasswordAsync(password, stored) {
  return new Promise((resolve) => {
    if (typeof stored !== 'string' || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) return resolve(false);
    const [algo, N, r, p, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt') return resolve(false);
    const expected = Buffer.from(hashB64, 'base64');
    crypto.scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem }, (err, actual) => {
      resolve(!err && expected.length === actual.length && crypto.timingSafeEqual(expected, actual));
    });
  });
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [algo, N, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// ── Secret box ──────────────────────────────────────────────────────────────

export function loadMasterKey(dataDir, appSecret) {
  if (appSecret) return crypto.createHash('sha256').update(appSecret).digest();
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error(`${file} must contain 32 random bytes in base64`);
  return key;
}

export function encrypt(masterKey, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(masterKey, boxed) {
  const [v, ivB64, tagB64, dataB64] = String(boxed).split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function maskSecret(value) {
  if (!value) return '';
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}
