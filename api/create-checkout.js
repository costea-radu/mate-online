// api/create-checkout.js — creează o sesiune Stripe Checkout:
//   · fără `type` în body  → abonament nou (mode: subscription, ca înainte)
//   · type='topup'         → PACHET AI suplimentar (mode: payment, o singură
//     plată; doar pentru abonați; creditat de stripe-webhook în `ai_topups`)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { admin, handledMethod, authUser } = require('./_lib/http');
const ai = require('./_lib/ai'); // pachetele top-up (topupPacks, TOPUP_DAYS)

// URL-ul site-ului: SITE_URL explicit; fallback pe VERCEL_URL (deployment).
function siteUrl() {
  return process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
}

// ─── PLANURILE DE ABONAMENT ─────────────────────────────────────────────────
// Lunar 50 lei · Anual 500 lei (10 luni plătite, 2 luni cadou).
// Probă gratuită: 2 zile, DOAR la primul abonament al contului.
//
// Prețurile se pot schimba din variabile de mediu, fără deploy de cod:
//   PRICE_MONTHLY_LEI=50   PRICE_ANNUAL_LEI=500   TRIAL_DAYS=2
// Dacă preferi să administrezi prețurile din Stripe Dashboard, pune ID-urile
// în STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL — au prioritate.
const TRIAL_DAYS = Math.max(0, parseInt(process.env.TRIAL_DAYS || '2', 10));
const PLANS = {
  lunar: {
    id: 'lunar',
    interval: 'month',
    lei: parseFloat(process.env.PRICE_MONTHLY_LEI || '50'),
    priceId: process.env.STRIPE_PRICE_MONTHLY || null,
    name: 'ExamenMate Premium — lunar',
    description: 'Abonament lunar — acces complet la toate materialele',
  },
  anual: {
    id: 'anual',
    interval: 'year',
    lei: parseFloat(process.env.PRICE_ANNUAL_LEI || '500'),
    priceId: process.env.STRIPE_PRICE_ANNUAL || null,
    name: 'ExamenMate Premium — anual',
    description: 'Abonament anual — 10 luni plătite, 2 luni cadou. Acces complet la toate materialele.',
  },
};

// Proba gratuită se dă o singură dată per cont. `subscription_started_at`
// (supabase/reviews_v2.sql) e completată de webhook la primul abonament; dacă
// migrarea nu e rulată, coloana lipsește — atunci nu blocăm proba.
async function trialDaysFor(supabase, userId) {
  if (!TRIAL_DAYS) return 0;
  const { data, error } = await supabase
    .from('profiles').select('subscription_started_at').eq('id', userId).maybeSingle();
  if (error) return TRIAL_DAYS; // coloana lipsește → nu blocăm nimic
  return data?.subscription_started_at ? 0 : TRIAL_DAYS;
}

// ─── Pachet AI suplimentar (top-up de buget) ─────────────────────────────────
async function topupCheckout(req, res, supabase, userId, profile) {
  if (profile?.subscription_status !== 'active') {
    return res.status(402).json({ error: 'Pachetele AI suplimentare sunt pentru abonați. Abonează-te întâi la ExamenMate Premium.', code: 'PREMIUM_REQUIRED' });
  }
  const pack = ai.topupPacks().find((p) => p.id === String(req.body?.pack || ''));
  if (!pack) return res.status(400).json({ error: 'Pachet necunoscut.' });

  // Plasă de siguranță: nu încasăm bani dacă tabela de creditare nu există
  // (migrarea supabase/ai_topup.sql nerulată) — altfel webhookul nu ar avea
  // unde să pună creditul.
  const { error: tblErr } = await supabase.from('ai_topups').select('id').limit(1);
  if (tblErr) {
    console.error('create-checkout topup: tabela ai_topups lipsește?', tblErr.message);
    return res.status(503).json({ error: 'Pachetele AI nu sunt încă activate. (Admin: rulează supabase/ai_topup.sql.)' });
  }

  const base = siteUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: profile?.email || undefined,
    // Webhookul creditează EXACT din metadata (nu din env-ul de la momentul
    // webhookului) — pachetele pot fi reconfigurate fără să strice plățile în zbor.
    metadata: {
      supabase_user_id: userId,
      topup_pack: pack.id,
      topup_name: pack.nume,
      topup_credit_lei: String(pack.creditLei),
      topup_days: String(ai.TOPUP_DAYS),
    },
    line_items: [{
      price_data: {
        currency: 'ron',
        product_data: {
          name: `${pack.nume} — +${ai.fmtCredits(pack.creditLei)} credite AI`,
          description: `Credite AI suplimentare pentru Profesorul Virtual, valabile ${ai.TOPUP_DAYS} de zile. Se adaugă peste creditele incluse în abonament și deblochează toate cotele.`,
        },
        unit_amount: Math.round(pack.pretLei * 100),
      },
      quantity: 1,
    }],
    // Întoarcerea aterizează în „Contul meu", unde rolldown-ul „⚡ Consum AI"
    // se deschide singur și afișează confirmarea.
    success_url: `${base}/profil?topup=succes`,
    cancel_url: `${base}/profil?topup=anulat`,
  });
  return res.status(200).json({ url: session.url });
}

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const userId = await authUser(req, supabase);

    // Email + status abonament din profilul REAL (nu din body).
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('subscription_status, email').eq('id', userId).single();
    if (profileError) {
      console.error('Supabase profile error:', profileError);
      return res.status(500).json({ error: 'Eroare la citirea profilului' });
    }

    // Pachet AI suplimentar (top-up) — flux separat, mode: 'payment'.
    if (req.body?.type === 'topup') return await topupCheckout(req, res, supabase, userId, profile);

    if (profile?.subscription_status === 'active') {
      return res.status(400).json({ error: 'Ai deja un abonament activ.' });
    }
    const email = profile?.email || req.body?.email;

    // Planul ales pe /preturi (implicit lunar, ca înainte).
    const plan = PLANS[String(req.body?.plan || 'lunar')] || PLANS.lunar;
    const trialDays = await trialDaysFor(supabase, userId);

    const base = siteUrl();
    const lineItem = plan.priceId
      ? { price: plan.priceId, quantity: 1 }
      : {
        price_data: {
          currency: 'ron',
          product_data: { name: plan.name, description: plan.description },
          unit_amount: Math.round(plan.lei * 100),
          recurring: { interval: plan.interval },
        },
        quantity: 1,
      };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      metadata: { supabase_user_id: userId, plan: plan.id },
      subscription_data: {
        metadata: { supabase_user_id: userId, plan: plan.id },
        ...(trialDays ? {
          trial_period_days: trialDays,
          // Fără card valid la finalul probei, abonamentul se anulează
          // singur — nu rămâne nimeni „activ" fără să poată plăti.
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        } : {}),
      },
      // Cardul se cere de la început, inclusiv în probă: altfel proba de 2 zile
      // se poate relua la nesfârșit cu conturi noi.
      payment_method_collection: 'always',
      line_items: [lineItem],
      // `plan` și `proba` ajung în pagina de mulțumire pentru măsurarea
      // conversiei (GA4 + Meta Pixel) — vezi src/pages/Profile.jsx.
      success_url: `${base}/profil?session_id={CHECKOUT_SESSION_ID}&plan=${plan.id}&val=${plan.lei}${trialDays ? '&proba=1' : ''}`,
      cancel_url: `${base}/preturi?anulat=1`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
