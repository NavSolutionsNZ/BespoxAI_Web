/**
 * POST /api/requirements/[id]/manual-deploy-test
 *
 * Superadmin only. Records a manual deployment to the test environment —
 * skips BCAgent and write-files entirely. Sets status to 'in_uat',
 * sets testDeployedAt, clears previous UAT state, and appends a
 * deployment note recording who deployed and when.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const user = session.user as any
  const name = (user.preferredName ?? user.firstName ?? user.name ?? 'Admin') as string

  const requirement = await (prisma as any).requirement.findUnique({
    where:  { id: params.id },
    select: { id: true, status: true, deploymentNotes: true },
  })
  if (!requirement)
    return NextResponse.json({ error: 'Requirement not found' }, { status: 404 })

  const now      = new Date()
  const dateStr  = now.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
  const newNote  = 'Manually deployed to test by ' + name + ' on ' + dateStr
  const existing = requirement.deploymentNotes ? requirement.deploymentNotes + '\n' : ''

  await (prisma as any).requirement.update({
    where: { id: params.id },
    data:  {
      status:               'in_uat',
      testDeployedAt:       now,
      testDeploySnapshotId: null,
      deploymentNotes:      existing + newNote,
      // Clear previous UAT cycle
      uatApprovedAt:        null,
      uatApprovedById:      null,
      uatRejectedAt:        null,
      uatRejectedById:      null,
      uatRejectionReason:   null,
      uatRejectionAnalysis: null,
    },
  })

  return NextResponse.json({ success: true, deployedAt: now.toISOString() })
}
