/**
 * POST /api/requirements/[id]/prod-approval
 *
 * Superadmin only. Generates an AI go-live document (plain-English summary of
 * what is being deployed and what the customer should expect), saves it to the
 * requirement, and emails the customer asking them to approve the go-live.
 *
 * Gates: requirement must have uatApprovedAt set.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'
import { getAiConfig }               from '@/lib/ai-config'
import { notifyCustomerProdApproval } from '@/lib/notifications'
import Anthropic                     from '@anthropic-ai/sdk'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const requirement = await (prisma as any).requirement.findUnique({
    where:   { id: params.id },
    select: {
      id: true, title: true, tenantId: true, status: true,
      description: true, aiSpec: true, consultantNote: true,
      uatApprovedAt: true, prodApprovalSentAt: true,
      tenant: { select: { name: true } },
      user:   { select: { name: true, email: true } },
    },
  })

  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  if (!requirement.uatApprovedAt)
    return NextResponse.json({ error: 'UAT must be approved before sending go-live document' }, { status: 400 })

  // ── Build AI prompt for go-live doc ────────────────────────────────────────
  let specContext = ''
  if (requirement.aiSpec) {
    try {
      const spec = JSON.parse(requirement.aiSpec)
      specContext = [
        spec.userStory     ? 'User story: ' + spec.userStory : '',
        spec.bcObjects?.length ? 'BC objects modified: ' + spec.bcObjects.join(', ') : '',
        spec.acceptanceCriteria?.length
          ? 'Acceptance criteria:\n' + (spec.acceptanceCriteria as string[]).map((c: string) => '- ' + c).join('\n')
          : '',
        spec.complexity    ? 'Complexity: ' + spec.complexity : '',
        spec.estimatedDays ? 'Estimated days: ' + spec.estimatedDays : '',
      ].filter(Boolean).join('\n')
    } catch { /* ignore */ }
  }

  const promptText = [
    'You are writing a go-live approval document for a Business Central customisation. This document will be emailed to the customer asking them to approve production deployment.',
    '',
    'Requirement title: ' + requirement.title,
    'Customer: ' + (requirement.tenant?.name ?? ''),
    requirement.description ? 'Description: ' + requirement.description : '',
    specContext ? '\nTechnical context:\n' + specContext : '',
    requirement.consultantNote ? '\nConsultant note: ' + requirement.consultantNote : '',
    '',
    'Write a clear, professional go-live document. Structure it as follows:',
    '1. A short plain-English summary (2-3 sentences) of what this customisation does and what business problem it solves.',
    '2. "What is being deployed" — a bullet list of the specific changes going live (use non-technical language where possible).',
    '3. "What to expect after go-live" — 2-4 brief bullets on how the system behaviour will change.',
    '4. "Before you approve" — any actions the customer should take or be aware of (e.g. train staff, check test results, back up data).',
    '',
    'Keep the tone professional and reassuring. Do not use jargon. Total length: 200-350 words.',
    'Do not include greetings, sign-offs, or subject lines — just the document body.',
  ].filter(Boolean).join('\n')

  const aiConfig = await getAiConfig()
  const client   = new Anthropic()

  const aiRes = await client.messages.create({
    model:      aiConfig.model ?? 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages:   [{ role: 'user', content: promptText }],
  })

  const goLiveDoc = (aiRes.content[0] as any)?.text ?? ''

  if (!goLiveDoc)
    return NextResponse.json({ error: 'AI failed to generate go-live document' }, { status: 500 })

  const now = new Date()

  await (prisma as any).requirement.update({
    where: { id: params.id },
    data:  {
      prodGoLiveDoc:       goLiveDoc,
      prodApprovalSentAt:  now,
      // Clear any previous approval (admin can re-send)
      prodApprovedAt:      null,
      prodApprovedById:    null,
    },
  })

  // Fire-and-forget notification to customer
  notifyCustomerProdApproval({
    customerEmail: requirement.user.email,
    customerName:  requirement.user.name ?? '',
    title:         requirement.title,
    tenantName:    requirement.tenant?.name ?? '',
    goLiveDoc,
  }).catch(e => console.error('[prod-approval] notify:', e))

  return NextResponse.json({
    sent:      true,
    sentAt:    now.toISOString(),
    goLiveDoc,
  })
}
