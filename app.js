// ココニイタ。— レーダー / AR / 記憶投稿
// KOKONIITA_CONFIG.API_BASE が設定されているとAPIモードで動作する。

const UNLOCK_RADIUS_M = 20;
const GPS_ACCURACY_THRESHOLD_M = 20;
const MAX_IMAGE_DIM = 1600;      // クロップ前の作業用最大寸法
const OUTPUT_SIZE = 720;         // 保存する正方形サイズ
const JPEG_QUALITY = 0.72;

// レーダー表示範囲（メートル）。ボタンで循環。
const RANGE_STEPS = [100, 500, 1000, 5000];
const RANGE_DOT_R = { 100: 4.0, 500: 3.0, 1000: 2.3, 5000: 1.4 };
const RANGE_CLUSTER_R = { 100: 6.0, 500: 4.8, 1000: 4.0, 5000: 3.0 };
// 自分マーカーのスケール倍率（100m=1.0 を基準に、広範囲ほど縮小）
const RANGE_ME_SCALE = { 100: 1.0, 500: 0.85, 1000: 0.75, 5000: 0.6 };
const ME_BASE_SX = 0.75;
const ME_BASE_SY = 1.25;
let rangeIndex = 1; // 初期 500m

// クラスタリング閾値（レーダー座標系での距離。viewBox=200 → 半径100）
const CLUSTER_PX = 8;

const $ = (id) => document.getElementById(id);

// ---------- 状態 ----------
let myPos = null;      // {lat, lng, accuracy}
let gpsError = null;   // 位置情報エラー
let heading = 0;       // 度、0=北、時計回り

// ---------- API ----------
const API_BASE = (window.KOKONIITA_CONFIG?.API_BASE || "").replace(/\/$/, "");
const TOKEN_STORAGE_KEY = "kokoniita.token.v1";

let _publicCache = [];    // 全公開記憶
let _myCache = [];        // 自分の記憶
let _currentUser = null;  // {id, name, email, picture} | null

function getStoredToken() {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY) || null; }
  catch { return null; }
}
function setStoredToken(t) {
  try { t ? localStorage.setItem(TOKEN_STORAGE_KEY, t) : localStorage.removeItem(TOKEN_STORAGE_KEY); }
  catch {}
}
function apiUrl(p) { return API_BASE + p; }
function apiFetch(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(apiUrl(path), { credentials: "include", ...opts, headers });
}
function normalizeApiMemory(m) {
  return { ...m, image: apiUrl(m.imageUrl) };
}

function loadMemories() { return _publicCache; }
function loadMyMemories() { return _myCache; }

async function refreshMemories() {
  try {
    const r = await apiFetch("/api/memories");
    if (!r.ok) return;
    const j = await r.json();
    _publicCache = (j.memories || []).map(normalizeApiMemory);
  } catch (e) { console.warn("refreshMemories", e); }
}
async function refreshMyMemories() {
  if (!_currentUser) { _myCache = []; return; }
  try {
    const r = await apiFetch("/api/me/memories");
    if (r.status === 401) { _currentUser = null; _myCache = []; updateUserChip(); return; }
    if (!r.ok) return;
    const j = await r.json();
    _myCache = (j.memories || []).map(normalizeApiMemory);
  } catch (e) { console.warn("refreshMyMemories", e); }
}
async function refreshMe() {
  try {
    const r = await apiFetch("/api/me");
    if (!r.ok) return;
    const j = await r.json();
    _currentUser = j.user || null;
    updateUserChip();
  } catch (e) { console.warn("refreshMe", e); }
}

async function postMemoryToApi({ blob, lat, lng, accuracy, note, visibility }) {
  const fd = new FormData();
  fd.append("image", blob, "memory.jpg");
  fd.append("lat", String(lat));
  fd.append("lng", String(lng));
  fd.append("accuracy", String(accuracy));
  fd.append("note", note || "");
  fd.append("visibility", visibility === "private" ? "private" : "public");
  const r = await apiFetch("/api/memories", { method: "POST", body: fd });
  if (r.status === 401) throw new Error("unauthorized");
  if (!r.ok) throw new Error("post failed: " + r.status);
  return r.json();
}

async function removeMemory(id) {
  const r = await apiFetch(`/api/memories/${id}`, { method: "DELETE" });
  if (r.status === 401) throw new Error("unauthorized");
  if (r.status === 403) throw new Error("forbidden");
  if (!r.ok && r.status !== 404) throw new Error("delete failed");
  await Promise.all([refreshMemories(), refreshMyMemories()]);
}

