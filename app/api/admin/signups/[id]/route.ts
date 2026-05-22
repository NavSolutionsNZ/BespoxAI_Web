import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// DELETE /api/admin/signups/[id] -- remove a signup request (cleanup duplicates etc.)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = params

  const existing = await prisma.signupRequest.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Signup request not found' }, { status: 404 })

  await prisma.signupRequest.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
