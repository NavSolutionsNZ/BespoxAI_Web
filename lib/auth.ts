import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './db'

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await (prisma as any).user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
          include: { tenant: { select: { id: true, name: true, active: true, navProduct: true, partnerAccountId: true } } },
        })

        if (!user || !user.active) return null
        // Partner users may not have an active direct tenant — check tenant only for non-partner users
        const partnerCheck = await (prisma as any).partnerUser.findFirst({ where: { userId: user.id } })
        if (!partnerCheck && !user.tenant?.active) return null

        const valid = await bcrypt.compare(credentials.password, user.password)
        if (!valid) return null

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

  callbacks: {
    async jwt({ token, user, trigger }) {
      // On sign-in, stamp all user fields into token
      if (user) {
        token.tenantId      = (user as any).tenantId
        token.tenantName    = (user as any).tenantName
        token.navProduct    = (user as any).navProduct ?? null
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
