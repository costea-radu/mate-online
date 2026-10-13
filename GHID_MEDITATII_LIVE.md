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
| **1-la-1, oricând** (60 min, **prelungite până termini exercițiile**): elevul **alege subiectul** — lista „Alege subiectul" are, în ordine, **variantele date, modelele, testele de antrenament, simulările**, iar la sfârșit **„Subiectul I, ex. 1", „Subiectul I, ex. 2"…** (un singur exercițiu, din toate subiectele oficiale) — și **exercițiile** (📋 — ex. S. I ex. 5, S. II ex. 2 b), S. III ex. 1 c), nu neapărat la rând); se oprește la întrebări, „Ai înțeles?", „Explică altfel", răspunde cu voce | 8/lună incluse în abonament, apoi 20 lei; prelungirea e fără cost în plus — vezi secțiunile 3b și 3f |
| **🎓 Pregătire de examen** (din „Planul meu"): aceeași clasă, dar profesorul propune ordinea — S. I ex. 1 → ex. 2 → … → S. II → S. III, câte cel puțin 10 exerciții pe poziție, apoi un test; elevul poate alege **orice exercițiu** (la BAC și doar un subpunct a/b/c). **Prețul: ca la 1-la-1** — o ședință de 60 min, prelungite cât lucrează | din **aceleași 8/lună incluse** în abonament (comune cu 1-la-1 live), apoi 20 lei; fără abonament, biletul de 20 lei — `/meditatii/pregatire` (`?pos=II.2.b` = începe direct acolo); vezi secțiunea 3 |
| **Plata**: 10 lei ședința de grup fără abonament; inclusă în abonament. În lobby, **„💳 Prețuri"** deschide lista tuturor prețurilor, cu și fără abonament | Stripe (plată unică), bilet în `live_tickets`; lista: `src/components/live/PriceList.jsx` |
| **🎁 Meditații gratuite** — **câte una pe fiecare examen** (Evaluarea Națională, BAC Mate-Info, BAC Științele Naturii, BAC Tehnologic): o lecție pe care oricine are cont o face **1-la-1, fără abonament și fără plată** — la vedere în lobby, chiar sub prezentare, cu „▶ Începe gratuit" (prima e cea a sălii alese) | alese automat până le alegi tu din **Admin → 🎥 Meditații live → „🎁 Meditațiile gratuite"** (câte un rând pe examen; sau „🎁 Fă-o gratuită" la o lecție) — vezi secțiunea 3d |
| **Lecția, scrisă o singură dată pe subiect** (explicația pe barem + explicațiile de rezervă + întrebările + **desenul din PDF** la problemele cu figură), apoi refolosită peste tot | **doar Claude Opus 5.5** (din 13 oct.; `ANTHROPIC_API_KEY`); Admin → 🎥 Meditații live → „Lecțiile recente": Regenerează, 🧩 itemii lipsă, 🖼 desenele, **🗑 versiunile vechi** — vezi secțiunea 3e |

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
mereu de femeie („Ioana"), pe Android de obicei tot. **De acum (octombrie 2026), pe aceste
dispozitive Prof. Tudor vorbește PESTE TOT cu vocea de bărbat de pe server** — în „Planul meu"
(tabla), în Pregătirea de examen, în demo-uri, în frazele de rezervă din sală și la „🔊 Voce" din
widget: browserul cere fiecare frază la `api/live.js → voce`, care o generează **o singură dată**
(Azure „Emil" sau OpenAI „ash") și o păstrează în Storage (`live-media/voce/…`), deci frazele comune
(lecțiile, demo-urile, ghidul site-ului) nu se plătesc de două ori. Unde browserul are deja voce de
bărbat (Edge „Emil", Windows „Andrei"), rămâne ea — gratuită. O frază nouă se generează doar pentru
un elev logat, cât are credite AI (costul ei intră în credite, ca rând `voce` în `ai_usage`, dar nu
în limita orară de cereri AI); fără cont — doar frazele deja generate. **Fără cheie de voce în
Vercel totul rămâne ca înainte** (vocea browserului). În Admin → 🎥 Meditații live, sus, „Vocea:"
arată furnizorul folosit (`openai`, `azure` sau „lipsă").

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
| `LIVE_PRIVAT_INCLUSE` | `8` | ședințe 1-la-1 incluse pe lună în abonament — **comune** pentru 1-la-1 live și Pregătirea de examen |
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
| `LIVE_GEN_MODEL`, `LIVE_CHAT_MODEL` | `claude-opus-5-5` / modelul de chat | modelul care scrie lecția pe barem (din paginile PDF) — din 13 oct. **doar Claude Opus 5.5** (vezi 3e; fără alegere în Admin) / modelul care răspunde în chat |
| `LIVE_REZERVA_MODEL` | — (fără rezervă) | ex. `gpt-5.6-terra`: scrie bucata la care Claude nu răspunde (fără cheie, eroare, plafonul lunar). Implicit nu există: lecțiile le scrie doar Opus 5.5 |
| `LIVE_CLAUDE_PAUZA_MS` | `15000` | când Claude e ocupat (429 pe minut, supraîncărcat, eroare temporară) la scrierea unei lecții: pauza înainte de reîncercare (apoi dublu; cel mult 3 încercări, tot cu Claude) |
| `LIVE_DESENE` | pornit | `0` = fără desenele decupate din PDF lângă enunț (vezi 3e, „🖼 Desenele din PDF") |
| `LIVE_PROF_RADU_NUME`, `LIVE_PROF_RADU_BIO` | `Prof. Tudor` | numele și prezentarea profesorului (id-ul intern a rămas `radu`) |

---

## 3. 🎓 Pregătire de examen (din „Planul meu")

În „Planul meu", cardul **🎓 Pregătire de examen** → **`/meditatii/pregatire`** (îl văd toți elevii
cu cont, cu sau fără abonament): o meditație 1-la-1 în aceeași clasă
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
(implicit 3 lecții noi pe elev pe zi). Progresul: `ai_meditatii_sessions` (fără SQL nou).
Setările (`PREP_EXERCITII`, `PREP_TEST_EXERCITII`, `PREP_TEST_PROBLEME`, `PREP_PRAG`,
`PREP_IN_PLUS`, `PREP_GENERARI_ZI`) sunt descrise în `GHID_MEDITATII.md` → Runda 12.

**Alegerea elevului (octombrie 2026):** profesorul propune ordinea, dar elevul poate începe cu
**orice exercițiu, nu neapărat la rând** — la intrare („📋 Cu ce începi?", cu propunerea
profesorului preselectată), în sală (🗺️ Plan) sau direct din cardul din „Planul meu" („📋 Aleg eu
exercițiul" → `/meditatii/pregatire?pos=…`). La **BAC**, problemele de la Subiectele II și III se pot
exersa și pe **subpuncte**: doar „S. II ex. 2 b)" sau doar „S. III ex. 1 c)" — din toate subiectele
oficiale ale profilului, cu progresul și testul lor (un subpunct e un singur item, deci testul are 5
exerciții); după el, profesorul propune subpunctul următor, apoi problema următoare. La EN,
problemele de la Subiectul III se lucrează întregi (așa sunt itemii lecțiilor). Progresul se
salvează după fiecare exercițiu.

**Prețul (octombrie 2026): o ședință 1-la-1, exact ca la meditațiile live.**

| | Fără abonament | Cu abonament |
|---|---|---|
| Ședința de Pregătire de examen (60 min, prelungite cât lucrează) | **20 lei** (biletul 1-la-1) | din **cele 8 pe lună incluse** — aceleași 8 ca la 1-la-1 live; apoi 20 lei |

- **Pornirea:** la intrare, butonul spune ce se folosește („▶ Începe ședința" — din cele incluse,
  „· cu biletul", sau „Plătește 20 lei"). Ședința se consumă abia la apăsare; o ședință în curs se
  continuă fără cost (și după ce elevul iese și revine în cele 60 de minute).
- **Ceasul:** 60 de minute (`LIVE_PRIVAT_MINUTE`), prelungite cât elevul e în clasă, ca la 1-la-1
  live (`LIVE_PRELUNGIRE_PAS` / `LIVE_PRELUNGIRE_MAX`). Sus, în clasă: „⏱ 42 min".
- **După sfârșit:** exercițiul început se termină (răspunsuri, „gata"), dar unul nou, testul sau o
  întrebare către profesor cer o ședință nouă — apare cardul „⏱ Ședința s-a încheiat", cu butonul
  potrivit (inclusă / bilet / plată).
- **Biletul** e același ca la 1-la-1 live (`live_tickets`, `kind = 'privat'`): merge în oricare.
- **Fără examen în „Planul meu"** (ex. elev fără abonament): îl alege în clasă (EN / BAC Mate-Info /
  Științele Naturii / Tehnologic); se ține minte (în browser și în ședință). Cel din plan are întâietate.
- **Tehnic:** ședința e un rând `live_sessions` (`kind = 'privat'`, `subject_id` null,
  `state.prep` = examenul) — de aceea contorul celor 8 le numără la un loc (`api/_lib/liveAccess.js`);
  nu apare în „Ședințele mele 1-la-1" din lobby. Fără SQL nou.

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
   se verifică matematic, deci „x²+2x+1" = „x^2 + 2x + 1"; la întrebările despre semn — „f'(x) < 0" —
   se primește și „−", „minus", „negativ(ă)", „< 0", „mai mic decât 0", la fel „+", „plus",
   „pozitiv(ă)", „> 0": `api/_lib/semn.js`) sau **grilă** cu 4 variante (rezultatul și
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

## 3d. 🎁 Meditațiile gratuite — câte una pe fiecare examen (octombrie 2026)

Cererea (6 oct.): „pune două din meditațiile pregenerate gratuite; menționează asta la meditații live;
fă un buton la admin să pot modifica care să fie gratuite". Schimbată pe **11 oct.**: „pune doar o
meditație gratuită pe fiecare tip: Evaluare Națională, BAC Mate-Info, BAC Tehnologic, BAC Științele
Naturii — o meditație 1-la-1".

- **Ce înseamnă „gratuită":** o lecție (subiect cu barem) pe care **oricine are cont** o poate face
  **1-la-1, fără abonament și fără plată** — nu consumă nici ședințele 1-la-1 incluse în abonament,
  nici biletele. Ședința de grup din ziua în care o sală predă una dintre ele e și ea gratuită
  (eticheta „🎁 meditație gratuită" în program). Fără cont: „Intră în cont și începe".
- **Câte sunt: câte UNA pe examen** — Evaluarea Națională, BAC Mate-Info, BAC Științele Naturii,
  BAC Tehnologic (cel mult patru). Până o alegi tu, fiecare examen primește **automat** lecția gata
  cea mai potrivită pentru o primă încercare (subiect complet — variantă / model / simulare —, cu
  întrebări pe pași, scrisă cu paginile PDF, cu voce; la egalitate, varianta cea mai nouă). Un examen
  fără nicio lecție gata (ex. BAC Tehnologic) primește cea mai nouă **variantă dată cu barem** — lecția
  ei se scrie la prima folosire (2–4 minute, o singură dată; din Admin o poți pregăti dinainte).
  Alegerea se salvează o dată (rămâne aceeași până o schimbi). Cele alese până acum (formatul vechi,
  o listă) rămân: prima lecție a fiecărui examen; examenele fără ea se completează automat.
- **În lobby** (`/meditatii`): în prezentare, „🎁 Câte o meditație 1-la-1 gratuită pentru fiecare
  examen, fără abonament — încearc-o!" și eticheta „🎁 câte o meditație gratuită pe examen"; chiar sub
  prezentare, secțiunea **„Încearcă gratuit"** cu cele patru lecții (prima și încadrată cu auriu: cea a
  sălii alese de elev mai jos) și butonul **„▶ Începe gratuit"**; în lista 1-la-1 („Alege subiectul")
  stă **deasupra listei, separat** („🎁 Meditația gratuită"), iar butonul devine „🎁 Începe gratuit".
  În sală: „🎁 Meditația ta gratuită". În „💳 Prețuri": „câte o lecție 1-la-1 pentru fiecare examen".
- **În Admin → 🎥 Meditații live:** cutia **„🎁 Meditațiile gratuite — câte una pe examen"**: un rând pe
  examen, cu lecția de acum („✓ lecția e gata" / „se scrie la prima folosire", „aleasă automat") și
  lista **„↻ Schimbă…"** — întâi „✓ Lecții gata — pornesc imediat", apoi subiectele cu barem care „se
  scriu la prima folosire", în ordinea de pe site (variante, modele, teste, simulări); tot acolo „✕ Fără
  meditație gratuită la acest examen" și „🤖 Alege automat". La o lecție care nu e gata: **„Pregătește
  acum"** (o scrie dinainte, ca primul elev să nu aștepte). În „Lecțiile recente", butonul **„🎁 Fă-o
  gratuită"** face din lecție meditația gratuită a examenului ei (o înlocuiește pe cea de acum);
  „🎁 Gratuită ✓" o scoate.
- **Plasa anti-abuz** (chatul cu profesorul e o funcție AI): cel mult `LIVE_GRATUIT_LUNA` (4)
  meditații gratuite pornite pe lună de un elev — se numără doar cele pornite —, iar în ele
  profesorul răspunde la cel mult `LIVE_GRATUIT_INTREBARI` (10) întrebări în chat; lecția (explicațiile,
  grilele, întrebările pe pași) merge oricum până la capăt. O lecție scoasă dintre cele gratuite:
  ședința deja **pornită** rămâne gratuită; una doar deschisă, nepornită, cere plata obișnuită.
- **Tehnic:** `app_settings` (cheia `live_free_lessons` = `{ v: 2, slots: { en, mate-info,
  stiinte-naturii, tehnologic }, auto: [...], subjects: [...] }`; un examen lipsă din `slots` = automat,
  `null` = fără; `supabase/setari_ordine_gratuite.sql`, fără SQL nou), `api/live.js` (`freeLessons`,
  `autoFreePicks`, `admin_set_free` — `{ type, subjectId }`, `{ type, auto }`, `{ subjectId, on }`;
  accesul `gratuit` în `live_sessions.access`), `api/_lib/live.js` (`FREE_TYPES`, `freeSlotsFrom`,
  `pickFreeLessons`, `pickFreeSubject`, `freeAccess`, `groupAccess`). Alegerea automată se salvează
  doar peste rândul citit (`settings.updateSettingIf`), ca să nu suprascrie o alegere făcută chiar
  atunci din Admin. Teste: `test/meditatii-gratuite.test.js`.

---

## 3e. ✍️ Cine scrie lecțiile: doar Claude Opus 5.5 (din 13 octombrie 2026)

Cererile: „Adaugă opțiunea Opus 5.5" (11 oct.); pe 13 oct., după un test scris de GPT-5.6 Terra cu
formule stricate: „Pune doar Opus 5.5 la generare meditații video. … pune și desenul din PDF. Pune
buton de ștergere a variantelor vechi regenerate în alte variante noi".

- **Cine scrie:** **Claude Opus 5.5** (API-ul Anthropic, `ANTHROPIC_API_KEY` — aceeași cheie folosită
  deja de exercițiile din „Meditații" și de agenți), toate lecțiile scrise de acum: ședințele de grup,
  1-la-1 și Pregătirea de examen (aceleași lecții). Alegerea Terra / Opus din Admin a dispărut: cutia
  **„✍️ Lecțiile le scrie Claude Opus 5.5"** doar arată modelul și avertizează dacă lipsește cheia.
  Fără cheie nu se scrie nicio lecție nouă (eroarea apare în Admin și în sala de așteptare) — nu mai
  scrie Terra în locul lui, pe ascuns.
- **Fără rezervă automată:** un apel la care Claude nu răspunde (limita pe minut — 429, supraîncărcare,
  o eroare temporară) se **reîncearcă tot cu Claude** (cel mult 3 încercări, cu pauze de
  `LIVE_CLAUDE_PAUZA_MS`, implicit 15 s, apoi dublu). Itemii care tot lipsesc se scriu apoi separat, câte
  unul, tot cu Claude; ce rămâne apare în Admin („🧩 Completează itemii lipsă"). La plafonul lunar de
  cheltuieli Anthropic lecția nu se poate scrie (vezi Probleme frecvente). `LIVE_REZERVA_MODEL=gpt-5.6-terra`
  (Vercel) pune la loc o rezervă, doar dacă e nevoie; `LIVE_GEN_MODEL` schimbă modelul.
- **Ce scrie:** tot scriptul — enunțul curat, întrebarea „încercați singuri", explicația pe barem cu
  punctajul pașilor, **explicațiile de rezervă** („Explică altfel": pe înțelesul tuturor, greșeli care
  costă puncte, altă metodă), verificarea și întrebările pe pași. Schema strictă (Structured Outputs),
  paginile PDF ale subiectului și baremului ca documente, aceleași verificări deterministe după
  (literele grilelor de EN din tabelul baremului, enunțurile ilizibile scoase, formulele — mai jos).
- **Pe bucăți, în paralel:** câte 3 itemi pe apel la Subiectul I și **câte 2 la Subiectele II–III** (cu 3
  itemi lungi, un răspuns depășea uneori limita de 16.000 de tokeni). Limitele Anthropic pentru Opus 5.5
  (chiar la nivelul Start: 1.000 de cereri, 2 milioane de tokeni de intrare și 400.000 de ieșire pe minut)
  încap lejer bucățile deodată.
- **Costul:** 4 $ / 20 $ pe milionul de tokeni (intrare / ieșire) → ~2,5–8,5 lei pe lecție (fără voce),
  **o singură dată pe subiect** — cam de 1,7 ori cât cu Terra. Coloana „Cost" din Admin și `ai_usage`
  (rândurile `live-lectie` / `live-pasi`); și tokenii unei încercări eșuate se notează.
- **Timpul:** ~2–5 minute pe lecție. Lacătul lecției ține 14 minute (cât poate dura funcția), ca două
  cereri să nu scrie aceeași lecție de două ori; cronul nu mai începe o lecție nouă după primele 7 minute
  ale rulării (o scrie rularea următoare sau sala de așteptare); Pregătirea de examen așteaptă până la
  5 minute o lecție pe care o scrie chiar atunci altă cerere.
- **Lecțiile scrise înainte** (de GPT-5.6 Terra sau Sol) rămân cum sunt până la **„Regenerează"** (Admin →
  „Lecțiile recente"): versiune nouă, scrisă de Opus 5.5 (costă din nou). Formulele lor se repară oricum
  la afișare (mai jos); pentru explicații mai bune — „Regenerează", apoi „🗑 Șterge versiunile vechi".
- **🧩 Itemii lipsă (12 oct.):** „Opus 5.5 nu a generat tot subiectul de BAC — lipsesc subpunctele b) și
  c) de la Subiectul III, ex. 1". După prima trecere, lecția se compară cu **structura subiectului**
  (exercițiile „1."…„6." din text și, la BAC II–III, cerințele „a)", „b)", „c)" ale fiecărei probleme;
  structura oficială când textul nu se citește sigur): fiecare item care lipsește — răspuns tăiat, item
  omis de model sau respins la verificări — se scrie **separat, câte unul** (cu paginile secțiunii). Un
  răspuns tăiat la limita de tokeni își păstrează itemii întregi (doar cel scris pe jumătate se aruncă).
  Ce lipsește tot rămâne în `script.missing`. **Lecțiile deja scrise:** Admin → „Lecțiile recente" →
  „Scriptul" arată ce pare să lipsească (față de structura oficială) și butonul **„🧩 Completează itemii
  lipsă"** — verifică pe textul subiectului și scrie DOAR itemii care lipsesc (~0,7 lei pe item), apoi
  vocea lor; explicațiile, id-urile și vocea celorlalți rămân (ieftin, față de „Regenerează").
- **Jurnalul scrierii:** Admin → „Scriptul" → „Jurnalul scrierii": ce s-a întâmplat la scriere
  (reîncercările, răspunsurile tăiate, itemii omiși, completați sau rescriși) — `script.writer.notes`.
- **Formulele stricate (12–13 oct.):**
  - *12 oct.:* paranteza înaltă din „2(1 − 1/6)" scrisă ca matrice, „2\begin{pmatrix}1-\frac{1}{6}\right)",
    pe care KaTeX nu o poate afișa (apărea textul brut, cu roșu): se repară mediile fără pereche,
    `\left`/`\right` dezechilibrate și acoladele.
  - *13 oct. (pozele cu `\text{f: (-4,+⊠infty)→u001bmathbbR}`, „$f: 0\to 0,f(x)=7x+5.Determinaținumărul…"):*
    în JSON-ul modelului un backslash din LaTeX se pierde — „\t" din „\to" devine TAB, „\f" din „\frac"
    salt de pagină, „\b" din „\beta" alt caracter de control, iar „\u001b" ajunge scris ca text
    („⊠infty", „u001bmathbbR"). Mulțimea ℝ, în textul extras din PDF, apare ca „0" („f: 0 → 0"), iar o
    formulă ruptă pe două rânduri despărțea perechile de `$` (textul de după se lipea de formulă). Acum
    caracterele de control și „\u00XX" redevin comenzile LaTeX (`\to`, `\frac`, `\infty`, `\mathbb`),
    „f: 0 → 0" devine „f: ℝ → ℝ", rândurile noi din formule se unesc; rezerva „ca text" nu mai poate conține
    caractere de control (KaTeX o respingea și pe ea). **De ce „Regenerează" cu Opus dăduse la fel:** se
    putea pierde și în răspunsul lui Claude câte un backslash, iar afișarea nu repara caracterele de control
    — iar o bucată la care Claude nu răspundea o scria pe ascuns Terra.
  - Reparațiile merg **la scriere** (`fixMathText`: fiecare formulă verificată cu KaTeX; un item cu o
    formulă care tot nu se poate afișa se **rescrie o dată**) și **la afișare** (`src/lib/katex.js` →
    `renderMath`, `Board.jsx` → `flatMath`), deci și lecțiile deja scrise se văd corect, fără Regenerează.
    Ce nu se poate repara apare ca text simplu („8/3 − 2(1 − 1/6)"), nu cu roșu. Instrucțiunile cer
    modelului backslash-ul dublat în JSON („\\frac") și ℝ luat din pagină.
- **🖼 Desenele din PDF (13 oct.):** la problemele cu figură („În figura alăturată…", „desenul", „schița",
  „tabelul alăturat"), desenul din subiect apare pe **tabla digitală, în dreapta enunțului** (și în „Caietul
  meu", sub enunț). Figurile din subiectele oficiale sunt desenate cu linii (nu sunt imagini), deci se
  **decupează din pagina PDF** (MuPDF, pe server): zona exercițiului („6." din subiectul lui, până la
  exercițiul următor / subiectul următor / subsol), apoi liniile desenului din ea — fără liniile de fracție
  și barele radicalilor, fără ramele și separatoarele paginii, fără tabelul variantelor — cu etichetele lor
  (A, B, C', 4 cm…); se randează de 3× pe alb, ca PNG în Storage (`live-media/lessons/<id>/fig-III6.png`).
  Toți itemii problemei (a, b, c) primesc același desen; un enunț care, cu desenul, nu mai încape în
  proiecție își micșorează scrisul (până la 70%). **O singură dată pe lecție** (câteva secunde,
  gratuit): la lecțiile noi, imediat după scriere; la cele scrise înainte, la prima folosire (intrarea în
  sală, cronul dinaintea ședinței, Pregătirea de examen) — cronologia nu se schimbă, deci merge și cât
  ține o ședință. Admin → „Scriptul": „🖼 Desenele din PDF: III.6 · negăsite: II.4", miniaturile, și
  **„🖼 Refă desenele"** (din nou, pentru o lecție). Un desen negăsit sau un PDF care nu se descarcă nu
  oprește nimic (lecția merge fără desen; motivul apare acolo). `LIVE_DESENE=0` le oprește.
- **🗑 Versiunile vechi (13 oct.):** „Regenerează" scrie o versiune nouă; sălile, Pregătirea de examen și
  simulările folosesc mereu cea mai nouă, iar cele vechi doar ocupau loc (în listă și în Storage, cu
  vocea lor — sute de fișiere pe lecție). Admin → „Lecțiile recente": rândurile vechi au „versiune veche —
  înlocuită de v3", iar sus e butonul **„🗑 Șterge versiunile vechi (N)"** (sau „🗑 Șterge" pe un rând):
  șterge rândul și fișierele lui (`lessons/<id>/`: vocea, desenele). **Cât versiunea nouă nu e gata** (se
  scrie sau a eșuat), cea veche rămâne — e singura bună; la fel o versiune „în lucru". Câte 40 pe cerere
  (butonul repetă până termină).
- **Tehnic:** `api/_lib/liveLesson.js` (`GEN_MODEL`, `FALLBACK_MODEL`, `writeJson`: Claude prin
  `api/_lib/claude.js`, cu paginile ca documente PDF; `usageParts`: tokenii pe model; itemii lipsă:
  `expectedRefs`, `fillItems`, `completeScript`, `wholeItems`; formulele: `itemBrokenMath`), `api/live.js`
  (`writerAdminView`, `logWriteUsage`, `fill` / `figures` în `admin_prepare`, pasul „1d" din
  `prepareLesson`, `admin_delete_old`), `api/_lib/texRepair.js` + oglinda `src/lib/texRepair.js`,
  `api/_lib/figuri.js` (desenele; pachetul npm `mupdf`), `src/components/live/Board.jsx`,
  `src/components/LiveAdmin.jsx`. Teste: `test/lectii-live-opus.test.js`, `test/formule-reparate.test.js`,
  `test/desene-pdf.test.js`, `test/versiuni-vechi.test.js`.

---

## 3f. „Alege subiectul" (1-la-1): ordinea listei și „Subiectul I, ex. 1"… (11 octombrie 2026)

Cererea: „la «Meditații 1-la-1», la «Alege subiectul», pune lista cu toate variantele PDF date, apoi
modele, apoi teste de antrenament, apoi simulări. La Evaluare Națională, testele, variantele și modelele
primele în listă, apoi la sfârșit «subiect 1 ex 1», «subiect 1 ex 2» etc.; adaugă la sfârșit și la BAC
«subiect 1 ex 1», «subiect 1 ex 2» etc."

- **Ordinea** (în lobby, la fiecare examen — EN, BAC Mate-Info, Științele Naturii, Tehnologic):
  **Variante date** (oficiale, de rezervă, sesiunea specială, olimpici) → **Modele** → **Teste de
  antrenament** → **Simulări** (naționale, apoi județene; „Clasa a XI-a" după) → alte subiecte → **„Pe
  exerciții"**. În fiecare grup: cel mai nou an întâi; în același an, după număr (Varianta 02 înaintea
  lui 10). Grupurile au antet (rămâne sus când derulezi) și numărul de subiecte. Meditația gratuită a
  examenului stă deasupra, separat (🎁). La EN nu există teste de antrenament separate („model 1…15"
  din 2021 sunt la Modele).
- **Felul** vine din rubrica materialului + titlu (`L.subjectKind`): la EN, „Variante Date + Modele"
  e o singură rubrică (titlul cu „model" → Modele); la BAC, modelele stau în rubrica „Simulări" (tot
  după titlu → Modele). Aceeași ordine și în Admin („Ședințele zilei" — lista subiectului fiecărei săli,
  pe grupuri — și „🎁 Meditațiile gratuite").
- **„Pe exerciții" — „Subiectul I, exercițiul 1"…** (EN: S. I–III × 6 = 18; BAC: S. I ex. 1–6, S. II
  ex. 1–2, S. III ex. 1–2 = 10): un singur exercițiu, **din toate subiectele oficiale ale examenului**
  (variante, modele, teste, simulări), pe rând, fiecare explicat **pe baremul lui** — exact Pregătirea
  de examen pe acea poziție (secțiunea 3): după 10 exerciții, un test scurt. „Începe" duce în clasa
  Pregătirii (`/meditatii/pregatire?pos=I.1&examen=bac-mate-info&din=live`), pe examenul listei alese în
  lobby (are întâietate față de cel din „Planul meu" și rămâne și după plata biletului), iar „Înapoi"
  duce la Meditații live. Prețul: o ședință 1-la-1, ca oricare (inclusă / bilet de 20 lei).
- **De ce nu fișele „Subiectul I - Exercițiul 1" / „SUBIECTUL I, Ex. 1"** (rubricile „Exerciții pe
  Subiecte"): sunt culegeri de 30 de exerciții din variante, **fără barem** propriu — profesorul nu le
  poate explica pe barem. Exercițiile lor sunt aceleași (din variantele oficiale), iar „Pe exerciții"
  le ia direct din subiectele cu barem. De aceea fișele nu mai apar în lista 1-la-1.
- **Tehnic:** `api/_lib/live.js` (`SUBJECT_KINDS`, `subjectKind`, `subjectOrder`), `api/live.js`
  (`eligibleSubjects` ordonează și dă `kind`; `private_subjects` întoarce și `kinds` și `prep: { target,
  positions }`; `prepWho`: `examForce`), `api/_lib/pregatire.js` (`targetFor`),
  `src/pages/MeditatiiLive.jsx`, `src/pages/PregatireExamen.jsx`, `src/lib/live/api.js`
  (`setPrepExam(target, { force })`). Teste: `test/alege-subiectul.test.js`,
  `test/pregatire-examen.test.js` (examenul ales în lobby).

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
- **Vocea de bărbat pe iPhone / Android** (frazele din Planul meu, Pregătire, demo-uri, widget):
  ~16 $ / 1M caractere la Azure (o frază ≈ 100 de caractere ≈ 0,7 bani), o singură dată pe frază —
  frazele comune se refolosesc la toți elevii. Costul intră în creditele AI ale elevului.
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
  Costul exact al fiecărei lecții apare în Admin → Meditații live. Din 13 oct. lecțiile le scrie
  doar **Claude Opus 5.5** (vezi 3e): cam 1,7× cât cu Terra (~2,5–8,5 lei pe subiect nou), tot o
  singură dată. Desenele din PDF: 0 lei (se decupează pe server).
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
| Lipsesc subpuncte (ex. la S. III ex. 1 doar „a)") | Admin → „Lecțiile recente" → „Scriptul" → **„🧩 Completează itemii lipsă"** (doar itemii care lipsesc; restul rămâne) — vezi 3e |
| O formulă apare ca text simplu („8/3-2(1-1/6)") | modelul a scris un LaTeX pe care nici reparatorul nu l-a putut îndrepta; se citește, dar fără fracții etajate → „Regenerează" lecția, dacă formula e importantă |
| Formule cu roșu / „u001bmathbbR", „⊠infty", „f: 0 → 0", text lipit de formulă | reparat 13 oct. la afișare (și la lecțiile deja scrise) — dacă se mai vede, pagina e o versiune veche din cache: închide și redeschide (vezi 3e, „Formulele stricate") |
| „ANTHROPIC_API_KEY lipsește în Vercel — lecțiile live le scrie Claude Opus 5.5" | pune cheia Anthropic în Vercel → Settings → Environment Variables (aceeași ca la „Meditații") și fă Redeploy; lecțiile deja scrise merg oricum |
| O lecție nouă nu se scrie: „usage limits" / „spend limit" de la Anthropic | plafonul lunar de cheltuieli din console.anthropic.com (Settings → Limits) — ridică-l; până atunci, la nevoie, `LIVE_REZERVA_MODEL=gpt-5.6-terra` |
| La o problemă „În figura alăturată…" nu apare desenul | Admin → „Scriptul" → „🖼 Desenele din PDF" spune de ce („negăsite", „subiectul nu are PDF", „MuPDF nu s-a încărcat pe server") → „🖼 Refă desenele"; un PDF scanat (fără text) nu are de unde decupa |
| Desenul e tăiat greșit (lipsește o parte / are și text în plus) | figura e prea aproape de text sau desenată neobișnuit; decuparea e automată (la fel la „🖼 Refă desenele") → trimite subiectul (PDF-ul) ca să fie îmbunătățită decuparea (`api/_lib/figuri.js`); `LIVE_DESENE=0` le oprește pe toate |
| Admin nu arată butoanele noi după un deploy (ex. „🗑 Șterge versiunile vechi", „🖼 Refă desenele" din „Scriptul") | telefonul rulează versiunea veche a site-ului: sus, în Admin → Meditații live, „Versiunea site-ului" arată data build-ului. Închide complet site-ul (toate tab-urile / aplicația) și redeschide-l; din 13 oct. (seara) versiunea nouă se ia singură |
| În „Lecțiile recente" apare de mai multe ori același subiect (v1, v2, v3) | versiunile vechi, de dinainte de „Regenerează" → **„🗑 Șterge versiunile vechi"** (cele încă necesare — versiunea nouă nu e gata — rămân) |
| „vocea se generează…" rămâne în Admin | normal când pagina s-a închis înainte de sfârșit: vocea continuă la primul elev care intră; sau „▶ Continuă" (continuă singur până la „gata") |
| „Profesorul nu are încă un subiect cu barem" | nu există subiecte EN/BAC cu barem citit; cronul citește câteva bareme la fiecare rulare (`LIVE_CRON_BAREME`), sau alege manual subiectul din Admin |
| Profesorul nu vorbește (doar subtitrări) | dispozitivul nu are o voce românească → Edge (voce naturală, gratuită) sau vocea română în Windows; verifică și volumul/tab-ul fără sonor |
| Pe iPhone nu se aude nimic în sală, deși la demo se aude o voce (de femeie) | reparat 8 oct.: vocea generată (Web Audio) era tăiată de modul **Silențios**; acum sala cere sesiunea audio „playback" la „Participă acum". Versiune veche în cache (PWA) → închide și redeschide pagina. Dacă apare „🔊 Pornește sunetul", apasă-l (după un apel / ecran blocat) |
| Pe iPhone profesorul are voce de femeie | e vocea browserului („Ioana" — singura voce românească de la Apple). Cu o cheie de voce în Vercel (`AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION`, sau `OPENAI_API_KEY`), Prof. Tudor vorbește peste tot cu vocea de bărbat de pe server (vezi 1.2). Fără cheie, sau dacă vocea nu vine în câteva secunde, fraza o rostește browserul |
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
| Admin → „🎁 Meditațiile gratuite": „rulează supabase/setari_ordine_gratuite.sql" | scriptul setărilor nu e rulat; până atunci sunt gratuite cele alese automat, câte una pe examen (nu se pot schimba) |
| În lobby nu apare secțiunea „Încearcă gratuit" (sau lipsește un examen) | examenul nu are niciun subiect cu barem încă, sau ai ales „✕ Fără meditație gratuită" la el în Admin („🤖 Alege automat" o pune la loc) |
| Meditația gratuită a unui examen „se pregătește când pornești (2–4 minute)" | e aleasă automat dintre subiectele cu barem (examenul nu avea nicio lecție gata); lecția se scrie la primul elev, o singură dată — sau Admin → „🎁 Meditațiile gratuite" → „Pregătește acum" |
| În „Alege subiectul" nu mai apar fișele „Subiectul I - Exercițiul 1" | normal (11 oct.): n-au barem propriu; la sfârșitul listei, „Pe exerciții" → „Subiectul I, exercițiul 1"… ia aceleași exerciții din subiectele oficiale, pe barem |
| Elevul vede „Ai făcut deja cele 4 meditații gratuite din luna aceasta" | plafonul lunar (`LIVE_GRATUIT_LUNA`); de luna viitoare le poate face din nou |