async function updateMemoryVisibility(id, visibility) {
  const r = await apiFetch(`/api/memories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
  if (r.status === 401) throw new Error("unauthorized");
  if (r.status === 403) throw new Error("forbidden");
  if (!r.ok) throw new Error("update failed");
  // ローカルキャッシュを即時反映
  for (const arr of [_publicCache, _myCache]) {
    const m = arr.find(x => x.id === id);
    if (m) m.visibility = visibility;
  }
  // private→public でレーダー上に足りない場合があるため再取得
  await refreshMemories();
}

function goToLogin() { window.location.href = apiUrl("/api/auth/google"); }
function updateUserChip() {
  const chip = document.getElementById("user-chip");
  const avatar = document.getElementById("user-avatar");
  const label = document.getElementById("user-label");
  if (!chip || !avatar || !label) return;
  chip.classList.remove("hidden");
  if (_currentUser) {
    chip.dataset.state = "in";
    if (_currentUser.picture) {
      avatar.src = _currentUser.picture;
      avatar.classList.remove("hidden");
      label.classList.add("hidden");
    } else {
      avatar.classList.add("hidden");
      label.classList.remove("hidden");
      label.textContent = _currentUser.name || "アカウント";
    }
  } else {
    chip.dataset.state = "out";
    avatar.classList.add("hidden");
    label.classList.remove("hidden");
    label.textContent = "サインイン";
  }
}

// ---------- 幾何 ----------
function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 自分から見た記憶の方位（北基準・度、時計回り）
function bearingDeg(from, to) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const φ1 = toRad(from.lat), φ2 = toRad(to.lat);
  const λ1 = toRad(from.lng), λ2 = toRad(to.lng);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ---------- 位置情報 ----------
function watchLocation() {
  if (!navigator.geolocation) {
    $("hud-status").textContent = "位置情報に非対応";
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      myPos = { lat: latitude, lng: longitude, accuracy };
      gpsError = null;
      updateHud();
      renderRadar();
      syncMapCenter();
      syncMapZoom();
      updatePlaceButtonState();
    },
    (err) => {
      gpsError = err.message || "位置情報を取得できません";
      $("hud-status").textContent = `位置情報エラー: ${gpsError}`;
      updatePlaceButtonState();
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );
}

// ---------- 方位センサー ----------
function setupOrientation() {
  // iOS 13+ は明示的な許可が必要
  const needsPrompt = typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function";

  if (needsPrompt) {
    $("orient-prompt").classList.remove("hidden");
    $("orient-allow").addEventListener("click", async () => {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res === "granted") attachOrientationListener();
      } catch (e) { /* 拒否時は無回転で継続 */ }
      $("orient-prompt").classList.add("hidden");
    }, { once: true });
  } else {
    attachOrientationListener();
  }
}

function attachOrientationListener() {
  const handler = (e) => {
    let h = null;
    if (typeof e.webkitCompassHeading === "number") {
      // iOS: 0=北、時計回り
      h = e.webkitCompassHeading;
    } else if (typeof e.alpha === "number") {
      // Android/その他: alpha は 0=北基準に近いが端末により符号が異なる
      // absolute な場合は 360 - alpha が北基準時計回りに近似
      h = (360 - e.alpha) % 360;
    }
    if (h !== null && !Number.isNaN(h)) {
      heading = h;
      applyRadarRotation();
    }
  };
  window.addEventListener("deviceorientationabsolute", handler, true);
  window.addEventListener("deviceorientation", handler, true);
}

// 記憶ラッパー用: 位置(cx,cy)に配置しつつ、
// 親の rotate(-heading) と CSS scaleY(0.6) を打ち消してドット・文字を正立・非扁平に保つ
function memWrapTransform(cx, cy) {
  return `translate(${(+cx).toFixed(2)},${(+cy).toFixed(2)}) rotate(${heading}) scale(1,1.6667)`;
}
function applyRadarRotation() {
  // レーダー回転レイヤーを -heading 度回転（自分の向きが常に上）
  $("radar-rotate").setAttribute("transform", `rotate(${-heading})`);
  // 各記憶ラッパーの counter-rotation を更新
  document.querySelectorAll(".mem-wrap").forEach(el => {
    el.setAttribute("transform", memWrapTransform(el.dataset.cx, el.dataset.cy));
  });
  syncMapBearing();
}

// ---------- 背景マップ (MapLibre + OpenFreeMap positron) ----------
let _map = null;
let _mapReady = false;
const MAP_KEEP_PREFIXES = [
  "background", "landcover", "landuse", "park",
  "water", "waterway",
  "tunnel", "bridge", "road", "highway", "transportation",
];
function shouldKeepMapLayer(id) {
  if (!id) return false;
  const lid = id.toLowerCase();
  if (lid.includes("label") || lid.includes("name") || lid.includes("text")) return false;
  if (lid.includes("building") || lid.includes("poi") ||
      lid.includes("place") || lid.includes("boundary") ||
      lid.includes("aeroway") || lid.includes("housenumber")) return false;
  return MAP_KEEP_PREFIXES.some(p => lid.startsWith(p) || lid.includes("_" + p) || lid.includes("-" + p));
}
function initRadarMap() {
  const el = document.getElementById("radar-map");
  if (!el || typeof maplibregl === "undefined") return;
  _map = new maplibregl.Map({
    container: el,
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [139.767, 35.681], // 仮: 東京駅
    zoom: 15,
    pitch: 72,
    interactive: false,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: false,
    fadeDuration: 0,
  });
  _map.on("load", () => {
    // 陸・道・川以外のレイヤを非表示、水は白に
    const layers = _map.getStyle().layers || [];
    for (const l of layers) {
      const lidLower = l.id.toLowerCase();
      if (!shouldKeepMapLayer(l.id)) {
        try { _map.setLayoutProperty(l.id, "visibility", "none"); } catch {}
        continue;
      }
      if (l.type === "symbol") {
        try { _map.setLayoutProperty(l.id, "visibility", "none"); } catch {}
        continue;
      }
      if (lidLower.includes("casing") || lidLower.includes("outline")) {
        try { _map.setLayoutProperty(l.id, "visibility", "none"); } catch {}
        continue;
      }
      const lid = l.id.toLowerCase();
      const isWater = lid.includes("water") || lid.includes("waterway");
      const isRoad = lid.startsWith("road") || lid.startsWith("highway") ||
                     lid.startsWith("tunnel") || lid.startsWith("bridge") ||
                     lid.startsWith("transportation");
      if (isWater || isRoad) {
        try {
          if (l.type === "fill") _map.setPaintProperty(l.id, "fill-color", "#ffffff");
          if (l.type === "line") _map.setPaintProperty(l.id, "line-color", "#ffffff");
        } catch {}
      }
    }
    _mapReady = true;
    syncMapCenter(); syncMapZoom(); syncMapBearing();
  });
}
function rangeToZoom(rangeMeters) {
  if (!_map) return 15;
  const lat = (myPos?.lat ?? 35.681) * Math.PI / 180;
  const halfPx = _map.getContainer().clientHeight / 2;
  if (!halfPx || !rangeMeters) return 15;
  const metersPerPx = rangeMeters / halfPx;
  return Math.log2(156543.03392 * Math.cos(lat) / metersPerPx);
}
function syncMapCenter() {
  if (!_mapReady || !myPos) return;
  _map.jumpTo({ center: [myPos.lng, myPos.lat] });
}
function syncMapZoom() {
  if (!_mapReady) return;
  _map.setZoom(rangeToZoom(currentRange()));
}
function syncMapBearing() {
  if (!_mapReady) return;
  _map.setBearing(heading);
}

// ---------- レーダー描画 ----------
function currentRange() { return RANGE_STEPS[rangeIndex]; }

function renderRadar() {
  const layer = $("memory-layer");
  const edge = $("edge-layer");
  layer.innerHTML = "";
  edge.innerHTML = "";

  if (!myPos) return;

  const range = currentRange();
  const memories = loadMemories();

  // 位置ごとに座標を計算
  const points = [];
  const edges = [];
  for (const m of memories) {
    const d = distanceMeters(myPos, { lat: m.lat, lng: m.lng });
    const b = bearingDeg(myPos, { lat: m.lat, lng: m.lng });
    // レーダーはビューポート (-100..100)、表示範囲=95px 相当（余白5）
    const scaled = (d / range) * 95;
    const rad = b * Math.PI / 180;
    // SVG座標: 北(上) = -y、東(右) = +x、方位=時計回り
    const x = Math.sin(rad) * scaled;
    const y = -Math.cos(rad) * scaled;

    if (d <= range) {
      points.push({ x, y, d, memories: [m] });
    } else {
      // 圏外：外周のさらに外側に方向インジケータ
      const ex = Math.sin(rad) * 103;
      const ey = -Math.cos(rad) * 103;
      edges.push({ x: ex, y: ey });
    }
  }

  // クラスタリング（近い点をマージ）
  const clusters = clusterPoints(points, CLUSTER_PX);

  // 記憶ピン描画
  const dotR = RANGE_DOT_R[range] ?? 2.5;
  const clusterR = RANGE_CLUSTER_R[range] ?? 4.5;
  for (const c of clusters) {
    const count = c.memories.length;
    const isCluster = count > 1;
    // クラスタ内に20m以内があれば近距離扱い
    const hasNear = c.memories.some(m =>
      distanceMeters(myPos, { lat: m.lat, lng: m.lng }) <= UNLOCK_RADIUS_M
    );
    const allPrivateMine = _currentUser && c.memories.every(m =>
      m.visibility === "private" && m.userId === _currentUser.id
    );
    const r = isCluster ? clusterR : dotR;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "mem-wrap");
    g.dataset.cx = c.x.toFixed(2);
    g.dataset.cy = c.y.toFixed(2);
    g.setAttribute("transform", memWrapTransform(c.x, c.y));

    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", 0);
    dot.setAttribute("cy", 0);
    dot.setAttribute("r", r);
    const classes = ["memory-dot"];
    if (isCluster) classes.push("cluster");
    if (hasNear) classes.push("near");
    if (allPrivateMine) classes.push("private");
    dot.setAttribute("class", classes.join(" "));
    if (hasNear) {
      dot.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // 20m以内で最も近いものを開く
        const near = c.memories
          .map(m => ({ m, d: distanceMeters(myPos, { lat: m.lat, lng: m.lng }) }))
          .filter(x => x.d <= UNLOCK_RADIUS_M)
          .sort((a, b) => a.d - b.d)[0];
        if (near) openViewer(near.m);
      });
    }
    g.appendChild(dot);

    if (isCluster) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", 0);
      text.setAttribute("y", 0);
      text.setAttribute("class", "cluster-num");
      text.textContent = String(count);
      g.appendChild(text);
    }

    layer.appendChild(g);
  }

  // 圏外インジケータ（縁の小三角）
  for (const e of edges) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "mem-wrap");
    g.dataset.cx = e.x.toFixed(2);
    g.dataset.cy = e.y.toFixed(2);
    g.setAttribute("transform", memWrapTransform(e.x, e.y));
    const tri = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    tri.setAttribute("cx", 0);
    tri.setAttribute("cy", 0);
    tri.setAttribute("r", 1.2);
    tri.setAttribute("class", "edge-arrow");
    g.appendChild(tri);
    edge.appendChild(g);
  }

}

function clusterPoints(points, threshold) {
  const result = [];
  const used = new Array(points.length).fill(false);
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const group = { x: points[i].x, y: points[i].y, memories: [...points[i].memories], d: points[i].d };
    let sx = points[i].x, sy = points[i].y, cnt = 1;
    for (let j = i + 1; j < points.length; j++) {
      if (used[j]) continue;
      const dx = points[j].x - group.x;
      const dy = points[j].y - group.y;
      if (Math.hypot(dx, dy) <= threshold) {
        used[j] = true;
        group.memories.push(...points[j].memories);
        group.d = Math.min(group.d, points[j].d);
        sx += points[j].x; sy += points[j].y; cnt++;
      }
    }
    group.x = sx / cnt;
    group.y = sy / cnt;
    result.push(group);
  }
  return result;
}

function updateHud() {
  if (!myPos) return;
  const acc = Math.round(myPos.accuracy);
  $("hud-status").textContent = `現在地取得 (±${acc}m)`;
}

// ---------- レーダー範囲切替 ----------
function setRange(idx) {
  const clamped = Math.max(0, Math.min(RANGE_STEPS.length - 1, idx));
  if (clamped === rangeIndex) return;
  rangeIndex = clamped;
  const r = RANGE_STEPS[rangeIndex];
  const label = $("range-label");
  if (label) label.textContent = r >= 1000 ? `${r / 1000}km` : `${r}m`;
  updateRangeZoomButtons();
  updateMeMarkerScale();
  renderRadar();
  syncMapZoom();
}
function updateMeMarkerScale() {
  const el = document.getElementById("me-marker");
  if (!el) return;
  const f = RANGE_ME_SCALE[currentRange()] ?? 1;
  el.setAttribute("transform", `scale(${(ME_BASE_SX * f).toFixed(4)},${(ME_BASE_SY * f).toFixed(4)})`);
}
function updateRangeZoomButtons() {
  const up = $("range-up"), down = $("range-down");
  if (up) up.disabled = rangeIndex >= RANGE_STEPS.length - 1;
  if (down) down.disabled = rangeIndex <= 0;
}
function rangeUp() { setRange(rangeIndex + 1); }
function rangeDown() { setRange(rangeIndex - 1); }

// ---------- 画面遷移 ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

// ---------- 記憶を置く ----------
// ＋記憶を置くボタン押下：GPS精度チェック→OKなら写真選択起動
function onPlaceButtonTap() {
  if (!_currentUser) {
    if (confirm("記憶を置くにはGoogleでログインが必要です。ログインしますか？")) goToLogin();
    return;
  }
  if (!myPos) {
    showToast(gpsError
      ? `位置情報エラー：${gpsError}`
      : "位置情報を取得中です。もう少しお待ちください");
    return;
  }
  if (myPos.accuracy > GPS_ACCURACY_THRESHOLD_M) {
    openAccuracyPrompt();
    return;
  }
  $("media-input").click();
}

function openAccuracyPrompt() {
  const el = $("accuracy-prompt");
  const cur = $("accuracy-current");
  if (cur && myPos) cur.textContent = `現在の精度: ±${Math.round(myPos.accuracy)}m`;
  el.classList.remove("hidden");
}
function closeAccuracyPrompt() {
  $("accuracy-prompt").classList.add("hidden");
}

async function handleMediaPick(e) {
  const file = e.target.files?.[0];
  e.target.value = ""; // 同じファイル再選択対応
  if (!file) return;
  // 選択直後にもう一度精度チェック（時間経過で悪化した場合）
  if (!myPos || myPos.accuracy > GPS_ACCURACY_THRESHOLD_M) {
    showToast("位置精度が低くなりました。もう一度お試しください");
    return;
  }
  const dataUrl = await downscaleImage(file, MAX_IMAGE_DIM);
  $("note-input").value = "";
  const pt = $("private-toggle");
  if (pt) pt.checked = false;
  openComposeSheet();
  // シートが開ききってから cropper サイズを測る
  requestAnimationFrame(() => requestAnimationFrame(() => loadCropper(dataUrl)));
}

function openComposeSheet() {
  const sheet = $("compose-sheet");
  sheet.classList.remove("hidden");
  requestAnimationFrame(() => sheet.classList.add("open"));
}
function closeComposeSheet() {
  const sheet = $("compose-sheet");
  sheet.classList.remove("open");
  setTimeout(() => {
    sheet.classList.add("hidden");
    const cimg = $("cropper-img");
    if (cimg) cimg.removeAttribute("src");
    cropper.ready = false;
  }, 320);
}

function updatePlaceButtonState() {
  const btn = $("place-btn");
  if (!btn) return;
  const disabled = !myPos || myPos.accuracy > GPS_ACCURACY_THRESHOLD_M;
  btn.classList.toggle("looks-disabled", disabled);
  updateHudHint(disabled);
}

function updateHudHint(show) {
  const hint = $("hud-hint");
  if (!hint) return;
  if (show) {
    hint.classList.remove("hidden");
    requestAnimationFrame(() => hint.classList.add("visible"));
  } else {
    hint.classList.remove("visible");
    setTimeout(() => hint.classList.add("hidden"), 800);
  }
}

async function downscaleImage(file, maxDim) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  return canvas.toDataURL("image/jpeg", 0.9);
}

// ---------- クロップ ----------
const cropper = {
  ready: false,
  cw: 0, ch: 0, iw: 0, ih: 0,
  x: 0, y: 0, scale: 1, minScale: 1, maxScale: 4,
};
const cropTouches = new Map();
let pinchStartDist = 0, pinchStartScale = 1;

function loadCropper(dataUrl) {
  const container = $("cropper");
  const img = $("cropper-img");
  img.onload = () => {
    const rect = container.getBoundingClientRect();
    cropper.cw = rect.width;
    cropper.ch = rect.height;
    cropper.iw = img.naturalWidth;
    cropper.ih = img.naturalHeight;
    cropper.minScale = Math.max(cropper.cw / cropper.iw, cropper.ch / cropper.ih);
    cropper.maxScale = cropper.minScale * 4;
    cropper.scale = cropper.minScale;
    cropper.x = (cropper.cw - cropper.iw * cropper.scale) / 2;
    cropper.y = (cropper.ch - cropper.ih * cropper.scale) / 2;
    const slider = $("zoom-slider");
    slider.min = cropper.minScale;
    slider.max = cropper.maxScale;
    slider.step = (cropper.maxScale - cropper.minScale) / 200;
    slider.value = cropper.minScale;
    cropper.ready = true;
    applyCropperTransform();
  };
  img.src = dataUrl;
}

function applyCropperTransform() {
  if (!cropper.ready) return;
  const scaledW = cropper.iw * cropper.scale;
  const scaledH = cropper.ih * cropper.scale;
  cropper.x = Math.min(0, Math.max(cropper.cw - scaledW, cropper.x));
  cropper.y = Math.min(0, Math.max(cropper.ch - scaledH, cropper.y));
  $("cropper-img").style.transform =
    `translate(${cropper.x}px, ${cropper.y}px) scale(${cropper.scale})`;
}

function zoomAt(newScale, cx, cy) {
  newScale = Math.max(cropper.minScale, Math.min(cropper.maxScale, newScale));
  const k = newScale / cropper.scale;
  cropper.x = cx - k * (cx - cropper.x);
  cropper.y = cy - k * (cy - cropper.y);
  cropper.scale = newScale;
  $("zoom-slider").value = newScale;
  applyCropperTransform();
}

function setupCropperEvents() {
  const el = $("cropper");

  el.addEventListener("pointerdown", (e) => {
    if (!cropper.ready) return;
    el.setPointerCapture(e.pointerId);
    cropTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (cropTouches.size === 2) {
      const [a, b] = [...cropTouches.values()];
      pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartScale = cropper.scale;
    }
  });

  el.addEventListener("pointermove", (e) => {
    if (!cropTouches.has(e.pointerId)) return;
    const prev = cropTouches.get(e.pointerId);
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    cropTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (cropTouches.size === 1) {
      cropper.x += dx;
      cropper.y += dy;
      applyCropperTransform();
    } else if (cropTouches.size === 2) {
      const [a, b] = [...cropTouches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = el.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      zoomAt(pinchStartScale * (dist / pinchStartDist), midX, midY);
    }
  });

  const endPointer = (e) => { cropTouches.delete(e.pointerId); };
  el.addEventListener("pointerup", endPointer);
  el.addEventListener("pointercancel", endPointer);
  el.addEventListener("pointerleave", endPointer);

  el.addEventListener("wheel", (e) => {
    if (!cropper.ready) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(cropper.scale * factor, cx, cy);
  }, { passive: false });

  $("zoom-slider").addEventListener("input", (e) => {
    if (!cropper.ready) return;
    zoomAt(parseFloat(e.target.value), cropper.cw / 2, cropper.ch / 2);
  });
}

function cropToDataUrl(size = OUTPUT_SIZE, quality = JPEG_QUALITY) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const sx = -cropper.x / cropper.scale;
  const sy = -cropper.y / cropper.scale;
  const sw = cropper.cw / cropper.scale;
  const sh = cropper.ch / cropper.scale;
  ctx.drawImage($("cropper-img"), sx, sy, sw, sh, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", quality);
}

let _saving = false;
async function savePlaced() {
  if (_saving) return;
  if (!cropper.ready || !myPos) return;
  if (myPos.accuracy > GPS_ACCURACY_THRESHOLD_M) {
    showToast("位置精度が低くなったため置けませんでした");
    return;
  }
  if (!_currentUser) {
    closeComposeSheet();
    if (confirm("記憶を置くにはGoogleでログインが必要です。ログインしますか？")) goToLogin();
    return;
  }
  _saving = true;
  const btn = $("save-btn");
  if (btn) btn.disabled = true;
  const image = cropToDataUrl();
  const note = $("note-input").value.trim();
  const visibility = $("private-toggle")?.checked ? "private" : "public";

  try {
    const blob = await (await fetch(image)).blob();
    await postMemoryToApi({
      blob,
      lat: myPos.lat, lng: myPos.lng, accuracy: myPos.accuracy, note, visibility,
    });
    await Promise.all([refreshMemories(), refreshMyMemories()]);
    renderRadar();
    closeComposeSheet();
    showToast("記憶を置きました");
  } catch (e) {
    if (e.message === "unauthorized") {
      closeComposeSheet();
      if (confirm("ログインが必要です。ログインしますか？")) goToLogin();
    } else {
      showToast("投稿に失敗しました");
    }
  } finally {
    _saving = false;
    if (btn) btn.disabled = false;
  }
}

// ---------- トースト ----------
let toastTimer = null;
function showToast(msg, ms = 3000) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  // 次の描画サイクルで .show を付与（RAFが背景タブで止まる問題を避けるため setTimeout を使用）
  setTimeout(() => t.classList.add("show"), 16);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.classList.add("hidden"), 260);
  }, ms);
}

// ---------- AR画面 ----------
const AR_FOV_DEG = 60;             // 想定水平画角
const AR_FAR_MAX_M = 100;          // ARに映る最遠距離
const AR_NEAR_MAX_M = 20;          // タップで画像解放される距離
const AR_ICON_MIN_PX = 2;          // 100m地点でのアイコンサイズ
const AR_ICON_MAX_PX = 20;         // 20m地点でのアイコンサイズ
let arStream = null;
let arRafId = null;
let arActive = false;

async function openAR() {
  showScreen("ar-screen");
  arActive = true;
  $("ar-error").classList.add("hidden");
  const video = $("ar-video");
  try {
    arStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    video.srcObject = arStream;
  } catch (err) {
    showArError(`カメラを起動できませんでした：${err.message}`);
    return;
  }
  arLoop();
}

function closeAR() {
  arActive = false;
  if (arRafId) { cancelAnimationFrame(arRafId); arRafId = null; }
  if (arStream) {
    arStream.getTracks().forEach(t => t.stop());
    arStream = null;
  }
  $("ar-overlay").innerHTML = "";
  showScreen("radar-screen");
}

function showArError(msg) {
  $("ar-error-msg").textContent = msg;
  $("ar-error").classList.remove("hidden");
}

// 記憶ID→縦位置（0.35〜0.65）を安定に決めるハッシュ
function verticalRatioForId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const norm = (Math.abs(h) % 1000) / 1000;
  return 0.35 + norm * 0.30;
}

function arLoop() {
  if (!arActive) return;
  renderArFrame();
  arRafId = requestAnimationFrame(arLoop);
}

function renderArFrame() {
  const overlay = $("ar-overlay");
  if (!myPos) {
    overlay.innerHTML = "";
    $("ar-count").textContent = "位置情報待ち…";
    return;
  }
  const memories = loadMemories();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const halfFov = AR_FOV_DEG / 2;

  // 既存要素を id 管理でリユース（毎フレーム作り直さない）
  const existing = new Map();
  overlay.querySelectorAll(".ar-item").forEach(el => {
    existing.set(el.dataset.id, el);
  });

  let visibleCount = 0;

  for (const m of memories) {
    const dist = distanceMeters(myPos, { lat: m.lat, lng: m.lng });
    if (dist > AR_FAR_MAX_M) {
      const el = existing.get(m.id);
      if (el) el.remove();
      existing.delete(m.id);
      continue;
    }

    const bearing = bearingDeg(myPos, { lat: m.lat, lng: m.lng });
    let diff = ((bearing - heading + 540) % 360) - 180; // -180..180
    if (Math.abs(diff) > halfFov) {
      const el = existing.get(m.id);
      if (el) el.remove();
      existing.delete(m.id);
      continue;
    }

    visibleCount++;

    // 距離に応じたサイズ（100m→AR_ICON_MIN_PX, 20m以下→AR_ICON_MAX_PX）
    const clamped = Math.max(AR_NEAR_MAX_M, Math.min(AR_FAR_MAX_M, dist));
    const t = (AR_FAR_MAX_M - clamped) / (AR_FAR_MAX_M - AR_NEAR_MAX_M); // 0..1
    const size = AR_ICON_MIN_PX + (AR_ICON_MAX_PX - AR_ICON_MIN_PX) * t;

    const stage = dist <= AR_NEAR_MAX_M ? "ar-near" : "ar-icon";
    const x = w / 2 + (diff / halfFov) * (w / 2);
    const y = h * verticalRatioForId(m.id);

    let el = existing.get(m.id);
    if (!el) {
      el = document.createElement("div");
      el.className = `ar-item ${stage}`;
      el.dataset.id = m.id;
      el.innerHTML = `
        <div class="ar-flipper">
          <div class="ar-face ar-front">
            <div class="polaroid-frame">
              <div class="ar-slot"></div>
              <div class="ar-dist-tag"></div>
            </div>
          </div>
          <div class="ar-face ar-back">
            <div class="polaroid-frame back">
              <div class="ar-back-slot"></div>
            </div>
          </div>
        </div>`;
      overlay.appendChild(el);
    } else {
      if (!el.classList.contains(stage)) {
        el.classList.remove("ar-icon", "ar-near");
        el.classList.add(stage);
        el.dataset.stage = "";
      }
      existing.delete(m.id);
    }

    // 中身の描画（段階変化時のみ）
    if (el.dataset.stage !== stage) {
      const frontSlot = el.querySelector(".ar-slot");
      const backSlot = el.querySelector(".ar-back-slot");
      if (stage === "ar-near") {
        frontSlot.innerHTML = `<img alt="" />`;
        frontSlot.querySelector("img").src = m.image;
      } else {
        frontSlot.innerHTML = `<div class="ar-placeholder"></div>`;
      }
      // 裏面はAR中は常に無地（メッセージは詳細ビューアで見せる）
      backSlot.innerHTML = `<div class="ar-placeholder blank"></div>`;
      el.dataset.stage = stage;
    }

    // タップ処理は近距離時のみ
    el.onclick = stage === "ar-near" ? () => onArItemTap(m, dist) : null;

    // サイズ・距離・位置更新
    el.style.width = `${size}px`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const tag = el.querySelector(".ar-dist-tag");
    if (tag) tag.textContent = `${Math.round(dist)}m`;
  }

  // 残存＝視野外に消えた要素を除去
  existing.forEach(el => el.remove());

  $("ar-count").textContent = `視界: ${visibleCount}`;
  const hint = $("ar-hint");
  if (visibleCount === 0) {
    hint.textContent = "この方向に記憶はありません";
  } else {
    hint.textContent = "近づくと記憶が鮮明になります";
  }
}

function onArItemTap(m, dist) {
  if (dist > AR_NEAR_MAX_M) return; // 20m以内のみ解放
  openViewer(m);
}

// ---------- 履歴（ボトムシート） ----------
async function openHistory() {
  if (!_currentUser) {
    if (confirm("履歴を見るにはGoogleでログインが必要です。ログインしますか？")) goToLogin();
    return;
  }
  await refreshMyMemories();
  renderHistoryList();
  const sheet = $("history-sheet");
  sheet.classList.remove("hidden");
  requestAnimationFrame(() => sheet.classList.add("open"));
}
function closeHistory() {
  const sheet = $("history-sheet");
  sheet.classList.remove("open");
  setTimeout(() => sheet.classList.add("hidden"), 320);
}

function renderHistoryList() {
  const list = $("history-list");
  const empty = $("history-empty");
  const memories = loadMyMemories().sort((a, b) => b.createdAt - a.createdAt);
  list.innerHTML = "";
  if (memories.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const m of memories) {
    const row = document.createElement("div");
    row.className = "history-row";
    if (m.visibility === "private") row.classList.add("is-private");

    const delBtn = document.createElement("button");
    delBtn.className = "history-delete";
    delBtn.type = "button";
    delBtn.textContent = "回収";

    const item = document.createElement("div");
    item.className = "history-item";

    const img = document.createElement("img");
    img.className = "history-thumb";
    img.src = m.image;
    img.alt = "";

    const body = document.createElement("div");
    body.className = "history-body";
    const msg = document.createElement("p");
    msg.className = "history-msg";
    if (m.note) msg.textContent = m.note;
    else { msg.textContent = ""; msg.classList.add("dim"); }
    const meta = document.createElement("p");
    meta.className = "history-meta";
    const d = new Date(m.createdAt);
    const dateStr = `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
    meta.textContent = m.visibility === "private" ? `${dateStr}・自分だけ` : dateStr;
    body.appendChild(msg);
    body.appendChild(meta);

    // 可視性トグル（スワイプ・タップと干渉しないよう pointerdown を止める）
    const visLabel = document.createElement("label");
    visLabel.className = "history-visibility";
    visLabel.title = "自分だけに表示";
    const visInput = document.createElement("input");
    visInput.type = "checkbox";
    visInput.checked = m.visibility === "private";
    const visIcon = document.createElement("span");
    visIcon.className = "history-visibility-icon";
    visIcon.setAttribute("aria-hidden", "true");
    visIcon.textContent = visInput.checked ? "🔒" : "🌐";
    visLabel.appendChild(visInput);
    visLabel.appendChild(visIcon);
    const stopBubble = (e) => e.stopPropagation();
    visLabel.addEventListener("pointerdown", stopBubble);
    visLabel.addEventListener("click", stopBubble);
    visInput.addEventListener("change", async (e) => {
      e.stopPropagation();
      const next = visInput.checked ? "private" : "public";
      visInput.disabled = true;
      try {
        await updateMemoryVisibility(m.id, next);
        m.visibility = next;
        visIcon.textContent = next === "private" ? "🔒" : "🌐";
        row.classList.toggle("is-private", next === "private");
        meta.textContent = next === "private" ? `${dateStr}・自分だけ` : dateStr;
        renderRadar();
      } catch (err) {
        visInput.checked = !visInput.checked;
        if (err.message === "unauthorized") {
          if (confirm("ログインが必要です。ログインしますか？")) goToLogin();
        } else {
          showToast("変更に失敗しました");
        }
      } finally {
        visInput.disabled = false;
      }
    });

    const dist = document.createElement("div");
    dist.className = "history-dist";
    if (myPos) {
      const meters = distanceMeters(myPos, { lat: m.lat, lng: m.lng });
      dist.textContent = meters < 1000
        ? `${Math.round(meters)}m`
        : `${(meters / 1000).toFixed(1)}km`;
    } else {
      dist.textContent = "—";
    }

    item.appendChild(img);
    item.appendChild(body);
    item.appendChild(visLabel);
    item.appendChild(dist);
    row.appendChild(delBtn);
    row.appendChild(item);

    attachHistorySwipe(item, () => {
      if (!confirm("この記憶を回収しますか？")) {
        item.classList.remove("revealed");
        return;
      }
      (async () => {
        try {
          await removeMemory(m.id);
          renderHistoryList();
          renderRadar();
        } catch (e) {
          if (e.message === "forbidden") showToast("この記憶は削除できません");
          else if (e.message === "unauthorized") {
            if (confirm("ログインが必要です。ログインしますか？")) goToLogin();
          } else showToast("削除に失敗しました");
        }
      })();
    }, () => {
      closeHistory();
      setTimeout(() => openViewer(m), 320);
    });

    list.appendChild(row);
  }
}

