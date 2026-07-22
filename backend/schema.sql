-- ココニイタ。バックエンドスキーマ (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,        -- Google sub
  email      TEXT,
  name       TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id           TEXT PRIMARY KEY,       -- UUID
  user_id      TEXT NOT NULL,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  accuracy     REAL,
  note         TEXT,
  image_blob   BLOB NOT NULL,          -- JPEG本体
  image_type   TEXT NOT NULL DEFAULT 'image/jpeg',
  image_size   INTEGER NOT NULL,       -- バイト数（容量管理用）
  geohash      TEXT NOT NULL,          -- 近傍クエリ用（precision 6）
  visibility   TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'private' | 'keyed'
  access_key   TEXT,                             -- visibility='keyed' の合言葉（6桁英数字）
  created_at   INTEGER NOT NULL,
  deleted_at     INTEGER,                        -- NULL=生存 / 値あり=soft delete 済
  deleted_reason TEXT,                           -- 'reported' | 'self' | 'owner'
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_memories_geohash    ON memories(geohash);
CREATE INDEX IF NOT EXISTS idx_memories_user       ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_created    ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_visibility ON memories(visibility);
CREATE INDEX IF NOT EXISTS idx_memories_access_key ON memories(access_key);
CREATE INDEX IF NOT EXISTS idx_memories_deleted    ON memories(deleted_at);

-- 不適切通報のログ
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  memory_id    TEXT NOT NULL,
  reporter_id  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE(memory_id, reporter_id),
  FOREIGN KEY (memory_id) REFERENCES memories(id),
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_reports_memory ON reports(memory_id);

-- 「見つけた」記録（琥珀のしずく）
CREATE TABLE IF NOT EXISTS finds (
  memory_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, user_id),
  FOREIGN KEY (memory_id) REFERENCES memories(id),
  FOREIGN KEY (user_id)   REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_finds_memory ON finds(memory_id);
CREATE INDEX IF NOT EXISTS idx_finds_user   ON finds(user_id);

-- グループキーの所有者とモード（owner_only / open）
CREATE TABLE IF NOT EXISTS access_keys (
  key        TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'owner_only',  -- 'owner_only' | 'open'
  created_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);
