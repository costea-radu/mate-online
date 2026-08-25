# Mesagerie și colegi

Două lucruri diferite, care folosesc aceleași mesaje:

| | Unde | Cine |
|---|---|---|
| **Canalul grupei** | Contul meu → rolldown „💬 Mesageria grupei", sub „Abonament" | profesorul grupei + elevii ei + părinții acelor elevi |
| **Colegi (1-la-1)** | bara de sus → „Mai multe" → **💬 Mesagerie** (`/mesagerie`); pe mobil, din meniul burger | oricine ți-a acceptat cererea de coleg, de pe tot site-ul |

Lângă fiecare nume scrie tipul contului în paranteză: **(profesor)**, **(elev)**,
**(părinte)**.

## 1. Instalare (o singură dată)

Rulează în **Supabase → SQL Editor → New Query**:

```
supabase/mesagerie.sql
```

Idempotent. Creează:

| Tabel | Rol |
|---|---|
| `chat_threads` | conversațiile: canalul unei grupe (`kind='group'`) sau o discuție 1-la-1 între colegi (`kind='direct'`) |
| `chat_messages` | mesajele, cu numele și rolul expeditorului salvate ca snapshot |
| `chat_reads` | ce a citit fiecare (bulina de necitite) |
| `buddies` | colegii: cerere → acceptare, doar între conturi de același fel |

