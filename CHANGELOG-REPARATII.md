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
- `SITE_ORIGIN` — origine permisă CORS (ex: `https://examenmate.ro`).
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
