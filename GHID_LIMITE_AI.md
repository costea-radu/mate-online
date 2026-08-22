# 💰 Limite de consum AI — cost per acțiune, bugete, cote și pachete top-up

Acest sistem transformă fiecare acțiune AI în **bani** (micro-lei) la logare și aplică
bugete per utilizator, ca serviciile AI comerciale: sub limite nu se simte nimic,
peste limita zilnică „soft" cererile trec **automat pe un model mai ieftin**
(degradare, nu blocare), iar limitele „hard" opresc politicos AI-ul până la resetare.
Restul platformei (materiale, exerciții, rezolvări) nu e afectat niciodată.

**Pasul 2 (inclus):** cote **vizibile per funcție** („Corectări: 3/10 luna aceasta")
și **pachete top-up prin Stripe** — după epuizarea bugetului inclus, utilizatorul
poate plăti o sumă unică pentru buget suplimentar (cu marjă de profit), exact
mecanismul serviciilor AI comerciale.

**Pasul 3 (inclus):** REDUCEREA costului în sine, nu doar limitarea lui:
**prompt caching** (promptul de sistem reordonat — partea statică devine prefix
identic, pe care furnizorul îl cachează automat cu reducere mare la intrare) și
**pre-generarea explicațiilor per exercițiu** (baza de exerciții e finită —
explicația canonică se generează O DATĂ, offline, și se servește apoi cu cost 0).

**Pasul 4 (inclus, ultimul):** OCHII pe sistem — **raport zilnic de cost pe
email** (pe funcții + top utilizatori + economia din pre-generare) și **alarmă
🚨 în cel mult 10 minute** când costul zilei trece de un prag, cu dedup „o dată
pe zi". Ambele pe cron-urile existente, fără infrastructură nouă.

**De ce în bani, nu în număr de mesaje?** Un mesaj de chat pe `gpt-4o-mini` costă
~0,005 lei, dar o corectare de test pe modelul premium costă ~0,65 lei — de peste
100× mai mult. Numărând „mesaje" ai limita degeaba chatul ieftin și ai lăsa liberă
exact partea scumpă. Intern totul se măsoară în micro-lei; în UI poți afișa ce vrei
(număr de acțiuni, procent din buget — datele sunt în `budget` din `/api/ai-progress`).

---

## 🚀 Instalare (2 pași, în această ordine)

### Pasul 1 — Baza de date (ÎNTÂI!)

Supabase → **SQL Editor** → **New Query** → rulează, în ordine, cele două scripturi
(idempotente — pot fi rulate de mai multe ori):

**1a. `supabase/ai_limite_cost.sql`** (dacă nu l-ai rulat deja):

| Ce | Rol |
|---|---|
| `ai_usage.model` (coloană) | modelul LLM al fiecărei acțiuni |
| `ai_usage.cost_micro` (coloană) | costul acțiunii în micro-lei (1 leu = 1.000.000) |
| `ai_spent(...)` (funcție) | sumele consumate azi / în 30 de zile — o singură interogare, doar pentru server |
| `ai_usage_daily` (vedere) | monitorizare pe zi × endpoint × model, cu cost în lei |

**1b. `supabase/ai_topup.sql`** (pachetele top-up):

| Ce | Rol |
|---|---|
| `ai_topups` (tabelă) | pachetele cumpărate: credit în micro-lei, valabilitate, id-ul sesiunii Stripe (idempotență) |
| `ai_spent2(...)` (funcție) | ca `ai_spent`, dar întoarce și creditul top-up activ + expirarea lui |

**1c. `supabase/ai_pregen.sql`** (explicațiile pre-generate, pasul 3):

| Ce | Rol |
|---|---|
| `ai_pregen` (tabelă) | explicația + indiciul canonic per material, cu hash-ul sursei (detectează învechirea) |
| `ai_pregen_candidates(...)` (funcție) | materialele care au nevoie de (re)generare — lipsă sau editate între timp |

**1d. `supabase/ai_alerte.sql`** (alertele de cost, pasul 4):

| Ce | Rol |
|---|---|
| `ai_cost_alerts` (tabelă) | dedup: alarma de prag se trimite cel mult o dată pe zi (inserție atomică) |
| `ai_cost_breakdown(...)` (funcție) | costul pe endpoint × model într-o fereastră de timp |
| `ai_top_users(...)` (funcție) | top utilizatori după cost (user NULL = costurile de platformă) |

### Pasul 2 — Deploy pe Vercel

Fă deploy cu codul actualizat. **Nu e nevoie de nicio variabilă de mediu nouă** —
limitele au valori implicite rezonabile. Dacă vrei să le ajustezi, vezi mai jos.

> **Ordinea contează, dar nu strică nimic:** codul e scris să meargă și fără
> migrare (loghează în forma veche și NU aplică bugete, cu un avertisment în
> logurile Vercel: „Bugetele AI inactive — rulează supabase/ai_limite_cost.sql").
> Abia după migrare încep să se strângă costurile și să se aplice limitele.
> Rândurile logate înainte de migrare au cost 0 — în primele 30 de zile după
> instalare, consumul „lunar" al utilizatorilor vechi pornește deci de la 0.

---

## ⚙️ Cum funcționează

### Lanțul de limite (în `ai.enforceRateLimit`, apelat de toate endpoint-urile AI)

1. **Rata orară** (`AI_RATE_PER_HOUR`, default 80/oră) — anti-abuz, ca înainte. Eroare 429, `code: 'RATE_HOUR'`.
2. **Bugetul lunar** (`AI_BUDGET_MONTH_LEI`, default **6 lei / 30 de zile rulante**) — plafonul economic al abonamentului. Eroare 429, `code: 'BUDGET_MONTH'`.
3. **Bugetul zilnic hard** (`AI_BUDGET_DAY_HARD_LEI`, default **2,5 lei/zi**) — oprește AI-ul până la miezul nopții (ora României). Eroare 429, `code: 'BUDGET_DAY'`.
4. **Bugetul zilnic soft** (`AI_BUDGET_DAY_SOFT_LEI`, default **0,8 lei/zi**) — NU blochează: marchează cererea „degradată", iar endpoint-urile aleg un model mai ieftin.

Adminii sunt scutiți de bugete (rata orară rămâne). „Ziua" = miezul nopții pe ora
României; „luna" = ultimele 30 de zile rulante (nu se poate „arde" totul pe 1 ale lunii).

### Degradarea (limita soft)

`ai.pickModel(modelPreferat, lim)` alege modelul după starea bugetului:

| Sub limita soft | Peste limita soft |
|---|---|
| chat → `AI_CHAT_MODEL` | chat → `AI_ECON_CHAT_MODEL` (default `gpt-4o-mini`) |
| corectare/generare → `AI_PDF_CHAT_MODEL` / `AI_GEN_CHAT_MODEL` | → `AI_CHAT_MODEL` (modelul standard) |

Folosită în: chat (normal + streaming, inclusiv agentul PDF), corectarea de teste
(formular + notare), generarea de teste de examen, exercițiile interactive,
antrenament (generare + verificare), temele de la profesor, lecțiile de la meditații.
(Sub-apelurile interne din meditații — quiz-ul inițial, remedierea — rămân pe modelul
lor; sunt acoperite de limitele hard.)

### Costul per acțiune

La `ai.logUsage` fiecare acțiune primește `model` + `cost_micro`:
`tokeni_intrare × preț_in + tokeni_ieșire × preț_out` (USD/1M, tabelul din
`api/_lib/ai.js`, potrivire pe cel mai lung prefix — „gpt-5.6-terra-2026-08-01"
nimerește intrarea „gpt-5.6-terra"; cele două modele gpt-5.6 folosite au intrări
SEPARATE: terra 2/12, sol 4/20 USD/1M, iar o variantă gpt-5.6 fără intrare
proprie cade pe „gpt-5.6" = 5/30, conservator), convertit în lei cu `AI_USD_RON` (default 4,6 — ține-l puțin
peste cursul real, ca marjă). Whisper (STT) are cost fix estimat per apel.
**Model necunoscut → preț implicit CONSERVATOR** (3/15 USD) + avertisment în loguri
— adaugă-l în `AI_PRICES_JSON` ca să fie exact. Streamingul loghează acum usage-ul
REAL (`stream_options.include_usage`), nu estimarea `lungime/4` de dinainte.

### Cotele per funcție, PER ROL, cu pool comun (pasul 2, extins)

Peste bugetele în bani, funcțiile scumpe au cote **vizibile**, numărate din
`ai_usage` (fereastră de 30 de zile, respectiv ziua curentă la foto).
Limitele diferă după rolul contului:

| Funcție (endpoint numărat) | Elev / Părinte | Profesor |
|---|---|---|
| 📝 Corectări de teste (`ai-correct:grade`) | **20 / lună** | **5 / lună** |
| 📄 Subiecte de examen (`ai-exam`) | 20 / lună | **40 / lună** |
| 🧩 Exerciții interactive (`ai-generate-interactive`) | 40 / lună | 40 / lună |
| 📷 Foto-rezolvări (`ai-vision`) | 10 / zi | 10 / zi |

Reglaje: env-urile `AI_QUOTA_*` (global, toate rolurile) sau
`AI_QUOTAS_JSON='{"profesor":{"corectari":3}}'` (fin, per rol). 0 = dezactivată.

**Pool comun (transfer între cote):** cotele LUNARE se completează între ele —
limita reală e SUMA lor (elev: 20+20+40 = 80 de acțiuni lunare). Când o cotă
se termină, acțiunile în plus consumă din rezerva celorlalte, iar în UI apare
pe cota-sursă „↪ N transferate la «Corectări de teste»", iar pe cea depășită
„20/20 +N din alte cote". Alocarea e derivată aritmetic din numărători (nimic
stocat — fereastra alunecă și totul se recalculează). Foto rămâne separată
(fereastră zilnică, nu se amestecă cu cele lunare). Bugetele în BANI rămân
plafonul suprem — pool-ul nu poate ocoli costul.

