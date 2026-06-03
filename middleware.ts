import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const hostname = req.headers.get('host') ?? ''
  const isPartnerSite = hostname === 'partners.bespoxai.com' || hostname.startsWith('partners.')

  if (!isPartnerSite) return NextResponse.next()

  const { pathname } = req.nextUrl

  // Rewrite partner subdomain paths to /partner-site/* equivalents
  if (pathname === '/' || pathname === '') {
    return NextResponse.rewrite(new URL('/partner-site', req.url))
  }
  if (pathname === '/signup') {
    return NextResponse.rewrite(new URL('/partner-site/signup', req.url))
  }
  if (pathname === '/signup/verify') {
    return NextResponse.rewrite(new URL('/partner-site/signup/verify', req.url))
  }

  // API routes, auth, and /partner/* pass through unchanged
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
