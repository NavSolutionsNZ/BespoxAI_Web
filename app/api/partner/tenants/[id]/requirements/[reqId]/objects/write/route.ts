/**
 * POST /api/partner/tenants/[id]/requirements/[reqId]/objects/write
 *
 * Partner-deliverer equivalent of the direct
 * /api/requirements/[id]/objects/write.
 *
 * Loads selected TenantObjectFile content records and writes them to the
 * BCAgent Deployments folder on the CLIENT tenant's server (same tunnel +
 * apiKey as the direct route — objects target the client's BC regardless of
 * who delivers). Returns snapshotId for use by deploy-test.
 *
 * Auth: partner session + tenant ownership + can-develop, AND the deploy gate
 * (partner_admin OR the requirement's assigned developer).
 *
 * Body: { fileIds: string[] }   ← TenantObjectFile IDs to deploy
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  requirePartnerSession,
  assertTenantBelongsToPartner,
  assertPartnerCanDevelop,
  partnerCanDeploy,
} from '@/lib/partner-auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; reqId: string } }
) {
  const session = await requirePartnerSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertTenantBelongsToPartner(params.id, session.partnerAccountId)
  } catch {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  try {
    await assertPartnerCanDevelop(session.partnerAccountId)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Forbidden' }, { status: 403 })
  }

  const requirement = await (prisma as any).requirement.findFirst({
    where:  { id: params.reqId, tenantId: params.id },
    select: { id: true, tenantId: true, status: true, assignedDeveloperId: true },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  if (!partnerCanDeploy(session, requirement.assignedDeveloperId))
    return NextResponse.json({ error: 'Only the assigned developer or a partner admin can deploy.' }, { status: 403 })

  const { fileIds } = await req.json().catch(() => ({})) as { fileIds?: string[] }
  if (!fileIds?.length)
    return NextResponse.json({ error: 'No fileIds provided' }, { status: 400 })

  // ── DEBUG ──
  if (process.env.SETTINGS_DEBUG === 'true') {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
    const snapshotId = ts + '_deploy_DEBUG'
    return NextResponse.json({
      snapshotId,
      path:        'C:\\BespoxAI\\Deployments\\' + params.reqId + '\\' + snapshotId,
      objectCount: fileIds.length,
      _debug:      true,
    })
  }
  // ── END DEBUG ──

  const files = await (prisma as any).tenantObjectFile.findMany({
    where: {
      id:       { in: fileIds },
      tenantId: requirement.tenantId,
      content:  { not: null },
    },
    select: { id: true, objectType: true, objectId: true, objectName: true, content: true },
  })

  if (!files.length)
    return NextResponse.json({ error: 'No files found with content. Sync from GitHub first.' }, { status: 400 })

  const tenant = await (prisma as any).tenant.findFirst({
    where:  { id: requirement.tenantId },
    select: { tunnelSubdomain: true, apiKey: true, testNavDatabaseName: true },
  })
  if (!tenant?.tunnelSubdomain)
    return NextResponse.json({ error: 'Tenant tunnel not configured' }, { status: 400 })

  if (!tenant.testNavDatabaseName)
    return NextResponse.json({
      error: 'Test NAV database not configured for this client tenant (Settings \u2192 BC Installer \u2192 Test Environment).',
    }, { status: 400 })

  const agentBase = 'https://' + tenant.tunnelSubdomain + '-agent.bespoxai.com'

  const objects = (files as any[]).map((f: any) => ({
    filename: f.objectType + '_' + (f.objectId ?? 'X') + '_' + f.objectName.replace(/[^a-zA-Z0-9_\-. ]/g, '_') + '.txt',
    content:  f.content,
  }))

  let agentRes: Response
  try {
    agentRes = await fetch(agentBase + '/bespoxai/objects/write', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-BespoxAI-Key': tenant.apiKey },
      body:    JSON.stringify({ requirementId: params.reqId, objects }),
    })
  } catch (e: any) {
    return NextResponse.json({
      error: 'Could not reach BCAgent at ' + agentBase + '. Is the agent running? (' + (e.message ?? 'network error') + ')',
    }, { status: 502 })
  }

  if (!agentRes.ok) {
    let msg = 'BCAgent returned ' + agentRes.status
    try { const e = await agentRes.json(); msg = e.error ?? msg } catch {}
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // BCAgent may return malformed JSON (unescaped Windows paths) — read text first.
  const rawText = await agentRes.text()
  let data: any = {}
  try { data = JSON.parse(rawText) } catch { /* malformed JSON from agent */ }
  const snapshotId = data.snapshotId
    ?? (rawText.match(/"snapshotId"\s*:\s*"([^"]+)"/) ?? [])[1]
    ?? null

  if (snapshotId) {
    await (prisma as any).requirement.update({
      where: { id: params.reqId },
      data:  { testDeploySnapshotId: snapshotId },
    }).catch(() => { /* non-fatal */ })
  }

  return NextResponse.json({ snapshotId, path: data.path, objectCount: data.objectCount })
}
