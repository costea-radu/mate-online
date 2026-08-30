# Arena matematică — XP, ligă, dueluri, turnee, harta capitolelor

Pașii 1-5 din planul de gamificare. Scopul: elevul are un motiv să intre **azi**
și un motiv să intre **mâine**, fără ca sistemul să premieze „cine stă mai mult".

Cele trei straturi:

| Strat | Ce rezolvă | Ritm |
|---|---|---|
| Harta capitolelor | „ce fac azi?" — direcție și structură | luni–ani |
| XP · streak · misiunea zilei · liga | „de ce să intru azi?" | zile–săptămâni |
| Dueluri · turnee | „de ce să-mi pese?" | evenimente |

---

## 1. Instalare (o singură dată)

1. **Supabase → SQL Editor → New Query** → rulează, în ordine:

   | Script | Ce creează |
   |---|---|
   | `supabase/gamificare_v2.sql` | `user_stats`, `xp_events`, `daily_missions`, `league_seasons`, `league_standings`, funcțiile `league_join` / `xp_bump` / `league_add`, coloana `content.difficulty` |
   | `supabase/gamificare_v3_dueluri.sql` | `duels` + `user_stats.duels_open` |
   | `supabase/gamificare_v4_turnee.sql` | `tournaments`, `tournament_items`, `tournament_scores`, `tournament_places` |
   | `supabase/gamificare_v5_harta.sql` | `chapter_state` + coloana `content.chapter_id` |
   | `supabase/gamificare_v6_public.sql` | turnee publice: `tournaments.scope`/`auto`, `tournament_entries` |
   | `supabase/gamificare_lints.sql` | politici explicite `service_role` (închide avertismentele INFO ale linterului) |

   Toate sunt idempotente (se pot rula de mai multe ori).

2. **Vercel** — cronurile sunt deja în `vercel.json`, toate cer `CRON_SECRET`:

   | Cron | Când | Ce face |
   |---|---|---|
   | `/api/gamificare?action=cron-league` | luni 03:00 RO | promovări și retrogradări în ligă |
   | `/api/duel?action=cron` | la 6 ore | închide duelurile depășite (neprezentare) |
   | `/api/turneu?action=cron` | la 6 ore | închide turneele expirate și dă premiile |

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

## 10. Dueluri 1-la-1 (pasul 3)

`api/_lib/duel.js` · `api/duel.js` · `src/components/DueluriPanel.jsx`

**Asincron, nu live:** cei doi primesc același test interactiv și au **48 de ore**,
fiecare rezolvă când poate. Un duel live ar cere ca amândoi să fie online simultan.

- provoci doar un **coleg acceptat** (`buddies`), maximum **5 provocări pe zi**;
- o singură provocare neîncheiată între aceiași doi elevi (index unic parțial);
- „Nu accept provocări acum" oprește invitațiile (`user_stats.duels_open`);
- **Profesorul Virtual e închis** în timpul duelului — altfel duelul ar măsura
  cine știe să întrebe tutorele;
- adversarul îți vede scorul **abia după** ce l-ai trimis pe al tău;
- câștigă procentul; la egalitate, timpul; altfel remiză.

**Cine câștigă cât:** o bază după rezultat (victorie 40, înfrângere 15,
egalitate 25, neprezentare 20) **plus până la 25 XP proporțional cu procentul
obținut**. Deci contează și cât ai rezolvat, nu doar dacă ai câștigat: cine
pierde la limită cu 85% ia aproape cât câștigătorul, iar cine câștigă cu 30% nu
ia maximum. Totul peste XP-ul normal al exercițiului.

**Materiale:** exerciții interactive *și* teste PDF. La PDF-uri rezultatul intră
prin corectarea AI (`api/ai-correct.js`), care găsește singură duelul deschis pe
acel material — nu e nevoie de niciun parametru în cerere. Cronometrul de
departajare merge doar la cele interactive; la PDF-uri, egalitatea rămâne remiză.

**Notificări:** provocarea, acceptul/refuzul și rezultatul ajung în clopoțelul
din navbar (`ai_notifications`, tip `duel`), iar indicatorul Arenei arată o
bulină roșie cu numărul provocărilor la care n-ai răspuns. Panoul de dueluri se
reîmprospătează singur la revenirea în tab și din minut în minut — nu mai trebuie
reîncărcată pagina ca să apară „Rezolvă acum". Poți rezolva chiar înainte ca
adversarul să accepte.

