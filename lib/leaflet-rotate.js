/*
 * 地図の回転（自作）  — 訪問区域アプリ用
 * Leaflet 1.9.x 用の小さな拡張。2本指・コンパスなどの「操作」はアプリ側で行い、この部品は回転そのものだけを受け持つ。
 *
 * 作り方（他の回転部品のコードは使っていない。Leaflet 本体の公開された仕組みだけを使用）
 *  ・Leaflet 内部の計算は「回転していない地図」のまま変えない。
 *  ・地図の画像・ピン・図形が入っている箱（mapPane）を、1枚のラッパー（leaflet-rotator）で包み、ラッパーごとCSSで回す。
 *  ・画面の座標が内部に入ってくる入口だけ、回転を元に戻して渡す（クリック・ホイール・2本指の拡大・ドラッグ）。
 *  ・回転で空いてしまう四隅にも画像や図形が出るよう、読み込む範囲を広げる。
 *  ・ピン（マーカー）の絵は、いつも上向きに保つ（位置だけが回転に合わせて動く）。
 *
 * 使い方（Leaflet の Map の options）：rotate: true, bearing: 0
 *  map.setBearing(度) / map.getBearing() / 'rotate' イベント / map.rotateSign（＝-1）
 *  bearing は「地図を時計回りに回す角度」（前に使っていた回転の部品と同じ決まり）。bearing=90 のとき、地図は時計回りに90度回り、北は画面の右になる。
 *
 * ライセンス：MIT（このファイルの作者による）
 */
