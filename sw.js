/* 佐渡住宅GAS: オフラインでも起動できるようにする(サービスワーカー)
   ・アプリ本体と地図ライブラリは、いったん端末に保存し、次回からは保存したものを先に出す(裏で最新版を取り直す)
   ・地図の画像(タイル)は、一度見たもの・「地図を端末に保存」したものを端末から出す
   ※ アプリを更新したら、下の VERSION の数字を上げると、全員の端末が新しい版に入れ替わる */
var VERSION = 'v56';
var SHELL = 'shell-' + VERSION, TILES = 'tiles-v1';
var FILES = ['./', 'index.html', 'style.css', 'config.js', 'app.js', 'maprot.js', 'lib/leaflet-rotate.js', 'admin.js', 'edit.js', 'manifest.json', 'lib/leaflet.js', 'lib/leaflet.css', 'lib/images/layers.png', 'lib/images/layers-2x.png', 'lib/images/marker-icon.png', 'data/areas.geojson'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    // 1つでも無いファイルがあっても、全体が失敗しないように1つずつ入れる
    return Promise.all(FILES.map(function (f) { return c.add(new Request(f, { cache: 'reload' }))['catch'](function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('shell-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (/(^|\.)(cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org)$/.test(url.hostname)) {
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (r) { try { c.put(req, r.clone()); } catch (x) {} return r; })['catch'](function () { return new Response('', { status: 504 }); });
      });
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;  // GASへの通信などは、そのまま通す
  e.respondWith(caches.open(SHELL).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (r) { if (r && r.ok) c.put(req, r.clone()); return r; })['catch'](function () { return hit; });
      return hit || net;
    });
  }));
});
