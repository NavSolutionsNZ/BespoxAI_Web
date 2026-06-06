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
  tenantId?:    string
  to:           string
  name:         string | null
  tempPassword: string
  tenantName:   string
  role:         'tenant_admin' | 'user' | 'developer'
}) {
  const { to, name, tempPassword, tenantName, role, tenantId } = params
  const partnerFrom = tenantId ? await getPartnerFromEmail(tenantId) : null
  const greeting = name ? 'Hi ' + name + ',' : 'Hi,'
  const roleLabel = role === 'tenant_admin' ? 'Administrator' : role === 'developer' ? 'Developer' : 'User'
  try {
    await sendEmail({
      to,
      from:    partnerFrom ?? undefined,
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
  tenantId:      string
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
  questions:     string
}) {
  const partnerFrom = await getPartnerFromEmail(params.tenantId)
  await sendEmail({
    to:      params.customerEmail,
    from:    partnerFrom ?? undefined,
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
  tenantId:       string
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
  const partnerFrom = await getPartnerFromEmail(params.tenantId)
  await sendEmail({
    to:      params.customerEmail,
    from:    partnerFrom ?? undefined,
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
  tenantId:      string
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
}) {
  const partnerFrom = await getPartnerFromEmail(params.tenantId)
  await sendEmail({
    to:      params.customerEmail,
    from:    partnerFrom ?? undefined,
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
  tenantId:      string
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
}) {
  const partnerFrom = await getPartnerFromEmail(params.tenantId)
  await sendEmail({
    to:      params.customerEmail,
    from:    partnerFrom ?? undefined,
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
  tenantId:       string
  customerEmail:  string
  customerName:   string
  title:          string
  tenantName:     string
  balanceAmount:  number
}) {
  const partnerFrom = await getPartnerFromEmail(params.tenantId)
  await sendEmail({
    to:      params.customerEmail,
    from:    partnerFrom ?? undefined,
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
  tenantId:      string
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
  goLiveDoc:     string
}) {
  const partnerFrom = await getPartnerFromEmail(params.tenantId)
  await sendEmail({
    to:      params.customerEmail,
    from:    partnerFrom ?? undefined,
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
  tenantId:      string
  customerEmail: string
  customerName:  string
  title:         string
  tenantName:    string
}) {
  const partnerFrom = await getPartnerFromEmail(params.tenantId)
  await sendEmail({
    to:      params.customerEmail,
    from:    partnerFrom ?? undefined,
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

// ── Partner notifications ─────────────────────────────────────────────────────

export async function notifyAdminsPartnerSignupVerified(params: {
  companyName: string
  contactName: string
  email:       string
}) {
  try {
    const admins = await getSuperadmins()
    await Promise.all(admins.map(admin =>
      sendEmail({
        to:      admin.email,
        subject: 'New partner signup verified — ' + params.companyName,
        html: wrap(`
          <p>Hi ${admin.name ?? 'there'},</p>
          <p><strong>${params.companyName}</strong> (${params.contactName}) has verified their email address and is awaiting partner account activation.</p>
          <p style="margin:0">Email: ${params.email}</p>
          ${cta('Review in admin', PORTAL + '/admin?tab=partners')}
        `),
      })
    ))
  } catch (e) {
    console.error('[notifyAdminsPartnerSignupVerified]', e)
  }
}

export async function notifyPartnerWelcome(params: {
  email:       string
  contactName: string
  companyName: string
  tempPassword: string
}) {
  try {
    await sendEmail({
      to:      params.email,
      subject: 'Welcome to BespoxAI — your partner account is ready',
      html: wrap(`
        <p>Hi ${params.contactName},</p>
        <p>Your BespoxAI Partner account for <strong>${params.companyName}</strong> has been activated.</p>
        <p>You can log in at <a href="${PORTAL}/login" style="color:#0A5C46">${PORTAL}/login</a> using the credentials below.</p>
        <div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px 20px;margin:16px 0">
          <p style="margin:0 0 6px"><strong>Email:</strong> ${params.email}</p>
          <p style="margin:0"><strong>Temporary password:</strong> <code style="background:#f4f0e8;padding:2px 6px;border-radius:4px">${params.tempPassword}</code></p>
        </div>
        <p>You will be asked to set a new password on first login.</p>
        ${cta('Log in to Partner Portal', PORTAL + '/login')}
      `),
    })
  } catch (e) {
    console.error('[notifyPartnerWelcome]', e)
  }
}

// ── Partner helpers ───────────────────────────────────────────────────────────

/**
 * Returns the white-label from address for a tenant's partner account,
 * or null if the tenant has no partner, the partner is not white-label,
 * or no fromEmail is configured.
 */
export async function getPartnerFromEmail(tenantId: string): Promise<string | null> {
  if (!tenantId) return null
  try {
    const tenant = await (prisma as any).tenant.findUnique({
      where:  { id: tenantId },
      select: {
        partnerAccount: {
          select: { isWhiteLabel: true, fromEmail: true },
        },
      },
    })
    const p = tenant?.partnerAccount
    if (p?.isWhiteLabel && p?.fromEmail) return p.fromEmail as string
    return null
  } catch {
    return null
  }
}

// ── Partner team notifications ────────────────────────────────────────────────

export async function notifyPartnerTeamWelcome(params: {
  to:          string
  firstName:   string | null
  partnerName: string
  role:        string
  tempPassword: string
  fromEmail:   string | null
}) {
  const { to, firstName, partnerName, role, tempPassword, fromEmail } = params
  const greeting  = firstName ? 'Hi ' + firstName + ',' : 'Hi,'
  const roleLabel = role === 'partner_admin' ? 'Administrator' : 'Developer'
  const brandLabel = partnerName
  try {
    await sendEmail({
      to,
      from:    fromEmail ? fromEmail + ' <' + fromEmail + '>' : undefined,
      subject: 'Your ' + brandLabel + ' partner account is ready',
      html: wrap(`
        <p>${greeting}</p>
        <p>You've been added to the <strong>${brandLabel}</strong> partner account as a <strong>${roleLabel}</strong>.</p>

        <div style="background:#f5f5f0;border-radius:8px;padding:18px 20px;margin:20px 0">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7b70">Your temporary credentials</p>
          <p style="margin:0 0 4px"><strong>Email:</strong> ${to}</p>
          <p style="margin:0"><strong>Temporary password:</strong> <code style="background:#e8e8e0;padding:2px 6px;border-radius:4px;font-size:15px">${tempPassword}</code></p>
        </div>

        <p style="background:#fff8e8;border-left:3px solid #C8952A;padding:10px 14px;border-radius:0 6px 6px 0;margin:20px 0;font-size:13px">
          <strong>You will be asked to set a permanent password</strong> the first time you sign in.
        </p>

        ${cta('Sign in to Partner Portal', PORTAL + '/login')}

        <p style="font-size:12px;color:#8a9a8e;margin-top:24px">
          If you weren't expecting this email, you can safely ignore it.
        </p>
      `),
    })
  } catch (e) {
    console.error('[notifyPartnerTeamWelcome]', e)
  }
}

// ── Send partner agreement after signup verification ─────────────────────────────

export async function notifySendPartnerAgreement(params: {
  to:          string
  contactName: string
  companyName: string
}) {
  const { to, contactName, companyName } = params
  const greeting = contactName ? 'Hi ' + contactName + ',' : 'Hi,'
  try {
    await sendEmail({
      to,
      subject: 'Review the BespoxAI Partner Agreement',
      html: wrap(`
        <p>${greeting}</p>
        <p>Thank you for applying to become a BespoxAI Partner. We've received your application for <strong>${companyName}</strong>.</p>

        <p>As the next step, please review our <strong>Partner Agreement</strong> below. Your use of the Partner Portal after our approval constitutes your acceptance of these terms.</p>

        <div style="background:#f5f5f0;border-radius:8px;padding:18px 20px;margin:20px 0;text-align:center">
          <p style="margin:0 0 12px;font-size:14px;font-weight:600">Partner Agreement (PDF)</p>
          <p style="margin:0 0 12px;font-size:12px;color:#666">
            Please download and review before we activate your account.
          </p>
          <a href="${PORTAL}/legal/BespoxAI_Partner_Agreement_Signable.pdf" style="display:inline-block;background:#0A5C46;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
            Download Agreement (PDF)
          </a>
        </div>

        <p style="font-size:13px;color:#2a3a2e;line-height:1.6">
          Our team is currently reviewing your application. Once approved, you'll receive your account credentials and can start inviting team members and managing your clients through the Partner Portal.
        </p>

        <p style="font-size:12px;color:#8a9a8e;margin-top:24px">
          Questions about the agreement? <a href="mailto:partners@bespoxai.com" style="color:#0A5C46;text-decoration:none">Contact our partner team.</a>
        </p>
      `),
    })
  } catch (e) {
    console.error('[notifySendPartnerAgreement]', e)
  }
}

// ── Requirement assignment notifications ───────────────────────────────────────

export async function notifyRequirementAssigned(params: {
  to:           string
  devName:      string | null
  requirementTitle: string
  tenantName:   string
  requirementId: string
  fromEmail?:   string | null
}) {
  const { to, devName, requirementTitle, tenantName, requirementId, fromEmail } = params
  const greeting = devName ? 'Hi ' + devName + ',' : 'Hi,'
  try {
    await sendEmail({
      to,
      from: fromEmail ? fromEmail + ' <' + fromEmail + '>' : undefined,
      subject: 'New requirement assigned to you: ' + requirementTitle,
      html: wrap(`
        <p>${greeting}</p>
        <p>A new requirement has been assigned to you by the administrator.</p>

        <div style="background:#f5f5f0;border-radius:8px;padding:18px 20px;margin:20px 0">
          <p style="margin:0 0 12px"><strong>Requirement:</strong> ${requirementTitle}</p>
          <p style="margin:0"><strong>Customer:</strong> ${tenantName}</p>
        </div>

        ${cta('View in Portal', PORTAL + '/dashboard?view=customisations')}

        <p style="font-size:12px;color:#8a9a8e;margin-top:24px">
          If you're unable to complete this requirement, you can mark it as unable to complete in the portal and the administrator will be notified.
        </p>
      `),
    })
  } catch (e) {
    console.error('[notifyRequirementAssigned]', e)
  }
}

export async function notifyAdminRequirementUnableToComplete(params: {
  to:           string
  devName:      string | null
  requirementTitle: string
  tenantName:   string
  requirementId: string
}) {
  const { to, devName, requirementTitle, tenantName, requirementId } = params
  const greeting = 'Hi,'
  try {
    await sendEmail({
      to,
      subject: 'Developer marked requirement as unable: ' + requirementTitle,
      html: wrap(`
        <p>${greeting}</p>
        <p>${devName || 'A developer'} has marked a requirement as unable to complete and requires your attention.</p>

        <div style="background:#f5f5f0;border-radius:8px;padding:18px 20px;margin:20px 0">
          <p style="margin:0 0 12px"><strong>Requirement:</strong> ${requirementTitle}</p>
          <p style="margin:0 0 12px"><strong>Developer:</strong> ${devName || 'Unknown'}</p>
          <p style="margin:0"><strong>Customer:</strong> ${tenantName}</p>
        </div>

        <p style="font-size:13px;color:#2a3a2e;line-height:1.6">
          You can reassign this requirement to another team member or take it back yourself.
        </p>

        ${cta('Review in Admin Panel', PORTAL + '/admin')}
      `),
    })
  } catch (e) {
    console.error('[notifyAdminRequirementUnableToComplete]', e)
  }
}
