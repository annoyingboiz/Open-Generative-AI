// SQLite storage (node:sqlite, built into Node 22). One file: DATA_DIR/app.db.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  // 1 — users, sessions, provider settings
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    monthly_limit_usd REAL,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE provider_settings (
    provider TEXT PRIMARY KEY,
    api_key_enc TEXT,
    proxy_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );
  `,
  // 2 — uploads (reference files) and generations (server-side history)
  `
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    original_name TEXT,
    provider_refs TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX uploads_user ON uploads(user_id, created_at DESC);
  CREATE TABLE generations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_model TEXT NOT NULL,
    kind TEXT NOT NULL,
    provider_task_id TEXT,
    status TEXT NOT NULL,
    prompt TEXT,
    params_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    cost_usd REAL,
    est_cost_usd REAL,
    provider_outputs_json TEXT NOT NULL DEFAULT '[]',
    outputs_json TEXT NOT NULL DEFAULT '[]',
    next_poll_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    deleted_at INTEGER
  );
  CREATE INDEX generations_user ON generations(user_id, created_at DESC);
  CREATE INDEX generations_active ON generations(status, next_poll_at);
  `,
  // 3: where a cost comes from — 'provider' (actual charge), 'quote' (exact
  // price from the provider before submit) or 'estimate' (catalog price).
  `
  ALTER TABLE generations ADD COLUMN cost_source TEXT;
  ALTER TABLE generations ADD COLUMN est_source TEXT;
  `,
  // 4: cost settlement survives restarts; polls fail only on repeated errors.
  `
  ALTER TABLE generations ADD COLUMN settle_attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE generations ADD COLUMN settle_next_at INTEGER;
  ALTER TABLE generations ADD COLUMN poll_errors INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX generations_settle ON generations(settle_next_at) WHERE settle_next_at IS NOT NULL;
  `,
];

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  let version = row ? Number(row.value) : 0;
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version += 1;
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(version));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}

export const now = () => Date.now();
