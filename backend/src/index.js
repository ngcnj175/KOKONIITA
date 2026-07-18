// ココニイタ。API - Cloudflare Workers (Hono)
// 認証: Google OAuth + HttpOnlyクッキーセッション(KV保管)
// データ: D1(memories/users) + R2(画像)

import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const app = new Hono();

// ---------- CORS ----------
app.use("/api/*", (c, next) => {
  const origin = c.env.FRONTEND_ORIGIN;
  return cors({
    origin,
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })(c, next);
});

// ---------- Origin検証（CSRF対策）----------
// SameSite=None を使うため、状態変更系はOriginヘッダを厳密チェック
app.use("/api/*", async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  // Bearerトークン付きリクエストはCSRF自動送信の対象外なので許可
  const auth = c.req.header("Authorization") || "";
  if (/^Bearer\s+\S+$/.test(auth)) return next();
  // それ以外はOriginを厳密照合（CSRF対策）
  const origin = c.req.header("Origin");
  if (origin !== c.env.FRONTEND_ORIGIN) {
    return c.json({ error: "forbidden origin" }, 403);
  }
  return next();
});

// ---------- セッション ----------
const SESSION_COOKIE = "kk_sess";
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30日

function cookieOpts(maxAge) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
    maxAge,
  };
}

async function getSession(c) {
  // Cookieを優先、なければAuthorizationヘッダのBearerを見る（クロスサイトCookieブロック対策）
  let token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    const auth = c.req.header("Authorization") || "";
    const m = auth.match(/^Bearer\s+(\S+)$/);
    if (m) token = m[1];
  }
  if (!token) return null;
  const data = await c.env.SESSIONS.get(`sess:${token}`, { type: "json" });
  if (!data) return null;
  return { ...data, token };
}

async function requireSession(c) {
  const s = await getSession(c);
  if (!s) return null;
  return s;
}

// ---------- Geohash (簡易) ----------
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
function geohash(lat, lng, precision = 6) {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = "", bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { ch |= 1 << (4 - bit); lngMin = mid; } else lngMax = mid;
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch |= 1 << (4 - bit); latMin = mid; } else latMax = mid;
    }
    even = !even;
    if (bit < 4) bit++;
    else { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

// ---------- ユーティリティ ----------
function toMemoryRow(r, opts = {}) {
  const visibility = r.visibility || "public";
  const base = `/api/memories/${r.id}/image`;
  // keyed の画像URLはキー付きで返す（受け手が開封できるように）
  const imageUrl = visibility === "keyed" && r.access_key
    ? `${base}?key=${encodeURIComponent(r.access_key)}`
    : base;
  const row = {
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    accuracy: r.accuracy,
    note: r.note || "",
    imageUrl,
    createdAt: r.created_at,
    userId: r.user_id,
    visibility,
  };
  // access_key は所有者向けレスポンス（履歴/投稿完了時）でのみ含める
  if (opts.includeKey && visibility === "keyed") {
    row.accessKey = r.access_key || null;
  }
  return row;
}

// 合言葉生成: 0/1/o/l を除外した 32 文字集合 × 6 桁
const KEY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function generateAccessKey(len = 6) {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < len; i++) s += KEY_ALPHABET[buf[i] % KEY_ALPHABET.length];
  return s;
}
function normalizeKey(k) {
  return (k || "").toString().trim().toLowerCase();
}
// 合言葉の妥当性: 6-20文字、英数字とハイフンのみ
function isValidUserKey(k) {
  return typeof k === "string" && /^[a-z0-9-]{6,20}$/.test(k);
}
// 指定キーの所有者（最古の keyed 投稿者）を返す。未使用キーなら null。
async function findKeyOwner(db, key) {
  const row = await db.prepare(
    `SELECT user_id FROM memories
     WHERE visibility = 'keyed' AND access_key = ?
     ORDER BY created_at ASC LIMIT 1`
  ).bind(key).first();
  return row ? row.user_id : null;
}

// ==========================================================
// 認証
// ==========================================================

app.get("/api/me", async (c) => {
  const s = await getSession(c);
  if (!s) return c.json({ user: null });
  return c.json({
    user: { id: s.userId, email: s.email, name: s.name, picture: s.picture || null },
  });
});

