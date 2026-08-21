# Ghid — mențiunea modelelor AI și recenziile cu stele

Data: 21 august 2026 (tranșa 1 + tranșa 2 + tranșa 3: email automat, JSON-LD, răspunsul echipei)

## 1. Modelele AI — un singur loc de adevăr

| Fișier | Rol |
|---|---|
| `src/lib/aiModels.js` → `AI_STACK`, `AI_STACK_SCURT` | **Aici schimbi numele modelelor.** Două grupuri: `clienti` (OpenAI — GPT-4o mini, GPT-5.6 Terra, GPT-5.6 Sol) și `intern` (Anthropic — Claude Opus 5, Claude Fable 5, *doar unelte administrative interne*). |
| `src/components/AIPoweredBy.jsx` | Componenta care afișează mențiunea. Variante: `inline`, `chips`, `footer`, `disclaimer`. Toate duc la `/faq#ai`. |

Unde apare: **Footer** (toate paginile, bloc „Tehnologie AI"), **Home** (pastile sub titlul secțiunii AI — OpenAI + interne Anthropic), **/profesor-virtual** (hero, modelele OpenAI), **chatul Profesorului Virtual** (sub câmpul de scris: modelele + „AI-ul poate greși"), **/preturi** (lista Premium + o linie sub „Conținut gratuit"), **/despre-noi** (paragraf nou), **/faq#ai** (categorie nouă, prima din pagină, 4 întrebări; linkul deschide automat răspunsurile).

Mesajul este consecvent cu Politica de Confidențialitate (§7–8) și Termenii (§7, §9): OpenAI procesează datele utilizatorilor, Anthropic e folosit doar pentru conținut educațional și unelte interne, fără date personale. Paginile legale nu au fost modificate.

> `AI_STACK` nu citește env-ul din Vercel. Dacă schimbi `AI_CHAT_MODEL`, `AI_PDF_CHAT_MODEL`, `AI_GEN_CHAT_MODEL` sau `CLAUDE_MODEL`, actualizează și `AI_STACK`. Rolurile Terra/Sol din `descriere` sunt formulate generic — ajustează textul dacă vrei să spui exact ce face fiecare.

## 2. Recenzii — ce există acum

### Baza de date — `supabase/reviews_schema.sql` (rulează o dată; idempotent)

Tabelul `reviews` (`target_type` = `content` test din site / `public_item` Biblioteca utilizatorilor / `site` părere generală; `stars` 1–5; `body` ≤ 1000; `approved`; snapshot `author_name` + `author_role`), funcția `reviews_can_rate`, triggerul `reviews_before_write`, politicile RLS și view-ul `reviews_stats`.

Reguli impuse în baza de date, nu doar în UI:

- notele per test: **doar cine a rezolvat testul** (rând în `progress`, respectiv `ai_public_results`);
- recenziile de site: orice cont autentificat, **una per cont**; apar public **doar după aprobare** (`approved = true`, setat de admin);
- utilizatorul își poate schimba doar stelele și comentariul; nu își poate aproba singur recenzia și nu o poate muta pe alt test/cont (trigger);
- recenziile rămân după ștergerea contului (FK `ON DELETE SET NULL` + snapshot), ca în `pastreaza_date_publice.sql`;
- `reviews_stats` calculează media site-ului **doar din recenziile aprobate** (aceeași cifră pentru vizitatori, utilizatori și admin).

> Dacă ai rulat deja fișierul în tranșa 1, rulează-l din nou: tranșa 2 a schimbat definiția view-ului (`where … approved`) și a adăugat un index. Re-rularea e sigură.

> **Lint Supabase 0029 (21 august 2026)** — „Signed-In Users Can Execute SECURITY DEFINER Function" pe `reviews_can_rate`. Rezolvat în `supabase/fix_lints_21aug2026.sql` (funcția devine `SECURITY INVOKER`; rămâne executabilă de `authenticated` pentru că o apelează politica RLS de INSERT). `reviews_schema.sql` are deja definiția corectată, ca re-rularea lui să nu readucă warningul. Warningul „Leaked Password Protection Disabled" nu se rezolvă din SQL (doar pe planul Pro, din Dashboard).

### Cod

| Fișier | Rol |
|---|---|
| `src/lib/reviews.js` | Acces date: `fetchReviewStats`, `fetchSiteStats`, `fetchMyReview`, `fetchReviews`, `saveReview`, `deleteReview`, `adminListReviews`, `adminSetApproved`, `adminCounts`, `adminWorstTargets`, `formatAvg`. Citirile înghit erorile (fără migrare, site-ul merge ca înainte). |
| `src/components/ReviewWidget.jsx` | `StarPicker`, `RatingBadge` („★ 4,6 (23)"), `ReviewToast` (cardul de după test), `ReviewCard`, `ReviewList`, `SiteReviewForm`, `Testimonials`. |
| `src/components/ReviewsAdmin.jsx` | Panoul **Admin → ⭐ Recenzii** (tab nou în `Admin.jsx`). |
| `src/pages/Recenzii.jsx` | Pagina **/recenzii** (rută în `App.jsx`; rewrite page-meta în `vercel.json`; în `api/sitemap.js`). |

### Unde apar recenziile

- **După test** — `InteractiveViewer.jsx` (testele din site) și `ExercitiuAIViewer.jsx` (Biblioteca utilizatorilor, după ce scorul e înregistrat pe server): la 1,5 s după „Scor salvat" apare cardul „Cum ți s-a părut testul?" (stele + comentariu opțional), o singură dată per test; închis fără notă → nu mai insistă în sesiunea respectivă.
- **Pe carduri** — listele pe clase, Evaluare Națională, Bacalaureat (`ContentPage.jsx`, `ExamContent.jsx`) și Biblioteca utilizatorilor: media „★ 4,6 (23)" + butonul „💬 Părerile (7)" care desface comentariile sub card.
- **Home** — secțiunea „Ce spun elevii, părinții și profesorii" (`Testimonials`), între „Ce găsești pe ExamenMate" și CTA-ul final: media generală + până la 6 recenzii aprobate cu text, sortate după stele. **Nu apare deloc cât timp nu există recenzii aprobate.**
- **Profil** — cardul „⭐ Părerea ta despre ExamenMate" (toate rolurile), înainte de „Setări cont": stele + text, stare (⏳ în așteptare / ✓ publicată), modificare, ștergere.
- **/recenzii** — media generală, formularul (`#formular`), lista recenziilor publicate. Linkuri: Footer → Informații, Navbar → „Mai multe" și meniul de mobil, butoanele din secțiunea de pe Home.
- **Admin → ⭐ Recenzii** — rezumat (total, în așteptare, publicate, teste cu media ≤ 2,5), **coada de corecturi** (testele cu notele cele mai slabe, cu „Deschide" → `/exercitiu?id=…` și „Vezi recenziile"), lista tuturor recenziilor cu filtre (tip / ≤ 2 stele / stare) și acțiuni: **Aprobă / Retrage** (site), **Șterge** (oricare), **Deschide** testul.

## 3. Tranșa 3 — email automat, JSON-LD, răspunsul echipei

### A. Emailul automat „Ce părere ai despre ExamenMate?"

| Fișier | Rol |
|---|---|
| `supabase/reviews_v2.sql` | `profiles.review_invite_sent_at` (o invitație per cont), `profiles.subscription_started_at` (abonații existenți primesc `now()` → invitația peste 7 zile, nu toți deodată), funcția `review_invite_candidates(p_limit)` (SECURITY DEFINER, executabilă **doar de service_role** — nu apare la lintul 0029). |
| `api/review-invite.js` | `GET ?action=run` (cron, `Authorization: Bearer CRON_SECRET`) și `POST {action:'preview'|'run'}` (admin). Șablonul folosește `mailer.template` (brandul site-ului), personalizare pe prenume / rol / motiv („Ai rezolvat deja 4 teste…", „Folosești Premium de o săptămână"), buton → `/recenzii#formular`, link de dezabonare (același ca la newsletter: `newsletter_opt_in = false` oprește și invitațiile). |
| `api/stripe-webhook.js` | La `checkout.session.completed` setează `subscription_started_at` (tolerant: dacă SQL-ul nu e rulat, reia fără coloană — webhookul nu pică). |
| `vercel.json` | Cron nou: `/api/review-invite?action=run` zilnic la 15:30 UTC (18:30 ora României). Lot: `REVIEW_INVITE_BATCH` (implicit 80) — sub limita SMTP Gmail. |
| Admin → ⭐ Recenzii → „✉️ Invitații la recenzie" | Câți sunt eligibili acum, câți au fost invitați, dacă emailul e configurat, primii din listă; „Previzualizare" (nu trimite) și „Trimite lotul acum". |

Cine primește: are email, nu a fost invitat niciodată, nu s-a dezabonat, **nu a lăsat deja o recenzie de site** și fie a rezolvat **≥ 3 teste interactive** (`progress`), fie e **abonat Premium de ≥ 7 zile**. Marcarea se face doar după trimitere reușită — un eșec se reia a doua zi.

### B. JSON-LD `AggregateRating` + conținut static pe `/recenzii`

`api/page-meta.js` are o ramură pentru `/recenzii`: citește `reviews_stats` + recenziile de site aprobate (service role, cache 60 s) și injectează (1) JSON-LD `Organization` cu `aggregateRating` (ratingValue, reviewCount, bestRating 5) și până la 5 `review` — **nimic dacă nu există recenzii aprobate** (un rating gol ar fi invalid); (2) recenziile ca HTML în `<div id="root">`, deci crawlerele și share-urile le văd fără JavaScript. Title/description au valori implicite bune; un rând în `seo_meta` pentru `/recenzii` le suprascrie (inclusiv `jsonld`, dacă vrei altceva). Reamintire: Google nu afișează, de regulă, stele în rezultate pentru recenziile găzduite de organizația însăși — valoarea e de încredere și pentru agenții AI care citesc structurat, nu rich results garantate. Teste: `test/recenzii.test.js` (`npm test`).

### C. Răspunsul echipei la o recenzie

| Fișier | Rol |
|---|---|
| `supabase/reviews_v2.sql` (și `reviews_schema.sql`, ținut sincron) | Coloanele `reviews.reply` (≤ 1000) și `reply_at`; triggerul `reviews_before_write` nu lasă utilizatorii să le scrie (la inserare le golește, la editare le păstrează), iar pentru admin pune/actualizează `reply_at` automat la schimbare. |
| `src/lib/reviews.js` | `adminSetReply(id, text)` (text gol = șterge răspunsul); filtrul `onlyUnanswered` în `adminListReviews`; citirile cad pe setul de coloane de bază dacă SQL-ul v2 nu e rulat. |
| `src/components/ReviewWidget.jsx` | `TeamReply` — blocul „Răspunsul echipei ExamenMate · data" sub comentariu, în `ReviewCard` (Home, /recenzii, părerile de sub cardurile de teste, Biblioteca) și în rezumatul propriei recenzii din Profil. |
| `src/components/ReviewsAdmin.jsx` | Pe fiecare recenzie: „💬 Răspunde ca echipa ExamenMate" → editor → Salvează / Șterge răspunsul; filtrul „doar comentarii fără răspuns". |

## 4. Pași de punere în funcțiune

1. Rulează `supabase/reviews_schema.sql` (dacă nu e la zi) și apoi `supabase/reviews_v2.sql` în Supabase → SQL Editor (ambele idempotente).
2. Verifică în Vercel că există `CRON_SECRET` (altfel toate cronurile primesc 403 — vezi `api/_lib/http.js`) și `EMAIL_USER` + `EMAIL_APP_PASSWORD` (sau Resend) — altfel invitațiile sunt sărite cu `{ skipped }`, fără să marcheze pe nimeni.
3. Deploy (git push). `vercel.json` are rewrite pentru `/recenzii` (page-meta) și cronul nou.
4. Test: dintr-un cont de elev rezolvă un test interactiv → apare cardul de notă; lasă și o recenzie de site din Profil → în Admin → ⭐ Recenzii apare „în așteptare" → Aprobă → apare pe Home și pe /recenzii; răspunde-i din Admin → răspunsul apare sub recenzie și în Profilul utilizatorului. În Admin → „Invitații la recenzie" → Previzualizare arată cine ar primi emailul; pentru un test real, creează un cont de probă care a rezolvat 3 teste.

## 5. Idei pentru mai târziu

- Notificare pe email către utilizator când echipa îi răspunde la recenzie (răspunsul se scrie acum direct din client, prin Supabase — ar fi nevoie de un endpoint sau de un trigger `pg_net`).
- Un al doilea reminder (o singură dată, după 30 de zile) pentru cei care nu au lăsat recenzia după invitație.
