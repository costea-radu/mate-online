# 🎥 Ghid: Meditații live cu profesorul virtual (ca pe Zoom)

„Meditații cu AI" devine o **meditație online adevărată**: elevul alege ședința, apasă
**„Conectează-te"** și intră într-o sală de tip Zoom/Meet, unde **Prof. Radu** — un
profesor virtual care arată ca un om real, în clasă, la tablă — explică un subiect de
Evaluare Națională sau Bacalaureat **numai pe baza baremului oficial**.

| Ce vede elevul | Cum funcționează |
|---|---|
| **Programul zilnic**: 15–17, 17–19, 19–21 (EN și BAC alternează) | `api/live.js` + cron la 15 minute: creează ședințele, alege subiecte **cu barem**, pregătește lecțiile cu până la 4 ore înainte |
| **„Conectează-te"** → pregătirea (camera/microfonul tău, ca la Meet) → sala | `/meditatii` (lobby) → `/meditatii/sala/:id` (sala, pe tot ecranul) |
| **Profesorul viu, în clasă**: vorbește, respiră, își mută greutatea, întoarce capul spre tablă, gesticulează, zâmbește, dă din cap | o singură fotografie, animată în browser (WebGL), fără niciun serviciu plătit — vezi „Profesorul animat" |
| **Tabla albă** (scrie pas cu pas, în ritmul vocii) + **tabla digitală** (proiecția: enunțul, rezultatele, videoclipuri) | scrisul și proiecția stau în perspectivă pe tabla din fotografie; profesorul trece prin fața lor |
| **Întrebări grilă și cu răspuns de completat**, cu rezultatele clasei (ca Zoom Polls) | sondajele vin din barem; răspunsul corect e verificat pe server |
| **Chat**, mâna ridicată, reacții, participanți, subtitrări, „Caiet", ecran complet | Supabase Realtime (canal privat pe ședință) |
| **1-la-1, oricând** (60 min): se oprește la întrebări, „Ai înțeles?", „Explică altfel", răspunde cu voce | 8/lună incluse în abonament, apoi 20 lei |
| **Plata**: 10 lei ședința de grup fără abonament; inclusă în abonament | Stripe (plată unică), bilet în `live_tickets` |

