# Raport de debug — ExamenMate (actualizat)

*Actualizat: 15 august 2026. Toate problemele găsite au fost rezolvate în cod sau tratate ca decizie de produs. Build ✓ · 161/161 teste ✓.*

## Legendă stare
- ✅ **Rezolvat** — fix aplicat în cod, verificat (build + teste).
- ⚙️ **Necesită pas manual** — codul e gata, dar trebuie și o acțiune în Supabase/Vercel.
- 🔵 **Decizie** — analizat, lăsat intenționat cum e.

---

## 🔴 Critice

**#1 — Bypass autentificare cron** ✅ ⚙️
`api/_lib/http.js` — eliminat fallback-ul spoofabil (user-agent / x-vercel-cron). Cronul se autentifică doar cu secretul. **Pas manual:** setează `CRON_SECRET` în Vercel (Production) înainte de deploy, altfel cronurile dau 403.

**#2 — Bypass paywall la preview** ✅
`api/get-preview-url.js` + `src/components/ContentPage.jsx` — endpoint-ul extrage DOAR pagina 1 pe server (pdf-lib) și cere autentificare; fișierul complet nu mai iese din backend.

**#3 — RLS: orice user autentificat putea insera/șterge tot conținutul** ⚙️
`supabase/fix_content_write_admin_only.sql` — politici INSERT/UPDATE/DELETE gate pe `is_admin`. **Pas manual:** rulează SQL-ul în Supabase.

---

## 🟠 Majore

**#4 — Leak răspunsuri/soluții bibliotecă premium** ⚙️
`supabase/fix_public_library_payload_leak.sql` — revoc SELECT pe coloana `payload` de la anon/authenticated (restul coloanelor rămân). **Pas manual:** rulează SQL-ul.

**#5 — Costul AI al generărilor Claude se loga ca 0** ✅
`claude.js` + `exgen.js` (model pus în `usage`) + `ai.js` `logUsage` (normalizare `prompt_tokens`/`completion_tokens`/`model`) + `ai-seo-agent.js`/`seo-cron.js`. Verificat: Opus/Fable produc acum cost real.

**#6 — Alarma de cost se stingea tăcut la email eșuat** ✅
`api/_lib/costwatch.js` — verific `sendMail().ok` (nu try/catch mort) și șterg dedup-ul ca să reîncerce.

**#7 — Funcții SECURITY DEFINER apelabile de oricine** ⚙️
`supabase/fix_security_definer_revoke.sql` — REVOKE EXECUTE pe `bump_skill_mastery` și `enqueue_ingest` de la anon/authenticated. **Pas manual:** rulează SQL-ul.

**#8 — Cont șters cu arhivă goală la eroare tranzitorie** ✅
`api/_lib/inactivity.js` — nu mai înghit erorile de citire; disting „tabel inexistent" (benign) de eroare reală (aruncă → ștergerea se amână, se reîncearcă mâine).

**#9 — `coach` fără rate-limit + `classifyMistakes` cost nelogat** ✅
`api/ai-meditatii.js` + `api/_lib/meditatii.js` — `enforceRateLimit` la coach (cade elegant pe mesajul determinist) + logarea costului `classifyMistakes` prin `ctx`.

**#10 — Teme accesibile prin link** 🔵
Lăsat share-by-link (decizia ta): temele se deschid prin `/tema?id=<UUID>`, UUID-ul de 122 biți e cheia. Un check mentor↔elev ar fi rupt partajarea directă a linkului.

**#11 — Bucket `content-files` public/privat (inconsistență)** ✅ ⚙️
Cod: semnez acum TOT conținutul (gratuit + premium) prin URL-uri semnate — `get-file-url.js`, `PDFViewer.jsx`, `InteractiveViewer.jsx`, `ContentPage.jsx`, `Admin.jsx`. Merge pe orice bucket. **Pas manual (DUPĂ deploy):** rulează `supabase/fix_content_bucket_private.sql` și șterge din repo `make_content_bucket_public.sql`.

