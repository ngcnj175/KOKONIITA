// KIOKU PIN English dictionary
// ja.js と同じキー構造。null のキーは自動的に日本語にフォールバックします。
// あなたが値を埋めてください。関数エントリは値の型もそのまま関数で書きます。
(function () {
  const dicts = (window.KIOKU_PIN_I18N = window.KIOKU_PIN_I18N || {});
  dicts.en = {
    common: {
      close: null,
      back: null,
      cancel: null,
      copy: null,
      share: null,
      allow: null,
    },

    brand: "KIOKU PIN",

    topbar: {
      signin: null,
      account_default: null,
      admin_label: null,
      logout_confirm: null,      // (v) => `Sign out of ${v.name}?`
    },

    radar: {
      hud_locating: null,
      hud_no_position: null,
      hud_unsupported: null,
      hud_alt_1: null,
      hud_alt_2: null,
      mode_public: null,
      mode_private: null,
      mode_group: null,
      key_placeholder: null,
      range_up: null,
      range_down: null,
      range_group: null,
      layer_group: null,
    },

    place_fab: {
      ar: "AR",
      pin: null,
      history: null,
    },

    compose: {
      title: null,
      pan_label: null,
      draw_layer: null,
      draw_toolbar: null,
      tool: {
        pen: null,
        erase: null,
        undo: null,
        redo: null,
        clear: null,
        size: null,
      },
      color: {
        group: null,
        purple: null,
        blue: null,
        green: null,
        yellow: null,
        red: null,
        pink: null,
        white: null,
        black: null,
      },
      field: {
        message: null,
        message_placeholder: null,
        visibility: null,
      },
      vis: {
        public: { label: null, sub: null },
        private: { label: null, sub: null },
        keyed: { label: null, sub: null },
      },
      key: {
        set_label: null,
        placeholder: null,
        hint: null,
        mode_label: null,
        mode_owner: null,
        mode_open: null,
        status_new: null,
        status_open_owner: null,
        status_open_join: null,
        status_owner_owner: null,
        status_owner_locked: null,
        datalist_owner: null,
        datalist_member: null,
        // 例: (v) => `${v.icon} ${v.count} memories · ${v.role}`
        datalist_label: null,
      },
      save: null,
    },

    toast: {
      login_ok: null,
      logout_ok: null,
      login_needed_self: null,
      gps_locating: null,
      gps_error: null,               // (v) => `Location error: ${v.msg}`
      accuracy_low: null,
      accuracy_low_at_save: null,
      saved: null,
      saved_with_key: null,          // (v) => `Added to group key "${v.key}"`
      key_invalid_format: null,
      key_conflict: null,
      key_invalid_server: null,
      save_failed: null,
      copy_ok: null,
      copy_failed: null,
      keyed_empty: null,
      keyed_found: null,             // (v) => v.n === 1 ? "Found 1 memory" : `Found ${v.n} memories`
      removed_by_report_one: null,
      removed_by_report_many: null,  // (v) => `${v.n} of your photos were removed by report`
      show_key: null,                // (v) => `Group key: ${v.key}`
      change_failed: null,
      unfave_failed: null,
      pickup_ok: null,
      pickup_ok_with_key: null,      // (v) => `Picked up. Group key "${v.key}" is now released.`
      pickup_forbidden: null,
      pickup_failed: null,
      already_removed: null,
      no_note: null,
      note_copy_ok: null,
      note_copy_failed: null,
      action_failed: null,
      report_removed: null,
      report_ok: null,
      report_self: null,
      report_missing: null,
      report_failed: null,
    },

    confirm: {
      login_to_pin: null,
      login_to_history: null,
      login_to_report: null,
      login_generic: null,
      login_google: null,
      clear_drawing: null,
      unfave: null,
      pickup: null,
      pickup_owner: null,
      report: null,
    },

    modal: {
      key_issued: {
        title: null,
        desc_open: null,
        desc_owner: null,
      },
      key_share_text: null,          // (v) => `Join group key "${v.key}" in KIOKU PIN to find pinned memories.`
      accuracy: {
        title: null,
        sub: null,
      },
      orient: {
        title: null,
        sub: null,
      },
    },

    ar: {
      back: null,
      count_default: null,
      count_visible: null,           // (v) => `View: ${v.n}`
      count_waiting: null,
      hint: null,
      hint_none: null,
      hint_near: null,
      camera_error: null,            // (v) => `Cannot start camera: ${v.msg}`
    },

    history: {
      title: null,
      tab_mine: null,
      tab_finds: null,
      empty_mine: null,
      empty_finds: null,
      load_failed: null,
      sort: {
        created_desc: null,
        created_asc: null,
        dist_asc: null,
        finds_desc: null,
        favorited_desc: null,
        favorited_asc: null,
        created_desc_posted: null,
      },
      dist_none: "—",
      unfave: null,
      pickup_short: null,
      finds_title: null,
      key_show_title: null,
      key_show_aria: null,
      private_title: null,
      lang: "Language",
    },

    admin: {
      title: null,
      loading: null,
      h_capacity: null,
      h_flow: null,
      h_flow_sub: null,
      h_region: null,
      h_region_sub: null,
      empty_places: null,
      capacity_sub: null,            // (v) => `Alive ${v.alive} / Total ${v.total} (Removed ${v.removed}) · Avg ${v.avg}`
      flow_sub: null,                // (v) => `Total ${v.total} · Peak/day ${v.peak}`
    },

    viewer: {
      locked_title: null,
      locked_sub: null,
      distance: null,                // (v) => `Distance: ~${v.m}m`
      prev: null,
      next: null,
      favorite: null,
      report: null,
      pickup: null,
      pickup_owner: null,
      close: null,
    },
  };
})();
