import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/history
// Returns the last 10 queries for the current user, newest first.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ logs: [] })

  const logs = await prisma.queryLog.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    take:    10,
    select: {
      id:          true,
      question:    true,
      answer:      true,
      displayHint: true,
      data:        true,
      entity:      true,
      recordCount: true,
      createdAt:   true,
    },
  })

  return NextResponse.json({ logs })
}
