import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await requireSuperadmin()
  if (session instanceof NextResponse) return session

  const enquiries = await (prisma as any).migrationEnquiry.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      tenant: { select: { name: true } },
      user:   { select: { name: true, email: true } },
    },
  })

  return NextResponse.json({ enquiries })
}

export async function PATCH(req: Request) {
  const session = await requireSuperadmin()
  if (session instanceof NextResponse) return session

  const { id, status } = await req.json()
  const updated = await (prisma as any).migrationEnquiry.update({
    where: { id },
    data:  { status },
  })
  return NextResponse.json({ enquiry: updated })
}