Adaugă și `profiles.colegi_discoverable` (comutatorul „pot fi găsit după nume")
și `group_assignment_picks.active_until` (oprirea mesageriei în timpul testelor).

RLS pornit peste tot; scrierile trec exclusiv prin `api/messages.js` și
`api/colegi.js` (service role).

## 2. Canalul grupei — o singură conversație, fără 1-la-1

În canal intră **doar oamenii grupei**: profesorul care a făcut-o, elevii ei și
părinții acelor elevi. Din grupă **nu** se deschid discuții private — dacă doi
oameni vor să vorbească între patru ochi, își trimit cerere de coleg.

Apartenența **nu se dublează** într-un tabel de membri: se calculează la fiecare
cerere din `mentor_groups` + `mentor_students`, deci mutarea unui elev în altă
grupă se vede imediat.

## 3. Colegii — ca la Facebook, pe tot site-ul

În **Contul meu**, sub cartonașul cu numele și tipul contului, apare
**„👥 Colegii mei"**:

- pe **desktop** — o fereastră cu câteva nume vizibile și **derulare** pentru rest;
- pe **mobil** — același conținut, ca **tab cu rolldown**.

Reguli:

- colegii se caută **după nume**, minimum 3 litere, și apar **doar conturi de
  același fel**: elev cu elev, profesor cu profesor, părinte cu părinte;
- căutarea întoarce **numai numele și rolul** — niciodată e-mailul;
- cine nu vrea să fie găsit debifează „Pot fi găsit de alți colegi după nume"
  (`profiles.colegi_discoverable`);
- cererea trebuie **acceptată**; abia apoi se poate scrie 1-la-1;
- ștergerea legăturii oprește scrisul (conversația veche rămâne doar la celălalt
  până se șterge și la el).

Clic pe un coleg din listă → se deschide conversația în `/mesagerie`.

## 4. Unde se ajunge la mesagerie

- **Desktop**: bara de sus → „Mai multe" → **💬 Mesagerie**;
- **Mobil**: meniul burger (☰) → **💬 Mesagerie**;
- **Contul meu**: rolldown-ul „💬 Mesageria grupei" (doar canalele de grupă).

Pagina `/mesagerie` are conversațiile în stânga și lista de colegi în dreapta.

## 5. Trimiterea temelor și a testelor pe mesagerie

Profesorul are în bara de scriere butonul **🔗**: alege una dintre temele sau
testele lui, iar mesajul pleacă cu un **card apăsabil** care duce direct la
`/tema-elev?id=…` (temă) sau `/tema-grupa?id=…` (test pe grupă). Aceleași
butoane **„💬 Trimite pe mesageria grupei"** apar și la linkurile proaspăt
create. Serverul acceptă ca atașament **doar rute interne**.

## 6. În timpul testelor se opresc mesageria ȘI Profesorul Virtual

Când elevul apasă **„▶ Începe testul"** la un test pe grupă, i se opresc automat:

| Ce se oprește | Cum arată |
|---|---|
| **Mesageria** (canalul grupei + colegii) | conversațiile se citesc, dar bara de scriere e înlocuită de *„🔒 Nu poți scrie acum — ai un test pe grupă în desfășurare."* |
| **Widgetul Profesorului Virtual** | dispare de pe toate paginile |
| **„Profesorul virtual" / „Întreabă profesorul"** din vizualizatoare | butonul nu mai apare (interactiv și exercițiu generat) |
| **Caseta de întrebări din chat** | înlocuită de *„🔒 Profesorul Virtual e oprit în timpul testului"* |
| **Foto-rezolvarea** (📷) | refuzată, cu același mesaj |

**Ce NU se oprește: corectarea.** La testele **PDF**, butonul „📝 Răspunde în
chat" e chiar modul în care punctajul ajunge la profesor — așa că formularul de
răspuns rămâne folosibil. În vizualizatorul de PDF, pe durata testului, butonul
din bară se numește **„📝 Răspunde la test"**, iar panoul se deschide direct pe
formular, fără chat. Pe scurt: elevul **nu poate cere ajutor**, dar **își poate
trimite răspunsurile**.

Blocarea e pe **server**, nu doar în interfață: `api/_lib/testlock.js` verifică
`group_assignment_picks.active_until` și refuză cu **HTTP 423** cererile către
`api/messages.js`, `api/ai-chat.js`, `api/ai-chat-stream.js` și
`api/ai-vision.js`. Deschiderea altui tab nu ajută. `api/ai-correct.js` rămâne
neatins, tocmai ca să meargă corectarea.

Se repornește când:

- elevul **trimite rezultatul** testului (automat), sau
- apasă **„✓ Am terminat testul"** pe pagina testului, sau
- trec **3 ore** de la începere (ca un test abandonat să nu blocheze nimic).

În timpul testului, în bara vizualizatorului (interactiv, PDF sau exercițiu
generat) apare eticheta **„🔒 Test pe grupă în desfășurare — mesageria și
Profesorul Virtual sunt oprite"**.

## 7. Notificări

La primul mesaj dintr-o conversație, ceilalți primesc notificare în clopoțel
(`✉️`), **maximum una pe zi per conversație**. Cererile de coleg și acceptările
vin tot acolo (`🤝`).

## 8. Reîmprospătare

Cât timp tabul e vizibil: mesajele conversației deschise la **20 s**, lista de
conversații la **60 s**. Tabul ascuns nu cheamă serverul deloc.

## Fișiere

**Noi:** `supabase/mesagerie.sql`, `api/messages.js`, `api/colegi.js`,
`api/_lib/testlock.js`, `src/lib/testMode.js`, `src/components/Mesagerie.jsx`,
`src/components/ColegiiMei.jsx`, `src/components/TestModeBadge.jsx`,
`src/pages/MesageriePage.jsx`.

**Modificate:** `src/lib/aiClient.js` (metodele `chat*` și `colegi*`),
`src/App.jsx` (ruta `/mesagerie`), `src/components/Navbar.jsx` („Mai multe" +
meniul burger), `src/pages/Profile.jsx` (canalul grupei + „Colegii mei"),
`src/pages/GrupaTema.jsx` și `api/group-assignment.js` (oprirea mesageriei pe
durata testului), `src/pages/InteractiveViewer.jsx`, `src/pages/PDFViewer.jsx`,
`src/pages/ExercitiuAIViewer.jsx` (eticheta + ascunderea Profesorului Virtual),
`src/components/AITutor.jsx` (widgetul și caseta de întrebări, oprite în test),
`api/ai-chat.js`, `api/ai-chat-stream.js`, `api/ai-vision.js` (blocarea pe server),
`src/components/AINotifications.jsx` (iconițele).
