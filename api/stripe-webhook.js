const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const mailer = require('./_lib/mailer');
const ai = require('./_lib/ai'); // fmtCredits — creditele AI, unitatea afișată utilizatorului

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Alertă pe email către admin (best-effort — nu blochează niciodată webhookul).
async function alertAdmin({ emoji, subject, lines }) {
  if (!mailer.enabled()) return;
  try {
    const html = mailer.template({
      title: subject,
      bodyHtml: lines.map((l) => `<p style="margin:6px 0">${l}</p>`).join(''),
      footerNote: 'Alertă automată de la webhookul Stripe al ExamenMate.',
    });
    await mailer.sendMail({ to: mailer.ADMIN_EMAIL, subject: `${emoji} ${subject}`, html });
  } catch (e) { console.error('stripe-webhook: alertă email eșuată:', e.message); }
}

async function profileByCustomer(supabase, customerId) {
  const { data } = await supabase.from('profiles')
    .select('full_name, email').eq('stripe_customer_id', customerId).single();
  return data || {};
}

const handler = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const userId = session.metadata?.supabase_user_id;
        const customerId = session.customer;

        if (!userId) {
          console.error('checkout.session.completed: supabase_user_id lipsește din metadata');
          return res.status(400).send('Missing supabase_user_id in metadata');
        }

        // ── PACHET AI SUPLIMENTAR (top-up, mode: 'payment') ──────────────
        // NU atinge abonamentul. Creditează bugetul AI în `ai_topups`,
        // idempotent pe stripe_session_id (Stripe poate retrimite evenimentul).
        if (session.metadata?.topup_pack) {
          const creditLei = parseFloat(session.metadata.topup_credit_lei || '0');
          const days = parseInt(session.metadata.topup_days || '30', 10);
          if (!(creditLei > 0)) {
            console.error('topup: topup_credit_lei invalid în metadata:', session.metadata.topup_credit_lei);
            return res.status(400).send('Invalid topup_credit_lei');
          }
          const { error: tErr } = await supabase.from('ai_topups').upsert({
            user_id: userId,
            pack_id: session.metadata.topup_pack,
            name: session.metadata.topup_name || session.metadata.topup_pack,
            credit_micro: Math.round(creditLei * 1e6),
            price_bani: session.amount_total != null ? session.amount_total : null,
            stripe_session_id: session.id,
            expires_at: new Date(Date.now() + days * 24 * 3600 * 1000).toISOString(),
          }, { onConflict: 'stripe_session_id', ignoreDuplicates: true });

          if (tErr) {
            // BANI ÎNCASAȚI fără creditare → 500, ca Stripe să REÎNCERCE
            // (se vindecă singur după rularea migrării ai_topup.sql) + alertă.
            console.error('topup: creditarea a eșuat:', tErr);
            await alertAdmin({
              emoji: '🚨',
              subject: 'Top-up AI plătit dar NECREDITAT — verifică urgent',
              lines: [
                `Utilizator: <code>${mailer.escapeHtml(String(userId))}</code>, pachet: ${mailer.escapeHtml(String(session.metadata.topup_pack))}.`,
                `Eroare: <code>${mailer.escapeHtml(String(tErr.message || tErr))}</code>`,
                'Stripe va reîncerca automat webhookul. Dacă eroarea persistă, rulează supabase/ai_topup.sql.',
              ],
            });
            return res.status(500).send('Topup credit failed');
          }

          const { data: prof2 } = await supabase.from('profiles').select('full_name, email').eq('id', userId).single();
          const amount2 = session.amount_total != null ? `${(session.amount_total / 100).toFixed(2)} ${String(session.currency || '').toUpperCase()}` : '—';
          await alertAdmin({
            emoji: '💳',
            subject: 'Pachet AI suplimentar cumpărat pe ExamenMate',
            lines: [
              `<strong>${mailer.escapeHtml(prof2?.full_name || 'Utilizator')}</strong> (${mailer.escapeHtml(prof2?.email || session.customer_details?.email || '?')})`,
              `Pachet: <strong>${mailer.escapeHtml(session.metadata.topup_name || session.metadata.topup_pack)}</strong> · Sumă: <strong>${amount2}</strong> · Credite adăugate: <strong>${ai.fmtCredits(creditLei)} credite AI</strong> (${days} zile)`,
            ],
          });
          break;
        }

        // ── ABONAMENT NOU (mode: 'subscription', ca înainte) ─────────────
        // subscription_started_at (supabase/reviews_v2.sql) alimentează invitația
        // la recenzie „după 7 zile de abonament" (api/review-invite.js). Dacă
        // coloana lipsește (SQL nerulat), reluăm fără ea — webhookul NU trebuie
        // să pice (Stripe ar reîncerca la nesfârșit).
        const baseUpdate = {
          stripe_customer_id: customerId,
          subscription_status: 'active',
          subscription_id: session.subscription,
        };
        let { error } = await supabase
          .from('profiles')
          .update({ ...baseUpdate, subscription_started_at: new Date().toISOString() })
          .eq('id', userId);
        if (error && /subscription_started_at/i.test(String(error.message || ''))) {
          ({ error } = await supabase.from('profiles').update(baseUpdate).eq('id', userId));
        }

        if (error) {
          console.error('Supabase update error (checkout.session.completed):', error);
          return res.status(500).send('Database update failed');
        }

        // 🔔 Email către admin: abonament nou
        const { data: prof } = await supabase.from('profiles').select('full_name, email').eq('id', userId).single();
        const amount = session.amount_total != null ? `${(session.amount_total / 100).toFixed(2)} ${String(session.currency || '').toUpperCase()}` : '—';
        await alertAdmin({
          emoji: '🎉',
          subject: 'Abonament NOU pe ExamenMate',
          lines: [
            `<strong>${mailer.escapeHtml(prof?.full_name || 'Utilizator')}</strong> (${mailer.escapeHtml(prof?.email || session.customer_details?.email || '?')})`,
            `Sumă: <strong>${amount}</strong>`,
            `Stripe customer: <code>${mailer.escapeHtml(String(customerId || ''))}</code>`,
          ],
        });
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object;
        const customerId = subscription.customer;
        const status = ['active', 'trialing'].includes(subscription.status) ? 'active' : 'inactive';

        const { error } = await supabase
          .from('profiles')
          .update({ subscription_status: status })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Supabase update error (customer.subscription.updated):', error);
          return res.status(500).send('Database update failed');
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        const customerId = subscription.customer;

        const { error } = await supabase
          .from('profiles')
          .update({
            subscription_status: 'inactive',
            subscription_id: null,
          })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Supabase update error (customer.subscription.deleted):', error);
          return res.status(500).send('Database update failed');
        }

        // 🔔 Email către admin: abonament anulat
        const prof = await profileByCustomer(supabase, customerId);
        await alertAdmin({
          emoji: '📉',
          subject: 'Abonament ANULAT pe ExamenMate',
          lines: [`<strong>${mailer.escapeHtml(prof.full_name || 'Utilizator')}</strong> (${mailer.escapeHtml(prof.email || '?')}) și-a anulat abonamentul.`],
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        const customerId = invoice.customer;

        const { error } = await supabase
          .from('profiles')
          .update({ subscription_status: 'inactive' })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Supabase update error (invoice.payment_failed):', error);
          return res.status(500).send('Database update failed');
        }

        // 🔔 Email către admin: plată eșuată
        const prof = await profileByCustomer(supabase, customerId);
        await alertAdmin({
          emoji: '⚠️',
          subject: 'Plată EȘUATĂ pe ExamenMate',
          lines: [`Plata pentru <strong>${mailer.escapeHtml(prof.full_name || 'un utilizator')}</strong> (${mailer.escapeHtml(prof.email || '?')}) a eșuat — abonamentul a fost dezactivat.`],
        });
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).send('Webhook processing error');
  }

  return res.status(200).json({ received: true });
};

module.exports = handler;
// IMPORTANT: config-ul trebuie atașat DUPĂ module.exports = handler — în
// versiunea veche era setat înainte și era suprascris (bodyParser rămânea activ).
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
