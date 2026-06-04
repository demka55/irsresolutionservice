// netlify/functions/seed-leads.js
// One-time function to seed past leads — delete after use

const { getStore } = require('@netlify/blobs');

const PAST_LEADS = [
  {
    id: 'lead-001-steph-speirs',
    formType: 'irs',
    name: 'Steph Speirs',
    phone: '8087785448',
    email: 'stephanie.speirs@gmail.com',
    address: '5204 13th St NW',
    referral: 'PEF Taxes',
    issue: "Haven't filed since 2020. Would have filed individually through 2024, in which I started a personal LLC and have been doing some consulting here and there. Would like to catch up asap but don't know where to start.",
    submittedAt: '2026-01-01T00:00:00.000Z',
    status: 'new',
    notes: '',
  },
  {
    id: 'lead-002-frances-simowitz',
    formType: 'general',
    name: 'Frances Simowitz',
    phone: '6312583557',
    email: 'frances@quay.co',
    address: 'frances@quay.co',
    referral: 'John Lynn',
    business: 'Yes, QUAY Acceleration, legal name Weve Acceleration Inc., is a service firm that builds and operates startup accelerator programs in partnership with governments, universities, and other institutions.',
    situation: 'We received a tax notice just recently from 2021 from the IRS. It\'s the first notice I\'ve received. The tax amount due including penalties and other charges is $44,461.37.\n\n2021 was the year I acquired the business, I had been operating it as CEO of the subsidiary, but I did not own it until 2021. We also had to file to change the legal name, ownership, and other details that year, which took almost 2-years to have updated. We also lost our co-working space around this time due to the pandemic, so I wasn\'t receiving notices. We also had huge issues that year with our accounting firm, the accountant lost her Father and went MIA for weeks. Another accountant filed the taxes there, but they were supposed to set up payment plans, which they did for state, but it\'s entirely reasonable that we didn\'t end up paying 2021 amidst everything and they may have not done the payment plan for Federal too. There\'s also a discrepancy from the notice and what\'s owed according to the tax return. The tax return says we owed $27K, where the notice says $34K. My goal is to get an abatement for the fees and penalties given the extenuating circumstances at the time, and this being the first time this has happened for the business, as well as establish a payment plan.',
    why: 'I\'m looking for support specifically for this tax issue.',
    preparer: 'Pilot',
    unusual: '',
    issue: '',
    submittedAt: '2026-01-02T00:00:00.000Z',
    status: 'new',
    notes: '',
  },
  {
    id: 'lead-003-jack-smith',
    formType: 'irs',
    name: 'Jack Smith',
    phone: '4846522549',
    email: 'jacksmith1@gmail.com',
    address: 'R1 Urb Moinhos do Mar N2, Ericeira, Lisboa, 2655-478, Portugal',
    referral: 'Dmitry posted in PEF tax group',
    issue: "Received notice CP503 for $509k including interest. For FTF and FTP.\n\nDue to tax return being filed late and underestimating amount of estimated tax to pay.\nI believe that I could qualify for first time abatement, but first need some months to clean up prior year's transcript (waiting on IRS to release previously locked up payments and having to sue the IRS over a $30k amount being wrongly disallowed in a previous year).\n\nCircumstances why return was late: very complex return, thousands of pages, combined with my next year's return it was 100+ lbs of paper (IRS requested paper). Required huge time investment with hundreds/thousands of K1s, during covid, whilst abandoning my US green card to leave the US to move to Portugal and whilst having the birth of my first child.\n\nI'm also awaiting the IRS to refund (plus interest) $220k+ for a TC 176 penalty that my CPA feels was wrongly levied in a previous tax year.\n\nCould also seemingly argue Kwong, Abdo, and related COVID disaster-period authorities to the extent those authorities affect timeliness.",
    submittedAt: '2026-01-03T00:00:00.000Z',
    status: 'new',
    notes: '',
  },
];

exports.handler = async function(event, context) {
  const headers = { 'Content-Type': 'application/json' };

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
  const url = new URL(event.rawUrl || `https://x.com${event.path}`);
  if (url.searchParams.get('password') !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const store = getStore('leads');

    // Save each lead
    for (const lead of PAST_LEADS) {
      await store.set(lead.id, JSON.stringify(lead));
    }

    // Build index
    const ids = PAST_LEADS.map(l => l.id);
    await store.set('__index__', JSON.stringify(ids));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, seeded: ids })
    };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
