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
          include: { tenant: { select: { id: true, name: true, active: true, navProduct: true } } },
        })

        if (!user || !user.tenant.active || !user.active) return null

        const valid = await bcrypt.compare(credentials.password, user.password)
        if (!valid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          tenantId: user.tenantId,
          tenantName: user.tenant.name,
          navProduct: user.tenant.navProduct ?? null,
          role: user.role,
          persona: user.persona,
          onboardingDone: user.onboardingDone,
          mustChangePassword: (user as any).mustChangePassword ?? false,
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
      }
      // On session update() call — re-read from DB so onboardingDone refreshes
      if (trigger === 'update' && token.sub) {
        const fresh = await (prisma as any).user.findUnique({
          where: { id: token.sub },
          select: { onboardingDone: true, persona: true, mustChangePassword: true },
        })
        if (fresh) {
          token.onboardingDone     = fresh.onboardingDone
          token.persona            = fresh.persona ?? null
          token.mustChangePassword = (fresh as any).mustChangePassword ?? false
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
      }
      return session
    },
  },
}
