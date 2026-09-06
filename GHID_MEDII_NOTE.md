# Mediile notelor — „încheie media" la elev și la grupă

În **Contul meu** → **„📊 Grupe / Rezultate elevi"**, profesorul (și părintele,
pentru copilul lui) poate **încheia media** notelor de până în acel moment.
Notele care vin după intră singure în **media următoare**, care își primește
propriul buton — exact ca în catalog: media pe teză, apoi media următoare, și
tot așa.

## 1. Instalare (o singură dată)

Rulează în **Supabase → SQL Editor → New Query**:

```
supabase/medii_si_timp.sql
```

Scriptul e idempotent și creează tabela `mentor_grade_periods`:

| Coloană | Rol |
|---|---|
| `teacher_id` | mentorul care a încheiat media |
| `scope` | `student` (media unui elev) sau `group` (media grupei) |
| `student_id` / `group_id` | subiectul mediei (`group_id` null la scope `group` = „toți elevii mei") |
| `period_no` | Media 1, Media 2, … (numerotate de server) |
| `from_at` → `closed_at` | intervalul acoperit: de la media dinainte până la clic |
| `average`, `grades`, `students` | media (1–10, două zecimale), câte note și câți elevi au intrat în ea |
| `details` | detaliul salvat: notele elevului, respectiv media fiecărui elev din grupă |

RLS pornit: scrierea trece exclusiv prin `api/teacher-manage.js` (service role);
la citire, mentorul își vede mediile lui, iar elevul pe ale lui.

Până rulezi scriptul, restul dashboardului merge normal — butonul de medie
răspunde cu un mesaj care îți spune exact ce ai de rulat.

## 2. Ce se numără drept „notă"

Exact notele afișate în dashboard, calculate cu `src/lib/nota.js` (`notaDinScor`,
cu cele 10 puncte din oficiu ca la examen):

- nota fiecărui **test sau exercițiu rezolvat** (interactiv, PDF corectat de
  Prof. Virtual, exercițiu încărcat în chat);
- notele **temelor de la Meditații cu Profesorul Virtual** (inclusiv seturile
  generate care au punctaj).

Media se calculează în interfață, din exact ce vede profesorul pe ecran, ca cifra
salvată să fie aceeași cu cea afișată. Serverul verifică apartenența elevului,
înlănțuie perioadele și le numerotează.

## 3. Media unui elev

Butonul **„🔒 Încheie media (N)"** stă pe rândul fiecărui elev, lângă „📝 Dă temă",
și arată câte note noi s-au strâns. Lângă el apare, ca pastilă, **ultima medie
încheiată** (`media 2: 8.45`).

Deschizând rândul elevului, rolldown-ul **„🎓 Mediile lui …"** arată:

- toate mediile încheiate — numărul, câte note, data încheierii, media și 🗑
  pentru ștergere (notele ei se întorc în perioada curentă);
- **perioada curentă**: câte note noi sunt și ce medie ar ieși acum.

Butonul e stins când nu sunt note noi de încheiat.

## 4. Media grupei

Sub butonul „📝 Dă temă" al grupei, rolldown-ul **„🎓 Mediile grupei …"** face
același lucru pentru **toate notele tuturor elevilor** din selecția curentă:

- cu o grupă selectată → notele elevilor acelei grupe;
- cu „Toți" selectat → notele tuturor elevilor asociați (se salvează cu
  `group_id = null`).

Media grupei e media **tuturor notelor** luate până în acel moment (nu media
mediilor); în `details` se salvează și media fiecărui elev, ca să rămână urma.
Elevii cu **cont șters** nu intră în media grupei.

## 5. API

`POST /api/teacher-manage`

| Acțiune | Corp | Ce face |
|---|---|---|
| `close_average` | `{ scope, studentId?, groupId?, groupName?, average, grades, students?, details? }` | Închide media; serverul pune `period_no` și `from_at` din media dinainte |
| `delete_average` | `{ periodId }` | Șterge o medie încheiată (notele ei revin în perioada curentă) |

Mediile deja încheiate vin odată cu dashboardul, în răspunsul lui
`POST /api/teacher-students`, câmpul `averages`.

Verificări: media trebuie să fie între 1 și 10, trebuie să existe cel puțin o
notă nouă, elevul trebuie să fie asociat mentorului, iar grupa să-i aparțină.
Media pe grupă e doar pentru conturile de profesor.

## Fișiere atinse

**Noi:** `supabase/medii_si_timp.sql`, `GHID_MEDII_NOTE.md`.

**Modificate:** `api/teacher-manage.js` (acțiunile `close_average` /
`delete_average`), `api/teacher-students.js` (câmpul `averages`),
`src/components/TeacherResults.jsx` (butoanele, caseta `MediiBox` și calculul
notelor).
