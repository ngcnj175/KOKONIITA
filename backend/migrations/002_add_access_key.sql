-- 合言葉方式（visibility='keyed'）を追加
-- keyed の記憶は access_key を知っている人だけが取得できる。
ALTER TABLE memories ADD COLUMN access_key TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_access_key ON memories(access_key);
