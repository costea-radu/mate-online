# Arena matematică — XP, serie de zile, misiunea zilei, liga săptămânală

Pașii 1-2 din planul de gamificare. Scopul: elevul are un motiv să intre **azi**
și un motiv să intre **mâine**, fără ca sistemul să premieze „cine stă mai mult".

---

## 1. Instalare (o singură dată)

1. **Supabase → SQL Editor → New Query** → rulează `supabase/gamificare_v2.sql`.
   Scriptul e idempotent (se poate rula de mai multe ori). Creează:
   `user_stats`, `xp_events`, `daily_missions`, `league_seasons`,
   `league_standings`, funcția `league_join` și coloana `content.difficulty`.

2. **Vercel** — cronul e deja înregistrat în `vercel.json`:
   `/api/gamificare?action=cron-league` la `0 0 * * 1` (luni 03:00 ora României).
   Cere `CRON_SECRET` setat în proiect (ca toate celelalte cronuri).

3. Deploy. Nu e nevoie de nicio variabilă nouă de mediu — cele opționale sunt
   mai jos.

Fără pasul 1 platforma **funcționează normal**: `xp.award()` prinde erorile și
întoarce `null`, iar salvarea scorului rămâne neatinsă.

---

## 2. Cum se calculează XP-ul

`api/_lib/xp.js`, funcția `computeXp`:

```
XP = itemi_corecți × 5 × pondere_dificultate × pondere_precizie × penalizare_reluare
     (+ 15 bonus de progres)      plafon: 100 XP per exercițiu
```

| Factor | Valori |
|---|---|
| Dificultate 1-5 | 0,8 · 1,0 · 1,2 · 1,5 · 1,8 |
| Precizie | ≥90% → ×1,25 · ≥70% → ×1,10 · ≥40% → ×1,00 · sub 40% → ×0,60 |
| Reluare | încercarea *n* → ×`max(0,15; 1/n)` |
| Bonus progres | +15 XP dacă reiei și crești cu ≥20 puncte procentuale |

**Dificultatea** vine din `content.difficulty` (1-5). Dacă e `NULL`, se deduce
din categorie: clasa 5 → 1, clasele 6-7 → 2, clasele 8-9 → 3, clasele 10-11 și
Evaluare Națională → 4, clasa 12 și Bacalaureat → 5. Merită completată manual pe
materialele importante.

**Scor neverificat:** dacă materialul nu are chei citibile (test încărcat
manual), `api/ai-score.js` salvează scorul trimis de browser. În acel caz XP-ul
se reduce la 40% și se plafonează la 30 — scorul rămâne, dar nu merită falsificat
un rezultat ca să urci în ligă.

De ce așa: numărul brut de exerciții premiază elevul care stă cinci ore și
rezolvă lucruri ușoare. Aici contează ce ai rezolvat și cât de corect.

---

## 3. Plafonul zilnic (piesa care schimbă comportamentul)

În **ligă** intră cel mult **200 de puncte pe zi** (≈ 3 exerciții bune). XP-ul
peste plafon se adaugă la totalul elevului și la nivel, dar **nu** în clasament.

Efectul: liga nu se câștigă stând mult într-o zi, ci intrând în fiecare zi.

---

## 4. Seria de zile (streak)

- O zi „se bifează" la **20 XP** strânși în ziua respectivă (≈ 4 itemi corecți).
- 7 zile consecutive → un **scut** 🛡️ (maximum 2). Scutul acoperă automat o
  singură zi ratată, ca prima zi pierdută să nu însemne abandon.
- Ziua calendaristică e calculată în **ora României**, nu UTC.

---

## 5. Misiunea zilei

Un rând în `daily_missions` per elev per zi, generat la prima deschidere a
Arenei sau la primul exercițiu. Trei tipuri, în rotație zilnică:

| Tip | Țintă |
|---|---|
| `corecte` | 8 itemi corecți azi |
| `xp` | 100 XP azi |
| `precizie` | minimum 80% la 2 exerciții |

Recompensă: **50 XP + 10 monede** 🪙. Monedele se adună acum; magazinul de
avataruri/rame/scuturi vine la un pas următor.

---

## 6. Liga săptămânală

- **Cinci divizii:** 🥉 Bronz · 🥈 Argint · 🥇 Aur · 💎 Diamant · 👑 Maestru.
- Elevii sunt împărțiți în **cohorte de maximum 30** din aceeași divizie
  (`league_join`), ca fiecare să se lupte cu cineva la nivelul lui, nu cu tot
  site-ul.
- Săptămâna începe **luni** (ora României).
- Luni la 03:00 cronul închide sezonul: **primii 3 promovează** (dacă au măcar
  un punct), **ultimii 3 retrogradează** — doar în cohorte de cel puțin 8 elevi
  și niciodată sub Bronz. Promovarea aduce +100 XP și 25 🪙.
  Închiderea e reluabilă: procesează doar rândurile fără `outcome`, deci o
  rulare întreruptă nu plătește promovările de două ori. Elevul care deschide
  Arena luni **înainte** de cron e mutat automat în divizia corectă
  (`league_join` îl reașază cât timp are 0 puncte).
- În clasament apar **prenumele și inițiala** („Ana P."), niciodată numele
  complet. Clasamentul se servește prin API, nu direct din baza de date.

---

## 7. Unde se vede

| Loc | Ce arată |
|---|---|
| `/arena` (`src/pages/Arena.jsx`) | nivel, XP, serie, misiunea zilei, clasamentul cohortei, explicația formulei |
| Navbar (`ArenaIndicator.jsx`) | `⚔️ 🔥6 ⭐2450` — cârligul de revenire |
| Exercițiul interactiv | toast „+63 XP" cu nivel nou / misiune / ligă |

---

## 8. Reglaje (variabile de mediu, opționale)

| Variabilă | Implicit | Ce face |
|---|---|---|
| `GAMI_LEAGUE_DAILY_CAP` | 200 | plafonul zilnic de puncte de ligă |
| `GAMI_STREAK_MIN_XP` | 20 | XP-ul minim ca ziua să conteze pentru serie |
| `GAMI_COHORT_SIZE` | 30 | câți elevi într-o cohortă |

Constantele de formulă (5 XP/item, ponderi, plafonul de 100/exercițiu, nivelurile)
sunt în capul lui `api/_lib/xp.js`.

---

## 9. Securitate

- Toate scrierile se fac **pe server**, cu rolul de serviciu. Elevul nu-și poate
  scrie XP-ul din browser (la fel ca `progress` după `progress_server_only.sql`).
- XP-ul se acordă **după** ce `api/ai-score.js` a recalculat scorul din cheile
  materialului — deci nu poate fi obținut trimițând un scor inventat.
- RLS: elevul citește doar propriile rânduri din `user_stats`, `xp_events`,
  `daily_missions`. Tabelele ligii nu au politici — se citesc doar prin API.

---

## 10. Ce NU e acoperit încă

- XP se acordă doar pe drumul exercițiilor interactive (`api/ai-score.js`).
  Corectarea pozelor (`ai-correct`) și temele marcate direct în
  `api/homework.js` nu dau încă XP — se adaugă apelând `xp.award()` și acolo.
- Dueluri 1-la-1, turnee, echipe, harta capitolelor: pașii 3-5.
- Magazinul de monede.

Teste: `npm test` (vezi `test/gamificare.test.js` — formula, plafoanele, zilele
în ora României, rotația misiunii, nivelurile).
