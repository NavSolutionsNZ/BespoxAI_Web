import { NextRequest, NextResponse } from 'next/server'
import { RATE_LIMITS, clientIp, hitAndCheck } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// POST /api/csp-report — browsers send Content-Security-Policy violation
// reports here (report-uri in vercel.json). The policy is Report-Only for now:
// each report is logged as a warning so the policy can be tightened and then
// enforced once the logs show nothing legitimate is being blocked.
// Accepts both the legacy { "csp-report": {...} } body and the Reporting API
// array. Unauthenticated by design; capped per IP and in size.
export async function POST(req: NextRequest) {
  if (await hitAndCheck('csp-report:ip:' + clientIp(req.headers), RATE_LIMITS.cspReportIp)) {
    return new NextResponse(null, { status: 204 })
  }
  const text = (await req.text().catch(() => '')).slice(0, 8000)
  try {
    const body = JSON.parse(text)
    const reports: any[] = Array.isArray(body) ? body.map(r => r?.body ?? r) : [body?.['csp-report'] ?? body]
    for (const r of reports.slice(0, 10)) {
      console.warn('[csp-report]', JSON.stringify({
        directive: r?.['effective-directive'] ?? r?.effectiveDirective ?? r?.['violated-directive'],
        blocked:   r?.['blocked-uri'] ?? r?.blockedURL,
        page:      r?.['document-uri'] ?? r?.documentURL,
        source:    r?.['source-file'] ?? r?.sourceFile,
        line:      r?.['line-number'] ?? r?.lineNumber,
        sample:    (r?.['script-sample'] ?? r?.sample ?? '').slice(0, 80),
      }))
    }
  } catch {
    console.warn('[csp-report] unparseable report')
  }
  return new NextResponse(null, { status: 204 })
}
