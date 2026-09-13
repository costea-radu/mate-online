# Ghid: „✍️ Spațiu de lucru" — caietul digital

Elevul scrie rezolvarea cu **degetul sau cu creionul**, pe o foaie cu linii.
La ~1,3 secunde după ce ridică mâna, **linia** scrisă se transformă singură în
text frumos, randat cu KaTeX, chiar în locul cernelii: fracții, radicali,
integrale, sume, limite, unghiuri, grade — tot ce se scrie la matematică.

Dacă scrie din nou peste o linie deja transformată, textul dispare, revine
cerneala și linia se recunoaște iar, întreagă. Nimic nu se pierde.

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

## Fereastra și enunțul

**Mărimea** o alege elevul și rămâne așa și data viitoare (`localStorage`,
cheia `sdl:fereastra`):

| Unde | Cum |
|---|---|
| Desktop | trage de colțul din dreapta-jos, de marginea dreaptă sau de cea de jos |
| Telefon | trage de bara de jos (lățimea rămâne cât ecranul) |
| Oriunde | butonul `⛶` din antet, sau dublu-clic pe antet — pe tot ecranul și înapoi |

**Enunțul exercițiului** stă într-un panou pliabil, deasupra foii, randat cu
KaTeX. Se pliază din antetul lui, iar înălțimea se trage de mânerul de sub el
(până la 55% din fereastră). Și pliatul, și înălțimea se țin minte.

> **Atenție la ce se afișează.** `payload.text` din bridge (cel care merge la
> model) conține **răspunsurile corecte** și indicațiile oficiale, marcate
> „dezvăluie DOAR dacă elevul îl cere". Panoul NU-l folosește: primește
> `payload.enunt`, construit de `collectEnunt()` din enunț, cerințe și variante,
> fără nimic din ce ar da răspunsul. În plus, componenta mai taie o dată
> marcajele (`cleanEnunt`), ca plasă de siguranță — dacă adăugi alt loc de unde
> se deschide caietul, **nu** trece `hint` și în `enunt`.

---

## Cum funcționează, pe scurt

```
degetul/creionul → trasee pe canvas → grupate în LINII (geometric, vezi mai jos)
   ↓ pauză de 1,3 s
liniile stabile → rasterizate alb-negru → stivuite într-O SINGURĂ imagine,
numerotate 1., 2., 3. și despărțite de o bară
   ↓
POST /api/ai-handwriting  { imageBase64, count, hint, prev }
   ↓ ai.chatVision (model de vedere) → JSON
{ "lines": [ { "i": 1, "latex": "\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}" } ] }
   ↓
KaTeX randează linia peste cerneală (\displaystyle — mărimea de pe caiet)
```

**De ce o singură imagine pentru mai multe linii:** limita de cereri AI e pe
oră (`AI_RATE_PER_HOUR`, implicit 80). Dacă elevul scrie repede, liniile care
s-au „liniștit" între timp pleacă împreună — o cerere în loc de patru. Maximum
4 linii pe cerere; ce nu încape rămâne la coadă și pleacă imediat după.

---

## Gruparea pe linii — partea de care depinde totul

Liniile **nu** sunt benzi fixe pe ecran. Nimeni nu scrie exact între două linii
de caiet: un „4" iese deasupra, o virgulă coboară dedesubt, o fracție ocupă
cât trei rânduri. Cu o grilă fixă, o linie scrisă se rupe în două, fiecare
jumătate pleacă separat la model și iese o prostie — „= 4,0 = 4" citit ca
„−4 4" pe un rând și „−10 =" pe următorul.

De aceea liniile se formează din **geometria traseelor** (`sameLine` +
union-find peste toate traseele, refacut la fiecare schimbare):

| Caz | Regula |
|---|---|
| Două trasee se suprapun pe verticală | aceeași linie, dacă suprapunerea e peste 22% din înălțimea mai mică |
| Un semn mic doar *atinge* rândul (bară, virgulă, punct) | aceeași linie **doar dacă e și lipit** — sub 50 px lateral |
| Etajate, fără suprapunere (numărător / bară / numitor, exponent) | aceeași linie dacă sunt sub 36 px unul de altul, înguste și unul peste altul |
| Două rânduri late, unul sub altul | linii diferite |

Gruparea se **reface de la zero** la fiecare traseu, radieră sau undo, deci nu
depinde de ordinea în care a scris elevul: dacă pune bara fracției la urmă, ea
unește numărătorul cu numitorul retroactiv. Fiecare linie are o amprentă
(`sig` = id-urile traseelor din ea); când amprenta se schimbă, **doar acea
linie** își pierde textul și se citește din nou — vecinele rămân neatinse.

---

## Ce ajunge în câmpul de răspuns

Modelele scriu virgula zecimală în fel și chip și pun spațieri tipografice.
În caiet nu se vede, dar în formular ajunge text brut, deci se curăță de două
ori — pe server (`parseLines`) și în client (`normalizeLatex`):

