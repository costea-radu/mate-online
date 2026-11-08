# ✏️ Rezolvă pe PDF — grila încercuită și Subiectul III scris direct pe testul de EN

Cererea lui Radu (7 nov. 2026): la PDF-urile de **Evaluare Națională**, grila de la Subiectele I și II să
se rezolve **direct pe PDF, prin încercuire**, iar la Subiectul al III-lea elevul să scrie **direct în zona
de rezolvare** — „un spațiu de lucru, dar invizibil", cu **recunoașterea exercițiului rezolvat** și
**corectare**; pornit cu **„Rezolvă pe PDF"**, cu **„Corectează"** la final; **PDF-ul rămâne PDF**.

**Runda a 2-a (8 nov. 2026):** corectarea — **doar cu Premium**, dar fără abonament elevul are **2 corectări
gratuite ale grilei, după barem** (fără AI), apoi îndemnul spre Premium; la grilă se poate **tăia** o variantă și
încercui alta, ori tăia și noua variantă și **reveni** la cea tăiată (litera scrisă lângă ea, încercuită);
butonul **„✏️ Rezolvă" pulsează**; „Spațiul de lucru" se numește acum **„Foaie de lucru"**; la **BAC și la
celelalte PDF-uri**, „✏️ Rezolvă" deschide **foaia de lucru**. Subiectul al III-lea — cu AI (Claude Opus 5.5),
după barem, Premium.

---

## Ce vede elevul

1. Deschide un test PDF de EN (variantă, model, simulare — nu baremele) și apasă **„✏️ Rezolvă pe PDF"**
   în bara de sus (pe telefon: „✏️ Rezolvă"). Butonul **pulsează** (un inel auriu) cât modul nu e pornit;
   cu „reducerea animațiilor" din sistem rămâne doar inelul, fix.
2. Peste pagini apare un **strat transparent de scris**. PDF-ul arată la fel; în bara de zoom apar uneltele:
   `✎ Scrie` · `◯ Radieră` · `✋ Derulează` · 3 culori (pix albastru, negru, roșu) · `↩` (și Ctrl+Z) · `🗑` ·
   `⬇ PDF` · **`✅ Corectează`** · `✕`.
3. **Grile (Subiectele I și II):** încercuiește litera (sau varianta). În marginea din stânga a exercițiului
   apare pe loc ce s-a recunoscut: `b)` · `⚠ a b` (două variante încercuite) · `?` (nicio variantă clară).
   Merge și cercul lăsat puțin deschis, cercul în jurul valorii, spirala. Bifa nu mai alege o variantă
   (regula foii de examen: se încercuiește). Calculele scrise lângă variante nu contează.
   **Răzgândirea, ca pe foaia de examen** (8 nov. 2026):
   - **a)** tai varianta încercuită (o linie peste literă și valoare) și încercuiești alta → contează cea nouă;
   - **b)** tai și noua variantă, iar **lângă varianta tăiată** pe care o vrei înapoi scrii litera ei și o
     **încercuiești** → contează aceea (la corectare: „revenire").
   Radiera și „↩" merg în continuare.
4. **Subiectul al III-lea:** scrie rezolvarea în spațiul de sub fiecare problemă — pe margine apare `✍️`.
5. La final, **„✅ Corectează"** (în bară sau în caseta „Ai terminat?" de după ultima pagină):
   - pe PDF: `✔ 5p` / `✖ 0p` / `? 0p` la grile, `3/5p` la probleme și `2/2p`, `1/3p` lângă a) și b);
   - în **Profesorul Virtual** (se deschide singur): punctajul pe subiecte, ce a citit din scris, pas cu pas,
     sfatul — și se poate întreba mai departe, în aceeași conversație.
   Litera corectă a unei grile greșite **nu se spune** (elevul poate reîncerca; „📋 Barem" rămâne la un clic).
6. Schimbă ceva la un exercițiu (radieră, alt cerc) → marcajul corectării lui dispare până la o nouă corectare.

**PDF-ul rămâne PDF:** zoom (butoane, două degete), „⤢ Pagina întreagă", 📋 Barem, ⬛ Original / ⬜ Fără
suprafață neagră, Profesorul Virtual, foaia de lucru din chat — toate merg și cât e pornit modul.
**„⬇ PDF"** descarcă același PDF (text, pagini) cu scrisul elevului desenat vectorial peste el.
Ce s-a scris rămâne pe dispozitiv (ciornă locală, `pdfink:<id>`) și reapare la redeschiderea modului.

Degete: **unul scrie, două derulează / măresc** (trasul abia început se anulează). Cu creionul (stylus), palma
sprijinită nu mai scrie; capătul-radieră al creionului șterge. Pe calculator: mouse-ul scrie, rotița derulează.

---

## Cum recunoaște exercițiul (fără AI)

Din **textul PDF-ului** (pdf.js) se face **harta testului**, în browser (`src/lib/pdfRezolvare.js`):
- **regiunile exercițiilor** — aceleași ca la „📎 Combină exact" (`src/lib/pdfCombine.js` →
  `examStructureOf`): „SUBIECTUL …" + „5p 1." … „6.", fiecare item cu zona lui (pe una sau două pagini);
