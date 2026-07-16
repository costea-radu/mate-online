# Changelog reparații — ExamenMate

Toate fix-urile din raportul de debug, aplicate în ordine. Build-ul trece (`vite build`, 133 module), testele trec (`npm test`, 7/7), toate rutele API validate sintactic.

---

## 🔴 CRITIC

### #1 — Autentificare reală pe tot API-ul (era falsificabilă)
**Înainte:** fiecare rută lua identitatea din `req.body.userId` + service_role key → oricine putea acționa ca oricine (ștergere cont, date admin, portal Stripe al altcuiva).

**Acum:** identitatea vine din tokenul de sesiune Supabase (`Authorization: Bearer …`), validat pe server cu `supabase.auth.getUser(token)`. `req.body.userId` nu mai e crezut niciodată.

- Nou: `api/_lib/http.js` → `authUser(req, supa)` (sursă unică de identitate).
- Toate rutele AI (`ai-chat`, `ai-chat-stream`, `ai-practice`, `ai-assignment`, `ai-exam`, `ai-vision`, `ai-transcribe`, `ai-feedback`, `ai-progress`, `ai-generate-interactive`, `ai-account`, `ai-activity`, `ai-teacher`, `ai-notify`, `ai-ingest`, `ai-public`) derivă `userId` din token.
- Toate rutele non-AI (`admin-stats`, `admin-users`, `rezolvari-admin`, `create-checkout`, `create-portal`, `get-file-url`, `rezolvare-url`, `asociere`, `teacher-manage`, `teacher-students`) la fel.
- Client: nou `src/lib/api.js` → `authHeaders()`; `aiClient.js` și toate cele 16 `fetch('/api/…')` din pagini atașează acum tokenul.
- `admin-stats`/`admin-users`/`rezolvari-admin` folosesc `requireAdmin()` pe identitatea reală.

### #2 — CORS restrângibil
`Access-Control-Allow-Origin` vine acum din `SITE_ORIGIN` (default `*` doar dacă nu e setat). Antetul `Authorization` a fost adăugat în `Access-Control-Allow-Headers` (altfel preflight-ul bloca tokenul).

### #3 — iframe-uri cu HTML generat, acum izolate (`sandbox`)
Adăugat `sandbox="allow-scripts"` pe iframe-urile care randează HTML de la AI/profesori: `AIAdminPanel`, `AssignmentSolver`, `BibliotecaUtilizatorilor`, `ProfesorVirtual` (×2). Nu mai pot accesa sesiunea Supabase din `localStorage`. (`InteractiveViewer` — conținut din Supabase Storage — lăsat intenționat.)

### #4 — Scoruri mai greu de falsificat
Handler-ele `MATE_SCORE` resping acum mesajele care nu vin dintr-un iframe (`e.source === window` → ignorat), blocând spoof-ul trivial din consolă. (Nota: validarea reală de scor rămâne pe server pentru exercițiile `practice`.)

---

## 🟠 Corectitudine

### #5 — `stripe` mutat în `dependencies`
Era în `devDependencies`, deși e cerut la runtime de 3 funcții → putea da `Cannot find module 'stripe'`.

### #6 — `@stripe/stripe-js` eliminat
Dependență moartă (0 importuri). Scos din `package.json` și din `manualChunks` (vite.config.js) → gata warning-ul „empty chunk".

### #7 — URL site corect la Stripe
`create-checkout`/`create-portal` folosesc acum `SITE_URL` (fallback `VERCEL_URL`), nu `NEXT_PUBLIC_SITE_URL` (proiectul e Vite, nu Next). Redirect-urile de checkout/portal ajung pe domeniul corect.

### #8 — `.gitignore` adăugat
Lipsea complet. Acum ignoră `node_modules`, `dist`, `.env*` (mai puțin exemplul), `jscpd-out` etc. — previne comiterea cheilor.

---

