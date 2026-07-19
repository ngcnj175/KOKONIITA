-- グループキーの所有者とモード（owner_only / open）を管理するテーブル。
-- owner_only: 発行者のみ投稿可（従来動作）
-- open      : キーを知っていれば誰でも投稿可（オーナーは他人投稿も回収可）
CREATE TABLE IF NOT EXISTS access_keys (
  key        TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'owner_only',
  created_at INTEGER NOT NULL
);

-- 既存の keyed 投稿から access_keys を backfill
--  owner = そのキーの最古の投稿者
--  mode  = owner_only（既存キーは従来動作のまま）
INSERT OR IGNORE INTO access_keys(key, owner_id, mode, created_at)
SELECT access_key,
       (SELECT user_id FROM memories m2
        WHERE m2.visibility = 'keyed' AND m2.access_key = m.access_key
        ORDER BY m2.created_at ASC LIMIT 1) AS owner_id,
       'owner_only' AS mode,
       MIN(created_at) AS created_at
FROM memories m
WHERE visibility = 'keyed' AND access_key IS NOT NULL
GROUP BY access_key;
