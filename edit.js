/* 佐渡住宅GAS: 編集モード(区域係だけ)。地図の上で、建物の追加(集合住宅・一軒家)・ピンの移動・部屋の追加と削除・建物の削除・区域の変更、
   新しい区域の追加と、区域の境界線の変更ができる。
   佐渡アパートGASの「管理者モード→編集モード」と同じ流れ: ✐で入る → 変更は「保存」で反映 → 「戻す」で1つずつ取り消し → 「終了」 */
(function () {
  'use strict';
  var SADO = window.SADO, esc = SADO.esc, $ = SADO.$, api = SADO.api, toast = SADO.toast, S = SADO.S;
  // mode: null / 'apt'(集合住宅の位置を選ぶ) / 'house'(一軒家を何軒か置く) / 'area'(新しい区域の枠を描く) / 'bound'(枠の形を直す)
  var E = { on: false, pend: {}, undo: [], mode: null, areaKind: '', tmp: null, pts: [], av: [], avLayers: [], bd: null };

  function map() { return SADO.map; }
  function isAdmin() { return !!(S.user && S.user.role === 'admin'); }
  function canEdit() { return !!(S.user && (S.user.role === 'admin' || S.user.role === 'maintainer')); } // 編集者は、区域の追加・境界線の変更はできない
  function fail(e) { toast(e && e.message ? e.message : String(e), 6000); }
  function count() { return Object.keys(E.pend).length; }
  // 保存したあと、地図への反映に数秒かかるので、終わるまで「反映中」を出す
  function reflect() { toast('地図に反映中です…', 30000); return SADO.reloadCur().then(function (r) { toast('反映しました。', 1200); return r; }, function (e) { fail(e); }); }
  // 保存したあとの地図は、サーバーから読み直さず、手元のデータを書き換えてすぐ反映する(アクセスを増やさない)
  function stash() { try { if (S.cur && S.data[S.cur]) SADO.idb.set('area', S.cur, S.data[S.cur]); } catch (e) {} }
  function localAdd(areaId, nb, rooms) {
    var d = S.data[areaId]; if (!d) return; d.buildings.push({ buildingId: nb.buildingId, buildingName: nb.buildingName || '', lat: nb.lat, lng: nb.lng, buildingMemo: '' });
    var rl = (rooms && rooms.length) ? rooms : [{ roomName: '（建物）', floor: '' }];
    rl.forEach(function (r, i) { d.rooms.push({ roomId: nb.buildingId + '-' + (i + 1), buildingId: nb.buildingId, roomName: r.roomName, tenant: '', floor: r.floor || '', sortOrder: i + 1, mark: '', status: 'unvisited', memo: '', updatedAt: '', updatedBy: '' }); });
    if (areaId === S.cur) stash();
  }
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
  SADO.onEnter = function (can) { if (!can && E.on) toggle(true); };
  SADO.editOn = function () { return E.on; };
  var HINT = {
    none: '',
    apt: '集合住宅を置く場所を、地図でタップしてください',
    house: '一軒家を置く場所を、地図でタップ(何軒でも)。\n置き終わったら「確定」を押します。',
    area: '新しい区域の角を、地図で順番にタップ(3点以上)。\n置き終わったら「確定」を押します。',
    bound: '白い点をドラッグ → 角を動かす / 点をタップ → 角を消す\n辺の中央の小さい点をタップ → 角を増やす。直したら「枠を保存」'
  };
  function curCat() { var a = S.cur && SADO.areaById(S.cur); if (!a) return ''; if (a.category) return a.category; var p = a.parentId && SADO.areaById(a.parentId); return p ? (p.category || '') : ''; }
  function paint() {
    var adm = isAdmin(); $('#edRow1').classList.toggle('hidden', !adm || !!(S.cur && E.mode !== 'area'));
    $('#editFrame').classList.toggle('hidden', !E.on);
    $('#editBar').classList.toggle('hidden', !E.on);
    $('#editBar').classList.toggle('adding', !!E.mode); document.body.classList.toggle('editing', E.on);
    // 2行目: 国仲・遠方の区域を選んでいるとき「一軒家」「集合住宅」/ アパートの区域を選んでいるとき「アパート」
    var cat = curCat(), apt = cat === 'アパート', r2 = !!(S.cur && cat);
    $('#edRow2').classList.toggle('hidden', !r2); $('#edHouseBtn').classList.toggle('hidden', apt); $('#edAddBtn').textContent = apt ? '＋アパート' : '＋集合住宅';
    $('#edBoundBtn').classList.toggle('hidden', !adm); $('#edAddBtn').classList.toggle('on', E.mode === 'apt'); $('#edHouseBtn').classList.toggle('on', E.mode === 'house'); $('#edBoundBtn').classList.toggle('on', E.mode === 'bound');
    $('#edParBtn').classList.toggle('on', E.mode === 'area' && E.areaKind === 'P'); $('#edKidBtn').classList.toggle('on', E.mode === 'area' && E.areaKind === 'K'); $('#edAptAreaBtn').classList.toggle('on', E.mode === 'area' && E.areaKind === 'A');
    var tool = $('#edToolRow'), n;
    tool.classList.toggle('hidden', !(E.mode === 'house' || E.mode === 'area' || E.mode === 'bound'));
    if (E.mode === 'house') { n = E.pts.length; $('#edToolInfo').textContent = '一軒家 ' + n + '軒'; $('#edToolOk').textContent = '確定'; $('#edToolOk').disabled = !n; }
    else if (E.mode === 'area') { n = E.av.length; $('#edToolInfo').textContent = '角 ' + n + '点'; $('#edToolOk').textContent = '確定'; $('#edToolOk').disabled = n < 3; }
    else if (E.mode === 'bound') { $('#edToolInfo').textContent = E.bd ? '「' + E.bd.name + '」の枠' : ''; $('#edToolOk').textContent = '枠を保存'; $('#edToolOk').disabled = !(E.bd && E.bd.undo.length); }
    var canUndo = E.mode === 'house' ? E.pts.length : E.mode === 'area' ? E.av.length : E.mode === 'bound' ? (E.bd && E.bd.undo.length) : E.undo.length;
    $('#edUndoBtn').disabled = !canUndo;
    var dirty = !!(count() || E.pts.length || E.av.length || (E.bd && E.bd.undo.length)); // 何も編集していないときは「終了」だけ
    $('#edSaveBtn').classList.toggle('hidden', !dirty); $('#edQuitBtn').textContent = dirty ? '保存せずに終了' : '終了';
    $('#edSaveBtn').textContent = '保存して終了' + (count() ? '（' + count() + '）' : '');
    var hint = (E.mode === 'area' ? ({ P: '親区域(大きな区域)の枠の角を、地図で順番にタップ(3点以上)。\n置き終わったら「確定」を押します。', K: '子区域(小さな区域)の枠の角を、地図で順番にタップ(3点以上)。\n置き終わったら「確定」を押します。', A: 'アパート区域の枠の角を、地図で順番にタップ(3点以上)。\n置き終わったら「確定」を押します。' }[E.areaKind]) : '') || HINT[E.mode || 'none'] || (E.on && !E.mode && !S.cur ? '地図の区域の枠(オレンジの点線)の中をタップすると、その区域を選べます' : ''); $('#editHint').textContent = hint; $('#editHint').classList.toggle('hidden', !hint);
  }
  function redraw() { SADO.drawFrames(); if (S.cur) { SADO.drawBuildings(false); SADO.renderSheet(); } }
  SADO.hideFrame = function (id) { return !!(E.bd && E.bd.areaId === id); };

  // ---------- 入る・終了する ----------
  function toggle(force) {
    if (!E.on) {
      if (!canEdit()) return;
      if (!S.online) { toast('編集モードは、電波のあるところで使います。'); return; }
      SADO.clearArea(); // 編集モードに入るときは、選ばれていた区域をいったん解除する(地図の表示は変えない)
      E.on = true; S.edit = true; try { if (SADO.MapRot) SADO.MapRot.syncEditLock(); } catch (x) {} map().on('click', onMap); paint(); redraw(); toast('編集モードにしました。', 1500); return;
    }
    if (!force && (count() || E.pts.length || E.av.length || (E.bd && E.bd.undo.length)) && !window.confirm('保存していない変更があります。捨てて終了しますか？')) return;
    endMode(); map().off('click', onMap); E.on = false; S.edit = false; try { if (SADO.MapRot) SADO.MapRot.syncEditLock(); } catch (x) {} E.pend = {}; E.undo = [];
    paint(); redraw();
    SADO.clearArea(); paint(); // 編集を終えたら、選ばれていた区域を解除する(保存していない動かし方は、次に区域を開いたとき元の位置で読み直される)
  }
  SADO.editToggle = function () { toggle(); };
  SADO.editBeforeClear = function () { // 編集中でも、左上の矢印で区域の選択を解除できるようにする
    if (count()) { toast('先に「保存して終了」か「戻す」で、いまの変更を片づけてください。', 3000); return false; }
    if ((E.pts.length || E.av.length || (E.bd && E.bd.undo.length)) && !window.confirm('作業中の追加・枠の変更は保存されません。区域の選択を解除しますか？')) return false;
    endMode(); paint(); return true;
  };
  SADO.onAreaShown = function () { if (E.on) paint(); };
  SADO.onAreaChange = function () { if (E.on) { E.pend = {}; E.undo = []; endMode(); paint(); } };

  // ---------- ピン(点の建物)をドラッグで動かす ----------
  var GLYPH_H = '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg>', GLYPH_A = '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff"><path d="M4 21V3h11v6h5v12h-6v-4h-3v4zM7 6v2h2V6zm0 4v2h2v-2zm0 4v2h2v-2zm9 1v2h2v-2zm0-4v2h2v-2z"/></svg>';
  SADO.editMarker = function (b) { // 集合住宅(青い四角+ビル)と一軒家(オレンジの丸+家)で、形と色を変える。名前があれば、下に出す
    var apt = SADO.isApt ? SADO.isApt(b) : false, nm = String(b.buildingName || '').trim();
    var m = L.marker([b.lat, b.lng], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="edpin2 ' + (apt ? 'apt' : 'house') + '">' + (apt ? GLYPH_A : GLYPH_H) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) });
    if (nm) m.bindTooltip(nm, { permanent: true, direction: 'bottom', offset: [0, 12], className: 'edlabel' });
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
  function save(thenQuit) { // 位置の変更と、枠の変更を、まとめて保存する
    if (E.pts.length || E.av.length) { toast('追加の途中です。「確定」を押して完了するか、「戻す」で取り消してください。', 3500); return; }
    var ids = Object.keys(E.pend), hasB = !!(E.bd && E.bd.undo.length);
    if (!ids.length && !hasB) { if (thenQuit) toggle(true); return; }
    $('#edSaveBtn').disabled = true;
    var p = Promise.resolve();
    if (ids.length) p = api('updateBuildingPositions', { items: ids.map(function (id) { return { buildingId: id, lat: E.pend[id].lat, lng: E.pend[id].lng }; }) }) // 動かした建物は、1回の通信でまとめて保存する
      .then(function (r) {
        var mv = r && r.to ? Object.keys(r.to) : []; toast(ids.length + '件の位置を保存しました。' + (mv.length ? mv.length + '件は、入った枠にあわせて区域を自動で変えました。' : ''), mv.length ? 3500 : 2000);
        stash(); E.pend = {}; E.undo = [];
        if (mv.length && S.cur) return SADO.refreshBootstrap().then(function () { return SADO.reloadCur(); });
      });
    if (hasB) p = p.then(function () { return saveBoundCore(); });
    p.then(function () { $('#edSaveBtn').disabled = false; if (thenQuit) { toggle(true); return; } paint(); redraw(); }, function (e) { $('#edSaveBtn').disabled = false; paint(); fail(e); });
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
  var CATS = ['国仲', '遠方', 'アパート'];
  function nat(x, y) { return String(x).localeCompare(String(y), 'ja', { numeric: true }); }
  // 区域の選択肢: 区分 → 大きな区域ごとにまとめ、名前順(数字は大きさ順)に並べる。選ばれている区域は、いちばん上にも出す
  function areaOptions(sel, onlyIds) {
    var list = kids().filter(function (a) { return !onlyIds || onlyIds.indexOf(a.areaId) >= 0; }), pn = {};
    S.areas.forEach(function (a) { if (a.isParent) pn[a.areaId] = a; });
    var groups = {}, keys = [];
    list.forEach(function (a) {
      var par = a.parentId && pn[a.parentId], cat = a.category || (par && par.category) || '', pre = par ? par.areaName : (cat === 'アパート' ? 'アパート' : (String(a.areaName).split('-')[0] || 'その他')), label = (cat && cat !== 'アパート' ? cat + ' / ' : '') + pre; // 親区域の記録がないときは、区域名の頭の番号(007-1 なら 007)でまとめる
      if (!groups[label]) { groups[label] = { label: label, cat: cat, name: pre, items: [] }; keys.push(label); }
      groups[label].items.push(a);
    });
    keys.sort(function (x, y) { var gx = groups[x], gy = groups[y], cx = CATS.indexOf(gx.cat), cy = CATS.indexOf(gy.cat); return (cx - cy) || nat(gx.name, gy.name); });
    var o = function (a) { return '<option value="' + esc(a.areaId) + '"' + (a.areaId === sel ? ' selected' : '') + '>' + esc(a.areaName) + '</option>'; };
    var top = sel && list.filter(function (a) { return a.areaId === sel; })[0];
    return (top ? '<optgroup label="いま選ばれている区域"><option value="' + esc(top.areaId) + '" selected>' + esc(top.areaName) + '</option></optgroup>' : '') +
      keys.map(function (k) { var g = groups[k]; g.items.sort(function (a, b) { return nat(a.areaName, b.areaName); }); return '<optgroup label="' + esc(k) + '">' + g.items.map(function (a) { return o(a).replace(' selected', ''); }).join('') + '</optgroup>'; }).join('');
  }
  function parentsList() { return S.areas.filter(function (a) { return a.isParent; }); }
  function areaName(id) { var a = SADO.areaById(id); return a ? a.areaName : ''; }
  function num(id, def, lo, hi) { var v = parseInt((document.getElementById(id) || {}).value, 10); return isNaN(v) ? def : Math.max(lo, Math.min(hi, v)); }
  function defaultArea(lat, lng) { return areaAt(lat, lng) || S.cur || ''; }

  // ---------- モードの切り替えと、地図のタップ ----------
  function endMode() {
    if (map()) {
      if (E.tmp) rm(E.tmp); E.pts.forEach(function (p) { rm(p.m); }); clearAv(); clearBd();
    }
    E.tmp = null; E.pts = []; E.av = []; E.bd = null; E.mode = null; E.areaKind = '';
  }
  function setMode(m, kind) {
    if (E.mode === m && (m !== 'area' || E.areaKind === kind)) { if (((m === 'house' && E.pts.length) || (m === 'area' && E.av.length) || (m === 'bound' && E.bd && E.bd.undo.length)) && !window.confirm('今の作業を捨てて、閉じますか？')) return; endMode(); paint(); redraw(); return; }
    if (E.mode && ((E.mode === 'house' && E.pts.length) || (E.mode === 'area' && E.av.length) || (E.mode === 'bound' && E.bd && E.bd.undo.length)) && !window.confirm('今の作業を捨てて、切り替えますか？')) return;
    endMode(); E.mode = m; E.areaKind = m === 'area' ? kind : ''; paint(); redraw();
    if (m === 'bound') { try { startBound(S.cur); } catch (e) { endMode(); paint(); redraw(); fail(e); } }
  }
  function onMap(ev) {
    var ll = ev.latlng; if (!ll) return;
    if (E.mode === 'apt') {
      E.mode = null; paint(); if (E.tmp) rm(E.tmp); E.tmp = L.marker(ll, { opacity: 0.6 }).addTo(map()); aptDialog(ll.lat, ll.lng);
    } else if (E.mode === 'house') addHousePoint(ll.lat, ll.lng);
    else if (E.mode === 'area') { E.av.push({ lat: ll.lat, lng: ll.lng }); drawAv(); paint(); }
    else if (!E.mode) { // 何も選んでいないとき: 区域の枠の中をタップして、編集する区域を選ぶ(ほかの区域へも切り替えられる)
      var id = areaAt(ll.lat, ll.lng); if (!id || id === S.cur) return;
      if (count()) { toast('先に「保存して終了」か「戻す」で、いまの変更を片づけてください。', 3000); return; }
      SADO.selectArea(id).then(paint);
    }
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
  function afterCreate(areaIds, openId) { // 手元のデータはすでに書き換え済み。地図とシートを描き直すだけ
    toast('建物を追加しました。');
    if (S.cur && areaIds.indexOf(S.cur) >= 0) { redraw(); if (openId) SADO.openBuilding(openId); return; }
    redraw();
  }
  function aptDialog(lat, lng) {
    var auto = areaAt(lat, lng), def = S.cur || auto || '';
    modal('集合住宅を追加',
      '<label>建物名</label><input id="nbN" maxlength="60" placeholder="例：コーポ山田"><label>区域</label><select id="nbA">' + (def ? '' : '<option value="">区域を選んでください</option>') + areaOptions(def) + '</select><div class="note">現在選択中の区域に追加します。ほかの区域に追加したい場合は、区域を変更してください。</div>' +
      '<label>部屋をまとめて作成</label><div class="gen"><div><label>階数</label><input id="nbF" type="number" value="2"></div><div><label>1階の部屋数</label><input id="nbP" type="number" value="4"></div><div><label>開始番号</label><input id="nbS" type="number" value="1"></div></div><div class="prev" id="nbPrev"></div>' +
      '<div class="note">部屋はあとから「部屋を追加」でも足せます。部屋なしで作る場合は、階数を0にしてください。</div>', '追加する', function () {
        var name = ($('#nbN').value || '').trim(), area = $('#nbA').value; if (!name) throw new Error('建物名を入力してください。'); if (!area) throw new Error('区域を選んでください。');
        var rooms = genRooms(num('nbF', 0, 0, 30), num('nbP', 0, 0, 30), num('nbS', 1, 0, 99));
        return api('createBuilding', { areaId: area, buildingName: name, lat: lat, lng: lng, rooms: rooms }).then(function (r) {
          if (E.tmp) { rm(E.tmp); E.tmp = null; }
          if (area !== S.cur && S.cur) { toast('建物を追加しました(「' + areaName(area) + '」)。'); return; }
          localAdd(area, { buildingId: r.buildingId, buildingName: name, lat: lat, lng: lng }, rooms);
          afterCreate([area], r.buildingId);
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
      var a = S.cur || areaAt(p.lat, p.lng) || '';
      return '<div class="hrow"><b>' + (i + 1) + '</b><input data-hn="' + i + '" maxlength="60" placeholder="名前(空のままでもOK)"><select data-ha="' + i + '">' + (a ? '' : '<option value="">区域を選ぶ</option>') + areaOptions(a) + '</select></div>';
    }).join('');
    modal('一軒家を' + E.pts.length + '軒追加', '<div class="note">現在選択中の区域以外に追加したい場合は、区域を変更してください。名前は空のままでも登録できます。</div><div style="max-height:46vh;overflow:auto">' + rows + '</div>', '追加する', function () {
      var items = E.pts.map(function (p, i) {
        var nm = (document.querySelector('[data-hn="' + i + '"]').value || '').trim(), ar = document.querySelector('[data-ha="' + i + '"]').value;
        if (!ar) throw new Error((i + 1) + '軒目の区域を選んでください。');
        return { areaId: ar, buildingName: nm, lat: p.lat, lng: p.lng };
      });
      return api('createBuildings', { items: items }).then(function (r) {
        var areas = items.map(function (x) { return x.areaId; }); items.forEach(function (x, i) { if (r && r.buildingIds && r.buildingIds[i]) localAdd(x.areaId, { buildingId: r.buildingIds[i], buildingName: x.buildingName, lat: x.lat, lng: x.lng }, []); });
        endMode(); paint(); toast(items.length + '軒の一軒家を追加しました。'); redraw();
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
    var kind = E.areaKind || 'K', ttl = { P: '親区域を追加', K: '子区域を追加', A: 'アパート区域を追加' }[kind], pars = parentsList().slice().sort(function (a, b) { return (CATS.indexOf(a.category) - CATS.indexOf(b.category)) || nat(a.areaName, b.areaName); }), h = '<label>区域名</label><input id="naN" maxlength="30" placeholder="' + (kind === 'P' ? '例: 007 羽吉' : kind === 'K' ? '例: 007-1' : '例: A01 両津') + '">';
    if (kind === 'P') h += '<label>区分</label><select id="naC"><option value="国仲">国仲</option><option value="遠方">遠方</option></select>';
    else if (kind === 'K') h += '<label>所属する親区域</label><select id="naP"><option value="">親区域を選んでください</option>' + pars.filter(function (p) { return p.category !== 'アパート'; }).map(function (p) { return '<option value="' + esc(p.areaId) + '">' + esc(p.category) + ' / ' + esc(p.areaName) + '</option>'; }).join('') + '</select><div class="note">区分は、親区域と同じになります。</div>';
    else h += '<div class="note">区分は「アパート」になります。</div>';
    modal(ttl, h + '<div class="note">描いた枠(' + E.av.length + '点)がこの区域の境界線になります。建物は、区域を選んでから「＋一軒家」「＋集合住宅」で追加できます。</div>', '追加する', function () {
      var name = ($('#naN').value || '').trim(); if (!name) throw new Error('区域名を入力してください。');
      var body = { areaName: name, boundary: ringGeom(E.av) };
      if (kind === 'P') { body.category = $('#naC').value; body.asParent = true; }
      else if (kind === 'K') { body.parentId = $('#naP').value; if (!body.parentId) throw new Error('所属する親区域を選んでください。'); body.category = '国仲'; }
      else { body.category = 'アパート'; }
      return api('addArea', body).then(function () {
        endMode(); paint(); toast('区域「' + name + '」を追加しました。'); SADO.refreshBootstrap().then(redraw);
      });
    });
  }

  // ---------- 境界線を直す ----------
  function clearBd() { if (E.bd) { (E.bd.layers || []).forEach(rm); E.bd.layers = []; } }
  function startBound(areaId) {
    if (!areaId) throw new Error('先に区域を選んでください。');
    var f = SADO.frameFeatures().filter(function (x) { return x.areaId === areaId; })[0], geom = f && f.geometry;
    if (!geom) { // まだ枠がない区域(アパートなど): 建物の位置のまわりに四角い枠を置いて、そこから直す
      var bs = ((S.data[areaId] || {}).buildings || []).filter(function (b) { return b.lat !== '' && b.lat != null && isFinite(b.lat) && isFinite(b.lng); }), la = bs.map(function (b) { return +b.lat; }), ln = bs.map(function (b) { return +b.lng; }), c = map().getCenter(), m = 0.0004;
      var y0 = (la.length ? Math.min.apply(null, la) : c.lat) - m, y1 = (la.length ? Math.max.apply(null, la) : c.lat) + m, x0 = (ln.length ? Math.min.apply(null, ln) : c.lng) - m, x1 = (ln.length ? Math.max.apply(null, ln) : c.lng) + m;
      geom = { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] }; E.bd0 = true;
    }
    var g = JSON.parse(JSON.stringify(geom)), polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    var rings = polys.map(function (p) { var r = p[0].map(function (c) { return { lat: c[1], lng: c[0] }; }); r.pop(); return r; });
    E.bd = { areaId: areaId, name: areaName(areaId), geom: g, rings: rings, undo: E.bd0 ? [JSON.stringify(rings)] : [], layers: [] }; E.bd0 = false; E.bd.last = JSON.stringify(rings);
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
  function saveBoundCore() { // 枠の保存(通信)。成功したら、枠の編集を終えて地図を描き直す
    var g = E.bd.geom, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates, nm = E.bd.name;
    E.bd.rings.forEach(function (ring, k) { var r = ring.map(function (p) { return [p.lng, p.lat]; }); r.push(r[0].slice()); polys[k][0] = r; });
    return api('saveAreaBoundary', { areaId: E.bd.areaId, geometry: g }).then(function (r) {
      var mv = r && r.moved || 0; endMode();
      toast('「' + nm + '」の境界線を保存しました。' + (mv ? mv + '件の建物の区域を、枠にあわせて自動で変えました。' : ''), mv ? 4000 : 2000);
      return SADO.refreshBootstrap().then(function () { return mv && S.cur ? SADO.reloadCur() : 0; });
    });
  }
  function saveBound() {
    if (!E.bd || !E.bd.undo.length) return;
    $('#edToolOk').disabled = true;
    saveBoundCore().then(function () { paint(); redraw(); }, function (e) { paint(); fail(e); });
  }

  // ---------- 戻す・確定 ----------
  function undo() {
    if (E.mode === 'house') { var p = E.pts.pop(); if (p) rm(p.m); paint(); }
    else if (E.mode === 'area') { E.av.pop(); drawAv(); paint(); }
    else if (E.mode === 'bound') { if (!E.bd || !E.bd.undo.length) return; E.bd.last = E.bd.undo.pop(); E.bd.rings = JSON.parse(E.bd.last); drawBd(); paint(); }
    else undoMove();
  }

  // ---------- 建物のシートの下に出す道具 ----------
  SADO.editRoom = function (roomId, patch) { // 編集者・区域係: 部屋名・階数の変更
    if (patch.roomName !== undefined && !patch.roomName) { toast('部屋名は空にできません。'); return; }
    var p = { roomId: roomId }; for (var k in patch) p[k] = patch[k];
    api('updateRoom', p).then(function () { toast('保存しました。', 1200); return SADO.reloadCur(); }, fail);
  };
  SADO.sheetTools = function (b) {
    return '<div class="tools edtools"><div class="flabel">この建物を編集</div><div class="row"><button class="btn small primary" data-act="ed:addRooms" data-v="' + esc(b.buildingId) + '">＋ 部屋を追加</button><button class="btn small danger" data-act="ed:delB" data-v="' + esc(b.buildingId) + '">この建物を削除</button></div>' +
      '<div class="row" style="margin-top:8px"><span class="note">別の区域へ移す</span><select id="bArea">' + areaOptions(S.cur) + '</select><button class="btn small" data-act="ed:moveB" data-v="' + esc(b.buildingId) + '">移す</button></div></div>';
  };
  function addRoomsDialog(bid) {
    modal('部屋を追加', '<label>部屋番号</label><input id="arN" placeholder="例：101-105, 201, 202"><label>階(空欄なら部屋番号から自動で判定)</label><input id="arF" maxlength="10" placeholder="例：1"><div class="prev" id="arPrev"></div>' +
      '<div class="note">「101-105」のように書くと、101〜105をまとめて追加できます。すでにある部屋番号は追加されません。</div>', '追加する', function () {
        var names = parseRoomNames($('#arN').value), fl = ($('#arF').value || '').trim(); if (!names.length) throw new Error('部屋番号を入力してください。');
        return api('addRooms', { buildingId: bid, rooms: names.map(function (n) { return { roomName: n, floor: fl || floorOf(n) }; }) }).then(function (n) {
          toast(n ? n + '部屋を追加しました。' : '追加できる部屋がありません(すべて登録済みです)。'); SADO.reloadCur()['catch'](fail);
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
      case 'addP': setMode('area', 'P'); break;
      case 'addK': setMode('area', 'K'); break;
      case 'addAA': setMode('area', 'A'); break;
      case 'bound': setMode('bound'); break;
      case 'toolOk': if (E.mode === 'house') houseDialog(); else if (E.mode === 'area') areaDialog(); else if (E.mode === 'bound') saveBound(); break;
      case 'undo': undo(); break;
      case 'save': save(); break;
      case 'saveQuit': save(true); break;
      case 'addRooms': addRoomsDialog(v); break;
      case 'delRoom':
        var r = S.data[S.cur].rooms.filter(function (x) { return x.roomId === v; })[0];
        if (r && window.confirm('部屋「' + r.roomName + '」を削除しますか？\n(入力済みの訪問状況も表示されなくなります)')) api('setActive', { kind: 'room', id: v, active: false }).then(function () { var d = S.data[S.cur]; d.rooms = d.rooms.filter(function (x) { return x.roomId !== v; }); stash(); toast('部屋を削除しました。'); redraw(); }, fail);
        break;
      case 'delB':
        var b = S.data[S.cur].buildings.filter(function (x) { return x.buildingId === v; })[0];
        if (b && window.confirm('建物「' + b.buildingName + '」を削除しますか？\n地図と一覧に表示されなくなります。') && window.confirm('本当に削除しますか？(あとからスプレッドシートで元に戻すことはできます)'))
          api('setActive', { kind: 'building', id: v, active: false }).then(function () { var d = S.data[S.cur]; d.buildings = d.buildings.filter(function (x) { return x.buildingId !== v; }); d.rooms = d.rooms.filter(function (x) { return x.buildingId !== v; }); stash(); SADO.closeSheet(); toast('建物を削除しました。'); redraw(); }, fail);
        break;
      case 'moveB':
        var to = $('#bArea').value; if (!to || to === S.cur) { toast('別の区域を選んでください。'); break; }
        api('setBuildingArea', { buildingId: v, areaId: to }).then(function () { var d = S.data[S.cur]; d.buildings = d.buildings.filter(function (x) { return x.buildingId !== v; }); d.rooms = d.rooms.filter(function (x) { return x.buildingId !== v; }); stash(); SADO.closeSheet(); toast('区域を変更しました。'); redraw(); }, fail);
        break;
    }
  };
  paint();
})();
