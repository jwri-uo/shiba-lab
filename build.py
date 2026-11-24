#!/usr/bin/env python3
"""サイトの共通部分と一覧を作り直す。

  python build.py            確かめるだけ（書き込まない）
  python build.py --apply    実際に書き込む

push すると GitHub が自動で --apply を実行するので、ふだんは手元で流す必要はない。

各ページで人が書くのは <main> … </main> の中だけ。その外側（ヘッダー・上の帯・フッター）は _frame/frame.html から、
上の帯と左のメニューの項目は _frame/menu.txt から、トップの写真と動画は _frame/top.txt から作り直す。<head> の中で、そのページだけで読み込むもの（js など）は
<!-- この下は、このページだけの行 --> より下に書く（上は枠の行なので作り直される）。<main> の中でも、次の目印で挟まれた所は自動で作り直す
（目印の間を手で直しても、次の実行で元に戻る）:

  <!-- 自動:メニュー -->       左のメニュー
  <!-- 自動:ページ一覧 -->     トップの写真の上の一覧
  <!-- 自動:トップの写真 -->   トップの写真と動画（_frame/top.txt の並び）
  <!-- 自動:新着 -->           トップのお知らせ（新しい6件）
  <!-- 自動:お知らせ一覧 -->   お知らせの一覧（年ごと）
  <!-- 自動:前後の記事 -->     お知らせの記事の下の「新しい記事／一覧へ／古い記事」
  <!-- 自動:関連 言葉|言葉 --> 研究テーマのページの、関連するページとお知らせ（題名にその言葉を含むもの。言葉は | で区切り、記号もそのままの文字として探す）

お知らせは news-〜.html という名前のページ全部（〜は半角の小文字・数字・ハイフン）。日付・分類・題名は、そのページの中から読む。
一覧とトップの小さな画像（img/ns-〜.jpg、img/nt-〜.jpg）は、記事の最初の写真から自動で作る。写真が替われば作り直し、
使われなくなったものは消す。この2つの頭の文字（ns-、nt-）は、ほかの画像の名前に使わない。

終了コード（GitHub の Actions はこれを見て、反映するかと、赤い印にするかを決める）:
  0  問題なし
  2  直す必要のある所があった。ファイル名と直し方を出す。そのページは前のままにし、ほかは作り直す。
     お知らせに問題があるあいだは、記事が一覧から消えないように、お知らせの一覧・新着・前後の記事・関連も前のままにする
     _frame/top.txt に問題があるあいだは、トップの写真の帯を前のままにする
  1  枠（_frame/frame.html）やメニュー（_frame/menu.txt）の問題。全ページに響くので、何も書かずに止まる
"""
import datetime, hashlib, html, io, os, re, subprocess, sys, unicodedata, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
APPLY = '--apply' in sys.argv
IN_ACTIONS = os.environ.get('GITHUB_ACTIONS') == 'true'
NL = '\n'
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(errors='replace')

SUFFIX = '｜柴原研究室｜大阪大学 接合科学研究所'                               # タブに出る題名の後ろに付ける文字
SITE_URL = 'https://jwri-uo.github.io/shiba-lab/'                           # サイトの場所。別のサーバーや独自ドメインへ移したら、ここを直す
SEARCH = False                                                              # 検索に出すか。False の間は、全ページに検索よけを付ける。True にすると外れ、サイトマップも作る
DESCRIPTION = '大阪大学 接合科学研究所 柴原研究室のホームページです。'           # 本文の無いページの説明文
PEOPLE = {'member.html', 'ob.html', 'presentations.html', 'awards.html', 'themes.html', 'photos.html', 'cooperation.html', 'papers.html'}   # 人の名前や写真が中心のページと、頭に発明者・著者の名前が並ぶページ。共有したときの説明文に名前が出ないよう、決まった文にする
SKIP = ('hinagata-',)                                                       # ひな形。お知らせの一覧などには入れない
ANCHORS = ('fem.html', 'facility.html')                                     # 小見出しも「関連するページ」の候補にするページ
NO_RELATED = {'index.html', 'research.html', 'news.html', 'access.html'}    # 「関連するページ」の候補にしないページ
FUTURE = datetime.timedelta(days=366)                                       # これより先の日付のお知らせは、打ち間違いとして止める
THUMB_STYLE = ('v1', 82)                                                    # 小さな画像の作り方の版と画質。変えると全部作り直される
TEMPLATE_WORDS = ('ここに題名を書きます', 'ここに本文を書きます', '写真は img フォルダに入れて', 'alt="写真の説明"')   # ひな形の見本の文
HEAD_MARK = '<!-- この下は、このページだけの行 -->'                           # 枠の <head> の中で、これより下がページごとの行
REGIONS = ('メニュー', 'ページ一覧', 'トップの写真', '新着', 'お知らせ一覧', '前後の記事', '関連')
NEWS_REGIONS = ('新着', 'お知らせ一覧', '前後の記事', '関連')                # お知らせから作る所。お知らせに問題があるあいだは前のまま
PLACEHOLDERS = ('{{題名}}', '{{自動の行}}', '{{このページだけの行}}', '{{帯}}', '{{本文}}')

NEWS_NAME = re.compile(r'news-[0-9a-z]+(?:-[0-9a-z]+)*\.html')             # お知らせのファイル名の決まり
LOOKS_NEWS = re.compile(r'(?i)news[-_ 　]')                             # お知らせのつもりらしい名前
THUMB_NAME = re.compile(r'n[st]-[^/\\]+\.jpg')                             # 自動で作る小さな画像の名前
DATE_RX = re.compile(r'<p\b[^>]*\bclass\s*=\s*["\']?[^"\'>]*?\bnews__date\b[^>]*>(?:\s|&nbsp;|<(?!/p\b)[^>]*>)*'
                     r'(\d{4})\s*[.．/／\-－年]\s*(\d{1,2})\s*[.．/／\-－月]\s*(\d{1,2})', re.I)
