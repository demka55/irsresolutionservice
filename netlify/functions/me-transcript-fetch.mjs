import { getUser } from '@netlify/identity'
import { getStore } from '@netlify/blobs'
import axios from 'axios'
import { parseStringPromise } from 'xml2js'

const STORE = 'accounts'

// ── IRS OAuth token cache (tokens are valid for ~1 hour) ──────────────────────
let irsTokenCache = { token: null, expiresAt: 0 }

async function getIRSAccessToken(apiBaseUrl, clientId, clientSecret) {
  const now = Date.now()
  if (irsTokenCache.token && now < irsTokenCache.expiresAt - 60000) return irsTokenCache.token

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

  irsTokenCache = { token: response.data.access_token, expiresAt: now + response.data.expires_in * 1000 }
  return irsTokenCache.token
}

function maskTIN(tin) {
  if (!tin || tin.length < 4) return '***-**-****'
  return `***-**-${tin.slice(-4)}`
}
function parseDollar(val) {
  if (!val) return 0
  return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0
}
function maskEIN(ein) {
  if (!ein || ein.length < 3) return '**-*******'
  return `${ein.substring(0, 2)}-*****${ein.slice(-2)}`
}

async function parseTranscriptXML(xml) {
  const result = await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true })
  const root = result?.TranscriptDeliverySystemResponse?.Transcript
  if (!root) throw new Error('Unexpected transcript format from IRS')

  const txns = root.AccountTransactions
    ? (Array.isArray(root.AccountTransactions.Transaction)
        ? root.AccountTransactions.Transaction
        : [root.AccountTransactions.Transaction].filter(Boolean))
    : []
  const wages = root.WageIncomeItems
    ? (Array.isArray(root.WageIncomeItems.WageItem)
        ? root.WageIncomeItems.WageItem
        : [root.WageIncomeItems.WageItem].filter(Boolean))
    : []

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
    accountTransactions: txns.map((t) => ({
      date: t.TransactionDate || '',
      code: t.TransactionCode || '',
      description: t.TransactionDescription || '',
      amount: parseDollar(t.Amount),
      type: t.TransactionType || '',
    })),
    wageIncomeItems: wages.map((w) => ({
      employer: w.EmployerName || w.PayerName || '',
      ein: maskEIN(w.EmployerEIN || w.PayerEIN || ''),
      formType: w.FormType || 'W-2',
      wages: parseDollar(w.WagesAmount),
      taxWithheld: parseDollar(w.FederalTaxWithheld),
      otherIncome: parseDollar(w.OtherIncome),
    })),
  }
}

function crossVerify({ noticeCode, proposedAmount, noticeYear, noticeIncomeItems }, transcript) {
  const findings = []

  if (proposedAmount && transcript.balanceDue) {
    const diff = Math.abs(proposedAmount - transcript.balanceDue)
    if (diff > 1) {
      findings.push({
        type: 'AMOUNT_MISMATCH', severity: 'high',
        message: `Notice claims $${proposedAmount.toLocaleString()} owed, but your IRS account transcript shows $${transcript.balanceDue.toLocaleString()} balance. Difference: $${diff.toLocaleString()}.`,
        action: 'This discrepancy should be cited in your response letter. Request an account transcript breakdown.',
      })
    } else {
      findings.push({
        type: 'AMOUNT_CONFIRMED', severity: 'info',
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
          type: 'INCOME_CONFIRMED', severity: 'info',
          message: `Income item from ${item.payer || 'unknown payer'} ($${item.amount?.toLocaleString()}) is confirmed in your IRS wage transcript.`,
          action: 'This income was reported to the IRS.',
        })
      } else {
        findings.push({
          type: 'INCOME_NOT_FOUND', severity: 'high',
          message: `Income of $${item.amount?.toLocaleString()} from ${item.payer || 'unknown payer'} appears in the notice but NOT in your IRS wage transcript.`,
          action: 'Dispute this item. Request the specific 1099 or W-2 the IRS is referencing.',
        })
      }
    }
  }

  const recentPayments = transcript.accountTransactions.filter(
    (t) => t.type === 'PAYMENT' && t.date >= `${noticeYear || '2023'}-01-01`
  )
  if (recentPayments.length > 0) {
    const totalPaid = recentPayments.reduce((sum, t) => sum + t.amount, 0)
    findings.push({
      type: 'RECENT_PAYMENTS_FOUND', severity: 'medium',
      message: `Your transcript shows ${recentPayments.length} payment(s) totaling $${totalPaid.toLocaleString()} after ${noticeYear}. These may not be reflected in this notice.`,
      action: 'Include proof of these payments in your response.',
    })
  }

  return findings
}

