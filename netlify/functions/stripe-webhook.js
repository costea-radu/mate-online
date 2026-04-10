const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];

  // Netlify poate trimite body-ul ca base64 — trebuie decodat înainte de verificarea semnăturii
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : event.body;

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
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
          return { statusCode: 400, body: 'Missing supabase_user_id in metadata' };
        }

        const { error } = await supabase
          .from('profiles')
          .update({
            stripe_customer_id: customerId,
            subscription_status: 'active',
            subscription_id: session.subscription,
          })
          .eq('id', userId);

        if (error) {
          console.error('Supabase update error (checkout.session.completed):', error);
          return { statusCode: 500, body: 'Database update failed' };
        }

        break;
      }

      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object;
        const customerId = subscription.customer;
        // Tratăm și 'trialing' ca activ
        const status = ['active', 'trialing'].includes(subscription.status) ? 'active' : 'inactive';

        const { error } = await supabase
          .from('profiles')
          .update({ subscription_status: status })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Supabase update error (customer.subscription.updated):', error);
          return { statusCode: 500, body: 'Database update failed' };
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
          return { statusCode: 500, body: 'Database update failed' };
        }

        break;
      }

      // Plată eșuată — dezactivăm accesul premium
      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        const customerId = invoice.customer;

        const { error } = await supabase
          .from('profiles')
          .update({ subscription_status: 'inactive' })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Supabase update error (invoice.payment_failed):', error);
          return { statusCode: 500, body: 'Database update failed' };
        }

        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    return { statusCode: 500, body: 'Webhook processing error' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
