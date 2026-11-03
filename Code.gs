/**
 * 佐渡住宅GAS(仮称) バックエンド
 * ・画面は GitHub Pages(web/) に置き、このスクリプトは「データの受け渡し窓口(API)」だけを担当する
 * ・データの保管場所は、このスクリプトを紐づけたスプレッドシート
 * ・デプロイ: ウェブアプリ / 実行ユーザー=自分 / アクセス=全員(匿名可)。※認証はこのスクリプト自身が行う
 */

// ============================== シート定義 ==============================
var SHEETNAME = {
  area: 'エリアマスタ', building: '建物マスタ', room: '部屋マスタ', input: '入力データ',
  assign: '担当割当', group: 'グループ', member: '担当者名簿', useLog: '使用記録',
  history: '更新履歴', backup: '一括操作バックアップ', report: '報告',
  user: 'ユーザー権限', session: 'セッション', setting: '設定'
};
var COLS = {
  area: ['areaId', 'areaName', 'sortOrder', 'inUse', 'useStartDate', 'useEndDate', 'assigneeName', 'lastDoneDate', 'note', 'active', 'category', 'autoEnd', 'boundary', 'parentId', 'level'],
  building: ['buildingId', 'buildingName', 'areaId', 'lat', 'lng', 'buildingMemo', 'active'],
  room: ['roomId', 'buildingId', 'areaId', 'roomName', 'floor', 'sortOrder', 'mark', 'active', 'tenant'],
  input: ['roomId', 'buildingId', 'areaId', 'status', 'memo', 'updatedAt', 'updatedBy'],
  assign: ['areaId', 'targetType', 'targetId'],
  group: ['groupId', 'groupName', 'leaderMemberId', 'active', 'leaderLoginId'],
  member: ['memberId', 'memberName', 'groupId', 'active'],
  useLog: ['logId', 'areaId', 'areaName', 'assigneeName', 'startDate', 'endDate', 'endReason'],
  history: ['logId', 'targetType', 'targetId', 'fieldName', 'oldValue', 'newValue', 'updatedBy', 'updatedAt'],
  backup: ['backupId', 'batchId', 'executedAt', 'executedBy', 'scopeType', 'scopeId', 'clearStatus', 'clearMemo', 'roomId', 'buildingId', 'areaId', 'oldStatus', 'oldMemo', 'restored'],
  report: ['reportId', 'areaId', 'areaName', 'buildingId', 'roomName', 'reportText', 'createdBy', 'createdAt', 'active'],
  user: ['loginId', 'passwordHash', 'role', 'active', 'displayName', 'groupId', 'failCount', 'lockedUntil'],
  session: ['token', 'loginId', 'role', 'displayName', 'groupId', 'expiresAt'],
  setting: ['key', 'value']
};
// 文字列のまま保存したい列(日付などをスプレッドシートが勝手に変換しないように)
var TEXT_COLS = {
  area: ['areaId', 'useStartDate', 'useEndDate', 'lastDoneDate', 'boundary', 'parentId'],
  building: ['buildingId', 'areaId'], room: ['roomId', 'buildingId', 'areaId'], input: ['roomId', 'buildingId', 'areaId', 'updatedAt'],
  assign: ['areaId', 'targetId'], group: ['groupId', 'leaderMemberId', 'leaderLoginId'], member: ['memberId', 'groupId'], useLog: ['areaId', 'startDate', 'endDate'],
  history: ['targetId', 'updatedAt'], backup: ['roomId', 'buildingId', 'areaId', 'scopeId', 'executedAt'], report: ['areaId', 'buildingId', 'createdAt'], user: ['loginId', 'groupId']
}; // 日付やIDを、スプレッドシートが数値・日付に変換しないよう、文字として保存する列
var HARD_LIMITS = { history: [8000, 5000], session: [4000, 2000], backup: [30000, 20000] };

var STATUS_DEFAULTS = [
  { id: 'unvisited', label: '未訪問', visited: false, done: false },
  { id: 'met', label: '会えた', visited: true, done: true },
  { id: 'absent1', label: '留守(1回目)', visited: true, done: false },
  { id: 'absent2', label: '留守(2回目)', visited: true, done: false },
  { id: 'vacant', label: '空室', visited: true, done: true }
];
var CATEGORIES = ['国仲', '遠方', 'アパート']; // アパート=アパート専用の区域(部屋ごとに記録)。これまでの佐渡アパートGASとは、しばらく並行して使える
// 部屋の指定: 文字列、または { roomName, floor } のどちらでも受け付ける
function roomSpecs_(list) {
  return (list || []).map(function (x) { return typeof x === 'object' && x ? { roomName: String(x.roomName || '').trim(), floor: String(x.floor || '') } : { roomName: String(x || '').trim(), floor: '' }; }).filter(function (x) { return x.roomName; });
}
// 区域の境界線(GeoJSONのPolygon/MultiPolygon)の検査と整形。座標は小数6桁(約10cm)に丸めて、セルに入る長さにおさめる
function cleanBoundary_(g) {
  if (typeof g === 'string') { try { g = JSON.parse(g); } catch (e) { g = null; } }
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !g.coordinates) throw new Error('境界線の形式が正しくありません。');
  var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates, rd = function (n) { return Math.round(Number(n) * 1e6) / 1e6; };
  var out = polys.map(function (poly) {
    return poly.map(function (ring) {
      var r = ring.map(function (c) {
        var x = rd(c[0]), y = rd(c[1]); if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) throw new Error('境界線の座標が正しくありません。');
        return [x, y];
      });
      if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0].slice());
      if (r.length < 4) throw new Error('境界線は3点以上で囲んでください。');
      return r;
    });
  });
  var res = g.type === 'Polygon' ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
  var str = JSON.stringify(res); if (str.length > 45000) throw new Error('境界線の点が多すぎて保存できません(' + str.length + '文字)。点を減らしてください。');
  return str;
}
var ALL_GROUP = { groupId: 'all', groupName: '会衆', builtin: true }; // 全員が入っている特別なグループ(担当に指定すると、ログインした全員が編集できる)
function catOf_(a) { return CATEGORIES.indexOf(String(a.category)) >= 0 ? String(a.category) : '国仲'; }
var DEFAULTS = {
  appTitle: '佐渡住宅GAS', mapTileSource: 'gsi',
  mapLat: '38.08', mapLng: '138.44', mapZoom: '13',
  logDocId: '', downloadFolderId: '', autoEndMonths: '4', fiscalStartMonth: '9',
  apartmentUrl: 'https://script.google.com/macros/s/AKfycbxUl6JIpJzbbZiQGPqORidVTHJSs8eeeJSWaEtcHN0IUzTUOHvcYxv0XTGGWLZnLbW4/exec', // 佐渡アパートGASのURL(ホームの「アパート」ボタンの行き先)
  visitStatusList: JSON.stringify(STATUS_DEFAULTS)
};

// ============================== 共通の道具 ==============================
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { try { return Session.getScriptTimeZone(); } catch (e) { return 'Asia/Tokyo'; } }
function sheet_(k) {
  var s = ss_().getSheetByName(SHEETNAME[k]);
  if (!s) throw new Error('シート「' + SHEETNAME[k] + '」がありません。スプレッドシートのメニュー「訪問管理」→「初期設定を行う」を実行してください。');
  return s;
}
function truthy_(v) { return v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1'; }
function nowIso_() { return new Date().toISOString(); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function fmtDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  var s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.substr(0, 10) : s;
}
function newId_(p) { return p + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function indexBy_(arr, key) { var m = {}; arr.forEach(function (o) { m[o[key]] = o; }); return m; }
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function rowObj_(k, r, rowNum) { var o = { _row: rowNum }; COLS[k].forEach(function (c, i) { o[c] = r[i]; }); return o; }
function objRow_(k, o) { return COLS[k].map(function (c) { return (o[c] === undefined || o[c] === null) ? '' : o[c]; }); }
function readAll_(k) {
  var s = sheet_(k), n = s.getLastRow();
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, COLS[k].length).getValues().map(function (r, i) { return rowObj_(k, r, i + 2); });
}
// 指定した列が一致する行だけを読む(7万件でも全部は読まない)
function readWhere_(k, col, val) {
  var s = sheet_(k), n = s.getLastRow();
  if (n < 2) return [];
  var w = COLS[k].length, ci = COLS[k].indexOf(col) + 1;
  var colVals = s.getRange(2, ci, n - 1, 1).getValues();
  var runs = [], cur = null, i;
  for (i = 0; i < colVals.length; i++) {
    if (String(colVals[i][0]) === String(val)) {
      if (cur && cur.end === i - 1) cur.end = i; else { cur = { start: i, end: i }; runs.push(cur); }
    }
  }
  var out = [];
  if (runs.length > 30) {
    var all = s.getRange(2, 1, n - 1, w).getValues();
    runs.forEach(function (r) { for (var j = r.start; j <= r.end; j++) out.push(rowObj_(k, all[j], j + 2)); });
    return out;
  }
  runs.forEach(function (r) {
    s.getRange(r.start + 2, 1, r.end - r.start + 1, w).getValues().forEach(function (row, j) { out.push(rowObj_(k, row, r.start + 2 + j)); });
  });
  return out;
}
function appendObjs_(k, objs) {
  if (!objs.length) return;
  var s = sheet_(k), start = Math.max(s.getLastRow(), 1) + 1;
  s.getRange(start, 1, objs.length, COLS[k].length).setValues(objs.map(function (o) { return objRow_(k, o); }));
}
function writeObj_(k, o) { sheet_(k).getRange(o._row, 1, 1, COLS[k].length).setValues([objRow_(k, o)]); }
function deleteRowsWhere_(k, col, val) {
  var s = sheet_(k), n = s.getLastRow();
  if (n < 2) return 0;
  var ci = COLS[k].indexOf(col) + 1, vals = s.getRange(2, ci, n - 1, 1).getValues(), rows = [], i;
  for (i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(val)) rows.push(i + 2);
  var cnt = rows.length;
  while (rows.length) { // 下から消す(連続している部分はまとめて)
    var end = rows.pop(), start = end;
    while (rows.length && rows[rows.length - 1] === start - 1) start = rows.pop();
    s.deleteRows(start, end - start + 1);
  }
  return cnt;
}
function history_(type, id, field, oldV, newV, by) {
  appendObjs_('history', [{ logId: newId_('h'), targetType: type, targetId: id, fieldName: field, oldValue: String(oldV === undefined ? '' : oldV).slice(0, 300), newValue: String(newV === undefined ? '' : newV).slice(0, 300), updatedBy: by || '', updatedAt: nowIso_() }]);
}

// ============================== 設定 ==============================
function settingsMap_() {
  var m = {}, k;
  for (k in DEFAULTS) m[k] = DEFAULTS[k];
  readAll_('setting').forEach(function (r) { if (r.key !== '') m[String(r.key)] = String(r.value); });
  return m;
}
function setting_(key) { return settingsMap_()[key]; }
function setSetting_(key, value) {
  var rows = readAll_('setting'), i;
  for (i = 0; i < rows.length; i++) if (String(rows[i].key) === key) { rows[i].value = value; writeObj_('setting', rows[i]); return; }
  appendObjs_('setting', [{ key: key, value: value }]);
}
function statusList_() {
  try { var l = JSON.parse(setting_('visitStatusList')); if (l && l.length) return l; } catch (e) {}
  return STATUS_DEFAULTS;
}
function publicSettings_(m) {
  return { appTitle: m.appTitle, apartmentUrl: String(m.apartmentUrl || ''), mapTileSource: m.mapTileSource, mapLat: Number(m.mapLat), mapLng: Number(m.mapLng), mapZoom: Number(m.mapZoom), statusList: statusList_(), hasDownloads: !!m.downloadFolderId };
}

// ============================== 認証 ==============================
function hash_(pw, salt) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8);
  return b.map(function (x) { x = (x < 0 ? x + 256 : x).toString(16); return x.length === 1 ? '0' + x : x; }).join('');
}
function makeHash_(pw) { var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 8); return salt + '$' + hash_(pw, salt); }
function checkPw_(pw, stored) { var p = String(stored).split('$'); return p.length === 2 && hash_(String(pw), p[0]) === p[1]; }
function validatePw_(pw) { if (!pw || String(pw).length < 6) throw new Error('パスワードは6文字以上にしてください。'); }

