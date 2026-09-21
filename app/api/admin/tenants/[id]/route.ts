import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// PATCH /api/admin/tenants/[id] — update tenant fields including tier
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { active, name, tier, trialEndsAt } = body

  // Validate tier if provided
  const validTiers = ['trial', 'paid', 'enterprise']
  if (tier !== undefined && !validTiers.includes(tier)) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }

  const tenant = await prisma.tenant.update({
    where: { id: params.id },
    data: {
      ...(active !== undefined && { active }),
      ...(name   !== undefined && { name }),
      ...(tier   !== undefined && {
        tier,
        // Clear expiry when upgrading to paid/enterprise; set it for trial
        trialEndsAt: (tier === 'paid' || tier === 'enterprise')
          ? null
          : trialEndsAt
            ? new Date(trialEndsAt)
            : undefined,
      }),
    },
  })

  return NextResponse.json({ tenant })
}
