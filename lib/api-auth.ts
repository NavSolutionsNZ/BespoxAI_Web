import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Session } from 'next-auth'

/**
 * Centralized API route auth guards.
 *
 * Each guard returns either:
 *   - a NextResponse (the error to return immediately), OR
 *   - the validated Session (auth passed; use it for role/tenant/id).
 *
 * Usage in a route:
 *   const auth = await requireSuperadmin()
 *   if (auth instanceof NextResponse) return auth
 *   // auth is now a guaranteed-valid Session
 *   const userId = (auth.user as any).id
 *
 * Behaviour is intentionally identical to the inline guards it replaces:
 *   - requireUser        -> 401 Unauthorized if not logged in   (was: sessionGuard / !session?.user)
 *   - requireSuperadmin  -> 403 Forbidden unless role===superadmin (was: adminGuard / isSuperadmin)
 *   - requireSuperadminOrDeveloper -> 403 unless role in {superadmin,developer}
 *                                     (was: superadminGuard in admin/requirements)
 *   - requireTenant      -> 401 if not logged in or no tenantId
 *   - requireTenantAdmin -> 403 unless a customer tenant_admin (or superadmin)
 *                           with a real tenantId, and not a partner session
 */

const UNAUTHORIZED = () =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

const FORBIDDEN = () =>
  NextResponse.json({ error: 'Forbidden' }, { status: 403 })

function role(session: Session | null): string | undefined {
  return (session?.user as any)?.role
}

/** Logged in (any role). Mirrors the old `sessionGuard` (401). */
export async function requireUser(): Promise<Session | NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return UNAUTHORIZED()
  return session
}

/** Superadmin only. Mirrors the old `adminGuard` / `isSuperadmin` (403). */
export async function requireSuperadmin(): Promise<Session | NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session?.user || role(session) !== 'superadmin') return FORBIDDEN()
  return session
}

/**
 * Superadmin OR developer. Mirrors the (misleadingly named) `superadminGuard`
 * in app/api/admin/requirements/route.ts, which allows both roles (403).
 */
export async function requireSuperadminOrDeveloper(): Promise<Session | NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session?.user || !['superadmin', 'developer'].includes(role(session) ?? ''))
    return FORBIDDEN()
  return session
}

/** Logged in AND has a tenant. Mirrors the tenant-scoped inline checks (401). */
export async function requireTenant(): Promise<Session | NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session?.user || !(session.user as any).tenantId) return UNAUTHORIZED()
  return session
}

/**
 * Customer tenant administrator acting on their own tenant (403 otherwise).
 *
 * Requires a real tenantId: Prisma treats `where: { tenantId: undefined }` as
 * "no filter", so a session without one would otherwise see every tenant's
 * rows. Partner sessions are refused — a partner user's token keeps the role
 * of their underlying user account but has no customer tenant.
 */
export async function requireTenantAdmin(): Promise<Session | NextResponse> {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u || !u.tenantId || u.partnerAccountId) return FORBIDDEN()
  if (u.role !== 'tenant_admin' && u.role !== 'superadmin') return FORBIDDEN()
  return session as Session
}
