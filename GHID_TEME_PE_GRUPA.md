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

**Timpul de lucru** (pasul 5) are nevoie și de:

```
supabase/medii_si_timp.sql
```

care adaugă `group_assignments.time_limit_min` (minutele alese),
`group_assignment_picks.started_at` (când a apăsat elevul „Începe testul") și
`group_assignment_picks.timed_out` (testul s-a închis pentru că a expirat
timpul). Până e rulat, testele se creează normal — doar fără limită de timp.

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
| **4** | **Alegerea testelor**: `🎲 Automat din categorie`, `☑️ Testele bifate de mine`, sau `🔀 Mixt` — bifează automat propunerea, apoi profesorul debifează / adaugă ce vrea. Lista de bifat aduce **toate** testele din sursele alese, fără plafon. |
| **5** | **Timpul de lucru**: butoane rapide (10, 20, 30, 40, 50 minute, 1 oră, 1 oră și 30 de minute, 2 ore, 2 ore și 30 de minute, 3 ore), selectoare de **ore + minute** pentru orice altă durată, sau `∞ Fără limită`. Minimul e 10 minute, maximul 3 ore. |

La final: **🔗 Creează linkul testului**. Lângă linkul creat apar:

- **Denumirea testului** — un câmp care se poate schimba oricând; linkul deja
  trimis rămâne valabil;
- **💬 Trimite pe mesageria grupei** — linkul pleacă drept card apăsabil în
  conversația grupei (`GHID_MESAGERIE.md`);
- copierea linkului, WhatsApp și e-mail.

Elevii asociați primesc și o notificare în cont.

### Lista de bifat: fără plafon

La pasul 4, catalogul întoarce **toate** testele din sursele alese —
`api/_lib/catalog.js` citește paginat (`allRows`), iar `api/group-assignment.js`
nu mai taie lista la 200. Ca pagina să rămână sprintenă când sunt mii de teste,
lista se desenează în tranșe de 200, cu butonul „▾ Arată încă…"; căutarea după
titlu filtrează tot ce s-a încărcat.

În **bazin** intră tot cel mult 60 de teste (`MAX_POOL`) — dacă sunt bifate mai
multe, se ia primele 60 și profesorul e avertizat pe loc.

### Timpul de lucru (pasul 5)

- Cronometrul pornește când elevul apasă **„▶ Începe testul"**, nu când primește
  linkul: momentul se scrie în `group_assignment_picks.started_at`.
- Termenul e calculat **pe server** din `started_at + time_limit_min`, deci
  **nu se resetează** dacă elevul reîncarcă pagina sau redeschide linkul — timpul
  curge mai departe.
- Timpul rămas se vede tot testul, în insigna din vizualizator
  (`src/components/TestModeBadge.jsx`): sub 5 minute devine portocaliu, sub 1
  minut roșu și clipește.
- La **zero**: testul se închide singur (`action='time_up'`), elevul vede
  „⏰ Timpul a expirat", mesageria și Profesorul Virtual repornesc, iar rândul e
  marcat `timed_out` — în raport apare „⏰ timp expirat" în loc de „✅ rezolvat".
  Ce a apucat elevul să trimită rămâne la profesor.
- Fereastra de oprire a mesageriei (`active_until`) urmează acum timpul ales; la
  testele fără limită rămâne fereastra veche de 3 ore.

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

**Noi:** `supabase/teme_grupa.sql`, `supabase/medii_si_timp.sql`,
`api/group-assignment.js`, `src/components/GroupAssignment.jsx`,
`src/pages/GrupaTema.jsx`.

**Modificate:** `src/lib/aiClient.js` (metodele `groupAssignment*`), `src/App.jsx`
(ruta `/tema-grupa`), `src/pages/Profile.jsx`, `src/pages/ProfesorVirtual.jsx`,
`src/pages/InteractiveViewer.jsx`, `src/pages/PDFViewer.jsx`,
`src/pages/ExercitiuAIViewer.jsx` (parametrul `?gt=` + grantul premium),
`api/get-file-url.js` (verificarea grantului).

**Catalogul de teste** — ce se poate bifa și cum se deschide la elev — e acum
partajat cu temele, în `api/_lib/catalog.js`.

**Cronometrul** stă în `src/lib/testMode.js` (`startTestMode({ deadline })`,
`useTestCountdown`, `fmtRamas`, `fmtDurata`) și se afișează din
`src/components/TestModeBadge.jsx`, care e deja montat în toate
vizualizatoarele, plus din `src/pages/GrupaTema.jsx`.
