## 25 august 2026 (3) — Mesageria, împărțită în două: canalul grupei și colegii de pe tot site-ul; testele opresc mesageria

Cerut de Radu, în trei puncte, peste intrarea precedentă (nimic nu fusese încă rulat în Supabase, deci scripturile s-au rescris, nu s-au adăugat migrări noi).

### 1. Mesageria grupei — DOAR canalul, fără 1-la-1
Rolldown-ul din „Contul meu" s-a redenumit **„💬 Mesageria grupei"** și primește `scope="group"`: arată exclusiv canalul comun (profesor + elevii grupei + părinții lor). Butonul „Scrie cuiva anume" a dispărut de acolo, împreună cu regula veche care lăsa doi membri ai aceleiași grupe să-și scrie în privat. Sub componentă apare o notă care trimite la colegi pentru discuții 1-la-1.

### 2. Colegi pe tot site-ul (ca la Facebook) + mesagerie proprie

**Legături noi** (`buddies`): cerere → acceptare, **doar între conturi de același fel** — elev cu elev, profesor cu profesor, părinte cu părinte. Verificat pe server, nu doar în interfață.

**„👥 Colegii mei"** în „Contul meu", **sub cartonașul cu numele și tipul contului**: pe desktop o fereastră cu câteva nume vizibile și **derulare** pentru rest; pe **mobil**, același conținut ca **tab cu rolldown** (`useIsMobile`, fără dublarea cererilor către server). Clic pe un coleg → se deschide conversația.

**Confidențialitate**: căutarea cere minimum 3 litere, întoarce **doar numele și rolul** (niciodată e-mailul), rolurile diferite nu se văd deloc între ele, iar cine nu vrea să apară debifează „Pot fi găsit de alți colegi după nume" (`profiles.colegi_discoverable`, comutator chiar în panou).

**Pagina `/mesagerie`** — mesageria de pe tot site-ul: canalele grupelor + discuțiile 1-la-1 cu colegii, cu lista de colegi alături. Se ajunge la ea din **bara de sus → „Mai multe" → 💬 Mesagerie** și, pe **mobil, din meniul burger**.

### 3. Testul pe grupă oprește mesageria
Coloană nouă `group_assignment_picks.active_until`. Elevul apasă „▶ Începe testul" → `test_start` o pune la *acum + 3 ore*; `api/messages.js` refuză orice trimitere cât timp e activă și testul nu e trimis (HTTP 423, `code: 'TEST_MODE'`) — **și pe canalul grupei, și la colegi**. Conversațiile rămân de citit.

Se deblochează automat când elevul trimite rezultatul (`score` șterge coloana), când apasă **„✓ Am terminat testul"** pe pagina testului, sau după 3 ore (ca un test abandonat să nu blocheze nimic la nesfârșit).

**Mesajul e afișat în trei locuri**: pe pagina testului, înainte și în timpul rezolvării; ca banner deasupra conversațiilor; și ca etichetă **„🔒 Test pe grupă în desfășurare — mesageria e oprită"** în bara vizualizatorului (interactiv, PDF și exercițiu generat), pentru toate cele patru bare — inclusiv cea de mobil a PDF-ului.

### Verificare
`node --check` pe toate rutele API; toate componentele noi și modificate trec prin esbuild și prin ESLint cu `no-undef` (zero identificatori nedefiniți — restul avertismentelor sunt cele preexistente din `Navbar.jsx` și `aiClient.js`); importurile relative rezolvă toate; paritate client↔server verificată automat pe cele patru rute (`/api/colegi`, `/api/messages`, `/api/group-assignment`, `/api/homework`).

> De rulat înainte de deploy: `supabase/mesagerie.sql` și `supabase/teme_elevi.sql`, apoi `npm run build` local (build-ul complet tot nu se poate rula din VM-ul Linux peste `node_modules` din Windows).

---
