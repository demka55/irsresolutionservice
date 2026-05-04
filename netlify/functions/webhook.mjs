import Stripe from 'stripe'

export default async (req) => {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  const stripe = new Stripe(Netlify.env.get('STRIPE_SECRET_KEY'))
  const webhookSecret = Netlify.env.get('STRIPE_WEBHOOK_SECRET')
  const resendKey = Netlify.env.get('RESEND_API_KEY')
  const netlifyToken = Netlify.env.get('NETLIFY_ACCESS_TOKEN')
  const netlifySiteId = Netlify.env.get('NETLIFY_SITE_ID')

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
        const customerEmail = session.customer_details?.email || ''
        const customerName  = session.customer_details?.name  || ''
        const amount        = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : '$999.00'
        const sessionId     = session.id

        console.log(`[Webhook] Payment confirmed — ${customerName} (${customerEmail}) — ${amount}`)

        // 1. Create Netlify Identity account + send invite email
        if (customerEmail) {
          try {
            const identityRes = await fetch(
              `https://api.netlify.com/api/v1/sites/${netlifySiteId}/identity/users/invite`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${netlifyToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  email: customerEmail,
                  data: { full_name: customerName }
                }),
              }
            )
            const identityData = await identityRes.json()
            if (!identityRes.ok) {
              console.error('[Identity] Failed to create user:', JSON.stringify(identityData))
            } else {
              console.log('[Identity] Account created and invite sent to', customerEmail)
            }
          } catch (err) {
            console.error('[Identity] Error:', err.message)
          }
        }

        // 2. Email Romeo
        await sendEmail(resendKey, {
          from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
          to:   'romeo@taxedright.com',
          subject: `New client signed up — ${customerName}`,
          html: `
            <h2>New IRS Resolution Client</h2>
            <p>A new client just paid and their account has been created automatically.</p>
            <table style="border-collapse:collapse;width:100%;max-width:500px">
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${customerName}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${customerEmail}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Amount paid</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${amount}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Session ID</td><td style="padding:8px 12px;font-size:12px;color:#7a6e60">${sessionId}</td></tr>
            </table>
            <p style="margin-top:20px">They've been sent an email to set their password and log in to the dashboard.</p>
            <p style="color:#7a6e60;font-size:13px">IRS Resolution Service — irsresolutionservice.com</p>
          `
        })

        // 3. Email Dmitry
        await sendEmail(resendKey, {
          from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
          to:   'dmitry.dragilev@hey.com',
          subject: `New client signed up — ${customerName}`,
          html: `
            <h2>New IRS Resolution Client</h2>
            <p>A new client just paid $999. Account created automatically.</p>
            <table style="border-collapse:collapse;width:100%;max-width:500px">
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${customerName}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${customerEmail}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Amount paid</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${amount}</td></tr>
              <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Session ID</td><td style="padding:8px 12px;font-size:12px;color:#7a6e60">${sessionId}</td></tr>
            </table>
            <p style="color:#7a6e60;font-size:13px">IRS Resolution Service — irsresolutionservice.com</p>
          `
        })

        // 4. Email the customer
        await sendEmail(resendKey, {
          from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
          to:   customerEmail,
          subject: 'Welcome — your IRS resolution is underway',
          html: `
            <h2>Hi ${customerName},</h2>
            <p>Thank you for signing up. Romeo Razi and his team have been notified and will be in touch within 1 business day.</p>
            <p>You'll receive a separate email shortly to set your password and access your resolution dashboard — where you can track your progress and use the free IRS notice decoder.</p>
            <h3 style="margin-top:24px">What happens next:</h3>
            <ol style="line-height:2;color:#4a3f32">
              <li>Set your password using the link in the next email from us</li>
              <li>Log in to your dashboard at <a href="https://irsresolutionservice.com/resolve">irsresolutionservice.com/resolve</a></li>
              <li>Romeo's team will send you an IRS authorization request to approve</li>
              <li>We review your records and build your personalized resolution plan (3–5 days)</li>
              <li>You approve the plan — we file everything</li>
            </ol>
            <p style="margin-top:24px">Questions? Reply to this email or reach Romeo directly at <a href="mailto:romeo@taxedright.com">romeo@taxedright.com</a></p>
            <p style="color:#7a6e60;font-size:13px;margin-top:32px">IRS Resolution Service — irsresolutionservice.com<br>Not affiliated with the Internal Revenue Service.</p>
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
