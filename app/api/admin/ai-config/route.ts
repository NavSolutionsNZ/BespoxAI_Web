/**
 * GET /api/admin/ai-config
 *
 * Returns the current AI configuration for display in the superadmin Settings tab.
 * No sensitive values (API keys) are ever returned — only presence flags.
 * Superadmin only.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AI_CONFIG, AI_ENV_VARS } from '@/lib/ai-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'superadmin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({
    enabled:         AI_CONFIG.enabled,
    provider:        AI_CONFIG.provider,
    model:           AI_CONFIG.model,
    maxTokens:       AI_CONFIG.maxTokens,
    temperature:     AI_CONFIG.temperature,
    anthropicKeySet: AI_CONFIG.anthropicKeySet,
    openaiKeySet:    AI_CONFIG.openaiKeySet,
    features:        AI_CONFIG.features,
    envVars:         AI_ENV_VARS, // descriptions only, no values
  })
}
