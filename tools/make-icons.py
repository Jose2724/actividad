"""Draws the app's icons (run by hand when they change: python tools/make-icons.py).

Two looks, so the two apps can be told apart on a home screen and in a browser tab:
  live  = the version with a server: deep blue
  demo  = the demo without a server: orange, with a DEMO band
Each look gets: 192 and 512 (rounded square), maskable 512 (full square, drawing inside the safe zone) and an
apple icon 180 (full square: iOS rounds the corners itself). Needs Pillow and Arial Bold (Windows).
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
S = 4  # drawn 4x bigger and scaled down, for smooth edges
LOOKS = {'live': (30, 64, 175), 'demo': (194, 65, 12)}
WHITE = (255, 255, 255)
FONT = 'C:/Windows/Fonts/arialbd.ttf'


def glyph(d, color_bg, cx, cy, k):
    """three bars and a clock, as on a 512 canvas, scaled by k around (cx, cy)"""
    def p(x, y): return ((cx + (x - 256) * k) * S, (cy + (y - 256) * k) * S)
    def box(x0, y0, x1, y1): return [*p(x0, y0), *p(x1, y1)]
    for x0, y0 in ((102, 272), (187, 180), (272, 227)):
        d.rounded_rectangle(box(x0, y0, x0 + 50, 410), radius=14 * k * S, fill=WHITE)
    d.ellipse(box(358 - 52, 165 - 52, 358 + 52, 165 + 52), fill=WHITE)
    d.ellipse(box(358 - 38, 165 - 38, 358 + 38, 165 + 38), fill=color_bg)
    d.rounded_rectangle(box(353, 139, 363, 170), radius=4 * k * S, fill=WHITE)   # hour hand
    d.rounded_rectangle(box(353, 160, 380, 170), radius=4 * k * S, fill=WHITE)   # minute hand


def band(d, color, x0, y0, x1, y1):
    """the white DEMO band"""
    d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=(y1 - y0) * 0.28 * S, fill=WHITE)
    font = ImageFont.truetype(FONT, int((y1 - y0) * 0.74 * S))
    l, t, r, b = d.textbbox((0, 0), 'DEMO', font=font)
    d.text((((x0 + x1) / 2) * S - (l + r) / 2, ((y0 + y1) / 2) * S - (t + b) / 2), 'DEMO', font=font, fill=color)


def icon(look, kind):
    color = LOOKS[look]
    im = Image.new('RGBA', (512 * S, 512 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if kind == 'rounded': d.rounded_rectangle([0, 0, 512 * S, 512 * S], radius=104 * S, fill=color)
    else: d.rectangle([0, 0, 512 * S, 512 * S], fill=color)
    demo = look == 'demo'
    if kind == 'maskable':  # launchers crop to a circle: everything inside the middle 80%
        glyph(d, color, 256, 222 if demo else 256, 0.5 if demo else 0.62)
        if demo: band(d, color, 128, 322, 384, 392)
    else:
        glyph(d, color, 256, 200 if demo else 256, 0.8 if demo else 1.0)
        if demo: band(d, color, 60, 366, 452, 466)
    return im


def save(im, size, name):
    out = im.resize((size, size), Image.LANCZOS)
    if name.endswith('apple.png'): out = out.convert('RGB')  # no transparency: iOS would paint it black
    out.save(os.path.join(OUT, name), optimize=True)
    print(name, size)


for look in LOOKS:
    save(icon(look, 'rounded'), 192, look + '-192.png')
    save(icon(look, 'rounded'), 512, look + '-512.png')
    save(icon(look, 'maskable'), 512, look + '-maskable-512.png')
    save(icon(look, 'square'), 180, look + '-apple.png')