(function () {
  'use strict';
  if (!window.L || !L.Map || !L.Draggable || !L.GridLayer) return;

  var DEG = Math.PI / 180;

  function norm(d) { return ((d % 360) + 360) % 360; }

  /* ラッパー（leaflet-rotator）の見つけ方：要素から親をたどる */
  function findRotator(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (n._leafletRotator) return n;
      if (n.classList && n.classList.contains('leaflet-container')) return null;
    }
    return null;
  }

  /* ---------- 1. CSS（ラッパーの見た目） ---------- */
  (function addCss() {
    var css = '.leaflet-rotator{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:50% 50%;-webkit-transform-origin:50% 50%;}';
    var el = document.createElement('style');
    el.setAttribute('data-leaflet-rotate', '1');
    el.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(el);
  })();

  /* ---------- 2. ドラッグ：画面上の動きを、回転を戻した動きに直す ---------- */
  var origMove = L.Draggable.prototype._onMove;
  L.Draggable.prototype._onMove = function (e) {
    var rot = this._element && findRotator(this._element);
    if (!rot || !rot._bearing || !this._startPoint || e._simulated || (e.touches && e.touches.length > 1)) {
      return origMove.call(this, e);
    }
    var t = (e.touches && e.touches.length === 1) ? e.touches[0] : e;
    var dx = t.clientX - this._startPoint.x;
    var dy = t.clientY - this._startPoint.y;
    var th = rot._bearing * DEG, c = Math.cos(th), s = Math.sin(th);
    /* 画面での動き (dx,dy) を、回転していない地図での動きに戻す：u = M(θ)·d */
    var ux = c * dx - s * dy;
    var uy = s * dx + c * dy;
    var cx = this._startPoint.x + ux, cy = this._startPoint.y + uy;
    /* ラッパーが回っていると、ブラウザの報告する大きさが「拡大縮小」に見えてしまうので、拡大縮小はないものとして扱う */
    this._parentScale = { x: 1, y: 1 };
    var fake = {
      clientX: cx, clientY: cy, type: e.type, target: e.target, srcElement: e.srcElement,
      touches: e.touches ? [{ clientX: cx, clientY: cy }] : undefined,
      preventDefault: function () { if (e.preventDefault) e.preventDefault(); },
      stopPropagation: function () { if (e.stopPropagation) e.stopPropagation(); }
    };
    return origMove.call(this, fake);
  };

  /* ---------- 3. 画像（タイル）を読み込む範囲を、回転した画面が隠れない広さにする ---------- */
  var origTiledBounds = L.GridLayer.prototype._getTiledPixelBounds;
  L.GridLayer.prototype._getTiledPixelBounds = function (center) {
    var b = origTiledBounds.call(this, center);
    var m = this._map;
    if (!m || !m._bearing) return b;
    var th = m._bearing * DEG, ac = Math.abs(Math.cos(th)), as = Math.abs(Math.sin(th));
    var sz = b.getSize(), hw = sz.x / 2, hh = sz.y / 2, c = b.getCenter();
    var nw = ac * hw + as * hh, nh = as * hw + ac * hh;   /* 回転した長方形をすっぽり含む長方形の半分の大きさ */
    return L.bounds(L.point(c.x - nw, c.y - nh), L.point(c.x + nw, c.y + nh));
  };

  /* ---------- 4. ピンの絵を、いつも上向きに保つ ---------- */
  function uprightIcon(icon, bearing) {
    if (!icon) return;
    var ml = parseFloat(icon.style.marginLeft), mt = parseFloat(icon.style.marginTop);
    var ax = isFinite(ml) ? -ml : 0, ay = isFinite(mt) ? -mt : 0;
    var base = icon.style.transform || '';
    base = base.replace(/\s*rotate\([^)]*\)\s*$/, '');
    if (!bearing) {
      if (icon._leafletUpright) { icon.style.transform = base; icon._leafletUpright = false; }
      return;
    }
    icon.style.transformOrigin = ax + 'px ' + ay + 'px';
    icon.style.transform = base + ' rotate(' + bearing.toFixed(2) + 'deg)';
    icon._leafletUpright = true;
  }
  function currentBearingOfIcon(icon) {
    var rot = findRotator(icon);
    return rot ? rot._bearing || 0 : 0;
  }

  var origSetPos = L.Marker.prototype._setPos;
  L.Marker.prototype._setPos = function (pos) {
    origSetPos.call(this, pos);
    var m = this._map;
    if (m && m._bearing) { uprightIcon(this._icon, m._bearing); }
  };
  var origUpdatePosition = L.Draggable.prototype._updatePosition;
  L.Draggable.prototype._updatePosition = function () {
    origUpdatePosition.call(this);
    var el = this._element;
    if (el && el.classList && el.classList.contains('leaflet-marker-icon')) {
      var b = currentBearingOfIcon(el);
      if (b) uprightIcon(el, b);
    }
  };

  /* ---------- 5. 地図への取り付け ---------- */
  L.Map.addInitHook(function () {
    var map = this;
    if (!map.options.rotate) return;
    var container = map._container, pane = map._mapPane;
    if (!container || !pane || !pane.parentNode) return;

    /* ラッパーで mapPane を包む */
    var rot = L.DomUtil.create('div', 'leaflet-rotator');
    rot._leafletRotator = true;
    rot._bearing = 0;
    container.insertBefore(rot, pane);
    rot.appendChild(pane);
    map._rotator = rot;
    map._bearing = 0;
    map.rotateSign = -1;   /* 前に使っていた部品と同じ向きの決まり：bearing を＋にすると、地図は時計回りに回る（北が画面の右へ） */

    /* 図形（現在地の精度の円など）を描く面を、回転しても隠れない広さにする */
    try {
      var sz = map.getSize();
      var diag = Math.sqrt(sz.x * sz.x + sz.y * sz.y), mn = Math.max(1, Math.min(sz.x, sz.y));
      var pad = Math.min(1.5, Math.max(0.1, (diag / mn - 1) / 2 + 0.05));
      if (!map.options.renderer) map.options.renderer = L.svg({ padding: pad });
    } catch (e) {}

    /* 画面の座標が入ってくる入口：回転を元に戻す */
    var origMouse = map.mouseEventToContainerPoint;
    map.mouseEventToContainerPoint = function (e) {
      var p = origMouse.call(this, e);
      var b = this._bearing;
      if (!b) return p;
      var s = this.getSize(), cx = s.x / 2, cy = s.y / 2;
      var th = b * DEG, c = Math.cos(th), sn = Math.sin(th);
      var dx = p.x - cx, dy = p.y - cy;
      return L.point(cx + c * dx - sn * dy, cy + sn * dx + c * dy);
    };

    var updTimer = null;
    function updateTiles() {
      updTimer = null;
      map.eachLayer(function (l) {
        if (l instanceof L.GridLayer && l._map && typeof l._update === 'function') { try { l._update(); } catch (e) {} }
      });
    }
    var uprightRaf = null;
    function updateIcons() {
      uprightRaf = null;
      var b = map._bearing;
      map.eachLayer(function (l) {
        if (l instanceof L.Marker && l._icon) uprightIcon(l._icon, b);
      });
    }

    /* 回転の向きを設定／取得 */
    map.setBearing = function (b) {
      b = norm(-(Number(b) || 0));   /* 公開する向き（時計回りが＋）を、内部の向き（上に向く方位）に直す */
      if (b > 359.995) b = 0;
      if (b === this._bearing) return this;
      this._bearing = b;
      rot._bearing = b;
      var css = b ? 'rotate(' + (-b).toFixed(3) + 'deg)' : '';
      rot.style.transform = css;
      rot.style.webkitTransform = css;
      if (window.requestAnimationFrame) {
        if (!uprightRaf) uprightRaf = requestAnimationFrame(updateIcons);
      } else { updateIcons(); }
      if (updTimer) clearTimeout(updTimer);
      updTimer = setTimeout(updateTiles, 120);
      this.fire('rotate');
      return this;
    };
    map.getBearing = function () { return norm(-this._bearing); };

    /* 2本指などの回転は、アプリ側で処理する（互換のための空の窓口） */
    map.touchRotate = { enable: function () {}, disable: function () {}, enabled: function () { return false; } };

    /* 地図に追加されたピンも、回転中なら上向きにそろえる */
    map.on('layeradd', function (ev) {
      var l = ev.layer;
      if (map._bearing && l instanceof L.Marker && l._icon) uprightIcon(l._icon, map._bearing);
    });

    var b0 = Number(map.options.bearing) || 0;
    if (b0) map.setBearing(b0);
  });
})();
