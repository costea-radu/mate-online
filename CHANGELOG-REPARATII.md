# Changelog reparații — ExamenMate

Toate fix-urile din raportul de debug, aplicate în ordine. Build-ul trece (`vite build`, 133 module), testele trec (`npm test`, 7/7), toate rutele API validate sintactic.

---

## 16 august 2026 (3) — „Resetează" funcționează și la testele de BAC + invitația „Instalează aplicația" nu mai apare celor care o au deja

Cererea: 1) la testele de BAC butonul „Resetează" nu făcea nimic — trebuia să ieși din test și să-l repornești ca să se golească (la Evaluare Națională mergea); 2) căsuța „Instalează aplicația" apărea și când aplicația era deja instalată.

### 1) 🔁 Butonul „Resetează" — garantat funcțional la TOATE testele interactive
**Cauza:** testele de BAC sunt fișiere HTML încărcate/generate, salvate în Supabase Storage — fiecare cu propriul cod de resetare. La unele variante funcția e defectă sau blocată de sandbox-ul iframe-ului (fără `allow-modals`, un `confirm(...)` din funcția de reset e ignorat de browser și resetarea se oprește acolo), așa că scorul și răspunsurile rămâneau pe ecran. Șablonul standard EN (`template-standard.html`) are `resetAll()` corect — de asta la EN mergea.
**Reparația (fără să umblăm la fișierele din baza de date):** plasă de siguranță în puntea deja injectată în fiecare test (`src/lib/tutorBridge.js`): după orice apăsare pe un buton de tip „Resetează" se verifică la 0,6s dacă testul chiar s-a golit (starea șablonului de examen `GRADED`/`ST`, carduri corectate `.opt.ok/.err`, panoul final vizibil, scor nenul în bara „Scor: X/Y pct"). Dacă NU s-a golit → mesaj nou `MATE_RESET_REQ` către pagina-părinte, iar `InteractiveViewer.jsx` reîncarcă exercițiul de la zero (iframe cu `key` nou): scor 0, răspunsuri goale, cronometru repornit, pastilele „Scor salvat"/eroare curățate — identic cu ieșire + repornire, dar într-un singur click. Resetările native care funcționează (EN) nu sunt atinse; un „Resetează" apăsat pe un test neînceput nu face nimic (corect).

### 2) 📲 Invitația de instalare — ține minte că aplicația e instalată
**Cauza:** vizibilitatea căsuței depindea doar de `beforeinstallprompt` + `display-mode: standalone`. În tab normal de browser, cu aplicația deja instalată, unele browsere (Edge, alt profil etc.) tot emit evenimentul → căsuța reapărea; pe iOS apărea mereu după 3 secunde.
**Reparația:** `src/lib/installPrompt.js` memorează instalarea în `localStorage` (`em_pwa_installed`): la `appinstalled`, la fiecare pornire în fereastra proprie a aplicației (pe desktop/Android aplicația instalată împarte localStorage cu browserul, deci și tab-urile normale află) și proactiv prin `navigator.getInstalledRelatedApps()` (Chrome/Edge) — pentru asta manifestul se declară pe sine în `related_applications` (vite.config.js). Flagul se șterge singur DOAR când API-ul confirmă că aplicația nu mai e instalată → după dezinstalare invitația reapare. `InstallPrompt.jsx` (căsuța plutitoare) și `AccountSettings.jsx` (rândul din „Setări cont" — arată acum „✅ Aplicația este instalată" și în tab normal, nu doar în fereastra aplicației) folosesc noul `isInstalled()`.

**Verificat:** `vite build` trece; `related_applications` prezent în manifestul generat; teste comportamentale (jsdom) pe plasa de siguranță — 4 scenarii, toate trec: reset defect → se cere reîncărcarea; reset funcțional → nu intervenim; șablonul EN real (`template-standard.html`) → `resetAll` nativ merge și nu intervenim; test neînceput → nimic.

Fișiere: src/lib/tutorBridge.js, src/pages/InteractiveViewer.jsx, src/lib/installPrompt.js, src/components/InstallPrompt.jsx, src/components/AccountSettings.jsx, vite.config.js, acest changelog.
---

## 16 august 2026 (2) — Citirea PDF-urilor trece pe „terra" (gpt-5.6) — implicit, nu doar din env

Cererea: „la citirea PDF-urilor să folosească varianta gpt terra, pentru o mai bună citire — e deja folosit terra?" Răspunsul găsit în cod: NU garantat. `PDF_MODEL` cădea pe modelul de chat obișnuit dacă `AI_PDF_CHAT_MODEL` nu era setat în Vercel (terra era doar „exemplul recomandat" din comentariu), iar conversația obișnuită cu Prof. Virtual pe un PDF deschis — exact cazul din captura cu „a³ = b⁴" — folosea ORICUM modelul de chat (`CHAT_MODEL`, implicit gpt-4o-mini), nu modelul de PDF: `PDF_MODEL` se folosea doar pe drumul cu răspuns verificat din barem.

