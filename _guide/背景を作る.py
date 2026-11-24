"""トップの「メニューの左」の写真の後ろに敷く背景（img/〜-bg.jpg）を作る。
写真をそのまま縮めて置き、その右と上下には、写真の縁の色をのばして、写真から離れるほど強くぼかし、帯の紺に寄せて暗くする。
背景の上では、写真の右端（とメニューのガラスの下）がやわらかく消えるので、写真 → 同じ絵のぼけ → 紺 と、つなぎ目なく変わる。
決まり事（css/style.css の .hero__slide.is-collage が、この決まり事で背景を写真にぴったり重ねる）:
  背景の縦横は写真の 1.5 倍。写真は背景の左の端から、上から 1/6 の所に、背景の幅の 2/3 の大きさで置く。
python -X utf8 背景を作る.py <写真> [<写真> ...]          … 〜.jpg の横に 〜-bg.jpg を書く
python -X utf8 背景を作る.py <静止画> --out <背景の名前>  … 動画は、最初のコマと同じ静止画から作り、名前を「動画の名前-bg.jpg」にする
要るもの: Python の numpy と Pillow。"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

WB = 480            # 背景の中の写真の幅（ぼかすので小さくてよい。帯の上では約2倍に引きのばされる）
S0, SMAX = 1.2, 26  # ぼかしの強さ（背景の画素）。写真の所はわずかに、写真から一番離れた所で最も強く
D_BLUR = 120        # 写真の縁から、ぼかしが最も強くなるまでの距離（背景の画素）
D_DARK = 170        # 写真の縁から、暗さが最も強くなるまでの距離
NAVY = np.array([7, 22, 54], np.float32)   # 帯の地の色（.hero__slides の紺）に寄せる
DARK = .5           # 一番離れた所で、紺をどれだけ混ぜるか


def ease(t):
    """0〜1 をなめらかに（始まりと終わりの傾きが0。段に見えない）"""
    t = np.clip(t, 0, 1)
    return t * t * t * (t * (6 * t - 15) + 10)


def make(src, out):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    hb = WB * h / w
    Hp = round(hb)
    W, H = round(WB * 1.5), round(hb * 1.5)
    oy = round(hb / 4)
    P = np.asarray(im.resize((WB, Hp), Image.LANCZOS), np.float32)
    # 写真の外は、いちばん近い縁の色をのばす
    ys = np.clip(np.arange(H) - oy, 0, Hp - 1)
    xs = np.clip(np.arange(W), 0, WB - 1)
    E = P[ys[:, None], xs[None, :]]
    # 写真の縁からの距離
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dx = np.maximum(0, xx - (WB - 1))
    dy = np.maximum(0, np.maximum(oy - yy, yy - (oy + Hp - 1)))
    d = np.hypot(dx, dy)
    # 離れるほど強くぼかす: ぼかしの段をいくつか作り、距離に応じて段の間を混ぜる
    sig = S0 + (SMAX - S0) * ease(d / D_BLUR)
    levels = np.geomspace(S0, SMAX, 14)
    base = Image.fromarray(np.clip(E + .5, 0, 255).astype(np.uint8))
    stack = np.stack([np.asarray(base.filter(ImageFilter.GaussianBlur(s)), np.float32) for s in levels])
    f = np.interp(sig, levels, np.arange(len(levels)))
    k = np.minimum(np.floor(f).astype(int), len(levels) - 2)
    t = (f - k)[..., None]
    out_img = np.take_along_axis(stack, k[None, ..., None].repeat(3, -1), 0)[0] * (1 - t) \
        + np.take_along_axis(stack, (k + 1)[None, ..., None].repeat(3, -1), 0)[0] * t
    # 離れるほど帯の紺に寄せる
    m = (DARK * ease(d / D_DARK))[..., None]
    out_img = out_img * (1 - m) + NAVY * m
    # 段（バンディング）が出ないよう、ごく小さなゆらぎを足してから8ビットに
    rng = np.random.default_rng(1)
    out_img = out_img + rng.uniform(-.5, .5, out_img.shape)
    Image.fromarray(np.clip(out_img + .5, 0, 255).astype(np.uint8)).save(out, 'JPEG', quality=82, progressive=True, optimize=True)
    print(out, (W, H), '写真', (WB, Hp), '上の余白', oy)


if __name__ == '__main__':   # 組み直し.py からも make を使う
    args = sys.argv[1:]
    if '--out' in args:
        i = args.index('--out')
        make(args[0], args[i + 1])
    else:
        for p in args:
            make(p, os.path.splitext(p)[0] + '-bg.jpg')
