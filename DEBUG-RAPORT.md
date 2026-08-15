# Raport de debug total — ExamenMate

*Generat: 15 august 2026. Analiză pe întreg proiectul (frontend Vite/React, API serverless Vercel, SQL Supabase, config).*

## Rezumat

Starea generală e **bună**: build-ul de producție trece curat, iar toate cele **161 de teste** trec. Nu există erori de sintaxă sau importuri rupte. Problemele găsite sunt logice/de securitate/de robustețe — exact genul pe care testele și build-ul nu îl prind.

Am rulat: `npm install` + `vite build` (OK), `node --test test/*.test.js` (161/161 OK), ESLint pe tot codul, plus o revizuire manuală aprofundată pe fiecare zonă (API, frontend, SQL, config), cu verificare directă în cod a fiecărei probleme grave pentru a elimina fals-pozitivele.

Prioritatea reală: **3 probleme critice de securitate** (două ocolesc complet plata/abonamentul, una expune toate cronurile scumpe). Le detaliez primele.

---

## 🔴 CRITIC — de reparat urgent

### 1. Orice vizitator anonim poate declanșa toate cronurile scumpe (bypass de autentificare cron)
**Fișier:** `api/_lib/http.js:63`

`isCronRequest` acceptă cererea dacă `User-Agent` începe cu `vercel-cron/`:
```js
if (/^vercel-cron\//i.test(String(h['user-agent'] || ''))) return true;
```
User-Agent-ul e complet controlat de client — Vercel nu îl suprascrie la cererile primite din exterior. Deci oricine rulează:
```
curl -H 'User-Agent: vercel-cron/1.0' https://examenmate.com/api/account-cleanup?action=run
```
trece de verificare **fără niciun secret**. Consecințe concrete, repetabile la infinit:
- `account-cleanup?action=run` → șterge definitiv conturi (rulare reală, `dry=false`).
- `ai-meditatii?action=cron` → până la ~200 generări Claude Opus per apel.
- `seo-cron?action=autorun` / `?action=monthly` → agentul Claude plătit, fără gardă de „ultima rulare".
- `ai-ingest`, `ai-notify` (spam de emailuri către admin), `social-cron` (publică postări devreme), `agent-cron`.

Un atacator poate arde bugetul AI nelimitat sau șterge conturi în afara programului.

**Fix:** elimină ramurile pe `user-agent` și `x-vercel-cron*` (ambele spoofabile) și autentifică cronurile **doar** prin `Authorization: Bearer <CRON_SECRET>` (Vercel îl trimite automat dacă `CRON_SECRET` există în proiect) sau `?secret=`. Codul are deja aceste ramuri — trebuie doar să rămână doar ele.

### 2. Paywall-ul premium se ocolește complet prin endpoint-ul de „preview"
**Fișier:** `api/get-preview-url.js` (tot fișierul)

Endpoint-ul primește orice `contentId`, citește rândul cu cheia service-role (peste RLS) și returnează un URL semnat pe **fișierul complet**, fără `authUser`, fără verificare `is_free`, fără abonament:
```js
const { data: content } = await supabase.from('content')
  .select('id, file_url, content_type').eq('id', contentId).single();
const url = await signedUrlFromPublic(supabase, content.file_url, 120); // fișierul ÎNTREG
```
Fratele lui, `get-file-url.js`, semnează **exact același** `file_url` doar după ce verifică `subscription_status === 'active' || is_admin`. Frontend-ul (`ContentPage.jsx` `PreviewModal`) afișează doar pagina 1 randând cu pdf.js — dar restricția „doar pagina 1" e **pur pe client**. Orice utilizator (chiar nelogat) poate face POST `{contentId}` cu ID-ul unui material premium și descărca PDF-ul complet.

**Fix:** cere `authUser` + abonament activ pentru conținut non-`is_free` (oglindește `get-file-url.js`), sau semnează un asset dedicat de preview (doar pagina 1), nu fișierul întreg.

### 3. Orice utilizator autentificat poate INSERA și ȘTERGE tot conținutul site-ului
**Fișier:** `supabase/fix_content_rls.sql:16-27`