- la grile, **pozițiile literelor a) b) c) d)** și ale valorilor (pe coloană, pe rând, 2×2; litera și valoarea
  pot fi în itemi pdf.js separați — rândurile se refac caracter cu caracter);
- la Subiectul al III-lea, rândurile `(2p) a)` / `(3p) b)` (pentru marcajele subpunctelor).

Fiecare traseu ajunge la exercițiul în a cărui zonă a fost scris. **Cercul** = traseu închis (capetele
apropiate, direcția se rotește ≥ ~1,45 ture sau traseul se taie pe sine) care cuprinde litera sau valoarea
**unei singure** variante (numărul de înfășurare). Un cerc peste mai multe variante e „neclar".

**Fără hartă** (PDF scanat, structură nerecunoscută, pagini rotite, **test combinat** din regiuni decupate —
acolo pdf.js dă și textul ascuns al paginilor-sursă, peste exercițiile vizibile: se recunoaște după textul
suprapus) se poate scrie la fel; la corectare paginile scrise merg întregi la corector (Premium).
Textul fără niciun pixel sub el (alb lipit peste, decupat) nu intră în hartă.

---

## Corectarea (`api/rezolva-pdf.js`, `api/_lib/pdfRezolvare.js`)

Un singur buton, **„✅ Corectează"**, care merge **cu Premium**; fără abonament: **2 corectări gratuite ale
grilei** (după barem, fără AI), apoi îndemnul spre Premium (8 nov. 2026).

