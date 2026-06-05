import type { Requirement } from "./RequirementsBuilder"

export interface BizConfig {
  companyName:string;gstNumber:string|null;email:string;phone:string|null
  website:string;address:string|null;bankName:string|null;bankAccount:string|null
  bankAccountName:string|null;invoiceFooter:string
  terms1Label:string;terms1Text:string;terms2Label:string;terms2Text:string
  terms3Label:string;terms3Text:string
}

export function generateInvoicePDF(
  biz: BizConfig | null,
  req: Requirement,
  po: string,
  amtStr: string,
  isDeposit: boolean = true,
  paymentMethod: 'stripe' | 'bank_transfer' = 'bank_transfer',
  paidAt?: string | null
) {
  const companyName   = biz?.companyName   ?? 'Nav Solutions NZ'
  const gstNumber     = biz?.gstNumber     ?? null
  const bizEmail      = biz?.email         ?? 'auckland@bespoxai.com'
  const bizWebsite    = biz?.website       ?? 'bespoxai.com'
  const bizAddress    = biz?.address       ?? ''
  const bankName      = biz?.bankName      ?? ''
  const bankAccount   = biz?.bankAccount   ?? ''
  const bankAccName   = biz?.bankAccountName ?? ''
  const footer        = biz?.invoiceFooter ?? 'Thank you for choosing BespoxAI'

  // Terms text
  const termsKey      = req.tenant.paymentTermsKey ?? 'terms1'
  let   termsText     = biz?.terms1Text ?? '20% deposit on acceptance; 80% on delivery'
  if (termsKey === 'terms2') termsText = biz?.terms2Text ?? '20% deposit on acceptance; balance due 20th of following month'
  if (termsKey === 'terms3') termsText = biz?.terms3Text ?? 'Full amount due 20th of the following month'

  const monthly       = isMonthlyBilling(termsKey)
  const dueDate       = monthly ? getPaymentDueDate() : null

  const invoiceNum    = `BX-${new Date().getFullYear()}-${req.id.slice(0, 6).toUpperCase()}`
  const dateStr       = new Date().toLocaleDateString('en-NZ', { dateStyle: 'long' })
  const quote         = parseFloat(req.quote ?? '0')
  const hasReviewCredit = isDeposit && !!(req.reviewPaidAt)
  const reviewCredit  = hasReviewCredit ? 249 : 0
  // amtStr is passed in — for deposit invoices it should already reflect the credit
  // but we recalculate here to be safe
  const paymentAmt    = isDeposit
    ? Math.max(0, Math.round((quote * 0.2 - reviewCredit) * 100) / 100)
    : parseFloat(amtStr)
  const gstAmt        = Math.round(paymentAmt * 0.15 * 100) / 100
  const totalInclGST  = Math.round((paymentAmt + gstAmt) * 100) / 100
  const depositPd     = isDeposit ? paymentAmt : parseFloat(req.depositAmount ?? '0')
  const balanceExcl   = quote - (isDeposit ? quote * 0.2 : depositPd)

  const invoiceTitle  = isDeposit ? (monthly ? 'Amount Due' : '20% Deposit — Due Now') : 'Balance — Due Now'
  const dueLine       = dueDate ? `Payment due: ${dueDate}` : (isDeposit ? '' : 'Due on completion')

  // Payment instruction
  const refStr        = `<strong>${invoiceNum}</strong>${po ? ` and PO <strong>${po.replace(/</g,'&lt;')}</strong>` : ''}`
  let paymentNote = ''
  if (paymentMethod === 'stripe' && paidAt) {
    const paidDate = new Date(paidAt).toLocaleDateString('en-NZ', { dateStyle: 'long' })
    paymentNote = `This invoice was paid by card on <strong>${paidDate}</strong>. Thank you — ${isDeposit ? 'development scheduling is underway.' : 'your customisation will be delivered shortly.'}`
  } else if (paymentMethod === 'bank_transfer') {
    const bankDetails = (bankName || bankAccount) ? `<br><br>Bank: <strong>${bankName}</strong><br>Account Name: <strong>${bankAccName}</strong><br>Account Number: <strong>${bankAccount}</strong>` : ''
    if (isDeposit) {
      paymentNote = `Please pay by bank transfer, referencing ${refStr} on your payment.${bankDetails}<br><br>Email <strong>${bizEmail}</strong> to confirm receipt and we will begin development scheduling.${hasReviewCredit ? ' Your $249 specification review fee has been credited against the project total.' : ''}`
    } else {
      const duePart = dueDate ? ` by <strong>${dueDate}</strong>` : ''
      paymentNote = `Please arrange payment${duePart}, referencing ${refStr} on your transfer.${bankDetails}<br><br>Email <strong>${bizEmail}</strong> to confirm — delivery of your customisation will follow.`
    }
  }

  const w = window.open('', '_blank')!
  const __html1 = `<!DOCTYPE html>
<html>
<head>
<title>Invoice ${invoiceNum} — ${companyName}</title>
<meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Georgia,serif;color:#040E09;padding:48px;max-width:760px;margin:0 auto;font-size:14px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;padding-bottom:20px;border-bottom:2px solid #0A5C46}
  .logo{font-size:26px;font-weight:700;color:#040E09;letter-spacing:-0.5px}
  .logo-ai{color:#C8952A;font-family:monospace;font-size:17px;letter-spacing:0.04em}
  .tagline{font-size:10px;color:#3B5249;font-style:italic;margin-top:4px}
  .company-details{font-size:11px;color:#3B5249;line-height:1.8;text-align:right}
  h1{font-size:38px;font-weight:300;color:#0A5C46;margin-bottom:28px;font-family:Georgia,serif}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:32px}
  .meta-label{font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#3B5249;margin-bottom:6px;font-family:monospace}
  .meta-value{font-size:13px;color:#040E09;line-height:1.6}
  .section-label{font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#3B5249;font-family:monospace;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #D6D9D4}
  .service-block{margin-bottom:28px}
  .service-name{font-size:16px;font-weight:600;color:#040E09;margin-bottom:5px}
  .service-desc{font-size:12px;color:#3B5249;line-height:1.65;font-style:italic;margin-top:4px}
  .totals{margin-bottom:20px}
  .row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #EDE8DC;font-size:13px;align-items:center}
  .row .lbl{color:#3B5249}
  .row .amt{font-family:monospace;color:#040E09}
  .row.credit .amt{color:#0A5C46}
  .row.gst{background:rgba(10,92,70,0.03)}
  .row.total{border-bottom:none;font-weight:600}
  .amount-due{display:flex;justify-content:space-between;align-items:center;background:rgba(10,92,70,0.06);border:1px solid rgba(10,92,70,0.2);border-radius:10px;padding:14px 18px;margin:16px 0 28px}
  .amount-due .lbl{font-size:13px;font-weight:600;color:#040E09}
  .amount-due .amt{font-family:monospace;font-size:22px;font-weight:700;color:#0A5C46}
  .amount-due .due{font-size:10px;color:#7A5200;font-family:monospace;margin-top:4px}
  .note{background:#F4EFE4;border-left:3px solid #0A5C46;padding:12px 16px;font-size:12px;color:#3B5249;line-height:1.7;margin-bottom:32px;border-radius:0 8px 8px 0}
  .paid-stamp{display:inline-block;border:2px solid #0A5C46;color:#0A5C46;font-family:monospace;font-size:11px;letter-spacing:0.15em;padding:3px 10px;border-radius:4px;transform:rotate(-2deg);margin-bottom:8px}
  .footer{padding-top:20px;border-top:1px solid #D6D9D4;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#3B5249}
  @media print{body{padding:24px}@page{margin:1.5cm}}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="logo">Bespox<span class="logo-ai">AI</span></div>
    <div class="tagline">Your Business Central. One portal. Complete control.</div>
  </div>
  <div class="company-details">
    <strong>${companyName}</strong><br>
    ${bizAddress ? bizAddress.replace(/\n/g,'<br>') + '<br>' : ''}
    ${bizEmail}<br>
    ${bizWebsite}
    ${gstNumber ? '<br>GST No: ' + gstNumber : ''}
  </div>
</div>

<h1>Invoice</h1>

<div class="meta-grid">
  <div>
    <div class="meta-label">Invoice To</div>
    <div class="meta-value">
      <strong>${req.tenant.name.replace(/</g,'&lt;')}</strong><br>
      ${req.user.name ? req.user.name.replace(/</g,'&lt;') + '<br>' : ''}
      <span style="font-size:11px;color:#3B5249">${req.user.email}</span>
    </div>
  </div>
  <div>
    <div class="meta-label">Invoice Details</div>
    <div class="meta-value" style="font-size:12px;line-height:1.85">
      <strong>Invoice No:</strong>&nbsp; ${invoiceNum}<br>
      <strong>Date:</strong>&nbsp; ${dateStr}<br>
      ${po ? `<strong>PO / Reference:</strong>&nbsp; ${po.replace(/</g,'&lt;')}<br>` : ''}
      <strong>Terms:</strong>&nbsp; ${termsText}
    </div>
  </div>
</div>

<div class="service-block">
  <div class="section-label">Services</div>
  <div class="service-name">${req.title.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
  <div class="service-desc">Business Central area: ${req.bcArea}</div>
  ${req.consultantNote ? `<div class="service-desc" style="margin-top:6px">${req.consultantNote.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : ''}
</div>

<div class="totals">
  <div class="section-label">Payment Schedule</div>

  ${isDeposit ? `
  <div class="row"><span class="lbl">Total project quote (plus GST)</span><span class="amt">$${quote.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  <div class="row subdued"><span class="lbl">80% balance — due ${monthly ? 'on invoice (20th of following month)' : 'on completion'}</span><span class="amt" style="color:#3B5249">$${balanceExcl.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  <div class="row" style="border-top:2px solid #EDE8DC;margin-top:4px;padding-top:10px"><span class="lbl">20% deposit</span><span class="amt">$${(quote*0.2).toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  ${hasReviewCredit ? `<div class="row credit"><span class="lbl">Less: Specification review fee (credited)</span><span class="amt credit">− $249.00 NZD</span></div>` : ''}
  <div class="row"><span class="lbl">Net deposit (plus GST)</span><span class="amt">$${paymentAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  <div class="row gst"><span class="lbl">GST (15%)</span><span class="amt">$${gstAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  <div class="row total"><span class="lbl">Total deposit due (incl. GST)</span><span class="amt" style="font-size:15px;color:#0A5C46">$${totalInclGST.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  ` : `
  <div class="row"><span class="lbl">Total project quote (plus GST)</span><span class="amt">$${quote.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  <div class="row subdued"><span class="lbl">Less: 20% deposit already paid</span><span class="amt" style="color:#3B5249">− $${depositPd.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  <div class="row" style="border-top:2px solid #EDE8DC;margin-top:4px;padding-top:10px"><span class="lbl">Balance (plus GST)</span><span class="amt">$${paymentAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  <div class="row gst"><span class="lbl">GST (15%)</span><span class="amt">$${gstAmt.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  <div class="row total"><span class="lbl">Total balance due (incl. GST)</span><span class="amt" style="font-size:15px;color:#0A5C46">$${totalInclGST.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</span></div>
  `}
</div>

<div class="amount-due">
  <div>
    ${paymentMethod === 'stripe' ? '<div class="paid-stamp">PAID</div><br>' : ''}
    <div class="lbl">${invoiceTitle}</div>
    ${dueLine ? `<div class="due">${dueLine}</div>` : ''}
  </div>
  <div class="amt">$${totalInclGST.toLocaleString('en-NZ',{minimumFractionDigits:2})} NZD</div>
</div>

${paymentMethod === 'bank_transfer' && (bankName || bankAccount) ? `
<div class="bank-block">
  <div class="section-label" style="margin-bottom:10px">Bank Transfer Details</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
    <div><div class="bank-lbl">Bank</div><div class="bank-val">${bankName || '—'}</div></div>
    <div><div class="bank-lbl">Account Name</div><div class="bank-val">${bankAccName || '—'}</div></div>
    <div><div class="bank-lbl">Account Number</div><div class="bank-val">${bankAccount || '—'}</div></div>
  </div>
</div>` : paymentMethod === 'bank_transfer' ? `
<div class="bank-block">
  <p style="font-size:12px;color:#3B5249">Please contact <strong>${bizEmail}</strong> for bank transfer details.</p>
</div>` : ''}

<div class="note">${paymentNote}</div>

<div class="footer">
  <span style="font-style:italic">${footer}</span>
  <span style="font-family:monospace">${gstNumber ? `GST No: ${gstNumber} · ` : ''}${bizWebsite}</span>
</div>
</body>
</html>`)
  w.document.write(__html2)
  w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 450)
}


export function generateReviewInvoicePDF(
  biz: BizConfig | null, req: Requirement, po: string = '') {
  const companyName    = biz?.companyName    ?? 'Nav Solutions NZ'
  const gstNumber      = biz?.gstNumber      ?? null
  const bizEmail       = biz?.email          ?? 'auckland@bespoxai.com'
  const bizWebsite     = biz?.website        ?? 'bespoxai.com'
  const bizAddress     = biz?.address        ?? ''
  const footer         = biz?.invoiceFooter  ?? 'Thank you for choosing BespoxAI'

  const invoiceNum     = `BX-REV-${new Date().getFullYear()}-${req.id.slice(0, 6).toUpperCase()}`
  const dateStr        = new Date(req.reviewPaidAt!).toLocaleDateString('en-NZ', { dateStyle: 'long' })
  const feeExcl        = 249
  const gstAmt         = Math.round(feeExcl * 0.15 * 100) / 100
  const totalInclGST   = feeExcl + gstAmt

  const w = window.open('', '_blank')!
  const __html2 = `<!DOCTYPE html>
<html>
<head>
<title>Invoice ${invoiceNum} — ${companyName}</title>
<meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Georgia,serif;color:#040E09;padding:48px;max-width:760px;margin:0 auto;font-size:14px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;padding-bottom:20px;border-bottom:2px solid #0A5C46}
  .logo{font-size:26px;font-weight:700;color:#040E09;letter-spacing:-0.5px}
  .logo-ai{color:#C8952A;font-family:monospace;font-size:17px;letter-spacing:0.04em}
  .tagline{font-size:10px;color:#3B5249;font-style:italic;margin-top:4px}
  .company-details{font-size:11px;color:#3B5249;line-height:1.8;text-align:right}
  h1{font-size:38px;font-weight:300;color:#0A5C46;margin-bottom:28px}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:32px}
  .meta-label{font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#3B5249;margin-bottom:6px;font-family:monospace}
  .meta-value{font-size:13px;color:#040E09;line-height:1.6}
  .section-label{font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:#3B5249;font-family:monospace;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #D6D9D4}
  .service-block{margin-bottom:28px}
  .service-name{font-size:16px;font-weight:600;color:#040E09;margin-bottom:5px}
  .service-desc{font-size:12px;color:#3B5249;line-height:1.65;font-style:italic;margin-top:4px}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #EDE8DC;font-size:13px;align-items:baseline}
  .row .lbl{color:#3B5249;flex:1;padding-right:16px}
  .row .amt{font-family:monospace;color:#040E09;white-space:nowrap}
  .row.subdued .lbl{color:#8A9E96;font-size:12px}
  .row.subdued .amt{color:#8A9E96;font-size:12px}
  .row.credit .lbl{color:#0A5C46}
  .row.credit .amt{color:#0A5C46 !important}
  .row.gst{background:rgba(10,92,70,0.03)}
  .row.total{border-bottom:none;font-weight:600;padding-top:10px}
  .bank-block{background:#F4EFE4;border-radius:8px;padding:14px 16px;margin:16px 0}
  .bank-lbl{font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#3B5249;font-family:monospace;margin-bottom:3px}
  .bank-val{font-size:13px;font-weight:600;color:#040E09}
  .amount-due{display:flex;justify-content:space-between;align-items:center;background:rgba(10,92,70,0.06);border:1px solid rgba(10,92,70,0.2);border-radius:10px;padding:14px 18px;margin:16px 0 28px}
  .amount-due .lbl{font-size:13px;font-weight:600;color:#040E09}
  .amount-due .amt{font-family:monospace;font-size:22px;font-weight:700;color:#0A5C46}
  .paid-stamp{display:inline-block;border:2px solid #0A5C46;color:#0A5C46;font-family:monospace;font-size:11px;letter-spacing:0.15em;padding:3px 10px;border-radius:4px;transform:rotate(-2deg);margin-bottom:8px}
  .note{background:#F4EFE4;border-left:3px solid #0A5C46;padding:12px 16px;font-size:12px;color:#3B5249;line-height:1.7;margin-bottom:32px;border-radius:0 8px 8px 0}
  .credit-note{background:rgba(10,92,70,0.04);border:1px solid rgba(10,92,70,0.15);border-radius:8px;padding:10px 14px;font-size:12px;color:#0A5C46;line-height:1.6;margin-bottom:28px}
  .footer{padding-top:20px;border-top:1px solid #D6D9D4;display:flex;justify-content:space-between;font-size:11px;color:#3B5249}
  @media print{body{padding:24px}@page{margin:1.5cm}}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="logo">Bespox<span class="logo-ai">AI</span></div>
    <div class="tagline">Your Business Central. One portal. Complete control.</div>
  </div>
  <div class="company-details">
    <strong>${companyName}</strong><br>
    ${bizAddress ? bizAddress.replace(/\n/g,'<br>') + '<br>' : ''}
    ${bizEmail}<br>${bizWebsite}
    ${gstNumber ? '<br>GST No: ' + gstNumber : ''}
  </div>
</div>

<h1>Invoice</h1>

<div class="meta-grid">
  <div>
    <div class="meta-label">Invoice To</div>
    <div class="meta-value">
      <strong>${req.tenant.name.replace(/</g,'&lt;')}</strong><br>
      ${req.user.name ? req.user.name.replace(/</g,'&lt;') + '<br>' : ''}
      <span style="font-size:11px;color:#3B5249">${req.user.email}</span>
    </div>
  </div>
  <div>
    <div class="meta-label">Invoice Details</div>
    <div class="meta-value" style="font-size:12px;line-height:1.85">
      <strong>Invoice No:</strong>&nbsp; ${invoiceNum}<br>
      <strong>Date:</strong>&nbsp; ${dateStr}<br>
      ${po ? `<strong>PO / Reference:</strong>&nbsp; ${po.replace(/</g,'&lt;')}<br>` : ''}
      <strong>Type:</strong>&nbsp; Specification Review Fee
    </div>
  </div>
</div>

<div class="service-block">
  <div class="section-label">Services</div>
  <div class="service-name">Senior BC Developer Specification Review</div>
  <div class="service-desc">${req.title.replace(/</g,'&lt;')}</div>
  <div class="service-desc" style="margin-top:6px">Business Central area: ${req.bcArea}</div>
</div>

<div style="margin-bottom:20px">
  <div class="section-label">Payment</div>
  <div class="row"><span class="lbl">Specification review fee (plus GST)</span><span class="amt">$${feeExcl.toFixed(2)} NZD</span></div>
  <div class="row gst"><span class="lbl">GST (15%)</span><span class="amt">$${gstAmt.toFixed(2)} NZD</span></div>
  <div class="row total"><span class="lbl">Total incl. GST</span><span class="amt" style="font-size:15px;color:#0A5C46">$${totalInclGST.toFixed(2)} NZD</span></div>
</div>

<div class="amount-due">
  <div>
    <div class="paid-stamp">PAID</div><br>
    <div class="lbl">Specification Review Fee</div>
  </div>
  <div class="amt">$${totalInclGST.toFixed(2)} NZD</div>
</div>

<div class="credit-note">
  ✦ This $${feeExcl.toFixed(2)} NZD (plus GST) review fee will be credited in full against your development deposit if you proceed with this customisation.
</div>

<div class="note">
  Paid by card on ${dateStr}. Thank you — your specification is now in review with our senior BC development team.
  We will be in touch with a quote and development plan.
</div>

<div class="footer">
  <span style="font-style:italic">${footer}</span>
  <span style="font-family:monospace">${bizWebsite}</span>
</div>
</body>
</html>`)
  w.document.write(__html1)
  w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 450)
}