Politicile RLS efective pe `public.content` sunt:
```sql
CREATE POLICY "Authenticated users can insert content" ON public.content
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete content" ON public.content
  FOR DELETE USING (auth.role() = 'authenticated');
```
iar `supabase_grants.sql` acordă `INSERT, UPDATE, DELETE` pe `content` către rolul `authenticated`. `Admin.jsx` scrie/șterge conținut cu clientul Supabase din browser (cheia user), deci calea reală de autorizare e RLS — nu există niciun check `is_admin` în politici. Rezultat: orice elev logat poate rula din consolă
```js
supabase.from('content').delete().neq('id', '00000000-0000-0000-0000-000000000000')
```
și **șterge tot catalogul**, sau poate injecta rânduri arbitrare. Verificarea de admin există doar în ruta de frontend. Niciun alt fișier SQL nu retrage aceste politici, deci sunt active indiferent de ordinea aplicării.

**Fix:** înlocuiește politicile de INSERT/UPDATE/DELETE cu unele condiționate pe `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin)` (sau rutează toate scrierile prin service-role) și `REVOKE INSERT, UPDATE, DELETE ON content FROM authenticated`.

---

## 🟠 MAJOR — de reparat curând

### 4. Răspunsurile/soluțiile testelor premium din bibliotecă sunt citibile direct de oricine
**Fișier:** `supabase/ai_tutor_v7.sql:31` (politica `pub_read_all` pe `ai_public_library`)

Politica de citire e `FOR SELECT USING (true)`, iar coloana `payload` conține, pentru exerciții, chiar cheia: `{statement, options, answer, answer_type, solution}`. Endpoint-ul `ai-public.js` (linia 84) filtrează corect payload-ul cu `allowed = is_free || premium || created_by === userId` — dar acel filtru e doar la nivel de endpoint. Tabelul e citit și cu cheia anon (Navbar), deci un client poate ocoli endpoint-ul:
```js
supabase.from('ai_public_library').select('payload').eq('is_free', false)
```
și primi enunțuri + răspunsuri + soluții pentru toate testele premium.

**Fix:** schimbă politica în `USING (is_free = true)` (sau expune doar coloanele non-`payload` printr-un view) și forțează citirea itemului complet prin endpoint-ul service-role.

### 5. Costul AI al generărilor din admin și al task-urilor programate se logează ca ZERO
**Fișiere:** `api/_lib/claude.js:60`, `api/_lib/exgen.js:233`, apelate din `api/ai-exercise-agent.js:94,146,223`, `api/agent-cron.js:140`, `api/agent-tasks.js:186`

`claude.chatClaude` și acumulatorul din `exgen` întorc `usage = { prompt_tokens, completion_tokens }`, dar `ai.logUsage` citește `usage.in`, `usage.out`, `usage.model`:
```js
// ai.js:861
const base = { ..., tokens_in: usage.in || 0, tokens_out: usage.out || 0 };
const model = usage.model || null;   // → costMicroLei(null, ...) === 0
```
Apelanții trec obiectul brut, fără conversie, deci **exact cele mai scumpe operații** (generare de exerciții cu Opus/Sonnet/Fable, task-uri programate) se înregistrează cu `tokens_in=0, tokens_out=0, cost_micro=0`. Consecință: raportul zilnic de cost (`costwatch`) și alarma de prag subestimează masiv cheltuiala, iar bugetele bazate pe `ai_usage` nu văd deloc aceste apeluri. Contrast: `seo-cron.js:103` convertește corect `prompt_tokens → in` (deci intenția e clară — restul o omit). Variantă înrudită: `ai-seo-agent.js:42` pune `in/out` dar omite `model`, deci logează token dar cost 0.

**Fix:** convertește la apel (sau în `claude`/`exgen`): `ai.logUsage(supa, uid, endpoint, { in: r.usage.prompt_tokens||0, out: r.usage.completion_tokens||0, model: r.provider })`.

