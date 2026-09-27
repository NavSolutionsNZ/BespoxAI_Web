import { NextRequest, NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/api-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// DELETE /api/admin/signups/[id] -- remove a signup request (cleanup duplicates etc.)
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await requireSuperadmin()
  if (session instanceof NextResponse) return session

  const { id } = params

  const existing = await prisma.signupRequest.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Signup request not found' }, { status: 404 })

  await prisma.signupRequest.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