function summarizeFindings(findings) {
  const high = findings.filter((f) => f.severity === 'high').length
  const medium = findings.filter((f) => f.severity === 'medium').length
  if (high > 0) return { level: 'warning', message: `${high} potential discrepanc${high === 1 ? 'y' : 'ies'} found between the notice and your IRS records.` }
  if (medium > 0) return { level: 'caution', message: `${medium} item${medium === 1 ? '' : 's'} may affect your response.` }
  return { level: 'clear', message: 'No major discrepancies found. The notice appears consistent with your IRS records.' }
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { taxYear, transcriptTypes, noticeCode, proposedAmount, noticeIncomeItems } = body

  if (!taxYear) return Response.json({ error: 'taxYear is required.' }, { status: 400 })
  const types = Array.isArray(transcriptTypes) ? transcriptTypes : [transcriptTypes].filter(Boolean)
  if (!types.length) return Response.json({ error: 'At least one transcriptType is required.' }, { status: 400 })

  const validTypes = ['ACCOUNT', 'WAGE', 'RECORD', 'RETURN', 'VERIFICATION']
  for (const t of types) {
    if (!validTypes.includes(t)) {
      return Response.json({ error: `transcriptType must be one of: ${validTypes.join(', ')}` }, { status: 400 })
    }
  }

  const store = getStore(STORE)

  // Load the user's IRS profile — required so we know who we're requesting for.
  const profile = await store.get(`profile/${user.id}`, { type: 'json' })
  if (!profile?.ssnLast4 || !profile?.name) {
    return Response.json(
      { error: 'Complete your IRS connection profile before pulling a transcript.' },
      { status: 400 }
    )
  }

  const irsClientId = Netlify.env.get('IRS_CLIENT_ID')
  const irsClientSecret = Netlify.env.get('IRS_CLIENT_SECRET')
  const irsApiBaseUrl = Netlify.env.get('IRS_API_BASE_URL') || 'https://api.irs.gov/v1'
  const irsEfin = Netlify.env.get('IRS_EFIN') || ''

  const irsConfigured =
    irsClientId && !irsClientId.startsWith('REPLACE_WITH') &&
    irsClientSecret && !irsClientSecret.startsWith('REPLACE_WITH')

  if (!irsConfigured) {
    return Response.json(
      { error: 'IRS transcript service is not yet configured. Your e-Services TDS application is pending approval. Contact support@irsresolutionservice.com.' },
      { status: 503 }
    )
  }

  try {
    const accessToken = await getIRSAccessToken(irsApiBaseUrl, irsClientId, irsClientSecret)

    let combinedTranscript = null
    const allFindings = []
    let summary

    for (const transcriptType of types) {
      const irsResponse = await axios.post(
        `${irsApiBaseUrl}/tds/transcript`,
        {
          transcriptType,
          taxYear: parseInt(taxYear),
          requestId: `RS-${user.id.slice(0, 8)}-${Date.now()}`,
          requestorId: irsEfin,
          taxpayer: {
            name: profile.name,
            ssnLast4: profile.ssnLast4,
            address: profile.address || undefined,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-IRS-EFIN': irsEfin,
            'X-Request-ID': `RS-${user.id}-${Date.now()}`,
          },
          timeout: 30000,
        }
      )

      const parsed = await parseTranscriptXML(irsResponse.data)
      if (!combinedTranscript) {
        combinedTranscript = parsed
      } else {
        combinedTranscript.wageIncomeItems = [
          ...(combinedTranscript.wageIncomeItems || []),
          ...(parsed.wageIncomeItems || []),
        ]
        combinedTranscript.accountTransactions = [
          ...(combinedTranscript.accountTransactions || []),
          ...(parsed.accountTransactions || []),
        ]
      }

      const findings = crossVerify(
        {
          noticeCode,
          proposedAmount: parseFloat(proposedAmount) || 0,
          noticeYear: taxYear,
          noticeIncomeItems: noticeIncomeItems || [],
        },
        parsed
      )
      allFindings.push(...findings)
      summary = summarizeFindings(allFindings)
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const record = {
      id,
      userId: user.id,
      taxYear: String(taxYear),
      transcriptTypes: types,
      noticeCode: noticeCode || null,
      proposedAmount: parseFloat(proposedAmount) || 0,
      transcript: combinedTranscript,
      verification: { findings: allFindings, summary, checkedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    }

    await store.setJSON(`transcripts/${user.id}/${id}`, record)

    return Response.json({ success: true, transcript: record })
  } catch (err) {
    console.error('[Me Transcript] fetch error:', err.message)

    if (err.response?.status === 404) {
      return Response.json({ error: 'No transcript found for the specified year. The return may not have been processed yet.' }, { status: 404 })
    }
    if (err.response?.status === 401) {
      return Response.json({ error: 'IRS authentication failed. Please try again or contact support.' }, { status: 503 })
    }
    if (err.response?.status === 429) {
      return Response.json({ error: 'IRS rate limit reached. Please wait a few minutes and try again.' }, { status: 429 })
    }
    if (err.code === 'ECONNABORTED') {
      return Response.json({ error: 'IRS system timed out. Please try again in a few minutes.' }, { status: 504 })
    }
    return Response.json({ error: 'Failed to retrieve transcript. Please try again or contact support.' }, { status: 500 })
  }
}

export const config = {
  path: '/api/me/transcript-fetch',
  method: 'POST',
}