### 6. Alarma de cost „runaway" se stinge în tăcere când emailul eșuează
**Fișier:** `api/_lib/costwatch.js:127-141`

`checkThreshold` inserează întâi rândul de dedup, apoi:
```js
try { await mailer.sendMail({...}); return { alerted: true }; }
catch (e) { await supa.from('ai_cost_alerts').delete()...; return { alerted: false }; }
```
Dar `mailer.sendMail` **nu aruncă niciodată** — pe eșec (SMTP/Resend picat) întoarce `{ ok: false, error }` (documentat explicit în `mailer.js:57`). Deci `catch`-ul e cod mort: rândul de dedup rămâne, funcția raportează `alerted: true`, alarma zilei e marcată „trimisă" deși **nu s-a trimis nimic**, și nu se reîncearcă tot restul zilei. Exact în ziua în care costul explodează și emailul pică, nu afli. (`dailyReport` la `costwatch.js:101` are același `try/catch` inutil, impact mai mic.)

**Fix:** verifică valoarea de retur: `const r = await mailer.sendMail(...); if (!r.ok) { await supa...delete(); return { alerted:false, error:r.error }; }`.

### 7. Funcții `SECURITY DEFINER` apelabile direct de orice client (bypass RLS)
**Fișier:** `supabase/ai_tutor_schema.sql:144` (`bump_skill_mastery`) și `:74` (`enqueue_ingest`)

Ambele sunt `security definer`, dar nu sunt niciodată retrase din PUBLIC/anon/authenticated (spre deosebire de `delete_user_account` și `handle_new_user`, care au `REVOKE` explicit). PostgREST le expune la `/rest/v1/rpc/...`, deci orice client poate apela `bump_skill_mastery(p_user, ...)` cu un `p_user` arbitrar și, rulând ca definer, ocolește RLS pentru a scrie rânduri de „mastery" pentru orice utilizator; `enqueue_ingest` poate fi folosit de anon ca să inunde coada de ingest.

**Fix:** `REVOKE EXECUTE ON FUNCTION public.bump_skill_mastery(uuid,text,text,boolean), public.enqueue_ingest(text,uuid,text) FROM PUBLIC, anon, authenticated;` (păstrează grant-ul doar pentru service_role).

### 8. Un cont poate fi șters cu arhiva goală sau lipsă (erori de citire înghițite)
**Fișier:** `api/_lib/inactivity.js:298` (și `buildSnapshot` la ~185)

`const { data } = await supa.from('mentor_students').select('mentor_id')...` ignoră câmpul `error`; supabase-js întoarce `{ data: null, error }` pe eșec tranzitoriu, deci un read picat dă `mentorIds = []` → `return 0`, iar `account-cleanup` trece direct la `supa.auth.admin.deleteUser(...)` fără arhivă. Similar, `buildSnapshot` prinde eroarea de la citirea `progress` într-un `catch` gol → arhivă goală salvată (upsert) chiar înainte de ștergerea CASCADE ireversibilă. Garanția „rezultatele elevului rămân arhivate la mentori" e încălcată tăcut exact când baza are un hiccup în timpul cronului zilnic.

**Fix:** destructurează și verifică `error` pe citirile de mentori/progress și aruncă (ca `account-cleanup` să numere eșecul și să reîncerce mâine) în loc să tratezi eroarea ca „fără date".

### 9. Acțiunea `coach` (și analiza greșelilor) apelează AI fără rate-limit
**Fișier:** `api/ai-meditatii.js:292` (`coach`), plus `classifyMistakes` din `assessment_submit`/`submit_set`/`homework_submit`

`coach` face `authUser → requireUser → requireMeditatii → ai.chat({ model: COACH_MODEL })` dar **nu** cheamă `ai.enforceRateLimit`, spre deosebire de toate celelalte acțiuni generative (setup/lesson/exercises/remediation/review/simulare o cheamă). Un abonat (sau un client în buclă) poate emite apeluri AI nelimitate. În plus, `classifyMistakes` (`meditatii.js:644`) face un apel LLM care **nu e logat deloc** în `ai_usage`, deci scapă și de bugete, și de rapoartele de cost.

