# Teme — butonul „📝 Dă temă", pe grupă sau pe fiecare elev în parte

Profesorul bifează exercițiile dintr-o listă și le trimite ca **temă**. Toți
elevii vizați primesc **același set** — spre deosebire de **„Test pe grupă"**
(`GHID_TEME_PE_GRUPA.md`), unde fiecare elev primește **alt** test dintr-un bazin.

## 1. Instalare (o singură dată)

Rulează în **Supabase → SQL Editor → New Query**:

```
supabase/teme_elevi.sql
```

Idempotent. Creează:

| Tabel | Rol |
|---|---|
| `homework` | tema: cine a dat-o, cui (grupă **sau** un elev anume), titlu, mesaj, termen |
| `homework_items` | exercițiile bifate de profesor |
| `homework_progress` | ce a rezolvat fiecare elev, exercițiu cu exercițiu |

Adaugă și coloana `group_assignments.renamed_at` (denumirea editabilă a
linkurilor de test pe grupă).

RLS pornit pe toate trei; scrierile trec exclusiv prin `api/homework.js`.

## 2. De unde se dă tema

În **Contul meu** → **„📊 Grupe / Rezultate elevi"**:

- **lângă grupă** (sub bara de grupe) → tema merge la **toți elevii grupei**
  (sau la toți elevii tăi, dacă e selectat „Toți");
- **lângă fiecare elev**, în coloana din dreapta → tema merge **doar lui**.

Butonul deschide o fereastră cu:

| Ce | Cum |
|---|---|
| **Căutare** | câmp + butonul **🔍 Caută** (caută în titluri) |
| **Filtre** | categoria (clasa sau examenul), formatul (toate / 🧩 interactive / 📄 PDF) |
| **Surse** | testele din site, testele generate de tine, Biblioteca utilizatorilor — se pot bifa mai multe |
| **Lista** | fiecare test/exercițiu cu **bifă**; maximum 40 într-o temă |
| **Denumire, mesaj, termen** | opționale |

## 3. Ce vede elevul

Elevii primesc **notificare în cont** și găsesc tema în rolldown-ul
**„📌 Teme nefăcute"** din Contul meu — așezat **deasupra** lui
„📊 Rezultatele mele" și afișat **doar dacă elevul e asociat cu un profesor**.

Acolo intră tot ce are de rezolvat:

| Etichetă | De unde vine |
|---|---|
| 📝 **temă** | butonul „Dă temă" (tabelele `homework*`) |
| 🧩 **test pe grupă** | linkurile `/tema-grupa?id=…` nerezolvate |
| 📄 **temă primită pe link** | temele `/tema?id=…` trimise cu „Trimite elevilor" |

Tema se deschide la `/tema-elev?id=…`: lista exercițiilor, cu bifă verde la cele
rezolvate. Fiecare pornește în vizualizatorul potrivit — `/exercitiu`,
`/pdf-viewer` (cu Prof. Virtual alături) sau `/exercitiu-ai`.

Exercițiile **cu punctaj automat** se marchează singure când elevul termină.
Cele fără punctaj (PDF-uri, subiecte de examen tipăribile) au butonul
**„✓ Am rezolvat"**.

## 4. Ce vede profesorul

În „Grupe / Rezultate elevi" apare rolldown-ul **„📝 Temele date"**:

- cât s-a rezolvat din fiecare temă (`rezolvate / total`, în procente);
- **📊 Raport** — tabel *elev × exercițiu*: ✓ rezolvat, 👀 deschis, — neatins,
  plus media elevului pe temă;
- **✎** schimbă denumirea, **🔗** copiază linkul, **💬** îl trimite pe mesageria
  grupei, **🗑** șterge tema.

Când un elev termină **toate** exercițiile temei, profesorul primește o
notificare.

## 5. De unde vin scorurile

- testele **din site** își scriu scorul, ca de obicei, în `progress` — tema le
  citește de acolo (inclusiv corectările PDF făcute cu Prof. Virtual);
- testele **generate / din bibliotecă** își scriu scorul în `homework_progress`
  (`ExercitiuAIViewer` trimite `hwId`).

Așa nu se dublează nimic și rezultatele apar și în „Rezultatele mele", și în
raportul temei.

## Fișiere

**Noi:** `supabase/teme_elevi.sql`, `api/homework.js`, `api/_lib/catalog.js`,
`src/components/TemaPicker.jsx`, `src/components/TemeDate.jsx`,
`src/components/TemeNefacute.jsx`, `src/pages/TemaElev.jsx`.

**Modificate:** `src/lib/aiClient.js` (metodele `homework*`), `src/App.jsx`
(ruta `/tema-elev`), `src/pages/Profile.jsx` (tabul „Teme nefăcute"),
`src/components/TeacherResults.jsx` (butoanele „Dă temă" + „Temele date"),
`src/pages/ExercitiuAIViewer.jsx` (scorul temei),
`api/group-assignment.js` (folosește catalogul partajat).
