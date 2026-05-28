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
