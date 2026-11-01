/* 佐渡住宅GAS: 画面の中心部分。iOS12のSafariでも動くよう、古い書き方(optional chainingなし)で書いている */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var S = { token: null, user: null, settings: null, areas: [], data: {}, geo: {}, frames: null, cur: null, online: navigator.onLine !== false, pending: 0, pub: null, mapReady: false, sheetBid: null };
  var map, tileLayer, frameLayer, bLayer, posMarker, watchId = null, bShapes = {};
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
  function api(action, params) {
    if (!CFG.apiUrl) return Promise.reject(Object.assign(new Error('config.js に GAS のURL(apiUrl)が設定されていません。'), { server: true }));
    var body = { action: action, token: S.token };
    for (var k in (params || {})) body[k] = params[k];
    return fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { var e = new Error(j.error); e.server = true; if (j.error === 'SESSION_EXPIRED') { e.expired = true; } throw e; }
        setOnline(true); return j.data;
      }, function (err) { setOnline(false); throw err; });
  }
  SADO.api = api;
  function setOnline(v) { if (S.online !== v) { S.online = v; updateBadge(); if (v) flush(); } }
  var toastTimer;
  function toast(msg, ms) { var t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500); }
  SADO.toast = toast;
  function today() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  SADO.today = today;

  // ---------- 起動 ----------
  function applyPrefs(p) {
    p = p || {};
    document.documentElement.setAttribute('data-font', p.font || '3');
    var th = p.theme || 'auto', dark = th === 'dark' || (th === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  function getPrefs() { try { return JSON.parse(localStorage.getItem('sado-prefs') || '{}'); } catch (e) { return {}; } }
  function setPref(k, v) { var p = getPrefs(); p[k] = v; try { localStorage.setItem('sado-prefs', JSON.stringify(p)); } catch (e) {} applyPrefs(p); }

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
        if (r[1]) { S.settings = r[1].settings; S.areas = r[1].areas; }
        enterApp();
      } else showLogin();
    })['catch'](function (e) { $('#boot').textContent = '起動に失敗しました: ' + e.message; });
  }

  function showLogin() {
    $('#boot').classList.add('hidden'); $('#appScreen').classList.add('hidden'); $('#loginScreen').classList.remove('hidden');
    var apply = function (pub) {
      S.pub = pub; $('#loginTitle').textContent = pub.appTitle || '佐渡住宅GAS';
      $('#memberPanel').classList.toggle('hidden', !pub.loginRequired); $('#guestPanel').classList.toggle('hidden', pub.loginRequired);
      $('#guestGroup').innerHTML = '<option value="">（選択しない）</option>' + (pub.groups || []).map(function (g) { return '<option value="' + esc(g.groupId) + '">' + esc(g.groupName) + '</option>'; }).join('');
      var last = getPrefs(); if (last.guestName) $('#guestName').value = last.guestName; if (last.guestGroup) $('#guestGroup').value = last.guestGroup;
      $('#loginNote').textContent = pub.loginRequired ? '' : 'お名前とグループを選んではじめます。';
    };
    api('getPublicInfo').then(function (pub) { idb.set('kv', 'pub', pub); apply(pub); }, function (e) {
      if (S.pub) apply(S.pub); else $('#loginMsg').textContent = e.server ? e.message : '最初の1回は、電波のあるところで開いてください。';
    });
  }
  function afterLogin(r) {
    S.token = r.token; S.user = r.user;
    return idb.set('kv', 'session', { token: r.token, user: r.user }).then(function () { $('#loginScreen').classList.add('hidden'); enterApp(); });
  }
  function doLogin() {
    $('#loginMsg').textContent = '';
    api('login', { loginId: $('#loginId').value, password: $('#loginPw').value }).then(afterLogin, function (e) { $('#loginMsg').textContent = e.message; });
  }
  function doGuest() {
    $('#loginMsg').textContent = '';
    var name = $('#guestName').value.trim(), gid = $('#guestGroup').value;
    setPref('guestName', name); setPref('guestGroup', gid);
    api('guestLogin', { name: name, groupId: gid }).then(afterLogin, function (e) { $('#loginMsg').textContent = e.message; });
  }
  function logout() {
    var go = function () { S.token = null; S.user = null; S.cur = null; idb.del('kv', 'session').then(function () { location.reload(); }); };
    if (S.online) api('logout').then(go, go); else go();
  }

  function enterApp() {
    $('#boot').classList.add('hidden'); $('#loginScreen').classList.add('hidden'); $('#appScreen').classList.remove('hidden');
    $('#hdrTitle').textContent = (S.settings && S.settings.appTitle) || '佐渡住宅GAS';
    initMap(); renderLegend();
    refreshBootstrap(); countPending();
    loadFrames();
  }
  function refreshBootstrap() {
    return api('getBootstrap').then(function (b) {
      S.settings = b.settings; S.areas = b.areas; S.user = b.user;
      idb.set('kv', 'bootstrap', { settings: b.settings, areas: b.areas });
      $('#hdrTitle').textContent = b.settings.appTitle || '佐渡住宅GAS';
      renderLegend(); drawFrames();
      if (S.cur) { var a = areaById(S.cur); if (a && S.data[S.cur]) { S.data[S.cur].area = a; drawBuildings(); renderSheet(); } }
      if (!$('#menu').classList.contains('hidden') && SADO.menuTab === 'areas') renderMenuBody();
    }, function (e) { if (e.expired) sessionExpired(); });
  }
  function sessionExpired() { toast('ログインの有効期限が切れました。未送信の記録は端末に残っています。'); S.token = null; idb.del('kv', 'session').then(function () { showLogin(); }); }
  function areaById(id) { for (var i = 0; i < S.areas.length; i++) if (S.areas[i].areaId === id) return S.areas[i]; return null; }
  function statusList() { return (S.settings && S.settings.statusList) || [{ id: 'unvisited', label: '未訪問', visited: false, done: false }, { id: 'met', label: '会えた', visited: true, done: true }]; }
  function statusOf(id) { var l = statusList(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return l[0]; }

  // ---------- 地図 ----------
  function tileDef(src) {
    return src === 'osm'
      ? { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' } }
      : { url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', opt: { maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>' } };
  }
  function initMap() {
    if (S.mapReady) return;
    if (!window.L) { toast('地図ライブラリ(lib/leaflet.js)が見つかりません。'); return; }
    S.mapReady = true;
    var st = S.settings || {};
    map = L.map('map', { zoomControl: false, attributionControl: true, tap: false }).setView([st.mapLat || 38.08, st.mapLng || 138.44], st.mapZoom || 13);
    var td = tileDef(st.mapTileSource); tileLayer = L.tileLayer(td.url, td.opt).addTo(map);
    frameLayer = L.layerGroup().addTo(map); bLayer = L.layerGroup().addTo(map);
    SADO.map = map;
  }
  function renderLegend() {
    var l = statusList();
    $('#legend').innerHTML = '<i style="background:#8a9592"></i>未訪問<i style="background:#2563eb"></i>途中<i style="background:#1f8a4c"></i>完了<i style="background:#fff;border:2px solid #c8372d"></i>拒否あり' + (l.length ? '' : '');
  }
  function loadFrames() {
    var show = function (g) { S.frames = g; drawFrames(); };
    if (S.frames) show(S.frames);
    fetch((CFG.geoBase || 'data/') + 'areas.geojson').then(function (r) { if (!r.ok) throw new Error('x'); return r.json(); }).then(function (g) { idb.set('kv', 'frames', g); show(g); })['catch'](function () {});
  }
  function ringToLatLngs(ring) { return ring.map(function (c) { return [c[1], c[0]]; }); }
  function geomToLatLngs(g) {
    if (!g) return [];
    if (g.type === 'Polygon') return g.coordinates.map(ringToLatLngs);
    if (g.type === 'MultiPolygon') return g.coordinates.map(function (p) { return p.map(ringToLatLngs); });
    return [];
  }
  function drawFrames() {
    if (!frameLayer) return; frameLayer.clearLayers();
    if (!S.frames || S.cur) return;
    S.frames.features.forEach(function (f) {
      var id = f.properties.areaId, a = areaById(id); if (!a) return;
      var color = a.inUse ? (a.assigned ? '#1f8a4c' : '#64748b') : '#0f766e';
      var poly = L.polygon(geomToLatLngs(f.geometry), { color: color, weight: 2, dashArray: a.inUse ? null : '6 4', fillOpacity: a.inUse ? 0.12 : 0.04 });
      poly.bindTooltip(a.areaName + (a.inUse ? '（使用中）' : ''), { permanent: true, direction: 'center', className: 'area-label' });
      poly.on('click', function () { selectArea(id); });
      frameLayer.addLayer(poly);
    });
  }

  // ---------- エリアの選択とデータの読み込み ----------
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
  function loadGeo(areaId) {
    if (S.geo[areaId]) return Promise.resolve(S.geo[areaId]);
    var fromIdb = function () { return idb.get('geo', areaId).then(function (g) { S.geo[areaId] = g || null; return g || null; }); };
    return fetch((CFG.geoBase || 'data/') + 'area_' + encodeURIComponent(areaId) + '.geojson').then(function (r) { if (!r.ok) throw new Error('x'); return r.json(); })
      .then(function (g) { S.geo[areaId] = g; idb.set('geo', areaId, g); return g; }, fromIdb);
  }
  function loadAreaData(areaId, force) {
    var local = function () { return idb.get('area', areaId).then(function (d) { if (!d) throw new Error('このエリアは、まだ端末に保存されていません。電波のあるところで一度開いてください。'); S.data[areaId] = d; }); };
    var p = (S.online || force) ? api('getAreaData', { areaId: areaId }).then(function (d) { S.data[areaId] = d; return idb.set('area', areaId, d); }, function (e) { if (e.server) throw e; return local(); }) : local();
    return p.then(function () { return applyQueue(areaId); }).then(function () { return loadGeo(areaId); });
  }
  function selectArea(areaId) {
    var a = areaById(areaId); toast((a ? a.areaName : '') + ' を読み込み中…', 1500);
    loadAreaData(areaId).then(function () {
      S.cur = areaId; closeSheet(); drawFrames(); drawBuildings(true); updateTitle(); closeMenu();
      var d = S.data[areaId]; if (d && d.area) { var i = S.areas.map(function (x) { return x.areaId; }).indexOf(areaId); if (i >= 0) S.areas[i] = d.area; }
      if (a && !a.canEdit) toast(a.inUse ? '「' + a.areaName + '」は担当外のため、見るだけです。' : '「' + a.areaName + '」は使用中ではないため、見るだけです。', 3500);
    })['catch'](function (e) { toast(e.message, 5000); });
  }
  function clearArea() { S.cur = null; closeSheet(); if (bLayer) bLayer.clearLayers(); drawFrames(); updateTitle(); }
  function updateTitle() { var a = S.cur && areaById(S.cur); $('#hdrTitle').textContent = a ? a.areaName + (a.canEdit ? '' : '（見るだけ）') : ((S.settings && S.settings.appTitle) || '佐渡住宅GAS'); }

  function roomsOf(areaId, bid) { var d = S.data[areaId]; return d ? d.rooms.filter(function (r) { return r.buildingId === bid; }).sort(function (a, b) { return a.sortOrder - b.sortOrder; }) : []; }
  function buildingStyle(areaId, b) {
    var rs = roomsOf(areaId, b.buildingId), n = rs.length, done = 0, visited = 0, rej = false, cau = false, a = areaById(areaId) || (S.data[areaId] && S.data[areaId].area) || {};
    rs.forEach(function (r) { var s = statusOf(r.status); if (s.done) done++; if (s.visited) visited++; if (r.mark === 'reject') rej = true; if (r.mark === 'caution') cau = true; });
    var fill = n && done === n ? '#1f8a4c' : (visited > 0 ? '#2563eb' : '#8a9592'), editable = a.canEdit !== false;
    return { color: rej ? '#c8372d' : (cau ? '#d97706' : fill), weight: rej || cau ? 3 : 1.5, fillColor: fill, fillOpacity: editable ? 0.6 : 0.3 };
  }
  function drawBuildings(fit) {
    if (!bLayer) return; bLayer.clearLayers(); bShapes = {};
    var d = S.data[S.cur]; if (!d) return;
    var geo = S.geo[S.cur], feat = {}, bounds = null;
    if (geo && geo.features) geo.features.forEach(function (f) { feat[f.properties.uuid2] = f; });
    d.buildings.forEach(function (b) {
      var f = feat[b.buildingId], shape = null, st = buildingStyle(S.cur, b);
      if (f) shape = L.polygon(geomToLatLngs(f.geometry), st);
      else if (b.lat != null && b.lng != null) { st.radius = 9; shape = L.circleMarker([b.lat, b.lng], st); }
      if (!shape) return;
      shape.on('click', function () { openBuilding(b.buildingId); });
      bLayer.addLayer(shape); bShapes[b.buildingId] = shape;
      var bb = shape.getBounds ? shape.getBounds() : L.latLngBounds([shape.getLatLng()]);
      if (!bounds) bounds = L.latLngBounds(bb.getSouthWest(), bb.getNorthEast()); else bounds.extend(bb);
    });
    if (fit && bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
  }
  function restyle(bid) { var d = S.data[S.cur], shape = bShapes[bid]; if (!d || !shape) return; var b = d.buildings.filter(function (x) { return x.buildingId === bid; })[0]; if (b) shape.setStyle(buildingStyle(S.cur, b)); }

  // ---------- 建物のシート(部屋ごとの記録) ----------
  function openBuilding(bid) { S.sheetBid = bid; renderSheet(); }
  function closeSheet() { S.sheetBid = null; $('#sheet').classList.add('hidden'); }
  function renderSheet() {
    var sh = $('#sheet'), d = S.data[S.cur];
    if (!S.sheetBid || !d) { sh.classList.add('hidden'); return; }
    var b = d.buildings.filter(function (x) { return x.buildingId === S.sheetBid; })[0]; if (!b) { sh.classList.add('hidden'); return; }
    var a = d.area, can = a.canEdit, rs = roomsOf(S.cur, b.buildingId), keep = sh.querySelector('.body') ? sh.querySelector('.body').scrollTop : 0;
    var h = '<div class="head"><div class="row"><div class="name grow">' + esc(b.buildingName) + '</div><button class="btn small" data-act="report">報告</button><button class="btn small" data-act="closeSheet">閉じる</button></div>';
    h += '<div class="note">' + esc(a.areaName) + (can ? '' : '　※見るだけ（' + (a.inUse ? '担当外' : '使用中ではありません') + '）') + '</div></div><div class="body">';
    if (can) h += '<div class="row"><input class="grow" id="bName" placeholder="建物の名前" value="' + esc(b.buildingName) + '"><input class="grow" id="bMemo" placeholder="建物のメモ" value="' + esc(b.buildingMemo) + '"></div>';
    else if (b.buildingMemo) h += '<div class="note">メモ: ' + esc(b.buildingMemo) + '</div>';
    rs.forEach(function (r) {
      h += '<div class="room" data-room="' + esc(r.roomId) + '"><div class="rn">' + esc(r.roomName) + (r.mark === 'reject' ? '<span class="badge rej">拒否</span>' : r.mark === 'caution' ? '<span class="badge cau">注意</span>' : '') + '</div><div>';
      statusList().forEach(function (s) { h += '<button class="chip s-' + esc(s.id) + (r.status === s.id ? ' on' : '') + (can ? '' : ' dis') + '" data-act="setStatus" data-room="' + esc(r.roomId) + '" data-v="' + esc(s.id) + '">' + esc(s.label) + '</button>'; });
      h += '</div><div>';
      [['reject', '拒否'], ['caution', '注意']].forEach(function (m) { h += '<button class="chip mark-' + m[0] + (r.mark === m[0] ? ' on' : '') + (can ? '' : ' dis') + '" data-act="setMark" data-room="' + esc(r.roomId) + '" data-v="' + m[0] + '">' + m[1] + '</button>'; });
      h += '</div>' + (can ? '<input class="memo" style="width:100%;margin-top:6px" data-room="' + esc(r.roomId) + '" placeholder="メモ" value="' + esc(r.memo) + '">' : (r.memo ? '<div class="note">メモ: ' + esc(r.memo) + '</div>' : ''));
      if (r.updatedAt) h += '<div class="note">更新: ' + esc(String(r.updatedAt).slice(0, 16).replace('T', ' ')) + (r.updatedBy ? ' ' + esc(r.updatedBy) : '') + '</div>';
      h += '</div>';
    });
    sh.innerHTML = h + '</div>'; sh.classList.remove('hidden'); if (keep) sh.querySelector('.body').scrollTop = keep;
  }
  function persistArea() { return idb.set('area', S.cur, S.data[S.cur]); }
  function roomById(id) { var d = S.data[S.cur]; for (var i = 0; i < d.rooms.length; i++) if (d.rooms[i].roomId === id) return d.rooms[i]; return null; }
  function patchRoom(roomId, patch) {
    var d = S.data[S.cur]; if (!d || !d.area.canEdit) { toast('この建物は編集できません。'); return; }
    var r = roomById(roomId); if (!r) return;
    var op = { type: 'status', areaId: S.cur, roomId: roomId, t: new Date().toISOString(), label: d.area.areaName + ' ' + r.roomName };
    for (var k in patch) op[k] = patch[k];
    if (op.status === undefined && op.memo === undefined && op.mark === undefined) return;
    if (op.status !== undefined && op.memo === undefined) op.memo = r.memo; // 状況だけ変えるときも、今のメモを一緒に送る
    applyOp(d, op); persistArea(); enqueue(op); restyle(r.buildingId); renderSheet();
  }
  function patchBuilding(bid, patch) {
    var d = S.data[S.cur]; if (!d || !d.area.canEdit) return;
    var op = { type: 'building', areaId: S.cur, buildingId: bid, label: d.area.areaName + ' 建物' };
    for (var k in patch) op[k] = patch[k];
    applyOp(d, op); persistArea(); enqueue(op);
  }

  // ---------- 未送信の記録と自動同期 ----------
  function enqueue(op) { return idb.add('queue', op).then(function () { return countPending(); }).then(flush); }
  function countPending() { return idb.all('queue').then(function (a) { S.pending = a.length; updateBadge(); return a.length; }); }
  function updateBadge() {
    var b = $('#syncBadge'); if (!b) return;
    b.className = ''; b.id = 'syncBadge';
    if (S.pending > 0) { b.textContent = (S.online ? '送信待ち ' : '未送信 ') + S.pending + '件'; b.classList.add('pend'); }
    else if (!S.online) { b.textContent = 'オフライン'; b.classList.add('off'); }
    else b.textContent = '同期済み';
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
          if (errs.length) { toast('送信できなかった記録があります:\n' + errs.slice(0, 3).join('\n'), 7000); if (S.cur) loadAreaData(S.cur, true).then(function () { drawBuildings(); renderSheet(); }); }
          return flush();
        });
      });
    })['catch'](function (e) { flushing = false; if (e && e.expired) sessionExpired(); });
  }
  SADO.flush = flush;

  // ---------- 現在地 ----------
  function locate() {
    if (!navigator.geolocation) { toast('この端末では現在地を取得できません。'); return; }
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; if (posMarker && map) { map.removeLayer(posMarker); posMarker = null; } toast('現在地の表示を止めました。'); return; }
    watchId = navigator.geolocation.watchPosition(function (p) {
      var ll = [p.coords.latitude, p.coords.longitude];
      if (!posMarker) { posMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map); map.setView(ll, Math.max(map.getZoom(), 17)); } else posMarker.setLatLng(ll);
    }, function () { toast('現在地を取得できませんでした。端末の位置情報の許可を確認してください。'); watchId = null; }, { enableHighAccuracy: true, maximumAge: 5000 });
  }

  // ---------- メニュー(エリア・設定・ダウンロード) ----------
  function openMenu(tab) { SADO.menuTab = tab || 'areas'; var m = $('#menu'); m.classList.remove('hidden'); renderMenu(); }
  function closeMenu() { $('#menu').classList.add('hidden'); }
  function renderMenu() {
    var tabs = [['areas', 'エリア'], ['dl', '印刷用'], ['prefs', '設定']];
    if (S.user && S.user.role === 'admin') tabs.push(['admin', '管理']);
    $('#menu').innerHTML = '<div class="mhead"><div class="t">' + esc((S.settings && S.settings.appTitle) || '') + '　<span class="note" style="color:inherit">' + esc(S.user ? S.user.displayName : '') + '</span></div><button data-act="closeMenu">✕</button></div><div class="tabs">' +
      tabs.map(function (t) { return '<button class="tab' + (SADO.menuTab === t[0] ? ' on' : '') + '" data-act="menuTab" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div class="mbody" id="menuBody"></div>';
    renderMenuBody();
  }
  function renderMenuBody() {
    var el = $('#menuBody'), t = SADO.menuTab; if (!el) return;
    if (t === 'areas') {
      var h = (S.cur ? '<button class="btn block" data-act="clearArea">エリアの選択をやめて、全体を見る</button>' : '');
      h += '<div style="height:8px"></div>';
      S.areas.forEach(function (a) {
        var saved = '';
        h += '<div class="card"><div class="row"><div class="grow"><b>' + esc(a.areaName) + '</b>' + (a.inUse ? '<span class="badge use">使用中</span>' : '<span class="badge off">未使用</span>') + (a.assigned && a.inUse ? '<span class="badge mine">担当</span>' : '') + (S.cur === a.areaId ? '<span class="badge use">表示中</span>' : '') + '<div class="note">' +
          (a.inUse ? esc(a.assigneeName) + '　' + esc(a.useStartDate) + ' 〜 ' + esc(a.expiry) : (a.lastDoneDate ? '前回完了 ' + esc(a.lastDoneDate) : '')) + '</div></div>' +
          '<button class="btn primary small" data-act="pickArea" data-v="' + esc(a.areaId) + '">開く</button><button class="btn small" data-act="saveTiles" data-v="' + esc(a.areaId) + '">地図を端末に保存</button></div></div>';
      });
      el.innerHTML = h || '<div class="note">エリアがありません。</div>';
    } else if (t === 'dl') {
      if (!S.settings || !S.settings.hasDownloads) { el.innerHTML = '<div class="card">印刷用の地図(PDF・PNG)は、まだ設定されていません。</div>'; return; }
      el.innerHTML = '<div class="note">エリアを選んで、ダウンロードします(電波が必要です)。</div>' + S.areas.map(function (a) {
        return '<div class="card"><div class="row"><div class="grow"><b>' + esc(a.areaName) + '</b></div><button class="btn small" data-act="dlFile" data-v="' + esc(a.areaId) + '" data-t="pdf">PDF</button><button class="btn small" data-act="dlFile" data-v="' + esc(a.areaId) + '" data-t="png">PNG</button></div></div>';
      }).join('');
    } else if (t === 'prefs') {
      var p = getPrefs();
      el.innerHTML = '<div class="card"><h3>文字の大きさ</h3><div class="row">' + [1, 2, 3, 4, 5, 6].map(function (n) { return '<button class="chip' + (String(p.font || '3') === String(n) ? ' on' : '') + '" style="' + (String(p.font || '3') === String(n) ? 'background:var(--primary)' : '') + '" data-act="prefFont" data-v="' + n + '">' + n + '</button>'; }).join('') + '</div></div>' +
        '<div class="card"><h3>画面の色</h3><div class="row">' + [['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']].map(function (x) { return '<button class="chip' + ((p.theme || 'auto') === x[0] ? ' on' : '') + '" style="' + ((p.theme || 'auto') === x[0] ? 'background:var(--primary)' : '') + '" data-act="prefTheme" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
        (S.user && S.user.role !== 'guest' ? '<div class="card"><h3>パスワードの変更</h3><div class="row"><input id="pwOld" type="password" placeholder="今のパスワード"><input id="pwNew" type="password" placeholder="新しいパスワード(6文字以上)"><button class="btn small" data-act="changePw">変更</button></div></div>' : '') +
        '<div class="card"><h3>端末の状態</h3><div class="note">未送信の記録: ' + S.pending + '件<br>通信: ' + (S.online ? 'オンライン' : 'オフライン') + '</div><button class="btn small" data-act="syncNow">今すぐ送信する</button></div>' +
        '<button class="btn danger block" data-act="logout">ログアウト</button>';
    } else if (t === 'admin') { closeMenu(); if (SADO.openAdmin) SADO.openAdmin(); }
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
  function saveTiles(areaId) {
    if (!window.caches) { toast('この端末では地図の保存ができません。'); return; }
    if (!S.online) { toast('電波のあるところで実行してください。'); return; }
    if (S.settings && S.settings.mapTileSource === 'osm') { toast('OpenStreetMapの公式サーバーは、事前保存が禁止されています。動作設定で地図を「地理院タイル」にしてください。', 6000); return; }
    loadAreaData(areaId).then(function () {
      var d = S.data[areaId], pts = [];
      d.buildings.forEach(function (b) { if (b.lat != null) pts.push([b.lat, b.lng]); });
      var g = S.geo[areaId]; if (g && g.features) g.features.forEach(function (f) { geomToLatLngs(f.geometry).forEach(function (r) { (Array.isArray(r[0][0]) ? r[0] : r).forEach(function (p) { pts.push(p); }); }); });
      if (!pts.length) throw new Error('このエリアには、位置のわかる建物がありません。');
      var la = pts.map(function (p) { return p[0]; }), lo = pts.map(function (p) { return p[1]; }), pad = 0.0015;
      var s = Math.min.apply(null, la) - pad, n = Math.max.apply(null, la) + pad, w = Math.min.apply(null, lo) - pad, e = Math.max.apply(null, lo) + pad, urls = [], z;
      for (z = 14; z <= 18; z++) {
        var x0 = lonToX(w, z), x1 = lonToX(e, z), y0 = latToY(n, z), y1 = latToY(s, z), cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        if (urls.length + cnt > 700) break;
        for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) urls.push('https://cyberjapandata.gsi.go.jp/xyz/std/' + z + '/' + x + '/' + y + '.png');
      }
      toast('地図を保存中… ' + urls.length + '枚', 4000);
      return caches.open('tiles-v1').then(function (cache) {
        var i = 0, ok = 0;
        function next() { if (i >= urls.length) return Promise.resolve(); var u = urls[i++]; return fetch(u, { mode: 'no-cors' }).then(function (r) { return cache.put(u, r); }).then(function () { ok++; }, function () {}).then(next); }
        return Promise.all([next(), next(), next(), next()]).then(function () { toast('地図を ' + ok + '/' + urls.length + ' 枚保存しました。', 4000); });
      });
    })['catch'](function (e) { toast(e.message, 5000); });
  }

  // ---------- クリック操作の集約 ----------
  function onClick(ev) {
    var t = ev.target; while (t && t !== document && !(t.getAttribute && t.getAttribute('data-act'))) t = t.parentNode;
    if (!t || t === document) return;
    var act = t.getAttribute('data-act'), v = t.getAttribute('data-v');
    switch (act) {
      case 'login': doLogin(); break;
      case 'guest': doGuest(); break;
      case 'showMember': $('#guestPanel').classList.add('hidden'); $('#memberPanel').classList.remove('hidden'); $('#loginMsg').textContent = ''; $('#loginId').focus(); break;
      case 'logout': logout(); break;
      case 'menu': openMenu('areas'); break;
      case 'closeMenu': closeMenu(); break;
      case 'menuTab': SADO.menuTab = v; renderMenu(); break;
      case 'areas': openMenu('areas'); break;
      case 'pickArea': selectArea(v); break;
      case 'clearArea': clearArea(); closeMenu(); break;
      case 'locate': locate(); break;
      case 'closeSheet': closeSheet(); break;
      case 'setStatus': patchRoom(t.getAttribute('data-room'), { status: v }); break;
      case 'setMark': var r = roomById(t.getAttribute('data-room')); patchRoom(t.getAttribute('data-room'), { mark: r && r.mark === v ? '' : v }); break;
      case 'report':
        var text = window.prompt('管理者への報告(内容)を入力してください'); if (text && text.trim()) { var bn = S.data[S.cur].buildings.filter(function (x) { return x.buildingId === S.sheetBid; })[0]; enqueue({ type: 'report', areaId: S.cur, buildingId: S.sheetBid, roomName: bn ? bn.buildingName : '', text: text.trim(), label: '報告' }); toast('報告を保存しました。'); }
        break;
      case 'prefFont': setPref('font', v); renderMenuBody(); break;
      case 'prefTheme': setPref('theme', v); renderMenuBody(); break;
      case 'changePw': api('changeMyPassword', { oldPassword: $('#pwOld').value, newPassword: $('#pwNew').value }).then(function () { toast('パスワードを変更しました。'); $('#pwOld').value = ''; $('#pwNew').value = ''; }, function (e) { toast(e.message); }); break;
      case 'syncNow': flush().then(function () { return countPending(); }).then(function () { toast(S.pending ? '送信できなかった分が残っています。' : '送信しました。'); renderMenuBody(); }); break;
      case 'saveTiles': saveTiles(v); break;
      case 'dlFile':
        toast('ダウンロード中…', 2000);
        api('downloadAreaFile', { areaId: v, fileType: t.getAttribute('data-t') }).then(function (r) { SADO.saveBlob(b64Blob(r.base64, r.mime), r.name); }, function (e) { toast(e.message, 5000); });
        break;
      default: if (SADO.onAdminClick) SADO.onAdminClick(act, t, v);
    }
  }
  // メモと建物名は、入力欄から離れたときに保存する
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.classList && t.classList.contains('memo')) patchRoom(t.getAttribute('data-room'), { memo: t.value });
    else if (t.id === 'bName') { if (t.value.trim()) patchBuilding(S.sheetBid, { buildingName: t.value.trim() }); }
    else if (t.id === 'bMemo') patchBuilding(S.sheetBid, { buildingMemo: t.value });
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target && (ev.target.id === 'loginPw' || ev.target.id === 'loginId')) doLogin(); });

  SADO.selectArea = selectArea; SADO.openBuilding = openBuilding; SADO.refreshBootstrap = refreshBootstrap; SADO.renderMenu = renderMenu;
  SADO.toast = toast; SADO.openMenu = openMenu;
  boot();
})();