function attachHistorySwipe(item, onDelete, onTap) {
  const REVEAL = 96;
  const THRESHOLD = 40;
  let startX = 0, baseX = 0, dx = 0, active = false, moved = false;

  item.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX;
    baseX = item.classList.contains("revealed") ? -REVEAL : 0;
    dx = 0;
    active = true;
    moved = false;
    item.classList.add("swiping");
  });

  item.addEventListener("pointermove", (e) => {
    if (!active) return;
    dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    const x = Math.max(-REVEAL * 1.3, Math.min(0, baseX + dx));
    item.style.transform = `translateX(${x}px)`;
  });

  const end = () => {
    if (!active) return;
    active = false;
    item.classList.remove("swiping");
    item.style.transform = "";
    const final = baseX + dx;
    item.classList.toggle("revealed", final < -THRESHOLD);
  };
  item.addEventListener("pointerup", end);
  item.addEventListener("pointercancel", end);

  item.addEventListener("click", (e) => {
    if (moved) { e.stopPropagation(); return; }
    if (item.classList.contains("revealed")) {
      item.classList.remove("revealed");
      e.stopPropagation();
      return;
    }
    onTap();
  });

  item.parentElement && item.parentElement.querySelector(".history-delete")
    ?.addEventListener("click", (e) => { e.stopPropagation(); onDelete(); });
}

