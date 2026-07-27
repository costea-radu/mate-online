# Ghid: conturi inactive (avertizare + ștergere automată)

## Ce face sistemul

| Moment | Ce se întâmplă |
|---|---|
| **12 luni** fără autentificare | Contul primește un **e-mail de avertizare**: „autentifică-te în 30 de zile, altfel contul se șterge". Ștergerea este programată la +30 de zile. |
| Cu **7 zile** înainte de termen | O **ultimă reamintire** pe e-mail. |
| **Orice autentificare** între timp | Ștergerea se **anulează automat** (aplicația actualizează `last_active_at` și golește câmpurile `deletion_*`). |
| Termenul **expiră** | Contul este **șters definitiv** (auth + toate datele, prin CASCADE). |
| Elev șters | **Rezultatele lui rămân la profesor/părinte**: apar în continuare în dashboard, marcate „cont șters", cu rezultate, stăpânirea subiectelor și temele din arhivă. Mentorul le poate **șterge definitiv** cu un buton. |

**Nu se șterg niciodată automat:** adminii (`is_admin`) și abonații premium activi (`subscription_status = 'active'`).

Ștergerea **manuală** a contului (Contul meu → Setări, sau pagina de profil) trece acum prin același mecanism: rezultatele elevului se arhivează la mentori înainte de ștergere (motiv: „la cererea lui").

## Instalare (2 pași)

1. **SQL** — rulează `supabase/inactive_accounts.sql` în Supabase → SQL Editor → Run.
   - Adaugă pe `profiles`: `last_active_at` (cu backfill din ultima autentificare reală din `auth.users`), `deletion_warned_at`, `deletion_reminded_at`, `deletion_scheduled_at`.
   - Creează tabela `archived_student_results` (arhiva elevilor șterși, un rând per mentor+elev, RLS închis — acces doar prin server).
2. **Deploy** — `git push` / deploy pe Vercel. Cron-ul nou este deja în `vercel.json`:
   `GET /api/account-cleanup?action=run` — zilnic la **06:00 UTC** (09:00 România vara).

Nu sunt necesare variabile de mediu noi — se refolosesc `EMAIL_USER` + `EMAIL_APP_PASSWORD` (sau Resend) pentru e-mailuri și `AI_CRON_SECRET` pentru rularea manuală.

> **Important:** fără e-mail configurat, sistemul **nu programează ștergeri** (nu ștergem pe nimeni neavertizat). Avertizările eșuate se reîncearcă a doua zi.

## Fișierele modificate / noi

- `supabase/inactive_accounts.sql` — **nou**: coloane + tabela de arhivă.
- `api/_lib/inactivity.js` — **nou**: regulile (praguri, predicate), șabloanele de e-mail, construirea snapshotului și arhivarea la mentori.
- `api/account-cleanup.js` — **nou**: endpointul rulat de cron (reactivare → avertizare → reamintire → ștergere cu arhivare → rezumat către admin).
- `vercel.json` — cron nou zilnic.
- `api/teacher-students.js` — răspunsul include și `archived` (elevii șterși ai mentorului).
- `api/teacher-manage.js` — acțiune nouă `delete_archived` (mentorul își șterge definitiv arhiva unui elev).
- `src/components/TeacherResults.jsx` — elevii șterși apar în aceeași listă cu badge roșu „cont șters · data", cu rezultatele, stăpânirea subiectelor și temele din arhivă + butonul „Șterge definitiv datele". Sunt excluși din clasament și din grupe.
- `src/context/AuthContext.jsx` — „ping de activitate": la fiecare sesiune (max. o dată la 12h/dispozitiv) se actualizează `last_active_at` și se anulează orice ștergere programată.
- `api/ai-account.js` + `src/pages/Profile.jsx` — ștergerea manuală arhivează întâi rezultatele (Profile folosește acum API-ul, nu RPC-ul vechi).
- `test/inactivity.test.js` — **nou**: 20 de teste pentru reguli și e-mailuri (`node --test test/inactivity.test.js`).

## Cum testezi fără riscuri

1. **Dry-run** (numără, nu modifică nimic):
   `https://examenmate.com/api/account-cleanup?action=run&secret=VALOAREA_AI_CRON_SECRET&dry=1`
   Răspuns: `{ reactivated, warned, reminded, deleted, archivedFor, ... }`.
2. **Test pe un cont real de probă** — în SQL Editor, simulează un cont inactiv:
   ```sql
   UPDATE public.profiles SET last_active_at = NOW() - INTERVAL '13 months'
   WHERE email = 'cont-de-test@exemplu.ro';
   ```
   Apoi rulează URL-ul fără `dry=1` → contul primește e-mailul de avertizare și `deletion_scheduled_at` la +30 zile. Ca să sari direct la ștergere:
   ```sql
   UPDATE public.profiles
   SET deletion_warned_at = NOW() - INTERVAL '31 days',
       deletion_scheduled_at = NOW() - INTERVAL '1 day'
   WHERE email = 'cont-de-test@exemplu.ro';
   ```
   La următoarea rulare contul e șters, iar la profesorul asociat apare intrarea „cont șters" cu rezultatele păstrate.
3. **Rulare manuală ca admin**: `POST /api/account-cleanup` cu tokenul de admin (fără secret).

## Detalii de funcționare

- **Loturi zilnice**: max. 80 avertizări + 80 reamintiri + 40 ștergeri per rulare (limita Gmail ~500 e-mailuri/zi). Restul se procesează în zilele următoare.
- **Siguranță dublă la ștergere**: contul trebuie să aibă avertizarea trimisă cu cel puțin 29 de zile în urmă; conturile devenite admin/premium sau reactivate între timp sunt scoase din listă chiar și în ziua ștergerii.
- **Rezumat pentru admin**: după fiecare rulare cu acțiuni, `ADMIN_EMAIL` primește un e-mail cu cifrele (avertizate / reamintite / șterse / arhivate / eșuate).
- **Arhiva** se scrie o singură dată per (mentor, elev) — rulările repetate suprascriu, nu duplică. Dacă ștergerea din auth pică, arhiva rămâne și ștergerea se reîncearcă a doua zi.
- **GDPR**: e recomandat să menționezi în Politica de confidențialitate păstrarea datelor 12 luni de la ultima activitate + faptul că rezultatele elevilor asociați rămân la mentor după ștergerea contului (e-mailul de avertizare le spune deja elevilor acest lucru).
