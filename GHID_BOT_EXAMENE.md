# 📚 Botul de examene — subiecte și bareme oficiale (EN · BAC)

Botul caută singur pe internet subiectele oficiale de **matematică** și baremele lor
— **Evaluarea Națională** (clasa a VIII-a) și **Bacalaureatul** (M_mate-info,
M_șt-nat, M_tehnologic) — le publică pe site, fiecare în rubrica lui, și verifică
dacă **fiecare subiect de pe site are baremul lui**. Lipsă → îl caută online și îl
leagă.

Ce caută: variantele date în sesiune (iunie–iulie, august), rezervele, sesiunea
specială pentru olimpici, simulările (naționale și județene), modelele de subiecte
și testele de antrenament ale inspectoratelor (ISJ).

**E bot, nu agent AI** — merge fără cost: citește paginile, antetul PDF-urilor și
compară texte. AI-ul (Claude) e doar un buton opțional, „🤖 Caută cu AI", pe un
singur subiect, când botul n-a găsit baremul.

Fișiere: `api/exam-bot.js` (API + cron) · `api/_lib/examBot.js` (clasificarea,
titlurile, rubricile, verificarea) · `api/_lib/examBotNet.js` (rețeaua, sursele,
căutarea web / AI) · `api/_lib/examBotRun.js` (rulările) · `api/_lib/unzip.js`
(arhivele .zip) · `src/components/AdminBotExamene.jsx` (Admin) ·
`supabase/bot_examene.sql` · `test/bot-examene.test.js`.

---

## 1. Instalare (o singură dată)

1. **Supabase → SQL Editor → New Query** → rulează `supabase/bot_examene.sql`
   (idempotent). Creează `exam_bot_items`, `exam_bot_index`, `exam_bot_runs`,
   `exam_bot_pages` — toate cu RLS, grant-uri pentru `authenticated` și
   `service_role` și politica `<tabela>_service`; **fără acces `anon`** (datele
   sunt doar pentru Admin și se citesc prin API). Mai adaugă
   `ai_pdf_text.barem_override_by` (cine a legat baremul: `admin` sau `bot`).
2. **Vercel**: cronul e deja în `vercel.json` — `/api/exam-bot?action=cron`, la
   2 ore (minutul 40). Folosește `CRON_SECRET`, care există deja.
3. Deploy, apoi **Admin → 📚 Bot examene**:
   1. **✅ Verifică baremele** — prima trecere prin toate PDF-urile de EN și BAC
      de pe site (merge pas cu pas; poți închide pagina, cronul continuă);
   2. **🔍 Caută baremele lipsă**;
   3. **🔎 Caută acum online** — prima căutare de subiecte noi.

Fără pasul 1, fila arată „rulează o dată `supabase/bot_examene.sql`", iar restul
site-ului merge ca înainte.

### Variabile opționale (Vercel → Settings → Environment Variables)

| Variabilă | Ce face |
|---|---|
| `BRAVE_SEARCH_API_KEY` **sau** `SERPER_API_KEY` **sau** `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` | căutarea pe web („pur și simplu Google"), pe lângă sursele fixe. Fără cheie botul caută doar în sursele de mai jos |
| `ANTHROPIC_API_KEY` (există deja) | activează butonul „🤖 Caută cu AI" |
| `EXAM_BOT_AI_MODEL` | modelul pentru butonul AI (implicit `claude-sonnet-5-5`) |
| `EXAM_BOT_STEP_MS` | cât durează un pas pornit din Admin (implicit 200000 ms) |

Despre cheile de căutare: **Brave** costă 5 $ / 1.000 de căutări, cu un credit
gratuit de 5 $ în fiecare lună (≈ 1.000 de căutări). **Serper** (rezultate Google)
dă 2.500 de căutări de probă, fără card, apoi ≈ 1 $ / 1.000. **Google Programmable
Search** nu mai primește clienți noi și se închide la 1 ianuarie 2027 — nu merită
pus acum. Cronul caută pe web **o dată pe zi** (8 căutări ≈ 240 / lună), iar
baremele lipsă cel mult o dată pe săptămână pentru fiecare subiect — încape în
creditul lunar Brave.

---

## 2. Unde caută

| Sursa | Ce ia | Note |
|---|---|---|
| **edupedu.ro** | articolele cu subiectele și baremele (etichetele urmărite + căutări pe ani) | republică fișierele oficiale cu numele originale (`E_c_matematica_M_mate-info_2024_var_05_LRO.pdf`, `ENVIII_Matematica_2024_Bar_07_LRO.pdf`); botul citește API-ul WordPress / RSS / pagina |
| **subiecte.edu.ro** | paginile pe ani | doar dacă `robots.txt` permite — acum **nu permite roboții**, așa că e sărit (jurnalul o spune); aceleași fișiere vin prin edupedu.ro |
| **edu.ro** | pagina cu modelele de subiecte | |
| **Paginile urmărite** | fișierele de pe paginile ISJ pe care le pui în Setări | implicit `https://sbisj.ro/Noutati/`; adaugă câte una pe rând |
| **Căutarea web** | rezultatele PDF + paginile de pe site-uri de încredere | doar cu o cheie (mai sus) |
| **🤖 AI** | doar la cerere, pe un subiect | Claude caută și propune linkuri; botul le descarcă și le verifică el |

Anii: anul examenului curent (din septembrie, anul următor), anul trecut și, prin
rotație, câte un an mai vechi, până la „Subiectele oficiale de la anul" (implicit
2019). Simulările județene și testele ISJ: doar ultimii 2 ani școlari (setabil).

