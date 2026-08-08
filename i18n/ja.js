// KIOKU PIN 日本語辞書
// 命名規約:
//   セクション名.要素.役割  (compose.vis.public.label など)
//   共通は common.*、トーストは toast.*、confirmダイアログは confirm.*
//   動的な値を持つエントリは関数で書く: (v) => `文字列 ${v.n}`
(function () {
  const dicts = (window.KIOKU_PIN_I18N = window.KIOKU_PIN_I18N || {});
  dicts.ja = {
    common: {
      close: "閉じる",
      back: "戻る",
      cancel: "やめる",
      copy: "コピー",
      share: "共有",
      allow: "許可する",
    },

    brand: "KIOKU PIN",

    topbar: {
      signin: "サインイン",
      account_default: "アカウント",
      admin_label: "星の記録",
      logout_confirm: (v) => `${v.name} からログアウトしますか？`,
    },

    radar: {
      hud_locating: "現在位置を取得中…",
      hud_no_position: "現在位置を取得できません",
      hud_unsupported: "位置情報に非対応",
      hud_alt_1: "あなたの位置を取得中",
      hud_alt_2: "空の下で、ちょっと立ち止まって",
      mode_public: "公開",
      mode_private: "プライベート",
      mode_group: "グループ",
      key_placeholder: "グループキー",
      range_up: "広く表示",
      range_down: "狭く表示",
      range_group: "表示範囲",
      layer_group: "表示レイヤー",
    },

    place_fab: {
      ar: "AR",
      pin: "ここにピン",
      history: "マイページ",
    },

    compose: {
      title: "新しい記憶",
      pan_label: "写真の位置とズーム",
      draw_layer: "手書きレイヤー",
      draw_toolbar: "描画ツール",
      tool: {
        pen: "ペン",
        erase: "消しゴム",
        undo: "ひとつ戻す",
        redo: "やり直す",
        clear: "全て消す",
        size: "ペンサイズ",
      },
      color: {
        group: "色",
        purple: "紫",
        blue: "青",
        green: "緑",
        yellow: "黄",
        red: "赤",
        pink: "ピンク",
        white: "白",
        black: "黒",
      },
      field: {
        message: "メッセージ（任意）",
        message_placeholder: "ここに残す言葉",
        visibility: "公開範囲",
      },
      vis: {
        public: { label: "公開", sub: "誰でも見れる" },
        private: { label: "プライベート", sub: "自分だけが見れる" },
        keyed: { label: "グループ", sub: "キーを知る人のみ" },
      },
      key: {
        set_label: "グループキーを設定（空欄なら自動発行）",
        placeholder: "例: とんかつ / matsuri など（2〜20文字）",
        hint: "同じキーで複数の記憶をまとめられます。",
        mode_label: "投稿権限",
        mode_owner: "自分だけ投稿可能",
        mode_open: "誰でも投稿可能",
        status_new: "新しいグループキーとして発行されます",
        status_open_owner: "🌐 誰でも投稿できるグループ（あなたがオーナー）",
        status_open_join: "🌐 誰でも投稿できるグループに追加されます",
        status_owner_owner: "🔒 自分だけが投稿できるグループ（あなたがオーナー）",
        status_owner_locked: "🔒 このキーは他の人の非公開グループです（投稿できません）",
        datalist_owner: "オーナー",
        datalist_member: "メンバー",
        // 例: 🌐 3件・オーナー
        datalist_label: (v) => `${v.icon} ${v.count}件・${v.role}`,
      },
      save: "ピンする",
    },

    toast: {
      login_ok: "ログインしました",
      logout_ok: "ログアウトしました",
      login_needed_self: "自分の記憶を見るにはログインしてください",
      gps_locating: "位置情報を取得中です。もう少しお待ちください",
      gps_error: (v) => `位置情報エラー：${v.msg}`,
      accuracy_low: "位置精度が低くなりました。もう一度お試しください",
      accuracy_low_at_save: "位置精度が低くなったためピンできませんでした",
      saved: "ピンしました",
      saved_with_key: (v) => `グループキー「${v.key}」に追加しました`,
      key_invalid_format: "グループキーは2〜20文字（英数字・かな・漢字と _ - のみ）",
      key_conflict: "このグループキーは他の人が使用中です。別のグループキーにしてください",
      key_invalid_server: "グループキーの形式が正しくありません",
      save_failed: "投稿に失敗しました",
      copy_ok: "グループキーをコピーしました",
      copy_failed: "コピーできませんでした",
      keyed_empty: "このグループキーの記憶はありません",
      keyed_found: (v) => `${v.n}件の記憶が見つかりました`,
      removed_by_report_one: "あなたの写真が1件、通報により削除されました",
      removed_by_report_many: (v) => `あなたの写真が${v.n}件、通報により削除されました`,
      show_key: (v) => `グループキー: ${v.key}`,
      change_failed: "変更に失敗しました",
      unfave_failed: "解除に失敗しました",
      pickup_ok: "回収しました",
      pickup_ok_with_key: (v) => `回収しました。グループキー「${v.key}」は解放されました`,
      pickup_forbidden: "この記憶は回収できません",
      pickup_failed: "回収に失敗しました",
      already_removed: "この写真は削除されました",
      no_note: "コピーするメッセージがありません",
      note_copy_ok: "メッセージをコピーしました",
      note_copy_failed: "コピーに失敗しました",
      action_failed: "失敗しました",
      report_removed: "通報を受け付け、写真は削除されました",
      report_ok: "通報を受け付けました",
      report_self: "自分の投稿は通報できません",
      report_missing: "この写真は見つかりません",
      report_failed: "通報に失敗しました",
    },

    confirm: {
      login_to_pin: "ここにピンするにはGoogleでログインが必要です。ログインしますか？",
      login_to_history: "マイページを見るにはGoogleでログインが必要です。ログインしますか？",
      login_to_report: "通報にはログインが必要です。ログインしますか？",
      login_generic: "ログインが必要です。ログインしますか？",
      login_google: "Googleでログインしますか？",
      clear_drawing: "書き込みを全て消しますか？",
      unfave: "お気に入りから解除しますか？",
      pickup: "この記憶を回収しますか？",
      pickup_owner: "この記憶をオーナー権限で回収しますか？（投稿者には通知されません）",
      report: "この写真を『不適切』として通報しますか？\n別のアカウントからの通報が合計3件で自動的に削除されます。",
    },

    modal: {
      key_issued: {
        title: "グループキーを発行しました",
        desc_open: "このグループキーを知っている人は誰でも記憶を追加できます。",
        desc_owner: "このグループキーを知っている人だけが、この記憶を見つけられます。",
      },
      key_share_text: (v) => `グループキー「${v.key}」を「KIOKU PIN」のグループモードに入れると、ピンした記憶を見つけられます。`,
      accuracy: {
        title: "現在地が定まったら、ここにピンできます。",
        sub: "WifiとBluetoothをONにしておくと尚良し。",
      },
      orient: {
        title: "方位センサーの利用",
        sub: "レーダーを端末の向きに合わせるため、方位センサーの使用を許可してください。",
      },
    },

    ar: {
      back: "← 戻る",
      count_default: "周辺: 0",
      count_visible: (v) => `視界: ${v.n}`,
      count_waiting: "位置情報待ち…",
      hint: "端末をゆっくり動かして周囲を見渡してください",
      hint_none: "この方向に記憶はありません",
      hint_near: "近づくと記憶が鮮明になります",
      camera_error: (v) => `カメラを起動できませんでした：${v.msg}`,
    },

    history: {
      title: "マイページ",
      tab_mine: "投稿",
      tab_finds: "お気に入り",
      empty_mine: "まだピンした記憶はありません",
      empty_finds: "まだお気に入りはありません",
      load_failed: "読み込めませんでした",
      sort: {
        created_desc: "新しい順",
        created_asc: "古い順",
        dist_asc: "近い順",
        finds_desc: "★が多い順",
        favorited_desc: "保存が新しい順",
        favorited_asc: "保存が古い順",
        created_desc_posted: "投稿が新しい順",
      },
      dist_none: "—",
      unfave: "解除",
      pickup_short: "回収",
      finds_title: "見つけられた回数",
      key_show_title: "タップでグループキーを表示",
      key_show_aria: "グループキーを表示",
      private_title: "プライベート",
      lang: "言語",
    },

    admin: {
      title: "星の記録",
      loading: "読み込み中…",
      h_capacity: "容量",
      h_flow: "投函の流れ",
      h_flow_sub: "（30日）",
      h_region: "地域",
      h_region_sub: "TOP10",
      empty_places: "まだ地名の記録はありません",
      // (v) => `生存 ${alive}枚 / 全 ${total}枚（回収 ${removed}枚） · 平均 ${avg}`
      capacity_sub: (v) => `生存 ${v.alive}枚 / 全 ${v.total}枚（回収 ${v.removed}枚） · 平均 ${v.avg}`,
      // (v) => `合計 ${total}枚 · 1日ピーク ${peak}枚`
      flow_sub: (v) => `合計 ${v.total}枚 · 1日ピーク ${v.peak}枚`,
    },

    viewer: {
      locked_title: "まだ近づいていない",
      locked_sub: "半径20mまで近づくと解放されます",
      // (v) => `距離: 約${v.m}m`
      distance: (v) => `距離: 約${v.m}m`,
      prev: "前の記憶",
      next: "次の記憶",
      favorite: "お気に入り",
      report: "報告する",
      pickup: "回収する",
      pickup_owner: "回収する（オーナー削除）",
      close: "✕ 閉じる",
    },
  };
})();
