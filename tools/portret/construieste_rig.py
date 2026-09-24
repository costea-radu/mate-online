#!/usr/bin/env python3
# =====================================================================
# tools/portret/construieste_rig.py — SCENA ANIMATĂ a profesorului virtual (v2)
#
# Din fotografia clasei cu profesorul (o persoană care și-a dat ACORDUL sau una
# generată cu AI), construiește tot ce îi trebuie browserului ca s-o „aducă la
# viață" (src/lib/live/portret.js). Scena se desparte în STRATURI, ca la film:
#
#   fundal.jpg    — clasa FĂRĂ profesor (locul lui, completat din tabla din jur)
#   actor.png     — profesorul decupat (culorile curățate de tabla din spate),
#                   plus ANTEBRAȚELE cu mâinile, separat, ca să poată gesticula
#   prim-plan.png — ce stă ÎN FAȚA profesorului (pupitrul/catedra), decupat
#   scena.jpg     — fotografia originală (rezervă, dacă WebGL lipsește)
#   portret.jpg   — miniatura feței (lobby, „Ești gata să intri?")
#   rig.json      — reperele feței (478, CU ADÂNCIME — pentru întoarcerea capului),
#                   scheletul (umeri, coate, încheieturi), plasele de triunghiuri,
#                   colțurile tablei albe și ale proiecției
#
# Cu straturile separate, profesorul se poate MIȘCA de-adevăratelea: își mută
# greutatea de pe un picior pe altul, se apleacă, întoarce capul spre tablă,
# gesticulează cu mâinile — fără să „tragă" după el tabla din spate; scrisul de
# pe tablă trece pe după el, iar pupitrul rămâne în fața lui.
#
# Rulare (o singură dată pe fotografie; nimic nu pleacă pe internet):
#   pip install mediapipe==0.10.14 opencv-contrib-python-headless numpy triangle \
#       pillow pymatting scikit-image scipy
#   python tools/portret/construieste_rig.py --scena tools/portret/scene/clasa.json \
#       --out public/live/radu
#
# Fișierul scenei (JSON; coordonate în pixelii fotografiei):
#   {
#     "foto": "clasa.jpg",                          (relativ la fișierul JSON)
#     "tabla": [[x,y],[x,y],[x,y],[x,y]],           zona de scris a tablei albe
#     "ecran": [[x,y],...4],                        tabla digitală (proiecția)
#     "ecran_mod": "proiectie" | "ecran",
#     "plutitor": null | "stanga" | "dreapta",      panou mare cu tabla digitală
#     "prim_plan": [ [[x,y],...], ... ],            poligoane ÎN FAȚA profesorului
#     "brate": "auto" | [],                         antebrațe separate (din schelet)
#     "camera": [x, y, lățime, înălțime],           încadrarea implicită (ca o cameră
#                                                   îndreptată spre tablă); lipsă = toată poza
#     "extra_mana": { "R": [[x,y],...], "L": [...] } ce ține în mână (ex. markerul)
#   }
# Colțurile: stânga-sus, dreapta-sus, dreapta-jos, stânga-jos.
# Recomandat pentru poză: față spre cameră, mâinile la vedere, fundal simplu
# (tablă) în spatele lui, lumină bună.
# =====================================================================
import argparse, json, math, os, sys
import numpy as np
from PIL import Image, ImageOps, ImageDraw

LIP_UP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]
LIP_LO_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
EYE_A_UP = [33, 246, 161, 160, 159, 158, 157, 173, 133]
EYE_A_LO = [33, 7, 163, 144, 145, 153, 154, 155, 133]
EYE_B_UP = [263, 466, 388, 387, 386, 385, 384, 398, 362]
EYE_B_LO = [263, 249, 390, 373, 374, 380, 381, 382, 362]
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]


def die(msg):
    print('EROARE:', msg, file=sys.stderr)
    sys.exit(1)


def log(msg):
    print('·', msg, flush=True)


