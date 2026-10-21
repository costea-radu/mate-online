// api/create-checkout.js — creează o sesiune Stripe Checkout:
//   · fără `type` în body  → abonament nou (mode: subscription, ca înainte)
//   · type='topup'         → PACHET AI suplimentar (mode: payment, o singură
//     plată; doar pentru abonați; creditat de stripe-webhook în `ai_topups`)
//   · type='live'          → BILET la meditațiile live: grup 10 lei / 1-la-1
//     20 lei (mode: payment; creditat de stripe-webhook în `live_tickets`)
//   Plățile unice (topup, live) primesc FACTURĂ în Stripe imediat după plată,
//   ca abonamentul — vezi oneTimePayment().
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
// Fără perioadă de probă (scoasă pe 21 oct 2026): prima perioadă se plătește
// chiar la abonare, iar factura reală apare imediat în Stripe (nu una de 0 lei).
// Variabila de mediu TRIAL_DAYS nu mai e citită.
//
// Prețurile se pot schimba din variabile de mediu, fără deploy de cod:
//   PRICE_MONTHLY_LEI=50   PRICE_ANNUAL_LEI=500
// Dacă preferi să administrezi prețurile din Stripe Dashboard, pune ID-urile
// în STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL — au prioritate.
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

// ─── Plățile unice: factură imediată, pe clientul Stripe al contului ─────────
// Abonamentul își primește factura automat (Stripe Billing). O plată unică
// (mode: 'payment' — pachet AI, bilet live) are factură doar dacă sesiunea o
// cere (`invoice_creation`): imediat după plată, Stripe emite factura deja
// PLĂTITĂ, în aceeași serie de numere cu abonamentele (Dashboard → Invoices).
// Clientul primește pe e-mail factura + chitanța dacă e pornit Settings →
// Business → Customer emails → „Successful payments". Cost Stripe: 0,4% din
// sumă per factură (4 bani la 10 lei).
//
// Factura cere un client Stripe. Refolosim clientul contului
// (profiles.stripe_customer_id — al abonamentului sau al unei plăți anterioare),
// ca plățile unei persoane să stea pe o singură fișă de client și să apară și
// în portalul „Gestionează abonamentul". Un id inutilizabil (client șters, creat
// cu cheile de test) NU blochează plata: Checkout face alt client din e-mail,
// iar webhookul îl leagă de cont dacă profilul nu avea deja unul.
async function stripeCustomerOf(profile) {
  const id = profile?.stripe_customer_id;
  if (!id) return null;
  try {
    const c = await stripe.customers.retrieve(id);
    return c && !c.deleted ? c.id : null;
  } catch (e) {
    console.warn('create-checkout: stripe_customer_id inutilizabil — Checkout creează alt client:', id, e.message);
    return null;
  }
}

