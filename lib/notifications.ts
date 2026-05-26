/**
 * lib/notifications.ts
 *
 * All requirement-lifecycle email notifications for BespoxAI.
 * Every function is fire-and-forget (errors logged, never thrown).
 *
 * Superadmin notifications (inbound activity — admin needs to act):
 *   notifyAdminsNewRequirement    — customer submits a new requirement
 *   notifyAdminsNewAddendum       — customer submits an addendum
 *   notifyAdminsAnswered          — customer answers clarification questions
 *   notifyAdminsQuoteRejected     — customer rejects a quote
 *   notifyAdminsDepositPaid       — customer pays deposit (from Stripe webhook)
 *
 * Customer notifications (outbound activity — customer needs to act/is informed):
 *   notifyCustomerNeedsClarif     — admin sends back for clarification
 *   notifyCustomerQuoted          — admin sends a quote
 *   notifyCustomerInDevelopment   — admin starts development
 *   notifyCustomerBalanceDue      — admin marks complete, balance requested
 */

import { prisma }     from '@/lib/db'
import { sendEmail }  from '@/lib/email'

const PORTAL = process.env.NEXTAUTH_URL ?? 'https://bespoxai.com'

// ── Shared template wrapper ───────────────────────────────────────────────────

function wrap(body: string): string {
  return `
    <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a2a1e">
      <div style="background:#040E09;padding:22px 28px;border-radius:12px 12px 0 0">
        <span style="font-size:20px;font-weight:700;color:#F4EFE4">Bespox<span style="color:#C8952A">AI</span></span>
      </div>
      <div style="background:#f7f5f0;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e8e4dc;border-top:none;line-height:1.7;font-size:14px;color:#2a3a2e">
        ${body}
        <p style="margin-top:28px;font-size:11px;color:#aaa;border-top:1px solid #e0dbd4;padding-top:14px">
          BespoxAI — automated notification. Reply to this email if you have questions.
        </p>
      </div>
    </div>
  `
}

function reqBlock(title: string, tenantName: string, isAddendum = false): string {
  return `
    <div style="background:#fff;border-left:3px solid #0A5C46;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0">
      ${isAddendum ? '<span style="font-size:11px;font-weight:600;color:#C8952A;text-transform:uppercase;letter-spacing:0.06em">Addendum</span><br>' : ''}
      <strong style="font-size:15px">${title}</strong><br>
      <span style="font-size:12px;color:#888">${tenantName}</span>
    </div>
  `
}

function cta(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;margin:16px 0;background:#0A5C46;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${label} →</a>`
}

// ── Helper: get all superadmin emails ─────────────────────────────────────────

async function getSuperadmins(): Promise<{ email: string; name: string | null }[]> {
  return (prisma as any).user.findMany({
    where:  { role: 'superadmin' },
    select: { email: true, name: true },
  })
}

// ── Helper: resolve display name (preferredName ?? firstName ?? name) ─────────

function displayName(user: { preferredName?: string | null; firstName?: string | null; name?: string | null } | null): string | null {
  if (!user) return null
  return user.preferredName?.trim() || user.firstName?.trim() || null
}

// ── Helper: get customer email for a requirement ──────────────────────────────

async function getCustomerEmail(requirementId: string): Promise<{ email: string; name: string | null; tenantName: string; title: string } | null> {
  const req = await (prisma as any).requirement.findUnique({
    where:   { id: requirementId },
    include: {
      user:   { select: { email: true, name: true, firstName: true, preferredName: true } },
      tenant: { select: { name: true } },
    },
  })
  if (!req) return null
  return {
    email:      req.user?.email,
    name:       displayName(req.user),
    tenantName: req.tenant?.name ?? '',
    title:      req.title,
  }
}

// ── Account / onboarding notifications ───────────────────────────────────────

