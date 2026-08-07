# Ghid — Task-uri programate + selector de model AI (agentul de exerciții)

Două funcții noi în **Admin → Agent Claude — Generator de exerciții**:

1. **🧠 Selector de model AI** (ca la agentul SEO): Sonnet 5 (implicit), Opus 5,
   **Fable 5** (cel mai nou și mai capabil model Anthropic, iunie 2026),
   Haiku 4.5 (rapid/ieftin) + generațiile anterioare (Sonnet 4.6, Opus 4.8).
   Alegerea se aplică generărilor următoare (inclusiv automatizării pe rubrică).
2. **🗓 Task-uri programate** — echivalentul „Create scheduled task" din
   Claude.ai, dar în loc de folder, **contextul e o rubrică a site-ului**
   (clasă sau tip de examen): agentul generează singur, după program, testul
   următor al rubricii și **îl poate posta automat** acolo.

---

## Instalare (o singură dată)

1. **Supabase → SQL Editor → New Query** → rulează `supabase/agent_tasks.sql`
   (creează `agent_tasks` + `agent_task_runs`; sigur de rulat repetat).
   **Dacă l-ai rulat deja pe versiunea veche, rulează-l DIN NOU** — scriptul
   conține și migrarea (coloanele `extra_rubrics` + `format_model` și opțiunea
   `format` la rezultat) pentru tabelele existente, fără pierdere de date.
2. **Deploy pe Vercel** (git push). `vercel.json` are un cron nou:
   `/api/agent-cron?action=run` — **orar** (`0 * * * *`); Vercel îl preia
   automat la deploy.
3. **Chei API: NU e nevoie de nimic nou.** `ANTHROPIC_API_KEY` deja setată în
   Vercel acoperă TOATE modelele Claude — modelul e doar un parametru al
   cererii (`model: 'claude-opus-5'` etc.). Vezi și secțiunea „Întrebări" de
   mai jos despre Vercel AI Gateway.

Emailurile de după rulări folosesc mailerul existent (`GMAIL_USER` /
`ADMIN_EMAIL` — ca la agentul SEO); dacă mailerul nu e configurat, task-urile
merg oricum, doar fără email.

## Cum creezi un task

Admin → Generator de exerciții → jos, panoul **„🗓 Task-uri programate"** →
**➕ Creează task programat**:

- **Nume** — ex. „Test nou EN în fiecare luni".
- **Contextul — rubrica principală** — aceeași listă ca la automatizarea
  manuală: Evaluare Națională / BAC (pe profiluri) / Clasele 5–8, cu
  subcategorie și tip (PDF / interactiv). Agentul COMBINĂ testele existente
  din rubrică, exact ca butonul „⚙️ Generează (AI)", și tot aici POSTEAZĂ.
- **Context suplimentar (opțional, max 3 rubrici)** — alte rubrici drept
  REFERINȚĂ, ex. rubrica cu BAREMELE testelor: din fiecare, agentul primește
  câteva materiale alese la întâmplare (PDF-urile native, restul ca text) și
  le folosește pentru stilul baremului/punctării și formulările cerințelor —
  NU le combină ca teste-sursă și NU postează în ele. Se adaugă din
  dropdown-ul „➕ adaugă o rubrică drept context…" (apar ca etichete cu ✕).
  Poți lăsa lista goală — o singură rubrică rămâne comportamentul implicit.
- **Programul** — zilnic / săptămânal (ziua) / lunar (ziua lunii) + ora
  (**ora României**; cronul convertește automat, inclusiv ora de vară).
