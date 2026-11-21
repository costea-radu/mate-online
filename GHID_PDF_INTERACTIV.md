# 🧩 PDF ↔ testul interactiv · punctajul cumulat între metode

*19 noiembrie 2026 · legătura vizibilă peste tot pe site: 20 noiembrie 2026 · Admin → 🔗 PDF ↔ Interactiv și asocierea automată: 21 noiembrie 2026*

## 🔗 Admin → „PDF ↔ Interactiv" și asocierea automată (21 nov. 2026)

Cererea: „Fă în admin o rubrică în care pot asocia manual un PDF de un test interactiv. Fă ca PDF-urile să se asocieze automat cu un test interactiv generat după modelul lui."

### Fila „🔗 PDF ↔ Interactiv" (Admin, după „🧩 Exerciții Interactive")

| Vederea | Ce arată | Ce poți face |
|---|---|---|
| **📄 PDF-uri** (fără bareme) | testul principal („🧩 Testul interactiv: „…""), celelalte teste făcute după PDF („↳ alt test…"), „⛓️‍💥 Fără test interactiv" | **🔗 Asociază un test / Schimbă testul** (caută + alege: făcute după PDF, potrivite după titlu, fără PDF, făcute după alt PDF — se mută), **✕ dezleagă**, **⭐ fă-l principal**, „💡 Pare făcut după el: … ✓ Asociază" |
| **🧩 Teste interactive** | PDF-ul după care e făcut testul (principal sau „alt test") sau motivul: „🔀 combinat din 13 teste interactive (task-ul „…")" | **🔗 Alege PDF-ul / Schimbă PDF-ul** (cu bifa „E testul principal al PDF-ului"), ✕ dezleagă, ⭐ fă-l principal |

Filtre: categoria, rubrica (EN / BAC), profilul (BAC), „Fără test interactiv / Cu test interactiv" („Fără PDF / Cu PDF"), căutare. La „Fără test interactiv" apar PDF-urile fără test pe rubrici, cu drumul spre generare: un task „pe rând" pe rubrica lor (🤖 Unelte AI → Agent Claude → 🗓 Task-uri programate) — fiecare test generat se asociază singur.

**Testul principal** = cel deschis de „🧩 Deschide interactiv" (cardul PDF-ului) și de „✏️ Rezolvă ▾" → „🧩 Interactiv" (fără abonament, testul gratuit al PDF-ului, dacă există). Un PDF rămas fără principal, dar cu alte teste făcute după el, îl primește singur pe cel mai nou (altfel și-ar pierde butonul de pe site).

Reguli (serverul le verifică — `api/content-admin.js` → `asociazaPereche`): un **barem** nu are test; PDF-ul și testul din **aceeași categorie** (clasă / examen); la BAC, **același profil** (dacă ambele au unul).

### 🤖 Asociază automat

