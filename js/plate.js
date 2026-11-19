/* トップの「ライブ計算」の帯。板の上を熱源が動き、温まって、冷えて反る様子をその場で計算して立体で描く。
   温度 : 動く熱源による2次元の熱伝導（陽解法の差分）
   反り : 高温になった所に縮み（曲げの固有ひずみ）が残ると考え、四辺を単純支持した薄板のたわみ w を
          ∇²w = -m で解く（辺がまっすぐな単純支持の板では、熱による曲げはこの式に帰着する）
   研究室の解析コードそのものではない簡易デモ。動きを変えるときは PARAM の値だけを変える。 */
(function () {
  'use strict';
  var cv = document.getElementById('plate');
  if (!cv || !cv.getContext) return;
  document.documentElement.classList.add('js-lsim');   // 計算できる環境でだけ帯を出す
  var host = cv.parentNode, ctx = cv.getContext('2d');

  var PARAM = {
    nx: 56, ny: 30,  // 格子の数
    r: 0.12,         // 拡散数 α·Δt/Δx²。0.25 を超えると計算が発散する
    sub: 2,          // 1回の描画で進める計算ステップ数（描画は毎秒30回）
    heat: 0.12,      // 入熱の強さ
    radius: 1.7,     // 熱源の半径（格子の数）
    cool: 0.008,     // 板の表面から逃げる熱
    speed: 0.12,     // 熱源の速さ（格子/ステップ）
    tcrit: 0.45,     // この温度を超えた分だけ縮みが残る
    shrink: 0.05,    // 冷えた後に残る曲げの強さ
    expand: 0.02,    // 熱い間の、逆向きの曲げの強さ
    relax: 8,        // たわみの式を解く反復の回数（1ステップあたり）
    zoom: 0.6        // 反りの表示倍率
  };

  var nx = PARAM.nx, ny = PARAM.ny, n = nx * ny;
  var T = new Float32Array(n), T2 = new Float32Array(n), peak = new Float32Array(n), w = new Float32Array(n);
  var LINES = [0.5, 0.24, 0.76];   // 溶接線の位置（板の幅に対する割合）。この順に溶接する
  var src = { x: 3, y: ny * LINES[0] }, pass = 0, dir = 1, step = 0, rest = 0, sparks = [];
  var yaw = -0.5, pitch = 1.0, yawTo = -0.5, pitchTo = 1.0, W = 0, H = 0, dpr = 1, running = true;
  var PX = new Float32Array(n), PY = new Float32Array(n);

  // 色: 地の紺 → 青 → 水色 → 緑 → 黄 → 橙 → 赤 → 白
  var STOPS = [[0, 14, 40, 96], [0.08, 20, 70, 170], [0.22, 21, 110, 255], [0.4, 25, 211, 255], [0.54, 53, 227, 107],
               [0.68, 255, 233, 59], [0.82, 255, 122, 26], [0.93, 255, 42, 26], [1, 255, 255, 255]];
  var COL = [];
  for (var li = 0, ls = 0; li < 256; li++) {
    var lt = li / 255;
    while (ls < STOPS.length - 2 && lt > STOPS[ls + 1][0]) ls++;
    var la = STOPS[ls], lb = STOPS[ls + 1], lf = (lt - la[0]) / (lb[0] - la[0]);
    COL.push('rgb(' + ((la[1] + (lb[1] - la[1]) * lf) | 0) + ',' + ((la[2] + (lb[2] - la[2]) * lf) | 0) + ',' + ((la[3] + (lb[3] - la[3]) * lf) | 0) + ')');
  }

  var elStep = document.getElementById('plate-step'), elPass = document.getElementById('plate-pass'), elDef = document.getElementById('plate-def');
  var hudAt = -1e9;   // 数字を書き換えた時刻（書き換えは毎秒4回まで）
  function calm() { return !!(window.shibaMotion && window.shibaMotion.calm()); }

  function reset() {
    for (var k = 0; k < n; k++) { T[k] = 0; peak[k] = 0; w[k] = 0; }
    pass = 0; dir = 1; rest = 0; src.x = 3; src.y = ny * LINES[0];
  }

  // 熱源を進める。3本を溶接し終えたら、冷えて反るのを待ってから最初に戻る
  function moveSource() {
    if (rest > 0) { if (--rest === 0) reset(); return false; }
    src.x += PARAM.speed * dir;
    src.y = ny * LINES[pass];
    if (src.x > nx - 4 || src.x < 3) {
      if (pass === LINES.length - 1) { rest = 420; return false; }
      pass++; dir = -dir;
    }
    return true;
  }

  function solve() {
    var on = moveSource(), r = PARAM.r, keep = 1 - PARAM.cool, i, j, k, c;
    // 温度（陽解法。端は断熱）
    for (j = 0; j < ny; j++) {
      var up = j > 0 ? -nx : 0, dn = j < ny - 1 ? nx : 0;
      for (i = 0; i < nx; i++) {
        k = j * nx + i; c = T[k];
        var l = i > 0 ? T[k - 1] : c, rt = i < nx - 1 ? T[k + 1] : c;
        T2[k] = (c + r * (l + rt + T[k + up] + T[k + dn] - 4 * c)) * keep;
      }
    }
    if (on) {
      var R = PARAM.radius, R3 = Math.ceil(R * 3), cx = Math.round(src.x), cy = Math.round(src.y);
      for (j = Math.max(0, cy - R3); j <= Math.min(ny - 1, cy + R3); j++) {
        for (i = Math.max(0, cx - R3); i <= Math.min(nx - 1, cx + R3); i++) {
          var d2 = (i - src.x) * (i - src.x) + (j - src.y) * (j - src.y);
          k = j * nx + i;
          T2[k] = Math.min(1.25, T2[k] + PARAM.heat * Math.exp(-d2 / (2 * R * R)));
        }
      }
    }
    var tmp = T; T = T2; T2 = tmp;
    for (k = 0; k < n; k++) if (T[k] > peak[k]) peak[k] = T[k];
    // たわみ（∇²w = -m を、前の答えから少しずつ解き進める。四辺は w = 0）
    var a = PARAM.shrink, b = PARAM.expand, tc = PARAM.tcrit, om = 1.7;
    for (var it = 0; it < PARAM.relax; it++) {
      for (j = 1; j < ny - 1; j++) {
        for (i = 1; i < nx - 1; i++) {
          k = j * nx + i;
          var m = b * T[k] - a * Math.max(0, peak[k] - tc);
          w[k] += om * ((w[k - 1] + w[k + 1] + w[k - nx] + w[k + nx] + m) * 0.25 - w[k]);
        }
      }
    }
    step++;
  }

  function resize() {
    var r = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = cv.width = Math.max(1, Math.round(r.width * dpr));
    H = cv.height = Math.max(1, Math.round(r.height * dpr));
  }

  // 板の上の点（格子の位置 i, j と高さ z）を画面の位置 qx, qy に写す
  var cyw = 1, syw = 0, cp = 1, sp = 0, S = 1, CX = 0, CY = 0, ZS = 1, qx = 0, qy = 0;
  function proj(i, j, z) {
    var X = i - (nx - 1) / 2, Y = j - (ny - 1) / 2;
    var x1 = X * cyw - Y * syw, y1 = X * syw + Y * cyw;
    var k = S * (1 + (y1 * sp + z * cp) * 0.006);
    qx = CX + x1 * k; qy = CY + (y1 * cp - z * sp) * k;
  }

  function draw() {
    var wide = W > 700 * dpr, i, j, k;
    yaw += (yawTo - yaw) * 0.1; pitch += (pitchTo - pitch) * 0.1;
    cyw = Math.cos(yaw); syw = Math.sin(yaw); cp = Math.cos(pitch); sp = Math.sin(pitch);
    S = Math.min(W / 70, H / (wide ? 46 : 60));
    CX = W * (wide ? 0.6 : 0.5); CY = H * (wide ? 0.57 : 0.45); ZS = 2.5 * PARAM.zoom;
    ctx.clearRect(0, 0, W, H);
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) { k = j * nx + i; proj(i, j, w[k] * ZS); PX[k] = qx; PY[k] = qy; }

    // 板の面。奥の升目から手前へ塗る
    var near = syw > 0, i0 = near ? 0 : nx - 2, i1 = near ? nx - 1 : -1, di = near ? 1 : -1;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(170,215,255,.22)';
    for (j = 0; j < ny - 1; j++) {
      for (i = i0; i !== i1; i += di) {
        k = j * nx + i;
        var t = (T[k] + T[k + 1] + T[k + nx] + T[k + nx + 1]) * 51;   // 4点の平均 × 204（温度の上限 1.25 が白）
        ctx.fillStyle = COL[t > 255 ? 255 : t | 0];
        ctx.beginPath(); ctx.moveTo(PX[k], PY[k]); ctx.lineTo(PX[k + 1], PY[k + 1]);
        ctx.lineTo(PX[k + nx + 1], PY[k + nx + 1]); ctx.lineTo(PX[k + nx], PY[k + nx]); ctx.closePath();
        ctx.fill(); ctx.stroke();
        var sh = (w[k + nx] + w[k + nx + 1] - w[k] - w[k + 1]) * ZS * 0.9;   // 面の傾きで明暗を付ける
        if (sh > 0.03) { ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.5, sh).toFixed(2) + ')'; ctx.fill(); }
        else if (sh < -0.03) { ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.24, -sh * 0.8).toFixed(2) + ')'; ctx.fill(); }
      }
    }

    // 板の厚み（手前と横の面）
    var th = 1.4 * sp * S, ie = near ? nx - 1 : 0, kb = (ny - 1) * nx;
    ctx.fillStyle = '#0a1c46'; ctx.strokeStyle = 'rgba(170,215,255,.5)';
    ctx.beginPath(); ctx.moveTo(PX[kb], PY[kb]);
    for (i = 1; i < nx; i++) ctx.lineTo(PX[kb + i], PY[kb + i]);
    ctx.lineTo(PX[kb + nx - 1], PY[kb + nx - 1] + th); ctx.lineTo(PX[kb], PY[kb] + th); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PX[ie], PY[ie]);
    for (j = 1; j < ny; j++) ctx.lineTo(PX[j * nx + ie], PY[j * nx + ie]);
    ctx.lineTo(PX[kb + ie], PY[kb + ie] + th); ctx.lineTo(PX[ie], PY[ie] + th); ctx.closePath(); ctx.fill(); ctx.stroke();

    // 溶接ビード（熱い所は橙、冷えた所は鋼の色）
    ctx.lineCap = 'round'; ctx.lineWidth = 2.4 * dpr;
    for (var p = 0; p <= pass; p++) {
      var jl = Math.round(ny * LINES[p]), fwd = p % 2 === 0, xa = fwd ? 3 : nx - 4;
      var xb = (p < pass || rest > 0) ? (fwd ? nx - 4 : 3) : src.x;
      for (i = Math.ceil(Math.min(xa, xb)); i < Math.floor(Math.max(xa, xb)); i++) {
        k = jl * nx + i;
        var h = Math.min(1, T[k] * 1.1);
        ctx.strokeStyle = 'rgb(' + ((150 + 105 * h) | 0) + ',' + ((178 + 40 * h) | 0) + ',' + ((215 - 110 * h) | 0) + ')';
        ctx.beginPath(); ctx.moveTo(PX[k], PY[k]); ctx.lineTo(PX[k + 1], PY[k + 1]); ctx.stroke();
      }
    }

    // 熱源の光とトーチ、火花
    if (rest === 0) {
      var kc = Math.round(src.y) * nx + Math.round(src.x);
      proj(src.x, src.y, w[kc] * ZS); var ax = qx, ay = qy;
      proj(src.x, src.y, w[kc] * ZS + 7); var bx = qx, by = qy;
      var gr = S * 5, g = ctx.createRadialGradient(ax, ay, 0, ax, ay, gr);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.25, 'rgba(255,220,150,.5)'); g.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.fillRect(ax - gr, ay - gr, gr * 2, gr * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(205,228,255,.9)'; ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); ctx.moveTo(ax + (bx - ax) * 0.22, ay + (by - ay) * 0.22); ctx.lineTo(bx, by); ctx.stroke();
      for (var m = 0; m < 2; m++) {
        var an = Math.random() * 6.283, v = (1 + Math.random() * 3.5) * dpr;
        sparks.push({ x: ax, y: ay, vx: Math.cos(an) * v, vy: Math.sin(an) * v * 0.6 - 2 * dpr, life: 1 });
      }
    }
    ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.2 * dpr;
    for (var s = sparks.length - 1; s >= 0; s--) {
      var q = sparks[s];
      q.vy += 0.14 * dpr; q.x += q.vx; q.y += q.vy; q.life -= 0.035;
      if (q.life <= 0) { sparks.splice(s, 1); continue; }
      ctx.strokeStyle = 'rgba(255,' + ((150 + 90 * q.life) | 0) + ',70,' + q.life.toFixed(2) + ')';
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 2.5, q.y - q.vy * 2.5); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    var hn = performance.now();
    if (hn - hudAt >= 250) {
      hudAt = hn;
      var mx = 0;
      for (k = 0; k < n; k++) { var aw = w[k] < 0 ? -w[k] : w[k]; if (aw > mx) mx = aw; }
      if (elStep) elStep.textContent = step;
      if (elPass) elPass.textContent = rest > 0 ? '冷却中' : (pass + 1) + ' / ' + LINES.length;
      if (elDef) elDef.textContent = mx.toFixed(2);
    }
  }

  // 描画は毎秒30回まで。画面の速さ（60・120コマ/秒）によらず、経過時間に合わせて計算を進める
  var raf = 0, lastDraw = 0, busy = false;   // busy: 止めているときに、冷えた状態を計算している途中
  function wake() { if (!raf && !busy && running && !document.hidden && !calm()) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (!running || document.hidden || calm()) return;
    if (now - lastDraw >= 32) {
      var k = lastDraw ? Math.min(3, Math.max(1, Math.round((now - lastDraw) / 33.3))) : 1;
      for (var s = 0; s < PARAM.sub * k; s++) solve();
      draw();
      lastDraw = now;
    }
    raf = requestAnimationFrame(frame);
  }

  // マウスを乗せると視点が動く（指での操作ではスクロールの邪魔をしない）
  host.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    var r = cv.getBoundingClientRect();
    yawTo = -0.5 + ((e.clientX - r.left) / r.width - 0.5) * 0.6;
    pitchTo = 1.0 + ((e.clientY - r.top) / r.height - 0.5) * 0.2;
  });
  host.addEventListener('pointerleave', function () { yawTo = -0.5; pitchTo = 1.0; });
  window.addEventListener('resize', function () { resize(); if (!busy) draw(); });   // 大きさを変えると canvas が空になるので、すぐ描き直す

  resize();
  if (calm()) {
    // 動きを止めているときは、溶接が終わって冷えた状態を1枚だけ描く。一度に計算すると画面が固まるので、板が画面に近づいてから少しずつ進める
    var left = 4000;
    var finished = function () { return left <= 0 || (rest > 0 && rest < 150); };
    var chunk = function () {
      busy = true;
      for (var c = 0; c < 30 && !finished(); c++, left--) solve();
      if (finished()) { busy = false; hudAt = -1e9; draw(); wake(); } else setTimeout(chunk, 0);
    };
    draw();
    if ('IntersectionObserver' in window) {
      var near = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { near.disconnect(); chunk(); } }, { rootMargin: '300px' });
      near.observe(cv);
    } else chunk();
  } else {
    for (var w0 = 0; w0 < 150; w0++) solve();   // 開いた瞬間から熱の跡が見えるように、先に進めておく
    draw();
  }
  // 画面の外にあるとき、裏のタブ、動きを止めている間は計算しない（電池の節約）
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { running = es[0].isIntersecting; wake(); }).observe(cv);
  document.addEventListener('visibilitychange', wake);
  document.addEventListener('shiba:motion', function () { if (!busy) { hudAt = -1e9; draw(); } wake(); });
  wake();
})();
