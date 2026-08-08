// KIOKU PIN i18n
// 使い方:
//   t("compose.title")                       -> 文字列
//   t("history.count", { n: 3 })             -> 関数エントリに変数を渡す
//   HTMLは data-i18n="key" / data-i18n-attr="placeholder:key,aria-label:key"
(function () {
  const STORAGE_KEY = "kiokupin.lang.v1";
  const DEFAULT = "ja";
  const SUPPORTED = ["ja", "en"];

  const dicts = (window.KIOKU_PIN_I18N = window.KIOKU_PIN_I18N || {});
  let current = DEFAULT;

  function detect() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch (_) {}
    const nav = (navigator.language || "ja").toLowerCase();
    if (nav.startsWith("ja")) return "ja";
    return "en";
  }

  function resolve(dict, key) {
    if (!dict) return undefined;
    // ドット区切りで階層解決も、フラットキーも両対応
    if (dict[key] != null) return dict[key];
    const parts = key.split(".");
    let cur = dict;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function t(key, vars) {
    const primary = resolve(dicts[current], key);
    const fallback = primary == null ? resolve(dicts[DEFAULT], key) : primary;
    if (fallback == null) return key; // キー未定義: キー名をそのまま返す（バグ発見用）
    if (typeof fallback === "function") return fallback(vars || {});
    return fallback;
  }

  function setLocale(lang) {
    if (!SUPPORTED.includes(lang)) return;
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    document.documentElement.setAttribute("lang", lang);
    applyDom(document);
    window.dispatchEvent(new CustomEvent("i18n:changed", { detail: { lang } }));
  }

  function getLocale() { return current; }

  // data-i18n / data-i18n-attr を DOM に反映
  function applyDom(root) {
    if (!root) root = document;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    });
    root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      const spec = el.getAttribute("data-i18n-attr");
      if (!spec) return;
      spec.split(",").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
  }

  current = detect();
  document.documentElement.setAttribute("lang", current);

  window.i18n = { t, setLocale, getLocale, applyDom, SUPPORTED };
  window.t = t; // 短縮
})();
