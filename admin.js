/* 佐渡住宅GAS: 管理者画面(管理・データ編集・報告・履歴・一括クリア・アカウント・動作設定・分析・取込書出) */
(function () {
  'use strict';
  var SADO = window.SADO, esc = SADO.esc, $ = SADO.$, toast = SADO.toast;
  var TABS = [['areas', '区域管理'], ['bulk', '一括クリア'], ['reports', '報告一覧'], ['edit', '区域編集'], ['accounts', 'アカウント'], ['settings', '動作設定'], ['logs', '履歴・ログ'], ['analysis', '分析'], ['io', '取込・書出'], ['guide', '利用ガイド']];
  var MODE = 'admin'; // 'admin'=管理メニュー(区域編集を除く) / 'edit'=編集メニュー(区域編集だけ)
  function isMaint() { return !!(SADO.S && SADO.S.user && SADO.S.user.role === 'maintainer'); }
  function tabsNow() { return MODE === 'edit' ? TABS.filter(function (t) { return t[0] === 'edit'; }) : TABS.filter(function (t) { return t[0] !== 'edit'; }); }
  var tab = 'areas', C = { ad: null, editArea: '', showHidden: false, filter: '', seq: 0, cat: '国仲', q: '', exp: {} };
  // データを読み込む呼び出し(get〜)は、読み込み中に別のタブへ切り替えたら結果を捨てる(古いタブの内容で画面が上書きされて、切り替わらなく見えるのを防ぐ)
  var CACHE = {}, REV = 0, QUIET_ = true;
  function ckey(a, p) { return a + '|' + JSON.stringify(p || {}); }
  function clone(o) { return o === undefined ? o : JSON.parse(JSON.stringify(o)); }
  // 書き込みのあとは、覚えていたデータをすべて捨てる(古いデータが出ないように)。区域メニューなど、ほかの画面も裏で最新にする
  function invalidate() { CACHE = {}; REV++; }
  SADO.adminInvalidate = invalidate;
  function typing() { var e = document.activeElement, b = $('#adBody'); return !!(e && b && b.contains(e) && /INPUT|TEXTAREA|SELECT/.test(e.tagName)); }
  function api(a, p) {
    var my = C.seq;
    if (a.indexOf('get') !== 0) {
      invalidate();
      var w = SADO.api(a, p, QUIET_);
      w.then(function () { invalidate(); if (SADO.refreshBootstrap) SADO.refreshBootstrap(); }, function () {});
      return w;
    }
    var key = ckey(a, p), hit = CACHE[key], rev = REV;
    var f = SADO.api(a, p, QUIET_).then(function (r) { if (rev === REV) CACHE[key] = r; return r; });
    if (hit !== undefined) { // すでに持っているものは、すぐ出す。裏で取り直して、変わっていたら描き直す
      f.then(function (r) { if (rev === REV && my === C.seq && JSON.stringify(r) !== JSON.stringify(hit) && !typing() && !document.getElementById('modal')) go(tab); }, function () {});
      return new Promise(function (res) { res(clone(hit)); }).then(function (r) { if (my !== C.seq) return new Promise(function () {}); return r; });
    }
    return new Promise(function (res, rej) { f.then(function (r) { if (my === C.seq) res(clone(r)); }, function (e) { if (my === C.seq) rej(e); }); });
  }
  var PRE_ = ['getAdminAreas', 'getProgress', 'getUsers', 'getReports', 'getSettings'];
  SADO.prefetchAdmin = function () { // 管理メニューのデータを、先に取っておく(開いたときに、待たずに出る)
    var rev = REV; PRE_.reduce(function (pr, a) { return pr.then(function () { return SADO.api(a, {}, true).then(function (r) { if (rev === REV) { CACHE[ckey(a, {})] = r; if (a === 'getAdminAreas') { C.ad = r; C.adT = Date.now(); } if (a === 'getProgress') C.prog = r; } }, function () {}); }); }, Promise.resolve());
  };
  // 読み込み中・処理中は、画面をグレーにして、くるくるを出す
  function busy(on) {
    var m = document.getElementById('adMask'), a = $('#admin'), b = $('#adBody');
    if (!on) { if (m && m.parentNode) m.parentNode.removeChild(m); return; }
    if (m || !a || !b) return;
    var gl = document.getElementById('loading'); if (gl) gl.classList.add('hidden');
    m = document.createElement('div'); m.id = 'adMask'; // くるくるは出さない(押し間違いを防ぐための、見えない覆いだけ)
    m.style.top = Math.max(0, b.getBoundingClientRect().top) + 'px'; a.appendChild(m);
  }
  function body(h) { var b = $('#adBody'); if (b) b.innerHTML = h; busy(false); }
  // 項目名と配置だけ先に出す(中身は読み込めたら入る)
  var SKEL = { areas: ['区域管理', '1件ずつ追加する', '自動終了と記録ドキュメント'], bulk: ['一括クリア', '元に戻す'], reports: ['届いた報告'], edit: ['区域を選ぶ'], accounts: ['ユーザーを追加', 'ユーザー', 'グループ'], settings: ['動作設定'], logs: ['区域の使用記録', '更新履歴'], analysis: ['分析'], io: ['取り込み', '書き出し'], guide: ['利用ガイド'] };
  function skeleton(t) { return (SKEL[t] || ['']).map(function (n) { return '<div class="card"><h3>' + esc(n) + '</h3><div class="sk"></div><div class="sk"></div><div class="sk short"></div></div>'; }).join(''); }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function fail(e) { busy(false); toast(e.message || String(e), 6000); }
  function opts(list, valKey, labKey, sel, blank) { return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (x) { return '<option value="' + esc(x[valKey]) + '"' + (String(x[valKey]) === String(sel) ? ' selected' : '') + '>' + esc(x[labKey]) + '</option>'; }).join(''); }
  // 小さな区域の選択肢を、大きな区域ごとにまとめて出す(親区域そのものは含めない)
  function areaOpts(list, sel, blank) {
    var kids = list.filter(function (a) { return !a.isParent; }), pn = {}; list.forEach(function (a) { if (a.isParent) pn[a.areaId] = a.areaName; });
    var by = {}, order = [], loose = [];
    kids.forEach(function (a) { if (a.parentId && pn[a.parentId]) { if (!by[a.parentId]) { by[a.parentId] = []; order.push(a.parentId); } by[a.parentId].push(a); } else loose.push(a); });
    var o = function (a) { return '<option value="' + esc(a.areaId) + '"' + (String(a.areaId) === String(sel) ? ' selected' : '') + '>' + esc(a.areaName) + '</option>'; };
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + loose.map(o).join('') + order.map(function (id) { return '<optgroup label="' + esc(pn[id]) + '">' + by[id].map(o).join('') + '</optgroup>'; }).join('');
  }
  function isOff(v) { return v === false || String(v).toLowerCase() === 'false'; }

  function open(mode) {
    MODE = mode === 'edit' ? 'edit' : 'admin'; tab = MODE === 'edit' ? 'edit' : (tab === 'edit' ? 'areas' : tab);
    var a = $('#admin'), u = SADO.S && SADO.S.user; a.classList.remove('hidden');
    a.innerHTML = '<div class="mhead"><div class="t">' + (SADO.S.settings && SADO.S.settings.menuTitleEnabled === false ? '' : esc(MODE === 'edit' ? '編集' : ((SADO.S.settings && SADO.S.settings.appTitle) || '佐渡住宅GAS'))) + '</div>' + SADO.userInline() + '<button data-act="ad:close" aria-label="閉じる">✕</button></div>' +
      
      (MODE === 'edit' ? '' : '<div class="tabs grid">' + tabsNow().map(function (t) { return '<button class="tab" data-act="ad:tab" data-v="' + t[0] + '" id="adt-' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>') + '<div class="mbody" id="adBody"></div>';
    go(tab);
  }
  function close() { $('#admin').classList.add('hidden'); if (SADO.activeNav) SADO.activeNav('map'); SADO.refreshBootstrap(); }
  function go(t) {
    tab = t; TABS.forEach(function (x) { var b = $('#adt-' + x[0]); if (b) b.classList.toggle('on', x[0] === t); });
    C.seq++; var warm = Object.keys(CACHE).some(function (k) { return /^(getAdminAreas|getReports|getUsers|getSettings)\|/.test(k) && ({ areas: 'getAdminAreas', edit: 'getAdminAreas', reports: 'getReports', accounts: 'getUsers', settings: 'getSettings' }[t] === k.split('|')[0]); });
    if (!warm) { body(skeleton(t)); busy(true); }
    var f = { areas: loadAreas, edit: loadEdit, reports: loadReports, logs: loadLogs, bulk: loadBulk, accounts: loadAccounts, settings: loadSettings, analysis: loadAnalysis, io: loadIO, guide: loadGuide }[t];
    f();
  }
  // 区域の一覧は、直前に読んだものがあれば、そのまま使う(1分以内。変更したときは作り直す)
  function loadAd() {
    return api('getAdminAreas').then(function (d) { C.ad = d; C.adT = Date.now(); return d; });
  }

  // ---------- 管理(区域の使用・担当) ----------
  function loadAreas(openId) {
    C.openArea = '';
    loadAd().then(function (d) {
      var only = true; try { var sv = localStorage.getItem('adOnlyInUse'); only = sv === null ? true : sv === '1'; } catch (e) {}
      C.only = only;
      var h = '<div class="card"><h3>区域管理</h3>' + SADO.progLegend() +
        '<div id="apCats"></div><input type="search" id="arQ" class="homeq" placeholder="区域名で探す" value="' + esc(C.q || '') + '"><label style="display:block;margin:6px 0"><input type="checkbox" id="adOnly"' + (only ? ' checked' : '') + '> 使用中の区域のみ表示</label><div id="apList" class="ptree"></div></div>' +
        '<details class="card" id="arMore"><summary><b>その他の操作</b></summary><div class="note" style="margin-top:8px">区域・建物・部屋の追加は「区域編集」、アカウント・グループ・担当者の追加は「アカウント」から行えます。</div><div class="row"><button class="btn small" data-act="ad:tab" data-v="edit">区域編集を開く</button><button class="btn small" data-act="ad:tab" data-v="accounts">アカウントを開く</button></div>' +
        '<div class="note" style="margin-top:10px">期限(終了日、または開始日から○か月)が来た区域は、自動で使用が終わり、記録ドキュメントに完了日が書かれます。</div>' +
        '<div class="row"><button class="btn small" data-act="ad:autoEnd">今すぐ期限を確認する</button><button class="btn small" data-act="ad:newYear">新しい年度のファイルを作る</button></div></details>';
      body('<div id="arIndex">' + h + '</div><div id="arDetail" class="hidden"></div>');
      drawAreaList(); if (typeof openId === 'string' && openId) renderAreaDetail(openId);
      SADO.api('getProgress', {}, true).then(function (p) { C.prog = p; drawAreaList(); }, function () { var e = document.getElementById('apSum'); if (e) e.textContent = ''; });
    }, fail);
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  // 区域管理の一覧: 区分 → 大きな区域(親) → 小さな区域(子)。大きな区域の右の▸で、中の小さな区域を開く
  function kidsOf(pid) { return C.ad.areas.filter(function (x) { return x.active && x.parentId === pid && !x.isParent; }); }
  function sumProg(list) { var P = C.prog || {}, t = { total: 0, visited: 0, buildings: 0, doneBuildings: 0, c: {} }; list.forEach(function (k) { var p = P[k.areaId]; if (p) { t.total += p.total; t.visited += p.visited; t.buildings += p.buildings; t.doneBuildings += p.doneBuildings; for (var q in (p.c || {})) t.c[q] = (t.c[q] || 0) + p.c[q]; } }); return t; }
  function progRow(a, p, extra, cls, kids, open) {
    return '<div class="pgrp"><button type="button" class="prow grow' + (a.inUse ? ' use' : '') + (cls || '') + '" data-act="ad:areaOpen" data-v="' + esc(a.areaId) + '"><div class="ph"><div class="pn">' + esc(a.areaName) + (a.inUse ? '<span class="badge use">使用中</span>' : (a.expired ? '<span class="badge off">期限切れ</span>' : '')) + (kids ? '<span class="badge mine">子区域 ' + kids + '件</span>' : '') + '</div><div class="pp">' + pct(p.visited, p.total) + '%</div></div>' +
      SADO.progBar(p) + '<div class="pm"><span>訪問済み ' + p.visited + ' / ' + p.total + '件' + (a.category === 'アパート' ? ' ・ 完了 ' + p.doneBuildings + ' / ' + p.buildings + '棟' : '') + '</span><span>' + (a.inUse ? esc(SADO.fmtJa(a.useStartDate)) + '〜' + esc(SADO.fmtJa(a.expiry)) : (a.lastDoneDate ? '前回完了 ' + esc(a.lastDoneDate) : '')) + '</span></div>' +
      (a.inUse ? '<div class="pm"><span>' + (a.autoEnd ? '自動終了：オン' : '自動終了：オフ') + '</span><span>担当：' + esc(a.assigneeName) + '</span></div>' : '') + (extra || '') + '</button>' + (kids ? '<button type="button" class="btn small pexp" data-act="ad:parExp" data-v="' + esc(a.areaId) + '" aria-label="開閉">' + (open ? '▾' : '▸') + '</button>' : '') + '</div>';
  }
  function drawAreaList() {
    var el = document.getElementById('apList'); if (!el || !C.ad) return;
    var all = C.ad.areas.filter(function (a) { return a.active; }), hasPar = all.some(function (a) { return a.isParent; });
    var cats = ['国仲', '遠方', 'アパート'], cc = document.getElementById('apCats');
    if (cc) cc.innerHTML = !hasPar ? '' : '<div class="seg">' + cats.map(function (c) { return '<button class="chip' + (C.cat === c ? ' on' : '') + '" data-act="ad:catTab" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div>';
    var q = (C.q || '').replace(/[\s　]/g, '').toLowerCase(), hit = function (a) { return !q || a.areaName.replace(/[\s　]/g, '').toLowerCase().indexOf(q) >= 0; };
    var P = C.prog || {}, empty = { total: 0, visited: 0, buildings: 0, doneBuildings: 0, c: {} }, h = '', n = 0;
    var inCatA = function (a) { return !hasPar || a.category === C.cat; };
    var parents = all.filter(function (a) { return a.isParent && inCatA(a); }), loose = all.filter(function (a) { return !a.isParent && !a.parentId && inCatA(a); });
    parents.forEach(function (pa) {
      var ks = kidsOf(pa.areaId), shown = ks.filter(function (k) { return hit(k) && (!C.only || k.inUse); });
      var self = hit(pa) && (!C.only || pa.inUse || ks.some(function (k) { return k.inUse; }));
      if (!(self && (!q || hit(pa))) && !shown.length) return;
      if (C.only && !pa.inUse && !shown.length) return;
      n++;
      var open = !!C.exp[pa.areaId] || (!!q && shown.length && !hit(pa)), p = sumProg(ks);
      if (open) h += '<div class="pgroup">' + progRow(pa, p, '', '', ks.length, open) + '<div class="pkids">' + shown.map(function (k) { return progRow(k, P[k.areaId] || empty, '', ' child', 0); }).join('') + '</div></div>';
      else h += progRow(pa, p, '', '', ks.length, open);
    });
    loose.filter(function (a) { return hit(a) && (!C.only || a.inUse); }).forEach(function (a) { n++; h += progRow(a, P[a.areaId] || empty, '', '', 0); });
    el.innerHTML = h || '<div class="note">表示する区域がありません。</div>';
    var tp = sumProg(all.filter(function (a) { return !a.isParent; })), s = document.getElementById('apSum');
    if (s) s.textContent = C.prog ? '全体: 訪問済み ' + tp.visited + ' / ' + tp.total + '件(' + pct(tp.visited, tp.total) + '%)。大きな区域を押すと、グループ担当などの設定を開きます。右の ▸ で、中の小さな区域を開きます。' : '進み具合を計算中…';
  }
  function renderAreaDetail(id) {
    var a = C.ad.areas.filter(function (x) { return x.areaId === id; })[0], ix = document.getElementById('arIndex'), dv = document.getElementById('arDetail'); if (!a || !dv) return;
    C.openArea = id; ix.classList.add('hidden'); dv.classList.remove('hidden');
    var cur = {}; C.ad.assigns.forEach(function (x) { if (x.areaId === id) cur[x.targetType + ':' + x.targetId] = true; });
    var hasUser = C.ad.users.some(function (u) { return cur['user:' + u.loginId]; }), hasAll = !!cur['group:all'], hasGrp = C.ad.groups.some(function (g) { return !g.builtin && cur['group:' + g.groupId]; });
    var mode = hasUser ? 'user' : (hasAll && !hasGrp ? 'all' : (a.isParent || hasGrp ? 'group' : 'user')), on = !!a.storedInUse, modes = [['user', '個人'], ['group', 'グループ'], ['all', '会衆']];
    var par = a.isParent ? null : (a.parentId ? C.ad.areas.filter(function (x) { return x.areaId === a.parentId; })[0] : null), nKids = a.isParent ? kidsOf(a.areaId).length : 0;
    C.arOn0 = on;
    dv.innerHTML = '<div class="card"><div class="row dh"><button class="btn small" data-act="ad:areaBack">← 一覧へ</button><b class="grow" style="font-size:1.1em">' + esc(a.areaName) + '</b><span class="badge mine">' + esc(a.category) + '</span></div>' +
      (a.isParent ? '<div class="note">大きな区域です。使用を開始すると、中の小さな区域 ' + nKids + '件がすべて対象になります(グループ・会衆・個人のどれでも担当を決められます)。小さな区域ごとに別の人が担当する場合は、小さな区域を個別に設定してください。</div>' : (par ? '<div class="note">大きな区域「' + esc(par.areaName) + '」' + (par.inUse ? 'が使用中のため、この区域も使用中です(担当: ' + esc(par.assigneeName) + ')。個別の設定は、大きな区域の使用が終わったあと、または個人担当にしたいときに使います。' : 'に所属しています。') + '</div>' : '')) +
      '<div class="fxg"><label class="fxsw"><span><b>使用中</b><small>オンにすると、この区域に訪問状況を入力できます</small></span><input type="checkbox" class="sw" id="arIn"' + (on ? ' checked' : '') + '></label>' +
      (a.expired ? '<div class="note" style="color:var(--danger)">使用期間が終わっています。「保存」を押すか、日付を変えてください。</div>' : '') + '</div>' +
      '<div id="arOn"' + (on ? '' : ' class="hidden"') + '>' +
        '<div class="fxg"><div class="gt">担当<small style="display:inline;margin-left:6px">チェックした人(グループ)だけが編集できます</small></div>' +
          '<div class="bseg">' + modes.map(function (m) { return '<button data-act="ad:asgMode" data-v="' + m[0] + '" id="asg-' + m[0] + '" class="' + (mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>' +
          '<div id="asgGroup"' + (mode === 'group' ? '' : ' class="hidden"') + '>' + C.ad.groups.filter(function (g) { return !g.builtin; }).map(function (g) { return '<label class="asg"><input type="checkbox" data-asg="group:' + esc(g.groupId) + '"' + (cur['group:' + g.groupId] ? ' checked' : '') + '> ' + esc(g.groupName) + '</label>'; }).join('') + '</div>' +
          '<div id="asgUser"' + (mode === 'user' ? '' : ' class="hidden"') + '><input type="search" id="asgQ" placeholder="名前で探す" style="width:100%;margin-bottom:4px">' + C.ad.users.filter(function (u) { return u.active; }).map(function (u) { return '<label class="asg" data-name="' + esc((u.displayName + ' ' + u.loginId).toLowerCase()) + '"><input type="checkbox" data-asg="user:' + esc(u.loginId) + '"' + (cur['user:' + u.loginId] ? ' checked' : '') + '> ' + esc(u.displayName) + '</label>'; }).join('') + '</div>' +
          '<div id="asgAll"' + (mode === 'all' ? '' : ' class="hidden"') + '><div class="note">会衆: ログインした全員が編集できます。</div></div>' +
          '<small>' + (a.category === 'アパート' ? 'アパートは、誰も選ばなくても全員が編集できます。' : '選ばないと、使用を開始できません。') + '</small></div>' +
        '<div class="fxg"><div class="gt">使用期間</div><div class="fxgrid"><div><label>開始日</label><input type="date" id="arStart" value="' + esc(a.useStartDate || (on ? '' : SADO.today())) + '"></div><div><label>終了日</label><input type="date" id="arEnd" value="' + esc(a.useEndDate) + '"></div></div><button class="btn small" data-act="ad:clearEnd">終了日をクリア</button>' +
          '<label class="fxsw" style="margin-top:12px"><span><b>終了日で自動的に使用を終える</b><small>オンにすると、終了日の翌日(終了日が空なら、開始日から「動作設定」の月数が過ぎたとき)に、自動で使用が終わります</small></span><input type="checkbox" class="sw" id="arAuto"' + (a.autoEnd ? ' checked' : '') + '></label></div>' +
      '</div>' +
      '<div id="arOff"' + (on ? ' class="hidden"' : '') + '><div class="fxg" id="arEndRow" class="hidden"></div></div>' +
      '<div class="fxg"><div class="gt">メモ</div><textarea id="arNote" rows="3" placeholder="任意">' + esc(a.note) + '</textarea></div>' +
      '<div class="fxact"><button class="btn" data-act="ad:areaBack">キャンセル</button><button class="btn primary" data-act="ad:areaSave" data-v="' + esc(id) + '">保存</button></div></div>';
  }
  function areaSave(id) {
    var inUse = $('#arIn').checked, targets = [], md = document.querySelector('#arOn .bseg button.on'), mode = md ? md.getAttribute('data-v') : 'group';
    // 今開いている担当の方法(個人・グループ・会衆)の分だけを送る(隠れているほうのチェックは無視する)
    if (mode === 'all') targets.push({ type: 'group', id: 'all' });
    else {
      var cbs = document.querySelectorAll('#' + (mode === 'user' ? 'asgUser' : 'asgGroup') + ' [data-asg]');
      for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) { var p = cbs[i].getAttribute('data-asg').split(':'); targets.push({ type: p[0], id: p.slice(1).join(':') }); }
    }
    var payload = { areaId: id, inUse: inUse, note: val('arNote') };
    if (inUse) { payload.targets = targets; payload.useStartDate = val('arStart'); payload.useEndDate = val('arEnd'); payload.autoEnd = $('#arAuto').checked; }
    var go1 = function (extra) {
      for (var k in extra) payload[k] = extra[k];
      opt(function () { return api('saveAreaOps', payload); }, function (r) { return r && r.warning ? '保存しました。\n(注意) ' + r.warning : '保存しました。'; }, function () {
        patchById(C.ad.areas, 'areaId', id, function (a) {
          a.note = payload.note; a.inUse = a.storedInUse = !!payload.inUse; a.expired = false;
          if (payload.inUse) {
            a.useStartDate = payload.useStartDate || a.useStartDate || SADO.today(); a.useEndDate = payload.useEndDate || ''; a.expiry = a.useEndDate || a.expiry; a.autoEnd = !!payload.autoEnd;
            var names = (payload.targets || []).map(function (t) { var o = t.type === 'group' ? C.ad.groups.filter(function (g) { return g.groupId === t.id; })[0] : C.ad.users.filter(function (u) { return u.loginId === t.id; })[0]; return o ? (o.groupName || o.displayName) : ''; }).filter(Boolean);
            if (payload.targets) { a.assigneeName = names.join('、'); C.ad.assigns = C.ad.assigns.filter(function (x) { return x.areaId !== id; }).concat(payload.targets.map(function (t) { return { areaId: id, targetType: t.type, targetId: t.id }; })); }
          } else if (payload.endDate) a.lastDoneDate = payload.endDate;
        });
      }, showAreaList);
    };
    if (!inUse && C.arOn0) {
      var a = C.ad.areas.filter(function (x) { return x.areaId === id; })[0];
      modal('使用を終了する', '<div class="note">「' + esc(a.areaName) + '」の使用を終了し、記録ドキュメントに完了日を書き込みます。</div><label style="display:block;margin-top:8px">完了した日 <input type="date" id="arDone" value="' + SADO.today() + '"></label>', '終了する', function () { go1({ endDate: val('arDone') }); }, 'primary');
    } else go1({});
  }
  function refreshAreas() { C.ad = null; var o = C.openArea; if (o) loadAreas(o); else go('areas'); }
  function areaName(id) { var a = C.ad.areas.filter(function (x) { return x.areaId === id; })[0]; return a ? a.areaName : ''; }
  function slot(id) { return document.getElementById('af-' + id); }

  // ---------- 区域編集 ----------
  function catOf(d, a) { if (a.category) return a.category; var p = a.parentId && d.areas.filter(function (x) { return x.areaId === a.parentId; })[0]; return p ? (p.category || '') : ''; }
  function loadEdit() {
    (C.ad ? Promise.resolve(C.ad) : loadAd()).then(function (d) {
      var cats = ['国仲', '遠方', 'アパート'], cur = C.editArea && d.areas.filter(function (x) { return x.areaId === C.editArea; })[0];
      if (!C.editCat) C.editCat = cur ? (catOf(d, cur) || '国仲') : '国仲';
      var list = d.areas.filter(function (a) { return (catOf(d, a) || '国仲') === C.editCat; });
      if (C.editArea && !list.filter(function (x) { return x.areaId === C.editArea; })[0]) C.editArea = '';
      if (isMaint()) { var okIds = {}; (SADO.S.areas || []).forEach(function (x) { if (x.canEdit) okIds[x.areaId] = 1; }); d = C.ad = { areas: d.areas.filter(function (x) { return okIds[x.areaId] || x.isParent; }) }; }
      var ed = SADO.editOn && SADO.editOn(), h = '<div class="card"><h3>地図で編集する</h3><div class="note">地図を見ながら、建物の追加・移動、' + (isMaint() ? '' : '区域の追加・枠の修正を') + 'します。先に地図で小さな区域を選んでください。</div><div class="row"><button class="btn primary" data-act="ad:editMode">' + (ed ? '編集モードを終了する' : '編集モードにする(地図へ)') + '</button></div></div><div class="card"><h3>一覧で編集する</h3><div class="note">名前の変更、部屋の追加、非表示など、細かい編集はここから。区分を選び、区域を選んでください。</div>' +
        '<div class="seg" id="edCats">' + cats.map(function (c) { return '<button class="chip' + (C.editCat === c ? ' on' : '') + '" data-act="ad:edCat" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div>' +
        '<div class="row"><select id="edArea" class="grow">' + areaOpts(list, C.editArea, '区域を選んでください') + '</select><label><input type="checkbox" id="edHidden"' + (C.showHidden ? ' checked' : '') + '> 非表示も表示</label></div>' +
        (isMaint() ? '' : '<div class="row" style="margin-top:6px"><input id="newAreaName" class="grow" placeholder="新しい区域の名前(例: 1-4)"><button class="btn primary small" data-act="ad:addArea">＋ 区域を追加</button></div>') + '</div><div id="edBody"></div>';
      body(h); if (C.editArea) loadEditBody();
    }, fail);
  }
  function loadEditBody() {
    api('getDataEdit', { areaId: C.editArea }).then(function (d) { C.edit = d; renderEdit(); }, fail);
  }
  function renderEdit() {
    var d = C.edit, el = document.getElementById('edBody'); if (!el) return;
    var ar = C.ad && C.ad.areas.filter(function (x) { return x.areaId === C.editArea; })[0], h = '';
    if (ar && !isMaint()) h += '<div class="card"><h3>区域の設定</h3><div class="row"><span class="note">区分</span><select data-cat="' + esc(ar.areaId) + '">' + ['国仲', '遠方', 'アパート'].map(function (c) { return '<option value="' + c + '"' + (ar.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select><button class="btn small" data-act="ad:rename" data-v="' + esc(ar.areaId) + '">名前を変更</button><button class="btn small" data-act="ad:toggleArea" data-v="' + esc(ar.areaId) + '" data-on="0">非表示にする</button></div><div class="note">区分は基本的に変更しません(使用の開始・終了や担当は「区域管理」で行います)。</div></div>';
    h += '<div class="card"><h3>建物を追加</h3><div class="row"><input id="nbName" class="grow" placeholder="建物の名前"><input id="nbLat" placeholder="緯度" size="10"><input id="nbLng" placeholder="経度" size="10"></div><div class="row"><button class="btn small" data-act="ad:posMap">地図の中心を入れる</button><button class="btn small" data-act="ad:posGps">いまの位置を入れる</button></div><textarea id="nbRooms" rows="2" placeholder="部屋(1行に1つ。空なら「（建物）」の1件を作ります)"></textarea><button class="btn primary small" data-act="ad:addB">追加</button></div>';
    if (!isMaint()) h += '<div class="card"><details id="mvBox"' + (C.mvOpen ? ' open' : '') + '><summary><b>建物をまとめて別の区域へ移す</b></summary><div class="note">アパートの区域づくりなどに使います。移したい建物にチェックを入れ、移す先の区域を選びます。(絞り込みも使えます)</div>' +
      '<div id="mvList"></div><div class="row"><select id="mvTo" class="grow">' + areaOpts(C.ad.areas.filter(function (x) { return x.areaId !== C.editArea; }), '', '移す先の区域を選んでください') + '</select><button class="btn small primary" data-act="ad:mvGo">チェックした建物を移す</button></div></details></div>' +
      '<div class="card"><div class="row"><input id="edFilter" class="grow" placeholder="建物名で絞り込み" value="' + esc(C.filter) + '"></div></div>';
    var bs = d.buildings.filter(function (b) { return (C.showHidden || !isOff(b.active)) && (!C.filter || String(b.buildingName).indexOf(C.filter) >= 0); });
    bs.sort(function (a, b) { return String(a.buildingName) > String(b.buildingName) ? 1 : -1; });
    h += '<div class="note">' + bs.length + '件' + (bs.length > 300 ? '(先頭の300件を表示。絞り込みを使ってください)' : '') + '</div>';
    var mvHtml = '<div class="row"><label><input type="checkbox" id="mvAll"> 表示中の ' + Math.min(bs.length, 300) + ' 件をすべて選ぶ</label></div><div style="max-height:30vh;overflow:auto">' + bs.slice(0, 300).map(function (b) { return '<label class="asg"><input type="checkbox" data-mv="' + esc(b.buildingId) + '"> ' + esc(b.buildingName || '(名前なし)') + '</label>'; }).join('') + '</div>';
    bs.slice(0, 300).forEach(function (b) {
      var rs = d.rooms.filter(function (r) { return r.buildingId === b.buildingId && (C.showHidden || !isOff(r.active)); }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
      var off = isOff(b.active);
      h += '<details class="bd"><summary>' + esc(b.buildingName) + (off ? '<span class="badge off">非表示</span>' : '') + '<span class="note">　部屋 ' + rs.length + '</span></summary><div class="in">' +
        '<div class="row"><input class="grow" data-b="' + esc(b.buildingId) + '" data-f="buildingName" value="' + esc(b.buildingName) + '"><input class="grow" data-b="' + esc(b.buildingId) + '" data-f="buildingMemo" placeholder="メモ" value="' + esc(b.buildingMemo) + '"></div>' +
        '<div class="row"><input data-b="' + esc(b.buildingId) + '" data-f="lat" size="10" placeholder="緯度" value="' + esc(b.lat) + '"><input data-b="' + esc(b.buildingId) + '" data-f="lng" size="10" placeholder="経度" value="' + esc(b.lng) + '">' +
        '<button class="btn small primary" data-act="ad:saveB" data-v="' + esc(b.buildingId) + '">保存</button><button class="btn small" data-act="ad:activeB" data-v="' + esc(b.buildingId) + '" data-on="' + (off ? '1' : '0') + '">' + (off ? '元に戻す' : '非表示') + '</button>' +
        (off && !isMaint() ? '<button class="btn small danger" data-act="ad:purgeB" data-v="' + esc(b.buildingId) + '">完全に削除</button>' : '') + '</div><div class="note">ID: ' + esc(b.buildingId) + '</div>';
      rs.forEach(function (r) {
        var roff = isOff(r.active);
        h += '<div class="row"><input class="grow" data-r="' + esc(r.roomId) + '" data-f="roomName" value="' + esc(r.roomName) + '"><input data-r="' + esc(r.roomId) + '" data-f="floor" size="3" placeholder="階" title="階" value="' + esc(r.floor) + '"><select data-r="' + esc(r.roomId) + '" data-f="mark"><option value="">印なし</option><option value="reject"' + (r.mark === 'reject' ? ' selected' : '') + '>拒否</option><option value="caution"' + (r.mark === 'caution' ? ' selected' : '') + '>注意</option></select>' +
          '<button class="btn small" data-act="ad:saveR" data-v="' + esc(r.roomId) + '">保存</button><button class="btn small" data-act="ad:activeR" data-v="' + esc(r.roomId) + '" data-on="' + (roff ? '1' : '0') + '">' + (roff ? '戻す' : '非表示') + '</button>' + (roff && !isMaint() ? '<button class="btn small danger" data-act="ad:purgeR" data-v="' + esc(r.roomId) + '">削除</button>' : '') + '</div>';
      });
      h += '<div class="row"><textarea rows="1" class="grow" id="ar-' + esc(b.buildingId) + '" placeholder="部屋を追加(1行に1つ)"></textarea><button class="btn small" data-act="ad:addRooms" data-v="' + esc(b.buildingId) + '">追加</button></div></div></details>';
    });
    el.innerHTML = h; var mv = document.getElementById('mvList'); if (mv) mv.innerHTML = mvHtml;
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
      var h = '<div class="card"><h3>区域の使用記録</h3><table class="t"><tr><th>区域</th><th>担当</th><th>開始</th><th>終了</th><th>理由</th></tr>' + d.useLogs.map(function (l) { return '<tr><td>' + esc(l.areaName) + '</td><td>' + esc(l.assigneeName) + '</td><td>' + esc(l.startDate) + '</td><td>' + esc(l.endDate) + '</td><td>' + esc(l.endReason) + '</td></tr>'; }).join('') + '</table></div>';
      h += '<div class="card"><h3>更新履歴(新しい順・最大300件)</h3><table class="t"><tr><th>日時</th><th>誰が</th><th>対象</th><th>項目</th><th>変更</th></tr>' + d.history.map(function (l) { return '<tr><td>' + esc(String(l.updatedAt).slice(5, 16).replace('T', ' ')) + '</td><td>' + esc(l.updatedBy) + '</td><td>' + esc(l.targetType) + '</td><td>' + esc(l.fieldName) + '</td><td>' + esc(l.oldValue) + ' → ' + esc(l.newValue) + '</td></tr>'; }).join('') + '</table></div>';
      body(h);
    }, fail);
  }

  // ---------- 一括クリア ----------
  var B = { cat: '国仲', scope: 'area', area: '', id: '', st: false, memo: false, vac: 'keep', flag: 'keep' };
  function loadBulk() {
    Promise.all([C.ad ? C.ad : loadAd(), api('getLastBulk')]).then(function (r) { C.last = r[1]; drawBulk(); }, fail);
  }
  function bulkTarget() {
    var d = { areas: C.ad.areas.filter(function (a) { return (a.category || '国仲') === B.cat; }) }, h = '';
    if (B.scope === 'area') { var ps = d.areas.filter(function (a) { return a.isParent; }), po = ps.length ? '<optgroup label="親区域(中の子区域すべて)">' + ps.map(function (a) { return '<option value="p:' + esc(a.areaId) + '"' + ('p:' + a.areaId === String(B.id) ? ' selected' : '') + '>' + esc(a.areaName) + '(すべての子区域)</option>'; }).join('') + '</optgroup>' : '', ao = areaOpts(d.areas, B.id, '区域を選んでください'), i0 = ao.indexOf('</option>') + 9; return '<div class="fxgrid"><div><label>対象区域(親区域を選ぶと、中の子区域すべてが対象)</label><select id="bkId">' + ao.slice(0, i0) + po + ao.slice(i0) + '</select></div></div>'; }
    h = '<div class="fxgrid"><div><label>区域</label><select id="bkArea">' + areaOpts(d.areas, B.area, '区域を選んでください') + '</select></div><div><label>対象の建物</label><select id="bkId">' + (C.bkB ? opts(C.bkB, 'buildingId', 'buildingName', B.id, '建物を選んでください') : '<option value="">(先に区域を選ぶ)</option>') + '</select></div></div>';
    return h;
  }
  function choice(name, v, cur, t, sub, type) { return '<label class="' + (cur ? 'on' : '') + '"><input type="' + type + '" name="' + name + '" value="' + v + '"' + (cur ? ' checked' : '') + '><b style="display:inline">' + t + '</b><br><small>' + sub + '</small></label>'; }
  function bulkSummary() {
    var nm = ''; var el = document.getElementById('bkId');
    if (el && el.value) nm = el.options[el.selectedIndex].text;
    if (!B.id || !nm) return '<div class="bsum muted">対象を選んでください。</div>';
    if (!B.st && !B.memo) return '<div class="bsum muted">クリアする項目を選んでください。</div>';
    return '<div class="bsum"><b>' + (/^p:/.test(String(B.id)) ? '親区域' : (B.scope === 'area' ? '区域' : '建物')) + '「' + esc(nm) + '」</b> の <b>' + (B.st && B.memo ? '訪問とメモ' : (B.st ? '訪問' : 'メモ')) + '</b> を消します。<br><small>' + (B.st ? (B.vac === 'keep' ? '空室の部屋はそのまま残します。' : '空室の部屋も含めて消します。') : '') + (B.memo ? (B.flag === 'keep' ? '「注意」「拒否」の部屋のメモは残します。' : '「注意」「拒否」の部屋のメモも消します。') : '') + '</small></div>';
  }
  function drawBulk() {
    var l = C.last, d = C.ad;
    body('<div class="card"><h3>一括クリア</h3><div class="note">新しく回り始めるときなどに、訪問やメモの記録をまとめて消せます。直前の1回分は下の「元に戻す」で復元できます。</div>' +
      '<div class="bstep">対象範囲</div><div class="bseg">' + ['国仲', '遠方', 'アパート'].map(function (c) { return '<button data-act="ad:bkCat" data-v="' + c + '" class="' + (B.cat === c ? 'on' : '') + '">' + c + '</button>'; }).join('') + '</div>' + (B.cat === 'アパート' ? '<div class="bseg" style="margin-top:6px"><button data-act="ad:bkScope" data-v="area" class="' + (B.scope === 'area' ? 'on' : '') + '">区域単位</button><button data-act="ad:bkScope" data-v="building" class="' + (B.scope === 'building' ? 'on' : '') + '">建物単位</button></div>' : '') + bulkTarget() +
      '<div class="bstep">クリアする項目<em>必須</em></div><div class="bchoice">' + choice('bkWhat', 'st', B.st, '訪問', '訪問済み・留守などの記録', 'checkbox') + choice('bkWhat', 'memo', B.memo, 'メモ', '部屋ごとのメモ', 'checkbox') + '</div>' +
      '<div class="bstep">空室の部屋</div><div class="bchoice">' + choice('bkVac', 'keep', B.vac === 'keep', '残す', '空室の記録はそのまま', 'radio') + choice('bkVac', 'clear', B.vac === 'clear', '消す', '空室の部屋もクリア', 'radio') + '</div>' +
      '<div class="bstep">「注意」「拒否」の部屋のメモ</div><div class="bchoice">' + choice('bkFlag', 'keep', B.flag === 'keep', '残す', '次の期にも引き継ぐ', 'radio') + choice('bkFlag', 'clear', B.flag === 'clear', '消す', 'メモもクリア', 'radio') + '</div>' +
      '<div id="bkSum">' + bulkSummary() + '</div><button class="btn danger block" data-act="ad:bulk">一括クリアを実行</button></div>' +
      '<div class="card"><h3>元に戻す</h3>' + (l ? '<div class="bcr"><span>実行日時</span><b>' + esc(String(l.executedAt).slice(5, 16).replace('T', ' ')) + '</b></div><div class="bcr"><span>対象</span><b>' + (l.scopeType === 'building' ? '建物' : '区域') + ' ' + esc(l.scopeType === 'building' ? (l.scopeId) : (areaName(l.scopeId) || l.scopeId)) + '</b></div><div class="bcr"><span>消した項目</span><b>' + (l.clearStatus && l.clearMemo ? '訪問とメモ' : (l.clearStatus ? '訪問' : 'メモ')) + '</b></div><div class="bcr"><span>件数</span><b>' + l.count + '件</b></div><div class="bcr"><span>実行した人</span><b>' + esc(l.executedBy) + '</b></div><button class="btn block" data-act="ad:undoBulk">直前の一括クリアを元に戻す</button>' : '<div class="note">元に戻せる一括クリアはありません。</div>') + '</div>');
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
    modal('一括クリアの確認', '<div class="bcr"><span>対象</span><b>' + (B.scope === 'area' ? '区域' : '建物') + '「' + esc(nm) + '」</b></div><div class="bcr"><span>消す項目</span><b>' + (B.st && B.memo ? '訪問とメモ' : (B.st ? '訪問' : 'メモ')) + '</b></div>' + (B.st ? '<div class="bcr"><span>空室の部屋</span><b>' + (B.vac === 'keep' ? '残す' : '消す') + '</b></div>' : '') + (B.memo ? '<div class="bcr"><span>注意・拒否のメモ</span><b>' + (B.flag === 'keep' ? '残す' : '消す') + '</b></div>' : '') + '<div class="note">直前の1回分は「元に戻す」で復元できます。</div>', 'クリアする', function () {
      after(api('bulkClear', { scopeType: /^p:/.test(String(B.id)) ? 'parent' : B.scope, scopeId: String(B.id).replace(/^p:/, ''), clearStatus: B.st, clearMemo: B.memo, keepVacantStatus: B.vac === 'keep', keepFlaggedMemo: B.flag === 'keep' }), function (r) { return r.count + '件をクリアしました(元に戻せます)。'; }, function () { C.prog = null; if (SADO.forgetAreas) SADO.forgetAreas(); loadBulk(); });
    });
  }
  // ---------- アカウント(ユーザー・グループ) ----------
  // 「編集」を押すと、その一覧の各項目が書き換えられるようになり、「保存」で変更をまとめて確認して保存する
  var A = { us: [], editU: false, editG: false, ud: {}, gd: {}, q: '', fg: '', fr: '', gt: 'all' };
  function loadAccounts(keep) {
    Promise.all([loadAd(), api('getUsers')]).then(function (r) {
      A.us = r[1]; if (keep !== true) { A.editU = false; A.editG = false; A.ud = {}; A.gd = {}; }
      drawAccounts();
    }, fail);
  }
  function realGroups() { return C.ad.groups.filter(function (g) { return !g.builtin; }); }
  function groupName(id) { var g = C.ad.groups.filter(function (x) { return x.groupId === id; })[0]; return g ? g.groupName : ''; }
  function acTabs() {
    var gs = realGroups();
    if (A.gt !== 'all' && A.gt !== '+' && !gs.filter(function (g) { return g.groupId === A.gt; })[0]) A.gt = 'all';
    return '<div class="tabs fill" id="acTabs"><button class="tab' + (A.gt === 'all' ? ' on' : '') + '" data-act="ad:acTab" data-v="all">会衆</button>' + gs.map(function (g) { return '<button class="tab' + (A.gt === g.groupId ? ' on' : '') + '" data-act="ad:acTab" data-v="' + esc(g.groupId) + '">' + esc(g.groupName) + '</button>'; }).join('') + '<button class="tab' + (A.gt === '+' ? ' on' : '') + '" data-act="ad:acTab" data-v="+" aria-label="グループの管理">＋</button></div>';
  }
  function drawAccounts() {
    var gm = A.gt === '+';
    A.fg = (A.gt === 'all' || gm) ? '' : A.gt;
    if (gm) {
      body(acTabs() + '<div class="card"><h3>グループの管理</h3><div class="note">グループの追加・名前の変更・削除ができます。「会衆」は全員が入っている特別なグループです(区域の担当を「会衆」にすると、ログインした全員が編集できます)。責任者は、そのグループに所属しているアカウントから選びます(会衆だけは全アカウントから選べます)。</div><div class="tbar" id="grBtns"></div><div id="grAdd"></div><div id="grList"></div></div>');
      drawGroups(); return;
    }
    body(acTabs() + '<div class="card"><h3>' + (A.gt === 'all' ? '会衆のアカウント' : esc(groupName(A.gt)) + 'のアカウント') + '<span class="cnt" id="usCnt"></span></h3><div class="tbar"><input type="search" id="usQ" placeholder="ID・名前で探す" value="' + esc(A.q) + '"><select id="usFr"><option value="">すべての権限</option><option value="admin">区域係</option><option value="maintainer">編集者</option><option value="editor">奉仕者</option></select></div>' +
      '<div class="tbar" id="usBtns"></div><div id="usAdd"></div><div id="usList"></div></div>');
    $('#usFr').value = A.fr; drawUsers();
  }
  function btns(edit, kind) {
    return edit ? '<button class="btn small primary" data-act="ad:' + kind + 'Save">保存</button><button class="btn small" data-act="ad:' + kind + 'Cancel">キャンセル</button><span class="cnts">各項目を書き換えて「保存」を押してください</span>' : '<button class="btn small" data-act="ad:' + kind + 'Edit">編集</button>';
  }
  function uval(u, f) { var x = A.ud[u.loginId]; return x && x[f] !== undefined ? x[f] : u[f]; }
  function drawUsers() {
    if (!$('#usList')) return;
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
          '<select data-ue="' + id + '" data-f="groupId">' + opts(realGroups(), 'groupId', 'groupName', grp, 'グループなし') + '</select><select data-ue="' + id + '" data-f="role"><option value="editor"' + (uval(u, 'role') === 'editor' ? ' selected' : '') + '>奉仕者</option><option value="maintainer"' + (uval(u, 'role') === 'maintainer' ? ' selected' : '') + '>編集者</option><option value="admin"' + (uval(u, 'role') === 'admin' ? ' selected' : '') + '>区域係</option></select>' +
          '<label><input type="checkbox" data-ue="' + id + '" data-f="active"' + (uval(u, 'active') ? ' checked' : '') + '> 有効</label><div class="row"><button class="btn small" data-act="ad:userPw" data-v="' + id + '">パスワード再設定</button>' + (u.locked ? '<button class="btn small" data-act="ad:userUnlock" data-v="' + id + '">ロック解除</button>' : '') + '<button class="btn small danger" data-act="ad:userDel" data-v="' + id + '">削除</button></div></div>';
      } else {
        h += '<div class="urow"><div class="un"><b>' + esc(u.displayName) + (u.active ? '' : '<span class="badge off">無効</span>') + (u.locked ? '<span class="badge rej">ロック中</span>' : '') + '</b><small>' + id + '</small></div><div class="ug">' + esc(groupName(u.groupId) || '―') + '</div><span class="badge ' + (u.role === 'admin' ? 'mine' : 'off') + '">' + (u.role === 'admin' ? '区域係' : (u.role === 'maintainer' ? '編集者' : '奉仕者')) + '</span>' +
          '</div>';
      }
    });
    $('#usList').innerHTML = h || '<div class="note">該当するユーザーがいません。</div>';
    $('#usCnt').textContent = n + ' / ' + A.us.length; $('#usBtns').innerHTML = btns(A.editU, 'u');
    $('#usAdd').innerHTML = A.editU ? '<div class="addbox"><b>ユーザーを追加</b><div class="row"><input id="nuId" placeholder="ID(半角英数字)" size="11"><input id="nuPw" placeholder="パスワード(6文字以上)" size="13"><input id="nuName" placeholder="表示名" size="10"><select id="nuGroup"' + (A.fg ? ' disabled' : '') + '>' + opts(realGroups(), 'groupId', 'groupName', A.fg, 'グループなし') + '</select><select id="nuRole"><option value="editor">奉仕者</option><option value="maintainer">編集者</option><option value="admin">区域係</option></select><button class="btn primary small" data-act="ad:userAdd">追加</button></div><div class="note">追加・削除はすぐに反映されます。書き換え中の内容はそのまま残ります。</div></div>' : '';
  }
  function gval(g, f) { var x = A.gd[g.groupId]; return x && x[f] !== undefined ? x[f] : g[f]; }
  function drawGroups() {
    if (!$('#grList')) return;
    var h = '';
    C.ad.groups.forEach(function (g) {
      var id = esc(g.groupId), active = A.us.filter(function (u) { return u.active; });
      var cands = g.builtin ? active : active.filter(function (u) { return String(u.groupId) === String(g.groupId); });
      if (A.editG) {
        h += '<div class="urow' + (A.gd[g.groupId] ? ' chg' : '') + '"><div class="un">' + (g.builtin ? '<b>会衆</b><small>名前は変えられません</small>' : '<input data-ge="' + id + '" data-f="groupName" value="' + esc(gval(g, 'groupName')) + '">') + '</div><select data-ge="' + id + '" data-f="leaderLoginId">' + opts(cands, 'loginId', 'displayName', gval(g, 'leaderLoginId'), cands.length ? '責任者なし' : '(所属アカウントなし)') + '</select>' + (g.builtin ? '' : '<button class="btn small danger" data-act="ad:groupDel" data-v="' + id + '">削除</button>') + '</div>';
      } else {
        var ld = A.us.filter(function (u) { return u.loginId === g.leaderLoginId; })[0];
        h += '<div class="urow"><div class="un"><b>' + esc(g.groupName) + '</b><small>' + (g.builtin ? '全員が入る特別なグループ' : '所属 ' + A.us.filter(function (u) { return String(u.groupId) === String(g.groupId); }).length + '人') + '</small></div><div class="ug">責任者: ' + esc(ld ? ld.displayName : '―') + '</div>' + '</div>';
      }
    });
    $('#grList').innerHTML = h; $('#grBtns').innerHTML = btns(A.editG, 'g');
    $('#grAdd').innerHTML = A.editG ? '<div class="addbox"><b>グループを追加</b><div class="row"><input id="ngName" class="grow" placeholder="新しいグループ名"><button class="btn primary small" data-act="ad:groupAdd">追加</button></div></div>' : '';
  }
  var USER_LABEL = { displayName: '表示名', groupId: 'グループ', role: '権限', active: '有効' };
  function showVal(f, v) { return f === 'groupId' ? (groupName(v) || 'グループなし') : (f === 'role' ? (v === 'admin' ? '区域係' : (v === 'maintainer' ? '編集者' : '奉仕者')) : (f === 'active' ? (v ? '有効' : '無効') : String(v))); }
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
        var done = function () {
          if (kind === 'u') { list.forEach(function (c) { patchById(A.us, 'loginId', c.payload.loginId, function (u) { for (var k in c.payload) if (k !== 'loginId' && k !== 'password') u[k] = c.payload[k]; }); }); A.editU = false; A.ud = {}; }
          else { list.forEach(function (c) { if (c.builtin) { if (c.payload.leaderLoginId !== undefined) patchById(C.ad.groups, 'groupId', c.payload.groupId, function (g) { g.leaderLoginId = c.payload.leaderLoginId; }); } else patchById(C.ad.groups, 'groupId', c.payload.groupId, function (g) { for (var k in c.payload) if (k !== 'groupId') g[k] = c.payload[k]; }); }); A.editG = false; A.gd = {}; }
        };
        opt(function () { return Promise.all(calls); }, list.length + '件を保存しました。', done, drawAccounts);
      }, 'primary');
  }

  // ---------- 動作設定 ----------
  var ST = {}, VS = [];
  var DEF_VS = [{ id: 'unvisited', label: '未訪問', visited: false, done: false, color: '#9aa0a6' }, { id: 'met', label: '会えた', visited: true, done: true, color: '#188038' }, { id: 'absent1', label: '留守1', visited: true, done: false, color: '#ef6c00' }, { id: 'absent2', label: '留守2', visited: true, done: false, color: '#c2410c' }, { id: 'vacant', label: '空室', visited: true, done: true, color: '#6b7280' }];
  var COL_BY = { unvisited: '#9aa0a6', met: '#188038', absent1: '#ef6c00', absent2: '#c2410c', vacant: '#6b7280' };
  var TXT = [['appTitle', 'アプリのタイトル', 'ログイン画面・上のバー・ブラウザのタブ名に表示されます。'], ['mapLat', '地図の最初の位置(緯度)', '例: 38.08'], ['mapLng', '地図の最初の位置(経度)', '例: 138.44'], ['mapZoom', '地図の最初の拡大率', '例: 13'], ['autoEndMonths', '開始日から自動で終了するまでの月数', ''], ['fiscalStartMonth', '年度のはじまりの月', ''], ['logDocId', '記録用GoogleドキュメントのID', ''], ['downloadFolderId', '印刷用PDF・PNGを入れたフォルダのID', '']];
  function isOn(v) { return v === true || String(v) === 'true'; }
  function stSeg(k, list) { return '<div class="segrow">' + list.map(function (x) { return '<button type="button" class="' + (String(ST[k]) === x[0] ? 'on' : '') + '" data-act="ad:seg" data-k="' + k + '" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>'; }
  function stSw(k, title, desc) { return '<div class="swrow"><div class="tx"><div class="tt" style="font-weight:800">' + title + '</div><div class="ds" style="font-size:.82em;color:var(--text-3)">' + desc + '</div></div><label class="switch"><input type="checkbox" id="sw-' + k + '"' + (isOn(ST[k]) ? ' checked' : '') + '><i></i></label></div>'; }
  function stRow(title, desc, inner) { return '<div class="setrow"><div class="tt">' + title + '</div>' + (desc ? '<div class="ds">' + desc + '</div>' : '') + inner + '</div>'; }
  function vsSync() {
    var rows = document.querySelectorAll('.vsrow'); if (!rows.length) return;
    VS = [].slice.call(rows).map(function (r) { var i = +r.getAttribute('data-i'), o = VS[i] || {}; return { id: o.id, label: r.querySelector('.vl').value, color: r.querySelector('.vc').value, visited: r.querySelector('.vv').checked, done: r.querySelector('.vd').checked }; });
  }
  function vsDraw() {
    var box = document.getElementById('vsBox'); if (!box) return;
    box.innerHTML = VS.map(function (x, i) {
      return '<div class="vsrow" data-i="' + i + '"><input class="vl" type="text" maxlength="12" value="' + esc(x.label) + '"><input class="vc" type="color" value="' + esc(x.color || COL_BY[x.id] || '#6b7280') + '"><label><input class="vv" type="checkbox"' + (x.visited ? ' checked' : '') + '> 訪問した扱い</label><label><input class="vd" type="checkbox"' + (x.done ? ' checked' : '') + '> 完了扱い</label>' +
        '<button type="button" class="btn small" data-act="ad:vsUp" data-v="' + i + '"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="btn small" data-act="ad:vsDn" data-v="' + i + '"' + (i < VS.length - 1 ? '' : ' disabled') + '>↓</button>' +
        (x.id === 'unvisited' ? '' : '<button type="button" class="btn small danger" data-act="ad:vsDel" data-v="' + i + '">削除</button>') + '</div>';
    }).join('');
  }
  function loadSettings() {
    api('getSettings').then(function (s) {
      var DF = { areaProgressView: 'graph', mapProgressMode: 'simple', pinDoneThreshold: '100', pinRejectCautionDone: 'true', houseTapMode: 'direct', statusSaveMode: 'inline', autoRefreshEnabled: 'true', autoRefreshIntervalSec: '15', mapRotationEnabled: 'true', menuTitleEnabled: 'true', pinShadowEnabled: 'true', onboardingHelpEnabled: 'false', inputTheme: '3', logoMode: 'default', logoImage: '', mapTileSource: 'gsi', mapTileUrl: '', mapTileAttribution: '' };
      for (var dk in DF) if (s[dk] === undefined || s[dk] === null || s[dk] === '' && dk !== 'logoImage' && dk !== 'mapTileUrl' && dk !== 'mapTileAttribution') s[dk] = DF[dk];
      ['pinRejectCautionDone', 'autoRefreshEnabled', 'mapRotationEnabled', 'menuTitleEnabled', 'pinShadowEnabled', 'onboardingHelpEnabled'].forEach(function (k) { s[k] = String(s[k]); });
      ST = s; try { VS = JSON.parse(s.visitStatusList); } catch (e) { VS = DEF_VS.slice(); } if (!VS || !VS.length) VS = DEF_VS.slice();
      VS = VS.map(function (x) { x.color = x.color || COL_BY[x.id] || '#6b7280'; return x; });
      var sel = function (k, list) { return '<select id="st-' + k + '">' + list.map(function (o) { return '<option value="' + o[0] + '"' + (String(s[k]) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
      var h = '<div class="card"><h3>動作設定</h3><div class="note">ここでの設定は、全員の画面に反映されます。</div>' +
        TXT.slice(0, 1).map(function (f) { return stRow(f[1], f[2], '<input style="width:100%" id="st-' + f[0] + '" value="' + esc(s[f[0]]) + '">'); }).join('') +
        stRow('読み込み中のロゴ', '読み込み中に出る、くるくる回る印です。「カスタム」では、好きな画像を使えます(自動で小さくします)。回転しても見た目のよい、正方形に近い画像がおすすめです。「設定を保存」で反映されます。', stSeg('logoMode', [['default', 'デフォルト(○)'], ['custom', 'カスタム']]) + '<div style="margin-top:8px"><img id="logoPrev" alt="" style="width:64px;height:64px;object-fit:contain;border:1px solid var(--border);border-radius:12px;background:#fff;' + (s.logoImage ? '' : 'display:none') + '"' + (s.logoImage ? ' src="' + esc(s.logoImage) + '"' : '') + '><input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/gif" style="display:block;margin-top:6px"></div>') +
        stRow('デフォルトのマップ取得先', '地図を開いたときに最初に使う背景です。「設定を保存」でその場で切り替わります。(OpenStreetMapと航空写真は、「地図を端末に保存」の対象外です)', sel('mapTileSource', [['gsi', '国土地理院(標準)'], ['gsipale', '国土地理院(淡色)'], ['gsiphoto', '国土地理院(航空写真)'], ['osm', 'OpenStreetMap'], ['custom', '自分で指定']]) +
          '<div style="margin-top:6px"><div class="note">「自分で指定」のときだけ使います。画像のアドレス(https:// で始まり、{z}・{x}・{y} を含む)</div><input style="width:100%" id="st-mapTileUrl" value="' + esc(s.mapTileUrl) + '" placeholder="https://example.com/{z}/{x}/{y}.png"><div class="note" style="margin-top:4px">出典の表記(利用する地図サービスの規約に合わせて)</div><input style="width:100%" id="st-mapTileAttribution" maxlength="200" value="' + esc(s.mapTileAttribution) + '"></div>') +
        TXT.slice(1, 4).map(function (f) { return stRow(f[1], f[2], '<input style="width:100%" id="st-' + f[0] + '" value="' + esc(s[f[0]]) + '">'); }).join('') +
        stRow('デフォルトの入力スタイル', '建物の詳細で、訪問状況を選ぶ形です。各端末の「表示設定」で、端末ごとに変えることもできます。', stSeg('inputTheme', [['3', 'ボタン一覧'], ['2', 'ボタン'], ['1', 'プルダウン']])) +
        stRow('デフォルトの一軒家の入力スタイル', '一軒家など部屋情報のない建物を、地図でタップしたときの動きです。各自が設定メニューで、好みに変えられます。', stSeg('houseTapMode', [['direct', 'タップで記録(長押しで詳細)'], ['sheet', '詳細ウィンドウを開く']])) +
        stRow('区域メニューの進捗表示', '', stSeg('areaProgressView', [['graph', 'グラフ'], ['chips', '文字']])) +
        stRow('マップ上で進捗を表示', 'ピン(シンプル): 未訪問・途中・完了でピンを色分けします。<br>サークル: 輪の色が部屋の状況の割合、中央の数字が残りの部屋の数です。<br>オフ: 色分けしません。', stSeg('mapProgressMode', [['simple', 'ピン(シンプル)'], ['circle', 'サークル'], ['off', 'オフ']])) +
        stRow('訪問状況の選択肢', '建物の詳細で選ぶ「訪問状況」を変えられます。上から順に表示されます。「訪問した扱い」と「完了扱い」で、進み具合の数え方が変わります。「未訪問」は消せません。', '<div id="vsBox"></div><div class="row"><button type="button" class="btn small" data-act="ad:vsAdd">選択肢を追加</button><button type="button" class="btn small" data-act="ad:vsReset">標準に戻す</button></div>') +
        stRow('ピンの色の決まり', '建物ごとに、各部屋の訪問状況から色(未訪問・途中・完了)を決めます。完了: 完了扱いの部屋が下の割合以上／途中: 訪問した部屋がある／未訪問: それ以外。', '<div class="row"><label for="st-pinDoneThreshold">完了にする割合　</label>' + sel('pinDoneThreshold', [['100', '全部屋(100%)'], ['90', '90%以上'], ['80', '80%以上'], ['70', '70%以上'], ['60', '60%以上'], ['50', '50%以上']]) + '</div>' +
          stSw('pinRejectCautionDone', '「注意」「拒否」の部屋を完了扱いにする', 'オンなら、注意・拒否の部屋は訪問していなくても完了扱いです。')) +
        stRow('訪問状況の保存方法', 'すぐに保存: 訪問状況を変えた瞬間に保存します。(おすすめ)<br>まとめて保存: 詳細ウィンドウの「保存」ボタンを押すまで保存しません。', stSeg('statusSaveMode', [['inline', 'すぐに保存'], ['manual', 'まとめて保存']])) +
        stSw('autoRefreshEnabled', '部屋情報の自動更新', '建物の詳細を開いている間、ほかの人の入力を自動で反映します。') +
        stRow('更新の間隔', '間隔を短くするほど、アクセスが増えて重くなります。人数が多いときは15秒以上をおすすめします。', sel('autoRefreshIntervalSec', [['5', '5秒'], ['10', '10秒'], ['15', '15秒'], ['30', '30秒'], ['60', '60秒']])) +
        stSw('onboardingHelpEnabled', 'サイトを開いたときにヘルプを表示', 'はじめて開いた端末に、ヘルプ(使い方)を表示します。') +
        stSw('menuTitleEnabled', 'メニューのタイトル', '各メニューの上に、アプリの名前(例: 佐渡区域)を表示します。オフにすると表示しません。') +
        stSw('mapRotationEnabled', 'マップの回転', '2本指で地図を回したり、現在地の向きに合わせて地図を回したりする機能です。') +
        stSw('pinShadowEnabled', 'ピンの影', '地図のピンに影をつけます。オフにすると、地図の拡大・縮小が軽くなります。') +
        '</div><div class="card"><h3>運用の設定</h3>' + TXT.slice(4).map(function (f) { return stRow(f[1], f[2], '<input style="width:100%" id="st-' + f[0] + '" value="' + esc(s[f[0]]) + '">'); }).join('') + '</div>' +
        '<button class="btn primary block" data-act="ad:saveSettings">設定を保存</button><div class="note" style="margin-top:8px">ログインを必須にする設定は、このアプリでは常にオンです。電波が弱いときの一時保存と自動送信も、常にオンです。</div>';
      body(h); vsDraw();
    }, fail);
  }
  function saveSettingsNow() {
    vsSync();
    var vals = {}, ids = ['appTitle', 'mapTileSource', 'mapTileUrl', 'mapTileAttribution', 'mapLat', 'mapLng', 'mapZoom', 'autoEndMonths', 'fiscalStartMonth', 'logDocId', 'downloadFolderId', 'pinDoneThreshold', 'autoRefreshIntervalSec'];
    ids.forEach(function (k) { vals[k] = val('st-' + k); });
    vals.logoImage = ST.logoImage || '';
    ['logoMode', 'inputTheme', 'houseTapMode', 'areaProgressView', 'mapProgressMode', 'statusSaveMode'].forEach(function (k) { vals[k] = String(ST[k]); });
    ['pinRejectCautionDone', 'autoRefreshEnabled', 'onboardingHelpEnabled', 'mapRotationEnabled', 'menuTitleEnabled', 'pinShadowEnabled'].forEach(function (k) { var e = document.getElementById('sw-' + k); vals[k] = e && e.checked ? 'true' : 'false'; });
    vals.visitStatusList = JSON.stringify(VS.map(function (x) { return { id: x.id, label: x.label, visited: !!x.visited, done: !!x.done, color: x.color }; }));
    toast('保存しました。'); api('saveSettings', { values: vals }).then(function () {}, function (e) { toast((e && e.message || String(e)) + '\n(保存できませんでした。もう一度押してください)', 6000); });
  }


  // ---------- 分析 ----------
  function loadAnalysis() {
    api('getAnalysis').then(function (r) {
      body('<div class="card"><h3>次に訪問する区域の目安</h3><div class="note">「おすすめ度」は、まだ終わっていない部屋の割合と、前回完了からの日数をもとにした点数です(高いほど優先)。「再訪候補」は、留守などで再訪すると会えそうな部屋の数です(拒否の部屋は除く)。</div><table class="t"><tr><th>区域</th><th>おすすめ度</th><th>進み具合</th><th>残り</th><th>再訪候補</th><th>拒否/注意</th><th>前回完了</th></tr>' +
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
  var IMPORTS = [['area', '区域', 'areaId, areaName, sortOrder, category(国仲/遠方), …'], ['group', 'グループ', 'groupId, groupName, leaderLoginId(責任者のアカウントID), …'], ['building', '建物', 'buildingId(=uuid2), buildingName, areaId, lat, lng, buildingMemo'], ['room', '部屋', 'roomId, buildingId, areaId, roomName, floor, sortOrder, mark, tenant(テナント名)']];
  function loadIO() {
    body('<div class="card"><h3>区域の表を取り込む(QGIS・大きな区域と小さな区域)</h3><div class="note">QGISで書き出した区域のCSVを選びます。列名は、QGISの名前(name・boundary_detail_uuid・parent_name・parent_boundary_uuid・category)でも、アプリの名前(areaName・areaId・parentName・parentId・category)でも読めます。大きな区域は、この表から自動で作られます。すでにある区域は、名前・所属・区分だけが更新され、使用中などの記録は消えません。1行でも問題があれば、どれも取り込みません。</div>' +
      '<div class="row"><input type="file" accept=".csv,text/csv" id="imp-tree"><button class="btn small primary" data-act="ad:importTree">取り込む</button></div><div class="note" id="impTreeMsg"></div></div>' +
      '<div class="card"><h3>建物の区域を、CSVでまとめて決める</h3><div class="note">列は「buildingId, areaId」。先に、区域の表の取り込みで、移す先の区域を作っておいてください。建物と部屋、入力データの区域が、まとめて移ります。</div><div class="row"><input type="file" accept=".csv,text/csv" id="imp-asg"><button class="btn small primary" data-act="ad:importAsg">取り込む</button></div><div class="note" id="impAsgMsg"></div></div>' +
      '<div class="card"><h3>CSVから取り込む(QGISなどで作ったデータ)</h3><div class="note">同じIDの行は上書き、新しいIDの行は追加されます。順番は、区域 → グループ → 担当者 → 建物 → 部屋 です。</div>' +
      IMPORTS.map(function (x) { return '<div class="row"><b style="min-width:5em">' + x[1] + '</b><input type="file" accept=".csv,text/csv" id="imp-' + x[0] + '"><button class="btn small primary" data-act="ad:import" data-v="' + x[0] + '">取り込む</button></div><div class="note">列: ' + x[2] + '</div>'; }).join('') + '<div class="note" id="impMsg"></div></div>' +
      '<div class="card"><h3>CSVに書き出す(QGISに戻す用)</h3><div class="note">建物は「uuid2・建物名・メモ」、部屋は「部屋ID・uuid2・部屋名・階・テナント・印・訪問状況・メモ」です。QGISでuuid2を目印に結合してください。</div><button class="btn small" data-act="ad:export" data-v="buildings">建物のCSV</button><button class="btn small" data-act="ad:export" data-v="rooms">部屋のCSV</button></div>');
  }
  var TREE_COLS = { areaId: ['areaId', 'boundary_detail_uuid'], areaName: ['areaName', 'name'], parentId: ['parentId', 'parent_boundary_uuid'], parentName: ['parentName', 'parent_name'], category: ['category'] };
  function doImportAsg() {
    var f = document.getElementById('imp-asg').files[0], msg = document.getElementById('impAsgMsg'); if (!f) { toast('CSVファイルを選んでください。'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var raw = parseCsv(String(rd.result)), by = {}, order = [], total = 0;
      raw.forEach(function (r) { var b = String(r.buildingId || '').trim(), a = String(r.areaId || '').trim(); if (!b || !a) return; if (!by[a]) { by[a] = []; order.push(a); } by[a].push(b); total++; });
      if (!total) { msg.textContent = '必要な列(buildingId, areaId)と、データの行がありません。'; return; }
      var jobs = []; order.forEach(function (a) { for (var i = 0; i < by[a].length; i += 500) jobs.push({ areaId: a, ids: by[a].slice(i, i + 500) }); });
      var done = 0, moved = 0, k = 0; busy(true);
      (function next() {
        if (k >= jobs.length) { busy(false); C.ad = null; C.prog = null; msg.textContent = '完了: ' + order.length + '区域、' + total + '件を指定し、' + moved + '件を移しました(すでにその区域にあるものは数えません)。'; toast('建物の区域を取り込みました。'); return; }
        var j = jobs[k++]; msg.textContent = (done) + ' / ' + total + ' 件…';
        api('moveBuildings', { buildingIds: j.ids, areaId: j.areaId }).then(function (r) { done += j.ids.length; moved += r.moved; next(); }, function (e) { busy(false); msg.textContent = done + '件まで移して、区域「' + j.areaId + '」で止まりました: ' + e.message; msg.style.whiteSpace = 'pre-line'; });
      })();
    };
    rd.readAsText(f, 'utf-8');
  }
  function doImportTree() {
    var f = document.getElementById('imp-tree').files[0], msg = document.getElementById('impTreeMsg'); if (!f) { toast('CSVファイルを選んでください。'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var raw = parseCsv(String(rd.result)); if (!raw.length) { toast('データの行がありません。'); return; }
      var rows = raw.map(function (r) { var o = {}; Object.keys(TREE_COLS).forEach(function (k) { TREE_COLS[k].forEach(function (c) { if (o[k] === undefined && r[c] !== undefined) o[k] = r[c]; }); }); return o; });
      var miss = Object.keys(TREE_COLS).filter(function (k) { return rows[0][k] === undefined; });
      if (miss.length) { msg.textContent = '必要な列がありません: ' + miss.map(function (k) { return TREE_COLS[k].join(' または '); }).join(' / '); return; }
      msg.textContent = rows.length + '件を取り込み中…'; busy(true);
      api('importAreaTree', { rows: rows }).then(function (r) { busy(false); C.ad = null; C.prog = null; msg.textContent = '完了: 大きな区域 ' + r.parents + '件、小さな区域 ' + r.children + '件(新しく作成 ' + r.added + '件、更新 ' + r.updated + '件)'; toast('区域の表を取り込みました。'); }, function (e) { busy(false); msg.textContent = '取り込めませんでした:\n' + e.message; msg.style.whiteSpace = 'pre-line'; });
    };
    rd.readAsText(f, 'utf-8');
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
  // 画面を先に書き換え、保存は裏で行う。失敗したら、サーバーの内容を読み直して元に戻す
  function opt(call, msg, patch, draw) {
    try { patch(); draw(); } catch (e) { console.error(e); }
    var tb = tab;
    call().then(function (r) { if (msg) toast(typeof msg === 'function' ? msg(r) : msg); },
      function (e) { toast((e && e.message || String(e)) + '\n(画面を元に戻します)', 6000); C.ad = null; C.edit = null; if (tab === tb) go(tb); });
  }
  function showAreaList() {
    C.openArea = ''; var ix = document.getElementById('arIndex'), dv = document.getElementById('arDetail');
    if (ix && dv) { ix.classList.remove('hidden'); dv.classList.add('hidden'); drawAreaList(); } else go('areas');
  }
  function patchById(list, key, id, f) { for (var i = 0; i < list.length; i++) if (String(list[i][key]) === String(id)) { f(list[i]); return list[i]; } }
  function after(p, msg, reload) { busy(true); p.then(function (r) { if (msg) toast(typeof msg === 'function' ? msg(r) : msg); if (reload) reload(); else busy(false); }, fail); }
  SADO.onAdminClick = function (act, t, v) {
    if (act.indexOf('ad:') !== 0) return;
    var a = act.slice(3), on = t.getAttribute('data-on'), f;
    switch (a) {
      case 'close': close(); break;
      case 'editMode': close(); if (SADO.editToggle) SADO.editToggle(); break;
      case 'bkCat': B.cat = v; if (v !== 'アパート') B.scope = 'area'; B.id = ''; B.area = ''; C.bkB = null; drawBulk(); break;
      case 'tab': if (v === 'edit' && MODE !== 'edit') open('edit'); else go(v); break;
      case 'addArea': (function () { var cat = tab === 'edit' ? (C.editCat || '国仲') : val('newAreaCat'); C.cat = cat; after(api('addArea', { areaName: val('newAreaName'), category: cat }), '区域を追加しました。', function () { if (tab === 'edit') { C.ad = null; loadEdit(); } else refreshAreas(); }); })(); break;
      case 'importTree': doImportTree(); break;
      case 'importAsg': doImportAsg(); break;
      case 'mvGo':
        var mids = [].slice.call(document.querySelectorAll('[data-mv]')).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-mv'); }), to = val('mvTo');
        if (!mids.length) { toast('移す建物にチェックを入れてください。'); break; } if (!to) { toast('移す先の区域を選んでください。'); break; }
        C.mvOpen = true; after(api('moveBuildings', { buildingIds: mids, areaId: to }), function (r) { return r.moved + '件を「' + areaName(to) + '」へ移しました。'; }, loadEditBody); break;
      case 'areaOpen': renderAreaDetail(v); break;
      case 'parExp': C.exp[v] = !C.exp[v]; drawAreaList(); break;
      case 'edCat': C.editCat = v; C.editArea = ''; loadEdit(); break;
      case 'catTab': C.cat = v; drawAreaList(); break;
      case 'areaBack': C.openArea = ''; loadAreas(); break;
      case 'clearEnd': if ($('#arEnd')) $('#arEnd').value = ''; break;
      case 'areaSave': areaSave(v); break;
      case 'rename': var nm = window.prompt('新しい区域名', areaName(v)); if (nm) after(api('renameArea', { areaId: v, areaName: nm }), '変更しました。', function () { bump(); go('edit'); }); break;
      case 'toggleArea': after(api('setActive', { kind: 'area', id: v, active: on === '1' }), '変更しました。', function () { bump(); go('edit'); }); break;
      case 'asgMode': ['group', 'user', 'all'].forEach(function (m) { $('#asg' + m.charAt(0).toUpperCase() + m.slice(1)).classList.toggle('hidden', m !== v); $('#asg-' + m).classList.toggle('on', m === v); }); break;
      case 'autoEnd': after(api('runAutoEnd'), function (r) { return r.ended.length ? '自動で終了: ' + r.ended.join('、') + (r.warnings.length ? '\n(注意) ' + r.warnings[0] : '') : '期限が来た区域はありません。'; }, refreshAreas); break;
      case 'newYear': if (window.confirm('今の記録ドキュメントをコピーして、新しい年度のファイルを作ります。各区域の「前回完了した日付」が転記されます。よろしいですか？')) after(api('createNewYearDoc'), function (r) { return r.label + '年度のファイルを作りました(' + r.areasCarried + '区域を転記)。\n' + r.url; }, null); break;
      // データ編集
      case 'posMap': { var m = SADO.map; if (!m) { toast('地図が開かれていません。'); break; } var c = m.getCenter(); $('#nbLat').value = c.lat.toFixed(6); $('#nbLng').value = c.lng.toFixed(6); toast('地図の中心の位置を入れました。(管理画面を閉じて地図を動かし、もう一度開いて入れ直せます)'); break; }
      case 'posGps': { if (!navigator.geolocation) { toast('位置情報が使えません。'); break; } navigator.geolocation.getCurrentPosition(function (p) { $('#nbLat').value = p.coords.latitude.toFixed(6); $('#nbLng').value = p.coords.longitude.toFixed(6); }, function () { toast('位置を取得できませんでした。'); }, { enableHighAccuracy: true, timeout: 15000 }); break; }
      case 'addB': after(api('createBuilding', { areaId: C.editArea, buildingName: val('nbName'), lat: val('nbLat'), lng: val('nbLng'), rooms: val('nbRooms').split('\n') }), '建物を追加しました。', loadEditBody); break;
      case 'saveB': f = fields('b', v); opt(function () { return api('updateBuilding', { buildingId: v, buildingName: f.buildingName, buildingMemo: f.buildingMemo, lat: f.lat, lng: f.lng }); }, '保存しました。', function () { patchById(C.edit.buildings, 'buildingId', v, function (b) { b.buildingName = f.buildingName; b.buildingMemo = f.buildingMemo; b.lat = f.lat; b.lng = f.lng; }); }, renderEdit); break;
      case 'activeB': opt(function () { return api('setActive', { kind: 'building', id: v, active: on === '1' }); }, '変更しました。', function () { patchById(C.edit.buildings, 'buildingId', v, function (b) { b.active = on === '1'; }); }, renderEdit); break;
      case 'purgeB': if (window.prompt('建物と、その部屋・入力データをすべて完全に削除します。取り消せません。続けるには「削除」と入力してください。') === '削除') after(api('purgeItem', { kind: 'building', id: v }), '削除しました。', loadEditBody); break;
      case 'saveR': f = fields('r', v); opt(function () { return api('updateRoom', { roomId: v, roomName: f.roomName, floor: f.floor, mark: f.mark }); }, '保存しました。', function () { patchById(C.edit.rooms, 'roomId', v, function (r) { r.roomName = f.roomName; r.floor = f.floor; r.mark = f.mark; }); }, renderEdit); break;
      case 'activeR': opt(function () { return api('setActive', { kind: 'room', id: v, active: on === '1' }); }, '変更しました。', function () { patchById(C.edit.rooms, 'roomId', v, function (r) { r.active = on === '1'; }); }, renderEdit); break;
      case 'purgeR': if (window.prompt('部屋と入力データを完全に削除します。続けるには「削除」と入力してください。') === '削除') after(api('purgeItem', { kind: 'room', id: v }), '削除しました。', loadEditBody); break;
      case 'addRooms': after(api('addRooms', { buildingId: v, rooms: val('ar-' + v).split('\n') }), '部屋を追加しました。', loadEditBody); break;
      case 'delReport': opt(function () { return api('deleteReport', { reportId: v }); }, null, function () {}, function () { var el = document.querySelector('[data-act="ad:delReport"][data-v="' + v + '"]'); var row = el && el.closest('.fxg'); if (row) { var cnt = document.querySelector('#adBody .cnt'); row.remove(); if (cnt) cnt.textContent = Math.max(0, (+cnt.textContent || 1) - 1); } }); break;
      case 'bulk': bulkRun(); break;
      case 'bkScope': B.scope = v; B.id = ''; B.area = ''; C.bkB = null; drawBulk(); break;
      case 'undoBulk': modal('元に戻す', '<div class="note">直前の一括クリアで消した記録を元に戻します。</div>', '元に戻す', function () { after(api('undoBulk'), function (r) { return r.count + '件を元に戻しました。'; }, function () { C.prog = null; if (SADO.forgetAreas) SADO.forgetAreas(); loadBulk(); }); }); break;
      // アカウント
      case 'uEdit': A.editU = true; A.ud = {}; drawUsers(); break;
      case 'uCancel': A.editU = false; A.ud = {}; drawUsers(); break;
      case 'uSave': confirmSave('u'); break;
      case 'gEdit': A.editG = true; A.gd = {}; drawGroups(); break;
      case 'gCancel': A.editG = false; A.gd = {}; drawGroups(); break;
      case 'gSave': confirmSave('g'); break;
      case 'acTab': A.gt = v; A.editU = false; A.editG = false; A.ud = {}; A.gd = {}; A.q = ''; drawAccounts(); break;
      case 'userAdd': after(api('addUser', { loginId: val('nuId'), password: val('nuPw'), displayName: val('nuName'), groupId: val('nuGroup'), role: val('nuRole') }), 'ユーザーを追加しました。', function () { bump(); loadAccounts(true); }); break;
      case 'userUnlock': after(api('updateUser', { loginId: v, unlock: true }), 'ロックを解除しました。', function () { loadAccounts(true); }); break;
      case 'userPw': var pw = window.prompt('新しいパスワード(6文字以上)'); if (pw) after(api('updateUser', { loginId: v, password: pw }), 'パスワードを変更しました。', null); break;
      case 'userDel': if (window.confirm('ユーザー「' + v + '」を削除します。よろしいですか？')) after(api('deleteUser', { loginId: v }), '削除しました。', function () { loadAccounts(true); }); break;
      case 'groupAdd': after(api('saveGroup', { groupName: val('ngName') }), '追加しました。', function () { bump(); loadAccounts(true); }); break;
      case 'groupDel': if (window.confirm('このグループを削除します。よろしいですか？')) after(api('deleteGroup', { groupId: v }), '削除しました。', function () { bump(); loadAccounts(true); }); break;
      case 'saveSettings': saveSettingsNow(); break;
      case 'seg': ST[t.getAttribute('data-k')] = v; [].slice.call(t.parentNode.children).forEach(function (x) { x.classList.toggle('on', x === t); }); break;
      case 'vsUp': vsSync(); f = +v; if (f > 0) { var tmp = VS[f - 1]; VS[f - 1] = VS[f]; VS[f] = tmp; } vsDraw(); break;
      case 'vsDn': vsSync(); f = +v; if (f < VS.length - 1) { var tm2 = VS[f + 1]; VS[f + 1] = VS[f]; VS[f] = tm2; } vsDraw(); break;
      case 'vsDel': vsSync(); VS.splice(+v, 1); vsDraw(); break;
      case 'vsAdd': vsSync(); if (VS.length >= 12) { toast('選択肢は12個までです。'); break; } VS.push({ id: 's' + Date.now().toString(36), label: '新しい状況', visited: true, done: false, color: '#0284c7' }); vsDraw(); break;
      case 'vsReset': if (window.confirm('訪問状況の選択肢を標準に戻します。(保存するまで反映されません)')) { VS = JSON.parse(JSON.stringify(DEF_VS)); vsDraw(); } break;
      case 'import': doImport(v); break;
      case 'export': api('exportCsv', { kind: v }).then(function (r) { SADO.saveBlob(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }), r.filename); }, fail); break;
    }
  };
  document.addEventListener('input', function (ev) { var t = ev.target; if (t.id === 'asgQ') { var q = t.value.trim().toLowerCase(), ls = document.querySelectorAll('#asgUser .asg'); for (var i = 0; i < ls.length; i++) ls[i].classList.toggle('hidden', !!q && ls[i].getAttribute('data-name').indexOf(q) < 0); } else if (t.id === 'usQ') { A.q = t.value; drawUsers(); } else if (t.id === 'arQ') { C.q = t.value; drawAreaList(); } else if (t.getAttribute && t.getAttribute('data-ue') && t.getAttribute('data-f') === 'displayName') { var k = t.getAttribute('data-ue'); (A.ud[k] = A.ud[k] || {}).displayName = t.value; t.closest('.urow').classList.add('chg'); } });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.getAttribute && t.getAttribute('data-cat')) { api('setAreaCategory', { areaId: t.getAttribute('data-cat'), category: t.value }).then(function () { toast('区分を「' + t.value + '」にしました。'); if (C.ad) C.ad.areas.forEach(function (a) { if (a.areaId === t.getAttribute('data-cat')) a.category = t.value; }); }, fail); return; }
    if (t.getAttribute && t.getAttribute('data-ue')) { var k = t.getAttribute('data-ue'), f = t.getAttribute('data-f'); (A.ud[k] = A.ud[k] || {})[f] = f === 'active' ? t.checked : t.value; t.closest('.urow').classList.add('chg'); return; }
    if (t.getAttribute && t.getAttribute('data-ge')) { var gk = t.getAttribute('data-ge'); (A.gd[gk] = A.gd[gk] || {})[t.getAttribute('data-f')] = t.value; t.closest('.urow').classList.add('chg'); return; }
    if (t.id === 'logoFile') {
      var fl = t.files && t.files[0]; if (!fl) return;
      var rd = new FileReader(); rd.onload = function () {
        var im = new Image(); im.onload = function () {
          var n = 128, cv = document.createElement('canvas'), r = Math.min(n / im.width, n / im.height, 1); cv.width = Math.round(im.width * r); cv.height = Math.round(im.height * r); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          var u = cv.toDataURL('image/webp', 0.85); if (u.indexOf('data:image/webp') !== 0) u = cv.toDataURL('image/png');
          if (u.length > 44000) { toast('画像が大きすぎます。もっと単純な画像を選んでください。'); return; }
          ST.logoImage = u; ST.logoMode = 'custom'; var pv = document.getElementById('logoPrev'); pv.src = u; pv.style.display = '';
          var seg = document.querySelector('[data-k=logoMode]'); if (seg) [].slice.call(seg.parentNode.children).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-v') === 'custom'); });
        }; im.onerror = function () { toast('画像を読み込めませんでした。'); }; im.src = rd.result;
      }; rd.readAsDataURL(fl); return;
    }
    if (t.id === 'arIn') { $('#arOn').classList.toggle('hidden', !t.checked); return; }
    if (t.id === 'usFg') { A.fg = t.value; drawUsers(); return; }
    if (t.id === 'usFr') { A.fr = t.value; drawUsers(); return; }
    if (t.id === 'mvAll') { [].slice.call(document.querySelectorAll('[data-mv]')).forEach(function (x) { x.checked = t.checked; }); return; }
    if (t.id === 'arQ') { C.q = t.value; drawAreaList(); return; }
    if (t.id === 'adOnly') { C.only = t.checked; try { localStorage.setItem('adOnlyInUse', t.checked ? '1' : '0'); } catch (e) {} drawAreaList(); return; }
    if (t.id === 'edArea') { C.editArea = t.value; if (C.editArea) loadEditBody(); else document.getElementById('edBody').innerHTML = ''; }
    else if (t.id === 'edHidden') { C.showHidden = t.checked; if (C.edit) renderEdit(); }
    else if (t.id === 'edFilter') { C.filter = t.value; renderEdit(); var e = document.getElementById('edFilter'); if (e) e.focus(); }
  });
  // 管理を開く前に、区域の一覧と進み具合を裏で読んでおく(開いたとき、すぐ表示できる)
  SADO.openAdmin = open; SADO.closeAdmin = function () { close(); };
})();
