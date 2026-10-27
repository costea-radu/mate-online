# Ghid: „✍️ Spațiu de lucru" — foaia albă care continuă în dreapta

Elevul scrie rezolvarea cu **degetul sau cu creionul**, pe o **foaie albă, fără
linii**, care **nu se termină**: merge mai departe în dreapta (sau în jos) cât
vrea, ca pe tabla interactivă din clasă.

Scrisul **rămâne scris de mână**. Butonul „✨ Transformă în text" a fost **scos**
(27 octombrie 2026): citea greșit scrisul urât, iar corectarea pornea de la un
text deja stricat. Acum „🎓 Cere corectarea" trimite **chiar scrisul** — imaginea
foii — **corectorului**: un model de vedere competent (implicit **Claude Opus
5.5**) îl citește și îl corectează într-un singur pas, **strict după barem**,
unde există. Corectarea face parte din **Premium**.

---

## Unde apare

| Loc | Cum se deschide | Ce se poate face cu scrisul |
|---|---|---|
| **Exerciții interactive** (iframe) | „✍️ Spațiu de lucru" în bara de sus **și** pe fiecare pas / grilă (injectat de `tutorBridge.js`) — fereastră peste exercițiu | `🎓 Cere corectarea`: se deschide Profesorul Virtual, iar corectarea apare acolo (rezolvarea oficială a exercițiului ține loc de barem) |
| **Vizualizatorul PDF** | „✍️ Spațiu de lucru" în **antetul Profesorului Virtual** — foaia ia locul conversației | `🎓 Cere corectarea` (testul + baremul asociat, citite de pe server) · `📎 Pune în întrebare` |
| **Tabla din „Planul meu"** | butonul `✍️` din bara de scris, lângă 📷 și 🎤 | `🎓 Cere corectarea` · `📎 Pune în întrebare` |
| **Formularul „📝 Răspunde în chat"** (tot la tabla din „Planul meu") | „✍️ Spațiu de lucru" sub fiecare cerință | `📎 Atașează la răspuns` → foaia intră la „📷 Poze cu rezolvarea"; o punctează „✅ Corectează" |
| **Sala meditațiilor live / Pregătirea de examen** | „✍️ Caietul meu" din meniu | doar ciornă (fără AI) |

Din **widgetul plutitor** caietul a fost scos mai demult (paginile cu exerciții au caietul lor).
În **testul pe grupă** / **duel** rămâne doar ciorna: fără corectare și fără atașare.

