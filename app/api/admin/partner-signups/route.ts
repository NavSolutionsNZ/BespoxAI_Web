import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireSuperadmin()
  if (session instanceof NextResponse) return session

  const signups = await (prisma as any).partnerSignupRequest.findMany({
    where: { activatedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ signups })
}
