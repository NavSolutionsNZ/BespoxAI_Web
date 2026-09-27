// lib/session-policy.ts — how long a signed-in session may live.
//
// Idle timeout: the session ends after this long with no activity. Activity is
// any session refresh — page load, returning to the tab, or the keep-alive in
// app/session-provider.tsx while the user is clicking or typing.
// Absolute limit: everyone signs in again after this long, however active.
//
// Roles that can reach customer tunnels, installers and RDP passwords get the
// short idle timeout.

export const SESSION_ABSOLUTE_SEC     = 7 * 24 * 60 * 60   // 7 days
export const SESSION_IDLE_PRIVILEGED  = 60 * 60            // 1 hour
export const SESSION_IDLE_STANDARD    = 8 * 60 * 60        // 8 hours (also the cookie lifetime)

// Thrown from the jwt callback; NextAuth then clears the session cookie.
export const SESSION_IDLE_ERROR    = 'SessionIdle'
export const SESSION_EXPIRED_ERROR = 'SessionExpired'

type TokenLike = { role?: unknown; partnerAccountId?: unknown }

export function idleLimitFor(token: TokenLike): number {
  const privileged = token.role === 'superadmin' || token.role === 'developer' || !!token.partnerAccountId
  return privileged ? SESSION_IDLE_PRIVILEGED : SESSION_IDLE_STANDARD
}

/**
 * Stamp or check a token's age. Call on every jwt callback.
 * - isSignIn: stamps authTime and lastActive.
 * - otherwise: throws if the absolute or idle limit has passed, else marks
 *   the token active now. Tokens issued before this policy existed have no
 *   stamps; they are treated as starting now rather than signed out.
 */
export function applySessionPolicy(token: Record<string, any>, isSignIn: boolean, nowSec = Math.floor(Date.now() / 1000)) {
  if (isSignIn) {
    token.authTime = nowSec
    token.lastActive = nowSec
    return token
  }
  const authTime   = typeof token.authTime === 'number' ? token.authTime : nowSec
  const lastActive = typeof token.lastActive === 'number' ? token.lastActive : nowSec
  if (nowSec - authTime > SESSION_ABSOLUTE_SEC) throw new Error(SESSION_EXPIRED_ERROR)
  if (nowSec - lastActive > idleLimitFor(token)) throw new Error(SESSION_IDLE_ERROR)
  token.authTime = authTime
  token.lastActive = nowSec
  return token
}
