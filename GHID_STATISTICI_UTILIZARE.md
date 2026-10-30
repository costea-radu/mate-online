# Ghid: „📊 Statistici de utilizare" (Admin → 🤖 AI Tutor)

Primul panou din fila **🤖 AI Tutor** a Adminului. Arată, pe **ultimele 7 / 30 / 90 de
zile**, cum e folosit site-ul — din datele **noastre**, nu din Google Analytics.

---

## Instalare (o singură dată)

1. **Supabase → SQL Editor → New Query** → rulează `supabase/statistici_vizite.sql`
   (idempotent). Creează:
   - `page_views` — vizitele (cu RLS și GRANT pentru `authenticated` / `service_role`,
     **fără `anon`**; scrie și citește doar serverul);
   - `admin_statistici(zile)` — tot panoul dintr-un singur apel SQL (o cheamă doar
     `service_role`, adică `api/admin-stats.js`, după verificarea de admin).
2. Deploy. Din clipa aceea, site-ul începe să numere vizitele. Testele rezolvate,
   funcțiile AI și conturile apar imediat (vin din datele existente).

Fără scriptul de la pasul 1, site-ul merge normal: `api/vizita.js` tace, iar panoul
spune ce e de rulat.

---

## Ce arată

| Parte | Din ce date |
|---|---|
| **Cifrele mari**: pagini văzute, utilizatori activi, vizite fără cont, conturi noi (pe rol), abonați Premium, teste rezolvate, cereri AI (+ costul în lei), retenția, misiunile zilnice | `page_views`, `profiles`, `progress`, `ai_usage`, `daily_exercises` |
| **📈 Pagini văzute pe zi** — coloane, cu detaliile la hover / Tab și tabelul zilelor | `page_views` |
| **🔝 Cele mai vizitate pagini** (cu nume prietenoase: „Clasa a VII-a", „Arena matematică"…) | `page_views.path` |
| **📂 Cele mai accesate materiale** — PDF-uri și exerciții deschise | `page_views.content_id` |
| **📝 Cele mai folosite teste** — rezolvate în perioadă: utilizatori diferiți, încercări, media | `progress` |
| **🤖 Funcțiile AI cele mai folosite** — cereri, persoane, cost | `ai_usage` |
| **🔁 Utilizatorii care revin cel mai des** (zile diferite cu vizite) / **👣 cu cele mai multe accesări** (pagini văzute) — nume, e-mail, rol, ⭐ Premium, ultima vizită; primii 10, „Arată toți cei 25" | `page_views` + `profiles` |
| **Revin (retenție)** — din cei activi în perioada dinainte, câți au revenit | `page_views` |
| **🕐 Orele de vârf** (ora României), **📱 Dispozitive**, **🔗 De unde vin** (domeniul), **👥 Conturile, pe rol** | `page_views`, `profiles` |

Părțile ale căror tabele lipsesc (ex. Arena nerulată) vin goale, restul merge.

---

## Cum se înregistrează o vizită

`src/App.jsx` → `VizitaTracker` → `src/lib/vizite.js` → `POST /api/vizita` → `page_views`

- La fiecare schimbare de rută: **ruta** (fără `?…`), **materialul deschis**
  (`/exercitiu?id=…`, `/pdf-viewer?id=…`), **dispozitivul** (telefon / tabletă /
  calculator) și, la prima pagină din vizită, **domeniul de unde a venit**.
- **Cine e autentificat** e recunoscut pe server, din token — nu din browser.
- **Vizitatorii fără cont**: vizita se numără fără niciun identificator; un id anonim
  (`localStorage` `em_vid`) se folosește **doar dacă au acceptat cookie-urile**.
- **Adminii și paginile de admin nu se numără.**
- Serverul curăță tot (`api/_lib/vizite.js`): rută validă și scurtă, UUID, dispozitiv
  din trei, doar domeniul sursei; plafon de 90 de vizite / minut / IP; răspunde mereu
  204 — statisticile nu strică nimic în pagină.
- **Păstrare: 180 de zile** — cronul zilnic `api/account-cleanup.js` șterge vizitele
  mai vechi; vizitele unui cont se șterg odată cu contul (`on delete cascade`).
- Politica de confidențialitate (secțiunea 1, „Statistici interne de vizitare") și
  Politica de cookie-uri (`em_vid`) spun asta.

---

## Verificare rapidă (SQL Editor)

```sql
select public.admin_statistici(7);
select path, count(*) from public.page_views group by path order by 2 desc limit 20;
```
