# ココニイタ。バックエンド

Cloudflare Workers + D1 + R2 + KV。全て無料枠内で動作します。

## 使うもの & 無料枠

| サービス | 用途 | 無料枠 |
|---|---|---|
| Workers | API本体 | 100k req/日 |
| D1 | メタデータ＋画像BLOB | 5GB / 5M行読み/日 |
| KV | セッション | 100k読み/日 |
| Google OAuth | 認証 | 無料 |

**カード登録不要**の構成です。画像はD1に直接保存し、超過時はリクエストが停止するのみで課金は発生しません。アプリ側で合計4GB到達で新規投稿を拒否する容量ガードあり。

## 事前準備

### 1. Cloudflareアカウント
[cloudflare.com](https://www.cloudflare.com/) でアカウント作成（無料）。

### 2. wrangler CLI
```powershell
cd backend
npm install
npx wrangler login
```

### 3. Google OAuth クライアント作成
1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. 「APIとサービス」→「OAuth同意画面」を設定（外部・testingでOK）
   - スコープ: `openid`, `email`, `profile`
   - テストユーザーに自分のGoogleアカウントを追加
3. 「認証情報」→「OAuth 2.0 クライアントID」を作成
   - 種類: ウェブアプリケーション
   - 承認済みリダイレクトURI: **後述**（Worker URL確定後に追加）
4. **クライアントID** と **クライアントシークレット** をメモ

## デプロイ

### 4. Cloudflareリソースを作成
```powershell
cd backend
npx wrangler d1 create kokoniita
# → 出力の database_id を wrangler.toml の REPLACE_WITH_D1_ID に貼る

npx wrangler kv namespace create kokoniita-sessions
# → 出力の id を wrangler.toml の REPLACE_WITH_KV_ID に貼る
```

### 5. スキーマ投入
```powershell
npm run db:init         # 本番D1に投入
# または npm run db:init:local  # ローカル開発DBに投入
```

### 6. 初回デプロイ (Worker URL確定用)
```powershell
npm run deploy
# → 出力に https://kokoniita-api.<your-subdomain>.workers.dev が表示される
```

### 7. wrangler.toml を仕上げる
`GOOGLE_REDIRECT_URI` を実URLに置換:
```toml
GOOGLE_REDIRECT_URI = "https://kokoniita-api.<your-subdomain>.workers.dev/api/auth/google/callback"
```

### 8. Google Cloud Console に戻ってリダイレクトURIを追加
手順3で作ったOAuthクライアントの「承認済みリダイレクトURI」に:
```
https://kokoniita-api.<your-subdomain>.workers.dev/api/auth/google/callback
```

### 9. シークレットを設定
```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### 10. 再デプロイ
```powershell
npm run deploy
```

### 11. フロントエンド設定
プロジェクトルートの `config.js` を編集:
```js
window.KOKONIITA_CONFIG = {
  API_BASE: "https://kokoniita-api.<your-subdomain>.workers.dev",
};
```
git push → GitHub Pagesが再ビルド → 完了。

## 動作確認

```powershell
# ヘルスチェック
curl https://kokoniita-api.<your-subdomain>.workers.dev/api/health

# ログを流し見
npm run tail
```

ブラウザで GitHub Pages のURLを開き、右上「サインイン」をタップ → Googleログイン → 記憶を置く。

## ローカル開発

```powershell
cd backend
npm run dev
# → http://localhost:8787 で起動
```
別ターミナルでフロント:
```powershell
python -m http.server 8000
```
`config.js` の `API_BASE` を `"http://localhost:8787"` にすればローカル同士で疎通。

⚠ Google OAuth のリダイレクトURIには `http://localhost:8787/api/auth/google/callback` も追加しておくと便利。

## API仕様

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| GET | `/api/health` | - | ヘルスチェック |
| GET | `/api/me` | - | 現在のユーザー |
| GET | `/api/auth/google` | - | ログイン開始 |
| GET | `/api/auth/google/callback` | - | OAuth完了 |
| POST | `/api/auth/logout` | ✓ | ログアウト |
| GET | `/api/memories` | - | 全公開記憶（最新1000件） |
| GET | `/api/me/memories` | ✓ | 自分の記憶 |
| POST | `/api/memories` | ✓ | 記憶を置く（multipart） |
| DELETE | `/api/memories/:id` | ✓＋所有者 | 記憶を回収 |
| GET | `/api/memories/:id/image` | - | 画像取得 |

## セキュリティ

- セッションは HttpOnly + Secure + SameSite=None Cookie（KV保管）
- 状態変更系APIは `Origin` ヘッダを `FRONTEND_ORIGIN` と厳密照合（CSRF対策）
- 画像は2MB上限・`image/*` のみ・D1合計4GBで新規投稿停止
- 所有者以外は削除403
- 座標は範囲チェック（±90 / ±180）