app.get("/api/auth/google", (c) => {
  const state = crypto.randomUUID();
  setCookie(c, "kk_oauth_state", state, {
    httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: c.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/api/auth/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = getCookie(c, "kk_oauth_state");
  if (!code || !state || state !== cookieState) {
    return c.text("bad state", 400);
  }
  deleteCookie(c, "kk_oauth_state", { path: "/" });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: c.env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return c.text("token exchange failed", 400);
  const tokens = await tokenRes.json();

  // id_tokenをデコード（署名検証は省略 - Googleから直接受け取ったHTTPSレスポンスなので信頼）
  const payload = decodeJwtPayload(tokens.id_token);
  if (!payload || !payload.sub) return c.text("invalid id_token", 400);

  const userId = payload.sub;
  const email = payload.email || null;
  const name = payload.name || email || "";
  const picture = payload.picture || null;

  await c.env.DB.prepare(
    `INSERT INTO users(id, email, name, created_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name`
  ).bind(userId, email, name, Date.now()).run();

  const token = crypto.randomUUID().replace(/-/g, "") +
                crypto.randomUUID().replace(/-/g, "");
  await c.env.SESSIONS.put(
    `sess:${token}`,
    JSON.stringify({ userId, email, name, picture }),
    { expirationTtl: SESSION_TTL_SEC }
  );
  setCookie(c, SESSION_COOKIE, token, cookieOpts(SESSION_TTL_SEC));

  // 3rd-party Cookieがブロックされる環境向けに、URLフラグメント経由でトークンも渡す
  const base = c.env.FRONTEND_URL || (c.env.FRONTEND_ORIGIN + "/");
  return c.redirect(`${base}#kk_token=${encodeURIComponent(token)}`);
});

app.post("/api/auth/logout", async (c) => {
  const s = await getSession(c);
  if (s) await c.env.SESSIONS.delete(`sess:${s.token}`);
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, sameSite: "None" });
  return c.json({ ok: true });
});

