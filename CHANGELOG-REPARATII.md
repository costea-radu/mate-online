# Changelog reparații — ExamenMate

Toate fix-urile din raportul de debug, aplicate în ordine. Build-ul trece (`vite build`, 133 module), testele trec (`npm test`, 7/7), toate rutele API validate sintactic.

---

## 31 iulie 2026 (3) — Task-urile programate: METODA DE LUCRU din instrucțiuni („pe rând" / combinare / corespondență test↔barem) + butoanele „Publică acum" / „Vizualizează"

Cereri ale adminului. **După deploy: rulează DIN NOU `supabase/agent_tasks.sql`** (adaugă coloana `seq_done` — progresul modului „pe rând"). Până acum agentul folosea DOAR combinarea mai multor fișiere din rubrică; acum metoda se alege per task, direct din câmpul „Instrucțiuni pentru agent" (fiecare task își păstrează metoda, modelul AI și modelul de format proprii — pot diferi între task-uri):

### 🔁 „Ia pe rând fișierele rubricii" (nou)
Fraze de tip „ia pe rând fișierele", „câte un fișier", „unul câte unul", „fiecare fișier" (cu sau fără diacritice) → la fiecare rulare agentul ia URMĂTORUL fișier neprelucrat din rubrică (cel mai vechi primul) și îl transformă SINGUR într-un test interactiv nou — câte unul per publicare, exact cum a cerut adminul. Progresul per task în coloana nouă `agent_tasks.seq_done`; rândul task-ului arată „pe rând: N/M fișiere procesate" + buton ↺ (reset, cu acțiunea nouă `reset_progress`); când totul e procesat → rulare `skipped` („ℹ️ nimic de generat", email informativ), iar fișierele noi adăugate ulterior în rubrică sunt prinse automat. Transformări: sursă PDF → test interactiv structurat (păstrează itemii/baremul sursei, regimul datelor decide valorile); sursă interactivă → VARIANTA ei nouă (clonă a propriului fișier: design/figuri identice — SVG-urile restaurate programatic — alte valori); cu model de format HTML → exercițiile sursei turnate în formatul adminului.

### 🔗 Corespondența test ↔ barem (nou)
„Folosește baremele (corespondente)" în instrucțiuni + rubrica de bareme la context — SAU automat când o rubrică din context are „barem" în nume → pentru fiecare test-sursă, agentul caută singur baremul-pereche în rubricile suplimentare, potrivind TITLURILE (`titleMatchScore`: numerele comune cântăresc decisiv — „Testul 3" ↔ „Barem Testul 3"; numere diferite = eliminare; + cuvinte comune, cu „barem/rezolvare" ignorate la comparație; prag 0,35). Baremele potrivite merg la Claude (PDF nativ, ≤ ~5 MB total) cu instrucțiunea că răspunsurile/rezolvările/punctajele din barem AU PRIORITATE. Dacă nu găsește nicio pereche, cade elegant pe referințele alese la întâmplare (comportamentul de ieri). Merge în ambele metode (combinare și „pe rând").

