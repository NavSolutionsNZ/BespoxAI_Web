/**
 * POST /api/requirements/[id]/uat-reject
 *
 * Tenant admin only. Customer rejects UAT with a reason.
 * AI checks if the rejection is scope creep vs a legitimate bug.
 *
 * Body: { reason: string, confirm?: boolean }
 *
 * Response when isScopeCreep = true:
 *   { isScopeCreep: true, explanation, suggestedAmendment, rejected: false }
 *   Client shows the analysis — customer must explicitly choose to proceed.
 *
 * Response when isScopeCreep = false (or confirm=true after scope creep shown):
 *   { isScopeCreep: false, rejected: true }
 *   Sets uatRejectedAt, clears testDeployedAt, notifies superadmin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { getAiConfig }               from '@/lib/ai-config'
import { sendEmail }                 from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  const role    = (session?.user as any)?.role
  if (!session?.user || !['tenant_admin', 'superadmin'].includes(role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const userId = (session.user as any).id
  const { reason, confirm } = await req.json().catch(() => ({})) as {
    reason?: string
    confirm?: boolean   // true = customer chose to reject despite scope-creep warning
  }

  if (!reason?.trim())
    return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
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

  // ── AI scope-creep analysis (skip if customer already confirmed rejection) ─
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
      // AI call failed — treat as legitimate rejection
      analysis = { isScopeCreep: false, explanation: 'Unable to analyse — proceeding as legitimate rejection.' }
    }

    // If scope creep detected, return analysis without recording rejection yet
    if (analysis?.isScopeCreep) {
      return NextResponse.json({
        isScopeCreep:       true,
        explanation:        analysis.explanation,
        suggestedAmendment: analysis.suggestedAmendment,
        rejected:           false,
      })
    }
  }

  // ── Record the rejection ───────────────────────────────────────────────────
  const now = new Date()

  await (prisma as any).requirement.update({
    where: { id: params.id },
    data:  {
      status:               'uat_rejected',
      uatRejectedAt:        now,
      uatRejectedById:      userId,
      uatRejectionReason:   reason,
      uatRejectionAnalysis: analysis ?? { isScopeCreep: false, explanation: 'Customer confirmed rejection' },
      // Clear test deployment — new cycle required
      testDeployedAt:       null,
      testDeploySnapshotId: null,
      uatApprovedAt:        null,
      uatApprovedById:      null,
    },
  })

  // Notify superadmin
  const superadmins = await (prisma as any).user.findMany({
    where:  { role: 'superadmin' },
    select: { email: true, name: true },
  })
  const customerName = requirement.user?.name ?? requirement.user?.email ?? 'Customer'
  const tenantName   = requirement.tenant?.name ?? 'Unknown'

  for (const admin of superadmins) {
    await sendEmail({
      to:      admin.email,
      subject: `✕ UAT Rejected — ${requirement.title}`,
      html: `
        <p>Hi ${admin.name ?? 'there'},</p>
        <p><strong>${customerName}</strong> at <strong>${tenantName}</strong> has rejected UAT for:</p>
        <blockquote style="border-left:3px solid #A32D2D;padding-left:12px;margin:12px 0">
          <strong>${requirement.title}</strong>
        </blockquote>
        <p><strong>Reason:</strong> ${reason}</p>
        ${confirm ? '<p><em>(Customer confirmed rejection after scope-creep check)</em></p>' : ''}
        <p>A new deployment cycle is required. The test deployment has been cleared.</p>
        <p style="margin-top:20px;font-size:12px;color:#888">BespoxAI — automated notification</p>
      `,
    }).catch(() => {/* non-fatal */})
  }

  return NextResponse.json({ rejected: true, rejectedAt: now.toISOString(), isScopeCreep: false })
}
