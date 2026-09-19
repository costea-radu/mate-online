# ExamenMate — aplicația Android (TWA) și publicarea în Play Store

Proiect Android complet, gata de compilat. Aplicația nu conține conținut propriu:
deschide `https://examenmate.com` într-un **Trusted Web Activity** (Chrome fără bară de
adresă, pe tot ecranul). Tot ce publici pe site apare automat în aplicație, fără
versiune nouă în magazin.

---

## 1. Ce e în proiect

```
android-twa/
├─ app/src/main/
│  ├─ AndroidManifest.xml          configurarea TWA (URL, culori, splash, deep links)
│  ├─ java/com/examenmate/app/     LauncherActivity + DelegationService (notificări)
│  └─ res/                         icoane (toate densitățile), splash, shortcuts
├─ keystore/examenmate-upload.jks  cheia de upload (generată, 4096 biți, valabilă până în 2054)
├─ keystore.properties             parola cheii — NU ajunge în git
├─ twa-manifest.json               config pentru Bubblewrap, dacă vrei să regenerezi
└─ gradlew / gradlew.bat           wrapper Gradle 8.14.3
```

Configurație: `applicationId = com.examenmate.app`, `minSdk 21`, `targetSdk 36`
(obligatoriu pentru aplicații noi în Play Store după 31 august 2026),
`versionCode 1`, `versionName 1.0.0`.

**Cheia de semnare**: parola e în `android-twa/keystore.properties`. Salveaz-o în
managerul tău de parole și fă o copie a fișierului `.jks` în afara calculatorului.
Ambele sunt deja în `.gitignore`.

---

## 2. Compilarea

Ai nevoie de **Android Studio** (include SDK-ul și JDK-ul) sau de Android SDK +
JDK 17 instalate separat.

```powershell
cd C:\Users\Radu\Desktop\mate-online\android-twa
.\gradlew.bat bundleRelease
```

Rezultatul: `app\build\outputs\bundle\release\app-release.aab` — fișierul pe care
îl urci în Play Store.

Pentru un test rapid pe telefon (APK instalabil direct):

```powershell
.\gradlew.bat assembleRelease
```
→ `app\build\outputs\apk\release\app-release.apk`

Prima compilare durează câteva minute (descarcă Android Gradle Plugin și
`androidbrowserhelper`).

---

## 3. Contul Play Console

1. https://play.google.com/console → **25 USD, o singură dată**
2. Alege cont de **organizație** (S.R.L.), nu personal:
   - evită regula celor 12 testeri timp de 14 zile
   - în schimb cere **număr D-U-N-S** (gratuit de la Dun & Bradstreet, 5–30 zile)
   - plus certificatul de înregistrare al firmei
3. **Verificare trader (DSA)** — obligatorie în UE: nume, adresă, telefon, email
   ale firmei, care devin publice în fișa aplicației

---

## 4. Digital Asset Links — pasul care decide dacă e TWA sau doar un browser

Fără această legătură, aplicația pornește Chrome **cu bara de adresă vizibilă**.
Arată ca un browser, nu ca o aplicație. E cel mai frecvent motiv de eșec.

Fișierul există deja la `public/.well-known/assetlinks.json` și conține amprenta
cheii tale de upload. Mai trebuie adăugată amprenta cheii pe care o generează
Google.

1. Urcă `app-release.aab` în Play Console → **Testing → Internal testing**
2. Mergi la **Setup → App integrity → App signing key certificate**
3. Copiază amprenta **SHA-256** de acolo
4. Adaug-o în `public/.well-known/assetlinks.json`, în lista existentă:

```json
"sha256_cert_fingerprints": [
  "AD:75:34:...:47:1D",
  "<AMPRENTA_DIN_PLAY_CONSOLE>"
]
```

5. `git push` → Vercel face deploy
6. Verifică: https://examenmate.com/.well-known/assetlinks.json trebuie să
   returneze JSON-ul, nu pagina site-ului

Test oficial:
https://developers.google.com/digital-asset-links/tools/generator

