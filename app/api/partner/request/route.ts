import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const PORTAL = process.env.NEXTAUTH_URL ?? 'https://bespoxai.com'

function wrap(body: string): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a1a;max-width:580px;margin:40px auto;padding:0 20px;line-height:1.6">${body}<hr style="border:none;border-top:1px solid #e8e8e0;margin:32px 0"/><p style="font-size:12px;color:#8a9a8e">BespoxAI — Business Central &amp; Microsoft NAV Intelligence Portal</p></body></html>`
}

// POST /api/partner/request
// Client user on a partner-managed tenant requests upgrade or connection setup.
// Notifies partner billing email + all BespoxAI superadmins.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Must be a partner-managed client user
  if (!user.managedByPartner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const type: 'upgrade' | 'connection' = body.type === 'connection' ? 'connection' : 'upgrade'

  // Load tenant + partner account
  const tenant = await (prisma as any).tenant.findUnique({
    where:   { id: user.tenantId },
    include: { partnerAccount: { select: { id: true, name: true, billingEmail: true } } },
  })
  if (!tenant || !tenant.partnerAccount) {
    return NextResponse.json({ error: 'Tenant or partner not found' }, { status: 404 })
  }

  // Load superadmins
  const superadmins: { email: string; name: string | null }[] = await (prisma as any).user.findMany({
    where:  { role: 'superadmin' },
    select: { email: true, name: true },
  })

  const requesterName  = user.preferredName ?? user.firstName ?? user.name ?? user.email
  const tenantName     = tenant.name as string
  const partnerName    = tenant.partnerAccount.name as string
  const partnerEmail   = tenant.partnerAccount.billingEmail as string

  const subject = type === 'upgrade'
    ? 'Upgrade request from ' + tenantName
    : 'Connection setup request from ' + tenantName

  const partnerHtml = wrap(type === 'upgrade' ? `
    <p>Hi,</p>
    <p><strong>${requesterName}</strong> from <strong>${tenantName}</strong> has requested a plan upgrade via the BespoxAI portal.</p>
    <p>They have reached their monthly AI token limit and would like to be upgraded to a higher plan.</p>
    <p>Please log in to the partner portal to review their account and update their plan.</p>
    <a href="${PORTAL}/partner/dashboard" style="display:inline-block;background:#0A5C46;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:600;margin:16px 0">
      View in Partner Portal →
    </a>
    <p style="font-size:13px;color:#6b7b70">Tenant: ${tenantName} &nbsp;|&nbsp; Requested by: ${requesterName} &nbsp;|&nbsp; Email: ${user.email}</p>
  ` : `
    <p>Hi,</p>
    <p><strong>${requesterName}</strong> from <strong>${tenantName}</strong> has requested that their Business Central / NAV system connection be set up.</p>
    <p>Please log in to the partner portal, navigate to the BCAgent tab for this client, and download and run the installer on their server.</p>
    <a href="${PORTAL}/partner/dashboard" style="display:inline-block;background:#0A5C46;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:600;margin:16px 0">
      View in Partner Portal →
    </a>
    <p style="font-size:13px;color:#6b7b70">Tenant: ${tenantName} &nbsp;|&nbsp; Requested by: ${requesterName} &nbsp;|&nbsp; Email: ${user.email}</p>
  `)

  const superadminHtml = wrap(`
    <p>Hi,</p>
    <p>A <strong>${type === 'upgrade' ? 'plan upgrade' : 'system connection'} request</strong> has been submitted by a partner-managed client.</p>
    <ul style="font-size:14px;line-height:2">
      <li><strong>Tenant:</strong> ${tenantName}</li>
      <li><strong>Partner:</strong> ${partnerName}</li>
      <li><strong>Requested by:</strong> ${requesterName} (${user.email})</li>
      <li><strong>Type:</strong> ${type === 'upgrade' ? 'Plan upgrade' : 'Connection setup'}</li>
    </ul>
    <p style="font-size:13px;color:#6b7b70">This is for your records. The partner has been notified directly.</p>
  `)

  const sends: Promise<void>[] = []

  // Notify partner
  sends.push(sendEmail({ to: partnerEmail, subject, html: partnerHtml }).catch(() => {}))

  // Notify all superadmins
  for (const sa of superadmins) {
    sends.push(sendEmail({ to: sa.email, subject: '[BespoxAI] ' + subject, html: superadminHtml }).catch(() => {}))
  }

  await Promise.all(sends)

  return NextResponse.json({ ok: true })
}
