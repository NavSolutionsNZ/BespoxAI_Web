import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await getServerSession(authOptions)
  
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  
  return NextResponse.json({
    id: (session.user as any).id,
    email: session.user.email,
    firstName: (session.user as any).firstName,
    preferredName: (session.user as any).preferredName,
    partnerAccountId: (session.user as any).partnerAccountId,
    role: (session.user as any).role,
  })
}
