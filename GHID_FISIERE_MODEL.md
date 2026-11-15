# 📤 Fișiere model (Admin) — 15 nov. 2026

> Creează o filă nouă în Admin, „📤 Fișiere model", unde pot încărca poze, PDF sau Word cu
> exerciții-model (…) Fișierele model NU se publică nicăieri automat — sunt doar sursă
> pentru task-uri programate ulterioare. Nu modifici nimic din Biblioteca utilizatorilor.

## Instalare (o singură dată)

Supabase → SQL Editor → New Query → `supabase/fisiere_model.sql` → Run. Tabela
`admin_model_files` are RLS și GRANT-urile cerute de `CLAUDE.md` (fără anon — datele nu sunt
publice); singura politică e a rolului de serviciu: totul trece prin `api/fisiere-model.js`,
doar pentru administratori. Fără tabelă, fila spune ce trebuie rulat.

Fișierele stau în bucketul **privat** `personal-pdfs`, în folderul adminului
(`<id admin>/fisiere-model/<timp>_<cod>.pdf`) — politicile existente ale bucketului
(fiecare cont scrie doar în folderul lui); fără bucket nou.

## Cum merge

1. Admin → **📤 Fișiere model** → trage un PDF, un Word (.docx) sau poze (până la 20).
2. Conversia e cea de la „📤 Încarcă material" (`src/lib/materialPdf.js`): PDF-ul rămâne cum
   e; Word-ul și pozele devin PDF **în browser**. Textul: la Word, din document, cu formulele
   ca LaTeX (`src/lib/mathmlTex.js`); la poze, transcris de modelul de vedere
   (`api/ai-public.js` → `transcribe`, aceeași cotă ca la profesori); la PDF, extras pe server
   (pdf-parse). PDF scanat → „fără text".
3. Etichetele: **clasa** (a V-a … a XII-a) **sau examenul** (EN / BAC + profil),
   **capitolul / tema** (text liber, cu capitolele site-ului propuse — aceleași ca pe harta
   pregătirii, `api/_lib/capitoleHarta.js`; capitolul recunoscut se păstrează în
   `capitol_id`, ex. `c6-intregi`, ca task-urile să găsească singure clasa / poziția de
   examen), **tipul** (grilă / redactare / mixt), opțional **exercițiul de examen**
   ilustrat („EN Subiectul I exercițiul 3", în `examen_asociat`).
4. Lista: filtre (clasă / examen, capitol, stare), **👁 PDF** (link semnat, 10 minute),
   **✏️ Etichete**, **✓ Procesat / ↺ Neprocesat**, **🗑 Șterge** (rândul și PDF-ul).

Starea `neprocesat` → `procesat` o schimbă task-ul programat care folosește fișierul
(`processed_at`, `processed_by` = numele task-ului); din Admin se poate pune la loc pe
„neprocesat", ca să fie folosit din nou.

## Pentru task-urile programate (promptul 2)

```sql
select id, titlu, clasa, examen, profil, capitol, capitol_id, tip_exercitiu,
       examen_asociat, text, file_path, bucket
from public.admin_model_files
where status = 'neprocesat'
order by uploaded_at;
-- după folosire:
update public.admin_model_files
set status = 'procesat', processed_at = now(), processed_by = '<numele task-ului>'
where id = '<id>';
```

PDF-ul: `supabase.storage.from(bucket).download(file_path)` (rolul de serviciu).

## Fișiere

- `supabase/fisiere_model.sql` — tabela + RLS + GRANT + politica
- `api/fisiere-model.js` — `lista`, `salveaza`, `actualizeaza`, `sterge`, `url`, `text`
- `src/components/AdminFisiereModel.jsx` — fila; `src/pages/Admin.jsx` — intrarea în meniu
- Teste: `test/fisiere-model.test.js`
- Biblioteca utilizatorilor (`IncarcaMaterial.jsx`, `api/ai-public.js`) — neschimbată.
