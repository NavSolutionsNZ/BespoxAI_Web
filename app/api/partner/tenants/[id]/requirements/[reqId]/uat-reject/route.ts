/**
 * POST /api/partner/tenants/[id]/requirements/[reqId]/uat-reject
 *
 * Partner rejects UAT on behalf of the tenant, with a reason.
 * AI checks if the rejection is scope creep vs a legitimate bug —
 * mirrors the direct uat-reject route.
 *
 * Body: { reason: string, confirm?: boolean }
 *
 * isScopeCreep = true  → returns analysis, does NOT record rejection yet
 * isScopeCreep = false (or confirm) → records rejection, clears test deploy,
 *                                     notifies partner team
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerSession, assertTenantBelongsToPartner } from '@/lib/partner-auth'
import { prisma }                    from '@/lib/db'
import { getAiConfig }               from '@/lib/ai-config'
import { notifyPartnerUatRejected }  from '@/lib/notifications'

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

  const { reason, confirm } = await req.json().catch(() => ({})) as {
    reason?: string
    confirm?: boolean
  }

  if (!reason?.trim())
    return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 })

  const requirement = await (prisma as any).requirement.findFirst({
    where:  { id: params.reqId, tenantId: params.id },
    select: {
      id: true, title: true, tenantId: true, aiSpec: true,
      status: true, testDeployedAt: true,
      tenant: { select: { name: true } },
      user:   { select: { name: true, email: true } },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!requirement.testDeployedAt)
    return NextResponse.json({ error: 'No test deployment to reject' }, { status: 400 })

  // ── AI scope-creep analysis (skip if already confirmed) ─────────────────────
  let analysis: { isScopeCreep: boolean; explanation: string; suggestedAmendment?: string } | null = null

  if (!confirm) {
    let specSummary = ''
    try {
      const spec = JSON.parse(requirement.aiSpec ?? '{}')
      specSummary = [
        spec.userStory ? `User story: ${spec.userStory}` : '',
        spec.acceptanceCriteria?.length
          ? `Acceptance criteria:\n${spec.acceptanceCriteria.map((c: string) => `- ${c}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n\n')
    } catch {}

    const cfg = await getAiConfig()

    const prompt = `You are assessing whether a customer's UAT rejection is scope creep or a legitimate bug/defect.

ORIGINAL SPECIFICATION:
${specSummary || '(No spec available)'}

CUSTOMER REJECTION REASON:
"${reason}"

Determine:
1. Is this describing something OUTSIDE the original specification (scope creep)?
2. Or is this a bug, defect, or failure of the delivered work to meet the spec?

Respond ONLY with valid JSON, no markdown:
{
  "isScopeCreep": boolean,
  "explanation": "2-3 sentences explaining your determination in plain English, addressed to the customer",
  "suggestedAmendment": "If scope creep: one sentence describing what an amendment to the quote would cover. If not scope creep: null"
}`

    try {
      let raw = ''
      if (cfg.provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         process.env.ANTHROPIC_API_KEY ?? '',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: cfg.model, max_tokens: 400, temperature: 0.2,
            messages: [{ role: 'user', content: prompt }],
          }),
        })
        const d = await r.json()
        raw = d.content?.[0]?.text ?? ''
      } else {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: cfg.model, max_tokens: 400, temperature: 0.2,
            messages: [{ role: 'user', content: prompt }],
          }),
        })
        const d = await r.json()
        raw = d.choices?.[0]?.message?.content ?? ''
      }

      analysis = JSON.parse(raw.replace(/```json|```/g, '').trim())
    } catch {
      analysis = { isScopeCreep: false, explanation: 'Unable to analyse — proceeding as legitimate rejection.' }
    }

    if (analysis?.isScopeCreep) {
      return NextResponse.json({
        isScopeCreep:       true,
        explanation:        analysis.explanation,
        suggestedAmendment: analysis.suggestedAmendment,
        rejected:           false,
      })
    }
  }

  // ── Record the rejection ────────────────────────────────────────────────────
  const now = new Date()

  await (prisma as any).requirement.update({
    where: { id: params.reqId },
    data:  {
      status:               'uat_rejected',
      uatRejectedAt:        now,
      uatRejectedById:      session.userId,
      uatRejectionReason:   reason,
      uatRejectionAnalysis: analysis ?? { isScopeCreep: false, explanation: 'Customer confirmed rejection' },
      testDeployedAt:       null,
      testDeploySnapshotId: null,
      uatApprovedAt:        null,
      uatApprovedById:      null,
    },
  })

  const customerName = requirement.user?.name ?? requirement.user?.email ?? 'Customer'
  const tenantName   = requirement.tenant?.name ?? 'Unknown'

  notifyPartnerUatRejected({
    tenantId:   params.id,
    title:      requirement.title,
    tenantName,
    customerName,
    reason,
  }).catch(() => {/* non-fatal */})

  return NextResponse.json({ rejected: true, rejectedAt: now.toISOString(), isScopeCreep: false })
}