**Trei porți de siguranță** (fără ele duelul e trivial de fraudat):

1. rezultatul intră doar prin `api/ai-score.js`, cu scorul **recalculat din chei**;
2. materialul trimis trebuie să fie **exact cel al duelului** (altfel: rezolvi un
   exercițiu ușor și trimiți scorul în duelul greu);
3. **timpul se măsoară pe server**, între `?action=start` (deschiderea
   exercițiului) și trimiterea scorului — durata din browser nu e crezută.
   Materialele fără cheie de verificare nu intră deloc în duel.

## 11. Turnee de grupă (pasul 4)

`api/_lib/turneu.js` · `api/turneu.js` · `src/components/TurneePanel.jsx`

Profesorul deschide un turneu pe una dintre grupele lui: titlu, mesaj
(„Cine ia primul 10/10?"), până la 20 de exerciții, până la 30 de zile.

**Elevii nu se înscriu.** Dacă sunt în grupă și rezolvă un exercițiu din set în
perioada turneului, punctajul intră singur. **Prima rezolvare contează** — altfel
s-ar reface același exercițiu la nesfârșit.

Punctajul = XP-ul ponderat al exercițiului (corecte × dificultate × precizie),
deci nu premiază volumul. La final, locurile 1-3 iau **120 / 70 / 40 XP** și
30 / 20 / 10 monede. „Provocarea profesorului" = un turneu cu un singur exercițiu.

### Turnee publice

Deschise oricui de pe site, dar **cu înscriere** (`tournament_entries`) — altfel
clasamentul ar fi plin de elevi care nici n-au știut că participă. Punctajul intră
doar după ce te-ai înscris.

- **Automat:** cronul de la 6 ore se asigură că există mereu un „Turneu al
  săptămânii" (`ensureWeeklyPublic`): 8 materiale **gratuite**, câte unul din
  fiecare categorie, 7 zile. Fiind gratuite, pot participa și conturile fără
  abonament — turneul devine și cârlig de conversie.
- **Manual:** din contul de **administrator**, aceeași fereastră de creare, cu
  „Tipul turneului → Public".

## 12. Harta capitolelor (pasul 5)

`api/harta.js` · `src/pages/Harta.jsx` (ruta `/arena/harta`)

Capitolele programei în ordine, pentru clasele 5-12, Evaluare Națională și
Bacalaureat. Legătura material → capitol se face prin clasificarea titlului
(`api/_lib/taxonomy.js`) și se salvează în `content.chapter_id` — administratorul
o poate corecta manual oricând.

Harta arată **atât exercițiile interactive, cât și testele PDF** — ambele se
punctează, deci ambele contează la stăpânire.

**Deblocare pe stăpânire, nu pe număr:** un capitol e stăpânit la ≥70% la două
materiale din el (sau la toate, dacă are mai puține) și cu media ≥70%. Capitolul
următor se deschide atunci. Fiecare capitol stăpânit aduce **80 XP + 20 monede**,
o singură dată.

Supape, ca harta să nu blocheze pe nimeni:

- **„Știu deja — sar peste"** deschide capitolul fără XP (un elev de a VIII-a nu
  trebuie să treacă prin toată materia de a V-a);
- un capitol în care elevul lucrase deja **rămâne deschis**;
- un capitol **fără exerciții** nu blochează lanțul.

## 13. Ce NU e acoperit încă

- XP se acordă pe drumul exercițiilor interactive (`api/ai-score.js`) și al
  corectării PDF (`api/ai-correct.js`). Temele marcate direct în
  `api/homework.js` nu dau încă XP — se adaugă apelând `xp.award()` și acolo.
- Turneele pe echipe. Elevii tot nu pot crea turnee (doar profesorii, pe grupele
  lor, și adminul, pentru cele publice).
- Exercițiile generate cu AI pentru dueluri/turnee (deocamdată doar materiale
  din site) și magazinul de monede.
- Test de plasare la „sar peste" — deocamdată e pe încredere.

Teste: `npm test` — `test/gamificare.test.js` (formula, plafoanele, zilele în ora
României, rotația misiunii, nivelurile) și `test/arena-dueluri.test.js` (regulile
duelului, porțile de siguranță, capitolele hărții).
