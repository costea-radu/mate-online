# Test interactiv pe grupă — un singur link, teste diferite pentru fiecare elev

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

**Testele din fișele claselor 5–12** („👥 Teste diferite / elev" → „📚 Fișele cu
exerciții ale clasei", 1 noiembrie 2026) au nevoie de:

```
supabase/fise_banca.sql
```

care creează `fise_banca` — banca de exerciții citite din fișe (RLS pornit, acces
doar prin server; fără acces anonim). Până e rulat, lista fișelor apare, dar la
deschiderea unei fișe apare mesajul „Banca fișelor nu e pregătită: rulează
supabase/fise_banca.sql…".

## 2. Unde se găsește funcția

În **două locuri**, aceeași componentă (`src/components/GroupAssignment.jsx`):

- **Contul meu** (`/profil`) → rolldown *„👥 Test pe grupă — fiecare elev primește alt test"*,
  imediat sub „Rezultate elevi";
- **Asistent AI** (`/profesor-virtual`) → tabul *„👥 Test interactiv pe grupă (teste diferite)"*
  (numele de până pe 1 nov. 2026: „👥 Test pe grupă (teste diferite)"), după
  „📤 Încarcă material".

Ambele apar doar pentru conturile de **profesor** (și pentru admin).

## 3. Cum se construiește testul pe grupă (pași pliabili)

| Pas | Ce alege profesorul |
|---|---|
| **0** | **Grupa** de elevi (sau „toți elevii mei"). Grupele se fac în „Contul meu" → Rezultate elevi. |
| **1** | **Categoria**: examen (Evaluare Națională / Bacalaureat) sau clasă (V–XII), ori „Toate". |
| **2** | **Formatul**: 🧩 interactiv sau 📄 PDF. |
| **3** | **Numărul de teste din bazin** (1–60) și **de unde vin**: testele generate de profesor, Biblioteca utilizatorilor, testele din site („Examene" și „Clase") — se pot bifa mai multe surse deodată. **Testele noi, făcute acum**, se generează din 1 nov. 2026 în *„🧩 Generează exerciții/teste interactive/PDF" → „👥 Teste diferite / elev"* (secțiunea de mai jos); butonul `🧩 Deschide generatorul` de aici duce acolo. |
| **4** | **Alegerea testelor**: `🎲 Automat din categorie`, `☑️ Testele bifate de mine`, sau `🔀 Mixt` — bifează automat propunerea, apoi profesorul debifează / adaugă ce vrea (butonul apăsat rămâne aprins). Lista de bifat aduce **toate** testele din sursele alese, fără plafon. Testele aduse din „👥 Teste diferite / elev" sunt deja bifate. |
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

## 3b. „👥 Teste diferite / elev" — testele noi, făcute acum

(1 noiembrie 2026) Generatorul de teste noi **s-a mutat** din testul pe grupă
(„⚡ Generează acum testele", pasul 3) în **„🧩 Generează exerciții/teste
interactive/PDF" → `👥 Teste diferite / elev`** (`src/components/TesteDiferite.jsx`;
adresa directă: `/profesor-virtual?tab=interactive&mod=elevi`). Fila are acum două
moduri: `✨ Un test / exercițiu` (generatorul de până acum) și `👥 Teste diferite / elev`
(doar profesori și admin).

| Alegerea | Ce înseamnă |
|---|---|
| **Nr. teste diferite / elev** (1–60) | câte teste diferite se generează — câte unul pentru fiecare elev |
| **1. Conținutul** | EXAMENE (Evaluare Națională, Bacalaureat) sau CLASE (a V-a – a XII-a) |
| **2. Din ce se fac testele** | la examene: `🎓 Subiectele de examen ale site-ului`; la clase: `📚 Fișele cu exerciții ale clasei`; la oricare: `🧩 Un test AI, în N variante` (interactiv) |
| **3. Datele problemelor** | `📋 Păstrează datele` (exact ca în original) sau `🔢 Schimbă numerele și notațiile` — ca la „📄 Generează subiect examen": AI-ul rescrie fiecare test și îl recalculează, cu barem (**un apel AI pe test**) |
| **🏛️ Publică testele și în „Biblioteca utilizatorilor"** | bifat implicit; testele se salvează oricum în „Testele și exercițiile mele" |

| Sursa | 📋 Păstrează datele | 🔢 Schimbă numerele și notațiile |
|---|---|---|
| 🎓 Subiectele de examen | teste PDF **decupate exact** din subiectele site-ului, fără AI și fără cost (mai jos) | fiecare test îl compune AI-ul (ca „Generează subiect examen" cu „modifică datele"); rămân **doar exercițiile bifate** (la BAC și subpunctele), fără puncte din oficiu la testele parțiale; testul e un „exam" tipăribil, **cu barem** (`kind='exam'`) — ~70 de credite pe test |
| 📚 Fișele claselor 5–12 | PDF: exercițiile **exact din fișă**, fără AI și fără cost (fără barem); interactiv: AI-ul adaugă doar răspunsurile și variantele de grilă (un apel pe test) | AI-ul rescrie exercițiile alese cu alte numere și notații, cu barem / răspunsuri (un apel pe test) |
| 🧩 Un test AI, în N variante | — (formularul generatorului are propriul „regim al datelor") | — |

**Un singur PDF, cu „Varianta 1", „Varianta 2"…** (1 noiembrie 2026, după-amiaza —
`src/lib/testeSet.js`). Când se generează **mai multe teste** deodată, ele formează un
**set**:

- fiecare test e o variantă și are pe foaie **„Varianta k"**: titlul testului (la testele
  tipăribile din fișe, la cele cu numere schimbate și la cele interactive, în versiunea
  PDF), în antetul scurt (subiectele PDF parțiale, îngroșat, în dreapta) sau într-o casetă
  sus, în dreapta copertei (subiectele PDF complete);
- în **„Testele și exercițiile mele"** intră **un singur element** — PDF-ul cu toate
  variantele, fiecare de la pagină nouă, cu titlul **„25 de teste grilă diferite, pentru
  25 de elevi"** („grilă" doar când toți itemii sunt grilă: la EN, Subiectele I și II; la
  BAC niciodată; „de" de la 20 în sus); dedesubt: „un singur PDF: Varianta 1–25 · <ce
  conține>". Se tipărește / descarcă întreg (`📄 PDF`, `📝 Barem`, `⬇ Descarcă`), iar
  `▸ Variantele (25)` le arată una câte una;
- cu bifa „🏛️ Publică…", în **„Biblioteca utilizatorilor"** se publică tot **o singură
  dată**, setul întreg (variantele nu se mai publică separat);
- **variantele rămân salvate și separat, dar ascunse** în spatele setului
  (`payload.setId`): pe ele le folosește **„👥 Test interactiv pe grupă"**, câte una
  pentru fiecare elev (`👥 Folosește-le…` le aduce bifate; la sursa „🧩 Testele generate de
  mine" apar variantele, nu setul). Ștergerea setului (🗑, cu confirmare) șterge și
  variantele;
- un singur test (Nr. teste diferite / elev = 1) se salvează ca până acum.

În generator, sub rezultat: „📚 Salvate într-un singur PDF: „…"" cu `📄 PDF — toate cele N
variante` / `📝 Baremul tuturor variantelor` (sau `⬇ Descarcă PDF-ul cu toate cele N
variante` la subiectele decupate exact); la fiecare variantă, `📄 PDF` / `📝 Barem` (la cele
interactive și `🗗 Deschide`). Dacă setul n-a putut fi salvat, testele rămân separat, iar
butoanele vechi (`🖨 Tipărește toate testele`, `📝 Toate baremele`) apar în locul lui.

**Spre testul pe grupă:** `👥 Folosește-le în testul interactiv pe grupă` duce testele
generate în fila „👥 Test interactiv pe grupă (teste diferite)": formatul (PDF sau
interactiv) și categoria vin gata alese, iar testele — **bifate** în bazin, din sursa
„🧩 Testele generate de mine" (sus apare „📥 N teste generate acum sunt în bazin" cu
`✖ Renunță la ele`). Drumul: `sessionStorage` (`src/lib/grupaPreset.js`), o singură dată.
Testele de tip `exam` (din fișe sau cu numerele schimbate) intră la formatul **📄 PDF**,
ca subiectele generate; elevul le deschide în vizualizatorul tipăribil.

### 📚 Fișele cu exerciții ale clasei: nivele și tipuri, cum sunt scrise în fișă

1. Se alege clasa → apare lista fișelor PDF ale clasei (`api/fise.js` → `list`), cu
   starea fiecăreia: `3 grupe · 120 de exerciții`, `📖 necitită` sau `⏳ se citește…`.
2. La deschiderea unei fișe apar **grupele ei, exact cum sunt scrise în fișă**:
   `Nivel 3: Raționalizare`, `Triunghiuri asemenea · MODEL 2`, `Exercițiul 1 — ecuații de
   forma x² + bx = 0`, `Adunări și scăderi (50 de exerciții)` — fiecare cu cerința comună
   („Calculați:"), numărul de exerciții și `▸ exercițiile` (previzualizare cu formule).
3. Se bifează grupele (din una sau din mai multe fișe) și, la fiecare, **câte exerciții
   intră în fiecare test** (`2 / test`).
4. Rezumatul: „🧮 Fiecare test: 5 exerciții — 2 din Nivel 3 · 3 din Nivel 4. Ajung pentru
   25 de teste fără nicio repetare (până la 31)".

**Citirea fișei (o singură dată, pentru toți profesorii).** Fișele au exercițiile câte
2–4 pe rând, iar formulele lipsesc din stratul de text (sunt desenate) — de aceea, la
prima deschidere, fișa o citește **modelul cu vedere** (`AI_PDF_CHAT_MODEL`, implicit
gpt-6.1-terra), câte 2 pagini, cu efort de raționament „low" (`api/_lib/fise.js`):
grupele după titlurile din fișă, exercițiile în LaTeX, fără rezolvări, cu semnul
„cu figură" la exercițiile care depind de un desen. Rezultatul se păstrează în
`fise_banca` și îl folosesc apoi **toți profesorii** — testele cu datele păstrate se
compun de aici **fără niciun cost**. Detalii:

- citirea durează 1–3 minute; dacă o citește chiar atunci alt profesor, pagina
  așteaptă și revine singură („⏳ se citește…", lacăt `reading_since`, 12 minute);
- **costul** (~1–2 lei pe fișă, o singură dată) îl plătește **platforma**, nu
  profesorul: rândul din `ai_usage` are `user_id` null și endpoint
  `fise:transcriere` (vezi `ai_usage_daily`); costul fiecărei fișe stă și în
  `fise_banca.cost_micro`. Profesorul are nevoie de abonament doar ca să pornească
  citirea unei fișe încă necitite; se aplică doar limita orară, nu bugetele lui;
- **adminul** are `📖 Admin: citește toate fișele necitite (N)` (le citește pe rând,
  ca profesorii să nu mai aștepte) și, la fiecare fișă, `🔄 Citește din nou`;
- dacă fișierul unei fișe se schimbă (alt `file_url`), banca ei se citește din nou la
  următoarea deschidere; o fișă din care o bucată de pagini n-a putut fi citită apare
  cu „⚠️ câteva pagini n-au putut fi citite" (`status='partial'`).

**Testele diferite** (`src/lib/fiseTeste.js` → `planFiseTests`): fiecare grupă își
amestecă exercițiile și le dă pe rând testelor — un exercițiu se repetă **abia după ce
s-au folosit toate** exercițiile grupei lui și **niciodată de două ori în același test**;
în test, exercițiile unei grupe stau în ordinea din fișă. Exercițiile „cu figură" nu
intră implicit (figura nu se copiază) — se pot include cu o bifă.

| Ieșirea | Ce se face |
|---|---|
| 📄 PDF, datele păstrate | fără AI: un „exam" cu o secțiune pe grupă (cerința ei sub titlu), numerotare 1, 2, 3…, punctaj întreg (100 − oficiu), timp de lucru, ✍️ spațiu de lucru; **fără barem** |
| 📄 PDF, numere schimbate | un apel AI pe test (`generateInteractive`, itemi cu redactare, exercițiile testului ca material, 1:1) → „exam" cu barem; itemul k se așază în grupa exercițiului k |
| 🧩 Interactiv | un apel AI pe test (mixt / doar grilă / cu redactare); cu datele păstrate, enunțurile rămân exact ca în fișă |

Titlul: `Test din fișe nr. N — Clasa a VII-a · Radicali + Asemănarea` (numărul continuă
de la un lot la altul). Cu AI, între 4 și 24 de exerciții pe test; fără AI, până la 40.

### 🧩 Un test AI, în N variante (interactiv)

Se deschide formularul din *„✨ Un test / exercițiu"* — **același component**
(`src/components/InteractiveGenForm.jsx`), deci aceleași alegeri: exercițiu sau
test, numărul de itemi, timpul și punctele din oficiu, tipul itemilor (mixt /
doar grilă / cu redactare), categoria, dificultatea, **materialul de la tablă**
(poză, PDF sau Word), capitolele și instrucțiunile pentru AI.

Din **o singură generare** ies atâtea **variante** câte teste diferite / elev s-au cerut:

| | Ce se schimbă de la o variantă la alta |
|---|---|
| **Problemele** | sunt aceleași la toți elevii — nimeni nu ia un test mai greu |
| **Ordinea lor** | diferă: problema de la punctul 1 la un elev e la punctul 4 la altul |
| **Litera corectă** | diferă la grilă: o problemă cu răspunsul `a)` are la varianta următoare răspunsul `b)`, apoi `c)`, apoi `d)` (rotație, `src/lib/testVariante.js`) |

Detalii care contează:

- variantele de răspuns se amestecă între ele, dar **textul răspunsului corect
  rămâne același** — se schimbă doar litera;
- variantele de tipul „toate cele de mai sus" / „niciuna" rămân **ultimele**;
- dacă explicația trimitea la o literă („varianta b"), litera e **rescrisă** după
  amestec;
- itemii **cu redactarea răspunsului** nu au litere, deci acolo diferă doar
  ordinea problemelor — interfața avertizează;
- fiecare variantă se salvează în **„Testele și exercițiile mele"** ca
  `Titlu · Varianta k` (`ai_personal_items`, `kind='interactive'`); cu
  „👥 Folosește-le în testul interactiv pe grupă" intră bifate în bazin;
- variantele sunt **interactive** (scorul fiecărui elev intră singur în
  raport); PDF-ul se scoate oricând din bibliotecă;
- butoanele „▸ Varianta 1…N" de sub generator arată pe loc cum arată fiecare
  variantă — ordinea problemelor și litera corectă, marcată cu ✓.

### 🎓 Subiectele de examen, cu datele păstrate: teste PDF combinate exact

(31 octombrie 2026; din 1 noiembrie în „👥 Teste diferite / elev") Face **atâtea
teste PDF noi câte teste diferite / elev s-au cerut**, fiecare **combinat exact** din
subiectele PDF ale site-ului — aceeași metodă ca la *„📄 Generează subiect examen"
→ „📎 Combină exact"* (`src/lib/pdfCombine.js`; componenta:
`src/components/CombinedPdfGenerator.jsx`):

- exercițiile sunt **decupate** din variantele date, modelele, simulările și
  testele de antrenament ale examenului (rubricile cu teste întregi — capitolele,
  fișele pe exerciții și baremele nu intră) și așezate pe **aceeași poziție**:
  exercițiul 3 de la Subiectul II vine dintre exercițiile 3 de la Subiectul II;
- redactarea e **identică** cu originalele: fără AI, fără cost;
- **testele diferă între ele**: pentru N teste se descarcă 6–12 subiecte-sursă;
  testele dintr-o „tură" iau, pe fiecare poziție, exercițiul din altă sursă, iar
  într-un test cele 6 exerciții ale unui subiect vin din 6 surse diferite (cât
  ajung). Un test identic cu altul se trage din nou;
- **examenul**: Evaluare Națională, BAC Tehnologic, BAC Științele Naturii, BAC
  Mate-Info — propus după conținutul ales (Evaluare Națională / Bacalaureat); testele
  primesc categoria examenului;
- **ce subiecte intră**: `Toate subiectele (I, II și III)` · `Doar Subiectul I` ·
  `Doar Subiectul al II-lea` · `Doar Subiectul al III-lea` · `Doar Subiectele I și II`.

| Alegerea | Cum arată fiecare PDF |
|---|---|
| Toate subiectele | coperta oficială a unuia dintre subiectele-sursă (la BAC, antetul probei: „Proba E. c) … Toate subiectele sunt obligatorii…"), apoi cele trei subiecte |
| Doar unele subiecte | fără copertă (ea vorbește de toate subiectele și de timpul examenului); în locul ei, un **antet scurt**: „Evaluarea Națională · Matematică", „Test de antrenament · Subiectul I — 30 de puncte", „Test combinat nr. N" și rândul „Numele și prenumele … Clasa … Data" |

#### Bife pe exerciții și pe subpuncte (1 noiembrie 2026)

Sub alegerile rapide, **„Exercițiile incluse"** are o bifă pentru fiecare exercițiu
al fiecărui subiect (implicit toate bifate):

- **EN**: Subiectul I `1.`–`6.`, Subiectul al II-lea `1.`–`6.`, Subiectul al III-lea `1.`–`6.`;
- **BAC**: Subiectul I `1.`–`6.`; la Subiectele **II și III**, fiecare problemă (`1.`, `2.`)
  cu subpunctele ei **`a)` `b)` `c)`** — în test intră enunțul problemei și doar
  subpunctele bifate (de exemplu `1.` cu `a)` și `c)`).

Bifa subiectului și bifa problemei le schimbă pe toate (sunt „pe jumătate" când e
bifată doar o parte; un clic pe una „pe jumătate" le bifează pe toate). Alegerile
rapide de deasupra bifează subiectele întregi și se aprind singure când bifele
corespund uneia dintre ele. Lângă fiecare subiect apare punctajul bifat (5 puncte
pe exercițiu, la BAC 5 puncte pe subpunct), iar dedesubt rezumatul: „Subiectul I:
1, 2, 4 · Subiectul al II-lea: 1 a), c); 2 — 35 de puncte". Fără nimic bifat,
butonul de generare e oprit.

Cum iese testul:

- un subiect din care **lipsește ceva** are **titlul cu punctajul bifat**
  („SUBIECTUL al II-lea (15 puncte)") + indicațiile lui („Încercuiește litera…"), cu
  mărimea literei din subiectul-sursă; un subiect întreg își păstrează titlul original;
- coperta oficială / antetul probei — doar dacă e bifat **tot**; altfel, antetul
  scurt, cu punctajul bifat;
- exercițiile și subpunctele își **păstrează numărul** din subiectul oficial (nu se
  renumerotează): `1.`, `3.`, `6.`; `a)`, `c)`;
- între enunțul unei probleme și subpunctele ei, spațierea e cea originală
  (tăieturile cad în mijlocul albului dintre rânduri);
- titlul testului primește „(exerciții alese)", iar „▸ Sursele" arată și subpunctele
  (`S2.1 a), c) ← …`).

Subpunctele se recunosc din textul PDF-ului (rândurile „5p a)", „5p b)", „5p c)" de
la marginea din stânga, toate trei, în ordine; și când problema trece pe pagina
următoare). Dacă într-o sursă două subpuncte se ating (nicio linie albă între
rânduri — de exemplu o fracție urcă până în rândul de deasupra), sursa aceea nu se
desparte pe subpuncte, ca să nu iasă o formulă ciuntită: problema vine din altă
sursă, iar dacă nu se poate despărți în niciuna, intră **întreagă**, cu avertisment.

Tot de acum: la BAC se taie și **albul de la capătul paginii** la Subiectul III
(subiectele de BAC nu au spațiu de scris — elevii scriu pe foaia de examen), deci
testele de BAC ies mai scurte. La EN, sub problemele Subiectului III rămâne spațiul
de scris, ca până acum.

Fiecare test:

1. se **salvează** în „📚 Testele și exercițiile mele" (`ai_personal_items`,
   `kind='pdf'`; fișierul în bucketul privat `personal-pdfs`);
2. se **publică automat** în „🏛️ Biblioteca utilizatorilor" (serverul face copia
   publică, ca la orice PDF publicat; e ⭐ premium implicit — elevii grupei îl
   primesc oricum gratuit, prin linkul testului pe grupă). Copia privată ține minte
   publicarea (`payload.publicId`), așa că „🏛️ Publică" din „Testele mele" nu mai
   face un duplicat;
