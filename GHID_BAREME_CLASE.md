# 📋 Bareme la fiecare clasă (a V-a … a XII-a) — 15 nov. 2026

> Adaugă, la fiecare clasă (a V-a…a XII-a), o secțiune nouă „📋 Bareme" (în navigarea clasei,
> lângă capitole): arată toate baremele existente pentru exercițiile/fișele clasei (…)
> adminul poate lega manual un barem de un exercițiu de clasă (…) o dată legat, baremul
> trebuie folosit automat de corectarea existentă (…) nu rescrie o legătură pusă deja
> manual de admin.

## Pe scurt

- Pe pagina fiecărei clase (`/clase/6` …) apare fila **„📋 Bareme"**, lângă *Exerciții
  interactive* și *Exerciții PDF*. Baremele nu mai stau printre exercițiile PDF.
- **Elevul / vizitatorul**: baremele clasei, pe capitole (pictograma capitolului), fiecare cu
  fișa căreia îi aparține („pentru fișa «ALGEBRĂ - Fișă 4: Proporții»"); fișa care își are
  baremul la sfârșit apare cu „📎 Baremul e chiar în fișă". Fișele fără barem nu apar.
- **Adminul** (aceeași filă, „⚙ Administrare" / „👁 Cum o văd elevii"): toate fișele PDF ale
  clasei, cu baremul lor și cine l-a legat — 🔒 *legat de admin*, 🤖 *legat de botul de
  examene*, ✅ *găsit automat după titlu*, 📎 *baremul e în aceeași fișă*, sau *de verificat*
  (orice alt marcaj, de ex. un task care generează bareme). Pe fiecare fișă:
  - **💡 propunere după titlu** → „✓ Leagă propunerea" (sau, sus, „✓ Leagă toate
    propunerile" — doar la fișele fără nicio legătură);
  - **⚙ alege baremul…** (baremele clasei) → „Leagă";
  - **📤 Încarcă baremul (PDF)** — PDF cu text, nu scanat: devine material al clasei (rubrica
    „bareme", gratuit/Premium ca fișa) și se leagă de fișă;
  - **↺ Automat** — scoate legătura manuală (corectarea caută din nou după titlu).
  Baremele fără fișă stau la capitolul din titlul lor, cu „leagă de fișa…".
- **Decizia lui Radu (15 nov. 2026, seara): fila rămâne vizibilă elevilor.**
- **Bifa „Vizibilă elevilor (toate clasele)"** — implicit bifată (secțiunea e o referință,
  ca rubrica „Bareme" de la EN și BAC). Debifată: elevii nu mai văd fila și nici baremele
  în lista PDF; baremele se folosesc doar la corectare. Setarea: `app_settings` →
  `bareme_clase` = `{ "vizibil": false }`.

## Cum folosește corectarea baremul

Nu e un motor nou: legătura stă în `ai_pdf_text.barem_override_id` /
`barem_override_by = 'admin'` — exact ca la examene (`api/ai-pdf-context.js` → `setOverride`).
Toate corectările citesc baremul de pe server, din `getPdfContext`: Profesorul Virtual,
„✏️ Pe PDF" (`api/rezolva-pdf.js`), „🎓 Cere corectarea" / foaia de lucru
(`api/ai-correct.js`). Fișa cu barem legat intră și în **harta 2 a clasei** din „🎯
Pregătește-mă de examen" (inclusiv un PDF nou numit după capitol — pas în plus în capitolul
lui).

Fără legătură manuală, o fișă își găsește baremul **după titlu și numele fișierului**
(`api/_lib/barem.js` → `matchBaremByTitle`): „Barem — ALGEBRĂ - Fișă 4: Proporții" ↔
„ALGEBRĂ - Fișă 4: Proporții"; „Barem fișa 19" cu fișierul
„Barem_GEOMETRIE_Fisa_19_triunghi_isoscel.pdf" ↔ „GEOMETRIE - Fișă 19: triunghi isoscel".
Numerele baremului (fișa 4, setul 2) trebuie să fie și în titlul fișei; un barem care s-ar
potrivi cu două fișe nu e al niciuneia (`propuneriPeTitlu`, și la corectare). La deschidere,
antetul baremului poate doar să refuze potrivirea. Regula de aur rămâne: mai bine niciun
barem decât baremul greșit.

**Legăturile existente nu se rescriu**: „Leagă toate propunerile" sare peste orice fișă care
are deja o legătură (admin, bot sau alt marcaj) sau un barem găsit automat, și verifică
starea live din `ai_pdf_text` chiar înainte de a scrie.

## Cum verifici după deploy

1. Admin, la `/clase/6` → „📋 Bareme": încarcă un barem pentru o fișă (sau leagă unul).
2. Deschide fișa: în panoul Profesorului Virtual apare „📋 Barem asociat: … · asociat manual
   de administrator".
3. „✏️ Pe PDF" / „🎓 Cere corectarea" pe fișă → corectorul primește baremul acesta.

## Fișiere

- `api/bareme.js` — secțiunea (`clasa`), legăturile (`leaga`, `dezleaga`,
  `leaga_propuneri`, `incarca`), setarea (`vizibil`)
- `src/components/BaremeClasa.jsx` — fila (elev + admin); `src/lib/bareme.js` — „e barem?"
  în browser
- `src/components/ContentPage.jsx`, `src/pages/ClassPage.jsx` — fila, baremele scoase din
  lista PDF
- `api/_lib/barem.js` — `matchBaremByTitle` (titlu + numele fișierului),
  `propuneriPeTitlu`, `baremCacheValid`; `api/ai-pdf-context.js` — pasul 0 (fișele), unic în
  ambele sensuri
- Teste: `test/bareme-clase.test.js` (PDF-uri reale în Storage-ul fals: legătura → corectarea
  folosește baremul; harta clasei)
- SQL: nimic nou (`ai_pdf_text`, `app_settings` există deja).
