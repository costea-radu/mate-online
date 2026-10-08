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
| **Tabla albă** din spatele profesorului (scrie pas cu pas, în ritmul vocii) + **proiecția** din dreapta ei (enunțul, rezultatele, videoclipuri) | scrisul și proiecția stau în perspectivă pe tabla din fotografie; profesorul trece prin fața lor. Fără panou separat „Tabla digitală”. **Pe telefon** (tabla și proiecția nu încap citibil deodată) camera se oprește pe una dintre ele: butonul **„✎ Explicația / 📝 Exercițiul”** sau o glisare stânga/dreapta o mută, iar tabla primește culoarea și rama ei |
| **Întrebări grilă și cu răspuns de completat**, cu rezultatele clasei (ca Zoom Polls) | sondajele vin din barem; răspunsul corect e verificat pe server |
| **Întrebări pe pași** la problemele grele (Subiectele II și III): explicația se oprește înaintea rezultatelor intermediare din barem — elevul calculează pasul și răspunde pe ecran (cu „💡 Indiciu"; la 1-la-1 și „🤷 Nu știu — arată-mi"), apoi profesorul îl scrie pe tablă; **cel puțin o întrebare la fiecare subpunct** | `it.steps` în lecție (scrise odată cu lecția, verificate determinist); lecțiile vechi le primesc o singură dată, la prima folosire — vezi secțiunea 3c |
| **Chat**, mâna ridicată, reacții, participanți, subtitrări, „Caiet", ecran complet (pe telefon: sus, în dreapta — se vede și ținut vertical; ce nu încape în bară stă în „⋯ Mai mult") | Supabase Realtime (canal privat pe ședință) |
| **1-la-1, oricând** (60 min, **prelungite până termini exercițiile**): elevul **alege exercițiile** (📋 — ex. S. I ex. 5, S. II ex. 2 b), S. III ex. 1 c), nu neapărat la rând); se oprește la întrebări, „Ai înțeles?", „Explică altfel", răspunde cu voce | 8/lună incluse în abonament, apoi 20 lei; prelungirea e fără cost în plus — vezi secțiunea 3b |
| **🎓 Pregătire de examen** (din „Planul meu"): aceeași clasă, dar profesorul propune ordinea — S. I ex. 1 → ex. 2 → … → S. II → S. III, câte cel puțin 10 exerciții pe poziție, apoi un test; elevul poate alege **orice exercițiu** (la BAC și doar un subpunct a/b/c), fără limită de timp | `/meditatii/pregatire` (`?pos=II.2.b` = începe direct acolo); exercițiile vin din lecțiile de aici — vezi secțiunea 3 |
| **Plata**: 10 lei ședința de grup fără abonament; inclusă în abonament | Stripe (plată unică), bilet în `live_tickets` |
| **🎁 Meditații gratuite** (implicit **două**: una de EN, una de BAC): lecții pregătite pe care oricine are cont le face **1-la-1, fără abonament și fără plată** — la vedere în lobby, chiar sub prezentare, cu „▶ Începe gratuit" | alese automat până le alegi tu din **Admin → 🎥 Meditații live → „🎁 Meditațiile gratuite"** (sau „🎁 Fă-o gratuită" la o lecție) — vezi secțiunea 3d |

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

**Interactiv la fiecare pas:** la problemele de la Subiectele II și III, profesorul nu doar scrie
pașii — se oprește înaintea fiecărui rezultat intermediar din barem și îi pune pe elevi să-l
calculeze (cel puțin o dată la fiecare subpunct a), b), c)). Detalii în secțiunea 3c.

---

## 1. Instalare (o singură dată)

### 1.1 Baza de date
În Supabase → **SQL Editor**, rulează `supabase/meditatii_live.sql` (se poate rula de mai
multe ori). Creează tabelele `live_sessions`, `live_lessons`, `live_participants`,
`live_messages`, `live_poll_answers`, `live_tickets`, bucket-ul `live-media` (vocea
lecțiilor) și regulile pentru canalele Realtime private (`live:<id>`).

