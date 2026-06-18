// netlify/functions/submit-2848.mjs
import { getStore } from '@netlify/blobs';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Builds a real, properly formatted PDF of the signed Form 2848 — not just a text summary.
// Uses pdf-lib (pure JS, no headless browser needed) so this runs fine inside a serverless function.
async function buildForm2848Pdf(formData, signaturePngBase64) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([612, 792]); // US Letter
  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  function text(str, opts = {}) {
    page.drawText(str, {
      x: opts.x ?? margin,
      y,
      size: opts.size ?? 11,
      font: opts.bold ? bold : font,
      color: rgb(0, 0, 0),
    });
    y -= opts.gap ?? (opts.size ? opts.size + 6 : 17);
  }

  function hr() {
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= 14;
  }

  function wrapped(str, size, maxWidth) {
    const words = str.split(' ');
    let lineStr = '';
    for (const w of words) {
      const test = lineStr ? lineStr + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth) {
        text(lineStr, { size, gap: size + 4 });
        lineStr = w;
      } else {
        lineStr = test;
      }
    }
    if (lineStr) text(lineStr, { size, gap: size + 4 });
  }

  text('IRS FORM 2848', { size: 20, bold: true, gap: 24 });
  text('Power of Attorney and Declaration of Representative', { size: 12, gap: 20 });
  hr();

  text('TAXPAYER INFORMATION', { size: 11, bold: true, gap: 16 });
  text(`Name: ${formData.taxpayerName}`);
  text(`SSN (last 4): ***-**-${formData.ssnLast4}`);
  text(`Date of Birth: ${formData.dob || '—'}`);
  wrapped(`Address: ${formData.address}`, 11, width - margin * 2);
  text(`Phone: ${formData.phone || '—'}`);
  text(`Filing Status: ${formData.filingStatus || '—'}`);
  y -= 6;
  hr();

  text('REPRESENTATIVE', { size: 11, bold: true, gap: 16 });
  text('Romeo Razi, CPA — Taxed Right LLC');
  y -= 6;
  hr();

  text('AUTHORIZATION', { size: 11, bold: true, gap: 16 });
  text(`Tax Years Authorized: ${formData.taxYears}`);
  y -= 6;
  hr();

  text('CONSENT', { size: 11, bold: true, gap: 16 });
  wrapped(
    'By signing below, the taxpayer authorizes Romeo Razi, CPA (Taxed Right LLC) to receive IRS tax transcripts for the years specified. This authorization is valid for 3 years from the date signed. This is read-only access and does not authorize representation before the IRS or filing documents on the taxpayer\u2019s behalf.',
    9, width - margin * 2
  );
  y -= 20;

  text('SIGNATURE', { size: 11, bold: true, gap: 16 });
  if (signaturePngBase64) {
    try {
      const sigBytes = Buffer.from(signaturePngBase64, 'base64');
      const sigImage = await pdfDoc.embedPng(sigBytes);
      const sigDims = sigImage.scale(Math.min(0.4, 220 / sigImage.width));
      page.drawImage(sigImage, { x: margin, y: y - sigDims.height, width: sigDims.width, height: sigDims.height });
      y -= sigDims.height + 10;
    } catch (sigErr) {
      console.warn('[submit-2848] signature embed failed, continuing without it:', sigErr.message);
    }
  }
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 250, y }, thickness: 1, color: rgb(0, 0, 0) });
  y -= 14;
  text(`${formData.taxpayerName} — Signed ${new Date().toLocaleString()}`, { size: 9 });

  return await pdfDoc.save();
}

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const resendKey = Netlify.env.get('RESEND_API_KEY');

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const { email, name, formData, signatureDataUrl } = body;
  if (!email || !name || !formData) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
  }

  const key = email.toLowerCase();

  // Update client status to 2848_signed in Blobs
  try {
    const store = getStore('client-status');
    let existing = {};
    try {
      const raw = await store.get(key);
      if (raw) existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}

    const updated = {
      ...existing,
      email: key,
      name: existing.name || name,
      status: '2848_signed',
      updatedAt: new Date().toISOString(),
      paidAt: existing.paidAt || new Date().toISOString(),
      steps: {
        ...(existing.steps || {}),
        form2848Signed: new Date().toISOString(),
        form2848Data: formData,
      }
    };

    await store.set(key, JSON.stringify(updated));
    console.log('[submit-2848] saved:', key);

    // Update index
    try {
      const rawIdx = await store.get('__index__');
      let index = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : [];
      if (!index.includes(key)) {
        index.push(key);
        await store.set('__index__', JSON.stringify(index));
      }
    } catch(idxErr) {
      console.warn('[submit-2848] index update failed:', idxErr.message);
    }

  } catch(err) {
    console.error('[submit-2848] Blob update failed:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to save: ' + err.message }), { status: 500, headers });
  }

  // Generate a real PDF of the signed Form 2848 (with embedded signature) and save it
  // into the client's document folder. Mirrors the storage pattern in client-files.mjs
  // exactly: full record under "{email}:{fileId}" and a lightweight metadata entry
  // appended to "__meta__:{email}" so it shows up instantly in admin's file list.
  try {
    const filesStore = getStore('client-files');

    async function appendFileMeta(key, metaRecord) {
      let metaIndex = [];
      try {
        const rawMeta = await filesStore.get(`__meta__:${key}`);
        if (rawMeta) metaIndex = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
      } catch {}
      metaIndex.push(metaRecord);
      await filesStore.set(`__meta__:${key}`, JSON.stringify(metaIndex));
    }

    const signaturePngBase64 = (signatureDataUrl && signatureDataUrl.startsWith('data:image'))
      ? signatureDataUrl.split(',')[1]
      : null;

    const pdfBytes = await buildForm2848Pdf(formData, signaturePngBase64);
    const base64Pdf = Buffer.from(pdfBytes).toString('base64');

    const fileId = `f${Date.now()}-2848`;
    const fileRecord = {
      fileId,
      filename: `Form-2848-${formData.taxpayerName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`,
      contentType: 'application/pdf',
      size: Math.ceil(base64Pdf.length * 0.75),
      base64Data: base64Pdf,
      uploadedAt: new Date().toISOString(),
      uploadedBy: 'System (client signature)',
      source: 'auto',
    };

    await filesStore.set(`${key}:${fileId}`, JSON.stringify(fileRecord));
    await appendFileMeta(key, {
      fileId: fileRecord.fileId, filename: fileRecord.filename, contentType: fileRecord.contentType,
      size: fileRecord.size, uploadedAt: fileRecord.uploadedAt, uploadedBy: fileRecord.uploadedBy, source: fileRecord.source,
    });

    console.log('[submit-2848] saved signed Form 2848 PDF for', key);
  } catch(fileErr) {
    console.warn('[submit-2848] PDF save failed (non-fatal):', fileErr.message);
  }

  // Send emails
  if (resendKey) {
    const formHtml = `
      <h2>Form 2848 Signed — ${name}</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:sans-serif;font-size:14px">
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600;width:200px">Client Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.taxpayerName}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">SSN (last 4)</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">***-**-${formData.ssnLast4}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Address</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.address}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Tax Years</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.taxYears}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${email}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Signed at</td><td style="padding:8px 12px">${new Date().toLocaleString()}</td></tr>
      </table>
      <p style="margin-top:16px;font-size:13px;color:#7a6e60">
        Next: Submit to IRS, then mark "2848 Submitted to IRS" in <a href="https://irsresolutionservice.com/admin">admin</a>. The signed form has been saved to this client's document folder automatically.
      </p>`;

    try {
      for (const to of ['romeo@taxedright.com', 'dmitry.dragilev@hey.com']) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'IRS Resolution Service <noreply@irsresolutionservice.com>', to, subject: `Form 2848 signed — ${name}`, html: formHtml }),
        });
      }
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
          to: email,
          subject: 'Form 2848 received — next steps',
          html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto"><h2 style="font-family:Georgia,serif">Hi ${name},</h2><p style="font-size:15px;line-height:1.75;color:#4a3f32">We've received your signed Form 2848. Romeo's team will submit it to the IRS within 1 business day.</p><p style="font-size:15px;line-height:1.75;color:#4a3f32">Once the IRS processes it (2–5 business days), Romeo will begin pulling your transcripts and you'll see your status update in your dashboard.</p><p style="margin:24px 0;text-align:center"><a href="https://irsresolutionservice.com/resolve" style="background:#c9a84c;color:#1a1410;padding:13px 28px;border-radius:2px;text-decoration:none;font-weight:700;font-size:15px">View your dashboard →</a></p><p style="font-size:13px;color:#7a6e60">IRS Resolution Service LLC</p></div>`,
        }),
      });
    } catch(err) {
      console.error('[submit-2848] Email failed:', err.message);
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
