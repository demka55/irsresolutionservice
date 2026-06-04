// netlify/functions/seed-leads.mjs
// One-time function to seed past leads — DELETE AFTER USE

import { getStore } from '@netlify/blobs';

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
    status: 'new', notes: '',
  },
  {
    id: 'lead-002-frances-simowitz',
    formType: 'general',
    name: 'Frances Simowitz',
    phone: '6312583557',
    email: 'frances@quay.co',
    address: 'frances@quay.co',
    referral: 'John Lynn',
    business: 'QUAY Acceleration, legal name Weve Acceleration Inc., is a service firm that builds and operates startup accelerator programs in partnership with governments, universities, and other institutions.',
    situation: "We received a tax notice from 2021 from the IRS. Tax amount due including penalties: $44,461.37.\n\n2021 was the year I acquired the business. We lost our co-working space during the pandemic so I wasn't receiving notices. Our accounting firm had issues — the accountant went MIA for weeks after a family loss. There's a discrepancy: tax return says we owed $27K, notice says $34K. My goal is to get an abatement for fees and penalties given the extenuating circumstances, and establish a payment plan.",
    why: "Looking for support specifically for this tax issue.",
    preparer: 'Pilot',
    unusual: '', issue: '',
    submittedAt: '2026-01-02T00:00:00.000Z',
    status: 'new', notes: '',
  },
  {
    id: 'lead-003-jack-smith',
    formType: 'irs',
    name: 'Jack Smith',
    phone: '4846522549',
    email: 'jacksmith1@gmail.com',
    address: 'R1 Urb Moinhos do Mar N2, Ericeira, Lisboa, 2655-478, Portugal',
    referral: 'Dmitry posted in PEF tax group',
    issue: "Received notice CP503 for $509k including interest (FTF and FTP).\n\nTax return filed late due to very complex return — thousands of pages, 100+ lbs of paper combined with next year's return. Hundreds/thousands of K1s, during COVID, whilst abandoning US green card to move to Portugal and having first child.\n\nBelieve I qualify for first time abatement but need months to clean up prior year transcript (waiting on IRS to release locked payments, suing IRS over $30k wrongly disallowed).\n\nAlso awaiting IRS to refund $220k+ for a TC 176 penalty wrongly levied in a previous tax year. Could argue Kwong, Abdo, and related COVID disaster-period authorities.",
    submittedAt: '2026-01-03T00:00:00.000Z',
    status: 'new', notes: '',
  },
];

export default async (req) => {
  const headers = { 'Content-Type': 'application/json' };
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || '';
  const url = new URL(req.url);

  if (url.searchParams.get('password') !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  try {
    const store = getStore('leads');
    for (const lead of PAST_LEADS) {
      await store.set(lead.id, JSON.stringify(lead));
    }
    const ids = PAST_LEADS.map(l => l.id);
    await store.set('__index__', JSON.stringify(ids));
    return new Response(JSON.stringify({ ok: true, seeded: ids }), { status: 200, headers });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};
