# 🎓 Profesor Virtual (AI + RAG) — Ghid de integrare

Acest pachet adaugă pe ExamenMate un **tutor AI** care:

1. **Asistent AI** — răspunde la întrebări despre matematică și despre site.
2. **Profesor virtual (RAG)** care:
   - explică **teoria**,
   - dă **indicii** (fără să dezvăluie rezolvarea),
   - **generează exerciții noi** în stilul celor din baza ta de date,
   - **verifică rezolvarea** elevului și dă feedback,
   - **urmărește progresul** pe subiecte (stăpânirea competențelor).
3. **Învață constant**: orice exercițiu, rezolvare sau manual pe care îl adaugi e indexat automat în baza de cunoștințe a AI-ului. Fără reantrenare.

Totul se sprijină pe ce ai deja: **Supabase** (cu extensia `pgvector` ca vector store) și **funcții serverless pe Vercel**. Singurul serviciu nou e un **furnizor LLM** (default OpenAI, dar configurabil).

---

## 📦 Ce conține pachetul

```
mate-ai-tutor/
├── supabase/
│   ├── ai_tutor_schema.sql          # Tabele, triggere, funcții RAG (rulezi o dată)
│   ├── ai_tutor_v2.sql              # Feedback pe mesaje
│   ├── ai_tutor_v3.sql              # Notificări (alerte de stagnare)
│   └── ai_tutor_v4.sql              # Biblioteca personală (teste generate, privat)
├── api/
│   ├── _lib/ai.js                   # Client LLM + RAG + voce + notificări (partajat)
│   ├── ai-chat.js                   # Chat-tutor (non-streaming, fallback)
│   ├── ai-chat-stream.js            # Chat-tutor cu STREAMING
│   ├── ai-practice.js               # Generează + verifică exerciții (+ detecție stagnare)
│   ├── ai-ingest.js                 # Motorul de "învățare constantă"
│   ├── ai-progress.js               # Dashboard de progres (elev)
│   ├── ai-feedback.js               # 👍/👎 pe răspunsuri
│   ├── ai-vision.js                 # Foto-rezolvare (citește exercițiul din poză)
│   ├── ai-transcribe.js             # Voce → text (fallback STT, Whisper)
│   ├── ai-notify.js                 # Notificări (listă / citit / scanare stagnare)
│   ├── ai-exam.js                   # Generează MODELE de teste de examen (4 tipuri)
│   ├── ai-generate-interactive.js   # Generează exerciții INTERACTIVE (HTML) savabile
│   └── ai-teacher.js                # Date AI per elev + RAPORT AGREGAT pe clasă/grupă
├── src/
│   ├── lib/aiClient.js              # Client front-end
│   ├── lib/katex.js                 # Randare formule LaTeX (KaTeX din CDN)
│   ├── lib/image.js                 # Micșorare imagine (foto-rezolvare)
│   ├── lib/voice.js                 # Dictare (STT) + citire cu voce (TTS)
│   ├── lib/examPrint.js             # Export „PDF" (print browser cu KaTeX): teste + exerciții
│   ├── components/AITutor.jsx        # Widget + chat (streaming, voce, foto, istoric, feedback)
│   ├── components/AIAdminPanel.jsx   # Panou admin pentru baza de cunoștințe
│   ├── components/StudentAIMastery.jsx  # Progres AI per elev (în panoul profesorului)
│   ├── components/AITeacherReport.jsx   # RAPORT AGREGAT pe clasă/grupă (profesor)
│   ├── components/AINotifications.jsx   # Clopoțel de notificări
│   └── pages/ProfesorVirtual.jsx     # Pagina dedicată (chat / antrenament / progres)
└── .env.ai.example                  # Variabile de mediu
```

**Copiezi aceste fișiere peste structura proiectului tău** (păstrând căile: `api/...`, `src/...`, `supabase/...`). Niciun fișier existent nu e suprascris — toate sunt noi. Mai jos sunt cele **4 mici editări** în fișiere existente.

---

## 🚀 Instalare pas cu pas

### Pasul 1 — Baza de date (Supabase)

