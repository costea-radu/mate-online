# 🎥 Ghid: Meditații live — cu profesorul virtual

„Meditații cu AI" devine o **meditație online adevărată**: elevul alege ședința, apasă
**„Conectează-te"** și intră într-o sală de tip Zoom/Meet, unde **Prof. Tudor** — un
profesor virtual care arată ca un om real, în clasă, la tablă — explică un subiect de
Evaluare Națională sau Bacalaureat **numai pe baza baremului oficial**.

| Ce vede elevul | Cum funcționează |
|---|---|
| **Programul zilnic**: la aceeași oră (implicit 17:00–19:00), **4 săli** — câte un subiect rezolvat în fiecare: **Evaluarea Națională, BAC Mate-Info, BAC Științele Naturii, BAC Tehnologic** | `api/live.js` + cron la 15 minute: creează cele 4 ședințe, alege pentru fiecare sală un subiect **complet, cu barem, al examenului ei** (niciodată de alt profil); lecția se scrie abia când vine primul elev (bilet sau sala de așteptare) |
| **Ședința comună pornește doar cu cel puțin 2 elevi** | la ora de început: ≥ 2 elevi în sală → lecția comună; **un singur elev → ședința devine 1-la-1 pentru el, fără cost în plus**; dacă lecția comună se termină înainte de sfârșitul orei → „Continuă 1-la-1” |
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

**Formulele se citesc din paginile PDF:** textul extras dintr-un PDF pierde des radicalii,
liniile de fracție, exponenții, integralele, determinanții, matricele. De aceea, la scrierea
lecției, modelul primește și **paginile PDF** ale subiectului și ale baremului (doar cele ale
secțiunii la care lucrează) și transcrie formulele în LaTeX; în sală ele se văd corect
(KaTeX, încărcat din aplicație). Un item al cărui enunț tot nu se poate citi nu se predă.
Lecțiile scrise înainte de această schimbare apar în Admin cu nota „scrisă fără paginile
PDF" — apasă **„Regenerează"** la ele.

**Pe tablă, toată rezolvarea:** la itemii cu rezolvare, profesorul scrie toți pașii din barem
(câte unul pe rând, cu punctajul); la grile, calculul care duce la răspuns. Scrisul se face
mai mic când pașii sunt mulți, ca să rămână toți la vedere. La **„Arătați că…"** (rezultatul e
în enunț), elevii încearcă întâi pe cerința reformulată **„Calculați…", fără rezultat** (cu
răspuns de completat), apoi profesorul scrie pe tablă etapele intermediare din barem, iar pe
proiecție reapare cerința din subiect.

---

## 1. Instalare (o singură dată)

### 1.1 Baza de date
În Supabase → **SQL Editor**, rulează `supabase/meditatii_live.sql` (se poate rula de mai
multe ori). Creează tabelele `live_sessions`, `live_lessons`, `live_participants`,
`live_messages`, `live_poll_answers`, `live_tickets`, bucket-ul `live-media` (vocea
lecțiilor) și regulile pentru canalele Realtime private (`live:<id>`).

În Supabase → **Realtime → Settings**, verifică să fie permise canalele private
(„Allow public access" poate rămâne cum e — sala folosește canale private).

### 1.2 Vocea profesorului (opțională — merge și gratuit)
**Fără nicio cheie, profesorul vorbește cu vocea browserului — gratuit.** Sala alege singură
cea mai bună voce românească de pe dispozitivul elevului:

| Unde | Vocea |
|---|---|
| **Microsoft Edge** (Windows/Mac) | „Emil Online (Natural)" — voce neurală, de bărbat, cea mai naturală |
| Chrome/Firefox pe Windows | „Microsoft Andrei" (dacă Windows are vocea română: Setări → Oră și limbă → Vorbire) |
| Android / iPhone / Mac | vocea românească a sistemului (poate fi o voce de femeie) |

Dacă dispozitivul nu are nicio voce românească, sala îi spune elevului ce să facă (Edge sau
vocea Windows), iar lecția merge cu subtitrări. Gura profesorului se mișcă după vocea browserului.

Pentru aceeași voce, naturală, la toți elevii (generată o dată pe lecție, pe server), în
Vercel → Settings → Environment Variables, UNA dintre variante:

| Variantă | Variabile | Observații |
|---|---|---|
| **Azure (recomandat)** | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (ex. `westeurope`) | vocea **ro-RO-EmilNeural** — română nativă, bărbat; nivelul gratuit (F0) acoperă câteva lecții pe lună |
| OpenAI | `OPENAI_API_KEY` (sau `LIVE_TTS_API_KEY`) | vocea `ash`; expresivă, dar cu accent în română |

După ce pui cheia: lecțiile gata „cu vocea browserului" primesc vocea generată automat (cronul,
înainte de ședință) sau imediat din Admin → **„Generează vocea"**. Dacă vocea generată eșuează
(cheie greșită, cotă depășită), lecția merge mai departe cu vocea browserului — nu se blochează.
Opțional: `LIVE_TTS=azure|openai|fara` (forțează), `LIVE_TTS_AZURE_RATE` (ex. `-5%`, mai rar),
`LIVE_PROF_RADU_VOCE_AZURE` / `LIVE_PROF_RADU_VOCE_OPENAI` (altă voce).