TITLE_RX = re.compile(r'<h2\b[^>]*\bclass\s*=\s*["\']?[^"\'>]*?\bnews__title\b[^>]*>(.*?)</h2\s*>', re.S | re.I)
H1_RX = re.compile(r'<h1\b[^>]*\bclass\s*=\s*["\']?[^"\'>]*?\bphero__ttl\b[^>]*>(.*?)</h1\s*>', re.S | re.I)
OPEN_RX = re.compile(r'<!-- 自動:(\S+?)(?: ([^>]*?))? -->')
CLOSE_RX = re.compile(r'<!-- /自動:(\S+) -->')
SEQ_RX = re.compile(r'<!-- (/?)自動:(\S+?)(?: [^>]*?)? -->')
LOOSE_RX = re.compile(r'<!--\s*/?\s*自動\s*[:：]')
AUTO_LINE = re.compile(r'\s*(?:</|<(?:li|ul|h2|nav|aside|details|summary|section|div|a|figure)\b|<p class="news__nav">|<p>関連するお知らせは|<p>新しい15件)')   # 自動で作る行の頭
AUTO_RX = re.compile(r'<meta\b[^>]*\b(?:name\s*=\s*["\']?(?:description|robots|twitter:[\w:]*)|property\s*=\s*["\']?og:)|<base\b', re.I)   # 自動で付け直す行
DROP_HEAD = re.compile(r'<meta\s+(?:charset|name=["\']?(?:generator|viewport)\b|http-equiv=["\']?content-type)', re.I)   # 枠にある行や、ホームページ・ビルダーが足すことのある行は捨てる

PROBLEMS = []        # (ファイル, 何が起きたか, どう直すか)
WARNINGS = []        # (ファイル, 何が起きたか)
LISTING = {}         # フォルダ → その中のファイル名（大文字と小文字を区別して確かめるため）
THUMBS = {}          # (記事, 頭の文字) → 小さな画像の名前
DROPPED = {}         # <head> の印より上にあって枠に無かったので消した行 → そのページ


class Stop(Exception):
    """全ページに響く問題。何も書かずに止める"""


def problem(f, what, how):
    """直す必要のある所を覚えておく（同じものは1回だけ）。最後にまとめて出し、終了コード 2 にする"""
    if any(p[0] == f and p[1] == what for p in PROBLEMS):
        return
    PROBLEMS.append((f, what, how))
    if IN_ACTIONS:
        print(f'::error file={f}::{what} {how}')


def warn(f, what):
    """止めるほどではない注意。Actions の画面に黄色で出る"""
    if any(w == (f, what) for w in WARNINGS):
        return
    WARNINGS.append((f, what))
    print(f'::warning file={f}::{what}' if IN_ACTIONS else f'  注意 {f}: {what}')


def exists(path):
    """ファイルがあるか。Windows でも大文字と小文字を区別する（公開先の GitHub は区別するため）"""
    d, b = os.path.split(path)
    d = d or '.'
    if d not in LISTING:
        LISTING[d] = set(os.listdir(d)) if os.path.isdir(d) else set()
    return b in LISTING[d] and os.path.isfile(path)


def in_git(path):
    """手元に無くても、リポジトリには入っているか（Actions では files/ を取ってこないため）"""
    try:
        r = subprocess.run(['git', 'ls-tree', '--name-only', 'HEAD', '--', path], capture_output=True, text=True, encoding='utf-8')
        return r.returncode == 0 and r.stdout.strip() == path
    except OSError:
        return False


def read(f):
    """UTF-8 のファイルを読む。改行は LF にそろえる。UTF-8 でなければ問題として覚えて None"""
    try:
        s = open(f, 'rb').read().decode('utf-8')
    except UnicodeDecodeError:
        problem(f, 'UTF-8 で保存されていません。', 'ホームページ・ビルダーやエディタで、文字コードを UTF-8 にして保存し直してください。')
        return None
    except OSError as e:
        problem(f, f'読めません（{e}）。', 'ファイルが開かれたままになっていないか確かめてください。')
        return None
    return s.lstrip('﻿').replace('\r\n', NL).replace('\r', NL)


def masked(s):
    """コメントの中身を同じ長さの空白にした写し。コメントに書かれた <main> などに惑わされないように、位置はそのまま"""
    return re.sub(r'<!--.*?-->', lambda m: ' ' * len(m.group(0)), s, flags=re.S)


def find_main(s):
    """<main ...> と </main> の位置。コメントの中は見ない。1組でなければ None"""
    m = masked(s)
    opens = list(re.finditer(r'<main\b[^>]*>', m, re.I))
    closes = list(re.finditer(r'</main\s*>', m, re.I))
    if len(opens) != 1 or len(closes) != 1 or closes[0].start() < opens[0].end():
        return None
    return opens[0], closes[0]


def norm(line):
    return re.sub(r'\s+', ' ', line.strip()).lower()


