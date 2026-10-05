# 🔎🐞 Ghid: agenții din Admin — verificarea materialelor și agentul de debug

Două file noi în **Admin**:

| Fila | Ce face | Ce schimbă |
|---|---|---|
| **🔎 Verificare materiale** | Citește un test / o fișă de pe site (PDF sau interactiv), **rezolvă singur fiecare item** și îl compară cu cheia, explicația, variantele și punctajul; caută și greșeli de scriere, diacritice, formule stricate, figuri care nu se potrivesc, JavaScript care nu rulează | Nimic, până nu apeși tu **„Publică pe site"**. Corectura merge într-un fișier NOU; originalul rămâne copie de siguranță („Anulează corectura" revine la el oricând) |
| **🐞 Agent debug** | La **„▶ Rulează"** citește codul real al site-ului (de pe GitHub), pornește de la erorile reale (din browserele vizitatorilor, din testele automate, din commiturile recente) și caută probleme: erori, logică greșită, securitate, plăți, telefon, costuri AI. Îți dă un raport și **propune corecturi** (diferențe exacte) | Nimic fără acordul tău: aprobi corecturile → „Aplică" face un **pull request** pe GitHub → testele și build-ul rulează automat → **„Publică"** le pune pe site |

---

## 1. Ce model să folosești (întrebarea ta: Sonnet 5 sau Opus 5?)

Între timp a apărut generația nouă — **Opus 5.5** și **Sonnet 5.5** — iar **Opus 5.5 e mai ieftin decât
Opus 5** (4 $ / 20 $ pe milion de tokeni, față de 5 $ / 25 $) și mai bun. Recomandarea, deja
setată implicit în ambele file:

| Agent | Implicit | Când altceva |
|---|---|---|
| 🔎 Verificare materiale | **Opus 5.5**, atenția „Atent" | Pentru sute de materiale: întâi **Sonnet 5.5** (jumătate din preț: 2 $ / 10 $), apoi **„🧑‍⚖️ A doua opinie"** cu Opus 5.5 doar la materialele cu probleme — confirmă sau respinge fiecare problemă |
| 🐞 Agent debug | **Opus 5.5**, atenția „Atent" | „Foarte atent" pentru un bug greu; **Fable 5.1** (10 $ / 50 $) doar dacă Opus 5.5 nu găsește cauza |

Opus 5 și Sonnet 5 au rămas în listă (merg în continuare), dar nu mai au niciun avantaj.
Prețurile și modelele: <https://platform.claude.com/docs/en/about-claude/models/overview> și
<https://platform.claude.com/docs/en/about-claude/pricing> (verificate în octombrie 2026).

---

## 2. Instalare (o singură dată)

1. **Supabase → SQL Editor**: rulează `supabase/agenti_verificare_debug.sql` (se poate rula de mai
   multe ori). Creează tabelele `content_checks` (verificările și corecturile), `debug_runs`
   (rulările agentului de debug) și `client_errors` (erorile JavaScript din browserele
   vizitatorilor — fără date personale, doar mesajul, stiva și pagina; se șterg după 60 de zile).
2. **Vercel → Settings → Environment Variables**:
   - `ANTHROPIC_API_KEY` — o ai deja dacă merg meditațiile (ambii agenți folosesc Claude);
   - `GITHUB_TOKEN` (pentru agentul de debug, ca să poată face pull request-uri): GitHub →
     Settings → Developer settings → **Fine-grained tokens** → *Generate new token*:
     - *Repository access*: **Only select repositories** → `costea-radu/mate-online`;
     - *Permissions*: **Contents: Read and write**, **Pull requests: Read and write**; plus, doar
       citire: **Actions**, **Checks**, **Commit statuses** (ca să vadă rezultatul testelor);
     - fără token, agentul merge oricum: citește codul, face raportul, iar corecturile le descarci
       ca fișier `.patch`.
   - opțional: `GITHUB_REPO` (implicit `costea-radu/mate-online`), `GITHUB_BRANCH` (implicit `main`).
