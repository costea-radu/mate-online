# 🎓 „Meditații cu Profesorul Virtual" — ghid de instalare și funcționare

Rubrica nouă transformă Profesorul Virtual într-un **meditator personal cu
memorie pedagogică**: cunoaște fiecare elev, îi face evaluarea inițială, îi
construiește planul de învățare, îi predă teoria, îi dă exerciții și teme,
îi analizează greșelile și revine cu recapitulări ca să nu uite materia.

---

## 🚀 Instalare (2 pași)

### Pasul 1 — Baza de date (Supabase)

Supabase Dashboard → **SQL Editor** → **New Query** → lipește tot conținutul din
`supabase/meditatii_schema.sql` → **Run**. (Idempotent — se poate rula de mai multe ori.)

Verifică în **Table Editor** că au apărut: `ai_meditatii_profile`,
`ai_meditatii_sessions`, `ai_meditatii_homework`, `ai_meditatii_mistakes`,
`ai_meditatii_reviews`.

### Pasul 2 — Variabile de mediu (Vercel)

| Variabilă | Rol |
|---|---|
| `OPENAI_API_KEY` (o ai deja) | chatul tutorelui + generarea de lecții/analize |
| `ANTHROPIC_API_KEY` (o ai deja pentru agenți) | **Claude Opus 5** — generarea de exerciții și teste interactive de EN/BAC, după modelul din site |

> Fără `ANTHROPIC_API_KEY`, meditațiile funcționează în continuare — generarea
> cade automat pe furnizorul existent (`AI_GEN_CHAT_MODEL` / modelul de chat).

Cron-ul zilnic e deja adăugat în `vercel.json`
(`/api/ai-meditatii?action=cron`, ora 14:00 UTC = 17:00 România) — la deploy
se activează singur. El trimite în clopoțel: recapitulările scadente, temele
restante și dă teme noi elevilor inactivi de 3+ zile.

---

## 🤖 Ce model face ce (cerința B)

