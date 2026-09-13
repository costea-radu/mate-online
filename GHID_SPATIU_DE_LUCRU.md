# Ghid: „✍️ Spațiu de lucru" — caietul digital

Elevul scrie rezolvarea cu **degetul sau cu creionul**, pe o foaie cu linii.
La ~1,2 secunde după ce ridică mâna, **rândul** scris se transformă singur în
text frumos, randat cu KaTeX, chiar în locul cernelii: fracții, radicali,
integrale, sume, limite, unghiuri, grade — tot ce se scrie la matematică.

Dacă scrie din nou pe un rând deja transformat, textul dispare, revine cerneala
și rândul se recunoaște iar, întreg. Nimic nu se pierde.

---

## Unde apare butonul

| Loc | Cum se deschide | Ce poate face cu textul |
|---|---|---|
| **Exerciții interactive** (iframe) | „✍️ Spațiu de lucru" în bara de sus **și** pe fiecare pas / grilă (injectat de `tutorBridge.js`) | `✓ Pune în răspuns` scrie în câmpul pasului curent · `🎓 Cere corectarea` deschide Profesorul Virtual |
| **Vizualizator PDF** | „✍️ Spațiu de lucru" în bara de sus | `🎓 Cere corectarea` · `📋 Copiază` |
| **Widgetul plutitor** (Prof. Virtual) | butonul `✍️` din bara de scris, lângă 📷 și 🎤 | `✓ Pune în întrebare` · `🎓 Cere corectarea` |
| **Formularul „📝 Răspunde în chat"** | „✍️ Spațiu de lucru" sub fiecare cerință | `✓ Pune în răspuns` completează exact acea cerință |

În **testul pe grupă** caietul rămâne deschis (e ciorna elevului), dar
`🎓 Cere corectarea` dispare — ajutorul de la AI rămâne blocat, ca până acum.

---

## Cum funcționează, pe scurt

```
degetul/creionul → trasee pe canvas → grupate pe RÂNDURI (80 px)
   ↓ pauză de 1,2 s
rândurile stabile → rasterizate alb-negru → stivuite într-O SINGURĂ imagine,
numerotate 1., 2., 3. și despărțite de o linie
   ↓
POST /api/ai-handwriting  { imageBase64, count, hint }
   ↓ ai.chatVision (model de vedere) → JSON
{ "lines": [ { "i": 1, "latex": "\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}" } ] }
   ↓
KaTeX randează rândul peste cerneală (\displaystyle — mărimea de pe caiet)
```

**De ce o singură imagine pentru mai multe rânduri:** limita de cereri AI e pe
oră (`AI_RATE_PER_HOUR`, implicit 80). Dacă elevul scrie repede, rândurile care
s-au „liniștit" între timp pleacă împreună — o cerere în loc de cinci. Maximum
6 rânduri pe cerere; ce nu încape rămâne la coadă și pleacă imediat după.

---

## Fișierele

| Fișier | Ce e |
|---|---|
| `api/ai-handwriting.js` | endpointul de recunoaștere (**nou**) |
| `api/_lib/ai.js` | `chatVision` acceptă acum `model` (o linie — restul neatins) |
| `src/components/SpatiuDeLucru.jsx` | caietul: desen, rânduri, recunoaștere, KaTeX (**nou**) |
| `src/lib/aiClient.js` | `aiClient.handwriting({ imageBase64, count, hint })` |
| `src/lib/tutorBridge.js` | butonul din iframe + mesajul `MATE_WORKSPACE_OPEN` |
| `src/pages/InteractiveViewer.jsx` | ascultă `MATE_WORKSPACE_OPEN`, deschide caietul |
| `src/pages/PDFViewer.jsx` | butonul + caietul peste PDF |
| `src/components/AITutor.jsx` | butonul din bara de scris + pe fiecare cerință |

---

## Setări (env)

| Variabilă | Implicit | Ce face |
|---|---|---|
| `AI_HANDWRITING_MODEL` | modelul de vedere (`AI_VISION_MODEL`) | modelul care citește scrisul. Un model mai ieftin merge: e un rând, nu o pagină |
| `AI_QUOTA_SCRIS_ZI` | `300` | câte **cereri** de recunoaștere pe zi are un elev (un rând ≈ o cerere). `0` = fără cotă proprie |
| `AI_RATE_PER_HOUR` | `80` | limita orară comună cu chatul — asta se atinge prima la un elev care scrie mult |

Consumul se vede în `ai_usage`, la endpointul `ai-handwriting`.
Nu intră în cotele din „Contul meu → ⚡ Consum AI": recunoașterea e o **unealtă
de scris**, nu o acțiune pe care o cumperi.

---

## Protocolul iframe ↔ pagină

Butonul trăiește în exercițiu (iframe), dar caietul se deschide în
pagina-părinte — acolo sunt sesiunea, creditele AI și KaTeX.

```
iframe → părinte :  MATE_WORKSPACE_OPEN  { text, title, focus }
părinte → iframe :  MATE_TUTOR_ACTION    { kind: 'fill', value: '<textul recunoscut>' }
```

`fill` e acțiunea care exista deja pentru Profesorul Virtual — caietul o
refolosește, nu adaugă una nouă.

---

## Ce nu face (deocamdată)

- **Nu corectează calculul** la recunoaștere: transcrie exact ce a scris elevul,
  greșeli cu tot. Corectarea e treaba Profesorului Virtual, la cerere.
- **Nu recunoaște desene / figuri geometrice** — doar rânduri de text și formule.
  Pentru figuri există creionul de pe figura exercițiului.
- **Nu ține minte pe server**: ciorna se salvează doar local, în browserul
  elevului (`localStorage`, cheia `sdl:…`). Se șterge cu „✕ Șterge tot".

---

## Probleme și ce se întâmplă

| Situație | Comportament |
|---|---|
| Rând indescifrabil | rămâne cerneală, fără eroare — elevul îl rescrie |
| Cotă zilnică atinsă | mesaj în bara roșie; **scrisul merge mai departe**, doar transformarea se oprește |
| Fără rețea / eroare server | rândul revine la cerneală, mesajul apare jos |
| Elevul folosește stylus | prima atingere de stylus pornește respingerea palmei: atingerile cu degetul sunt ignorate din acel moment |
| Elevul scrie doar cu degetul | totul merge normal; pentru derulat există unealta `✋ Derulează` |