// Parametrii comuni ai unei plăți unice: clientul, factura și o descriere
// lizibilă a plății (în Payments / „Recent activity" apare textul, nu `ch_…`).
// `metadata` ajunge pe sesiune (din ea creditează webhookul), pe plată și pe factură.
async function oneTimePayment(profile, { title, details, metadata }) {
  const customer = await stripeCustomerOf(profile);
  return {
    mode: 'payment',
    ...(customer
      ? { customer }
      : { customer_email: profile?.email || undefined, customer_creation: 'always' }),
    metadata,
    payment_intent_data: { description: title, metadata },
    invoice_creation: {
      enabled: true,
      invoice_data: { description: details || title, metadata },
    },
  };
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
  const name = `${pack.nume} — +${ai.fmtCredits(pack.creditLei)} credite AI`;
  const description = `Credite AI suplimentare pentru Profesorul Virtual, valabile ${ai.TOPUP_DAYS} de zile. Se adaugă peste creditele incluse în abonament și deblochează toate cotele.`;
  const session = await stripe.checkout.sessions.create({
    // Webhookul creditează EXACT din metadata (nu din env-ul de la momentul
    // webhookului) — pachetele pot fi reconfigurate fără să strice plățile în zbor.
    ...(await oneTimePayment(profile, {
      title: name,
      details: description,
      metadata: {
        supabase_user_id: userId,
        topup_pack: pack.id,
        topup_name: pack.nume,
        topup_credit_lei: String(pack.creditLei),
        topup_days: String(ai.TOPUP_DAYS),
      },
    })),
    line_items: [{
      price_data: {
        currency: 'ron',
        product_data: { name, description },
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

// ─── Bilet la MEDITAȚIILE LIVE (mode: 'payment', o singură plată) ─────────────
//   kind='grup'   → o ședință de grup anume (10 lei; abonații intră gratuit)
//   kind='privat' → o ședință 1-la-1 de 60 de minute, folosită oricând — live sau
//                   la Pregătirea de examen (20 lei; abonații au 8 incluse pe lună,
//                   comune pentru amândouă; biletul e pentru restul)
// Creditarea o face stripe-webhook.js în `live_tickets`, EXACT din metadata.
async function liveCheckout(req, res, supabase, userId, profile) {
  const L = require('./_lib/live');
  const kind = req.body?.kind === 'privat' ? 'privat' : 'grup';

  const { error: tblErr } = await supabase.from('live_tickets').select('id').limit(1);
  if (tblErr) {
    console.error('create-checkout live: tabela live_tickets lipsește?', tblErr.message);
    return res.status(503).json({ error: 'Meditațiile live nu sunt încă activate. (Admin: rulează supabase/meditatii_live.sql.)' });
  }

  let sessionRow = null;
  if (kind === 'grup') {
    const sid = String(req.body?.sessionId || '');
    const { data } = await supabase.from('live_sessions')
      .select('id, kind, teacher, slot, day, starts_at, ends_at, status, exam, profile').eq('id', sid).maybeSingle();
    if (!data || data.kind !== 'grup') return res.status(404).json({ error: 'Ședința nu există.' });
    const ph = L.phaseOf(data);
    if (ph === 'incheiata' || ph === 'anulata') return res.status(409).json({ error: 'Ședința s-a încheiat — alege alta din program.' });
    if (profile?.subscription_status === 'active') {
      return res.status(400).json({ error: 'Ședințele de grup sunt incluse în abonamentul tău — intră direct, fără plată.', code: 'INCLUDED' });
    }
    const { data: has } = await supabase.from('live_tickets').select('id').eq('user_id', userId).eq('kind', 'grup')
      .eq('session_id', data.id).eq('status', 'platit').limit(1);
    if (has && has.length) return res.status(400).json({ error: 'Ai deja bilet la această ședință.', code: 'HAS_TICKET' });
    sessionRow = data;
  }

  const price = kind === 'grup' ? L.PRICE_GROUP_LEI() : L.PRICE_PRIVATE_LEI();
  const teacher = L.teacherById(sessionRow?.teacher || req.body?.teacher) || L.teachers()[0];
  const slot = sessionRow ? L.slots().find((s) => s.id === sessionRow.slot) : null;
  let when = '';
  if (sessionRow) {
    try { when = new Intl.DateTimeFormat('ro-RO', { timeZone: L.TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(sessionRow.starts_at)); }
    catch { when = sessionRow.day || ''; }
  }
  const name = kind === 'grup'
    ? `Meditație live de grup — ${teacher.name}, ${when}, ${slot?.label || ''}`.replace(/,\s*$/, '')
    : `Meditație 1-la-1 (${L.PRIVATE_MINUTES()} de minute) — ${teacher.name}`;
  const description = kind === 'grup'
    ? `${L.EXAM_LABEL(sessionRow.exam, sessionRow.profile)} — subiect explicat pe barem, cu profesorul virtual (AI), în sala live ExamenMate.`
    : 'O ședință privată cu profesorul virtual (AI), pornită oricând: un subiect de examen ales sau Pregătirea de examen din „Planul meu" (explicate pe barem).';
  // întoarcerea: doar în rubrica de meditații (nu acceptăm URL-uri din afară)
  const back = /^\/meditatii(\/[\w/-]*)?$/.test(String(req.body?.returnTo || '')) ? req.body.returnTo : '/meditatii';
  const base = siteUrl();
  const session = await stripe.checkout.sessions.create({
    ...(await oneTimePayment(profile, {
      title: name,
      details: description,
      metadata: {
        supabase_user_id: userId,
        live_kind: kind,
        live_session_id: sessionRow?.id || '',
        live_price_lei: String(price),
      },
    })),
    line_items: [{
      price_data: { currency: 'ron', product_data: { name, description }, unit_amount: Math.round(price * 100) },
      quantity: 1,
    }],
    success_url: `${base}${back}?plata=ok&tip=${kind}${sessionRow ? `&sesiune=${sessionRow.id}` : ''}`,
    cancel_url: `${base}${back}?plata=anulat`,
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
      .from('profiles').select('subscription_status, email, is_admin, stripe_customer_id').eq('id', userId).single();
    if (profileError) {
      console.error('Supabase profile error:', profileError);
      return res.status(500).json({ error: 'Eroare la citirea profilului' });
    }

    // Adminul are acces complet fără abonament și nu are limite AI, deci nu
    // plătește nimic prin Stripe — nici abonament, nici pachete. Blocajul evită
    // o plată făcută din greșeală către propria platformă (comisioane, taxe).
    if (profile?.is_admin) {
      return res.status(400).json({ error: 'Contul de administrator are deja acces complet, fără abonament. Nu e nevoie de nicio plată.', code: 'ADMIN_NO_CHECKOUT' });
    }

    // Pachet AI suplimentar (top-up) — flux separat, mode: 'payment'.
    if (req.body?.type === 'topup') return await topupCheckout(req, res, supabase, userId, profile);
    // Bilet la meditațiile live (grup 10 lei / 1-la-1 20 lei) — mode: 'payment'.
    if (req.body?.type === 'live') return await liveCheckout(req, res, supabase, userId, profile);

    if (profile?.subscription_status === 'active') {
      return res.status(400).json({ error: 'Ai deja un abonament activ.' });
    }
    const email = profile?.email || req.body?.email;

    // Planul ales pe /preturi (implicit lunar, ca înainte).
    const plan = PLANS[String(req.body?.plan || 'lunar')] || PLANS.lunar;

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

    // Fără probă: prima perioadă se plătește acum și Stripe emite pe loc factura.
    // Abonamentul NU refolosește clientul Stripe existent (spre deosebire de
    // plățile unice): webhookul dezactivează contul după client, iar anularea
    // unui abonament vechi, restant, ar opri și abonamentul nou de pe același
    // client. Checkout creează clientul din e-mail, ca înainte.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      metadata: { supabase_user_id: userId, plan: plan.id },
      subscription_data: {
        metadata: { supabase_user_id: userId, plan: plan.id },
      },
      payment_method_collection: 'always',
      line_items: [lineItem],
      // `plan` și `val` ajung în pagina de mulțumire pentru măsurarea
      // conversiei (GA4 + Meta Pixel) — vezi src/pages/Profile.jsx.
      success_url: `${base}/profil?session_id={CHECKOUT_SESSION_ID}&plan=${plan.id}&val=${plan.lei}`,
      cancel_url: `${base}/preturi?anulat=1`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
};
