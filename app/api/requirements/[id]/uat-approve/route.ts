/**
 * POST /api/requirements/[id]/uat-approve
 *
 * Tenant admin only. Customer signs off UAT — records approval and notifies
 * the superadmin via email.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { sendEmail }                 from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  const role    = (session?.user as any)?.role
  if (!session?.user || !['tenant_admin', 'superadmin'].includes(role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const userId = (session.user as any).id

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: {
      id: true, title: true, tenantId: true,
      status: true, testDeployedAt: true, uatApprovedAt: true,
      tenant: { select: { name: true } },
      user:   { select: { name: true, email: true } },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!requirement.testDeployedAt)
    return NextResponse.json({ error: 'No test deployment recorded' }, { status: 400 })

  if (requirement.uatApprovedAt)
    return NextResponse.json({ error: 'UAT already approved' }, { status: 400 })

  const now = new Date()

  await (prisma as any).requirement.update({
    where: { id: params.id },
    data:  {
      uatApprovedAt:   now,
      uatApprovedById: userId,
      // Clear any previous rejection
      uatRejectedAt:        null,
      uatRejectedById:      null,
      uatRejectionReason:   null,
      uatRejectionAnalysis: null,
    },
  })

  // Notify superadmin
  const superadmins = await (prisma as any).user.findMany({
    where:  { role: 'superadmin' },
    select: { email: true, name: true },
  })

  const customerName = requirement.user?.name ?? requirement.user?.email ?? 'Customer'
  const tenantName   = requirement.tenant?.name ?? 'Unknown tenant'

  for (const admin of superadmins) {
    await sendEmail({
      to:      admin.email,
      subject: `✓ UAT Approved — ${requirement.title}`,
      html: `
        <p>Hi ${admin.name ?? 'there'},</p>
        <p><strong>${customerName}</strong> at <strong>${tenantName}</strong> has signed off UAT for:</p>
        <blockquote style="border-left:3px solid #0A5C46;padding-left:12px;margin:12px 0">
          <strong>${requirement.title}</strong>
        </blockquote>
        <p>Approved at: ${now.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })}</p>
        <p>The requirement is now ready for production deployment when you are.</p>
        <p style="margin-top:20px;font-size:12px;color:#888">BespoxAI — automated notification</p>
      `,
    }).catch(() => {/* non-fatal */})
  }

  return NextResponse.json({ approved: true, approvedAt: now.toISOString() })
}