export async function notifyUserWelcome(params: {
  to:           string
  name:         string | null
  tempPassword: string
  tenantName:   string
  role:         'tenant_admin' | 'user' | 'developer'
}) {
  const { to, name, tempPassword, tenantName, role } = params
  const greeting = name ? 'Hi ' + name + ',' : 'Hi,'
  const roleLabel = role === 'tenant_admin' ? 'Administrator' : role === 'developer' ? 'Developer' : 'User'
  try {
    await sendEmail({
      to,
      subject: 'Your BespoxAI account is ready',
      html: wrap(`
        <p>${greeting}</p>
        <p>Your BespoxAI account for <strong>${tenantName}</strong> has been set up.
        You've been added as a <strong>${roleLabel}</strong>.</p>

        <div style="background:#f5f5f0;border-radius:8px;padding:18px 20px;margin:20px 0">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7b70">Your temporary credentials</p>
          <p style="margin:0 0 4px"><strong>Email:</strong> ${to}</p>
          <p style="margin:0"><strong>Temporary password:</strong> <code style="background:#e8e8e0;padding:2px 6px;border-radius:4px;font-size:15px">${tempPassword}</code></p>
        </div>

        <p style="background:#fff8e8;border-left:3px solid #C8952A;padding:10px 14px;border-radius:0 6px 6px 0;margin:20px 0;font-size:13px">
          <strong>You will be asked to set a permanent password</strong> the first time you sign in.
          Your temporary password will no longer work after that.
        </p>

        <a href="${PORTAL}/login" style="display:inline-block;background:#0A5C46;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:600;margin:8px 0">
          Sign in to BespoxAI →
        </a>

        <p style="font-size:12px;color:#8a9a8e;margin-top:24px">
          If you weren't expecting this email, you can safely ignore it.
        </p>
      `),
    })
  } catch (e) {
    console.error('[notifyUserWelcome]', e)
  }
}

// ── Superadmin notifications ──────────────────────────────────────────────────

export async function notifyAdminsSignupVerified(params: {
  companyName: string
  email:       string
}) {
  const admins = await getSuperadmins()
  await Promise.all(admins.map(admin =>
    sendEmail({
      to:      admin.email,
      subject: `New signup verified — ${params.companyName}`,
      html: wrap(`
        <p>Hi ${admin.name ?? 'there'},</p>
        <p><strong>${params.companyName}</strong> has verified their email address and is awaiting account activation.</p>
        <p style="margin:0">Email: ${params.email}</p>
        ${cta('Review signups', `${PORTAL}/admin?tab=signups`)}
      `),
    })
  ))
}

export async function notifyAdminsNewRequirement(params: {
  requirementId: string
  title:         string
  tenantName:    string
  customerName:  string
  customerEmail: string
  isAddendum?:   boolean
  parentTitle?:  string
}) {
  const admins = await getSuperadmins()
  const label  = params.isAddendum ? 'New Addendum' : 'New Requirement'
  const addendumNote = params.isAddendum && params.parentTitle
    ? `<p style="color:#666;font-size:13px">Addendum to: <em>${params.parentTitle}</em></p>`
    : ''

  await Promise.all(admins.map(admin =>
    sendEmail({
      to:      admin.email,
      subject: `${label} — ${params.title} (${params.tenantName})`,
      html: wrap(`
        <p>Hi ${admin.name ?? 'there'},</p>
        <p><strong>${params.customerName || params.customerEmail}</strong> at <strong>${params.tenantName}</strong> has submitted a ${params.isAddendum ? 'new addendum' : 'new requirement'}.</p>
        ${reqBlock(params.title, params.tenantName, params.isAddendum)}
        ${addendumNote}
        ${cta('Review in admin', `${PORTAL}/admin`)}
      `),
    }).catch(e => console.error('[notify] admin new req:', e))
  ))
}

export async function notifyAdminsAnswered(params: {
  requirementId: string
  title:         string
  tenantName:    string
  customerName:  string
}) {
  const admins = await getSuperadmins()
  await Promise.all(admins.map(admin =>
    sendEmail({
      to:      admin.email,
      subject: `Questions answered — ${params.title} (${params.tenantName})`,
      html: wrap(`
        <p>Hi ${admin.name ?? 'there'},</p>
        <p><strong>${params.customerName}</strong> at <strong>${params.tenantName}</strong> has answered your clarification questions for:</p>
        ${reqBlock(params.title, params.tenantName)}
        ${cta('Review answers', `${PORTAL}/admin`)}
      `),
    }).catch(e => console.error('[notify] admin answered:', e))
  ))
}

export async function notifyAdminsQuoteRejected(params: {
  title:          string
  tenantName:     string
  customerName:   string
  rejectionReason?: string
}) {
  const admins = await getSuperadmins()
  const reasonBlock = params.rejectionReason
    ? `<blockquote style="border-left:3px solid #C8952A;padding:8px 14px;margin:12px 0;color:#555;font-style:italic">"${params.rejectionReason}"</blockquote>`
    : ''
  await Promise.all(admins.map(admin =>
    sendEmail({
      to:      admin.email,
      subject: `Quote rejected — ${params.title} (${params.tenantName})`,
      html: wrap(`
        <p>Hi ${admin.name ?? 'there'},</p>
        <p><strong>${params.customerName}</strong> at <strong>${params.tenantName}</strong> has rejected the quote for:</p>
        ${reqBlock(params.title, params.tenantName)}
        ${reasonBlock}
        ${cta('Review and revise', `${PORTAL}/admin`)}
      `),
    }).catch(e => console.error('[notify] admin quote rejected:', e))
  ))
}

