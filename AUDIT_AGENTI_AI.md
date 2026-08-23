# 🔍 Audit — agenții AI (Profesor Virtual, Asistent, PDF, teste, corectare)

**Data:** 22 august 2026 · **Stadiul codului:** `api/_lib/ai.js` (22 aug), `ai-meditatii.js` (22 aug), `AITutor.jsx` (21 aug)
**Întrebarea:** „Mai adaug ceva sau agenții sunt într-o formă optimă?"

**Răspuns scurt:** nu sunt „optimi", dar sunt mult peste media platformelor de acest fel — arhitectura e matură
(doi agenți separați, barem = sursă de adevăr, verificare de fidelitate, pre-generare, bugete în bani, memorie
pedagogică). Ce lipsește NU sunt funcții noi de tip „încă un tab", ci **trei lucruri de fond**: (1) modelul nu
vede niciodată pagina PDF, doar un text extras cu euristici; (2) nicăieri nu există verificare matematică
programatică — corectitudinea testelor generate și a explicațiilor e lăsată exclusiv pe seama modelului;
(3) scorurile, baremul și cheile de răspuns pot fi manipulate din browser. Plus câteva găuri de UX în chat
care se văd zilnic (erorile nu se afișează deloc, nu poți opri/relua un răspuns).

Mai jos: ce e deja bine (ca să nu refaci), apoi îmbunătățirile, în ordinea în care le-aș face, fiecare cu
fișier:linie, motiv și efort. La final, un plan pe 3 etape.

---

## 0. Ce e deja bine — NU reimplementa