3. se poate **descărca**: `⬇ Descarcă` și `👁 Vezi` la fiecare test, plus
   `⬇ Descarcă toate testele într-un singur PDF (de tipărit)`; mai târziu, din
   „📚 Testele și exercițiile mele" → `⬇ Descarcă`;
4. cu „👥 Folosește-le în testul interactiv pe grupă" intră **bifat** în bazinul
   testului pe grupă (sursa „🧩 Testele generate de mine").

Titlul: `Test combinat nr. N — Evaluare Națională · Subiectul I` (la testul complet,
fără „· Subiectul …"); numărul continuă de la un lot la altul. „▸ Sursele" arată
de unde vine fiecare exercițiu.

Profesorul Virtual citește din fiecare test **doar exercițiile așezate**
(`payload.text` / `pageTexts`, scrise la generare): în fișier, paginile-sursă
încorporate își păstrează tot textul (sunt doar decupate vizual), deci textul
citit din PDF ar fi amestecat și exercițiile celelalte.

Elevul primește testul ca PDF („📄 Deschide PDF-ul" pe pagina temei) și îl
rezolvă pe hârtie.

| Mesaj | Ce înseamnă |
|---|---|
| „Examenul ales are prea puține subiecte PDF pe site" | trebuie cel puțin 2 subiecte în rubricile Variante / Simulări / Teste de antrenament ale examenului |
| „Nu am putut descărca suficiente subiecte-sursă cu structură de examen" | PDF-urile găsite sunt scanate (fără text) sau nu au structura oficială („SUBIECTUL I … 1. … 6.") |
| „Din subiectele găsite se pot face cel mult X teste diferite" | de obicei la „Doar Subiectul al II-lea / al III-lea" de BAC (câte 2 probleme), cu puține surse — unele teste se repetă |
| „nepublicat (…)" la un test | publicarea a picat; testul e salvat — se publică din „Testele și exercițiile mele" → 🏛️ Publică |
| „La unele probleme, subpunctele nu s-au putut separa în niciun PDF-sursă — au intrat întregi" | ai bifat doar unele subpuncte, dar în subiectele-sursă găsite problema nu se poate tăia curat între subpuncte; în „▸ Sursele", rândul ei are „(problema întreagă: …)" |
| „Bifează cel puțin un exercițiu." | nu e nimic bifat la „Exercițiile incluse" |

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
`src/pages/GrupaTema.jsx`, `src/components/VariantGenerator.jsx` (un test AI, în
variante), `src/lib/testVariante.js` (amestecul ordinii și al literelor),
`src/components/InteractiveGenForm.jsx` (formularul generatorului).

**1 noiembrie 2026 — „👥 Teste diferite / elev":** `src/components/TesteDiferite.jsx`
(modul nou din „🧩 Generează exerciții/teste interactive/PDF"),
`src/components/FiseTestGenerator.jsx` + `src/lib/fiseTeste.js` (testele din fișele
claselor 5–12), `api/fise.js` + `api/_lib/fise.js` + `supabase/fise_banca.sql` (banca
fișelor), `src/components/ListaTesteExam.jsx` (lista testelor „exam", tipărirea tuturor),
`src/lib/grupaPreset.js` (testele generate → testul pe grupă), `src/lib/testeSet.js`
(setul salvat ca un singur PDF, cu „Varianta k" — `test/teste-set-variante.test.js`); modificate:
`src/components/CombinedPdfGenerator.jsx` („🔢 Schimbă numerele"), `src/lib/examPrint.js`
(`printExams`, subtitlul, rândul pentru nume), `src/components/GroupAssignment.jsx` (fără
generator; primește testele generate). Teste: `test/teste-diferite-fise.test.js`.

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