| Ce | Cum | Cu Premium | Fără abonament |
|---|---|---|---|
| **Grile recunoscute** | litera elevului ↔ tabelul **baremului** de pe server (`barem.grilaAnswers`): 5p sau 0p; două variante = 0p; tăiată = nealeasă; „revenire" = litera încercuită lângă varianta tăiată | da (fără AI) | **de 2 ori** (gratuit, fără AI) |
| Grile fără variantă clară | 0p, cu motivul („încercuiește litera") — nu se trimit la AI | da | odată cu grila |
| **Scrisul de mână** (Subiectul III; orice item la care nu s-au găsit variantele în text) | imaginea zonei din pagină **cu scrisul pe ea** (enunțul tipărit + rezolvarea; ≤ 6 imagini, ≤ 1568 px) → corectorul (`corector.correctJson`, implicit **Claude Opus 5.5**, rezerva Terra), strict după barem: a) / b) cu punctele lor, problema ≤ 5p | da | `⭐` („se corectează cu Premium") — browserul nici nu trimite imaginile |
| Grile la care baremul nu dă litera | le rezolvă corectorul (din textul testului) | da | ⭐ |

- **Corectările gratuite ale grilei** (`api/rezolva-pdf.js`): numărate în `ai_usage`, la `endpoint =
  'rezolva-pdf:grila'` (un rând pe corectare reușită, cost 0). Câte sunt: variabila **`PDF_GRILA_GRATUITE`**
  (opțională, implicit **2**). **Nu** intră în cele 2 acțiuni AI gratuite și nici în limita orară
  (`api/_lib/ai.js` → `NU_E_CERERE_AI`). Ca toate rândurile din `ai_usage`, se șterg după 90 de zile — aceeași
  regulă ca la încercările gratuite cu AI-ul.
- Mesajele: după prima — „🎁 Corectare gratuită a grilei: 1 din 2 — ți-a mai rămas una"; după a doua — „🎁
  Aceasta a fost ultima corectare gratuită a grilei…"; apoi **402** „Ai folosit cele 2 corectări gratuite ale
  grilei…" — în conversație (`⭐ …`), în banda de sus a profesorului („🔒 Ai folosit corectările gratuite ale
  grilei. · Abonează-te →"), în nota de sub bară și în caseta „Ai terminat?" (`✅ Corectează ⭐`, „⭐ Vezi
  abonamentele"). Elevul fără abonament care a scris doar la Subiectul III primește direct îndemnul spre Premium
  (fără să se consume nimic); cel care n-a încercuit clar nicio grilă — „încercuiește litera…".
- Cota scrisului (Premium): aceeași ca „🎓 Cere corectarea" — **„✍️ Corectări de pe foaia de lucru"** (elev
  20/zi), plus limita orară și creditele (`ai-handwriting:correct`). Grilele nu consumă nimic din ele.
- Oprit în timpul unui **test pe grupă** (423), ca orice ajutor. În testul pe grupă / duel butonul nici nu apare
  (acolo răspunsurile pleacă la profesor cu „📝 Răspunde la test").
- **Salvarea în „Rezultatele mele"** (`progress`, ca la „📝 Răspunde în chat", cu XP / ligă / turnee): doar
  când corectarea e **completă** — câte ceva la fiecare din cele trei subiecte și totul punctat (fără `⭐` /
  pane). Punctajul e din **90** (+10 din oficiu → nota). O corectare parțială doar se arată. La materialele din
  Biblioteca utilizatorilor → `ai_pdf_results` + rezultatele materialului.
- Corectarea intră în conversația Profesorului Virtual (`ai_conversations` / `ai_messages`, cu miniatura).

---

## Fișierele

| Fișier | Ce e |
|---|---|
| `src/lib/pdfRezolvare.js` | harta (`buildExamMap`, `richLines`, `overlappingText`, `visibleIn`), recunoașterea (`recognize`, `recognizeChoice`, `correctionPlan`), imaginile (`cropPlan`, `renderCrop`), ciorna (`encodeInk`/`decodeInk`), „⬇ PDF" (`exportInkPdf`, pdf-lib) |
| `src/components/RezolvarePdf.jsx` | traseele (`createInkStore`), stratul unei pagini (`InkPage`), marcajele (`computeMarks`), controlerul (`useRezolvarePdf`), uneltele și caseta „Ai terminat?" |
| `src/components/PdfCanvasViewer.jsx` | `overlay` (portal în fiecare pagină), `toolbar`, `footer`; la „lățimea paginii" nu mai redesenează paginile când se schimbă doar înălțimea |
| `src/pages/PDFViewer.jsx` | butonul (pulsează; la EN → modul, la BAC / alte PDF-uri → foaia de lucru: `toggleFoaia`), modul (forțează vizualizatorul site-ului), `corecteazaPePdf` (Premium / corectările gratuite), legătura cu chatul (`cmdRef`) |
| `src/components/AITutor.jsx` | `cmdRef.beginExternal` / `conversationId` — corectarea apare în conversația curentă; `fail(text, { premium, banner })` |
| `src/styles/global.css` | `.em-pulse` / `@keyframes emPulse` (fără mișcare la `prefers-reduced-motion`) |
| `src/lib/pdfCombine.js` | `pageLinesFromItems`, `contentBoundsOf`, `examStructureOf`, `loadPdfLib` (exportate, aceeași logică) |
| `api/rezolva-pdf.js`, `api/_lib/pdfRezolvare.js` | endpointul (Premium / `PDF_GRILA_GRATUITE`) și partea pură (curățarea cererii, grilele, promptul + schema corectorului, totalul, mesajul) |
| `api/_lib/ai.js` | `NU_E_CERERE_AI` — „voce" și „rezolva-pdf:grila" nu sunt cereri AI (nici în acțiunile gratuite, nici în limita orară) |
| `api/ai-correct.js` | exportă `saveProgress`, `saveUploadResult` |
| `test/rezolva-pe-pdf.test.js` | 21 de teste (harta, recunoașterea — și tăieturile / revenirea —, ciorna, grilele, corectorul, endpointul cu Premium și cu corectările gratuite, legăturile, butonul pulsant, foaia de lucru la BAC) |

Nimic nou în Supabase (fără SQL: corectările gratuite stau în `ai_usage`, care există). O variabilă
**opțională**: `PDF_GRILA_GRATUITE` (câte corectări gratuite ale grilei; implicit 2).

---

## Probleme și ce se întâmplă

| Situație | Comportament |
|---|---|
| PDF fără text / scanat / combinat / structură necunoscută | „Nu am recunoscut structura…" — se scrie la fel; corectarea: paginile întregi la corector (Premium) |
| Elev neautentificat apasă „Corectează" | „Autentifică-te…" (scrisul rămâne) |
| Fără abonament, după cele 2 corectări gratuite ale grilei | 402 + îndemnul spre Premium (conversație, banda de sus, nota, caseta de la final); scrisul rămâne |
| Fără abonament, scris doar la Subiectul III | îndemnul spre Premium, fără cerere la server |
| Nimic scris | „Încercuiește răspunsurile sau scrie rezolvarea pe PDF…" |
| Scris în antet / pe copertă | ignorat, cu mesaj |
| Corectorul cade | grilele rămân corectate; problemele „necorectate" + „mai apasă o dată" (nu se salvează) |
| pdf.js nu se încarcă (CDN blocat) | vizualizatorul arată varianta de rezervă, fără strat de scris |

**De văzut pe testele reale de pe site:** recunoașterea a fost verificată pe subiecte EN sintetice (aspectul
oficial: variante pe coloană, pe rând, 2×2, Subiectul III cu `(2p) a)` / `(3p) b)`, test combinat), nu pe
PDF-urile de pe site. Dacă la un test literele nu se recunosc (eticheta `?` la un cerc clar), trimite-mi PDF-ul.

---

## La BAC și la celelalte PDF-uri: „✏️ Rezolvă" → foaia de lucru (8 nov. 2026)

La orice PDF care nu e test de Evaluare Națională (BAC, capitole, fișe, manuale, Biblioteca utilizatorilor — nu
baremele), și la testele de EN din testul pe grupă / duel, același buton **„✏️ Rezolvă"** (pulsant) deschide
**foaia de lucru** în panoul Profesorului Virtual (pe calculator panoul se lățește). Apăsat din nou („✏️ Foaia
de lucru · apasă ca să închizi") — închide foaia și revine la conversație. Neautentificat: „Autentifică-te…".
Corectarea de pe foaie e cea de până acum: **„🎓 Cere corectarea"** — testul și baremul citite de pe server,
corectorul (Claude Opus 5.5) strict după barem, **Premium**. În testul pe grupă / duel foaia rămâne doar ciornă.

## Nota cu roșu pe test și nota pentru o parte de test (8 nov. 2026)

Cererea: „după corectare, notează cu roșu nota pe test, scris de mână, de exemplu:
7,30 (șapte ^30)" și „pune o notă chiar dacă se rezolvă doar câteva exerciții doar de
la un subiect. Trece nota și lasă posibilitatea să se revină și să rezolve din nou.
Nota să apară în statistici la «rezultate elevi»".

- **Nota cu roșu**: după „✅ Corectează", pe prima pagină, sus în dreapta, scrisă de mână
  (fontul Caveat, `@fontsource/caveat`): **7,30 (șapte³⁰)**, ușor înclinată și
  subliniată (`NotaRosie` în `RezolvarePdf.jsx`, `notaScrisa` în `src/lib/pdfRezolvare.js`).
  Se așază în primul loc liber de sus în jos, fără să acopere antetul (rândurile de text
  ale paginii 1: `cutiiText` / `pozitieNota`). Scrii din nou după corectare → nota se
  estompează până la corectarea următoare. **⬇ PDF-ul descărcat** o are și el (imagine
  PNG pe pagina 1: `exportInkPdf(…, { notaImg })`).
- **Nota pentru o parte de test**: `api/rezolva-pdf.js` calculează nota la orice corectare
  cu puncte (ce lipsește are 0p): „📝 Nota **2,30** e pe testul așa cum e acum: ce n-ai
  rezolvat încă are 0 puncte. Poți reveni oricând…". Se salvează în `progress` de fiecare
  dată (o corectare identică în 30 de minute nu mai adaugă o încercare) → „Rezultatele
  mele" și „Grupe / Rezultate elevi". XP doar când punctajul crește.
- Lucrul pe PDF bifează și **testul zilei** din „🎯 Pregătește-mă de examen" (de la 3
  exerciții) — `GHID_PREGATESTE_MA.md`.

## Nota pe card și recenzia (8 nov. 2026, seara)

- În listele de teste (EN, BAC, pe clase), cardul PDF arată, ca la cele interactive, rezultatul elevului din `progress`
  („✓ 17% · nota 2,50" + „15/90 pct"), media recenziilor („★ 4,6 (12)") și „💬 Părerile (n)".
- După o corectare salvată apare cardul „Cum ți s-a părut testul?" (stele + comentariu) — `GHID_RECENZII_SI_MODELE_AI.md`.
