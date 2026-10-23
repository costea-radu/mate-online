import numpy as np, potrace
from PIL import Image
SRC='logo-src.jpg'
S=3  # upscale factor before tracing
im=Image.open(SRC).convert('L')
w,h=im.size
im=im.crop((4,4,w-4,h-4))
big=im.resize((im.size[0]*S, im.size[1]*S), Image.LANCZOS)
a=np.asarray(big).astype(float)
ink=a<108
bm=potrace.Bitmap(~ink)
plist=bm.trace(turdsize=20, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.0, opticurve=True, opttolerance=0.2)
def f(v): return (f"{v/S+4:.1f}").rstrip("0").rstrip(".")
parts=[]
for curve in plist:
    sp=curve.start_point
    d=[f'M{f(sp.x)} {f(sp.y)}']
    for seg in curve.segments:
        if seg.is_corner:
            d.append(f'L{f(seg.c.x)} {f(seg.c.y)}L{f(seg.end_point.x)} {f(seg.end_point.y)}')
        else:
            d.append(f'C{f(seg.c1.x)} {f(seg.c1.y)} {f(seg.c2.x)} {f(seg.c2.y)} {f(seg.end_point.x)} {f(seg.end_point.y)}')
    d.append('Z')
    parts.append(''.join(d))
path=''.join(parts)
open('logo-path.txt','w').write(path)
print('curves', len(plist), 'path chars', len(path))
svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1137"><rect width="1600" height="1137" fill="#fad29e"/><path fill-rule="evenodd" d="{path}"/></svg>'
open('traced-check.svg','w').write(svg)
