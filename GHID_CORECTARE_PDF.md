# 📝 Corectarea testelor și exercițiilor PDF — „Răspunde în chat"

Prof. Virtual (și Meditatorul tău) pot acum **corecta cu punctaj** testele PDF,
exact cum corectează testele interactive.

## Cum funcționează (pentru elev)

1. Elevul deschide un **test PDF** (variantă de bac / Evaluare Națională / fișă)
   și apasă „Profesorul virtual" — ca până acum, platforma găsește **baremul
   corespunzător** (potrivirea strictă an + variantă + profil + sesiune rămâne
   neschimbată).
2. În chat apare butonul **„📝 Răspunde în chat"** (formularul NU pornește
   automat). La apăsare, se construiește un **formular simplu** din barem:
   câte un câmp pentru **fiecare exercițiu** și pentru **fiecare subpunct
   a), b), c)** — cu punctele lui, ca în barem. Pentru materialele **fără barem**
   în baza de date, formularul are doar câmpuri de răspuns.
3. Elevul completează ce a rezolvat (poate lăsa goale cerințele nerezolvate) și
   apasă **„✅ Corectează"**.
4. AI-ul primește: **(1) testul, (2) baremul, (3) răspunsurile elevului** și:
   - acordă **punctaj pe fiecare subpunct**, ca în barem (punctaj parțial pe
     elementele atinse);
   - explică **greșelile**, ce a făcut **bine** și ce **nu a completat**;
   - răspunde apoi la orice întrebare despre corectare (corectarea intră în
     conversație, deci „de ce am luat doar 2p la III.1.a?" funcționează).

### Punctajele oficiale (rundă de corecturi)

- **Baremul are întotdeauna prioritate** — punctele cerințelor vin din el.
- Fără barem, la **Evaluare Națională** se aplică determinist punctajul
  oficial: Subiectul I și II — **5p pe exercițiu grilă**; Subiectul III —
  **a) 2p + b) 3p** (subiectele vechi cu a,b,c la III → 5p/subpunct);
  total **90p + 10p din oficiu = 100p**. La **Bacalaureat**: 5p pe cerință.
- Textul extras din PDF poate pierde **radicali/exponenți** — cerințele se
  reconstruiesc din barem (ex. „3x+6=6" cu 36 în barem → $\sqrt{3x+6}=6$),
  iar corectarea judecă după enunțul real.
- LaTeX-ul stricat de JSON (ex. „rac{30}{100}" în loc de \frac) se repară
  automat pe server în explicații și cerințe.
5. Merge și pentru **poze 📷 și PDF-uri încărcate de elev direct în chat**
   (butonul 📷 acceptă acum și fișiere PDF) — acolo fără barem, doar răspunsuri.

Butoanele vechi de mod („Învață-mă", „Teoria", „Dă-mi un indiciu") au fost
eliminate din chat — locul lor l-a luat „📝 Răspunde în chat".

## Salvarea punctajelor (ca la testele interactive)

- **Test PDF din platformă** → punctajul intră în `progress` (același loc ca
  testele interactive): **punctaj, nr. încercări (cumulate), timp, a folosit
  Prof. Virtual** — vizibile la profesor și părinte în **„Rezultate elevi"** și
  în **„Raport AI"**, cu mențiunea **(PDF)** sau **(interactiv)** în paranteză,
  lângă fiecare exercițiu.
- **Poză / PDF încărcat de elev** → tabelul nou `ai_pdf_results`; apare la fel
  în conturile de profesor/părinte (marcat „încărcat de elev în chat").
- **Contul de elev** → card nou în „Contul meu": **„📊 Rezultatele mele —
  teste și exerciții rezolvate"** (interactive + PDF, cu notă, încercări, timp).
- Nota se calculează cu regula existentă (10 puncte din oficiu — `notaDinScor`).
- Insignele se acordă ca la testele interactive.

## Meditații cu AI

Același formular, în chatul Meditatorului (elevul încarcă poza/PDF-ul temei).
Rezultatul corectării **alimentează meditatorul**:

- greșelile intră în **jurnalul de greșeli** → butonul „🔁 **Încă 10 exerciții
  ca acelea greșite**" pornește remedierea existentă;
- **stăpânirea pe subiecte** se actualizează (alimentează planul + rapoartele);
- butoane în chat: „🗺️ **Fă-mi plan de învățare după acest rezultat**" și
  „🧩 **Recomandă-mi exerciții de pe site**" (folosesc catalogul existent);
- **părinții** primesc notificarea zilnică obișnuită;
- seria de studiu (streak) și timpul total cresc.

## Instalare (un singur pas)

Rulează în **Supabase → SQL Editor**: `supabase/corectare_pdf.sql`
(tabelul `ai_pdf_results` + politicile RLS).

> Fără acest script, corectarea funcționează în continuare pentru testele din
> platformă (se salvează în `progress`); doar pozele/PDF-urile încărcate de
> elev nu și-ar putea salva punctajul (elevul vede un avertisment).

## Fișiere atinse

- **nou:** `api/ai-correct.js` (formular + corectare + salvare),
  `supabase/corectare_pdf.sql`, acest ghid
- **modificate:** `src/components/AITutor.jsx` (buton „Răspunde în chat",
  formular, rezultatul corectării în chat, 📷 acceptă PDF, fără butoanele de
  mod), `src/lib/aiClient.js`, `src/pages/PDFViewer.jsx` (semnal text citibil),
  `api/teacher-students.js` (rezultatele încărcate de elevi),
  `src/components/TeacherResults.jsx` (paranteza (interactiv)/(PDF), „Da
  (corectare AI)"), `src/components/StudentAIMastery.jsx`,
  `src/pages/Profile.jsx` (rezultatele elevului)

## Depanare

- „Nu am putut construi formularul" → textul PDF nu e citibil (scanat):
  elevul fotografiază exercițiul cu 📷.
- Punctajul nu apare la profesor → verifică asocierea elevului și rulează
  `supabase/corectare_pdf.sql` (pentru încărcări) / `supabase/pastreaza_rezultate.sql`
  (pentru snapshotul titlurilor).
- Modelul de corectare se setează cu `AI_PDF_CHAT_MODEL` (cu barem — implicit
  `gpt-5.6-terra`, folosit și de Prof. Virtual pe orice PDF deschis) și
  `AI_GEN_CHAT_MODEL` (fără barem) — aceleași variabile ca până acum.