### 🧠 Ce s-a schimbat
1. **`api/_lib/ai.js`:** `PDF_MODEL` are acum implicit `gpt-5.6-terra` — nu mai depinde de env ca să fie un model bun la citit. `AI_PDF_CHAT_MODEL` rămâne suveran dacă e setat (deci dacă în Vercel există deja variabila pe alt model, ea câștigă — de șters sau de pus pe terra).
2. **`api/ai-chat.js` + `api/ai-chat-stream.js`:** pe un PDF deschis (`context.pdf` — același semnal care alege promptul de agent PDF în `prepareChat`), și răspunsurile FĂRĂ barem folosesc `PDF_MODEL`, nu `CHAT_MODEL`. Până acum terra ar fi citit doar răspunsurile trecute prin barem; întrebările libere despre test („explică-mi ex. 2") mergeau la modelul ieftin.
3. **Costuri, neschimbate ca mecanism:** `pickModel` coboară în continuare automat pe modelul standard peste bugetul zilnic soft (terra e tratat ca model premium, exact ca până acum la barem), prețurile `gpt-5.6-*` există deja în tabel, iar limitele pe oră/cotele free rămân cele din GHID_LIMITE_AI.
4. **Documentat:** `.env.ai.example` (variabilele `AI_PDF_CHAT_MODEL`/`AI_GEN_CHAT_MODEL` lipseau din el) + GHID_CORECTARE_PDF.

Împreună cu fix-ul de mai jos (fracțiile extrase corect ca `\frac{a}{3}`), citirea PDF-urilor stă acum pe amândouă picioarele: text extras corect + model care îl citește atent.

**Teste: 170/170 trec** (implicitul nou verificat: `PDF_MODEL` = terra fără env, env-ul câștigă când există). Zero schimbări în frontend.

Fișiere: api/_lib/ai.js, api/ai-chat.js, api/ai-chat-stream.js, .env.ai.example, GHID_CORECTARE_PDF.md, acest changelog.
---

## 16 august 2026 — Profesorul Virtual citea fracțiile din PDF ca puteri („a³ = b⁴ = 5")

**Simptomul (raportat la Subiectul I, ex. 2 dintr-o variantă EN):** enunțul „Știind că a/3 = b/4 = 5, rezultatul calculului a + b este egal cu:" era explicat de Prof. Virtual ca „a³ = b⁴ = 5 … expresie cu puteri" — numitorul ajungea la putere și tot raționamentul pornea de la alt exercițiu.

### 🔎 Cauza, găsită cu geometria reală a PDF-urilor făcute în Word
Fracțiile etajate ajung în stratul de text al PDF-ului ca glife separate: numărătorul cu ~4–7pt DEASUPRA liniei de bază, numitorul cu ~4–7pt SUB ea, iar bara de fracție e desenată vectorial — invizibilă la extragere. Pasul de exponenți/indici din `api/_lib/pdftext.js` (corect pentru „m²", „x₁") vedea numărătorul ca „exponent" și numitorul ca „indice": „a/3 = b/4 = 5" ieșea `_{3}^{a} = ^{b}_{4} = 5`, iar AI-ul reconstruia cel mai plauzibil enunț din acel terci: puteri. Reprodus 1:1 pe PDF-uri sintetice cu metrici Word (corp 11/12), MathType (glife mari, care înainte rămâneau împrăștiate pe rânduri separate: „a b" / „3 4") și fracții „strânse".

### 🔧 Reparația: pas nou 2b în `linesFromTextContent` — fracțiile devin `\frac{num}{den}`
Înainte de pasul de exponenți/indici, perechile numărător-deasupra + numitor-dedesubt, suprapuse pe orizontală și cu rândul de bază liber în dreptul barei, se rescriu explicit ca `\frac{a}{3}` pe rândul de bază — AI-ul primește acum „Știind că \frac{a}{3} = \frac{b}{4} = 5". Garduri, ca să nu apară fracții false:
- „x" cu indice ȘI exponent (x₁², Viète) NU e fracție — perechea lipită de litera de bază e lăsată pasului de sup/sub;
- tabelele compacte NU sunt fracții — distanța pe verticală trebuie să fie de fracție (raportată la corpul glifelor), nu de rânduri de tabel;
- rândurile obișnuite de text NU se ating — se cere un al treilea rând ÎNTRE numărător și numitor (linia de bază, cu „=" etc.), ceea ce două rânduri normale de text nu au niciodată;
- acoperă și: numărători compuși („x + 1"), un indice interpus pe rând (cazul MathType), bara desenată ca text („—", consumată), două fracții pe același rând.

Efect în lanț: același extractor e folosit de TOATE pipeline-urile (Prof. Virtual pe PDF-ul deschis, corectarea „📝 Răspunde în chat", potrivirea baremului PE CONȚINUT, generarea de exerciții din surse) — toate citesc acum fracțiile corect. Exponenții, indicii și săgețile de vector existente rămân neatinse.

Teste noi în `test/pdftext.test.js` (9): bug-ul exact (fracția NU mai iese sup/sub), exponenți/indici păstrați, x₁², tabele compacte, rânduri scurte de text, numărător compus + indice interpus, bara-text consumată, cutBarem. **Teste: 170/170 trec.** Zero schimbări în frontend — build neafectat.

Fișiere: api/_lib/pdftext.js, test/pdftext.test.js (nou), acest changelog.
---

## 14 august 2026 (5) — Lint-urile Supabase din raportul de azi: recidiva explicată și reparată la sursă

Raportul Advisors (CSV, 14 august): 2 warninguri.

### 1) 🔁 „Function Search Path Mutable" pe `med_profile_touch` — RECIDIVĂ, cu cauza găsită
Mai fusese reparat pe 7 august prin ALTER (fix_security_lints_aug2026.sql), dar warningul a REVENIT — și ar fi revenit la nesfârșit: meditatii_schema.sql definește funcția cu `create or replace` FĂRĂ search_path, iar fiecare re-rulare a schemei (adică fiecare update la Meditații) reseta setarea pusă de ALTER. Reparat la sursă, în trei locuri:
- **supabase/meditatii_schema.sql** — `set search_path = public` chiar în definiția funcției `med_profile_touch`; orice re-rulare viitoare păstrează setarea;
- **supabase/ai_tutor_schema.sql** — la fel pentru `aik_tsv_update` (singura altă funcție din fișiere cu aceeași capcană — prevenim înainte să apară în raport);
- **supabase/fix_lints_14aug2026.sql (NOU — DE RULAT o dată în SQL Editor)** — ALTER pe ambele funcții, ca baza de date să fie corectă ACUM, fără re-rularea schemelor; include interogarea de verificare.

Verificat pe un Postgres 16 curat: definițiile patchate compilează, `proconfig` arată `search_path=public` pe ambele funcții, iar triggerul `trg_med_profile_touch` chiar setează `updated_at` după schimbare.

### 2) 🔒 „Leaked Password Protection Disabled" — nu se poate rezolva pe planul Free
Verificarea parolelor compromise (HaveIBeenPwned) există DOAR pe planul Pro sau mai sus; pe Free comutatorul nu poate fi activat, deci warningul rămâne afișat orice am face. Intră pe lista scurtă „la trecerea pe Pro": Authentication → Sign In / Up → Password Protection → „Prevent use of leaked passwords" — un click, fără cod.

Fișiere: supabase/meditatii_schema.sql, supabase/ai_tutor_schema.sql, supabase/fix_lints_14aug2026.sql (nou). Zero schimbări în codul aplicației — build/teste neafectate (161/161, ca la intrarea (4)).
---

## 14 august 2026 (4) — Pregătire pentru trafic mare: singura grijă la creștere rămâne planul Supabase

Obiectivul cererii: arhitectura să țină un număr mare de utilizatori fără alte intervenții în cod — când vine traficul, singurul pas rămas să fie upgrade-ul de plan în Supabase (Free → Pro → tier de compute mai mare), adică o setare plătită, nu o rearhitecturare. Patru schimbări:

### 1) 🌍 Funcțiile Vercel rulau în SUA; baza de date e la Frankfurt
`vercel.json` nu seta nicio regiune → toate rutele API rulau în `iad1` (SUA, implicitul Vercel), iar FIECARE cerere făcea 3–6 interogări către Supabase (eu-central-1, Frankfurt): tot atâtea drumuri peste Atlantic a ~90 ms, la fiecare apel, pentru orice utilizator, indiferent de trafic. Adăugat `"regions": ["fra1"]` — funcțiile rulează de-acum la Frankfurt, lipite de baza de date; interogările coboară la câteva ms, iar utilizatorii din România sunt și ei aproape. Probabil cel mai mare câștig de viteză din toată lista, gratuit. Intră în vigoare la primul deploy.

### 2) 🔑 Sesiunea se verifică LOCAL — a dispărut un apel de rețea din FIECARE cerere API
`authUser()` (api/_lib/http.js — folosit de TOATE rutele, direct sau prin `_lib/ai.js`) chema `supa.auth.getUser(token)`: un drum de rețea la Supabase Auth per cerere, +50–150 ms latență și presiune pe Auth exact când traficul crește. Tokenul e însă un JWT semnat de propriul proiect, deci acum îl verificăm criptografic LOCAL (`verifyJwtLocal`, fără dependențe noi — doar `node:crypto`): semnătura (chei ASIMETRICE din JWKS-ul public al proiectului, ținut în cache 10 minute per instanță; sau HMAC, dacă proiectul e pe „Legacy HS256" și există `SUPABASE_JWT_SECRET` în Vercel), expirarea, emitentul (doar proiectul nostru) și audiența (`authenticated`). Orice caz neacoperit (fără secret, JWKS indisponibil, algoritm necunoscut, token alterat) → fallback EXACT pe drumul vechi — nimic nu se poate strica, doar drumul de rețea dispare în cazul obișnuit. Compromis standard, asumat: un token rămâne valabil până la expirare (≤1h) chiar dacă sesiunea a fost închisă între timp de pe alt dispozitiv.

### 3) 📉 Polling-ul din fundal nu mai bate serverul degeaba
Navbar (indicatorii de forum) și clopoțelul de notificări interogau la fiecare 60 s, în fiecare tab deschis, inclusiv ASCUNS în fundal — 1.000 de tab-uri lăsate deschise ≈ 33 de cereri/sec non-stop numai din asta. Acum: (a) tab ascuns → nu se interoghează deloc; (b) la revenirea în tab → reîmprospătare IMEDIATĂ (utilizatorul nu simte nicio diferență); (c) intervalul 60 s → 120 s. Fișiere: src/components/Navbar.jsx, src/components/AINotifications.jsx.

### 4) 🗂️ Indexuri pentru interogările repetitive + baza de date nu mai crește nelimitat
- **supabase/perf_indexes.sql (NOU — DE RULAT o dată în Supabase → SQL Editor):** `idx_disc_created` (countul „activitate nouă pe forum" nu mai citește tot tabelul discussions la fiecare tic, pentru fiecare vizitator), `idx_disc_parent_created` („răspunsuri la postările mele") și `idx_usage_time` (rapoartele + alarma de cost filtrează ai_usage global după dată; indexul existent începe cu user_id și nu ajută acolo).
- **api/account-cleanup.js:** cronul zilnic tunde acum și `ai_usage` la 90 de zile (bugetele folosesc maxim 30 de zile în urmă — ai_spent/ai_spent2; rapoartele 24h) — în loturi de 1000, cel mult 20 de loturi/rulare, best-effort: o eroare aici nu blochează niciodată curățarea conturilor. În rezumat apare `usagePruned`.

### După deploy (o singură dată)
1. Rulează `supabase/perf_indexes.sql` în SQL Editor.
2. DOAR dacă proiectul e pe „Legacy HS256" (Supabase → Settings → API arată „JWT Secret" în loc de „JWT Signing Keys"): copiază secretul în Vercel ca variabila `SUPABASE_JWT_SECRET`. Cu chei asimetrice nu e nevoie de nimic — JWKS-ul e public și merge singur.
3. Nimic altceva — fallback-urile păstrează comportamentul identic până sunt făcute cele de mai sus.

Teste noi în test/http.test.js: HS256 valid / expirat / falsificat / alt proiect / audiență greșită / `alg:none`; lipsă secret → fallback; ES256 cu cheia din JWKS (+ respinge semnătura mutată pe alt conținut). **Build: ✓ 158 module. Teste: 161/161 trec.**
---

## 14 august 2026 (3) — Meditații: data lucrării modificabilă + pregătire „doar Subiectul I / II / I+II" · Profesor: „alt capitol" scris liber + itemi grilă/redactare

### 🎓 Contul de elev (Meditații cu AI)
1. **Data lucrării se schimbă direct din bannerul 🎯** („Astăzi" → câmpul „📅 Data testului"): alegi altă dată și recapitularea se recalculează (zile rămase + ritm). Merge în continuare și din „✏️ Modifică" (formularul complet); ștergerea datei = recapitulare fără termen.
2. **Pregătirea de examen pe SUBIECTE** — card nou în „Astăzi" (doar la elevii cu examen-țintă): „Tot examenul (implicit) / Doar Subiectul I / Doar Subiectul al II-lea / Subiectele I și II". Meditatorul se adaptează peste tot:
   - **planul**: capitolele subiectelor alese au prioritate (EN: Subiectul I = aritmetică/algebră, Subiectul II = geometrie; BAC: Subiectul II = matrice/sisteme/structuri/polinoame, „I și II" = fără analiză) — inclusiv temele automate;
   - **simulările generate**: DOAR itemii subiectelor alese (`examScopeNote` intră în prompt);
   - **chatul meditatorului**: alegerea intră în memoria pedagogică (`_lib/ai.js → meditatiiMemory`), împreună cu pregătirea de lucrare (capitole + dată) — explicațiile și recomandările țin cont; briefingul o anunță. Când elevul e gata, „trece mai departe" schimbând alegerea oricând (se ține în `memory.exam_scope` — fără migrare SQL; acțiunea nouă `set_exam_scope`).

### 👨‍🏫 Contul de profesor („Generează exerciții/teste interactive/PDF")
3. **Câmp „Alt capitol, dacă lipsește din listă"** sub rolldown-ul de capitole (ca la pregătirea pentru lucrare a elevului): capitolul scris liber intră în ACEEAȘI restricție obligatorie de conținut ca cele bifate (se trimite ca al N-lea capitol; fără schimbări de server).
4. **Tipul itemilor**: „🔀 Mixt (implicit) / 🔘 Doar grilă / ✍️ Cu redactarea răspunsului". Serverul (`qtype`) forțează tipul în prompt (grilă: toate cu 4 variante, distractori plauzibili; redactare: fără variante, `explanation` = redactarea model pas cu pas, afișată la barem — și în PDF), cu buget de tokeni mărit la redactare și filtrare blândă a itemilor de alt tip.

Teste noi: `examScopeIds` (EN algebra/geometrie, BAC algebra/analiză) + `examScopeNote`. **Build + 158/158 teste trec.**
---

## 14 august 2026 (2) — „Generează exerciții/teste interactive/PDF": alegi tipul, rezultatul și numărul de itemi

Cererea adminului, la asistentul AI pentru profesori (tabul fost „🧩 Generează interactiv"):
- **Tabul redenumit**: „🧩 Generează exerciții/teste interactive/PDF".
- **„Ce generez": Exercițiu sau Test** (butoane segmentate). La TEST apare selectorul **„Itemi"** (4–24, implicit 10) — serverul generează EXACT atâția itemi (bugetul de tokeni crește cu numărul de itemi, ca testele mari să nu se trunchieze; un test ieșit incomplet dă eroare cu retry, nu jumătate de test).
- **„Rezultatul": Interactiv sau PDF** (se poate alege PDF direct, înainte de generare). La PDF nu se mai deschide viewerul interactiv: apare caseta „📄 gata de tipărit" cu **PDF varianta elev** / **PDF cu barem** — ACELEAȘI metode ca la „Generează subiect examen" (`examPrint.printExam`, fereastra de tipărire → „Salvează ca PDF"); rămâne și butonul „Deschide și interactiv". (Fereastra de tipărire nu se deschide singură după o generare lungă — browserele blochează pop-up-urile fără click direct.)
- Restul rămâne la fel: categorii, dificultate, capitolele din rolldown, „Subiect + instrucțiuni", salvarea în „Testele și exercițiile mele", trimiterea la elevi și publicarea.

Fișiere: `src/pages/ProfesorVirtual.jsx` (UI), `src/lib/aiClient.js` (kind/count), `api/ai-generate-interactive.js` (kind='test' + count 4–24, plan de combinare pe N itemi, maxTokens scalat, validare de completitudine). Build + 156/156 teste trec.
---

## 14 august 2026 — Cronurile chiar RULEAZĂ (403 reparat, cu heartbeat) + teste pe capitole (profesor) + pregătire pentru lucrări cu dată limită (elev)

### 1) 🕖 Task-urile programate nu rulau singure — cauza REALĂ: cronul primea 403 la fiecare tic
Simptomul raportat („nu rulează singure deloc — nimic în istoric, niciun email; merge doar ▶️ Rulează acum”) nu venea din logica de scadență, ci din AUTORIZARE: toate cele 8 rute-cron acceptau doar headerul `x-vercel-cron`, pe care Vercel NU îl mai trimite garantat la invocări (documentația actuală: headerul e `x-vercel-cron-schedule`, iar mecanismul oficial de securizare e `Authorization: Bearer CRON_SECRET`). Fiecare tic orar era deci respins cu „Neautorizat” — de aceea nici recuperarea de 6 ore din 6 august nu avea ce recupera. Afectate în tăcere și: SEO (snapshot/autorun/monthly), social (publish/metrics), ai-ingest, ai-notify, account-cleanup, cronul meditațiilor.
- **`api/_lib/http.js` → `isCronRequest(req)`** (nou, partajat; expus și prin `_lib/ai.js`): acceptă `x-vercel-cron-schedule` / `x-vercel-cron` (retrocompatibil) / user-agent `vercel-cron/…` / `Authorization: Bearer CRON_SECRET sau AI_CRON_SECRET` / `?secret=AI_CRON_SECRET`. Toate rutele-cron folosesc acum această verificare unică.
- **🫀 Heartbeat:** `agent-cron` scrie la fiecare tic un JSON mic în Storage (`content-files/agent-formats/_cron-heartbeat.json` — fără migrare SQL); panoul „Task-uri programate” îl afișează: verde „ultimul tic: acum X min”, sau roșu cu pașii de verificat în Vercel (Production, Cron Jobs Enabled, CRON_SECRET fără caractere speciale, View Logs) când cronul nu bate.
- **Recomandat după deploy:** adaugă env `CRON_SECRET` (șir aleatoriu ≥16 caractere) în Vercel — Vercel îl trimite automat la invocările de cron; serverul îl acceptă de-acum.
- `test/http.test.js`: 2 teste noi pe toate semnalele acceptate/refuzate.

### 2) 📘 Generarea de teste DIN ANUMITE CAPITOLE (contul de profesor)
La „Generează subiect examen” (PDF) și „Generează interactiv” din Profesor Virtual apare un ROLLDOWN cu capitolele programei (grupate pe clase: EN → clasele 5–8, BAC → 9–12 după profil, categoriile de clasă → programa clasei), cu selecție multiplă (etichete cu ✕) + câmpul liber existent pentru alt capitol / alte indicații pentru AI.
- **`src/lib/capitole.js`** (nou): capitolele programei pe clase, GENERAT MECANIC din `api/_lib/meditatii.js → CURRICULUM` (id-uri identice cu serverul); **`src/components/CapitolePicker.jsx`** (nou): rolldown + etichete + câmp liber, refolosit și la meditații.
- **`api/ai-exam.js` + `api/ai-generate-interactive.js`**: primesc `chapters` (titluri, max 12) — capitolele intră în căutarea exemplelor-model și devin RESTRICȚIE OBLIGATORIE de conținut în prompt, cu prioritate peste prescripțiile tematice per item (structura oficială, punctajele și numărul de itemi rămân neatinse). La subiectele PDF, selecția de capitole funcționează la generarea cu AI („modifică numerele”); combinarea exactă fără AI folosește în continuare subiectele întregi (decupaj vectorial — nu se poate filtra pe capitole).

### 3) 🎯 Meditații: PREGĂTIRE PENTRU LUCRĂRI/TESTE din anumite capitole sau toată clasa, cu DATĂ LIMITĂ (contul de elev)
Elevul se poate pregăti și pentru testele de la școală, nu doar pentru examen: tipul testului (**lucrare/test din capitole · test din lecții · test inițial — materia anului trecut**; „lucrare” fără selecție = toată clasa), ROLLDOWN cu capitole (programa clasei + anul trecut + capitolele din site/plan), câmp liber pentru capitol lipsă / alte indicații și **data testului**. Planul de recapitulare ține cont de toate: capitolele testului au prioritate (briefing/coach/pasul zilei), cele lipsă se ADAUGĂ în plan, bannerul 🎯 din „Astăzi” arată progresul, zilele rămase și ritmul necesar (~capitole/săptămână), testul inițial de la înscriere se dă din capitolele alese, iar „🧩 Test de verificare” generează un test DOAR din ele (site-first). **Pentru examenul final nu se schimbă nimic: planul rămâne întreaga materie, ca până acum.**
- Server: `api/_lib/meditatii.js` (`FOCUS_KINDS`/`cleanFocus`/`focusPool`/`applyFocus`/`focusInfo` + prioritatea din `nextChapter`), `api/ai-meditatii.js` (acțiunea nouă `set_focus`, setup/assessment cu focus, testul de verificare în `simulare`, briefing + coach). Client: `src/pages/Meditatii.jsx` (FocusFields în SetupWizard, FocusModal, banner „Astăzi”, marcaje 🎯 în plan, buton în Simulări, chip în Hero).
- **De rulat la instalare:** `supabase/meditatii_focus.sql` (idempotent; inclus și în `meditatii_schema.sql`). Fără migrare, înscrierea și restul meditațiilor merg neschimbate — doar `set_focus` cere scriptul, cu mesaj clar.
- `test/meditatii-focus.test.js` (nou): 7 teste — validare, aplicare pe plan (anul trecut / capitol liber / toată clasa), prioritate `nextChapter`, progres + ritm.

**Build-ul trece (`vite build`), 156/156 teste trec (`npm test`), `node --check` pe toate rutele editate.**
---

## 13 august 2026 (5) — Lint Supabase: funcțiile SECURITY DEFINER din „păstrează datele publice” nu mai sunt apelabile prin API

Linterul Supabase a semnalat (0028/0029) că cele trei funcții noi din `pastreaza_date_publice.sql` — `display_name_of(uuid)`, `discussions_fill_author()`, `pubres_fill_student()` — erau apelabile prin PostgREST (`/rest/v1/rpc/...`) de `anon` și `authenticated`, fiindcă Postgres dă implicit `EXECUTE` tuturor. Practic oricine ar fi putut afla numele afișabil al oricărui cont după UUID. Scriptul are acum **`REVOKE EXECUTE ... FROM public, anon, authenticated`** după fiecare funcție (rămâne doar proprietarul).

**Verificat pe PostgreSQL real:** după revocare, `anon`/`authenticated` primesc „permission denied” la apel direct, DAR postarea de comentarii **funcționează neschimbat** — la INSERT, triggerul rulează ca proprietarul funcției, nu ca utilizatorul care postează, deci `author_name`/`student_name` se completează în continuare automat. Re-rularea scriptului pe o bază deja migrată e sigură (idempotent).

**De rulat:** `supabase/pastreaza_date_publice.sql` (varianta actualizată) încă o dată în Supabase → SQL Editor. Al treilea avertisment din raport (`auth_leaked_password_protection`) nu ține de SQL: se activează din Dashboard → Authentication → protecția împotriva parolelor compromise (HaveIBeenPwned).

## 13 august 2026 (4) — Admin cu secțiuni pliabile (rolldown) + robotul 🤖 în loc de tocă + datele publice supraviețuiesc ștergerii conturilor

Trei schimbări cerute de admin:

### 📂 Rolldown-uri în Admin → AI Tutor (`src/components/Rolldown.jsx` — NOU)
Tab-ul AI din Admin crescuse foarte lung. Secțiunile mari sunt acum **pliabile** (închise implicit, cu săgeată ▶/▼):
- **„🤖 Profesor Virtual — Bază de cunoștințe"** (`AIAdminPanel.jsx`);
- **„🤖 Agent Claude — Generator de exerciții"** (`AIExerciseAgent.jsx`), iar ÎN el, ca subsecțiuni pliabile:
  - **„📁 Exerciții încărcate de agent (N)"** — lista reeditabilă;
  - **„🗓 Task-uri programate — agentul de exerciții"** (`AgentScheduledTasks.jsx`) — butonul „➕ Creează task programat" s-a mutat în interiorul secțiunii, ca formularul deschis să nu rămână niciodată ascuns.
Detalii de implementare: conținutul rămâne **montat** și când secțiunea e închisă (`display:none`) — chat-ul agentului, exercițiul generat și formularele NU se pierd la pliere; starea deschis/închis se ține minte per secțiune în `localStorage` (`admin_rolldown:*`).

### 🤖 Robotul agentului în loc de tocă (🎓 → 🤖)
- `src/pages/Admin.jsx`: tab-ul din bara laterală „🎓 AI Tutor" → „**🤖 AI Tutor**";
- `src/components/AIAdminPanel.jsx`: titlul „🎓 Profesor Virtual — Bază de cunoștințe" → „**🤖 Profesor Virtual — Bază de cunoștințe**" — aceeași figură de robot ca la agentul generator de exerciții.

### 🛟 Datele publice rămân pe site după ștergerea conturilor (`supabase/pastreaza_date_publice.sql` — NOU, idempotent)
Până acum, ștergerea unui cont (din Setări cont, de către admin sau prin curățarea automată a conturilor inactive) ștergea în CASCADĂ și **comentariile lui din forum**, **aprecierile** date și **scorurile la testele publice** — după modelul reparației `pastreaza_rezultate.sql`, acum:
- `discussions`: coloană snapshot **`author_name`** (backfill din profiluri + trigger la INSERT care o completează automat), FK `user_id` → **ON DELETE SET NULL** — comentariul rămâne pe site cu numele autorului; `Discussions.jsx` afișează numele din snapshot când profilul nu mai există;
- `discussion_likes`: FK → **SET NULL** — numărul de aprecieri nu mai scade când dispare un cont (UNIQUE-ul rămâne valid, NULL-urile sunt distincte în Postgres);
- `ai_public_results`: coloană snapshot **`student_name`** + FK → **SET NULL** — autorul unui test public își păstrează statistica scorurilor; `api/ai-public.js` (action `record`) salvează numele elevului la fiecare scor, cu fallback dacă scriptul SQL nu a fost încă rulat;
- `ai_public_library` era DEJA pregătită (SET NULL + `creator_name`) — scriptul doar completează numele lipsă și verifică defensiv legătura; materialele din `content` (inclusiv cele postate de agent), rezolvările și articolele nu au legături spre conturi, deci rămân oricum;
- transparență: emailurile de avertizare/reamintire (`api/_lib/inactivity.js`) și dialogul de ștergere din `AccountSettings.jsx` spun explicit că datele publice rămân pe site, cu numele de la momentul publicării.

**De rulat la instalare:** `supabase/pastreaza_date_publice.sql` în Supabase → SQL Editor (sigur de rulat repetat). `GHID_CONTURI_INACTIVE.md` actualizat.

## 13 august 2026 (3) — Limita funcțiilor ridicată la 800s (Vercel Pro/Fluid) + reamintirea marcajelor TPL — testele mari chiar au timp să se termine

Diagnosticul „[stop=max_tokens, continuări=0, lungime=57232]” a arătat matematica exactă: modelul a scris ~57KB (tot bugetul de 30k tokeni) în ~230s, iar garda de timp a refuzat corect continuarea pentru că nu mai încăpea în limita de 300s. Munca totală pe acest task cere ~5 minute de generare — pe limita de 300s NU are cum să încapă, indiferent de optimizări. Adminul e pe **Vercel Pro**, deci:
- **`vercel.json`: `maxDuration` 300 → 800** (funcțiile rulează pe Fluid; Pro suportă 800s);
- **deadline-urile interne urmează limita:** `chatClaudeLong` se oprește cu ~90s înainte (default 800, suprascriptibil prin env `FUNCTION_MAX_SECONDS` — ține-l sincron cu maxDuration dacă o schimbi vreodată), iar bugetul cronului per tic devine limita − 80s;
- **reamintire finală a marcajelor TPL** în toate cele 4 prompturi de clonare (modelele respectă mai bine instrucțiunile repetate la coada promptului) — mai puțini tokeni de scris, generare mai scurtă;
- **UI:** butonul „▶️ Rulează acum” arată „poate dura câteva minute la teste mari” în loc de „~30-90s”.

**16/16 teste trec.** După deploy: „▶️ Rulează acum” pe taskul EN — are acum până la ~11 minute de spațiu (deadline ~710s), față de ~200s cât avea.

## 13 august 2026 (2) — Clonarea șabloanelor de ~3-4 ori mai RAPIDĂ (marcaje TPL) — scapă de FUNCTION_INVOCATION_TIMEOUT (300s)

Logurile Vercel de la admin au arătat lanțul complet: (1) modelul folosit NU suportă deloc prefill de asistent („This model does not support assistant message prefill”) — trecerea pe continuarea prin mesaj de utilizator a funcționat corect; dar (2) PRIMA generare singură a durat ~230s (clonarea unui șablon de ~107KB ≈ ~35k tokeni de ieșire), continuarea a împins totalul peste limita funcției Vercel → `FUNCTION_INVOCATION_TIMEOUT` la 5m, cu rularea PIERDUTĂ (nimic în istoric). Trei schimbări:

### 🚀 Marcaje TPL — modelul nu mai rescrie ce nu schimbă (`api/_lib/exgen.js`)
Șablonul trimis modelului e adnotat cu `<!--TPL:N-->` înaintea fiecărui bloc `<style>`/`<script>`, iar regula nouă din prompt (`TPL_RULE`) îi cere ca blocurile pe care le-ar copia NESCHIMBATE să devină doar marcaje GOALE `<style/script data-tpl="N">` — serverul le reinserează programatic (`tplAnnotate`/`tplRestore`, aplicate pe toate cele 4 căi de clonare HTML). Blocul cu DATELE itemilor se rescrie mereu complet. La șablonul de 107KB (67% scripturi), ieșirea scade de la ~35k la ~10-12k tokeni → generarea încape confortabil într-un singur apel.

### ⏱ Gardă de timp în `chatClaudeLong`
Nu se mai pornesc continuări după ~200s scurse: mai bine o eroare CLARĂ, înregistrată în istoric + email, decât funcția ucisă de Vercel cu rularea pierdută. (Dacă timeout-urile mai apar și contul e pe Vercel Pro, `maxDuration` se poate ridica la 800 în `vercel.json` — funcțiile rulează pe Fluid.)

### 🧠 Fără apeluri irosite (`api/_lib/claude.js` + `exgen.js`)
- `apiCall` mai reîncearcă „fără thinking” DOAR când chiar parametrul thinking a fost respins — alte erori 400 (ex. cea de prefill) ies imediat, ca apelantul să schimbe metoda (înainte, fiecare respingere de prefill consuma un apel dublu).
- Modelele care au respins prefill-ul sunt ținute minte (`NO_PREFILL`) — generările următoare încep direct cu continuarea prin mesaj de utilizator.

**`test/agent-tasks.test.js`:** teste noi — marcajele TPL (numerotare, reinserare, blocul de date rămâne cel rescris, index inexistent tolerat) + pornirea directă fără prefill la modelele ținute minte. **16/16 trec.**

## 13 august 2026 — Continuarea generărilor lungi funcționează și când API-ul RESPINGE prefill-ul („[stop=max_tokens, continuări=0]”)

Aceeași eroare „Șablonul rubricii e prea mare…”, dar diagnosticul nou a arătat exact cauza: **continuări=0** cu `stop=max_tokens` — adică prima continuare nici nu a apucat să ruleze. Continuarea folosea „prefill de asistent” (partea generată devine mesaj final de asistent), iar API-ul o RESPINGE pe configurațiile unde modelul rulează cu thinking activ (când `thinking: disabled` nu e acceptat, `api/_lib/claude.js` reia cererea fără parametru, deci modelul poate gândi — iar prefill + thinking = 400 imediat, ne-tranzitoriu → lanțul de continuări murea pe loc).

`chatClaudeLong` (`api/_lib/exgen.js`) are acum a doua metodă de continuare, folosită AUTOMAT când prefill-ul e respins (și păstrată pe restul rundelor):
- **continuare prin mesaj de utilizator:** modelul primește partea deja generată (ultimele ~150k caractere) + instrucțiunea să scrie DOAR ce urmează, până la `</html>`, fără introduceri și fără ``` ;
- **lipire pe suprapunere:** coada (ultimele 400 de caractere) e căutată în răspuns și dublura se taie; dacă modelul o ia totuși de la capăt cu tot documentul, se păstrează varianta lui completă (iar `cutHtml` oricum reține ultimul document închis);
- diagnosticul din erori s-a extins: `[stop=…, continuări=…, fără prefill, lungime=…]` — „lungime” ajută să vedem dacă modelul a produs ceva sau bugetul s-a dus pe thinking.

**`test/agent-tasks.test.js`:** caz nou — prefill respins cu 400 → trecerea pe continuarea prin mesaj de utilizator + lipirea fără dublarea cozii. **15/15 trec.**

## 7 august 2026 — Task-urile programate: „prompt is too long” la PDF-uri dense (fallback pe text) + continuări reziliente la rate-limit / degenerare

Două erori raportate de admin, ambele în `chatClaudeLong` (`api/_lib/exgen.js`):

### 1) ⚠️ „prompt is too long: 2120089 tokens > 1000000 maximum” (task „pe rând” pe clasa-12, PDF)
Un PDF-sursă foarte dens (culegere) depășește contextul modelului ca DOCUMENT NATIV (tokenii unui PDF pot sări cu mult peste dimensiunea fișierului). Acum, când API-ul răspunde „prompt is too long / request too large”, cererea se reface AUTOMAT o dată, cu blocurile PDF înlocuite de TEXT EXTRAS (`pdftext.pdfText` — primele ~12 pagini, max 50k caractere, cu mențiune explicită în prompt) — suficient pentru sarcini de tip „primele 9 exerciții din fișier”. Funcția nouă `blocksWithPdfText`; se aplică pe orice cale de generare (sursă „pe rând”, combinare PDF, bareme-context, model de format PDF).

### 2) ⚠️ „Șablonul rubricii e prea mare pentru o singură generare” pe un model de format de doar ~107 KB (test EN, Sonnet 5)
Șablonul NU era prea mare — clonarea lui cere ~35k tokeni, adică fix peste bugetul unei singure generări (30k), deci fiecare rulare depindea de continuări. O singură eroare TRANZITORIE (rate-limit 429 / suprasarcină) în mijlocul continuărilor rupea lanțul și lăsa documentul neterminat. Acum:
- erorile tranzitorii (429, „overloaded”, „rate limit”, timeout) se REÎNCEARCĂ după o pauză de 15s — o dată la primul apel, de două ori pe parcursul continuărilor, fără să consume rundele;
- gardă ANTI-BUCLĂ: dacă textul depășește ~800k de caractere fără `</html>` (model degenerat care o ia de la capăt), ne oprim cu diagnostic în loc să ardem toate rundele;
- mesajul „Șablonul rubricii e prea mare…” include acum `[stop=…, continuări=…]` ca să se vadă exact unde s-a rupt.

**`test/agent-tasks.test.js`:** caz nou în testul `chatClaudeLong` — „prompt is too long” cu bloc PDF → a doua cerere pleacă FĂRĂ blocuri document (PDF ca text) și reușește. **15/15 trec.**

## 6 august 2026 (2) — Fără descrierea „Generat automat de agentul Claude (task „…”) · data” pe materialele postate

Cererea adminului. Materialele NOI postate de task-urile programate (postare automată sau „✅ Publică acum”) nu mai primesc descrierea „Generat (automat) de agentul Claude (task „…”) · …” — câmpul `description` rămâne gol, deci cardul de pe site afișează doar titlul. Proveniența NU se pierde: rămâne în `interactive_data` (`agent: 'claude'`, `agent_task`) și în istoricul task-ului, deci lista „Exerciții încărcate de agent” din admin funcționează neschimbat. (`api/_lib/exgen.js` — `runTask` + `postRun`.)

Pentru materialele DEJA postate cu descrierea veche: **`supabase/curata_descrieri_agent.sql`** (nou) — rulează-l o dată în Supabase → SQL Editor; șterge doar descrierile care încep cu „Generat” de pe rândurile postate de agent, descrierile scrise de mână rămân neatinse. **15/15 teste trec.**

## 6 august 2026 — Task-urile programate: generarea nu se mai „întrerupe” (continuare + re-cerere strictă) și ORA PROGRAMATĂ nu se mai pierde (fereastră de recuperare în cron)

Două erori raportate de admin după livrarea de ieri. Fișiere: `api/_lib/exgen.js`, `api/agent-cron.js`, teste, ghid — fără migrare SQL.

### 1) ⚠️ „nu am obținut un document HTML complet (răspunsul s-a întrerupt)” (ex. task „pe rând” + model de format, Opus 5)
Garda de completitudine de ieri a refuzat corect un document neterminat — dar continuarea automată pornea DOAR la `stop_reason = max_tokens`. Dacă modelul se oprea din alt motiv cu documentul la jumătate, sau răspundea cu proză („nu pot clona fișierul…”) în loc de HTML, rularea rămânea pe eroare. `chatClaudeLong` acum:
- **continuă și când modelul s-a oprit cu documentul neterminat** (parametrul nou `until` — ex. „textul conține `</html>`?”), nu doar la `max_tokens`; până la 4 reluări cu prefill de asistent;
- **re-cere o dată, strict, DOAR documentul** când răspunsul nu conține deloc `<!doctype`/`<html` (proză) — conversația + refuzul modelului + reamintirea formatului; dacă și răspunsul strict se taie, e continuat și el (până la 2 reluări);
- providerul fallback (fără `stop_reason`) nu încearcă continuarea (nu are prefill garantat);
- mesajele de eroare includ diagnosticul `[stop=…, continuări=…, re-cerere strictă]` — se văd în istoricul rulării și în emailul ⚠️.
Recomandare operațională (în ghid): la task-urile cu model de format MARE, Sonnet 5 e alegerea mai sigură decât Opus (generările uriașe cu Opus se pot apropia de limita de timp a funcției Vercel, 300s).

### 2) 🕖 „nu a publicat la ora programată — merge doar manual”
Cauza demonstrabilă în `agent-cron.js`: un task era scadent DOAR la fix ora lui (`run_hour !== now.hour` → afară), iar cronul executa max 3 task-uri per tic. Cu mai mult de 3 task-uri la aceeași oră (cazul adminului: mai multe profiluri BAC la 07:00), al 4-lea+ nu era luat — iar la 08:00 nu mai era „scadent”, deci NU mai rula deloc în ziua aceea. La fel se pierdeau task-urile dintr-un tic ratat de Vercel sau dintr-o funcție întreruptă la maxDuration.
- **`dueAt` (nou):** momentul programat cel mai recent din ultimele **6 ore** (fereastra de recuperare `CATCHUP_HOURS`), calculat pe ora României (cu tot cu treceri de zi/lună la miezul nopții).
- **`isDue` rescris:** scadent dacă ora programată a trecut de sub 6 ore și task-ul NU a rulat de la (ora programată − 2h) încoace — garda anti-dublare veche, păstrată ca semantică: o rulare manuală „▶️ Rulează acum” cu puțin înaintea orei contează ca rularea zilei.
- **Buget de timp per tic:** după ~220s nu se mai pornesc task-uri noi (`postponed` în răspunsul cronului) — le prinde ticul următor prin fereastra de recuperare, în loc să moară odată cu funcția.
- De verificat în admin: task-urile din poză sunt pe ⏸ pauză („următoarea: oprit") — cele oprite nu rulează niciodată singure; apasă „▶ Pornește".

**`test/agent-tasks.test.js`:** testul `isDue` rescris pe momente reale (vară/iarnă, recuperare la +2h, expirare la +7h, fără recuperare în altă zi, garda pe ora programată, `dueAt` exact) + test nou `chatClaudeLong` (stub pe `claude.chatClaude`): lipirea continuărilor la `max_tokens`, continuarea documentelor neterminate pe `end_turn`, re-cererea strictă la proză (fără continuarea prozei), fallback fără continuare. **15/15 trec**; `node --check` pe toate fișierele editate.

## 5 august 2026 (2) — Task-urile programate: FĂRĂ figuri în afara EN, teste complete (Subiectul III / „nimic generat”), postarea automată chiar VIZIBILĂ pe site

Trei probleme raportate de admin la agenții din „Creează task programat” (aceleași reparații acoperă și butonul manual „⚙️ Generează (AI)”, care folosește aceeași logică din `exgen.js`). **Doar `api/_lib/exgen.js`** + teste + ghid — fără migrare SQL, fără schimbări de UI.

### 1) 🖼 Figurile geometrice: DOAR la Evaluare Națională
Simptomul: la un test generat pe o clasă, itemul „triunghi dreptunghic, cateta AC și mediana AM” avea alături figura unui CUB cu „9L apă” — modelul înlocuia enunțul unui item cu figură, iar figura (restaurată programatic din șablon) nu se mai potrivea. Cererea adminului: figuri doar la testele EN.
- `figuresAllowed(category)` — `true` doar la `evaluare-nationala`. La EN, comportamentul vechi e neschimbat (figurile șablonului restaurate întocmai + itemii lor păstrați).
- La clase și BAC, în TOATE căile de generare HTML: promptul cere explicit eliminarea figurilor (`NO_FIG_RULE` — enunțuri self-contained, „din figura alăturată” interzis), planul de combinare nu mai exceptează „itemii cu figură”, restaurarea SVG se sare, iar `stripFigures` curăță programatic ce mai scapă (SVG-urile mari >300 caractere, `<canvas>`, containerele `<div class="fig">`; pictogramele mici rămân).
- Căile JSON (test structurat) primesc și ele regula: rezultatul nu are figuri, deci enunțurile se scriu cu toate datele în text; itemii-sursă dependenți de figură se înlocuiesc.

### 2) 🧩 Teste generate GOALE sau fără Subiectul III (răspunsuri trunchiate)
Simptomul: teste de tip „rezolvare interactivă” (grilă + completare pe pași) publicate cu antet și „0 pași” dar FĂRĂ niciun exercițiu; la altele lipsea fix Subiectul III. Cauza: răspunsul modelului se tăia la `max_tokens` (array-ul de itemi e la FINALUL fișierului → JS rupt → nimic randat), iar validarea veche (`length > 600` + există `<!doctype`) lăsa documentul trunchiat să treacă drept valid și să fie publicat.
- **`chatClaudeLong`** (nou): la `stop_reason = max_tokens`, răspunsul se CONTINUĂ automat cu prefill de asistent (partea generată devine mesaj de asistent, modelul continuă exact de unde a rămas), până la 3 reluări; usage-ul se cumulează. Folosit în toate cele 7 apeluri de generare (4 HTML + 3 JSON); `maxTokens` mărit (24000→30000 la HTML, 9000/12000→12000/16000 la JSON); plafonul sursei HTML „pe rând” mărit 160k→320k caractere (la 160k se tăia uneori chiar array-ul de itemi al surselor mari).
- **`cutHtml`** (nou): documentul trebuie să se termine cu `</html>` — un răspuns trunchiat NU mai trece; dacă modelul „a luat-o de la capăt” la continuare, se păstrează ultimul document complet.
- **`assertCompleteHtml`** (nou): testul trebuie să CONȚINĂ itemi (`itemSignals` — numără `data-correct`, `data-opt`, `"answer":`, radio, input-uri etc., comparat cu șablonul/sursa) și toate secțiunile sursei (`missingSections` — „Subiectul II/III”, tolerant la „al III-lea”, „Subiectele I, II și III”). Testele structurate din planul de 10 itemi cer minim 6. Dacă nu se poate, rularea se încheie cu EROARE clară (email ⚠️, nimic publicat) în loc de test gol pe site.
- Prompturile cer explicit TOATE subiectele, inclusiv III (`COMPLETE_RULE_HTML` / `COMPLETE_RULE_JSON`: itemii complecși devin grilă sau completare de răspuns, cu array-urile JS scrise complet).

### 3) 📤 „Am bifat postare automată și nu a apărut pe site”
Cauza reală: postarea REUȘEA (rând în `content`, email „publicat”), dar paginile EN/BAC afișează conținut interactiv doar la anumite subcategorii — tab-ul „Teste Interactive” citește `teste-interactive`, iar comutatoarele Interactive/PDF există doar la `capitole` și `exercitii-subiecte` (EN) / `exercitii` (BAC). Un task pe rubrica `variante`/`simulari`/`bareme` sau pe un mix `a+b` posta cu acea subcategorie → nicio pagină nu interoga rândul → „invizibil”.
- **`visibleSubcategory`** (nou, aplicat în `postContent`, deci și la „✅ Publică acum”): EN → rămân `teste-interactive`/`capitole`/`exercitii-subiecte`, restul cad pe `teste-interactive`; BAC → rămân `teste-interactive`/`capitole`/`exercitii`, restul pe `teste-interactive` (profilul se păstrează); mixurile `a+b` iau prima componentă înainte de mapare; clasele neschimbate (paginile lor nu filtrează după subcategorie).

**`test/agent-tasks.test.js`:** 4 teste noi — figuri EN-only + `stripFigures`; `cutHtml` (trunchiat → respins, „restart” la continuare → ultimul document); `itemSignals`/`missingSections` (carcasă goală prinsă; „Subiectele I, II și III” detectat); maparea `visibleSubcategory` pe toate cazurile. **14/14 trec**; `node --check` pe toate fișierele editate.
**De verificat după deploy:** rulează un task cu „▶️ Rulează acum” pe o clasă (fără figuri, toate subiectele) și unul pe o rubrică EN/BAC `variante` cu postare automată (materialul apare la „Teste Interactive”).

## 5 august 2026 — Nota (1–10, cu 10 puncte din oficiu) afișată la testele interactive, peste tot unde apare scorul

Cererea adminului. Regula (o singură sursă de adevăr, aplicată identic pe client și pe server):
- testele care raportează scorul „din 100" (`MATE_SCORE` cu `maxScore = 100` — ex. cele generate de `exgen.js`/`exerciseRender.js`/`quizRender.js`) au punctele din oficiu **DEJA incluse** în scor ⇒ **nota = scor/10** (fără dublarea oficiului);
- testele cu punctaj brut (ex. `35/45`, EN pe 90 de puncte) primesc oficiul la calcul ⇒ **nota = 1 + 9×(scor/maxim)**;
- nota păstrează 2 zecimale (ca mediile școlare) și e limitată la [1, 10].

Unde apare acum nota:
- **`/exercitiu`** (`InteractiveViewer.jsx`): pastila „✓ Scor salvat: 63/90 (70%) · nota 7.30"; dacă e temă de la Meditator, pastila „Temă bifată · nota …" există deja de la server, deci nota NU se mai repetă și în pastila de scor;
- **cardurile de teste** (`ContentPage.jsx`): badge-ul de progres „✓ 70% · nota 7.30";
- **viewerul exercițiilor AI** (`ExercitiuAIViewer.jsx`): chipul „Scor: … · nota …";
- **Rezultate elevi** (`TeacherResults.jsx`): coloana „Punctaj" din tabel, tooltip-ul graficului „bursă", temele de meditații (nota serverului dacă există, altfel calculată — niciodată ambele) și lista arhivată de teme;
- **raportul părintelui** (`ParentAIActivity.jsx`): rezultatele recente de la meditații, exercițiile interactive generate, cele din Biblioteca utilizatorilor și cele primite de la profesor.

Server (aceeași „grijă" la dublarea oficiului): `api/_lib/meditatii.js` — funcția nouă **`notaTest`** (exportată) folosită la bifarea automată a temelor din site (`reconcileContentHomework`) și în `api/ai-meditatii.js` → `homework_score`; până acum ambele aplicau `1 + 9×pct` necondiționat, deci la testele „din 100" oficiul se aduna de două ori (ex. 55/100 → nota 5.95 în loc de 5.50).

Fișier nou: `src/lib/nota.js` (`notaDinScor`). Nicio schimbare la HTML-urile testelor din Storage și nicio migrare SQL. Verificat: esbuild pe toate fișierele editate + 12 cazuri de test pe formulă (client și server) — toate trec.

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
