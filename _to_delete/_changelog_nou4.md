## 26 august 2026 — Mesageria: „✕" pe conversație, participanți cu derulare, panou de colegi lățit; tabul „Teme" cu două secțiuni

Cerut de Radu, după prima rundă de folosire pe site.

### 1. Mesagerie
- **Buton „✕" pe conversația deschisă.** Închide fereastra de mesaje; rămâne doar lista de conversații, pe toată lățimea, cu indiciul „alege una ca să o deschizi". Conversația nu se mai redeschide singură după închidere.
- **„Colegii mei" se lățește când conversația e închisă.** Pagina `/mesagerie` comută grila de la `1fr / 280px` la `340px / 1fr`, iar panoul primește `wide`: numele nu se mai taie cu „…", lista urcă de la 178 px la 340 px, rezultatele căutării de la 150 px la 300 px, iar căutarea pornește deschisă. Butonul „➕ Cerere" a devenit compact, ca numele să aibă loc — în captură apăreau „ispas…", „Elena…", „Alexa…".
- **Participanții unei grupe nu mai ocupă jumătate de fereastră.** Antetul arată acum „👥 Elevi 2026 · *12 membri*", iar numele stau într-o fâșie de două rânduri (`maxHeight: 34`) cu derulare — se văd câteva, restul se derulează. Înainte, 12 nume rupeau antetul pe trei rânduri.

### 2. Contul elevului: „Teme nefăcute" → „Teme"
Tabul se numește acum **„📌 Teme"** (cu bulina „N de făcut" doar când există restanțe) și are **două secțiuni vizibile**, nu o listă plus un rolldown ascuns:

- **📌 Teme nefăcute** — cu numărul lor pe bulină roșie; când e gol: „🎉 Nu ai nicio temă nefăcută. Bravo!";
- **✅ Teme rezolvate** — bulină verde, rânduri pe fundal verde deschis, bifă în loc de iconița tipului și „Reia →" în loc de „Rezolvă →"; lista se derulează după 340 px. Când e goală: „Încă nicio temă rezolvată."

Eticheta „termen depășit" apare doar la cele nefăcute. Fișierul a rămas `src/components/TemeNefacute.jsx` (redenumirea ar fi lăsat o copie în repo prin `_to_delete`); comentariul din capul lui explică asta.

### Verificare
Cele patru componente trec prin esbuild și prin ESLint — zero erori și zero avertismente noi. Fără modificări de API sau SQL: **doar deploy**.

---
