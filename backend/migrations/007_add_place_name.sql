-- 投稿時に逆ジオコーディングで取得した地名（例: "渋谷区" / "Paris"）
ALTER TABLE memories ADD COLUMN place_name TEXT;