### 1.3 Cronul
`vercel.json` conține deja `/api/live?action=cron` la 15 minute. Ca toate cronurile
site-ului, cere `CRON_SECRET` setat în Vercel (îl ai deja, dacă merg celelalte cronuri).

### 1.4 Deploy și verificare
1. Deploy (ordinea față de SQL nu contează; după un deploy nou, o reîncărcare a paginii aduce
   versiunea nouă — aplicația e PWA și poate servi o dată versiunea veche din cache).
2. Deschide **`/meditatii/demo`** (ședință de grup demonstrativă) și **`/meditatii/demo-1la1`**
   — merg fără cont și fără bază de date.
3. În **Admin → 🎥 Meditații live**: programul zilei, subiectele, starea lecțiilor.
   Apasă **„Pregătește lecția"** dacă vrei o lecție scrisă din timp (altfel se scrie singură
   când intră primul elev — durează 1–3 minute, cât stă elevul în sala de așteptare).

---

## 2. Setări (toate opționale)

| Variabilă | Implicit | Ce face |
|---|---|---|
| `LIVE_INTERVALE` | `17-19` | ora ședințelor (ora României); ex. `18-20` pentru ora 18:00; mai multe: `17-19,19-21` (în fiecare interval, toate sălile) |
| `LIVE_SALI` | `en,mate-info,stiinte-naturii,tehnologic` | sălile (câte o ședință pe zi în fiecare); se pot scoate, ex. `en,mate-info` |
| `LIVE_PRICE_GRUP_LEI` / `LIVE_PRICE_PRIVAT_LEI` | `10` / `20` | prețurile fără abonament |
| `LIVE_PRIVAT_INCLUSE` | `8` | ședințe 1-la-1 incluse pe lună în abonament |
| `LIVE_PRIVAT_MINUTE` | `60` | durata unei ședințe 1-la-1 |
| `LIVE_INTRARE_DEVREME_MIN` | `15` | cu cât timp înainte se deschide sala de așteptare |
| `LIVE_SONDAJ_GRILA_SEC` / `_COMPLETARE_SEC` / `_VERIFICARE_SEC` | `45` / `60` / `35` | timpul de răspuns la întrebări |
| `LIVE_PAUZA_SEC`, `LIVE_INTREBARI_SEC` | `300`, `180` | pauza din mijloc, sesiunile de întrebări |
| `LIVE_MINIM_GRUP` | `2` | câți elevi trebuie să fie în sală la ora de început ca să pornească ședința comună (mai puțini → 1-la-1) |
| `LIVE_PDF_PAGINI` | pornit | `0` = lecția se scrie doar din textul extras (fără paginile PDF; formulele pot lipsi) |
| `LIVE_PREGATIRE_AUTO` | oprit | `1` = lecțiile se scriu din timp pentru toate ședințele (cost și când nu vine nimeni); implicit, doar când apare primul elev |
| `LIVE_PREGATIRE_ORE` | `4` | orizontul cronului: ședințele din următoarele ore pentru care pregătește lecții (cu elevi) / generează vocea |
| `LIVE_REFOLOSIRE_ZILE` | `21` | după câte zile se poate repeta un subiect |
| `LIVE_GEN_MODEL`, `LIVE_CHAT_MODEL` | modelele site-ului | modelul care scrie lecția / răspunde în chat |
| `LIVE_PROF_RADU_NUME`, `LIVE_PROF_RADU_BIO` | `Prof. Tudor` | numele și prezentarea profesorului (id-ul intern a rămas `radu`) |

---

## 3. Profesorul animat (scena)

