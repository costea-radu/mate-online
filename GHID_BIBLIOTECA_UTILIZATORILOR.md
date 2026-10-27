# Ghid: Biblioteca utilizatorilor — materialele profesorilor, cu Profesorul Virtual alături

Ruta `/biblioteca-utilizatorilor` (în meniul burger, pe Home și în Căutare) adună ce
au publicat profesorii: teste generate (`exam`), exerciții de antrenament
(`practice`), exerciții interactive (`interactive`) și **PDF-uri** (`pdf`) — din
27 octombrie 2026 și **materialele încărcate** de ei: PDF, Word sau poze.

Tabelul e `ai_public_library` (fișierele PDF stau în bucketul privat
`personal-pdfs`, în `public-library/…`); rezultatele elevilor în
`ai_public_results`. **Nu s-a creat nicio tabelă nouă și nu e nimic de rulat în
Supabase.**

---

## 1. PDF-urile se deschid cu Profesorul Virtual alături

Până acum, „📄 Deschide PDF" deschidea fișierul gol, într-o filă nouă (pe telefon
de obicei se descărca), fără niciun ajutor. Acum:

| Ce | Unde se deschide |
|---|---|
| PDF publicat sau încărcat (`pdf`) | `/pdf-viewer?lib=<id>` — vizualizatorul PDF al platformei: pe calculator vizualizatorul browserului, pe telefon cel intern (pdf.js) |
| Test generat (`exam`) | același vizualizator, cu testul ca document (aceeași pagină ca la tipărire, fără bara „Printează") într-un iframe izolat (`sandbox="allow-scripts allow-modals"`); `🖨️ Printează` din bara de sus deschide fereastra de tipărire de până acum |
| Interactive / antrenament | ca înainte (pagina exercițiului / desfăcut sub card) |

**Accesul** îl verifică serverul, ca până acum (`api/ai-public.js → get`):
materialele marcate „Gratuit" — oricine e autentificat; restul — abonații, autorul
și adminul. Fără abonament: pagina spune de ce și dă „Vezi abonamentele";
neautentificat: „Autentificare".

**Profesorul Virtual** primește textul materialului de pe server
(`api/ai-pdf-context.js` cu `{ libraryId }`):

| Material | Textul | „Baremul" |
|---|---|---|
| PDF încărcat din Word / poze | adus la încărcare (`payload.text`, `payload.pageTexts`) | — |
| PDF cu text (publicat / încărcat ca PDF) | extras o dată din fișier (pdf-parse, ca la materialele platformei) și păstrat în `payload` | dacă fișierul e „subiecte + barem", baremul inclus (aceeași detecție ca în platformă) |
| Test generat | enunțurile, variantele, cerințele | răspunsurile + rezolvările testului (`baremStatus: 'biblioteca'`) |

Totul merge ca la un test din platformă: întrebările din chat (cu pagina
exercițiului atașată modelului — la PDF-urile din poze fără text, primele două
pagini, ca imagini), **„📝 Răspunde în chat"** (formularul se construiește și se
punctează din textul de pe server; la testele generate strict după rezolvări),
**„✍️ Spațiu de lucru" → „🎓 Cere corectarea"** (corectorul primește textul și
baremul de pe server). Rezultatul unei corectări cu „Răspunde în chat" ajunge și
în `ai_public_results` — autorul îl vede ca la interactive.

Ciorna spațiului de lucru are cheia `pdf:lib:<id>`.

---

## 2. Profesorii încarcă materiale — PDF, Word sau poze

Butoane: **„📤 Încarcă material (PDF, Word, poze)"** în `/biblioteca-utilizatorilor`
și fila **„📤 Încarcă material"** în „Asistent AI pentru profesori"
(`/profesor-virtual`). Doar conturile de profesor și adminul
(`src/components/IncarcaMaterial.jsx`).

```
alege fișierul (clic sau tras peste)
   · un PDF   → verificat (%PDF-), numărate paginile
   · un Word  → docx-preview îl desenează (formulele Word, tabelele, imaginile),
                html-to-image face din fiecare pagină o imagine, pdf-lib → PDF;
                textul paginilor (formulele ca LaTeX — src/lib/mathmlTex.js) rămâne
                pentru Profesorul Virtual
   · 1–20 poze → câte o pagină A4 pe poză (orientarea după poză, EXIF respectat)
   ↓  (totul în browser — nimic nu pleacă de pe calculator la conversie)
„✓ PDF pregătit: 3 pagini · 1,2 MB · 👁 Vezi PDF-ul"
   ↓  titlu, clasa / examenul, tema (opțional), ☑ „am dreptul să public"
„📤 Publică în Biblioteca utilizatorilor"
   · pozele: textul lor îl transcrie O DATĂ modelul de vedere (api/ai-public.js →
     transcribe, din creditele profesorului) — în loturi de cel mult 6 poze și
     ~3,8 MB (fiecare poză recomprimată sub 1,3 MB), fiecare text la pagina lui;
     dacă nu merge, se publică oricum (profesorul virtual citește atunci paginile
     din imagini)
   · PDF-ul → personal-pdfs/<uid>/… (rămâne în „Testele și exercițiile mele")
   · publish → copia publică în public-library/… + rândul din ai_public_library
     (payload: { origin:'upload', source:'pdf'|'docx'|'foto', fileName, pages, text?, pageTexts? })
   ↓
„✅ … e în Biblioteca utilizatorilor" → „📄 Deschide cu Profesorul Virtual"
```