**Fix:** adaugă `await ai.enforceRateLimit(supa, userId, profile);` la începutul lui `coach` și înainte de apelurile `classifyMistakes`; returnează `usage` din `classifyMistakes` și logează-l.

### 10. Orice utilizator poate citi și „rezolva" orice temă (fără verificarea legăturii mentor-elev)
**Fișier:** `api/ai-assignment.js:178` (`getOne`) și `:198` (`submit`)

`getOne` aduce `ai_assignments` după `id`-ul de la client cu doar `requireUser`, fără verificarea unei legături mentor↔elev, și returnează enunțul/întrebările oricui ghicește un ID. `submit` acceptă orice `id`, notează cu AI, inserează un rând de rezultat sub `student_id`-ul apelantului și trimite notificare profesorului. Deci un utilizator străin poate enumera teme, le extrage conținutul și poate spama profesorul cu „elevul a rezolvat tema" + rânduri de rezultat false.

**Fix:** cere o legătură mentor↔elev existentă (sau un record explicit de partajare) înainte de a returna conținut sau a accepta submisia.

### 11. Ambiguitate public/privat pe bucket-ul `content-files`
**Fișiere:** `supabase/make_content_bucket_public.sql` vs `supabase/make_content_bucket_private.sql`

Există două scripturi one-shot contradictorii pentru același bucket. `get-file-url.js` semnează URL-uri (`createSignedUrl`), ceea ce protejează premium-ul **doar dacă bucket-ul e PRIVAT**. Dacă `make_content_bucket_public.sql` a fost ultimul aplicat (nimic nu împiedică re-rularea), fiecare PDF premium e descărcabil direct de la URL-ul public stocat în `file_url`, ocolind gardienii din `get-file-url.js`.

**Fix:** confirmă în producție `SELECT public FROM storage.buckets WHERE id='content-files'` = `false` și șterge `make_content_bucket_public.sql` ca să nu poată fi re-rulat.

### 12. Drift de schemă — coloane critice create de niciun fișier de migrare
**Coloane:** `profiles.is_admin`, `content.subcategory`, `content.profile`

