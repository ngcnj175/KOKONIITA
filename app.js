// ココニイタ。— レーダー & アップロード プロトタイプ
// ローカル保存のみ（localStorage）。バックエンド／ログインは次フェーズ。

const STORAGE_KEY = "kokoniita.memories.v1";
const UNLOCK_RADIUS_M = 20;
const GPS_ACCURACY_THRESHOLD_M = 20;
const MAX_IMAGE_DIM = 1024;
const JPEG_QUALITY = 0.6;

// レーダー表示範囲（メートル）。ボタンで循環。
const RANGE_STEPS = [100, 500, 1000, 5000];
const RANGE_DOT_R = { 100: 4.0, 500: 3.0, 1000: 2.3, 5000: 1.4 };
const RANGE_CLUSTER_R = { 100: 6.0, 500: 4.8, 1000: 4.0, 5000: 3.0 };
let rangeIndex = 1; // 初期 500m

// クラスタリング閾値（レーダー座標系での距離。viewBox=200 → 半径100）
const CLUSTER_PX = 8;

const $ = (id) => document.getElementById(id);

// ---------- 状態 ----------
let myPos = null;      // {lat, lng, accuracy}
let gpsError = null;   // 位置情報エラー
let heading = 0;       // 度、0=北、時計回り
let orientReady = false;

// ---------- ストレージ ----------
function loadMemories() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function saveMemories(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}
function addMemory(m) {
  const list = loadMemories(); list.push(m); saveMemories(list);
}
function removeMemory(id) {
  saveMemories(loadMemories().filter(m => m.id !== id));
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
      updateUploadGpsPanel();
    },
    (err) => {
      gpsError = err.message || "位置情報を取得できません";
      $("hud-status").textContent = `位置情報エラー: ${gpsError}`;
      updateUploadGpsPanel();
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
      orientReady = true;
    }, { once: true });
  } else {
    attachOrientationListener();
    orientReady = true;
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

function applyRadarRotation() {
  // レーダー回転レイヤーを -heading 度回転（自分の向きが常に上）
  $("radar-rotate").setAttribute("transform", `rotate(${-heading})`);
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
      // 圏外：縁の方向インジケータ
      const ex = Math.sin(rad) * 92;
      const ey = -Math.cos(rad) * 92;
      edges.push({ x: ex, y: ey, angle: b, d });
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
    const r = isCluster ? clusterR : dotR;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", c.x.toFixed(2));
    dot.setAttribute("cy", c.y.toFixed(2));
    dot.setAttribute("r", r);
    const classes = ["memory-dot"];
    if (isCluster) classes.push("cluster");
    if (hasNear) classes.push("near");
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
      text.setAttribute("x", c.x.toFixed(2));
      text.setAttribute("y", c.y.toFixed(2));
      text.setAttribute("class", "cluster-num");
      text.textContent = String(count);
      g.appendChild(text);
    }

    layer.appendChild(g);
  }

  // 圏外インジケータ（縁の小三角）
  for (const e of edges) {
    const tri = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    tri.setAttribute("cx", e.x.toFixed(2));
    tri.setAttribute("cy", e.y.toFixed(2));
    tri.setAttribute("r", 1.2);
    tri.setAttribute("class", "edge-arrow");
    edge.appendChild(tri);
  }

  // カウント表示
  const inRange = clusters.reduce((sum, c) => sum + c.memories.length, 0);
  $("hud-count").textContent = `記憶: ${inRange} / 全 ${memories.length}`;
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
function cycleRange() {
  rangeIndex = (rangeIndex + 1) % RANGE_STEPS.length;
  const r = RANGE_STEPS[rangeIndex];
  $("range-btn").textContent = r >= 1000 ? `${r / 1000}km` : `${r}m`;
  renderRadar();
}

// ---------- 画面遷移 ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

// ---------- アップロード ----------
let pendingImageDataUrl = null;

function openUpload() {
  pendingImageDataUrl = null;
  $("polaroid-preview").classList.add("hidden");
  $("polaroid-preview").src = "";
  $("polaroid-empty").classList.remove("hidden");
  $("polaroid-slot").classList.add("empty");
  $("note-input").value = "";
  updateUploadGpsPanel();
  showScreen("upload-screen");
}
function closeUpload() { showScreen("radar-screen"); }

async function handleMediaPick(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const dataUrl = await compressImage(file);
  pendingImageDataUrl = dataUrl;
  const img = $("polaroid-preview");
  img.src = dataUrl;
  img.classList.remove("hidden");
  $("polaroid-empty").classList.add("hidden");
  $("polaroid-slot").classList.remove("empty");
  updateUploadGpsPanel();
}

