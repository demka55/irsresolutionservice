import Stripe from 'stripe'

export default async (req) => {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  const stripe = new Stripe(Netlify.env.get('STRIPE_SECRET_KEY'))
  const webhookSecret = Netlify.env.get('STRIPE_WEBHOOK_SECRET')

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('[Webhook] Signature verification failed:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      if (session.payment_status === 'paid') {
        console.log(`[Webhook] Payment confirmed — Session: ${session.id}`)
        console.log(`  Notice: ${session.metadata?.noticeCode}`)
        console.log(`  Customer: ${session.customer_details?.email}`)
      }
      break
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object
      console.log(`[Webhook] Payment failed — PaymentIntent: ${pi.id}`)
      break
    }
    case 'charge.refunded': {
      const charge = event.data.object
      console.log(`[Webhook] Refund issued — Charge: ${charge.id}`)
      break
    }
    default:
      break
  }

  return Response.json({ received: true })
}

export const config = {
  path: '/api/webhook',
  method: 'POST',
}
