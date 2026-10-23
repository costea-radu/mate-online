# Iconul ExamenMate (ΣxamenMate)

Sursa: `logo-src.jpg`, logo-ul desenat de Radu: Σ e „E” din Examen, iar întors cu 90°, Σ devine „M” din „Mate”.

| Pas | Fișier | Ce face |
|---|---|---|
| 1 | `trace.py` | trasează poza în curbe vectoriale (potrace) → `logo-path.txt` |
| 2 | `gen.py` | stilul: fundal navy `#1a3a5c` cu lumină de sus, logo auriu `#f0c040` cu gradient metalic, îngroșat (contur de 12 px pe poză), umbră |
| 3 | `build_all.py` | randează toate iconurile (Chromium) în `public/`, `play-assets/`, `android-twa/…/res/` |

```bash
pip install potracer playwright pillow numpy   # o singură dată
cd tools/icon
python trace.py        # doar dacă schimbi poza
python build_all.py    # scrie iconurile în repo
```

Favicon-ul (`public/favicon.svg`) e vectorial, fără umbră și un pic mai gros, ca să se vadă la 16–32 px.
Aplicația Android: după ce schimbi iconurile, urci o versiune nouă (vezi `android-twa/GHID_PLAY_STORE.md`, §8).
