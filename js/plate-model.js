/* 板の計算（描画はしない）。線状加熱の体験 js/lineheat.js が使う。
   温度 : 動く熱源による2次元の熱伝導（陽解法の差分。端は断熱）
   曲げ : 加熱された所に、冷えるにつれて曲げの固有ひずみ（固有曲率）が残ると考える。
          固有曲率は加熱線をまたぐ向きが主で、線に沿う向きはその along 倍。
          端が自由な薄板のたわみ w を、曲率の食い違いの二乗和
            Σ (w,xx - Kxx)² + (w,yy - Kyy)² + 2 (w,xy - Kxy)²      （ポアソン比 0）
          が最小になるように解く（係数の行列を最初に1回だけ分解しておき、毎回は代入だけ）。
          面内の縮みと大たわみは考えていない。
   研究室の解析コードそのものではない簡易モデル。数値は DEFAULT で変える。 */
(function (root) {
  'use strict';
  var DEFAULT = {
    r: 0.12,       // 拡散数 α·Δt/Δx²。0.25 を超えると計算が発散する
    heat: 0.12,    // 入熱の強さ
    radius: 1.7,   // 熱源の半径（格子の数）
    cool: 0.008,   // 板の表面から逃げる熱
    tcrit: 0.45,   // この温度を超えた分だけ縮みが残る
    shrink: 0.05,  // 冷えた後に残る曲げの強さ
    along: 0.15,   // 加熱線に沿う向きの曲げの割合（またぐ向きを 1 として）
    expand: 0.03,  // 加熱中の、逆向きの一時的な曲げの強さ
    gdecay: 0.96,  // 表と裏の温度差が消えていく速さ
    tcold: 0.06    // ここまで冷えたら、残る曲げを確定する
  };
  var FACT = {};   // 板の式の分解。格子の大きさが同じなら使い回す

  // 板の式の係数を組み立てて、帯行列のコレスキー分解をしておく
  function factor(nx, ny) {
    var n = nx * ny, bw = 2 * ny, W = bw + 1, L = new Float64Array(n * W), s = Math.SQRT2, i, j, k;
    function id(i, j) { return i * ny + j; }   // 帯を狭くするため、短い辺を内側に数える
    function add(nd, co) {
      for (var a = 0; a < nd.length; a++) for (var b = 0; b < nd.length; b++) if (nd[b] <= nd[a]) L[nd[a] * W + nd[b] - nd[a] + bw] += co[a] * co[b];
    }
    for (i = 1; i < nx - 1; i++) for (j = 0; j < ny; j++) add([id(i - 1, j), id(i, j), id(i + 1, j)], [1, -2, 1]);
    for (i = 0; i < nx; i++) for (j = 1; j < ny - 1; j++) add([id(i, j - 1), id(i, j), id(i, j + 1)], [1, -2, 1]);
    for (i = 0; i < nx - 1; i++) for (j = 0; j < ny - 1; j++) add([id(i + 1, j + 1), id(i, j + 1), id(i + 1, j), id(i, j)], [s, -s, -s, s]);
    var pin = [id(0, 0), id(nx - 1, 0), id(0, ny - 1)];   // 板全体の平行移動と傾きを止めるため、3点を固定する
    pin.forEach(function (p) {
      for (var q = Math.max(0, p - bw); q <= Math.min(n - 1, p + bw); q++) { if (q <= p) L[p * W + q - p + bw] = 0; else L[q * W + p - q + bw] = 0; }
      L[p * W + bw] = 1;
    });
    for (j = 0; j < n; j++) {
      var d = L[j * W + bw];
      for (k = Math.max(0, j - bw); k < j; k++) d -= L[j * W + k - j + bw] * L[j * W + k - j + bw];
      d = Math.sqrt(d); L[j * W + bw] = d;
      for (i = j + 1; i <= Math.min(n - 1, j + bw); i++) {
        var sum = L[i * W + j - i + bw];
        for (k = Math.max(0, i - bw); k < j; k++) sum -= L[i * W + k - i + bw] * L[j * W + k - j + bw];
        L[i * W + j - i + bw] = sum / d;
      }
    }
    return { L: L, bw: bw, W: W, pin: pin };
  }

  function PlateModel(nx, ny, param) {
    var n = nx * ny, key, f32 = function () { return new Float32Array(n); };
    this.nx = nx; this.ny = ny; this.n = n; this.P = {};
    for (key in DEFAULT) this.P[key] = param && key in param ? param[key] : DEFAULT[key];
    this.F = FACT[nx + 'x' + ny] || (FACT[nx + 'x' + ny] = factor(nx, ny));
    this.T = f32(); this.T2 = f32();   // 温度
    this.G = f32();                    // 表と裏の温度差（表から加熱すると正）。加熱中の一時的な曲げのもと
    this.Tm = f32();                   // いまの加熱で達した最高温度
    this.side = new Int8Array(n);      // その加熱がどちらの面からか（表 +1、裏 -1）
    this.Cxx = f32(); this.Cyy = f32(); this.Cxy = f32();   // その加熱で曲がる向き（加熱線の向きから決まる）
    this.Kxx = f32(); this.Kyy = f32(); this.Kxy = f32();   // 冷えて残った固有曲率（正 = 表の側へ折れる）
    this.pend = f32();                 // まだ確定していない分（冷えるにつれて効いてくる）
    this.w = new Float64Array(n);      // たわみ（表の側が正）
    this.y = new Float64Array(n);
    this.hot = 0;                      // まだ冷えきっていない升目の数
    this.steps = 0;
  }
  // 1ステップ進める。熱源が (sx, sy) にあって (tx, ty) の向きへ進んでいる。sd = +1 なら表から、-1 なら裏から加熱。熱源なしは sx = null
  PlateModel.prototype.heatStep = function (sx, sy, sd, tx, ty) {
    var nx = this.nx, ny = this.ny, n = this.n, P = this.P, T = this.T, T2 = this.T2, G = this.G, Tm = this.Tm, side = this.side;
    var r = P.r, keep = 1 - P.cool, a = P.shrink, tc = P.tcrit, i, j, k, c;
    for (j = 0; j < ny; j++) {
      var up = j > 0 ? -nx : 0, dn = j < ny - 1 ? nx : 0;
      for (i = 0; i < nx; i++) {
        k = j * nx + i; c = T[k];
        var l = i > 0 ? T[k - 1] : c, rt = i < nx - 1 ? T[k + 1] : c;
        T2[k] = (c + r * (l + rt + T[k + up] + T[k + dn] - 4 * c)) * keep;
      }
    }
    for (k = 0; k < n; k++) G[k] *= P.gdecay;
    if (sx !== null) {
      var R = P.radius, R3 = Math.ceil(R * 3), cx = Math.round(sx), cy = Math.round(sy), la = P.along;
      var cxx = ty * ty + la * tx * tx, cyy = tx * tx + la * ty * ty, cxy = (la - 1) * tx * ty;
      for (j = Math.max(0, cy - R3); j <= Math.min(ny - 1, cy + R3); j++) {
        for (i = Math.max(0, cx - R3); i <= Math.min(nx - 1, cx + R3); i++) {
          k = j * nx + i;
          var q = P.heat * Math.exp(-((i - sx) * (i - sx) + (j - sy) * (j - sy)) / (2 * R * R));
          if (side[k] !== sd || Math.abs(this.Cxx[k] - cxx) + Math.abs(this.Cxy[k] - cxy) > 0.3) {
            this.commit(k);   // 面か向きが違う前の加熱が残っていたら、先にそれを確定する
            side[k] = sd; this.Cxx[k] = cxx; this.Cyy[k] = cyy; this.Cxy[k] = cxy;
          }
          T2[k] = Math.min(1.25, T2[k] + q);
          G[k] = Math.max(-1.25, Math.min(1.25, G[k] + sd * q));
        }
      }
    }
    this.T = T2; this.T2 = T; T = T2;
    var hot = 0;
    for (k = 0; k < n; k++) {
      var t = T[k], m = Tm[k];
      if (t > m) m = Tm[k] = t;
      if (t < P.tcold) { this.commit(k); m = 0; }   // 冷えきったら確定する
      if (m > 0) hot++;
      this.pend[k] = m > tc ? side[k] * a * (m - tc) * (1 - t / m) : 0;
    }
    this.hot = hot; this.steps++;
  };

  // 升目 k の、まだ確定していない曲げを、残る固有曲率に足し込む
  PlateModel.prototype.commit = function (k) {
    var e = this.Tm[k] - this.P.tcrit;
    if (e > 0 && this.side[k]) {
      e *= this.side[k] * this.P.shrink;
      this.Kxx[k] += e * this.Cxx[k]; this.Kyy[k] += e * this.Cyy[k]; this.Kxy[k] += e * this.Cxy[k];
    }
    this.Tm[k] = 0;
  };

  // いまの固有曲率に対する、板のたわみを求める
  PlateModel.prototype.solve = function () {
    var nx = this.nx, ny = this.ny, n = this.n, F = this.F, L = F.L, W = F.W, bw = F.bw, y = this.y, w = this.w, pe = this.pend, b = this.P.expand, i, j, k, v, s;
    var Kxx = this.Kxx, Kyy = this.Kyy, Kxy = this.Kxy, Cxx = this.Cxx, Cyy = this.Cyy, Cxy = this.Cxy, G = this.G;
    for (k = 0; k < n; k++) y[k] = 0;
    for (i = 1; i < nx - 1; i++) for (j = 0; j < ny; j++) { k = j * nx + i; v = Kxx[k] + pe[k] * Cxx[k] - b * G[k]; y[(i - 1) * ny + j] += v; y[i * ny + j] -= 2 * v; y[(i + 1) * ny + j] += v; }
    for (i = 0; i < nx; i++) for (j = 1; j < ny - 1; j++) { k = j * nx + i; v = Kyy[k] + pe[k] * Cyy[k] - b * G[k]; y[i * ny + j - 1] += v; y[i * ny + j] -= 2 * v; y[i * ny + j + 1] += v; }
    for (i = 0; i < nx - 1; i++) for (j = 0; j < ny - 1; j++) {
      k = j * nx + i;
      v = 0.5 * (Kxy[k] + pe[k] * Cxy[k] + Kxy[k + 1] + pe[k + 1] * Cxy[k + 1] + Kxy[k + nx] + pe[k + nx] * Cxy[k + nx] + Kxy[k + nx + 1] + pe[k + nx + 1] * Cxy[k + nx + 1]);
      y[(i + 1) * ny + j + 1] += v; y[i * ny + j + 1] -= v; y[(i + 1) * ny + j] -= v; y[i * ny + j] += v;
    }
    for (k = 0; k < 3; k++) y[F.pin[k]] = 0;
    for (i = 0; i < n; i++) { s = y[i]; for (k = Math.max(0, i - bw); k < i; k++) s -= L[i * W + k - i + bw] * y[k]; y[i] = s / L[i * W + bw]; }
    for (i = n - 1; i >= 0; i--) { s = y[i]; for (k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= L[k * W + i - k + bw] * y[k]; y[i] = s / L[i * W + bw]; }
    // 平均と傾きを引いて、板が水平に置かれた状態にする
    var m0 = 0, mx = 0, my = 0, qx = 0, qy = 0, x0 = (nx - 1) / 2, y0 = (ny - 1) / 2;
    for (i = 0; i < nx; i++) for (j = 0; j < ny; j++) { v = y[i * ny + j]; m0 += v; mx += v * (i - x0); my += v * (j - y0); qx += (i - x0) * (i - x0); qy += (j - y0) * (j - y0); }
    m0 /= n; mx /= qx; my /= qy;
    for (i = 0; i < nx; i++) for (j = 0; j < ny; j++) w[j * nx + i] = y[i * ny + j] - m0 - mx * (i - x0) - my * (j - y0);
  };

  // 加熱線を順に最後までなぞり、冷えるまで進めて、たわみを求める（お題の形を作るのに使う）
  // lines = [{ pts: [[x, y], ...], side: 1 または -1 }]、speed = 熱源の速さ（格子/ステップ）
  PlateModel.prototype.play = function (lines, speed) {
    for (var s = 0; s < lines.length; s++) {
      var pts = lines[s].pts, i = 0, x = pts[0][0], y = pts[0][1], tx = 1, ty = 0;
      while (i < pts.length - 1) {
        var dx = pts[i + 1][0] - x, dy = pts[i + 1][1] - y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1e-9) { tx = dx / d; ty = dy / d; }
        if (d <= speed) { x = pts[i + 1][0]; y = pts[i + 1][1]; i++; } else { x += tx * speed; y += ty * speed; }
        this.heatStep(x, y, lines[s].side, tx, ty);
      }
    }
    for (var c = 0; c < 4000 && this.hot > 0; c++) this.heatStep(null);
    this.solve();
  };

  var KEEP = ['T', 'G', 'Tm', 'side', 'Cxx', 'Cyy', 'Cxy', 'Kxx', 'Kyy', 'Kxy'];
  PlateModel.prototype.save = function () {
    var o = {}, self = this;
    KEEP.forEach(function (f) { o[f] = self[f].slice(); });
    return o;
  };
  PlateModel.prototype.load = function (o) {
    var self = this;
    KEEP.forEach(function (f) { self[f].set(o[f]); });
    this.heatStep(null); this.solve();
  };

  root.PlateModel = PlateModel;
})(typeof window !== 'undefined' ? window : globalThis);
