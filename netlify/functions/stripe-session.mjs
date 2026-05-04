import Stripe from 'stripe'

export default async (req, context) => {
  try {
    const sessionId = context.params.id
    const stripe = new Stripe(Netlify.env.get('STRIPE_SECRET_KEY'))

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent', 'customer'],
    })

    if (session.payment_status !== 'paid') {
      return Response.json({ error: 'Payment not completed.' }, { status: 402 })
    }

    return Response.json({
      paid: true,
      sessionId: session.id,
      noticeCode: session.metadata?.noticeCode,
      noticeTitle: session.metadata?.noticeTitle,
      email: session.customer_details?.email,
      name: session.customer_details?.name,
      amountPaid: session.amount_total,
    })
  } catch (err) {
    console.error('[Stripe] session retrieve error:', err.message)
    return Response.json(
      { error: 'Could not verify payment. Please contact support.' },
      { status: 500 }
    )
  }
}

export const config = {
  path: '/api/stripe/session/:id',
  method: 'GET',
}
