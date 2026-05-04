import Anthropic from '@anthropic-ai/sdk'
import Stripe from 'stripe'

const NOTICE_LETTER_GUIDES = {
  CP2000: {
    tone: "professional and factual",
    purpose: "respond to a proposed change to a tax return, either agreeing or disagreeing with the IRS's proposed adjustments",
    keyPoints: [
      'Reference the notice date and tax year prominently',
      'Clearly state whether taxpayer agrees, partially agrees, or disagrees',
      'Cite specific income items being disputed with documentation references',
      'Request a corrected notice if disputing',
      'Include a signature line for the taxpayer',
    ],
  },
  CP503: {
    tone: 'courteous but urgent',
    purpose: "acknowledge the balance due and communicate the taxpayer's payment plan or intent",
    keyPoints: [
      'Acknowledge the outstanding balance',
      'State specific payment action being taken (full payment, installment request, hardship)',
      'If requesting installment, mention Form 9465',
      'Request confirmation of account standing after payment',
    ],
  },
  CP504: {
    tone: 'urgent and legally precise',
    purpose: 'prevent levy action by communicating payment action or requesting a Collection Due Process hearing',
    keyPoints: [
      'Reference the specific levy threat and legal right to CDP hearing',
      'If requesting CDP: cite IRC Section 6330 and reference Form 12153',
      'State the specific collection alternative being pursued',
      'Request immediate confirmation of levy hold',
    ],
  },
  LT11: {
    tone: 'legally formal',
    purpose: 'exercise Collection Due Process rights and halt levy action',
    keyPoints: [
      'Formally invoke CDP hearing rights under IRC Section 6330',
      'Reference attached Form 12153',
      'State the collection alternative proposed (installment, OIC, CNC)',
      'Request confirmation that levy is suspended pending hearing',
    ],
  },
  CP11: {
    tone: 'analytical and factual',
    purpose: 'dispute or accept a math error correction to the tax return',
    keyPoints: [
      'Reference the specific line item changed by the IRS',
      'Provide the correct calculation with supporting documentation',
      'Cite the relevant tax form instructions or IRC section if applicable',
    ],
  },
  CP75: {
    tone: 'detailed and documentary',
    purpose: 'substantiate eligibility for EITC or other credits under audit',
    keyPoints: [
      'List each document provided as evidence',
      'Address each credit eligibility requirement specifically',
      'Reference relationship, residency, and income tests for EITC',
      'Request refund release upon verification',
    ],
  },
  DEFAULT: {
    tone: 'professional and cooperative',
    purpose: 'respond formally to the IRS notice',
    keyPoints: [
      'Reference the specific notice number and date',
      "State the taxpayer's position clearly",
      'Provide supporting documentation references',
      'Request written confirmation of resolution',
    ],
  },
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const {
      sessionId,
      noticeCode,
      noticeDate,
      taxYear,
      taxpayerName,
      taxpayerAddress,
      taxpayerSSNLast4,
      disputeItems,
      proposedAmount,
      taxpayerPosition,
      additionalContext,
      verificationFindings,
    } = await req.json()

    if (!sessionId) {
      return Response.json({ error: 'Payment verification required.' }, { status: 401 })
    }

    const stripe = new Stripe(Netlify.env.get('STRIPE_SECRET_KEY'))
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status !== 'paid') {
      return Response.json({ error: 'Payment not confirmed.' }, { status: 402 })
    }

    if (!noticeCode || !taxpayerName) {
      return Response.json({ error: 'noticeCode and taxpayerName are required.' }, { status: 400 })
    }

    const guide = NOTICE_LETTER_GUIDES[noticeCode] || NOTICE_LETTER_GUIDES.DEFAULT

    const verificationSummary =
      verificationFindings?.length
        ? `\n\nTRANSCRIPT VERIFICATION FINDINGS:\n${verificationFindings.map((f) => `- [${f.severity.toUpperCase()}] ${f.message}`).join('\n')}`
        : ''

    const disputeDetail =
      disputeItems?.length
        ? `\n\nITEMS IN DISPUTE OR BEING ADDRESSED:\n${disputeItems.map((item, i) => `${i + 1}. ${item.description} — Amount: $${item.amount?.toLocaleString() || 'N/A'} — Position: ${item.position || 'disputed'}`).join('\n')}`
        : ''

    const prompt = `You are a professional tax resolution specialist and enrolled agent drafting a formal IRS response letter on behalf of a taxpayer.

NOTICE DETAILS:
- Notice Type: ${noticeCode}
- Notice Date: ${noticeDate || 'date on notice'}
- Tax Year: ${taxYear}
- Proposed/Claimed Amount: $${parseFloat(proposedAmount || 0).toLocaleString()}
- Taxpayer Position: ${taxpayerPosition || 'responding'}

TAXPAYER INFORMATION:
- Name: ${taxpayerName}
- Address: ${taxpayerAddress || '[Taxpayer Address]'}
- SSN: ***-**-${taxpayerSSNLast4 || 'XXXX'}
${verificationSummary}
${disputeDetail}

ADDITIONAL CONTEXT FROM TAXPAYER:
${additionalContext || 'None provided.'}

LETTER REQUIREMENTS:
- Tone: ${guide.tone}
- Purpose: ${guide.purpose}
- Key points to address:
${guide.keyPoints.map((p) => `  • ${p}`).join('\n')}

Write a complete, professional IRS response letter. Format it as a real letter with:
1. Date line (use today's date)
2. IRS address block (appropriate for this notice type)
3. RE: line referencing the notice number and tax year
4. Formal salutation
5. Clear, well-organized body paragraphs
6. Professional closing
7. Signature block with enclosures list

The letter must be firm but professional. If disputing, cite specific facts. If agreeing, state clearly and reference payment method. Include relevant IRC sections or IRS publications where appropriate. Do not include any placeholder text — write as if this is the final letter.`

    const client = new Anthropic({ apiKey: Netlify.env.get('ANTHROPIC_API_KEY') })
    const model = Netlify.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-5'

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const msgStream = client.messages.stream({
            model,
            max_tokens: 2000,
            system:
              'You are an expert tax resolution specialist. You write formal, precise, legally sound IRS response letters. Write only the letter itself — no preamble, no meta-commentary, no markdown. Use plain text formatting suitable for printing on letterhead.',
            messages: [{ role: 'user', content: prompt }],
          })

          msgStream.on('text', (text) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
          })

          msgStream.on('finalMessage', (msg) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, usage: msg.usage })}\n\n`))
            controller.close()
          })

          msgStream.on('error', (err) => {
            console.error('[Letter] stream error:', err.message)
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: 'Letter generation failed. Please try again.' })}\n\n`)
            )
            controller.close()
          })
        } catch (err) {
          console.error('[Letter] stream setup error:', err.message)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'Failed to start letter generation.' })}\n\n`)
          )
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    console.error('[Letter] draft error:', err.message)
    return Response.json({ error: 'Failed to draft letter. Please try again.' }, { status: 500 })
  }
}

export const config = {
  path: '/api/letter/draft',
  method: 'POST',
}
