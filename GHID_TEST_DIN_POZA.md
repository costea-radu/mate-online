# Test din poză / fișă + timp și puncte din oficiu

Cont de **profesor** → „Asistent AI" → tabul **🧩 Generează exerciții/teste interactive/PDF**.

## 1. Timp de lucru și puncte din oficiu

În blocul „Ce generez" sunt două selectoare noi:

- **⏱ Timp** (5–180 min) — calibrează AI-ul (la 10 minute cere itemi cu 1–2 pași,
  enunțuri scurte, fără probleme lungi cu text), pornește **cronometrul** pe testul
  interactiv și apare în antetul PDF-ului.
- **🎁 Puncte din oficiu** (fără / 5 / 10 / 15 / 20) — intră în scorul final, ca la
  lucrările din clasă: itemii împart restul până la 100 de puncte.

Cronometrul pornește la primul răspuns sau de la butonul „▶ Pornește timpul"; la
expirare testul se verifică singur. Scorul afișat include oficiul și nota
(ex. `Scor: 7/10 — 73 puncte (din care 10 din oficiu) · nota 7,30`). La PDF,
punctajul se împarte egal pe itemi, iar antetul arată timpul și oficiul.

Timpul și oficiul însoțesc testul peste tot: la salvarea în „Testele și exercițiile
mele", la trimiterea ca temă elevilor și la publicare.

## 2. Conținutul testului dintr-o poză, PDF sau Word

Deasupra selectorului de capitole există blocul **📷 Conținutul testului dintr-o poză
sau dintr-un fișier**, cu trei butoane:

| Buton | Ce face | Endpoint |
|---|---|---|
| 📷 Fă poză | deschide camera (telefon/tabletă) | `api/ai-vision` |
| 🖼 Încarcă poză | una sau mai multe imagini | `api/ai-vision` |
| 📄 Încarcă PDF / Word | fișa de lucru (`.pdf`, `.docx`) | `api/ai-correct` (`pdf_text` / `docx_text`) |

Textul citit din fiecare material apare în listă și **se poate corecta** înainte de
generare (butonul „👁 Vezi / corectează") — util când poza a citit greșit o formulă.

Când există materiale încărcate, testul se compune **exclusiv din ele**:

- material cu **exerciții** → itemi de același tip, structură și dificultate;
- material cu **teorie** (lecția predată azi) → exerciții de aplicare directă a
  noțiunilor și formulelor din el, fără noțiuni nepredate.

Sursele din baza de date nu se mai citesc în acest caz. Capitolele rămân opționale și
doar restrâng ce se ia din material.

### Cazul de folosire: testul de 10 minute făcut în clasă

La finalul orei: **📷 Fă poză** la tablă (sau la fișa de lucru / pagina din manual)
→ Test, ~5 itemi → ⏱ 10 min → 🎁 10 p din oficiu → **Generează**. Testul iese pe lecția
de azi și poate fi trimis pe loc elevilor (interactiv, cu cronometru) sau tipărit (PDF).

## Fișiere

- nou: `api/_lib/docxtext.js` (text din `.docx`, fără dependențe — ZIP + `word/document.xml`),
  `test/docxtext.test.js`
- modificate: `src/pages/ProfesorVirtual.jsx`, `src/lib/quizRender.js` (bară + cronometru
  + scor cu oficiu), `src/lib/examPrint.js`, `src/lib/aiClient.js`,
  `api/ai-generate-interactive.js` (`sourceText`, `durationMin`, `oficiu`),
  `api/ai-correct.js` (`docx_text`), `api/ai-assignment.js` (meta la teme),
  `src/pages/TemaElev.jsx`, `src/pages/AssignmentSolver.jsx`, `src/pages/BibliotecaUtilizatorilor.jsx`

## Limite

- Poză/PDF/Word: max ~3,5 MB per fișier; textul tuturor materialelor e tăiat la 14.000 de caractere.
- `.doc` (Word 97-2003) nu se poate citi — mesajul cere salvarea ca `.docx` sau PDF.
- PDF scanat (fără text) → mesajul cere fotografierea; poza merge prin recunoaștere vizuală.
- Poza consumă cota de foto-recunoaștere (ca foto-rezolvarea din chat); PDF/Word nu consumă tokeni de model.
