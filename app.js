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
    $('#boot').classList.add('hidden'); $('#appScreen').classList.add('hidden'); $('#nav').classList.add('hidden'); $('#home').classList.add('hidden'); $('#menu').classList.add('hidden'); $('#loginScreen').classList.remove('hidden');
    var apply = function (pub) { S.pub = pub; $('#loginTitle').textContent = pub.appTitle || '佐渡住宅GAS'; $('#loginNote').textContent = ''; };
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
  function logout() {
    var go = function () { S.token = null; S.user = null; S.cur = null; idb.del('kv', 'session').then(function () { location.reload(); }); };
    if (S.online) api('logout').then(go, go); else go();
  }

  function enterApp() {
    $('#boot').classList.add('hidden'); $('#loginScreen').classList.add('hidden'); $('#appScreen').classList.remove('hidden'); $('#nav').classList.remove('hidden');
    $('#hdrTitle').textContent = (S.settings && S.settings.appTitle) || '佐渡住宅GAS';
    initMap(); renderLegend(); $('#navAdmin').classList.toggle('hidden', !isAdmin()); if (SADO.onEnter) SADO.onEnter(isAdmin());
    refreshBootstrap(); countPending();
    loadFrames(); goHome();
  }
  function refreshBootstrap() {
    return api('getBootstrap').then(function (b) {
      S.settings = b.settings; S.areas = b.areas; S.user = b.user;
      idb.set('kv', 'bootstrap', { settings: b.settings, areas: b.areas });
      $('#hdrTitle').textContent = b.settings.appTitle || '佐渡住宅GAS';
      renderLegend(); drawFrames(); $('#navAdmin').classList.toggle('hidden', !isAdmin());
      if (S.cur) { var a = areaById(S.cur); if (a && S.data[S.cur]) { S.data[S.cur].area = a; drawBuildings(); renderSheet(); } }
      if (!$('#home').classList.contains('hidden')) renderHome();
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
    $('#legend').innerHTML = '<b><i style="background:#1a73e8"></i>未訪問</b><b><i style="background:#ef6c00"></i>途中</b><b><i style="background:#188038"></i>完了</b><b><i style="background:#9aa0a6"></i>編集不可</b><b><i style="background:#fff;border:2px solid #b91c1c"></i>拒否あり</b>';
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
  // 区域の枠: 区域に境界線が保存されていれば(アプリで描いた・直した枠)それを優先し、なければ data/areas.geojson の枠を使う
  var bdCache = {};
  function frameFeatures() {
    var over = {}, out = [];
    S.areas.forEach(function (a) {
      if (!a.boundary) return;
      if (!bdCache[a.areaId] || bdCache[a.areaId].s !== a.boundary) { var g = null; try { g = JSON.parse(a.boundary); } catch (e) {} bdCache[a.areaId] = { s: a.boundary, g: g }; }
      if (bdCache[a.areaId].g) over[a.areaId] = bdCache[a.areaId].g;
    });
    ((S.frames && S.frames.features) || []).forEach(function (f) { if (!over[f.properties.areaId]) out.push({ areaId: f.properties.areaId, geometry: f.geometry }); });
    Object.keys(over).forEach(function (id) { out.push({ areaId: id, geometry: over[id] }); });
    return out;
  }
  SADO.frameFeatures = frameFeatures;
  function drawFrames() {
    if (!frameLayer) return; frameLayer.clearLayers();
    if (S.cur && !S.edit) return;
    frameFeatures().forEach(function (f) {
      var id = f.areaId, a = areaById(id); if (!a || visibleAreas().indexOf(a) < 0) return;
      if (S.edit) { if (SADO.hideFrame && SADO.hideFrame(id)) return; frameLayer.addLayer(L.polygon(geomToLatLngs(f.geometry), { color: '#ef6c00', weight: 2, dashArray: '2 5', fill: false, interactive: false })); return; }
      var color = a.inUse ? (a.assigned ? '#188038' : '#80868b') : '#1a73e8';
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
  function loadAreaData(areaId, force) {
    var local = function () { return idb.get('area', areaId).then(function (d) { if (!d) throw new Error('このエリアは、まだ端末に保存されていません。電波のあるところで一度開いてください。'); S.data[areaId] = d; }); };
    var p = (S.online || force) ? api('getAreaData', { areaId: areaId }).then(function (d) { S.data[areaId] = d; return idb.set('area', areaId, d); }, function (e) { if (e.server) throw e; return local(); }) : local();
    return p.then(function () { return applyQueue(areaId); }).then(function () { return loadGeo(areaId); });
  }
  function selectArea(areaId) {
    var a = areaById(areaId); toast((a ? a.areaName : '') + ' を読み込み中…', 1500);
    loadAreaData(areaId).then(function () {
      if (SADO.onAreaChange) SADO.onAreaChange();
      S.cur = areaId; closeSheet(); drawFrames(); drawBuildings(true); updateTitle(); closePanels();
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
    var editable = a.canEdit !== false, fill = !editable ? '#9aa0a6' : (n && done === n ? '#188038' : (visited > 0 ? '#ef6c00' : '#1a73e8'));
    return { color: rej ? '#b91c1c' : (cau ? '#ca8a04' : fill), weight: rej || cau ? 3 : 1.5, fillColor: fill, fillOpacity: 0.6 };
  }
  function drawBuildings(fit) {
    if (!bLayer) return; bLayer.clearLayers(); bShapes = {};
    var d = S.data[S.cur]; if (!d) return;
    var geo = S.geo[S.cur], feat = {}, bounds = null;
    if (geo && geo.features) geo.features.forEach(function (f) { feat[f.properties.uuid2] = f; });
    d.buildings.forEach(function (b) {
      var f = feat[b.buildingId], shape = null, st = buildingStyle(S.cur, b);
      if (f) shape = L.polygon(geomToLatLngs(f.geometry), st);
      else if (b.lat != null && b.lng != null) { if (S.edit && SADO.editMarker) shape = SADO.editMarker(b); else { st.radius = 9; shape = L.circleMarker([b.lat, b.lng], st); } }
      if (!shape) return;
      shape.on('click', function () { openBuilding(b.buildingId); });
      bLayer.addLayer(shape); bShapes[b.buildingId] = shape;
      var bb = shape.getBounds ? shape.getBounds() : L.latLngBounds([shape.getLatLng()]);
      if (!bounds) bounds = L.latLngBounds(bb.getSouthWest(), bb.getNorthEast()); else bounds.extend(bb);
    });
    if (fit && bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
  }
  function restyle(bid) { var d = S.data[S.cur], shape = bShapes[bid]; if (!d || !shape) return; var b = d.buildings.filter(function (x) { return x.buildingId === bid; })[0]; if (b && shape.setStyle) shape.setStyle(buildingStyle(S.cur, b)); }

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
    var ed = !!(S.edit && S.user && S.user.role === 'admin');
    if (ed) h += '<div class="row"><input class="grow" id="bName" placeholder="建物の名前" value="' + esc(b.buildingName) + '"><input class="grow" id="bMemo" placeholder="建物のメモ" value="' + esc(b.buildingMemo) + '"></div>';
    else if (b.buildingMemo) h += '<div class="note">メモ: ' + esc(b.buildingMemo) + '</div>';
    rs.forEach(function (r) {
      h += '<div class="room st-' + esc(r.status) + '" data-room="' + esc(r.roomId) + '"><div class="rn">' + esc(r.roomName) + (r.mark === 'reject' ? '<span class="badge rej">拒否</span>' : r.mark === 'caution' ? '<span class="badge cau">注意</span>' : '') + (ed ? '<button class="btn small danger" style="float:right" data-act="ed:delRoom" data-v="' + esc(r.roomId) + '">削除</button>' : '') + '</div><div>';
      statusList().forEach(function (s) { h += '<button class="chip s-' + esc(s.id) + (r.status === s.id ? ' on' : '') + (can ? '' : ' dis') + '" data-act="setStatus" data-room="' + esc(r.roomId) + '" data-v="' + esc(s.id) + '">' + esc(s.label) + '</button>'; });
      h += '</div><div>';
      [['reject', '拒否'], ['caution', '注意']].forEach(function (m) { h += '<button class="chip mark-' + m[0] + (r.mark === m[0] ? ' on' : '') + (can ? '' : ' dis') + '" data-act="setMark" data-room="' + esc(r.roomId) + '" data-v="' + m[0] + '">' + m[1] + '</button>'; });
      h += '</div>' + (can ? '<input class="memo" style="width:100%;margin-top:6px" data-room="' + esc(r.roomId) + '" placeholder="メモ" value="' + esc(r.memo) + '">' : (r.memo ? '<div class="note">メモ: ' + esc(r.memo) + '</div>' : ''));
      if (r.updatedAt) h += '<div class="note">更新: ' + esc(String(r.updatedAt).slice(0, 16).replace('T', ' ')) + (r.updatedBy ? ' ' + esc(r.updatedBy) : '') + '</div>';
      h += '</div>';
    });
    if (ed && SADO.sheetTools) h += SADO.sheetTools(b);
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
    var d = S.data[S.cur]; if (!d || !S.user || S.user.role !== 'admin') return; // 建物の名前・メモは区域係のみ
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

  // ---------- ホーム(国仲・遠方を選び、区域の一覧から地図へ) ----------
  var CATS = [['国仲', '国仲'], ['遠方', '遠方']];
  function isAdmin() { return !!(S.user && S.user.role === 'admin'); }
  function roleLabel() { return isAdmin() ? '区域係' : '奉仕者'; }
  function inCat(a, cat) { return (a.category || '国仲') === cat; }
  // 区域係はすべて。奉仕者は、自分か所属グループ(会衆を含む)が担当の区域
  function visibleAreas() {
    return S.areas.filter(function (a) { return !a.isParent && (isAdmin() || a.mine); }); // 親区域(大きなエリア)は、まとめ用なので、地図で開く対象には入れない
  }
  function catAreas(cat) { return visibleAreas().filter(function (a) { return inCat(a, cat); }); }
  function activeNav(v) { var bs = document.querySelectorAll('#nav button'); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-v') === v); }
  function closePanels() { $('#home').classList.add('hidden'); $('#menu').classList.add('hidden'); activeNav('map'); }
  SADO.activeNav = activeNav;
  function goHome() {
    S.homeCat = null; S.homeParent = null; closeSheet(); $('#menu').classList.add('hidden'); $('#home').classList.remove('hidden'); activeNav('areas'); renderHome();
  }
  // ---------- 大きなエリア(親区域)→ 小さなエリア(子区域) ----------
  function hasParents() { return S.areas.some(function (a) { return a.isParent; }); }
  function parentsOf(cat) {
    var kids = catAreas(cat), by = {};
    kids.forEach(function (k) { if (k.parentId) (by[k.parentId] = by[k.parentId] || []).push(k); });
    var out = S.areas.filter(function (p) { return p.isParent && inCat(p, cat) && by[p.areaId]; });
    out.forEach(function (p) { p._kids = by[p.areaId]; });
    return out;
  }
  function parentRows(cat, q) {
    q = (q || '').replace(/[\s　]/g, '').toLowerCase();
    return parentsOf(cat).filter(function (p) { return !q || p.areaName.replace(/[\s　]/g, '').toLowerCase().indexOf(q) >= 0; }).map(function (p) {
      var use = p._kids.filter(function (k) { return k.inUse; }).length;
      return '<div class="card pcard" data-act="homeParent" data-v="' + esc(p.areaId) + '"><div class="row"><div class="grow"><b>' + esc(p.areaName) + '</b>' + (p.inUse ? '<span class="badge use">使用中</span>' : '') + '<div class="note">小さなエリア ' + p._kids.length + '件' + (use ? '(使用中 ' + use + '件)' : '') + (p.inUse ? '　' + esc(p.assigneeName) : '') + '</div></div><span class="chev">›</span></div></div>';
    }).join('') || '<div class="note" style="padding:12px 4px">該当するエリアがありません。</div>';
  }
  function parentListHtml(cat) {
    return '<div class="note">' + (isAdmin() ? 'すべての大きなエリアです。' : 'あなた、またはあなたのグループが担当のエリアです。') + '</div><input type="search" id="homeQ" class="homeq" placeholder="エリア名で探す" value="' + esc(S.homeQ || '') + '"><div id="homeList">' + parentRows(cat, S.homeQ) + '</div>';
  }
  function bindHomeQ() { var i = $('#homeQ'); if (i) i.oninput = function () { S.homeQ = i.value; $('#homeList').innerHTML = parentRows(S.homeCat, S.homeQ); }; }
  function renderHome() {
    var el = $('#home'), cat = S.homeCat, title = (S.settings && S.settings.appTitle) || '佐渡住宅GAS';
    var h = '<div class="mhead">' + (cat ? '<button data-act="homeBack" aria-label="戻る" style="margin-left:0;margin-right:6px">‹</button>' : '') + '<div class="t">' + esc(cat || title) + '　<span class="note" style="color:inherit">' + esc(S.user ? S.user.displayName + '(' + roleLabel() + ')' : '') + '</span></div><button data-act="navClose" aria-label="閉じる">✕</button></div><div class="mbody">';
    if (!cat) {
      CATS.forEach(function (c) {
        var n = catAreas(c[0]).length, use = catAreas(c[0]).filter(function (a) { return a.inUse; }).length;
        h += '<button class="catbtn" data-act="homeCat" data-v="' + esc(c[0]) + '">' + esc(c[1]) + '<span class="sub">' + (isAdmin() ? '区域 ' + n + '件(使用中 ' + use + '件)' : '担当の区域 ' + n + '件(使用中 ' + use + '件)') + '</span></button>';
      });
      var aptUrl = (S.settings && S.settings.apartmentUrl) || CFG.apartmentUrl || '';
      if (/^https?:\/\//.test(aptUrl)) h += '<a class="catbtn link" href="' + esc(aptUrl) + '" target="_blank" rel="noopener">アパート<span class="sub">アパートの記録は、別のアプリ(佐渡アパートGAS)で行います</span></a>';
      if (!S.areas.length) h += '<div class="note">区域のデータを読み込めていません。電波のあるところで、一度開いてください。</div>';
    } else {
      var list = catAreas(cat), par = S.homeParent ? areaById(S.homeParent) : null;
      if (par) { list = list.filter(function (a) { return a.parentId === par.areaId; }); h += '<div class="note"><button class="btn small" data-act="homeParentBack">‹ 大きなエリア一覧へ</button>　<b>' + esc(par.areaName) + '</b>' + (par.inUse ? '<span class="badge use">使用中</span>' : '') + '</div><div style="height:8px"></div>'; }
      else if (hasParents()) { h += parentListHtml(cat); el.innerHTML = h + '</div>'; bindHomeQ(); return; }
      else h += '<div class="note">' + (isAdmin() ? 'すべての区域です。' : 'あなた、またはあなたのグループが担当の区域です。') + '</div><div style="height:8px"></div>';
      list.forEach(function (a) {
        h += '<div class="card"><div class="row"><div class="grow"><b>' + esc(a.areaName) + '</b>' + (a.inUse ? '<span class="badge use">使用中</span>' : '<span class="badge off">未使用</span>') + (a.mine ? '<span class="badge mine">担当</span>' : '') + (a.inUse && !a.canEdit ? '<span class="badge off">見るだけ</span>' : '') + '<div class="note">' +
          (a.inUse ? esc(a.assigneeName) + '　' + esc(a.useStartDate) + ' 〜 ' + esc(a.expiry) : (a.lastDoneDate ? '前回完了 ' + esc(a.lastDoneDate) : '')) + '</div></div>' +
          '<button class="btn primary small" data-act="pickArea" data-v="' + esc(a.areaId) + '">開く</button><button class="btn small" data-act="saveTiles" data-v="' + esc(a.areaId) + '">地図を端末に保存</button></div></div>';
      });
      if (!list.length) h += '<div class="note" style="padding:12px 4px">' + '担当の区域はありません。区域係に、担当の設定を確認してください。' + '</div>';
    }
    el.innerHTML = h + '</div>';
  }

  // ---------- メニュー(設定・ダウンロード) ----------
  function openMenu(tab) { SADO.menuTab = tab || 'prefs'; $('#home').classList.add('hidden'); $('#menu').classList.remove('hidden'); activeNav(tab === 'help' ? 'help' : 'settings'); renderMenu(); }
  function closeMenu() { $('#menu').classList.add('hidden'); if ($('#home').classList.contains('hidden')) activeNav('map'); }
  function renderMenu() {
    var tabs = SADO.menuTab === 'help' ? [] : [['prefs', '設定'], ['dl', '印刷用']];
    $('#menu').innerHTML = '<div class="mhead"><div class="t">' + (SADO.menuTab === 'help' ? 'ヘルプ' : '設定') + '　<span class="note" style="color:inherit">' + esc(S.user ? S.user.displayName + '(' + roleLabel() + ')' : '') + '</span></div><button data-act="navClose" aria-label="閉じる">✕</button></div>' +
      (tabs.length ? '<div class="tabs">' + tabs.map(function (t) { return '<button class="tab' + (SADO.menuTab === t[0] ? ' on' : '') + '" data-act="menuTab" data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' : '') + '<div class="mbody" id="menuBody"></div>';
    renderMenuBody();
  }
  function renderMenuBody() {
    var el = $('#menuBody'), t = SADO.menuTab; if (!el) return;
    if (t === 'dl') {
      if (!S.settings || !S.settings.hasDownloads) { el.innerHTML = '<div class="card">印刷用の地図(PDF・PNG)は、まだ設定されていません。</div>'; return; }
      el.innerHTML = '<div class="note">エリアを選んで、ダウンロードします(電波が必要です)。</div>' + visibleAreas().map(function (a) {
        return '<div class="card"><div class="row"><div class="grow"><b>' + esc(a.areaName) + '</b></div><button class="btn small" data-act="dlFile" data-v="' + esc(a.areaId) + '" data-t="pdf">PDF</button><button class="btn small" data-act="dlFile" data-v="' + esc(a.areaId) + '" data-t="png">PNG</button></div></div>';
      }).join('');
    } else if (t === 'prefs') {
      var p = getPrefs();
      el.innerHTML = '<div class="card"><h3>文字の大きさ</h3><div class="seg">' + [1, 2, 3, 4, 5, 6].map(function (n) { return '<button class="chip' + (String(p.font || '3') === String(n) ? ' on' : '') + '" data-act="prefFont" data-v="' + n + '">' + n + '</button>'; }).join('') + '</div></div>' +
        '<div class="card"><h3>画面モード</h3><div class="seg">' + [['light', 'ライト'], ['dark', 'ダーク'], ['auto', '端末に合わせる']].map(function (x) { return '<button class="chip' + ((p.theme || 'auto') === x[0] ? ' on' : '') + '" data-act="prefTheme" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="card"><h3>パスワードの変更</h3><div class="row"><input id="pwOld" type="password" placeholder="今のパスワード"><input id="pwNew" type="password" placeholder="新しいパスワード(6文字以上)"><button class="btn small" data-act="changePw">変更</button></div></div>' +
        '<div class="card"><h3>端末の状態</h3><div class="note">未送信の記録: ' + S.pending + '件<br>通信: ' + (S.online ? 'オンライン' : 'オフライン') + '</div><button class="btn small" data-act="syncNow">今すぐ送信する</button></div>' +
        '<button class="btn danger block" data-act="logout">ログアウト</button>';
    } else if (t === 'help') {
      el.innerHTML = '<div class="card"><h3>はじめに</h3>ログイン後、「国仲・遠方」から選び、区域の「開く」を押すと、地図に建物が出ます。建物を押すと、部屋ごとに訪問状況を記録できます。</div>' +
        '<div class="card"><h3>色の意味</h3>建物の色: 青=未訪問 / オレンジ=途中 / 緑=完了 / 灰色=編集不可(担当外、または使用中でない)。赤い枠=拒否あり、橙の枠=注意あり。</div>' +
        '<div class="card"><h3>圏外のとき</h3>電波がなくても、保存済みの区域は開けて、入力もできます。入力は端末に残り、電波が戻ると自動で送信されます(画面の上に「未送信 ○件」と出ます)。区域は、電波のあるところで「地図を端末に保存」を押しておくと、地図の背景も圏外で見られます。</div>' +
        '<div class="card"><h3>困ったとき</h3>「見るだけ」と出るときは、その区域が使用中でない、または担当でありません。区域係に連絡してください。</div>';
    }
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
      case 'logout': logout(); break;
      case 'nav':
        $('#admin').classList.add('hidden'); // 管理画面が開いていたら閉じてから、選んだ画面へ移る
        if (v === 'map') closePanels(); else if (v === 'areas') goHome(); else if (v === 'settings') openMenu('prefs'); else if (v === 'help') openMenu('help');
        else if (v === 'admin' && SADO.openAdmin) { closePanels(); activeNav('admin'); SADO.openAdmin(); }
        break;
      case 'navClose': closePanels(); break;
      case 'menuTab': SADO.menuTab = v; renderMenu(); break;
      case 'homeCat': S.homeCat = v; S.homeParent = null; S.homeQ = ''; renderHome(); break;
      case 'homeBack': S.homeCat = null; S.homeParent = null; renderHome(); break;
      case 'homeParent': S.homeParent = v; renderHome(); break;
      case 'homeParentBack': S.homeParent = null; renderHome(); break;
      case 'pickArea': selectArea(v); break;
      case 'locate': locate(); break;
      case 'closeSheet': closeSheet(); break;
      case 'setStatus': patchRoom(t.getAttribute('data-room'), { status: v }); break;
      case 'setMark': var r = roomById(t.getAttribute('data-room')); patchRoom(t.getAttribute('data-room'), { mark: r && r.mark === v ? '' : v }); break;
      case 'report':
        var text = window.prompt('区域係への報告(内容)を入力してください'); if (text && text.trim()) { var bn = S.data[S.cur].buildings.filter(function (x) { return x.buildingId === S.sheetBid; })[0]; enqueue({ type: 'report', areaId: S.cur, buildingId: S.sheetBid, roomName: bn ? bn.buildingName : '', text: text.trim(), label: '報告' }); toast('報告を保存しました。'); }
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
      default: if (SADO.onAdminClick) SADO.onAdminClick(act, t, v); if (SADO.onEditClick) SADO.onEditClick(act, t, v);
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

  SADO.goHome = goHome; SADO.selectArea = selectArea; SADO.openBuilding = openBuilding; SADO.refreshBootstrap = refreshBootstrap; SADO.renderMenu = renderMenu;
  SADO.toast = toast; SADO.openMenu = openMenu;
  SADO.S = S; SADO.api = api; SADO.drawFrames = drawFrames; SADO.refreshBootstrap = refreshBootstrap; SADO.drawBuildings = drawBuildings; SADO.renderSheet = renderSheet; SADO.closeSheet = closeSheet; SADO.areaById = areaById;
  SADO.reloadCur = function () { if (!S.cur) return Promise.resolve(); return loadAreaData(S.cur, true).then(function () { drawBuildings(false); renderSheet(); }); };
  boot();
})();
