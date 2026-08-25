## 25 august 2026 (2) — Mesagerie pe grupă, TEME cu exerciții bifate, „Teme nefăcute" la elev și separarea „temă" / „test pe grupă"

Cerut de Radu, în patru puncte. Toate patru sunt în cod; **necesită două scripturi SQL** rulate în Supabase → SQL Editor: `supabase/mesagerie.sql` și `supabase/teme_elevi.sql` (ambele idempotente).

### 1. Mesagerie („messenger") în toate tipurile de cont
Rolldown nou **„💬 Mesagerie"** în „Contul meu", așezat **imediat sub „Abonament"** — pentru elev, profesor și părinte deopotrivă.

- În ea intră **doar oamenii unei grupe**: profesorul care a făcut grupa, elevii ei și **părinții acelor elevi**. Lângă fiecare nume, rolul în paranteză: **(profesor)** / **(elev)** / **(părinte)**.
- Două feluri de conversații: **canalul grupei** și **1-la-1**. Regula de 1-la-1 e aplicată pe server, nu doar în interfață: profesorul poate scrie oricui din grupele lui, elevii între ei, părinții între ei, dar **un părinte poate scrie în privat doar propriilor copii** (copiii altora se văd doar în canalul comun).
- Apartenența **nu se dublează** într-un tabel de membri: se calculează la fiecare cerere din `mentor_groups` + `mentor_students`, deci mutarea unui elev în altă grupă se vede imediat.
- **Linkurile de temă/test se trimit pe mesagerie**: butonul 🔗 din bara de scriere atașează un card apăsabil care duce la `/tema-elev?id=…` sau `/tema-grupa?id=…`. Serverul acceptă **doar rute interne** ca atașament.
- Notificare în clopoțel (`✉️`) la primul mesaj dintr-o conversație, **maximum una pe zi per conversație**, cu link către `/profil?mesagerie=1`.
- Reîmprospătare doar cu tabul vizibil: mesajele la 20 s, lista la 60 s.

Fișiere: `supabase/mesagerie.sql`, `api/messages.js`, `src/components/Mesagerie.jsx`, plus metodele `chat*` din `src/lib/aiClient.js`. Ghid: **`GHID_MESAGERIE.md`**.

### 2. Linkuri cu denumire + TEME date pe grupă sau pe fiecare elev

**a) Denumire și trimitere pe mesagerie la linkurile create de profesor** — atât la testul pe grupă, cât și la temă: câmp de **denumire** (se poate schimba oricând, linkul rămâne valabil — acțiunea `rename`) și buton **„💬 Trimite pe mesageria grupei"**. Aceleași butoane apar și în listele de teme/teste trimise (✎ și 💬).

**b) Butonul „📝 Dă temă"**, în „Grupe / Rezultate elevi": **lângă grupă** (tema merge la toți elevii ei) și **lângă fiecare elev** (merge doar lui). Deschide o fereastră cu **lista de exerciții bifabile** și buton **„🔍 Caută"**, plus filtre pe categorie, format (interactiv / PDF / toate) și sursă (site, testele mele, biblioteca). Toți elevii vizați primesc **același set** — spre deosebire de testul pe grupă, unde fiecare primește altul.

Profesorul are apoi rolldown-ul **„📝 Temele date"**: progresul (rezolvate/total), **raport elev × exercițiu** (✓ rezolvat · 👀 deschis · —), redenumire, copiere link, trimitere pe mesagerie, ștergere. Când un elev termină toate exercițiile, profesorul primește notificare.

Fișiere: `supabase/teme_elevi.sql`, `api/homework.js`, `api/_lib/catalog.js` (catalogul de teste, **extras** din `api/group-assignment.js` și partajat acum de amândouă), `src/components/TemaPicker.jsx`, `src/components/TemeDate.jsx`, `src/pages/TemaElev.jsx`. Ghid: **`GHID_TEME_ELEVI.md`**.

### 3. „📌 Teme nefăcute" în contul elevului
Rolldown nou, **deasupra lui „📊 Rezultatele mele"**, afișat **doar dacă elevul e asociat cu un profesor** (componenta se ascunde singură altfel). Adună tot ce are de rezolvat, cu etichetă pe fiecare: 📝 **temă**, 🧩 **test pe grupă**, 📄 **temă primită pe link** (`/tema?id=…`). Are și o listă pliată cu temele deja rezolvate, plus semnalarea termenelor depășite.

**De unde vin scorurile, ca să nu se dubleze nimic**: testele *din site* își scriu scorul ca până acum în `progress` — tema le citește de acolo (inclusiv corectările PDF cu Prof. Virtual); testele *generate / din bibliotecă* scriu în `homework_progress` (`ExercitiuAIViewer` primește `hwId`). Exercițiile fără punctaj automat (PDF, subiect tipăribil) au butonul „✓ Am rezolvat".

### 4. „Temă pe grupă" → „TEST pe grupă"
Redenumit peste tot în interfață (Contul meu, tabul din Asistent AI, textele componentei și mesajele de eroare din API). „Temele pe grupă trimise" → **„📨 Testele pe grupă trimise"**, transformat în **buton cu rolldown**.

Lângă el, un **clasament nou: „🏆 Clasament — doar testele primite"** (acțiunea `leaderboard`), calculat **exclusiv** din testele repartizate prin linkurile de test pe grupă: câte a primit fiecare elev, câte a rezolvat, ce medie are. **Clasamentul general din grupe rămâne neatins** — acolo se numără în continuare tot ce a rezolvat elevul pe platformă.

### Verificare
`node --check` pe toate rutele API noi și modificate; toate componentele noi și modificate trec prin esbuild (parsare JSX) și prin ESLint cu `no-undef` — zero identificatori nedefiniți; toate importurile relative rezolvă la fișiere existente; paritate client↔server verificată automat pe cele trei rute (`/api/homework`, `/api/messages`, `/api/group-assignment`) — nicio acțiune cerută din `aiClient` fără tratare pe server.

> Notă de mediu: build-ul complet `vite build` **nu** s-a putut rula pe folderul de pe desktop — `node_modules` din Windows nu se rezolvă din VM-ul Linux (aceeași limitare notată la intrarea precedentă). Rulează local `npm run build` înainte de deploy.

---