## 🟡 Cod duplicat eliminat
- **`api/_lib/http.js`** — sursă unică pentru CORS, guard de metodă, auth, admin, signed-URL. A eliminat boilerplate-ul CORS din ~10 rute, cele **3 implementări** diferite ale parserului de signed-URL (acum una singură, robustă) și verificarea de admin repetată.
- **`api/_lib/ai.js` → `prepareChat()`** — blocul RAG + conversație + istoric (identic în `ai-chat` și `ai-chat-stream`) extras într-un singur helper.
- **`src/components/OAuthButtons.jsx`** — butoanele Google/Discord + separator (identice în `Login` și `Register`).
- **`src/components/ExamContent.jsx`** — `ItemBlock`, `Section`, `TypeTabs` (aproape identice în `EvaluareNationala` și `Bacalaureat`; `profile` devenit opțional) — o singură sursă.
- **`Admin.jsx` → `ContentMetaFields`** — câmpurile titlu/categorie/subcategorie/profil, partajate de Upload PDF și Upload Interactive.
- **`src/components/LegalSection.jsx`** — componenta `Section` (identică în 4 pagini legale) extrasă o singură dată.
- Duplicare totală: **659 → 359 linii** (4,62% → 2,57%), adică 44 → 30 clone. `Admin.jsx`: 939 → 905 linii.

---

## 🟢 Îmbunătățiri
- **`src/components/ErrorBoundary.jsx`** — nicio eroare de randare nu mai duce la ecran alb; se afișează un mesaj + butoane „Reîncarcă / Acasă".
- **Lazy-loading rute** (`App.jsx`) — toate paginile în afară de Home sunt `React.lazy` + `Suspense`. **JS inițial: 348 KB → 88 KB** (gzip 87 → 27 KB). Admin (938 linii), ProfesorVirtual etc. se încarcă doar la nevoie.
- **Teste** (`test/`, `npm test`) — `node --test`, fără dependențe noi: parsarea căilor Storage (4 teste) + token semnat round-trip/tamper (3 teste).
- `parseStoragePath()` extras ca funcție pură (testabilă).

---

## Variabile de mediu noi (setează în Vercel)
- `SITE_ORIGIN` — origine permisă CORS (ex: `https://examenmate.com`).
- `SITE_URL` — URL public pentru redirect-uri Stripe (înlocuiește `NEXT_PUBLIC_SITE_URL`).

