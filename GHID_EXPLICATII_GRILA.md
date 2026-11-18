# Ghid: „💡 Explicații la grilă" — baremele de Evaluare Națională (18 nov. 2026)

Cererea: „Pune barem cu explicații pt grila la evaluare națională. Baremul oficial oferă doar
rezolvarea grilei fără explicații. În baremul oficial pune buton pentru explicații la grilă.
Explicația la grilă o să fie generată ulterior și încărcată."

---

## Instalare (o singură dată)

**Supabase → SQL Editor → New Query** → rulează `supabase/explicatii_grila.sql` (idempotent).
Creează tabela `barem_explicatii` (un PDF de explicații pe barem) cu RLS și GRANT-urile cerute
de `CLAUDE.md` — `authenticated` + `service_role`, **fără `anon`**; scrie și citește doar
serverul (politica `barem_explicatii_service`). Fără script, butonul nu apare la elevi, iar
Admin → 💡 Explicații grilă spune ce e de rulat.

## Cum se încarcă explicațiile

**Admin → 💡 Explicații grilă**: lista baremelor de EN (rubrica „Bareme", titlul sau numele
fișierului cu „barem"), cu căutare și filtrul „— Fără explicații / ✅ Cu explicații".
Pe fiecare rând:
- **⬆ Încarcă PDF** (sau **🔁 Înlocuiește PDF**) — PDF-ul urcă în Storage, în bucket-ul
  **privat** `content-files`, la `pdf/evaluare-nationala/…_explicatii-grila_….pdf`; serverul
  verifică locul și îl leagă de barem (cel vechi se șterge la înlocuire);
- **👁 Deschide** — PDF-ul încărcat, într-un tab nou (link semnat, 5 minute);
- **🗑** — scoate explicațiile (și fișierul);
- **📋 Baremul** — deschide baremul în vizualizator, ca să vezi butonul.

## Ce vede elevul

În vizualizatorul PDF, cât se vede un barem de EN — baremul deschis cu **„📋 Barem"** (butonul
e în antetul verde al baremului), baremul inclus în același PDF sau baremul deschis direct
(butonul e în bara de sus) — apare **„💡 Explicații la grilă"**, doar dacă explicațiile au fost
încărcate. Clic → PDF-ul explicațiilor peste vizualizator; **✕ Înapoi la barem** sau Esc îl închide.

Accesul e ca la barem: barem gratuit → oricine; barem Premium → abonații și adminii (altfel:
„fac parte din abonament" + „Vezi abonamentele").

Adminul vede butonul și când explicațiile lipsesc: **„💡 Explicații la grilă · lipsesc"** →
Admin → 💡 Explicații grilă.

Cheia explicațiilor e **baremul** (`content.id`): baremul separat sau, la „subiecte + barem" în
același PDF, chiar subiectul.

## Fișierele

- `supabase/explicatii_grila.sql` — tabela;
- `api/_lib/explicatiiGrila.js` — starea, linkul semnat (regulile baremului), încărcarea, lista;
- `api/bareme.js` — acțiunile `explicatii`, `explicatii_url` (și fără cont) și, doar admin,
  `explicatii_lista`, `explicatii_salveaza`, `explicatii_sterge`;
- `src/components/ExplicatiiGrila.jsx` — butonul și fereastra; `src/pages/PDFViewer.jsx`;
- `src/components/AdminExplicatiiGrila.jsx` — fila din Admin;
- teste: `test/explicatii-grila.test.js`.

## Verificare rapidă (SQL Editor)

```sql
select e.barem_id, c.title, e.titlu, e.updated_at
  from public.barem_explicatii e join public.content c on c.id = e.barem_id
 order by e.updated_at desc;
```
