# Mesagerie și lista de persoane

Două lucruri diferite, care folosesc aceleași mesaje:

| | Unde | Cine |
|---|---|---|
| **Canalul grupei** | Contul meu → rolldown „💬 Mesageria grupei", sub „Abonament" | profesorul grupei + elevii ei + părinții acelor elevi |
| **1-la-1** | bara de sus → iconița **💬** (sau „Mai multe" → 💬 Mesagerie, `/mesagerie`); pe mobil, din meniul burger | oricine ți-a acceptat cererea — profesor, elev sau părinte |

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
| `chat_threads` | conversațiile: canalul unei grupe (`kind='group'`) sau o discuție 1-la-1 (`kind='direct'`) |
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

## 3. Bulina roșie de mesaje noi (ca la Messenger)

Când ai mesaje necitite, numărul lor apare cu **roșu**:

| Unde | Cum arată |
|---|---|
| bara de sus (desktop) | iconița **💬** de lângă clopoțel, cu bulina în colț |
| „Mai multe" (desktop) | bulină lângă buton **și** lângă rândul „💬 Mesagerie" |
| butonul **☰** (mobil) | bulina în colț, deci se vede fără să deschizi meniul |
| meniul burger (mobil) | bulină pe rândul „💬 Mesagerie", pe fundal roșu-pal |

Peste 99 scrie „99+". Bulina scade **pe loc** când deschizi conversația.

Cum se numără (`src/lib/chatUnread.js`): un singur „magazin" pentru toată
pagina — oricâte locuri arată bulina, serverul e întrebat **o singură dată**,
la 30 s și **doar cu tabul vizibil**; revenirea pe fereastră aduce imediat
numărul actualizat, iar două cereri nu pleacă niciodată la mai puțin de 4 s una
de alta. Cât timp mesageria e deschisă nu se mai cere nimic în plus: numărul se
ia din lista de conversații, pe care pagina o are oricum. Sursa:
`POST /api/messages { action: 'unread' }` → `{ count, threads, last }`.

## 4. Sunet, vibrație și alertă pe ecran

Când numărul de necitite **crește**, se întâmplă trei lucruri deodată
(`src/lib/chatAlert.js` + `src/components/ChatAlerts.jsx`):

| | Ce face | Unde merge |
|---|---|---|
| **Sunet** | „ding-dong" scurt, două note generate în browser (Web Audio) — niciun fișier de încărcat, merge și fără rețea | peste tot |
| **Vibrație** | `navigator.vibrate([90, 60, 90])` | Android; iPhone o ignoră, fără eroare |
| **Alertă pe ecran** | bulă în colțul de sus (pe mobil, bandă pe toată lățimea) cu **cine a scris** și începutul mesajului; clic pe ea → mesageria | peste tot |

Browserele nu lasă niciun sunet să pornească înainte ca omul să fi atins pagina
măcar o dată — de aceea contextul audio se deblochează singur la prima atingere
sau apăsare de tastă.

**Nu sună la prima citire**, deci încărcarea unei pagini cu mesaje vechi
necitite nu declanșează nimic; sună doar când apare ceva nou.

Din bulă se pot **opri sunetul și vibrația** („🔕") — ține de browserul acela
(`localStorage`), iar bula rămâne. Tot din bulă se poate cere permisiunea de
**notificări de sistem** („🔔 Alerte și când site-ul e în fundal"): atunci, cu
tabul în fundal, mesajul apare și în afara paginii. Butonul se arată doar dacă
browserul acceptă și nu s-a răspuns încă — permisiunea nu se cere niciodată din
senin.

> **Limita de acum:** alertele merg cât timp site-ul e **deschis** într-un tab
> (fie și în fundal). Ca să sune pe telefon cu site-ul **închis** de tot e
> nevoie de *service worker* + *web push* (chei VAPID, un tabel de abonări și
> trimiterea din server) — nu e pus încă.

Alerta se montează în bara de sus, deci **nu apare în vizualizatoarele pe tot
ecranul**: în timpul unui test pe grupă nu sare nimic peste exerciții.

## 5. „Lista persoane" — ca la Facebook, pe tot site-ul

În **Contul meu** (sub cartonașul cu numele și tipul contului) și în dreapta
paginii `/mesagerie` apare **„👥 Lista persoane"**, în ordinea asta:

1. **cererile primite**, dacă sunt;
2. **„➕ Caută pe cineva"** — rolldown auriu, închis la început;
3. **lista de persoane** — 5 nume vizibile (9 când panoul e lățit), restul prin
   derulare.

**Clic pe un nume → se deschide conversația cu el.** Pe `/mesagerie`, direct în
fereastra de alături; din „Contul meu", printr-un salt la `/mesagerie` cu firul
deja ales (nu mai e nevoie de al doilea clic).

Pe **mobil** tot panoul e un tab cu rolldown.

La fel e și coloana **„Conversații"** din mesagerie: întâi **„✍️ Scrie cuiva
din listă"** (rolldown auriu), apoi conversațiile — 5 vizibile, restul prin
derulare.

**Oricine poate căuta pe oricine**, pe categorii, în funcție de rolul lui:

| Am cont de… | Categoriile pe care le pot căuta |
|---|---|
| **profesor** | Colegi profesori · Elevi · Părinți |
| **elev** | Colegi de clasă · Profesori · Părinți |
| **părinte** | Alți părinți · Profesori · Elevi |

Categoriile sunt butoane deasupra căsuței de căutare; prima e mereu cea cu
oameni ca tine. Schimbi categoria cu numele deja scris → se caută din nou, în
ea. Lista de persoane e grupată la fel: întâi cei ca tine, apoi ceilalți.

Reguli (neschimbate de deschiderea pe roluri):

- se caută **după nume**, minimum 3 litere;
- căutarea întoarce **numai numele și rolul** — niciodată e-mailul;
- cine nu vrea să fie găsit debifează „Pot fi găsit după nume"
  (`profiles.colegi_discoverable`);
- cererea trebuie **acceptată**; abia apoi se poate scrie 1-la-1;
- ștergerea legăturii oprește scrisul (conversația veche rămâne doar la celălalt
  până se șterge și la el).

În `buddies`, coloana `role` păstrează rolul **celui care a trimis cererea** —
rolul celuilalt se citește din profilul lui, fiindcă acum pot fi diferite. Nu e
nevoie de nicio modificare în baza de date pentru asta.

Clic pe un nume din listă → se deschide conversația în `/mesagerie`.

## 6. Unde se ajunge la mesagerie

- **Desktop**: iconița **💬** din dreapta sus (lângă clopoțel), sau
  „Mai multe" → **💬 Mesagerie**;
- **Mobil**: meniul burger (☰) → **💬 Mesagerie**;
- **Contul meu**: rolldown-ul „💬 Mesageria grupei" (doar canalele de grupă).

Pagina `/mesagerie` are conversațiile în stânga și „Lista persoane" în dreapta.

## 7. Trimiterea temelor și a testelor pe mesagerie

Profesorul are în bara de scriere butonul **🔗**: alege una dintre temele sau
testele lui, iar mesajul pleacă cu un **card apăsabil** care duce direct la
`/tema-elev?id=…` (temă) sau `/tema-grupa?id=…` (test pe grupă). Aceleași
butoane **„💬 Trimite pe mesageria grupei"** apar și la linkurile proaspăt
create. Serverul acceptă ca atașament **doar rute interne**.

### Linkul de invitație, trimis pe mesagerie

În **Contul meu** → **„🔗 Invită elevi"**, lângă e-mail și WhatsApp stă butonul
**„💬 Trimite pe mesageria site-ului"**. El copiază linkul de asociere și
deschide `/mesagerie` cu **mesajul deja scris** în bara de trimitere; profesorului
nu-i mai rămâne decât să aleagă din stânga **elevul** („✍️ Scrie cuiva din listă")
sau **grupa**, și să apese „Trimite". Textul se poate schimba înainte.

Mesajul călătorește prin starea navigării (`navigate('/mesagerie', { state:
{ draft } })`) → `src/pages/MesageriePage.jsx` → propietatea `draft` a
componentei `Mesagerie`. Cât timp există un `draft`, mesageria **nu deschide
singură** nicio conversație — alegerea destinatarului rămâne a profesorului — și
arată deasupra o casetă care explică ce e de făcut.

## 8. În timpul testelor se opresc mesageria ȘI Profesorul Virtual

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
- **expiră timpul de lucru**, când profesorul a pus unul (10 minute – 3 ore), sau
- trec **3 ore** de la începere (ca un test abandonat să nu blocheze nimic).

În timpul testului, în bara vizualizatorului (interactiv, PDF sau exercițiu
generat) apare eticheta **„🔒 Test pe grupă în desfășurare — mesageria și
Profesorul Virtual sunt oprite"**, iar la testele cu timp de lucru, alături,
**cronometrul** cu timpul rămas (`GHID_TEME_PE_GRUPA.md`, pasul 5).

## 9. Notificări

La primul mesaj dintr-o conversație, ceilalți primesc notificare în clopoțel
(`✉️`), **maximum una pe zi per conversație**. Cererile de coleg și acceptările
vin tot acolo (`🤝`).

## 10. Timp real

Mesajele apar **instant**, prin Supabase Realtime: fiecare conversație are un
canal de tip *broadcast* (`mesagerie:<threadId>`), la care clientul se abonează
pentru toate conversațiile lui (maximum 24). Cine trimite dă un semnal pe canal;
ceilalți reîncarcă firul deschis (sau doar lista, pentru bulina de necitite).

Semnalul conține **doar id-ul conversației**, niciun pic de conținut — de aceea
tabelele rămân închise pentru browser, iar mesajele se citesc în continuare doar
prin `/api/messages`, cu verificarea apartenenței la grupă. Nu e nevoie de nicio
politică RLS în plus.

Interogarea periodică rămâne ca plasă de siguranță și se adaptează:

| | canal conectat | fără websocket |
|---|---|---|
| firul deschis | 25 s | 8 s |
| lista de conversații | 45 s | 20 s |

Tabul ascuns nu cheamă serverul deloc, iar revenirea pe fereastră aduce imediat
ce s-a scris între timp.

## Fișiere

**Noi:** `supabase/mesagerie.sql`, `api/messages.js`, `api/colegi.js`,
`api/_lib/testlock.js`, `src/lib/testMode.js`, `src/lib/chatUnread.js`,
`src/lib/chatAlert.js`, `src/components/Mesagerie.jsx`,
`src/components/ColegiiMei.jsx`, `src/components/ChatAlerts.jsx`,
`src/components/TestModeBadge.jsx`, `src/pages/MesageriePage.jsx`.

**Modificate:** `src/lib/aiClient.js` (metodele `chat*` și `colegi*`),
`src/App.jsx` (ruta `/mesagerie`), `src/components/Navbar.jsx` („Mai multe" +
meniul burger), `src/pages/Profile.jsx` (canalul grupei + „Lista persoane"),
`src/pages/GrupaTema.jsx` și `api/group-assignment.js` (oprirea mesageriei pe
durata testului), `src/pages/InteractiveViewer.jsx`, `src/pages/PDFViewer.jsx`,
`src/pages/ExercitiuAIViewer.jsx` (eticheta + ascunderea Profesorului Virtual),
`src/components/AITutor.jsx` (widgetul și caseta de întrebări, oprite în test),
`api/ai-chat.js`, `api/ai-chat-stream.js`, `api/ai-vision.js` (blocarea pe server),
`src/components/AINotifications.jsx` (iconițele).
