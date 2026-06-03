'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'

function VerifyContent() {
  const params = useSearchParams()
  const status = params.get('status')
  const error  = params.get('error')

  type State = { icon: string; title: string; body: string; sub?: string }

  let state: State

  if (status === 'verified') {
    state = {
      icon: '✓',
      title: 'Email verified',
      body: 'Your application has been submitted. The BespoxAI team will review it and send your login credentials once your account is activated.',
      sub: 'This usually takes 1–2 business days.',
    }
  } else if (status === 'already_activated') {
    state = {
      icon: '◈',
      title: 'Account already active',
      body: 'Your partner account is already activated. You can sign in at any time.',
    }
  } else if (error === 'invalid' || error === 'missing') {
    state = {
      icon: '✕',
      title: 'Invalid verification link',
      body: 'This link is invalid or has expired. Please check your email for the correct link, or submit a new application.',
    }
  } else {
    state = {
      icon: '?',
      title: 'Something went wrong',
      body: 'We could not process your verification. Please try again or contact support.',
    }
  }

  const isSuccess = status === 'verified' || status === 'already_activated'

  return (
    <div style={{ minHeight: '100vh', background: '#040E09', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: isSuccess ? 'rgba(10,92,70,0.15)' : 'rgba(226,75,74,0.12)',
          border: '1px solid ' + (isSuccess ? 'rgba(10,92,70,0.4)' : 'rgba(226,75,74,0.3)'),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
          fontSize: 24,
          color: isSuccess ? '#3FB950' : '#E24B4A',
        }}>
          {state.icon}
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: '#F4EFE4', margin: '0 0 14px' }}>
          {state.title}
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'rgba(244,239,228,0.6)', lineHeight: 1.7, marginBottom: 8 }}>
          {state.body}
        </p>
        {state.sub ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(244,239,228,0.35)', lineHeight: 1.6 }}>
            {state.sub}
          </p>
        ) : null}
        {(status === 'already_activated') ? (
          <Link href="/login" style={{ display: 'inline-block', marginTop: 24, padding: '10px 24px', borderRadius: 8, background: '#0A5C46', color: '#F4EFE4', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Sign in
          </Link>
        ) : null}
      </div>
    </div>
  )
}

export default function PartnerVerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyContent />
    </Suspense>
  )
}
