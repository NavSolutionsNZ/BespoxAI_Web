import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const signups = await (prisma as any).partnerSignupRequest.findMany({
    where: { activatedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ signups })
}
