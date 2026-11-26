/* 全ページ共通の動き。
   0) トップの写真を6秒ごとに替え、何枚目かを示す。印を押すと（スマホは横に払っても）その写真に替わる
   1) タイルやカードを、画面に入ったときに順に表示する
   2) ヘッダー右上の溶接の画像から火花を飛ばす
   3) スクロールに合わせて、画面の上端を溶接線が走る
   4) カードをカーソルの側へ少し傾ける
   動きを減らす設定の端末では、写真を手で替えることだけができる。JavaScript が動かなくてもページは普通に読める。 */
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
    // 置き場所は、英語の所属名（… The University of Osaka）の行の真下、行の左端にそろえる（右上の溶接の画像と火花を隠さない）。
    // 字の読み込みや幅の変化で行の位置が変わるので、そのたびに測り直す
    var labEn = document.querySelector('.hd__lab small'), lab = document.querySelector('.hd__lab');
    var placeMb = function () {
      if (!labEn) return;
      var rg = document.createRange(); rg.selectNodeContents(labEn);
      var rs = rg.getClientRects(), line = rs[rs.length - 1];
      if (!line) return;
      var h = hd.getBoundingClientRect();
      mb.style.right = 'auto';
      mb.style.left = Math.round(line.left - h.left) + 'px';
      mb.style.top = Math.round(line.bottom - h.top + 2) + 'px';
    };
    placeMb();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeMb);
    if ('ResizeObserver' in window && lab) new ResizeObserver(placeMb).observe(lab);
    else window.addEventListener('resize', placeMb);
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
  // 見出しに「区分」の列がある表（学生全員の発表実績）は、区分を読んで行ごとに色を付ける（受賞・特許・留学・海外発表を目立たせる）。
  // 区分のセルは何行にもまたがる（rowspan）ので、表の格子を組み立てて各行の区分を決める。先生が行を足しても、区分の文字を書けば色が付く
  var KINDS = [['留学', 'abroad', '留学'], ['特許', 'patent', '特許'], ['受賞', 'award', '受賞'], ['海外', 'intl', '海外発表'], ['論文', 'paper', '']];
  var kindOf = function (t) {
    t = t.replace(/\s+/g, '');
    for (var i = 0; i < KINDS.length; i++) if (t.indexOf(KINDS[i][0]) >= 0) return KINDS[i][1];
    return '';
  };
  var seenKinds = {}, firstKindTable = null;
  Array.prototype.forEach.call(document.querySelectorAll('.doc table'), function (tb) {
    var head = tb.tHead && tb.tHead.rows[0], kc = -1;
    if (!head) return;
    for (var i = 0; i < head.cells.length; i++) if (head.cells[i].textContent.replace(/\s+/g, '') === '区分') kc = i;
    if (kc < 0) return;
    firstKindTable = firstKindTable || tb;
    Array.prototype.forEach.call(tb.tBodies, function (body) {
      var occ = [];   // occ[行][列] = その場所を占めるセル
      Array.prototype.forEach.call(body.rows, function (tr, r) {
        occ[r] = occ[r] || [];
        var col = 0, starts = [];
        Array.prototype.forEach.call(tr.cells, function (td) {
          while (occ[r][col]) col++;
          var rs = Math.max(1, td.rowSpan || 1), cs = Math.max(1, td.colSpan || 1);
          for (var dr = 0; dr < rs; dr++) { occ[r + dr] = occ[r + dr] || []; for (var dc = 0; dc < cs; dc++) occ[r + dr][col + dc] = td; }
          starts.push([col, td]);
          col += cs;
        });
        var kcell = occ[r][kc];
        if (!kcell) return;
        if (!kcell.hasAttribute('data-kind')) {
          kcell.setAttribute('data-kind', kindOf(kcell.textContent));
          kcell.classList.add('is-kind');
        }
        var k = kcell.getAttribute('data-kind');
        if (!k) return;
        seenKinds[k] = true;
        starts.forEach(function (s) { if (s[0] > kc) s[1].setAttribute('data-kind', k); });
      });
    });
  });
  if (firstKindTable) {   // 色の見方（このページにある区分だけ）を、目次の下に出す
    var lg = document.createElement('p');
    lg.className = 'kind-legend';
    lg.setAttribute('aria-hidden', 'true');   // 区分は表の中に文字であるので、読み上げには要らない
    lg.appendChild(document.createTextNode('色の見方'));
    [2, 1, 0, 3].forEach(function (i) {   // 受賞・特許・留学・海外発表の順に（読み取りの順とは違う）
      var k = KINDS[i];
      if (!seenKinds[k[1]]) return;
      var sp = document.createElement('span');
      sp.setAttribute('data-kind', k[1]);
      sp.textContent = k[2];
      lg.appendChild(sp);
    });
    var toc = document.querySelector('.doc__toc'), anchor = firstKindTable.closest('details') || firstKindTable.closest('.doc__scroll') || firstKindTable;
    if (toc) toc.parentNode.insertBefore(lg, toc.nextSibling);
    else anchor.parentNode.insertBefore(lg, anchor);
  }
  /* ---- 0) トップの写真: 6秒ごとに次へ（figure に data-sec があればその秒数）。動画（video）も置ける。2枚目以降の写真はページを読み終えてから読み、動画は1つ前の写真を出したときに読む。
     自動の切り替えは、印の左の ⏸ ボタンで止める（押した状態は覚える）。ヘッダーの「動きを止める」では止めない（先生の希望）。
     端末が「動きを減らす」設定のときは初めから止めておき、▶ で動かせる。止めている間は、押した写真だけをその場で読む ---- */
  var reduced = function () { return !!(reduceMq && reduceMq.matches); };
  var heroBox = document.querySelector('.hero__slides');
  var heroSlides = heroBox ? heroBox.querySelectorAll('.hero__slide') : [];
  if (heroSlides.length > 1) (function () {
    var n = heroSlides.length, cur = 0, want = 0, timer = 0, i;
    var wasReduced = reduced(), stopped = wasReduced;
    try { if (localStorage.getItem('shiba-slides') === 'off') stopped = true; } catch (e) { /* 覚えられない環境では、開くたびに動く */ }
    for (i = 0; i < n; i++) if (heroSlides[i].classList.contains('is-on')) cur = want = i;
    var two = function (k) { return (k < 10 ? '0' : '') + k; };
    var nav = document.createElement('div');
    nav.className = 'hero__nav';
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'トップの写真の切り替え');
    var h = '<button type="button" class="hero__play"><i class="fa" aria-hidden="true"></i></button><span class="hero__count" aria-hidden="true"><b></b> / ' + two(n) + '</span><span class="hero__dots">';
    for (i = 0; i < n; i++) h += '<button type="button" class="hero__dot" aria-label="' + (i + 1) + '枚目の写真"></button>';
    nav.innerHTML = h + '</span>';
    heroBox.parentNode.insertBefore(nav, heroBox.parentNode.querySelector('.hero__menu'));
    var dots = nav.querySelectorAll('.hero__dot'), num = nav.querySelector('.hero__count b'), play = nav.querySelector('.hero__play');
    var playLabel = function () {
      var t = stopped ? '写真の自動の切り替えを再開する' : '写真の自動の切り替えを止める';
      play.setAttribute('aria-label', t); play.title = t;
      play.firstChild.className = 'fa ' + (stopped ? 'fa-play' : 'fa-pause');
    };
    var img = function (k) {   // k 枚目の写真（動画）を、まだ読んでいなければ読み始める
      var im = heroSlides[k].querySelector('img, video');
      if (im && im.hasAttribute('data-src') && !im.getAttribute('src')) {
        if (im.tagName === 'VIDEO') im.preload = 'auto';
        im.src = im.getAttribute('data-src');
      }
      return im;
    };
    var isVideo = function (k) { var m = heroSlides[k].querySelector('img, video'); return !!m && m.tagName === 'VIDEO'; };
    var ready = function (m) { return !m || (m.tagName === 'VIDEO' ? m.readyState >= 2 : m.complete && !!m.getAttribute('src')); };
    var preloadAll = function () { for (var j = 0; j < n; j++) if (!isVideo(j)) img(j); };   // 動画は重いので、先には読まない
    var mark = function () {
      for (var j = 0; j < n; j++) {
        heroSlides[j].classList.toggle('is-on', j === cur);
        if (j === cur) { heroSlides[j].removeAttribute('aria-hidden'); dots[j].setAttribute('aria-current', 'true'); }
        else { heroSlides[j].setAttribute('aria-hidden', 'true'); dots[j].removeAttribute('aria-current'); }
        var v = heroSlides[j].querySelector('video');   // 見せている動画だけ、頭から流す（動きを減らす設定では流さず、最初のコマを見せる）
        if (v) { if (j === cur && !reduced()) { try { v.currentTime = 0; } catch (e) { /* まだ読めていない */ } var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } else v.pause(); }
      }
      num.textContent = two(cur + 1);
    };
    var schedule = function () {
      clearTimeout(timer); timer = 0;
      if (!stopped && !document.hidden) timer = setTimeout(function () { go(cur + 1); }, (parseFloat(heroSlides[cur].getAttribute('data-sec')) || 6) * 1000);
    };
    var go = function (k) {   // 写真が届いてから替える（届く前に替えると、一瞬なにも写らない）
      k = (k % n + n) % n; want = k;
      var im = img(k);
      var swap = function () { if (want !== k) return; cur = k; mark(); img((k + 1) % n); schedule(); };
      if (ready(im)) swap();
      else { im.addEventListener(im.tagName === 'VIDEO' ? 'loadeddata' : 'load', swap, { once: true }); im.addEventListener('error', swap, { once: true }); }
    };
    Array.prototype.forEach.call(dots, function (d, k) { d.addEventListener('click', function () { go(k); }); });
    play.addEventListener('click', function () {   // ⏸ ですぐ止め、▶ ですぐ次の写真へ進めて、そこから6秒ごとに替える
      stopped = !stopped;
      try { if (stopped) localStorage.setItem('shiba-slides', 'off'); else localStorage.removeItem('shiba-slides'); } catch (e) { /* 覚えられなくても、このページでは止まる */ }
      playLabel();
      if (stopped) { schedule(); return; }
      preloadAll();
      go(cur + 1);
    });
    nav.addEventListener('keydown', function (e) {   // 印を選んでいるときは ← → で前後へ
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var k = ((want + d) % n + n) % n;
      go(k); dots[k].focus();
    });
    // スマホ: 写真を横に払うと前後へ（メニューと印の上は除く）
    var hero = heroBox.parentNode, sx = 0, sy = 0;
    hero.addEventListener('touchstart', function (e) { sx = e.changedTouches[0].clientX; sy = e.changedTouches[0].clientY; }, { passive: true });
    hero.addEventListener('touchend', function (e) {
      if (e.target.closest && e.target.closest('.hero__menu, .hero__nav')) return;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(want + (dx < 0 ? 1 : -1));
    }, { passive: true });
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('shiba:motion', function () {   // 端末の「動きを減らす」設定に変わったら止める（ヘッダーのボタンでは何もしない）
      var r = reduced();
      if (r !== wasReduced) { wasReduced = r; if (r) { stopped = true; playLabel(); } }
      schedule();
    });
    playLabel();
    mark();
    var start = function () {
      if (!stopped) preloadAll();   // 自動で替えるときは、写真を全部先に読んでおく
      img((cur + 1) % n);
      schedule();
    };
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
  })();

  if (reduceMq && reduceMq.matches) return;

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