export async function notifyAdminsDepositPaid(params: {
  title:         string
  tenantName:    string
  customerName:  string
  depositAmount: number
}) {
  const admins = await getSuperadmins()
  await Promise.all(admins.map(admin =>
    sendEmail({
      to:      admin.email,
      subject: `Deposit paid — ${params.title} (${params.tenantName})`,
      html: wrap(`
        <p>Hi ${admin.name ?? 'there'},</p>
        <p><strong>${params.customerName}</strong> at <strong>${params.tenantName}</strong> has paid the deposit for:</p>
        ${reqBlock(params.title, params.tenantName)}
        <p><strong>Deposit amount:</strong> $${params.depositAmount.toLocaleString('en-NZ', { minimumFractionDigits: 2 })} NZD (plus GST)</p>
        <p>You can now start development when ready.</p>
        ${cta('View in admin', `${PORTAL}/admin`)}
      `),
    }).catch(e => console.error('[notify] admin deposit paid:', e))
  ))
}

// ── Customer notifications ────────────────────────────────────────────────────

export async function notifyCustomerNeedsClarif(params: {
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
  questions:     string
}) {
  await sendEmail({
    to:      params.customerEmail,
    subject: `We have some questions — ${params.title}`,
    html: wrap(`
      <p>Hi ${params.customerName || 'there'},</p>
      <p>Thank you for your customisation request. Before we can provide a quote, we have a few questions about:</p>
      ${reqBlock(params.title, params.tenantName)}
      <div style="background:#fff;border:1px solid #e0dbd4;border-radius:8px;padding:16px 20px;margin:12px 0">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.05em">Questions from BespoxAI</p>
        <p style="margin:0;white-space:pre-wrap;font-size:14px">${params.questions}</p>
      </div>
      ${cta('Reply in your portal', PORTAL)}
    `),
  }).catch(e => console.error('[notify] customer clarif:', e))
}

export async function notifyCustomerQuoted(params: {
  customerEmail:  string
  customerName:   string
  title:          string
  tenantName:     string
  quoteAmount:    number
  consultantNote?: string
}) {
  const noteBlock = params.consultantNote
    ? `<div style="background:#fff;border:1px solid #e0dbd4;border-radius:8px;padding:16px 20px;margin:12px 0"><p style="margin:0;font-size:14px;white-space:pre-wrap">${params.consultantNote}</p></div>`
    : ''
  await sendEmail({
    to:      params.customerEmail,
    subject: `Your quote is ready — ${params.title}`,
    html: wrap(`
      <p>Hi ${params.customerName || 'there'},</p>
      <p>We've reviewed your customisation request and we're ready to proceed. Here's your quote:</p>
      ${reqBlock(params.title, params.tenantName)}
      <div style="background:#fff;border-left:3px solid #C8952A;padding:12px 20px;margin:16px 0;border-radius:0 6px 6px 0">
        <p style="margin:0;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.06em">Quote amount</p>
        <p style="margin:4px 0 0;font-size:28px;font-weight:700;color:#0A5C46">$${params.quoteAmount.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#888">NZD plus GST</p>
      </div>
      ${noteBlock}
      <p>Log in to your portal to review the quote and confirm you'd like to proceed. A 20% deposit will be required to start development.</p>
      ${cta('Review quote', PORTAL)}
    `),
  }).catch(e => console.error('[notify] customer quoted:', e))
}

export async function notifyCustomerInDevelopment(params: {
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
}) {
  await sendEmail({
    to:      params.customerEmail,
    subject: `Development started — ${params.title}`,
    html: wrap(`
      <p>Hi ${params.customerName || 'there'},</p>
      <p>Great news — we've started development on your customisation:</p>
      ${reqBlock(params.title, params.tenantName)}
      <p>We'll notify you when the work is deployed to your test environment and ready for review.</p>
      ${cta('Track progress', PORTAL)}
    `),
  }).catch(e => console.error('[notify] customer in dev:', e))
}

