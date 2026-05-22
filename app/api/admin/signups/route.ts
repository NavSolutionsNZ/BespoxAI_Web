import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Try Prisma client first (requires table named exactly "SignupRequest")
  try {
    const signups = await prisma.signupRequest.findMany({
      where: { activatedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    console.log(`[signups] prisma returned ${signups.length} records`)
    return NextResponse.json({ signups })
  } catch (prismaErr: any) {
    console.warn('[signups] prisma failed, trying raw SQL:', prismaErr.message)
  }

  // Fallback: raw SQL tolerates any casing of the table name
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "SignupRequest" WHERE "activatedAt" IS NULL ORDER BY "createdAt" DESC`
    )
    // Normalize: manually-created tables may use snake_case columns
    const signups = rows.map(r => ({
      id:          r.id,
      companyName: r.companyName  ?? r.company_name,
      country:     r.country,
      bcVersion:   r.bcVersion    ?? r.bc_version,
      email:       r.email,
      verifyToken: r.verifyToken  ?? r.verify_token,
      verifiedAt:  r.verifiedAt   ?? r.verified_at   ?? null,
      activatedAt: r.activatedAt  ?? r.activated_at  ?? null,
      createdAt:   r.createdAt    ?? r.created_at,
    }))
    console.log(`[signups] raw SQL returned ${signups.length} records`)
    return NextResponse.json({ signups })
  } catch (rawErr: any) {
    console.error('[signups] raw SQL also failed:', rawErr.message)
    // Last resort: check what tables actually exist
    try {
      const tables = await prisma.$queryRawUnsafe<any[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
      )
      const names = tables.map((t: any) => t.table_name).join(', ')
      console.error('[signups] tables in DB:', names)
      return NextResponse.json({ error: `Table not found. DB has: ${names}` }, { status: 500 })
    } catch {
      return NextResponse.json({ error: rawErr.message }, { status: 500 })
    }
  }
}

