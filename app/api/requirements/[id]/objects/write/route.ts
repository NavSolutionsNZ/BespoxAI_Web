/**
 * POST /api/requirements/[id]/objects/write
 *
 * Superadmin only. Loads selected TenantObjectFile content records and writes
 * them to the BCAgent Deployments folder on the customer server.
 * Fast — just disk write, no compilation. Returns snapshotId for use by deploy-test.
 *
 * Body: { fileIds: string[] }   ← TenantObjectFile IDs to deploy
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: { id: true, tenantId: true, status: true },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  const { fileIds } = await req.json().catch(() => ({})) as { fileIds?: string[] }
  if (!fileIds?.length)
    return NextResponse.json({ error: 'No fileIds provided' }, { status: 400 })

  // ── DEBUG ──
  if (process.env.SETTINGS_DEBUG === 'true') {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
    const snapshotId = `${ts}_deploy_DEBUG`
    return NextResponse.json({
      snapshotId,
      path:        `C:\\BespoxAI\\Deployments\\${params.id}\\${snapshotId}`,
      objectCount: fileIds.length,
      _debug:      true,
    })
  }
  // ── END DEBUG ──

  // Load object files with content
  const files = await (prisma as any).tenantObjectFile.findMany({
    where: {
      id:       { in: fileIds },
      tenantId: requirement.tenantId,
      content:  { not: null },
    },
    select: { id: true, objectType: true, objectId: true, objectName: true, content: true },
  })

  if (!files.length)
    return NextResponse.json({ error: 'No files found with content. Fetch objects from BCAgent first.' }, { status: 400 })

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: requirement.tenantId },
    select: { tunnelSubdomain: true, apiKey: true, testNavDatabaseName: true },
  })
  if (!tenant?.tunnelSubdomain)
    return NextResponse.json({ error: 'Tenant tunnel not configured' }, { status: 400 })

  if (!tenant.testNavDatabaseName)
    return NextResponse.json({
      error: 'Test NAV database not configured. Add it in the BC Installer tab.',
    }, { status: 400 })

  const agentBase = `https://${tenant.tunnelSubdomain}-agent.bespoxai.com`

  const objects = files.map((f: any) => ({
    filename: `${f.objectType}_${f.objectId ?? 'X'}_${f.objectName.replace(/[^a-zA-Z0-9_\-. ]/g, '_')}.txt`,
    content:  f.content,
  }))

  const agentRes = await fetch(`${agentBase}/bespoxai/objects/write`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-BespoxAI-Key': tenant.apiKey },
    body:    JSON.stringify({ requirementId: params.id, objects }),
  })

  if (!agentRes.ok) {
    let msg = `BCAgent returned ${agentRes.status}`
    try { const e = await agentRes.json(); msg = e.error ?? msg } catch {}
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const data = await agentRes.json()
  return NextResponse.json({ snapshotId: data.snapshotId, path: data.path, objectCount: data.objectCount })
}
