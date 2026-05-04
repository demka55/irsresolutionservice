import Stripe from 'stripe'
import axios from 'axios'
import { parseStringPromise } from 'xml2js'

// ── IRS OAuth token cache (tokens are valid for ~1 hour) ──────────────────────
let irsTokenCache = { token: null, expiresAt: 0 }

async function getIRSAccessToken(apiBaseUrl, clientId, clientSecret) {
  const now = Date.now()
  if (irsTokenCache.token && now < irsTokenCache.expiresAt - 60000) {
    return irsTokenCache.token
  }

  const response = await axios.post(
    `${apiBaseUrl}/oauth/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'tds:transcript',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  irsTokenCache = {
    token: response.data.access_token,
    expiresAt: now + response.data.expires_in * 1000,
  }

  return irsTokenCache.token
}

async function parseTranscriptXML(xml) {
  const result = await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true })
  const root = result?.TranscriptDeliverySystemResponse?.Transcript
  if (!root) throw new Error('Unexpected transcript format from IRS')

  return {
    taxpayerName: root.TaxpayerName || '',
    tin: maskTIN(root.TIN || ''),
    taxYear: root.TaxPeriodEnd?.substring(0, 4) || '',
    filingStatus: root.FilingStatus || '',
    returnType: root.ReturnType || '',
    adjustedGrossIncome: parseDollar(root.AdjustedGrossIncome),
    totalTax: parseDollar(root.TotalTax),
    totalPayments: parseDollar(root.TotalPayments),
    balanceDue: parseDollar(root.BalanceDue),
    refundAmount: parseDollar(root.RefundAmount),
    accountTransactions: parseTransactions(root.AccountTransactions),
    wageIncomeItems: parseWageItems(root.WageIncomeItems),
  }
}

function maskTIN(tin) {
  if (!tin || tin.length < 4) return '***-**-****'
  return `***-**-${tin.slice(-4)}`
}

function parseDollar(val) {
  if (!val) return 0
  return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0
}

function parseTransactions(txns) {
  if (!txns) return []
  const items = Array.isArray(txns.Transaction) ? txns.Transaction : [txns.Transaction].filter(Boolean)
  return items.map((t) => ({
    date: t.TransactionDate || '',
    code: t.TransactionCode || '',
    description: t.TransactionDescription || '',
    amount: parseDollar(t.Amount),
    type: t.TransactionType || '',
  }))
}

function parseWageItems(wages) {
  if (!wages) return []
  const items = Array.isArray(wages.WageItem) ? wages.WageItem : [wages.WageItem].filter(Boolean)
  return items.map((w) => ({
    employer: w.EmployerName || w.PayerName || '',
    ein: maskEIN(w.EmployerEIN || w.PayerEIN || ''),
    formType: w.FormType || 'W-2',
    wages: parseDollar(w.WagesAmount),
    taxWithheld: parseDollar(w.FederalTaxWithheld),
    otherIncome: parseDollar(w.OtherIncome),
  }))
}

function maskEIN(ein) {
  if (!ein || ein.length < 3) return '**-*******'
  return `${ein.substring(0, 2)}-*****${ein.slice(-2)}`
}

function crossVerify(noticeData, transcript) {
  const findings = []
  const { noticeCode, proposedAmount, noticeYear, noticeIncomeItems } = noticeData

  if (proposedAmount && transcript.balanceDue) {
    const diff = Math.abs(proposedAmount - transcript.balanceDue)
    if (diff > 1) {
      findings.push({
        type: 'AMOUNT_MISMATCH',
        severity: 'high',
        message: `Notice claims $${proposedAmount.toLocaleString()} owed, but your IRS account transcript shows $${transcript.balanceDue.toLocaleString()} balance. Difference: $${diff.toLocaleString()}.`,
        action: 'This discrepancy should be cited in your response letter. Request an account transcript breakdown.',
      })
    } else {
      findings.push({
        type: 'AMOUNT_CONFIRMED',
        severity: 'info',
        message: `The amount claimed in the notice ($${proposedAmount.toLocaleString()}) matches your IRS account balance.`,
        action: 'The balance appears accurate. Consider your payment options.',
      })
    }
  }

  if (noticeCode === 'CP2000' && noticeIncomeItems?.length) {
    for (const item of noticeIncomeItems) {
      const match = transcript.wageIncomeItems.find(
        (w) =>
          w.employer.toLowerCase().includes(item.payer?.toLowerCase() || '') ||
          Math.abs(w.wages - item.amount) < 50 ||
          Math.abs(w.otherIncome - item.amount) < 50
      )
      if (match) {
        findings.push({
          type: 'INCOME_CONFIRMED',
          severity: 'info',
          message: `Income item from ${item.payer || 'unknown payer'} ($${item.amount?.toLocaleString()}) is confirmed in your IRS wage transcript.`,
          action: 'This income was reported to the IRS. If you reported it differently on your return, explain why.',
        })
      } else {
        findings.push({
          type: 'INCOME_NOT_FOUND',
          severity: 'high',
          message: `Income of $${item.amount?.toLocaleString()} from ${item.payer || 'unknown payer'} appears in the notice but NOT in your IRS wage transcript. This may be an IRS data error.`,
          action: 'Dispute this item. Request the specific 1099 or W-2 the IRS is referencing.',
        })
      }
    }
  }

  const recentPayments = transcript.accountTransactions.filter(
    (t) => t.type === 'PAYMENT' && t.date >= `${noticeData.noticeYear || '2023'}-01-01`
  )
  if (recentPayments.length > 0) {
    const totalPaid = recentPayments.reduce((sum, t) => sum + t.amount, 0)
    findings.push({
      type: 'RECENT_PAYMENTS_FOUND',
      severity: 'medium',
      message: `Your transcript shows ${recentPayments.length} payment(s) totaling $${totalPaid.toLocaleString()} after ${noticeData.noticeYear}. These may not be reflected in this notice.`,
      action: 'Include proof of these payments in your response. The balance may already be reduced or resolved.',
    })
  }

  return findings
}

function summarizeFindings(findings) {
  const high = findings.filter((f) => f.severity === 'high').length
  const medium = findings.filter((f) => f.severity === 'medium').length
  if (high > 0) {
    return {
      level: 'warning',
      message: `${high} potential discrepanc${high === 1 ? 'y' : 'ies'} found between the notice and your IRS records. Review before responding.`,
    }
  }
  if (medium > 0) {
    return {
      level: 'caution',
      message: `${medium} item${medium === 1 ? '' : 's'} may affect your response. Review the findings below.`,
    }
  }
  return { level: 'clear', message: 'No major discrepancies found. The notice appears consistent with your IRS records.' }
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const {
      sessionId,
      taxYear,
      transcriptType,
      noticeCode,
      proposedAmount,
      noticeIncomeItems,
    } = await req.json()

    const irsClientId = Netlify.env.get('IRS_CLIENT_ID')
    const irsClientSecret = Netlify.env.get('IRS_CLIENT_SECRET')
    const irsApiBaseUrl = Netlify.env.get('IRS_API_BASE_URL') || 'https://api.irs.gov/v1'
    const irsEfin = Netlify.env.get('IRS_EFIN') || ''

    const irsConfigured =
      irsClientId &&
      !irsClientId.startsWith('REPLACE_WITH') &&
      irsClientSecret &&
      !irsClientSecret.startsWith('REPLACE_WITH')

    if (!irsConfigured) {
      return Response.json(
        { error: 'IRS transcript service is not yet configured. Your e-Services TDS application is pending approval. Contact support@irsresolutionservice.com.' },
        { status: 503 }
      )
    }

    if (!sessionId) {
      return Response.json({ error: 'Payment verification required.' }, { status: 401 })
    }

    const stripe = new Stripe(Netlify.env.get('STRIPE_SECRET_KEY'))
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status !== 'paid') {
      return Response.json({ error: 'Payment not confirmed.' }, { status: 402 })
    }

    if (!taxYear || !transcriptType) {
      return Response.json({ error: 'taxYear and transcriptType are required.' }, { status: 400 })
    }

    const validTypes = ['ACCOUNT', 'WAGE', 'RECORD', 'RETURN', 'VERIFICATION']
    if (!validTypes.includes(transcriptType)) {
      return Response.json(
        { error: `transcriptType must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      )
    }

    const accessToken = await getIRSAccessToken(irsApiBaseUrl, irsClientId, irsClientSecret)

    const irsResponse = await axios.post(
      `${irsApiBaseUrl}/tds/transcript`,
      {
        transcriptType,
        taxYear: parseInt(taxYear),
        requestId: `RS-${Date.now()}`,
        requestorId: irsEfin,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-IRS-EFIN': irsEfin,
          'X-Request-ID': `RS-${session.id}-${Date.now()}`,
        },
        timeout: 30000,
      }
    )

    const transcript = await parseTranscriptXML(irsResponse.data)

    const verificationFindings = crossVerify(
      {
        noticeCode,
        proposedAmount: parseFloat(proposedAmount) || 0,
        noticeYear: taxYear,
        noticeIncomeItems: noticeIncomeItems || [],
      },
      transcript
    )

    return Response.json({
      success: true,
      transcript,
      verification: {
        findings: verificationFindings,
        summary: summarizeFindings(verificationFindings),
        checkedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('[Transcript] fetch error:', err.message)

    if (err.response?.status === 404) {
      return Response.json(
        { error: 'No transcript found for the specified year. The return may not have been processed yet.' },
        { status: 404 }
      )
    }
    if (err.response?.status === 401) {
      return Response.json(
        { error: 'IRS authentication failed. Please try again or contact support.' },
        { status: 503 }
      )
    }
    if (err.response?.status === 429) {
      return Response.json(
        { error: 'IRS rate limit reached. Please wait a few minutes and try again.' },
        { status: 429 }
      )
    }
    if (err.code === 'ECONNABORTED') {
      return Response.json(
        { error: 'IRS system timed out. Please try again in a few minutes.' },
        { status: 504 }
      )
    }

    return Response.json(
      { error: 'Failed to retrieve transcript. Please try again or contact support@irsresolutionservice.com' },
      { status: 500 }
    )
  }
}

export const config = {
  path: '/api/transcript/fetch',
  method: 'POST',
}
