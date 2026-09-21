import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ── DELETE /api/requirements/[id]/objects/[fileId] ────────────────────────────
// Removes a single parsed object record. Superadmin only.

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; fileId: string }> }
) {
  const params = await props.params;
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  if (user.role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const record = await (prisma as any).tenantObjectFile.findUnique({
    where:  { id: params.fileId },
    select: { requirementId: true },
  })

  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (record.requirementId !== params.id)
    return NextResponse.json({ error: 'Mismatch' }, { status: 400 })

  await (prisma as any).tenantObjectFile.delete({ where: { id: params.fileId } })

  return NextResponse.json({ ok: true })
}