| Ce vine de la model | Ce ajunge în formular |
|---|---|
| `$3\cdot 1{,}2+0{,}4=$` | `3 · 1,2+0,4=` |
| `1−2=` (minus Unicode) | `1-2=` |
| `−4\quad 4` | `-4 4` |
| `\frac{-b\pm\sqrt{b^2-4ac}}{2a}` | `$\frac{-b\pm\sqrt{b^2-4ac}}{2a}$` |
| `Rezultă că $\sqrt{18}=3\sqrt{2}$` | neatins |

Regula: aritmetica simplă (cifre, virgulă zecimală, `+ - · : = ( )`) intră ca
**text curat**; restul rămâne în `$…$`, așa cum îl randează chatul și îl
citește corectarea. Liniile ies în ordinea de sus în jos a foii, indiferent
în ce ordine le-a scris elevul.

---

## Fișierele

| Fișier | Ce e |
|---|---|
| `api/ai-handwriting.js` | endpointul de recunoaștere (**nou**) |
| `api/_lib/ai.js` | `chatVision` acceptă acum `model` (o linie — restul neatins) |
| `src/components/SpatiuDeLucru.jsx` | caietul: desen, grupare pe linii, recunoaștere, KaTeX (**nou**) |
| `src/lib/aiClient.js` | `aiClient.handwriting({ imageBase64, count, hint, prev })` |
| `src/lib/tutorBridge.js` | butonul din iframe, mesajul `MATE_WORKSPACE_OPEN` și `collectEnunt()` (enunțul fără răspunsuri) |
| `src/lib/katex.js` | `autoMath` — acolade echilibrate la `\frac`/`\sqrt`, operatori mari cu limitele lor |
| `test/katex-automath.test.js` | regresii pentru `autoMath` (**nou**) |
| `src/pages/InteractiveViewer.jsx` | ascultă `MATE_WORKSPACE_OPEN`, deschide caietul |
| `src/pages/PDFViewer.jsx` | butonul + caietul peste PDF |
| `src/components/AITutor.jsx` | butonul din bara de scris + pe fiecare cerință |

---

## Setări (env)

| Variabilă | Implicit | Ce face |
|---|---|---|
| `AI_HANDWRITING_MODEL` | modelul de vedere (`AI_VISION_MODEL`) | modelul care citește scrisul. Un model mai ieftin merge: e o linie, nu o pagină |
| `AI_QUOTA_SCRIS_ZI` | `300` | câte **cereri** de recunoaștere pe zi are un elev (o linie ≈ o cerere). `0` = fără cotă proprie |
| `AI_RATE_PER_HOUR` | `80` | limita orară comună cu chatul — asta se atinge prima la un elev care scrie mult |

Consumul se vede în `ai_usage`, la endpointul `ai-handwriting`.
Nu intră în cotele din „Contul meu → ⚡ Consum AI": recunoașterea e o **unealtă
de scris**, nu o acțiune pe care o cumperi.

---

## Protocolul iframe ↔ pagină

Butonul trăiește în exercițiu (iframe), dar caietul se deschide în
pagina-părinte — acolo sunt sesiunea, creditele AI și KaTeX.

```
iframe → părinte :  MATE_WORKSPACE_OPEN  { text, enunt, title, focus }
părinte → iframe :  MATE_TUTOR_ACTION    { kind: 'fill', value: '<textul recunoscut>' }
```

`text` → la model (conține răspunsurile corecte) · `enunt` → pe ecran (nu le conține).

`fill` e acțiunea care exista deja pentru Profesorul Virtual — caietul o
refolosește, nu adaugă una nouă.

---

## Ce nu face (deocamdată)

- **Nu corectează calculul** la recunoaștere: transcrie exact ce a scris elevul,
  greșeli cu tot. Corectarea e treaba Profesorului Virtual, la cerere.
- **Nu recunoaște desene / figuri geometrice** — doar linii de text și formule.
  Pentru figuri există creionul de pe figura exercițiului.
- **Nu ține minte pe server**: ciorna se salvează doar local, în browserul
  elevului (`localStorage`, cheia `sdl2:…`). Se șterge cu „✕ Șterge tot".
- **Nu mută fereastra** — doar o redimensionează. Stă centrată.

---

## Probleme și ce se întâmplă

| Situație | Comportament |
|---|---|
| Linie indescifrabilă | rămâne cerneală, fără eroare — elevul o rescrie |
| Pată sau punct rătăcit, singur pe foaie | nu pleacă deloc la model — se ignoră |
| Elevul scrie mai departe cât e cererea pe drum | răspunsul depășit se aruncă, linia se citește din nou, întreagă |
| Cotă zilnică atinsă | mesaj în bara roșie; **scrisul merge mai departe**, doar transformarea se oprește |
| Fără rețea / eroare server | linia revine la cerneală, mesajul apare jos |
| Elevul folosește stylus | prima atingere de stylus pornește respingerea palmei: atingerile cu degetul sunt ignorate din acel moment |
| Elevul scrie doar cu degetul | totul merge normal; pentru derulat există unealta `✋ Derulează` |
