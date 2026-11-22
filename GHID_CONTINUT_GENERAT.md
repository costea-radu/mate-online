# 🤖 Ghid: conținutul generat (skill-ul „examenmate-continut")

Task-urile programate (Claude, cu skill-ul `examenmate-continut`) produc conținut nou pentru site:

| # | Procedura | Ce apare pe site |
|---|---|---|
| 1 | Barem pentru un PDF fără barem | baremul în rubrica „Bareme”, legat de PDF |
| 2 | Test interactiv pentru un PDF | testul interactiv, asociat cu PDF-ul („🧩 Deschide interactiv”) |
| 3 | Fișă după un fișier model | PDF-ul la clasa și capitolul din eticheta modelului, cu baremul lui |
| 4 | Variantă de Evaluare Națională | PDF-ul în „Variante generate cu AI” (coperta cu datele candidatului și tabelele de note, chenarele itemilor, caroiajul), cu varianta „⬜ Fără suprafață neagră”, baremul și testul interactiv asociat |
| 5 | Explicații la grila EN | butonul „💡 Explicații la grilă” din baremul oficial |
| 6 | Verificarea unui test interactiv | testul cu rezolvările refăcute după barem (originalul rămâne copie) |
| 7 | Lecție live cu Prof. Tudor | lecția subiectului în 🎥 Meditații live (1-la-1, ședințele de grup, Pregătirea de examen) — explicația pe barem cu punctajele pe tablă, întrebările pe ecran |

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
  - fișă (3) / variantă (4) → PDF-ul și baremul lui dispar (la variantă și copia fără dreptunghi și testul interactiv); la fișă, modelul revine „neprocesat”;
  - explicații (5) → butonul dispare din barem;
  - test corectat (6) → revine fișierul vechi (doar dacă testul n-a fost schimbat între timp);
  - variantă regenerată (4, cu `sursa.content_id`) → revine fișierul vechi al variantei (și copia albă de dinainte; testul interactiv nou dispare);
  - lecție live (7) → lecția dispare (rândul gol „nou” revine cum era), doar cât n-are vocea generată; cu voce, o ștergi din Admin → 🎥 Meditații live.
- **⚠️ Probleme** — eșuate (cu eroarea) și conflicte; **🔍 Verificate** — testele găsite în regulă (procedura 6) și rulările fără nimic de făcut; **🗄 Respinse / anulate**.

## Variantele EN generate (procedura 4)

Fiecare variantă are aceeași așezare ca subiectele oficiale: coperta (datele candidatului, tabelul asistenților, tabelele de note A/B/C ale comisiilor de evaluare), pagina 2 cu dreptunghiul negru și instrucțiunile, itemii în chenare cu punctajul în stânga, caroiajul de la Subiectul al III-lea și pagina finală cu caroiaj. Antetul e al ExamenMate, nu al Ministerului (e o variantă de antrenament, generată cu AI). Șablonul LaTeX: `sabloane/en-varianta.sty` în repo-ul privat.

- **⬛ / ⬜**: se generează două PDF-uri din aceeași sursă — cu dreptunghiul negru și fără el. Copia fără dreptunghi devine varianta „⬜ Fără suprafață neagră” din vizualizator, exact ca la variantele oficiale (aceeași stare `pagina2:<id>` ca botul; `variante-ai` e acum printre rubricile botului).
- **🧩 Testul interactiv** al variantei apare la „Teste interactive” și se deschide din variantă cu „🧩 Deschide interactiv”.
- Fără copia albă sau fără test interactiv, varianta intră ca ciornă.
- **Regenerarea unei variante deja publicate** (22 nov. 2026): manifestul are `sursa.content_id` = varianta și `material.file_url_vechi` = fișierul ei de acum. Fișierul nou intră **în același rând** (id-ul, titlul, baremul legat, notificările și progresul elevilor rămân), copia albă și testul interactiv se adaugă; baremul se înlocuiește doar dacă unitatea aduce unul. Dacă între timp fișierul variantei s-a schimbat, nu se scrie nimic (`conflict`). Așa au fost refăcute Varianta AI 1 și 2 în așezarea nouă, cu aceleași exerciții (pe copertă: „Testul nr. 1 / 2”).

