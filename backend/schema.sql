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
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_memories_geohash    ON memories(geohash);
CREATE INDEX IF NOT EXISTS idx_memories_user       ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_created    ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_visibility ON memories(visibility);
CREATE INDEX IF NOT EXISTS idx_memories_access_key ON memories(access_key);

-- グループキーの所有者とモード（owner_only / open）
CREATE TABLE IF NOT EXISTS access_keys (
  key        TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'owner_only',  -- 'owner_only' | 'open'
  created_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);