Politețe: se prezintă (`ExamenMateBot`), respectă `robots.txt`, așteaptă între
cereri pe același site, refuză adresele interne, are plafon de cereri și de
mărime (30 MB / fișier). Un articol deja citit nu se recitește zilnic (doar în
primele 3 zile, când apar baremele).

**Când rulează:** cronul pornește la 2 ore; căutarea online o face zilnic, iar în
perioadele de examen — 5–31 martie (simulări), 12 mai – 10 iunie (olimpici),
15 iunie – 15 iulie (sesiunea + rezervele), 10 august – 5 septembrie (toamna),
15 octombrie – 20 decembrie (modele, simulări județene) — la fiecare rulare
(setabil). La fiecare rulare verifică PDF-urile noi de pe site și caută câteva
bareme lipsă (15, setabil).

---

## 3. Ce face cu un fișier găsit

1. **Filtrează după link** (nume, textul linkului, titlul articolului): doar
   matematică, doar EN / BAC; **ignoră** traducerile (`LMA`, `LGE`, `LSK`…), alte
   materii, profilul pedagogic, anii prea vechi, materialele ISJ vechi.
   Arhivele `.zip` sunt deschise; se iau doar PDF-urile din ele.
2. **Descarcă și citește antetul PDF-ului**: examenul, anul, profilul, felul
   (sesiune / rezervă / olimpici / simulare / model / antrenament), varianta,
   subiect sau barem, limba. Antetul are ultimul cuvânt — dacă contrazice
   numele fișierului, fișierul așteaptă verificarea ta.
3. **Există deja pe site?** Același fișier (SHA-256) sau același text (amprentă
   pe cuvinte + numerele din enunțuri) → „= există deja", nu se dublează. Două
   variante diferite din același an au aceleași instrucțiuni, dar alte numere —
   nu sunt confundate.
4. **Publică** — singur doar ce e **sigur**: antet oficial recunoscut, anul,
   profilul (la BAC), felul, varianta (la sesiune), limba română, fără
   contradicții. Restul (PDF scanat, fel neclar…) așteaptă în **„📥 Găsite de bot"**
   cu motivul scris. Materialele noi sunt **gratuite** (setabil: Premium).
