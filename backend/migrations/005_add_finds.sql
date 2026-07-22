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
