'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function PartnerBillingPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
    const user = session?.user as any
    if (status === 'authenticated' && !user?.partnerAccountId) {
      router.push('/dashboard')
    }
  }, [status, session, router])

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 12, padding: '48px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>🔨</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: '#F0F6FC', margin: '0 0 12px', fontWeight: 400 }}>
          Billing — Under Construction
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#8B949E', margin: 0, lineHeight: 1.6 }}>
          Partner billing features are coming soon. For billing inquiries, please contact the BespoxAI team.
        </p>
      </div>
    </div>
  )
}