3. **GitHub — testele automate** (fișierul `.github/workflows/verificare.yml`): la fiecare pull request
   și la fiecare push pe `main`, GitHub rulează `npm test` și `npm run build`; rezultatul apare în Admin
   lângă pull request, iar un PR cu testele picate nu se poate publica din Admin. Fișierele din
   `.github/workflows` sunt protejate (pot rula cod pe GitHub), așa că nu l-am scris eu în folderul
   tău — îl adaugi tu, într-unul din două feluri:
   - **pe github.com** (cel mai simplu): depozitul → **Add file → Create new file** → numele
     `.github/workflows/verificare.yml` → lipește conținutul de mai jos → **Commit changes**; apoi, în
     GitHub Desktop, **Fetch / Pull** înainte de commitul tău;
   - **sau local**: pune fișierul (îl ai și atașat în conversație) în folderul `.github/workflows/`
     (l-am creat gol) și fă commit + push odată cu restul. Dacă push-ul e refuzat cu un mesaj despre
     „workflow", folosește varianta de pe github.com.

   ```yaml
   # =====================================================================
   # Verificarea automată a codului (GitHub Actions) — rulează la fiecare
   # pull request (inclusiv cele create de agentul de debug din Admin) și la
   # fiecare push pe main: instalează dependențele, rulează testele
   # (npm test) și build-ul site-ului (npm run build).
   # Rezultatul apare în Admin → 🐞 Agent debug, lângă pull request; un PR cu
   # testele picate nu se poate publica din Admin.
   # =====================================================================
   name: Verificare

   on:
     pull_request:
     push:
       branches: [main]
     workflow_dispatch:

   permissions:
     contents: read

   concurrency:
     group: verificare-${{ github.ref }}
     cancel-in-progress: true

   jobs:
     teste-si-build:
       name: Teste + build
       runs-on: ubuntu-latest
       timeout-minutes: 20
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: npm
         - name: Dependențele
           run: npm ci --no-audit --no-fund
         - name: Testele (node --test)
           run: npm test
         - name: Build-ul site-ului (vite build)
           run: npm run build
   ```
4. **Local**: `npm install` (dependența nouă `@pdf-lib/fontkit`, pentru rescrierea PDF-urilor —
   repară și `node_modules/mathjs`, care era incomplet). Vercel instalează singur la build.
5. **Deploy**, apoi Admin → **🔎 Verificare materiale** și **🐞 Agent debug**. Sus, în fiecare filă,
   etichetele verzi/roșii arată ce e configurat.

---

## 3. 🔎 Verificare materiale

### Cum o folosești
1. Filtrează (categorie, PDF / interactive, stare, titlu) și bifează materialele, sau apasă
   **„🔎 Verifică"** pe unul singur. Pentru loturi: „toate afișate", „neverificate", „cu verificare
   veche"; **Buget lot** (lei) oprește lotul când se atinge suma; **În paralel**: 1–3 deodată.
2. Fiecare verificare pornește cu **verificările automate** (gratuite, fără AI): JavaScript-ul
   testului interactiv se compilează? formulele LaTeX au backslash-ul corect (o greșeală frecventă:
   `\frac` scris cu un singur backslash într-un șir JavaScript apare pe site ca „rac")? KaTeX le
   poate citi? testul raportează scorul? Apoi **modelul rezolvă fiecare item** și compară.
3. Raportul: problemele pe gravitate (**Gravă**, **Majoră**, **Minoră**, Info) și pe tip (rezultat
   greșit, cheie greșită, variantele grilei, calcul greșit, enunț ambiguu / incomplet, punctaj,
   explicația nu se potrivește, formulă, scriere / diacritice, figură, funcționare), fiecare cu locul
   exact și **corectura propusă**. „Nu e o greșeală" o ascunde și data viitoare.
4. **Repararea**: bifezi corecturile → **„Pregătește corectura"** (se creează un fișier nou,
   nepublicat) → vezi diferențele (la interactive) sau PDF-ul corectat (la PDF) → **„Publică pe
   site"** sau **„✕ Renunță"**. Oricând după publicare: **„Anulează corectura"** revine la fișierul
   original.

### Cum repară, pe tipuri de fișier
- **Teste interactive (HTML)**: corecturile se aplică exact în fișier (cu toleranță la spații și
  backslash-uri), iar fișierul corectat e **re-verificat automat** înainte de previzualizare — nu
  se publică nimic care strică JavaScript-ul.
- **PDF-uri**: textul greșit e **acoperit și rescris pe loc**, cu un font cu aceleași dimensiuni ca
  Times / Arial (Liberation, licență liberă — în `api/_lib/fonts/`), deci pagina arată la fel. Ce nu
  se poate rescrie pe loc (o formulă pe mai multe niveluri, o figură, un PDF scanat fără text) intră
  într-o pagină **ERATĂ** adăugată la final. Profesorul virtual și corectarea AI citesc textul
  corectat (nu pe cel vechi).
- De ce fișier nou și nu suprascriere: originalul rămâne copie de siguranță, iar site-ul re-indexează
  automat materialul (căutarea, textul citit de AI) când se schimbă fișierul.

### Cost (orientativ)
Un test de 4–6 pagini (cu barem): ~0,5–1,5 lei cu Opus 5.5; aproximativ jumătate cu Sonnet 5.5. Un
test interactiv mare: similar. Costul exact al fiecărei verificări apare în listă și sus („cost total").

---

## 4. 🐞 Agent debug

### Cum îl folosești
1. **Ce să verifice**: „Verificare generală" (la fiecare rulare altă zonă, prin rotație: meditații
   live, Planul meu, plăți, conturi, teste, profesorul virtual, admin, cronuri, baza de date,
   gamificare, telefon) sau o zonă anume; la **Detalii** poți descrie o problemă („după ⏭, sala
   rămâne neagră pe iPhone").
2. **Model**, **Atenția**, **Buget maxim** (lei; implicit 20) → **▶ Rulează**.
3. Rularea merge pe pași (fiecare ≤ ~4,5 minute, ca să nu se piardă la limita de timp a Vercel):
   vezi jurnalul în timp real — ce fișiere citește, ce caută. Pașii îi cere pagina deschisă: dacă o
   închizi, rularea așteaptă, iar când revii apeși **„▶ Continuă rularea"** (sau „Oprește").
