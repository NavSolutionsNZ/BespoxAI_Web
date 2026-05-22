import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Maps SignupRequest.bcVersion codes → navProduct + navVersion strings
const BC_VERSION_MAP: Record<string, { navProduct: string; navVersion: string }> = {
  BC25: { navProduct: 'BC', navVersion: 'Business Central 2025 (BC25)'        },
  BC24: { navProduct: 'BC', navVersion: 'Business Central 2024 Wave 2 (BC24)' },
  BC23: { navProduct: 'BC', navVersion: 'Business Central 2024 Wave 1 (BC23)' },
  BC22: { navProduct: 'BC', navVersion: 'Business Central 2023 Wave 2 (BC22)' },
  BC21: { navProduct: 'BC', navVersion: 'Business Central 2023 Wave 1 (BC21)' },
  BC20: { navProduct: 'BC', navVersion: 'Business Central 2022 Wave 2 (BC20)' },
  BC19: { navProduct: 'BC', navVersion: 'Business Central 2022 Wave 1 (BC19)' },
  BC18: { navProduct: 'BC', navVersion: 'Business Central 2021 Wave 2 (BC18)' },
  BC17: { navProduct: 'BC', navVersion: 'Business Central 2021 Wave 1 (BC17)' },
  BC16: { navProduct: 'BC', navVersion: 'Business Central 2020 Wave 2 (BC16)' },
  BC15: { navProduct: 'BC', navVersion: 'Business Central 2020 Wave 1 (BC15)' },
  BC14: { navProduct: 'BC', navVersion: 'Business Central 2019 Wave 1 (BC14)' },
  NAV2018:   { navProduct: 'NAV', navVersion: 'NAV 2018 (NAV 12)'   },
  NAV2017:   { navProduct: 'NAV', navVersion: 'NAV 2017 (NAV 11)'   },
  NAV2016:   { navProduct: 'NAV', navVersion: 'NAV 2016 (NAV 10)'   },
  NAV2015:   { navProduct: 'NAV', navVersion: 'NAV 2015 (NAV 9)'    },
  NAV2013R2: { navProduct: 'NAV', navVersion: 'NAV 2013 R2 (NAV 8)' },
  NAV2013:   { navProduct: 'NAV', navVersion: 'NAV 2013 (NAV 7)'    },
  NAV2009R2: { navProduct: 'NAV', navVersion: 'NAV 2009 R2 (NAV 6)' },
  NAV2009:   { navProduct: 'NAV', navVersion: 'NAV 2009 (NAV 6)'    },
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId   = (session.user as any).id      as string
  const tenantId = (session.user as any).tenantId as string
  const email    = session.user.email             as string

  const [tenant, user, signup] = await Promise.all([
    (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, country: true, navProduct: true, navVersion: true, lastCU: true, bcPort: true, agentPort: true, bcInstance: true, bcCompany: true, navDatabaseServer: true, navDatabaseName: true, navServerInstance: true },
    }),
    (prisma as any).user.findUnique({
      where: { id: userId },
      select: { name: true, persona: true },
    }),
    prisma.signupRequest.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
      select: { bcVersion: true, companyName: true },
    }),
  ])

  // Tenant fields take priority; signup fills gaps
  const fromSignup = signup?.bcVersion ? BC_VERSION_MAP[signup.bcVersion] : null

  return NextResponse.json({
    user:   { name: user?.name ?? session.user.name ?? null, email, persona: user?.persona ?? null },
    tenant: { name: tenant?.name ?? null, country: tenant?.country ?? 'NZ' },
    prefill: {
      navProduct:        tenant?.navProduct        ?? fromSignup?.navProduct ?? null,
      navVersion:        tenant?.navVersion        ?? fromSignup?.navVersion ?? null,
      lastCU:            tenant?.lastCU            ?? null,
      bcPort:            tenant?.bcPort            ?? 8048,
      agentPort:         tenant?.agentPort         ?? 9099,
      bcInstance:        tenant?.bcInstance        ?? null,
      bcCompany:         tenant?.bcCompany         ?? null,
      navDatabaseServer: tenant?.navDatabaseServer ?? null,
      navDatabaseName:   tenant?.navDatabaseName   ?? null,
      navServerInstance: tenant?.navServerInstance ?? null,
    },
    signupBcVersion: signup?.bcVersion ?? null,
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId   = (session.user as any).id      as string
  const tenantId = (session.user as any).tenantId as string

  const body = await req.json().catch(() => ({}))
  const { persona, userName, navProduct, navVersion, lastCU, bcPort, agentPort, wantsToConnect, bcInstance, bcCompany, navDatabaseServer, navDatabaseName, navServerInstance } = body

  const safeBcPort    = Math.max(1, Math.min(65535, parseInt(bcPort,    10) || 8048))
  const safeAgentPort = Math.max(1, Math.min(65535, parseInt(agentPort, 10) || 9099))

  await Promise.all([
    prisma.user.update({ where: { id: userId }, data: { persona: persona ?? null, onboardingDone: true, ...(userName ? { name: userName.trim() } : {}) } }),
    (prisma as any).tenant.update({
      where: { id: tenantId },
      data: {
        ...(navProduct        !== undefined && { navProduct }),
        ...(navVersion        !== undefined && { navVersion }),
        ...(lastCU            !== undefined && { lastCU }),
        ...(bcInstance        ? { bcInstance }        : {}),
        ...(bcCompany         ? { bcCompany }         : {}),
        ...(navDatabaseServer ? { navDatabaseServer } : {}),
        ...(navDatabaseName   ? { navDatabaseName }   : {}),
        ...(navServerInstance ? { navServerInstance } : {}),
        bcPort: safeBcPort, agentPort: safeAgentPort,
      },
    }),
  ])

  return NextResponse.json({ ok: true, wantsToConnect: !!wantsToConnect })
}