function decodeJwtPayload(jwt) {
  try {
    const part = jwt.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

// ==========================================================
// Memories
// ==========================================================

// レーダー用:
//   ?key=xxxxxx あり → その合言葉の keyed 記憶のみ
//   なし             → public + ログイン中なら自分の private/keyed も
app.get("/api/memories", async (c) => {
  const key = normalizeKey(c.req.query("key"));
  if (key) {
    const { results } = await c.env.DB.prepare(
      `SELECT id, user_id, lat, lng, accuracy, note, visibility, access_key, created_at
       FROM memories
       WHERE visibility = 'keyed' AND access_key = ?
       ORDER BY created_at DESC LIMIT 1000`
    ).bind(key).all();
    return c.json({ memories: results.map(r => toMemoryRow(r)) });
  }
  const s = await getSession(c);
  const stmt = s
    ? c.env.DB.prepare(
        `SELECT id, user_id, lat, lng, accuracy, note, visibility, access_key, created_at
         FROM memories
         WHERE visibility = 'public' OR user_id = ?
         ORDER BY created_at DESC LIMIT 1000`
      ).bind(s.userId)
    : c.env.DB.prepare(
        `SELECT id, user_id, lat, lng, accuracy, note, visibility, access_key, created_at
         FROM memories
         WHERE visibility = 'public'
         ORDER BY created_at DESC LIMIT 1000`
      );
  const { results } = await stmt.all();
  return c.json({
    memories: results.map(r =>
      toMemoryRow(r, { includeKey: !!(s && r.user_id === s.userId) })
    ),
  });
});

// 履歴（本人のみ）
app.get("/api/me/memories", async (c) => {
  const s = await requireSession(c);
  if (!s) return c.json({ error: "unauthorized" }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT id, user_id, lat, lng, accuracy, note, visibility, access_key, created_at
     FROM memories WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(s.userId).all();
  return c.json({ memories: results.map(r => toMemoryRow(r, { includeKey: true })) });
});

// 画像配信（D1 BLOBから直接返す）
app.get("/api/memories/:id/image", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT image_blob, image_type, visibility, access_key, user_id FROM memories WHERE id = ?"
  ).bind(id).first();
  if (!row) return c.text("not found", 404);

  // private の画像は所有者のみ取得可
  if (row.visibility === "private") {
    const s = await getSession(c);
    if (!s || s.userId !== row.user_id) return c.text("not found", 404);
  }
  // keyed の画像は 合言葉一致 または 所有者のみ
  if (row.visibility === "keyed") {
    const key = normalizeKey(c.req.query("key"));
    const keyMatches = key && row.access_key && key === row.access_key;
    if (!keyMatches) {
      const s = await getSession(c);
      if (!s || s.userId !== row.user_id) return c.text("not found", 404);
    }
  }

  // D1のBLOBは環境により ArrayBuffer / Uint8Array / Array<number> のいずれかで返る
  const raw = row.image_blob;
  let bytes;
  if (raw instanceof Uint8Array) bytes = raw;
  else if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
  else if (Array.isArray(raw)) bytes = new Uint8Array(raw);
  else if (raw && typeof raw === "object" && typeof raw.byteLength === "number") {
    bytes = new Uint8Array(raw);
  } else {
    return c.text("invalid blob", 500);
  }

  const isPublic = row.visibility === "public";
  return new Response(bytes, {
    headers: {
      "Content-Type": row.image_type || "image/jpeg",
      "Cache-Control": isPublic
        ? "public, max-age=31536000, immutable"
        : "private, max-age=0, no-store",
      "Content-Length": String(bytes.byteLength),
    },
  });
});

// 容量ガード: D1の合計サイズが上限を超えたら投稿拒否
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024; // 4GB（D1の5GB上限より余裕を持たせる）
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;         // 1枚2MBまで

async function getTotalImageBytes(db) {
  const row = await db.prepare("SELECT COALESCE(SUM(image_size), 0) AS total FROM memories").first();
  return Number(row?.total || 0);
}

// 投稿
app.post("/api/memories", async (c) => {
  const s = await requireSession(c);
  if (!s) return c.json({ error: "unauthorized" }, 401);

  const form = await c.req.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return c.json({ error: "image required" }, 400);
  if (image.size > MAX_IMAGE_BYTES) return c.json({ error: "image too large (>2MB)" }, 413);
  if (!/^image\//.test(image.type)) return c.json({ error: "not an image" }, 400);

  const lat = parseFloat(form.get("lat"));
  const lng = parseFloat(form.get("lng"));
  const accuracy = parseFloat(form.get("accuracy") || "0");
  const note = (form.get("note") || "").toString().slice(0, 200);
  const vRaw = (form.get("visibility") || "").toString();
  const visibility = vRaw === "private" ? "private"
    : vRaw === "keyed" ? "keyed"
    : "public";
  let accessKey = null;
  let accessKeyIssued = false; // 自動発行か既存キーへの追加か
  if (visibility === "keyed") {
    const userKeyRaw = normalizeKey(form.get("access_key"));
    if (userKeyRaw) {
      if (!isValidUserKey(userKeyRaw)) {
        return c.json({ error: "invalid access_key (6-20 chars, a-z 0-9 -)" }, 400);
      }
      const owner = await findKeyOwner(c.env.DB, userKeyRaw);
      if (owner && owner !== s.userId) {
        return c.json({ error: "access_key already used by another user" }, 409);
      }
      accessKey = userKeyRaw;
    } else {
      accessKey = generateAccessKey(6);
      accessKeyIssued = true;
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: "bad coords" }, 400);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return c.json({ error: "coords out of range" }, 400);
  }

  // 容量ガード
  const total = await getTotalImageBytes(c.env.DB);
  if (total + image.size > MAX_TOTAL_BYTES) {
    return c.json({ error: "storage capacity reached" }, 507);
  }

  const id = crypto.randomUUID();
  const bytes = new Uint8Array(await image.arrayBuffer());
  const gh = geohash(lat, lng, 6);
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO memories(id, user_id, lat, lng, accuracy, note, image_blob, image_type, image_size, geohash, visibility, access_key, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, s.userId, lat, lng, accuracy, note,
    bytes, image.type || "image/jpeg", image.size, gh, visibility, accessKey, now
  ).run();

  const imageUrl = accessKey
    ? `/api/memories/${id}/image?key=${encodeURIComponent(accessKey)}`
    : `/api/memories/${id}/image`;
  return c.json({
    id, lat, lng, accuracy, note, visibility,
    accessKey: accessKey || undefined,
    accessKeyIssued: accessKeyIssued || undefined,
    imageUrl,
    createdAt: now,
    userId: s.userId,
  });
});

// 自分が使ったことのある合言葉一覧（datalist 用）
app.get("/api/me/keys", async (c) => {
  const s = await requireSession(c);
  if (!s) return c.json({ error: "unauthorized" }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT access_key AS key, COUNT(*) AS count, MAX(created_at) AS last_at
     FROM memories
     WHERE visibility = 'keyed' AND user_id = ? AND access_key IS NOT NULL
     GROUP BY access_key
     ORDER BY last_at DESC`
  ).bind(s.userId).all();
  return c.json({ keys: results });
});

// 可視性の変更（所有者のみ）
app.patch("/api/memories/:id", async (c) => {
  const s = await requireSession(c);
  if (!s) return c.json({ error: "unauthorized" }, 401);
  const id = c.req.param("id");
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const nextVisibility = body?.visibility === "private" ? "private"
    : body?.visibility === "public" ? "public" : null;
  if (!nextVisibility) return c.json({ error: "visibility required" }, 400);

  const row = await c.env.DB.prepare(
    "SELECT user_id FROM memories WHERE id = ?"
  ).bind(id).first();
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.user_id !== s.userId) return c.json({ error: "forbidden" }, 403);

  await c.env.DB.prepare(
    "UPDATE memories SET visibility = ? WHERE id = ?"
  ).bind(nextVisibility, id).run();
  return c.json({ ok: true, visibility: nextVisibility });
});

// 削除（所有者のみ）
app.delete("/api/memories/:id", async (c) => {
  const s = await requireSession(c);
  if (!s) return c.json({ error: "unauthorized" }, 401);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT user_id FROM memories WHERE id = ?"
  ).bind(id).first();
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.user_id !== s.userId) return c.json({ error: "forbidden" }, 403);

  await c.env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// 容量統計（デバッグ用）
app.get("/api/stats", async (c) => {
  const total = await getTotalImageBytes(c.env.DB);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM memories").first();
  return c.json({
    total_bytes: total,
    total_mb: (total / (1024 * 1024)).toFixed(2),
    max_bytes: MAX_TOTAL_BYTES,
    count: count.n,
  });
});

// ==========================================================
// ヘルスチェック
// ==========================================================
app.get("/", (c) => c.text("kokoniita API"));
app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

export default app;
