import { NextRequest, NextResponse } from 'next/server'
import { canConnectRdp, signEvalResponse, verifyAccessEvalToken } from '@/lib/rdp-access'
import { logRdpAccess } from '@/lib/rdp'

export const dynamic = 'force-dynamic'

// POST /api/rdp/access-check/[tenantId] — Cloudflare Access External Evaluation.
//
// Called by Cloudflare (not by browsers) after someone signs in to the
// tenant's RDP Access app. The body is { token } signed by our Access
// account; we answer { token } signed with RDP_ACCESS_EVAL_KEY, echoing the
// nonce, with success true only if canConnectRdp() allows this email.
// Every verified attempt is logged. Anything unverifiable gets success:false.
export async function POST(req: NextRequest, props: { params: Promise<{ tenantId: string }> }) {
  const params = await props.params
  let success = false
  let nonce: string | undefined

  try {
    const body   = await req.json().catch(() => ({}))
    const claims = await verifyAccessEvalToken(body?.token)
    if (claims) {
      nonce = claims.nonce
      const email: string = claims.identity?.email || claims.email || ''
      const decision = await canConnectRdp(params.tenantId, email)
      success = decision.allowed
      await logRdpAccess({
        tenantId:  params.tenantId,
        userId:    decision.userId,
        userEmail: email,
        action:    decision.allowed ? 'connect_allowed' : 'connect_denied',
      })
      if (!decision.allowed) console.warn('[rdp-access-check] denied', params.tenantId, email, decision.reason)
    } else {
      console.warn('[rdp-access-check] unverifiable token for tenant', params.tenantId)
    }
  } catch (e: any) {
    // Fail closed: any error (including a failed audit write) denies.
    success = false
    console.error('[rdp-access-check] error', params.tenantId, e?.message)
  }

  try {
    return NextResponse.json({ token: signEvalResponse({ success, nonce }) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    console.error('[rdp-access-check] cannot sign response', e?.message)
    return NextResponse.json({ error: 'unavailable' }, { status: 500 })
  }
}
