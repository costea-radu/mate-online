## 25 august 2026 (4) — În timpul testelor pe grupă se oprește și Profesorul Virtual (widget + caseta „Întreabă profesorul")

Cerut de Radu, ca urmare a punctului 3 din runda precedentă: dacă mesageria se oprește în timpul testului, trebuie oprit și AI-ul — altfel blocarea nu are sens (elevul îi cere profesorului virtual rezolvarea).

### Ce se oprește
| Ce | Cum arată pentru elev |
|---|---|
| Widgetul plutitor (`FloatingTutor`) | dispare de pe toate paginile |
| Butonul „Profesorul virtual" din `InteractiveViewer` | nu mai apare (nici butonul, nici panoul, nici FAB-ul mutabil) |
| „Întreabă profesorul" din `ExercitiuAIViewer` | la fel |
| Caseta de întrebări din `ChatPanel` | înlocuită de „🔒 Profesorul Virtual e oprit în timpul testului" |
| Butoanele de sugestii / vocea / „Reîncearcă" | `send()` iese devreme cu mesajul de mai sus, fără să lovească serverul |
| Foto-rezolvarea (📷) | refuzată, cu același mesaj |

### Ce NU se oprește — și de ce
**Corectarea („📝 Răspunde în chat", `api/ai-correct.js`).** La testele pe grupă în format **PDF**, formularul de răspuns e SINGURUL drum prin care punctajul ajunge la profesor (scorul se scrie în `progress`, de unde îl citește raportul temei). Dacă blocam tot panoul, testele PDF pe grupă deveneau nepunctabile.

Așa că, în `PDFViewer`, pe durata testului panoul rămâne de deschis, dar: butonul din bară se numește **„📝 Răspunde la test"** (cu „trimiți răspunsurile spre corectare" dedesubt), antetul panoului devine „📝 Răspunsurile tale", widgetul plutitor dispare, iar `ChatPanel` primește `testMode` → fără casetă de întrebări, doar formularul. Pe scurt: **elevul nu poate cere ajutor, dar își poate trimite răspunsurile.**

### Cum e implementat
**Server (adevărul):** `api/_lib/testlock.js` — helper comun care citește `group_assignment_picks.active_until`. Refuză cu **HTTP 423** (`code: 'TEST_MODE'`) în `api/ai-chat.js`, `api/ai-chat-stream.js` (cadru `error` pe stream) și `api/ai-vision.js`; `api/messages.js` îl folosește acum în locul verificării lui locale. Deschiderea altui tab nu ajută — blocarea nu e în interfață.

**Interfață (reacția instantă):** `src/lib/testMode.js` — semnal în `sessionStorage` cu expirare la 3 ore (aceeași fereastră ca pe server), pus de `GrupaTema` la „▶ Începe testul" și șters la trimiterea rezultatului sau la „✓ Am terminat testul". Hook-ul `useTestMode()` ascultă evenimentul, revenirea în tab și expirarea.

Textele de pe pagina testului și eticheta din bara vizualizatoarelor spun acum „mesageria **și Profesorul Virtual** sunt oprite".

### Verificare
`node --check` pe toate rutele atinse; `AITutor.jsx` și cele patru vizualizatoare trec prin esbuild; ESLint cu `no-undef` (după completarea globalelor de browser în configul ad-hoc) nu semnalează nimic nou — singurele rămase sunt preexistente. Verificat manual pe cod că fluxul de corectare (`correctForm` / `correctGrade` → `/api/ai-correct`) nu trece prin niciun endpoint blocat, deci testele PDF rămân punctabile.

---
