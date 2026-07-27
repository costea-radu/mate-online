# 📧 Ghid: conectarea site-ului și a agentului SEO la admin.examenmate@gmail.com

Acest ghid conține **toți pașii exacți**, în ordine. Codul e deja scris — tu doar
configurezi conturile și pui variabilele. Timp estimat: 30–45 de minute.

Ce obții la final:

| Funcție | Cum funcționează |
|---|---|
| **Formular de contact** | Mesajele de pe `/contact` ajung în inboxul admin.examenmate@gmail.com (cu Reply-To → răspunzi direct din Gmail); expeditorul primește confirmare automată |
| **Emailuri de sistem (auth)** | Confirmare cont, resetare parolă, schimbare email — trimise de pe adresa ta, nu de pe cea Supabase (care e limitată la ~2/oră) |
| **Alerte pentru profesori/părinți** | Scanarea zilnică (cron 17:00 UTC) trimite email-digest mentorilor cu evoluția/stagnarea elevilor |
| **Alerte de admin** | Email instant la: abonament nou 🎉, abonament anulat 📉, plată eșuată ⚠️ + rezumat zilnic al platformei 📊 |
| **Agent SEO cu date reale** | Agentul citește Search Console (clicuri, impresii, poziții, interogări) și opțional GA4 — buton nou „📊 Performanță Google" |
| **Newsletter** | Orice răspuns al agentului SEO se poate trimite ca newsletter tuturor utilizatorilor (test către tine mai întâi, dezabonare cu un click) |

---

## PASUL 0 — Instalează dependența nouă și urcă codul

În folderul proiectului (`mate-online`):

```bash
npm install
git add -A
git commit -m "Email (contact, alerte, newsletter) + agent SEO conectat la Google"
git push
```

`npm install` aduce `nodemailer` (adăugat deja în package.json). Push-ul declanșează deploy pe Vercel — dar emailul va funcționa abia după pașii 1–4.

---

## PASUL 1 — Parola de aplicație Gmail (5 min)

> Parola NORMALĂ a contului nu merge pentru SMTP. Ai nevoie de o „parolă de aplicație" (App Password), iar pentru asta contul trebuie să aibă verificarea în 2 pași activă.

1. Loghează-te în browser cu **admin.examenmate@gmail.com**.
2. Activează verificarea în 2 pași (dacă nu e deja):
   - Deschide **https://myaccount.google.com/security**
   - Secțiunea „Cum te conectezi la Google" → **Verificarea în 2 pași** → **Activează** (cu numărul de telefon).
3. Creează parola de aplicație:
   - Deschide **https://myaccount.google.com/apppasswords**
   - La „App name" scrie: `ExamenMate Vercel` → **Create**
   - Google afișează o parolă de 16 caractere (ex: `abcd efgh ijkl mnop`).
   - **Copiaz-o ACUM** — nu mai poate fi văzută după închiderea ferestrei. (Spațiile nu contează, codul le elimină automat.)

> Dacă pagina App passwords nu apare: verificarea în 2 pași nu e activă, sau contul are „Advanced Protection". Activează 2FA și reîncearcă.

---

## PASUL 2 — Variabilele de mediu în Vercel (5 min)

1. Intră pe **https://vercel.com** → proiectul **examenmate** → **Settings** → **Environment Variables**.
2. Adaugă (Environment: bifează **Production**, **Preview** și **Development**):

| Name | Value |
|---|---|
| `EMAIL_USER` | `admin.examenmate@gmail.com` |
| `EMAIL_APP_PASSWORD` | parola de 16 caractere de la Pasul 1 |
| `ADMIN_EMAIL` | `admin.examenmate@gmail.com` |
| `SITE_URL` | `https://examenmate.com` (dacă nu e deja) |

3. **Save** la fiecare, apoi **Deployments → ⋯ pe ultimul deploy → Redeploy** (variabilele noi intră în vigoare doar la un deploy nou).

---

## PASUL 3 — SQL în Supabase (2 min)

1. **https://supabase.com/dashboard** → proiectul ExamenMate → **SQL Editor** → **New query**.
2. Deschide fișierul **`supabase/email_system.sql`** din proiect, copiază tot conținutul, lipește-l și apasă **Run**.

