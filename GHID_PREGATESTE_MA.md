# 🎯 Pregătește-mă de examen — testul zilei, XP, ligă, fluxul Arenei, nota cu roșu

Cererea (8 noiembrie 2026):

> 1. Pune un buton „pregătește-mă de examen" în „învățare cu AI" în meniul hamburger
> pe telefon și în meniul hover lateral. Pune butonul și în navbar și în prof virtual,
> înainte de meditații live. Pune-l și în Home, ca un card înainte de toate cardurile.
> Acest buton să amintească zilnic printr-o notificare, utilizatorul să rezolve un
> test. Progresul să se înregistreze cu XP în „arena" și clasament cu alți
> utilizatori, simplu ca pe duolingo, cu promovare și alte modalități de răsplată.
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
