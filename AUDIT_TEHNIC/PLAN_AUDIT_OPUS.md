# PLAN_AUDIT_OPUS.md — Plan de audit și remediere pentru ExamenMate (examenmate.com)

| | |
|---|---|
| **Data** | 14 noiembrie 2026 |
| **Baza de cod** | repo `mate-online`, ramura `main`, commit `02ab37a` („plan 2", 13 nov. 2026), arborele de lucru curat |
| **Întocmit de** | Claude (etapa de cartografiere și planificare) |
| **Destinatar** | Claude Opus 5.5 (execuția auditului și a remedierilor) + proprietarul platformei |
| **Ce este** | Un PLAN. Nu s-a implementat nimic: niciun fișier funcțional, nicio tabelă și nicio configurație nu au fost modificate. |

> **Confidențialitate.** Documentul descrie vulnerabilități încă deschise, cu drumul exact prin care pot fi folosite. Dacă repo-ul GitHub este public (nu am verificat — vezi §3.6), **nu comite acest fișier** până când problemele P0 nu sunt închise; ține-l local sau exclude `AUDIT_TEHNIC/` din commit.

**Cuprins:** 1. Rezumat executiv · 2. Stadiul lucrului · 3. Arhitectura identificată · 4. Constatări preliminare · 5. Lista componentelor de auditat · 6. Ordinea verificărilor · 7. Metodologia de verificare și testare · 8. Documentarea erorilor și a remedierilor · 9. Planul de remediere · 10. Instrucțiuni pentru Opus 5.5 · 11. Criteriile de acceptare · 12. Deciziile proprietarului · Anexa A (harta RLS) · Anexa B (matricea rutelor) · Anexa C (interogări de diagnostic) · Anexa D (verificări deja rulate)

---

## 0. Cum se citește documentul

**Starea unei constatări**

| Marcaj | Înțeles |
|---|---|
| ✅ **Confirmat în cod** | Am citit codul/SQL-ul din repo și problema reiese direct din el. |
| 🟡 **De confirmat pe producție** | Reiese din scripturile SQL din repo, dar baza de date reală a fost modificată și manual din dashboard (vezi DB-05), deci starea din producție trebuie citită, nu presupusă. |
| ❓ **Necunoscut** | Nu am verificat. Nu trata rândul ca pe o problemă și nici ca pe o zonă curată. |

**Priorități** (cele cerute de proprietar): **P0** critică (securitate, pierdere de date, plăți, acces neautorizat) · **P1** majoră (funcții importante defecte) · **P2** medie (afectează experiența) · **P3** minoră (optimizări). Prioritățile din acest document sunt **preliminare**: Opus le confirmă sau le schimbă după verificare.

**Identificatori.** Constatările poartă ID-uri pe domenii (`DB-01`, `PAY-03`, `AI-01`…). Păstrează-le neschimbate în toate documentele ulterioare; constatările noi primesc numărul următor din domeniul lor.

---

## 1. Rezumat executiv

Platforma este mult mai mare decât lasă să se vadă interfața: un SPA React servit de Vercel, 66 de funcții serverless, aproximativ 95 de tabele Supabase create din 104 scripturi SQL rulate manual, plăți Stripe (abonament, pachete AI, bilete la meditații live), un sistem AI cu bugete și cote, plus agenți automați porniți de 18 cron-uri.

**Ce este solid.** Autentificarea pe server este centralizată (`api/_lib/http.js`, verificare locală a JWT-ului). În toate funcțiile citite, drepturile sunt verificate corect (profesor↔elev, părinte↔copil, admin). Scorurile testelor interactive sunt recalculate pe server. Consumul AI are bugete, cote și contabilizare în bani. Paginile publice primesc meta-date corecte din server. Există 1 271 de teste automate (1 269 trec, 2 sunt sărite, niciunul nu pică) și un flux CI care rulează testele și build-ul.

**Unde se concentrează riscul.** Nu în funcțiile serverless, ci în **drumul direct dintre browser și baza de date**. Aplicația are două căi către date (vezi §3.3): prin funcții (bine păzite) și direct din browser, unde singura pază sunt politicile RLS. Pe această a doua cale, tabela `profiles` — care ține și abonamentul, și dreptul de administrator — poate fi citită de oricine și modificată de proprietarul rândului fără nicio restricție pe coloane.

**Primele patru urgențe (P0):**

1. **DB-01** — un utilizator autentificat își poate seta singur `subscription_status = 'active'` și `is_admin = true`.
2. **DB-02** — profilurile tuturor utilizatorilor (nume, e-mail, identificatori Stripe) pot fi citite de oricine; forumul trimite e-mailurile autorilor în browserul fiecărui vizitator.
3. **API-01** — trei funcții semnează sau copiază cu cheia de serviciu orice fișier din Storage al cărui drum îl dă clientul.
4. **PAY-01** — înlănțuind DB-01 cu DB-02, un utilizator poate deschide portalul de plăți Stripe al altui client.

**Ce nu se știe.** Starea reală a bazei de date (politici, privilegii, triggere adăugate manual), variabilele de mediu din Vercel, configurarea din Stripe Dashboard și comportamentul site-ului live nu au fost verificate. De aceea auditul lui Opus începe cu o „fotografie" a producției făcută numai cu interogări de citire (§6, etapa A0; Anexa C).

**Cifrele analizei preliminare:** 57 de constatări (4 × P0, 10 × P1, 25 × P2, 18 × P3) și 8 zone marcate explicit ca neverificate. Lista completă este în §4.

---

## 2. Stadiul lucrului la întrerupere (ține loc de PROGRESS_AUDIT.md)

### 2.1 Ultima etapă finalizată

**Cartografierea proiectului este completă** (structură, tehnologii, hartă de componente, fluxuri principale). Peste ea am făcut o analiză statică a fluxurilor cu risc mare: autentificare, plăți, limitele AI, RLS, Storage. Planul inițial în 12 etape a fost oprit la cererea proprietarului înainte de etapa pe site-ul live.

| Activitate | Stare |
|---|---|
| Cartografiere (structură, stack, hartă de componente) | ✅ terminată |
| Harta RLS: toate cele 104 scripturi SQL parcurse automat (tabele, politici, privilegii, funcții) | ✅ terminată — rezultatul e în Anexa A |
| Matricea endpoint-urilor (ce tip de pază are fiecare) | ✅ terminată — Anexa B |
| Fluxul Stripe (checkout, portal, webhook) citit integral | ✅ citit; constatările sunt în §4 |
| Limitele și costurile AI (`api/_lib/ai.js`, parțial) | ✅ părțile de acces, limite, bugete, pregătirea conversației |
| Teste automate, build, `npm audit` — rulate pe o **copie** din afara proiectului | ✅ rezultatele sunt în Anexa D |
| Verificări pe site-ul live (meta, erori în consolă, viteză, probe RLS cu cheia publică) | ❌ neîncepute |
| Citirea funcțiilor mari (`live.js`, `ai-meditatii.js`, `exgen.js` ș.a.) | ❌ doar căutări de tipare |
| Cele 7 documente din `AUDIT_TEHNIC/` | ❌ niciunul scris |

Copia de lucru și uneltele folosite la analiză au stat în afara proiectului și dispar odată cu sesiunea. Tot ce merită păstrat din ele este în acest document (Anexele A, B și D).

### 2.2 Ultimul fișier analizat

Ultimul fișier citit: `src/lib/continuare.js`. Ultima căutare: încărcările în Storage făcute din browser (`src/pages/Admin.jsx` rândurile 186, 287, 440, 748; `src/components/ContentAdminTools.jsx` rândul 243) și politicile pentru bucketul `content-files` din `supabase/*.sql`.

### 2.3 Ce a fost citit și ce nu

**Citite integral:** `CLAUDE.md`, `package.json`, `vercel.json`, `vite.config.js`, `index.html`, `public/robots.txt`, `.github/workflows/verificare.yml`, `README.md`, `DEBUG-RAPORT.md`; `src/main.jsx`, `src/App.jsx`, `src/lib/supabase.js`, `src/lib/api.js`, `src/lib/plans.js`, `src/lib/continuare.js`, `src/context/AuthContext.jsx`, `src/components/ProtectedContent.jsx`; `api/_lib/http.js`, `api/_lib/abonamentCopil.js`, `api/_lib/score.js`, `api/stripe-webhook.js`, `api/create-checkout.js`, `api/create-portal.js`, `api/get-file-url.js`, `api/get-preview-url.js`, `api/rezolvare-url.js`, `api/ai-account.js`, `api/ai-chat.js`, `api/ai-chat-stream.js`, `api/ai-vision.js`, `api/ai-transcribe.js`, `api/ai-score.js`, `api/ai-progress.js`, `api/ai-activity.js`, `api/ai-feedback.js`, `api/asociere.js`, `api/admin-users.js`, `api/admin-stats.js`, `api/rezolvari-admin.js`, `api/client-error.js`, `api/contact.js`, `api/vizita.js`, `api/social-image.js`, `api/sitemap.js`; SQL: `schema.sql`, `supabase_grants.sql`, `fix_grants_v3.sql`, `progress_server_only.sql`, `fix_content_bucket_private.sql`, `make_content_bucket_private.sql`, `fix_content_write_admin_only.sql`, `fix_schema_drift_columns.sql`, `teacher_student_schema.sql`, `groups_parents_schema.sql`, `delete_account_function.sql`, `ai_personal_pdf.sql`, `public_library_pdf.sql`, `personal_pdfs_bucket.sql`.

**Citite parțial:** `api/_lib/ai.js` (rândurile 1–300, 1108–1500, 1893–2340 din 2 529), `api/_lib/mathcheck.js`, `api/_lib/tools.js`, `api/_lib/catalog.js` (95–171), `api/ai-pdf-context.js` (360–420), `api/ai-public.js` (publicare, citire, transcriere), `api/page-meta.js` (escapări, recenzii, articole), `api/_lib/seoRute.js`, `api/account-cleanup.js`, `api/teacher-students.js`, `api/teacher-manage.js`, `src/pages/InteractiveViewer.jsx` (salvarea scorului), `src/components/Discussions.jsx`, `src/components/AITutor.jsx` (formatarea mesajelor), `src/lib/katex.js`, `src/pages/Admin.jsx`, paginile de autentificare.

**Necitite** (doar numărate sau atinse de căutări): `api/live.js` (2 943 de rânduri), `api/ai-meditatii.js` (2 337), `api/_lib/exgen.js` (2 492), `api/_lib/seo.js` (1 854), `api/_lib/generatoare.js` (1 732), `api/_lib/liveLesson.js` (1 406), `api/_lib/examBotRun.js` (1 274), `api/_lib/meditatii.js` (1 205), `api/_lib/live.js` (1 124), `api/ai-correct.js` (917), `api/group-assignment.js` (824), `api/homework.js` (809), `api/ai-exam.js`, `api/messages.js`, `api/colegi.js`, `api/duel.js`, `api/turneu.js`, `api/gamificare.js`, `api/harta.js`, `api/fise.js`, `api/rezolva-pdf.js`, `api/ai-handwriting.js`, `api/ai-practice.js`, `api/ai-assignment.js`, `api/ai-generate-interactive.js`, `api/ai-ingest.js`, `api/ai-notify.js`, `api/newsletter.js`, `api/review-invite.js`, `api/content-admin.js`, `api/content-check.js`, `api/admin-debug.js`, `api/agent-tasks.js`, `api/agent-cron.js`, `api/exam-bot.js`, `api/seo-*.js`, `api/social-cron.js`, `api/social-queue.js`, restul din `api/_lib/`; din `src/`: aproape toate paginile și componentele mari (`Meditatii.jsx`, `PDFViewer.jsx`, `TeacherResults.jsx`, `ProfesorVirtual.jsx`, `LiveRoom.jsx`, `SpatiuDeLucru.jsx`, `Mesagerie.jsx`, `GroupAssignment.jsx`, `Navbar.jsx` ș.a.), ghidurile `GHID_*.md`, `CHANGELOG-REPARATII.md` (496 KB — doar căutat), `.env.ai.example`.

### 2.4 Problemele deja identificate

Vezi §4 (57 de constatări, cu dovezi și cu ce are Opus de confirmat la fiecare).

### 2.5 Ce urmează

Auditul propriu-zis, în ordinea din §6: A0 (fotografia producției) → A1 (confirmarea P0/P1) → A2…A9 pe domenii → scrierea celor 7 documente → remedierea pe etape (§9).

### 2.6 Documente

| Document | Stare |
|---|---|
| `AUDIT_TEHNIC/PLAN_AUDIT_OPUS.md` (acesta) | ✅ finalizat |
| `01_RAPORT_GENERAL.md` … `07_HANDOFF_OPUS.md` | ❌ neîncepute — le scrie Opus, după structura din §8 |
| `PROGRESS_AUDIT.md` | ❌ nu a fost creat separat (proprietarul a cerut un singur document); conținutul lui este acest capitol. Opus îl creează la prima lui sesiune (§8.4). |

---

## 3. Arhitectura identificată

### 3.1 Inventar

| Strat | Ce am găsit | Unde |
|---|---|---|
| **Frontend** | React 18 + Vite 5, JavaScript/JSX (**fără TypeScript, fără ESLint**), React Router 6 cu 44 de rute (toate încărcate la cerere, mai puțin pagina principală), stare globală prin `AuthContext`; ≈41 de pagini, ≈105 componente, ≈85 de module în `src/lib` | `src/` (235 de fișiere, 4,1 MB) |
| **PWA / Android** | `vite-plugin-pwa` (Workbox, actualizare automată), notificări push (`public/sw-push.js`), aplicație Android TWA peste PWA (`com.examenmate.app`) | `vite.config.js`, `android-twa/`, `public/.well-known/assetlinks.json` |
| **Backend** | Funcții serverless Vercel (Node, CommonJS): 66 de rute + ≈74 de module comune; regiunea `fra1`; `maxDuration` 800 s pentru toate; 18 cron-uri | `api/`, `api/_lib/`, `vercel.json` |
| **Bază de date** | Supabase: Postgres + Auth + Storage + Realtime + pgvector; ≈95 de tabele, 46 de funcții SQL, RLS activat pe toate tabelele definite în repo | `supabase/` (104 scripturi, **rulate manual în SQL Editor**, fără sistem de migrări) |
| **Storage** | Bucketuri: `content-files` (privat), `content-files-free` (public), `discussions` (public), `personal-pdfs` (privat, 25 MB, doar PDF), `agent-media` (public), `live-media` (public) | scripturile SQL; starea reală ❓ |
| **Autentificare** | Supabase Auth: e-mail + parolă, Google, Discord; rol auto-declarat (`elev` / `profesor` / `parinte`); administratorul = `profiles.is_admin` | `src/context/AuthContext.jsx` |
| **Plăți** | Stripe Checkout: abonament lunar 50 lei / anual 500 lei; plăți unice — pachete AI (10 / 20 lei) și bilete la meditații live (20 / 30 lei); Billing Portal; un webhook | `api/create-checkout.js`, `api/create-portal.js`, `api/stripe-webhook.js` |
| **AI** | Furnizor compatibil OpenAI, configurabil din variabile de mediu (chat, vedere, generare, embeddings, transcriere audio); Claude (Anthropic) pentru agenții de generare și de administrare; voce sintetizată; RAG hibrid (vectori + text) | `api/_lib/ai.js`, `claude.js`, `exgen.js`, `tts.js`, `ingest.js` |
| **Integrări** | Gmail SMTP (nodemailer), Web Push, GitHub (agentul de debug deschide pull request-uri), Google Search Console, YouTube, rețele sociale (Meta), GA4 + Meta Pixel + TikTok Pixel (după consimțământ), Vercel Analytics | `api/_lib/mailer.js`, `push.js`, `github.js`, `google.js`, `youtube.js`, `social.js`; `src/lib/analytics.js` |
| **CI** | GitHub Actions: `npm ci` → `npm test` → `npm run build` la fiecare push și pull request | `.github/workflows/verificare.yml` |

### 3.2 Fluxurile principale

```
 Elev / Profesor / Părinte / Vizitator
 ┌─────────────────────────┐   HTML + JS (static)   ┌──────────────────────────────────────────┐
 │ SPA React (PWA / TWA)   │◄───────────────────────┤ Vercel: dist/ + service worker           │
 └───┬─────────────────┬───┘                        │ rute publice → /api/page-meta (meta SEO)  │
     │ (A)             │ (B)  Authorization: Bearer │ /sitemap.xml → /api/sitemap               │
     │ cheia publică   │      <JWT Supabase>        └──────────────────────────────────────────┘
     │ + JWT           ▼
     │        ┌──────────────────────────┐  cheia de serviciu   ┌─────────────────────────────┐
     │        │ /api/*  (66 de funcții)  ├─────────────────────►│ Supabase                    │
     │        │ ocolesc RLS              │                      │ Auth · Postgres + RLS       │
     │        └───┬──────────────────────┘                      │ Storage · Realtime · vectori│
     └────────────┼────────────────────────────────────────────►│                             │
       direct, păzit DOAR de RLS + GRANT                        └─────────────────────────────┘
                  │
                  ├──► Modele AI (chat, vedere, generare, embeddings, audio, voce)
                  ├──► Stripe API          Stripe ──webhook (semnătură)──► /api/stripe-webhook
                  ├──► Gmail SMTP, Web Push
                  └──► GitHub, Google Search Console, YouTube, Meta
       Vercel Cron (18 programări) ──Bearer CRON_SECRET──► /api/…?action=…
```

### 3.3 Principiul care organizează auditul: două căi către date

| | Calea A — direct din browser | Calea B — prin funcții serverless |
|---|---|---|
| Cine o folosește | `supabase.from(...)` și `supabase.storage` din `src/` | `fetch('/api/...')` cu tokenul sesiunii |
| Cu ce drepturi | rolul `anon` sau `authenticated` | cheia de serviciu, care **ocolește RLS** |
| Singura pază | politicile RLS + privilegiile (GRANT) pe tabele, coloane și bucketuri | codul funcției (`authUser`, `requireAdmin`, verificările de apartenență) |
| Cum se auditează | **tabelă cu tabelă** (Anexa A) | **endpoint cu endpoint** (Anexa B) |
| Starea preliminară | **aici sunt problemele P0** | solidă în tot ce am citit; o excepție (API-01) |

Consecință pentru Opus: o funcție serverless corectă nu protejează nimic dacă aceeași tabelă poate fi scrisă direct pe calea A. Orice valoare pe care serverul o folosește ca să decidă drepturi (`is_admin`, `subscription_status`, `stripe_customer_id`, `payload.bucket`, scorul din `progress`) trebuie să fie **imposibil de scris din browser**.

Tabelele scrise astăzi direct din browser (după codul din `src/`): `profiles` (actualizare), `content` (doar administratorul), `progress` (drumul de rezervă), `discussions`, `discussion_likes`, `reviews`, `ai_conversations`, `ai_messages`, `ai_personal_items`, `user_badges`; Storage: `personal-pdfs` (folderul propriu), `discussions`, `content-files` (administratorul).

### 3.4 De ce depind drepturile (sursele de adevăr)

| Decizie | Sursa | Poate fi scrisă din browser? |
|---|---|---|
| Este administrator | `profiles.is_admin` (citit de `requireAdmin`, de politicile RLS pe `content`, `discussions`, `reviews`, `progress`) | 🟡 **da, după scripturile din repo** (DB-01) |
| Are Premium | `profiles.subscription_status` (citit de `isPremium`, `get-file-url`, RAG, meditații live) | 🟡 **da** (DB-01) |
| Clientul Stripe al contului | `profiles.stripe_customer_id` (portal, plăți unice) | 🟡 **da** (PAY-01) |
| Rolul (elev / profesor / părinte) | `profiles.role`, ales de utilizator | da, intenționat — deci nu trebuie să dea privilegii reale |
| Profesor ↔ elev, părinte ↔ copil | `mentor_students` (scris doar de server, prin cod de invitație sau token semnat) | nu ✅ |
| Fișierul unui material personal | `ai_personal_items.payload.bucket` / `.pdfPath` | **da** (API-01) |
| Scorul unui test | `progress.score` | 🟡 da, dacă politicile vechi mai există (DB-04) |
| Cron legitim | `CRON_SECRET` în antet (sau `?secret=`) | nu, dacă variabila e setată ❓ |
| Tokenuri de invitație / acces | HMAC cu `AI_SIGNING_SECRET` (sau, în lipsă, cu cheia de serviciu) | nu |

### 3.5 Componentele funcționale și legăturile dintre ele

| Componentă | Interfață | Funcții / module | Tabele principale |
|---|---|---|---|
| Biblioteca de materiale (PDF, teste interactive, manuale) | `ContentPage`, `PDFViewer`, `InteractiveViewer`, paginile de clasă, EN, BAC | `get-file-url`, `get-preview-url`, `ai-score`, `content-admin` | `content`, `progress`, bucketul `content-files` |
| Profesorul Virtual (chat, foto-rezolvare, corectare, generare) | `AITutor` (widget), `ProfesorVirtual`, `SpatiuDeLucru`, `RezolvarePdf` | `ai-chat(-stream)`, `ai-vision`, `ai-correct`, `ai-handwriting`, `rezolva-pdf`, `ai-exam`, `ai-practice`, `ai-generate-interactive`, `ai-pdf-context`; `_lib/ai.js`, `tools.js`, `mathcheck.js`, `pregen.js` | `ai_conversations`, `ai_messages`, `ai_usage`, `ai_topups`, `ai_knowledge`, `ai_pdf_text`, `ai_personal_items` |
| Meditații (plan personal) și meditații live (săli cu profesor AI) | `Meditatii`, `MeditatiiLive`, `LiveRoom`, `PregatireExamen` | `ai-meditatii`, `live`; `_lib/meditatii.js`, `live.js`, `liveLesson.js`, `tts.js` | `ai_meditatii_*`, `live_*` (sesiuni, lecții, bilete, mesaje) |
| Pregătește-mă de examen, Arena (XP, ligi, dueluri, turnee, hartă) | `PregatesteMa`, `Arena`, `Harta` | `gamificare`, `duel`, `turneu`, `harta`; `_lib/xp.js`, `misiune.js`, `pregatireZilnica.js` | `user_stats`, `xp_events`, `daily_*`, `duels`, `tournament_*`, `league_*`, `chapter_state` |
| Profesori și părinți (grupe, teme, teste pe grupă, catalog, medii) | `Profile`, `TeacherResults`, `GroupAssignment`, `CatalogNote`, `ParentAIActivity` | `teacher-students`, `teacher-manage`, `homework`, `group-assignment`, `ai-assignment`, `ai-teacher`, `ai-activity`, `asociere` | `mentor_students`, `mentor_groups`, `homework*`, `group_assignment*`, `teacher_marks`, `mentor_grade_periods` |
| Comunitate (forum, mesagerie, colegi, biblioteca utilizatorilor, recenzii) | `Discussions`, `Mesagerie`, `ColegiiMei`, `BibliotecaUtilizatorilor`, `Recenzii` | `messages`, `colegi`, `ai-public`, `review-invite` | `discussions`, `discussion_likes`, `chat_*`, `buddies`, `ai_public_library`, `reviews` |
| Plăți | `Pricing`, `Profile`, `AILimite` | `create-checkout`, `create-portal`, `stripe-webhook`; `_lib/abonamentCopil.js` | `profiles` (4 coloane), `ai_topups`, `live_tickets` |
| Administrare și agenți | `Admin` și panourile lui | `admin-*`, `agent-tasks`, `agent-cron`, `ai-exercise-agent`, `ai-seo-agent`, `content-check`, `exam-bot`, `seo-*`, `social-*`, `newsletter`, `account-cleanup` | `agent_*`, `content_checks`, `debug_runs`, `exam_bot_*`, `seo_*`, `social_posts`, `newsletter_*`, `articole` |
| SEO și măsurare | — | `page-meta`, `sitemap`, `vizita`, `client-error` | `seo_meta`, `articole`, `page_views`, `client_errors` |

### 3.6 Necunoscute de arhitectură (nu le-am verificat — nu presupune)

- Starea reală a bazei de date: politici, privilegii pe coloane, triggere, politicile de Storage, care dintre cele 104 scripturi au fost rulate.
- Variabilele de mediu din Vercel (ce modele AI sunt folosite de fapt, dacă `CRON_SECRET`, `SITE_ORIGIN`, `AI_SIGNING_SECRET`, `SUPABASE_JWT_SECRET` sunt setate).
- Stripe Dashboard: evenimentele abonate la webhook, regulile de reîncercare a plăților, metodele de plată, dacă există și alte linkuri de plată pe același cont.
- Planurile Supabase și Vercel (limite, copii de siguranță, cost).
- Dacă există un mediu de test (al doilea proiect Supabase, chei Stripe de test, deploy de previzualizare).
- Dacă repo-ul GitHub este public sau privat.
- Comportamentul site-ului live: erori în consolă, viteză, afișare pe telefon, ce văd motoarele de căutare.
- Numărul real de utilizatori, de abonați și volumul datelor.

---

## 4. Constatări preliminare, în ordinea impactului

Aceste constatări vin din analiza deja făcută. **Nu sunt rezultatul unui audit complet**: sunt punctul de plecare al lui Opus, care le confirmă (sau le infirmă) înainte de a le trece în documentele finale. La fiecare am notat ce am văzut efectiv și ce a rămas de verificat.

### 4.1 Tabloul priorităților

| Prioritate | Număr | Constatări |
|---|---|---|
| **P0** | 4 | DB-01, DB-02, API-01, PAY-01 |
| **P1** | 10 | DB-03, DB-04, DB-05, API-02, PAY-02, PAY-03, PAY-04, AI-01, AI-02, SEC-01 |
| **P2** | 25 | DB-06…09, API-03, PAY-05…08, AI-03, AI-04, SEC-02…04, LEG-01, SEO-01, PERF-01…03, COST-01, COST-02, EDU-01…03, OPS-01 |
| **P3** | 18 | DB-10, DB-11, API-04, API-05, PAY-09, AI-05…07, SEC-05, SEC-06, FE-01…03, SEO-02…04, COST-03, OPS-02 |
| **❓ neverificat** | 8 zone | DB-12, API-06, PAY-10, AI-08, SEC-07, FE-04, SEO-05, EDU-04 |

### 4.2 P0 — critice

#### DB-01 · Utilizatorul își poate modifica singur abonamentul și dreptul de administrator
- **Stare:** ✅ confirmat în scripturile SQL · 🟡 de confirmat pe producție.
- **Ce am văzut.** Politicile de actualizare pe `profiles` cer doar ca rândul să fie al utilizatorului, fără nicio restricție pe coloane: `"Users can update own profile"` (`supabase/schema.sql:63-65`) și `profiles_update_own` (`supabase/supabase_grants.sql:83-87`), peste `GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated` (același fișier, r. 71-72). În niciunul dintre cele 104 scripturi nu există un trigger sau privilegii pe coloane care să protejeze `is_admin`, `subscription_status`, `stripe_customer_id`, `subscription_id`. Că producția permite actualizarea directă e sigur: interfața se bazează pe ea (`src/context/AuthContext.jsx:118-126`, `src/components/AccountSettings.jsx:41, 77, 87`, `src/pages/Profile.jsx:306-318`, `src/lib/teacherCode.js:31-33`).
- **Efect.** Din consola browserului, orice cont poate obține Premium gratuit și drept de administrator. Dreptul de administrator deschide: toate funcțiile cu `requireAdmin` (`api/_lib/http.js:194-198`), scrierea și ștergerea întregului catalog (politicile din `fix_content_write_admin_only.sql`), ștergerea postărilor din forum, citirea progresului tuturor elevilor, scutirea de bugetele AI (`api/_lib/ai.js:1233`) și agentul de debug, care deschide pull request-uri pe GitHub. Comentariul din `.github/workflows/verificare.yml` spune că acestea se pot publica din panoul Admin; dacă se confirmă în `api/admin-debug.js`, lanțul duce până la rularea de cod propriu pe server, cu acces la toate secretele.
- **Ce confirmă Opus.** Interogările C1, C4, C5 din Anexa C (politicile, privilegiile pe coloane și triggerele de pe `profiles`). Tot acolo, C8 arată dacă există conturi „active" fără client Stripe sau administratori neașteptați — semn că breșa a fost deja folosită. Nu testa scrierea pe producție fără acordul proprietarului (§7.2).
- **Direcția remedierii.** Listă albă de coloane pe care utilizatorul le poate actualiza (R1.1). Pe termen mediu, câmpurile de abonament se mută într-o tabelă pe care browserul nu o poate scrie.

#### DB-02 · Profilurile tuturor utilizatorilor pot fi citite de oricine
- **Stare:** ✅ confirmat în SQL și în codul clientului · 🟡 de confirmat dacă și vizitatorii fără cont au acces în producție.
- **Ce am văzut.** `GRANT SELECT ON public.profiles TO anon` și politica `profiles_select_all … USING (true)` (`supabase/supabase_grants.sql:69-81`), plus `"Public profiles readable" … USING (true)` (`supabase/fix_discussions_profiles_rls.sql:6-10`). Forumul chiar citește profilurile altora, **cu e-mail**: `src/components/Discussions.jsx:285` și `:421` (`profile:profiles(full_name, email, avatar_url)`), `:452-453`; la r. 317, când lipsește numele, se afișează public partea dinaintea lui `@` din e-mail. La fel `src/components/Navbar.jsx:165`.
- **Efect.** Oricine are cheia publică (este în JavaScript-ul site-ului) poate descărca lista utilizatorilor: nume, e-mail, rol, codul de profesor, identificatorii Stripe, cine e administrator, cine e abonat. O parte dintre utilizatori sunt minori. E-mailurile autorilor din forum ajung în browserul fiecărui cititor.
- **Ce confirmă Opus.** C1 și C3 din Anexa C. Cu acordul proprietarului, o singură cerere `HEAD` cu numărătoare, fără a descărca rânduri (§7.2).
- **Direcția remedierii.** Politica de citire devine „doar rândul propriu"; forumul folosește `discussions.author_name` (coloană adăugată de `pastreaza_date_publice.sql` — de confirmat că există în producție). **Atenție:** nu retrage privilegiul `SELECT` al rolului `anon` de pe tabelă fără să verifici politicile altor tabele care citesc `profiles` în subinterogări (de exemplu `reviews_select`, valabilă și pentru `anon`): fără privilegiu, citirea recenziilor ar da eroare. Se schimbă politica de rând, nu privilegiul (R1.2).

#### API-01 · Serverul citește din Storage orice fișier al cărui drum îl dă clientul
- **Stare:** ✅ confirmat în cod (trei locuri) · neexploatat, netestat pe producție.
- **Ce am văzut.**
  1. `api/ai-public.js`, acțiunea `publish` (r. 208-216): `const bucket = payload.bucket || 'personal-pdfs'`, apoi descărcare cu cheia de serviciu din `payload.pdfPath` și copiere în `public-library/…`. Autorul primește apoi un link semnat la `get` (r. 156, 162-166). Singura condiție este `role === 'profesor'` (r. 196-198), iar rolul și-l alege fiecare. `cleanPdfPayload` (r. 37-47) nu verifică nici bucketul, nici drumul.
  2. `api/_lib/catalog.js`, `resolveTarget` (r. 156-164): semnează `p.bucket` / `p.pdfPath` luate din `ai_personal_items.payload`, pe care utilizatorul le scrie direct din browser (politica `pers_own_all`, `supabase/ai_tutor_v4.sql`; `src/lib/aiClient.js:427, 449, 488`).
  3. `api/ai-pdf-context.js`, `downloadLibraryPdf` (r. 392-400): același tipar, la extragerea textului.
- **Efect.** Citirea oricărui obiect din orice bucket, dacă i se știe drumul: PDF-urile Premium din `content-files` (drumurile sunt publice, în `content.file_url`) și PDF-urile private ale altor utilizatori din `personal-pdfs` (dacă drumul e cunoscut sau ghicit).
- **Ce confirmă Opus.** Recitește cele trei locuri și caută altele cu același tipar (`rg "payload\.bucket|\.pdfPath" api`). Scrie un test unitar cu Storage simulat. Nu exploata pe producție.
- **Direcția remedierii.** Un singur ajutor comun care acceptă doar bucketul `personal-pdfs` și doar drumuri care încep cu `<id-ul utilizatorului>/` (materiale personale) sau cu `public-library/` (materiale publicate); orice altceva e refuzat (R2.1).

#### PAY-01 · Deschiderea portalului de plăți al altui client (lanț DB-01 + DB-02)
- **Stare:** ✅ confirmat în cod; depinde de DB-01.
- **Ce am văzut.** `api/create-portal.js:25-38` deschide portalul Stripe pentru `profiles.stripe_customer_id` al apelantului, fără nicio altă verificare. Identificatorul poate fi schimbat de utilizator (DB-01), iar identificatorii celorlalți pot fi citiți (DB-02).
- **Efect.** Vizualizarea facturilor și a datelor de facturare ale altei persoane, anularea abonamentului ei, schimbarea metodei de plată.
- **Direcția remedierii.** Se închide odată cu DB-01. În plus, portalul verifică în Stripe că abonamentul sau clientul poartă `supabase_user_id` (ori `platit_de`) egal cu apelantul (R2.2).

### 4.3 P1 — majore

#### DB-03 · Fișierele Premium pot fi descărcate direct din Storage; politicile de scriere nu sunt în repo
- **Stare:** ✅ în SQL · 🟡 producție.
- **Ce am văzut.** Politica `"Authenticated users can download files"` (`supabase/schema.sql:114-119`: `bucket_id = 'content-files' AND auth.role() = 'authenticated'`) nu e ștearsă de niciun script ulterior. Drumurile fișierelor sunt publice (`content` are `SELECT … USING (true)`). Separat: panoul de administrare încarcă și șterge fișiere din browser (`src/pages/Admin.jsx:186, 287, 440`; `src/components/ContentAdminTools.jsx:243`), dar în repo singura politică de scriere este pentru rolul de serviciu — deci producția are politici de Storage create manual, cu conținut necunoscut.
- **Efect.** Un cont gratuit poate ocoli `get-file-url` și descărca orice material Premium. Dacă politicile manuale de scriere sunt de tipul „orice utilizator autentificat", oricine poate înlocui sau șterge materiale.
- **Ce confirmă Opus.** C1 pentru schema `storage`; testele T-STO-01 și T-STO-02.

#### DB-04 · Scorurile pot fi scrise direct din browser
- **Stare:** ✅ în SQL · 🟡 producție.
- **Ce am văzut.** Politicile de inserare și actualizare proprie pe `progress` (`supabase/progress_schema.sql`; `supabase/supabase_grants.sql:118-135`). Scriptul care le scoate, `progress_server_only.sql`, e marcat „OPȚIONAL", iar clientul păstrează un drum de rezervă care scrie direct când serverul nu răspunde (`src/pages/InteractiveViewer.jsx:281-332`).
- **Efect.** Un elev își poate pune orice scor; rezultatul apare la profesor și la părinte (`api/teacher-students.js` citește `progress`), în medii și în recomandări. Verificarea de pe server din `api/ai-score.js` devine ocolibilă.
- **Direcția remedierii.** Scoaterea politicilor de scriere și a drumului de rezervă din client, după ce `ai-score` acoperă toate cazurile (R1.4, legat de EDU-01).

#### DB-05 · Baza de date reală nu mai corespunde scripturilor din repo
- **Stare:** ✅ confirmat (o spune chiar repo-ul).
- **Ce am văzut.** `supabase/fix_schema_drift_columns.sql` notează că `profiles.is_admin`, `content.subcategory` și `content.profile` „au fost adăugate manual din dashboard". `DEBUG-RAPORT.md` (15 aug. 2026) lasă cinci pași manuali de rulat, fără nicio evidență că au fost rulați. Politicile de Storage folosite de panoul de administrare lipsesc din repo. Nu există jurnal de migrări.
- **Efect.** Nimeni nu poate spune, din cod, ce politici sunt active. Orice remediere scrisă „pe hârtie" poate rata starea reală.
- **Direcția remedierii.** Fotografia producției (A0), apoi un jurnal al scripturilor aplicate (R9.4).

#### API-02 · Rezolvările Premium stau într-un bucket public
- **Stare:** ✅ confirmat în cod (locul încărcării) · 🟡 de confirmat că în producție există rezolvări marcate Premium.
- **Ce am văzut.** Formularul „Adaugă Rezolvare" încarcă fișierul în bucketul **public** `discussions`, sub `rezolvari/…`, și salvează linkul public (`src/pages/Admin.jsx:745-750`). Tabela `rezolvari` poate fi citită de oricine, cu tot cu `file_url`. `api/rezolvare-url.js` cere abonament pentru rezolvările cu `is_free = false`, dar linkul public rămâne valabil și vizibil.
- **Efect.** Ocolirea abonamentului pentru rezolvările Premium.
- **Ce confirmă Opus.** O numărătoare a rândurilor din `rezolvari` cu `is_free = false` și cu `file_url` în bucketul `discussions`.

#### PAY-02 · Ștergerea contului nu anulează abonamentul
- **Stare:** ✅ confirmat în cod.
- **Ce am văzut.** `api/ai-account.js:29-43` arhivează rezultatele și șterge contul, fără niciun apel către Stripe. Conturile abonate sunt protejate de ștergerea pentru inactivitate (`api/_lib/inactivity.js:56`), dar nu și de ștergerea cerută de utilizator.
- **Efect.** Utilizatorul (sau părintele care plătește pentru copil) continuă să fie taxat pentru un cont care nu mai există și pe care nu-l mai poate administra.

#### PAY-03 · Abonamente duble sau restante care continuă să taxeze
- **Stare:** ✅ confirmat în cod; amploarea depinde de regulile de reîncercare din Stripe (❓).
- **Ce am văzut.** Abonarea e blocată doar dacă profilul este `active` (`api/create-checkout.js:258-260`). După o plată eșuată profilul devine `inactive` (`api/stripe-webhook.js:263-276`), dar abonamentul vechi rămâne în Stripe, în reîncercare. Utilizatorul se poate abona din nou, iar noul abonament se face intenționat pe **alt** client Stripe (`create-checkout.js:279-297`). Dacă o reîncercare a celui vechi reușește, omul plătește de două ori, iar abonamentul vechi nu mai apare în portalul lui. Același efect la două abonări pornite aproape simultan (două file, dublu clic).
- **Direcția remedierii.** Înainte de o abonare nouă, serverul caută în Stripe abonamentele neîncheiate ale contului și le închide sau refuză plata (R3.2).

#### PAY-04 · Webhookul poate confirma o plată fără să activeze contul
- **Stare:** ✅ confirmat în cod.
- **Ce am văzut.** La `checkout.session.completed`, actualizarea profilului nu verifică dacă a atins vreun rând (`api/stripe-webhook.js:191-202`): dacă profilul lipsește, webhookul răspunde 200, Stripe nu reîncearcă, iar administratorul primește doar e-mailul „Abonament NOU". Separat, o sesiune fără `supabase_user_id` primește 400 (r. 84-87): dacă pe același cont Stripe există și alte linkuri de plată (❓), livrările eșuate repetate pot duce la dezactivarea webhookului.

#### AI-01 · Limitele AI pot fi depășite prin cereri simultane
- **Stare:** ✅ confirmat în cod.
- **Ce am văzut.** Toate limitele numără rândurile deja scrise în `ai_usage`: `enforceRateLimit` (`api/_lib/ai.js:1188-1203`), `enforceFreeQuota` (1157-1172), `enforceBudgets` (1235-1271), `enforceFeatureQuota` (1307-1348). Rândul se scrie abia **după** ce modelul a răspuns (`logUsage`, 1454-1470; de exemplu `api/ai-chat.js` verifică la r. 57-59 și scrie la r. 103).
- **Efect.** Douăzeci de cereri trimise în aceeași secundă trec toate de verificare. Un cont gratuit depășește cele 2 acțiuni gratuite; un abonat depășește bugetul zilnic și lunar. Costul îl suportă platforma.
- **Direcția remedierii.** Rezervare atomică înaintea apelului: o funcție SQL care, sub blocaj pe utilizator, verifică limita și inserează rândul provizoriu (R4.1).

#### AI-02 · `mathjs` vulnerabil evaluează pe server text scris de utilizator
- **Stare:** ✅ confirmat (versiunea instalată: 14.9.1; avertisment de severitate ridicată în `npm audit` pentru 13.1.0–15.1.1).
- **Ce am văzut.** `api/_lib/mathcheck.js:17-22` creează instanța și dezactivează doar `import` și `createUnit`; `math.evaluate` primește răspunsurile elevilor și expresiile cerute de model (`mathcheck.js:378, 416, 423, 454-464, 569`; `api/_lib/tools.js:24-31`). Singura limită este lungimea (300 de caractere).
- **Efect.** Avertismentul descrie modificarea proprietăților obiectelor prin expresii. Independent de el, o expresie scurtă dar grea poate ține o funcție ocupată până la 800 de secunde (vezi API-03).
- **Direcția remedierii.** Actualizare la o versiune reparată (schimbare majoră, se rulează testele de corectare) și listă albă de funcții permise, cu limită de timp (R4.3).

#### SEC-01 · Dependențe cu vulnerabilități cunoscute
- **Stare:** ✅ `npm audit` rulat pe 14 nov. 2026: 24 de avertismente (10 ridicate, 10 moderate, 4 scăzute, niciunul critic).
- **Dependențe directe afectate:** `mathjs` (ridicat), `nodemailer` (ridicat), `sharp` (ridicat), `vite` (ridicat, doar la dezvoltare), `react-router-dom` (moderat: redirecționare deschisă), `satori` (moderat), `vite-plugin-pwa` (moderat), `katex` (scăzut). O parte se repară doar cu versiuni majore (mathjs 15.2, vite 8, katex 0.19, satori 0.63, vite-plugin-pwa 2.0) — necesită acordul proprietarului și teste. Detalii în Anexa D.

### 4.4 P2 — medii

| ID | Constatare | Dovada (ce am văzut) | Stare |
|---|---|---|---|
| DB-06 | Browserul poate scrie nelimitat în `ai_conversations`, `ai_messages`, `ai_personal_items`. Istoricul e redat modelului cu rolul din rând, deci utilizatorul își poate planta mesaje cu rol `system`. Baza se poate umfla. | politicile `conv_own`, `msg_own` (`ai_tutor_schema.sql`), `pers_own_all` (`ai_tutor_v4.sql`); `api/_lib/ai.js:2144-2160` și `prepareChat` | ✅ / 🟡 |
| DB-07 | Bucketul public `discussions`: orice cont poate încărca orice fișier, fără limită de tip sau mărime; conținutul poate fi listat de oricine. | `fix_discussions_storage.sql`, `fix_security_warnings.sql`; `Discussions.jsx:46-48, 148` (filtrul de tip e doar în interfață) | ✅ / 🟡 |
| DB-08 | Cheile de răspuns ale testelor interactive sunt publice (`content.interactive_data`, plus `var D=[…]` din fișierele HTML). Verificarea de pe server oprește scorurile inventate, nu și copiatul — contează la dueluri, turnee, ligă. | politica `content_select_public`; `api/_lib/score.js:25-38` | ✅ (decizie de produs) |
| DB-09 | Înregistrarea ca „părinte" prin e-mail nu salvează rolul: triggerul acceptă doar `elev` și `profesor`. Părintele — cel care plătește — e întrebat din nou ce tip de cont are. | `teacher_student_schema.sql` (`handle_new_user`); `Register.jsx:27-31, 197` | ✅ / 🟡 (C13) |
| API-03 | `maxDuration` 800 s pentru toate funcțiile; nu am verificat dacă apelurile externe au limită de timp. O funcție blocată costă până la 13 minute. | `vercel.json` → `functions` | ✅ / ❓ |
| PAY-05 | Webhookul ia starea abonamentului din evenimentul primit, fără protecție la evenimente întârziate sau repetate și fără registru de evenimente procesate. | `stripe-webhook.js:219-234` | ✅ |
| PAY-06 | Prima plată eșuată dezactivează imediat Premium, deși Stripe reîncearcă. E o decizie de produs care trebuie luată explicit (perioadă de grație sau nu). | `stripe-webhook.js:263-276` | ✅ |
| PAY-07 | Rambursările și contestațiile de plată nu sunt tratate: Premium, creditele AI și biletele rămân. Plățile asincrone nu sunt tratate (contează doar dacă sunt activate ❓). | lista de evenimente din `stripe-webhook.js:78-289` | ✅ |
| PAY-08 | La abonamentul plătit de părinte, contul copilului primește clientul Stripe al părintelui, deci copilul poate deschide portalul părintelui. Invers, dacă asocierea se rupe, părintele nu mai poate deschide portalul, deși plătește. | `stripe-webhook.js:186-194`; `create-portal.js:17-38`; `_lib/abonamentCopil.js:52-77` | ✅ |
| AI-03 | Mesajul, contextul și istoricul nu au limită de lungime. | `ai-chat.js:22-25`; `ai-chat-stream.js:31-34`; `ai.js:1954-1973` | ✅ |
| AI-04 | Textul exercițiului și baremul vin din browser și intră în instrucțiunile modelului ca sursă de adevăr: se pot injecta instrucțiuni și se poate folosi profesorul ca model general. Nu am verificat dacă baremul ajunge în browserul elevului (contează la testele pe grupă). | `ai.js:2175-2330` (`context.exerciseText`, `context.baremText`) | ✅ / ❓ |
| SEC-02 | Nu există antete de securitate (politică de conținut, interdicția de încadrare în alte site-uri, `nosniff`, politica de referință). | `vercel.json` → `headers` (doar cache) | ✅ / 🟡 |
| SEC-03 | Parolă minimă de 6 caractere; verificarea parolelor compromise e oprită; nu se știe dacă administratorul are autentificare în doi pași. | `ResetareParola.jsx:56`; notele din `fix_lints_*.sql` | ✅ / ❓ |
| SEC-04 | Suprafața XSS de trecut în revistă: conținutul articolelor inserat ca HTML (`ArticolPage.jsx:152`, `page-meta.js`), `manual_content` (`ContentPage.jsx:433`), tabla (`Whiteboard.jsx:214`, `live/Board.jsx:33`), HTML scris de utilizatori afișat în cadre izolate (`BibliotecaUtilizatorilor.jsx:120`, `AssignmentSolver.jsx:95`). Formatarea mesajelor din chat escapează corect, dar acceptă ca „link intern" și adrese de forma `//alt-site` (`AITutor.jsx:91-102`). | fișierele indicate | 🟡 |
| LEG-01 | Înregistrarea nu cere acceptarea termenilor și nici acordul părintelui pentru minori; e-mailurile autorilor sunt expuse în forum. **Necesită aviz juridic**, nu doar tehnic. | `Register.jsx` (nicio bifă); DB-02 | ✅ |
| SEO-01 | Orice adresă inexistentă răspunde cu 200 și pagina aplicației („404 moale"). | `vercel.json` (ultima regulă din `rewrites`); `NotFound.jsx` | ✅ |
| PERF-01 | Service worker-ul descarcă în fundal 101 fișiere, 3,15 MB, la prima vizită — inclusiv panoul de administrare (387 KB). După fiecare publicare, fișierele schimbate se descarcă din nou. | build-ul din Anexa D; `vite.config.js` → `workbox` | ✅ |
| PERF-02 | JavaScript inițial ≈570 KB (≈167 KB comprimat) și patru familii Google Fonts încărcate blocant. | Anexa D; `index.html` | ✅ |
| PERF-03 | Fiecare cerere AI face 3–5 interogări de numărare; cota pe funcție citește până la 5 000 de rânduri; panourile profesorului paginează până la 30 000 de rânduri. | `ai.js:1337-1339`; `http.js:206-215`; `teacher-students.js` | ✅ |
| COST-01 | Fiecare pagină văzută pornește o funcție și un `INSERT` (`vizita`), în paralel cu GA4 și Vercel Analytics. | `App.jsx` (`VizitaTracker`); `api/vizita.js` | ✅ |
| COST-02 | 18 cron-uri, ≈340 de invocări pe zi, fiecare cu până la 800 s. Nu am verificat dacă agenții și cron-urile au un plafon global de cost. | `vercel.json` → `crons`; `_lib/costwatch.js` necitit | ✅ / ❓ |
| EDU-01 | La materialele fără chei citibile (teste încărcate manual), serverul acceptă scorul trimis de browser. | `ai-score.js:40-52`; `score.js:116-137` | ✅ |
| EDU-02 | Regula de produs spune că testele interactive sunt gratuite, dar `ai-score` refuză salvarea scorului la materialele cu `is_free = false` pentru conturile fără abonament. De clarificat care e regula reală. | `ai-score.js:36-38`; descrierea din `index.html` promite „Teste interactive gratuite" | 🟡 |
| EDU-03 | Forumul nu are limitare de ritm și nici moderare automată: inserarea se face direct din browser. | politicile pe `discussions`; `Discussions.jsx:71-78` | ✅ |
| OPS-01 | Nu se știe să existe un mediu de test; scripturile SQL se aplică direct pe producție. | — | ❓ |

### 4.5 P3 — minore

| ID | Constatare | Dovada |
|---|---|---|
| DB-10 | Insignele pot fi auto-acordate din browser. | `gamification_schema.sql`; `src/lib/badges.js` |
| DB-11 | Politici duplicate pe aceeași tabelă și apeluri `auth.uid()` neîmpachetate (avertismentele de performanță ale Supabase). | Anexa A (`profiles`, `content`, `rezolvari`, `discussions`, `progress`) |
| API-04 | Mesajele interne de eroare ajung la client (`err.message`). | de ex. `create-checkout.js:302`, `get-file-url.js:62` |
| API-05 | Limitatoarele de pe endpoint-urile publice țin evidența în memoria instanței, deci sunt slabe pe serverless; formularul de contact nu are CAPTCHA și trimite confirmare la orice adresă. | `client-error.js:18-50`; `vizita.js:17`; `contact.js` |
| PAY-09 | Fiecare abonare creează un produs și un preț nou în Stripe dacă nu sunt setate `STRIPE_PRICE_*`; `README.md` descrie încă Netlify și doar trei evenimente de webhook. | `create-checkout.js:267-277`; `README.md` |
| AI-05 | Acțiunile gratuite se „refac": `ai_usage` e curățat la 90 de zile, iar cota gratuită numără toate rândurile. | `account-cleanup.js`; `ai.js:1157-1161` |
| AI-06 | Secretul de semnare cade, în lipsa variabilei, pe cheia de serviciu; tokenurile nu expiră implicit. | `ai.js:42, 1474-1494` |
| AI-07 | Prețurile modelelor și cursul valutar sunt scrise în cod; costul contabilizat poate devia de la factură. | `ai.js:106-159` |
| SEC-05 | CORS devine `*` dacă `SITE_ORIGIN` lipsește; cron-urile acceptă secretul și în adresă (`?secret=`), unde rămâne în jurnale. | `http.js:12, 76-77` |
| SEC-06 | Mesajele dintre pagină și cadrele cu teste nu verifică sursa; KaTeX are o rezervă încărcată de pe CDN fără verificare de integritate. | `InteractiveViewer.jsx:360, 516`; `katex.js:13-36` |
| FE-01 | Fișiere foarte mari (`Meditatii.jsx` 2 328 de rânduri, `AITutor.jsx` 2 079, `PDFViewer.jsx` 1 521, `global.css` 2 280), fără TypeScript și fără lint — erorile de tip se văd doar la rulare. | numărătoarea din cartografiere |
| FE-02 | Avertisment la build: `aiClient.js` e importat și dinamic, și static, deci împărțirea nu are efect. | Anexa D |
| FE-03 | `README.md` este învechit (Netlify, vechiul model de acces). | `README.md` |
| SEO-02 | Rutele care nu trec prin `page-meta` declară pagina principală drept adresă canonică. | `index.html` (`<link rel="canonical">`) |
| SEO-03 | Materialele individuale nu pot fi indexate (`/exercitiu`, `/pdf-viewer` sunt excluse) — oportunitate, nu eroare. | `public/robots.txt` |
| SEO-04 | Sitemap-ul nu are `lastmod` pe rutele statice și include pagini cu conținut subțire (`/tema`, `/discutii`). | `api/sitemap.js` |
| COST-03 | Imagini PWA mari (177 KB, 157 KB); folderul `Claude outputs/` (31 MB, 22 de fișiere) este urmărit în git. | `public/`; `git ls-files` |
| OPS-02 | Fișiere `.lock` vechi în `.git/` și arhive în `_to_delete/`, rămase de la sesiuni anterioare. | conținutul `.git/` |

### 4.6 Zone neverificate (❓) — nu sunt nici probleme, nici zone curate

| ID | Ce nu am verificat | Întrebarea la care răspunde Opus |
|---|---|---|
| DB-12 | Indexuri, interogări lente, mărimea tabelelor | Ce spun consilierii Supabase de securitate și de performanță? Ce chei străine nu au index? |
| API-06 | Funcțiile necitite (lista din §2.3) | `ai-ingest` și `ai-notify` nu folosesc `requireAdmin` — au o verificare proprie? `newsletter` acceptă GET — cu ce protecție? `ai-pdf-context` trimite baremul în browser și poate porni extrageri costisitoare fără limită? |
| PAY-10 | Configurarea din Stripe Dashboard | Ce evenimente sunt abonate, ce reguli de reîncercare, ce metode de plată, există alte linkuri de plată pe cont? |
| AI-08 | RAG și plafonul global de cost | Un cont gratuit poate primi fragmente Premium prin sursele RAG? Indexul e la zi? Există un întrerupător general pentru costul agenților? |
| SEC-07 | Secrete în istoricul git | Există chei în commit-uri vechi, în `.env.ai.example` sau în `android-twa/`? |
| FE-04 | Site-ul live | Erori în consolă, afișare pe telefon și tabletă, butoane fără efect, formulare. |
| SEO-05 | SEO pe live | Ce primește efectiv un crawler pe fiecare rută, ce raportează Search Console, valorile Core Web Vitals. |
| EDU-04 | Gamificare, teme, test pe grupă, mesagerie | Punctele, ligile, duelurile și turneele pot fi influențate din browser? Modul de test oprește toate ajutoarele AI? Mesageria verifică apartenența la conversație? |

---

## 5. Lista componentelor de auditat

Pentru fiecare domeniu: ce intră în verificare, unde se află și la ce întrebări trebuie să răspundă Opus. Coloana „deja făcut" există ca să nu se repete munca.

### 5.1 Supabase și RLS

| | |
|---|---|
| **Intră în verificare** | Toate tabelele din schema `public` (Anexa A), bucketurile și politicile de Storage, politicile Realtime, funcțiile SQL, triggerele, setările de autentificare. |
| **Unde** | `supabase/*.sql` (104 fișiere) și **starea reală din producție** (Anexa C). |
| **Deja făcut** | Harta politicilor și a privilegiilor, reconstruită din scripturi în ordinea în care au intrat în repo (Anexa A). |

Întrebări, pentru **fiecare tabelă**:
1. Cine o poate citi și scrie pe calea A (rolurile `anon` și `authenticated`)? Corespunde cu ce face efectiv `src/`?
2. Are coloane pe care serverul le folosește ca să decidă drepturi sau bani? Pot fi scrise din browser?
3. Politicile de actualizare au și `WITH CHECK`? Există politici duplicate sau permisive rămase din versiuni vechi?
4. Ștergerea unui utilizator curăță sau păstrează corect rândurile (lanțurile `ON DELETE`)?
5. Starea din producție coincide cu harta din repo? Orice diferență se notează ca abatere (DB-05).

Separat: funcțiile `SECURITY DEFINER` apelabile din browser (C6), politicile de Storage pe fiecare bucket (C1, C7), indexurile și mărimea tabelelor (C9), consilierii de securitate și de performanță din dashboard.

### 5.2 Stripe și abonamente Premium

| | |
|---|---|
| **Intră în verificare** | Abonarea (lunar, anual, plătită de părinte), plățile unice (pachete AI, bilete live), portalul, webhookul, sincronizarea cu `profiles`, ștergerea contului. |
| **Unde** | `api/create-checkout.js`, `api/create-portal.js`, `api/stripe-webhook.js`, `api/_lib/abonamentCopil.js`, `api/_lib/live.js` și `liveAccess.js` (prețuri, bilete), `api/_lib/ai.js` (`topupPacks`), `api/ai-account.js`; `src/pages/Pricing.jsx`, `src/pages/Profile.jsx` (așteptarea de după plată, în jurul r. 436-444), `src/components/AILimite.jsx`; testele `plati-factura`, `abonament-copil`, `limite-topup`, `credite-ciclu`. |
| **Deja făcut** | Cele trei funcții de plată citite integral; constatările PAY-01…PAY-09. |

Opus construiește **tabelul stărilor**: pentru fiecare eveniment Stripe și fiecare stare a abonamentului (`incomplete`, `active`, `past_due`, `unpaid`, `canceled`, `incomplete_expired`, anulare la sfârșitul perioadei), ce scrie webhookul în `profiles` și ce vede utilizatorul. Cele două întrebări ale proprietarului se verifică pe acest tabel: *poate cineva plăti fără să primească Premium?* și *poate cineva păstra Premium după anulare?* Lista scenariilor este în §7.5 (T-PAY).

### 5.3 Backend și API

| | |
|---|---|
| **Intră în verificare** | Cele 66 de rute (Anexa B) și modulele comune din `api/_lib/`. |
| **Deja făcut** | Matricea de pază; aproximativ 30 de rute citite integral sau parțial (§2.3). |

Pentru **fiecare rută** necitită, aceeași fișă:
1. Metoda acceptată și autentificarea (`authUser`, `requireAdmin`, `isCronRequest`).
2. **Verificarea pe obiect**: orice identificator primit de la client (`studentId`, `groupId`, `conversationId`, `sessionId`, `id`) este verificat că aparține apelantului?
3. Validarea intrărilor: tip, lungime maximă, valori permise.
4. Se bazează pe date pe care browserul le poate scrie direct (calea A)?
5. Tipare „verifică, apoi acționează" care cedează la cereri simultane (bilete, dueluri, înscrieri, limite).
6. Limite de timp pe apelurile externe; ce se întâmplă la eroare; ce ajunge în răspuns.
7. Pentru cron-uri: ce se întâmplă dacă rulează de două ori sau în paralel.

Ordinea recomandată: întâi rutele care ating bani sau date ale altora (`live`, `homework`, `group-assignment`, `messages`, `colegi`, `ai-assignment`, `ai-public`, `ai-pdf-context`), apoi cele AI, apoi cele de administrare și cron.

### 5.4 Profesorul Virtual și sistemele AI/RAG

| | |
|---|---|
| **Intră în verificare** | Chatul (cu și fără flux), foto-rezolvarea, corectarea, generarea de teste, meditațiile, sălile live, RAG, bugetele și cotele, agenții de administrare. |
| **Unde** | `api/_lib/ai.js` (2 529 de rânduri), `claude.js`, `exgen.js`, `tools.js`, `mathcheck.js`, `pregen.js`, `ingest.js`, `corector.js`, `verify.js`, `costwatch.js`, `tts.js`; rutele `ai-*`, `live`, `rezolva-pdf`, `fise`; `src/lib/aiClient.js`, `src/components/AITutor.jsx`; `eval/` (setul de evaluare); ghidul `GHID_LIMITE_AI.md`. |
| **Deja făcut** | Accesul, limitele, bugetele, pregătirea conversației și cei doi agenți de chat din `ai.js`; constatările AI-01…AI-07. |

Întrebări:
1. Cheile AI există doar pe server? (`rg -n "API_KEY|sk-" src` trebuie să nu găsească nimic.)
2. Fiecare rută care apelează un model trece prin toate limitele, în aceeași ordine? În matricea din Anexa B, `ai-pdf-context` și `ai-teacher` nu cheamă funcțiile de limitare — de verificat dacă pornesc, direct sau prin module, apeluri plătite. La `live`, vocea trece doar prin limita orară (`budgets: false`, în jurul r. 2814) — de verificat costul ei.
3. Un cont gratuit poate primi conținut Premium prin sursele RAG, prin răspunsurile pregenerate sau prin paginile de PDF atașate?
4. Ce se întâmplă când furnizorul nu răspunde sau taie răspunsul (limită de 900 de tokeni la chat)?
5. Conversațiile sunt ale utilizatorului la fiecare citire și scriere? (`openConversation` verifică; restul rutelor?)
6. Cât costă, măsurat din `ai_usage`, fiecare funcție și fiecare model? (Vezi §5.10.)

### 5.5 Securitate (transversal)

Verificarea urmează OWASP Top 10, tradus în verificări concrete pentru acest cod:

| Risc OWASP | Unde se verifică aici |
|---|---|
| Control al accesului | Calea A (Anexa A) și verificarea pe obiect din fiecare rută (§5.3); DB-01…04, API-01, PAY-01 |
| Eșecuri criptografice | Secretul de semnare (AI-06), tokenurile fără expirare, semnătura webhookului, HMAC-ul imaginilor sociale |
| Injecție | SQL: clientul Supabase parametrizează, dar se verifică filtrele construite din text (`.or(...)`, `.ilike(...)` cu intrare de la utilizator) și funcțiile SQL cu `EXECUTE`; injecție de instrucțiuni în modele (AI-04); `mathjs` (AI-02) |
| Proiectare nesigură | Datele de autorizare ținute într-o tabelă pe care o scrie clientul (DB-01); context AI de încredere venit din browser |
| Configurare greșită | Antete (SEC-02), CORS (SEC-05), bucketuri publice (DB-07, API-02), `maxDuration` (API-03) |
| Componente vulnerabile | SEC-01 și Anexa D |
| Autentificare | Politica de parole, confirmarea e-mailului, autentificarea în doi pași pentru administrator (SEC-03) |
| Integritatea datelor și a codului | Agentul de debug care deschide și publică pull request-uri; scripturi încărcate de pe CDN (SEC-06) |
| Jurnalizare și monitorizare | Ce se înregistrează la acțiunile de administrator și la plăți; alertele existente (e-mailurile webhookului, `costwatch`) |
| Cereri către alte servere (SSRF) | `exam-bot` și modulele `examBot*` descarcă pagini și fișiere din afară: din ce domenii au voie? |

XSS se verifică pe lista de locuri din SEC-04; CSRF are risc scăzut, pentru că autentificarea se face cu token în antet, nu cu cookie — de confirmat că nicio rută nu se bazează pe cookie-uri.

### 5.6 Frontend și React

| | |
|---|---|
| **Intră în verificare** | Cele 44 de rute, protecția paginilor pe tip de cont, formularele, vizualizatoarele (PDF, test interactiv), actualizarea aplicației instalate, afișarea pe telefon, tabletă și desktop. |
| **Unde** | `src/App.jsx`, `src/context/AuthContext.jsx`, `src/pages/`, `src/components/`, `src/lib/`. |
| **Deja făcut** | Rutarea, autentificarea, locurile unde se inserează HTML, salvarea scorului. |

Întrebări: fiecare pagină privată se comportă corect fără cont și cu un cont de alt tip? Ce pagini nu au limită de eroare proprie? Ce butoane nu fac nimic (de exemplu elementele cu `disabled={!url}` din `ProtectedContent.jsx`)? Ce erori reale au vizitatorii (tabela `client_errors` și agentul de debug din Admin le adună deja)? Ce re-randări inutile apar în componentele foarte mari (`AITutor`, `Meditatii`, `PDFViewer`)? Proiectul nu are TypeScript, deci „erorile TypeScript" din cerința inițială nu se aplică; în lipsa unui lint, verificarea statică se limitează la avertismentele build-ului.

### 5.7 SEO

**Cinci liste trebuie să spună același lucru** — asta e verificarea de bază:

1. rutele din `src/App.jsx`;
2. rutele trimise la `page-meta` în `vercel.json` → `rewrites`;
3. textele din `api/_lib/seoRute.json`;
4. rutele din `api/sitemap.js`;
5. excluderile din `public/robots.txt`.

O rută publică prezentă în (1), dar absentă din (2) primește titlul și adresa canonică ale paginii principale (SEO-02). Apoi, pe site-ul live: codul de stare, titlul, descrierea, adresa canonică, datele structurate și imaginea de partajare pentru fiecare rută publică; codul 404 pentru adrese inexistente (SEO-01); validitatea sitemap-ului; raportul de acoperire din Search Console (îl furnizează proprietarul).

### 5.8 Performanță

Ce se măsoară: Core Web Vitals pe mobil pentru `/`, `/evaluare-nationala`, `/bacalaureat`, `/preturi`, `/profesor-virtual`; mărimea JavaScript-ului inițial; ce descarcă service worker-ul; fonturile; imaginile; câte cereri către Supabase și către `/api` face fiecare pagină la deschidere; interogările repetate la intervale (de verificat, de exemplu, `src/lib/chatUnread.js` și `src/lib/arena.js`). Valorile de plecare sunt în Anexa D.

### 5.9 Funcționalități educaționale

Se verifică **pe roluri**, cap-coadă: vizitator → elev gratuit → elev abonat → profesor → părinte → administrator. Pentru fiecare rol: ce materiale deschide, ce i se salvează, ce vede despre alții. Punctele sensibile: integritatea scorurilor (DB-04, EDU-01), regula gratuit/Premium (EDU-02), modul de test pe grupă, asocierea profesor–elev și părinte–copil, clasamentele și premiile, forumul.

### 5.10 Optimizarea costurilor

| Sursă de cost | Ce o determină | De unde se iau cifrele |
|---|---|---|
| Modele AI | funcția, modelul, numărul de tokeni; cron-urile de generare | `ai_usage` (vederea `ai_usage_daily`, funcțiile `ai_cost_breakdown` și `ai_top_users` există deja), factura furnizorului |
| Vercel | numărul și durata invocărilor (≈340 pe zi doar din cron-uri, plus `vizita` la fiecare pagină), traficul de date (3,15 MB descărcați de service worker la prima vizită) | panoul de utilizare Vercel |
| Supabase | mărimea bazei (`ai_messages`, `page_views`, `ai_usage`), Storage (fișierele audio ale lecțiilor live, PDF-uri), traficul | panoul de utilizare Supabase, C9 |
| Stripe | comisioane, 0,4 % pe factură la plățile unice (notat în cod) | rapoartele Stripe |
| E-mail | limita zilnică Gmail | — |

Opus nu optimizează „la ochi": întâi strânge cifrele de mai sus pe 30 de zile, apoi propune măsuri ordonate după economie (§9, etapa R9).

---

## 6. Ordinea verificărilor

Zece etape de audit. Fiecare se încheie cu un livrabil și cu un criteriu de acceptare; fără el nu se trece mai departe. **Etapele A0 și A1 sunt urgente**: dacă A1 confirmă un P0, remedierea lui (R1, R2) pornește imediat, fără să aștepte A2–A9.

| Etapă | Ce se face | Livrabil | Criteriu de acceptare |
|---|---|---|---|
| **A0 — Pregătire și fotografia producției** | Creează `PROGRESS_AUDIT.md`. Rulează testele și build-ul pe o copie (valori de referință). Proprietarul rulează interogările din Anexa C și exportă rapoartele consilierilor Supabase. Se notează **numele** variabilelor de mediu din Vercel (fără valori) și configurarea Stripe. Proprietarul răspunde la deciziile din §12. | `AUDIT_TEHNIC/stare_db/` (rezultatele C1–C14), lista variabilelor, fișa Stripe | Toate interogările C au rezultat salvat. Fiecare necunoscută din §3.6 are un răspuns sau e marcată „rămâne necunoscută, din motivul X". Testele de referință trec. |
| **A1 — Confirmarea P0 și P1** | Pentru cele 14 constatări: compară cu fotografia din A0 și recitește codul indicat. | Verdict pe fiecare: confirmat / infirmat / parțial, cu dovada | Niciun P0 sau P1 nu rămâne „de confirmat". Proprietarul e anunțat în aceeași zi despre fiecare P0 confirmat. |
| **A2 — Supabase și RLS** | Fișa din §5.1 pentru fiecare tabelă și bucket; abaterile dintre repo și producție. | Anexa A actualizată cu starea reală; lista abaterilor | Fiecare tabelă are completate cele cinci întrebări. Nicio tabelă scrisă din browser nu are coloane de autorizare neprotejate fără o constatare deschisă. |
| **A3 — Stripe** | Tabelul stărilor (§5.2); scenariile T-PAY pe chei de test. | Tabelul stărilor; rezultatele scenariilor | Cele două întrebări ale proprietarului au răspuns cu dovadă pentru fiecare scenariu. |
| **A4 — Backend și API** | Fișa din §5.3 pentru rutele necitite. | Anexa B completată cu verdict pe rută | Toate cele 66 de rute au fișă. Zona API-06 e închisă. |
| **A5 — AI și RAG** | Întrebările din §5.4; costul pe funcție din `ai_usage`. | Lista rutelor AI cu limitele aplicate; tabelul costurilor | Fiecare rută care apelează un model are notate limitele prin care trece. Zona AI-08 e închisă. |
| **A6 — Funcționalități educaționale** | Parcurgerea pe roluri (§5.9); scenariile T-EDU. | Matricea rol × funcție | Fiecare funcție e marcată „merge / defectă / neimplementată", cu dovadă. Zona EDU-04 e închisă. |
| **A7 — Frontend** | Parcurgerea rutelor pe trei lățimi de ecran; erorile din consolă; `client_errors`. | Lista defectelor de interfață | Fiecare rută publică și fiecare pagină de cont a fost deschisă pe telefon și pe desktop. Zona FE-04 e închisă. |
| **A8 — SEO și performanță** | Cele cinci liste (§5.7); verificarea pe live; măsurătorile (§5.8). | Tabelul rutelor publice; valorile Core Web Vitals | Fiecare rută publică are stare, titlu, adresă canonică și date structurate verificate. Zona SEO-05 e închisă. |
| **A9 — Costuri și sinteză** | Cifrele din §5.10; scrierea celor 7 documente (§8). | `01`…`07` în `AUDIT_TEHNIC/` | Fiecare constatare are cele 11 câmpuri. Totalurile din `01` coincid cu lista din `02`. `07` poate fi executat fără acest plan alături. |

---

## 7. Metodologia de verificare și testare

### 7.1 Niveluri de dovadă

Fiecare constatare își declară nivelul. Un P0 sau un P1 cere cel puțin nivelul 1 și unul dintre nivelurile 3–5.

| Nivel | Dovadă | Exemplu |
|---|---|---|
| 1 | Citat din cod: fișier, rânduri, commit | `api/create-portal.js:25-38` la `02ab37a` |
| 2 | Rezultat static reproductibil: o căutare, o numărătoare | `rg -n "payload\.bucket" api` |
| 3 | Test automat care reproduce problema (pică înainte, trece după) | un fișier nou în `test/` |
| 4 | Observație pe producție, doar citire | rezultatul C1; antetele unui răspuns |
| 5 | Probă controlată cu un cont de test | un cont gratuit încearcă să-și schimbe abonamentul |

„Pare", „probabil" și „ar trebui" nu sunt dovezi: constatarea rămâne 🟡 până are nivelul cerut.

### 7.2 Reguli pe producție

**Permis fără întrebare:** citirea paginilor publice; interogările `SELECT` din Anexa C, rulate de proprietar; cererile `HEAD` sau `GET` pe rute publice.

**Permis numai cu acordul explicit al proprietarului, dat pentru fiecare probă:** orice scriere, chiar și pe un cont de test (de exemplu proba de nivel 5 pentru DB-01: contul de test își schimbă propriul rând, iar valoarea se pune imediat la loc); cereri simultane către rutele AI (au cost); citirea cu cheia publică a tabelelor cu date personale, și atunci doar numărători.

**Interzis:** orice operație care atinge datele altui utilizator real; `DELETE`, `UPDATE`, `ALTER`, `DROP` în afara etapelor de remediere aprobate; trimiterea de e-mailuri sau notificări către utilizatori reali; plăți cu carduri reale; încărcarea de fișiere în bucketurile de producție; scanări automate sau teste de încărcare; exploatarea efectivă a unei vulnerabilități atunci când citirea politicilor ajunge ca dovadă.

### 7.3 Conturi și mediu de test

De preferat, un mediu separat: al doilea proiect Supabase, construit din scripturile din repo plus abaterile găsite în A0; cheile Stripe de test; un deploy de previzualizare Vercel legat de ele. Dacă proprietarul nu vrea un mediu separat (decizia D1), testele de nivel 5 se fac pe producție, cu patru conturi create de el — elev gratuit, elev abonat, profesor, părinte — și cu regulile din §7.2.

### 7.4 Unelte

Fără pachete noi: `rg` pentru căutări, `node --test test/*.test.js` (≈80 s), `npx vite build` (≈20 s), `npm audit`, `curl`, consola Supabase (SQL Editor și consilierii), panourile Vercel și Stripe, instrumentele pentru dezvoltatori din browser (inclusiv Lighthouse). Pentru Stripe: Stripe CLI (`stripe listen`, `stripe trigger`) și ceasurile de test — le instalează și le pornește proprietarul.

### 7.5 Catalogul de teste

Rezultatul așteptat este cel **de după remediere**. Înainte de remediere, același test documentează problema.

| ID | Pași | Rezultat așteptat |
|---|---|---|
| T-RLS-01 | Cont gratuit: `update profiles set subscription_status='active'` pe rândul propriu | Refuzat; valoarea rămâne `inactive` |
| T-RLS-02 | La fel pentru `is_admin`, `stripe_customer_id`, `subscription_id` | Refuzat pentru fiecare |
| T-RLS-03 | Cont autentificat, apoi vizitator: citește un profil care nu e al lui | Niciun rând |
| T-RLS-04 | Schimbă numele, numele de utilizator, rolul, notificările; generează cod de profesor; deschide site-ul (semnalul de activitate) | Toate merg ca înainte |
| T-RLS-05 | Forumul, citit de un vizitator și de un cont | Numele autorilor apar; niciun e-mail în răspunsurile din rețea |
| T-RLS-06 | Cont de elev: `upsert` direct în `progress` | Refuzat; scorul trimis prin `ai-score` se salvează |
| T-STO-01 | Cont gratuit: descarcă sau semnează direct un fișier Premium din `content-files` | Refuzat |
| T-STO-02 | Cont obișnuit: încarcă sau șterge în `content-files`; administratorul face la fel din panou | Refuzat pentru contul obișnuit; reușit pentru administrator |
| T-STO-03 | Încarcă în `discussions` un fișier `.html` și unul peste limită | Refuzate; o imagine și un PDF mic reușesc |
| T-API-01 | `ai-public` → `publish` cu `bucket: 'content-files'` sau cu un drum din folderul altui utilizator | 400 sau 403; publicarea legitimă merge |
| T-API-02 | Material personal cu drum străin, trimis ca temă și deschis de elev | Niciun link; tema legitimă se deschide |
| T-PAY-01 | Abonare lunară; abonare anuală (chei de test) | Premium activ în mai puțin de un minut; factura emisă |
| T-PAY-02 | Părintele plătește pentru copil | Premium pe contul copilului; portalul părintelui merge; copilul nu vede portalul părintelui |
| T-PAY-03 | Reînnoire eșuată, apoi plată reușită la reîncercare (ceas de test) | Starea urmează regula aleasă la decizia D4; după plata reușită, Premium activ |
| T-PAY-04 | Anulare la sfârșitul perioadei; anulare imediată | Premium până la capătul perioadei, respectiv oprit imediat |
| T-PAY-05 | A doua abonare cât prima e activă sau restantă; două abonări pornite simultan | Un singur abonament plătitor per cont |
| T-PAY-06 | Același eveniment trimis de două ori; evenimente în ordine inversă | Starea finală e cea corectă; nicio alertă dublă |
| T-PAY-07 | Sesiune fără `supabase_user_id`; sesiune pentru un profil inexistent | 200 și ignorată, respectiv 500 și alertă către administrator |
| T-PAY-08 | Ștergerea contului cu abonament activ (propriu și plătit de părinte) | Abonamentul e anulat în Stripe înaintea ștergerii |
| T-PAY-09 | Pachet AI și bilet live: plată, eveniment repetat, rambursare | Creditat o singură dată; rambursarea tratată după regula aleasă |
| T-AI-01 | Cont gratuit cu 2 acțiuni rămase: 20 de cereri de chat simultane | Cel mult 2 primesc răspuns de la model |
| T-AI-02 | Abonat aproape de bugetul zilnic: 20 de cereri simultane | Depășirea rămâne sub costul unei singure cereri |
| T-AI-03 | Mesaj de 200 000 de caractere; context supradimensionat | 413, fără apel la model |
| T-AI-04 | Expresii grele sau ostile trimise ca răspuns la un exercițiu | Refuzate în sub o secundă; fără efecte asupra cererilor următoare |
| T-AI-05 | Cont gratuit întreabă despre un material Premium | Nici răspunsul, nici sursele nu conțin text Premium |
| T-AI-06 | În timpul unui test pe grupă: chat, foto-rezolvare și celelalte ajutoare AI | Toate oprite, mai puțin corectarea prevăzută |
| T-SEC-01 | Antetele paginii principale și ale unei rute `/api` | Antetele din SEC-02 prezente; CORS limitat la domeniul site-ului |
| T-SEC-02 | Text cu marcaj HTML și cu `javascript:` în: postare pe forum, numele fișierului atașat, recenzie, titlul unui material publicat, numele din profil, mesaj în chat | Afișat ca text, în toate locurile unde apare (inclusiv panoul profesorului și e-mailuri) |
| T-SEC-03 | Mesaj cu `[text](//alt-site.example)` în chat | Nu devine link intern |
| T-EDU-01 | Elev gratuit rezolvă un test interactiv gratuit și unul marcat Premium | Comportamentul corespunde regulii alese (EDU-02) |
| T-EDU-02 | Profesor: creează grupă → elevul se asociază cu codul → temă → elevul rezolvă → rezultatul apare la profesor | Tot lanțul merge; un alt profesor nu vede nimic |
| T-EDU-03 | Părinte: invitație de la copil → asociere → vede rezultatele | Merge; un părinte neasociat primește 403 |
| T-EDU-04 | Duel, turneu, ligă: scor trimis fără răspunsuri sau cu răspunsuri inventate | Nu se acordă puncte |
| T-SEO-01 | Fiecare rută publică, cerută ca un crawler | 200, titlu și descriere proprii, adresă canonică proprie, date structurate valide |
| T-SEO-02 | O adresă inexistentă | 404 și `noindex` |
| T-SEO-03 | `sitemap.xml` și `robots.txt` | XML valid; fiecare adresă din sitemap răspunde 200 și e indexabilă |
| T-PERF-01 | Lighthouse pe mobil, pe cele cinci pagini din §5.8 | LCP sub 2,5 s, CLS sub 0,1, INP sub 200 ms (sau valorile de plecare și ținta agreată) |
| T-PERF-02 | Prima vizită, cu rețeaua urmărită | Service worker-ul descarcă sub ținta agreată; panoul de administrare nu e descărcat de vizitatori |

### 7.6 Regresie

Înainte și după fiecare modificare: `npm test` (referință: 1 271 de teste, 1 269 trec, 2 sărite, niciunul picat) și `npm run build`. Fiecare remediere adaugă cel puțin un test în `test/`, în stilul celor existente (`node:test`). După fiecare etapă de remediere se parcurge manual lista scurtă: autentificare cu e-mail și cu Google, deschiderea unui PDF și a unui test interactiv, salvarea unui scor, o întrebare către Profesorul Virtual, pagina de prețuri până la Stripe, panoul profesorului, forumul, panoul de administrare.

---

## 8. Cum se documentează erorile și remedierile

### 8.1 Fișa unei constatări

Cele 11 câmpuri cerute de proprietar, plus starea și nivelul de dovadă. Aceeași formă în toate documentele:

```markdown
### <ID> · <titlu scurt, la obiect>
- **Categoria:** Supabase/RLS | Stripe | Backend/API | AI | Securitate | Frontend | SEO | Performanță | Costuri | Educațional | Operare
- **Prioritatea:** P0 | P1 | P2 | P3
- **Starea:** confirmată | infirmată | parțial confirmată | neverificată (și de ce)
- **Descrierea problemei:** ce se întâmplă, în cuvinte simple
- **Dovada tehnică:** nivelul (1–5), fișier:rânduri la commitul X, rezultatul interogării sau al testului
- **Fișierele afectate:** lista
- **Cauza:** confirmată sau probabilă (spune care)
- **Efectul asupra utilizatorilor:** cine e afectat și cum
- **Soluția recomandată:** modificarea propusă, cu ordinea pașilor
- **Riscul implementării:** ce se poate strica și cum se previne
- **Testul de după remediere:** ID-ul din catalog (T-…) sau pașii exacți
```

Reguli: o constatare = o singură cauză (două cauze, două fișe); niciun câmp gol — dacă nu se știe, se scrie „necunoscut" și motivul; fără secrete și fără date personale (nici e-mailuri de utilizatori, nici identificatori Stripe reali) în niciun document.

### 8.2 Jurnalul remedierilor

Un fișier, `AUDIT_TEHNIC/JURNAL_REMEDIERI.md`, cu o intrare adăugată la fiecare sarcină încheiată:

```markdown
## R1.1 · profiles: listă albă de coloane   (închide DB-01, PAY-01)
- Data / cine: 2026-11-__ · Opus 5.5 (cod), proprietar (SQL)
- Ramura și commitul: fix/R1-rls · <hash>
- Fișiere modificate: supabase/audit_R1_1_profiles_coloane.sql (nou)
- SQL aplicat în producție: da — <data, ora>; rezultatul verificării C4 atașat în stare_db/
- Teste: npm test (toate trec; numărul lor) · T-RLS-01, 02, 04 trec
- Cum se revine: secțiunea ROLLBACK din același fișier SQL
- Observații: —
```

Pe lângă jurnal, fiecare remediere publicată primește o intrare în `CHANGELOG-REPARATII.md`, după convenția deja folosită în proiect (fișierul are 496 KB: se adaugă la el, nu se citește integral).

### 8.3 Cele 7 documente finale și de unde se alimentează

| Document | Conținut | Surse din acest plan |
|---|---|---|
| `01_RAPORT_GENERAL.md` | Situația generală, arhitectura, totalurile, evaluarea calității codului | §1, §3, rezultatele A0–A9 |
| `02_ERORI_SI_BUGURI.md` | Toate constatările, cu fișa din §8.1, ordonate P0 → P3 | §4, confirmat și completat |
| `03_SECURITATE.md` | Vulnerabilitățile, pe tabelul OWASP din §5.5 | DB-, API-, PAY-01, AI-02, SEC-, LEG- |
| `04_PERFORMANTA_SEO.md` | Performanță, SEO, interfață, costuri | PERF-, SEO-, FE-, COST-, Anexa D |
| `05_PLAN_IMPLEMENTARE.md` | Ordinea exactă, dependențele, fișierele, testele, riscurile | §9, actualizat cu ce s-a confirmat |
| `06_CHECKLIST_TESTARE.md` | Lista de verificare pe funcționalități, cu criterii | §7.5, §7.6, criteriile din §9 |
| `07_HANDOFF_OPUS.md` | Sarcinile de implementare: ID, prioritate, fișiere, modificări exacte, dependențe, criterii de acceptare, teste, puncte de verificare | §9 și §10 |

### 8.4 `PROGRESS_AUDIT.md`

Creat de Opus în prima sesiune și **actualizat la sfârșitul fiecărei etape și înainte de a încheia orice sesiune**. Cinci rubrici fixe: ultima etapă finalizată; ultimul fișier analizat; problemele identificate (doar ID-urile și starea — detaliile stau în `02`); ce urmează; documentele finalizate și cele incomplete. Scopul lui este reluarea exactă după o întrerupere, fără recitirea codului.

---

## 9. Planul de remediere — etape independente, cu puncte de control Git

### 9.1 Reguli comune

1. **Nimic nu se remediază înainte ca etapa A1 să confirme constatarea și proprietarul să aprobe etapa.** Fără excepții.
2. **Punct de plecare:** eticheta `audit-baza-2026-11-14` pe commitul `02ab37a` (sau pe `main`-ul din ziua începerii, notat în jurnal).
3. **O ramură pe etapă** (`fix/R1-rls`, `fix/R2-storage-ref`…), commit-uri mici, câte unul pe sarcină, cu mesajul `[R1.1][DB-01] descriere scurtă`. Pull request către `main` → fluxul „Verificare" trece → îmbinare → etichetă `audit-R1`.
4. **Scripturile SQL** sunt fișiere noi în `supabase/`, numite `audit_R<etapă>_<nr>_<subiect>.sql`, în stilul celor existente: antet care spune ce face, de ce, cum se verifică; idempotente; cu o secțiune `ROLLBACK` comentată. Le aplică **proprietarul**, în SQL Editor; data aplicării se trece în jurnal. Pentru orice tabelă nouă se respectă regula din `CLAUDE.md` (RLS activat și GRANT-uri în același fișier).
5. **Ordinea cod ↔ SQL** este scrisă la fiecare sarcină și se respectă: uneori codul trebuie publicat întâi, alteori SQL-ul.
6. **Fiecare etapă se poate publica și retrage singură.** Dependențele sunt cele din §9.12; restul etapelor nu se așteaptă una pe alta.
7. **Fără „înfrumusețări":** nu se rescriu componente și nu se schimbă comportamentul în afara constatării remediate (regula proprietarului).
8. **Git în acest mediu de lucru:** în sesiunile cu folderul conectat de pe calculator, ștergerea fișierelor este oprită implicit, iar `git commit`, `checkout` și `merge` lasă fișiere `.lock` în `.git/` (există deja câteva, de la sesiuni mai vechi). Fie proprietarul face commit-urile și etichetele din GitHub Desktop la fiecare punct de control, fie Opus cere mai întâi permisiunea de ștergere pentru folder. Pentru citire, comenzile git se rulează cu `GIT_OPTIONAL_LOCKS=0`.

**Când se oprește Opus și întreabă:** un test pică din alt motiv decât modificarea; o remediere ar cere schimbarea sau ștergerea unor rânduri de date; e nevoie de un pachet sau de un serviciu nou; orice operație în Stripe pe chei reale; o diferență între repo și producție pe care planul nu o acoperă; o decizie din §12 încă fără răspuns.

### 9.2 R0 — Plasa de siguranță

| | |
|---|---|
| **Scop** | Să se poată reveni din orice etapă. Nicio schimbare funcțională. |
| **Sarcini** | R0.1 copie de siguranță a bazei de date, făcută de proprietar, cu drumul de restaurare verificat · R0.2 eticheta de bază în git · R0.3 fotografia politicilor (C1–C14) salvată · R0.4 conturile de test · R0.5 mediul de test, dacă se alege (D1) |
| **Acceptare** | Copia există și se știe cum se restaurează; eticheta e pe GitHub; fotografia e în `AUDIT_TEHNIC/stare_db/`. |
| **Punct de control** | eticheta `audit-R0` |

### 9.3 R1 — Închiderea drumului direct către datele de autorizare (DB-01, DB-02, DB-03, DB-04, API-02, DB-07)

**R1.1 · `profiles`: listă albă de coloane la actualizare — P0, prima sarcină din tot planul**

- *Înainte:* confirmă coloanele pe care le actualizează interfața. Din ce am văzut: `full_name`, `username`, `role`, `notifications_enabled`, `teacher_code`, `last_active_at`, `deletion_warned_at`, `deletion_reminded_at`, `deletion_scheduled_at` (`rg -n "from\('profiles'\)" -A8 src`). Compară cu lista reală de coloane (C4).
- *Ordine:* doar SQL; nu cere publicare de cod. Clienții vechi, rămași în cache, continuă să meargă, pentru că actualizează doar coloane permise.
- *Schiță (NEAPLICATĂ; se validează pe mediul de test sau pe o copie):*

```sql
-- Schiță pentru supabase/audit_R1_1_profiles_coloane.sql
begin;
revoke update on public.profiles from authenticated, anon;
grant update (full_name, username, role, notifications_enabled, teacher_code,
              last_active_at, deletion_warned_at, deletion_reminded_at, deletion_scheduled_at)
  on public.profiles to authenticated;
-- profilul îl creează triggerul handle_new_user; în src/ nu există niciun insert pe profiles
revoke insert, delete on public.profiles from authenticated, anon;
commit;
-- ROLLBACK: grant insert, update, delete on public.profiles to authenticated;
```

- *De ce privilegii pe coloane și nu un trigger:* lista albă e sigură și pentru coloanele adăugate în viitor — o coloană nouă nu poate fi scrisă din browser până nu e trecută explicit pe listă.
- *Risc:* o cale din interfață care actualizează altă coloană ar începe să dea eroare. Prevenire: căutarea de mai sus, testul T-RLS-04, urmărirea tabelei `client_errors` 48 de ore.
- *Teste:* T-RLS-01, T-RLS-02, T-RLS-04. Rularea din nou a interogării C8, ca să se vadă dacă există conturi „active" fără abonament în Stripe (de lămurit cu proprietarul, nu de „reparat" automat).

**R1.2 · `profiles`: citirea doar a rândului propriu — P0**

- *Ordine:* **întâi codul**, apoi SQL-ul. (1) `src/components/Discussions.jsx` (r. 285, 317, 421, 452-453) și `src/components/Navbar.jsx` (r. 165) nu mai citesc profilurile altora; numele vine din `discussions.author_name`. (2) Publicare. (3) SQL: se șterg politicile `profiles_select_all` și `"Public profiles readable"`; rămâne politica „rândul propriu".
- *Înainte:* confirmă că `discussions.author_name` există și e completat pentru postările vechi (o numărătoare a rândurilor cu valoarea lipsă).
- *Atenție:* privilegiul `SELECT` al rolului `anon` pe tabelă **nu se retrage** în această etapă — alte politici (de exemplu `reviews_select`) citesc `profiles` într-o subinterogare și ar da eroare pentru vizitatori. Varianta curată, opțională: o funcție `public.is_admin()` (`SECURITY DEFINER`, cu `search_path` fixat, executabilă de `authenticated`) folosită în toate politicile care verifică administratorul; abia apoi se poate retrage privilegiul.
- *Clienții vechi din cache* cer în continuare `profile:profiles(...)`: vor primi `null` pentru ceilalți utilizatori și cad pe `author_name` (r. 317) — degradare acceptabilă, fără eroare. De aceea se schimbă politica de rând, nu privilegiul pe coloana `email`.
- *Teste:* T-RLS-03, T-RLS-05.

**R1.3 · Storage — P1**

- (a) `content-files`: se șterge politica `"Authenticated users can download files"`, după ce se confirmă că toate descărcările trec prin linkuri semnate (`rg -n "storage" src` — vizualizatoarele folosesc `get-file-url` și `get-preview-url`). (b) Politicile de scriere folosite de panoul Admin se aduc în repo și se limitează la administrator. (c) `discussions`: limită de mărime și tipuri permise pe bucket; drumul de încărcare trebuie să înceapă cu id-ul utilizatorului. (d) API-02: rezolvările Premium se mută într-un bucket privat și se servesc semnat — presupune mutarea fișierelor existente, deci se face cu proprietarul.
- *Ordine:* (a) și (c) doar SQL; (b) SQL, apoi verificarea panoului Admin; (d) cod + mutare de fișiere + SQL.
- *Teste:* T-STO-01, T-STO-02, T-STO-03.

**R1.4 · `progress`: scriere doar prin server — P1**

- *Ordine:* **întâi codul** — se scoate drumul de rezervă din `src/pages/InteractiveViewer.jsx:281-332` (înlocuit cu o reîncercare a apelului către `ai-score`) — apoi SQL-ul din `supabase/progress_server_only.sql`, copiat într-un fișier `audit_R1_4_…`.
- *Depinde de:* decizia de la EDU-01 (ce se întâmplă cu materialele fără chei).
- *Teste:* T-RLS-06, T-EDU-04.

| **Acceptare R1** | T-RLS-01…06 și T-STO-01…03 trec. Fotografia C1 și C4 de după corespunde intenției. Forumul, profilul și panoul Admin trec lista scurtă din §7.6. Nicio eroare nouă în `client_errors` timp de 48 de ore. |
|---|---|
| **Punct de control** | eticheta `audit-R1` |

### 9.4 R2 — Remedierile P0 din codul serverului (API-01, PAY-01)

| Sarcină | Fișiere | Modificarea | Teste |
|---|---|---|---|
| **R2.1** Referințe sigure către PDF-uri | modul nou în `api/_lib/` (de exemplu `pdfRef.js`); `api/ai-public.js` (publicare, citire, ștergere), `api/_lib/catalog.js` (`resolveTarget`), `api/ai-pdf-context.js` (`downloadLibraryPdf`) | O singură funcție validează perechea bucket + drum: bucketul trebuie să fie `personal-pdfs`; pentru materiale personale drumul începe cu id-ul proprietarului rândului; pentru materiale publicate, cu `public-library/`. Orice altceva → refuz. | fișier nou în `test/`; T-API-01, T-API-02 |
| **R2.1b** Verificarea datelor existente (doar citire) | — | Interogare care listează rândurile din `ai_personal_items` și `ai_public_library` cu `kind = 'pdf'` al căror bucket sau drum nu respectă regula: arată dacă breșa a fost folosită. | rezultatul se atașează la jurnal |
| **R2.2** Portalul verifică apartenența | `api/create-portal.js` | Înainte de a deschide portalul: abonamentul din profil aparține clientului din profil și poartă `supabase_user_id` (sau `platit_de`) egal cu apelantul. | test cu Stripe simulat (modelul din `test/plati-factura.test.js`) |

| **Acceptare R2** | Testele noi trec; R2.1b nu găsește rânduri suspecte (sau cele găsite sunt lămurite cu proprietarul); `npm test` și build-ul trec. |
|---|---|
| **Dependențe** | Niciuna — se poate lucra în paralel cu R1. |
| **Punct de control** | eticheta `audit-R2` |

### 9.5 R3 — Plăți robuste (PAY-02…PAY-09)

| Sarcină | Fișiere | Modificarea |
|---|---|---|
| **R3.1** Webhook care nu „înghite" plăți | `api/stripe-webhook.js` | Actualizarea profilului întoarce rândul atins; zero rânduri → 500 și alertă. Sesiunile care nu sunt ale platformei → 200 și jurnal. |
| **R3.2** Stare luată din Stripe, nu din eveniment | `api/stripe-webhook.js`; tabelă nouă `stripe_events` (doar pentru server) | La evenimentele de abonament se citește starea curentă din Stripe; contul e activ dacă are cel puțin un abonament activ. Evenimentele deja procesate se sar. |
| **R3.3** Un singur abonament plătitor per cont | `api/create-checkout.js` | Înainte de o sesiune nouă se caută abonamentele neîncheiate ale contului: activ → refuz; restant → se oferă plata sau închiderea lui. Cheie de idempotență la crearea sesiunii, contra dublului clic. |
| **R3.4** Ștergerea contului anulează abonamentele | `api/ai-account.js`; avertisment în `src/components/AccountSettings.jsx` și `src/pages/StergereCont.jsx` | Înainte de ștergere se anulează abonamentul propriu și cele plătite pentru copii; dacă anularea eșuează, ștergerea se oprește cu mesaj clar (sau după regula aleasă de proprietar). |
| **R3.5** Părinte și copil | `api/create-portal.js`, `api/_lib/abonamentCopil.js` | Copilul nu deschide portalul unui abonament plătit de altcineva; părintele îl deschide pe baza `platit_de`, chiar dacă asocierea s-a rupt. |
| **R3.6** Plată eșuată, rambursare, contestație | `api/stripe-webhook.js` | După deciziile D4 și D5: perioadă de grație sau nu; alertă și, opțional, retragerea beneficiului la rambursare. |
| **R3.7** Configurare | Stripe Dashboard, Vercel (le face proprietarul); `README.md` | Evenimentele abonate la webhook corespund celor tratate în cod; prețuri fixe prin `STRIPE_PRICE_*`. |

| **Acceptare R3** | T-PAY-01…09 trec pe chei de test. Reconcilierea — conturile `active` din `profiles` față de abonamentele active din Stripe — nu are diferențe neexplicate. |
|---|---|
| **Dependențe** | R0. Recomandat după R1.1, ca aceste coloane să fie deja scrise doar de server. |
| **Punct de control** | eticheta `audit-R3` |

### 9.6 R4 — AI: cost și abuz (AI-01…AI-04, AI-06, DB-06)

| Sarcină | Fișiere | Modificarea |
|---|---|---|
| **R4.1** Rezervare atomică a unei acțiuni AI | `api/_lib/ai.js` (`enforce*`, `logUsage`); funcție SQL nouă | O singură funcție SQL, sub blocaj pe utilizator: verifică limitele și inserează rândul în `ai_usage` **înainte** de apelul către model; `logUsage` îl completează cu tokenii și costul. La eșecul apelului, rândul se șterge. |
| **R4.2** Plafoane de intrare | `api/ai-chat.js`, `api/ai-chat-stream.js`, `api/_lib/ai.js` | Lungime maximă pentru mesaj și pentru fiecare câmp din context; peste limită → 413, fără apel la model. |
| **R4.3** `mathjs` | `package.json`, `api/_lib/mathcheck.js` | Versiune reparată; listă albă de funcții permise, verificată pe arborele expresiei; limită de timp. Se rulează testele `etapa2-mathcheck`, `corectare-exercitiu`, `tastatura-matematica`, `formule-reparate`. |
| **R4.4** Istoricul conversației scris doar de server | SQL pe `ai_messages` și `ai_conversations`; `src/lib/aiClient.js` | După ce se stabilește exact ce scrie clientul astăzi (A4): browserul rămâne cu citire (și ștergerea propriei conversații, dacă interfața o are). |
| **R4.5** Text de încredere luat de pe server | `api/_lib/ai.js` (`pdfAgentSystem`), `api/ai-pdf-context.js` | Pentru materialele platformei, textul testului și baremul se citesc pe server după `contentId` (memoria `ai_pdf_text` există), nu se primesc din browser. |
| **R4.6** Secret de semnare propriu | Vercel (proprietarul) | `AI_SIGNING_SECRET` setat; de știut că invitațiile și accesele emise înainte își pierd valabilitatea. |

| **Acceptare R4** | T-AI-01…06 trec. Costul unei rafale de 20 de cereri simultane nu depășește limita cu mai mult de o cerere. |
|---|---|
| **Punct de control** | eticheta `audit-R4` |

### 9.7 R5 — Întărirea securității (SEC-01…SEC-06, API-03…API-05)

| Sarcină | Modificarea |
|---|---|
| **R5.1** Dependențe, în două valuri | (a) corecții fără schimbări majore: `nodemailer`, `sharp`, `react-router-dom` și cele indirecte (`npm audit fix`, **fără** `--force`); (b) versiunile majore, una câte una, fiecare cu testele și build-ul ei: `katex`, `satori`, `vite` împreună cu `vite-plugin-pwa` (se verifică și actualizarea aplicației instalate). |
| **R5.2** Antete în `vercel.json` | `nosniff`, politica de referință, interdicția de încadrare, politica de permisiuni (microfonul și camera rămân permise pentru site). Politica de conținut pornește în mod „doar raportare"; sursele de inventariat: Google Fonts, jsDelivr, Google Analytics, Meta, TikTok, Supabase, YouTube, `blob:`, `data:`. |
| **R5.3** CORS și cron | `SITE_ORIGIN` setat (proprietarul); `?secret=` scos, după ce se confirmă că nu-l folosește niciun serviciu extern. |
| **R5.4** Locurile cu HTML | Regula linkurilor interne din `AITutor.jsx` refuză `//` și `/\`; verificarea funcțiilor care produc HTML pentru tablă și pentru articole; mesajele dintre pagină și cadre verifică sursa. |
| **R5.5** Conturi | Lungimea minimă a parolei și verificarea parolelor compromise (setări Supabase); autentificare în doi pași pentru administrator. |
| **R5.6** Endpoint-uri publice | Limitare durabilă (decizia D8) sau numărare în baza de date, ca în `contact.js`. |
| **R5.7** Durata funcțiilor | `maxDuration` pe grupe de funcții, nu 800 s peste tot; limite de timp pe apelurile externe. |

| **Acceptare R5** | `npm audit` fără avertismente ridicate în dependențele folosite la rulare (sau excepții documentate). T-SEC-01…03 trec. Politica de conținut rulează 7 zile în mod „doar raportare" fără blocări legitime, apoi se activează. |
|---|---|
| **Punct de control** | eticheta `audit-R5` |

### 9.8 R6 — Integritate educațională și roluri (EDU-01…03, DB-08…10)

| Sarcină | Modificarea |
|---|---|
| **R6.1** Scoruri neverificate | La materialele fără chei: fără puncte de clasament, iar în panoul profesorului rezultatul apare marcat „neverificat" (sau cheile se extrag la încărcare). |
| **R6.2** Regula gratuit / Premium | După decizia proprietarului, `ai-score`, `get-file-url` și interfața spun același lucru. |
| **R6.3** Rolul „părinte" la înregistrare | `handle_new_user` acceptă și `parinte` — pornind de la definiția **din producție** (C13), nu de la cea din repo. |
| **R6.4** Insigne acordate de server | Acordarea se mută în `ai-score`; politica de inserare din browser se scoate. |
| **R6.5** Forum | Limită de postări pe oră (trigger sau inserare prin server). |
| **R6.6** Cheile de răspuns | După decizia D6: rămân publice sau, pentru modurile competitive, se mută într-o tabelă citită doar de server. |

| **Acceptare R6** | T-EDU-01…04 trec. |
|---|---|
| **Dependențe** | R1.4. |
| **Punct de control** | eticheta `audit-R6` |

### 9.9 R7 — Frontend (FE-01…03 și defectele găsite în A7)

Defectele din A7 se repară unul câte unul, fiecare cu ID-ul lui și cu un test sau un pas de verificare. `README.md` se aduce la zi. Introducerea unui lint e opțională și cere acordul proprietarului (dependență nouă). Fără rescrieri de componente.

| **Acceptare R7** | Lista din A7 e închisă sau amânată conștient, cu motiv. Nicio eroare nouă în `client_errors` după publicare. |
|---|---|
| **Punct de control** | eticheta `audit-R7` |

### 9.10 R8 — SEO și performanță (SEO-01…04, PERF-01…03)

| Sarcină | Modificarea | Risc și prevenire |
|---|---|---|
| **R8.1** 404 real | Adresele necunoscute ajung la `page-meta`, care cunoaște tiparele de rute valide și răspunde 404 + `noindex` pentru rest. | Să nu primească 404 o rută validă a aplicației: lista tiparelor se generează din aceeași sursă ca rutele și se testează toate cele 44. |
| **R8.2** Adresă canonică pe fiecare rută publică | Rutele publice fără `page-meta` primesc meta proprii sau `noindex`. | — |
| **R8.3** Service worker mai ușor | Din lista descărcată în fundal se scot panoul Admin, uneltele profesorului, sala live și imaginile mari. | Se verifică funcționarea fără rețea și actualizarea după publicare (`src/lib/versiune.js`, `chunkReload.js`). |
| **R8.4** Fonturi | Mai puține familii și grosimi; găzduire proprie sau preîncărcarea fontului principal. | Verificare vizuală pe paginile principale. |
| **R8.5** Interogări | Limitele AI într-o singură funcție SQL (se leagă de R4.1); indexuri pe `ai_usage`, dacă lipsesc (C9). | Indexurile se creează fără blocarea tabelei. |
| **R8.6** Imagini | Comprimarea pictogramelor PWA și a imaginii de partajare. | — |

| **Acceptare R8** | T-SEO-01…03 și T-PERF-01…02 ating țintele agreate; valorile de dinainte și de după sunt trecute în `04`. |
|---|---|
| **Punct de control** | eticheta `audit-R8` |

### 9.11 R9 — Costuri și operare (COST-01…03, OPS-01, OPS-02, DB-05, DB-11, AI-05, AI-07)

| Sarcină | Modificarea |
|---|---|
| **R9.1** Cron-uri | Frecvențe revizuite pe baza cifrelor din A9; durată maximă pe funcție; întrerupător general de cost pentru agenți, dacă lipsește. |
| **R9.2** Măsurarea vizitelor | `vizita` trimisă în loturi sau eșantionată, ori renunțarea la una dintre cele trei măsurători. |
| **R9.3** Costul AI | Tabelul de prețuri verificat cu factura; alegerea modelului pe tip de sarcină, pe baza costurilor măsurate și a setului de evaluare (`npm run eval`). |
| **R9.4** Disciplina migrărilor | Jurnal al scripturilor aplicate (`supabase/APLICATE.md` sau o tabelă); o descărcare a schemei reale, păstrată privat; mediul de test. |
| **R9.5** Curățenie | `Claude outputs/` scos din git (decizie); fișierele `.lock` vechi din `.git/` șterse de proprietar; documentația la zi. |
| **R9.6** Supraveghere | Alerte pentru webhook-uri eșuate, salturi de cost AI și rata erorilor. |

| **Acceptare R9** | Costul lunar de dinainte și de după, pe fiecare sursă din §5.10, este documentat. |
|---|---|
| **Punct de control** | eticheta `audit-R9` |

### 9.12 Dependențe și ordinea recomandată

```
R0 ──► R1.1 (urgent, doar SQL)
   ├─► R2   (în paralel cu R1; doar cod)
   ├─► R1.2 (cod → SQL)      R1.3 (SQL / cod)      R1.4 (cod → SQL) ──► R6
   ├─► R3   (după R1.1)
   ├─► R4   (R4.1 înaintea lui R8.5; R4.3 = partea de mathjs din R5.1)
   ├─► R5
   ├─► R7, R8 (după A7, A8)
   └─► R9   (ultima; are nevoie de cifrele din A9)
```

Ordinea după impact: **R1.1 → R2 → R1.2 → R1.3 → R3 → R4 → R1.4 și R6 → R5 → R8 → R7 → R9.**

---

## 10. Instrucțiuni pentru Claude Opus 5.5

### 10.1 Rolul tău și limitele lui

Preiei un audit început. Cartografierea este făcută și există 57 de constatări preliminare. Ai două faze, cu reguli diferite:

| Faza | Ai voie | Nu ai voie |
|---|---|---|
| **Audit (A0–A9)** | Să citești tot proiectul; să rulezi testele și build-ul pe o copie; să scrii în `AUDIT_TEHNIC/`; să ceri proprietarului rezultatele interogărilor din Anexa C | Să modifici vreun fișier din afara `AUDIT_TEHNIC/`; să scrii în baza de date; să schimbi configurări din Vercel, Supabase sau Stripe; să instalezi pachete în proiect; să publici |
| **Remediere (R0–R9)** | Să modifici codul strict pentru sarcina aprobată; să scrii fișiere SQL noi, pe care le aplică proprietarul | Să aplici tu SQL pe producție; să atingi cod din afara sarcinii; să rescrii pentru eleganță; să treci de un punct de control fără confirmare |

În ambele faze: niciun secret și nicio dată personală în documente; nicio problemă declarată rezolvată fără dovadă; orice nu poți verifica se marchează ca atare, cu motivul.

### 10.2 Prima sesiune, pas cu pas

1. Citește acest document integral. Nu citi încă altceva.
2. Confirmă punctul de plecare: `GIT_OPTIONAL_LOCKS=0 git log -1 --oneline` și `git status --short`. Dacă `main` a avansat față de `02ab37a`, notează commitul nou și verifică cu `git diff --stat 02ab37a` dacă fișierele citate în §4 s-au schimbat.
3. Creează `AUDIT_TEHNIC/PROGRESS_AUDIT.md` (§8.4).
4. Cere proprietarului, într-un singur mesaj: rezultatele interogărilor C1–C14, rapoartele consilierilor Supabase, numele variabilelor de mediu din Vercel, fișa Stripe (§3.6) și răspunsurile la deciziile din §12.
5. Cât aștepți, rulează valorile de referință pe o copie (§10.3) și compară-le cu Anexa D.
6. Parcurge A1: cele 14 constatări P0 și P1, una câte una, cu verdict și dovadă.
7. Pentru fiecare P0 confirmat, anunță proprietarul imediat și propune începerea etapei R1 sau R2 fără a aștepta restul auditului.
8. Actualizează `PROGRESS_AUDIT.md` și oprește-te la sfârșitul etapei.

### 10.3 Cum lucrezi eficient în acest proiect

**Nu citi:** `node_modules/`, `android-twa/` (52 MB), `_to_delete/` (218 MB de arhive), `Claude outputs/` (31 MB de imagini și video), `play-assets/`, `api/_lib/fonts/`, `api/_lib/audio/`. `CHANGELOG-REPARATII.md` are 496 KB: caută în el cu `rg`, nu-l deschide.

**Fișierele mari se citesc pe bucăți**, după ce ai găsit cu `rg` rândurile care te interesează: `api/live.js` (2 943 de rânduri), `api/_lib/ai.js` (2 529), `api/_lib/exgen.js` (2 492), `api/ai-meditatii.js` (2 337), `src/pages/Meditatii.jsx` (2 328), `src/styles/global.css` (2 280), `src/components/AITutor.jsx` (2 079), `api/_lib/seo.js` (1 854), `api/_lib/generatoare.js` (1 732), `src/pages/PDFViewer.jsx` (1 521).

**Căutări care răspund repede la întrebările din §5:**

```bash
# ce scrie browserul direct în baza de date (calea A)
rg -n "supabase\s*\.from\(" src -A4 | rg "insert|update|upsert|delete"
# ce pază are fiecare rută
rg -c "authUser\(|requireAdmin\(|isCronRequest\(" api/*.js
# identificatori primiți de la client (candidați la verificarea pe obiect)
rg -n "req\.body\??\.\w*[iI]d\b" api
# Storage cu bucket sau drum venit din date
rg -n "storage\s*\.from\(" api src
# limitele AI, pe rute
rg -n "enforceRateLimit|enforceFreeQuota|enforceFeatureQuota|requirePremium" api
# locurile unde se inserează HTML
rg -n "dangerouslySetInnerHTML|innerHTML\s*=|srcDoc|document\.write" src
# chei care nu au ce căuta în client sau în repo
rg -n "sk_live|sk_test|service_role|API_KEY" src
```

**Teste și build, fără să atingi proiectul.** Modulele din `node_modules/` au fost instalate pe Windows și nu rulează în mașina Linux a sesiunii. Fă o copie în afara proiectului (fără `node_modules`, `.git`, `android-twa`, `_to_delete`, `Claude outputs`, `play-assets` — rămân ≈16 MB), apoi `npm ci --ignore-scripts` (≈40 s), `node --test test/*.test.js` (≈80 s) și `npx vite build` (≈20 s). Nu lăsa arhive sau fișiere temporare în folderul proiectului.

**Git.** Vezi regula 8 din §9.1: pentru citire folosește `GIT_OPTIONAL_LOCKS=0`; pentru commit-uri, fie le face proprietarul din GitHub Desktop, fie ceri întâi permisiunea de ștergere.

### 10.4 Regulile casei

- `CLAUDE.md` din rădăcină: orice `create table public.<tabelă>` vine, **în același fișier**, cu `enable row level security` și cu GRANT-urile explicite; `anon` primește acces doar dacă datele sunt publice — dacă nu e clar, întrebi.
- Documentele, comentariile din cod și antetele fișierelor SQL se scriu în română, în stilul existent: fiecare fișier începe cu un antet care spune ce face și de ce.
- Scripturile SQL se rulează manual, de către proprietar, în Supabase → SQL Editor. Trebuie să fie idempotente.
- Fiecare modificare de comportament vine cu un test în `test/` (`node:test`), ca până acum.
- Fluxul „Verificare" din GitHub Actions trebuie să treacă înaintea oricărei îmbinări în `main`; publicarea se face automat de pe `main` (de confirmat cu proprietarul).

### 10.5 Cum raportezi

La sfârșitul fiecărei etape, un mesaj scurt cu patru părți: **ce ai verificat** (și ce nu), **verdictul** pe fiecare constatare atinsă, **ce a rămas necunoscut** și ce îți trebuie ca să afli, **ce urmează**. Fără povestirea pașilor.

### 10.6 Mesajele de pornire (de copiat de către proprietar)

**Pentru audit:**

```text
Preiei auditul platformei ExamenMate (folderul mate-online).
1. Citește integral AUDIT_TEHNIC/PLAN_AUDIT_OPUS.md. Este sursa ta pentru arhitectură,
   constatările preliminare, ordinea de lucru și reguli.
2. Nu modifica niciun fișier din afara folderului AUDIT_TEHNIC, nu scrie în baza de date
   și nu schimba nicio configurare până nu aprob explicit o etapă de remediere.
3. Urmează „Prima sesiune, pas cu pas" (§10.2): începe cu A0, apoi A1.
4. Nu relua ce e marcat „deja făcut". Confirmă constatările din §4 cu nivelul de dovadă
   cerut în §7.1.
5. Când îți lipsește o informație (starea bazei de date, variabile de mediu, Stripe),
   cere-mi-o. Nu presupune.
6. Ține la zi AUDIT_TEHNIC/PROGRESS_AUDIT.md, la sfârșitul fiecărei etape și înainte
   de a încheia sesiunea.
Începe prin a-mi spune exact ce îți trebuie de la mine pentru A0.
```

**Pentru o etapă de remediere:**

```text
Treci la etapa R<n> din AUDIT_TEHNIC/05_PLAN_IMPLEMENTARE.md și 07_HANDOFF_OPUS.md.
Lucrează pe ramura fix/R<n>-<nume>, o sarcină pe commit.
Pentru fiecare sarcină: arată-mi întâi modificarea propusă și riscul ei; după ce aprob,
implementeaz-o, scrie testul cerut, rulează npm test și build-ul, completează
AUDIT_TEHNIC/JURNAL_REMEDIERI.md.
Scripturile SQL mi le dai ca fișiere în supabase/; le rulez eu și îți trimit rezultatul
verificării. Oprește-te la punctul de control și așteaptă confirmarea mea.
```

---

## 11. Criteriile de acceptare, pe scurt

Criteriile fiecărei etape sunt în tabelul din §6 (A0–A9) și la sfârșitul fiecărei subsecțiuni din §9 (R0–R9). Mai jos, ce înseamnă „gata" pentru întreaga misiune.

**Auditul este gata când:**
- fiecare dintre cele 57 de constatări are un verdict cu dovadă, iar cele 8 zone neverificate sunt fie închise, fie declarate deschise cu motiv;
- toate cele 66 de rute și toate tabelele din producție au fișa completată;
- cele 7 documente există, totalurile din `01` coincid cu lista din `02`, iar `07` poate fi executat fără alt document alături;
- proprietarul a primit răspuns, cu dovezi, la cele două întrebări despre plăți;
- `git status` arată fișiere noi doar în `AUDIT_TEHNIC/`.

**O etapă de remediere este gata când:**
- toate testele T-… ale etapei trec, iar `npm test` și build-ul trec;
- fiecare sarcină are intrarea ei în `JURNAL_REMEDIERI.md`, cu commitul și cu drumul de revenire;
- fotografia bazei de date de după (unde e cazul) corespunde intenției;
- lista scurtă din §7.6 a fost parcursă pe site-ul publicat;
- proprietarul a confirmat punctul de control, iar eticheta git există.

**Remedierea în ansamblu este gata când:** nu mai există P0 sau P1 deschise, iar fiecare P2 și P3 este fie închis, fie amânat explicit de proprietar, cu motiv.

---

## 12. Decizii care aparțin proprietarului

Opus are nevoie de aceste răspunsuri; unele blochează etape întregi.

| Nr. | Decizia | Blochează |
|---|---|---|
| D1 | Facem un mediu de test separat (al doilea proiect Supabase + chei Stripe de test + deploy de previzualizare)? Fără el, testele de plăți și de RLS se fac pe producție, cu conturi de test. | A3, R1, R3 |
| D2 | Ai voie Opus să ceară probe de nivel 5 pe producție (un cont de test își modifică propriul rând, cu revenire imediată)? | A1 |
| D3 | Rolul (elev / profesor / părinte) rămâne ales liber de utilizator? Dacă da, niciun privilegiu real nu trebuie să depindă de el. | R2, R6 |
| D4 | La o plată eșuată, Premium se oprește imediat sau după o perioadă de grație? De câte zile? | R3.6 |
| D5 | La rambursare sau contestație, se retrag automat Premium, creditele AI și biletele? | R3.6 |
| D6 | Cheile de răspuns ale testelor pot rămâne publice (contează la dueluri, turnee, ligă)? | R6.6 |
| D7 | Aprobi actualizările majore de dependențe (mathjs 15, vite 8, katex 0.19, satori 0.63, vite-plugin-pwa 2) și adăugarea unui lint? | R4.3, R5.1, R7 |
| D8 | Aprobi un serviciu pentru limitarea durabilă a cererilor (cost suplimentar) sau rămânem la numărarea în baza de date? | R5.6 |
| D9 | Paginile materialelor individuale să fie indexabile de motoarele de căutare? | R8 |
| D10 | Repo-ul GitHub este public sau privat? De asta depinde dacă documentele de audit pot fi comise. | comiterea documentelor |
| D11 | Cine face commit-urile și etichetele la punctele de control: tu, din GitHub Desktop, sau Opus? | R0 |
| D12 | Consult juridic pentru conturile minorilor (acordul părintelui, acceptarea termenilor la înregistrare)? | LEG-01 |
| D13 | Regula reală pentru testele interactive: toate gratuite, sau cele cu `is_free = false` cer abonament? | R6.2 |

---

## Anexa A — Harta accesului la tabele, după scripturile din repo

Reconstruită automat din cele 104 fișiere `supabase/*.sql`, aplicate în ordinea în care au intrat în repo. **Este starea pe care o descrie repo-ul, nu neapărat cea din producție** (DB-05): Opus o compară cu rezultatele C1–C4 și notează orice diferență.

### A.1 Tabele pe care browserul le poate scrie direct

| Tabelă | Ce permit politicile | Constatare |
|---|---|---|
| `profiles` | citire: toate rândurile, inclusiv pentru vizitatori · actualizare: rândul propriu, toate coloanele · inserare: rândul propriu | DB-01, DB-02 |
| `progress` | citire: rândurile proprii (administratorul: toate) · inserare și actualizare proprie, dacă `progress_server_only.sql` nu a fost rulat | DB-04 |
| `content` | citire: toată lumea, toate coloanele · scriere: doar dacă `profiles.is_admin` | depinde de DB-01; DB-08 |
| `discussions` | citire: toată lumea · inserare, actualizare, ștergere proprie · ștergere și de către administrator | EDU-03 |
| `discussion_likes` | citire: toată lumea · orice operație pe rândurile proprii | — |
| `reviews` | citire: cele aprobate, cele proprii, administratorul · inserare proprie, cu `reviews_can_rate` · actualizare și ștergere proprie sau de administrator · triggerul `reviews_before_write` (necitit) | de verificat dacă autorul își poate aproba singur recenzia |
| `ai_conversations` | orice operație pe rândurile proprii | DB-06 |
| `ai_messages` | orice operație, prin conversația proprie | DB-06 |
| `ai_personal_items` | orice operație pe rândurile proprii, inclusiv `payload` | API-01, DB-06 |
| `ai_feedback`, `ai_broadcast_reads`, `push_subscriptions` | orice operație pe rândurile proprii | — |
| `ai_notifications` | citire și actualizare proprie (inserarea o face serverul) | — |
| `user_badges` | citire și **inserare** proprie | DB-10 |
| `ai_public_library` | citire: toată lumea, fără coloana `payload` (privilegii pe coloane) · ștergere proprie | — |

### A.2 Tabele citite public (rolul `anon`)

`content` (toate coloanele), `rezolvari`, `discussions`, `discussion_likes`, `profiles` (DB-02), `reviews` și vederea `reviews_stats`, `articole` (doar cele publicate), `seo_meta`, `ai_public_library` (fără `payload`).

### A.3 Tabele pe care utilizatorul doar le citește (rândurile lui); scrie numai serverul

`ai_skill_mastery`, `ai_meditatii_profile`, `ai_meditatii_reviews`, `ai_meditatii_mistakes`, `ai_meditatii_sessions`, `ai_meditatii_homework`, `ai_meditatii_item_reviews` (ultimele trei fără coloanele cu enunțuri și răspunsuri — privilegii pe coloane), `ai_assignments` (autorul), `ai_assignment_results` (elevul sau autorul temei), `ai_public_results` (elevul sau autorul materialului), `ai_pdf_results`, `ai_broadcasts` (orice cont), `buddies`, `homework`, `homework_items`, `homework_progress` (profesorul sau elevul), `group_assignments`, `group_assignment_items`, `group_assignment_picks` (autorul; elevul își vede alegerea), `mentor_grade_periods`, `teacher_marks`, `daily_exercises`, `daily_tests`, `daily_missions`, `user_stats`, `xp_events`, `chapter_state`.

De verificat: ramura pentru părinte din politica `teacher_marks_read` citește `mentor_students`, care e închisă pentru browser — deci ramura nu se potrivește niciodată. Fără efect dacă părinții primesc notele prin server.

### A.4 Tabele doar pentru server (fără acces din browser)

`agent_tasks`, `agent_task_runs`, `ai_usage`, `ai_topups`, `ai_knowledge`, `ai_ingest_queue`, `ai_pdf_text`, `ai_pregen`, `ai_correct_forms`, `ai_cost_alerts`, `ai_mastery_snapshots`, `app_settings`, `archived_student_results`, `arena_feed`, `chat_threads`, `chat_messages`, `chat_reads`, `client_errors`, `contact_messages`, `content_checks`, `debug_runs`, `duels`, `exam_bot_index`, `exam_bot_items`, `exam_bot_pages`, `exam_bot_runs`, `fise_banca`, `group_test_history`, `gsc_snapshots`, `league_seasons`, `league_standings`, `live_sessions`, `live_lessons`, `live_lesson_qa`, `live_messages`, `live_participants`, `live_poll_answers`, `live_tickets`, `mentor_groups`, `mentor_students`, `newsletter_campaigns`, `newsletter_sends`, `page_views`, `seo_actions`, `social_posts`, `tournaments`, `tournament_entries`, `tournament_items`, `tournament_places`, `tournament_scores`.

### A.5 Storage și Realtime

| Bucket | Public | Politici în repo | Constatare |
|---|---|---|---|
| `content-files` | nu | citire pentru **orice cont autentificat**; inserare doar rolul de serviciu (politicile folosite de panoul Admin lipsesc din repo) | DB-03 |
| `content-files-free` | da | citire pentru oricine | — |
| `discussions` | da | inserare pentru orice cont, fără restricție de drum, tip sau mărime; ștergere doar în folderul propriu; citirea permite practic listarea | DB-07, API-02 |
| `personal-pdfs` | nu | toate operațiile doar în folderul propriu (`<id-utilizator>/…`); 25 MB; doar PDF | API-01 (ocolit prin server) |
| `agent-media`, `live-media` | da | nicio politică pentru utilizatori (scrie doar serverul) | — |

Realtime: citire și prezență pe subiectele `live:…`, numai dacă `live_can_access(subiect)` întoarce adevărat.

### A.6 Funcții SQL

46 de funcții. Toate cele `SECURITY DEFINER` au `search_path` fixat. `fix_grants_v3.sql` (23 aug. 2026) retrage dreptul de execuție al rolurilor `anon` și `authenticated` pentru toate funcțiile `SECURITY DEFINER` existente la acea dată; cele create ulterior au revocări în propriile fișiere. `live_can_access` rămâne executabilă de `authenticated`, intenționat. Starea reală se confirmă cu C6.

---

## Anexa B — Matricea rutelor (ce pază are fiecare)

Obținută prin căutare automată a apelurilor `authUser`, `requireAdmin`, `isCronRequest` și a funcțiilor de limitare. **Arată ce pază există, nu dacă e suficientă** — asta stabilește etapa A4.

| Tip de pază | Rute |
|---|---|
| **Publice** (fără cont) | `client-error`, `contact`, `page-meta`, `sitemap`, `vizita` (contul e opțional), `social-image` (semnătură HMAC), `stripe-webhook` (semnătura Stripe); din `ai-public` — lista; din `live` — programul |
| **Doar cron** (`CRON_SECRET`) | `agent-cron`, `seo-cron`, `social-cron` |
| **Cron + utilizator sau administrator** | `account-cleanup`, `ai-ingest`, `ai-notify`, `ai-meditatii`, `duel`, `turneu`, `gamificare`, `live`, `exam-bot`, `review-invite` |
| **Doar administrator** (`requireAdmin`) | `admin-debug`, `admin-stats`, `admin-users`, `agent-tasks`, `ai-exercise-agent`, `ai-seo-agent`, `content-admin`, `content-check`, `newsletter`, `rezolvari-admin`, `seo-actions`, `seo-rank`, `social-queue` |
| **Utilizator autentificat, cu limite AI** | `ai-chat`, `ai-chat-stream`, `ai-vision`, `ai-transcribe`, `ai-correct`, `ai-exam`, `ai-generate-interactive`, `ai-handwriting`, `ai-practice`, `ai-assignment`, `ai-meditatii`, `rezolva-pdf`, `fise`; `ai-public` (transcrierea) |
| **Utilizator autentificat, fără limite AI** | `ai-account`, `ai-activity`, `ai-feedback`, `ai-pdf-context`, `ai-progress`, `ai-score`, `ai-teacher`, `asociere`, `colegi`, `create-checkout`, `create-portal`, `get-preview-url`, `group-assignment`, `harta`, `homework`, `messages`, `teacher-manage`, `teacher-students` |
| **Cont cerut doar pentru conținutul Premium** | `get-file-url`, `rezolvare-url` |

De lămurit în A4: `ai-ingest` și `ai-notify` au cale de utilizator fără `requireAdmin` (au o verificare proprie?); `newsletter` acceptă și GET; `ai-pdf-context` și `ai-teacher` nu cheamă limitele AI.

**Cron-urile** (din `vercel.json`): `live` și `social-cron` (publicare) la 15 minute; `ai-ingest` la 30 de minute; `agent-cron` și două sarcini din `gamificare` la fiecare oră; `exam-bot` la 2 ore; `duel` și `turneu` la 6 ore; zilnic — `ai-notify`, `account-cleanup`, `seo-cron` (instantaneu), `social-cron` (măsurători), `ai-meditatii`, `review-invite`; săptămânal — `seo-cron` (rulare automată) și liga din `gamificare`; lunar — `seo-cron`.

---

## Anexa C — Interogări de diagnostic pentru producție (numai citire)

Le rulează proprietarul în Supabase → SQL Editor. Niciuna nu modifică nimic. Rezultatele se salvează în `AUDIT_TEHNIC/stare_db/`, **fără date personale** (la C8, lista administratorilor se verifică pe ecran și se notează doar dacă e cea așteptată).

```sql
-- C1. Toate politicile RLS (tabele, Storage, Realtime)
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage', 'realtime')
order by schemaname, tablename, cmd, policyname;

-- C2. Tabelele din public: RLS activ? câte rânduri (estimare)?
select c.relname as tabela, c.relrowsecurity as rls_activ, c.relforcerowsecurity as rls_fortat,
       c.reltuples::bigint as randuri_estimate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- C3. Privilegiile pe tabele pentru vizitatori și pentru conturi
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegii
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- C4. Privilegiile pe COLOANELE tabelei profiles (cheia constatării DB-01)
select column_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegii
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'authenticated')
group by column_name, grantee
order by column_name, grantee;

-- C5. Triggerele (inclusiv cel de pe auth.users care creează profilul)
select event_object_schema as schema_tabela, event_object_table as tabela, trigger_name,
       action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema in ('public', 'auth', 'storage')
order by 1, 2, 3;

-- C6. Funcțiile SECURITY DEFINER și cine le poate apela din browser
select p.oid::regprocedure as functie,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as autentificat,
       p.proconfig as setari
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by 1;

-- C7. Bucketurile de Storage
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

-- C8. Semne că DB-01 a fost deja folosit (numărători, fără date personale)
select count(*)                                                                               as total,
       count(*) filter (where is_admin)                                                       as administratori,
       count(*) filter (where subscription_status = 'active')                                 as abonati_activi,
       count(*) filter (where subscription_status = 'active' and stripe_customer_id is null)  as activi_fara_client_stripe,
       count(*) filter (where subscription_status = 'active' and subscription_id is null)     as activi_fara_abonament_stripe
from public.profiles;
-- lista administratorilor: trebuie să conțină DOAR conturile tale (verifică pe ecran, nu salva)
select id, created_at from public.profiles where is_admin order by created_at;

-- C9. Cele mai mari tabele și toate indexurile
select c.relname as tabela, pg_size_pretty(pg_total_relation_size(c.oid)) as marime,
       c.reltuples::bigint as randuri_estimate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 30;
select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2;

-- C10. Constrângerile de pe profiles (valorile permise pentru role și subscription_status)
select conname, pg_get_constraintdef(oid) as definitie
from pg_constraint
where conrelid = 'public.profiles'::regclass
order by 1;

-- C11. Extensiile instalate
select extname, extversion from pg_extension order by 1;

-- C12. Privilegiile implicite pentru obiectele noi
select defaclrole::regrole as rol, defaclnamespace::regnamespace as schema_obiect,
       defaclobjtype as tip, defaclacl as privilegii
from pg_default_acl
order by 1, 2, 3;

-- C13. Definiția din producție a funcției care creează profilul (pentru DB-09)
select pg_get_functiondef('public.handle_new_user'::regproc);

-- C14a. Postări de forum fără numele autorului salvat (pentru R1.2).
--       Dacă dă eroare „column author_name does not exist", scriptul pastreaza_date_publice.sql nu a fost rulat.
select count(*) as total, count(*) filter (where author_name is null) as fara_nume
from public.discussions;

-- C14b. Referințe către PDF-uri care ies din regulă (pentru API-01). Doar numărători.
select 'materiale personale' as sursa, count(*) as de_analizat
from public.ai_personal_items
where kind = 'pdf' and payload ? 'pdfPath'
  and (coalesce(payload->>'bucket', 'personal-pdfs') <> 'personal-pdfs'
       or split_part(payload->>'pdfPath', '/', 1) <> user_id::text)
union all
select 'biblioteca utilizatorilor', count(*)
from public.ai_public_library
where kind = 'pdf' and payload ? 'pdfPath'
  and (coalesce(payload->>'bucket', 'personal-pdfs') <> 'personal-pdfs'
       or payload->>'pdfPath' not like 'public-library/%');
```

Cum se citesc rezultatele:
- **C4** — dacă `authenticated` are `UPDATE` pe `subscription_status`, `is_admin` sau `stripe_customer_id` și C5 nu arată niciun trigger de protecție pe `profiles`, DB-01 este confirmat în producție.
- **C8** — `activi_fara_client_stripe` ar trebui să fie zero, cu excepția conturilor activate manual de proprietar. Administratorii nu au nevoie de abonament, deci nu intră la numărătoare ca problemă.
- **C14b** — rândurile găsite se analizează, nu se consideră automat abuz (pot exista forme vechi, legitime, ale drumului).

Pe lângă interogări, din dashboard: rapoartele **Security Advisor** și **Performance Advisor** (acesta din urmă listează și cheile străine fără index) și politicile de Storage ale fiecărui bucket.

---

## Anexa D — Verificările automate deja rulate (14 nov. 2026)

Toate au fost rulate pe o **copie** a proiectului, în afara folderului de lucru. Proiectul nu a fost atins.

**Teste.** `node --test test/*.test.js`, Node 22.23.4: **1 271 de teste — 1 269 trecute, 2 sărite, niciunul picat**, în ≈79 s.

**Build.** `vite build` (Vite 5.4.21): reușit, 600 de module, ≈19 s. Avertismente: fragmente peste 600 KB; `src/lib/aiClient.js` importat și dinamic (din `aiCredit.js`), și static (din peste 50 de module); datele `browserslist` vechi de 6 luni.

**Mărimea fișierelor** (necomprimat / gzip):

| Fișier | Mărime | Când se încarcă |
|---|---|---|
| `index` (aplicația) | 196,7 KB / 59,4 KB | la prima pagină |
| `react-vendor` | 162,7 KB / 53,2 KB | la prima pagină |
| `supabase` | 210,8 KB / 54,4 KB | la prima pagină |
| `index.css` | 63,3 KB / 13,4 KB | la prima pagină |
| `mathlive` | 819,7 KB / 228,9 KB | la cerere (tastatura matematică) |
| `material-pdflib` | 529,5 KB / 210,3 KB | la cerere (încărcarea de materiale) |
| `Admin` | 380,6 KB / 106,1 KB | la cerere — dar e în lista service worker-ului |
| `katex` | 258,5 KB / 77,6 KB | la cerere |
| `material-docx` | 174,9 KB / 51,6 KB | la cerere |
| `AITutor` | 151,1 KB / 48,4 KB | după prima afișare (widgetul) |
| `Meditatii` | 138,3 KB / 43,9 KB | la cerere |
| `Profile` | 132,5 KB / 36,1 KB | la cerere |
| `ProfesorVirtual` | 124,3 KB / 36,3 KB | la cerere |
| `PDFViewer` | 87,3 KB / 29,7 KB | la cerere |
| `LiveRoom` | 80,1 KB / 22,7 KB | la cerere |

JavaScript inițial: ≈570 KB, ≈167 KB comprimat.

**Service worker.** 101 fișiere, 3 152,98 KiB descărcate în fundal. Cele mai mari: `Admin` (387 KB), `supabase` (211 KB), `index` (199 KB), `pwa-512x512.png` (177 KB), `react-vendor` (163 KB), `pwa-maskable-512.png` (157 KB), `AITutor` (154 KB), `Meditatii` (141 KB), `Profile` (134 KB), `ProfesorVirtual` (126 KB). Pictogramele PWA par trecute de două ori în listă — de verificat.

**`npm audit`.** 24 de avertismente: 10 ridicate, 10 moderate, 4 scăzute, niciunul critic.

| Pachet | Severitate | Directă? | Reparația |
|---|---|---|---|
| `mathjs` (instalat 14.9.1) | ridicată | da | 15.2.0 — versiune majoră |
| `nodemailer` | ridicată | da | disponibilă, fără versiune majoră |
| `sharp` | ridicată | da | disponibilă, fără versiune majoră |
| `vite` | ridicată | da (doar la dezvoltare) | 8.3.8 — versiune majoră |
| `react-router-dom` | moderată | da | disponibilă |
| `satori` | moderată | da | 0.63.2 — versiune majoră |
| `vite-plugin-pwa` | moderată | da | 2.0.0 — versiune majoră |
| `katex` | scăzută | da | 0.19.1 — versiune majoră |
| `brace-expansion`, `browserslist`, `fast-uri`, `nanoid`, `postcss`, `source-map-js` | ridicată | nu | disponibilă |
| `baseline-browser-mapping`, `glob`, `minimatch`, `qs`, `react-router`, `workbox-build` | moderată | nu | disponibilă |
| `esbuild` | moderată | nu | vine odată cu `vite` 8 |
| `@rollup/plugin-node-resolve`, `deepmerge`, `serialize-javascript` | scăzută | nu | disponibilă |

**Git.** La 14 nov. 2026, ora 18:30: `main` la `02ab37a`, arbore de lucru curat. Urmărite în git: 54 de fișiere din `android-twa/` și 22 din `Claude outputs/`.

---

*Sfârșitul planului. Următorul pas îi aparține proprietarului: răspunsurile la deciziile din §12 și rularea interogărilor din Anexa C.*