Adminii sunt scutiți. Pool epuizat → eroare 429 cu `code: 'QUOTA_FEATURE'` +
`feature: '<cheia>'` și un mesaj care trimite spre pachete. **Cu un pachet
top-up activ, cotele nu se aplică** — utilizatorul a plătit pentru capacitate,
îl oprește doar bugetul efectiv (bază + credit).

### Pachetele top-up (pasul 2)

- Definite în `AI_TOPUP_PACKS_JSON` (implicit: **Pachet AI Mic — 10 lei → +4 lei buget**, **Pachet AI Mare — 20 lei → +10 lei buget**; marjă ~2,5×). Valabilitate `AI_TOPUP_DAYS` (implicit 30 de zile — aceeași fereastră ca bugetul rulant, deci semantica e „+X lei la luna curentă").
- **Doar pentru abonați** (plată unică `mode: 'payment'`, prin `create-checkout` cu `type: 'topup'`); creditarea o face `stripe-webhook` la `checkout.session.completed`, idempotent pe `stripe_session_id` — nu e nevoie de NICIO configurare nouă în Stripe (webhookul existent primește deja evenimentul).
- Cât timp există credit activ: bugetul lunar efectiv crește cu creditul, **degradarea pe model ieftin și limita zilnică hard nu se aplică**, iar cotele per funcție sunt deblocate. Mesajul de „buget epuizat" trimite spre pachete.
- Plasă de siguranță: dacă tabela `ai_topups` lipsește (migrarea nerulată), cumpărarea e refuzată ÎNAINTE de plată (503), iar dacă webhookul nu poate credita o plată deja încasată, întoarce 500 (Stripe reîncearcă automat → se vindecă singur după migrare) și primești email de alertă 🚨.

### Prompt caching (pasul 3) — reducere automată pe intrare

`systemFor()` (promptul chatului) e acum ordonat: **partea statică întâi**
(persona + recomandări + rolul modului — identică la fiecare cerere cu același
mod, ~1050–1100 tokeni la elevi), **partea variabilă după** (contextul RAG al
întrebării + detaliile cererii). OpenAI cachează automat prefixele identice de
≥1024 tokeni — reducerea pe intrarea repetată se aplică singură, fără nicio
configurare. Două atenționări: (1) NU muta contextul RAG înapoi înaintea
rolului — sparge prefixul cacheabil; (2) dacă scurtezi `PERSONA`, prefixul
poate coborî sub pragul de 1024 tokeni și cachingul nu se mai declanșează
(testul `pregen-cache.test.js` verifică mărimea). La mentori (persona scurtă)
prefixul e sub prag — volumul lor e mic, nu contează.

### Pre-generarea explicațiilor (pasul 3) — cost 0 la servire

Baza de exerciții e finită, deci „explică-mi exercițiul X" are un răspuns bun
COMUN tuturor elevilor. Sistemul îl generează O DATĂ și îl refolosește:

- **Generarea** rulează pe cronul EXISTENT de ingest (fără cron nou), doar când
  coada de indexare e goală (cunoștințele sunt la zi): câte `AI_PREGEN_BATCH`
  (implicit 3) materiale per rulare, explicație + indiciu fiecare, pe modelul
  ieftin (`AI_PREGEN_MODEL`, implicit modelul de chat). Costul e de PLATFORMĂ
  (logat cu `user_id null`, endpoint `ai-pregen:*`) — nu intră în bugetul
  niciunui elev. La ~2.000 de materiale, generarea completă costă câțiva dolari,
  O SINGURĂ DATĂ; materialele editate se regenerează singure (hash pe sursă).
- **Servirea** (în `ai-chat` + `ai-chat-stream`) e conservatoare — răspunsul
  pre-generat se dă DOAR când: modul e `explain`/`hint` cu `context.contentId`,
  e PRIMUL mesaj din conversație, cererea e CANONICĂ („explică-mi", „nu înțeleg",
  „dă-mi un indiciu" — sub 120 de caractere), iar materialul e gratuit sau elevul
  e abonat. Orice întrebare specifică merge pe fluxul normal, personalizat.
  Servirile apar în jurnal ca `ai-chat:pregen` / `ai-chat-stream:pregen`, cu
  cost 0 — în `ai_usage_daily` vezi exact câți bani economisește.
- **Batch API (−50%)**: am ales intenționat generarea prin cron pe modelul
  ieftin în locul Batch API-ului — la costul unic de câțiva dolari, economia de
  50% nu justifică infrastructura de fișiere JSONL + polling de 24h. Dacă baza
  crește la zeci de mii de materiale, reconsiderăm.

### Alertele de cost (pasul 4) — ochii pe sistem, fără să te uiți tu

- **Raportul zilnic** (`_lib/costwatch.js` → `dailyReport`): vine pe emailul de
  admin odată cu scanarea zilnică existentă (`/api/ai-notify?action=scan`,
  cron la 17:00 UTC / 20:00 România): costul ultimelor 24h, defalcat pe funcții,
  top 5 utilizatori (inclusiv „(platformă)" = pre-generarea) și câte răspunsuri
  s-au servit GRATUIT din pre-generare. Nu se trimite când nu a existat
  activitate. Oprire: `AI_COST_REPORT=0`.
- **Alarma 🚨 de prag** (`checkThreshold`): pe cronul de ingest (la 10 minute),
  o interogare agregată ieftină compară costul de AZI (de la miezul nopții, ora
  României — aceeași „zi" ca limitele utilizatorilor) cu `AI_ALERT_DAY_LEI`
  (implicit **20 lei/zi pe toată platforma**; 0 = oprit). Peste prag → email
  imediat, cu top-ul funcțiilor vinovate și pașii de verificare. Dedup atomic în
  `ai_cost_alerts` — cel mult o alarmă pe zi, chiar cu rulări simultane; dacă
  emailul pică, dedup-ul se retrage și următoarea rulare reîncearcă.
- Ambele sunt best-effort: fără migrarea 1d sau fără SMTP configurat se retrag
  tăcut (avertisment în loguri) și nu ating niciodată indexarea sau notificările
  pe care „călătoresc".

### Ce vede utilizatorul

- Sub limite: nimic diferit.
- Peste limita soft: răspunsurile vin de la modelul mai ieftin (fără mesaj de eroare).
- Peste hard/lunar sau peste o cotă: mesaj prietenos, cu invitația de a continua cu un pachet.
- **UI (pasul 2):** componenta `AILimite` afișează „Utilizare AI luna aceasta" (procent, fără lei), cotele per funcție cu bare, pachetul activ + expirarea și butoanele de cumpărare. Locul ei principal: **„Contul meu" (`/profil`), rolldown-ul „⚡ Consum AI" de sub cardul Abonament — pentru TOATE rolurile** (elev, profesor, părinte). Elevii o văd și sus în „📈 Progresul meu" (pagina Profesor Virtual). După plată, Stripe redirecționează către `/profil?topup=succes`, iar rolldown-ul se deschide singur cu confirmarea.
- `/api/ai-progress` întoarce `budget: { dayLei, monthLei, dayActions, monthActions, limits, effectiveMonthLei, topup:{creditLei,active,expiresAt,days}, packs, features[], degraded, exempt }`. `null` până rulezi migrarea.

---

## 🎛️ Calibrare

Abonamentul e 50 lei/lună. Defaulturile alocă AI-ului maxim 6 lei/utilizator/lună
(12%), cu netezire zilnică. Repere la prețurile din august 2026:

| Acțiune | Cost aproximativ |
|---|---|
| mesaj chat (gpt-4o-mini, cu RAG) | ~0,005 lei |
| generare exercițiu / verificare | ~0,01–0,02 lei |
| generare test de examen (GEN premium) | ~0,1–0,3 lei |
| corectare test (PDF_MODEL = gpt-5.6-terra, 2/12 USD/1M) | ~0,15–0,4 lei |

(Până pe 22 august 2026 terra era contorizat la prețul lui sol, 5/30 — o corectare
„costa" în contor ~0,4–0,9 lei, de 2,5× mai mult decât real; vezi CHANGELOG.)

Deci defaulturile înseamnă, practic: sute de mesaje de chat pe zi SAU ~6–15 corectări
premium pe zi (cu degradare pe modelul standard după ~2–4, la limita soft de 0,8 lei),
și ~15–40 corectări premium pe lună — un elev normal nu le atinge
niciodată; doar utilizarea extremă e limitată. După 2–3 săptămâni de date, uită-te
în `ai_usage_daily` și ajustează în Vercel → Environment Variables (redeploy).

Dezactivare: setează limita respectivă la `0`. Kill-switch total nu există încă —
dacă vrei oprire de urgență, pune `AI_RATE_PER_HOUR=0` (blochează toate cererile AI).

---

## 📊 Monitorizare (SQL Editor)

```sql
-- consumul pe zile, endpoint-uri și modele
select * from ai_usage_daily where zi > current_date - 14;

-- costul total al platformei pe ultimele 30 de zile
select round(sum(cost_lei), 2) as lei from ai_usage_daily where zi > current_date - 30;

-- top 10 utilizatori după cost (30 de zile)
select u.user_id, p.email, round(sum(u.cost_micro)/1e6::numeric, 2) as lei, count(*) as actiuni
from ai_usage u left join profiles p on p.id = u.user_id
where u.created_at > now() - interval '30 days'
group by 1, 2 order by lei desc limit 10;
```

**Recomandat în plus (5 minute):** setează un buget lunar HARD și în dashboardurile
furnizorilor (OpenAI → Billing → Limits; Anthropic → Plans & Billing) — e singura
protecție care funcționează și la un bug de cod, iar limitele din site nu te apără
de propriul cod.

---

## 🛠️ Depanare

| Simptom | Cauză / soluție |
|---|---|
| În loguri: „Bugetele AI inactive — funcția SQL ai_spent lipsește" | Rulează `supabase/ai_limite_cost.sql` (Pasul 1a). Totul merge, dar fără bugete. |
| În loguri: „Pachetele top-up inactive — rulează supabase/ai_topup.sql" | Rulează `supabase/ai_topup.sql` (Pasul 1b). Bugetele merg, dar fără credit top-up. |
| În loguri: „ai_usage fără coloanele model/cost_micro" | Același lucru — migrarea nerulată; se loghează în forma veche. |
| În loguri: „model necunoscut «X» — aplic prețul implicit" | Adaugă modelul în `AI_PRICES_JSON` cu prețul lui real. Până atunci se supraestimează (3/15 USD/1M). |
| Un elev se plânge că „AI-ul răspunde mai simplu" azi | A trecut de limita zilnică soft → modelul economic. Se resetează la miezul nopții (sau imediat, cu un pachet). |
| Eroare 429 cu `BUDGET_DAY` / `BUDGET_MONTH` prea des | Mărește `AI_BUDGET_DAY_HARD_LEI` / `AI_BUDGET_MONTH_LEI` în Vercel (redeploy) — sau verifică în top 10 dacă nu e abuz real. |
| Eroare 429 cu `QUOTA_FEATURE` prea des | Mărește cota funcției respective (`AI_QUOTA_*`) — sau lasă pachetele să facă upsell-ul. |
| „Pachetele AI nu sunt încă activate" la cumpărare | Tabela `ai_topups` lipsește → rulează `supabase/ai_topup.sql`. Protecția refuză plata ca să nu încaseze bani necreditabili. |
| Email 🚨 „Top-up plătit dar NECREDITAT" | Webhookul n-a putut scrie creditul (de obicei migrarea nerulată). Stripe reîncearcă automat; după migrare se creditează singur. Verifică apoi în `ai_topups`. |
| Pachetul plătit nu apare imediat în UI | Webhookul rulează la câteva secunde după redirect. Reîncarcă pagina. Dacă nu apare în ~1 minut, vezi rândul de mai sus. |
| Adminul e limitat | Nu ar trebui (scutit prin `is_admin`). Excepție: rata orară se aplică și adminului, ca înainte. |
| Vrei costul REAL, nu estimat | Verifică `AI_USD_RON` și prețurile din tabel față de facturile furnizorului; ajustează prin env. |
| În loguri: „Pre-generarea inactivă — rulează supabase/ai_pregen.sql" | Migrarea 1c nerulată. Chatul merge normal, doar fără servire cu cost 0. |
| În loguri: „Alertele de cost inactive — rulează supabase/ai_alerte.sql" | Migrarea 1d nerulată. Totul merge, doar fără raport/alarmă. |
| Nu primești raportul zilnic | Verifică: SMTP configurat (mailer), `AI_COST_REPORT` nu e 0, a existat activitate AI în 24h, cronul ai-notify rulează (Vercel → Crons). |
| Vrei să testezi alarma fără să aștepți | Pune temporar `AI_ALERT_DAY_LEI=0.01`, redeploy, apasă „Procesează coada" din Admin → emailul 🚨 vine la prima rulare; apoi pune pragul la loc și șterge rândul din `ai_cost_alerts` dacă vrei să retestezi în aceeași zi. |
| Pre-generarea nu avansează (`pregen_pending` mare la Stats) | Cronul rulează pregen doar când coada de indexare e goală; verifică `pending_queue`. Sau apasă „Procesează coada" din Admin de câteva ori. |
| Un elev primește o explicație „prea generică" | A nimerit servirea canonică. E răspunsul standard al materialului; orice întrebare de continuare intră pe fluxul normal, personalizat. Dacă deranjează, `AI_PREGEN_DISABLED=1`. |

---

## 🔮 Pașii următori (din planul de limitare a costurilor)

1. ✅ ~~Cote vizibile per funcție în UI~~ — implementat (pasul 2).
2. ✅ ~~Pachete top-up prin Stripe~~ — implementat (pasul 2). Rămâne opțional: un tier **Premium+** (abonament mai scump cu bugete mai mari) pentru utilizatorii care cumpără pachete lună de lună — vezi în `ai_topups` cine cumpără repetat.
3. ✅ ~~Prompt caching + pre-generare de explicații per exercițiu~~ — implementat (pasul 3).
4. ✅ ~~Alerte automate de cost~~ — implementat (pasul 4). **Planul e complet.**

Singura piesă care rămâne MANUALĂ (și merită cele 5 minute): plafoanele hard din
dashboardurile furnizorilor (OpenAI → Billing → Limits; Anthropic → Plans &
Billing) — apărarea de ultimă instanță, care funcționează și când site-ul însuși
are un bug.
