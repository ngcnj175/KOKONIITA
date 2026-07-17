-- 記憶の公開/非公開を管理する visibility 列を追加
-- 'public' = 全員のレーダーに表示 / 'private' = 自分だけに表示
ALTER TABLE memories ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
CREATE INDEX IF NOT EXISTS idx_memories_visibility ON memories(visibility);
