-- 不適切通報機能。
--  reports: 通報ログ（同一ユーザーの重複通報は UNIQUE で防止）
--  memories.deleted_at / deleted_reason: soft delete 用（30日保持想定）
--    deleted_reason は 'reported' | 'self' | 'owner'

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

ALTER TABLE memories ADD COLUMN deleted_at INTEGER;
ALTER TABLE memories ADD COLUMN deleted_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted_at);