Asta creează: preferințele de email pe profil (`email_alerts`, `newsletter_opt_in`), tabelul mesajelor de contact și tabelele de newsletter. E sigur de rulat de mai multe ori.

---

## PASUL 4 — Emailurile de sistem (Supabase Auth prin Gmail) (5 min)

Acum emailurile de confirmare cont / resetare parolă pleacă de pe serverul Supabase, limitat la câteva pe oră și cu risc de spam. Le mutăm pe Gmail-ul tău:

1. În Supabase Dashboard → **Authentication** → **Emails** → tab **SMTP Settings**
   (sau direct: `https://supabase.com/dashboard/project/_/auth/smtp`).
2. Activează **Enable Custom SMTP** și completează:

| Câmp | Valoare |
|---|---|
| Sender email | `admin.examenmate@gmail.com` |
| Sender name | `ExamenMate` |
| Host | `smtp.gmail.com` |
| Port number | `465` |
| Username | `admin.examenmate@gmail.com` |
| Password | parola de aplicație de la Pasul 1 |

3. **Save**.
4. Ridică limita de trimitere (Supabase o pune la 30/oră după activarea SMTP-ului):
   - **Authentication** → **Rate Limits** (`.../auth/rate-limits`) → „Rate limit for sending emails" → pune **100**/oră → Save.
5. Verifică URL-urile de redirect: **Authentication** → **URL Configuration** → Site URL = `https://examenmate.com`.
6. (Opțional, recomandat) Traduce șabloanele: **Authentication** → **Emails** → **Templates** — poți pune subiecte în română, de ex.:
   - Confirm signup → `Confirmă-ți contul ExamenMate`
   - Reset password → `Resetează parola contului ExamenMate`
   - Change email → `Confirmă noua adresă de email`

**Test:** deloghează-te de pe site → „Am uitat parola" → emailul trebuie să vină de la *ExamenMate ‹admin.examenmate@gmail.com›*.

---

## PASUL 5 — Agentul SEO conectat la Google (15 min)

Agentul folosește un **cont de serviciu** (robot) căruia îi dai acces de citire în Search Console. Totul se face logat cu **admin.examenmate@gmail.com**.

### 5a. Proprietatea în Search Console (dacă nu există deja)

