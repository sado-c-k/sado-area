/* 佐渡住宅GAS: 管理者画面(管理・データ編集・報告・履歴・一括クリア・アカウント・動作設定・分析・取込書出) */
(function () {
  'use strict';
  var SADO = window.SADO, esc = SADO.esc, $ = SADO.$, api = SADO.api, toast = SADO.toast;
  var TABS = [['areas', '区域管理'], ['bulk', '一括クリア'], ['reports', '報告一覧'], ['edit', '区域編集'], ['accounts', 'アカウント'], ['settings', '動作設定'], ['logs', '履歴・ログ'], ['analysis', '分析'], ['io', '取込・書出'], ['guide', '利用ガイド']];
  var tab = 'areas', C = { ad: null, editArea: '', showHidden: false, filter: '' };
  function body(h) { var b = $('#adBody'); if (b) b.innerHTML = h; }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function fail(e) { toast(e.message || String(e), 6000); }
  function opts(list, valKey, labKey, sel, blank) { return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (x) { return '<option value="' + esc(x[valKey]) + '"' + (String(x[valKey]) === String(sel) ? ' selected' : '') + '>' + esc(x[labKey]) + '</option>'; }).join(''); }
  function isOff(v) { return v === false || String(v).toLowerCase() === 'false'; }

  function open() { var a = $('#admin'); a.classList.remove('hidden'); a.innerHTML = '<div class="mhead"><div class="t">区域係モード</div><button data-act="ad:close">✕</button></div><div class="tabs scroll">' + TABS.map(function (t) { return '<button class="tab" data-act="ad:tab" data-v="' + t[0] + '" id="adt-' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div class="mbody" id="adBody"></div>'; go(tab); }
  function close() { $('#admin').classList.add('hidden'); if (SADO.activeNav) SADO.activeNav('map'); SADO.refreshBootstrap(); }
  function go(t) {
    tab = t; TABS.forEach(function (x) { var b = $('#adt-' + x[0]); if (b) b.classList.toggle('on', x[0] === t); });
    body('<div class="note">読み込み中…</div>');
    var f = { areas: loadAreas, edit: loadEdit, reports: loadReports, logs: loadLogs, bulk: loadBulk, accounts: loadAccounts, settings: loadSettings, analysis: loadAnalysis, io: loadIO, guide: loadGuide }[t];
    f();
  }
  function loadAd() { return api('getAdminAreas').then(function (d) { C.ad = d; return d; }); }

  // ---------- 管理(エリアの使用・担当) ----------
  function loadAreas(openId) {
    C.openArea = '';
    loadAd().then(function (d) {
      var only = false; try { only = localStorage.getItem('adOnlyInUse') === '1'; } catch (e) {}
      C.only = only;
      var h = '<div class="card"><h3>区域管理</h3><div id="apSum" class="note">進み具合を計算中…</div>' +
        '<label style="display:block;margin:6px 0"><input type="checkbox" id="adOnly"' + (only ? ' checked' : '') + '> 使用中のエリアだけ表示</label><div id="apList"></div></div>' +
        '<div class="card"><h3>1件ずつ追加する</h3><div class="note">CSVを使わずに、1件ずつ追加できます。</div><div class="row"><button class="btn small" data-act="ad:tab" data-v="edit">建物・部屋を追加(区域編集)</button><button class="btn small" data-act="ad:tab" data-v="accounts">アカウント・グループ・担当者を追加</button></div>' +
        '<div class="row" style="margin-top:8px"><input id="newAreaName" class="grow" placeholder="新しい区域の名前(例: 1-4)"><select id="newAreaCat"><option value="国仲">国仲</option><option value="遠方">遠方</option><option value="アパート">アパート</option></select><button class="btn primary small" data-act="ad:addArea">区域を追加</button></div></div>' +
        '<div class="card"><h3>自動終了と記録ドキュメント</h3><div class="note">期限(終了日、または開始日から○か月)が来たエリアは、自動で使用が終わり、記録ドキュメントに完了日が書かれます。</div>' +
        '<button class="btn small" data-act="ad:autoEnd">今すぐ期限を確認する</button><button class="btn small" data-act="ad:newYear">新しい年度のファイルを作る</button></div>';
      body('<div id="arIndex">' + h + '</div><div id="arDetail" class="hidden"></div>');
      drawAreaList(); if (typeof openId === 'string' && openId) renderAreaDetail(openId);
      (C.prog ? Promise.resolve(C.prog) : api('getAreaProgress')).then(function (p) { C.prog = p; drawAreaList(); }, function () { var e = document.getElementById('apSum'); if (e) e.textContent = ''; });
    }, fail);
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function drawAreaList() {
    var el = document.getElementById('apList'); if (!el || !C.ad) return;
    var P = C.prog || {}, list = C.ad.areas.filter(function (a) { return a.active && (!C.only || a.inUse); }), tot = 0, vis = 0;
    el.innerHTML = list.length ? list.map(function (a) {
      var p = P[a.areaId] || { total: 0, visited: 0, buildings: 0, doneBuildings: 0 }; tot += p.total; vis += p.visited;
      return '<button type="button" class="prow' + (a.inUse ? ' use' : '') + '" data-act="ad:areaOpen" data-v="' + esc(a.areaId) + '"><div class="ph"><div class="pn">' + esc(a.areaName) + '<span class="badge ' + (a.inUse ? 'use' : 'off') + '">' + (a.inUse ? '使用中' : (a.expired ? '期限切れ' : '編集不可')) + '</span><span class="badge mine">' + esc(a.category) + '</span></div><div class="pp">' + pct(p.visited, p.total) + '% ▸</div></div>' +
        '<div class="pbar"><i style="width:' + pct(p.visited, p.total) + '%"></i></div><div class="pm"><span>訪問済み ' + p.visited + ' / ' + p.total + '部屋 ・ 完了 ' + p.doneBuildings + ' / ' + p.buildings + '棟</span><span>' + (a.inUse ? esc(a.useStartDate) + ' 〜 ' + esc(a.expiry) : (a.lastDoneDate ? '前回完了 ' + esc(a.lastDoneDate) : '')) + '</span></div>' +
        (a.inUse ? '<div class="pm"><span>担当：' + esc(a.assigneeName) + '</span></div>' : '') + '</button>';
    }).join('') : '<div class="note">表示するエリアがありません。</div>';
    var s = document.getElementById('apSum'); if (s) s.textContent = C.prog ? '全体: 訪問済み ' + vis + ' / ' + tot + '部屋(' + pct(vis, tot) + '%)。エリアを押すと設定を開きます。' : '進み具合を計算中…';
  }
  function renderAreaDetail(id) {
    var a = C.ad.areas.filter(function (x) { return x.areaId === id; })[0], ix = document.getElementById('arIndex'), dv = document.getElementById('arDetail'); if (!a || !dv) return;
    C.openArea = id; ix.classList.add('hidden'); dv.classList.remove('hidden');
    var mine = C.ad.assigns.filter(function (x) { return x.areaId === id; }).length;
    dv.innerHTML = '<div class="card"><div class="row"><b class="grow" style="font-size:1.1em">' + esc(a.areaName) + '</b><button class="btn small" data-act="ad:areaBack">← 一覧へ</button></div>' +
      '<div class="note">areaId: ' + esc(a.areaId) + '</div>' +
      '<div class="fxg"><div class="gt">使用状況</div><div class="fxsw"><span><b>' + (a.inUse ? '使用中' : '使用していません') + '</b><small>' + (a.inUse ? '担当: ' + esc(a.assigneeName) : '使用を開始すると、このエリアに訪問状況を入力できます') + '</small></span>' +
      (a.inUse ? '<button class="btn small" data-act="ad:endForm" data-v="' + esc(id) + '">使用を終了</button>' : '<button class="btn primary small" data-act="ad:startForm" data-v="' + esc(id) + '">使用を開始</button>') + '</div><div id="af-' + esc(id) + '"></div></div>' +
      (a.inUse ? '<div class="fxg"><div class="gt">使用期間</div><div class="fxgrid"><div><label>開始日</label><input type="date" id="arStart" value="' + esc(a.useStartDate) + '"></div><div><label>終了日(空なら開始日から自動)</label><input type="date" id="arEnd" value="' + esc(a.useEndDate) + '"></div></div><button class="btn small" data-act="ad:clearEnd">終了日をクリア</button><small>自動の終了予定: ' + esc(a.expiry) + '</small></div>' : '') +
      '<div class="fxg"><div class="gt">区分</div><select data-cat="' + esc(id) + '">' + ['国仲', '遠方', 'アパート'].map(function (c) { return '<option value="' + c + '"' + (a.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="fxg"><div class="gt">担当グループ・担当者</div><small>' + (mine ? mine + '件を指定中' : '指定なし(区域係だけが編集できます。アパートは誰でも編集可)') + '</small><button class="btn small" data-act="ad:assignForm" data-v="' + esc(id) + '" style="margin-top:6px">担当を選ぶ</button></div>' +
      '<div class="fxg"><div class="gt">メモ</div><textarea id="arNote" rows="3" placeholder="任意">' + esc(a.note) + '</textarea></div>' +
      '<div class="fxg"><div class="row"><button class="btn small" data-act="ad:rename" data-v="' + esc(id) + '">名前を変更</button><button class="btn small" data-act="ad:toggleArea" data-v="' + esc(id) + '" data-on="0">非表示にする</button></div></div>' +
      '<div class="fxact"><button class="btn" data-act="ad:areaBack">キャンセル</button><button class="btn primary" data-act="ad:areaSave" data-v="' + esc(id) + '">保存</button></div></div>';
  }
  function refreshAreas() { C.ad = null; C.prog = null; var o = C.openArea; if (o) loadAreas(o); else go('areas'); }
  function areaName(id) { var a = C.ad.areas.filter(function (x) { return x.areaId === id; })[0]; return a ? a.areaName : ''; }
  function slot(id) { return document.getElementById('af-' + id); }

  // ---------- 区域編集 ----------
  function loadEdit() {
    (C.ad ? Promise.resolve(C.ad) : loadAd()).then(function (d) {
      var h = '<div class="card"><div class="row"><select id="edArea" class="grow">' + opts(d.areas, 'areaId', 'areaName', C.editArea, 'エリアを選んでください') + '</select><label><input type="checkbox" id="edHidden"' + (C.showHidden ? ' checked' : '') + '> 非表示も表示</label></div></div><div id="edBody"></div>';
      body(h); if (C.editArea) loadEditBody();
    }, fail);
  }
  function loadEditBody() {
    api('getDataEdit', { areaId: C.editArea }).then(function (d) { C.edit = d; renderEdit(); }, fail);
  }
  function renderEdit() {
    var d = C.edit, el = document.getElementById('edBody'); if (!el) return;
    var h = '<div class="card"><h3>建物を追加</h3><div class="row"><input id="nbName" class="grow" placeholder="建物の名前"><input id="nbLat" placeholder="緯度" size="10"><input id="nbLng" placeholder="経度" size="10"></div><div class="row"><button class="btn small" data-act="ad:posMap">地図の中心を入れる</button><button class="btn small" data-act="ad:posGps">いまの位置を入れる</button></div><textarea id="nbRooms" rows="2" placeholder="部屋(1行に1つ。空なら「（建物）」の1件を作ります)"></textarea><button class="btn primary small" data-act="ad:addB">追加</button></div>';
    h += '<div class="card"><div class="row"><input id="edFilter" class="grow" placeholder="建物名で絞り込み" value="' + esc(C.filter) + '"></div></div>';
    var bs = d.buildings.filter(function (b) { return (C.showHidden || !isOff(b.active)) && (!C.filter || String(b.buildingName).indexOf(C.filter) >= 0); });
    bs.sort(function (a, b) { return String(a.buildingName) > String(b.buildingName) ? 1 : -1; });
    h += '<div class="note">' + bs.length + '件' + (bs.length > 300 ? '(先頭の300件を表示。絞り込みを使ってください)' : '') + '</div>';
    bs.slice(0, 300).forEach(function (b) {
      var rs = d.rooms.filter(function (r) { return r.buildingId === b.buildingId && (C.showHidden || !isOff(r.active)); }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
      var off = isOff(b.active);
      h += '<details class="bd"><summary>' + esc(b.buildingName) + (off ? '<span class="badge off">非表示</span>' : '') + '<span class="note">　部屋 ' + rs.length + '</span></summary><div class="in">' +
        '<div class="row"><input class="grow" data-b="' + esc(b.buildingId) + '" data-f="buildingName" value="' + esc(b.buildingName) + '"><input class="grow" data-b="' + esc(b.buildingId) + '" data-f="buildingMemo" placeholder="メモ" value="' + esc(b.buildingMemo) + '"></div>' +
        '<div class="row"><input data-b="' + esc(b.buildingId) + '" data-f="lat" size="10" placeholder="緯度" value="' + esc(b.lat) + '"><input data-b="' + esc(b.buildingId) + '" data-f="lng" size="10" placeholder="経度" value="' + esc(b.lng) + '">' +
        '<button class="btn small primary" data-act="ad:saveB" data-v="' + esc(b.buildingId) + '">保存</button><button class="btn small" data-act="ad:activeB" data-v="' + esc(b.buildingId) + '" data-on="' + (off ? '1' : '0') + '">' + (off ? '元に戻す' : '非表示') + '</button>' +
        (off ? '<button class="btn small danger" data-act="ad:purgeB" data-v="' + esc(b.buildingId) + '">完全に削除</button>' : '') + '</div><div class="note">ID: ' + esc(b.buildingId) + '</div>';
      rs.forEach(function (r) {
        var roff = isOff(r.active);
        h += '<div class="row"><input class="grow" data-r="' + esc(r.roomId) + '" data-f="roomName" value="' + esc(r.roomName) + '"><select data-r="' + esc(r.roomId) + '" data-f="mark"><option value="">印なし</option><option value="reject"' + (r.mark === 'reject' ? ' selected' : '') + '>拒否</option><option value="caution"' + (r.mark === 'caution' ? ' selected' : '') + '>注意</option></select>' +
          '<button class="btn small" data-act="ad:saveR" data-v="' + esc(r.roomId) + '">保存</button><button class="btn small" data-act="ad:activeR" data-v="' + esc(r.roomId) + '" data-on="' + (roff ? '1' : '0') + '">' + (roff ? '戻す' : '非表示') + '</button>' + (roff ? '<button class="btn small danger" data-act="ad:purgeR" data-v="' + esc(r.roomId) + '">削除</button>' : '') + '</div>';
      });
      h += '<div class="row"><textarea rows="1" class="grow" id="ar-' + esc(b.buildingId) + '" placeholder="部屋を追加(1行に1つ)"></textarea><button class="btn small" data-act="ad:addRooms" data-v="' + esc(b.buildingId) + '">追加</button></div></div></details>';
    });
    el.innerHTML = h;
  }
  function fields(attr, id) { var o = {}, els = document.querySelectorAll('[data-' + attr + '="' + id + '"]'); for (var i = 0; i < els.length; i++) o[els[i].getAttribute('data-f')] = els[i].value; return o; }

  // ---------- 報告・履歴 ----------
  function loadReports() {
    api('getReports').then(function (rs) {
      body('<div class="card"><h3>届いた報告<span class="cnt">' + rs.length + '</span></h3>' + (rs.length ? rs.map(function (r) { return '<div class="fxg"><div class="row"><b class="grow">' + esc(r.areaName) + ' ' + esc(r.roomName) + '</b><button class="btn small" data-act="ad:delReport" data-v="' + esc(r.reportId) + '">削除</button></div><div style="white-space:pre-wrap">' + esc(r.reportText) + '</div><div class="note">' + esc(r.createdBy) + '　' + esc(String(r.createdAt).slice(0, 16).replace('T', ' ')) + '</div></div>'; }).join('') : '<div class="note">報告はありません。</div>') + '</div>');
    }, fail);
  }
  function loadLogs() {
    api('getLogs').then(function (d) {
      var h = '<div class="card"><h3>エリアの使用記録</h3><table class="t"><tr><th>エリア</th><th>担当</th><th>開始</th><th>終了</th><th>理由</th></tr>' + d.useLogs.map(function (l) { return '<tr><td>' + esc(l.areaName) + '</td><td>' + esc(l.assigneeName) + '</td><td>' + esc(l.startDate) + '</td><td>' + esc(l.endDate) + '</td><td>' + esc(l.endReason) + '</td></tr>'; }).join('') + '</table></div>';
      h += '<div class="card"><h3>更新履歴(新しい順・最大300件)</h3><table class="t"><tr><th>日時</th><th>誰が</th><th>対象</th><th>項目</th><th>変更</th></tr>' + d.history.map(function (l) { return '<tr><td>' + esc(String(l.updatedAt).slice(5, 16).replace('T', ' ')) + '</td><td>' + esc(l.updatedBy) + '</td><td>' + esc(l.targetType) + '</td><td>' + esc(l.fieldName) + '</td><td>' + esc(l.oldValue) + ' → ' + esc(l.newValue) + '</td></tr>'; }).join('') + '</table></div>';
      body(h);
    }, fail);
  }

  // ---------- 一括クリア ----------
  var B = { scope: 'area', area: '', id: '', st: false, memo: false, vac: 'keep', flag: 'keep' };
  function loadBulk() {
    Promise.all([C.ad ? C.ad : loadAd(), api('getLastBulk')]).then(function (r) { C.last = r[1]; drawBulk(); }, fail);
  }
  function bulkTarget() {
    var d = C.ad, h = '';
    if (B.scope === 'area') return '<div class="fxgrid"><div><label>対象エリア</label><select id="bkId">' + opts(d.areas, 'areaId', 'areaName', B.id, 'エリアを選んでください') + '</select></div></div>';
    h = '<div class="fxgrid"><div><label>エリア</label><select id="bkArea">' + opts(d.areas, 'areaId', 'areaName', B.area, 'エリアを選んでください') + '</select></div><div><label>対象の建物</label><select id="bkId">' + (C.bkB ? opts(C.bkB, 'buildingId', 'buildingName', B.id, '建物を選んでください') : '<option value="">(先にエリアを選ぶ)</option>') + '</select></div></div>';
    return h;
  }
  function choice(name, v, cur, t, sub, type) { return '<label class="' + (cur ? 'on' : '') + '"><input type="' + type + '" name="' + name + '" value="' + v + '"' + (cur ? ' checked' : '') + '><b style="display:inline">' + t + '</b><br><small>' + sub + '</small></label>'; }
  function bulkSummary() {
    var nm = ''; var el = document.getElementById('bkId');
    if (el && el.value) nm = el.options[el.selectedIndex].text;
    if (!B.id || !nm) return '<div class="bsum muted">対象を選んでください。</div>';
    if (!B.st && !B.memo) return '<div class="bsum muted">クリアする項目を選んでください。</div>';
    return '<div class="bsum"><b>' + (B.scope === 'area' ? 'エリア' : '建物') + '「' + esc(nm) + '」</b> の <b>' + (B.st && B.memo ? '訪問とメモ' : (B.st ? '訪問' : 'メモ')) + '</b> を消します。<br><small>' + (B.st ? (B.vac === 'keep' ? '空室の部屋はそのまま残します。' : '空室の部屋も含めて消します。') : '') + (B.memo ? (B.flag === 'keep' ? '「注意」「拒否」の部屋のメモは残します。' : '「注意」「拒否」の部屋のメモも消します。') : '') + '</small></div>';
  }
  function drawBulk() {
    var l = C.last, d = C.ad;
    body('<div class="card"><h3>一括クリア</h3><div class="note">新しく回り始めるときなどに、訪問やメモの記録をまとめて消せます。直前の1回分は下の「元に戻す」で復元できます。</div>' +
      '<div class="bstep">対象範囲</div><div class="bseg"><button data-act="ad:bkScope" data-v="area" class="' + (B.scope === 'area' ? 'on' : '') + '">エリアごと</button><button data-act="ad:bkScope" data-v="building" class="' + (B.scope === 'building' ? 'on' : '') + '">建物ごと</button></div>' + bulkTarget() +
      '<div class="bstep">クリアする項目<em>必須</em></div><div class="bchoice">' + choice('bkWhat', 'st', B.st, '訪問', '訪問済み・留守などの記録', 'checkbox') + choice('bkWhat', 'memo', B.memo, 'メモ', '部屋ごとのメモ', 'checkbox') + '</div>' +
      '<div class="bstep">空室の部屋</div><div class="bchoice">' + choice('bkVac', 'keep', B.vac === 'keep', '残す', '空室の記録はそのまま', 'radio') + choice('bkVac', 'clear', B.vac === 'clear', '消す', '空室の部屋もクリア', 'radio') + '</div>' +
      '<div class="bstep">「注意」「拒否」の部屋のメモ</div><div class="bchoice">' + choice('bkFlag', 'keep', B.flag === 'keep', '残す', '次の期にも引き継ぐ', 'radio') + choice('bkFlag', 'clear', B.flag === 'clear', '消す', 'メモもクリア', 'radio') + '</div>' +
      '<div id="bkSum">' + bulkSummary() + '</div><button class="btn danger block" data-act="ad:bulk">一括クリアを実行</button></div>' +
      '<div class="card"><h3>元に戻す</h3>' + (l ? '<div class="bcr"><span>実行日時</span><b>' + esc(String(l.executedAt).slice(5, 16).replace('T', ' ')) + '</b></div><div class="bcr"><span>対象</span><b>' + (l.scopeType === 'building' ? '建物' : 'エリア') + ' ' + esc(l.scopeType === 'building' ? (l.scopeId) : (areaName(l.scopeId) || l.scopeId)) + '</b></div><div class="bcr"><span>消した項目</span><b>' + (l.clearStatus && l.clearMemo ? '訪問とメモ' : (l.clearStatus ? '訪問' : 'メモ')) + '</b></div><div class="bcr"><span>件数</span><b>' + l.count + '件</b></div><div class="bcr"><span>実行した人</span><b>' + esc(l.executedBy) + '</b></div><button class="btn block" data-act="ad:undoBulk">直前の一括クリアを元に戻す</button>' : '<div class="note">元に戻せる一括クリアはありません。</div>') + '</div>');
    var ar = document.getElementById('bkArea');
    if (ar) ar.onchange = function () { B.area = ar.value; B.id = ''; C.bkB = null; if (!B.area) return drawBulk(); api('getDataEdit', { areaId: B.area }).then(function (r) { C.bkB = r.buildings.filter(function (x) { return !isOff(x.active); }); drawBulk(); }, fail); };
    var id = document.getElementById('bkId'); if (id) id.onchange = function () { B.id = id.value; drawBulk(); };
    ['bkWhat', 'bkVac', 'bkFlag'].forEach(function (n) { var es = document.getElementsByName(n); for (var i = 0; i < es.length; i++) es[i].onchange = function () { B.st = document.querySelector('[name=bkWhat][value=st]').checked; B.memo = document.querySelector('[name=bkWhat][value=memo]').checked; B.vac = document.querySelector('[name=bkVac]:checked').value; B.flag = document.querySelector('[name=bkFlag]:checked').value; drawBulk(); }; });
  }
  function modal(title, html, okText, ok) {
    var m = document.getElementById('modal'); if (m) m.parentNode.removeChild(m);
    m = document.createElement('div'); m.id = 'modal'; m.innerHTML = '<div class="mb"><h3>' + esc(title) + '</h3>' + html + '<div class="fxact"><button class="btn" id="mdNo">キャンセル</button><button class="btn danger" id="mdOk">' + esc(okText) + '</button></div></div>';
    document.body.appendChild(m);
    document.getElementById('mdNo').onclick = function () { m.parentNode.removeChild(m); };
    document.getElementById('mdOk').onclick = function () { m.parentNode.removeChild(m); ok(); };
  }
  function bulkRun() {
    if (!B.id) { toast('対象を選んでください。'); return; }
    if (!B.st && !B.memo) { toast('訪問またはメモを選んでください。'); return; }
    var el = document.getElementById('bkId'), nm = el.options[el.selectedIndex].text;
    modal('一括クリアの確認', '<div class="bcr"><span>対象</span><b>' + (B.scope === 'area' ? 'エリア' : '建物') + '「' + esc(nm) + '」</b></div><div class="bcr"><span>消す項目</span><b>' + (B.st && B.memo ? '訪問とメモ' : (B.st ? '訪問' : 'メモ')) + '</b></div>' + (B.st ? '<div class="bcr"><span>空室の部屋</span><b>' + (B.vac === 'keep' ? '残す' : '消す') + '</b></div>' : '') + (B.memo ? '<div class="bcr"><span>注意・拒否のメモ</span><b>' + (B.flag === 'keep' ? '残す' : '消す') + '</b></div>' : '') + '<div class="note">直前の1回分は「元に戻す」で復元できます。</div>', 'クリアする', function () {
      after(api('bulkClear', { scopeType: B.scope, scopeId: B.id, clearStatus: B.st, clearMemo: B.memo, keepVacantStatus: B.vac === 'keep', keepFlaggedMemo: B.flag === 'keep' }), function (r) { return r.count + '件をクリアしました(元に戻せます)。'; }, function () { C.prog = null; loadBulk(); });
    });
  }
  // ---------- アカウント(ユーザー・グループ・担当者) ----------
  function loadAccounts() {
    Promise.all([loadAd(), api('getUsers')]).then(function (r) {
      var d = r[0], us = r[1];
      var h = '<div class="card"><h3>ユーザー(ログイン用)</h3><table class="t"><tr><th>ID</th><th>表示名</th><th>権限</th><th>グループ</th><th></th></tr>' + us.map(function (u) {
        return '<tr><td>' + esc(u.loginId) + (u.locked ? '<span class="badge rej">ロック中</span>' : '') + (u.active ? '' : '<span class="badge off">無効</span>') + '</td><td>' + esc(u.displayName) + '</td><td>' + (u.role === 'admin' ? '区域係' : '奉仕者') + '</td><td>' + esc((d.groups.filter(function (g) { return g.groupId === u.groupId; })[0] || {}).groupName || '') + '</td><td>' +
          '<button class="btn small" data-act="ad:userRole" data-v="' + esc(u.loginId) + '" data-r="' + (u.role === 'admin' ? 'editor' : 'admin') + '">' + (u.role === 'admin' ? '奉仕者にする' : '区域係にする') + '</button>' +
          '<button class="btn small" data-act="ad:userPw" data-v="' + esc(u.loginId) + '">パスワード再設定</button>' + (u.locked ? '<button class="btn small" data-act="ad:userUnlock" data-v="' + esc(u.loginId) + '">ロック解除</button>' : '') +
          '<button class="btn small" data-act="ad:userActive" data-v="' + esc(u.loginId) + '" data-on="' + (u.active ? '0' : '1') + '">' + (u.active ? '無効にする' : '有効にする') + '</button><button class="btn small danger" data-act="ad:userDel" data-v="' + esc(u.loginId) + '">削除</button></td></tr>';
      }).join('') + '</table><div class="row"><input id="nuId" placeholder="ID(半角英数字)" size="12"><input id="nuPw" placeholder="パスワード(6文字以上)" size="14"><input id="nuName" placeholder="表示名" size="10"><select id="nuGroup">' + opts(d.groups.filter(function (g) { return !g.builtin; }), 'groupId', 'groupName', '', 'グループなし') + '</select><select id="nuRole"><option value="editor">奉仕者</option><option value="admin">区域係</option></select><button class="btn primary small" data-act="ad:userAdd">追加</button></div></div>';
      h += '<div class="card"><h3>グループ</h3><div class="note">「会衆」は全員が入っている特別なグループで、変更・削除はできません(区域の担当を「会衆」にすると、ログインした全員が編集できます)。担当者とアカウントは同じデータです。責任者は、そのグループに所属しているアカウントから選びます(アカウントの「グループ」を先に設定してください)。グループの名前を変えても、アカウントの表示は自動で変わります。</div>' + d.groups.filter(function (g) { return !g.builtin; }).map(function (g) {
        var members = us.filter(function (u) { return u.active && String(u.groupId) === String(g.groupId); });
        return '<div class="row"><input class="grow" data-g="' + esc(g.groupId) + '" data-f="groupName" value="' + esc(g.groupName) + '"><select data-g="' + esc(g.groupId) + '" data-f="leaderLoginId">' + opts(members, 'loginId', 'displayName', g.leaderLoginId, members.length ? '責任者なし' : '(所属アカウントなし)') + '</select><button class="btn small" data-act="ad:groupSave" data-v="' + esc(g.groupId) + '">保存</button><button class="btn small danger" data-act="ad:groupDel" data-v="' + esc(g.groupId) + '">削除</button></div>';
      }).join('') +
        '<div class="row"><input id="ngName" class="grow" placeholder="新しいグループ名"><button class="btn primary small" data-act="ad:groupAdd">追加</button></div></div>';
      body(h);
    }, fail);
  }

  // ---------- 動作設定 ----------
  var SET_FIELDS = [['appTitle', 'アプリのタイトル', 'text'], ['mapTileSource', '背景の地図', [['gsi', '地理院タイル'], ['osm', 'OpenStreetMap(事前保存は不可)']]], ['mapLat', '地図の最初の位置(緯度)', 'text'], ['mapLng', '地図の最初の位置(経度)', 'text'], ['mapZoom', '地図の最初の拡大率', 'text'], ['autoEndMonths', '開始日から自動で終了するまでの月数', 'text'], ['fiscalStartMonth', '年度のはじまりの月', 'text'], ['logDocId', '記録用GoogleドキュメントのID', 'text'], ['downloadFolderId', '印刷用PDF・PNGを入れたフォルダのID', 'text']];
  function loadSettings() {
    api('getSettings').then(function (s) {
      body('<div class="card">' + SET_FIELDS.map(function (f) {
        return '<div style="margin:8px 0"><div class="note">' + f[1] + '</div>' + (typeof f[2] === 'string' ? '<input style="width:100%" id="st-' + f[0] + '" value="' + esc(s[f[0]]) + '">' : '<select id="st-' + f[0] + '">' + f[2].map(function (o) { return '<option value="' + o[0] + '"' + (String(s[f[0]]) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') + '</div>';
      }).join('') + '<button class="btn primary" data-act="ad:saveSettings">保存</button></div>');
    }, fail);
  }

  // ---------- 分析 ----------
  function loadAnalysis() {
    api('getAnalysis').then(function (r) {
      body('<div class="card"><h3>次に訪問するエリアの目安</h3><div class="note">「おすすめ度」は、まだ終わっていない部屋の割合と、前回完了からの日数をもとにした点数です(高いほど優先)。「再訪候補」は、留守などで再訪すると会えそうな部屋の数です(拒否の部屋は除く)。</div><table class="t"><tr><th>エリア</th><th>おすすめ度</th><th>進み具合</th><th>残り</th><th>再訪候補</th><th>拒否/注意</th><th>前回完了</th></tr>' +
        r.map(function (a) { return '<tr><td>' + esc(a.areaName) + (a.inUse ? '<span class="badge use">使用中</span>' : '') + '</td><td><b>' + a.score + '</b></td><td><div class="bar"><i style="width:' + Math.round(a.rate * 100) + '%"></i></div>' + Math.round(a.rate * 100) + '% (' + a.done + '/' + a.total + ')</td><td>' + a.remaining + '</td><td>' + a.revisit + '</td><td>' + a.reject + '/' + a.caution + '</td><td>' + esc(a.lastDoneDate || '—') + (a.daysSince != null ? '<div class="note">' + a.daysSince + '日前</div>' : '') + '</td></tr>'; }).join('') + '</table></div>');
    }, fail);
  }

  // ---------- 利用ガイド ----------
  function loadGuide() {
    var items = [['区域管理', '区域の使用の開始・終了、担当グループ・担当者の設定、区分(国仲・遠方・アパート)の変更、区域の追加ができます。期限(終了日、または開始日から○か月)が来た区域は、自動で使用が終わります。'],
      ['一括クリア', '年度の切り替えなどで、区域の訪問状況やメモをまとめて消します。直前の1回は、元に戻せます。'],
      ['報告一覧', '奉仕者から送られた報告を読み、対応したら削除します。'],
      ['区域編集', '建物と部屋を、1件ずつ追加・編集・非表示・削除します。建物の位置(緯度・経度)は、地図の中心や現在地から入れられます。'],
      ['アカウント', 'ログイン用のユーザー(奉仕者・区域係)、グループを管理(担当者とアカウントは同じデータです。「会衆」は全員が入る特別なグループ)します。グループの責任者は、そのグループに所属するアカウントから選びます。'],
      ['動作設定', 'アプリの名前、地図の最初の位置、自動終了までの月数、記録用ドキュメントや印刷用ファイルのフォルダを設定します。'],
      ['履歴・ログ', '区域の使用記録と、データの更新履歴を見られます(閲覧のみ)。'],
      ['分析', '次に訪問する区域の目安(おすすめ度・残り・再訪候補)を表で見られます。'],
      ['取込・書出', 'QGISなどで作ったCSVを取り込みます。建物・部屋の記録を、uuid2つきのCSVで書き出して、QGISに戻せます。']];
    body(items.map(function (x) { return '<div class="card"><h3>' + esc(x[0]) + '</h3>' + esc(x[1]) + '</div>'; }).join(''));
  }

  // ---------- 取込・書出 ----------
  function parseCsv(t) {
    var rows = [], row = [], f = '', q = false, i; t = t.replace(/^﻿/, '');
    for (i = 0; i < t.length; i++) { var c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    var h = rows.shift() || [];
    return rows.filter(function (r) { return r.length > 1 || (r[0] || '') !== ''; }).map(function (r) { var o = {}; h.forEach(function (k, j) { o[k.trim()] = r[j] === undefined ? '' : r[j]; }); return o; });
  }
  var IMPORTS = [['area', 'エリア', 'areaId, areaName, sortOrder, category(国仲/遠方/アパート), …'], ['group', 'グループ', 'groupId, groupName, leaderLoginId(責任者のアカウントID), …'], ['building', '建物', 'buildingId(=uuid2), buildingName, areaId, lat, lng, buildingMemo'], ['room', '部屋', 'roomId, buildingId, areaId, roomName, floor, sortOrder, mark']];
  function loadIO() {
    body('<div class="card"><h3>CSVから取り込む(QGISなどで作ったデータ)</h3><div class="note">同じIDの行は上書き、新しいIDの行は追加されます。順番は、エリア → グループ → 担当者 → 建物 → 部屋 です。</div>' +
      IMPORTS.map(function (x) { return '<div class="row"><b style="min-width:5em">' + x[1] + '</b><input type="file" accept=".csv,text/csv" id="imp-' + x[0] + '"><button class="btn small primary" data-act="ad:import" data-v="' + x[0] + '">取り込む</button></div><div class="note">列: ' + x[2] + '</div>'; }).join('') + '<div class="note" id="impMsg"></div></div>' +
      '<div class="card"><h3>CSVに書き出す(QGISに戻す用)</h3><div class="note">建物は「uuid2・建物名・メモ」、部屋は「部屋ID・uuid2・部屋名・印・訪問状況・メモ」です。QGISでuuid2を目印に結合してください。</div><button class="btn small" data-act="ad:export" data-v="buildings">建物のCSV</button><button class="btn small" data-act="ad:export" data-v="rooms">部屋のCSV</button></div>');
  }
  function doImport(kind) {
    var f = document.getElementById('imp-' + kind).files[0]; if (!f) { toast('CSVファイルを選んでください。'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var rows = parseCsv(String(rd.result)), n = 0, added = 0, upd = 0, msg = document.getElementById('impMsg'), size = 800;
      function next() {
        if (n >= rows.length) { msg.textContent = '完了: 追加 ' + added + '件、上書き ' + upd + '件'; toast('取り込みが終わりました。'); C.ad = null; return; }
        msg.textContent = n + ' / ' + rows.length + ' 件…';
        api('importRows', { kind: kind, rows: rows.slice(n, n + size) }).then(function (r) { added += r.added; upd += r.updated; n += size; next(); }, function (e) { msg.textContent = n + '件目あたりで失敗: ' + e.message; });
      }
      if (!rows.length) { toast('データの行がありません。'); return; } next();
    };
    rd.readAsText(f, 'utf-8');
  }

  // ---------- クリックの処理 ----------
  function bump() { C.ad = null; }
  function after(p, msg, reload) { p.then(function (r) { if (msg) toast(typeof msg === 'function' ? msg(r) : msg); if (reload) reload(); }, fail); }
  SADO.onAdminClick = function (act, t, v) {
    if (act.indexOf('ad:') !== 0) return;
    var a = act.slice(3), on = t.getAttribute('data-on'), f;
    switch (a) {
      case 'close': close(); break;
      case 'tab': go(v); break;
      case 'addArea': after(api('addArea', { areaName: val('newAreaName'), category: val('newAreaCat') }), 'エリアを追加しました。', refreshAreas); break;
      case 'areaOpen': renderAreaDetail(v); break;
      case 'areaBack': C.openArea = ''; loadAreas(); break;
      case 'clearEnd': if ($('#arEnd')) $('#arEnd').value = ''; break;
      case 'areaSave': after(api('saveAreaOps', { areaId: v, useStartDate: val('arStart'), useEndDate: val('arEnd'), note: val('arNote') }), '保存しました。', refreshAreas); break;
      case 'rename': var nm = window.prompt('新しいエリア名', areaName(v)); if (nm) after(api('renameArea', { areaId: v, areaName: nm }), '変更しました。', refreshAreas); break;
      case 'toggleArea': after(api('setActive', { kind: 'area', id: v, active: on === '1' }), '変更しました。', refreshAreas); break;
      case 'startForm':
        slot(v).innerHTML = '<div class="row" style="margin-top:8px"><select id="sfType"><option value="group">グループ(責任者の名前で記録)</option><option value="user">個人</option></select><select id="sfTarget" class="grow"></select></div><div class="row"><label>開始日 <input type="date" id="sfStart" value="' + SADO.today() + '"></label><label>終了日(任意) <input type="date" id="sfEnd"></label></div><div class="note">終了日を空にすると、開始日から' + '設定の月数が過ぎたときに自動で終了します。</div><button class="btn primary small" data-act="ad:start" data-v="' + esc(v) + '">開始する</button>';
        fillTargets(); break;
      case 'start': after(api('startAreaUse', { areaId: v, assigneeType: val('sfType'), assigneeId: val('sfTarget'), startDate: val('sfStart'), endDate: val('sfEnd') }), function (r) { return r && r.warning ? '開始しました。\n(注意) ' + r.warning : '使用を開始しました。'; }, refreshAreas); break;
      case 'endForm': slot(v).innerHTML = '<div class="row" style="margin-top:8px"><label>完了した日 <input type="date" id="efDate" value="' + SADO.today() + '"></label><button class="btn danger small" data-act="ad:end" data-v="' + esc(v) + '">終了する</button></div>'; break;
      case 'end': after(api('endAreaUse', { areaId: v, endDate: val('efDate') }), function (r) { return r && r.warning ? '終了しました。\n(注意) ' + r.warning : '使用を終了しました。'; }, refreshAreas); break;
      case 'assignForm':
        var cur = {}; C.ad.assigns.forEach(function (x) { cur[x.areaId + '|' + x.targetType + ':' + x.targetId] = true; });
        var hasUser = C.ad.users.some(function (u) { return cur[v + '|user:' + u.loginId]; });
        slot(v).innerHTML = '<div style="margin-top:8px"><div class="note">この区域を担当する人を選びます。チェックした人(グループ)だけが編集できます。「会衆」を選ぶと全員が編集できます。</div>' +
          '<div class="bseg"><button data-act="ad:asgMode" data-v="group" id="asgG" class="' + (hasUser ? '' : 'on') + '">グループ</button><button data-act="ad:asgMode" data-v="user" id="asgU" class="' + (hasUser ? 'on' : '') + '">個人</button></div>' +
          '<div id="asgGroup"' + (hasUser ? ' class="hidden"' : '') + '>' + C.ad.groups.map(function (g) { return '<label style="display:block"><input type="checkbox" data-asg="group:' + esc(g.groupId) + '"' + (cur[v + '|group:' + g.groupId] ? ' checked' : '') + '> ' + esc(g.groupName) + '</label>'; }).join('') + '</div>' +
          '<div id="asgUser"' + (hasUser ? '' : ' class="hidden"') + '>' + C.ad.users.filter(function (u) { return u.active; }).map(function (u) { return '<label style="display:block"><input type="checkbox" data-asg="user:' + esc(u.loginId) + '"' + (cur[v + '|user:' + u.loginId] ? ' checked' : '') + '> ' + esc(u.displayName) + '</label>'; }).join('') + '</div>' +
          '<button class="btn primary small" data-act="ad:saveAssign" data-v="' + esc(v) + '">保存</button></div>'; break;
      case 'asgMode': $('#asgGroup').classList.toggle('hidden', v !== 'group'); $('#asgUser').classList.toggle('hidden', v !== 'user'); $('#asgG').classList.toggle('on', v === 'group'); $('#asgU').classList.toggle('on', v === 'user'); break;
      case 'saveAssign': var targets = [], cbs = slot(v).querySelectorAll('[data-asg]'); for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) { var p = cbs[i].getAttribute('data-asg').split(':'); targets.push({ type: p[0], id: p.slice(1).join(':') }); }
        after(api('setAssignments', { areaId: v, targets: targets }), '保存しました。', refreshAreas); break;
      case 'autoEnd': after(api('runAutoEnd'), function (r) { return r.ended.length ? '自動で終了: ' + r.ended.join('、') + (r.warnings.length ? '\n(注意) ' + r.warnings[0] : '') : '期限が来たエリアはありません。'; }, refreshAreas); break;
      case 'newYear': if (window.confirm('今の記録ドキュメントをコピーして、新しい年度のファイルを作ります。各エリアの「前回完了した日付」が転記されます。よろしいですか？')) after(api('createNewYearDoc'), function (r) { return r.label + '年度のファイルを作りました(' + r.areasCarried + '区域を転記)。\n' + r.url; }, null); break;
      // データ編集
      case 'posMap': { var m = SADO.map; if (!m) { toast('地図が開かれていません。'); break; } var c = m.getCenter(); $('#nbLat').value = c.lat.toFixed(6); $('#nbLng').value = c.lng.toFixed(6); toast('地図の中心の位置を入れました。(管理画面を閉じて地図を動かし、もう一度開いて入れ直せます)'); break; }
      case 'posGps': { if (!navigator.geolocation) { toast('位置情報が使えません。'); break; } navigator.geolocation.getCurrentPosition(function (p) { $('#nbLat').value = p.coords.latitude.toFixed(6); $('#nbLng').value = p.coords.longitude.toFixed(6); }, function () { toast('位置を取得できませんでした。'); }, { enableHighAccuracy: true, timeout: 15000 }); break; }
      case 'addB': after(api('createBuilding', { areaId: C.editArea, buildingName: val('nbName'), lat: val('nbLat'), lng: val('nbLng'), rooms: val('nbRooms').split('\n') }), '建物を追加しました。', loadEditBody); break;
      case 'saveB': f = fields('b', v); after(api('updateBuilding', { buildingId: v, buildingName: f.buildingName, buildingMemo: f.buildingMemo, lat: f.lat, lng: f.lng }), '保存しました。', loadEditBody); break;
      case 'activeB': after(api('setActive', { kind: 'building', id: v, active: on === '1' }), '変更しました。', loadEditBody); break;
      case 'purgeB': if (window.prompt('建物と、その部屋・入力データをすべて完全に削除します。取り消せません。続けるには「削除」と入力してください。') === '削除') after(api('purgeItem', { kind: 'building', id: v }), '削除しました。', loadEditBody); break;
      case 'saveR': f = fields('r', v); after(api('updateRoom', { roomId: v, roomName: f.roomName, mark: f.mark }), '保存しました。', loadEditBody); break;
      case 'activeR': after(api('setActive', { kind: 'room', id: v, active: on === '1' }), '変更しました。', loadEditBody); break;
      case 'purgeR': if (window.prompt('部屋と入力データを完全に削除します。続けるには「削除」と入力してください。') === '削除') after(api('purgeItem', { kind: 'room', id: v }), '削除しました。', loadEditBody); break;
      case 'addRooms': after(api('addRooms', { buildingId: v, rooms: val('ar-' + v).split('\n') }), '部屋を追加しました。', loadEditBody); break;
      case 'delReport': after(api('deleteReport', { reportId: v }), null, loadReports); break;
      case 'bulk': bulkRun(); break;
      case 'bkScope': B.scope = v; B.id = ''; B.area = ''; C.bkB = null; drawBulk(); break;
      case 'undoBulk': modal('元に戻す', '<div class="note">直前の一括クリアで消した記録を元に戻します。</div>', '元に戻す', function () { after(api('undoBulk'), function (r) { return r.count + '件を元に戻しました。'; }, function () { C.prog = null; loadBulk(); }); }); break;
      // アカウント
      case 'userAdd': after(api('addUser', { loginId: val('nuId'), password: val('nuPw'), displayName: val('nuName'), groupId: val('nuGroup'), role: val('nuRole') }), 'ユーザーを追加しました。', function () { bump(); loadAccounts(); }); break;
      case 'userRole': after(api('updateUser', { loginId: v, role: t.getAttribute('data-r') }), '変更しました。', loadAccounts); break;
      case 'userActive': after(api('updateUser', { loginId: v, active: on === '1' }), '変更しました。', loadAccounts); break;
      case 'userUnlock': after(api('updateUser', { loginId: v, unlock: true }), 'ロックを解除しました。', loadAccounts); break;
      case 'userPw': var pw = window.prompt('新しいパスワード(6文字以上)'); if (pw) after(api('updateUser', { loginId: v, password: pw }), 'パスワードを変更しました。', null); break;
      case 'userDel': if (window.confirm('ユーザー「' + v + '」を削除します。よろしいですか？')) after(api('deleteUser', { loginId: v }), '削除しました。', loadAccounts); break;
      case 'groupAdd': after(api('saveGroup', { groupName: val('ngName') }), '追加しました。', function () { bump(); loadAccounts(); }); break;
      case 'groupSave': f = fields('g', v); after(api('saveGroup', { groupId: v, groupName: f.groupName, leaderLoginId: f.leaderLoginId }), '保存しました。', function () { bump(); loadAccounts(); }); break;
      case 'groupDel': if (window.confirm('このグループを削除します。よろしいですか？')) after(api('deleteGroup', { groupId: v }), '削除しました。', function () { bump(); loadAccounts(); }); break;
      case 'saveSettings': var vals = {}; SET_FIELDS.forEach(function (x) { vals[x[0]] = val('st-' + x[0]); }); after(api('saveSettings', { values: vals }), '保存しました。', function () { SADO.refreshBootstrap(); }); break;
      case 'import': doImport(v); break;
      case 'export': api('exportCsv', { kind: v }).then(function (r) { SADO.saveBlob(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }), r.filename); }, fail); break;
    }
  };
  function fillTargets() {
    var el = document.getElementById('sfTarget'), ty = document.getElementById('sfType'); if (!el) return;
    var set = function () { el.innerHTML = ty.value === 'group' ? opts(C.ad.groups, 'groupId', 'groupName', '') : opts(C.ad.users.filter(function (u) { return u.active; }), 'loginId', 'displayName', ''); };
    ty.onchange = set; set();
  }
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.getAttribute && t.getAttribute('data-cat')) { api('setAreaCategory', { areaId: t.getAttribute('data-cat'), category: t.value }).then(function () { toast('区分を「' + t.value + '」にしました。'); if (C.ad) C.ad.areas.forEach(function (a) { if (a.areaId === t.getAttribute('data-cat')) a.category = t.value; }); }, fail); return; }
    if (t.id === 'adOnly') { C.only = t.checked; try { localStorage.setItem('adOnlyInUse', t.checked ? '1' : '0'); } catch (e) {} drawAreaList(); return; }
    if (t.id === 'edArea') { C.editArea = t.value; if (C.editArea) loadEditBody(); else document.getElementById('edBody').innerHTML = ''; }
    else if (t.id === 'edHidden') { C.showHidden = t.checked; if (C.edit) renderEdit(); }
    else if (t.id === 'edFilter') { C.filter = t.value; renderEdit(); var e = document.getElementById('edFilter'); if (e) e.focus(); }
  });
  SADO.openAdmin = open;
})();
