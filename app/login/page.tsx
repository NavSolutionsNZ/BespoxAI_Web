'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useEffect } from 'react'
import { useState, FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Detect if on partner portal
  const isPartnerPortal = typeof window !== 'undefined' && window.location.hostname === 'partners.bespoxai.com'

  // Pre-fill email from URL params if redirected from wrong portal
  useEffect(() => {
    const emailParam = searchParams.get('email')
    const msg = searchParams.get('msg')
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam))
    }
    if (msg === 'wrong-portal') {
      setError('You tried to sign in to the wrong portal. Please enter your password.')
    }
  }, [searchParams])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    
    const startTime = Date.now()

    const res = await signIn('credentials', { email, password, redirect: false })
    const afterSignIn = Date.now()
    const signInTime = afterSignIn - startTime
    
    setLoading(false)
    
    if (res?.error) {
      setError('Invalid email or password. Please try again.')
    } else if (res?.ok) {
      // Check user type to ensure they're using the correct portal
      try {
        const userRes = await fetch('/api/auth/me')
        const afterUserCheck = Date.now()
        const userCheckTime = afterUserCheck - startTime
        
        if (userRes.ok) {
          const user = await userRes.json()
          const isPartner = !!user.partnerAccountId
          const isPartnerDomain = window.location.hostname === 'partners.bespoxai.com'
          
          // Check for portal mismatch
          if (isPartner && !isPartnerDomain) {
            // Partner trying to sign in to main portal — redirect to partner login
            const encodedEmail = encodeURIComponent(email)
            window.location.href = `https://partners.bespoxai.com/login?email=${encodedEmail}&msg=wrong-portal`
            return
          } else if (!isPartner && isPartnerDomain) {
            // Non-partner trying to sign in to partner portal — redirect to main login
            const encodedEmail = encodeURIComponent(email)
            window.location.href = `https://bespoxai.com/login?email=${encodedEmail}&msg=wrong-portal`
            return
          }
          
          // Correct portal — proceed
          alert(`✅ Sign-in complete!\nSign-in: ${signInTime}ms\nPortal check: ${userCheckTime - signInTime}ms\nTotal: ${userCheckTime}ms`)
          if (isPartner) {
            router.push('/partner/dashboard')
          } else {
            router.push(callbackUrl)
          }
        } else {
          router.push(callbackUrl)
        }
      } catch (err) {
        router.push(callbackUrl)
      }
    }
  }
  
  return (
    <div style={{
      minHeight: '100vh',
      background: '#ffffff',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      position: 'relative',
      overflow: 'hidden',
    }}>





      {/* Back to site */}
      <div style={{ position: 'absolute', top: 20, left: 20 }}>
        <a href="/index.html" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--slate)', textDecoration: 'none',
          transition: 'color 0.15s',
          cursor: 'pointer',
        }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--forest)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--slate)')}
        >
          ← bespoxai.com
        </a>
      </div>

      {/* Request access — top right */}
      <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--slate)' }}>New?</span>
        <Link href="/signup" style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--forest)', textDecoration: 'none', fontWeight: 600,
          transition: 'color 0.15s',
        }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--emerald)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--forest)')}
        >
          Request access →
        </Link>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 420, position: 'relative', zIndex: 1,
        animation: 'fadeUp 0.45s ease forwards',
      }}>

        {/* Wordmark */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 0, marginBottom: 10 }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 32,
              color: 'var(--ink)', letterSpacing: '-0.3px', lineHeight: 1,
            }}>
              Bespox
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 24,
              color: 'var(--forest)', letterSpacing: '0.04em', lineHeight: 1,
              marginLeft: 4,
            }}>
              AI
            </span>
          </div>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--slate)',
          }}>
            Business Central & Microsoft NAV Intelligence Portal
          </p>
        </div>

        {/* Login card */}
        <div style={{
          background: 'var(--white)',
          border: '1px solid var(--fog)',
          borderRadius: 16,
          padding: '36px 32px 32px',
          boxShadow: '0 4px 40px rgba(4,14,9,0.06)',
        }}>

          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 26,
            color: 'var(--ink)', marginBottom: 6, lineHeight: 1.1,
          }}>
            {isPartnerPortal ? (
              <>Sign in to your <em style={{ color: 'var(--emerald)', fontStyle: 'italic' }}>partner portal</em></>
            ) : (
              <>Sign in to your <em style={{ color: 'var(--emerald)', fontStyle: 'italic' }}>portal</em></>
            )}
          </h1>
          <p style={{
            fontFamily: 'var(--font-body)', fontSize: 13,
            color: 'var(--slate)', marginBottom: 28, lineHeight: 1.5,
          }}>
            {isPartnerPortal ? 'Connected to all your client instances.' : 'Connected to your live Business Central & NAV data.'}
          </p>

          {error && (
            <div style={{
              background: 'rgba(163,45,45,0.06)', border: '1px solid rgba(163,45,45,0.2)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 20,
              fontFamily: 'var(--font-body)', fontSize: 13, color: '#A32D2D',
              lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block', fontFamily: 'var(--font-mono)',
                fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase',
                color: 'var(--slate)', marginBottom: 8,
              }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@company.com"
                style={{
                  width: '100%', padding: '11px 14px',
                  background: 'var(--cream)', border: '1px solid var(--fog)',
                  borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: 14,
                  color: 'var(--ink)', outline: 'none', transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
              />
            </div>

            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <label style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase',
                  color: 'var(--slate)',
                }}>
                  Password
                </label>
                <Link href="/forgot-password" style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'var(--slate)', textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--forest)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--slate)')}
                >
                  Forgot password?
                </Link>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  style={{
                    width: '100%', padding: '11px 14px 11px 14px',
                    paddingRight: '40px',
                    background: 'var(--cream)', border: '1px solid var(--fog)',
                    borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: 14,
                    color: 'var(--ink)', outline: 'none', transition: 'border-color 0.15s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => (e.target.style.borderColor = 'var(--forest)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--fog)')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--slate)', fontSize: 16, padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '👁' : '👁‍🗨'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '13px',
                background: loading ? 'var(--fog)' : 'var(--forest)',
                color: loading ? 'var(--slate)' : 'var(--white)',
                border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
                letterSpacing: '0.02em', transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!loading) (e.currentTarget.style.background = 'var(--emerald)') }}
              onMouseLeave={e => { if (!loading) (e.currentTarget.style.background = 'var(--forest)') }}
            >
              {loading ? 'Signing in…' : 'Sign in to portal →'}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--fog)' }} />
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fog)',
            }}>
              or
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--fog)' }} />
          </div>

          {/* Microsoft SSO — future phase */}
          <button
            disabled
            title="Coming soon — BC SaaS OAuth"
            style={{
              width: '100%', padding: '12px',
              background: 'transparent', border: '1px solid var(--fog)',
              borderRadius: 8, cursor: 'not-allowed', display: 'flex',
              alignItems: 'center', justifyContent: 'center', gap: 10,
              fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--fog)',
              transition: 'border-color 0.15s',
            }}
          >
            {/* Microsoft logo simplified */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6.5" height="6.5" fill="#F25022" opacity="0.35" />
              <rect x="8.5" y="1" width="6.5" height="6.5" fill="#7FBA00" opacity="0.35" />
              <rect x="1" y="8.5" width="6.5" height="6.5" fill="#00A4EF" opacity="0.35" />
              <rect x="8.5" y="8.5" width="6.5" height="6.5" fill="#FFB900" opacity="0.35" />
            </svg>
            Sign in with Microsoft (BC SaaS) — coming soon
          </button>
        </div>

        {/* Privacy note */}
        <p style={{
          textAlign: 'center', marginTop: 20,
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.1em', color: 'var(--slate)', lineHeight: 1.7,
        }}>
          Your credentials are encrypted in transit.<br />
          BespoxAI uses delegated authentication — we never store your ERP password.
        </p>


      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#ffffff' }} />}>
      <LoginForm />
    </Suspense>
  )
}
