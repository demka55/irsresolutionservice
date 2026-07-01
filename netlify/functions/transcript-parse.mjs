// netlify/functions/transcript-parse.mjs
// Parses an IRS Account Transcript HTML (from curTx in admin) and stores
// structured vitals into the client's Netlify blob record.
//
// POST /api/transcript-parse
// Body: { adminPassword, clientEmail, transcriptHtml, txKey }
// Returns: { ok, vitals }

import { getStore } from '@netlify/blobs'

const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || ''

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://irsresolutionservice.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers })

  let body
  try { body = await req.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }) }

  const { adminPassword, clientEmail, transcriptHtml, txKey } = body

  if (adminPassword !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
  }
  if (!clientEmail || !transcriptHtml) {
    return new Response(JSON.stringify({ error: 'clientEmail and transcriptHtml are required' }), { status: 400, headers })
  }

  try {
    const vitals = parseTranscriptHTML(transcriptHtml)

    // Store parsed vitals into client blob
    const store = getStore('clients')
    const key = clientEmail.toLowerCase().trim()
    let existing = {}
    try {
      const raw = await store.get(key)
      if (raw) existing = JSON.parse(raw)
    } catch (e) { /* new client — start fresh */ }

    const vitalKey = `vitals_${txKey || vitals.taxYear || 'latest'}`
    existing.steps = existing.steps || {}
    existing.steps[vitalKey] = JSON.stringify(vitals)
    existing.steps[`vitalsParsed_${txKey || vitals.taxYear}`] = new Date().toISOString()
    existing.latestVitals = vitals

    await store.set(key, JSON.stringify(existing))

    return new Response(JSON.stringify({ ok: true, vitals }), { status: 200, headers })

  } catch (err) {
    console.error('[transcript-parse]', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
}

export const config = { path: '/api/transcript-parse', method: 'POST' }

// ─────────────────────────────────────────────────────────────────────────────
// Core parser — reads IRS Account Transcript HTML
// Tested against actual IRS e-Services HTML (ACTR format, item-label/item-value
// pattern, #transaction-codes table, AMOUNTS + POSTEDRETURNINFORMATION sections)
// ─────────────────────────────────────────────────────────────────────────────
function parseTranscriptHTML(html) {
  const vitals = {
    parsedAt: new Date().toISOString(),
    taxYear: null,
    taxPeriodEnd: null,
    tin: null,
    taxpayerName: null,
    filingStatus: null,
    returnFiled: false,
    returnType: null,       // 'original' | 'amended' | 'sfr' | null
    processingDate: null,
    returnDueDate: null,
    accountBalance: 0,
    accruedInterest: 0,
    accruedPenalty: 0,
    balancePlusAccruals: 0,
    adjustedGrossIncome: 0,
    taxableIncome: 0,
    taxPerReturn: 0,
    totalPayments: 0,
    refundAmount: 0,
    assessmentDate: null,
    csedDate: null,
    csedMonthsLeft: null,
    csedPct: null,
    hasBalance: false,
    isSFR: false,
    hasAmendedReturn: false,
    underExamination: false,
    hasLevyNotice: false,
    hasPassportFlag: false,
    transactionCodes: [],
    notices: [],
    alerts: [],
  }

  // ── Tax period ──────────────────────────────────────────────────────────────
  const periodMatch = html.match(/Report for Tax Period Ending[^<]*<[^>]*>\s*([^<]+)/i)
  if (periodMatch) {
    vitals.taxPeriodEnd = periodMatch[1].trim()
    vitals.taxYear = vitals.taxPeriodEnd.slice(-4)
  }

  // ── TIN ─────────────────────────────────────────────────────────────────────
  const tinMatch = html.match(/Taxpayer Identification Number[^<]*<[^>]*>\s*([^<]+)/i)
  if (tinMatch) vitals.tin = tinMatch[1].trim()

  // ── Name (first dt in NAMEADDRESSSECTION) ───────────────────────────────────
  const nameSection = html.match(/NAMEADDRESSSECTION[\s\S]{0,400}?item-label">\s*([A-Z][A-Z\s]+?)\s*<\/dt>/i)
  if (nameSection) vitals.taxpayerName = nameSection[1].trim()

  // ── Filing status ───────────────────────────────────────────────────────────
  const fsMatch = html.match(/Filing status[^<]*<[^>]*>\s*([^<]+)/i)
  if (fsMatch) vitals.filingStatus = fsMatch[1].trim()

  // ── Dollar fields ───────────────────────────────────────────────────────────
  vitals.accountBalance        = extractDollar(html, 'Account balance:')
  vitals.accruedInterest       = extractDollar(html, 'Accrued interest:')
  vitals.accruedPenalty        = extractDollar(html, 'Accrued penalty:')
  vitals.balancePlusAccruals   = extractDollar(html, 'Account balance plus accruals')
  vitals.adjustedGrossIncome   = extractDollar(html, 'Adjusted gross income:')
  vitals.taxableIncome         = extractDollar(html, 'Taxable income:')
  vitals.taxPerReturn          = extractDollar(html, 'Tax per return:')
  vitals.hasBalance            = vitals.accountBalance > 0

  // ── Return dates ────────────────────────────────────────────────────────────
  const dueDateMatch = html.match(/Return due date or return received date[^<]*<[^>]*>\s*([^<]+)/i)
  if (dueDateMatch) vitals.returnDueDate = dueDateMatch[1].trim()

  const procDateMatch = html.match(/Processing date[^<]*<[^>]*>\s*([^<]+)/i)
  if (procDateMatch) vitals.processingDate = procDateMatch[1].trim()

  // ── Transaction codes table ─────────────────────────────────────────────────
  // Parse every <tr> in #transaction-codes
  const txRows = html.match(/<tr>[\s\S]*?<\/tr>/gi) || []
  let totalPayments = 0

  for (const row of txRows) {
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(c => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())

    if (cells.length < 4) continue
    const code = cells[0].trim()
    if (!/^\d{3}$/.test(code)) continue   // skip header/non-data rows

    const desc   = cells[1].trim()
    const date   = cells[3]?.trim() || ''
    const amount = parseDollar(cells[4]?.trim() || '')

    vitals.transactionCodes.push({ code, desc, date, amount })

    switch (code) {
      case '150':  // Tax return filed — this sets the assessment date
        vitals.returnFiled    = true
        vitals.returnType     = vitals.hasAmendedReturn ? 'amended' : 'original'
        vitals.assessmentDate = date
        break
      case '976':  // Substitute for return — IRS-prepared, no taxpayer filing
        vitals.isSFR          = true
        vitals.returnType     = 'sfr'
        vitals.assessmentDate = date
        break
      case '977':  // Amended return filed (or second SFR indicator)
        if (vitals.returnFiled) {
          vitals.hasAmendedReturn = true
          if (vitals.returnType === 'original') vitals.returnType = 'amended'
        } else {
          vitals.isSFR          = true
          vitals.returnType     = 'sfr'
          vitals.assessmentDate = date
        }
        break
      case '971': {
        if (desc.toLowerCase().includes('amended')) vitals.hasAmendedReturn = true
        // 971 encodes specific notices in description
        const nm = desc.match(/notice (CP\d+|LT\d+)/i)
        if (nm) {
          const nc = nm[1].toUpperCase()
          if (!vitals.notices.includes(nc)) vitals.notices.push(nc)
        }
        break
      }
      case '420':  // Examination of tax return
        vitals.underExamination = true
        break
      case '670':  // Payment
      case '660':  // Estimated tax payment
      case '610':  // Payment with return
      case '800':  // Overpayment credit applied
      case '806':  // W-2 or 1099 withholding
        if (amount < 0) totalPayments += Math.abs(amount)  // credits are negative
        break
      case '846':  // Refund issued
        vitals.refundAmount = Math.abs(amount)
        break
    }

    // Detect notice codes anywhere in description text
    const noticeInDesc = desc.match(/\b(CP\d{2,4}|LT\d{2,3})\b/i)
    if (noticeInDesc) {
      const nc = noticeInDesc[1].toUpperCase()
      if (!vitals.notices.includes(nc)) vitals.notices.push(nc)
      if (['LT11','LT16','CP504','CP523'].includes(nc)) vitals.hasLevyNotice = true
    }
  }

  vitals.totalPayments = totalPayments

  // ── CSED calculation ────────────────────────────────────────────────────────
  // Assessment date is in MM-DD-YYYY format from the IRS transcript
  if (vitals.assessmentDate) {
    try {
      const parts = vitals.assessmentDate.split('-')
      // Handle both MM-DD-YYYY and YYYY-MM-DD
      const [m, d, y] = parts.length === 3 && parts[2].length === 4
        ? [parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2])]
        : [parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[0])]

      const csed = new Date(y, m - 1, d)
      csed.setFullYear(csed.getFullYear() + 10)

      const now = new Date()
      const msLeft  = csed - now
      const msFull  = 10 * 365.25 * 24 * 60 * 60 * 1000

      vitals.csedDate       = `${String(csed.getMonth()+1).padStart(2,'0')}-${String(csed.getDate()).padStart(2,'0')}-${csed.getFullYear()}`
      vitals.csedMonthsLeft = Math.max(0, Math.round(msLeft / (1000 * 60 * 60 * 24 * 30.4)))
      vitals.csedPct        = Math.min(100, Math.max(0, Math.round((1 - msLeft / msFull) * 100)))
    } catch (e) { /* bad date — leave null */ }
  }

  // ── Derived flags ───────────────────────────────────────────────────────────
  vitals.hasPassportFlag = vitals.accountBalance > 50000

  // ── Auto-generated alerts (ordered by severity) ─────────────────────────────
  if (!vitals.returnFiled && !vitals.isSFR)
    vitals.alerts.push({ level: 'danger', msg: `No return on file for ${vitals.taxYear || 'this year'}` })

  if (vitals.isSFR)
    vitals.alerts.push({ level: 'danger', msg: 'Substitute for return on file — filing actual return may reduce balance significantly' })

  if (vitals.hasLevyNotice) {
    const levyNotices = vitals.notices.filter(n => ['LT11','LT16','CP504','CP523'].includes(n))
    vitals.alerts.push({ level: 'danger', msg: `Levy notice detected (${levyNotices.join(', ')}) — CDP hearing window may be open` })
  }

  if (vitals.underExamination)
    vitals.alerts.push({ level: 'warn', msg: 'TC 420 — return is under IRS examination' })

  if (vitals.hasPassportFlag)
    vitals.alerts.push({ level: 'warn', msg: 'Balance exceeds $50K — IRS can notify State Dept to revoke passport' })

  if (vitals.csedMonthsLeft !== null && vitals.csedMonthsLeft < 18)
    vitals.alerts.push({ level: 'warn', msg: `CSED expiring in ${vitals.csedMonthsLeft} months — do NOT file OIC or payment plan without reviewing strategy` })

  if (vitals.hasAmendedReturn)
    vitals.alerts.push({ level: 'info', msg: 'Amended return on file (TC 977)' })

  if (vitals.hasBalance && !vitals.hasLevyNotice)
    vitals.alerts.push({ level: 'info', msg: `Open balance $${vitals.accountBalance.toLocaleString()} — installment agreement, OIC, or CNC may apply` })

  return vitals
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function extractDollar(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Find the label then the next item-value dd
  const re = new RegExp(escaped + '[\\s\\S]{0,250}?item-value[^>]*>\\s*([^<]+)', 'i')
  const m = html.match(re)
  if (!m) return 0
  return parseDollar(m[1])
}

function parseDollar(str) {
  if (!str) return 0
  // Strip currency symbols, commas, spaces; preserve minus sign
  const clean = String(str).replace(/[^0-9.\-]/g, '')
  return parseFloat(clean) || 0
}
