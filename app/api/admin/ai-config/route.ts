/**
 * GET  /api/admin/ai-config  — return current config + available models
 * POST /api/admin/ai-config  — save new config (superadmin only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAiConfig, invalidateAiConfigCache, AVAILABLE_MODELS } from '@/lib/ai-config'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

async function guardSuperadmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin') return null
  return session
}

export async function GET() {
  const session = await guardSuperadmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const config = await getAiConfig()
  return NextResponse.json({ ...config, availableModels: AVAILABLE_MODELS })
}

export async function POST(req: NextRequest) {
  const session = await guardSuperadmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const adminEmail = (session.user as any).email ?? 'superadmin'

  const provider = body.provider === 'openai' ? 'openai' : 'anthropic'
  const knownModels = AVAILABLE_MODELS[provider]?.map(m => m.id) ?? []
  const model = knownModels.includes(body.model) ? body.model : knownModels[1]

  const data = {
    provider,
    model,
    maxTokens:      Math.min(4000, Math.max(200,  parseInt(body.maxTokens  ?? '1000', 10))),
    temperature:    Math.min(1.0,  Math.max(0.0,  parseFloat(body.temperature ?? '0.4'))),
    devAssistant:   body.features?.devAssistant   !== false,
    specGeneration: body.features?.specGeneration !== false,
    devPlan:        body.features?.devPlan        !== false,
    feasibility:    body.features?.feasibility    !== false,
    cfoChatQuery:   body.features?.cfoChatQuery   !== false,
    updatedBy:      adminEmail,
  }

  await (prisma as any).aiConfig.upsert({
    where:  { id: 'default' },
    update: data,
    create: { id: 'default', ...data },
  })

  invalidateAiConfigCache()

  const updated = await getAiConfig()
  return NextResponse.json({ ...updated, availableModels: AVAILABLE_MODELS })
}
