// api/create-portal.js — sesiune Stripe Billing Portal (gestionare abonament)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { admin, handledMethod, authUser } = require('./_lib/http');

function siteUrl() {
  return process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
}

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  const supabase = admin();
  try {
    const userId = await authUser(req, supabase);

    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('stripe_customer_id').eq('id', userId).single();
    if (profileError) {
      console.error('Supabase profile error:', profileError);
      return res.status(500).json({ error: 'Eroare la citirea profilului' });
    }
    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'Nu există un client Stripe asociat acestui cont' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl()}/profil`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
