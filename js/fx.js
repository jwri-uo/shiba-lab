/* 全ページ共通の動き。
   1) タイルやカードを、画面に入ったときに順に表示する
   2) ヘッダー右上の溶接の画像から火花を飛ばす
   3) スクロールに合わせて、画面の上端を溶接線が走る
   4) カードをカーソルの側へ少し傾ける
   動きを減らす設定の端末では何もしない。JavaScript が動かなくてもページは普通に読める。 */
(function () {
  'use strict';
  // 動きを止めるかどうかは1か所で決める: 端末の「動きを減らす」設定か、ヘッダーの「動きを止める」ボタン（全ページで覚える）。
  // plate.js・sim.js・lineheat.js も window.shibaMotion.calm() を見て、合図 shiba:motion で止める／再開する
  var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var userOff = false;
  try { userOff = localStorage.getItem('shiba-motion') === 'off'; } catch (e) { /* 覚えられない環境では毎回動く */ }
  var motion = window.shibaMotion = { calm: function () { return userOff || !!(reduceMq && reduceMq.matches); } };
  var motionChanged = function () {
    document.documentElement.classList.toggle('is-still', motion.calm());
    document.dispatchEvent(new Event('shiba:motion'));
  };
  document.documentElement.classList.toggle('is-still', motion.calm());
  if (reduceMq && reduceMq.addEventListener) reduceMq.addEventListener('change', motionChanged);
  var hd = document.querySelector('.hd');
  if (hd && !(reduceMq && reduceMq.matches)) {
    var mb = document.createElement('button');
    mb.type = 'button';
    mb.className = 'motion-btn';
    var label = function () { mb.textContent = userOff ? '動きを再開' : '動きを止める'; };
    label();
    mb.addEventListener('click', function () {
      userOff = !userOff;
      try { if (userOff) localStorage.setItem('shiba-motion', 'off'); else localStorage.removeItem('shiba-motion'); } catch (e) { /* 覚えられなくても、このページでは止まる */ }
      label();
      motionChanged();
    });
    hd.appendChild(mb);
  }
  // 幅の狭い画面では、左のメニューは分類の名前だけにして、本文をすぐ読めるようにする（押せば開く）
  if (window.matchMedia && window.matchMedia('(max-width: 960px)').matches) {
    Array.prototype.forEach.call(document.querySelectorAll('.side__grp[open]'), function (d) { d.removeAttribute('open'); });
  }
  // 狭い画面では上の帯が横に動くので、今のページの項目が見える所まで送る。Tab で選んだ項目も見える所へ送る
  var gnUl = document.querySelector('.gn ul'), gnCur = document.querySelector('.gn .is-current');
  if (gnUl && gnCur && gnCur.offsetLeft + gnCur.offsetWidth > gnUl.clientWidth - 32) gnUl.scrollLeft = gnCur.offsetLeft - 24;
  if (gnUl) gnUl.addEventListener('focusin', function (e) { if (gnUl.scrollWidth > gnUl.clientWidth) e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  // 横に動かせる表には、右の端の影と「表は横に動かせます」を出し、キーボードでも動かせるようにする
  var markWide = function () {
    Array.prototype.forEach.call(document.querySelectorAll('.doc__scroll'), function (d) {
      var wide = d.scrollWidth > d.clientWidth + 2, hint = d.previousElementSibling;
      d.classList.toggle('is-wide', wide);
      if (!hint || !hint.classList.contains('doc__hint')) {
        if (!wide) return;
        hint = document.createElement('p');
        hint.className = 'doc__hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = '表は横に動かせます →';
        d.parentNode.insertBefore(hint, d);
      }
      hint.hidden = !wide;
      if (wide) { d.tabIndex = 0; d.setAttribute('role', 'region'); d.setAttribute('aria-label', '表（横に動かせます）'); }
      else { d.removeAttribute('tabindex'); d.removeAttribute('role'); d.removeAttribute('aria-label'); }
    });
  };
  if (document.querySelector('.doc__scroll')) {
    markWide();
    var wideFrame = 0;
    window.addEventListener('resize', function () { cancelAnimationFrame(wideFrame); wideFrame = requestAnimationFrame(markWide); });
    document.addEventListener('toggle', markWide, true);   // たたんだ表を開いたとき
  }
  if (reduceMq && reduceMq.matches) return;

  /* ---- 0) トップの写真の2枚目以降は、ページを読み終えてから読む（1枚目を早く出すため）。届いたら切り替えを始める ---- */
  var lateSlides = document.querySelectorAll('.hero__slides img[data-src]');
  if (lateSlides.length) {
    var startSlides = function () {
      var left = lateSlides.length;
      var one = function () { if (--left === 0) document.querySelector('.hero__slides').classList.add('is-ready'); };
      Array.prototype.forEach.call(lateSlides, function (im) { im.onload = im.onerror = one; im.src = im.getAttribute('data-src'); });
    };
    if (document.readyState === 'complete') startSlides(); else window.addEventListener('load', startSlides);
  }

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
  var bar = document.createElement('div'), waiting = false, offT = 0;
  bar.className = 'weldbar';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<b></b><i></i>';
  document.body.appendChild(bar);
  function progress() {
    waiting = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    bar.style.setProperty('--p', p.toFixed(4));
    clearTimeout(offT);   // 先端の光はスクロールしている間と、止まって0.3秒だけ出す（いちばん上では出さない）
    bar.classList.toggle('is-on', p > 0.002);
    if (p > 0.002) offT = setTimeout(function () { bar.classList.remove('is-on'); }, 300);
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
  var ctx = cv.getContext('2d'), parts = [], W = 0, H = 0, dpr = 1, on = true, raf = 0, last = 0;
  // 画面の外、裏のタブ、動きを止めている間は、次のコマを予約しない
  function wake() { if (!raf && on && !document.hidden && !motion.calm()) { last = 0; raf = requestAnimationFrame(tick); } }

  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var r = cv.getBoundingClientRect();
    W = cv.width = Math.round(r.width * dpr);
    H = cv.height = Math.round(r.height * dpr);
  }

  function tick(now) {
    raf = 0;
    if (!on || document.hidden || motion.calm()) { ctx.clearRect(0, 0, W, H); parts.length = 0; return; }
    var f = last ? Math.min(now - last, 50) / 16.7 : 1, damp = Math.pow(0.985, f);   // 60コマ/秒のときを1として、経過時間で進める
    last = now;
    {
      var c = cv.getBoundingClientRect(), t = torch.getBoundingClientRect();
      // 火花の出どころ = 溶接の画像の中の光っている点（画像の左から49%、上から58%）
      var ox = (t.left + t.width * 0.49 - c.left) * dpr, oy = (t.top + t.height * 0.58 - c.top) * dpr;
      ctx.clearRect(0, 0, W, H);
      if (t.height > 0) {
        for (var m = 0; m < 2 * f; m++) {
          var a = Math.random() * 6.283, sp = (2 + Math.random() * 6) * dpr;
          parts.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2 * dpr, life: 1, w: 0.6 + Math.random() * 1.2 });
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.vy += 0.12 * dpr * f; p.vx *= damp; p.vy *= damp; p.x += p.vx * f; p.y += p.vy * f; p.life -= 0.016 * f;
        if (p.life <= 0 || p.y > H) { parts.splice(i, 1); continue; }
        ctx.strokeStyle = 'rgba(255,' + ((140 + 100 * p.life) | 0) + ',' + ((40 + 120 * p.life * p.life) | 0) + ',' + p.life.toFixed(2) + ')';
        ctx.lineWidth = p.w * dpr;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.5, p.y - p.vy * 2.5); ctx.stroke();
      }
    }
    raf = requestAnimationFrame(tick);
  }

  fit();
  window.addEventListener('resize', fit);
  // 画面の外にあるときは描かない（電池の節約）
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { on = es[0].isIntersecting; wake(); }).observe(cv);
  document.addEventListener('visibilitychange', wake);
  document.addEventListener('shiba:motion', wake);
  wake();
})();
