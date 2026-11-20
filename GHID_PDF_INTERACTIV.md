# 🧩 PDF ↔ testul interactiv · punctajul cumulat între metode

*19 noiembrie 2026*

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