1. **https://search.google.com/search-console** (logat cu admin.examenmate@gmail.com).
2. Dacă `examenmate.com` nu e adăugat: **Add property** → alege varianta **URL prefix** → `https://examenmate.com` → verificare prin **HTML file**: descarcă fișierul `googleXXXX....html`, pune-l în folderul **`public/`** al proiectului, fă push (ajunge automat pe site), apoi apasă **Verify**.
   - *(Varianta „Domain" cere acces la DNS — nu e necesară.)*

### 5b. Contul de serviciu în Google Cloud

1. **https://console.cloud.google.com** (același cont) → sus, selectorul de proiect → **New Project** → nume: `examenmate-seo` → **Create** → selectează-l.
2. **APIs & Services** → **Library** → caută **„Google Search Console API"** → **Enable**.
   - (Dacă vei folosi și GA4: caută și **„Google Analytics Data API"** → **Enable**.)
3. **IAM & Admin** → **Service Accounts** → **Create service account**:
   - Name: `seo-agent` → **Create and continue** → la rol nu alege nimic → **Done**.
4. Click pe contul creat (`seo-agent@examenmate-seo.iam.gserviceaccount.com`) → tab **Keys** → **Add key** → **Create new key** → **JSON** → **Create**. Se descarcă un fișier `.json` — păstrează-l în loc sigur (e o parolă!).

### 5c. Dă-i robotului acces în Search Console

1. Înapoi în **Search Console** → proprietatea examenmate.com → **Settings** (Setări) → **Users and permissions** → **Add user**.
2. Email: adresa contului de serviciu (câmpul `client_email` din JSON, ex. `seo-agent@examenmate-seo.iam.gserviceaccount.com`).
3. Permission: **Full** → **Add**.

### 5d. Variabilele în Vercel

În **Vercel → Settings → Environment Variables** adaugă:

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | deschide fișierul JSON descărcat cu Notepad și lipește **tot conținutul** |
| `GSC_SITE_URL` | `https://examenmate.com/` — **exact** cum apare proprietatea în Search Console (cu / la final pentru URL-prefix; pentru proprietate Domain ar fi `sc-domain:examenmate.com`) |

Apoi **Redeploy**.

### 5e. (Opțional) GA4 — trafic real

Dacă ai (sau îți faci) o proprietate Google Analytics 4:

1. **https://analytics.google.com** → **Admin** → **Property access management** → **+** → adaugă emailul contului de serviciu cu rol **Viewer**.
2. **Admin** → **Property details** → copiază **Property ID** (doar cifre).
3. În Vercel adaugă `GA4_PROPERTY_ID` = cifrele respective → Redeploy.

*(Dacă nu ai GA4, sari peste — agentul merge foarte bine doar cu Search Console.)*

**Test:** site → **Admin** → agentul SEO → butonul nou **„📊 Performanță Google (date reale)"**. Dacă ceva e greșit, agentul îți spune exact ce (proprietate greșită, acces lipsă etc.).

---

## PASUL 6 — Verificare finală (5 min)

1. **Formular contact:** examenmate.com/contact → trimite un mesaj de test → verifică inboxul admin.examenmate@gmail.com (+ confirmarea pe adresa expeditorului). Apasă Reply — trebuie să meargă către expeditor.
2. **Auth:** „Am uitat parola" → emailul vine de pe adresa ta.
3. **Scanare + rezumat admin:** loghează-te ca admin → panoul de notificări → Scanare manuală (sau așteaptă cron-ul de la 17:00 UTC / 20:00 ora României) → primești „📊 ExamenMate azi…".
4. **Stripe:** la următorul abonament (sau un test din Stripe → Developers → Webhooks → Send test event → `checkout.session.completed`) primești „🎉 Abonament NOU".
5. **Newsletter:** Admin → agent SEO → generează un text (ex. „scrie un anunț scurt despre noile exerciții") → **„📨 Trimite ca newsletter"** → primești întâi TESTUL pe email → confirmi → pleacă în loturi.

Dacă un email nu ajunge: caută în **Spam**, apoi în Vercel → **Deployments → ultimul → Functions/Logs** caută `mailer:` sau `contact:`.

---

## Limite și pasul următor (când crește platforma)

- **Gmail gratuit ≈ 500 emailuri/zi** (per cont). Suficient acum; newsletterul se trimite în loturi ca să nu lovească limita.
- Emailurile de pe @gmail.com către mulți destinatari pot ateriza în Promotions/Spam. Când ai sute de utilizatori activi, treci pe **Resend cu domeniul examenmate.com** (SPF/DKIM) — codul e pregătit: setezi doar `RESEND_API_KEY` + `EMAIL_FROM=noreply@examenmate.com` în Vercel și totul se mută automat pe Resend, fără nicio modificare de cod. Pentru asta va fi nevoie de acces la DNS-ul domeniului (2 înregistrări TXT).

## Ce s-a modificat în cod (referință)

**Fișiere noi:** `api/_lib/mailer.js` (motorul de email), `api/_lib/google.js` (Search Console + GA4), `api/contact.js` (formular), `api/newsletter.js` (campanii + dezabonare), `supabase/email_system.sql`.

**Fișiere modificate:** `api/ai-notify.js` (email-digest mentori + rezumat zilnic admin), `api/stripe-webhook.js` (alerte admin; reparat și `config`-ul care era suprascris — semnătura Stripe se verifică acum pe body-ul brut, cum cere documentația), `api/ai-seo-agent.js` (context Google + sarcina „performance"), `src/pages/Contact.jsx` (formular), `src/components/AISEOAgent.jsx` (buton Performanță + Trimite ca newsletter), `src/lib/aiClient.js` (metoda `newsletter`), `package.json` (nodemailer), `.env.ai.example` (documentația variabilelor).

**Preferințe utilizatori:** `profiles.email_alerts` (alerte mentori) și `profiles.newsletter_opt_in` (newsletter) — ambele implicit pornite; linkul de **Dezabonare** din newsletter setează `newsletter_opt_in=false` cu un click.
