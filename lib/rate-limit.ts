// lib/rate-limit.ts — fixed-window rate limiting backed by Postgres.
//
// Serverless functions share no memory, so counters live in the "RateLimit"
// table (one row per key). Each hit is a single atomic upsert: if the row's
// window has expired it restarts at 1, otherwise it increments. Keys are
// namespaced strings such as 'login:email:alice@x.com' or 'login:ip:1.2.3.4'.
//
// Fails open: if the table is unreachable the request is allowed and the
// error is logged, so a database hiccup never locks everyone out of sign-in.

import { prisma } from './db'

export type RateLimitRule = { limit: number; windowSec: number }

export const RATE_LIMITS = {
  // Failed sign-ins. Per account stops password guessing against one user;
  // per IP stops one source spraying many accounts.
  loginEmail:     { limit: 10, windowSec: 15 * 60 },
  loginIp:        { limit: 50, windowSec: 15 * 60 },
  // Password-reset emails
  resetEmail:     { limit: 3,  windowSec: 60 * 60 },
  resetIp:        { limit: 10, windowSec: 60 * 60 },
  // Reset-link submissions
  resetSubmitIp:  { limit: 20, windowSec: 60 * 60 },
  // Wrong current password when changing password (signed-in users)
  changePwUser:   { limit: 10, windowSec: 15 * 60 },
  // Signup requests (each sends an email)
  signupIp:       { limit: 5,  windowSec: 60 * 60 },
} satisfies Record<string, RateLimitRule>

/** Client IP as seen by Vercel's edge (which overwrites x-forwarded-for). */
export function clientIp(headers: Headers | Record<string, any> | undefined | null): string {
  const get = (name: string): string | undefined => {
    if (!headers) return undefined
    if (typeof (headers as any).get === 'function') return (headers as Headers).get(name) ?? undefined
    const v = (headers as Record<string, any>)[name]
    return Array.isArray(v) ? v[0] : v
  }
  const fwd = get('x-forwarded-for')
  if (fwd) return String(fwd).split(',')[0].trim()
  return String(get('x-real-ip') || 'unknown')
}

/** Current count for a key within its window, without recording a hit. */
export async function peek(key: string, rule: RateLimitRule): Promise<number> {
  try {
    const rows = await (prisma as any).$queryRaw`
      SELECT "count" FROM "RateLimit"
      WHERE "key" = ${key}
        AND "windowStart" > NOW() - make_interval(secs => ${rule.windowSec}::float8)`
    return rows?.[0]?.count ?? 0
  } catch (e: any) {
    console.error('[rate-limit] peek failed', key, e?.message)
    return 0
  }
}

/** Record one hit and return the count within the current window. */
export async function hit(key: string, rule: RateLimitRule): Promise<number> {
  try {
    const rows = await (prisma as any).$queryRaw`
      INSERT INTO "RateLimit" ("key", "count", "windowStart")
      VALUES (${key}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."windowStart" <= NOW() - make_interval(secs => ${rule.windowSec}::float8)
                       THEN 1 ELSE "RateLimit"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimit"."windowStart" <= NOW() - make_interval(secs => ${rule.windowSec}::float8)
                       THEN NOW() ELSE "RateLimit"."windowStart" END
      RETURNING "count"`
    if (Math.random() < 0.01) void sweep()
    return rows?.[0]?.count ?? 0
  } catch (e: any) {
    console.error('[rate-limit] hit failed', key, e?.message)
    return 0
  }
}

/** True if the key has already reached its limit in the current window. */
export async function isLimited(key: string, rule: RateLimitRule): Promise<boolean> {
  return (await peek(key, rule)) >= rule.limit
}

/** Record a hit; true if this hit takes the key over its limit. */
export async function hitAndCheck(key: string, rule: RateLimitRule): Promise<boolean> {
  return (await hit(key, rule)) > rule.limit
}

/** Forget a key (e.g. after a successful sign-in). */
export async function reset(key: string): Promise<void> {
  try {
    await (prisma as any).$executeRaw`DELETE FROM "RateLimit" WHERE "key" = ${key}`
  } catch (e: any) {
    console.error('[rate-limit] reset failed', key, e?.message)
  }
}

// Occasional cleanup of rows whose window ended long ago.
async function sweep() {
  try {
    await (prisma as any).$executeRaw`DELETE FROM "RateLimit" WHERE "windowStart" < NOW() - INTERVAL '1 day'`
  } catch { /* best effort */ }
}

export function tooManyMessage(windowSec: number): string {
  const mins = Math.ceil(windowSec / 60)
  return 'Too many attempts. Please wait ' + (mins >= 60 ? Math.round(mins / 60) + ' hour' + (mins >= 120 ? 's' : '') : mins + ' minutes') + ' and try again.'
}
