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

Coloana `content.interactiv_id` (pe rândul PDF-ului; testul șters → asocierea dispare singură). **398 de PDF-uri** au testul lor; lista completă, cu temeiul fiecărei asocieri: [`docs/asocieri-pdf-interactiv.csv`](docs/asocieri-pdf-interactiv.csv).

| | PDF-uri cu test | fără |
|---|---|---|
| Clasele V–XII | 143 | 3 (fișe noi: „Fișă 19 … 100 exerciții", „Fișă 5.1", „Fișă 4.2") |
| EN — Capitole | 29 | 0 |
| EN — Exerciții pe subiecte | 13 | 5 (Subiectul III, ex. 2–6: n-au test) |
| EN — Variante / Simulări | 12 | 71 |
| BAC — Capitole | 27 | 0 |
| BAC — Exerciții pe subiecte | 29 | 1 (testul lui a fost șters) |
| BAC — Variante | 145 | 7 |
| BAC — Teste de antrenament / Simulări | 0 | 254 (nu s-au generat teste după ele) |

Cum s-a verificat:
1. **Jurnalul generatorului** (`agent_task_runs`, 345 de asocieri): rularea care a făcut testul a notat PDF-ul-sursă (același titlu, aceeași categorie și același profil, testul creat după încărcarea PDF-ului). Pe titluri: anul și numărul variantei coincid la toate cele 255 de teste de examen. Dublurile: „2026 tehnologic varianta 03" are două teste identice (la 2 minute unul de altul) — l-am ales pe cel mai nou; testul vechi al „Fișei 16" (clasa a V-a), făcut după un PDF înlocuit între timp, nu e asociat.
2. **Conținutul**, la testele fără jurnal: testele gratuite (HTML public) comparate cu textul PDF-urilor; la cele Premium, textul lor indexat. Fraze comune rare (secvențe de 4 cuvinte), cu prag: cel puțin 12 și de trei ori mai multe decât la următorul PDF.
   - „Test interactiv Evaluare Națională" 1, 2, 3, 5, 6, 7, 11, 13 → „2021 model" cu același număr; 17 → „2021 variantă oficială iunie", 18 → „2021 sesiune specială", 19 → „2022 model 1", 28 → „2022 simulare oficială";
   - „BAC 2014 tehnologic v1" → „2014 Varianta 01" (tehnologic).
3. **Pe loturi**, verificat vizual (PDF-ul desenat vs. itemii testului): BAC „Capitole" (27, aceeași temă: „Radicali", „Fracții" — itemii sunt chiar exercițiile 1–5, 12–16 din PDF) și EN „Exerciții pe subiecte" (13, același titlu: „Subiectul II exercițiul 1" = exercițiile 1–5 ale PDF-ului).

**Neasociate, intenționat:** „Test interactiv Evaluare Națională" 4, 8–10, 12, 14–16, 20–27, 29, 30 (dovada nu e clară — pentru unele textul indexat nu are enunțuri); testele combinate din mai multe teste („Test 32–61"); testele vechi din iulie de la BAC 2014/2015 când PDF-ul are deja testul generatorului (rămân pe site, ca teste separate); testul de grup „Rezolvarea triunghiului dreptunghic", „Calcule cu numere întregi" (fără conținut de comparat), testul general al clasei a V-a.

**Asocierea se poate schimba din Admin:** 📋 Tot Conținutul → ✏️ la un PDF → **„🧩 Test interactiv asociat"** (testele interactive ale aceleiași clase / aceluiași examen; la BAC — același profil).

**Testele generate de acum înainte** dintr-un singur PDF (task „pe rând") devin singure testul interactiv al PDF-ului (dacă nu are deja unul) — la postarea automată și la aprobarea manuală (`api/_lib/exgen.js` → `asociazaPdf`).

## Ce e de rulat

Nimic — `supabase/pdf_interactiv.sql` (coloanele `content.interactiv_id`, `progress.itemi`, indexul; fără tabele noi) **a fost rulat în Supabase pe 19 nov. 2026** (migrația `pdf_interactiv`), iar cele 398 de asocieri sunt scrise. Fără el, „🧩 Interactiv" n-ar apărea, iar corectările ar merge ca înainte (ultima contează).
