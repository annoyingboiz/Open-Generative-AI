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
  // 5: Library — which studio made it, studio settings (camera, lens…), likes;
  // places for workspaces, projects and folders (filled in later steps).
  `
  ALTER TABLE generations ADD COLUMN studio TEXT;
  ALTER TABLE generations ADD COLUMN meta_json TEXT;
  ALTER TABLE generations ADD COLUMN liked_at INTEGER;
  ALTER TABLE generations ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE generations ADD COLUMN project_id TEXT;
  ALTER TABLE generations ADD COLUMN folder_id TEXT;
  ALTER TABLE uploads ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE uploads ADD COLUMN project_id TEXT;
  ALTER TABLE uploads ADD COLUMN folder_id TEXT;
  CREATE INDEX generations_user_studio ON generations(user_id, studio, created_at DESC);
  CREATE INDEX generations_user_liked ON generations(user_id, liked_at DESC) WHERE liked_at IS NOT NULL;
  `,
  // 6: "delete for good" removes the files but keeps the row (cost, dates),
  // so monthly spending can't be erased by deleting results.
  `
  ALTER TABLE generations ADD COLUMN purged_at INTEGER;
  `,
  // 7: projects — a shared working context (members) with nested folders.
  // workspace_id is reserved: one workspace for now.
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL DEFAULT 1,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    archived_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    added_at INTEGER NOT NULL,
    last_used_at INTEGER,
    PRIMARY KEY (project_id, user_id)
  );
  CREATE INDEX project_members_user ON project_members(user_id, last_used_at DESC);
  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX folders_project ON folders(project_id, parent_id);
  CREATE INDEX generations_project ON generations(project_id, created_at DESC) WHERE project_id IS NOT NULL;
  CREATE INDEX uploads_project ON uploads(project_id, created_at DESC) WHERE project_id IS NOT NULL;
  `,
  // 8: elements — named subjects (characters, objects, places) with pictures and
  // an optional video. In the Library (personal) or in a project; copies, not links.
  `
  CREATE TABLE elements (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL DEFAULT 1,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'character' CHECK (kind IN ('character', 'object', 'place', 'other')),
    description TEXT NOT NULL DEFAULT '',
    images_json TEXT NOT NULL DEFAULT '[]',
    video_url TEXT,
    source_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX elements_owner ON elements(owner_id, updated_at DESC) WHERE project_id IS NULL;
  CREATE INDEX elements_project ON elements(project_id, updated_at DESC) WHERE project_id IS NOT NULL;
  `,
  // 9: elements v2 — a tag (@char_mike), draft/active, notes, any number of
  // labelled views (first = main) and several labelled videos.
  `
  ALTER TABLE elements ADD COLUMN tag TEXT;
  ALTER TABLE elements ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
  ALTER TABLE elements ADD COLUMN notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE elements ADD COLUMN views_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE elements ADD COLUMN videos_json TEXT NOT NULL DEFAULT '[]';
  UPDATE elements SET
    views_json = CASE WHEN json_valid(images_json) AND json_type(images_json) = 'array'
      THEN COALESCE((SELECT json_group_array(json_object('url', value, 'label', '')) FROM json_each(elements.images_json) WHERE json_each.type = 'text'), '[]')
      ELSE '[]' END,
    videos_json = CASE WHEN NULLIF(TRIM(video_url), '') IS NOT NULL THEN json_array(json_object('url', video_url, 'label', '')) ELSE '[]' END;
  `,
  // 10: a tag is unique where the element lives (deleted ones don't count).
  `
  CREATE UNIQUE INDEX elements_tag_personal ON elements(owner_id, tag) WHERE project_id IS NULL AND tag IS NOT NULL AND deleted_at IS NULL;
  CREATE UNIQUE INDEX elements_tag_project ON elements(project_id, tag) WHERE project_id IS NOT NULL AND tag IS NOT NULL AND deleted_at IS NULL;
  `,
  // 11: calls to text models (LLM): tokens, cost, time — they count toward the monthly limit.
  `
  CREATE TABLE llm_calls (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    source TEXT NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'chat',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX llm_calls_user ON llm_calls(user_id, created_at);
  `,
  // 12: storyboards (AI Director) — a scene, its shots (edited, with a revision
  // number) and per-shot media (frames, videos, the picked ones; set by the server).
  `
  CREATE TABLE storyboards (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL DEFAULT 1,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    scene TEXT NOT NULL DEFAULT '',
    look_json TEXT NOT NULL DEFAULT '{}',
    settings_json TEXT NOT NULL DEFAULT '{}',
    shots_json TEXT NOT NULL DEFAULT '[]',
    media_json TEXT NOT NULL DEFAULT '{}',
    rev INTEGER NOT NULL DEFAULT 1,
    updated_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX storyboards_owner ON storyboards(owner_id, updated_at DESC) WHERE project_id IS NULL;
  CREATE INDEX storyboards_project ON storyboards(project_id, updated_at DESC) WHERE project_id IS NOT NULL;
  `,
  // 13: a short line about a running job (e.g. "Waiting for the GPU: …" on this server).
  `
  ALTER TABLE generations ADD COLUMN note TEXT;
  `,
  // 14: assistants (rules, default text model, knowledge files; Library or project)
  // and chats with them (always personal).
  `
  CREATE TABLE assistants (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL DEFAULT 1,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    rules TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    model_notes INTEGER NOT NULL DEFAULT 0,
    files_json TEXT NOT NULL DEFAULT '[]',
    template TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX assistants_owner ON assistants(owner_id, updated_at DESC) WHERE project_id IS NULL;
  CREATE INDEX assistants_project ON assistants(project_id, updated_at DESC) WHERE project_id IS NOT NULL;
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assistant_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New chat',
    messages_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX chats_user ON chats(user_id, assistant_id, updated_at DESC);
  `,
  // 15: Storyboard v2 (package 05) — ordered scenes, the Moodboard canvas, a film note.
  // Shots keep their own scene id, note and references inside shots_json; boards
  // made before are migrated in place by storyboards.js (one scene, same shots, picks → approved).
  `
  ALTER TABLE storyboards ADD COLUMN scenes_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE storyboards ADD COLUMN mood_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE storyboards ADD COLUMN note TEXT NOT NULL DEFAULT '';
  ALTER TABLE storyboards ADD COLUMN v2 INTEGER NOT NULL DEFAULT 0;
  `,
  // 16: package 06, S8.1 — the default name is "Untitled storyboard"; boards still carrying an
  // earlier default name follow it (once).
  `
  UPDATE storyboards SET name = 'Untitled storyboard' WHERE name IN ('Untitled film', 'Untitled scene');
  `,
  // 17: package 15, C7 — a chat keeps the context it was saved with (none, a scene, the whole
  // storyboard, a shot or the open composer). Existing chats get none: nothing else changes.
  `
  ALTER TABLE chats ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
  `,
  // 18: a second, read-only key that only shows the balance (fal.ai: a key on the BILLING preset;
  // the key that makes pictures can stay without billing access).
  `
  ALTER TABLE provider_settings ADD COLUMN billing_key_enc TEXT;
  `,
  // 19: files the server makes for one job (Phone canvas, a copy of its source): hidden from the
  // library and removed when the job is done. Set only by the server, never from a file name.
  `
  ALTER TABLE uploads ADD COLUMN transient INTEGER NOT NULL DEFAULT 0;
  `,
  // 20: the colour badge's background check reads only recent finished pictures (Codex x71): a partial
  // index, so the minute's query does not parse every row's JSON.
  `
  CREATE INDEX generations_recent_images ON generations(created_at DESC) WHERE kind = 'image' AND status = 'completed' AND purged_at IS NULL;
  `,
  // 21: deleting an account (Settings → People) is soft: the person cannot sign in and leaves the
  // lists; their pictures, videos and spending stay (a hard delete would cascade into their work).
  `
  ALTER TABLE users ADD COLUMN deleted_at INTEGER;
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
