# 📊 Ghid: măsurare (GA4 + Meta Pixel), planul anual și testul inițial gratuit

Codul e scris și integrat. Rămâne partea pe care doar tu o poți face: conturile și
variabilele de mediu. Timp estimat: **30–40 de minute**.

| Ce se schimbă | Stare |
|---|---|
| Google Analytics 4 + Meta Pixel, cu banner de consimțământ | ✅ în cod — ai nevoie de 2 variabile |
| Evenimente de conversie (cont nou, început de plată, abonare, probă) | ✅ în cod — se configurează în GA4/Meta |
| Plan anual 500 lei (10 luni plătite, 2 cadou) | ✅ în cod — merge fără configurare |
| Probă gratuită 2 zile, o singură dată per cont | ✅ în cod — merge fără configurare |
| Test inițial gratuit pentru elevii asociați cu un părinte | ✅ în cod — merge fără configurare |

---

## PASUL 1 — Google Analytics 4 (10 min)

1. Intră pe **https://analytics.google.com**.

> **Cu ce cont?** Nu contează care dintre `costea.radu.ioan@gmail.com` și
> `admin.examenmate@gmail.com` creează proprietatea — GA4 funcționează la fel. Contează să
> aibă **amândouă** acces, ca platforma să nu depindă de o singură adresă:
> GA4 → *Administrare → Gestionarea accesului la proprietate → +* → celălalt cont, rol
> **Administrator**; Search Console → *Setări → Utilizatori și permisiuni* → **Proprietar**.
> Agentul SEO nu e afectat de nimic din toate astea — el citește prin contul de serviciu.
> **Nu crea o a doua proprietate GA4 cu celălalt cont** — ai împărți datele în două.
2. **Administrare** (roata dințată, jos-stânga) → **Creare** → **Proprietate**.
   - Nume: `ExamenMate` · Fus orar: `România` · Monedă: `Leu românesc (RON)`.
3. La „Flux de date" alege **Web** → URL: `https://examenmate.com` → nume: `ExamenMate site`.
4. Copiază **ID-ul de măsurare**, arată așa: `G-XXXXXXXXXX`.

### 1b. Leagă Search Console de GA4

**Administrare → Asocieri de produse → Conectări la Search Console → Conectați.**
Așa vezi în GA4 și ce cuvinte-cheie aduc oamenii, nu doar ce fac după ce ajung pe site.

1. Apar două proprietăți. Alege **`examenmate.com` — „Domeniu"**, nu cea cu „Prefixul adresei
   URL": proprietatea de tip Domeniu acoperă `http` + `https`, cu și fără `www`, plus orice
   subdomeniu. Cea cu prefix numără doar exact `https://examenmate.com/`, deci pierzi clicurile
   care ajung printr-un redirect. **Nu bifa ambele** — o proprietate se poate lega la un singur
   flux web, și invers.
2. Alege fluxul web (`ExamenMate site`) → **Confirmați** → **Trimiteți**.
3. **Pasul care se ratează cel mai des:** raportul NU apare de la sine. Mergi la
   **Rapoarte → Bibliotecă**, găsește colecția **„Search Console"**, ⋮ → **Publicați**.
   Fără asta, asocierea există dar nu vezi niciun raport și pare că n-a funcționat.
4. Datele apar în ~48 de ore.

> Proprietatea cu prefix URL rămâne în Search Console — agentul SEO o citește prin contul de
> serviciu, independent de această asociere.

---

## PASUL 2 — Meta Pixel (10 min)

