// ココニイタ。— レーダー & アップロード プロトタイプ
// ローカル保存のみ（localStorage）。バックエンド／ログインは次フェーズ。

const STORAGE_KEY = "kokoniita.memories.v1";
const UNLOCK_RADIUS_M = 20;
const GPS_ACCURACY_THRESHOLD_M = 20;
const MAX_IMAGE_DIM = 1600;      // クロップ前の作業用最大寸法
const OUTPUT_SIZE = 720;         // 保存する正方形サイズ
const JPEG_QUALITY = 0.72;

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

// ---------- 記憶を置く ----------
// ＋記憶を置くボタン押下：GPS精度チェック→OKなら写真選択起動
function onPlaceButtonTap() {
  if (!myPos) {
    showToast(gpsError
      ? `位置情報エラー：${gpsError}`
      : "位置情報を取得中です。もう少しお待ちください");
    return;
  }
  if (myPos.accuracy > GPS_ACCURACY_THRESHOLD_M) {
    showToast(`位置精度が低いため置けません（±${Math.round(myPos.accuracy)}m）`);
    return;
  }
  $("media-input").click();
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

function savePlaced() {
  if (!cropper.ready || !myPos) return;
  if (myPos.accuracy > GPS_ACCURACY_THRESHOLD_M) {
    showToast("位置精度が低くなったため置けませんでした");
    return;
  }
  const image = cropToDataUrl();
  const memory = {
    id: crypto.randomUUID(),
    lat: myPos.lat,
    lng: myPos.lng,
    accuracy: myPos.accuracy,
    note: $("note-input").value.trim(),
    image,
    createdAt: Date.now(),
  };
  addMemory(memory);
  renderRadar();
  closeComposeSheet();
  showToast("記憶を置きました");
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
    const row = document.createElement("div");
    row.className = "history-row";

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
    row.appendChild(delBtn);
    row.appendChild(item);

    attachHistorySwipe(item, () => {
      if (!confirm("この記憶を回収しますか？")) {
        item.classList.remove("revealed");
        return;
      }
      removeMemory(m.id);
      renderHistoryList();
      renderRadar();
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
    $("viewer-note").textContent = m.note || "（メッセージなし）";
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
  watchLocation();
  setupOrientation();
  renderRadar();
  updatePlaceButtonState();

  $("range-btn").addEventListener("click", cycleRange);
  $("place-btn").addEventListener("click", onPlaceButtonTap);
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
  $("viewer-close").addEventListener("click", closeViewer);
  $("viewer").addEventListener("click", (e) => {
    if (e.target === $("viewer")) closeViewer();
  });
  $("polaroid-flip").addEventListener("click", () => {
    $("polaroid-flip").classList.toggle("flipped");
  });
  setupCropperEvents();
});
