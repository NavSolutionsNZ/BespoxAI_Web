import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/admin/ui-theme — current user's admin portal theme
export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id || u.role !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const dbUser = await (prisma as any).user.findUnique({ where: { id: u.id }, select: { uiTheme: true } })
  return NextResponse.json({ uiTheme: dbUser?.uiTheme === 'dark' ? 'dark' : 'light' })
}

// PATCH /api/admin/ui-theme — persist theme choice
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id || u.role !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const uiTheme = body.uiTheme === 'dark' ? 'dark' : 'light'
  await (prisma as any).user.update({ where: { id: u.id }, data: { uiTheme } })
  return NextResponse.json({ ok: true, uiTheme })
}
