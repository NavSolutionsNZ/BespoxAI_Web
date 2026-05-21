/**
 * GET /api/requirements/[id]/objects/[fileId]/content
 *
 * Returns the raw stored content of a TenantObjectFile as a .txt download.
 * Superadmin only. Derives access from the requirement, not the session tenant.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; fileId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const file = await (prisma as any).tenantObjectFile.findUnique({
    where:  { id: params.fileId },
    select: {
      id: true, requirementId: true, tenantId: true,
      objectType: true, objectId: true, objectName: true,
      language: true, content: true, filename: true,
    },
  })

  if (!file)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Validate the file belongs to this requirement
  if (file.requirementId !== params.id)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!file.content)
    return NextResponse.json({ error: 'No content stored for this object' }, { status: 404 })

  const safeFilename = `${file.objectType}_${file.objectId ?? 'unknown'}_${file.objectName.replace(/[^a-zA-Z0-9_\-. ]/g, '_')}.txt`

  return new NextResponse(file.content, {
    status: 200,
    headers: {
      'Content-Type':        'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
    },
  })
}