function createSession_(u) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var exp = Date.now() + 30 * 24 * 3600 * 1000;
  var rec = { token: token, loginId: u.loginId, role: u.role, displayName: u.displayName, groupId: u.groupId || '', expiresAt: exp };
  appendObjs_('session', [rec]);
  CacheService.getScriptCache().put('s:' + token, JSON.stringify(rec), 21600);
  return token;
}
function requireAuth_(token) {
  token = String(token || '');
  if (!token) throw new Error('ログインしてください。');
  var cache = CacheService.getScriptCache(), hit = cache.get('s:' + token), rec = null;
  if (hit) rec = JSON.parse(hit);
  else {
    var rows = readWhere_('session', 'token', token);
    if (rows.length) { rec = rows[0]; cache.put('s:' + token, JSON.stringify({ token: rec.token, loginId: rec.loginId, role: rec.role, displayName: rec.displayName, groupId: rec.groupId, expiresAt: rec.expiresAt }), 21600); }
  }
  if (!rec || Number(rec.expiresAt) < Date.now()) throw new Error('SESSION_EXPIRED');
  if (rec.role === 'guest') throw new Error('SESSION_EXPIRED'); // 以前のゲストの記録は使えない(ログイン必須になったため)
  var us = readWhere_('user', 'loginId', rec.loginId); // ユーザーが無効化・削除されていたら即座に使えなくする
  if (!us.length || !truthy_(us[0].active)) throw new Error('SESSION_EXPIRED');
  rec.role = us[0].role; rec.displayName = us[0].displayName; rec.groupId = us[0].groupId;
  return { loginId: rec.loginId, role: rec.role, displayName: rec.displayName, groupId: String(rec.groupId || '') };
}
function getPublicInfo_() {
  var m = settingsMap_();
  return { appTitle: m.appTitle };
}
function login_(loginId, password) {
  loginId = String(loginId || '').trim();
  var rows = readWhere_('user', 'loginId', loginId);
  if (!rows.length) throw new Error('IDまたはパスワードが違います。');
  var u = rows[0];
  if (Number(u.lockedUntil) > Date.now()) throw new Error('ログインに失敗した回数が多いため、しばらくロックされています。');
  if (!truthy_(u.active) || !checkPw_(password, u.passwordHash)) {
    u.failCount = Number(u.failCount || 0) + 1;
    if (u.failCount >= 5) { u.lockedUntil = Date.now() + 15 * 60 * 1000; u.failCount = 0; }
    writeObj_('user', u);
    throw new Error('IDまたはパスワードが違います。');
  }
  u.failCount = 0; u.lockedUntil = ''; writeObj_('user', u);
  var token = createSession_(u);
  return { token: token, user: { loginId: u.loginId, role: u.role, displayName: u.displayName, groupId: String(u.groupId || '') } };
}
function logout_(token) {
  CacheService.getScriptCache().remove('s:' + token);
  var rows = readWhere_('session', 'token', String(token));
  rows.forEach(function (r) { r.expiresAt = 0; writeObj_('session', r); });
  return true;
}

// ============================== 区域の状態・権限 ==============================
function addMonths_(dateStr, n) {
  var p = dateStr.split('-'), d = new Date(Number(p[0]), Number(p[1]) - 1 + n, Number(p[2]));
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}
// 使用の期限: 終了日の指定があればその日、なければ開始日から○か月後
function expiry_(a) {
  var end = fmtDate_(a.useEndDate);
  if (end) return end;
  var st = fmtDate_(a.useStartDate);
  return st ? addMonths_(st, Number(setting_('autoEndMonths')) || 4) : '';
}
function areaState_(a) {
  if (String(a.autoEnd).toLowerCase() === 'false') return { inUse: truthy_(a.inUse), expired: false, expiry: '' }; // 自動で終了しない設定
  var exp = expiry_(a), t = today_();
  var expired = truthy_(a.inUse) && !!exp && (fmtDate_(a.useEndDate) ? t > exp : t >= exp);
  return { inUse: truthy_(a.inUse) && !expired, expired: expired, expiry: exp };
}
function assignedSet_(user) {
  var set = {};
  readAll_('assign').forEach(function (a) {
    if ((a.targetType === 'group' && (String(a.targetId) === ALL_GROUP.groupId || (user.groupId && String(a.targetId) === String(user.groupId)))) || (a.targetType === 'user' && String(a.targetId) === String(user.loginId))) {
      var kd = a.targetType === 'user' ? 'user' : (String(a.targetId) === ALL_GROUP.groupId ? 'all' : 'group');
      set[a.areaId] = set[a.areaId] ? set[a.areaId] + ',' + kd : kd; // 真偽として使える(空でない文字列)。中身は担当の種類: user=個人 / group=グループ / all=会衆
    }
  });
  return set;
}
// 編集できる人: 区域係=使用中なら全区域 / 奉仕者=使用中で、自分かグループ(会衆を含む)が担当のとき
function canEdit_(user, a, st, assigned) {
  if (!st.inUse) return false;
  if (user.role === 'admin') return true;
  return !!assigned[a.areaId];
}
// 親区域(大きな区域)は area シートの level='parent' の行。子区域の使用状態は、親が使用中ならその状態(グループ担当は親単位)、そうでなければ子自身の状態(個人担当は子単位)
function isParent_(a) { return String(a.level) === 'parent'; }
function effective_(a, user, assigned, byId) {
  var own = areaState_(a), pa = (!isParent_(a) && a.parentId && byId) ? byId[a.parentId] : null, pst = pa && truthy_(pa.active) ? areaState_(pa) : null;
  var via = pst && pst.inUse ? 'parent' : '', st = via ? pst : own, src = via ? pa : a;
  var mine = !!assigned[a.areaId] || (!!via && !!assigned[pa.areaId]);
  return { st: st, src: src, via: via, mine: mine, pa: pa, canEdit: st.inUse && (user.role === 'admin' || mine) };
}
function areaPublic_(a, user, assigned, byId) {
  var e = effective_(a, user, assigned, byId), st = e.st, src = e.src;
  return {
    areaId: a.areaId, areaName: a.areaName, category: catOf_(a), mine: e.mine, sortOrder: Number(a.sortOrder) || 0, inUse: st.inUse, expiry: st.expiry,
    useStartDate: fmtDate_(src.useStartDate), useEndDate: fmtDate_(src.useEndDate), assigneeName: src.assigneeName || '', lastDoneDate: fmtDate_(a.lastDoneDate),
    boundary: a.boundary ? String(a.boundary) : '', assigned: e.mine || user.role === 'admin', canEdit: e.canEdit,
    isParent: isParent_(a), parentId: String(a.parentId || ''), parentName: e.pa ? e.pa.areaName : '', via: e.via,
    kinds: (function () { var k = (assigned[a.areaId] || '') + ((e.via && assigned[e.pa.areaId]) ? ',' + assigned[e.pa.areaId] : ''); return k ? k.split(',').filter(function (x, i, l) { return l.indexOf(x) === i; }) : []; })()
  };
}

