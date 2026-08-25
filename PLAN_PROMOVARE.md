# 📈 Plan de promovare ExamenMate — anul școlar 2026–2027

> Versiunea interactivă (cu calendar și tabele): **https://claude.ai/code/artifact/62032b60-c49c-4599-b68f-d74efe3a522c**
> Întocmit: 24 august 2026 · actualizat 25 august 2026. Buget de lucru: 200–500 lei/lună.

> ✅ **Trei din cele patru probleme sunt reparate în cod pe 25 august**: măsurarea (GA4 +
> Meta Pixel), planul anual de 500 lei cu probă de 2 zile, și testul inițial gratuit pentru
> elevii asociați cu un părinte. Pașii de configurare rămași sunt în
> `GHID_MASURARE_SI_ABONAMENTE.md`. A rămas de rezolvat problema #1: conținutul.

Produsul e deja peste ce are nevoie o platformă la 50 de abonați: profesor virtual cu
memorie pedagogică, generator de teste, agent SEO, calendar social automat, invitații la
recenzii. Blocajul e în altă parte.

---

## 1. Diagnostic — patru scurgeri de bani

| # | Problema | Reparația |
|---|---|---|
| 1 | ⚠️ **Google vede 28 de pagini. Neschimbat — asta a rămas.** Sitemap-ul are doar paginile de clase, cele legale și un articol. `variante-mate.ro`, `profesorjitaruionel.com`, `heiprofu.ro` au sute. Infrastructura există deja (`api/page-meta.js` injectează articolul complet pentru crawlere, `/rezolvari/{slug}`, agent SEO cu cron) — lipsește conținutul. | 2 articole/săptămână, fiecare pe o căutare concretă. ~60 de pagini până în martie. |
| 2 | ~~**Nu măsori nimic.**~~ **✅ Rezolvat 25 aug.** Fără GA4, fără Meta Pixel, fără eveniment de conversie. Algoritmii de reclamă au nevoie de 30–50 de conversii ca să învețe. | GA4 + Meta Pixel instalate, cu banner de consimțământ și evenimentele `sign_up`, `begin_checkout`, `purchase`, `start_trial`, `lead`. Rămâne: cele două ID-uri în Vercel. |
| 3 | ~~**Oferta are o singură ușă**~~ **✅ Rezolvat 25 aug.** 50 lei/lună, fără probă, fără plan anual. eduboom ia 78 lei/lună (angajament 12 luni) sau 780 lei/an; o oră de meditații costă 70–120 lei. Prețul e corect, ambalajul nu — în iunie părintele anulează și în septembrie îl cucerești din nou. | Plan anual **500 lei** (10 luni plătite, 2 cadou) + **probă de 2 zile**, o singură dată per cont. Rămâne: pachetul „2 copii". |
| 4 | ~~**Momentul „aha" e după paywall.**~~ **✅ Rezolvat 25 aug.** 2 acțiuni AI gratuite nu conving. Testul inițial adaptiv din `/meditatii` e arma reală: dă părintelui un diagnostic („copilul e la 6,4 din 10, iată cele 4 capitole și planul"). | Testul inițial + raportul sunt **gratuite pentru elevii asociați cu un părinte**. Paywall-ul cade la „începe planul", iar condiția aduce în plus contul părintelui — omul care decide abonarea. |

---

## 2. Aritmetica

100 de abonați × 50 lei = **5.000 lei/lună**. Pe trafic rece (3–5% fac cont, 5–8% se abonează)
ar însemna 25.000–60.000 de vizitatori lunar. E mult și e lent.

De aceea planul nu e „mai mult trafic", ci **trafic cu intenție + un canal care aduce oameni în
grup**: un profesor de matematică = 25–30 de elevi deodată. Zece profesori în primul modul =
250–300 de conturi, fără niciun leu de reclamă.