Scena e construită **o singură dată**, offline, dintr-o fotografie a clasei cu profesorul
(acum `tools/portret/scene/clasa-tudor.jpg`, generată cu AI; cea veche, `clasa-radu.jpg`, a
rămas ca rezervă). Încadrarea e strânsă pe tablă și profesor (pereții și băncile tăiate); pe
ecranele late (ex. cu chatul deschis) tabla și proiecția rămân întregi. Rezultatul stă în
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
python tools/portret/construieste_rig.py --scena tools/portret/scene/clasa-tudor.json --out public/live/radu --viz /tmp/control
```
Fișierul scenei (`tools/portret/scene/*.json`) are coordonatele (în pixelii fotografiei):
zona de scris a tablei (`tabla`), proiecția (`ecran`, `ecran_mod: "proiectie"`), ce stă
în fața profesorului (`prim_plan`: poligoane), încadrarea camerei (`camera`) și, opțional,
ce ține în mână (`extra_mana`, ex. markerul) și `maini_impreuna: true` când ține ceva cu
amândouă mâinile (mâinile se mișcă atunci împreună). `--viz` salvează imagini de control
(fundalul completat, atlasul, plasa). Totul rulează local — nimic nu pleacă pe internet.

**Transparență:** pe ecran rămâne mereu eticheta **„Profesor virtual · AI"**, iar în
pagina de intrare scrie că vocea și imaginea sunt generate (cerință AI Act).

---

## 4. Costuri (orientativ, septembrie 2026 — verifică prețurile furnizorilor)

- **Vocea browserului** (fără chei): **0 lei**.
- **Vocea generată** (opțional): o lecție de 2 ore are ~50.000–60.000 de caractere rostite.
  Azure Neural ≈ 16 $ / 1 milion de caractere → ~0,8–1 $ (≈ 4–4,5 lei) pe lecție; nivelul
  gratuit Azure F0 (500.000 de caractere/lună) acoperă ~8 lecții noi pe lună.
  OpenAI gpt-4o-mini-tts ≈ 0,015 $/minut → ~0,8–1 $ pe lecție.
  **Lecțiile se refolosesc** (același subiect, aceeași voce) — costul e o dată pe subiect.
- **Textul lecției** (modelul care scrie explicațiile pe barem): ~1,5–5 lei pe subiect nou, o
  singură dată (apoi se refolosește). Se plătește doar când vine cineva (vezi `LIVE_PREGATIRE_AUTO`).
  Cu 4 săli: cel mult 4 lecții noi pe zi (doar în sălile în care intră elevi) — ~6–20 lei/zi în
  cel mai rău caz; costul scade singur, pentru că o sală refolosește lecțiile gata după ce și-a
  parcurs subiectele (se repetă după `LIVE_REFOLOSIRE_ZILE`, implicit 21 de zile).
  Costul exact al fiecărei lecții apare în Admin → Meditații live.
- **Răspunsurile în chat** (întrebări către profesor): bani mărunți, limitate (`LIVE_INTREBARI_MAX`).
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
| Enunț fără radical / fracție („2 2 6 2 3 2") sau „[formula nu e lizibilă]" | lecție scrisă înainte de citirea paginilor PDF → Admin → „Lecțiile recente" → **Regenerează** |
| „Profesorul nu are încă un subiect cu barem" | nu există subiecte EN/BAC cu barem citit; cronul citește câteva bareme la fiecare rulare (`LIVE_CRON_BAREME`), sau alege manual subiectul din Admin |
| Profesorul nu vorbește (doar subtitrări) | dispozitivul nu are o voce românească → Edge (voce naturală, gratuită) sau vocea română în Windows; verifică și volumul/tab-ul fără sonor |
| Vocea generată nu apare | lipsește cheia TTS sau a expirat; lecția merge cu vocea browserului — vezi Admin → eroarea lecției, apoi „Generează vocea" |
| „Ședința s-a încheiat" mult înainte de sfârșitul orei | subiectul era scurt (o fișă, nu un subiect complet); acum ședințele de grup aleg subiecte complete, iar elevul poate „Continuă 1-la-1" până la sfârșitul orei |
| Un singur elev la ora de grup | normal: ședința devine 1-la-1 pentru el (fără cost în plus); `LIVE_MINIM_GRUP` schimbă pragul |
| O sală (ex. BAC Tehnologic) scrie „Subiectul se anunță în curând" | nu există încă niciun subiect al acelui examen cu barem citit; sala nu primește subiecte de alt profil. Cronul citește întâi baremele pentru ea (Admin → „Subiecte cu barem, pe săli" arată câte are fiecare), sau încarcă subiecte + bareme pentru acel profil |
| Profesorul apare static (fotografie) | browserul nu are WebGL (rar) — restul sălii merge normal |
| Chatul nu apare în timp real | Supabase Realtime: canalele private trebuie permise; oricum, mesajele se reîncarcă la câteva secunde |
| Elevul nu poate intra la ora de grup | sala se deschide cu 15 minute înainte; după încheiere nu se mai poate intra |