1. Supabase Dashboard → **SQL Editor** → **New Query**.
2. Lipește tot conținutul din `supabase/ai_tutor_schema.sql` → **Run**.
3. **New Query** din nou → lipește `supabase/ai_tutor_v2.sql` → **Run** (tabela de feedback).
4. **New Query** din nou → lipește `supabase/ai_tutor_v3.sql` → **Run** (notificări).
5. **New Query** din nou → lipește `supabase/ai_tutor_v4.sql` → **Run** (biblioteca personală „Testele mele").
5. Verifică în **Table Editor** că au apărut: `ai_knowledge`, `ai_ingest_queue`, `ai_conversations`, `ai_messages`, `ai_skill_mastery`, `ai_usage`, `ai_feedback`, `ai_notifications`.

> Dacă vezi eroarea „extension vector does not exist", rulează întâi `create extension vector;` din **Database → Extensions** (caută `vector` și activează-l), apoi re-rulează scriptul.

### Pasul 2 — Variabile de mediu (Vercel)

Vercel → proiect → **Settings → Environment Variables**. Minim necesar:

| Variabilă | Valoare |
|---|---|
| `OPENAI_API_KEY` | cheia ta OpenAI (acoperă și chat, și embeddings) |

Vezi `.env.ai.example` pentru toate opțiunile (alt furnizor, modele, limite). Lasă restul pe valorile implicite la început.

> **Important:** ai nevoie și de variabilele Supabase pe care le ai deja (`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` etc.). Funcțiile AI le refolosesc.

### Pasul 3 — Cele 4 editări în fișiere existente

#### 3a. `src/App.jsx` — rută + widget global

Adaugă **două importuri** lângă celelalte:
```jsx
import ProfesorVirtual from './pages/ProfesorVirtual';
import FloatingTutor from './components/AITutor';
```

Adaugă **ruta** în interiorul `<Routes>` (oriunde printre celelalte):
```jsx
<Route path="/profesor-virtual" element={<ProfesorVirtual />} />
```

Montează **widgetul plutitor** în `Layout`. Găsește:
```jsx
      {!fullscreen && <Footer />}
    </>
```
și înlocuiește cu:
```jsx
      {!fullscreen && <Footer />}
      {!fullscreen && <FloatingTutor />}
    </>
```

#### 3b. `src/components/Navbar.jsx` — link în meniu

Găsește linkul de **desktop** către „Rezolvări":
```jsx
<Link to="/rezolvari" className={location.pathname === '/rezolvari' ? 'active' : ''}>
```
și adaugă imediat **după** acel `<Link>...</Link>`:
```jsx
<Link to="/profesor-virtual" className={location.pathname === '/profesor-virtual' ? 'active' : ''}>
  Profesor Virtual
</Link>
```

La fel pentru meniul **mobil** (caută al doilea `<Link to="/rezolvari" onClick={onClose} ...>`), adaugă lângă el:
```jsx
<Link to="/profesor-virtual" onClick={onClose} style={{ ...linkStyle, color: location.pathname === '/profesor-virtual' ? 'var(--gold)' : 'rgba(255,255,255,0.88)' }}>
  🎓 Profesor Virtual
</Link>
```

#### 3c. `src/pages/Admin.jsx` — panou de administrare (opțional, recomandat)

Adaugă importul:
```jsx
import AIAdminPanel from '../components/AIAdminPanel';
```
Apoi randează `<AIAdminPanel />` undeva în pagina de admin (de ex. într-o secțiune nouă sau la finalul listei de management):
```jsx
<div style={{ marginTop: 24 }}>
  <AIAdminPanel />
</div>
```

#### 3d. `vercel.json` — indexare automată (cron)

Adaugă cheia `crons` (procesează automat coada de indexare la fiecare 10 minute):
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "crons": [
    { "path": "/api/ai-ingest?action=process", "schedule": "*/10 * * * *" },
    { "path": "/api/ai-notify?action=scan", "schedule": "0 17 * * *" }
  ],
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

> Cron-ul Vercel trimite automat antetul `x-vercel-cron`, pe care endpointul îl verifică. Nu trebuie să configurezi nimic în plus. (Crons sunt disponibile pe planurile Vercel care le includ; dacă nu ai cron, apasă manual „Procesează coada" din panoul de admin sau lasă indexarea la „Reindexează tot".)

#### 3e. `src/components/TeacherResults.jsx` — progres AI în panoul existent (opțional)

Nu adăuga un panou separat — **injectează** progresul AI pe subiecte în panoul tău existent. Adaugă importul:
```jsx
import StudentAIMastery from './StudentAIMastery';
```
Apoi, în zona unde afișezi detaliile unui elev (în componenta `StudentRow`, după tabelul cu scoruri), randează:
```jsx
<StudentAIMastery studentId={student.id} />
```
Profesorul vede astfel, lângă scorurile la exerciții, și stăpânirea pe subiecte din antrenamentele cu AI — doar pentru elevii lui (autorizat pe server).

#### 3f. Raport agregat pe clasă + notificări (opțional, recomandat)

În zona de profesor (de ex. în `TeacherResults.jsx`, sus de tot), adaugă raportul agregat și clopoțelul de notificări:
```jsx
import AITeacherReport from './AITeacherReport';
import AINotifications from './AINotifications';
```
```jsx
{/* sus, lângă titlul paginii de profesor */}
<AINotifications />

{/* o secțiune nouă cu raportul pe clasă/grupă */}
<AITeacherReport />
```
`AITeacherReport` arată media stăpânirii pe clasă, subiectele cele mai grele și elevii în dificultate, cu filtru pe grupă. `AINotifications` e un clopoțel cu alerte (ex: „X stagnează la ecuații").

Poți pune clopoțelul și în `Navbar.jsx` ca să fie vizibil peste tot:
```jsx
import AINotifications from './AINotifications';
// ...în bara de sus, lângă meniul de cont:
<AINotifications />
```

### Pasul 4 — Indexează conținutul existent

1. Deploy pe Vercel (sau `npm run dev` local cu variabilele setate).
2. Intră ca **admin** → pagina **Admin** → panoul „Profesor Virtual — Bază de cunoștințe".
3. Apasă **„🔄 Reindexează tot"**. Se vor indexa toate exercițiile, rezolvările și manualele existente. Așteaptă să ajungă `În coadă = 0`.

Gata. Butonul plutitor 🎓 apare pe site și pagina `/profesor-virtual` e funcțională.

---

## 🔁 Cum „învață constant"

```
Adaugi/editezi un exercițiu, rezolvare sau manual (din Admin)
        │  (trigger Postgres)
        ▼
   ai_ingest_queue  ──(cron la 10 min SAU buton admin)──►  /api/ai-ingest
        │
        ▼
   Se generează embedding și se salvează în ai_knowledge
        │
        ▼
   La următoarea întrebare, RAG aduce automat noul material
```

- **Nu există reantrenare.** „Învățarea" înseamnă indexare: materialul nou devine imediat parte din contextul pe care AI-ul îl folosește.
- Ștergerile sunt tratate la fel (materialul iese din baza de cunoștințe).
- **Modelele tale de explicații** (din manuale și rezolvări) sunt sursa principală: tutorele e instruit să imite stilul și notațiile din ele.

### Adaugă „teorie" dedicată (opțional)
Pe lângă exerciții, poți pune explicații teoretice direct în baza de cunoștințe. Cel mai simplu: adaugă-le ca **manual** (tabela `content`, `content_type = 'manual'`, cu textul în `manual_content`) — se indexează automat. Alternativ, inserează rânduri cu `source_type = 'theory'` direct în `ai_knowledge` și rulează „Procesează coada".

---

## 💰 Cât costă (cost de funcționare)

**Codul e al tău — nu există costuri de licență.** Hostingul (Vercel + Supabase) îl ai deja; la scară mică/medie rămâi în planurile actuale. Singurul cost nou e **furnizorul LLM**, plătit la consum.

Prețuri OpenAI folosite (iunie 2026, verificate): **gpt-4o-mini** $0,15 / 1M tokeni intrare și $0,60 / 1M ieșire; **embeddings text-embedding-3-small** $0,02 / 1M; **Whisper** $0,006 / minut. **Text-to-speech și majoritatea dictării rulează în browser = 0 lei.**

Cost estimativ pe acțiune (cu gpt-4o-mini):

| Acțiune | Cost aproximativ |
|---|---|
| O întrebare în chat (cu RAG) | ~$0,001 (≈ 0,005 lei) |
| Generare exercițiu nou | ~$0,0008 |
| Verificare rezolvare | ~$0,0005 |
| Foto-rezolvare (citire poză) | ~$0,0008 |
| Transcriere vocală (doar fallback Whisper, ~10s) | ~$0,001 |
| Indexare (embedding) a unui material | ~$0,000005 (o singură dată) |

Indexarea întregului conținut (sute–mii de materiale) costă **câțiva cenți, o singură dată**. Reindexările sunt la fel de ieftine.

Scenarii lunare (estimative):

| Utilizare | Exemplu | Cost LLM / lună |
|---|---|---|
| Mică | 100 elevi activi, ~30 acțiuni AI fiecare | **~$3–5** |
| Medie | 500 elevi, ~80 acțiuni fiecare | **~$35–45** |
| Mare | 2000 elevi, ~120 acțiuni fiecare | **~$200–250** |

Cu alte cuvinte, la 500 de elevi plătitori costul AI e sub ~1% din venituri. Costul e dominat de chat; `AI_RATE_PER_HOUR` (default 80/oră/elev) te protejează de surprize.

**Cum reduci și mai mult:** model mai ieftin/spot prin OpenRouter sau Groq (vezi `.env.ai.example`); prompt caching (până la −90% pe intrarea repetată); Batch API (−50%) pentru indexări mari. Pentru examene poți pune un model mai puternic **doar pe chat**, păstrând embeddings/vision ieftine.

> Numele și prețurile modelelor evoluează. Variabilele de mediu le fac ușor de schimbat fără a atinge codul. Verifică oferta curentă a furnizorului și actualizează `AI_CHAT_MODEL` / `AI_EMBED_MODEL` / `AI_VISION_MODEL`.

⚠️ **Dacă schimbi modelul de embeddings**, dimensiunea vectorului trebuie să rămână **1536** (cât e coloana `vector(1536)` din schemă). Dacă noul model are altă dimensiune, fie setezi `AI_EMBED_DIM` la o valoare ≤1536 (modelele `text-embedding-3-*` suportă „dimensions"), fie modifici tipul coloanei `ai_knowledge.embedding` și reindexezi.

---

## 🔒 Securitate

- Cheile LLM stau **doar pe server** (funcții serverless). Nu ajung niciodată în browser.
- `ai_knowledge` are RLS strict: **doar serverul** (service role) citește. Conținutul premium nu se scurge către clienți. Filtrarea premium/gratuit se aplică în recuperare: un elev fără abonament primește context doar din materialele gratuite.
- Funcțiile RAG (`match_ai_knowledge*`) sunt revocate pentru roluri publice — nu pot fi apelate din browser.
- Exercițiile generate sunt **efemere**: răspunsul corect e ținut într-un token semnat HMAC, nu în DB, deci elevul nu îl poate „trage" din rețea.
- Rate limiting per utilizator prin `ai_usage`.

---

## 🧩 Folosire în site

- **Widget plutitor** (🎓 dreapta-jos): disponibil pe tot site-ul pentru utilizatorii autentificați.
- **Pagina `/profesor-virtual`**: trei tab-uri — *Întreabă profesorul*, *Antrenament*, *Progresul meu*.
- **Moduri de chat**: „Învață-mă" (explicație), „Teoria" (teorie structurată), „Dă-mi un indiciu" (un singur pas).

### Funcționalități AI incluse
- **🔒 Acces pe abonament** — funcțiile AI sunt pentru abonați. Un cont fără abonament vede widgetul și are **1 acțiune gratuită** (configurabil prin `AI_FREE_ACTIONS`), apoi apare un mesaj de abonare. Gating-ul e aplicat pe server (nu poate fi ocolit din browser).
- **📄 Generator de teste de examen (PDF)** — în pagina „Profesor Virtual" → tabul „Generează test": 4 tipuri (Evaluare Națională, BAC Tehnologic, BAC Științele Naturii, BAC Mate-Info). Testul respectă structura oficială (Subiectele I/II/III, 30p fiecare, 10p oficiu) și e construit **recombinând exercițiile din baza ta** (cu date/notații schimbate). Se deschide ca document tipăribil (KaTeX) → „Salvează ca PDF", în două variante: **elev** și **barem + rezolvări**. Doar abonați.
- **📄 Export PDF exercițiu** — la Antrenament, butonul „Exportă PDF" produce o fișă (enunț + rezolvare) prin fereastra de print. Doar abonați.
- **🧩 Exerciții interactive generate** — două niveluri de acces:
  - **Abonat** (în „Profesor Virtual" → tabul „🧩 Interactiv", accesibil din „Contul meu"): generează un exercițiu interactiv (HTML, scor prin `MATE_SCORE`) și îl rezolvă pe loc. **Scorul se salvează automat** în biblioteca personală „📚 Testele mele" — privat, doar pentru el. NU poate publica în conținutul public.
  - **Admin** (în Admin → „🎓 AI Tutor"): în plus, poate **publica** exercițiul generat în conținut (upload + inserare), devenind exercițiu real pentru toți (se indexează automat).
- **📚 Testele mele** — biblioteca personală a abonatului: testele de examen generate și exercițiile interactive rezolvate se salvează aici (tabela `ai_personal_items`, RLS strict pe proprietar), separat de conținutul public.
- **🎤 Voce** — dictare (Web Speech API gratuit; fallback Whisper) și citire cu voce a răspunsului (gratuit, în browser). Formulele LaTeX sunt transformate în text citibil.
- **📊 Raport agregat pentru profesor** — `AITeacherReport` arată media stăpânirii pe clasă/grupă, subiectele cele mai grele și elevii care au nevoie de atenție (nu doar per elev).
- **🔔 Notificări de stagnare** — când un elev rămâne slab la un subiect (sub 50% după 4+ încercări), profesorul primește automat o alertă (cu dedup pe 7 zile). Detecția se face pe loc la verificarea exercițiilor și, opțional, printr-un scan zilnic (cron).
- **📷 Foto-rezolvare** — elevul fotografiază un exercițiu, un model cu vedere îl transcrie în LaTeX (editabil), apoi intră în fluxul normal de chat. Imaginea nu se salvează.
- **Streaming** — răspunsul apare token cu token. Funcționează nativ pe Vercel; `ai-chat` clasic e rezervă.
- **Formule frumoase (KaTeX)** — modelul scrie în LaTeX (`$...$`), iar interfața randează formulele. KaTeX se încarcă automat din CDN (jsDelivr) la prima formulă. Dacă ai o politică **CSP** strictă, permite `cdn.jsdelivr.net` pentru `script-src`, `style-src` și `font-src`.
- **Istoricul conversațiilor** — butoanele „＋ Conversație nouă" și „🕘 Istoric" în chat. Conversațiile se salvează automat și pot fi reluate.
- **Feedback** — 👍/👎 sub fiecare răspuns (tabela `ai_feedback`), util ca să vezi unde greșește AI-ul și să îmbunătățești materialele din baza de date.
- **Siguranță pentru minori** — tutorele rămâne strict pe teme educaționale, refuză subiecte nepotrivite, folosește limbaj potrivit vârstei și, la teme, ghidează spre soluție în loc să o ofere de-a gata.
- **Rate limiting** per utilizator (`AI_RATE_PER_HOUR`).

### Ajutor contextual pe pagina unui exercițiu (opțional)
Widgetul acceptă un `context` cu `{ category, contentId, exerciseText }`. Dacă vrei ca pe `InteractiveViewer` / `PDFViewer` tutorele să „știe" la ce exercițiu lucrează elevul, randează direct `<ChatPanel context={{ category: item.category, contentId: item.id, exerciseText: item.title }} />` într-un panou lateral pe acele pagini. (Importă `{ ChatPanel } from '../components/AITutor'`.)

---

## 🛠️ Depanare

| Simptom | Cauză / soluție |
|---|---|
| „AI_CHAT_API_KEY nu este setat" | Adaugă `OPENAI_API_KEY` în Vercel și redeploy. |
| Răspunsuri fără context / generice | Nu ai indexat încă. Apasă „Reindexează tot" din Admin. |
| „extension vector does not exist" | Activează extensia `vector` în Supabase → Database → Extensions. |
| Tutorele merge dar fără căutare semantică | Lipsește cheia de embeddings → folosește fallback lexical (funcțional, dar mai puțin „inteligent"). Setează `OPENAI_API_KEY`. |
| Coada nu se procesează singură | Planul tău Vercel nu are cron → apasă manual „Procesează coada" sau folosește doar „Reindexează tot". |
| Eroare 429 | Ai depășit `AI_RATE_PER_HOUR`. Mărește limita din variabilele de mediu. |
| Foto-rezolvarea zice „nu am putut citi" | Poza e neclară/întunecată. Apropie-te de exercițiu, lumină bună. Modelul de chat trebuie să suporte imagini (gpt-4o-mini suportă); altfel setează `AI_VISION_MODEL`. |
| „Imaginea e prea mare" | Rar (clientul micșorează automat). Refă poza; se trimite la max 1280px. |
| Dictarea (🎤) nu pornește | Browserul nu suportă Web Speech API (ex: Firefox/unele Safari) → se folosește automat înregistrarea + Whisper (setează `OPENAI_API_KEY`). Permite accesul la microfon. |
| Citirea cu voce (🔊) nu sună | `speechSynthesis` are nevoie de o voce instalată; vocea românească depinde de sistem (Windows/Android au de obicei). Pe unele sisteme citește cu o voce implicită. |
| Profesorul nu vede notificări | Alertele apar doar pentru elevii asociați (în `mentor_students` sau `profiles.teacher_id`) care chiar stagnează (sub 50% după 4+ încercări). |

---

## 🔮 Idei de extindere

- **Promovarea exercițiilor generate** în `content` (acum sunt efemere, conform alegerii tale).
- **Notificări pe email** pe lângă cele in-app (Resend/Postmark + cron-ul de scanare).
- **Rapoarte săptămânale** trimise automat profesorului.
- **Recunoaștere a scrisului de mână** mai bună pentru foto-rezolvare (model de vedere superior pe acel endpoint).

---

Întrebări sau ajustări (alt furnizor, alt design, streaming)? Spune-mi și continuăm.