**De ce nu dai banii pe reclamă în septembrie:** CPC-ul pentru educație în România e
0,20–1,00 € (1–5 lei). 500 lei = 100–400 clicuri = 3–12 abonați, cu cost de achiziție
40–160 lei. La 50 lei/lună îți iei banii înapoi abia în luna 1–3 — și doar dacă omul rămâne.
**Septembrie–februarie**: bugetul merge în conținut și unelte. **Martie și iunie** (cele două
vârfuri de căutare din an): în reclame, cu pixelul deja învățat.

---

## 3. Calendarul — anul școlar ca plan de campanie

Cursurile încep **7 septembrie 2026**, se termină **18 iunie 2027** (a VIII-a: 11 iunie;
a XII-a: 4 iunie). Vacanțe: 24 oct–1 nov · 23 dec–10 ian · săptămâna mobilă 15 feb–7 mar ·
24 apr–4 mai · vara din 19 iunie.

### Faza 0 — 24 august → 6 septembrie · **ACUM, 13 zile**
*Țintă: măsurare pornită + 6 pagini noi + oferta rescrisă*

- ✅ ~~Instalează GA4 + Meta Pixel + evenimentul de conversie.~~ **Gata 25 aug.** Rămâne să pui
  `VITE_GA4_ID` și `VITE_META_PIXEL_ID` în Vercel și să faci redeploy.
- ✅ ~~Rescrie oferta.~~ **Gata 25 aug** — plan anual 500 lei, probă de 2 zile. Rămâne pachetul 2 copii.
- ✅ ~~Deschide testul inițial gratuit.~~ **Gata 25 aug** — pentru elevii asociați cu un părinte.
- ⬜ **Publică paginile „test inițial"** — clasele V–VIII, plus IX și XII. **Singura piesă din
  Faza 0 care mai lipsește, și cea cu termen.** În primele două săptămâni de școală e una
  dintre cele mai căutate expresii din tot anul, iar concurența publică exact asta în fiecare
  septembrie. Fiecare pagină: subiect + barem + rezolvare pas cu pas + buton către testul
  interactiv.
- ⬜ Pregătește campania profesorilor: textul, contul demo, pagina `/profesori`.

### Faza 1 — 7 septembrie → 23 octombrie · modulul 1
*Țintă: 10 profesori activi · 250 conturi de elev · 15 abonați*

- **10 mesaje/săptămână către profesori de matematică.** Cont de profesor gratuit pe viață
  + un an de premium personal dacă aduc o clasă. Argumentul nu e „o platformă", ci *„nu mai
  corectezi teste de mână"*.
- Cere-le un singur lucru concret: un test de recapitulare dat prin platformă în prima lună.
- Ritm: 2 articole/săptămână (capitolele predate acum la a VII-a și a VIII-a).
- 3 postări sociale/săptămână — o problemă rezolvată, nu un anunț despre site.
- **Buget de reclamă: 0 lei.**

### Faza 2 — 2 noiembrie → 22 decembrie · modulul 2
*Țintă: 30 de articole · 40 de abonați · primele recenzii publice*

- Continuă cele 2 articole/săptămână (~30 de pagini până la Crăciun).
- **Pornește recomandările**: „invită un coleg → o lună gratuită pentru amândoi".
- Pornește cron-ul de invitații la recenzie (`api/review-invite.js`, deja scris).
- Ofertă de Crăciun: planul anual ca și cadou.
- Primul test plătit, 150 lei, retargeting Meta către vizitatorii neabonați.

### Faza 3 — 11 ianuarie → 23 aprilie · **VÂRFUL ANULUI**
*Țintă: 100 de abonați · trafic ×3 față de decembrie*

- **Simulare EN: 16–18 martie 2027** (matematică 17 martie), rezultate 30 martie.
  **Simulare BAC: 22–25 martie**, rezultate 9 aprilie. *(calendar propus — verifică pe edu.ro)*
- **Publică rezolvarea subiectelor de simulare în maximum 24 de ore.** Cea mai mare pârghie
  de trafic din an — zeci de mii de căutări în aceeași seară. Pregătește pagina și titlul
  dinainte.
