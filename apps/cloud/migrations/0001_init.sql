-- Token Island cloud schema (Cloudflare D1 / SQLite).
-- Mirrors the v1 Node schema exactly. Only daily aggregates are stored:
-- no prompts, no paths, no session ids, and API keys only as sha256 hashes.

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  api_key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sync_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_key ON users(api_key_hash);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS days (
  username TEXT NOT NULL,
  date TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  unpriced_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  models_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (username, date)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_days_date ON days(date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '1', 0) ON CONFLICT(key) DO NOTHING;