Niciun fișier SQL nu creează `profiles.is_admin`, deși e cheia întregii autorizări (`http.js` `requireAdmin`, `get-file-url.js`, politici RLS în `pastreaza_rezultate.sql`, `admin_delete_policy.sql`). La fel `content.subcategory` / `content.profile` sunt inserate de `Admin.jsx:301` și citite de `ai-exam.js`. Producția merge doar pentru că au fost adăugate manual din dashboard. La o reconstrucție (staging/DR) din aceste scripturi, politicile și endpoint-urile de admin crapă („column ... does not exist").

**Fix:** adaugă o migrare: `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;` și `ALTER TABLE content ADD COLUMN IF NOT EXISTS subcategory text, ADD COLUMN IF NOT EXISTS profile text;`.

---

## 🟡 MINOR — robustețe, UX și corectitudine

**Frontend**
- `src/pages/RezolvariPage.jsx:188` — „Deschide imaginea": `window.open('')` e apelat **după** `await`-uri, deci browserul blochează popup-ul (`w` = null → aruncă). Nicio imagine din Rezolvări nu se deschide. Deschide fereastra sincron înainte de await-uri (cum face corect `ProfesorVirtual.jsx:819`).
- `src/pages/Profile.jsx:299` — după checkout Stripe se afișează bannerul „Abonament Premium activat!" și se cheamă `fetchProfile` o singură dată, dar `subscription_status='active'` e scris asincron de webhook; redirect-ul îl întrece des. Fără poll/retry, utilizatorul care tocmai a plătit rămâne pe „Cont gratuit". Fă poll la profil câteva secunde până devine `active`.
- `src/pages/InteractiveViewer.jsx:71` — deep-link `?id=` nu comută exercițiul odată ce unul e încărcat (`if (item || !idParam) return`, stare veche). Adaugă `key={idParam}` pe rută sau resetează starea pe schimbarea lui `idParam`.
- `src/pages/InteractiveViewer.jsx:483` — iframe-ul cu `srcDoc` folosește `allow-scripts` + `allow-same-origin` (sandbox-ul e efectiv anulat; scriptul poate citi sesiunea Supabase din `localStorage`). Azi HTML-ul vine doar din admin, dar lipsește apărarea în adâncime. Scoate `allow-same-origin` (tutorBridge folosește doar postMessage).
- `src/pages/PDFViewer.jsx:454` și `src/components/Discussions.jsx:176` — cleanup-ul revocă `blobUrl` capturat din render (care e `null` când efectul a rulat), deci URL-urile blob nu se revocă niciodată → scurgere de memorie per PDF/imagine deschisă. Ține URL-ul într-un `ref` sau variabilă locală în efect.
- `src/pages/ProfesorVirtual.jsx:470`, `AIExerciseAgent.jsx:398/408/576`, `main.jsx:13` — `sessionStorage.setItem` neînvelit în try/catch aruncă în Safari Private Mode și oprește generarea/„trimite la Admin". Învelește-le (ca restul codului).
- `src/components/AIExerciseAgent.jsx:294` — `FileSlot` e definit în corpul componentei-părinte, deci se remontează la fiecare render; dacă dialogul de fișier e deschis la un re-render, fișierul selectat se pierde. Mută-l la nivel de modul.
- `src/components/AITutor.jsx:69` — rescrierea link-urilor markdown pune URL-ul în `href` fără a escapa `"` → injecție de atribut din text AI. Escapează `"`/`'` în URL-ul capturat.

**Backend / logică**
- `api/_lib/exgen.js:386` — `normalize()` nu validează indexul răspunsului la grilă (nu îl limitează la `options.length`, nu respinge non-numeric). Un răspuns 1-based (`4` la 4 opțiuni) sau literă (`"B"`→NaN→0) produce întrebări auto-publicate imposibil de răspuns corect. `meditatii.js:622` face deja check-ul corect — replică-l.
- `api/_lib/exgen.js:1142` — în HTML-ul generat, explicația/răspunsul modelului intră în `innerHTML` neescapate, iar `var D=${JSON.stringify(data)}` e pus în `<script>` fără a escapa `</script>`. O explicație cu `</script>` (via prompt-injection dintr-un PDF sursă) sparge scriptul → XSS stocat în documentul publicat. Escapează cu `esc()` și emite JSON cu `.replace(/</g,'\\u003c')`. Aceeași problemă în copia din `src/lib/exerciseRender.js` (de ținut sincron).
- `api/_lib/meditatii.js:692` — `bumpStreak` calculează „azi"/„ieri" în UTC, deși restul modulului folosește `Europe/Bucharest` (`roToday()`). Între 00:00–03:00 local, sesiunile sunt atribuite zilei greșite → streak-uri greșite. Folosește același `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' })`.
- `api/_lib/meditatii.js:100` — `categoryFor({})` întoarce `"clasa-undefined"` (fără fallback pentru `grade` lipsă); `ai-correct.js:514` îl cheamă pentru **toți** userii care corectează un PDF, poluând `ai_skill_mastery` cu rânduri „clasa-undefined". Pune fallback `'general'`.
- `api/_lib/exgen.js:1404` — `runTask` ignoră eroarea de la `insert` în `agent_task_runs`; la eșec, rezultatul (HTML doar în `run.result`, tăiat la 700k) dispare, dar tot se setează `last_run_at` și se trimite email „așteaptă aprobare". Verifică `error` și nu marca task-ul ca făcut pe eșec.
- `api/social-cron.js:51` — publicarea nu „revendică" atomic rândul înainte de a posta; dacă funcția e omorâtă la `maxDuration` între `publishPost` reușit și update-ul de status, următorul tick republică → postări/Reels duplicate. Fă `update ... set status='publishing' where id=X and status='approved'` întâi.
- `api/agent-cron.js:68` — garda anti-dublură se bazează pe `last_run_at`, scris doar **după** finalizarea rulării (~700s). Un „Rulează acum" din admin chiar înainte de ora programată poate rula task-ul concomitent cu cronul → generare dublă și (cu `auto_post`) două teste publicate. Revendică task-ul la start.
- `api/contact.js:93` — formularul trimite email de confirmare către o adresă neverificată, cu conținut de la expeditor (backscatter/amplificare, deși limitat la 5/oră/IP). Trimite confirmarea doar către adrese verificate.
- `api/rezolvare-url.js:22` — pentru Rezolvări premium verifică doar `subscription_status === 'active'`, nu și `is_admin`; un admin fără abonament primește 403 (inconsistent cu `get-file-url.js`). Adaugă `is_admin`.
- `api/_lib/http.js` — `signToken`/`verifyToken` nu validează `ts`, deci tokenii „expirați" (ex. linkuri de dezabonare) rămân valabili la nesfârșit. Impact mic, dar de adăugat verificarea expirării.

**Config**
- `vite.config.js:43` — `/sitemap.xml` (rescris în `vercel.json` către `/api/sitemap`) nu e în `navigateFallbackDenylist`, deci pentru un vizitator cu service worker înregistrat navigarea la `/sitemap.xml` primește app shell-ul cachuit în loc de XML. Adaugă `/^\/sitemap\.xml$/`.
- `.env.ai.example` — documentează doar variabilele OpenAI/SITE_*, dar codul cere și `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_JWT_SECRET`, `RESEND_API_KEY`/`EMAIL_*`, `GOOGLE_SERVICE_ACCOUNT_JSON`, setul `YT_*` etc. Un operator care provizionează strict din acest fișier are agenții Claude și fluxurile Stripe/email picate la runtime. Completează-l.

---

## ✅ Verificat și în regulă (ca să nu re-verifici)

- **Stripe webhook** (`stripe-webhook.js`): citește corect **raw body**-ul (`bodyParser: false` + `getRawBody`) și verifică semnătura înainte de folosire. Prețurile din `create-checkout.js` sunt server-side (fără sume controlate de client).
- **account-cleanup**: ștergerea e bine păzită — exclude `is_admin` și abonații activi (`isProtected`, re-verificat la ștergere), plus podeaua de 29 de zile și conturile cu `last_active_at` NULL niciodată eligibile. (Problema #8 e despre arhivare, nu despre criteriul de ștergere.)
- **Endpoint-urile de admin** (`admin-stats`, `admin-users`, `rezolvari-admin`, `seo-actions`, `seo-rank`, `social-queue`, `agent-tasks`, `newsletter`) impun `authUser` + `requireAdmin`. Cele de profesor verifică relația mentor-elev/grup pe fiecare ramură.
- **markdown.js**: pipeline „escape-first" cu delimitatori NUL — nu am găsit gaură de XSS stocat. `page-meta.js` escapează `<` în JSON-LD.
- **Toate `.upsert(...onConflict)`** au constrângere unică corespunzătoare (progress, ai_pdf_results, ai_topups, discussion_likes, mentor_students, ai_knowledge etc.).
- **Toate cele 10 cr-onuri din `vercel.json`** au `path?action=` care corespunde unei acțiuni tratate în handler (și fiecare impune `isCronRequest` — care însă are gaura #1).
- Tokenii de dezabonare din newsletter sunt semnați HMAC per-uid și comparați constant-time.
- Build de producție OK, 161/161 teste OK, zero erori de sintaxă/import.

---

## Recomandare de ordine

1. **#1, #2, #3** (critice) — expun date/bani/ștergeri chiar acum; sunt fixuri mici și localizate.
2. **#4, #7, #11** — restul găurilor de securitate/paywall (majoritar SQL/RLS).
3. **#5, #6, #9** — observabilitatea și limitarea costului AI (altfel „debug-ul de cost" e orb).
4. **#8, #10, #12** — integritate date și DR.
5. Minorele — pe măsură ce atingi zonele respective.

Pot să aplic oricare dintre aceste fixuri direct în proiect — spune-mi cu care începem (recomand cele 3 critice).
