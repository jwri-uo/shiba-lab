/* 全ページ共通の動き。
   1) タイルやカードを、画面に入ったときに順に表示する
   2) ヘッダー右上の溶接の画像から火花を飛ばす
   3) スクロールに合わせて、画面の上端を溶接線が走る
   4) カードをカーソルの側へ少し傾ける
   動きを減らす設定の端末では何もしない。JavaScript が動かなくてもページは普通に読める。 */
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ---- 1) 画面に入ったら順に表示 ---- */
  var targets = document.querySelectorAll('.tiles li, .cards li, .theme, .news__head');
  if (targets.length && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('js-reveal');
    var seen = false;
    var io = new IntersectionObserver(function (entries) {
      seen = true;
      var k = 0;
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.style.transitionDelay = (k++ * 70) + 'ms';
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    Array.prototype.forEach.call(targets, function (t) { t.classList.add('reveal'); io.observe(t); });
    // 監視が一度も働かない環境では、隠したままにしない
    setTimeout(function () {
      if (!seen) Array.prototype.forEach.call(targets, function (t) { t.classList.add('is-in'); });
    }, 1500);
  }

  /* ---- 3) スクロールに合わせて、画面の上端を溶接線が走る ---- */
  var bar = document.createElement('div'), waiting = false;
  bar.className = 'weldbar';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<b></b><i></i>';
  document.body.appendChild(bar);
  function progress() {
    waiting = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    bar.style.setProperty('--p', p.toFixed(4));
    bar.classList.toggle('is-on', p > 0.002);   // いちばん上では先端の光を出さない
  }
  window.addEventListener('scroll', function () { if (!waiting) { waiting = true; requestAnimationFrame(progress); } }, { passive: true });
  progress();

  /* ---- 4) カードをカーソルの側へ少し傾ける（マウスのときだけ） ---- */
  Array.prototype.forEach.call(document.querySelectorAll('.cards a, .theme a'), function (el) {
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--ry', (((e.clientX - r.left) / r.width - 0.5) * 9).toFixed(2) + 'deg');
      el.style.setProperty('--rx', ((0.5 - (e.clientY - r.top) / r.height) * 7).toFixed(2) + 'deg');
    });
    el.addEventListener('pointerleave', function () { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); });
  });

  /* ---- 2) 火花 ---- */
  // 動くものは1画面に1つに絞る: すぐ下で計算の画面が動いているページでは、火花は出さない
  if (document.getElementById('sim') || document.getElementById('lh')) return;
  var torch = document.querySelector('.hd__torch'), page = document.querySelector('.page');
  if (!torch || !page) return;
  var cv = document.createElement('canvas');
  cv.className = 'fx-sparks';
  cv.setAttribute('aria-hidden', 'true');
  page.appendChild(cv);
  var ctx = cv.getContext('2d'), parts = [], W = 0, H = 0, dpr = 1, on = true;

  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var r = cv.getBoundingClientRect();
    W = cv.width = Math.round(r.width * dpr);
    H = cv.height = Math.round(r.height * dpr);
  }

  function tick() {
    if (on && !document.hidden) {
      var c = cv.getBoundingClientRect(), t = torch.getBoundingClientRect();
      // 火花の出どころ = 溶接の画像の中の光っている点（画像の左から49%、上から58%）
      var ox = (t.left + t.width * 0.49 - c.left) * dpr, oy = (t.top + t.height * 0.58 - c.top) * dpr;
      ctx.clearRect(0, 0, W, H);
      if (t.height > 0) {
        for (var m = 0; m < 2; m++) {
          var a = Math.random() * 6.283, sp = (2 + Math.random() * 6) * dpr;
          parts.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2 * dpr, life: 1, w: 0.6 + Math.random() * 1.2 });
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.vy += 0.12 * dpr; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.life -= 0.016;
        if (p.life <= 0 || p.y > H) { parts.splice(i, 1); continue; }
        ctx.strokeStyle = 'rgba(255,' + ((140 + 100 * p.life) | 0) + ',' + ((40 + 120 * p.life * p.life) | 0) + ',' + p.life.toFixed(2) + ')';
        ctx.lineWidth = p.w * dpr;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.5, p.y - p.vy * 2.5); ctx.stroke();
      }
    }
    requestAnimationFrame(tick);
  }

  fit();
  window.addEventListener('resize', fit);
  // 画面の外にあるときは描かない（電池の節約）
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { on = es[0].isIntersecting; }).observe(cv);
  requestAnimationFrame(tick);
})();
