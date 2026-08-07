# 💰 Limite de consum AI — cost per acțiune + bugete (zi / lună)

Acest sistem transformă fiecare acțiune AI în **bani** (micro-lei) la logare și aplică
bugete per utilizator, ca serviciile AI comerciale: sub limite nu se simte nimic,
peste limita zilnică „soft" cererile trec **automat pe un model mai ieftin**
(degradare, nu blocare), iar limitele „hard" opresc politicos AI-ul până la resetare.
Restul platformei (materiale, exerciții, rezolvări) nu e afectat niciodată.

**De ce în bani, nu în număr de mesaje?** Un mesaj de chat pe `gpt-4o-mini` costă
~0,005 lei, dar o corectare de test pe modelul premium costă ~0,65 lei — de peste
100× mai mult. Numărând „mesaje" ai limita degeaba chatul ieftin și ai lăsa liberă
exact partea scumpă. Intern totul se măsoară în micro-lei; în UI poți afișa ce vrei
(număr de acțiuni, procent din buget — datele sunt în `budget` din `/api/ai-progress`).

---

## 🚀 Instalare (2 pași, în această ordine)

### Pasul 1 — Baza de date (ÎNTÂI!)

Supabase → **SQL Editor** → **New Query** → lipește tot conținutul din
**`supabase/ai_limite_cost.sql`** → **Run**. Scriptul e idempotent (poate fi rulat
de mai multe ori) și adaugă:

| Ce | Rol |
|---|---|
| `ai_usage.model` (coloană) | modelul LLM al fiecărei acțiuni |
| `ai_usage.cost_micro` (coloană) | costul acțiunii în micro-lei (1 leu = 1.000.000) |
| `ai_spent(...)` (funcție) | sumele consumate azi / în 30 de zile — o singură interogare, doar pentru server |
| `ai_usage_daily` (vedere) | monitorizare pe zi × endpoint × model, cu cost în lei |

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
`api/_lib/ai.js`, potrivire pe cel mai lung prefix — „gpt-5.6-terra" nimerește
intrarea „gpt-5.6"), convertit în lei cu `AI_USD_RON` (default 4,6 — ține-l puțin
peste cursul real, ca marjă). Whisper (STT) are cost fix estimat per apel.
**Model necunoscut → preț implicit CONSERVATOR** (3/15 USD) + avertisment în loguri
— adaugă-l în `AI_PRICES_JSON` ca să fie exact. Streamingul loghează acum usage-ul
REAL (`stream_options.include_usage`), nu estimarea `lungime/4` de dinainte.

### Ce vede elevul

- Sub limite: nimic diferit.
- Peste limita soft: răspunsurile vin de la modelul mai ieftin (fără mesaj de eroare).
- Peste hard/lunar: mesaj prietenos („Ai atins limita zilnică... Se resetează la miezul nopții") — fără termeni tehnici.
- `/api/ai-progress` întoarce acum și `budget: { dayLei, monthLei, dayActions, monthActions, limits, degraded, exempt }` — poți afișa în UI „azi: N acțiuni" sau o bară de progres. `null` până rulezi migrarea.

---

## 🎛️ Calibrare

Abonamentul e 50 lei/lună. Defaulturile alocă AI-ului maxim 6 lei/utilizator/lună
(12%), cu netezire zilnică. Repere la prețurile din august 2026:

| Acțiune | Cost aproximativ |
|---|---|
| mesaj chat (gpt-4o-mini, cu RAG) | ~0,005 lei |
| generare exercițiu / verificare | ~0,01–0,02 lei |
| generare test de examen (GEN premium) | ~0,1–0,3 lei |
| corectare test (PDF_MODEL flagship, ex. gpt-5.6) | ~0,4–0,9 lei |

Deci defaulturile înseamnă, practic: sute de mesaje de chat pe zi SAU ~3 corectări
premium pe zi, și ~9–15 corectări premium pe lună — un elev normal nu le atinge
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
| În loguri: „Bugetele AI inactive — funcția SQL ai_spent lipsește" | Rulează `supabase/ai_limite_cost.sql` (Pasul 1). Totul merge, dar fără bugete. |
| În loguri: „ai_usage fără coloanele model/cost_micro" | Același lucru — migrarea nerulată; se loghează în forma veche. |
| În loguri: „model necunoscut «X» — aplic prețul implicit" | Adaugă modelul în `AI_PRICES_JSON` cu prețul lui real. Până atunci se supraestimează (3/15 USD/1M). |
| Un elev se plânge că „AI-ul răspunde mai simplu" azi | A trecut de limita zilnică soft → modelul economic. Se resetează la miezul nopții. |
| Eroare 429 cu `BUDGET_DAY` / `BUDGET_MONTH` prea des | Mărește `AI_BUDGET_DAY_HARD_LEI` / `AI_BUDGET_MONTH_LEI` în Vercel (redeploy) — sau verifică în top 10 dacă nu e abuz real. |
| Adminul e limitat | Nu ar trebui (scutit prin `is_admin`). Excepție: rata orară se aplică și adminului, ca înainte. |
| Vrei costul REAL, nu estimat | Verifică `AI_USD_RON` și prețurile din tabel față de facturile furnizorului; ajustează prin env. |

---

## 🔮 Pașii următori (din planul de limitare a costurilor)

1. **Cote vizibile per funcție** în UI („corectări: 7/10 luna asta") pe baza `budget` din ai-progress.
2. **Pachete top-up prin Stripe** (`mode: 'payment'`) consumate după bugetul lunar — plus, eventual, un tier Premium+ cu bugete mai mari.
3. **Prompt caching** (reordonarea system promptului: partea statică prima) și **pre-generare** de explicații per exercițiu (Batch API, −50%).
4. **Alerte automate** (cron zilnic cu email către admin peste un prag de cost/zi).