- **Rezultatul** — după rubrică / test interactiv (format standard) / subiect
  structurat / **„După modelul de format (fișierul meu)"**: încarci de pe
  calculator un fișier-model (max 2,5 MB) care se salvează pe server și se
  refolosește la FIECARE rulare:
  - **HTML** → rezultatul CLONEAZĂ exact designul, stilul și funcționalitatea
    fișierului (ca „modelul de format" de la generarea manuală), doar cu
    exerciții noi combinate din rubrică;
  - **PDF** → STRUCTURA testului generat (numărul de itemi, secțiunile, tipul
    itemilor, proporțiile baremului) se potrivește cu modelul, iar conținutul
    vine din rubrică.
  Fișierul apare în listă pe task (🗂) și se poate înlocui/scoate din ✏️ Editare.
- **Instrucțiuni** opționale; **Modelul AI**; regimul datelor
  (păstrează / modifică numerele).

### Metoda de lucru — o alegi în „Instrucțiuni pentru agent"

Agentul înțelege trei metode, per task (fiecare task își păstrează metoda,
modelul AI și modelul de format propriu — pot fi diferite între task-uri):

| Ce scrii în instrucțiuni | Ce face agentul |
|---|---|
| *(nimic special)* sau „**combină modelele din rubrică**" | metoda clasică: combină exerciții din mai multe fișiere ale rubricii într-un test nou |
| „**ia pe rând fișierele rubricii**" (sau „câte un fișier", „unul câte unul", „fiecare fișier") | la FIECARE rulare ia URMĂTORUL fișier neprelucrat din rubrică (cel mai vechi primul) și îl transformă singur într-un test/exercițiu interactiv nou — câte unul per publicare. Progresul se ține minte per task (rândul task-ului arată „pe rând: N/M fișiere procesate"; ↺ resetează). Când toate au fost procesate, rularea raportează „nimic nou de generat" (email ℹ️) — dar dacă adaugi fișiere NOI în rubrică, le prinde automat |
| „**folosește baremele**" (sau „corespondente") + rubrica de bareme adăugată la context | pentru fiecare test-sursă caută singur BAREMUL CORESPONDENT în rubrica de bareme, potrivind titlurile (numerele cântăresc cel mai mult: „Testul 3" ↔ „Barem Testul 3"), și ia din barem răspunsurile, rezolvările și punctajele. Se activează și AUTOMAT când rubrica din context are „barem" în nume. Merge combinat cu „pe rând" |

Sursa „pe rând": PDF → test interactiv structurat (itemii și baremul sursei,
transformate); fișier interactiv → varianta lui nouă (același design și
figuri, alte valori după regimul datelor); cu model de format HTML →
exercițiile sursei turnate în formatul tău.
- **📤 Postează automat** — bifat: materialul apare direct pe site în rubrica
  aleasă (alegi și Gratuit/Premium + Test/Exercițiu). Nebifat: rezultatul
  rămâne în **istoricul task-ului** cu „🕓 așteaptă aprobare" — îl
  previzualizezi și îl publici cu **✅ Postează pe site** (fluxul de aprobare,
  ca la agentul SEO).
- **📨 Email** — după fiecare rulare primești pe emailul de admin: ce s-a
  generat, dacă s-a postat sau așteaptă, ori eroarea.

**▶️ Rulează acum** execută task-ul pe loc (~30–90s) — util ca test imediat
după creare.

## Ce postează pe site

Rezultatul se publică drept **material interactiv** (`content_type:
'interactive'`) în categoria/subcategoria/profilul rubricii — apare pe tab-ul
„interactiv” al rubricii, în viewerul intern, cu raportare de scor
(MATE_SCORE), și în lista „Exerciții încărcate de agent” (reeditabil).
La rubricile PDF, sursele sunt subiectele PDF existente, iar testul rezultat e
tot interactiv (subiect structurat sau format standard). **PDF-uri noi** nu se
pot publica automat (PDF-ul se face în browser, prin fereastra de tipărire) —
pentru PDF rămâne fluxul manual «Adaugă PDF».

**Unde apare exact postarea (important):** paginile Evaluare Națională și
Bacalaureat afișează conținut interactiv doar la anumite subcategorii, așa că
serverul mapează automat subcategoria la una VIZIBILĂ: la EN rămân
`teste-interactive`, `capitole`, `exercitii-subiecte`; la BAC rămân
`teste-interactive`, `capitole`, `exercitii`; rubricile doar-PDF (`variante`,
`simulari`, `bareme`) și mixurile `a+b` publică în **Teste Interactive** (cu
profilul păstrat la BAC). Fără maparea asta, materialul se salva în baza de
date dar nu apărea pe nicio pagină — părea că „nu s-a postat”. La clase nu se
schimbă nimic (paginile claselor nu filtrează după subcategorie).

## Reguli de generare (figuri + completitudine)

- **Figurile geometrice apar DOAR la Evaluare Națională.** La clase și la BAC
  agentul generează fără figuri: promptul cere eliminarea lor, enunțuri
  self-contained (toate datele în text), iar serverul curăță programatic
  SVG-urile/canvas-urile rămase. La EN comportamentul vechi se păstrează:
  figurile șablonului rămân neatinse (restaurate programatic), cu itemii lor.
- **Testele trunchiate nu se mai publică.** Răspunsurile tăiate la limita de
  tokeni se CONTINUĂ automat (până la 3 reluări), documentul trebuie să fie
  complet (`…</html>`), să conțină itemi interactivi și toate secțiunile
  sursei (inclusiv **Subiectul III** — grilă sau completare de răspuns).
  Testele structurate (JSON) cer minim 6 itemi din planul de 10. Dacă tot nu
  iese, rularea se încheie cu EROARE clară (email ⚠️) — nu se mai publică
  teste goale sau fără Subiectul III.