5. **Leagă subiectul de barem** (vezi 5) și face **un singur anunț în clopoțel**
   pentru toată rularea („📚 2 subiecte oficiale noi (1 cu barem)"), nu câte unul
   pe fișier.

### Rubricile

| Ce este | Evaluare Națională | Bacalaureat (pe profil) |
|---|---|---|
| sesiunea iunie / august, rezerva, olimpici | Variante Date + Modele | Variante + Olimpici + Rezerve |
| model oficial | Variante Date + Modele | Simulări |
| simulare națională / județeană | Simulări | Simulări |
| test de antrenament (ISJ) | Variante Date + Modele | Teste de Antrenament |
| barem | Bareme | Bareme |

### Titluri și nume de fișier (bune pentru căutări)

- `Bacalaureat 2024 — Matematică M_mate-info, Varianta 5 (sesiunea specială pentru olimpici)`
- `Barem — Evaluare Națională 2024 — Matematică, Varianta 7 (subiectul dat în iunie)`
- `Bacalaureat 2026 — Matematică M_mate-info, Simulare județeană Timiș (decembrie)`
- `Bacalaureat 2027 — Matematică M_mate-info, Test de antrenament (ISJ Sibiu, octombrie)`

Fișierul din Storage primește același nume, fără diacritice
(`bacalaureat-2024-matematica-m-mate-info-varianta-5-sesiunea-speciala-pentru-olimpici.pdf`);
**numele original** și sursa rămân în descriere („fișierul original:
E_c_matematica_M_mate-info_2024_var_05_LRO.pdf · sursa: edupedu.ro"). Subiectul
și baremul au același titlu (+ „Barem — "), ca potrivirea automată a site-ului
să le găsească una pe alta.

---

## 4. Verificarea baremelor (tot site-ul, nu doar ce a adus botul)

**✅ Verifică baremele** trece prin fiecare PDF de EN și BAC de pe site — inclusiv
cele încărcate de mână — și notează în `exam_bot_index`:

- dacă e **subiect care are nevoie de barem** (variante, simulări, teste de
  antrenament) sau barem, sau altceva (capitole, fișe);
- **baremul pe care îl vede site-ul** — aceeași potrivire pe care o folosește
  Profesorul Virtual când deschide PDF-ul (`api/ai-pdf-context.js`), deci raportul
  arată exact ce primește elevul;
- **dovada**: după titlu, numele fișierului, antet, conținut (procentul) sau
  „inclus în PDF".

Cronul re-verifică PDF-urile noi sau schimbate la fiecare rulare, cele fără barem
zilnic și restul săptămânal.

---

## 5. Legarea subiect ↔ barem și căutarea baremelor lipsă

### 🔒 Legăturile care există pe site nu se schimbă

Site-ul avea deja o corespondență test ↔ barem, folosită de lecțiile live,
corectări și explicații: **potrivirea automată** (titlu, nume de fișier, antet,
conținut — `api/ai-pdf-context.js`) și **baremul ales de tine** în vizualizatorul
PDF („⚙ barem"). Botul **nu le atinge**: leagă un barem doar unde site-ul nu
folosește ACUM niciunul.

- Starea se citește chiar înainte de fiecare legare, din locul pe care îl
  folosește site-ul (`ai_pdf_text`), nu din indexul botului (care poate fi vechi
  de câteva ore). Dacă subiectul a primit între timp un barem — automat sau de la
  tine — botul nu-l schimbă și nici nu-l mai caută online; jurnalul scrie
  „🔒 … are deja barem pe site — nu-l schimb".
- Un barem nou publicat de bot nu schimbă potrivirile automate existente: cele
  confirmate rămân în cache (triggerul din `ai_pdf_cache_v2.sql` le păstrează), iar
  cele „negăsit" doar se recalculează — adică se completează.
- Din fila botului, „🔗 Alt barem…" și „✕ Desface" apar doar la legăturile
  botului și la cele puse de tine tot din fila botului. Celelalte arată
  „🔒 legătura site-ului — botul n-o schimbă"; dacă vrei alt barem acolo, îl
  schimbi ca până acum, din vizualizatorul PDF al testului („⚙ barem").
- 🛡 **O singură dată, după actualizare**, botul își verifică legăturile făcute
  înainte de această regulă (prima versiune, din 30 oct., lega după indexul ei):
  pentru fiecare, calculează potrivirea automată a site-ului. Dacă aceasta dă
  **alt** barem, botul își anulează legătura și o repune pe a site-ului; dacă nu
  dă niciunul (sau dă același), legătura botului rămâne — doar completa un gol.
  Rezultatul apare sus în filă și în 🧾 Jurnal („↩ …").

### Cum leagă

Un barem se leagă de un subiect **doar dacă se potrivesc toate**: titlul, numele
original al fișierului, antetul (examen, an, profil, fel, variantă) și
**conținutul** (răspunsurile din barem corespund enunțurilor). Legătura se scrie
în `ai_pdf_text.barem_override_id` cu `barem_override_by = 'bot'`, așa că
**Profesorul Virtual, corectarea cu AI, scrisul de mână și lecțiile live** folosesc
exact acel barem. Vizualizatorul PDF arată „asociat de botul de examene".

Pentru un subiect fără barem, botul încearcă, în ordine:

1. baremele deja de pe site, compatibile, verificate pe conținut;
2. **numele oficial al baremului** lângă subiect (`…_var_05_LRO.pdf` →
   `…_bar_05_LRO.pdf`, în același folder);
3. baremele găsite deja de bot (de exemplu cele care așteaptă verificarea);
4. căutarea pe edupedu.ro (numele oficial + descrierea);
5. căutarea web (dacă e pusă o cheie);
6. **🤖 AI** — doar când apeși butonul.

Fiecare candidat e descărcat, clasificat și verificat ca mai sus. Găsit și sigur →
publicat la **Bareme** și legat; găsit, dar nesigur → așteaptă în „Găsite de bot";
negăsit → rămâne în „Fără barem" cu ce a încercat.

---

## 6. Fila Admin → 📚 Bot examene

**Sus:** starea (rulează singur / publică singur / căutare web / AI / perioadă de
examen) și raportul — PDF-uri EN + BAC, subiecte cu barem (câte legate de bot),
fără barem, bareme pe site (câte nu sunt folosite de niciun subiect), găsite de
bot (publicate · de verificat · existau deja). Un clic pe o casetă deschide
lista ei.

**Butoane:**

| Buton | Ce face |
|---|---|
| 🔎 **Caută acum online** | o căutare completă acum (sursele + căutarea web), apoi procesează și publică |
| ✅ **Verifică baremele** | reindexează PDF-urile noi / schimbate / vechi |
| 🔍 **Caută baremele lipsă** | caută online baremul fiecărui subiect fără barem |
| ⚙ **Setări** | ce caută, unde, cât de des, dacă publică singur, gratuit / premium, paginile ISJ urmărite, domenii acceptate în plus |

Un pas durează cel mult ~3 minute; butonul continuă singur pas cu pas și arată
jurnalul live. „■ Oprește după pasul curent" îl oprește. Cronul și butoanele nu
rulează în același timp (lacăt în `exam_bot_runs`).

**Listele:**

| Lista | Pe fiecare rând |
|---|---|
| ⚠ **Fără barem** | 🔍 Caută (botul) · 🤖 Caută cu AI · 🔗 Asociază… (baremele de pe site, verificate pe conținut — cele potrivite primele) · Nu are barem |
| ✅ **Cu barem** | baremul și dovada · ↺ Reverifică · 🔗 Alt barem… și ✕ Desface — doar la legăturile botului și la cele puse de tine din fila botului; la restul: 🔒 legătura site-ului |
| 📥 **Găsite de bot** | fișierul original, sursa, articolul, starea: ✓ publicat · ⏸ de verificat (✓ Publică… cu examenul / felul / anul / varianta / titlul alese de tine · ✕ Respinge) · = există deja · ⚠ eroare (↻ Reîncearcă). Bifa „arată ce a ignorat" arată și traducerile / alte materii |
| 📋 **Bareme** | cât e folosit fiecare barem |
| 🚫 **„Nu are barem"** | subiectele marcate de tine · ↺ Caută iar baremul |
| 📚 **Alte PDF-uri** | ce nu are nevoie de barem (capitole, fișe) |
| 🧾 **Jurnal** | fiecare rulare (cron / Admin): ce a găsit, publicat, legat, costul AI |

---

## 7. Costuri

| Ce | Cost |
|---|---|
| botul (sursele fixe, PDF-uri, verificări) | 0 — doar timp de server, ca celelalte cronuri |
| căutarea web (opțională) | ≈ 240 de căutări / lună (o dată pe zi) + câteva pentru bareme — în creditul lunar Brave |
| 🤖 Caută cu AI (la cerere) | ≈ 0,2–1 leu pe apăsare (până la 4 căutări web × 0,01 $ + textul citit); costul exact apare în jurnal |

---

## 8. Probleme frecvente

| Simptom | Cauza / ce faci |
|---|---|
| „Botul nu e încă activat" | rulează `supabase/bot_examene.sql` |
| „⏱ CRON_SECRET lipsă" | variabila nu e în Vercel — cronul nu rulează singur, butoanele merg |
| „⛔ subiecte.edu.ro nu permite roboții" | normal; fișierele vin din edupedu.ro și celelalte surse |
| Un subiect rămâne „fără barem" | baremul nu e încă publicat nicăieri (simulările județene îl dau uneori târziu), PDF-ul e scanat (fără text) sau baremul găsit e al altei variante. Încearcă „🤖 Caută cu AI" sau „🔗 Asociază…"; dacă nu există, „Nu are barem" |
| Un fișier stă la „de verificat" | motivul e scris sub el (scanat, felul neclar, antetul contrazice numele). „✓ Publică…" cu datele corecte sau „✕ Respinge" |
| „Botul lucrează deja" | o altă rulare (cron sau alt tab) e în curs; încearcă peste câteva minute |
| O legătură greșită a botului | „✕ Desface" (site-ul revine la potrivirea automată) sau „🔗 Alt barem…" |
| „Testul are deja un barem pe site…" (409) | legătura existentă e protejată; dacă vrei alt barem, schimbă-l din vizualizatorul PDF al testului („⚙ barem") |

---

## 9. Ce NU face

- Nu ia fișiere de pe site-uri care interzic roboții și nu ocolește `robots.txt`.
- Nu publică materiale neoficiale (culegeri, rezolvări ale altor site-uri): doar
  fișierele Ministerului Educației și ale inspectoratelor școlare, cu sursa scrisă.
- Nu schimbă legăturile test ↔ barem care există pe site (automate sau alese de
  tine) — doar completează unde lipsește baremul.
- Nu publică traducerile în limbile minorităților (se pot activa ulterior).
- Nu folosește AI fără să apeși butonul.

Teste: `node --test test/bot-examene.test.js` (23 de teste: clasificarea numelor
oficiale, deciziile, rubricile, titlurile, amprentele, verificarea subiect ↔ barem,
`robots.txt`, rețeaua, arhivele, cap-coadă cu un „internet" simulat, căutarea web
o dată pe zi, publicarea manuală, asocierea manuală, legăturile existente
protejate, verificarea legăturilor vechi ale botului, API-ul).
