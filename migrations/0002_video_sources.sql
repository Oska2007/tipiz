CREATE TABLE IF NOT EXISTS video_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  r2_key TEXT,
  telegram_file_id TEXT,
  source_type TEXT DEFAULT 'r2',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);