| Ce | Unde |
|---|---|
| Doi agenți cu persona proprie; agentul PDF cu barem ca sursă de adevăr, prompt FOCALIZAT pe itemul întrebat | `ai.js:1044-1142, 1457-1562` |
| Localizare DETERMINISTĂ a itemului din barem („III 2 b" → fragment + enunț), cu AI doar ca rezervă | `ai.js:1226-1283`, `barem.js:400-565` |
| Verificare de fidelitate a răspunsului față de barem (numeric + semantic + grilă), reîncercare, fallback | `ai.js:1573-1728` |
| Asociere test ↔ barem în 3 trepte (metadate → antet → conținut), „mai bine niciun barem decât unul greșit" | `ai-pdf-context.js:69-152`, `barem.js` |
| Reconstrucție text PDF: exponenți, indici, fracții etajate, săgeți de vector | `pdftext.js:14-258` |
| Prompt ordonat pentru caching (static → dinamic) | `ai.js:629-641` |
| Bugete în bani, cote per rol cu pool comun, top-up, degradare pe model ieftin, alerte de cost | `ai.js:57-255, 678-900`, `costwatch.js` |
| Explicații pre-generate (cost 0, latență 0) cu invalidare pe hash | `pregen.js` |
| Memorie pedagogică injectată în chat + generatoare; marcaje `[[MEDITATII]]` validate | `ai.js:972-1034`, `ai-meditatii.js:218-226` |
| Motor de continuare pentru HTML lung (prefill → mesaj, anti-buclă, gardă de completitudine) | `exgen.js:92-184, 263-412` |
| Chei de răspuns scoase din răspunsurile API; corectare deterministă la grile; mastery în paralel | `ai-meditatii.js:84-123` |
| Streaming NDJSON, istoric, feedback 👍/👎, voce (STT/TTS), foto → text, formular „Răspunde în chat" | `AITutor.jsx`, `aiClient.js` |

---

## 1. CORECTITUDINE MATEMATICĂ — prioritatea reală

### 1.1 Trimite modelului PAGINA PDF (text + imagine), nu doar textul extras ⭐⭐⭐

**Acum:** agentul PDF și corectarea lucrează pe `pdf-parse` + euristici geometrice (`pdftext.js:14-258`), iar
promptul conține paragrafe întregi care învață modelul să GHICEASCĂ ce s-a pierdut: radicali, vectori,
fracții, figuri (`ai.js:1065-1070`, `1104`, `1141`, `ai-correct.js:328`). Exact clasa de erori pe care o
rezolvi de luni de zile în CHANGELOG (22 aug EN, 16 aug fracții, vectori „uuur").

**Ce s-a schimbat la furnizori:** ambele API-uri pe care le folosești acceptă PDF-ul ca atare și trimit
modelului **și textul, și imaginea fiecărei pagini**:
- OpenAI Chat Completions: content part `{ type: 'file', file: { filename, file_data: 'data:application/pdf;base64,…' } }`
  (sau `file_id` din Files API); pe Responses API `input_file` cu `detail: low|high`. Necesită model cu vedere
  (gpt-4o+; terra/sol sunt) — exact endpointul `/chat/completions` pe care îl ai deja în `postLLM`.
- Claude: bloc `{ type: 'document', source: { type: 'base64' | 'url' | 'file' } }`, compatibil cu prompt
  caching (`cache_control`) și citări. Îl folosești deja în `exgen.js:497, 617` — doar pentru admin.

**Propunere (păstrezi tot ce ai):**
1. La deschiderea unui PDF, pe lângă `text`, serverul randează paginile relevante (sau trimite PDF-ul întreg
   o singură dată, cu caching) — **modelul vede figura, radicalul, săgeata**.
2. Localizarea deterministă a itemului de barem rămâne pe text (e ieftină și sigură); în promptul focalizat
   adaugi imaginea paginii cu exercițiul (1 pagină ≈ 1.500–3.000 tokeni text + imagine).
3. La corectare (`ai-correct.js`), elevul poate fotografia/încărca **rezolvarea scrisă**, nu doar să tasteze
   răspunsuri — astăzi `ai-vision` transcrie DOAR enunțul (`ai-vision.js:33-45`), iar lucrarea se introduce
   manual în textareas.
4. Cost: un test de 4 pagini ≈ 10–15k tokeni de intrare; cu caching (prefixul e identic pe toată conversația)
   plata repetată scade drastic. Ține `AI_PDF_MAX_PAGES` și trimite doar paginile itemului când conversația
   e focalizată.

**Efort:** mediu (2–4 zile). **Impact:** elimină cea mai mare sursă de explicații greșite + dezbloc
corectarea lucrărilor scrise de mână.

### 1.2 Structured Outputs (json_schema strict) în loc de `json_object` + reparații de LaTeX ⭐⭐⭐

**Acum:** toate pipeline-urile JSON folosesc `response_format: {type:'json_object'}` (`ai.js:285`) sau, pe
Claude, nimic (`claude.js:53-58`) — schema e impusă doar prin text. Consecințe verificate:
- `\f \t \b` din LaTeX devin caractere de control la `JSON.parse`; `restoreLatex` repară doar 3 dintre ele
  (`ai-exam.js:15-22`) — `\neq`, `\rho`, `\right`, `\underline` rămân corupte sau dau 502 (`ai-exam.js:30-34`).
- Trei implementări paralele de „reparare": `lenientParse`/`deepRestore` (`ai-exam.js`), `fixLatex`
  (`meditatii.js:592-605`), `extractJson` + `closeAndParse` (`claude.js:174-213`), plus `fixLatexClient`
  (`Meditatii.jsx:33`).
- `Number(q.answer) || 0` (`ai-generate-interactive.js:194`): un `answer: "b"` devine tăcut indexul 0 → cheie greșită.

**Ce s-a schimbat la furnizori (verificat azi):** pe OpenAI `response_format: { type:'json_schema',
json_schema:{ name, schema, strict:true } }` (gpt-4o-mini, gpt-5.x); pe Claude `output_config: { format: {
type:'json_schema', schema } }` — **GA, fără header beta**, pe Sonnet/Opus/Fable 5, Haiku 4.5. Decodarea e
constrânsă gramatical: JSON-ul e garantat valid, backslash-urile ies escapate corect, `answer` poate fi
`enum: ["a","b","c","d"]`, `topic` poate fi `enum` din taxonomia ta (vezi 5.1).

**Unde:** `ai-exam`, `ai-generate-interactive`, `ai-practice`, `ai-correct` (form + grade), `extractBaremItem`,
`semanticCheck`, `classifyMistakes`, `genQuestions` (meditații), `exgen` (ramurile JSON). Apoi ștergi
reparațiile. Atenție la `finish_reason: 'length'` și la câmpul `refusal` (OpenAI).

**Efort:** mic–mediu (1–2 zile, o funcție `chatJson({schema})` în `ai.js` + migrare). **Impact:** dispare o
întreagă clasă de 502-uri și de chei corupte.

### 1.3 Verificare matematică PROGRAMATICĂ a testelor generate și a corectării ⭐⭐⭐

**Acum:** nicăieri nu există CAS, recalculare independentă sau vot de consistență — doar „verifică-ți
calculele de două ori" în prompt (`exgen.js:746, 813, 908`, `pdftext.js:281`, `meditatii.js:554`).
`ai-exam` validează doar „≥1 subiect și ≥1 item" (`ai-exam.js:403-407`): sume de puncte ≠ 30/subiect, itemi cu
3 variante, `answer:"e"`, geometrie la Subiectul I, `figure` invalid — toate trec. Cheile generate ajung
„răspuns oficial" direct în site (`exgen.js:1288-1319`). La runtime, HTML-ul generat compară răspunsul elevului
prin egalitate de string (`exgen.js:1148, 1194, 1237`): `1/2 ≠ 0,5`, `x=3 ≠ 3`, `2√3 ≠ 2\sqrt{3}`; la fel
`gradeAnswers` (`ai-meditatii.js:93-113`) — greșeli false care apoi intră în jurnalul de greșeli și în mastery.

**Propunere, în trei straturi ieftine:**
1. **Validare structurală deterministă** (cod, 0 cost): puncte/subiect = 30, oficiu 10, 4 opțiuni, răspuns în
   enum, fără figuri unde nu sunt permise, LaTeX parsabil (KaTeX în Node, `throwOnError:true`), fără duplicate
   de enunț față de ultimele N generări (hash normalizat).
2. **Re-rezolvare independentă** (1 apel ieftin per item sau per test): un „verificator" primește DOAR
   enunțul (fără rezolvare) și întoarce răspunsul final în JSON; dacă diferă de cheia generatorului → itemul
   se regenerează (max 2 runde) sau se marchează „nesigur". Pentru grile, acuratețea crește mult; pentru
   itemii „Arătați că…", verificatorul confirmă doar că enunțul e consistent.
3. **Echivalență algebrică** pentru comparații de răspunsuri: `mathjs` (Node, fără servicii externe) — parsezi
   ambele expresii, compari numeric pe câteva valori aleatoare ale variabilelor / `simplify`. Înlocuiește
   egalitatea de string din `exgen` runtime, `gradeAnswers` și „Acceptă forme echivalente" din promptul de
   corectare (`ai-correct.js:327`). Pentru geometrie/demonstrații rămâne modelul.

**Efort:** mediu (3–5 zile). **Impact:** cel mai mare pe încredere — un test cu cheie greșită publicat pe
site costă mai mult decât toate tokenii la un loc.

### 1.4 Modelul din chat-ul principal ⭐⭐

**Acum:** `CHAT_MODEL` implicit `gpt-4o-mini` (`ai.js:17`; `AI_STACK` confirmă că așa rulează), cu RAG care —
vezi 1.5 — aduce doar titluri. Pentru explicații matematice la minori, 4o-mini e modelul care greșește cel
mai des la calcule cu mai mulți pași. Ai deja în tabelul de prețuri `gpt-5-mini` (0,25/2 USD/1M) — cu
`reasoning_effort: low` costul rămâne în aceeași zonă, iar acuratețea crește vizibil. Ține 4o-mini pe coach
(`ai-meditatii.js:235`), pe `semanticCheck` și pe `assistant`/`exams`/`students` (întrebări de platformă).

**Cum decizi corect:** cu setul de evaluare din 3.3 — fără el, orice schimbare de model e pe ghicite.
**Efort:** o variabilă de mediu + eval. **Impact:** mare pe calitatea percepută de elev.

### 1.5 RAG-ul indexează doar TITLURI pentru PDF-uri și exerciții interactive ⭐⭐

**Acum:** `buildChunks` pune în `ai_knowledge` doar `Tip: pdf. Categorie: X. titlu — descriere` pentru
PDF-uri și interactive (`ai-ingest.js:75-80`); doar manualele au corp de text, tăiat în felii fixe de 1.100
caractere fără suprapunere (`53-59`). Deci blocurile „EXEMPLE REALE DIN SITE" (`ai-exam.js:164`,
`meditatii.js:532`, `ai-practice.js:51`) conțin titluri, nu exerciții — generatoarele își iau modelele din
eșantionare aleatoare de `content` (`ai-exam.js:261-322`), nu din RAG. Promisiunea din `INTEGRARE_AI.md`
(„orice exercițiu… e indexat") e doar parțial adevărată.

**Propunere:** la ingest, extrage textul PDF-ului (ai deja `pageRenderer`) și enunțurile din HTML-ul
interactiv (`PROBS/ST`, pe care `tutorBridge` le citește oricum) → chunk-uri pe EXERCIȚIU (nu pe 1.100
caractere), cu `topic` ales dintr-o taxonomie fixă; căutare **hibridă** (vector + `tsv` cu RRF, nu lexical doar
ca fallback — `ai.js:500-519`), `unaccent` pentru diacritice, prag de similaritate. Folosește `content_hash`
(calculat dar necomparat, `ai-ingest.js:140`) ca să nu re-embed-ezi la fiecare `sort_order`.

**Efort:** mediu (2–3 zile). **Impact:** exemple reale în generatoare, context real în chat, cost mai mic.

---

## 2. SECURITATE & INTEGRITATEA SCORURILOR

### 2.1 Scoruri, barem și text de test declarate de client ⭐⭐⭐

- `ai-correct` primește din browser `testText`, `baremText`, `items[].puncte`, `context.contentId`
  (`ai-correct.js:295-303`). Punctajele oficiale se forțează DOAR când baremul lipsește (`:148`, `hasBarem` =
  orice string > 80 caractere, `:300`); `verdict:'corect'` ⇒ punctaj maxim (`:366`). Rezultatul intră în
  `progress` pentru `contentId` ales (`:389-396`) → apare la profesor și părinte. Un elev poate fabrica 100%.
- `session_score` și `homework_score` acceptă `{score, maxScore}` din browser (`ai-meditatii.js:163-178`,
  `1221-1270`) și de acolo: capitol „finalizat", mastery, recapitulări, notă prezisă, notificare părinți.
  Comentariul din schemă „notele nu pot fi falsificate din browser" (`meditatii_schema.sql:167-170`) nu se
  mai susține pe aceste două căi.

**Propunere:** (a) serverul recitește testul și baremul după `contentId` (din cache-ul de la 3.1), nu din
body; (b) la exerciții interactive, viewerul trimite RĂSPUNSURILE, serverul recalculează scorul (cheile sunt
în HTML-ul pe care serverul îl are) — sau măcar semnezi scorul în iframe cu un token de sesiune.

### 2.2 Cheile de răspuns ale quiz-urilor active sunt citibile prin RLS ⭐⭐

`payload.questions[].answer/explanation` stă în `ai_meditatii_sessions` / `ai_meditatii_homework`
(`ai-meditatii.js:605-608`), iar politica `medsess_own_read` dă SELECT pe tot rândul (`meditatii_schema.sql:
188-191, 197-200`). `sanitize()` protejează doar răspunsul API; un `supabase.from('ai_meditatii_sessions')
.select('payload')` din consolă arată cheia. **Propunere:** mută răspunsurile într-o coloană/tabelă fără
politică de citire pentru elev (sau un `view` care exclude `payload`).

### 2.3 Mărunte, dar reale

- Tokenul exercițiilor `practice` nu expiră (`ai-practice.js:86`; `signToken` fără ttl) → pune 24h.
- Răspunsurile elevului sunt interpolate nelimitat în **system prompt** (`ai-practice.js:129-130`,
  `ai-assignment.js:228-229`) → mută-le în mesajul user, între delimitatori, cu limită de lungime.
- `ai-assignment.js:239-262`: un JSON invalid de la model se salvează ca rezultat real `score 0`.

### 2.4 Contabilitate de cost: Opus 5 din meditații e logat cu cost 0 ⭐⭐

`toUsage()` pierde `model` (`meditatii.js:583`) → `logUsage` primește `{in,out}` fără model → `priceFor('')`
→ cost 0 (`ai.js:117-119, 136-138`). Toate generările Opus din meditații (evaluare, exerciții, remediere,
recapitulare, simulare) NU intră în bugetele soft/hard/lunar — exact cele mai scumpe apeluri (5/25 USD/1M).
Temele generate (`ai-meditatii.js:1068-1082`, inclusiv cron) nu loghează deloc. `GHID_LIMITE_AI.md:109-110`
spune contrariul. **Fix:** `toUsage` returnează și `model: r.provider`; adaugă `logUsage` la teme. 10 minute.

### 2.5 Consistență cu Politica de Confidențialitate ⭐

`AI_STACK.intern` afirmă public că modelele Anthropic sunt folosite doar în unelte administrative și „nu
primesc întrebările… sau datele personale ale utilizatorilor" (`aiModels.js:41-49`). Însă generatorul de
meditații rulează pe `claude-opus-5` (`meditatii.js:20, 563`) pentru elevi, iar promptul de remediere include
răspunsul greșit al elevului (`:521`). Fie muți generarea pe `GEN_MODEL` (OpenAI), fie actualizezi textul
public și §7–8 din politică. Nu e o urgență tehnică, dar e o promisiune publică.

---

## 3. ARHITECTURĂ & PERFORMANȚĂ

### 3.1 Cache pentru textul PDF + asociere test ↔ barem persistată ⭐⭐

**Acum:** la fiecare deschidere de PDF se descarcă și se parsează testul + până la 8 bareme-candidat
(`ai-pdf-context.js:30, 123-133`); `ai-exam` descarcă și parsează 5–7 PDF-uri aleatoare la fiecare generare
(`ai-exam.js:307-316`); tot textul + baremul se retrimit din browser cu fiecare mesaj (`PDFViewer.jsx:371-375`).

**Propunere:** tabelă `ai_pdf_text(content_id, file_hash, text, pages, barem_id, barem_status, extracted_at)`
umplută din coada de ingest pe care o ai deja (`ai_ingest_queue`); asocierea test↔barem se calculează O DATĂ
și adminul o poate confirma/suprascrie din panou (un select „Barem asociat" la PDF). Chat-ul trimite doar
`contentId`; serverul ia textul/paginile din DB. Rezolvă și 2.1(a), și latența la deschidere.

### 3.2 Tutorele ca agent cu unelte, în loc de regex-uri și marcaje ⭐

Azi „acțiunile" sunt marcaje în text parsate cu regex (`[[ACTIUNE]]`, `[[MEDITATII]]`, `ai.js:1285-1290,
957-966`; `tutorBridge.js:555-562` — regexul cade dacă JSON-ul conține `]`), iar localizarea
exercițiului/baremului e un pipeline de euristici. Ai deja bucla de unelte pentru Claude
(`claude.js:120-170`). Cu tool calling (disponibil și pe OpenAI chat completions) tutorele poate apela
`get_exercise(ref)`, `get_barem_item(ref)`, `calculate(expr)` (mathjs), `fill_answer(...)`, `start_meditatii(...)`
— rezultate structurate, fără ghicit. Nu e urgent; e direcția curată când reatingi zona.

### 3.3 Set de evaluare (golden set) + regresie pe 👎 ⭐⭐⭐ (cel mai ieftin lucru cu cel mai mare efect)

Ai 236 de teste unitare, dar NICIUN test de CORECTITUDINE MATEMATICĂ a ieșirilor AI. Propunere: 100–150 de
itemi reali (EN + BAC, cu răspunsul oficial din barem) într-un `test/eval/*.json`; un script `npm run eval`
care rulează tutorele (mod „răspuns complet"), generatorul și corectarea pe ele și raportează acuratețea per
model/prompt. Fiecare 👎 din `ai_feedback` cu notă devine un caz nou. Abia cu asta poți decide 1.4, schimba
prompturi fără frică sau trece de la terra la altceva când apare un model nou.

---

## 4. UX CHAT — ce se vede zilnic (toate verificate în cod)

| # | Problemă | Unde | Fix |
|---|---|---|---|
| 4.1 | **Erorile nu se afișează niciodată**: `error` e setat în 8 locuri (foto, mic, formular, „completează măcar un răspuns") dar nu e randat nicăieri | `AITutor.jsx:243, 337-346, 353, 392, 589, 607-622` | un rând de eroare sub input |
| 4.2 | Nu există **Oprește / Regenerează / Reîncearcă**; fără `AbortController` în tot `src/`; inputul se golește la trimitere, un mesaj eșuat se retastează | `aiClient.js:42-75`, `AITutor.jsx:419, 447-449` | AbortController + buton „Oprește", „Regenerează" pe ultimul răspuns |
| 4.3 | LaTeX brut în timpul streaming-ului (KaTeX doar la `done`); fără liste/tabele markdown | `AITutor.jsx:104-108, 808, 65-83` | randare incrementală pe paragrafe complete; markdown minimal |
| 4.4 | Poza nu ajunge la model — doar transcrierea; imaginea nu rămâne în conversație; textul pozei ÎNLOCUIEȘTE contextul PDF-ului | `AITutor.jsx:424, 584, 965-989` | mesaj cu imagine (vision) + miniatură; păstrează ambele contexte |
| 4.5 | Modelul încheie cu „Reformulez mai simplu sau mai detaliat?" dar UI-ul nu are **chips de follow-up**; butoanele de mod au fost eliminate | `AITutor.jsx:127-129, 238`; `ai.js:1094` | chips: mai simplu / mai detaliat / alt exemplu / dă-mi răspunsul / verifică-mi pașii |
| 4.6 | Fără grafice de funcții / figuri în chat; `figureRender.js` e folosit doar la print | `figureRender.js`, `examPrint.js` | reutilizezi DSL-ul de figuri din `ai-exam` în chat (`[[FIGURA:{...}]]` sau tool) |
| 4.7 | Widgetul nu are context pe paginile generice (`{}`) și lipsește complet pe `/exercitiu-ai` | `AITutor.jsx:1133`; `App.jsx:56` | trimite `{page, category}`; montează ChatPanel în `ExercitiuAIViewer` |
| 4.8 | Curse: `coachInject`/corectare scriu în mesajul greșit în timpul streaming-ului; schimbarea conversației mid-stream; auto-prompt retrimis la redeschidere | `AITutor.jsx:401-409, 481-486, 508-514, 469-475, 1119-1129` | id de mesaj țintă pentru `patchLast`; dezactivează istoric/nou cât timp `streaming` |
| 4.9 | PDF scanat / fără barem: elevul nu e anunțat (avertismentul merge doar la model) | `PDFViewer.jsx:373, 578` | banner „PDF scanat — fotografiază exercițiul" / „fără barem — răspunsurile nu sunt verificate după barem" |
| 4.10 | Parserul NDJSON pierde ultima linie neterminată → mesaj rămas în `streaming` | `aiClient.js:59-64` | flush `buf` la `done` |
| 4.11 | Accesibilitate: fără `aria-live` pe răspunsuri, bară de seek fără tastatură; auto-scroll fără gardă când elevul a derulat în sus | `AITutor.jsx:397-399, 860-871` | |
| 4.12 | Cod mort / text vechi: `PracticeTab`, `StatCard`, „tabul Antrenament", comentariul despre TTS server, FAQ promite ștergerea conversațiilor (nu există) | `ProfesorVirtual.jsx:111, 919-922, 960`; `AITutor.jsx:253-255`; `FAQ.jsx:49` | |

---

## 5. PEDAGOGIE (Meditații) — de rafinat, nu de refăcut

- **5.1 Taxonomie fixă de topicuri.** `topic` e un slug inventat de model la fiecare generare
  (`meditatii.js:548`) și devine cheia din `ai_skill_mastery` → aceeași competență apare sub 5 nume, iar
  predicția notei și rapoartele fac media peste fragmente. Cu structured outputs (1.2) pui `topic` ca `enum`
  din `CURRICULUM`/`capitole.js`. O zi de muncă, efect pe toate rapoartele.
- **5.2 Nivelul nu se recalculează** niciodată după evaluarea inițială (`ai-meditatii.js:648`), iar
  `nextStep: harder/easier` e doar etichetă — clientul trimite mereu `difficulty:null`
  (`Meditatii.jsx:656-657, 760, 864`). Un EMA pe ultimele 3 seturi + dificultate efectivă în cerere.
- **5.3 Recapitulările** folosesc itemi noi, nu itemii greșiți; scară fixă 1/7/30 zile fără factor de ușurință
  (`meditatii.js:709-713`, `ai-meditatii.js:1382-1386`). Un SM-2 simplificat pe ITEM (greșelile din
  `ai_meditatii_mistakes` sunt deja acolo) ar fi mai „inteligent" decât „repetiție inteligentă" de acum.
- **5.4 Teme off-topic:** `pickAndAssignHomework` apelează `siteInteractiveFor` fără `minMatch`
  (`ai-meditatii.js:1051-1055`) → când niciun titlu nu se potrivește, tema primește ORICE test nefăcut din
  categorie, etichetat cu capitolul. Exercițiile folosesc corect `minMatch:true` (`:812`).
- **5.5 Mastery:** EMA cu un singur parametru (`ai_tutor_schema.sql:147-152`), fără uitare în timp și fără
  dificultatea itemului. Un BKT simplu (4 parametri) e o după-amiază și dă „probabilitate de stăpânire"
  interpretabilă pentru profesor.

---

## 6. Plan sugerat

**Etapa 1 — o săptămână, fără funcții noi, efect imediat:** 2.4 (cost Opus, 10 min) · 4.1 + 4.10 + 4.2
(erori, flush, Oprește/Regenerează) · 1.2 (structured outputs pe toate JSON-urile) · 2.1 (server recitește
test/barem după `contentId`; scorul interactiv recalculat pe server) · 2.2 (payload fără chei) · 2.3.

**Etapa 2 — 2–3 săptămâni, corectitudine:** 3.3 (golden set + `npm run eval`) → 1.3 (validare structurală +
verificator independent + mathjs) → 1.1 (pagina PDF la model; lucrări scrise de mână la corectare) → 1.4
(decizi modelul de chat pe baza eval-ului) → 3.1 (cache PDF + asociere barem persistată).

**Etapa 3 — când reatingi zona:** 1.5 (RAG pe conținut real, hibrid) · 5.1–5.5 · 4.4–4.7 · 3.2 (tool calling)
· 2.5 (politica de confidențialitate) · ce a rămas din etapele 1–2: recalculul pe server al scorurilor testelor
HTML (2.1), Structured Outputs pe `ai-exam` (DSL-ul figurilor) și pe `exgen`/`ai-exercise-agent` (1.2).

> **Stare (23 august 2026):** Etapele 1, 2 și 3 sunt implementate — vezi `CHANGELOG-REPARATII.md`,
> intrările „22 august 2026 (5)”, „(6)” și „23 august 2026”. Decizia de la 1.4 se ia cu `npm run eval`
> (`eval/README.md`). După deploy: rulează `supabase/ai_rag_v2.sql` + `supabase/meditatii_v3.sql`, apoi
> „🔄 Reindexează tot” și „🏷 Unifică subiectele” din panoul admin.
>
> Ce a rămas deliberat pe dinafară: OCR pentru PDF-urile scanate (fragmentele lor rămân metadate),
> `exgen`/`ai-exercise-agent` pe ramurile HTML (rămân text liber, cu gărzile de completitudine),
> și interzicerea scrierii scorurilor direct din browser (`supabase/progress_server_only.sql` —
> opțional, de rulat după ce verifici că salvarea pe server merge).

---

### Surse verificate azi pentru capacitățile furnizorilor
- OpenAI — Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI — File inputs (PDF: text + imagini de pagină): https://developers.openai.com/api/docs/guides/file-inputs
- Anthropic — Structured outputs (GA, `output_config.format`): https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Anthropic — PDF support (`document` block, caching, citări): https://platform.claude.com/docs/en/build-with-claude/pdf-support
