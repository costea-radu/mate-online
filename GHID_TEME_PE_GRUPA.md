# Test pe grupă — un singur link, teste diferite pentru fiecare elev

Profesorul trimite unei grupe **un singur link**. Fiecare elev care îl deschide
primește **alt test** decât colegii lui. La testele următoare din aceeași grupă,
fiecare elev primește (pe cât posibil) un test pe care nu l-a mai primit — până
la epuizarea testelor din bazin, apoi se reia.

> Nu confunda cu **TEMELE** (`GHID_TEME_ELEVI.md`): acolo profesorul bifează
> exercițiile cu butonul „📝 Dă temă", iar toți elevii vizați primesc **același**
> set. Aici fiecare primește **altul**.

## 1. Instalare (o singură dată)

Rulează în **Supabase → SQL Editor → New Query**:

```
supabase/teme_grupa.sql
```

Scriptul e idempotent (se poate rula de mai multe ori) și creează:

| Tabel | Rol |
|---|---|
| `group_assignments` | testul pe grupă (linkul), grupa, categoria, formatul, opțiunile |
| `group_assignment_items` | „bazinul" de teste |
| `group_assignment_picks` | ce test a primit fiecare elev + rezultatul lui |
| `group_test_history` | ce teste a primit deja elevul (rotația de la un test la altul) |

RLS e pornit pe toate patru: scrierea trece exclusiv prin
`api/group-assignment.js` (service role), citirea e limitată la profesorul-creator
și la elevul respectiv.

Denumirea editabilă a linkului folosește coloana `group_assignments.renamed_at`,
adăugată de `supabase/teme_elevi.sql`.

## 2. Unde se găsește funcția

În **două locuri**, aceeași componentă (`src/components/GroupAssignment.jsx`):

- **Contul meu** (`/profil`) → rolldown *„👥 Test pe grupă — fiecare elev primește alt test"*,
  imediat sub „Rezultate elevi";
- **Asistent AI** (`/profesor-virtual`) → tabul *„👥 Test pe grupă (teste diferite)"*,
  imediat după „📚 Testele și exercițiile mele".

Ambele apar doar pentru conturile de **profesor** (și pentru admin).

## 3. Cum se construiește testul pe grupă (pași pliabili)

| Pas | Ce alege profesorul |
|---|---|
| **0** | **Grupa** de elevi (sau „toți elevii mei"). Grupele se fac în „Contul meu" → Rezultate elevi. |
| **1** | **Categoria**: examen (Evaluare Națională / Bacalaureat) sau clasă (V–XII), ori „Toate". |
| **2** | **Formatul**: 🧩 interactiv sau 📄 PDF. |
| **3** | **Numărul de teste din bazin** (1–60) și **de unde vin**: testele generate de profesor, Biblioteca utilizatorilor, testele din site („Examene" și „Clase") — se pot bifa mai multe surse deodată. |
| **4** | **Alegerea testelor**: `🎲 Automat din categorie`, `☑️ Testele bifate de mine`, sau `🔀 Mixt` — bifează automat propunerea, apoi profesorul debifează / adaugă ce vrea. |

La final: **🔗 Creează linkul testului**. Lângă linkul creat apar:

- **Denumirea testului** — un câmp care se poate schimba oricând; linkul deja
  trimis rămâne valabil;
- **💬 Trimite pe mesageria grupei** — linkul pleacă drept card apăsabil în
  conversația grupei (`GHID_MESAGERIE.md`);
- copierea linkului, WhatsApp și e-mail.

Elevii asociați primesc și o notificare în cont.

## 4. Cum ajunge testul la elev

Elevul deschide `/tema-grupa?id=...`, vede ce test i-a revenit și apasă
„▶ Începe testul":

- test **interactiv din site** → `/exercitiu` (scorul se salvează automat);
- test **PDF din site** → `/pdf-viewer`, cu Prof. Virtual alături pentru corectare;
- test **generat / din bibliotecă** → `/exercitiu-ai`, PDF sau subiect tipăribil.

Testele nerezolvate îi apar și în rolldown-ul **„📌 Teme nefăcute"** din Contul
meu, alături de teme.

Repartizarea e **stabilă**: la redeschiderea linkului elevul primește același
test, ca să-și poată îmbunătăți scorul.

Accesul e limitat la **elevii grupei alese** (adminul poate testa oricând, iar
profesorul-creator vede linkul în modul „previzualizare", fără să consume o
repartizare).

## 5. Cum se alege testul fiecărui elev

Ordinea de preferință, la prima deschidere a linkului (`chooseItem` din
`api/group-assignment.js`):

1. teste pe care elevul **le poate deschide** (fără barieră premium);
2. teste pe care **nu le-a mai primit** de la acest profesor, în această grupă;
3. teste pe care **nu le-au primit colegii** la acest test pe grupă;
4. la reluare (bazin epuizat): testul primit **cel mai demult**;
5. dispersie stabilă per elev (ca să nu iasă mereu primul test din listă).

## 6. Rezultatele

Sub formular, două rolldown-uri așezate unul lângă altul:

- **📨 Testele pe grupă trimise** — fiecare link, cu câți l-au deschis și câți
  l-au rezolvat, plus butoanele 📊 Raport · ✎ denumire · 🔗 copiere ·
  💬 mesagerie · 🗑 ștergere;
- **🏆 Clasament — doar testele primite** — media elevilor calculată **exclusiv**
  din testele repartizate prin aceste linkuri (`action='leaderboard'`).
  Clasamentul **general**, cu tot ce a rezolvat elevul pe platformă, rămâne unde
  era: în „Grupe / Rezultate elevi".

Detalii:

- Butonul **📊 Raport** de lângă fiecare test arată tabelul: elev → testul primit
  → stare (deschis / rezolvat) → scor.
- Scorurile testelor din site vin din `progress` (inclusiv corectările PDF făcute
  cu Prof. Virtual); cele ale testelor generate vin din `group_assignment_picks`.
- Profesorul primește notificare când un elev termină testul.

## 7. Doar pentru ADMIN: teste premium trimise gratuit

În formular apare, doar pentru admin, comutatorul
**„trimite testele ⭐ premium gratuit"**. Când e bifat, elevii fără abonament pot
rezolva testele premium repartizate — **doar prin acel link**.

Mecanismul: serverul semnează un token (`ai.signToken`, valabil 12 ore) legat de
`{ material, elev }`. Vizualizatoarele îl trimit mai departe la
`api/get-file-url.js`, care îl verifică înainte de a semna URL-ul fișierului.
Fără token și fără abonament, accesul rămâne blocat ca până acum.

## Fișiere atinse

**Noi:** `supabase/teme_grupa.sql`, `api/group-assignment.js`,
`src/components/GroupAssignment.jsx`, `src/pages/GrupaTema.jsx`.

**Modificate:** `src/lib/aiClient.js` (metodele `groupAssignment*`), `src/App.jsx`
(ruta `/tema-grupa`), `src/pages/Profile.jsx`, `src/pages/ProfesorVirtual.jsx`,
`src/pages/InteractiveViewer.jsx`, `src/pages/PDFViewer.jsx`,
`src/pages/ExercitiuAIViewer.jsx` (parametrul `?gt=` + grantul premium),
`api/get-file-url.js` (verificarea grantului).

**Catalogul de teste** — ce se poate bifa și cum se deschide la elev — e acum
partajat cu temele, în `api/_lib/catalog.js`.
