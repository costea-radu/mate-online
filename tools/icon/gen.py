"""Iconul ExamenMate din logo-ul ΣxamenMate: navy + auriu, ca iconul vechi cu „M”."""
import re
LOGO_D = open('logo-path.txt').read()          # trasat din poza lui Radu (potrace), coordonate 1600×1137
LOGO_D_INT = re.sub(r'-?\d+\.\d+', lambda m: str(round(float(m.group()))), LOGO_D)  # pentru favicon (mai mic)
BX0, BY0, BX1, BY1 = 131, 147, 1445, 1024      # chenarul cernelii
NAVY = '#1a3a5c'                               # fundalul iconului vechi = theme_color
RX = 187.5                                     # colțurile iconului vechi: 6/32 din latură

def defs(uid, shadow=True, gold=True):
    d = [f'<linearGradient id="bg{uid}" x1="0" y1="0" x2="0" y2="1">'
         f'<stop offset="0" stop-color="#244f7a"/><stop offset="0.5" stop-color="{NAVY}"/>'
         f'<stop offset="1" stop-color="#132c46"/></linearGradient>',
         f'<radialGradient id="hl{uid}" cx="0.5" cy="0.38" r="0.6">'
         f'<stop offset="0" stop-color="#3b6c9c" stop-opacity="0.35"/>'
         f'<stop offset="1" stop-color="#3b6c9c" stop-opacity="0"/></radialGradient>']
    if gold:
        d.append(f'<linearGradient id="au{uid}" gradientUnits="userSpaceOnUse" x1="0" y1="{BY0}" x2="0" y2="{BY1}">'
                 f'<stop offset="0" stop-color="#fbe08a"/><stop offset="0.45" stop-color="#f0c040"/>'
                 f'<stop offset="1" stop-color="#d49d1c"/></linearGradient>')
    if shadow:
        d.append(f'<filter id="sh{uid}" x="-10%" y="-10%" width="120%" height="125%" color-interpolation-filters="sRGB">'
                 f'<feDropShadow dx="0" dy="9" stdDeviation="9" flood-color="#040d17" flood-opacity="0.55"/></filter>')
    return '<defs>' + ''.join(d) + '</defs>'

def logo(cx, cy, w, T, fill, filt=None, d=None):
    d = d or LOGO_D
    bw, bh = (BX1 - BX0) + T, (BY1 - BY0) + T
    s = w / bw
    tx = cx - w / 2 - (BX0 - T / 2) * s
    ty = cy - bh * s / 2 - (BY0 - T / 2) * s
    stroke = f' stroke="{fill}" stroke-width="{T}" stroke-linejoin="round"' if T > 0 else ''
    g = (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f})">'
         f'<path fill-rule="evenodd" fill="{fill}"{stroke} d="{d}"/></g>')
    return f'<g filter="url(#{filt})">{g}</g>' if filt else g

def svg(body, w=1000, h=1000):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{body}</svg>'

def background(uid, shape, w=1000, h=1000):
    if shape == 'rounded':
        return (f'<rect width="{w}" height="{h}" rx="{RX}" fill="url(#bg{uid})"/>'
                f'<rect width="{w}" height="{h}" rx="{RX}" fill="url(#hl{uid})"/>')
    if shape == 'circle':
        return (f'<circle cx="500" cy="500" r="500" fill="url(#bg{uid})"/>'
                f'<circle cx="500" cy="500" r="500" fill="url(#hl{uid})"/>')
    if shape == 'square':
        return (f'<rect width="{w}" height="{h}" fill="url(#bg{uid})"/>'
                f'<rect width="{w}" height="{h}" fill="url(#hl{uid})"/>')
    if shape == 'flat':    # splash: exact culoarea din jur (SPLASH_SCREEN_BACKGROUND_COLOR)
        return f'<rect width="{w}" height="{h}" fill="{NAVY}"/>'
    return ''

def icon(shape, w, T=12, uid='x', shadow=True):
    b = defs(uid, shadow) + background(uid, shape)
    b += logo(500, 500, w, T, f'url(#au{uid})', filt=(f'sh{uid}' if shadow else None))
    return svg(b)

def monochrome(w, T=12):
    return svg(logo(500, 500, w, T, '#ffffff'))

def favicon():
    # vectorial, fără umbră (la 16–32 px umbra doar încețoșează); un pic mai gros și mai mare
    b = defs('f', shadow=False) + background('f', 'rounded')
    b += logo(500, 500, 860, 16, 'url(#auf)', d=LOGO_D_INT)
    return svg(b)

def feature():
    b = defs('g') + background('g', 'square', 1024, 500)
    b = b.replace('<radialGradient id="hlg" cx="0.5" cy="0.38" r="0.6">', '<radialGradient id="hlg" cx="0.5" cy="0.4" r="0.55">')
    b += logo(512, 250, 500, 12, 'url(#aug)', filt='shg')
    return svg(b, 1024, 500)
