# Ghid — mențiunea modelelor AI și recenziile cu stele

Data: 21 august 2026 (tranșa 1 + tranșa 2)

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

## 3. Pași de punere în funcțiune

1. Rulează (sau re-rulează) `supabase/reviews_schema.sql` în Supabase → SQL Editor.
2. Deploy (git push). `vercel.json` are rewrite nou pentru `/recenzii` (page-meta); poți adăuga un rând în `seo_meta` pentru `/recenzii` (title/description) din agentul SEO.
3. Test: dintr-un cont de elev rezolvă un test interactiv → apare cardul de notă; lasă și o recenzie de site din Profil → în Admin → ⭐ Recenzii apare „în așteptare" → Aprobă → apare pe Home și pe /recenzii.

## 4. Idei pentru mai târziu

- Email automat „Ce părere ai despre ExamenMate?" după al 3-lea test rezolvat sau la 7 zile după abonare (prin `api/_lib/mailer.js`).
- JSON-LD `AggregateRating` pe `/recenzii` din `seo_meta.jsonld` (Google nu afișează, de regulă, stele pentru recenziile proprii ale unei organizații — valoarea e de încredere, nu de SEO).
- Răspunsul echipei la o recenzie (coloană `reply` + afișare sub comentariu).
