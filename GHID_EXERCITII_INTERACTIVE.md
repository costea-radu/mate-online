# Ghid: Cum trimiți scorul din exercițiul interactiv

## Cum funcționează

Exercițiul tău HTML rulează într-un `<iframe>`. Când utilizatorul termină,
exercițiul trimite scorul către aplicație printr-un `postMessage`.

## Codul pe care trebuie să îl adaugi în HTML-ul tău

```javascript
// Apelează această funcție când utilizatorul termină exercițiul
function trimiteScor(punctajObtinut, punctajMaxim) {
  window.parent.postMessage(
    {
      type: 'MATE_SCORE',
      score: punctajObtinut,   // număr întreg (ex: 8)
      maxScore: punctajMaxim,  // număr întreg (ex: 10)
    },
    '*'
  );
}

// Exemplu de utilizare:
// La finalul testului, dacă utilizatorul a obținut 7 din 10 puncte:
// trimiteScor(7, 10);
```

## Exemplu complet minimal

```html
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <title>Test Matematică</title>
</head>
<body>
  <h1>Cât face 2 + 2?</h1>
  <button onclick="verifica(4)">4</button>
  <button onclick="verifica(3)">3</button>
  <div id="rezultat"></div>

  <script>
    function verifica(raspuns) {
      const corect = raspuns === 4;
      document.getElementById('rezultat').textContent =
        corect ? 'Corect! 🎉' : 'Greșit! ❌';

      // Trimite scorul către  ExamenMate (Mate-Online)
      window.parent.postMessage({
        type: 'MATE_SCORE',
        score: corect ? 1 : 0,
        maxScore: 1,
      }, '*');
    }
  </script>
</body>
</html>
```

## Note

- `score` și `maxScore` trebuie să fie **numere întregi**
- Poți trimite scorul oricând — la finalul testului, după fiecare întrebare, etc.
- Dacă scorul e trimis de mai multe ori, se salvează **cel mai recent**
- Scorul e vizibil utilizatorului în lista de exerciții ca procent (ex: ✓ 80%)
- Dacă exercițiul nu trimite niciun mesaj, nu se salvează niciun scor (normal)

## Ce adaugă singură platforma în teste (4 nov. 2026)

Puntea `src/lib/tutorBridge.js` e injectată automat în HTML-ul fiecărui test (fișierul din
baza de date rămâne neatins) și adaugă:

- **„✓ Corectează exercițiul"** la fiecare exercițiu — exercițiul se corectează singur, cu
  punctajul lui, și rămâne blocat (ca după corectarea totală, dar doar el). Scorul pentru
  platformă (`MATE_SCORE`) pleacă tot doar la corectarea totală, iar ea numără și
  exercițiile corectate separat.
- Butonul de sus al testului devine **„✓ Corectează total"** (punctajul întregului test).
- **Pe telefon**, bara testului trece în bara paginii, doar cu pictograme (↺ · ☰ · ✓ Total);
  „Rezolvate / Scor / Corecte" apar după prima corectare.

Ca un test nou să primească toate acestea, păstrează forma testelor existente:

- **Exerciții cu pași** (variantele de BAC, Subiectul al III-lea la EN): `PROBS` (fiecare cu
  `n` și `steps`), `ST`, `GRADED`, `cur`, `redo` și funcțiile `renderProb`, `probScore`,
  `isRight` (opțional `badgeOf`, `gradeCls`, `paintBar`, `stOf`, `save`). Pot fi globale sau
  închise într-o funcție — `<script>(function(){ "use strict"; var PROBS=…; … })();</script>`;
  la a doua formă, platforma le face vizibile singură (`exposeClosureEngine`). Problema
  deschisă are `#stmt` (cu `.task`), `.backrow` (butonul de sus) și `#donerow` / `#doneMsg`.
  Testele cu `gradeProb` (rezolvările pe capitole) au deja „✓ Corectează problema" și
  rămân cum sunt.
- **Grile**: `.card` cu `data-correct="b"` (și, opțional, `data-points="5"`), variantele
  `.opt[data-opt="a"]`… (alegerea = clasa `sel`), explicația `.expl` (se arată cu `show`).
- **Bara de sus**: `.sbar` cu pastilele `.pill` și butoanele `onclick="checkAll()"`,
  `onclick="resetAll()"` și, la testele cu listă, `#btnAllTop` (`goPicker()`).