// ---------- 記憶詳細 ----------
function openViewer(m) {
  $("viewer").classList.remove("hidden");
  const dist = myPos ? distanceMeters(myPos, { lat: m.lat, lng: m.lng }) : Infinity;
  const unlocked = dist <= UNLOCK_RADIUS_M;

  $("viewer-locked").classList.toggle("hidden", unlocked);
  $("viewer-open").classList.toggle("hidden", !unlocked);

  if (unlocked) {
    $("viewer-img").src = m.image;
    $("viewer-note").textContent = m.note || "";
    $("polaroid-flip").classList.remove("flipped");
    const d = new Date(m.createdAt);
    $("viewer-meta").textContent = `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
  } else {
    $("viewer-distance").textContent = `距離: 約${Math.round(dist)}m`;
  }
}
function closeViewer() { $("viewer").classList.add("hidden"); }

// ---------- 起動 ----------
document.addEventListener("DOMContentLoaded", () => {
  initRadarMap();
  watchLocation();
  setupOrientation();
  renderRadar();
  updatePlaceButtonState();
  updateUserChip();

  // OAuthコールバックから戻ってきた場合、URLフラグメントのトークンを保存
  if (location.hash.startsWith("#kk_token=")) {
    const t = decodeURIComponent(location.hash.slice("#kk_token=".length));
    setStoredToken(t);
    history.replaceState(null, "", location.pathname + location.search);
  }
  refreshMe().then(() => {
    if (_currentUser) refreshMyMemories();
  });
  refreshMemories().then(renderRadar);
  setInterval(() => refreshMemories().then(renderRadar), 60000);

  $("user-chip").addEventListener("click", async () => {
    if (_currentUser) {
      if (!confirm(`${_currentUser.name || "アカウント"} からログアウトしますか？`)) return;
      try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch {}
      setStoredToken(null);
      _currentUser = null; _myCache = [];
      updateUserChip();
      showToast("ログアウトしました");
    } else {
      goToLogin();
    }
  });

  $("range-up").addEventListener("click", rangeUp);
  $("range-down").addEventListener("click", rangeDown);
  updateRangeZoomButtons();
  updateMeMarkerScale();
  $("place-btn").addEventListener("click", onPlaceButtonTap);
  $("accuracy-close").addEventListener("click", closeAccuracyPrompt);
  $("accuracy-prompt").addEventListener("click", (e) => {
    if (e.target === $("accuracy-prompt")) closeAccuracyPrompt();
  });
  $("history-btn").addEventListener("click", openHistory);
  $("history-close").addEventListener("click", closeHistory);
  $("history-backdrop").addEventListener("click", closeHistory);
  $("ar-btn").addEventListener("click", openAR);
  $("ar-back").addEventListener("click", closeAR);
  $("ar-error-back").addEventListener("click", closeAR);
  $("media-input").addEventListener("change", handleMediaPick);
  $("save-btn").addEventListener("click", savePlaced);
  $("compose-cancel").addEventListener("click", closeComposeSheet);
  $("compose-backdrop").addEventListener("click", closeComposeSheet);
  $("viewer").addEventListener("click", (e) => {
    if (e.target === $("viewer")) closeViewer();
  });
  $("polaroid-flip").addEventListener("click", () => {
    $("polaroid-flip").classList.toggle("flipped");
  });
  setupCropperEvents();
});
