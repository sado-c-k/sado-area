/* 佐渡住宅GAS: 画面の中心部分。iOS12のSafariでも動くよう、古い書き方(optional chainingなし)で書いている */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var S = { token: null, user: null, settings: null, areas: [], data: {}, geo: {}, frames: null, cur: null, online: navigator.onLine !== false, pending: 0, pub: null, mapReady: false, sheetBid: null };
  var map, tileLayer, frameLayer, bLayer, posMarker, watchId = null, bShapes = {}, bPins = {}, bLabels = {};
  var SADO = window.SADO = { S: S, esc: esc, $: $ };

  // ---------- 端末内の保存(IndexedDB) ----------
  var idb = (function () {
    var db = null, mem = {};
    function open() {
      return new Promise(function (res) {
        if (!window.indexedDB) { res(); return; }
        var r = indexedDB.open('sado-visit', 1);
        r.onupgradeneeded = function () { var d = r.result; ['kv', 'area', 'geo'].forEach(function (n) { d.createObjectStore(n); }); d.createObjectStore('queue', { autoIncrement: true }); };
        r.onsuccess = function () { db = r.result; res(); };
        r.onerror = function () { res(); };
      });
    }
    function tx(store, mode, fn) {
      return new Promise(function (res, rej) {
        if (!db) { res(undefined); return; }
        var t = db.transaction(store, mode), out = fn(t.objectStore(store));
        t.oncomplete = function () { res(out && out.result); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    }
    function all(store) {
      return new Promise(function (res, rej) {
        if (!db) { res([]); return; }
        var out = [], c = db.transaction(store, 'readonly').objectStore(store).openCursor();
        c.onsuccess = function () { var cur = c.result; if (cur) { out.push({ key: cur.key, val: cur.value }); cur['continue'](); } else res(out); };
        c.onerror = function () { rej(c.error); };
      });
    }
    return {
      open: open, all: all,
      get: function (s, k) { return tx(s, 'readonly', function (st) { return st.get(k); }); },
      set: function (s, k, v) { return tx(s, 'readwrite', function (st) { return st.put(v, k); }); },
      del: function (s, k) { return tx(s, 'readwrite', function (st) { return st['delete'](k); }); },
      add: function (s, v) { return tx(s, 'readwrite', function (st) { return st.add(v); }); },
      clear: function (s) { return tx(s, 'readwrite', function (st) { return st.clear(); }); }
    };
  })();
  SADO.idb = idb;

  // ---------- 通信 ----------
  // 読み込み中の表示(旧GASと同じ): 通信が0.25秒以上かかるときだけ、画面全体にくるくるを出す。裏で動く通信(送信・進み具合・自動更新)では出さない
  var loadN = 0, loadT = null, QUIET = { sync: 1, getProgress: 1, getBootstrap: 1 };
  function loadingOn() { loadN++; if (loadN === 1) { clearTimeout(loadT); loadT = setTimeout(function () { var e = $('#loading'); if (e && loadN > 0 && !document.getElementById('adMask')) { applyLogo($('#loadLogo')); e.classList.remove('hidden'); } }, 250); } }
  function loadingOff() { loadN = Math.max(0, loadN - 1); if (!loadN) { clearTimeout(loadT); var e = $('#loading'); if (e) e.classList.add('hidden'); } }
  function applyLogo(el) {
    if (!el) return; var lg = S.settings || {}, m = lg.logoMode, im = lg.logoImage;
    if (!m) { try { var L = JSON.parse(localStorage.getItem('sado-logo') || '{}'); m = L.m; im = L.i; } catch (e) {} }
    if (m === 'custom' && im) { el.className = 'bootimg'; el.style.backgroundImage = 'url(' + im + ')'; } else { el.className = 'spin'; el.style.backgroundImage = ''; }
  }
  function api(action, params, quiet) {
    var q = quiet || QUIET[action]; if (!q) loadingOn();
    return api0(action, params).then(function (r) { if (!q) loadingOff(); return r; }, function (e) { if (!q) loadingOff(); throw e; });
  }
  function api0(action, params) {
    if (!CFG.apiUrl) return Promise.reject(Object.assign(new Error('config.js に GAS のURL(apiUrl)が設定されていません。'), { server: true }));
    var body = { action: action, token: S.token };
    for (var k in (params || {})) body[k] = params[k];
    return fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { var e = new Error(j.error); e.server = true; if (j.error === 'SESSION_EXPIRED') { e.expired = true; } throw e; }
        setOnline(true); if (!/^get/.test(action) && !QUIET[action] && SADO.adminInvalidate) SADO.adminInvalidate(); return j.data; // 書き込みのあとは、管理画面が覚えていた古いデータを捨てる
      }, function (err) { setOnline(false); throw err; });
  }
  SADO.api = api;
  function setOnline(v) {
    if (S.online !== v) {
      S.online = v; updateBadge(); if (v) flush();
      // 圏外のときは、端末に保存できる地図(地理院タイル)に自動で切り替える。電波が戻ったら元の地図へ
      try { if (typeof tileLayer !== 'undefined' && tileLayer && tileLayer.setUrl && S.settings) tileLayer.setUrl(tileDef(v ? effSrc() : 'gsi').url); } catch (e) {}
    }
  }
  var toastTimer;
  function toast(msg, ms) { var t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500); }
  SADO.progBar = progBar; SADO.progLegend = progLegend; SADO.fmtJa = fmtJa; SADO.stColor = stColor; SADO.statusList = statusList;
  SADO.toast = toast;
  function today() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  SADO.today = today;

  // ---------- 起動 ----------
  function applyPrefs(p) {
    p = p || {};
    document.documentElement.setAttribute('data-font', p.font || '3');
    document.documentElement.setAttribute('data-ui', p.ui === '2' || p.ui === '3' ? p.ui : '1');
    var th = p.theme || 'auto', dark = th === 'dark' || (th === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  function getPrefs() { try { return JSON.parse(localStorage.getItem('sado-prefs') || '{}'); } catch (e) { return {}; } }
  var SYNC_PREFS = { font: 1, theme: 1, ui: 1, input: 1, houseTap: 1 };
  function setPref(k, v) {
    var p = getPrefs(); p[k] = v; try { localStorage.setItem('sado-prefs', JSON.stringify(p)); } catch (e) {} applyPrefs(p);
    if (SYNC_PREFS[k] && S.token && S.online) { var o = {}; o[k] = v; api('saveMyPrefs', { values: o }, true).then(null, function () {}); } // アカウントごとに保持する
  }
  // ログインしたアカウントの好みの設定を、この端末へ反映する(アカウントを替えたら、そのアカウントの設定になる)
  function mergePrefs(sv) {
    if (!sv || typeof sv !== 'object') return;
    var p = getPrefs(), k, ch = false; for (k in SYNC_PREFS) if (sv[k] !== undefined && p[k] !== sv[k]) { p[k] = sv[k]; ch = true; }
    if (ch) { try { localStorage.setItem('sado-prefs', JSON.stringify(p)); } catch (e) {} applyPrefs(p); }
  }
  // キャッシュの一括削除(地図・アプリ本体・保存した区域データ)。まだ送れていない訪問の記録と、ログインは消さない
  function clearCache() {
    var go = function () {
      toast('キャッシュを削除しています…', 8000);
      var jobs = []; try { localStorage.removeItem('sado-tiles-done'); localStorage.removeItem('sado-logo-cache'); } catch (e) {}
      if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches['delete'](k); })); }));
      jobs.push(idb.clear('area'), idb.clear('geo'), idb.del('kv', 'bootstrap'), idb.del('kv', 'frames'), idb.del('kv', 'pub'));
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
      Promise.all(jobs.map(function (j) { return Promise.resolve(j)['catch'](function () {}); })).then(function () { location.reload(); });
    };
    if (!S.online) { toast('電波のあるところで実行してください。(消すと、圏外では開けなくなります)', 5000); return; }
    if (!window.confirm('キャッシュを削除して、最新の状態に更新します。保存した地図もすべて消えます。\n(まだ送れていない記録とログインは消えません)\n続けますか？')) return;
    (S.pending ? flush() : Promise.resolve()).then(go, go);
  }
  function fontScale() { return [0.75, 0.9, 1, 1.25, 1.5, 1.8][(parseInt(getPrefs().font, 10) || 3) - 1] || 1; }
  // 名前と所属グループ「admin　　/ヘルモン」。ホーム・各メニュー・管理メニューで同じ表示にする
  function userBox() {
    var u = S.user || {}, g = String(u.groupName || '').replace(/グループ$/, '');
    return '<div class="menu-user-box"><div class="grow"><div class="un">' + esc(u.displayName || '') + '</div></div>' + (g ? '<div class="uh gright">/' + esc(g) + '</div>' : '') + '</div>';
  }
  SADO.userBox = userBox;
  function houseMode() { var h = getPrefs().houseTap; return h === 'sheet' || h === 'direct' ? h : cfg('houseTapMode', 'direct'); }

  function boot() {
    applyPrefs(getPrefs());
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')['catch'](function () {});
    window.addEventListener('online', function () { setOnline(true); });
    window.addEventListener('offline', function () { setOnline(false); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) flush(); });
    setInterval(function () { if (S.token) flush(); }, 30000);
    document.addEventListener('click', onClick);
    idb.open().then(function () { return Promise.all([idb.get('kv', 'session'), idb.get('kv', 'bootstrap'), idb.get('kv', 'pub'), idb.get('kv', 'frames')]); }).then(function (r) {
      S.pub = r[2] || null; S.frames = r[3] || null;
      if (r[0] && r[0].token) {
        S.token = r[0].token; S.user = r[0].user;
        if (r[1]) { S.settings = r[1].settings; S.areas = r[1].areas; applySettings(); }
        S.areasLoading = !(r[1] && r[1].areas && r[1].areas.length);
        enterApp();
      } else showLogin();
    })['catch'](function (e) { $('#boot').textContent = '起動に失敗しました: ' + e.message; });
  }

  function showLogin() {
    $('#boot').classList.add('hidden'); $('#appScreen').classList.add('hidden'); $('#nav').classList.add('hidden'); $('#home').classList.add('hidden'); $('#menu').classList.add('hidden'); $('#loginScreen').classList.remove('hidden');
    var apply = function (pub) { S.pub = pub; $('#loginTitle').textContent = pub.appTitle || '佐渡住宅GAS'; $('#loginNote').textContent = ''; };
    api('getPublicInfo').then(function (pub) { idb.set('kv', 'pub', pub); apply(pub); }, function (e) {
      if (S.pub) apply(S.pub); else $('#loginMsg').textContent = e.server ? e.message : '最初の1回は、電波のあるところで開いてください。';
    });
  }
  function afterLogin(r) {
    S.token = r.token; S.user = r.user;
    return idb.set('kv', 'session', { token: r.token, user: r.user }).then(function () {
      $('#loginScreen').classList.add('hidden'); $('#boot').classList.remove('hidden');
      return api('getBootstrap', {}, true).then(function (b) { S.settings = b.settings; S.areas = b.areas; S.user = b.user; mergePrefs(b.prefs); S.bootAt = Date.now(); applySettings(); idb.set('kv', 'bootstrap', { settings: b.settings, areas: b.areas }); }, function () {}).then(function () { S.areasLoading = false; enterApp(); });
    });
  }
  function doLogin() {
    $('#loginMsg').textContent = '';
    api('login', { loginId: $('#loginId').value, password: $('#loginPw').value }).then(afterLogin, function (e) { $('#loginMsg').textContent = e.message; });
  }
  function logout() {
    var go = function () { S.token = null; S.user = null; S.cur = null; idb.del('kv', 'session').then(function () { location.reload(); }); };
    if (S.online) api('logout').then(go, go); else go();
  }

  function enterApp() {
    $('#loginScreen').classList.add('hidden'); $('#appScreen').classList.remove('hidden'); $('#nav').classList.remove('hidden');
    // 読み込みが終わるまで、全画面の「読み込み中」を出したままにする(最長6秒)
    S.bootHold = true; clearTimeout(S.bootT); S.bootT = setTimeout(bootDone, 6000);
    $('#hdrTitle').textContent = (S.settings && S.settings.appTitle) || '佐渡住宅GAS';
    initMap(); updateTitle(); renderLegend(); showNav(); if (SADO.onEnter) SADO.onEnter(canEditMode());
    if (!S.bootAt || Date.now() - S.bootAt > 4000) { var rb = refreshBootstrap(); rb.then(bootDone, bootDone); } else { schedulePrefetch(); bootDone(); } countPending(); if (isAdmin()) setTimeout(function () { if (SADO.prefetchAdmin) SADO.prefetchAdmin(); }, 1500);
    loadFrames(); loadParentFrames(); goHome();
  }
  function bootDone() { S.bootHold = false; clearTimeout(S.bootT); var e = $('#boot'); if (e) e.classList.add('hidden'); }
  function refreshBootstrap() {
    return api('getBootstrap').then(function (b) {
      S.settings = b.settings; S.areas = b.areas; S.user = b.user; mergePrefs(b.prefs); applySettings(); S.areasLoading = false; schedulePrefetch();
      idb.set('kv', 'bootstrap', { settings: b.settings, areas: b.areas });
      $('#hdrTitle').textContent = b.settings.appTitle || '佐渡住宅GAS';
      renderLegend(); drawFrames(); showNav();
      if (S.cur) { var a = areaById(S.cur); if (a && S.data[S.cur]) { S.data[S.cur].area = a; drawBuildings(); renderSheet(); } }
      if (!$('#home').classList.contains('hidden')) renderHome();
      try { if (cfg('onboardingHelpEnabled', false) && !localStorage.getItem('sado-help-seen')) { localStorage.setItem('sado-help-seen', '1'); openMenu('prefs'); } } catch (e2) {}
    }, function (e) { S.areasLoading = false; if (!$('#home').classList.contains('hidden')) renderHome(); if (e.expired) sessionExpired(); });
  }
  // 使う区域のデータを、先に端末へ取っておく(奉仕者は自分に許された区域、管理者は使用中の区域と管理画面のデータも)。電波が弱くても、すぐ開ける
  var pfT = null;
  function schedulePrefetch() { clearTimeout(pfT); pfT = setTimeout(prefetchAreas, 1200); }
  function prefetchAreas() {
    if (!S.token || !S.online || S.pf) return;
    var todo = visibleAreas().filter(function (a) { return !a.isParent && a.inUse && !S.data[a.areaId]; }).map(function (a) { return a.areaId; });
    if (isAdmin() && SADO.prefetchAdmin) SADO.prefetchAdmin();
    if (!todo.length) return;
    S.pf = true; var i = 0; loadProg();
    function next() { if (i >= todo.length || !S.online || !S.token) return Promise.resolve(); var id = todo[i++]; return loadAreaData(id, true).then(null, function () {}).then(next); }
    Promise.all([next(), next(), next()]).then(function () { S.pf = false; });
  }
  function sessionExpired() { toast('ログインの有効期限が切れました。未送信の記録は端末に残っています。'); S.token = null; idb.del('kv', 'session').then(function () { showLogin(); }); }
  function areaById(id) { for (var i = 0; i < S.areas.length; i++) if (S.areas[i].areaId === id) return S.areas[i]; return null; }
  function statusList() { return (S.settings && S.settings.statusList) || [{ id: 'unvisited', label: '未訪問', visited: false, done: false }, { id: 'met', label: '会えた', visited: true, done: true }]; }
  // ---------- 動作設定の反映(訪問状況の色・入力スタイル・ピンの影など) ----------
  var DEF_COL = { unvisited: '#9aa0a6', met: '#188038', absent1: '#ef6c00', absent2: '#c2410c', vacant: '#6b7280' };
  function stColor(x) { return (x && x.color) || DEF_COL[x && x.id] || '#6b7280'; }
  function hexA(c, a) { var n = parseInt(String(c).replace('#', ''), 16) || 0; return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function cfg(k, d) { var v = S.settings && S.settings[k]; return v === undefined || v === null ? d : v; }
  function inputTheme() { var p = getPrefs(); return String(p.input || cfg('inputTheme', '3')); }
  function applySettings() {
    var css = '', l = statusList();
    l.forEach(function (x) {
      var c = stColor(x), i = x.id;
      css += '.room.st-' + i + '{border-left-color:' + c + '}' + (i === 'unvisited' ? '' : '.room.st-' + i + '{background:' + hexA(c, 0.16) + '}');
      css += '.chip.s-' + i + '.on,.sp-btn.sp-' + i + '.on{background:' + c + ';border-color:' + c + ';color:#fff}.pseg-' + i + '{background:' + c + '}.pchip-' + i + '{background:' + hexA(c, 0.16) + ';color:' + c + '}';
    });
    var el = document.getElementById('stCss'); if (!el) { el = document.createElement('style'); el.id = 'stCss'; document.head.appendChild(el); }
    el.textContent = css;
    try { var lg = S.settings || {}; localStorage.setItem('sado-logo', JSON.stringify({ m: lg.logoMode, i: lg.logoImage })); } catch (e) {}
    var de = document.documentElement;
    de.classList.toggle('no-pin-shadow', cfg('pinShadowEnabled', true) === false);
    de.setAttribute('data-input', inputTheme());
    try { if (typeof tileLayer !== 'undefined' && tileLayer && S.settings) { var td0 = tileDef(effSrc()); if (tileLayer.setUrl && tileLayer._url !== td0.url) tileLayer.setUrl(td0.url); } } catch (e) {}
    try { if (SADO.MapRot && SADO.MapRot.setEnabled) SADO.MapRot.setEnabled(cfg('mapRotationEnabled', true) !== false); } catch (e) {}
  }
  function statusOf(id) { var l = statusList(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return l[0]; }

  // ---------- 地図 ----------
  function effSrc() { return S.tileOverride || (S.settings && S.settings.mapTileSource) || 'gsi'; }
  var TILE_LIST = [['osm', 'OpenStreetMap'], ['gsiphoto', '航空写真'], ['gsi', '国土地理院'], ['gsipale', '国土地理院（淡色）']];
  var TILE_SW = {"osm": "<svg viewBox=\"0 0 64 64\" aria-hidden=\"true\"><rect width=\"64\" height=\"64\" fill=\"#f4f1ea\"/><path d=\"M0 0h26c-4 12 6 18 2 30S10 44 0 46Z\" fill=\"#a9dcf5\"/><path d=\"M40 0h24v26c-8 2-16-4-18-12S42 6 40 0Z\" fill=\"#b8e0c0\"/><path d=\"M0 64 64 20\" stroke=\"#fff\" stroke-width=\"9\"/><path d=\"M0 64 64 20\" stroke=\"#e5b858\" stroke-width=\"3\"/><path d=\"M30 0 38 64\" stroke=\"#fff\" stroke-width=\"5\"/></svg>", "gsiphoto": "<svg viewBox=\"0 0 64 64\" aria-hidden=\"true\"><rect width=\"64\" height=\"64\" fill=\"#58694a\"/><path d=\"M0 0h30L0 34Z\" fill=\"#6f7f5c\"/><path d=\"M64 64H28l36-34Z\" fill=\"#43523a\"/><path d=\"M0 52C20 46 40 30 64 14\" stroke=\"#9c9a92\" stroke-width=\"9\" fill=\"none\"/><path d=\"M0 52C20 46 40 30 64 14\" stroke=\"#d8d6cf\" stroke-width=\"1.5\" stroke-dasharray=\"5 4\" fill=\"none\"/></svg>", "gsi": "<svg viewBox=\"0 0 64 64\" aria-hidden=\"true\"><rect width=\"64\" height=\"64\" fill=\"#f6f2e4\"/><rect x=\"0\" y=\"0\" width=\"22\" height=\"64\" fill=\"#e9f0d4\"/><path d=\"M0 46 64 22\" stroke=\"#f4b04a\" stroke-width=\"6\"/><path d=\"M32 0 40 64\" stroke=\"#fff\" stroke-width=\"5\"/><path d=\"M0 18h64\" stroke=\"#d9d2bd\" stroke-width=\"2\"/><rect x=\"42\" y=\"30\" width=\"9\" height=\"7\" fill=\"#d9a89a\"/><rect x=\"48\" y=\"44\" width=\"8\" height=\"7\" fill=\"#d9a89a\"/></svg>", "gsipale": "<svg viewBox=\"0 0 64 64\" aria-hidden=\"true\"><rect width=\"64\" height=\"64\" fill=\"#eceff2\"/><rect x=\"0\" y=\"0\" width=\"22\" height=\"64\" fill=\"#e2e8ec\"/><path d=\"M0 46 64 22\" stroke=\"#cfd6dc\" stroke-width=\"6\"/><path d=\"M32 0 40 64\" stroke=\"#fff\" stroke-width=\"5\"/><path d=\"M0 18h64\" stroke=\"#d5dbe0\" stroke-width=\"2\"/><rect x=\"42\" y=\"30\" width=\"9\" height=\"7\" fill=\"#cdd3d8\"/><rect x=\"48\" y=\"44\" width=\"8\" height=\"7\" fill=\"#cdd3d8\"/></svg>", "custom": "<svg viewBox=\"0 0 64 64\" aria-hidden=\"true\"><rect width=\"64\" height=\"64\" fill=\"#e8e0f0\"/><path d=\"M0 46 64 22\" stroke=\"#fff\" stroke-width=\"6\"/><circle cx=\"32\" cy=\"30\" r=\"7\" fill=\"#a58bc8\"/></svg>"};
  function openLayerPicker() {
    var m = document.getElementById('modal'); if (m) m.parentNode.removeChild(m);
    var cur = effSrc(), l = TILE_LIST.slice(); if (S.settings && S.settings.mapTileUrl) l.push(['custom', '自分で指定']);
    m = document.createElement('div'); m.id = 'modal';
    m.innerHTML = '<div class="mb"><h3>地図の種類</h3><div class="maplayer-row">' + l.map(function (o) { return '<button type="button" class="maplayer-opt' + (o[0] === cur ? ' active' : '') + '" data-act="layerPick" data-v="' + o[0] + '"><span class="maplayer-sw">' + (TILE_SW[o[0]] || '') + '</span><span>' + esc(o[1]) + '</span></button>'; }).join('') + '</div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) m.parentNode.removeChild(m); });
  }
  function tileDef(src) {
    var st = S.settings || {};
    if (src === 'custom' && st.mapTileUrl) return { url: st.mapTileUrl, opt: { maxZoom: 19, attribution: st.mapTileAttribution || '' } };
    var G = function (k, z, name) { return { url: 'https://cyberjapandata.gsi.go.jp/xyz/' + k + '/{z}/{x}/{y}.' + (k === 'seamlessphoto' ? 'jpg' : 'png'), opt: { maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">' + name + '</a>' } }; };
    if (src === 'osm') return { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' } };
    if (src === 'gsiphoto') return G('seamlessphoto', 18, '地理院タイル(航空写真)');
    if (src === 'gsipale') return G('pale', 18, '地理院タイル(淡色)');
    return G('std', 18, '地理院タイル');
  }
  function initMap() {
    if (S.mapReady) return;
    if (!window.L) { toast('地図ライブラリ(lib/leaflet.js)が見つかりません。'); return; }
    S.mapReady = true;
    var st = S.settings || {};
    map = L.map('map', { zoomControl: false, attributionControl: true, tap: false, rotate: true, bearing: 0, touchRotate: false, rotateControl: false }).setView([st.mapLat || 38.08, st.mapLng || 138.44], st.mapZoom || 13);
    map.on('zoomend', function () { syncLabels(); if (!S.edit && (!S.cur || S.merged)) drawFrames(); });
    map.on('dragstart', function () { if (loc.follow) { loc.follow = false; locUi(); } });
    map.on('zoomstart', function () { if (loc.follow) { loc.follow = false; locUi(); } });
    try { if (SADO.MapRot) SADO.MapRot.init(); } catch (e) { console.warn('rot init', e); }
    var td = tileDef(effSrc()); tileLayer = L.tileLayer(td.url, td.opt).addTo(map);
    try { if (L.control && L.control.zoom) L.control.zoom({ position: 'bottomleft', zoomInTitle: '拡大', zoomOutTitle: '縮小' }).addTo(map); } catch (e) {}
    frameLayer = L.layerGroup().addTo(map); bLayer = L.layerGroup().addTo(map);
    SADO.map = map;
  }
  function renderLegend() {
    $('#legend').innerHTML = '<b><i style="background:#1a73e8"></i>未訪問</b><b><i style="background:#ef6c00"></i>途中</b><b><i style="background:#188038"></i>完了</b><b><i style="background:#9aa0a6"></i>編集不可</b><b><i style="background:#fff;border:2px solid #b91c1c"></i>拒否あり</b>';
  }
  function loadFrames() {
    var show = function (g) { S.frames = g; drawFrames(); };
    if (S.frames) show(S.frames);
    fetch((CFG.geoBase || 'data/') + 'areas.geojson').then(function (r) { if (!r.ok) throw new Error('x'); return r.json(); }).then(function (g) { idb.set('kv', 'frames', g); show(g); })['catch'](function () {});
  }
  // 大きな区域の枠(data/areas_parent.geojson。あれば使う)。なければ、小さな区域の枠から代わりの表示をする
  function loadParentFrames() {
    idb.get('kv', 'frames2').then(function (g) { if (g && !S.frames2) { S.frames2 = g; drawFrames(); } }, function () {});
    fetch((CFG.geoBase || 'data/') + 'areas_parent.geojson').then(function (r) { if (!r.ok) throw new Error('x'); return r.json(); }).then(function (g) { idb.set('kv', 'frames2', g); S.frames2 = g; drawFrames(); })['catch'](function () {});
  }
  var FRAME_PARENT_LABEL = 13; // 大きな区域の名前は、これ以上拡大してから出す。小さな区域の名前は FRAME_PARENT_BELOW 以上で出す
  var FRAME_PARENT_BELOW = 15; // 地図の縮尺がこれより小さい(引いている)ときは、大きな区域の枠だけを出す
  function parentFrameList() {
    var pid = {}, out = [];
    S.areas.forEach(function (a) { if (a.isParent) pid[a.areaId] = a; });
    ((S.frames2 && S.frames2.features) || []).forEach(function (f) {
      var pr = f.properties || {}, id = null, k; for (k in pr) if (pid[pr[k]]) { id = pr[k]; break; }
      if (id) out.push({ areaId: id, geometry: f.geometry });
    });
    return out;
  }
  function ringToLatLngs(ring) { return ring.map(function (c) { return [c[1], c[0]]; }); }
  function geomToLatLngs(g) {
    if (!g) return [];
    if (g.type === 'Polygon') return g.coordinates.map(ringToLatLngs);
    if (g.type === 'MultiPolygon') return g.coordinates.map(function (p) { return p.map(ringToLatLngs); });
    return [];
  }
  // 区域の枠: 区域に境界線が保存されていれば(アプリで描いた・直した枠)それを優先し、なければ data/areas.geojson の枠を使う
  var bdCache = {};
  function frameFeatures() {
    var over = {}, out = [];
    S.areas.forEach(function (a) {
      if (!a.boundary) return;
      if (!bdCache[a.areaId] || bdCache[a.areaId].s !== a.boundary) { var g = null; try { g = JSON.parse(a.boundary); } catch (e) {} bdCache[a.areaId] = { s: a.boundary, g: g }; }
      if (bdCache[a.areaId].g) over[a.areaId] = bdCache[a.areaId].g;
    });
    ((S.frames && S.frames.features) || []).forEach(function (f) { var pr = f.properties || {}, id = pr.areaId || pr.boundary_detail_uuid; if (id && !over[id]) out.push({ areaId: id, geometry: f.geometry }); }); // QGISの列名(boundary_detail_uuid)のままでも読める
    Object.keys(over).forEach(function (id) { out.push({ areaId: id, geometry: over[id] }); });
    return out;
  }
  SADO.frameFeatures = frameFeatures;
  function drawFrames() {
    if (!frameLayer) return; frameLayer.clearLayers();
    if (!S.cur && !S.edit && map && map.getZoom() < FRAME_PARENT_BELOW) { // 引いて見ているときは、大きな区域の枠だけ
      var pf = parentFrameList();
      if (pf.length) {
        pf.forEach(function (f) {
          var p = areaById(f.areaId), kids = S.areas.filter(function (a) { return !a.isParent && a.parentId === f.areaId && visibleAreas().indexOf(a) >= 0; }); if (!kids.length) return;
          var inUse = kids.some(function (k) { return k.inUse; });
          var poly = L.polygon(geomToLatLngs(f.geometry), { color: inUse ? '#188038' : '#1a73e8', weight: 2, dashArray: inUse ? null : '6 4', fillOpacity: inUse ? 0.12 : 0.04 });
          if (map.getZoom() >= FRAME_PARENT_LABEL) poly.bindTooltip(p ? p.areaName : '', { permanent: true, direction: 'center', className: 'area-label' });
          poly.on('click', function () { selectParent(f.areaId); }); frameLayer.addLayer(poly);
        });
        return;
      }
    }
    if (S.cur && !S.edit) { // 区域を選んでいる間は、選んだ区域の枠だけを出す(親区域なら、親の枠と中の小さな区域の枠)
      if (S.merged) { // 大きな区域: 中の小さな区域の枠を出し、押した区域を選ぶ(選んだ区域は濃く、ほかは薄く)
        frameFeatures().forEach(function (f) {
          if ((S.kids || []).indexOf(f.areaId) < 0) return; var sel = f.areaId === S.sub, k = areaById(f.areaId), id = f.areaId;
          var poly = L.polygon(geomToLatLngs(f.geometry), { color: '#188038', weight: sel ? 4 : 2, dashArray: sel ? null : '6 5', fillOpacity: sel ? 0.02 : 0.08, opacity: sel ? 1 : 0.7 });
          if (k && !sel && map.getZoom() >= FRAME_PARENT_BELOW) poly.bindTooltip(k.areaName, { permanent: true, direction: 'center', className: 'area-label' });
          poly.on('click', function () { selectKid(id); }); frameLayer.addLayer(poly);
        });
        return;
      }
      var ids = {}; ids[S.cur] = 1;
      frameFeatures().forEach(function (f) { if (ids[f.areaId]) { var g = f.geometry, rings = g && g.type === 'MultiPolygon' ? [].concat.apply([], g.coordinates.map(function (p) { return p.map(ringToLatLngs); })) : geomToLatLngs(g); frameLayer.addLayer(L.polyline(rings, { color: '#188038', weight: 3, dashArray: '8 5', interactive: false })); } });
      return;
    }
    frameFeatures().forEach(function (f) {
      var id = f.areaId, a = areaById(id); if (!a || visibleAreas().indexOf(a) < 0) return;
      if (S.edit) { if (SADO.hideFrame && SADO.hideFrame(id)) return; frameLayer.addLayer(L.polygon(geomToLatLngs(f.geometry), { color: '#ef6c00', weight: 2, dashArray: '2 5', fill: false, interactive: false })); return; }
      var color = a.inUse ? (a.assigned ? '#188038' : '#80868b') : '#1a73e8';
      var poly = L.polygon(geomToLatLngs(f.geometry), { color: color, weight: 2, dashArray: a.inUse ? null : '6 4', fillOpacity: a.inUse ? 0.12 : 0.04 });
      if (!map || map.getZoom() >= FRAME_PARENT_BELOW) poly.bindTooltip(a.areaName + (a.inUse ? '（使用中）' : ''), { permanent: true, direction: 'center', className: 'area-label' });
      poly.on('click', function () { selectArea(id); });
      frameLayer.addLayer(poly);
    });
  }

  // ---------- 区域の選択とデータの読み込み ----------
  function applyQueue(areaId) {
    return idb.all('queue').then(function (items) {
      var d = S.data[areaId]; if (!d) return;
      items.forEach(function (it) { var op = it.val; if (op.areaId === areaId) applyOp(d, op); });
    });
  }
  function applyOp(d, op) {
    var i;
    if (op.type === 'status') for (i = 0; i < d.rooms.length; i++) if (d.rooms[i].roomId === op.roomId) {
      var r = d.rooms[i];
      if (op.status !== undefined) { r.status = op.status; r.updatedAt = op.t; }
      if (op.memo !== undefined) r.memo = op.memo;
      if (op.mark !== undefined) r.mark = op.mark;
    }
    if (op.type === 'building') for (i = 0; i < d.buildings.length; i++) if (d.buildings[i].buildingId === op.buildingId) {
      if (op.buildingName !== undefined) d.buildings[i].buildingName = op.buildingName;
      if (op.buildingMemo !== undefined) d.buildings[i].buildingMemo = op.buildingMemo;
    }
  }
  // 建物の形は、親区域ごとのファイル(area_<親ID>.geojson)があればそれを使い、なければ子区域のファイル(area_<子ID>.geojson)を使う
  var geoK = {};
  function loadGeo(areaId) {
    if (S.geo[areaId]) return Promise.resolve(S.geo[areaId]);
    var a = areaById(areaId), keys = (a && a.parentId) ? [a.parentId, areaId] : [areaId], base = CFG.geoBase || 'data/';
    var set = function (g) { S.geo[areaId] = g; return g; };
    var get = function (k) {
      if (geoK[k]) return Promise.resolve(geoK[k]);
      return fetch(base + 'area_' + encodeURIComponent(k) + '.geojson').then(function (r) { if (!r.ok) throw new Error('x'); return r.json(); }).then(function (g) { geoK[k] = g; idb.set('geo', k, g); return g; });
    };
    var fromIdb = function () { return Promise.all(keys.map(function (k) { return idb.get('geo', k); })).then(function (l) { return set(l.filter(Boolean)[0] || null); }); };
    return get(keys[0]).then(set, function () { return keys[1] ? get(keys[1]).then(set, fromIdb) : fromIdb(); });
  }
  // すでに端末(メモリ・保存領域)にある区域は、待たずにすぐ出す。最新のデータは裏で取り直す(アプリを開く時に先に取っておくので、切り替えがパッと出る)
  var bgT = {};
  function bgRefresh(areaId) {
    if (!S.online || !S.token || (bgT[areaId] && Date.now() - bgT[areaId] < 30000)) return; bgT[areaId] = Date.now();
    api('getAreaData', { areaId: areaId }, true).then(function (d) {
      var same = JSON.stringify(d) === JSON.stringify(S.baseData && S.baseData[areaId]); (S.baseData = S.baseData || {})[areaId] = d; if (same) return;
      if (S.sheetBid && draftCount()) return; // 入力途中のものがあるときは、そのままにしておく
      S.data[areaId] = d; idb.set('area', areaId, d); applyQueue(areaId).then(function () { if (S.cur === areaId && !S.edit) { drawBuildings(false); if (S.sheetBid) renderSheet(); } if (!$('#home').classList.contains('hidden')) renderHome(); });
    }, function () {});
  }
  function loadAreaData(areaId, force) {
    if (!force) {
      var fast = function () { bgRefresh(areaId); return applyQueue(areaId).then(function () { return loadGeo(areaId); }); };
      if (S.data[areaId]) return fast();
      return idb.get('area', areaId).then(function (d) { if (!d) return loadAreaData0(areaId, force); S.data[areaId] = d; return fast(); });
    }
    return loadAreaData0(areaId, force);
  }
  function loadAreaData0(areaId, force) {
    var local = function () { return idb.get('area', areaId).then(function (d) { if (!d) throw new Error('この区域は、まだ端末に保存されていません。電波のあるところで一度開いてください。'); S.data[areaId] = d; }); };
    var p = (S.online || force) ? api('getAreaData', { areaId: areaId }, force).then(function (d) { S.data[areaId] = d; return idb.set('area', areaId, d); }, function (e) { if (e.server) throw e; return local(); }) : local();
    return p.then(function () { return applyQueue(areaId); }).then(function () { return loadGeo(areaId); });
  }
  function selectArea(areaId, bid) {
    var a = areaById(areaId); toast((a ? a.areaName : '') + ' を読み込み中…', 1500);
    return loadAreaData(areaId).then(function () {
      if (SADO.onAreaChange) SADO.onAreaChange();
      S.cur = areaId; S.merged = false; S.sub = null; closeSheet(true); drawFrames(); drawBuildings(true); updateTitle(); closePanels();
      var d = S.data[areaId]; if (d && d.area) { var i = S.areas.map(function (x) { return x.areaId; }).indexOf(areaId); if (i >= 0) S.areas[i] = d.area; }
      if (bid) { var bq = S.data[areaId] && S.data[areaId].buildings.filter(function (x) { return x.buildingId === bid; })[0]; if (bq && bq.lat != null && map) { map.setView([bq.lat, bq.lng], Math.max(map.getZoom(), 17)); } openBuilding(bid); }
      if (a && !a.canEdit) toast(a.inUse ? '「' + a.areaName + '」は担当外のため、見るだけです。' : '「' + a.areaName + '」は使用中ではないため、見るだけです。', 3500);
    })['catch'](function (e) { toast(e.message, 5000); });
  }
  // 大きな区域(親区域)を開く: 中の小さな区域を、すべていっしょに地図に出す
  function selectParent(pid, quiet) {
    var pa = areaById(pid), kids = visibleAreas().filter(function (a) { return a.parentId === pid; });
    if (!kids.length) { toast('開ける小さな区域がありません。'); return Promise.resolve(); }
    var ml = $('#mapLoading'); if (!quiet && ml) { ml.classList.remove('hidden'); applyLogo($('#mapLoadLogo')); }
    return Promise.all(kids.map(function (k) { return loadAreaData(k.areaId, quiet); })).then(function () {
      var m = { area: pa || { areaId: pid, areaName: '', canEdit: false }, buildings: [], rooms: [], merged: true };
      kids.forEach(function (k) {
        var d = S.data[k.areaId]; if (!d) return;
        if (d.area) { var i = S.areas.map(function (x) { return x.areaId; }).indexOf(k.areaId); if (i >= 0) S.areas[i] = d.area; }
        d.buildings.forEach(function (b) { b.areaId = k.areaId; m.buildings.push(b); });
        d.rooms.forEach(function (r) { r.areaId = k.areaId; m.rooms.push(r); });
      });
      S.data[pid] = m; S.geo[pid] = S.geo[kids[0].areaId]; S.kids = kids.map(function (k) { return k.areaId; });
      if (SADO.onAreaChange) SADO.onAreaChange();
      S.cur = pid; S.merged = true; if (!quiet || S.kids.indexOf(S.sub) < 0) S.sub = null; if (!quiet) closeSheet(true); drawFrames(); drawBuildings(false); updateTitle(); closePanels();
      if (!quiet) { try { var fb = frameLayer && frameLayer.getBounds && frameLayer.getBounds(); if (fb && fb.isValid && fb.isValid()) map.fitBounds(fb, { padding: [30, 30], maxZoom: 17 }); } catch (e) {} toast('地図の枠から、記録する小さな区域を選んでください。', 4000); }
    })['catch'](function (e) { toast(e.message, 5000); }).then(function () { if (ml) ml.classList.add('hidden'); });
  }
  // 大きな区域の中で、小さな区域を選ぶ(その区域の建物だけが出て、記録できる)
  function selectKid(id) {
    if (!S.merged || S.sub === id) return; var k = areaById(id); S.sub = id; closeSheet(true); drawFrames(); drawBuildings(true); updateTitle();
    if (k) toast(k.areaName + ' を選びました。' + (k.canEdit ? '' : '(見るだけ)'), 2500);
  }
  function clearArea() { S.merged = false; S.sub = null; S.cur = null; closeSheet(true); if (bLayer) bLayer.clearLayers(); drawFrames(); updateTitle(); }
  SADO.clearArea = clearArea;
  function updateTitle() {
    document.body.classList.toggle('area-chosen', !!S.cur); if (S.cur) document.body.classList.remove('search-open');
    var cb = $('#areaClearBtn'); if (cb) cb.classList.toggle('hidden', !S.cur); var hd = $('#hdr'); if (hd) hd.style.left = S.cur ? '64px' : '';
    var a = S.cur && areaById(S.cur), t = $('#hdrTitle'), q = $('#hdrQ');
    var sk = S.merged && S.sub && areaById(S.sub); t.textContent = a ? (sk ? sk.areaName : a.areaName + (S.merged ? '(小さな区域を選択)' : '')) + ((sk ? sk.canEdit : (a.canEdit || S.merged)) ? '' : '（見るだけ）') : ''; t.style.display = S.cur ? '' : 'none'; if (q) { q.style.display = S.cur ? 'none' : ''; if (S.cur) { q.value = ''; hdrSearch(); } }
  }
  // 区域が選ばれていないとき、上のバーで区域名を探して開く(旧GASと同じ)
  function hdrSearch() {
    var box = $('#hdrRes'), q = ($('#hdrQ').value || '').replace(/[\s　]/g, '').toLowerCase(); if (!box) return;
    if (!q || S.cur) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    var list = visibleAreas().filter(function (x) { return x.areaName.replace(/[\s　]/g, '').toLowerCase().indexOf(q) >= 0; }).slice(0, 40);
    box.innerHTML = list.length ? list.map(function (x) { var pa = x.parentId && areaById(x.parentId); return '<button data-act="hdrPick" data-v="' + esc(x.areaId) + '">' + esc(x.areaName) + (x.isParent ? '<small>(大きな区域をまとめて開く)</small>' : (pa ? '<small>' + esc(pa.areaName) + '</small>' : '')) + '</button>'; }).join('') : '<div class="none">該当する区域がありません。</div>';
    box.classList.remove('hidden');
  }


  function roomsOf(areaId, bid) { var d = S.data[areaId]; return d ? d.rooms.filter(function (r) { return r.buildingId === bid; }).sort(function (a, b) { return a.sortOrder - b.sortOrder; }) : []; }
  // 部屋の数え方: 「訪問した」「完了」は動作設定の訪問状況による。拒否・注意の部屋を完了扱いにするかも動作設定で決める
  function roomCounts(areaId, b) {
    var rs = roomsOf(areaId, b.buildingId), c = { n: rs.length, visited: 0, done: 0, rej: false, cau: false, by: {} }, rcd = cfg('pinRejectCautionDone', true) !== false;
    rs.forEach(function (r) {
      var s = statusOf(r.status), mk = r.mark === 'reject' || r.mark === 'caution';
      c.by[s.id] = (c.by[s.id] || 0) + 1;
      if (s.visited) c.visited++; if (s.done || (rcd && mk)) c.done++;
      if (r.mark === 'reject') c.rej = true; if (r.mark === 'caution') c.cau = true;
    });
    return c;
  }
  function buildingStyle(areaId, b) {
    var c = roomCounts(areaId, b), a = areaById(areaId) || (S.data[areaId] && S.data[areaId].area) || {}, thr = (Number(cfg('pinDoneThreshold', 100)) || 100) / 100, off = cfg('mapProgressMode', 'simple') === 'off';
    var editable = a.canEdit !== false, full = c.n && c.done / c.n >= thr - 1e-9;
    var fill = !editable ? '#9aa0a6' : (off ? '#1a73e8' : (full ? '#188038' : (c.visited > 0 || c.done > 0 ? '#ef6c00' : '#1a73e8')));
    return { color: c.rej ? '#b91c1c' : (c.cau ? '#ca8a04' : fill), weight: c.rej || c.cau ? 3 : 1.5, fillColor: fill, fillOpacity: 0.6 };
  }
  // 部屋情報のある建物(部屋が2つ以上・アパート区域)だけがピン。名前だけある建物は丸のまま(名前は表示する)
  function hasRoomInfo(areaId, b) { var d = S.data[areaId], a = (d && d.area) || areaById(areaId) || {}; return a.category === 'アパート' || roomsOf(areaId, b.buildingId).length > 1; }
  // 詳細ウィンドウで記録する建物: 部屋情報のある建物と、名前のある建物。これ以外(一軒家など)は動作設定しだいで、地図を直接タップして記録する
  function isApt(areaId, b) { return hasRoomInfo(areaId, b) || !!String(b.buildingName || '').trim(); }
  // 旧GAS(佐渡アパートGAS)と同じ見た目: 拡大したときは、しずく形のピン+建物名の札。縮小したときは、小さな丸だけ
  var PIN_DOT_BELOW_ZOOM = 16;
  function pieIcon(b, color) {
    var c = roomCounts(b.areaId || S.cur, b), n = c.n || 1, stops = [], at = 0, rest = Math.max(0, c.n - c.done);
    statusList().forEach(function (x) { var k = c.by[x.id] || 0; if (!k || !(x.visited || x.done)) return; var w = k / n * 100; stops.push(stColor(x) + ' ' + at.toFixed(1) + '% ' + (at + w).toFixed(1) + '%'); at += w; });
    stops.push('#d1d5db ' + at.toFixed(1) + '% 100%');
    var ring = c.rej ? '#b91c1c' : (c.cau ? '#ca8a04' : '#fff');
    return L.divIcon({ className: '', html: '<div class="pin-pie" style="background:conic-gradient(' + stops.join(',') + ');border-color:' + ring + '"><b>' + rest + '</b></div>', iconSize: [34, 34], iconAnchor: [17, 17] });
  }
  function pinIcon(b, color) {
    if (cfg('mapProgressMode', 'simple') === 'circle') return pieIcon(b, color);
    if (map && map.getZoom() < PIN_DOT_BELOW_ZOOM) return L.divIcon({ className: '', html: '<i class="pin-sh" style="display:block;width:15px;height:15px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-sizing:border-box"></i>', iconSize: [15, 15], iconAnchor: [7, 7] });
    return L.divIcon({ className: '', html: '<svg class="pin-sh" viewBox="0 0 25 41" width="20" height="33" style="display:block"><path d="M12.5 0C5.6 0 0 5.6 0 12.5 0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="' + color + '" stroke="rgba(0,0,0,.28)" stroke-width="1"/><circle cx="12.5" cy="12.5" r="5" fill="#fff"/></svg>', iconSize: [20, 33], iconAnchor: [10, 33] });
  }
  function labelIcon(b, below) {
    return L.divIcon({ className: '', html: '<div style="position:absolute;left:0;top:0;transform:translate(-50%,' + (below || 6) + 'px);white-space:nowrap;background:#fff;color:#202124;border:1px solid #dadce0;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:800;box-shadow:0 1px 3px rgba(0,0,0,.25);pointer-events:none">' + esc(b.buildingName || '') + '</div>', iconSize: [0, 0], iconAnchor: [0, 0] });
  }
  function syncLabels() {
    if (!bLayer || !map) return; var show = map.getZoom() >= PIN_DOT_BELOW_ZOOM && !S.edit, d = S.data[S.cur]; if (!d) return;
    d.buildings.forEach(function (b) {
      var bid = b.buildingId, p = bPins[bid], sh = bShapes[bid];
      if (p) p.setIcon(pinIcon(b, p._color || '#1a73e8'));
      if (!String(b.buildingName || '').trim() || !sh) return;
      if (show && !bLabels[bid]) { var ll = sh.getLatLng ? sh.getLatLng() : (sh.getBounds ? sh.getBounds().getCenter() : null); if (ll) { bLabels[bid] = L.marker(ll, { icon: labelIcon(b, p ? (cfg('mapProgressMode', 'simple') === 'circle' ? 20 : 6) : 12), interactive: false }); bLayer.addLayer(bLabels[bid]); } }
      if (!show && bLabels[bid]) { bLayer.removeLayer(bLabels[bid]); delete bLabels[bid]; }
    });
  }
  function quickRecord(bid) {
    var d = S.data[S.cur]; if (!d) return;
    var bb0 = d.buildings.filter(function (x) { return x.buildingId === bid; })[0], ar0 = (bb0 && areaById(bb0.areaId)) || d.area;
    if (!ar0.canEdit) { openBuilding(bid); return; }
    var rs = roomsOf((bb0 && bb0.areaId) || S.cur, bid); if (!rs.length) { openBuilding(bid); toast('この建物には部屋の記録枠がありません。'); return; }
    var l = statusList(), r = rs[0], i = 0; l.forEach(function (x, k) { if (x.id === r.status) i = k; });
    var nx = l[(i + 1) % l.length]; patchRoom(r.roomId, { status: nx.id }); toast('記録: ' + nx.label + '(もう一度タップで次の状況。長押しで詳細)', 1800);
  }
  function drawBuildings(fit) {
    if (!bLayer) return; bLayer.clearLayers(); bShapes = {}; bPins = {}; bLabels = {};
    var d = S.data[S.cur]; if (!d) return;
    var geo = S.geo[S.cur], feat = {}, bounds = null, direct = houseMode() !== 'sheet';
    if (geo && geo.features) geo.features.forEach(function (f) { feat[f.properties.uuid2] = f; });
    d.buildings.forEach(function (b) {
      var f = feat[b.buildingId], shape = null, st = buildingStyle(b.areaId || S.cur, b), apt = isApt(b.areaId || S.cur, b), pinned = hasRoomInfo(b.areaId || S.cur, b), ed = !!(S.edit && SADO.editMarker), pin = null;
      var hasPt = b.lat != null && b.lng != null;
      if (f) shape = L.polygon(geomToLatLngs(f.geometry), st);
      else if (hasPt) { if (ed) shape = SADO.editMarker(b); else if (pinned) { pin = shape = L.marker([b.lat, b.lng], { icon: pinIcon(b, st.fillColor) }); pin._color = st.fillColor; } else { st.radius = 4.6 * fontScale(); st.weight = 1; /* 半径5.6m: 地図の拡大・縮小に合わせて大きさが変わる */ shape = L.circle([b.lat, b.lng], st); } }
      if (!shape) return;
      var live = !S.merged || ed || b.areaId === S.sub; // 大きな区域を開いているときは、小さな区域を選ぶまで記録できない(押すと、その建物の小さな区域が選ばれる)
      var simple = !apt && !ed && direct && live;
      var act = function () { if (!live) selectKid(b.areaId); else if (simple) quickRecord(b.buildingId); else openBuilding(b.buildingId); };
      shape.on('click', act); if (simple) shape.on('contextmenu', function () { openBuilding(b.buildingId); });
      bLayer.addLayer(shape); bShapes[b.buildingId] = shape;
      if (pinned && !pin && !ed) {
        var c = shape.getBounds ? shape.getBounds().getCenter() : null;
        if (c) { pin = L.marker(c, { icon: pinIcon(b, st.fillColor) }); pin._color = st.fillColor; pin.on('click', act); bLayer.addLayer(pin); }
      }
      if (pin) bPins[b.buildingId] = pin;
      var bb = shape.getBounds ? shape.getBounds() : L.latLngBounds([shape.getLatLng()]);
      if (!bounds) bounds = L.latLngBounds(bb.getSouthWest(), bb.getNorthEast()); else bounds.extend(bb);
    });
    if (fit && bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
    syncLabels();
  }
  function restyle(bid) {
    var d = S.data[S.cur], shape = bShapes[bid]; if (!d || !shape) return; var b = d.buildings.filter(function (x) { return x.buildingId === bid; })[0]; if (!b) return;
    var st = buildingStyle(b.areaId || S.cur, b); if (shape.setStyle) shape.setStyle(st); if (bPins[bid]) { bPins[bid]._color = st.fillColor; bPins[bid].setIcon(pinIcon(b, st.fillColor)); }
  }

  // ---------- 建物のシート(部屋ごとの記録) ----------
  function openBuilding(bid) { if (S.sheetBid !== bid) S.draft = {}; S.sheetBid = bid; renderSheet(); }
  function draftCount() { return Object.keys(S.draft || {}).length; }
  function closeSheet(force) {
    if (!force && draftCount() && !window.confirm('保存していない訪問状況があります。破棄して閉じますか？')) return;
    S.draft = {}; S.sheetBid = null; $('#sheet').classList.add('hidden');
  }
  function pickerHtml(r, can, cur) {
    var l = statusList(), th = inputTheme(), id = esc(r.roomId);
    if (th === '1') return '<select class="rstatus" data-room="' + id + '"' + (can ? '' : ' disabled') + '>' + l.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select>';
    return '<div class="spk n' + Math.min(l.length, 5) + '">' + l.map(function (x) { return '<button type="button" class="sp-btn sp-' + esc(x.id) + (x.id === cur ? ' on' : '') + '" data-act="setStatus" data-room="' + id + '" data-v="' + esc(x.id) + '"' + (can ? '' : ' disabled') + '>' + esc(x.label) + '</button>'; }).join('') + '</div>';
  }
  function renderSheet() {
    var sh = $('#sheet'), d = S.data[S.cur];
    if (!S.sheetBid || !d) { sh.classList.add('hidden'); return; }
    var b = d.buildings.filter(function (x) { return x.buildingId === S.sheetBid; })[0]; if (!b) { sh.classList.add('hidden'); return; }
    var a = (b.areaId && areaById(b.areaId)) || d.area, can = a.canEdit, rs = roomsOf(b.areaId || S.cur, b.buildingId), keep = sh.querySelector('.body') ? sh.querySelector('.body').scrollTop : 0;
    var manual = cfg('statusSaveMode', 'inline') === 'manual', dirty = draftCount(), th = inputTheme();
    var h = '<div class="grip"><i></i></div><div class="head"><div class="row"><div class="name grow">' + esc(b.buildingName || '建物名なし') + '</div><div class="ainline">' + esc(a.areaName) + '</div><button class="xbtn" data-act="closeSheet" aria-label="閉じる">×</button></div></div>';
    h += '<div class="body"><div class="tool">' + (b.lat != null && b.lng != null ? '<button class="btn small" data-act="route">経路</button>' : '') + (manual && can ? '<button class="btn small primary' + (dirty ? '' : ' dis') + '" data-act="saveDraft">保存' + (dirty ? '(' + dirty + ')' : '') + '</button>' : '') + '' + (cfg('autoRefreshEnabled', true) === false ? '<button class="btn small" data-act="sheetRefresh">更新</button>' : '') + '<button class="btn small" data-act="report">報告</button></div>';
    var ed = !!(S.edit && S.user && S.user.role === 'admin');
    if (!can) h += '<div class="locknote">この区域は' + (a.inUse ? '担当外' : '「使用中」ではない') + 'ため、見るだけです。</div>';
    if (ed) h += '<div class="row"><input class="grow" id="bName" placeholder="建物の名前" value="' + esc(b.buildingName) + '"><input class="grow" id="bMemo" placeholder="建物のメモ" value="' + esc(b.buildingMemo) + '"></div>';
    else if (b.buildingMemo) h += '<div class="bmemo"><span>メモ：</span>' + esc(b.buildingMemo) + '</div>';
    // 階ごとにまとめる(旧GASの建物詳細と同じ)
    var fl = {}, keys = [];
    rs.forEach(function (r) { var k = String(r.floor || '不明'); if (!fl[k]) { fl[k] = []; keys.push(k); } fl[k].push(r); });
    keys.sort(function (x, y) { var nx = parseInt(x, 10), ny = parseInt(y, 10), ax = !isNaN(nx), ay = !isNaN(ny); if (ax && ay) return nx - ny; if (ax) return -1; if (ay) return 1; return x.localeCompare(y, 'ja'); });
    if (!rs.length) h += '<div class="note" style="padding:10px 2px">部屋データがありません。</div>';
    keys.forEach(function (k) {
      h += '<div class="flabel">' + (k === '不明' ? '階数不明' : esc(k) + '階') + '</div><div class="fgrid in' + th + '">';
      fl[k].sort(function (x, y) { return String(x.roomId).localeCompare(String(y.roomId), 'ja', { numeric: true }); }).forEach(function (r) {
        var cur = S.draft && S.draft[r.roomId] !== undefined ? S.draft[r.roomId] : r.status, nm = String(r.roomName || '(部屋名なし)'), long = nm.length > 5;
        h += '<div class="room st-' + esc(cur) + (r.mark ? ' mk-' + esc(r.mark) : '') + (long ? ' long' : '') + (S.draft && S.draft[r.roomId] !== undefined ? ' picked' : '') + '" data-room="' + esc(r.roomId) + '"><div class="rhead"><div class="rn">' + esc(nm) + '</div>' + (r.mark === 'reject' ? '<span class="badge rej">拒否</span>' : r.mark === 'caution' ? '<span class="badge cau">注意</span>' : '') + (ed ? '<button class="btn small danger" style="margin-left:auto" data-act="ed:delRoom" data-v="' + esc(r.roomId) + '">削除</button>' : '') + '</div>';
        h += '<div class="rrow pick"><div class="rlabel"></div><div class="rval">' + pickerHtml(r, can, cur) + '</div></div>';
        if (can && isAdmin()) h += '<div class="rrow"><div class="rlabel">メモ:</div><div class="rval"><input class="memo" data-room="' + esc(r.roomId) + '" placeholder="メモ" value="' + esc(r.memo) + '"></div></div>';
        else if (r.memo && !r.mark) h += '<div class="rrow"><div class="rlabel">メモ:</div><div class="rval memotxt">' + esc(r.memo) + '</div></div>';
        if (isAdmin() && can) h += '<div class="rrow marks">' + [['reject', '拒否'], ['caution', '注意']].map(function (m) { return '<button class="chip mark-' + m[0] + (r.mark === m[0] ? ' on' : '') + (can ? '' : ' dis') + '" data-act="setMark" data-room="' + esc(r.roomId) + '" data-v="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>';
        if (r.tenant) h += '<div class="upd">' + esc(r.tenant) + '</div>';
        if (r.updatedAt) h += '<div class="upd">更新: ' + esc(String(r.updatedAt).slice(0, 16).replace('T', ' ')) + (r.updatedBy ? ' ' + esc(r.updatedBy) : '') + '</div>';
        h += '</div>';
      });
      h += '</div>';
    });
    if (ed && SADO.sheetTools) h += SADO.sheetTools(b);
    sh.style.height = S.sheetH ? S.sheetH + 'px' : '50%';
    sh.innerHTML = h + '</div>'; sh.classList.remove('hidden'); if (keep) sh.querySelector('.body').scrollTop = keep;
  }
  // 訪問状況の変更: 「すぐに保存」ならその場で保存、「まとめて保存」なら下書きにして保存ボタンで送る
  function setStatusUi(roomId, v) {
    if (cfg('statusSaveMode', 'inline') !== 'manual') { patchRoom(roomId, { status: v }); return; }
    var r = roomById(roomId); if (!r) return; S.draft = S.draft || {};
    if (v === r.status) delete S.draft[roomId]; else S.draft[roomId] = v;
    renderSheet();
  }
  function saveDraft() {
    var ids = Object.keys(S.draft || {}); if (!ids.length) { toast('変更はありません。'); return; }
    var dr = S.draft; S.draft = {}; ids.forEach(function (id) { patchRoom(id, { status: dr[id] }); }); toast(ids.length + '件を保存しました。', 1500);
  }
  function routeToBuilding() {
    var d = S.data[S.cur], b = d && d.buildings.filter(function (x) { return x.buildingId === S.sheetBid; })[0]; if (!b || b.lat == null) return;
    window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(b.lat + ',' + b.lng) + '&travelmode=driving', '_blank');
  }
  var lastAuto = 0;
  function sheetRefresh(quiet) {
    if (!S.cur || !S.online) { if (!quiet) toast('電波がないため、更新できません。'); return; }
    if (draftCount() && !quiet) { toast('保存していない変更があります。先に保存してください。'); return; }
    lastAuto = Date.now(); SADO.reloadCur().then(function () { if (!quiet) toast('最新の情報に更新しました。', 1200); });
  }
  // 建物の詳細を開いている間、ほかの人の入力を自動で反映する(動作設定で入/切・間隔を決める)
  setInterval(function () {
    if (!S.sheetBid || !S.cur || S.edit || document.hidden || !S.online || S.pending > 0 || draftCount()) return;
    if (cfg('autoRefreshEnabled', true) === false) return;
    if (Date.now() - lastAuto < Math.max(5, Number(cfg('autoRefreshIntervalSec', 15))) * 1000) return;
    var ae = document.activeElement; if (ae && ae.closest && ae.closest('#sheet') && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
    sheetRefresh(true);
  }, 3000);
  // つまみ(上の線)や見出しをドラッグして、ウィンドウの高さを変える
  document.addEventListener('pointerdown', function (ev) {
    var t = ev.target; if (!t.closest || !t.closest('#sheet .grip, #sheet .head') || t.closest('button,input,select,textarea')) return;
    var sh = $('#sheet'), y0 = ev.clientY, h0 = sh.getBoundingClientRect().height, navH = 0;
    sh.classList.add('dragging');
    function mv(e) { var nh = Math.max(110, Math.min(window.innerHeight * 0.92 - navH, h0 + (y0 - e.clientY))); sh.style.height = nh + 'px'; S.sheetH = Math.round(nh); }
    function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); sh.classList.remove('dragging'); }
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  });
  function persistArea() { if (S.merged) return Promise.all((S.kids || []).map(function (k) { return idb.set('area', k, S.data[k]); })); return idb.set('area', S.cur, S.data[S.cur]); }
  function roomById(id) { var d = S.data[S.cur]; for (var i = 0; i < d.rooms.length; i++) if (d.rooms[i].roomId === id) return d.rooms[i]; return null; }
  function patchRoom(roomId, patch) {
    var d = S.data[S.cur], r = d && roomById(roomId), ar = r && ((r.areaId && areaById(r.areaId)) || d.area); if (!d || !r || !ar.canEdit) { toast('この建物は編集できません。'); return; }
    var op = { type: 'status', areaId: r.areaId || S.cur, roomId: roomId, t: new Date().toISOString(), label: ar.areaName + ' ' + r.roomName };
    for (var k in patch) op[k] = patch[k];
    if (op.status === undefined && op.memo === undefined && op.mark === undefined) return;
    if (op.status !== undefined && op.memo === undefined) op.memo = r.memo; // 状況だけ変えるときも、今のメモを一緒に送る
    applyOp(d, op); persistArea(); enqueue(op); restyle(r.buildingId); renderSheet();
  }
  function patchBuilding(bid, patch) {
    var d = S.data[S.cur]; if (!d || !S.user || S.user.role !== 'admin') return; // 建物の名前・メモは区域係のみ
    var bq = d.buildings.filter(function (x) { return x.buildingId === bid; })[0], op = { type: 'building', areaId: (bq && bq.areaId) || S.cur, buildingId: bid, label: d.area.areaName + ' 建物' };
    for (var k in patch) op[k] = patch[k];
    applyOp(d, op); persistArea(); enqueue(op);
  }

  // ---------- 未送信の記録と自動同期 ----------
  function enqueue(op) { return idb.add('queue', op).then(function () { return countPending(); }).then(flush); }
  function countPending() { return idb.all('queue').then(function (a) { S.pending = a.length; updateBadge(); return a.length; }); }
  function updateBadge() {
    var b = $('#syncBadge'); if (!b) return;
    b.className = ''; b.id = 'syncBadge';
    var hb = $('#homeBadge'); if (hb) hb.textContent = ''; 
    if (S.pending > 0) { b.textContent = (S.online ? '送信待ち ' : '未送信 ') + S.pending + '件'; b.classList.add('pend'); }
    else if (!S.online) { b.textContent = 'オフライン'; b.classList.add('off'); }
    else b.textContent = '同期済み';
    if (hb) hb.textContent = b.textContent;
    if (S.online && S.pending === 0 && !b.classList.length) b.className = '';
  }
  var flushing = false;
  function flush() {
    if (flushing || !S.token || !S.online) return Promise.resolve();
    flushing = true;
    return idb.all('queue').then(function (items) {
      if (!items.length) { flushing = false; return; }
      var batch = items.slice(0, 40), ops = batch.map(function (i) { return i.val; });
      return api('sync', { ops: ops }).then(function (res) {
        var errs = [];
        res.results.forEach(function (r, i) { if (!r.ok) errs.push((ops[i].label || '') + ': ' + r.error); });
        return Promise.all(batch.map(function (i) { return idb.del('queue', i.key); })).then(function () {
          flushing = false; countPending();
          if (errs.length) { toast('送信できなかった記録があります:\n' + errs.slice(0, 3).join('\n'), 7000); if (S.cur) (S.merged ? selectParent(S.cur, true) : loadAreaData(S.cur, true)).then(function () { drawBuildings(); renderSheet(); }); }
          return flush();
        });
      });
    })['catch'](function (e) { flushing = false; if (e && e.expired) sessionExpired(); });
  }
  SADO.flush = flush;

  // ---------- 現在地(旧GASと同じ: 向きの矢印+精度の円。◎で現在地を中心にする) ----------
  var loc = { watchId: null, marker: null, circle: null, last: null, follow: false, on: false };
  function locUi() { try { if (SADO.MapRot) SADO.MapRot.onGpsFollowChanged(loc.follow); } catch (e) {} }
  // 矢じりの向き: 進む方向(端末の方位センサー、なければGPSの向き)。地図を回しているときは、その分もずらす
  function locArrow() {
    try {
      var h = typeof loc.sensor === 'number' ? loc.sensor : loc.gps; if (typeof h !== 'number' || !isFinite(h) || !loc.marker) return;
      var el = loc.marker.getElement(), ar = el && el.querySelector('.current-location-arrow'); if (!ar) return;
      var b = map && map.getBearing ? Number(map.getBearing()) || 0 : 0, sg = map && typeof map.rotateSign === 'number' ? (map.rotateSign >= 0 ? 1 : -1) : 1;
      ar.style.transform = 'rotate(' + (h - sg * b).toFixed(0) + 'deg)';
    } catch (e) {}
  }
  function locOrient(e) {
    var h = null; if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading; else if (e.alpha != null && (e.absolute === true || e.type === 'deviceorientationabsolute')) h = 360 - e.alpha;
    if (h == null) return; var ang = window.screen && screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : 0;
    loc.sensor = (h + ang + 360) % 360; locArrow();
  }
  function locShow(ll, acc, heading) {
    if (!map) return;
    if (!loc.listen) { loc.listen = true; window.addEventListener('deviceorientationabsolute', locOrient, true); window.addEventListener('deviceorientation', locOrient, true); map.on('rotate', locArrow); map.on('dragstart', function () { if (loc.follow) { loc.follow = false; locUi(); } }); }
    if (!loc.marker) {
      loc.marker = L.marker(ll, { icon: L.divIcon({ className: 'current-location-icon', html: '<div class="current-location-arrow"><svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><path d="M14 2 L24 25 L14 19.5 L4 25 Z" fill="#1a73e8" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg></div>', iconSize: [28, 28], iconAnchor: [14, 14] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    } else loc.marker.setLatLng(ll);
    if (typeof heading === 'number' && isFinite(heading)) loc.gps = heading; locArrow();
    if (!loc.circle) loc.circle = L.circle(ll, { radius: acc, color: '#1a73e8', fillColor: '#1a73e8', fillOpacity: 0.15, weight: 1, interactive: false }).addTo(map);
    else { loc.circle.setLatLng(ll); loc.circle.setRadius(acc); }
  }
  function locStop() {
    if (loc.watchId !== null) { navigator.geolocation.clearWatch(loc.watchId); loc.watchId = null; }
    if (loc.marker && map) { map.removeLayer(loc.marker); loc.marker = null; }
    if (loc.circle && map) { map.removeLayer(loc.circle); loc.circle = null; }
    loc.on = false; loc.follow = false; loc.last = null; locUi();
  }
  function locStart() {
    if (!navigator.geolocation) { toast('この端末では現在地を取得できません。'); return; }
    if (!map) return;
    navigator.geolocation.getCurrentPosition(function (p) {
      var ll = [p.coords.latitude, p.coords.longitude]; loc.last = ll; locShow(ll, p.coords.accuracy || 0, p.coords.heading);
      if (loc.follow) { if (map.getZoom() < 16) map.setView(ll, 17); else map.panTo(ll, { animate: true }); }
      if (loc.watchId !== null) navigator.geolocation.clearWatch(loc.watchId);
      loc.watchId = navigator.geolocation.watchPosition(function (p2) {
        var l2 = [p2.coords.latitude, p2.coords.longitude]; loc.last = l2; locShow(l2, p2.coords.accuracy || 0, p2.coords.heading);
        if (loc.follow && map) map.panTo(l2, { animate: true });
      }, function () {}, { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 });
      loc.on = true; locUi();
    }, function (err) {
      toast(err && err.code === 1 ? '位置情報の利用が拒否されています。端末の設定を確認してください。' : err && err.code === 3 ? '現在地の取得がタイムアウトしました。電波の良い場所で、もう一度お試しください。' : '現在地を取得できませんでした。', 5000);
      locStop();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  }
  function locToggle() {
    if (!map) return;
    if (!loc.on) { loc.follow = true; locStart(); locUi(); return; }
    loc.follow = !loc.follow; if (loc.follow && loc.last) { if (map.getZoom() < 16) map.setView(loc.last, 17); else map.panTo(loc.last, { animate: true }); } locUi();
  }
  function locate() { locToggle(); }
  SADO.loc = { isFollow: function () { return loc.follow; }, toggle: locToggle };
  SADO.getMap = function () { return map; };

  // ---------- ホーム(国仲・遠方を選び、区域の一覧から地図へ) ----------
  var CATS = [['国仲', '国仲'], ['遠方', '遠方'], ['アパート', 'アパート']];
  function isAdmin() { return !!(S.user && S.user.role === 'admin'); }
  function isMaint() { return !!(S.user && S.user.role === 'maintainer'); } // 編集者: 奉仕者の権限+建物・部屋の編集
  function canEditMode() { return isAdmin() || isMaint(); }
  function roleLabel() { return isAdmin() ? '区域係' : (isMaint() ? '編集者' : '奉仕者'); }
  function showNav() { $('#navAdmin').classList.toggle('hidden', !isAdmin()); $('#navEdit').classList.toggle('hidden', !canEditMode()); }
  function inCat(a, cat) { return (a.category || '国仲') === cat; }
  // 区域係はすべて。奉仕者は、自分か所属グループ(会衆を含む)が担当の区域
  function visibleAreas() {
    return S.areas.filter(function (a) { return !a.isParent && (isAdmin() || a.mine); }); // 親区域(大きな区域)は、まとめ用なので、地図で開く対象には入れない
  }
  function catAreas(cat) { return visibleAreas().filter(function (a) { return inCat(a, cat); }); }
  function catAreasShown(cat) { return catAreas(cat).filter(function (a) { return !S.onlyUse || a.inUse; }); }
  function activeNav(v) { var bs = document.querySelectorAll('#nav button'); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-v') === v); }
  function closePanels() { $('#home').classList.add('hidden'); $('#menu').classList.add('hidden'); activeNav('map'); }
  SADO.activeNav = activeNav;
  (function () { // 建物詳細が開いている間は body に印を付ける(下のバーを隠すため)
    var sh = document.getElementById('sheet'); if (!sh || !window.MutationObserver) return;
    function sync() { document.body.classList.toggle('detail-open', !sh.classList.contains('hidden')); }
    new MutationObserver(sync).observe(sh, { attributes: true, attributeFilter: ['class'] }); sync();
  })();
  function goHome() {
    S.homeCat = null; S.homeParent = null; closeSheet(true); $('#menu').classList.add('hidden'); $('#home').classList.remove('hidden'); activeNav('areas'); renderHome();
  }
  // ---------- 大きな区域(親区域)→ 小さな区域(子区域) ----------
  function hasParents() { return S.areas.some(function (a) { return a.isParent; }); }
  function parentsOf(cat) {
    var kids = catAreasShown(cat), by = {};
    kids.forEach(function (k) { if (k.parentId) (by[k.parentId] = by[k.parentId] || []).push(k); });
    var out = S.areas.filter(function (p) { return p.isParent && inCat(p, cat) && by[p.areaId]; });
    out.forEach(function (p) { p._kids = by[p.areaId]; });
    return out;
  }
  function parentRows(cat, q) {
    q = (q || '').replace(/[\s　]/g, '').toLowerCase();
    return parentsOf(cat).filter(function (p) { return !q || p.areaName.replace(/[\s　]/g, '').toLowerCase().indexOf(q) >= 0; }).map(function (p) { return parentRowHtml(p, false, true); }).join('') || '<div class="note" style="padding:12px 4px">該当する区域がありません。</div>';
  }
  function parentListHtml(cat) {
    return '<div class="note">' + (isAdmin() ? 'すべての大きな区域です。' : 'あなた、またはあなたのグループが担当の区域です。') + '</div><input type="search" id="homeQ" class="homeq" placeholder="区域名で探す" value="' + esc(S.homeQ || '') + '"><div id="homeList">' + parentRows(cat, S.homeQ) + '</div>';
  }
  function bindHomeQ() { var i = $('#homeQ'); if (i) i.oninput = function () { S.homeQ = i.value; $('#homeList').innerHTML = parentRows(S.homeCat, S.homeQ); }; }
  // ---------- 区域ごとの進み具合(旧GASの区域メニューと同じ: グラフ・％・訪問済み部屋数) ----------
  function loadProg(force) {
    if (!S.token || !S.online) return Promise.resolve();
    if (!force && S.progAt && Date.now() - S.progAt < 20000) return Promise.resolve();
    S.progAt = Date.now();
    return api('getProgress').then(function (p) { var same = JSON.stringify(p) === JSON.stringify(S.prog); S.prog = p; if (!same && !$('#home').classList.contains('hidden')) renderHome(); }, function () {});
  }
  function progOf(a) {
    var P = S.prog || {}, ids = a.isParent ? S.areas.filter(function (x) { return x.parentId === a.areaId; }).map(function (x) { return x.areaId; }) : [a.areaId], o = { total: 0, visited: 0, done: 0, c: {}, buildings: 0, doneBuildings: 0 }, any = false;
    ids.forEach(function (id) { var p = P[id]; if (!p) return; any = true; o.total += p.total; o.visited += p.visited; o.done += p.done || 0; o.buildings += p.buildings; o.doneBuildings += p.doneBuildings; for (var k in p.c) o.c[k] = (o.c[k] || 0) + p.c[k]; });
    return any ? o : null;
  }
  function pctOf(n, d) { return d ? Math.round(n * 100 / d) : 0; }
  function progBar(p) {
    var segs = statusList().map(function (x) { var n = (p.c || {})[x.id] || 0; return (x.visited || x.done) && n && p.total ? '<i style="width:' + (n * 100 / p.total).toFixed(2) + '%;background:' + stColor(x) + '"></i>' : ''; }).join('');
    return '<div class="pbar">' + segs + '</div>';
  }
  function progLegend() { return '<div class="plegend">' + statusList().filter(function (x) { return x.visited || x.done; }).map(function (x) { return '<span><i style="background:' + stColor(x) + '"></i>' + esc(x.label) + '</span>'; }).join('') + '<span><i style="background:var(--surface-3);border:1px solid var(--border)"></i>未訪問</span></div>'; }
  function fmtJa(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? m[1] + '年' + m[2] + '月' + m[3] + '日' : String(d || ''); }
  function periodHtml(a) { return a.inUse && a.useStartDate ? '<div class="pmeta">' + esc(fmtJa(a.useStartDate)) + '〜' + esc(fmtJa(a.expiry)) + '</div>' : ''; }
  function isAptCat(a) { return (a.category || '国仲') === 'アパート'; }
  // 訪問済みの件数(左)と、使用期間(右下)を同じ行に。幅がせまいと、期間は次の行へ。親区域単位で使用を決めた場合、期間は親のカードにだけ出す
  function metaRow(a, p) {
    var per = a.inUse && a.useStartDate && a.via !== 'parent' ? esc(fmtJa(a.useStartDate)) + '〜' + esc(fmtJa(a.expiry)) : '';
    var left = p && p.total ? '訪問済み ' + p.visited + ' / ' + p.total + '件' + (isAptCat(a) ? ' ・ 完了 ' + p.doneBuildings + ' / ' + p.buildings + '棟' : '') : '';
    return left || per ? '<div class="pmeta pm2"><span>' + left + '</span><span class="pper">' + per + '</span></div>' : '';
  }
  function progHtml(a) {
    var p = progOf(a);
    if (!p || !p.total) return metaRow(a, null);
    if (cfg('areaProgressView', 'graph') === 'graph') return '<div class="pg">' + progBar(p) + metaRow(a, p) + '</div>';
    return '<div class="pchips">' + statusList().map(function (x) { return '<span class="pchip pchip-' + esc(x.id) + '">' + esc(x.label) + ':' + (p.c[x.id] || 0) + '</span>'; }).join('') + '<span class="pchip all">全' + p.total + '件</span></div>' + metaRow(a, null);
  }
  function pctHtml(a) { var p = progOf(a); return p && p.total ? '<span class="pct">' + pctOf(p.visited, p.total) + '%</span>' : ''; }
  // 担当タブ(会衆・グループ・個人)の区域: 「使用中」「担当」の札や担当者名は出さない。区域一覧タブ(plain=true)は従来どおり
  // 区域をひらくと、建物ごとの進み具合(グラフ・訪問済み件数・％)が出る。建物を押すと、地図でその建物の詳細が開く
  function bldListHtml(a) {
    if (!(S.areaOpen && S.areaOpen[a.areaId])) return ''; var d = S.data[a.areaId]; if (!d) return '<div class="note" style="margin:6px 0 0 14px">読み込み中…</div>';
    var by = {}; d.rooms.forEach(function (r) { var o = by[r.buildingId] || (by[r.buildingId] = { total: 0, visited: 0, c: {} }); o.total++; var st = statusOf(r.status); o.c[st.id] = (o.c[st.id] || 0) + 1; if (st.visited) o.visited++; });
    var bs = d.buildings.slice().sort(function (x, y) { return String(x.buildingName || '~').localeCompare(String(y.buildingName || '~'), 'ja'); });
    return bs.map(function (b) { var p = by[b.buildingId] || { total: 0, visited: 0, c: {} }; return '<div class="bld" data-act="pickBuilding" data-a="' + esc(a.areaId) + '" data-v="' + esc(b.buildingId) + '"><b>' + esc(b.buildingName || '(名前なしの建物)') + '</b>' + (p.total ? progBar(p) + '<div class="pmeta">訪問済み ' + p.visited + ' / ' + p.total + '件(' + pctOf(p.visited, p.total) + '%)</div>' : '<div class="pmeta">部屋の登録なし</div>') + '</div>'; }).join('') || '<div class="note" style="margin:6px 0 0 14px">建物がありません。</div>';
  }
  function expBtn(a) { return '<button class="xchev" data-act="areaExp" data-v="' + esc(a.areaId) + '" aria-label="建物の一覧">' + (S.areaOpen && S.areaOpen[a.areaId] ? '▾' : '▸') + '</button>'; }
  function areaCard(a, plain) {
    if (!plain) return '<div class="card tap' + (a.inUse ? ' inuse' : '') + (S.areaOpen && S.areaOpen[a.areaId] ? ' open' : '') + '" data-act="areaExp" data-v="' + esc(a.areaId) + '"><div class="row"><div class="grow"><div class="pname"><b>' + esc(a.areaName) + '</b>' + pctHtml(a) + '</div></div>' +
      saveBtn('saveTiles', a.areaId) + '<button class="btn primary small" data-act="pickArea" data-v="' + esc(a.areaId) + '">開く</button></div>' + progHtml(a) + tileBar(a.areaId) + bldListHtml(a) + '</div>';
    return '<div class="card tap' + (a.inUse ? ' inuse' : '') + (S.areaOpen && S.areaOpen[a.areaId] ? ' open' : '') + '" data-act="areaExp" data-v="' + esc(a.areaId) + '"><div class="row"><div class="grow"><b>' + esc(a.areaName) + '</b>' + (a.inUse ? '<span class="badge use">使用中</span>' : '<span class="badge off">未使用</span>') + (a.mine ? '<span class="badge mine">担当</span>' : '') + (a.inUse && !a.canEdit ? '<span class="badge off">見るだけ</span>' : '') + '<div class="note">' +
      (a.inUse ? esc(a.assigneeName) : (a.lastDoneDate ? '前回完了 ' + esc(a.lastDoneDate) : '')) + '</div></div>' +
      dlBtn(a.areaId) + saveBtn('saveTiles', a.areaId) + '<button class="btn primary small" data-act="pickArea" data-v="' + esc(a.areaId) + '">開く</button></div>' + (a.inUse ? progHtml(a) : '') + tileBar(a.areaId) + bldListHtml(a) + '</div>';
  }
  function onlyUseBox() { return '<div class="onlyuse" data-act="toggleOnly" style="margin:4px 2px 10px;padding:8px 6px;cursor:pointer"><input type="checkbox" style="pointer-events:none;width:18px;height:18px;vertical-align:middle"' + (S.onlyUse ? ' checked' : '') + '> <span style="vertical-align:middle">使用中の区域のみ表示</span></div>'; }
  var CLOUD = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5H17"/><path d="M12 11v9"/><path d="m9 17 3 3 3-3"/></svg>';
  var DOCI = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6"/><path d="m9.5 14.5 2.5 2.5 2.5-2.5"/></svg>';
  function dlBtn(id) { return S.settings && S.settings.hasDownloads ? '<button class="btn small" data-act="dlPick" data-v="' + esc(id) + '" title="印刷用の地図(PDF・PNG)" aria-label="印刷用の地図(PDF・PNG)" style="padding:6px 9px">' + DOCI + '</button>' : ''; }
  var SPIN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" class="cspin" style="display:block"><path d="M12 3a9 9 0 1 0 9 9"/></svg>';
  function saveBtn(act, id) {
    var ka = areaById(id), j = S.tile && (S.tile[id] || (ka && ka.parentId && S.tile[ka.parentId]));
    if (j) return '<button class="btn small" disabled aria-label="地図を保存中" style="padding:6px 9px">' + SPIN + '</button>';
    var dls = act === 'saveTiles' && S.settings && S.settings.hasDownloads; // 区域カードの雲は、「オフラインで使う/PDF/画像」の三択
    if (tileDone()[id] && !dls) return ''; // 保存が終わったら、雲のマークは出さない
    if (dls) return '<button class="btn small" data-act="cloudPick" data-v="' + esc(id) + '" title="地図の保存・ダウンロード" aria-label="地図の保存・ダウンロード" style="padding:6px 9px">' + CLOUD + '</button>';
    return '<button class="btn small" data-act="' + act + '" data-v="' + esc(id) + '" title="地図を端末に保存" aria-label="地図を端末に保存" style="padding:6px 9px">' + CLOUD + '</button>';
  }
  var TILE_KB = 15; // 地図1枚のおよその大きさ(KB)。端末からは正確な容量がわからないので、目安として出す
  function mbStr(n) { var m = n * TILE_KB / 1024; return m < 10 ? m.toFixed(1) : String(Math.round(m)); }
  function tileText(j) { var pc = j.total ? Math.round(j.n / j.total * 100) : 0; return j.total ? '地図を保存中… ' + j.n + ' / ' + j.total + '枚(' + pc + '%)・約' + mbStr(j.n) + ' / 約' + mbStr(j.total) + ' MB' : '地図の範囲を調べています…'; }
  function tileBar(id) { var j = S.tile && S.tile[id]; if (!j) return ''; var pc = j.total ? Math.round(j.n / j.total * 100) : 0; return '<div class="tprog" data-tk="' + esc(id) + '"><div class="pbar"><i style="width:' + pc + '%;background:var(--primary)"></i></div><div class="note">' + tileText(j) + '</div></div>'; }
  // 親区域の下の小さな区域: 許可された数/全体の数
  function kidCounts(pid) {
    var all = S.areas.filter(function (a) { return !a.isParent && a.parentId === pid; }).length;
    var ok = visibleAreas().filter(function (a) { return a.parentId === pid; }).length;
    return ok + '/' + all;
  }
  function parentRowHtml(p, open, extra) {
    return '<div class="card pcard' + (p.inUse ? ' inuse' : '') + '" data-act="' + (extra ? 'homeParent' : 'homeToggle') + '" data-v="' + esc(p.areaId) + '"><div class="row"><div class="grow"><div class="pname"><b>' + esc(p.areaName) + '</b>' + pctHtml(p) + '</div>' +
      (extra && p.inUse ? '<span class="badge use" style="margin:2px 0 0">使用中</span><span class="note">　' + esc(p.assigneeName) + '</span>' : '') + '</div>' +
      saveBtn('saveTilesParent', p.areaId) + '<button class="btn primary small" data-act="openParent" data-v="' + esc(p.areaId) + '">開く</button></div>' + (extra && !p.inUse ? '' : progHtml(p)) + tileBar(p.areaId) + '</div>';
  }
  function renderHome() {
    var mb0 = document.querySelector('#home .mbody'), sc0 = mb0 ? mb0.scrollTop : 0; renderHome0(); var mb1 = document.querySelector('#home .mbody'); if (mb1 && sc0) mb1.scrollTop = sc0;
  }
  function renderHome0() {
    if (!S.prog || Date.now() - (S.progAt || 0) > 20000) loadProg();
    var el = $('#home'), cat = S.homeCat, tab = S.homeTab || 'all', title = (S.settings && S.settings.appTitle) || '佐渡住宅GAS';
    var gname = (S.user && S.user.groupName) || '', TABS = [['all', '会衆'], ['group', 'グループ'], ['user', '個人'], ['list', '区域一覧']];
    var mineOf = function (k) { return visibleAreas().filter(function (a) { return a.inUse && (a.kinds || []).indexOf(k) >= 0; }); };
    var hhm = S.progAt ? new Date(S.progAt) : null, ptime = hhm ? (hhm.getHours() < 10 ? '0' : '') + hhm.getHours() + ':' + (hhm.getMinutes() < 10 ? '0' : '') + hhm.getMinutes() + ' 時点・' : '';
    var h = '<div class="mhead"><div class="t">' + (cfg('menuTitleEnabled', true) !== false ? esc(title) : '') + '</div><button data-act="navClose" aria-label="閉じる">✕</button></div>' +
      userBox() +
      '<div class="tabs fill">' + TABS.map(function (t) { return '<button class="tab' + (tab === t[0] ? ' on' : '') + '" data-act="homeTab" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div class="mbody">' + (tab ? progLegend() + '<div class="ptool"><span class="pnote"></span><button class="btn secondary small" data-act="progReload' + (S.progBusy ? '" disabled="disabled' : '') + '">' + (S.progBusy ? SPIN + '更新中…' : '更新') + '</button></div>' : '');
    if (S.areasLoading && !S.areas.length) {
      el.innerHTML = h + '<div class="loadbox"><div class="spin" id="homeSpin"></div><div class="note">読み込み中…</div></div></div>'; applyLogo($('#homeSpin')); return;
    }
    if (!tab) {
      h += '<div class="note" style="padding:14px 4px">上の「会衆」「グループ」「個人」「区域一覧」から選んでください。</div>';
      if (!S.areas.length) h += '<div class="note">区域のデータを読み込めていません。電波のあるところで、一度開いてください。</div>';
    } else if (tab !== 'list') {
      var kids = mineOf(tab);
      CATS.forEach(function (c) {
        var inC = kids.filter(function (a) { return inCat(a, c[0]); }); if (!inC.length) return;
        var by = {}, loose = [];
        inC.forEach(function (k) { var p = k.parentId && areaById(k.parentId); if (p) (by[p.areaId] = by[p.areaId] || []).push(k); else loose.push(k); });
        h += '<div class="subhead">' + esc(c[1]) + '</div>';
        S.areas.filter(function (p) { return p.isParent && by[p.areaId]; }).forEach(function (p) {
          var open = !!(S.homeOpen && S.homeOpen[tab + p.areaId]);
          if (open) h += '<div class="pgroup">' + parentRowHtml(p, open, false) + '<div class="pkids">' + by[p.areaId].map(function (k) { return areaCard(k); }).join('') + '</div></div>';
          else h += parentRowHtml(p, open, false);
        });
        loose.forEach(function (a) { h += areaCard(a); });
      });
      if (!kids.length) h += '<div class="note" style="padding:14px 4px">使用できる区域はありません。</div>';
    } else {
      cat = S.homeCat = cat || CATS[0][0];
      h += '<div class="tabs fill sub">' + CATS.map(function (c) { return '<button class="tab' + (cat === c[0] ? ' on' : '') + '" data-act="homeCat" data-v="' + esc(c[0]) + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>' + onlyUseBox();
      var list = catAreas(cat), par = S.homeParent ? areaById(S.homeParent) : null; if (S.onlyUse) list = list.filter(function (a) { return a.inUse; });
      if (par) { list = list.filter(function (a) { return a.parentId === par.areaId; }); h += '<div class="pgroup"><div class="note"><button class="btn small" data-act="homeParentBack">‹ 大きな区域一覧へ</button>　<b>' + esc(par.areaName) + '</b>' + (par.inUse ? '<span class="badge use">使用中</span>' : '') + '</div><div class="pkids">'; }
      else if (parentsOf(cat).length) { h += parentListHtml(cat); el.innerHTML = h + '</div>'; bindHomeQ(); return; }
      else h += '<div class="note">' + (isAdmin() ? 'すべての区域です。' : 'あなた、またはあなたのグループが担当の区域です。') + '</div><div style="height:8px"></div>';
      list.forEach(function (a) { h += areaCard(a, true); });
      if (par) h += '</div></div>';
      if (!list.length) h += '<div class="note" style="padding:12px 4px">担当の区域はありません。区域係に、担当の設定を確認してください。</div>';
    }
    el.innerHTML = h + '</div>';
  }

  // ---------- メニュー(設定・ダウンロード) ----------
  function openMenu(tab) { SADO.menuTab = tab || 'prefs'; $('#home').classList.add('hidden'); $('#menu').classList.remove('hidden'); activeNav(tab === 'report' ? 'report' : 'settings'); renderMenu(); }
  function closeMenu() { $('#menu').classList.add('hidden'); if ($('#home').classList.contains('hidden')) activeNav('map'); }
  var TILES = [['areas', '区域一覧', '区域と建物を選ぶ', '<path d="M12 21s-7-7.2-7-12a7 7 0 0 1 14 0c0 4.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>', ''], ['report', '報告', '気づいたことを送る', '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/>', ''], ['settings', '表示設定', '文字の大きさ・画面モード', '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', ''], ['editmenu', '編集', '建物や区域を編集', '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', ''], ['admin', '管理', '管理者向けの画面', '<path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>', 'tile-admin']];
  function tilesHtml() {
    return '<div class="menu-home-grid">' + TILES.filter(function (x) { return (x[0] !== 'admin' || isAdmin()) && (x[0] !== 'editmenu' || canEditMode()); }).map(function (x) { return '<button type="button" class="menu-tile ' + x[4] + '" data-act="nav" data-v="' + x[0] + '"><span class="menu-tile-icon"><svg viewBox="0 0 24 24">' + x[3] + '</svg></span><span><span class="menu-tile-title">' + x[1] + '</span><br><span class="menu-tile-sub">' + x[2] + '</span></span></button>'; }).join('') + '</div>' +
      '<div class="card"><div class="row"><div class="grow"><b>' + esc(S.user ? S.user.displayName : '') + '</b><div class="note">' + esc(roleLabel()) + (S.user && S.user.groupName ? '・' + esc(S.user.groupName) : '') + '</div></div><button class="btn danger small" data-act="logout">ログアウト</button></div></div>';
  }
  function renderMenu() {
    var tabs = [];
    var ttl = (S.settings && S.settings.appTitle) || '佐渡住宅GAS';
    $('#menu').innerHTML = '<div class="mhead">' + (SADO.menuTab === 'home' ? '' : '<button class="menu-back" data-act="menuHome">‹ メニュー</button>') + '<div class="t">' + (cfg('menuTitleEnabled', true) !== false ? esc(ttl) : '') + '</div><button data-act="navClose" aria-label="閉じる">✕</button></div>' +
      userBox() +
      '<div class="mbody" id="menuBody"></div>';
    renderMenuBody();
  }
  function shareUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  var qrState = 'none', qrWait = [];
  function loadQr(cb) {
    if (typeof qrcode === 'function') { cb(true); return; }
    qrWait.push(cb); if (qrState === 'loading') return; qrState = 'loading';
    var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
    sc.onload = function () { qrState = 'done'; var w = qrWait; qrWait = []; w.forEach(function (f) { f(typeof qrcode === 'function'); }); };
    sc.onerror = function () { qrState = 'none'; var w = qrWait; qrWait = []; w.forEach(function (f) { f(false); }); };
    document.head.appendChild(sc);
  }
  function drawQr() {
    var box = $('#qrBox'); if (!box) return;
    if (S.qrImg) { box.innerHTML = '<img alt="アプリのQRコード" src="' + S.qrImg + '">'; return; }
    loadQr(function (ok) {
      box = $('#qrBox'); if (!box) return;
      if (!ok) { box.innerHTML = '<span class="note" style="padding:12px;text-align:center">QRコードを表示できませんでした。電波の良い場所で開き直してください。</span>'; return; }
      try {
        var q = qrcode(0, 'M'); q.addData(shareUrl()); q.make(); var n = q.getModuleCount(), cell = 8, m = 4, size = (n + m * 2) * cell, cv = document.createElement('canvas'); cv.width = cv.height = size;
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, size, size); cx.fillStyle = '#000';
        for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) cx.fillRect((c + m) * cell, (r + m) * cell, cell, cell);
        S.qrImg = cv.toDataURL('image/png'); box.innerHTML = '<img alt="アプリのQRコード" src="' + S.qrImg + '">';
      } catch (e) { box.innerHTML = '<span class="note">QRコードを作れませんでした。</span>'; }
    });
  }
  function copyText(t) {
    var fb = function () { var i = $('#shareUrl'); try { i.focus(); i.select(); i.setSelectionRange(0, 9999); toast(document.execCommand('copy') ? 'URLをコピーしました。' : 'URLを長押ししてコピーしてください。'); } catch (e) { toast('URLを長押ししてコピーしてください。'); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('URLをコピーしました。'); }, fb); else fb();
  }
  // ---------- 報告(気づいたことを区域係へ。場所は「区分→区域→建物」の順に選ぶ) ----------
  var R = { cat: '', area: '', bld: '', place: '', text: '' };
  function renderReport(el) {
    var areas = R.cat ? catAreas(R.cat).filter(function (a) { return !a.isParent; }) : [], blds = [], d = R.area && S.data[R.area];
    if (d) blds = d.buildings.slice().sort(function (x, y) { return String(x.buildingName).localeCompare(String(y.buildingName), 'ja', { numeric: true }); });
    var sel = function (id, list, cur, blank, vk, lk) { return '<select id="' + id + '"><option value="">' + blank + '</option>' + list.map(function (x) { return '<option value="' + esc(x[vk]) + '"' + (x[vk] === cur ? ' selected' : '') + '>' + esc(x[lk] || '(名前なし)') + '</option>'; }).join('') + '</select>'; };
    el.innerHTML = '<div class="card"><h3>気づいたことを報告</h3><div class="note">建物や部屋で気づいたことを区域係に送れます。場所はわかる範囲でかまいません。</div>' +
      '<div class="subcard"><div class="fl">場所</div><div class="segrow">' + CATS.map(function (c) { return '<button class="' + (R.cat === c[0] ? 'on' : '') + '" data-act="rpCat" data-v="' + esc(c[0]) + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>' +
      (R.cat ? '<div class="fl">区域</div>' + sel('rpArea', areas, R.area, '未選択', 'areaId', 'areaName') + (R.area ? '<div class="fl">建物</div>' + sel('rpBld', blds, R.bld, d ? '未選択' : '読み込み中…', 'buildingId', 'buildingName') + '<div class="fl">部屋番号・場所</div><input id="rpPlace" placeholder="例: 101号室 / 1F廊下 / エントランス" value="' + esc(R.place) + '">' : '') : '<div class="note" style="margin-top:6px">まず、場所の区分を選んでください。</div>') + '</div>' +
      '<div class="subcard"><div class="fl">内容 <span class="req">必須</span></div><textarea id="rpText" rows="5" placeholder="例: 建物がなくなっていました。">' + esc(R.text) + '</textarea><div class="note" style="text-align:right" id="rpCnt">' + R.text.length + '文字</div></div>' +
      '<div class="row"><button class="btn secondary grow" data-act="rpClear">クリア</button><button class="btn primary grow" data-act="rpSend">報告を送信</button></div></div>';
  }
  function rpSend() {
    var tx = ($('#rpText') || {}).value || R.text; if (!tx.trim()) { toast('内容を入力してください。'); return; }
    var bd = R.area && S.data[R.area] && S.data[R.area].buildings.filter(function (x) { return x.buildingId === R.bld; })[0], pl = (($('#rpPlace') || {}).value || R.place || '').trim();
    enqueue({ type: 'report', areaId: R.area || '', buildingId: R.bld || '', roomName: (bd ? bd.buildingName : '') + (bd && pl ? ' ' : '') + pl, text: tx.trim(), label: '報告' });
    toast('報告を保存しました。電波があれば、すぐ送られます。'); R = { cat: '', area: '', bld: '', place: '', text: '' }; renderMenuBody();
  }
  function renderMenuBody() {
    var el = $('#menuBody'), t = SADO.menuTab; if (!el) return;
    if (t === 'home') {
      el.innerHTML = tilesHtml();
    } else if (t === 'report') {
      renderReport(el);
    } else if (t === 'prefs') {
      var p = getPrefs(), FS = ['小', 'やや小', '標準', '大', '特大', '最大'], fv = String(p.font || '3'), seg = function (act, cur, list) { return '<div class="segrow">' + list.map(function (x) { return '<button class="' + (String(cur) === x[0] ? 'on' : '') + '" data-act="' + act + '" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>'; };
      var hm = p.houseTap === 'sheet' || p.houseTap === 'direct' ? p.houseTap : cfg('houseTapMode', 'direct');
      el.innerHTML = '<div class="card"><h3>表示設定</h3>' +
        '<div class="setrow namerow"><div class="grow"><div class="tt">名前</div><div>' + esc(S.user ? S.user.displayName : '') + '<span class="note">　' + esc(roleLabel()) + (S.user && S.user.groupName ? '・' + esc(S.user.groupName) : '') + '</span></div></div><button class="btn danger small" data-act="logout">ログアウト</button></div>' +
        '<div class="setrow"><div class="tt">文字サイズ<span class="cntb">' + fv + ' / 6</span></div><div class="fsr">' + [1, 2, 3, 4, 5, 6].map(function (n) { return '<button class="' + (fv === String(n) ? 'on' : '') + '" data-act="prefFont" data-v="' + n + '"><span style="font-size:' + (10 + n * 2) + 'px">あ</span></button>'; }).join('') + '</div></div>' +
        '<div class="setrow"><div class="tt">画面モード</div>' + seg('prefTheme', p.theme || 'auto', [['light', 'ライト'], ['dark', 'ダーク'], ['auto', '端末に合わせる']]) + '</div>' +
        '<div class="setrow"><div class="tt">テーマ</div>' + seg('prefUi', p.ui || '1', [['1', 'テーマ1'], ['2', 'テーマ2'], ['3', 'テーマ3']]) + '</div>' +
        '<div class="setrow"><div class="tt">入力スタイル</div>' + seg('prefInput', inputTheme(), [['3', 'ボタン一覧'], ['2', 'ボタン'], ['1', 'プルダウン']]) + '</div>' +
        '<div class="setrow"><div class="tt">一軒家の入力スタイル</div>' + seg('prefHouse', hm, [['direct', 'タップで記録'], ['sheet', 'ウィンドウで選ぶ']]) + '</div>' +
        '<div class="note" style="margin-top:6px">この設定は、アカウントごとに保存されます。最初は区域係が決めた設定になっています。</div></div>' +
        '<div class="card"><h3>ヘルプ</h3><div class="note">使い方の説明を、別のウィンドウで開きます。</div><div class="row" style="margin-top:8px"><button class="btn primary" data-act="helpOpen">ヘルプを表示</button></div></div>' +
        '<div class="card"><h3>このアプリを共有</h3><div class="note">ほかの人のスマホのカメラでQRコードを読み取ると、このアプリが開きます。</div><div class="qrbox" id="qrBox"><span class="note">QRコードを準備中…</span></div><input id="shareUrl" readonly style="width:100%" value="' + esc(shareUrl()) + '"><div class="row" style="margin-top:8px"><button class="btn small" data-act="copyUrl">URLをコピー</button>' + (navigator.share ? '<button class="btn small" data-act="shareUrl">共有</button>' : '') + '</div></div>' +
        '<div class="card"><h3>パスワードの変更</h3><div class="row"><input id="pwOld" type="password" placeholder="今のパスワード"><input id="pwNew" type="password" placeholder="新しいパスワード(6文字以上)"><button class="btn small" data-act="changePw">変更</button></div></div>' +
        '<div class="card"><h3>端末の状態</h3><div class="note">未送信の記録: ' + S.pending + '件　/　' + (S.online ? 'オンライン' : 'オフライン') + '<br>画面 v49　/　GAS ' + esc((S.settings && S.settings.gasVersion) || '未確認') + '</div><div class="row" style="margin-top:6px"><button class="btn small" data-act="syncNow">今すぐ送信する</button><button class="btn small danger" data-act="clearCache">キャッシュを削除して更新</button></div></div>';
      setTimeout(drawQr, 350);
    }
  }
  // ヘルプ(設定メニューのボタンから、別のウィンドウで出す)
  function drawHelp() { var b = $('#helpWinBody'); if (b) b.innerHTML = helpHtml(); }
  function helpHtml() {
      var inl = cfg('statusSaveMode', 'inline') !== 'manual', mode = cfg('mapProgressMode', 'simple'), hv = SADO.helpTab || 'basic';
      var steps = [['区域を選ぶ', '画面下の「区域」から、「会衆」「グループ」「個人」のタブで、担当の区域を選んで「開く」を押します。大きな区域を開くと、中の小さな区域がまとめて地図に出ます。「区域一覧」では、すべての区域を見られます。'],
        ['建物を選ぶ', '地図の建物をタップします。アパートなど部屋情報のある建物はピン、一軒家などは丸で表示されます。' + (houseMode() === 'sheet' ? 'どの建物も、タップすると詳細ウィンドウが開きます。' : '一軒家などの丸は、タップするだけで記録でき(もう一度タップで次の状況)、長押しで詳細ウィンドウが開きます。')],
        ['訪問状況を入力', inl ? '部屋ごとに「会えた」「留守」などを選ぶと、<b>その場で自動保存</b>されます。' : '部屋ごとに「会えた」「留守」などを選んだあと、詳細ウィンドウの<b>「保存」ボタンを押すと保存</b>されます。保存し忘れに注意してください。']];
      var tips = [['👤', '名前の確認', '画面下の「設定」で、記録に残る名前を確認できます。変更は区域係にお願いします。'], ['🔠', '見やすく調整', '画面下の「設定」で、文字の大きさ・ダークモード・入力スタイルを変更できます。'],
        mode === 'circle' ? ['⭕', '地図のサークル', '使用中の区域の建物は、輪の色で部屋の状況の割合を、中央の数字で「残りの部屋の数」を表示します。'] : (mode === 'simple' ? ['🎨', 'ピンの色', '地図の色で、建物の進み具合がわかります。<div class="hlegend"><span><i style="background:#1a73e8"></i>まだ訪問していない</span><span><i style="background:#ef6c00"></i>訪問の途中</span><span><i style="background:#188038"></i>完了</span><span><i style="background:#9aa0a6"></i>編集不可の区域</span></div>赤い枠は「拒否」、黄色い枠は「注意」の部屋がある建物です。'] : null),
        ['📍', '現在地', '右上のボタンで、現在地が中心になるように地図が動きます。'], cfg('mapRotationEnabled', true) !== false ? ['🧭', 'コンパス', '2本指で地図を回転、もしくは端末の向きに合わせて自動で回転させられます。'] : null,
        ['🧭', '経路', '建物の詳細ウィンドウで「経路」を押すと、Googleマップでその建物までの道順を表示します。'], ['📝', '報告', '詳細ウィンドウの「報告」から、建物や部屋について気づいたことを区域係に送れます。'],
        ['☁️', '地図を端末に保存', '区域の横の雲のボタンで、地図の背景を端末に保存します。圏外でも地図が見られます。電波のあるところで押しておいてください。'],
        ['📶', '電波が弱いとき', '保存できなかった訪問状況は端末に一時保存され、つながると自動で送信されます。送信前は画面上に「未送信」と表示されます。']].filter(function (x) { return x; });
      return '<div class="htabs"><button class="' + (hv === 'basic' ? 'on' : '') + '" data-act="helpTab" data-v="basic">基本</button><button class="' + (hv === 'features' ? 'on' : '') + '" data-act="helpTab" data-v="features">機能</button></div>' +
        (hv === 'basic' ? '<div class="card"><h3>基本の使い方</h3><ol class="hlist">' + steps.map(function (x, i) { return '<li><span class="hnum">' + (i + 1) + '</span><div><div class="htt">' + x[0] + '</div><div class="hds">' + x[1] + '</div></div></li>'; }).join('') + '</ol><button class="btn small" data-act="helpTab" data-v="features">補助機能を見る ›</button></div>'
          : '<div class="card"><h3>補助機能</h3><ul class="hlist">' + tips.map(function (x) { return '<li><span class="hico">' + x[0] + '</span><div><div class="htt">' + x[1] + '</div><div class="hds">' + x[2] + '</div></div></li>'; }).join('') + '</ul><div class="note" style="margin-top:8px">この画面は、画面下の「ヘルプ」からいつでも見られます。</div></div>');
  }
  function b64Blob(b64, mime) { var bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); }
  SADO.saveBlob = function (blob, name) {
    if (navigator.msSaveBlob) { navigator.msSaveBlob(blob, name); return; }
    var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
  };

  // ---------- 地図タイルの事前保存(地理院タイルのみ) ----------
  function lonToX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function latToY(lat, z) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); }
  function tileDone() { try { return JSON.parse(localStorage.getItem('sado-tiles-done') || '{}'); } catch (e) { return {}; } }
  function tileMark(key) { var d = tileDone(); d[key] = Date.now(); try { localStorage.setItem('sado-tiles-done', JSON.stringify(d)); } catch (e) {} }
  var tileRT = null; function tileRender() { if (tileRT) return; tileRT = setTimeout(function () { tileRT = null; if ($('#home').classList.contains('hidden')) return;
      // 画面を作り直すと、スクロール中の指の動きが途切れるので、進み具合の数字と棒だけを書き換える
      var ok = true; Object.keys(S.tile || {}).forEach(function (k) { var j = S.tile[k], el = document.querySelector('#home .tprog[data-tk="' + k.replace(/"/g, '') + '"]'); if (!el) { ok = false; return; } var pc = j.total ? Math.round(j.n / j.total * 100) : 0; el.querySelector('i').style.width = pc + '%'; el.querySelector('.note').textContent = tileText(j); });
      if (!ok) renderHome(); }, 250); }
  function saveTiles(areaIds, big, key) {
    key = key || areaIds[0]; S.tile = S.tile || {};
    if (S.tile[key]) return;
    if (!window.caches) { toast('この端末では地図の保存ができません。'); return; }
    if (!S.online) { toast('電波のあるところで実行してください。'); return; }
    if (!areaIds.length) { toast('保存できる区域がありません。'); return; }
    var cap = big ? 2500 : 700;
    S.tile[key] = { n: 0, total: 0 }; tileRender(); if (!$('#home').classList.contains('hidden')) renderHome();
    Promise.all(areaIds.map(function (id) { return loadAreaData(id); })).then(function () {
      var pts = [];
      areaIds.forEach(function (areaId) {
        var d = S.data[areaId]; if (!d) return;
        d.buildings.forEach(function (b) { if (b.lat != null) pts.push([b.lat, b.lng]); });
        var g = S.geo[areaId]; if (g && g.features) g.features.forEach(function (f) { geomToLatLngs(f.geometry).forEach(function (r) { (Array.isArray(r[0][0]) ? r[0] : r).forEach(function (p) { pts.push(p); }); }); });
      });
      if (!pts.length) throw new Error('位置のわかる建物がありません。');
      var la = pts.map(function (p) { return p[0]; }), lo = pts.map(function (p) { return p[1]; }), pad = 0.0015;
      var s = Math.min.apply(null, la) - pad, n = Math.max.apply(null, la) + pad, w = Math.min.apply(null, lo) - pad, e = Math.max.apply(null, lo) + pad, urls = [], z, seen = {};
      for (z = 14; z <= 18; z++) {
        var x0 = lonToX(w, z), x1 = lonToX(e, z), y0 = latToY(n, z), y1 = latToY(s, z), cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        if (urls.length + cnt > cap) break;
        for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) urls.push('https://cyberjapandata.gsi.go.jp/xyz/std/' + z + '/' + x + '/' + y + '.png');
      }
      S.tile[key].total = urls.length; renderHome();
      return caches.open('tiles-v1').then(function (cache) {
        var i = 0, ok = 0;
        function next() { if (i >= urls.length) return Promise.resolve(); var u = urls[i++]; return fetch(u, { mode: 'no-cors' }).then(function (r) { return cache.put(u, r); }).then(function () { ok++; }, function () {}).then(function () { S.tile[key].n++; tileRender(); }).then(next); }
        return Promise.all([next(), next(), next(), next()]).then(function () { if (ok >= urls.length * 0.95) { tileMark(key); areaIds.forEach(tileMark); toast('地図を保存しました。圏外でも見られます。', 3500); } else toast('地図を ' + ok + '/' + urls.length + ' 枚保存しました。もう一度押すと、残りを保存できます。', 5000); });
      });
    }).then(function () { delete S.tile[key]; renderHome(); }, function (e) { delete S.tile[key]; renderHome(); toast(e.message, 5000); });
  }

  // ---------- クリック操作の集約 ----------
  function onClick(ev) {
    var t = ev.target; while (t && t !== document && !(t.getAttribute && t.getAttribute('data-act'))) t = t.parentNode;
    if (!t || t === document) return;
    var act = t.getAttribute('data-act'), v = t.getAttribute('data-v');
    switch (act) {
      case 'login': doLogin(); break;
      case 'logout': logout(); break;
      case 'nav':
        var wasAdmin = !$('#admin').classList.contains('hidden'), curOn = document.querySelector('#nav button.on');
        if (wasAdmin) refreshBootstrap(); // 管理画面で変えたこと(使用開始など)を、区域メニューにすぐ反映する
        $('#admin').classList.add('hidden'); // 管理画面が開いていたら閉じてから、選んだ画面へ移る
        if (document.documentElement.getAttribute('data-ui') !== '3' && v !== 'map' && curOn && curOn.getAttribute('data-v') === v && !(v === 'admin' && !wasAdmin)) { closePanels(); break; } // 開いているタブをもう一度押すと閉じる(旧GASと同じ)
        if (v === 'map') closePanels(); else if (v === 'areas') goHome(); else if (v === 'settings') openMenu('prefs'); else if (v === 'report') openMenu('report');
        else if (v === 'admin' && SADO.openAdmin) { closePanels(); activeNav('admin'); SADO.openAdmin('admin'); }
        else if (v === 'editmenu' && SADO.openAdmin) { closePanels(); activeNav('editmenu'); SADO.openAdmin('edit'); }
        break;
      case 'navClose': closePanels(); break;
      case 'menuHome': $('#admin').classList.add('hidden'); closeSheet(true); $('#home').classList.add('hidden'); openMenu('home'); break;
      case 'searchToggle': document.body.classList.toggle('search-open'); if (document.body.classList.contains('search-open')) { var hq = $('#hdrQ'); if (hq) hq.focus(); } break;
      case 'menuTab': SADO.menuTab = v; renderMenu(); break;
      case 'homeCat': S.homeCat = v; S.homeParent = null; S.homeQ = ''; renderHome(); break;
      case 'homeBack': S.homeCat = null; S.homeParent = null; renderHome(); break;
      case 'homeTab': S.homeTab = v; S.homeCat = null; S.homeParent = null; renderHome(); break;
      case 'homeToggle': S.homeOpen = S.homeOpen || {}; S.homeOpen[(S.homeTab || '') + v] = !S.homeOpen[(S.homeTab || '') + v]; renderHome(); break;
      case 'openParent': selectParent(v); break;
      case 'syncNow':
        if (!S.online) { toast('今はオフラインです。' + (S.pending ? '未送信の ' + S.pending + ' 件は端末に残っていて、電波がつながると自動で送信されます。' : '電波のあるところで、もう一度押してください。'), 4500); break; }
        if (!S.token) { toast('ログインしてください。'); break; }
        if (S.syncBusy) break; S.syncBusy = true; toast('同期しています…', 6000);
        var sdone = function (m) { S.syncBusy = false; countPending(); toast(m, 3000); };
        flush().then(function () { return refreshBootstrap(); }).then(function () { return S.cur ? loadAreaData(S.cur, true).then(function () { if (SADO.drawBuildings) SADO.drawBuildings(); }, function () {}) : null; }).then(function () { sdone(S.pending ? 'まだ ' + S.pending + ' 件が送れていません。' : '同期しました。'); }, function (e) { sdone('同期できませんでした: ' + ((e && e.message) || '')); });
        break;
      case 'progReload': if (S.progBusy) break; S.progAt = 0; S.progBusy = true; renderHome(); var t0 = Date.now(), fin = function () { setTimeout(function () { S.progBusy = false; renderHome(); toast(S.online ? '最新にしました。' : '電波がないため、更新できません。'); }, Math.max(0, 600 - (Date.now() - t0))); }; Promise.all([refreshBootstrap(), loadProg(true)]).then(fin, fin); break; // 区域の一覧も、いっしょに最新にする
      case 'toggleOnly': S.onlyUse = !S.onlyUse; renderHome(); break;
      case 'homeParent': S.homeParent = v; renderHome(); break;
      case 'homeParentBack': S.homeParent = null; renderHome(); break;
      case 'pickArea': selectArea(v); break;
      case 'locate': if (t.id !== 'locBtn') locate(); break; // 右上の◎はコンパス部品が処理する(二重に動かさない)
      case 'clearArea': if (S.edit) { toast('編集モードを終了してから戻ってください。'); break; } clearArea(); break;
      case 'closeSheet': closeSheet(); break;
      case 'setStatus': setStatusUi(t.getAttribute('data-room'), v); break;
      case 'saveDraft': saveDraft(); break;
      case 'route': routeToBuilding(); break;
      case 'sheetRefresh': sheetRefresh(false); break;
      case 'setMark': var r = roomById(t.getAttribute('data-room')); patchRoom(t.getAttribute('data-room'), { mark: r && r.mark === v ? '' : v }); break;
      case 'report':
        var text = window.prompt('区域係への報告(内容)を入力してください'); if (text && text.trim()) { var bn = S.data[S.cur].buildings.filter(function (x) { return x.buildingId === S.sheetBid; })[0]; enqueue({ type: 'report', areaId: (bn && bn.areaId) || S.cur, buildingId: S.sheetBid, roomName: bn ? bn.buildingName : '', text: text.trim(), label: '報告' }); toast('報告を保存しました。'); }
        break;
      case 'prefFont': setPref('font', v); renderMenuBody(); if (S.cur && SADO.drawBuildings) SADO.drawBuildings(); break;
      case 'prefHouse': setPref('houseTap', v); renderMenuBody(); if (S.cur && SADO.drawBuildings) SADO.drawBuildings(); break;
      case 'rpCat': R.cat = v; R.area = ''; R.bld = ''; renderMenuBody(); break;
      case 'rpClear': R = { cat: '', area: '', bld: '', place: '', text: '' }; renderMenuBody(); break;
      case 'rpSend': rpSend(); break;
      case 'clearCache': clearCache(); break;
      case 'prefUi': setPref('ui', v); renderMenuBody(); break;
      case 'prefTheme': setPref('theme', v); renderMenuBody(); break;
      case 'hdrPick': $('#hdrQ').value = ''; hdrSearch(); var pk = areaById(v); if (pk && pk.isParent) selectParent(v); else selectArea(v); break;
      case 'layerToggle': openLayerPicker(); break;
      case 'layerPick': S.tileOverride = v; var lmd = document.getElementById('modal'); if (lmd) lmd.parentNode.removeChild(lmd); var tdn = tileDef(v); if (tileLayer && tileLayer.setUrl) { tileLayer.setUrl(tdn.url); } break;
      case 'areaExp': S.areaOpen = S.areaOpen || {}; S.areaOpen[v] = !S.areaOpen[v]; if (S.areaOpen[v] && !S.data[v]) { loadAreaData(v, true).then(function () { renderHome(); }, function (e) { toast(e.message, 4000); S.areaOpen[v] = false; }); } else renderHome(); break;
      case 'pickBuilding': selectArea(t.getAttribute('data-a'), v); break;
      case 'helpTab': SADO.helpTab = v; drawHelp(); break;
      case 'helpOpen': SADO.helpTab = 'basic'; $('#helpWin').classList.remove('hidden'); drawHelp(); break;
      case 'helpClose': $('#helpWin').classList.add('hidden'); break;
      case 'prefInput': setPref('input', v); applySettings(); renderSheet(); renderMenuBody(); break;
      case 'copyUrl': copyText(shareUrl()); break;
      case 'shareUrl': try { navigator.share({ title: (S.settings && S.settings.appTitle) || document.title, url: shareUrl() }); } catch (e) { copyText(shareUrl()); } break;
      case 'changePw': api('changeMyPassword', { oldPassword: $('#pwOld').value, newPassword: $('#pwNew').value }).then(function () { toast('パスワードを変更しました。'); $('#pwOld').value = ''; $('#pwNew').value = ''; }, function (e) { toast(e.message); }); break;
      case 'syncNow': flush().then(function () { return countPending(); }).then(function () { toast(S.pending ? '送信できなかった分が残っています。' : '送信しました。'); renderMenuBody(); }); break;
      case 'saveTiles': saveTiles([v]); break;
      case 'saveTilesParent': saveTiles(visibleAreas().filter(function (a) { return a.parentId === v; }).map(function (a) { return a.areaId; }), true, v); break;
      case 'cloudPick': (function () {
        var m = document.getElementById('modal'); if (m) m.parentNode.removeChild(m);
        var nm = (S.areas.filter(function (x) { return x.areaId === v; })[0] || {}).areaName || '', done = tileDone()[v];
        m = document.createElement('div'); m.id = 'modal';
        m.innerHTML = '<div class="mb"><h3>' + esc(nm) + '</h3><div class="cloudopts">' +
          '<button class="btn primary" data-act="saveTiles" data-v="' + esc(v) + '">オフラインでも使用' + (done ? '(保存済み・更新)' : '') + '</button>' +
          '<button class="btn primary" data-act="dlFile" data-v="' + esc(v) + '" data-t="pdf">PDFをダウンロード</button>' +
          '<button class="btn primary" data-act="dlFile" data-v="' + esc(v) + '" data-t="png">画像をダウンロード</button>' +
          '<button class="btn" id="dlNo">キャンセル</button></div><div class="note">PDF・画像のダウンロードは、電波が必要です。</div></div>';
        document.body.appendChild(m);
        var cl = function () { if (m.parentNode) m.parentNode.removeChild(m); };
        m.querySelector('#dlNo').onclick = cl; m.addEventListener('click', function (e) { var t2 = e.target; if (t2 === m || (t2.getAttribute && /^(saveTiles|dlFile)$/.test(t2.getAttribute('data-act') || ''))) setTimeout(cl, 0); });
      })(); break;
      case 'dlPick': (function () {
        var m = document.getElementById('modal'); if (m) m.parentNode.removeChild(m);
        var nm = (S.areas.filter(function (x) { return x.areaId === v; })[0] || {}).areaName || '';
        m = document.createElement('div'); m.id = 'modal';
        m.innerHTML = '<div class="mb"><h3>印刷用の地図</h3><div class="note">「' + esc(nm) + '」をダウンロードします。形式を選んでください(電波が必要です)。</div><div class="fxact"><button class="btn" id="dlNo">キャンセル</button><button class="btn primary" data-act="dlFile" data-v="' + esc(v) + '" data-t="pdf">PDF</button><button class="btn primary" data-act="dlFile" data-v="' + esc(v) + '" data-t="png">PNG</button></div></div>';
        document.body.appendChild(m);
        var cl = function () { if (m.parentNode) m.parentNode.removeChild(m); };
        m.querySelector('#dlNo').onclick = cl; m.addEventListener('click', function (e) { if (e.target === m || e.target.getAttribute('data-act') === 'dlFile') setTimeout(cl, 0); });
      })(); break;
      case 'dlFile':
        toast('ダウンロード中…', 2000);
        api('downloadAreaFile', { areaId: v, fileType: t.getAttribute('data-t') }).then(function (r) { SADO.saveBlob(b64Blob(r.base64, r.mime), r.name); }, function (e) { toast(e.message, 5000); });
        break;
      default: if (SADO.onAdminClick) SADO.onAdminClick(act, t, v); if (SADO.onEditClick) SADO.onEditClick(act, t, v);
    }
  }
  // メモと建物名は、入力欄から離れたときに保存する
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.classList && t.classList.contains('memo')) patchRoom(t.getAttribute('data-room'), { memo: t.value });
    else if (t.classList && t.classList.contains('rstatus')) setStatusUi(t.getAttribute('data-room'), t.value);
    else if (t.id === 'rpArea') { R.area = t.value; R.bld = ''; renderMenuBody(); if (R.area && !S.data[R.area]) loadAreaData(R.area).then(function () { if (R.area === t.value) renderMenuBody(); }, function () {}); }
    else if (t.id === 'rpBld') R.bld = t.value;
    else if (t.id === 'rpPlace') R.place = t.value;
    else if (t.id === 'rpText') R.text = t.value;
    else if (t.id === 'bName') { if (t.value.trim()) patchBuilding(S.sheetBid, { buildingName: t.value.trim() }); }
    else if (t.id === 'bMemo') patchBuilding(S.sheetBid, { buildingMemo: t.value });
  });
  document.addEventListener('input', function (ev) { if (ev.target.id === 'hdrQ') hdrSearch(); else if (ev.target.id === 'rpText') { R.text = ev.target.value; var c = $('#rpCnt'); if (c) c.textContent = R.text.length + '文字'; } });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target && (ev.target.id === 'loginPw' || ev.target.id === 'loginId')) doLogin(); });

  SADO.goHome = goHome; SADO.selectArea = selectArea; SADO.openBuilding = openBuilding; SADO.refreshBootstrap = refreshBootstrap; SADO.renderMenu = renderMenu;
  SADO.toast = toast; SADO.openMenu = openMenu;
  SADO.selectArea = selectArea; SADO.canEditMode = canEditMode; SADO.isMaint = isMaint; SADO.S = S; SADO.api = api; SADO.drawFrames = drawFrames; SADO.refreshBootstrap = refreshBootstrap; SADO.drawBuildings = drawBuildings; SADO.renderSheet = renderSheet; SADO.closeSheet = function () { closeSheet(true); }; SADO.areaById = areaById;
  SADO.reloadCur = function () { if (!S.cur) return Promise.resolve(); return (S.merged ? selectParent(S.cur, true) : loadAreaData(S.cur, true)).then(function () { drawBuildings(false); renderSheet(); }); };
  boot();
})();
