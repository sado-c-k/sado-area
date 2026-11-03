/* 地図の回転・コンパス・現在地ボタン(旧GAS=佐渡アパートGASの MapRotation を移したもの) */
(function () {
  'use strict';
  var SADO = window.SADO;
    SADO.MapRot = (function () {
      var map = null;
      function editOn() { return !!(SADO.S && SADO.S.edit); }
      function followOn() { try { return !!(SADO.loc && SADO.loc.isFollow()); } catch (e) { return false; } }
      function getMapNow() { map = SADO.getMap ? SADO.getMap() : null; return map; }
      let supported = false;
      let sign = 1;            /* bearing を +方向にしたとき、北が画面の左に回るなら +1 */
      let following = false;   /* 端末の向きに合わせて回転中か */
      let curHeading = null;   /* なめらかにした向き（度） */
      let lastApplyAt = 0;
      let sensorTimer = null;
      let gotSensor = false;
      let btn = null;
      let needle = null;
      let listening = false;

      /** 地図の案内は、上のバー（検索・コンパスなど）と重ならないよう、画面の中ほどに短く出す */
      let hintTimer = null;
      function showHint(text, type, duration) {
        let el = document.getElementById('mapHint');
        if (!el) {
          el = document.createElement('div');
          el.id = 'mapHint';
          el.className = 'map-hint';
          el.setAttribute('role', 'status');
          document.body.appendChild(el);
        }
        el.textContent = text;
        el.classList.add('show');
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = setTimeout(function() { el.classList.remove('show'); }, duration || 3500);
      }

      function norm(d) { return ((d % 360) + 360) % 360; }
      function bearingNow() { try { return (map && typeof map.getBearing === 'function') ? Number(map.getBearing()) || 0 : 0; } catch (e) { return 0; } }

      function calibrate() {
        /* 自前の回転部品は、向きの符号（bearing を＋にすると北が画面の左へ回る＝1）を自分で持っている */
        if (map && typeof map.rotateSign === 'number') { sign = map.rotateSign >= 0 ? 1 : -1; return; }
        /* bearing を 90 にしたとき、北が画面のどちら側に来るかを実測して、向きの符号をそろえる */
        try {
          const c = map.getCenter();
          map.setBearing(90);
          const p0 = map.latLngToContainerPoint(c);
          const p1 = map.latLngToContainerPoint([c.lat + 0.001, c.lng]);
          sign = (p1.x - p0.x) < 0 ? 1 : -1;
        } catch (e) { sign = 1; }
        try { map.setBearing(0); } catch (e) {}
      }

      function isRotated() { return Math.abs(norm(bearingNow() + 180) - 180) > 1; }

      let enabled = true;
      function setEnabled(v) {
        enabled = v !== false;
        if (!enabled) { try { if (following) stopFollow(); if (map && typeof map.setBearing === 'function' && Math.abs(bearingNow()) > 0.01) map.setBearing(0); } catch (e) {} }
        try { updateUi(); } catch (e) {}
      }
      function updateUi() {
        if (!btn) return;
        if (needle) needle.style.transform = 'rotate(' + (-sign * bearingNow()).toFixed(1) + 'deg)';
        btn.classList.toggle('gps-active', following);
        /* 現在地が地図の中心でないとき：「現在地へ移動」マーク／中心にしているとき：コンパス */
        let centered = false;
        try { centered = !!followOn(); } catch (e) {}
        /* 【地図の回転】管理者がオフにしているときは、いつも「現在地へ移動」のマークのまま（コンパスにはならない） */
        const rotOff = !enabled;
        const locateMode = rotOff || (!centered && !following);
        btn.classList.toggle('is-locate', locateMode);
        btn.disabled = !!editOn() && !locateMode;
        updateNorthBtn();
        btn.title = locateMode ? '現在地へ移動' : ((following || isRotated()) ? '押すと北を上に戻します' : '押すと端末の向きに合わせて地図が回ります');
      }

      /* 【北を上に戻す】現在地が中心でなく、手動で回転しているときだけ、現在地ボタンの下に表示 */
      let northBtn = null;
      let northNeedle = null;
      function placeNorthBtn() {
        if (!northBtn || !btn) return;
        const r = btn.getBoundingClientRect();
        if (!r.width) { northBtn.classList.remove('show'); return; }
        northBtn.style.width = r.width + 'px';
        northBtn.style.height = r.height + 'px';
        if (false) {
          /* テーマ２：右下のボタン群の、いちばん上のボタンのさらに上に置く */
          var grid = null;
          var topMost = null;
          if (grid) {
            Array.prototype.forEach.call(grid.children, function(el) {
              if (el === northBtn || !el.offsetWidth) return;
              var er = el.getBoundingClientRect();
              if (!topMost || er.top < topMost.top) topMost = er;
            });
          }
          if (topMost) {
            northBtn.style.left = (topMost.right - r.width) + 'px';
            northBtn.style.top = (topMost.top - r.height - 10) + 'px';
            return;
          }
        }
        northBtn.style.left = r.left + 'px';
        northBtn.style.top = (r.bottom + 8) + 'px';
      }
      function updateNorthBtn() {
        if (!northBtn) return;
        let centered = false;
        try { centered = !!followOn(); } catch (e) {}
        const show = supported && !centered && !following && !editOn() && isRotated();
        if (northNeedle) northNeedle.style.transform = 'rotate(' + (-sign * bearingNow()).toFixed(1) + 'deg)';
        if (show) placeNorthBtn();
        northBtn.classList.toggle('show', !!show);
      }
      function initNorthBtn() {
        if (!btn || northBtn) return;
        northBtn = document.createElement('button');
        northBtn.type = 'button';
        northBtn.id = 'northBtn';
        northBtn.className = 'icon-btn gps-text-btn compass-btn north-btn';
        northBtn.title = '北を上に戻す';
        northBtn.setAttribute('aria-label', '北を上に戻す');
        northBtn.innerHTML = '<svg class="ico-compass" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.8"/><g class="compass-needle"><path d="M16 4 L21 16 L11 16 Z" fill="#dc2626"/><path d="M16 28 L21 16 L11 16 Z" fill="currentColor" fill-opacity="0.55"/><circle cx="16" cy="16" r="1.6" fill="#ffffff"/></g></svg>';
        northNeedle = northBtn.querySelector('.compass-needle');
        northBtn.addEventListener('click', function() {
          if (!supported || editOn()) return;
          setBearingSafe(0);   /* 北を上に戻す（現在地は動かさない） */
          updateUi();
        });
        document.body.appendChild(northBtn);
        window.addEventListener('resize', function() { if (northBtn.classList.contains('show')) placeNorthBtn(); });
        window.addEventListener('orientationchange', function() { setTimeout(updateNorthBtn, 300); });
        document.addEventListener('uithemechange', function() { if (northBtn) northBtn.classList.remove('show'); [150, 500, 1200].forEach(function(t) { setTimeout(updateNorthBtn, t); }); });
      }

      let origSetBearing = null;   /* 部品本来の setBearing（2本指の最中に、部品が勝手に回すのを止めるため差し替える） */
      let internalSet = false;

      function setBearingSafe(b) {
        try {
          if (!supported) return;
          internalSet = true;
          (origSetBearing || map.setBearing.bind(map))(norm(b));
        } catch (e) {} finally { internalSet = false; }
      }

      function onOrientation(e) {
        let h = null;
        if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
          h = e.webkitCompassHeading;                       /* iPhone：北から時計回りの向き */
        } else if (e.alpha != null && (e.absolute === true || e.type === 'deviceorientationabsolute')) {
          h = 360 - e.alpha;                                /* Android：alpha は北から反時計回り */
        }
        if (h == null) return;
        const ang = (window.screen && screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : 0;
        h = norm(h + ang);
        gotSensor = true;
        if (!following || editOn()) return;
        if (curHeading == null) curHeading = h;
        const diff = ((h - curHeading + 540) % 360) - 180;
        curHeading = norm(curHeading + diff * 0.25);          /* なめらかにする */
        const now = Date.now();
        if (now - lastApplyAt < 80 || Math.abs(diff) < 1.5) return;
        lastApplyAt = now;
        setBearingSafe(sign * curHeading);
      }

      function listen(on) {
        if (on && !listening) {
          window.addEventListener('deviceorientationabsolute', onOrientation, true);
          window.addEventListener('deviceorientation', onOrientation, true);
          listening = true;
        } else if (!on && listening) {
          window.removeEventListener('deviceorientationabsolute', onOrientation, true);
          window.removeEventListener('deviceorientation', onOrientation, true);
          listening = false;
        }
      }

      function stopFollow() {
        following = false;
        curHeading = null;
        gotSensor = false;
        if (sensorTimer) { clearTimeout(sensorTimer); sensorTimer = null; }
        listen(false);
        updateUi();
      }

      async function startFollow() {
        if (editOn()) return;
        try {
          if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const r = await DeviceOrientationEvent.requestPermission();   /* iPhone：許可の確認が出る */
            if (r !== 'granted') { showHint('方位センサーの使用が許可されませんでした。', 'error', 4000); return; }
          }
        } catch (e) {
          showHint('方位センサーを使えませんでした。', 'error', 4000);
          return;
        }
        following = true;
        curHeading = null;
        gotSensor = false;
        listen(true);
        updateUi();
        if (sensorTimer) clearTimeout(sensorTimer);
        sensorTimer = setTimeout(function() {
          if (!gotSensor) {
            stopFollow();
            showHint('この端末・ブラウザでは、方位センサーを使えません。2本指で地図をひねると回転できます。', 'error', 5000);
          }
        }, 2500);
      }

      /* ---- 2本指の回転（拡大・縮小のときに、間違えて回らないように「余裕」を持たせる） ---- */
      const ROTATE_START_DEG = 15;   /* 指のひねりがこの角度を超えるまでは回転しない（大きいほど回りにくい） */
      let gesture = null;

      function touchAngle(touches) {
        return Math.atan2(touches[1].clientY - touches[0].clientY, touches[1].clientX - touches[0].clientX) * 180 / Math.PI;
      }

      function onTouchStart(e) {
        if (supported && enabled && !editOn() && !following && e.touches && e.touches.length === 2) {
          const a = touchAngle(e.touches);
          gesture = { prev: a, total: 0, started: false, offset: 0, startBearing: bearingNow() };
        } else {
          gesture = null;
        }
      }

      function onTouchMove(e) {
        if (!gesture || !e.touches || e.touches.length !== 2) return;
        const a = touchAngle(e.touches);
        gesture.total += ((a - gesture.prev + 540) % 360) - 180;   /* 角度の飛び（180°をまたぐ）を直して積み上げる */
        gesture.prev = a;
        if (!gesture.started) {
          if (Math.abs(gesture.total) < ROTATE_START_DEG) return;  /* 余裕の範囲内：回さない */
          gesture.started = true;
          gesture.offset = gesture.total > 0 ? ROTATE_START_DEG : -ROTATE_START_DEG;  /* 回り始めで急に動かないように */
        }
        applyGestureBearing_();
      }

      /** 部品が自分で回転させてしまっても、こちらの計算した向きに必ず上書きする（部品の処理のあとに実行） */
      function applyGestureBearing_() {
        if (!gesture) return;
        const g = gesture;
        const target = g.started ? (g.startBearing - sign * (g.total - g.offset)) : g.startBearing;
        const fix = function() {
          if (gesture !== g) return;
          if (Math.abs(norm(bearingNow() - target + 180) - 180) > 0.05) setBearingSafe(target);
        };
        fix();
        requestAnimationFrame(fix);
        setTimeout(fix, 0);
      }

      function onTouchEnd(e) {
        if (!e.touches || e.touches.length < 2) gesture = null;
      }

      function onCompassClick() {
        /* 現在地が中心でないとき：現在地へ移動（これまでの◎と同じ） */
        if (btn && btn.classList.contains('is-locate')) {
          try { SADO.loc.toggle(); } catch (e) {}
          updateUi();
          return;
        }
        if (editOn() || !enabled) return;
        if (!supported) { showHint('この端末では地図を回転できません。', 'error', 3500); return; }
        if (following || isRotated()) {
          stopFollow();
          setBearingSafe(0);                                 /* 北を上に戻す */
          updateUi();
        } else if (followOn()) {
          startFollow();                                     /* ◎で現在地を中心にしているときだけ、方位センサーをオン */
        } else {
          showHint('先に現在地を地図の中心にしてください。', 'info', 3500);
        }
      }

      /** ◎（現在地を中心にする）が外れたら、端末の向きに合わせた回転も止める（地図の向きはそのまま） */
      function onGpsFollowChanged(on) {
        if (!on && following) stopFollow();
        updateUi();
      }

      function init() {
        getMapNow(); btn = document.getElementById('locBtn');
        needle = btn ? btn.querySelector('.ico-compass .compass-needle') : null;
        if (btn) btn.addEventListener('click', onCompassClick);
        initNorthBtn();
        supported = !!(map && typeof map.setBearing === 'function' && typeof map.getBearing === 'function');
        if (!supported) return;
        calibrate();
        try {
          /* 2本指で触っている間は、部品が呼ぶ setBearing を無視する（こちらの処理だけが向きを変えられる） */
          origSetBearing = map.setBearing.bind(map);
          map.setBearing = function(b) {
            if (gesture && !internalSet) return map;
            return origSetBearing(b);
          };
          /* 念のため、向きが変わったらすぐ、こちらの計算した向きに戻す */
          map.on('rotate', function() { if (gesture && !internalSet) applyGestureBearing_(); });
        } catch (e) { console.warn('[rotate] patch failed', e); }
        try {
          /* 部品の標準の回転は止める（念のため、いくつかの方法で） */
          if (map.options) map.options.touchRotate = false;
          if (map.touchRotate && typeof map.touchRotate.disable === 'function') map.touchRotate.disable();
        } catch (e) {}
        try {
          const el = map.getContainer();
          el.addEventListener('touchstart', onTouchStart, { passive: true });
          el.addEventListener('touchmove', onTouchMove, { passive: true });
          el.addEventListener('touchend', onTouchEnd, { passive: true });
          el.addEventListener('touchcancel', onTouchEnd, { passive: true });
        } catch (e) {}
        map.on('rotate', updateUi);
        updateUi();
      }

      /** 編集モードの出入りに合わせて、北固定と回転の許可を切り替える（updateTopUi から呼ばれる） */
      function syncEditLock() {
        if (!supported) return;
        try {
          if (editOn()) {
            if (following) stopFollow();
            if (Math.abs(bearingNow()) > 0.01) map.setBearing(0);
            if (map.touchRotate && map.touchRotate.disable) map.touchRotate.disable();
          } else if (map.touchRotate && map.touchRotate.enable) {
            map.touchRotate.enable();
          }
        } catch (e) {}
        updateUi();
      }

      return { init: init, setEnabled: setEnabled, syncEditLock: syncEditLock, onGpsFollowChanged: onGpsFollowChanged, isSupported: function() { return supported; } };
    })();
})();
