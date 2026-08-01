# 🎓 „Meditații cu Profesorul Virtual" — ghid de instalare și funcționare

Rubrica nouă transformă Profesorul Virtual într-un **meditator personal cu
memorie pedagogică**: cunoaște fiecare elev, îi face evaluarea inițială, îi
construiește planul de învățare, îi predă teoria, îi dă exerciții și teme,
îi analizează greșelile și revine cu recapitulări ca să nu uite materia.

---

## 🚀 Instalare (2 pași)

### Pasul 1 — Baza de date (Supabase)

Supabase Dashboard → **SQL Editor** → **New Query** → lipește tot conținutul din
`supabase/meditatii_schema.sql` → **Run**. (Idempotent — se poate rula de mai multe ori.)

Verifică în **Table Editor** că au apărut: `ai_meditatii_profile`,
`ai_meditatii_sessions`, `ai_meditatii_homework`, `ai_meditatii_mistakes`,
`ai_meditatii_reviews`.

### Pasul 2 — Variabile de mediu (Vercel)

| Variabilă | Rol |
|---|---|
| `OPENAI_API_KEY` (o ai deja) | chatul tutorelui + generarea de lecții/analize |
| `ANTHROPIC_API_KEY` (o ai deja pentru agenți) | **Claude Opus 5** — generarea de exerciții și teste interactive de EN/BAC, după modelul din site |

> Fără `ANTHROPIC_API_KEY`, meditațiile funcționează în continuare — generarea
> cade automat pe furnizorul existent (`AI_GEN_CHAT_MODEL` / modelul de chat).

Cron-ul zilnic e deja adăugat în `vercel.json`
(`/api/ai-meditatii?action=cron`, ora 14:00 UTC = 17:00 România) — la deploy
se activează singur. El trimite în clopoțel: recapitulările scadente, temele
restante și dă teme noi elevilor inactivi de 3+ zile.

---

## 🤖 Ce model face ce (cerința B)

