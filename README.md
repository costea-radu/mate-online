# ExamenMate

Platformă de matematică cu exerciții PDF, exerciții interactive și manuale online pentru clasele 5–8, Evaluarea Națională și Bacalaureat.

## Structura proiectului

```
examenmate/
├── index.html                     # Entry point HTML
├── package.json                   # Dependințe npm
├── vite.config.js                 # Config Vite
├── netlify.toml                   # Config Netlify (build + redirects)
├── .env.example                   # Template variabile de mediu
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx                   # Entry point React
│   ├── App.jsx                    # Router principal
│   ├── styles/global.css          # Stiluri globale
│   ├── lib/supabase.js            # Client Supabase
│   ├── context/AuthContext.jsx    # Autentificare + stare user
│   ├── components/
│   │   ├── Navbar.jsx
│   │   ├── Footer.jsx
│   │   └── ProtectedContent.jsx   # Componente pentru gating gratuit/premium
│   └── pages/
│       ├── Home.jsx               # Pagina principală
│       ├── ClassPage.jsx          # Pagini clase 5-8 (dinamice)
│       ├── EvaluareNationala.jsx
│       ├── Bacalaureat.jsx
│       ├── Manuale.jsx
│       ├── Login.jsx
│       ├── Register.jsx
│       ├── Pricing.jsx            # Pagina abonament + Stripe checkout
│       └── Profile.jsx            # Dashboard utilizator
├── netlify/functions/
│   ├── create-checkout.js         # Creare sesiune Stripe Checkout
│   ├── create-portal.js           # Portal gestionare abonament Stripe
│   └── stripe-webhook.js          # Webhook Stripe → actualizare Supabase
└── supabase/
    └── schema.sql                 # Schema bază de date (SQL)
```

## Configurare pas cu pas

### 1. Supabase

1. Mergi în **Supabase Dashboard** → proiectul tău
2. **SQL Editor** → New Query → lipește conținutul din `supabase/schema.sql` → Run
3. **Settings** → **API** → copiază:
   - `Project URL` → va fi `VITE_SUPABASE_URL`
   - `anon public` key → va fi `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → va fi `SUPABASE_SERVICE_ROLE_KEY` (doar pe server!)
4. **Authentication** → **URL Configuration** → setează Site URL la URL-ul Netlify

### 2. Stripe

1. În **Stripe Dashboard** → copiază:
   - Publishable key → `VITE_STRIPE_PUBLISHABLE_KEY`
   - Secret key → `STRIPE_SECRET_KEY`
2. **Developers** → **Webhooks** → Add endpoint:
   - URL: `https://SITE-UL-TAU.netlify.app/api/stripe-webhook`
   - Evenimente de ascultat:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
3. Copiază Webhook Signing Secret → `STRIPE_WEBHOOK_SECRET`

### 3. GitHub

1. Încarcă toate fișierele în repository-ul `examenmate`
2. Structura trebuie să fie exact ca mai sus (toate fișierele în rădăcina repo-ului)

### 4. Netlify

1. **Import project** din GitHub → selectează `examenmate`
2. **Build settings** (ar trebui detectate automat din `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
3. **Site settings** → **Environment variables** → adaugă:

   | Variabilă | Valoare |
   |-----------|---------|
   | `VITE_SUPABASE_URL` | URL-ul proiectului Supabase |
   | `VITE_SUPABASE_ANON_KEY` | Cheia anon publică Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | Cheia service role Supabase |
   | `VITE_STRIPE_PUBLISHABLE_KEY` | Cheia publishable Stripe |
   | `STRIPE_SECRET_KEY` | Cheia secret Stripe |
   | `STRIPE_WEBHOOK_SECRET` | Secretul webhook Stripe |

4. **Deploy** → site-ul va fi live!

## Model de acces la conținut

| Tip conținut | Gratuit | Premium (50 lei/lună) |
|---|---|---|
| Exerciții PDF (jumătate) | ✅ | ✅ |
| Exerciții PDF (cealaltă jumătate) | ❌ | ✅ |
| Exerciții Interactive | ❌ | ✅ |
| Manuale Online | ❌ | ✅ |

## Adăugare conținut (ulterior)

Conținutul se va gestiona prin tabela `content` din Supabase:
- `category`: `clasa-5`, `clasa-6`, `clasa-7`, `clasa-8`, `evaluare-nationala`, `bacalaureat`, `manuale`
- `content_type`: `pdf`, `interactive`, `manual`
- `is_free`: `true` pentru gratuit, `false` pentru premium
- `file_url`: link către PDF din Supabase Storage
- `interactive_data`: JSON cu datele exercițiului interactiv
- `manual_content`: conținut HTML/Markdown pentru manuale

Fișierele PDF se încarcă în bucket-ul `content-files` din Supabase Storage.
