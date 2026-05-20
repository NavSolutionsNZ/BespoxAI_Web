import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function isTenantAdmin(role: string) { return role === 'tenant_admin' || role === 'superadmin' }

// ── DEBUG MODE ────────────────────────────────────────────────────────────────
const DEBUG = process.env.SETTINGS_DEBUG === 'true'
// ── END DEBUG ─────────────────────────────────────────────────────────────────

// PATCH /api/settings/users/[id] — promote | demote | enable | disable | reset
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const action = body.action as string
  if (!['promote', 'demote', 'enable', 'disable', 'reset'].includes(action))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  // ── DEBUG ──
  if (DEBUG) {
    if (action === 'reset') return NextResponse.json({ ok: true, tempPassword: 'debug-reset-5678', _debug: true })
    return NextResponse.json({ ok: true, _debug: true })
  }
  // ── END DEBUG ──

  const tenantId = (session.user as any).tenantId
  const selfId   = (session.user as any).id

  // Verify target user belongs to same tenant
  const target = await prisma.user.findFirst({ where: { id: params.id, tenantId } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (target.id === selfId && ['disable', 'demote'].includes(action))
    return NextResponse.json({ error: 'Cannot demote or disable yourself' }, { status: 400 })

  const data: Record<string, any> = {}
  let tempPassword: string | undefined

  if (action === 'promote') data.role   = 'tenant_admin'
  if (action === 'demote')  data.role   = 'user'
  if (action === 'enable')  data.active = true
  if (action === 'disable') data.active = false
  if (action === 'reset') {
    tempPassword = crypto.randomBytes(5).toString('hex')
    data.password = await bcrypt.hash(tempPassword, 12)
  }

  await prisma.user.update({ where: { id: params.id }, data })
  return NextResponse.json({ ok: true, ...(tempPassword ? { tempPassword } : {}) })
}

// DELETE /api/settings/users/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role
  if (!session?.user || !isTenantAdmin(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── DEBUG ──
  if (DEBUG) return NextResponse.json({ ok: true, _debug: true })
  // ── END DEBUG ──

  const tenantId = (session.user as any).tenantId
  const selfId   = (session.user as any).id
  if (params.id === selfId) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })

  const target = await prisma.user.findFirst({ where: { id: params.id, tenantId } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  await prisma.user.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