Propuneri pentru testele fără PDF (un test are un singur PDF, deci se pornește de la teste):
1. **jurnalul generatorului** (`agent_task_runs.combined_from`): un singur PDF al rubricii task-ului → **sigur**; task pe teste interactive sau mai multe PDF-uri → test **combinat**, fără propunere;
2. **titlul**: cuvintele și numerele comune, fără tipul materialului, examen, profil și clasă (`api/_lib/pdfTestPotrivire.js` → `scorTitluri`). **Sigur** = cel puțin 85% și cu 20 de puncte peste al doilea PDF; **de verificat** = cel puțin 55%. Doar numerele („Test interactiv EN - 9" ↔ „2021 model 9") nu dau niciodată o propunere; nici o egalitate.
O propunere sigură spre un PDF care are deja test devine „de verificat". Cele sigure sunt bifate; „✓ Asociază bifatele" le leagă (testul devine principal doar dacă PDF-ul n-are unul). **Pe datele de azi: nicio propunere** — cele 33 de teste fără PDF sunt combinate (EN 32–61, „Chestionar … Test 42", jurnalul le arată sursele), fără sursă sigură („Calcule cu numere întregi" — fișele 7, 11 și 12 la egalitate; „Test interactiv — Matematică, clasa a V-a") sau la Auxiliare.

### Asocierea automată la creare

| Drumul testului | Cum își află PDF-ul |
|---|---|
| Task programat „pe rând" (agentul Claude) | PDF-ul-sursă al rulării — `api/_lib/exgen.js` → `asociazaPdf` (la postare și la aprobare), ca până acum |
| Agentul Claude din Admin (🤖 Unelte AI) | PDF-ul ales „📚 Din baza de date" ca model (exercițiile, apoi formatul) sau sursa automatizării „pe rând" (`api/ai-exercise-agent.js` → `sourceId`); merge cu testul la «Adaugă Interactiv» (caseta „🔗 Făcut după PDF-ul „…""), categoria și profilul se pun singure |
| «🧩 Exerciții Interactive» (încărcare manuală) | câmpul **„📄 Făcut după PDF-ul (se asociază singur)"**: ales singur după titlu când potrivirea e sigură („🤖 Ales automat după titlu"), propus când e probabilă („💡 Pare făcut după…"), sau ales de mână |

După încărcare, testul se leagă de PDF (`asociaza`, `principal: 'daca-lipseste'`) și mesajul spune dacă a devenit testul lui principal.

**Fișierele:** `src/components/AdminPdfInteractiv.jsx` (fila + `AlegePdfSursa`), `api/_lib/pdfTestPotrivire.js` (potrivirea, pură — și în browser, prin pluginul `COMUNE_SERVER` din `vite.config.js`), `api/content-admin.js` (`perechi`, `asociaza`, `asociaza_lot`, `dezleaga`), `src/pages/Admin.jsx`, `src/components/AIExerciseAgent.jsx`, `api/ai-exercise-agent.js`. Teste: `test/pdf-interactiv-admin.test.js`.

**De rulat:** nimic — fără SQL nou, fără tabele noi.

### Tot atunci, pe site
- Vizualizatorul PDF: „✏️ Rezolvă pe PDF ▾" → **„✏️ Rezolvă ▾"**; cardurile PDF: „Deschide / Descarcă" → **„Deschide PDF"**, „🧩 Interactiv" → **„🧩 Deschide interactiv"**.
- PDF primul, apoi interactive, la examene și la clase (Bacalaureat: „📄 PDF+Interactive" primul și deschis; comutatorul din secțiuni: 📄 PDF | 🧩 Interactive; clasele: „📄 Exerciții PDF" prima filă); `?tab=interactive` deschide direct testele.
- Fără chenarul „▶ Începe un test / 📄 Generează un subiect" de sus, pe Evaluare Națională și Bacalaureat.

---

## Legătura PDF ↔ test, peste tot pe site (20 nov. 2026)

Cererea: „Fă o legătură mai bună între testele PDF și testele interactive și asociază-le."

Asocierea era deja în bază (437 de teste cu PDF-ul lor, 417 PDF-uri cu test principal; verificat din nou pe 20 nov.: nicio legătură în dezacord), dar se vedea doar în vizualizatorul PDF, la „✏️ Rezolvă pe PDF ▾" → „🧩 Interactiv". Acum se vede din ambele părți:

- **Cardul unui PDF** (Evaluarea Națională, Bacalaureat — toate secțiunile, inclusiv Variante / Simulări / Teste de antrenament —, clasele și capitolele lor): rândul „🧩 Are test interactiv: „…"" și butonul **„🧩 Interactiv"** lângă „Deschide / Descarcă" (din 21 nov. 2026: „🧩 Deschide interactiv" lângă „Deschide PDF"). Deschide același test ca vizualizatorul (fără abonament, testul gratuit al PDF-ului, dacă există; altfel „🧩 Interactiv ⭐"). Punctajul se cumulează ca din vizualizator; „← Înapoi" duce înapoi la listă.
- **Cardul unui test interactiv** (fila „🧩 Teste Interactive" și paginile claselor): rândul **„📄 Făcut după PDF-ul „2021 model 3""** și butonul **„📄 PDF"** (cu ⭐ dacă PDF-ul e Premium și elevul n-are abonament).
- **Testul deschis direct din listă** își arată PDF-ul în banda de sub bara de sus: „📄 Testul e făcut după PDF-ul „…"" + **„📄 Deschide PDF-ul"** (pe telefon „📄 PDF"). La testele întregi de examen (Variante, Simulări, Variante AI, Teste de antrenament) **exercițiile rezolvate aici intră și în punctajul PDF-ului**, la fel ca atunci când testul e deschis din PDF (serverul verifică legătura — `api/ai-score.js`). La fișe și capitole punctajul PDF-ului rămâne, iar banda spune că testul se poate rezolva și pe PDF. Nu apare în tema pe grupă, duel, tema de la Meditator și sesiunea de meditații.
- **Admin → 📋 Tot Conținutul**: sub fiecare PDF / test, perechea lui („🧩 Test interactiv: „…"" · „N teste făcute după el"; „📄 Făcut după PDF-ul „…" · principal") sau, cu portocaliu, „fără test interactiv" / „nefăcut după un PDF"; filtrul nou **„PDF ↔ test"** (🔗 Asociate / ⛓️‍💥 Neasociate, fără bareme) arată ce mai e de legat. Legătura se schimbă tot din ✏️ (mai jos).

Codul: `src/lib/pdfInteractiv.js` (nou — regulile comune: ce test deschide „🧩 Interactiv", legăturile unei liste întregi în câteva cereri, pe bucăți de câte 60, starea de navigare), `src/components/ContentPage.jsx` (`useLegaturiPdf`, butoanele din `ContentCard`), `src/components/ExamContent.jsx`, `src/pages/InteractiveViewer.jsx`, `src/pages/Admin.jsx`; `src/pages/PDFViewer.jsx` folosește aceleași reguli din bibliotecă. Teste: `test/pdf-interactiv-legaturi.test.js`.

**Ce rămâne fără pereche, și de ce** (neschimbat): testele EN „Test 32–61" sunt combinate din câte 11–16 alte teste, cu exercițiile modificate (jurnalul generatorului, `agent_task_runs.combined_from`) — n-au un PDF al lor; „Test interactiv — Matematică, clasa a V-a" (combinat), „Calcule cu numere întregi" (s-ar potrivi la fel de bine cu Fișa 11 și cu Fișa 12), „Recapitulare clasele 5-8" (Auxiliare). PDF-urile fără test (BAC Simulări / Teste de antrenament, EN Simulări, câteva variante și fișe) n-au încă un test generat după ele.

**De rulat:** nimic — fără SQL nou, fără tabele noi.

---

Cererea: „1. Asociază fiecare PDF cu testul interactiv generat după el. Verifică să fie asocierea corectă. 2. Fă ca în butonul «rezolvă pe PDF» de pe PDF-uri, pe lângă variantele de rezolvare din rolldown, să apară și «interactiv», care deschide testul interactiv asociat PDF-ului. Pentru testele de evaluare națională fă să apară sub «pe PDF» iar la celelalte tipuri de PDF: bac și clase, să apară primul. La schimbarea metodei de rezolvare în timpul rezolvării, să se păstreze punctajul acumulat până atunci."

## Ce vede elevul

- În vizualizatorul PDF, **„✏️ Rezolvă pe PDF ▾"** are metoda **„🧩 Interactiv"** când PDF-ul are un test interactiv asociat:
  - la **Evaluarea Națională** — a doua, sub „Pe PDF";
  - la **Bacalaureat** și la **clase** — prima.
  Metoda deschide testul interactiv; scrisul de pe PDF rămâne în ciornă. Dacă testul e Premium și elevul n-are abonament, lângă metodă scrie „⭐ Premium".
- În meniu: **„📈 Punctajul tău la test: 35/90p"** (dacă a corectat ceva în ultimele 24 de ore) și „Poți schimba metoda oricând: punctajul de până acum se păstrează".
- În testul interactiv deschis din PDF, o bandă sub bara de sus: **„📄 Rezolvi interactiv testul „…" · punctajul tău la test: 35/90p · nota 4,50"** și **„↩ Înapoi la PDF"** (pe telefon: un singur rând, „↩ PDF"). „← Înapoi" duce tot la PDF.

## Punctajul cumulat (pe exerciții)

Până acum, fiecare corectare scria în rezultate doar punctele ei — ce se făcuse cu metoda de dinainte avea 0. Acum rezultatul unui test se ține **pe exerciții** (`progress.itemi`, `api/_lib/punctajCumulat.js`):

- exercițiile corectate acum le înlocuiesc pe aceleași de dinainte (ultima contează, pe fiecare exercițiu);
- exercițiile nerezolvate acum își **păstrează punctele**;
- punctajul testului (în „Rezultatele mele", la profesor, la părinte) și **nota scrisă cu roșu pe PDF** sunt ale testului întreg;
- o corectare la mai mult de **24 de ore** după cea de dinainte începe o rezolvare nouă.

Toate metodele intră în cumul: ✏️ pe PDF (`api/rezolva-pdf.js`), 📷 cu poză / 💬 în chat / formularul de la BAC și clase (`api/ai-correct.js`), ✍️ foaia de lucru — „🎓 Cere corectarea" (`api/ai-handwriting.js`) și 🧩 testul interactiv deschis din PDF (`api/ai-score.js`). Mesajul profesorului spune: „📈 Punctajul testului, cumulat: 40/90p · nota 5,00 — am păstrat și cele 6 exerciții corectate mai devreme (pe PDF, în testul interactiv): 35p."

Cheile sunt aceleași pentru toate metodele: „I.3" (formularul), „1.3" (harta testului de pe PDF), „Subiectul I, exercițiul 3" (testul interactiv) → `1.3`; subpunctele: „III.2.a" → `3.2.a`. Un exercițiu întreg și subpunctele lui se înlocuiesc unele pe altele.

**Testul interactiv → PDF.** Puntea testului (`src/lib/tutorBridge.js`, `MATE_ITEMS`) spune ce exerciții a rezolvat elevul (șablonul cu pași — variantele de BAC / EN — și cardurile-grilă), cu punctele lor. Ele se adaugă la punctajul PDF-ului doar:
- dacă PDF-ul chiar are acest test asociat (verifică serverul);
- la testele întregi de examen (EN / BAC: Variante, Simulări, Variante generate cu AI, Teste de antrenament) — aceeași structură, Subiectele I–III.
La fișe și la capitole, testul interactiv are propria numerotare: punctajul PDF-ului rămâne cum era (banda o spune), iar testul își are rezultatul lui.

## Asocierea PDF ↔ test (verificată)

Două legături, ambele în tabela `content` (un test șters → legătura dispare singură):
- **`content.pdf_sursa_id`** — pe rândul unui **test interactiv**: PDF-ul după care e făcut (`supabase/pdf_sursa.sql`). Un PDF poate avea mai multe teste (ex. varianta veche, gratuită, din iulie și cea nouă a generatorului).
- **`content.interactiv_id`** — pe rândul unui **PDF**: testul lui **principal**, cel deschis de „🧩 Interactiv" (`supabase/pdf_interactiv.sql`). **Elevul fără abonament** primește un test **gratuit** al aceluiași PDF, dacă principalul e Premium și există unul (`alegeTestInteractiv` în `src/pages/PDFViewer.jsx`).

**437 din 470 de teste interactive** au PDF-ul lor; **417 PDF-uri** au test principal. Lista completă, cu rolul și temeiul fiecăreia: [`docs/asocieri-pdf-interactiv.csv`](docs/asocieri-pdf-interactiv.csv).

| | PDF-uri cu test | fără |
|---|---|---|
| Clasele V–XII | 144 | 2 (fișe încărcate în noiembrie, fără test: „Fișă 5.1", „Fișă 4.2") |
| EN — Capitole | 29 | 0 |
| EN — Exerciții pe subiecte | 13 | 5 (Subiectul III, ex. 2–6: n-au test) |
| EN — Variante | 28 | 13 |
| EN — Simulări | 2 | 40 |
| BAC — Capitole | 27 | 0 |
| BAC — Exerciții pe subiecte | 29 | 1 (testul lui a fost șters) |
| BAC — Variante | 145 | 7 |
| BAC — Teste de antrenament / Simulări | 0 | 254 (nu s-au generat teste după ele) |

**Fără PDF (33):** testele combinate din mai multe teste (EN „Test 32–61", 30 de teste — cum ai spus); „Test interactiv — Matematică, clasa a V-a" (făcut de o sarcină a generatorului ștearsă între timp; titlul general arată un test combinat, iar fișierul n-are text de comparat); „Calcule cu numere întregi" (clasa a VI-a, încărcat manual în mai, fără text de comparat — s-ar potrivi la fel de bine cu Fișa 11 și cu Fișa 12, ambele cu testul lor); „Recapitulare clasele 5-8" (la Auxiliare, unde nu există PDF-uri). Le poți lega oricând din Admin.

Cum s-a verificat:
1. **Jurnalul generatorului** (`agent_task_runs`, 349 de teste): rularea care a făcut testul a notat PDF-ul-sursă (același titlu, aceeași categorie și același profil). Anul și numărul variantei coincid la toate testele de examen. Fișele de clasa a V-a reîncărcate și renumerotate pe 13 aug. („FIȘĂ 18 - 1" → „Fișă 19 (100 exerciții)", „FIȘĂ 19 - 2" → „Fișă 18") — după același șir de exerciții și aceeași notă („1 ar = 100 m²; 1 hectar = 10000 m²"); numerele diferă, testele fiind făcute după versiunile vechi.
2. **Conținutul**: testele gratuite (HTML public) comparate cu textul PDF-urilor; la cele Premium, textul lor indexat (Subiectul al II-lea, cu enunțuri), pe fraze comune rare și pe „semnăturile" exercițiilor (`BC=3`, `AO+DO=8`, `DP=3PC`…), iar unde a fost nevoie — **verificat vizual** pe pagina PDF-ului (testele 4, 22, 26). Seria „Test interactiv Evaluare Națională": **1–15 = „2021 model" cu același număr**, 16 = „2021 variantă de rezervă", 17 = „2021 variantă oficială iunie", 18 = „2021 sesiune specială", 19–24 = „2022 model 1–6", 25 = „2022 variantă oficială 1", 26 = „2022 variantă oficială 2" (câteva exerciții din alte materiale 2022), 27 = „2022 model oficial", 28 = „2022 simulare oficială", 29 = „2023 model", 30 = „2022 simulare Brăila"; „Test interactiv Matematică 1 · Subiectul I, II" e versiunea timpurie a testului 30 (fișierul `test-interactiv-30-…`). **Testele 8, 9, 12, 14, 15 n-au niciun text indexat** — sunt legate după serie (confirmată pe conținut la 1–7, 10, 11, 13); deschide-le o dată ca să le verifici.
3. **Pe loturi**, verificat vizual (PDF-ul desenat vs. itemii testului): BAC „Capitole" (27, aceeași temă) și EN „Exerciții pe subiecte" (13, același titlu).
4. **Testele vechi de BAC 2014/2015** (iulie): după anul, varianta și profilul din antetul testului; cele gratuite și pe conținut. Sunt „alt test" pentru PDF-ul care are testul generatorului — elevii fără abonament îl primesc pe cel gratuit.
5. „Rezolvarea triunghiului dreptunghic" (fișa de lucru pe grupe) → „Fișă 9: Trigonometrie" (antetul testului: „Fișă de Lucru – Trigonometrie, Clasa a 7-a").

**Din Admin:** 📋 Tot Conținutul → ✏️ la un **PDF** → **„🧩 Test interactiv asociat"** (principalul; testele făcute după el au 📄 în listă) sau la un **test** → **„📄 PDF-ul după care e făcut testul"**. Serverul ține legăturile în acord (`api/content-admin.js` → `legaturiInAcord`): testul principal e „făcut după" PDF-ul lui; un PDF fără test principal îl primește pe testul legat acum de el; un test mutat la alt PDF nu mai e principalul celui vechi.

**Testele generate de acum înainte** dintr-un singur PDF (task „pe rând") își știu PDF-ul și devin testul lui principal dacă nu are deja unul — la postarea automată și la aprobarea manuală (`api/_lib/exgen.js` → `asociazaPdf`).

**Dubluri:** „2026 tehnologic varianta 03" avea două teste generate la 2 minute unul de altul; cel vechi (neasociat, fără niciun rezultat) **a fost șters** pe 19 nov. 2026. Fișierul lui HTML a rămas în bucket-ul privat (`content-files/interactive/bacalaureat/1791317585339_task_bac-2026-…-intera.html`; Supabase nu șterge fișiere din SQL) — se poate șterge din Supabase → Storage.

## Fișierele Premium — doar prin linkul semnat

`supabase/storage_fisiere_premium.sql` (**rulat în Supabase pe 19 nov. 2026**, migrația `storage_fisiere_premium`): până acum orice cont autentificat, și unul gratuit, putea citi / descărca toate fișierele din bucket-ul privat `content-files` (căile sunt publice, în `content.file_url`) și putea încărca sau **șterge** fișiere din `content-files` și `content-files-free`. Acum:
- elevii primesc fișierele **doar prin linkul semnat de server** (`api/get-file-url.js`: gratuit → oricine; Premium → abonații, adminii, tema pe grupă cu „premium gratuit"), valabil 5 minute — neschimbat;
- în browser doar **adminii** citesc, încarcă și șterg în cele două bucket-uri (paginile din Admin);
- verificat cu roluri simulate: un cont gratuit și unul Premium văd 0 din cele 530 de fișiere Premium (înainte: 530), adminul le vede pe toate; încărcarea — refuzată pentru contul gratuit, permisă pentru admin.

## Ce e de rulat

Nimic — totul **a fost rulat în Supabase pe 19 nov. 2026**: `supabase/pdf_interactiv.sql` (coloanele `content.interactiv_id`, `progress.itemi`; migrația `pdf_interactiv`), `supabase/pdf_sursa.sql` (coloana `content.pdf_sursa_id`; migrația `pdf_sursa`) și `supabase/storage_fisiere_premium.sql` (migrația `storage_fisiere_premium`); asocierile sunt scrise (437 de teste). Fără tabele noi.
