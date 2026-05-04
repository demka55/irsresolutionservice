import Stripe from 'stripe'

const PRODUCT_BY_PLAN = {
  resolution: 'prod_ULbSugkF9C3Z1s',
  professional: 'prod_ULbUW1XVEhoXmW',
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const { plan = 'resolution', noticeCode, noticeTitle, email } = await req.json()

    const productId = PRODUCT_BY_PLAN[plan]
    if (!productId) {
      return Response.json({ error: `Unknown plan "${plan}".` }, { status: 400 })
    }

    const stripe = new Stripe(Netlify.env.get('STRIPE_SECRET_KEY'))
    const appUrl = Netlify.env.get('APP_URL') || 'https://irsresolutionservice.com'

    const product = await stripe.products.retrieve(productId)
    const priceId =
      typeof product.default_price === 'string'
        ? product.default_price
        : product.default_price?.id

    if (!priceId) {
      return Response.json(
        { error: 'No default price configured for this product in Stripe.' },
        { status: 500 }
      )
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      ...(email && { customer_email: email }),
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        plan,
        productId,
        noticeCode: noticeCode || '',
        noticeTitle: noticeTitle || '',
      },
      subscription_data: {
        metadata: {
          plan,
          productId,
        },
      },
      success_url: `${appUrl}/resolve.html?session_id={CHECKOUT_SESSION_ID}&notice=${encodeURIComponent(noticeCode || '')}&plan=${plan}`,
      cancel_url: `${appUrl}/?cancelled=1#pricing`,
      billing_address_collection: 'required',
      allow_promotion_codes: true,
    })

    return Response.json({ url: session.url, sessionId: session.id })
  } catch (err) {
    console.error('[Stripe] create-checkout error:', err.message)
    return Response.json(
      { error: 'Failed to create checkout session. Please try again.' },
      { status: 500 }
    )
  }
}

export const config = {
  path: '/api/stripe/create-checkout',
  method: 'POST',
}
