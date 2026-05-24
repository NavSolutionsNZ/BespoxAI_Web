import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const requirement = await (prisma as any).requirement.findUnique({
    where: { id: params.id }, select: { tenantId: true },
  })
  if (!requirement) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const tenant = await (prisma as any).tenant.findUnique({
    where:  { id: requirement.tenantId },
    select: { tunnelSubdomain: true, apiKey: true },
  })
  if (!tenant?.tunnelSubdomain) return NextResponse.json({ error: 'Tunnel not configured' }, { status: 400 })

  const agentBase = 'https://' + tenant.tunnelSubdomain + '-agent.bespoxai.com'

  let agentRes: Response
  try {
    agentRes = await fetch(agentBase + '/bespoxai/objects/deploy-status?jobId=' + jobId, {
      headers: { 'X-BespoxAI-Key': tenant.apiKey },
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'Could not reach BCAgent' }, { status: 502 })
  }

  const rawText = await agentRes.text()
  let data: any = {}
  try { data = JSON.parse(rawText) } catch {}

  // On successful completion, stamp testDeployedAt and clear UAT cycle
  if (data.status === 'done' && data.success) {
    await (prisma as any).requirement.update({
      where: { id: params.id },
      data: {
        testDeployedAt:       new Date(),
        uatApprovedAt:        null, uatApprovedById:      null,
        uatRejectedAt:        null, uatRejectedById:      null,
        uatRejectionReason:   null, uatRejectionAnalysis: null,
      },
    }).catch(() => {})
  }

  return NextResponse.json(data)
}