Dacă vezi bara de adresă după instalare: assetlinks nu e corect servit sau
amprenta nu se potrivește. Dezinstalează și reinstalează după corectare —
verificarea se face la instalare.

---

## 5. Fișa din magazin

Ai deja în `play-assets/`:
- `icon-512.png` — icoana din magazin
- `feature-graphic-1024x500.png` — banner (înlocuiește-l cu unul grafic mai bun
  când ai timp; cel generat e minimal)

Îți mai trebuie:
- **minimum 2 capturi de ecran de telefon** (recomandat 4–8, format 16:9 sau 9:16,
  minimum 320px pe latura scurtă) — fă-le direct din aplicație: pagina de start,
  un exercițiu interactiv, Profesorul Virtual, un test
- **descriere scurtă** (max 80 caractere)
- **descriere lungă** (max 4000 caractere)
- **categorie**: Education
- **politica de confidențialitate**: https://examenmate.com/politica-confidentialitate

Formulare obligatorii în Play Console:
- **Content rating** — chestionar; pentru conținut educațional iese PEGI 3 / Everyone
- **Data safety** — declară ce colectezi: adresă de email, nume, date de utilizare.
  Menționează Supabase ca procesator și Stripe pentru plăți
- **Target audience** — decizie care contează. Dacă declari copii sub 13 ani ca
  public țintă, intri sub **Families Policy**, cu cerințe suplimentare privind
  consimțământul parental. Alternativa: declari **13+** și ceri în Termeni ca
  elevii mai mici să folosească un cont creat de părinte. Discută asta cu un
  jurist înainte de a bifa.
- **Declarație privind reclamele**: nu ai → „No ads"

---

## 6. Abonamentul premium — atenție la comisioane

Dacă utilizatorul poate cumpăra abonamentul **din aplicație**, Google percepe
15% (primul milion de dolari pe an) sau 30% peste. Stripe te costă ~1,4%.

Varianta recomandată pentru prima versiune: în aplicație rămâne doar partea
gratuită (exerciții interactive, teste, PDF-uri), iar abonarea se face pe site.
Nu pune butoane de tip „Abonează-te" care duc direct la plată în aplicație —
politica Google interzice ocolirea sistemului de facturare pentru conținut
digital consumat în aplicație. Formularea sigură: nu vinzi din aplicație și nu
îndrumi explicit către plata externă.

---

## 7. Lansarea

1. **Internal testing** → adaugă-te pe tine și 2–3 profesori. Verifică:
   bara de adresă lipsește, login-ul Google funcționează, exercițiile interactive
   merg, butonul Back se comportă corect
2. **Closed testing** (opțional) → un grup mai mare de elevi
3. **Production** → prima verificare durează de obicei câteva zile

---

## 8. Actualizări ulterioare

**Conținutul site-ului** nu cere nimic: aplicația încarcă site-ul live.

Versiune nouă în magazin e necesară doar dacă schimbi icoana, numele, culorile
sau shortcut-urile:

1. în `app/build.gradle`: `versionCode 2`, `versionName "1.0.1"`
2. `.\gradlew.bat bundleRelease`
3. urci noul `.aab`

---

## 9. Dacă ceva nu merge

| Simptom | Cauză | Rezolvare |
|---|---|---|
| Se vede bara de adresă Chrome | assetlinks.json lipsă/greșit | verifică URL-ul și amprenta SHA-256, reinstalează |
| „App not installed" | semnătură diferită de versiunea instalată | dezinstalează versiunea veche |
| Ecran alb la pornire | service worker-ul servește altceva | verifică `navigateFallbackDenylist` din `vite.config.js` |
| Build eșuează la `compileSdk 36` | Android SDK 36 neinstalat | Android Studio → SDK Manager → Android 16 (API 36) |

---

## 10. Alternativă fără Android Studio

https://www.pwabuilder.com — introduci `https://examenmate.com`, generează
pachetul în browser. Mai rapid, dar nu ai control asupra shortcut-urilor,
splash-ului și cheii de semnare, iar `applicationId` diferă. Folosește-o doar
dacă nu vrei să instalezi Android Studio; altfel proiectul de aici e mai curat.
