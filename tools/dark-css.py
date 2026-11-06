"""
Makes src/dark.css from src/styles.css: the dark theme of the redesign (Jose, 2026-11-05: "me gusta también el theme
negro ... que puedan seleccionar theme claro o oscuro").

Every rule of styles.css that paints a colour gets a twin under html[data-theme="dark"] with that colour turned for a
dark page, keeping its hue (green stays green, a room's tint stays the room's): light backgrounds become dark ones, a
little lighter than the page so cards and windows stand out; dark text becomes light; light borders and edges become
mid tones. The twins are wrapped in :where() so they weigh exactly what the rule they copy weighs, and come after it.
The tokens (--bg, --surface, --ink ...) are set apart at the top. Rules inside @media keep their @media; print is left.

Run it again after changing styles.css:  python tools/dark-css.py
"""
import colorsys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src' / 'styles.css'
OUT = ROOT / 'src' / 'dark.css'

TOKENS = """html[data-theme="dark"]{color-scheme:dark;--bg:#1b1d20;--surface:#111214;--rd-box:#1f2226;--rd-made:#c9a8ea;--rd-now:#7fb2ff;--rd-work:#5fd394;--ink:#e8ebee;--muted:#a0a8b1;--line:#2d3238;--accent:#581447;--accent-text:#c9a8ea;--accent-line:#8f5bbf;--seg:#0b0c0e;--zebra:#1e2126;--colline:rgba(255,255,255,.1);--accent-ink:#fff;--ok:#2f9e66;--warn:#e5534b;--amber:#e0a030;--soft:#271a2e;--red-soft:#3a1f1d;--btn:#262a30;--btn-line:#4b525b;--btn-edge:#08090b}
html[data-theme="dark"] .app.rd .logo{background:#fff;border-radius:10px;padding:3px}
html[data-theme="dark"] .app.rd .btn.go{background:#1f8a55;border-color:#1f8a55}
html[data-theme="dark"] .app.rd .veil{background:rgba(0,0,0,.7)}
html[data-theme="dark"] .app.rd .line.mode-bin{border-color:#8b5cf6;box-shadow:0 0 0 1px #8b5cf6}
html[data-theme="dark"] .app.rd .line.mode-bin .hero{border-color:#5b4a8a}
html[data-theme="dark"]{--sb-ok:#2f9e66;--sb-warn:#e0a030;--sb-bad:#e5534b;--sb-goal:#c9a8ea;--sb-lab:#a0a8b1}
html[data-theme="dark"]{--t-work:#2f9e66;--t-stop:#e0a030;--t-setup:#8b74d6;--t-lunch:#5c6b7d;--t-track:#23262b;--t-gap:repeating-linear-gradient(135deg,#2a2d33 0 4px,#1f2226 4px 8px)}
html[data-theme="dark"]{--wt-band:#163a26;--wt-edge:#2f7a4d;--wt-line:#c9a8ea;--wt-ok:#c9a8ea;--wt-bad:#f87171;--wt-warn:#fbbf24;--wt-lab:#a0a8b1}
html[data-theme="dark"] .app.rd .k-lb{--kt:#2e2412;--kk:#fcd34d}
html[data-theme="dark"] .app.rd .k-cajas{--kt:#16233d;--kk:#93c5fd}
html[data-theme="dark"] .app.rd .k-copas{--kt:#1c1d3d;--kk:#a5b4fc}
html[data-theme="dark"] .app.rd .k-bags{--kt:#122c2a;--kk:#5eead4}
html[data-theme="dark"] .app.rd .k-pouches{--kt:#10292f;--kk:#67e8f9}
html[data-theme="dark"] .app.rd .dlg{border-color:#3a4048;background:#23262b}
html[data-theme="dark"] .dlg tr.rp-focus td,html[data-theme="dark"] .report tr.rp-focus td{background:#3d3212;color:var(--ink)}
html[data-theme="dark"] .report mark,html[data-theme="dark"] .dlg mark{background:#5a4712;color:#fff3c4}
html[data-theme="dark"] .rc-mat{--tone:#271a2e;--tone-line:#8f5bbf;--tone-edge:#3d2a4a;--tone-ink:#c9a8ea}
html[data-theme="dark"] .kpi-tile.go{--c:#c9a8ea}
html[data-theme="dark"] .lt-lot.go,html[data-theme="dark"] .lt-detail.go{--lc:#c9a8ea}
"""

HEX = re.compile(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b')


def rgb(h):
    h = h.lstrip('#')
    h = h if len(h) == 6 else ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def hexof(r, g, b):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(x * 255))) for x in (r, g, b))


def hls(h):
    return colorsys.rgb_to_hls(*rgb(h))