În Supabase → **Realtime → Settings**, verifică să fie permise canalele private
(„Allow public access" poate rămâne cum e — sala folosește canale private).

Pentru **meditațiile gratuite** alese de tine (secțiunea 3d), rulează o dată și
`supabase/setari_ordine_gratuite.sql` (tabela `app_settings` — setările alese din Admin;
același script face și opțiunea „📥 Materialele noi apar: ultimele" din Tot Conținutul).
Fără el merge tot: sunt gratuite cele două lecții alese automat, doar că nu le poți schimba.

### 1.2 Vocea profesorului (opțională — merge și gratuit)
**Fără nicio cheie, profesorul vorbește cu vocea browserului — gratuit.** Sala alege singură
cea mai bună voce românească de pe dispozitivul elevului:

| Unde | Vocea |
|---|---|
| **Microsoft Edge** (Windows/Mac) | „Emil Online (Natural)" — voce neurală, de bărbat, cea mai naturală |
| Chrome/Firefox pe Windows | „Microsoft Andrei" (dacă Windows are vocea română: Setări → Oră și limbă → Vorbire) |
| Android / iPhone / Mac | vocea românească a sistemului — pe iPhone, iPad și Mac e „Ioana", **voce de femeie** (Apple nu are o voce românească de bărbat), pe Android de obicei tot de femeie |

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

**1-la-1 pornit înainte să fie gata toată vocea generată:** restul vocii se generează în fundal,
cât elevul lucrează — întâi de la itemul la care a ajuns (dacă a sărit înainte cu **⏭ Înainte**),
apoi restul. Ce nu e gata la timp (după ~4,5 secunde de „Profesorul își aranjează notițele…")
se rostește cu vocea browserului, iar ce se generează între timp se aude generat — lecția nu
se mai oprește.

**Vocea de bărbat pe toate dispozitivele = vocea generată.** Pe iPhone vocea browserului e
mereu de femeie, deci Prof. Tudor are voce de bărbat acolo doar când lecția are vocea generată
(Azure „Emil" sau OpenAI „ash"). Ce vorbește încă cu vocea browserului: demo-urile
(`/meditatii/demo`, `/meditatii/demo-1la1`), Pregătirea de examen și cele câteva fraze de rezervă
din 1-la-1 (când vocea generată nu e gata la timp). În Admin → 🎥 Meditații live, sus, „Vocea:" arată
furnizorul folosit (`openai`, `azure` sau „lipsă").

**iPhone / iPad — sunetul (8 octombrie 2026):** iOS tratează Web Audio (prin care se aude
vocea generată) ca sunet „ambiental": cu telefonul pe **Silențios** (comutatorul de pe lateral
sau butonul Action) îl tăia complet, deși demo-ul (vocea browserului) se auzea. Acum, la
„Participă acum", sala cere sesiunea audio **„playback"** (Audio Session API, iOS 16.4+) — se
aude ca un video, și pe Silențios (muzica din alte aplicații se oprește cât e elevul în sală);
pe iOS mai vechi pornește în buclă un `<audio>` cu liniște, care face același lucru. După o
întrerupere (apel, ecran blocat, alt tab, microfonul) sunetul se reia la prima atingere, iar dacă
browserul tot îl ține oprit, sus apare **„🔊 Pornește sunetul"**. Microfonul (dictarea) trece pe
„play-and-record" cât ascultă. La ieșirea din sală sesiunea revine la „auto". Cod:
`src/lib/live/audio.js`; teste: `test/sunet-iphone.test.js`.

### 1.3 Cronul
`vercel.json` conține deja `/api/live?action=cron` la 15 minute. Ca toate cronurile
site-ului, cere `CRON_SECRET` setat în Vercel (îl ai deja, dacă merg celelalte cronuri).

### 1.4 Deploy și verificare
1. Deploy (ordinea față de SQL nu contează; după un deploy nou, o reîncărcare a paginii aduce
   versiunea nouă — aplicația e PWA și poate servi o dată versiunea veche din cache).
2. Deschide **`/meditatii/demo`** (ședință de grup demonstrativă) și **`/meditatii/demo-1la1`**
   — merg fără cont și fără bază de date. Elevii le găsesc **chiar sus**: în lobby, butoanele
   aurii **„▶ Vezi demo-ul"** și **„▶ Demo 1-la-1"** (plus imaginea sălii, care e și ea un link spre
   demo); în „Planul meu", **„▶ Vezi demo-ul"** în rândul cu filele (pe telefon, deasupra lor) și
   în cardul pentru cei fără abonament.
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
| `LIVE_GRATUIT_LUNA` | `4` | câte meditații gratuite (1-la-1) poate porni un elev pe lună — plasă anti-abuz; peste, plătește ca de obicei |
| `LIVE_GRATUIT_INTREBARI` | `10` | la câte întrebări din chat răspunde profesorul într-o meditație gratuită (lecția merge oricum până la capăt) |
| `LIVE_PRIVAT_MINUTE` | `60` | durata unei ședințe 1-la-1 (apoi se prelungește cât elevul lucrează — vezi mai jos) |
| `LIVE_PRELUNGIRE_PAS` | `10` | cu câte minute se prelungește o dată (cererea vine din sală când mai sunt sub 5 minute) |
| `LIVE_PRELUNGIRE_MAX` | `120` | cât se poate prelungi cel mult, peste ora de sfârșit (plafon de siguranță, ex. un tab uitat deschis); `0` = fără prelungire |
| `LIVE_INTRARE_DEVREME_MIN` | `15` | cu cât timp înainte se deschide sala de așteptare |
| `LIVE_SONDAJ_GRILA_SEC` / `_COMPLETARE_SEC` / `_VERIFICARE_SEC` | `45` / `60` / `35` | timpul de răspuns la întrebări |
| `LIVE_SONDAJ_PAS_SEC` | `40` | timpul de răspuns la o întrebare pe pas (grup; la 1-la-1 profesorul așteaptă cât e nevoie) |
| `LIVE_INTREBARI_PASI` | pornit | `0` = fără întrebările pe pași (Subiectele II și III) — explicația pe barem curge ca înainte |
| `LIVE_PAUZA_SEC`, `LIVE_INTREBARI_SEC` | `300`, `180` | pauza din mijloc, sesiunile de întrebări |
| `LIVE_MINIM_GRUP` | `2` | câți elevi trebuie să fie în sală la ora de început ca să pornească ședința comună (mai puțini → 1-la-1) |
| `LIVE_PDF_PAGINI` | pornit | `0` = lecția se scrie doar din textul extras (fără paginile PDF; formulele pot lipsi) |
| `LIVE_PREGATIRE_AUTO` | oprit | `1` = lecțiile se scriu din timp pentru toate ședințele (cost și când nu vine nimeni); implicit, doar când apare primul elev |
| `LIVE_PREGATIRE_ORE` | `4` | orizontul cronului: ședințele din următoarele ore pentru care pregătește lecții (cu elevi) / generează vocea |
| `LIVE_REFOLOSIRE_ZILE` | `21` | după câte zile se poate repeta un subiect |
| `LIVE_GEN_MODEL`, `LIVE_CHAT_MODEL` | modelele site-ului | modelul care scrie lecția / răspunde în chat |
| `LIVE_PROF_RADU_NUME`, `LIVE_PROF_RADU_BIO` | `Prof. Tudor` | numele și prezentarea profesorului (id-ul intern a rămas `radu`) |

---

## 3. 🎓 Pregătire de examen (din „Planul meu")

Elevii abonați care și-au ales examenul (EN sau un profil de BAC) au în „Planul meu" cardul
**🎓 Pregătire de examen** → **`/meditatii/pregatire`**: o meditație 1-la-1 în aceeași clasă
(fotografia, Prof. Tudor animat, scrisul pe tablă, proiecția, subtitrări, chat, caiet, ecran
complet), în care **profesorul propune desfășurarea**:

1. **Poziție cu poziție, în ordinea din examen:** Subiectul I ex. 1, ex. 2, … ex. 6, apoi
   Subiectul al II-lea și al III-lea (EN: câte 6; BAC: problemele II.1, II.2, III.1, III.2).
2. **Pe fiecare poziție, doar exercițiile de pe ea**, din subiectele oficiale ale examenului
   elevului (la BAC, doar ale profilului lui), fiecare din alt subiect, explicate pe barem —
   aceiași itemi ca în lecțiile de aici (încearcă singur → rezultat → rezolvarea pe tablă →
   „Ai înțeles?" → verificare), cu vocea browserului.
3. **După cel puțin 10 exerciții, un test de verificare** (fără ajutor, exerciții noi):
   trecut (≥ 80%) → propune poziția următoare; netrecut → propune încă 5 exerciții (și
   explicația greșelilor), apoi testul din nou. Elevul poate oricând continua, cere testul,
   alege altă poziție sau trece mai departe.

Exercițiile vin din **lecțiile pe barem de aici** (`live_lessons`, profesorul `radu`). Când un
elev a lucrat toate lecțiile gata, se scrie lecția unui subiect nou (doar textul, 1–3 minute,
o singură dată — apoi o folosesc toți elevii și ședințele live). Plafon: `PREP_GENERARI_ZI`
(implicit 12 lecții noi pe elev pe zi). Progresul: `ai_meditatii_sessions` (fără SQL nou).
Setările (`PREP_EXERCITII`, `PREP_TEST_EXERCITII`, `PREP_TEST_PROBLEME`, `PREP_PRAG`,
`PREP_IN_PLUS`, `PREP_GENERARI_ZI`) sunt descrise în `GHID_MEDITATII.md` → Runda 12.

**Alegerea elevului (octombrie 2026):** profesorul propune ordinea, dar elevul poate începe cu
**orice exercițiu, nu neapărat la rând** — la intrare („📋 Cu ce începi?", cu propunerea
profesorului preselectată), în sală (🗺️ Plan) sau direct din cardul din „Planul meu" („📋 Aleg eu
exercițiul" → `/meditatii/pregatire?pos=…`). La **BAC**, problemele de la Subiectele II și III se pot
exersa și pe **subpuncte**: doar „S. II ex. 2 b)" sau doar „S. III ex. 1 c)" — din toate subiectele
oficiale ale profilului, cu progresul și testul lor (un subpunct e un singur item, deci testul are 5
exerciții); după el, profesorul propune subpunctul următor, apoi problema următoare. La EN,
problemele de la Subiectul III se lucrează întregi (așa sunt itemii lecțiilor). Pregătirea **nu are
limită de timp** (scrie și la intrare): elevul lucrează cât vrea, progresul se salvează după fiecare
exercițiu.

---

## 3b. Alegerea exercițiilor și prelungirea (1-la-1, octombrie 2026)

- **„📋 Exerciții"** (în sală, la 1-la-1 și la ședința de grup ținută 1-la-1): lista exercițiilor
  lecției, pe subiecte — **orice exercițiu, nu neapărat la rând**: S. I ex. 5, S. II ex. 2 b),
  S. III ex. 1 c)… Bifele arată ce a rezolvat corect (✓), ce are de revăzut (✗) și ce a văzut (•).
  După exercițiul ales, profesorul **se oprește și întreabă ce urmează**: „▶ Mai departe: …",
  „📋 Aleg alt exercițiu", „⏩ Continuă în ordine, fără să mă mai întrebi" sau „🏁 Ajunge pentru azi".
- **Alegerea se poate face și înainte de conectare**: în lobby, la 1-la-1 („📋 Cu ce exercițiu
  începi?", după ce alegi subiectul) și pe ecranul de intrare în sală. Linkul sălii primește
  `?ex=II.2.b`. Dacă lecția acelui subiect nu are exact exercițiul ales (ex. „III.1 c)" la EN, unde
  problema e întreagă), profesorul începe cu cel mai apropiat și spune asta.
- **Peste 60 de minute, ședința se prelungește până termină elevul exercițiile** — fără cost în plus.
  Se spune **înainte de conectare** (în lobby, pe cardul 1-la-1 și lângă „Începe acum", și pe ecranul
  de intrare în sală). În sală, cronometrul devine **„⏱ +mm:ss prelungire"**, iar profesorul anunță o
  dată: „Au trecut cele 60 de minute — continuăm până termini exercițiile". Tehnic: cât sala e
  deschisă, ea cere la fiecare minut acțiunea `extend` din `api/live.js`; serverul mută sfârșitul
  ședinței cu `LIVE_PRELUNGIRE_PAS` (10) minute doar când mai sunt sub 5 minute, până la plafonul
  `LIVE_PRELUNGIRE_MAX` (120 de minute peste ora inițială). Ședința se încheie când elevul termină
  lecția, alege „🏁 Ajunge pentru azi" sau „Părăsește" (sala închisă nu se mai prelungește).
- **Ședința de grup**: lecția comună rămâne la ora ei (nu se prelungește pentru toți); cine
  continuă **1-la-1** după ea (sau e singur în sală) primește același tratament — până termină
  exercițiile, chiar dacă trece de ora de sfârșit.

---

## 3c. Întrebările pe pași (Subiectele II și III, octombrie 2026)

La problemele cu rezolvare (BAC: II.1.a … III.2.c; EN: problemele de la Subiectul al III-lea, cu
a) și b)), explicația pe barem **se oprește înaintea rezultatelor intermediare**:

1. profesorul explică până la pasul următor, apoi întreabă („Înainte să scriu, încercați voi: cât
   este delta?") — pe ecran apare cardul **„📝 Prof. Tudor întreabă · pasul 2 din 3 · b)"**;
2. elevul calculează și răspunde: **de completat** (un număr sau o expresie — „16", „2x+3", „1/2";
   se verifică matematic, deci „x²+2x+1" = „x^2 + 2x + 1") sau **grilă** cu 4 variante (rezultatul și
   greșelile tipice). **„💡 Indiciu"** arată formula/proprietatea, fără rezultat. La 1-la-1,
   **„🤷 Nu știu — arată-mi"** dă răspunsul corect (se numără ca greșit);
3. grup: după timpul de răspuns (`LIVE_SONDAJ_PAS_SEC`, implicit 40 s), pe proiecție apar
   **rezultatele clasei** și răspunsul corect; 1-la-1: verdictul vine pe loc, cu explicația, apoi
   „Mai departe: pasul pe tablă →";
4. profesorul scrie pasul pe tablă și continuă — tabla rămâne o singură rezolvare (bucățile de
   explicație dintre întrebări nu se despart), iar pe telefon camera stă pe tablă la aceste întrebări.

**Cel puțin o întrebare la fiecare subpunct** (de preferat la primul pas al lui, înainte să înceapă
explicația), plus câte una la rezultatele intermediare importante — cel mult 4 pe item. Verificarea de
la sfârșit („check") rămâne, ca înainte.

**Cum se scriu:** odată cu lecția — modelul pune întrebarea (`ask`) la segmentul din explicația pe
barem care scrie rezultatul. Apoi, **determinist**: întrebarea cade dacă rezultatul e deja pe tablă,
dacă întrebarea îl conține sau dacă e chiar rezultatul dat în enunț („Arătați că $E(x) = 1$");
grila trebuie să aibă 4 variante și o literă. Subpunctele rămase fără întrebare primesc încă un apel
scurt (doar pentru ele, cu explicația pe segmente numerotate), iar ce rămâne tot fără — **fără AI**,
din rândurile scrise pe tablă („Ce se obține la acest pas? $\Delta = b^2 - 4ac = \;?$").

**Lecțiile scrise înainte** (fără întrebări pe pași) le primesc **o singură dată**, la prima folosire —
doar întrebările; explicațiile, id-urile lor și vocea rămân:
- **1-la-1**: la intrare, dacă ședința n-a pornit — sala arată „Prof. Tudor pregătește întrebările
  pentru pașii din barem… cam un minut", apoi pornește;
- **ședința de grup**: în sala de așteptare (cu mai mult de 3 minute înainte de început) sau din cron,
  înainte de ședințele cu elevi (bilet / sala de așteptare);
- **Pregătirea de examen**: exercițiul următor (S. II/III) se completează cât elevul lucrează;
- **Admin → Lecțiile recente → „➕ Întrebări pe pași"** (sau „↻" ca să le scrii din nou).
Niciodată cât o ședință de grup cu aceeași lecție e în curs sau începe în câteva minute (toți elevii
ei trebuie să aibă aceeași cronologie). În Admin, „Scriptul" arată întrebările fiecărui item (înaintea
cărei fraze, răspunsul, „din barem" când sunt făcute fără AI).

**În 2 ore (grup):** dacă lecția nu încape, întâi cade al doilea mod de explicare, apoi rămâne
**o singură întrebare pe pas la fiecare subpunct** (și fără verificarea de la sfârșit acolo) — abia
apoi se scurtează întrebările din chat și, la nevoie, se predau mai puțini itemi.

**Pregătirea de examen:** exercițiile au aceleași întrebări pe pași; la **test**, din fiecare subpunct
intră prima întrebare (pusă înainte de explicație, deci se înțelege fără tablă), iar recapitularea
greșelilor doar explică.

`LIVE_INTREBARI_PASI=0` oprește totul (lecțiile curg ca înainte, fără să se piardă ce s-a scris).

---

## 3d. 🎁 Meditațiile gratuite (octombrie 2026)

Cererea: „pune două din meditațiile pregenerate gratuite; menționează asta la meditații live;
fă un buton la admin să pot modifica care să fie gratuite".

- **Ce înseamnă „gratuită":** o lecție pregătită (pe barem, cu scriptul gata) pe care **oricine are
  cont** o poate face **1-la-1, fără abonament și fără plată** — nu consumă nici ședințele 1-la-1
  incluse în abonament, nici biletele. Ședința de grup din ziua în care o sală predă una dintre
  ele e și ea gratuită (eticheta „🎁 meditație gratuită" în program). Fără cont: „Intră în cont și începe".
- **Care sunt:** până le alegi tu, **două alese automat** dintre lecțiile gata — una de Evaluare
  Națională și una de Bacalaureat (Mate-Info întâi), cele mai potrivite pentru o primă încercare:
  subiect complet (variantă / model / simulare), cu întrebări pe pași, scrisă cu paginile PDF.
  Alegerea se salvează o dată (rămâne aceeași până o schimbi).
- **În lobby** (`/meditatii`): în prezentare, „🎁 Două meditații 1-la-1 gratuite, fără abonament —
  încearcă-le!" și eticheta „🎁 2 meditații gratuite"; chiar sub prezentare, secțiunea **„Încearcă
  gratuit"** cu cele două lecții și butonul **„▶ Începe gratuit"**; în lista 1-la-1 („Alege subiectul")
  sunt primele, cu „🎁 gratuit", iar butonul devine „🎁 Începe gratuit". În sală: „🎁 Meditația ta gratuită".
- **În Admin → 🎥 Meditații live:** cutia **„🎁 Meditațiile gratuite"** — lista de acum („✕ Scoate"),
  „＋ Alege o lecție gata…" + **„🎁 Fă-o gratuită"**; în „Lecțiile recente", la fiecare lecție gata,
  butonul **„🎁 Fă-o gratuită" / „🎁 Gratuită ✓"** (un clic o scoate). Oricâte (cel mult 12); o listă
  goală = nicio meditație gratuită.
- **Plasa anti-abuz** (chatul cu profesorul e o funcție AI): cel mult `LIVE_GRATUIT_LUNA` (4)
  meditații gratuite pornite pe lună de un elev — se numără doar cele pornite —, iar în ele
  profesorul răspunde la cel mult `LIVE_GRATUIT_INTREBARI` (10) întrebări în chat; lecția (explicațiile,
  grilele, întrebările pe pași) merge oricum până la capăt. O lecție scoasă dintre cele gratuite:
  ședința deja **pornită** rămâne gratuită; una doar deschisă, nepornită, cere plata obișnuită.
- **Tehnic:** `app_settings` (cheia `live_free_lessons`, `supabase/setari_ordine_gratuite.sql`),
  `api/live.js` (`freeLessons`, `admin_set_free`; accesul `gratuit` în `live_sessions.access`),
  `api/_lib/live.js` (`freeAccess`, `groupAccess`, `pickFreeLessons`). Teste:
  `test/meditatii-gratuite.test.js`.

---

## 4. Profesorul animat (scena)

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
ce ține în mână (`extra_mana`, ex. markerul), `maini_impreuna: true` când ține ceva cu
amândouă mâinile (mâinile se mișcă atunci împreună) și `tabla_rama` — colțurile ramei
tablei, pe care telefonul le desenează peste poză (conturul și culoarea tablei; în
`rig.json` devin `boardFrame`). `--viz` salvează imagini de control
(fundalul completat, atlasul, plasa). Totul rulează local — nimic nu pleacă pe internet.

**Transparență:** pe ecran rămâne mereu eticheta **„Profesor virtual · AI"**, iar în
pagina de intrare scrie că vocea și imaginea sunt generate (cerință AI Act).

---

## 5. Costuri (orientativ, septembrie 2026 — verifică prețurile furnizorilor)

- **Vocea browserului** (fără chei): **0 lei** (pe iPhone, voce de femeie — vezi 1.2).
- **Vocea generată** (opțional): o lecție de 2 ore are ~50.000–60.000 de caractere rostite.
  Azure Neural ≈ 16 $ / 1 milion de caractere → ~0,8–1 $ (≈ 4–4,5 lei) pe lecție; nivelul
  gratuit Azure F0 (500.000 de caractere/lună) acoperă ~8 lecții noi pe lună.
  OpenAI gpt-4o-mini-tts ≈ 0,015 $/minut → ~0,8–1 $ pe lecție.
  **Lecțiile se refolosesc** (același subiect, aceeași voce) — costul e o dată pe subiect.
  Verificat 8 oct. 2026: Azure Neural ~15–16 $ / 1M caractere (F0: 0,5M caractere/lună gratuit);
  OpenAI gpt-4o-mini-tts ~0,015 $/minut; Google Chirp 3 HD 30 $ / 1M caractere, primul 1M/lună
  gratuit, cu 16 voci românești de bărbat (nelegat încă în cod). Demo-urile (grup + 1-la-1)
  au ~3.500 de caractere → sub 0,10 $ o singură dată; un răspuns rostit de ~500 de caractere
  ≈ 0,01 $.
- **Textul lecției** (modelul care scrie explicațiile pe barem): ~1,5–5 lei pe subiect nou, o
  singură dată (apoi se refolosește). Se plătește doar când vine cineva (vezi `LIVE_PREGATIRE_AUTO`).
  Cu 4 săli: cel mult 4 lecții noi pe zi (doar în sălile în care intră elevi) — ~6–20 lei/zi în
  cel mai rău caz; costul scade singur, pentru că o sală refolosește lecțiile gata după ce și-a
  parcurs subiectele (se repetă după `LIVE_REFOLOSIRE_ZILE`, implicit 21 de zile).
  Costul exact al fiecărei lecții apare în Admin → Meditații live.
- **Răspunsurile în chat** (întrebări către profesor): bani mărunți, limitate (`LIVE_INTREBARI_MAX`).
- **Întrebările pe pași**: la o lecție nouă, aproape nimic în plus (se scriu odată cu ea; uneori un
  apel scurt pentru subpunctele rămase fără întrebare). La o lecție scrisă înainte: ~0,5–1 leu, **o
  singură dată** pe lecție, la prima folosire. Fără model AI configurat — 0 lei (din rândurile de pe tablă).
- **Pregătirea de examen**: vocea browserului (0 lei); folosește lecțiile de aici, iar o lecție
  nouă (~1,5–5 lei) se scrie doar când un elev le-a lucrat pe toate cele gata — o singură dată pe
  subiect (plafon `PREP_GENERARI_ZI` pe elev, pe zi).
- Animația profesorului: **0 lei** (rulează în browserul elevului).

---

## 6. Confidențialitate și siguranță

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

## 7. Probleme frecvente

| Simptom | Cauză / soluție |
|---|---|
| Enunț fără radical / fracție („2 2 6 2 3 2") sau „[formula nu e lizibilă]" | lecție scrisă înainte de citirea paginilor PDF → Admin → „Lecțiile recente" → **Regenerează** |
| „Profesorul nu are încă un subiect cu barem" | nu există subiecte EN/BAC cu barem citit; cronul citește câteva bareme la fiecare rulare (`LIVE_CRON_BAREME`), sau alege manual subiectul din Admin |
| Profesorul nu vorbește (doar subtitrări) | dispozitivul nu are o voce românească → Edge (voce naturală, gratuită) sau vocea română în Windows; verifică și volumul/tab-ul fără sonor |
| Pe iPhone nu se aude nimic în sală, deși la demo se aude o voce (de femeie) | reparat 8 oct.: vocea generată (Web Audio) era tăiată de modul **Silențios**; acum sala cere sesiunea audio „playback" la „Participă acum". Versiune veche în cache (PWA) → închide și redeschide pagina. Dacă apare „🔊 Pornește sunetul", apasă-l (după un apel / ecran blocat) |
| Pe iPhone profesorul are voce de femeie | e vocea browserului („Ioana" — singura voce românească de la Apple); apare unde lecția n-are vocea generată: demo-urile, Pregătirea de examen, frazele de rezervă din 1-la-1. Vocea de bărbat peste tot = vocea generată (Azure „Emil" / OpenAI „ash") |
| Vocea generată nu apare | lipsește cheia TTS sau a expirat; lecția merge cu vocea browserului — vezi Admin → eroarea lecției, apoi „Generează vocea" |
| „Ședința s-a încheiat" mult înainte de sfârșitul orei | subiectul era scurt (o fișă, nu un subiect complet); acum ședințele de grup aleg subiecte complete, iar elevul poate „Continuă 1-la-1" până la sfârșitul orei |
| Un singur elev la ora de grup | normal: ședința devine 1-la-1 pentru el (fără cost în plus); `LIVE_MINIM_GRUP` schimbă pragul |
| O sală (ex. BAC Tehnologic) scrie „Subiectul se anunță în curând" | nu există încă niciun subiect al acelui examen cu barem citit; sala nu primește subiecte de alt profil. Cronul citește întâi baremele pentru ea (Admin → „Subiecte cu barem, pe săli" arată câte are fiecare), sau încarcă subiecte + bareme pentru acel profil |
| Profesorul apare static (fotografie) | browserul nu are WebGL (rar) — restul sălii merge normal |
| 1-la-1: după „⏭ Înainte" lecția rămânea la „Profesorul își aranjează notițele… (vocea se pregătește)" | reparat: vocea care lipsește se generează în fundal, de la itemul la care e elevul; după ~4,5 s profesorul continuă cu vocea browserului |
| Pe telefon nu se vede tot (tabla și exercițiul) | normal: camera arată pe rând explicația de pe tablă și exercițiul proiectat — butonul „✎ Explicația / 📝 Exercițiul" (sau o glisare) le schimbă; la întrebări, camera trece singură la exercițiu |
| Chatul nu apare în timp real | Supabase Realtime: canalele private trebuie permise; oricum, mesajele se reîncarcă la câteva secunde |
| Elevul nu poate intra la ora de grup | sala se deschide cu 15 minute înainte; după încheiere nu se mai poate intra |
| 1-la-1 s-a oprit la 60 de minute | versiune veche a paginii (PWA din cache) → reîncarcă; acum ședința se prelungește singură (cronometrul arată „+mm:ss prelungire"), până la plafonul `LIVE_PRELUNGIRE_MAX` |
| După un exercițiu ales, profesorul nu trece singur mai departe | normal: la alegerea elevului întreabă ce urmează; „⏩ Continuă în ordine" revine la lecția care curge singură |
| La 1-la-1, înainte de lecție: „pregătește întrebările pentru pașii din barem" | normal, o singură dată pe subiect (lecție scrisă înainte de întrebările pe pași), cam un minut |
| O problemă de la S. II/III fără întrebări pe pași | lecție veche folosită cât rula o ședință de grup cu ea (atunci nu se schimbă) → Admin → „➕ Întrebări pe pași"; sau nicio întrebare n-a trecut verificările (Admin → „Scriptul" → „↻ Întrebări pe pași") |
| Ședința de grup e prea lungă cu toate întrebările | normal: rămâne câte o întrebare la fiecare subpunct; `LIVE_SONDAJ_PAS_SEC` (ex. 30) scurtează timpul de răspuns |
| Admin → „🎁 Meditațiile gratuite": „rulează supabase/setari_ordine_gratuite.sql" | scriptul setărilor nu e rulat; până atunci sunt gratuite cele două alese automat (nu se pot schimba) |
| În lobby nu apare secțiunea „Încearcă gratuit" | nu există încă nicio lecție gata (primele două se aleg singure când apar) sau ai golit lista din Admin |
| Elevul vede „Ai făcut deja cele 4 meditații gratuite din luna aceasta" | plafonul lunar (`LIVE_GRATUIT_LUNA`); de luna viitoare le poate face din nou |