- **Aici dai banii**: 400–500 lei în martie, Google Search pe termeni de examen + retargeting.
- După rezultate: emailul care contează — *„Nota de la simulare nu e sentință. Sunt 12
  săptămâni și un plan care le folosește."*

### Faza 4 — 5 mai → 24 iunie · sprint final
*Țintă: 150 de abonați*

- **BAC — proba obligatorie a profilului: 15 iunie 2027. EN — matematică: 24 iunie 2027.**
- Pachetul **„ultimele 30 de zile"**: plan zilnic, o simulare la 3 zile, corectare automată.
  Vândut ca produs cu termen, nu ca abonament.
- Postare zilnică: o problemă din subiectele oficiale, rezolvată în 60 de secunde.
- 400–500 lei reclamă, restul bugetului anual.
- **Vara e sezonul anulărilor** — planurile anuale vândute în martie te țin în iulie. Oferta
  de trecere pe anual se face în mai, nu în iulie.

---

## 4. Canale, în ordinea randamentului

| # | Canal | Cost | Efect |
|---|---|---|---|
| 1 | **Profesorii de matematică** — unul aduce 25–30 de elevi | 0 lei · 4 h/săpt | 2–6 săptămâni |
| 2 | **Articole pe căutări concrete** — se acumulează | 0 lei · 4 h/săpt | 2–4 luni |
| 3 | **Grupuri de părinți** — material gratuit, linkul în comentariu | 0 lei · 1 h/săpt | imediat, mic |
| 4 | **Video scurt (TikTok/Shorts)** — o problemă în 60 s | 0 lei · 3 h/săpt | 1–3 luni |
| 5 | **Recomandări + recenzii** | o zi de cod | continuu |
| 6 | **Reclamă plătită** — doar martie și mai–iunie | 400–500 lei ×2/an | cât plătești |

---

## 5. Următoarele 7 zile

- [x] ~~GA4 + Meta Pixel + eveniment de conversie la abonare~~ — **gata 25 aug**
- [x] ~~plan anual + probă gratuită în Stripe și pe `/preturi`~~ — **gata 25 aug** (500 lei/an, 2 zile)
- [x] ~~testul inițial din `/meditatii` gratuit~~ — **gata 25 aug** (pentru elevii cu părinte asociat)
- [ ] **Azi (~40 min)** — `VITE_GA4_ID` + `VITE_META_PIXEL_ID` în Vercel → redeploy → verificare în incognito
- [ ] **(~6 h)** — 3 pagini „test inițial" (VI, VII, VIII): subiect + barem + rezolvare
- [ ] **(~3 h)** — listă cu 40 de profesori, primele 10 mesaje trimise
- [ ] **(~30 min)** — Search Console: câte pagini indexate, retrimite sitemap-ul

## 6. Săptămâna care se repetă (~10 ore)

- [ ] 2 articole publicate, fiecare pe o căutare reală — *4 h*
- [ ] 10 mesaje către profesori + răspunsuri — *2 h*
- [ ] 3 postări sociale + 1 video scurt — *3 h*
- [ ] Cele 4 cifre: vizitatori, conturi noi, abonați noi, anulări — *30 min*
- [ ] Notat ce a mers și ce nu — *30 min*

---

## 7. Ce să NU faci

- ❌ **Nu scădea prețul.** 50 lei/lună e sub o oră de meditații. Cine nu cumpără nu refuză
  prețul, refuză să creadă că merge — răspunsul e testul gratuit cu raport.