// ============================== 画面向けのデータ ==============================
function getBootstrap_(user) {
  migrate_();
  var m = settingsMap_(), assigned = assignedSet_(user);
  var all = readAll_('area').filter(function (a) { return truthy_(a.active); }), byId = indexBy_(all, 'areaId');
  var areas = all.map(function (a) { return areaPublic_(a, user, assigned, byId); });
  areas.sort(function (x, y) { return x.sortOrder - y.sortOrder || (x.areaName > y.areaName ? 1 : -1); });
  var gn = ''; if (user.groupId) { var gr = readAll_('group').filter(function (g) { return String(g.groupId) === String(user.groupId); })[0]; gn = gr ? String(gr.groupName || '') : ''; }
  user.groupName = gn;
  return { user: user, settings: publicSettings_(m), areas: areas, serverTime: nowIso_() };
}
function getAreaData_(user, areaId) {
  var allAreas = readAll_('area'), byId0 = indexBy_(allAreas, 'areaId'), area = byId0[areaId];
  if (!area || !truthy_(area.active)) throw new Error('区域が見つかりません。');
  var buildings = readWhere_('building', 'areaId', areaId).filter(function (b) { return truthy_(b.active); }).map(function (b) {
    return { buildingId: b.buildingId, buildingName: b.buildingName, lat: b.lat === '' ? null : Number(b.lat), lng: b.lng === '' ? null : Number(b.lng), buildingMemo: b.buildingMemo || '' };
  });
  var inputs = indexBy_(readWhere_('input', 'areaId', areaId), 'roomId');
  var rooms = readWhere_('room', 'areaId', areaId).filter(function (r) { return truthy_(r.active); }).map(function (r) {
    var i = inputs[r.roomId] || {};
    return { roomId: r.roomId, buildingId: r.buildingId, roomName: r.roomName, tenant: String(r.tenant || ''), floor: r.floor, sortOrder: Number(r.sortOrder) || 0, mark: r.mark || '', status: i.status || 'unvisited', memo: i.memo || '', updatedAt: i.updatedAt ? String(i.updatedAt) : '', updatedBy: i.updatedBy || '' };
  });
  var assigned = assignedSet_(user);
  return { area: areaPublic_(area, user, assigned, byId0), buildings: buildings, rooms: rooms, serverTime: nowIso_() };
}

// ============================== 同期(端末で入力した記録を受け取る) ==============================
function sync_(user, ops) {
  var results = [], areas = indexBy_(readAll_('area'), 'areaId'), assigned = assignedSet_(user);
  var roomsBy = {}, inputsBy = {}, buildingsBy = {}, appendList = [], stat = indexBy_(statusList_(), 'id');
  ops.forEach(function (op, i) {
    try {
      var area = areas[op.areaId];
      if (!area || !truthy_(area.active)) throw new Error('区域が見つかりません。');
      if (op.type === 'report') {
        appendObjs_('report', [{ reportId: newId_('r'), areaId: area.areaId, areaName: area.areaName, buildingId: op.buildingId || '', roomName: String(op.roomName || '').slice(0, 50), reportText: String(op.text || '').slice(0, 1000), createdBy: user.displayName, createdAt: nowIso_(), active: true }]);
        results.push({ i: i, ok: true }); return;
      }
      var eff = effective_(area, user, assigned, areas), canEdit = eff.canEdit;
      if (op.type === 'status') {
        if (!canEdit) throw new Error('「' + area.areaName + '」は使用中でない、または担当外のため編集できません。');
        var rooms = roomsBy[area.areaId] || (roomsBy[area.areaId] = indexBy_(readWhere_('room', 'areaId', area.areaId), 'roomId'));
        var inputs = inputsBy[area.areaId] || (inputsBy[area.areaId] = indexBy_(readWhere_('input', 'areaId', area.areaId), 'roomId'));
        var room = rooms[op.roomId];
        if (!room || !truthy_(room.active)) throw new Error('部屋が見つかりません。');
        var t = String(op.t || nowIso_()), cur = inputs[op.roomId];
        if (op.mark !== undefined) {
          if (['', 'reject', 'caution'].indexOf(op.mark) < 0) throw new Error('印の値が正しくありません。');
          if (String(room.mark || '') !== op.mark) { history_('room', room.roomId, 'mark', room.mark, op.mark, user.displayName); room.mark = op.mark; writeObj_('room', room); }
        }
        if (op.status !== undefined || op.memo !== undefined) { // 訪問状況だけ・メモだけ・両方、のどれでも保存する
          var newStatus = op.status !== undefined ? op.status : (cur ? cur.status : 'unvisited');
          if (!stat[newStatus]) throw new Error('訪問状況の値が正しくありません。');
          if (cur && String(cur.updatedAt) > t) { results.push({ i: i, ok: true, skipped: true }); return; }
          var rec = { roomId: room.roomId, buildingId: room.buildingId, areaId: area.areaId, status: newStatus, memo: String(op.memo === undefined ? (cur ? cur.memo : '') : op.memo).slice(0, 500), updatedAt: t, updatedBy: user.displayName };
          if (cur && cur._row) { rec._row = cur._row; writeObj_('input', rec); inputs[room.roomId] = rec; }
          else if (cur) { cur.status = rec.status; cur.memo = rec.memo; cur.updatedAt = rec.updatedAt; cur.updatedBy = rec.updatedBy; }
          else { appendList.push(rec); inputs[room.roomId] = rec; }
        }
        results.push({ i: i, ok: true }); return;
      }
      if (op.type === 'building') {
        if (user.role !== 'admin') throw new Error('建物の名前・メモの編集は区域係のみできます。');
        var bs = buildingsBy[area.areaId] || (buildingsBy[area.areaId] = indexBy_(readWhere_('building', 'areaId', area.areaId), 'buildingId'));
        var b = bs[op.buildingId];
        if (!b) throw new Error('建物が見つかりません。');
        ['buildingName', 'buildingMemo'].forEach(function (f) {
          if (op[f] !== undefined && String(b[f]) !== String(op[f])) { history_('building', b.buildingId, f, b[f], op[f], user.displayName); b[f] = String(op[f]).slice(0, 300); }
        });
        writeObj_('building', b);
        results.push({ i: i, ok: true }); return;
      }
      throw new Error('不明な操作です。');
    } catch (e) { results.push({ i: i, ok: false, error: String(e.message || e) }); }
  });
  appendObjs_('input', appendList);
  return { results: results, serverTime: nowIso_() };
}