„✓ Pune în răspuns" (scria textul transformat în câmpul pasului) și „📋 Copiază" au
plecat odată cu transformarea în text: răspunsul final se scrie în câmpul pasului, ca
înainte, iar în chat scrisul pleacă **ca imagine** („📎").

---

## Foaia

- **Albă și fără linii peste tot** — și în fereastră, și în zona de conversație
  (`SHEET_BG = '#ffffff'`). Fără marginea roșie de caiet.
- **Nu se termină.** Zona derulabilă are mereu **cu un ecran gol mai mult** decât tot
  ce s-a scris și decât poziția curentă — cât elevul trage foaia spre stânga, ea crește
  odată cu el; când se întoarce, se strânge la loc (dar niciodată sub poziția lui).
- **Paginile** au lățimea zonei vizibile și stau una lângă alta. Jos, în stânga:
  `◀ 2/3 ▶ ⟲` — pagina pe care o vezi / câte ai scris; ◀ ▶ sar exact la pagina vecină,
  ⟲ duce la începutul foii.
- **„➕ Pagină nouă"** (în bara de unelte) duce la **prima pagină goală din dreapta** a tot
  ce s-a scris, de sus. Te întorci trăgând foaia înapoi sau cu ◀.

### Cum se trage foaia

| Cu ce | Cum |
|---|---|
| ✋ **Derulează** | pe telefon: derularea nativă (lină, cu inerție); cu mouse-ul: tragi foaia în orice direcție |
| **Două degete** | în **orice** unealtă (și cât scrii) — ca pe tabla interactivă; trasul abia început cu primul deget se anulează |
| **Rotița** | sus/jos; **Shift + rotița** = lateral; pe touchpad, glisarea laterală merge direct |
| **Rotița apăsată** (butonul din mijloc) | tragi foaia, oricare unealtă e aleasă |
| **Bara de derulare**, **◀ ▶**, **➕ Pagină nouă**, **⟲** | vezi mai sus |

### Uneltele

`✎ Scrie` · `◯ Radieră` (șterge traseele atinse; și capătul-radieră al creionului) ·
`✋ Derulează` · 4 culori (pe ecran îngust, o bulină care trece la următoarea) ·
`↩ Înapoi` (anulează și radiera, și „Șterge tot"; **Ctrl+Z**) · `✕ Șterge tot`.
Creionul (stylus) pornește **respingerea palmei**: din acel moment atingerile cu degetul
nu mai scriu (două degete tot derulează). Traseele sunt netede (punctele intermediare
ale creionului — `getCoalescedEvents`).

### Fereastra (exerciții interactive, „Planul meu", sala live)

Mărimea o alege elevul și rămâne așa (`localStorage`, `sdl:fereastra`): pe calculator
trage de colț / margini, pe telefon de bara de jos; `⛶` sau dublu-clic pe antet = tot
ecranul. **Enunțul** (curat, fără răspunsuri — `collectEnunt()`, plus plasa `cleanEnunt`)
stă într-un panou pliabil deasupra foii. **Pe telefon** fereastra se strânge: unelte doar
cu pictograme, pe un rând; enunțul ocupă cel mult 24% din fereastră; îndrumarea din
subsol dispare — foaia rămâne mare (pe un iPhone SE: ~180 px în loc de 45).

### În zona de conversație (vizualizatorul PDF)

Foaia ia locul mesajelor; sus, rândul de unelte în stilul barei chatului; jos,
plutitoare (după ce scrii), `🎓 Cere corectarea` · `📎 Pune în întrebare`. **Mărimea o
dă panoul** — și rămâne redimensionarea de până acum: pe telefon se trage de bara
albastră, pe calculator panoul se lățește singur cât e deschisă foaia (și revine la
închidere, dacă între timp nu l-ai lățit tu, trăgând de margine — vezi mai jos).

### Ciorna

Locală, în browser: `localStorage`, cheia `sdl2:<cheie>` (aceleași chei ca înainte:
`pdf:<id>`, `ex:<id>`, `chat:…`, `live:<sesiune>`, `pregatire:<poziție>`), cu **poziția pe
foaie**. Se salvează la fiecare traseu și la închiderea paginii. Ciornele vechi (cu
liniile „transformate") se citesc la fel — aceleași coordonate.

---

## Corectarea („🎓 Cere corectarea")

```
foaia (trasee SVG) → exportSheet (src/lib/foaie.js)
   · dale ≤ 2000 × 1800 px, la mărimea reală a scrisului, suprapuse 80 px
   · golurile mari dintre pagini se strâng (compactGaps), max 6 dale
   · miniatura ≤ 16 KB pentru conversație
   ↓
POST /api/ai-handwriting { action:'correct', images, grid, thumb, conversationId,
                           context:{ pdf, contentId, category, title }, exerciseText }
   ↓ Premium? test pe grupă? cota „scris"? limitele + creditele
   ↓ baremul: PDF → testul + baremul DE PE SERVER (ai_pdf_text)
   ↓          interactiv → rezolvarea oficială (răspunsuri + indicații) — nedezvăluită
   ↓          altfel → doar enunțul (fără puncte)
corector (api/_lib/corector.js) — Claude Opus 5.5, imaginile ÎNAINTEA textului,
   gândire adaptivă (efort „low"), JSON pe schemă, fără cache (apel unic)
   ↓ rezervă: GPT-5.6 Terra (cheie lipsă / pană / răspuns stricat)
{ transcriere, itemi:[{ eticheta, verdict, puncte, puncte_max, pasi, motiv_punctaj }], feedback, sfat }
   ↓ punctele ținute în [0, maxim], verdictul aliniat cu punctajul
mesajul profesorului în conversație (+ salvat în ai_messages, cu miniatura foii)
```

**Regulile corectării** (promptul `HW_SYSTEM`): citește rând cu rând, folosind contextul
(enunț, barem, firul calculului) ca să descifreze semnele ambigue (1/7, 4/9, 0/6, x/×,
virgula, minusul vs. bara de fracție) — dar transcrie ce a scris **elevul**; ce nu se
poate citi → `[?]`. **Baremul e singura sursă a punctajului**: puncte doar pentru
elementele atinse efectiv; o metodă corectă diferită primește punctajul corespunzător
(regula oficială); rezultatul corect e cel din barem. Fără barem: verdicte pe pași,
**fără puncte**. Nu dezvăluie rezultatul final dacă elevul a greșit și mai poate corecta
singur — îi dă un indiciu.

**Ce vede elevul** în chat: titlul cu punctajul („**3/5p** (după barem)"), **„Ce am citit
pe foaie"** (ca să vadă dacă scrisul a fost citit corect), **pas cu pas** (✔ ✖ ◐ ❔),
**Punctaj** (pe ce elemente din barem), aprecierea și **💡 sfatul**. Poate întreba mai
departe, în aceeași conversație. Pe tablă (Planul meu), Prof. Tudor spune aprecierea.

**Acces:** doar **Premium** (sau admin) — altfel 402, iar butonul arată ⭐ și explică, cu
link spre abonamente (nu trimite nimic). Oprit în **testul pe grupă** (423). Cotă zilnică
proprie **„✍️ Corectări din spațiul de lucru"** (elev 20/zi, profesor/părinte 10/zi;
apare în „Contul meu → ⚡ Consum AI"). Imaginile **nu se salvează** — doar miniatura, în
conversație.

---

## Modelul și costul

| Variabilă | Implicit | Ce face |
|---|---|---|
| `AI_CORECTOR_MODEL` | `claude-opus-5-5` | corectorul. `claude-…` → Anthropic (`ANTHROPIC_API_KEY`); alt ID (ex. `gpt-5.6-terra`, `google/gemini-3.1-pro-preview` prin AI Gateway) → furnizorul compatibil OpenAI |
| `AI_CORECTOR_MODEL_ECON` | `claude-sonnet-5-5` | peste bugetul zilnic soft al elevului (nu coboară pe un model de chat) |
| `AI_CORECTOR_EFFORT` | `low` | cât „gândește" Claude înainte să corecteze (`medium`/`high` = mai atent, mai scump) |
| `AI_QUOTA_CORECTARI_SCRIS_ZI` | 20 (elev) / 10 | corectări de pe foaie pe zi; fin, per rol: `AI_QUOTAS_JSON={"elev":{"scris":30}}` |
| `AI_HANDWRITING_MODEL`, `AI_QUOTA_SCRIS_ZI` | — | **scoase** (erau pentru transformarea în text) — se pot șterge din Vercel |

Repere (octombrie 2026, 4,6 lei/USD; o corectare: ~3–12k tokeni la intrare — imaginea
foii (o dală ≈ 700–4800 de tokeni), enunțul, iar la un subiect PDF testul și baremul
întregi (~5k) —, ~1–3k la ieșire, cu gândirea):

| Model | Preț (USD / 1M tokeni) | O corectare de pe foaie | 20 de corectări / lună |
|---|---|---|---|
| **Claude Opus 5.5** (implicit) | 4 / 20 | ~0,15–0,5 lei (de obicei ~0,25) | ~3–10 lei |
| Claude Sonnet 5.5 | 2 / 10 | ~0,07–0,25 lei | ~1,5–5 lei |
| GPT-5.6 Terra (rezerva) | 2 / 12 | ~0,08–0,3 lei | ~1,6–6 lei |
| Gemini 3.1 Pro (prin AI Gateway) | 2 / 12 | ~0,08–0,3 lei | ~1,6–6 lei |
| Claude Haiku 5.5 | 0,10 / 0,50 | ~0,004–0,012 lei | sub 0,3 lei |

Corectările intră în creditele elevului ca orice acțiune AI (plafonul lunar implicit:
12 lei din abonamentul de 50 lei — cu Opus 5.5, ~25–80 de corectări pe lună, dacă elevul
nu folosește altceva; cota zilnică de 20 nu e plafonul real).

---

## Fereastra Profesorului Virtual, pe calculator

Pe telefon, panoul de lângă PDF / exercițiu se trage **în sus și în jos** de bara
albastră. Pe calculator se trage **lateral**, de **marginea stângă** (linia aurie, cu
liniuța din mijloc): spre stânga se lățește, spre dreapta se îngustează — între 320 px
și cât lasă loc materialului (300 px). **Dublu-clic** pe mâner: lățime mare / obișnuită
(la fel butonul `□ / ❐` din antet). Lățimea se ține minte (`pv:latime`). La fel și
**widgetul plutitor** de pe tot site-ul (`pv:widget`, marginea lui stângă). Cât tragi, un
strat transparent acoperă pagina (PDF-ul și exercițiul sunt în iframe-uri, care altfel
„fură" mouse-ul).

---

## Fișierele

| Fișier | Ce e |
|---|---|
| `src/components/SpatiuDeLucru.jsx` | foaia: SVG + derulare nativă, unelte, pagini, ciornă, butoanele |
| `src/lib/foaie.js` | geometria foii și imaginea pentru corector: `pathD`, `planTiles`, `compactGaps`, `exportSheet` |
| `api/ai-handwriting.js` | endpointul de corectare (era cel de transcriere) |
| `api/_lib/corector.js` | corectorul: modelul, apelul Claude / rezerva, promptul, normalizarea, mesajul |
| `api/ai-correct.js` | `grade`: cu poze → corectorul + Premium |
| `api/_lib/claude.js` | `chatAdvanced({ cache:false })`; Haiku 5.5 în listă |
| `api/_lib/ai.js` | cota `scris`, prețul Haiku 5.5 |
| `src/components/AITutor.jsx` | `correctHandwriting`, `attachToQuestion`, `attachToForm`, `autoCorrect`; mânerul widgetului |
| `src/pages/InteractiveViewer.jsx` | caietul peste exercițiu → `autoCorrect`; mânerul panoului |
| `src/pages/PDFViewer.jsx` | caietul în conversație; mânerul panoului |
| `src/lib/latimePanou.js`, `src/components/ManerLatime.jsx` | lățimea ferestrei profesorului pe calculator |
| `src/lib/aiClient.js` | `aiClient.corectareScris(…)` |
| `test/spatiu-de-lucru.test.js`, `test/corector-scris.test.js`, `test/pdf-barem-spatiu.test.js` | regresiile |

---

## Probleme și ce se întâmplă

| Situație | Comportament |
|---|---|
| Elev fără abonament apasă „🎓 Cere corectarea" | banda ⭐ „Corectarea face parte din abonamentul Premium" + link; nu pleacă nimic |
| Foaia goală | „Scrie întâi rezolvarea pe foaie." |
| Scris complet ilizibil | „Nu am reușit să citesc rezolvarea de pe foaie" + ce a putut desluși + sfat (scrie mai mare și mai rar) |
| Claude nu răspunde / cheia lipsește | corectează rezerva (GPT-5.6 Terra) — elevul primește corectarea oricum |
| Nici rezerva nu reușește | 502 „Corectarea nu a reușit acum…" (fără mesajul tehnic); nu se consumă din cotă |
| Cota zilnică atinsă / creditele terminate | mesajul obișnuit al limitelor (429), cu pachetele AI |
| S-a scris foarte mult spre dreapta | foaia pleacă în mai multe bucăți (≤ 6); golurile dintre pagini se strâng; peste, scrisul se micșorează treptat |
| Al doilea deget atinge foaia cât scrii | trasul abia început se anulează și foaia se derulează (un traseu lung, deja scris, rămâne) |
| Test pe grupă | doar ciorna; serverul refuză oricum (423) |
| Ciorna nu încape în `localStorage` | foaia merge mai departe, doar nu se mai salvează |
