// api/create-checkout.js — creează o sesiune Stripe Checkout (abonat nou)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { admin, handledMethod, authUser } = require('./_lib/http');

// URL-ul site-ului: SITE_URL explicit; fallback pe VERCEL_URL (deployment).
function siteUrl() {
  return process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
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