1. Intră pe **https://business.facebook.com/events_manager**.
2. **Conectare surse de date** → **Web** → **Începe**.
3. Nume: `ExamenMate` → alege **Cod pentru pixel** (nu „Partener").
4. Copiază **ID-ul pixelului** — un număr de 15–16 cifre.

> Nu instala nimic manual din interfața Meta („Adaugă codul pe site"). Codul e deja
> în aplicație; Meta îl va detecta singur după primul vizitator care acceptă cookie-urile.

---

## PASUL 3 — Variabilele în Vercel (5 min)

**https://vercel.com** → proiectul **examenmate** → **Settings** → **Environment Variables**.
Bifează **Production**, **Preview** și **Development** la fiecare:

| Name | Value | Obligatoriu? |
|---|---|---|
| `VITE_GA4_ID` | `G-XXXXXXXXXX` (Pasul 1) | pentru GA4 |
| `VITE_META_PIXEL_ID` | numărul pixelului (Pasul 2) | pentru Meta |
| `PRICE_MONTHLY_LEI` | `50` | nu — asta e valoarea implicită |
| `PRICE_ANNUAL_LEI` | `500` | nu — asta e valoarea implicită |
| `TRIAL_DAYS` | `2` | nu — asta e valoarea implicită |
| `MED_FREE_ASSESSMENTS` | `1` | nu — asta e valoarea implicită |

Apoi **Deployments → ⋯ pe ultimul deploy → Redeploy**. Variabilele `VITE_*` intră în
build, deci fără redeploy nu apar în site.

> Lipsesc variabilele? Nu se strică nimic — codul verifică și pur și simplu nu încarcă
> scripturile. Util pentru `localhost`, unde oricum nu vrei să murdărești statisticile.

---

## PASUL 4 — Marchează conversiile (5 min)

### În GA4
**Administrare → Evenimente cheie** → **Creare eveniment cheie**, pentru fiecare:

| Eveniment | Ce înseamnă |
|---|---|
| `sign_up` | cont nou creat |
| `begin_checkout` | a apăsat „Abonează-te" |
| `purchase` | **abonare reușită** (are `value` în lei și `plan` = lunar/anual) |
| `start_trial` | a intrat în proba de 2 zile |
| `lead` | elev asociat cu un părinte (deblochează testul gratuit) |
| `free_assessment_started` | a început testul inițial gratuit |

### În Meta Events Manager
Evenimentele vin gata denumite standard: `CompleteRegistration`, `InitiateCheckout`,
`Purchase`, `StartTrial`, `Lead`. La **Măsurare agregată a evenimentelor** →
**Configurează evenimentele web**, pune `Purchase` pe prima poziție (contează pentru
utilizatorii de iPhone care refuză urmărirea).

---

## PASUL 5 — Verificare (5 min)

1. Deschide `https://examenmate.com` într-o fereastră **incognito**.
2. Trebuie să apară bannerul „🍪 Ne ajuți cu statisticile?" după ~1 secundă.
3. Apasă **Accept**.
4. În GA4 → **Rapoarte → În timp real**: trebuie să te vezi în maximum un minut.
5. În Meta Events Manager → **Testați evenimentele**: trebuie să apară `PageView`.
6. Apasă **Doar strict necesare** într-o altă fereastră incognito și confirmă în
   *DevTools → Network* că **nu** pleacă nicio cerere către `googletagmanager.com`
   sau `connect.facebook.net`.

> **Important, legal:** fără „Accept" nu se încarcă absolut nimic de la Google sau Meta.
> Asta e cerința GDPR și e implementată în `src/lib/analytics.js`. Politica de cookie-uri
> a fost actualizată corespunzător. Nu muta scripturile în `index.html` „ca să prindă mai
> mult trafic" — ar însemna urmărire fără consimțământ.

---

## Planul anual și proba de 2 zile

Nu e nevoie de nicio configurare în Stripe: prețurile se creează dinamic la fiecare
checkout, ca și până acum.

| Plan | Preț | Ce vede clientul |
|---|---|---|
| Lunar | 50 lei / lună | „Plătești lună de lună. Renunți când vrei." |
| Anual | **500 lei / an** | „Plătești 10 luni, primești 12. Adică 41,67 lei pe lună." |

**Proba gratuită: 2 zile**, cu card cerut de la început și doar la **primul** abonament
al contului (verificat prin `profiles.subscription_started_at`). Dacă la finalul probei
cardul nu e valid, abonamentul se anulează singur — nimeni nu rămâne „activ" fără plată.

### Dacă preferi prețurile administrate din Stripe Dashboard
Creează două prețuri recurente (RON, lunar și anual) și pune ID-urile în Vercel ca
`STRIPE_PRICE_MONTHLY` și `STRIPE_PRICE_ANNUAL`. Au prioritate față de prețurile din cod.

### Test în modul Stripe Test
Cu cheile de test, cardul `4242 4242 4242 4242` (orice dată viitoare, orice CVC).
Verifică: alegi „Anual" → în Checkout scrie „2 zile gratuit, apoi 500 lei/an" → după
plată aterizezi pe `/profil` și contul devine Premium în câteva secunde.

---

## Testul inițial gratuit (elev + părinte)

**Cum funcționează.** Un elev fără abonament primește gratuit **testul inițial adaptiv
și raportul de diagnostic** dacă are contul asociat cu al unui **părinte**
(`mentor_students`, `mentor_role = 'parinte'` — asocierea se face din `/asociere`).

Raportul gratuit arată: scorul, procentul, nivelul, nota estimată, capitolele cu lacune
și primii 3 pași din plan. Părintele primește notificarea automat (mecanismul
`notifyParents` exista deja). După raport, butonul „Începe planul →" duce la abonament.

**Ce rămâne pentru abonați:** lecțiile, exercițiile, temele, remedierile, recapitulările,
simulările și chatul cu meditatorul.

**Control de cost:** un singur test gratuit per elev (`MED_FREE_ASSESSMENTS=1`). Testele
abandonate nu se numără, deci o pagină închisă din greșeală nu consumă șansa gratuită.
Ca să oferi două teste gratuite, pune `MED_FREE_ASSESSMENTS=2`; cu `0` funcția se
dezactivează complet.

**De ce prin părinte și nu pentru oricine:** raportul ajunge la un adult — cel care ia
decizia de abonare — iar costul AI rămâne mărginit, pentru că fiecare test gratuit cere
un cont de părinte în plus.

---

## Fișiere modificate

| Fișier | Ce s-a schimbat |
|---|---|
| `src/lib/analytics.js` | **nou** — GA4 + Meta Pixel, consimțământ, coadă de evenimente |
| `src/components/CookieConsent.jsx` | **nou** — bannerul de consimțământ |
| `src/App.jsx` | montează bannerul + trimite câte o vizualizare la fiecare schimbare de rută |
| `src/pages/Register.jsx` | eveniment `sign_up` |
| `src/pages/Asociere.jsx` | eveniment `lead` la asocierea cu un părinte |
| `src/pages/Pricing.jsx` | două planuri, proba de 2 zile, eveniment `begin_checkout`, reper de preț |
| `src/pages/Profile.jsx` | eveniment `purchase` la întoarcerea din Stripe (o singură dată per sesiune) |
| `src/pages/PoliticaCookies.jsx` | cookie-urile de analiză, declarate corect |
| `api/create-checkout.js` | planurile lunar/anual + proba de 2 zile la primul abonament |
| `api/ai-meditatii.js` | testul inițial gratuit pentru elevii asociați cu un părinte |
| `src/pages/Meditatii.jsx` | raportul gratuit + invitația la asociere |
