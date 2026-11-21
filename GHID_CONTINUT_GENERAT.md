# 🤖 Ghid: conținutul generat (skill-ul „examenmate-continut")

Task-urile programate (Claude, cu skill-ul `examenmate-continut`) produc conținut nou pentru site:

| # | Procedura | Ce apare pe site |
|---|---|---|
| 1 | Barem pentru un PDF fără barem | baremul în rubrica „Bareme”, legat de PDF |
| 2 | Test interactiv pentru un PDF | testul interactiv, asociat cu PDF-ul („🧩 Deschide interactiv”) |
| 3 | Fișă după un fișier model | PDF-ul la clasa și capitolul din eticheta modelului, cu baremul lui |
| 4 | Variantă de Evaluare Națională | PDF-ul în „Variante generate cu AI”, cu baremul lui |
| 5 | Explicații la grila EN | butonul „💡 Explicații la grilă” din baremul oficial |
| 6 | Verificarea unui test interactiv | testul cu rezolvările refăcute după barem (originalul rămâne copie) |

**Ce trece verificarea după barem se publică direct.** Ce nu trece toate verificările (sau e nesigur) intră ca **ciornă** în Admin → **🤖 Conținut generat** și apare pe site doar după „✅ Aprobă și publică”.

## Cum circulă un material

1. **Task-ul programat** (în cloud) alege golul de completat (SQL, doar citire), cere fișierele de care are nevoie și generează materialul + baremul. Din cloud nu ajunge la Supabase prin HTTP, așa că lucrează prin repo-ul **privat** `costea-radu/examenmate-continut`:
   - `cereri/…json` → Action-ul **„Aduce surse”** pune fișierele din Storage pe ramura `surse`;
   - `unitati/<data>/<procedura>-<id>/` (fișierele + `manifest.json`) → Action-ul **„Publică”**.
2. **„Publică”** (GitHub Actions, cu cheia de serviciu din secretele repo-ului) clonează `mate-online` și rulează `scripts/continut/publica.js` → `api/_lib/continutGenerat.js`:
   - verifică **starea live** (dacă între timp PDF-ul a primit barem / test / explicații → `conflict`, nu scrie nimic);
   - repetă **verificările automate** (testele HTML: JavaScript, LaTeX, KaTeX, `MATE_SCORE`; la procedura 6 compară cu fișierul vechi; la procedura 3 verifică dacă titlul ajunge la capitolul modelului) — ce nu trece coboară în ciornă;
   - urcă fișierele în Storage și scrie rândurile **exact ca site-ul** (baremul ca „✅ Încarcă bareme”, legătura cu `setOverride`, testul ca `exgen.postContent` + `asociazaPdf`);
   - notează totul în tabela `continut_generat` și pune rezultatul în `rezultate/` din repo.
3. **Tu**, în Admin → 🤖 Conținut generat: aprobi / respingi ciornele, anulezi orice a fost publicat.

## Instalare (o singură dată)

1. **Supabase** — gata (le-am aplicat pe 21 nov.); sunt idempotente, le poți rula oricând din nou în SQL Editor:
   - `supabase/continut_generat.sql` — tabela jurnalului și a ciornelor (RLS, GRANT-urile din CLAUDE.md, fără `anon`, doar serverul);
   - `supabase/notificari_fara_bareme.sql` — baremele nu mai trimit notificări elevilor.
2. **Codul site-ului**: commit + push pe `main` + deploy (Vercel). Action-urile clonează `mate-online` de pe GitHub, deci **funcționează abia după push**.
3. **Repo-ul privat** `examenmate-continut` — gata: workflow-urile `.github/workflows/publica.yml` și `aduce-surse.yml`, `CLAUDE.md` (formatul exact, pentru task-uri), `README.md`. Verifică doar secretele: Settings → Secrets and variables → Actions → `SUPABASE_URL` (`https://<id>.supabase.co`, fără `/rest/v1`) și `SUPABASE_SERVICE_ROLE_KEY`.
4. **Probă**: repo-ul privat → Actions → „Publică” → **Run workflow** → în jurnal: „Nicio unitate nouă.” (la fel „Aduce surse” → „Nicio cerere nouă.”).

## Admin → 🤖 Conținut generat

- **📝 Ciorne** — de ce e ciornă (motivul), verificările, „👁 Fișierele” (linkuri semnate, 10 minute), **✅ Aprobă și publică** (verifică din nou starea live; dacă între timp golul s-a completat, nu publică) și **✕ Respinge** (fișierele se șterg).
- **✅ Publicate** — publicate direct sau aprobate de tine; „🌐 pe site” deschide materialul; **↩ Anulează**:
  - barem (1) → baremul dispare, PDF-ul revine la potrivirea automată;
  - test interactiv (2) → testul dispare, PDF-ul rămâne fără test;
  - fișă (3) / variantă (4) → PDF-ul și baremul lui dispar; la fișă, modelul revine „neprocesat”;
  - explicații (5) → butonul dispare din barem;
  - test corectat (6) → revine fișierul vechi (doar dacă testul n-a fost schimbat între timp).
- **⚠️ Probleme** — eșuate (cu eroarea) și conflicte; **🔍 Verificate** — testele găsite în regulă (procedura 6) și rulările fără nimic de făcut; **🗄 Respinse / anulate**.

## Legăturile „claude-skill”

Baremele legate de skill au `ai_pdf_text.barem_override_by = 'claude-skill'`:
- în vizualizatorul PDF: „barem generat automat (Claude), verificat după barem”;
- la clase (fila „📋 Bareme”): „✨ generat automat (Claude), verificat după barem”;
- botul de examene le vede ca legături confirmate („generat de skill-ul de conținut”) și nu le schimbă; se desfac din 🤖 Conținut generat → ↩ Anulează.

## Notificările

De pe 21 nov. 2026, baremele (rubrica „Bareme” sau un titlu cu „barem”) **nu mai trimit notificări** elevilor — nici cele încărcate din Admin, nici cele ale botului sau ale skill-ului. Materialele noi (fișe, variante, teste) — ca înainte.

## Probleme frecvente

| Simptom | Cauză / soluție |
|---|---|
| Fila arată „Tabela conținutului generat lipsește” | rulează `supabase/continut_generat.sql` |
| Action-ul „Publică” eșuează cu „Cannot find module …/scripts/continut/publica.js” | codul nu e încă pe GitHub — commit + push în `mate-online` |
| „Lipsesc secretele SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY” | adaugă-le în repo-ul privat (Settings → Secrets and variables → Actions) |
| O unitate rămâne „conflict” | între timp golul a fost completat (alt barem, alt test, modelul procesat) — nu s-a scris nimic, e corect |
| Ciornă cu „Verificările automate de la publicare: …” | Action-ul a găsit o problemă pe care rularea n-a prins-o — vezi fișierul, aprobă sau respinge |
| „Aprobă” spune „Nu se poate publica: …” | starea s-a schimbat de când a intrat ciorna — de regulă o respingi |

## Fișierele

`api/_lib/continutGenerat.js` (publicare, ciornă, aprobare, respingere, anulare, verificări), `api/continut-generat.js` (Admin), `src/components/AdminContinutGenerat.jsx` (fila), `scripts/continut/publica.js` și `scripts/continut/aduce-surse.js` (Action-urile), `api/ai-pdf-context.js` (`setOverride`: `claude-skill`, `doarDacaLiber`), `supabase/continut_generat.sql`, `supabase/notificari_fara_bareme.sql`. Teste: `test/continut-generat.test.js`.
