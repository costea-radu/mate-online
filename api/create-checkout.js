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
          name: `${pack.nume} — +${pack.creditLei} lei buget AI`,
          description: `Buget suplimentar pentru Profesorul Virtual, valabil ${ai.TOPUP_DAYS} de zile. Se adaugă peste bugetul inclus în abonament.`,
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

    const base = siteUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      metadata: { supabase_user_id: userId },
      subscription_data: { metadata: { supabase_user_id: userId } },
      line_items: [{
        price_data: {
          currency: 'ron',
          product_data: {
            name: 'ExamenMate Premium',
            description: 'Abonament lunar – acces complet la toate materialele',
          },
          unit_amount: 5000,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      success_url: `${base}/profil?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/preturi`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
