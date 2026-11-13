# 🎯 Pregătește-mă de examen — harta pregătirii, testul zilei, XP, ligă, fluxul Arenei, nota cu roșu

> **13 noiembrie 2026 — 🗺️ HARTA PREGĂTIRII** (planul de parcurs): vezi secțiunea 0,
> imediat mai jos. Restul ghidului (8 nov.) rămâne valabil: seria, bifa zilei de la 3
> exerciții, răsplata, liga, insignele, amintirea, fluxul Arenei, nota cu roșu.
>
> **13 noiembrie 2026, după-amiaza — DOUĂ HĂRȚI**: 1 · exercițiile interactive, 2 ·
> subiectele PDF **cu barem** (fără „Capitole" și „Exerciții pe subiecte" în PDF); progresul
> din hartă apare și în **„Rezultate", la profesori și la părinți**. Vezi 0.1, mai jos.

## 0. Harta pregătirii — planul de parcurs (13 nov. 2026)

Cererea:

> La conturile de elevi, pune în „pregătește-mă de examen" un plan de pregătire cu
> exerciții în ordine: Planul să conțină, în ordine, toate exercițiile interactive din
> subiectele de la „capitole cu exerciții", „exerciții pe subiecte" și apoi „teste
> interactive" de la tipul de examen ales de elev. După terminarea testelor interactive,
> să se treacă la cele PDF. La testele PDF să se poată trimite rezolvări: a) pe PDF,
> b) în chat, c) în foaia de lucru, d) cu poza. Să se poată alege și o clasă: (…) toate
> exercițiile interactive de la acea clasă, în ordinea din site, apoi din clasele
> precedente. Apoi să se treacă la exerciții PDF (…) dar la corectarea cu AI în lipsa
> baremului să ai grijă la consum, să pui limită sau taxă. Să se poată reveni la un
> exercițiu sau test neterminat, să apară în „rezultate". Planul să se poată vedea ca o
> hartă (…) Harta să se updateze mereu, dacă se adaugă exerciții noi în site. Să se poată
> stagna pe hartă la un exercițiu până îl termină, dar să poată și trece mai departe după
> mai multe încercări. Dacă se întrerupe șirul de zile, să se poată relua de unde a rămas.
> Păstrează liga și XP, dar introdu harta de pregătire - planul de parcurs.

### 0.1 După-amiaza: două hărți, doar subiecte cu barem, progresul la profesori și părinți

Cererea:

> fă să apară progresul din hartă în „rezultate", la profesori și părinți · scoate din
> hartă PDF exerciții pe capitole și exerciții pe subiecte. păstrează doar subiecte de
> examen cu corectare după barem · împarte harta în două: prima dată harta exercițiilor
> interactive și a doua harta exercițiilor PDF

- **Harta 1 · 🧩 Exerciții interactive** — ca înainte: la examen *Capitole cu exerciții* →
  *Exerciții pe subiecte* → *Teste interactive*; la clasă, interactivele clasei, apoi ale
  claselor dinainte.
- **Harta 2 · 📄 Subiecte PDF cu barem** — la examen: *Variante* → (BAC) *Teste de
  antrenament* → *Simulări*, **doar cele cu barem legat**; la clasă: fișele PDF ale clasei
  și ale claselor dinainte, tot **doar cu barem**. *Capitole* și *Exerciții pe subiecte* în
  PDF nu mai intră.
- **„Cu barem legat"** = același barem pe care îl folosește corectarea: potrivirea
  confirmată a site-ului sau baremul ales de admin (`ai_pdf_text`: `ok`, `ok_antet`,
  `ok_continut`, `inclus`, `ok_admin`, ori `barem_override_id`; dacă PDF-ul a fost înlocuit
  între timp, potrivirea veche nu mai contează) sau legătura botului de examene
  (`exam_bot_index`, și `ok_bot`). Un subiect căruia i se leagă baremul apare singur pe hartă.
  Dacă tabelele baremelor lipsesc: la examen intră toate subiectele (au barem oficial),
  la clasă niciuna.