| Sarcină | Model |
|---|---|
| Explicațiile din chat, în timpul exercițiilor („Întreabă profesorul") | modelul de chat existent (`AI_CHAT_MODEL` — „terra"), **ca până acum** |
| Generarea de lecții (teorie) + analiza greșelilor + corectări | modelul de generare existent (`AI_GEN_CHAT_MODEL` — „sol"), **ca până acum** |
| Subiecte de examen **PDF** (tabul Simulări → „Subiect PDF") | generatorul existent `/api/ai-exam` (`sol`), **neschimbat** |
| Exerciții și teste **interactive** de EN/BAC (test inițial, seturi, remedieri, simulări interactive) | **Claude Opus 5** (`api/_lib/claude.js`), după modelul exercițiilor din site (RAG), cu fallback automat |

**Materialele din site au prioritate peste tot** (teme, exersare, teorie):
- temele dau ÎNTÂI exerciții interactive EXISTENTE, nefinalizate de elev
  (tabela `content`, verificat prin `progress`); doar la epuizare se generează;
- lecțiile listează ÎNTÂI materialele potrivite din site (Rezolvări/Teorie,
  articole, auxiliare, PDF-uri) și abia apoi predau lecția generată;
- orice generare primește ca model exemple reale din baza de cunoștințe
  (`ai_knowledge` — RAG), deci păstrează stilul și notațiile site-ului.

---

## 🗺️ Fluxul elevului

1. **Înscriere** (`/meditatii`): clasa (5–12) + examenul-țintă (EN / BAC pe profiluri).
2. **Test inițial adaptiv** (~12 întrebări, de la ușor la greu, cu materia
   anilor anteriori) → stabilește **nivelul** (începător/mediu/avansat) și
   **lacunele** pe capitole.
3. **Plan personalizat**: toate capitolele programei, cu lacunele primele,
   obiectiv săptămânal, timp estimat, procent de progres.
4. **Meditația propriu-zisă**: 📖 teoria (materiale din site + lecție
   structurată cu formule, exemplu rezolvat, schemă; export PDF) → ✍️
   exerciții corectate pe loc.
5. **Analiza greșelilor**: nu doar „greșit", ci **motivul** — greșeală de
   calcul / formulă / concept / regulă / neatenție — salvat în jurnalul de
   greșeli.
6. **Remediere**: „🔁 încă 10 exerciții de EXACT același tip" până stăpânește
   procedeul (greșeala se marchează vindecată la ≥80%).
7. **Capitol finalizat** (≥80%) → intră în **repetiția inteligentă**:
   recapitulare după **1 zi → 7 zile → 30 de zile** (notificări la clopoțel).
8. **Teme**: butonul „Dă-mi o temă acum" + teme automate de la cron; corectate,
   **notate 1–10**, cu explicarea greșelilor.
9. **Simulări de examen**: interactivă (Opus 5, cu punctele slabe incluse) sau
   subiect PDF oficial (generatorul existent).
10. **Predicția notei**: estimare 1–10 din stăpânire + teme + simulări, cu
    capitolele de consolidat pentru țintă.
11. **Chat socratic oricând** („💬 Întreabă profesorul"): pune întrebări, cere
    „explică-mi mai simplu / vizual / cu exemple din viața reală / pas cu pas"
    — preferința se ține minte (memoria pedagogică) și intră în toate
    generările și explicațiile viitoare.

## 👨‍👩‍👧 Raportul pentru profesori și părinți (funcția 18)

Mentorii asociați (prin codul de asociere existent) văd în **Contul meu →
Raport AI**, pentru fiecare elev: progresul planului, timpul de studiu,
capitolele finalizate/în lucru, dificultățile (capitole slabe + tipurile de
greșeli), temele și **recomandări pentru perioada următoare**. (Server:
`ai-activity` → blocul `meditatii`; și `ai-meditatii` → `mentor_report`.)

## 🔒 Acces

Meditațiile sunt **doar pentru abonați** (fără cele 2 acțiuni gratuite de
probă — alegere de produs). Gatingul e aplicat pe server la fiecare acțiune;
neabonații văd rubrica cu descrierea și butonul de abonare. Profesorii și
părinții nu au meditații proprii — văd raportul elevilor în profil.

## 🧩 Fișiere

- nou: `supabase/meditatii_schema.sql`, `api/_lib/meditatii.js`,
  `api/ai-meditatii.js`, `src/pages/Meditatii.jsx`, `GHID_MEDITATII.md`
- modificate: `api/_lib/ai.js` (reguli socratice + memoria pedagogică în chat),
  `api/ai-activity.js` (raport meditații pentru mentori), `api/sitemap.js`,
  `src/App.jsx` (ruta `/meditatii`), `src/lib/aiClient.js`,
  `src/components/Navbar.jsx` (D), `src/components/AITutor.jsx` (widget, C),
  `src/pages/ProfesorVirtual.jsx` (taburi elev, C), `src/pages/Home.jsx`
  (rubrica pe prima pagină), `src/pages/Profile.jsx` (raport per elev și
  pentru profesori), `src/components/ParentAIActivity.jsx`, `vercel.json`
  (cron + SEO meta pentru `/meditatii`).

## 🔄 Runda 2 (după testarea pe site)

1. **Icon unitar**: toca 🎓 a fost înlocuită cu iconul Einstein al Profesorului
   Virtual peste tot (navbar, burger, widget, taburi, Home, butoanele „Nu înțeleg").
2. **Redactarea testelor**: LaTeX-ul corupt („sqrt13", „frac32") se repară
   automat la generare (`fixLatex` în `api/_lib/meditatii.js`) și, ca plasă de
   siguranță, la afișare (pentru seturile deja salvate). Promptul cere acolade
   obligatorii la argumente.
3. **Un singur chat**: butonul separat „Întreabă profesorul" a dispărut de pe
   /meditatii — widgetul plutitor preia rolul și se numește acolo
   **„Meditatorul tău"**; „Nu înțeleg" la un exercițiu deschide widgetul cu
   exercițiul în context.
4. **Feedback instant**: orice apăsare care pornește o generare arată imediat
   bannerul „Profesorul pregătește… (~30s)"; corectarea rulează actualizările
   de stăpânire în paralel (era secvențial → lent).
5. **Raport AI**: „Subiecte după dificultate (media clasei)" și „Progresul pe
   subiecte" sunt acum rolldown; părinții primesc clopoțel când copilul
   lucrează (o dată pe zi).
6. **Rezultate elevi**: temele de meditații (inclusiv cele generate) apar în
   „Grupe / Rezultate elevi", cu punctaj și notă.
7. **„Temă nefăcută" fals**: cronul reconciliază întâi temele „din site" cu
   `progress`, iar la rezolvare notificarea veche se marchează citită.
8. **Fără teme duplicate**: un material dat o dată ca temă nu mai e dat a doua oară.
9. **Toată teoria din site în plan**: capitolele din rubricile „Capitole
   pentru BAC / Evaluare Națională" (subcategory=`capitole`) intră automat în
   plan (fără dubluri față de programă); lecția lor deschide întâi materialul din site.
10. **Profesorul conduce meditația**: în „Astăzi", mesajul lui de întâmpinare
    (construit din memoria pedagogică: zile de pauză, ultimul scor, greșeli,
    recapitulări scadente) propune pașii în ordine — butonul principal + „Mai
    departe →" + „Continuă în conversație"; chatul primește aceeași stare și
    are instrucțiuni să ia inițiativa. Butoanele statice rămân pentru sărituri rapide.

## 🔄 Runda 3 — meditația condusă prin widget

1. **Profesorul comunică prin widget și pornește singur**: la sosirea pe
   /meditatii widgetul se deschide cu mesajul de bun venit + pașii propuși ca
   BUTOANE în conversație; după fiecare set corectat / temă notată, widgetul
   revine automat cu aprecierea și pasul următor. Aceste mesaje „coach" sunt
   scrise cu **gpt-4o-mini** (economie de tokeni; opțional `AI_COACH_MODEL` în
   Vercel), cu fallback determinist fără cost. Generarea de exerciții rămâne
   neschimbată: sol / terra / **Claude Opus 5**.
2. **Profesorul pornește pași direct din conversație**: când elevul acceptă
   („da", „hai"), modelul emite un marcaj invizibil
   `[[MEDITATII:{"kind":"exercitii","chapterId":"..."}]]` — platforma pornește
   automat exercițiile/teoria/recapitularea/tema/simularea. Dacă elevul nu e pe
   /meditatii, e dus acolo și pasul pornește singur.
3. **„Progresul meu"** — tab nou în meditații: plan parcurs, timp, serie de
   zile, nota estimată + stăpânirea pe subiecte.
4. **„🔊 Ascultă teoria"** — profesorul recită întreaga lecție (vocile din
   sistem, gratuit), cu pauză/continuare și bară de progres.
5. **Tema se bifează PE LOC**: viewerul de exerciții apelează `homework_check`
   imediat după salvarea scorului; reconcilierea nu mai depinde de comparația
   strictă de timp (orice rezultat apărut după darea temei contează); eroarea
   de salvare a scorului e acum VIZIBILĂ în bara de sus (nu doar în consolă);
   adminul are acces la materialele premium (testarea temelor nu mai fugea la
   /preturi).
6. **Plan fără plafon de capitole**: EN = toată programa claselor 5–8 (24 de
   capitole) + rubricile „Capitole" din site (EN **și** clasele 5–8); BAC =
   clasele 9–12 + rubricile „Capitole" (BAC și clasele 9–12). Planurile
   existente rămân cum sunt — pentru planul lărgit: „Reia evaluarea inițială".
7. **Eticheta nivelului**: „Nivel (evaluare inițială): avansat" — clar că vine
   din testul inițial.

## 🔄 Runda 4 — accent pe widget + bifarea sigură a temelor

1. **Tema se bifează DIRECT din exercițiu**: linkul temei conține acum
   `?temaId=...`, iar viewerul trimite scorul către `homework_score` imediat ce
   elevul apasă „Corectează" — bifarea nu mai depinde deloc de tabela
   `progress` (chip „✓ Temă bifată · nota X" în bara de sus). Reîncercările
   păstrează scorul cel mai bun. Temele vechi blocate se rezolvă apăsând
   „Rezolvă" (noul link) sau se bifează automat dacă există scor în `progress`.
2. **Accentul cade pe widget**: mesajul static al meditatorului a dispărut din
   pagină; pe /meditatii widgetul devine **panou lateral andocat, mare**
   (~460px), iar pagina se strânge lângă el (pe ecrane late) ca să se vadă
   amândouă. Widgetul dă de lucru: bun venit + butoane de pași, aprecieri și
   pasul următor după fiecare set.
3. **Widgetul „Meditatorul tău" e doar conversație**: fără „Învață-mă /
   Teoria / Dă-mi un indiciu", fără „Deschide complet", fără taburi — doar
   chatul și butoanele de lucru.
4. **„📋 Raport meditator"** — tab nou lângă „Progresul meu", cu rolldown-uri:
   teme nefăcute (cu „Rezolvă"), greșeli de vindecat (cu „10 la fel"), nota
   estimată și „cum să îți explic" (preferința de stil).

## 🔄 Runda 5 — sistemul de teme, refăcut cap-coadă

Fluxul temelor (cel mai important) este acum:
1. **AI-ul dă tema** — un test/exercițiu interactiv EXISTENT în site (nefinalizat
   și nedat înainte); generează doar la epuizare.
2. **Elevul rezolvă** — linkul „Rezolvă" deschide exercițiul cu `temaId`.
3. **Rezultatul se înregistrează GARANTAT**: la „Corectează", serverul
   (`homework_score`) bifează tema (notă 1–10, cel mai bun scor) și scrie
   rezultatul și în tabela `progress` cu service role — deci apare SIGUR la
   profesori/părinți în „Rezultate elevi" și în rapoarte, chiar dacă salvarea
   din browser eșuează.
4. **„Progresul meu"** arată acum și rezultatele: temele rezolvate (cu notă) +
   testele din site finalizate (scor, încercări, dată).

În plus:
- **„Reia evaluarea de la zero" șterge TOT** (plan, teme, sesiuni, greșeli,
  recapitulări, notificări) — temele vechi nu mai rămân „nefăcute" după reset
  (cauza erorii raportate).
- **Pagina se strânge DOAR cât e deschis Meditatorul** și revine pe toată
  lățimea la închidere; la formularul de înscriere/reset widgetul se închide
  singur (starea e sincronizată global, nu se mai „blochează" strânsă).
- Slug-urile de subiecte („raportul_de_asemanare") apar peste tot ca text
  lizibil, nu ca indici LaTeX.

## 🔗 Runda 6 — legarea completă de site (site-first peste tot)

**Principiu: profesorul folosește ÎNTÂI materialele site-ului, generează doar
la epuizare — iar TOT ce lucrează elevul se înregistrează și se vede.**

1. **Exercițiile din plan sunt „site-first"**: la „✍️ Exerciții", dacă există un
   test interactiv în site potrivit capitolului (nefăcut, nedat ca temă), se
   deschide ACELA (`?medSesId=` în URL) — fără nicio generare. Abia când s-au
   epuizat se generează un set nou (Opus 5, după modelul din site).
2. **Simulările sunt „site-first"**: întâi testele din categoria examenului
   (EN/BAC) neînregistrate și nedate ca temă; după epuizare se generează.
3. **`session_score`** (acțiune nouă): viewerul de exerciții trimite scorul
   imediat după „Corectează" pentru sesiunile site-first — sesiunea se
   finalizează, capitolul avansează (≥80% → finalizat + recapitulare), stăpânirea
   și seria de zile se actualizează, iar părinții sunt anunțați.
4. **Plasă de siguranță pentru scoruri (MATE_SCORE_HINT)**: unele teste „native"
   au codul MATE_SCORE în fișier dar nu îl trimit la „Corectează". Bridge-ul
   citește atunci scorul din pagină („Scor: 45/90 pct") și trimite un HINT;
   viewerul îl folosește DOAR dacă nu sosește un scor autentic în ~1,2s —
   așa se salvează rezultatul + tema + notificarea părinților și la aceste teste.
5. **Rezultatele se văd peste tot**: elevul — în „Progresul meu" (teme + seturi
   lucrate + teste din site); profesorii/părinții — în „Rezultate elevi"
   („Meditații cu Prof. Virtual — teme și seturi lucrate") și în raportul
   pentru părinți („Rezultate recente" cu fiecare set și scor).
6. **Butoane noi, în pagină și în widget**: „✍️ Știu teoria — direct la
   exerciții" (sare peste lecție), „📋 Alege alt capitol", „🧩 Test din site ·
   Evaluarea Națională/BAC" și „🏁 Încheie meditația și dă-mi tema" (dă temă și
   închide sesiunea; data viitoare briefingul propune reluarea de unde a rămas).
   Chat-ul are marcaje noi: `[[MEDITATII:{"kind":"plan"}]]` și `"end"`.
7. **Rapoarte mai curate**: „Elevi care au nevoie de atenție" e rolldown;
   „Progres AI" din Rezultate elevi arată doar media (fără titlurile lecțiilor) —
   detaliile pe subiecte rămân la Raport AI → „Subiecte după dificultate".

## 🎯 Runda 7 — pregătirea pentru LUCRĂRI și TESTE (nu doar examen)

Elevul se poate pregăti cu meditațiile și pentru **lucrările/testele de la
școală**, din anumite capitole sau toată clasa — nu doar pentru examenul final.

**Instalare:** rulează o dată `supabase/meditatii_focus.sql` în Supabase →
SQL Editor (adaugă coloana `focus` pe profilul de meditații; idempotent —
inclus și în `meditatii_schema.sql` pentru instalările noi).

**Cum funcționează (elev):**
1. **Unde:** la înscriere (secțiunea „🎯 Am un test / o lucrare în curând”) sau
   oricând după aceea — butonul „🎯 Pregătire pentru lucrare/test” din tab-urile
   „Astăzi” / „Planul meu”.
2. **Ce alege:** tipul testului — **lucrare/test din capitole**, **test din
   lecții** (lecțiile se scriu în câmpul liber) sau **test inițial** (materia
   anului trecut; fără selecție = tot anul trecut) — apoi **capitolele** dintr-un
   rolldown (programa clasei + materia anului trecut + capitolele din site/plan),
   un **câmp liber** pentru un capitol care lipsește din listă sau alte
   indicații și **data testului** (până când se face recapitularea).
   „Lucrare” fără capitole alese = **toată clasa**.
3. **Planul de recapitulare ține cont de ele:** capitolele testului au
   PRIORITATE în plan (profesorul le propune primele — briefing, coach, pasul
   zilei), cele care nu erau în plan (anul trecut / capitol scris liber) se
   ADAUGĂ automat, iar bannerul 🎯 din „Astăzi” arată progresul
   (N/M capitole), zilele rămase și **ritmul necesar** (~capitole/săptămână)
   ca recapitularea să se termine până la dată.
4. **Testul inițial** de la înscriere se dă din capitolele alese (dacă există),
   ca lacunele găsite să fie exact pe materia testului.
5. **„🧩 Test de verificare”** (banner + tab-ul Simulări + butonul din chat):
   un test DOAR din capitolele pregătirii — întâi un test potrivit din site
   (site-first), apoi generat; rezultatul intră în plan/rapoarte ca orice set.
6. **Examenul final rămâne neschimbat:** pentru EN/BAC nu se setează nimic —
   planul de recapitulare rămâne întreaga materie, ca până acum („renunță la
   pregătire” face același lucru). Pregătirea de lucrare se poate folosi și în
   paralel cu planul de examen (ex. elev de a 8-a cu EN + teză pe 2 capitole).

Server: `api/_lib/meditatii.js` (`cleanFocus` / `applyFocus` / `focusInfo` /
`focusPool` + prioritatea din `nextChapter`), `api/ai-meditatii.js` (acțiunea
`set_focus`, setup/assessment cu focus, testul de verificare în `simulare`,
briefing/coach). Client: `src/pages/Meditatii.jsx` (FocusFields/FocusModal,
banner, plan, simulări) + `src/components/CapitolePicker.jsx` și
`src/lib/capitole.js` (rolldown-ul de capitole, partajat cu generatoarele
profesorului). Teste: `test/meditatii-focus.test.js`.

## 🛠️ Depanare

| Simptom | Cauză / soluție |
|---|---|
| „Pregătirea pentru lucrări cere o mică actualizare a bazei de date” | Rulează `supabase/meditatii_focus.sql` (o singură dată). Fără el, restul meditațiilor merge normal — doar pregătirea de lucrare e inactivă. |
| „Meditațiile fac parte din abonament" | Contul nu are abonament activ — comportament intenționat. |
| Testul inițial nu se generează | Verifică `ANTHROPIC_API_KEY` sau `OPENAI_API_KEY` în Vercel; vezi logurile funcției `ai-meditatii`. |
| Tabelele lipsesc / erori 500 la `state` | Rulează `supabase/meditatii_schema.sql`. |
| Temele nu vin automat | Cron-ul rulează zilnic la 17:00 (RO) și dă teme doar elevilor abonați, inactivi de 3+ zile, fără teme restante. |
| Recapitulările nu apar | Apar doar după primul capitol FINALIZAT (≥80% la un set), la 1 zi / 7 / 30. |
| Tema „din site" nu se bifează | Elevul trebuie să termine exercițiul (scorul se salvează în `progress`); la următoarea deschidere a paginii se bifează automat. |
