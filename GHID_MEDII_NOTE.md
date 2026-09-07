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
- **MEDIA GENERALĂ** — media mediilor încheiate, ca „media anuală" din catalog.
  Se calculează din MEDII, nu din toate notele la un loc: altfel o perioadă cu
  30 de note ar cântări cât 30 de perioade cu câte una. Se vede în două locuri:
  pe capul rolldown-ului (deci și cu caseta închisă) și ca rând auriu sub lista
  mediilor. Notele de după ultima medie NU intră încă în ea — intră în clipa în
  care le închizi într-o medie.
- **perioada curentă**: câte note noi sunt și ce medie ar ieși acum.

Butonul e stins când nu sunt note noi de încheiat.

## 4. Mediile fiecărui elev al grupei — dintr-un singur buton

Sub butonul „📝 Dă temă" al grupei stă rolldown-ul
**„🎓 Calculează mediile fiecărui elev …"**. Butonul lui **NU mai face media
grupei**: face **media personală a FIECĂRUI elev** din selecție, cu notele lui
de până în acel moment — adică exact ce ar ieși dacă profesorul ar deschide
rândul fiecărui elev și ar apăsa „🔒 Încheie media" la fiecare, dar dintr-o
singură apăsare. Asta cere de fapt catalogul: la sfârșit de perioadă ai nevoie
de 25 de medii de elev, nu de o cifră pe clasă.

- cu o grupă selectată → elevii acelei grupe;
- cu „Toți" selectat → toți elevii asociați.

Fiecare elev își păstrează **propriul șir de medii**: perioada lui pornește de
la ULTIMA LUI medie, nu de la o graniță comună a grupei, iar numerotarea
(Media 1, Media 2, …) e a lui. Rolldown-ul arată, ÎNAINTE de apăsare, ce va
ieși pentru fiecare — numele, câte note intră, ce număr primește media și
cifra —, iar elevii **fără note noi sunt săriți** (apar stinși, cu „nicio notă
nouă"). Elevii cu **cont șters** nu intră deloc. Confirmarea listează primii 8
elevi și numărul celorlalți, ca profesorul să vadă ce semnează.

Mediile de **grupă** încheiate ÎNAINTE de această schimbare rămân vizibile în
partea de jos a aceluiași rolldown, ca istoric, și se pot șterge — dar nu se
mai creează altele noi.

## 5. API

`POST /api/teacher-manage`

| Acțiune | Corp | Ce face |
|---|---|---|
| `close_average` | `{ scope, studentId?, groupId?, groupName?, average, grades, students?, details? }` | Închide media; serverul pune `period_no` și `from_at` din media dinainte |
| `close_averages` | `{ items: [{ studentId, average, grades, details? }] }` (max 200) | Închide media PERSONALĂ a mai multor elevi deodată. O interogare pentru asocieri, una pentru ultimele medii, apoi un singur `insert` — nu N cereri. Elevii neasociați, fără note noi sau cu medie invalidă sunt săriți și raportați în `skipped`; restul se salvează |
| `delete_average` | `{ periodId }` | Șterge o medie încheiată (notele ei revin în perioada curentă) |

Mediile deja încheiate vin odată cu dashboardul, în răspunsul lui
`POST /api/teacher-students`, câmpul `averages`.

Verificări: media trebuie să fie între 1 și 10, trebuie să existe cel puțin o
notă nouă, elevul trebuie să fie asociat mentorului, iar grupa să-i aparțină.
Media pe grupă e doar pentru conturile de profesor.

## Fișiere atinse

**Noi:** `supabase/medii_si_timp.sql`, `GHID_MEDII_NOTE.md`.

**Modificate:** `api/teacher-manage.js` (acțiunile `close_average` /
`close_averages` / `delete_average`), `api/teacher-students.js` (câmpul
`averages`), `src/components/TeacherResults.jsx` (butoanele, casetele
`MediiBox` / `MediiPeElevBox`, media generală și calculul notelor).