## Cum funcționează în spate

- `supabase/agent_tasks.sql` — definițiile task-urilor + istoricul rulărilor
  (RLS deny-all: doar serverul, cu service role, le atinge).
- `api/agent-tasks.js` — CRUD + „Rulează acum" + aprobarea rulărilor (admin).
- `api/agent-cron.js` — rulează ORAR (Vercel cron). Ia task-urile active
  scadente la ora curentă a României și le execută (max 3 per oră, cu gardă
  anti-dublare de 2h).
- `api/_lib/exgen.js` — logica partajată: `runAuto` (aceeași automatizare pe
  rubrică ca butonul din admin), `renderExerciseHtml` (exercițiu JSON → HTML
  interactiv), `postContent` (Storage + rând în `content`), `runTask`,
  `postRun`, plus emailul de raport.
- Butonul „⚙️ Generează (AI)" din admin folosește ACEEAȘI logică (a fost mutată
  în `exgen.js`), deci comportamentul manual e neschimbat.

## Întrebări (chei API / AI Gateway)

**E nevoie de chei noi în Vercel pentru Opus 5 / Fable 5 / alte modele?**
Nu. O singură `ANTHROPIC_API_KEY` (cea deja salvată) acoperă toate modelele
Claude; modelul se transmite per cerere. Serverul validează ID-ul în
`api/_lib/claude.js → MODELS` (un ID necunoscut cade pe `CLAUDE_MODEL` /
Sonnet 5). Singura condiție: creditul contului Anthropic — Opus 5 (~5$/25$ per
1M tokeni) și Fable 5 (~10$/50$) sunt mai scumpe decât Sonnet 5 (~2-3$/15$).

**E mai bine prin Vercel AI Gateway?**
Nu e necesar. Gateway-ul devine util dacă vrei: modele de la MAI MULȚI
furnizori cu o singură cheie (`AI_GATEWAY_API_KEY`), failover automat,
monitorizarea costurilor în dashboardul Vercel — fără markup la preț și cu
suport pentru formatul Anthropic Messages. Codul actual vorbește direct cu
`api.anthropic.com` (api/_lib/claude.js) și funcționează perfect așa; dacă
vrei cândva gateway-ul, se schimbă doar URL-ul și cheia în acel fișier.

## Depanare

- Panoul afișează „Tabelul agent_tasks lipsește" → rulează
  `supabase/agent_tasks.sql`.
- Task-ul nu a rulat la ora aleasă → verifică-l ÎNTÂI că e 🟢 pornit (un task
  ⏸ oprit nu rulează niciodată singur; rândul lui arată „următoarea: oprit").
  Cronul rulează la minutul 0 (task de ora 7 → rulează 7:00–7:05) și execută
  max 3 task-uri per tic, cu buget de timp — dar există o **fereastră de
  recuperare de 6 ore**: un task ratat la fix (mai multe task-uri la aceeași
  oră, tic pierdut, funcție întreruptă) e prins automat de ticurile
  următoare, până la 6 ore după ora programată. Vercel → Settings → Cron
  Jobs arată execuțiile. Manual: `/api/agent-cron?action=run&secret=AI_CRON_SECRET`.
- Eroare „nu am obținut un document HTML complet (răspunsul s-a întrerupt)" →
  garda de completitudine a refuzat să publice un test neterminat. Serverul
  continuă singur răspunsurile tăiate (până la 6 reluări) și re-cere strict
  documentul dacă modelul răspunde cu explicații; dacă eroarea persistă pe
  task-urile cu model de format MARE + Opus, încearcă Sonnet 5 (mai rapid —
  generările uriașe cu Opus se pot apropia de limita de timp a funcției) sau
  un model de format mai mic. Mesajul include acum diagnosticul
  `[stop=…, continuări=…]`.
- Eroare „Șablonul rubricii e prea mare pentru o singură generare" → nu ar
  mai trebui să apară la rubricile Evaluare Națională: figurile SVG din
  șablon nu se mai copiază de model (primește marcaje `data-tpl-fig`, iar
  serverul pune înapoi figurile originale după generare), deci și șabloanele
  mari (ex. `test_interactiv_1.html`) încap într-o singură generare. Dacă
  totuși apare (șablon uriaș fără figuri), împarte modelul de format sau
  folosește unul mai mic.
- Eroare „Rubrica are prea puține materiale" → rubrica aleasă are sub 2
  materiale de tipul selectat (PDF/interactiv).
- Rulările „🕓 așteaptă aprobare" se păstrează în istoric până le postezi sau
  le ștergi (istoricul ține ultimele 25 pe task).
