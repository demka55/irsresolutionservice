# IRS Resolution Service

Full-stack application powering an IRS notice resolution service, built by Romeo Razi (CPA, ex-IRS Auditor) and Dmitry Dragilev (4× SaaS founder).

**Free tier:** IRS notice decoder — static HTML, no backend needed
**Premium tier:** Stripe payment → IRS transcript pull → AI response letter drafting

## Architecture

```
/
├── public/
│   ├── index.html        ← Landing page with free notice decoder
│   └── resolve.html      ← Premium resolution flow (post-payment)
└── netlify/
    └── functions/
        ├── stripe-create-checkout.mjs  ← POST /api/stripe/create-checkout
        ├── stripe-session.mjs          ← GET  /api/stripe/session/:id
        ├── transcript-fetch.mjs        ← POST /api/transcript/fetch
        ├── letter-draft.mjs            ← POST /api/letter/draft (SSE streaming)
        ├── webhook.mjs                 ← POST /api/webhook
        └── health.mjs                  ← GET  /api/health
```

## Tech Stack

- **Hosting:** Netlify (static site + serverless functions)
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **Payments:** Stripe Checkout
- **AI:** Anthropic Claude (streaming letter drafting)
- **IRS Integration:** IRS e-Services Transcript Delivery System (TDS) API

## Prerequisites

- A **Stripe** account — [stripe.com](https://stripe.com)
- An **Anthropic** API key — [console.anthropic.com](https://console.anthropic.com)
- An **IRS e-Services** account with TDS access (optional until approved) — [irs.gov/e-services](https://la.www4.irs.gov/e-services/)

## Environment Variables

Set these in the Netlify dashboard under Site Settings → Environment Variables:

```
# Required
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
ANTHROPIC_API_KEY=sk-ant-...
APP_URL=https://your-site.netlify.app

# IRS TDS API (optional until e-Services approved)
IRS_CLIENT_ID=...
IRS_CLIENT_SECRET=...
IRS_API_BASE_URL=https://api.irs.gov/v1
IRS_EFIN=...
```

## Local Development

```bash
npm install
netlify dev
```

Requires [Netlify CLI](https://docs.netlify.com/cli/get-started/). Visit [http://localhost:8888](http://localhost:8888).

## Stripe Setup

1. Create a product at [dashboard.stripe.com/products](https://dashboard.stripe.com/products): **"IRS Notice Resolution"** at **$29.00 USD**
2. Copy the Price ID → set as `STRIPE_PRICE_ID`
3. Add a webhook endpoint at `https://your-site.netlify.app/api/webhook` for events: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`
4. Copy the webhook signing secret → set as `STRIPE_WEBHOOK_SECRET`

## Payment Flow

```
User clicks "Unlock Premium"
  → POST /api/stripe/create-checkout
  → Redirects to Stripe Checkout
  → On success: /resolve.html?session_id=...&notice=CP2000
  → GET /api/stripe/session/:id  (verify payment)
  → POST /api/transcript/fetch   (pull IRS transcript)
  → POST /api/letter/draft       (stream AI response letter)
```

## Legal Disclaimer

This service provides general informational guidance only and does not constitute legal or tax advice. For complex tax matters, consult a licensed enrolled agent or tax attorney. Not affiliated with the IRS.
