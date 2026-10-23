"""Randează toate iconurile ExamenMate din gen.py (Chromium, prin Playwright). Vezi README.md."""
import os, gen
from render import render_many
import sys
OUT = sys.argv[1] if len(sys.argv) > 1 else '../..'   # rădăcina repo-ului (rulezi din tools/icon)
R = 'android-twa/app/src/main/res'
jobs = []
def add(svgtext, rel, w, h=None):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    jobs.append((svgtext, p, w, h or w))
ANY = gen.icon('rounded', 790, uid='a')
FULL = gen.icon('square', 790, uid='s')
add(ANY, 'public/pwa-512x512.png', 512)
add(ANY, 'public/pwa-192x192.png', 192)
add(gen.icon('square', 630, uid='m'), 'public/pwa-maskable-512.png', 512)
add(FULL, 'public/apple-touch-icon.png', 180)
add(gen.icon('square', 780, uid='p'), 'play-assets/icon-512.png', 512)
add(gen.feature(), 'play-assets/feature-graphic-1024x500.png', 1024, 500)
dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
FG = gen.icon('none', 490, uid='fg')
BG = gen.svg(gen.defs('bk', shadow=False, gold=False) + gen.background('bk', 'square'))
for d, k in dens.items():
    add(gen.icon('rounded', 790, uid='l'), f'{R}/mipmap-{d}/ic_launcher.png', int(48 * k))
    add(gen.icon('circle', 660, uid='r'), f'{R}/mipmap-{d}/ic_launcher_round.png', int(48 * k))
    add(FG, f'{R}/mipmap-{d}/ic_launcher_foreground.png', int(108 * k))
    add(BG, f'{R}/mipmap-{d}/ic_launcher_background.png', int(108 * k))
    add(gen.monochrome(490), f'{R}/mipmap-{d}/ic_launcher_monochrome.png', int(108 * k))
    add(gen.icon('flat', 520, uid='sp'), f'{R}/drawable-{d}/splash.png', int(320 * k))
render_many(jobs)
fav = gen.favicon()
os.makedirs(f'{OUT}/public', exist_ok=True)
open(f'{OUT}/public/favicon.svg', 'w').write(fav)
print(len(jobs), 'png;', 'favicon.svg', len(fav), 'bytes')