async function compressImage(file) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function updateUploadGpsPanel() {
  const uploadOpen = !$("upload-screen").classList.contains("hidden");
  if (!uploadOpen) return;

  const ind = $("gps-indicator");
  const primary = $("gps-primary");
  const secondary = $("gps-secondary");
  const btn = $("save-btn");
  const forceBtn = $("force-save-btn");

  if (gpsError && !myPos) {
    ind.className = "gps-indicator";
    primary.textContent = "位置情報を取得できません";
    secondary.textContent = gpsError;
    btn.disabled = true;
    forceBtn.classList.add("hidden");
    return;
  }
  if (!myPos) {
    ind.className = "gps-indicator pending";
    primary.textContent = "位置を確認中…";
    secondary.textContent = "GPSの信号を待っています（屋外に出ると早くなります）";
    btn.disabled = true;
    forceBtn.classList.add("hidden");
    return;
  }
  const acc = Math.round(myPos.accuracy);
  if (myPos.accuracy > GPS_ACCURACY_THRESHOLD_M) {
    ind.className = "gps-indicator";
    primary.textContent = `位置精度: ±${acc}m`;
    secondary.textContent = `±${GPS_ACCURACY_THRESHOLD_M}m以内になるまで通常は待つ場所です`;
    btn.disabled = true;
    forceBtn.classList.toggle("hidden", !pendingImageDataUrl);
  } else {
    ind.className = "gps-indicator ok";
    primary.textContent = `位置精度: ±${acc}m`;
    secondary.textContent = "この場所に置けます";
    btn.disabled = !pendingImageDataUrl;
    forceBtn.classList.add("hidden");
  }
}

function savePlaced(opts = {}) {
  if (!pendingImageDataUrl || !myPos) return;
  if (!opts.force && myPos.accuracy > GPS_ACCURACY_THRESHOLD_M) return;
  const memory = {
    id: crypto.randomUUID(),
    lat: myPos.lat,
    lng: myPos.lng,
    accuracy: myPos.accuracy,
    note: $("note-input").value.trim(),
    image: pendingImageDataUrl,
    createdAt: Date.now(),
  };
  addMemory(memory);
  renderRadar();
  closeUpload();
}

// ---------- AR画面 ----------
const AR_FOV_DEG = 60;             // 想定水平画角
const AR_FAR_MAX_M = 100;          // ARに映る最遠距離
const AR_NEAR_MAX_M = 20;          // タップで画像解放される距離
const AR_ICON_MIN_PX = 20;         // 100m地点でのアイコンサイズ
const AR_ICON_MAX_PX = 180;        // 20m地点でのアイコンサイズ
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
        const msg = (m.note || "").trim();
        backSlot.innerHTML = `<p class="handwritten"></p>`;
        backSlot.querySelector("p").textContent = msg || "（メッセージなし）";
      } else {
        frontSlot.innerHTML = `<div class="ar-placeholder"></div>`;
        backSlot.innerHTML = `<div class="ar-placeholder blank"></div>`;
      }
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
function openHistory() {
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
  const memories = loadMemories().sort((a, b) => b.createdAt - a.createdAt);
  list.innerHTML = "";
  if (memories.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const m of memories) {
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
    msg.textContent = m.note || "（メッセージなし）";
    const meta = document.createElement("p");
    meta.className = "history-meta";
    const d = new Date(m.createdAt);
    meta.textContent = `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
    body.appendChild(msg);
    body.appendChild(meta);

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
    item.appendChild(dist);
    item.addEventListener("click", () => {
      closeHistory();
      setTimeout(() => openViewer(m), 320);
    });

    list.appendChild(item);
  }
}

// ---------- 記憶詳細 ----------
function openViewer(m) {
  $("viewer").classList.remove("hidden");
  const dist = myPos ? distanceMeters(myPos, { lat: m.lat, lng: m.lng }) : Infinity;
  const unlocked = dist <= UNLOCK_RADIUS_M;

  $("viewer-locked").classList.toggle("hidden", unlocked);
  $("viewer-open").classList.toggle("hidden", !unlocked);
  $("viewer-delete").classList.toggle("hidden", !unlocked);
  $("viewer-delete").dataset.id = m.id;

  if (unlocked) {
    $("viewer-img").src = m.image;
    $("viewer-note").textContent = m.note || "（メッセージなし）";
    $("polaroid-flip").classList.remove("flipped");
    const d = new Date(m.createdAt);
    $("viewer-meta").textContent = `置かれた日: ${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
  } else {
    $("viewer-distance").textContent = `距離: 約${Math.round(dist)}m`;
  }
}
function closeViewer() { $("viewer").classList.add("hidden"); }

function deleteCurrent() {
  const id = $("viewer-delete").dataset.id;
  if (!id) return;
  if (!confirm("この記憶を回収しますか？")) return;
  removeMemory(id);
  renderRadar();
  closeViewer();
}

// ---------- 起動 ----------
document.addEventListener("DOMContentLoaded", () => {
  watchLocation();
  setupOrientation();
  renderRadar();

  $("range-btn").addEventListener("click", cycleRange);
  $("place-btn").addEventListener("click", openUpload);
  $("history-btn").addEventListener("click", openHistory);
  $("history-close").addEventListener("click", closeHistory);
  $("history-backdrop").addEventListener("click", closeHistory);
  $("ar-btn").addEventListener("click", openAR);
  $("ar-back").addEventListener("click", closeAR);
  $("ar-error-back").addEventListener("click", closeAR);
  $("upload-back").addEventListener("click", closeUpload);
  $("polaroid-slot").addEventListener("click", () => $("media-input").click());
  $("media-input").addEventListener("change", handleMediaPick);
  $("save-btn").addEventListener("click", () => savePlaced());
  $("force-save-btn").addEventListener("click", () => {
    if (!confirm(`位置精度が悪い状態で置きます（±${Math.round(myPos.accuracy)}m）。よろしいですか？`)) return;
    savePlaced({ force: true });
  });
  $("viewer-close").addEventListener("click", closeViewer);
  $("viewer-delete").addEventListener("click", deleteCurrent);
  $("polaroid-flip").addEventListener("click", () => {
    $("polaroid-flip").classList.toggle("flipped");
  });
});
