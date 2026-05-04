import Stripe from 'stripe'

export default async (req) => {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  const stripe = new Stripe(Netlify.env.get('STRIPE_SECRET_KEY'))
  const webhookSecret = Netlify.env.get('STRIPE_WEBHOOK_SECRET')
  const resendKey = Netlify.env.get('RESEND_API_KEY')

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
        const customerEmail = session.customer_details?.email || 'Unknown'
        const customerName  = session.customer_details?.name  || 'Unknown'
        const amount        = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : '$999.00'
        const sessionId     = session.id

        console.log(`[Webhook] Payment confirmed — ${customerName} (${customerEmail}) — ${amount}`)

        // Send email to Romeo
        await sendEmail(resendKey, {
          from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
          to:   'romeo@taxedright.com',
          subject: `New client signed up — ${customerName}`,
          html: `
            <h2>New IRS Resolution Client</h2>
            <p>A new client just paid and is ready to get started.</p>
            <table style="border-collapse:collapse;width:100%;max-width:500px">
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${customerName}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${customerEmail}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Amount paid</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${amount}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Session ID</td><td style="padding:8px 12px;font-size:12px;color:#7a6e60">${sessionId}</td></tr>
            </table>
            <p style="margin-top:20px">They've been directed to the dashboard and instructed to email you at <strong>romeo@taxedright.com</strong> to kick things off.</p>
            <p style="color:#7a6e60;font-size:13px">IRS Resolution Service — irsresolutionservice.com</p>
          `
        })

        // Send email to Dmitry
        await sendEmail(resendKey, {
          from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
          to:   'dmitry.dragilev@hey.com',
          subject: `New client signed up — ${customerName}`,
          html: `
            <h2>New IRS Resolution Client</h2>
            <p>A new client just paid $999.</p>
            <table style="border-collapse:collapse;width:100%;max-width:500px">
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${customerName}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${customerEmail}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Amount paid</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${amount}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Session ID</td><td style="padding:8px 12px;font-size:12px;color:#7a6e60">${sessionId}</td></tr>
            </table>
            <p style="color:#7a6e60;font-size:13px">IRS Resolution Service — irsresolutionservice.com</p>
          `
        })
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

async function sendEmail(apiKey, { from, to, subject, html }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('[Resend] Error sending to', to, ':', JSON.stringify(data))
    } else {
      console.log('[Resend] Email sent to', to, '— ID:', data.id)
    }
  } catch (err) {
    console.error('[Resend] Fetch failed:', err.message)
  }
}

export const config = {
  path: '/api/webhook',
  method: 'POST',
}
