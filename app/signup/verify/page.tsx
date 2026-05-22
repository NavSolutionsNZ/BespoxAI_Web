'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useEffect } from 'react'

function VerifyContent() {
  const params = useSearchParams()
  const router = useRouter()
  const status = params.get('status')
  const token  = params.get('token')

  // If there's a raw token, call the verify API and redirect to status page
  useEffect(() => {
    if (!token || status) return
    // API always redirects to /signup/verify?status=xxx -- follow it and land on the result
    fetch('/api/signup/verify?token=' + token)
      .then(r => {
        const url = new URL(r.url)
        router.replace(url.pathname + url.search)
      })
      .catch(() => router.replace('/signup/verify?status=error'))
  }, [token, status])

  if (token && !status) {
    return (
      <Card icon="⏳" title="Verifying…" body="Please wait while we verify your email address." />
    )
  }

  if (status === 'success') {
    return (
      <Card
        icon="✅"
        title="Email verified!"
        body="Thanks for confirming your email. Our team will review your request and send your login credentials to your inbox shortly."
        footer="You'll receive a welcome email with your password once your account is activated."
      />
    )
  }

  if (status === 'already') {
    return (
      <Card
        icon="✉️"
        title="Already verified"
        body="Your email has already been verified. Our team will be in touch soon with your login credentials."
      />
    )
  }

  if (status === 'expired') {
    return (
      <Card
        icon="⏰"
        title="Link expired"
        body="This verification link has expired (links are valid for 48 hours). Please sign up again to receive a new link."
        link={{ href: '/signup', label: 'Sign up again →' }}
      />
    )
  }

  return (
    <Card
      icon="❌"
      title="Invalid link"
      body="This verification link is invalid or has already been used."
      link={{ href: '/signup', label: 'Sign up again →' }}
    />
  )
}

function Card({ icon, title, body, footer, link }: {
  icon: string
  title: string
  body: string
  footer?: string
  link?: { href: string; label: string }
}) {
  return (
    <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <div style={{ fontSize: 44, marginBottom: 16 }}>{icon}</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#040E09', marginBottom: 12 }}>{title}</h2>
      <p style={{ fontSize: 14, color: '#5a6a5e', lineHeight: 1.65 }}>{body}</p>
      {footer && <p style={{ fontSize: 13, color: '#8a9a8e', marginTop: 12, lineHeight: 1.6 }}>{footer}</p>}
      {link && (
        <a href={link.href} style={{ display: 'inline-block', marginTop: 24, color: '#0A5C46', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          {link.label}
        </a>
      )}
      <div style={{ marginTop: 24 }}>
        <a href="/login" style={{ color: '#8a9a8e', fontSize: 13, textDecoration: 'none' }}>← Back to login</a>
      </div>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'var(--font-body)' }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <span style={{ fontFamily: 'var(--font-cormorant)', fontSize: 32, fontWeight: 600, color: '#F4EFE4' }}>
          Bespox<span style={{ color: '#C8952A' }}>AI</span>
        </span>
      </div>
      <div style={{ background: '#ffffff', borderRadius: 16, padding: '36px 40px', width: '100%', maxWidth: 440, boxShadow: '0 8px 40px rgba(4,14,9,0.3)' }}>
        <Suspense fallback={<Card icon="⏳" title="Loading…" body="Please wait." />}>
          <VerifyContent />
        </Suspense>
      </div>
    </div>
  )
}
