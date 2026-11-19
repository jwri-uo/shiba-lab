/* 下層ページの見出し帯の背景で動く「溶接の熱の広がり」の簡易デモ。
   動く熱源による2次元の熱伝導を、陽解法（差分法）でこの画面の中で計算している。
   研究室の解析コードそのものではない。動きを変えるときは PARAM の値だけを変える。 */
(function () {
  'use strict';
  var cv = document.getElementById('sim');
  if (!cv || !cv.getContext) return;
  var host = cv.parentNode;

  var PARAM = {
    cell: 6.5,     // 格子1個の大きさ（画面上のピクセル）
    r: 0.2,        // 拡散数 α·Δt/Δx²。0.25 を超えると計算が発散する
    sub: 3,        // 1コマに進める計算ステップ数
    heat: 0.5,     // 入熱の強さ
    radius: 2.4,   // 熱源の半径（格子の数）
    cool: 0.004,   // 板の表面から逃げる熱
    speed: 0.5     // 自動で動くときの熱源の速さ（格子/ステップ）
  };

  var box = host.getBoundingClientRect();
  var nx = Math.max(60, Math.min(220, Math.round(box.width / PARAM.cell)));
  var ny = Math.max(30, Math.min(90, Math.round(box.height / PARAM.cell)));
  var n = nx * ny, T = new Float32Array(n), T2 = new Float32Array(n);
  var src = { x: nx * 0.08, y: ny * 0.28 }, dir = 1, pass = 0, pointer = null, step = 0, sparks = [], running = true;

  // 色: 地の紺 → 青 → 水色 → 緑 → 黄 → 橙 → 赤 → 白
  var STOPS = [[0, 6, 19, 48], [0.06, 10, 38, 104], [0.22, 21, 96, 255], [0.4, 25, 211, 255], [0.54, 53, 227, 107],
               [0.68, 255, 233, 59], [0.82, 255, 122, 26], [0.93, 255, 42, 26], [1, 255, 255, 255]];
  var LUT = new Uint8ClampedArray(256 * 3);
  for (var li = 0, ls = 0; li < 256; li++) {
    var lt = li / 255;
    while (ls < STOPS.length - 2 && lt > STOPS[ls + 1][0]) ls++;
    var la = STOPS[ls], lb = STOPS[ls + 1], lf = (lt - la[0]) / (lb[0] - la[0]);
    for (var lc = 0; lc < 3; lc++) LUT[li * 3 + lc] = la[lc + 1] + (lb[lc + 1] - la[lc + 1]) * lf;
  }

  var buf = document.createElement('canvas'); buf.width = nx; buf.height = ny;
  var bctx = buf.getContext('2d'), img = bctx.createImageData(nx, ny), ctx = cv.getContext('2d');
  var W = 0, H = 0;
  var elStep = document.getElementById('sim-step'), elGrid = document.getElementById('sim-grid');
  var hudAt = -1e9;   // 数字を書き換えた時刻（書き換えは毎秒4回まで）
  function calm() { return !!(window.shibaMotion && window.shibaMotion.calm()); }
  if (elGrid) elGrid.textContent = nx + '×' + ny;

  function resize() {
    var r = host.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = cv.width = Math.max(1, Math.round(r.width * dpr));
    H = cv.height = Math.max(1, Math.round(r.height * dpr));
  }

  // 熱源を動かす。マウスが乗っていればそこへ、いなければ3本の溶接線を往復する
  function moveSource() {
    if (pointer) { src.x += (pointer.x - src.x) * 0.25; src.y += (pointer.y - src.y) * 0.25; return; }
    src.x += PARAM.speed * dir;
    src.y = ny * (0.28 + 0.22 * pass) + Math.sin(step * 0.05) * 1.2;
    if (src.x > nx * 0.94 || src.x < nx * 0.06) { dir = -dir; pass = (pass + 1) % 3; }
  }

  // 1ステップ進める（陽解法。端は断熱）
  function solve() {
    var r = PARAM.r, keep = 1 - PARAM.cool, i, j, k, c;
    for (j = 0; j < ny; j++) {
      var up = j > 0 ? -nx : 0, dn = j < ny - 1 ? nx : 0;
      for (i = 0; i < nx; i++) {
        k = j * nx + i; c = T[k];
        var l = i > 0 ? T[k - 1] : c, rt = i < nx - 1 ? T[k + 1] : c;
        T2[k] = (c + r * (l + rt + T[k + up] + T[k + dn] - 4 * c)) * keep;
      }
    }
    var R = PARAM.radius, R3 = Math.ceil(R * 3), cx = Math.round(src.x), cy = Math.round(src.y);
    for (j = Math.max(0, cy - R3); j <= Math.min(ny - 1, cy + R3); j++) {
      for (i = Math.max(0, cx - R3); i <= Math.min(nx - 1, cx + R3); i++) {
        var d2 = (i - src.x) * (i - src.x) + (j - src.y) * (j - src.y);
        k = j * nx + i;
        T2[k] = Math.min(1.25, T2[k] + PARAM.heat * Math.exp(-d2 / (2 * R * R)));
      }
    }
    var tmp = T; T = T2; T2 = tmp; step++;
  }

  // f: 前の描画から、60コマ/秒の何コマ分たったか（火花の動きを経過時間に合わせる）
  function draw(f) {
    f = f || 1;
    var d = img.data, k, p, v, damp = Math.pow(0.96, f);
    for (k = 0, p = 0; k < n; k++, p += 4) {
      v = T[k] * 204; v = v > 255 ? 255 : v | 0;   // 204 = 255 / 1.25。温度の上限（1.25）がちょうど白になる
      d[p] = LUT[v * 3]; d[p + 1] = LUT[v * 3 + 1]; d[p + 2] = LUT[v * 3 + 2]; d[p + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(buf, 0, 0, W, H);

    // メッシュ
    var sx = W / nx, sy = H / ny, i, j;
    ctx.strokeStyle = 'rgba(150,205,255,.09)'; ctx.lineWidth = 1; ctx.beginPath();
    for (i = 0; i <= nx; i += 6) { ctx.moveTo(i * sx + 0.5, 0); ctx.lineTo(i * sx + 0.5, H); }
    for (j = 0; j <= ny; j += 6) { ctx.moveTo(0, j * sy + 0.5); ctx.lineTo(W, j * sy + 0.5); }
    ctx.stroke();

    // 熱源の光と火花
    var px = src.x * sx, py = src.y * sy, gr = sy * 9;
    var g = ctx.createRadialGradient(px, py, 0, px, py, gr);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.25, 'rgba(255,220,150,.5)'); g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.fillRect(px - gr, py - gr, gr * 2, gr * 2);
    for (var s = sparks.length - 1; s >= 0; s--) {
      var q = sparks[s];
      q.x += q.vx * f; q.y += q.vy * f; q.vx *= damp; q.vy *= damp; q.life -= 0.03 * f;
      if (q.life <= 0) { sparks.splice(s, 1); continue; }
      ctx.strokeStyle = 'rgba(255,' + ((150 + 90 * q.life) | 0) + ',70,' + q.life.toFixed(2) + ')';
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 3, q.y - q.vy * 3); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (var m = 0; m < 3 * f; m++) {
      var a = Math.random() * 6.283, sp = (1 + Math.random() * 5) * sy * 0.35;
      sparks.push({ x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 });
    }
    var hn = performance.now();
    if (elStep && hn - hudAt >= 250) { hudAt = hn; elStep.textContent = step; }
  }

  // 描画は毎秒30回まで。計算は 1/60 秒ごとに PARAM.sub ステップ分を、経過時間に合わせて進める
  var raf = 0, lastDraw = 0;
  function wake() { if (!raf && running && !document.hidden && !calm()) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (!running || document.hidden || calm()) return;
    if (now - lastDraw >= 32) {
      var k = lastDraw ? Math.min(4, Math.max(1, Math.round((now - lastDraw) / 16.7))) : 2;
      for (var s = 0; s < PARAM.sub * k; s++) { moveSource(); solve(); }
      draw(k);
      lastDraw = now;
    }
    raf = requestAnimationFrame(frame);
  }

  host.addEventListener('pointermove', function (e) {
    var r = cv.getBoundingClientRect();
    pointer = { x: (e.clientX - r.left) / r.width * nx, y: (e.clientY - r.top) / r.height * ny };
  });
  host.addEventListener('pointerleave', function () { pointer = null; });
  window.addEventListener('resize', function () { resize(); draw(); });   // 大きさを変えると canvas が空になるので、すぐ描き直す

  resize();
  for (var w = 0; w < 260; w++) { moveSource(); solve(); }   // 開いた瞬間から熱の跡が見えるように、先に進めておく
  draw();
  // 画面の外にあるとき、裏のタブ、動きを止めている間は計算しない（電池の節約）
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { running = es[0].isIntersecting; wake(); }).observe(cv);
  document.addEventListener('visibilitychange', wake);
  document.addEventListener('shiba:motion', function () { hudAt = -1e9; draw(); wake(); });
  wake();
})();