4. **Raportul**: problemele verificate (fișier și rând, gravitate, de ce e o problemă) și
   **corecturile propuse**, cu diferențele exacte. Fiecare corectură e validată (fragmentul există,
   codul de pe server încă se compilează). Tu alegi: **Aprob / Resping**.
5. **„Aplică corecturile aprobate"** → ramură nouă `agent-debug/…` + **pull request** pe GitHub;
   GitHub Actions rulează testele și build-ul, Vercel face un preview. Când sunt verzi →
   **„Publică pe site"** (merge în `main`) → Vercel publică site-ul. **„✕ Închide PR"** renunță
   (ramura se șterge; pe site nu se schimbă nimic).
6. Fără `GITHUB_TOKEN`: **„Descarcă .patch"** — îl aplici local (`git apply corecturi.patch`) și
   faci commit ca de obicei.

### De unde știe ce să caute
- **Erorile reale din browserele vizitatorilor** (nou): orice eroare JavaScript neprinsă sau
  ecran „ceva n-a mers cum trebuie" e trimisă la `/api/client-error` — fără e-mailuri, tokenuri sau
  parametrii adresei (cel mult 30 de raportări / 10 minute de la aceeași adresă IP) — și grupată;
  în Admin le vezi la „erori din site (7 zile)".
- Rezultatul testelor automate (GitHub Actions) și commiturile recente — bug-urile apar des în
  codul nou.

### Siguranță
- Agentul **nu poate** modifica nimic singur: propune doar editări, pe care le aprobi tu; nu are
  acces la chei, la baza de date sau la Vercel. Un PR cu testele picate nu se poate publica.
- Bugetul (lei) oprește rularea; costul exact al fiecărei rulări apare în listă.

### Cost (orientativ)
O rulare obișnuită: câțiva lei (Opus 5.5, cache-ul de prompt ieftinește pașii repetați); plafonul
e bugetul ales.

---

## 5. Setări (opționale, Vercel)

| Variabilă | Implicit | Ce face |
|---|---|---|
| `DEBUG_BUGET_LEI` | `20` | bugetul implicit al unei rulări de debug |
| `DEBUG_PASI_MAX` | `24` | câte „ture" (citiri, căutări) are cel mult o rulare |
| `DEBUG_PAS_MS` | `270000` | durata unui pas al rulării (≤ limita funcției Vercel) |
| `VERIFICARE_MAX_HTML` | `360000` | câte caractere dintr-un test interactiv mare se trimit modelului |
| `GITHUB_REPO`, `GITHUB_BRANCH` | `costea-radu/mate-online`, `main` | depozitul și ramura principală |

---

## 6. Probleme frecvente

| Simptom | Cauză / soluție |
|---|---|
| „Agentul … nu e încă activat: rulează supabase/agenti_verificare_debug.sql" | pasul 1 de la instalare |
| „Lipsește cheia ANTHROPIC_API_KEY în Vercel" | pune cheia, apoi Redeploy |
| Agentul de debug: „Fără token GitHub — doar raport + .patch" | pune `GITHUB_TOKEN` (pasul 2) |
| „Fără teste automate pe GitHub" | `.github/workflows/verificare.yml` nu e încă pe GitHub (pasul 3) |
| GitHub: „limita de cereri fără token s-a atins (60 pe oră)" | pune `GITHUB_TOKEN` — cu token limita e 5.000 pe oră |
| Verificarea unui PDF: „Fișierul e prea mare" | peste 30 MB; împarte PDF-ul |
| O corectură PDF a intrat în ERATĂ, nu pe pagină | textul nu s-a găsit în stratul de text al PDF-ului (formulă etajată, figură, PDF scanat) — corectura e oricum vizibilă, la final |
| Testele locale pică cu „Cannot find module 'mathjs'" sau „@pdf-lib/fontkit" | `npm install` în folderul proiectului |

Fișierele: `api/content-check.js`, `api/_lib/verificare.js` (verificarea și corecturile),
`api/admin-debug.js`, `api/_lib/debugAgent.js`, `api/_lib/github.js` (agentul de debug),
`api/client-error.js`, `src/lib/errorReport.js` (erorile din browsere), `api/_lib/claude.js`
(Claude: gândire adaptivă, „atenția", cache), `src/components/AdminVerificare.jsx`,
`src/components/AdminDebug.jsx`. Teste: `test/verificare-materiale.test.js`, `test/agent-debug.test.js`.