- **Fiecare hartă are pasul ei.** Pasul de azi (testul zilei) vine din harta 1; după ce o
  termini, din harta 2. Cu Premium, harta 2 se poate lucra și **în paralel** („📄 Subiectul
  de acum: pasul N" deschide fișa cu cele patru moduri). „⏭ Treci mai departe" — pe pasul
  curent al hărții lui, după 3 încercări, în oricare hartă.
- **Fără abonament**: harta 2 are ⭐ („se deschide cu Premium: profesorul virtual corectează
  fiecare subiect după barem") și nu oprește nimic.
- **„Rezultate" (Contul meu), la profesor și la părinte**: în rândul elevului, insigna
  `🗺️ EN · 🧩 9/49 · 📄 1/11 · 🔥 3`; în zona deschisă, caseta **„🗺️ Harta pregătirii ·
  ținta"**: cele două hărți, cu bara, etapele (`Capitole cu exerciții 8/21` …) și pasul la
  care a ajuns („E la pasul 5: «Numere prime» — încercat de 3 ori, ultima dată 50%"),
  neterminatele, cei săriți, seria și recordul, zilele bifate și ultima zi. Fără lista
  pașilor și fără notele zilei (acelea le vede doar elevul). Elevul fără țintă: „nu și-a ales
  încă examenul sau clasa". Pe telefon, zona deschisă a elevului stă acum în lățimea
  ecranului (tabelul se derulează în lateral, casetele nu).
- **SQL**: nimic nou (`prep_plan` există de dimineață).

### Instalare

**Supabase → SQL Editor** → rulează `supabase/plan_pregatire.sql` (o singură coloană:
`user_stats.prep_plan`, jsonb; fără tabele noi, deci fără GRANT-uri noi). Fără ea harta
merge, doar „⏭ Treci mai departe" nu se poate salva (adminul vede un mesaj pe pagină).

### Ținta și ordinea (`api/_lib/planPregatire.js`)

- **Ținta** (tot în `user_stats.prep_exam`): un examen — EN, BAC Mate-Info, BAC Științele
  Naturii, BAC Tehnologic — **sau o clasă**, de la a V-a la a XII-a (`clasa-5` … `clasa-12`).
- **Examen** → harta 1: *Capitole cu exerciții* → *Exerciții pe subiecte* → *Teste
  interactive* (toate interactive); harta 2 (PDF, doar cu barem — 0.1): *Variante* → (BAC)
  *Teste de antrenament* → *Simulări*. Fără fișierele de barem. La BAC, „Capitole" sunt
  comune tuturor profilurilor (ca pe site); restul, doar ale profilului ales.
- **Clasă** → harta 1: interactivele clasei alese, apoi ale claselor dinainte (… până la
  a V-a); harta 2: fișele PDF cu barem, în aceeași ordine. Ex.: a VII-a → VII, VI, V
  interactive; VII, VI, V fișe cu barem. (La a IX-a intră și a VIII-a … a V-a.)
- În fiecare etapă: ordinea din site (`sort_order`, apoi cele mai noi). Un material apare o
  singură dată.
- **Harta se construiește la fiecare deschidere** din `content`: un exercițiu nou intră
  singur la locul lui; dacă e adăugat după începutul planului, are eticheta „nou" — iar
  dacă e într-o etapă deja parcursă, devine pasul următor.

### Pașii (starea vine din `progress`, ca „Rezultatele mele")

| Stare | Când | Pe hartă |
|---|---|---|
| nou | neînceput | punct alb (sau „urmează", încuiat) |
| neterminat | doar salvarea automată (`attempts = 0`) | ⏸ |
| încercat | trimis / corectat, sub prag | cerc roșu, ×n încercări |
| trecut | ≥ **70%** la interactive, ≥ **50%** la PDF (nota 5) | ✓ bleumarin |
| sărit | „⏭ Treci mai departe", după **3** încercări | ⏭ |

- **Pasul curent** = primul pas accesibil care nu e trecut și nici sărit. Elevul rămâne
  pe el până îl trece; după 3 încercări apare „⏭ Treci mai departe" (pasul rămâne pe hartă,
  se poate relua oricând). Pașii de după sunt încuiați — mai puțin cei la care elevul a
  lucrat deja din site.
- Un pas trecut rămâne trecut (ținut minte în `prep_plan.trecute`), chiar dacă o reluare
  iese mai slabă (în `progress` contează ultima încercare).
- **Fără abonament**: interactivele gratuite. Pașii Premium și testele PDF (corectarea lor e
  Premium) apar cu ⭐ și nu opresc planul; „Ai terminat tot ce e gratuit" + îndemnul.
- **Testul zilei = pasul curent** (rândul din `daily_tests` îl urmează cât ziua nu e încă
  bifată); amintirea zilnică îl deschide direct. Vechea alegere (nerezolvate → sub 70% →
  recapitulare) rămâne doar când planul e gata („Recapitulare").
- **Bifa zilei** — neschimbată (3 exerciții, și o parte de test). La o țintă-clasă se
  numără și exercițiile claselor din plan.
- **După o pauză**: seria 🔥 o ia de la capăt (ca înainte), planul nu — „Bine ai revenit!
  … te așteaptă exact unde l-ai lăsat: pasul 37".
- Pragurile se schimbă din Vercel, fără cod: `PLAN_PRAG` (70), `PLAN_PRAG_PDF` (50),
  `PLAN_INCERCARI` (3).

### Pagina (`src/pages/PregatesteMa.jsx`, `src/components/HartaPlan.jsx`)

- **🗺️ Pasul de azi**: harta din care vine („🧩 Harta interactivă" / „📄 Harta PDF"),
  etapa, „pasul 5 din 49", titlul, ce s-a întâmplat la el, bifa zilei, butonul (▶ Începe /
  ▶ Continuă / ↻ Mai încearcă), „⏭ Treci mai departe" când e voie; la subiectele PDF, cele
  patru moduri: **✏️ Pe PDF · 💬 În chat · ✍️ Foaia de lucru · 📷 Cu poza**. Dedesubt:
  câte un rând cu bara pentru fiecare hartă, amintirea.
- **Hărțile** (1 · interactive, apoi 2 · PDF cu barem, una sub alta): pagina de caiet de
  matematică (pătrățele, marginea roșie), pașii legați rând după rând, în șerpuire; cercul =
  interactiv, pătratul rotunjit = subiect PDF; etapele sunt notițe pe margine (se pliază;
  deschisă stă etapa pasului curent; o hartă terminată stă pliată, cu 🏁). Un clic pe un pas
  → fișa lui jos, cu butoanele („pasul N din M" — numerotarea hărții lui).
- Pe calculator: pasul de azi și harta în stânga, răsplățile și insignele în dreapta. Pe
  telefon: pasul, harta, apoi răsplățile.
- Liga, XP-ul, monedele, insignele, „Ultimele zile", Prof. Tudor — neschimbate.
- „🔀 Alt test" și comutatorul „interactiv / PDF" au lăsat locul hărții.
- Vizualizatorul arată „🗺️ HARTA PREGĂTIRII" la pașii din plan; „Înapoi" revine pe hartă.

### Testele PDF din plan (`src/pages/PDFViewer.jsx`, `?mod=`)

| Mod | Ce se deschide | Cum ajunge pe hartă |
|---|---|---|
| ✏️ Pe PDF | EN: „Rezolvă pe PDF" (grilele după barem, scrisul la corector). BAC / clase: scrii oriunde pe pagini; la „✅ Corectează", paginile scrise (până la 3) intră ca imagini în formularul de răspuns | `api/rezolva-pdf.js` / `api/ai-correct.js` → `progress` |
| 💬 În chat | formularul „📝 Răspunde în chat", deschis singur, cu îndemn | `api/ai-correct.js` → `progress` |
| ✍️ Foaia de lucru | foaia de lucru, lângă test. La fișele claselor se deschide și formularul: „📎 Atașează la răspuns" → „✅ Corectează" | EN/BAC: nota de pe foaie (`api/ai-handwriting.js`); clase: prin formular |
| 📷 Cu poza | formularul, cu îndemnul „📷 Poze cu rezolvarea" (până la 3) | `api/ai-correct.js` → `progress` |

Corectarea scrisului (pe PDF, foaie, poze) e Premium, ca înainte. **Fără barem**: cota
zilnică „🧮 Corectări AI fără barem" (3 pe zi; peste ea, pachetul AI) — `GHID_LIMITE_AI.md`.

### Testele neterminate în „Rezultate" (`src/lib/ciornaTest.js`, `src/lib/tutorBridge.js`)

- „📊 Rezultatele mele" (Contul meu): sus, **⏸ Neterminate** — testele începute și
  netrimise, cu **▶ Continuă**; în tabel, eticheta „neterminat”, iar orice test din
  platformă se redeschide din titlu („Înapoi" revine la rezultate).
- La revenire, **răspunsurile de data trecută sunt puse la loc** (pe același dispozitiv,
  30 de zile): vizualizatorul le ține minte din salvarea automată și le trimite testului
  (`MATE_ANSWERS_SET`); nu suprascrie ce a scris elevul între timp. După „Corectează total",
  „Resetează" sau reîncărcarea de la zero, ciorna se șterge. La PDF, scrisul de pe pagini se
  păstra deja (ciorna locală a testului).

### API

`/api/gamificare` → `pregatire` întoarce și **`plan`**: `{ interactiv, pdf, pas, total,
trecute, terminat, reguli, coloana, tinta }` — fiecare hartă cu etapele (numărători), pașii,
`curent`, `pas` (cu adresele; la PDF și `moduri`), `procent`, `ramasePremium`; `plan.pas` =
pasul zilei (din harta interactivă, apoi din cea PDF). `pregatire_alege` primește și o
clasă (`{ examen: 'clasa-7' }`); **`plan_sari`** (`{ contentId }`) = „⏭ Treci mai departe"
(400 cu motivul; 503 fără migrare). `/api/teacher-students` → fiecare elev are **`plan`**
(rezumatul: ținta, cele două hărți fără lista pașilor, seria, recordul, zilele, ultima zi)
sau `null`; dacă tabelele pregătirii lipsesc, rezultatele merg mai departe, fără hartă.

### Teste

`test/plan-pregatire.test.js` (20: cele două hărți, baremele, pasul zilei, sărirea în
fiecare hartă, rezumatul și `api/teacher-students` la profesor și părinte, paginile),
`test/plan-pregatire-pdf.test.js` (7), `test/rezultate-neterminate.test.js` (5).

---

Cererea (8 noiembrie 2026):

> 1. Pune un buton „pregătește-mă de examen" în „învățare cu AI" în meniul hamburger
> pe telefon și în meniul hover lateral. Pune butonul și în navbar și în prof virtual,
> înainte de meditații live. Pune-l și în Home, ca un card înainte de toate cardurile.
> Acest buton să amintească zilnic printr-o notificare, utilizatorul să rezolve un
> test. Progresul să se înregistreze cu XP în „arena" și clasament cu alți
> utilizatori, simplu (…), cu promovare și alte modalități de răsplată.
> Se consideră lucru și dacă elevul rezolvă o parte dintr-un test, nu complet. În
> arena să apară ca pe Facebook cine a rezolvat, a promovat, ce subiect, ce
> provocări noi apar, etc., notele să nu apară dacă sunt probleme cu politica de
> confidențialitate.
> 2. după corectare, notează cu roșu nota pe test, scris de mână, de exemplu: 7,30 (șapte ^30)
> 3. pune o notă chiar dacă se rezolvă doar câteva exerciții doar de la un subiect.
> Trece nota și lasă posibilitatea să se revină și să rezolve din nou. Nota să apară
> în statistici la „rezultate elevi"
> 4. fă mai mică secțiunea albastră din „Home", ca o bară orizontală. Sub ea mare pune
> cardul: pregătește-mă de examen

---

## 1. Instalare (o singură dată)

1. **Supabase → SQL Editor → New Query** → rulează `supabase/pregatire_zilnica.sql`
   (idempotent). Creează:

   | Ce | Pentru ce |
   |---|---|
   | `daily_tests` | un rând pe elev pe zi: examenul, testul zilei, câte exerciții a lucrat, cel mai bun procent, nota (privată), XP-ul primit |
   | `arena_feed` | fluxul Arenei (cine a lucrat, a promovat, serii, insigne, dueluri, turnee, provocări) — **fără note** |
   | `user_stats.prep_*` | examenul ales, formatul (interactiv / PDF), amintirea (pornită, ora, ziua trimisă) |
   | `user_stats.arena_public` | dacă elevul apare în fluxul Arenei (implicit da) |

   Ambele tabele au **RLS + GRANT** (`authenticated`, `service_role`, fără `anon`),
   ca în `CLAUDE.md`. Elevul își poate citi doar rândurile lui din `daily_tests`;
   `arena_feed` se citește doar prin API (care scurtează numele și respectă opt-out-ul).

2. Dependență nouă: `@fontsource/caveat` (fontul de mână al notei cu roșu, servit din
   site, nu de pe CDN). Vercel o instalează singur la build, din `package.json` /
   `package-lock.json`; `npm install` trebuie doar pentru rularea locală.

3. **Vercel** — cronul nou e deja în `vercel.json`:
   `/api/gamificare?action=cron-pregatire`, la fiecare oră (minutul 8), cu `CRON_SECRET`.

4. Opțional: `PREGATIRE_PRAG_ITEMI` (implicit **3**) — de la câte exerciții lucrate
   se bifează ziua. Ora alertei de serie e aceeași ca la misiune (`MISIUNE_SERIE_ORA`, 20).

Fără SQL, site-ul merge normal: pagina spune elevului că „Pregătește-mă" pornește în
curând (adminul vede ce script lipsește), iar salvarea scorurilor nu e atinsă.

---

## 2. Unde e butonul

| Loc | Ce apare |
|---|---|
| Meniul de pe telefon (☰) și meniul lateral (hover) | primul link din „Învățare cu AI": **🎯 Pregătește-mă de examen** (auriu) — `src/lib/meniu.js` → `PREGATESTE_MA` |
| Bara de sus (navbar) | primul link: **🎯 Pregătește-mă**; sub 1200px doar 🎯 (numele întreg în title). Lățimile au fost măsurate în Chromium ca „⭐ Contul meu" să rămână pe un rând; sub 1200px și „🔍 Caută" rămâne doar 🔍 |
| Profesorul Virtual (fereastra din colț) | **🎯 Pregătește-mă de examen** · „un test pe zi · XP · ligă", chiar înainte de „Meditații live" |
| Pagina Profesorul Virtual | fila 🎯 înaintea „Meditații" (deschide `/pregateste-ma`) |
| Home | secțiunea albastră e acum o **bară subțire** (titlu + butoane pentru vizitatori); imediat sub ea, **mare**, cardul „Pregătește-mă de examen", înaintea tuturor cardurilor |
| Arena | un card spre `/pregateste-ma` sus, apoi fluxul „📣 Ce se întâmplă în Arenă" |
| Indicatorul Arenei din bară | **📝** cât testul de azi te așteaptă (ca 🎯 pentru misiune) |

---

## 3. Cum merge (`/pregateste-ma`, `api/_lib/pregatireZilnica.js`)

- **Primul pas**: elevul își alege examenul — Evaluarea Națională, BAC Mate-Info,
  BAC Științele Naturii, BAC Tehnologic (sugestia vine din „Planul meu", dacă există).
  Se poate schimba oricând („Evaluarea Națională ✎").
- **Testul zilei**: un test din site al examenului ales, în ordinea „drumului":
  întâi cele nerezolvate, apoi cele sub 70%, apoi recapitulare. Fără abonament doar
  cele gratuite; baremele nu apar niciodată. **🔀 Alt test** trece la următorul.
- **Formatul**: 🧩 interactiv (corectat pe loc) sau, cu **Premium**, 📄 **PDF ca la
  examen** (subiecte oficiale: variante, simulări, teste de antrenament). La EN, PDF-ul
  pornește direct „✏️ Rezolvă pe PDF"; la BAC deschide foaia de lucru.
- **Ziua se bifează de la 3 exerciții lucrate** — în **orice** test de examen (nu doar
  cel al zilei) și **fără să-l termine**: salvarea automată de la jumătate a testelor
  interactive (`api/ai-score.js`), corectarea pe PDF (`api/rezolva-pdf.js`), foaia /
  formularul (`api/ai-correct.js`), scrisul de mână (`api/ai-handwriting.js`).
  Sub 3: „încă 2 exerciții și ziua e bifată".
- **Răsplata** (o dată pe zi, prin `xp.bonus` — deci și puncte în **liga săptămânii**,
  cu plafonul zilnic): **25 XP + 5 🪙**; **+10 XP** la 80% sau mai mult (scor
  verificat); la fiecare **7 zile la rând** încă **40 XP + 15 🪙**.
- **Seria** 🔥 (zile la rând), săptămâna L M M J V S D, recordul, totalul de zile.
- **Insigne**: 📝 Prima zi de pregătire · ✅ Test complet · 🔥 O săptămână de pregătire ·
  🎓 10 zile · 🗓️ O lună fără pauză · 🏅 50 de zile (în `user_badges`, descrise în
  „Contul meu").
- **Promovarea**: liga săptămânală din Arena (Bronz → … → Maestru), cu promovare la
  final de săptămână — XP-ul testului zilei intră acolo.
- În vizualizator: insigna „📝 TESTUL ZILEI" și, la bifare, felicitarea cu XP-ul și seria
  (`src/components/PregatireToast.jsx`).

API (`/api/gamificare`): `pregatire` (starea + atribuirea testului de azi),
`pregatire_alege` (`{ examen, format }`), `pregatire_alt_test`, `pregatire_notificari`
(`{ on, ora, subscription, unsubscribe }`), `pregatire_notificari_proba`;
`state` întoarce și `pregatireAzi` (cardul din Home / Arena, indicatorul 📝).

---

## 4. Amintirea zilnică (`api/_lib/pregatireNotificari.js`)

- Pe pagină: **„🔔 Vrei să-ți amintesc de testul zilei?"** — ora (8:00–21:00, implicit
  **18:00**), „🔔 Amintește-mi" / „Nu, mulțumesc"; pornită: „Trimite o probă", „Oprește".
- La ora aleasă, **doar dacă ziua nu e bifată**: „📝 Testul zilei · seria ta: N zile 🔥"
  cu titlul testului; clicul deschide direct testul.
- Seara la 20:00, cine are o serie de cel puțin 2 zile și n-a lucrat: „🔥 Seria ta de N
  zile de pregătire se pierde la noapte".
- Aceleași reguli ca la misiunea zilnică: Web Push (chei VAPID, `push_subscriptions`),
  altfel clopoțelul 🔔 (tipul `pregatire`); cel mult o amintire + o alertă pe zi
  (revendicate atomic); nimic 22:00–8:00; nimic cui a oprit notificările din cont.

---

## 5. Fluxul Arenei — „ca pe Facebook", fără note (`api/_lib/arenaFeed.js`)

Cardul **📣 Ce se întâmplă în Arenă** (`src/components/ArenaFeed.jsx`), sus în `/arena`:

| Ce | Exemplu |
|---|---|
| a lucrat la testul zilei | „Ana P. a lucrat azi la Subiectul I și Subiectul al II-lea · Evaluarea Națională" |
| test complet | „Matei R. a rezolvat un test complet · Evaluarea Națională" |
| promovare în ligă | „Bogdan I. a promovat în Liga Argint" |
| serie | „Ioana D. are o serie de 7 zile de pregătire pentru examen" (la 3, 7, 14, 21, 30… zile) |
| insignă, nivel | „… a primit insigna „O săptămână de pregătire"", „… a ajuns la nivelul 5" |
| duel, turneu | „… a câștigat un duel", „… a terminat pe locul 2 în „Turneul săptămânii"" |
| provocări noi | „Turneu nou: …", „Provocarea bonus de azi: …" |

**Confidențialitatea** (și în Politica de confidențialitate, secțiunea 3):
- **niciodată note, punctaje, procente sau XP** — câmpurile permise sunt o listă albă
  (`CAMPURI`); orice altceva e aruncat înainte de salvare;
- doar **prenumele și inițiala** („Ana P."); propria activitate apare ca „Tu";
- fără adversarul duelului și fără scor; câștigătorii doar din turneele **publice**
  (nu din cele ale unei grupe/clase);
- elevul poate ieși oricând din flux: căsuța **„Apar în activitatea Arenei"**
  (`user_stats.arena_public`); atunci nu mai apare la alții (își vede în continuare
  activitatea).

---

## 6. Nota cu roșu, scrisă de mână (`RezolvarePdf.jsx`, `src/lib/pdfRezolvare.js`)

- După **✅ Corectează**, pe **prima pagină** a testului apare nota, cu roșu, în fontul de
  mână Caveat, ușor înclinată și subliniată: **7,30 (șapte³⁰)** — cifrele, apoi în
  paranteză numele notei în litere, cu sutimile în exponent (`notaScrisa`).
- Locul: sus, în dreapta, **unde nu e text** — se caută primul loc liber de sus în jos,
  pe baza rândurilor citite din PDF (`cutiiText` / `pozitieNota`), ca nota să nu acopere
  antetul subiectului.
- Dacă elevul schimbă rezolvarea după corectare, nota rămâne, estompată („veche"),
  până la o nouă corectare.
- **⬇ PDF-ul cu rezolvarea** poartă aceeași notă (imagine PNG cu transparență, pe pagina 1).

## 7. Notă și pentru o parte de test (`api/rezolva-pdf.js`)

- Nota se calculează la **orice** corectare cu puncte, chiar dacă elevul a lucrat doar
  câteva exerciții de la un singur subiect: ce n-a rezolvat încă are 0 puncte
  („📝 Nota **2,30** e pe testul așa cum e acum…"). Poate reveni oricând: rezolvă mai
  departe și apasă din nou „Corectează" — nota se actualizează.
- Se salvează de fiecare dată în `progress` (o corectare identică în 30 de minute nu
  mai adaugă o încercare) → apare la „Rezultatele mele" și, pentru profesor, la
  **„Grupe / Rezultate elevi"** (aceeași formulă: 1 + punctele/10).
- XP-ul se dă doar când punctajul crește.

---

## 8. Fișierele

| Fișier | Ce face |
|---|---|
| `supabase/pregatire_zilnica.sql` | tabelele + coloanele (RLS + GRANT) |
| `api/_lib/pregatireZilnica.js` | examenele, testul zilei, bifarea, răsplata, insignele |
| `api/_lib/pregatireNotificari.js` | amintirea zilnică + alerta de serie (cron) |
| `api/_lib/arenaFeed.js` | fluxul Arenei (listă albă, nume scurtate, opt-out) |
| `api/gamificare.js` | acțiunile `pregatire*`, `arena_feed`, `arena_public`, `cron-pregatire`; promovările din ligă intră în flux |
| `api/ai-score.js`, `api/rezolva-pdf.js`, `api/ai-correct.js`, `api/ai-handwriting.js` | lucrul la teste bifează ziua |
| `api/_lib/duel.js`, `api/_lib/turneu.js`, `api/_lib/xp.js` | duelurile câștigate, turneele, nivelurile → flux |
| `src/pages/PregatesteMa.jsx` | pagina `/pregateste-ma` |
| `src/components/ArenaFeed.jsx`, `PregatireToast.jsx` | fluxul, felicitarea |
| `src/pages/Home.jsx`, `Arena.jsx`, `ProfesorVirtual.jsx`, `src/components/Navbar.jsx`, `AITutor.jsx`, `src/lib/meniu.js` | butoanele |
| `src/components/RezolvarePdf.jsx`, `src/lib/pdfRezolvare.js` | nota cu roșu (ecran + PDF descărcat) |
| `test/pregatire-zilnica.test.js` | 30 de teste (logica, Supabase simulat, API, SQL, nota, interfața) |
| `supabase/plan_pregatire.sql` | 13 nov.: coloana `user_stats.prep_plan` (pașii săriți / trecuți, începutul planului) |
| `api/_lib/planPregatire.js` | 13 nov.: harta pregătirii — etapele, cele două hărți, baremele, starea pașilor, pasul curent, sărirea, rezumatul pentru profesori / părinți |
| `src/components/HartaPlan.jsx` | 13 nov.: o hartă (pagina de caiet, pașii, etapele); pagina are două |
| `src/components/HartaPlanRezumat.jsx` | 13 nov.: progresul din hartă în „Rezultate" (profesor, părinte) |
| `api/teacher-students.js` | 13 nov.: `students[].plan` |
| `src/lib/ciornaTest.js` | 13 nov.: răspunsurile de data trecută la testele neterminate |
| `test/plan-pregatire.test.js`, `test/plan-pregatire-pdf.test.js`, `test/rezultate-neterminate.test.js` | 13 nov.: 27 de teste |