| Sarcină | Model |
|---|---|
| Explicațiile din chat, în timpul exercițiilor („Întreabă profesorul") | modelul de chat existent (`AI_CHAT_MODEL` — „terra"), **ca până acum** |
| Generarea de lecții (teorie) + analiza greșelilor + corectări | modelul de generare existent (`AI_GEN_CHAT_MODEL` — „sol"), **ca până acum** |
| Subiecte de examen **PDF** (tabul Simulări → „Subiect PDF") | generatorul existent `/api/ai-exam` (`sol`), **neschimbat** |
| Exerciții și teste **interactive** de EN/BAC (test inițial, seturi, remedieri, simulări interactive) | **Claude Opus 5** (`api/_lib/claude.js`), după modelul exercițiilor din site (RAG), cu fallback automat |

**Materialele din site au prioritate peste tot** (teme, exersare, teorie):
- temele dau ÎNTÂI exerciții interactive EXISTENTE, nefinalizate de elev
  (tabela `content`, verificat prin `progress`); doar la epuizare se generează;
- lecțiile listează ÎNTÂI materialele potrivite din site (Rezolvări/Teorie,
  articole, auxiliare, PDF-uri) și abia apoi predau lecția generată;
- orice generare primește ca model exemple reale din baza de cunoștințe
  (`ai_knowledge` — RAG), deci păstrează stilul și notațiile site-ului.

---

## 🗺️ Fluxul elevului

1. **Înscriere** (`/meditatii`): clasa (5–12) + examenul-țintă (EN / BAC pe profiluri).
2. **Test inițial adaptiv** (~12 întrebări, de la ușor la greu, cu materia
   anilor anteriori) → stabilește **nivelul** (începător/mediu/avansat) și
   **lacunele** pe capitole.
3. **Plan personalizat**: toate capitolele programei, cu lacunele primele,
   obiectiv săptămânal, timp estimat, procent de progres.
4. **Meditația propriu-zisă**: 📖 teoria (materiale din site + lecție
   structurată cu formule, exemplu rezolvat, schemă; export PDF) → ✍️
   exerciții corectate pe loc.
5. **Analiza greșelilor**: nu doar „greșit", ci **motivul** — greșeală de
   calcul / formulă / concept / regulă / neatenție — salvat în jurnalul de
   greșeli.
6. **Remediere**: „🔁 încă 10 exerciții de EXACT același tip" până stăpânește
   procedeul (greșeala se marchează vindecată la ≥80%).
7. **Capitol finalizat** (≥80%) → intră în **repetiția inteligentă**:
   recapitulare după **1 zi → 7 zile → 30 de zile** (notificări la clopoțel).
8. **Teme**: butonul „Dă-mi o temă acum" + teme automate de la cron; corectate,
   **notate 1–10**, cu explicarea greșelilor.
9. **Simulări de examen**: interactivă (Opus 5, cu punctele slabe incluse) sau
   subiect PDF oficial (generatorul existent).
10. **Predicția notei**: estimare 1–10 din stăpânire + teme + simulări, cu
    capitolele de consolidat pentru țintă.
11. **Chat socratic oricând** („💬 Întreabă profesorul"): pune întrebări, cere
    „explică-mi mai simplu / vizual / cu exemple din viața reală / pas cu pas"
    — preferința se ține minte (memoria pedagogică) și intră în toate
    generările și explicațiile viitoare.

## 👨‍👩‍👧 Raportul pentru profesori și părinți (funcția 18)

Mentorii asociați (prin codul de asociere existent) văd în **Contul meu →
Raport AI**, pentru fiecare elev: progresul planului, timpul de studiu,
capitolele finalizate/în lucru, dificultățile (capitole slabe + tipurile de
greșeli), temele și **recomandări pentru perioada următoare**. (Server:
`ai-activity` → blocul `meditatii`; și `ai-meditatii` → `mentor_report`.)

## 🔒 Acces

Meditațiile sunt **doar pentru abonați** (fără cele 2 acțiuni gratuite de
probă — alegere de produs). Gatingul e aplicat pe server la fiecare acțiune;
neabonații văd rubrica cu descrierea și butonul de abonare. Profesorii și
părinții nu au meditații proprii — văd raportul elevilor în profil.

## 🧩 Fișiere

- nou: `supabase/meditatii_schema.sql`, `api/_lib/meditatii.js`,
  `api/ai-meditatii.js`, `src/pages/Meditatii.jsx`, `GHID_MEDITATII.md`
- modificate: `api/_lib/ai.js` (reguli socratice + memoria pedagogică în chat),
  `api/ai-activity.js` (raport meditații pentru mentori), `api/sitemap.js`,
  `src/App.jsx` (ruta `/meditatii`), `src/lib/aiClient.js`,
  `src/components/Navbar.jsx` (D), `src/components/AITutor.jsx` (widget, C),
  `src/pages/ProfesorVirtual.jsx` (taburi elev, C), `src/pages/Home.jsx`
  (rubrica pe prima pagină), `src/pages/Profile.jsx` (raport per elev și
  pentru profesori), `src/components/ParentAIActivity.jsx`, `vercel.json`
  (cron + SEO meta pentru `/meditatii`).

## 🛠️ Depanare

| Simptom | Cauză / soluție |
|---|---|
| „Meditațiile fac parte din abonament" | Contul nu are abonament activ — comportament intenționat. |
| Testul inițial nu se generează | Verifică `ANTHROPIC_API_KEY` sau `OPENAI_API_KEY` în Vercel; vezi logurile funcției `ai-meditatii`. |
| Tabelele lipsesc / erori 500 la `state` | Rulează `supabase/meditatii_schema.sql`. |
| Temele nu vin automat | Cron-ul rulează zilnic la 17:00 (RO) și dă teme doar elevilor abonați, inactivi de 3+ zile, fără teme restante. |
| Recapitulările nu apar | Apar doar după primul capitol FINALIZAT (≥80% la un set), la 1 zi / 7 / 30. |
| Tema „din site" nu se bifează | Elevul trebuie să termine exercițiul (scorul se salvează în `progress`); la următoarea deschidere a paginii se bifează automat. |
