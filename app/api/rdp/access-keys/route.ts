import { NextResponse } from 'next/server'
import { evalJwks } from '@/lib/rdp-access'

export const dynamic = 'force-dynamic'

// GET /api/rdp/access-keys — public key (JWKS) Cloudflare Access uses to verify
// the answers from /api/rdp/access-check/[tenantId]. Public by design.
export async function GET() {
  try {
    return NextResponse.json(evalJwks(), { headers: { 'Cache-Control': 'public, max-age=300' } })
  } catch (e: any) {
    console.error('[rdp-access-keys]', e?.message)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