**#12 — Drift de schemă (coloane lipsă)** ⚙️
`supabase/fix_schema_drift_columns.sql` — creează `profiles.is_admin`, `content.subcategory`, `content.profile`. **Pas manual:** rulează SQL-ul (idempotent).

---

## 🟡 Minore — toate ✅

Frontend:
- `RezolvariPage.jsx` — „Deschide imaginea" deschidea popup-ul DUPĂ await → blocat. Acum fereastra se deschide sincron.
- `Profile.jsx` + `context/AuthContext.jsx` — după checkout Stripe, poll la profil până devine `active` (nu mai rămâne „Cont gratuit" din cauza webhook-ului întârziat).
- `InteractiveViewer.jsx` — deep-link `?id=` comută acum corect exercițiul (stale state reparat); scos `allow-same-origin` din iframe (exercițiile nu folosesc storage).
- `PDFViewer.jsx` + `Discussions.jsx` — blob URL-urile se revocă corect (nu se mai scurge memorie per fișier deschis).
- `main.jsx`, `ProfesorVirtual.jsx`, `AIExerciseAgent.jsx` — `sessionStorage.setItem` învelit în try/catch (Safari privat nu mai rupe generarea).
- `AIExerciseAgent.jsx` — `FileSlot` mutat la nivel de modul (nu se mai remontează inputul de fișier la fiecare render).
- `AITutor.jsx` — escape la `"` în href-ul linkurilor (injecție de atribut din text AI).

Backend / logică:
- `exgen.js` — validarea indexului răspunsului la grilă (elimină întrebările imposibil de răspuns); escape la explicație/răspuns + hardening JSON `</script>` (XSS); eroarea la insert `agent_task_runs` nu mai e ignorată; claim atomic la start (fără generare dublă cron vs. „Rulează acum").
- `src/lib/exerciseRender.js` — aceleași fixuri XSS, ținut SINCRON cu exgen.
- `meditatii.js` — `bumpStreak` pe ora României (nu UTC); `categoryFor` fallback `general` (nu „clasa-undefined").
- `social-cron.js` — claim atomic al rândului înainte de publicare (fără Reels/postări duplicate la maxDuration).
- `contact.js` — confirmarea nu mai ecouă conținutul mesajului către o adresă neverificată (vector de backscatter).
- `rezolvare-url.js` — adminul fără abonament are acum acces (consistent cu get-file-url).
- `ai.js` — `signToken`/`verifyToken` onorează un `exp` opțional (mecanism de expirare, backward-compatible).

Config:
- `vite.config.js` — `/sitemap.xml` adăugat în `navigateFallbackDenylist`.
- `.env.ai.example` — completat cu variabilele obligatorii lipsă (Supabase, ANTHROPIC_API_KEY, CRON_SECRET, Stripe, email, SEO, YouTube).

---

## ⚙️ Pași manuali de făcut (recapitulare)

**În Vercel:**
- Setează `CRON_SECRET` (Production) — înainte de deploy.

**În Supabase → SQL Editor (rulează aceste fișiere):**
1. `fix_content_write_admin_only.sql` (#3)
2. `fix_public_library_payload_leak.sql` (#4)
3. `fix_security_definer_revoke.sql` (#7)
4. `fix_schema_drift_columns.sql` (#12)
5. `fix_content_bucket_private.sql` (#11) — **doar DUPĂ deploy-ul codului**; apoi `git rm supabase/make_content_bucket_public.sql`.

**Flux recomandat:** setează `CRON_SECRET` → commit + push + deploy → rulează SQL-urile 1–5 (bucket-ul ultimul) → șterge scriptul public.

---

## Verificare
`npm run build` ✓ · `node --test test/*.test.js` → 161/161 ✓ · verificări funcționale punctuale pe: normalizarea costului AI, extragerea paginii 1, hardening-ul XSS și validarea răspunsului la grilă.
