PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────
-- 1. USERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  name           TEXT    NOT NULL DEFAULT '',
  role           TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ─────────────────────────────────────────────
-- 2. PASSWORD RESETS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token_hash);

-- ─────────────────────────────────────────────
-- 3. ADMINS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- 4. VIDEOS (R2 object keys only)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS videos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT    NOT NULL DEFAULT '',
  kind             TEXT    NOT NULL DEFAULT 'mp4' CHECK (kind IN ('mp4', 'hls')),
  r2_key           TEXT    NOT NULL,
  hls_master_key   TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_videos_r2_key ON videos (r2_key);

-- ─────────────────────────────────────────────
-- 5. GENRES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS genres (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER UNIQUE,
  name    TEXT    NOT NULL UNIQUE
);

-- ─────────────────────────────────────────────
-- 6. MOVIES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id        INTEGER UNIQUE,
  title          TEXT    NOT NULL,
  original_title TEXT,
  overview       TEXT    NOT NULL DEFAULT '',
  poster_path    TEXT,
  backdrop_path  TEXT,
  release_date   TEXT,
  runtime        INTEGER NOT NULL DEFAULT 0,
  vote_average   REAL    NOT NULL DEFAULT 0,
  trailer_key    TEXT,
  genres_json    TEXT    NOT NULL DEFAULT '[]',
  cast_json      TEXT    NOT NULL DEFAULT '[]',
  status         TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  video_id       INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_movies_status ON movies (status);
CREATE INDEX IF NOT EXISTS idx_movies_tmdb   ON movies (tmdb_id);

-- ─────────────────────────────────────────────
-- 7. TV SERIES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tv_series (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id           INTEGER UNIQUE,
  name              TEXT    NOT NULL,
  original_name     TEXT,
  overview          TEXT    NOT NULL DEFAULT '',
  poster_path       TEXT,
  backdrop_path     TEXT,
  first_air_date    TEXT,
  number_of_seasons INTEGER NOT NULL DEFAULT 0,
  vote_average      REAL    NOT NULL DEFAULT 0,
  trailer_key       TEXT,
  genres_json       TEXT    NOT NULL DEFAULT '[]',
  cast_json         TEXT    NOT NULL DEFAULT '[]',
  status            TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tv_status ON tv_series (status);
CREATE INDEX IF NOT EXISTS idx_tv_tmdb   ON tv_series (tmdb_id);

-- ─────────────────────────────────────────────
-- 8. SEASONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id     INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  name          TEXT    NOT NULL DEFAULT '',
  overview      TEXT    NOT NULL DEFAULT '',
  poster_path   TEXT,
  air_date      TEXT,
  UNIQUE (series_id, season_number),
  FOREIGN KEY (series_id) REFERENCES tv_series (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_seasons_series ON seasons (series_id);

-- ─────────────────────────────────────────────
-- 9. EPISODES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS episodes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id      INTEGER NOT NULL,
  season_id      INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  name           TEXT    NOT NULL DEFAULT '',
  overview       TEXT    NOT NULL DEFAULT '',
  still_path     TEXT,
  air_date       TEXT,
  runtime        INTEGER NOT NULL DEFAULT 0,
  video_id       INTEGER,
  UNIQUE (season_id, episode_number),
  FOREIGN KEY (series_id) REFERENCES tv_series (id) ON DELETE CASCADE,
  FOREIGN KEY (season_id) REFERENCES seasons (id) ON DELETE CASCADE,
  FOREIGN KEY (video_id)  REFERENCES videos (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes (series_id);
CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes (season_id);

-- ─────────────────────────────────────────────
-- 10. SUBTITLES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subtitles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   INTEGER NOT NULL,
  language   TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  r2_key     TEXT    NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subtitles_video ON subtitles (video_id);

-- ─────────────────────────────────────────────
-- 11. MOVIE ↔ GENRE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movie_genres (
  movie_id INTEGER NOT NULL,
  genre_id INTEGER NOT NULL,
  PRIMARY KEY (movie_id, genre_id),
  FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES genres (id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- 12. SERIES ↔ GENRE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS series_genres (
  series_id INTEGER NOT NULL,
  genre_id  INTEGER NOT NULL,
  PRIMARY KEY (series_id, genre_id),
  FOREIGN KEY (series_id) REFERENCES tv_series (id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id)  REFERENCES genres (id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- 13. FAVORITES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  media_type TEXT    NOT NULL CHECK (media_type IN ('movie', 'tv')),
  media_id   INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, media_type, media_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (user_id);

-- ─────────────────────────────────────────────
-- 14. WATCHLIST
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  media_type TEXT    NOT NULL CHECK (media_type IN ('movie', 'tv')),
  media_id   INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, media_type, media_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist (user_id);

-- ─────────────────────────────────────────────
-- 15. WATCH HISTORY
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watch_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  media_type       TEXT    NOT NULL CHECK (media_type IN ('movie', 'episode')),
  media_id         INTEGER NOT NULL,
  series_id        INTEGER,
  season_number    INTEGER,
  episode_number   INTEGER,
  position_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  completed        INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, media_type, media_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_watch_history_user ON watch_history (user_id, updated_at DESC);

-- ─────────────────────────────────────────────
-- 16. SETTINGS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  is_secret  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value, is_secret) VALUES
  ('site_name', 'TIPIZ', 0),
  ('site_tagline', 'Watch Movies & TV Series', 0),
  ('tmdb_api_key', '', 1),
  ('tmdb_language', 'en-US', 0),
  ('allow_registration', 'true', 0);