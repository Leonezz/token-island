-- Token Island cloud schema v2: multi-device additive sync, GitHub OAuth
-- Device Flow sessions, per-device revocable keys, and profile visibility tiers.

ALTER TABLE users ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN github_id INTEGER;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
--> statement-breakpoint
UPDATE users SET user_id = 'usr_' || username WHERE user_id = '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT 'Mac',
  platform TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_sync_at INTEGER,
  revoked_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_key_hash ON devices(key_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_devices_username ON devices(username);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS device_days (
  username TEXT NOT NULL,
  device_id TEXT NOT NULL,
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
  PRIMARY KEY (username, device_id, date)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_device_days_user_date ON device_days(username, date);
--> statement-breakpoint
INSERT OR IGNORE INTO device_days (
  username, device_id, date, input_tokens, output_tokens, cache_read_tokens,
  cache_write_tokens, reasoning_tokens, total_tokens, unpriced_tokens,
  cost_usd, messages, models_json, updated_at
)
SELECT
  username, 'legacy', date, input_tokens, output_tokens, cache_read_tokens,
  cache_write_tokens, reasoning_tokens, total_tokens, unpriced_tokens,
  cost_usd, messages, models_json, updated_at
FROM days;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS oauth_device_sessions (
  session_id TEXT PRIMARY KEY,
  github_device_code TEXT NOT NULL,
  user_code TEXT NOT NULL,
  verification_uri TEXT NOT NULL,
  interval_sec INTEGER NOT NULL DEFAULT 5,
  device_id TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
UPDATE meta SET value = '2', updated_at = 0 WHERE key = 'schema_version';
