/* 佐渡住宅GAS: 管理者画面(管理・データ編集・報告・履歴・一括クリア・アカウント・動作設定・分析・取込書出) */
(function () {
  'use strict';
  var SADO = window.SADO, esc = SADO.esc, $ = SADO.$, toast = SADO.toast;
  var TABS = [['areas', '区域管理'], ['bulk', '一括クリア'], ['reports', '報告一覧'], ['edit', '区域編集'], ['accounts', 'アカウント'], ['settings', '動作設定'], ['logs', '履歴・ログ'], ['analysis', '分析'], ['io', '取込・書出'], ['guide', '利用ガイド']];
  var tab = 'areas', C = { ad: null, editArea: '', showHidden: false, filter: '', seq: 0 };
  // データを読み込む呼び出し(get〜)は、読み込み中に別のタブへ切り替えたら結果を捨てる(古いタブの内容で画面が上書きされて、切り替わらなく見えるのを防ぐ)
  function api(a, p) {
    var my = C.seq, q = SADO.api(a, p);
    if (a.indexOf('get') !== 0) return q;
    return new Promise(function (res, rej) { q.then(function (r) { if (my === C.seq) res(r); }, function (e) { if (my === C.seq) rej(e); }); });
  }
  // 読み込み中・処理中は、画面をグレーにして、くるくるを出す
  function busy(on) {
    var m = document.getElementById('adMask'), a = $('#admin'), b = $('#adBody');
    if (!on) { if (m && m.parentNode) m.parentNode.removeChild(m); return; }
    if (m || !a || !b) return;
    m = document.createElement('div'); m.id = 'adMask'; m.innerHTML = '<i class="spin"></i>';
    m.style.top = Math.max(0, b.getBoundingClientRect().top) + 'px'; a.appendChild(m);
  }
  function body(h) { var b = $('#adBody'); if (b) b.innerHTML = h; busy(false); }
  // 項目名と配置だけ先に出す(中身は読み込めたら入る)
  var SKEL = { areas: ['区域管理', '1件ずつ追加する', '自動終了と記録ドキュメント'], bulk: ['一括クリア', '元に戻す'], reports: ['届いた報告'], edit: ['エリアを選ぶ'], accounts: ['ユーザーを追加', 'ユーザー', 'グループ'], settings: ['動作設定'], logs: ['エリアの使用記録', '更新履歴'], analysis: ['分析'], io: ['取り込み', '書き出し'], guide: ['利用ガイド'] };
  function skeleton(t) { return (SKEL[t] || ['']).map(function (n) { return '<div class="card"><h3>' + esc(n) + '</h3><div class="sk"></div><div class="sk"></div><div class="sk short"></div></div>'; }).join(''); }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function fail(e) { busy(false); toast(e.message || String(e), 6000); }
  function opts(list, valKey, labKey, sel, blank) { return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (x) { return '<option value="' + esc(x[valKey]) + '"' + (String(x[valKey]) === String(sel) ? ' selected' : '') + '>' + esc(x[labKey]) + '</option>'; }).join(''); }
  function isOff(v) { return v === false || String(v).toLowerCase() === 'false'; }

  function open() { var a = $('#admin'); a.classList.remove('hidden'); a.innerHTML = '<div class="mhead"><div class="t">区域係モード</div><button data-act="ad:close">✕</button></div><div class="tabs scroll">' + TABS.map(function (t) { return '<button class="tab" data-act="ad:tab" data-v="' + t[0] + '" id="adt-' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div class="mbody" id="adBody"></div>'; go(tab); }
  function close() { $('#admin').classList.add('hidden'); if (SADO.activeNav) SADO.activeNav('map'); SADO.refreshBootstrap(); }
  function go(t) {
    tab = t; TABS.forEach(function (x) { var b = $('#adt-' + x[0]); if (b) b.classList.toggle('on', x[0] === t); });
    C.seq++; body(skeleton(t)); busy(true);
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
        '<div class="row" style="margin-top:8px"><input id="newAreaName" class="grow" placeholder="新しい区域の名前(例: 1-4)"><select id="newAreaCat"><option value="国仲">国仲</option><option value="遠方">遠方</option></select><button class="btn primary small" data-act="ad:addArea">区域を追加</button></div></div>' +
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
    var cur = {}; C.ad.assigns.forEach(function (x) { if (x.areaId === id) cur[x.targetType + ':' + x.targetId] = true; });
    var hasUser = C.ad.users.some(function (u) { return cur['user:' + u.loginId]; }), hasAll = !!cur['group:all'], hasGrp = C.ad.groups.some(function (g) { return !g.builtin && cur['group:' + g.groupId]; });
    var mode = hasUser ? 'user' : (hasAll && !hasGrp ? 'all' : 'group'), on = !!a.storedInUse;
    C.arOn0 = on;
    dv.innerHTML = '<div class="card"><div class="row dh"><button class="btn small" data-act="ad:areaBack">← 一覧へ</button><b class="grow" style="font-size:1.1em">' + esc(a.areaName) + '</b><span class="badge mine">' + esc(a.category) + '</span></div>' +
      '<div class="fxg"><label class="fxsw"><span><b>使用中</b><small>オンにすると、この区域に訪問状況を入力できます</small></span><input type="checkbox" class="sw" id="arIn"' + (on ? ' checked' : '') + '></label>' +
      (a.expired ? '<div class="note" style="color:var(--danger)">使用期間が終わっています。「保存」を押すか、日付を変えてください。</div>' : '') + '</div>' +
      '<div id="arOn"' + (on ? '' : ' class="hidden"') + '>' +
        '<div class="fxg"><div class="gt">担当<small style="display:inline;margin-left:6px">チェックした人(グループ)だけが編集できます</small></div>' +
          '<div class="bseg">' + [['group', 'グループ'], ['user', '個人'], ['all', '会衆']].map(function (m) { return '<button data-act="ad:asgMode" data-v="' + m[0] + '" id="asg-' + m[0] + '" class="' + (mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>' +
          '<div id="asgGroup"' + (mode === 'group' ? '' : ' class="hidden"') + '>' + C.ad.groups.filter(function (g) { return !g.builtin; }).map(function (g) { return '<label class="asg"><input type="checkbox" data-asg="group:' + esc(g.groupId) + '"' + (cur['group:' + g.groupId] ? ' checked' : '') + '> ' + esc(g.groupName) + '</label>'; }).join('') + '</div>' +
          '<div id="asgUser"' + (mode === 'user' ? '' : ' class="hidden"') + '><input type="search" id="asgQ" placeholder="名前で探す" style="width:100%;margin-bottom:4px">' + C.ad.users.filter(function (u) { return u.active; }).map(function (u) { return '<label class="asg" data-name="' + esc((u.displayName + ' ' + u.loginId).toLowerCase()) + '"><input type="checkbox" data-asg="user:' + esc(u.loginId) + '"' + (cur['user:' + u.loginId] ? ' checked' : '') + '> ' + esc(u.displayName) + '</label>'; }).join('') + '</div>' +
          '<div id="asgAll"' + (mode === 'all' ? '' : ' class="hidden"') + '><label class="asg"><input type="checkbox" data-asg="group:all"' + (hasAll ? ' checked' : '') + '> 会衆(ログインした全員)</label></div>' +
          '<small>' + (a.category === 'アパート' ? 'アパートは、誰も選ばなくても全員が編集できます。' : '選ばないと、使用を開始できません。') + '</small></div>' +
        '<div class="fxg"><div class="gt">使用期間</div><div class="fxgrid"><div><label>開始日</label><input type="date" id="arStart" value="' + esc(a.useStartDate || (on ? '' : SADO.today())) + '"></div><div><label>終了日</label><input type="date" id="arEnd" value="' + esc(a.useEndDate) + '"></div></div><button class="btn small" data-act="ad:clearEnd">終了日をクリア</button>' +
          '<label class="fxsw" style="margin-top:12px"><span><b>終了日で自動的に使用を終える</b><small>オンにすると、終了日の翌日(終了日が空なら、開始日から「動作設定」の月数が過ぎたとき)に、自動で使用が終わります</small></span><input type="checkbox" class="sw" id="arAuto"' + (a.autoEnd ? ' checked' : '') + '></label></div>' +
      '</div>' +
      '<div id="arOff"' + (on ? ' class="hidden"' : '') + '><div class="fxg" id="arEndRow" class="hidden"></div></div>' +
      '<div class="fxg"><div class="gt">メモ</div><textarea id="arNote" rows="3" placeholder="任意">' + esc(a.note) + '</textarea></div>' +
      '<div class="fxact"><button class="btn" data-act="ad:areaBack">キャンセル</button><button class="btn primary" data-act="ad:areaSave" data-v="' + esc(id) + '">保存</button></div></div>';
  }
  function areaSave(id) {
    var inUse = $('#arIn').checked, targets = [], cbs = document.querySelectorAll('#arOn [data-asg]');
    for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) { var p = cbs[i].getAttribute('data-asg').split(':'); targets.push({ type: p[0], id: p.slice(1).join(':') }); }
    var payload = { areaId: id, inUse: inUse, note: val('arNote') };
    if (inUse) { payload.targets = targets; payload.useStartDate = val('arStart'); payload.useEndDate = val('arEnd'); payload.autoEnd = $('#arAuto').checked; }
    var go1 = function (extra) {
      for (var k in extra) payload[k] = extra[k];
      after(api('saveAreaOps', payload), function (r) { return r && r.warning ? '保存しました。\n(注意) ' + r.warning : '保存しました。'; }, refreshAreas);
    };
    if (!inUse && C.arOn0) {
      var a = C.ad.areas.filter(function (x) { return x.areaId === id; })[0];
      modal('使用を終了する', '<div class="note">「' + esc(a.areaName) + '」の使用を終了し、記録ドキュメントに完了日を書き込みます。</div><label style="display:block;margin-top:8px">完了した日 <input type="date" id="arDone" value="' + SADO.today() + '"></label>', '終了する', function () { go1({ endDate: val('arDone') }); }, 'primary');
    } else go1({});
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
    var ar = C.ad && C.ad.areas.filter(function (x) { return x.areaId === C.editArea; })[0], h = '';
    if (ar) h += '<div class="card"><h3>エリアの設定</h3><div class="row"><span class="note">区分</span><select data-cat="' + esc(ar.areaId) + '">' + ['国仲', '遠方'].map(function (c) { return '<option value="' + c + '"' + (ar.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select><button class="btn small" data-act="ad:rename" data-v="' + esc(ar.areaId) + '">名前を変更</button><button class="btn small" data-act="ad:toggleArea" data-v="' + esc(ar.areaId) + '" data-on="0">非表示にする</button></div><div class="note">区分は基本的に変更しません(使用の開始・終了や担当は「区域管理」で行います)。</div></div>';
    h += '<div class="card"><h3>建物を追加</h3><div class="row"><input id="nbName" class="grow" placeholder="建物の名前"><input id="nbLat" placeholder="緯度" size="10"><input id="nbLng" placeholder="経度" size="10"></div><div class="row"><button class="btn small" data-act="ad:posMap">地図の中心を入れる</button><button class="btn small" data-act="ad:posGps">いまの位置を入れる</button></div><textarea id="nbRooms" rows="2" placeholder="部屋(1行に1つ。空なら「（建物）」の1件を作ります)"></textarea><button class="btn primary small" data-act="ad:addB">追加</button></div>';
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
  function modal(title, html, okText, ok, cls) {
    var m = document.getElementById('modal'); if (m) m.parentNode.removeChild(m);
    m = document.createElement('div'); m.id = 'modal'; m.innerHTML = '<div class="mb"><h3>' + esc(title) + '</h3>' + html + '<div class="fxact"><button class="btn" id="mdNo">キャンセル</button><button class="btn ' + (cls || 'danger') + '" id="mdOk">' + esc(okText) + '</button></div></div>';
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
  // ---------- アカウント(ユーザー・グループ) ----------
  // 「編集」を押すと、その一覧の各項目が書き換えられるようになり、「保存」で変更をまとめて確認して保存する
  var A = { us: [], editU: false, editG: false, ud: {}, gd: {}, q: '', fg: '', fr: '' };
  function loadAccounts() {
    Promise.all([loadAd(), api('getUsers')]).then(function (r) {
      A.us = r[1]; A.editU = false; A.editG = false; A.ud = {}; A.gd = {};
      drawAccounts();
    }, fail);
  }
  function realGroups() { return C.ad.groups.filter(function (g) { return !g.builtin; }); }
  function groupName(id) { var g = C.ad.groups.filter(function (x) { return x.groupId === id; })[0]; return g ? g.groupName : ''; }
  function drawAccounts() {
    var d = C.ad;
    body('<div class="card"><h3>ユーザーを追加</h3><div class="row"><input id="nuId" placeholder="ID(半角英数字)" size="11"><input id="nuPw" placeholder="パスワード(6文字以上)" size="13"><input id="nuName" placeholder="表示名" size="10"><select id="nuGroup">' + opts(realGroups(), 'groupId', 'groupName', '', 'グループなし') + '</select><select id="nuRole"><option value="editor">奉仕者</option><option value="admin">区域係</option></select><button class="btn primary small" data-act="ad:userAdd">追加</button></div></div>' +
      '<div class="card"><h3>ユーザー<span class="cnt" id="usCnt"></span></h3><div class="tbar"><input type="search" id="usQ" placeholder="ID・名前で探す" value="' + esc(A.q) + '"><select id="usFg"><option value="">すべてのグループ</option><option value="-">グループなし</option>' + opts(realGroups(), 'groupId', 'groupName', A.fg) + '</select><select id="usFr"><option value="">すべての権限</option><option value="admin">区域係</option><option value="editor">奉仕者</option></select></div>' +
      '<div class="tbar" id="usBtns"></div><div id="usList"></div></div>' +
      '<div class="card"><h3>グループ</h3><div class="note">「会衆」は全員が入っている特別なグループです(区域の担当を「会衆」にすると、ログインした全員が編集できます)。責任者は、そのグループに所属しているアカウントから選びます(会衆だけは全アカウントから選べます)。担当者とアカウントは同じデータです。</div><div class="tbar" id="grBtns"></div><div id="grList"></div>' +
      '<div class="row" style="margin-top:10px"><input id="ngName" class="grow" placeholder="新しいグループ名"><button class="btn primary small" data-act="ad:groupAdd">追加</button></div></div>');
    $('#usFr').value = A.fr; drawUsers(); drawGroups();
  }
  function btns(edit, kind) {
    return edit ? '<button class="btn small primary" data-act="ad:' + kind + 'Save">保存</button><button class="btn small" data-act="ad:' + kind + 'Cancel">キャンセル</button><span class="cnts">各項目を書き換えて「保存」を押してください</span>' : '<button class="btn small" data-act="ad:' + kind + 'Edit">編集</button>';
  }
  function uval(u, f) { var x = A.ud[u.loginId]; return x && x[f] !== undefined ? x[f] : u[f]; }
  function drawUsers() {
    var q = A.q.trim().toLowerCase(), n = 0, h = '';
    A.us.forEach(function (u) {
      var grp = String(uval(u, 'groupId') || '');
      if (q && (String(u.loginId) + ' ' + String(uval(u, 'displayName'))).toLowerCase().indexOf(q) < 0) return;
      if (A.fg && (A.fg === '-' ? grp : grp !== A.fg)) return;
      if (A.fr && uval(u, 'role') !== A.fr) return;
      n++;
      var chg = !!A.ud[u.loginId], id = esc(u.loginId);
      if (A.editU) {
        h += '<div class="urow' + (chg ? ' chg' : '') + '"><div class="un"><b>' + id + '</b>' + (u.locked ? '<span class="badge rej">ロック中</span>' : '') + '<input data-ue="' + id + '" data-f="displayName" value="' + esc(uval(u, 'displayName')) + '" placeholder="表示名"></div>' +
          '<select data-ue="' + id + '" data-f="groupId">' + opts(realGroups(), 'groupId', 'groupName', grp, 'グループなし') + '</select><select data-ue="' + id + '" data-f="role"><option value="editor"' + (uval(u, 'role') === 'editor' ? ' selected' : '') + '>奉仕者</option><option value="admin"' + (uval(u, 'role') === 'admin' ? ' selected' : '') + '>区域係</option></select>' +
          '<label><input type="checkbox" data-ue="' + id + '" data-f="active"' + (uval(u, 'active') ? ' checked' : '') + '> 有効</label></div>';
      } else {
        h += '<div class="urow"><div class="un"><b>' + esc(u.displayName) + (u.active ? '' : '<span class="badge off">無効</span>') + (u.locked ? '<span class="badge rej">ロック中</span>' : '') + '</b><small>' + id + '</small></div><div class="ug">' + esc(groupName(u.groupId) || '―') + '</div><span class="badge ' + (u.role === 'admin' ? 'mine' : 'off') + '">' + (u.role === 'admin' ? '区域係' : '奉仕者') + '</span>' +
          '<details><summary>操作</summary><div class="row"><button class="btn small" data-act="ad:userPw" data-v="' + id + '">パスワード再設定</button>' + (u.locked ? '<button class="btn small" data-act="ad:userUnlock" data-v="' + id + '">ロック解除</button>' : '') + '<button class="btn small danger" data-act="ad:userDel" data-v="' + id + '">削除</button></div></details></div>';
      }
    });
    $('#usList').innerHTML = h || '<div class="note">該当するユーザーがいません。</div>';
    $('#usCnt').textContent = n + ' / ' + A.us.length; $('#usBtns').innerHTML = btns(A.editU, 'u');
  }
  function gval(g, f) { var x = A.gd[g.groupId]; return x && x[f] !== undefined ? x[f] : g[f]; }
  function drawGroups() {
    var h = '';
    C.ad.groups.forEach(function (g) {
      var id = esc(g.groupId), active = A.us.filter(function (u) { return u.active; });
      var cands = g.builtin ? active : active.filter(function (u) { return String(u.groupId) === String(g.groupId); });
      if (A.editG) {
        h += '<div class="urow' + (A.gd[g.groupId] ? ' chg' : '') + '"><div class="un">' + (g.builtin ? '<b>会衆</b><small>名前は変えられません</small>' : '<input data-ge="' + id + '" data-f="groupName" value="' + esc(gval(g, 'groupName')) + '">') + '</div><select data-ge="' + id + '" data-f="leaderLoginId">' + opts(cands, 'loginId', 'displayName', gval(g, 'leaderLoginId'), cands.length ? '責任者なし' : '(所属アカウントなし)') + '</select></div>';
      } else {
        var ld = A.us.filter(function (u) { return u.loginId === g.leaderLoginId; })[0];
        h += '<div class="urow"><div class="un"><b>' + esc(g.groupName) + '</b><small>' + (g.builtin ? '全員が入る特別なグループ' : '所属 ' + A.us.filter(function (u) { return String(u.groupId) === String(g.groupId); }).length + '人') + '</small></div><div class="ug">責任者: ' + esc(ld ? ld.displayName : '―') + '</div>' + (g.builtin ? '' : '<button class="btn small danger" data-act="ad:groupDel" data-v="' + id + '">削除</button>') + '</div>';
      }
    });
    $('#grList').innerHTML = h; $('#grBtns').innerHTML = btns(A.editG, 'g');
  }
  var USER_LABEL = { displayName: '表示名', groupId: 'グループ', role: '権限', active: '有効' };
  function showVal(f, v) { return f === 'groupId' ? (groupName(v) || 'グループなし') : (f === 'role' ? (v === 'admin' ? '区域係' : '奉仕者') : (f === 'active' ? (v ? '有効' : '無効') : String(v))); }
  function userChanges() {
    var out = [];
    A.us.forEach(function (u) {
      var d = A.ud[u.loginId]; if (!d) return; var ch = {}, lines = [];
      Object.keys(d).forEach(function (f) { var a = f === 'active' ? !!u.active : (u[f] || ''), b = d[f]; if (String(a) !== String(b)) { ch[f] = b; lines.push(USER_LABEL[f] + ': ' + showVal(f, a) + ' → ' + showVal(f, b)); } });
      if (lines.length) out.push({ key: u.loginId, title: u.displayName + '(' + u.loginId + ')', lines: lines, payload: Object.assign({ loginId: u.loginId }, ch) });
    });
    return out;
  }
  function groupChanges() {
    var out = [];
    C.ad.groups.forEach(function (g) {
      var d = A.gd[g.groupId]; if (!d) return; var ch = {}, lines = [];
      if (d.groupName !== undefined && d.groupName !== g.groupName) { ch.groupName = d.groupName; lines.push('名前: ' + g.groupName + ' → ' + d.groupName); }
      if (d.leaderLoginId !== undefined && String(d.leaderLoginId) !== String(g.leaderLoginId || '')) {
        var nm = function (id) { var u = A.us.filter(function (x) { return x.loginId === id; })[0]; return u ? u.displayName : '責任者なし'; };
        ch.leaderLoginId = d.leaderLoginId; lines.push('責任者: ' + nm(g.leaderLoginId) + ' → ' + nm(d.leaderLoginId));
      }
      if (lines.length) out.push({ key: g.groupId, title: g.groupName, lines: lines, payload: Object.assign({ groupId: g.groupId }, ch), builtin: g.builtin });
    });
    return out;
  }
  function confirmSave(kind) {
    var list = kind === 'u' ? userChanges() : groupChanges();
    if (!list.length) { toast('変更はありません。'); if (kind === 'u') { A.editU = false; A.ud = {}; drawUsers(); } else { A.editG = false; A.gd = {}; drawGroups(); } return; }
    modal((kind === 'u' ? 'ユーザー' : 'グループ') + 'の保存の確認', '<div class="note">次の ' + list.length + ' 件を保存します。内容を確認してください。</div><div style="max-height:50vh;overflow:auto">' +
      list.map(function (c) { return '<div class="chgrow"><b>' + esc(c.title) + '</b>' + c.lines.map(function (l) { return '<span>' + esc(l) + '</span><br>'; }).join('') + '</div>'; }).join('') + '</div>', '保存する', function () {
        var calls = kind === 'u' ? [api('updateUsers', { changes: list.map(function (c) { return c.payload; }) })] : [];
        if (kind === 'g') {
          var norm = list.filter(function (c) { return !c.builtin; }), kai = list.filter(function (c) { return c.builtin; })[0];
          if (norm.length) calls.push(api('saveGroups', { changes: norm.map(function (c) { return c.payload; }) }));
          if (kai && kai.payload.leaderLoginId !== undefined) calls.push(api('setKaishuLeader', { leaderLoginId: kai.payload.leaderLoginId }));
        }
        after(Promise.all(calls), list.length + '件を保存しました。', function () { bump(); loadAccounts(); });
      }, 'primary');
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
    var items = [['区域管理', '区域の使用の開始・終了、担当グループ・担当者の設定、区分(国仲・遠方)の変更、区域の追加ができます。期限(終了日、または開始日から○か月)が来た区域は、自動で使用が終わります。'],
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
  var IMPORTS = [['area', 'エリア', 'areaId, areaName, sortOrder, category(国仲/遠方), …'], ['group', 'グループ', 'groupId, groupName, leaderLoginId(責任者のアカウントID), …'], ['building', '建物', 'buildingId(=uuid2), buildingName, areaId, lat, lng, buildingMemo'], ['room', '部屋', 'roomId, buildingId, areaId, roomName, floor, sortOrder, mark']];
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
  function after(p, msg, reload) { busy(true); p.then(function (r) { if (msg) toast(typeof msg === 'function' ? msg(r) : msg); if (reload) reload(); else busy(false); }, fail); }
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
      case 'areaSave': areaSave(v); break;
      case 'rename': var nm = window.prompt('新しいエリア名', areaName(v)); if (nm) after(api('renameArea', { areaId: v, areaName: nm }), '変更しました。', function () { bump(); go('edit'); }); break;
      case 'toggleArea': after(api('setActive', { kind: 'area', id: v, active: on === '1' }), '変更しました。', function () { bump(); go('edit'); }); break;
      case 'asgMode': ['group', 'user', 'all'].forEach(function (m) { $('#asg' + m.charAt(0).toUpperCase() + m.slice(1)).classList.toggle('hidden', m !== v); $('#asg-' + m).classList.toggle('on', m === v); }); break;
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
      case 'uEdit': A.editU = true; A.ud = {}; drawUsers(); break;
      case 'uCancel': A.editU = false; A.ud = {}; drawUsers(); break;
      case 'uSave': confirmSave('u'); break;
      case 'gEdit': A.editG = true; A.gd = {}; drawGroups(); break;
      case 'gCancel': A.editG = false; A.gd = {}; drawGroups(); break;
      case 'gSave': confirmSave('g'); break;
      case 'userAdd': after(api('addUser', { loginId: val('nuId'), password: val('nuPw'), displayName: val('nuName'), groupId: val('nuGroup'), role: val('nuRole') }), 'ユーザーを追加しました。', function () { bump(); loadAccounts(); }); break;
      case 'userUnlock': after(api('updateUser', { loginId: v, unlock: true }), 'ロックを解除しました。', loadAccounts); break;
      case 'userPw': var pw = window.prompt('新しいパスワード(6文字以上)'); if (pw) after(api('updateUser', { loginId: v, password: pw }), 'パスワードを変更しました。', null); break;
      case 'userDel': if (window.confirm('ユーザー「' + v + '」を削除します。よろしいですか？')) after(api('deleteUser', { loginId: v }), '削除しました。', loadAccounts); break;
      case 'groupAdd': after(api('saveGroup', { groupName: val('ngName') }), '追加しました。', function () { bump(); loadAccounts(); }); break;
      case 'groupDel': if (window.confirm('このグループを削除します。よろしいですか？')) after(api('deleteGroup', { groupId: v }), '削除しました。', function () { bump(); loadAccounts(); }); break;
      case 'saveSettings': var vals = {}; SET_FIELDS.forEach(function (x) { vals[x[0]] = val('st-' + x[0]); }); after(api('saveSettings', { values: vals }), '保存しました。', function () { SADO.refreshBootstrap(); }); break;
      case 'import': doImport(v); break;
      case 'export': api('exportCsv', { kind: v }).then(function (r) { SADO.saveBlob(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }), r.filename); }, fail); break;
    }
  };
  document.addEventListener('input', function (ev) { var t = ev.target; if (t.id === 'asgQ') { var q = t.value.trim().toLowerCase(), ls = document.querySelectorAll('#asgUser .asg'); for (var i = 0; i < ls.length; i++) ls[i].classList.toggle('hidden', !!q && ls[i].getAttribute('data-name').indexOf(q) < 0); } else if (t.id === 'usQ') { A.q = t.value; drawUsers(); } else if (t.getAttribute && t.getAttribute('data-ue') && t.getAttribute('data-f') === 'displayName') { var k = t.getAttribute('data-ue'); (A.ud[k] = A.ud[k] || {}).displayName = t.value; t.closest('.urow').classList.add('chg'); } });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.getAttribute && t.getAttribute('data-cat')) { api('setAreaCategory', { areaId: t.getAttribute('data-cat'), category: t.value }).then(function () { toast('区分を「' + t.value + '」にしました。'); if (C.ad) C.ad.areas.forEach(function (a) { if (a.areaId === t.getAttribute('data-cat')) a.category = t.value; }); }, fail); return; }
    if (t.getAttribute && t.getAttribute('data-ue')) { var k = t.getAttribute('data-ue'), f = t.getAttribute('data-f'); (A.ud[k] = A.ud[k] || {})[f] = f === 'active' ? t.checked : t.value; t.closest('.urow').classList.add('chg'); return; }
    if (t.getAttribute && t.getAttribute('data-ge')) { var gk = t.getAttribute('data-ge'); (A.gd[gk] = A.gd[gk] || {})[t.getAttribute('data-f')] = t.value; t.closest('.urow').classList.add('chg'); return; }
    if (t.id === 'arIn') { $('#arOn').classList.toggle('hidden', !t.checked); return; }
    if (t.id === 'usFg') { A.fg = t.value; drawUsers(); return; }
    if (t.id === 'usFr') { A.fr = t.value; drawUsers(); return; }
    if (t.id === 'adOnly') { C.only = t.checked; try { localStorage.setItem('adOnlyInUse', t.checked ? '1' : '0'); } catch (e) {} drawAreaList(); return; }
    if (t.id === 'edArea') { C.editArea = t.value; if (C.editArea) loadEditBody(); else document.getElementById('edBody').innerHTML = ''; }
    else if (t.id === 'edHidden') { C.showHidden = t.checked; if (C.edit) renderEdit(); }
    else if (t.id === 'edFilter') { C.filter = t.value; renderEdit(); var e = document.getElementById('edFilter'); if (e) e.focus(); }
  });
  SADO.openAdmin = open;
})();