# the purple's light tints and mid tones, purple on the dark page too (left alone they turn plum-pink)
PURPLE_BG = {'#b5579c': '#8f5bbf', '#f1dfec': '#271a2e', '#f6eaf2': '#271a2e', '#fbf7fa': '#1f1a24'}
PURPLE_EDGE = {'#c48bb4': '#6a4590', '#e3c6da': '#3d2a4a'}


def bg(h):
    if h.lower() in PURPLE_BG:
        return PURPLE_BG[h.lower()]
    hh, l, s = hls(h)
    if l >= 0.985 and s < 0.2:
        return 'var(--surface)'
    if l >= 0.86 and s < 0.3:
        return '#202327'
    if l >= 0.78 or (l >= 0.7 and s > 0.5):  # a pastel tint, or a bright light one (#fde68a): the same hue, dark
        return hexof(*colorsys.hls_to_rgb(hh, 0.16, min(s, 0.32)))
    return None


PURPLE = {'#581447', '#3a0d2f'}


def fg(h):
    if h.lower() in PURPLE:
        return '#c9a8ea'
    hh, l, s = hls(h)
    if l < 0.45:
        return hexof(*colorsys.hls_to_rgb(hh, max(0.78, 1 - l * 0.55), min(s, 0.75)))
    return None


def edge(h):
    if h.lower() in PURPLE:
        return '#8f5bbf'
    if h.lower() in PURPLE_EDGE:
        return PURPLE_EDGE[h.lower()]
    hh, l, s = hls(h)
    if l >= 0.6:
        return hexof(*colorsys.hls_to_rgb(hh, 0.3 if s > 0.2 else 0.26, min(s, 0.45)))
    return None


def turn(prop, value):
    p = prop.strip().lower()
    if p in ('background', 'background-color') or p.startswith('background'):
        f = bg
    elif p in ('color', 'fill', 'caret-color', 'text-decoration-color'):
        f = fg
    elif p.startswith('border') or p in ('box-shadow', 'outline', 'outline-color', 'stroke', 'column-rule'):
        f = edge
    else:
        return None
    def rep(m):
        n = f('#' + m.group(1))
        return m.group(0) if n is None else n
    if f is fg:
        value = value.replace('var(--accent)', 'var(--accent-text)')
    elif f is edge:
        value = value.replace('var(--accent)', 'var(--accent-line)')
    # (every colour of these properties is said again, turned or not, so the cascade of styles.css is repeated in the
    # same order: a later rule that changes a colour still wins over an earlier one, as it does in the light theme)
    return HEX.sub(rep, value)


def twin_selector(sel):
    parts = []
    for part in sel.split(','):
        part = part.strip()
        if not part:
            continue
        if part.startswith(':root'):
            parts.append(':root:where([data-theme="dark"])' + part[5:])
        elif part.startswith('html'):
            parts.append('html:where([data-theme="dark"])' + part[4:])
        else:
            parts.append(':where(html[data-theme="dark"]) ' + part)
    return ','.join(parts)


def blocks(css):
    """yields (media or None, selector, declarations) for each plain rule, in order"""
    i, n, media = 0, len(css), []
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    n = len(css)
    while i < n:
        j = css.find('{', i)
        k = css.find('}', i)
        if k != -1 and (j == -1 or k < j):  # the end of an @media
            if media:
                media.pop()
            i = k + 1
            continue
        if j == -1:
            break
        head = css[i:j].strip()
        if head.startswith('@media') or head.startswith('@supports'):
            media.append(head)
            i = j + 1
            continue
        if head.startswith('@'):  # @keyframes and the like: skipped whole
            depth, q = 1, j + 1
            while depth and q < n:
                depth += {'{': 1, '}': -1}.get(css[q], 0)
                q += 1
            i = q
            continue
        k = css.find('}', j)
        yield (media[-1] if media else None, head, css[j + 1:k])
        i = k + 1


def main():
    css = SRC.read_text(encoding='utf-8')
    out = ['/* generated by tools/dark-css.py from styles.css: do not edit by hand, run the tool again */', TOKENS]
    for media, sel, decls in blocks(css):
        if media and 'print' in media:
            continue
        if sel.startswith(':root') and '--' in decls:
            continue  # the tokens are set above
        new = []
        for d in decls.split(';'):
            if ':' not in d:
                continue
            prop, val = d.split(':', 1)
            if prop.strip().startswith('--'):
                continue
            t = turn(prop, val)
            if t is not None:
                new.append(prop.strip() + ':' + t.strip())
        if not new:
            continue
        rule = twin_selector(sel) + '{' + ';'.join(new) + '}'
        out.append((media + '{' + rule + '}') if media else rule)
    OUT.write_text('\n'.join(out) + '\n', encoding='utf-8')
    print('dark.css:', len(out) - 2, 'rules')


main()
