import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// POST /api/admin/signups/[id]/verify
// Superadmin can manually mark a signup as verified (handles case where
// the email link was clicked but the DB column name mismatch prevented the update)
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const signup = await prisma.signupRequest.findUnique({ where: { id: params.id } })
  if (!signup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (signup.activatedAt) return NextResponse.json({ error: 'Already activated' }, { status: 409 })

  // Try Prisma update first
  try {
    await prisma.signupRequest.update({
      where: { id: params.id },
      data: { verifiedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch {
    // Fall back to raw SQL in case column is snake_case
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "SignupRequest" SET verified_at = NOW() WHERE id = $1`,
        params.id
      )
      return NextResponse.json({ ok: true })
    } catch (e2: any) {
      return NextResponse.json({ error: e2.message }, { status: 500 })
    }
  }
}
