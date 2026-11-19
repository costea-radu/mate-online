# Ghid: „🤖 Variante generate cu AI" (EN) și baremele oricărei categorii (19 nov. 2026)

Cererile:
1. „La categoria Evaluare Națională, la teste de antrenament, adaugă sub simulări o secțiune
   «variante generate cu AI». În admin adaugă secțiunea de încărcare."
2. „În admin pune o secțiune de încărcare bareme la orice categorie. Baremele să se poată și
   șterge sau face modificări din secțiunea «tot conținutul»."

**SQL de rulat: nimic** (rubrica nouă e doar o valoare în `content.subcategory`; baremele sunt
materiale ca până acum, legăturile stau tot în `ai_pdf_text`).

---

## 1. „🤖 Variante generate cu AI" — Evaluarea Națională

- **Pe site**: Evaluare Națională → 📄 PDF+Interactive → 🏋 Teste de Antrenament →
  **🤖 Variante generate cu AI**, între „🎯 Simulări" și „✅ Bareme". Arată PDF-urile din rubrica
  `variante-ai` (ca la Variante / Simulări: rezolvare pe PDF, „📋 Barem", profesorul virtual).
- **În Admin → ✨ Variante AI (EN)**: titlul, accesul, descrierea, **PDF-ul variantei** și —
  opțional — **PDF-ul baremului**: baremul se salvează în rubrica „Bareme" și se leagă singur de
  variantă (corectarea și „📋 Barem" îl folosesc). Dedesubt: variantele de pe site, fiecare cu
  baremul ei; la cele fără barem — „⬆ Baremul".
- Rubrica apare și în **📄 Adaugă PDF** („Variante generate cu AI (Teste antrenament)"), iar
  rubrica automată o recunoaște din titlu („Varianta generată cu AI 3", „variantă AI 2",
  „generat de inteligența artificială", „AI-generat" în numele fișierului). Agentul AI din
  Unelte AI poate trimite direct acolo.
- Fișierele: `src/pages/EvaluareNationala.jsx`, `src/lib/contentMeta.js`,
  `api/_lib/contentAdmin.js` (validarea), `src/lib/rubricaMaterial.js`,
  `src/components/AdminVarianteAI.jsx`.

## 2. Baremele oricărei categorii

### ✅ Încarcă bareme (Admin)

Clasa a V-a … a XII-a, Evaluarea Națională, Bacalaureatul (cu profilul):
1. alege clasa / examenul (la BAC și profilul);
2. alege **materialul** al cărui barem e (recomandat; lista are doar materialele PDF ale
   categoriei, fără bareme, cu căutare) — titlul se propune singur („Barem — …"), accesul la fel;
3. trage PDF-ul baremului (cu text, nu scanat: profesorul virtual îi citește textul) → „⬆ Încarcă".

Baremul devine material al categoriei, în rubrica „bareme" (la clase — fila „📋 Bareme"; la
EN / BAC — rubrica „Bareme"), iar cu materialul ales se leagă de el ca legătură de admin: îl
folosesc „📋 Barem" din vizualizator, Profesorul Virtual, „✏️ Rezolvă pe PDF" (`api/bareme.js →
incarca_barem`).

### 📋 Tot Conținutul — baremele

- filtrul **„📋 Doar bareme"** (și „Fără bareme"); fiecare barem are eticheta **„📋 Barem"**, iar în
  „Doar bareme" și **„🔗 Folosit de: …"** — materialele care îl folosesc, legate de admin sau după
  titlu (`api/bareme.js → legaturi`);
- **✏️ Editează** (titlu, categorie, rubrică, acces, ordine) și **🔁 Înlocuiește** (alt PDF, aceeași
  poziție) — ca la orice material;
- **🗑 Șterge** un barem: confirmarea spune cine îl folosește; ștergerea merge pe server
  (`sterge_barem`): rândul, legăturile spre el (se golesc singure), potrivirile automate rămase în
  cache (fișa își caută alt barem la prima deschidere) și fișierul.
- La celelalte materiale, ștergerea scoate acum întâi rândul și abia apoi fișierul: dacă baza de
  date o refuză, materialul rămâne și apare mesajul de eroare (înainte dispărea din listă oricum).

Fișierele: `src/components/AdminBareme.jsx`, `src/pages/Admin.jsx` (ContentList),
`api/bareme.js` (`incarca_barem`, `sterge_barem`, `legaturi`), `src/components/FileUploadZone.jsx`.
Teste: `test/variante-ai-bareme.test.js`.