### Restul
- **Combinarea clasică** rămâne implicită (nimic special în instrucțiuni sau „combină modelele din rubrică").
- **Butoanele din istoric** redenumite cum a cerut adminul: „👁 Vizualizează" + „✅ Publică acum" (existau ca „Previzualizare"/„Postează pe site"); chip nou „ℹ️ nimic de generat".
- **`api/_lib/exgen.js`:** `detectMode` (fraze RO, tolerant la diacritice), `titleMatchScore` + `fetchPairedContext`, ramura secvențială completă în `runAuto` (3 sub-căi: clonă HTML propriu / model de format / JSON structurat), `runTask` scrie progresul și starea `skipped`; interogarea rubricii acum ordonată (`created_at asc`) cu plafon 200. **`api/agent-tasks.js`:** acțiunea `reset_progress`. **UI:** hint „🧭 Metode înțelese de agent" sub câmpul de instrucțiuni, progres + ↺ pe task.
- **`test/agent-tasks.test.js`:** 3 teste noi (detectMode pe formulările adminului; potrivirea titlurilor test↔barem, inclusiv respingerea numerelor diferite; „pe rând" cu totul procesat → skipped, pe un client Supabase fals). Build trece, **107/107 teste trec**.

## 31 iulie 2026 (2) — Task-urile programate: CONTEXT MULTIPLU (ex. teste + baremele lor) și rezultat „DUPĂ MODELUL DE FORMAT" (fișier local)

Două cereri ale adminului, peste task-urile programate livrate mai devreme azi. **După deploy: rulează DIN NOU `supabase/agent_tasks.sql`** — conține migrarea (coloanele `extra_rubrics` + `format_model` și opțiunea `format` în constrângerea `result_kind`), sigură pe tabelele existente. (Panoul cu lista task-urilor + editare completă (nume, frecvență, zi, oră…) + ștergere exista deja din prima livrare; acum afișează și noile setări.)

### 📚 Context suplimentar: mai multe rubrici per task (opțional, max 3)
Pe lângă rubrica principală (sursele de combinat + locul postării), task-ul poate primi ALTE rubrici drept REFERINȚĂ — ex. rubrica cu baremele testelor. Din fiecare, agentul ia câte max 2 materiale la întâmplare (PDF-urile trimise NATIV către Claude, plafonate la ~3 MB în total; interactivele ca text) și e instruit explicit să NU le combine ca surse, ci să le folosească pentru stilul baremului/punctării și formulările cerințelor. O singură rubrică rămâne comportamentul implicit (lista goală).
- **`api/_lib/exgen.js`:** `fetchExtraContext` (nou) + injectarea contextului în TOATE cele 4 căi de generare (system prompt + blocuri PDF native + extras text); `runAuto` primește `extraRubrics`.
- **`api/agent-tasks.js`:** validarea `extra_rubrics` (curățare, apoi plafon 3 — o intrare invalidă nu consumă un loc; testul a prins exact cazul ăsta).
- **`src/components/AgentScheduledTasks.jsx`:** dropdown „➕ adaugă o rubrică drept context…" cu etichete ✕ (max 3, fără dubluri/rubrica principală); eticheta „📚 +N context" pe task.

### 🗂 Rezultat „După modelul de format (fișierul meu)" — ca la generarea manuală, dar programat
Opțiune nouă în dropdown-ul „Rezultatul": adminul încarcă de pe calculator un fișier-model (PDF sau HTML, max 2,5 MB), salvat în Storage (bucketul privat `content-files`, folderul `agent-formats/`) și refolosit la FIECARE rulare. HTML → rezultatul CLONEAZĂ exact designul/funcționalitatea fișierului (aceleași reguli stricte ca modul „HTML brut": CSS/JS copiate întocmai, figurile SVG restaurate programatic din șablon, MATE_SCORE adăugat dacă lipsește), cu exerciții noi din rubrică; PDF → structura testului structurat (itemi, secțiuni, barem) se potrivește cu modelul, trimis nativ către Claude.
- **`api/_lib/exgen.js`:** `storeFormatModel` / `removeFormatModel` / `loadFormatModel` (noi); `runAuto` acceptă `resultKind='format'` + `formatHtml`/`formatPdf` — HTML-ul devine șablonul căilor de clonare (înlocuiește formatul standard), PDF-ul devine referință de STRUCTURĂ în căile JSON; eroare clară dacă fișierul lipsește.
- **`api/agent-tasks.js`:** `create`/`update` primesc `format_file` {name, html|pdf(base64)} → Storage; înlocuirea/scoaterea șterge vechiul fișier; validare: rezultatul `format` fără fișier → 400; `delete` curăță și fișierul din Storage.
- **`src/components/AgentScheduledTasks.jsx`:** zona „🗂 Modelul de format" (alege / înlocuiește / scoate, PDF→base64, HTML→text, max 2,5 MB) vizibilă doar la rezultatul „format"; numele fișierului apare pe task și la editare („deja salvat").
- **`supabase/agent_tasks.sql`:** coloanele `extra_rubrics` + `format_model` (în create + `alter table add column if not exists` pentru instalările existente) și `result_kind` extins cu `'format'` (drop + recreare constrângere).
- **`test/agent-tasks.test.js`:** 2 teste noi (curățarea extra_rubrics; result_kind `format` acceptat + rularea fără fișier respinsă devreme cu mesaj clar). Build trece, **104/104 teste trec**.

## 31 iulie 2026 — Agentul de exerciții: selector de model AI (ca la SEO) + TASK-URI PROGRAMATE cu postare automată pe rubrici

Două cereri ale adminului. **După deploy: rulează `supabase/agent_tasks.sql` în SQL Editor. Fără chei noi în Vercel** — `ANTHROPIC_API_KEY` existentă acoperă TOATE modelele Claude (modelul e parametru per cerere); Vercel AI Gateway NU e necesar. Ghid complet: `GHID_TASKURI_PROGRAMATE.md`.

### 🧠 Selector de model AI la generatorul de exerciții
- **`src/lib/aiModels.js` (NOU):** lista partajată de modele (o singură sursă pentru ambii agenți + task-uri): Sonnet 5 (implicit), Opus 5, **Fable 5** (cel mai nou/capabil model Anthropic, iunie 2026), Haiku 4.5, Sonnet 4.6, Opus 4.8. **`src/components/AIModelPicker.jsx` (NOU):** rândul de butoane „🧠 Model AI", refolosit peste tot.
- **`src/components/AIExerciseAgent.jsx`:** selectorul de model apare sub descriere; alegerea (`aiModel`) se trimite la TOATE generările (mesaje + automatizarea pe rubrică). **`src/components/AISEOAgent.jsx`:** folosește lista/selectorul partajat (înainte avea propria listă de 4 modele — acum vede și Fable 5/Haiku 4.5).
- **`api/_lib/claude.js`:** lista permisă MODELS extinsă cu `claude-fable-5` și `claude-haiku-4-5` (validarea per cerere rămâne: ID necunoscut → modelul implicit). **`api/ai-exercise-agent.js`:** primește `aiModel` (numele `model` era deja ocupat de exercițiul-model!) și îl dă mai departe tuturor apelurilor Claude.

### 🗓 Task-uri programate („Create scheduled task", ca în Claude.ai — dar cu RUBRICA drept context, nu folder)
Adminul alege clasa / tipul de examen (aceeași listă de rubrici ca automatizarea manuală), programul (zilnic / săptămânal / lunar + ora, ORA ROMÂNIEI), instrucțiuni, modelul AI, regimul datelor, iar agentul generează SINGUR testul următor al rubricii și: **postează automat pe site** în rubrica aleasă (opțional gratuit/premium, test/exercițiu) SAU lasă rezultatul „🕓 așteaptă aprobare" (previzualizare + „✅ Postează pe site" din istoric). Email către admin după fiecare rulare (mailerul existent).
- **`supabase/agent_tasks.sql` (NOU — de rulat):** tabelele `agent_tasks` (definiții + program + context + postare) și `agent_task_runs` (istoricul rulărilor, cu rezultatul păstrat la cele neaprobate); RLS deny-all explicit (tiparul din `fix_rls_info_lints.sql` — Advisor rămâne curat).
- **`api/_lib/exgen.js` (NOU):** logica partajată — `runAuto` (automatizarea pe rubrică, MUTATĂ ca atare din `ai-exercise-agent.js`, + parametrul `aiModel`), `renderExerciseHtml` (exercițiu JSON → HTML interactiv; copie CJS a `src/lib/exerciseRender.js`), `postContent` (Storage + rând în `content`, identic cu formularul «Adaugă Interactiv»: `interactive_data.agent='claude'`, deci materialele apar și în lista reeditabilă a agentului), `runTask`, `postRun`, emailul de raport.
- **`api/ai-exercise-agent.js`:** acțiunea `auto` deleagă la `exgen.runAuto` — butonul „⚙️ Generează (AI)" se comportă IDENTIC (logica doar s-a mutat).
- **`api/agent-tasks.js` (NOU):** CRUD task-uri + `run_now` + istoricul rulărilor + `post_run`/`delete_run` — doar admin, validare strictă a câmpurilor (ora 0–23, ziua 1–7/1–28, modelul din lista permisă).
- **`api/agent-cron.js` (NOU) + `vercel.json`:** cron ORAR (`0 * * * *`) — execută task-urile scadente la ora curentă a României (conversie cu `Intl`/Europe/Bucharest, corectă și la ora de vară), max 3 per tic, gardă anti-dublare 2h, protejat ca celelalte cron-uri (`x-vercel-cron` / `AI_CRON_SECRET`).
- **`src/components/AgentScheduledTasks.jsx` (NOU):** panoul „🗓 Task-uri programate" sub generatorul de exerciții: creare/editare, pornit/oprit, „▶️ Rulează acum" (~30–90s), următoarea rulare estimată, istoric cu statusuri (✅ postat / 🕓 așteaptă aprobare / ⚠️ eroare), previzualizare în iframe și postare cu un click. **`src/lib/aiClient.js`:** metoda `agentTasks`.
- **Postarea automată** publică materiale INTERACTIVE în rubrica aleasă (la rubricile PDF, sursele sunt PDF-urile, rezultatul e interactiv — PDF-uri noi nu se pot fabrica pe server; pentru PDF rămâne fluxul manual). **`.env.ai.example`:** secțiune nouă despre `ANTHROPIC_API_KEY`/`CLAUDE_MODEL` (o singură cheie pentru toate modelele).

## 31 iulie 2026 — Cele 7 lint-uri INFO „RLS Enabled No Policy" din Supabase Advisor, stinse explicit

Raportul de lints Supabase (Performance + Security Advisor) conținea DOAR 7 intrări — toate INFO, toate același lint: RLS activat fără nicio politică pe `archived_student_results`, `contact_messages`, `gsc_snapshots`, `newsletter_campaigns`, `newsletter_sends`, `seo_actions`, `social_posts`. Zero warning-uri sau erori, zero lint-uri de performanță. Verificat în cod: toate cele 7 tabele sunt folosite EXCLUSIV de rutele API de pe server cu service role (care ocolește RLS) — frontend-ul nu le atinge direct (mențiunile din `src/` sunt doar comentarii; datele ajung în UI prin `/api/seo-rank` și `/api/social-queue`). Deci NU era o gaură de securitate: RLS fără politici = acces interzis pentru toată lumea; linterul doar cerea confirmarea intenției.

- **`supabase/fix_rls_info_lints.sql` (NOU — de rulat în SQL Editor):** politică explicită deny-all („…_service_only", `USING (false) WITH CHECK (false)` pentru anon + authenticated) pe fiecare din cele 7 tabele — documentează intenția și stinge lint-urile, zero schimbări de comportament; + REVOKE pe drepturile implicite anon/authenticated (întărire: inerte azi, dar previn o politică permisivă adăugată din greșeală în viitor); + interogare de verificare la final (așteptat: 7 rânduri, apoi „Rerun linter" în Advisors). Sigur de rulat repetat. Niciun fișier de cod modificat.

## 30 iulie 2026 — Rezultatele elevilor REAPAR în contul de profesor + agentul descrie funcțiile platformei + clipurile merg pe YouTube ȘI TikTok

Patru cereri ale adminului. **După deploy: rulează `supabase/pastreaza_rezultate.sql` în SQL Editor (rezultatele elevilor NU se mai șterg odată cu materialele); fără dependențe noi.**

### Rezultatele NU se mai șterg odată cu materialele (cauza reală, confirmată de admin)
Confirmat: rezultatele grupei „elevi 2026" au dispărut când s-au ȘTERS TESTELE INTERACTIVE pe care le rezolvaseră — `progress.content_id` avea `ON DELETE CASCADE`, deci Postgres ștergea automat rezultatele odată cu materialul, fără niciun avertisment în dialogul din admin. (Nicăieri în cod nu există DELETE direct pe `progress`; bug-ul limitei de 1000 de mai jos era o problemă separată, suprapusă.) Diagnostic complet, doar-de-citire: `supabase/diagnostic_rezultate_disparute.sql` — dovada e că conversațiile AI (fără foreign key) referă materiale inexistente; rezultatele DEJA șterse se pot recupera doar din Supabase → Database → Backups (plan Pro).
- **`supabase/pastreaza_rezultate.sql` (NOU — de rulat):** coloane snapshot `test_title`/`content_type`/`category` pe `progress` + backfill din materialele existente; legătura spre `content` devine **ON DELETE SET NULL** (rezultatul rămâne, cu titlul păstrat în el; UNIQUE-ul rămâne valid — NULL-urile sunt distincte); politică RLS nouă — adminul poate citi progresul tuturor (pentru numărătoarea din dialogul de ștergere). Sigur de rulat repetat.
- **`src/pages/InteractiveViewer.jsx`:** la fiecare salvare de punctaj, titlul/tipul/categoria testului se scriu ÎN rezultat (retry progresiv dacă migrarea nu e încă rulată — salvarea nu se strică).
- **`api/teacher-students.js` + `api/_lib/inactivity.js`:** dashboardul mentorului și arhiva folosesc titlul din snapshot când materialul nu mai există; doar rezultatele vechi fără snapshot apar ca „Test (material șters)".
- **`src/pages/Admin.jsx`:** dialogul de ștergere a unui material arată câte rezultate au elevii la el și explică că rămân; dacă migrarea NU e rulată încă, avertizează explicit că rezultatele s-ar șterge definitiv.

### BUG REZOLVAT: rezultatele vechi ale elevilor dispăreau din contul de profesor
**Cauza (dovedită prin simulare):** Supabase (PostgREST) întoarce maxim **1000 de rânduri PER CERERE** (aceeași limită reparată pe 28 iulie în seo.js/sitemap.js — dar nu și aici). Interogarea progresului din `api/teacher-students.js` era ordonată DESCRESCĂTOR după dată, deci întorcea doar cele mai NOI 1000 de rânduri: pe măsură ce elevii activi recent adăugau rânduri (ex. cei doi din cealaltă grupă care au rezolvat în ultima lună cu AI), rezultatele VECHI (grupa de anul trecut) cădeau TĂCUT din listă — exact simptomul raportat. Reprodus pe 2500 de rânduri simulate: codul vechi afișa 1000 (elevul „vechi" — 0 rezultate); codul nou — toate 2500. **Nimic nu s-a pierdut din baza de date** — rezultatele erau doar ne-citite; reapar la următoarea încărcare a dashboardului, fără nicio migrare.

- **`api/_lib/http.js`:** helpere noi partajate — `allRows` (citire paginată cu `.range()`, pagini de 1000) și `inBatches` (filtre `.in()` pe liste mari de id-uri: loturi de 100 + paginare pe fiecare lot).
- **`api/teacher-students.js`:** toate interogările cu potențial de trunchiere citesc paginat: asocierile mentor→elevi, profilurile, **PROGRESUL (bug-ul principal)**, conversațiile AI, mesajele AI (numărătoarea întrebărilor pe material — loturile de 150 de conversații se citesc acum și ele paginat) și titlurile materialelor.
- **`api/ai-teacher.js`:** raportul AI + clasamentele citesc paginat mentor_students / profiles / ai_skill_mastery (o clasă × zeci de subiecte depășește ușor 1000 de rânduri).
- **`api/_lib/inactivity.js` → buildSnapshot:** arhiva unui elev (creată înainte de ștergerea contului inactiv) citește paginat progress/conversații/mesaje/content — snapshotul permanent nu se mai poate trunchia tăcut.
- **`test/http.test.js` (+3):** allRows adună 2350 de rânduri în pagini de 1000 și nu pierde ultimul rând; oprire la prima pagină incompletă + propagarea erorilor; inBatches combină loturile de 100.

### Agentul SEO descrie funcționalitățile platformei în articole și postări (+ interzis „teză")
- **`api/_lib/seo.js` → buildSystem:** bloc nou „FUNCȚIONALITĂȚILE PLATFORMEI" în promptul de sistem, pe publicuri: ELEVI — Profesorul Virtual răspunde la întrebări din PDF-uri, exerciții interactive sau orice exercițiu, explică pas cu pas; teste interactive cu verificare pe loc și explicații; PĂRINȚI — contul de părinte: rezultatele și evoluția copilului, dacă a folosit Profesorul Virtual sau a rezolvat independent, câte încercări a avut la fiecare test, cât a lucrat, ce teme a primit; PROFESORI — contul de profesor: grupe de elevi, teste interactive trimise ca temă, clasamente și evoluția fiecărui elev, generare de teste în formatul EXACT EN/BAC (cu barem), exerciții interactive sau PDF, publicarea testelor și folosirea la clasă; + alte facilități (asistent AI, biblioteca utilizatorilor, rezolvări). **REGULĂ DE VOCABULAR:** cuvântul „teză"/„teze" e INTERZIS în tot ce scrie agentul (în România nu se mai susțin teze) — se folosește „lucrare/test/evaluare/examen".
- **Sarcinile `social` + `blog`:** playbook pe publicuri actualizat (părinți → contul de părinte pe Facebook; elevi → Profesorul Virtual + teste interactive pe Instagram/TikTok; PROFESORI → public nou pe Facebook, cu contul de profesor); articolele menționează funcțiile potrivite publicului, cu linkuri interne.
- **`api/_lib/ai.js`:** „examen/teză" → „un examen, un test sau o lucrare" în recomandarea activă a Profesorului Virtual.

### TikTok la fel ca YouTube: clipurile agentului intră în AMBELE cozi
- **`api/_lib/seo.js` → create_video:** o propunere pe `youtube` SAU `tiktok` creează la aprobare **DOUĂ postări** în calendarul social, cu același MP4: una **YouTube** (TITLU/DESCRIERE/TAGURI de lipit) și una **TikTok** (caption ≤ 2200 de caractere — limita reală TikTok; câmp nou opțional `tiktok_text`, altfel se refolosește descrierea, scurtată automat). Titlul YouTube e acum obligatoriu și la tiktok; revert-ul anulează AMBELE postări (`result.post_ids`); editarea din admin acoperă titlul/tagurile/captionul TikTok (la clipurile tiktok, textul editat rămâne sincron cu captionul).
- **`src/components/SEOActionsQueue.jsx`:** preview-ul arată „▶️ YouTube + 🎵 TikTok" + insigna „ambele cozi manuale", captionul TikTok separat (marcat „identic cu descrierea" când e refolosit), iar formularul „✏️ Editează" are câmpurile ambelor platforme. Panoul „Calendar social" nu are nevoie de modificări — cele două postări apar firesc în „De postat manual".
- **Prompturile agentului** (sarcinile `social`/`youtube`, blocul VIDEO, descrierile uneltelor) explică fluxul: o singură propunere → ambele platforme.
- **`api/seo-actions.js` + `SEOActionsQueue.jsx`:** propunerile EȘUATE se pot reexecuta din admin cu „🔁 Reîncearcă execuția", fără o propunere nouă — cazul real: primul clip a picat cu „Bucket not found" fiindcă `supabase/agent_media.sql` (bucketul `agent-media`, cerut de generatorul de clipuri din 29 iulie) nu fusese rulat; se rulează scriptul, apoi se reîncearcă.
- **Buton „⬇️ Descarcă clipul":** în „Calendar social" → De postat manual (TikTok/YouTube) și pe propunerile create_video executate din coada de aprobare — descărcare directă (Supabase Storage `?download=nume.mp4`), fără clic-dreapta pe player. „🚀 Publică acum" pentru Facebook/Instagram exista deja (secțiunile Programate + Eșuate) și merge și pentru clipuri/Reels. Publicarea DIRECTĂ pe YouTube/TikTok rămâne blocată de audit-urile platformelor (fără audit, YouTube blochează clipurile urcate prin API ca „private locked", iar TikTok permite doar draft/privat).
- **MUZICĂ DE FUNDAL în clipuri** (cerere: „clipurile nu au sunet"): **`api/_lib/audio/fundal.mp3` (NOU)** — instrumental ORIGINAL sintetizat programatic (C–G–Am–F, pad+arpegiu+bas, ~19s în buclă, normalizat la −17 LUFS; zero drepturi de autor → fără probleme de Content ID). **`api/_lib/video.js`:** `resolveMusic()` — prioritate: fișierul adminului din Storage `agent-media/audio/fundal.mp3|.m4a|.wav` (înlocuibil FĂRĂ deploy) → instrumentalul din repo → liniște; `renderVideo()` pune muzica în buclă pe durata clipului (fade-in 0.4s, fade-out 1.2s, AAC 128k, `-t` explicit pe durată). Detalii/licență: `api/_lib/audio/DESPRE-MUZICA.txt`.
- **Clip Instagram = și Facebook, automat** (cerere: „nu pot redistribui de pe Instagram pe Facebook" — Meta nu permite redistribuirea manuală a Reels-urilor publicate prin API): un create_video pe instagram SAU facebook creează la aprobare DOUĂ postări automate cu același MP4 — Reels pe Instagram + video pe Facebook (doar dacă ambele sunt configurate; altfel rămâne una singură). Preview-ul din admin arată „📸 Instagram + 📘 Facebook"; revert-ul anulează/șterge ambele (mecanismul `post_ids` existent). Prompturile agentului actualizate.
- **Teste:** `test/video.test.js` +2 — `resolveMusic` găsește instrumentalul din repo; clipul randat cu muzică e MP4 valid și conține audio real (comparație de mărime cu varianta pe liniște).
- **`test/video.test.js` (+3):** youtube → dual cu tiktok_text implicit/explicit (curățat de LaTeX); tiktok cere titlul YouTube + textul devine captionul; editarea dual (sincronizarea captionului, limita 2200); instagram rămâne NE-dual.

### Verificare
- `npm test`: **95/95** (89 vechi neatinse + 6 noi); simulare end-to-end a dashboardului de profesor pe un Supabase fals cu paginare de 1000: înainte — 1000 de rezultate afișate și elevul vechi cu 0; după — toate 2500, cu titluri corecte. Toate rutele modificate validate sintactic; `SEOActionsQueue.jsx` verificat cu esbuild.

---

## 29 iulie 2026 (seara) — Agent SEO: editare propuneri, teme la Social/YouTube, FĂRĂ LaTeX în postări, generator de VIDEOCLIPURI

Patru cereri ale adminului peste Faza 4. **După deploy: `npm install` local înainte de commit (pachet nou `ffmpeg-static`) + rulează `supabase/agent_media.sql` în SQL Editor.**

### „✏️ Editează" pe propunerile în așteptare
- **`api/_lib/seo.js` → `editActionPayload`:** editarea unei propuneri `proposed` cu ACELEAȘI validări ca la creare — schedule_social (textul, cu plainMath), create_video (titlu/caption/taguri), yt_update_video (doar câmpurile propuse; valoare identică cu cea veche → schimbarea dispare; zero schimbări rămase → eroare clară), publish_article / update_article (titlu/descriere/content_md, cu regenerarea HTML-ului). Tipurile fără editare → mesaj explicit.
- **`api/seo-actions.js`:** acțiunea nouă `update` (admin-only; doar status `proposed`; nota primește marcajul unic „[editat de admin]").
- **`src/components/SEOActionsQueue.jsx`:** buton „✏️ Editează" pe propunerile editabile → formular inline (input/textarea, tagurile ca listă cu virgule, monospace pe Markdown) → „💾 Salvează modificările" trimite DOAR câmpurile schimbate.

### Fără `$`/LaTeX în postările sociale (bug raportat cu captură din Instagram)
- **`api/_lib/social.js` → `plainMath()`:** formulele `$...$`/`\(...\)` din texte devin Unicode lizibil: exponenți/indici (² ³ ⁿ x₁), `\frac`→(a)/(b), `\sqrt`→√, `\cdot·`, `\pi`→π, ≤ ≥ ≠ ± × ∞ →, comenzile rămase eliminate; dolarul „monetar" (fără pereche pe linie) rămâne neatins. Aplicat la `schedule_social` (text + textele cardurilor), la `create_video` (caption + scenele) și la editare; prompturile interzic explicit LaTeX-ul în social.

### „Subiect ales de mine / lasă agentul să aleagă" și la Social + YouTube
- **`src/components/AISEOAgent.jsx`:** panoul de temă de la „Articole Blog" e generalizat (`THEME_PANELS`) — apare și la „📱 Postări social media" (tema/campania adminului sau alegerea agentului din calendarul școlar + date) și la „▶️ YouTube" (cererea adminului — clip nou/optimizări — sau alegerea agentului). Instrucțiunile „tema mea" sunt specifice fiecărei sarcini.

### Generatorul de VIDEOCLIPURI simple (create_video)
- **`api/_lib/video.js` (NOU):** montaj de slide-uri branded (aceleași fonturi/culori ca social-image) — șabloane `intro | lista | imagine | statistica | final`, imagini reale descărcate și încadrate (data URL), satori→sharp→PNG-uri→**ffmpeg-static**→MP4 H.264 (vertical 1080×1920 implicit sau orizontal; 2–12 scene, 1.5–10s/scenă, max 75s; pistă de liniște AAC pentru compatibilitate; `yuv420p + faststart`). Validarea specificației (`checkVideoSpec`) e pură și testată; ffmpeg/satori se încarcă lazy — fără ele restul agentului merge, cu mesaj clar.
- **`api/_lib/seo.js`:** unealta nouă **`create_video`** (prin coada de aprobare; scenele curățate de LaTeX; youtube cere titlu validat pe limitele reale; `when` + UTM ca la schedule_social). Execuție LA APROBARE: randare (30–90s) → upload în Storage (bucket public **`agent-media`** — `supabase/agent_media.sql`, NOU) → rând în `social_posts`: **Instagram (Reels)/Facebook → publicare AUTOMATĂ** la ora aleasă (cron-ul existent detectează .mp4); **YouTube/TikTok → coada manuală cu clipul GATA FĂCUT** (download + titlu/descriere/taguri de lipit — publicarea prin API rămâne blocată de platforme fără audit). Revert: postarea → `canceled` (MP4-ul rămâne în Storage). Sarcinile `youtube` (modul B — clipuri noi, funcționează și fără YT conectat) și `social` + blocul VIDEO din promptul de sistem.
- **`src/components/SEOActionsQueue.jsx`:** preview complet al propunerii (platformă + automat/manual, format/durată, scenele numerotate cu texte/imagini, captionul, tagurile, UTM) + „↩️ Anulează clipul" + „🎬 Deschide clipul (MP4)" după execuție. **`SocialQueue.jsx`:** preview `<video>` cu controale pentru media .mp4 (clipurile generate) în toate secțiunile.
- **`package.json`:** dependență nouă `ffmpeg-static` (^5.2.0).

### Teste și verificare
- **`test/video.test.js` (NOU):** 17 teste — plainMath (cazul REAL din postarea cu `$`, comenzi LaTeX, indicii/exponenții, dolarul monetar neatins, curățarea end-to-end prin executor), checkVideoSpec (normalizări + toate respingerile + rutele relative de imagine), buildScene (logo/footer/bullets), create_video prin executor (youtube cere titlu; instagram automat + UTM), editActionPayload (toate tipurile + cazurile de eroare) și **testul de fum al montajului MP4 REAL** (magic bytes `ftyp`; sare elegant fără ffmpeg).
- `npm test`: **89/89**; `vite build` trece; slide-urile verificate VIZUAL (listă cu diacritice + (a±b)² Unicode, imagine încadrată cu ramă, brand corect); clip de test randat end-to-end (5 scene, 15.5s, 0.9s de procesare la scară mică).

---

## 29 iulie 2026 — Agent SEO Faza 4: YouTube + măsurare avansată (rank-tracking & raport lunar)

Implementarea Fazei 4 (ultima) din `GHID_AGENT_SEO_ACTIUNI.md`: agentul optimizează metadatele clipurilor YouTube EXISTENTE prin coada de aprobare, adminul vede negru pe alb efectul fiecărei optimizări (grafice de rank-tracking cu momentele acțiunilor marcate), iar pe 1 ale lunii pleacă automat raportul lunar pe email. **Fără SQL nou și fără dependențe noi. După deploy: pasul 4a din ghid (config OAuth YouTube, ~15 min, opțional) cu `YT_CLIENT_ID`/`YT_CLIENT_SECRET`/`YT_REFRESH_TOKEN` în Vercel — fără ele uneltele YouTube răspund „neconectat", rank-trackingul și raportul lunar merg din prima zi.**

### 4a — YouTube (metadatele clipurilor existente)
- **`api/_lib/youtube.js` (NOU):** YouTube Data API v3 cu fetch simplu, fără dependențe (ca `google.js`): OAuth cu REFRESH TOKEN (YouTube nu acceptă cont de serviciu pe canale personale; token cache-uit până aproape de expirare), canalul + clipurile prin playlistul de upload-uri (căutare client-side — 1 unitate de cotă în loc de 100 la search.list), clipul complet, update-ul de snippet (API-ul ÎNLOCUIEȘTE snippet-ul întreg — se pornește de la cel actual, `categoryId`/limbile se păstrează). Validări pe limitele reale YouTube: titlu 5–100 caractere fără `<`/`>`, descriere ≤ 5000 BYTES (diacriticele ocupă 2), taguri ≤ ~480 caractere în total. Upload-ul automat rămâne NEimplementat intenționat (clipurile aplicațiilor ne-auditate rămân forțat private) — fluxul semi-automat din Faza 3 (coada manuală) rămâne calea pentru clipuri noi.
- **`api/_lib/seo.js`:** citire nouă `yt_list_videos` (canal + clipuri cu statistici) și `yt_get_video` (metadatele complete — obligatoriu înainte de update); scriere nouă **`yt_update_video`** (doar câmpurile schimbate, comparate cu clipul REAL; valorile vechi în payload → diff în admin + revert cu un click; propunerea e respinsă dacă nimic nu se schimbă). Execuție la aprobare / revert prin `youtube.updateVideo`. Sarcina nouă **`youtube`** (flux: yt_list_videos → gsc_query → yt_get_video → propuneri cu motivul în note; titluri cu formularea căutată, descrieri cu link UTM către site, 8–15 taguri) + blocul YOUTUBE în promptul de sistem. Fără chei configurate, uneltele răspund elegant („neconectat" + trimitere la pasul 4a).
- **`src/components/AISEOAgent.jsx`:** presetul „▶️ YouTube — titluri & descrieri". **`SEOActionsQueue.jsx`:** preview dedicat (titlul clipului + statistici + link, diff pe titlu/taguri, descrierea veche vs. nouă pe două coloane) + „↩️ Anulează (valorile vechi)" + „▶️ Deschide clipul" după execuție. **`seo-cron.js`:** eticheta tipului în digestul săptămânal.

### 4b — Rank-tracking în admin + raportul lunar
- **`api/_lib/seo.js` (helpere de măsurare):** `snapshotRows` (citire paginată din `gsc_snapshots`, peste limita de 1000 de rânduri PostgREST), `buildRankData` (PURĂ: totaluri zilnice + top chei + serii pe zi; poziția = medie ponderată cu impresiile), `actionSummary` (eticheta + ruta măsurabilă a unei acțiuni), `actionMarkers`, `computeEffect` (PURĂ: medii pe zi + poziție, 14 zile înainte vs. după; „pending" sub 5 zile finalizate de date), `measureActionEffects` (efectul acțiunilor cu rută: meta + articole), `rankData` (fereastra 14/28/90 + perioada anterioară pentru Δ), `monthRange` (PURĂ: luna calendaristică anterioară, corectă peste granița de an) și `monthlyContext` (blocul de DATE MĂSURATE al raportului lunar: trafic lună vs. lună, top interogări cu evoluția poziției, urcări/căderi, acțiunile executate + efectul lor, articolele publicate, postările sociale cu metrici, canalele + campaniile UTM din GA4 — totul calculat în cod, cu mesaje explicite când o sursă lipsește).
- **`api/seo-rank.js` (NOU, admin-only):** datele panoului de rank-tracking — citite EXCLUSIV din Supabase (zero apeluri Google la afișare, zero cotă); tabelul lipsă → avertisment clar, nu 500.
- **`src/components/SEORankTracker.jsx` (NOU),** montat în `AIAdminPanel` sub coada de aprobare: grafice SVG fără dependențe — clicuri/zi și impresii/zi (grafice separate, câte o singură axă), evoluția POZIȚIEI pe interogările/paginile-țintă (axa inversată: 1 = sus; chips-legendă cu selecție, max 6 serii), momentele acțiunilor executate ca linii verticale punctate cu iconița tipului (tooltip nativ), crosshair + tooltip la hover, secțiunea „⚡ Efectul optimizărilor" (poziție/clicuri/impresii înainte → după; „încă se măsoară" sub 5 zile), tabelul top cu Δ poziție (▲/▼ + cifră, nu doar culoare) și butoane 14/28/90 zile + comutator interogări/pagini. Paleta seriilor e FIXĂ și validată pentru daltonism (CVD ΔE ≥ 8 pe alb: #1a63a8 #b8860b #9048b0 #1e8a4f #2596b8 #c0563b); culoarea urmează interogarea, nu selecția. Verificat VIZUAL (randare + hover în Chromium).
- **`api/seo-cron.js`:** acțiunea nouă **`monthly`** (cron nou `0 7 1 * *` în `vercel.json`): `monthlyContext` → agentul (sarcina nouă `report`, max 4 iterații — datele sunt gata calculate, uneltele doar pentru verificări punctuale) → email către admin cu raportul întreg (markdown → HTML pe șablonul existent) + linkul către grafice. Test manual: `/api/seo-cron?action=monthly&secret=AI_CRON_SECRET`.
- **`src/lib/aiClient.js`:** metoda `seoRank`. **`.env.ai.example`:** blocul `YT_*` documentat.

### Teste și verificare
- **`test/youtube.test.js` (NOU):** 13 teste — limitele metadatelor YouTube (titlu, descriere în BYTES cu diacritice, tagurile cu totalul ~500), îmbinarea snippet-ului la update (categoryId/limbile păstrate, tags [] vs. null), comportamentul fără chei (citire → mesaj, scriere → eroare clară), agregarea `buildRankData` (totaluri zilnice, top după clicuri, poziția ponderată, găurile de snapshot tolerate, cheile explicite), `actionSummary` (rutele măsurabile), `computeEffect` (medii înainte/după + „pending" la acțiuni recente), `monthRange` (trecerea de an, februarie) și prezența uneltelor/sarcinilor noi.
- `npm test`: **72/72** (toate cele vechi neatinse); `vite build` trece (149 module, `SEORankTracker` în chunk-ul de admin); toate rutele noi/modificate validate sintactic; graficele verificate vizual (layout + crosshair/tooltip + markere + tabel, pe date sintetice).

---

## 29 iulie 2026 — Agent SEO Faza 3: social media (Facebook + Instagram automat, TikTok/YouTube semi-automat)

Implementarea Fazei 3 din `GHID_AGENT_SEO_ACTIUNI.md`: agentul programează postări reale prin coada de aprobare; Facebook/Instagram se publică AUTOMAT la ora aleasă, TikTok/YouTube intră într-o coadă manuală (copy-paste din admin, ~5 min/zi). **După deploy: rulează `supabase/social_posts.sql` în SQL Editor + `npm install` (dependențe noi: satori, sharp) + pasul 3a din ghid (config Meta, ~30 min) cu `META_PAGE_ID`/`META_PAGE_TOKEN`/`META_IG_USER_ID` în Vercel.**

### Baza de date și Meta Graph API
- **`supabase/social_posts.sql` (NOU):** calendarul social — platform, text, media, link (cu UTM), campaign, image (șablonul cardului), scheduled_at, status `draft/approved/manual/posted/failed/canceled`, external_id, metrics, action_id (legătura cu propunerea) + constrângeri + indexuri + RLS server-only (fără politici publice — tabelul e citit doar prin endpointuri admin).
- **`api/_lib/social.js` (NOU):** Meta Graph API cu fetch simplu, fără dependențe (ca `google.js`): FB text/link (`/feed`), foto (`/photos`), video (`/videos`); IG imagine și Reels (`/media` → polling `status_code` până FINISHED → `/media_publish`); ștergere post FB (pentru revert); metrici best-effort (like/comentarii/share din câmpuri; reach din insights DOAR dacă tokenul are `read_insights`/`instagram_manage_insights` — altfel se sare elegant). **UTM automat** (`utm_source={platformă}&utm_medium=social&utm_campaign={slug}`) DOAR pe linkurile examenmate.com — linkurile externe rămân neatinse; slugul campaniei se derivă din link (cu transliterarea diacriticelor). Semnarea HMAC-SHA256 a parametrilor de imagine (secret: `AI_SIGNING_SECRET`/service role).

### Generatorul de carduri branded (rezolvă cerința de media a Instagramului)
- **`api/social-image.js` (NOU):** `GET /api/social-image?template=…&title=…&sig=…` → JPEG 1080×1080 în culorile brandului (navy/auriu din `global.css`), 5 șabloane: `formula` (formula zilei), `exercitiu` (+ „Răspunsul — în comentarii"), `greseala`, `countdown` (număr uriaș auriu), `anunt` (articol/funcție nouă). Lanțul: satori (layout + glife→contururi) → sharp (SVG→JPEG). Endpointul e public (Meta descarcă imaginea la publicare), dar parametrii sunt SEMNAȚI — nimeni nu poate genera carduri „ExamenMate" cu alt text. Cache CDN agresiv (conținut = funcție pură de parametri). Fără satori/sharp instalate → 501 cu mesaj clar, restul agentului merge.
- **`api/_lib/fonts/` (NOU):** DM Sans 400/700 + Fraunces 800 (fonturile site-ului, cu diacritice) + DejaVu Sans Bold (fallback per-glifă pentru π √ Δ ∑ ≈) + licențele (OFL). Textele cardurilor folosesc Unicode, NU LaTeX. `vercel.json`: `includeFiles` extins la `api/_lib/**`.

### Uneltele agentului (prin coada de aprobare)
- **`api/_lib/seo.js`:** scriere nouă **`schedule_social`** (validări: platformă din listă, text 20–2000/4000 caractere, `when` ISO cu fus orar — trecutul devine „cât mai curând", max 90 zile; Instagram FĂRĂ media → respins la propunere; `image` XOR `media_url`; media doar URL public https) — payload-ul păstrează linkul original + linkul cu UTM + specificația cardului; citire nouă **`list_social_posts`** (calendar + metrici + starea config Meta — obligatorie înainte de programare: anti-dubluri + învățare din postările vechi). Execuție la aprobare: rând în `social_posts` cu `approved` (FB/IG — publicat de cron) sau `manual` (TikTok/YouTube), cu avertisment în rezultat dacă Meta nu e configurat încă. Revert: postare neprogramată → `canceled`; deja publicată pe FB → ștearsă prin API; pe IG → mesaj clar (API-ul nu permite). Sarcina `social` rescrisă (playbook pe publicuri: părinți→FB, elevi→IG/TikTok; ore cu audiență; hashtag-uri; metrici) + blocul SOCIAL în promptul de sistem + `db_stats` include starea calendarului.
- **`api/social-cron.js` (NOU):** `?action=publish` (cron `*/15 * * * *`): publică postările `approved` scadente pe FB/IG (max 10/rulare); eșec → `failed` + eroarea Graph în rând (retry din admin). `?action=metrics` (cron zilnic 7:30): insights + permalink pentru postările din ultimele 14 zile → `social_posts.metrics`. Protecție: `x-vercel-cron` sau `?secret=AI_CRON_SECRET`; fără config Meta → skip elegant, nu eroare.

### Adminul
- **`api/social-queue.js` (NOU, admin-only):** `list` / `publish_now` (publică imediat o postare aprobată — și TEST al configurării Meta) / `mark_posted` (coada manuală, cu link opțional) / `cancel` / `retry` (eșuată → reluată de cron) / `refresh_metrics`.
- **`src/components/SocialQueue.jsx` (NOU),** montat în `AIAdminPanel` sub coada SEO: secțiunile „✍️ De postat manual" (TikTok/YouTube: copy textul cu un click + deschide media + „Am postat-o"), „⏳ Programate" (cu ora, preview-ul cardului generat, „🚀 Publică acum"), „⚠️ Eșuate" (eroarea Graph + reîncercare), istoric cu metrici (👁 reach ❤ like 💬 comentarii + „Deschide postarea"). Bannere de configurare când META_* lipsesc. `aiClient.socialQueue` în `src/lib/aiClient.js`.
- **`src/components/SEOActionsQueue.jsx`:** preview complet pentru propunerile `schedule_social` (platformă + insigna automat/manual, ora, textul, IMAGINEA generată — adminul vede exact cardul —, linkul cu UTM și campania, avertisment dacă Meta nu e configurat) + revert „↩️ Anulează postarea"; la orice decizie panoul social se reîmprospătează (`social-posts-updated`).

### Teste și verificare
- **`test/social.test.js` (NOU):** 13 teste — UTM (linkuri proprii/relative/externe/parametri existenți), slugul campaniei (diacritice transliterate), caption, detecția video, semnătura imaginilor (validă/tamper/falsă), URL-ul semnat, structura celor 5 șabloane, scalarea fontului + **testul de fum al randării** (JPEG real cu diacritice și π, verificat pe magic bytes).
- `npm test`: **59/59** (toate cele vechi neatinse); fluxul propunere → aprobare → revert verificat end-to-end pe DB simulat (IG fără imagine respins; media_url semnat; UTM aplicat; FB/IG→approved, TikTok→manual; revert→canceled); toate rutele noi validate sintactic; cardurile verificate VIZUAL (5 șabloane randate).

---

## 28 iulie 2026 — Redenumire: pagina „Rezolvări" → „Blog / Rezolvări / Teorie"

Numele AFIȘAT al paginii `/rezolvari` devine „Blog / Rezolvări / Teorie" peste tot în interfață; **URL-ul rămâne `/rezolvari`** (rutele indexate de Google, slugurile articolelor, sitemap-ul și rewrite-urile nu se ating — zero pierdere SEO).

- **`src/components/Navbar.jsx`:** linkul din meniul „Mai multe", linkul din meniul mobil și eticheta rezultatelor de căutare.
- **`src/pages/RezolvariPage.jsx`:** breadcrumb, H1 („📝 Blog / Rezolvări / Teorie") și subtitlul paginii (menționează articole + teorie).
- **`src/pages/ArticolPage.jsx` + `api/page-meta.js` (shell-ul SSR):** breadcrumb-ul articolelor și linkul „← Înapoi la Blog / Rezolvări / Teorie" — identice în React și în HTML-ul servit crawlerelor.
- **`api/_lib/seo.js`:** structura site-ului din promptul agentului + descrierile uneltelor (list_articles, publish_article, sarcina `blog`) folosesc noul nume.
- **`api/_lib/ai.js`:** Profesorul Virtual recomandă secțiunea ca `[Blog / Rezolvări / Teorie](/rezolvari)` (SITE_MAP + mesajele despre barem).
- **`src/components/AISEOAgent.jsx` / `SEOActionsQueue.jsx`:** textele din admin actualizate.
- Tab-ul „📝 Rezolvări" din admin (gestionarea materialelor video/PDF) rămâne neschimbat — e denumirea internă a tipului de material, nu a paginii publice.

---

## 28 iulie 2026 — Agent SEO Faza 2: pagina Rezolvări devine motor de conținut (articole indexabile)

Implementarea Fazei 2 din `GHID_AGENT_SEO_ACTIUNI.md`: agentul SEO poate scrie și publica (prin coada de aprobare) articole, rezolvări scrise pas cu pas și explicații — fiecare cu URL propriu `/rezolvari/{slug}`, servit server-side (Google și Facebook văd conținutul complet fără JavaScript). **După deploy: rulează `supabase/articole.sql` în Supabase → SQL Editor.**

### Baza de date și randarea conținutului
- **`supabase/articole.sql` (NOU):** tabelul `articole` (slug PK, title, description, category, kind articol/rezolvare/explicatie, content_md, content_html, keywords, sources, status draft/published) + constrângeri defensive (slug `^[a-z0-9-]+$`, kind/status din listă) + indexuri + RLS: citire publică DOAR pentru `status='published'` (scrierea trece exclusiv prin server).
- **`api/_lib/markdown.js` (NOU):** Markdown→HTML fără dependențe, design „escape-first" — TOT textul e escapat înainte de construirea tagurilor, deci HTML brut din markdown (inclusiv injectat printr-un eventual prompt injection în agent) nu poate deveni XSS; linkurile acceptă doar https/http/rute interne/#ancore (javascript: rămâne text). Formulele LaTeX (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) sunt protejate ca text și randate în browser de KaTeX. Suportă titluri (H1 rezervat paginii — decalare automată), bold/italic (fără să strice `a_1 * b` din formule), liste cu un nivel de imbricare, tabele GitHub cu aliniere (esențiale pentru „toate formulele de..."), citate, cod, imagini https; newline simplu → `<br />` (rezolvările pas cu pas se scriu natural). Utilitare: `stripLeadingTitle` (evită H1 dublat), `mdExcerpt` (meta description derivată), `validSlug`.

### Servirea SSR a articolelor
- **`api/page-meta.js`:** rutele `/rezolvari/{slug}` sunt detectate și servite complet: `<title>`/description din articol (un rând `seo_meta` pe aceeași rută le poate suprascrie — fine-tuning ulterior prin `set_page_meta`), `og:type=article` + `article:published_time/modified_time`, JSON-LD `Article`, iar **conținutul complet al articolului e injectat în `<div id="root">`** — crawlerele și share-urile văd articolul întreg fără JS; datele merg și în `<script id="__ARTICOL__">` (JSON cu `<` escapat), ca React să hidrateze fără a doua cerere. Slug inexistent/nepublicat sau invalid → **404 real cu `noindex`** (fără soft-404-uri indexate), cache CDN scurt (60s). Cache-uri în memorie ca la meta (60s/slug).

### Site (React)
- **`src/pages/ArticolPage.jsx` (NOU)** + ruta `/rezolvari/:slug` în `App.jsx` (lazy): breadcrumb, badge tip + categorie (link) + date publicare/actualizare, conținutul randat cu KaTeX, secțiunea „📚 Materiale folosite" (sources → link către pagina categoriei, cu tag Premium), CTA către materialele categoriei + `/preturi`, „Citește și:" (3 articole din aceeași categorie). La prima încărcare folosește datele injectate de server; la navigare client-side citește din Supabase (RLS: doar published).
- **`src/pages/RezolvariPage.jsx`:** încarcă și articolele publicate ca noi carduri (Gratuit + badge tip) lângă materialele video/PDF/imagine; filtrul „Toate tipurile" primește „📖 Articol / ✍️ Rezolvare scrisă / 💡 Explicație"; căutarea și filtrul pe categorie funcționează peste ambele liste; cardul duce la `/rezolvari/{slug}`.
- **`src/styles/global.css`:** stiluri `.articol-*` (tipografie articol, tabele cu `.table-wrap`, blockquote, cod, surse, CTA, articole înrudite) — folosite ATÂT de pagina React, CÂT ȘI de HTML-ul injectat server-side.

### Uneltele agentului (prin coada de aprobare)
- **`api/_lib/seo.js`:** citire nouă `list_articles` (anti-dubluri, obligatoriu înainte de publicare) și `read_article`; scriere nouă **`publish_article`** (validări stricte: slug unic `[a-z0-9-]`, title 10–120, description 40–200, categorie/kind din listă, conținut minim 800 caractere — anti „thin content", max 12 keywords, `sources` cu id-uri REALE verificate în DB și îmbogățite cu titluri) și **`update_article`** (doar câmpurile schimbate, cu valorile vechi păstrate; `publish=true` republică un draft). HTML-ul e generat LA PROPUNERE — adminul aprobă exact ce se publică. Execuție: insert/update în `articole` + retrimiterea automată a sitemap-ului către Search Console (best effort). Revert: publicarea → articolul revine în `draft` (conținut păstrat, dispare de pe site/sitemap); actualizarea → valorile vechi (cu regenerarea HTML-ului). Prompturile actualizate: sarcina `blog` scrie și propune articole complete (nu doar idei), `performance` include interogările fără pagină dedicată → articol nou și articolele care stagnează → refresh.
- **`src/components/SEOActionsQueue.jsx`:** preview complet pentru propunerile de articol (tip, slug, titlu, descriere, keywords, surse, conținutul RANDAT în `<details>`), diff-uri pe câmpuri la actualizări, butoane „↩️ Retrage articolul (înapoi în draft)" și „🔗 Deschide articolul" după execuție.
- **`src/components/AISEOAgent.jsx`:** presetul „Idei articole blog" → „Articole Rezolvări (scrie & propune)"; descrierea panoului menționează articolele.

### Teste și verificare
- **`test/articole.test.js` (NOU):** 13 teste — markdown (XSS: script/onerror/javascript: blocate; LaTeX intact; decalarea titlurilor; tabele+aliniere; liste imbricate; `<br />`), `articleShell`/`articleJsonLd`/`injectRoot`/`injectArticleData` (conținut în `#root`, JSON sigur fără `</script>`, fără `content_md` în browser), `categoryRoute`, validările `checkArticleField` și `resolveSources` (id-uri verificate în DB, pe client Supabase simulat).
- `npm test`: **47/47** (inclusiv cele vechi — injectarea meta neatinsă); `vite build` trece (chunk separat `ArticolPage`); handler-ul `page-meta` verificat end-to-end pe DB simulat (articol → 200 cu conținut în #root; slug inexistent → 404+noindex; rutele vechi neschimbate).

---

## 27 iulie 2026 — Subiecte PDF cu figuri geometrice + spații de redactare · „Subiect + instrucțiuni" la interactive

### Figuri geometrice în subiectele de examen generate cu AI (ca în modelele oficiale EN)
- **`src/lib/figureRender.js` (NOU):** bibliotecă de desen determinist — AI-ul descrie figura ca obiect JSON (cheia `figure` a itemului), iar clientul o desenează SVG în stilul subiectelor oficiale (linii negre subțiri, etichete italice serif, muchii nevăzute punctate). Tipuri: segment, unghi (cu bisectoare), triunghi (oarecare/isoscel/echilateral/dreptunghic, cu înălțime), pătrat, dreptunghi, paralelogram, romb, trapez (dreptunghic/isoscel), cerc (poligon înscris, puncte pe cerc, rază, diametru, coardă, tangentă), sistem de axe xOy cu graficul f(x)=ax+b, cub, paralelipiped, prismă, piramidă (cu înălțimea VO), con, cilindru, sferă, trunchi de con, trunchi de piramidă + puncte pe laturi și segmente suplimentare. Renderer-ul e defensiv: specificație invalidă → fără figură, PDF-ul rămâne intact (nu se aruncă excepții).
- **`api/ai-exam.js`:** promptul EN cere OBLIGATORIU `figure` la toți itemii Subiectului al II-lea și la problemele III.3–III.6 (nu la Subiectul I și III.1–III.2 — algebră), cu specificația completă a formatelor + exemple; literele figurii trebuie să coincidă cu enunțul. `maxTokens` 5000 → 7500 (figurile adaugă ~1000 tokeni; altfel JSON-ul se trunchia).
- **`src/lib/examPrint.js`:** figura apare SUB enunț, în DREAPTA paginii (float; variantele de răspuns curg în stânga ei), și în barem (scară 0.82). La **Subiectul al III-lea** (varianta elev, doar la subiectele „oficiale" — cu puncte din oficiu): spațiu de redactare a rezolvării — caroiaj discret desenat ca SVG (fundalurile CSS nu se tipăresc implicit, conținutul SVG da) — în STÂNGA figurii și DEDESUBTUL ei, respectiv sub fiecare cerință la problemele fără figură; punctajele subpunctelor apar ca „(2p) a)". Problemele cu spații pot curge pe mai multe pagini, dar caroiajele/figurile nu se taie la mijloc. Exporturile interactive/antrenament (fără oficiu) rămân neschimbate.
- Verificat vizual (Chromium): galerie cu toate tipurile de figuri + varianta elev + barem, comparate cu modelul oficial ENVIII 2025 var. 07.

### „Subiect (opțional)" → „Subiect + instrucțiuni pentru AI" la exercițiile interactive
- **`src/pages/ProfesorVirtual.jsx` (InteractiveTab):** câmpul a devenit textarea amplu (3 rânduri, pe toată lățimea), cu placeholder-exemplu de instrucțiuni compuse; pentru titluri/metadate (bibliotecă, teme, publicare) se folosește doar prima linie (max 120 caractere).
- **`api/ai-generate-interactive.js`:** textul integral (până la 2500 caractere) intră în prompt ca „SUBIECT + INSTRUCȚIUNI DE LA PROFESOR" cu PRIORITATE față de regulile de stil (temă, tipuri de întrebări, dificultate, restricții); numărul de întrebări devine variabil (implicit 5, între 3 și 8, la cererea profesorului); pentru căutarea RAG și titlu se folosește varianta scurtă; `maxTokens` 2200 → 3200.

---

## 23 iulie 2026 — Doi agenți AI pe Prof. Virtual: interactiv (neschimbat) + agent dedicat testelor PDF

### Agentul 1 — teste interactive și chat general: comportament identic
`api/_lib/ai.js`: `prepareChat` a devenit dispecer — sesiunile fără PDF merg prin `interactiveAgentSystem`, care asamblează EXACT promptul de până acum (persona, RAG, reguli interactive, protocol de acțiuni, catalog, motivare). Zero schimbări de comportament.

### Agentul 2 — teste PDF: persona proprie, baremul = sursă de adevăr
`pdfAgentSystem` construiește un prompt dedicat, cu misiunea în ordinea: (1) citește TOT testul și identifică exercițiul întrebat; (2) găsește itemul în rezolvarea-model (baremul asociat) și VERIFICĂ potrivirea (aceleași expresii/numere); (3) predă natural — întâi îndrumare, rezolvarea completă pe pași doar la cerere explicită. Schimbări față de vechiul flux:
- **Fără „conform baremului":** baremul e prezentat modelului ca „REZOLVAREA-MODEL (document intern — elevul NU îl vede)"; cuvântul „barem" e interzis în răspunsuri (excepție: elevul întreabă explicit de barem/punctaje). Răspunsul complet = TOȚI pașii povestiți („Pasul 1: ... pentru că ..."), nu anunțarea rezultatului.
- **Focalizare:** în sesiunile cu barem nu se mai injectează RAG generic, catalogul de exerciții și recomandările — doar testul + rezolvarea-model; „sursa" afișată elevului este chiar baremul asociat.
- **Context mărit:** textul testului până la 20000 caractere (`ai-pdf-context` + prompt), ca AI-ul să citească tot PDF-ul.
- Potrivirea strictă subiect↔barem (an/variantă/profil/sesiune + verificarea pe conținut din `_lib/barem.js`) rămâne activă; fără barem sigur → agentul spune sincer și rezolvă atent singur.

### Pipeline „rezolvarea din barem, nu alta" (fix pentru improvizații de tip 81/256)
Cauza problemei: modelul primea un prompt uriaș (tot testul + tot baremul + reguli) și improviza propria metodă în loc să urmeze fragmentul de barem. Acum, agentul PDF lucrează în 2 pași cu verificare:
1. **Extracție** (`extractBaremItem`): identifică exercițiul întrebat și copiază CUVÂNT CU CUVÂNT enunțul din test + fragmentul de barem (validate anti-halucinație pe numere).
2. **Generare FOCALIZATĂ:** când fragmentul există, promptul conține DOAR enunțul + rezolvarea + regulile (~2700 caractere în loc de ~30000) — modelul nu mai are din ce improviza. Temperatura 0.2.
3. **Verificare înainte de trimitere** (`verifiedPdfReply`, în ai-chat și ai-chat-stream — streamul se bufferizează și textul verificat pleacă în bucăți): (a) verificare numerică — numere ≥2 cifre care nu apar nici în rezolvare, nici în test = deviere (prinde „81/256"); (b) verificator LLM de fidelitate — prinde expresii stricate (ex. „m−3" în loc de „m²−3"). La deviere → o regenerare cu avertisment; dacă și a doua deviază → **fallback sigur**: se prezintă direct pașii baremului (fără punctaje). Elevul nu mai poate primi altă rezolvare decât cea din barem.
- Model opțional dedicat agentului PDF: `AI_PDF_CHAT_MODEL` în env (recomandat un model mai puternic decât gpt-4o-mini; folosit la extracție + generare).
- Model opțional dedicat GENERĂRII și CORECTĂRII: `AI_GEN_CHAT_MODEL` în env — folosit la generarea de teste de examen (`ai-exam`), teste interactive (`ai-generate-interactive`), exerciții de practică (`ai-practice:generate`) și la corectarea răspunsurilor elevilor (`ai-practice:check`, `ai-assignment:check`). Acolo modelul calculează singur, fără barem, deci merită cel mai puternic model. (Generatorul admin de exerciții folosește deja Claude, separat — neatins.)
- Simulare completă a scenariului raportat (polinom, $(x_1x_2x_3x_4)^2$): improvizația 81/256 e prinsă și corectată; „m−3" e prins de verificatorul semantic; fallback-ul funcționează; fluxul interactiv rămâne pe streaming normal.

### Biblioteca utilizatorilor: premium implicit + minim 3 gratuite, fără a suprascrie adminul
Publicările sunt premium implicit (`is_free: false`), iar sistemul menține minim 3 teste gratuite — acum cele mai RECENTE (înainte: cele mai vechi) — DAR cu memorie a deciziilor adminului: coloana nouă `free_set_by_admin` (script `supabase/public_library_pdf.sql`, idempotent) se setează la orice comutare manuală din admin („☆ Fă gratuit"/„★ Gratuit"), iar auto-promovarea nu atinge NICIODATĂ rândurile marcate așa (în niciun sens). Dacă adminul retrage un test de la gratuit, minimul de 3 se reface din alte teste, nu din al lui. Fallback tolerant dacă scriptul SQL nu a fost încă rulat.

### „Publică" pentru PDF-urile generate, direct din „Testele și exercițiile mele"
Subiectele generate (kind `exam` — JSON printabil; kind `pdf` — combinare exactă salvată în Storage) pot fi publicate în Biblioteca utilizatorilor și DUPĂ generare, nu doar imediat:
- **ProfesorVirtual → Testele și exercițiile mele:** buton „🏛️ Publică" pe rândul fiecărui subiect (doar profesori), cu stare „Se publică..." și mesaj de confirmare/eroare vizibil fără expand.
- **Server (`ai-public` publish):** PDF-urile din bucketul privat se COPIAZĂ în `public-library/…` (itemul public rămâne întreg chiar dacă profesorul își șterge itemul privat); la `get`, cititorii îndreptățiți primesc URL semnat (1h) generat cu clientul admin. La `delete` se șterge și copia din Storage.
- **Biblioteca utilizatorilor:** deschide și kind `pdf` („📄 Deschide PDF", fereastră deschisă sincron ca să nu fie blocată de browser); `getLibraryPdfBlob` preferă URL-ul semnat.
- **SQL nou:** `supabase/public_library_pdf.sql` — extinde CHECK-ul `ai_public_library.kind` cu 'pdf'. TREBUIE RULAT în Supabase → SQL Editor, altfel publicarea PDF-urilor exacte dă eroare de constrângere.

### Cerința „Arătați că" reconstruită din barem + generatorul interactiv cerea array în modul JSON-obiect
- **Enunț degradat → cerință greșită (radical pierdut, rezultat răsturnat):** radicalul √ e desenat în PDF, nu caracter — enunțul extras din test iese „∫f(x)(x+1)dx" în loc de „∫√(f(x)(x+1))dx", iar AI-ul parafraza enunțul stricat. Acum, la exercițiile „Arătați că / Demonstrați", cerința se RECONSTRUIEȘTE din barem în cod (`claimFromBarem`): membrul stâng = prima egalitate din fragment, rezultatul = ultimul „="; promptul primește „CERINȚA DE DEMONSTRAT … rezultatul final trebuie să fie EXACT …". La „Determinați…" nu se fabrică egalități (gardă pe tipul enunțului).
- **Generatorul interactiv pe GPT-5.x:** promptul cerea un ARRAY la nivel de vârf, dar `response_format: json_object` obligă modelul la un OBIECT — gpt-4o-mini încălca formatul și scotea array-ul, gpt-5.6 respectă strict → obiect → „nu e array" → „Generatorul nu a produs întrebări valide". Promptul cere acum `{"questions":[…]}`, iar parsarea despachetează tolerant orice formă (`questions`/`intrebari`/obiect indexat).

### Verificatorul semantic devine consultativ + retry și la trunchiere (nu doar la gol)
- **Fallback-ul brut aproape eliminat:** pe itemele de barem puternic deteriorate la extracție (integrale, fracții — „^{2}^{2}^{1}"), verificatorul semantic (model mic) respingea și răspunsuri corecte → elevul primea text brut. Acum verificările sunt pe două niveluri: BLOCANTE (răspuns gol/trunchiat; ≥2 numere străine = improvizație certă) pot duce la fallback; verificarea semantică e doar CONSULTATIVĂ — cere o regenerare, iar dacă și a doua încercare e „suspectă" semantic dar curată numeric, se trimite răspunsul redactat, nu molozul.
- **Retry și la trunchiere:** gpt-5.6-sol întorcea la generatorul interactiv JSON tăiat la mijloc (finish_reason=length cu conținut parțial), nu gol — reîncercarea cu buget maxim se declanșează acum și în acest caz. Repară definitiv „Generatorul nu a produs întrebări valide".
- Persona focalizată instruiește explicit reconstruirea coerentă a expresiilor sparte („nu copia molozul").

### Fine-tuning fiabilitate: auto-retry la răspuns gol, verificare numerică corectată, glife „□" curățate
- **Auto-vindecare în `chat()`:** dacă un model cu raționament întoarce conținut gol (a ars bugetul pe gândire — cazul generatorului interactiv pe gpt-5.6-sol), se reîncearcă automat O dată cu bugetul maxim (16000). Repară „Generatorul nu a produs întrebări valide" fără intervenția utilizatorului.
- **Verificarea numerică nu mai respinge răspunsuri corecte:** zecimalele derivate din fracții sparte la extracție (ex. „3,5" din 7/2) sunt acceptate dacă cifrele lor sunt permise, iar pragul de respingere e ≥2 numere străine (improvizația reală — 81 și 256 — e prinsă în continuare). Verificatorul semantic știe acum că rezolvarea-model vine din extracție imperfectă și reconstruirea coerentă a fracțiilor NU e deviere. Înainte, la întrebări succesive, respingerea greșită ducea pe fallback-ul cu text brut (redactare spartă).
- **Glifele nemapate din PDF** (zona privată a fontului, „□", „�") se elimină la extracție, împreună cu exponenții/indicii goliți — elevul nu mai vede „□^{□}".

### Buget de raționament pentru GPT-5.x (răspunsuri goale → KaTeX spart, JSON invalid, pagină albă)
Modelele GPT-5.x „ard" tokeni pe gândirea internă înainte de a scrie; cu bugetul clasic (900–5000) rămâneau des cu răspuns GOL sau trunchiat. Efecte văzute: agentul PDF pica pe fallback (textul brut al baremului, cu fracțiile sparte), generatorul de subiecte întorcea „format invalid", generatorul interactiv → pagină albă. Reparat:
- `buildBody`: la modelele cu raționament, `max_completion_tokens` = 3× bugetul cerut (min 3000, plafon 16000); modelele clasice neschimbate.
- `verifiedPdfReply`: răspuns gol/trunchiat = eșec explicit → retry → fallback; fallback-ul curăță „molozul" fracțiilor sparte (linii doar cu cifre/simboluri), fără punctaje, și oferă detalierea oricărui pas.
- `ai-generate-interactive`: validare strictă pe întrebări (enunț real, grile cu opțiuni și index valid, răspuns nevid); zero întrebări valide → 502 cu mesaj de reîncercare, nu `questions: []` cu 200 (pagina albă).
- `ai-exam`: test fără subiecte/itemi → 502 „test incomplet, mai încearcă" în loc de rezultat gol.

### Compatibilitate GPT-5.x + localizare deterministă a itemului de barem + fix zoom iOS
- **`max_tokens` → `max_completion_tokens`:** modelele GPT-5.x refuză `max_tokens` (eroarea „LLM 400 unsupported_parameter" la generare cu gpt-5.6-sol). `chat`/`chatStream`/`chatVision` construiesc acum corpul potrivit după model (max_completion_tokens + fără temperature la gpt-5.x/o-serie) și repară automat + reîncearcă la orice 400 „unsupported parameter". Aceeași eroare pică tăcut și extracția de barem (rula pe modelul PDF) — de aceea agentul „spunea de la el"; reparată implicit.
- **Itemul de barem se taie DETERMINIST, nu „citit" de AI:** referința elevului („subiectul III ex 2 b", „II.2.b", și moștenită din mesajele anterioare la „dă-mi rezolvarea completă" / „și punctul c?") e parsată în cod (`parseExerciseRef`) și fragmentul se taie pe structura oficială a documentului: SUBIECTUL al N-lea → „2." → „b)" (`sliceExercise`) — atât din barem, cât și enunțul din test. Zero șanse să confunde III.2.b (integrală) cu II.2.b (element neutru) sau cu polinomul de la alt subiect. Extracția AI rămâne doar pentru referințe vagi („problema cu vectorii"). Răspunsul începe obligatoriu cu numirea exercițiului și a cerinței lui reale.
- **Zoom blocat pe telefon:** inputul de chat avea font sub 16px → iOS mărește automat pagina la focus și rămâne așa. Font 16px pe inputul de chat și pe textarea de foto-rezolvare.

### Vectorii se citesc corect din PDF (nu mai apar „lungimi egale" în loc de „vectori egali")
`api/_lib/pdftext.js`: săgeata de deasupra literelor din $\vec{AB}$ (Word/MathType) ajungea în textul extras ca glife separate „ur/uur/uuur" pe o micro-linie deasupra rândului — se pierdea sau devenea fals „exponent", iar egalitățile de vectori se citeau ca egalități de lungimi. Acum: micro-liniile-săgeată sunt recunoscute (inclusiv mai multe săgeți pe același rând sau glife despărțite „uuu"+„r"), consumate, iar literele de sub ele devin `\vec{...}`; resturile lipite pe rând („AB uuur") se convertesc prin regex, iar zgomotul rămas se elimină. Exponenții reali (m², x^r) rămân exponenți — verificat cu teste sintetice (4/4), plus reguli explicite despre vectori în promptul agentului PDF.

---

## 22 iulie 2026 — Punctaje teste încărcate · Prof. Virtual în raport · context complet · PDF pe mobil

### #A — Testele HTML încărcate își salvează acum punctajul
**Înainte:** testele de liceu încărcate manual (ex. variantele BAC) își calculau scorul intern, dar nu îl trimiteau platformei (`MATE_SCORE` lipsea) → nu apărea nici la elev, nici la profesorul asociat.
**Acum:** `src/lib/tutorBridge.js` include un „reporter de scor" injectat automat: la „✓ Corectează" detectează punctajul (șablonul `PROBS/stats/GRADED` sau panoul final „X / Y puncte") și trimite `MATE_SCORE` către platformă. Protecții: nu raportează la simpla redeschidere, nu dublează la dublu-clic, nu re-raportează la navigare după corectare; fișierele care au deja `MATE_SCORE` propriu primesc flagul `__MATE_NATIVE_SCORE__` (fără raport dublu). Verificat cu simulare completă pe `bac-2014-varianta-7.html` (17/17 teste).

### #B — Raportul profesorului arată folosirea Prof. Virtual
`api/teacher-students.js` numără întrebările puse AI-ului per elev+material (din `ai_conversations.context.contentId` + `ai_messages` cu `role='user'`). În `TeacherResults`, lângă Punctaj / Nr. încercări / Timp apare coloana **„A folosit Prof. Virtual"** („Da, N întrebări" / „Nu"). În **Progres AI** (`StudentAIMastery`) apare lista „Teste rezolvate cu ajutorul Prof. Virtual" cu punctajul fiecărui test (sau „fără punctaj încă").

### #C — Prof. Virtual vede FIȘIERUL CURENT complet
Bridge-ul trimite acum întreg conținutul testului (toate exercițiile, cu subiecte și cerințe), plus detaliile exercițiului deschis; limită 14000 caractere (era 4000). Serverul (`api/_lib/ai.js`) acceptă context mărit (interactiv 14000, PDF 15000 — și `ai-pdf-context`) și are regulă explicită: la „exercițiul 3" / „subiectul II 2.b" caută exercițiul REAL în conținut, nu inventează enunțuri.

### #D — PDF pe telefon cu Prof. Virtual activ
`PDFViewer.jsx`: pe mobil PDF-ul se redă ÎN pagină (pdf.js de pe CDN, pagini pe `<canvas>`, zoom −/+), deci profesorul rămâne lângă material — nu se mai pierde în viewerul nativ / la descărcare. Dacă pdf.js nu se poate încărca, rămâne varianta veche („Deschide PDF-ul") ca rezervă.

---

## 🔴 CRITIC

### #1 — Autentificare reală pe tot API-ul (era falsificabilă)
**Înainte:** fiecare rută lua identitatea din `req.body.userId` + service_role key → oricine putea acționa ca oricine (ștergere cont, date admin, portal Stripe al altcuiva).

**Acum:** identitatea vine din tokenul de sesiune Supabase (`Authorization: Bearer …`), validat pe server cu `supabase.auth.getUser(token)`. `req.body.userId` nu mai e crezut niciodată.

- Nou: `api/_lib/http.js` → `authUser(req, supa)` (sursă unică de identitate).
- Toate rutele AI (`ai-chat`, `ai-chat-stream`, `ai-practice`, `ai-assignment`, `ai-exam`, `ai-vision`, `ai-transcribe`, `ai-feedback`, `ai-progress`, `ai-generate-interactive`, `ai-account`, `ai-activity`, `ai-teacher`, `ai-notify`, `ai-ingest`, `ai-public`) derivă `userId` din token.
- Toate rutele non-AI (`admin-stats`, `admin-users`, `rezolvari-admin`, `create-checkout`, `create-portal`, `get-file-url`, `rezolvare-url`, `asociere`, `teacher-manage`, `teacher-students`) la fel.
- Client: nou `src/lib/api.js` → `authHeaders()`; `aiClient.js` și toate cele 16 `fetch('/api/…')` din pagini atașează acum tokenul.
- `admin-stats`/`admin-users`/`rezolvari-admin` folosesc `requireAdmin()` pe identitatea reală.

### #2 — CORS restrângibil
`Access-Control-Allow-Origin` vine acum din `SITE_ORIGIN` (default `*` doar dacă nu e setat). Antetul `Authorization` a fost adăugat în `Access-Control-Allow-Headers` (altfel preflight-ul bloca tokenul).

### #3 — iframe-uri cu HTML generat, acum izolate (`sandbox`)
Adăugat `sandbox="allow-scripts"` pe iframe-urile care randează HTML de la AI/profesori: `AIAdminPanel`, `AssignmentSolver`, `BibliotecaUtilizatorilor`, `ProfesorVirtual` (×2). Nu mai pot accesa sesiunea Supabase din `localStorage`. (`InteractiveViewer` — conținut din Supabase Storage — lăsat intenționat.)

### #4 — Scoruri mai greu de falsificat
Handler-ele `MATE_SCORE` resping acum mesajele care nu vin dintr-un iframe (`e.source === window` → ignorat), blocând spoof-ul trivial din consolă. (Nota: validarea reală de scor rămâne pe server pentru exercițiile `practice`.)

---

## 🟠 Corectitudine

### #5 — `stripe` mutat în `dependencies`
Era în `devDependencies`, deși e cerut la runtime de 3 funcții → putea da `Cannot find module 'stripe'`.

### #6 — `@stripe/stripe-js` eliminat
Dependență moartă (0 importuri). Scos din `package.json` și din `manualChunks` (vite.config.js) → gata warning-ul „empty chunk".

### #7 — URL site corect la Stripe
`create-checkout`/`create-portal` folosesc acum `SITE_URL` (fallback `VERCEL_URL`), nu `NEXT_PUBLIC_SITE_URL` (proiectul e Vite, nu Next). Redirect-urile de checkout/portal ajung pe domeniul corect.

### #8 — `.gitignore` adăugat
Lipsea complet. Acum ignoră `node_modules`, `dist`, `.env*` (mai puțin exemplul), `jscpd-out` etc. — previne comiterea cheilor.

---

## 🟡 Cod duplicat eliminat
- **`api/_lib/http.js`** — sursă unică pentru CORS, guard de metodă, auth, admin, signed-URL. A eliminat boilerplate-ul CORS din ~10 rute, cele **3 implementări** diferite ale parserului de signed-URL (acum una singură, robustă) și verificarea de admin repetată.
- **`api/_lib/ai.js` → `prepareChat()`** — blocul RAG + conversație + istoric (identic în `ai-chat` și `ai-chat-stream`) extras într-un singur helper.
- **`src/components/OAuthButtons.jsx`** — butoanele Google/Discord + separator (identice în `Login` și `Register`).
- **`src/components/ExamContent.jsx`** — `ItemBlock`, `Section`, `TypeTabs` (aproape identice în `EvaluareNationala` și `Bacalaureat`; `profile` devenit opțional) — o singură sursă.
- **`Admin.jsx` → `ContentMetaFields`** — câmpurile titlu/categorie/subcategorie/profil, partajate de Upload PDF și Upload Interactive.
- **`src/components/LegalSection.jsx`** — componenta `Section` (identică în 4 pagini legale) extrasă o singură dată.
- Duplicare totală: **659 → 359 linii** (4,62% → 2,57%), adică 44 → 30 clone. `Admin.jsx`: 939 → 905 linii.

---

## 🟢 Îmbunătățiri
- **`src/components/ErrorBoundary.jsx`** — nicio eroare de randare nu mai duce la ecran alb; se afișează un mesaj + butoane „Reîncarcă / Acasă".
- **Lazy-loading rute** (`App.jsx`) — toate paginile în afară de Home sunt `React.lazy` + `Suspense`. **JS inițial: 348 KB → 88 KB** (gzip 87 → 27 KB). Admin (938 linii), ProfesorVirtual etc. se încarcă doar la nevoie.
- **Teste** (`test/`, `npm test`) — `node --test`, fără dependențe noi: parsarea căilor Storage (4 teste) + token semnat round-trip/tamper (3 teste).
- `parseStoragePath()` extras ca funcție pură (testabilă).

---

## Variabile de mediu noi (setează în Vercel)
- `SITE_ORIGIN` — origine permisă CORS (ex: `https://examenmate.com`).
- `SITE_URL` — URL public pentru redirect-uri Stripe (înlocuiește `NEXT_PUBLIC_SITE_URL`).

Vezi `.env.ai.example` (secțiunea „SECURITATE / URL-uri").

## Verificare
```
npm install
npm run build   # ✓ 133 module
npm test        # ✓ 7/7
```

---

## ✏️ Modificări UI (la cerere)
- **Etichetă „Profesor Virtual" în funcție de rol** (nou `src/lib/aiLabel.js`): cont profesor → „Asistent AI pentru profesori"; cont părinte → „Asistent AI pentru părinți"; elev/nelogat → rămâne „Profesor Virtual". Aplicat în Navbar (desktop + mobil), titlul paginii `ProfesorVirtual` și cardul din `Profile`.
- **Biblioteca utilizatorilor**: butonul „📤 Trimite elevilor" nu mai apare pentru conturile de **elev** (`!isStudent`). Rămâne fluxul „Deschide" → „Verifică".

---

## 🔧 Hotfix — token expirat („sesiune expirată", materiale invizibile până la reconectare)
**Cauză:** după fix-ul #1, serverul (și PostgREST, pentru interogările directe) resping tokenul de sesiune EXPIRAT. Tokenul Supabase expiră după ~1h (tab lăsat deschis, laptop în sleep), iar înainte API-ul nu-l valida deloc, deci expirarea nu se vedea. De aici: „sesiune expirată" la Raport AI, materiale care apar în Admin doar după reconectare, ștergere blocată în Bibliotecă și încetineli/cascade de erori.

**Fix (auto-vindecare a sesiunii, `src/lib/api.js`):**
- `getValidSession()` — reîmprospătează PROACTIV tokenul dacă expiră în <30s, cu **dedup** (o singură reîmprospătare în zbor) ca să nu declanșeze coliziuni de rotație a refresh-token-ului.
- `authHeaders()` folosește tokenul valid; `apiPost()` și `aiClient.post()/chatStream()` **reîncearcă o dată pe 401** după o reîmprospătare forțată.
- `AuthContext` reîmprospătează sesiunea când utilizatorul **revine în tab / revine online** (`visibilitychange`/`focus`/`online`) — evită JWT-ul expirat la interogările directe Supabase.
- `Admin` cere un token proaspăt înainte de a citi lista de materiale (rezolvă „materialele apar doar după reconectare").

Rezultat: acțiunile nu mai cer reconectare manuală; tokenul se reînnoiește singur în fundal.

---

## 🔧 Hotfix 2 — pagină albă pe mobil la redeschiderea browserului (după redeploy)
**Cauză:** lazy-loading-ul (introdus la optimizare) împarte aplicația în multe chunk-uri hashuite. După un redeploy, un tab vechi ținut „înghețat" pe mobil cere fișiere JS cu hash vechi care nu mai există (404) → pagină albă până la refresh manual. NU e legat de token/sesiune.

**Fix:**
- `index.html` (și restul, mai puțin `/assets/`) — `Cache-Control: max-age=0, must-revalidate` în `vercel.json`; asset-urile hashuite rămân `immutable`. Browserul ia mereu HTML-ul curent (deci hash-urile corecte), fără pagină albă din cache vechi.
- `main.jsx` — ascultă `vite:preloadError`: dacă un chunk lazy lipsește (redeploy cât tab-ul era deschis), reîncarcă automat o singură dată (anti-buclă cu marcaj de timp).
- `App.jsx` — `ErrorBoundary` ridicat deasupra `AuthProvider` (plus unul intern): orice eroare arată ecranul „Reîncarcă", nu pagină albă.

---

## ✏️ Modificări UI 2 (la cerere)
**1) Asistent AI pentru profesori/părinți** (diferit de tutorele elevilor):
- Butonul/tab-ul „Întreabă profesorul" devine **„Întreabă Asistentul"** pentru profesor/părinte (nou `askAiLabel` în `src/lib/aiLabel.js`) — în pagina Asistent, în widgetul plutitor și la butonul din foto-rezolvare.
- Modurile „Învață-mă / Teoria / Dă-mi un indiciu" sunt înlocuite, pentru profesor/părinte, cu **„Examene"** și **„Elevi"** (`MENTOR_MODES` în `AITutor.jsx`). Elevii păstrează modurile vechi.
- Server (`api/_lib/ai.js` → `systemFor`): persona nouă **pentru adulți** + **hartă de linkuri interne** (`SITE_MAP`). Asistentul răspunde acum și despre: navigarea în site și **unde se găsesc fișierele** (ex. „subiecte de Evaluare Națională" → `/evaluare-nationala`), **elevii asociați** (rezultate + raport AI în `/profil`, asociere prin cod, grupe, teme), **planuri de lecție** și structura examenelor — pe lângă matematică.

**2) Ștergerea materialului șterge și notificarea:**
- La adăugarea unui material, un trigger creează un anunț în `ai_broadcasts`. Acum, la ștergere, anunțul se șterge automat.
- **Primar (atomic):** `supabase/ai_tutor_v6.sql` — trigger `AFTER DELETE` pe `content` (rulează-l o dată în Supabase → SQL Editor).
- **Fallback (fără SQL):** acțiune nouă `broadcast_delete_by_content` în `api/ai-notify.js`, apelată din `Admin.jsx` la ștergere — merge imediat chiar dacă nu rulezi încă SQL-ul.

---

## ✏️ Modificări UI 3 + arhivă
**Widget „Prof. Virtual" pentru profesor/părinte:** se deschide implicit pe **„Generează subiect examen"**, iar butonul **„Întreabă Asistentul"** e alături (taburile sunt reordonate: examen întâi). Elevii păstrează comportamentul vechi (deschidere pe chat).

**Eroare „Path too long" la dezarhivare (0x80010135):** arhiva nu mai are folderul-înveliș redundant `mate-online-main/` (Windows adăuga încă unul la extragere → căi prea lungi), iar fișierul SQL nou a fost redenumit scurt `supabase/ai_tutor_v6.sql`. Cea mai lungă cale internă: 63 → 41 caractere. Dacă tot apare eroarea, extrage într-o cale scurtă (ex. `C:\em`) sau folosește 7-Zip.

---

## ✏️ Modificări UI 4 (asistent profesor/părinte — chat)
- În chat („Întreabă Asistentul") s-au **scos butoanele de mod „Examene"/„Elevi"** (selectorul de moduri e ascuns pentru profesor/părinte).
- Sugestiile din chat au fost înlocuite cu **3 butoane de navigare** (nu mai trimit mesaj):
  1. „Unde găsesc subiecte de examen?" → **Home**, derulează la secțiunea de examene (`#examene`).
  2. „Unde găsesc statistici despre elevi?" → **Contul meu** (`/profil`).
  3. „Generează subiect examen sau exercițiu interactiv" → **Asistentul AI** (`/profesor-virtual`).
- Widgetul se deschide **din nou implicit pe „Întreabă Asistentul"**, cu „Generează subiect examen" alături (ordinea revenită).

---

## 🔧 Reparații 15.07.2026 — generator OpenAI + biblioteca personală

### #A — Generatorul de subiecte (OpenAI) combină acum REAL Simulări + Variante Date (mix)
**Înainte:** deși interogarea includea subcategoria `variante`, sursele erau limitate la primele 5 rânduri stratificate; dacă un PDF din Variante Date nu avea text extractibil (ex. scanat), cădea tăcut și testul se combina doar din Simulări.

**Acum (`api/ai-exam.js`, `api/ai-generate-interactive.js`):**
- se parcurge TOATĂ coada stratificată — dacă un PDF pică la extragere, se încearcă următorul din aceeași subcategorie, până sunt acoperite toate subcategoriile-sursă;
- sursele EN sunt exact ca rubrica „Simulări + Variante Date (mix)" a agentului Claude: `['simulari', 'variante']`;
- literele din planul de combinare alternează subcategoriile (Simulări ↔ Variante), deci itemii sunt un mix real;
- fiecare TEST-sursă e etichetat cu subcategoria lui, iar prompt-ul cere explicit mix din toate;
- răspunsul întoarce `combinedFrom` (sursele folosite), afișat în generator: „Itemii au fost combinați din: …".

### #B — Subiectele combinate exact se salvează în „Testele și exercițiile mele"
**Cauza reală:** PDF-ul combinat era salvat ca base64 în `payload`-ul jsonb; API-ul Supabase (PostgREST) respinge cererile JSON mari (~>1 MB) cu eroarea 413 → salvarea eșua mereu (și, în agentul Claude, eroarea era înghițită tăcut).

**Acum:** PDF-ul merge în **Storage** (bucket privat `personal-pdfs`, max 25 MB/fișier), iar în tabel se salvează doar calea (`payload.pdfPath`).
- Nou: `supabase/personal_pdfs_bucket.sql` — **rulează-l o dată în Supabase → SQL Editor** (creează bucketul + politicile owner-only și permite `kind='pdf'`).
- `aiClient.savePdfLibraryItem()` (upload + fallback base64 doar sub 700 KB), `aiClient.getLibraryPdfBlob()` (deschidere din Storage sau din base64 vechi), ștergerea elementului șterge și fișierul din Storage.
- `ExamGenerator` și `AIExerciseAgent` folosesc noul mecanism; dacă salvarea totuși eșuează, MOTIVUL se afișează (nu mai e tăcut).

### #C — Fracțiile nu se mai taie sus în fișierele generate (PDF/print + interactive)
În `examPrint.js` și `quizRender.js`, formulele KaTeX primesc:
`.katex { display:inline-block; padding:.4em .05em .25em; margin:-.4em -.05em -.25em }` — rândul crește cât formula, iar cutia formulei are „aer" de protecție deasupra numărătorului, compensat cu margini negative (spațierea vizibilă rămâne identică; verificat pixel-cu-pixel pe PDF generat cu Chrome headless).

### #D — Subiectul I fără geometrie (Evaluare Națională)
`api/ai-exam.js`: regulă explicită în prompt („SUBIECTUL I este EXCLUSIV aritmetică și algebră — NICIUN item de geometrie…"), iar planul de combinare EN e acum poziție-cu-poziție (I.1–I.6 doar algebră, II.1–II.6 geometrie, III.1–III.6 conform structurii oficiale); dacă itemul-sursă indicat e de geometrie, se alege un item de algebră.

---

## 🔧 Reparații 16.07.2026 — combinarea exactă (fără AI) + tutorele elevilor

### #E — „Păstrează datele problemelor" combină acum toate subcategoriile (nu doar Simulări)
**Cauzele reale (`src/lib/pdfCombine.js`, `ExamGenerator.jsx`, `AIExerciseAgent.jsx`):**
1. interogarea lua un eșantion NESORTAT de 60 de rânduri → Variantele Date lipseau des → acum: ordonat după cele mai recente + limită 300;
2. se opreau la primele 5 fișiere stratificate: dacă un PDF pică (download / scanat / fără structură), NU era înlocuit → acum `fetchPdfSources` încearcă URMĂTORUL fișier din aceeași subcategorie, cu probă de structură (`probeExamPdf`) înainte de acceptare, până acoperă toate subcategoriile;
3. plafon pe subcategorie → mix ECHILIBRAT (ex. 2 simulări + 2 exerciții pe subiecte + 1 variantă, nu 4+1); sursele apar în raport cu subcategoria: „Titlu [variante]".

### #F — Geometria nu mai poate ajunge la Subiectul I în combinarea exactă
**Cauza:** pdf.js sparge literele („SUBIECTUL a l I I - l e a"), iar numărul subiectului era citit din textul brut → antetul Subiectului II (geometrie) era uneori luat drept Subiectul I, și itemii lui de geometrie primeau cheile 1.x.
**Fix (`analyze` din `pdfCombine.js`):** numărul se citește din textul normalizat (fără spații/diacritice), STRICT imediat după „subiectul(al)"; în plus, sursele cu subiecte dublate sau în ordine greșită (I→II→III obligatoriu crescător) sunt refuzate și înlocuite automat.

### #G — Tutorele elevilor recomandă testele și exercițiile interactive
`api/_lib/ai.js`: la modurile de elev (tutor / teorie / indiciu / asistent), promptul include acum `STUDENT_TIP` — când elevul cere ajutor la învățat/exersat/pregătire, tutorele îi recomandă natural testele și exercițiile INTERACTIVE din site (verificare pe loc, rezolvări imediate, explicații la fiecare întrebare), cu link intern potrivit (/evaluare-nationala, /bacalaureat, /clase/5…12, /biblioteca-utilizatorilor, /profesor-virtual).

### #H — Audit UI + hotfix-uri din changelog
Verificate în cod, toate EXISTĂ deja în acest folder: aiLabel (Navbar/Profil/pagină), ascunderea „Trimite elevilor" pentru elevi, Hotfix token expirat (`api.js`, `AuthContext`, Admin), Hotfix 2 pagină albă (`vercel.json`, `main.jsx` preloadError, ErrorBoundary), moduri mentor + SITE_MAP, `broadcast_delete_by_content`, butoanele de navigare din chat + ancora `#examene`, widget implicit pe chat. Dacă pe site-ul live lipsesc, diferența e între repo-ul deployat și acest folder → redeploy cu conținutul de aici.

---

## ✏️ Modificări UI 5 — widgetul plutitor pe rol
În conturile de **profesor** și **părinte**, widgetul plutitor se numește acum **„Asistent AI"** (eticheta de lângă buton, antetul ferestrei și `aria-label`); pentru elevi/nelogați rămâne „Prof. Virtual". (`src/components/AITutor.jsx` — `widgetLabel` după rol.)