# ─── fața: 478 de repere, cu adâncime ────────────────────────────────────────
def face_landmarks(rgb):
    """Fața e MICĂ într-o poză de clasă: o găsim cu detectorul „de departe",
    decupăm un pătrat în jurul ei, îl mărim la 640 px, citim reperele (x, y, z)
    acolo și le aducem înapoi în pixelii fotografiei. z < 0 = mai aproape de cameră."""
    import mediapipe as mp
    import cv2
    h, w = rgb.shape[:2]
    det = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.3)
    best = None                                     # (scor, cx, cy, latura) în pixelii pozei
    r = det.process(rgb)
    for d in (r.detections or []):
        bb = d.location_data.relative_bounding_box
        cand = (d.score[0], (bb.xmin + bb.width / 2) * w, (bb.ymin + bb.height / 2) * h, max(bb.width * w, bb.height * h))
        best = cand if best is None or cand[0] > best[0] else best
    if best is None:
        # fața e prea mică pentru detector: căutăm pe bucăți suprapuse, mărite de 3 ori
        T = max(160, min(h, w) // 3)
        for ty in range(0, max(1, h - T // 2), T // 2):
            for tx in range(0, max(1, w - T // 2), T // 2):
                tile = rgb[ty:ty + T, tx:tx + T]
                if tile.shape[0] < 32 or tile.shape[1] < 32:
                    continue
                big = cv2.resize(tile, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
                rr = det.process(big)
                for d in (rr.detections or []):
                    bb = d.location_data.relative_bounding_box
                    th, tw = tile.shape[:2]
                    cand = (d.score[0], tx + (bb.xmin + bb.width / 2) * tw, ty + (bb.ymin + bb.height / 2) * th, max(bb.width * tw, bb.height * th))
                    best = cand if best is None or cand[0] > best[0] else best
    if best is None:
        return None
    _, cx, cy, side = best
    side *= 2.4
    x0, y0 = int(round(cx - side / 2)), int(round(cy - side / 2))
    s = int(round(side))
    pad = np.pad(rgb, ((s, s), (s, s), (0, 0)), mode='edge')
    crop = pad[y0 + s:y0 + 2 * s, x0 + s:x0 + 2 * s]
    S = 640 / s
    big = cv2.resize(crop, (640, 640), interpolation=cv2.INTER_CUBIC)
    fm = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.2)
    res = fm.process(big)
    if not res.multi_face_landmarks:
        return None
    L = np.array([[p.x * 640, p.y * 640, p.z * 640] for p in res.multi_face_landmarks[0].landmark], dtype=np.float64)
    L /= S
    L[:, 0] += x0
    L[:, 1] += y0
    return L


# ─── scheletul (umeri, coate, încheieturi, șolduri) ───────────────────────────
POSE = {'nose': 0, 'sh_L': 11, 'sh_R': 12, 'el_L': 13, 'el_R': 14, 'wr_L': 15, 'wr_R': 16,
        'pk_L': 17, 'pk_R': 18, 'ix_L': 19, 'ix_R': 20, 'th_L': 21, 'th_R': 22, 'hp_L': 23, 'hp_R': 24}


def pose_and_masks(rgb, box, S=3):
    """Scheletul + două măști ale persoanei, pe zona `box` mărită de S ori."""
    import mediapipe as mp
    import cv2
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1]
    big = cv2.resize(crop, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
    pose = mp.solutions.pose.Pose(static_image_mode=True, model_complexity=1, enable_segmentation=True)
    r = pose.process(big)
    kp = None
    if r.pose_landmarks:
        lm = r.pose_landmarks.landmark
        kp = {k: [lm[i].x * big.shape[1] / S + x0, lm[i].y * big.shape[0] / S + y0, lm[i].visibility] for k, i in POSE.items()}
    m2 = r.segmentation_mask if r.segmentation_mask is not None else None
    seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
    m1 = seg.process(big).segmentation_mask
    m = m1 if m2 is None else np.maximum(m1, m2)
    return kp, m, big


# ─── decupajul fin (matting): alfa + culorile curățate de fundal ─────────────
def matte(big, m, S):
    """Alfa „închis" (closed-form) pe imaginea mărită, cu o hartă trimap din
    măștile modelelor; apoi culorile persoanei fără tenta tablei din spate
    (altfel, când se mișcă, s-ar vedea un contur alb)."""
    import cv2
    from pymatting import estimate_alpha_cf, estimate_foreground_ml
    img = big.astype(np.float64) / 255
    fg = (m > 0.85).astype(np.uint8)
    bg = (m < 0.15).astype(np.uint8)
    r = max(3, int(round(1.6 * S)))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    fg = cv2.erode(fg, k)
    bg = cv2.erode(bg, k)
    tri = np.full(m.shape, 0.5)
    tri[fg > 0] = 1
    tri[bg > 0] = 0
    alpha = np.clip(estimate_alpha_cf(img, tri), 0, 1)
    F = estimate_foreground_ml(img, alpha)
    # înapoi la rezoluția fotografiei: medie pe culori PREMULTIPLICATE
    h, w = alpha.shape[0] // S, alpha.shape[1] // S
    a = alpha[:h * S, :w * S].reshape(h, S, w, S).mean(axis=(1, 3))
    pm = (F * alpha[..., None])[:h * S, :w * S].reshape(h, S, w, S, 3).mean(axis=(1, 3))
    F1 = np.where(a[..., None] > 1e-4, pm / np.maximum(a[..., None], 1e-4), 0)
    return np.clip(a, 0, 1), np.clip(F1, 0, 1)


def poly_mask(shape, polys, ss=4):
    """Poligoane → mască cu margini netede (rasterizare supra-eșantionată)."""
    h, w = shape
    im = Image.new('L', (w * ss, h * ss), 0)
    d = ImageDraw.Draw(im)
    for p in polys:
        d.polygon([(x * ss, y * ss) for x, y in p], fill=255)
    return np.asarray(im.resize((w, h), Image.BOX), dtype=np.float64) / 255


def capsule(shape, a, b, r):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy or 1
    t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / L2, 0, 1)
    d = np.hypot(xx - (ax + t * vx), yy - (ay + t * vy))
    return np.clip(r + 0.5 - d, 0, 1), t


def fill_vertical(img, hole, valid):
    """Completează golul de pe haină PE VERTICALĂ: fiecare coloană, între pixelul
    bun de deasupra și cel de dedesubt. Marginile hainei (reverul, nasturii,
    cămașa) sunt aproape verticale la un om văzut din față, deci se refac corect
    (o completare „în toate direcțiile" le-ar amesteca într-o pată)."""
    out = img.copy()
    H = hole.shape[0]
    for x in np.unique(np.nonzero(hole)[1]):
        col = hole[:, x]
        y = 0
        while y < H:
            if not col[y]:
                y += 1
                continue
            y0 = y
            while y < H and col[y]:
                y += 1
            ya, yb = y0 - 1, y
            while ya >= 0 and not valid[ya, x]:
                ya -= 1
            while yb < H and not valid[yb, x]:
                yb += 1
            if ya >= 0 and yb < H:
                f = (np.arange(y0, y) - ya) / (yb - ya)
                out[y0:y, x] = img[ya, x] * (1 - f[:, None]) + img[yb, x] * f[:, None]
            elif ya >= 0:
                out[y0:y, x] = img[ya, x]
            elif yb < H:
                out[y0:y, x] = img[yb, x]
    return out


def skin_mask(rgb):
    import cv2
    ycc = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb).astype(np.int32)
    Y, Cr, Cb = ycc[..., 0], ycc[..., 1], ycc[..., 2]
    return ((Cr >= 136) & (Cr <= 178) & (Cb >= 80) & (Cb <= 128) & (Y > 60)).astype(np.float64)


# ─── completarea fundalului în spatele profesorului ──────────────────────────
def fill_plate(rgb, hole, exclude=None):
    """Locul profesorului se completează din ce e în jur. Pentru o tablă sau un
    perete (suprafețe netede): o suprafață netedă potrivită pe pixelii tablei din
    jur (fără pupitru sau alte obiecte), plus granulația fină a fotografiei, ca
    să nu pară pictat. Dacă fundalul nu e neted, completare „biarmonică"."""
    from skimage.restoration import inpaint_biharmonic
    import cv2
    ys, xs = np.nonzero(hole)
    if len(ys) == 0:
        return rgb.copy()
    pad = 24
    y0, y1 = max(0, ys.min() - pad), min(rgb.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(rgb.shape[1], xs.max() + pad + 1)
    sub = rgb[y0:y1, x0:x1].astype(np.float64) / 255
    hm = hole[y0:y1, x0:x1].astype(bool)
    ex = exclude[y0:y1, x0:x1].astype(bool) if exclude is not None else np.zeros_like(hm)
    # granulația din jur (zgomotul fotografiei)
    blur = cv2.GaussianBlur(sub, (0, 0), 1.2)
    ring = cv2.dilate(hm.astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool) & ~hm & ~ex
    noise_std = (sub - blur)[ring].std(axis=0) if ring.any() else np.array([0.004] * 3)
    # suprafața netedă (polinom de gradul 2 pe fiecare canal, cu eliminarea abaterilor)
    yy, xx = np.nonzero(ring)
    filled = None
    if len(yy) > 50:
        sx, sy = max(1, x1 - x0), max(1, y1 - y0)
        def basis(xv, yv):
            u, v = xv / sx, yv / sy
            return np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], axis=1)
        A = basis(xx.astype(np.float64), yy.astype(np.float64))
        vals = sub[yy, xx]
        keep = np.ones(len(yy), bool)
        for _ in range(3):
            coef, *_ = np.linalg.lstsq(A[keep], vals[keep], rcond=None)
            res = vals - A @ coef
            s = res[keep].std(axis=0) + 1e-6
            keep = np.all(np.abs(res) < 2.5 * s, axis=1)
        if res[keep].std() < 0.03:
            gy, gx = np.mgrid[0:sub.shape[0], 0:sub.shape[1]]
            poly = (basis(gx.ravel().astype(np.float64), gy.ravel().astype(np.float64)) @ coef).reshape(sub.shape)
            # corecția de la margine (ca la „Poisson blending"): diferența dintre
            # fotografie și suprafață pe conturul golului, prelungită lin înăuntru
            valid = (~hm & ~ex).astype(np.float32)
            num = cv2.GaussianBlur(((sub - poly) * valid[..., None]).astype(np.float32), (0, 0), 2.0)
            den = cv2.GaussianBlur(valid, (0, 0), 2.0)[..., None]
            resid = np.where(den > 1e-3, num / np.maximum(den, 1e-3), 0).astype(np.float64)
            resid[ex] = 0
            filled = poly + inpaint_biharmonic(resid, hm, channel_axis=-1)
    if filled is None:
        filled = inpaint_biharmonic(sub, hm, channel_axis=-1)
    rng = np.random.default_rng(7)
    n = rng.normal(0, 1, sub.shape[:2])[..., None] * noise_std * 0.55
    n = cv2.GaussianBlur(n.astype(np.float32), (0, 0), 0.8)
    if n.ndim == 2:
        n = n[..., None]
    filled = np.where(hm[..., None], filled + n, sub)
    out = rgb.copy()
    out[y0:y1, x0:x1] = (np.clip(filled, 0, 1) * 255 + 0.5).astype(np.uint8)
    return out


# ─── plasele de triunghiuri ──────────────────────────────────────────────────
def tessellation():
    from mediapipe.python.solutions import face_mesh_connections as C
    edges = set()
    for a, b in C.FACEMESH_TESSELATION:
        edges.add((min(a, b), max(a, b)))
    adj = {}
    for a, b in edges:
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    tris = set()
    for a, b in edges:
        for c in adj[a] & adj[b]:
            tris.add(tuple(sorted((a, b, c))))
    return sorted(tris)


def clean_tris(tris, P):
    from collections import Counter
    cnt = Counter()
    for t in tris:
        for e in ((t[0], t[1]), (t[1], t[2]), (t[0], t[2])):
            cnt[e] += 1
    out = []
    for t in tris:
        es = ((t[0], t[1]), (t[1], t[2]), (t[0], t[2]))
        if all(cnt[e] >= 3 for e in es):
            continue
        a, b, c = P[t[0]], P[t[1]], P[t[2]]
        area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(area) < 1e-6:
            continue
        out.append(t)
    return out


def strip(up, lo):
    tris = []
    for k in range(len(up) - 1):
        a, b, c, d = up[k], lo[k], up[k + 1], lo[k + 1]
        if a != b:
            tris.append((a, b, c))
        if c != d:
            tris.append((c, b, d))
    return tris


def body_mesh(L, cover, E):
    """Plasa corpului: tesselarea feței (gura și ochii = găuri, ochii umpluți cu
    o fâșie pentru clipit) + o grilă deasă peste restul siluetei, triangulată cu
    conturul feței ca muchie obligatorie."""
    import triangle as tr
    face_tris = clean_tris(tessellation(), L)
    face_tris += strip(EYE_A_UP, EYE_A_LO) + strip(EYE_B_UP, EYE_B_LO)
    oval = FACE_OVAL
    O = L[oval, :2]
    fc = O.mean(axis=0)
    h, w = cover.shape
    extras = []
    grid = {}
    g = max(4.0, E * 0.42)

    def ok(p, minsep):
        if not (0 <= p[0] <= w - 1 and 0 <= p[1] <= h - 1):
            return False
        gx, gy = int(p[0] // minsep), int(p[1] // minsep)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in grid.get((gx + dx, gy + dy), ()):
                    if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < minsep ** 2:
                        return False
        for q in O:
            if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < (minsep * 0.75) ** 2:
                return False
        return True

    def add(p, minsep):
        if ok(p, minsep):
            extras.append(p)
            grid.setdefault((int(p[0] // minsep), int(p[1] // minsep)), []).append(p)

    for s, step in ((1.12, 1), (1.3, 1), (1.55, 1), (1.85, 2)):
        for k in range(0, len(O), step):
            add(fc + (O[k] - fc) * s, g * 0.7)
    face_r = np.max(np.linalg.norm(O - fc, axis=1))
    for yy in np.arange(g / 2, h, g):
        for xx in np.arange(g / 2 + (g / 2 if int(yy / g) % 2 else 0), w, g):
            if cover[int(yy), int(xx)] <= 0:
                continue
            p = np.array([xx, yy])
            if np.linalg.norm(p - fc) < face_r * 1.05:
                continue
            add(p, g * 0.8)
    extras = np.array(extras)
    V = np.vstack([O, extras])
    nO = len(O)
    seg = [[i, (i + 1) % nO] for i in range(nO)]
    t = tr.triangulate({'vertices': V, 'segments': np.array(seg), 'holes': np.array([L[1, :2]])}, 'pc')
    if 'triangles' not in t:
        die('triangularea corpului a eșuat')
    V2 = t['vertices']
    idx_map = {i: oval[i] for i in range(nO)}
    for k in range(len(V2) - nO):
        idx_map[nO + k] = 478 + k
    outer = []
    for tri in t['triangles']:
        cx, cy = V2[tri].mean(axis=0)
        # triunghiurile complet în afara siluetei (și departe de ea) nu ne trebuie
        if all(cover[int(min(h - 1, max(0, V2[v][1]))), int(min(w - 1, max(0, V2[v][0])))] <= 0 for v in tri) and \
                cover[int(min(h - 1, max(0, cy))), int(min(w - 1, max(0, cx)))] <= 0:
            continue
        outer.append(tuple(idx_map[int(v)] for v in tri))
    pts = np.vstack([L[:, :2], V2[nO:]])
    tris = [tuple(int(x) for x in tri) for tri in face_tris] + outer
    return pts, tris


def grid_mesh(mask, step):
    """O plasă simplă (Delaunay) pe o regiune mică — pentru antebrațe."""
    import triangle as tr
    h, w = mask.shape
    pts = []
    for yy in np.arange(0, h + 0.01, step):
        for xx in np.arange(0, w + 0.01, step):
            y0, y1 = int(max(0, yy - step)), int(min(h, yy + step + 1))
            x0, x1 = int(max(0, xx - step)), int(min(w, xx + step + 1))
            if mask[y0:y1, x0:x1].max() > 0:
                pts.append([min(xx, w), min(yy, h)])
    pts = np.array(pts, dtype=np.float64)
    t = tr.triangulate({'vertices': pts}, '')
    return t['vertices'], [tuple(int(v) for v in tri) for tri in t['triangles']]


def quad_aspect(q):
    if not q:
        return None
    top = math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])
    left = math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1])
    return round(top / max(1, left), 3)


def main():
    import cv2
    ap = argparse.ArgumentParser(description='Construiește scena animată (rig v2) a profesorului virtual.')
    ap.add_argument('--scena', required=True, help='fișierul JSON al scenei')
    ap.add_argument('--out', required=True)
    ap.add_argument('--viz', default=None, help='(opțional) un dosar unde se salvează imagini de control')
    a = ap.parse_args()

    cfg = json.load(open(a.scena, encoding='utf-8'))
    foto = os.path.join(os.path.dirname(os.path.abspath(a.scena)), cfg['foto'])
    im = ImageOps.exif_transpose(Image.open(foto)).convert('RGB')
    rgb = np.array(im)
    H, W = rgb.shape[:2]
    log(f'fotografia: {W}x{H}')

    # 1) fața, cu adâncime
    L = face_landmarks(rgb)
    if L is None:
        die('nu am găsit nicio față în fotografie')
    L = L[:478]
    E = float(np.linalg.norm(L[468, :2] - L[473, :2]))      # distanța dintre pupile
    face_h = float(np.linalg.norm(L[10, :2] - L[152, :2]))
    log(f'fața: distanța dintre pupile {E:.1f}px, înălțimea feței {face_h:.1f}px')

    # 2) zona profesorului, scheletul și decupajul fin
    fx, fy = L[:, 0].mean(), L[:, 1].mean()
    bx0 = int(max(0, fx - face_h * 3.2)); bx1 = int(min(W, fx + face_h * 3.2))
    by0 = int(max(0, fy - face_h * 1.1)); by1 = int(min(H, fy + face_h * 4.6))
    S = 4
    kp, m_big, big = pose_and_masks(rgb, (bx0, by0, bx1, by1), S=S)
    if kp is None:
        die('nu am găsit scheletul (umeri, brațe) — fotografia trebuie să-l arate pe profesor până la brâu')
    alpha_r, F_r = matte(big, m_big, S)
    alpha = np.zeros((H, W)); F = np.zeros((H, W, 3))
    hh, ww = alpha_r.shape
    alpha[by0:by0 + hh, bx0:bx0 + ww] = alpha_r
    F[by0:by0 + hh, bx0:bx0 + ww] = F_r
    alpha[alpha < 0.02] = 0
    log('decupajul: gata')

    # 3) ce stă în fața profesorului (pupitrul): rămâne în prim-plan
    fg_polys = cfg.get('prim_plan') or []
    occ = poly_mask((H, W), fg_polys) if fg_polys else np.zeros((H, W))
    # corpul continuă „în spatele" pupitrului: prelungim ultimele rânduri vizibile,
    # ca să nu apară o margine când profesorul se mișcă puțin
    if fg_polys:
        ext = int(max(8, face_h * 0.5))
        for x in range(W):
            col = alpha[:, x]
            occ_col = occ[:, x]
            ys = np.nonzero(occ_col > 0.5)[0]
            if len(ys) == 0:
                continue
            ytop = ys.min()
            yb = ytop - 1
            while yb > 0 and alpha[yb, x] < 0.5 and ytop - yb < 4:
                yb -= 1
            if alpha[yb, x] < 0.5:
                continue
            for y in range(yb + 1, min(H, ytop + ext)):
                alpha[y, x] = max(alpha[y, x], alpha[yb, x])
                F[y, x] = F[yb, x]
            alpha[ytop:ytop + ext, x] = np.maximum(alpha[ytop:ytop + ext, x], alpha[yb, x])

    # 4) antebrațele cu mâinile — straturi separate, ca să poată gesticula
    limbs = []
    body_alpha = alpha.copy()
    body_F = F.copy()
    sh = [np.array(kp['sh_R'][:2]), np.array(kp['sh_L'][:2])]
    hp = [np.array(kp['hp_R'][:2]), np.array(kp['hp_L'][:2])]
    shw = np.linalg.norm(sh[1] - sh[0])
    # trunchiul (în spatele mâinilor e haina, nu tabla): un trapez umeri → șolduri
    torso_poly = [
        sh[0] + (sh[0] - sh[1]) * 0.22, sh[1] + (sh[1] - sh[0]) * 0.22,
        hp[1] + (hp[1] - hp[0]) * 0.55 + np.array([0, face_h]), hp[0] + (hp[0] - hp[1]) * 0.55 + np.array([0, face_h]),
    ]
    torso = poly_mask((H, W), [[tuple(p) for p in torso_poly]])
    extra = cfg.get('extra_mana') or {}
    skin = skin_mask(rgb)
    if cfg.get('brate', 'auto') == 'auto':
        for side in ('R', 'L'):
            el, wr = np.array(kp['el_' + side][:2]), np.array(kp['wr_' + side][:2])
            hand_pts = np.array([kp[k + '_' + side][:2] for k in ('wr', 'ix', 'pk', 'th')])
            if min(kp[k + '_' + side][2] for k in ('el', 'wr', 'ix')) < 0.5:
                continue
            hc = hand_pts.mean(axis=0)
            fore = np.linalg.norm(wr - el)
            if fore < E * 0.8:
                continue
            tip = hc + (hc - wr) * 0.9
            # mâna: pielea din jurul palmei + ce ține în mână (config)
            rr = max(E * 0.75, np.linalg.norm(hand_pts - hc, axis=1).max() * 1.9)
            reg, _ = capsule((H, W), wr, tip, rr)
            hand = skin * (reg > 0.5)
            hand = cv2.morphologyEx(hand.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
            nlab, lab = cv2.connectedComponents(hand)
            if nlab > 1:
                cxy = hc.astype(int)
                best, bd = 0, 1e9
                for k in range(1, nlab):
                    yy, xx = np.nonzero(lab == k)
                    dd = np.min(np.hypot(xx - cxy[0], yy - cxy[1]))
                    if dd < bd:
                        best, bd = k, dd
                hand = (lab == best).astype(np.uint8)
            hand = cv2.dilate(hand, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))).astype(np.float64)
            if extra.get(side):
                hand = np.maximum(hand, poly_mask((H, W), [extra[side]]))
            # antebrațul: o „capsulă" de la jumătatea lui până la încheietură
            rf = max(E * 0.55, 5)
            cap, t = capsule((H, W), el + (wr - el) * 0.2, wr, rf)
            ramp = np.clip((t - 0.15) / 0.3, 0, 1)                       # se topește spre cot
            lm = np.maximum(hand, cap * ramp)
            lm = cv2.GaussianBlur(lm.astype(np.float32), (0, 0), 0.6).astype(np.float64)
            la = np.clip(lm, 0, 1) * alpha
            if la.sum() < 20:
                continue
            ys, xs = np.nonzero(la > 0.01)
            x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
            limbs.append({'side': side, 'rect': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)], 'alpha': la,
                          'elbow': el, 'wrist': wr, 'tip': tip})
            # corpul, fără antebraț: culorile hainei completate în spatele lui
            hole = (lm > 0.35) & (cap * ramp + hand > 0.35)
            hole &= ~((cap > 0) & (t < 0.3))
            hole = cv2.dilate(hole.astype(np.uint8), np.ones((3, 3), np.uint8))
            valid = (alpha > 0.6) & (hole == 0) & (cv2.dilate((skin * (reg > 0)).astype(np.uint8), np.ones((5, 5), np.uint8)) == 0)
            fill = fill_vertical(body_F, hole > 0, valid)
            fill = cv2.GaussianBlur(fill.astype(np.float32), (0, 0), 0.9).astype(np.float64)
            body_F = np.where(hole[..., None] > 0, fill, body_F)
            # în spatele mâinii: haina (în trunchi) sau tabla (în afara lui)
            body_alpha = np.where(hole > 0, np.maximum(body_alpha * (1 - lm), torso * alpha), body_alpha)
        log(f'antebrațe separate: {len(limbs)}')

    # 5) fundalul fără profesor
    near_t = cv2.dilate((alpha > 0.005).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))) > 0
    # marginea de sus a pupitrului „amestecată" cu haina din spate: o refacem pe
    # orizontală din marginea vizibilă din stânga și din dreapta profesorului
    repaired = rgb.copy()
    if fg_polys:
        band = (occ > 0.02) & (cv2.erode((occ > 0.98).astype(np.uint8), np.ones((5, 5), np.uint8)) == 0)
        band = cv2.dilate(band.astype(np.uint8), np.ones((3, 1), np.uint8)) > 0
        for y in np.unique(np.nonzero(band & near_t)[0]):
            row_bad = near_t[y] & band[y]
            xs_bad = np.nonzero(row_bad)[0]
            good = np.nonzero(band[y] & ~near_t[y])[0]
            if len(good) < 2:
                continue
            for c in range(3):
                repaired[y, xs_bad, c] = np.interp(xs_bad, good, rgb[y, good, c].astype(np.float64)).astype(np.uint8)
    hole = near_t & ~(occ > 0.5)
    plate = fill_plate(repaired, hole, exclude=cv2.dilate((occ > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
    log('fundalul: completat')

    # 6) atlasul: [corp | antebraț 1 | antebraț 2]
    ys, xs = np.nonzero(body_alpha > 0.01)
    bx0, by0, bx1, by1 = xs.min() - 2, ys.min() - 2, xs.max() + 3, ys.max() + 3
    parts = [('body', [int(bx0), int(by0), int(bx1 - bx0), int(by1 - by0)], body_alpha, body_F)]
    for lb in limbs:
        x, y, w, h = lb['rect']
        parts.append(('limb', [x - 2, y - 2, w + 4, h + 4], lb['alpha'], F))
    aw = sum(p[1][2] for p in parts) + 2 * (len(parts) - 1)
    ah = max(p[1][3] for p in parts)
    atlas = np.zeros((ah, aw, 4))
    ax = 0
    rects = []
    for kind, (x, y, w, h), al, col in parts:
        sub_a = al[y:y + h, x:x + w]
        sub_c = col[y:y + h, x:x + w]
        atlas[:h, ax:ax + w, :3] = sub_c
        atlas[:h, ax:ax + w, 3] = sub_a
        rects.append({'x': x, 'y': y, 'w': w, 'h': h, 'ax': ax, 'ay': 0})
        ax += w + 2
    # culorile de sub alfa 0 = culoarea vecinilor (fără „aură" la filtrarea texturii)
    rgb_a = (np.clip(atlas[..., :3], 0, 1) * 255).astype(np.uint8)
    holes = (atlas[..., 3] < 0.02).astype(np.uint8)
    rgb_a = cv2.inpaint(rgb_a, holes, 3, cv2.INPAINT_TELEA)
    atlas_img = np.dstack([rgb_a, (np.clip(atlas[..., 3], 0, 1) * 255 + 0.5).astype(np.uint8)])

    # 7) plasele
    br = rects[0]
    cover = cv2.dilate((body_alpha > 0.01).astype(np.uint8), np.ones((9, 9), np.uint8))
    pts, tris = body_mesh(L, cover, E)
    limb_out = []
    for lb, rc in zip(limbs, rects[1:]):
        x, y, w, h = rc['x'], rc['y'], rc['w'], rc['h']
        sub = (lb['alpha'][y:y + h, x:x + w] > 0.01).astype(np.uint8)
        V, T = grid_mesh(cv2.dilate(sub, np.ones((3, 3), np.uint8)), max(3.0, E * 0.22))
        V = V + np.array([x, y])
        limb_out.append({
            'side': lb['side'], **rc,
            'elbow': [round(float(v), 1) for v in lb['elbow']], 'wrist': [round(float(v), 1) for v in lb['wrist']],
            'tip': [round(float(v), 1) for v in lb['tip']],
            'pts': [round(float(v), 1) for p in V for v in p], 'tris': [int(v) for t in T for v in t],
        })

    # 8) prim-planul
    fg = None
    if fg_polys:
        ys, xs = np.nonzero(occ > 0.01)
        # doar partea care se suprapune (sau e aproape) de profesor
        near = cv2.dilate((alpha > 0.01).astype(np.uint8), np.ones((41, 41), np.uint8)) > 0
        ys2, xs2 = np.nonzero((occ > 0.01) & near)
        if len(ys2):
            x0, x1, y0, y1 = xs2.min(), xs2.max() + 1, ys2.min(), ys2.max() + 1
            x0 = max(0, x0 - 2); y0 = max(0, y0 - 2); x1 = min(W, x1 + 2); y1 = min(H, y1 + 2)
            fg_img = np.dstack([repaired[y0:y1, x0:x1], (occ[y0:y1, x0:x1] * 255 + 0.5).astype(np.uint8)])
            fg = {'rect': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)], 'img': fg_img}

    # 9) scriem totul
    os.makedirs(a.out, exist_ok=True)
    Image.fromarray(rgb).save(os.path.join(a.out, 'scena.jpg'), quality=88, optimize=True, progressive=True)
    Image.fromarray(plate).save(os.path.join(a.out, 'fundal.jpg'), quality=90, optimize=True, progressive=True)
    Image.fromarray(atlas_img, 'RGBA').save(os.path.join(a.out, 'actor.png'), optimize=True)
    if fg:
        Image.fromarray(fg['img'], 'RGBA').save(os.path.join(a.out, 'prim-plan.png'), optimize=True)
    x0, y0 = L[:, 0].min(), L[:, 1].min()
    x1, y1 = L[:, 0].max(), L[:, 1].max()
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 - (y1 - y0) * 0.05
    side = max(x1 - x0, y1 - y0) * 1.8
    box = (int(max(0, cx - side / 2)), int(max(0, cy - side / 2)), int(min(W, cx + side / 2)), int(min(H, cy + side / 2)))
    im.crop(box).resize((256, 256), Image.LANCZOS).save(os.path.join(a.out, 'portret.jpg'), quality=86)

    def P(p):
        return [round(float(p[0]), 1), round(float(p[1]), 1)]
    rig = {
        'v': 2, 'width': W, 'height': H,
        'photo': 'scena.jpg', 'plate': 'fundal.jpg', 'thumb': 'portret.jpg',
        'atlas': {'src': 'actor.png', 'w': int(atlas_img.shape[1]), 'h': int(atlas_img.shape[0])},
        'actor': br,
        'fg': ({'src': 'prim-plan.png', 'x': fg['rect'][0], 'y': fg['rect'][1], 'w': fg['rect'][2], 'h': fg['rect'][3]} if fg else None),
        'nLandmarks': 478, 'E': round(E, 2),
        'pts': [round(float(v), 2) for p in pts for v in p],
        'z': [round(float(v), 2) for v in L[:, 2]],
        'tris': [int(v) for t in tris for v in t],
        'limbs': limb_out,
        'pose': {
            'shoulders': [P(sh[0]), P(sh[1])], 'hips': [P(hp[0]), P(hp[1])],
            'elbows': [P(kp['el_R']), P(kp['el_L'])], 'wrists': [P(kp['wr_R']), P(kp['wr_L'])],
        },
        'board': cfg.get('tabla'), 'boardAspect': quad_aspect(cfg.get('tabla')),
        'screen': cfg.get('ecran'), 'screenAspect': quad_aspect(cfg.get('ecran')),
        'screenMode': cfg.get('ecran_mod') or 'ecran',
        'screenFloat': cfg.get('plutitor'),
        'camera': cfg.get('camera'),
    }
    # colțurile tablelor: fracții 0–1 (ca înainte)
    for k in ('board', 'screen'):
        if rig[k]:
            rig[k] = [[round(x / W, 5), round(y / H, 5)] for x, y in rig[k]]
    with open(os.path.join(a.out, 'rig.json'), 'w') as f:
        json.dump(rig, f, separators=(',', ':'))
    log(f'gata: {len(pts)} puncte, {len(tris)} triunghiuri în corp, {len(limb_out)} antebrațe → {a.out}')

    if a.viz:
        os.makedirs(a.viz, exist_ok=True)
        Image.fromarray(plate).save(os.path.join(a.viz, 'fundal.png'))
        chk = ((np.indices((ah, aw)).sum(0) // 6) % 2)[..., None] * 60 + 120
        va = atlas_img[..., 3:4] / 255
        Image.fromarray((atlas_img[..., :3] * va + chk * (1 - va)).astype(np.uint8)).resize((aw * 3, ah * 3), Image.NEAREST).save(os.path.join(a.viz, 'atlas.png'))
        vis = Image.fromarray(rgb).convert('RGB')
        d = ImageDraw.Draw(vis)
        for t in tris:
            q = [tuple(pts[i]) for i in t]
            d.polygon(q, outline=(255, 0, 0))
        for lb in limb_out:
            V = np.array(lb['pts']).reshape(-1, 2)
            for i in range(0, len(lb['tris']), 3):
                d.polygon([tuple(V[lb['tris'][i + k]]) for k in range(3)], outline=(0, 200, 255))
        vis.crop((br['x'] - 10, br['y'] - 10, br['x'] + br['w'] + 10, br['y'] + br['h'] + 10)).resize(((br['w'] + 20) * 4, (br['h'] + 20) * 4), Image.NEAREST).save(os.path.join(a.viz, 'plasa.png'))


if __name__ == '__main__':
    main()
