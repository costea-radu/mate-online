# Profesorul Virtual ↔ Exercițiile interactive

## Răspunsul scurt: NU trebuie să modifici exercițiile din baza de date

HTML-ul fiecărui exercițiu este încărcat ca text și afișat în iframe. La afișare, aplicația injectează automat un mic script („bridge") în el (`src/lib/tutorBridge.js`). Toate exercițiile existente și viitoare primesc integrarea fără nicio modificare — inclusiv cele pe alt șablon (pentru acelea contextul se citește generic din pagină).

## Activare (un singur pas)

Rulează în Supabase → SQL Editor: `supabase/gamification_schema.sql` (tabelul `user_badges` pentru insigne). Restul funcționează imediat după deploy. Dacă scriptul nu e rulat, totul merge în continuare, doar fără insigne.

## Ce s-a implementat

### 1. Exercițiu → Profesor
- Butonul „💡 Arată indiciile" devine „🎓 Întreabă profesorul virtual". La apăsare se deschide chatul LÂNGĂ exercițiu (dreapta pe desktop, jos pe mobil) și profesorul explică pasul curent natural, pornind de la indicațiile din exercițiu, fără să dea răspunsul.
- Chatul primește permanent starea exercițiului: enunț, pașii, răspunsurile elevului, indicațiile oficiale și răspunsurile corecte (marcate SECRET — doar pentru verificare, nu pentru dezvăluire). Elevul poate pune orice întrebare pe marginea exercițiului.
- Reguli pedagogice (în `api/_lib/ai.js`): nu dă răspunsul direct, explică greșeala, sugerează metoda, verifică pașii, întreabă la final.
- La cererea EXPLICITĂ a elevului („scrie tu", „alege tu B"), AI-ul completează direct în exercițiu prin marcaje `[[ACTIUNE:...]]` (fill / choose / tf / add) executate de bridge.
- Explicațiile se adaptează la nivel după categoria exercițiului: clasa 5–8, Evaluare Națională, Bacalaureat.
- Butonul „Profesorul virtual" există și în bara de sus a viewerului.

### 2. Profesor → Exerciții
- AI-ul primește catalogul exercițiilor interactive din DB și, când elevul întreabă de un capitol, recomandă exercițiul potrivit cu link. Linkul deschide exercițiul CU chatul alături și CU aceeași conversație (continuă discuția acolo).
- Plan de învățare: la cerere, construiește etape din exercițiile din site, cu obiective măsurabile (ex. „minim 80%").
- Motivare: felicitări concrete (vede progresul și insignele elevului), provocări și obiective mici. Insigne acordate automat la salvarea scorului (Primul pas, Punctaj maxim, Perseverent, În formă 5/10/25, Perfecționist, Pregătit de Bac/Evaluare) — toast în exercițiu + secțiunea „🏅 Insignele mele" în profil.

## Fișiere atinse
- nou: `src/lib/tutorBridge.js`, `src/lib/badges.js`, `supabase/gamification_schema.sql`
- modificate: `src/pages/InteractiveViewer.jsx`, `src/components/AITutor.jsx`, `src/pages/Profile.jsx`, `api/_lib/ai.js`

## Corecturi (runda 2)
- Formulele `$$...$$` se randează corect (conținutul e adus pe un singur rând înainte de afișare; LaTeX fără delimitatori primește automat `$...$`).
- Orice link `examenmate.ro` (halucinat) e corectat automat în frontend → linkuri interne relative; modelul e instruit să folosească DOAR linkuri relative și `examenmate.com`.
- Linkurile din răspunsuri sunt clicabile; linkurile de categorie (`/evaluare-nationala`, `/bacalaureat`, `/clase/...`) deschid direct tabul „Teste interactive"; `/exercitiu?id=...` deschide exercițiul cu conversația păstrată. Catalogul de exerciții e trimis și profesorilor/părinților.
- Vizibilitate: butonul din bară are subtitlul „te ajută să rezolvi exercițiul"; pe desktop există și widget plutitor „Întreabă-mă orice"; în exercițiu, fiecare pas are „🎓 Ajutor — întreabă profesorul virtual" (pastilă fixă la exercițiile pe alt șablon).

## Protocolul (pentru depanare)
- iframe → aplicație: `MATE_TUTOR_READY`, `MATE_TUTOR_STATE` (stare), `MATE_TUTOR_OPEN` (buton apăsat), `MATE_TUTOR_ACK`
- aplicație → iframe: `MATE_TUTOR_STATE_REQ`, `MATE_TUTOR_ACTION`
- `MATE_SCORE` rămâne neschimbat.
