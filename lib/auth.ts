import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './db'
import { RATE_LIMITS, clientIp, isLimited, hit, reset } from './rate-limit'
import { SESSION_IDLE_STANDARD, applySessionPolicy } from './session-policy'

// Compared against when the email is unknown or the account can't sign in, so
// every failed attempt costs one bcrypt comparison and response time doesn't
// reveal which emails have accounts. (Cost 12, matching stored hashes.)
const DUMMY_HASH = '$2a$12$1EB1WG1bQCZ1o7WMio7nnuLDWu35hBAfCLK2ZGq0AXremEhEJwMb6'

// Shown on the login page when sign-in is throttled (see app/login/page.tsx).
export const LOGIN_RATE_LIMITED = 'RateLimited'

// How often a signed-in session re-reads the account (active, role, partner membership)
const ACCOUNT_RECHECK_SEC = 5 * 60

export const authOptions: NextAuthOptions = {
  // Cookie lifetime = the longest idle timeout. Shorter per-role idle limits and
  // the 7-day absolute limit are enforced in the jwt callback (lib/session-policy.ts).
  session: { strategy: 'jwt', maxAge: SESSION_IDLE_STANDARD },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null

        const email    = credentials.email.toLowerCase().trim()
        const emailKey = 'login:email:' + email
        const ipKey    = 'login:ip:' + clientIp((req as any)?.headers)

        // Throttle before doing any work. Only failures are counted, so a
        // user who signs in successfully is never slowed down.
        if (await isLimited(emailKey, RATE_LIMITS.loginEmail) || await isLimited(ipKey, RATE_LIMITS.loginIp)) {
          console.warn('[auth] sign-in throttled', emailKey, ipKey)
          throw new Error(LOGIN_RATE_LIMITED)
        }
        const fail = async () => {
          await Promise.all([hit(emailKey, RATE_LIMITS.loginEmail), hit(ipKey, RATE_LIMITS.loginIp)])
          return null
        }

        const user = await (prisma as any).user.findUnique({
          where: { email },
          include: { tenant: { select: { id: true, name: true, active: true, navProduct: true, tier: true, partnerAccountId: true } } },
        })

        // Always run one bcrypt comparison (see DUMMY_HASH)
        const valid = await bcrypt.compare(credentials.password, user?.password || DUMMY_HASH)

        if (!user || !user.active) return fail()
        // Partner users may not have an active direct tenant — check tenant only for non-partner users
        const partnerCheck = await (prisma as any).partnerUser.findFirst({ where: { userId: user.id } })
        if (!partnerCheck && !user.tenant?.active) return fail()

        if (!valid) return fail()
        await reset(emailKey)

        // Check if this user is also a PartnerUser
        const partnerUser = await (prisma as any).partnerUser.findFirst({
          where: { userId: user.id },
          include: { partnerAccount: { select: { id: true, slug: true, isActive: true } } },
        })

        const isPartner = partnerUser && partnerUser.partnerAccount?.isActive

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          firstName: (user as any).firstName ?? null,
          preferredName: (user as any).preferredName ?? null,
          tenantId: isPartner ? undefined : user.tenantId,
          tenantName: isPartner ? undefined : (user.tenant?.name ?? null),
          navProduct: isPartner ? undefined : (user.tenant.navProduct ?? null),
          tenantTier: isPartner ? undefined : (user.tenant?.tier ?? 'free'),
          role: user.role,
          persona: user.persona,
          onboardingDone: user.onboardingDone,
          mustChangePassword: (user as any).mustChangePassword ?? false,
          // Partner context — undefined for non-partner users
          partnerAccountId: isPartner ? partnerUser.partnerAccountId : undefined,
          partnerRole:      isPartner ? partnerUser.role : undefined,
          partnerSlug:      isPartner ? partnerUser.partnerAccount.slug : undefined,
          managedByPartner: !isPartner && !!user.tenant?.partnerAccountId,
        }
      },
    }),
  ],

  events: {
    async signIn({ user }) {
      // Stamp last sign-in timestamp; never block login on failure
      try {
        if (user?.id) {
          await (prisma as any).user.update({
            where: { id: user.id },
            data:  { lastSignInAt: new Date() },
          })
        }
      } catch (e) {
        console.error('[auth] lastSignInAt update failed:', e)
      }
    },
  },

  callbacks: {
    async redirect({ url }) {
      // Just return the URL that NextAuth wants to go to
      // NextAuth handles all the validation
      return url
    },
    async jwt({ token, user, trigger }) {
      // On sign-in, stamp all user fields into token
      if (user) {
        token.tenantId      = (user as any).tenantId
        token.tenantName    = (user as any).tenantName
        token.navProduct    = (user as any).navProduct ?? null
        token.tenantTier    = (user as any).tenantTier ?? 'free'
        token.role          = (user as any).role
        token.persona       = (user as any).persona ?? null
        token.onboardingDone = (user as any).onboardingDone ?? false
        token.mustChangePassword = (user as any).mustChangePassword ?? false
        token.firstName     = (user as any).firstName ?? null
        token.preferredName = (user as any).preferredName ?? null
        // Partner context
        token.partnerAccountId = (user as any).partnerAccountId ?? null
        token.partnerRole      = (user as any).partnerRole ?? null
        token.partnerSlug      = (user as any).partnerSlug ?? null
        token.managedByPartner = (user as any).managedByPartner ?? false
      }
      // Idle and absolute session limits — throws (and NextAuth signs the user
      // out) when either has passed; otherwise records this as activity.
      applySessionPolicy(token as any, !!user)

      // Re-check the account every few minutes so that disabling a user,
      // changing their role or removing them from a partner team takes effect
      // within minutes instead of lasting until the token expires.
      if (!user && token.sub) {
        const nowSec = Math.floor(Date.now() / 1000)
        if (typeof token.checkedAt !== 'number' || nowSec - (token.checkedAt as number) > ACCOUNT_RECHECK_SEC) {
          const acct = await (prisma as any).user.findUnique({
            where:  { id: token.sub },
            select: { active: true, role: true },
          })
          if (!acct || !acct.active) throw new Error('SessionRevoked')
          token.role = acct.role
          if (token.partnerAccountId) {
            const membership = await (prisma as any).partnerUser.findFirst({
              where:  { userId: token.sub, partnerAccountId: token.partnerAccountId as string },
              select: { role: true, partnerAccount: { select: { isActive: true } } },
            })
            if (!membership || !membership.partnerAccount?.isActive) throw new Error('SessionRevoked')
            token.partnerRole = membership.role
          }
          token.checkedAt = nowSec
        }
      } else if (user) {
        token.checkedAt = Math.floor(Date.now() / 1000)
      }

      // On session update() call — re-read from DB so onboardingDone refreshes
      if (trigger === 'update' && token.sub) {
        const fresh = await (prisma as any).user.findUnique({
          where: { id: token.sub },
          select: { onboardingDone: true, persona: true, mustChangePassword: true, firstName: true, preferredName: true },
        })
        if (fresh) {
          token.onboardingDone     = fresh.onboardingDone
          token.persona            = fresh.persona ?? null
          token.mustChangePassword = (fresh as any).mustChangePassword ?? false
          token.firstName          = (fresh as any).firstName ?? null
          token.preferredName      = (fresh as any).preferredName ?? null
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id             = token.sub
        ;(session.user as any).tenantId      = token.tenantId
        ;(session.user as any).tenantName    = token.tenantName
        ;(session.user as any).navProduct    = token.navProduct ?? null
        ;(session.user as any).tenantTier    = token.tenantTier ?? 'free'
        ;(session.user as any).role          = token.role
        ;(session.user as any).persona       = token.persona
        ;(session.user as any).onboardingDone     = token.onboardingDone
        ;(session.user as any).mustChangePassword = token.mustChangePassword ?? false
        ;(session.user as any).firstName     = token.firstName ?? null
        ;(session.user as any).preferredName = token.preferredName ?? null
        // Partner context
        ;(session.user as any).partnerAccountId = token.partnerAccountId ?? null
        ;(session.user as any).partnerRole      = token.partnerRole ?? null
        ;(session.user as any).partnerSlug      = token.partnerSlug ?? null
        ;(session.user as any).managedByPartner = token.managedByPartner ?? false
      }
      return session
    },
  },
}
