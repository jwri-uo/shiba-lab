/* 線状加熱の体験。板の上に指やマウスで線を引くと、その線に沿ってバーナーが動いて板を加熱し、板が曲がる。
   計算は js/plate-model.js。ここは操作と描画だけ。 */
(function () {
  'use strict';
  var cv = document.getElementById('lh');
  if (!cv || !cv.getContext || !window.PlateModel) return;
  document.documentElement.classList.add('js-lh');   // 動く環境でだけ操作のボタンを出す
  var host = cv.parentNode, ctx = cv.getContext('2d');
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var VIEW = {
    nx: 48, ny: 28,  // 格子の数
    speed: 0.12,     // バーナーの速さ（格子/ステップ）
    sub: 4,          // 1回の描画で進める計算ステップ数（描画は毎秒30回）
    zoom: 1.6,       // 反りの表示倍率
    pass: 0.8        // お題を合格とする一致度
  };
  // お題。お手本の加熱線（side: 1 = 表から、-1 = 裏から）を同じ計算に通した結果を、目標の形にする
  var GOALS = {
    free: null,
    cyl: [{ pts: [[2, 7], [45, 7]], side: 1 }, { pts: [[45, 13.5], [2, 13.5]], side: 1 }, { pts: [[2, 20], [45, 20]], side: 1 }],
    saddle: [{ pts: [[2, 9], [45, 9]], side: 1 }, { pts: [[45, 18], [2, 18]], side: 1 }, { pts: [[16, 2], [16, 25]], side: -1 }, { pts: [[31, 25], [31, 2]], side: -1 }],
    twist: [{ pts: [[3, 2], [44, 25]], side: 1 }, { pts: [[44, 2], [3, 25]], side: -1 }]
  };
  var TEXT = { free: '板の上をなぞると、その線をバーナーが加熱します。', goal: '板の上をなぞって加熱線を引き、うすい橙の網（目標の形）に近づけよう。一致度' + Math.round(VIEW.pass * 100) + '%で合格。迷ったらヒント。', done: '合格！ 目標の形になりました。', demo: 'お手本です。「最初から」を押して、自分でやってみよう。' };

  var nx = VIEW.nx, ny = VIEW.ny, n = nx * ny, M = new PlateModel(nx, ny);
  var goal = 'free', target = null, tnorm = 1, side = 1, queue = [], cur = null, draft = null, drag = null, undo = [];
  var lines = 0, score = -1, cleared = false, hint = false, sparks = [], shown = false, passed = {};   // shown: お手本を見せている（合格にしない）
  var yaw = -0.5, pitch = 1.0, yawTo = -0.5, pitchTo = 1.0, W = 0, H = 0, dpr = 1;
  var PX = new Float32Array(n), PY = new Float32Array(n);
  var el = function (id) { return document.getElementById(id); };
  var elLines = el('lh-lines'), elDef = el('lh-def'), elScore = el('lh-score'), elMsg = el('lh-msg');

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

  // 折れ線を、およそ格子1個おきの点に取り直す（曲がった板の面に沿って描くため）
  function dense(pts) {
    var out = [pts[0]], i, q;
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], m = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
      for (q = 1; q <= m; q++) out.push([pts[i - 1][0] + dx * q / m, pts[i - 1][1] + dy * q / m]);
    }
    return out;
  }
  // 手で引いた線を整える。ほぼまっすぐなら直線に、そうでなければなめらかにする。短すぎる線は捨てる
  function tidy(pts) {
    var a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy), dev = 0, i;
    if (len < 3) return null;
    for (i = 1; i < pts.length - 1; i++) dev = Math.max(dev, Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / len);
    if (dev < 1.6) return dense([a, b]);
    var sm = [a];
    for (i = 1; i < pts.length - 1; i++) sm.push([(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4]);
    sm.push(b);
    return dense(sm);
  }

  // 1ステップ進める。待っている線があれば順に加熱する
  function advance() {
    if (!cur && queue.length) {
      var q = queue.shift();
      undo.push(M.save()); if (undo.length > 12) undo.shift();
      cur = { pts: q.pts, side: q.side, i: 0, x: q.pts[0][0], y: q.pts[0][1], tx: 1, ty: 0 };
      lines++;
    }
    if (!cur) { M.heatStep(null); return; }
    var p = cur.pts[cur.i + 1], dx = p[0] - cur.x, dy = p[1] - cur.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-9) { cur.tx = dx / d; cur.ty = dy / d; }
    if (d <= VIEW.speed) { cur.x = p[0]; cur.y = p[1]; cur.i++; } else { cur.x += cur.tx * VIEW.speed; cur.y += cur.ty * VIEW.speed; }
    M.heatStep(cur.x, cur.y, cur.side, cur.tx, cur.ty);
    if (cur.i >= cur.pts.length - 1) cur = null;
  }

  function clearPlate() {
    M = new PlateModel(nx, ny); queue = []; cur = null; draft = null; undo = []; lines = 0; cleared = false; sparks = []; shown = false; host.classList.remove('is-cleared');
  }
  function setGoal(name) {
    goal = name; clearPlate(); target = null;
    if (GOALS[name]) {
      var t = new PlateModel(nx, ny), s = 0, k;
      t.play(GOALS[name], VIEW.speed);
      target = t.w;
      for (k = 0; k < n; k++) s += target[k] * target[k];
      tnorm = Math.sqrt(s) || 1;
    }
  }
  function act(name) {
    if (name === 'reset') clearPlate();
    if (name === 'hint') hint = !hint;
    if (name === 'undo') {   // 加熱中や待ちの線があればそれも取り消して、最後に加熱を始めた線の前へ戻す
      queue = []; cur = null;
      var s = undo.pop();
      if (s) { M.load(s); lines--; cleared = false; host.classList.remove('is-cleared'); }
    }
    if (name === 'demo' && GOALS[goal]) {   // お手本: 目標の形を作った加熱線を、そのまま実演する
      clearPlate();
      GOALS[goal].forEach(function (g) { queue.push({ pts: dense(g.pts), side: g.side }); }); shown = true;
    }
  }

  function resize() {
    var r = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = cv.width = Math.max(1, Math.round(r.width * dpr));
    H = cv.height = Math.max(1, Math.round(r.height * dpr));
  }

  // 板の上の点（格子の位置 i, j と高さ z）を画面の位置 qx, qy に写す
  var cyw = 1, syw = 0, cp = 1, sp = 0, S = 1, CX = 0, CY = 0, qx = 0, qy = 0;
  function proj(i, j, z) {
    var X = i - (nx - 1) / 2, Y = j - (ny - 1) / 2;
    var x1 = X * cyw - Y * syw, y1 = X * syw + Y * cyw;
    var k = S * (1 + (y1 * sp + z * cp) * 0.006);
    qx = CX + x1 * k; qy = CY + (y1 * cp - z * sp) * k;
  }
  // 板の面（高さの配列 h）に沿って折れ線を描く
  function trace(pts, h) {
    ctx.beginPath();
    for (var q = 0; q < pts.length; q++) {
      var x = Math.max(0, Math.min(nx - 1, pts[q][0])), y = Math.max(0, Math.min(ny - 1, pts[q][1]));
      proj(x, y, h[Math.round(y) * nx + Math.round(x)] * VIEW.zoom);
      if (q) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy);
    }
    ctx.stroke();
  }
  // 板の厚みの面（k0 から dk おきに cnt 個の点が並ぶ辺）
  function edge(k0, dk, cnt, th) {
    var q;
    ctx.beginPath(); ctx.moveTo(PX[k0], PY[k0]);
    for (q = 1; q < cnt; q++) ctx.lineTo(PX[k0 + q * dk], PY[k0 + q * dk]);
    for (q = cnt - 1; q >= 0; q--) ctx.lineTo(PX[k0 + q * dk], PY[k0 + q * dk] + th);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function burst(x, y, count) {
    if (calm || (window.shibaMotion && window.shibaMotion.calm())) return;
    for (var m = 0; m < count; m++) {
      var an = Math.random() * 6.283, v = (1 + Math.random() * (count > 4 ? 9 : 3.5)) * dpr;
      sparks.push({ x: x, y: y, vx: Math.cos(an) * v, vy: Math.sin(an) * v * 0.6 - 2 * dpr, life: 1 });
    }
  }

  function draw() {
    var w = M.w, T = M.T, Z = VIEW.zoom, i, j, k, q;
    yaw += (yawTo - yaw) * 0.2; pitch += (pitchTo - pitch) * 0.2;
    cyw = Math.cos(yaw); syw = Math.sin(yaw); cp = Math.cos(pitch); sp = Math.sin(pitch);
    S = Math.min(W / 60, H / 44); CX = W * 0.5; CY = H * 0.56;
    ctx.clearRect(0, 0, W, H);
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) { k = j * nx + i; proj(i, j, w[k] * Z); PX[k] = qx; PY[k] = qy; }

    // 板の面。奥の升目から手前へ塗る
    var near = syw > 0, i0 = near ? 0 : nx - 2, i1 = near ? nx - 1 : -1, di = near ? 1 : -1;
    ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(170,215,255,.22)';
    for (j = 0; j < ny - 1; j++) {
      for (i = i0; i !== i1; i += di) {
        k = j * nx + i;
        var t = (T[k] + T[k + 1] + T[k + nx] + T[k + nx + 1]) * 51;   // 4点の平均 × 204（温度の上限 1.25 が白）
        ctx.fillStyle = COL[t > 255 ? 255 : t | 0];
        ctx.beginPath(); ctx.moveTo(PX[k], PY[k]); ctx.lineTo(PX[k + 1], PY[k + 1]);
        ctx.lineTo(PX[k + nx + 1], PY[k + nx + 1]); ctx.lineTo(PX[k + nx], PY[k + nx]); ctx.closePath();
        ctx.fill(); ctx.stroke();
        var sh = (w[k + nx] + w[k + nx + 1] - w[k] - w[k + 1]) * Z * 0.9;   // 面の傾きで明暗を付ける
        if (sh > 0.03) { ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.5, sh).toFixed(2) + ')'; ctx.fill(); }
        else if (sh < -0.03) { ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.24, -sh * 0.8).toFixed(2) + ')'; ctx.fill(); }
      }
    }
    ctx.fillStyle = '#0a1c46'; ctx.strokeStyle = 'rgba(170,215,255,.5)';
    edge((ny - 1) * nx, 1, nx, 1.4 * sp * S); edge(near ? nx - 1 : 0, nx, ny, 1.4 * sp * S);

    // 目標の形（うすい橙の網）
    if (target) {
      ctx.strokeStyle = 'rgba(255,200,120,.55)'; ctx.lineWidth = 1.2 * dpr;
      for (j = 0; j < ny; j += 3) { var rowPts = []; for (i = 0; i < nx; i++) rowPts.push([i, j]); trace(rowPts, target); }
      for (i = 0; i < nx + 3; i += 4) { var colPts = [], ii = Math.min(i, nx - 1); for (j = 0; j < ny; j++) colPts.push([ii, j]); trace(colPts, target); }
    }
    // ヒント（お手本の線）、これから加熱する線、引いている途中の線。表からは白か橙、裏からは水色
    if (hint && GOALS[goal]) {
      ctx.lineWidth = 2 * dpr; ctx.setLineDash([2 * dpr, 6 * dpr]);
      GOALS[goal].forEach(function (g) { ctx.strokeStyle = g.side > 0 ? '#ffb347' : '#7fe0ff'; trace(dense(g.pts), w); });
    }
    ctx.lineWidth = 2.2 * dpr; ctx.setLineDash([7 * dpr, 5 * dpr]);
    for (q = 0; q < queue.length; q++) { ctx.strokeStyle = queue[q].side > 0 ? '#fff' : '#7fe0ff'; trace(queue[q].pts, w); }
    if (cur) { ctx.strokeStyle = cur.side > 0 ? '#fff' : '#7fe0ff'; trace(cur.pts.slice(cur.i), w); }
    if (draft && draft.length > 1) { ctx.strokeStyle = side > 0 ? '#fff' : '#7fe0ff'; trace(draft, w); }
    ctx.setLineDash([]);

    // バーナーの光と火花。裏から加熱しているときは、バーナーを板の下に描く
    if (cur) {
      var zc = w[Math.round(cur.y) * nx + Math.round(cur.x)] * Z;
      proj(cur.x, cur.y, zc); var ax = qx, ay = qy;
      proj(cur.x, cur.y, zc + 7 * cur.side); var bx = qx, by = qy;
      var gr = S * 5, g = ctx.createRadialGradient(ax, ay, 0, ax, ay, gr);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.25, 'rgba(255,220,150,.5)'); g.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(ax - gr, ay - gr, gr * 2, gr * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = cur.side > 0 ? 'rgba(205,228,255,.9)' : 'rgba(127,224,255,.75)'; ctx.lineWidth = 3 * dpr;
      if (cur.side < 0) ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(ax + (bx - ax) * 0.22, ay + (by - ay) * 0.22); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      burst(ax, ay, 2);
    }
    ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.2 * dpr;
    for (q = sparks.length - 1; q >= 0; q--) {
      var s = sparks[q];
      s.vy += 0.14 * dpr; s.x += s.vx; s.y += s.vy; s.life -= 0.035;
      if (s.life <= 0) { sparks.splice(q, 1); continue; }
      ctx.strokeStyle = 'rgba(255,' + ((150 + 90 * s.life) | 0) + ',70,' + s.life.toFixed(2) + ')';
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 2.5, s.y - s.vy * 2.5); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // 数字の表示と、お題の判定
    var mx = 0, dd = 0;
    for (k = 0; k < n; k++) { var aw = w[k] < 0 ? -w[k] : w[k]; if (aw > mx) mx = aw; if (target) dd += (w[k] - target[k]) * (w[k] - target[k]); }
    score = target ? Math.max(0, 1 - Math.sqrt(dd) / tnorm) : -1;
    if (target && !cleared && !shown && score >= VIEW.pass && !cur && !queue.length && M.hot === 0) { cleared = true; passed[goal] = true; host.classList.add('is-cleared'); burst(CX, CY, 160); sync(); }
    var tl = String(lines); if (elLines && elLines.textContent !== tl) elLines.textContent = tl;   // 同じなら書かない（読み上げが繰り返さない）
    var td = mx.toFixed(2); if (elDef && elDef.textContent !== td) elDef.textContent = td;
    var ts = target ? Math.round(score * 100) + '%' : '-'; if (elScore && elScore.textContent !== ts) elScore.textContent = ts;
    var tm = cleared ? TEXT.done : shown && target ? TEXT.demo : target ? TEXT.goal : TEXT.free; if (elMsg && elMsg.textContent !== tm) elMsg.textContent = tm;
  }

  // 動くものがある間だけ描く（何も無くなったら止まり、操作があれば再開する）
  var raf = 0, tick = 0, visible = true;
  function frame() {
    raf = 0;
    if (document.hidden || !visible) return;
    if (++tick & 1) {
      var busy = cur || queue.length || M.hot > 0;
      if (busy) { for (var s = 0; s < VIEW.sub; s++) advance(); M.solve(); }
      draw();
      if (!busy && !draft && !drag && !sparks.length && Math.abs(yaw - yawTo) < 0.002 && Math.abs(pitch - pitchTo) < 0.002) return;
    }
    raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf) raf = requestAnimationFrame(frame); }

  // 画面の位置から、いちばん近い格子の点を探す。板の外なら -1
  function pick(e) {
    var r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width, py = (e.clientY - r.top) * H / r.height, best = -1, bd = 1e12, k;
    for (k = 0; k < n; k++) { var dx = PX[k] - px, dy = PY[k] - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = k; } }
    return bd < 2.6 * S * S ? best : -1;
  }
  // 板の上で押せば加熱線を引く。板の外で押して動かせば視点を回す
  cv.addEventListener('pointerdown', function (e) {
    var k = pick(e);
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    if (k < 0) drag = { x: e.clientX, y: e.clientY }; else draft = [[k % nx, (k / nx) | 0]];
    e.preventDefault(); wake();
  });
  cv.addEventListener('pointermove', function (e) {
    if (drag) {
      yawTo = Math.max(-1.1, Math.min(1.1, yawTo + (e.clientX - drag.x) * 0.006));
      pitchTo = Math.max(0.55, Math.min(1.25, pitchTo + (e.clientY - drag.y) * 0.004));
      drag.x = e.clientX; drag.y = e.clientY; wake(); return;
    }
    if (!draft) return;
    var k = pick(e), last = draft[draft.length - 1];
    if (k >= 0 && (k % nx !== last[0] || ((k / nx) | 0) !== last[1])) { draft.push([k % nx, (k / nx) | 0]); wake(); }
  });
  function finish() {
    if (draft && draft.length > 1) { var pts = tidy(draft); if (pts) queue.push({ pts: pts, side: side }); }
    draft = null; drag = null; wake();
  }
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);

  // ボタン
  var bar = el('lh-bar');
  function sync() {
    if (!bar) return;
    Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) {
      var d = b.dataset, toggle = d.goal || d.side || d.act === 'hint';
      if (toggle) {
        var on = d.goal === goal || +d.side === side || (d.act === 'hint' && hint);
        b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      if (d.act === 'demo' || d.act === 'hint') b.disabled = !GOALS[goal];
      if (d.goal) b.classList.toggle('is-done', !!passed[d.goal]);   // 合格したお題に ✓
    });
    var why = el('lh-why');   // ヒントとお手本が使えない理由（自由のとき）
    if (why) why.hidden = !!GOALS[goal];
  }
  if (bar) bar.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    // お題を変えるとき、お手本を始めるときは板を消すので、自分で引いた線があれば先に聞く
    if ((b.dataset.goal || b.dataset.act === 'demo') && !shown && (lines > 0 || queue.length || cur) && !window.confirm('今の板を消して切り替えますか？')) return;
    if (b.dataset.goal) { setGoal(b.dataset.goal); hint = false; }
    if (b.dataset.side) side = +b.dataset.side;
    if (b.dataset.act) act(b.dataset.act);
    sync(); wake();
  });

  window.addEventListener('resize', function () { resize(); wake(); });
  document.addEventListener('visibilitychange', wake);
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; wake(); }).observe(cv);

  window.lineHeat = {   // 確認用。いまの状態を返す
    state: function () { return { goal: goal, lines: lines, score: score, cleared: cleared, hot: M.hot, waiting: queue.length + (cur ? 1 : 0) }; }
  };

  resize(); sync(); draw(); wake();
})();