Ca orice material publicat: **premium implicit** (adminul îl poate face gratuit;
sistemul ține minim 3 gratuite), autorul și adminul îl pot șterge (`🗑 Șterge` —
se șterge copia publică; cea privată rămâne). Căutarea din bibliotecă găsește
materialele încărcate și după textul lor (`search_text`).

| Situație | Ce se întâmplă |
|---|---|
| `.doc` (Word 97–2003) | „salvează-l ca .docx sau ca PDF" |
| PDF + poze amestecate / două PDF-uri | „UN PDF sau UN Word — ori poze" |
| peste 20 de poze / fișier peste 24 MB | mesaj, nu se încarcă |
| poză HEIC pe calculator | „trimite-o ca JPG" (browserul n-o poate citi) |
| formule MathType în Word | pot lipsi din PDF (imagini WMF/EMF) — mesajul îi spune profesorului să salveze din Word ca PDF |
| transcrierea pozelor eșuează (fără credite, pană) | publicat oricum, cu avertisment |

Bibliotecile mari (`pdf-lib`, `docx-preview` + `jszip`, `html-to-image`) se încarcă
doar la încărcare și nu intră în precache-ul aplicației (`vite.config.js` →
bucățile `material-*`).

---

## 3. „📑 Ascunde paginile" (vizualizatorul PDF, pe calculator)

Coloana cu miniaturile paginilor e a vizualizatorului din Chrome / Edge. Butonul
din bara de sus o ascunde prin parametrul `#navpanes=0` (Firefox: `#pagemode=none`)
— iar cu Profesorul Virtual deschis, **panoul lui ia locul eliberat**: cel puțin
lățimea coloanei de miniaturi (~300 px, `THUMBS_W`), iar pe ecranele late și mai
mult — PDF-ului îi rămâne doar cât îi trebuie paginii la 100% (lățimea paginii din
`/MediaBox` + marginile; `paginiPanelWidth` în `src/lib/pdfFrame.js`). Cu o pagină
A4: ecran 1280 px → panoul 400 → 700 px; ecran 1600 px → ~740 px; ecran 1920 px →
~1060 px. „📑 Arată paginile" readuce coloana și lățimea de
dinainte (dacă între timp n-ai tras tu de margine). Alegerea se ține minte
(`localStorage` → `pdf:pagini`). PDF-ul se reîncarcă de la prima pagină la
comutare (vizualizatorul browserului nu-și spune pagina). Pe telefon nu există
coloana (vizualizatorul intern), deci nici butonul.

---

## Fișierele

| Fișier | Ce e |
|---|---|
| `src/pages/BibliotecaUtilizatorilor.jsx` | lista; „📄 Deschide PDF" → vizualizatorul; „📤 Încarcă material" |
| `src/pages/PDFViewer.jsx` | `?lib=<id>`, testul generat ca document, „📑 Ascunde paginile", lățirile automate ale panoului |
| `src/lib/pdfFrame.js` | adresa iframe-ului (`#page`, `#navpanes`), lățimea paginii, coloana PDF-ului |
| `src/components/IncarcaMaterial.jsx` | încărcarea (alegere, conversie, previzualizare, publicare) |
| `src/lib/materialPdf.js` | PDF / Word / poze → PDF, în browser |
| `src/lib/mathmlTex.js` | formulele Word (MathML) → LaTeX; textul unei pagini |
| `src/lib/examPrint.js` | `examDocumentHtml` — testul generat ca document (și tipărirea) |
| `src/lib/aiClient.js` | `uploadMaterial`, `publicTranscribe`, `pdfContext({ libraryId })`, `correctForm({ libraryId })` |
| `api/ai-pdf-context.js` | `loadLibraryForUser`, `libraryContext`, `examTexts` — textul și baremul materialelor din bibliotecă |
| `api/ai-public.js` | `transcribe`, payload-ul PDF curățat, `recordPublicResult` |
| `api/ai-correct.js` | „Răspunde în chat" cu `libraryId` (sursa `lib:<id>` în formularul semnat) |
| `api/ai-handwriting.js` | corectarea scrisului cu `libraryId` |
| `api/_lib/ai.js` | pagina exercițiului din PDF-ul din bibliotecă, atașată modelului |
| `test/biblioteca-incarcare.test.js` | regresiile |
