/* 佐渡住宅GAS: 編集モード(区域係だけ)。地図の上で、建物の追加・ピンの移動・部屋の追加と削除・建物の削除・エリアの変更ができる。
   佐渡アパートGASの「管理者モード→編集モード」と同じ流れ: ✐で入る → 変更は「保存」で反映 → 「戻す」で1つずつ取り消し → 「終了」 */
(function () {
  'use strict';
  var SADO = window.SADO, esc = SADO.esc, $ = SADO.$, api = SADO.api, toast = SADO.toast, S = SADO.S;
  var E = { on: false, pend: {}, undo: [], picking: null, tmp: null, markers: {} };

  function map() { return SADO.map; }
  function isAdmin() { return !!(S.user && S.user.role === 'admin'); }
  function fail(e) { toast(e && e.message ? e.message : String(e), 6000); }
  function count() { return Object.keys(E.pend).length; }

  // ---------- 画面の出し分け ----------
  SADO.onEnter = function (admin) { $('#editBtn').classList.toggle('hidden', !admin); if (!admin && E.on) toggle(true); };
  function paint() {
    $('#editBtn').classList.toggle('on', E.on);
    $('#editFrame').classList.toggle('hidden', !E.on);
    $('#editBar').classList.toggle('hidden', !E.on);
    $('#editBar').classList.toggle('adding', !!E.picking); document.body.classList.toggle('editing', E.on);
    $('#edAddBtn').textContent = E.picking ? 'やめる' : '＋ 建物を追加';
    $('#edUndoBtn').disabled = !E.undo.length;
    $('#edSaveBtn').textContent = '保存' + (count() ? '（' + count() + '）' : '');
    $('#edSaveBtn').disabled = !count();
    $('#editHint').textContent = E.picking ? '地図をタップして、建物の位置を決めてください' : '点で表示されている建物のピンは、ドラッグで動かせます(動かしたら「保存」)。\n建物を押すと、部屋の追加・削除や建物の削除ができます。';
  }
  function redraw() { if (S.cur) { SADO.drawBuildings(false); SADO.renderSheet(); } }

  // ---------- 入る・終了する ----------
  function toggle(force) {
    if (!E.on) {
      if (!isAdmin()) return;
      if (!S.online) { toast('編集モードは、電波のあるところで使います。'); return; }
      E.on = true; S.edit = true; paint(); redraw(); toast('編集モードにしました。', 1500); return;
    }
    if (!force && count() && !window.confirm('保存していない変更が' + count() + '件あります。捨てて終了しますか？')) return;
    cancelPick(); var had = count() > 0; E.on = false; S.edit = false; E.pend = {}; E.undo = [];
    paint();
    if (had) SADO.reloadCur()['catch'](fail); else redraw();
  }
  SADO.onAreaChange = function () { if (E.on) { E.pend = {}; E.undo = []; cancelPick(); paint(); } };

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
  function undo() {
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
    $('#mdNo').onclick = function () { close(); if (modal.onCancel) modal.onCancel(); };
    $('#mdOk').onclick = function () {
      $('#mdOk').disabled = true;
      Promise.resolve().then(ok).then(function () { close(); }, function (e) { $('#mdOk').disabled = false; $('#mdMsg').textContent = e && e.message ? e.message : String(e); });
    };
    return close;
  }

  // ---------- 建物を追加する ----------
  function cancelPick() {
    if (E.picking && map()) map().off('click', E.picking);
    E.picking = null; if (E.tmp && map()) map().removeLayer(E.tmp); E.tmp = null; paint();
  }
  function startPick() {
    if (E.picking) { cancelPick(); return; }
    if (!map()) return;
    E.picking = function (ev) {
      map().off('click', E.picking); E.picking = null; paint();
      if (E.tmp) map().removeLayer(E.tmp); E.tmp = L.marker(ev.latlng, { opacity: 0.6 }).addTo(map());
      newBuildingDialog(ev.latlng.lat, ev.latlng.lng);
    };
    map().on('click', E.picking); paint();
  }
  // 「101-105, 201」→ 101,102,…,105,201
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
  function nearestArea(lat, lng) {
    var d = S.data[S.cur]; if (S.cur) return S.cur;
    return S.areas.length ? S.areas[0].areaId : '';
  }
  function areaOptions(sel) { return S.areas.map(function (a) { return '<option value="' + esc(a.areaId) + '"' + (a.areaId === sel ? ' selected' : '') + '>' + esc(a.areaName) + '</option>'; }).join(''); }
  function num(id, def, lo, hi) { var v = parseInt((document.getElementById(id) || {}).value, 10); return isNaN(v) ? def : Math.max(lo, Math.min(hi, v)); }
  function newBuildingDialog(lat, lng) {
    var close = modal('建物を追加',
      '<label>建物名</label><input id="nbN" maxlength="60" placeholder="例：コーポ山田"><label>エリア</label><select id="nbA">' + areaOptions(nearestArea(lat, lng)) + '</select>' +
      '<label>部屋をまとめて作成</label><div class="gen"><div><label>階数</label><input id="nbF" type="number" value="2"></div><div><label>1階の部屋数</label><input id="nbP" type="number" value="4"></div><div><label>開始番号</label><input id="nbS" type="number" value="1"></div></div><div class="prev" id="nbPrev"></div>' +
      '<div class="note">部屋はあとから「部屋を追加」でも足せます。部屋なしで作る場合は、階数を0にしてください。</div>', '追加する', function () {
        var name = ($('#nbN').value || '').trim(), area = $('#nbA').value; if (!name) throw new Error('建物名を入力してください。'); if (!area) throw new Error('エリアを選んでください。');
        var rooms = genRooms(num('nbF', 0, 0, 30), num('nbP', 0, 0, 30), num('nbS', 1, 0, 99));
        return api('createBuilding', { areaId: area, buildingName: name, lat: lat, lng: lng, rooms: rooms }).then(function (r) {
          cancelPick(); toast('建物を追加しました。');
          var go = function () { return SADO.reloadCur().then(function () { SADO.openBuilding(r.buildingId); }); };
          if (area !== S.cur) { SADO.selectArea(area); setTimeout(function () { SADO.openBuilding(r.buildingId); }, 1500); return; }
          return go();
        });
      });
    modal.onCancel = cancelPick;
    var upd = function () {
      var rs = genRooms(num('nbF', 0, 0, 30), num('nbP', 0, 0, 30), num('nbS', 1, 0, 99)), el = $('#nbPrev'); if (!el) return;
      if (!rs.length) { el.textContent = '部屋は作成しません'; return; }
      var by = {}; rs.forEach(function (r) { (by[r.floor] = by[r.floor] || []).push(r.roomName); });
      el.textContent = Object.keys(by).map(function (f) { var l = by[f]; return f + '階: ' + l[0] + (l.length > 1 ? '〜' + l[l.length - 1] : ''); }).join(' / ') + '（計' + rs.length + '部屋）';
    };
    ['nbF', 'nbP', 'nbS'].forEach(function (id) { $('#' + id).oninput = upd; }); upd();
    void close;
  }

  // ---------- 建物のシートの下に出す道具 ----------
  SADO.sheetTools = function (b) {
    return '<div class="tools"><div class="row"><button class="btn small primary" data-act="ed:addRooms" data-v="' + esc(b.buildingId) + '">＋ 部屋を追加</button><button class="btn small danger" data-act="ed:delB" data-v="' + esc(b.buildingId) + '">この建物を削除</button></div>' +
      '<div class="row" style="margin-top:8px"><span class="note">エリア</span><select id="bArea">' + areaOptions(S.cur) + '</select><button class="btn small" data-act="ed:moveB" data-v="' + esc(b.buildingId) + '">変更</button></div></div>';
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
      case 'addB': startPick(); break;
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
        var to = $('#bArea').value; if (!to || to === S.cur) { toast('別のエリアを選んでください。'); break; }
        api('setBuildingArea', { buildingId: v, areaId: to }).then(function () { SADO.closeSheet(); toast('エリアを変更しました。'); return SADO.reloadCur(); }, fail);
        break;
    }
  };
  paint();
})();
