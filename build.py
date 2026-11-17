#!/usr/bin/env python3
"""サイトの共通部分と一覧を作り直す。

  python build.py            変わるページを数えるだけ（書き込まない）
  python build.py --apply    実際に書き込む

push すると GitHub が自動で --apply を実行するので、ふだんは手元で流す必要はない。

各ページで人が書くのは <main> … </main> の中だけ。その外側（ヘッダー・上の帯・フッター）は _frame/frame.html から、
上の帯と左のメニューの項目は _frame/menu.txt から作り直す。<main> の中でも、次の目印で挟まれた所は自動で作り直す
（目印の間を手で直しても、次の実行で元に戻る）:

  <!-- 自動:メニュー -->       左のメニュー
  <!-- 自動:ページ一覧 -->     トップの写真の上の一覧
  <!-- 自動:新着 -->           トップのお知らせ（新しい6件）
  <!-- 自動:お知らせ一覧 -->   お知らせの一覧（年ごと）
  <!-- 自動:前後の記事 -->     お知らせの記事の下の「新しい記事／一覧へ／古い記事」
  <!-- 自動:関連 言葉|言葉 --> 研究テーマのページの、関連するページとお知らせ（題名にその言葉を含むもの）

お知らせは news-〜.html という名前のページ全部。日付・分類・題名は、そのページの中から読む。
"""
import glob, html, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
APPLY = '--apply' in sys.argv
SKIP = ('hinagata-',)                                                       # ひな形。お知らせの一覧などには入れない
BAR_MARK = (('news', 'news.html'), ('theme-', 'research.html'))             # ファイル名の頭 → 上の帯で印を付ける項目
SIDE_MARK = (('movies', 'movies.html'), ('ob', 'member.html'))              # ファイル名の頭 → 左のメニューで印を付ける項目
SIDE_OPEN = (('research', '研究'), ('lineheat', '研究'), ('theme-', '研究'))   # 左のメニューに無いページで、開いておく分類
ANCHORS = ('fem.html', 'facility.html')                                     # 小見出しも「関連するページ」の候補にするページ
NO_RELATED = {'index.html', 'research.html', 'news.html', 'access.html'}    # 「関連するページ」の候補にしないページ
NL = '\n'
SUFFIX = '｜柴原研究室｜大阪大学 接合科学研究所'                               # タブに出る題名の後ろに付ける文字
SITE_URL = 'https://jwri-uo.github.io/shiba-lab/'                           # サイトの場所。別のサーバーや独自ドメインへ移したら、ここを直す
SEARCH = False                                                              # 検索に出すか。False の間は、全ページに検索よけを付ける。True にすると外れ、サイトマップも作る
DESCRIPTION = '大阪大学 接合科学研究所 柴原研究室のホームページです。'           # 本文の無いページの説明文
AUTO_HEAD = ('<meta name="description"', '<meta name="robots"', '<meta property="og:', '<meta name="twitter:', '<base ')   # <head> の中で自動で付け直す行


