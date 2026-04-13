const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([key, val]) => res.setHeader(key, val));

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { userId, email } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ error: 'userId și email sunt obligatorii' });
    }

    // Verificăm dacă userul are deja un abonament activ
    const supabase = createClient(
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('subscription_status')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error('Supabase profile error:', profileError);
      return res.status(500).json({ error: 'Eroare la citirea profilului' });
    }

    if (profile?.subscription_status === 'active') {
      return res.status(400).json({ error: 'Ai deja un abonament activ.' });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${process.env.VERCEL_URL}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      metadata: { supabase_user_id: userId },
      subscription_data: {
        metadata: { supabase_user_id: userId },
      },
      line_items: [
        {
          price_data: {
            currency: 'ron',
            product_data: {
              name: 'Mate-Online Premium',
              description: 'Abonament lunar – acces complet la toate materialele',
            },
            unit_amount: 5000, //50 lei = 5000 bani
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/profil?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/preturi`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
};