- ❌ **Nu porni reclame fără pixel și fără plan anual.**
- ❌ **Nu plăti pentru postări pe pagini mari de Facebook.** Audiență împrumutată, fără intenție.
- ❌ **Nu scrie articole generice** („cum să înveți matematică eficient"). Nu le caută nimeni.
- ❌ **Nu deschide șase rețele sociale.** Două duse până la capăt bat șase abandonate în noiembrie.
- ❌ **Nu construi funcții noi în locul distribuției.** Următoarele 6 luni sunt despre oameni
  care află de platformă.

---

## 8. Anexe

### Mesajul către profesor (model)

> Bună ziua, domnule profesor. Am construit ExamenMate, o platformă de matematică pentru
> gimnaziu și liceu. Am făcut în ea un generator de teste: alegeți clasa și capitolul, primiți
> subiectul și baremul, elevii rezolvă online, iar dumneavoastră vedeți unde s-a împotmolit
> fiecare, fără să corectați nimic de mână. Vă dau cont de profesor gratuit, pe viață. Dacă vă
> e util și îl folosiți cu o clasă, vă ofer și un an de acces complet. Vă las linkul dacă vreți
> să vă uitați: …

Rată realistă de răspuns: 10–20%. Din 40 de mesaje → 4–8 interesați → 2–3 care dau un test
→ 60–90 de elevi.

### Primele pagini de scris

- **Până pe 7 septembrie:** „Test inițial matematică clasa a V-a / VI-a / VII-a / VIII-a
  2026–2027 cu rezolvare" + a IX-a și a XII-a.
- **Septembrie–octombrie:** o pagină per capitol predat acum („Numere raționale clasa a VII-a",
  „Formule de calcul prescurtat clasa a VIII-a" — o ai, extinde-o, „Ecuații de gradul II").
- **Permanent:** „Subiecte Evaluare Națională [an] rezolvate", pentru fiecare an. Aduc trafic
  în fiecare iunie, la nesfârșit.

Regula: o pagină = o singură căutare, rezolvare completă vizibilă fără cont, buton final către
varianta interactivă.

### De ce 500 lei planul anual

Zece luni plătite, două cadou — fix cât ține anul școlar, cu vara pe deasupra. Părintele
calculează 41,67 lei/lună față de 50. Tu primești banii în avans și scapi de anularea din
iunie. Se vinde cel mai bine **în martie** (după rezultatele simulării) și **în septembrie**.

### Cele 4 cifre

**Vizitatori** → funcționează articolele? · **Conturi noi** → convinge pagina de intrare? ·
**Abonați noi** → convinge oferta? · **Anulări** → își ține produsul promisiunea?

Vin vizitatori dar nu se fac conturi → problema e pe pagină. Se fac conturi dar nu se
abonează → problema e în ofertă sau în momentul „aha". Se abonează și pleacă în două luni →
problema e în produs, iar reclama doar accelerează pierderea.

---

## Surse

- [Structura anului școlar 2026–2027 (Monitorul Oficial, via Edupedu)](https://www.edupedu.ro/oficial-calendarul-anului-scolar-2026-2027-publicat-in-monitorul-oficial-cursurile-incep-pe-7-septembrie-si-se-incheie-pe-18-iunie/)
- [Calendar Evaluarea Națională 2027 — proiect (Edupedu)](https://www.edupedu.ro/ultima-ora-calendar-evaluarea-nationala-2027-elevii-vor-sustine-probele-in-perioada-22-25-iunie/)
- [Calendar Bacalaureat 2027 — proiect în consultare publică (Alba24)](https://alba24.ro/calendar-bacalaureat-2027-probele-de-competente-in-aprilie-cele-scrise-in-iunie-noile-reguli-puse-in-consultare-publica-1153212.html)
- [Cât costă meditațiile în 2026 (Jurnalul)](https://jurnalul.ro/stiri/educatie/cat-costa-meditatiile-2026-buget-lunar-romana-matematica-engleza-1041734.html)
- [Prețurile abonamentului eduboom](https://eduboom.ro/lectii-video/abonament-eduboom)
- [CPC-uri Google Ads România 2026 pe industrii](https://www.carpathian-marketing-agency.ro/insights/cat-costa-google-ads-romania)

> ⚠️ Calendarele examenelor din 2027 erau, la data acestui plan, **proiecte în consultare
> publică**. Verifică-le pe edu.ro înainte de a le afișa pe site.