Vezi `.env.ai.example` (secțiunea „SECURITATE / URL-uri").

## Verificare
```
npm install
npm run build   # ✓ 133 module
npm test        # ✓ 7/7
```

---

## ✏️ Modificări UI (la cerere)
- **Etichetă „Profesor Virtual" în funcție de rol** (nou `src/lib/aiLabel.js`): cont profesor → „Asistent AI pentru profesori"; cont părinte → „Asistent AI pentru părinți"; elev/nelogat → rămâne „Profesor Virtual". Aplicat în Navbar (desktop + mobil), titlul paginii `ProfesorVirtual` și cardul din `Profile`.
- **Biblioteca utilizatorilor**: butonul „📤 Trimite elevilor" nu mai apare pentru conturile de **elev** (`!isStudent`). Rămâne fluxul „Deschide" → „Verifică".

---

## 🔧 Hotfix — token expirat („sesiune expirată", materiale invizibile până la reconectare)
**Cauză:** după fix-ul #1, serverul (și PostgREST, pentru interogările directe) resping tokenul de sesiune EXPIRAT. Tokenul Supabase expiră după ~1h (tab lăsat deschis, laptop în sleep), iar înainte API-ul nu-l valida deloc, deci expirarea nu se vedea. De aici: „sesiune expirată" la Raport AI, materiale care apar în Admin doar după reconectare, ștergere blocată în Bibliotecă și încetineli/cascade de erori.

**Fix (auto-vindecare a sesiunii, `src/lib/api.js`):**
- `getValidSession()` — reîmprospătează PROACTIV tokenul dacă expiră în <30s, cu **dedup** (o singură reîmprospătare în zbor) ca să nu declanșeze coliziuni de rotație a refresh-token-ului.
- `authHeaders()` folosește tokenul valid; `apiPost()` și `aiClient.post()/chatStream()` **reîncearcă o dată pe 401** după o reîmprospătare forțată.
- `AuthContext` reîmprospătează sesiunea când utilizatorul **revine în tab / revine online** (`visibilitychange`/`focus`/`online`) — evită JWT-ul expirat la interogările directe Supabase.
- `Admin` cere un token proaspăt înainte de a citi lista de materiale (rezolvă „materialele apar doar după reconectare").

Rezultat: acțiunile nu mai cer reconectare manuală; tokenul se reînnoiește singur în fundal.

---

## 🔧 Hotfix 2 — pagină albă pe mobil la redeschiderea browserului (după redeploy)
**Cauză:** lazy-loading-ul (introdus la optimizare) împarte aplicația în multe chunk-uri hashuite. După un redeploy, un tab vechi ținut „înghețat" pe mobil cere fișiere JS cu hash vechi care nu mai există (404) → pagină albă până la refresh manual. NU e legat de token/sesiune.

**Fix:**
- `index.html` (și restul, mai puțin `/assets/`) — `Cache-Control: max-age=0, must-revalidate` în `vercel.json`; asset-urile hashuite rămân `immutable`. Browserul ia mereu HTML-ul curent (deci hash-urile corecte), fără pagină albă din cache vechi.
- `main.jsx` — ascultă `vite:preloadError`: dacă un chunk lazy lipsește (redeploy cât tab-ul era deschis), reîncarcă automat o singură dată (anti-buclă cu marcaj de timp).
- `App.jsx` — `ErrorBoundary` ridicat deasupra `AuthProvider` (plus unul intern): orice eroare arată ecranul „Reîncarcă", nu pagină albă.

---

## ✏️ Modificări UI 2 (la cerere)
**1) Asistent AI pentru profesori/părinți** (diferit de tutorele elevilor):
- Butonul/tab-ul „Întreabă profesorul" devine **„Întreabă Asistentul"** pentru profesor/părinte (nou `askAiLabel` în `src/lib/aiLabel.js`) — în pagina Asistent, în widgetul plutitor și la butonul din foto-rezolvare.
- Modurile „Învață-mă / Teoria / Dă-mi un indiciu" sunt înlocuite, pentru profesor/părinte, cu **„Examene"** și **„Elevi"** (`MENTOR_MODES` în `AITutor.jsx`). Elevii păstrează modurile vechi.
- Server (`api/_lib/ai.js` → `systemFor`): persona nouă **pentru adulți** + **hartă de linkuri interne** (`SITE_MAP`). Asistentul răspunde acum și despre: navigarea în site și **unde se găsesc fișierele** (ex. „subiecte de Evaluare Națională" → `/evaluare-nationala`), **elevii asociați** (rezultate + raport AI în `/profil`, asociere prin cod, grupe, teme), **planuri de lecție** și structura examenelor — pe lângă matematică.

**2) Ștergerea materialului șterge și notificarea:**
- La adăugarea unui material, un trigger creează un anunț în `ai_broadcasts`. Acum, la ștergere, anunțul se șterge automat.
- **Primar (atomic):** `supabase/ai_tutor_v6.sql` — trigger `AFTER DELETE` pe `content` (rulează-l o dată în Supabase → SQL Editor).
- **Fallback (fără SQL):** acțiune nouă `broadcast_delete_by_content` în `api/ai-notify.js`, apelată din `Admin.jsx` la ștergere — merge imediat chiar dacă nu rulezi încă SQL-ul.

---

## ✏️ Modificări UI 3 + arhivă
**Widget „Prof. Virtual" pentru profesor/părinte:** se deschide implicit pe **„Generează subiect examen"**, iar butonul **„Întreabă Asistentul"** e alături (taburile sunt reordonate: examen întâi). Elevii păstrează comportamentul vechi (deschidere pe chat).

**Eroare „Path too long" la dezarhivare (0x80010135):** arhiva nu mai are folderul-înveliș redundant `mate-online-main/` (Windows adăuga încă unul la extragere → căi prea lungi), iar fișierul SQL nou a fost redenumit scurt `supabase/ai_tutor_v6.sql`. Cea mai lungă cale internă: 63 → 41 caractere. Dacă tot apare eroarea, extrage într-o cale scurtă (ex. `C:\em`) sau folosește 7-Zip.

---

## ✏️ Modificări UI 4 (asistent profesor/părinte — chat)
- În chat („Întreabă Asistentul") s-au **scos butoanele de mod „Examene"/„Elevi"** (selectorul de moduri e ascuns pentru profesor/părinte).
- Sugestiile din chat au fost înlocuite cu **3 butoane de navigare** (nu mai trimit mesaj):
  1. „Unde găsesc subiecte de examen?" → **Home**, derulează la secțiunea de examene (`#examene`).
  2. „Unde găsesc statistici despre elevi?" → **Contul meu** (`/profil`).
  3. „Generează subiect examen sau exercițiu interactiv" → **Asistentul AI** (`/profesor-virtual`).
- Widgetul se deschide **din nou implicit pe „Întreabă Asistentul"**, cu „Generează subiect examen" alături (ordinea revenită).

---

## 🔧 Reparații 15.07.2026 — generator OpenAI + biblioteca personală

### #A — Generatorul de subiecte (OpenAI) combină acum REAL Simulări + Variante Date (mix)
**Înainte:** deși interogarea includea subcategoria `variante`, sursele erau limitate la primele 5 rânduri stratificate; dacă un PDF din Variante Date nu avea text extractibil (ex. scanat), cădea tăcut și testul se combina doar din Simulări.

**Acum (`api/ai-exam.js`, `api/ai-generate-interactive.js`):**
- se parcurge TOATĂ coada stratificată — dacă un PDF pică la extragere, se încearcă următorul din aceeași subcategorie, până sunt acoperite toate subcategoriile-sursă;
- sursele EN sunt exact ca rubrica „Simulări + Variante Date (mix)" a agentului Claude: `['simulari', 'variante']`;
- literele din planul de combinare alternează subcategoriile (Simulări ↔ Variante), deci itemii sunt un mix real;
- fiecare TEST-sursă e etichetat cu subcategoria lui, iar prompt-ul cere explicit mix din toate;
- răspunsul întoarce `combinedFrom` (sursele folosite), afișat în generator: „Itemii au fost combinați din: …".

### #B — Subiectele combinate exact se salvează în „Testele și exercițiile mele"
**Cauza reală:** PDF-ul combinat era salvat ca base64 în `payload`-ul jsonb; API-ul Supabase (PostgREST) respinge cererile JSON mari (~>1 MB) cu eroarea 413 → salvarea eșua mereu (și, în agentul Claude, eroarea era înghițită tăcut).

**Acum:** PDF-ul merge în **Storage** (bucket privat `personal-pdfs`, max 25 MB/fișier), iar în tabel se salvează doar calea (`payload.pdfPath`).
- Nou: `supabase/personal_pdfs_bucket.sql` — **rulează-l o dată în Supabase → SQL Editor** (creează bucketul + politicile owner-only și permite `kind='pdf'`).
- `aiClient.savePdfLibraryItem()` (upload + fallback base64 doar sub 700 KB), `aiClient.getLibraryPdfBlob()` (deschidere din Storage sau din base64 vechi), ștergerea elementului șterge și fișierul din Storage.
- `ExamGenerator` și `AIExerciseAgent` folosesc noul mecanism; dacă salvarea totuși eșuează, MOTIVUL se afișează (nu mai e tăcut).

### #C — Fracțiile nu se mai taie sus în fișierele generate (PDF/print + interactive)
În `examPrint.js` și `quizRender.js`, formulele KaTeX primesc:
`.katex { display:inline-block; padding:.4em .05em .25em; margin:-.4em -.05em -.25em }` — rândul crește cât formula, iar cutia formulei are „aer" de protecție deasupra numărătorului, compensat cu margini negative (spațierea vizibilă rămâne identică; verificat pixel-cu-pixel pe PDF generat cu Chrome headless).

### #D — Subiectul I fără geometrie (Evaluare Națională)
`api/ai-exam.js`: regulă explicită în prompt („SUBIECTUL I este EXCLUSIV aritmetică și algebră — NICIUN item de geometrie…"), iar planul de combinare EN e acum poziție-cu-poziție (I.1–I.6 doar algebră, II.1–II.6 geometrie, III.1–III.6 conform structurii oficiale); dacă itemul-sursă indicat e de geometrie, se alege un item de algebră.

---

## 🔧 Reparații 16.07.2026 — combinarea exactă (fără AI) + tutorele elevilor

### #E — „Păstrează datele problemelor" combină acum toate subcategoriile (nu doar Simulări)
**Cauzele reale (`src/lib/pdfCombine.js`, `ExamGenerator.jsx`, `AIExerciseAgent.jsx`):**
1. interogarea lua un eșantion NESORTAT de 60 de rânduri → Variantele Date lipseau des → acum: ordonat după cele mai recente + limită 300;
2. se opreau la primele 5 fișiere stratificate: dacă un PDF pică (download / scanat / fără structură), NU era înlocuit → acum `fetchPdfSources` încearcă URMĂTORUL fișier din aceeași subcategorie, cu probă de structură (`probeExamPdf`) înainte de acceptare, până acoperă toate subcategoriile;
3. plafon pe subcategorie → mix ECHILIBRAT (ex. 2 simulări + 2 exerciții pe subiecte + 1 variantă, nu 4+1); sursele apar în raport cu subcategoria: „Titlu [variante]".

### #F — Geometria nu mai poate ajunge la Subiectul I în combinarea exactă
**Cauza:** pdf.js sparge literele („SUBIECTUL a l I I - l e a"), iar numărul subiectului era citit din textul brut → antetul Subiectului II (geometrie) era uneori luat drept Subiectul I, și itemii lui de geometrie primeau cheile 1.x.
**Fix (`analyze` din `pdfCombine.js`):** numărul se citește din textul normalizat (fără spații/diacritice), STRICT imediat după „subiectul(al)"; în plus, sursele cu subiecte dublate sau în ordine greșită (I→II→III obligatoriu crescător) sunt refuzate și înlocuite automat.

### #G — Tutorele elevilor recomandă testele și exercițiile interactive
`api/_lib/ai.js`: la modurile de elev (tutor / teorie / indiciu / asistent), promptul include acum `STUDENT_TIP` — când elevul cere ajutor la învățat/exersat/pregătire, tutorele îi recomandă natural testele și exercițiile INTERACTIVE din site (verificare pe loc, rezolvări imediate, explicații la fiecare întrebare), cu link intern potrivit (/evaluare-nationala, /bacalaureat, /clase/5…12, /biblioteca-utilizatorilor, /profesor-virtual).

### #H — Audit UI + hotfix-uri din changelog
Verificate în cod, toate EXISTĂ deja în acest folder: aiLabel (Navbar/Profil/pagină), ascunderea „Trimite elevilor" pentru elevi, Hotfix token expirat (`api.js`, `AuthContext`, Admin), Hotfix 2 pagină albă (`vercel.json`, `main.jsx` preloadError, ErrorBoundary), moduri mentor + SITE_MAP, `broadcast_delete_by_content`, butoanele de navigare din chat + ancora `#examene`, widget implicit pe chat. Dacă pe site-ul live lipsesc, diferența e între repo-ul deployat și acest folder → redeploy cu conținutul de aici.

---

## ✏️ Modificări UI 5 — widgetul plutitor pe rol
În conturile de **profesor** și **părinte**, widgetul plutitor se numește acum **„Asistent AI"** (eticheta de lângă buton, antetul ferestrei și `aria-label`); pentru elevi/nelogați rămâne „Prof. Virtual". (`src/components/AITutor.jsx` — `widgetLabel` după rol.)