export async function notifyCustomerReadyForUAT(params: {
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
}) {
  await sendEmail({
    to:      params.customerEmail,
    subject: `Ready for testing — ${params.title}`,
    html: wrap(`
      <p>Hi ${params.customerName || 'there'},</p>
      <p>Your customisation has been deployed to the test environment and is ready for your review:</p>
      ${reqBlock(params.title, params.tenantName)}
      <p>Please test thoroughly in your test environment and sign off when you're satisfied, or let us know if anything needs adjustment.</p>
      ${cta('Review & sign off', PORTAL)}
    `),
  }).catch(e => console.error('[notify] customer ready for UAT:', e))
}

export async function notifyCustomerBalanceDue(params: {
  customerEmail:  string
  customerName:   string
  title:          string
  tenantName:     string
  balanceAmount:  number
}) {
  await sendEmail({
    to:      params.customerEmail,
    subject: `Balance payment due — ${params.title}`,
    html: wrap(`
      <p>Hi ${params.customerName || 'there'},</p>
      <p>Your customisation has been completed and is ready for production deployment once the balance is settled:</p>
      ${reqBlock(params.title, params.tenantName)}
      <div style="background:#fff;border-left:3px solid #C8952A;padding:12px 20px;margin:16px 0;border-radius:0 6px 6px 0">
        <p style="margin:0;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.06em">Balance due</p>
        <p style="margin:4px 0 0;font-size:28px;font-weight:700;color:#0A5C46">$${params.balanceAmount.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#888">NZD plus GST</p>
      </div>
      <p>Log in to your portal to complete payment and arrange production deployment.</p>
      ${cta('Pay balance', PORTAL)}
    `),
  }).catch(e => console.error('[notify] customer balance due:', e))
}

// ── Production deployment notifications ───────────────────────────────────────

export async function notifyCustomerProdApproval(params: {
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
  goLiveDoc:     string
}) {
  await sendEmail({
    to:      params.customerEmail,
    subject: 'Go-live approval required — ' + params.title,
    html: wrap(`
      <p>Hi ${params.customerName || 'there'},</p>
      <p>Your customisation is ready for production deployment. Please review the go-live summary below and approve when you're ready to proceed.</p>
      ${reqBlock(params.title, params.tenantName)}
      <div style="background:#fff;border:1px solid #e0dbd4;border-radius:8px;padding:20px 24px;margin:16px 0;line-height:1.75">
        <p style="margin:0 0 12px;font-size:12px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.05em">Go-live summary</p>
        <div style="font-size:14px;white-space:pre-wrap;color:#2a3a2e">${params.goLiveDoc}</div>
      </div>
      <p>Log in to your portal to review and approve. Once approved, we will schedule the production deployment.</p>
      ${cta('Review & Approve Go-Live', PORTAL)}
    `),
  }).catch(e => console.error('[notify] customer prod approval:', e))
}

export async function notifyAdminsProdApproved(params: {
  title:        string
  tenantName:   string
  customerName: string
}) {
  const admins = await getSuperadmins()
  await Promise.all(admins.map(admin =>
    sendEmail({
      to:      admin.email,
      subject: '✓ Go-Live Approved — ' + params.title + ' (' + params.tenantName + ')',
      html: wrap(`
        <p>Hi ${admin.name ?? 'there'},</p>
        <p><strong>${params.customerName}</strong> at <strong>${params.tenantName}</strong> has approved the go-live document for:</p>
        ${reqBlock(params.title, params.tenantName)}
        <p>The requirement is ready for production deployment. Log in to admin to deploy when convenient.</p>
        ${cta('Deploy in admin', PORTAL + '/admin')}
      `),
    }).catch(e => console.error('[notify] admin prod approved:', e))
  ))
}

export async function notifyCustomerProdDeployed(params: {
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
}) {
  await sendEmail({
    to:      params.customerEmail,
    subject: '🚀 Live in production — ' + params.title,
    html: wrap(`
      <p>Hi ${params.customerName || 'there'},</p>
      <p>Your customisation has been successfully deployed to production:</p>
      ${reqBlock(params.title, params.tenantName)}
      <div style="background:rgba(10,92,70,0.06);border:1px solid rgba(10,92,70,0.25);border-radius:8px;padding:14px 18px;margin:16px 0">
        <p style="margin:0;font-size:14px;color:#0A5C46;font-weight:600">✓ Your changes are now live in Business Central.</p>
      </div>
      <p>If you notice anything unexpected, please get in touch with us right away.</p>
      ${cta('Open your portal', PORTAL)}
    `),
  }).catch(e => console.error('[notify] customer prod deployed:', e))
}