## Lecțiile live cu Prof. Tudor (procedura 7)

Cererea (22 nov. 2026): „fă o procedură nouă la skill prin care generezi lecțiile live cu profesorul virtual Tudor; respecți aceleași reguli de generare, să prezinte baremul și cu rezolvare interactivă pe ecran”.

- **Ce face**: pentru un subiect de EN / BAC (Mate-Info, Științele Naturii, Tehnologic) **cu barem citit** și **fără lecție live**, task-ul scrie lecția — aceeași pe care pe site o scrie Claude Opus 5.5 când intră primul elev, dar **fără costul API** și fără ca elevul să aștepte 4–8 minute.
- **Aceleași reguli**: cererea `{ "lectie_pentru": "<id subiect>" }` din „Aduce surse” pune pe ramura `surse` (`<id>/lectie/reguli.md`, `brief.json`, `meta.json`) **exact** instrucțiunile, cererile pe bucăți (cu secțiunile subiectului și ale baremului) și schema după care scrie modelul de pe site (`liveLesson.skillBrief` — se schimbă singure când schimbi regulile lecțiilor). Task-ul citește și PDF-urile subiectului și baremului (formulele din pagini).
- **Ce conține lecția**: la fiecare item — enunțul, „încercați singuri” (întrebarea pe ecran), explicația **pe barem**, pas cu pas, cu punctajele pe tablă („(2p)”), explicațiile pentru „🔁 Explică altfel”, iar la Subiectele II–III **întrebările pe pași** (cel puțin una la fiecare subpunct, înaintea explicației lui).
- **Verificarea la publicare** (`liveLesson.scriptFromItems`, aceleași funcții ca la lecțiile scrise de model): literele grilelor din tabelul baremului, „Arătați că…”, întrebările valide, **toți itemii subiectului**, formulele care se afișează, apoi **botul de verificare a lecțiilor** (întrebări la fiecare exercițiu și subpunct, cronologia). Ce nu trece → ciornă, cu motivul; o lecție cu itemi lipsă sau subpuncte fără întrebare nu ajunge direct la elevi.
- **Pe site**: lecția intră în `live_lessons` cu starea „script” (ca o lecție scrisă „doar textul”); **vocea și desenele din PDF le face site-ul la prima folosire** (1-la-1: un minut pentru începutul lecției; grupul: cronul, înainte de ședință) sau imediat din Admin → 🎥 Meditații live → „🔊 Generează vocea”. În „Lecțiile recente” apare „scrisă de Claude (skill-ul „examenmate-continut”)”.

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
| Lecția live (7) e „conflict”: „are deja o lecție live” / „se scrie chiar acum pe site” | între timp un elev a pornit subiectul și site-ul i-a scris lecția — nu s-a scris nimic, e corect |
| „Anulează” la o lecție live: „are deja vocea generată” | lecția e folosită deja — o ștergi din Admin → 🎥 Meditații live → „Lecțiile recente” |

## Fișierele

`api/_lib/continutGenerat.js` (publicare, ciornă, aprobare, respingere, anulare, verificări), `api/_lib/liveLesson.js` (`skillBrief`, `scriptFromItems` — procedura 7), `api/continut-generat.js` (Admin), `src/components/AdminContinutGenerat.jsx` (fila), `scripts/continut/publica.js` și `scripts/continut/aduce-surse.js` (Action-urile), `api/ai-pdf-context.js` (`setOverride`: `claude-skill`, `doarDacaLiber`), `supabase/continut_generat.sql`, `supabase/notificari_fara_bareme.sql`. Teste: `test/continut-generat.test.js`.