def read_menu():
    """_frame/menu.txt を読む。戻り値は (上の帯の項目, [(分類の名前, 項目の並び)])"""
    bar, groups, cur = [], [], None
    for line in open('_frame/menu.txt', encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        m = re.match(r'\[(.+)\]$', line)
        if m:
            cur = m.group(1)
            if cur != '帯':
                groups.append((cur, []))
            continue
        p = [x.strip() for x in line.split('|')]
        assert cur and len(p) >= 3, '_frame/menu.txt のこの行が読めません（題名 | ファイル名 | アイコン の順に書く）: ' + line
        item = {'title': p[0], 'file': p[1], 'icon': p[2], 'flag': p[3] if len(p) > 3 else ''}
        (bar if cur == '帯' else groups[-1][1]).append(item)
    return bar, groups


BAR, GROUPS = read_menu()


def target(name, table, default):
    """ファイル名の頭で決まる、印を付ける先。表に無ければ default"""
    for head, to in table:
        if name.startswith(head):
            return to
    return default


def link(it):
    return f'<a href="{it["file"]}"><i class="fa {it["icon"]}"></i>{it["title"]}</a>'


def bar_html(name):
    cur = target(name, BAR_MARK, name)
    li = ''.join(f'      <li{" class=" + chr(34) + "is-current" + chr(34) if it["file"] == cur else ""}>{link(it)}</li>' + NL for it in BAR)
    return '<nav class="gn">\n    <ul>\n' + li + '    </ul>\n  </nav>'


def side_html(name):
    cur = target(name, SIDE_MARK, name)
    opened = target(name, SIDE_OPEN, None)
    out = '<aside class="side" id="pages" aria-label="ページの一覧">\n'
    for title, items in GROUPS:
        is_open = title == opened or any(it['file'] == cur for it in items)
        out += f'      <details class="side__grp" name="side"{" open" if is_open else ""}><summary>{title}</summary>\n        <ul>\n'
        for it in items:
            a = link(it).replace('">', '" class="is-current" aria-current="page">', 1) if it['file'] == cur else link(it)
            out += f'          <li>{a}</li>\n'
        out += '        </ul>\n      </details>\n'
    return out + '    </aside>'


def top_list_html():
    """トップの写真の上の一覧（タイルで出しているページと「下層のみ」のページは除く）"""
    items = [it for _, its in GROUPS for it in its if not it['flag']]
    return '<ul>\n' + ''.join(f'        <li>{link(it)}</li>\n' for it in items) + '      </ul>'


def plain(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def read_news():
    """news-〜.html を全部読んで、新しい順に並べる"""
    out = []
    for f in sorted(glob.glob('news-*.html')):
        s = open(f, encoding='utf-8').read()
        d = re.search(r'class="news__date">\s*(\d{4})\.(\d{1,2})\.(\d{1,2})', s)
        t = re.search(r'<h2 class="news__title">(.*?)</h2>', s, re.S)
        if not (d and t):
            print('  日付か題名が読めないので一覧に入れません:', f)
            continue
        cats = re.findall(r'<span class="cards__cat">(.*?)</span>', s[d.start():s.index('</p>', d.start())])
        end = s.find('<p class="doc__src">', t.end())
        pic = re.search(r'<img[^>]+src="(img/[^"]+)"', s[t.end():end if end > 0 else len(s)])
        out.append({'file': f, 'key': f[5:-5], 'date': tuple(int(x) for x in d.groups()), 'title': t.group(1).strip(), 'cats': cats, 'first': pic and pic.group(1)})
    out.sort(key=lambda n: (n['date'], n['file']), reverse=True)
    return out


def cut(n, prefix, size):
    """記事の最初の図から、決まった大きさの見出し画像を作って名前を返す。図の無い記事や読めない図は None"""
    if not n['first']:
        return None
    name = f'img/{prefix}{n["key"]}.jpg'
    if not os.path.isfile(name):
        try:
            from PIL import Image, ImageOps
            im = Image.open(n['first'])
            im.draft('RGB', (size[0] * 2, size[1] * 2))
            im = ImageOps.fit(ImageOps.exif_transpose(im).convert('RGB'), size, centering=(0.5, 0.35))
            if APPLY:
                im.save(name, 'JPEG', quality=82)
        except Exception as e:
            print('  見出し画像を作れませんでした:', n['file'], e)
            return None
    return name


def meta(n):
    return '%d.%02d.%02d' % n['date'] + ''.join(f'<span class="cards__cat">{x}</span>' for x in n['cats'])


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
        out += (f'      <li><a href="{n["file"]}"><img src="{pic}" alt=""><div class="cards__body"><p class="cards__meta">{meta(n)}</p>'
                f'<p class="cards__ttl">{n["title"]}</p></div></a></li>\n')
    return out.rstrip(NL)


def list_html(news):
    years = sorted({n['date'][0] for n in news}, reverse=True)
    out = '<nav class="doc__toc" aria-label="年ごとの目次"><ul>' + ''.join(f'<li><a href="#y{y}">{y}年</a></li>' for y in years) + '</ul></nav>\n'
    for y in years:
        items = [n for n in news if n['date'][0] == y]
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
    rx = re.compile(words)
    rel = [(h, t) for h, t in spots if rx.search(t)]
    hit = [n for n in news if rx.search(html.unescape(n['title']))]
    out = ''
    if rel:
        out += '<h2>関連するページ</h2>\n<ul class="newslist">\n' + ''.join(f'<li><a href="{h}"><span class="newslist__ttl">{t}</span></a></li>\n' for h, t in rel) + '</ul>\n'
    out += f'<h2>関連するお知らせ<small>（題名から自動で集めたもの。{len(hit)}件）</small></h2>\n'
    if not hit:
        return out + '<p>関連するお知らせは、まだありません。</p>'
    out += '<ul class="newslist">\n' + ''.join(row(n) for n in hit[:15]) + '</ul>'
    if len(hit) > 15:
        out += '\n<p>新しい15件を表示しています。すべてのお知らせは<a href="news.html">一覧</a>から見られます。</p>'
    return out


FRAME = open('_frame/frame.html', encoding='utf-8').read()
FRAME_HEAD = {l.strip() for l in FRAME[FRAME.index('<head>'):FRAME.index('</head>')].split(NL)}


def region(body, name, new):
    """<!-- 自動:name --> と <!-- /自動:name --> の間を new に差し替える。目印が無いページでは何もしない"""
    return re.sub(r'(<!-- 自動:' + name + r' -->)\n?.*?\n?([ \t]*<!-- /自動:' + name + ' -->)', lambda m: m.group(1) + NL + new + NL + m.group(2), body, flags=re.S)


def read_spots():
    """「関連するページ」の候補: メニューにあるページの題名、研究動画の下位ページの題名、ANCHORS のページの小見出し"""
    spots = [(it['file'], it['title']) for it in BAR + [i for _, its in GROUPS for i in its] if it['file'] not in NO_RELATED]
    for f in sorted(glob.glob('movies-*.html')):
        t = re.search(r'<h1 class="phero__ttl">(.*?)<small>', open(f, encoding='utf-8').read(), re.S)
        if t:
            spots.append((f, plain(t.group(1))))
    for f in ANCHORS:
        if os.path.isfile(f):
            spots += [(f + '#' + i, plain(h)) for i, h in re.findall(r'<h3 id="(t\d+)">(.*?)</h3>', open(f, encoding='utf-8').read())]
    return spots


def describe(name, body):
    """検索や共有のときに出る説明文。本文の頭の100字ほど。本文が無いページは決まった文"""
    art = re.search(r'<article class="doc[^"]*">(.*?)</article>', body, re.S)
    if art:
        t = re.sub(r'<nav class="doc__toc".*?</nav>|<p class="(?:doc__lead|news__date|news__nav|doc__src)">.*?</p>|<h2 class="news__title">.*?</h2>|<!--.*?-->', ' ', art.group(1), flags=re.S)
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
    if SEARCH and name not in ('404.html',) and not name.startswith(SKIP):
        lines.append(f'<link rel="canonical" href="{SITE_URL}{"" if name == "index.html" else name}">')
    else:
        lines.append('<meta name="robots" content="noindex">')
    return ''.join(l + NL for l in lines)


def rebuild(name, s, news, spots, by_file):
    """1ページを作り直して返す。<main> の中の人が書いた所と、そのページだけの読み込みは、そのまま残す"""
    title = re.search(r'<title>(.*?)</title>', s, re.S).group(1).strip()
    head = s[s.index('<head>') + len('<head>'):s.index('</head>')]
    extra = [l.strip() for l in head.split(NL) if l.strip() and l.strip() not in FRAME_HEAD and not l.strip().startswith(('<title>',) + AUTO_HEAD)]
    if SEARCH:   # 検索に出すときは、正本の場所をこのサイト自身にする（公立大サイトを指す行は外す）
        extra = [l for l in extra if not l.startswith('<link rel="canonical"')]
    m = re.search(r'<main>\n(.*)\n</main>', s, re.S)
    body = m.group(1)
    # タブに出る題名は、ページの見出しから付ける（お知らせは記事の題名、ほかは大きな見出し）。見出しの無いページは今の題名のまま
    art = re.search(r'<h2 class="news__title">(.*?)</h2>', body, re.S) if name.startswith('news-') else None
    h1 = re.search(r'<h1 class="phero__ttl">(.*?)<small>', body, re.S)
    if art:
        title = art.group(1).strip()[:60] + SUFFIX
    elif h1:
        title = h1.group(1).strip() + SUFFIX
    body = region(body, 'メニュー', '    ' + side_html(name))
    body = region(body, 'ページ一覧', '      ' + top_list_html())
    body = region(body, '新着', latest_html(news))
    body = region(body, 'お知らせ一覧', list_html(news))
    body = region(body, '前後の記事', nav_html(news, name))
    body = re.sub(r'(<!-- 自動:関連 (.*?) -->)\n?.*?\n?([ \t]*<!-- /自動:関連 -->)',
                  lambda r: r.group(1) + NL + related_html(news, spots, r.group(2).strip()) + NL + r.group(3), body, flags=re.S)
    frame = FRAME.replace('{{題名}}', title).replace('{{自動の行}}', auto_head(name, title, body, by_file).rstrip(NL))
    frame = frame.replace('{{このページだけの行}}', ''.join(l + NL for l in extra)).replace('{{帯}}', bar_html(name))
    return frame.replace('{{本文}}', body)


def main():
    news, spots = read_news(), read_spots()
    by_file = {n['file']: n for n in news}
    pages = [f for f in sorted(glob.glob('*.html')) if not f.startswith('google')]
    changed, skipped = [], []
    for f in pages:
        s = open(f, encoding='utf-8').read().replace('\r\n', NL)
        if not re.search(r'<main>\n.*\n</main>', s, re.S):
            skipped.append(f)
            continue
        new = rebuild(f, s, news, spots, by_file)
        if new != s:
            changed.append(f)
            if APPLY:
                open(f, 'w', encoding='utf-8', newline=NL).write(new)
    print(f'ページ {len(pages)} / お知らせ {len(news)} 本 / {"書き直した" if APPLY else "書き直す必要がある"}ページ {len(changed)}')
    if changed:
        print('  ', ', '.join(changed[:12]) + (' ほか' if len(changed) > 12 else ''))
    if skipped:
        print('  <main> が無いので触らなかったページ:', ', '.join(skipped[:12]) + (' ほか' if len(skipped) > 12 else ''))
    if changed and not APPLY:
        print('実際に書き込むには: python build.py --apply')


if __name__ == '__main__':
    main()