def plain(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def join_lines(s):
    """題名の途中の改行を詰める。日本語の字の間は詰め、それ以外は空白1つにする"""
    s = re.sub(r'(?<=[^\x00-\x7f])[ \t]*\n\s*(?=[^\x00-\x7f])', '', s)
    return re.sub(r'\s*\n\s*', ' ', s)


def text_of(s):
    """題名などの文字だけを取り出して、HTML に入れられる形にする（<br> を改行にしてタグを外し、改行を詰める）"""
    s = re.sub(r'<br\b[^>]*>', NL, s, flags=re.I)
    return html.escape(re.sub(r'[ \t]+', ' ', html.unescape(re.sub(r'<[^>]+>', '', join_lines(s)))).strip(), quote=False)


def short(s, n):
    """n 字より長い文を、n 字に収まるよう切って「…」を付ける"""
    return s if len(s) <= n else s[:n - 1].rstrip() + '…'


def fold(s):
    """関連の言葉と題名を比べるときの形（全角と半角、部首の字などをそろえる）"""
    return unicodedata.normalize('NFKC', html.unescape(s))


def words_of(w):
    """関連の言葉を「言葉|言葉」の形にそろえる（| の両側の空白を外す）"""
    return '|'.join(x.strip() for x in w.strip().split('|'))


# ---- 枠とメニュー（問題があれば Stop）

def read_frame():
    s = read('_frame/frame.html')
    if s is None:
        raise Stop('_frame/frame.html が UTF-8 で保存されていません。')
    for p in PLACEHOLDERS:
        if s.count(p) != 1:
            raise Stop(f'_frame/frame.html の {p} が {s.count(p)} 個あります（ちょうど1個必要）。消したり増やしたりした所を元に戻してください。')
    mm = find_main(s)
    if not mm or mm[0].group(0) != '<main>' or s[mm[0].end():mm[1].start()] != '\n{{本文}}\n':
        raise Stop('_frame/frame.html の <main>、{{本文}}、</main> は、この3行をそのまま並べてください。<main> と </main> はほかに書かず、<main> に何も足さないでください。')
    hm = re.search(r'<head>(.*?)</head>', s, re.S)
    if not hm:
        raise Stop('_frame/frame.html に <head> … </head> が見つかりません。')
    if hm.group(1).count(HEAD_MARK) != 1 or HEAD_MARK + NL + '{{このページだけの行}}' not in hm.group(1):
        raise Stop(f'_frame/frame.html の <head> の中の {{{{このページだけの行}}}} のすぐ上に、{HEAD_MARK} の行を1つだけ置いてください。')
    return s, {norm(l) for l in hm.group(1).split(NL) if l.strip()}


def read_menu():
    """_frame/menu.txt を読む。戻り値は (上の帯の項目, [(分類の名前, 項目の並び)])"""
    s = read('_frame/menu.txt')
    if s is None:
        raise Stop('_frame/menu.txt が UTF-8 で保存されていません。')
    bar, groups, cur = [], [], None
    for no, line in enumerate(s.split(NL), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        m = re.fullmatch(r'\[(.+)\]', line)
        if m:
            cur = m.group(1).strip()
            if cur != '帯':
                groups.append((cur, []))
            continue
        p = [x.strip() for x in line.split('|')]
        if cur is None or len(p) < 3 or not all(p[:3]):
            raise Stop(f'_frame/menu.txt の {no} 行目が読めません:「{line}」。「題名 | ファイル名 | アイコン」の順に書き、上に [分類の名前] の行を置いてください。')
        target = p[1].split('#', 1)[0]
        if not re.match(r'[A-Za-z][A-Za-z0-9+.-]*:', p[1]) and target and not exists(target) and not in_git(target):
            raise Stop(f'_frame/menu.txt の {no} 行目のファイル「{p[1]}」がありません。ファイル名の打ち間違い（大文字と小文字も区別されます）か、ファイルを足し忘れていないか確かめてください。')
        item = {'title': p[0], 'file': p[1], 'icon': p[2], 'flag': p[3] if len(p) > 3 else ''}
        (bar if cur == '帯' else groups[-1][1]).append(item)
    if not bar or not groups:
        raise Stop('_frame/menu.txt に [帯] の項目か、左のメニューの分類がありません。')
    return bar, groups


def bar_current(name):
    """上の帯で印を付ける項目。お知らせの記事は「お知らせ」、研究テーマは「研究内容」"""
    if name.startswith('news-'):
        return 'news.html'
    if name.startswith('theme-'):
        return 'research.html'
    return name


def side_current(name):
    """左のメニューで印を付ける項目。研究動画の下位ページは「研究動画」、OB・OGリストは「メンバー紹介」"""
    if name.startswith('movies-'):
        return 'movies.html'
    return {'ob.html': 'member.html'}.get(name, name)


def side_open(name):
    """左のメニューに無いページで、開いておく分類"""
    return '研究' if name in ('research.html', 'lineheat.html') or name.startswith('theme-') else None


def link(it):
    return f'<a href="{it["file"]}"><i class="fa {it["icon"]}"></i>{it["title"]}</a>'


def bar_html(name):
    cur = bar_current(name)
    li = ''.join(f'      <li{" class=" + chr(34) + "is-current" + chr(34) if it["file"] == cur else ""}>{link(it)}</li>' + NL for it in BAR)
    return '<nav class="gn">\n    <ul>\n' + li + '    </ul>\n  </nav>'


def side_html(name):
    cur, opened = side_current(name), side_open(name)
    if opened is None and not any(it['file'] == cur for _, its in GROUPS for it in its):   # どの分類にも無いページ（お知らせなど）では、最初の分類を開いておく
        opened = GROUPS[0][0]
    out = '<aside class="side" id="pages" aria-label="ページの一覧">\n'
    for title, items in GROUPS:
        is_open = title == opened or any(it['file'] == cur for it in items)
        out += f'      <details class="side__grp" name="side"{" open" if is_open else ""}><summary>{title}</summary>\n        <ul>\n'
        for it in items:
            a = link(it).replace('">', '" class="is-current" aria-current="page">', 1) if it['file'] == cur else link(it)
            out += f'          <li>{a}</li>\n'
        out += '        </ul>\n      </details>\n'
    return out + '    </aside>\n    <div class="skip-to" id="honbun" tabindex="-1"></div>'   # 枠の「本文へ移動」の飛び先（メニューの後ろ）


def top_list_html():
    """トップの写真の上の一覧（タイルで出しているページと「下層のみ」のページは除く）"""
    items = [it for _, its in GROUPS for it in its if not it['flag']]
    return '<ul>\n' + ''.join(f'        <li>{link(it)}</li>\n' for it in items) + '      </ul>'


TOP_FILE = '_frame/top.txt'
TOP_PICTURE = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
TOP_VIDEO = ('.mp4', '.webm')


def read_top():
    """_frame/top.txt（トップの写真と動画の並び）を読み、写真の帯の中身を作る。
    読めない行や無いファイルがあれば、問題として覚えて None を返す（トップの写真の帯は前のままにする）"""
    if not exists(TOP_FILE):
        return None
    s = read(TOP_FILE)
    if s is None:
        return None
    how = '1行に1つ、「ファイルの名前 | 説明」の順に半角の | で区切って書きます。3つ目からは「位置 50% 40%」「スマホ 30% 50%」「10秒」「メニューの左」「全体」を書けます（無くても構いません）。'
    items = []
    for no, line in enumerate(s.split(NL), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        p = [x.strip() for x in line.split('|')]
        if len(p) < 2 or not p[0] or not p[1]:
            problem(TOP_FILE, f'{no} 行目が読めません:「{line}」。', how)
            return None
        path = p[0]
        if not path.lower().endswith(TOP_PICTURE + TOP_VIDEO):
            problem(TOP_FILE, f'{no} 行目の「{path}」は、写真（.jpg .png .webp .gif）か動画（.mp4 .webm）のファイルではありません。', how)
            return None
        if not exists(path) and not in_git(path):
            problem(TOP_FILE, f'{no} 行目のファイル「{path}」がありません。', 'img フォルダに入れたか、名前の打ち間違い（大文字と小文字も区別されます）がないか確かめてください。')
            return None
        opt = {'pos': '', 'sp': '', 'sec': '', 'bg': '', 'whole': False}
        for o in p[2:]:
            o = re.sub(r'[ 　]+', ' ', o)
            m = re.fullmatch(r'(位置|スマホ) (\d{1,3})% ?(\d{1,3})%', o)
            if m and int(m.group(2)) <= 100 and int(m.group(3)) <= 100:
                opt['pos' if m.group(1) == '位置' else 'sp'] = f'{m.group(2)}% {m.group(3)}%'
                continue
            m = re.fullmatch(r'(\d{1,3}(?:\.\d)?) ?秒', o)
            if m and 1 <= float(m.group(1)) <= 120:
                opt['sec'] = m.group(1)
                continue
            if o == 'メニューの左':   # PC では写真を右のメニューの左に収め、帯いっぱいにはぼかした背景を敷く（右のメニューに顔や写真がかからない）
                bg = re.sub(r'\.[^./]+$', '-bg.jpg', path)
                if not exists(bg) and not in_git(bg):
                    problem(TOP_FILE, f'{no} 行目は「メニューの左」ですが、ぼかした背景「{bg}」がありません。', 'Top画像の台本で作った 〜-bg.jpg も img に入れてください。要らなければ「メニューの左」を消します。')
                    return None
                opt['bg'] = bg
                continue
            if o == '全体':   # 「メニューの左」の範囲に、写真の全部を入れる（横に長い集合写真など。上下はぼかした背景）
                opt['whole'] = True
                continue
            if o:
                problem(TOP_FILE, f'{no} 行目の「{o}」が読めません。', how)
                return None
        items.append((path, p[1], opt))
    if not items:
        problem(TOP_FILE, '写真が1つもありません。', '「ファイルの名前 | 説明」の行を1つ以上書いてください。')
        return None
    return top_html(items)


def top_html(items):
    """トップの写真の帯の中身。1つ目はすぐ読む（ほかは fx.js がページを読み終えてから読む）"""
    out = []
    for i, (path, alt, opt) in enumerate(items):
        cls = 'hero__slide' + (' is-on' if i == 0 else '') + (' is-collage' if opt['bg'] else '') + (' is-whole' if opt['whole'] else '')
        fig = f'<figure class="{cls}"'
        if opt['bg']:
            fig += f' style="background-image: url({opt["bg"]})"'
        if opt['sec']:
            fig += f' data-sec="{opt["sec"]}"'
        style = '; '.join(x for x in (f'--pos: {opt["pos"]}' if opt['pos'] else '', f'--sp: {opt["sp"]}' if opt['sp'] else '') if x)
        st = f' style="{style}"' if style else ''
        src = ('src' if i == 0 else 'data-src') + '="' + html.escape(path) + '"'
        a = html.escape(alt)
        if path.lower().endswith(TOP_VIDEO):
            pre = 'auto' if i == 0 else 'none'
            media = f'<video {src} muted loop playsinline preload="{pre}" aria-label="{a}"{st}></video>'
        else:
            first = ' fetchpriority="high"' if i == 0 else ''
            media = f'<img {src} alt="{a}"{st}{first}>'
        out.append(f'      {fig}>{media}</figure>')
    return NL.join(out)


# ---- お知らせ

def first_picture(f, seg):
    """記事の本文から、小さな画像の元にする写真を選ぶ。img/ の中の、小さすぎない最初の写真"""
    for m in re.finditer(r'<img\b[^>]*?\bsrc\s*=\s*["\']?([^"\'\s>]+)', seg, re.I):
        path = urllib.parse.unquote(m.group(1))
        path = path[2:] if path.startswith('./') else path
        if not path.startswith('img/'):
            continue
        w = re.search(r'\bwidth\s*=\s*["\']?(\d+)', m.group(0), re.I)
        if w and int(w.group(1)) < 64:
            continue
        if not exists(path):
            warn(f, f'本文の写真 {path} が見つかりません。')
            continue
        try:
            with Image.open(path) as im:
                if min(im.size) < 100:   # 絵文字や小さな印は飛ばす
                    continue
        except Exception:
            warn(f, f'本文の写真 {path} を画像として開けません。')
            continue
        return path
    return None


def read_news(pages):
    """news-〜.html を全部読んで、新しい順に並べる。戻り値は (記事の並び, 問題のあった記事の名前)"""
    out, bad = [], set()
    for f in pages:
        if f.startswith(SKIP) or not LOOKS_NEWS.match(f):
            continue
        if not NEWS_NAME.fullmatch(f):
            problem(f, 'お知らせのファイル名に、使えない文字（大文字・空白・日本語・「コピー」など）があります。',
                    'news-20261120.html のように、news- の後ろを半角の小文字と数字にして付け直してください。')
            bad.add(f)
            continue
        s = read(f)
        if s is None:
            bad.add(f)
            continue
        sc = re.sub(r'<!--(?!\s*/?\s*自動\s*[:：]).*?-->', '', s, flags=re.S)   # コメントにして隠した所は見ない
        d, t = DATE_RX.search(sc), TITLE_RX.search(sc)
        if not d and not t:
            problem(f, 'news- で始まる名前は、お知らせの記事に使う名前です。', 'お知らせでないページなら名前を news- 以外にし、お知らせなら hinagata-news.html を写して作ってください。')
            bad.add(f)
            continue
        if not d:
            problem(f, '日付が読めません。', '<p class="news__date">2026.11.20<span class="cards__cat">報告</span></p> のように、数字と点は半角で、年.月.日 の形で書いてください。')
            bad.add(f)
            continue
        if not t or not plain(t.group(1)):
            problem(f, '題名が読めません。', '<h2 class="news__title">題名</h2> の行を書いてください。')
            bad.add(f)
            continue
        try:
            date = datetime.date(*(int(x) for x in d.groups()))
        except ValueError:
            problem(f, f'日付 {".".join(d.groups())} は、ありえない日付です。', '月と日を確かめてください。')
            bad.add(f)
            continue
        if date > datetime.date.today() + FUTURE:
            problem(f, f'日付 {date:%Y.%m.%d} が1年以上先になっています。', '年の打ち間違いがないか確かめてください。')
            bad.add(f)
            continue
        mm = find_main(sc)
        main_text = sc[mm[0].end():mm[1].start()] if mm else sc   # 頭の説明文の行には古い文が残っていることがあるので、本文だけを見る
        left = [w for w in TEMPLATE_WORDS if w in main_text]
        if left:
            problem(f, f'ひな形の見本（「{left[0]}」など）が残っています。', '日付・題名・本文を書き換えてください。写真を使うときは src を自分の写真に、alt="写真の説明" を写真の説明に書き換え、使わないときは見本の写真の行を消してください。')
            bad.add(f)
            continue
        fm = re.fullmatch(r'news-(\d{4})(\d{2})(\d{2})(?:[a-z]|-\d+)?\.html', f)
        try:
            fdate = datetime.date(*map(int, fm.groups())) if fm else None
        except ValueError:
            fdate = None
        if fdate and fdate != date:
            warn(f, f'ファイル名の日付 {fdate:%Y.%m.%d} と本文の日付 {date:%Y.%m.%d} が違います。どちらかの打ち間違いではないか確かめてください。')
        pm = re.compile(r'</p\s*>', re.I).search(sc, d.end())
        cats = re.findall(r'<span\b[^>]*\bclass\s*=\s*["\']?cards__cat\b[^>]*>(.*?)</span\s*>', sc[d.start():pm.start() if pm else d.end()], re.S | re.I)
        raw = join_lines(t.group(1).strip())
        if re.search('[⺀-⿟]', raw):
            warn(f, '題名に部首の字（⻄、⽀ など）が混ざっています。ふつうの字（西、支）に直すと、検索や関連の一覧で見つかりやすくなります。')
        end = sc.find('<p class="doc__src">', t.end())
        out.append({'file': f, 'key': f[5:-5], 'date': date, 'title': raw if '<' not in raw else text_of(raw),
                    'plain': plain(raw), 'cats': cats, 'first': first_picture(f, sc[t.end():end if end > 0 else len(sc)])})
    out.sort(key=lambda n: (n['date'], n['file'][:-5]), reverse=True)
    seen = {}
    for n in out:
        k = (n['date'], n['plain'])
        if k in seen:
            warn(n['file'], f'{seen[k]} と日付も題名も同じです。同じ記事が2つ載っていないか確かめてください。')
        seen.setdefault(k, n['file'])
    return out, bad


def cut(n, prefix, size):
    """記事の最初の写真から、決まった大きさの小さな画像を作って名前を返す。
    名前に、元の写真の中身と作り方から作った印（8文字）を入れるので、どちらかが変われば別の名前で作り直される。図の無い記事は None"""
    if not n['first']:
        return None
    k = (n['file'], prefix)
    if k not in THUMBS:
        name = None
        try:
            data = open(n['first'], 'rb').read()
            name = f'img/{prefix}{n["key"]}-{hashlib.md5(data + repr((size, THUMB_STYLE)).encode()).hexdigest()[:8]}.jpg'
            if not exists(name):
                im = Image.open(io.BytesIO(data))
                im.draft('RGB', (size[0] * 2, size[1] * 2))
                im = ImageOps.exif_transpose(im)
                if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
                    im = im.convert('RGBA')
                    bg = Image.new('RGB', im.size, 'white')
                    bg.paste(im, mask=im.split()[3])
                    im = bg
                im = ImageOps.fit(im.convert('RGB'), size, centering=(0.5, 0.35))
                if APPLY:
                    im.save(name, 'JPEG', quality=THUMB_STYLE[1])
                    LISTING['img'].add(os.path.basename(name))
        except Exception as e:
            warn(n['file'], f'小さな画像を作れませんでした（{e}）。一覧には書類の印を出します。')
            name = None
        THUMBS[k] = name
    return THUMBS[k]


def meta(n):
    return n['date'].strftime('%Y.%m.%d') + ''.join(f'<span class="cards__cat">{x}</span>' for x in n['cats'])


def row(n):
    """お知らせの一覧の1行（左に小さな画像。図の無い記事は書類の印）"""
    pic = cut(n, 'ns-', (320, 180))
    img = (f'<img class="newslist__pic" src="{pic}" alt="" loading="lazy" width="160" height="90">' if pic
           else '<span class="newslist__pic newslist__pic--none"><i class="fa fa-file-text-o"></i></span>')
    return f'<li><a href="{n["file"]}">{img}<span class="newslist__meta">{meta(n)}</span><span class="newslist__ttl">{n["title"]}</span></a></li>\n'


def latest_html(news):
    out = ''
    for n in news[:6]:
        pic = cut(n, 'nt-', (800, 380)) or 'img/tile-alt-torch.jpg'
        out += (f'      <li><a href="{n["file"]}"><img src="{pic}" alt="" loading="lazy" decoding="async"><div class="cards__body"><p class="cards__meta">{meta(n)}</p>'
                f'<p class="cards__ttl">{n["title"]}</p></div></a></li>\n')
    return out.rstrip(NL)


def list_html(news):
    years = sorted({n['date'].year for n in news}, reverse=True)
    out = '<nav class="doc__toc" aria-label="年ごとの目次"><ul>' + ''.join(f'<li><a href="#y{y}">{y}年</a></li>' for y in years) + '</ul></nav>\n'
    for y in years:
        items = [n for n in news if n['date'].year == y]
        out += f'<h2 id="y{y}">{y}年<small>（{len(items)}件）</small></h2>\n<ul class="newslist">\n' + ''.join(row(n) for n in items) + '</ul>\n'
    return out.rstrip(NL)


def nav_html(news, name):
    k = next((i for i, n in enumerate(news) if n['file'] == name), None)
    if k is None:
        return '<p class="news__nav"><span></span><a href="news.html">一覧へ</a><span></span></p>'
    newer = f'<a href="{news[k - 1]["file"]}"><i class="fa fa-chevron-left"></i>新しい記事</a>' if k else '<span></span>'
    older = f'<a href="{news[k + 1]["file"]}">古い記事<i class="fa fa-chevron-right"></i></a>' if k + 1 < len(news) else '<span></span>'
    return f'<p class="news__nav">{newer}<a href="news.html">一覧へ</a>{older}</p>'


def related_html(news, spots, words):
    rx = word_rx(words)
    rel = [(h, t) for h, t in spots if rx.search(fold(t))]
    hit = [n for n in news if rx.search(fold(n['title']))]
    out = ''
    if rel:
        out += '<h2>関連するページ</h2>\n<ul class="newslist">\n' + ''.join(f'<li><a href="{h}"><span class="newslist__ttl">{html.escape(t, quote=False)}</span></a></li>\n' for h, t in rel) + '</ul>\n'
    out += f'<h2>関連するお知らせ<small>（題名から自動で集めたもの。{len(hit)}件）</small></h2>\n'
    if not hit:
        return out + '<p>関連するお知らせは、まだありません。</p>'
    out += '<ul class="newslist">\n' + ''.join(row(n) for n in hit[:15]) + '</ul>'
    if len(hit) > 15:
        out += '\n<p>新しい15件を表示しています。すべてのお知らせは<a href="news.html">一覧</a>から見られます。</p>'
    return out


def word_rx(words):
    """関連の言葉から、題名を探す式を作る。言葉は記号も含めてそのままの文字として探す。
    (? で始まる言葉だけは式として使う（theme-04 の「前後が英字でない AI」など。その中には | を書かない）"""
    return re.compile('|'.join(w if w.startswith('(?') else re.escape(w) for w in fold(words).split('|')))


def check_words(f, words, news):
    """研究テーマの「関連」の言葉が使えるか。だめなら問題として覚えて False"""
    if not words or any(not w for w in fold(words).split('|')):
        problem(f, '目印 <!-- 自動:関連 … --> の言葉が空です。', '「溶接|接合」のように、言葉を半角の | で区切って書いてください。')
        return False
    try:
        rx = word_rx(words)
    except re.error:
        problem(f, f'目印 <!-- 自動:関連 … --> の言葉「{words}」の、(? で始まる式が読めません。', '式を使わずに、言葉だけを | で区切って書いてください。')
        return False
    if len(news) >= 20 and sum(1 for n in news if rx.search(fold(n['title']))) >= 0.9 * len(news):
        problem(f, f'目印 <!-- 自動:関連 … --> の言葉「{words}」が、ほとんど全部のお知らせに当てはまります。', '言葉が短すぎないか、(? で始まる式が何にでも当てはまらないか確かめてください。')
        return False
    return True


# ---- ページ

def region(body, name, new):
    """<!-- 自動:name --> と <!-- /自動:name --> の間を new に差し替える。目印が無いページでは何もしない"""
    return re.sub(r'(<!-- 自動:' + name + r' -->)\n?.*?\n?([ \t]*<!-- /自動:' + name + ' -->)', lambda m: m.group(1) + NL + new + NL + m.group(2), body, flags=re.S)


def check_marks(f, body):
    """目印の書き方と、開く側・閉じる側の組と順番を確かめる。問題があれば覚えて False"""
    seq = SEQ_RX.findall(body)
    if len(LOOSE_RX.findall(body)) != len(seq):
        problem(f, '自動の目印の書き方が崩れている所があります。', '<!-- 自動:メニュー --> のように、空白と半角の「:」もそのまま書いてください（目印は消したり変えたりしない）。')
        return False
    for slash, name in seq:
        if name not in REGIONS:
            problem(f, f'知らない目印「{name}」があります。', f'使える目印は {"・".join(REGIONS)} です。')
            return False
    for i in range(0, len(seq), 2):
        if seq[i][0] or i + 1 >= len(seq) or seq[i + 1] != ('/', seq[i][1]):
            problem(f, '自動の目印の順番が崩れています。', '<!-- 自動:名前 --> の次の目印は、同じ名前の <!-- /自動:名前 --> にしてください（消してしまった目印を戻すか、重なった目印を1つにする）。')
            return False
    for name in REGIONS:
        n = sum(1 for slash, x in seq if x == name and not slash)
        if n > 1 and name != '関連':
            problem(f, f'目印「{name}」が {n} 組あります（1組だけにする）。', '重なった目印を1つにしてください。')
            return False
    return True


def keep_writing(f, body, name):
    """目印の間に、自動では作らない形の行があれば、消えることを知らせる"""
    for m in re.finditer(r'<!-- 自動:' + name + r'(?: [^>]*?)? -->\n?(.*?)\n?[ \t]*<!-- /自動:' + name + ' -->', body, re.S):
        for l in m.group(1).split(NL):
            if l.strip() and not AUTO_LINE.match(l):
                warn(f, f'自動の目印「{name}」の間に書いた文「{plain(l)[:40]}」は、{"作り直したので消えました" if APPLY else "作り直すと消えます"}。'
                        '残したい文は目印の外に書いてください（消える前の版は GitHub の履歴に残っています）。')
                break


def read_spots():
    """「関連するページ」の候補: メニューにあるページの題名、研究動画の下位ページの題名、ANCHORS のページの小見出し"""
    spots = [(it['file'], it['title']) for it in BAR + [i for _, its in GROUPS for i in its] if it['file'] not in NO_RELATED and not re.match(r'[A-Za-z][A-Za-z0-9+.-]*:', it['file'])]
    for f in sorted(x for x in os.listdir('.') if re.fullmatch(r'movies-[0-9a-z-]+\.html', x)):
        t = H1_RX.search(read(f) or '')
        if t:
            spots.append((f, plain(re.sub(r'<small\b.*?</small>', '', t.group(1), flags=re.S | re.I))))
    for f in ANCHORS:
        if exists(f):
            spots += [(f + '#' + i, plain(h)) for i, h in re.findall(r'<h3\b[^>]*\bid=["\']?(t\d+)["\']?[^>]*>(.*?)</h3\s*>', read(f) or '', re.S | re.I)]
    return spots


def describe(name, body):
    """検索や共有のときに出る説明文。本文の頭の100字ほど。本文が無いページと、人が中心のページは決まった文"""
    if name in PEOPLE:
        return DESCRIPTION
    body = re.sub(r'<!-- 自動:(\S+?)(?: [^>]*?)? -->.*?<!-- /自動:\1 -->', ' ', body, flags=re.S)   # 自動で作った一覧は説明文にしない
    art = re.search(r'<article class="doc[^"]*">(.*?)</article>', body, re.S)
    if art:
        t = re.sub(r'<nav class="doc__toc".*?</nav>|<summary>.*?</summary>|<p class="(?:doc__lead|news__date|news__nav|doc__src)">.*?</p>'
                   r'|<h2 class="news__title">.*?</h2>|<!--.*?-->', ' ', art.group(1), flags=re.S)
        t = plain(t)
        if len(t) >= 20:
            return t[:100] + ('…' if len(t) > 100 else '')
    return DESCRIPTION


def auto_head(name, title, body, by_file):
    """<head> の中の、自動で付ける行（説明文、共有したときの題名・画像、検索よけなど）"""
    n = by_file.get(name)
    desc = html.escape(describe(name, body), quote=True)
    pic = n['first'] if n and n['first'] else 'img/ogp.jpg'
    lines = []
    if name == '404.html':   # どの場所から開かれても部品を読めるように、サイトの場所を基準にする
        lines.append(f'<base href="{SITE_URL}">')
    lines += [f'<meta name="description" content="{desc}">',
              f'<meta property="og:title" content="{html.escape(html.unescape(title), quote=True)}">',
              f'<meta property="og:description" content="{desc}">',
              f'<meta property="og:type" content="{"article" if n else "website"}">',
              f'<meta property="og:url" content="{SITE_URL}{"" if name == "index.html" else name}">',
              f'<meta property="og:image" content="{SITE_URL}{pic}">',
              f'<meta property="og:site_name" content="{SUFFIX.lstrip("｜")}">',
              '<meta name="twitter:card" content="summary_large_image">']
    if SEARCH and name != '404.html' and not name.startswith(SKIP):
        lines.append(f'<link rel="canonical" href="{SITE_URL}{"" if name == "index.html" else name}">')
    else:
        lines.append('<meta name="robots" content="noindex">')
    return ''.join(l + NL for l in lines)


def rebuild(name, s, ctx):
    """1ページを作り直して返す。<main> の中の人が書いた所と、そのページだけの読み込みは、そのまま残す。
    問題があれば覚えて None（そのページは前のまま）"""
    hm = re.search(r'<head\b[^>]*>(.*?)</head\s*>', s, re.S | re.I)
    if not hm:
        problem(name, '<head> … </head> が見つかりません。', 'ひな形（hinagata-page.html）を見て、<head> の行を戻してください。')
        return None
    mm = find_main(s)
    if not mm:
        problem(name, '<main> … </main> が見つからないか、2組以上あります。', '本文を <main> と </main> の間に1組だけ置いてください（コメントの中は数えません）。')
        return None
    body = re.sub(r'\n[ \t]*\Z', '', re.sub(r'\A[ \t]*\n', '', s[mm[0].end():mm[1].start()]))
    if not check_marks(name, body):
        return None
    for w in OPEN_RX.findall(body):
        if w[0] == '関連' and not check_words(name, words_of(w[1] or ''), ctx['news']):
            return None
    have = {x for _, x in SEQ_RX.findall(body)}
    if name not in ('index.html', '404.html') and not name.startswith(SKIP) and 'メニュー' not in have:
        warn(name, '左のメニューの目印 <!-- 自動:メニュー --> が無いので、このページのメニューは作り直されません。')
    if NEWS_NAME.fullmatch(name) and '前後の記事' not in have:
        warn(name, '目印 <!-- 自動:前後の記事 --> が無いので、記事の下の前後のリンクは作り直されません。')
    head = hm.group(1)
    tm = re.search(r'<title\b[^>]*>(.*?)</title\s*>', head, re.S | re.I)
    title = text_of(tm.group(1)) if tm else SUFFIX.lstrip('｜')
    head = re.sub(r'<title\b.*?</title\s*>', '', head, flags=re.S | re.I)
    head = re.sub(r'<(?:meta|link|base|script)\b[^>]*>', lambda m: ' '.join(m.group(0).split()), head, flags=re.I)   # 途中で改行したタグは1行に
    if HEAD_MARK in head:   # 印より下が、このページだけの行。上は枠の行なので捨てる（枠から外した行がページに残らないように）
        above, head = head.split(HEAD_MARK, 1)
        for l in above.split(NL):
            l = l.strip()
            if l and norm(l) not in ctx['frame_head'] and not DROP_HEAD.match(l) and not AUTO_RX.match(l):
                DROPPED.setdefault(l, []).append(name)
    extra = []
    for line in head.split(NL):
        l = line.strip()
        if not l or norm(l) in ctx['frame_head'] or DROP_HEAD.match(l) or AUTO_RX.match(l):
            continue
        if SEARCH and re.match(r'<link\b[^>]*\brel=["\']?canonical', l, re.I):   # 検索に出すときは、正本の場所をこのサイト自身にする
            continue
        if l in extra and re.match(r'<(?:link|meta|base)\b|<script\b[^>]*\bsrc\s*=', l, re.I):   # 同じ読み込みが2回あれば1つにする
            continue
        extra.append(l if l.startswith('<') else line.rstrip())   # <style> などの中身は字下げを残す
    # タブに出る題名は、ページの見出しから付ける（お知らせは記事の題名、ほかは大きな見出し）。見出しの無いページは今の題名のまま
    art = TITLE_RX.search(body) if name.startswith('news-') else None
    h1 = H1_RX.search(body)
    h1_text = text_of(re.sub(r'<small\b.*?</small>', '', h1.group(1), flags=re.S | re.I)) if h1 else ''
    if art and text_of(art.group(1)):
        title = html.escape(short(html.unescape(text_of(art.group(1))), 60), quote=False) + SUFFIX   # 文字に戻してから切る（&amp; の途中で切らない）
    elif h1_text:
        title = h1_text + SUFFIX
    for name_r in REGIONS:
        keep_writing(name, body, name_r)
    body = region(body, 'メニュー', '    ' + side_html(name))
    body = region(body, 'ページ一覧', ctx['top_list'])
    if ctx['top'] is not None:
        body = region(body, 'トップの写真', ctx['top'])
    if not ctx['frozen']:
        body = region(body, '新着', ctx['latest'])
        body = region(body, 'お知らせ一覧', ctx['list'])
        body = region(body, '前後の記事', nav_html(ctx['news'], name))
        body = re.sub(r'(<!-- 自動:関連 (.*?) -->)\n?.*?\n?([ \t]*<!-- /自動:関連 -->)',
                      lambda r: r.group(1) + NL + ctx['related'](words_of(r.group(2))) + NL + r.group(3), body, flags=re.S)
    vals = {'{{題名}}': title, '{{自動の行}}': auto_head(name, title, body, ctx['by_file']).rstrip(NL),
            '{{このページだけの行}}': ''.join(l + NL for l in extra), '{{帯}}': bar_html(name), '{{本文}}': body}
    out = re.sub(r'\{\{(?:題名|自動の行|このページだけの行|帯|本文)\}\}', lambda m: vals[m.group(0)], ctx['frame'])   # 1回で置き換える（題名に {{本文}} と書いてあっても広がらない）
    if name == '404.html':   # 404 は <base> でサイトの頭を基準にしているので、#honbun がトップへの移動になる。本文へ移動のリンクは外す
        out = re.sub(r'<a class="skip"[^\n]*\n', '', out, count=1)
    return out


def cell(x):
    """表の1つの欄に入れる形（タグは文字のまま見せ、| と改行で表が崩れないようにする）"""
    return html.escape(str(x), quote=False).replace('|', '&#124;').replace(NL, ' ')


def step_summary():
    """Actions の実行の画面の最初に、問題の一覧を表で出す"""
    path = os.environ.get('GITHUB_STEP_SUMMARY')
    if not path or not (PROBLEMS or WARNINGS):
        return
    with open(path, 'a', encoding='utf-8') as fh:
        if PROBLEMS:
            fh.write('### 直す必要のある所\n\n| ファイル | 何が起きたか | どう直すか |\n|---|---|---|\n')
            fh.writelines(f'| {cell(f)} | {cell(w)} | {cell(h)} |\n' for f, w, h in PROBLEMS)
        if WARNINGS:
            fh.write('\n### 注意（止めてはいない）\n\n| ファイル | 内容 |\n|---|---|\n')
            fh.writelines(f'| {cell(f)} | {cell(w)} |\n' for f, w in WARNINGS)


def main():
    global BAR, GROUPS, Image, ImageOps
    names = sorted(f for f in os.listdir('.') if os.path.isfile(f))
    for f in names:
        if re.search(r'\.html?$', f, re.I) and not f.endswith('.html'):
            problem(f, '拡張子が小文字の .html ではありません。', 'ファイル名の最後を .html にしてください。')
    pages = [f for f in names if f.endswith('.html') and not re.fullmatch(r'(?:google[0-9a-f]+|yandex_[0-9a-f]+)\.html', f)]
    for f in pages:
        if re.search(r'[^A-Za-z0-9._-]', f) and not LOOKS_NEWS.match(f):
            problem(f, 'ファイル名に空白や日本語などがあります。', '半角の英数字とハイフンだけの名前に付け直してください（リンクの書き方も合わせて直す）。')
    try:
        frame, frame_head = read_frame()
        BAR, GROUPS = read_menu()
        try:
            from PIL import Image, ImageOps
        except ImportError:
            raise Stop('Pillow（画像を扱う部品）が入っていません。pip install pillow で入れてから、もう一度流してください。')
    except Stop as e:
        print('止めました（何も書き換えていません）: ' + str(e))
        if IN_ACTIONS:
            print('::error::' + str(e))
        PROBLEMS.append(('_frame', str(e), ''))
        step_summary()
        sys.exit(1)

    news, bad = read_news(pages)
    by_file = {n['file']: n for n in news}
    frozen = bool(bad)
    spots = read_spots()
    related_cache = {}
    ctx = {'frame': frame, 'frame_head': frame_head, 'news': news, 'by_file': by_file, 'frozen': frozen,
           'top_list': '      ' + top_list_html(), 'top': read_top(),
           'latest': '' if frozen else latest_html(news), 'list': '' if frozen else list_html(news),
           'related': lambda w: related_cache.setdefault(w, related_html(news, spots, w))}
    pending, final = {}, {}
    for f in pages:
        raw = open(f, 'rb').read()
        s = read(f)
        if s is None:
            final[f] = raw.decode('utf-8', 'replace')   # 前のままのページが使う小さな画像を消さないように覚えておく
            continue
        final[f] = s
        if f in bad:
            continue
        if not find_main(s) and 'class="hd"' not in s:
            warn(f, '共通の枠を使っていないページなので、作り直しません。')
            continue
        if not NEWS_NAME.fullmatch(f) and not f.startswith(SKIP) and re.search(r'\bnews__(?:date|title)\b', masked(s)):
            warn(f, 'お知らせの形のページですが、名前が news-〜.html でないので、お知らせの一覧には入りません。')
        try:
            new = rebuild(f, s, ctx)
        except Exception as e:
            problem(f, f'作り直しの途中で止まりました（{type(e).__name__}: {e}）。', 'このページの書き方が崩れている所がないか確かめ、分からなければ向井に知らせてください。')
            new = None
        if new is not None:
            final[f] = new
            if new.encode('utf-8') != raw:   # 改行コードや BOM だけが違うファイルも、そろえて書き直す
                pending[f] = new
    for l, fs in DROPPED.items():   # 枠から外した行なら全ページに出るので、行ごとに1回だけ知らせる
        warn(fs[0], f'<head> の「{l[:60]}」は {HEAD_MARK} より上にあったので消しました（{len(fs)} ページ）。'
                    '枠から外した行ならそのままでよく、このページだけで使う行なら印より下に書いてください。')
    if APPLY:   # 書き込みは全部のページを作り終えてから、まとめて行う
        for f, new in pending.items():
            open(f, 'w', encoding='utf-8', newline=NL).write(new)

    # 使われなくなった小さな画像を消す（どのページからも参照されていない ns-・nt- の画像だけ。お知らせに問題があるあいだは消さない）
    removed = []
    if APPLY and not frozen:
        used = set()
        for text in final.values():
            used |= set(re.findall(r'img/(n[st]-[^"\'\s>]+\.jpg)', text))
        for b in sorted(os.listdir('img')):
            if THUMB_NAME.fullmatch(b) and b not in used:
                os.remove(os.path.join('img', b))
                removed.append(b)

    if SEARCH:   # 検索に出すときだけ、検索エンジン向けのページ一覧（サイトマップ）を作る
        ok = [f for f in pages if f != '404.html' and not f.startswith(SKIP) and not re.search(r'[^A-Za-z0-9._-]', f)]
        urls = [SITE_URL + ('' if f == 'index.html' else urllib.parse.quote(f)) for f in ok]
        xml = '<?xml version="1.0" encoding="UTF-8"?>' + NL + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + NL
        xml += ''.join(f'  <url><loc>{u}</loc></url>' + NL for u in urls) + '</urlset>' + NL
        if APPLY:
            open('sitemap.xml', 'w', encoding='utf-8', newline=NL).write(xml)
        print(f'サイトマップ {len(urls)} 件')

    print(f'ページ {len(pages)} / お知らせ {len(news)} 本 / {"書き直した" if APPLY else "書き直す必要がある"}ページ {len(pending)}'
          + (f' / 消した小さな画像 {len(removed)}' if removed else ''))
    if pending:
        print('  ', ', '.join(list(pending)[:12]) + (' ほか' if len(pending) > 12 else ''))
    if pending and not APPLY:
        print('実際に書き込むには: python build.py --apply')
    step_summary()
    if PROBLEMS:
        print(f'\n直す必要のある所が {len(PROBLEMS)} か所あります。問題のあるページは前のままにしました。'
              + ('お知らせに問題があるので、お知らせの一覧・トップの新着・前後の記事・関連も前のままです。' if frozen else ''))
        for f, what, how in PROBLEMS:
            print(f'  - {f}: {what} {how}')
        sys.exit(2)


if __name__ == '__main__':
    main()
