# Ghid — mențiunea modelelor AI și recenziile cu stele (tranșa 1)

Data: 21 august 2026

## 1. Ce s-a adăugat

### A. Modelele AI — un singur loc de adevăr

| Fișier | Rol |
|---|---|
| `src/lib/aiModels.js` → `AI_STACK`, `AI_STACK_SCURT` | **Aici schimbi numele modelelor.** Două grupuri: `clienti` (OpenAI — GPT-4o mini, GPT-5.6 Terra, GPT-5.6 Sol) și `intern` (Anthropic — Claude Opus 5, Claude Fable 5, *doar unelte administrative interne*). |
| `src/components/AIPoweredBy.jsx` | Componenta care afișează mențiunea. Variante: `inline`, `chips`, `footer`, `disclaimer`. Toate duc la `/faq#ai`. |

Unde apare:

- **Footer** (toate paginile) — bloc „Tehnologie AI": utilizatori → OpenAI; unelte interne → Anthropic; link „Cum folosim AI-ul →".
- **Home** — sub titlul secțiunii „Învață cu Profesorul Virtual (AI)": pastile cu modelele (OpenAI + interne Anthropic).
- **/profesor-virtual** — sub subtitlul din hero: pastile cu modelele OpenAI (cele pe care le folosește efectiv utilizatorul).
- **Chatul Profesorului Virtual** (`AITutor.jsx`, sub câmpul de scris, inclusiv în widgetul plutitor și lângă exerciții): „Răspunsuri generate cu OpenAI GPT-4o mini · GPT-5.6 Terra · GPT-5.6 Sol. AI-ul poate greși — verifică rezultatele importante."
- **/preturi** — în lista Premium („Prof. Virtual (OpenAI GPT-4o mini, GPT-5.6 Terra, GPT-5.6 Sol)") + o linie sub „Conținut gratuit".
- **/despre-noi** — paragraf nou în „Misiunea noastră" (clienți → OpenAI, intern → Claude, fără date personale).
- **/faq#ai** — categorie nouă „Profesorul Virtual (AI)" (prima din pagină), cu 4 întrebări: ce modele folosim, ce se întâmplă cu datele trimise, dacă AI-ul poate greși, dacă se poate încerca fără abonament. Linkul cu `#ai` deschide automat întrebările și derulează la ele.

Mesajul este consecvent cu Politica de Confidențialitate (§7–8) și Termenii (§7, §9), care spun deja că OpenAI procesează datele utilizatorilor, iar Anthropic e folosit doar pentru conținut educațional și unelte interne, fără date personale. **Nu a fost nevoie de modificări la paginile legale.**

> Atenție la sincronizare: `AI_STACK` nu citește env-ul din Vercel. Dacă schimbi `AI_CHAT_MODEL`, `AI_PDF_CHAT_MODEL`, `AI_GEN_CHAT_MODEL` sau `CLAUDE_MODEL`, actualizează și `AI_STACK`. Rolurile Terra/Sol din `descriere` sunt formulate generic („sarcinile care cer precizie maximă") — ajustează textul dacă vrei să spui exact ce face fiecare.

### B. Recenzii cu stele + comentariu

| Fișier | Rol |
|---|---|
| `supabase/reviews_schema.sql` | **Trebuie rulat o dată** în Supabase → SQL Editor (idempotent). Creează tabelul `reviews`, funcția `reviews_can_rate`, triggerul `reviews_before_write`, politicile RLS și view-ul `reviews_stats`. |
| `src/lib/reviews.js` | `fetchReviewStats`, `fetchMyReview`, `saveReview`, `formatAvg`. Citirile înghit erorile (dacă migrarea nu e rulată, site-ul merge ca înainte, fără stele). |
| `src/components/ReviewWidget.jsx` | `StarPicker` (stelele), `RatingBadge` („★ 4,6 (23)"), `ReviewToast` (cardul de după test). |
| `src/pages/InteractiveViewer.jsx` | La 1,5 s după „✓ Scor salvat" apare cardul „Cum ți s-a părut testul?" (stânga-sus; insignele rămân dreapta-sus). O singură dată per test; dacă elevul îl închide fără notă, nu mai insistăm în sesiunea respectivă. Nota se poate schimba ulterior (cardul arată nota existentă). |
| `src/components/ContentPage.jsx`, `src/components/ExamContent.jsx` | Cardurile din listele pe clase / Evaluare Națională / Bacalaureat afișează media „★ 4,6 (23)" (vizibilă și nelogat). |

Reguli impuse în baza de date (nu doar în UI):

- poate nota **doar cine a rezolvat testul** (există rândul lui în `progress`) — `reviews_can_rate` + politica de INSERT;
- **o singură notă per (utilizator, test)** — constrângere UNIQUE; a doua trimitere actualizează nota;
- utilizatorul își poate schimba doar stelele și comentariul (triggerul blochează schimbarea `user_id` / `target_id` / `approved`);
- recenziile rămân după ștergerea contului (snapshot `author_name`, `author_role`; FK `ON DELETE SET NULL` — același tipar ca `pastreaza_date_publice.sql`);
- tipurile de țintă: `content` (teste din site — activ acum), `public_item` (Biblioteca utilizatorilor — pregătit, neafișat încă), `site` (păreri generale — apar public doar după `approved = true`, setat de admin).

## 2. Pași de punere în funcțiune

1. Rulează `supabase/reviews_schema.sql` în Supabase → SQL Editor.
2. Deploy (git push). Fără pasul 1, site-ul merge normal, doar că nu apar stele, iar trimiterea unei note afișează „Recenziile nu sunt activate încă".
3. Test: dintr-un cont de elev rezolvă un test interactiv → după „✓ Scor salvat" apare cardul; nota apare pe cardul testului în lista clasei. Dintr-un cont care NU a rezolvat testul, inserarea e respinsă de RLS.

## 3. Ce rămâne pentru tranșa 2

- Panou în Admin: lista recenziilor (filtru după stele — testele cu 1–2 stele sunt coada de corecturi), aprobare pentru cele „site", ștergere.
- Secțiune „Ce spun elevii, părinții și profesorii" pe Home + formular în Profil + pagina `/recenzii` (target `site`).
- Stele în Biblioteca utilizatorilor (`ExercitiuAIViewer.jsx` după `MATE_SCORE`, `target_type = 'public_item'`) și media pe cardurile din `BibliotecaUtilizatorilor.jsx`.
- Afișarea comentariilor sub card („Vezi părerile (7)").