function createReport_(user, b) { return sync_(user, [{ type: 'report', areaId: b.areaId, buildingId: b.buildingId, roomName: b.roomName, text: b.text }]); }
function changeMyPassword_(user, b) {
  var rows = readWhere_('user', 'loginId', user.loginId);
  if (!rows.length || !checkPw_(b.oldPassword, rows[0].passwordHash)) throw new Error('現在のパスワードが違います。');
  validatePw_(b.newPassword);
  rows[0].passwordHash = makeHash_(b.newPassword); writeObj_('user', rows[0]);
  return true;
}
function downloadAreaFile_(areaId, fileType) {
  var folderId = setting_('downloadFolderId');
  if (!folderId) throw new Error('ダウンロード用のフォルダが設定されていません。');
  var area = readAll_('area').filter(function (a) { return String(a.areaId) === String(areaId); })[0];
  if (!area) throw new Error('区域が見つかりません。');
  var ext = fileType === 'png' ? 'png' : 'pdf', name = area.areaName + '.' + ext;
  var it = DriveApp.getFolderById(folderId).getFilesByName(name);
  if (!it.hasNext()) throw new Error('ファイル「' + name + '」がフォルダにありません。');
  var blob = it.next().getBlob();
  return { name: name, mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// ============================== 区域の使用・自動終了・記録ドキュメント ==============================
function memberName_(id) { var m = readAll_('member').filter(function (x) { return String(x.memberId) === String(id); })[0]; return m ? m.memberName : ''; }
// グループの責任者: そのグループに所属するアカウントから選んだ人(表示名)。古いデータ(名簿から選んだ責任者)も、まだ使える
function leaderName_(g) {
  if (g.leaderLoginId) {
    var u = readWhere_('user', 'loginId', g.leaderLoginId)[0];
    if (u && truthy_(u.active) && String(u.groupId) === String(g.groupId)) return u.displayName;
    return '';
  }
  return memberName_(g.leaderMemberId);
}
// 会衆の責任者: 全アカウントから選んだ1人(設定に保存)。未設定なら「会衆」と記録する
function kaishuLeaderName_() {
  var id = setting_('kaishuLeader'); if (!id) return '';
  var u = readWhere_('user', 'loginId', id)[0]; return u && truthy_(u.active) ? u.displayName : '';
}
function assigneeName_(type, id) {
  if (type === 'group') {
    if (String(id) === ALL_GROUP.groupId) return kaishuLeaderName_() || ALL_GROUP.groupName;
    var g = readAll_('group').filter(function (x) { return String(x.groupId) === String(id) && truthy_(x.active); })[0];
    if (!g) throw new Error('グループが見つかりません。');
    var leader = leaderName_(g);
    if (!leader) throw new Error('グループ「' + g.groupName + '」の責任者が登録されていません。');
    return leader;
  }
  // 個人: 担当者とアカウントは同じデータ(ログインIDで選ぶ)
  var u = readWhere_('user', 'loginId', id)[0];
  if (!u || !truthy_(u.active)) throw new Error('担当者が見つかりません。');
  return u.displayName;
}
// 担当(複数可)の記録用の名前: グループ=責任者の名前、個人=表示名、会衆=会衆の責任者(いなければ「会衆」)。指定がなければ、アパートは「会衆」
function assigneesName_(targets, a) {
  if (!targets.length) { throw new Error('担当するグループ・個人・会衆を選んでください。'); }
  var seen = {}, out = [];
  targets.forEach(function (t) { var n = assigneeName_(t.type === 'group' ? 'group' : 'user', t.id); if (!seen[n]) { seen[n] = 1; out.push(n); } });
  return out.join('、');
}
function slashDate_(s) { var p = s.split('-'); return Number(p[0]) + '/' + Number(p[1]) + '/' + Number(p[2]); }
function clearLeader_(loginId) { readAll_('group').forEach(function (g) { if (String(g.leaderLoginId) === String(loginId)) { g.leaderLoginId = ''; writeObj_('group', g); } }); }
function norm_(s) { return String(s || '').replace(/[\s　]/g, '').replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }

// 原本(区域割り当ての記録)の表を探す。区域の行(名前の行)とその次の行(日付の行)が1組
function docFindArea_(doc, areaName) {
  var tables = doc.getBody().getTables(), t, r;
  for (t = 0; t < tables.length; t++) {
    for (r = 0; r < tables[t].getNumRows() - 1; r++) {
      var row = tables[t].getRow(r);
      if (row.getNumCells() >= 6 && norm_(row.getCell(0).getText()) === norm_(areaName)) {
        var dateRow = tables[t].getRow(r + 1);
        if (dateRow.getNumCells() < 8) throw new Error('記録用ドキュメントの表の形が想定と違います(日付の行のマスが8個ありません)。');
        return { nameRow: row, dateRow: dateRow };
      }
    }
  }
  throw new Error('記録用ドキュメントに区域「' + areaName + '」の行が見つかりません。');
}
function docOpen_() {
  var id = setting_('logDocId');
  return id ? DocumentApp.openById(id) : null;
}
function docLog_(fn) { // ドキュメントへの記録に失敗しても、区域の操作自体は止めない
  try { var doc = docOpen_(); if (!doc) return ''; fn(doc); doc.saveAndClose(); return ''; }
  catch (e) { return '記録用ドキュメントへの書き込みに失敗しました: ' + (e.message || e); }
}
function docLogStart_(area, name, startDate) {
  return docLog_(function (doc) {
    var f = docFindArea_(doc, area.areaName), k;
    for (k = 0; k < 4; k++) if (!String(f.nameRow.getCell(2 + k).getText()).trim()) {
      f.nameRow.getCell(2 + k).setText(name); f.dateRow.getCell(k * 2).setText(slashDate_(startDate)); return;
    }
    throw new Error('区域「' + area.areaName + '」の記入欄(4組)がすべて埋まっています。');
  });
}
function docLogEnd_(area, name, endDate) {
  return docLog_(function (doc) {
    var f = docFindArea_(doc, area.areaName), k, target = -1;
    for (k = 3; k >= 0; k--) {
      var n = String(f.nameRow.getCell(2 + k).getText()).trim();
      if (n && !String(f.dateRow.getCell(k * 2 + 1).getText()).trim() && (n === name || target < 0)) { target = k; if (n === name) break; }
    }
    if (target < 0) throw new Error('完了日を書く欄が見つかりません。');
    f.dateRow.getCell(target * 2 + 1).setText(slashDate_(endDate));
  });
}
function fiscalLabel_() {
  var d = new Date(), y = Number(Utilities.formatDate(d, tz_(), 'yyyy')), mo = Number(Utilities.formatDate(d, tz_(), 'M'));
  return String(mo >= (Number(setting_('fiscalStartMonth')) || 9) ? y : y - 1);
}
function createNewYearDoc_(user) {
  var id = setting_('logDocId');
  if (!id) throw new Error('記録用ドキュメントが設定されていません(動作設定)。');
  var label = fiscalLabel_(), srcFile = DriveApp.getFileById(id);
  var copy = srcFile.makeCopy(label + '年度 区域割り当ての記録');
  var doc = DocumentApp.openById(copy.getId()), areas = readAll_('area'), tables = doc.getBody().getTables(), done = 0;
  tables.forEach(function (tb) {
    for (var r = 0; r < tb.getNumRows() - 1; r++) {
      var row = tb.getRow(r);
      if (row.getNumCells() < 6) continue;
      var a = areas.filter(function (x) { return norm_(x.areaName) === norm_(row.getCell(0).getText()); })[0];
      if (!a) continue;
      var dr = tb.getRow(r + 1), k;
      if (dr.getNumCells() < 8) continue;
      for (k = 0; k < 4; k++) { row.getCell(2 + k).setText(''); dr.getCell(k * 2).setText(''); dr.getCell(k * 2 + 1).setText(''); }
      row.getCell(1).setText(a.lastDoneDate ? slashDate_(fmtDate_(a.lastDoneDate)) : '');
      done++;
    }
  });
  doc.getBody().getParagraphs().forEach(function (p) { if (/奉仕年度/.test(p.getText())) p.setText('奉仕年度： ' + label + '年度'); });
  doc.saveAndClose();
  setSetting_('logDocId', copy.getId());
  history_('setting', 'logDocId', 'logDocId', id, copy.getId(), user.displayName);
  return { docId: copy.getId(), url: 'https://docs.google.com/document/d/' + copy.getId() + '/edit', areasCarried: done, label: label };
}

function startAreaUse_(user, b) {
  var a = readAll_('area').filter(function (x) { return String(x.areaId) === String(b.areaId) && truthy_(x.active); })[0];
  if (!a) throw new Error('区域が見つかりません。');
  if (areaState_(a).inUse) throw new Error('「' + a.areaName + '」はすでに使用中です。先に終了してください。');
  var name = assigneeName_(b.assigneeType, b.assigneeId), start = b.startDate || today_(), end = b.endDate || '';
  if (end && end < start) throw new Error('終了日が開始日より前です。');
  a.inUse = true; a.useStartDate = start; a.useEndDate = end; a.assigneeName = name; writeObj_('area', a);
  appendObjs_('useLog', [{ logId: newId_('u'), areaId: a.areaId, areaName: a.areaName, assigneeName: name, startDate: start, endDate: '', endReason: '' }]);
  history_('area', a.areaId, 'inUse', false, true, user.displayName);
  return { warning: docLogStart_(a, name, start) };
}
function endAreaUse_(a, endDate, reason, byName) {
  var name = a.assigneeName;
  a.inUse = false; a.useEndDate = endDate; a.lastDoneDate = endDate; writeObj_('area', a);
  var logs = readWhere_('useLog', 'areaId', a.areaId).filter(function (l) { return !fmtDate_(l.endDate); });
  if (logs.length) { var l = logs[logs.length - 1]; l.endDate = endDate; l.endReason = reason; writeObj_('useLog', l); }
  history_('area', a.areaId, 'inUse', true, false, byName);
  return docLogEnd_(a, name, endDate);
}
function endAreaUseAction_(user, b) {
  var a = readAll_('area').filter(function (x) { return String(x.areaId) === String(b.areaId); })[0];
  if (!a) throw new Error('区域が見つかりません。');
  if (!truthy_(a.inUse)) throw new Error('「' + a.areaName + '」は使用中ではありません。');
  return { warning: endAreaUse_(a, b.endDate || today_(), '手動で終了', user.displayName) };
}
// 期限が来た区域を自動で終了する(毎日1回のトリガーと、画面の「今すぐ確認」から呼ばれる)
function autoEndAreas_() {
  var ended = [], warnings = [];
  readAll_('area').forEach(function (a) {
    if (!truthy_(a.inUse)) return;
    var st = areaState_(a);
    if (st.expired) { var w = endAreaUse_(a, st.expiry, fmtDate_(a.useEndDate) ? '終了日になったため自動終了' : '開始日から' + (Number(setting_('autoEndMonths')) || 4) + 'か月が経過したため自動終了', 'システム'); ended.push(a.areaName); if (w) warnings.push(w); }
  });
  return { ended: ended, warnings: warnings };
}
function dailyMaintenance() {
  withLock_(function () {
    autoEndAreas_();
    Object.keys(HARD_LIMITS).forEach(function (k) {
      var s = sheet_(k), n = s.getLastRow() - 1;
      if (n > HARD_LIMITS[k][0]) s.deleteRows(2, n - HARD_LIMITS[k][1]);
    });
    var sess = readAll_('session'), now = Date.now();
    for (var i = sess.length - 1; i >= 0; i--) if (Number(sess[i].expiresAt) < now) sheet_('session').deleteRow(sess[i]._row);
  });
}

// ============================== 管理者の操作 ==============================
var ADMIN_ = {
  getAdminAreas: function () {
    return { areas: readAll_('area').map(function (a) { var st = areaState_(a); return { areaId: a.areaId, areaName: a.areaName, sortOrder: a.sortOrder, inUse: st.inUse, expired: st.expired, expiry: st.expiry, useStartDate: fmtDate_(a.useStartDate), useEndDate: fmtDate_(a.useEndDate), assigneeName: a.assigneeName, lastDoneDate: fmtDate_(a.lastDoneDate), active: truthy_(a.active), category: catOf_(a), note: String(a.note || ''), autoEnd: String(a.autoEnd).toLowerCase() !== 'false', storedInUse: truthy_(a.inUse), parentId: String(a.parentId || ''), isParent: isParent_(a), hasBoundary: !!a.boundary }; }),
      assigns: readAll_('assign'), groups: [{ groupId: ALL_GROUP.groupId, groupName: ALL_GROUP.groupName, builtin: true, leaderLoginId: String(setting_('kaishuLeader') || '') }].concat(readAll_('group').filter(function (g) { return truthy_(g.active); })),
      users: readAll_('user').map(function (u) { return { loginId: u.loginId, displayName: u.displayName, groupId: String(u.groupId || ''), active: truthy_(u.active) }; }) };
  },
  addArea: function (user, b) {
    var name = String(b.areaName || '').trim(); if (!name) throw new Error('区域名を入力してください。');
    if (readAll_('area').some(function (a) { return truthy_(a.active) && norm_(a.areaName) === norm_(name); })) throw new Error('同じ名前の区域があります。');
    var cat = CATEGORIES.indexOf(b.category) >= 0 ? b.category : '国仲', pid = String(b.parentId || '');
    if (pid) { var par = readAll_('area').filter(function (x) { return String(x.areaId) === pid && isParent_(x) && truthy_(x.active); })[0]; if (!par) throw new Error('所属する大きな区域が見つかりません。'); cat = catOf_(par); }
    var id = newId_('a'), bd = b.boundary ? cleanBoundary_(b.boundary) : '';
    appendObjs_('area', [{ areaId: id, areaName: name, sortOrder: readAll_('area').length + 1, inUse: false, active: true, category: cat, boundary: bd, parentId: pid, level: '' }]);
    history_('area', id, 'add', '', name, user.displayName); return { areaId: id };
  },
  renameArea: function (user, b) {
    var a = readAll_('area').filter(function (x) { return String(x.areaId) === String(b.areaId); })[0]; if (!a) throw new Error('区域が見つかりません。');
    var name = String(b.areaName || '').trim(); if (!name) throw new Error('区域名を入力してください。');
    history_('area', a.areaId, 'areaName', a.areaName, name, user.displayName); a.areaName = name; writeObj_('area', a); return true;
  },
  // 区域の境界線を保存する(新しい区域の枠、または枠の形の変更)。地図に出る枠は、ここに保存したものが優先される
  saveAreaBoundary: function (user, b) {
    var a = readAll_('area').filter(function (x) { return String(x.areaId) === String(b.areaId); })[0]; if (!a) throw new Error('区域が見つかりません。');
    var str = cleanBoundary_(b.geometry);
    history_('area', a.areaId, 'boundary', a.boundary ? '(変更前あり)' : '(なし)', '変更', user.displayName);
    a.boundary = str; writeObj_('area', a); return true;
  },
  // 建物をまとめて作る(一軒家を何軒か同時に追加するときなど)。区域は1件ずつ指定する
  createBuildings: function (user, b) {
    var items = b.items || []; if (!items.length) throw new Error('追加する建物がありません。'); if (items.length > 200) throw new Error('一度に追加できるのは200件までです。');
    var areas = indexBy_(readAll_('area').filter(function (x) { return truthy_(x.active) && !isParent_(x); }), 'areaId');
    items.forEach(function (it) { if (!areas[it.areaId]) throw new Error('区域が見つかりません。'); if (!String(it.buildingName || '').trim()) throw new Error('建物名が空のものがあります。'); });
    var blds = [], rooms = [], ids = [];
    items.forEach(function (it) {
      var id = newId_('b'), rl = roomSpecs_(it.rooms); if (!rl.length) rl = [{ roomName: '（建物）', floor: '' }]; ids.push(id);
      blds.push({ buildingId: id, buildingName: String(it.buildingName).trim(), areaId: it.areaId, lat: it.lat === '' || it.lat == null ? '' : Number(it.lat), lng: it.lng === '' || it.lng == null ? '' : Number(it.lng), buildingMemo: it.buildingMemo || '', active: true });
      rl.forEach(function (n, i) { rooms.push({ roomId: id + '-' + (i + 1), buildingId: id, areaId: it.areaId, roomName: n.roomName, floor: n.floor, sortOrder: i + 1, mark: '', active: true }); });
    });
    appendObjs_('building', blds); appendObjs_('room', rooms);
    history_('building', ids[0], 'addMany', '', items.length + '件', user.displayName);
    return { buildingIds: ids };
  },
  // QGISから書き出した区域の表(子区域549行など)を取り込む。親区域(大きな区域)の行は、ここから自動で作る。
  // 行: { areaId(子のID), areaName(子の名前), parentId, parentName, category(国仲/遠方) }。1行でも問題があれば、どれも取り込まない。
  // すでにある区域は、名前・所属・区分だけを更新し、使用中などの記録はそのまま残す。
  importAreaTree: function (user, b) {
    var rows = b.rows || []; if (!rows.length) throw new Error('取り込む行がありません。');
    var bad = [], list = [], parents = {}, seen = {};
    rows.forEach(function (r, i) {
      var id = String(r.areaId || '').trim(), nm = String(r.areaName || '').trim(), pid = String(r.parentId || '').trim(), pnm = String(r.parentName || '').trim(), cat = String(r.category || '').trim();
      if (CATEGORIES.indexOf(cat) < 0) { bad.push((i + 2) + '行目: 区分は 国仲・遠方・アパート のいずれかです(「' + cat + '」)'); return; }
      var loose = cat === 'アパート' && !pid && !pnm; // アパートの区域は、大きな区域なしでも取り込める
      if (!id || !nm || (!loose && (!pid || !pnm))) { bad.push((i + 2) + '行目: 必要な項目が空です'); return; }
      if (seen[id]) { bad.push((i + 2) + '行目: 区域IDが重複しています'); return; } seen[id] = 1;
      if (!loose && id === pid) { bad.push((i + 2) + '行目: 子と親のIDが同じです'); return; }
      if (loose) { list.push({ id: id, name: nm, pid: '', cat: cat }); return; }
      var p = parents[pid]; if (p && (p.name !== pnm || p.cat !== cat)) { bad.push((i + 2) + '行目: 同じ親IDなのに、親の名前または区分が他の行と違います'); return; }
      parents[pid] = { name: pnm, cat: cat }; list.push({ id: id, name: nm, pid: pid, cat: cat });
    });
    if (bad.length) throw new Error(bad.slice(0, 8).join('\n') + (bad.length > 8 ? '\n…ほか' + (bad.length - 8) + '件' : ''));
    var cmp = function (x, y) { return String(x).localeCompare(String(y), 'ja', { numeric: true }); };
    var pids = Object.keys(parents).sort(function (x, y) { return cmp(parents[x].name, parents[y].name); });
    var cnt = {}; list.sort(function (x, y) { return cmp(x.name, y.name); });
    var by = indexBy_(readAll_('area'), 'areaId'), add = [], upd = 0, newP = 0;
    var put = function (o) { var cur = by[o.areaId]; if (cur) { Object.keys(o).forEach(function (k) { cur[k] = o[k]; }); cur.active = true; writeObj_('area', cur); upd++; } else { add.push(Object.assign({ inUse: false, active: true }, o)); } };
    pids.forEach(function (pid, i) { if (!by[pid]) newP++; put({ areaId: pid, areaName: parents[pid].name, sortOrder: i + 1, category: parents[pid].cat, level: 'parent', parentId: '' }); });
    list.forEach(function (c) { cnt[c.pid] = (cnt[c.pid] || 0) + 1; put({ areaId: c.id, areaName: c.name, sortOrder: cnt[c.pid], category: c.cat, level: '', parentId: c.pid }); });
    appendObjs_('area', add);
    history_('area', list[0].id, 'importTree', '', '親' + pids.length + '・子' + list.length, user.displayName);
    return { parents: pids.length, children: list.length, added: add.length, updated: upd, newParents: newP };
  },
  setAreaCategory: function (user, b) {
    var a = readAll_('area').filter(function (x) { return String(x.areaId) === String(b.areaId); })[0]; if (!a) throw new Error('区域が見つかりません。');
    if (CATEGORIES.indexOf(b.category) < 0) throw new Error('区分は 国仲・遠方・アパート のいずれかです。');
    history_('area', a.areaId, 'category', catOf_(a), b.category, user.displayName); a.category = b.category; writeObj_('area', a); return true;
  },
  setAssignments: function (user, b) {
    deleteRowsWhere_('assign', 'areaId', b.areaId);
    appendObjs_('assign', (b.targets || []).map(function (t) { return { areaId: b.areaId, targetType: t.type === 'group' ? 'group' : 'user', targetId: t.id }; }));
    history_('area', b.areaId, 'assign', '', JSON.stringify(b.targets || []), user.displayName); return true;
  },
  startAreaUse: startAreaUse_,
  endAreaUse: endAreaUseAction_,
  runAutoEnd: function () { return autoEndAreas_(); },
  createNewYearDoc: createNewYearDoc_,

  getDataEdit: function (user, b) {
    return { buildings: readWhere_('building', 'areaId', b.areaId).map(function (x) { delete x._row; return x; }), rooms: readWhere_('room', 'areaId', b.areaId).map(function (x) { delete x._row; return x; }) };
  },
  createBuilding: function (user, b) {
    var area = readAll_('area').filter(function (x) { return String(x.areaId) === String(b.areaId); })[0]; if (!area) throw new Error('区域が見つかりません。');
    var name = String(b.buildingName || '').trim(); if (!name) throw new Error('建物名を入力してください。');
    var id = newId_('b'), rl = roomSpecs_(b.rooms);
    if (!rl.length) rl = [{ roomName: '（建物）', floor: '' }];
    appendObjs_('building', [{ buildingId: id, buildingName: name, areaId: b.areaId, lat: b.lat === '' || b.lat == null ? '' : Number(b.lat), lng: b.lng === '' || b.lng == null ? '' : Number(b.lng), buildingMemo: b.buildingMemo || '', active: true }]);
    appendObjs_('room', rl.map(function (n, i) { return { roomId: id + '-' + (i + 1), buildingId: id, areaId: b.areaId, roomName: n.roomName, floor: n.floor, sortOrder: i + 1, mark: '', active: true }; }));
    history_('building', id, 'add', '', name, user.displayName); return { buildingId: id };
  },
  updateBuilding: function (user, b) {
    var x = readWhere_('building', 'buildingId', b.buildingId)[0]; if (!x) throw new Error('建物が見つかりません。');
    ['buildingName', 'buildingMemo', 'lat', 'lng'].forEach(function (f) { if (b[f] !== undefined && String(x[f]) !== String(b[f])) { history_('building', x.buildingId, f, x[f], b[f], user.displayName); x[f] = b[f]; } });
    writeObj_('building', x); return true;
  },
  addRooms: function (user, b) {
    var bd = readWhere_('building', 'buildingId', b.buildingId)[0]; if (!bd) throw new Error('建物が見つかりません。');
    var cur = readWhere_('room', 'buildingId', b.buildingId), max = cur.reduce(function (m, r) { return Math.max(m, Number(r.sortOrder) || 0); }, 0);
    var have = {}; cur.forEach(function (r) { if (truthy_(r.active)) have[norm_(r.roomName)] = true; });
    var list = roomSpecs_(b.rooms).filter(function (r) { if (have[norm_(r.roomName)]) return false; have[norm_(r.roomName)] = true; return true; });
    appendObjs_('room', list.map(function (n, i) { return { roomId: bd.buildingId + '-' + newId_('').slice(0, 5), buildingId: bd.buildingId, areaId: bd.areaId, roomName: n.roomName, floor: n.floor, sortOrder: max + i + 1, mark: '', active: true }; }));
    if (list.length) history_('building', bd.buildingId, 'addRooms', '', list.map(function (r) { return r.roomName; }).join(','), user.displayName);
    return list.length;
  },
  // 建物を別の区域へ移す(部屋と入力データの区域も一緒に移る)
  setBuildingArea: function (user, b) {
    var bd = readWhere_('building', 'buildingId', b.buildingId)[0]; if (!bd) throw new Error('建物が見つかりません。');
    var ar = readAll_('area').filter(function (x) { return String(x.areaId) === String(b.areaId) && truthy_(x.active); })[0]; if (!ar) throw new Error('区域が見つかりません。');
    if (String(bd.areaId) === String(ar.areaId)) return true;
    history_('building', bd.buildingId, 'areaId', bd.areaId, ar.areaId, user.displayName);
    bd.areaId = ar.areaId; writeObj_('building', bd);
    ['room', 'input'].forEach(function (k) { readWhere_(k, 'buildingId', bd.buildingId).forEach(function (r) { r.areaId = ar.areaId; writeObj_(k, r); }); });
    return true;
  },
  // 建物をまとめて別の区域へ移す(アパートの区域づくりなど)。部屋と記録の所属も、列ごとに一度で書き換える
  moveBuildings: function (user, b) {
    var ids = (b.buildingIds || []).map(String).filter(function (x) { return x; }); if (!ids.length) throw new Error('移す建物を選んでください。'); if (ids.length > 500) throw new Error('一度に移せるのは500件までです。');
    var ar = readAll_('area').filter(function (x) { return String(x.areaId) === String(b.areaId) && truthy_(x.active) && !isParent_(x); })[0]; if (!ar) throw new Error('移す先の区域が見つかりません。');
    var set = {}; ids.forEach(function (x) { set[x] = 1; });
    var moved = 0;
    ['building', 'room', 'input'].forEach(function (k) {
      var s = sheet_(k), n = s.getLastRow() - 1; if (n < 1) return;
      var bi = COLS[k].indexOf('buildingId') + 1, ai = COLS[k].indexOf('areaId') + 1;
      var bcol = s.getRange(2, bi, n, 1).getValues(), acol = s.getRange(2, ai, n, 1).getValues(), c = 0;
      for (var i = 0; i < n; i++) if (set[String(bcol[i][0])] && String(acol[i][0]) !== String(ar.areaId)) { acol[i][0] = ar.areaId; c++; }
      if (c) s.getRange(2, ai, n, 1).setValues(acol);
      if (k === 'building') moved = c;
    });
    if (moved) history_('building', ids[0], 'moveMany', '', ar.areaName + 'へ' + moved + '件', user.displayName);
    return { moved: moved };
  },
  updateRoom: function (user, b) {
    var r = readWhere_('room', 'roomId', b.roomId)[0]; if (!r) throw new Error('部屋が見つかりません。');
    ['roomName', 'floor', 'tenant', 'mark'].forEach(function (f) { if (b[f] !== undefined && String(r[f]) !== String(b[f])) { history_('room', r.roomId, f, r[f], b[f], user.displayName); r[f] = b[f]; } });
    writeObj_('room', r); return true;
  },
  setActive: function (user, b) {
    var k = { area: 'area', building: 'building', room: 'room' }[b.kind], idc = k + 'Id';
    var x = readWhere_(k, idc, b.id)[0]; if (!x) throw new Error('見つかりません。');
    x.active = !!b.active; writeObj_(k, x); history_(b.kind, b.id, 'active', !b.active, !!b.active, user.displayName);
    if (b.kind === 'building') readWhere_('room', 'buildingId', b.id).forEach(function (r) { r.active = !!b.active; writeObj_('room', r); });
    return true;
  },
  purgeItem: function (user, b) {
    if (b.kind === 'room') { deleteRowsWhere_('input', 'roomId', b.id); deleteRowsWhere_('room', 'roomId', b.id); }
    else if (b.kind === 'building') { deleteRowsWhere_('input', 'buildingId', b.id); deleteRowsWhere_('room', 'buildingId', b.id); deleteRowsWhere_('building', 'buildingId', b.id); }
    else if (b.kind === 'area') { ['input', 'room', 'building', 'assign'].forEach(function (k) { deleteRowsWhere_(k, 'areaId', b.id); }); deleteRowsWhere_('area', 'areaId', b.id); }
    else throw new Error('不明な種類です。');
    history_(b.kind, b.id, 'purge', '', '完全に削除', user.displayName); return true;
  },
  // CSV取り込み(QGISから書き出したデータなど)。キーが同じ行は上書き、なければ追加
  importRows: function (user, b) {
    var kinds = { area: 'areaId', building: 'buildingId', room: 'roomId', group: 'groupId' }, k = b.kind, key = kinds[k];
    if (!key) throw new Error('取り込める種類は area/building/room/group です。');
    var s = sheet_(k), n = s.getLastRow(), idx = {}, ki = COLS[k].indexOf(key) + 1;
    if (n >= 2) s.getRange(2, ki, n - 1, 1).getValues().forEach(function (r, i) { idx[String(r[0])] = i + 2; });
    var add = [], upd = 0, dup = 0, addPos = {};
    (b.rows || []).forEach(function (r) {
      var id = String(r[key] || '').trim(); if (!id) return;
      var o = { }; COLS[k].forEach(function (c) { o[c] = r[c] === undefined ? '' : r[c]; });
      if (o.active === '') o.active = true;
      if (idx[id] > 0) { o._row = idx[id]; writeObj_(k, o); upd++; }
      else if (idx[id] === -1) { dup++; add[addPos[id]] = o; } // 同じ取り込みの中にIDの重複があれば、後の行で上書き
      else { addPos[id] = add.length; add.push(o); idx[id] = -1; }
    });
    appendObjs_(k, add); return { added: add.length, updated: upd, duplicates: dup };
  },
  exportCsv: function (user, b) {
    var k = b.kind === 'rooms' ? 'room' : 'building', rows = readAll_(k), inputs = b.kind === 'rooms' ? indexBy_(readAll_('input'), 'roomId') : null;
    var head, lines;
    if (k === 'building') { head = ['uuid2', 'buildingName', 'buildingMemo']; lines = rows.filter(function (r) { return truthy_(r.active); }).map(function (r) { return [r.buildingId, r.buildingName, r.buildingMemo]; }); }
    else { head = ['roomId', 'uuid2', 'roomName', 'floor', 'tenant', 'mark', 'status', 'memo']; lines = rows.filter(function (r) { return truthy_(r.active); }).map(function (r) { var i = inputs[r.roomId] || {}; return [r.roomId, r.buildingId, r.roomName, r.floor, r.tenant, r.mark, i.status || 'unvisited', i.memo || '']; }); }
    var esc = function (v) { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return { filename: (b.kind === 'rooms' ? 'rooms' : 'buildings') + '_' + today_() + '.csv', csv: '﻿' + [head].concat(lines).map(function (l) { return l.map(esc).join(','); }).join('\r\n') + '\r\n' };
  },

  getReports: function () { return readAll_('report').filter(function (r) { return truthy_(r.active); }).reverse().slice(0, 300).map(function (r) { delete r._row; return r; }); },
  deleteReport: function (user, b) { var r = readWhere_('report', 'reportId', b.reportId)[0]; if (r) { r.active = false; writeObj_('report', r); } return true; },
  getLogs: function () {
    var h = readAll_('history'), u = readAll_('useLog');
    return { history: h.slice(-300).reverse().map(function (r) { delete r._row; return r; }), useLogs: u.slice(-200).reverse().map(function (r) { delete r._row; r.startDate = fmtDate_(r.startDate); r.endDate = fmtDate_(r.endDate); return r; }) };
  },

  bulkClear: function (user, b) {
    var col = b.scopeType === 'building' ? 'buildingId' : 'areaId', rows = readWhere_('input', col, b.scopeId);
    if (!b.clearStatus && !b.clearMemo) throw new Error('消す項目を選んでください。');
    var keepVacant = b.keepVacantStatus !== false, keepFlagged = b.keepFlaggedMemo !== false;
    var marks = indexBy_(readWhere_('room', col, b.scopeId), 'roomId');
    var batchId = newId_('x'), at = nowIso_(), bk = [], n = 0;
    rows.forEach(function (r) {
      var flagged = ['reject', 'caution'].indexOf((marks[r.roomId] || {}).mark) >= 0;
      var cs = !!b.clearStatus && !(keepVacant && r.status === 'vacant');
      var cm = !!b.clearMemo && !(keepFlagged && flagged);
      if (!cs && !cm) return;
      bk.push({ backupId: newId_('k'), batchId: batchId, executedAt: at, executedBy: user.displayName, scopeType: b.scopeType, scopeId: b.scopeId, clearStatus: cs, clearMemo: cm, roomId: r.roomId, buildingId: r.buildingId, areaId: r.areaId, oldStatus: r.status, oldMemo: r.memo, restored: false });
      if (cs) r.status = 'unvisited'; if (cm) r.memo = '';
      r.updatedAt = at; r.updatedBy = user.displayName; writeObj_('input', r); n++;
    });
    if (bk.length) appendObjs_('backup', bk);
    history_(b.scopeType, b.scopeId, 'bulkClear', n + '件', batchId, user.displayName);
    return { count: n, batchId: batchId };
  },
  getLastBulk: function () {
    var all = readAll_('backup').filter(function (r) { return !truthy_(r.restored); });
    if (!all.length) return null; var last = all[all.length - 1].batchId, grp = all.filter(function (r) { return r.batchId === last; });
    return { batchId: last, executedAt: String(grp[0].executedAt), executedBy: grp[0].executedBy, scopeType: grp[0].scopeType, scopeId: grp[0].scopeId, count: grp.length, clearStatus: grp.some(function (g) { return truthy_(g.clearStatus); }), clearMemo: grp.some(function (g) { return truthy_(g.clearMemo); }) };
  },
  undoBulk: function (user) {
    var info = ADMIN_.getLastBulk(); if (!info) throw new Error('元に戻せる操作がありません。');
    var grp = readAll_('backup').filter(function (r) { return r.batchId === info.batchId && !truthy_(r.restored); }), at = nowIso_();
    var inputs = indexBy_(readWhere_('input', 'areaId', grp.length ? grp[0].areaId : ''), 'roomId');
    grp.forEach(function (g) {
      var cur = inputs[g.roomId] || readWhere_('input', 'roomId', g.roomId)[0];
      if (cur) { if (truthy_(g.clearStatus)) cur.status = g.oldStatus; if (truthy_(g.clearMemo)) cur.memo = g.oldMemo; cur.updatedAt = at; cur.updatedBy = user.displayName; writeObj_('input', cur); }
      g.restored = true; writeObj_('backup', g);
    });
    history_(info.scopeType, info.scopeId, 'undoBulk', info.batchId, grp.length + '件', user.displayName); return { count: grp.length };
  },

  getUsers: function () { return readAll_('user').map(function (u) { return { loginId: u.loginId, role: u.role, active: truthy_(u.active), displayName: u.displayName, groupId: u.groupId, locked: Number(u.lockedUntil) > Date.now() }; }); },
  addUser: function (user, b) {
    var id = String(b.loginId || '').trim(); if (!/^[A-Za-z0-9_.@-]{3,40}$/.test(id)) throw new Error('IDは半角英数字(_.@-)3〜40文字にしてください。');
    validatePw_(b.password);
    if (readWhere_('user', 'loginId', id).length) throw new Error('そのIDはすでにあります。');
    appendObjs_('user', [{ loginId: id, passwordHash: makeHash_(b.password), role: b.role === 'admin' ? 'admin' : 'editor', active: true, displayName: b.displayName || id, groupId: b.groupId || '', failCount: 0, lockedUntil: '' }]);
    history_('user', id, 'add', '', b.role, user.displayName); return true;
  },
  updateUser: function (user, b) {
    var u = readWhere_('user', 'loginId', b.loginId)[0]; if (!u) throw new Error('ユーザーが見つかりません。');
    var activeAdmins = readAll_('user').filter(function (x) { return x.role === 'admin' && truthy_(x.active); });
    var losing = u.role === 'admin' && ((b.role && b.role !== 'admin') || (b.active !== undefined && !b.active));
    if (losing && activeAdmins.length <= 1) throw new Error('有効な管理者が0人になるため変更できません。');
    if (b.groupId !== undefined && String(b.groupId) !== String(u.groupId)) clearLeader_(u.loginId); // 別のグループに移ったら、前のグループの責任者から外す
    ['displayName', 'groupId'].forEach(function (f) { if (b[f] !== undefined) u[f] = b[f]; });
    if (b.role) u.role = b.role === 'admin' ? 'admin' : 'editor';
    if (b.active !== undefined) u.active = !!b.active;
    if (b.unlock) { u.failCount = 0; u.lockedUntil = ''; }
    if (b.password) { validatePw_(b.password); u.passwordHash = makeHash_(b.password); }
    writeObj_('user', u); history_('user', u.loginId, 'update', '', JSON.stringify({ role: u.role, active: u.active }), user.displayName); return true;
  },
  deleteUser: function (user, b) {
    var u = readWhere_('user', 'loginId', b.loginId)[0]; if (!u) return true;
    if (String(u.loginId) === String(user.loginId)) throw new Error('自分自身は削除できません。');
    if (u.role === 'admin' && readAll_('user').filter(function (x) { return x.role === 'admin' && truthy_(x.active); }).length <= 1) throw new Error('最後の管理者は削除できません。');
    clearLeader_(b.loginId); deleteRowsWhere_('user', 'loginId', b.loginId); history_('user', b.loginId, 'delete', '', '', user.displayName); return true;
  },
  setKaishuLeader: function (user, b) {
    var id = String(b.leaderLoginId || '');
    if (id) { var u = readWhere_('user', 'loginId', id)[0]; if (!u || !truthy_(u.active)) throw new Error('アカウントが見つかりません。'); }
    setSetting_('kaishuLeader', id); history_('setting', 'kaishuLeader', 'kaishuLeader', '', id, user.displayName); return true;
  },
  saveGroup: function (user, b) {
    var name = String(b.groupName || '').trim(); if (!name) throw new Error('グループ名を入力してください。');
    if (name === ALL_GROUP.groupName || String(b.groupId) === ALL_GROUP.groupId) throw new Error('「会衆」は全員が入っている特別なグループなので、追加・変更できません。');
    var g = b.groupId ? readWhere_('group', 'groupId', b.groupId)[0] : null;
    var leader = String(b.leaderLoginId || '');
    if (leader) { var lu = readWhere_('user', 'loginId', leader)[0]; if (!g || !lu || String(lu.groupId) !== String(g.groupId)) throw new Error('責任者は、このグループに所属しているアカウントから選んでください。'); }
    if (g) { g.groupName = name; if (b.leaderLoginId !== undefined) { g.leaderLoginId = leader; if (leader) g.leaderMemberId = ''; } writeObj_('group', g); } // 名前を変えても、IDで結びついているので、アカウントの表示は自動で変わる
    else appendObjs_('group', [{ groupId: newId_('g'), groupName: name, leaderMemberId: '', active: true, leaderLoginId: '' }]);
    return true;
  },
  deleteGroup: function (user, b) { if (String(b.groupId) === ALL_GROUP.groupId) throw new Error('「会衆」は削除できません。'); var g = readWhere_('group', 'groupId', b.groupId)[0]; if (g) { g.active = false; writeObj_('group', g); } return true; },

  getSettings: function () { return settingsMap_(); },
  saveSettings: function (user, b) {
    var allowed = ['appTitle', 'mapTileSource', 'mapLat', 'mapLng', 'mapZoom', 'logDocId', 'downloadFolderId', 'autoEndMonths', 'fiscalStartMonth', 'apartmentUrl'];
    var cur = settingsMap_();
    var au = b.values && b.values.apartmentUrl; if (au !== undefined && String(au).trim() !== '' && !/^https?:\/\/\S+$/.test(String(au).trim())) throw new Error('アパートのURLは https:// から始まる形で入力してください。');
    if (au !== undefined) b.values.apartmentUrl = String(au).trim();
    allowed.forEach(function (k) { if (b.values && b.values[k] !== undefined && String(cur[k]) !== String(b.values[k])) { setSetting_(k, String(b.values[k])); history_('setting', k, k, cur[k], b.values[k], user.displayName); } });
    return true;
  },

  // 区域管理の進み具合(区域ごとの訪問済み部屋数・完了した建物数)
  getAreaProgress: function () {
    var stat = indexBy_(statusList_(), 'id'), inputs = indexBy_(readAll_('input'), 'roomId'), by = {}, bs = {};
    readAll_('room').forEach(function (r) {
      if (!truthy_(r.active)) return;
      var c = by[r.areaId] || (by[r.areaId] = { total: 0, visited: 0, buildings: 0, doneBuildings: 0 });
      var s = stat[(inputs[r.roomId] || {}).status || 'unvisited'] || {};
      c.total++; if (s.visited) c.visited++;
      var b = bs[r.buildingId] || (bs[r.buildingId] = { a: r.areaId, n: 0, d: 0 }); b.n++; if (s.done) b.d++;
    });
    Object.keys(bs).forEach(function (id) { var b = bs[id], c = by[b.a]; if (!c) return; c.buildings++; if (b.n && b.n === b.d) c.doneBuildings++; });
    return by;
  },
  // 区域管理の「保存」: 使用中の切り替え・担当・使用期間・自動終了・メモを、まとめて保存する(佐渡アパートGASの区域管理と同じ流れ)
  saveAreaOps: function (user, b) {
    var a = readAll_('area').filter(function (x) { return String(x.areaId) === String(b.areaId); })[0]; if (!a) throw new Error('区域が見つかりません。');
    var wasIn = truthy_(a.inUse), nowIn = b.inUse === undefined ? wasIn : !!b.inUse, warning = '';
    var targets = (b.targets || []).filter(function (t) { return t && t.id; });
    // アパートの区域は、担当を選ばなければ「会衆」(ログインした全員が編集できる)として使い始める
    if (catOf_(a) === 'アパート' && !targets.length && (b.targets !== undefined || (nowIn && !wasIn))) { targets = [{ type: 'group', id: ALL_GROUP.groupId }]; b.targets = targets; }
    var st = b.useStartDate === undefined ? fmtDate_(a.useStartDate) : String(b.useStartDate || ''), en = b.useEndDate === undefined ? fmtDate_(a.useEndDate) : String(b.useEndDate || '');
    if (b.autoEnd !== undefined && String(a.autoEnd !== undefined && a.autoEnd !== '' ? a.autoEnd : true) !== String(!!b.autoEnd)) { history_('area', a.areaId, 'autoEnd', a.autoEnd, !!b.autoEnd, user.displayName); a.autoEnd = !!b.autoEnd; }
    var note = String(b.note === undefined ? a.note || '' : b.note).slice(0, 500);
    if (String(a.note || '') !== note) { history_('area', a.areaId, 'note', a.note || '', note, user.displayName); a.note = note; }
    if (nowIn && !wasIn) {
      var name = assigneesName_(targets, a); st = st || today_();
      if (en && en < st) throw new Error('終了日が開始日より前です。');
      a.inUse = true; a.useStartDate = st; a.useEndDate = en; a.assigneeName = name; writeObj_('area', a);
      appendObjs_('useLog', [{ logId: newId_('u'), areaId: a.areaId, areaName: a.areaName, assigneeName: name, startDate: st, endDate: '', endReason: '' }]);
      history_('area', a.areaId, 'inUse', false, true, user.displayName);
      warning = docLogStart_(a, name, st);
    } else if (!nowIn && wasIn) {
      warning = endAreaUse_(a, b.endDate || today_(), '手動で終了', user.displayName); // 終了日などはここで書き込まれる
    } else if (nowIn) {
      if (!st) throw new Error('使用中の区域は開始日が必要です。');
      if (en && en < st) throw new Error('終了日が開始日より前です。');
      if (fmtDate_(a.useStartDate) !== st) history_('area', a.areaId, 'useStartDate', fmtDate_(a.useStartDate), st, user.displayName);
      if (fmtDate_(a.useEndDate) !== en) history_('area', a.areaId, 'useEndDate', fmtDate_(a.useEndDate), en, user.displayName);
      a.useStartDate = st; a.useEndDate = en;
      if (b.targets !== undefined) a.assigneeName = assigneesName_(targets, a);
      writeObj_('area', a);
    } else writeObj_('area', a);
    if (b.targets !== undefined) {
      deleteRowsWhere_('assign', 'areaId', a.areaId);
      appendObjs_('assign', targets.map(function (t) { return { areaId: a.areaId, targetType: t.type === 'group' ? 'group' : 'user', targetId: t.id }; }));
      history_('area', a.areaId, 'assign', '', JSON.stringify(targets), user.displayName);
    }
    return { warning: warning };
  },
  // アカウントのまとめ保存(1件でも問題があれば、どれも保存しない)
  updateUsers: function (user, b) {
    var list = b.changes || [], users = readAll_('user'), by = indexBy_(users, 'loginId'), groups = indexBy_(readAll_('group'), 'groupId');
    list.forEach(function (c) {
      var u = by[c.loginId]; if (!u) throw new Error('ユーザー「' + c.loginId + '」が見つかりません。');
      if (c.displayName !== undefined && !String(c.displayName).trim()) throw new Error('表示名が空のユーザーがあります(' + c.loginId + ')。');
      if (c.groupId && !groups[c.groupId]) throw new Error('存在しないグループが指定されています(' + c.loginId + ')。');
      if (c.role !== undefined && ['admin', 'editor'].indexOf(c.role) < 0) throw new Error('権限の値が正しくありません。');
    });
    var after = users.map(function (u) { var c = list.filter(function (x) { return x.loginId === u.loginId; })[0] || {}; return { loginId: u.loginId, role: c.role !== undefined ? c.role : u.role, active: c.active !== undefined ? !!c.active : truthy_(u.active) }; });
    if (!after.some(function (u) { return u.role === 'admin' && u.active; })) throw new Error('有効な区域係が0人になるため保存できません。');
    if (list.some(function (c) { return c.loginId === user.loginId && ((c.role !== undefined && c.role !== 'admin') || c.active === false); })) throw new Error('自分自身の権限・有効状態は変更できません。');
    list.forEach(function (c) {
      var u = by[c.loginId];
      if (c.groupId !== undefined && String(c.groupId) !== String(u.groupId)) clearLeader_(u.loginId);
      if (c.displayName !== undefined) u.displayName = String(c.displayName).trim();
      if (c.groupId !== undefined) u.groupId = c.groupId;
      if (c.role !== undefined) u.role = c.role;
      if (c.active !== undefined) u.active = !!c.active;
      writeObj_('user', u); history_('user', u.loginId, 'update', '', JSON.stringify({ displayName: u.displayName, groupId: u.groupId, role: u.role, active: u.active }), user.displayName);
    });
    return { count: list.length };
  },
  saveGroups: function (user, b) {
    var list = b.changes || [], by = indexBy_(readAll_('group'), 'groupId'), users = readAll_('user'), names = {};
    readAll_('group').forEach(function (g) { if (truthy_(g.active)) names[g.groupId] = g.groupName; });
    list.forEach(function (c) {
      var g = by[c.groupId]; if (!g) throw new Error('グループが見つかりません。');
      var nm = String(c.groupName === undefined ? g.groupName : c.groupName).trim(); if (!nm) throw new Error('グループ名が空です。'); if (nm === ALL_GROUP.groupName) throw new Error('「会衆」は使えない名前です。');
      names[c.groupId] = nm;
      if (c.leaderLoginId) { var lu = users.filter(function (x) { return x.loginId === c.leaderLoginId; })[0]; if (!lu || String(lu.groupId) !== String(g.groupId)) throw new Error('責任者は、そのグループに所属しているアカウントから選んでください(' + nm + ')。'); }
    });
    var seen = {}; Object.keys(names).forEach(function (k) { var n = norm_(names[k]); if (seen[n]) throw new Error('同じ名前のグループがあります: ' + names[k]); seen[n] = 1; });
    list.forEach(function (c) {
      var g = by[c.groupId];
      if (c.groupName !== undefined) g.groupName = String(c.groupName).trim();
      if (c.leaderLoginId !== undefined) { g.leaderLoginId = c.leaderLoginId; if (c.leaderLoginId) g.leaderMemberId = ''; }
      writeObj_('group', g); history_('group', g.groupId, 'update', '', JSON.stringify({ groupName: g.groupName, leaderLoginId: g.leaderLoginId }), user.displayName);
    });
    return { count: list.length };
  },
  // 分析: 効率的な訪問に役立てるための集計
  getAnalysis: function () {
    var areas = readAll_('area').filter(function (a) { return truthy_(a.active) && !isParent_(a); }), stat = indexBy_(statusList_(), 'id');
    var rooms = readAll_('room').filter(function (r) { return truthy_(r.active); }), inputs = indexBy_(readAll_('input'), 'roomId');
    var by = {}; areas.forEach(function (a) { by[a.areaId] = { total: 0, done: 0, visited: 0, revisit: 0, reject: 0, caution: 0 }; });
    rooms.forEach(function (r) {
      var c = by[r.areaId]; if (!c) return; c.total++;
      var s = stat[(inputs[r.roomId] || {}).status || 'unvisited'] || stat.unvisited || {};
      if (r.mark === 'reject') c.reject++; else if (r.mark === 'caution') c.caution++;
      if (s.done) c.done++; if (s.visited) c.visited++;
      if (s.visited && !s.done && r.mark !== 'reject') c.revisit++;
    });
    var t = today_();
    return areas.map(function (a) {
      var c = by[a.areaId], last = fmtDate_(a.lastDoneDate), days = last ? Math.floor((new Date(t) - new Date(last)) / 86400000) : null;
      var remain = c.total - c.done - c.reject, rate = c.total ? c.done / c.total : 0;
      var score = c.total ? Math.round((remain / c.total) * 50 + Math.min(days === null ? 365 : days, 365) / 365 * 50) : 0;
      return { areaId: a.areaId, areaName: a.areaName, total: c.total, done: c.done, rate: rate, remaining: remain, revisit: c.revisit, reject: c.reject, caution: c.caution, lastDoneDate: last, daysSince: days, score: score, inUse: areaState_(a).inUse };
    }).sort(function (x, y) { return y.score - x.score; });
  }
};

// 古いスプレッドシートに、新しい列(区域の区分)の見出しを足す。1回だけ確認して、あとは何もしない
function migrate_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('migrated:v7')) return;
  ['area', 'group', 'room'].forEach(function (k) {
    var sh = sheet_(k), n = COLS[k].length, head = sh.getRange(1, 1, 1, n).getValues()[0];
    if (String(head[n - 1]) !== COLS[k][n - 1]) {
      sh.getRange(1, 1, 1, n).setValues([COLS[k]]);
      try { sh.getRange(1, n, Math.max(sh.getMaxRows(), 2), 1).setNumberFormat('@'); } catch (e) {}
    }
  });
  cache.put('migrated:v7', '1', 21600);
}

// ============================== 入口 ==============================
function route_(b) {
  var a = String(b.action || '');
  if (a === 'getPublicInfo') return getPublicInfo_();
  if (a === 'login') return withLock_(function () { return login_(b.loginId, b.password); });
  var user = requireAuth_(b.token);
  if (a === 'logout') return logout_(b.token);
  if (a === 'getBootstrap') return getBootstrap_(user);
  if (a === 'getAreaData') return getAreaData_(user, b.areaId);
  if (a === 'sync') return withLock_(function () { return sync_(user, b.ops || []); });
  if (a === 'createReport') return withLock_(function () { return createReport_(user, b); });
  if (a === 'changeMyPassword') return withLock_(function () { return changeMyPassword_(user, b); });
  if (a === 'downloadAreaFile') return downloadAreaFile_(b.areaId, b.fileType);
  var fn = ADMIN_[a];
  if (!fn) throw new Error('不明な操作です: ' + a);
  if (user.role !== 'admin') throw new Error('管理者のみ実行できます。');
  return /^(get|export)/.test(a) ? fn(user, b) : withLock_(function () { return fn(user, b); });
}
function doPost(e) {
  var res;
  try { res = { ok: true, data: route_(JSON.parse((e && e.postData && e.postData.contents) || '{}')) }; }
  catch (err) { res = { ok: false, error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return ContentService.createTextOutput('佐渡住宅GAS API: 動作中'); }

// ============================== 初期設定(スプレッドシートのメニュー) ==============================
function onOpen() {
  try { SpreadsheetApp.getUi().createMenu('訪問管理').addItem('初期設定を行う', 'runInitialSetup').addItem('管理者を追加する', 'addAdminFromMenu').addItem('毎日の自動チェックを設定する', 'installTrigger').addToUi(); } catch (e) {}
}
function ensureSheets_() {
  var ss = ss_(), created = [];
  Object.keys(SHEETNAME).forEach(function (k) {
    var sh = ss.getSheetByName(SHEETNAME[k]);
    if (!sh) { sh = ss.insertSheet(SHEETNAME[k]); created.push(SHEETNAME[k]); }
    if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, COLS[k].length).setValues([COLS[k]]); sh.setFrozenRows(1); }
    (TEXT_COLS[k] || []).forEach(function (c) { try { sh.getRange(1, COLS[k].indexOf(c) + 1, Math.max(sh.getMaxRows(), 2), 1).setNumberFormat('@'); } catch (e) {} });
  });
  ['シート1', 'Sheet1'].forEach(function (n) { var sh = ss.getSheetByName(n); if (sh && ss.getSheets().length > 1 && sh.getLastRow() === 0) ss.deleteSheet(sh); });
  var have = {}; readAll_('setting').forEach(function (r) { have[String(r.key)] = true; });
  var add = []; Object.keys(DEFAULTS).forEach(function (k) { if (!have[k]) add.push({ key: k, value: DEFAULTS[k] }); });
  appendObjs_('setting', add);
  return created;
}
function createAdmin_(loginId, password, displayName) {
  validatePw_(password);
  if (readWhere_('user', 'loginId', loginId).length) throw new Error('そのIDはすでにあります。');
  appendObjs_('user', [{ loginId: loginId, passwordHash: makeHash_(password), role: 'admin', active: true, displayName: displayName || loginId, groupId: '', failCount: 0, lockedUntil: '' }]);
}
function runInitialSetup() {
  var created = ensureSheets_(), ui = SpreadsheetApp.getUi();
  ui.alert('初期設定', created.length ? '次のシートを作りました:\n' + created.join('\n') + '\n\n続けて「管理者を追加する」を実行してください。' : 'シートはすでにそろっています。', ui.ButtonSet.OK);
}
function addAdminFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var id = ui.prompt('管理者のID(半角英数字)').getResponseText().trim();
  var pw = ui.prompt('パスワード(6文字以上)').getResponseText();
  var nm = ui.prompt('表示名').getResponseText().trim();
  createAdmin_(id, pw, nm);
  ui.alert('管理者「' + id + '」を追加しました。');
}
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyMaintenance') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(3).create();
  try { SpreadsheetApp.getUi().alert('毎日午前3時ごろに、期限が来た区域の自動終了を確認するよう設定しました。'); } catch (e) {}
}
