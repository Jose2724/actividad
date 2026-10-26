# The live app's icons (Jose, 2026-10-23: Mama's Creations' logo, option B: on white). The demo keeps its own
# orange icons with the DEMO band (tools/make-icons.py). Run from the project folder: python tools/brand/make-live-icons.py
from PIL import Image
logo = Image.open('tools/brand/mamas-logo.png').convert('RGBA')
def icon(size, pad, mode='RGBA'):
    im = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    w = int(size * (1 - 2 * pad)); h = int(logo.height * w / logo.width)
    im.alpha_composite(logo.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return im.convert(mode)
icon(192, 0.08).save('public/live-192.png')
icon(512, 0.08).save('public/live-512.png')
icon(180, 0.08, 'RGB').save('public/live-apple.png')
# maskable: the system may cut it to a circle, so the logo stays inside the middle 80%
icon(512, 0.17).save('public/live-maskable-512.png')
print('ok')