**Fără barem, profesorul nu explică nimic:** sunt propuse doar subiectele al căror barem
a fost găsit și citit (cache-ul `ai_pdf_text`), iar explicația „pe barem" e obligatorie
la fiecare item; celelalte moduri („pe înțelesul tuturor", „greșeli care costă puncte",
„altă metodă") pornesc tot de la barem.

---

## 1. Instalare (o singură dată)

### 1.1 Baza de date
În Supabase → **SQL Editor**, rulează `supabase/meditatii_live.sql` (se poate rula de mai
multe ori). Creează tabelele `live_sessions`, `live_lessons`, `live_participants`,
`live_messages`, `live_poll_answers`, `live_tickets`, bucket-ul `live-media` (vocea
lecțiilor) și regulile pentru canalele Realtime private (`live:<id>`).

În Supabase → **Realtime → Settings**, verifică să fie permise canalele private
(„Allow public access" poate rămâne cum e — sala folosește canale private).

### 1.2 Vocea profesorului (obligatoriu pentru o experiență reală)
În Vercel → Settings → Environment Variables, UNA dintre variante:

| Variantă | Variabile | Observații |
|---|---|---|
| **Azure (recomandat)** | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (ex. `westeurope`) | vocea **ro-RO-EmilNeural** — română nativă, bărbat; cea mai naturală |
| OpenAI | `OPENAI_API_KEY` (sau `LIVE_TTS_API_KEY`) | vocea `ash`; expresivă, dar cu accent în română |

Fără cheie TTS, lecțiile merg cu vocea browserului (mult mai robotică) — doar pentru teste.
Opțional: `LIVE_TTS=azure|openai` (forțează), `LIVE_TTS_AZURE_RATE` (ex. `-5%`, mai rar),
`LIVE_PROF_RADU_VOCE_AZURE` / `LIVE_PROF_RADU_VOCE_OPENAI` (altă voce).

### 1.3 Cronul
`vercel.json` conține deja `/api/live?action=cron` la 15 minute. Ca toate cronurile
site-ului, cere `CRON_SECRET` setat în Vercel (îl ai deja, dacă merg celelalte cronuri).

### 1.4 Deploy și verificare
1. Deploy.
2. Deschide **`/meditatii/demo`** (ședință de grup demonstrativă) și **`/meditatii/demo-1la1`**
   — merg fără cont și fără bază de date.
3. În **Admin → 🎥 Meditații live**: programul zilei, subiectele, starea lecțiilor.
   Apasă **„Pregătește lecția"** la prima ședință (sau așteaptă cronul).

---

## 2. Setări (toate opționale)

| Variabilă | Implicit | Ce face |
|---|---|---|
| `LIVE_INTERVALE` | `15-17,17-19,19-21` | intervalele zilnice (ora României) |
| `LIVE_PRICE_GRUP_LEI` / `LIVE_PRICE_PRIVAT_LEI` | `10` / `20` | prețurile fără abonament |
| `LIVE_PRIVAT_INCLUSE` | `8` | ședințe 1-la-1 incluse pe lună în abonament |
| `LIVE_PRIVAT_MINUTE` | `60` | durata unei ședințe 1-la-1 |
| `LIVE_INTRARE_DEVREME_MIN` | `15` | cu cât timp înainte se deschide sala de așteptare |
| `LIVE_SONDAJ_GRILA_SEC` / `_COMPLETARE_SEC` / `_VERIFICARE_SEC` | `45` / `60` / `35` | timpul de răspuns la întrebări |
| `LIVE_PAUZA_SEC`, `LIVE_INTREBARI_SEC` | `300`, `180` | pauza din mijloc, sesiunile de întrebări |
| `LIVE_PREGATIRE_ORE` | `4` | cu câte ore înainte se pregătesc lecțiile |
| `LIVE_REFOLOSIRE_ZILE` | `21` | după câte zile se poate repeta un subiect |
| `LIVE_GEN_MODEL`, `LIVE_CHAT_MODEL` | modelele site-ului | modelul care scrie lecția / răspunde în chat |
| `LIVE_PROF_RADU_NUME`, `LIVE_PROF_RADU_BIO` | `Prof. Radu` | numele și prezentarea profesorului |

---

## 3. Profesorul animat (scena)

Scena e construită **o singură dată**, offline, dintr-o fotografie a clasei cu profesorul
(`tools/portret/scene/clasa-radu.jpg`, generată cu AI). Rezultatul stă în
`public/live/radu/` și e servit ca fișiere statice:

| Fișier | Ce e |
|---|---|
| `fundal.jpg` | clasa **fără** profesor (locul lui, completat din tabla din jur) |
| `actor.png` | profesorul decupat fin (părul, marginile hainei) + **antebrațele cu mâinile**, separat — ca să poată gesticula |
| `prim-plan.png` | pupitrul din fața lui (rămâne în față când se mișcă) |
| `rig.json` | cele 478 de repere ale feței **cu adâncime** (MediaPipe), scheletul (umeri, coate, încheieturi), plasele de triunghiuri, colțurile tablei și ale proiecției, încadrarea camerei |
| `scena.jpg`, `portret.jpg` | fotografia originală (rezervă) și miniatura din lobby |

În browser (`src/lib/live/portret.js`), profesorul e desenat în WebGL peste fundal:
gura urmează vocea (datele de buze calculate pe server din sunet, 25 cadre/s), clipește
natural (și când își mută privirea), respiră (o inspirație scurtă înainte de fiecare frază),
își mută greutatea de pe un picior pe altul, dă din cap pe silabele accentuate, iar mâna
cu markerul „bate ritmul". Lecția îl regizează: se uită spre tablă când apare un rând nou,
spre proiecție la enunțuri/rezultate/video, în notițe la începutul unui item, ascultă
zâmbind cât elevii răspund, zâmbește la „bravo", ridică sprâncenele la întrebări.
Capul se întoarce „în 3D" (după adâncimea reperelor): nasul se mișcă mai mult decât
obrajii. Fără WebGL, se vede fotografia întreagă (static), restul sălii merge normal.

### Altă fotografie (alt decor sau alt profesor)
Cerințe: profesorul **din față**, până la brâu, cu mâinile la vedere, în fața unei table
(fundal simplu), lumină bună; o persoană care și-a dat **acordul** sau una generată cu AI.

```bash
pip install mediapipe==0.10.14 opencv-contrib-python-headless numpy triangle pillow pymatting scikit-image scipy
python tools/portret/construieste_rig.py --scena tools/portret/scene/clasa-radu.json --out public/live/radu --viz /tmp/control
```
Fișierul scenei (`tools/portret/scene/*.json`) are coordonatele (în pixelii fotografiei):
zona de scris a tablei (`tabla`), proiecția (`ecran`, `ecran_mod: "proiectie"`), ce stă
în fața profesorului (`prim_plan`: poligoane), încadrarea camerei (`camera`) și, opțional,
ce ține în mână (`extra_mana`, ex. markerul). `--viz` salvează imagini de control
(fundalul completat, atlasul, plasa). Totul rulează local — nimic nu pleacă pe internet.

**Transparență:** pe ecran rămâne mereu eticheta **„Profesor virtual · AI"**, iar în
pagina de intrare scrie că vocea și imaginea sunt generate (cerință AI Act).

---

## 4. Costuri (orientativ)

- **Vocea**: o lecție de 2 ore are ~50–70 de minute de vorbire (~50.000–60.000 de caractere).
  Azure Neural ≈ 16 $ / 1 milion de caractere → ~0,8–1 $ pe lecție; OpenAI gpt-4o-mini-tts e
  în același ordin de mărime (verifică prețurile actuale ale furnizorului).
  **Lecțiile se refolosesc** (același subiect, aceeași voce) — costul e o dată pe subiect.
- **Textul lecției** (modelul care scrie explicațiile pe barem): de ordinul centimelor–zecilor
  de cenți pe subiect. Costul exact al fiecărei lecții apare în Admin → Meditații live.
- **Răspunsurile în chat** (întrebări către profesor): mici, limitate (`LIVE_INTREBARI_MAX`).
- Animația profesorului: **0 lei** (rulează în browserul elevului).

---

## 5. Confidențialitate și siguranță

- **Camera și microfonul elevului nu ajung la profesor sau la colegi**: camera e doar o oglindă
  locală, iar microfonul doar dictează întrebarea în chat (recunoașterea vorbirii a browserului —
  în Chrome, sunetul e procesat de serviciul Google al browserului, nu de ExamenMate). Elevul vede
  textul pe ecran cât vorbește; iconița de microfon apare la colegi doar ca stare, fără sunet.
- În chat și în lista de participanți apare doar **„Prenume N."**.
- Mesajele trec printr-o moderare (cuvinte, linkuri, date personale); profesorul răspunde
  doar la întrebări despre matematică/subiect.
- Accesul la canalul Realtime al unei ședințe e verificat în baza de date (RLS):
  doar cine are drept de intrare îl poate asculta.

---

## 6. Probleme frecvente

| Simptom | Cauză / soluție |
|---|---|
| „Profesorul nu are încă un subiect cu barem" | nu există subiecte EN/BAC cu barem citit; cronul citește câteva bareme la fiecare rulare (`LIVE_CRON_BAREME`), sau alege manual subiectul din Admin |
| Lecția rămâne „vocea se generează…" | lipsește cheia TTS sau a expirat; vezi Admin → coloana „Vocea" și eroarea lecției |
| Profesorul apare static (fotografie) | browserul nu are WebGL (rar) — restul sălii merge normal |
| Chatul nu apare în timp real | Supabase Realtime: canalele private trebuie permise; oricum, mesajele se reîncarcă la câteva secunde |
| Elevul nu poate intra la ora de grup | sala se deschide cu 15 minute înainte; după încheiere nu se mai poate intra |
