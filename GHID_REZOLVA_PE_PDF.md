# ✏️ Rezolvă pe PDF — grila încercuită și Subiectul III scris direct pe testul de EN

Cererea lui Radu (7 nov. 2026): la PDF-urile de **Evaluare Națională**, grila de la Subiectele I și II să
se rezolve **direct pe PDF, prin încercuire**, iar la Subiectul al III-lea elevul să scrie **direct în zona
de rezolvare** — „un spațiu de lucru, dar invizibil", cu **recunoașterea exercițiului rezolvat** și
**corectare**; pornit cu **„Rezolvă pe PDF"**, cu **„Corectează"** la final; **PDF-ul rămâne PDF**.

---

## Ce vede elevul

1. Deschide un test PDF de EN (variantă, model, simulare — nu baremele) și apasă **„✏️ Rezolvă pe PDF"**
   în bara de sus (pe telefon: „✏️ Rezolvă").
2. Peste pagini apare un **strat transparent de scris**. PDF-ul arată la fel; în bara de zoom apar uneltele:
   `✎ Scrie` · `◯ Radieră` · `✋ Derulează` · 3 culori (pix albastru, negru, roșu) · `↩` (și Ctrl+Z) · `🗑` ·
   `⬇ PDF` · **`✅ Corectează`** · `✕`.
3. **Grile (Subiectele I și II):** încercuiește litera (sau varianta). În marginea din stânga a exercițiului
   apare pe loc ce s-a recunoscut: `b)` · `⚠ a b` (două variante încercuite) · `?` (nicio variantă clară).
   Merge și cercul lăsat puțin deschis, cercul în jurul valorii, spirala, o bifă mică pe literă.
   Calculele scrise lângă variante nu contează.
4. **Subiectul al III-lea:** scrie rezolvarea în spațiul de sub fiecare problemă — pe margine apare `✍️`.
5. La final, **„✅ Corectează"** (în bară sau în caseta „Ai terminat?" de după ultima pagină):
   - pe PDF: `✔ 5p` / `✖ 0p` / `? 0p` la grile, `3/5p` la probleme și `2/2p`, `1/3p` lângă a) și b);
   - în **Profesorul Virtual** (se deschide singur): punctajul pe subiecte, ce a citit din scris, pas cu pas,
     sfatul — și se poate întreba mai departe, în aceeași conversație.
   Litera corectă a unei grile greșite **nu se spune** (elevul poate reîncerca; „📋 Barem" rămâne la un clic).
6. Schimbă ceva la un exercițiu (radieră, alt cerc) → marcajul corectării lui dispare până la o nouă corectare.

**PDF-ul rămâne PDF:** zoom (butoane, două degete), „⤢ Pagina întreagă", 📋 Barem, ⬛ Original / ⬜ Fără
suprafață neagră, Profesorul Virtual, spațiul de lucru din chat — toate merg și cât e pornit modul.
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

| Ce | Cum | Abonament |
|---|---|---|
| **Grile recunoscute** | litera elevului ↔ tabelul **baremului** de pe server (`barem.grilaAnswers`): 5p sau 0p; două variante = 0p | **gratuit** (fără AI) |
| Grile fără variantă clară | 0p, cu motivul („încercuiește litera") — nu se trimit la AI | gratuit |
| **Scrisul de mână** (Subiectul III; orice item la care nu s-au găsit variantele în text) | imaginea zonei din pagină **cu scrisul pe ea** (enunțul tipărit + rezolvarea; ≤ 6 imagini, ≤ 1568 px) → corectorul (`corector.correctJson`, implicit **Claude Opus 5.5**, rezerva Terra), strict după barem: a) / b) cu punctele lor, problema ≤ 5p | **Premium** |
| Grile la care baremul nu dă litera | le rezolvă corectorul (din textul testului) | Premium |

- Fără Premium: grilele se corectează, iar problemele scrise rămân `⭐` („se corectează cu Premium") —
  browserul nici nu trimite imaginile.
- Cota: aceeași ca „🎓 Cere corectarea" — **„✍️ Corectări din spațiul de lucru"** (elev 20/zi), plus limita
  orară și creditele (`ai-handwriting:correct`). Grilele singure nu consumă nimic.
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
| `src/pages/PDFViewer.jsx` | butonul, modul (forțează vizualizatorul site-ului), `corecteazaPePdf`, legătura cu chatul (`cmdRef`) |
| `src/components/AITutor.jsx` | `cmdRef.beginExternal` / `conversationId` — corectarea apare în conversația curentă |
| `src/lib/pdfCombine.js` | `pageLinesFromItems`, `contentBoundsOf`, `examStructureOf`, `loadPdfLib` (exportate, aceeași logică) |
| `api/rezolva-pdf.js`, `api/_lib/pdfRezolvare.js` | endpointul și partea pură (curățarea cererii, grilele, promptul + schema corectorului, totalul, mesajul) |
| `api/ai-correct.js` | exportă `saveProgress`, `saveUploadResult` |
| `test/rezolva-pe-pdf.test.js` | 15 teste (harta, recunoașterea, ciorna, grilele, corectorul, endpointul, legăturile) |

Nimic nou în Supabase (fără SQL), nicio variabilă nouă.

---

## Probleme și ce se întâmplă

| Situație | Comportament |
|---|---|
| PDF fără text / scanat / combinat / structură necunoscută | „Nu am recunoscut structura…" — se scrie la fel; corectarea: paginile întregi la corector (Premium) |
| Elev neautentificat apasă „Corectează" | „Autentifică-te…" (scrisul rămâne) |
| Nimic scris | „Încercuiește răspunsurile sau scrie rezolvarea pe PDF…" |
| Scris în antet / pe copertă | ignorat, cu mesaj |
| Corectorul cade | grilele rămân corectate; problemele „necorectate" + „mai apasă o dată" (nu se salvează) |
| pdf.js nu se încarcă (CDN blocat) | vizualizatorul arată varianta de rezervă, fără strat de scris |

**De văzut pe testele reale de pe site:** recunoașterea a fost verificată pe subiecte EN sintetice (aspectul
oficial: variante pe coloană, pe rând, 2×2, Subiectul III cu `(2p) a)` / `(3p) b)`, test combinat), nu pe
PDF-urile de pe site. Dacă la un test literele nu se recunosc (eticheta `?` la un cerc clar), trimite-mi PDF-ul.
