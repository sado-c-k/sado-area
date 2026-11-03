/* 佐渡住宅GAS: 編集モード(区域係だけ)。地図の上で、建物の追加(集合住宅・一軒家)・ピンの移動・部屋の追加と削除・建物の削除・区域の変更、
   新しい区域の追加と、区域の境界線の変更ができる。
   佐渡アパートGASの「管理者モード→編集モード」と同じ流れ: ✐で入る → 変更は「保存」で反映 → 「戻す」で1つずつ取り消し → 「終了」 */
(function () {
  'use strict';
  var SADO = window.SADO, esc = SADO.esc, $ = SADO.$, api = SADO.api, toast = SADO.toast, S = SADO.S;
  // mode: null / 'apt'(集合住宅の位置を選ぶ) / 'house'(一軒家を何軒か置く) / 'area'(新しい区域の枠を描く) / 'bound'(枠の形を直す)
  var E = { on: false, pend: {}, undo: [], mode: null, tmp: null, pts: [], av: [], avLayers: [], bd: null };

  function map() { return SADO.map; }
  function isAdmin() { return !!(S.user && S.user.role === 'admin'); }
  function fail(e) { toast(e && e.message ? e.message : String(e), 6000); }
  function count() { return Object.keys(E.pend).length; }
  function rm(l) { if (l && map()) map().removeLayer(l); }

  // ---------- どの区域の枠の中か ----------
  function inRing(lat, lng, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inGeom(lat, lng, g) {
    var polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
    return polys.some(function (p) { return p.length && inRing(lat, lng, p[0]) && !p.slice(1).some(function (h) { return inRing(lat, lng, h); }); });
  }
  function areaAt(lat, lng) {
    var f = SADO.frameFeatures ? SADO.frameFeatures() : [];
    for (var i = 0; i < f.length; i++) { var fa = SADO.areaById(f[i].areaId); if (fa && !fa.isParent && inGeom(lat, lng, f[i].geometry)) return f[i].areaId; }
    return '';
  }
  SADO.areaAt = areaAt;

  // ---------- 画面の出し分け ----------
  SADO.onEnter = function (admin) { $('#editBtn').classList.toggle('hidden', !admin); if (!admin && E.on) toggle(true); };
  var HINT = {
    none: '点で表示されている建物のピンは、ドラッグで動かせます(動かしたら「保存」)。\n建物を押すと、部屋の追加・削除や建物の削除ができます。',
    apt: '地図をタップして、集合住宅の位置を決めてください',
    house: '地図をタップして、一軒家を置いていきます(ピンはドラッグで動かせます)。\n置き終わったら「確定」を押してください。',
    area: '地図をタップして、新しい区域の枠の角を順番に置いていきます。\n3点以上置いたら「確定」を押してください。',
    bound: '角の点(白)はドラッグで動かせます。点を押すと削除、辺の中央の点(小さい点)を押すと角が増えます。\n直したら「境界線を保存」を押してください。'
  };
  function paint() {
    $('#editBtn').classList.toggle('on', E.on);
    $('#editFrame').classList.toggle('hidden', !E.on);
    $('#editBar').classList.toggle('hidden', !E.on);
    $('#editBar').classList.toggle('adding', !!E.mode); document.body.classList.toggle('editing', E.on);
    [['edAddBtn', 'apt'], ['edHouseBtn', 'house'], ['edAreaBtn', 'area'], ['edBoundBtn', 'bound']].forEach(function (x) { $('#' + x[0]).classList.toggle('on', E.mode === x[1]); });
    var tool = $('#edToolRow'), n;
    tool.classList.toggle('hidden', !(E.mode === 'house' || E.mode === 'area' || E.mode === 'bound'));
    if (E.mode === 'house') { n = E.pts.length; $('#edToolInfo').textContent = '一軒家 ' + n + '軒'; $('#edToolOk').textContent = '確定'; $('#edToolOk').disabled = !n; }
    else if (E.mode === 'area') { n = E.av.length; $('#edToolInfo').textContent = '角 ' + n + '点'; $('#edToolOk').textContent = '確定'; $('#edToolOk').disabled = n < 3; }
    else if (E.mode === 'bound') { $('#edToolInfo').textContent = E.bd ? '「' + E.bd.name + '」の枠' : ''; $('#edToolOk').textContent = '境界線を保存'; $('#edToolOk').disabled = !(E.bd && E.bd.undo.length); }
    var canUndo = E.mode === 'house' ? E.pts.length : E.mode === 'area' ? E.av.length : E.mode === 'bound' ? (E.bd && E.bd.undo.length) : E.undo.length;
    $('#edUndoBtn').disabled = !canUndo;
    $('#edSaveBtn').textContent = '保存' + (count() ? '（' + count() + '）' : '');
    $('#edSaveBtn').disabled = !count();
    $('#editHint').textContent = HINT[E.mode || 'none'];
  }
  function redraw() { SADO.drawFrames(); if (S.cur) { SADO.drawBuildings(false); SADO.renderSheet(); } }
  SADO.hideFrame = function (id) { return !!(E.bd && E.bd.areaId === id); };

  // ---------- 入る・終了する ----------
  function toggle(force) {
    if (!E.on) {
      if (!isAdmin()) return;
      if (S.merged) { toast('小さな区域を1つ開いてから、編集モードにしてください。'); return; }
      if (!S.online) { toast('編集モードは、電波のあるところで使います。'); return; }
      E.on = true; S.edit = true; try { if (SADO.MapRot) SADO.MapRot.syncEditLock(); } catch (x) {} map().on('click', onMap); paint(); redraw(); toast('編集モードにしました。', 1500); return;
    }
    if (!force && (count() || E.pts.length || E.av.length || (E.bd && E.bd.undo.length)) && !window.confirm('保存していない変更があります。捨てて終了しますか？')) return;
    endMode(); map().off('click', onMap); var had = count() > 0; E.on = false; S.edit = false; try { if (SADO.MapRot) SADO.MapRot.syncEditLock(); } catch (x) {} E.pend = {}; E.undo = [];
    paint(); redraw();
    if (had) SADO.reloadCur()['catch'](fail);
  }
  SADO.onAreaChange = function () { if (E.on) { E.pend = {}; E.undo = []; endMode(); paint(); } };

  // ---------- ピン(点の建物)をドラッグで動かす ----------
  SADO.editMarker = function (b) {
    var m = L.marker([b.lat, b.lng], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="edpin"></div>', iconSize: [22, 22], iconAnchor: [11, 22] }) });
    m.bindTooltip(b.buildingName || '', { direction: 'top', offset: [0, -22] });
    m.on('dragend', function (e) {
      var p = e.target.getLatLng(), cur = S.data[S.cur].buildings.filter(function (x) { return x.buildingId === b.buildingId; })[0]; if (!cur) return;
      E.undo.push({ bid: b.buildingId, prev: { lat: cur.lat, lng: cur.lng }, had: !!E.pend[b.buildingId], name: cur.buildingName });
      cur.lat = p.lat; cur.lng = p.lng; E.pend[b.buildingId] = { lat: p.lat, lng: p.lng };
      toast('「' + (cur.buildingName || '') + '」の位置を動かしました。保存で反映されます。', 1500); paint();
    });
    return m;
  };
  function undoMove() {
    var u = E.undo.pop(); if (!u) { toast('戻せる変更はありません。', 1200); return; }
    var cur = S.data[S.cur].buildings.filter(function (x) { return x.buildingId === u.bid; })[0];
    if (cur) { cur.lat = u.prev.lat; cur.lng = u.prev.lng; }
    if (!u.had) delete E.pend[u.bid];
    paint(); redraw(); toast('「' + (u.name || '') + '」の位置をひとつ前に戻しました。', 1500);
  }
  function save() {
    var ids = Object.keys(E.pend); if (!ids.length) return;
    $('#edSaveBtn').disabled = true;
    ids.reduce(function (p, id) { return p.then(function () { return api('updateBuilding', { buildingId: id, lat: E.pend[id].lat, lng: E.pend[id].lng }); }); }, Promise.resolve())
      .then(function () { toast(ids.length + '件の位置を保存しました。'); E.pend = {}; E.undo = []; paint(); return SADO.reloadCur(); }, function (e) { paint(); fail(e); });
  }

  // ---------- 小さなダイアログ ----------
  function modal(title, html, okText, ok, danger) {
    var m = $('#modal'); if (m) m.parentNode.removeChild(m);
    m = document.createElement('div'); m.id = 'modal';
    m.innerHTML = '<div class="mb"><h3>' + esc(title) + '</h3>' + html + '<div class="modal-msg" id="mdMsg"></div><div class="fxact"><button class="btn" id="mdNo">キャンセル</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" id="mdOk">' + esc(okText) + '</button></div></div>';
    document.body.appendChild(m);
    var close = function () { if (m.parentNode) m.parentNode.removeChild(m); };
    $('#mdNo').onclick = function () { close(); if (modal.onCancel) { var f = modal.onCancel; modal.onCancel = null; f(); } };
    $('#mdOk').onclick = function () {
      $('#mdOk').disabled = true; modal.onCancel = null;
      Promise.resolve().then(ok).then(function () { close(); }, function (e) { $('#mdOk').disabled = false; $('#mdMsg').textContent = e && e.message ? e.message : String(e); });
    };
    return close;
  }
  function kids() { return S.areas.filter(function (a) { return !a.isParent; }); }
  function areaOptions(sel) { return kids().map(function (a) { return '<option value="' + esc(a.areaId) + '"' + (a.areaId === sel ? ' selected' : '') + '>' + esc(a.areaName) + '</option>'; }).join(''); }
  function parentsList() { return S.areas.filter(function (a) { return a.isParent; }); }
  function areaName(id) { var a = SADO.areaById(id); return a ? a.areaName : ''; }
  function num(id, def, lo, hi) { var v = parseInt((document.getElementById(id) || {}).value, 10); return isNaN(v) ? def : Math.max(lo, Math.min(hi, v)); }
  function defaultArea(lat, lng) { return areaAt(lat, lng) || S.cur || ''; }

  // ---------- モードの切り替えと、地図のタップ ----------
  function endMode() {
    if (map()) {
      if (E.tmp) rm(E.tmp); E.pts.forEach(function (p) { rm(p.m); }); clearAv(); clearBd();
    }
    E.tmp = null; E.pts = []; E.av = []; E.bd = null; E.mode = null;
  }
  function setMode(m) {
    if (E.mode === m) { endMode(); paint(); redraw(); return; }
    if (E.mode && ((E.mode === 'house' && E.pts.length) || (E.mode === 'area' && E.av.length) || (E.mode === 'bound' && E.bd && E.bd.undo.length)) && !window.confirm('今の作業を捨てて、切り替えますか？')) return;
    endMode(); E.mode = m; paint(); redraw();
    if (m === 'bound') pickBoundArea();
  }
  function onMap(ev) {
    var ll = ev.latlng; if (!ll) return;
    if (E.mode === 'apt') {
      E.mode = null; paint(); if (E.tmp) rm(E.tmp); E.tmp = L.marker(ll, { opacity: 0.6 }).addTo(map()); aptDialog(ll.lat, ll.lng);
    } else if (E.mode === 'house') addHousePoint(ll.lat, ll.lng);
    else if (E.mode === 'area') { E.av.push({ lat: ll.lat, lng: ll.lng }); drawAv(); paint(); }
  }
  function numIcon(n) { return L.divIcon({ className: '', html: '<div class="edn">' + n + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] }); }

  // ---------- 集合住宅を追加する ----------
  function parseRoomNames(text) {
    var out = [];
    String(text || '').split(/[,、，\s]+/).forEach(function (t) {
      t = t.trim(); if (!t) return;
      var m = t.match(/^(\d+)\s*[-〜~ー－]\s*(\d+)$/);
      if (m) { var a = Number(m[1]), b = Number(m[2]); if (b >= a && b - a <= 200) for (var n = a; n <= b; n++) { var x = String(n); while (x.length < m[1].length) x = '0' + x; out.push(x); } }
      else out.push(t);
    });
    return out;
  }
  function floorOf(name) { var m = String(name).match(/^(\d+)$/); if (!m) return ''; var n = Number(m[1]); return n >= 100 ? String(Math.floor(n / 100)) : ''; }
  function genRooms(floors, per, start) {
    var rooms = [];
    for (var f = 1; f <= floors; f++) for (var i = 0; i < per; i++) { var no = start + i; rooms.push({ roomName: String(f) + (no < 10 ? '0' + no : String(no)), floor: String(f) }); }
    return rooms;
  }
  function afterCreate(areaIds, openId) {
    toast('建物を追加しました。');
    if (S.cur && areaIds.indexOf(S.cur) >= 0) return SADO.reloadCur().then(function () { if (openId) SADO.openBuilding(openId); });
    redraw();
  }
  function aptDialog(lat, lng) {
    var auto = areaAt(lat, lng), def = auto || S.cur || '';
    modal('集合住宅を追加',
      '<label>建物名</label><input id="nbN" maxlength="60" placeholder="例：コーポ山田"><label>区域</label><select id="nbA">' + (def ? '' : '<option value="">区域を選んでください</option>') + areaOptions(def) + '</select><div class="note">' + (auto ? '地図上の位置から「' + esc(areaName(auto)) + '」の枠の中と判断しました。' : '枠の外(または枠が未設定)です。区域を選んでください。') + '</div>' +
      '<label>部屋をまとめて作成</label><div class="gen"><div><label>階数</label><input id="nbF" type="number" value="2"></div><div><label>1階の部屋数</label><input id="nbP" type="number" value="4"></div><div><label>開始番号</label><input id="nbS" type="number" value="1"></div></div><div class="prev" id="nbPrev"></div>' +
      '<div class="note">部屋はあとから「部屋を追加」でも足せます。部屋なしで作る場合は、階数を0にしてください。</div>', '追加する', function () {
        var name = ($('#nbN').value || '').trim(), area = $('#nbA').value; if (!name) throw new Error('建物名を入力してください。'); if (!area) throw new Error('区域を選んでください。');
        var rooms = genRooms(num('nbF', 0, 0, 30), num('nbP', 0, 0, 30), num('nbS', 1, 0, 99));
        return api('createBuilding', { areaId: area, buildingName: name, lat: lat, lng: lng, rooms: rooms }).then(function (r) {
          if (E.tmp) { rm(E.tmp); E.tmp = null; }
          if (area !== S.cur && S.cur) { toast('建物を追加しました(「' + areaName(area) + '」)。'); return; }
          return afterCreate([area], r.buildingId);
        });
      });
    modal.onCancel = function () { if (E.tmp) { rm(E.tmp); E.tmp = null; } };
    var upd = function () {
      var rs = genRooms(num('nbF', 0, 0, 30), num('nbP', 0, 0, 30), num('nbS', 1, 0, 99)), el = $('#nbPrev'); if (!el) return;
      if (!rs.length) { el.textContent = '部屋は作成しません'; return; }
      var by = {}; rs.forEach(function (r) { (by[r.floor] = by[r.floor] || []).push(r.roomName); });
      el.textContent = Object.keys(by).map(function (f) { var l = by[f]; return f + '階: ' + l[0] + (l.length > 1 ? '〜' + l[l.length - 1] : ''); }).join(' / ') + '（計' + rs.length + '部屋）';
    };
    ['nbF', 'nbP', 'nbS'].forEach(function (id) { $('#' + id).oninput = upd; }); upd();
  }

  // ---------- 一軒家をまとめて追加する ----------
  function addHousePoint(lat, lng) {
    var p = { lat: lat, lng: lng }, n = E.pts.length + 1;
    p.m = L.marker([lat, lng], { draggable: true, icon: numIcon(n) }).addTo(map());
    p.m.on('dragend', function (e) { var q = e.target.getLatLng(); p.lat = q.lat; p.lng = q.lng; });
    E.pts.push(p); paint();
  }
  function houseDialog() {
    if (!E.pts.length) return;
    var rows = E.pts.map(function (p, i) {
      var a = areaAt(p.lat, p.lng) || S.cur || '';
      return '<div class="hrow"><b>' + (i + 1) + '</b><input data-hn="' + i + '" maxlength="60" placeholder="一軒家 ' + (i + 1) + '(名前は空でもOK)"><select data-ha="' + i + '">' + (a ? '' : '<option value="">区域を選ぶ</option>') + areaOptions(a) + '</select></div>' + (areaAt(p.lat, p.lng) ? '' : '<div class="note" style="margin:-4px 0 6px 28px">枠の外です。区域を確認してください。</div>');
    }).join('');
    modal('一軒家を' + E.pts.length + '軒追加', '<div class="note">それぞれの区域は、地図上でどの区域の枠の中にあるかで自動的に決めました(違うときは変えられます)。名前を空にすると「一軒家 番号」になります。</div><div style="max-height:46vh;overflow:auto">' + rows + '</div>', '追加する', function () {
      var items = E.pts.map(function (p, i) {
        var nm = (document.querySelector('[data-hn="' + i + '"]').value || '').trim(), ar = document.querySelector('[data-ha="' + i + '"]').value;
        if (!ar) throw new Error((i + 1) + '軒目の区域を選んでください。');
        return { areaId: ar, buildingName: nm || '一軒家 ' + (i + 1), lat: p.lat, lng: p.lng };
      });
      return api('createBuildings', { items: items }).then(function () {
        var areas = items.map(function (x) { return x.areaId; }); endMode(); paint(); toast(items.length + '軒の一軒家を追加しました。');
        return (S.cur && areas.indexOf(S.cur) >= 0) ? SADO.reloadCur() : redraw();
      });
    });
  }

  // ---------- 新しい区域の枠を描く ----------
  function clearAv() { E.avLayers.forEach(rm); E.avLayers = []; }
  function drawAv() {
    clearAv(); if (!map()) return;
    if (E.av.length >= 2) E.avLayers.push(L.polygon(E.av.map(function (p) { return [p.lat, p.lng]; }), { color: '#ef6c00', weight: 3, fillOpacity: 0.12 }).addTo(map()));
    E.av.forEach(function (p, i) {
      var m = L.marker([p.lat, p.lng], { draggable: true, icon: numIcon(i + 1) }).addTo(map());
      m.on('dragend', function (e) { var q = e.target.getLatLng(); p.lat = q.lat; p.lng = q.lng; drawAvLine(); });
      E.avLayers.push(m);
    });
  }
  function drawAvLine() { var keep = E.avLayers.filter(function (l) { return l.kind === 'marker'; }); E.avLayers.filter(function (l) { return l.kind !== 'marker'; }).forEach(rm); E.avLayers = keep; if (E.av.length >= 2) E.avLayers.push(L.polygon(E.av.map(function (p) { return [p.lat, p.lng]; }), { color: '#ef6c00', weight: 3, fillOpacity: 0.12 }).addTo(map())); }
  function ringGeom(pts) { var r = pts.map(function (p) { return [p.lng, p.lat]; }); r.push(r[0].slice()); return { type: 'Polygon', coordinates: [r] }; }
  function areaDialog() {
    if (E.av.length < 3) { toast('3点以上置いてください。'); return; }
    modal('新しい区域を追加', '<label>区域名</label><input id="naN" maxlength="30" placeholder="例: 1-4">' + (parentsList().length ? '<label>所属する大きな区域</label><select id="naP"><option value="">なし(区分を自分で選ぶ)</option>' + parentsList().map(function (p) { return '<option value="' + esc(p.areaId) + '">' + esc(p.areaName) + '(' + esc(p.category) + ')</option>'; }).join('') + '</select>' : '') + '<label>区分(大きな区域を選ぶと、その区分になります)</label><select id="naC"><option value="国仲">国仲</option><option value="遠方">遠方</option><option value="アパート">アパート</option></select><div class="note">描いた枠(' + E.av.length + '点)がこの区域の境界線になります。建物は、このあと「＋集合住宅」「＋一軒家」で追加できます。</div>', '追加する', function () {
      var name = ($('#naN').value || '').trim(); if (!name) throw new Error('区域名を入力してください。');
      return api('addArea', { areaName: name, category: $('#naC').value, parentId: ($('#naP') || {}).value || '', boundary: ringGeom(E.av) }).then(function () {
        endMode(); paint(); toast('区域「' + name + '」を追加しました。'); return SADO.refreshBootstrap().then(redraw);
      });
    });
  }

  // ---------- 境界線を直す ----------
  function clearBd() { if (E.bd) { (E.bd.layers || []).forEach(rm); E.bd.layers = []; } }
  function pickBoundArea() {
    var withFrame = kids().filter(function (a) { return SADO.frameFeatures().some(function (f) { return f.areaId === a.areaId; }); });
    if (!withFrame.length) { toast('枠のある区域がありません。先に「＋区域」で枠を描いてください。'); endMode(); paint(); return; }
    var def = withFrame.some(function (a) { return a.areaId === S.cur; }) ? S.cur : withFrame[0].areaId;
    modal('境界線を直す区域', '<label>区域</label><select id="bdA">' + withFrame.map(function (a) { return '<option value="' + esc(a.areaId) + '"' + (a.areaId === def ? ' selected' : '') + '>' + esc(a.areaName) + '</option>'; }).join('') + '</select>', '枠を表示する', function () { startBound($('#bdA').value); });
    modal.onCancel = function () { endMode(); paint(); redraw(); };
  }
  function startBound(areaId) {
    var f = SADO.frameFeatures().filter(function (x) { return x.areaId === areaId; })[0]; if (!f) throw new Error('この区域の枠が見つかりません。');
    var g = JSON.parse(JSON.stringify(f.geometry)), polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    var rings = polys.map(function (p) { var r = p[0].map(function (c) { return { lat: c[1], lng: c[0] }; }); r.pop(); return r; });
    E.bd = { areaId: areaId, name: areaName(areaId), geom: g, rings: rings, undo: [], layers: [] }; E.bd.last = JSON.stringify(rings);
    SADO.drawFrames(); drawBd(); paint();
    try { var b = L.latLngBounds(rings[0].map(function (p) { return [p.lat, p.lng]; })); map().fitBounds(b, { padding: [40, 40] }); } catch (e) {}
  }
  function bdChanged() { E.bd.undo.push(E.bd.last); E.bd.last = JSON.stringify(E.bd.rings); drawBd(); paint(); }
  function drawBd() {
    if (!E.bd) return; clearBd(); var L_ = E.bd.layers;
    E.bd.rings.forEach(function (ring) {
      L_.push(L.polygon(ring.map(function (p) { return [p.lat, p.lng]; }), { color: '#ef6c00', weight: 3, fillOpacity: 0.1, interactive: false }).addTo(map()));
      ring.forEach(function (p, i) {
        var v = L.marker([p.lat, p.lng], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="edv"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map());
        v.on('dragend', function (e) { var q = e.target.getLatLng(); p.lat = q.lat; p.lng = q.lng; bdChanged(); });
        v.on('click', function () { if (ring.length <= 3) { toast('これ以上、点を減らせません(3点まで)。'); return; } ring.splice(i, 1); bdChanged(); toast('角を1つ削除しました。「戻す」で取り消せます。', 1500); });
        v._bdv = true; L_.push(v);
        var q = ring[(i + 1) % ring.length], mid = { lat: (p.lat + q.lat) / 2, lng: (p.lng + q.lng) / 2 };
        var mm = L.marker([mid.lat, mid.lng], { icon: L.divIcon({ className: '', html: '<div class="edm"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }) }).addTo(map());
        mm.on('click', function () { ring.splice(i + 1, 0, mid); bdChanged(); }); mm._bdm = true; L_.push(mm);
      });
    });
  }
  function saveBound() {
    if (!E.bd || !E.bd.undo.length) return;
    var g = E.bd.geom, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    E.bd.rings.forEach(function (ring, k) { var r = ring.map(function (p) { return [p.lng, p.lat]; }); r.push(r[0].slice()); polys[k][0] = r; });
    $('#edToolOk').disabled = true;
    api('saveAreaBoundary', { areaId: E.bd.areaId, geometry: g }).then(function () {
      var nm = E.bd.name; endMode(); paint(); toast('「' + nm + '」の境界線を保存しました。'); return SADO.refreshBootstrap().then(redraw);
    }, function (e) { paint(); fail(e); });
  }

  // ---------- 戻す・確定 ----------
  function undo() {
    if (E.mode === 'house') { var p = E.pts.pop(); if (p) rm(p.m); paint(); }
    else if (E.mode === 'area') { E.av.pop(); drawAv(); paint(); }
    else if (E.mode === 'bound') { if (!E.bd || !E.bd.undo.length) return; E.bd.last = E.bd.undo.pop(); E.bd.rings = JSON.parse(E.bd.last); drawBd(); paint(); }
    else undoMove();
  }

  // ---------- 建物のシートの下に出す道具 ----------
  SADO.sheetTools = function (b) {
    return '<div class="tools"><div class="row"><button class="btn small primary" data-act="ed:addRooms" data-v="' + esc(b.buildingId) + '">＋ 部屋を追加</button><button class="btn small danger" data-act="ed:delB" data-v="' + esc(b.buildingId) + '">この建物を削除</button></div>' +
      '<div class="row" style="margin-top:8px"><span class="note">区域</span><select id="bArea">' + areaOptions(S.cur) + '</select><button class="btn small" data-act="ed:moveB" data-v="' + esc(b.buildingId) + '">変更</button></div></div>';
  };
  function addRoomsDialog(bid) {
    modal('部屋を追加', '<label>部屋番号</label><input id="arN" placeholder="例：101-105, 201, 202"><label>階(空欄なら部屋番号から自動で判定)</label><input id="arF" maxlength="10" placeholder="例：1"><div class="prev" id="arPrev"></div>' +
      '<div class="note">「101-105」のように書くと、101〜105をまとめて追加できます。すでにある部屋番号は追加されません。</div>', '追加する', function () {
        var names = parseRoomNames($('#arN').value), fl = ($('#arF').value || '').trim(); if (!names.length) throw new Error('部屋番号を入力してください。');
        return api('addRooms', { buildingId: bid, rooms: names.map(function (n) { return { roomName: n, floor: fl || floorOf(n) }; }) }).then(function (n) {
          toast(n ? n + '部屋を追加しました。' : '追加できる部屋がありません(すべて登録済みです)。'); return SADO.reloadCur();
        });
      });
    $('#arN').oninput = function () { var ns = parseRoomNames(this.value); $('#arPrev').textContent = ns.length ? ns.length + '部屋: ' + ns.slice(0, 12).join(', ') + (ns.length > 12 ? ' …' : '') : ''; };
  }

  SADO.onEditClick = function (act, t, v) {
    if (act.indexOf('ed:') !== 0) return;
    switch (act.slice(3)) {
      case 'toggle': toggle(); break;
      case 'addB': setMode('apt'); break;
      case 'addH': setMode('house'); break;
      case 'addA': setMode('area'); break;
      case 'bound': setMode('bound'); break;
      case 'toolOk': if (E.mode === 'house') houseDialog(); else if (E.mode === 'area') areaDialog(); else if (E.mode === 'bound') saveBound(); break;
      case 'undo': undo(); break;
      case 'save': save(); break;
      case 'addRooms': addRoomsDialog(v); break;
      case 'delRoom':
        var r = S.data[S.cur].rooms.filter(function (x) { return x.roomId === v; })[0];
        if (r && window.confirm('部屋「' + r.roomName + '」を削除しますか？\n(入力済みの訪問状況も表示されなくなります)')) api('setActive', { kind: 'room', id: v, active: false }).then(function () { toast('部屋を削除しました。'); return SADO.reloadCur(); }, fail);
        break;
      case 'delB':
        var b = S.data[S.cur].buildings.filter(function (x) { return x.buildingId === v; })[0];
        if (b && window.confirm('建物「' + b.buildingName + '」を削除しますか？\n地図と一覧に表示されなくなります。') && window.confirm('本当に削除しますか？(あとからスプレッドシートで元に戻すことはできます)'))
          api('setActive', { kind: 'building', id: v, active: false }).then(function () { SADO.closeSheet(); toast('建物を削除しました。'); return SADO.reloadCur(); }, fail);
        break;
      case 'moveB':
        var to = $('#bArea').value; if (!to || to === S.cur) { toast('別の区域を選んでください。'); break; }
        api('setBuildingArea', { buildingId: v, areaId: to }).then(function () { SADO.closeSheet(); toast('区域を変更しました。'); return SADO.reloadCur(); }, fail);
        break;
    }
  };
  paint();
})();
