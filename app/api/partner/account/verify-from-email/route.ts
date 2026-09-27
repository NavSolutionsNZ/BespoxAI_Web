import { NextRequest, NextResponse } from 'next/server'
import { confirmFromEmail } from '@/lib/partner-from-email'
import { revalidateTag } from 'next/cache'

export const dynamic = 'force-dynamic'

// GET /api/partner/account/verify-from-email?token=… — the link emailed to a
// partner's proposed white-label From address. No sign-in needed: holding the
// link proves control of the mailbox.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const email = await confirmFromEmail(token).catch(() => null)
  if (email) revalidateTag('branding')
  const msg = email
    ? 'Confirmed. Client notifications will now be sent from ' + email + '.'
    : 'This link is invalid or has expired. Save the address again in partner settings to get a new one.'
  const safe = msg.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  return new NextResponse(
    '<!doctype html><meta charset="utf-8"><title>From address</title>' +
    '<div style="font-family:sans-serif;max-width:480px;margin:80px auto;color:#1a2a1e"><p>' + safe + '</p></div>',
    { status: email ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )
}
